"use strict";
// stageSync.js — app → Simpro job status sync (2026-11-11).
//
// WHY THIS EXISTS (Josh, 2026-11-11: seven stages, same names in the app and
// Simpro; "the foreman sets them in the app, a nightly sync copies them to
// Simpro"). 14 of 48 open residential jobs sat at different stages in the two
// systems because Simpro's status is changed by hand and nobody goes back.
//
// The app has no single stage field. The Job Board works a job's section out
// from roughStatus / finishStatus, the %, prep and what is still open, so this
// file TRANSLATES a job into one Simpro status. It never copies a field.
//
// Pure: no Firebase, no network. functions/index.js (scheduledSimproStageSync)
// reads the jobs and Simpro, calls planAll, and does the Simpro writes;
// scripts/stage-sync-test.js and scripts/stage-sync-dryrun.js drive this exact
// file. The sync never writes a job in the app.
const { isPunchListJob } = require("./punchListStage.js");

// The Simpro job status codes the sync sets (Simpro › Setup › Status Codes).
// Josh's seven, plus "Ready to Schedule" for a job that is prepped but has no
// rough date yet (calling that "Scheduled" would not be true).
const STATUS = {
  planPrep:        { id: 153, name: "Job - Plan Prep" },
  readyToSchedule: { id: 156, name: "Job - Ready to Schedule" },
  scheduled:       { id: 152, name: "Job - Scheduled" },
  roughIn:         { id: 329, name: "Job - Rough-In" },
  roughInComplete: { id: 330, name: "Job - Rough-In Complete" },
  finish:          { id: 331, name: "Job - Finish" },
  punchList:       { id: 332, name: "Job - Punch List" },
  readyToInvoice:  { id: 154, name: "Job - Ready to Invoice" },
};

// Simpro statuses the sync leaves alone when it finds them on a job. The office
// sets these by hand and the app has no matching fact to replace them with.
//   money: Ready to Invoice, Receipts Reviewed ("money stages stay in Simpro")
//   holds: Waiting on GC, Waiting on Material, Change Order Pending
const MONEY_IDS = [154, 157];
const HOLD_IDS = [333, 69, 263];

// Simpro only lists a job as open while its Stage is one of these.
const OPEN_SIMPRO_STAGES = ["Pending", "Progress"];

// Same five items as App.js PREP_CHECKLIST_ITEMS (pinned by stage-sync-test.js).
const PREP_KEYS = ["redlinePlans", "cabinetPlans", "applianceSpecs", "plansUploaded", "readyToHandOff"];

// App.js allPrepChecked / prepClearedToStart.
function prepCleared(j) {
  if (j.prepOverride && j.prepOverride.on) return true;
  if (j.prepChecklist || j.prepNA) {
    const c = j.prepChecklist || {}, na = j.prepNA || {};
    return PREP_KEYS.every(k => c[k] || na[k]);
  }
  return (j.prepStage || "") === "Job Prep Complete";
}

// App.js effRS / effFS for a full job: the stored status, else worked out from the %.
const pctStatus = (stage) => { const p = parseInt(stage) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };
const effRS = (j) => j.roughStatus || pctStatus(j.roughStage);
const effFS = (j) => j.finishStatus || pctStatus(j.finishStage);

const NOT_STARTED = ["", "waiting_date", "date_confirmed", "scheduled"];

// Which of the seven a job is at, from where the work actually is (the
// dashboard's rule since v532: finish status, then rough status, wins; unfinished
// prep only counts while nothing has started). Returns one of
//   { key, section }   a Simpro status to set
//   { hold, section }  on hold in the app: Simpro is left alone
//   { skip }           a kind of job the sync does not cover, in plain words
function appStageOf(job) {
  const j = job || {};
  if (j.type === "quote") return { skip: "quote, not a job yet" };
  if (j.tempPed) return { skip: "temp ped" };
  if (j.quickJob) return { skip: "quick job" };
  if (j.division === "commercial") return { skip: "commercial job" };
  const rs = effRS(j), fs = effFS(j);

  // Finish side has started (or is on hold).
  if (fs === "waiting" || j.finishOnHold) {
    if (fs !== "complete" && fs !== "invoice") return { hold: true, section: "Finish — On Hold" };
  }
  if (fs === "inprogress" || fs === "complete" || fs === "invoice") {
    if (isPunchListJob(j, fs)) return { key: "punchList", section: "Punch List" };
    if (fs === "inprogress") return { key: "finish", section: "Finish In Progress" };
    return { key: "readyToInvoice", section: "Completed" };
  }

  // Rough side.
  if (rs === "complete") return { key: "roughInComplete", section: "In Between" };
  if (rs === "waiting" || j.roughOnHold) return { hold: true, section: "Rough — On Hold" };
  if (rs === "inprogress") return { key: "roughIn", section: "Rough In Progress" };

  // Nothing started yet.
  if (NOT_STARTED.includes(rs)) {
    if (!prepCleared(j)) return { key: "planPrep", section: "Pre Job Prep" };
    // A finish-only job (no rough) with a finish date counts as dated too.
    if ([rs, fs].some(s => s === "scheduled" || s === "date_confirmed")) return { key: "scheduled", section: "Rough — Not Started (date set)" };
    return { key: "readyToSchedule", section: "Rough — Not Started (no date)" };
  }
  return { skip: `status the sync does not know (${rs || fs})` };
}

// Simpro ranks its status codes (Priority) and refuses a move DOWN that order
// through the API (HTTP 422) unless the target status code has "Ignore Status
// Priority" ticked in Simpro's setup. Koy (2026-11-11) chose not to touch that
// setup. The per-job override Simpro's API team describes (AutoAdjustStatus:false)
// was tried on Rose #889 three ways that night and Simpro refused each time, so
// the sync does not send it. What the sync does instead:
//   - a move UP the order is sent; that needs nothing from Simpro
//   - a move down from one STAGE to an earlier stage is never tried: Simpro says
//     the job is further along than the app does, so a person decides
//   - a move down FROM a status that is not a stage (a job parked on "Material
//     Deposit Paid" or "Matterport", which Simpro ranks above every stage) is
//     marked `downhill`. The live run still tries it, so it starts working by
//     itself if the tick is ever made; until then Simpro refuses and the job is
//     reported as blocked: someone moves it by hand in Simpro once.
const STAGE_IDS = Object.values(STATUS).map(s => s.id);

// What to do for ONE app job, given its Simpro job row ({ID, Name, Stage, Status:{ID,Name}})
// from the open-jobs list, or null when Simpro does not list it as open, and
// Simpro's status ranks ({ [statusId]: priority }; missing = send plain).
//   { action: "set", toId, toName, fromId, fromName, section, downhill? }
//   { action: "same", toName, section }
//   { action: "skip", reason, conflict? }   conflict = a person should look
function planOne(job, sj, priorities) {
  const a = appStageOf(job);
  if (a.skip) return { action: "skip", reason: a.skip };
  if (a.hold) return { action: "skip", reason: `on hold in the app (${a.section})` };
  if (!sj) return { action: "skip", reason: "not open in Simpro (closed, archived or not found)" };
  const target = STATUS[a.key];
  const fromId = (sj.Status && typeof sj.Status.ID === "number") ? sj.Status.ID : null;
  const fromName = String((sj.Status && sj.Status.Name) || "").trim() || "(no status)";
  if (fromId === target.id) return { action: "same", toName: target.name, section: a.section };
  if (MONEY_IDS.includes(fromId)) return { action: "skip", conflict: true, reason: `Simpro says "${fromName}", app says ${a.section}: left for the office` };
  if (HOLD_IDS.includes(fromId)) return { action: "skip", conflict: true, reason: `Simpro hold "${fromName}", app says ${a.section}: left for the office` };
  const set = { action: "set", toId: target.id, toName: target.name, fromId, fromName, section: a.section };
  const pr = priorities || {};
  const fromP = pr[fromId], toP = pr[target.id];
  if (typeof fromP !== "number" || typeof toP !== "number" || toP > fromP) return set;   // up the order (or rank unknown): plain
  if (STAGE_IDS.includes(fromId)) return { action: "skip", conflict: true, reason: `Simpro is further along ("${fromName}"), app says ${a.section}: fix whichever is wrong` };
  return { ...set, downhill: true };
}

const simproNoOf = (j) => (j && j.type === "quote") ? "" : String((j && j.simproNo) || "").trim();
const live = (j) => !!j && !j.archived && !j.archivedAt && !j.deleted;

// The whole night's plan. jobs = app jobs ({id, ...data}); simproOpen = Simpro's
// open jobs keyed by job number; priorities = Simpro's status ranks. Returns
//   rows        one per app job the sync looked at (set / same / skip + why)
//   simproOnly  jobs in progress in Simpro with no app job (a person should look)
//   counts      totals by outcome
function planAll(jobs, simproOpen, priorities) {
  const open = simproOpen || {};
  const rows = [];
  const bySn = {};
  (jobs || []).filter(live).forEach(j => {
    const kind = appStageOf(j);
    if (kind.skip) return;                       // quick jobs, temp peds, commercial, quotes: not in v1, not listed
    const sn = simproNoOf(j);
    if (!sn) { rows.push({ id: j.id, sn: "", name: String(j.name || "").trim(), action: "skip", conflict: true, reason: "no Simpro # on the job" }); return; }
    (bySn[sn] = bySn[sn] || []).push(j);
  });
  Object.entries(bySn).forEach(([sn, list]) => {
    if (list.length > 1) {                        // never guess which one speaks for the Simpro job
      list.forEach(j => rows.push({ id: j.id, sn, name: String(j.name || "").trim(), action: "skip", conflict: true, reason: `${list.length} app jobs share Simpro #${sn}` }));
      return;
    }
    const j = list[0];
    rows.push({ id: j.id, sn, name: String(j.name || "").trim(), ...planOne(j, open[sn] || null, priorities) });
  });
  // In progress in Simpro, but no live app job carries that number (any kind of job).
  const known = new Set((jobs || []).map(simproNoOf).filter(Boolean));
  const simproOnly = Object.values(open)
    .filter(sj => sj && sj.Stage === "Progress" && !known.has(String(sj.ID)))
    .map(sj => ({ sn: String(sj.ID), name: String(sj.Name || "").trim(), status: String((sj.Status && sj.Status.Name) || "").trim() }));
  const counts = { set: 0, same: 0, skip: 0, conflict: 0, downhill: 0, simproOnly: simproOnly.length };
  rows.forEach(r => { counts[r.action]++; if (r.conflict) counts.conflict++; if (r.downhill) counts.downhill++; });
  return { rows, simproOnly, counts };
}

// Simpro's refusal of a move down its status order: expected for `downhill`
// rows, so the report says "blocked" (with what to do) rather than "failed".
function isPriorityBlock(httpStatus, bodyText) {
  return httpStatus === 422 && /Ignore Status Priority|Check priority/i.test(String(bodyText || ""));
}

// Simpro's /setup/statusCodes/projects/ rows → { [id]: priority }.
function priorityMap(rows) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { if (r && typeof r.ID === "number" && typeof r.Priority === "number") out[r.ID] = r.Priority; });
  return out;
}

// What to tell a person about a move Simpro refused.
function blockedNote(r) {
  return `Simpro will not let the sync move a job off "${r.fromName}". Set it to "${r.toName}" by hand in Simpro once.`;
}

module.exports = { STAGE_IDS, priorityMap, blockedNote, STATUS, MONEY_IDS, HOLD_IDS, OPEN_SIMPRO_STAGES, PREP_KEYS, prepCleared, effRS, effFS, appStageOf, planOne, planAll, simproNoOf, isPriorityBlock };
