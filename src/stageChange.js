// stageChange.js — a job's Rough / Finish STAGE change (the % select) and the
// phase / QC / prep status lists, in ONE place.
//
// WHY THIS EXISTS (v606, 2026-11-03, Duet write access — connector decision D9, ship 7)
// --------------------------------------------------------------------------
// Claude Duet can now set a job's stage, phase status, inspection result, QC
// status and prep checklist from a chat, through the duetApi Cloud Function. A
// stage change written by the server has to set EXACTLY the side effects the
// app's own stage select sets (QC task fired, Job Prep complete, Matterport
// needed, QC needs scheduling, the status) — or the job tells two stories. So
// stageChangePlan (v549 / v553, moved here from App.js byte for byte) lives
// here, and the Cloud Function requires a byte-identical copy. qcTripPlan (the
// QC verdict's "what goes on the return trip") is the app's own function copied
// here verbatim; App.js keeps its own copy and scripts/duet-stages-test.js
// pins the two texts equal. The three status lists carry value / label / hasDate
// only (the app's lists also carry colours); the same test pins them to App.js.
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js), the Cloud
// Functions require a copy, and scripts/stage-change-test.js +
// scripts/duet-stages-test.js drive the exact file that ships. COPIED to
// functions/stageChange.js by scripts/stage-change-sync.js — edit THIS file
// only; the prebuild refuses to build while the two differ.
//
// Nothing here touches Firestore. Callers decide the write.
"use strict";

// ROUGH_STATUSES / FINISH_STATUSES (App.js): value → label, hasDate. "" is the
// unset option; the legacy "invoice" value still exists in data.
const ROUGH_STATUSES = [
  { value: "", label: "— set status —" },
  { value: "waiting_date", label: "Awaiting Start Date" },
  { value: "date_confirmed", label: "Start Date Set", hasDate: true },
  { value: "scheduled", label: "Scheduled", hasDate: true },
  { value: "inprogress", label: "In Progress", hasDate: true },
  { value: "waiting", label: "On Hold" },
  { value: "complete", label: "Complete" },
];
const FINISH_STATUSES = ROUGH_STATUSES;
// QC_STATUSES (App.js): rough qcStatus / finish finishQcStatus.
const QC_STATUSES = [
  { value: "", label: "— set status —" },
  { value: "needs", label: "QC Needs to be Scheduled" },
  { value: "scheduled", label: "QC Scheduled", hasDate: true },
  { value: "completed", label: "QC Completed", hasDate: true },
  { value: "pass", label: "QC Pass" },
  { value: "fixed", label: "QC Items Fixed — Pass" },
  { value: "passed_items", label: "QC Passed with Items" },
  { value: "fail", label: "QC Fail" },
];
// PREP_CHECKLIST_ITEMS (App.js): the Job Prep ticks, in order.
const PREP_CHECKLIST_ITEMS = [
  { key: "redlinePlans", label: "Redline Plans Up to Date" },
  { key: "cabinetPlans", label: "Cabinet Plans Received" },
  { key: "applianceSpecs", label: "Appliance Specs Received" },
  { key: "plansUploaded", label: "Plans Uploaded to App & SimPro" },
  { key: "readyToHandOff", label: "Ready to Hand Off to Foreman" },
];
const ROUGH_STAGES = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
const FINISH_STAGES = ROUGH_STAGES;
// getStatusDef (App.js): the option for a value, or {}.
const getStatusDef = (arr, val) => arr.find(x=>x.value===val)||{};
// parseStage (App.js, the same one-liner — App.js keeps its own; pinned equal).
const parseStage = (s) => s==='Scheduled' ? 1 : (parseInt(s)||0);

// v549 (UX batch 2, "say what happened"): one pure plan for a Rough / Finish
// stage change, shared by both stage selects so the screen can say what the
// change set off. Keeps every side effect the inline handlers had (QC task,
// prep, invoice fire/reset, Matterport, QC flip, status) and adds Koy's two
// 2026-10-16 calls: (1) dropping below 85% clears Ready to invoice unless the
// other phase still justifies it (an invoice already sent has
// readyToInvoice=false anyway, so it is never touched); (2) a job on hold keeps
// its hold and its status — only 100% (complete) moves it. Returns
// { blocked:{count, text} } when 100% is refused, else
// { patch, title, lines } where lines are the plain-words summary.
// Pure; exercised by scripts/stage-change-test.js.
// v553 (Koy, 2026-10-17: "nobody uses the notification ready to invoice anyway"):
// the Ready to invoice nudge is retired everywhere — the stage % no longer turns it on
// or off, and no push, My Day task, Tasks section or Kanban card reads it. Invoicing is
// tracked from Simpro (functions/simproSync.js). The old fields stay on the jobs.
const READY_TO_INVOICE_ALERTS = false;
function stageChangePlan(job, phase, v, counts = {}) {
  const j = job || {};
  const pct = parseInt(v) || 0;
  const P = phase === "finish" ? "Finish" : "Rough";
  const foreman = (j.foreman || "").trim();
  const firstName = foreman ? foreman.split(" ")[0] : "";
  const today = new Date().toLocaleDateString("en-US");
  const lines = [];
  if (phase === "finish") {
    if (v === "100%") {
      const fo = counts.openPunch || 0, qo = counts.openQc || 0;
      if (fo + qo > 0) {
        const parts = [];
        if (fo > 0) parts.push(`${fo} finish punch item${fo !== 1 ? "s" : ""}`);
        if (qo > 0) parts.push(`${qo} QC item${qo !== 1 ? "s" : ""}`);
        return { blocked: { count: fo + qo, text: `${parts.join(" and ")} still open on ${j.name || "this job"}.` } };
      }
    }
    const onHold = !!j.finishOnHold || j.finishStatus === "waiting";
    const invoiceFire = READY_TO_INVOICE_ALERTS && pct >= 85 && !j.finishInvoiceFired ? { finishInvoiceFired: true, finishInvoiceDismissed: false, readyToInvoice: true, readyToInvoiceDate: today } : {};
    const invoiceReset = READY_TO_INVOICE_ALERTS && pct < 85 ? { finishInvoiceFired: false, finishInvoiceDismissed: false } : {};
    const invoiceClear = READY_TO_INVOICE_ALERTS && pct < 85 && j.readyToInvoice && (parseStage(j.roughStage) < 85 || j.invoiceSent) ? { readyToInvoice: false, readyToInvoiceDate: "" } : {};
    const finishQcFlip = (pct >= 80 || v === "100%") && !j.finishQcStatus ? { finishQcStatus: "needs" } : {};
    const status = v === "100%" ? { finishStatus: "complete", ...(onHold ? { finishOnHold: false } : {}) } : (pct > 0 && !onHold ? { finishStatus: "inprogress" } : {});
    const patch = { finishStage: v, ...invoiceFire, ...invoiceReset, ...invoiceClear, ...finishQcFlip, ...status };
    if (invoiceFire.readyToInvoice) lines.push(`Ready to invoice: on. The office${firstName ? " and " + firstName : ""} get a push.`);
    if (invoiceClear.readyToInvoice === false) lines.push(`Ready to invoice is off.${j.readyToInvoiceDate ? " It was on since " + j.readyToInvoiceDate + "." : ""}`);
    if (finishQcFlip.finishQcStatus) lines.push("Final QC walk: needs scheduling now.");
    if (v === "100%") lines.push("Finish marked complete.");
    else if (onHold && pct > 0) lines.push("Still on hold. Take it off in Status when the crew is back.");
    return { patch, title: lines.length ? `${P} ${v} · here's what that set off` : `${P} ${v}`, lines: lines.length ? lines : ["Nothing else changed."] };
  }
  if (v === "100%" && (counts.openPunch || 0) > 0) {
    const n = counts.openPunch;
    return { blocked: { count: n, text: `${n} punch item${n !== 1 ? "s are" : " is"} still open on ${j.name || "this job"}.` } };
  }
  const onHold = !!j.roughOnHold || j.roughStatus === "waiting";
  const qcFire = pct >= 80 && !j.roughQCTaskFired ? { roughQCTaskFired: true } : {};
  const prepDone = pct > 0 && j.prepStage !== "Job Prep Complete" ? { prepStage: "Job Prep Complete" } : {};
  const invoiceFire = READY_TO_INVOICE_ALERTS && pct >= 85 && !j.roughInvoiceFired ? { roughInvoiceFired: true, roughInvoiceDismissed: false, readyToInvoice: true, readyToInvoiceDate: today } : {};
  const invoiceReset = READY_TO_INVOICE_ALERTS && pct < 85 ? { roughInvoiceFired: false, roughInvoiceDismissed: false } : {};
  const invoiceClear = READY_TO_INVOICE_ALERTS && pct < 85 && j.readyToInvoice && parseStage(j.finishStage) < 85 ? { readyToInvoice: false, readyToInvoiceDate: "" } : {};
  const matterportFlip = (pct >= 85 && parseStage(j.finishStage) === 0 && !j.matterportStatus && !(j.matterportLinks?.length || j.matterportLink) && !j.hiddenSections?.matterport) ? { matterportStatus: "needs" } : {};
  const qcFlip = ((pct >= 80 && !j.roughQCTaskFired) || (v === "100%" && j.roughStatus !== "complete")) && !j.qcStatus ? { qcStatus: "needs" } : {};
  const status = v === "100%" ? { roughStatus: "complete", ...(onHold ? { roughOnHold: false } : {}) } : (pct > 0 && !onHold ? { roughStatus: "inprogress" } : {});
  const patch = { roughStage: v, ...qcFire, ...prepDone, ...invoiceFire, ...invoiceReset, ...invoiceClear, ...matterportFlip, ...qcFlip, ...status };
  if (invoiceFire.readyToInvoice) lines.push(`Ready to invoice: on. The office${firstName ? " and " + firstName : ""} get a push.`);
  if (invoiceClear.readyToInvoice === false) lines.push(`Ready to invoice is off.${j.readyToInvoiceDate ? " It was on since " + j.readyToInvoiceDate + "." : ""}`);
  if (qcFlip.qcStatus) lines.push("QC walk: needs scheduling now.");
  else if (qcFire.roughQCTaskFired && j.qcStatus) {
    const q = QC_STATUSES.find(s => s.value === j.qcStatus);
    lines.push(`QC walk: already ${(q ? q.label.replace(/^QC /, "") : j.qcStatus).toLowerCase()}${j.qcStatusDate ? " (" + j.qcStatusDate + ")" : ""}, no change.`);
  }
  if (matterportFlip.matterportStatus) lines.push("Matterport scan: needed now.");
  if (prepDone.prepStage) lines.push("Job Prep marked complete.");
  if (v === "100%") lines.push("Rough marked complete.");
  else if (onHold && pct > 0) lines.push("Still on hold. Take it off in Status when the crew is back.");
  return { patch, title: lines.length ? `${P} ${v} · here's what that set off` : `${P} ${v}`, lines: lines.length ? lines : ["Nothing else changed."] };
}

// v549 (UX batch 2): what a non-clean QC verdict would put on a return trip.
// Only open QC-walk items (fromQC, not done, not voided) from THIS phase's
// punch — a rough verdict no longer sweeps finish items onto the rough trip.
// existingIdx = an open QC trip already on the job (fromQCFail, or the legacy
// "QC Fail" scope prefix); newItems = the items that trip doesn't carry yet
// (matched by originItemId). Pure; exercised by scripts/qc-trip-test.js.
function qcTripPlan(job, phase) {
  const j = job || {};
  const punch = phase === "finish" ? j.finishPunch : j.roughPunch;
  const items = [];
  if (punch && typeof punch === "object") {
    const floors = [...["upper", "main", "basement"].map(k => punch[k]), ...((punch.extras || []).map(e => e && e.key ? punch[e.key] : null))].filter(Boolean);
    const take = (i) => { if (i && i.fromQC && !i.done && !i.voided) items.push({ ...i, __phase: phase }); };
    floors.forEach(fl => {
      (fl.general || []).forEach(take);
      (fl.rooms || []).forEach(r => (r.items || []).forEach(take));
      (fl.hotcheck || []).forEach(take);
    });
  }
  const trips = Array.isArray(j.returnTrips) ? j.returnTrips : [];
  const existingIdx = trips.findIndex(r => r && !r.signedOff && (r.fromQCFail === true || (typeof r.scope === "string" && r.scope.startsWith("QC Fail"))));
  const onTrip = existingIdx >= 0 ? new Set((trips[existingIdx].punch || []).map(p => p && p.originItemId).filter(Boolean)) : new Set();
  const newItems = existingIdx >= 0 ? items.filter(i => !onTrip.has(i.id)) : items;
  return { items, existingIdx, newItems, nextTripNo: trips.length + 1 };
}
module.exports = { ROUGH_STATUSES, FINISH_STATUSES, QC_STATUSES, PREP_CHECKLIST_ITEMS, ROUGH_STAGES, FINISH_STAGES, getStatusDef, parseStage, READY_TO_INVOICE_ALERTS, stageChangePlan, qcTripPlan };
