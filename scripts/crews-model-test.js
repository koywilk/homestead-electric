#!/usr/bin/env node
/* crews-model-test.js — Dashboard by crew (SW v571): the pure parts in src/App.js, compiled out by
 * odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. CREWS — a crew is a titled foreman plus everyone whose `foremanId` on Settings › Team points at him;
 *      Paul (SBV2_EXCLUDE_NAME) and deactivated people never make one; labels are "<First>'s crew".
 *   2. OWNERSHIP — a job is a person's as foreman OR as lead; a job sits in ONE crew: its foreman's, else its
 *      lead's when the foreman is on no crew; a job nobody on a crew runs is on no crew.
 *   3. MODEL — the picker value "crew:<id>" filters the dashboard to the crew's jobs; a lead's name (Louis)
 *      filters to every job he runs; leads named on a job but not on the foreman roster are offered;
 *      crewGroups holds each active job once; noCrewJobs is the rest.
 *   4. JOB COSTS — odCostsByCrew counts each job once per crew (technician's crew, else lead's) while a
 *      person's row holds every job they run as technician or as lead; "No crew" catches the rest.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const now = new Date(2026, 9, 28, 8, 0);

const users = [
  { id: "koy", name: "Koy Wilkinson", title: "admin", access: "admin" },
  { id: "dae", name: "Daegan Smith", title: "foreman", access: "manager" },
  { id: "kee", name: "Keegan Wilkinson", title: "foreman", access: "manager" },
  { id: "col", name: "Colby Fogh", title: "foreman", access: "manager" },
  { id: "paul", name: "Paul", title: "foreman", access: "contractor" },
  { id: "old", name: "Old Foreman", title: "foreman", active: false, foremanId: "" },
  { id: "lou", name: "Louis Hoffman", title: "jrforeman", foremanId: "dae" },
  { id: "tre", name: "Trever Worley", title: "lead", foremanId: "dae" },
  { id: "cal", name: "Callen Jakeman", title: "crew", foremanId: "dae" },
  { id: "gage", name: "Gage Lund", title: "jrforeman", foremanId: "kee" },
  { id: "jac", name: "Jacob Spackman", title: "jrforeman", foremanId: "col" },
  { id: "gone", name: "Gone Guy", title: "crew", foremanId: "dae", active: false },
];

// 1. CREWS
const cr = X.odCrews(users);
eq(cr.crews.map(c => c.foreman), ["Colby Fogh", "Daegan Smith", "Keegan Wilkinson"], "titled foremen, alphabetical; Paul and the deactivated one left out");
const dae = cr.crews.find(c => c.foreman === "Daegan Smith");
eq([dae.key, dae.label, dae.people], ["crew:dae", "Daegan's crew", ["Daegan Smith", "Louis Hoffman", "Trever Worley", "Callen Jakeman"]], "a deactivated member is not on the crew");
eq(dae.members.map(m => m.title), ["jrforeman", "lead", "crew"]);
eq(cr.crewOf("louis hoffman").foreman, "Daegan Smith", "name match ignores case");
eq(cr.crewOf("Paul"), null); eq(cr.crewOf(""), null);

// 2. OWNERSHIP
const base = { roughPunch: {}, finishPunch: {}, qcPunch: {}, changeOrders: [], returnTrips: [], prepDone: true };
const tj = (id, name, foreman, lead, extra = {}) => ({ ...base, id, name, foreman, lead, simproNo: id.replace(/\D/g, "") || "1", roughStatus: "inprogress", roughStage: "40%", ...extra });
const jobs = [
  tj("j1", "Ashcraft", "Daegan Smith", "Louis Hoffman"),          // Daegan's, Louis leads
  tj("j2", "Bridle Wood", "Daegan Smith", ""),
  tj("j3", "Rose", "Keegan Wilkinson", "Keegan Wilkinson"),
  tj("j4", "Tuhaye Hollow", "Colby Fogh", "Trever Worley"),       // Colby's job, Trever (Daegan's crew) leads: counts under Colby
  tj("j5", "Thayne", "Paul", "Lead TBD"),                         // no crew
  tj("j6", "Namjoshi", "Vasa Mataafa", "Louis Hoffman"),          // foreman on no crew → the lead's crew (Daegan's)
  tj("j7", "Finished one", "Daegan Smith", "", { roughStatus: "complete", finishStatus: "complete", archived: true }),
];
assert.ok(cr.owns(jobs[0], "Louis Hoffman") && cr.owns(jobs[0], "daegan smith") && !cr.owns(jobs[0], "Keegan Wilkinson"), "foreman or lead owns");
eq(cr.crewOfJob(jobs[0]).foreman, "Daegan Smith"); eq(cr.crewOfJob(jobs[3]).foreman, "Colby Fogh", "foreman's crew wins over the lead's");
eq(cr.crewOfJob(jobs[5]).foreman, "Daegan Smith", "foreman on no crew → the lead's crew"); eq(cr.crewOfJob(jobs[4]), null);

// 3. MODEL
const run = (foreman) => X.odModel({ jobs, users, needs: [], upcoming: [{ name: "Up Louis", foreman: "Vasa Mataafa", lead: "Louis Hoffman" }, { name: "Up Keegan", foreman: "Keegan Wilkinson" }], foreman, now });
const all = run("");
eq(all.crews.map(c => c.label), ["Colby's crew", "Daegan's crew", "Keegan's crew"]);
eq(all.crewGroups.map(g => [g.crew.first, g.jobs.map(j => j.name)]), [["Colby", ["Tuhaye Hollow"]], ["Daegan", ["Ashcraft", "Bridle Wood", "Namjoshi"]], ["Keegan", ["Rose"]]], "each active job once, in one crew");
eq(all.noCrewJobs.map(j => j.name), ["Thayne"]);
eq(all.leadsNamed, ["Trever Worley"], "a lead named on a job and not a titled foreman / jr foreman is offered in the picker");
assert.ok(all.foremen.includes("Louis Hoffman"), "a jr foreman is on the roster already");
const crew = run("crew:dae");
eq(crew.crewPick.label, "Daegan's crew");
eq(crew.active.map(j => j.name).sort(), ["Ashcraft", "Bridle Wood", "Namjoshi"], "a crew pick keeps the crew's jobs");
eq(crew.up.map(u => u.name), ["Up Louis"], "upcoming follows the crew through its lead");
const louis = run("Louis Hoffman");
eq(louis.active.map(j => j.name).sort(), ["Ashcraft", "Namjoshi"], "a lead's name keeps every job he runs");
eq(louis.up.map(u => u.name), ["Up Louis"]);
eq(run("Keegan Wilkinson").active.map(j => j.name), ["Rose"]);
eq(run(X.OD_NOFM).active.map(j => j.name), ["Thayne", "Namjoshi"], "No active foreman is unchanged: Vasa is not on the team, so Namjoshi is a no-foreman job even though its lead puts it on Daegan's crew");

// 4. JOB COSTS by crew (joined rows: foreman = Simpro technician, lead = Job Board lead)
const z = { rough_hrsUsed: 0, finish_hrsUsed: 0, other_hrsUsed: 0 };
const row = (no, foreman, lead, extra = {}) => ({ no: String(no), name: "Job " + no, status: "Rough-In", foreman, lead, josh: null, ...z, rough_hrsEst: 100, rough_hrsUsed: 120, ...extra });
const rows = [
  row(1, "Louis Hoffman", "Louis Hoffman"),            // Daegan's crew via Louis (technician)
  row(2, "Daegan Smith", "Louis Hoffman"),             // Daegan's crew; on Daegan's AND Louis's rows
  row(3, "Patrick Nielsen", "Louis Hoffman"),          // former crew technician → the lead's crew (Daegan's)
  row(4, "Colby Fogh", "Trever Worley"),               // Colby's crew (technician wins), also on Trever's row
  row(5, "", ""),                                      // nobody → No crew
  row(6, "Keegan Wilkinson", "", { rough_hrsUsed: 90 }),
];
const g = X.odCostsByCrew(rows, cr);
eq(g.map(x => [x.person, x.jobs]), [["Colby's crew", 1], ["Daegan's crew", 3], ["Keegan's crew", 1], ["No crew", 1]], "each job once per crew, the rest under No crew");
const dg = g.find(x => x.person === "Daegan's crew");
eq(dg.rough_hrs_pct, 1.2, "the crew's hours over its three jobs");
eq(dg.people.map(p => [p.person, p.title, p.jobs, p.asTech, p.asLead]), [["Daegan Smith", "foreman", 1, 1, 0], ["Louis Hoffman", "jrforeman", 3, 1, 2], ["Trever Worley", "lead", 1, 0, 1], ["Callen Jakeman", "crew", 0, 0, 0]],
  "a person's row holds every job they run as technician or as lead; Trever's lead job on Colby's crew still shows on his row");
eq(g.find(x => x.person === "Keegan's crew").rough_hrs_pct, 0.9);
eq(X.odCostsByCrew([], cr).map(x => x.jobs), [0, 0, 0], "no rows: every crew at 0, no No-crew group");

console.log("crews-model-test: all checks passed");
