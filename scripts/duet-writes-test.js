#!/usr/bin/env node
/* duet-writes-test.js — Duet write access (connector D9), ship 1: tasks.
 *
 * Drives the exact files that ship: src/needShape.js (the task shape the app
 * writes), functions/duetWrites/needs.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction. Proves: a Duet-made task is byte-for-byte the NeedQuickAdd
 * shape; patches follow patchNeed / addNeedUpdate; names are checked against
 * the team list; archived / missing jobs refuse; duplicates refuse; the same
 * requestId never writes twice; every write carries the version-lock stamp
 * and a strictly newer updated_at; the audit doc rides in the SAME
 * transaction; nothing is ever deleted; only needs + duet_writes are written.
 * No Firebase import anywhere. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const NS = require(path.join(root, "src", "needShape.js"));
const NSF = require(path.join(root, "functions", "needShape.js"));
const needs = require(path.join(root, "functions", "duetWrites", "needs.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };

// ── needShape (the app's own builders) ───────────────────────────────────────
const NOW = "2026-11-03T20:15:00.000Z";
const TODAY_NOON = "2026-11-03T12:00:00";   // what api.js passes: Mountain "today" at noon
ok("functions/needShape.js exports the same surface as src/needShape.js", () => {
  assert.deepStrictEqual(Object.keys(NSF).sort(), Object.keys(NS).sort());
});
ok("dueBucketFromDate: today / tomorrow → tomorrow, later → week, blank → null, junk → null", () => {
  assert.strictEqual(NS.dueBucketFromDate("2026-11-03", TODAY_NOON), "tomorrow");
  assert.strictEqual(NS.dueBucketFromDate("2026-11-04", TODAY_NOON), "tomorrow");
  assert.strictEqual(NS.dueBucketFromDate("2026-11-05", TODAY_NOON), "week");
  assert.strictEqual(NS.dueBucketFromDate("", TODAY_NOON), null);
  assert.strictEqual(NS.dueBucketFromDate("nope", TODAY_NOON), null);
});
ok("buildNeed: exactly NeedQuickAdd.save()'s doc, key for key", () => {
  const job = { id: "1772863862618", name: "Forth", foreman: "Keegan" };
  const got = NS.buildNeed({ kind: "need", text: "Order the 200A panel", dueBucket: "tomorrow", dueDate: "", priority: "urgent", assignedTo: "Josh", job, foremanIfNoJob: "" }, "Koy", NOW, "need_1_abcde");
  assert.deepStrictEqual(got, {
    id: "need_1_abcde", kind: "need", text: "Order the 200A panel", dueBucket: "tomorrow", dueDate: "", snoozedUntil: "", priority: "urgent",
    assignedTo: "Josh", assignedBy: "Koy", assignedAt: NOW, foreman: "Keegan", jobId: "1772863862618", jobName: "Forth",
    status: "open", createdBy: "Koy", createdAt: NOW, doneAt: "", doneBy: "",
  });
  assert.deepStrictEqual(Object.keys(got), ["id", "kind", "text", "dueBucket", "dueDate", "snoozedUntil", "priority", "assignedTo", "assignedBy", "assignedAt", "foreman", "jobId", "jobName", "status", "createdBy", "createdAt", "doneAt", "doneBy"]);
  const noJob = NS.buildNeed({ text: "x", priority: "weird", dueDate: "2026-11-20", assignedTo: "", job: null, foremanIfNoJob: "Daegan" }, "Koy", NOW, "need_2_x", TODAY_NOON);
  assert.strictEqual(noJob.priority, "", "unknown priority → normal");
  assert.strictEqual(noJob.dueBucket, "week", "a dated task buckets from its date");
  assert.strictEqual(noJob.foreman, "Daegan"); assert.strictEqual(noJob.jobId, ""); assert.strictEqual(noJob.kind, "need");
});
ok("needPatch: hand-off stamps assignedBy/At and ends Working; status flip ends Working; same person changes nothing", () => {
  const cur = { assignedTo: "Josh", status: "open", startedBy: "Josh", startedAt: "2026-11-03T10:00:00.000Z" };
  assert.deepStrictEqual(NS.needPatch({ assignedTo: "Brady" }, cur, "Koy", NOW), { assignedTo: "Brady", startedBy: "", startedAt: "", assignedBy: "Koy", assignedAt: NOW });
  assert.deepStrictEqual(NS.needPatch({ status: "done" }, cur, "Koy", NOW), { status: "done", startedBy: "", startedAt: "" });
  assert.deepStrictEqual(NS.needPatch({ assignedTo: "Josh Miller" }, cur, "Koy", NOW), { assignedTo: "Josh Miller", assignedBy: "Koy", assignedAt: NOW });
  assert.deepStrictEqual(NS.needPatch({ dueDate: "2026-11-04" }, cur, "Koy", NOW, TODAY_NOON), { dueDate: "2026-11-04", dueBucket: "tomorrow" });
});
ok("needUpdateEntry: assignee waiting + date snoozes; the other side's reply un-snoozes; blank → null", () => {
  const cur = { assignedTo: "Koy", snoozedUntil: "" };
  const w = NS.needUpdateEntry({ kind: "waiting", text: "CED", until: "2026-11-10" }, cur, "Koy", NOW);
  assert.deepStrictEqual(w, { entry: { by: "Koy", at: NOW, kind: "waiting", text: "CED", until: "2026-11-10" }, extra: { snoozedUntil: "2026-11-10" } });
  const r = NS.needUpdateEntry({ kind: "note", text: "done with it" }, { assignedTo: "Josh", snoozedUntil: "2026-11-10" }, "Koy", NOW);
  assert.deepStrictEqual(r, { entry: { by: "Koy", at: NOW, kind: "note", text: "done with it" }, extra: { snoozedUntil: "" } });
  assert.deepStrictEqual(NS.needUpdateEntry({ kind: "note", text: "   " }, cur, "Koy", NOW), { entry: null, extra: {} });
});
ok("normalizeNeed fills kind / dueBucket only", () => {
  assert.deepStrictEqual(NS.normalizeNeed({ id: "n", text: "t" }), { id: "n", text: "t", kind: "need", dueBucket: "week" });
  assert.deepStrictEqual(NS.normalizeNeed({ id: "n", dueDate: "2026-11-04", dueBucket: "week" }, TODAY_NOON).dueBucket, "tomorrow");
});

// ── planners ─────────────────────────────────────────────────────────────────
const USERS = [
  { id: 1, name: "Koy", title: "office", access: "admin" },
  { id: 2, name: "Josh", title: "office", access: "manager" },
  { id: 3, name: "Brady", title: "foreman" },
  { id: 4, name: "Keegan", title: "foreman" },
  { id: 5, name: "Daegan", title: "foreman" },
  { id: 6, name: "Dan A", title: "crew" }, { id: 7, name: "Dan B", title: "crew" },
  { id: 8, name: "Old Guy", title: "crew", active: false },
  { id: 9, name: "GC Contractor", access: "contractor" },
];
const JOB = { id: "1772863862618", name: "Forth", foreman: "Keegan", archived: false, deleted: false };
const ctx = (job) => ({ nowIso: NOW, bucketNow: TODAY_NOON, users: USERS, job: job === undefined ? JOB : job, rand: "abcde" });

ok("planCreateTask: a plain ask becomes a complete need on the job, assigned to Koy by default", () => {
  const r = needs.planCreateTask({ text: "Order the 200A panel", jobId: JOB.id }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.strictEqual(r.need.id, "need_" + Date.parse(NOW) + "_abcde");
  assert.strictEqual(r.need.assignedTo, "Koy"); assert.strictEqual(r.need.assignedBy, "Koy"); assert.strictEqual(r.need.createdBy, "Koy");
  assert.strictEqual(r.need.foreman, "Keegan"); assert.strictEqual(r.need.jobName, "Forth"); assert.strictEqual(r.need.dueBucket, "tomorrow");
  assert.strictEqual(r.need.status, "open"); assert.strictEqual(r.need.kind, "need");
});
ok("planCreateTask: names resolve to the team list's spelling; unknown / ambiguous / inactive / contractor refuse with nothing built", () => {
  assert.strictEqual(needs.planCreateTask({ text: "x", assignedTo: "josh" }, ctx(null)).need.assignedTo, "Josh");
  assert.match(needs.planCreateTask({ text: "x", assignedTo: "Dan" }, ctx(null)).refused, /more than one/);
  assert.match(needs.planCreateTask({ text: "x", assignedTo: "Zed" }, ctx(null)).refused, /isn't on the active team list/);
  assert.match(needs.planCreateTask({ text: "x", assignedTo: "Old Guy" }, ctx(null)).refused, /isn't on the active team list/);
  assert.match(needs.planCreateTask({ text: "x", assignedTo: "GC Contractor" }, ctx(null)).refused, /isn't on the active team list/);
  assert.match(needs.planCreateTask({ text: "x", assignedTo: "Kee" }, ctx(null)).refused, /Close: Keegan/, "typo gets a hint");
});
ok("planCreateTask: refuses blank text, bad date, bad enum, missing job, archived job", () => {
  assert.match(needs.planCreateTask({ text: "  " }, ctx(null)).refused, /needs text/);
  assert.match(needs.planCreateTask({ text: "x", dueDate: "11/4" }, ctx(null)).refused, /YYYY-MM-DD/);
  assert.match(needs.planCreateTask({ text: "x", priority: "high" }, ctx(null)).refused, /priority/);
  assert.match(needs.planCreateTask({ text: "x", kind: "chore" }, ctx(null)).refused, /kind/);
  assert.match(needs.planCreateTask({ text: "x", jobId: "999" }, ctx(null)).refused, /No Command Center job/);
  assert.match(needs.planCreateTask({ text: "x", jobId: JOB.id }, ctx({ ...JOB, archived: true })).refused, /archived/);
});
ok("planCreateTask: control characters stripped, text capped, dated task buckets by Mountain 'today'", () => {
  const r = needs.planCreateTask({ text: "a\u0000b\u0007c " + "x".repeat(3000), dueDate: "2026-11-12" }, ctx(null));
  assert.ok(r.need.text.startsWith("abc")); assert.strictEqual(r.need.text.length, 2000); assert.strictEqual(r.need.dueBucket, "week");
});
ok("isDuplicate: same words, job, person within 10 min → yes; older, other person or other job → no", () => {
  const need = { text: "Order the 200A panel", jobId: JOB.id, assignedTo: "Josh" };
  const recent = { text: " order the 200a PANEL ", jobId: JOB.id, assignedTo: "Josh", createdAt: "2026-11-03T20:10:00.000Z" };
  assert.strictEqual(needs.isDuplicate(need, [recent], NOW), true);
  assert.strictEqual(needs.isDuplicate(need, [{ ...recent, createdAt: "2026-11-03T19:00:00.000Z" }], NOW), false);
  assert.strictEqual(needs.isDuplicate(need, [{ ...recent, assignedTo: "Brady" }], NOW), false);
  assert.strictEqual(needs.isDuplicate(need, [{ ...recent, jobId: "other" }], NOW), false);
});

const CUR = { id: "need_1730650000001_ab12c", kind: "need", text: "Order the 200A panel", dueBucket: "tomorrow", dueDate: "", snoozedUntil: "", priority: "", assignedTo: "Josh", assignedBy: "Koy", assignedAt: "2026-11-03T10:00:00.000Z", foreman: "Keegan", jobId: JOB.id, jobName: "Forth", status: "open", createdBy: "Koy", createdAt: "2026-11-03T10:00:00.000Z", doneAt: "", doneBy: "", startedBy: "Josh", startedAt: "2026-11-03T11:00:00.000Z" };
ok("planUpdateTask: done / reopen / reassign / due / priority / text follow patchNeed", () => {
  assert.deepStrictEqual(needs.planUpdateTask({ done: true }, CUR, ctx()).fields, { status: "done", doneAt: NOW, doneBy: "Koy", startedBy: "", startedAt: "" });
  assert.deepStrictEqual(needs.planUpdateTask({ done: false }, { ...CUR, status: "done", doneBy: "Josh", doneAt: NOW }, ctx()).fields, { status: "open", doneAt: "", doneBy: "", startedBy: "", startedAt: "" });
  assert.deepStrictEqual(needs.planUpdateTask({ assignedTo: "brady" }, CUR, ctx()).fields, { assignedTo: "Brady", startedBy: "", startedAt: "", assignedBy: "Koy", assignedAt: NOW });
  assert.deepStrictEqual(needs.planUpdateTask({ dueDate: "2026-11-20" }, CUR, ctx()).fields, { dueDate: "2026-11-20", dueBucket: "week" });
  assert.deepStrictEqual(needs.planUpdateTask({ priority: "urgent", text: "Order the 200A panel today" }, CUR, ctx()).fields, { priority: "urgent", text: "Order the 200A panel today" });
});
ok("planUpdateTask: a note is an arrayUnion entry; Koy isn't the assignee so a snoozed task un-snoozes", () => {
  const r = needs.planUpdateTask({ note: { kind: "waiting", text: "CED", until: "2026-11-10" } }, { ...CUR, snoozedUntil: "2026-11-09" }, ctx());
  assert.deepStrictEqual(r.entry, { by: "Koy", at: NOW, kind: "waiting", text: "CED", until: "2026-11-10" });
  assert.deepStrictEqual(r.fields, { snoozedUntil: "" });
  const mine = needs.planUpdateTask({ note: { kind: "waiting", text: "CED", until: "2026-11-10" } }, { ...CUR, assignedTo: "Koy" }, ctx());
  assert.deepStrictEqual(mine.fields, { snoozedUntil: "2026-11-10" }, "Koy's own waiting snoozes");
});
ok("planUpdateTask: no-op when nothing changes; refusals for missing doc, empty ask, bad values", () => {
  assert.strictEqual(needs.planUpdateTask({ priority: "" }, CUR, ctx()).noop, true);
  assert.strictEqual(needs.planUpdateTask({ assignedTo: "Josh" }, CUR, ctx()).noop, false, "same person still stamps assignedAt (patchNeed does)");
  assert.match(needs.planUpdateTask({ done: true }, null, ctx()).refused, /doesn't exist/);
  assert.match(needs.planUpdateTask({}, CUR, ctx()).refused, /Nothing to change/);
  assert.match(needs.planUpdateTask({ done: "yes" }, CUR, ctx()).refused, /true or false/);
  assert.match(needs.planUpdateTask({ assignedTo: "" }, CUR, ctx()).refused, /person's name/);
  assert.match(needs.planUpdateTask({ note: { text: "" } }, CUR, ctx()).refused, /blank/);
  assert.match(needs.planUpdateTask({ note: { kind: "void", text: "x" } }, CUR, ctx()).refused, /note.kind/);
});

// ── api.handle against a fake Firestore ──────────────────────────────────────

// Firestore refuses a document holding `undefined` anywhere (2026-11-04: four
// real punch.add calls died on `response.body.room` — the fake used to be more
// lenient than the real thing). Same rule here.
function assertNoUndefined(v, path) {
  if (v === undefined) throw new Error('Cannot use "undefined" as a Firestore value (found in field "' + path + '")');
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, path + "[" + i + "]"));
  else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) Object.keys(v).forEach(k => assertNoUndefined(v[k], path ? path + "." + k : k));
}
function fakeIo({ docs = {}, recent = 0, users = USERS, open = [] } = {}) {
  const log = [];            // every tx op, in order
  const store = { ...docs }; // "coll/id" → doc
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { assertNoUndefined(d, ""); log.push(["create", r.path]); if (store[r.path]) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } store[r.path] = d; },
    update: (r, d) => { assertNoUndefined(d, ""); log.push(["update", r.path, d]); store[r.path] = { ...(store[r.path] || {}), ...d }; },
    set: (r, d) => { assertNoUndefined(d, ""); log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store,
    nowIso: () => NOW, todayYmd: () => "2026-11-03", rand: () => "abcde",
    getAudit: async (id) => store["duet_writes/" + id] || null,
    countRecent: async () => recent,
    getJob: async (id) => { log.push(["getJob", id]); return id === JOB.id ? JOB : null; },
    getUsers: async () => users,
    openNeeds: async () => open,
    runTx: async (fn) => fn(tx),
    needRef: (id) => ref("needs", id),
    auditRef: (id) => ref("duet_writes", id),
    arrayUnion: (...x) => ({ __arrayUnion: x }),
  };
}
const run = (body, io) => api.handle(body, io);
const RID = "11111111-2222-4333-8444-555555555555";

(async () => {
  await (async () => {
    const io = fakeIo();
    const r = await run({ requestId: RID, action: "task.create", email: "koy@homesteadelectric.net", args: { text: "Order the 200A panel", jobId: JOB.id, assignedTo: "josh", dueDate: "2026-11-04", priority: "urgent" } }, io);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.ok, true); assert.strictEqual(r.body.pushTo, "Josh");
    const creates = io.log.filter(l => l[0] === "create"); assert.strictEqual(creates.length, 1);
    const envelope = io.store["needs/" + r.body.needId];
    assert.deepStrictEqual(Object.keys(envelope).sort(), ["app_build", "data", "device", "saved_by", "tab", "updated_at", "w"].sort(), "saveNeed's envelope + the server stamp");
    assert.strictEqual(envelope.saved_by, "Duet (Koy)"); assert.strictEqual(envelope.device, "duet"); assert.ok(envelope.tab.startsWith("duet-1111"));
    assert.ok(Number.isInteger(envelope.app_build) && /^\d+\.duet[a-z0-9]{6,}$/.test(envelope.w), "version-lock stamp");
    assert.strictEqual(envelope.data.assignedTo, "Josh"); assert.strictEqual(envelope.data.assignedBy, "Koy"); assert.strictEqual(envelope.data.dueBucket, "tomorrow");
    const audit = io.store["duet_writes/" + RID];
    assert.ok(audit && audit.ok === true && audit.coll === "needs" && audit.docId === r.body.needId && audit.after.text === "Order the 200A panel" && audit.before === null, "audit doc in the same transaction");
    assert.ok(audit.response && audit.response.body.needId === r.body.needId, "audit keeps the response for replay");
    const order = io.log.map(l => l[0]); assert.deepStrictEqual(order.filter(o => o === "create" || o === "set"), ["create", "set"], "need then audit, one tx");
    n++; console.log("ok   handle task.create: one create + audit in one transaction, stamped envelope, push target named");
  })();
  await (async () => {
    const io = fakeIo();
    await run({ requestId: RID, action: "task.create", args: { text: "x" } }, io);
    const again = await run({ requestId: RID, action: "task.create", args: { text: "x" } }, io);
    assert.strictEqual(again.body.replayed, true); assert.strictEqual(io.log.filter(l => l[0] === "create").length, 1, "second call wrote nothing");
    n++; console.log("ok   handle: same requestId replays the first answer, writes nothing");
  })();
  await (async () => {
    const io = fakeIo({ recent: 60 });
    await assert.rejects(run({ requestId: RID, action: "task.create", args: { text: "x" } }, io), (e) => e instanceof api.Refusal && e.status === 429);
    assert.strictEqual(io.log.length, 0);
    n++; console.log("ok   handle: 61st write in an hour → 429, nothing touched, not audited (not replayable)");
  })();
  await (async () => {
    const io = fakeIo();
    await assert.rejects(run({ requestId: "short", action: "task.create", args: {} }, io), (e) => e.status === 400);
    await assert.rejects(run({ requestId: RID, action: "job.delete", args: {} }, io), (e) => e.status === 400 && /action must be/.test(e.message));
    const missing = await run({ requestId: RID + "a", action: "task.create", args: { text: "x", jobId: "999" } }, io);
    assert.strictEqual(missing.status, 404); assert.strictEqual(io.store["duet_writes/" + RID + "a"].ok, false, "a deterministic refusal IS audited");
    assert.strictEqual(io.log.filter(l => l[0] === "create").length, 0);
    n++; console.log("ok   handle: bad requestId / unknown action throw 400; missing job → 404 audited, nothing created");
  })();
  await (async () => {
    const io = fakeIo({ open: [{ text: "Order the 200A panel", jobId: JOB.id, assignedTo: "Koy", createdAt: "2026-11-03T20:12:00.000Z" }] });
    const r = await run({ requestId: RID, action: "task.create", args: { text: "order the 200a panel", jobId: JOB.id } }, io);
    assert.strictEqual(r.status, 409); assert.match(r.body.refused, /last 10 minutes/); assert.strictEqual(io.log.filter(l => l[0] === "create").length, 0);
    n++; console.log("ok   handle: duplicate open task within 10 min → 409, nothing created");
  })();
  await (async () => {
    const docPath = "needs/" + CUR.id;
    const io = fakeIo({ docs: { [docPath]: { data: CUR, updated_at: "2026-11-03T20:15:00.000Z", saved_by: "Josh", app_build: 599, w: "599.abcdefgh" } } });
    const r = await run({ requestId: RID, action: "task.update", email: "koy@homesteadelectric.net", args: { needId: CUR.id, assignedTo: "Brady", dueDate: "2026-11-20", note: { kind: "note", text: "Brady, this one's yours" } } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), ["app_build", "data.assignedAt", "data.assignedBy", "data.assignedTo", "data.dueBucket", "data.dueDate", "data.startedAt", "data.startedBy", "data.updates", "device", "saved_by", "tab", "updated_at", "w"], "dotted data.<k> keys only — patchNeed's write");
    assert.deepStrictEqual(upd["data.updates"], { __arrayUnion: [{ by: "Koy", at: NOW, kind: "note", text: "Brady, this one's yours" }] }, "note rides as arrayUnion, never a whole array");
    assert.ok(upd.updated_at > "2026-11-03T20:15:00.000Z", "updated_at strictly newer than the doc's (" + upd.updated_at + ")");
    assert.strictEqual(upd["data.assignedTo"], "Brady"); assert.strictEqual(upd["data.startedBy"], ""); assert.strictEqual(upd["data.dueBucket"], "week");
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual(audit.before.assignedTo, "Josh"); assert.deepStrictEqual(audit.after.assignedTo, "Brady"); assert.ok(audit.fields.includes("updates"));
    assert.deepStrictEqual(io.log.map(l => l[0]), ["get", "update", "set"], "read, write, audit — one transaction");
    n++; console.log("ok   handle task.update: read-modify-write by id, dotted keys, arrayUnion note, newer stamp, before/after audited");
  })();
  await (async () => {
    const docPath = "needs/" + CUR.id;
    const io = fakeIo({ docs: { [docPath]: { data: CUR, updated_at: NOW } } });
    const done = await run({ requestId: RID, action: "task.update", args: { needId: CUR.id, done: true } }, io);
    assert.strictEqual(done.body.status, "done");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.strictEqual(upd["data.status"], "done"); assert.strictEqual(upd["data.doneBy"], "Koy"); assert.strictEqual(upd["data.startedBy"], "");
    const noop = await run({ requestId: RID + "b", action: "task.update", args: { needId: CUR.id, priority: "" } }, fakeIo({ docs: { [docPath]: { data: CUR, updated_at: NOW } } }));
    assert.strictEqual(noop.body.noop, true);
    const gone = await run({ requestId: RID + "c", action: "task.update", args: { needId: "need_1_zzzzz", done: true } }, fakeIo());
    assert.strictEqual(gone.status, 404);
    const badId = await run({ requestId: RID + "d", action: "task.update", args: { needId: "../settings/users", done: true } }, fakeIo());
    assert.strictEqual(badId.status, 400);
    n++; console.log("ok   handle task.update: done stamps Koy; no-op writes nothing but the audit; missing → 404; a path-shaped id → 400");
  })();
  await (async () => {
    // Every op across every scenario above touched only needs + duet_writes, never a delete.
    const io = fakeIo({ docs: { ["needs/" + CUR.id]: { data: CUR, updated_at: NOW } } });
    await run({ requestId: RID, action: "task.create", args: { text: "a" } }, io);
    await run({ requestId: RID + "x", action: "task.update", args: { needId: CUR.id, done: true } }, io);
    const writes = io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));
    assert.ok(writes.every(w => w[1].startsWith("needs/") || w[1].startsWith("duet_writes/")), "only needs + duet_writes written");
    assert.ok(!io.log.some(l => l[0] === "delete"), "never a delete");
    n++; console.log("ok   handle: only needs + duet_writes are ever written; no delete path exists");
  })();
  await (async () => {
    const req = (auth) => ({ get: (h) => (h === "authorization" ? auth : "") });
    const saved = process.env.DUET_WRITE_TOKEN;
    process.env.DUET_WRITE_TOKEN = "a".repeat(64);
    assert.strictEqual(api.tokenOk(req("Bearer " + "a".repeat(64))), true);
    assert.strictEqual(api.tokenOk(req("Bearer " + "a".repeat(63) + "b")), false);
    assert.strictEqual(api.tokenOk(req("")), false);
    process.env.DUET_WRITE_TOKEN = "short";
    assert.strictEqual(api.tokenOk(req("Bearer short")), false, "a short secret fails closed");
    if (saved === undefined) delete process.env.DUET_WRITE_TOKEN; else process.env.DUET_WRITE_TOKEN = saved;
    n++; console.log("ok   tokenOk: exact bearer only, constant-time, fails closed on a short or missing secret");
  })();
  console.log(`duet-writes-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
