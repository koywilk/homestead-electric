#!/usr/bin/env node
/* phasecosts-test.js — functions/phaseCosts.js, the math behind Dashboard › Job Costs (SW v564).
 *
 * Fixtures are real Simpro numbers read on 2026-10-23 (read-only):
 *   1. NAMES — "(Rough In)" / "(Finish)" / "(Trim)" item suffixes; cost-center types.
 *   2. ITEMS — Pierce #1277 "Heat Tape Pre-wire" change order: 3 prebuilds, 12.25 h, splits
 *      10.0 h rough (switch + heat tape) / 2.25 h finish (GFI); minutes come from Totals.EstimatedTime.
 *   3. BUDGET — Base Rough In's items add up to 370.9 h against Simpro's 313.6 h: Simpro's total
 *      is the budget, so the split scales down and stays 313.6 h rough.
 *   4. LEFTOVER / CREDIT — labor not on an item goes to the cost center's phase; a credit
 *      (Wafer Credit −20.5 h) comes off its phase.
 *   5. SPENT — #694 "DMF Lighting": $12,187 of materials spent splits like its estimate
 *      (522.8 rough / 2,082.9 finish / 983.0 untagged).
 *   6. JOB — Pierce's seven cost centers add up to rough 427.3 h est / 403.8 h used.
 *   7. SHARDS — cost-center lists pack into docs under the byte cap, every job findable.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const X = require(path.join(__dirname, "..", "functions", "phaseCosts.js"));
const near = (a, b, m, tol = 0.051) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
let passed = 0;
const t = (name, f) => { f(); passed++; };

t("names", () => {
  assert.strictEqual(X.phaseOfItem("30A Heat Tape (Rough In)"), "rough");
  assert.strictEqual(X.phaseOfItem("15A Panelized Lighting Switch Leg (Rough-In)"), "rough");
  assert.strictEqual(X.phaseOfItem("1G 15A WP GFI Receptacle (In Use Cover) (Finish)"), "finish");
  assert.strictEqual(X.phaseOfItem("Can Light (Trim)"), "finish");
  assert.strictEqual(X.phaseOfItem("600A Single Phase Service"), null);
  assert.strictEqual(X.phaseOfType("Residential (Rough In)"), "rough");
  assert.strictEqual(X.phaseOfType("Commercial (Finish)"), "finish");
  assert.strictEqual(X.phaseOfType("Change Order"), null);
});

const heatTape = [
  { kind: "prebuilds", it: { Prebuild: { Name: "3G 15A Switch (Rough In)" }, Total: { Qty: 1 }, Totals: { PriceEx: 88.29, EstimatedTime: 60 }, BasePrice: 70, LaborCost: 72.75 } },
  { kind: "prebuilds", it: { Prebuild: { Name: "30A Heat Tape (Rough In)" }, Total: { Qty: 3 }, Totals: { PriceEx: 1582.71, EstimatedTime: 540 }, EstimatedTime: 180, BasePrice: 439.517, LaborCost: 72.75 } },
  { kind: "prebuilds", it: { Prebuild: { Name: "1G 15A WP GFI Receptacle (In Use Cover) (Finish)" }, Total: { Qty: 3 }, Totals: { PriceEx: 218.46, EstimatedTime: 135 }, BasePrice: 63, LaborCost: 72.75 } },
].map(x => X.itemOf(x.it, x.kind));

t("items", () => {
  near(heatTape[1].hrs, 9, "heat tape 540 min = 9 h");
  near(heatTape[1].mat, 439.517 * 3 - 9 * 72.75, "heat tape materials = cost less its labor");
  const w = X.weightsOf(heatTape, "rough");
  const s = X.split(12.25, w.hrs, "rough");
  near(s.rough, 10, "rough hours"); near(s.finish, 2.25, "finish hours"); near(s.other, 0, "none untagged");
});

t("budget", () => {
  const items = [{ name: "Customer Provided Fixture (Rough In)", hrs: 370.9 }];
  const s = X.split(313.56, X.weightsOf(items, "rough").hrs, "rough");
  near(s.rough, 313.56, "scaled to Simpro's total"); near(s.finish, 0, "no finish");
});

t("leftover and credit", () => {
  const s = X.split(20, { rough: 6, finish: 4, other: 0 }, "rough");
  near(s.rough, 16, "leftover 10 h to the cost center's phase"); near(s.finish, 4, "finish kept");
  const c = X.split(-20.5, { rough: 0, finish: 0, other: 0 }, "rough");
  near(c.rough, -20.5, "credit off rough");
});

t("spent", () => {
  const o = X.spentSplit(12187.3, { rough: 522.8, finish: 2082.9, other: 983.0 }, "rough");
  near(o.rough, 1775.6, "rough share", 0.5); near(o.finish, 7073.3, "finish share", 0.5); near(o.rough + o.finish + o.other, 12187.3, "adds back");
  const none = X.spentSplit(50, { rough: 0, finish: 0, other: 0 }, "finish");
  near(none.finish, 50, "no estimate → the cost center's phase");
});

// Pierce #1277: Simpro cost-center totals (hours) and their item splits, as pulled 2026-10-23.
const pierce = [
  ["Base", "Rough In", "Residential (Rough In)", 313.56, 403.83, { rough: 370.91, finish: 0, other: 0 }],
  ["Base", "Finish", "Residential (Finish)", 282.69, 0, { rough: 0, finish: 282.69, other: 0 }],
  ["Base", "600A Meter - 60/120 Panels", "Residential (Rough In)", 79.93, 0, { rough: 79.93, finish: 0, other: 0 }],
  ["Base", "Panasonic Bath Fans x 6", "Residential (Rough In)", 10.07, 0, { rough: 8.53, finish: 1.54, other: 0 }],
  ["Base", "Tape Light Install - Labor Only", "Residential (Finish)", 105.9, 0, { rough: 0, finish: 105.9, other: 0 }],
  ["Change Order - 10/1/26", "Heat Tape Pre-wire x 3", "Residential (Rough In)", 12.25, 0, { rough: 10, finish: 2.25, other: 0 }],
  ["Change Order - 10/1/26", "Ejector Pump Alarm Power", "Residential (Rough In)", 16, 0, { rough: 15.25, finish: 0.75, other: 0 }],
].map(([sec, name, type, est, act, w]) => {
  const tt = X.ccTotals({ Name: name, CostCenter: { Name: type }, Totals: { ResourcesCost: { LaborHours: { Estimate: est, Actual: act }, Total: { Estimate: est * 72.75, Actual: act * 72.75 } }, MaterialsCost: { Estimate: 0 } } });
  return X.ccRow(sec, tt, { hrs: w, mat: w, lab: w, sell: w }, 3, 3);
});

t("job", () => {
  const row = X.jobRow({ no: 1277, name: "Pierce Residence", stage: "Progress", status: "Job - Rough-In" }, pierce);
  near(row.rough_hrsEst, 427.3, "rough estimate, every cost center", 0.1);
  near(row.rough_hrsUsed, 403.8, "rough used", 0.1);
  near(row.finish_hrsEst, 393.2, "finish estimate", 0.1);
  near(row.rough_hrsEst + row.finish_hrsEst + row.other_hrsEst, 820.4, "adds back to Simpro's 820.4 h", 0.2);
  assert.strictEqual(row.status, "Rough-In");
  assert.strictEqual(X.jobRow({ no: 1, stage: "Invoiced", status: "Job - Receipts Reviewed" }, []).status, "Invoiced");
  assert.ok(X.hasEstimate(row) && !X.hasEstimate(X.jobRow({ no: 2 }, [])));
});

t("hours", () => {
  const row = X.jobRow({ no: 1277, name: "Pierce Residence", stage: "Progress" }, pierce);
  const h = X.hoursDoc([row, X.jobRow({ no: 2 }, []), { no: 3, rough_hrsEst: 0, rough_hrsUsed: 0, finish_hrsEst: 12, finish_hrsUsed: 0, finish_sell: 900 }]);
  assert.deepStrictEqual(Object.keys(h).sort(), ["1277", "3"], "jobs with no rough / finish hours left out");
  near(h["1277"].r[0], 403.8, "rough used", 0.1); near(h["1277"].r[1], 427.3, "rough estimate", 0.1);
  near(h["1277"].f[1], 393.2, "finish estimate", 0.1);
  assert.deepStrictEqual(h["3"], { f: [0, 12] }, "a phase with no hours is left off");
  assert.ok(!/sell|mat|lab|\$/.test(JSON.stringify(h)), "hours only, no dollar field");
});

t("shards", () => {
  const byNo = {}; for (let i = 0; i < 40; i++) byNo[String(1000 + i)] = pierce;
  const { shards, where } = X.shardCcs(byNo, 20000);
  assert.ok(shards.length > 1, "split into several docs");
  shards.forEach(s => assert.ok(Buffer.byteLength(JSON.stringify(s)) <= 22000, "each under the cap"));
  Object.keys(byNo).forEach(no => assert.ok(shards[where[no]][no], `job ${no} findable`));
});

// Live reads (getPhaseHours): a used-hours change costs no item reads; only a changed estimate re-reads items.
async function liveCheck() {
  const job = { base: { est: 100, act: 10 }, co: { est: 20, act: 0 } };
  const calls = [];
  const cc = (id, name, h) => ({ ID: id, Name: name, CostCenter: { Name: "Residential (Rough In)" },
    Totals: { ResourcesCost: { LaborHours: { Estimate: h.est, Actual: h.act }, Total: { Estimate: h.est * 70, Actual: h.act * 70 } }, MaterialsCost: { Estimate: 0 } } });
  const item = (id, name, min) => ({ ID: id, Description: name, Total: { Qty: 1, Amount: { ExTax: 0 } }, Totals: { EstimatedTime: min, PriceEx: 0 }, EstimatedTime: min, BasePrice: 0, LaborCost: 70 });
  const req = async (m, path) => {
    calls.push(path);
    if (/\/sections\/\?/.test(path)) return { ok: true, data: [{ ID: 1, Name: "Base", DisplayOrder: 0 }] };
    if (/costCenters\/\?/.test(path)) return { ok: true, data: [cc(11, "Base", job.base), cc(12, "CO", job.co)] };
    if (/costCenters\/11\/oneOffs/.test(path)) return { ok: true, data: [item(1, "Pipe (Rough In)", 4800), item(2, "Devices (Finish)", 1200)] };
    if (/costCenters\/12\/oneOffs/.test(path)) return { ok: true, data: [item(3, "Feed (Rough In)", 1200)] };
    return { ok: true, data: [] };
  };
  const itemCalls = () => calls.filter(c => /costCenters\/\d+\//.test(c)).length;
  const cold = await X.pullJob({ no: "9" }, null, req);
  assert.strictEqual(cold.itemReads, 2, "first read opens both cost centers' items");
  near(X.hoursDoc([cold.row])["9"].r[1], 100, "rough estimate 80 + 20", 0.1);
  near(X.hoursDoc([cold.row])["9"].f[1], 20, "finish estimate", 0.1);
  calls.length = 0; job.base.act = 50;
  const warm = await X.pullJob({ no: "9" }, { cache: cold.cache }, req);
  assert.strictEqual(warm.itemReads, 0, "hours used moved: no item reads");
  assert.strictEqual(itemCalls(), 0, "only sections + cost-center lists asked");
  assert.strictEqual(calls.length, 2, "two Simpro requests for a one-section job");
  near(X.hoursDoc([warm.row])["9"].r[0], 40, "live used hours split 80 / 20 like the estimate", 0.1);
  near(X.hoursDoc([warm.row])["9"].f[0], 10, "finish share of the used hours", 0.1);
  calls.length = 0; job.co.est = 30;
  const changed = await X.pullJob({ no: "9" }, { cache: warm.cache }, req);
  assert.strictEqual(changed.itemReads, 1, "a changed estimate re-reads that one cost center only");
  passed++; console.log("  ok  live");
}

liveCheck().then(() => console.log(`phasecosts-test: ${passed} checks passed`)).catch(e => { console.error("  FAIL live:", e.message); process.exit(1); });
