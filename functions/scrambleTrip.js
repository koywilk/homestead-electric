// scrambleTrip.js — a return trip the crew calendar booked into Simpro says so in the app (SW v663).
//
// Kept apart from scrambleBook.js on purpose: that file is the Simpro write and its test proves it never names a
// stage or a status. This file is the one exception Koy asked for, and it is only the trip's own schedule fields.
"use strict";
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
// v663 (Koy 2026-11-21: "if something gets scheduled through this ... if it's the return trip, it should mark itself
// scheduled on what day got scheduled ... If it gets unscheduled, it goes back to 'needs to be scheduled'").
// Pure planners over a job's data.returnTrips; the callables in index.js write the array back in a transaction.
// Only the trip's own schedule fields change (the same ones the trip card's status select writes); never a job's
// stage or status. `calBooked` remembers what the trip said before, so an unschedule puts exactly that back.
const tripDone = (t) => !t || t.signedOff || t.rtStatus === "complete";
function planTripBooked(trips, tripId, date, meta) {
  const list = Array.isArray(trips) ? trips : [], i = list.findIndex(t => t && String(t.id) === String(tripId));
  if (i < 0 || !isIso(date) || tripDone(list[i])) return null;
  const t = list[i], prev = t.calBooked && t.calBooked.prev ? t.calBooked.prev
    : { rtStatus: t.rtStatus || "", rtStatusDate: t.rtStatusDate || "", needsByStart: t.needsByStart || "", needsByEnd: t.needsByEnd || "", needsHardDate: !!t.needsHardDate };
  const ids = [...new Set([...((t.calBooked && t.calBooked.ids) || []), ...((meta && meta.ids) || [])].map(Number).filter(n => n > 0))].slice(0, 40);
  const next = { ...t, rtStatus: "scheduled", rtScheduled: true, needsSchedule: false, rtStatusDate: date, needsByStart: "", needsByEnd: "", needsHardDate: false,
    calBooked: { date, at: (meta && meta.at) || "", by: (meta && meta.by) || "", path: (meta && meta.path) || (t.calBooked && t.calBooked.path) || "", ids, prev } };
  return { returnTrips: list.map((x, k) => k === i ? next : x), before: t, after: next };
}
// found: the dates Simpro still has for the entries this trip was booked with ([] = every one is gone).
function planTripUnbooked(trips, tripId, found) {
  const list = Array.isArray(trips) ? trips : [], i = list.findIndex(t => t && String(t.id) === String(tripId));
  if (i < 0) return null; const t = list[i];
  if (!t.calBooked || tripDone(t) || t.rtStatus !== "scheduled") return null;
  const dates = (found || []).filter(isIso).sort();
  let next;
  if (dates.length) { if (dates[0] === t.rtStatusDate) return null; next = { ...t, rtStatusDate: dates[0], calBooked: { ...t.calBooked, date: dates[0] } }; }   // moved in Simpro
  else { const p = t.calBooked.prev || {}, st = p.rtStatus === "scheduled" ? "needs" : (p.rtStatus || "needs");   // gone: back to what it was (needs scheduling)
    next = { ...t, rtStatus: st, rtScheduled: false, needsSchedule: st === "needs", rtStatusDate: st === "needs" && p.rtStatus === "needs" ? (p.rtStatusDate || "") : "",
      needsByStart: p.needsByStart || "", needsByEnd: p.needsByEnd || "", needsHardDate: !!p.needsHardDate };
    delete next.calBooked; }
  return { returnTrips: list.map((x, k) => k === i ? next : x), before: t, after: next };
}

module.exports = { planTripBooked, planTripUnbooked };
