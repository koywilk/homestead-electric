"use strict";
// Duet write access (D9), ship 1: tasks. PURE planners — given the request,
// the live doc and what the server knows (clock, team list, job), they return
// either a refusal or exactly what to write, using the SAME builders the app's
// NeedQuickAdd / patchNeed / addNeedUpdate use (functions/needShape.js is a
// byte copy of src/needShape.js). No Firestore here: api.js does the
// transaction, scripts/duet-writes-test.js drives these with fixtures.
const NS = require("../needShape.js");
const { matchUserByName } = require("../nameMatch.js");

// Decision 9a: items show plain "Koy" (so the app's self-assign silence and
// name matching behave); "Duet (Koy)" lives only on the envelope and audit.
const ME = "Koy";
const MAX_TEXT = 2000;
const KINDS = ["need", "task"];
const BUCKETS = ["tomorrow", "week"];
const PRIORITIES = ["", "urgent", "low"];
const NOTE_KINDS = ["note", "waiting"];

const refuse = (why) => ({ refused: why });
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00"));
// Plain text the way a phone would have typed it: no control characters but
// newlines, trimmed, capped.
function cleanText(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);
}

// A name Duet typed → the team list's spelling, or a refusal that names the
// close matches. Active users only, never a contractor (the picker's roster rule).
function resolvePerson(name, users) {
  const want = String(name || "").trim();
  if (!want) return { name: "" };
  const roster = (users || []).filter(u => u && u.name && u.active !== false && u.access !== "contractor");
  const { user, ambiguous } = matchUserByName(roster, want);
  if (ambiguous) return refuse(`"${want}" matches more than one person on the team — use the full name.`);
  if (user) return { name: String(user.name) };
  const stem = want.toLowerCase().slice(0, 3);
  const close = roster.map(u => u.name).filter(n => n.toLowerCase().includes(stem)).slice(0, 5);
  return refuse(`"${want}" isn't on the active team list.${close.length ? ` Close: ${close.join(", ")}.` : ""} Nothing was written.`);
}

// ctx: { nowIso, bucketNow (Mountain-time noon ISO), users, job (null when no jobId asked) }
function planCreateTask(args, ctx) {
  const a = args || {};
  const text = cleanText(a.text);
  if (!text) return refuse("A task needs text.");
  if (a.kind != null && !KINDS.includes(a.kind)) return refuse(`kind must be one of ${KINDS.join(", ")}.`);
  if (a.dueBucket != null && !BUCKETS.includes(a.dueBucket)) return refuse(`dueBucket must be one of ${BUCKETS.join(", ")}.`);
  if (a.dueDate && !isYmd(a.dueDate)) return refuse("dueDate must be YYYY-MM-DD.");
  if (a.priority != null && !PRIORITIES.includes(a.priority)) return refuse(`priority must be one of: normal (""), urgent, low.`);
  if (a.jobId && !ctx.job) return refuse(`No Command Center job with id ${a.jobId}. Nothing was written.`);
  if (ctx.job && (ctx.job.archived || ctx.job.deleted)) return refuse(`${ctx.job.name || "That job"} is archived — tasks go on live jobs only.`);
  // Default assignee: Koy himself (defaultAssigneeFor: the head goes to self).
  const who = resolvePerson(a.assignedTo == null || a.assignedTo === "" ? ME : a.assignedTo, ctx.users);
  if (who.refused) return who;
  const need = NS.normalizeNeed(NS.buildNeed({
    kind: a.kind || "need", text, dueBucket: a.dueBucket, dueDate: a.dueDate || "", priority: a.priority || "",
    assignedTo: who.name, job: ctx.job ? { id: ctx.job.id, name: ctx.job.name || "", foreman: ctx.job.foreman || "" } : null,
    foremanIfNoJob: "",   // Koy is office: the picker leaves foreman blank with no job
  }, ME, ctx.nowIso, NS.newNeedId(Date.parse(ctx.nowIso), ctx.rand), ctx.bucketNow), ctx.bucketNow);
  return { need };
}

// Same task asked twice (two Duet calls, or Duet and a phone): an open need on
// the same job, same person, same words, created in the last 10 minutes.
function isDuplicate(need, openNeeds, nowIso) {
  const since = Date.parse(nowIso) - 10 * 60 * 1000;
  const same = (s) => String(s || "").trim().toLowerCase();
  return (openNeeds || []).some(n => n && same(n.text) === same(need.text) && same(n.jobId) === same(need.jobId) &&
    NS.sameName(NS.needAssignee(n), need.assignedTo) && Date.parse(n.createdAt || "") >= since);
}

// args: { done?: bool, assignedTo?, dueDate?, priority?, text?, note?: {kind, text, until?} }
// Returns { fields: {<k>: v}, entry|null, noop } for api.js to turn into
// dotted data.<k> keys + arrayUnion.
function planUpdateTask(args, current, ctx) {
  const a = args || {};
  if (!current) return refuse("That task doesn't exist (it may have been deleted). Nothing was written.");
  const patch = {};
  if (a.done === true) Object.assign(patch, NS.donePatch(ME, ctx.nowIso));
  else if (a.done === false) Object.assign(patch, NS.reopenPatch());
  else if (a.done != null) return refuse("done must be true or false.");
  if (a.assignedTo != null) {
    const who = resolvePerson(a.assignedTo, ctx.users);
    if (who.refused) return who;
    if (!who.name) return refuse("assignedTo needs a person's name.");
    patch.assignedTo = who.name;
  }
  if (a.dueDate != null) {
    if (a.dueDate !== "" && !isYmd(a.dueDate)) return refuse("dueDate must be YYYY-MM-DD (or \"\" to clear it).");
    patch.dueDate = a.dueDate;
  }
  if (a.priority != null) {
    if (!PRIORITIES.includes(a.priority)) return refuse(`priority must be one of: normal (""), urgent, low.`);
    patch.priority = a.priority;
  }
  if (a.text != null) {
    const t = cleanText(a.text);
    if (!t) return refuse("text can't be blank.");
    patch.text = t;
  }
  let entry = null, extra = {};
  if (a.note != null) {
    if (!a.note || typeof a.note !== "object") return refuse("note must be an object {kind, text, until?}.");
    if (a.note.kind != null && !NOTE_KINDS.includes(a.note.kind)) return refuse(`note.kind must be one of ${NOTE_KINDS.join(", ")}.`);
    if (a.note.until && !isYmd(a.note.until)) return refuse("note.until must be YYYY-MM-DD.");
    const r = NS.needUpdateEntry({ kind: a.note.kind || "note", text: cleanText(a.note.text), until: a.note.until || "" }, current, ME, ctx.nowIso);
    if (!r.entry) return refuse("note.text can't be blank.");
    entry = r.entry; extra = r.extra;
  }
  if (!Object.keys(patch).length && !entry) return refuse("Nothing to change: say what to update (done, assignedTo, dueDate, priority, text, or a note).");
  const fields = { ...NS.needPatch(patch, current, ME, ctx.nowIso, ctx.bucketNow), ...extra };
  // A patch that changes nothing on the doc and adds no note is a no-op: no write.
  const changes = Object.keys(fields).filter(k => !Object.is(String(current[k] == null ? "" : current[k]), String(fields[k] == null ? "" : fields[k])));
  if (!entry && !changes.length) return { fields: {}, entry: null, noop: true };
  return { fields, entry, noop: false };
}

module.exports = { ME, planCreateTask, planUpdateTask, isDuplicate, resolvePerson, cleanText };
