#!/usr/bin/env node
/* duet-field-undo-test.js — Duet write access (connector D9), ship 11: any
 * allowed job field + undo.
 *
 * Drives functions/duetWrites/fieldPolicy.js (the field allowlist + the
 * job.setField planner), functions/duetWrites/undo.js (the undo classes and
 * the replay planner) and functions/duetWrites/api.js (the handler) against a
 * fake Firestore transaction. Proves: EVERY key blankJob() / blankQuickJob()
 * creates has a class (a new default with no row fails the build), the
 * always-deny keys are never "allow", no array / map / *Stage / *Status /
 * *Result key is "allow"; owned keys refuse naming their tool, denied and
 * unknown keys refuse; the validators (bool, date → M/D/YYYY, text cap,
 * control chars, url); job.setField writes ONE dotted data.<key> with
 * jobWrite's envelope + audit, noop when equal, refuses archived jobs and
 * quick-only / regular-only mixups; undo replays an edit exactly (job scalar,
 * job array item, need, settings list, planner cell, punch done with its
 * slot), refuses "changed since" with the diff and leaves the original
 * un-stamped, undoes an add by the app's closing move (task → voided, CO →
 * denied, trip → complete, note → soft delete, team → removed, roster →
 * removed) or refuses where none exists (question, daily update, punch item,
 * Upcoming row), refuses sends, refuses a double undo / an undo of an undo /
 * of a refused or noop call, writes its own audit + the undoneBy stamp in ONE
 * transaction, and only ever touches the original collections + duet_writes.
 * No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const FP = require(path.join(root, "functions", "duetWrites", "fieldPolicy.js"));
const UN = require(path.join(root, "functions", "duetWrites", "undo.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const JS = require(path.join(root, "functions", "jobShape.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";
const TODAY = "2026-11-03";
const TZ = "America/Denver";
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {

// ── 1. the policy covers every job key ───────────────────────────────────────
await ok("fieldPolicy: every blankJob() / blankQuickJob() key has exactly one row; classes are allow / owned / deny; owned rows name a cc_ tool; deny rows say why", () => {
  let i = 0; const uid = () => String(++i);
  const keys = new Set([...Object.keys(JS.blankJob(uid)), ...Object.keys(JS.blankQuickJob(uid))]);
  const missing = [...keys].filter(k => !FP.BY_KEY[k]);
  assert.deepStrictEqual(missing, [], "unclassified blankJob keys: " + missing.join(", "));
  assert.strictEqual(new Set(FP.POLICY.map(r => r.key)).size, FP.POLICY.length, "no key twice");
  for (const r of FP.POLICY) {
    assert.ok(["allow", "owned", "deny"].includes(r.class), r.key);
    if (r.class === "owned") assert.ok(/^cc_[a-z_]+/.test(r.tool), r.key + " owned without a tool");
    if (r.class === "deny") assert.ok(r.note && r.note.length > 8, r.key + " denied without a reason");
    if (r.class === "allow") assert.ok(["boolean", "text", "date", "url"].includes(r.type) && r.note, r.key);
  }
  assert.ok(FP.ALLOWED.length >= 10 && FP.ALLOWED.length <= 25, "the allowlist stays small: " + FP.ALLOWED.length);
});
await ok("fieldPolicy: the always-deny keys are never allow; no array / map / *Stage / *Status / *Result key is allow; the named tools own their fields", () => {
  let i = 0; const uid = () => String(++i);
  const blank = JS.blankJob(uid);
  const never = ["id", "name", "simproNo", "archived", "archivedAt", "archivedBy", "deleted", "projectGroupId", "projectRole", "simproLead", "simproFolder", "tempPed", "panelizedLighting", "homeRuns", "punchTicks", "presence", "driveFolderId", "docPull", "simproSync", "imported_at", "_importedFromSimpro", "lastActivityAt"];
  for (const k of never) { const c = FP.classify(k); assert.ok(c.class === "deny" || c.class === "owned", k + " is " + c.class); }
  for (const k of Object.keys(blank)) {
    const v = blank[k];
    if (v && typeof v === "object") assert.notStrictEqual(FP.classify(k).class, "allow", k + " is an array / map");
    if (/(Stage|Status|Result)$/.test(k)) assert.notStrictEqual(FP.classify(k).class, "allow", k);
  }
  assert.strictEqual(FP.classify("roughStatus").tool, "cc_set_phase_status"); assert.strictEqual(FP.classify("foreman").tool, "cc_set_job_people");
  assert.strictEqual(FP.classify("name").tool, "cc_set_job_info"); assert.strictEqual(FP.classify("statusUpdate").tool, "cc_set_status_update");
  assert.strictEqual(FP.classify("hiddenSections").tool, "cc_set_job_section"); assert.strictEqual(FP.classify("prepChecklist").tool, "cc_tick_prep");
  assert.strictEqual(FP.classify("roughInspectionResult").tool, "cc_set_inspection"); assert.strictEqual(FP.classify("qcStatus").tool, "cc_set_qc_status");
  assert.strictEqual(FP.classify("roughProjectedStart").tool, "cc_set_schedule_dates"); assert.strictEqual(FP.classify("changeOrders").class, "owned");
  assert.match(FP.classify("roughStatus").why, /use that tool/); assert.match(FP.classify("archived").why, /cc_archive_job/);
  assert.match(FP.classify("zzz").why, /unknown keys are refused/); assert.match(FP.classify("zzz").why, /flagNote/, "the refusal lists the allowed keys");
  assert.strictEqual(FP.classify("../users").class, "unknown"); assert.strictEqual(FP.classify("").class, "unknown");
});
await ok("fieldPolicy: validators — bool strict, text capped at 2000 (refused, not cut) with control chars stripped, dates in either form stored M/D/YYYY, a bad date refused, \"\" clears, urls need https://", () => {
  const b = FP.BY_KEY.flagged, t = FP.BY_KEY.flagNote, d = FP.BY_KEY.fourWayTargetDate;
  assert.deepStrictEqual(FP.validate(b, true), { v: true }); assert.match(FP.validate(b, "true").refused, /true or false/); assert.match(FP.validate(b, 1).refused, /true or false/);
  assert.deepStrictEqual(FP.validate(t, " a\u0000b\u0007c "), { v: "abc" }); assert.match(FP.validate(t, "x".repeat(2001)).refused, /over 2000/); assert.deepStrictEqual(FP.validate(t, "x".repeat(2000)).v.length, 2000);
  assert.deepStrictEqual(FP.validate(t, null), { v: "" }); assert.match(FP.validate(t, { a: 1 }).refused, /must be text/);
  assert.deepStrictEqual(FP.validate(d, "2026-12-03"), { v: "12/3/2026" }); assert.deepStrictEqual(FP.validate(d, "12/03/2026"), { v: "12/3/2026" }); assert.deepStrictEqual(FP.validate(d, ""), { v: "" });
  assert.match(FP.validate(d, "2026-02-30").refused, /real date/); assert.match(FP.validate(d, "Dec 3").refused, /YYYY-MM-DD or M\/D\/YYYY/);
  const u = { key: "x", type: "url" };
  assert.deepStrictEqual(FP.validate(u, "https://a.b/c"), { v: "https://a.b/c" }); assert.match(FP.validate(u, "a.b").refused, /https:\/\//); assert.deepStrictEqual(FP.validate(u, ""), { v: "" });
});

// ── fixtures ─────────────────────────────────────────────────────────────────
const USERS = [
  { id: "u1", name: "Koy", title: "admin", access: "admin", caps: ["resi.head"] },
  { id: "u2", name: "Josh Miller", title: "admin", access: "admin" },
  { id: "u3", name: "Keegan", title: "foreman", access: "manager" },
  { id: "u4", name: "Colby", title: "foreman", access: "standard" },
  { id: "u5", name: "Abe", title: "crew", access: "limited" },
];
const FORTH = "1772863862618", GONE = "1772863862620", QUICK = "1772863862622";
const FLOOR = () => ({ general: [], hotcheck: [], rooms: [], photos: [] });
const JOB = (over) => ({ id: FORTH, name: "Forth", foreman: "Keegan", lead: "", flagged: false, flagNote: "", roughNotes: "", fourWayTargetDate: "", readyToInvoice: false, statusUpdate: "", hiddenSections: {},
  changeOrders: [{ id: "c1", date: "", desc: "Add cans", task: "", material: "", coStatus: "needs_sending", coStatusDate: "", needsHardDate: false, needsByStart: "", needsByEnd: "", createdBy: "Keegan", createdAt: "10/28/2026", photos: [] }],
  returnTrips: [{ id: "r1", scope: "Trim bath", task: "", material: "", notes: "", assignedTo: "Colby", rtStatus: "needs", rtStatusDate: "", rtScheduled: false, needsSchedule: true, signedOff: false, punch: [], photos: [] }],
  jobNotes: [{ id: "n1", title: "Rough walk", phase: "rough", createdAt: "x", createdBy: "Keegan", updatedAt: "x", lines: [{ id: "l1", text: "Move the fridge receptacle", createdAt: "x", photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: null }],
  jobNotesMigratedAt: "2026-10-01T00:00:00.000Z",
  roughPunch: { upper: { ...FLOOR(), general: [{ id: "pu1", text: "Nail plates on the hall run", done: false, addedBy: "Keegan", addedAt: "2026-10-30", addedAtTs: "2026-10-30T15:00:00.000Z" }] }, main: FLOOR(), basement: FLOOR(), extras: [] },
  finishPunch: { upper: FLOOR(), main: FLOOR(), basement: FLOOR(), extras: [] }, qcPunch: { upper: FLOOR(), main: FLOOR(), basement: FLOOR() }, punchTicks: {},
  roughQuestions: { upper: [], main: [{ id: "q1", question: "Fan box height?", answer: "", done: false, for: "GC", addedBy: "Keegan", addedAt: "2026-10-30T15:00:00.000Z" }], basement: [] }, finishQuestions: { upper: [], main: [], basement: [] },
  roughUpdates: [], finishUpdates: [], roughMaterials: [], finishMaterials: [], ...(over || {}) });
const DOC = (data, over) => ({ data, updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 609, w: "609.abcdefgh", ...(over || {}) });
const NEED1 = { id: "need_1762000000001_aaaaa", kind: "need", text: "Order the 200A panel", dueBucket: "week", dueDate: "2026-11-12", snoozedUntil: "", priority: "", assignedTo: "Josh Miller", assignedBy: "Koy", assignedAt: "2026-11-02T10:00:00.000Z", foreman: "Keegan", jobId: FORTH, jobName: "Forth", status: "open", createdBy: "Koy", createdAt: "2026-11-02T10:00:00.000Z", doneAt: "", doneBy: "", startedBy: "Josh Miller", startedAt: "2026-11-02T12:00:00.000Z" };
const DOCS = () => ({
  ["jobs/" + FORTH]: DOC(JOB()),
  ["jobs/" + GONE]: DOC(JOB({ id: GONE, name: "Gone", archived: true, archivedAt: "2026-10-01T00:00:00.000Z", archivedBy: "Koy" })),
  ["jobs/" + QUICK]: DOC({ id: QUICK, name: "Quick fix", quickJob: true, quickJobType: "service", quickJobStatus: "new", notes: "", scope: "", readyToInvoice: false, changeOrders: [], returnTrips: [] }),
  ["needs/" + NEED1.id]: { data: clone(NEED1), updated_at: "2026-11-02T12:00:00.000Z", saved_by: "Josh Miller" },
  "settings/crewRoster": { names: ["Keegan", "Colby", "Abe"], updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/crewTeams": { teams: [{ id: "t1", lead: "Keegan", members: ["Abe"] }], updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/upcoming_jobs": { items: [{ id: "1761000000001", name: "#2048 Lot 317", address: "", city: "Heber", sales: "Justin", customer: "", notes: "", lastFollowUp: "", foreman: "", projectedStart: "", startConfirmed: false, photos: [] }], updated_at: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/crewPTO": { list: [], updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
});

function fakeIo({ docs = DOCS(), users = USERS } = {}) {
  const log = [];
  let rc = 0;
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } if (v && v.__delete) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path, d]); if (store[r.path]) { const e = new Error("6 ALREADY_EXISTS"); e.code = 6; throw e; } if (JSON.stringify(d).includes("undefined")) throw new Error("undefined written"); store[r.path] = clone(d); },
    update: (r, ...rest) => {
      let d;
      if (rest.length === 1) d = rest[0];
      else { d = {}; for (let i = 0; i < rest.length; i += 2) { const k = rest[i]; d[k && k.__fieldPath ? k.__fieldPath.join(".") : k] = rest[i + 1]; } }   // the Admin SDK's alternating FieldPath form
      log.push(["update", r.path, d]);
      if (!store[r.path]) throw new Error("update on a missing doc: " + r.path);
      const cur = clone(store[r.path]);
      Object.keys(d).forEach(k => { if (d[k] === undefined) throw new Error("undefined written at " + k); const v = d[k]; if (v && v.__arrayUnion) { const arr = Array.isArray(cur[k.split(".")[0]] && cur[k.split(".")[0]][k.split(".")[1]]) ? cur[k.split(".")[0]][k.split(".")[1]] : []; setPath(cur, k, [...arr, ...v.__arrayUnion]); } else if (v && v.__serverTimestamp) setPath(cur, k, "<server-ts>"); else setPath(cur, k, v); });
      store[r.path] = cur;
    },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = clone(d); },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "ab" + String(++rc).padStart(3, "0"), tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => 0, recentActions: async () => [],
    getJob: async (id) => { const d = store["jobs/" + id] && store["jobs/" + id].data; return d ? { id, name: d.name || "", foreman: d.foreman || "", archived: !!d.archived, deleted: !!d.deleted } : null; },
    getUsers: async () => users, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), auditRef: (id) => ref("duet_writes", id),
    projectRef: (id) => ref("projects", id),
    settingsRef: (id) => { log.push(["settingsRef", id]); if (!api.settingsDocAllowed(id)) throw new api.Refusal(400, "settings/" + id + " is not a document Duet may touch. Nothing was read or written."); return ref("settings", id); },
    fieldPath: (...segs) => ({ __fieldPath: segs }), deleteField: () => ({ __delete: true }),
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }),
    needsByAutoTaskId: async () => [],
  };
}
let seq = 0;
const rid = () => "ship11-test-" + String(++seq).padStart(4, "0");
const run = (io, action, args, id) => api.handle({ requestId: id || rid(), action, email: "koy@homesteadelectric.net", args }, io);
const upd = (io, pathStart) => io.log.filter(l => l[0] === "update" && l[1].startsWith(pathStart)).map(l => l[2]);
const writesOf = (io) => io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));

// ── 2. planSetField ──────────────────────────────────────────────────────────
await ok("planSetField: an allowed key plans ONE field with before / after; same value → noop; owned / deny / unknown refuse before anything is planned; archived job refuses; quick-only and regular-only keys check the job", () => {
  const ctx = { nowIso: NOW, tz: TZ, users: USERS };
  const p = FP.planSetField({ field: "flagNote", value: "GC wants the panel north" }, { ...ctx, job: { id: FORTH, data: JOB() } });
  assert.deepStrictEqual(p.fields, { flagNote: "GC wants the panel north" }); assert.deepStrictEqual(p.before, { flagNote: "" }); assert.deepStrictEqual(p.after, p.fields);
  assert.strictEqual(p.result.field, "flagNote"); assert.strictEqual(p.result.from, ""); assert.deepStrictEqual(p.result.pushTo, []); assert.deepStrictEqual(p.result.pushes, []);
  assert.strictEqual(FP.planSetField({ field: "flagged", value: false }, { ...ctx, job: { id: FORTH, data: JOB() } }).noop, true);
  assert.strictEqual(FP.planSetField({ field: "fourWayTargetDate", value: "" }, { ...ctx, job: { id: FORTH, data: JOB() } }).noop, true, "\"\" on a blank date is a noop");
  const date = FP.planSetField({ field: "fourWayTargetDate", value: "2026-11-20" }, { ...ctx, job: { id: FORTH, data: JOB() } });
  assert.deepStrictEqual(date.fields, { fourWayTargetDate: "11/20/2026" });
  const inv = FP.planSetField({ field: "readyToInvoice", value: true }, { ...ctx, job: { id: FORTH, data: JOB() } });
  assert.strictEqual(inv.result.pushes[0].push, "ready_invoice"); assert.match(inv.result.pushes[0].note, /switched OFF/);
  assert.match(FP.planSetField({ field: "roughStatus", value: "complete" }, { ...ctx, job: { id: FORTH, data: JOB() } }).refused, /cc_set_phase_status/);
  assert.match(FP.planSetField({ field: "deleted", value: true }, { ...ctx, job: { id: FORTH, data: JOB() } }).refused, /never deletes/);
  assert.match(FP.planSetField({ field: "zzz", value: 1 }, { ...ctx, job: { id: FORTH, data: JOB() } }).refused, /isn't a Command Center job field/);
  assert.match(FP.planSetField({ field: "flagNote", value: "x" }, { ...ctx, job: { id: GONE, data: JOB({ archived: true }) } }).refused, /archived/);
  assert.match(FP.planSetField({ field: "flagNote", value: "x" }, { ...ctx, job: null }).refused, /doesn't exist/);
  assert.match(FP.planSetField({ field: "notes", value: "x" }, { ...ctx, job: { id: FORTH, data: JOB() } }).refused, /quick-job field/);
  assert.deepStrictEqual(FP.planSetField({ field: "notes", value: "Bring the ladder" }, { ...ctx, job: { id: QUICK, data: DOCS()["jobs/" + QUICK].data } }).fields, { notes: "Bring the ladder" });
  assert.match(FP.planSetField({ field: "readyToInvoice", value: true }, { ...ctx, job: { id: QUICK, data: DOCS()["jobs/" + QUICK].data } }).refused, /sign-off buttons/);
  assert.match(FP.planSetField({ field: "flagged", value: "yes" }, { ...ctx, job: { id: FORTH, data: JOB() } }).refused, /true or false/);
});

// ── 3. handle job.setField ───────────────────────────────────────────────────
let io = fakeIo();
await ok("handle job.setField: ONE jobs update with the dotted data.<key> + jobWrite's envelope (stamp, lastActivityAt, merged:false, updated_at strictly newer) + the audit in the same transaction; archived job refused (audited); same value → noop audit with no job write", async () => {
  const r = await run(io, "job.setField", { jobId: FORTH, field: "flagNote", value: "GC wants the panel north" }, "ship11-set-0001");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.field, "flagNote"); assert.strictEqual(r.body.to, "GC wants the panel north"); assert.strictEqual(r.body.from, "");
  const u = upd(io, "jobs/" + FORTH)[0];
  assert.deepStrictEqual(Object.keys(u).sort(), ["app_build", "data.flagNote", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"]);
  assert.strictEqual(u.app_build, api.BUILD); assert.strictEqual(u.saved_by, "Duet (Koy)"); assert.ok(u.updated_at > "2026-11-03T20:00:00.000Z"); assert.strictEqual(u.merged, false);
  const audit = io.store["duet_writes/ship11-set-0001"];
  assert.deepStrictEqual(audit.fields, ["flagNote"]); assert.deepStrictEqual(audit.before, { flagNote: "" }); assert.deepStrictEqual(audit.after, { flagNote: "GC wants the panel north" }); assert.strictEqual(audit.coll, "jobs"); assert.strictEqual(audit.docId, FORTH);
  assert.deepStrictEqual(io.log.filter(l => l[0] !== "settingsRef").map(l => l[0]), ["get", "update", "set"], "read, write, audit — one transaction");
  const arch = await run(io, "job.setField", { jobId: GONE, field: "flagNote", value: "x" });
  assert.strictEqual(arch.status, 400); assert.match(arch.body.refused, /archived/); assert.strictEqual(upd(io, "jobs/" + GONE).length, 0);
  const noop = await run(io, "job.setField", { jobId: FORTH, field: "flagNote", value: "GC wants the panel north" }, "ship11-set-0002");
  assert.strictEqual(noop.body.noop, true); assert.strictEqual(io.store["duet_writes/ship11-set-0002"].noop, true); assert.strictEqual(upd(io, "jobs/" + FORTH).length, 1);
  const owned = await run(io, "job.setField", { jobId: FORTH, field: "foreman", value: "Colby" });
  assert.strictEqual(owned.status, 400); assert.match(owned.body.refused, /cc_set_job_people/);
  const missing = await run(io, "job.setField", { jobId: "1700000000000", field: "flagNote", value: "x" });
  assert.strictEqual(missing.status, 404);
});

// ── 4. undo — edits replayed exactly ─────────────────────────────────────────
await ok("undo of a job scalar edit: the field goes back to the audit's before through jobWrite's envelope; the undo is its own audit (undo.apply, undoes, before = what showed, after = what was put back) and the original gets undoneBy / undoneAt in the SAME transaction", async () => {
  const r = await run(io, "undo.apply", { requestId: "ship11-set-0001" }, "ship11-undo-0001");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.undoes, "ship11-set-0001"); assert.strictEqual(r.body.undoneAction, "job.setField"); assert.deepStrictEqual(r.body.fields, ["flagNote"]); assert.deepStrictEqual(r.body.putBack, { flagNote: "" }); assert.deepStrictEqual(r.body.wasShowing, { flagNote: "GC wants the panel north" }); assert.strictEqual(r.body.closing, null);
  assert.strictEqual(io.store["jobs/" + FORTH].data.flagNote, "");
  const u = upd(io, "jobs/" + FORTH); const last = u[u.length - 1];
  assert.strictEqual(last["data.flagNote"], ""); assert.strictEqual(last.saved_by, "Duet (Koy)"); assert.strictEqual(last.merged, false); assert.ok(last.lastActivityAt);
  const ua = io.store["duet_writes/ship11-undo-0001"];
  assert.strictEqual(ua.action, "undo.apply"); assert.strictEqual(ua.undoes, "ship11-set-0001"); assert.deepStrictEqual(ua.before, { flagNote: "GC wants the panel north" }); assert.deepStrictEqual(ua.after, { flagNote: "" }); assert.strictEqual(ua.coll, "jobs"); assert.strictEqual(ua.docId, FORTH);
  const orig = io.store["duet_writes/ship11-set-0001"];
  assert.strictEqual(orig.undoneBy, "ship11-undo-0001"); assert.strictEqual(orig.undoneAt, NOW);
  const tail = io.log.slice(io.log.findIndex(l => l[0] === "get" && l[1] === "duet_writes/ship11-set-0001")).map(l => l[0] + " " + l[1]);
  assert.deepStrictEqual(tail, ["get duet_writes/ship11-set-0001", "get jobs/" + FORTH, "update jobs/" + FORTH, "set duet_writes/ship11-undo-0001", "update duet_writes/ship11-set-0001"], "original re-read under the lock, the job, the write, the undo audit, the stamp — one tx");
});
await ok("undo refusals: a second undo of the same call, an undo of the undo, of a noop call, of a refused call, of an unknown requestId (404), of itself — nothing written but the refusal audit", async () => {
  const twice = await run(io, "undo.apply", { requestId: "ship11-set-0001" });
  assert.strictEqual(twice.status, 400); assert.match(twice.body.refused, /already undone by ship11-undo-0001/);
  const ofUndo = await run(io, "undo.apply", { requestId: "ship11-undo-0001" });
  assert.strictEqual(ofUndo.status, 400); assert.match(ofUndo.body.refused, /itself an undo/);
  const ofNoop = await run(io, "undo.apply", { requestId: "ship11-set-0002" });
  assert.strictEqual(ofNoop.status, 400); assert.match(ofNoop.body.refused, /changed nothing/);
  const refusedCall = io.log.length; const bad = await run(io, "job.setField", { jobId: FORTH, field: "foreman", value: "Colby" }, "ship11-set-0003");
  assert.strictEqual(bad.status, 400);
  const ofRefused = await run(io, "undo.apply", { requestId: "ship11-set-0003" });
  assert.strictEqual(ofRefused.status, 400); assert.match(ofRefused.body.refused, /was refused/);
  const gone = await run(io, "undo.apply", { requestId: "ship11-nope-9999" });
  assert.strictEqual(gone.status, 404); assert.match(gone.body.refused, /No Duet change/);
  const self = await run(io, "undo.apply", { requestId: "ship11-self-0001" }, "ship11-self-0001");
  assert.strictEqual(self.status, 400); assert.match(self.body.refused, /can't name itself/);
  assert.strictEqual(upd(io, "jobs/").length, 2, "no job write from any refusal"); void refusedCall;
});
await ok("undo 'changed since': the field no longer reads the audit's after → refused with the diff (current vs expected), the refusal audited, the original NOT stamped (a later undo may still run)", async () => {
  const set = await run(io, "job.setField", { jobId: FORTH, field: "roughNotes", value: "A" }, "ship11-set-0010");
  assert.strictEqual(set.status, 200);
  io.store["jobs/" + FORTH].data.roughNotes = "B";   // someone edits in the app
  const r = await run(io, "undo.apply", { requestId: "ship11-set-0010" }, "ship11-undo-0010");
  assert.strictEqual(r.status, 400); assert.match(r.body.refused, /Changed since/); assert.deepStrictEqual(r.body.diff, [{ field: "roughNotes", current: "B", expected: "A" }]);
  assert.strictEqual(io.store["jobs/" + FORTH].data.roughNotes, "B"); assert.strictEqual(io.store["duet_writes/ship11-set-0010"].undoneBy, undefined);
  assert.strictEqual(io.store["duet_writes/ship11-undo-0010"].ok, false); assert.deepStrictEqual(io.store["duet_writes/ship11-undo-0010"].diff, r.body.diff);
  io.store["jobs/" + FORTH].data.roughNotes = "A";   // put it back by hand → the undo works now
  const again = await run(io, "undo.apply", { requestId: "ship11-set-0010" }, "ship11-undo-0011");
  assert.strictEqual(again.status, 200); assert.strictEqual(io.store["jobs/" + FORTH].data.roughNotes, ""); assert.strictEqual(io.store["duet_writes/ship11-set-0010"].undoneBy, "ship11-undo-0011");
});
await ok("undo of a job array-item edit (co.setStatus): the ONE change order goes back to its before by id, the other items byte-identical; changed-since checks the item", async () => {
  const io2 = fakeIo();
  const set = await run(io2, "co.setStatus", { jobId: FORTH, coId: "c1", status: "approved" }, "ship11-co-0001");
  assert.strictEqual(set.status, 200); assert.strictEqual(io2.store["jobs/" + FORTH].data.changeOrders[0].coStatus, "approved");
  io2.store["jobs/" + FORTH].data.changeOrders.push({ id: "c2", desc: "Another", coStatus: "pending" });   // added by someone else since — untouched by the undo
  const r = await run(io2, "undo.apply", { requestId: "ship11-co-0001" }, "ship11-undo-co-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.itemId, "c1"); assert.deepStrictEqual(r.body.fields, ["changeOrders"]);
  const cos = io2.store["jobs/" + FORTH].data.changeOrders;
  assert.strictEqual(cos.length, 2); assert.deepStrictEqual(cos[0], JOB().changeOrders[0], "the CO is exactly what it was"); assert.strictEqual(cos[1].id, "c2");
  assert.deepStrictEqual(io2.store["duet_writes/ship11-undo-co-1"].after.changeOrders, JOB().changeOrders[0]);
  const set2 = await run(io2, "co.setStatus", { jobId: FORTH, coId: "c1", status: "pending" }, "ship11-co-0002");
  assert.strictEqual(set2.status, 200);
  io2.store["jobs/" + FORTH].data.changeOrders[0].coStatus = "scheduled";
  const chg = await run(io2, "undo.apply", { requestId: "ship11-co-0002" });
  assert.strictEqual(chg.status, 400); assert.strictEqual(chg.body.diff[0].field, "changeOrders item c1"); assert.strictEqual(chg.body.diff[0].current.coStatus, "scheduled");
});
await ok("undo of a need edit (task.update reassign): the dotted data.<k> keys go back — assignedTo, the hand-off stamps AND the Working state the hand-off cleared; a note the call added stays and is said so", async () => {
  const io3 = fakeIo();
  const set = await run(io3, "task.update", { needId: NEED1.id, assignedTo: "Colby", note: { kind: "note", text: "Colby, yours" } }, "ship11-need-0001");
  assert.strictEqual(set.status, 200); assert.strictEqual(io3.store["needs/" + NEED1.id].data.assignedTo, "Colby"); assert.strictEqual(io3.store["needs/" + NEED1.id].data.startedBy, "");
  const r = await run(io3, "undo.apply", { requestId: "ship11-need-0001" }, "ship11-undo-need-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const d = io3.store["needs/" + NEED1.id].data;
  assert.strictEqual(d.assignedTo, "Josh Miller"); assert.strictEqual(d.startedBy, "Josh Miller"); assert.strictEqual(d.startedAt, NEED1.startedAt); assert.strictEqual(d.assignedBy, "Koy"); assert.strictEqual(d.assignedAt, NEED1.assignedAt);
  assert.strictEqual(d.updates.length, 1, "the note stays"); assert.ok(r.body.notes.some(x => /note .* stays/.test(x)));
  const u = upd(io3, "needs/")[1];
  assert.ok(!("lastActivityAt" in u) && u.saved_by === "Duet (Koy)" && u.app_build === api.BUILD, "patchNeed's envelope, not the job's");
  assert.deepStrictEqual(r.body.fields.sort(), ["assignedAt", "assignedBy", "assignedTo", "startedAt", "startedBy"]);
  const noteOnly = await run(io3, "task.update", { needId: NEED1.id, note: { kind: "note", text: "just a note" } }, "ship11-need-0002");
  assert.strictEqual(noteOnly.status, 200);
  const r2 = await run(io3, "undo.apply", { requestId: "ship11-need-0002" });
  assert.strictEqual(r2.status, 400); assert.match(r2.body.refused, /only added a note/);
});

// ── 5. undo — adds by the app's closing move, or refused ─────────────────────
await ok("undo of task.create: the need is NOT deleted — it is done + voided with reason 'undone by Koy via Duet' through needPatch (Working reset) + the app's void note via arrayUnion", async () => {
  const io4 = fakeIo();
  const made = await run(io4, "task.create", { text: "Order the 200A panel", jobId: FORTH, assignedTo: "Colby" }, "ship11-tc-0001");
  assert.strictEqual(made.status, 200);
  const r = await run(io4, "undo.apply", { requestId: "ship11-tc-0001" }, "ship11-undo-tc-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.closing, /voided/);
  const d = io4.store["needs/" + made.body.needId].data;
  assert.strictEqual(d.status, "done"); assert.strictEqual(d.voided, true); assert.strictEqual(d.voidReason, UN.UNDO_REASON); assert.strictEqual(d.voidedBy, "Koy"); assert.strictEqual(d.doneBy, "Koy");
  assert.deepStrictEqual(d.updates, [{ by: "Koy", at: NOW, kind: "void", text: UN.UNDO_REASON }]);
  assert.ok(io4.store["needs/" + made.body.needId], "never deleted"); assert.ok(!io4.log.some(l => l[0] === "delete"));
  assert.strictEqual(io4.store["duet_writes/ship11-tc-0001"].undoneBy, "ship11-undo-tc-1");
  const io5 = fakeIo();
  const made2 = await run(io5, "task.create", { text: "x", jobId: FORTH }, "ship11-tc-0002");
  io5.store["needs/" + made2.body.needId].data.text = "edited since";
  const chg = await run(io5, "undo.apply", { requestId: "ship11-tc-0002" });
  assert.strictEqual(chg.status, 400); assert.strictEqual(chg.body.diff[0].field, "text");
});
await ok("undo of co.create → the CO is set to denied (cc_set_co_status's shape); of rt.create → the trip is set to complete; of note.add → the note is soft-deleted (the app's flag, never removed); of note.addLine → the line is cleared to \"\"", async () => {
  const io6 = fakeIo();
  const co = await run(io6, "co.create", { jobId: FORTH, desc: "Add two cans", task: "Run 14/2" }, "ship11-coc-1");
  assert.strictEqual(co.status, 200);
  const r1 = await run(io6, "undo.apply", { requestId: "ship11-coc-1" }, "ship11-undo-coc-1");
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body)); assert.match(r1.body.closing, /denied/);
  const c = io6.store["jobs/" + FORTH].data.changeOrders.find(x => x.id === co.body.coId);
  assert.strictEqual(c.coStatus, "denied"); assert.strictEqual(c.coStatusDate, ""); assert.strictEqual(c.needsHardDate, false); assert.strictEqual(c.desc, "Add two cans");
  const rt = await run(io6, "rt.create", { jobId: FORTH, scope: "Fix the pantry light" }, "ship11-rtc-1");
  assert.strictEqual(rt.status, 200);
  const r2 = await run(io6, "undo.apply", { requestId: "ship11-rtc-1" }, "ship11-undo-rtc-1");
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); assert.match(r2.body.closing, /complete/);
  const t = io6.store["jobs/" + FORTH].data.returnTrips.find(x => x.id === rt.body.rtId);
  assert.strictEqual(t.rtStatus, "complete"); assert.strictEqual(t.needsSchedule, false); assert.strictEqual(t.rtScheduled, false);
  const note = await run(io6, "note.add", { jobId: FORTH, title: "Meeting", text: "GC wants the panel north" }, "ship11-note-1");
  assert.strictEqual(note.status, 200);
  const r3 = await run(io6, "undo.apply", { requestId: "ship11-note-1" }, "ship11-undo-note-1");
  assert.strictEqual(r3.status, 200, JSON.stringify(r3.body)); assert.match(r3.body.closing, /soft-deleted/);
  const nt = io6.store["jobs/" + FORTH].data.jobNotes.find(x => x.id === note.body.noteId);
  assert.strictEqual(nt.deleted, true); assert.strictEqual(nt.lines[0].text, "GC wants the panel north"); assert.strictEqual(io6.store["jobs/" + FORTH].data.jobNotes.length, 2);
  const line = await run(io6, "note.addLine", { jobId: FORTH, noteId: "n1", text: "Second line" }, "ship11-line-1");
  assert.strictEqual(line.status, 200);
  const r4 = await run(io6, "undo.apply", { requestId: "ship11-line-1" }, "ship11-undo-line-1");
  assert.strictEqual(r4.status, 200, JSON.stringify(r4.body)); assert.match(r4.body.closing, /cleared/);
  const n1 = io6.store["jobs/" + FORTH].data.jobNotes.find(x => x.id === "n1");
  assert.strictEqual(n1.lines.length, 2); assert.strictEqual(n1.lines[1].text, ""); assert.strictEqual(n1.lines[0].text, "Move the fridge receptacle");
});
await ok("undo refused where the app has no take-back: a question, a daily update, a punch item, an Upcoming row; each says what to do instead; nothing written", async () => {
  const io7 = fakeIo();
  const q = await run(io7, "question.add", { jobId: FORTH, phase: "rough", floor: "main", question: "Plate color?" }, "ship11-q-1");
  const du = await run(io7, "dailyUpdate.add", { jobId: FORTH, phase: "rough", text: "Rough passed" }, "ship11-du-1");
  const pa = await run(io7, "punch.add", { jobId: FORTH, phase: "rough", floor: "main", text: "Add a can", where: "general" }, "ship11-pa-1");
  const up = await run(io7, "upcoming.add", { name: "#2101 Rivers" }, "ship11-up-1");
  for (const r of [q, du, pa, up]) assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const before = writesOf(io7).length;
  const uq = await run(io7, "undo.apply", { requestId: "ship11-q-1" }); assert.strictEqual(uq.status, 400); assert.match(uq.body.refused, /cc_answer_question/);
  const udu = await run(io7, "undo.apply", { requestId: "ship11-du-1" }); assert.strictEqual(udu.status, 400); assert.match(udu.body.refused, /correcting update/);
  const upa = await run(io7, "undo.apply", { requestId: "ship11-pa-1" }); assert.strictEqual(upa.status, 400); assert.match(upa.body.refused, /cc_punch_done/);
  const uup = await run(io7, "undo.apply", { requestId: "ship11-up-1" }); assert.strictEqual(uup.status, 400); assert.match(uup.body.refused, /no remove/);
  assert.ok(writesOf(io7).slice(before).every(w => w[1].startsWith("duet_writes/")), "only the refusal audits were written");
  for (const id of ["ship11-q-1", "ship11-du-1", "ship11-pa-1", "ship11-up-1"]) assert.strictEqual(io7.store["duet_writes/" + id].undoneBy, undefined);
});
await ok("undo refused for sends: a PO send, an announcement, a plan-intake decision, a thread reply, a photo — 'already left the building'; a preview (read) too", async () => {
  const io8 = fakeIo();
  const mk = (id, extra) => { io8.store["duet_writes/" + id] = { at: NOW, requestId: id, ok: true, by: "Duet (Koy)", coll: "jobs", docId: FORTH, fields: ["x"], before: {}, after: {}, ...extra }; };
  mk("send-po-0001", { action: "material.sendPo", itemId: "card1" }); mk("send-bc-0001", { action: "broadcast.send", coll: "broadcasts", docId: "bc_1" }); mk("send-pi-0001", { action: "planIntake.decide", coll: "agentQueue", docId: "pi_1" });
  mk("send-th-0001", { action: "question.reply", coll: "homeowner_requests" }); mk("send-ph-0001", { action: "photo.add", itemId: "r1" }); mk("send-pv-0001", { action: "material.previewPo", read: true, fields: [] });
  const before = writesOf(io8).length;
  for (const [id, re] of [["send-po-0001", /Void the PO in Simpro/], ["send-bc-0001", /cannot be unsent/], ["send-pi-0001", /Plan Inbox/], ["send-th-0001", /stays as written/], ["send-ph-0001", /uploaded and on the item/], ["send-pv-0001", /nothing to put back/]]) {
    const r = await run(io8, "undo.apply", { requestId: id });
    assert.strictEqual(r.status, 400, id); assert.match(r.body.refused, re, id);
  }
  assert.ok(writesOf(io8).slice(before).every(w => w[1].startsWith("duet_writes/") && w[0] === "set"), "refusal audits only, no stamp on the originals");
});

// ── 6. undo — punch done with its slot, settings lists, a planner cell, the archive ──
await ok("undo of punch.setDone: a done flip is put back through planSetDone — the item un-done the checkbox's way AND the punchTicks.<id> slot rewritten by punchTickPatches (never the old slot copied back); changed-since checks item + slot", async () => {
  const io9 = fakeIo();
  const done = await run(io9, "punch.setDone", { jobId: FORTH, phase: "rough", itemId: "pu1", done: true }, "ship11-pd-1");
  assert.strictEqual(done.status, 200, JSON.stringify(done.body)); assert.strictEqual(io9.store["jobs/" + FORTH].data.punchTicks.pu1.done, true);
  const r = await run(io9, "undo.apply", { requestId: "ship11-pd-1" }, "ship11-undo-pd-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const d = io9.store["jobs/" + FORTH].data;
  const item = d.roughPunch.upper.general[0];
  assert.strictEqual(item.done, false); assert.strictEqual(item.checkedBy, ""); assert.strictEqual(item.checkedAt, "");
  assert.strictEqual(d.punchTicks.pu1.done, false); assert.strictEqual(d.punchTicks.pu1.by, "Koy"); assert.strictEqual(d.punchTicks.pu1.ts, NOW);
  assert.deepStrictEqual(r.body.fields.sort(), ["punchTicks.pu1", "roughPunch"]); assert.strictEqual(r.body.slot.done, false);
  const done2 = await run(io9, "punch.setDone", { jobId: FORTH, phase: "rough", itemId: "pu1", done: true }, "ship11-pd-2");
  assert.strictEqual(done2.status, 200);
  io9.store["jobs/" + FORTH].data.punchTicks.pu1 = { done: true, by: "Keegan", at: "11/3/2026", ts: "2026-11-04T05:00:00.000Z" };   // a phone re-ticked it
  const chg = await run(io9, "undo.apply", { requestId: "ship11-pd-2" });
  assert.strictEqual(chg.status, 400); assert.strictEqual(chg.body.diff[0].field, "punchTicks.pu1");
});
await ok("undo of settings-list changes: a roster add → the name taken off (the app's own remove); a team edit → the team put back whole; a team add → removed; a team remove → refused (a new id would be made); each the settings stamp, other items untouched", async () => {
  const io10 = fakeIo();
  const add = await run(io10, "crewRoster.set", { op: "add", name: "josh" }, "ship11-ro-1");
  assert.strictEqual(add.status, 200); assert.ok(io10.store["settings/crewRoster"].names.includes("Josh Miller"));
  const r1 = await run(io10, "undo.apply", { requestId: "ship11-ro-1" }, "ship11-undo-ro-1");
  assert.strictEqual(r1.status, 200, JSON.stringify(r1.body)); assert.deepStrictEqual(io10.store["settings/crewRoster"].names, ["Keegan", "Colby", "Abe"]); assert.match(r1.body.closing, /taken off/);
  const u = upd(io10, "settings/crewRoster"); const last = u[u.length - 1];
  assert.deepStrictEqual(Object.keys(last).sort(), ["merged", "names", "tab", "updatedAt"]); assert.ok(last.tab.startsWith("duet-ship11-u"));
  const ed = await run(io10, "crewTeams.set", { op: "edit", teamId: "t1", members: ["Abe", "Colby"] }, "ship11-tm-1");
  assert.strictEqual(ed.status, 200); assert.deepStrictEqual(io10.store["settings/crewTeams"].teams[0].members, ["Abe", "Colby"]);
  const r2 = await run(io10, "undo.apply", { requestId: "ship11-tm-1" }, "ship11-undo-tm-1");
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); assert.deepStrictEqual(io10.store["settings/crewTeams"].teams, [{ id: "t1", lead: "Keegan", members: ["Abe"] }]);
  const tadd = await run(io10, "crewTeams.set", { op: "add", lead: "Colby", members: ["Abe"] }, "ship11-tm-2");
  assert.strictEqual(tadd.status, 200); assert.strictEqual(io10.store["settings/crewTeams"].teams.length, 2);
  const r3 = await run(io10, "undo.apply", { requestId: "ship11-tm-2" }, "ship11-undo-tm-2");
  assert.strictEqual(r3.status, 200, JSON.stringify(r3.body)); assert.strictEqual(io10.store["settings/crewTeams"].teams.length, 1); assert.match(r3.body.closing, /removed/);
  const trm = await run(io10, "crewTeams.set", { op: "remove", teamId: "t1" }, "ship11-tm-3");
  assert.strictEqual(trm.status, 200);
  const r4 = await run(io10, "undo.apply", { requestId: "ship11-tm-3" });
  assert.strictEqual(r4.status, 400); assert.match(r4.body.refused, /add it again/);
  const upEd = await run(io10, "upcoming.edit", { id: "1761000000001", notes: "Hole dug", city: "Park City" }, "ship11-up-2");
  assert.strictEqual(upEd.status, 200, JSON.stringify(upEd.body));
  const r5 = await run(io10, "undo.apply", { requestId: "ship11-up-2" }, "ship11-undo-up-2");
  assert.strictEqual(r5.status, 200, JSON.stringify(r5.body)); assert.strictEqual(io10.store["settings/upcoming_jobs"].items[0].notes, ""); assert.strictEqual(io10.store["settings/upcoming_jobs"].items[0].city, "Heber");
  assert.ok(upd(io10, "settings/upcoming_jobs").pop().updated_at === NOW, "the pipeline's own updated_at rides along as the original did");
});
await ok("undo of a Crew Planner cell: assign made the week doc + the cell; the undo writes the ONE cell key back to its before (null → FieldValue.delete on that key, the planner's own rule) with the settings stamp", async () => {
  const io11 = fakeIo();
  const as = await run(io11, "crew.assign", { jobId: FORTH, date: "2026-11-11", person: "Colby" }, "ship11-cr-1");
  assert.strictEqual(as.status, 200, JSON.stringify(as.body)); assert.strictEqual(as.body.newWeekDoc, true);
  const key = as.body.key;
  assert.ok(io11.store["settings/schedule_2026-11-09"].assignments[key]);
  const r = await run(io11, "undo.apply", { requestId: "ship11-cr-1" }, "ship11-undo-cr-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.cellDeleted, true);
  const u = upd(io11, "settings/schedule_2026-11-09")[0];
  assert.deepStrictEqual(u["assignments." + key], { __delete: true }); assert.ok(u.updatedAt && u.tab.startsWith("duet-") && u.merged === false);
  assert.strictEqual(io11.store["settings/schedule_2026-11-09"].assignments[key], undefined);
  assert.strictEqual(io11.store["duet_writes/ship11-cr-1"].undoneBy, "ship11-undo-cr-1");
});
await ok("undo of job.archive is allowed on the (now archived) job — that IS the reversal; job.setField on an archived job still refuses; undo of an import = the job archived (Duet's reversible shape), the inbox entry not restored", async () => {
  const io12 = fakeIo();
  const arc = await run(io12, "job.archive", { jobId: FORTH, archived: true, force: true }, "ship11-arc-1");
  assert.strictEqual(arc.status, 200, JSON.stringify(arc.body)); assert.strictEqual(io12.store["jobs/" + FORTH].data.archived, true);
  const sf = await run(io12, "job.setField", { jobId: FORTH, field: "flagNote", value: "x" });
  assert.strictEqual(sf.status, 400); assert.match(sf.body.refused, /archived/);
  const r = await run(io12, "undo.apply", { requestId: "ship11-arc-1" }, "ship11-undo-arc-1");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const d = io12.store["jobs/" + FORTH].data;
  assert.strictEqual(d.archived, undefined); assert.strictEqual(d.archivedAt, undefined); assert.strictEqual(d.archivedBy, undefined, "the keys weren't there before → put back as absent");
  // an import: make the audit the way jobSetup() writes it, on a job that exists
  io12.store["duet_writes/import-0001"] = { at: NOW, requestId: "import-0001", ok: true, action: "job.createFromSimpro", coll: "jobs", docId: FORTH, newDoc: true, fields: ["id", "name"], before: null, after: { name: "Forth" }, candidateRemoved: "1500" };
  const r2 = await run(io12, "undo.apply", { requestId: "import-0001" }, "ship11-undo-imp-1");
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); assert.strictEqual(io12.store["jobs/" + FORTH].data.archived, true); assert.strictEqual(io12.store["jobs/" + FORTH].data.archivedBy, "Koy"); assert.match(r2.body.closing, /archived/); assert.ok(r2.body.notes.some(x => /inbox entry/.test(x)));
});

// ── 7. guardrails and pins ───────────────────────────────────────────────────
await ok("across every scenario: only jobs / needs / settings (allowed docs) / duet_writes were written, never a delete, no tx.create from an undo, every settings doc opened is on SETTINGS_DOCS", async () => {
  const io13 = fakeIo();
  await run(io13, "job.setField", { jobId: FORTH, field: "flagged", value: true }, "guard-0001");
  await run(io13, "undo.apply", { requestId: "guard-0001" }, "guard-0002");
  await run(io13, "crewRoster.set", { op: "add", name: "josh" }, "guard-0003");
  await run(io13, "undo.apply", { requestId: "guard-0003" }, "guard-0004");
  const writes = writesOf(io13);
  assert.ok(writes.every(w => w[1] === "jobs/" + FORTH || w[1] === "settings/crewRoster" || w[1].startsWith("duet_writes/")), writes.map(w => w[1]).join(","));
  assert.ok(!io13.log.some(l => l[0] === "delete")); assert.ok(!io13.log.some(l => l[0] === "create"));
  assert.ok(io13.log.filter(l => l[0] === "settingsRef").every(l => api.settingsDocAllowed(l[1])));
  assert.strictEqual(io13.store["jobs/" + FORTH].data.flagged, false);
});
await ok("api.js: job.setField rides JOB_WRITE_ACTIONS (one jobWrite transaction), undo.apply is its own; BUILD 610; SETTINGS_DOCS unchanged; exactly four .delete( and seven tx.create( (ship 12 added the door's), one tx.delete (the door's); fieldPolicy.js / undo.js import no Firebase", () => {
  assert.deepStrictEqual(api.FIELD_ACTIONS, ["job.setField"]); assert.deepStrictEqual(api.UNDO_ACTIONS, ["undo.apply"]);
  assert.ok(api.JOB_WRITE_ACTIONS.includes("job.setField") && !api.JOB_WRITE_ACTIONS.includes("undo.apply") && api.ACTIONS.includes("undo.apply"));
  assert.ok(api.BUILD >= 610 && Number.isInteger(api.BUILD));
  assert.deepStrictEqual(api.SETTINGS_DOCS, { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: ["teams"], simproCandidates: ["candidates"], crewRoster: ["names"], upcoming_jobs: ["items", "updated_at"] });
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.strictEqual((src.match(/tx\.delete\(/g) || []).length, 1, "the ONLY tx.delete is the door's doc.delete (ship 12)"); assert.strictEqual((src.match(/\.delete\(/g) || []).length, 4); assert.strictEqual((src.match(/tx\.create\(/g) || []).length, 7);
  assert.strictEqual((src.match(/tx\.update\(io\.auditRef\(/g) || []).length, 1, "the undoneBy stamp is the only write to an existing audit doc");
  for (const f of ["fieldPolicy.js", "undo.js"]) { const t = fs.readFileSync(path.join(root, "functions", "duetWrites", f), "utf8"); assert.ok(!/require\(["']firebase|from ["']firebase/i.test(t), f + " imports no Firebase"); }
  assert.ok(!api.ACTIONS.includes("job.deleteField") && !api.ACTIONS.includes("undo.all"));
});

console.log(`duet-field-undo-test: ${n} checks passed`);
})().catch((e) => { console.error("duet-field-undo-test FAILED:", e && e.stack || e); process.exit(1); });
