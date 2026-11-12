// schedMode.js — the In Progress scheduling pill (On Schedule / Needs Sched / Ongoing).
//
// WHY THIS EXISTS (Koy, 2026-11-11, looking at a grey "Ongoing" pill on a
// Finish stage: "this grey ongoing is kinda pointless because i have to click
// the refresh everytime for it to be accurate. investigate and automate.")
// --------------------------------------------------------------------------
// The pill used to show a value SAVED on the job (roughInProgressMode /
// finishInProgressMode). The app asked Simpro "is this job on the schedule in
// the next 14 days?" only while that field was blank, saved the answer, and
// never asked again, so a job scheduled later kept saying "Ongoing" until
// someone tapped the refresh arrow.
//
// Now "On Schedule" vs "Ongoing" is worked out from Simpro every time the pill
// draws, on every screen that shows it. Nothing new is saved.
//   onSimpro === true   the job has a Simpro schedule entry in the next 14 days
//   onSimpro === false  Simpro was read and the job is not on it
//   onSimpro === null   unknown (no Simpro #, or the schedule hasn't loaded):
//                       fall back to the saved value, as before
// "Needs Sched" stays a person's flag: Simpro can't know a job WANTS a crew.
// It shows until Simpro has the job on the schedule.
//
// Pure, CommonJS, no requires — the CRA bundle imports it (App.js) and
// scripts/sched-mode-test.js drives the exact file that ships.
"use strict";

const MODES = ["scheduled", "needsSched", "ongoing"];

// The pill for a phase that is In Progress.
//   stored   = the saved roughInProgressMode / finishInProgressMode
//   onSimpro = true | false | null (see above)
function inProgressMode(stored, onSimpro) {
  if (onSimpro === true) return "scheduled";
  if (onSimpro === false) return stored === "needsSched" ? "needsSched" : "ongoing";
  return MODES.includes(stored) ? stored : "ongoing";
}

// What a tap on the pill does. cur = the mode the pill is SHOWING.
// Returns the next mode to save, or null when the tap changes nothing.
//   Simpro has it scheduled → null: the pill follows Simpro, so there is
//     nothing true to switch to (the old tap saved "Needs Sched" and the app
//     put it straight back).
//   Simpro read, not scheduled → Ongoing ⇄ Needs Sched. "On Schedule" is not
//     offered, because Simpro says it isn't.
//   Simpro unknown → the old three-way cycle.
function nextMode(cur, onSimpro) {
  if (onSimpro === true) return null;
  if (onSimpro === false) return cur === "needsSched" ? "ongoing" : "needsSched";
  return cur === "scheduled" ? "needsSched" : cur === "needsSched" ? "ongoing" : "scheduled";
}

// The line shown when a tap is refused.
const LOCKED_NOTE = "This job is on Simpro's schedule in the next 14 days. Change the schedule in Simpro.";

// How old the shared Simpro read may get before a visible app re-asks, and how
// often an open app re-asks by itself.
const STALE_MS = 5 * 60 * 1000;
const REFRESH_MS = 10 * 60 * 1000;

module.exports = { MODES, inProgressMode, nextMode, LOCKED_NOTE, STALE_MS, REFRESH_MS };
