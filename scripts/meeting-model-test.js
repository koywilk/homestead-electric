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

// ── Lead Meeting (v649, reworked v650 to match Koy's Nov 11 Doc) ──
ok(M.meetingDate(today, "lead") === "2026-11-18" && M.meetingId("2026-11-18", "lead") === "lead_2026-11-18", "Lead Meeting is the week's Wednesday, lead_<date>");
ok(M.meetingId("2026-11-17") === "scramble_2026-11-17", "Scramble ids unchanged");
ok(M.LEAD_SECS.map(x => x[0]).join() === "notes,highlight,lowlight,training,schedule,upcoming,hours,crewout,nextsteps", "Doc order: typed sections first, Action items last");
ok(M.leadRange("2026-11-18").from === "2026-11-18" && M.leadRange("2026-11-18").to === "2026-11-20", "schedule runs the meeting day to Friday");
const lsched = [
  { Type: "job", Reference: "1291-17551", Date: "2026-11-17", Staff: { Name: "Louis Hoffman" } },             // Tuesday: before the meeting, left out
  { Type: "job", Reference: "1291-17551", Date: "2026-11-18", Staff: { Name: "Daegan Smith" } },
  { Type: "job", Reference: "1291-17551", Date: "2026-11-18", Staff: { Name: "Louis Hoffman" } },
  { Type: "job", Reference: "1412-18586", Date: "2026-11-18", Staff: { Name: "Braden Davis" } },
  { Type: "job", Reference: "945-19230", Date: "2026-11-19", Staff: { Name: "Noah Davis" } },
  { Type: "job", Reference: "1291-17551", Date: "2026-11-23", Staff: { Name: "Louis Hoffman" } },             // next week: left out
];
const ljobs = jobs.concat([
  { id: "j1430", simproNo: "1430", name: "Brandt Residence", foreman: "Gage Lund", roughStatus: "complete", finishStatus: "waiting_date" },
  { id: "j1107", simproNo: "1107", name: "Kweller", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "" },
  { id: "j535", simproNo: "535", name: "D32 Payne", foreman: "Colby Fogh", roughStatus: "complete", finishStatus: "inprogress" },
  { id: "j989", simproNo: "989", name: "Bohannan", foreman: "Abraham Tristan", roughStatus: "complete", finishStatus: "" },
  { id: "j1412", simproNo: "1412", name: "Battle Creek", division: "commercial", roughStatus: "inprogress" },
  { id: "j1402", simproNo: "1402", name: "Cougar Moon Lot 84 - Kamas", roughStatus: "complete", finishStatus: "date_confirmed", finishProjectedStart: "11/16/2026", finishStartConfirmed: true },
]);
ljobs[0].foreman = "Louis Hoffman";   // Ashcraft: Louis is a jr. foreman under Daegan
const users = [
  { id: "keegan", name: "Keegan Wilkinson", title: "foreman", active: true }, { id: "daegan", name: "Daegan Smith", title: "foreman", active: true },
  { id: "colby", name: "Colby Fogh", title: "foreman", active: true }, { id: "abe", name: "Abraham Tristan", title: "foreman", active: true },
  { id: "gage", name: "Gage Lund", title: "jrforeman", foremanId: "keegan", active: true }, { id: "louis", name: "Louis Hoffman", title: "jrforeman", foremanId: "daegan", active: true },
  { id: "justin1", name: "Justin Cloward", active: true }, { id: "justin2", name: "Justin Cloward", title: "crew", active: true },
  { id: "james", name: "James Livingston", title: "crew", foremanId: "daegan", active: true }, { id: "noah", name: "Noah Davis", title: "crew", active: true },
  { id: "bailey", name: "Bailey Smith", title: "crew", active: false },
];
const costs = [
  // Brandt: rough way over; finish 6 of 233 h, so "not started" (it read 99% before)
  { no: "1430", name: "Brandt Residence", rough_hrsEst: 342, rough_hrsUsed: 580, rough_sell: 100, rough_matEst: 30, rough_matAct: 45, rough_labEst: 50, rough_labAct: 74,
    finish_hrsEst: 233, finish_hrsUsed: 6, finish_sell: 80, finish_matAct: 0, finish_labAct: 1 },
  { no: "1107", name: "Kweller", rough_hrsEst: 394, rough_hrsUsed: 1248, rough_sell: 100, rough_matAct: 60, rough_labAct: 104, rough_matEst: 40, rough_labEst: 47, finish_hrsEst: 411, finish_hrsUsed: 29 },
  { no: "1291", name: "Ashcraft", rough_hrsEst: 556, rough_hrsUsed: 920, rough_sell: 100, rough_matAct: 40, rough_labAct: 50, rough_matEst: 45, rough_labEst: 43,
    finish_hrsEst: 478, finish_hrsUsed: 573, finish_sell: 100, finish_matAct: 20, finish_labAct: 28, finish_matEst: 21, finish_labEst: 24 },
  { no: "535", name: "D32 Payne", rough_hrsEst: 729, rough_hrsUsed: 1611, rough_sell: 100, rough_matAct: 50, rough_labAct: 74, finish_hrsEst: 840, finish_hrsUsed: 209, finish_sell: 100, finish_matAct: 10, finish_labAct: 9 },
  { no: "989", name: "Bohannan", rough_hrsEst: 274, rough_hrsUsed: 312, rough_sell: 100, rough_matAct: 30, rough_labAct: 30 },
  { no: "1412", name: "Battle Creek Plaza A&B - Lindon", rough_hrsEst: 2014, rough_hrsUsed: 116, rough_sell: 100 },
  { no: "1421", name: "Hightower Remodel", finish_hrsEst: 10, finish_hrsUsed: 30 },
  { no: "1277", name: "Pierce Residence", rough_hrsEst: 0, rough_hrsUsed: 0 },
];
const totals = { "1430": { margin: 28.64, status: "Job - Rough-In Complete", stage: "Progress" }, "1107": { margin: 24.38, status: "Job - Rough-In Complete", stage: "Progress" },
  "1291": { margin: 20.94, status: "Job - Finish", stage: "Progress" }, "535": { margin: 35.78, status: "Job - Rough-In Complete", stage: "Progress" }, "989": { margin: 46.75, status: "Job - Rough-In Complete", stage: "Progress" } };
const L = M.buildLeadSections({ jobs: ljobs, today, meeting: "2026-11-18", effRS: eff("roughStatus"), effFS: eff("finishStatus"), schedules: lsched, users, costs, totals,
  names: { "945": "Maddox Residence" },
  upcoming: [{ id: "u1", name: "#2547 - Peterson Residence - Provo", projectedStart: "10/26/2026" }, { id: "u2", name: "#1402 - Cougar Moon", projectedStart: "12/1/2026" },
             { id: "u3", name: "#2386 - Skyridge Lot 211", projectedStart: "11/19/2026", startConfirmed: true }],
  requests: [{ id: "to_1", name: "Treycen Rollene", start: "11/25/2026", end: "12/1/2026", status: "pending", note: "Thanksgiving" }, { id: "to_2", name: "Zane Watkins", start: "11/19/2026", status: "denied" }],
  pto: [{ id: "p1", name: "James Livingston", start: "11/20/2026", end: "11/27/2026", note: "Family vacation" }, { id: "p2", name: "Noah Davis", start: "11/23/2026", end: "11/23/2026" },
        { id: "p3", name: "Justin Cloward", start: "11/25/2026", end: "11/27/2026" }, { id: "p4", name: "Colby Fogh", start: "12/10/2026", end: "12/10/2026" },
        { id: "p5", name: "Noah Davis", start: "12/10/2026", end: "12/10/2026" }, { id: "p6", name: "Old", start: "10/01/2026", end: "10/02/2026" },
        { id: "p7", name: "Bailey Smith", start: "11/24/2026" }] });
// Schedule
const heads = Array.from(new Set(L.schedule.map(r => r.group)));
ok(heads.join("|") === "Wed Nov 18|Thu Nov 19|Fri Nov 20", "schedule: one heading a day, meeting day to Friday, no past days, no next week");
const wed = L.schedule.filter(r => r.group === "Wed Nov 18");
ok(wed[0].no === "1291" && wed[0].title === "Ashcraft" && wed[0].detail === "Daegan, Louis", "Wednesday: Ashcraft with its crew, biggest crew first");
ok(wed.some(r => r.no === "1412" && r.title === "Battle Creek"), "a commercial job booked shows by number and name");
ok(L.schedule.some(r => r.no === "945" && r.title === "Maddox Residence" && !r.jobId), "a booked job not in CC takes its name from Simpro");
ok(L.schedule.some(r => r.group === "Fri Nov 20" && r.empty), "an empty day says nothing is booked yet");
ok(new Set(L.schedule.map(r => r.key)).size === L.schedule.length, "every schedule row has its own key (one note per job per day)");
// Upcoming
const pete = L.upcoming.find(r => /Peterson/.test(r.title));
ok(pete && pete.no === "2547" && pete.title === "Peterson Residence - Provo" && pete.tag === "22d past" && /^Oct 26 projected/.test(pete.detail), "Upcoming list rows carry their number; past due reads Nd past");
const cm = L.upcoming.filter(r => r.no === "1402");
ok(cm.length === 1 && cm[0].tag === "1d past" && /Nov 16 confirmed/.test(cm[0].detail), "a CC start wins over its Upcoming-list copy; confirmed reads confirmed");
ok(L.upcoming.find(r => r.no === "2386").tag === "" && /confirmed/.test(L.upcoming.find(r => r.no === "2386").detail), "a future start has no past tag");
// Hours and margin
const H = L.hours, h = (no) => H.find(r => r.no === no);
ok(H.map(r => r.no).join() === "1107,1430,1291,535,989", "every active residential job, by foreman (Keegan, Daegan, Colby, the rest), worst total first");
ok(h("1430").group === "Keegan Wilkinson" && h("1291").group === "Daegan Smith", "a jr. foreman's job sits with their foreman");
ok(h("1430").rough.m === -19 && h("1430").finish.state === "not started", "Brandt: rough net margin -19%, finish not started at 3% of its hours");
ok(h("1430").total === 29 && h("1430").status === "Rough-In Complete", "total margin and status straight from Simpro, 'Job - ' dropped");
ok(h("1430").flags[0].over && h("1430").flags[0].text === "Rough over: hours 170%, labor 148%, materials 150%", "flags read like the Doc: phase, over, each measure");
ok(h("1291").flags.some(f => !f.over && f.text === "Rough close: materials 89%") === false && h("1291").flags.some(f => !f.over && /Finish close: materials 95%/.test(f.text)), "close is 90–100% of bid; under 90% is not flagged");
ok(h("1291").finish.m === 52, "finish net margin = (sell − material − labor) ÷ sell");
ok(!h("1412") && !h("1421") && !h("1277"), "commercial, finished and not-started jobs are left out");
ok(JSON.stringify(H).indexOf("sell") === -1, "no dollar figure leaves the model");
// Crew out
const cout = L.crewout.map(r => r.title + " " + r.detail);
ok(cout.join("|") === "James Livingston Nov 20–Nov 27|Noah Davis Nov 23|Treycen Rollene Nov 25–Dec 1|Colby Fogh, Noah Davis Dec 10", "crew out: field crew names and dates, same days on one line, pending included, office and former crew left out");
ok(L.crewout.every(r => !r.tag && !/Thanksgiving|vacation/.test(r.detail)), "no approval tags and no personal notes");
ok(Array.isArray(L.notes) && L.notes.length === 0, "typed sections start empty");
ok(M.secHasContent({ notes: { hiring: "References" } }, "hiring") && !M.secHasContent({ notes: { hiring: " " } }, "hiring") && M.secHasContent({ added: { a: { sec: "needs" } } }, "needs"), "a cut section shows only for a week that has something typed in it");
ok(M.seedFor("lead", "2026-11-11").notes.notes.split("\n").length === 5 && !M.seedFor("lead", "2026-11-18"), "Nov 11's five notes stand in for that week");
const cs = M.carriedSteps({ actions: { a1: { text: "Call GC", who: "Koy Wilkinson", sec: "notes", at: "1", carriedFrom: "2026-11-04" } } }, "2026-11-11", {});
ok(cs[0].sec === "notes" && cs[0].from === "2026-11-04", "a carried item keeps its section and how long it's been open");
if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("meeting-model-test: all passed");
