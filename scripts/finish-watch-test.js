#!/usr/bin/env node
/* finish-watch-test.js — Job Costs › Finish margin watch (SW v616), the pure odCostsFinishWatch in
 * src/App.js compiled out by odash-model-test's sandbox, so what is tested is what ships.
 *
 * Proves:
 *   1. SCOPE — Invoiced jobs and finishes with no spending stay out; a fully invoiced (Josh-counted)
 *      job that is still active stays in, marked billed.
 *   2. LEVELS — under 15%, near (15 to 20%), at bid (margin fine but hours or material 90%+), none
 *      otherwise; order is under (worst first), near, at bid (highest share of bid first).
 *   3. FIXES — pending COs, finish warranty hours, hours over / near bid, room left before 15%,
 *      material over / near bid, T&M; at most two, job-specific first.
 *   4. NO DOLLARS — no "$" in any line, so the foreman view can show it.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
let passed = 0;
const t = (name, f) => { try { f(); passed++; } catch (e) { console.error("FAIL " + name); throw e; } };
const row = (o) => ({ no: "1", name: "Job", status: "Rough-In Complete", finish_sell: 10000, finish_matAct: 0, finish_labAct: 0, finish_matEst: 3000, finish_labEst: 5000,
  finish_hrsEst: 100, finish_hrsUsed: 0, josh: null, ...o });

t("scope", () => {
  const w = X.odCostsFinishWatch([
    row({ no: "1", status: "Invoiced", finish_labAct: 9500, finish_hrsUsed: 120 }),
    row({ no: "2" }),
    row({ no: "3", finish_labAct: 9000, finish_hrsUsed: 110, josh: { counts: true } }),
  ], [], {});
  assert.strictEqual(JSON.stringify(w.all.map(x => x.no)), JSON.stringify(["3"]));
  assert.strictEqual(w.all[0].billed, true);
});
t("levels and order", () => {
  const w = X.odCostsFinishWatch([
    row({ no: "a", finish_labAct: 7000, finish_matAct: 1000, finish_hrsUsed: 60 }),              // 20% exactly -> at bid? no: hours 60%, mat 33% -> none
    row({ no: "b", finish_labAct: 7000, finish_matAct: 1500, finish_hrsUsed: 60 }),              // 15% -> near
    row({ no: "c", finish_labAct: 8000, finish_matAct: 1500, finish_hrsUsed: 90 }),              // 5% -> under
    row({ no: "d", finish_labAct: 9000, finish_matAct: 2000, finish_hrsUsed: 120 }),             // -10% -> under, worse
    row({ no: "e", finish_labAct: 4000, finish_matAct: 2800, finish_hrsUsed: 50 }),              // 32%, mat 93% -> at bid
    row({ no: "f", finish_labAct: 4500, finish_matAct: 500, finish_hrsUsed: 95 }),               // 50%, hrs 95% -> at bid, first
  ], [], {});
  assert.strictEqual(JSON.stringify(w.all.map(x => x.no + x.level)), JSON.stringify(["dunder", "cunder", "bnear", "fbid", "ebid"]));
  assert.strictEqual(JSON.stringify([w.under, w.near, w.bid]), JSON.stringify([2, 1, 2]));
});
t("fixes", () => {
  const jobs = [{ simproNo: "9", changeOrders: [{ coStatus: "pending", time: "3 hrs" }, { coStatus: "needs_sending", time: "1.5 hours" }, { coStatus: "completed", time: "9 hrs" }, { coStatus: "approved", time: "2 hrs" }] }];
  const cc = { 9: [{ type: "Residential (Warranty)", finish_hrsUsed: 12.4, hrsUsed: 40 }, { type: "Residential (Finish)", finish_hrsUsed: 100 }] };
  const w = X.odCostsFinishWatch([row({ no: "9", finish_labAct: 9000, finish_matAct: 3500, finish_hrsUsed: 130 })], jobs, cc);
  const r = w.all[0].recs;
  assert.strictEqual(r.length, 2);
  assert.ok(/^2 COs still not approved \(4\.5 h\)/.test(r[0]), r[0]);
  assert.ok(/^12 finish hours are booked to a warranty cost center/.test(r[1]), r[1]);
  const w2 = X.odCostsFinishWatch([row({ no: "8", finish_labAct: 9000, finish_matAct: 3500, finish_hrsUsed: 130 })], [], {});
  assert.ok(/^Finish hours are 30 h over bid \(130 of 100\)/.test(w2.all[0].recs[0]), w2.all[0].recs[0]);
  assert.ok(/^Finish material is at 117% of bid/.test(w2.all[0].recs[1]), w2.all[0].recs[1]);
  // room left before 15%: sell 10000, spent 6800 (labor 4000 over 40 h = 100/h) -> (8500-6800)/100 = 17 h, bid has 60 left
  const w3 = X.odCostsFinishWatch([row({ no: "7", finish_labAct: 4000, finish_matAct: 2800, finish_hrsUsed: 40 })], [], {});
  assert.ok(w3.all[0].recs.some(x => /^About 17 h of finish are left before it drops under 15%, and the bid still has 60 h/.test(x)), w3.all[0].recs.join(" | "));
  const w4 = X.odCostsFinishWatch([row({ no: "6", name: "Pool House T&M", finish_labAct: 8000, finish_matAct: 500, finish_hrsUsed: 100 })], [], {});
  assert.ok(/^T&M job/.test(w4.all[0].recs[0]));
  assert.strictEqual(w4.all[0].tm, true);
});
t("no dollars", () => {
  const w = X.odCostsFinishWatch([row({ no: "5", finish_labAct: 9000, finish_matAct: 3500, finish_hrsUsed: 130, josh: { counts: true } })], [], {});
  w.all.forEach(x => x.recs.forEach(l => assert.ok(!/\$/.test(l), l)));
  assert.ok(!("sell" in w.all[0]) && !("spent" in w.all[0]));
});
console.log(`finish-watch-test: ${passed} passed`);
