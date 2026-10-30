#!/usr/bin/env node
/* goals-pull-test.js — the pure half of the nightly Goals pull (functions/goalsPull.js):
 * which Simpro jobs count toward Josh's "invoiced in 2026" rule, the slim job row the
 * cache keeps, and the invoice statistics (days to paid, the open book). No Simpro, no
 * Firestore: fixtures only. Wired into `prebuild`.
 * Phase 2 (SW v583): warranty / change-order cost-center kinds and hours, Mon–Sun week ranges,
 * crew → Simpro employee matching, hours-tracked-weekly, Home Depot / ACE runs, and the whole
 * injected-I/O pull against a fake Simpro (reads only the sections it needs, parts fail alone). */
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

// ── Phase 2 (SW v583): warranty / CO hours, store runs, hours tracked weekly ──────────────
// 5. phase2CcKind — the COMPANY cost center's name decides; the job cost center's own name is the fallback.
assert.strictEqual(G.phase2CcKind({ Name: "Field Fan Install", CostCenter: { ID: 5, Name: "Residential (Warranty)" } }), "warranty");
assert.strictEqual(G.phase2CcKind({ Name: "Closet reframe", CostCenter: { ID: 51, Name: "Residential - Change Order (Rough In)" } }), "co");
assert.strictEqual(G.phase2CcKind({ Name: "Extra cans", CostCenter: { ID: 161, Name: "Commercial - Change Order (Finish)" } }), "co");
assert.strictEqual(G.phase2CcKind({ Name: "Concrete Floor Boxes (x6)", CostCenter: { ID: 38, Name: "Residential (Rough In)" } }), null, "a CO section whose cost center is Rough In is NOT booked to its own cost center");
assert.strictEqual(G.phase2CcKind({ Name: "Warranty return trip" }), "warranty", "no company cost center: the job cost center's name decides");
assert.strictEqual(G.phase2CcKind(null), null);

// 6. phase2Hours — hours and counts per bucket, per job, share of all hours on the slim set.
const p2slim = [{ id: 1, hrs_act: 400 }, { id: 2, hrs_act: 600 }, { id: 3, hrs_act: null }];
const ccs = [
  { jobId: 1, kind: "warranty", hrsAct: 12.5, hrsEst: 0 }, { jobId: 2, kind: "warranty", hrsAct: 7.5, hrsEst: 0 }, { jobId: 2, kind: "warranty", hrsAct: 0, hrsEst: 0 },
  { jobId: 1, kind: "co", hrsAct: 4, hrsEst: 6 }, { jobId: 1, kind: "co", hrsAct: 0, hrsEst: 3 }, { jobId: 2, kind: "co", hrsAct: 0, hrsEst: 0 }, { jobId: 2, kind: "co", hrsAct: 2, hrsEst: 0 },
  { jobId: 3, kind: "other", hrsAct: 99, hrsEst: 99 },
];
const h = G.phase2Hours(ccs, p2slim);
assert.deepStrictEqual([h.allHours, h.warranty.hours, h.warranty.ccs, h.warranty.withHours, h.warranty.jobs, h.warranty.sharePct], [1000, 20, 3, 2, 2, 2], "warranty: 20 h of 1000 h = 2.0%");
assert.deepStrictEqual([h.co.hours, h.co.ccs, h.co.withHours, h.co.expected, h.co.expectedWith, h.co.estHours], [6, 4, 2, 2, 1, 9], "CO: 4 cost centers, 2 with hours, 2 sold with hours of which 1 got hours");
assert.deepStrictEqual(h.co.byJob, { 1: 4, 2: 2 }, "CO hours per job feed the Job Costs column");
assert.strictEqual(G.phase2Hours([], []).warranty.sharePct, null, "no hours anywhere: no share, not 0%");

// 7. weekRanges — the last 8 full Mon–Sun weeks before the current one (10/30/26 is a Friday).
const wk = G.weekRanges("2026-10-30", 8);
assert.deepStrictEqual([wk.length, wk[0].start, wk[0].end, wk[7].start, wk[7].end], [8, "2026-08-31", "2026-09-06", "2026-10-19", "2026-10-25"]);
assert.deepStrictEqual(G.weekRanges("2026-10-26", 1)[0], { start: "2026-10-19", end: "2026-10-25" }, "a Monday still looks back to the finished week");
assert.deepStrictEqual(G.weekRanges("2026-11-01", 1)[0], { start: "2026-10-19", end: "2026-10-25" }, "Sunday belongs to the current week");

// 8. crewMembers + matchEmployees — Team titles decide, contractors and office out, names matched loosely.
const team = [
  { name: "Keegan Wilkinson", title: "foreman", access: "manager" }, { name: "Gage Lund", title: "jrforeman", access: "manager" }, { name: "Treycen Rollene", title: "lead", access: "limited" },
  { name: "Justin Cloward ", title: "crew", access: "limited" }, { name: "Paul", title: "foreman", access: "contractor" }, { name: "Josh Cloward", title: "admin" }, { name: "Koy Wilkinson" },
  { name: "Vasa Mataafa", title: "crew", active: false }, { name: "New Guy", title: "crew", access: "limited" },
];
const crew = G.crewMembers(team);
assert.deepStrictEqual(crew, ["Keegan Wilkinson", "Gage Lund", "Treycen Rollene", "Justin Cloward", "New Guy"], "active field titles only; Paul (contractor), Josh, Koy, Vasa (inactive) out");
const emps = [{ ID: 100, Name: "Keegan Wilkinson" }, { ID: 198, Name: "Gage Lund" }, { ID: 148, Name: "Treycen Rollene" }, { ID: 97, Name: "Justin  Cloward" }, { ID: 1, Name: "Old Hand", Archived: true }];
const mm = G.matchEmployees(crew, emps);
assert.deepStrictEqual(mm.matched.map(m => m.id), [100, 198, 148, 97], "trailing / double spaces do not break the match");
assert.deepStrictEqual(mm.unmatched, ["New Guy"]);

// 9. weeklyHours — a week counts when everyone (who logs at all) has job hours; activities do not count; idle people are named, not counted.
const w2 = G.weekRanges("2026-10-30", 2);   // 10/12–10/18, 10/19–10/25
const ts = (d, h, type = "Job") => ({ Date: d, TotalHrs: h, ScheduleType: type });
const people = [
  { name: "Keegan Wilkinson", entries: [ts("2026-10-13", 8), ts("2026-10-14", 8.5), ts("2026-10-20", 9)] },
  { name: "Gage Lund", entries: [ts("2026-10-13", 7), ts("2026-10-21", 2, "Activity")] },        // week 2: shop time only → not logged
  { name: "Treycen Rollene", entries: [ts("2026-10-15", 0), ts("2026-10-22", 6)] },             // week 1: a zero-hour entry is no entry
  { name: "New Guy", entries: [] },
];
const wh = G.weeklyHours(w2, people);
assert.deepStrictEqual(wh.weeks.map(w => `${w.logged}/${w.of}${w.all ? "*" : ""}`), ["2/3", "2/3"], "no week has everyone");
assert.deepStrictEqual([wh.weeksAll, wh.of, wh.sharePct, wh.peopleAll, wh.idle], [0, 2, 0, 1, ["New Guy"]]);
assert.deepStrictEqual(wh.weeks[0].missed, ["Treycen Rollene"]); assert.deepStrictEqual(wh.weeks[1].missed, ["Gage Lund"]);
assert.deepStrictEqual(wh.people[0], { name: "Gage Lund", weeksLogged: 1, hours: 7 }, "fewest weeks first; activity hours are not in the total");
const whAll = G.weeklyHours(w2, [people[0], { name: "B", entries: [ts("2026-10-16", 3), ts("2026-10-23", 3)] }]);
assert.deepStrictEqual([whAll.weeksAll, whAll.sharePct], [2, 100]);

// 10. storeVendorIds + storeRuns — Home Depot and ACE Hardware by name (not Ace Rentals); rates for the year and the last 8 weeks; the app's log is a sub-line.
assert.deepStrictEqual(G.storeVendorIds([{ ID: 30, Name: "Home Depot" }, { ID: 97, Name: "ACE Hardware" }, { ID: 4, Name: "Ace Rentals" }, { ID: 13, Name: "CED" }]), { homeDepot: [30], ace: [97] });
const vo = (id, d, name) => ({ ID: id, DateIssued: d, Vendor: { ID: name === "Home Depot" ? 30 : 97, Name: name } });
const orders = [vo(1, "2026-01-05", "Home Depot"), vo(2, "2026-01-06", "ACE Hardware"), vo(3, "2026-10-20", "Home Depot"), vo(4, "2026-10-21", "Home Depot"), vo(5, "2026-09-02", "ACE Hardware"), vo(6, "2025-12-30", "Home Depot"), vo(7, "2026-10-28", "Home Depot")];
const sr = G.storeRuns(orders, [{ kind: "number", supplierName: "Home Depot", at: "2026-10-20T14:00:00Z" }, { kind: "number", supplierName: "Amazon", at: "2026-10-21T14:00:00Z" }, { kind: "email", supplierName: "CED", at: "2026-10-21T14:00:00Z" }], "2026-10-30", wk);
assert.deepStrictEqual([sr.year, sr.total, sr.homeDepot, sr.ace, sr.app, sr.last8, sr.last8PerWeek], [2026, 6, 4, 2, 1, 3, 0.4], "last year's order and this week's are outside the 8 weeks; the app's HD run counts once");
assert.strictEqual(sr.perWeek, Math.round(10 * 6 / (303 / 7)) / 10, "year rate = orders ÷ weeks elapsed (Oct 30 is day 303)");
assert.deepStrictEqual(sr.byWeek, [1, 0, 0, 0, 0, 0, 0, 2], "9/2 falls in the first of the 8 weeks (8/31–9/6)");

// 11. pullPhase2 — the whole read with a fake Simpro: lists once, reads only warranty / CO sections on this year's jobs, each part on its own.
(async () => {
  const seen = [];
  const fake = {
    "/jobCostCenters/?pageSize=250&page=1&columns=ID,Name,Job,Section,CostCenter": [
      { ID: 11, Name: "Rough In", Job: { ID: 1 }, Section: { ID: 100 }, CostCenter: { ID: 38, Name: "Residential (Rough In)" } },
      { ID: 12, Name: "Fan install", Job: { ID: 1 }, Section: { ID: 101 }, CostCenter: { ID: 5, Name: "Residential (Warranty)" } },
      { ID: 13, Name: "Closet", Job: { ID: 1 }, Section: { ID: 101 }, CostCenter: { ID: 51, Name: "Residential - Change Order (Rough In)" } },
      { ID: 14, Name: "Old warranty", Job: { ID: 9 }, Section: { ID: 900 }, CostCenter: { ID: 5, Name: "Residential (Warranty)" } },   // not this year's job
    ],
    "/jobs/1/sections/101/costCenters/?columns=ID,Name,CostCenter,Totals&pageSize=250": [
      { ID: 12, Name: "Fan install", CostCenter: { ID: 5, Name: "Residential (Warranty)" }, Totals: { ResourcesCost: { LaborHours: { Actual: 3, Estimate: 0 } } } },
      { ID: 13, Name: "Closet", CostCenter: { ID: 51, Name: "Residential - Change Order (Rough In)" }, Totals: { ResourcesCost: { LaborHours: { Actual: 0, Estimate: 0.94 } } } },
      { ID: 15, Name: "Other", CostCenter: { ID: 38, Name: "Residential (Rough In)" }, Totals: { ResourcesCost: { LaborHours: { Actual: 50, Estimate: 40 } } } },
    ],
    "/vendors/?pageSize=250&columns=ID,Name": [{ ID: 30, Name: "Home Depot" }, { ID: 97, Name: "ACE Hardware" }, { ID: 13, Name: "CED" }],
    "/vendorOrders/?pageSize=250&page=1&columns=ID,DateIssued,Vendor&Vendor.ID=30&DateIssued=between(2026-01-01,2026-12-31)": [vo(1, "2026-10-20", "Home Depot")],
    "/vendorOrders/?pageSize=250&page=1&columns=ID,DateIssued,Vendor&Vendor.ID=97&DateIssued=between(2026-01-01,2026-12-31)": [],
    "/employees/?pageSize=100&columns=ID,Name,Archived": [{ ID: 100, Name: "Keegan Wilkinson" }],
    "/employees/100/timesheets/?StartDate=2026-08-31&EndDate=2026-10-25": [ts("2026-10-06", 8)],
  };
  const get = async (p) => { seen.push(p); return p in fake ? fake[p] : null; };
  const r = await G.pullPhase2({ get, year: 2026, todayYmd: "2026-10-30", slim: [{ id: 1, hrs_act: 100 }], users: [{ name: "Keegan Wilkinson", title: "foreman" }, { name: "Ghost", title: "crew" }], appLog: [] });
  assert.ok(!seen.some(p => p.startsWith("/jobs/9/")), "a warranty cost center on a job not invoiced this year is never read");
  assert.ok(!seen.some(p => p.startsWith("/jobs/1/sections/100/")), "a plain Rough In section is never read");
  assert.deepStrictEqual([r.hours.warranty.hours, r.hours.warranty.sharePct, r.hours.co.ccs, r.hours.co.expected, r.hours.co.expectedWith, r.hours.listed, r.hours.sections], [3, 3, 1, 1, 0, 4, 1]);
  assert.deepStrictEqual([r.storeRuns.total, r.storeRuns.homeDepot, r.storeRuns.last8], [1, 1, 1]);
  assert.deepStrictEqual([r.weekly.weeksAll, r.weekly.of, r.weekly.peopleAll, r.weekly.unmatched, r.weekly.crew], [1, 8, 0, ["Ghost"], 2]);
  assert.deepStrictEqual(r.errors, [], "nothing failed");
  // one part failing leaves its key null and names it; the others still land
  const r2 = await G.pullPhase2({ get: async (p) => p.startsWith("/vendors") ? null : get(p), year: 2026, todayYmd: "2026-10-30", slim: [{ id: 1, hrs_act: 100 }], users: [], appLog: [] });
  assert.strictEqual(r2.storeRuns, null); assert.ok(r2.hours && r2.weekly, "hours and weekly still read"); assert.ok(r2.errors.some(e => /storeRuns/.test(e)), "the failure is named");
  console.log("goals-pull-test: all checks passed (incl. Phase 2)");
})().catch(e => { console.error(e); process.exit(1); });
