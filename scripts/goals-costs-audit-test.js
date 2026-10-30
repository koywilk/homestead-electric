#!/usr/bin/env node
/* goals-costs-audit-test.js — Dashboard audit, Goals + Job Costs (SW v583), the pure parts in
 * src/App.js compiled out by odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. PENDING — without settings/goalsSimpro.phase2 the four Phase 2 cards are pending with their
 *      own words ("No Phase 2 pull yet"), never a number; with the Phase 1 doc alone the Goals model
 *      still lights the margin card and keeps the four out of `extra`.
 *   2. WARRANTY — share, tone bands (under 2% good, under 3% watch), the sub names hours and jobs.
 *   3. CO HOURS — "booked of sold-with-hours" headline, bands at 90% / 50%, material-only COs out.
 *   4. STORE RUNS — last-8-weeks rate is the headline, 2.8 a week is the goal, the app count is a sub-line.
 *   5. WEEKLY — weeks with everyone logged, who missed, idle and unmatched people named.
 *   6. SHEET MATCH — the sheet's four measure names land on the four new cards and on nothing else;
 *      the old cards still match their rows.
 *   7. OVERRUNS — open jobs past rough hours, most over first; invoiced and Josh-counted jobs out;
 *      top five + rest; owners by d.owns (foreman first, lead second, inactive names out).
 *   8. CO COLUMN — per-job CO hours map from the pull; null (column hidden) without it.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let passed = 0;
const t = (name, f) => { f(); passed++; };

const sim1 = { generated_at: "2026-10-30T11:40:07.505Z", year: 2026, jobs: [{ id: 1, tech: "Keegan Wilkinson", inv_pct: 100, nm_act: 12, npl_act: 1200, contract: 10000, hrs_act: 130, hrs_est: 100, mat_act: 1, lab_act: 1 }], invoices: { byDivision: { commercial: 0, residential: 1000, other: 0 }, paid: { n: 1, avgDays: 30, medianDays: 30 }, open: {} } };
const phase2 = {
  generated_at: "2026-10-30T12:00:00Z", year: 2026,
  hours: { allHours: 53811.2, warranty: { hours: 1205.8, estHours: 71.6, ccs: 81, withHours: 72, expected: 8, expectedWith: 8, jobs: 51, byJob: {}, sharePct: 2.2 },
    co: { hours: 697.5, estHours: 2068.5, ccs: 436, withHours: 39, expected: 393, expectedWith: 33, jobs: 65, byJob: { 1107: 12.5, 535: 0 } } },
  storeRuns: { year: 2026, total: 171, homeDepot: 135, ace: 36, app: 1, perWeek: 4, last8: 33, last8PerWeek: 4.1, byWeek: [8, 4, 3, 5, 5, 4, 2, 2] },
  weekly: { weeks: [{ start: "2026-10-12", end: "2026-10-18", logged: 17, of: 18, all: false, missed: ["Colby Fogh"] }, { start: "2026-10-19", end: "2026-10-25", logged: 18, of: 18, all: true, missed: [] }], weeksAll: 1, of: 2, sharePct: 50,
    people: [{ name: "Colby Fogh", weeksLogged: 1, hours: 31 }, { name: "Keegan Wilkinson", weeksLogged: 2, hours: 100 }], peopleAll: 1, idle: ["Jeromy Cloward", "Joel Fey"], unmatched: ["New Guy"], crew: 21 },
  errors: [],
};
const sim2 = { ...sim1, phase2 };

t("pending without phase2", () => {
  [X.odGoalWarranty, X.odGoalCoHours, X.odGoalStoreRuns, X.odGoalHoursWeekly].forEach(f => {
    const r = f(sim1); eq([r.pending, r.pendingText, r.value, r.tone], [true, "No Phase 2 pull yet", "—", "grey"], f.name + " pends");
    eq(f(null).pending, true, f.name + " with no doc at all"); eq(f({ phase2: "junk" }).pending, true, f.name + " with a bad phase2");
  });
  const m = X.odGoalsModel({ sheet: { measures: [{ row: 1, name: "Warranty hours (share of all job hours)" }, { row: 2, name: "Job margin (completed jobs)" }] }, sim: sim1, sb: null, d: null, plans: null, now: new Date(2026, 9, 30) });
  eq(m.measures[0].key, "warranty"); eq(m.measures[0].live.pending, true); eq(m.measures[0].rule, "", "no rule text while pending");
  eq(m.measures[1].live.value, "12%", "Phase 1 card still lights up");
  eq(m.extra.map(e => e.key).filter(k => ["warranty", "coHours", "storeRuns", "hoursWeekly"].includes(k)), [], "pending Phase 2 cards never land in extra");
  eq(m.counts.tracked, 1, "a pending card is not tracked");
});

t("warranty", () => {
  const r = X.odGoalWarranty(sim2);
  eq([r.pending, r.value, r.tone], [undefined, "2.2%", "warn"]);
  assert.ok(/1205\.8 h on warranty/.test(r.sub) && /53811\.2 h/.test(r.sub) && /72 of 81/.test(r.sub) && /51 jobs/.test(r.sub) && /invoiced in 2026/.test(r.sub), r.sub);
  assert.ok(/Residential \(Warranty\)/.test(r.rule));
  const w = (sharePct) => X.odGoalWarranty({ ...sim2, phase2: { ...phase2, hours: { ...phase2.hours, warranty: { ...phase2.hours.warranty, sharePct } } } });
  eq([w(1.9).tone, w(2).tone, w(2.9).tone, w(3).tone, w(null).tone, w(null).value], ["good", "warn", "warn", "bad", "grey", "—"]);
  assert.ok(w(1).bar === 1 && w(4).bar === 0.5, "bar is goal ÷ share, capped at 1");
  assert.ok(/carried from an earlier pull/.test(X.odGoalWarranty({ ...sim2, phase2: { ...phase2, carried: true } }).sub), "a carried-forward phase2 says so");
});

t("co hours", () => {
  const r = X.odGoalCoHours(sim2);
  eq([r.value, r.tone, r.bar], ["33 of 393", "bad", 0.08]);
  assert.ok(/697\.5 h booked of 2068\.5 h sold/.test(r.sub) && /436 CO cost centers on 65 jobs/.test(r.sub), r.sub);
  const c = (expected, expectedWith, ccs = 10, withHours = 2) => X.odGoalCoHours({ ...sim2, phase2: { ...phase2, hours: { ...phase2.hours, co: { ...phase2.hours.co, expected, expectedWith, ccs, withHours } } } });
  eq([c(10, 9).tone, c(10, 5).tone, c(10, 4).tone], ["good", "warn", "bad"]);
  eq([c(0, 0).tone, c(0, 0).value], ["grey", "2 of 10"], "no CO sold with hours: grey, falls back to any-hours count");
  eq(c(0, 0, 0, 0).value, "0");
});

t("store runs", () => {
  const r = X.odGoalStoreRuns(sim2);
  eq([r.value, r.tone], ["4.1 a week", "bad"]);
  assert.ok(/171 Home Depot \/ ACE purchase orders in 2026 \(135 Home Depot, 36 ACE\)/.test(r.sub) && /4 a week for the year/.test(r.sub) && /1 raised from the app/.test(r.sub), r.sub);
  const s = (last8PerWeek) => X.odGoalStoreRuns({ ...sim2, phase2: { ...phase2, storeRuns: { ...phase2.storeRuns, last8PerWeek } } });
  eq([s(2.8).tone, s(2.9).tone, s(4).tone, s(4.1).tone, s(0).tone], ["good", "warn", "warn", "bad", "good"]);
  assert.ok(s(1.4).bar === 1 && s(5.6).bar === 0.5);
});

t("weekly", () => {
  const r = X.odGoalHoursWeekly(sim2);
  eq([r.value, r.tone, r.bar], ["1 of 2 weeks", "warn", 0.5]);
  assert.ok(/1 of 2 people logged all 2/.test(r.sub) && /weeks missed: Colby 1/.test(r.sub) && /no Simpro hours at all: Jeromy, Joel/.test(r.sub) && /not found in Simpro: New/.test(r.sub), r.sub);
  const w = (sharePct, weeksAll) => X.odGoalHoursWeekly({ ...sim2, phase2: { ...phase2, weekly: { ...phase2.weekly, sharePct, weeksAll, weeks: [] } } });
  eq([w(100, 8).tone, w(50, 4).tone, w(49, 3).tone, w(0, 0).tone, w(null, 0).value], ["good", "warn", "bad", "bad", "—"]);
  assert.ok(!/weeks missed/.test(w(100, 8).sub), "nothing missed, nothing said");
});

t("sheet names land on the right cards", () => {
  const names = ["Warranty hours (share of all job hours)", "Change orders with hours booked to their own cost center", "Home Depot / ACE runs", "Jobs with hours tracked weekly",
    "Job margin (completed jobs, after labor and material)", "Commercial projects (share of our work)", "Hours vs estimate, company", "Hours vs estimate, every foreman", "Days to collect on our invoices", "Shop and inventory"];
  const keys = names.map(n => { const e = X.OD_GOAL_LIVE.find(x => x.test.test(n)); return e ? e.key : ""; });
  eq(keys, ["warranty", "coHours", "storeRuns", "hoursWeekly", "margin", "commercial", "hoursCompany", "hoursForeman", "collect", ""]);
  const m = X.odGoalsModel({ sheet: { measures: names.map((n, i) => ({ row: i + 1, name: n })) }, sim: sim2, sb: null, d: null, plans: null, now: new Date(2026, 9, 30) });
  eq(m.measures.slice(0, 4).map(x => x.live.value), ["2.2%", "33 of 393", "4.1 a week", "1 of 2 weeks"]);
  assert.ok(m.measures.slice(0, 4).every(x => x.rule.length > 40), "every Phase 2 card has a How-it-is-counted rule");
  eq(m.counts.tracked, 9); eq(m.extra.length, 0, "all nine live cards are on the sheet");
});

t("rough overruns", () => {
  const r = (no, status, used, est, extra = {}) => ({ no: String(no), name: "Job " + no, status, rough_hrsUsed: used, rough_hrsEst: est, ...extra });
  const rows = [
    r(1107, "Rough-In Complete", 1248.5, 394.4, { boardForeman: "Keegan Wilkinson", lead: "Keegan Wilkinson", jobId: "a" }),
    r(535, "Rough-In Complete", 1569.1, 729, { boardForeman: "Colby Fogh", lead: "Colby Fogh" }),
    r(1291, "Rough-In Complete", 920.1, 553.1, { boardForeman: "Daegan Smith", lead: "Louis Hoffman" }),
    r(959, "Rough-In Complete", 2469.5, 2102.7), r(1438, "Rough-In", 1044.5, 782.5), r(889, "Material Deposit Paid", 748.2, 486.3), r(1454, "Rough-In", 938.6, 680.1),
    r(2000, "Invoiced", 900, 100), r(2001, "Punch List", 900, 100, { josh: { counts: true } }), r(2002, "Rough-In", 90, 100), r(2003, "Rough-In", 50, 0), r(2004, "Scheduled", 0, 100),
  ];
  const o = X.odCostsRoughOverruns(rows);
  eq(o.all.map(x => x.no), ["1107", "535", "1291", "959", "1438", "889", "1454"], "open jobs past rough only, most hours over first; invoiced, Josh-counted, under, no-estimate and not-started out");
  eq([o.top.length, o.rest.map(x => x.no)], [5, ["889", "1454"]]);
  eq([o.all[0].over, o.all[0].pct > 3.16 && o.all[0].pct < 3.17, o.all[0].foreman, o.all[0].lead, o.all[0].jobId], [854.1, true, "Keegan Wilkinson", "Keegan Wilkinson", "a"]);
  eq(X.odCostsRoughOverruns(rows, 2).top.length, 2); eq(X.odCostsRoughOverruns([]).all, []); eq(X.odCostsRoughOverruns(null).top, []);
  // owners through d.owns
  const users = [{ name: "Keegan Wilkinson", title: "foreman", id: "k" }, { name: "Daegan Smith", title: "foreman", id: "d" }, { name: "Louis Hoffman", title: "jrforeman", foremanId: "d" }, { name: "Colby Fogh", title: "foreman", active: false }];
  const { owns } = X.odCrews(users);
  eq(X.odCostsOwners(o.all[0], users, owns), ["Keegan Wilkinson"], "foreman = lead: one name");
  eq(X.odCostsOwners(o.all[2], users, owns), ["Daegan Smith", "Louis Hoffman"], "foreman first, lead second");
  eq(X.odCostsOwners(o.all[1], users.filter(u => u.active !== false), owns), ["Colby Fogh"], "nobody active owns it: the board's names still show");
  eq(X.odCostsOwners(o.all[3], users, owns), [], "no names on the board");
  eq(X.odCostsOwners(o.all[2], users, null), ["Daegan Smith", "Louis Hoffman"], "no owns function: the board's names");
});

t("co hours column", () => {
  eq(X.odCostsCoHours(sim1), null, "no phase2: no column");
  eq(X.odCostsCoHours(null), null);
  const m = X.odCostsCoHours(sim2);
  eq([m.get("1107"), m.get("535"), m.has("999")], [12.5, 0, false], "keyed by Simpro number as a string; 0 is a real value (COs with nothing booked)");
});

console.log(`goals-costs-audit-test: all ${passed} checks passed`);
