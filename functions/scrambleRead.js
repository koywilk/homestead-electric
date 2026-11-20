// scrambleRead.js — the crew calendar as data, for Duet (SW v668, Koy 2026-11-20).
//
// Read only. Builds the same calendar the Weekly Scramble screen shows, with the same code: scrambleCal.js here is a
// byte-for-byte copy of src/scrambleCal.js (scripts/scramble-cal-sync.js fails the build when they differ), and
// SC.viewOf() uses the same chipsOf / busyOf / dayCounts the screen draws from. It reads what the screen reads:
//   jobs (residential, not archived) · settings/upcoming_jobs · settings/users (the Crew Board) · settings/crewPTO ·
//   settings/phaseHours (last night's Job Costs hours) · meetings/scramble__prefs (plans, holidays) · Simpro's schedule.
// It writes nothing, books nothing and never touches a stage or a status. No money and no contact details go out.
// Upcoming rows with a confirmed start get their bid hours from Simpro here, as on the screen, so they are placed the
// same way. Upcoming rows with only an estimated start are on the list without hours (the screen shows theirs).
"use strict";
const SC = require("./scrambleCal.js");
const PLS = require("./punchListStage.js");
// What is still open on a phase, counted the way the screen counts it (src/App.js scalOpenPunch).
const openPunch = (j, ph) => { if (ph === "rough") return PLS.openPunchItems(j && j.roughPunch).length + (j && j.roughInspectionResult === "fail" ? (j.roughInspectionItems || []).filter(i => i && typeof i === "object" && !i.done).length : 0);
  const o = PLS.punchListOpen(j); return o.finishPunch + o.qcPunch + o.inspection; };

const WEEKS = 17;   // the screen's SCAL_WEEKS
// The app's effective status (src/App.js effRS / effFS): the stored status, else from the stage percent.
const effRS = (j) => { if (j.tempPed) { const s = j.tempPedStatus || ""; return s === "completed" ? "complete" : s === "scheduled" ? "scheduled" : s === "ready" ? "waiting_date" : ""; }
  if (j.roughStatus) return j.roughStatus; const p = parseInt(j.roughStage, 10) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };
const effFS = (j) => { if (j.tempPed) return ""; if (j.finishStatus) return j.finishStatus; const p = parseInt(j.finishStage, 10) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };

// "Now" as a Date whose own year / month / day / hour are the wall clock in `tz` (the functions run in UTC; the
// calendar's day math reads the Date's local fields, the way the browser's does in Denver).
function wallNow(tz, at) {
  const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at || new Date()).forEach(x => { p[x.type] = x.value; });
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Residential, live jobs in the shape the app holds them (the job's `data`, with its id).
function jobsOf(docs) {
  return (docs || []).map(d => { const raw = (d && d.data) || {}, j = raw.data; return j && typeof j === "object" ? { ...j, id: j.id || d.id } : null; })
    .filter(j => j && j.division !== "commercial");
}

// Pure: everything already read → the view. inputs: { jobDocs: [{ id, data }], upcoming, users, pto, prefs, phaseHours,
// schedules, now (wall-clock Date), from, to }.
// The calendar itself (what SC.buildCalendar gives the screen), from inputs already read. opts.proposals: false leaves
// Duet's own proposals out (used when checking a new proposal, so it is judged against everything but itself).
function calendarOf(inp, opts) {
  const i = inp || {}, prefs = i.prefs || {};
  return SC.buildCalendar({ jobs: jobsOf(i.jobDocs), upcoming: Array.isArray(i.upcoming) ? i.upcoming : [], schedules: Array.isArray(i.schedules) ? i.schedules : [],
    phaseHours: i.phaseHours || {}, upHours: i.upHours || {}, plans: prefs.cal || {}, proposals: opts && opts.proposals === false ? {} : prefs.duet || {}, openPunch, today: i.now, weeks: WEEKS, effRS, effFS,
    users: Array.isArray(i.users) ? i.users : [], holidays: Array.isArray(prefs.holidays) ? prefs.holidays : SC.DEFAULT_HOLIDAYS, timeOff: Array.isArray(i.pto) ? i.pto : [] });
}
// What became of Duet's proposals (the screen records one line when a person keeps, changes or removes one), newest first.
function outcomesOf(prefs) {
  const d = (prefs && prefs.duetDone) || {};
  return Object.keys(d).map(id => ({ proposalId: id, ...(d[id] || {}) })).filter(x => x.at).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 100)
    .map(x => ({ proposalId: x.proposalId, key: String(x.key || ""), job: String(x.job || ""), outcome: String(x.outcome || ""), by: String(x.by || ""), at: String(x.at || ""), ...(x.reason ? { reasonGiven: String(x.reason) } : {}) }));
}
function assemble(inp) {
  const i = inp || {};
  const view = SC.viewOf(calendarOf(i), i.users || [], { from: isIso(i.from) ? i.from : "", to: isIso(i.to) ? i.to : "" });
  const fri = (i.prefs && i.prefs.fri) || {};   // who said yes to each Friday (kept with the calendar)
  view.days.forEach(d => { if (d.friday && Array.isArray(fri[d.date])) d.saidYesToFriday = fri[d.date].filter(Boolean); });
  return { ...view, duetOutcomes: outcomesOf(i.prefs) };
}

// The Simpro schedule for the calendar's 17 weeks, in six-week reads like the screen. Throws if Simpro can't be read:
// a calendar laid out without Simpro's bookings would be wrong, so there is no partial answer.
async function readSchedules(simproReq, startIso) {
  let rows = [];
  for (let w = 0; w < WEEKS; w += 6) {
    const a = SC.addDays(startIso, w * 7), z = SC.addDays(startIso, Math.min(WEEKS, w + 6) * 7 - 1);
    for (let page = 1; page <= 12; page++) {
      const r = await simproReq("GET", `/schedules/?pageSize=250&page=${page}&Date=between(${a},${z})`);
      if (!r || !r.ok || !Array.isArray(r.data)) throw new Error("Couldn't read Simpro's schedule.");
      rows = rows.concat(r.data.filter(s => s && s.Date >= a && s.Date <= z));
      if (r.data.length < 250) break;
      if (page === 12) throw new Error("Simpro's schedule is too long to read whole.");
    }
  }
  return rows;
}

// Bid hours for Upcoming rows that aren't jobs in the app yet (the screen asks Simpro for each one too): only rows with
// a CONFIRMED start, since those are the ones the auto-schedule places (v671). A number above every app job's number is
// a quote. Read failures just leave that row without hours; it then goes to Needs you, never a wrong block.
async function upcomingHours(simproReq, upcoming, jobs) {
  const have = new Set((jobs || []).map(j => String((j && j.simproNo) || ""))), maxNo = (jobs || []).reduce((m, j) => Math.max(m, parseInt(j && j.simproNo, 10) || 0), 0), out = {};
  const want = (Array.isArray(upcoming) ? upcoming : []).filter(u => u && u.startConfirmed).map(u => SC.upNo(u)).filter(n => n && !have.has(n)).slice(0, 40);
  for (const no of [...new Set(want)]) {
    try {
      const r = await simproReq("GET", `/${+no > maxNo ? "quotes" : "jobs"}/${no}?columns=ID,Totals`);
      const lh = r && r.ok && r.data && r.data.Totals && r.data.Totals.ResourcesCost && r.data.Totals.ResourcesCost.LaborHours;
      if (lh && Number(lh.Estimate) > 0) out[no] = { est: Math.round(Number(lh.Estimate) * 10) / 10, used: Math.round((Number(lh.Actual) || 0) * 10) / 10 };
    } catch (e) { /* that row has no hours */ }
  }
  return out;
}
// Everything the calendar is built from, read once. deps: { db, getUsers, simproReq, tz, now? }.
async function gather(deps) {
  const now = deps.now || wallNow(deps.tz);
  const settings = (id) => deps.db.collection("settings").doc(id).get().then(s => (s.exists ? s.data() : {}) || {});
  const [jobSnap, up, pto, ph, prefSnap, users, schedules] = await Promise.all([
    deps.db.collection("jobs").get(), settings("upcoming_jobs"), settings("crewPTO"), settings("phaseHours"),
    deps.db.collection("meetings").doc("scramble__prefs").get(), deps.getUsers(), readSchedules(deps.simproReq, SC.mondayOf(now)) ]);   // mondayOf takes the Date, not the day string
  const jobDocs = jobSnap.docs.map(d => ({ id: d.id, data: d.data() }));
  return { jobDocs, upcoming: up.items, users, pto: pto.list, prefs: prefSnap.exists ? prefSnap.data() || {} : {}, phaseHours: ph.jobs, schedules, now,
    upHours: await upcomingHours(deps.simproReq, up.items, jobsOf(jobDocs)) };
}
// deps: { db, getUsers, simproReq, tz }. args: { from, to } (YYYY-MM-DD, optional; default the next two weeks).
async function readCalendar(deps, args) {
  const now = deps.now || wallNow(deps.tz), today = SC.ymd(now), a = args || {};
  const from = isIso(a.from) ? a.from : today, to = isIso(a.to) ? a.to : SC.addDays(from, 13);
  if (to < from) throw Object.assign(new Error("to is before from"), { bad: true });
  const view = assemble({ ...(await gather({ ...deps, now })), from, to });
  return { ok: true, asOf: new Date().toISOString(), source: "Command Center crew calendar (same rules as the screen), Simpro schedule read live",
    note: "Read only. kind: simpro = booked in Simpro; plan = placed by a person; forecast = the auto-schedule's guess; forecast-held = a guess held for a call; nobody-on-it = on its day with no one on it; command-center-date = a QC walk, inspection or quick job date; duet-proposal = a block Duet proposed, with its reason, that a person can keep, change or remove. duetOutcomes lists what people did with earlier proposals. Upcoming jobs with only an estimated start are listed without hours.",
    ...view };
}

module.exports = { WEEKS, effRS, effFS, wallNow, jobsOf, calendarOf, outcomesOf, assemble, gather, readSchedules, readCalendar };
