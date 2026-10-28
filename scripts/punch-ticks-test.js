#!/usr/bin/env node
/* punch-ticks-test.js — gate for punch check-off slots (v559, 2026-10-22).
 *
 * Why: a punch check-off used to be saved only by re-sending the WHOLE punch
 * tree from one phone, and a client-side three-way merge decided whose copy
 * won. Miller #1788319922110, 2026-10-22 15:32:34Z: Keegan's phone un-ticked
 * Austin's "Cut in floor outlets" 46 s after a merged save (baseline moved to
 * the merged copy, screen did not). Now every flip also writes its own slot
 * `data.punchTicks.<itemId>` and the slots are overlaid on every read.
 *
 * Sections: module unit tests (Task 1), then the sections later tasks add —
 * the Miller 15:32 replay through the REAL merge code, writer tripwires, and
 * the functions readers. Design: docs/superpowers/specs/2026-10-22-punch-tick-slots-design.md
 */
"use strict";
const assert = require("assert");
const PT = require("../src/punchTicks.js");

let n = 0;
const check = (label, fn) => { try { fn(); n++; console.log("  ok  " + label); } catch (e) { console.error("  FAIL " + label + "\n       " + (e && e.message)); process.exit(1); } };

const T1 = "2026-10-22T15:31:48.355Z", T2 = "2026-10-22T15:32:10.000Z", T3 = "2026-10-22T15:33:00.000Z";
const item = (id, done, o = {}) => ({ id, text: "item " + id, done, checkedBy: done ? "Austin" : "", checkedAt: done ? "10/22/2026" : "", checkedAtTs: done ? T1 : "", ...o });
const floor = (items) => ({ general: items, rooms: [], hotcheck: [] });
const tree = (items) => ({ main: floor(items) });
const flat = (t) => { const out = []; if (!t) return out; ["upper", "main", "basement", ...(t.extras || []).map(e => e.key)].forEach(k => { const f = t[k]; if (!f) return; out.push(...(f.general || []), ...(f.hotcheck || []), ...(f.rooms || []).flatMap(r => r.items || [])); }); return out; };
const byId = (t, id) => flat(t).find(i => i.id === id);
const WHO = "Keegan Wilkinson";

// ── punchTickPatches ─────────────────────────────────────────────────────────
check("punchTickPatches: only the item whose done changed", () => {
  const prev = tree([item("1", false), item("2", false)]);
  const next = tree([item("1", true, { checkedBy: WHO, checkedAt: "10/22/2026", checkedAtTs: T1 }), item("2", false)]);
  assert.deepStrictEqual(PT.punchTickPatches(prev, next, WHO, T2), { "punchTicks.1": { done: true, by: WHO, at: "10/22/2026", ts: T1 } });
});
check("punchTickPatches: un-tick slot is done:false with who/when", () => {
  const p = PT.punchTickPatches(tree([item("1", true)]), tree([item("1", false)]), WHO, T2);
  const s = p["punchTicks.1"];
  assert.strictEqual(s.done, false); assert.strictEqual(s.by, WHO); assert.strictEqual(s.ts, T2);
  assert.match(s.at, /^\d{1,2}\/\d{1,2}\/\d{4}$/);
  assert.deepStrictEqual(Object.keys(p), ["punchTicks.1"]);
});
check("punchTickPatches: done item with no checkedAtTs gets nowIso (Review Focus 1)", () => {
  const p = PT.punchTickPatches(tree([item("1", false)]), tree([item("1", true, { checkedAtTs: "", checkedBy: "", checkedAt: "" })]), WHO, T2);
  assert.strictEqual(p["punchTicks.1"].ts, T2); assert.strictEqual(p["punchTicks.1"].by, WHO);
  assert.match(p["punchTicks.1"].at, /^\d{1,2}\/\d{1,2}\/\d{4}$/);
});
check("punchTickPatches: adds, text edits, voids, removals and moves make no slot", () => {
  const prev = { main: { general: [item("1", false), item("2", false), item("4", true)], rooms: [{ id: "r1", name: "Kitchen", items: [item("5", true)] }], hotcheck: [] } };
  const next = { main: { general: [item("1", false, { text: "edited" }), item("2", false, { voided: true }), item("3", true)], rooms: [{ id: "r2", name: "Bath", items: [item("5", true)] }], hotcheck: [] } };
  assert.deepStrictEqual(PT.punchTickPatches(prev, next, WHO, T2), {});
});
check("punchTickPatches: walks rooms, hotcheck and extras floors", () => {
  const mk = (d) => ({ main: { general: [], rooms: [{ id: "r", name: "R", items: [item("a", d)] }], hotcheck: [item("b", d)] }, extras: [{ key: "garage", label: "Garage" }], garage: { general: [item("c", d)], rooms: [], hotcheck: [] } });
  assert.deepStrictEqual(Object.keys(PT.punchTickPatches(mk(false), mk(true), WHO, T2)).sort(), ["punchTicks.a", "punchTicks.b", "punchTicks.c"]);
});
check("punchTickPatches: missing trees are harmless", () => {
  assert.deepStrictEqual(PT.punchTickPatches(undefined, undefined, WHO, T2), {});
  assert.deepStrictEqual(PT.punchTickPatches(null, tree([item("1", true)]), WHO, T2), {});
  assert.deepStrictEqual(PT.punchTickPatches(tree([item("1", true)]), null, WHO, T2), {});
});
check("slot stays small (Review Focus 5)", () => {
  const p = PT.punchTickPatches(tree([item("1", false)]), tree([item("1", true, { checkedBy: "Christopher Montgomery Jr", checkedAtTs: T1 })]), WHO, T2);
  assert(JSON.stringify(p["punchTicks.1"]).length < 160);
});

// ── applyPunchTicks ──────────────────────────────────────────────────────────
const slot = (done, ts = T2, by = WHO) => ({ done, by, at: "10/22/2026", ts });
check("applyPunchTicks: no / empty / malformed punchTicks → same object, no throw (Review Focus 3)", () => {
  const base = { roughPunch: tree([item("1", false)]) };
  assert.strictEqual(PT.applyPunchTicks(base), base);
  const e = { ...base, punchTicks: {} }; assert.strictEqual(PT.applyPunchTicks(e), e);
  const a = { ...base, punchTicks: null }; assert.strictEqual(PT.applyPunchTicks(a), a);
  const b = { ...base, punchTicks: "x" }; assert.strictEqual(PT.applyPunchTicks(b), b);
  const c = { ...base, punchTicks: { "1": null, "2": { done: "yes" } } }; assert.strictEqual(PT.applyPunchTicks(c), c);
  const d = { roughPunch: tree([item("1", false)]), punchTicks: { "99": slot(true) } }; assert.strictEqual(PT.applyPunchTicks(d), d);   // qcPunch undefined, slot matches nothing
  assert.strictEqual(PT.applyPunchTicks(null), null);
});
check("applyPunchTicks: done slot sets done and stamps in all three trees, rooms/general/hotcheck/extras", () => {
  const job = {
    roughPunch: { main: floor([item("1", false)]), extras: [{ key: "garage", label: "Garage" }], garage: floor([item("4", false)]) },
    finishPunch: { main: { general: [], rooms: [{ id: "r", name: "R", items: [item("2", false)] }], hotcheck: [] } },
    qcPunch: { basement: { general: [], rooms: [], hotcheck: [item("3", false)] } },
    punchTicks: { "1": slot(true), "2": slot(true), "3": slot(true), "4": slot(true) },
  };
  const out = PT.applyPunchTicks(job);
  [["roughPunch", "1"], ["finishPunch", "2"], ["qcPunch", "3"], ["roughPunch", "4"]].forEach(([k, id]) => {
    const it = byId(out[k], id);
    assert.strictEqual(it.done, true, k + " " + id);
    assert.strictEqual(it.checkedBy, WHO); assert.strictEqual(it.checkedAt, "10/22/2026"); assert.strictEqual(it.checkedAtTs, T2);
  });
});
check("applyPunchTicks: done:false slot clears done and all three stamps", () => {
  const out = PT.applyPunchTicks({ roughPunch: tree([item("1", true)]), punchTicks: { "1": slot(false, T2) } });
  const it = byId(out.roughPunch, "1");
  assert.strictEqual(it.done, false); assert.strictEqual(it.checkedBy, ""); assert.strictEqual(it.checkedAt, ""); assert.strictEqual(it.checkedAtTs, "");
});
check("applyPunchTicks: newer tree tick beats older slot", () => {
  const newer = PT.applyPunchTicks({ roughPunch: tree([item("1", true, { checkedAtTs: T3 })]), punchTicks: { "1": slot(false, T2) } });
  assert.strictEqual(byId(newer.roughPunch, "1").done, true); assert.strictEqual(byId(newer.roughPunch, "1").checkedAtTs, T3);
  const older = PT.applyPunchTicks({ roughPunch: tree([item("1", true, { checkedAtTs: T1 })]), punchTicks: { "1": slot(false, T2) } });
  assert.strictEqual(byId(older.roughPunch, "1").done, false);
});
check("applyPunchTicks: linked return-trip entries follow the origin slot", () => {
  const p2 = { id: "p2", done: false };
  const job = { roughPunch: tree([item("1", false)]), returnTrips: [{ id: "rt", punch: [{ id: "p1", originItemId: "1", originPhase: "rough", done: false }, p2] }], punchTicks: { "1": slot(true) } };
  const out = PT.applyPunchTicks(job);
  const p1 = out.returnTrips[0].punch[0];
  assert.strictEqual(p1.done, true); assert.strictEqual(p1.checkedBy, WHO); assert.strictEqual(p1.checkedAtTs, T2);
  assert.strictEqual(out.returnTrips[0].punch[1], p2);
});
check("applyPunchTicks: idempotent and non-mutating", () => {
  const job = { roughPunch: tree([item("1", false), item("2", true)]), punchTicks: { "1": slot(true) } };
  const before = JSON.stringify(job);
  const once = PT.applyPunchTicks(job);
  assert.strictEqual(JSON.stringify(job), before);
  const twice = PT.applyPunchTicks(once);
  assert.strictEqual(twice, once); assert.deepStrictEqual(twice, once);
});
check("applyPunchTicks: untouched floors and items keep identity", () => {
  const sib = item("2", true);
  const job = { roughPunch: tree([item("1", false), sib]), finishPunch: tree([item("3", false)]), punchTicks: { "1": slot(true) } };
  const out = PT.applyPunchTicks(job);
  assert.strictEqual(out.finishPunch, job.finishPunch);
  assert.strictEqual(out.roughPunch.main.general[1], sib);
  assert.notStrictEqual(out, job);
});

// ── foldTickPatches / keys / slotWins / mergeTickMaps ────────────────────────
check("foldTickPatches: folds slots, strips literal keys", () => {
  const S9 = slot(true, T1), S1 = slot(false, T2);
  const job = { a: 1, punchTicks: { "9": S9 }, "punchTicks.1": { junk: true } };
  const out = PT.foldTickPatches(job, { roughPunch: {}, "punchTicks.1": S1 });
  assert.deepStrictEqual(out.punchTicks, { "9": S9, "1": S1 });
  assert(!Object.keys(out).some(k => k.startsWith("punchTicks.")));
  assert.strictEqual(out.a, 1);
  assert.deepStrictEqual(job, { a: 1, punchTicks: { "9": S9 }, "punchTicks.1": { junk: true } });
});
check("foldTickPatches: nothing to fold → same object", () => {
  const job = { a: 1, punchTicks: { "9": slot(true) } };
  assert.strictEqual(PT.foldTickPatches(job, { roughPunch: {} }), job);
  assert.strictEqual(PT.foldTickPatches(job, null), job);
});
check("isTickKey / tickIdOf", () => {
  assert.strictEqual(PT.isTickKey("punchTicks.123"), true);
  ["punchTicks", "punchTicks.", "roughPunch", "", null].forEach(k => assert.strictEqual(PT.isTickKey(k), false, String(k)));
  assert.strictEqual(PT.tickIdOf("punchTicks.123"), "123");
});
check("slotWins", () => {
  assert.strictEqual(PT.slotWins(undefined, slot(true, T1)), true);
  assert.strictEqual(PT.slotWins(slot(false, T2), slot(true, T1)), false);
  assert.strictEqual(PT.slotWins(slot(false, T1), slot(true, T2)), true);
  assert.strictEqual(PT.slotWins(slot(false, T1), slot(true, T1)), true);
  assert.strictEqual(PT.slotWins({}, slot(true, T1)), true);
  assert.strictEqual(PT.slotWins(slot(false, T2), slot(true, "nope")), true);
});
check("mergeTickMaps: per-id newer ts wins, one-sided ids kept, undefined tolerated", () => {
  const m = PT.mergeTickMaps({ "1": slot(false, T2), "2": slot(true, T1) }, { "1": slot(true, T1), "3": slot(true, T3) });
  assert.strictEqual(m["1"].done, false); assert.strictEqual(m["2"].done, true); assert.strictEqual(m["3"].ts, T3);
  assert.deepStrictEqual(PT.mergeTickMaps(undefined, { "1": slot(true) }), { "1": slot(true) });
  assert.deepStrictEqual(PT.mergeTickMaps({ "1": slot(true) }, undefined), { "1": slot(true) });
  assert.deepStrictEqual(PT.mergeTickMaps(undefined, undefined), {});
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 3 — the REAL App.js merge code, the Miller 15:32 replay, writer tripwires
// ═════════════════════════════════════════════════════════════════════════════
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const body = (start, end, from = 0) => {
  const a = src.indexOf(start, from); if (a < 0) throw new Error("marker not found: " + start);
  const b = src.indexOf(end, a + start.length); if (b < 0) throw new Error("marker not found: " + end);
  return src.slice(a, b);
};
const mergeSrc = body("// ── Three-way merge (Cougar Moon data-loss fix", "// ── Stale-copy guards (Miller panel-loads rollback");
const guardSrc = body("// ── Stale-copy guards (Miller panel-loads rollback", "// ── end Stale-copy guards");
const mpSrc = body("  const _mergePatchAgainstServer = (", "  // Advance the three-way-merge baseline to EXACTLY");
const ctx = {
  console, isTickKey: PT.isTickKey, tickIdOf: PT.tickIdOf, slotWins: PT.slotWins, mergeTickMaps: PT.mergeTickMaps,
  applyPunchTicks: PT.applyPunchTicks, punchTickPatches: PT.punchTickPatches, foldTickPatches: PT.foldTickPatches,
  serverBaselines: { current: {} }, _noBaselineWarned: new Set(), _scalarTelemetrySkip: new Set(), normalizeName: x => x,
  toast: { error() {} }, normalizeJob: raw => PT.applyPunchTicks({ roughPunch: {}, finishPunch: {}, qcPunch: {}, ...raw }),
};
vm.createContext(ctx);
vm.runInContext(mergeSrc + "\n" + guardSrc + "\n" + mpSrc + "\nthis.merge = _mergePatchAgainstServer; this._threeWayMerge = _threeWayMerge; this.jobContentEquals = jobContentEquals; this.baselineAdvanceKeys = baselineAdvanceKeys;", ctx);
const clone = (x) => JSON.parse(JSON.stringify(x));
const applyUpdate = (data, dotted, value) => {
  const parts = dotted.split("."); let o = data;
  for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = clone(value);
};
const server = { data: {} };
const commit = (clientPatch, baseline) => {
  ctx.serverBaselines.current.J = baseline;
  const rescued = [];
  const wp = ctx.merge("J", "Miller", clone(clientPatch), server.data, rescued);
  Object.keys(wp).forEach(k => { if (k.indexOf("data.") === 0) applyUpdate(server.data, k.slice(5), wp[k]); });
  return { wp, rescued };
};
const X = "1788319967690", Y = "1788319967691";

check("MILLER 15:32: stale whole-tree save cannot un-tick a slot-backed item", () => {
  server.data = { roughPunch: tree([item(X, false), item(Y, false)]) };
  const base0 = clone(server.data);
  const A = tree([item(X, true, { checkedBy: "Austin", checkedAtTs: T1 }), item(Y, false)]);
  const ra = commit({ roughPunch: A, ...PT.punchTickPatches(base0.roughPunch, A, "Austin", T1) }, base0);
  const screen = clone(base0);                                  // Keegan's phone never adopted Austin's tick
  const B = tree([item(X, false), item(Y, true, { checkedBy: WHO, checkedAtTs: T2 })]);
  const rb = commit({ roughPunch: B, ...PT.punchTickPatches(screen.roughPunch, B, WHO, T2) }, clone(server.data));   // baseline fresher than the screen
  assert.strictEqual(byId(server.data.roughPunch, X).done, false, "mechanism: the stored tree lost Austin's tick, as in production");
  const keys = Object.keys(rb.wp);
  assert(keys.includes("data.punchTicks." + Y), "Keegan's write carries his own slot");
  assert(!keys.some(k => k === "data.punchTicks." + X), "and no slot for the item he never touched");
  const view = PT.applyPunchTicks(server.data);
  assert.strictEqual(byId(view.roughPunch, X).done, true, "overlay: Austin's tick survives");
  assert.strictEqual(byId(view.roughPunch, X).checkedBy, "Austin");
  assert.strictEqual(byId(view.roughPunch, Y).done, true);
  assert.strictEqual(byId(PT.applyPunchTicks({ ...server.data, punchTicks: undefined }).roughPunch, X).done, false, "control: without slots the tick is gone");
  assert.strictEqual(ra.rescued.length + rb.rescued.length, 0, "no merge rescue involved");
});
check("LATEST TAP WINS: a late slot with an older ts is dropped (Review Focus 2)", () => {
  server.data = { roughPunch: tree([item(X, false)]), punchTicks: { [X]: { done: false, by: WHO, at: "10/22/2026", ts: T2 } } };
  const r = commit({ roughPunch: tree([item(X, true, { checkedAtTs: T1 })]), ["punchTicks." + X]: { done: true, by: "Austin", at: "10/22/2026", ts: T1 } }, clone(server.data));
  assert(!("data.punchTicks." + X in r.wp), "older slot not written");
  assert.strictEqual(r.rescued.length, 0);
  assert.strictEqual(byId(PT.applyPunchTicks(server.data).roughPunch, X).done, false);
  server.data = { roughPunch: tree([item(X, false)]), punchTicks: { [X]: { done: false, by: WHO, at: "10/22/2026", ts: T1 } } };
  const r2 = commit({ roughPunch: tree([item(X, true, { checkedAtTs: T3 })]), ["punchTicks." + X]: { done: true, by: "Austin", at: "10/22/2026", ts: T3 } }, clone(server.data));
  assert.deepStrictEqual(r2.wp["data.punchTicks." + X].ts, T3, "newer slot written");
  assert.strictEqual(byId(PT.applyPunchTicks(server.data).roughPunch, X).done, true);
});
check("UN-CHECK STICKS", () => {
  const job = { roughPunch: tree([item(X, true, { checkedAtTs: T1 })]), punchTicks: { [X]: { done: false, by: WHO, at: "10/22/2026", ts: T3 } } };
  const once = PT.applyPunchTicks(job), twice = PT.applyPunchTicks(once);
  assert.strictEqual(byId(twice.roughPunch, X).done, false); assert.strictEqual(byId(twice.roughPunch, X).checkedBy, "");
  const re = PT.applyPunchTicks({ ...job, punchTicks: { [X]: { done: true, by: "Austin", at: "10/22/2026", ts: "2026-10-22T15:34:00.000Z" } } });
  assert.strictEqual(byId(re.roughPunch, X).done, true);
});
check("BURST: tick, untick, re-tick keeps one pending key", () => {
  const t0 = tree([item(X, false)]), t1 = tree([item(X, true, { checkedAtTs: T1 })]), t2 = tree([item(X, false)]), t3 = tree([item(X, true, { checkedAtTs: T3 })]);
  const merged = Object.assign({}, PT.punchTickPatches(t0, t1, WHO, T1), PT.punchTickPatches(t1, t2, WHO, T2), PT.punchTickPatches(t2, t3, WHO, T3));
  assert.deepStrictEqual(Object.keys(merged), ["punchTicks." + X]); assert.strictEqual(merged["punchTicks." + X].ts, T3);
});
check("DOTTED KEY ROUND TRIP (Review Focus 4)", () => {
  server.data = { roughPunch: tree([item("7", false)]) };
  const r = commit({ "punchTicks.7": { done: true, by: WHO, at: "10/22/2026", ts: T1 } }, clone(server.data));
  assert.deepStrictEqual(Object.keys(r.wp), ["data.punchTicks.7"]);
  assert.strictEqual(server.data.punchTicks["7"].done, true);
  const ja = { id: "J", roughPunch: {}, punchTicks: { "7": { done: true, ts: T1 } } }, jb = { id: "J", roughPunch: {}, punchTicks: { "7": { done: true, ts: T1 } } };
  assert.strictEqual(ctx.jobContentEquals(ja, jb), true);
  assert.strictEqual(ctx.jobContentEquals(ja, { ...jb, punchTicks: { "7": { done: true, ts: T2 } } }), false);
  assert.strictEqual(typeof ctx.jobContentEquals(ja, { ...jb, "punchTicks.7": {} }), "boolean");
  const adv = ctx.baselineAdvanceKeys({ roughPunch: {} }, { ...jb, updated_at: "t9" }, ja, ctx.normalizeJob);
  assert(!Object.keys(adv).some(k => k.startsWith("punchTicks.")));
  assert.deepStrictEqual(adv.punchTicks, jb.punchTicks);
});
check("LEGACY FULL SAVE: a whole punchTicks map is merged per id, never replaced", () => {
  server.data = { roughPunch: {}, punchTicks: { "1": { done: false, by: WHO, at: "10/22/2026", ts: T2 }, "2": { done: true, by: "Austin", at: "10/22/2026", ts: T1 } } };
  const clientMap = { "1": { done: true, by: "Austin", at: "10/22/2026", ts: T1 }, "3": { done: true, by: WHO, at: "10/22/2026", ts: T3 } };
  const wp = ctx.merge("J", "Miller", { punchTicks: clone(clientMap) }, server.data, []);
  assert.deepStrictEqual(wp["data.punchTicks"], PT.mergeTickMaps(server.data.punchTicks, clientMap));
  assert.strictEqual(wp["data.punchTicks"]["1"].done, false); assert.strictEqual(wp["data.punchTicks"]["3"].ts, T3);
});

// ── writer tripwires ─────────────────────────────────────────────────────────
const jdAt = src.indexOf("function JobDetail(");
const uSrc = body("\n  const u = patch => {", "\n  // Simpro auto-pull: onBlur of Simpro #", jdAt);
const tpSrc = body("  const togglePunchItemDone = (jobId, phase, itemId) => {", "\n  // Punch items assigned to the currently-active foreman");
const soAt = src.indexOf("  const handleSignOffRT = (jobId, rtId) => {");
const soSrc = body("  const handleSignOffRT = (jobId, rtId) => {", "\n  const allTaskDueDates", soAt);
const ujSrc = body("  const updateJob = (updated, patch) => {", "  // ── Redline walks save / update / delete / add");
const sjHead = body("  const saveJob = (job, patch) => {", "    // Always write to localStorage immediately");
const abSrc = body("  const _advanceMergeBaseline = (", "  const saveJob = (job, patch) => {");
const convSrc = body("// CONVERGENCE (2026-09-30, Miller panel-loads rollback)", '} else if (mode === "nothing") {');
const migSrc = body("  const migrate = (loaded) => {", "  // Real-time listener — all devices stay in sync automatically");
check("TRIPWIRE: every punch writer and fold point is wired", () => {
  assert(uSrc.includes("punchTickPatches("), "JobDetail u() must call punchTickPatches");
  assert(uSrc.includes("foldTickPatches("), "JobDetail u() must fold slots into the local copy");
  assert(tpSrc.includes("punchTickPatches("), "togglePunchItemDone (My Day Done) must call punchTickPatches");
  assert(soSrc.includes("punchTickPatches("), "handleSignOffRT cascade must call punchTickPatches");
  assert(ujSrc.includes("foldTickPatches("), "updateJob must fold slots");
  assert(sjHead.includes("foldTickPatches("), "saveJob must fold slots before hejobs_backup");
  assert(abSrc.includes("isTickKey("), "_advanceMergeBaseline must skip slot keys");
  assert(convSrc.includes("foldTickPatches("), "CONVERGENCE re-seed must fold slot keys");
  assert(src.includes("const normalizeJob = (raw) => applyPunchTicks(_normalizeJobShape(raw));"), "normalizeJob must apply the overlay");
  assert(src.includes("const _normalizeJobShape = (raw) => ({"), "_normalizeJobShape must exist");
  assert(migSrc.includes("normalizeJob("), "the loader's migrate must still go through normalizeJob");
  assert(src.includes('import PunchTicks from "./punchTicks";'), "App.js must import ./punchTicks");
});
check("BEHAVIOR: togglePunchItemDone emits the slot with the tree", () => {
  const calls = [];
  let allJobs = [{ id: "J", roughPunch: tree([item("1", false)]), returnTrips: [{ id: "rt", punch: [{ id: "p1", originItemId: "1", originPhase: "rough", done: false }] }] }];
  const toggle = new Function("allJobs", "identity", "getIdentity", "updateJob", "punchTickPatches", "toast", tpSrc + "\nreturn togglePunchItemDone;");
  const run = () => toggle(allJobs, { name: WHO }, () => ({ name: WHO }), (updated, patch) => { calls.push({ updated, patch }); allJobs = [updated]; }, PT.punchTickPatches, { warn() {} })("J", "Rough", "1");
  run();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(Object.keys(calls[0].patch).sort(), ["punchTicks.1", "returnTrips", "roughPunch"]);
  assert.strictEqual(calls[0].patch["punchTicks.1"].done, true);
  run();
  assert.strictEqual(calls[1].patch["punchTicks.1"].done, false);
});
check("BEHAVIOR: handleSignOffRT emits slots for the cascade", () => {
  let got = null;
  const jobs = [{ id: "J", roughPunch: tree([item("1", false)]), finishPunch: {}, returnTrips: [{ id: "r1", punch: [{ id: "p1", originItemId: "1", originPhase: "rough", done: false }] }] }];
  const so = new Function("jobs", "onUpdateJob", "getIdentity", "punchTickPatches", soSrc + "\nreturn handleSignOffRT;");
  so(jobs, (id, patch) => { got = { id, patch }; }, () => ({ name: WHO }), PT.punchTickPatches)("J", "r1");
  assert(got && got.id === "J");
  assert.strictEqual(got.patch["punchTicks.1"].done, true);
  assert.strictEqual(byId(got.patch.roughPunch, "1").done, true);
});
check("BEHAVIOR: JobDetail u() emits slots and folds them into the local copy", () => {
  const jobRef = { current: { id: "J", roughPunch: tree([item("1", false)]), jobNotesMigratedAt: "x" } };
  let got = null;
  const mk = new Function("jobRef", "setJob", "onUpdate", "identity", "getIdentity", "plBumpRev", "plDiffIntent", "PL_INTENT_KEY", "punchTickPatches", "foldTickPatches", uSrc + "\nreturn u;");
  const u = mk(jobRef, () => {}, (updated, patch) => { got = { updated, patch }; }, { name: WHO }, () => ({ name: WHO }), x => x, () => null, "__plIntent", PT.punchTickPatches, PT.foldTickPatches);
  u({ roughPunch: tree([item("1", true, { checkedBy: WHO, checkedAtTs: T1 })]) });
  assert(got.patch["punchTicks.1"] && got.patch["punchTicks.1"].done === true);
  assert.strictEqual(got.updated.punchTicks["1"].done, true);
  assert(!Object.keys(got.updated).some(k => k.startsWith("punchTicks.")));
  got = null;
  u({ roughNotes: "x" });
  assert(!Object.keys(got.patch).some(k => k.startsWith("punchTicks.")));
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 5 — the Cloud Functions readers see the overlay; versions WATCH list
// ═════════════════════════════════════════════════════════════════════════════
process.env.TZ = process.env.TZ || "UTC";
const fnRoot = path.join(__dirname, "..", "functions");
const strategyPrep = require(path.join(fnRoot, "strategyPrep.js"));
const gcPortal = require(path.join(fnRoot, "gcPortal.js"));
const MON = "2026-10-19T09:00:00.000Z", IN_WIN = "2026-10-20T10:00:00.000Z", LATER = "2026-10-21T10:00:00.000Z";
const J = {
  id: "J", name: "Miller Residence - Alpine", type: "job",
  roughPunch: tree([item("1", false), item("2", false), item("3", false, { waiting: true, waitingOn: "GC" })]),
  finishPunch: tree([item("4", true, { checkedBy: "Austin", checkedAt: "10/19/2026", checkedAtTs: MON })]),
  returnTrips: [],
  punchTicks: { "1": { done: true, by: WHO, at: "10/20/2026", ts: IN_WIN }, "4": { done: false, by: WHO, at: "10/21/2026", ts: LATER }, "3": { done: true, by: "Austin", at: "10/20/2026", ts: IN_WIN } },
};
const J0 = { ...J, punchTicks: undefined };
check("FUNCTIONS strategyPrep: openPunchCount / waitingItems see the overlay", () => {
  assert.strictEqual(strategyPrep.openPunchCount(J), 2, "items 2 and 4 are open (1 and 3 done by slot; 4 un-done by slot)");
  assert.deepStrictEqual(strategyPrep.waitingItems(J), [], "item 3 is done by slot, so not waiting");
  assert.strictEqual(strategyPrep.openPunchCount(J0), 3, "without slots the tree rules (1, 2, 3 open; 4 done)");
  assert.strictEqual(strategyPrep.waitingItems(J0).length, 1);
});
check("FUNCTIONS strategyPrep: lastWeekRows counts slot-closed items in the window, not the un-done one", () => {
  const rows = strategyPrep.lastWeekRows({ jobs: [J], live: [J], users: [], prevState: null, blocked: { cleared: [] }, today: new Date("2026-10-22T12:00:00.000Z") });
  const counts = rows && (rows.counts || rows);
  assert.strictEqual(counts.punchClosed, 2, "items 1 and 3 (slot ts in window); item 4 is un-done by its slot — got " + JSON.stringify(counts.punchClosed));
});
check("FUNCTIONS gcPortal: projectJobForPortal counts with the overlay and never leaks punchTicks", () => {
  const view = gcPortal.projectJobForPortal("J", J);
  assert.strictEqual(view.rough.punchOpen, 1);
  assert.strictEqual(view.finish.punchOpen, 1, "item 4 un-done by slot");
  const d = view.punch.rough.done; assert.strictEqual(Array.isArray(d) ? d.length : d, 2);
  assert(!JSON.stringify(view).includes("punchTicks"), "allowlist wall holds");
});
check("FUNCTIONS source tripwires: fridayPacket, index.js flatPunch, versions WATCH", () => {
  const fp = fs.readFileSync(path.join(fnRoot, "fridayPacket.js"), "utf8");
  const fpAt = fp.indexOf("applyPunchTicks(j)"), fwAt = fp.indexOf("flatPunchWaiting(j");
  assert(fpAt > 0 && fwAt > 0 && fpAt < fwAt, "fridayPacket applies the overlay before flatPunchWaiting");
  const ix = fs.readFileSync(path.join(fnRoot, "index.js"), "utf8");
  assert(ix.includes('require("./punchTicks.js")'), "index.js requires ./punchTicks.js");
  const fpi = ix.indexOf("const flatPunch = (j) => {"); assert(fpi > 0);
  assert(ix.slice(fpi, fpi + 400).includes("applyPunchTicks("), "flatPunch applies the overlay");
  const w = ix.match(/const WATCH = \[([^\]]*)\]/); assert(w && w[1].includes('"punchTicks"'), "punchTicks in the versions WATCH list");
});

// ═════════════════════════════════════════════════════════════════════════════
// Final review fixes (adversarial pass, 2026-10-22)
// ═════════════════════════════════════════════════════════════════════════════
check("REVIEW #1: a re-check whose checkedAtTs did not change gets a FRESH slot ts", () => {
  // _flipInFloors / handleSignOffRT can leave a stale checkedAtTs on an open item; a
  // re-check must not reuse it or its slot loses to the newer un-tick slot.
  const prev = tree([item("1", false, { checkedAtTs: T1 })]);
  const next = tree([item("1", true, { checkedBy: WHO, checkedAt: "10/22/2026", checkedAtTs: T1 })]);
  assert.strictEqual(PT.punchTickPatches(prev, next, WHO, T3)["punchTicks.1"].ts, T3, "unchanged stamp → nowIso");
  const next2 = tree([item("1", true, { checkedBy: WHO, checkedAt: "10/22/2026", checkedAtTs: T2 })]);
  assert.strictEqual(PT.punchTickPatches(prev, next2, WHO, T3)["punchTicks.1"].ts, T2, "a stamp written by this flip is kept");
  assert(PT.slotWins({ done: false, by: WHO, at: "10/22/2026", ts: T2 }, PT.punchTickPatches(prev, next, WHO, T3)["punchTicks.1"]), "and it beats the un-tick slot");
});
check("REVIEW #1b: the RT cascade helper stamps checkedAtTs on both directions", () => {
  const ff = body("  const _flipInFloors = (", "  // Wrap the Return Trips onChange", jdAt);
  assert(ff.includes("checkedAtTs"), "_flipInFloors must write checkedAtTs (done → stamp, un-done → \"\")");
});
check("REVIEW #2: a return-trip entry whose origin item is gone is NOT overlaid", () => {
  const orphan = { id: "p9", originItemId: "gone", originPhase: "rough", done: false };
  const job = { roughPunch: tree([item("1", false)]), returnTrips: [{ id: "rt", punch: [orphan] }], punchTicks: { "gone": slot(true), "1": slot(true) } };
  const out = PT.applyPunchTicks(job);
  assert.strictEqual(out.returnTrips[0].punch[0], orphan, "orphan entry keeps identity");
  assert.strictEqual(byId(out.roughPunch, "1").done, true);
});
check("REVIEW #3: the public punch share page overlays the slots", () => {
  const at = src.indexOf("function PunchSharePage"); assert(at > 0, "PunchSharePage exists");
  const page = src.slice(at, at + 6000);
  assert(!page.includes("setJob(snap.data()?.data)"), "no raw setJob of the stored tree");
  assert(page.includes("applyPunchTicks("), "share page applies the overlay");
});

// __LATER_SECTIONS__ (Tasks 3–5 insert above this line)
console.log(`punch-ticks-test: ${n} checks passed`);
