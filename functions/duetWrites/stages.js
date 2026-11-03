"use strict";
// Duet write access (D9), ship 7: a job's phase status, stage, inspections,
// QC status, prep checklist and schedule dates. PURE planners — given the live
// job doc and what Duet asked, they return either a refusal or exactly what to
// write, copied line for line from the app's own handlers in src/App.js
// (mapped 2026-11-03, main a1dbe8d / ship-6 4ce4750):
//   • the Rough / Finish STATUS select (~L33764 / ~L34172): the exact patch —
//     <p>Status, <p>OnHold, <p>Scheduled, the <p>StartConfirmed rule,
//     <p>StatusDate kept only when the status takes a date, <p>ProjectedStart
//     written back as it is, <p>DepositDismissed:false on scheduled, and for
//     ROUGH the matterportFlip + qcFlip on the first move to complete;
//     complete refused while the phase's punch has open items (rough: the
//     rough tree; finish: finish + Legacy QC) — counted on the job as the app
//     SHOWS it, with the punchTicks slots laid over the trees (normalizeJob =
//     applyPunchTicks(...)). WaitingOnInput (~L48885): trimmed, 140 chars.
//   • the STAGE select → applyStage (~L33128) → stageChangePlan: the app's
//     own function, moved to src/stageChange.js and required here as the
//     byte-identical functions/stageChange.js; the counts are punchOpen on the
//     shown trees, the patch is written whole, a blocked plan refuses.
//   • Pass / Fail (~L33870 rough, ~L34258 final): a new non-empty result
//     appends an attempt {id, date:"M/D/YYYY", result, items:[{text}], by};
//     clearing writes only the result. InspFailAgain (~L48916): while the
//     result is "fail", appends {…, result:"fail", items: open only, repeat:
//     true}, result unchanged. The failed-items checkbox (~L33903): done
//     flipped, and on ROUGH every returnTrips[].punch[] entry with
//     fromRoughInspectionId === id mirrors `done` in the same write (~L34288
//     final: no mirror). "+ Item" (~L33950): {id, text, done:false}.
//     → Create Return Trip (~L33975 rough / ~L34339 final) and → Add N to the
//     return trip (inspItemsNotOnTrip ~L48933): the literals below.
//   • the QC pickers → runQcVerdict (~L33146): base {qcStatus, qcStatusDate}
//     (finish: finishQcStatus / finishQcStatusDate); fail / passed_items ask
//     "return trip or crew" — here a required `then`; "rt" makes the QC trip
//     from qcTripPlan's items (the app's function, copied verbatim in
//     stageChange.js) or adds the missing ones to the open QC trip; both
//     answers stamp qcRtChoice<P> / …By / …At.
//   • prepItemPatch (~L64663): both maps written whole.
//   • saveNeedsSchedModal (~L32289): start / end / hard in one patch, hard
//     clears the end; the PROJ. START DateInp (~L33855): + status waiting_date
//     when blank; the CONFIRM button (~L33860): + status date_confirmed, or
//     back to waiting_date when un-confirming a date_confirmed phase.
// Dates are stored the way DateInp stores them (~L8080): M/D/YYYY. Duet may
// send YYYY-MM-DD; it is converted the same way DateInp converts the browser's
// value. A patch key whose value is undefined is dropped, as the app's
// sanitize() drops it before every save.
// No Firestore here: api.js runs the transaction, scripts/duet-stages-test.js
// drives these with fixtures.
const ST = require("../stageChange.js");
const { applyPunchTicks } = require("../punchTicks.js");
const { newItemId, mdy, jobGate } = require("./jobItems.js");
const { ME, cleanText } = require("./needs.js");
const { punchOpen, punchStamp } = require("./punch.js");

const refuse = (why) => ({ refused: why });
const PHASES = ["rough", "finish"];
const WHICH = { rough: "rough", final: "final" };
const STATUS_VALUES = ST.ROUGH_STATUSES.map(s => s.value);
const QC_VALUES = ST.QC_STATUSES.map(s => s.value);
const PREP_KEYS = ST.PREP_CHECKLIST_ITEMS.map(i => i.key);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const sameId = (a, b) => a != null && String(a) === String(b);
// The app's sanitize(): drop undefined before a write.
function sanitize(obj) {
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === "object") return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, sanitize(v)]));
  return obj;
}
const prior = (data, k) => (data[k] === undefined ? null : data[k]);
// A field already holds the value? Absent counts as "" and as false (the app
// treats job.x || "" and !!job.x the same way).
const holds = (data, k, v) => {
  const cur = data[k];
  if (cur === undefined) return v === "" || v === false || v === null;
  return JSON.stringify(cur) === JSON.stringify(v);
};
const changedKeys = (fields, data) => Object.keys(fields).filter(k => !holds(data, k, fields[k]));
const auditOf = (fields, data) => { const before = {}, after = {}; Object.keys(fields).forEach(k => { before[k] = prior(data, k); after[k] = fields[k]; }); return { before, after }; };

// DateInp (App.js ~L8080): the browser's YYYY-MM-DD → M/D/YYYY for storage.
// Duet may send either; "" clears.
function toMdy(v, what) {
  if (v == null) return { v: undefined };
  const s = String(v).trim();
  if (s === "") return { v: "" };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m && !d) return refuse(`${what} must be YYYY-MM-DD or M/D/YYYY (or "" to clear it).`);
  const y = parseInt(m ? m[1] : d[3], 10), mo = parseInt(m ? m[2] : d[1], 10), day = parseInt(m ? m[3] : d[2], 10);
  const dt = new Date(y, mo - 1, day);
  if (isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) return refuse(`${what} isn't a real date.`);
  return { v: `${mo}/${day}/${y}` };
}
// What the app shows: the trees with the check-off slots laid over them.
const shownJob = (data) => applyPunchTicks(data);
const phaseOf = (a) => { const p = String(a.phase || "").toLowerCase(); return PHASES.includes(p) ? p : null; };
const P = (phase) => (phase === "finish" ? "Finish" : "Rough");
const holdRe = /hold|waiting/i;
// functions/index.js onJobUpdate: job_hold fires when NEITHER phase read hold /
// waiting before and one does now; milestone_complete on a status that becomes
// complete; qc_ready on qcStatus → needs; qc_passed on qcStatus → pass / fixed
// (rough qcStatus only — finishQcStatus has no push); prep_complete on the
// server's own all-five-ticked rule (prepNA does NOT count there).
function holdPush(data, fields) {
  const before = holdRe.test(data.roughStatus || "") || holdRe.test(data.finishStatus || "");
  const afterR = "roughStatus" in fields ? fields.roughStatus : data.roughStatus, afterF = "finishStatus" in fields ? fields.finishStatus : data.finishStatus;
  const after = holdRe.test(afterR || "") || holdRe.test(afterF || "");
  return !before && after;
}
function statusPushes(data, fields) {
  const to = [];
  for (const p of PHASES) { const k = `${p}Status`; if (k in fields && fields[k] === "complete" && data[k] !== "complete") to.push({ push: "milestone_complete", to: ["coordinator"], why: `${P(p)} complete` }); }
  if (holdPush(data, fields)) to.push({ push: "job_hold", to: ["coordinator"], why: "the job reads on hold / waiting now" });
  if ("qcStatus" in fields && fields.qcStatus === "needs" && data.qcStatus !== "needs") to.push({ push: "qc_ready", to: ["foreman", "coordinator"], why: "QC walk needs scheduling (not on a commercial job)" });
  const pass = (v) => v === "pass" || v === "fixed";
  if ("qcStatus" in fields && pass(fields.qcStatus) && !pass(data.qcStatus)) to.push({ push: "qc_passed", to: ["foreman", "coordinator"], why: "QC passing (not on a commercial job)" });
  return to;
}
const PREP_SERVER = ["redlinePlans", "cabinetPlans", "applianceSpecs", "plansUploaded", "readyToHandOff"];
// functions/index.js allPrepDone: the five ticks (prepNA ignored), else prepStage.
const allPrepDoneServer = (d) => (d.prepChecklist ? PREP_SERVER.every(k => !!d.prepChecklist[k]) : (d.prepStage || "") === "Job Prep Complete");
// App.js allPrepChecked (v388): N/A counts as handled.
const allPrepChecked = (d) => { if (d.prepChecklist || d.prepNA) { const c = d.prepChecklist || {}, na = d.prepNA || {}; return PREP_KEYS.every(k => c[k] || na[k]); } return (d.prepStage || "") === "Job Prep Complete"; };

// ── 1. phase status (the STATUS select) ──────────────────────────────────────
// args: { jobId, phase: rough|finish, status, statusDate?, waitingOn? }
function planSetPhaseStatus(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = phaseOf(a); if (!phase) return refuse("phase must be rough or finish.");
  const data = ctx.job.data, name = data.name || "that job";
  const v = a.status == null ? null : String(a.status);
  if (!STATUS_VALUES.includes(v)) return refuse(`status must be one of ${STATUS_VALUES.map(s => (s === "" ? '"" (unset)' : s)).join(", ")}.`);
  const p = phase, k = (s) => `${p}${s}`;
  const shown = shownJob(data);
  if (v === "complete") {
    // The select's guard, counted on the job as the app shows it (slots applied).
    if (phase === "rough") {
      const open = punchOpen(shown.roughPunch);
      if (open > 0) return refuse(`Cannot mark Rough as complete — ${open} open punch item${open !== 1 ? "s" : ""} remaining on ${name}. Clear them first. Nothing was written.`);
    } else {
      const finishOpen = punchOpen(shown.finishPunch), qcOpen = punchOpen(shown.qcPunch);
      if (finishOpen + qcOpen > 0) {
        const parts = [];
        if (finishOpen > 0) parts.push(`${finishOpen} finish punch item${finishOpen !== 1 ? "s" : ""}`);
        if (qcOpen > 0) parts.push(`${qcOpen} QC item${qcOpen !== 1 ? "s" : ""}`);
        return refuse(`Cannot mark Finish as complete — ${parts.join(" and ")} still open on ${name}. Clear them first. Nothing was written.`);
      }
    }
  }
  const def = ST.getStatusDef(ST.ROUGH_STATUSES, v);
  const job = data;
  // The select's u() patch, key for key (rough adds the two flips).
  const patch = {
    [k("Status")]: v, [k("OnHold")]: v === "waiting", [k("Scheduled")]: v === "scheduled",
    [k("StartConfirmed")]: v === "date_confirmed" ? true : (v === "scheduled" || v === "inprogress" || v === "complete" || v === "waiting") ? job[k("StartConfirmed")] : false,
    [k("StatusDate")]: def.hasDate ? job[k("StatusDate")] : "",
    [k("ProjectedStart")]: v === "scheduled" ? job[k("ProjectedStart")] : job[k("ProjectedStart")],
    ...(v === "scheduled" ? { [k("DepositDismissed")]: false } : {}),
  };
  let matterportFlip = {}, qcFlip = {};
  if (phase === "rough") {
    matterportFlip = (v === "complete" && job.roughStatus !== "complete" && ST.parseStage(job.finishStage) === 0 && !job.matterportStatus && !((job.matterportLinks && job.matterportLinks.length) || job.matterportLink) && !(job.hiddenSections && job.hiddenSections.matterport)) ? { matterportStatus: "needs" } : {};
    qcFlip = (v === "complete" && job.roughStatus !== "complete" && !job.qcStatus) ? { qcStatus: "needs" } : {};
    Object.assign(patch, matterportFlip, qcFlip);
  }
  // Duet's two optional extras, each the app's own neighbouring control.
  let statusDate;
  if (a.statusDate != null) {
    if (!def.hasDate) return refuse(`${def.label || v || "that status"} doesn't take a date — only Start Date Set, Scheduled and In Progress do. Nothing was written.`);
    const d = toMdy(a.statusDate, "statusDate"); if (d.refused) return d;
    statusDate = d.v; patch[k("StatusDate")] = d.v;
  }
  let waitingOn;
  if (a.waitingOn != null) {
    if (typeof a.waitingOn !== "string") return refuse("waitingOn must be text.");
    if (v !== "waiting" && v !== "waiting_date") return refuse("waitingOn goes with waiting (On Hold) or waiting_date (Awaiting Start Date) — the app shows the box only then. Nothing was written.");
    waitingOn = cleanText(a.waitingOn).replace(/\s+/g, " ").trim().slice(0, 140);
    patch[k("WaitingOn")] = waitingOn;
  }
  const fields = sanitize(patch);
  const changed = changedKeys(fields, data);
  const from = String(data[k("Status")] || "");
  if (!changed.length) return { noop: true, result: { phase, status: v, label: def.label || "", message: `${P(phase)} is already ${def.label || "unset"} — nothing to change.` } };
  const { before, after } = auditOf(fields, data);
  const pushes = statusPushes(data, fields);
  const gcEmail = v === "complete" && from !== "complete" ? [`${P(phase)} complete (gcNotify)`] : [];
  return { fields, before, after,
    result: { phase, from, to: v, label: def.label || "", changed, statusDate: fields[k("StatusDate")], waitingOn, onHold: fields[k("OnHold")], startConfirmed: fields[k("StartConfirmed")],
      matterportFlipped: !!matterportFlip.matterportStatus, qcFlipped: !!qcFlip.qcStatus, pushes, pushTo: [...new Set(pushes.flatMap(x => x.to))], gcEmail: gcEmail.length ? gcEmail : undefined } };
}

// ── 2. stage (the % select) ──────────────────────────────────────────────────
// args: { jobId, phase, stage: "0%"…"100%" }
function planSetStage(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = phaseOf(a); if (!phase) return refuse("phase must be rough or finish.");
  const data = ctx.job.data;
  let v = a.stage == null ? "" : String(a.stage).trim();
  if (/^\d{1,3}$/.test(v)) v = v + "%";
  const stages = phase === "finish" ? ST.FINISH_STAGES : ST.ROUGH_STAGES;
  if (!stages.includes(v)) return refuse(`stage must be one of ${stages.join(", ")}.`);
  const shown = shownJob(data);
  // applyStage: the counts from the shown trees, then the app's own plan.
  const counts = phase === "finish" ? { openPunch: punchOpen(shown.finishPunch), openQc: punchOpen(shown.qcPunch) } : { openPunch: punchOpen(shown.roughPunch) };
  const plan = ST.stageChangePlan(shown, phase, v, counts);
  if (plan.blocked) return refuse(`${P(phase)} can't be ${v} yet. ${plan.blocked.text} Nothing was written.`);
  const fields = sanitize(plan.patch);
  const changed = changedKeys(fields, data);
  const stageKey = `${phase}Stage`;
  if (!changed.length) return { noop: true, result: { phase, stage: v, message: `${P(phase)} is already ${v} — nothing to change.` } };
  const { before, after } = auditOf(fields, data);
  const pushes = statusPushes(data, fields);
  if ("prepStage" in fields && !allPrepDoneServer(data) && allPrepDoneServer({ ...data, ...fields })) pushes.push({ push: "prep_complete", to: ["foreman", "coordinator"], why: "Job Prep marked complete (a job with no prep checklist map)" });
  const gcEmail = `${phase}Status` in fields && fields[`${phase}Status`] === "complete" && data[`${phase}Status`] !== "complete" ? [`${P(phase)} complete (gcNotify)`] : [];
  return { fields, before, after,
    result: { phase, from: String(data[stageKey] || ""), to: v, changed, title: plan.title, lines: plan.lines, status: fields[`${phase}Status`], pushes, pushTo: [...new Set(pushes.flatMap(x => x.to))], gcEmail: gcEmail.length ? gcEmail : undefined } };
}

// ── 3. inspection result (Pass / Fail / clear / Failed again) ────────────────
// args: { jobId, which: rough|final, result?: pass|fail|clear, failedAgain?: true }
const inspKeys = (w) => ({ result: `${w}InspectionResult`, attempts: `${w}InspectionAttempts`, items: `${w}InspectionItems`, reports: `${w}InspectionReports`, target: w === "rough" ? "fourWayTargetDate" : "finalInspectionTargetDate" });
const whichOf = (a) => { const w = String(a.which || "").toLowerCase(); return WHICH[w] || null; };
// odRealAtts (App.js ~L49222) → inspFailCount: how many real fails the app counts.
function odRealAtts(list, result) {
  const out = [];
  (list || []).forEach(a => { if (!a || !a.result) return; const p = out[out.length - 1]; if (p && p.result === a.result && p.date === a.date && !a.repeat) return; out.push({ ...a }); });
  if (!result && out.length) out.pop();
  return out;
}
const inspFailCount = (attempts, result) => odRealAtts(attempts, result).filter(a => a.result === "fail").length;
const attemptId = (nowIso, attempts) => newItemId(Date.parse(nowIso), (attempts || []).map(x => x && x.id));
function planSetInspection(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const w = whichOf(a); if (!w) return refuse("which must be rough (the 4-way) or final.");
  const K = inspKeys(w), data = ctx.job.data, name = data.name || "that job";
  const cur = String(data[K.result] || "");
  const atts = Array.isArray(data[K.attempts]) ? data[K.attempts] : [];
  const items = Array.isArray(data[K.items]) ? data[K.items] : [];
  const what = w === "rough" ? "rough (4-way) inspection" : "final inspection";
  const date = mdy(ctx.nowIso, ctx.tz);
  if (a.failedAgain === true) {
    // InspFailAgain: only while the result reads "fail"; result unchanged.
    if (a.result != null && String(a.result) !== "fail") return refuse("failedAgain logs another failure of an inspection that already reads failed — leave result out or say fail.");
    if (cur !== "fail") return refuse(`The ${what} on ${name} reads ${cur ? `"${cur}"` : "unset"}, not failed — Failed again is only offered while it reads failed. Mark it fail first (that logs failure number 1). Nothing was written.`);
    const attempt = { id: attemptId(ctx.nowIso, atts), date, result: "fail", items: items.filter(x => x && !x.done).map(x => ({ text: x.text || "" })), by: ME, repeat: true };
    const next = [...atts, attempt];
    const n = inspFailCount(next, cur);
    return { fields: { [K.attempts]: next }, before: { [K.attempts]: atts }, after: { [K.attempts]: attempt }, itemId: attempt.id,
      result: { which: w, result: cur, failedAgain: true, failureNumber: n, attemptId: attempt.id, date, itemsOnAttempt: attempt.items.length, attempts: next.length,
        pushes: [{ push: "failed_inspection", to: ["foreman", "coordinator"], why: "a new failed attempt" }], pushTo: ["foreman", "coordinator"], gcEmail: ["repeat fail (gcNotify)"] } };
  }
  const r = a.result == null ? "" : String(a.result).toLowerCase();
  if (!["pass", "fail", "clear"].includes(r)) return refuse("result must be pass, fail or clear (or failedAgain:true while it reads failed).");
  const newResult = r === "clear" ? "" : r;
  if (newResult === cur) return { noop: true, result: { which: w, result: cur, message: cur ? `The ${what} already reads ${cur} — nothing to change (say clear to clear it).` : `The ${what} has no result — nothing to change.` } };
  // The Pass / Fail button: the result, plus a new attempt when moving INTO pass / fail.
  const patch = { [K.result]: newResult };
  let attempt = null;
  if (newResult && newResult !== cur) {
    attempt = { id: attemptId(ctx.nowIso, atts), date, result: newResult, items: items.map(x => ({ text: (x && x.text) || "" })), by: ME };
    patch[K.attempts] = [...atts, attempt];
  }
  const before = { [K.result]: prior(data, K.result), ...(attempt ? { [K.attempts]: atts } : {}) };
  const after = { [K.result]: newResult, ...(attempt ? { [K.attempts]: attempt } : {}) };
  const pushes = newResult === "fail" ? [{ push: "failed_inspection", to: ["foreman", "coordinator"], why: "a new failed attempt" }] : [];
  const gcEmail = newResult ? [`${w === "rough" ? "4-way" : "final"} inspection ${newResult} (gcNotify)`] : [];
  return { fields: patch, before, after, itemId: attempt ? attempt.id : undefined,
    result: { which: w, from: cur, to: newResult, attemptAdded: !!attempt, attemptId: attempt ? attempt.id : undefined, date: attempt ? date : undefined, itemsOnAttempt: attempt ? attempt.items.length : undefined, attempts: (patch[K.attempts] || atts).length,
      failureNumber: newResult === "fail" ? inspFailCount(patch[K.attempts], newResult) : undefined, openFailedItems: items.filter(x => x && !x.done).length,
      pushes, pushTo: [...new Set(pushes.flatMap(x => x.to))], gcEmail: gcEmail.length ? gcEmail : undefined,
      note: newResult === "fail" && !items.length ? "No failed items on the list yet — add what the inspector called with cc_inspection_items, then make the trip with cc_create_inspection_trip." : undefined } };
}

// ── 4. failed items: add / tick ──────────────────────────────────────────────
// args: { jobId, which, op: add|setDone, text?, itemId?, done? }
function planInspectionItems(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const w = whichOf(a); if (!w) return refuse("which must be rough (the 4-way) or final.");
  const K = inspKeys(w), data = ctx.job.data, name = data.name || "that job";
  const cur = String(data[K.result] || "");
  const what = w === "rough" ? "4-way" : "final";
  if (cur !== "fail") return refuse(`The ${what} inspection on ${name} reads ${cur ? `"${cur}"` : "unset"} — the Failed Items box only shows while it reads failed. Nothing was written.`);
  const items = Array.isArray(data[K.items]) ? data[K.items] : [];
  const op = String(a.op || "");
  if (op === "add") {
    // "+ Item" ({id, text:"", done:false}) and the text typed into it, in one write.
    const text = cleanText(a.text).replace(/\s+/g, " ").trim();
    if (!text) return refuse("A failed item needs text (what the inspector called).");
    const item = { id: newItemId(Date.parse(ctx.nowIso), items.map(x => x && x.id)), text, done: false };
    const next = [...items, item];
    return { fields: { [K.items]: next }, before: { [K.items]: items }, after: { [K.items]: item }, itemId: item.id,
      result: { which: w, op, inspectionItemId: item.id, text, number: next.length, openFailedItems: next.filter(x => !x.done).length, pushTo: [],
        note: "The open return trip from this inspection (if any) does not get this item on its own — cc_create_inspection_trip adds the missing ones, as the app's → Add N to the return trip does." } };
  }
  if (op !== "setDone") return refuse("op must be add or setDone.");
  if (typeof a.done !== "boolean") return refuse("done must be true or false.");
  const i = items.findIndex(x => x && sameId(x.id, a.itemId));
  if (i < 0) return refuse(`No ${what} failed item with id ${a.itemId} on ${name} (ids come from cc_job_status). Nothing was written.`);
  const it = items[i];
  if (!!it.done === a.done) return { noop: true, result: { which: w, op, inspectionItemId: String(it.id), done: a.done, text: String(it.text || "").slice(0, 160), message: `Already ${a.done ? "done" : "open"} — nothing to change.` } };
  const next = items.slice(); next[i] = { ...it, done: a.done };
  const fields = { [K.items]: next };
  const before = { [K.items]: items }, after = { [K.items]: next[i] };
  let mirrored = 0;
  if (w === "rough" && it.id) {
    // Mirror the toggle to any RT punch entry made from this 4-way item.
    const trips = Array.isArray(data.returnTrips) ? data.returnTrips : [];
    const rtBefore = [], rtAfter = [];
    const nextTrips = trips.map(rt => {
      if (!rt || !Array.isArray(rt.punch)) return rt;
      let touched = false;
      const punch = rt.punch.map(p => {
        if (p && p.fromRoughInspectionId === it.id && !!p.done !== a.done) { touched = true; mirrored++; rtBefore.push({ rtId: rt.id, entry: p }); const np = { ...p, done: a.done }; rtAfter.push({ rtId: rt.id, entry: np }); return np; }
        return p;
      });
      return touched ? { ...rt, punch } : rt;
    });
    if (mirrored) { fields.returnTrips = nextTrips; before.returnTrips = rtBefore; after.returnTrips = rtAfter; }
  }
  return { fields, before, after, itemId: String(it.id),
    result: { which: w, op, inspectionItemId: String(it.id), done: a.done, text: String(it.text || "").slice(0, 160), openFailedItems: next.filter(x => x && !x.done).length, returnTripEntriesMirrored: mirrored, pushTo: [] } };
}

// ── 5. the return trip from failed items ─────────────────────────────────────
// args: { jobId, which }
// inspItemsNotOnTrip (App.js ~L48933), verbatim.
const inspItemsNotOnTrip = (items, rt, linkKey) => {
  const punch = (rt && rt.punch) || [];
  const norm = (t) => String(t || "").trim().toLowerCase();
  const ids = new Set(linkKey ? punch.map(p => p && p[linkKey]).filter(Boolean) : []);
  const texts = new Set(punch.map(p => norm(p && p.text)));
  return (items || []).filter(x => x && !x.done && norm(x.text) && !ids.has(x.id) && !texts.has(norm(x.text)));
};
function tripIdMinter(nowIso, trips) {
  const taken = new Set();
  (trips || []).forEach(t => { if (t && t.id != null) taken.add(String(t.id)); (t && Array.isArray(t.punch) ? t.punch : []).forEach(p => p && p.id != null && taken.add(String(p.id))); (t && Array.isArray(t.photos) ? t.photos : []).forEach(p => p && p.id != null && taken.add(String(p.id))); });
  return () => { const id = newItemId(Date.parse(nowIso), [...taken]); taken.add(id); return id; };
}
function planCreateInspectionTrip(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const w = whichOf(a); if (!w) return refuse("which must be rough (the 4-way) or final.");
  const K = inspKeys(w), data = ctx.job.data, name = data.name || "that job";
  const items = Array.isArray(data[K.items]) ? data[K.items] : [];
  const open = items.filter(x => x && !x.done);
  const what = w === "rough" ? "4-way" : "final";
  if (!open.length) return refuse(`No open failed ${what} inspection items on ${name} — the app offers the return trip only while some are open. Nothing was written.`);
  const trips = Array.isArray(data.returnTrips) ? data.returnTrips : [];
  const scope = w === "rough" ? "Failed 4-way inspection items" : "Failed final inspection items";
  const flag = w === "rough" ? "fromFailedRough" : "fromFailedFinal";
  const existingRT = trips.find(r => r && !r.signedOff && (r[flag] === true || r.scope === scope)) || null;
  const mint = tripIdMinter(ctx.nowIso, trips);
  const stamp = punchStamp(ctx.nowIso, ctx.tz);
  if (existingRT) {
    const notOnTrip = inspItemsNotOnTrip(items, existingRT, w === "rough" ? "fromRoughInspectionId" : undefined);
    const idx = trips.indexOf(existingRT);
    if (!notOnTrip.length) return { noop: true, result: { which: w, rtId: String(existingRT.id), number: idx + 1, itemsOnTrip: (existingRT.punch || []).length, message: `Already on a return trip (#${idx + 1}, ${(existingRT.punch || []).length} item${(existingRT.punch || []).length === 1 ? "" : "s"}) — see the Return Trips tab. Nothing to add.` } };
    // → Add N to the return trip
    const added = notOnTrip.map(x => (w === "rough" ? { id: mint(), text: x.text, done: false, ...stamp, fromRoughInspectionId: x.id || "" } : { id: mint(), text: x.text, done: false, ...stamp }));
    const nextRT = { ...existingRT, punch: [...(existingRT.punch || []), ...added] };
    const nextTrips = trips.map(r => (r && r.id === existingRT.id ? nextRT : r));
    return { fields: sanitize({ returnTrips: nextTrips }), before: { returnTrips: existingRT }, after: { returnTrips: { rtId: existingRT.id, added } }, itemId: String(existingRT.id),
      result: { which: w, rtId: String(existingRT.id), number: idx + 1, appended: true, itemsAdded: added.length, itemsOnTrip: nextRT.punch.length, scope: nextRT.scope, pushTo: [] } };
  }
  // → Create Return Trip: the app's literal for each inspection.
  const reports = (Array.isArray(data[K.reports]) ? data[K.reports] : []).map(r => ({ ...r, fromInspection: w }));
  let newRT;
  if (w === "rough") {
    // Carry EVERY 4-way item (done and open), preserving done state, with the backlink.
    newRT = { id: mint(), date: "", scope, material: "",
      punch: items.map(x => ({ id: mint(), text: x.text, done: !!x.done, ...stamp, fromRoughInspectionId: x.id || "" })),
      photos: reports, fromFailedRough: true,
      assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "",
      needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "" };
  } else {
    newRT = { id: mint(), date: "", scope, material: "",
      punch: open.map(x => ({ id: mint(), text: x.text, done: false, ...stamp })),
      photos: reports, fromFailedFinal: true,
      assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "",
      needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "" };
  }
  const clean = sanitize(newRT);
  return { fields: { returnTrips: [...trips, clean] }, before: { returnTrips: null }, after: { returnTrips: clean }, itemId: clean.id,
    result: { which: w, rtId: clean.id, number: trips.length + 1, appended: false, scope, itemsOnTrip: clean.punch.length, openItemsCarried: open.length, doneItemsCarried: w === "rough" ? clean.punch.length - open.length : 0, reportsCarried: reports.length, rtStatus: "", needsSchedule: true, pushTo: [],
      note: "The trip has no rtStatus (the app's literal writes none) and needs a date — cc_update_return_trip sets rtStatus / date / assignee." } };
}

// ── 6. QC status (the QC pickers → runQcVerdict) ─────────────────────────────
// args: { jobId, phase: rough|finish, status, statusDate?, then?: rt|crew }
function planSetQcStatus(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = phaseOf(a); if (!phase) return refuse("phase must be rough or finish.");
  const data = ctx.job.data, name = data.name || "that job";
  const v = a.status == null ? null : String(a.status);
  if (!QC_VALUES.includes(v)) return refuse(`status must be one of ${QC_VALUES.map(s => (s === "" ? '"" (unset)' : s)).join(", ")}.`);
  const def = ST.getStatusDef(ST.QC_STATUSES, v);
  const sKey = phase === "finish" ? "finishQcStatus" : "qcStatus", dKey = phase === "finish" ? "finishQcStatusDate" : "qcStatusDate";
  const patch = { [sKey]: v, [dKey]: def.hasDate ? data[dKey] : "" };
  if (a.statusDate != null) {
    if (!def.hasDate) return refuse(`${def.label || v || "that status"} doesn't take a date — only QC Scheduled and QC Completed do. Nothing was written.`);
    const d = toMdy(a.statusDate, "statusDate"); if (d.refused) return d;
    patch[dKey] = d.v;
  }
  const asks = v === "fail" || v === "passed_items";
  const then = a.then == null ? null : String(a.then);
  if (asks && then !== "rt" && then !== "crew") return refuse(`${def.label} asks "who fixes the QC items?" — say then: "rt" (make / add to the QC return trip) or then: "crew" (the crew on site has it). Nothing was written.`);
  if (!asks && then != null) return refuse(`then only goes with fail or passed_items (${def.label || "that status"} doesn't ask). Nothing was written.`);
  const before = {}, after = {};
  const result = { phase, from: String(data[sKey] || ""), to: v, label: def.label || "", statusDate: patch[dKey] };
  if (asks) {
    const shown = shownJob(data);
    const plan = ST.qcTripPlan(shown, phase);
    const trips = Array.isArray(data.returnTrips) ? data.returnTrips : [];
    const mint = tripIdMinter(ctx.nowIso, trips);
    const stamp = punchStamp(ctx.nowIso, ctx.tz);
    const toClone = (x) => ({
      id: mint(), text: x.text || "", done: false, fromQC: true,
      severity: x.severity, originItemId: x.id, originPhase: x.__phase,
      ...stamp,
      photos: Array.isArray(x.photos) ? x.photos.slice() : [],
      materialNeeded: x.materialNeeded || "", materialSource: x.materialSource || "",
    });
    result.then = then; result.openQcItems = plan.items.length;
    if (then === "rt") {
      if (plan.existingIdx >= 0) {
        const no = plan.existingIdx + 1, rt = trips[plan.existingIdx];
        result.rtId = String(rt.id); result.rtNumber = no;
        if (plan.newItems.length) {
          const clones = plan.newItems.map(toClone);
          const nextRT = { ...rt, punch: [...(rt.punch || []), ...clones] };
          patch.returnTrips = trips.map((r, i) => (i === plan.existingIdx ? nextRT : r));
          before.returnTrips = rt; after.returnTrips = { rtId: rt.id, added: sanitize(clones) };
          result.tripAppended = true; result.itemsAdded = clones.length; result.itemsOnTrip = nextRT.punch.length;
        } else {
          result.tripAppended = false; result.itemsAdded = 0; result.itemsOnTrip = (rt.punch || []).length;
          result.tripNote = `Return Trip #${no} already has every open QC item. Nothing added.`;
        }
      } else {
        const newRT = {
          id: mint(), date: "", scope: v === "fail" ? "QC Fail — return trip needed" : "QC Items — return trip",
          material: "", punch: plan.items.map(toClone),
          photos: [], assignedTo: "",
          signedOff: false, signedOffBy: "", signedOffDate: "",
          needsSchedule: true, needsScheduleDate: "",
          rtScheduled: false, scheduledDate: "",
          rtStatus: "needs", fromQCFail: true,
        };
        patch.returnTrips = [...trips, newRT];
        before.returnTrips = null; after.returnTrips = sanitize(newRT);
        result.rtId = newRT.id; result.rtNumber = plan.nextTripNo; result.tripCreated = true; result.itemsOnTrip = newRT.punch.length; result.scope = newRT.scope; result.rtStatus = "needs";
      }
    } else {
      result.tripNote = "Logged: crew on site has it. No trip made.";
    }
    const Pp = P(phase);
    patch[`qcRtChoice${Pp}`] = then === "rt" ? "rt" : "crew";
    patch[`qcRtChoice${Pp}By`] = ME;
    patch[`qcRtChoice${Pp}At`] = ctx.nowIso;
  }
  const fields = sanitize(patch);
  const changed = changedKeys(fields, data);
  if (!changed.length) return { noop: true, result: { phase, status: v, label: def.label || "", message: `${P(phase)} QC is already ${def.label || "unset"} — nothing to change.` } };
  Object.keys(fields).forEach(k => { if (k !== "returnTrips") { before[k] = prior(data, k); after[k] = fields[k]; } });
  const pushes = phase === "rough" ? statusPushes(data, fields) : [];
  result.changed = changed; result.pushes = pushes; result.pushTo = [...new Set(pushes.flatMap(x => x.to))];
  if (phase === "finish") result.pushNote = "No push: the app has no push on finishQcStatus.";
  return { fields, before, after, itemId: result.rtId, result };
}

// ── 7. prep checklist tick ───────────────────────────────────────────────────
// args: { jobId, key, state: done|na|clear }
const prepItemState = (job, key) => ((job.prepChecklist || {})[key] ? "done" : ((job.prepNA || {})[key] ? "na" : "todo"));
// prepItemPatch (App.js ~L64663), verbatim.
const prepItemPatch = (job, key, target) => {
  const na = { ...(job.prepNA || {}) };
  if (target === "na") na[key] = true; else na[key] = false;
  return { prepChecklist: { ...(job.prepChecklist || {}), [key]: target === "done" }, prepNA: na };
};
function planTickPrep(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const key = String(a.key || "");
  if (!PREP_KEYS.includes(key)) return refuse(`key must be one of ${PREP_KEYS.join(", ")}.`);
  const state = String(a.state || "");
  if (!["done", "na", "clear"].includes(state)) return refuse("state must be done, na (not needed) or clear (outstanding).");
  const target = state === "clear" ? "todo" : state;
  const data = ctx.job.data;
  const label = (ST.PREP_CHECKLIST_ITEMS.find(i => i.key === key) || {}).label || key;
  const fields = prepItemPatch(data, key, target);
  const from = prepItemState(data, key);
  if (from === target && JSON.stringify(fields.prepChecklist) === JSON.stringify(data.prepChecklist || {}) && JSON.stringify(fields.prepNA) === JSON.stringify(data.prepNA || {})) return { noop: true, result: { key, label, state: from, message: `${label} is already ${from === "todo" ? "outstanding" : from === "na" ? "not needed" : "done"} — nothing to change.` } };
  const { before, after } = auditOf(fields, data);
  const next = { ...data, ...fields };
  const pushes = !allPrepDoneServer(data) && allPrepDoneServer(next) ? [{ push: "prep_complete", to: ["foreman", "coordinator"], why: "all five prep items ticked done (not on a commercial job)" }] : [];
  const checked = allPrepChecked(next);
  return { fields, before, after,
    result: { key, label, from, to: target, allPrepChecked: checked, allPrepDoneForPush: allPrepDoneServer(next), outstanding: PREP_KEYS.filter(k => prepItemState(next, k) === "todo"), pushes, pushTo: [...new Set(pushes.flatMap(x => x.to))],
      note: checked && !allPrepDoneServer(next) ? "Every item is handled (some as not needed) — the app shows prep clear, but the prep_complete push only fires when all five are ticked done (the server's rule ignores not-needed)." : undefined } };
}

// ── 8. schedule dates ────────────────────────────────────────────────────────
// args: { jobId, phase, statusDate?, scheduledEnd?, needsSchedHard?, projectedStart?, startConfirmed? }
function planSetScheduleDates(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = phaseOf(a); if (!phase) return refuse("phase must be rough or finish.");
  const data = ctx.job.data;
  const p = phase, k = (s) => `${p}${s}`;
  const given = ["statusDate", "scheduledEnd", "needsSchedHard", "projectedStart", "startConfirmed"].filter(x => a[x] != null);
  if (!given.length) return refuse("Say what to set: statusDate, scheduledEnd, needsSchedHard, projectedStart and/or startConfirmed.");
  const patch = {};
  const did = [];
  // (a) the schedule window — saveNeedsSchedModal writes all three from its state.
  if (a.statusDate != null || a.scheduledEnd != null || a.needsSchedHard != null) {
    const d1 = toMdy(a.statusDate, "statusDate"); if (d1.refused) return d1;
    const d2 = toMdy(a.scheduledEnd, "scheduledEnd"); if (d2.refused) return d2;
    if (a.needsSchedHard != null && typeof a.needsSchedHard !== "boolean") return refuse("needsSchedHard must be true or false.");
    const date = d1.v !== undefined ? d1.v : (data[k("StatusDate")] || "");
    const endDate = d2.v !== undefined ? d2.v : (data[k("ScheduledEnd")] || "");
    const hard = a.needsSchedHard != null ? a.needsSchedHard : !!data[k("NeedsSchedHard")];
    patch[k("StatusDate")] = date || "";
    patch[k("ScheduledEnd")] = hard ? "" : (endDate || "");
    patch[k("NeedsSchedHard")] = !!hard;
    did.push("window");
  }
  // (b) PROJ. START: the DateInp's patch (+ waiting_date when the status is blank).
  if (a.projectedStart != null) {
    const d = toMdy(a.projectedStart, "projectedStart"); if (d.refused) return d;
    patch[k("ProjectedStart")] = d.v;
    if (d.v && !data[k("Status")]) patch[k("Status")] = "waiting_date";
    did.push("projectedStart");
  }
  // (c) CONFIRM: the button, with an explicit value instead of a toggle.
  if (a.startConfirmed != null) {
    if (typeof a.startConfirmed !== "boolean") return refuse("startConfirmed must be true or false.");
    const confirm = a.startConfirmed;
    const statusNow = k("Status") in patch ? patch[k("Status")] : data[k("Status")];
    Object.assign(patch, { [k("StartConfirmed")]: confirm, ...(confirm ? { [k("Status")]: "date_confirmed" } : (statusNow === "date_confirmed" ? { [k("Status")]: "waiting_date" } : {})) });
    did.push("startConfirmed");
  }
  const fields = sanitize(patch);
  const changed = changedKeys(fields, data);
  if (!changed.length) return { noop: true, result: { phase, message: "Those dates are already set that way — nothing to change." } };
  const { before, after } = auditOf(fields, data);
  const pushes = statusPushes(data, fields);
  const gcEmail = k("ProjectedStart") in fields && !holds(data, k("ProjectedStart"), fields[k("ProjectedStart")]) ? [`${P(phase)} projected start changed (gcNotify)`] : [];
  return { fields, before, after,
    result: { phase, set: did, changed, statusDate: fields[k("StatusDate")], scheduledEnd: fields[k("ScheduledEnd")], needsSchedHard: fields[k("NeedsSchedHard")], projectedStart: fields[k("ProjectedStart")], startConfirmed: fields[k("StartConfirmed")], status: fields[k("Status")],
      pushes, pushTo: [...new Set(pushes.flatMap(x => x.to))], gcEmail: gcEmail.length ? gcEmail : undefined } };
}

module.exports = { STATUS_VALUES, QC_VALUES, PREP_KEYS, toMdy, sanitize, holds, odRealAtts, inspFailCount, inspItemsNotOnTrip, prepItemPatch, prepItemState, allPrepDoneServer, allPrepChecked, statusPushes,
  planSetPhaseStatus, planSetStage, planSetInspection, planInspectionItems, planCreateInspectionTrip, planSetQcStatus, planTickPrep, planSetScheduleDates };
