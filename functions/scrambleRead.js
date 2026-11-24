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
    .map(x => ({ proposalId: x.proposalId, key: String(x.key || ""), job: String(x.job || ""), ...(x.what ? { what: String(x.what) } : {}), outcome: String(x.outcome || ""), by: String(x.by || ""), at: String(x.at || ""),
      ...(x.reason ? { duetsReason: String(x.reason) } : {}), ...(x.why ? { personsReason: String(x.why) } : {}), ...(Array.isArray(x.changed) ? { whatChanged: x.changed } : {}),
      ...(x.was ? { suggested: x.was } : {}), ...(x.now ? { endedUpWith: x.now } : {}) }));
}
// v673: every hand edit a person made to a block (the screen's prefs.calLog), newest first: what the block was (the
// auto-schedule's guess, Duet's suggestion, an earlier plan, or just on the list) and what they made it.
function handEditsOf(prefs) {
  const d = (prefs && prefs.calLog) || {};
  return Object.keys(d).map(id => d[id] || {}).filter(x => x.at).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 60)
    .map(x => ({ key: String(x.key || ""), job: String(x.job || ""), what: String(x.what || ""), by: String(x.by || ""), at: String(x.at || ""),
      before: x.src === "auto" ? "the auto-schedule's guess" : x.src === "duet" ? "Duet's suggestion" : x.src === "plan" ? "a plan a person placed" : "on the list, not placed",
      ...(Array.isArray(x.changed) ? { whatChanged: x.changed } : {}), ...(x.was ? { was: x.was } : {}), ...(x.now ? { now: x.now } : {}) }));
}
// The scheduling rules: approved ones Duet follows; ones it proposed that still wait on a person.
function lessonsOf(prefs) {
  const d = (prefs && prefs.lessons) || {};
  const all = Object.keys(d).map(id => ({ id, ...(d[id] || {}) })).filter(x => x.text).sort((a, b) => String(a.at || "") < String(b.at || "") ? -1 : 1);
  return { rules: all.filter(x => x.status === "approved").map(x => ({ id: x.id, rule: String(x.text), from: String(x.from || ""), approvedBy: String(x.by || "") })),
    waiting: all.filter(x => x.status !== "approved").map(x => ({ id: x.id, rule: String(x.text), ...(x.evidence ? { evidence: String(x.evidence) } : {}), at: String(x.at || "") })) };
}
function assemble(inp) {
  const i = inp || {};
  const view = SC.viewOf(calendarOf(i), i.users || [], { from: isIso(i.from) ? i.from : "", to: isIso(i.to) ? i.to : "" });
  const fri = (i.prefs && i.prefs.fri) || {};   // who said yes to each Friday (kept with the calendar)
  view.days.forEach(d => { if (d.friday && Array.isArray(fri[d.date])) d.saidYesToFriday = fri[d.date].filter(Boolean); });
  const les = lessonsOf(i.prefs);
  return { ...view, schedulingRules: les.rules, rulesWaitingOnKoy: les.waiting, duetOutcomes: outcomesOf(i.prefs), handEdits: handEditsOf(i.prefs) };
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
    note: "Read only. kind: simpro = booked in Simpro; plan = placed by a person; forecast = the auto-schedule's guess; forecast-held = a guess held for a call; nobody-on-it = on its day with no one on it; command-center-date = a QC walk, inspection or quick job date; duet-proposal = a block Duet proposed, with its reason, that a person can keep, change or remove. schedulingRules are the rules to follow when proposing (approved by a person); rulesWaitingOnKoy are ones Duet proposed that are not approved yet, so do not rely on them. duetOutcomes lists what people did with earlier proposals: what was suggested, what they ended up with, what changed and why. handEdits lists every block a person changed by hand, with what it was before and after: learn how Koy schedules from both. Upcoming jobs with only an estimated start are listed without hours.",
    ...view };
}

// v682 (Grok's review, 2026-11-24: "ask the scheduler why"): why one Simpro job's rough-in, finish and return trips are or
// aren't on the calendar, from the same calendar the screen shows. Pure: everything already read in, the answer out.
// args: { jobNo, phase? ("rough" | "finish" | "trip") }.
function explainOf(inp, args) {
  const i = inp || {}, a = args || {}, no = String(a.jobNo || "").trim(), phase = ["rough", "finish", "trip"].includes(a.phase) ? a.phase : "";
  const V = calendarOf(i), items = SC.explainJob(V, no, phase);
  const out = { ok: true, jobNo: no, ...(phase ? { phase } : {}), planningThrough: V.end, explanations: items };
  if (items.length) return out;
  // nothing on the calendar for that number: say why, from the job as Command Center holds it
  const raw = (i.jobDocs || []).map(d => (d && d.data && d.data.data) || (d && d.data) || {}).find(j => String(j.simproNo || "").trim() === no);
  const up = (Array.isArray(i.upcoming) ? i.upcoming : []).find(u => SC.upNo(u) === no);
  const why = [];
  if (raw && raw.division === "commercial") why.push("It is a commercial job, and the crew calendar only lays out residential work.");
  else if (raw) { const rs = effRS(raw), fs = effFS(raw);
    why.push(`In Command Center rough-in is "${rs || "not set"}" and finish is "${fs || "not set"}".`);
    why.push("A job is on the calendar when a phase is In Progress, Scheduled, Date confirmed or Waiting, or has a start date, hours or Simpro bookings. This one has none of those, or both phases are complete, so there is nothing to place."); }
  else if (up) why.push(`It is an upcoming row (${up.startConfirmed ? "start confirmed" : "start not confirmed"}). Upcoming jobs are only placed once the start is confirmed and they have hours.`);
  else why.push(`Command Center has no residential job with Simpro number ${no || "(none given)"}, and it is not on the upcoming list.`);
  return { ...out, notOnCalendar: { reasons: why } };
}
async function explainCalendar(deps, args) {
  const a = args || {};
  if (!/^\d{1,6}$/.test(String(a.jobNo || "").trim())) throw Object.assign(new Error("jobNo must be the Simpro job number, digits only."), { bad: true });
  if (a.phase != null && !["rough", "finish", "trip"].includes(a.phase)) throw Object.assign(new Error("phase must be rough, finish or trip."), { bad: true });
  const now = deps.now || wallNow(deps.tz);
  return { ...explainOf(await gather({ ...deps, now }), a), asOf: new Date().toISOString(), source: "Command Center crew calendar (same rules as the screen), Simpro schedule read live",
    note: "Read only. state: placed = laid out by the auto-schedule; placed-held = laid out but held for a person's call; plan = placed by a person; duet-suggestion = Duet's suggestion, not a plan; booked-in-simpro; needs-you = could not be placed; off-calendar = taken off by a person; not-placed = never a candidate, see because. toChange is what a person could do; none of it changes a job's stage or status." };
}

module.exports = { handEditsOf, lessonsOf, WEEKS, effRS, effFS, wallNow, jobsOf, calendarOf, outcomesOf, assemble, gather, readSchedules, readCalendar, explainOf, explainCalendar };
