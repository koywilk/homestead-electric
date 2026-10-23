#!/usr/bin/env node
/* goals-pull-test.js — the pure half of the nightly Goals pull (functions/goalsPull.js):
 * which Simpro jobs count toward Josh's "invoiced in 2026" rule, the slim job row the
 * cache keeps, and the invoice statistics (days to paid, the open book). No Simpro, no
 * Firestore: fixtures only. Wired into `prebuild`. */
"use strict";
const assert = require("assert");
const path = require("path");
const G = require(path.join(__dirname, "..", "functions", "goalsPull.js"));

const job = (id, over = {}) => ({
  ID: id, Name: "Job " + id, Stage: "Invoiced", Status: { Name: "Job - Invoiced" }, Type: "Project",
  Technicians: [{ Name: "Keegan Wilkinson" }], Total: { ExTax: 10000, IncTax: 10000 },
  CustomFields: [{ CustomField: { Name: "Business Group" }, Value: "Residential" }],
  Totals: { InvoicePercentage: 100, NettMargin: { Actual: 12.5, Estimate: 15 }, NettProfitLoss: { Actual: 1250 },
    MaterialsCost: { Actual: 3000 }, ResourcesCost: { Labor: { Actual: 4000 }, LaborHours: { Actual: 130, Estimate: 100 } } },
  ...over,
});

// 1. slimJob + jobCounts
const counted = G.slimJob(job(1));
assert.strictEqual(counted.counts, true, "fully invoiced with costs counts");
assert.deepStrictEqual([counted.id, counted.tech, counted.division, counted.contract, counted.nm_act, counted.npl_act, counted.hrs_act, counted.hrs_est],
  [1, "Keegan Wilkinson", "residential", 10000, 12.5, 1250, 130, 100]);
const partial = G.slimJob(job(2, { Totals: { ...job(2).Totals, InvoicePercentage: 61.7 } }));
assert.strictEqual(partial.counts, false, "61.7% invoiced does not count");
const noCosts = G.slimJob(job(3, { Totals: { InvoicePercentage: 100, NettMargin: { Actual: 100 }, NettProfitLoss: { Actual: 10000 }, MaterialsCost: { Actual: 0 }, ResourcesCost: { Labor: { Actual: 0 }, LaborHours: { Actual: 0, Estimate: 50 } } } }));
assert.strictEqual(noCosts.counts, false, "the empty 100% margin with no costs does not count");
const comm = G.slimJob(job(4, { CustomFields: [{ CustomField: { Name: "Business Group" }, Value: "Commercial" }], Technicians: [] }));
assert.deepStrictEqual([comm.division, comm.tech], ["commercial", "UNASSIGNED"]);
const blankBg = G.slimJob(job(5, { CustomFields: [] }));
assert.strictEqual(blankBg.division, "", "no Business Group stays blank in the cache (the page treats it as residential)");
assert.strictEqual(G.slimJob(job(6, { Totals: null })).counts, false, "no Totals never counts");

// 2. distinctJobIds
const inv = (id, over = {}) => ({ ID: id, DateIssued: "2026-09-01", IsPaid: false, DatePaid: "", DueDate: "2026-10-01", IsCredit: false,
  Total: { ExTax: 1000, IncTax: 1000, Paid: 0 }, Jobs: [{ ID: 1, Total: { ExTax: 1000 } }], Customer: { CompanyName: "E Builders" }, ...over });
assert.deepStrictEqual(G.distinctJobIds([inv(1), inv(2, { Jobs: [{ ID: 1 }, { ID: 2 }] }), inv(3, { Jobs: [] })]), [1, 2]);

// 3. invoiceStats
const today = "2026-10-23";
const invoices = [
  inv(10, { IsPaid: true, DatePaid: "2026-10-01", Total: { ExTax: 1000, IncTax: 1000, Paid: 1000 } }),               // paid in 30 d
  inv(11, { DateIssued: "2026-08-01", IsPaid: true, DatePaid: "2026-09-20", Total: { ExTax: 2000, IncTax: 2000, Paid: 2000 }, Jobs: [{ ID: 4 }] }), // paid in 50 d, commercial job
  inv(12, { DateIssued: "2026-09-15", DueDate: "2026-10-15", Total: { ExTax: 5000, IncTax: 5250, Paid: 250 } }),     // open, past due, 38 d old
  inv(13, { DateIssued: "2026-08-10", DueDate: "2026-11-10", Total: { ExTax: 3000, IncTax: 3000, Paid: 0 } }),       // open, not due, 74 d old
  inv(14, { IsCredit: true, IsPaid: true, DatePaid: "2026-09-02", Total: { ExTax: -400, IncTax: -400, Paid: -400 } }), // credit: ignored everywhere
  inv(15, { DateIssued: "2026-09-10", IsPaid: true, DatePaid: "2026-09-01", Total: { ExTax: 100, IncTax: 100, Paid: 100 } }), // bad dates: paid before issued
];
const divisionOf = (id) => (id === 4 ? "commercial" : "residential");
const s = G.invoiceStats(invoices, today, divisionOf);
assert.strictEqual(s.count, 5, "credits are not invoices");
assert.deepStrictEqual([s.paid.n, s.paid.avgDays, s.paid.medianDays], [2, 40, 40], "bad-dated paid invoice is left out of days to paid");
assert.deepStrictEqual([s.open.n, s.open.owed, s.open.pastDueN, s.open.pastDue, s.open.over60N, s.open.over60], [2, 8000, 1, 5000, 1, 3000]);
assert.deepStrictEqual(s.byDivision, { commercial: 2000, residential: 9100, other: 0 }, "ex-tax dollars by the job's division, credits out");

// 4. measures on a slim set (the client does the same math; this pins the server's copy)
const slim = [counted, G.slimJob(job(7, { Totals: { ...job(7).Totals, NettProfitLoss: { Actual: 2000 }, NettMargin: { Actual: 20 } } })), partial, noCosts];
const m = G.measures(slim);
assert.deepStrictEqual([m.counted, m.marginPct, m.hoursPct, m.at15], [2, 16.3, 130, 1], "weighted over counted jobs only");
assert.deepStrictEqual(m.byTech[0], { tech: "Keegan Wilkinson", n: 2, hoursPct: 130, marginPct: 16.3 });

console.log("goals-pull-test: all checks passed");
