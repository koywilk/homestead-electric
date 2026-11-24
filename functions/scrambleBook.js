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
function overlaps(schedules, entries, jobNo) {
  const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
  const out = [];
  (entries || []).forEach(e => {
    const mine = (e.blocks || []).map(b => [toMin(b.StartTime), toMin(b.EndTime)]).filter(x => x[0] != null && x[1] != null);
    (schedules || []).forEach(s => {
      if (Number(s && s.Staff && s.Staff.ID) !== Number(e.staffId) || String(s.Date || "").slice(0, 10) !== e.date) return;
      if (jobNo != null && String(s.Type || "job") === "job" && jobOfRef(s.Reference) === String(jobNo)) return;   // v684: the same job's own schedule is changed, not doubled
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
// days: [{ date, hours, start?, staffIds?, people? }] (hours per person that day; people: [{ staffId, start, hours }] for
// anyone on their own time that day, v678); staff: [{ id, name }].
function buildEntries(days, staff, existing) {
  const run = {};
  const out = [];
  (days || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(d => {
    // v661: a day can name its own people (d.staffIds, a subset of the booking's); others book everyone picked.
    (Array.isArray(d.staffIds) && d.staffIds.length ? (staff || []).filter(p => d.staffIds.map(Number).includes(Number(p.id))) : (staff || [])).forEach(p => {
      const wk = mondayOf(d.date), k = p.id + "|" + wk;
      if (run[k] == null) run[k] = Number(((existing || {})[p.id] || {})[wk]) || 0;
      const before = run[k];
      // v678 (Koy 2026-11-21): a person on the block with their own start and finish that day books at those
      const own = Array.isArray(d.people) ? d.people.find(x => x && Number(x.staffId) === Number(p.id)) : null, hrs = own ? q4(own.hours) : q4(d.hours), st = own ? own.start : d.start;
      const b = blocksFor(hrs, before, st);
      run[k] = before + hrs;
      out.push({ date: d.date, staffId: Number(p.id), name: String(p.name || ""), hours: hrs, normal: b.normal, ot: b.ot, weekBefore: Math.round(before * 100) / 100, blocks: b.blocks });
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

// v684 (Koy 2026-11-23: "it needs to book to the correct cost center as well" and "even if the job has a finish in a
// rough cost center, I still want it booked accurately to the cost center"). Where the work goes, in this order:
//   a person's pick (from the job box) > the pick saved for this job and phase > warranty work on an open Warranty cost
//   center > a change order trip on its own change order cost center (by the CO's date or words) > the one open cost
//   center that fits the work (Rough In / Finish by Simpro's own cost center type or the cost center's name, change
//   order sections left out) > the one open work cost center on the job. When it still can't tell, it asks: { ask:
//   [options] } lists every open work cost center, best fits first. A fully invoiced cost center goes to an open Warranty
//   one, as before. Permit and Service cost centers are never picked or offered.
const typeOf = (c) => String((c && c.CostCenter && c.CostCenter.Name) || "");
const isCoSec = (s, c) => /change\s*order/i.test(String((s && s.Name) || "")) || /change\s*order/i.test(typeOf(c));
const isSide = (s, c) => /service|permit/i.test(typeOf(c)) || /permit/i.test(String((c && c.Name) || "")) || /permit/i.test(String((s && s.Name) || ""));
const fitsPhase = (c, want) => (want === "rough" ? /rough/i : /finish/i).test(typeOf(c) + " " + String((c && c.Name) || ""));
function allCcs(sections) {
  const out = [];
  (sections || []).forEach(s => (Array.isArray(s && s.ccs) ? s.ccs : []).forEach(c => { if (c && c.ID) out.push([s, c]); }));
  return out;
}
const optOf = (s, c, why) => ({ sectionId: Number(s.ID), sectionName: String(s.Name || ""), id: Number(c.ID), name: String(c.Name || ""), type: typeOf(c), ...(why ? { why } : {}) });
// "Change Order - 11/2/26" style dates a CO made on iso day would carry.
function coDateTags(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); if (!m) return [];
  const y = m[1], mo = String(+m[2]), d = String(+m[3]);
  return [`${mo}/${d}/${y.slice(2)}`, `${mo}/${d}/${y}`, `${m[2]}/${m[3]}/${y.slice(2)}`, `${m[2]}/${m[3]}/${y}`];
}
const words = (t) => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length > 2 && !/^(and|the|for|with|install|provide|add|new)$/.test(w)));
// sections: [{ ID, Name, DisplayOrder, ccs: [Simpro cost centers] }]; phase rough|finish|trip; cc rough|finish|warranty|null;
// o: { pick: { sectionId, id }, saved: { sectionId, id }, co: { date: "YYYY-MM-DD", desc } }.
// Returns a cost center ({ sectionId, sectionName, id, name, ... }), { refused }, or { ask: [options] }.
function chooseCostCenter(sections, phase, cc, o) {
  const opt = o || {}, all = allCcs(sections);
  const NO_WARRANTY = "This is warranty work, and the job has no open Warranty cost center in Simpro (none, or they are all invoiced). Add a Warranty cost center on the job in Simpro, then book.";
  const viaWarranty = (c) => { const w = pickWarranty(sections); return w ? { ...w, because: `${c.Name} is fully invoiced` } : { refused: `${c.Name} on this job is fully invoiced, so a booking can't go there. ${NO_WARRANTY.replace("This is warranty work, and the", "The")}` }; };
  const find = (p) => p && all.find(([s, c]) => Number(s.ID) === Number(p.sectionId) && Number(c.ID) === Number(p.id));
  if (opt.pick) {
    const hit = find(opt.pick);
    if (!hit) return { refused: "That cost center isn't on the job in Simpro anymore. Pick again." };
    if (invoiced(hit[1])) return isWarranty(hit[1], hit[0]) ? { refused: `${hit[1].Name} is fully invoiced. ${NO_WARRANTY.replace("This is warranty work, and the", "The")}` } : viaWarranty(hit[1]);
    return ccOut(hit[0], hit[1], { picked: true });
  }
  if (cc === "warranty") return pickWarranty(sections) || { refused: NO_WARRANTY };
  const want = phase === "trip" ? (cc === "rough" ? "rough" : "finish") : phase;
  const work = all.filter(([s, c]) => !isWarranty(c, s) && !isSide(s, c)), open = work.filter(([, c]) => !invoiced(c));
  const saved = find(opt.saved);
  if (saved && !invoiced(saved[1]) && !isSide(saved[0], saved[1])) return ccOut(saved[0], saved[1], { saved: true });
  const asks = (first) => { const seen = new Set(), list = [];
    [...first, ...open.filter(([s, c]) => !isCoSec(s, c) && fitsPhase(c, want)), ...open].forEach(([s, c, why]) => { const k = s.ID + "-" + c.ID; if (seen.has(k)) return; seen.add(k); list.push(optOf(s, c, why || (isCoSec(s, c) ? "change order" : fitsPhase(c, want) ? (want === "rough" ? "rough in" : "finish") : ""))); });
    return list.length ? { ask: list.slice(0, 40) } : null; };
  // a change order trip: its own change order cost center
  if (opt.co) {
    const tags = coDateTags(opt.co.date), coOpen = open.filter(([s, c]) => isCoSec(s, c));
    const byDate = coOpen.filter(([s]) => tags.some(t => String(s.Name || "").includes(t)));
    if (byDate.length === 1) return ccOut(byDate[0][0], byDate[0][1], { because: "the change order's own cost center" });
    const w = words(opt.co.desc), pool = byDate.length ? byDate : coOpen;
    const scored = pool.map(x => [x, [...words(x[1].Name)].filter(t => w.has(t)).length]).sort((a, b) => b[1] - a[1]);
    if (scored.length && scored[0][1] >= 2 && (scored.length === 1 || scored[1][1] < scored[0][1])) return ccOut(scored[0][0][0], scored[0][0][1], { because: "the change order's own cost center" });
    const coInv = work.filter(([s, c]) => isCoSec(s, c) && invoiced(c) && tags.some(t => String(s.Name || "").includes(t)));
    if (!byDate.length && coInv.length === 1) return viaWarranty(coInv[0][1]);
    return asks(pool.map(x => [x[0], x[1], "change order"])) || { refused: "The job has no open cost center in Simpro to book on." };
  }
  // the Base section's own Rough In / Finish when it is the only fit (as before v684), else the one fit anywhere
  const fit = work.filter(([s, c]) => !isCoSec(s, c) && fitsPhase(c, want)), fitOpen = fit.filter(([, c]) => !invoiced(c));
  if (fitOpen.length === 1) return ccOut(fitOpen[0][0], fitOpen[0][1]);
  if (!fitOpen.length && fit.length) {
    if (open.filter(([s, c]) => !isCoSec(s, c)).length === 0) return viaWarranty(fit[0][1]);
  }
  if (!fitOpen.length) { const nonCo = open.filter(([s, c]) => !isCoSec(s, c)); if (nonCo.length === 1) return ccOut(nonCo[0][0], nonCo[0][1]); }
  return asks([]) || (fit.length ? viaWarranty(fit[0][1]) : { refused: "The job has no open cost center in Simpro to book on." });
}

// v684 (Koy: "the time cards exactly how they are"): Simpro keeps one schedule per person, per job, per day, with any
// number of blocks on it ("a schedule for this job on this date already exists"). A person who already has this job that
// day gets that schedule changed instead of a second one: its blocks that overlap the new times are replaced, the rest
// stay, and the new blocks go on. sameJob: the person's schedules on this job that day.
const toMinB = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? +m[1] * 60 + +m[2] : null; };
const jobOfRef = (r) => String(r || "").split("-")[0];
function sameJobRows(schedules, no, staffId, date) {
  return (schedules || []).filter(s => s && String(s.Type || "job") === "job" && jobOfRef(s.Reference) === String(no) && Number(s.Staff && s.Staff.ID) === Number(staffId) && String(s.Date || "").slice(0, 10) === date);
}
function splitBlocks(existing, fresh) {
  const mine = (fresh || []).map(b => [toMinB(b.StartTime), toMinB(b.EndTime)]);
  const keep = [], drop = [];
  (existing || []).forEach(b => { const a0 = toMinB(b.StartTime), a1 = toMinB(b.EndTime); (a0 != null && a1 != null && mine.some(([m0, m1]) => m0 < a1 && a0 < m1) ? drop : keep).push(b); });
  return { keep, drop };
}
// Simpro's rows with this job's blocks that the new entries replace taken out (so the 40-hour line doesn't count them
// twice, and the overlap check doesn't refuse booking the same job over itself).
function withoutReplaced(schedules, no, entries) {
  const byKey = {}; (entries || []).forEach(e => { (byKey[e.staffId + "|" + e.date] = byKey[e.staffId + "|" + e.date] || []).push(...(e.blocks || [])); });
  return (schedules || []).map(s => {
    if (!s || String(s.Type || "job") !== "job" || jobOfRef(s.Reference) !== String(no)) return s;
    const fresh = byKey[Number(s.Staff && s.Staff.ID) + "|" + String(s.Date || "").slice(0, 10)]; if (!fresh) return s;
    return { ...s, Blocks: splitBlocks(s.Blocks, fresh).keep };
  });
}
const rateId = (b) => Number((b && b.ScheduleRate && typeof b.ScheduleRate === "object" ? b.ScheduleRate.ID : b && b.ScheduleRate)) || RATE_NORMAL.id;
// What to send for each entry: { e, method, path, body, keeps, replaces, otherCc? }. ccSec: { ccId: sectionId } for the job.
function planWrites(no, cc, entries, schedules, ccSec) {
  const base = `/jobs/${no}/sections/${cc.sectionId}/costCenters/${cc.id}/schedules/`;
  return (entries || []).map(e => {
    const same = sameJobRows(schedules, no, e.staffId, e.date)[0];
    if (!same) return { e, method: "POST", path: base, body: bodyOf(e) };
    const ccId = Number(String(same.Reference || "").split("-")[1]), sec = ccSec && ccSec[ccId];
    if (!ccId || !sec) return { e, refused: `${e.name} already has job #${no} in Simpro on ${e.date}, on a cost center this can't find. Nothing was written; change it in Simpro.` };
    const { keep, drop } = splitBlocks(same.Blocks, e.blocks);
    const blocks = [...keep.map(b => ({ StartTime: String(b.StartTime).slice(0, 5), EndTime: String(b.EndTime).slice(0, 5), ScheduleRate: rateId(b) })),
      ...e.blocks.map(b => ({ StartTime: b.StartTime, EndTime: b.EndTime, ScheduleRate: b.ScheduleRate }))].sort((a, b) => toMinB(a.StartTime) - toMinB(b.StartTime));
    return { e, method: "PATCH", path: `/jobs/${no}/sections/${sec}/costCenters/${ccId}/schedules/${same.ID}`, body: { Blocks: blocks }, scheduleId: same.ID,
      keeps: keep.map(b => `${String(b.StartTime).slice(0, 5)}–${String(b.EndTime).slice(0, 5)}`), replaces: drop.map(b => `${String(b.StartTime).slice(0, 5)}–${String(b.EndTime).slice(0, 5)}`), ...(ccId !== Number(cc.id) ? { otherCc: ccId } : {}) };
  });
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
    if (x.people != null) {   // v678: people on their own times that day
      const on = Array.isArray(x.staffIds) && x.staffIds.length ? new Set(x.staffIds.map(Number)) : pick;
      if (!Array.isArray(x.people) || x.people.length > 10) return `The people's own times on ${x.date} didn't read right.`;
      const sp = new Set();
      for (const o of x.people) {
        if (!o || !on.has(Number(o.staffId))) return `Someone with their own time on ${x.date} isn't booked that day.`;
        if (sp.has(Number(o.staffId))) return `The same person has two times on ${x.date}.`; sp.add(Number(o.staffId));
        if (!/^\d{2}:\d{2}$/.test(String(o.start || ""))) return `Start time on ${x.date} must be like 07:00.`;
        const m = startMinOf(o.start); if (m < 5 * 60 || m > 17 * 60 || m % 15) return `Start time on ${x.date} must be between 5:00 AM and 5:00 PM, on the quarter hour.`;
        const oh = q4(o.hours); if (!(oh >= 0.25 && oh <= 12)) return `Hours on ${x.date} must be between 0.25 and 12.`;
      }
    }
  }
  if (d.cc != null && !["rough", "finish", "warranty"].includes(d.cc)) return "cc must be rough, finish or warranty";
  if (d.ccPick != null && !(d.ccPick && Number.isInteger(Number(d.ccPick.sectionId)) && Number(d.ccPick.sectionId) > 0 && Number.isInteger(Number(d.ccPick.id)) && Number(d.ccPick.id) > 0)) return "The cost center picked didn't read right. Pick it again.";
  if (d.jobId != null && !/^[A-Za-z0-9_-]{1,80}$/.test(String(d.jobId))) return "Bad job id.";
  if (d.tripId != null && !/^[A-Za-z0-9_.-]{1,80}$/.test(String(d.tripId))) return "Bad trip id.";
  if (d.pending != null) {
    if (d.mode !== "preview") return "Confirm from a preview.";
    if (!Array.isArray(d.pending) || d.pending.length > 400 || d.pending.some(p => !p || !(Number(p.staffId) > 0) || !isIso(p.date) || !(Number(p.hours) > 0 && Number(p.hours) <= 24))) return "The week's earlier blocks didn't read right. Close and open Book the week again.";
  }
  if (d.mode === "book" && !/^[0-9a-z]+\.[0-9a-z]+$/.test(String(d.hash || ""))) return "Confirm from a preview.";
  return "";
}

module.exports = { chooseCostCenter, planWrites, withoutReplaced, sameJobRows, splitBlocks, coDateTags, RATE_NORMAL, RATE_OT, MAX_ENTRIES, blocksFor, overlaps, weekHours, addPending, buildEntries, bodyOf, hashOf, pickCostCenter, pickWarranty, invoiced, validate, mondayOf, addDays };
