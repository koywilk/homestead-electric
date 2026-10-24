#!/usr/bin/env node
/* jobcosts-model-test.js — Dashboard › Job Costs (SW v564), the pure parts in src/App.js, compiled out
 * by odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. CREDIT (v566, Josh's rule) — a job is credited to its Simpro technician, the first one when there are
 *      several ("Gage Lund / Louis Hoffman" → Gage), from the Goals doc when it has the job, else the Job
 *      Costs row; UNASSIGNED / none → "No technician". The lead still comes from the Job Board ("Lead TBD" is
 *      none); quotes are skipped and a live job beats an archived one on the same #.
 *   2. MARGINS — weighted (Σ sell − Σ spent ÷ Σ sell) vs the plain per-job average: a small 50% job and a big
 *      5% job give 9.1% weighted, 27.5% average, one under 15%.
 *   3. JOSH — whole-job margin = Σ Simpro net profit ÷ Σ contract on his counted jobs only (the Goals tab's
 *      number), plain average of Simpro's margins, under 15%.
 *   4. SUMMARY — used ÷ estimate and jobs over count jobs with that phase started; rough / finish margins on
 *      Josh's counted jobs, and as *Live on open jobs past that phase.
 *   5. CREW — the same totals per technician, jobs with none under "No technician".
 *   6. JOB — a phase with no spending has no margin yet; whole job is Simpro's margin on Josh's jobs.
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

t("credit", () => {
  const jobs = [
    { id: "a", simproNo: "1107", foreman: "Keegan Wilkinson", lead: "Treycen Rollene" },
    { id: "b", simproNo: "1430", foreman: "Gage Lund", lead: "Lead TBD" },
    { id: "g", simproNo: "503", foreman: "Colby Fogh", type: "quote" },
    { id: "h1", simproNo: "504", foreman: "Colby Fogh", lead: "Old", archived: true }, { id: "h2", simproNo: "504 ", foreman: "Keegan Wilkinson", lead: "New" },
  ];
  const goals = [{ id: 1107, tech: "Keegan Wilkinson", counts: true, npl_act: 100, contract: 1000, nm_act: 10 }, { id: 1430, tech: "Gage Lund / Louis Hoffman", counts: false }];
  const rows = [row(1107, "Invoiced"), row(1430, "Rough-In Complete"), { ...row(503, "Rough-In"), tech: "Colby Fogh" }, { ...row(504, "Rough-In"), tech: "UNASSIGNED" }, row(999, "Rough-In")];
  const by = Object.fromEntries(X.odCostsJoin(rows, jobs, goals).map(r => [r.no, r]));
  assert.strictEqual(by["1107"].foreman, "Keegan Wilkinson"); assert.strictEqual(by["1107"].lead, "Treycen Rollene"); assert.strictEqual(by["1107"].jobId, "a");
  assert.ok(by["1107"].josh.counts && by["1107"].josh.npl === 100);
  assert.strictEqual(by["1430"].foreman, "Gage Lund", "the first technician gets credit (Josh's rule)"); assert.strictEqual(by["1430"].lead, "");
  assert.strictEqual(by["503"].foreman, "Colby Fogh", "no Goals row → the Job Costs row's technician"); assert.strictEqual(by["503"].jobId, null, "a quote is never the board job");
  assert.strictEqual(by["504"].foremanShown, "No technician"); assert.strictEqual(by["504"].lead, "New", "the live job wins over the archived one");
  assert.strictEqual(by["999"].foremanShown, "No technician"); assert.strictEqual(by["999"].josh, null);
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
    finish_sell: 4000, finish_matAct: 1000, finish_labAct: 2500, other_sell: 500, other_matAct: 100, other_labAct: 100, foreman: "Colby Fogh",
    josh: { counts: true, npl: 2100, contract: 10500, nm: 20 } }),
  row(4, "Scheduled", { foreman: "" }),
];

t("josh", () => {
  const j = (npl, contract, nm, counts = true) => ({ josh: { counts, npl, contract, nm } });
  const m = X.odCostsJosh([j(50, 100, 50), j(50, 1000, 5), j(999, 1000, 99, false), { josh: null }]);
  assert.strictEqual(m.n, 2, "only Josh's counted jobs"); near(m.w, 100 / 1100, "Σ net profit ÷ Σ contract"); near(m.avg, 0.275, "plain average of Simpro's margins"); assert.strictEqual(m.under, 1);
});

t("summary", () => {
  const s = X.odCostsSummary(set);
  assert.strictEqual(s.jobs, 4); assert.strictEqual(s.rough_started, 3); assert.strictEqual(s.finish_started, 1);
  assert.strictEqual(s.rough_hrs_over, 1, "only job 1 is over on rough hours");
  near(s.rough_hrs_pct, 250 / 260, "rough hours used ÷ estimate, started jobs");
  assert.strictEqual(s.rough.n, 1, "rough margin: Josh's counted jobs (job 3)"); near(s.rough.w, 2000 / 6000, "rough weighted, item split");
  assert.strictEqual(s.roughLive.n, 1, "open jobs past rough (job 2)"); near(s.roughLive.w, 0.4, "rough so far on open jobs");
  assert.strictEqual(s.finish.n, 1); near(s.finish.w, 500 / 4000, "finish weighted");
  assert.strictEqual(s.whole.n, 1); near(s.whole.w, 0.2, "whole job = Simpro net profit ÷ contract");
});

t("crew", () => {
  const c = X.odCostsCrew(set, "foreman");
  const k = c.find(r => r.person === "Keegan Wilkinson"), n = c.find(r => r.person === "No technician"), co = c.find(r => r.person === "Colby Fogh");
  assert.strictEqual(k.jobs, 2); assert.strictEqual(k.rough_hrs_over, 1); near(k.roughLive.w, 0.4, "Keegan rough so far, job 2");
  near(co.whole.w, 0.2, "Colby's whole-job margin, Josh's rule");
  assert.ok(n && n.jobs === 1, "a job with nobody has its own row");
  assert.ok(X.odCostsCrew(set, "lead").every(r => r.person === "No lead"));
});

t("job", () => {
  const p = X.odCostsJobPct(set[0]);
  near(p.rough_hrs_pct, 1.2, "120 of 100 hours"); near(p.rough_mAct, 0.1, "rough margin so far");
  near(p.rough_hrs_overBy, 20, "20 hours past the estimate (the default sort)"); near(p.rough_profit, 1000, "$1,000 made on rough so far");
  assert.strictEqual(p.finish_mAct, null, "no finish spending → no finish margin yet");
  near(X.odCostsJobPct(set[2]).all_mAct, 0.2, "whole job on Josh's job = Simpro's margin");
});

console.log(`jobcosts-model-test: ${passed} checks passed`);
