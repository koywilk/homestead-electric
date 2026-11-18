// scrambleBook.js — "Book in Simpro" from the Weekly Scramble calendar (SW v651, Koy 2026-11-17).
//
// Pure rules (no I/O) for the scrambleBook callable in index.js, driven by scripts/scramble-cal-test.js.
// Koy's standing rules this enforces:
//   - every write to Simpro is shown first and goes in only when a person taps confirm in the app
//     (preview → the same entries are rebuilt at confirm time and must hash the same, or nothing is written)
//   - any hours over 40 in a person's week go in at the 1.5x overtime rate
//   - never set or change a job's stage or status: this only creates schedule entries
// Entries start at 7:00 AM. A person's week is Monday to Sunday and counts every hour already on
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

// One person-day: `hours` from 7:00, normal time until the person's week reaches 40, overtime after.
function blocksFor(hours, weekBefore) {
  const h = q4(hours), before = Math.max(0, Number(weekBefore) || 0);
  const normal = Math.max(0, Math.min(h, q4(40 - before))), ot = q4(h - normal);
  const blocks = []; let t = START_MIN;
  if (normal > 0) { const e = t + Math.round(normal * 60); blocks.push({ StartTime: hhmm(t), EndTime: hhmm(e), ScheduleRate: RATE_NORMAL.id, rate: RATE_NORMAL.name, hrs: normal }); t = e; }
  if (ot > 0) { const e = t + Math.round(ot * 60); blocks.push({ StartTime: hhmm(t), EndTime: hhmm(e), ScheduleRate: RATE_OT.id, rate: RATE_OT.name, hrs: ot }); }
  return { blocks, normal, ot };
}

// Hours already on each person's Simpro schedule, per week: { staffId: { mondayIso: hours } }.
function weekHours(schedules, staffIds) {
  const want = new Set((staffIds || []).map(Number));
  const out = {};
  (schedules || []).forEach(s => {
    const id = Number(s && s.Staff && s.Staff.ID); if (!want.has(id) || !isIso(String(s.Date || "").slice(0, 10))) return;
    const hrs = (s.Blocks || []).reduce((a, b) => a + (Number(b && b.Hrs) || 0), 0) || Number(s.TotalHours) || 0;
    const wk = mondayOf(String(s.Date).slice(0, 10));
    ((out[id] = out[id] || {})[wk] = (out[id][wk] || 0) + hrs);
  });
  return out;
}

// Every entry to write, in date order, with each person's running week total.
// days: [{ date, hours }] (hours per person that day); staff: [{ id, name }].
function buildEntries(days, staff, existing) {
  const run = {};
  const out = [];
  (days || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(d => {
    (staff || []).forEach(p => {
      const wk = mondayOf(d.date), k = p.id + "|" + wk;
      if (run[k] == null) run[k] = Number(((existing || {})[p.id] || {})[wk]) || 0;
      const before = run[k];
      const b = blocksFor(d.hours, before);
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
function pickCostCenter(sections, phase) {
  const want = phase === "rough" ? /rough/i : /finish/i;
  const list = (sections || []).filter(s => s && Array.isArray(s.ccs));
  const ordered = list.filter(s => /^\s*base\s*$/i.test(s.Name || "")).concat(list.slice().sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0)));
  for (const s of ordered) {
    const cc = s.ccs.find(c => c && want.test(c.Name || ""));
    if (cc) return { sectionId: Number(s.ID), sectionName: String(s.Name || ""), id: Number(cc.ID), name: String(cc.Name || "") };
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
  if (days.length * staff.length > MAX_ENTRIES) return `That's more than ${MAX_ENTRIES} entries; book it in smaller pieces.`;
  const last = addDays(today, 120), seen = new Set();
  for (const x of days) {
    if (!x || !isIso(x.date)) return "Each day needs a date.";
    if (x.date < today) return `${x.date} is in the past; Simpro bookings from here start today.`;
    if (x.date > last) return `${x.date} is more than 120 days out.`;
    if (seen.has(x.date)) return `${x.date} is in the list twice.`; seen.add(x.date);
    const h = q4(x.hours); if (!(h >= 0.25 && h <= 12)) return `Hours on ${x.date} must be between 0.25 and 12.`;
  }
  if (d.mode === "book" && !/^[0-9a-z]+\.[0-9a-z]+$/.test(String(d.hash || ""))) return "Confirm from a preview.";
  return "";
}

module.exports = { RATE_NORMAL, RATE_OT, MAX_ENTRIES, blocksFor, weekHours, buildEntries, bodyOf, hashOf, pickCostCenter, validate, mondayOf, addDays };
