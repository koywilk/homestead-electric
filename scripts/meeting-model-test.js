// meeting-model-test.js — src/meetingModel.js (SW v648, the Weekly Scramble on /dashboard › Meetings).
// Real-shaped rows from 2026-11-17: Ashcraft #1291 finish booked Mon/Tue, Pierce #1277 rough with
// nothing booked, Hightower #1421 trip with no crew or date, Stratton #959 CO pending 148 days.
"use strict";
const M = require("../src/meetingModel.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };
const today = new Date(2026, 10, 17, 14);
ok(M.meetingDate(today) === "2026-11-17", "Tuesday 11/17 is its own meeting");
ok(M.meetingDate(new Date(2026, 10, 16, 9)) === "2026-11-17", "Monday belongs to that week's Tuesday");
ok(M.meetingDate(new Date(2026, 10, 22, 9)) === "2026-11-17", "Sunday still the same week");
ok(M.prevMeetingDate("2026-11-17") === "2026-11-10", "last week is 11/10");
ok(M.weekRange("2026-11-17").from === "2026-11-16" && M.weekRange("2026-11-17").to === "2026-11-22", "week runs Mon–Sun");
ok(M.safeKey("a.b/c d") === "a_b_c_d", "keys are field-path safe");
const sched = [
  { Type: "job", Reference: "1291-17551", Date: "2026-11-16", Staff: { Name: "James Livingston" } },
  { Type: "job", Reference: "1291-17551", Date: "2026-11-16", Staff: { Name: "James Coleman Christen" } },
  { Type: "job", Reference: "1291-17551", Date: "2026-11-17", Staff: { Name: "Louis Hoffman" } },
  { Type: "job", Reference: "1291-17551", Date: "2026-11-17", Staff: { Name: "Louis Hoffman" } },
  { Type: "activity", Reference: "41", Date: "2026-11-17", Staff: { Name: "Jeromy Cloward" } },
];
const b = M.bookingsByJob(sched);
ok(b["1291"] && b["1291"].length === 2, "two booked days on 1291");
ok(b["1291"][0].d === "Mon 11/16" && b["1291"][0].who.join() === "James L.,James C.", "same first names get last initials");
ok(b["1291"][1].who.join() === "Louis", "a person shows once per day");
ok(!b["41"], "activities are not jobs");
const eff = (k) => (j) => j[k] || "";
const jobs = [
  { id: "j1291", simproNo: "1291", name: "Ashcraft", roughStatus: "complete", finishStatus: "inprogress", finishStage: "15%" },
  { id: "j1277", simproNo: "1277", name: "Pierce Residence", roughStatus: "inprogress", roughStage: "80%" },
  { id: "j1421", simproNo: "1421", name: "Hightower Remodel", roughStatus: "complete", finishStatus: "complete", returnTrips: [{ id: "rt1", scope: "From Owusu<br>7 lights" }] },
  { id: "j959", simproNo: "959", name: "Stratton Residence", roughStatus: "waiting", changeOrders: [{ id: "c5", number: 5, coStatus: "pending", coStatusDate: "6/22/2026", description: "Post drywall additions", quoteNumber: "2983" }],
    finishMaterials: [{ id: "m1", needsOrder: true, source: "CED", items: "- 1x 4 gang blank<br>- 4x RAB 1&#39;x4&#39; lights" }, { id: "m2", needsOrder: true, items: "" }] },
  { id: "jA", simproNo: "1999", name: "Old", archived: true, roughStatus: "inprogress" },
];
const flags = { open: [{ id: "f1", routine: "Job issues watch", status: "open", jobNo: "1291", title: "quote not in CC" }, { id: "f2", routine: "Asks watch", status: "open", title: "skip me" }] };
const S = M.buildSections({ jobs, upcoming: [{ id: "u1", name: "#2386 - Skyridge Lot 211", projectedStart: "11/19/2026" }, { id: "u2", name: "Far", projectedStart: "6/1/2027" }],
  flags: flags.open, schedules: sched, today, effRS: eff("roughStatus"), effFS: eff("finishStatus") });
const ash = S.schedule.find(r => r.no === "1291"), pie = S.schedule.find(r => r.no === "1277");
ok(ash && ash.tag === "Finish" && ash.pct === 15 && ash.days.length === 2, "Ashcraft: finish 15% with its two days");
ok(pie && pie.tag === "Rough" && pie.detail === "Nothing booked in Simpro this week", "Pierce: rough, nothing booked");
ok(!S.schedule.some(r => r.no === "1999"), "archived jobs never show");
ok(S.trips.length === 1 && S.trips[0].tag === "Needs crew + date" && S.trips[0].detail === "From Owusu 7 lights", "Hightower trip needs a crew and date, tags stripped");
const co = S.waiting.find(r => r.tag === "CO waiting on GC");
ok(co && co.pct === 148, "Stratton CO #5 waiting 148 days");
ok(S.waiting.some(r => r.tag === "On hold · Rough"), "Stratton rough on hold");
ok(S.upcoming.length === 1 && S.upcoming[0].date === "11/19", "only starts in the next six weeks");
ok(S.watches.length === 1 && S.watches[0].jobId === "j1291", "only the two watches, linked to the job");
ok(S.material.length === 1 && S.material[0].detail === "CED: 1x 4 gang blank, 4x RAB 1'x4' lights", "card lines read plain; empty cards skipped");
const prefs = { hidden: { schedule: { [pie.key]: { by: "Koy" } } }, added: { x1: { sec: "schedule", text: "Perkes walk", by: "Koy Wilkinson", at: "2026-11-17T22:00:00Z" }, x2: { sec: "trips", text: "elsewhere" } } };
const ap = M.applyPrefs(S.schedule, "schedule", prefs);
ok(ap.hiddenCount === 1 && !ap.rows.some(r => r.key === pie.key), "a hidden row stays hidden");
ok(ap.rows.some(r => r.addedId === "x1" && r.tag === "Added" && r.detail === "Added by Koy"), "an added item joins its own section only");
ok(!ap.rows.some(r => r.addedId === "x2"), "an add for another section stays there");
const steps = M.carriedSteps(M.SEED_2026_11_10, "2026-11-10", { carried: { "2026_11_10__s2": "done" } });
ok(steps.length === 5 && steps[1].status === "done" && steps[0].status === "", "Nov 10 next steps carry, with this week's marks");
ok(M.needIdFor("scramble_2026-11-17", "abc") === M.needIdFor("scramble_2026-11-17", "abc"), "one task id per action (no doubles)");
if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("meeting-model-test: all passed");
