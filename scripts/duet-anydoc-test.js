#!/usr/bin/env node
/* duet-anydoc-test.js — Duet write access (connector D9), ship 12: the
 * any-document door.
 *
 * Drives functions/duetWrites/anyDoc.js (the collection policy + the per-op
 * planners), functions/duetWrites/undo.js (the door's undo classes) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction that refuses `undefined` exactly as Firestore does. Proves: the
 * target check runs BEFORE any read (NEVER collections, settings/users outside
 * team.edit, subcollections, bad ids / paths, non-JSON values, the confirm
 * words); doc.set writes ONE dotted path with the right envelope per
 * collection kind and refuses owned job keys naming their tool; the three
 * list ops work by id on the live copy and never turn a map into a list;
 * doc.create starts a job from blankJob's defaults and refuses a blank name;
 * doc.markDeleted writes the three keys where the kind keeps them; doc.delete
 * needs the typed id, refuses outside jobs / needs / suggestions and above
 * 900 KB; team.edit patches ONE person (or appends) with the app's saveUsers
 * envelope and never shrinks the list; every planner output is free of
 * undefined; undo puts each op back only while the doc still reads what the
 * call left. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const AD = require(path.join(root, "functions", "duetWrites", "anyDoc.js"));
const UN = require(path.join(root, "functions", "duetWrites", "undo.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const JS = require(path.join(root, "functions", "jobShape.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-06T22:15:00.000Z";
const TODAY = "2026-11-06";
const TZ = "America/Denver";
const clone = (x) => JSON.parse(JSON.stringify(x));

// Firestore refuses a document holding `undefined` anywhere (2026-11-04: four
// real punch.add calls died on `response.body.room`). Same rule here, on every
// planner output AND every fake write.
function assertNoUndefined(v, p) {
  if (v === undefined) throw new Error('Cannot use "undefined" as a Firestore value (found in field "' + p + '")');
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, p + "[" + i + "]"));
  else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) Object.keys(v).forEach(k => assertNoUndefined(v[k], p ? p + "." + k : k));
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const FORTH = "1772863862618", GONE = "1772863862620";
const USERS = [
  { id: "u1", name: "Koy", title: "admin", access: "admin", caps: ["resi.head"], pin: "1111", fcmTokens: ["tokKoy"], email: "koy@homesteadelectric.net" },
  { id: "u2", name: "Josh Miller", title: "admin", access: "admin", pin: "2222", fcmToken: "tokJosh" },
  { id: "u3", name: "Keegan", title: "foreman", access: "manager", pin: "3333" },
  { id: "u4", name: "Colby", title: "foreman", access: "standard" },
  { id: "u5", name: "Abe", title: "crew", access: "limited", active: false },
];
const FU1 = { id: "fu1", date: "11/5/2026", text: "Trim started upstairs", by: "Colby" };
const FU2 = { id: "fu2", date: "11/6/2026", text: "Kitchen done", by: "Colby" };
const JOB = (over) => ({ id: FORTH, name: "Forth", foreman: "Keegan", lead: "", flagged: false, flagNote: "", roughNotes: "", roughStatus: "scheduled",
  finishUpdates: [FU1, FU2], roughUpdates: [], changeOrders: [], returnTrips: [],
  roughQuestions: { upper: [], main: [{ id: "q1", question: "Fan box height?", done: false }], basement: [] },
  panelizedLighting: { loads: [], noKeypadLoads: false }, hiddenSections: {}, taskDueDates: {}, ...(over || {}) });
const DOC = (data, over) => ({ data, updated_at: "2026-11-05T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 617, w: "617.abcdefgh", ...(over || {}) });
const NEED1 = { id: "need_1762000000001_aaaaa", kind: "need", text: "Order the 200A panel", dueBucket: "week", dueDate: "2026-11-12", snoozedUntil: "", priority: "", assignedTo: "Josh Miller", assignedBy: "Koy", assignedAt: "2026-11-02T10:00:00.000Z", foreman: "Keegan", jobId: FORTH, jobName: "Forth", status: "open", createdBy: "Koy", createdAt: "2026-11-02T10:00:00.000Z", doneAt: "", doneBy: "" };
const DOCS = () => ({
  ["jobs/" + FORTH]: DOC(JOB()),
  ["jobs/" + GONE]: DOC(JOB({ id: GONE, name: "Gone", archived: true })),
  ["needs/" + NEED1.id]: { data: clone(NEED1), updated_at: "2026-11-02T12:00:00.000Z", saved_by: "Josh Miller" },
  "projects/prj_1762000000000": { data: { id: "prj_1762000000000", name: "Battle Creek", notes: "" }, updated_at: "2026-11-01T10:00:00.000Z", saved_by: "Koy" },
  "gc_config/material_po": { mode: "test", testTo: "soak@homesteadelectric.net", bids: "bids@homesteadelectric.net", liveAccess: ["admin"], updated_at: "2026-10-20T10:00:00.000Z", saved_by: "Koy" },
  "gc_config/mail": { key: "SECRET-KEY", soakTo: "soak@homesteadelectric.net" },
  "settings/appGate": { minBuild: 600, message: "", updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/crewRoster": { names: ["Keegan", "Colby", "Abe"], updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/users": { list: clone(USERS), updated_at: "2026-11-04T10:00:00.000Z", saved_by: "Koy", device: "dev_1" },
  "suggestions/sug_1": { text: "Add a dark mode", by: "Colby", at: "2026-10-01T10:00:00.000Z" },
  ["homeowner_requests/" + FORTH]: { questionThreads: {}, notes: "", updated_at: "2026-10-01T10:00:00.000Z" },
  "config/app": { maintenance: false, updatedAt: "2026-10-01T10:00:00.000Z" },
});
const ctx = () => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: TODAY + "T12:00:00", users: USERS, rand: "abcde", tz: TZ, email: "koy@homesteadelectric.net" });

// Every planner answer must be writable: no undefined anywhere in it.
const plan = (action, args, live, c) => { const p = AD.planDoc(action, args, live, c || ctx()); assertNoUndefined(p, ""); return p; };
const planTeam = (args, usersDoc, c) => { const p = AD.planTeamEdit(args, usersDoc, c || ctx()); assertNoUndefined(p, ""); return p; };
const check = (action, args) => { const t = AD.checkTarget(action, args); assertNoUndefined(t, ""); return t; };
const CONFIRM = (w) => "Ask Koy to type `" + w + "` and pass it as confirm. Nothing was written.";

(async () => {

// ── 1. surface ───────────────────────────────────────────────────────────────
await ok("anyDoc: DOC_ACTIONS is the spec's eight; kindOf sorts jobs / needs / projects as data, settings as settings, the rest plain; the NEVER list is the spec's", () => {
  assert.deepStrictEqual(AD.DOC_ACTIONS, ["doc.set", "doc.append", "doc.patchItem", "doc.removeItem", "doc.create", "doc.markDeleted", "doc.delete", "team.edit"]);
  assert.strictEqual(AD.kindOf("jobs"), "data"); assert.strictEqual(AD.kindOf("needs"), "data"); assert.strictEqual(AD.kindOf("projects"), "data");
  assert.strictEqual(AD.kindOf("settings"), "settings"); assert.strictEqual(AD.kindOf("gc_config"), "plain"); assert.strictEqual(AD.kindOf("suggestions"), "plain");
  assert.deepStrictEqual(AD.NEVER_COLLS, ["duet_writes", "recovery_ledger", "claude_activity", "claude_reports", "errors", "material_po_log", "orgauth", "crewtokens", "crewroster", "crewdevices"]);
  assert.deepStrictEqual(AD.HARD_DELETE_COLLS, ["jobs", "needs", "suggestions"]);
  assert.deepStrictEqual(AD.CONFIRM_DOCS, ["gc_config/material_po", "settings/appGate", "config/app"]);
  assert.strictEqual(AD.SAVED_BY, api.SAVED_BY);
  for (const [c, d] of [["duet_writes", "x"], ["recovery_ledger", "x"], ["orgauth", "x"], ["crewtokens", "x"], ["gc_config", "mail"], ["settings", "users"]]) assert.ok(AD.neverReason(c, d), c + "/" + d + " must be never");
  assert.strictEqual(AD.neverReason("jobs", FORTH), null); assert.strictEqual(AD.neverReason("gc_config", "material_po"), null); assert.strictEqual(AD.neverReason("settings", "appGate"), null);
});

// ── 2. checkTarget — before any read ─────────────────────────────────────────
await ok("checkTarget: ids and paths — bad coll / docId / path regexes refuse; a subcollection refuses with top-level only; a numeric path segment refuses naming patch_item; > 8 segments refuses; data-rooted paths never start with data. and never touch id", () => {
  assert.match(check("doc.set", { coll: "Jobs", docId: FORTH, path: "flagNote", value: "x" }).refused, /coll/);
  assert.match(check("doc.set", { coll: "jobs", docId: "bad id!", path: "flagNote", value: "x" }).refused, /docId/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH + "/versions/1", path: "flagNote", value: "x" }).refused, /top-level documents only/);
  assert.match(check("doc.set", { coll: "jobs/" + FORTH + "/versions", docId: "1", path: "flagNote", value: "x" }).refused, /top-level documents only/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "flag Note", value: "x" }).refused, /path/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "roughQuestions.0.text", value: "x" }).refused, /name the item by id with patch_item/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "a.b.c.d.e.f.g.h.i", value: "x" }).refused, /8/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "data.flagNote", value: "x" }).refused, /relative to data/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "id", value: "x" }).refused, /id/);
  assert.match(check("doc.set", { coll: "needs", docId: NEED1.id, path: "id", value: "x" }).refused, /id/);
  assert.match(check("doc.append", { coll: "jobs", docId: FORTH, item: { a: 1 } }).refused, /path/);
  assert.match(check("doc.set", { coll: "gc_config", docId: "material_po", path: "updated_at", value: "x", confirm: "material_po" }).refused, /stamp/);
  assert.match(check("doc.nope", { coll: "jobs", docId: FORTH }).refused, /action/);
  const t = check("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value: "x" });
  assert.deepStrictEqual(t, { coll: "jobs", docId: FORTH, kind: "data", path: "flagNote", confirmWord: null });
});
await ok("checkTarget: the NEVER list refuses before any read (every spec entry); settings/users via doc.set refuses naming team.edit; doc.create in a NEVER coll refuses", () => {
  for (const c of AD.NEVER_COLLS) { const r = check("doc.set", { coll: c, docId: "x", path: "a", value: 1 }); assert.ok(r.refused && /never/i.test(r.refused), c + ": " + r.refused); }
  assert.match(check("doc.set", { coll: "gc_config", docId: "mail", path: "soakTo", value: "x" }).refused, /mail key|never/i);
  assert.match(check("doc.set", { coll: "settings", docId: "users", path: "list", value: [] }).refused, /team\.edit/);
  assert.match(check("doc.append", { coll: "settings", docId: "users", path: "list", item: { name: "x" } }).refused, /team\.edit/);
  assert.match(check("doc.create", { coll: "duet_writes", data: { a: 1 } }).refused, /never/i);
  assert.match(check("doc.create", { coll: "settings", docId: "users", data: { list: [] } }).refused, /team\.edit/);
  assert.match(check("doc.delete", { coll: "duet_writes", docId: "x", confirm: "x" }).refused, /never/i);
  assert.match(check("doc.markDeleted", { coll: "recovery_ledger", docId: "x" }).refused, /never/i);
});
await ok("checkTarget: owned job keys refuse naming the tool; the id / cache keys stay denied; other DENY keys (booleans, lanes) pass; append on an owned array is allowed (the door's point)", () => {
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "roughStatus", value: "complete" }).refused, /cc_set_phase_status/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "foreman", value: "Colby" }).refused, /cc_set_job_people/);
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "changeOrders", value: [] }).refused, /cc_create_change_order/);
  for (const k of ["simproSync", "docPull", "presence", "driveFolderId"]) assert.ok(check("doc.set", { coll: "jobs", docId: FORTH, path: k, value: "x" }).refused, k + " must stay denied");
  assert.match(check("doc.set", { coll: "jobs", docId: FORTH, path: "simproSync.at", value: "x" }).refused, /simproSync/);
  for (const k of ["tempPed", "deleted", "archived", "isHot", "readyToSchedule", "lightingSystem", "quickJob"]) assert.ok(!check("doc.set", { coll: "jobs", docId: FORTH, path: k, value: true }).refused, k + " must be reachable");
  assert.ok(!check("doc.set", { coll: "jobs", docId: FORTH, path: "panelizedLighting.noKeypadLoads", value: true }).refused, "a nested deny map key is reachable");
  assert.ok(!check("doc.set", { coll: "jobs", docId: FORTH, path: "someNewKey", value: 1 }).refused, "an unknown key is reachable (the door is not a schema oracle)");
  assert.ok(!check("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { text: "x" } }).refused);
  assert.ok(!check("doc.patchItem", { coll: "jobs", docId: FORTH, path: "changeOrders", itemId: "c1", patch: { desc: "x" } }).refused);
});
await ok("checkTarget: JSON sanity before any read — NaN / Infinity / undefined / __proto__ / a function / > 100 KB refuse; null, nested plain objects and {__delete:true} pass", () => {
  const set = (value) => check("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value });
  assert.match(set(NaN).refused, /JSON/); assert.match(set(Infinity).refused, /JSON/); assert.match(set(undefined).refused, /value/);
  assert.match(set({ a: [1, { b: NaN }] }).refused, /JSON/);
  assert.match(set(JSON.parse('{"__proto__": {"x": 1}}')).refused, /JSON|__proto__/);
  assert.match(set({ constructor: { prototype: 1 } }).refused, /JSON|constructor/);
  assert.match(set(() => 1).refused, /JSON/);
  assert.match(set("x".repeat(100 * 1024 + 1)).refused, /100 KB/);
  assert.ok(!set(null).refused); assert.ok(!set({ a: { b: [1, "two", null, true] } }).refused); assert.ok(!set({ __delete: true }).refused);
  assert.match(check("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: "not an object" }).refused, /item must be an object/);
  assert.match(check("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: [1] }).refused, /item must be an object/);
  assert.match(check("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1", patch: 5 }).refused, /patch must be an object/);
  assert.match(check("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "", patch: { a: 1 } }).refused, /itemId/);
  assert.match(check("doc.create", { coll: "needs", data: [1] }).refused, /data must be an object/);
  assert.match(check("doc.create", { coll: "needs", data: { text: "x", bad: Infinity } }).refused, /JSON/);
  assert.match(check("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { text: "x" }, position: "middle" }).refused, /position/);
});
await ok("checkTarget: confirm words — doc.delete needs confirm = docId and only jobs / needs / suggestions; the three confirm docs need confirm = docId on every op; the refusal text is exact", () => {
  assert.strictEqual(check("doc.delete", { coll: "jobs", docId: FORTH }).refused, CONFIRM(FORTH));
  assert.strictEqual(check("doc.delete", { coll: "jobs", docId: FORTH, confirm: "nope" }).refused, CONFIRM(FORTH));
  assert.strictEqual(check("doc.delete", { coll: "jobs", docId: FORTH, confirm: FORTH.toUpperCase() + "x" }).refused, CONFIRM(FORTH));
  assert.deepStrictEqual(check("doc.delete", { coll: "jobs", docId: FORTH, confirm: " " + FORTH + " " }), { coll: "jobs", docId: FORTH, kind: "data", path: null, confirmWord: FORTH }, "trimmed");
  assert.match(check("doc.delete", { coll: "projects", docId: "prj_1762000000000", confirm: "prj_1762000000000" }).refused, /jobs, needs, suggestions/);
  assert.match(check("doc.delete", { coll: "gc_config", docId: "material_po", confirm: "material_po" }).refused, /jobs, needs, suggestions/);
  assert.strictEqual(check("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "live" }).refused, CONFIRM("material_po"));
  assert.ok(check("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "live" }).refused.includes("type `material_po`"));
  assert.strictEqual(check("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "live", confirm: "material_po" }).confirmWord, "material_po");
  assert.strictEqual(check("doc.set", { coll: "settings", docId: "appGate", path: "minBuild", value: 618 }).refused, CONFIRM("appGate"));
  assert.strictEqual(check("doc.markDeleted", { coll: "config", docId: "app" }).refused, CONFIRM("app"));
  assert.strictEqual(check("doc.append", { coll: "gc_config", docId: "material_po", path: "liveAccess", item: { id: "x" } }).refused, CONFIRM("material_po"));
  assert.strictEqual(check("doc.create", { coll: "config", docId: "app", data: { maintenance: true } }).refused, CONFIRM("app"));
  assert.strictEqual(check("doc.set", { coll: "settings", docId: "crewRoster", path: "names", value: ["Keegan"] }).confirmWord, null, "an ordinary settings doc needs no word");
  const te = check("team.edit", { userId: "u2", patch: { title: "office" }, confirm: "Josh Miller" });
  assert.deepStrictEqual(te, { coll: "settings", docId: "users", kind: "settings", path: null, confirmWord: "Josh Miller" });
  assert.match(check("team.edit", { userId: "u2", patch: { fcmTokens: [] }, confirm: "Josh Miller" }).refused, /fcmTokens/);
  assert.match(check("team.edit", { userId: "u2", patch: { id: "u9" }, confirm: "Josh Miller" }).refused, /id/);
  assert.match(check("team.edit", { userId: "u2", patch: { _standIn: true }, confirm: "Josh Miller" }).refused, /_standIn/);
  assert.match(check("team.edit", { userId: "u2", patch: { pin: "9999" }, confirm: "Josh Miller" }).refused, /pin/);
  assert.match(check("team.edit", { userId: "u2", patch: {}, confirm: "Josh Miller" }).refused, /patch/);
});

// ── 3. planDoc — doc.set ─────────────────────────────────────────────────────
await ok("doc.set on a job scalar → fields {\"data.flagNote\": …}, before null when absent / the value when present, after the value; same value → noop; a missing doc refuses 404; a nested map key; {__delete:true} removes; a scalar in the way refuses", () => {
  const live = DOC(JOB({ flagNote: undefined }));
  const p = plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value: "GC wants the panel north" }, live);
  assert.deepStrictEqual(p.write, { kind: "update", fields: { "data.flagNote": "GC wants the panel north" } });
  assert.strictEqual(p.before, null); assert.strictEqual(p.after, "GC wants the panel north");
  assert.deepStrictEqual(p.result.path, "flagNote"); assert.strictEqual(p.result.from, null); assert.strictEqual(p.result.to, "GC wants the panel north");
  const p2 = plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value: "x" }, DOC(JOB({ flagNote: "old" })));
  assert.strictEqual(p2.before, "old");
  assert.strictEqual(plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value: "" }, DOC(JOB())).noop, true);
  assert.strictEqual(plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagged", value: false }, DOC(JOB())).noop, true);
  const miss = plan("doc.set", { coll: "jobs", docId: "1700000000000", path: "flagNote", value: "x" }, null);
  assert.match(miss.refused, /doesn't exist|No jobs/); assert.strictEqual(miss.status, 404);
  const nested = plan("doc.set", { coll: "jobs", docId: FORTH, path: "panelizedLighting.noKeypadLoads", value: true }, DOC(JOB()));
  assert.deepStrictEqual(nested.write.fields, { "data.panelizedLighting.noKeypadLoads": true }); assert.strictEqual(nested.before, false);
  const del = plan("doc.set", { coll: "jobs", docId: FORTH, path: "roughNotes", value: { __delete: true } }, DOC(JOB()));
  assert.deepStrictEqual(del.write.fields, { "data.roughNotes": { __delete: true } }); assert.strictEqual(del.before, ""); assert.strictEqual(del.after, null);
  assert.strictEqual(plan("doc.set", { coll: "jobs", docId: FORTH, path: "neverThere", value: { __delete: true } }, DOC(JOB())).noop, true, "deleting an absent key is a noop");
  assert.match(plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote.deep", value: 1 }, DOC(JOB({ flagNote: "text" }))).refused, /flagNote isn't a map/);
  assert.match(plan("doc.set", { coll: "jobs", docId: FORTH, path: "someList.x", value: 1 }, DOC(JOB({ someList: [1] }))).refused, /someList is a list/);
  assert.match(plan("doc.set", { coll: "jobs", docId: FORTH, path: "flagNote", value: "x" }, { updated_at: NOW }).refused, /no data/);
});
await ok("doc.set on needs / projects / a plain doc: needs and projects write data.<path>; plain docs write the top-level path; gc_config/material_po mode:live with confirm → ok and result.warning names real vendors; test mode's warning names the test inbox", () => {
  const pn = plan("doc.set", { coll: "needs", docId: NEED1.id, path: "priority", value: "urgent" }, DOCS()["needs/" + NEED1.id]);
  assert.deepStrictEqual(pn.write.fields, { "data.priority": "urgent" }); assert.strictEqual(pn.before, "");
  const pp = plan("doc.set", { coll: "projects", docId: "prj_1762000000000", path: "notes", value: "Four buildings" }, DOCS()["projects/prj_1762000000000"]);
  assert.deepStrictEqual(pp.write.fields, { "data.notes": "Four buildings" });
  const ps = plan("doc.set", { coll: "suggestions", docId: "sug_1", path: "text", value: "Add a dark mode please" }, DOCS()["suggestions/sug_1"]);
  assert.deepStrictEqual(ps.write.fields, { text: "Add a dark mode please" }); assert.strictEqual(ps.before, "Add a dark mode");
  const live = plan("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "live", confirm: "material_po" }, DOCS()["gc_config/material_po"]);
  assert.deepStrictEqual(live.write.fields, { mode: "live" }); assert.strictEqual(live.before, "test"); assert.match(live.result.warning, /real vendors/); assert.match(live.result.warning, /\[TEST\]/);
  const test = plan("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "test", confirm: "material_po" }, { ...DOCS()["gc_config/material_po"], mode: "live" });
  assert.match(test.result.warning, /test inbox/);
  assert.ok(!("warning" in plan("doc.set", { coll: "gc_config", docId: "material_po", path: "testTo", value: "x@y.z", confirm: "material_po" }, DOCS()["gc_config/material_po"]).result), "only the mode switch warns");
  assert.match(plan("doc.set", { coll: "gc_config", docId: "material_po", path: "mode", value: "sideways", confirm: "material_po" }, DOCS()["gc_config/material_po"]).refused, /off, test or live/);
});

// ── 4. planDoc — the list ops ────────────────────────────────────────────────
await ok("doc.append: the item goes on the end (default) or the start with an id filled <coll>_<ms>_<rand5> when absent; a given id is kept; a duplicate id refuses; an absent path starts a new list; a map or a scalar at the path refuses, never converted", () => {
  const ms = Date.parse(NOW);
  const p = plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { date: "11/7/2026", text: "Punch walk", by: "Koy" } }, DOC(JOB()));
  assert.strictEqual(p.itemId, `jobs_${ms}_abcde`); assert.strictEqual(p.before, null);
  assert.deepStrictEqual(p.after, { id: `jobs_${ms}_abcde`, date: "11/7/2026", text: "Punch walk", by: "Koy" });
  assert.deepStrictEqual(p.write, { kind: "update", fields: { "data.finishUpdates": [FU1, FU2, p.after] } });
  assert.strictEqual(p.result.position, "end"); assert.strictEqual(p.result.length, 3);
  const s = plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { text: "First" }, position: "start" }, DOC(JOB()));
  assert.strictEqual(s.write.fields["data.finishUpdates"][0].id, `jobs_${ms}_abcde`); assert.strictEqual(s.write.fields["data.finishUpdates"].length, 3); assert.strictEqual(s.write.fields["data.finishUpdates"][1].id, "fu1");
  const kept = plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { id: "fu9", text: "x" } }, DOC(JOB()));
  assert.strictEqual(kept.itemId, "fu9");
  assert.match(plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { id: "fu1", text: "x" } }, DOC(JOB())).refused, /already an item with id fu1/);
  assert.match(plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { id: 5, text: "x" } }, DOC(JOB())).refused, /id must be text/);
  const fresh = plan("doc.append", { coll: "jobs", docId: FORTH, path: "newList", item: { text: "x" } }, DOC(JOB()));
  assert.strictEqual(fresh.write.fields["data.newList"].length, 1); assert.strictEqual(fresh.result.length, 1);
  assert.match(plan("doc.append", { coll: "jobs", docId: FORTH, path: "roughQuestions", item: { text: "x" } }, DOC(JOB())).refused, /roughQuestions holds a map, not a list/);
  assert.match(plan("doc.append", { coll: "jobs", docId: FORTH, path: "flagNote", item: { text: "x" } }, DOC(JOB({ flagNote: "t" }))).refused, /flagNote holds a string, not a list/);
  const plain = plan("doc.append", { coll: "gc_config", docId: "material_po", path: "liveAccess", item: { id: "manager" }, confirm: "material_po" }, DOCS()["gc_config/material_po"]);
  assert.deepStrictEqual(plain.write.fields, { liveAccess: ["admin", { id: "manager" }] });
  assert.match(plan("doc.append", { coll: "jobs", docId: FORTH, path: "finishUpdates", item: { text: "x" } }, null).refused, /doesn't exist/);
});
await ok("doc.patchItem: shallow merge by id, {__delete:true} removes a key, the id can't change, same patch → noop, unknown id refuses with the ids it saw; before / after are the ONE item", () => {
  const p = plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1", patch: { text: "Trim started upstairs (fixed)", by: { __delete: true }, extra: 1 } }, DOC(JOB()));
  assert.deepStrictEqual(p.before, FU1); assert.deepStrictEqual(p.after, { id: "fu1", date: "11/5/2026", text: "Trim started upstairs (fixed)", extra: 1 });
  assert.deepStrictEqual(p.write.fields["data.finishUpdates"], [p.after, FU2]); assert.strictEqual(p.itemId, "fu1"); assert.deepStrictEqual(p.result.changed, ["text", "by", "extra"]);
  assert.strictEqual(plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1", patch: { text: FU1.text } }, DOC(JOB())).noop, true);
  assert.strictEqual(plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1", patch: { nope: { __delete: true } } }, DOC(JOB())).noop, true, "deleting an absent key is a noop");
  assert.match(plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1", patch: { id: "zz" } }, DOC(JOB())).refused, /id/);
  const miss = plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu7", patch: { text: "x" } }, DOC(JOB()));
  assert.match(miss.refused, /No item with id fu7/); assert.match(miss.refused, /fu1, fu2/);
  assert.match(plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "roughQuestions", itemId: "q1", patch: { done: true } }, DOC(JOB())).refused, /holds a map, not a list/);
  assert.match(plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "notThere", itemId: "q1", patch: { done: true } }, DOC(JOB())).refused, /no list at notThere/);
  const nested = plan("doc.patchItem", { coll: "jobs", docId: FORTH, path: "roughQuestions.main", itemId: "q1", patch: { done: true } }, DOC(JOB()));
  assert.deepStrictEqual(nested.write.fields, { "data.roughQuestions.main": [{ id: "q1", question: "Fan box height?", done: true }] });
});
await ok("doc.removeItem: before holds the item + its index, after null, the list written back without it; a missing id refuses", () => {
  const p = plan("doc.removeItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu1" }, DOC(JOB()));
  assert.deepStrictEqual(p.before, FU1); assert.strictEqual(p.index, 0); assert.strictEqual(p.after, null); assert.strictEqual(p.itemId, "fu1");
  assert.deepStrictEqual(p.write, { kind: "update", fields: { "data.finishUpdates": [FU2] } }); assert.strictEqual(p.result.length, 1);
  const last = plan("doc.removeItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu2" }, DOC(JOB()));
  assert.strictEqual(last.index, 1);
  assert.match(plan("doc.removeItem", { coll: "jobs", docId: FORTH, path: "finishUpdates", itemId: "fu7" }, DOC(JOB())).refused, /No item with id fu7/);
  assert.match(plan("doc.removeItem", { coll: "jobs", docId: FORTH, path: "flagNote", itemId: "x" }, DOC(JOB({ flagNote: "t" }))).refused, /holds a string/);
});

// ── 5. planDoc — create / markDeleted / delete ──────────────────────────────
await ok("doc.create: needs → {data:{id:need_<ms>_<rand5>, …}}; projects → prj_<ms>; a plain coll → <coll>_<ms>_<rand5>; a given docId is kept; an existing doc refuses 409; jobs start from blankJob's defaults with data.id = docId and refuse a blank name; data.id in the body never wins", () => {
  const ms = Date.parse(NOW);
  const pn = plan("doc.create", { coll: "needs", data: { kind: "need", text: "Call the GC", assignedTo: "Koy", status: "open" } }, null);
  assert.strictEqual(pn.docId, `need_${ms}_abcde`); assert.deepStrictEqual(pn.write, { kind: "create", doc: { data: { kind: "need", text: "Call the GC", assignedTo: "Koy", status: "open", id: `need_${ms}_abcde` } } });
  assert.strictEqual(pn.before, null); assert.deepStrictEqual(pn.after, pn.write.doc.data); assert.strictEqual(pn.result.created, true);
  assert.strictEqual(plan("doc.create", { coll: "projects", data: { name: "Battle Creek 2" } }, null).docId, `prj_${ms}`);
  const pp = plan("doc.create", { coll: "suggestions", data: { text: "Dark mode", by: "Koy" } }, null);
  assert.strictEqual(pp.docId, `suggestions_${ms}_abcde`); assert.deepStrictEqual(pp.write, { kind: "create", doc: { text: "Dark mode", by: "Koy" } }); assert.deepStrictEqual(pp.after, { text: "Dark mode", by: "Koy" });
  assert.strictEqual(plan("doc.create", { coll: "suggestions", docId: "sug_9", data: { text: "x" } }, null).docId, "sug_9");
  const dup = plan("doc.create", { coll: "suggestions", docId: "sug_1", data: { text: "x" } }, DOCS()["suggestions/sug_1"]);
  assert.match(dup.refused, /already exists/); assert.strictEqual(dup.status, 409);
  const pj = plan("doc.create", { coll: "jobs", data: { name: "Miller shop", address: "12 Main", foreman: "Colby" } }, null);
  assert.strictEqual(pj.docId, String(ms)); const j = pj.write.doc.data;
  assert.strictEqual(j.id, String(ms)); assert.strictEqual(j.name, "Miller shop"); assert.strictEqual(j.foreman, "Colby"); assert.strictEqual(j.address, "12 Main");
  let i = 0; const blank = JS.blankJob(() => String(++i));
  assert.deepStrictEqual(Object.keys(j).sort(), Object.keys(blank).sort(), "every blankJob default is there");
  assert.strictEqual(j.homeRuns.main.length, 10); assert.strictEqual(j.panelizedLighting.cp4Loads.length, 10); assert.deepStrictEqual(j.roughPunch, { upper: [], main: [], basement: [] });
  const rowIds = new Set([...j.homeRuns.main, ...j.homeRuns.basement, ...j.homeRuns.upper, ...j.panelizedLighting.mainKeypad, ...j.panelizedLighting.cp4Loads].map(r => r.id));
  assert.strictEqual(rowIds.size, 50, "row ids are all distinct"); assert.ok(!rowIds.has(j.id), "no row shares the job's id");
  assert.match(plan("doc.create", { coll: "jobs", data: { address: "x" } }, null).refused, /name/);
  assert.match(plan("doc.create", { coll: "jobs", data: { name: "   " } }, null).refused, /name/);
  assert.strictEqual(plan("doc.create", { coll: "jobs", docId: "1772863862999", data: { name: "x", id: "evil" } }, null).write.doc.data.id, "1772863862999");
  assert.strictEqual(plan("doc.create", { coll: "needs", data: { text: "x", id: "evil" } }, null).write.doc.data.id, `need_${ms}_abcde`);
});
await ok("doc.markDeleted: a job gets data.deleted / deletedAt / deletedBy:\"Koy\"; a plain doc the same three keys top-level; before holds their current values (null when absent); already deleted → noop; missing → 404", () => {
  const pj = plan("doc.markDeleted", { coll: "jobs", docId: FORTH }, DOC(JOB()));
  assert.deepStrictEqual(pj.write, { kind: "update", fields: { "data.deleted": true, "data.deletedAt": NOW, "data.deletedBy": "Koy" } });
  assert.deepStrictEqual(pj.before, { deleted: null, deletedAt: null, deletedBy: null }); assert.deepStrictEqual(pj.after, { deleted: true, deletedAt: NOW, deletedBy: "Koy" });
  const ps = plan("doc.markDeleted", { coll: "suggestions", docId: "sug_1" }, DOCS()["suggestions/sug_1"]);
  assert.deepStrictEqual(ps.write, { kind: "update", fields: { deleted: true, deletedAt: NOW, deletedBy: "Koy" } });
  assert.strictEqual(plan("doc.markDeleted", { coll: "jobs", docId: FORTH }, DOC(JOB({ deleted: true, deletedAt: "x", deletedBy: "Josh" }))).noop, true);
  assert.strictEqual(plan("doc.markDeleted", { coll: "jobs", docId: FORTH }, null).status, 404);
});
await ok("doc.delete: with the typed id → {kind:\"delete\"}, before = the whole raw doc, after null; a 1 MB doc refuses \"too big\"; missing → 404", () => {
  const raw = DOC(JOB());
  const p = plan("doc.delete", { coll: "jobs", docId: FORTH, confirm: FORTH }, raw);
  assert.deepStrictEqual(p.write, { kind: "delete" }); assert.deepStrictEqual(p.before, raw); assert.strictEqual(p.after, null); assert.strictEqual(p.result.deleted, true); assert.strictEqual(p.result.bytes, JSON.stringify(raw).length);
  const big = plan("doc.delete", { coll: "jobs", docId: FORTH, confirm: FORTH }, DOC(JOB({ roughNotes: "x".repeat(1024 * 1024) })));
  assert.match(big.refused, /too big to keep a copy — archive or mark deleted instead/);
  assert.strictEqual(plan("doc.delete", { coll: "needs", docId: NEED1.id, confirm: NEED1.id }, null).status, 404);
  const ps = plan("doc.delete", { coll: "suggestions", docId: "sug_1", confirm: "sug_1" }, DOCS()["suggestions/sug_1"]);
  assert.deepStrictEqual(ps.before, DOCS()["suggestions/sug_1"]);
});

// ── 6. planTeamEdit ──────────────────────────────────────────────────────────
await ok("team.edit: patch Josh's title with confirm = his exact name → the list keeps its length, only that entry changed; the audited person never carries pin / fcmTokens / fcmToken; same patch → noop; wrong / missing confirm refuses with the exact text; unknown id refuses; the live doc missing refuses", () => {
  const doc = DOCS()["settings/users"];
  const p = planTeam({ userId: "u2", patch: { title: "office" }, confirm: "Josh Miller" }, doc);
  assert.ok(!p.refused, p.refused); assert.strictEqual(p.list.length, USERS.length); assert.strictEqual(p.userId, "u2"); assert.strictEqual(p.name, "Josh Miller");
  assert.deepStrictEqual(p.list[1], { ...USERS[1], title: "office" }, "the live entry keeps its pin / token");
  assert.deepStrictEqual(p.list.filter((u, i) => i !== 1), USERS.filter((u, i) => i !== 1), "nobody else touched");
  assert.deepStrictEqual(p.before, { id: "u2", name: "Josh Miller", title: "admin", access: "admin" }); assert.deepStrictEqual(p.after, { id: "u2", name: "Josh Miller", title: "office", access: "admin" });
  assert.deepStrictEqual(p.result.changed, ["title"]); assert.strictEqual(p.result.added, false);
  assert.strictEqual(planTeam({ userId: "u2", patch: { title: "admin" }, confirm: "Josh Miller" }, doc).noop, true);
  assert.strictEqual(planTeam({ userId: "u2", patch: { title: "office" }, confirm: "josh miller" }, doc).refused, CONFIRM("Josh Miller"));
  assert.strictEqual(planTeam({ userId: "u2", patch: { title: "office" } }, doc).refused, CONFIRM("Josh Miller"));
  assert.strictEqual(planTeam({ userId: "u2", patch: { name: "Josh M", title: "office" }, confirm: "Josh Miller" }, doc).refused, CONFIRM("Josh M"), "the word is the name AFTER the edit");
  assert.ok(!planTeam({ userId: "u2", patch: { name: "Josh M" }, confirm: "Josh M" }, doc).refused);
  assert.match(planTeam({ userId: "u9", patch: { title: "x" }, confirm: "x" }, doc).refused, /No team member with id u9/);
  assert.match(planTeam({ userId: "u2", patch: { title: "x" }, confirm: "Josh Miller" }, null).refused, /settings\/users/);
  assert.match(planTeam({ userId: "u2", patch: { title: "x" }, confirm: "Josh Miller" }, { list: "nope" }).refused, /settings\/users/);
  assert.match(planTeam({ userId: "u2", patch: { name: "" }, confirm: "" }, doc).refused, /name/);
  assert.match(planTeam({ userId: "u2", patch: { name: "Keegan" }, confirm: "Keegan" }, doc).refused, /already a team member named Keegan/);
});
await ok("team.edit: active:false on Koy (the caller) refuses; active:false on someone else is the remove; a removed key via {__delete:true}; add (no userId) appends with a u_<ms> id, length + 1, confirm = the new name; an add without a name / with a taken name / with an id refuses", () => {
  const doc = DOCS()["settings/users"];
  assert.match(planTeam({ userId: "u1", patch: { active: false }, confirm: "Koy" }, doc).refused, /Koy's own record|yourself/);
  assert.match(planTeam({ userId: "u1", patch: { active: false, name: "K" }, confirm: "K" }, doc).refused, /Koy's own record|yourself/);
  const off = planTeam({ userId: "u3", patch: { active: false }, confirm: "Keegan" }, doc);
  assert.strictEqual(off.list.length, USERS.length); assert.strictEqual(off.list[2].active, false); assert.strictEqual(off.result.deactivated, true);
  const del = planTeam({ userId: "u3", patch: { caps: { __delete: true } }, confirm: "Keegan" }, { ...doc, list: doc.list.map(u => (u.id === "u3" ? { ...u, caps: ["x"] } : u)) });
  assert.ok(!("caps" in del.list[2])); assert.deepStrictEqual(del.before.caps, ["x"]); assert.ok(!("caps" in del.after));
  const add = planTeam({ patch: { name: "New Guy", title: "crew", access: "limited" }, confirm: "New Guy" }, doc);
  assert.strictEqual(add.list.length, USERS.length + 1); assert.strictEqual(add.userId, "u_" + Date.parse(NOW)); assert.strictEqual(add.name, "New Guy");
  assert.deepStrictEqual(add.list[USERS.length], { id: "u_" + Date.parse(NOW), name: "New Guy", title: "crew", access: "limited" });
  assert.strictEqual(add.before, null); assert.deepStrictEqual(add.after, add.list[USERS.length]); assert.strictEqual(add.result.added, true);
  assert.strictEqual(planTeam({ patch: { name: "New Guy" } }, doc).refused, CONFIRM("New Guy"));
  assert.match(planTeam({ patch: { title: "crew" }, confirm: "x" }, doc).refused, /name/);
  assert.match(planTeam({ patch: { name: "keegan" }, confirm: "keegan" }, doc).refused, /already a team member named Keegan/);
  assert.match(planTeam({ patch: { name: "Abe" }, confirm: "Abe" }, doc).refused, /already a team member named Abe/, "a deactivated person's name is still taken — reactivate instead");
});

// ── 7. stampFor ──────────────────────────────────────────────────────────────
await ok("stampFor: a doc with updatedAt gets the settings stamp {updatedAt, tab, merged:false}; one with updated_at gets {updated_at, saved_by:\"Duet (Koy)\"}; both → both; neither → nothing; a new plain doc (live null) gets {updated_at, saved_by}; stamps are strictly newer than the doc's", () => {
  const c = ctx();
  const s = AD.stampFor("settings", { updatedAt: "2026-11-01T10:00:00.000Z" }, c, "rid-12345678-x");
  assert.deepStrictEqual(s, { updatedAt: NOW, tab: "duet-rid-1234", merged: false });
  const u = AD.stampFor("plain", { updated_at: NOW }, c, "rid-12345678-x");
  assert.deepStrictEqual(u, { updated_at: new Date(Date.parse(NOW) + 1).toISOString(), saved_by: "Duet (Koy)" }, "strictly newer than an equal stamp");
  assert.deepStrictEqual(AD.stampFor("plain", { updated_at: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z" }, c, "rid-12345678-x"), { updatedAt: NOW, tab: "duet-rid-1234", merged: false, updated_at: NOW, saved_by: "Duet (Koy)" });
  assert.deepStrictEqual(AD.stampFor("plain", { text: "x" }, c, "rid-12345678-x"), {});
  assert.deepStrictEqual(AD.stampFor("plain", null, c, "rid-12345678-x"), { updated_at: NOW, saved_by: "Duet (Koy)" });
  assert.deepStrictEqual(AD.stampFor("settings", null, c, "rid-12345678-x"), { updated_at: NOW, saved_by: "Duet (Koy)" });
});

console.log(`\n${n} checks passed — duet-anydoc-test`);
})().catch(e => { console.error("FAIL duet-anydoc-test:", e && e.stack || e); process.exit(1); });
