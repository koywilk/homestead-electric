// ─────────────────────────────────────────────────────────────
// Friday Strategy meeting on /dashboard › Meetings (SW v657, Koy 2026-11-19, approved spec
// meeting-docs/friday/dashboard-spec-2026-11-19.md). PURE module: no Firestore, no network.
//
// The Thursday-night prefill (strategyMeetingPrefill, Thu 9:00 PM MT) builds the Friday
// Strategy Prep model (./strategyPrep.js buildModel — the same reads and the same accuracy
// rules as the Friday doc) and turns it into the meeting's rows here, one list per section.
// The rows are saved under meetings/strategy_<Friday>.prefill; the page adds its own hides,
// edits, notes, adds and action items on top, like the other meetings.
//
// Every row: { key, jobId, no, title, tag, detail, group?, lines?, bad? }. Strings only, so it
// stores in Firestore as is. Jobs always carry their number (no) and name (title).
// Owners meeting: dollar figures are allowed on this page.
// ─────────────────────────────────────────────────────────────
"use strict";
const SP = require("./strategyPrep.js");

const { arr, ymd, fmtMD, toDateAny, daysBetween, addDays, clip, stripHtml, snOf } = SP;
const safeKey = (s) => String(s || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80) || "x";
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const dayOf = (d) => d ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${fmtMD(d)}` : "";
const cleanStatus = (s) => String((s && typeof s === "object" ? s.untrusted : s) || "").replace(/^Job\s*-\s*/i, "").trim();
const tripOpen = (t) => !!t && !t.signedOff && t.rtStatus !== "complete";
const tripDate = (t) => toDateAny((t && (t.rtStatusDate || t.scheduledDate || t.date)) || "");
// PO numbers written in a trip's own text ("PO 7224", "PO# 7224", "po 7224").
const posIn = (s) => Array.from(new Set((String(s || "").match(/\bP\.?O\.?\s*#?\s*(\d{3,6})\b/gi) || []).map(x => x.replace(/\D/g, ""))));
// A phase's material PO: a card on <phase>Materials that has a PO number.
const phasePos = (j, phase) => arr(j && j[phase + "Materials"]).filter(c => c && String(c.po || "").trim()).map(c => String(c.po).trim());
const coIsConverted = (co, rts) => !!co && (String(co.coStatus || "").toLowerCase() === "converted" ||
  (!co.convertUndoneAt && co.id != null && arr(rts).some(rt => rt && rt.fromCOId === co.id)));
const coOpenApproved = (co, rts) => !!co && String(co.coStatus || "").toLowerCase() === "approved" && !coIsConverted(co, rts);

const SECS = [
  ["top", "Top of the meeting"],
  ["schedule", "Schedule next week"],
  ["starts", "Starts next week"],
  ["trips", "Return trips needed"],
  ["needsdate", "Needs a date"],
  ["moved", "Dates that moved since last Friday"],
  ["oncal", "On the calendar next week"],
  ["numbers", "Job numbers"],
  ["out", "People out next week"],
  ["notes", "Notes"],
  ["nextsteps", "Action items"],
];

// model: strategyPrep.buildModel(...) · jobs: every job (unwrapped) · totals: settings/simproTotals.byNo
// now: Date. Returns { weekLabel, meetingYmd, builtAt, rows: { <sec>: [row] }, errors: [text] }.
function buildPrefill({ model, jobs, totals = {}, now = new Date() }) {
  const m = model || {};
  const live = SP.liveJobs(jobs || []);
  const byId = new Map(arr(jobs).filter(Boolean).map(j => [j.id, j]));
  const byName = new Map(live.map(j => [String(j.name).trim().toLowerCase(), j]));
  const w = SP.weekOf(now), weekYmds = w.weekYmds, today = w.today, todayYmd = ymd(today);
  const R = {}; SECS.forEach(([k]) => { R[k] = []; });
  const errors = [];
  const jobRow = (j, extra) => ({ jobId: j ? String(j.id) : "", no: j ? snOf(j) : "", title: j ? String(j.name || "").trim() : "", ...extra });
  const S = m.schedule && !m.schedule.error ? m.schedule : null;
  if (!S) errors.push((m.schedule && m.schedule.error) || "Schedule did not load.");

  // 2 · Schedule next week: booked (Simpro + planner) by day, then jobs in progress with nobody booked.
  const bookedIds = new Set();
  if (S) {
    arr(S.booked).forEach(b => { const j = byId.get(b.jobId); bookedIds.add(b.jobId);
      R.schedule.push(jobRow(j, { key: "b_" + safeKey(b.jobId), title: (j && j.name) || b.name, group: "Booked next week", tag: b.phase === "finish" ? "Finish" : "Rough",
        detail: [`${b.days}: ${arr(b.people).map(first).join(", ")}`, b.pct ? `${b.phase} ${b.pct}%` : ""].filter(Boolean).join(" · ") })); });
    arr(S.idle).forEach(r => { const j = byId.get(r.jobId);
      const crew = [r.foreman, r.lead].filter(Boolean).map(first);
      const upd = r.lastUpdate instanceof Date ? daysBetween(today, r.lastUpdate) : null;
      R.schedule.push(jobRow(j, { key: "i_" + safeKey(r.jobId), title: (j && j.name) || r.name, group: "Needs booking", tag: crew.length ? "Not booked" : "NO CREW", bad: true,
        detail: [r.statusText || `${r.phase} ${r.pct || 0}%`, upd == null ? "no update logged" : upd === 0 ? "updated today" : `last update ${upd}d ago`,
          r.openPunch ? `${r.openPunch} punch` : "", r.questions ? `${r.questions} question${r.questions > 1 ? "s" : ""}` : "",
          arr(r.waitBuckets).length ? "waiting on " + r.waitBuckets.join(", ") : "", crew.length ? "crew " + crew.join(" / ") : "NO CREW"].filter(Boolean).join(" · ") })); });
    arr(S.onHold).forEach(r => { const j = byId.get(r.jobId);
      R.schedule.push(jobRow(j, { key: "h_" + safeKey(r.jobId), title: (j && j.name) || r.name, group: "On hold", tag: "On hold", detail: `${r.phase} ${r.pct || 0}%${r.since ? " · since " + fmtMD(r.since) : ""}` })); });
  }

  // 3 · Starts: next week's rough / finish starts (and overdue ones), booked or not.
  if (S) {
    const starts = [];
    arr(S.booked).filter(b => b.start).forEach(b => starts.push({ ...b, ...b.start, crewBooked: true, people: b.people }));
    arr(S.starts).forEach(s => starts.push(s));
    starts.sort((a, b) => (a.date && b.date ? a.date - b.date : a.date ? -1 : 1) || String(a.name).localeCompare(String(b.name)));
    starts.forEach(s => {
      const j = s.pipeline ? null : byId.get(s.jobId);
      const pos = j ? phasePos(j, s.phase) : [];
      const lead = j ? SP.leadOf(j) : "";
      const prep = s.prep || (j ? SP.prepOf(j) : { done: 0, total: 5 });
      const why = [!s.crewBooked ? "nobody booked" : "", !lead ? "no lead" : "", prep.done < 5 ? `prep ${prep.done}/5` : "", !pos.length ? "no material PO" : ""].filter(Boolean);
      const d = s.date instanceof Date ? s.date : toDateAny(s.date);
      R.starts.push({ key: "st_" + safeKey(s.jobId) + "_" + String(s.phase || "").charAt(0), jobId: j ? String(j.id) : "", no: j ? snOf(j) : ((/#?\s*(\d{3,6})/.exec(String(s.name || "")) || [])[1] || ""),
        title: j ? String(j.name).trim() : String(s.name || "").replace(/^#?\s*\d{3,6}\s*[-–:]?\s*/, ""), tag: why.length ? "AT RISK" : "On track", bad: why.length > 0,
        detail: [(s.phase === "finish" ? "Finish" : "Rough") + " " + (d ? dayOf(d) : "no date") + (s.overdue ? ` (${s.daysLate || 0}d late)` : s.confirmed ? " confirmed" : " projected"),
          s.crewBooked ? "booked: " + arr(s.people).map(first).join(", ") : "", why.length ? why.join(", ") : "", pos.length ? "PO " + pos.join(", ") : "", lead ? "lead " + first(lead) : "",
          s.pipeline ? "from the Upcoming list" : ""].concat(arr(s.elsewhere)).filter(Boolean).join(" · ") });
    });
  }

  // 4 · Return trips: every open trip in Command Center, plus approved change orders not on a trip.
  live.forEach(j => {
    arr(j.returnTrips).forEach((t, i) => {
      if (!tripOpen(t)) return;
      const d = tripDate(t), who = String(t.assignedTo || "").trim();
      const booked = t.rtStatus === "scheduled" && d;
      const forWhat = clip(stripHtml(t.scope || t.task || ""), 110) || "No scope written";
      const mat = clip(stripHtml(t.material || ""), 90);
      const pos = posIn([t.material, t.scope, t.task, t.notes].map(stripHtml).join(" "));
      R.trips.push(jobRow(j, { key: "t_" + safeKey(j.id + "_" + (t.id || i)), title: `${String(j.name).trim()} · trip ${i + 1}`,
        tag: booked ? `Booked ${dayOf(d)}${who ? " · " + first(who) : " · nobody"}` : d ? `Needs by ${fmtMD(d)}` : "Not booked", bad: !booked || !who,
        detail: [forWhat, mat ? "material: " + mat : "no material listed", pos.length ? "PO " + pos.join(", ") : mat ? "no PO" : ""].filter(Boolean).join(" · ") }));
    });
    arr(j.changeOrders).forEach((co, i) => {
      if (!coOpenApproved(co, j.returnTrips)) return;
      R.trips.push(jobRow(j, { key: "co_" + safeKey(j.id + "_" + (co.id || i)), title: `${String(j.name).trim()} · change order ${i + 1}`, tag: "Approved CO, no trip", bad: true,
        detail: clip(stripHtml(co.desc || co.task || ""), 120) || "No description" }));
    });
  });
  R.trips.sort((a, b) => (a.bad === b.bad ? 0 : a.bad ? -1 : 1) || (+a.no || 0) - (+b.no || 0));

  // 5 · Needs a date: past-due trips not finished; Simpro "Job - Scheduled" with nothing booked next week.
  live.forEach(j => arr(j.returnTrips).forEach((t, i) => {
    if (!tripOpen(t)) return; const d = tripDate(t); if (!d || ymd(d) >= todayYmd) return;
    R.needsdate.push(jobRow(j, { key: "pd_" + safeKey(j.id + "_" + (t.id || i)), title: `${String(j.name).trim()} · trip ${i + 1}`, tag: `${daysBetween(today, d)}d past`, bad: true,
      detail: `Was ${t.rtStatus === "scheduled" ? "booked" : "due"} ${fmtMD(d)}${t.assignedTo ? " · " + first(t.assignedTo) : ""} · not finished · ${clip(stripHtml(t.scope || t.task || ""), 90)}` }));
  }));
  const seenNo = new Set();
  live.forEach(j => {
    const sn = snOf(j), t = sn ? totals[sn] : null; if (!t || seenNo.has(sn)) return;
    if (!/^scheduled$/i.test(cleanStatus(t.status))) return;
    if (bookedIds.has(j.id)) return;
    seenNo.add(sn);
    R.needsdate.push(jobRow(j, { key: "ss_" + safeKey(sn), tag: "Simpro: Scheduled", bad: true, detail: "Simpro says Job - Scheduled, nothing booked next week" }));
  });

  // 6 · Dates that moved since last Friday (and dates that passed with nothing done).
  if (S) {
    if (S.movedFirstRun) errors.push("Moved dates start next week: this is the first saved week.");
    arr(S.moved).forEach((r, i) => { const j = byName.get(String(r.name).trim().toLowerCase());
      R.moved.push(jobRow(j, { key: "mv_" + safeKey((j ? j.id : r.name) + "_" + r.label), title: (j && j.name) || r.name, tag: r.nth >= 3 ? `moved ${r.nth - 1}x` : "moved", bad: r.nth >= 3 || r.to === "no date",
        detail: `${r.label}: ${r.from} → ${r.to}` })); void i; });
    arr(S.passed).forEach(r => { const j = byId.get(r.jobId);
      R.moved.push(jobRow(j, { key: "ps_" + safeKey(r.jobId + "_" + r.label), title: (j && j.name) || r.name, tag: `${r.days}d past`, bad: true, detail: `${r.label} was ${r.date}, nothing logged` })); });
  }

  // 7 · On the calendar: inspections, QC walks, scans, booked trips, Koy's calendar walks and meetings.
  if (S) arr(S.calendar).forEach((c, i) => { const j = byName.get(String(c.name).trim().toLowerCase());
    const d = toDateAny(weekYmds[c.di]);
    R.oncal.push(jobRow(j, { key: "oc_" + safeKey((j ? j.id : c.name) + "_" + c.label + "_" + c.di + "_" + i), title: (j && j.name) || c.name, group: dayOf(d), tag: c.label,
      detail: [c.who ? c.who : "", c.ambiguous ? "calendar title matches more than one job" : ""].filter(Boolean).join(" · ") })); });

  // 9 · People out next week (approved), then requests still waiting.
  if (S && S.people) {
    arr(S.people.out).forEach(o => R.out.push({ key: "o_" + safeKey(o.name + "_" + o.range), title: String(o.name || "").trim(), tag: "Out", detail: o.range + (o.note ? " · " + o.note : "") }));
    arr(S.people.pending).forEach(p => R.out.push({ key: "op_" + safeKey(p.name + "_" + p.range), title: String(p.name || "").trim(), tag: "Asked", bad: true, detail: `${p.range} · waiting on a yes${p.requestedDays != null ? ` (${p.requestedDays}d)` : ""}` }));
    arr(S.conflicts).slice(0, 8).forEach((c, i) => R.out.push({ key: "cf_" + i + "_" + safeKey(c).slice(0, 40), title: "Conflict", tag: "Check", bad: true, detail: String(c) }));
  }

  // 1 · Top of the meeting: five or six things, worst first.
  const T = [];
  const losing = live.map(j => ({ j, t: totals[snOf(j)] })).filter(x => x.t && typeof x.t.margin === "number" && !x.t.isEstimate && x.t.margin < 0 && !/^(invoiced|complete|archived)$/i.test(String(x.t.stage || "")))
    .sort((a, b) => a.t.margin - b.t.margin);
  if (losing.length) T.push({ key: "top_losing", title: `${losing.length} job${losing.length > 1 ? "s" : ""} losing money`, tag: "Money", bad: true,
    detail: losing.slice(0, 4).map(x => `#${snOf(x.j)} ${String(x.j.name).trim()} ${Math.round(x.t.margin)}%`).join(" · ") });
  const risk = R.starts.filter(r => r.bad);
  if (risk.length) T.push({ key: "top_starts", title: `${risk.length} start${risk.length > 1 ? "s" : ""} next week at risk`, tag: "Starts", bad: true,
    detail: risk.slice(0, 4).map(r => `#${r.no} ${r.title}`).join(" · ") });
  const idle = R.schedule.filter(r => r.group === "Needs booking");
  if (idle.length) T.push({ key: "top_idle", title: `${idle.length} job${idle.length > 1 ? "s" : ""} in progress with nothing booked`, tag: "Schedule", bad: true,
    detail: idle.slice(0, 4).map(r => `#${r.no} ${r.title}`).join(" · ") + (idle.length > 4 ? ` +${idle.length - 4}` : "") });
  const finals = R.oncal.filter(r => /final/i.test(r.tag));
  if (finals.length) T.push({ key: "top_finals", title: `${finals.length} final inspection${finals.length > 1 ? "s" : ""} next week`, tag: "Finals",
    detail: finals.map(r => `#${r.no} ${r.title} ${r.group}`).join(" · ") });
  const pastTrips = R.needsdate.filter(r => /^pd_/.test(r.key));
  if (pastTrips.length) T.push({ key: "top_pasttrips", title: `${pastTrips.length} return trip${pastTrips.length > 1 ? "s" : ""} past their date, not finished`, tag: "Trips", bad: true,
    detail: pastTrips.slice(0, 4).map(r => `#${r.no} ${r.title}`).join(" · ") });
  const hard = arr(S && S.starts).filter(s => s.hardDate);
  if (hard.length) T.push({ key: "top_hard", title: `${hard.length} customer deadline${hard.length > 1 ? "s" : ""} with no start locked in`, tag: "Deadline", bad: true,
    detail: hard.slice(0, 4).map(s => { const j = byId.get(s.jobId); return `#${j ? snOf(j) : ""} ${s.name}${s.hardBy ? " by " + fmtMD(s.hardBy) : ""}`; }).join(" · ") });
  const noTrip = R.trips.filter(r => /^co_/.test(r.key));
  if (noTrip.length && T.length < 6) T.push({ key: "top_cos", title: `${noTrip.length} approved change order${noTrip.length > 1 ? "s" : ""} not on a trip`, tag: "COs", bad: true,
    detail: noTrip.slice(0, 4).map(r => `#${r.no} ${String(r.title).replace(/ · change order \d+$/, "")}`).join(" · ") });
  R.top = T.slice(0, 6);

  void addDays;
  return { weekLabel: m.weekLabel || `Mon ${fmtMD(w.weekDays[0])} – Fri ${fmtMD(w.weekDays[4])}`, meetingYmd: m.meetingYmd || ymd(w.meeting), weekYmds,
    builtAt: m.builtAt || "", rows: JSON.parse(JSON.stringify(R)), errors };
}

module.exports = { SECS, buildPrefill, posIn, phasePos, safeKey };
