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
ok(big.cut && big.used.length === 16, "a job longer than the view runs to its edge and says it continues");
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

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("scramble-cal-test: all passed");
