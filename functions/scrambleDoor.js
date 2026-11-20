// scrambleDoor.js — the booking door for Duet (functions only, after SW v668; Koy 2026-11-20; Build 1 of Duet's crew-calendar spec).
//
// Duet books people onto a job or a return trip through the same rules as the calendar's "Book in Simpro" button
// (scrambleBook.js: the 40-hour line, the overlap check, the cost center, the preview hash), plus the people rules the
// calendar screen used to check only in the browser. Here they are checked on the server, so nothing Duet sends can
// skip them:
//   - only someone on a Crew Board crew (never Unassigned, never an admin), known to Simpro by name
//   - never on a day they have approved time off, a company holiday, or a weekend
//   - a set pair goes together (unless the pair is off or already booked then, or Koy said to split them)
//   - nobody alone: a crew member never; a lead, jr foreman or foreman only when Koy said so
//   - nothing that overlaps what Simpro already has for that person (job, activity or time off)
//   - hours past 40 in a person's Monday-to-Sunday week at 1.5x (jobs only count toward the 40)
// Pure rules here; the Simpro and Firestore calls are in run() with everything passed in, so the whole thing is
// tested start to finish with stand-ins (scripts/scramble-door-test.js).
// Never sets or changes a job's stage or status. The one job write is a return trip's own schedule fields, through
// scrambleTrip.js, after the booking is in Simpro.
"use strict";
const SC = require("./scrambleCal.js");
const SB = require("./scrambleBook.js");
const ST = require("./scrambleTrip.js");

const MAX_ROWS = 80;
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const toMin = (v) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clockOf = (hhmm) => { const m = toMin(hhmm); return m == null ? String(hhmm) : SC.clock(m / 60); };
const overlap = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// The request, checked before anything is read. Returns an error string or "".
function checkRequest(a, today) {
  const d = a || {};
  if (!["preview", "book"].includes(d.mode)) return "mode must be preview or book";
  if (!/^\d{1,6}$/.test(String(d.jobNo || ""))) return "A Simpro job number is needed (a quote can't be booked until it's a job).";
  if (!["rough", "finish", "trip"].includes(d.phase)) return "phase must be rough, finish or trip";
  if (d.phase === "trip" && (!/^[A-Za-z0-9_-]{1,80}$/.test(String(d.jobId || "")) || !/^[A-Za-z0-9_.-]{1,80}$/.test(String(d.tripId || "")))) return "A return trip needs the job's Command Center id and the trip's id.";
  if (d.costCenter != null && !(d.costCenter && Number.isInteger(Number(d.costCenter.sectionId)) && Number(d.costCenter.sectionId) > 0 && Number.isInteger(Number(d.costCenter.id)) && Number(d.costCenter.id) > 0)) return "costCenter needs a sectionId and an id from the job's Simpro sections.";
  const rows = Array.isArray(d.entries) ? d.entries : [];
  if (!rows.length) return "Nothing to book: give at least one person, day and time.";
  if (rows.length > MAX_ROWS) return `That's more than ${MAX_ROWS} entries; book it in smaller pieces.`;
  const last = SB.addDays(today, 120), seen = new Set();
  for (const r of rows) {
    if (!r || !String(r.person || "").trim() || String(r.person).length > 80) return "Each entry needs a person.";
    if (!isIso(r.date)) return `Each entry needs a date (YYYY-MM-DD); got ${String(r && r.date).slice(0, 20)}.`;
    if (r.date < today) return `${r.date} is in the past; bookings from here start today.`;
    if (r.date > last) return `${r.date} is more than 120 days out.`;
    const s = toMin(r.start), e = toMin(r.end);
    if (s == null || e == null) return `Times on ${r.date} must be like 07:00.`;
    if (s % 15 || e % 15) return `Times on ${r.date} must be on the quarter hour.`;
    if (s < 5 * 60 || e > 19 * 60) return `Times on ${r.date} must be between 5:00 AM and 7:00 PM.`;
    if (e - s < 15 || e - s > 12 * 60) return `${r.person} on ${r.date}: the time must be between 15 minutes and 12 hours.`;
    const k = lc(r.person) + "|" + r.date; if (seen.has(k)) return `${r.person} is in the list twice on ${r.date}. One entry per person per day.`; seen.add(k);
  }
  if (d.mode === "book" && !/^[0-9a-z]+\.[0-9a-z]+$/.test(String(d.hash || ""))) return "Confirm from a preview: send the preview's hash.";
  return "";
}

// Who each entry is: the Crew Board person (must be on a crew) and their Simpro employee. Returns the resolved rows
// and a refusal for anyone it can't place. staffAll: [{ id, name }] (active Simpro employees).
function resolvePeople(entries, board, staffAll) {
  const rows = [], refusals = [], seen = new Set();
  (entries || []).forEach(r => {
    const u = board.find(r.person);
    if (!u) { refusals.push({ person: String(r.person), date: r.date, rule: "crew-board", why: `${r.person} isn't on the Crew Board (or the name could mean more than one person).` }); return; }
    const crew = board.crewOfUser(u);
    if (!crew) { refusals.push({ person: u.name, date: r.date, rule: "crew-board", why: `${first(u.name)} isn't on a Crew Board crew (unassigned or office), so can't be scheduled.` }); return; }
    const exact = (staffAll || []).filter(s => lc(s.name) === lc(u.name));
    const loose = exact.length ? exact : (staffAll || []).filter(s => { const x = board.find(s.name); return x && x.id === u.id; });
    if (loose.length !== 1) { refusals.push({ person: u.name, date: r.date, rule: "simpro-name", why: loose.length ? `More than one active Simpro employee could be ${u.name}.` : `Simpro has no active employee named ${u.name}.` }); return; }
    const k = u.name + "|" + r.date;
    if (seen.has(k)) { refusals.push({ person: u.name, date: r.date, rule: "twice", why: `${first(u.name)} is in the list twice on ${r.date}.` }); return; }
    seen.add(k);
    rows.push({ person: u.name, staffId: Number(loose[0].id), simproName: String(loose[0].name), title: (crew.title && crew.title[u.name]) || "crew", date: r.date, start: r.start, end: r.end,
      from: toMin(r.start), to: toMin(r.end), hours: Math.round((toMin(r.end) - toMin(r.start)) / 15) / 4 });
  });
  return { rows, refusals };
}

// Who is off which day (settings/crewPTO.list: [{ name, start, end }]), read the way the calendar reads it.
function offDays(pto, board) {
  const out = {};
  (pto || []).forEach(p => { const a = p && SC.anyIso(p.start); if (!a || !p.name) return; const b = SC.anyIso(p.end) || a, lo = a <= b ? a : b, hi = a <= b ? b : a;
    const who = (board.find(p.name) || { name: String(p.name).trim() }).name;
    for (let d = lo, g = 0; d <= hi && g < 400; d = SB.addDays(d, 1), g++) (out[d] = out[d] || new Set()).add(who); });
  return (name, iso) => !!(out[iso] && out[iso].has(name));
}
function holidayMap(list) { const m = {}; (Array.isArray(list) ? list : SC.DEFAULT_HOLIDAYS).forEach(h => { const d = h && SC.anyIso(h.date); if (d) m[d] = String(h.name || "Holiday"); }); return m; }

// A person's Simpro time on a day: [[fromMin, toMin, ref, type]] from the schedule rows (any job, activity or leave).
function simproDay(schedules, staffId, date) {
  const out = [];
  (schedules || []).forEach(s => { if (Number(s && s.Staff && s.Staff.ID) !== Number(staffId) || String(s.Date || "").slice(0, 10) !== date) return;
    (s.Blocks || []).forEach(b => { const a = toMin(String(b.StartTime || "").slice(0, 5)), z = toMin(String(b.EndTime || "").slice(0, 5)); if (a != null && z != null && z > a) out.push([a, z, String(s.Reference || ""), String(s.Type || "")]); }); });
  return out;
}

// The people rules. rows: from resolvePeople. Returns { refusals: [{ person, date, rule, why }], notes: [string] }.
// Overlaps with Simpro are checked on the built entries by SB.overlaps (run()), not here.
function guard({ rows, board, isOff, holidays, schedules, staffAll, jobNo, aloneOk, splitPairs, unplaced }) {
  const refusals = [], notes = [], hol = holidays || {};
  const staffIdOf = (name) => { const s = (staffAll || []).filter(x => { const u = board.find(x.name); return u && u.name === name; }); return s.length === 1 ? Number(s[0].id) : null; };
  const byDate = {}; rows.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  rows.forEach(r => {
    const dow = SC.dowOf(r.date);
    if (dow >= 5) { refusals.push({ person: r.person, date: r.date, rule: "weekend", why: `${r.date} is a ${dow === 5 ? "Saturday" : "Sunday"}. Nothing is booked on a weekend from here.` }); return; }
    if (hol[r.date]) { refusals.push({ person: r.person, date: r.date, rule: "holiday", why: `${r.date} is ${hol[r.date]}, a company holiday.` }); return; }
    if (isOff(r.person, r.date)) { refusals.push({ person: r.person, date: r.date, rule: "time-off", why: `${first(r.person)} has approved time off on ${r.date}.` }); return; }
    // set pair
    const pt = board.partnerOf(r.person), ptCrew = pt && board.crewOf(pt);
    if (pt && ptCrew && !byDate[r.date].some(x => x.person === pt && overlap(x.from, x.to, r.from, r.to))) {
      const sid = staffIdOf(pt), busy = sid ? simproDay(schedules, sid, r.date).filter(b => overlap(b[0], b[1], r.from, r.to)) : [];
      if (isOff(pt, r.date)) notes.push(`${first(r.person)}'s set pair ${first(pt)} is off ${r.date}, so ${first(r.person)} goes without them.`);
      else if (busy.length) notes.push(`${first(r.person)}'s set pair ${first(pt)} is already booked in Simpro then (${busy[0][2] ? "job " + busy[0][2].split("-")[0] : "an activity"}), so ${first(r.person)} goes without them.`);
      else if (splitPairs) notes.push(`${first(r.person)} is booked without their set pair ${first(pt)}, who is free then (Koy said to split them).`);
      else refusals.push({ person: r.person, date: r.date, rule: "pair", why: `${first(r.person)}'s set pair is ${first(pt)}, who is free ${r.date} at that time. Book both, or have Koy say to split them.` });
    }
  });
  // nobody alone: the people in this request that day plus anyone Simpro already has on this job then
  Object.keys(byDate).sort().forEach(date => {
    // Judged on who was asked for that day, refused or not: one refusal shouldn't raise a second, misleading "alone"
    // on the person they were meant to be with. The first refusal is the thing to fix.
    const mine = byDate[date].filter(r => !refusals.some(x => x.person === r.person && x.date === date));
    mine.forEach(r => {
      const withMe = byDate[date].some(x => x !== r && overlap(x.from, x.to, r.from, r.to)) || (unplaced || []).includes(date);
      const already = (schedules || []).some(s => String(s.Type || "") === "job" && String(s.Reference || "").split("-")[0] === String(jobNo) && String(s.Date || "").slice(0, 10) === date
        && Number(s.Staff && s.Staff.ID) !== r.staffId && (s.Blocks || []).some(b => { const a = toMin(String(b.StartTime || "").slice(0, 5)), z = toMin(String(b.EndTime || "").slice(0, 5)); return a != null && z != null && overlap(a, z, r.from, r.to); }));
      if (withMe || already) return;
      if (r.title === "crew") refusals.push({ person: r.person, date, rule: "alone", why: `${first(r.person)} would be alone on the job ${date}. A crew member never goes alone; add someone.` });
      else if (!aloneOk) refusals.push({ person: r.person, date, rule: "alone", why: `${first(r.person)} would be alone on the job ${date}. Add someone, or have Koy say it's OK for them to go alone.` });
      else notes.push(`${first(r.person)} goes alone ${date} (Koy said it's OK).`);
    });
    if (SC.dowOf(date) === 4) notes.push(`${date} is a Friday: overtime day, booked by hand.`);
  });
  return { refusals, notes: [...new Set(notes)] };
}

// The Simpro entries for the resolved rows: each person's own window, normal time until their week reaches 40, then
// 1.5x. existing: SB.weekHours() (job hours already in Simpro per person per week).
function entriesFor(rows, existing) {
  const run = {}, out = [];
  rows.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.from - b.from || a.staffId - b.staffId).forEach(r => {
    const wk = SB.mondayOf(r.date), k = r.staffId + "|" + wk;
    if (run[k] == null) run[k] = Number(((existing || {})[r.staffId] || {})[wk]) || 0;
    const before = run[k], b = SB.blocksFor(r.hours, before, r.start);
    run[k] = before + r.hours;
    out.push({ date: r.date, staffId: r.staffId, name: r.simproName, person: r.person, hours: r.hours, normal: b.normal, ot: b.ot, weekBefore: Math.round(before * 100) / 100, blocks: b.blocks });
  });
  return out;
}

// Which cost center a return trip's work belongs on: Rough In when it came from a failed rough inspection or the
// job's rough-in isn't complete, else Finish (the same rule the calendar uses). A change order's own cost center is
// passed in as costCenter instead (Koy 2026-11-20: CO work books to the CO's own cost center).
function tripCc(trip, job) {
  if (trip.fromFailedRough) return "rough";
  if (trip.fromFailedFinal || trip.scope === "Failed final inspection items") return "finish";
  const rs = job.roughStatus || ((parseInt(job.roughStage, 10) || 0) === 100 ? "complete" : "");
  return ["complete", "invoice"].includes(rs) ? "finish" : "rough";
}

class Refused extends Error { constructor(message, extra) { super(message); this.refused = true; Object.assign(this, extra || {}); } }

// The whole door. deps: { simproReq(method, path, body), staff(): [{ id, name }], getUsers(), db, tripWrite(jobId, no,
// plan, who), today (YYYY-MM-DD in Denver), log? }. args: see checkRequest. Returns the preview, or what was written.
async function run(deps, args) {
  const a = args || {}, bad = checkRequest(a, deps.today);
  if (bad) throw new Refused(bad);
  const no = String(a.jobNo), phase = a.phase, by = String(a.by || "Duet").slice(0, 60);
  // the job in Simpro, and (for a trip) the trip in Command Center
  const jr = await deps.simproReq("GET", `/jobs/${no}?columns=ID,Name,Stage`);
  if (!jr || !jr.ok || !jr.data || !jr.data.ID) throw new Refused(`Simpro has no job #${no}.`);
  let trip = null, ccJob = null;
  if (phase === "trip") {
    const snap = await deps.db.collection("jobs").doc(String(a.jobId)).get(), jd = snap.exists && snap.data() && snap.data().data;
    if (!jd || String(jd.simproNo || "").trim() !== no) throw new Refused(`That Command Center job isn't Simpro job #${no}.`);
    trip = (jd.returnTrips || []).find(t => t && String(t.id) === String(a.tripId)); ccJob = jd;
    if (!trip) throw new Refused("That return trip isn't on the job.");
    if (trip.signedOff || trip.rtStatus === "complete") throw new Refused("That return trip is already done.");
  }
  // cost center: the one named (checked against the job's own sections), else Rough In / Finish by the work
  const sr = await deps.simproReq("GET", `/jobs/${no}/sections/?pageSize=250&columns=ID,Name,DisplayOrder`);
  const sections = sr && Array.isArray(sr.data) ? sr.data : [];
  let cc = null;
  if (a.costCenter) {
    const sec = sections.find(s => Number(s.ID) === Number(a.costCenter.sectionId));
    if (!sec) throw new Refused(`Job #${no} has no section ${a.costCenter.sectionId}.`);
    const cr = await deps.simproReq("GET", `/jobs/${no}/sections/${sec.ID}/costCenters/?pageSize=250&columns=ID,Name`);
    const c = (cr && Array.isArray(cr.data) ? cr.data : []).find(x => Number(x.ID) === Number(a.costCenter.id));
    if (!c) throw new Refused(`Job #${no} has no cost center ${a.costCenter.id} in section ${sec.Name || sec.ID}.`);
    cc = { sectionId: Number(sec.ID), sectionName: String(sec.Name || ""), id: Number(c.ID), name: String(c.Name || "") };
  } else {
    for (const s of sections.filter(x => /^\s*base\s*$/i.test(x.Name || "")).concat(sections).slice(0, 4)) {
      if (s.ccs) continue;
      const cr = await deps.simproReq("GET", `/jobs/${no}/sections/${s.ID}/costCenters/?pageSize=250&columns=ID,Name`);
      s.ccs = cr && Array.isArray(cr.data) ? cr.data : [];
    }
    const want = phase === "trip" ? tripCc(trip, ccJob) : phase;
    cc = SB.pickCostCenter(sections, phase, want);
    if (!cc) throw new Refused(`Job #${no} has no ${want === "rough" ? "Rough In" : "Finish"} cost center in its Base section, so this can't pick where to book. Name the cost center, or book it in Simpro.`);
  }
  // who
  const [users, staffAll, ptoSnap, prefSnap] = await Promise.all([deps.getUsers(), deps.staff(),
    deps.db.collection("settings").doc("crewPTO").get(), deps.db.collection("meetings").doc("scramble__prefs").get()]);
  const board = SC.crewBoard(users || []);
  const who = resolvePeople(a.entries, board, staffAll);
  // Simpro's schedule for every week touched
  const dates = a.entries.map(r => r.date).sort(), from = SB.mondayOf(dates[0]), to = SB.addDays(SB.mondayOf(dates[dates.length - 1]), 6);
  let schedules = [];
  for (let page = 1; page <= 12; page++) {
    const r = await deps.simproReq("GET", `/schedules/?pageSize=250&page=${page}&Date=between(${from},${to})`);
    if (!r || !r.ok || !Array.isArray(r.data)) throw new Refused("Couldn't read Simpro's schedule to check for double-booking and overtime. Nothing was written; try again.");
    schedules = schedules.concat(r.data);
    if (r.data.length < 250) break;
    if (page === 12) throw new Refused("That's too long a stretch to check against Simpro's schedule in one go. Nothing was written; book it in shorter pieces.");
  }
  const prefs = prefSnap.exists ? prefSnap.data() || {} : {}, pto = ptoSnap.exists ? (ptoSnap.data() || {}).list : [];
  const g = guard({ rows: who.rows, board, isOff: offDays(pto, board), holidays: holidayMap(prefs.holidays), schedules, staffAll, jobNo: no, aloneOk: !!a.aloneOk, splitPairs: !!a.splitPairs, unplaced: who.refusals.map(x => x.date) });
  const entries = entriesFor(who.rows, SB.weekHours(schedules, who.rows.map(r => r.staffId)));
  const clash = SB.overlaps(schedules, entries).map(c => ({ person: c.name, date: c.date, rule: "double-booked",
    why: `${c.name} already has ${c.type === "activity" ? "time off or an activity" : c.type === "leave" ? "leave" : "a booking" + (c.ref ? " on job " + c.ref.split("-")[0] : "")} in Simpro ${c.date} ${c.at}.` }));
  const seenR = new Set(), refusals = [...who.refusals, ...g.refusals, ...clash].filter(x => { const k = x.person + "|" + x.date + "|" + x.rule; if (seenR.has(k)) return false; seenR.add(k); return true; });
  const hash = SB.hashOf(no, cc, entries);
  const job = { no, name: String(jr.data.Name || "") };
  const totals = { entries: entries.length, hours: entries.reduce((x, e) => x + e.hours, 0), overtimeHours: entries.reduce((x, e) => x + e.ot, 0) };
  const lines = entries.map(e => ({ date: e.date, person: e.person, simproEmployee: e.name, time: e.blocks.map(b => `${clockOf(b.StartTime)}–${clockOf(b.EndTime)} ${b.rate}`).join(", "), hours: e.hours, overtimeHours: e.ot, weekHoursBefore: e.weekBefore }));
  const tripLine = trip ? { tripId: String(trip.id), willBeMarkedScheduledOn: dates[0], material: String(trip.material || "").replace(/<[^>]*>/g, "").trim() ? "on the trip" : "none on the trip: Koy gets a Send a PO item" } : null;
  if (a.mode === "preview" || refusals.length) {
    return { ok: !refusals.length, mode: "preview", canBook: !refusals.length, job, costCenter: cc, entries: lines, totals, notes: g.notes, ...(tripLine ? { trip: tripLine } : {}),
      ...(refusals.length ? { refused: refusals, message: "Nothing was written. Fix what is refused and preview again." } : { hash, message: "Nothing is written yet. To book exactly this, send the same request with mode book and this hash." }) };
  }
  if (a.hash !== hash) throw new Refused("Simpro changed since that preview, or the request isn't the same one (someone booked or moved a day). Nothing was written. Preview again and confirm the new one.");
  const path = `/jobs/${no}/sections/${cc.sectionId}/costCenters/${cc.id}/schedules/`;
  const created = []; let failed = null;
  for (const e of entries) {
    const r = await deps.simproReq("POST", path, SB.bodyOf(e));
    if (!r || !r.ok) { failed = { date: e.date, person: e.person, status: r && r.status, error: (typeof (r && r.data) === "string" ? r.data : JSON.stringify((r && r.data) || {})).slice(0, 300) }; break; }
    created.push({ date: e.date, person: e.person, hours: e.hours, overtimeHours: e.ot, scheduleId: (r.data && r.data.ID) || null, time: e.blocks.map(b => `${b.StartTime}-${b.EndTime}`).join(", ") });
  }
  try { await deps.db.collection("scrambleBookings").add({ at: new Date().toISOString(), by, via: "duet", job, phase, costCenter: cc,
    planned: entries.map(e => ({ date: e.date, staffId: e.staffId, name: e.name, hours: e.hours, ot: e.ot })), created, failed, ok: !failed }); } catch (e) { if (deps.log) deps.log("log failed: " + (e && e.message)); }
  let tripDone = null;
  if (trip && created.length) {
    try { tripDone = await deps.tripWrite(String(a.jobId), no, (trips) => ST.planTripBooked(trips, String(a.tripId), created.map(c => c.date).sort()[0],
      { at: new Date().toISOString(), by, path, ids: created.map(c => c.scheduleId).filter(Boolean) }), by); }
    catch (e) { tripDone = { ok: false }; if (deps.log) deps.log("trip mark failed: " + (e && e.message)); }
  }
  return { ok: !failed, mode: "book", job, costCenter: cc, path, created, planned: entries.length, notes: g.notes, ...(failed ? { failed, message: `Booked ${created.length} of ${entries.length}, then Simpro refused one. The rest were not written. Check Simpro before trying again.` } : {}),
    ...(trip ? { trip: tripDone && tripDone.ok ? { markedScheduledOn: tripDone.rtStatusDate || created.map(c => c.date).sort()[0] } : { marked: false, note: "The booking is in Simpro but the trip was not marked Scheduled; set it on the job." } } : {}) };
}

module.exports = { MAX_ROWS, checkRequest, resolvePeople, offDays, holidayMap, simproDay, guard, entriesFor, tripCc, run, Refused };
