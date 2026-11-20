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
  { id: "a1407", simproNo: "1407", name: "Tolbert Residence", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "12/1/2026", finishStartConfirmed: true, finishMaterials: [],
    returnTrips: [{ id: "t4", number: 4, rtStatus: "needs", scope: "Add 3 kitchen cans" }] },
  { id: "a959", simproNo: "959", name: "Stratton Residence", roughStatus: "complete", finishStatus: "",
    returnTrips: [{ id: "t2", number: 2, rtStatus: "scheduled", rtStatusDate: "10/28/2026", assignedTo: "Abraham Tristan" }, { id: "old", rtStatus: "complete" }] },
  { id: "a889", simproNo: "889", name: "Rose", roughStatus: "complete", finishStatus: "inprogress", finishProjectedStart: "10/26/2026", finishStartConfirmed: true },
  { id: "a1382", simproNo: "1382", name: "Riverton Retail", roughStatus: "waiting_date", roughProjectedStart: "10/19/2026", roughStartConfirmed: true, roughMaterials: [{ needsOrder: true }] },
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
ok(bc.crewBooked === 2 && bc.left === 2465 && bc.auto && bc.auto.s === "2026-11-23" && bc.auto.crew === 2, "its hours left (less today's booked hours, which last night's Job Costs doesn't have yet) run on from Monday at the booked crew size");
ok(!bc.inList && bc.onCal && !bc.flags.length, "booked ahead: on the calendar, not on the list, no flag");
const trip = K("t_a1421_t1");
ok(trip && trip.kind === "trip" && trip.tag === "Return trip #1" && trip.booked.length === 1 && trip.flags.length === 1 && /Booked in Simpro 11\/19, no material on the trip: send a PO/.test(trip.flags[0]), "Hightower trip #1 takes its booked Thursday; booked with no material on the trip, so it's flagged (v663)");
const hf = K("j_a1421_f");
ok(hf && !hf.booked.length, "the trip's Simpro day isn't counted on Hightower's finish too");
const cm = K("j_a1402_f");
ok(cm.start.iso === "2026-11-23" && cm.start.conf && cm.inList && cm.flags.join() === "Starts Mon 11/23, not booked", "Cougar Moon: confirmed start, not booked, flagged, PO is fine");
const tb = K("j_a1407_f");
ok(tb.flags.includes("Starts Tue 12/1, not booked") && tb.flags.includes("Finish starts with no material PO"), "Tolbert finish: not booked and no material PO");
const t4 = K("t_a1407_t4");
ok(t4 && t4.flags.join() === "No material on the trip: send a PO,Not scheduled, no date or crew" && t4.inList, "Tolbert trip #4 has no date or crew, and no material so it asks for a PO");
const st2 = K("t_a959_t2");
ok(st2 && st2.flags.filter(f => !/send a PO/.test(f)).join() === "Was set for 10/28, not done", "Stratton trip #2 is past its date and still open");
ok(!V.items.some(x => x.key === "t_a959_old"), "a completed trip doesn't show");
const rose = K("j_a889_f");
ok(rose.over && rose.leftBy && rose.left > 0 && !rose.flags.length, "Rose is over bid but in progress: the rest comes from its stage (v661: \"those are both actively going right now\"), not flagged");
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
ok(tb3.auto && tb3.auto.s === "2026-12-02" && tb3.auto.staff[0].name === "Louis Hoffman" && tb3.auto.held === "Confirmed start 12/1, but Daegan's crew isn't free until 12/2. Finish starts with no material PO" && tb3.redDay === "2026-12-01" && N3("j_a1407_f").held, "Tolbert (Louis, jr foreman) runs with Daegan's crew after Cougar Moon, Louis leading, held because its confirmed 12/1 start can't be met and for no material PO; 12/1 keeps a red marker");
ok(K3("j_a1412_r").auto.src === undefined && K3("j_a1412_r").auto.s === "2026-11-23", "a Simpro tail stays as it was");
ok(!K3("j_a1382_r").auto && N3("j_a1382_r").why === "Zane's crew is booked through 12/18", "Riverton: Zane's crew is on Battle Creek through the view, so it's held for you, not double-booked");
const t43 = K3("t_a1407_t4");
ok(t43.auto && t43.auto.src === "auto" && /^No date or crew set in Command Center, so it's on the first open day/.test(t43.auto.held) && t43.auto.staff[0].name === "Louis Hoffman" && N3("t_a1407_t4").held && /Was set for 10\/28, not done/.test(N3("t_a959_t2").why), "a trip with no date or crew goes on the first open day for the job crew, held; a passed date goes to Needs you");
ok(N3("t_a77_x1").why === "Joel is unassigned on the Crew Board" && !K3("t_a77_x1").auto, "a trip for an unassigned person is never scheduled");
const x2 = K3("t_a77_x2");
ok(x2.auto && x2.auto.s === "2026-11-30" && x2.auto.staff[0].name === "Jose Sanchez" && !x2.auto.held && x2.flags.includes("No material on the trip: send a PO"), "a dated trip with no material still lands on its day for its person, not held, flagged to send a PO (v663)");
ok(!V3.items.some(it => it.auto && it.auto.staff && it.auto.staff.some(p => /Joel|Bailey/.test(p.name))), "no unassigned or inactive person is ever on a block");
ok(K3("j_a1382_r").inList === false && V3.list.every(x => !x.need), "Needs you items leave the Not on the calendar list");
ok(SC.buildCalendar({ jobs: jobs3, schedules, phaseHours, today, weeks: 5 }).needs.length === 0, "with no Crew Board the auto-schedule stays off");
const V4 = A({ "j_a1402_f": { s: "2026-11-23", hours: 140, crew: 2, by: "Koy Wilkinson" } });
const cm4 = V4.items.find(x => x.key === "j_a1402_f"), tb4 = V4.items.find(x => x.key === "j_a1407_f");
// v663: a plan with no names has nobody on it (red on the calendar), so it holds nobody; a plan with names holds those people
ok(cm4.plan && !cm4.auto && tb4.auto && tb4.auto.s < "2026-12-07", "a kept plan with no names never moves and holds nobody (Tolbert isn't pushed behind it)");
{ const tbPpl = tb4.auto.staff.map(x => x.name), V4n = A({ "j_a1402_f": { s: "2026-11-23", hours: 140, crew: tbPpl.length, staff: tbPpl.map(name => ({ name })), by: "Koy Wilkinson" } });
  const tbN = V4n.items.find(x => x.key === "j_a1407_f");
  ok(!tbN.auto || tbN.auto.s > tb4.auto.s || !tbN.auto.staff.some(x => tbPpl.includes(x.name)) || tbN.auto.pd, "a kept plan with names holds those people's days"); }
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
ok(Y.staff[0].name === "Louis Hoffman" && Y.crew === 2 && SC.planDays(Y).some(d => d.date === X.s) && !Y.held, "the jr foreman takes the other job the same days with the rest; 2 on a job is fine, not held (Koy: \"We want 4 but sometimes it's just 2. That's fine\")");
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
ok(SB.blocksFor(2, 0, "07:00").blocks[0].EndTime === "09:00" && SB.blocksFor(8, 0, "09:00").blocks[0].StartTime === "09:00" && SB.blocksFor(8, 0, "09:00").blocks[0].EndTime === "17:00", "a booking starts at the day's start time: a 2-hour trip 7 to 9, the job after it 9 to 5");
ok(SB.buildEntries([{ date: "2026-11-23", hours: 8, start: "09:00" }], [{ id: 1, name: "A" }], {})[0].blocks[0].StartTime === "09:00", "entries carry the start time");
ok(/between 5:00 AM and 5:00 PM/.test(SB.validate({ ...base, days: [{ date: "2026-11-23", hours: 2, start: "04:00" }] }, "2026-11-17")) && SB.validate({ ...base, days: [{ date: "2026-11-23", hours: 2, start: "09:30" }] }, "2026-11-17") === "", "start times are checked");
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
ok(sa.auto && sa.auto.crew === 2 && sb.auto && sb.auto.s === "2026-11-24" && SC.slotsOf(sa.auto)[0].label === "7:00 AM–11:00 AM" && SC.slotsOf(sb.auto)[0].label === "11:00 AM–3:00 PM", "two 4-hour trips the same day on a 2-person crew: the pair does one, then the other");
const VS2 = SC.buildCalendar({ jobs: [{ ...jS[0], returnTrips: [{ ...jS[0].returnTrips[0], assignedTo: "Callen Jakeman" }] }], schedules: [{ Type: "job", Reference: "9-1", Date: "2026-11-24", Staff: { Name: "Daegan Smith" }, Blocks: [{ Hrs: 10 }] }], phaseHours: {}, today, weeks: 5, users: usersS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(!VS2.items.find(x => x.key === "t_s1_a").auto && /can't go alone/.test(VS2.needs.find(n => n.key === "t_s1_a").why), "a crew member is never sent alone: no partner free means Needs you");
const VS3 = SC.buildCalendar({ jobs: [{ ...jS[0], returnTrips: [{ ...jS[0].returnTrips[1] }] }], schedules: [{ Type: "job", Reference: "9-1", Date: "2026-11-24", Staff: { Name: "Callen Jakeman" }, Blocks: [{ Hrs: 10 }] }], phaseHours: {}, today, weeks: 5, users: usersS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const s3 = VS3.items.find(x => x.key === "t_s1_b").auto;
ok(s3 && s3.crew === 1 && /Only Daegan free that day, no second person/.test(s3.held), "a foreman may go alone only when no second person is free, held");

// Set pairs on the Crew Board (Koy 2026-11-19): schedule by them instead of guessing.
const usersP = users6.map(u => u.id === "l" ? { ...u, pairId: "jl" } : u.id === "jl" ? { ...u, pairId: "l" } : u.id === "t" ? { ...u, pairId: "c" } : u.id === "c" ? { ...u, pairId: "t" } : u.id === "au" ? { ...u, pairId: "p" } : u.id === "p" ? { ...u, pairId: "au" } : u);
const bP = SC.crewBoard(usersP);
ok(bP.partnerOf("Louis Hoffman") === "James Livingston" && bP.partnerOf("James Livingston") === "Louis Hoffman" && bP.partnerOf("Daegan Smith") === "", "a pair counts when both point at each other");
ok(SC.crewBoard(users6.map(u => u.id === "l" ? { ...u, pairId: "jl" } : u)).partnerOf("Louis Hoffman") === "", "a one-sided pair is ignored, never guessed");
ok(SC.crewBoard(usersP.map(u => u.id === "jl" ? { ...u, foremanId: "k" } : u)).partnerOf("Louis Hoffman") === "James Livingston", "anybody with anybody: a pair across two crews counts (Koy: \"pair anybody with anybody\")");
const uFL = users6.map(u => u.id === "d" ? { ...u, pairId: "t" } : u.id === "t" ? { ...u, pairId: "d" } : u);
ok(SC.crewBoard(uFL).partnerOf("Daegan Smith") === "Trever Worley", "a foreman can pair with a lead");
const jX = [{ id: "tx", simproNo: "71", name: "Cross trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
  returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Louis Hoffman", material: "x" }] }];
const uX = users6.map(u => u.id === "l" ? { ...u, pairId: "p" } : u.id === "p" ? { ...u, pairId: "l" } : u);
ok(SC.buildCalendar({ jobs: jX, schedules: [], phaseHours: {}, today, weeks: 5, users: uX, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" }).items.find(x => x.key === "t_tx_a").auto.staff[1].name === "Payton Bolda", "a trip takes a pair from another crew");
const uU = users6.map(u => u.id === "l" ? { ...u, pairId: "jo" } : u.id === "jo" ? { ...u, pairId: "l" } : u);
ok(SC.buildCalendar({ jobs: jX, schedules: [], phaseHours: {}, today, weeks: 5, users: uU, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" }).items.find(x => x.key === "t_tx_a").auto.staff.every(p => p.name !== "Joel Fey"), "a pair who is Unassigned is never scheduled");
const jP = [{ id: "tp", simproNo: "70", name: "Pair trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
  returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Louis Hoffman", material: "x" }] }];
const VP = SC.buildCalendar({ jobs: jP, schedules: [], phaseHours: {}, today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VP.items.find(x => x.key === "t_tp_a").auto.staff.map(p => p.name).join() === "Louis Hoffman,James Livingston", "a trip takes its person's set pair");
const VP0 = SC.buildCalendar({ jobs: jP, schedules: [], phaseHours: {}, today, weeks: 5, users: users6, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VP0.items.find(x => x.key === "t_tp_a").auto.staff[1].name === "Callen Jakeman", "with no pairs set, the old rule (first crew member) still holds");
const VP2 = SC.buildCalendar({ jobs: jP, schedules: [{ Type: "job", Reference: "9-1", Date: "2026-11-24", Staff: { Name: "James Livingston" }, Blocks: [{ Hrs: 10 }] }], phaseHours: {}, today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VP2.items.find(x => x.key === "t_tp_a").auto.staff[1].name !== "James Livingston" && VP2.items.find(x => x.key === "t_tp_a").auto.crew === 2, "when the pair is out, someone else from the crew goes");
const V5P = SC.buildCalendar({ jobs: jobs5, schedules: [], phaseHours: { "500": { r: [0, 120] }, "501": { r: [0, 300] }, "502": { r: [0, 200] } }, today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const XP = V5P.items.find(i => i.key === "j_x_r").auto, YP = V5P.items.find(i => i.key === "j_y_r").auto, ZP = V5P.items.find(i => i.key === "j_z_r").auto;
ok(XP.staff.map(p => p.name).join() === "Daegan Smith,Trever Worley,Callen Jakeman" && YP.staff.map(p => p.name).join() === "Louis Hoffman,James Livingston", "two jobs at once: pairs stay whole (Trever + Callen with Daegan, Louis + James on the other)");
ok(ZP.crew === 4 && ZP.staff.some(p => p.name === "Austin Schut") && ZP.staff.some(p => p.name === "Payton Bolda"), "a 4-person job is built from whole pairs");

// Koy 2026-11-19: time off on the calendar, never booked; company holidays never booked, work moves to the next day.
const VH = SC.buildCalendar({ jobs: jobs3, upcoming, schedules, phaseHours, today, weeks: 8, users, holidays: SC.DEFAULT_HOLIDAYS, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VH.holidays["2026-11-26"] === "Thanksgiving" && VH.holidays["2026-12-25"] === "Christmas" && VH.holidays["2026-12-31"] === "New Year's Eve", "holidays come from the list, with their names");
ok(VH.items.every(it => !it.auto || SC.planDays(it.auto).every(d => !VH.holidays[d.date])), "nothing auto-scheduled lands on a holiday");
ok(SC.planDays({ s: "2026-12-30", hours: 20, crew: 1 }).map(d => d.date).join() === "2026-12-30,2027-01-04", "a block running into New Year's Eve and New Year's Day picks up the next Monday");
const VH2 = SC.buildCalendar({ jobs: [], schedules: [], today, weeks: 5, holidays: [{ date: "2026-12-02", name: "Shop day" }] });
ok(VH2.holidays["2026-12-02"] === "Shop day" && !VH2.holidays["2026-11-26"], "the list is what counts: an added day is off, a removed one isn't");
SC.setHolidays(null);
const VO = SC.buildCalendar({ jobs: jS, schedules: [], phaseHours: {}, today, weeks: 5, users: usersS, timeOff: [{ name: "Daegan Smith", start: "2026-11-24", end: "2026-11-24" }], effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VO.offByDay["2026-11-24"].includes("Daegan Smith"), "time off shows by day");
const oa = VO.items.find(x => x.key === "t_s1_a"), ob = VO.items.find(x => x.key === "t_s1_b");
ok(!(oa.auto && oa.auto.staff.some(p => p.name === "Daegan Smith")) && !(ob.auto && ob.auto.s === "2026-11-24"), "nobody is booked on a day they're off");
const VO2 = SC.buildCalendar({ jobs: jS, schedules: [], phaseHours: {}, today, weeks: 5, users: usersS, plans: { t_s1_b: { s: "2026-11-30", hours: 10, crew: 1, staff: [{ name: "Daegan Smith" }] } }, timeOff: [{ name: "Daegan", start: "11/30/2026" }], effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VO2.items.find(x => x.key === "t_s1_b").flags.some(f => /Daegan is off 11\/30/.test(f)), "a kept plan on someone's day off is flagged");

// Koy 2026-11-19: "none of them have time assignments. tuhaye hollow RT monday wont take all day"
ok(SC.tripHours("2 hrs") === 2 && SC.tripHours("half day") === 5 && SC.tripHours("45 min") === 0.75 && SC.tripHours("1 day") === 10 && SC.tripHours("") === 0, "a trip's est. time reads as hours");
const jT = [{ id: "tt", simproNo: "80", name: "Short trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
  returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/23/2026", assignedTo: "Louis Hoffman", material: "x", time: "2 hrs" }] },
  { id: "tj", simproNo: "81", name: "Same day job", roughStatus: "inprogress", foreman: "Daegan Smith", roughMaterials: [{ ordered: true }] }];
const VT = SC.buildCalendar({ jobs: jT, schedules: [], phaseHours: { "81": { r: [0, 80] } }, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const tT = VT.items.find(x => x.key === "t_tt_a").auto, jJ = VT.items.find(x => x.key === "j_tj_r").auto;
ok(tT.hours === 4 && SC.slotsOf(tT)[0].label === "7:00 AM–9:00 AM", "a 2-hour trip for two is 7:00 to 9:00");
const jd = (iso) => SC.slotsOf(jJ).find(x => x.date === iso);
ok(jJ && jd("2026-11-23").from === 9 && jd("2026-11-23").to <= 17 && jd("2026-11-18").from === 7, "the pair goes on to the job after the trip the same day (from 9:00, done by 5:00); other days start at 7:00");
ok(SC.slotsOf({ s: "2026-11-23", hours: 6, crew: 2, t: "12:30" })[0].label === "12:30 PM–3:30 PM", "a start time someone set is kept");
// Koy 2026-11-19: "why is kweller finish there? it has no confirmed start date or anything"
const jK = [{ id: "kw", simproNo: "1107", name: "Kweller", roughStatus: "complete", finishStatus: "waiting_date", foreman: "Daegan Smith",
  returnTrips: [{ id: "r6", number: 6, rtStatus: "complete", signedOff: true, rtStatusDate: "11/19/2026", assignedTo: "Abraham Tristan" }] }];
const schK = [{ Type: "job", Reference: "1107-1", Date: "2026-11-19", Staff: { Name: "Abraham Tristan" }, Blocks: [{ Hrs: 8 }] }];
const VK = SC.buildCalendar({ jobs: jK, schedules: schK, phaseHours: { "1107": { f: [0, 120] } }, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
const kF = VK.items.find(x => x.key === "j_kw_f");
ok(kF && !kF.auto && !kF.booked.length && kF.inList && VK.items.find(x => x.key === "t_kw_r6").booked.length === 1, "a done trip's Simpro day stays the trip's: the finish gets no booking and no forecast, it stays on the list");
const jU = [{ id: "un", simproNo: "90", name: "Est only", roughStatus: "waiting_date", roughProjectedStart: "11/30/2026", foreman: "Daegan Smith", roughMaterials: [{ ordered: true }] }];
const VU = SC.buildCalendar({ jobs: jU, schedules: [], phaseHours: { "90": { r: [0, 80] } }, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
ok(VU.items.find(x => x.key === "j_un_r").auto && VU.items.find(x => x.key === "j_un_r").auto.s === "2026-11-30" && !VU.items.find(x => x.key === "j_un_r").inList, "an estimated start is placed on its date too, so it doesn't get missed (v663); Remove takes it off");

// v660: other work that needs a date (Koy 2026-11-20: "Would be really awesome if QC's that need to be scheduled show up here too")
{
  const t2 = SC.addDays(SC.ymd(today), 7);
  const jT = [
    { id: "qa", simproNo: "501", name: "QC Job", qcStatus: "needs", finishQcStatus: "scheduled", finishQcStatusDate: t2, roughStatus: "complete", finishStatus: "" },
    { id: "qb", simproNo: "502", name: "Quick One", quickJob: true, quickJobType: "service", quickJobStatus: "new" },
    { id: "qc", simproNo: "", name: "Ped Lot 3", tempPed: true, tempPedStatus: "ready" },
    { id: "qd", simproNo: "503", name: "CO Job", roughStatus: "complete", finishStatus: "", changeOrders: [{ id: "c1", coStatus: "approved", time: "3 hrs" }, { id: "c2", coStatus: "approved" }], returnTrips: [{ id: "t9", fromCOId: "c2", rtStatus: "needs" }],
      fourWayTargetDate: t2 },
  ];
  const VT = SC.buildCalendar({ jobs: jT, schedules: [], phaseHours: {}, today, weeks: 5, users, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
  const k = (key) => VT.items.find(x => x.key === key);
  ok(k("x_rqc_qa") && k("x_rqc_qa").inList && SC.groupOf(k("x_rqc_qa")) === "qcwalk" && !k("x_rqc_qa").auto, "a rough QC walk that needs a date is on the list under QC walks, never auto-placed");
  ok(k("x_fqc_qa") && !k("x_fqc_qa").inList && (k("x_fqc_qa").ccDays || [])[0] === t2, "a QC walk scheduled in Command Center shows on its day, not on the list");
  ok(k("x_qj_qb") && k("x_qj_qb").inList && k("x_qj_qb").tag === "Service call" && SC.groupOf(k("x_qj_qb")) === "quick", "a new quick job needs a date, under Quick jobs");
  ok(k("x_tp_qc") && k("x_tp_qc").inList && k("x_tp_qc").tag === "Temp ped install", "a temp ped ready to schedule is on the list");
  ok(k("x_co_qd_c1") && k("x_co_qd_c1").tripH === 3 && !k("x_co_qd_c2"), "an approved change order not made into a trip is on the list with its time; a converted one isn't twice");
  ok(k("x_rin_qd") && (k("x_rin_qd").ccDays || [])[0] === t2, "a rough inspection with a target date is a marker on its day");
  const VW = SC.buildCalendar({ jobs: jT, schedules: [], phaseHours: {}, today, weeks: 5, users, plans: { x_rqc_qa: { off: true, why: "Waiting on material", note: "panel", at: "2026-11-20T00:00:00Z" } }, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
  const w = VW.items.find(x => x.key === "x_rqc_qa");
  ok(w.off && w.off.why === "Waiting on material" && w.inList && SC.groupOf(w) === "wait" && SC.GROUPS[0][0] === "wait", "removed with a reason: Waiting, first on the list, with its reason");
}

// v661: a finish in progress with Job Costs used up still goes on (Koy: "why is Ashcraft not showing up on the finishes?")
{
  const jR = [{ id: "rose", simproNo: "889", name: "Rose", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "80%", finishProjectedStart: "10/26/2026", finishStartConfirmed: true }];
  const VR = SC.buildCalendar({ jobs: jR, schedules: [], phaseHours: { "889": { f: [1080, 1027] } }, today, weeks: 5, users: users6, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
  const r = VR.items.find(x => x.key === "j_rose_f");
  ok(r && r.leftBy === "stage" && Math.abs(r.left - 205.4) < 0.2 && r.auto && !r.auto.held && !VR.needs.some(n => n.key === "j_rose_f"), "an in-progress finish over bid is placed from its stage (20% of 1027 h), not held or dropped");
  const VQ = SC.buildCalendar({ jobs: jR, schedules: [], phaseHours: {}, today, weeks: 5, users: users6, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" });
  const q = VQ.items.find(x => x.key === "j_rose_f");
  ok(q && q.leftBy === "week" && q.auto, "an in-progress finish with no bid hours gets a week");
}

// v661: Book refuses overlap with anything already in Simpro for that person that day
{
  const e = SB.buildEntries([{ date: "2026-11-23", hours: 2.5, start: "07:00" }], [{ id: 338, name: "Noah Davis" }, { id: 77, name: "Jacob Spackman" }], {});
  const rows = [{ Type: "activity", Reference: "7", Staff: { ID: 338 }, Date: "2026-11-23", Blocks: [{ StartTime: "07:00", EndTime: "17:00" }] },
    { Type: "job", Reference: "1277-1", Staff: { ID: 77 }, Date: "2026-11-23", Blocks: [{ StartTime: "09:30", EndTime: "12:00" }] }];
  const o = SB.overlaps(rows, e);
  ok(o.length === 1 && o[0].name === "Noah Davis" && o[0].type === "activity", "Book refuses a person with time off over that time; a booking that only touches (9:30 start) is fine");
  ok(SB.overlaps(rows, SB.buildEntries([{ date: "2026-11-23", hours: 3, start: "07:00" }], [{ id: 77, name: "Jacob Spackman" }], {})).length === 1, "Book refuses an overlap with another job already booked");
}

// v661: the job box sets one day's people and time; other days keep the job's own
{
  const base = { s: "2026-11-23", hours: 80, crew: 2, staff: [{ name: "A" }, { name: "B" }] };
  const pd = SC.pdOf([{ d: "2026-11-24", n: ["A"], t: "07:00", e: "12:00" }]);
  const sl = SC.slotsOf({ ...base, pd });
  ok(sl[0].date === "2026-11-23" && sl[0].hours === 10 && !sl[0].staff, "day 1 keeps both people for a full day");
  ok(sl[1].date === "2026-11-24" && sl[1].hours === 5 && sl[1].start === "07:00" && sl[1].staff.length === 1 && sl[1].crew === 1, "day 2 is just A, 7 to 12");
  ok(Math.abs(sl.reduce((a, d) => a + d.hours * (d.crew || 2), 0) - 80) < 0.01, "the job's hours still all get placed (" + sl.map(d => d.date.slice(8) + ":" + d.hours).join(" ") + ")");
  const half = SC.slotsOf({ s: "2026-11-23", hours: 10, crew: 2, staff: base.staff, t: "07:00", e: "12:00" });
  ok(half.length === 1 && half[0].label === "7–12" || (half.length === 1 && half[0].hours === 5), "a half-day trip for two is one day, 7 to 12");
  const e = SB.buildEntries([{ date: "2026-11-23", hours: 10 }, { date: "2026-11-24", hours: 5, start: "07:00", staffIds: [1] }], [{ id: 1, name: "A" }, { id: 2, name: "B" }], {});
  ok(e.length === 3 && e.filter(x => x.date === "2026-11-24").length === 1, "Book writes day 2 for A only");
  const v = { mode: "preview", jobNo: "1402", phase: "rough", staffIds: [1, 2] };
  ok(SB.validate({ ...v, days: [{ date: "2026-11-24", hours: 5, staffIds: [1] }] }, "2026-11-17") === "", "a day's own people pass when they're picked");
  ok(/isn't in the people picked/.test(SB.validate({ ...v, days: [{ date: "2026-11-24", hours: 5, staffIds: [3] }] }, "2026-11-17")), "a day can't book someone not picked");
}

// v662: the auto layout can't double-book anyone
{
  const ef = j => j.roughStatus || "", eff = j => j.finishStatus || "";
  // a late first day (Zane has 5 h elsewhere Wed) rolls the job onto Thu, when Braden is booked all day: it must not go there
  const jA = [{ id: "za", simproNo: "610", name: "Late start", foreman: "Zane Watkins", roughStatus: "inprogress", roughMaterials: [{ ordered: true }] }];
  const sA = [{ Type: "job", Reference: "900-1", Date: "2026-11-18", Staff: { Name: "Zane Watkins" }, Blocks: [{ Hrs: 5 }] },
    { Type: "job", Reference: "901-1", Date: "2026-11-19", Staff: { Name: "Braden Davis" }, Blocks: [{ Hrs: 10 }] }];
  const A1 = SC.buildCalendar({ jobs: jA, schedules: sA, phaseHours: { "610": { r: [0, 20] } }, today, weeks: 5, users, effRS: ef, effFS: eff }).items.find(x => x.key === "j_za_r");
  const onThu = A1.auto && SC.slotsOf(A1.auto).some(d => d.date === "2026-11-19");
  ok(A1.auto && !onThu, "a job that would roll onto a day someone is booked elsewhere waits for a clear run (starts " + (A1.auto && A1.auto.s) + ")");
  // the forecast after a Simpro booking: Callen is booked on another job Mon 11/23, so he comes off that day and the hours run on
  const jB = [{ id: "tb", simproNo: "620", name: "Tail", foreman: "Daegan Smith", roughStatus: "inprogress", roughMaterials: [{ ordered: true }] }];
  const sB = [{ Type: "job", Reference: "620-1", Date: "2026-11-19", Staff: { Name: "Daegan Smith" }, Blocks: [{ Hrs: 10 }] }, { Type: "job", Reference: "620-1", Date: "2026-11-19", Staff: { Name: "Callen Jakeman" }, Blocks: [{ Hrs: 10 }] },
    { Type: "job", Reference: "700-1", Date: "2026-11-23", Staff: { Name: "Callen Jakeman" }, Blocks: [{ Hrs: 10 }] }];
  const B1 = SC.buildCalendar({ jobs: jB, schedules: sB, phaseHours: { "620": { r: [0, 60] } }, today, weeks: 5, users, effRS: ef, effFS: eff }).items.find(x => x.key === "j_tb_r");
  const sl = B1.auto ? SC.slotsOf(B1.auto) : [], mon = sl.find(d => d.date === "2026-11-23");
  ok(mon && mon.staff && mon.staff.map(x => x.name).join() === "Daegan Smith", "Callen comes off the forecast on the day he's booked elsewhere; Daegan goes on");
  ok(Math.abs(sl.reduce((a, d) => a + d.hours * (d.crew || 2), 0) - 40) < 0.01, "the forecast still lays all 40 hours left (" + sl.map(d => d.date.slice(5) + ":" + d.hours + "x" + (d.crew || 2)).join(" ") + ")");
  // nobody free that day: the day is skipped
  const sC = sB.concat([{ Type: "activity", Reference: "7", Date: "2026-11-23", Staff: { Name: "Daegan Smith" }, Blocks: [{ Hrs: 10 }] }]);
  const C1 = SC.buildCalendar({ jobs: jB, schedules: sC, phaseHours: { "620": { r: [0, 60] } }, today, weeks: 5, users, effRS: ef, effFS: eff }).items.find(x => x.key === "j_tb_r");
  ok(C1.auto && !SC.slotsOf(C1.auto).some(d => d.date === "2026-11-23") && SC.slotsOf(C1.auto)[0].date === "2026-11-24", "a forecast day when nobody on it is free is skipped");
  ok(SC.pdOf([{ d: "2026-11-23", x: 1 }])["2026-11-23"].skip === true, "a skipped day saves and loads back");
}

// ── v663: the review's fixes ─────────────────────────────────────────────────
{
  const t0 = new Date(2026, 10, 23, 9);   // Mon 11/23/2026
  const us = [{ id: "f1", name: "Colby Stone", title: "foreman" }, { id: "j1", name: "Jake Reed", title: "jrforeman", foremanId: "f1" },
    { id: "c1", name: "Noah Pine", title: "crew", foremanId: "f1" }, { id: "c2", name: "Daegan", title: "crew", foremanId: "f1" },
    { id: "u1", name: "Uri Loose", title: "crew" }, { id: "f2", name: "Solo Sam", title: "foreman" }];
  const sc = (ref, name, date, st, en) => ({ Type: "job", Reference: ref, Date: date, Staff: { ID: 1, Name: name }, Blocks: [{ Hrs: parseInt(en, 10) - parseInt(st, 10), StartTime: st, EndTime: en }] });
  const jb = (o) => Object.assign({ id: "J" + o.simproNo, name: "Job " + o.simproNo, foreman: "Colby Stone", roughMaterials: [{ ordered: true }], finishMaterials: [{ ordered: true }] }, o);
  const run = (jobs, schedules, phaseHours) => SC.buildCalendar({ jobs, schedules, phaseHours, today: t0, weeks: 3, users: us, timeOff: [] });
  const crew4 = ["Colby Stone", "Jake Reed", "Noah Pine", "Daegan"], conf = jb({ simproNo: "100", roughStatus: "date_confirmed", roughStatusDate: "2026-11-24" });
  const on = (it, iso) => SC.slotsOf(it.auto).filter(d => d.date === iso).flatMap(d => (d.staff || it.auto.staff).map(x => x.name));
  // a Simpro booking under a longer name still blocks the Crew Board person
  let V6 = run([conf], ["2026-11-24", "2026-11-25"].map(d => sc("900-1", "Daegan Smith", d, "07:00", "17:00")), { 100: { r: [0, 80] } }), a = V6.items.find(x => x.key === "j_J100_r");
  ok(a.auto && !on(a, "2026-11-24").includes("Daegan") && !on(a, "2026-11-25").includes("Daegan"), "Simpro's \"Daegan Smith\" blocks the Crew Board's \"Daegan\": he isn't forecast on a day he's booked");
  // an afternoon booking is not "the first 4 hours of the day"
  V6 = run([conf], crew4.map(n => sc("900-1", n, "2026-11-24", "13:00", "17:00")), { 100: { r: [0, 40] } }); a = V6.items.find(x => x.key === "j_J100_r");
  ok(a.auto && !SC.slotsOf(a.auto).some(d => d.date === "2026-11-24"), "a 1:00 PM Simpro booking holds the day: nothing is laid 11:00 to 5:00 on top of it");
  ok(/Confirmed start 11\/24, but Colby's crew isn't free until 11\/25/.test(a.auto.held) && a.redDay === "2026-11-24" && V6.needs.some(n => n.key === a.key && n.held), "a confirmed start the crew can't make is held under Needs you and its day keeps a red marker");
  // nobody free in the view: still on its day
  const all = []; for (let i = 0; i < 21; i++) crew4.forEach(n => all.push(sc("900-1", n, SC.addDays("2026-11-23", i), "07:00", "17:00")));
  V6 = run([conf], all, { 100: { r: [0, 40] } }); a = V6.items.find(x => x.key === "j_J100_r");
  ok(!a.auto && a.need && a.redDay === "2026-11-24", "a job nobody can be put on stays on its day (red marker 11/24)");
  // the tail's people are the people forecast: nobody Unassigned, head count matches
  V6 = run([jb({ simproNo: "100", roughStatus: "inprogress", roughStatusDate: "2026-11-16" })],
    [...crew4.map(n => sc("100-1", n, "2026-11-23", "07:00", "17:00")), ...["Colby Stone", "Uri Loose"].map(n => sc("100-1", n, "2026-11-24", "07:00", "17:00"))], { 100: { r: [100, 300] } });
  a = V6.items.find(x => x.key === "j_J100_r");
  ok(a.auto && a.auto.crew === 1 && a.auto.staff.map(x => x.name).join() === "Colby Stone" && a.flags.some(f => /Uri is unassigned/.test(f)), "a forecast after a booking leaves off someone Unassigned and counts only its own people");
  ok(a.left === 140, "hours left take off today's booked hours too (300 est, 100 used, 40 today, 20 tomorrow)");
  // rough in progress keeps the calendar while the finish only has a date
  V6 = run([jb({ simproNo: "100", roughStatus: "inprogress", finishStatus: "date_confirmed", finishStatusDate: "2026-12-08" })], [], { 100: { r: [50, 200], f: [0, 120] } });
  a = V6.items.find(x => x.jobId === "J100");
  ok(a.kind === "rough" && a.auto && a.flags.some(f => /Finish is set for 12\/8/.test(f)), "a rough-in in progress stays on the calendar when its finish already has a date");
  // confirmed start, no Job Costs hours yet
  V6 = run([jb({ simproNo: "100", roughStatus: "", roughProjectedStart: "2026-11-24", roughStartConfirmed: true })], [], {});
  a = V6.items.find(x => x.jobId === "J100");
  ok(a && /No hours in Job Costs/.test(a.need || "") && a.redDay === "2026-11-24", "a confirmed start with no Job Costs hours yet shows under Needs you, on its day");
  // one person alone is held
  V6 = run([jb({ simproNo: "200", foreman: "Solo Sam", roughStatus: "date_confirmed", roughStatusDate: "2026-11-24" })], [], { 200: { r: [0, 40] } });
  a = V6.items.find(x => x.jobId === "J200");
  ok(a.auto && /Only Solo on it, no second person/.test(a.auto.held), "a foreman with no crew is placed alone only as a held block");
  const bk = SC.bookingsByNo([sc("900-1", "Noah Pine", "2026-11-24", "13:00", "17:00")])["900"]["2026-11-24"];
  ok(bk.from === 13 && bk.to === 17, "a Simpro day keeps its real clock window");
}

// ── v663: Book (server rules) ────────────────────────────────────────────────
{
  const SBK = require("../functions/scrambleBook.js");
  const rows = [{ Type: "activity", Reference: "PTO", Date: "2026-11-23", Staff: { ID: 5 }, Blocks: [{ Hrs: 10 }] }, { Type: "job", Reference: "900-1", Date: "2026-11-24", Staff: { ID: 5 }, Blocks: [{ Hrs: 10 }] }];
  ok(SBK.weekHours(rows, [5])[5]["2026-11-23"] === 10, "time off (a Simpro activity) doesn't count toward the 40; job hours do");
  const STK = require("../functions/scrambleTrip.js"), tsrc = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleTrip.js"), "utf8").replace(/\/\/.*$/gm, "");
  ok(!/Stage|roughStatus|finishStatus|quickJobStatus|qcStatus/.test(tsrc), "the trip marker only knows a trip's own schedule fields, never a job's stage or status");
  const trips = [{ id: "x1", rtStatus: "needs", rtStatusDate: "2026-12-01", needsByStart: "2026-11-25", needsSchedule: true }, { id: "x2", rtStatus: "complete" }];
  const b = STK.planTripBooked(trips, "x1", "2026-11-24", { at: "t", by: "Koy", path: "/jobs/77/sections/1/costCenters/2/schedules/", ids: [9001] });
  ok(b && b.after.rtStatus === "scheduled" && b.after.rtStatusDate === "2026-11-24" && b.after.rtScheduled && !b.after.needsSchedule && b.after.needsByStart === "" && b.after.calBooked.prev.rtStatus === "needs" && b.returnTrips[1] === trips[1],
    "a booked return trip is marked scheduled on the day booked; other trips untouched");
  ok(STK.planTripBooked(trips, "x2", "2026-11-24", {}) === null && STK.planTripBooked(trips, "nope", "2026-11-24", {}) === null, "a finished or unknown trip is never touched");
  const u = STK.planTripUnbooked(b.returnTrips, "x1", []);
  ok(u && u.after.rtStatus === "needs" && u.after.needsSchedule && !u.after.rtScheduled && u.after.rtStatusDate === "2026-12-01" && u.after.needsByStart === "2026-11-25" && !u.after.calBooked, "unscheduled in Simpro: the trip goes back to needs scheduling, as it was");
  const m = STK.planTripUnbooked(b.returnTrips, "x1", ["2026-11-30"]);
  ok(m && m.after.rtStatus === "scheduled" && m.after.rtStatusDate === "2026-11-30", "moved in Simpro: the trip's date follows");
  ok(STK.planTripUnbooked(b.returnTrips, "x1", ["2026-11-24"]) === null && STK.planTripUnbooked(trips, "x1", []) === null, "still booked, or never booked from the calendar: nothing changes");
}

// ── v663: Fridays by hand, trip cost center ──────────────────────────────────
{
  ok(SC.planDays({ s: "2026-11-27", hours: 40, crew: 2 }).map(d => d.date).join() === "2026-11-27,2026-11-30", "a block put on a Friday by hand starts that Friday, then carries on Monday");
  ok(SC.planDays({ s: "2026-11-28", hours: 20, crew: 2 })[0].date === "2026-11-30" && SC.nextWork("2026-11-27") === "2026-11-30", "a weekend still rolls to Monday, and the auto-schedule's own next workday skips Friday");
  const SBK = require("../functions/scrambleBook.js"), secs = [{ ID: 1, Name: "Base", ccs: [{ ID: 10, Name: "Rough In" }, { ID: 11, Name: "Finish" }] }];
  ok(SBK.pickCostCenter(secs, "trip", "rough").id === 10 && SBK.pickCostCenter(secs, "trip", "finish").id === 11 && SBK.pickCostCenter(secs, "trip").id === 11, "a return trip books to Rough In or Finish as its work says");
  ok(SBK.blocksFor(10, 30).ot === 0 && SBK.blocksFor(10, 40).ot === 10, "a Friday is normal time under 40 for the week and 1.5x once the week is past 40");
  const jt = [{ id: "ct", simproNo: "55", name: "CC test", roughStatus: "inprogress", returnTrips: [{ id: "a", number: 1, scope: "x" }, { id: "b", number: 2, scope: "y", fromFailedFinal: true }] }];
  const Vc = SC.buildCalendar({ jobs: jt, schedules: [], phaseHours: {}, today: new Date(2026, 10, 23, 9), weeks: 2 });
  ok(Vc.items.find(x => x.tripId === "a").cc === "rough" && Vc.items.find(x => x.tripId === "b").cc === "finish", "a trip on a job still in rough-in is Rough In work; a failed-final trip is Finish");
}

// ── v663: everybody can come off a block; it stays on its day ────────────────
{
  const p = { s: "2026-11-23", hours: 60, crew: 2, staff: [{ name: "A" }, { name: "B" }], pd: { "2026-11-24": { none: true } } };
  const sl = SC.slotsOf(p);
  ok(sl.map(d => d.date).join() === "2026-11-23,2026-11-24,2026-11-25" && sl[1].none && sl[1].staff.length === 0 && !sl[0].none && !sl[2].none, "a day with nobody on it keeps its place; the job's other days don't move");
  const one = SC.slotsOf({ s: "2026-11-23", hours: 10, crew: 1, staff: [], t: "07:00", e: "17:00", pd: { "2026-11-23": { none: true, t: "07:00", e: "17:00" } } });
  ok(one.length === 1 && one[0].none && one[0].date === "2026-11-23", "a one-day block with nobody on it stays on its day");
  const bb = SC.bookingsByNo([{ Type: "job", Reference: "70-1", Date: "2026-11-23", Staff: { Name: "Payton X" }, Blocks: [{ StartTime: "07:00", EndTime: "12:00", Hrs: 5 }] }, { Type: "job", Reference: "70-1", Date: "2026-11-23", Staff: { Name: "Gage Y" }, Blocks: [{ StartTime: "07:00", EndTime: "17:00", Hrs: 10 }] }])["70"]["2026-11-23"];
  ok(bb.from === 7 && bb.to === 17 && bb.win["Payton X"].join() === "7,12" && bb.win["Gage Y"].join() === "7,17", "a Simpro day keeps each person's own times (a half day isn't read as the whole day)");
}

// ── v663: Book the week counts the blocks ahead; short trips show as booked ──
{
  const SBK = require("../functions/scrambleBook.js");
  const ex = SBK.addPending({ 7: { "2026-11-23": 10 } }, [{ staffId: 7, date: "2026-11-24", hours: 10 }, { staffId: 7, date: "2026-11-25", hours: 20 }, { staffId: 9, date: "2026-11-24", hours: 10 }, { staffId: 7, date: "bad", hours: 5 }], [7]);
  ok(ex[7]["2026-11-23"] === 40 && !ex[9], "the week's earlier blocks count toward a person's 40, only for the people being booked");
  const fri = SBK.buildEntries([{ date: "2026-11-27", hours: 10 }], [{ id: 7, name: "P" }], ex);
  ok(fri[0].ot === 10 && fri[0].normal === 0, "a Friday after 40 hours of earlier blocks previews at 1.5x");
  const base = { mode: "preview", jobNo: "5", phase: "finish", staffIds: [7], days: [{ date: "2026-11-27", hours: 10 }] };
  ok(SBK.validate({ ...base, pending: [{ staffId: 7, date: "2026-11-24", hours: 10 }] }, "2026-11-23") === "" && SBK.validate({ ...base, mode: "book", hash: "a.b", pending: [] }, "2026-11-23") !== "" && SBK.validate({ ...base, pending: [{ staffId: 7, date: "x", hours: 1 }] }, "2026-11-23") !== "", "pending hours are a preview-only input and are checked");
  const sch = [{ Type: "job", Reference: "60-1", Date: "2026-11-24", Staff: { Name: "A B" }, Blocks: [{ StartTime: "07:00", EndTime: "07:30", Hrs: 0.5 }] }];
  ok(!SC.bookingsByNo(sch)["60"] || !SC.bookingsByNo(sch)["60"]["2026-11-24"], "a half-hour visit still doesn't count as a booked day for a phase");
  const Vt = SC.buildCalendar({ jobs: [{ id: "st", simproNo: "60", name: "Short trip", roughStatus: "complete", returnTrips: [{ id: "r1", number: 1, scope: "x", rtStatus: "scheduled", rtStatusDate: "2026-11-24" }] }], schedules: sch, phaseHours: {}, today: new Date(2026, 10, 23, 9), weeks: 2 });
  const tr = Vt.items.find(x => x.tripId === "r1");
  ok(tr && tr.booked.length === 1 && tr.booked[0].iso === "2026-11-24", "a half-hour return trip booked in Simpro shows as booked on its day");
}

// ── v663: set pairs stay whole (Koy 2026-11-20) ──────────────────────────────
{
  const opt = { today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" };
  const jD = [{ id: "td", simproNo: "72", name: "Foreman trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith",
    returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Daegan Smith", material: "x" }] }];
  const td = SC.buildCalendar({ jobs: jD, schedules: [], phaseHours: {}, ...opt }).items.find(x => x.key === "t_td_a");
  ok(td.auto && td.auto.staff.length === 1 && td.auto.held, "a trip never takes one half of a set pair to fill the second seat (the foreman goes alone, held for a call)");
  const pairs = [["Louis Hoffman", "James Livingston"], ["Trever Worley", "Callen Jakeman"], ["Austin Schut", "Payton Bolda"]];
  const jF = [1, 2, 3].map(n => ({ id: "pf" + n, simproNo: String(80 + n), name: "Pair phase " + n, roughStatus: "complete", finishStatus: "inprogress", foreman: "Daegan Smith" }));
  const Vp = SC.buildCalendar({ jobs: jF, schedules: [], phaseHours: { "81": { f: [0, 30] }, "82": { f: [0, 60] }, "83": { f: [0, 100] } }, ...opt });
  const blocks = Vp.items.filter(x => x.auto && x.auto.staff && x.auto.staff.length);
  ok(blocks.length > 0 && blocks.every(x => { const on = x.auto.staff.map(p => p.name); return pairs.every(([a, b]) => on.includes(a) === on.includes(b)); }), "every auto block has both people of a set pair or neither");
}

// ── v671: Upcoming jobs with a confirmed start; a trip's block vs. who the trip names ──
{
  const opt = { today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" };
  const up = (o) => [{ id: "up1", name: "#1999 Upcoming House", foreman: "Daegan Smith", projectedStart: "12/1/2026", startConfirmed: true, ...o }];
  const U = (o, hrs) => SC.buildCalendar({ jobs: [], upcoming: up(o), schedules: [], phaseHours: {}, upHours: hrs || {}, ...opt }).items.find(x => x.upcoming);
  const a = U({}, { "1999": { est: 60, used: 0 } });
  ok(a && a.auto && a.auto.s === "2026-12-01" && a.auto.staff.length >= 2 && !a.inList, "an Upcoming job with a confirmed start, a foreman and bid hours is placed on its day with that crew");
  const b = U({ startConfirmed: false }, { "1999": { est: 60, used: 0 } });
  ok(b && !b.auto && b.inList, "an Upcoming job with only an estimated start stays on the list");
  const c = U({});
  ok(c && !c.auto && c.need && c.redDay === "2026-12-01" && !c.inList, "a confirmed Upcoming start with no hours goes to Needs you and sits red on its day");
  const d = U({ foreman: "" }, { "1999": { est: 60, used: 0 } });
  ok(d && !d.auto && d.need && d.redDay === "2026-12-01", "a confirmed Upcoming start with no foreman goes to Needs you, red on its day");
  const jT = [{ id: "tw", simproNo: "73", name: "Who trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith", returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Louis Hoffman", material: "x" }] }];
  const T = (staff) => SC.buildCalendar({ jobs: jT, schedules: [], phaseHours: {}, plans: { "t_tw_a": { s: "2026-11-24", hours: 8, crew: 2, staff: staff.map(name => ({ name })) } }, ...opt }).items.find(x => x.key === "t_tw_a");
  ok(T(["Austin Schut", "Payton Bolda"]).flags.some(f => /assigned to Louis, but the block has Austin, Payton/.test(f)), "a trip block with another crew on it is flagged");
  ok(!T(["Trever Worley", "Callen Jakeman"]).flags.some(f => /assigned to/.test(f)) && !T(["Louis Hoffman", "James Livingston"]).flags.some(f => /assigned to/.test(f)), "the named person, or anyone on their crew, is not flagged");
}

// ── v672: a phase at 100% with nothing left open stops holding people ──
{
  const opt = { today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" };
  const jobs = [{ id: "h1", simproNo: "95", name: "Hundred", roughStatus: "complete", finishStatus: "inprogress", finishStage: "100%", foreman: "Daegan Smith" }];
  const run = (openPunch) => SC.buildCalendar({ jobs, schedules: [], phaseHours: { "95": { f: [50, 100] } }, ...opt, ...(openPunch ? { openPunch } : {}) }).items.find(x => x.key === "j_h1_f");
  const done = run(() => 0), open = run(() => 2), off = run(null);
  ok(done.done100 && !done.auto && /100% with nothing left open/.test(done.need || "") && done.redDay, "at 100% with nothing open: no crew or hours forecast, and it's a call for a person, on its day");
  ok(!open.done100 && open.auto && open.auto.staff.length >= 2, "at 100% with punch still open: it keeps its forecast");
  ok(!off.done100 && off.auto, "without the open-items count the rule is off (older callers are unchanged)");
  const jobs2 = [{ ...jobs[0], finishStage: "90%" }];
  ok(!SC.buildCalendar({ jobs: jobs2, schedules: [], phaseHours: { "95": { f: [50, 100] } }, ...opt, openPunch: () => 0 }).items.find(x => x.key === "j_h1_f").done100, "under 100% it is never treated as done");
}

// ── v674: Simpro leave and activities; a leader alone because their pair is off ──
{
  const opt = { today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" };
  const leave = (name, date, s, e, type) => ({ Type: type || "leave", Date: date, Staff: { Name: name }, Blocks: [{ StartTime: s, EndTime: e, Hrs: 1 }] });
  const jobs = [{ id: "lv", simproNo: "96", name: "Leave test", roughStatus: "complete", finishStatus: "inprogress", finishStage: "20", foreman: "Daegan Smith" }];
  const V = SC.buildCalendar({ jobs, schedules: [leave("Trever Worley", "2026-11-25", "07:00", "17:00"), leave("Callen Jakeman", "2026-11-25", "07:00", "09:00", "activity")], phaseHours: { "96": { f: [0, 200] } }, ...opt });
  const board = SC.crewBoard(usersP), chips = SC.chipsOf(V, board), busy = SC.busyOf(chips, board, V), k = SC.dayCounts("2026-11-25", chips, busy, board, V, "All");
  ok((V.offByDay["2026-11-25"] || []).includes("Trever Worley") && k.out.includes("Trever Worley") && !k.open.includes("Trever Worley"), "a full day of leave in Simpro is a day off: listed Off, never open");
  ok(!V.items.some(it => it.auto && SC.slotsOf(it.auto).some(d => d.date === "2026-11-25" && (d.staff ? d.staff.map(x => x.name) : (it.auto.staff || []).map(x => x.name)).includes("Trever Worley"))), "and the auto-schedule doesn't put them on anything that day");
  ok(!(V.offByDay["2026-11-25"] || []).includes("Callen Jakeman") && (busy["Callen Jakeman"]["2026-11-25"] || []).some(b => b.key === "simpro-other" && b.from === 7 && b.to === 9 && /activity in Simpro/.test(b.label)), "two hours at an activity is busy for those two hours, not a day off");
  const jT = [{ id: "sl", simproNo: "97", name: "Solo trip", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith", returnTrips: [{ id: "a", number: 1, rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Louis Hoffman", material: "x" }] }];
  const others = ["Daegan Smith", "Trever Worley", "Callen Jakeman"].map(n => leave(n, "2026-11-24", "07:00", "17:00"));
  const off = SC.buildCalendar({ jobs: jT, schedules: others, phaseHours: {}, timeOff: [{ name: "James Livingston", start: "2026-11-24", end: "2026-11-24" }], ...opt }).items.find(x => x.key === "t_sl_a");
  ok(off.auto && off.auto.staff.length === 1 && off.auto.staff[0].name === "Louis Hoffman" && !off.auto.held && off.flags.some(f => /Louis goes alone 11\/24: James is off/.test(f)), "a junior foreman whose pair is off goes alone on the trip: placed, not held, with a note");
  const busyPair = SC.buildCalendar({ jobs: jT, schedules: others.concat([{ Type: "job", Reference: "500-1", Date: "2026-11-24", Staff: { Name: "James Livingston" }, Blocks: [{ StartTime: "07:00", EndTime: "17:00", Hrs: 10 }] }]), phaseHours: {}, ...opt }).items.find(x => x.key === "t_sl_a");
  ok(busyPair.auto && busyPair.auto.staff.length === 1 && !!busyPair.auto.held, "alone because the pair is booked elsewhere (not off) is still held for a call");
}

// ── v675: a placed block's problems go under Needs you ──
{
  const opt = { today, weeks: 5, users: usersP, effRS: j => j.roughStatus || "", effFS: j => j.finishStatus || "" };
  const jT = [{ id: "pn", simproNo: "98", name: "Plan needs", roughStatus: "complete", finishStatus: "complete", foreman: "Daegan Smith", returnTrips: [{ id: "a", number: 1, rtStatus: "needs", needsByStart: "11/30/2026", material: "x" }] }];
  const run = (plan, more) => { const V = SC.buildCalendar({ jobs: jT, schedules: [], phaseHours: {}, plans: { "t_pn_a": plan }, ...opt, ...(more || {}) }); return V.needs.find(n => n.key === "t_pn_a"); };
  const one = (name) => ({ s: "2026-11-24", hours: 4, crew: 1, staff: [{ name }], t: "07:00", e: "11:00" });
  ok(/Louis is alone on it 11\/24/.test((run(one("Louis Hoffman")) || {}).why || "") && run(one("Louis Hoffman")).placed, "a junior foreman alone on a placed block is listed under Needs you");
  ok(/crew member or apprentice never goes alone/.test((run(one("Callen Jakeman")) || {}).why || ""), "a crew member alone on a placed block is listed, and it says they never go alone");
  ok(!run(one("Louis Hoffman"), { timeOff: [{ name: "James Livingston", start: "2026-11-24", end: "2026-11-24" }] }), "a junior foreman alone because their pair is off is fine and isn't listed");
  ok(!run({ s: "2026-11-24", hours: 8, crew: 2, staff: [{ name: "Louis Hoffman" }, { name: "James Livingston" }], t: "07:00", e: "11:00" }), "two people on a placed block is not a problem");
  ok(/Nobody on it 11\/24/.test((run({ s: "2026-11-24", hours: 4, crew: 1, staff: [], t: "07:00", e: "11:00" }) || {}).why || ""), "a placed block with nobody on it is listed under Needs you");
}

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("scramble-cal-test: all passed");
