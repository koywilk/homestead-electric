// scramble-cal-test.js — src/scrambleCal.js and functions/scrambleBook.js (SW v651, the Scramble calendar).
// Real-shaped rows from Tue 2026-11-17: Battle Creek #1412 rough booked Mon–Thu with 2,485 h left,
// Hightower #1421 trip #1 set for Thu 11/19 and booked, Cougar Moon #1402 finish confirmed for Mon 11/23
// with nothing booked, Tolbert #1407 finish est. 12/1 with no material PO and trip #4 with no date or crew,
// Stratton #959 trip #2 set for 10/28 and still open, Rose #889 finish over bid, Skyridge Lot 211 on Upcoming.
"use strict";
const SC = require("../src/scrambleCal.js");
const SB = require("../functions/scrambleBook.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };
const today = new Date(2026, 10, 17, 18);

// ── workday math (4-10s) ──
ok(SC.mondayOf(today) === "2026-11-16", "the view starts Monday 11/16");
ok(SC.nextWork("2026-11-20") === "2026-11-23", "Friday rolls to Monday");
ok(SC.workAfter("2026-11-19") === "2026-11-23", "the day after Thursday is Monday");
const sp = SC.span("2026-11-23", 50, 2, "2026-12-18");
ok(sp.used.length === 3 && sp.used[2].part === 0.5 && sp.days === 2.5, "50 h at 2 people is 2.5 workdays");
const big = SC.span("2026-11-23", 2485, 2, "2026-12-18");
ok(big.cut && big.used.length === 15, "a job longer than the view runs to its edge and says it continues (Thanksgiving off)");
ok(!SC.isWork("2026-11-26") && SC.isHoliday("2026-11-26") && SC.isHoliday("2026-12-25") && SC.isHoliday("2027-07-05") && SC.nextWork("2026-11-26") === "2026-11-30" && SC.isWork("2026-11-25"), "holidays: Thanksgiving, Christmas, July 4 on a Sunday taken Monday");
ok(JSON.stringify(SC.planDays({ s: "2026-11-23", hours: 50, crew: 2 })) === JSON.stringify([{ date: "2026-11-23", hours: 10 }, { date: "2026-11-24", hours: 10 }, { date: "2026-11-25", hours: 5 }]), "a plan books 10 h days, the last one short");
ok(SC.upNo({ name: "#2386 - Skyridge Lot 211" }) === "2386" && SC.upName({ name: "#2386 - Skyridge Lot 211" }) === "Skyridge Lot 211", "Upcoming numbers and names split");

// ── the calendar ──
const S = (no, date, name, hrs) => ({ Type: "job", Reference: no + "-1", Date: date, Staff: { ID: 1, Name: name }, Blocks: [{ Hrs: hrs }] });
const schedules = [
  ...["2026-11-16", "2026-11-17", "2026-11-18"].flatMap(d => [S("1412", d, "Braden Davis", 10), S("1412", d, "Zane Watkins", 10)]), S("1412", "2026-11-19", "Braden Davis", 10),
  S("1421", "2026-11-19", "Noah Davis", 10), S("1421", "2026-11-19", "Jacob Spackman", 10),
  S("889", "2026-11-18", "Keegan Wilkinson", 10), S("889", "2026-11-18", "Austin Schut", 10),
  S("1394", "2026-11-17", "Payton Bolda", 0.7),
  { Type: "activity", Reference: "9", Date: "2026-11-18", Staff: { ID: 5, Name: "Koy Wilkinson" }, Blocks: [{ Hrs: 2 }] },
];
const jobs = [
  { id: "a1412", simproNo: "1412", name: "Battle Creek Plaza", roughStatus: "inprogress", roughProjectedStart: "9/8/2026", roughStartConfirmed: true },
  { id: "a1421", simproNo: "1421", name: "Hightower Remodel", roughStatus: "complete", finishStatus: "waiting_date", finishMaterials: [{ ordered: true }],
    returnTrips: [{ id: "t1", number: 1, rtStatus: "scheduled", rtStatusDate: "11/19/2026", assignedTo: "Jacob Spackman", scope: "Hang CO fixtures" }] },
  { id: "a1402", simproNo: "1402", name: "Cougar Moon Lot 84", roughStatus: "complete", finishStatus: "date_confirmed", finishProjectedStart: "11/23/2026", finishStartConfirmed: true, finishMaterials: [{ ordered: true }] },
  { id: "a1407", simproNo: "1407", name: "Tolbert Residence", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "12/1/2026", finishMaterials: [],
    returnTrips: [{ id: "t4", number: 4, rtStatus: "needs", scope: "Add 3 kitchen cans" }] },
  { id: "a959", simproNo: "959", name: "Stratton Residence", roughStatus: "complete", finishStatus: "",
    returnTrips: [{ id: "t2", number: 2, rtStatus: "scheduled", rtStatusDate: "10/28/2026", assignedTo: "Abraham Tristan" }, { id: "old", rtStatus: "complete" }] },
  { id: "a889", simproNo: "889", name: "Rose", roughStatus: "complete", finishStatus: "inprogress", finishProjectedStart: "10/26/2026", finishStartConfirmed: true },
  { id: "a1382", simproNo: "1382", name: "Riverton Retail", roughStatus: "waiting_date", roughProjectedStart: "10/19/2026", roughMaterials: [{ needsOrder: true }] },
  { id: "a1260", simproNo: "1260", name: "Colton Residence", roughStatus: "complete", finishStatus: "waiting", finishProjectedStart: "11/16/2026", finishStartConfirmed: true },
  { id: "old", simproNo: "100", name: "Done job", roughStatus: "complete", finishStatus: "complete" },
  { id: "arch", simproNo: "101", name: "Archived", archived: true, roughStatus: "inprogress" },
  { id: "quiet", simproNo: "102", name: "Never set up", roughStatus: "", finishStatus: "" },
];
const phaseHours = { "1412": { r: [96, 2611] }, "1402": { f: [0, 143.6] }, "1407": { f: [0, 103] }, "889": { f: [1080, 1027] }, "1382": { r: [164, 678.9] }, "1421": { f: [51, 86] } };
const upcoming = [{ id: "u1", name: "#2386 - Skyridge Lot 211", projectedStart: "11/19/2026" }, { id: "u2", name: "#1402 - Cougar Moon Lot 84", projectedStart: "11/23/2026" }];
const V = SC.buildCalendar({ jobs, upcoming, schedules, phaseHours, upHours: { "2386": { est: 371.3, used: 0 } }, plans: {}, today, weeks: 5, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const K = (k) => V.items.find(x => x.key === k);
ok(V.days.length === 25 && V.end === "2026-12-18", "five weeks, Monday 11/16 to Friday 12/18");
const bc = K("j_a1412_r");
ok(bc && bc.kind === "rough" && bc.tag === "Rough-in" && bc.booked.length === 4, "Battle Creek is a rough-in block with its 4 Simpro days");
ok(bc.crewBooked === 2 && bc.left === 2485 && bc.auto && bc.auto.s === "2026-11-23" && bc.auto.crew === 2, "its hours left run on from Monday at the booked crew size");
ok(!bc.inList && bc.onCal && !bc.flags.length, "booked ahead: on the calendar, not on the list, no flag");
const trip = K("t_a1421_t1");
ok(trip && trip.kind === "trip" && trip.tag === "Return trip #1" && trip.booked.length === 1 && !trip.flags.length, "Hightower trip #1 takes its booked Thursday and isn't flagged");
const hf = K("j_a1421_f");
ok(hf && !hf.booked.length, "the trip's Simpro day isn't counted on Hightower's finish too");
const cm = K("j_a1402_f");
ok(cm.start.iso === "2026-11-23" && cm.start.conf && cm.inList && cm.flags.join() === "Starts Mon 11/23, not booked", "Cougar Moon: confirmed start, not booked, flagged, PO is fine");
const tb = K("j_a1407_f");
ok(tb.flags.includes("Starts Tue 12/1, not booked") && tb.flags.includes("Finish starts with no material PO"), "Tolbert finish: not booked and no material PO");
const t4 = K("t_a1407_t4");
ok(t4 && t4.flags.join() === "Not scheduled, no date or crew" && t4.inList, "Tolbert trip #4 has no date or crew");
const st2 = K("t_a959_t2");
ok(st2 && st2.flags.join() === "Was set for 10/28, not done", "Stratton trip #2 is past its date and still open");
ok(!V.items.some(x => x.key === "t_a959_old"), "a completed trip doesn't show");
const rose = K("j_a889_f");
ok(rose.over && rose.left === 0 && !rose.auto && !rose.flags.length, "Rose is over bid: no forecast tail, not flagged (already started)");
const rv = K("j_a1382_r");
ok(rv.flags.includes("Start date 10/19 has passed, not booked") && rv.flags.includes("Rough-in material card not ordered yet"), "Riverton: start passed, card not ordered");
ok(!K("j_a1260_f").flags.length, "an on-hold phase isn't flagged");
ok(!K("j_old_f") && !K("j_arch_r") && !K("j_quiet_r"), "done, archived and never-set-up jobs stay off");
ok(!V.items.some(x => x.no === "1394"), "a 0.7 h time-clock blip isn't a booked day");
const up = V.items.filter(x => x.upcoming);
ok(up.length === 1 && up[0].name === "Skyridge Lot 211" && up[0].est === 371.3 && up[0].flags.join() === "Starts Thu 11/19, not booked", "Upcoming: Skyridge Lot 211 with its quote hours; #1402 is already a job");
ok(V.list[0].flags.length > 0 && V.list.findIndex(x => !x.flags.length) > V.list.findIndex(x => x.flags.length), "flagged items lead the list");
// a kept plan puts an item on the calendar and off the list
const V2 = SC.buildCalendar({ jobs, upcoming, schedules, phaseHours, plans: { "j_a1402_f": { s: "2026-11-21", hours: 140, crew: 2, by: "Koy Wilkinson" } }, today, weeks: 5, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const cm2 = V2.items.find(x => x.key === "j_a1402_f");
ok(cm2.plan && cm2.plan.s === "2026-11-23" && cm2.onCal && !cm2.inList, "a kept plan (Saturday rolls to Monday) moves Cougar Moon onto the calendar");
ok(cm2.flags.join() === "Starts Mon 11/23, not booked", "a plan isn't a booking: the flag stays until Simpro has it");

// ── v656 auto-schedule: crews from the Crew Board (settings/users) ──
const users = [
  { id: "d", name: "Daegan Smith", title: "foreman", active: true }, { id: "l", name: "Louis Hoffman", title: "jrforeman", foremanId: "d", active: true },
  { id: "c", name: "Callen Jakeman", title: "crew", foremanId: "d", active: true }, { id: "b", name: "Bailey Smith", title: "crew", foremanId: "d", active: false },
  { id: "z", name: "Zane Watkins", title: "foreman", active: true }, { id: "br", name: "Braden Davis", title: "lead", foremanId: "z", active: true },
  { id: "a", name: "Abraham Tristan", title: "foreman", active: true }, { id: "j", name: "Jose Sanchez", title: "crew", foremanId: "a", active: true },
  { id: "jo", name: "Joel Fey", title: "lead", active: true },
];
const brd = SC.crewBoard(users);
ok(brd.crews.d.people.join() === "Daegan Smith,Louis Hoffman,Callen Jakeman", "Daegan's crew: Louis and Callen, Bailey (inactive) left off");
ok(brd.crewOf("Louis H.").id === "d" && brd.crewOf("Braden").id === "z" && brd.crewOf("Joel Fey") === null && brd.crewOf("Nobody") === null, "a jr foreman or lead runs with their foreman's crew; unassigned has no crew");
const fm = { a1402: "Daegan Smith", a1407: "Louis Hoffman", a1382: "Zane Watkins", a959: "Abraham Tristan", a1412: "Zane Watkins" };
const jobs3 = jobs.map(j => fm[j.id] ? { ...j, foreman: fm[j.id] } : j).concat([
  { id: "a77", simproNo: "77", name: "Trip test", roughStatus: "complete", finishStatus: "complete", foreman: "Abraham Tristan",
    returnTrips: [{ id: "x1", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Joel Fey", material: "2 GFCI" },
                  { id: "x2", number: 2, rtStatus: "scheduled", rtStatusDate: "11/30/2026", assignedTo: "Jose Sanchez", material: "" }] }]);
const A = (plans) => SC.buildCalendar({ jobs: jobs3, upcoming, schedules, phaseHours, plans: plans || {}, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const V3 = A(), K3 = (k) => V3.items.find(x => x.key === k), N3 = (k) => V3.needs.find(x => x.key === k);
const cm3 = K3("j_a1402_f");
ok(cm3.auto && cm3.auto.src === "auto" && cm3.auto.s === "2026-11-23" && cm3.auto.crew === 3 && cm3.auto.staff[0].name === "Daegan Smith" && !cm3.auto.held && cm3.onCal && !cm3.inList, "Cougar Moon finish: Daegan's whole 3-person crew (under 4, so no split) on its confirmed Monday, foreman first, off the list");
const tb3 = K3("j_a1407_f");
ok(tb3.auto && tb3.auto.s === "2026-12-02" && tb3.auto.staff[0].name === "Louis Hoffman" && tb3.auto.held === "Finish starts with no material PO" && N3("j_a1407_f").held, "Tolbert (Louis, jr foreman) runs with Daegan's crew after Cougar Moon, Louis leading, held for no material PO");
ok(K3("j_a1412_r").auto.src === undefined && K3("j_a1412_r").auto.s === "2026-11-23", "a Simpro tail stays as it was");
ok(!K3("j_a1382_r").auto && N3("j_a1382_r").why === "Zane's crew is booked through 12/18", "Riverton: Zane's crew is on Battle Creek through the view, so it's held for you, not double-booked");
const t43 = K3("t_a1407_t4");
ok(t43.auto && t43.auto.src === "auto" && /^No date or crew set in Command Center, so it's on the first open day/.test(t43.auto.held) && t43.auto.staff[0].name === "Louis Hoffman" && N3("t_a1407_t4").held && /Was set for 10\/28, not done/.test(N3("t_a959_t2").why), "a trip with no date or crew goes on the first open day for the job crew, held; a passed date goes to Needs you");
ok(N3("t_a77_x1").why === "Joel is unassigned on the Crew Board" && !K3("t_a77_x1").auto, "a trip for an unassigned person is never scheduled");
const x2 = K3("t_a77_x2");
ok(x2.auto && x2.auto.s === "2026-11-30" && x2.auto.staff[0].name === "Jose Sanchez" && x2.auto.held === "No material listed on the trip", "a dated trip lands on its day for its person, held when no material is listed");
ok(!V3.items.some(it => it.auto && it.auto.staff && it.auto.staff.some(p => /Joel|Bailey/.test(p.name))), "no unassigned or inactive person is ever on a block");
ok(K3("j_a1382_r").inList === false && V3.list.every(x => !x.need), "Needs you items leave the Not on the calendar list");
ok(SC.buildCalendar({ jobs: jobs3, schedules, phaseHours, today, weeks: 5 }).needs.length === 0, "with no Crew Board the auto-schedule stays off");
const V4 = A({ "j_a1402_f": { s: "2026-11-23", hours: 140, crew: 2, by: "Koy Wilkinson" } });
const cm4 = V4.items.find(x => x.key === "j_a1402_f"), tb4 = V4.items.find(x => x.key === "j_a1407_f");
ok(cm4.plan && !cm4.auto && tb4.auto.s === "2026-12-07", "a kept plan never moves, and its crew's days stay taken (Tolbert moves to after it)");
// Koy: "keep the crews at least four on a job if we can. But if there are two jobs going at the same time for a
// foreman, then the junior foreman is first up to take the job that the foreman's not on."
const users5 = users.concat([{ id: "t", name: "Trever Worley", title: "lead", foremanId: "d", active: true }, { id: "jl", name: "James Livingston", title: "crew", foremanId: "d", active: true }]);
const jobs5 = [
  { id: "x", simproNo: "500", name: "Foreman job", foreman: "Daegan Smith", roughStatus: "date_confirmed", roughProjectedStart: "11/23/2026", roughStartConfirmed: true, roughMaterials: [{ ordered: true }] },
  { id: "y", simproNo: "501", name: "Jr job", foreman: "Louis Hoffman", roughStatus: "inprogress", roughMaterials: [{ ordered: true }] },
  { id: "z", simproNo: "502", name: "Big crew", foreman: "Keegan Wilkinson", roughStatus: "inprogress" }];
const users6 = users5.concat([{ id: "k", name: "Keegan Wilkinson", title: "foreman", active: true }, { id: "au", name: "Austin Schut", title: "lead", foremanId: "k", active: true },
  { id: "g", name: "Gage Lund", title: "jrforeman", foremanId: "k", active: true }, { id: "p", name: "Payton Bolda", title: "crew", foremanId: "k", active: true }, { id: "q", name: "Quinn Test", title: "crew", foremanId: "k", active: true }]);
const V5 = SC.buildCalendar({ jobs: jobs5, schedules: [], phaseHours: { "500": { r: [0, 120] }, "501": { r: [0, 300] }, "502": { r: [0, 200] } }, today, weeks: 5, users: users6, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const X = V5.items.find(i => i.key === "j_x_r").auto, Y = V5.items.find(i => i.key === "j_y_r").auto, Z = V5.items.find(i => i.key === "j_z_r").auto;
ok(X.staff.map(p => p.name).join() === "Daegan Smith,Trever Worley,Callen Jakeman" && !X.held, "two jobs at once on a 5-person crew: the foreman's job keeps the bigger group (3), not flagged");
ok(Y.staff[0].name === "Louis Hoffman" && Y.crew === 2 && SC.planDays(Y).some(d => d.date === X.s) && /Only 2 of Daegan's crew free \(want 4\)/.test(Y.held), "the jr foreman takes the other job the same days with the rest, flagged short");
ok(Z.crew === 4 && Z.staff[0].name === "Keegan Wilkinson" && !Z.held && !Z.staff.some(p => p.name === "Gage Lund"), "one job on a 5-person crew: 4 on it, the foreman leading, the jr foreman kept free");
const V6 = A({ "j_a1402_f~2026-12-03": { s: "2026-12-03", hours: 20, crew: 2, staff: [{ name: "Callen Jakeman" }, { name: "Louis Hoffman" }] } });
const cp = V6.items.find(x => x.key === "j_a1402_f~2026-12-03");
ok(cp && cp.copyOf === "j_a1402_f" && cp.plan && cp.plan.s === "2026-12-03" && cp.onCal && !cp.inList && !cp.flags.length && cp.no === "1402", "a copied day is its own kept block on its job, with no flags");
ok(!V6.items.some(it => it.auto && it.auto.src === "auto" && it.key !== cp.key && SC.planDays(it.auto).some(d => d.date === "2026-12-03") && it.auto.staff.some(p => p.name === "Callen Jakeman")), "the auto-schedule doesn't put a copied day's people anywhere else that day");
const V7 = A({ "j_a1402_f": { off: true, by: "Koy Wilkinson" }, "j_a1412_r": { off: true } });
const cm7 = V7.items.find(x => x.key === "j_a1402_f"), bc7 = V7.items.find(x => x.key === "j_a1412_r");
ok(cm7.off && !cm7.auto && !cm7.plan && cm7.inList && !cm7.onCal && !V7.needs.some(n => n.key === "j_a1402_f"), "a block taken off stays off: no auto block, not in Needs you, still listed as needing scheduling");
ok(bc7.off && !bc7.auto && bc7.booked.length === 4 && bc7.onCal, "taking a booked job off only drops its forecast days; its Simpro days stay");
// every auto day stays Mon–Thu
ok(V3.items.filter(it => it.auto && it.auto.src).every(it => SC.planDays(it.auto).every(d => SC.isWork(d.date))), "auto blocks only use Mon–Thu");

// ── booking rules (server) ──
const b1 = SB.blocksFor(10, 35);
ok(b1.normal === 5 && b1.ot === 5 && b1.blocks.length === 2 && b1.blocks[0].EndTime === "12:00" && b1.blocks[1].ScheduleRate === 2 && b1.blocks[1].EndTime === "17:00", "35 h already: 5 normal, then 5 at 1.5x from noon");
ok(SB.blocksFor(10, 0).blocks.length === 1 && SB.blocksFor(10, 0).blocks[0].EndTime === "17:00", "a fresh week: 7:00 to 5:00 normal time");
ok(SB.blocksFor(4, 44).normal === 0 && SB.blocksFor(4, 44).ot === 4, "already over 40: all overtime");
const wh = SB.weekHours([{ Staff: { ID: 89 }, Date: "2026-11-17", Blocks: [{ Hrs: 10.8 }] }, { Staff: { ID: 89 }, Date: "2026-11-19", Blocks: [{ Hrs: 9.6 }, { Hrs: 0.4 }] }, { Staff: { ID: 7 }, Date: "2026-11-18", Blocks: [{ Hrs: 10 }] }], [89]);
ok(Math.abs(wh[89]["2026-11-16"] - 20.8) < 1e-9 && !wh[7], "week hours per person, only the people picked");
const ents = SB.buildEntries([{ date: "2026-11-24", hours: 10 }, { date: "2026-11-23", hours: 10 }], [{ id: 89, name: "Braden Davis" }], { 89: { "2026-11-23": 25 } });
ok(ents.length === 2 && ents[0].date === "2026-11-23" && ents[0].normal === 10 && ents[1].normal === 5 && ents[1].ot === 5, "entries go in date order and the 40 h line carries across days");
const cc = SB.pickCostCenter([{ ID: 9, Name: "Change Order - 9/11/26", DisplayOrder: 13, ccs: [{ ID: 1, Name: "Finish" }] }, { ID: 2779, Name: "Base", DisplayOrder: 1, ccs: [{ ID: 4733, Name: "Rough In" }, { ID: 4734, Name: "Finish" }] }], "finish");
ok(cc && cc.sectionId === 2779 && cc.id === 4734, "finish books on Base › Finish (889-4734, as Simpro has it)");
ok(SB.pickCostCenter([{ ID: 2779, Name: "Base", ccs: [{ ID: 4733, Name: "Rough In" }] }], "rough").id === 4733 && SB.pickCostCenter([{ ID: 1, Name: "Base", ccs: [{ ID: 2, Name: "Lights" }] }], "rough") === null, "rough books on Rough In; no match means no booking");
const h1 = SB.hashOf("1402", cc, ents), h2 = SB.hashOf("1402", cc, SB.buildEntries([{ date: "2026-11-23", hours: 10 }, { date: "2026-11-24", hours: 10 }], [{ id: 89, name: "Braden Davis" }], { 89: { "2026-11-23": 30 } }));
ok(h1 !== h2 && h1 === SB.hashOf("1402", cc, ents), "the confirm only matches the exact preview (an extra Simpro hour changes it)");
ok(JSON.stringify(SB.bodyOf(ents[1])) === JSON.stringify({ Staff: 89, Date: "2026-11-24", Blocks: [{ StartTime: "07:00", EndTime: "12:00", ScheduleRate: 1 }, { StartTime: "12:00", EndTime: "17:00", ScheduleRate: 2 }] }), "the Simpro body is only Staff, Date and Blocks");
const base = { mode: "preview", jobNo: "1402", phase: "finish", staffIds: [89], days: [{ date: "2026-11-23", hours: 10 }] };
ok(SB.validate(base, "2026-11-17") === "", "a good preview passes");
ok(/past/.test(SB.validate({ ...base, days: [{ date: "2026-11-16", hours: 10 }] }, "2026-11-17")), "a past day is refused");
ok(/quote/.test(SB.validate({ ...base, jobNo: "Q2386" }, "2026-11-17")), "a quote can't be booked");
ok(/preview/.test(SB.validate({ ...base, mode: "book" }, "2026-11-17")), "booking needs the preview's fingerprint");
ok(/twice/.test(SB.validate({ ...base, staffIds: [89, 89] }, "2026-11-17")), "the same person twice is refused");
ok(/smaller/.test(SB.validate({ ...base, staffIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], days: Array.from({ length: 10 }, (_, i) => ({ date: SB.addDays("2026-11-23", i), hours: 10 })) }, "2026-11-17")), "more than 80 entries is refused");
const src = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleBook.js"), "utf8");
ok(!/Stage|Status\s*:/.test(src.replace(/\/\/.*$/gm, "")), "the booking rules never touch a stage or status field");

// Koy 2026-11-19: lists split by what they are, each with a count, empty ones hidden.
const gT = (o) => SC.groupOf(o);
ok(gT({ kind: "rough" }) === "rough" && gT({ kind: "finish" }) === "finish" && gT({ kind: "trip" }) === "trip" && gT({ kind: "trip", cause: "final" }) === "final" && gT({ kind: "service" }) === "other", "each item has its section");
const gr = SC.groupBy([{ kind: "trip" }, { kind: "rough" }, { kind: "trip", cause: "final" }, { kind: "rough" }]);
ok(gr.map(g => g.label + ":" + g.items.length).join() === "Rough-ins:2,Failed finals:1,Return trips:1", "sections in order, with counts, empty ones left out");
const jf = [{ id: "ff", simproNo: "9", name: "Final fail", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
  returnTrips: [{ id: "f1", number: 1, fromFailedFinal: true, scope: "Failed final inspection items", rtStatus: "needs", material: "" }] }];
const VF = SC.buildCalendar({ jobs: jf, schedules: [], phaseHours: {}, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const ffi = VF.items.find(x => x.key === "t_ff_f1");
ok(ffi.cause === "final" && ffi.auto && ffi.auto.s >= VF.today && /No date or crew set/.test(ffi.auto.held), "a failed-final trip with no date or crew is a Failed final, placed on the first open day for the job's crew, held");

// Koy 2026-11-19: "They don't get sent by themselves anywhere ... we travel in at least pairs of two"
ok(x2.auto.crew === 2 && x2.auto.staff.length === 2, "a trip goes out as a pair: its person plus one from the crew");
ok(t43.auto.crew === 2 && t43.auto.staff[0].name === "Louis Hoffman", "a trip with no crew set: a leader from the job's crew plus one more");
ok(V3.items.every(it => !(it.auto && it.auto.src === "auto" && it.auto.crew === 1)) , "no block goes out with one person when a pair is free");
const usersS = [{ id: "d", name: "Daegan Smith", title: "foreman", active: true }, { id: "cj", name: "Callen Jakeman", title: "crew", foremanId: "d", active: true }];
const jS = [{ id: "s1", simproNo: "61", name: "Solo test", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
  returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Callen Jakeman", material: "x" },
                { id: "b", number: 2, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Daegan Smith", material: "x" }] }];
const VS = SC.buildCalendar({ jobs: jS, schedules: [], phaseHours: {}, today, weeks: 5, users: usersS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const sa = VS.items.find(x => x.key === "t_s1_a"), sb = VS.items.find(x => x.key === "t_s1_b");
ok(sa.auto && sa.auto.crew === 2 && !sb.auto && /Daegan or a partner|No pair/.test(VS.needs.find(n => n.key === "t_s1_b").why), "two trips the same day on a 2-person crew: the first gets the pair, the second waits in Needs you");
const VS2 = SC.buildCalendar({ jobs: [{ ...jS[0], returnTrips: [{ ...jS[0].returnTrips[0], assignedTo: "Callen Jakeman" }] }], schedules: [{ Type: "job", Reference: "9-1", Date: "2026-11-24", Staff: { Name: "Daegan Smith" }, Blocks: [{ Hrs: 10 }] }], phaseHours: {}, today, weeks: 5, users: usersS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(!VS2.items.find(x => x.key === "t_s1_a").auto && /can't go alone/.test(VS2.needs.find(n => n.key === "t_s1_a").why), "a crew member is never sent alone: no partner free means Needs you");
const VS3 = SC.buildCalendar({ jobs: [{ ...jS[0], returnTrips: [{ ...jS[0].returnTrips[1] }] }], schedules: [{ Type: "job", Reference: "9-1", Date: "2026-11-24", Staff: { Name: "Callen Jakeman" }, Blocks: [{ Hrs: 10 }] }], phaseHours: {}, today, weeks: 5, users: usersS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const s3 = VS3.items.find(x => x.key === "t_s1_b").auto;
ok(s3 && s3.crew === 1 && /Only Daegan free that day, no second person/.test(s3.held), "a foreman may go alone only when no second person is free, held");

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("scramble-cal-test: all passed");
