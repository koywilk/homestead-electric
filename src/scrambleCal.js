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
const isWork = (iso) => dowOf(iso) <= 3;                          // Mon–Thu
function nextWork(iso) { let d = iso; for (let i = 0; i < 7 && !isWork(d); i++) d = addDays(d, 1); return d; }
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
  act.forEach(u => { if (boardTitle(u) === "foreman") crews[u.id] = { id: u.id, foreman: u.name, people: [u.name] }; });
  act.forEach(u => { const t = boardTitle(u); if (t !== "foreman" && t !== "admin" && u.foremanId && crews[u.foremanId]) crews[u.foremanId].people.push(u.name); });
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
    const who = names.length ? names : it.plan ? crewNames(it) : [...new Set(it.booked.flatMap(b => b.names || []))];
    planDays(f).forEach(d => { if (d.date <= end) who.forEach(n => mark(n, d.date)); });
  });
  const first = workAfter(todayIso);
  const fit = (names, from, nDays, last) => {
    for (let s = nextWork(from), g = 0; s <= last && g < 60; s = workAfter(s), g++) {
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

  const isCand = (it) => !it.plan && !it.auto && !it.upcoming && it.kind !== "service";
  const sIso = (it) => (it.start && it.start.iso) || "";
  const trips = items.filter(it => isCand(it) && it.kind === "trip" && !it.booked.length);
  const phases = items.filter(it => isCand(it) && (it.kind === "rough" || it.kind === "finish") && !it.bookedAhead && !it.hold
    && it.start && (it.start.started || (sIso(it) && sIso(it) <= end)));
  const ord = (a, b) => (a.start.started ? 0 : 1) - (b.start.started ? 0 : 1) || (sIso(a) < sIso(b) ? -1 : sIso(a) > sIso(b) ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  const fixed = trips.filter(t => t.start && !t.start.by), byTrips = trips.filter(t => !t.start || t.start.by);

  const doTrip = (it) => {
    const s = it.start;
    if (!s) return need(it, it.who ? "No date set in Command Center" : "No date or crew set in Command Center");
    if (!it.who) return need(it, "No crew assigned in Command Center");
    const u = board.find(it.who);
    if (!u) return need(it, `${it.who} isn't on the Crew Board`);
    if (!board.crewOfUser(u)) return need(it, `${firstOf(u.name)} is unassigned on the Crew Board`);
    if (!s.by && s.iso < todayIso) return need(it, `Was set for ${md(s.iso)}, not done. Pick a new date`);
    if (!s.by && !isWork(s.iso)) return need(it, `Set for ${short(s.iso)}. Fridays are volunteer only`);
    const held = it.material ? "" : "No material listed on the trip";
    const hours = it.defHours || HPD;
    if (s.by) {
      const at = fit([u.name], first, 1, s.iso < end ? s.iso : end);
      return at ? place(it, [u.name], at, hours, held, firstOf(u.name)) : need(it, `${firstOf(u.name)} has no open day before ${md(s.iso)}`);
    }
    if (s.iso > end) return;
    if (!free([u.name], s.iso)) return need(it, `${firstOf(u.name)} is already booked ${short(s.iso)}`);
    place(it, [u.name], s.iso, hours, held, firstOf(u.name));
  };
  const doPhase = (it) => {
    if (it.over) return need(it, "Over bid. Set the hours by hand");
    if (it.left == null) return need(it, "No hours in Job Costs. Set the hours by hand");
    if (!(it.left > 0)) return;
    const c = board.crewOf(it.foreman) || board.crewOf(it.jlead);
    if (!c) return need(it, it.foreman ? `${it.foreman} has no crew on the Crew Board` : "No foreman set on the job");
    const names = c.people, n = names.length;
    const from = it.start.started || !sIso(it) || sIso(it) < first ? first : nextWork(sIso(it));
    const at = fit(names, from, Math.max(1, Math.ceil(it.left / (n * HPD) - 1e-9)), end);
    if (!at) return need(it, `${label(c)} is booked through ${md(end)}`);
    const held = it.start.started ? "" : it.po === "none" ? `${it.tag} starts with no material PO` : it.po === "notOrdered" ? `${it.tag} material card not ordered yet` : "";
    place(it, names, at, it.left, held, label(c));
  };
  fixed.forEach(doTrip);
  phases.filter(x => x.kind === "rough").sort(ord).forEach(doPhase);   // rough-in first
  phases.filter(x => x.kind === "finish").sort(ord).forEach(doPhase);
  byTrips.forEach(doTrip);
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
        who: String(t.assignedTo || "").trim(), material: plain(t.material).slice(0, 140), foreman: String(j.foreman || "").trim(), scope: plain(t.scope || t.task).slice(0, 140), defCrew: 1, defHours: HPD,
        start: iso ? { iso, conf: t.rtStatus === "scheduled", by: t.rtStatus === "needs" } : null });
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
    if (p && p.s && Number(p.hours) > 0) it.plan = { s: nextWork(p.s), hours: Number(p.hours), crew: Math.max(1, Number(p.crew) || 1), staff: Array.isArray(p.staff) ? p.staff : [], by: p.by || "", at: p.at || "" };
    if (!it.plan && it.bookedAhead && it.left > 0 && it.kind !== "trip") {
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
    it.inList = !it.plan && !it.bookedAhead && (it.kind === "trip" || it.upcoming || it.left == null || it.left > 0 || it.over || it.flags.length > 0)
      && !(it.kind === "service");
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

module.exports = { HPD, ymd, parseYmd, anyDate, anyIso, addDays, dowOf, isWork, nextWork, workAfter, mondayOf, viewDays, span, workdaysBetween, planDays,
  md, short, safeKey, firstOf, bookingsByNo, poState, tripIso, upNo, upName, crewBoard, autoPlan, buildCalendar };
