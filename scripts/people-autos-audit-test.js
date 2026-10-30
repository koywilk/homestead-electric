#!/usr/bin/env node
/* people-autos-audit-test.js — Dashboard audit, People + Automations tabs (SW v582): the pure parts in
 * src/App.js, compiled out by odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. BY CREW — every team member appears ONCE across the groups (the invariant); a crew's foreman is on
 *      top, then jr foremen, leads, crew; office (title admin) is its own group; "No crew" is last;
 *      a titled foreman with nobody under him still makes a one-person crew; empty groups are dropped.
 *   2. NAMES — a planner / Simpro name resolves the planner's own way: exact, unique first name,
 *      first + last initial; an ambiguous bare first name is never guessed.
 *   3. TODAY — a filled planner cell for today's column wins for that person (lead and crew, the lead not
 *      doubled); everyone else comes from Simpro's entries for today (two blocks on one job merge into one
 *      row with the span and the hours; two jobs sort by start time); yesterday's entries and quotes
 *      don't count; a weekend has nothing scheduled; a Simpro # with no app job still shows.
 *   4. TEXT — the Today column is "" when there is nothing, one line otherwise.
 *   5. LIVE SHAPE — odModel's own people + crews through odPeopleByCrew keep the invariant.
 *   6. RUNS — odPrevRun is the last scheduled pull at or before now (yesterday's when today's is still ahead).
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const thu = new Date(2026, 9, 29, 9, 0);     // Thursday 2026-10-29, local
const sat = new Date(2026, 9, 31, 9, 0);

// Same team as crews-model-test, plus an office person with no title, a second Jacob and a lone foreman.
const users = [
  { id: "koy", name: "Koy Wilkinson", title: "admin", access: "admin" },
  { id: "josh", name: "Josh Cloward", role: "admin" },
  { id: "dae", name: "Daegan Smith", title: "foreman", access: "manager" },
  { id: "kee", name: "Keegan Wilkinson", title: "foreman", access: "manager" },
  { id: "col", name: "Colby Fogh", title: "foreman", access: "manager" },
  { id: "zane", name: "Zane Watkins", title: "foreman", access: "manager" },
  { id: "paul", name: "Paul", title: "foreman", access: "contractor" },
  { id: "old", name: "Old Foreman", title: "foreman", active: false },
  { id: "lou", name: "Louis Hoffman", title: "jrforeman", foremanId: "dae" },
  { id: "tre", name: "Trever Worley", title: "lead", foremanId: "dae" },
  { id: "cal", name: "Callen Jakeman", title: "crew", foremanId: "dae" },
  { id: "gage", name: "Gage Lund", title: "jrforeman", foremanId: "kee" },
  { id: "jac", name: "Jacob Spackman", title: "jrforeman", foremanId: "col" },
  { id: "jac2", name: "Jacob Bingham", title: "crew", foremanId: "col" },
  { id: "jer", name: "Jeromy Cloward", title: "crew" },                 // on the team, on no crew
  { id: "gone", name: "Gone Guy", title: "crew", foremanId: "dae", active: false },
];
const cr = X.odCrews(users);

// 1. BY CREW
const titleOf = (u) => u.title || (["admin"].includes(u.role) ? "admin" : "crew");
const people = users.filter(u => u.active !== false && u.access !== "contractor").map(u => ({ name: u.name, title: titleOf(u), status: "active" }));
const groups = X.odPeopleByCrew(people, cr.crews);
const flat = groups.flatMap(g => g.rows.map(r => r.name));
eq(flat.length, people.length, "every person listed");
eq(new Set(flat.map(n => n.toLowerCase())).size, flat.length, "every name once");
eq(groups.map(g => g.label), ["Colby's crew", "Daegan's crew", "Keegan's crew", "Zane's crew", "Office", "No crew"], "crews alphabetical, then Office, then No crew last");
eq(groups.map(g => g.n), [3, 4, 2, 1, 2, 1]);
const daeG = groups.find(g => g.label === "Daegan's crew");
eq(daeG.rows.map(r => r.name), ["Daegan Smith", "Louis Hoffman", "Trever Worley", "Callen Jakeman"], "foreman, jr foreman, lead, crew");
eq(daeG.rows.map(r => r.tierLabel), ["Foreman", "Jr foreman", "Lead", "Crew"]);
eq(daeG.rows[0].isForeman, true); eq(daeG.rows[1].isForeman, false);
eq(groups.find(g => g.label === "Zane's crew").rows.map(r => r.name), ["Zane Watkins"], "a foreman with nobody under him is still a crew");
eq(groups.find(g => g.label === "Office").rows.map(r => r.name), ["Josh Cloward", "Koy Wilkinson"], "office by title admin, role admin counts");
eq(groups.find(g => g.label === "No crew").rows.map(r => r.name), ["Jeromy Cloward"]);
eq(X.odPeopleByCrew([{ name: "Daegan Smith", title: "foreman" }, { name: "daegan smith", title: "foreman" }], cr.crews).map(g => g.n), [1], "a duplicate team record collapses");
eq(X.odPeopleByCrew([], cr.crews), [], "nothing on the team → no groups");

// 2. NAMES
eq(X.odPlannerPerson("Louis Hoffman", users).id, "lou");
eq(X.odPlannerPerson("  louis hoffman ", users).id, "lou", "exact ignores case and spaces");
eq(X.odPlannerPerson("Louis", users).id, "lou", "unique first name");
eq(X.odPlannerPerson("Jacob", users), null, "two Jacobs: never guessed");
eq(X.odPlannerPerson("Jacob S.", users).id, "jac", "last initial picks one");
eq(X.odPlannerPerson("Jacob B", users).id, "jac2");
eq(X.odPlannerPerson("Old Foreman", users), null, "deactivated people don't resolve");
eq(X.odPlannerPerson("", users), null);
eq(X.odPlannerMonday(thu), "2026-10-26"); eq(X.odPlannerMonday(new Date(2026, 10, 1)), "2026-10-26", "Sunday belongs to the week before");
eq(X.odPlannerDayIdx(thu), 3); eq(X.odPlannerDayIdx(sat), -1);

// 3. TODAY
const jobs = [
  { id: "j1", name: "Casten-Vaught", simproNo: "1327" },
  { id: "j2", name: "Brandt Residence", simproNo: "1430" },
  { id: "q1", name: "Quote for Oak Hill", simproNo: "1454", isQuote: true },
  { id: "j3", name: "Oak Hill 5", simproNo: "1454" },
];
const cells = {
  "j2_3": { lead: "Louis", crew: ["Louis Hoffman", "Callen", "Jacob"], time: "7:00" },   // Thursday: Louis both ways, an ambiguous Jacob
  "j1_2": { lead: "Trever Worley", crew: [] },                                              // Wednesday — not today
  "j1_3": { lead: "", crew: [] },                                                           // empty cell
};
const simpro = [
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Gage Lund" }, Project: { ProjectID: 1430 }, Blocks: [{ Hrs: 2.1, StartTime: "06:55", EndTime: "09:00" }] },
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Gage Lund" }, Project: { ProjectID: 1327 }, Blocks: [{ Hrs: 4, StartTime: "08:10", EndTime: "12:10" }, { Hrs: 4.3, StartTime: "12:40", EndTime: "16:29" }] },
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Daegan Smith" }, Project: { ProjectID: 1327 }, Blocks: [{ Hrs: 7, StartTime: "06:26", EndTime: "13:39" }] },
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Daegan Smith" }, Project: { ProjectID: 1327 }, Blocks: [{ Hrs: 4.2, StartTime: "13:54", EndTime: "18:05" }] },
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Louis Hoffman" }, Project: { ProjectID: 1454 }, Blocks: [{ Hrs: 8, StartTime: "07:00", EndTime: "15:00" }] },   // planner wins for Louis
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Keegan Wilkinson" }, Project: { ProjectID: 1454 }, Blocks: [{ Hrs: 0.8, StartTime: "09:25", EndTime: "10:12" }] },
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Zane Watkins" }, Project: { ProjectID: 9999 }, Blocks: [{ Hrs: 8, StartTime: "07:00", EndTime: "15:00" }] },        // no app job
  { Type: "job", Date: "2026-10-29", Staff: { Name: "Someone New" }, Project: { ProjectID: 1327 }, Blocks: [] },                                                         // not on the team
  { Type: "job", Date: "2026-10-28", Staff: { Name: "Colby Fogh" }, Project: { ProjectID: 1327 }, Blocks: [{ Hrs: 8, StartTime: "07:00", EndTime: "15:00" }] },         // yesterday
  { Type: "activity", Date: "2026-10-29", Staff: { Name: "Colby Fogh" }, Project: { ProjectID: 1327 }, Blocks: [] },                                                     // not a job
];
const t = X.odTodayByPerson({ cells, simpro, now: thu, jobs, users });
eq([t.dayIdx, t.weekend, t.today], [3, false, "2026-10-29"]);
eq(t.rows["louis hoffman"], [{ jobId: "j2", no: "1430", jobName: "Brandt Residence", role: "lead", time: "7:00", start: "", end: "", hrs: null, from: "planner" }], "planner lead, keyed by the team name, not doubled by the crew list, Simpro ignored");
eq(t.rows["callen jakeman"].map(r => [r.jobName, r.role]), [["Brandt Residence", "crew"]], "a bare unique first name in a cell resolves");
eq(t.rows["jacob"].map(r => r.from), ["planner"], "an ambiguous name stays as typed"); eq(t.offTeam, ["Jacob", "Someone New"]);
eq(t.rows["gage lund"].map(r => [r.jobName, r.start, r.end, r.hrs]), [["Brandt Residence", "06:55", "09:00", 2.1], ["Casten-Vaught", "08:10", "16:29", 8.3]], "two jobs by start time; two blocks on one job merge");
eq(t.rows["daegan smith"].map(r => [r.jobName, r.start, r.end, r.hrs]), [["Casten-Vaught", "06:26", "18:05", 11.2]], "two entries on one job merge into one row");
eq(t.rows["keegan wilkinson"][0].jobId, "j3", "a Simpro # shared with a quote joins the job");
eq(t.rows["zane watkins"][0].jobName, "Simpro #9999", "no app job: the number shows");
eq(t.rows["colby fogh"], undefined, "yesterday and non-job entries don't count");
eq(t.rows["trever worley"], undefined, "Wednesday's cell is not today");
eq(X.odTodayByPerson({ cells, simpro, now: sat, jobs, users }).weekend, true); eq(Object.keys(X.odTodayByPerson({ cells, simpro, now: sat, jobs, users }).rows), []);
eq(Object.keys(X.odTodayByPerson({ now: thu }).rows), [], "nothing loaded → nothing scheduled, no throw");

// 4. TEXT
eq(X.odTodayText(t.rows["louis hoffman"]), "Brandt Residence (lead) 7:00");
eq(X.odTodayText(t.rows["gage lund"]), "Brandt Residence 6:55 AM–9:00 AM, then Casten-Vaught 8:10 AM–4:29 PM");
eq(X.odTodayText(t.rows["daegan smith"]), "Casten-Vaught 6:26 AM–6:05 PM");
eq(X.odTodayText(undefined), ""); eq(X.odTodayText([]), "");
eq(X.odClock("00:05"), "12:05 AM"); eq(X.odClock("12:00"), "12:00 PM"); eq(X.odClock("bad"), "");

// 5. LIVE SHAPE — odModel's people and crews through the grouper.
const base = { roughPunch: {}, finishPunch: {}, qcPunch: {}, changeOrders: [], returnTrips: [], prepDone: true, roughStatus: "inprogress", roughStage: "40%" };
const d = X.odModel({ jobs: [{ ...base, id: "a1", name: "Ashcraft", foreman: "Daegan Smith", lead: "Louis Hoffman", simproNo: "1" }], users, needs: [], upcoming: [], now: thu });
const g2 = X.odPeopleByCrew(d.people, d.crews);
const names2 = g2.flatMap(g => g.rows.map(r => r.name));
eq(names2.length, d.people.length, "odModel's people all land"); eq(new Set(names2).size, names2.length, "…once");
eq(g2[g2.length - 1].label, "No crew"); eq(g2.find(g => g.label === "Daegan's crew").rows[0].name, "Daegan Smith");

// 6. RUNS — Appliance Loads pulls at 06:58 UTC.
const appl = [[6, 58]];
eq(X.odPrevRun(appl, new Date(Date.UTC(2026, 9, 29, 12, 0))).toISOString(), "2026-10-29T06:58:00.000Z", "today's, once it has passed");
eq(X.odPrevRun(appl, new Date(Date.UTC(2026, 9, 29, 3, 0))).toISOString(), "2026-10-28T06:58:00.000Z", "yesterday's while today's is ahead");

console.log("people-autos-audit-test: ok (6 groups of checks)");
