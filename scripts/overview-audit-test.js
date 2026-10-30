#!/usr/bin/env node
/* overview-audit-test.js — the Overview tab audit (SW v579, dashboard audit 2026-10-30).
 * Compiles the SHIPPED dashboard helpers out of src/App.js (makeSandbox from
 * odash-model-test.js) and proves the three pure helpers the Overview tab gained,
 * plus a static check that the trimmed tiles are gone from the Overview branch.
 *
 *   1. TODAY BY CREW — settings/schedule_<monday>.assignments["<jobId>_<dayIdx>"]
 *      = { lead, crew[] } (Mon=0 … Fri=4, the cells crewOnSiteToday reads) grouped
 *      by Settings › Team crews (foremanId); first-name-only cells resolve when the
 *      first name is unique; a mixed job sits under each crew with that crew's names;
 *      people on no crew go under Others; weekend / no doc / no cell today → empty.
 *   2. STARTS THIS WEEK NOT CONFIRMED — Mon–Sun week holding now, type "start",
 *      the same `confirmed` flag the Job Board / Up Next / Schedule read.
 *   3. MONEY AT RISK — the 60+ day CO rows: count, jobs, dollars with each Simpro
 *      quote once (Thayne: 14 COs on one quote), rows with no quote $ counted apart.
 *   4. TRIM — the Overview branch no longer renders the punch mini, the activity
 *      chart, the open-CO tile or the inspections mini, and does render the strip.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeSandbox } = require("./odash-model-test.js");
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

const X = makeSandbox();
const users = [
  { id: "koy", name: "Koy Wilkinson", title: "admin", access: "admin" },
  { id: "daegan", name: "Daegan Smith", title: "foreman" },
  { id: "louis", name: "Louis Hoffman", title: "lead", foremanId: "daegan" },
  { id: "trever", name: "Trever Jones", title: "crew", foremanId: "daegan" },
  { id: "keegan", name: "Keegan Wilkinson", title: "foreman" },
  { id: "gage", name: "Gage Lund", title: "jrforeman", foremanId: "keegan" },
  { id: "austin1", name: "Austin Schut", title: "crew", foremanId: "keegan" },
  { id: "austin2", name: "Austin Price", title: "crew", foremanId: "daegan" },   // an Austin on each crew: a bare "Austin" is no one person
  { id: "sub", name: "Sub Guy", title: "crew" },                                 // on the team, on no crew
];
const cr = X.odCrews(users);
const base = { roughPunch: {}, finishPunch: {}, qcPunch: {}, changeOrders: [], returnTrips: [], prepDone: true };
const jobs = [
  { ...base, id: "j1", name: "Webb", foreman: "Daegan Smith", roughStatus: "inprogress", roughStage: "40%" },
  { ...base, id: "j2", name: "Miller", foreman: "Keegan Wilkinson", roughStatus: "inprogress", roughStage: "60%" },
  { ...base, id: "j3", name: "Kweller", foreman: "Daegan Smith", roughStatus: "inprogress", roughStage: "20%" },
  { ...base, id: "j4", name: "Quiet one", foreman: "Keegan Wilkinson", roughStatus: "" },
];

// 1. TODAY BY CREW — Wednesday Oct 28 2026 (dayIdx 2).
const wed = new Date(2026, 9, 28, 9, 0);
const planner = { assignments: {
  "j1_2": { lead: "Daegan Smith", crew: ["Trever", "Louis Hoffman", "Daegan Smith"] },   // lead repeated in crew: once
  "j2_2": { lead: "Keegan Wilkinson", crew: ["Gage Lund", "Austin", "Sub Guy", "Trever"] }, // Austin ambiguous; Sub on no crew; Trever from Daegan's crew
  "j3_1": { lead: "Louis Hoffman", crew: [] },                                              // Tuesday: not today
  "j9_2": { lead: "", crew: [] },                                                           // empty cell: nobody
  "x1_2": { lead: "Gage Lund", crew: [] },                                                  // extra job (not on the Job Board)
}, extraJobs: [{ id: "x1", name: "Shop day" }] };
const t = X.odTodayByCrew({ planner, jobs, crews: cr.crews, now: wed });
assert.strictEqual(t.empty, false); assert.strictEqual(t.dayIdx, 2);
eq(t.groups.map(g => [g.label, g.rows.map(r => `${r.name}: ${r.names.join(", ")}`)]),
  [["Daegan's crew", ["Miller: Trever Jones", "Webb: Daegan Smith, Trever Jones, Louis Hoffman"]], ["Keegan's crew", ["Miller: Keegan Wilkinson, Gage Lund", "Shop day: Gage Lund"]]],
  "grouped by Settings › Team crew, lead first, a mixed job under each crew with that crew's names, first names resolved, the lead counted once");
eq(t.other.map(r => `${r.name}: ${r.names.join(", ")}`), ["Miller: Austin, Sub Guy"], "a first name that could be on two crews, and a person on no crew, land under Others as written");
eq(t.unscheduled.map(j => j.name), ["Kweller", "Quiet one"], "active jobs with nobody on them today (a Tuesday cell does not count)");
eq([t.jobsN, t.peopleN], [3, 7], "3 jobs, 7 different people (Trever once)");
assert.strictEqual(X.odTodayByCrew({ planner, jobs, crews: cr.crews, now: new Date(2026, 9, 31, 9) }).empty, true, "Saturday: nothing");
assert.strictEqual(X.odTodayByCrew({ planner, jobs, crews: cr.crews, now: new Date(2026, 9, 29, 9) }).empty, true, "Thursday with no cells: nothing");
assert.strictEqual(X.odTodayByCrew({ planner: null, jobs, crews: cr.crews, now: wed }).empty, true, "no week doc: nothing");
eq(X.odTodayByCrew({ planner: null, jobs, crews: cr.crews, now: wed }).unscheduled.length, 0, "with nothing planned the unscheduled list is not offered");
assert.strictEqual(X.odPlannerMonday(wed), "2026-10-26"); assert.strictEqual(X.odPlannerMonday(new Date(2026, 10, 1, 9)), "2026-10-26", "Sunday still belongs to the Monday before");

// 2. STARTS THIS WEEK NOT CONFIRMED — now = Fri Oct 30 2026; the week is Mon 10/26 … Sun 11/1.
const fri = new Date(2026, 9, 30, 9, 0);
const sj = (id, name, extra) => ({ ...base, id, name, foreman: "Daegan Smith", roughStatus: "waiting_date", ...extra });
const sjobs = [
  sj("s1", "Monday past", { roughProjectedStart: "10/26/2026" }),                                  // earlier this week, unconfirmed → in
  sj("s2", "Wed confirmed", { roughProjectedStart: "10/28/2026", roughStartConfirmed: true }),      // confirmed → out
  sj("s3", "Thu by status", { roughProjectedStart: "10/29/2026", roughStatus: "date_confirmed" }), // confirmed by status → out
  sj("s4", "Sunday", { roughProjectedStart: "11/1/2026" }),                                        // Sunday is still this week → in
  sj("s5", "Next Monday", { roughProjectedStart: "11/2/2026" }),                                   // next week → out
  sj("s6", "Finish start", { roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "10/31/2026" }), // Saturday finish → in
];
const up = [{ name: "Up Peterson", projectedStart: "10/27/2026" }, { name: "Up confirmed", projectedStart: "10/27/2026", startConfirmed: true }, { name: "Up next week", projectedStart: "11/4/2026" }];
const sd = X.odModel({ jobs: sjobs, users, needs: [], upcoming: up, now: fri });
const wk = X.odStartsUnconfirmedWeek(sd.sched, fri);
eq(wk.map(s => `${s.name} ${s.label} ${s.at.getMonth() + 1}/${s.at.getDate()}`), ["Monday past Rough start 10/26", "Up Peterson Upcoming job start 10/27", "Finish start Finish start 10/31", "Sunday Rough start 11/1"], "Mon–Sun, oldest first, the Job Board's own confirmed flag, Upcoming jobs included");
eq(X.odWeekBounds(new Date(2026, 10, 1, 9)).mon.getDate(), 26, "a Sunday's week starts the Monday before");
eq(X.odStartsUnconfirmedWeek(sd.sched, new Date(2026, 10, 2, 9)).map(s => s.name), ["Next Monday", "Up next week"], "next Monday rolls the window");

// 3. MONEY AT RISK — each Simpro quote once, no-quote rows counted apart.
const old = (n) => new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() - n, 9).toISOString();
const mjobs = [
  { ...base, id: "m1", name: "Thayne", foreman: "Daegan Smith", roughStatus: "inprogress", roughStage: "50%", changeOrders: [
    { id: "c1", coStatus: "pending", submittedAt: old(136), desc: "Outlets 201", quoteNumber: "2968" },
    { id: "c2", coStatus: "pending", submittedAt: old(136), desc: "Outlets 209", quoteNumber: "#2968" },   // same quote, with a #
    { id: "c3", coStatus: "pending", submittedAt: old(70), desc: "Smokies" },                              // no quote number
    { id: "c4", coStatus: "pending", submittedAt: old(10), desc: "Fresh", quoteNumber: "3000" },           // 10 days: not 60+
    { id: "c5", coStatus: "approved", submittedAt: old(200), desc: "Approved", quoteNumber: "2500" } ] },  // not waiting on the GC
  { ...base, id: "m2", name: "Pierce", foreman: "Keegan Wilkinson", roughStatus: "inprogress", roughStage: "50%", changeOrders: [
    { id: "c6", coStatus: "pending", submittedAt: old(150), desc: "Underground", quoteNumber: "2925" },
    { id: "c7", coStatus: "pending", submittedAt: old(90), desc: "No $ yet", quoteNumber: "2999" } ] },    // quote # known, Simpro total not pulled
];
const md = X.odModel({ jobs: mjobs, users, needs: [], upcoming: [], now: fri, simTotals: { quotes: { "2968": { total: 2297.02 }, "2925": { total: 1956.59 }, "3000": { total: 500 } } } });
const m = X.odMoneyAtRisk(md.attnBy.coOld.rows);
eq(m, { n: 5, jobs: 2, dollars: 4253.61, quotes: 2, noQuote: 2 }, "5 COs on 2 jobs; $2,297.02 once for the two Thayne COs + $1,956.59; two rows carry no quote $");
eq(X.odMoneyAtRisk([]), { n: 0, jobs: 0, dollars: 0, quotes: 0, noQuote: 0 });
eq(X.odMoneyAtRisk(null), { n: 0, jobs: 0, dollars: 0, quotes: 0, noQuote: 0 });
// and the same dollars the existing extra line prints (the two must never disagree)
assert.ok(/quotes \$4\.3k/.test(md.attnBy.coOld.extra), "extra line: " + md.attnBy.coOld.extra);

// 4. TRIM — static: what the Overview branch renders.
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf('if (tab === "overview") {'), b = src.indexOf('} else if (tab === "jobs") {', a);
assert.ok(a > 0 && b > a, "Overview branch found");
const ov = src.slice(a, b);
for (const gone of ['title="Open punch items"', 'title="Inspections, 30 days"', 'title="Open change orders"', "Activity per day", "<OdLine "]) assert.ok(!ov.includes(gone), `Overview still renders: ${gone}`);
for (const kept of ["Needs you", "Needs attention", "Out this week", "Next 14 days", 'title="Active jobs"', "odTodayByCrew(", "odStartsUnconfirmedWeek(", "odMoneyAtRisk(", "Money at risk", "nobody scheduled today"]) assert.ok(ov.includes(kept), `Overview lost: ${kept}`);
// the Today strip sits right under Needs you, above the row with Needs attention
assert.ok(ov.indexOf("od-today") > ov.indexOf("od-needyou") && ov.indexOf("od-today") < ov.indexOf("Needs attention"), "Today strip is under Needs you and above Needs attention");
// no per-foreman stat above the fold: the Foremen cards come after the strip and the row
assert.ok(ov.indexOf(">Foremen</Sec>") > ov.indexOf("Needs attention"), "Foremen cards stay below");

console.log("overview-audit-test: all checks passed");
