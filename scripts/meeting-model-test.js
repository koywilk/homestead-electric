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

// ── Lead Meeting (v649) ──
ok(M.meetingDate(today, "lead") === "2026-11-18" && M.meetingId("2026-11-18", "lead") === "lead_2026-11-18", "Lead Meeting is the week's Wednesday, lead_<date>");
ok(M.meetingId("2026-11-17") === "scramble_2026-11-17", "Scramble ids unchanged");
ok(M.weekRange("2026-11-18", 2).to === "2026-11-29", "Lead schedule reads this week and next");
const lsched = sched.concat([{ Type: "job", Reference: "1291-17551", Date: "2026-11-21", Staff: { Name: "Jose Sanchez" } }, { Type: "job", Reference: "1476-19250", Date: "2026-11-24", Staff: { Name: "Noah Davis" } }]);
const ljobs = jobs.concat([{ id: "j1260", simproNo: "1260", name: "Colton Residence", foreman: "Keegan Wilkinson", lead: "Lead TBD", roughStatus: "complete", finishStatus: "scheduled", finalInspectionResult: "fail" }]);
ljobs[0].foreman = "Daegan Smith"; ljobs[0].lead = "Louis Hoffman";
const L = M.buildLeadSections({ jobs: ljobs, today, effRS: eff("roughStatus"), effFS: eff("finishStatus"), schedules: lsched,
  flags: [{ id: "a", key: "colby-text-20261116-535", routine: "Asks watch", status: "open", title: "Colby: schedule Treycen", firstSeen: "2026-11-16T22:42:16Z" },
          { id: "b", key: "myday-need_1", routine: "Asks watch", status: "open", title: "mirror" },
          { id: "c", key: "Tue 11/17 interview overlap", routine: "Crew schedule watch", status: "open", title: "Seth interview overlaps your 6pm" },
          { id: "d", key: "1476 Chapman meter this week", routine: "Crew schedule watch", status: "open", jobNo: "1476", title: "Chapman meter", firstSeen: "2026-11-16T20:14:42Z" },
          { id: "e", key: "1469-Q3373", routine: "Job issues watch", status: "open", title: "not this meeting" }],
  needs: [{ id: "n1", text: "Remove England temp pedestal", assignedTo: "Koy Wilkinson", assignedBy: "Justin Cloward", dueDate: "2026-11-09", status: "open" },
          { id: "n2", text: "my own", assignedTo: "Koy Wilkinson", assignedBy: "Koy Wilkinson", status: "open" },
          { id: "n3", text: "done one", assignedTo: "Koy Wilkinson", assignedBy: "Josh Cloward", status: "done" }],
  costs: [{ no: "1291", finish_hrsEst: 100, finish_hrsUsed: 112 }, { no: "1277", rough_hrsEst: 200, rough_hrsUsed: 120 }, { no: "1421", finish_hrsEst: 10, finish_hrsUsed: 30 }],
  requests: [{ id: "to_1", name: "Treycen Rollene", start: "2026-11-25", end: "2026-12-01", status: "pending" }, { id: "to_2", name: "X", start: "2026-11-20", status: "denied" }],
  pto: [{ id: "pto_1", name: "Zane Watkins", start: "2026-11-19", end: "2026-11-19" }, { id: "pto_2", name: "Old", start: "2026-10-01", end: "2026-10-02" }] });
ok(L.watches.filter(r => /^f_/.test(r.key)).map(r => r.title).join("|") === "Chapman meter|Colby: schedule Treycen", "Lead watches: two routines, no mirrors, no overlap flag, oldest first... by first seen");
ok(L.watches.some(r => r.tag === "Past due" && /England/.test(r.title)) && L.watches.filter(r => /^n_/.test(r.key)).length === 1, "My Day asks to Koy from others only, past due marked");
const ash2 = L.schedule.find(r => r.no === "1291");
ok(ash2 && ash2.days.length === 2 && ash2.detail === "Foreman Daegan · Lead Louis", "Saturday dropped; foreman and lead from CC");
ok(L.schedule.some(r => r.no === "1476" && r.title === "Simpro #1476"), "a booked job not in CC still shows, by its Simpro number");
ok(L.hours.length === 1 && L.hours[0].pct === 112 && L.hours[0].tag === "Finish", "hours: only phases 90%+ and not done (Hightower finish is complete)");
ok(L.crewout[0].tag === "Needs Koy's approval" && L.crewout[0].title === "Treycen Rollene" && L.crewout.length === 2, "crew out: pending first, denied and past PTO left out");
ok(L.crewout[1].detail === "Thu 11/19", "one-day PTO reads as one day");
ok(L.whenup.some(r => r.tag === "Failed final inspection") && L.whenup.some(r => r.tag === "Scheduled, nobody booked" && r.no === "1260"), "when it comes up: failed inspection, scheduled with nobody booked");
ok(L.whenup.some(r => /^t_/.test(r.key)), "when it comes up: return trips needing a crew or date");
ok(Array.isArray(L.notes) && L.notes.length === 0, "typed sections start empty");
ok(M.seedFor("lead", "2026-11-11").notes.notes.split("\n").length === 5 && !M.seedFor("lead", "2026-11-18"), "Nov 11's five notes stand in for that week");
const cs = M.carriedSteps({ actions: { a1: { text: "Call GC", who: "Koy Wilkinson", sec: "notes", at: "1", carriedFrom: "2026-11-04" } } }, "2026-11-11", {});
ok(cs[0].sec === "notes" && cs[0].from === "2026-11-04", "a carried item keeps its section and how long it's been open");
if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("meeting-model-test: all passed");
