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
ok(day("2026-11-26").companyHoliday === true && day("2026-11-26").open.length === 0 && day("2026-11-26").under10h.length === 0 && day("2026-11-26").crewNotOff === 0 && day("2026-11-25").companyHoliday === undefined && day("2026-11-25").open.length > 0, "v682: a company holiday (Thanksgiving) is marked and has nobody open or under 10 hours; the days around it are unchanged");
const tue = day("2026-11-24"), trip = tue.blocks.find(b => b.what === "Return trip #1");
ok(trip && trip.kind === "forecast" && trip.people.join() === "Louis Hoffman,Trever Worley" && trip.from === "07:00" && trip.to === "09:00", "a forecast block carries its people and clock times");
const fin = v.onCalendar.find(x => x.key === "j_j1_f");
ok(fin && /In Progress/.test(fin.why) && fin.bidHours === 100 && fin.usedHours === 20 && fin.startIs === "in progress", "each job says why it is there, with its hours");
// the same lists the screen draws
const V = SC.buildCalendar({ jobs: R.jobsOf(jobDocs), upcoming: [], schedules, phaseHours: inp.phaseHours, upHours: {}, plans: {}, today: inp.now, weeks: R.WEEKS, effRS: R.effRS, effFS: R.effFS, users, holidays: SC.DEFAULT_HOLIDAYS, timeOff: inp.pto });
const board = SC.crewBoard(users), chips = SC.chipsOf(V, board), busy = SC.busyOf(chips, board);
ok(v.days.every(d => { const k = SC.dayCounts(d.date, chips, busy, board, V, "All"); if (d.companyHoliday) return d.open.length === 0 && d.under10h.length === 0 && (chips[d.date] || []).length === d.blocks.length; return k.open.join() === d.open.join() && k.out.join() === d.off.join() && k.short.map(x => x.n + x.h).join() === d.under10h.map(x => x.name + x.hours).join() && (chips[d.date] || []).length === d.blocks.length; }),
  "every day's open, under 10 h, off and block count match what the screen's own functions give (a company holiday has nobody open)");
// a plan a person placed, with nobody on a day
const v2 = R.assemble({ ...inp, prefs: { cal: { "j_j1_f": { s: "2026-11-24", hours: 40, crew: 2, staff: [{ name: "Daegan Smith" }, { name: "Callen Jakeman" }], by: "Koy Wilkinson", pdl: [{ d: "2026-11-25", z: 1 }] } } } });
const p24 = v2.days.find(d => d.date === "2026-11-24").blocks.find(b => b.key === "j_j1_f"), p25 = v2.days.find(d => d.date === "2026-11-25").blocks.find(b => b.key === "j_j1_f");
ok(p24 && p24.kind === "plan" && p24.placedBy === "Koy Wilkinson" && p25 && p25.kind === "nobody-on-it" && p25.people.length === 0, "a placed plan reads as a plan with who placed it; a day with nobody on it reads as nobody-on-it");
const w = R.wallNow("America/Denver", new Date("2026-11-24T05:30:00Z"));
ok(w.getFullYear() === 2026 && w.getMonth() === 10 && w.getDate() === 23 && w.getHours() === 22, "today is the Denver day, not the server's");
const src = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleRead.js"), "utf8");
ok(!/\.(set|update|add|delete|create)\(|runTransaction|batch\(|"POST"|"PATCH"|"DELETE"/.test(src), "the read module has no write of any kind (Firestore or Simpro)");

// The whole read, start to finish, against stand-ins for Firestore and Simpro (v668 hotfix: the first live call died
// with "d.getFullYear is not a function" because only the pure half was tested).
(async () => {
  const settings = { upcoming_jobs: { items: [] }, crewPTO: { list: inp.pto }, phaseHours: { jobs: inp.phaseHours } };
  const docOf = (data) => ({ get: async () => ({ exists: data != null, data: () => data }) });
  const asked = [];
  const db = { collection: (name) => name === "jobs" ? { get: async () => ({ docs: jobDocs.map(d => ({ id: d.id, data: () => d.data })) }) }
    : name === "settings" ? { doc: (id) => docOf(settings[id]) } : { doc: () => docOf(null) } };
  const simproReq = async (method, path) => { asked.push(method + " " + path); const m = /between\((\d{4}-\d\d-\d\d),(\d{4}-\d\d-\d\d)\)/.exec(path);
    return { ok: true, data: schedules.filter(x => x.Date >= m[1] && x.Date <= m[2]) }; };
  const out = await R.readCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver", now: inp.now }, { from: "2026-11-23", to: "2026-11-27" });
  ok(out.ok === true && out.days.length === 5 && JSON.stringify(out.days) === JSON.stringify(v.days), "the whole read (stand-in Firestore and Simpro) gives the same days as the pure half");
  ok(asked.length === 3 && asked.every(x => x.startsWith("GET /schedules/")) && /between\(2026-11-23,2027-01-03\)/.test(asked[0]), "Simpro is read from the Monday of this week, in six-week pieces, with GET only");
  const dflt = await R.readCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver", now: inp.now }, {});
  ok(dflt.from === "2026-11-23" && dflt.to === "2026-12-06", "with no dates it reads today and the next 13 days");
  let threw = ""; try { await R.readCalendar({ db, getUsers: async () => users, simproReq: async () => ({ ok: false }), tz: "America/Denver", now: inp.now }, {}); } catch (e) { threw = e.message; }
  ok(/Simpro/.test(threw), "if Simpro can't be read it fails outright, never a calendar without Simpro's bookings");
  let bad = false; try { await R.readCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver", now: inp.now }, { from: "2026-11-27", to: "2026-11-23" }); } catch (e) { bad = !!e.bad; }
  ok(bad, "a backwards range is refused");
  // v682: why a job is or isn't on the calendar
  const exA = R.explainOf(inp, { jobNo: "900" });
  ok(exA.ok && exA.explanations.length >= 1 && exA.explanations.every(x => x.job.startsWith("#900")) && !exA.notOnCalendar, "explain: a job on the calendar gets one explanation per block");
  ok(R.explainOf(inp, { jobNo: "900", phase: "trip" }).explanations.every(x => /Return trip/.test(x.what)), "explain: asking for one phase gives only that phase");
  ok(/commercial/.test(R.explainOf(inp, { jobNo: "901" }).notOnCalendar.reasons.join(" ")) && R.explainOf(inp, { jobNo: "901" }).explanations.length === 0, "explain: a commercial job says the crew calendar is residential only");
  ok(/no residential job with Simpro number 777/.test(R.explainOf(inp, { jobNo: "777" }).notOnCalendar.reasons.join(" ")), "explain: a number Command Center doesn't have says so");
  const exU = R.explainOf({ ...inp, upcoming: [{ id: "u1", name: "#555 - Future house", startConfirmed: false }] }, { jobNo: "555" }).explanations[0];
  ok(exU && exU.state === "not-placed" && /confirmed/.test(exU.because.join(" ")) && /Confirm its start date/.test(exU.toChange.join(" ")), "explain: an upcoming row says it is only placed once its start is confirmed");
  ok(!JSON.stringify(exA).includes("Josh Cloward"), "explain: no admins or contact details in it");
  let bad2 = ""; try { await R.explainCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver", now: inp.now }, { jobNo: "abc" }); } catch (e) { bad2 = e.bad ? e.message : "other"; }
  ok(/digits only/.test(bad2), "explain: a job number that isn't digits is refused");
  const exLive = await R.explainCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver", now: inp.now }, { jobNo: "900" });
  ok(exLive.ok && exLive.explanations.length >= 1 && /toChange/.test(exLive.note), "explain: the whole read runs and says what its answers mean");
  // and once with the real clock, the way the function runs it
  const live = await R.readCalendar({ db, getUsers: async () => users, simproReq, tz: "America/Denver" }, {});
  ok(live.ok === true && Array.isArray(live.days), "it runs on the real clock too");
  if (fails) { console.error(fails + " failed"); process.exit(1); }
  console.log("scramble-read-test: all passed");
})().catch(e => { console.error("FAIL the whole read threw: " + (e && e.stack || e)); process.exit(1); });
