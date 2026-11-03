"use strict";
// Duet write access (D9), ship 4: job notes and daily updates. PURE planners
// copied from the app's own handlers in src/App.js:
//   • JobNotes addNote (~L12759)       → {id, title, phase, createdAt, createdBy,
//     updatedAt, lines:[{id, text, createdAt, photos:[], promoted:null}], photos:[],
//     archived:false, deleted:false, migratedFrom:null} appended (newest last)
//   • addLine (~L11737)                → a line {id, text, createdAt, photos:[], promoted:null}
//   • line edit via upsertNote          → the whole note replaced, updatedAt bumped
//   • removeLine refuses a promoted line (~L11724); editing one is refused here too
//   • softDeleteNote (~L12734)         → {deleted:true, updatedAt}   (never a hard remove)
//   • archiveNote / unarchiveNote      → {archived:true, archivedAt, updatedAt} /
//     (~L12747 / ~L12753)                 {archived:false, archivedAt:null, updatedAt}
//   • DailyUpdates.add (~L16629)       → {id, date, text, addedBy, createdAt} PREPENDED
//     to data.<phase>Updates
//
// THE MIGRATION TRAP: a job whose jobNotes is empty and jobNotesMigratedAt
// unset shows its legacy rough / finish instructions AS notes, built in memory
// by buildMigratedJobNotes. The app's first jobNotes write persists that whole
// list and stamps jobNotesMigratedAt (JobDetail u(), ~L32037). So the server's
// first write does exactly that, with the SAME code (functions/jobNotesShape.js
// is a byte copy of src/jobNotesShape.js). Edits by id on such a job are
// refused: the ids on screen are made fresh on every load and exist nowhere.
//
// No Firestore here: api.js does the transaction, scripts/duet-notes-test.js
// drives these with fixtures.
const JN = require("../jobNotesShape.js");
const { ME, cleanText } = require("./needs.js");
const { newItemId, jobGate } = require("./jobItems.js");

const NOTE_PHASES = ["general", "rough", "finish", "spec"];
const UPDATE_PHASES = ["rough", "finish"];
const refuse = (why) => ({ refused: why });
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00"));
const byId = (arr, id) => (Array.isArray(arr) ? arr : []).findIndex(x => x && String(x.id) === String(id));

// An id maker with the app's uid() shape (ms as a string), counting up from
// now and never landing on an id already on the job's notes or lines.
function idMaker(nowMs, taken) {
  const used = new Set((taken || []).map(String));
  let last = Math.floor(nowMs) - 1;
  return () => { let id = last + 1; while (used.has(String(id))) id += 1; used.add(String(id)); last = id; return String(id); };
}
function noteIds(list) {
  const ids = [];
  (Array.isArray(list) ? list : []).forEach(n => { if (!n) return; if (n.id != null) ids.push(n.id); (Array.isArray(n.lines) ? n.lines : []).forEach(l => l && l.id != null && ids.push(l.id)); });
  return ids;
}

// The list the app holds in memory for this job (normalizeJobNotes: saved
// notes with legacy HTML cleaned for display — which the app's next write
// persists — or the migrated legacy instructions), plus whether this write
// is the one that stamps jobNotesMigratedAt.
function currentNotes(job, ctx) {
  const raw = job.data;
  const saved = Array.isArray(raw.jobNotes) ? raw.jobNotes : [];
  const nextId = idMaker(Date.parse(ctx.nowIso), noteIds(saved));
  const migrate = JN.jobNotesNeedMigration(raw);
  const notes = migrate ? JN.buildMigratedJobNotes(raw, nextId, ctx.nowIso) : JN.normalizeJobNotes(raw, nextId);
  return { notes, migrate, nextId, cleaned: !migrate && notes !== saved };
}
const stampIf = (fields, migrate, nowIso) => (migrate ? { ...fields, jobNotesMigratedAt: nowIso } : fields);

// addNote with the title and first line filled the way Koy would have typed
// them. Appended last, like the app.
function planAddNote(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = a.phase == null || a.phase === "" ? "general" : String(a.phase);
  if (!NOTE_PHASES.includes(phase)) return refuse(`phase must be one of ${NOTE_PHASES.join(", ")} (default general).`);
  for (const k of ["title", "text"]) if (a[k] != null && typeof a[k] !== "string" && typeof a[k] !== "number") return refuse(`${k} must be text.`);
  const title = cleanText(a.title).slice(0, 200);
  const text = cleanText(a.text);
  if (!title && !text) return refuse("A note needs a title or some text.");
  const { notes, migrate, nextId } = currentNotes(ctx.job, ctx);
  const now = ctx.nowIso;
  const note = {
    id: nextId(),
    title,
    phase,
    createdAt: now,
    createdBy: ME,
    updatedAt: now,
    lines: [{ id: nextId(), text, createdAt: now, photos: [], promoted: null }],
    photos: [],
    archived: false,
    deleted: false,
    migratedFrom: null,
  };
  return { note, fields: stampIf({ jobNotes: [...notes, note] }, migrate, now), migrated: migrate ? notes.length : 0, number: notes.length + 1 };
}

// One existing note by id, on a job whose notes are saved. Deleted notes are
// gone from every list in the app; archived ones can only be unarchived.
function locateNote(args, ctx, { allowArchived = false } = {}) {
  const g = jobGate(ctx.job); if (g) return g;
  const cur = currentNotes(ctx.job, ctx);
  if (cur.migrate) return refuse(`${ctx.job.data.name || "That job"}'s notes haven't been saved in the new format yet — what shows is built from the old rough / finish instructions and gets new ids on every load. Add a note first (that saves them all), then edit by id. Nothing was written.`);
  const i = byId(cur.notes, args.noteId);
  if (i < 0) return refuse(`No job note with id ${args.noteId} on ${ctx.job.data.name || "that job"}. Nothing was written.`);
  const note = cur.notes[i];
  if (note.deleted) return refuse(`Note #${i + 1}${note.title ? ` "${note.title}"` : ""} was deleted. Nothing was written.`);
  if (note.archived && !allowArchived) return refuse(`Note #${i + 1}${note.title ? ` "${note.title}"` : ""} is archived — unarchive it first. Nothing was written.`);
  return { cur, i, note };
}
function replaceNote(cur, i, next) {
  return { note: next, before: cur.notes[i], fields: { jobNotes: cur.notes.map((n, j) => j === i ? next : n) }, number: i + 1, cleaned: cur.cleaned };
}

// addLine (the + line button) with the text typed in the same save.
function planAddLine(args, ctx) {
  const a = args || {};
  const L = locateNote(a, ctx); if (L.refused) return L;
  if (a.text != null && typeof a.text !== "string" && typeof a.text !== "number") return refuse("text must be text.");
  const text = cleanText(a.text);
  if (!text) return refuse("A line needs its text.");
  const line = { id: L.cur.nextId(), text, createdAt: ctx.nowIso, photos: [], promoted: null };
  const next = { ...L.note, lines: [...(Array.isArray(L.note.lines) ? L.note.lines : []), line], updatedAt: ctx.nowIso };
  return { ...replaceNote(L.cur, L.i, next), line };
}

// A line's text replaced (upsertNote of the whole note). A promoted line
// refuses: the destination (RT / punch / CO / call) still points at it.
function planEditLine(args, ctx) {
  const a = args || {};
  const L = locateNote(a, ctx); if (L.refused) return L;
  const lines = Array.isArray(L.note.lines) ? L.note.lines : [];
  const li = byId(lines, a.lineId);
  if (li < 0) return refuse(`No line with id ${a.lineId} on note #${L.i + 1}${L.note.title ? ` "${L.note.title}"` : ""}. Nothing was written.`);
  const line = lines[li];
  if (line.promoted) return refuse(`That line was promoted to ${String(line.promoted.type || line.promoted.kind || "another place")} — the app won't change it either; edit the destination. Nothing was written.`);
  if (a.text == null) return refuse("text is required (\"\" clears the line).");
  if (typeof a.text !== "string" && typeof a.text !== "number") return refuse("text must be text.");
  const text = cleanText(a.text);
  if (text === String(line.text || "")) return { noop: true, note: L.note, line, number: L.i + 1 };
  const nextLine = { ...line, text };
  const next = { ...L.note, lines: lines.map((l, j) => j === li ? nextLine : l), updatedAt: ctx.nowIso };
  return { ...replaceNote(L.cur, L.i, next), line: nextLine, beforeLine: line };
}

// archiveNote / unarchiveNote, by `archived` true | false.
function planArchiveNote(args, ctx) {
  const a = args || {};
  if (typeof a.archived !== "boolean") return refuse("archived must be true (archive) or false (unarchive).");
  const L = locateNote(a, ctx, { allowArchived: true }); if (L.refused) return L;
  if (!!L.note.archived === a.archived) return { noop: true, note: L.note, number: L.i + 1 };
  const now = ctx.nowIso;
  const next = a.archived ? { ...L.note, archived: true, archivedAt: now, updatedAt: now } : { ...L.note, archived: false, archivedAt: null, updatedAt: now };
  return replaceNote(L.cur, L.i, next);
}

// softDeleteNote: {deleted:true, updatedAt}. The note stays in the array for
// audit, as the app's own confirm says; nothing is ever removed.
function planDeleteNote(args, ctx) {
  const a = args || {};
  const L = locateNote(a, ctx, { allowArchived: true }); if (L.refused) return L;
  const next = { ...L.note, deleted: true, updatedAt: ctx.nowIso };
  return { ...replaceNote(L.cur, L.i, next), promotedLines: (Array.isArray(L.note.lines) ? L.note.lines : []).filter(l => l && l.promoted).length };
}

// ── Daily updates ─────────────────────────────────────────────────────────────

// DailyUpdates.add: PREPENDED, dated today (Mountain) unless a date is given.
// No edit, no delete (the app's delete is a hard filter — not for Duet).
function planAddDailyUpdate(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "");
  if (!UPDATE_PHASES.includes(phase)) return refuse("phase must be rough or finish.");
  if (a.text != null && typeof a.text !== "string" && typeof a.text !== "number") return refuse("text must be text.");
  const text = cleanText(a.text);
  if (!text) return refuse("A daily update needs its text.");
  if (a.date != null && a.date !== "" && !isYmd(a.date)) return refuse("date must be YYYY-MM-DD.");
  const date = a.date ? String(a.date) : ctx.todayYmd;
  if (!isYmd(date)) return refuse("No valid date for today — give date as YYYY-MM-DD.");
  const field = `${phase}Updates`;
  const updates = Array.isArray(ctx.job.data[field]) ? ctx.job.data[field] : [];
  const entry = { id: newItemId(Date.parse(ctx.nowIso), updates.map(u => u && u.id)), date, text, addedBy: ME, createdAt: ctx.nowIso };
  return { entry, field, updates: [entry, ...updates], number: updates.length + 1 };
}

module.exports = { NOTE_PHASES, UPDATE_PHASES, idMaker, currentNotes, planAddNote, planAddLine, planEditLine, planArchiveNote, planDeleteNote, planAddDailyUpdate };
