// scrambleCal.js — the Weekly Scramble calendar (SW v651, Koy 2026-11-17).
//
// Koy: "we want like a calendar view with upcoming jobs and any jobs that are in progress
// ... scheduled out through their hours that they have left of so we can kind of see how busy
// we are", "Simpro will be the source of truth with schedule", "on the right ... what needs to
// be on the calendar and we can put it on there and see what it looks like. And then we can
// schedule from there", "make the estimated or confirmed start dates visible, and flag anything
// needing scheduling on a date but not yet", "needs to be clear if its a return trip, rough, or
// finish". Preview approved first (claude.ai/artifact/DF9rkRQuTGGdFkXXk77AL6), then "lets send it".
//
// Pure, CommonJS, no requires: App.js imports it and scripts/scramble-cal-test.js drives the
// exact file that ships. Nothing here touches Firestore or Simpro. It turns what the dashboard
// already holds (jobs, Upcoming, the nightly Job Costs rough / finish hours in settings/phaseHours,
// the Simpro schedule for the view) plus the meeting's kept plans into calendar items.
//
// One item = one block of work: a job's current phase (Rough-in or Finish), one open return trip,
// an Upcoming row, or a Simpro booking that has no phase (a service call).
//   booked  Simpro schedule days for it (solid on the calendar)
//   auto    when Simpro has it booked ahead: the hours left, laid out after the last booked day
//   plan    a kept plan (meetings/scramble__prefs.cal[key]), shared with everyone in the meeting
// Hours are at 4-10s: Monday to Thursday, 10 h a day (Friday is optional overtime, not planned).
// Plans saved: { s: "YYYY-MM-DD", hours, crew, staff: [{ id, name }], by, at }.
"use strict";

const HPD = 10;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s || "").slice(0, 10)); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
// "11/16/2026", "11/16/26", "2026-11-16" → Date at noon, else null
function anyDate(s) {
  const t = String(s || "").trim(); if (!t) return null;
  const iso = parseYmd(t); if (iso) return iso;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (!m) return null;
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  const d = new Date(y, +m[1] - 1, +m[2], 12);
  return isNaN(d.getTime()) ? null : d;
}
const anyIso = (s) => { const d = anyDate(s); return d ? ymd(d) : ""; };
const addDays = (iso, n) => { const d = parseYmd(iso); d.setDate(d.getDate() + n); return ymd(d); };
const dowOf = (iso) => (parseYmd(iso).getDay() + 6) % 7;        // Mon 0 … Sun 6
// Company holidays, no crew work (v656): New Year's Day, Memorial Day, July 4, Labor Day, Thanksgiving,
// Christmas Day; one on a Sunday is taken the Monday after.
function holidaysOf(y) {
  const iso = (m, d) => ymd(new Date(y, m, d, 12));
  const nth = (m, dow, n) => { const d = new Date(y, m, 1, 12); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return ymd(d); };
  const last = (m, dow) => { const d = new Date(y, m + 1, 0, 12); while (d.getDay() !== dow) d.setDate(d.getDate() - 1); return ymd(d); };
  const fixed = [iso(0, 1), iso(6, 4), iso(11, 25)].map(x => new Date(x + "T12:00").getDay() === 0 ? addDays(x, 1) : x);
  return new Set([...fixed, last(4, 1), nth(8, 1, 1), nth(10, 4, 4)]);
}
const HOL = {};
// Company holidays (Koy 2026-11-19: "make sure that holidays don't get booked on Thanksgiving, Christmas, New Year's
// Eve, and Memorial Day. I think there's a couple more that I don't remember"). The calendar passes the list kept in
// the meeting prefs (admins edit it); without one, the built-in rule above stands. The default list keeps the days the
// rule already had (New Year's Day, July 4, Labor Day) beside Koy's four.
const DEFAULT_HOLIDAYS = [
  { date: "2026-11-26", name: "Thanksgiving" }, { date: "2026-12-25", name: "Christmas" }, { date: "2026-12-31", name: "New Year's Eve" },
  { date: "2027-01-01", name: "New Year's Day" }, { date: "2027-05-31", name: "Memorial Day" }, { date: "2027-07-05", name: "Independence Day (observed)" },
  { date: "2027-09-06", name: "Labor Day" }];
let CUSTOM = null;   // iso → name, when a list is given
function setHolidays(list) {
  if (!Array.isArray(list)) { CUSTOM = null; return; }
  CUSTOM = {}; list.forEach(h => { const d = h && anyIso(h.date); if (d) CUSTOM[d] = String((h && h.name) || "Holiday").slice(0, 40); });
}
const isHoliday = (iso) => { if (CUSTOM) return !!CUSTOM[iso]; const y = +String(iso).slice(0, 4); if (!HOL[y]) HOL[y] = holidaysOf(y); return HOL[y].has(iso); };
const holidayName = (iso) => CUSTOM ? CUSTOM[iso] || "" : isHoliday(iso) ? "Holiday" : "";
const isWork = (iso) => dowOf(iso) <= 3 && !isHoliday(iso);   // Mon–Thu, not a holiday
function nextWork(iso) { let d = iso; for (let i = 0; i < 10 && !isWork(d); i++) d = addDays(d, 1); return d; }
const workAfter = (iso) => nextWork(addDays(iso, 1));
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const md = (iso) => { const d = parseYmd(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
const short = (iso) => `${DOW[dowOf(iso)]} ${md(iso)}`;
const safeKey = (s) => String(s || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80) || "x";
const firstOf = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// A block's days with clock times: each day starts at 7:00 plus the hours its people already had that day (auto
// blocks carry those in `times`), or at the time someone set on the first day (`t`, "HH:MM").
const DAY0 = 7;
const clock = (h) => { const m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60, ap = hh >= 12 ? "PM" : "AM"; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ap}`; };
const hhmmOf = (h) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const hoursOf = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? +m[1] + +m[2] / 60 : null; };
function slotsOf(plan) {
  if (!plan) return [];
  const t0 = hoursOf(plan.t);
  return planDays(plan).map((d, i) => {
    const from = i === 0 && t0 != null ? t0 : DAY0 + ((plan.times && plan.times[d.date]) || 0);
    return { date: d.date, hours: d.hours, from, to: from + d.hours, start: hhmmOf(from), label: `${clock(from)}–${clock(from + d.hours)}` };
  });
}

// The view: `weeks` weeks of Mon–Fri starting the Monday of `start`.
function viewDays(startIso, weeks) {
  const out = [];
  for (let w = 0; w < weeks; w++) for (let i = 0; i < 5; i++) { const iso = addDays(startIso, w * 7 + i); out.push({ iso, dow: i, fri: i === 4 }); }
  return out;
}

// Lay `hours` for `crew` people out on workdays from `startIso`: [{ iso, part }] where part is the
// share of a 10 h day (the last day can be partial). Stops at `endIso` and says how much is left.
function span(startIso, hours, crew, endIso) {
  const per = Math.max(1, Number(crew) || 1) * HPD;
  let days = Math.max(0, Number(hours) || 0) / per, d = nextWork(startIso);
  const used = [];
  for (let guard = 0; days > 1e-6 && guard < 400; guard++) {
    if (endIso && d > endIso) break;
    const part = Math.min(1, days); used.push({ iso: d, part: Math.round(part * 100) / 100 }); days -= part; d = workAfter(d);
  }
  return { used, days: Math.round((Number(hours) || 0) / per * 100) / 100, leftDays: Math.max(0, Math.round(days * 100) / 100), cut: days > 1e-6 };
}
// Workdays covered from startIso up to and including endIso (whole days).
function workdaysBetween(startIso, endIso) { let n = 0, d = nextWork(startIso); for (let g = 0; d <= endIso && g < 400; g++) { n++; d = workAfter(d); } return n; }
// The person-days a plan books: per day, hours for each person (the last day can be short).
function planDays(plan) {
  if (!plan || !plan.s) return [];
  const crew = Math.max(1, Number(plan.crew) || 1);
  let left = Math.max(0, Number(plan.hours) || 0) / crew, d = nextWork(plan.s);
  const out = [];
  // a day that starts late (after a trip, or a start time someone set) ends at 5:00 like the rest; the hours carry on
  const t0 = hoursOf(plan.t), off = (date, i) => (plan.times && plan.times[date]) || (i === 0 && t0 != null ? Math.max(0, t0 - DAY0) : 0);
  for (let g = 0; left > 1e-6 && g < 120; g++) { const h = Math.min(Math.max(0.25, HPD - off(d, g)), left); out.push({ date: d, hours: Math.round(h * 4) / 4 }); left -= h; d = workAfter(d); }
  return out.filter(x => x.hours > 0);
}

// Simpro schedule rows → { "<job no>": { iso: { who: [first names], hrs } } }. Days with under 2 crew
// hours on a job (time-clock blips) are left off. Two people with the same first name get an initial.
function bookingsByNo(schedules) {
  const rows = (schedules || []).filter(s => s && s.Type === "job" && s.Reference && s.Date);
  const firsts = {};
  rows.forEach(s => { const n = (s.Staff && s.Staff.Name) || ""; const f = firstOf(n); (firsts[f] = firsts[f] || new Set()).add(n); });
  const label = (n) => { const f = firstOf(n); if ((firsts[f] || new Set()).size < 2) return f; const p = String(n).trim().split(/\s+/); return f + " " + (p[p.length - 1] || "").charAt(0) + "."; };
  const out = {};
  rows.forEach(s => {
    const no = String(s.Reference).split("-")[0], iso = String(s.Date).slice(0, 10);
    const hrs = (s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0;
    const day = ((out[no] = out[no] || {})[iso] = out[no][iso] || { who: [], hrs: 0, names: [] });
    const full = (s.Staff && s.Staff.Name) || "", w = label(full);
    if (w && !day.who.includes(w)) { day.who.push(w); day.names.push(full); }
    day.hrs += hrs;
  });
  Object.keys(out).forEach(no => Object.keys(out[no]).forEach(iso => { if (out[no][iso].hrs < 2) delete out[no][iso]; else out[no][iso].hrs = r1(out[no][iso].hrs); }));
  return out;
}

// A phase's Materials cards: ordered when any card was ordered / picked up / delivered.
function poState(cards) {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean);
  if (!list.length) return "none";
  return list.some(c => c.ordered || c.pickedUp || c.deliveredToShop) ? "ordered" : "notOrdered";
}
const tripIso = (t) => anyIso((t && (t.rtStatusDate || t.scheduledDate || t.date)) || "");
const tripOpen = (t) => t && !t.signedOff && t.rtStatus !== "complete";
// A trip's time, from its est. time ("time", carried from a change order or typed on the trip): "3", "3 hrs",
// "2.5 hours", "30 min", "half day", "1 day", "2 days". Hours per person; "" when it doesn't say.
function tripHours(v) {
  const t = String(v == null ? "" : v).toLowerCase().trim(); if (!t) return 0;
  if (/half/.test(t)) return HPD / 2;
  const n = parseFloat((t.match(/\d+(\.\d+)?/) || [])[0]);
  if (/day/.test(t)) return (n > 0 ? n : 1) * HPD;
  if (!(n > 0)) return /full|all/.test(t) ? HPD : 0;
  if (/min/.test(t) && !/h(ou)?r/.test(t)) return Math.max(0.25, Math.round(n / 60 * 4) / 4);
  return Math.round(n * 4) / 4;
}
const TRIP_DEFAULT_H = 4;   // a trip with no time on it: half a day, held so someone sets it
const plain = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// An Upcoming row's number: "#1331 - Becker Residence" → "1331"
const upNo = (u) => { const m = /#\s*(\d{2,6})/.exec(String((u && u.name) || "")); return m ? m[1] : ""; };
const upName = (u) => String((u && u.name) || "").replace(/^\s*#\s*\d+\s*[-–:]?\s*/, "").trim() || String((u && u.name) || "");

const DONE = ["complete", "invoice"];
const LIVE = ["inprogress", "scheduled", "date_confirmed", "waiting_date", "waiting"];
const KIND_TAG = { rough: "Rough-in", finish: "Finish", service: "Booked" };

// ── v656: the auto-schedule (Josh's rules, plan approved Nov 18; Koy Nov 19) ─────────────────────────────
// Crews come from the Crew Board (settings/users: title, foremanId, active), as Koy keeps it. A foreman's crew
// is the foreman plus every active person whose foremanId is that foreman. A jr foreman, lead or crew member
// runs with their foreman's crew. Unassigned people are never scheduled (Koy: "unassigned members should not
// be scheudled"). Inactive people are left off.
const lc = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// Title as the Crew Board reads it (App.js crewBoardTitle): admins are never on a crew.
const boardTitle = (u) => u.title || (["admin", "justin", "jeromy"].includes(u.role) ? "admin" : ["foreman", "lead", "crew"].includes(u.role) ? u.role : "crew");
function crewBoard(users) {
  const act = (users || []).filter(u => u && String(u.name || "").trim() && u.active !== false);
  const crews = {};
  act.forEach(u => { if (boardTitle(u) === "foreman") crews[u.id] = { id: u.id, foreman: u.name, people: [u.name], title: { [u.name]: "foreman" } }; });
  act.forEach(u => { const t = boardTitle(u); if (t !== "foreman" && t !== "admin" && u.foremanId && crews[u.foremanId]) { crews[u.foremanId].people.push(u.name); crews[u.foremanId].title[u.name] = t; } });
  // "Daegan Smith", "Daegan", "Louis H." → the one active person it can only mean
  const find = (name) => {
    const n = lc(name).replace(/\./g, ""); if (!n) return null;
    const exact = act.filter(u => lc(u.name) === n); if (exact.length === 1) return exact[0];
    const [f, l] = n.split(" ");
    const m = act.filter(u => { const p = lc(u.name).split(" "); return p[0] === f && (!l || (p.length > 1 && p[p.length - 1].startsWith(l))); });
    return m.length === 1 ? m[0] : null;
  };
  const crewOfUser = (u) => !u ? null : boardTitle(u) === "foreman" ? crews[u.id] || null : boardTitle(u) === "admin" ? null : (u.foremanId && crews[u.foremanId]) || null;
  // Set pairs (Koy 2026-11-19: "we need to know which junior foreman is with which apprentice, which lead is with
  // which apprentice ... so that we can schedule by that instead of guessing at who the pairs are"), then "I need to be
  // able to pair anybody with anybody". A pair counts when both point at each other, any role, any crew; a one-sided
  // pointer is ignored, never guessed. Someone Unassigned keeps their pair on the board but is never scheduled.
  const byId = {}; act.forEach(u => { byId[u.id] = u; });
  const pairs = {};
  act.forEach(u => { const o = u.pairId && byId[u.pairId]; if (o && o.pairId === u.id && o.id !== u.id && boardTitle(u) !== "admin" && boardTitle(o) !== "admin") pairs[u.name] = o.name; });
  return { crews, find, crewOf: (name) => crewOfUser(find(name)), crewOfUser, pairs, partnerOf: (name) => pairs[name] || "" };
}

// Lays forecast blocks for what isn't booked: rough-in first, then finish, at 10 h days Mon–Thu, never over a
// Simpro booking, a kept plan or another auto block for the same person. Kept plans (placed or moved by hand) are
// never touched. Anything it shouldn't decide alone goes to Needs you: a held block (placed, hatched, not booked
// until someone keeps it) or no block with the reason. Returns the Needs you list.
function autoPlan(items, { board, schedules, plans, todayIso, end, offByDay = {} }) {
  // Hours each person already has each day (Koy 2026-11-19: "none of them have time assignments. tuhaye hollow RT
  // monday wont take all day"): a short trip leaves the rest of the day for another job.
  const used = {};                                   // person (lower case) → { iso: hours }
  const usedOn = (name, iso) => ((used[lc(name)] || {})[iso]) || 0;
  const mark = (name, iso, h) => { const k = lc(name); const m = used[k] = used[k] || {}; m[iso] = Math.min(HPD, (m[iso] || 0) + (h == null ? HPD : h)); };
  Object.entries(offByDay).forEach(([iso, names]) => names.forEach(n => mark(n, iso)));   // nobody is booked on a day off
  const free = (names, iso, need) => names.every(n => usedOn(n, iso) + (need == null ? HPD : need) <= HPD + 1e-6);
  const PH_NEED = HPD / 2;   // a job can start a person's day after a trip of up to half a day
  const perDay = {};
  (schedules || []).forEach(s => { if (!s || !s.Date || !s.Staff || !s.Staff.Name) return;
    const k = s.Staff.Name + "|" + String(s.Date).slice(0, 10);
    perDay[k] = (perDay[k] || 0) + ((s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0); });
  Object.keys(perDay).forEach(k => { const [n, iso] = k.split("|"); mark(n, iso, Math.max(0.25, perDay[k])); });
  const crewNames = (it) => { const c = board.crewOf(it.foreman) || board.crewOf(it.jlead); return c ? c.people : []; };
  // what is already planned holds its people
  items.forEach(it => {
    const f = it.plan || it.auto; if (!f) return;
    const names = (f.staff || []).map(x => x && x.name).filter(Boolean);
    const lastDay = it.booked.length ? it.booked[it.booked.length - 1] : null;   // a Simpro tail runs on with the last booked day's people
    const who = names.length ? names : it.plan ? crewNames(it) : ((lastDay && lastDay.names) || []);
    planDays(f).forEach(d => { if (d.date <= end) who.forEach(n => mark(n, d.date, d.hours)); });
  });
  const first = workAfter(todayIso);
  const fit = (names, from, nDays, last) => {
    for (let s = nextWork(from), g = 0; s <= last && g < 120; s = workAfter(s), g++) {
      let d = s, ok = true;
      for (let i = 0; i < nDays && d <= end; i++, d = workAfter(d)) if (!free(names, d, PH_NEED)) { ok = false; break; }
      if (ok) return s;
    }
    return "";
  };
  const take = (names, s, hours, crew) => planDays({ s, hours, crew }).forEach(d => { if (d.date <= end) names.forEach(n => mark(n, d.date, d.hours)); });
  const needs = [];
  const need = (it, why) => { it.need = why; it.inList = false; needs.push({ key: it.key, why, held: false }); };
  const place = (it, names, s, hours, held, label) => {
    // each day starts when the last of its people is free (7:00 plus what they already have that day)
    const times = {}; let left = hours / Math.max(1, names.length);
    for (let d = nextWork(s), g = 0; left > 1e-6 && g < 120; d = workAfter(d), g++) {
      const st = Math.min(HPD - 0.25, Math.max(0, ...names.map(n => usedOn(n, d))));
      if (st > 0) times[d] = st; left -= Math.min(HPD - st, left);
    }
    it.auto = { s, hours, crew: names.length, staff: names.map(name => ({ name })), team: label, src: "auto", held: held || "", times };
    planDays(it.auto).forEach(d => { if (d.date <= end) names.forEach(n => mark(n, d.date, d.hours)); });
    it.onCal = true; it.inList = false;
    if (held) needs.push({ key: it.key, why: held, held: true });
  };
  const label = (c) => c ? firstOf(c.foreman) + "'s crew" : "";

  const isCand = (it) => !it.plan && !it.auto && !it.off && !it.upcoming && it.kind !== "service";
  const sIso = (it) => (it.start && it.start.iso) || "";
  const trips = items.filter(it => isCand(it) && it.kind === "trip" && !it.booked.length);
  const phases = items.filter(it => isCand(it) && (it.kind === "rough" || it.kind === "finish") && !it.bookedAhead && !it.hold
    && it.start && (it.start.started || (it.start.conf && sIso(it) && sIso(it) <= end)));   // an estimated start stays on the list
  const ord = (a, b) => (a.start.started ? 0 : 1) - (b.start.started ? 0 : 1) || (sIso(a) < sIso(b) ? -1 : sIso(a) > sIso(b) ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  const fixed = trips.filter(t => t.start && !t.start.by), byTrips = trips.filter(t => !t.start || t.start.by);

  // Return trips: on their date, in a pair. Koy 2026-11-19: "They don't get sent by themselves anywhere: sometimes leads,
  // sometimes junior foreman, sometimes foreman, but for the most part we travel in at least pairs of two." So a trip is
  // its person (or, with none set, someone who can lead it from the job's foreman's crew: the job's own foreman / lead
  // first, then a lead, jr foreman, the foreman) plus one more from that crew, crew members first. A lead, jr foreman or
  // foreman may go alone only when no second person is free, held; a crew member never goes alone. One with no date or a
  // schedule-by date goes on the first open day (before that date) a pair is free.
  const doTrip = (it) => {
    const s = it.start, th = Math.min(HPD, it.tripH || TRIP_DEFAULT_H); let c, lead0 = [], noCrew = false;
    if (it.who) {
      const u = board.find(it.who);
      if (!u) return need(it, `${it.who} isn't on the Crew Board`);
      c = board.crewOfUser(u);
      if (!c) return need(it, `${firstOf(u.name)} is unassigned on the Crew Board`);
      lead0 = [u.name];
    } else {
      c = board.crewOf(it.foreman) || board.crewOf(it.jlead);
      if (!c) return need(it, it.foreman ? `No crew on the trip, and ${it.foreman} has no crew on the Crew Board` : "No date or crew set in Command Center");
      noCrew = true;
    }
    const tt = c.title || {}, canLead = (p) => ["foreman", "jrforeman", "lead"].includes(tt[p]);
    const runner = [board.find(it.foreman), board.find(it.jlead)].filter(Boolean).map(x => x.name).filter(x => c.people.includes(x));
    const leadRank = (p) => runner.includes(p) && tt[p] !== "foreman" ? 0 : tt[p] === "lead" ? 1 : tt[p] === "jrforeman" ? 2 : tt[p] === "foreman" ? 3 : 9;
    const leaders = lead0.length ? lead0 : c.people.filter(canLead).sort((x, y) => leadRank(x) - leadRank(y));
    const mate = (first) => board.partnerOf(first);   // their set pair goes first, from any crew, never someone Unassigned
    const mates = (first) => [...(mate(first) && !c.people.includes(mate(first)) && board.crewOf(mate(first)) ? [mate(first)] : []), ...c.people].filter(p => p !== first).sort((x, y) => (x === mate(first) ? -1 : 0) - (y === mate(first) ? -1 : 0) || (tt[x] === "crew" ? 0 : tt[x] === "lead" ? 1 : 2) - (tt[y] === "crew" ? 0 : tt[y] === "lead" ? 1 : 2));
    // who goes on day d: a pair if there is one; else a lone leader (held); else nobody
    const crewFor = (d) => {
      for (const l of leaders) { if (!free([l], d, th)) continue; const m = mates(l).find(p => free([p], d, th)); if (m) return { names: [l, m] }; }
      if (!lead0.length) { const two = c.people.filter(p => free([p], d, th)); if (two.length >= 2) return { names: two.slice(0, 2) }; }
      const solo = leaders.find(l => free([l], d, th) && canLead(l));
      return solo ? { names: [solo], solo: true } : null;
    };
    if (s && !s.by && s.iso < todayIso) return need(it, `Was set for ${md(s.iso)}, not done. Pick a new date`);
    if (s && !s.by && !isWork(s.iso)) return need(it, `Set for ${short(s.iso)}, ${isHoliday(s.iso) ? "a holiday" : "Fridays are volunteer only"}`);
    const notes = [];
    if (!s && noCrew) notes.push("No date or crew set in Command Center, so it's on the first open day");
    else if (!s) notes.push("No date set in Command Center, so it's on the first open day");
    else if (noCrew) notes.push("No crew set in Command Center");
    if (!it.material) notes.push("No material listed on the trip");
    const go = (d, r, pre) => {
      const why = [...(pre ? [pre] : []), ...(r.solo ? [`Only ${firstOf(r.names[0])} free that day, no second person`] : []), ...notes].join(". ");
      return place(it, r.names, d, th * r.names.length, why, firstOf(r.names[0]) + (r.names[1] ? " + " + firstOf(r.names[1]) : ""));
    };
    const alone = lead0.length && !canLead(lead0[0]) ? `${firstOf(lead0[0])} is crew and can't go alone, and no one on ${label(c)} is free with them` : "";
    if (!s || s.by) {
      const last = s ? (s.iso < end ? s.iso : end) : end;
      let soloAt = null;
      for (let d = nextWork(first), g = 0; d <= last && g < 120; d = workAfter(d), g++) {
        const r = crewFor(d); if (!r) continue;
        if (!r.solo) return go(d, r); if (!soloAt) soloAt = { d, r };
      }
      if (soloAt) return go(soloAt.d, soloAt.r);
      if (s) {   // nobody free by its date: the first open day after it, held, so it's still on the calendar
        for (let d = workAfter(last), g = 0; d <= end && g < 120; d = workAfter(d), g++) {
          const r = crewFor(d); if (r) return go(d, r, `Wanted by ${md(s.iso)}, but no pair from the crew is free until ${md(d)}`);
        }
      }
      return need(it, alone || (s ? `No pair free before ${md(s.iso)}` : `No one on ${label(c)} free through ${md(end)}`));
    }
    if (s.iso > end) return;
    const r = crewFor(s.iso);
    if (!r) return need(it, alone || `${lead0.length ? firstOf(lead0[0]) + " or a partner" : "No pair from " + label(c)} free ${short(s.iso)}`);
    go(s.iso, r);
  };
  // Crews (Koy 2026-11-19): "keep the crews at least four on a job if we can. But if there are two jobs going at
  // the same time for a foreman, then the junior foreman is first up to take the job that the foreman's not on."
  // A job gets one head (its own foreman / lead on the board if free, else the crew's foreman, else a jr foreman)
  // and up to 4 people, the other heads kept back for the crew's other jobs. When another of the crew's jobs
  // wants the same days, this one leaves room for it (the second job's head plus one); a job that can't get 4
  // goes on with fewer, held under Needs you. A crew under 4 people goes out whole.
  const crewKey = (it) => { const c = board.crewOf(it.foreman) || board.crewOf(it.jlead); return c ? c.id : ""; };
  const doneKeys = new Set();
  const fromOf = (it) => it.start.started || !sIso(it) || sIso(it) < first ? first : nextWork(sIso(it));
  const doPhase = (it) => {
    doneKeys.add(it.key);
    if (it.over) return need(it, "Over bid. Set the hours by hand");
    if (it.left == null) return need(it, "No hours in Job Costs. Set the hours by hand");
    if (!(it.left > 0)) return;
    const c = board.crewOf(it.foreman) || board.crewOf(it.jlead);
    if (!c) return need(it, it.foreman ? `${it.foreman} has no crew on the Crew Board` : "No foreman set on the job");
    const pool = c.people, tt = c.title || {};
    const isHead = (p) => tt[p] === "foreman" || tt[p] === "jrforeman";
    const runner = [board.find(it.foreman), board.find(it.jlead)].filter(Boolean).map(u => u.name).find(x => pool.includes(x)) || "";
    const headRank = (p) => p === runner ? 0 : tt[p] === "foreman" ? 1 : tt[p] === "jrforeman" ? 2 : 3;
    const rest = (p) => tt[p] === "lead" ? 0 : 1;
    const want = Math.min(4, pool.length);
    if (want === 1 && !["foreman", "jrforeman", "lead"].includes(tt[pool[0]])) return need(it, `${label(c)} is one crew member, who can't go alone`);
    const from = fromOf(it);
    let at = "", names = [], split = false;
    for (let s = nextWork(from), g = 0; s <= end && g < 120 && !at; s = workAfter(s), g++) {
      for (let cnt = want; cnt >= Math.min(2, want) && !at; cnt--) {
        const nDays = Math.max(1, Math.ceil(it.left / (cnt * HPD) - 1e-9));
        const days = []; for (let d = s, i = 0; i < nDays && d <= end; i++, d = workAfter(d)) days.push(d);
        const avail = pool.filter(p => days.every(d => free([p], d, PH_NEED)));
        const heads = avail.filter(p => isHead(p) || p === runner).sort((x, y) => headRank(x) - headRank(y));
        if (!heads.length && pool.some(isHead)) continue;
        const head = heads[0] || avail[0]; if (!head) continue;
        // another of this crew's jobs (not placed yet) that wants these days keeps its head plus one
        const other = phases.some(o => o !== it && !doneKeys.has(o.key) && crewKey(o) === c.id && fromOf(o) <= days[days.length - 1]);
        const spareHead = other && avail.length >= 4 ? heads.find(p => p !== head) : "";   // a split needs 2 on each side
        const cap = other && spareHead ? Math.max(2, Math.min(cnt, avail.length - 2)) : cnt;
        // Whole set pairs go together: the head brings their pair, then pairs, then people with no pair; the spare
        // head's pair stays back with them. A pair is split only when one of the two isn't free.
        const lim = Math.min(cnt, cap), keep = new Set([spareHead, spareHead && board.partnerOf(spareHead)].filter(Boolean));
        const team = [head]; const used = new Set([head]);
        const pt = board.partnerOf(head);
        const ptOk = pt && !keep.has(pt) && (avail.includes(pt) || (!pool.includes(pt) && board.crewOf(pt) && days.every(d => free([pt], d, PH_NEED))));
        if (ptOk && team.length < lim) { team.push(pt); used.add(pt); }
        const units = []; const seen = new Set(used);
        [...avail.filter(p => !isHead(p) && p !== runner).sort((x, y) => rest(x) - rest(y)), ...avail.filter(p => isHead(p) || p === runner)].forEach(p => {
          if (seen.has(p) || keep.has(p)) return; seen.add(p);
          const q = board.partnerOf(p); if (q && avail.includes(q) && !seen.has(q) && !keep.has(q)) { seen.add(q); units.push([p, q]); } else units.push([p]); });
        units.forEach(u => { if (team.length + u.length <= lim) u.forEach(p => team.push(p)); });
        if (team.length < lim) units.forEach(u => u.forEach(p => { if (team.length < lim && !team.includes(p)) team.push(p); }));
        if (team.length >= cnt || (team.length >= Math.min(2, want) && team.length === Math.min(cnt, cap))) {
          // the head count may have dropped: lay the hours out again for the team it got
          const nd2 = Math.max(1, Math.ceil(it.left / (team.length * HPD) - 1e-9));
          let ok = true; for (let d = s, i = 0; i < nd2 && d <= end; i++, d = workAfter(d)) if (!free(team, d, PH_NEED)) { ok = false; break; }
          if (ok) { at = s; names = team; split = !!(other && spareHead); }
        }
      }
    }
    if (!at) return need(it, `${label(c)} is booked through ${md(end)}`);
    // 4 is the goal, not a minimum (Koy 2026-11-19: "sometimes, if not most times, it's going to be 2 people on a
    // job. We want 4 but sometimes it's just 2. That's fine"): a job with 2 or 3 is placed, not held. It's held only
    // when not even a pair can go, which the loop above never places.
    void split;
    const po = it.start.started ? "" : it.po === "none" ? `${it.tag} starts with no material PO` : it.po === "notOrdered" ? `${it.tag} material card not ordered yet` : "";
    place(it, names, at, it.left, po, label(c));
  };
  // A confirmed start date is a promise to the builder, so those go first, on their date; then work already under
  // way; then the rest, rough-in first (rough-in ahead of finish on the same day throughout).
  const conf = (x) => !x.start.started && x.start.conf;
  const firm = (x) => x.start.started || conf(x);
  const kindRank = (x) => x.kind === "rough" ? 0 : 1;
  fixed.forEach(doTrip);
  phases.filter(conf).sort((a, b) => ord(a, b) || kindRank(a) - kindRank(b)).forEach(doPhase);
  byTrips.forEach(doTrip);   // return trips are short and owed; they go ahead of open-ended work
  phases.filter(x => x.start.started).sort((a, b) => ord(a, b) || kindRank(a) - kindRank(b)).forEach(doPhase);
  phases.filter(x => !firm(x) && x.kind === "rough").sort(ord).forEach(doPhase);   // rough-in first
  phases.filter(x => !firm(x) && x.kind === "finish").sort(ord).forEach(doPhase);
  return needs;
}

// Everything the calendar and the list show.
//   input: { jobs, upcoming, schedules, phaseHours ({ no: { r: [used, est], f: [...] } }),
//            upHours ({ no: { est, used } }), plans ({ key: plan }), today (Date), weeks, effRS, effFS }
function buildCalendar(input) {
  const { jobs = [], upcoming = [], schedules = [], phaseHours = {}, upHours = {}, plans = {}, today = new Date(), weeks = 5, effRS, effFS, users = null, timeOff = [] } = input || {};
  setHolidays(input && "holidays" in input ? input.holidays : null);
  const todayIso = ymd(today), start = mondayOf(today);
  const days = viewDays(start, weeks), end = days[days.length - 1].iso;
  const book = bookingsByNo(schedules);
  const items = [], byNoJob = {};
  const usedDays = {};                       // no → Set of iso already given to a trip
  const mk = (o) => {
    const it = Object.assign({ booked: [], flags: [], start: null, hold: false, est: null, used: null, left: null, over: false, po: null, plan: null, auto: null, defCrew: 2 }, o);
    items.push(it); return it;
  };

  // v660 (Koy 2026-11-20: "Would be really awesome if QC's that need to be scheduled show up here too ... Any scheduling
  // things would be awesome to show here"): other field work that needs a date, as list items of their own ("task").
  // One that needs a date is on Not on the calendar yet under its type, to drag onto a day (a calendar plan; the
  // job's own field is not written). One already set in Command Center shows on its day ("cc"), and isn't moved here.
  // The auto-schedule never places these.
  const task = (j, no, sub, o) => mk(Object.assign({ key: "x_" + sub + "_" + safeKey(j.id) + (o.id ? "_" + safeKey(o.id) : ""), kind: "task", sub, no, name: j.name || "", jobId: j.id,
    foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim() }, o));
  const ccSpan = (a, b) => { const out = []; for (let d = nextWork(a), g = 0; d <= (b && b > a ? b : a) && g < 30; d = workAfter(d), g++) out.push(d); return out.length ? out : [a]; };
  const tasksOf = (j, no, jb) => {
    // QC walks (rough and final): "needs" = needs a date; "scheduled" with its date = set in Command Center.
    [["qcStatus", "qcStatusDate", "Rough QC walk", "rqc"], ["finishQcStatus", "finishQcStatusDate", "Final QC walk", "fqc"]].forEach(([k, kd, tag, sub]) => {
      const st = j[k], d = anyIso(j[kd]);
      if (st === "needs") task(j, no, sub, { tag, group: "qcwalk", defCrew: 1, defHours: 2, ...(d ? { flags: ["Needed by " + md(d)] } : {}) });
      else if (st === "scheduled" && d && d >= todayIso) task(j, no, sub, { tag, group: "qcwalk", ccDays: [d] });
    });
    // Inspections with a target date ahead and no pass yet (a failed one booked again counts): a marker on the day (the inspector comes; no crew).
    [["fourWayTargetDate", "roughInspectionResult", "Rough inspection", "rin"], ["finalInspectionTargetDate", "finalInspectionResult", "Final inspection", "fin"]].forEach(([kd, kr, tag, sub]) => {
      const d = anyIso(j[kd]); if (d && d >= todayIso && j[kr] !== "pass") task(j, no, sub, { tag, group: "insp", ccDays: [d] });
    });
    // Matterport scan: needs (with its needs-by date), or scheduled.
    const ms = j.matterportStatus, msd = anyIso(j.matterportStatusDate), hasScan = !!(j.matterportLink || (Array.isArray(j.matterportLinks) && j.matterportLinks.length));
    if (!j.matterportDismissed && !hasScan) {
      if (ms === "needs") task(j, no, "mp", { tag: "Matterport scan", group: "scan", defCrew: 1, defHours: 2, ...(msd ? { flags: ["Needed by " + md(msd)] } : {}) });
      else if (ms === "scheduled" && msd && msd >= todayIso) task(j, no, "mp", { tag: "Matterport scan", group: "scan", ccDays: [msd] });
    }
    // Approved change orders not made into a return trip yet (a converted one is already a trip on the calendar).
    const conv = new Set((j.returnTrips || []).map(t => t && t.fromCOId).filter(Boolean));
    (Array.isArray(j.changeOrders) ? j.changeOrders : []).forEach((co, i) => {
      if (!co || conv.has(co.id) || co.convertedToTrip || co.tripId) return;
      const id = co.id || "co" + i, h = tripHours(co.time), d = anyIso(co.coStatusDate);
      const tag = "Change order" + (co.number ? " #" + co.number : ""), scope = plain(co.task || co.description || co.title).slice(0, 140);
      if (co.coStatus === "approved") task(j, no, "co", { id, tag, group: "co", scope, defCrew: 2, tripH: h, defHours: 2 * (h || TRIP_DEFAULT_H) });
      else if (co.coStatus === "scheduled" && d && d >= todayIso && !jb[d]) task(j, no, "co", { id, tag, group: "co", scope, ccDays: [d] });
    });
  };

  jobs.forEach(j => {
    if (!j || j.archived) return;
    const no = String(j.simproNo || "").trim();
    const jb = (no && book[no]) || {};
    // Temp ped installs are their own job documents: "" or ready = needs a date; scheduled with its date.
    if (j.tempPed) {
      const st = j.tempPedStatus || "", d = anyIso(j.tempPedScheduledDate);
      if (st === "" || st === "ready") task(j, no, "tp", { tag: "Temp ped install", group: "quick", defCrew: 2, defHours: 4 });
      else if (st === "scheduled" && d && d >= todayIso && !jb[d]) task(j, no, "tp", { tag: "Temp ped install", group: "quick", ccDays: [d] });
      return;
    }
    if (no) byNoJob[no] = j;
    // Return trips: their own items. A scheduled trip takes the Simpro booking on its date.
    (j.returnTrips || []).forEach((t, i) => {
      const iso = tripIso(t), n = Number(t.number) || i + 1;
      // A trip already done that Simpro booked on its date keeps that day as the trip's, so the booking doesn't land on
      // the job's rough-in or finish and start a forecast there (Koy 2026-11-19: "why is kweller finish there? it has no
      // confirmed start date or anything" — its trip #6 was done today, and today's booking went to the finish).
      if (!tripOpen(t)) {
        if (iso && jb[iso]) { const d = mk({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), kind: "trip", tag: "Return trip #" + n, tripNo: n, no, name: j.name || "", jobId: j.id, done: true, start: { iso, conf: true } });
          d.booked.push({ iso, ...jb[iso] }); (usedDays[no] = usedDays[no] || new Set()).add(iso); }
        return;
      }
      const it = mk({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), kind: "trip", tag: "Return trip #" + n, tripNo: n, no, name: j.name || "", jobId: j.id,
        who: String(t.assignedTo || "").trim(), material: plain(t.material).slice(0, 140), foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim(), scope: plain(t.scope || t.task).slice(0, 140), defCrew: 2, tripH: tripHours(t.time), defHours: 2 * (tripHours(t.time) || TRIP_DEFAULT_H),
        start: iso ? { iso, conf: t.rtStatus === "scheduled", by: t.rtStatus === "needs" } : null,
        cause: t.fromFailedFinal || t.scope === "Failed final inspection items" ? "final" : t.fromFailedRough ? "roughfail" : t.fromCOId ? "co"
          : (t.fromQCFail || /^QC (Fail|Items)/.test(String(t.scope || ""))) ? "qc" : /warrant/i.test(String(t.scope || "") + " " + String(t.task || "")) ? "warranty" : "" });
      if (iso && t.rtStatus === "scheduled" && jb[iso]) { it.booked.push({ iso, ...jb[iso] }); (usedDays[no] = usedDays[no] || new Set()).add(iso); }
    });
    if (!j.quickJob) tasksOf(j, no, jb);
    // Quick jobs (service call, panel upgrade, temp ped pickup): new = needs a date; scheduled or in progress shows on
    // its days unless Simpro already has it booked (then it's the "Quick job" booking).
    if (j.quickJob) {
      const st = j.quickJobStatus || "new", d = anyIso(j.quickJobDate), e = anyIso(j.quickJobEndDate);
      if (DONE.includes(st) || j.signedOff) return;
      const QT = { service: "Service call", panel: "Panel upgrade", tempped: "Temp ped pickup" }, tag = QT[j.quickJobType] || "Quick job";
      if (st === "new") task(j, no, "qj", { tag, group: "quick", defCrew: 2, defHours: 8 });
      else if (d && !Object.keys(jb).length) { const ds = ccSpan(d, e).filter(x => x >= todayIso); if (ds.length) task(j, no, "qj", { tag, group: "quick", ccDays: ds }); }
      return;
    }
    const rs = effRS ? effRS(j) : j.roughStatus || "", fs = effFS ? effFS(j) : j.finishStatus || "";
    if (DONE.includes(fs)) return;
    const ph = (LIVE.includes(fs) || DONE.includes(rs)) ? "finish" : "rough";
    const st = ph === "finish" ? fs : rs;
    const hrs = (no && phaseHours[no] && phaseHours[no][ph === "finish" ? "f" : "r"]) || null;
    const hasBook = Object.keys(jb).length > 0;
    if (!hasBook && !hrs && !LIVE.includes(st)) return;
    const pre = ph === "finish" ? "finish" : "rough";
    const psIso = anyIso(j[pre + "ProjectedStart"]), sdIso = anyIso(j[pre + "StatusDate"]);
    const sIso = psIso || (["date_confirmed", "scheduled", "inprogress"].includes(st) ? sdIso : "");
    const it = mk({ key: "j_" + safeKey(j.id) + "_" + ph.charAt(0), kind: ph, tag: KIND_TAG[ph], no, name: j.name || "", jobId: j.id, status: st,
      foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim(),
      hold: st === "waiting", po: poState(ph === "finish" ? j.finishMaterials : j.roughMaterials),
      start: sIso ? { iso: sIso, conf: !!j[pre + "StartConfirmed"] || st === "date_confirmed", started: st === "inprogress" } : (st === "inprogress" ? { iso: "", started: true } : null) });
    if (hrs) { it.used = r1(hrs[0]); it.est = r1(hrs[1]); it.over = it.est > 0 && it.used >= it.est; }
    it._ph = true;
  });

  // Simpro days not taken by a trip go to the job's phase item, or to a "Booked" item when it has none.
  Object.keys(book).forEach(no => {
    const isos = Object.keys(book[no]).filter(iso => !(usedDays[no] && usedDays[no].has(iso))).sort();
    if (!isos.length) return;
    const j = byNoJob[no];
    let it = j ? items.find(x => x._ph && x.jobId === j.id) : null;
    if (!it) it = items.find(x => x.key === "s_" + safeKey(no)) || mk({ key: "s_" + safeKey(no), kind: "service", tag: j && j.quickJob ? "Quick job" : "Booked", no, name: (j && j.name) || "Job #" + no, jobId: j ? j.id : "" });
    isos.forEach(iso => it.booked.push({ iso, ...book[no][iso] }));
  });

  // Upcoming rows that aren't jobs in the app yet (a row whose number is already a job is that job).
  upcoming.forEach(u => {
    if (!u) return;
    const no = upNo(u); if (no && byNoJob[no]) return;
    const sIso = anyIso(u.projectedStart || u.startDate);
    const h = (no && upHours[no]) || null;
    const it = mk({ key: "u_" + safeKey(u.id || u.name), kind: "rough", tag: "Rough-in", upcoming: true, no, name: upName(u), upId: u.id,
      start: sIso ? { iso: sIso, conf: !!u.startConfirmed } : null });
    if (h && h.est) { it.est = r1(h.est); it.used = r1(h.used || 0); it.wholeJob = true; }
  });

  // v656: a copied block (Copy to other days) is its own plan, keyed "<item key>~<day>"; it shows as a copy of
  // its job, with no flags or hours of its own.
  Object.keys(plans || {}).forEach(k => {
    const i = k.indexOf("~"); if (i < 1 || !plans[k]) return;
    const base = items.find(x => x.key === k.slice(0, i)); if (!base) return;
    mk({ key: k, kind: base.kind, tag: base.tag, tripNo: base.tripNo, no: base.no, name: base.name, jobId: base.jobId, upcoming: base.upcoming,
      foreman: base.foreman, jlead: base.jlead, who: base.who, copyOf: base.key, defCrew: base.defCrew, defHours: HPD });
  });

  // Hours left, the auto tail after a booking, kept plans, flags.
  items.forEach(it => {
    it.booked.sort((a, b) => a.iso < b.iso ? -1 : 1);
    it.crewBooked = it.booked.reduce((m, b) => Math.max(m, b.who.length), 0);
    if (it.crewBooked) it.defCrew = it.crewBooked;
    const ahead = it.booked.filter(b => b.iso >= todayIso);
    it.bookedAhead = ahead.length > 0;
    if (it.est != null) {
      // today's hours land in Job Costs' used hours as the day goes, so only later days count as still to come
      const futureHrs = ahead.filter(b => b.iso > todayIso).reduce((a, b) => a + b.hrs, 0);
      it.left = Math.max(0, r1(it.est - it.used - futureHrs));
    }
    if (it.defHours == null) it.defHours = it.left > 0 ? it.left : HPD;
    const p = plans && plans[it.key];
    // v656: { off: true } = taken off the calendar by hand (Koy: "if I don't want a job scheduled, I just delete it
    // off there"): no block, the auto-schedule leaves it alone, it stays on the list as needing scheduling.
    if (p && p.off) it.off = { by: p.by || "", at: p.at || "", why: String(p.why || "").slice(0, 60), note: String(p.note || "").slice(0, 200) };
    else if (p && p.s && Number(p.hours) > 0) it.plan = { s: nextWork(p.s), hours: Number(p.hours), crew: Math.max(1, Number(p.crew) || 1), staff: Array.isArray(p.staff) ? p.staff : [], by: p.by || "", at: p.at || "", ...(hoursOf(p.t) != null ? { t: p.t } : {}) };
    if (!it.plan && !it.off && it.bookedAhead && it.left > 0 && it.kind !== "trip" && (it.kind === "service" || (it.start && (it.start.started || it.start.conf)))) {
      it.auto = { s: workAfter(it.booked[it.booked.length - 1].iso), hours: it.left, crew: Math.max(1, it.crewBooked) };
    }
    const bookedFrom = (iso) => it.booked.some(b => b.iso >= iso);
    if (it.kind === "trip" && !it.done) {
      const s = it.start;
      if (!s) it.flags.push(it.who ? "Not scheduled, no date" : "Not scheduled, no date or crew");
      else if (s.by) it.flags.push(`Needs scheduling by ${md(s.iso)}`);
      else {
        if (!it.who) it.flags.push("No crew assigned in Command Center");
        if (s.iso < todayIso && !bookedFrom(s.iso)) it.flags.push(`Was set for ${md(s.iso)}, not done`);
        else if (s.iso >= todayIso && s.iso <= end && !bookedFrom(s.iso)) it.flags.push(`Set for ${short(s.iso)}, not booked in Simpro`);
      }
    } else if (it.kind !== "service" && it.start && it.start.iso && !it.start.started && !it.hold && it.start.iso <= end) {
      const s = it.start.iso;
      if (!bookedFrom(s)) it.flags.push(s < todayIso ? `Start date ${md(s)} has passed, not booked` : `Starts ${short(s)}, not booked`);
      if (!it.upcoming) {
        if (it.po === "none") it.flags.push(`${it.tag} starts with no material PO`);
        else if (it.po === "notOrdered") it.flags.push(`${it.tag} material card not ordered yet`);
      }
    }
    it.onCal = it.booked.length > 0 || !!it.plan;
    // On the right-hand list: anything with nothing booked from today on and no kept plan.
    if (it.kind === "task" && it.ccDays && !it.plan) { it.onCal = true; it.inList = false; delete it._ph; return; }
    it.inList = !it.done && !it.plan && !it.copyOf && (it.off ? !it.bookedAhead : !it.bookedAhead && (it.kind === "trip" || it.upcoming || it.left == null || it.left > 0 || it.over || it.flags.length > 0)
      && !(it.kind === "service"));
    delete it._ph;
  });

  // v656: the auto-schedule (Josh's rules) when the Crew Board is given.
  // Time off (settings/crewPTO, approved): who's off each day, by their Crew Board name when it can be told.
  const board0 = users ? crewBoard(users) : null, offByDay = {};
  (timeOff || []).forEach(p => {
    const a = p && anyIso(p.start); if (!a || !p.name) return; const b = anyIso(p.end) || a;
    const lo = a <= b ? a : b, hi = a <= b ? b : a, who = (board0 && board0.find(p.name) || { name: String(p.name).trim() }).name;
    for (let d = lo < todayIso ? todayIso : lo, g = 0; d <= hi && d <= end && g < 400; d = addDays(d, 1), g++) { const l = offByDay[d] = offByDay[d] || []; if (!l.includes(who)) l.push(who); }
  });
  const needs = users ? autoPlan(items, { board: board0, schedules, plans, todayIso, end, offByDay }) : [];
  // A plan someone kept, or a Simpro booking, on a day a person on it is off, or on a holiday: flagged, never moved.
  items.forEach(it => {
    // a kept plan, or a forecast tail after Simpro's last booked day (its people are the last day's crew)
    const f = it.plan || (it.auto && it.auto.src !== "auto" ? it.auto : null); const seen = new Set();
    const ppl = f ? ((f.staff || []).length ? f.staff : ((it.booked[it.booked.length - 1] || {}).names || []).map(name => ({ name }))) : [];
    if (f) planDays(f).forEach(d => ppl.forEach(x => { const n = x && x.name; if (n && (offByDay[d.date] || []).includes((board0 && board0.find(n) || { name: n }).name) && !seen.has(n + d.date)) { seen.add(n + d.date); it.flags.push(`${firstOf(n)} is off ${md(d.date)}`); } }));
    it.booked.forEach(b => { if (isHoliday(b.iso)) it.flags.push(`Booked in Simpro on ${holidayName(b.iso) || "a holiday"} (${md(b.iso)})`);
      (b.names || []).forEach(n => { const nm = (board0 && board0.find(n) || { name: n }).name; if ((offByDay[b.iso] || []).includes(nm)) it.flags.push(`${firstOf(n)} is booked ${md(b.iso)} but off that day`); }); });
  });

  const rank = (it) => it.flags.length ? 0 : it.kind === "trip" ? 1 : it.upcoming ? 5 : it.over ? 4 : it.kind === "rough" ? 2 : 3;
  const sIso = (it) => (it.start && it.start.iso) || "9999";
  const list = items.filter(it => it.inList).sort((a, b) => rank(a) - rank(b) || (sIso(a) < sIso(b) ? -1 : sIso(a) > sIso(b) ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const firstIso = (it) => it.booked.length ? it.booked[0].iso : it.plan ? it.plan.s : "9999";
  const cal = items.filter(it => it.onCal).sort((a, b) => (a.booked.length ? 0 : 1) - (b.booked.length ? 0 : 1) || (firstIso(a) < firstIso(b) ? -1 : 1));
  const holidays = {}; days.forEach(d => { if (isHoliday(d.iso)) holidays[d.iso] = holidayName(d.iso) || "Holiday"; });
  return { start, end, today: todayIso, days, items, cal, list, needs, offByDay, holidays,
    counts: { flagged: list.filter(x => x.flags.length).length + cal.filter(x => x.flags.length).length, list: list.length, cal: cal.length, needs: needs.length } };
}

// Koy 2026-11-19: "if that could be separated into what they are (rough ends, finishes, return trips, failed
// finals, etc.)". Every list item gets one of these; lists show them in this order, each with a count, empty ones hidden.
// v660: "Waiting" first (Koy 2026-11-20: "if I remove a job maybe I could be able to put a reason why ... Then just keep
// track of it like that as waiting on something"), then QC walks, quick jobs and scans that need a date.
const GROUPS = [["wait", "Waiting"], ["rough", "Rough-ins"], ["finish", "Finishes"], ["final", "Failed finals"], ["roughfail", "Failed rough inspections"],
  ["co", "Change orders"], ["qc", "QC walk fixes"], ["warranty", "Warranty"], ["trip", "Return trips"], ["qcwalk", "QC walks"], ["quick", "Quick jobs and temp peds"],
  ["scan", "Matterport scans"], ["insp", "Inspections"], ["other", "Other"]];
const groupOf = (it) => !it ? "other" : it.off && it.off.why ? "wait" : it.kind === "task" ? (it.group || "other") : it.kind === "trip" ? (it.cause || "trip") : it.kind === "rough" || it.kind === "finish" ? it.kind : "other";
function groupBy(list, itemOf) {
  const by = {}; (list || []).forEach(x => { const g = groupOf(itemOf ? itemOf(x) : x); (by[g] = by[g] || []).push(x); });
  return GROUPS.map(([k, label]) => ({ k, label, items: by[k] || [] })).filter(g => g.items.length);
}
module.exports = { HPD, ymd, parseYmd, anyDate, anyIso, addDays, dowOf, isHoliday, isWork, nextWork, workAfter, mondayOf, viewDays, span, workdaysBetween, planDays,
  md, short, safeKey, firstOf, bookingsByNo, poState, tripIso, upNo, upName, crewBoard, autoPlan, buildCalendar, slotsOf, clock, hoursOf, tripHours, TRIP_DEFAULT_H, setHolidays, holidayName, DEFAULT_HOLIDAYS, GROUPS, groupOf, groupBy };
