// punchListStage.js — the Punch List stage on the residential Job Board (v624).
//
// WHY THIS EXISTS (Josh, 2026-11-11 email: seven stages, same names in the app
// and Simpro; "Add a Punch List stage between Finish and Completed")
// --------------------------------------------------------------------------
// The app won't let finish reach 100% / Complete while finish punch or QC items
// are open, so a job with a few loose ends sat in "Finish In Progress" at 95%
// for months (The Hideout, Austin Cloward). And jobs marked Complete before the
// gate existed, or that got a return trip afterwards, sat in "Completed" with
// work still open (Casten-Vaught, Maddox). Neither told the truth.
//
// Punch List is DERIVED, never set: no new field, no new button, nothing
// written. A full residential job is on Punch List when
//   - its finish is In Progress at 90% or more, or marked Complete, AND
//   - something is still open: a finish punch item, a QC-walk item, a failed
//     final-inspection item, or a return trip that isn't done.
// It leaves the moment the last one closes. On Hold always stays On Hold.
//
// Pure, CommonJS, no requires — the CRA bundle imports it (App.js) and
// scripts/punch-list-stage-test.js drives the exact file that ships.
"use strict";

// Finish % at which a job with open items counts as "on punch list".
const PUNCH_LIST_FROM_PCT = 90;

// Same one-liner as App.js / stageChange.js parseStage.
const parseStage = (s) => s === "Scheduled" ? 1 : (parseInt(s) || 0);

// Open items in one punch tree ({upper, main, basement, extras:[{key}], <extraKey>}),
// each floor {general[], hotcheck[], rooms[{items[]}]}. Done and voided items
// don't count — the same walk qcTripPlan uses.
function openPunchItems(punch) {
  const out = [];
  if (!punch || typeof punch !== "object") return out;
  const keys = ["upper", "main", "basement", ...((punch.extras || []).map(e => e && e.key).filter(Boolean))];
  const take = (i) => { if (i && typeof i === "object" && !i.done && !i.voided) out.push(i); };
  keys.forEach(k => {
    const fl = punch[k];
    if (!fl || typeof fl !== "object") return;
    (fl.general || []).forEach(take);
    (fl.hotcheck || []).forEach(take);
    (fl.rooms || []).forEach(r => ((r && r.items) || []).forEach(take));
  });
  return out;
}

// A return trip is open until it is signed off or marked complete.
const tripOpen = (rt) => !!rt && typeof rt === "object" && !rt.signedOff && rt.rtStatus !== "complete";

// Everything still open that keeps a finished-ish job off "Completed".
function punchListOpen(job) {
  const j = job || {};
  const finishPunch = openPunchItems(j.finishPunch).length;
  const qcPunch = openPunchItems(j.qcPunch).length;
  const inspection = j.finalInspectionResult === "fail"
    ? (j.finalInspectionItems || []).filter(i => i && typeof i === "object" && !i.done).length : 0;
  const trips = (Array.isArray(j.returnTrips) ? j.returnTrips : []).filter(tripOpen).length;
  return { finishPunch, qcPunch, inspection, trips, total: finishPunch + qcPunch + inspection + trips };
}

// fs = the job's EFFECTIVE finish status (App.js effFS), passed in so this file
// and the board can never read the status two different ways.
function isPunchListJob(job, fs) {
  const j = job || {};
  if (j.tempPed || j.quickJob || j.type === "quote" || j.division === "commercial") return false;
  const done = fs === "complete" || fs === "invoice";
  if (!done && !(fs === "inprogress" && parseStage(j.finishStage) >= PUNCH_LIST_FROM_PCT)) return false;
  return punchListOpen(j).total > 0;
}

// "2 punch items · 1 return trip" — what's keeping it here, in plain words.
function punchListLine(open) {
  const o = open || {};
  const n = (c, w) => `${c} ${w}${c === 1 ? "" : "s"}`;
  return [
    o.finishPunch ? n(o.finishPunch, "punch item") : "",
    o.qcPunch ? n(o.qcPunch, "QC item") : "",
    o.inspection ? n(o.inspection, "inspection item") : "",
    o.trips ? n(o.trips, "return trip") : "",
  ].filter(Boolean).join(" · ");
}

module.exports = { PUNCH_LIST_FROM_PCT, openPunchItems, punchListOpen, isPunchListJob, punchListLine };
