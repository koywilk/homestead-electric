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
const isHoliday = (iso) => { const y = +String(iso).slice(0, 4); if (!HOL[y]) HOL[y] = holidaysOf(y); return HOL[y].has(iso); };
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
  for (let g = 0; left > 1e-6 && g < 120; g++) { const h = Math.min(HPD, left); out.push({ date: d, hours: Math.round(h * 4) / 4 }); left -= h; d = workAfter(d); }
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
  return { crews, find, crewOf: (name) => crewOfUser(find(name)), crewOfUser };
}

// Lays forecast blocks for what isn't booked: rough-in first, then finish, at 10 h days Mon–Thu, never over a
// Simpro booking, a kept plan or another auto block for the same person. Kept plans (placed or moved by hand) are
// never touched. Anything it shouldn't decide alone goes to Needs you: a held block (placed, hatched, not booked
// until someone keeps it) or no block with the reason. Returns the Needs you list.
function autoPlan(items, { board, schedules, plans, todayIso, end }) {
  const busy = {};                                   // person (lower case) → Set of iso
  const mark = (name, iso) => { const k = lc(name); (busy[k] = busy[k] || new Set()).add(iso); };
  const free = (names, iso) => names.every(n => !(busy[lc(n)] && busy[lc(n)].has(iso)));
  const perDay = {};
  (schedules || []).forEach(s => { if (!s || !s.Date || !s.Staff || !s.Staff.Name) return;
    const k = s.Staff.Name + "|" + String(s.Date).slice(0, 10);
    perDay[k] = (perDay[k] || 0) + ((s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0); });
  Object.keys(perDay).forEach(k => { if (perDay[k] >= 2) { const [n, iso] = k.split("|"); mark(n, iso); } });
  const crewNames = (it) => { const c = board.crewOf(it.foreman) || board.crewOf(it.jlead); return c ? c.people : []; };
  // what is already planned holds its people
  items.forEach(it => {
    const f = it.plan || it.auto; if (!f) return;
    const names = (f.staff || []).map(x => x && x.name).filter(Boolean);
    const lastDay = it.booked.length ? it.booked[it.booked.length - 1] : null;   // a Simpro tail runs on with the last booked day's people
    const who = names.length ? names : it.plan ? crewNames(it) : ((lastDay && lastDay.names) || []);
    planDays(f).forEach(d => { if (d.date <= end) who.forEach(n => mark(n, d.date)); });
  });
  const first = workAfter(todayIso);
  const fit = (names, from, nDays, last) => {
    for (let s = nextWork(from), g = 0; s <= last && g < 120; s = workAfter(s), g++) {
      let d = s, ok = true;
      for (let i = 0; i < nDays && d <= end; i++, d = workAfter(d)) if (!free(names, d)) { ok = false; break; }
      if (ok) return s;
    }
    return "";
  };
  const take = (names, s, hours, crew) => planDays({ s, hours, crew }).forEach(d => { if (d.date <= end) names.forEach(n => mark(n, d.date)); });
  const needs = [];
  const need = (it, why) => { it.need = why; it.inList = false; needs.push({ key: it.key, why, held: false }); };
  const place = (it, names, s, hours, held, label) => {
    it.auto = { s, hours, crew: names.length, staff: names.map(name => ({ name })), team: label, src: "auto", held: held || "" };
    take(names, s, hours, names.length);
    it.onCal = true; it.inList = false;
    if (held) needs.push({ key: it.key, why: held, held: true });
  };
  const label = (c) => c ? firstOf(c.foreman) + "'s crew" : "";

  const isCand = (it) => !it.plan && !it.auto && !it.off && !it.upcoming && it.kind !== "service";
  const sIso = (it) => (it.start && it.start.iso) || "";
  const trips = items.filter(it => isCand(it) && it.kind === "trip" && !it.booked.length);
  const phases = items.filter(it => isCand(it) && (it.kind === "rough" || it.kind === "finish") && !it.bookedAhead && !it.hold
    && it.start && (it.start.started || (sIso(it) && sIso(it) <= end)));
  const ord = (a, b) => (a.start.started ? 0 : 1) - (b.start.started ? 0 : 1) || (sIso(a) < sIso(b) ? -1 : sIso(a) > sIso(b) ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  const fixed = trips.filter(t => t.start && !t.start.by), byTrips = trips.filter(t => !t.start || t.start.by);

  // Return trips: on their date, in a pair. Koy 2026-11-19: "They don't get sent by themselves anywhere: sometimes leads,
  // sometimes junior foreman, sometimes foreman, but for the most part we travel in at least pairs of two." So a trip is
  // its person (or, with none set, someone who can lead it from the job's foreman's crew: the job's own foreman / lead
  // first, then a lead, jr foreman, the foreman) plus one more from that crew, crew members first. A lead, jr foreman or
  // foreman may go alone only when no second person is free, held; a crew member never goes alone. One with no date or a
  // schedule-by date goes on the first open day (before that date) a pair is free.
  const doTrip = (it) => {
    const s = it.start; let c, lead0 = [], noCrew = false;
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
    const mates = (first) => c.people.filter(p => p !== first).sort((x, y) => (tt[x] === "crew" ? 0 : tt[x] === "lead" ? 1 : 2) - (tt[y] === "crew" ? 0 : tt[y] === "lead" ? 1 : 2));
    // who goes on day d: a pair if there is one; else a lone leader (held); else nobody
    const crewFor = (d) => {
      for (const l of leaders) { if (!free([l], d)) continue; const m = mates(l).find(p => free([p], d)); if (m) return { names: [l, m] }; }
      if (!lead0.length) { const two = c.people.filter(p => free([p], d)); if (two.length >= 2) return { names: two.slice(0, 2) }; }
      const solo = leaders.find(l => free([l], d) && canLead(l));
      return solo ? { names: [solo], solo: true } : null;
    };
    if (s && !s.by && s.iso < todayIso) return need(it, `Was set for ${md(s.iso)}, not done. Pick a new date`);
    if (s && !s.by && !isWork(s.iso)) return need(it, `Set for ${short(s.iso)}, ${isHoliday(s.iso) ? "a holiday" : "Fridays are volunteer only"}`);
    const notes = [];
    if (!s && noCrew) notes.push("No date or crew set in Command Center, so it's on the first open day");
    else if (!s) notes.push("No date set in Command Center, so it's on the first open day");
    else if (noCrew) notes.push("No crew set in Command Center");
    if (!it.material) notes.push("No material listed on the trip");
    const hours = it.defHours || HPD;
    const go = (d, r, pre) => {
      const why = [...(pre ? [pre] : []), ...(r.solo ? [`Only ${firstOf(r.names[0])} free that day, no second person`] : []), ...notes].join(". ");
      return place(it, r.names, d, hours * r.names.length, why, firstOf(r.names[0]) + (r.names[1] ? " + " + firstOf(r.names[1]) : ""));
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
        const avail = pool.filter(p => days.every(d => free([p], d)));
        const heads = avail.filter(p => isHead(p) || p === runner).sort((x, y) => headRank(x) - headRank(y));
        if (!heads.length && pool.some(isHead)) continue;
        const head = heads[0] || avail[0]; if (!head) continue;
        // another of this crew's jobs (not placed yet) that wants these days keeps its head plus one
        const other = phases.some(o => o !== it && !doneKeys.has(o.key) && crewKey(o) === c.id && fromOf(o) <= days[days.length - 1]);
        const spareHead = other && avail.length >= 4 ? heads.find(p => p !== head) : "";   // a split needs 2 on each side
        const cap = other && spareHead ? Math.max(2, Math.min(cnt, avail.length - 2)) : cnt;
        const team = [head, ...avail.filter(p => p !== head && !isHead(p) && p !== runner).sort((x, y) => rest(x) - rest(y)),
          ...avail.filter(p => p !== head && p !== spareHead && (isHead(p) || p === runner))].slice(0, Math.min(cnt, cap));
        if (team.length >= cnt || (team.length >= Math.min(2, want) && team.length === Math.min(cnt, cap))) {
          // the head count may have dropped: lay the hours out again for the team it got
          const nd2 = Math.max(1, Math.ceil(it.left / (team.length * HPD) - 1e-9));
          let ok = true; for (let d = s, i = 0; i < nd2 && d <= end; i++, d = workAfter(d)) if (!free(team, d)) { ok = false; break; }
          if (ok) { at = s; names = team; split = !!(other && spareHead); }
        }
      }
    }
    if (!at) return need(it, `${label(c)} is booked through ${md(end)}`);
    // the foreman's own job keeps the bigger group when the crew splits; the short one is flagged
    const short = names.length < want && !(split && tt[names[0]] === "foreman") ? `Only ${names.length} of ${label(c)} free (want ${want})` : "";
    const po = it.start.started ? "" : it.po === "none" ? `${it.tag} starts with no material PO` : it.po === "notOrdered" ? `${it.tag} material card not ordered yet` : "";
    place(it, names, at, it.left, [po, short].filter(Boolean).join(". "), label(c));
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
  const { jobs = [], upcoming = [], schedules = [], phaseHours = {}, upHours = {}, plans = {}, today = new Date(), weeks = 5, effRS, effFS, users = null } = input || {};
  const todayIso = ymd(today), start = mondayOf(today);
  const days = viewDays(start, weeks), end = days[days.length - 1].iso;
  const book = bookingsByNo(schedules);
  const items = [], byNoJob = {};
  const usedDays = {};                       // no → Set of iso already given to a trip
  const mk = (o) => {
    const it = Object.assign({ booked: [], flags: [], start: null, hold: false, est: null, used: null, left: null, over: false, po: null, plan: null, auto: null, defCrew: 2 }, o);
    items.push(it); return it;
  };

  jobs.forEach(j => {
    if (!j || j.archived || j.tempPed) return;
    const no = String(j.simproNo || "").trim();
    if (no) byNoJob[no] = j;
    const jb = (no && book[no]) || {};
    // Return trips: their own items. A scheduled trip takes the Simpro booking on its date.
    (j.returnTrips || []).forEach((t, i) => {
      if (!tripOpen(t)) return;
      const iso = tripIso(t), n = Number(t.number) || i + 1;
      const it = mk({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), kind: "trip", tag: "Return trip #" + n, tripNo: n, no, name: j.name || "", jobId: j.id,
        who: String(t.assignedTo || "").trim(), material: plain(t.material).slice(0, 140), foreman: String(j.foreman || "").trim(), jlead: String(j.lead || "").trim(), scope: plain(t.scope || t.task).slice(0, 140), defCrew: 2, defHours: HPD,
        start: iso ? { iso, conf: t.rtStatus === "scheduled", by: t.rtStatus === "needs" } : null,
        cause: t.fromFailedFinal || t.scope === "Failed final inspection items" ? "final" : t.fromFailedRough ? "roughfail" : t.fromCOId ? "co"
          : (t.fromQCFail || /^QC (Fail|Items)/.test(String(t.scope || ""))) ? "qc" : /warrant/i.test(String(t.scope || "") + " " + String(t.task || "")) ? "warranty" : "" });
      if (iso && t.rtStatus === "scheduled" && jb[iso]) { it.booked.push({ iso, ...jb[iso] }); (usedDays[no] = usedDays[no] || new Set()).add(iso); }
    });
    if (j.quickJob) return;
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
    if (p && p.off) it.off = { by: p.by || "", at: p.at || "" };
    else if (p && p.s && Number(p.hours) > 0) it.plan = { s: nextWork(p.s), hours: Number(p.hours), crew: Math.max(1, Number(p.crew) || 1), staff: Array.isArray(p.staff) ? p.staff : [], by: p.by || "", at: p.at || "" };
    if (!it.plan && !it.off && it.bookedAhead && it.left > 0 && it.kind !== "trip") {
      it.auto = { s: workAfter(it.booked[it.booked.length - 1].iso), hours: it.left, crew: Math.max(1, it.crewBooked) };
    }
    const bookedFrom = (iso) => it.booked.some(b => b.iso >= iso);
    if (it.kind === "trip") {
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
    it.inList = !it.plan && !it.copyOf && (it.off ? !it.bookedAhead : !it.bookedAhead && (it.kind === "trip" || it.upcoming || it.left == null || it.left > 0 || it.over || it.flags.length > 0)
      && !(it.kind === "service"));
    delete it._ph;
  });

  // v656: the auto-schedule (Josh's rules) when the Crew Board is given.
  const needs = users ? autoPlan(items, { board: crewBoard(users), schedules, plans, todayIso, end }) : [];

  const rank = (it) => it.flags.length ? 0 : it.kind === "trip" ? 1 : it.upcoming ? 5 : it.over ? 4 : it.kind === "rough" ? 2 : 3;
  const sIso = (it) => (it.start && it.start.iso) || "9999";
  const list = items.filter(it => it.inList).sort((a, b) => rank(a) - rank(b) || (sIso(a) < sIso(b) ? -1 : sIso(a) > sIso(b) ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const firstIso = (it) => it.booked.length ? it.booked[0].iso : it.plan ? it.plan.s : "9999";
  const cal = items.filter(it => it.onCal).sort((a, b) => (a.booked.length ? 0 : 1) - (b.booked.length ? 0 : 1) || (firstIso(a) < firstIso(b) ? -1 : 1));
  return { start, end, today: todayIso, days, items, cal, list, needs,
    counts: { flagged: list.filter(x => x.flags.length).length + cal.filter(x => x.flags.length).length, list: list.length, cal: cal.length, needs: needs.length } };
}

// Koy 2026-11-19: "if that could be separated into what they are (rough ends, finishes, return trips, failed
// finals, etc.)". Every list item gets one of these; lists show them in this order, each with a count, empty ones hidden.
const GROUPS = [["rough", "Rough-ins"], ["finish", "Finishes"], ["final", "Failed finals"], ["roughfail", "Failed rough inspections"],
  ["co", "Change orders"], ["qc", "QC walk fixes"], ["warranty", "Warranty"], ["trip", "Return trips"], ["other", "Other"]];
const groupOf = (it) => !it ? "other" : it.kind === "trip" ? (it.cause || "trip") : it.kind === "rough" || it.kind === "finish" ? it.kind : "other";
function groupBy(list, itemOf) {
  const by = {}; (list || []).forEach(x => { const g = groupOf(itemOf ? itemOf(x) : x); (by[g] = by[g] || []).push(x); });
  return GROUPS.map(([k, label]) => ({ k, label, items: by[k] || [] })).filter(g => g.items.length);
}
module.exports = { HPD, ymd, parseYmd, anyDate, anyIso, addDays, dowOf, isHoliday, isWork, nextWork, workAfter, mondayOf, viewDays, span, workdaysBetween, planDays,
  md, short, safeKey, firstOf, bookingsByNo, poState, tripIso, upNo, upName, crewBoard, autoPlan, buildCalendar, GROUPS, groupOf, groupBy };
