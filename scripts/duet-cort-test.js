#!/usr/bin/env node
/* duet-cort-test.js — Duet write access (connector D9), ship 2: change
 * orders, return trips and the job's status update.
 *
 * Drives functions/duetWrites/jobItems.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction holding a real-shaped job. Proves: a Duet-made CO is key for
 * key the submitDraft doc; edits never touch status / quote number /
 * taskChecks; setStatus clears exactly what the app's setStatus clears;
 * CO → trip is ONE write with both arrays, the RT carrying everything the
 * app's convertToRT carries (photos as refs with fresh ids); a Duet-made
 * trip is the + button's blank plus the same upd() patches; trip updates
 * derive rtScheduled / needsSchedule like the status select; the status
 * update follows StatusUpdateTextarea.commit + the history append; every
 * other item in the array is byte-identical after a write; names are
 * checked; archived / missing jobs and unknown ids refuse; the same
 * requestId never writes twice; every write carries the job envelope
 * (newer updated_at, lastActivityAt, stamp, merged:false) and the audit
 * doc rides in the SAME transaction; only jobs + duet_writes are written;
 * nothing is ever deleted. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const JI = require(path.join(root, "functions", "duetWrites", "jobItems.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-03T20:15:00.000Z";          // 1:15 PM Mountain
const USERS = [
  { id: 1, name: "Koy", title: "office", access: "admin" },
  { id: 2, name: "Josh", title: "office", access: "manager" },
  { id: 3, name: "Colby", title: "foreman" },
  { id: 4, name: "Keegan", title: "foreman" },
  { id: 6, name: "Dan A", title: "crew" }, { id: 7, name: "Dan B", title: "crew" },
  { id: 8, name: "Old Guy", title: "crew", active: false },
];
const CO1 = { id: "1762198800001", date: "", desc: "Add two can lights in the pantry", task: "Run 14/2 from the kitchen circuit", material: "2 wafer lights", materialSource: "CED", time: "1.5 hrs", sendTo: "GC", photos: [{ id: "p1", name: "pantry.jpg", url: "https://x/pantry.jpg", storagePath: "co-photos/1/pantry.jpg", type: "image/jpeg" }], coStatus: "approved", coStatusDate: "", needsHardDate: true, needsByStart: "2026-11-10", needsByEnd: "2026-11-12", createdBy: "Keegan", createdAt: "10/28/2026", submittedAt: "2026-10-28T15:00:00.000Z", submittedBy: "Keegan", quoteNumber: "4512", quoteAddedBy: "Jeromy", quoteAddedAt: "2026-10-29T10:00:00.000Z" };
const CO2 = { id: "1762198800002", date: "", desc: "Move the island receptacle", task: "", material: "", materialSource: "", time: "", sendTo: "", photos: [], coStatus: "needs_sending", coStatusDate: "", needsHardDate: false, needsByStart: "", needsByEnd: "", createdBy: "Koy", createdAt: "11/1/2026", submittedAt: "2026-11-01T15:00:00.000Z", submittedBy: "Koy", quoteNumber: "", quoteAddedBy: "", quoteAddedAt: "" };
const CO3 = { ...CO2, id: "1762198800003", desc: "Already converted one", coStatus: "converted", convertUndoneAt: "" };
const RT1 = { id: "1762198900001", date: "", scope: "Trim out the basement bath", material: "", punch: [], photos: [], assignedTo: "Colby", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "", rtStatus: "needs", rtStatusDate: "2026-11-14", needsHardDate: false, needsByStart: "", needsByEnd: "" };
const RT2 = { ...RT1, id: "1762198900002", scope: "Signed one", signedOff: true, signedOffBy: "Colby", signedOffDate: "2026-10-30", rtStatus: "complete", rtStatusDate: "" };
const JOB = { id: "1772863862618", data: { name: "Forth", foreman: "Keegan", lead: "Colby", archived: false, deleted: false, changeOrders: [CO1, CO2, CO3], returnTrips: [RT1, RT2], statusUpdate: "Waiting on the GC for the panel wall", statusUpdateBy: "Josh", statusUpdateAt: "2026-11-02T16:00:00.000Z", statusUpdateHistory: [{ text: "Rough starts Monday", by: "Koy", at: "2026-10-20T16:00:00.000Z" }, { text: "Waiting on the GC for the panel wall", by: "Josh", at: "2026-11-02T16:00:00.000Z" }] } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const ctx = (job) => ({ nowIso: NOW, users: USERS, tz: "America/Denver", job: job === undefined ? clone(JOB) : job });

// ── planners ─────────────────────────────────────────────────────────────────
ok("newItemId: the app's uid() shape (ms as a string), bumped past ids already in the array", () => {
  assert.strictEqual(JI.newItemId(1762200000000, ["1762199999999"]), "1762200000000");
  assert.strictEqual(JI.newItemId(1762200000000, ["1762200000000", "1762200000001"]), "1762200000002");
});
ok("mdy: createdAt is the phone's M/D/YYYY in Mountain time (an evening UTC stamp stays the same day)", () => {
  assert.strictEqual(JI.mdy(NOW, "America/Denver"), "11/3/2026");
  assert.strictEqual(JI.mdy("2026-11-04T03:30:00.000Z", "America/Denver"), "11/3/2026");
});
ok("planCreateCO: exactly submitDraft's doc, key for key, Koy as creator + submitter, appended last", () => {
  const r = JI.planCreateCO({ desc: "Add a floor outlet in the office", task: "Core the slab", material: "1 floor box", materialSource: "CED", time: "3 hrs", sendTo: "GC" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.co, {
    id: String(Date.parse(NOW)), date: "", desc: "Add a floor outlet in the office", task: "Core the slab", material: "1 floor box", materialSource: "CED", time: "3 hrs", sendTo: "GC",
    photos: [], coStatus: "needs_sending", coStatusDate: "", needsHardDate: false, needsByStart: "", needsByEnd: "",
    createdBy: "Koy", createdAt: "11/3/2026", submittedAt: NOW, submittedBy: "Koy", quoteNumber: "", quoteAddedBy: "", quoteAddedAt: "",
  });
  assert.deepStrictEqual(Object.keys(r.co), ["id", "date", "desc", "task", "material", "materialSource", "time", "sendTo", "photos", "coStatus", "coStatusDate", "needsHardDate", "needsByStart", "needsByEnd", "createdBy", "createdAt", "submittedAt", "submittedBy", "quoteNumber", "quoteAddedBy", "quoteAddedAt"]);
  assert.strictEqual(r.number, 4); assert.strictEqual(r.changeOrders.length, 4);
  assert.deepStrictEqual(r.changeOrders.slice(0, 3), [CO1, CO2, CO3], "the other COs are untouched");
  const minimal = JI.planCreateCO({ desc: "Just a description" }, ctx());
  assert.strictEqual(minimal.co.task, ""); assert.strictEqual(minimal.co.sendTo, "");
});
ok("planCreateCO: refuses no desc, non-text fields, archived / missing job", () => {
  assert.match(JI.planCreateCO({ task: "x" }, ctx()).refused, /needs a description/);
  assert.match(JI.planCreateCO({ desc: { html: "x" } }, ctx()).refused, /must be text/);
  assert.match(JI.planCreateCO({ desc: "x" }, ctx({ id: "1", data: { ...JOB.data, archived: true } })).refused, /archived/);
  assert.match(JI.planCreateCO({ desc: "x" }, ctx(null)).refused, /doesn't exist/);
});
ok("planEditCO: text + window edits by id; never status / quote # / taskChecks; converted CO refuses; window only when approved or scheduled", () => {
  const r = JI.planEditCO({ coId: CO1.id, task: "Run 12/2 instead", needsByEnd: "2026-11-13", needsHardDate: false }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.changed.sort(), ["needsByEnd", "needsHardDate", "task"]);
  assert.deepStrictEqual(r.co, { ...CO1, task: "Run 12/2 instead", needsByEnd: "2026-11-13", needsHardDate: false });
  assert.deepStrictEqual(r.changeOrders[1], CO2); assert.deepStrictEqual(r.changeOrders[2], CO3);
  assert.match(JI.planEditCO({ coId: CO1.id, coStatus: "denied" }, ctx()).refused, /co\.setStatus/);
  assert.match(JI.planEditCO({ coId: CO1.id, quoteNumber: "1" }, ctx()).refused, /can't be changed/);
  assert.match(JI.planEditCO({ coId: CO1.id, taskChecks: {} }, ctx()).refused, /can't be changed/);
  assert.match(JI.planEditCO({ coId: CO3.id, desc: "x" }, ctx()).refused, /converted/);
  assert.match(JI.planEditCO({ coId: CO2.id, needsByStart: "2026-11-10" }, ctx()).refused, /approved or scheduled/);
  assert.match(JI.planEditCO({ coId: CO1.id, needsByStart: "2026-11-20", needsByEnd: "2026-11-10" }, ctx()).refused, /before/);
  assert.match(JI.planEditCO({ coId: CO1.id, desc: "   " }, ctx()).refused, /blank/);
  assert.match(JI.planEditCO({ coId: "nope", desc: "x" }, ctx()).refused, /No change order/);
  assert.match(JI.planEditCO({ coId: CO1.id }, ctx()).refused, /Nothing to change/);
  assert.strictEqual(JI.planEditCO({ coId: CO1.id, task: CO1.task }, ctx()).noop, true);
});
ok("planSetCOStatus: setStatus semantics — date only on scheduled, window cleared unless approved | scheduled, no-op when already so", () => {
  const sched = JI.planSetCOStatus({ coId: CO1.id, status: "scheduled", date: "2026-11-11" }, ctx());
  assert.deepStrictEqual(sched.co, { ...CO1, coStatus: "scheduled", coStatusDate: "2026-11-11" }, "approved → scheduled keeps the needs-by window");
  assert.strictEqual(sched.from, "approved"); assert.strictEqual(sched.to, "scheduled");
  const keep = JI.planSetCOStatus({ coId: CO1.id, status: "scheduled" }, ctx({ ...clone(JOB), data: { ...clone(JOB.data), changeOrders: [{ ...CO1, coStatusDate: "2026-11-09" }] } }));
  assert.strictEqual(keep.co.coStatusDate, "2026-11-09", "no date given keeps the one on the card, as the app's select does");
  const done = JI.planSetCOStatus({ coId: CO1.id, status: "completed" }, ctx());
  assert.deepStrictEqual(done.co, { ...CO1, coStatus: "completed", coStatusDate: "", needsHardDate: false, needsByStart: "", needsByEnd: "" });
  assert.deepStrictEqual(done.changed.sort(), ["coStatus", "needsByEnd", "needsByStart", "needsHardDate"]);
  const appr = JI.planSetCOStatus({ coId: CO2.id, status: "approved" }, ctx());
  assert.deepStrictEqual(appr.co, { ...CO2, coStatus: "approved", coStatusDate: "" });
  assert.strictEqual(JI.planSetCOStatus({ coId: CO1.id, status: "approved" }, ctx()).noop, true);
  assert.match(JI.planSetCOStatus({ coId: CO1.id, status: "simpro_task" }, ctx()).refused, /status must be/);
  assert.match(JI.planSetCOStatus({ coId: CO1.id, status: "approved", date: "2026-11-11" }, ctx()).refused, /only scheduled/);
  assert.match(JI.planSetCOStatus({ coId: CO1.id, status: "scheduled", date: "11/11" }, ctx()).refused, /YYYY-MM-DD/);
});
ok("planConvertCO: ONE plan with both arrays — CO converted + convertUndoneAt cleared, RT carries desc/task/material/time/window/photos(fresh ids)/fromCOId, appended last", () => {
  const r = JI.planConvertCO({ coId: CO1.id }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.co, { ...CO1, coStatus: "converted", convertUndoneAt: "" });
  const rtId = String(Date.parse(NOW));
  assert.deepStrictEqual(r.rt, {
    id: rtId, scope: CO1.desc, task: CO1.task, material: CO1.material, materialSource: "CED", time: "1.5 hrs", assignedTo: "", rtStatus: "needs", rtStatusDate: "",
    needsHardDate: true, needsByStart: "2026-11-10", needsByEnd: "2026-11-12",
    notes: "Converted from Change Order #1 · Quote #4512 — Add two can lights in the pantry", fromCOId: CO1.id, punch: [],
    photos: [{ ...CO1.photos[0], id: String(Date.parse(NOW) + 1) }],
  });
  assert.deepStrictEqual(Object.keys(r.rt), ["id", "scope", "task", "material", "materialSource", "time", "assignedTo", "rtStatus", "rtStatusDate", "needsHardDate", "needsByStart", "needsByEnd", "notes", "fromCOId", "punch", "photos"], "convertToRT's key order");
  assert.strictEqual(r.rt.photos[0].storagePath, CO1.photos[0].storagePath, "a ref to the SAME Storage file");
  assert.deepStrictEqual(r.returnTrips, [RT1, RT2, r.rt]); assert.deepStrictEqual(r.changeOrders[1], CO2);
  assert.match(JI.planConvertCO({ coId: CO3.id }, ctx()).refused, /already converted/);
  const linked = ctx({ ...clone(JOB), data: { ...clone(JOB.data), returnTrips: [{ ...RT1, fromCOId: CO2.id }] } });
  assert.match(JI.planConvertCO({ coId: CO2.id }, linked).refused, /already converted/, "an RT pointing back counts as converted (coIsConverted)");
  const undone = ctx({ ...clone(JOB), data: { ...clone(JOB.data), returnTrips: [{ ...RT1, fromCOId: CO2.id }], changeOrders: [CO1, { ...CO2, convertUndoneAt: "2026-11-01T00:00:00.000Z" }] } });
  assert.ok(!JI.planConvertCO({ coId: CO2.id }, undone).refused, "a deliberate undo lets it convert again");
  assert.match(JI.planConvertCO({ coId: "x" }, ctx()).refused, /No change order/);
});
ok("planCreateRT: the + button's blank trip plus the same upd() patches; scope required; name checked; date needs a dated status", () => {
  const r = JI.planCreateRT({ scope: "Hang the pendant the GC supplied", assignedTo: "colby", rtStatus: "scheduled", rtStatusDate: "2026-11-12", time: "2 hrs" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.rt, { id: String(Date.parse(NOW)), date: "", scope: "Hang the pendant the GC supplied", material: "", punch: [], photos: [], assignedTo: "Colby", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: false, needsScheduleDate: "", rtScheduled: true, scheduledDate: "", rtStatus: "scheduled", rtStatusDate: "2026-11-12", needsByStart: "", needsByEnd: "", needsHardDate: false, time: "2 hrs" });
  assert.strictEqual(r.number, 3); assert.deepStrictEqual(r.returnTrips.slice(0, 2), [RT1, RT2]);
  const bare = JI.planCreateRT({ scope: "Just a scope" }, ctx());
  assert.deepStrictEqual(bare.rt, { id: String(Date.parse(NOW)), date: "", scope: "Just a scope", material: "", punch: [], photos: [], assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: false, needsScheduleDate: "", rtScheduled: false, scheduledDate: "" }, "add()'s exact blank + scope");
  assert.match(JI.planCreateRT({ assignedTo: "Colby" }, ctx()).refused, /needs a scope/);
  assert.match(JI.planCreateRT({ scope: "x", assignedTo: "Zed" }, ctx()).refused, /isn't on the active team list/);
  assert.match(JI.planCreateRT({ scope: "x", assignedTo: "Dan" }, ctx()).refused, /more than one/);
  assert.match(JI.planCreateRT({ scope: "x", rtStatusDate: "2026-11-12" }, ctx()).refused, /needs the trip to be/);
  assert.match(JI.planCreateRT({ scope: "x", rtStatus: "done" }, ctx()).refused, /rtStatus must be/);
});
ok("planUpdateRT: the status select's patch (derived flags, date kept only when dated, scheduled clears the window), date / assignee / text by id; signed-off trips refuse", () => {
  const s = JI.planUpdateRT({ rtId: RT1.id, rtStatus: "scheduled" }, ctx());
  assert.deepStrictEqual(s.rt, { ...RT1, rtStatus: "scheduled", rtScheduled: true, needsSchedule: false, rtStatusDate: "2026-11-14", needsByStart: "", needsByEnd: "", needsHardDate: false });
  assert.deepStrictEqual(s.changed.sort(), ["needsSchedule", "rtScheduled", "rtStatus"]);
  const c = JI.planUpdateRT({ rtId: RT1.id, rtStatus: "complete" }, ctx());
  assert.strictEqual(c.rt.rtStatusDate, "", "complete takes no date → cleared, as the select does");
  assert.strictEqual(c.rt.rtScheduled, false); assert.strictEqual(c.rt.needsSchedule, false);
  const who = JI.planUpdateRT({ rtId: RT1.id, assignedTo: "keegan", rtStatusDate: "2026-11-15" }, ctx());
  assert.strictEqual(who.rt.assignedTo, "Keegan"); assert.strictEqual(who.rt.rtStatusDate, "2026-11-15"); assert.strictEqual(who.pushTo, "Keegan");
  assert.deepStrictEqual(who.returnTrips[1], RT2, "the other trip is byte-identical");
  const un = JI.planUpdateRT({ rtId: RT1.id, assignedTo: "" }, ctx());
  assert.strictEqual(un.rt.assignedTo, ""); assert.strictEqual(un.pushTo, null);
  const txt = JI.planUpdateRT({ rtId: RT1.id, notes: "GC wants it before the 20th", task: "Bring the 6\" trim" }, ctx());
  assert.strictEqual(txt.rt.notes, "GC wants it before the 20th"); assert.strictEqual(txt.rt.task, "Bring the 6\" trim");
  assert.strictEqual(JI.planUpdateRT({ rtId: RT1.id, assignedTo: "Colby", rtStatus: "needs" }, ctx()).noop, true);
  assert.match(JI.planUpdateRT({ rtId: RT2.id, assignedTo: "Koy" }, ctx()).refused, /signed off/);
  assert.match(JI.planUpdateRT({ rtId: RT1.id, signedOff: true }, ctx()).refused, /can't be changed/);
  assert.match(JI.planUpdateRT({ rtId: RT1.id, punch: [] }, ctx()).refused, /can't be changed/);
  assert.match(JI.planUpdateRT({ rtId: RT1.id, scope: "" }, ctx()).refused, /blank/);
  assert.match(JI.planUpdateRT({ rtId: RT1.id }, ctx()).refused, /Nothing to change/);
  assert.match(JI.planUpdateRT({ rtId: "x", rtStatus: "needs" }, ctx()).refused, /No return trip/);
  const unset = ctx({ ...clone(JOB), data: { ...clone(JOB.data), returnTrips: [{ ...RT1, rtStatus: "", rtStatusDate: "" }] } });
  assert.match(JI.planUpdateRT({ rtId: RT1.id, rtStatusDate: "2026-11-15" }, unset).refused, /Set rtStatus in the same call/);
});
ok("planSetStatusUpdate: new text stamps Koy + now and appends to history; same text → no-op; blank clears by/at with no history row; history capped at 50", () => {
  const r = JI.planSetStatusUpdate({ text: "  Panel wall settled — rough resumes Thursday  " }, ctx());
  assert.deepStrictEqual(r.fields, { statusUpdate: "Panel wall settled — rough resumes Thursday", statusUpdateBy: "Koy", statusUpdateAt: NOW, statusUpdateHistory: [...JOB.data.statusUpdateHistory, { text: "Panel wall settled — rough resumes Thursday", by: "Koy", at: NOW }] });
  assert.deepStrictEqual(r.before.statusUpdateBy, "Josh"); assert.deepStrictEqual(r.changed.sort(), ["statusUpdate", "statusUpdateAt", "statusUpdateBy"]);
  assert.strictEqual(JI.planSetStatusUpdate({ text: "Waiting on the GC for the panel wall" }, ctx()).noop, true);
  const clear = JI.planSetStatusUpdate({ text: "" }, ctx());
  assert.deepStrictEqual(clear.fields, { statusUpdate: "", statusUpdateBy: "", statusUpdateAt: "" });
  const again = JI.planSetStatusUpdate({ text: "Rough starts Monday" }, ctx({ ...clone(JOB), data: { ...clone(JOB.data), statusUpdate: "", statusUpdateHistory: [{ text: "Rough starts Monday", by: "Koy", at: "x" }] } }));
  assert.strictEqual(again.fields.statusUpdateHistory, undefined, "same as the last history row → no new row (the onCommit rule)");
  const big = ctx({ ...clone(JOB), data: { ...clone(JOB.data), statusUpdateHistory: Array.from({ length: 60 }, (_, i) => ({ text: "t" + i, by: "Koy", at: "x" })) } });
  assert.strictEqual(JI.planSetStatusUpdate({ text: "new" }, big).fields.statusUpdateHistory.length, 50);
  assert.match(JI.planSetStatusUpdate({}, ctx()).refused, /text is required/);
  assert.match(JI.planSetStatusUpdate({ text: "x" }, ctx(null)).refused, /doesn't exist/);
});

// ── api.handle against a fake Firestore ──────────────────────────────────────
function fakeIo({ docs = {}, recent = 0, users = USERS } = {}) {
  const log = [];
  const store = { ...docs };
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path]); if (store[r.path]) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } store[r.path] = d; },
    update: (r, d) => {
      log.push(["update", r.path, d]);
      const cur = clone(store[r.path] || {});
      Object.keys(d).forEach(k => { if (k.startsWith("data.")) cur.data[k.slice(5)] = d[k]; else cur[k] = d[k]; });
      store[r.path] = cur;
    },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store,
    nowIso: () => NOW, todayYmd: () => "2026-11-03", rand: () => "abcde", tz: "America/Denver",
    getAudit: async (id) => store["duet_writes/" + id] || null,
    countRecent: async () => recent,
    getJob: async () => null,
    getUsers: async () => users,
    openNeeds: async () => [],
    runTx: async (fn) => fn(tx),
    needRef: (id) => ref("needs", id),
    jobRef: (id) => ref("jobs", id),
    auditRef: (id) => ref("duet_writes", id),
    arrayUnion: (...x) => ({ __arrayUnion: x }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
}
const JOB_DOC = () => ({ data: clone(JOB.data), updated_at: "2026-11-03T20:15:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 600, w: "600.abcdefgh" });
const jobIo = (extra) => fakeIo({ docs: { ["jobs/" + JOB.id]: JOB_DOC() }, ...(extra || {}) });
const run = (body, io) => api.handle(body, io);
const RID = "22222222-2222-4222-8222-222222222222";
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];

(async () => {
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "co.create", email: "koy@homesteadelectric.net", args: { jobId: JOB.id, desc: "Add a floor outlet in the office", task: "Core the slab", time: "3 hrs" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.number, 4); assert.strictEqual(r.body.jobName, "Forth");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), [...ENVELOPE, "data.changeOrders"].sort(), "ONE dotted array key + the job envelope");
    assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.strictEqual(upd.merged, false); assert.ok(upd.tab.startsWith("duet-2222"));
    assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 601 && /^\d+\.duet[a-z0-9]{6,}$/.test(upd.w), "version-lock stamp");
    assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true }, "lastActivityAt like every app job write");
    assert.ok(upd.updated_at > "2026-11-03T20:15:00.000Z", "updated_at strictly newer than the doc's");
    assert.strictEqual(upd["data.changeOrders"].length, 4); assert.deepStrictEqual(upd["data.changeOrders"].slice(0, 3), [CO1, CO2, CO3]);
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.coll, "jobs"); assert.strictEqual(audit.docId, JOB.id); assert.deepStrictEqual(audit.fields, ["changeOrders"]); assert.strictEqual(audit.itemId, r.body.coId);
    assert.strictEqual(audit.before.changeOrders, null); assert.strictEqual(audit.after.changeOrders.desc, "Add a floor outlet in the office");
    assert.deepStrictEqual(io.log.map(l => l[0]), ["get", "update", "set"], "read, write, audit — one transaction");
    assert.strictEqual(io.store["jobs/" + JOB.id].data.changeOrders.length, 4);
    n++; console.log("ok   handle co.create: read-modify-write, dotted data.changeOrders, job envelope, item-level audit in one tx");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "co.setStatus", args: { jobId: JOB.id, coId: CO2.id, status: "approved" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body.pushTo, ["lead", "foreman", "coordinator"]); assert.strictEqual(r.body.from, "needs_sending");
    const arr = io.log.find(l => l[0] === "update")[2]["data.changeOrders"];
    assert.deepStrictEqual(arr[0], CO1); assert.deepStrictEqual(arr[2], CO3); assert.strictEqual(arr[1].coStatus, "approved");
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.before.changeOrders.coStatus, "needs_sending"); assert.strictEqual(audit.after.changeOrders.coStatus, "approved");
    const again = await run({ requestId: RID, action: "co.setStatus", args: { jobId: JOB.id, coId: CO2.id, status: "denied" } }, io);
    assert.strictEqual(again.body.replayed, true); assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1, "same requestId → nothing written, even with different args");
    const noop = await run({ requestId: RID + "n", action: "co.setStatus", args: { jobId: JOB.id, coId: CO1.id, status: "approved" } }, jobIo());
    assert.strictEqual(noop.body.noop, true);
    n++; console.log("ok   handle co.setStatus: only that CO changes, before/after audited, replay writes nothing, no-op audited only");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "co.convert", args: { jobId: JOB.id, coId: CO1.id } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.photosCarried, 1); assert.strictEqual(r.body.rtNumber, 3);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")).sort(), ["data.changeOrders", "data.returnTrips"], "both arrays in ONE write");
    assert.strictEqual(upd["data.changeOrders"][0].coStatus, "converted"); assert.strictEqual(upd["data.returnTrips"][2].fromCOId, CO1.id);
    assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1);
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual(audit.fields, ["changeOrders", "returnTrips"]); assert.strictEqual(audit.before.returnTrips, null); assert.strictEqual(audit.after.returnTrips.id, r.body.rtId);
    const twice = await run({ requestId: RID + "2", action: "co.convert", args: { jobId: JOB.id, coId: CO1.id } }, io);
    assert.strictEqual(twice.status, 400); assert.match(twice.body.refused, /already converted/);
    n++; console.log("ok   handle co.convert: CO marked converted AND the RT appended in one transaction write; converting again refuses");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "rt.create", args: { jobId: JOB.id, scope: "Hang the pendant", assignedTo: "colby", rtStatus: "scheduled", rtStatusDate: "2026-11-12" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.pushTo, "Colby"); assert.strictEqual(r.body.number, 3);
    const u2 = await run({ requestId: RID + "u", action: "rt.update", args: { jobId: JOB.id, rtId: r.body.rtId, assignedTo: "Keegan", notes: "GC supplies the fixture" } }, io);
    assert.strictEqual(u2.status, 200, JSON.stringify(u2.body)); assert.strictEqual(u2.body.pushTo, "Keegan"); assert.deepStrictEqual(u2.body.changed.sort(), ["assignedTo", "notes"]);
    const trips = io.store["jobs/" + JOB.id].data.returnTrips;
    assert.strictEqual(trips.length, 3); assert.deepStrictEqual(trips[0], RT1); assert.deepStrictEqual(trips[1], RT2); assert.strictEqual(trips[2].assignedTo, "Keegan"); assert.strictEqual(trips[2].rtScheduled, true);
    const signed = await run({ requestId: RID + "s", action: "rt.update", args: { jobId: JOB.id, rtId: RT2.id, assignedTo: "Koy" } }, io);
    assert.strictEqual(signed.status, 400); assert.match(signed.body.refused, /signed off/);
    n++; console.log("ok   handle rt.create + rt.update: appended then edited by id, the other trips byte-identical, signed-off refuses");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "job.setStatusUpdate", args: { jobId: JOB.id, text: "Rough resumes Thursday" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.statusUpdateBy, "Koy"); assert.strictEqual(r.body.historyLength, 3);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")).sort(), ["data.statusUpdate", "data.statusUpdateAt", "data.statusUpdateBy", "data.statusUpdateHistory"]);
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.before.statusUpdate, "Waiting on the GC for the panel wall"); assert.strictEqual(audit.after.statusUpdate, "Rough resumes Thursday");
    n++; console.log("ok   handle job.setStatusUpdate: scalar + stamps + history as dotted keys, before/after audited");
  })();
  await (async () => {
    const missing = await run({ requestId: RID, action: "co.create", args: { jobId: "1999999999999", desc: "x" } }, jobIo());
    assert.strictEqual(missing.status, 404); assert.match(missing.body.refused, /doesn't exist/);
    const io = jobIo();
    const bad = await run({ requestId: RID + "b", action: "co.create", args: { jobId: "../settings/users", desc: "x" } }, io);
    assert.strictEqual(bad.status, 400); assert.strictEqual(io.log.filter(l => l[0] === "get").length, 0, "a path-shaped jobId never reaches a read");
    assert.strictEqual(io.store["duet_writes/" + RID + "b"].ok, false, "…but is audited like any input refusal");
    const arch = fakeIo({ docs: { ["jobs/" + JOB.id]: { ...JOB_DOC(), data: { ...clone(JOB.data), archived: true } } } });
    const a = await run({ requestId: RID + "a", action: "rt.create", args: { jobId: JOB.id, scope: "x" } }, arch);
    assert.strictEqual(a.status, 400); assert.match(a.body.refused, /archived/); assert.strictEqual(arch.log.filter(l => l[0] === "update").length, 0);
    const noData = fakeIo({ docs: { ["jobs/" + JOB.id]: { updated_at: NOW } } });
    const nd = await run({ requestId: RID + "d", action: "rt.create", args: { jobId: JOB.id, scope: "x" } }, noData);
    assert.strictEqual(nd.status, 404);
    const unknown = await run({ requestId: RID + "k", action: "co.edit", args: { jobId: JOB.id, coId: "nope", desc: "x" } }, jobIo());
    assert.strictEqual(unknown.status, 400); assert.match(unknown.body.refused, /No change order/);
    n++; console.log("ok   handle: missing job → 404, archived / no-data / unknown item refuse with nothing written, path-shaped jobId never read");
  })();
  await (async () => {
    const io = jobIo();
    for (const [i, body] of [
      { action: "co.create", args: { jobId: JOB.id, desc: "a" } },
      { action: "co.edit", args: { jobId: JOB.id, coId: CO2.id, task: "b" } },
      { action: "co.setStatus", args: { jobId: JOB.id, coId: CO2.id, status: "pending" } },
      { action: "co.convert", args: { jobId: JOB.id, coId: CO2.id } },
      { action: "rt.create", args: { jobId: JOB.id, scope: "c" } },
      { action: "rt.update", args: { jobId: JOB.id, rtId: RT1.id, rtStatus: "scheduled" } },
      { action: "job.setStatusUpdate", args: { jobId: JOB.id, text: "d" } },
    ].entries()) {
      const r = await run({ requestId: RID + i, ...body }, io);
      assert.strictEqual(r.status, 200, body.action + ": " + JSON.stringify(r.body));
    }
    const writes = io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));
    assert.ok(writes.every(w => w[1] === "jobs/" + JOB.id || w[1].startsWith("duet_writes/")), "only jobs/<id> + duet_writes written");
    assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create"), "never a delete, never a job create");
    const job = io.store["jobs/" + JOB.id].data;
    assert.strictEqual(job.changeOrders.length, 4); assert.strictEqual(job.returnTrips.length, 4); assert.strictEqual(job.name, "Forth"); assert.strictEqual(job.foreman, "Keegan");
    assert.strictEqual(job.changeOrders[1].coStatus, "converted"); assert.strictEqual(job.returnTrips[3].scope, "c");
    assert.ok(io.log.filter(l => l[0] === "update").every(l => Object.keys(l[2]).every(k => k.startsWith("data.") ? ["changeOrders", "returnTrips", "statusUpdate", "statusUpdateBy", "statusUpdateAt", "statusUpdateHistory"].includes(k.slice(5)) : ENVELOPE.includes(k))), "no other job field is ever written");
    n++; console.log("ok   handle: all seven actions in a row touch only jobs/<id> + duet_writes, never delete or create a job, never another field");
  })();
  await (async () => {
    assert.deepStrictEqual(api.JOB_ACTIONS, ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"]);
    assert.ok(api.ACTIONS.includes("task.create") && api.ACTIONS.includes("task.update"));
    await assert.rejects(run({ requestId: RID, action: "rt.signOff", args: {} }, jobIo()), (e) => e.status === 400 && /action must be/.test(e.message));
    await assert.rejects(run({ requestId: RID, action: "co.delete", args: {} }, jobIo()), (e) => e.status === 400);
    n++; console.log("ok   handle: no sign-off, delete or job-create action exists");
  })();
  console.log(`duet-cort-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
