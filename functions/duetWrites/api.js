"use strict";
// duetApi — Claude Duet's only door into Command Center for WRITES (connector
// decision D9, 2026-11-03). The Homestead connector (Vercel) calls this with a
// bearer secret; this function does every read and write, through the same
// shapes and rules the app's own save funnels use. The connector's Google
// account stays Cloud Datastore Viewer.
//
// Guardrails, enforced here on every call (plan §3, docs/DUET-WRITES-PLAN.md
// in the connector repo):
//   • collections: jobs (update only: one item in changeOrders / returnTrips,
//     or the statusUpdate scalar — ship 2; a photo on one item — ship 3; one
//     question in roughQuestions / finishQuestions, one note in jobNotes (+
//     the jobNotesMigratedAt stamp), one entry in roughUpdates /
//     finishUpdates — ship 4; one punch item in roughPunch / finishPunch /
//     qcPunch + its punchTicks.<id> slot + linked returnTrips entries —
//     ship 6), needs (create + update; a photo — ship 3),
//     homeowner_requests/<jobId> (ship 4: the questionThreads.<key> field
//     ONLY — one appended message — plus its versions subcollection, where
//     the writer's own snapshot is added and pruned to 10 exactly as the
//     app's snapshotHomeownerRequestVersion does). Ship 5 adds the first
//     settings docs, each limited to ONE field, listed in SETTINGS_DOCS below
//     and nowhere else: settings/schedule_<Monday YYYY-MM-DD> (the
//     `assignments` map — one cell per call, the FieldValue delete sentinel on the cell
//     when it empties, the planner's own rule), settings/timeOffRequests (the
//     `list` — one entry by id), settings/crewPTO (the `list` — one mirror entry
//     by timeoffId), settings/crewTeams (READ ONLY, team expansion), and
//     needs/toneed_<id> (the head's board task for a request: status / doneBy /
//     doneAt / timeoffDecision through the shared needShape patch). Any other
//     settings doc — settings/users above all — is refused before any read:
//     io.settingsRef throws on an id outside SETTINGS_DOCS. Storage: one object
//     under the app's own jobs/<id>/… photo folders (ship 3), deleted again
//     only when its own transaction failed. Never a delete of data, never a
//     job create, never anything else. The ONLY deletes anywhere in this file
//     are that Storage cleanup, the versions prune, and the planner's own
//     empty-cell the FieldValue delete sentinel (a map key, not a doc).
//   • one item per call; transaction, read-modify-write by id
//   • names checked against settings/users (active, not contractor)
//   • idempotent: duet_writes/<requestId> is the audit doc AND the replay key
//   • 60 writes per rolling hour
//   • audit doc written in the SAME transaction as the change, with the
//     before/after of every field touched (undo material)
//
// Stamp: every write carries the version-lock stamp (integer app_build + a
// fresh w) so versionLock.js counts it as a stamped server write, saved_by
// "Duet (Koy)" for the ledgers and Koy's tripwire push, a non-browser tab so
// no open job tab mistakes it for its own echo, and updated_at strictly newer
// than the doc's (the simproPull freshIso lesson).
// Ship 2 (change orders, return trips, status update): every job write is a
// transaction on jobs/<id> that re-reads the doc, changes ONE item by id in
// data.changeOrders / data.returnTrips (or the statusUpdate scalar), and
// writes that whole array back as a dotted key — what the app's three-way
// merge produces for a baseline that IS the live doc. The app's client-only
// FieldInk mirror (publishCcChangeOrders → cccos) does not run for these
// (plan 9b, accepted); onJobUpdate's pushes (co_new, co_approved,
// rt_assigned) and the versions snapshot fire on their own.
// Ship 3 (photo.add): the first Storage write. The bytes are checked by magic
// number and capped at 7 MB, the item is located on the live doc FIRST (so a
// missing trip never leaves an orphan file), the object is saved to the same
// Storage folder the app's own uploader uses for that item with a Firebase
// download token, and ONE transaction re-reads the doc, appends the entry to
// that item's photos[] and audits — entry under `after`, never the bytes. If
// the transaction refuses or fails after the upload, the just-uploaded object
// (and only that object) is deleted again.
// Ship 4 (questions, job notes, daily updates): nine more job writes through
// the same jobWrite() transaction — QAList.addQuestion / My Day's Save answer
// and Done / the QAList un-tick on one question found by id across the three
// floors; addNote / addLine / a line edit / archive / soft delete on one job
// note, with the app's own migration materialized (functions/jobNotesShape.js,
// a byte copy of src/jobNotesShape.js) and jobNotesMigratedAt stamped the
// first time, exactly as JobDetail u() does; DailyUpdates.add prepended — and
// ONE write on homeowner_requests/<jobId> (question.reply) copying
// postQuestionThreadMessage: the thread key "<phase>_<floor>_<qid>", a
// first-ever doc set, otherwise the one dotted questionThreads.<key> updated,
// then the versions snapshot pruned to 10. Answers go through the app's own
// escapeHtml (functions/escapeHtml.js, a byte copy of src/escapeHtml.js).
// Ship 5 (crews, job people, time off): crew.assign / crew.unassign /
// crew.setLead copy the Crew Planner's assignPerson / unassignPerson /
// assignTeam / crewToggleLead onto ONE cell of settings/schedule_<Monday>
// (the date resolved to its Monday + weekday, Mon–Fri only; a missing week doc
// created with the app's own first-write shape); job.setPeople is one
// foreman / lead / coordinator scalar through jobWrite(), "Unassigned" the
// app's foreman sentinel; timeOff.decide makes TimeOffPage.decide's three
// writes in ONE transaction — the request entry by id in
// settings/timeOffRequests.list, the head's needs/toneed_<id> through the
// shared needShape patch (skipped when missing, as the app does), the PTO
// mirror in settings/crewPTO.list added once on approve and pulled otherwise —
// and refuses to change a decided request without force:true. The app's own
// triggers (job_assigned / lead_assigned, onTimeOffDecision) push on their own.
// Ship 6 (punch items): seven more jobWrite() actions, all on ONE item of ONE
// punch tree (data.roughPunch / finishPunch / qcPunch) found by id across
// upper / main / basement / extras floors and general / hotcheck / rooms, the
// tree written back whole in the app's own handleFloorChange shape (every
// floor normalized, extras kept). punch.setDone flips exactly as the checkbox
// does AND writes the item's own check-off slot data.punchTicks.<id> (derived
// by the app's punchTickPatches — the slot is the record of truth) AND, for
// rough / finish, mirrors the flip onto linked return-trip entries as
// handlePhasePunchChange does — all in the one transaction. punch.add appends
// commitAdd's item (text through the app's escapeHtml, Mountain-time YMD
// stamp), creating a room when the name is new and fanning that room out
// EMPTY to the other phase as fanOutAddedRooms does; punch.assign / waiting /
// editText patch one field set; punch.void (QC-walk items only, reason
// required) strips the item's clones from open QC-Fail trips in the same
// write, punch.restore clears the four void fields. Never a delete of an item.
const crypto = require("crypto");
const { planCreateTask, planUpdateTask, isDuplicate } = require("./needs.js");
const JI = require("./jobItems.js");
const PH = require("./photos.js");
const QS = require("./questions.js");
const NU = require("./notesUpdates.js");
const CR = require("./crew.js");
const TO = require("./timeOff.js");
const PU = require("./punch.js");

const SECRET = "DUET_WRITE_TOKEN";
const BUILD = 605;                 // SW version this shipped with; integer for the version-lock stamp
const SAVED_BY = "Duet (Koy)";
const RATE_PER_HOUR = 60;
const AUDIT = "duet_writes";
const QUESTION_ACTIONS = ["question.add", "question.answer", "question.reopen"];
const NOTE_ACTIONS = ["note.add", "note.addLine", "note.editLine", "note.archive", "note.delete", "dailyUpdate.add"];
const PEOPLE_ACTIONS = ["job.setPeople"];
const PUNCH_ACTIONS = ["punch.setDone", "punch.add", "punch.assign", "punch.waiting", "punch.void", "punch.restore", "punch.editText"];
const JOB_ACTIONS = ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"];
const JOB_WRITE_ACTIONS = [...JOB_ACTIONS, ...QUESTION_ACTIONS, ...NOTE_ACTIONS, ...PEOPLE_ACTIONS, ...PUNCH_ACTIONS];   // every action that is ONE jobWrite() transaction
const PHOTO_ACTIONS = ["photo.add"];
const THREAD_ACTIONS = ["question.reply"];
const CREW_ACTIONS = ["crew.assign", "crew.unassign", "crew.setLead"];
const TIMEOFF_ACTIONS = ["timeOff.decide"];
const ACTIONS = ["task.create", "task.update", ...JOB_WRITE_ACTIONS, ...PHOTO_ACTIONS, ...THREAD_ACTIONS, ...CREW_ACTIONS, ...TIMEOFF_ACTIONS];
const NEED_ID = /^need_[0-9]+_[a-z0-9]{3,8}$|^toneed_/;
const JOB_ID = /^\d{10,15}$/;
const RID = /^[A-Za-z0-9_-]{8,64}$/;
const SCHEDULE_DOC = /^schedule_\d{4}-\d{2}-\d{2}$/;

// The ONLY settings docs this function may open, and the one field it may write
// on each (plan §3 item 1, ship 5 rows). Anything else — settings/users above
// all — is refused before any read. Edited only with a row in the plan.
const SETTINGS_DOCS = { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: [] /* read only */ };
function settingsDocFields(id) {
  const s = String(id || "");
  if (Object.prototype.hasOwnProperty.call(SETTINGS_DOCS, s)) return SETTINGS_DOCS[s];
  if (SCHEDULE_DOC.test(s)) return ["assignments"];
  return null;
}
const settingsDocAllowed = (id) => settingsDocFields(id) !== null;

class Refusal extends Error { constructor(status, why) { super(why); this.status = status; } }

function tokenOk(req) {
  const want = String(process.env[SECRET] || "");
  const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (want.length < 32 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function freshIso(prevIso) {
  // Strictly after the doc's own updated_at, so an open tab re-seeds instead of
  // keeping an older baseline (functions/materialPO/simproPull.js, same rule).
  let t = Date.now();
  const prev = Date.parse(prevIso || "");
  if (!isNaN(prev) && t <= prev) t = prev + 1;
  return new Date(t).toISOString();
}
function stamp(requestId, updatedAt) {
  return { updated_at: updatedAt, saved_by: SAVED_BY, device: "duet", tab: `duet-${String(requestId).slice(0, 8)}`, app_build: BUILD, w: `${BUILD}.duet${Math.random().toString(36).slice(2, 10)}` };
}

// The app's sanitize(): drop undefined values before a Firestore write.
function dropUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(dropUndefined);
  if (obj && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, dropUndefined(v)]));
  return obj;
}

// io: { nowIso(), todayYmd(), getAudit(id), countRecent(sinceIso), getJob(id), getUsers(),
//       openNeeds({jobId, assignedTo}), runTx(fn), needRef(id), jobRef(id), auditRef(id),
//       arrayUnion(...x), serverTimestamp(), rand(), tz }

// One job write, the same way for every ship-2 action: re-read the job in the
// transaction, plan against the live copy, write the dotted data.<field> keys
// with the job envelope the app's saveJob patch carries (updated_at strictly
// newer, lastActivityAt, saved_by / device / tab, version-lock stamp,
// merged:false) and the audit doc in the same transaction. `plan(job)` returns
// {refused} | {noop, result} | {fields:{<field>: value}, before:{<field>: value},
// after:{<field>: value}, itemId, result:{...}}.
async function jobWrite(io, requestId, action, jobId, plan, finish) {
  let out = null;
  await io.runTx(async (tx) => {
    const snap = await tx.get(io.jobRef(jobId));
    const raw = snap && snap.exists ? snap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const p = plan(job);
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, coll: "jobs", docId: jobId }); tx.set(io.auditRef(requestId), out.audit); return; }
    if (p.noop) { out = finish(200, { ok: true, requestId, action, jobId, jobName: job.data.name || "", noop: true, message: "Already that way — nothing to change.", ...(p.result || {}) }, { ok: true, noop: true, coll: "jobs", docId: jobId, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(raw.updated_at);
    const upd = { ...stamp(requestId, updatedAt), lastActivityAt: io.serverTimestamp(), merged: false };
    Object.keys(p.fields).forEach(k => { upd["data." + k] = p.fields[k]; });
    tx.update(io.jobRef(jobId), upd);
    const result = { ok: true, requestId, action, jobId, jobName: job.data.name || "", ...p.result };
    out = finish(200, result, { ok: true, coll: "jobs", docId: jobId, fields: Object.keys(p.fields), itemId: p.itemId || null, before: p.before, after: p.after });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return out;
}

// Each ship-2 planner → the fields to write + what to audit and answer.
// Audits keep the ONE item before/after (not the whole array): that is the
// undo material, and photos make arrays big.
function planJobAction(action, args, ctx) {
  return (job) => {
    const c = { ...ctx, job };
    switch (action) {
      case "co.create": {
        const p = JI.planCreateCO(args, c); if (p.refused) return p;
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: null }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, desc: p.co.desc, coStatus: p.co.coStatus, createdBy: p.co.createdBy, pushTo: ["foreman", "coordinator", "Jeromy"] } };
      }
      case "co.edit": {
        const p = JI.planEditCO(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { coId: p.co.id } };
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: p.before }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, changed: p.changed } };
      }
      case "co.setStatus": {
        const p = JI.planSetCOStatus(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { coId: p.co.id, coStatus: p.co.coStatus } };
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: p.before }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, from: p.from, to: p.to, coStatusDate: p.co.coStatusDate, changed: p.changed, pushTo: p.to === "approved" ? ["lead", "foreman", "coordinator"] : [] } };
      }
      case "co.convert": {
        const p = JI.planConvertCO(args, c); if (p.refused) return p;
        return { fields: { changeOrders: p.changeOrders, returnTrips: p.returnTrips }, before: { changeOrders: p.before, returnTrips: null }, after: { changeOrders: p.co, returnTrips: p.rt }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, rtId: p.rt.id, rtNumber: p.returnTrips.length, scope: p.rt.scope, photosCarried: p.rt.photos.length } };
      }
      case "rt.create": {
        const p = JI.planCreateRT(args, c); if (p.refused) return p;
        return { fields: { returnTrips: p.returnTrips }, before: { returnTrips: null }, after: { returnTrips: p.rt }, itemId: p.rt.id,
          result: { rtId: p.rt.id, number: p.number, scope: p.rt.scope, rtStatus: p.rt.rtStatus || "", rtStatusDate: p.rt.rtStatusDate || "", assignedTo: p.rt.assignedTo || "", pushTo: p.rt.assignedTo && p.rt.assignedTo !== "Unassigned" ? p.rt.assignedTo : null } };
      }
      case "rt.update": {
        const p = JI.planUpdateRT(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { rtId: p.rt.id } };
        return { fields: { returnTrips: p.returnTrips }, before: { returnTrips: p.before }, after: { returnTrips: p.rt }, itemId: p.rt.id,
          result: { rtId: p.rt.id, number: p.number, changed: p.changed, rtStatus: p.rt.rtStatus || "", rtStatusDate: p.rt.rtStatusDate || "", assignedTo: p.rt.assignedTo || "", pushTo: p.pushTo } };
      }
      case "job.setStatusUpdate": {
        const p = JI.planSetStatusUpdate(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { statusUpdate: p.statusUpdate } };
        return { fields: p.fields, before: p.before, after: { ...p.fields }, result: { statusUpdate: p.fields.statusUpdate, statusUpdateBy: p.fields.statusUpdateBy, changed: p.changed, historyLength: Array.isArray(p.fields.statusUpdateHistory) ? p.fields.statusUpdateHistory.length : undefined } };
      }
      // ── Ship 4 ─────────────────────────────────────────────────────────────
      case "question.add": {
        const p = QS.planAddQuestion(args, c); if (p.refused) return p;
        return { fields: { [p.field]: p.questions }, before: { [p.field]: null }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, question: p.q.question, for: p.q.for, room: p.q.room || "", pushTo: ["foreman", "coordinator"] } };
      }
      case "question.answer": {
        const p = QS.planAnswerQuestion(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { qId: p.q.id, floor: p.floor, number: p.number, done: true } };
        return { fields: { [p.field]: p.questions }, before: { [p.field]: p.before }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, changed: p.changed, done: p.q.done, answeredBy: p.q.answeredBy || "", answeredVia: p.q.answeredVia || "", pushTo: [] } };
      }
      case "question.reopen": {
        const p = QS.planReopenQuestion(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { qId: p.q.id, floor: p.floor, number: p.number, done: false } };
        return { fields: { [p.field]: p.questions }, before: { [p.field]: p.before }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, changed: p.changed, done: false, gcRejected: !!p.patch.gcRejected, pushTo: [] } };
      }
      case "note.add": {
        const p = NU.planAddNote(args, c); if (p.refused) return p;
        const stamped = Object.prototype.hasOwnProperty.call(p.fields, "jobNotesMigratedAt");
        return { fields: p.fields, before: { jobNotes: null, ...(stamped ? { jobNotesMigratedAt: null } : {}) }, after: { jobNotes: p.note, ...(stamped ? { jobNotesMigratedAt: p.fields.jobNotesMigratedAt } : {}) }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.note.lines[0].id, number: p.number, title: p.note.title, phase: p.note.phase, migratedLegacyNotes: p.migrated, notesOnJob: p.fields.jobNotes.length, pushTo: [] } };
      }
      case "note.addLine": {
        const p = NU.planAddLine(args, c); if (p.refused) return p;
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.line.id, number: p.number, lines: p.note.lines.length, pushTo: [] } };
      }
      case "note.editLine": {
        const p = NU.planEditLine(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { noteId: p.note.id, lineId: p.line.id, number: p.number } };
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.line.id, number: p.number, text: p.line.text, pushTo: [] } };
      }
      case "note.archive": {
        const p = NU.planArchiveNote(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { noteId: p.note.id, number: p.number, archived: !!p.note.archived } };
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, number: p.number, archived: !!p.note.archived, pushTo: [] } };
      }
      case "note.delete": {
        const p = NU.planDeleteNote(args, c); if (p.refused) return p;
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, number: p.number, deleted: true, softDelete: true, promotedLinesKept: p.promotedLines, pushTo: [] } };
      }
      case "dailyUpdate.add": {
        const p = NU.planAddDailyUpdate(args, c); if (p.refused) return p;
        return { fields: { [p.field]: p.updates }, before: { [p.field]: null }, after: { [p.field]: p.entry }, itemId: p.entry.id,
          result: { updateId: p.entry.id, phase: args.phase, date: p.entry.date, number: p.number, text: p.entry.text, pushTo: ["coordinator"] } };
      }
      // ── Ship 5 ─────────────────────────────────────────────────────────────
      case "job.setPeople": {
        // u({foreman}) / u({lead}) / u({coordinator}): ONE scalar; onJobUpdate's
        // job_assigned / lead_assigned pushes follow on their own.
        const p = CR.planSetPeople(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { field: p.field, [p.field]: p.name } };
        return { fields: p.fields, before: p.before, after: p.after,
          result: { field: p.field, from: p.from, to: p.to, [p.field]: p.to, pushTo: p.pushTo } };
      }
      // ── Ship 6 ─────────────────────────────────────────────────────────────
      // Each planner already answers in jobWrite's shape ({refused} | {noop,
      // result} | {fields, before, after, itemId, result}); the fields are the
      // whole tree as data.<phase>Punch, plus data.punchTicks.<id> (the slot,
      // dotted — never the whole map) and data.returnTrips when a done flip
      // cascaded or a void stripped clones. Audits keep the ONE item (and the
      // touched trip entries) before / after, never the tree.
      case "punch.setDone": return PU.planSetDone(args, c);
      case "punch.add": return PU.planAdd(args, c);
      case "punch.assign": return PU.planAssign(args, c);
      case "punch.waiting": return PU.planWaiting(args, c);
      case "punch.void": return PU.planVoid(args, c);
      case "punch.restore": return PU.planRestore(args, c);
      case "punch.editText": return PU.planEditText(args, c);
      default: return { refused: "unknown action" };
    }
  };
}

// Ship 4: ONE reply on a question's discussion thread — postQuestionThreadMessage
// line for line, on homeowner_requests/<jobId> (never the job doc: the Kweller
// rule for outside-party data). The job is read in the same transaction only
// to find the question (its floor is part of the key); the thread doc is read
// under lock, the one dotted questionThreads.<key> written (a first-ever doc
// is set whole, as the app does), the audit doc rides along, and AFTER the
// write the app's versions snapshot is taken and pruned to 10 — best effort,
// never blocking, exactly snapshotHomeownerRequestVersion's fail-open.
async function threadReply(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "homeowner_requests" });
  let out = null, prevDoc = null, wrote = false;
  await io.runTx(async (tx) => {
    const jsnap = await tx.get(io.jobRef(jobId));
    const raw = jsnap && jsnap.exists ? jsnap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const p = QS.planThreadReply(args, { ...ctx, job });
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, coll: "homeowner_requests", docId: jobId }); tx.set(io.auditRef(requestId), out.audit); return; }
    const hsnap = await tx.get(io.hrRef(jobId));
    prevDoc = hsnap && hsnap.exists ? hsnap.data() : null;
    const w = QS.threadAppend(prevDoc, jobId, p.key, p.msg);
    if (w.set) tx.set(io.hrRef(jobId), w.set); else tx.update(io.hrRef(jobId), w.update);
    wrote = true;
    const result = { ok: true, requestId, action, jobId, jobName: job.data.name || "", qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, key: p.key, messageId: w.msg.id, messagesInThread: w.count, role: w.msg.role, newThreadDoc: !!w.set, pushTo: [] };
    out = finish(200, result, { ok: true, coll: "homeowner_requests", docId: jobId, itemId: p.q.id, fields: ["questionThreads." + p.key], before: { questionThreads: { [p.key]: { messages: w.before } } }, after: { questionThreads: { [p.key]: w.msg } }, newDoc: !!w.set });
    tx.set(io.auditRef(requestId), out.audit);
  });
  if (wrote) {
    let snapped = false;
    try { snapped = await io.snapshotHrVersion(jobId, prevDoc, "duet", ctx.nowIso); } catch (e) { snapped = false; }
    out.body.versionSnapshot = snapped;
  }
  return { status: out.status, body: out.body };
}
// Ship 3: ONE photo onto ONE item. Order matters for "never an orphan file":
//   1. bytes checked (magic number, 7 MB, name cleaned) — nothing read yet;
//   2. the live doc is read and the item located (missing / archived /
//      signed-off / converted / voided refuse here, before any upload);
//   3. the object is saved under the app's own folder for that item with a
//      Firebase download token → the app's download URL;
//   4. ONE transaction re-reads the doc, locates the item again, appends the
//      entry to its photos[] (job: whole array / punch tree as the dotted
//      field with the job envelope; task: ONE arrayUnion on data.photos like
//      addNeedPhotos) and writes the audit doc with the entry under `after`;
//   5. a refusal inside the transaction, or any failure after the upload,
//      deletes the object just written — and only that object.
// args: { target: rt|co|punch|task, jobId (not for task), itemId, name, data (base64) }
async function photoAdd(io, requestId, args, ctx, finish, refused) {
  const target = String(args.target || "");
  if (!PH.TARGETS.includes(target)) return refused(400, `target must be one of ${PH.TARGETS.join(", ")}.`, { coll: target === "task" ? "needs" : "jobs" });
  const coll = target === "task" ? "needs" : "jobs";
  const itemId = String(args.itemId || "");
  let docId;
  if (target === "task") {
    if (!NEED_ID.test(itemId)) return refused(400, "itemId must be the task's needId (need_…).", { coll });
    docId = itemId;
  } else {
    docId = String(args.jobId || "");
    if (!JOB_ID.test(docId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(itemId)) return refused(400, "itemId must be the item's id (from cc_list_return_trips, cc_list_change_orders or cc_get_job punch).", { coll });
  }
  const photo = PH.decodePhoto(args);
  if (photo.refused) return refused(400, photo.refused, { coll, docId });

  // Locate on the live doc before uploading anything.
  const ref = target === "task" ? io.needRef(docId) : io.jobRef(docId);
  const raw0 = await io.readDoc(ref);
  const doc0 = raw0 && raw0.data ? { id: docId, data: raw0.data } : null;
  const loc = PH.locate(target, itemId, doc0);
  if (loc.refused) return refused(doc0 ? 400 : 404, loc.refused, { coll, docId, itemId });
  const nowMs = Date.parse(ctx.nowIso);
  const photoId = PH.newPhotoId(target, nowMs, loc.photos.map(p => p && p.id), ctx.rand);
  const storagePath = `${loc.folder}/${photoId}.${photo.ext}`;
  const token = io.newToken();
  const url = await io.putObject(storagePath, photo.buf, photo.type, token);
  const entry = PH.photoEntry(target, { photoId, name: photo.name, url, storagePath, type: photo.type, nowIso: ctx.nowIso });
  const auditBase = { coll, docId, itemId, storagePath, bytes: photo.size, contentType: photo.type };

  let out = null;
  try {
    await io.runTx(async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap && snap.exists ? snap.data() : null;
      const doc = raw && raw.data ? { id: docId, data: raw.data } : null;
      const p = PH.planAttach(target, itemId, entry, doc);
      if (p.refused) { out = finish(doc ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase, cleanedUp: true }); out.cleanup = true; tx.set(io.auditRef(requestId), out.audit); return; }
      const updatedAt = freshIso(raw.updated_at);
      const result = { ok: true, requestId, action: "photo.add", target, itemId, photoId, name: photo.name, type: photo.type, bytes: photo.size, storagePath, photosOnItem: p.photosNow, on: p.label };
      if (p.kind === "need") {
        // addNeedPhotos: stampWrite({ updated_at, saved_by, "data.photos": arrayUnion(entry) }) — never the whole array.
        tx.update(ref, { ...stamp(requestId, updatedAt), "data.photos": io.arrayUnion(entry) });
        Object.assign(result, { needId: docId, jobId: p.jobId });
        out = finish(200, result, { ok: true, ...auditBase, fields: ["photos"], before: p.before, after: p.after });
      } else {
        const upd = { ...stamp(requestId, updatedAt), lastActivityAt: io.serverTimestamp(), merged: false };
        Object.keys(p.fields).forEach(k => { upd["data." + k] = p.fields[k]; });
        tx.update(ref, upd);
        Object.assign(result, { jobId: docId, jobName: doc.data.name || "", field: p.field, number: p.number });
        out = finish(200, result, { ok: true, ...auditBase, fields: Object.keys(p.fields), before: p.before, after: p.after });
      }
      tx.set(io.auditRef(requestId), out.audit);
    });
  } catch (e) {
    await io.deleteObject(storagePath).catch(() => {});
    throw e;
  }
  if (out.cleanup) await io.deleteObject(storagePath).catch(() => {});
  return { status: out.status, body: out.body };
}

// The app's settings stamp (mergeSaveSettingsFields): {updatedAt, tab, merged}.
// A missing doc is set with the fields plus the stamp, exactly as the app does.
function settingsStamp(requestId, updatedAt) { return { updatedAt, tab: `duet-${String(requestId).slice(0, 8)}`, merged: false }; }

// Ship 5: ONE Crew Planner cell. In one transaction: the job (live, must exist
// and not be archived), the week doc settings/schedule_<Monday>, crewTeams when
// a team is named (read only) and crewPTO (read only — the planner refuses a
// person who is off that day). The planner's mutator runs against the live
// cell; the write is that ONE cell as FieldPath("assignments", key) — the cell
// object, or the FieldValue delete sentinel when unassigning emptied it (unassignPerson's
// `delete nx[k]`) — plus the settings stamp. A week doc that doesn't exist yet
// is created as {assignments:{[key]:cell}, …stamp}, the shape the app's first
// _saveCrewData gives it. Nothing else on the doc is read into the write.
async function crewCell(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "settings" });
  const op = action.slice("crew.".length);
  const date = args.date == null || args.date === "" ? ctx.todayYmd : String(args.date);
  const wk = CR.weekFor(date);
  if (wk.refused) return refused(400, wk.refused, { coll: "settings" });
  if (!settingsDocAllowed(wk.docId)) return refused(400, "That week isn't a Crew Planner week.", { coll: "settings" });
  let out = null;
  await io.runTx(async (tx) => {
    const jsnap = await tx.get(io.jobRef(jobId));
    const raw = jsnap && jsnap.exists ? jsnap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const wsnap = await tx.get(io.settingsRef(wk.docId));
    const week = wsnap && wsnap.exists ? wsnap.data() : null;
    let teams = null;
    if (args.team != null && args.team !== "") { const ts = await tx.get(io.settingsRef("crewTeams")); teams = ts && ts.exists ? ((ts.data() || {}).teams || []) : []; }
    const ps = await tx.get(io.settingsRef("crewPTO"));
    const pto = ps && ps.exists ? ((ps.data() || {}).list || []) : [];
    const p = CR.planCrewCell({ ...args, op, date }, { ...ctx, job, week, teams, pto });
    const auditBase = { coll: "settings", docId: wk.docId, jobId, key: p.key || CR.cellKey(jobId, wk.dayIdx), date, monday: wk.monday, dayIdx: wk.dayIdx };
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const common = { requestId, action, jobId, jobName: job.data.name || "", week: wk.monday, day: wk.label, date, key: p.key, people: p.people, team: p.team || undefined };
    if (p.noop) { out = finish(200, { ok: true, ...common, noop: true, message: (p.result && p.result.message) || "Already that way — nothing to change.", cell: p.before }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(week ? week.updatedAt : "");
    const st = settingsStamp(requestId, updatedAt);
    if (!week) {
      if (!p.cell) { out = finish(200, { ok: true, ...common, noop: true, message: "Nobody is on that cell.", cell: null }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
      tx.set(io.settingsRef(wk.docId), { assignments: { [p.key]: p.cell }, ...st });
    } else {
      tx.update(io.settingsRef(wk.docId), io.fieldPath("assignments", p.key), p.cell ? p.cell : io.deleteField(), "updatedAt", st.updatedAt, "tab", st.tab, "merged", st.merged);
    }
    const result = { ok: true, ...common, cell: p.cell, cellDeleted: !!p.deleted, role: p.role || undefined, previousLead: p.previousLead || undefined, skippedOff: p.skippedOff && p.skippedOff.length ? p.skippedOff : undefined, newWeekDoc: !week, pushTo: [] };
    out = finish(200, dropUndefined(result), { ok: true, ...auditBase, fields: ["assignments." + p.key], before: p.before, after: p.cell, cellDeleted: !!p.deleted, newDoc: !week });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Ship 5: ONE time-off decision — TimeOffPage.decide's three writes in ONE
// transaction (all three docs live in this project). Reads first: the request
// list, the head's board task needs/toneed_<id>, the PTO list. Then: the list
// written back whole with the one entry changed (+ settings stamp); the need's
// dotted data.<k> keys through the shared patch with the job-style envelope
// (skipped silently when the doc is missing, as the app's catch does); the
// PTO list written back only when it changed (set with the stamp when the doc
// doesn't exist yet, as mergeSaveSettingsFields does). onTimeOffDecision sends
// the requester's push from the list diff on its own.
async function timeOffDecide(io, requestId, action, args, ctx, finish, refused) {
  const id = String(args.id || "").trim();
  if (!/^to_[a-z0-9]{6,24}$/i.test(id)) return refused(400, "id must be the request's id from cc_list_time_off (to_…).", { coll: "settings", docId: "timeOffRequests" });
  const needId = "toneed_" + id;
  let out = null;
  await io.runTx(async (tx) => {
    const rs = await tx.get(io.settingsRef("timeOffRequests"));
    const reqDoc = rs && rs.exists ? rs.data() : null;
    const ns = await tx.get(io.needRef(needId));
    const needRaw = ns && ns.exists ? ns.data() : null;
    const need = needRaw && needRaw.data ? needRaw.data : null;
    const ps = await tx.get(io.settingsRef("crewPTO"));
    const ptoDoc = ps && ps.exists ? ps.data() : null;
    const p = TO.planDecide(args, { ...ctx, requests: reqDoc ? (Array.isArray(reqDoc.list) ? reqDoc.list : []) : null, need, pto: ptoDoc ? ptoDoc.list : null });
    const auditBase = { coll: "settings", docId: "timeOffRequests", itemId: id, docs: ["settings/timeOffRequests", "needs/" + needId, "settings/crewPTO"] };
    if (p.refused) { out = finish(400, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const common = { requestId, action, id, name: p.request.name || "", start: p.request.start || "", end: p.request.end || p.request.start || "", status: p.request.status };
    if (p.noop) { out = finish(200, { ok: true, ...common, noop: true, message: p.result.message }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    // (a) the request list
    const st = settingsStamp(requestId, freshIso(reqDoc.updatedAt));
    tx.update(io.settingsRef("timeOffRequests"), { list: p.requestsList, ...st });
    // (b) the head's board task — patchNeed's write: stampWrite({updated_at, saved_by, "data.<k>": v})
    if (p.needFields) {
      const upd = { ...stamp(requestId, freshIso(needRaw.updated_at)) };
      Object.keys(p.needFields).forEach(k => { upd["data." + k] = p.needFields[k]; });
      tx.update(io.needRef(needId), upd);
    }
    // (c) the PTO mirror
    if (p.ptoList) {
      if (ptoDoc) tx.update(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, freshIso(ptoDoc.updatedAt)) });
      else tx.set(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, ctx.nowIso) });
    }
    const result = { ok: true, ...common, from: p.from, decidedBy: p.request.decidedBy, decidedAt: p.request.decidedAt, needUpdated: !!p.needFields, needStatus: p.needFields ? p.needFields.status : null, ptoAdded: !!p.ptoAdded, ptoRemoved: p.ptoRemoved, usePaid: p.request.usePaid !== false, pushTo: p.pushTo };
    const fields = ["timeOffRequests.list"].concat(p.needFields ? Object.keys(p.needFields).map(k => "needs/" + needId + ".data." + k) : []).concat(p.ptoList ? ["crewPTO.list"] : []);
    out = finish(200, result, { ok: true, ...auditBase, fields, before: p.before, after: p.after, needMissing: !need });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

async function handle(body, io) {
  const b = body && typeof body === "object" ? body : {};
  const requestId = String(b.requestId || "");
  if (!RID.test(requestId)) throw new Refusal(400, "requestId must be 8–64 letters, digits, - or _.");
  if (!ACTIONS.includes(b.action)) throw new Refusal(400, `action must be one of ${ACTIONS.join(", ")}.`);
  const args = b.args && typeof b.args === "object" ? b.args : {};
  const email = String(b.email || "").slice(0, 120);

  // Same requestId → same answer, nothing written twice.
  const prior = await io.getAudit(requestId);
  if (prior && prior.response) return { status: prior.response.status || 200, body: { ...prior.response.body, replayed: true } };

  const nowIso = io.nowIso();
  const recent = await io.countRecent(new Date(Date.parse(nowIso) - 3600 * 1000).toISOString());
  if (recent >= RATE_PER_HOUR) throw new Refusal(429, `Duet has made ${recent} changes in the last hour — the limit is ${RATE_PER_HOUR}. Try again later.`);

  const todayYmd = io.todayYmd();
  const ctx = { nowIso, todayYmd, bucketNow: `${todayYmd}T12:00:00`, users: await io.getUsers(), rand: io.rand ? io.rand() : undefined, tz: io.tz };
  const base = { at: nowIso, action: b.action, by: SAVED_BY, email, requestId, expireAt: new Date(Date.parse(nowIso) + 90 * 86400 * 1000).toISOString() };
  const finish = (status, bodyOut, auditExtra) => ({ status, body: bodyOut, audit: { ...base, ...auditExtra, response: { status, body: bodyOut } } });

  // A refusal that is about THIS request (bad input, missing doc, duplicate) is
  // deterministic, so it is audited and replays the same way. 401/429/500 never are.
  const refused = async (status, why, extra) => {
    const r = finish(status, { ok: false, refused: why }, { ok: false, why, ...(extra || {}) });
    await io.runTx(async (tx) => { tx.set(io.auditRef(requestId), r.audit); });
    return { status: r.status, body: r.body };
  };

  if (b.action === "task.create") {
    const jobId = args.jobId ? String(args.jobId) : "";
    const job = jobId ? await io.getJob(jobId) : null;
    ctx.job = job;
    const plan = planCreateTask(args, ctx);
    if (plan.refused) return refused(jobId && !job ? 404 : 400, plan.refused, { coll: "needs" });
    const need = plan.need;
    const open = await io.openNeeds({ jobId: need.jobId, assignedTo: need.assignedTo });
    if (isDuplicate(need, open, nowIso)) return refused(409, `An open task with the same words for ${need.assignedTo}${need.jobName ? ` on ${need.jobName}` : ""} was created in the last 10 minutes — not adding it twice.`, { coll: "needs" });
    const envelope = { data: need, ...stamp(requestId, nowIso) };   // saveNeed: stampWrite({data, updated_at, saved_by})
    const result = { ok: true, requestId, action: b.action, needId: need.id, text: need.text, kind: need.kind, assignedTo: need.assignedTo, dueBucket: need.dueBucket, dueDate: need.dueDate, priority: need.priority, jobId: need.jobId, jobName: need.jobName, pushTo: need.assignedTo !== need.assignedBy ? need.assignedTo : null };
    const r = finish(200, result, { ok: true, coll: "needs", docId: need.id, fields: Object.keys(need), before: null, after: need });
    try {
      await io.runTx(async (tx) => {
        tx.create(io.needRef(need.id), envelope);   // create-only: a second write to this id fails the transaction
        tx.set(io.auditRef(requestId), r.audit);
      });
    } catch (e) {
      if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")))) return refused(409, "That task id already exists. Nothing was written.", { coll: "needs", docId: need.id });
      throw e;
    }
    return { status: 200, body: result };
  }

  if (JOB_WRITE_ACTIONS.includes(b.action)) {
    const jobId = String(args.jobId || "");
    if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "jobs" });
    const r = await jobWrite(io, requestId, b.action, jobId, planJobAction(b.action, args, ctx), finish);
    return { status: r.status, body: r.body };
  }

  if (b.action === "photo.add") {
    const r = await photoAdd(io, requestId, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (THREAD_ACTIONS.includes(b.action)) {
    const r = await threadReply(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (CREW_ACTIONS.includes(b.action)) {
    const r = await crewCell(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (TIMEOFF_ACTIONS.includes(b.action)) {
    const r = await timeOffDecide(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  // task.update
  const needId = String(args.needId || "");
  if (!NEED_ID.test(needId)) return refused(400, "needId must be a task id like need_1730650000001_ab12c.", { coll: "needs" });
  let out = null;
  await io.runTx(async (tx) => {
    const snap = await tx.get(io.needRef(needId));
    const raw = snap && snap.exists ? snap.data() : null;
    const current = raw && raw.data ? raw.data : null;
    const plan = planUpdateTask(args, current, ctx);
    if (plan.refused) { out = finish(current ? 400 : 404, { ok: false, refused: plan.refused }, { ok: false, why: plan.refused, coll: "needs", docId: needId }); tx.set(io.auditRef(requestId), out.audit); return; }
    if (plan.noop) { out = finish(200, { ok: true, requestId, action: b.action, needId, noop: true, message: "Already that way — nothing to change." }, { ok: true, noop: true, coll: "needs", docId: needId, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(raw.updated_at);
    const upd = { ...stamp(requestId, updatedAt) };            // patchNeed: stampWrite({updated_at, saved_by, "data.<k>": v})
    const before = {}, after = {};
    Object.keys(plan.fields).forEach(k => { upd["data." + k] = plan.fields[k]; before[k] = current[k] === undefined ? null : current[k]; after[k] = plan.fields[k]; });
    if (plan.entry) { upd["data.updates"] = io.arrayUnion(plan.entry); after.updatesAdded = plan.entry; }
    tx.update(io.needRef(needId), upd);
    const result = { ok: true, requestId, action: b.action, needId, changed: Object.keys(plan.fields), note: plan.entry ? plan.entry.kind : null, assignedTo: plan.fields.assignedTo || current.assignedTo || "", status: plan.fields.status || current.status || "open" };
    out = finish(200, result, { ok: true, coll: "needs", docId: needId, fields: Object.keys(plan.fields).concat(plan.entry ? ["updates"] : []), before, after });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Real Firestore + Storage io. Admin SDK: tx.create fails with ALREADY_EXISTS
// (code 6). Storage: the app's bucket (src/App.js storageBucket), objects saved
// with a Firebase download token in their custom metadata so the URL the app
// gets from getDownloadURL() and the one built here are the same string.
function firestoreIo({ db, FieldValue, FieldPath, getUsers, TZ, storage }) {
  const bucket = storage ? storage.bucket(PH.BUCKET) : null;
  return {
    // Ship 5: the ONLY way this file opens a settings doc. An id outside
    // SETTINGS_DOCS (settings/users above all) throws before any read.
    settingsRef: (id) => {
      if (!settingsDocAllowed(id)) throw new Refusal(400, `settings/${String(id).slice(0, 40)} is not a document Duet may touch. Nothing was read or written.`);
      return db.collection("settings").doc(String(id));
    },
    fieldPath: (...segs) => { if (!FieldPath) throw new Error("FieldPath is not wired into duetApi."); return new FieldPath(...segs); },
    deleteField: () => FieldValue.delete(),
    readDoc: async (ref) => { const s = await ref.get(); return s.exists ? s.data() : null; },
    newToken: () => crypto.randomUUID(),
    putObject: async (path, buf, contentType, token) => {
      if (!bucket) throw new Error("Storage is not wired into duetApi.");
      await bucket.file(path).save(buf, { resumable: false, contentType, metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } } });
      return PH.downloadUrl(bucket.name, path, token);
    },
    deleteObject: async (path) => { if (bucket) await bucket.file(path).delete({ ignoreNotFound: true }); },
    nowIso: () => new Date().toISOString(),
    todayYmd: () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }),
    rand: () => Math.random().toString(36).slice(2, 7),
    getAudit: async (id) => { const s = await db.collection(AUDIT).doc(id).get(); return s.exists ? s.data() : null; },
    countRecent: async (sinceIso) => { const s = await db.collection(AUDIT).where("at", ">", sinceIso).count().get(); return s.data().count || 0; },
    getJob: async (id) => { const s = await db.collection("jobs").doc(id).get(); const d = s.exists ? (s.data() || {}).data : null; return d ? { id, name: d.name || "", foreman: d.foreman || "", archived: !!d.archived, deleted: !!d.deleted } : null; },
    getUsers,
    openNeeds: async ({ jobId, assignedTo }) => {
      let q = db.collection("needs").where("data.status", "==", "open");
      q = jobId ? q.where("data.jobId", "==", jobId) : q.where("data.assignedTo", "==", assignedTo);
      const s = await q.limit(200).get();
      return s.docs.map(d => (d.data() || {}).data).filter(Boolean);
    },
    runTx: (fn) => db.runTransaction(fn),
    needRef: (id) => db.collection("needs").doc(id),
    jobRef: (id) => db.collection("jobs").doc(id),
    hrRef: (id) => db.collection("homeowner_requests").doc(id),
    // snapshotHomeownerRequestVersion (App.js ~L22890): the prior doc into
    // homeowner_requests/<id>/versions {snap, at, by}, newest 10 kept. The
    // prune is the only Firestore delete in this file, and it only ever
    // touches this writer's own snapshots.
    snapshotHrVersion: async (jobId, prevData, tag, nowIso) => {
      if (!prevData) return false;
      const col = db.collection("homeowner_requests").doc(jobId).collection("versions");
      await col.add({ snap: dropUndefined(prevData), at: nowIso || new Date().toISOString(), by: tag || "unknown" });
      const snaps = await col.orderBy("at", "desc").limit(30).get();
      await Promise.all(snaps.docs.slice(10).map(d => d.ref.delete().catch(() => {})));
      return true;
    },
    auditRef: (id) => db.collection(AUDIT).doc(id),
    arrayUnion: (...x) => FieldValue.arrayUnion(...x),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    tz: TZ,
  };
}

module.exports = function makeDuetApi({ functions, db, FieldValue, FieldPath, getUsers, TZ, storage }) {
  const io = firestoreIo({ db, FieldValue, FieldPath, getUsers, TZ, storage });
  const duetApi = functions
    // invoker "public" like planRoutineApi: Google's door stays open so Vercel
    // can reach it; the bearer-token check is the gate. 512 MB / 120 s since
    // ship 3: a 7 MB photo arrives as a 9.3 MB base64 body and is decoded,
    // sniffed and uploaded in one request.
    .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: [SECRET], invoker: "public" })
    .https.onRequest(async (req, res) => {
      if (!tokenOk(req)) { res.status(401).json({ ok: false, error: "unauthorized" }); return; }
      if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }
      try {
        const r = await handle(req.body, io);
        res.status(r.status).json(r.body);
      } catch (e) {
        if (e instanceof Refusal) { res.status(e.status).json({ ok: false, refused: e.message }); return; }
        functions.logger.error("[duetApi] failed", { action: req.body && req.body.action, requestId: req.body && req.body.requestId, error: e && e.message });
        res.status(500).json({ ok: false, error: "Couldn't complete the change. Nothing is known to have been written; check the task before asking again." });
      }
    });
  return { duetApi };
};
module.exports.handle = handle;
module.exports.tokenOk = tokenOk;
module.exports.Refusal = Refusal;
module.exports.BUILD = BUILD;
module.exports.SAVED_BY = SAVED_BY;
module.exports.ACTIONS = ACTIONS;
module.exports.JOB_ACTIONS = JOB_ACTIONS;
module.exports.PHOTO_ACTIONS = PHOTO_ACTIONS;
module.exports.JOB_WRITE_ACTIONS = JOB_WRITE_ACTIONS;
module.exports.QUESTION_ACTIONS = QUESTION_ACTIONS;
module.exports.NOTE_ACTIONS = NOTE_ACTIONS;
module.exports.THREAD_ACTIONS = THREAD_ACTIONS;
module.exports.PEOPLE_ACTIONS = PEOPLE_ACTIONS;
module.exports.PUNCH_ACTIONS = PUNCH_ACTIONS;
module.exports.CREW_ACTIONS = CREW_ACTIONS;
module.exports.TIMEOFF_ACTIONS = TIMEOFF_ACTIONS;
module.exports.SETTINGS_DOCS = SETTINGS_DOCS;
module.exports.settingsDocAllowed = settingsDocAllowed;
module.exports.settingsDocFields = settingsDocFields;
module.exports.firestoreIo = firestoreIo;
