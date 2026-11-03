#!/usr/bin/env node
/* duet-punch-test.js — Duet write access (connector D9), ship 6: punch items.
 *
 * Drives functions/duetWrites/punch.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction holding a real-shaped job: three punch trees (normalized floors,
 * a legacy bare-array floor, an extras floor, rooms, hot check, QC-walk items,
 * a voided one), linked return trips (an open QC-Fail trip with clones, a
 * signed-off one, a legacy entry with no originPhase) and a punchTicks slot.
 * Proves: the done flip's exact fields + the slot derived by the app's own
 * punchTickPatches (written dotted, never the map) + the return-trip cascade
 * for rough / finish and none for qc; undone clears; add shapes (general /
 * hotcheck / room, text through escapeHtml, Mountain YMD stamp, material on
 * the item only), a new room fanned out EMPTY with a fresh id to the other
 * phase (and Legacy QC while it has open items), deduped by ccRoomNameKey, no
 * fan-out from an extras floor or from qc, hotcheck refused on rough; assign
 * refuses done and resolves the team spelling; waiting on / off; void only on
 * fromQC items with the QC-Fail clone strip (signed-off trips untouched) and
 * the handleVoidQCItem tree spread; restore; edit refuses done; unknown floor /
 * room / item refused with hints; a legacy bare-array floor normalized by the
 * rebuild; everything else on the job byte-identical; only jobs + duet_writes
 * ever written, never a delete. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const PU = require(path.join(root, "functions", "duetWrites", "punch.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const { applyPunchTicks } = require(path.join(root, "functions", "punchTicks.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";          // Tue 9:30 PM Mountain (Nov 3) — a UTC-vs-Mountain date trap on purpose
const TODAY = "2026-11-03";
const MDY = "11/3/2026";
const TZ = "America/Denver";
const USERS = [
  { id: 1, name: "Koy", title: "office", access: "admin" },
  { id: 3, name: "Colby", title: "foreman" },
  { id: 4, name: "Keegan", title: "foreman" },
  { id: 6, name: "Brady", title: "crew" },
  { id: 8, name: "Old Guy", title: "foreman", active: false },
  { id: 11, name: "Sub Guy", title: "crew", access: "contractor" },
];
const FORTH = "1772863862618", GONE = "1772863862620", BARE = "1772863862621", NOTREE = "1772863862622";
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── a real-shaped job ────────────────────────────────────────────────────────
const PU1 = { id: "1761000000001", text: "Nail plates on the <b>hall</b> run", done: false, addedBy: "Keegan", addedAt: "2026-10-28", addedAtTs: "2026-10-28T15:00:00.000Z", assignedTo: "Brady", photos: [] };
const PU2 = { id: "1761000000002", text: "Strap the feeder", done: true, checkedBy: "Keegan", checkedAt: "10/30/2026", checkedAtTs: "2026-10-30T16:00:00.000Z", addedBy: "Keegan", addedAt: "2026-10-28", addedAtTs: "2026-10-28T15:01:00.000Z", assignedTo: "Brady", waiting: false };
const PR1 = { id: "1761000000003", text: "Box for the fan", done: false, fromQC: true, severity: "serious", addedBy: "Koy", addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:00:00.000Z", waiting: true, waitingOn: "GC to pick the fan" };
const PR2 = { id: "1761000000004", text: "Old voided one", done: false, fromQC: true, voided: true, voidReason: "dup", voidedBy: "Koy", voidedAt: "11/1/2026", addedBy: "Koy", addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:01:00.000Z" };
const PM1 = { id: "1761000000005", text: "Legacy floor item", done: false, addedBy: "Colby" };          // on a BARE-ARRAY main floor
const PG1 = { id: "1761000000006", text: "Opener receptacle", done: false, addedBy: "Keegan", addedAt: "2026-10-29", addedAtTs: "2026-10-29T15:00:00.000Z" };   // extras floor
const PF1 = { id: "1761000000007", text: "Trim plates kitchen", done: false, addedBy: "Colby", addedAt: "2026-11-02", addedAtTs: "2026-11-02T15:00:00.000Z" };
const PH1 = { id: "1761000000008", text: "Hot check the range", done: false, fromQC: true, addedBy: "Koy", addedAt: "2026-11-02", addedAtTs: "2026-11-02T15:02:00.000Z" };   // finish hotcheck
const PQ1 = { id: "1761000000009", text: "Legacy QC item", done: false, addedBy: "Josh", addedAt: "2026-09-01", addedAtTs: "2026-09-01T15:00:00.000Z" };
const ROUGH = () => ({
  upper: { general: [PU1, PU2], rooms: [{ id: "r_bath", name: "Primary bath", items: [PR1, PR2] }], hotcheck: [], photos: [{ id: "fp1", url: "x" }] },
  main: [PM1],
  basement: { general: [], rooms: [], hotcheck: [], photos: [] },
  extras: [{ key: "extra_garage_1", label: "Garage" }],
  extra_garage_1: { general: [PG1], rooms: [], hotcheck: [], photos: [] },
});
const FINISH = () => ({
  upper: { general: [], rooms: [{ id: "f_bath", name: "PRIMARY  BATH", items: [] }], hotcheck: [PH1], photos: [] },
  main: { general: [PF1], rooms: [], hotcheck: [], photos: [] },
  basement: { general: [], rooms: [], hotcheck: [], photos: [] },
  extras: [],
});
const QC = () => ({ upper: { general: [PQ1], rooms: [], hotcheck: [], photos: [] }, main: { general: [], rooms: [], hotcheck: [], photos: [] }, basement: { general: [], rooms: [], hotcheck: [], photos: [] } });
const QC_CLOSED = () => ({ upper: { general: [{ ...PQ1, done: true }], rooms: [], hotcheck: [], photos: [] }, main: { general: [], rooms: [], hotcheck: [], photos: [] }, basement: { general: [], rooms: [], hotcheck: [], photos: [] } });
const RT_QCFAIL = { id: "rt1", scope: "QC Fail — return trip needed", fromQCFail: true, rtStatus: "needs", signedOff: false, photos: [],
  punch: [{ id: "c1", text: "Box for the fan", done: false, fromQC: true, originItemId: PR1.id, originPhase: "rough", addedAt: "2026-11-01" }, { id: "c2", text: "Other", done: false, fromQC: true, originItemId: "nope", originPhase: "rough" }] };
const RT_SIGNED = { id: "rt2", scope: "QC Fail — old", fromQCFail: true, rtStatus: "complete", signedOff: true, signedOffBy: "Colby", photos: [],
  punch: [{ id: "c3", text: "Box for the fan", done: false, originItemId: PR1.id, originPhase: "rough" }] };
const RT_LEGACY = { id: "rt3", scope: "Finish items", rtStatus: "scheduled", signedOff: false, photos: [],
  punch: [{ id: "c4", text: "Nail plates", done: false, originItemId: PU1.id }, { id: "c5", text: "Trim plates", done: false, originItemId: PF1.id, originPhase: "finish" }, { id: "c6", text: "no link", done: false }] };
const JOB_DOC = (name, extra) => ({ data: { name, foreman: "Keegan", lead: "Colby", archived: false, roughPunch: ROUGH(), finishPunch: FINISH(), qcPunch: QC(), returnTrips: [RT_QCFAIL, RT_SIGNED, RT_LEGACY],
  punchTicks: { [PU2.id]: { done: true, by: "Keegan", at: "10/30/2026", ts: "2026-10-30T16:00:00.000Z" } }, changeOrders: [{ id: "c1" }], roughStatus: "inprogress", ...(extra || {}) },
  updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 604, w: "604.abcdefgh" });
const ctx = (over) => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: `${TODAY}T12:00:00`, users: USERS, tz: TZ, ...(over || {}) });
const jobCtx = (extra) => ctx({ job: { id: FORTH, data: JOB_DOC("Forth", extra).data } });

// ── fake io ──────────────────────────────────────────────────────────────────
function fakeIo({ docs = {}, recent = 0, users = USERS } = {}) {
  const log = [];
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => {
    const parts = dotted.split("."); let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = v;
  };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r) => { log.push(["create", r.path]); throw new Error("create must never be called by a punch write"); },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => setPath(cur, k, d[k])); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store,
    nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null,
    countRecent: async () => recent,
    getJob: async () => null,
    getUsers: async () => users,
    openNeeds: async () => [],
    runTx: async (fn) => fn(tx),
    needRef: (id) => ref("needs", id),
    jobRef: (id) => ref("jobs", id),
    hrRef: (id) => ref("homeowner_requests", id),
    auditRef: (id) => ref("duet_writes", id),
    settingsRef: (id) => { throw new api.Refusal(400, "settings/" + id + " must never be opened by a punch write"); },
    arrayUnion: (...x) => ({ __arrayUnion: x }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
}
const DOCS = (extra) => ({ ["jobs/" + FORTH]: JOB_DOC("Forth", extra), ["jobs/" + GONE]: JOB_DOC("Gone", { archived: true }), ["jobs/" + BARE]: JOB_DOC("Bare", { roughPunch: [PM1] }), ["jobs/" + NOTREE]: JOB_DOC("NoTree", { finishPunch: undefined, qcPunch: undefined }) });
const run = (body, io) => api.handle(body, io);
const RID = (k) => `66666666-6666-4666-8666-${String(k).padStart(12, "0")}`;
let rid = 0;
const call = (io, action, args) => run({ requestId: RID(++rid), action, args: { jobId: FORTH, ...args } }, io);
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const checkStamp = (upd) => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-6666"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 605 && /^\d+\.duet[a-z0-9]{6,}$/.test(upd.w), "version-lock stamp");
  assert.strictEqual(upd.merged, false); assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true });
  assert.ok(Date.parse(upd.updated_at) > Date.parse("2026-11-03T20:00:00.000Z"), "updated_at strictly newer than the doc's");
};
const jobUpdate = (io) => { const u = io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/")); assert.strictEqual(u.length, 1, "exactly one job update"); return u[0][2]; };
const dataKeys = (upd) => Object.keys(upd).filter(k => k.startsWith("data.")).sort();
// Strip items / rooms (by id) out of a tree so the rest can be compared byte for byte.
const without = (tree, ids) => {
  const t = clone(tree); const drop = new Set(ids.map(String));
  for (const fk of Object.keys(t)) { const fl = t[fk]; if (!fl || typeof fl !== "object" || Array.isArray(fl)) continue;
    ["general", "hotcheck"].forEach(k => { if (Array.isArray(fl[k])) fl[k] = fl[k].filter(i => !drop.has(String(i.id))); });
    if (Array.isArray(fl.rooms)) fl.rooms = fl.rooms.filter(r => !drop.has(String(r.id))).map(r => ({ ...r, items: (r.items || []).filter(i => !drop.has(String(i.id))) })); }
  return t;
};
const restIdentical = (io, keysWritten) => {
  // Every data.* field NOT in keysWritten is the live copy, byte for byte; the envelope is the only other change.
  const before = JOB_DOC("Forth").data, after = io.store["jobs/" + FORTH].data;
  const wrote = new Set(keysWritten);
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!wrote.has(k)) assert.deepStrictEqual(after[k], before[k], "data." + k + " untouched");
};

(async () => {
// ── shapes ───────────────────────────────────────────────────────────────────
await ok("normFloor: an object floor keeps its four lists, a legacy bare array is `general`, junk is empty; rebuildTree normalizes every floor, keeps extras, swaps the edited floor", () => {
  assert.deepStrictEqual(PU.normFloor([PM1]), { general: [PM1], rooms: [], hotcheck: [], photos: [] });
  assert.deepStrictEqual(PU.normFloor({ general: [PM1], photos: [{ id: 1 }] }), { general: [PM1], rooms: [], hotcheck: [], photos: [{ id: 1 }] });
  assert.deepStrictEqual(PU.normFloor(undefined), { general: [], rooms: [], hotcheck: [], photos: [] });
  assert.deepStrictEqual(PU.normFloor({ photos: [1] }), { general: [], rooms: [], hotcheck: [], photos: [] }, "an object without general/rooms/hotcheck is treated as empty (the app's rule)");
  const t = PU.rebuildTree(ROUGH(), "basement", { general: [PG1], rooms: [], hotcheck: [], photos: [] });
  assert.deepStrictEqual(Object.keys(t), ["upper", "main", "basement", "extras", "extra_garage_1"]);
  assert.deepStrictEqual(t.main, { general: [PM1], rooms: [], hotcheck: [], photos: [] }, "the legacy bare-array floor comes back normalized");
  assert.deepStrictEqual(t.upper, ROUGH().upper); assert.deepStrictEqual(t.extras, ROUGH().extras); assert.deepStrictEqual(t.extra_garage_1, ROUGH().extra_garage_1); assert.deepStrictEqual(t.basement.general, [PG1]);
  assert.deepStrictEqual(PU.floorKeysOf(ROUGH()), ["upper", "main", "basement", "extra_garage_1"]); assert.deepStrictEqual(PU.floorKeysOf(FINISH()), ["upper", "main", "basement"]);
  assert.strictEqual(PU.floorLabel(ROUGH(), "extra_garage_1"), "Garage"); assert.strictEqual(PU.floorLabel(ROUGH(), "main"), "Main Level");
  assert.strictEqual(PU.punchOpen(QC()), 1); assert.strictEqual(PU.punchOpen(QC_CLOSED()), 0); assert.strictEqual(PU.punchOpen(ROUGH()), 5, "legacy floor + extras counted, done ones not");
});
await ok("locate: general, a room, hot check, an extras floor and a legacy bare-array floor; null when the id is nowhere; room keys, the Mountain YMD stamp at 9:30 PM, text escaping", () => {
  const r = ROUGH(), f = FINISH();
  assert.deepStrictEqual({ ...PU.locate(r, PU1.id), item: undefined }, { floorKey: "upper", floorLabel: "Upper Level", roomId: "general", room: "", index: 0, item: undefined });
  assert.deepStrictEqual({ ...PU.locate(r, PR2.id), item: undefined }, { floorKey: "upper", floorLabel: "Upper Level", roomId: "r_bath", room: "Primary bath", index: 1, item: undefined });
  assert.strictEqual(PU.locate(r, PM1.id).floorKey, "main"); assert.strictEqual(PU.locate(r, PM1.id).roomId, "general");
  assert.strictEqual(PU.locate(r, PG1.id).floorKey, "extra_garage_1"); assert.strictEqual(PU.locate(r, PG1.id).floorLabel, "Garage");
  assert.strictEqual(PU.locate(f, PH1.id).roomId, "hotcheck"); assert.strictEqual(PU.locate(f, PH1.id).room, "Hot Check");
  assert.strictEqual(PU.locate(r, PF1.id), null); assert.strictEqual(PU.locate(null, PU1.id), null); assert.strictEqual(PU.locate([PM1], PM1.id), null, "a flat-array tree is not a tree");
  assert.strictEqual(PU.ccRoomNameKey("  Primary​  BATH "), "primary bath"); assert.strictEqual(PU.ccRoomNameKey("x".repeat(50)), "x".repeat(40));
  assert.deepStrictEqual(PU.punchStamp(NOW, TZ), { addedAt: "2026-11-03", addedAtTs: NOW }, "9:30 PM Mountain is still Nov 3 — YMD stays YYYY-MM-DD");
  assert.strictEqual(PU.toHtml("5 < 6 & \"ok\"\nline 2"), "5 &lt; 6 &amp; &quot;ok&quot;<br>line 2");
  assert.deepStrictEqual(PU.allIds(JOB_DOC("Forth").data).length, 11, "every item + room id across the three trees");
});

// ── done flip ────────────────────────────────────────────────────────────────
await ok("setDone true: the checkbox's exact fields on the ONE item, the whole tree back normalized (legacy main floor included, extras kept), the slot from punchTickPatches as the dotted data.punchTicks.<id>, the linked return-trip entry flipped (a legacy entry with no originPhase counts as rough), everything else byte-identical", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.setDone", { phase: "rough", itemId: PU1.id, done: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.punchTicks." + PU1.id, "data.returnTrips", "data.roughPunch"]);
  assert.ok(Object.keys(upd).every(k => k.startsWith("data.") || ENVELOPE.includes(k)));
  const tree = upd["data.roughPunch"];
  const it = PU.locate(tree, PU1.id).item;
  assert.deepStrictEqual(it, { ...PU1, done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW, waiting: false });
  assert.deepStrictEqual(upd["data.punchTicks." + PU1.id], { done: true, by: "Koy", at: MDY, ts: NOW });
  assert.ok(!("data.punchTicks" in upd), "never the whole map");
  assert.deepStrictEqual(without(tree, [PU1.id]), without(PU.normalizeTree(ROUGH()), [PU1.id]), "every other item, room, photo and floor is the live copy, normalized");
  assert.deepStrictEqual(tree.main, { general: [PM1], rooms: [], hotcheck: [], photos: [] }); assert.deepStrictEqual(tree.extras, ROUGH().extras);
  const trips = upd["data.returnTrips"];
  assert.deepStrictEqual(trips[0], RT_QCFAIL); assert.deepStrictEqual(trips[1], RT_SIGNED, "a trip with no entry for this item is the same object");
  assert.deepStrictEqual(trips[2].punch[0], { ...RT_LEGACY.punch[0], done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW });
  assert.deepStrictEqual(trips[2].punch.slice(1), RT_LEGACY.punch.slice(1), "the finish-linked and unlinked entries untouched");
  assert.strictEqual(r.body.returnTripEntriesUpdated, 1); assert.strictEqual(r.body.punchId, PU1.id); assert.strictEqual(r.body.floor, "upper"); assert.deepStrictEqual(r.body.slot, { done: true, by: "Koy", at: MDY, ts: NOW });
  assert.strictEqual(r.body.text, "Nail plates on the hall run", "the answer shows the text without its tags");
  const audit = io.store["duet_writes/" + RID(rid)];
  assert.deepStrictEqual(audit.fields.sort(), ["punchTicks." + PU1.id, "returnTrips", "roughPunch"]); assert.deepStrictEqual(audit.before.roughPunch, PU1); assert.deepStrictEqual(audit.after.roughPunch, it);
  assert.strictEqual(audit.before["punchTicks." + PU1.id], null); assert.strictEqual(audit.before.returnTrips.length, 1); assert.strictEqual(audit.itemId, PU1.id); assert.strictEqual(audit.coll, "jobs");
  // the app's overlay agrees: applyPunchTicks on the written doc shows the item done by Koy, and the old slot is still there
  const stored = io.store["jobs/" + FORTH].data;
  assert.strictEqual(PU.locate(applyPunchTicks(stored).roughPunch, PU1.id).item.checkedBy, "Koy");
  assert.deepStrictEqual(stored.punchTicks[PU2.id], JOB_DOC("Forth").data.punchTicks[PU2.id], "the other slot untouched");
  restIdentical(io, ["roughPunch", "punchTicks", "returnTrips"]);
});
await ok("setDone true on a QC-walk item in a room: the open QC-Fail trip's clone AND the signed-off trip's clone flip (the app's cascade walks every trip), the unrelated clone doesn't", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.setDone", { phase: "rough", itemId: PR1.id, done: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  const it = PU.locate(upd["data.roughPunch"], PR1.id).item;
  assert.deepStrictEqual(it, { ...PR1, done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW, waiting: false }, "waiting cleared, waitingOn kept (the app's rule)");
  const trips = upd["data.returnTrips"];
  assert.strictEqual(trips[0].punch[0].done, true); assert.strictEqual(trips[0].punch[0].checkedBy, "Koy"); assert.deepStrictEqual(trips[0].punch[1], RT_QCFAIL.punch[1]);
  assert.strictEqual(trips[1].punch[0].done, true); assert.deepStrictEqual(trips[2], RT_LEGACY);
  assert.strictEqual(r.body.returnTripEntriesUpdated, 2); assert.strictEqual(r.body.room, "Primary bath"); assert.strictEqual(r.body.roomId, "r_bath");
});
await ok("setDone false: done off and the three stamps cleared, waiting left as it was, the un-done slot {done:false, by:Koy, at, ts}; the existing slot for that item shows as `before`", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.setDone", { phase: "rough", itemId: PU2.id, done: false });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  assert.deepStrictEqual(dataKeys(upd), ["data.punchTicks." + PU2.id, "data.roughPunch"], "no linked trip entry → returnTrips not in the write");
  assert.deepStrictEqual(PU.locate(upd["data.roughPunch"], PU2.id).item, { ...PU2, done: false, checkedBy: "", checkedAt: "", checkedAtTs: "" });
  const slot = upd["data.punchTicks." + PU2.id];
  assert.strictEqual(slot.done, false); assert.strictEqual(slot.by, "Koy"); assert.strictEqual(slot.ts, NOW); assert.ok(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(slot.at));
  const audit = io.store["duet_writes/" + RID(rid)];
  assert.deepStrictEqual(audit.before["punchTicks." + PU2.id], { done: true, by: "Keegan", at: "10/30/2026", ts: "2026-10-30T16:00:00.000Z" });
  assert.strictEqual(PU.locate(applyPunchTicks(io.store["jobs/" + FORTH].data).roughPunch, PU2.id).item.done, false, "the app's overlay now shows it open");
});
await ok("setDone on the Legacy QC list (qcPunch): slot written, no cascade — returnTrips never in the write", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.setDone", { phase: "qc", itemId: PQ1.id, done: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  assert.deepStrictEqual(dataKeys(upd), ["data.punchTicks." + PQ1.id, "data.qcPunch"]);
  assert.deepStrictEqual(upd["data.qcPunch"].upper.general[0], { ...PQ1, done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW, waiting: false });
  assert.deepStrictEqual(Object.keys(upd["data.qcPunch"]), ["upper", "main", "basement", "extras"], "a tree with no extras gets extras: [] — handleFloorChange's shape");
  assert.strictEqual(r.body.returnTripEntriesUpdated, 0);
});
await ok("setDone on a legacy bare-array floor: the item is found, the floor is written back normalized, the slot still derived", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.setDone", { phase: "rough", itemId: PM1.id, done: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  assert.deepStrictEqual(upd["data.roughPunch"].main, { general: [{ ...PM1, done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW, waiting: false }], rooms: [], hotcheck: [], photos: [] });
  assert.deepStrictEqual(upd["data.punchTicks." + PM1.id], { done: true, by: "Koy", at: MDY, ts: NOW });
});
await ok("setDone: already that way → noop with nothing written; a voided item, an unknown id (with the other-list hint), a wrong phase, a non-boolean, a flat-array tree, an archived job and a missing job all refuse", async () => {
  const io = fakeIo({ docs: DOCS() });
  const same = await call(io, "punch.setDone", { phase: "rough", itemId: PU2.id, done: true });
  assert.strictEqual(same.status, 200); assert.strictEqual(same.body.noop, true); assert.ok(!io.log.some(l => l[0] === "update" && l[1].startsWith("jobs/")));
  const voided = await call(io, "punch.setDone", { phase: "rough", itemId: PR2.id, done: true });
  assert.strictEqual(voided.status, 400); assert.match(voided.body.refused, /voided/);
  const wrongPhase = await call(io, "punch.setDone", { phase: "finish", itemId: PU1.id, done: true });
  assert.strictEqual(wrongPhase.status, 400); assert.match(wrongPhase.body.refused, /on the rough list; say phase rough/);
  const unknown = await call(io, "punch.setDone", { phase: "rough", itemId: "1799999999999", done: true });
  assert.strictEqual(unknown.status, 400); assert.match(unknown.body.refused, /No rough punch item with id 1799999999999 on Forth .*cc_list_punch/);
  const bad = await call(io, "punch.setDone", { phase: "rough", itemId: PU1.id, done: "yes" });
  assert.strictEqual(bad.status, 400); assert.match(bad.body.refused, /true or false/);
  const badPhase = await call(io, "punch.setDone", { phase: "trim", itemId: PU1.id, done: true });
  assert.strictEqual(badPhase.status, 400); assert.match(badPhase.body.refused, /phase must be one of rough, finish, qc/);
  const flat = await run({ requestId: RID(++rid), action: "punch.setDone", args: { jobId: BARE, phase: "rough", itemId: PM1.id, done: true } }, io);
  assert.strictEqual(flat.status, 400); assert.match(flat.body.refused, /legacy flat list/);
  const gone = await run({ requestId: RID(++rid), action: "punch.setDone", args: { jobId: GONE, phase: "rough", itemId: PU1.id, done: true } }, io);
  assert.strictEqual(gone.status, 400); assert.match(gone.body.refused, /archived/);
  const missing = await run({ requestId: RID(++rid), action: "punch.setDone", args: { jobId: "1700000000000", phase: "rough", itemId: PU1.id, done: true } }, io);
  assert.strictEqual(missing.status, 404);
  assert.ok(!io.log.some(l => l[0] === "update" && l[1].startsWith("jobs/")), "no job write in any refusal");
  assert.strictEqual(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length, 9, "every call left its audit doc");
});

// ── add ──────────────────────────────────────────────────────────────────────
await ok("add to general on the legacy main floor: commitAdd's item appended LAST — id a millisecond string past every id on the job, text through escapeHtml with line breaks kept, done false, addedBy Koy, addedAt the Mountain YMD, addedAtTs the ISO; the floor comes back normalized; no material keys when none given; no fan-out (no room)", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "rough", floor: "main", text: "Add a 20A circuit <b>here</b>\nfeed from panel B" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.roughPunch"]);
  const gen = upd["data.roughPunch"].main.general;
  assert.strictEqual(gen.length, 2); assert.deepStrictEqual(gen[0], PM1);
  const item = gen[1];
  assert.deepStrictEqual(item, { id: item.id, text: "Add a 20A circuit &lt;b&gt;here&lt;/b&gt;<br>feed from panel B", done: false, addedBy: "Koy", addedAt: "2026-11-03", addedAtTs: NOW });
  assert.ok(/^\d{13}$/.test(item.id) && Number(item.id) >= Date.parse(NOW) && !PU.allIds(JOB_DOC("Forth").data).map(String).includes(item.id));
  assert.deepStrictEqual(without(upd["data.roughPunch"], [item.id]), PU.normalizeTree(ROUGH()), "the rest of the tree is the live copy, normalized");
  assert.strictEqual(r.body.punchId, item.id); assert.strictEqual(r.body.where, "general"); assert.strictEqual(r.body.number, 2); assert.strictEqual(r.body.roomAdded, false); assert.strictEqual(r.body.roomFannedOutTo, undefined); assert.strictEqual(r.body.materialNote, undefined);
  const audit = io.store["duet_writes/" + RID(rid)];
  assert.deepStrictEqual(audit.before, { roughPunch: null }); assert.deepStrictEqual(audit.after, { roughPunch: item }); assert.strictEqual(audit.itemId, item.id);
  restIdentical(io, ["roughPunch"]);
});
await ok("add with material: materialNeeded trimmed + materialSource on the item only (the app's roughMaterials card is NOT written — ship 8, and the answer says so); blank material → neither key; a source outside the app's list refuses; empty text refuses", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "finish", floor: "basement", text: "Hang the pendant", materialNeeded: "  1 pendant kit\n20ft 14/2 ", materialSource: "CED" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const item = jobUpdate(io)["data.finishPunch"].basement.general[0];
  assert.strictEqual(item.materialNeeded, "1 pendant kit\n20ft 14/2"); assert.strictEqual(item.materialSource, "CED"); assert.match(r.body.materialNote, /ship 8/);
  assert.deepStrictEqual(dataKeys(jobUpdate(io)), ["data.finishPunch"], "no finishMaterials / roughMaterials write");
  const io2 = fakeIo({ docs: DOCS() });
  const r2 = await call(io2, "punch.add", { phase: "finish", floor: "basement", text: "x", materialNeeded: "   ", materialSource: "CED" });
  const item2 = jobUpdate(io2)["data.finishPunch"].basement.general[0];
  assert.ok(!("materialNeeded" in item2) && !("materialSource" in item2), "commitAdd only sets material keys when the material text is non-blank"); assert.strictEqual(r2.status, 200);
  const bad = await call(io2, "punch.add", { phase: "finish", floor: "basement", text: "x", materialNeeded: "wire", materialSource: "Lowes" });
  assert.strictEqual(bad.status, 400); assert.match(bad.body.refused, /Shop, Home Depot, CED, Platt, Amazon, Other/);
  const empty = await call(io2, "punch.add", { phase: "finish", floor: "basement", text: "  \n " });
  assert.strictEqual(empty.status, 400); assert.match(empty.body.refused, /needs text/);
});
await ok("add to hotcheck: appended to finish's hot check list; refused on rough (no hot check there); qc allowed", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "finish", floor: "upper", where: "hotcheck", text: "Hot check the oven" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const hc = jobUpdate(io)["data.finishPunch"].upper.hotcheck;
  assert.strictEqual(hc.length, 2); assert.deepStrictEqual(hc[0], PH1); assert.strictEqual(hc[1].text, "Hot check the oven"); assert.strictEqual(r.body.number, 2);
  const rough = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "hotcheck", text: "x" });
  assert.strictEqual(rough.status, 400); assert.match(rough.body.refused, /finish and qc only/);
  const io3 = fakeIo({ docs: DOCS() });
  assert.strictEqual((await call(io3, "punch.add", { phase: "qc", floor: "main", where: "hotcheck", text: "x" })).status, 200);
});
await ok("add to an existing room by name (case / spacing / zero-width insensitive, the app's ccRoomNameKey): appended into that room, no new room, no fan-out", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "room", roomName: "primary  BATH​", text: "Fan box" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  assert.deepStrictEqual(dataKeys(upd), ["data.roughPunch"]);
  const rooms = upd["data.roughPunch"].upper.rooms;
  assert.strictEqual(rooms.length, 1); assert.strictEqual(rooms[0].id, "r_bath"); assert.strictEqual(rooms[0].items.length, 3); assert.deepStrictEqual(rooms[0].items.slice(0, 2), [PR1, PR2]); assert.strictEqual(rooms[0].items[2].text, "Fan box");
  assert.strictEqual(r.body.room, "Primary bath"); assert.strictEqual(r.body.roomId, "r_bath"); assert.strictEqual(r.body.roomAdded, false); assert.strictEqual(r.body.number, 3);
  const byId = await call(fakeIo({ docs: DOCS() }), "punch.add", { phase: "rough", floor: "upper", where: "room", roomId: "r_bath", text: "By id" });
  assert.strictEqual(byId.status, 200); assert.strictEqual(byId.body.roomId, "r_bath");
});
await ok("add to a NEW room on rough upper: the room {id, name, items:[item]} appended; fanOutAddedRooms puts it EMPTY with a FRESH id on finish upper AND on the Legacy QC tree (it has open items); the three trees are the whole patch, before null / after the item + the rooms", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "room", roomName: " Laundry ", text: "Dryer receptacle" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io);
  assert.deepStrictEqual(dataKeys(upd), ["data.finishPunch", "data.qcPunch", "data.roughPunch"]);
  const rough = upd["data.roughPunch"], finish = upd["data.finishPunch"], qc = upd["data.qcPunch"];
  const room = rough.upper.rooms[1];
  assert.deepStrictEqual(rough.upper.rooms[0], ROUGH().upper.rooms[0]);
  assert.deepStrictEqual(room, { id: room.id, name: "Laundry", items: [room.items[0]] }); assert.strictEqual(room.items[0].text, "Dryer receptacle"); assert.notStrictEqual(room.id, room.items[0].id);
  const fRoom = finish.upper.rooms[1];
  assert.deepStrictEqual(finish.upper.rooms[0], FINISH().upper.rooms[0]); assert.deepStrictEqual(fRoom, { id: fRoom.id, name: "Laundry", items: [] }); assert.notStrictEqual(fRoom.id, room.id);
  const qRoom = qc.upper.rooms[0];
  assert.deepStrictEqual(qRoom, { id: qRoom.id, name: "Laundry", items: [] }); assert.ok(new Set([room.id, room.items[0].id, fRoom.id, qRoom.id]).size === 4, "four fresh ids, none shared");
  assert.deepStrictEqual(without(finish, [fRoom.id]), { ...FINISH(), upper: { ...FINISH().upper } }, "the other finish floors and the hot check untouched — adoptRooms spreads the live tree, it does not normalize it");
  assert.deepStrictEqual(without(qc, [qRoom.id]), QC());
  assert.deepStrictEqual(r.body.roomFannedOutTo, ["finishPunch", "qcPunch"]); assert.strictEqual(r.body.roomAdded, true); assert.strictEqual(r.body.room, "Laundry");
  const audit = io.store["duet_writes/" + RID(rid)];
  assert.deepStrictEqual(audit.fields.sort(), ["finishPunch", "qcPunch", "roughPunch"]);
  assert.deepStrictEqual(audit.before, { roughPunch: null, finishPunch: null, qcPunch: null }); assert.deepStrictEqual(audit.after.roughPunch, room.items[0]); assert.deepStrictEqual(audit.after.roomAdded, { id: room.id, name: "Laundry" }); assert.deepStrictEqual(audit.after.finishPunch, { roomAdded: fRoom });
  restIdentical(io, ["roughPunch", "finishPunch", "qcPunch"]);
});
await ok("fan-out dedupe + closed Legacy QC: a new rough room whose name already exists on finish (other casing) is NOT added there; with no open Legacy QC items the qc tree is not touched; a new room on finish fans to rough; a new room on an extras floor or on qc never fans out; a job with no finish tree yet fails closed (no fan-out)", async () => {
  const io = fakeIo({ docs: DOCS({ qcPunch: QC_CLOSED() }) });
  const r = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "room", roomName: "Primary Bath", text: "x" });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.roomAdded, false, "the rough room already existed by key");
  const r2 = await call(fakeIo({ docs: DOCS({ qcPunch: QC_CLOSED() }) }), "punch.add", { phase: "rough", floor: "main", where: "room", roomName: "Kitchen", text: "x" });
  assert.deepStrictEqual(r2.body.roomFannedOutTo, ["finishPunch"], "Legacy QC closed → finish only");
  const io3 = fakeIo({ docs: DOCS({ finishPunch: { ...FINISH(), main: { general: [PF1], rooms: [{ id: "fk", name: "KITCHEN", items: [] }], hotcheck: [], photos: [] } } }) });
  const r3 = await call(io3, "punch.add", { phase: "rough", floor: "main", where: "room", roomName: "Kitchen", text: "x" });
  assert.strictEqual(r3.status, 200); assert.deepStrictEqual(dataKeys(jobUpdate(io3)), ["data.qcPunch", "data.roughPunch"], "finish already has Kitchen → not in the patch; Legacy QC (open) gets it");
  const io4 = fakeIo({ docs: DOCS() });
  const r4 = await call(io4, "punch.add", { phase: "finish", floor: "basement", where: "room", roomName: "Theater", text: "x" });
  assert.deepStrictEqual(r4.body.roomFannedOutTo, ["roughPunch", "qcPunch"]); assert.strictEqual(jobUpdate(io4)["data.roughPunch"].basement.rooms[0].name, "Theater"); assert.deepStrictEqual(jobUpdate(io4)["data.roughPunch"].main, [PM1], "adoptRooms spreads the live rough tree — the legacy main floor stays as it is there");
  const io5 = fakeIo({ docs: DOCS() });
  const r5 = await call(io5, "punch.add", { phase: "rough", floor: "extra_garage_1", where: "room", roomName: "Bay 2", text: "x" });
  assert.strictEqual(r5.status, 200); assert.deepStrictEqual(dataKeys(jobUpdate(io5)), ["data.roughPunch"]); assert.strictEqual(r5.body.roomFannedOutTo, undefined); assert.strictEqual(r5.body.floorLabel, "Garage");
  const io6 = fakeIo({ docs: DOCS() });
  const r6 = await call(io6, "punch.add", { phase: "qc", floor: "main", where: "room", roomName: "Pantry", text: "x" });
  assert.strictEqual(r6.status, 200); assert.deepStrictEqual(dataKeys(jobUpdate(io6)), ["data.qcPunch"]);
  const io7 = fakeIo({ docs: DOCS() });
  const r7 = await run({ requestId: RID(++rid), action: "punch.add", args: { jobId: NOTREE, phase: "finish", floor: "main", where: "room", roomName: "Pantry", text: "x" } }, io7);
  assert.strictEqual(r7.status, 200, JSON.stringify(r7.body));
  const u7 = io7.log.filter(l => l[0] === "update")[0][2];
  assert.deepStrictEqual(dataKeys(u7), ["data.finishPunch"], "no previous finish tree → fanOutAddedRooms fails closed");
  assert.deepStrictEqual(Object.keys(u7["data.finishPunch"]), ["upper", "main", "basement", "extras"]); assert.strictEqual(u7["data.finishPunch"].main.rooms[0].name, "Pantry");
});
await ok("add: an unknown floor is refused with the valid keys (extras labelled) — a new floor is the app's; an unknown roomId lists the rooms there; room with neither id nor name refuses", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.add", { phase: "rough", floor: "attic", text: "x" });
  assert.strictEqual(r.status, 400); assert.match(r.body.refused, /floor must be one of upper, main, basement, extra_garage_1 \(Garage\)/); assert.match(r.body.refused, /added from the app/);
  const r2 = await call(io, "punch.add", { phase: "finish", floor: "extra_garage_1", text: "x" });
  assert.strictEqual(r2.status, 400); assert.match(r2.body.refused, /floor must be one of upper, main, basement on Forth's finish punch/);
  const r3 = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "room", roomId: "zzz", text: "x" });
  assert.strictEqual(r3.status, 400); assert.match(r3.body.refused, /No room with id zzz on the Upper Level .* rooms there: Primary bath/);
  const r4 = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "room", text: "x" });
  assert.strictEqual(r4.status, 400); assert.match(r4.body.refused, /roomId or roomName/);
  const r5 = await call(io, "punch.add", { phase: "rough", floor: "upper", where: "sideways", text: "x" });
  assert.strictEqual(r5.status, 400);
  assert.ok(!io.log.some(l => l[0] === "update" && l[1].startsWith("jobs/")));
});

// ── assign ───────────────────────────────────────────────────────────────────
await ok("assign: the team list's spelling, ONE item patched {assignedTo}, pushTo the person on a base floor; \"\" clears; same → noop; a done item refuses (the app hides the picker); unknown / inactive / contractor names refuse with close names; an extras-floor item says no push", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.assign", { phase: "rough", itemId: PU1.id, assignedTo: "colby" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.roughPunch"]);
  assert.deepStrictEqual(PU.locate(upd["data.roughPunch"], PU1.id).item, { ...PU1, assignedTo: "Colby" });
  assert.deepStrictEqual(r.body.pushTo, ["Colby"]); assert.strictEqual(r.body.from, "Brady"); assert.strictEqual(r.body.pushNote, undefined);
  assert.deepStrictEqual(without(upd["data.roughPunch"], [PU1.id]), without(PU.normalizeTree(ROUGH()), [PU1.id]));
  const clear = await call(io, "punch.assign", { phase: "rough", itemId: PU1.id, assignedTo: "" });
  assert.strictEqual(clear.status, 200); assert.strictEqual(PU.locate(io.store["jobs/" + FORTH].data.roughPunch, PU1.id).item.assignedTo, ""); assert.deepStrictEqual(clear.body.pushTo, []);
  const same = await call(io, "punch.assign", { phase: "rough", itemId: PU1.id, assignedTo: "" });
  assert.strictEqual(same.body.noop, true);
  const done = await call(io, "punch.assign", { phase: "rough", itemId: PU2.id, assignedTo: "Colby" });
  assert.strictEqual(done.status, 400); assert.match(done.body.refused, /already done .*hides this control/);
  for (const [who, re] of [["Zed", /isn't on the active team list/], ["Old Guy", /isn't on the active team list/], ["Sub Guy", /isn't on the active team list/], ["Col", /Close: Colby/]]) {
    const bad = await call(io, "punch.assign", { phase: "rough", itemId: PU1.id, assignedTo: who });
    assert.strictEqual(bad.status, 400, who); assert.match(bad.body.refused, re, who);
  }
  const extra = await call(io, "punch.assign", { phase: "rough", itemId: PG1.id, assignedTo: "Brady" });
  assert.strictEqual(extra.status, 200); assert.deepStrictEqual(extra.body.pushTo, []); assert.match(extra.body.pushNote, /only walks upper \/ main \/ basement/);
  const noArg = await call(io, "punch.assign", { phase: "rough", itemId: PU1.id });
  assert.strictEqual(noArg.status, 400);
});

// ── waiting ──────────────────────────────────────────────────────────────────
await ok("waiting on: {waiting:true, waitingOn: text.trim()}; off: {waiting:false, waitingOn:''}; same → noop; no text → refused; done item refuses", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.waiting", { phase: "rough", itemId: PU1.id, waiting: true, waitingOn: "  GC to confirm the can layout \n" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(PU.locate(upd["data.roughPunch"], PU1.id).item, { ...PU1, waiting: true, waitingOn: "GC to confirm the can layout" });
  assert.strictEqual(r.body.waiting, true); assert.strictEqual(r.body.waitingOn, "GC to confirm the can layout");
  const same = await call(io, "punch.waiting", { phase: "rough", itemId: PU1.id, waiting: true, waitingOn: "GC to confirm the can layout" });
  assert.strictEqual(same.body.noop, true);
  const off = await call(io, "punch.waiting", { phase: "rough", itemId: PR1.id, waiting: false });
  assert.strictEqual(off.status, 200); assert.deepStrictEqual(PU.locate(io.store["jobs/" + FORTH].data.roughPunch, PR1.id).item, { ...PR1, waiting: false, waitingOn: "" }); assert.strictEqual(off.body.wasWaitingOn, "GC to pick the fan");
  const offAgain = await call(io, "punch.waiting", { phase: "rough", itemId: PR1.id, waiting: false });
  assert.strictEqual(offAgain.body.noop, true);
  const noText = await call(io, "punch.waiting", { phase: "rough", itemId: PG1.id, waiting: true, waitingOn: "  " });
  assert.strictEqual(noText.status, 400); assert.match(noText.body.refused, /waitingOn/);
  const done = await call(io, "punch.waiting", { phase: "rough", itemId: PU2.id, waiting: true, waitingOn: "x" });
  assert.strictEqual(done.status, 400); assert.match(done.body.refused, /already done/);
});

// ── void / restore ───────────────────────────────────────────────────────────
await ok("void: only a QC-walk item (fromQC), reason required → {voided, voidReason, voidedBy:Koy, voidedAt:M/D/YYYY}; the tree is handleVoidQCItem's spread (ONLY the edited floor normalized — the legacy main floor stays a bare array); its clone is stripped from the OPEN QC-Fail trip, the signed-off trip and the non-QC trip untouched", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.void", { phase: "rough", itemId: PR1.id, reason: " Not in the plans \n" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.returnTrips", "data.roughPunch"]);
  const tree = upd["data.roughPunch"];
  assert.deepStrictEqual(PU.locate(tree, PR1.id).item, { ...PR1, voided: true, voidReason: "Not in the plans", voidedBy: "Koy", voidedAt: MDY });
  assert.deepStrictEqual(tree.main, [PM1], "handleVoidQCItem spreads the source tree: untouched floors are NOT normalized");
  assert.deepStrictEqual(Object.keys(tree), Object.keys(ROUGH())); assert.deepStrictEqual(tree.extras, ROUGH().extras); assert.deepStrictEqual(tree.extra_garage_1, ROUGH().extra_garage_1);
  assert.deepStrictEqual(without(tree, [PR1.id]), without(ROUGH(), [PR1.id]));
  const trips = upd["data.returnTrips"];
  assert.deepStrictEqual(trips[0], { ...RT_QCFAIL, punch: [RT_QCFAIL.punch[1]] }, "the clone is gone from the open QC-Fail trip, the unrelated one stays");
  assert.deepStrictEqual(trips[1], RT_SIGNED, "signed-off trips are immutable"); assert.deepStrictEqual(trips[2], RT_LEGACY);
  assert.strictEqual(r.body.returnTripClonesRemoved, 1); assert.strictEqual(r.body.voided, true);
  const audit = io.store["duet_writes/" + RID(rid)];
  assert.deepStrictEqual(audit.fields.sort(), ["returnTrips", "roughPunch"]); assert.deepStrictEqual(audit.before.returnTrips, [{ rtId: "rt1", entry: RT_QCFAIL.punch[0] }]); assert.deepStrictEqual(audit.after.returnTrips, [{ rtId: "rt1", removedEntryId: "c1" }]);
  restIdentical(io, ["roughPunch", "returnTrips"]);
  const again = await call(io, "punch.void", { phase: "rough", itemId: PR1.id, reason: "x" });
  assert.strictEqual(again.body.noop, true);
});
await ok("void refusals: a non-QC item (never deleted from Duet), no reason, the Legacy QC list, a voided-already noop; a void with no clone anywhere writes the tree only", async () => {
  const io = fakeIo({ docs: DOCS() });
  const plain = await call(io, "punch.void", { phase: "rough", itemId: PU1.id, reason: "x" });
  assert.strictEqual(plain.status, 400); assert.match(plain.body.refused, /wasn't added by the QC walk .*never deleted/);
  const noReason = await call(io, "punch.void", { phase: "rough", itemId: PR1.id, reason: "   " });
  assert.strictEqual(noReason.status, 400); assert.match(noReason.body.refused, /reason/);
  const qc = await call(io, "punch.void", { phase: "qc", itemId: PQ1.id, reason: "x" });
  assert.strictEqual(qc.status, 400); assert.match(qc.body.refused, /Legacy QC list has no void/);
  assert.ok(!io.log.some(l => l[0] === "update" && l[1].startsWith("jobs/")));
  const hc = await call(io, "punch.void", { phase: "finish", itemId: PH1.id, reason: "Range moved" });
  assert.strictEqual(hc.status, 200, JSON.stringify(hc.body)); assert.deepStrictEqual(dataKeys(jobUpdate(io)), ["data.finishPunch"]); assert.strictEqual(hc.body.returnTripClonesRemoved, 0);
  assert.strictEqual(jobUpdate(io)["data.finishPunch"].upper.hotcheck[0].voided, true);
});
await ok("restore: the four void fields cleared, fromQC kept, the whole tree rebuilt (writeFloor → handlePhasePunchChange), nothing re-added to the trip; not voided → noop; a non-QC item refuses", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.restore", { phase: "rough", itemId: PR2.id });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.roughPunch"]);
  assert.deepStrictEqual(PU.locate(upd["data.roughPunch"], PR2.id).item, { ...PR2, voided: false, voidReason: "", voidedBy: "", voidedAt: "" });
  assert.deepStrictEqual(upd["data.roughPunch"].main, { general: [PM1], rooms: [], hotcheck: [], photos: [] }, "restore goes through the whole-tree rebuild");
  assert.strictEqual(r.body.wasVoidReason, "dup"); assert.strictEqual(r.body.returnTripClonesReAdded, 0);
  const again = await call(io, "punch.restore", { phase: "rough", itemId: PR2.id });
  assert.strictEqual(again.body.noop, true);
  const plain = await call(io, "punch.restore", { phase: "rough", itemId: PU1.id });
  assert.strictEqual(plain.status, 400); assert.match(plain.body.refused, /QC walk/);
});

// ── edit ─────────────────────────────────────────────────────────────────────
await ok("editText: {text} escaped (+ materialNeeded trimmed / materialSource) on ONE item; a done item refuses; same → noop; empty text refuses; nothing given refuses; bad source refuses", async () => {
  const io = fakeIo({ docs: DOCS() });
  const r = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id, text: "Nail plates on the hall run & the <stair> run", materialNeeded: " 12 nail plates ", materialSource: "Shop" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["data.roughPunch"]);
  assert.deepStrictEqual(PU.locate(upd["data.roughPunch"], PU1.id).item, { ...PU1, text: "Nail plates on the hall run &amp; the &lt;stair&gt; run", materialNeeded: "12 nail plates", materialSource: "Shop" });
  assert.deepStrictEqual(r.body.changed, ["text", "materialNeeded", "materialSource"]); assert.match(r.body.materialNote, /ship 8/);
  const same = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id, text: "Nail plates on the hall run & the <stair> run" });
  assert.strictEqual(same.body.noop, true, JSON.stringify(same.body));
  const matOnly = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id, materialSource: "CED" });
  assert.strictEqual(matOnly.status, 200); assert.deepStrictEqual(matOnly.body.changed, ["materialSource"]); assert.strictEqual(PU.locate(io.store["jobs/" + FORTH].data.roughPunch, PU1.id).item.text, "Nail plates on the hall run &amp; the &lt;stair&gt; run", "text untouched when only material changes");
  const done = await call(io, "punch.editText", { phase: "rough", itemId: PU2.id, text: "x" });
  assert.strictEqual(done.status, 400); assert.match(done.body.refused, /already done/);
  const empty = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id, text: "   " });
  assert.strictEqual(empty.status, 400); assert.match(empty.body.refused, /never deleted/);
  const nothing = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id });
  assert.strictEqual(nothing.status, 400); assert.match(nothing.body.refused, /Say what to change/);
  const bad = await call(io, "punch.editText", { phase: "rough", itemId: PU1.id, materialSource: "eBay" });
  assert.strictEqual(bad.status, 400);
});

// ── the door ─────────────────────────────────────────────────────────────────
await ok("idempotency: the same requestId replays the first answer and writes nothing twice; the rate limit refuses before any read", async () => {
  const io = fakeIo({ docs: DOCS() });
  const a = await run({ requestId: RID(777), action: "punch.add", args: { jobId: FORTH, phase: "rough", floor: "main", text: "once" } }, io);
  const b = await run({ requestId: RID(777), action: "punch.add", args: { jobId: FORTH, phase: "rough", floor: "main", text: "once" } }, io);
  assert.strictEqual(a.status, 200); assert.strictEqual(b.body.replayed, true); assert.strictEqual(b.body.punchId, a.body.punchId);
  assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1); assert.strictEqual(io.store["jobs/" + FORTH].data.roughPunch.main.general.length, 2);
  const busy = fakeIo({ docs: DOCS(), recent: 60 });
  await assert.rejects(run({ requestId: RID(778), action: "punch.add", args: { jobId: FORTH, phase: "rough", floor: "main", text: "x" } }, busy), (e) => e.status === 429);
  assert.strictEqual(busy.log.length, 0);
});
await ok("all seven actions in a row touch only jobs/<id> and duet_writes — every job key is data.<phase>Punch, data.punchTicks.<id>, data.returnTrips or the envelope; never a delete, never a create, never a settings or needs doc; one audit doc per call", async () => {
  const io = fakeIo({ docs: DOCS() });
  const start = rid;
  const calls = [
    ["punch.add", { phase: "rough", floor: "upper", where: "room", roomName: "Office", text: "Floor box", materialNeeded: "1 floor box", materialSource: "Platt" }],
    ["punch.assign", { phase: "rough", itemId: PU1.id, assignedTo: "Keegan" }],
    ["punch.waiting", { phase: "rough", itemId: PU1.id, waiting: true, waitingOn: "plates" }],
    ["punch.setDone", { phase: "rough", itemId: PU1.id, done: true }],
    ["punch.setDone", { phase: "rough", itemId: PU1.id, done: false }],
    ["punch.editText", { phase: "finish", itemId: PF1.id, text: "Trim plates — kitchen + nook" }],
    ["punch.void", { phase: "rough", itemId: PR1.id, reason: "Dup of RT" }],
    ["punch.restore", { phase: "rough", itemId: PR1.id }],
    ["punch.setDone", { phase: "qc", itemId: PQ1.id, done: true }],
  ];
  for (const [action, args] of calls) { const r = await call(io, action, args); assert.strictEqual(r.status, 200, action + " " + JSON.stringify(r.body)); }
  const writes = io.log.filter(l => l[0] === "update" || l[0] === "set" || l[0] === "create" || l[0] === "delete");
  assert.ok(writes.every(w => w[1] === "jobs/" + FORTH || w[1].startsWith("duet_writes/")), "only the job and the audit collection");
  assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create"));
  assert.ok(!io.log.some(l => l[1].startsWith("settings/") || l[1].startsWith("needs/") || l[1].startsWith("homeowner_requests/")));
  const KEY = /^data\.(roughPunch|finishPunch|qcPunch|returnTrips|punchTicks\.[A-Za-z0-9_-]+)$/;
  assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/")).every(l => Object.keys(l[2]).every(k => KEY.test(k) || ENVELOPE.includes(k))), "job writes touch only the punch fields");
  assert.strictEqual(io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/") && "data.punchTicks" in l[2]).length, 0, "never the whole punchTicks map");
  assert.strictEqual(rid - start, calls.length); assert.strictEqual(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length, calls.length);
  const after = io.store["jobs/" + FORTH].data;
  assert.strictEqual(PU.locate(after.roughPunch, PU1.id).item.done, false); assert.strictEqual(PU.locate(after.roughPunch, PU1.id).item.assignedTo, "Keegan"); assert.strictEqual(PU.locate(after.roughPunch, PR1.id).item.voided, false);
  assert.strictEqual(after.returnTrips[0].punch.length, 1, "the void stripped the clone; restore did not re-add it (the app's rule)");
  assert.strictEqual(after.finishPunch.upper.rooms[1].name, "Office", "the rough room fanned out to finish"); assert.strictEqual(after.qcPunch.upper.rooms[0].name, "Office");
  assert.deepStrictEqual(Object.keys(after.punchTicks).sort(), [PU1.id, PU2.id, PQ1.id].sort());
  assert.deepStrictEqual(after.changeOrders, [{ id: "c1" }]); assert.strictEqual(after.roughStatus, "inprogress"); assert.strictEqual(after.foreman, "Keegan");
});
await ok("handle: the seven actions exist and nothing like a delete / move / add-floor does; BUILD is the ship-6 SW version; api.js still has exactly three .delete( (none new) and no tx.delete; punch.js imports no Firebase", async () => {
  assert.deepStrictEqual(api.PUNCH_ACTIONS, ["punch.setDone", "punch.add", "punch.assign", "punch.waiting", "punch.void", "punch.restore", "punch.editText"]);
  assert.ok(api.PUNCH_ACTIONS.every(a => api.JOB_WRITE_ACTIONS.includes(a) && api.ACTIONS.includes(a)));
  assert.deepStrictEqual(api.JOB_ACTIONS, ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"], "the ship-2 list is untouched");
  assert.ok(api.BUILD >= 605, "BUILD is at least the ship-6 SW version");
  for (const a of ["punch.delete", "punch.remove", "punch.move", "punch.addFloor", "punch.removeFloor", "punch.deleteRoom", "punch.renameRoom", "punch.severity", "punch.setDoneAll"]) {
    await assert.rejects(run({ requestId: RID(900), action: a, args: {} }, fakeIo({ docs: DOCS() })), (e) => e.status === 400 && /action must be/.test(e.message), a);
  }
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.ok(!/tx\.delete\(/.test(src)); assert.strictEqual((src.match(/\.delete\(/g) || []).length, 3, "no new delete in api.js");
  const pu = fs.readFileSync(path.join(root, "functions", "duetWrites", "punch.js"), "utf8");
  assert.ok(!/firebase|require\("firebase-admin"\)|\.delete\(|FieldValue/.test(pu), "punch.js is pure");
  assert.ok(/require\("\.\.\/punchTicks\.js"\)/.test(pu) && /require\("\.\.\/escapeHtml\.js"\)/.test(pu), "the slot and the escape come from the app's own shared modules");
});
console.log(`duet-punch-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
