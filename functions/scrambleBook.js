// scrambleBook.js — "Book in Simpro" from the Weekly Scramble calendar (SW v651, Koy 2026-11-17).
//
// Pure rules (no I/O) for the scrambleBook callable in index.js, driven by scripts/scramble-cal-test.js.
// Koy's standing rules this enforces:
//   - every write to Simpro is shown first and goes in only when a person taps confirm in the app
//     (preview → the same entries are rebuilt at confirm time and must hash the same, or nothing is written)
//   - any hours over 40 in a person's week go in at the 1.5x overtime rate
//   - never set or change a job's stage or status: this only creates schedule entries
// Entries start at 7:00 AM, or at the day's start time from the calendar ("HH:MM", 5:00 AM to 5:00 PM; v660, Koy:
// "none of them have time assignments ... RT monday wont take all day"), so a short trip and the job after it fit
// the same day. A person's week is Monday to Sunday and counts every hour already on
// their Simpro schedule that week (jobs and activities), then the new days in date order.
"use strict";

const RATE_NORMAL = { id: 1, name: "Normal Time" };
const RATE_OT = { id: 2, name: "Overtime 1.5x" };
const START_MIN = 7 * 60;
const MAX_ENTRIES = 80;

const pad = (n) => String(n).padStart(2, "0");
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const q4 = (h) => Math.round((Number(h) || 0) * 4) / 4;
function mondayOf(iso) { const [y, m, d] = iso.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
function addDays(iso, n) { const [y, m, d] = iso.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d)); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

const startMinOf = (v) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : START_MIN; };
// One person-day: `hours` from the day's start (7:00 unless given), normal time until the person's week reaches 40, overtime after.
function blocksFor(hours, weekBefore, start) {
  const h = q4(hours), before = Math.max(0, Number(weekBefore) || 0);
  const normal = Math.max(0, Math.min(h, q4(40 - before))), ot = q4(h - normal);
  const blocks = []; let t = startMinOf(start);
  if (normal > 0) { const e = t + Math.round(normal * 60); blocks.push({ StartTime: hhmm(t), EndTime: hhmm(e), ScheduleRate: RATE_NORMAL.id, rate: RATE_NORMAL.name, hrs: normal }); t = e; }
  if (ot > 0) { const e = t + Math.round(ot * 60); blocks.push({ StartTime: hhmm(t), EndTime: hhmm(e), ScheduleRate: RATE_OT.id, rate: RATE_OT.name, hrs: ot }); }
  return { blocks, normal, ot };
}

// v661 (Koy 2026-11-20: "That needs to not be able to even happen at all. If they're scheduled somewhere else, that time
// is blocked off."): every entry checked against what Simpro already has for that person that day (any job, activity or
// time off). Returns [{ date, name, staffId, at: "07:00–17:00", type }] for each overlap; empty when clear.
function overlaps(schedules, entries) {
  const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
  const out = [];
  (entries || []).forEach(e => {
    const mine = (e.blocks || []).map(b => [toMin(b.StartTime), toMin(b.EndTime)]).filter(x => x[0] != null && x[1] != null);
    (schedules || []).forEach(s => {
      if (Number(s && s.Staff && s.Staff.ID) !== Number(e.staffId) || String(s.Date || "").slice(0, 10) !== e.date) return;
      (s.Blocks || []).forEach(b => { const a0 = toMin(b.StartTime), a1 = toMin(b.EndTime); if (a0 == null || a1 == null) return;
        if (mine.some(([m0, m1]) => m0 < a1 && a0 < m1)) out.push({ date: e.date, name: e.name, staffId: e.staffId, at: `${b.StartTime}–${b.EndTime}`, type: String(s.Type || ""), ref: String(s.Reference || "") }); });
    });
  });
  return out;
}

// Hours already on each person's Simpro schedule, per week: { staffId: { mondayIso: hours } }.
function weekHours(schedules, staffIds) {
  const want = new Set((staffIds || []).map(Number));
  const out = {};
  (schedules || []).forEach(s => {
    const id = Number(s && s.Staff && s.Staff.ID); if (!want.has(id) || !isIso(String(s.Date || "").slice(0, 10))) return;
    // v663 (Koy's rule 4: "time off and lunch don't count"): only job bookings count toward the 40. A Simpro activity
    // (time off, lunch, anything that isn't a job) used to push the week over and turn real work into overtime.
    if (s.Type && String(s.Type) !== "job") return;
    const hrs = (s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0;
    const wk = mondayOf(String(s.Date).slice(0, 10));
    ((out[id] = out[id] || {})[wk] = (out[id][wk] || 0) + hrs);
  });
  return out;
}

// v663: "Book the week" previews several blocks before any is written. `pending` is what the blocks ahead of this one
// will add ([{ staffId, date, hours }]), so this preview's 40-hour line is where it will really be at Book time.
// Preview only: at Book the earlier blocks are in Simpro and are read from there.
function addPending(existing, pending, staffIds) {
  const want = new Set((staffIds || []).map(Number)), out = {};
  Object.keys(existing || {}).forEach(id => { out[id] = { ...existing[id] }; });
  (Array.isArray(pending) ? pending : []).forEach(p => { const id = Number(p && p.staffId), d = String((p && p.date) || ""), h = Number(p && p.hours) || 0;
    if (!want.has(id) || !isIso(d) || !(h > 0)) return; const wk = mondayOf(d); (out[id] = out[id] || {})[wk] = (out[id][wk] || 0) + h; });
  return out;
}

// Every entry to write, in date order, with each person's running week total.
// days: [{ date, hours }] (hours per person that day); staff: [{ id, name }].
function buildEntries(days, staff, existing) {
  const run = {};
  const out = [];
  (days || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(d => {
    // v661: a day can name its own people (d.staffIds, a subset of the booking's); others book everyone picked.
    (Array.isArray(d.staffIds) && d.staffIds.length ? (staff || []).filter(p => d.staffIds.map(Number).includes(Number(p.id))) : (staff || [])).forEach(p => {
      const wk = mondayOf(d.date), k = p.id + "|" + wk;
      if (run[k] == null) run[k] = Number(((existing || {})[p.id] || {})[wk]) || 0;
      const before = run[k];
      const b = blocksFor(d.hours, before, d.start);
      run[k] = before + q4(d.hours);
      out.push({ date: d.date, staffId: Number(p.id), name: String(p.name || ""), hours: q4(d.hours), normal: b.normal, ot: b.ot, weekBefore: Math.round(before * 100) / 100, blocks: b.blocks });
    });
  });
  return out;
}

// The Simpro body for one entry (only the fields Simpro takes).
const bodyOf = (e) => ({ Staff: e.staffId, Date: e.date, Blocks: e.blocks.map(b => ({ StartTime: b.StartTime, EndTime: b.EndTime, ScheduleRate: b.ScheduleRate })) });

// A short, stable fingerprint of exactly what would be written (job, cost center, every body).
function hashOf(no, cc, entries) {
  const s = JSON.stringify([String(no), cc ? [cc.sectionId, cc.id] : null, (entries || []).map(bodyOf)]);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + "." + s.length.toString(36);
}

// Which cost center the booking goes on: the Base section's "Rough In" or "Finish" cost center
// (a return trip goes on Finish). sections: [{ ID, Name, DisplayOrder, ccs: [{ ID, Name }] }].
// v663: a return trip says which it belongs on (`cc`: "rough" or "finish"); without it, Finish as before.
// v674 (Koy 2026-11-20: "warranty trips need to look for a warranty cost center, or one needs to be made if there isn't
// one. It just can't be an invoice cost center, or else it won't work"). Simpro's own data says which is which: each
// cost center carries what has been claimed (invoiced) to date, and warranty lines sit in a "Warranty" section with the
// company cost center "Residential (Warranty)".
const invoiced = (c) => Number(c && c.Claimed && c.Claimed.ToDate && c.Claimed.ToDate.Percent) >= 100;
const isWarranty = (c, s) => /warrant/i.test(String((c && c.CostCenter && c.CostCenter.Name) || "")) || /warrant/i.test(String((s && s.Name) || "")) || /warrant/i.test(String((c && c.Name) || ""));
const ccOut = (s, c, more) => ({ sectionId: Number(s.ID), sectionName: String(s.Name || ""), id: Number(c.ID), name: String(c.Name || ""), ...(more || {}) });
// An open warranty cost center on the job: the newest one that isn't fully invoiced. null when there is none.
function pickWarranty(sections) {
  const open = [];
  (sections || []).forEach(s => (Array.isArray(s && s.ccs) ? s.ccs : []).forEach(c => { if (c && isWarranty(c, s) && !invoiced(c)) open.push([s, c]); }));
  if (!open.length) return null;
  open.sort((a, b) => Number(b[1].ID) - Number(a[1].ID));
  return ccOut(open[0][0], open[0][1], { warranty: true, ...(open.length > 1 ? { otherOpenWarranty: open.slice(1).map(x => ({ sectionId: Number(x[0].ID), id: Number(x[1].ID), name: String(x[1].Name || "") })) } : {}) });
}
// Which cost center the booking goes on. cc (a trip's work, or "warranty") or the phase says Rough In or Finish, in
// the Base section first. Warranty work, or a Rough In / Finish that is already fully invoiced, goes to an open
// warranty cost center instead. Returns the cost center, { refused } when the job has nowhere it can go, or null when
// the job has no such cost center at all. sections: [{ ID, Name, DisplayOrder, ccs: [Simpro cost centers] }].
function pickCostCenter(sections, phase, cc) {
  const NO_WARRANTY = "This is warranty work, and the job has no open Warranty cost center in Simpro (none, or they are all invoiced). Add a Warranty cost center on the job in Simpro, then book.";
  if (cc === "warranty") return pickWarranty(sections) || { refused: NO_WARRANTY };
  const want = (phase === "trip" ? cc === "rough" : phase === "rough") ? /rough/i : /finish/i;
  const list = (sections || []).filter(s => s && Array.isArray(s.ccs));
  const ordered = list.filter(s => /^\s*base\s*$/i.test(s.Name || "")).concat(list.slice().sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0)));
  for (const s of ordered) {
    const c = s.ccs.find(x => x && want.test(x.Name || "") && !isWarranty(x, s));
    if (!c) continue;
    if (!invoiced(c)) return ccOut(s, c);
    const w = pickWarranty(sections);
    return w ? { ...w, because: `${c.Name} is fully invoiced` } : { refused: `${c.Name} on this job is fully invoiced, so a booking can't go there. ${NO_WARRANTY.replace("This is warranty work, and the", "The")}` };
  }
  return null;
}

// Input check. today is "YYYY-MM-DD" in Denver. Returns an error string or "".
function validate(data, today) {
  const d = data || {};
  if (!["preview", "book"].includes(d.mode)) return "mode must be preview or book";
  if (!/^\d{1,6}$/.test(String(d.jobNo || ""))) return "A Simpro job number is needed (a quote can't be booked until it's a job).";
  if (!["rough", "finish", "trip"].includes(d.phase)) return "phase must be rough, finish or trip";
  const staff = Array.isArray(d.staffIds) ? d.staffIds : [];
  if (!staff.length) return "Pick who to book first.";
  if (staff.length > 10 || staff.some(x => !Number.isInteger(Number(x)) || Number(x) <= 0)) return "Pick up to 10 people.";
  if (new Set(staff.map(Number)).size !== staff.length) return "The same person is picked twice.";
  const days = Array.isArray(d.days) ? d.days : [];
  if (!days.length) return "No days to book.";
  const pick = new Set(staff.map(Number));
  for (const x of days) if (x && x.staffIds != null) {
    if (!Array.isArray(x.staffIds) || !x.staffIds.length) return `Pick who works ${x && x.date}.`;
    if (x.staffIds.some(id => !pick.has(Number(id)))) return `Someone on ${x.date} isn't in the people picked.`;
    if (new Set(x.staffIds.map(Number)).size !== x.staffIds.length) return `The same person is picked twice on ${x.date}.`;
  }
  if (days.reduce((a, x) => a + (x && Array.isArray(x.staffIds) && x.staffIds.length ? x.staffIds.length : staff.length), 0) > MAX_ENTRIES) return `That's more than ${MAX_ENTRIES} entries; book it in smaller pieces.`;
  const last = addDays(today, 120), seen = new Set();
  for (const x of days) {
    if (!x || !isIso(x.date)) return "Each day needs a date.";
    if (x.date < today) return `${x.date} is in the past; Simpro bookings from here start today.`;
    if (x.date > last) return `${x.date} is more than 120 days out.`;
    if (seen.has(x.date)) return `${x.date} is in the list twice.`; seen.add(x.date);
    const h = q4(x.hours); if (!(h >= 0.25 && h <= 12)) return `Hours on ${x.date} must be between 0.25 and 12.`;
    if (x.start != null && x.start !== "") {
      if (!/^\d{2}:\d{2}$/.test(String(x.start))) return `Start time on ${x.date} must be like 07:00.`;
      const m = startMinOf(x.start); if (m < 5 * 60 || m > 17 * 60 || m % 15) return `Start time on ${x.date} must be between 5:00 AM and 5:00 PM, on the quarter hour.`;
    }
  }
  if (d.cc != null && !["rough", "finish", "warranty"].includes(d.cc)) return "cc must be rough, finish or warranty";
  if (d.jobId != null && !/^[A-Za-z0-9_-]{1,80}$/.test(String(d.jobId))) return "Bad job id.";
  if (d.tripId != null && !/^[A-Za-z0-9_.-]{1,80}$/.test(String(d.tripId))) return "Bad trip id.";
  if (d.pending != null) {
    if (d.mode !== "preview") return "Confirm from a preview.";
    if (!Array.isArray(d.pending) || d.pending.length > 400 || d.pending.some(p => !p || !(Number(p.staffId) > 0) || !isIso(p.date) || !(Number(p.hours) > 0 && Number(p.hours) <= 24))) return "The week's earlier blocks didn't read right. Close and open Book the week again.";
  }
  if (d.mode === "book" && !/^[0-9a-z]+\.[0-9a-z]+$/.test(String(d.hash || ""))) return "Confirm from a preview.";
  return "";
}

module.exports = { RATE_NORMAL, RATE_OT, MAX_ENTRIES, blocksFor, overlaps, weekHours, addPending, buildEntries, bodyOf, hashOf, pickCostCenter, pickWarranty, invoiced, validate, mondayOf, addDays };
