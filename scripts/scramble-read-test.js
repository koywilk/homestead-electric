#!/usr/bin/env node
// scramble-read-test.js — the calendar read for Duet (functions/scrambleRead.js, SW v668). Pure parts only.
"use strict";
const R = require("../functions/scrambleRead.js");
const SC = require("../src/scrambleCal.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

const users = [{ id: "d", name: "Daegan Smith", title: "foreman", active: true }, { id: "l", name: "Louis Hoffman", title: "jrforeman", foremanId: "d", active: true },
  { id: "t", name: "Trever Worley", title: "lead", foremanId: "d", active: true }, { id: "c", name: "Callen Jakeman", title: "crew", foremanId: "d", active: true },
  { id: "a", name: "Josh Cloward", title: "admin", active: true }];
const jobDocs = [
  { id: "j1", data: { data: { id: "j1", simproNo: "900", name: "Read test", roughStatus: "complete", finishStatus: "inprogress", finishStage: "40", foreman: "Daegan Smith",
    returnTrips: [{ id: "r1", number: 1, scope: "x", rtStatus: "scheduled", rtStatusDate: "11/24/2026", assignedTo: "Louis Hoffman", time: "2" }] } } },
  { id: "j2", data: { data: { id: "j2", simproNo: "901", name: "Commercial job", division: "commercial", finishStatus: "inprogress", foreman: "Daegan Smith" } } },
  { id: "j3", data: { saved_by: "x" } }];
const schedules = [{ Type: "job", Reference: "900-1", Date: "2026-11-23", Staff: { Name: "Daegan Smith" }, Blocks: [{ StartTime: "07:00", EndTime: "12:00", Hrs: 5 }] },
  { Type: "job", Reference: "900-1", Date: "2026-11-23", Staff: { Name: "Callen Jakeman" }, Blocks: [{ StartTime: "07:00", EndTime: "17:00", Hrs: 10 }] }];
const inp = { jobDocs, upcoming: [], users, pto: [{ name: "Trever Worley", start: "2026-11-23", end: "2026-11-23" }], prefs: {}, phaseHours: { "900": { f: [20, 100] } }, schedules, now: new Date(2026, 10, 23, 9), from: "2026-11-23", to: "2026-11-27" };
const v = R.assemble(inp);
const day = (iso) => v.days.find(d => d.date === iso);

ok(R.jobsOf(jobDocs).map(j => j.id).join() === "j1", "only residential jobs with data are read");
ok(v.days.map(d => d.date).join() === "2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27" && day("2026-11-27").friday, "the range is Monday to Friday, as asked");
const mon = day("2026-11-23");
ok(mon.blocks.length === 1 && mon.blocks[0].kind === "simpro" && mon.blocks[0].people.join() === "Daegan Smith,Callen Jakeman", "a Simpro booking is a simpro block with its people");
ok(mon.open.join() === "Louis Hoffman" && mon.off.join() === "Trever Worley" && mon.under10h.length === 1 && mon.under10h[0].name === "Daegan Smith" && mon.under10h[0].hours === 5, "open, off and under 10 hours come out per day (a half day in Simpro is 5 hours)");
ok(!JSON.stringify(v).includes("Josh Cloward") && !JSON.stringify(v).includes("Commercial job"), "admins and commercial jobs are not in it");
const tue = day("2026-11-24"), trip = tue.blocks.find(b => b.what === "Return trip #1");
ok(trip && trip.kind === "forecast" && trip.people.join() === "Louis Hoffman,Trever Worley" && trip.from === "07:00" && trip.to === "09:00", "a forecast block carries its people and clock times");
const fin = v.onCalendar.find(x => x.key === "j_j1_f");
ok(fin && /In Progress/.test(fin.why) && fin.bidHours === 100 && fin.usedHours === 20 && fin.startIs === "in progress", "each job says why it is there, with its hours");
// the same lists the screen draws
const V = SC.buildCalendar({ jobs: R.jobsOf(jobDocs), upcoming: [], schedules, phaseHours: inp.phaseHours, upHours: {}, plans: {}, today: inp.now, weeks: R.WEEKS, effRS: R.effRS, effFS: R.effFS, users, holidays: SC.DEFAULT_HOLIDAYS, timeOff: inp.pto });
const board = SC.crewBoard(users), chips = SC.chipsOf(V, board), busy = SC.busyOf(chips, board);
ok(v.days.every(d => { const k = SC.dayCounts(d.date, chips, busy, board, V, "All"); return k.open.join() === d.open.join() && k.out.join() === d.off.join() && k.short.map(x => x.n + x.h).join() === d.under10h.map(x => x.name + x.hours).join() && (chips[d.date] || []).length === d.blocks.length; }),
  "every day's open, under 10 h, off and block count match what the screen's own functions give");
// a plan a person placed, with nobody on a day
const v2 = R.assemble({ ...inp, prefs: { cal: { "j_j1_f": { s: "2026-11-24", hours: 40, crew: 2, staff: [{ name: "Daegan Smith" }, { name: "Callen Jakeman" }], by: "Koy Wilkinson", pdl: [{ d: "2026-11-25", z: 1 }] } } } });
const p24 = v2.days.find(d => d.date === "2026-11-24").blocks.find(b => b.key === "j_j1_f"), p25 = v2.days.find(d => d.date === "2026-11-25").blocks.find(b => b.key === "j_j1_f");
ok(p24 && p24.kind === "plan" && p24.placedBy === "Koy Wilkinson" && p25 && p25.kind === "nobody-on-it" && p25.people.length === 0, "a placed plan reads as a plan with who placed it; a day with nobody on it reads as nobody-on-it");
const w = R.wallNow("America/Denver", new Date("2026-11-24T05:30:00Z"));
ok(w.getFullYear() === 2026 && w.getMonth() === 10 && w.getDate() === 23 && w.getHours() === 22, "today is the Denver day, not the server's");
const src = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleRead.js"), "utf8");
ok(!/\.(set|update|add|delete|create)\(|runTransaction|batch\(|"POST"|"PATCH"|"DELETE"/.test(src), "the read module has no write of any kind (Firestore or Simpro)");

if (fails) { console.error(fails + " failed"); process.exit(1); }
console.log("scramble-read-test: all passed");
