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
// v663 (Koy 2026-11-21: "Fridays can either be requested or put by hand, and they're 1.5 if they're over 40 hours a
// week"): a block a person puts on a Friday starts that Friday; the auto-schedule never picks one, and the days after
// it are ordinary workdays. A Friday that is a holiday still rolls on.
const isFri = (iso) => dowOf(iso) === 4 && !isHoliday(iso);
const startOf = (iso) => isFri(iso) ? iso : nextWork(iso);
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
  const t0 = hoursOf(plan.t), win = winOf(plan), pd = plan.pd || {};
  return planDays(plan).map((d, i) => {
    const ow = winOf(pd[d.date]);
    const from = ow ? ow[0] : win ? win[0] : i === 0 && t0 != null ? t0 : DAY0 + ((plan.times && plan.times[d.date]) || 0);
    return { date: d.date, hours: d.hours, from, to: from + d.hours, start: hhmmOf(from), label: `${clock(from)}–${clock(from + d.hours)}`, ...(d.staff ? { staff: d.staff, crew: d.crew } : {}), ...(d.none ? { none: true } : {}) };
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
// v661 (Koy 2026-11-20: "just let me select a start time and a finish time"): a plan with both `t` and `e` ("HH:MM")
// runs that window every day; its days follow from the hours (a trip's hours are the window times its people).
// Saved as a list (pdl: [{ d, n: [names], t, e }]) so a save replaces it whole.
const pdOf = (l) => { if (!Array.isArray(l) || !l.length) return null; const o = {};
  l.slice(0, 60).forEach(x => { const d = anyIso(x && x.d); if (!d) return; const e = {}; if (Array.isArray(x.n) && x.n.length) e.staff = x.n.slice(0, 12).map(n => ({ name: String(n || "").slice(0, 60) })).filter(y => y.name);
    if (hoursOf(x.t) != null && hoursOf(x.e) != null) { e.t = x.t; e.e = x.e; } if (x.x) e.skip = true; if (x.z) e.none = true; if (e.staff || e.t || e.skip || e.none) o[d] = e; });
  return Object.keys(o).length ? o : null; };
const winOf = (plan) => { const a = hoursOf(plan && plan.t), b = hoursOf(plan && plan.e); return a != null && b != null && b - a >= 0.25 ? [a, b] : null; };
// v661 (Koy 2026-11-20: "I need it to show who's scheduled there that day that I clicked it and then let me have a time:
// full day, half day, or ... custom times"): `pd` is one day's own people and/or window ({ iso: { staff, t, e } });
// the job's hours run on through its other days as before.
function planDays(plan) {
  if (!plan || !plan.s) return [];
  const win = winOf(plan), pd = plan.pd || {};
  if (win || Object.keys(pd).length) {
    const crew = Math.max(1, Number(plan.crew) || 1), t0 = hoursOf(plan.t);
    let left = Math.max(0, Number(plan.hours) || 0), d = startOf(plan.s); const out = [];   // crew-hours
    for (let g = 0; left > 1e-6 && g < 120; g++) {
      if (pd[d] && pd[d].skip) { d = workAfter(d); continue; }   // v662: a day nobody on it is free (a forecast tail)
      const o = pd[d] || {}, st = Array.isArray(o.staff) && o.staff.length ? o.staff : null, cd = st ? st.length : crew, ow = winOf(o);
      const per = ow ? ow[1] - ow[0] : win ? win[1] - win[0] : Math.max(0.25, HPD - (plan.times && plan.times[d] || (g === 0 && t0 != null ? Math.max(0, t0 - DAY0) : 0)));
      const h = Math.min(per, left / cd);
      // v663 (Koy 2026-11-19: "remove everybody from a job, and it just turns red"): a day marked none keeps its place and hours, with nobody on it
      out.push({ date: d, hours: Math.round(h * 4) / 4, ...(o.none && !st ? { staff: [], crew: 0, none: true } : st ? { staff: st, crew: cd } : {}) }); left -= h * cd; d = workAfter(d);
    }
    return out.filter(x => x.hours > 0); }
  const crew = Math.max(1, Number(plan.crew) || 1);
  let left = Math.max(0, Number(plan.hours) || 0) / crew, d = startOf(plan.s);
  const out = [];
  // a day that starts late (after a trip, or a start time someone set) ends at 5:00 like the rest; the hours carry on
  const t0 = hoursOf(plan.t), off = (date, i) => (plan.times && plan.times[date]) || (i === 0 && t0 != null ? Math.max(0, t0 - DAY0) : 0);
  for (let g = 0; left > 1e-6 && g < 120; g++) { const h = Math.min(Math.max(0.25, HPD - off(d, g)), left); out.push({ date: d, hours: Math.round(h * 4) / 4 }); left -= h; d = workAfter(d); }
  return out.filter(x => x.hours > 0);
}

// Simpro schedule rows → { "<job no>": { iso: { who: [first names], hrs } } }. Days with under 2 crew
// hours on a job (time-clock blips) are left off. Two people with the same first name get an initial.
function bookingsByNo(schedules, floor) {
  const min = floor == null ? 2 : floor;   // v663: a return trip can be a half-hour visit; trips read with a lower floor
  const rows = (schedules || []).filter(s => s && s.Type === "job" && s.Reference && s.Date);
  const firsts = {};
  rows.forEach(s => { const n = (s.Staff && s.Staff.Name) || ""; const f = firstOf(n); (firsts[f] = firsts[f] || new Set()).add(n); });
  const label = (n) => { const f = firstOf(n); if ((firsts[f] || new Set()).size < 2) return f; const p = String(n).trim().split(/\s+/); return f + " " + (p[p.length - 1] || "").charAt(0) + "."; };
  const out = {};
  rows.forEach(s => {
    const no = String(s.Reference).split("-")[0], iso = String(s.Date).slice(0, 10);
    const hrs = (s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0;
    const day = ((out[no] = out[no] || {})[iso] = out[no][iso] || { who: [], hrs: 0, names: [], win: {} });
    const fullN = (s.Staff && s.Staff.Name) || "";
    // v663: the day's real clock window (earliest start to latest end), so a clash check doesn't assume 7:00
    (s.Blocks || []).forEach(b => { const a = hoursOf(String((b && b.StartTime) || "").slice(0, 5)), z = hoursOf(String((b && b.EndTime) || "").slice(0, 5));
      if (a != null && z != null && z > a) { day.from = day.from == null ? a : Math.min(day.from, a); day.to = day.to == null ? z : Math.max(day.to, z);
        if (fullN) (day.win[fullN] = day.win[fullN] || []).push([a, z]); } });   // v663: each person's own times, so two half days on two jobs aren't read as a double-book
    const full = (s.Staff && s.Staff.Name) || "", w = label(full);
    if (w && !day.who.includes(w)) { day.who.push(w); day.names.push(full); }
    day.hrs += hrs;
  });
  Object.keys(out).forEach(no => Object.keys(out[no]).forEach(iso => { if (out[no][iso].hrs < min) delete out[no][iso]; else out[no][iso].hrs = r1(out[no][iso].hrs); }));
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
    if (m.length === 1) return m[0];
    // v663: the other way round too. Simpro's "Daegan Smith" is the Crew Board's "Daegan" when only one person there goes by that first name alone
    const one = l ? act.filter(u => lc(u.name) === f) : [];
    return one.length === 1 ? one[0] : null;
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
  // v663: a person is one person whatever a source calls them. Simpro's "Daegan Smith" and the Crew Board's "Daegan"
  // share one key, so a Simpro booking always blocks the Crew Board person (it used to be kept under the Simpro name).
  const keyMemo = {};
  const keyOf = (name) => { const raw = lc(name); if (keyMemo[raw] == null) { const u = board.find(name); keyMemo[raw] = u ? lc(u.name) : raw; } return keyMemo[raw]; };
  const usedOn = (name, iso) => ((used[keyOf(name)] || {})[iso]) || 0;
  const mark = (name, iso, h) => { const k = keyOf(name); const m = used[k] = used[k] || {}; m[iso] = Math.min(HPD, (m[iso] || 0) + (h == null ? HPD : h)); };
  Object.entries(offByDay).forEach(([iso, names]) => names.forEach(n => mark(n, iso)));   // nobody is booked on a day off
  const free = (names, iso, need) => names.every(n => usedOn(n, iso) + (need == null ? HPD : need) <= HPD + 1e-6);
  const PH_NEED = HPD / 2;   // a job can start a person's day after a trip of up to half a day
  // v663: hours here are counted from 7:00 on, so a Simpro booking that starts later in the day (a 1:00 PM trip,
  // an afternoon off) holds that person's whole day, the same rule v661 gave late-start plans. Nothing is laid
  // "after" hours that are really in the afternoon.
  const perDay = {}, lateDay = {};
  (schedules || []).forEach(s => { if (!s || !s.Date || !s.Staff || !s.Staff.Name) return;
    const k = s.Staff.Name + "|" + String(s.Date).slice(0, 10);
    perDay[k] = (perDay[k] || 0) + ((s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0);
    (s.Blocks || []).forEach(b => { const st = hoursOf(String((b && b.StartTime) || "").slice(0, 5)); if (st != null && st > DAY0 + 0.25) lateDay[k] = true; }); });
  Object.keys(perDay).forEach(k => { const [n, iso] = k.split("|"); mark(n, iso, lateDay[k] ? HPD : Math.max(0.25, perDay[k])); });
  const crewNames = (it) => { const c = board.crewOf(it.foreman) || board.crewOf(it.jlead); return c ? c.people : []; };
  // what is already planned holds its people
  const hold = (it, f, who) => {
    // a block set to start after 7:00 holds the person's whole day, so nothing auto lands under it (v661: no double booking)
    const late = (hoursOf(f.t) || DAY0) > DAY0 + 1e-6;
    slotsOf(f).forEach(d => { if (d.date <= end) (d.staff ? d.staff.map(x => x && x.name).filter(Boolean) : who).forEach(n => mark(n, d.date, late || d.from > DAY0 + 1e-6 && (it.plan || f.src === "duet") ? HPD : d.hours)); });
  };
  items.forEach(it => { if (!it.plan) return; const names = (it.plan.staff || []).map(x => x && x.name).filter(Boolean); hold(it, it.plan, names); });   // v663: a plan with no names has nobody on it (shown red), so it holds nobody
  // v662: the forecast tail after Simpro's last booked day (its people are the last booked day's crew) is checked day
  // by day like any other block (Koy 2026-11-20: "If they're scheduled somewhere else, that time is blocked off. Can't
  // even happen"): someone off, or with over half the day already taken, comes off that day; a day starts after what its
  // people already have; a day with nobody left (or one crew member alone) is skipped and the hours run on.
  const titleOf = (n) => { const c = board.crewOf(n); const u = board.find(n); return (c && u && c.title && c.title[u.name]) || ""; };
  // v670: a block Duet proposed holds its people too, so the auto-schedule lays its own guesses around it
  items.forEach(it => { if (it.plan || !it.auto || it.auto.src !== "duet") return; hold(it, it.auto, (it.auto.staff || []).map(x => x && x.name).filter(Boolean)); it.onCal = true; it.inList = false; });
  items.filter(it => it.auto && !it.plan && it.auto.src !== "duet").sort((a, b) => a.auto.s < b.auto.s ? -1 : a.auto.s > b.auto.s ? 1 : 0).forEach(it => {
    const f = it.auto, names = (f.staff || []).map(x => x && x.name).filter(Boolean);
    const lastDay = it.booked.length ? it.booked[it.booked.length - 1] : null;
    const who0 = names.length ? names : ((lastDay && lastDay.names) || []);
    // v663: someone Unassigned (or an admin) on the Crew Board is never forecast, even when Simpro had them on the last
    // booked day; a name the Crew Board doesn't know stays, flagged. The tail's head count is its own people, not the
    // biggest day Simpro ever had, so the block, the hours and Book all mean the same people.
    const who = who0.filter(n => { const u = board.find(n); if (u && !board.crewOfUser(u)) { it.flags.push(`${firstOf(n)} is unassigned on the Crew Board, so left off the forecast`); return false; }
      if (!u) it.flags.push(`${n} is booked in Simpro but isn't on the Crew Board`); return true; });
    if (!who.length) { it.auto = null; return; }
    if (!names.length) { f.staff = who.map(name => ({ name })); f.crew = who.length; }
    const pd = {}, times = {}; let left = Math.max(0, Number(f.hours) || 0), d = nextWork(f.s);
    for (let g = 0; left > 1e-6 && g < 120 && d <= end; g++, d = workAfter(d)) {
      const on = who.filter(n => usedOn(n, d) <= PH_NEED + 1e-6);
      if (!on.length || (on.length === 1 && !["foreman", "jrforeman", "lead"].includes(titleOf(on[0])))) { pd[d] = { skip: true }; continue; }
      if (on.length !== who.length) pd[d] = { staff: on.map(name => ({ name })) };
      const st = Math.min(HPD - 0.25, Math.max(0, ...on.map(n => usedOn(n, d)))); if (st > 0) times[d] = st;
      const h = Math.min(HPD - st, left / on.length); on.forEach(n => mark(n, d, st > 0 ? HPD : h)); left -= h * on.length;
    }
    if (Object.keys(pd).length) f.pd = pd; if (Object.keys(times).length) f.times = times;
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
  // v663 (rule: "a job with nobody on it stays on its day in red"): a job the auto-schedule can't staff keeps a red
  // marker on the day it was meant for (its start date, or the next workday for work under way).
  const redOn = (it, iso) => { const d = nextWork(iso && iso > todayIso ? iso : todayIso); if (d <= end) it.redDay = d; };
  const need = (it, why) => { it.need = why; it.inList = false; needs.push({ key: it.key, why, held: false });
    redOn(it, (it.start && it.start.iso) || ""); };
  // the days place() would use: each day starts when the last of its people is free
  const layDays = (names, s, hours) => { const out = []; let left = hours / Math.max(1, names.length);
    for (let d = nextWork(s), g = 0; left > 1e-6 && g < 120; d = workAfter(d), g++) { const st = Math.min(HPD - 0.25, Math.max(0, ...names.map(n => usedOn(n, d)))); out.push(d); left -= Math.min(HPD - st, left); }
    return out; };
  const place = (it, names, s, hours, held, label) => {
    // each day starts when the last of its people is free (7:00 plus what they already have that day)
    const times = {}; let left = hours / Math.max(1, names.length);
    for (let d = nextWork(s), g = 0; left > 1e-6 && g < 120; d = workAfter(d), g++) {
      const st = Math.min(HPD - 0.25, Math.max(0, ...names.map(n => usedOn(n, d))));
      if (st > 0) times[d] = st; left -= Math.min(HPD - st, left);
    }
    it.auto = { s, hours, crew: names.length, staff: names.map(name => ({ name })), team: label, src: "auto", held: held || "", times };
    // v663: a day that starts late sits in the afternoon, so it holds its people's whole day; nothing else is laid "after" it on top
    planDays(it.auto).forEach(d => { if (d.date <= end) names.forEach(n => mark(n, d.date, times[d.date] ? HPD : d.hours)); });
    it.onCal = true; it.inList = false;
    if (held) needs.push({ key: it.key, why: held, held: true });
  };
  const label = (c) => c ? firstOf(c.foreman) + "'s crew" : "";

  // v671 (Koy 2026-11-18 plan, open until now): an Upcoming job (not a job in the app yet) is a candidate once its start
  // is CONFIRMED, so a promised start is never just a row on a list. With a foreman and bid hours it is placed; without,
  // it goes to Needs you and sits red on its day.
  const isCand = (it) => !it.plan && !it.auto && !it.off && (!it.upcoming || !!(it.start && it.start.conf && it.start.iso)) && it.kind !== "service";
  const sIso = (it) => (it.start && it.start.iso) || "";
  const trips = items.filter(it => isCand(it) && it.kind === "trip" && !it.booked.length);
  const phases = items.filter(it => isCand(it) && (it.kind === "rough" || it.kind === "finish") && !it.bookedAhead && !it.hold
    && it.start && (it.start.started || (sIso(it) && sIso(it) <= end)));   // v663 (Koy: "estimated starts as well, and we can take them off. That way, it doesn't get missed")
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
    // v663 (Koy 2026-11-20: "there are teams scheduled together that aren't teams ... within the crew board they are pairs
    // as well"): a set pair goes together. Someone whose pair is free goes with that person and nobody else. Someone with no
    // set pair, or whose pair is off or already booked that day, goes with another person in the same spot. Nobody is
    // taken away from a pair that could go together, just to fill a seat.
    const okMate = (p) => { const q = board.partnerOf(p); return q && board.crewOf(q) ? q : ""; };
    const crewFor = (d) => {
      for (const l of leaders) { if (!free([l], d, th)) continue; const q = okMate(l);
        if (q && free([q], d, th)) return { names: [l, q] };
        const m = mates(l).find(p => p !== q && free([p], d, th) && !(okMate(p) && free([okMate(p)], d, th))); if (m) return { names: [l, m] }; }
      if (!lead0.length) { const fr = c.people.filter(p => free([p], d, th));
        const pr = fr.find(p => okMate(p) && free([okMate(p)], d, th)); if (pr) return { names: [pr, okMate(pr)] };
        const two = fr.filter(p => !(okMate(p) && free([okMate(p)], d, th))); if (two.length >= 2) return { names: two.slice(0, 2) }; }
      const solo = leaders.find(l => free([l], d, th) && canLead(l));
      return solo ? { names: [solo], solo: true } : null;
    };
    if (s && !s.by && s.iso < todayIso) return need(it, `Was set for ${md(s.iso)}, not done. Pick a new date`);
    if (s && !s.by && !isWork(s.iso)) return need(it, `Set for ${short(s.iso)}, ${isHoliday(s.iso) ? "a holiday" : "Fridays are volunteer only"}`);
    const notes = [];
    if (!s && noCrew) notes.push("No date or crew set in Command Center, so it's on the first open day");
    else if (!s) notes.push("No date set in Command Center, so it's on the first open day");
    else if (noCrew) notes.push("No crew set in Command Center");
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
    if (it.done100) return need(it, `${it.tag} is at 100% with nothing left open. Mark it Complete on the job`);
    if (it.over && !it.leftBy) return need(it, "Over bid. Set the hours by hand");
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
        // v663: set pairs stay whole. mateOf: a name = their set pair is free these days, so the two go together (from any
        // crew); "" = no set pair, or the pair is off / booked these days, so they go as one. A pair that could go
        // together is never split to fill a seat.
        const mateOf = (p) => { const q = board.partnerOf(p); if (!q || !board.crewOf(q)) return ""; return (pool.includes(q) ? avail.includes(q) : days.every(d => free([q], d, PH_NEED))) ? q : ""; };
        const head = heads[0] || avail[0]; if (!head) continue;
        // another of this crew's jobs (not placed yet) that wants these days keeps its head plus one
        const other = phases.some(o => o !== it && !doneKeys.has(o.key) && crewKey(o) === c.id && fromOf(o) <= days[days.length - 1]);
        const spareHead = other && avail.length >= 4 ? heads.find(p => p !== head) : "";   // a split needs 2 on each side
        const cap = other && spareHead ? Math.max(2, Math.min(cnt, avail.length - 2)) : cnt;
        // Whole set pairs go together: the head brings their pair, then pairs, then people with no pair; the spare
        // head's pair stays back with them. A pair is split only when one of the two isn't free.
        const lim = Math.min(cnt, cap), keep = new Set([spareHead, spareHead && board.partnerOf(spareHead)].filter(Boolean));
        const team = [head]; const used = new Set([head]);
        const pt = mateOf(head);
        if (pt && !keep.has(pt) && team.length < lim) { team.push(pt); used.add(pt); }
        const units = []; const seen = new Set(used);
        [...avail.filter(p => !isHead(p) && p !== runner).sort((x, y) => rest(x) - rest(y)), ...avail.filter(p => isHead(p) || p === runner)].forEach(p => {
          if (seen.has(p) || keep.has(p)) return; seen.add(p);
          const q = mateOf(p);
          if (q) { if (!seen.has(q) && !keep.has(q)) { seen.add(q); units.push([p, q]); } } else units.push([p]); });
        units.forEach(u => { if (team.length + u.length <= lim && !u.some(p => team.includes(p))) u.forEach(p => team.push(p)); });
        if (team.length >= cnt || (team.length >= Math.min(2, want) && team.length === Math.min(cnt, cap))) {
          // the head count may have dropped: lay the hours out again for the team it got
          // v662: every day it would really take, as place() lays it (a late start rolls hours onto one more day)
          const ok = layDays(team, s, it.left).every(d => d > end || free(team, d, PH_NEED));
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
    // v663: a confirmed start the crew can't make is a call for a person, not a quiet slide to a later day. The block is
    // laid on the first clear run, held (not bookable until someone clears it), and the promised day keeps a red marker.
    const promised = !it.start.started && it.start.conf && sIso(it) ? nextWork(sIso(it) < first ? first : sIso(it)) : "";
    const late = promised && at > promised ? `Confirmed start ${md(sIso(it))}, but ${label(c)} isn't free until ${md(at)}` : "";
    if (late) redOn(it, promised);
    // nobody works alone: one person on a rough-in or finish is held, like a lone leader on a trip
    const solo = names.length === 1 ? `Only ${firstOf(names[0])} on it, no second person` : "";
    place(it, names, at, it.left, [late, solo, po].filter(Boolean).join(". "), label(c));
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
  const { jobs = [], upcoming = [], schedules = [], phaseHours = {}, upHours = {}, plans = {}, proposals = {}, today = new Date(), weeks = 5, effRS, effFS, users = null, timeOff = [], openPunch = null } = input || {};
  setHolidays(input && "holidays" in input ? input.holidays : null);
  const todayIso = ymd(today), start = mondayOf(today);
  const days = viewDays(start, weeks), end = days[days.length - 1].iso;
  const book = bookingsByNo(schedules), bookAny = bookingsByNo(schedules, 0.25);
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
    const jb = (no && book[no]) || {}, jbT = (no && bookAny[no]) || {};   // jbT: short bookings too, for a trip's own day
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
        if (iso && (jb[iso] || jbT[iso])) { const d = mk({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), kind: "trip", tag: "Return trip #" + n, tripNo: n, no, name: j.name || "", jobId: j.id, done: true, start: { iso, conf: true } });
          d.booked.push({ iso, ...(jb[iso] || jbT[iso]) }); (usedDays[no] = usedDays[no] || new Set()).add(iso); }
        return;
      }
      const it = mk({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), kind: "trip", tag: "Return trip #" + n, tripNo: n, no, name: j.name || "", jobId: j.id, tripId: t.id ? String(t.id) : "",
        // v663 (Koy: "Always book to the relevant cost centers"): a trip from a failed rough inspection, or on a job whose
        // rough-in isn't complete, is Rough In work; anything else is Finish.
        cc: t.fromFailedRough ? "rough" : (t.fromFailedFinal || t.scope === "Failed final inspection items") ? "finish" : DONE.includes(effRS ? effRS(j) : j.roughStatus || "") ? "finish" : "rough", calBooked: t.calBooked ? { date: t.calBooked.date || "" } : null,
        who: String(t.assignedTo || "").trim(), material: plain(t.material).slice(0, 140), foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim(), scope: plain(t.scope || t.task).slice(0, 140), defCrew: 2, tripH: tripHours(t.time), defHours: 2 * (tripHours(t.time) || TRIP_DEFAULT_H),
        start: iso ? { iso, conf: t.rtStatus === "scheduled", by: t.rtStatus === "needs" } : null,
        cause: t.fromFailedFinal || t.scope === "Failed final inspection items" ? "final" : t.fromFailedRough ? "roughfail" : t.fromCOId ? "co"
          : (t.fromQCFail || /^QC (Fail|Items)/.test(String(t.scope || ""))) ? "qc" : /warrant/i.test(String(t.scope || "") + " " + String(t.task || "")) ? "warranty" : "" });
      if (iso && t.rtStatus === "scheduled" && (jb[iso] || jbT[iso])) { it.booked.push({ iso, ...(jb[iso] || jbT[iso]) }); (usedDays[no] = usedDays[no] || new Set()).add(iso); }
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
    // v663: a rough-in still in progress is the job's phase even when its finish already has a date (the finish used to
    // take over and the rough-in vanished from the calendar)
    const ph = rs === "inprogress" && fs !== "inprogress" ? "rough" : (LIVE.includes(fs) || DONE.includes(rs)) ? "finish" : "rough";
    const st = ph === "finish" ? fs : rs;
    const hrs = (no && phaseHours[no] && phaseHours[no][ph === "finish" ? "f" : "r"]) || null;
    const hasBook = Object.keys(jb).length > 0;
    const pre = ph === "finish" ? "finish" : "rough";
    // v663: a confirmed start with no Job Costs hours yet still shows (it goes to Needs you for its hours)
    if (!hasBook && !hrs && !LIVE.includes(st) && !(j[pre + "StartConfirmed"] && anyIso(j[pre + "ProjectedStart"]))) return;
    const psIso = anyIso(j[pre + "ProjectedStart"]), sdIso = anyIso(j[pre + "StatusDate"]);
    const sIso = psIso || (["date_confirmed", "scheduled", "inprogress"].includes(st) ? sdIso : "");
    const it = mk({ key: "j_" + safeKey(j.id) + "_" + ph.charAt(0), kind: ph, tag: KIND_TAG[ph], no, name: j.name || "", jobId: j.id, status: st, stage: parseFloat(j[pre + "Stage"]) || 0,
      foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim(),
      hold: st === "waiting", po: poState(ph === "finish" ? j.finishMaterials : j.roughMaterials),
      start: sIso ? { iso: sIso, conf: !!j[pre + "StartConfirmed"] || st === "date_confirmed", started: st === "inprogress" } : (st === "inprogress" ? { iso: "", started: true } : null) });
    if (hrs) { it.used = r1(hrs[0]); it.est = r1(hrs[1]); it.over = it.est > 0 && it.used >= it.est; }
    // v672 (Koy 2026-11-20, Vista Meadows: "it is done"): a phase still marked In Progress at 100% with nothing left
    // open (no punch, no failed-inspection items) stops holding people. It stays visible as a call for a person (mark it
    // Complete), with no crew or hours forecast. openPunch(job, phase) is passed in by the screen and by the server
    // read, the same count both ways; without it the rule is off.
    if (st === "inprogress" && it.stage >= 100 && typeof openPunch === "function" && openPunch(j, ph) === 0) it.done100 = true;
    if (ph === "rough" && LIVE.includes(fs) && fs !== "waiting") { const fd = anyIso(j.finishProjectedStart) || anyIso(j.finishStatusDate); if (fd) it.flags.push(`Finish is set for ${md(fd)}; it goes on the calendar when rough-in is complete`); }
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
      foreman: String(u.foreman || "").trim(),   // v671: so an Upcoming job with a confirmed start can be placed with its foreman's crew
      start: sIso ? { iso: sIso, conf: !!u.startConfirmed } : null });
    if (h && h.est) { it.est = r1(h.est); it.used = r1(h.used || 0); it.wholeJob = true; }
  });

  // v656: a copied block (Copy to other days) is its own plan, keyed "<item key>~<day>"; it shows as a copy of
  // its job, with no flags or hours of its own.
  Object.keys(plans || {}).forEach(k => {
    const i = k.indexOf("~"); if (i < 1 || !plans[k]) return;
    const base = items.find(x => x.key === k.slice(0, i)); if (!base) return;
    mk({ key: k, kind: base.kind, tag: base.tag, tripNo: base.tripNo, no: base.no, name: base.name, jobId: base.jobId, upcoming: base.upcoming,
      foreman: base.foreman, jlead: base.jlead, who: base.who, copyOf: base.key, defCrew: base.defCrew, defHours: HPD, ...(base.cc ? { cc: base.cc } : {}) });
  });

  // Hours left, the auto tail after a booking, kept plans, flags.
  items.forEach(it => {
    it.booked.sort((a, b) => a.iso < b.iso ? -1 : 1);
    it.crewBooked = it.booked.reduce((m, b) => Math.max(m, b.who.length), 0);
    if (it.crewBooked) it.defCrew = it.crewBooked;
    const ahead = it.booked.filter(b => b.iso >= todayIso);
    it.bookedAhead = ahead.length > 0;
    if (it.est != null) {
      // v663: used hours come from last night's Job Costs run, so today's booked hours are still to come too
      const futureHrs = ahead.reduce((a, b) => a + b.hrs, 0);
      it.left = Math.max(0, r1(it.est - it.used - futureHrs));
    }
    // v661 (Koy 2026-11-20: "why is Ashcraft not showing up on the finishes? Same with Rose. Those are both actively
    // going right now"): a phase in progress keeps going until it's marked complete. When Job Costs has no hours left
    // (used up or over bid), the rest comes from its stage instead: (100 − stage)% of the bid hours, or a week for the
    // crew Simpro has on it when there are no bid hours. It's placed like any job in progress, not held.
    if ((it.kind === "rough" || it.kind === "finish") && it.start && it.start.started && !(it.left > 0)) {
      const pct = Math.min(99, Math.max(0, it.stage || 0));
      if (it.est > 0) { it.left = Math.max(HPD, r1(it.est * (100 - pct) / 100)); it.leftBy = "stage"; }
      else { it.left = Math.max(1, it.crewBooked || 4) * HPD * 4; it.leftBy = "week"; }
    }
    if (it.defHours == null) it.defHours = it.left > 0 ? it.left : HPD;
    const p = plans && plans[it.key];
    // v656: { off: true } = taken off the calendar by hand (Koy: "if I don't want a job scheduled, I just delete it
    // off there"): no block, the auto-schedule leaves it alone, it stays on the list as needing scheduling.
    if (p && p.off) it.off = { by: p.by || "", at: p.at || "", why: String(p.why || "").slice(0, 60), note: String(p.note || "").slice(0, 200) };
    else if (p && p.s && Number(p.hours) > 0) it.plan = { s: startOf(p.s), hours: Number(p.hours), crew: Math.max(1, Number(p.crew) || 1), staff: Array.isArray(p.staff) ? p.staff : [], by: p.by || "", at: p.at || "", ...(hoursOf(p.t) != null ? { t: p.t } : {}), ...(hoursOf(p.t) != null && hoursOf(p.e) != null ? { e: p.e } : {}), ...(pdOf(p.pdl) ? { pd: pdOf(p.pdl) } : {}) };
    // v670 (Duet's suggest door, Koy 2026-11-20): a block Duet proposed (meetings/scramble__prefs.duet[key], checked by
    // the server before it was saved) takes the place of the auto-schedule's own guess for this job or trip. It sits at
    // the forecast level: a plan a person placed, or taking the job off the calendar, always wins, and it is ignored
    // once all its days are past.
    const dp = !it.plan && !it.off && proposals && proposals[it.key];
    if (dp && dp.s && Number(dp.hours) > 0 && pdOf(dp.pdl)) {
      const f = { s: startOf(dp.s), hours: Number(dp.hours), crew: Math.max(1, Number(dp.crew) || 1), staff: Array.isArray(dp.staff) ? dp.staff : [], pd: pdOf(dp.pdl), src: "duet", why: String(dp.why || "").slice(0, 200), id: String(dp.id || ""), at: dp.at || "" };
      if (planDays(f).some(d => d.date >= todayIso)) it.auto = f;
    }
    if (it.auto && it.auto.src === "duet") { /* Duet's proposal stands in for the forecast */ }
    else if (!it.plan && !it.off && !it.done100 && it.bookedAhead && it.left > 0 && it.kind !== "trip" && (it.kind === "service" || (it.start && (it.start.started || it.start.conf)))) {
      it.auto = { s: workAfter(it.booked[it.booked.length - 1].iso), hours: it.left, crew: Math.max(1, it.crewBooked) };
    }
    const bookedFrom = (iso) => it.booked.some(b => b.iso >= iso);
    if (it.kind === "trip" && !it.done) {
      const s = it.start;
      // v663 (Koy 2026-11-21: "It should still schedule the return trip, but should flag for me to send a PO")
      if (!it.material) it.flags.push("No material on the trip: send a PO");
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
    // v663 (Koy 2026-11-21: "If it's scheduled in Simpro, no material ordered, that's when I get flagged"): anything
    // Simpro has booked from today on with no material behind it, whatever its start date says.
    if (it.bookedAhead && !it.done) {
      const d0 = md(ahead[0].iso);
      if ((it.kind === "rough" || it.kind === "finish") && !(it.start && it.start.started) && (it.po === "none" || it.po === "notOrdered")) { const m = `Booked in Simpro ${d0}, ${it.po === "none" ? "no material PO" : "material not ordered yet"}`; it.flags = it.flags.filter(f => !/material (PO|card)/.test(f)); it.flags.push(m); }
      else if (it.kind === "trip" && !it.material) { it.flags = it.flags.filter(f => !/^No material on the trip/.test(f)); it.flags.push(`Booked in Simpro ${d0}, no material on the trip: send a PO`); }
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
    if (f) planDays(f).forEach(d => (d.staff || ppl).forEach(x => { const n = x && x.name; if (n && (offByDay[d.date] || []).includes((board0 && board0.find(n) || { name: n }).name) && !seen.has(n + d.date)) { seen.add(n + d.date); it.flags.push(`${firstOf(n)} is off ${md(d.date)}`); } }));
    if (it.done100 && !it.need) it.flags.push(`${it.tag} is at 100% with nothing left open. Mark it Complete on the job`);
    // v671 (Koy's rule 5: a return trip's block should be the trip's own crew): the trip names someone, and nobody on
    // the block is that person or on their crew.
    if (f && it.kind === "trip" && !it.done && it.who && board0) { const w = board0.find(it.who), wc = w && board0.crewOfUser(w), on = (f.staff || []).map(x => x && x.name).filter(Boolean);
      if (wc && on.length && !on.some(n => wc.people.includes((board0.find(n) || { name: n }).name))) it.flags.push(`The trip is assigned to ${firstOf(w.name)}, but the block has ${on.map(firstOf).join(", ")}`); }
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
// ── What the screen shows (v668) ─────────────────────────────────────────────
// Pure, so the calendar screen and the calendar read for Duet (functions/scrambleRead.js) draw from the same rules:
// which blocks are on each day, who is busy when, who is open or under 10 hours, and why a job is there.
const fcOf = (it) => it.plan || it.auto;
// The blocks on each day: { iso: [chip] }. A chip is { it, style: booked|cc|kept|auto|held|open, names, who, from, to, ... }.
function chipsOf(V, board) {
  const out = {};
  const fmOf = (names) => [...new Set(names.map(n => { const c = board.crewOf(n); return c ? firstOf(c.foreman) : ""; }).filter(Boolean))];
  const push = (iso, c) => { (out[iso] = out[iso] || []).push(c); };
  // v665 (Koy 2026-11-20, Webb drawn three times: "tf is webb there 3 times"): Simpro wins. Each person's Simpro times per
  // day, so a plan or forecast never shows someone at a time Simpro has them, and never draws a day Simpro already has for it.
  const canon = (n) => { const u = board.find(n); return u ? u.name : n; }, sim = {};
  V.items.forEach(it => it.booked.forEach(b => (b.names || []).forEach(n => { const k = canon(n), w = (b.win && b.win[n] && b.win[n].length) ? b.win[n] : [[b.from != null ? b.from : DAY0, b.to != null ? b.to : DAY0 + HPD]];
    ((sim[k] = sim[k] || {})[b.iso] = sim[k][b.iso] || []).push(...w); })));
  V.items.forEach(it => {
    it.booked.forEach(b => push(b.iso, { it, style: "booked", n: b.who.length, who: b.who, names: b.names || [], win: b.win || null, fm: fmOf(b.names || []), hrs: b.hrs, from: b.from != null ? b.from : DAY0, to: b.to != null ? b.to : DAY0 + Math.min(HPD, (b.hrs || HPD) / Math.max(1, b.who.length)) }));
    // v663: a job the auto-schedule couldn't staff (or a confirmed start it had to hold) stays on its day, in red
    if (it.redDay && it.redDay <= V.end && !(fcOf(it) && slotsOf(fcOf(it)).some(d => d.date === it.redDay))) push(it.redDay, { it, style: "open", n: 0, who: [], names: [], fm: it.foreman ? fmOf([it.foreman]) : [], hrs: 0 });
    const f = fcOf(it);
    if (!f) { (it.ccDays || []).forEach(iso => { if (iso <= V.end) push(iso, { it, style: "cc", n: 0, who: [], names: [], fm: it.foreman ? fmOf([it.foreman]) : [], hrs: 0 }); }); return; }
    const names = (f.staff || []).map(s => s && s.name).filter(Boolean);
    // v663: only an auto forecast borrows the last booked day's people; a saved plan shows exactly who is on it
    const nm = names.length ? names : it.plan ? [] : ((it.booked[it.booked.length - 1] || {}).names || []);
    const style = it.plan ? "kept" : f.src === "duet" ? "duet" : f.src === "auto" && f.held ? "held" : "auto";
    slotsOf(f).forEach(d => { if (d.date > V.end) return; const offD = (V.offByDay && V.offByDay[d.date]) || [];
      if (it.booked.some(b => b.iso === d.date)) return;   // Simpro already has this job or trip that day: its booking is the block
      const inSim = (n) => ((sim[canon(n)] || {})[d.date] || []).some(([a, z]) => d.from < z - 1e-6 && a < d.to - 1e-6);
      // v663 (Koy: "it shouldn't even be possible"): time off wins. Someone off that day is never shown on a forecast or plan that day.
      const isOff = (n) => { const u = board.find(n); return offD.includes(u ? u.name : n); };
      const rawD = d.staff ? d.staff.map(x => x && x.name).filter(Boolean) : nm, nmD = rawD.filter(n => !isOff(n) && !inSim(n)), offLeft = rawD.filter(isOff).map(firstOf), simLeft = rawD.filter(n => !isOff(n) && inSim(n)).map(firstOf);
      if (d.none || (it.plan && !nmD.length)) { push(d.date, { it, style: "open", none: true, offLeft, simLeft, n: 0, who: [], names: [], fm: it.foreman ? fmOf([it.foreman]) : [], hrs: 0, time: d.label, from: d.from, to: d.to }); return; }
      push(d.date, { it, style, n: d.crew || f.crew, who: nmD.map(firstOf), names: nmD, offLeft, simLeft, fm: fmOf(nmD), hrs: Math.round(d.hours * f.crew * 10) / 10, team: f.team || "", time: d.label, from: d.from, to: d.to }); });
  });
  const ord = { booked: 0, cc: 1, kept: 2, duet: 3, auto: 3, held: 4, open: 5 }, kord = { rough: 0, finish: 1, trip: 2, service: 3, task: 4 };
  Object.values(out).forEach(l => l.sort((a, b) => (a.from || 7) - (b.from || 7) || ord[a.style] - ord[b.style] || kord[a.it.kind] - kord[b.it.kind] || String(a.it.no).localeCompare(String(b.it.no), undefined, { numeric: true })));
  return out;
}
// One person's own clock times on a chip: Simpro's times for them on a booked day, else the chip's window.
const winsOf = (c, n) => (c.win && c.win[n] && c.win[n].length) ? c.win[n] : [[c.from, c.to]];
// Each person's busy times per day, from every block: { name: { iso: [{ from, to, booked, soft, key, base, label }] } }.
// soft = an auto forecast (a guess; it never blocks a hand pick).
function busyOf(chips, board) {
  const out = {};
  Object.entries(chips).forEach(([iso, l]) => l.forEach(c => {
    if (c.from == null || c.to == null) return;
    (c.names || []).forEach(n => { const u = board.find(n), k = u ? u.name : n; winsOf(c, n).forEach(([wf, wt]) => ((out[k] = out[k] || {})[iso] = out[k][iso] || []).push({ from: wf, to: wt, booked: c.style === "booked", soft: c.style === "auto" || c.style === "held" || c.style === "duet", key: c.it.key, base: c.it.copyOf || c.it.key, label: `${c.it.no ? "#" + c.it.no : c.it.name} ${c.time || "all day"}` })); });
  }));
  return out;
}
// A day's crew count: everyone on a crew who isn't off (all), how many are on something (on), who is on nothing (open),
// who is off (out), and (v665, Koy: "everyone needs to be scheduled 10 hours a day") who is on something but under 10
// hours, with their hours (short; Simpro, plans and forecasts, overlaps counted once; not on Fridays).
function dayCounts(iso, chips, busy, board, V, crewF) {
  const only = crewF && crewF !== "All" ? crewF : "";
  const on = new Set(); (chips[iso] || []).forEach(c => (c.names || []).forEach(n => { const u = board.find(n); on.add(u ? u.name : n); }));
  const off = new Set((V.offByDay && V.offByDay[iso]) || []);
  let all = 0, n = 0; const open = [], out = [], short = [];
  const hrsOf = (p) => { const iv = (((busy[p] || {})[iso]) || []).map(b => [b.from, b.to]).sort((a, b) => a[0] - b[0]); let t = 0, end = -1;
    iv.forEach(([a, z]) => { if (z <= end) return; t += z - Math.max(a, end); end = z; }); return Math.round(t * 4) / 4; };
  Object.values(board.crews).sort((a, b) => a.foreman.localeCompare(b.foreman)).forEach(c => { if (only && firstOf(c.foreman) !== only) return;
    c.people.forEach(p => { if (off.has(p)) { out.push(p); return; } all++; if (on.has(p)) { n++; const h = hrsOf(p); if (!isFri(iso) && h > 0 && h < HPD - 1e-6) short.push({ n: p, h }); } else open.push(p); }); });
  return { on: n, all, open, out, short };
}
// v663 (Koy 2026-11-19: "why is vista meadows even showing ... can there be a small reason why its there?"): one line on why a block is on the calendar.
function whyOf(it) {
  if (it.kind === "rough" || it.kind === "finish") { const ph = it.kind === "rough" ? "Rough-in" : "Finish", st = it.start || {};
    const a = st.started ? `${ph} is marked In Progress on the job${it.stage ? ` (${Math.round(it.stage)}%)` : ""}, so it stays until it's marked Complete` : st.conf && st.iso ? `${ph} has a confirmed start ${md(st.iso)}` : st.iso ? `${ph} has an estimated start ${md(st.iso)}` : it.booked.length ? "Booked in Simpro" : "";
    const h = it.left > 0 && it.est != null ? `${Math.round(it.left)} h left of the ${Math.round(it.est)} h bid` : it.over ? "past its bid hours" : "";
    // v671: where the material stands, so a start with nothing ordered stands out
    const m = it.po === "ordered" ? "material ordered" : it.po === "notOrdered" ? "material card not ordered yet" : it.po === "none" ? "no material card" : "";
    return [a, h, m].filter(Boolean).join(" · "); }
  if (it.kind === "trip") return it.done ? "Done; kept so its Simpro booking shows" : [it.booked.length ? "Booked in Simpro" : "Open return trip on the job", it.who ? `assigned to ${firstOf(it.who)}` : "nobody assigned on the trip", it.material ? "material on the trip" : "no material on the trip"].join(" · ");
  return "";
}
// The calendar as plain data for a date range (v668, the read door for Duet): per workday the blocks, the open people,
// the people under 10 hours and who is off; the Needs you list; and one line per job on why it is there. Built from the
// same chipsOf / busyOf / dayCounts the screen uses, so it says what the screen says. No money, no contact details.
const KIND_WORDS = { booked: "simpro", kept: "plan", duet: "duet-proposal", auto: "forecast", held: "forecast-held", open: "nobody-on-it", cc: "command-center-date" };
function viewOf(V, users, opts) {
  const o = opts || {}, board = crewBoard(users || []), chips = chipsOf(V, board), busy = busyOf(chips, board);
  const from = o.from && o.from > V.today ? o.from : V.today, to = o.to && o.to < V.end ? o.to : V.end;
  const days = [], seen = new Set();
  for (let d = from, g = 0; d <= to && g < 200; d = addDays(d, 1), g++) {
    if (dowOf(d) > 4) continue;   // Monday to Friday
    const k = dayCounts(d, chips, busy, board, V, "All");
    days.push({ date: d, friday: isFri(d), crewNotOff: k.all, onSomething: k.on, open: k.open, under10h: k.short.map(x => ({ name: x.n, hours: x.h })), off: k.out,
      blocks: (chips[d] || []).map(c => { seen.add(c.it.key); const f = fcOf(c.it);
        return { kind: KIND_WORDS[c.style] || c.style, key: c.it.key, jobNo: String(c.it.no || ""), job: String(c.it.name || ""), what: String(c.it.tag || ""), people: c.names || [],
          ...(c.time ? { time: c.time } : {}), ...(c.from != null && c.to != null ? { from: hhmmOf(c.from), to: hhmmOf(c.to) } : {}), ...(c.hrs ? { crewHours: c.hrs } : {}),
          ...(c.team ? { team: c.team } : {}), ...(c.style === "held" && f && f.held ? { heldBecause: f.held } : {}), ...(c.style === "duet" && f ? { reason: f.why || "", proposalId: f.id || "" } : {}), ...(c.style === "kept" && c.it.plan && c.it.plan.by ? { placedBy: c.it.plan.by } : {}),
          ...(c.offLeft && c.offLeft.length ? { leftOffBecauseOff: c.offLeft } : {}), ...(c.simLeft && c.simLeft.length ? { leftOffBecauseInSimpro: c.simLeft } : {}) }; }) });
  }
  const line = (it) => ({ key: it.key, jobNo: String(it.no || ""), job: String(it.name || ""), what: String(it.tag || ""), ...(whyOf(it) ? { why: whyOf(it) } : {}),
    ...(it.left != null ? { hoursLeft: it.left } : {}), ...(it.est != null ? { bidHours: it.est, usedHours: it.used } : {}),
    ...(it.start && it.start.iso ? { start: it.start.iso, startIs: it.start.started ? "in progress" : it.start.conf ? "confirmed" : it.start.by ? "schedule by" : "estimated" } : it.start && it.start.started ? { startIs: "in progress" } : {}),
    ...(it.foreman ? { foreman: it.foreman } : {}), ...((it.flags || []).length ? { flags: it.flags } : {}) });
  const byKey = {}; V.items.forEach(it => { byKey[it.key] = it; });
  return { today: V.today, from, to, days,
    needsYou: (V.needs || []).filter(n => byKey[n.key]).map(n => ({ ...line(byKey[n.key]), reason: n.why, placed: !!n.held })),
    onCalendar: V.items.filter(it => seen.has(it.key)).map(line),
    notOnCalendar: (V.list || []).slice(0, 300).map(it => ({ key: it.key, jobNo: String(it.no || ""), job: String(it.name || ""), what: String(it.tag || ""), ...(it.off ? { removed: true, ...(it.off.why ? { waitingOn: it.off.why } : {}) } : {}), ...((it.flags || []).length ? { flags: it.flags } : {}) })) };
}

// ── What a block was, in a few words of data (v673, the learning loop) ───────
// One row per day: the day, who, and the clock time. Used to record what Duet suggested next to what a person ended up
// with, and what a block was before and after a hand edit. Small on purpose (14 days, names only).
function planSummary(plan) {
  if (!plan) return null;
  if (plan.off) return { off: true, ...(plan.why ? { why: String(plan.why).slice(0, 60) } : {}) };
  const names = (plan.staff || []).map(x => x && x.name).filter(Boolean);
  return slotsOf(plan).slice(0, 14).map(d => ({ d: d.date, n: (d.staff ? d.staff.map(x => x && x.name).filter(Boolean) : names).slice(0, 12), t: d.start, e: hhmmOf(d.to), ...(d.none ? { none: true } : {}) }));
}
// What changed between two summaries, in words, so a reader (Duet, or a person) sees the point at once.
function planDiff(was, now) {
  const A = Array.isArray(was) ? was : [], B = Array.isArray(now) ? now : [], out = [];
  if (now && now.off) return ["taken off the calendar" + (now.why ? ` (${now.why})` : "")];
  if (now && now.backToAuto) return ["handed back to the auto-schedule"];
  const da = A.map(x => x.d), db = B.map(x => x.d);
  if (da.join() !== db.join()) out.push(`days ${da.length ? da.join(", ") : "none"} → ${db.length ? db.join(", ") : "none"}`);
  const ppl = (l) => [...new Set(l.flatMap(x => x.n || []))].sort(), pa = ppl(A), pb = ppl(B);
  const gone = pa.filter(n => !pb.includes(n)), came = pb.filter(n => !pa.includes(n));
  if (gone.length) out.push(`took off ${gone.map(firstOf).join(", ")}`);
  if (came.length) out.push(`put on ${came.map(firstOf).join(", ")}`);
  const ta = A[0] ? `${A[0].t}-${A[0].e}` : "", tb = B[0] ? `${B[0].t}-${B[0].e}` : "";
  if (ta && tb && ta !== tb) out.push(`time ${ta} → ${tb}`);
  return out.length ? out : ["no change to who, when or how long"];
}

module.exports = { planSummary, planDiff, chipsOf, winsOf, busyOf, dayCounts, whyOf, viewOf, fcOf, isFri, startOf, HPD, ymd, parseYmd, anyDate, anyIso, addDays, dowOf, isHoliday, isWork, nextWork, workAfter, mondayOf, viewDays, span, workdaysBetween, planDays,
  DAY0, winOf, pdOf, hhmmOf, md, short, safeKey, firstOf, bookingsByNo, poState, tripIso, upNo, upName, crewBoard, autoPlan, buildCalendar, slotsOf, clock, hoursOf, tripHours, TRIP_DEFAULT_H, setHolidays, holidayName, DEFAULT_HOLIDAYS, GROUPS, groupOf, groupBy };
