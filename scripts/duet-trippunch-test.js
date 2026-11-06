#!/usr/bin/env node
/* duet-trippunch-test.js — Duet write access (connector D9): punch items on a
 * return trip's OWN list (data.returnTrips[i].punch[]). Spec:
 * app-building/return-trip-punch-spec.md (Koy 2026-11-06: "Build it, undo on").
 *
 * Drives functions/duetWrites/tripPunch.js, its wiring in api.js, the undo
 * (undo.js) and the photo locate (photos.js) against a fake Firestore holding
 * a real-shaped job (a 945 Maddox-like trip with its items in the Task field,
 * a trip with linked entries, a signed-off trip, a complete trip). Proves:
 * commitAdd's entry key for key, escaped text, Mountain YMD, appended in
 * order, fresh unique ids; one transaction, one audit with the trip before /
 * after + addedIds; only data.returnTrips + the envelope written, every other
 * trip and field untouched, no punchTicks slot; the refusals (signed off,
 * complete without confirmComplete, empty, >25, a duplicate of an open item
 * or within the batch, extra fields, bad source, archived job); replay;
 * done / waiting / edit on one entry with the app's shapes, linked entries
 * refused for done; undo of an add takes exactly the added ids off while
 * untouched (other trip edits since kept), refuses naming the touched item;
 * undo of a one-entry write puts it back; cc_add_photo's punch target finds a
 * trip entry. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const TP = require(path.join(root, "functions", "duetWrites", "tripPunch.js"));
const PH = require(path.join(root, "functions", "duetWrites", "photos.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

(async () => {
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-07T04:30:00.000Z";          // Fri 9:30 PM Mountain (Nov 6) — the UTC-vs-Mountain date trap on purpose
const YMD = "2026-11-06", MDY = "11/6/2026", TZ = "America/Denver";
const USERS = [{ id: 1, name: "Koy", title: "office", access: "admin" }, { id: 2, name: "Treycen Rollene", title: "crew" }];
const JOBID = "1772863862700", ARCH = "1772863862701";
const clone = (x) => JSON.parse(JSON.stringify(x));

const RT_MADDOX = { id: "1793945867570", scope: "Warranty punch list per Owusu", task: "1. Take the landscape outlets off the pool house switch\n2. Hardwire power to the bottle filler", material: "", rtStatus: "scheduled", rtStatusDate: "2026-11-06", assignedTo: "Treycen Rollene", signedOff: false, photos: [{ id: "p1", url: "x" }],
  punch: [{ id: "1790000000001", text: "Old done item", done: true, checkedBy: "Treycen Rollene", checkedAt: "11/5/2026", addedBy: "Koy", addedAt: "2026-11-05" }] };
const RT_LINKED = { id: "1793945867571", scope: "Finish items", rtStatus: "needs", signedOff: false, photos: [],
  punch: [{ id: "1790000000002", text: "Trim plates", done: false, originItemId: "1761000000007", originPhase: "finish" }, { id: "1790000000003", text: "4-way fix", done: false, fromRoughInspectionId: "ri1" }, { id: "1790000000004", text: "Open <b>trip</b> item", done: false, addedBy: "Colby", addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:00:00.000Z" }] };
const RT_SIGNED = { id: "1793945867572", scope: "Old trip", rtStatus: "complete", signedOff: true, signedOffBy: "Colby", photos: [], punch: [{ id: "1790000000005", text: "closed", done: false }] };
const RT_DONE = { id: "1793945867573", scope: "Finished trip", rtStatus: "complete", signedOff: false, photos: [], punch: [] };
const JOB = (extra) => ({ data: { name: "945 Maddox Residence", foreman: "Keegan", archived: false, returnTrips: [RT_MADDOX, RT_LINKED, RT_SIGNED, RT_DONE],
  roughPunch: { upper: { general: [{ id: "1793945867600", text: "tree item", done: false }], rooms: [], hotcheck: [], photos: [] }, main: { general: [], rooms: [], hotcheck: [], photos: [] }, basement: { general: [], rooms: [], hotcheck: [], photos: [] } },
  changeOrders: [{ id: "co1" }], punchTicks: {}, ...(extra || {}) }, updated_at: "2026-11-06T20:00:00.000Z", saved_by: "Koy", app_build: 612, w: "612.abc" });
const DOCS = () => ({ ["jobs/" + JOBID]: JOB(), ["jobs/" + ARCH]: JOB({ archived: true }) });

function assertNoUndefined(v, p) {
  if (v === undefined) throw new Error('undefined written at "' + p + '"');
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, p + "[" + i + "]"));
  else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) Object.keys(v).forEach(k => assertNoUndefined(v[k], p ? p + "." + k : k));
}
function fakeIo({ docs = DOCS() } = {}) {
  const log = [];
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r) => { throw new Error("create must never be called: " + r.path); },
    update: (r, d) => { assertNoUndefined(d, ""); log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc"); const cur = clone(store[r.path]); Object.keys(d).forEach(k => setPath(cur, k, d[k] && d[k].__serverTimestamp ? "<ts>" : d[k])); store[r.path] = cur; },
    set: (r, d) => { assertNoUndefined(d, ""); log.push(["set", r.path, d]); store[r.path] = clone(d); },
    delete: () => { throw new Error("delete must never be called"); },
  };
  return {
    log, store, nowIso: () => NOW, todayYmd: () => YMD, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => 0,
    getJob: async () => null, getUsers: async () => USERS, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), auditRef: (id) => ref("duet_writes", id), projectRef: (id) => ref("projects", id),
    settingsRef: (id) => { throw new api.Refusal(400, "settings/" + id + " must never be opened by a trip punch write"); },
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }), deleteField: () => ({ __delete: true }),
  };
}
let seq = 0;
const rid = () => "trippunch-test-" + String(++seq).padStart(4, "0");
const run = (io, action, args, id) => api.handle({ requestId: id || rid(), action, email: "koy@homesteadelectric.net", args: { jobId: JOBID, ...args } }, io);
const jobUpdates = (io) => io.log.filter(l => l[0] === "update" && l[1] === "jobs/" + JOBID).map(l => l[2]);
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const ctx = (extra) => ({ nowIso: NOW, tz: TZ, users: USERS, job: { id: JOBID, data: JOB(extra).data } });
const SEVEN = [
  "Take the landscape outlets off the pool house switch (he doesn't want them switched)",
  "Hardwire power to the bottle filler and chiller",
  "Install the missing attic driver for the primary bath frosted windows",
  "Install the Christmas tree closet light",
  "Install the flag pole lights",
  "Power to the master bath vanity drawer",
  "Swap the bunk room lights",
].map(text => ({ text }));

await ok("add: seven items on 945 Maddox trip #1 — commitAdd's entry key for key, Mountain YMD, escaped text, appended in order with fresh unique ids; ONE update of data.returnTrips + the envelope; the audit has the trip before / after + addedIds; every other trip, the trees and punchTicks untouched", async () => {
  const io = fakeIo();
  const items = [...SEVEN.slice(0, 6), { text: "Swap the bunk room lights <b>& check</b>\nline two", materialNeeded: " 2x wafer ", materialSource: "CED" }];
  const r = await run(io, "rtPunch.add", { rtId: RT_MADDOX.id, items });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const ups = jobUpdates(io);
  assert.strictEqual(ups.length, 1, "one job write");
  assert.deepStrictEqual(Object.keys(ups[0]).sort(), ["data.returnTrips", ...ENVELOPE].sort());
  const trips = ups[0]["data.returnTrips"];
  assert.strictEqual(trips.length, 4);
  assert.deepStrictEqual(trips[1], RT_LINKED); assert.deepStrictEqual(trips[2], RT_SIGNED); assert.deepStrictEqual(trips[3], RT_DONE);
  const t = trips[0];
  const { punch, ...rest } = t; const { punch: _p, ...restBefore } = RT_MADDOX;
  assert.deepStrictEqual(rest, restBefore, "scope, task, material, date, assignee, photos unchanged");
  assert.strictEqual(punch.length, 8); assert.deepStrictEqual(punch[0], RT_MADDOX.punch[0]);
  const added = punch.slice(1);
  added.slice(0, 6).forEach((e, i) => {
    assert.deepStrictEqual(Object.keys(e).sort(), ["addedAt", "addedAtTs", "addedBy", "done", "id", "text"]);
    assert.strictEqual(e.done, false); assert.strictEqual(e.addedBy, "Koy"); assert.strictEqual(e.addedAt, YMD); assert.strictEqual(e.addedAtTs, NOW);
    assert.strictEqual(e.text, SEVEN[i].text.replace(/'/g, "&#39;"));
    assert.ok(!("originItemId" in e) && !("assignedTo" in e));
  });
  assert.strictEqual(added[6].text, "Swap the bunk room lights &lt;b&gt;&amp; check&lt;/b&gt;<br>line two");
  assert.strictEqual(added[6].materialNeeded, "2x wafer"); assert.strictEqual(added[6].materialSource, "CED");
  const ids = added.map(e => e.id);
  assert.strictEqual(new Set(ids).size, 7); ids.forEach(id => assert.ok(/^\d{13}$/.test(id)));
  const taken = TP.takenIds(JOB().data); ids.forEach(id => assert.ok(!taken.includes(id), "a fresh id"));
  for (let i = 1; i < ids.length; i++) assert.ok(Number(ids[i]) > Number(ids[i - 1]), "ascending in the order given");
  const audit = io.store["duet_writes/" + r.body.requestId];
  assert.strictEqual(audit.action, "rtPunch.add"); assert.strictEqual(audit.itemId, RT_MADDOX.id); assert.deepStrictEqual(audit.fields, ["returnTrips"]);
  assert.deepStrictEqual(audit.addedIds, ids); assert.deepStrictEqual(audit.before.returnTrips, RT_MADDOX); assert.deepStrictEqual(audit.after.returnTrips, t);
  assert.strictEqual(r.body.added, 7); assert.strictEqual(r.body.rtNumber, 1); assert.strictEqual(r.body.items[0].number, 2); assert.strictEqual(r.body.openOnTrip, 7);
  assert.deepStrictEqual(r.body.pushTo, []);
  const after = io.store["jobs/" + JOBID].data;
  assert.deepStrictEqual(after.roughPunch, JOB().data.roughPunch); assert.deepStrictEqual(after.punchTicks, {}); assert.deepStrictEqual(after.changeOrders, [{ id: "co1" }]);
  const writes = io.log.filter(l => ["update", "set"].includes(l[0])).map(l => l[1]);
  assert.deepStrictEqual(writes.sort(), ["duet_writes/" + r.body.requestId, "jobs/" + JOBID].sort(), "only the job + its audit");
});

await ok("add: refusals — signed off, complete without confirmComplete (with it: ok), archived job, unknown trip, empty list, 26 items, empty text, an open duplicate (case / spacing ignored), a repeat inside the batch, extra fields, bad source; a done item's text may be added again; every refusal writes nothing to the job", async () => {
  const c = ctx();
  const R = (args, x) => TP.planAdd(args, x || c).refused || "";
  assert.match(R({ rtId: RT_SIGNED.id, items: SEVEN }), /signed off/);
  assert.match(R({ rtId: RT_DONE.id, items: SEVEN }), /marked complete.*confirmComplete/);
  assert.ok(TP.planAdd({ rtId: RT_DONE.id, items: SEVEN, confirmComplete: true }, c).fields, "confirmed: allowed");
  assert.match(TP.planAdd({ rtId: RT_MADDOX.id, items: SEVEN }, ctx({ archived: true })).refused, /archived/);
  assert.match(R({ rtId: "nope", items: SEVEN }), /No return trip/);
  assert.match(R({ rtId: RT_MADDOX.id, items: [] }), /1 to 25/);
  assert.match(R({ rtId: RT_MADDOX.id, items: Array.from({ length: 26 }, (_, i) => ({ text: "x" + i })) }), /26 items.*25/);
  assert.match(R({ rtId: RT_MADDOX.id, items: [{ text: "ok" }, { text: "   " }] }), /Item 2 has no text/);
  assert.match(R({ rtId: RT_LINKED.id, items: [{ text: "  OPEN trip   ITEM " }] }), /already an open item on return trip #2/);
  assert.match(R({ rtId: RT_MADDOX.id, items: [{ text: "A" }, { text: "a" }] }), /Item 2 repeats item 1/);
  assert.match(R({ rtId: RT_MADDOX.id, items: [{ text: "A", assignedTo: "Treycen Rollene" }] }), /only text, materialNeeded and materialSource/);
  assert.match(R({ rtId: RT_MADDOX.id, items: [{ text: "A", materialNeeded: "x", materialSource: "Lowes" }] }), /materialSource must be one of/);
  assert.ok(TP.planAdd({ rtId: RT_MADDOX.id, items: [{ text: "Old done item" }] }, c).fields, "matching a DONE item is not a duplicate");
  const io = fakeIo();
  const id = rid();
  const r = await run(io, "rtPunch.add", { rtId: RT_SIGNED.id, items: SEVEN }, id);
  assert.strictEqual(r.status, 400); assert.strictEqual(jobUpdates(io).length, 0);
  assert.strictEqual(io.store["duet_writes/" + id].ok, false, "the refusal is audited");
});

await ok("add: the same requestId replays the first answer and writes nothing twice", async () => {
  const io = fakeIo();
  const id = rid();
  const a = await run(io, "rtPunch.add", { rtId: RT_MADDOX.id, items: SEVEN }, id);
  const b = await run(io, "rtPunch.add", { rtId: RT_MADDOX.id, items: SEVEN }, id);
  assert.strictEqual(b.body.replayed, true); assert.deepStrictEqual(b.body.items, a.body.items);
  assert.strictEqual(jobUpdates(io).length, 1); assert.strictEqual(io.store["jobs/" + JOBID].data.returnTrips[0].punch.length, 8);
});

await ok("done / waiting / edit on ONE trip entry: the checkbox's exact fields (done → waiting false; undone clears the three stamps), no punchTicks slot, only that entry changes; linked entries (originItemId, fromRoughInspectionId) refuse done; waiting and edit refuse a done entry; noops", async () => {
  const io = fakeIo();
  const item = RT_LINKED.punch[2];
  const w = await run(io, "rtPunch.waiting", { rtId: RT_LINKED.id, itemId: item.id, waiting: true, waitingOn: " GC to pick the fixture " });
  assert.strictEqual(w.status, 200, JSON.stringify(w.body));
  let cur = io.store["jobs/" + JOBID].data.returnTrips[1].punch[2];
  assert.deepStrictEqual(cur, { ...item, waiting: true, waitingOn: "GC to pick the fixture" });
  const d = await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: item.id, done: true });
  assert.strictEqual(d.status, 200);
  cur = io.store["jobs/" + JOBID].data.returnTrips[1].punch[2];
  assert.deepStrictEqual(cur, { ...item, waiting: false, waitingOn: "GC to pick the fixture", done: true, checkedBy: "Koy", checkedAt: MDY, checkedAtTs: NOW });
  const ups = jobUpdates(io);
  ups.forEach(u => assert.deepStrictEqual(Object.keys(u).sort(), ["data.returnTrips", ...ENVELOPE].sort(), "no slot, no tree"));
  const trips = io.store["jobs/" + JOBID].data.returnTrips;
  assert.deepStrictEqual(trips[1].punch.slice(0, 2), RT_LINKED.punch.slice(0, 2)); assert.deepStrictEqual(trips[0], RT_MADDOX);
  const audit = io.store["duet_writes/" + d.body.requestId];
  assert.strictEqual(audit.itemId, item.id); assert.strictEqual(audit.after.returnTrips.rtId, RT_LINKED.id); assert.strictEqual(audit.before.returnTrips.entry.done, false);
  assert.match((await run(io, "rtPunch.editText", { rtId: RT_LINKED.id, itemId: item.id, text: "new" })).body.refused, /already done/);
  assert.match((await run(io, "rtPunch.waiting", { rtId: RT_LINKED.id, itemId: item.id, waiting: false })).body.refused, /already done/);
  const u = await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: item.id, done: false });
  cur = io.store["jobs/" + JOBID].data.returnTrips[1].punch[2];
  assert.strictEqual(u.status, 200); assert.strictEqual(cur.done, false); assert.strictEqual(cur.checkedBy, ""); assert.strictEqual(cur.checkedAt, ""); assert.strictEqual(cur.checkedAtTs, ""); assert.strictEqual(cur.waiting, false);
  assert.strictEqual((await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: item.id, done: false })).body.noop, true);
  assert.match((await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: RT_LINKED.punch[0].id, done: true })).body.refused, /linked to a finish punch item/);
  assert.match((await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: RT_LINKED.punch[1].id, done: true })).body.refused, /4-way inspection item/);
  const e = await run(io, "rtPunch.editText", { rtId: RT_LINKED.id, itemId: RT_LINKED.punch[0].id, text: "Trim plates & covers", materialNeeded: "plates" });
  assert.strictEqual(e.status, 200); assert.match(e.body.note, /trip copy only/);
  assert.strictEqual(io.store["jobs/" + JOBID].data.returnTrips[1].punch[0].text, "Trim plates &amp; covers");
  assert.strictEqual(io.store["jobs/" + JOBID].data.returnTrips[1].punch[0].originItemId, RT_LINKED.punch[0].originItemId);
  assert.match((await run(io, "rtPunch.setDone", { rtId: RT_SIGNED.id, itemId: RT_SIGNED.punch[0].id, done: true })).body.refused, /signed off/);
  assert.match((await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: "999", done: true })).body.refused, /No punch item with id 999 on return trip #2/);
});

await ok("undo of an add: untouched → exactly the added ids come off that trip (an edit to the trip's date since is kept, the older item stays), the original is stamped, a second undo refuses", async () => {
  const io = fakeIo();
  const a = await run(io, "rtPunch.add", { rtId: RT_MADDOX.id, items: SEVEN });
  const job = io.store["jobs/" + JOBID]; job.data.returnTrips[0].rtStatusDate = "2026-11-09";   // someone moved the date since
  const u = await run(io, "undo.apply", { requestId: a.body.requestId });
  assert.strictEqual(u.status, 200, JSON.stringify(u.body));
  const t = io.store["jobs/" + JOBID].data.returnTrips[0];
  assert.deepStrictEqual(t.punch, RT_MADDOX.punch); assert.strictEqual(t.rtStatusDate, "2026-11-09");
  assert.strictEqual(u.body.removed, 7); assert.strictEqual(u.body.undoneAction, "rtPunch.add");
  assert.strictEqual(io.store["duet_writes/" + a.body.requestId].undoneBy, u.body.requestId);
  const again = await run(io, "undo.apply", { requestId: a.body.requestId });
  assert.strictEqual(again.status, 400); assert.match(again.body.refused, /already undone/);
  const last = jobUpdates(io).pop();
  assert.deepStrictEqual(Object.keys(last).sort(), ["data.returnTrips", ...ENVELOPE].sort());
});

await ok("undo of an add: one item ticked done or given a photo since → refused, naming which; nothing comes off", async () => {
  const io = fakeIo();
  const a = await run(io, "rtPunch.add", { rtId: RT_MADDOX.id, items: SEVEN });
  const punch = io.store["jobs/" + JOBID].data.returnTrips[0].punch;
  punch[3] = { ...punch[3], done: true, checkedBy: "Treycen Rollene" };
  punch[5] = { ...punch[5], photos: [{ id: "ph" }] };
  const u = await run(io, "undo.apply", { requestId: a.body.requestId });
  assert.strictEqual(u.status, 400);
  assert.match(u.body.refused, /item 3 \("Install the missing attic driver.*ticked done by Treycen Rollene/);
  assert.match(u.body.refused, /item 5 \("Install the flag pole lights"\): photo added/);
  assert.strictEqual(io.store["jobs/" + JOBID].data.returnTrips[0].punch.length, 8);
  assert.ok(!io.store["duet_writes/" + a.body.requestId].undoneBy, "the original stays undoable");
});

await ok("undo of a one-entry write puts that entry back while it still reads what the call left; refuses with the diff once edited", async () => {
  const io = fakeIo();
  const item = RT_LINKED.punch[2];
  const d = await run(io, "rtPunch.setDone", { rtId: RT_LINKED.id, itemId: item.id, done: true });
  const u = await run(io, "undo.apply", { requestId: d.body.requestId });
  assert.strictEqual(u.status, 200, JSON.stringify(u.body));
  assert.deepStrictEqual(io.store["jobs/" + JOBID].data.returnTrips[1].punch[2], item);
  const e = await run(io, "rtPunch.editText", { rtId: RT_LINKED.id, itemId: item.id, text: "Changed" });
  io.store["jobs/" + JOBID].data.returnTrips[1].punch[2].text = "Someone else";
  const u2 = await run(io, "undo.apply", { requestId: e.body.requestId });
  assert.strictEqual(u2.status, 400); assert.match(u2.body.refused, /Changed since/); assert.ok(Array.isArray(u2.body.diff));
});

await ok("photo: cc_add_photo's punch target finds an entry on a trip's own list (punch-photos/ folder, the trip's number in the label), refuses a signed-off trip, and planAttach puts the photo on that entry only", () => {
  const doc = { id: JOBID, data: JOB().data };
  const loc = PH.locate("punch", RT_LINKED.punch[2].id, doc);
  assert.ok(!loc.refused, loc.refused); assert.strictEqual(loc.field, "returnTrips"); assert.strictEqual(loc.folder, `jobs/${JOBID}/punch-photos/${RT_LINKED.punch[2].id}`); assert.match(loc.label, /return trip #2/);
  assert.match(PH.locate("punch", RT_SIGNED.punch[0].id, doc).refused, /signed off/);
  assert.match(PH.locate("punch", "4242", doc).refused, /return trip's punch list/);
  assert.ok(!PH.locate("punch", "1793945867600", doc).refused, "a tree item still found first");
  const entry = { id: "9", name: "a.jpg", url: "u", storagePath: "s", type: "image/jpeg" };
  const p = PH.planAttach("punch", RT_LINKED.punch[2].id, entry, doc);
  const trips = p.fields.returnTrips;
  assert.deepStrictEqual(trips[1].punch[2], { ...RT_LINKED.punch[2], photos: [entry] });
  assert.deepStrictEqual(trips[1].punch.slice(0, 2), RT_LINKED.punch.slice(0, 2)); assert.deepStrictEqual(trips[0], RT_MADDOX); assert.deepStrictEqual(trips[1].photos, []);
});

await ok("handle: the four rtPunch actions are job writes; no remove / move / sign-off action exists; tripPunch.js imports no Firebase; api.js still has exactly three .delete( and no tx.delete", () => {
  ["rtPunch.add", "rtPunch.setDone", "rtPunch.waiting", "rtPunch.editText"].forEach(a => assert.ok(api.ACTIONS.includes(a), a));
  assert.ok(!api.ACTIONS.some(a => /^rtPunch\.(remove|delete|move|signOff|assign|void)/.test(a)));
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "tripPunch.js"), "utf8");
  assert.ok(!/firebase|firestore/i.test(src.replace(/\/\/.*$/gm, "")), "no Firebase in tripPunch.js");
  const apiSrc = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.strictEqual((apiSrc.match(/\.delete\(/g) || []).length, 3); assert.ok(!/tx\.delete\(/.test(apiSrc));
});

console.log(`duet-trippunch-test: ${n} checks passed`);
})().catch((e) => { console.error("duet-trippunch-test FAILED:", e && e.stack || e); process.exit(1); });
