#!/usr/bin/env node
/* jobcosts-model-test.js — Dashboard › Job Costs (SW v564), the pure parts in src/App.js, compiled out
 * by odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. FOREMAN — the Job Board's foreman counts only when titled Foreman on Team Members: a jr
 *      foreman (Gage, 2026-10-23), an inactive person, an office person and Paul (outside
 *      contractor) all show as "No foreman (…, why)"; blank / Unassigned is plain "No foreman";
 *      "Lead TBD" is no lead; quotes are skipped and a live job beats an archived one on the same #.
 *   2. MARGINS — weighted (Σ sell − Σ spent ÷ Σ sell) vs the plain per-job average: a small 50% job
 *      and a big 5% job give 9.1% weighted, 27.5% average, one under 15%.
 *   3. SUMMARY — used ÷ estimate and jobs over count only jobs with that phase started; rough
 *      margin counts jobs past rough, finish and whole-job margin count punch list / RTI / Invoiced.
 *   4. CREW — the same totals per foreman, jobs with nobody under "No foreman".
 *   5. JOB — a phase with no spending has no margin yet.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
const near = (a, b, m, tol = 0.0005) => assert.ok(a != null && Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
let passed = 0;
const t = (name, f) => { f(); passed++; };

const users = [
  { name: "Keegan Wilkinson", title: "foreman" }, { name: "Colby Fogh", title: "foreman" },
  { name: "Gage Lund", title: "jrforeman" }, { name: "Vasa Mataafa", title: "foreman", active: false },
  { name: "Josh Cloward", title: "admin" }, { name: "Paul", title: "foreman" },
];
const z = { rough_hrsUsed: 0, finish_hrsUsed: 0, other_hrsUsed: 0 };
const row = (no, status, extra) => ({ no: String(no), name: "Job " + no, status, ...z, ...extra });

t("foreman", () => {
  const jobs = [
    { id: "a", simproNo: "1107", foreman: "Keegan Wilkinson", lead: "Treycen Rollene" },
    { id: "b", simproNo: "1430", foreman: "Gage Lund", lead: "Gage Lund" },
    { id: "c", simproNo: "889", foreman: "Vasa Mataafa" },
    { id: "d", simproNo: "500", foreman: "Josh Cloward" },
    { id: "e", simproNo: "501", foreman: "Paul" },
    { id: "f", simproNo: "502", foreman: "Unassigned", lead: "Lead TBD" },
    { id: "g", simproNo: "503", foreman: "Colby Fogh", type: "quote" },
    { id: "h1", simproNo: "504", foreman: "Colby Fogh", archived: true }, { id: "h2", simproNo: "504 ", foreman: "Keegan Wilkinson" },
  ];
  const out = X.odCostsJoin(["1107", "1430", "889", "500", "501", "502", "503", "504", "999"].map(n => row(n, "Rough-In")), jobs, users);
  const by = Object.fromEntries(out.map(r => [r.no, r]));
  assert.strictEqual(by["1107"].foreman, "Keegan Wilkinson"); assert.strictEqual(by["1107"].lead, "Treycen Rollene"); assert.strictEqual(by["1107"].jobId, "a");
  assert.strictEqual(by["1430"].foreman, ""); assert.strictEqual(by["1430"].foremanShown, "No foreman (Gage Lund, jr foreman)");
  assert.strictEqual(by["889"].foremanShown, "No foreman (Vasa Mataafa, not on the team)");
  assert.strictEqual(by["500"].foremanShown, "No foreman (Josh Cloward, office)");
  assert.strictEqual(by["501"].foremanShown, "No foreman (Paul, outside contractor)");
  assert.strictEqual(by["502"].foremanShown, "No foreman"); assert.strictEqual(by["502"].lead, "");
  assert.strictEqual(by["503"].foremanShown, "No foreman", "a quote never supplies the foreman");
  assert.strictEqual(by["504"].foreman, "Keegan Wilkinson", "the live job wins over the archived one");
  assert.strictEqual(by["999"].jobId, null, "a Simpro job not on the board has no foreman");
});

t("margins", () => {
  const m = X.odCostsMargins([{ rough_sell: 100, rough_matAct: 20, rough_labAct: 30 }, { rough_sell: 1000, rough_matAct: 500, rough_labAct: 450 }], ["rough"]);
  near(m.w, 100 / 1100, "weighted"); near(m.avg, 0.275, "plain average"); assert.strictEqual(m.under, 1); assert.strictEqual(m.n, 2);
  assert.strictEqual(X.odCostsMargins([], ["rough"]).w, null, "no jobs → no margin");
});

const set = [
  row(1, "Rough-In", { rough_hrsUsed: 120, rough_hrsEst: 100, rough_sell: 10000, rough_matAct: 3000, rough_labAct: 6000, foreman: "Keegan Wilkinson" }),
  row(2, "Rough-In Complete", { rough_hrsUsed: 80, rough_hrsEst: 100, rough_sell: 10000, rough_matAct: 2000, rough_labAct: 4000, foreman: "Keegan Wilkinson" }),
  row(3, "Invoiced", { rough_hrsUsed: 50, rough_hrsEst: 60, finish_hrsUsed: 40, finish_hrsEst: 30, rough_sell: 6000, rough_matAct: 2000, rough_labAct: 2000,
    finish_sell: 4000, finish_matAct: 1000, finish_labAct: 2500, other_sell: 500, other_matAct: 100, other_labAct: 100, foreman: "Colby Fogh" }),
  row(4, "Scheduled", { foreman: "" }),
];

t("summary", () => {
  const s = X.odCostsSummary(set);
  assert.strictEqual(s.jobs, 4); assert.strictEqual(s.rough_started, 3); assert.strictEqual(s.finish_started, 1);
  assert.strictEqual(s.rough_hrs_over, 1, "only job 1 is over on rough hours");
  near(s.rough_hrs_pct, 250 / 260, "rough hours used ÷ estimate, started jobs");
  assert.strictEqual(s.rough.n, 2, "rough margin: jobs past rough (2 and the invoiced 3)");
  near(s.rough.w, (16000 - 10000) / 16000, "rough weighted");
  assert.strictEqual(s.finish.n, 1); near(s.finish.w, 500 / 4000, "finish weighted");
  near(s.all.w, (10500 - 7700) / 10500, "whole job, rough + finish + untagged");
  assert.strictEqual(s.all.under, 0);
});

t("crew", () => {
  const c = X.odCostsCrew(set, "foreman");
  const k = c.find(r => r.person === "Keegan Wilkinson"), n = c.find(r => r.person === "No foreman");
  assert.strictEqual(k.jobs, 2); assert.strictEqual(k.rough_hrs_over, 1); near(k.rough.w, 0.4, "Keegan rough margin, job 2 only");
  assert.ok(n && n.jobs === 1, "a job with nobody is under No foreman");
  assert.ok(X.odCostsCrew(set, "lead").every(r => r.person === "No lead"));
});

t("job", () => {
  const p = X.odCostsJobPct(set[0]);
  near(p.rough_hrs_pct, 1.2, "120 of 100 hours"); near(p.rough_mAct, 0.1, "rough margin so far");
  near(p.rough_hrs_overBy, 20, "20 hours past the estimate (the default sort)"); near(p.rough_profit, 1000, "$1,000 made on rough so far");
  assert.strictEqual(p.finish_mAct, null, "no finish spending → no finish margin yet");
});

console.log(`jobcosts-model-test: ${passed} checks passed`);
