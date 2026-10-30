#!/usr/bin/env node
/* schedule-quality-audit-test.js — Schedule and Quality tab audit (SW v581): the pure helpers above
 * OfficeDash in src/App.js, compiled out by odash-model-test's sandbox so what is tested is exactly
 * what ships.
 *
 * Proves:
 *   1. CREW COVERAGE — a start reads the Crew Planner cell for its job and weekday
 *      (settings/schedule_<monday>.assignments["<jobId>_<dayIdx>"], Mon=0 … Fri=4), lead first, then
 *      crew, then Simpro's scheduled staff for that Simpro # and day, one name per first name; nobody
 *      → "none" (red), a week not loaded → "loading", a weekend start and an Upcoming-tab start never
 *      read as "nobody".
 *   2. CALLED IN — an inspection is called in when its phase's target date is set (the field the office
 *      types when it books; the Jobs tab's "not called" rule); the to-call list is every job 85%+ into
 *      a phase with no target and no result, rough and final, finished / commercial / peds excluded.
 *   3. TIME OFF BY DAY — M/D/YYYY and ISO ranges, both ends inclusive, one name once, sorted, blank
 *      text on a free day.
 *   4. FIRST-PASS BY FOREMAN — the tab's firsts credited to every roster name who owns the job
 *      (foreman OR lead), "No foreman" for the rest, fewer-than-3 rows split out, percent rounded.
 *   5. RETURN-TRIP CAUSES — the stamped markers in fixed order; a hand-typed scope is "Added by hand";
 *      no marker and no scope is "No reason"; empty buckets are dropped.
 *   6. RE-INSPECTION BY DATE — only failed groups with a re-inspection date and no pass since, soonest
 *      first, grouped by day, late when the date passed.
 *   7. MODEL — on real-shaped jobs through odModel: a failed rough with a later target is in the
 *      re-inspection list and its job is NOT in the to-call list.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const now = new Date(2026, 9, 30, 8, 0);                       // Fri Oct 30 2026
const day = (n) => new Date(2026, 9, 30 + n);                  // local midnight, n days from now
const mdy = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 1. Crew coverage ------------------------------------------------------------------------------
eq(X.odMondayKey(new Date(2026, 9, 30)), "2026-10-26", "Friday → that week's Monday");
eq(X.odMondayKey(new Date(2026, 10, 1)), "2026-10-26", "Sunday belongs to the Monday before it");
eq(X.odMondayKey(new Date(2026, 10, 2)), "2026-11-02", "Monday is its own key");
const jA = { id: "a", name: "Webb", simproNo: "1304" }, jB = { id: "b", name: "Mangum", simproNo: "920" }, jC = { id: "c", name: "Rose" };
const mon = new Date(2026, 10, 2), tue = new Date(2026, 10, 3), sat = new Date(2026, 10, 7);
const starts = [
  { at: mon, type: "start", label: "Rough start", job: jA, name: "Webb" },
  { at: tue, type: "start", label: "Finish start", job: jB, name: "Mangum" },
  { at: tue, type: "start", label: "Rough start", job: jC, name: "Rose" },
  { at: sat, type: "start", label: "Rough start", job: jC, name: "Rose" },
  { at: mon, type: "start", label: "Upcoming job start", job: null, name: "Fratto" },
  { at: new Date(2026, 10, 10), type: "start", label: "Rough start", job: jA, name: "Webb" },   // week not loaded
];
const weeks = { "2026-11-02": { "a_0": { lead: "Louis Garcia", crew: ["Trever Jones", "louis garcia"] }, "b_1": { lead: "", crew: [] } }, "2026-10-26": null };
const simpro = X.odSimproStaffByDay([
  { Type: "job", Date: "2026-11-02", Project: { ProjectID: 1304 }, Staff: { Name: "Daegan Smith" } },
  { Type: "job", Date: "2026-11-02", Project: { ProjectID: 1304 }, Staff: { Name: "Daegan Smith" } },   // duplicate entry
  { Type: "job", Date: "2026-11-03", Project: { ProjectID: 920 }, Staff: { Name: "Gage Lund" } },
  { Type: "activity", Date: "2026-11-03", Project: { ProjectID: 920 }, Staff: { Name: "Not A Job" } },  // not a job entry
  { Type: "job", Date: "2026-11-03", Project: {}, Staff: { Name: "No Project" } },
]);
eq(simpro, { "1304": { "2026-11-02": ["Daegan Smith"] }, "920": { "2026-11-03": ["Gage Lund"] } }, "Simpro entries fold to job → day → unique names");
const cov = X.odStartCoverage(starts, weeks, simpro);
eq(cov[0].names, ["Louis Garcia", "Trever Jones", "Daegan Smith"], "lead, then crew (same first name once), then Simpro");
eq([cov[0].manualN, cov[0].simproN, cov[0].state, cov[0].text], [2, 1, "crew", "Crew: Louis, Trever, Daegan"], "counts and text");
eq([cov[1].state, cov[1].names], ["crew", ["Gage Lund"]], "an empty planner cell still shows Simpro's staff");
eq([cov[2].state, cov[2].none, cov[2].text], ["none", true, "Nobody assigned on the planner"], "no cell, no Simpro → nobody (red)");
eq([cov[3].state, cov[3].none, cov[3].text], ["weekend", false, "Weekend start"], "a Saturday start is never 'nobody'");
eq([cov[4].state, cov[4].none, cov[4].text], ["upcoming", false, "Not on the board yet"], "an Upcoming-tab start can't be on the planner");
eq([cov[5].state, cov[5].none], ["loading", false], "a week whose doc hasn't been read is 'loading', not 'nobody'");
eq(X.odStartCoverage(starts.slice(2, 3), {}, null)[0].state, "loading", "nothing loaded at all → loading");
eq(X.odStartCoverage(starts.slice(2, 3), { "2026-11-02": null }, null)[0].state, "none", "a week with no doc at all → nobody");

// 2. Called in ----------------------------------------------------------------------------------
const ic1 = X.odInspCalled({ fourWayTargetDate: "11/4/2026" }, "Rough");
eq([ic1.called, ic1.text], [true, "Called in · 11/4"], "a 4-way target date means the rough was called in");
eq(X.odInspCalled({ fourWayTargetDate: "11/4/2026" }, "Final").called, false, "the final reads its own target");
eq(X.odInspCalled({ finalInspectionTargetDate: "11/9/2026", finalInspectionResult: "fail" }, "Final").result, "fail", "carries the result");
const secOf = (j) => j.sec ? { key: j.sec } : null;
const toCall = X.odInspToCall([
  { name: "Rose", sec: "rough", roughStage: "90%" },                                            // to call: rough
  { name: "Webb", sec: "rough", roughStage: "90%", fourWayTargetDate: "11/4/2026" },           // called
  { name: "Low", sec: "rough", roughStage: "60%" },                                             // not far enough
  { name: "Fail", sec: "roughFail", roughStage: "100%", roughInspectionResult: "fail" },        // has a result
  { name: "Fin", sec: "finish", finishStage: "95%" },                                           // to call: final
  { name: "FinDone", sec: "finish", finishStage: "95%", finalInspectionResult: "pass" },
  { name: "Ped", sec: "ped", tempPed: true, roughStage: "100%" },
  { name: "Comm", sec: "commInProgress", division: "commercial", roughStage: "100%" },
  { name: "Quick", sec: "quick", quickJob: true, roughStage: "100%" },
], secOf);
eq(toCall.map(x => `${x.job.name} ${x.ph} ${x.pct}`), ["Fin Final 95", "Rose Rough 90"], "to-call list: 85%+, no target, no result; highest first");

// 3. Time off by day ----------------------------------------------------------------------------
const days = [0, 1, 2, 3, 4].map(day);                         // Fri 10/30, Sat 10/31, Sun 11/1, Mon 11/2, Tue 11/3
const off = X.odTimeOffByDay([
  { name: "James Livingston", start: "10/31/2026", end: "11/2/2026" },
  { name: "Noah Davis", start: "11/2/2026" },                                   // one day, no end
  { name: "noah davis", start: "2026-11-02", end: "2026-11-02" },               // same person, ISO
  { name: "Justin Cloward ", start: "11/3/2026", end: "11/1/2026" },             // ends before it starts: still a range
  { name: "", start: "10/30/2026" }, { name: "Nobody", start: "" }, null,       // junk
], days);
eq(off.map(x => x.names), [[], ["James Livingston"], ["James Livingston", "Justin Cloward"], ["James Livingston", "Justin Cloward", "Noah Davis"], ["Justin Cloward"]], "inclusive ranges, one name once, sorted");
eq(off.map(x => x.text), ["", "Out: James", "Out: James, Justin", "Out: James, Justin, Noah", "Out: Justin"], "the quiet line");

// 4. First-pass by foreman ----------------------------------------------------------------------
const roster = ["Daegan Smith", "Keegan Wilkinson", "Louis Garcia"];
const owns = (j, n) => [j.foreman, j.lead].some(x => String(x || "").toLowerCase() === n.toLowerCase());
const J = (id, foreman, lead) => ({ id, name: id, foreman, lead });
const firsts = [
  { job: J("w1", "Daegan Smith", "Louis Garcia"), ph: "Rough", pass: true },
  { job: J("w1", "Daegan Smith", "Louis Garcia"), ph: "Final", pass: false },
  { job: J("w2", "Daegan Smith", ""), ph: "Rough", pass: true },
  { job: J("w3", "Daegan Smith", ""), ph: "Rough", pass: true },
  { job: J("k1", "Keegan Wilkinson", ""), ph: "Rough", pass: true },
  { job: J("k2", "Keegan Wilkinson", ""), ph: "Rough", pass: false },
  { job: J("x1", "Paul", ""), ph: "Rough", pass: false },
];
const fp = X.odFirstPassByForeman(firsts, roster, owns);
eq(fp.shown.map(r => [r.name, r.n, r.pass, r.pct]), [["Daegan Smith", 4, 3, 75]], "Daegan: 4 inspected (the lead job counts for him too), 75%");
eq(fp.few.map(r => [r.name, r.n, r.pass, r.pct]), [["Keegan Wilkinson", 2, 1, 50], ["Louis Garcia", 2, 1, 50], ["No foreman", 1, 0, 0]], "fewer than 3 split out, No foreman last");
eq(fp.min, 3, "the fold threshold");
eq(X.odFirstPassByForeman(firsts, roster, owns, 1).shown.length, 4, "threshold is a parameter");

// 5. Return-trip causes -------------------------------------------------------------------------
const rt = (o) => ({ rt: o, job: { name: "j" } });
const causes = X.odRtCauses([
  rt({ scope: "Floor outlets" }), rt({ scope: "<p>&nbsp;</p>" }), rt({ scope: "" }),
  rt({ fromCOId: "c1", scope: "Add cans" }), rt({ fromQCFail: true, scope: "QC Fail — return trip needed" }), rt({ scope: "QC Items — return trip" }),
  rt({ fromFailedRough: true, scope: "Failed 4-way inspection items" }), rt({ fromFailedFinal: true }), rt({ fromGC: true, scope: "Move outlet" }), rt({ createdFromJobNoteId: "n1" }),
  rt({ fromCOId: "c2", fromQCFail: true }),                                   // first marker wins
]);
eq(causes.map(g => [g.k, g.label, g.items.length]), [["co", "Change order", 2], ["qc", "QC walk", 2], ["insp", "Failed inspection", 2], ["gc", "GC request", 1], ["note", "Job note", 1], ["hand", "Added by hand", 1], ["none", "No reason", 2]], "buckets in fixed order; blank or empty-HTML scope is No reason");
eq(X.odRtCauses([rt({ scope: "x" })]).map(g => g.k), ["hand"], "empty buckets are dropped");
eq(X.odRtCause(null), "none", "a missing record is No reason");

// 6. Re-inspection by date ----------------------------------------------------------------------
const t0 = day(0);
const g = (name, rebook, passAfter) => ({ job: { name }, ph: "Rough", rebook, passAfter: passAfter || null });
const re = X.odReinspByDate([g("Late", day(-2)), g("Soon", day(3)), g("Same", day(3)), g("NoDate", null), g("Passed", day(1), day(0))], t0);
eq(re.list.map(x => [x.g.job.name, x.late]), [["Late", 2], ["Soon", 0], ["Same", 0]], "dated, no pass since, soonest first, days late");
eq(re.days.map(d => [d.k, d.items.length]), [[ymd(day(-2)), 1], [ymd(day(3)), 2]], "grouped by day");
eq(re.late, 1, "late count");

// 7. Through the model --------------------------------------------------------------------------
const users = [{ id: "dae", name: "Daegan Smith", title: "foreman" }];
const base = { roughPunch: {}, finishPunch: {}, qcPunch: {}, changeOrders: [], returnTrips: [], prepDone: true };
const jobs = [
  { ...base, id: "f1", name: "Kweller", foreman: "Daegan Smith", roughStatus: "complete", finishStatus: "waiting_date", roughInspectionResult: "fail",
    fourWayTargetDate: mdy(day(4)), roughInspectionAttempts: [{ date: mdy(day(-6)), result: "fail", items: [{ text: "box fill" }] }] },
  { ...base, id: "r1", name: "Rose", foreman: "Daegan Smith", roughStatus: "inprogress", roughStage: "90%" },
  { ...base, id: "r2", name: "Webb", foreman: "Daegan Smith", roughStatus: "inprogress", roughStage: "90%", fourWayTargetDate: mdy(day(2)) },
];
const d = X.odModel({ jobs, users, needs: [], upcoming: [], now });
const re2 = X.odReinspByDate(d.failGroups, d.t0);
eq(re2.list.map(x => x.g.job.name), ["Kweller"], "the failed rough with a later target is booked for re-inspection");
eq(X.odInspToCall(d.active, d.secOf).map(x => x.job.name), ["Rose"], "only the 90% rough with no target is left to call");
const sched = d.sched.filter(s => s.type === "insp");
eq(sched.map(s => [s.name, s.label, X.odInspCalled(s.job, /Final/.test(s.label) ? "Final" : "Rough").called]), [["Webb", "Rough inspection", true], ["Kweller", "Rough re-inspection", true]], "every dated inspection row reads as called in");

console.log("schedule-quality-audit-test: all checks passed");
