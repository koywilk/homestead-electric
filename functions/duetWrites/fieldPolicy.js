"use strict";
// fieldPolicy.js — which job fields `job.setField` (cc_set_job_field) may
// write, which it refuses because a named tool owns them, and which it never
// touches (D9 ship 11, decision 9d: Koy ticks or strikes the ALLOW rows in the
// connector's docs/DUET-WRITES-FIELDS.md before batch C goes live).
//
// Every key `blankJob()` / `blankQuickJob()` creates, every scalar App.js writes
// through its job patch funnels (u({…}) / onUpdateJob / saveJob — the 2026-11-03
// scan), and the keys the other Duet planners write is classified here, ONE
// row each. scripts/duet-field-undo-test.js fails the build when a blankJob
// key has no row, so a future default can't slip through unclassified.
//
// Classes:
//   allow — a scalar with no derived side effect in the app: notes, flags,
//           misc dates, My Day "dismissed" booleans. Written as ONE dotted
//           data.<key> through jobWrite(); the push / email it can set off is
//           named on the row and in every answer.
//   owned — a named Duet tool already writes it the app's way (status, dates,
//           inspection, QC, prep, people, info, sections, items); refused with
//           "use <tool>".
//   deny  — never from here: ids, Simpro / import stamps, caches, arrays and
//           maps, derived fields, finance / sign-off flags, the temp-ped lane,
//           anything with no app writer. Refused with the reason.
// Unknown keys are refused too (a typo can't invent a field).
//
// Pure: no Firebase import. Validators: bool strict; text ≤ 2000 chars with
// control characters stripped (needs.js cleanText — the app's textareas store
// the text raw, so no escapeHtml here); dates in YYYY-MM-DD or M/D/YYYY stored
// as M/D/YYYY (stages.js toMdy, the DateInp rule); urls https?:// ≤ 2000.
// "" clears a text / date / url field (the app's own clear).
const { cleanText } = require("./needs.js");
const { toMdy } = require("./stages.js");
const { jobGate } = require("./jobItems.js");

const refuse = (why) => ({ refused: why });
const MAX_TEXT = 2000;

// ── the table ───────────────────────────────────────────────────────────────
// { key, type, format, class, tool?, note, push?, quickOnly?, notQuick? }
const A = (key, type, format, note, extra) => ({ key, type, format, class: "allow", note, ...(extra || {}) });
const O = (key, type, format, tool, note) => ({ key, type, format, class: "owned", tool, note: note || "" });
const D = (key, type, format, note) => ({ key, type, format, class: "deny", note });

const POLICY = [
  // ── ALLOW (Koy approves each row — decision 9d) ───────────────────────────
  A("flagged", "boolean", "true | false", "the Flagged badge on a project's building cards; the app has no editor for it today; no push"),
  A("flagNote", "text", "free text ≤ 2000", "the note behind the Flagged badge; no push"),
  A("roughNotes", "text", "free text ≤ 2000", "the Rough tab's notes box (\"Document any changes from plans…\"); stored raw as the textarea does; no push"),
  A("finishNotes", "text", "free text ≤ 2000", "the Finish tab's notes box; stored raw; no push"),
  A("accessNote", "text", "free text ≤ 2000", "gate code / access note on the job (and on a quick job); no push"),
  A("notes", "text", "free text ≤ 2000", "a quick job's notes box; QUICK JOBS ONLY (a regular job has no such field)", { quickOnly: true }),
  A("scope", "text", "free text ≤ 2000", "a quick job's scope; QUICK JOBS ONLY", { quickOnly: true }),
  A("material", "text", "free text ≤ 2000", "a quick job's material line; QUICK JOBS ONLY", { quickOnly: true }),
  A("fourWayTargetDate", "date", "M/D/YYYY (input YYYY-MM-DD or M/D/YYYY; \"\" clears)", "the rough (4-way) inspection target date; My Day's inspection no-show reminder keys on it; no push, no GC email"),
  A("finalInspectionTargetDate", "date", "M/D/YYYY (\"\" clears)", "the final inspection target date; My Day's no-show reminder; no push, no GC email"),
  A("readyToInvoice", "boolean", "true | false", "the Ready-to-invoice flag My Day's invoice row reads; REGULAR JOBS ONLY (a quick job sets it through its sign-off buttons)", { notQuick: true, push: "ready_invoice — switched OFF in functions/index.js (READY_TO_INVOICE_PUSH = false), so nothing is sent" }),
  A("invoiceDismissed", "boolean", "true | false", "clears / restores My Day's invoice reminder; REGULAR JOBS ONLY", { notQuick: true }),
  A("matterportDismissed", "boolean", "true | false", "clears / restores My Day's Matterport reminder; no push"),
  A("roughDepositDismissed", "boolean", "true | false", "clears / restores My Day's rough deposit reminder (the STATUS select resets it to false on scheduled); no push"),
  A("finishDepositDismissed", "boolean", "true | false", "clears / restores My Day's finish deposit reminder; no push"),
  A("roughInvoiceDismissed", "boolean", "true | false", "clears / restores My Day's rough invoice reminder; no push"),
  A("finishInvoiceDismissed", "boolean", "true | false", "clears / restores My Day's finish invoice reminder; no push"),

  // ── OWNED (a named tool writes it the app's way) ──────────────────────────
  ...["name", "address", "gc", "phone", "gcContact", "gcContact2", "phone2", "customer", "simproNo", "simproQuoteNo", "division", "gcContactLead", "gcContactLead2"].map(k => O(k, "text", "the Job Info box", "cc_set_job_info", k === "simproNo" ? "conflict-checked against live jobs" : k === "division" ? "\"commercial\" | \"\"" : k.startsWith("gcContactLead") ? "a Simpro contact id (slot 1 / 2)" : "")),
  ...["foreman", "lead", "coordinator"].map(k => O(k, "text", "a team member's name (\"Unassigned\" for foreman)", "cc_set_job_people", "job_assigned / lead_assigned push")),
  ...["statusUpdate", "statusUpdateBy", "statusUpdateAt", "statusUpdateHistory"].map(k => O(k, k === "statusUpdateHistory" ? "array" : "text", k === "statusUpdateAt" ? "ISO" : "free text", "cc_set_status_update", "status_update push to foreman + coordinator")),
  ...["roughStatus", "finishStatus"].map(k => O(k, "enum", "\"\" | waiting_date | date_confirmed | scheduled | inprogress | waiting | complete", "cc_set_phase_status", "milestone_complete / job_hold pushes; the select's derived fields")),
  ...["roughOnHold", "finishOnHold", "roughScheduled", "finishScheduled", "roughStartConfirmed", "finishStartConfirmed"].map(k => O(k, "boolean", "derived by the STATUS select", "cc_set_phase_status")),
  ...["roughWaitingOn", "finishWaitingOn"].map(k => O(k, "text", "free text", "cc_set_phase_status", "the waitingOn argument")),
  ...["roughStatusDate", "finishStatusDate"].map(k => O(k, "date", "M/D/YYYY", "cc_set_phase_status", "also cc_set_schedule_dates")),
  ...["roughScheduledEnd", "finishScheduledEnd", "roughProjectedStart", "finishProjectedStart"].map(k => O(k, "date", "M/D/YYYY", "cc_set_schedule_dates", k.endsWith("ProjectedStart") ? "GC schedule email (gcNotify) on change" : "")),
  ...["roughNeedsSchedHard", "finishNeedsSchedHard"].map(k => O(k, "boolean", "true | false", "cc_set_schedule_dates")),
  ...["roughStage", "finishStage", "prepStage", "roughQCTaskFired"].map(k => O(k, k === "prepStage" ? "text" : k === "roughQCTaskFired" ? "boolean" : "enum", k.endsWith("Stage") && k !== "prepStage" ? "\"0%\" … \"100%\"" : "set by stageChangePlan", "cc_set_stage", "the app's own stageChangePlan side effects")),
  ...["qcStatus", "finishQcStatus"].map(k => O(k, "enum", "\"\" | needs | scheduled | completed | pass | fixed | passed_items | fail", "cc_set_qc_status", "qc_ready / qc_passed pushes")),
  ...["qcStatusDate", "finishQcStatusDate", "qcRtChoiceRough", "qcRtChoiceRoughBy", "qcRtChoiceRoughAt", "qcRtChoiceFinish", "qcRtChoiceFinishBy", "qcRtChoiceFinishAt"].map(k => O(k, "text", "set by the QC verdict", "cc_set_qc_status")),
  ...["roughInspectionResult", "finalInspectionResult"].map(k => O(k, "enum", "\"\" | pass | fail", "cc_set_inspection", "failed_inspection push; GC inspection email")),
  ...["roughInspectionAttempts", "finalInspectionAttempts"].map(k => O(k, "array", "attempt literals", "cc_set_inspection")),
  ...["roughInspectionItems", "finalInspectionItems"].map(k => O(k, "array", "[{id, text, done}]", "cc_inspection_items")),
  ...["prepChecklist", "prepNA"].map(k => O(k, "map", "{key: bool}", "cc_tick_prep", "prep_complete push")),
  ...["hiddenSections", "noPanelizedLighting", "noTapeLight"].map(k => O(k, k === "hiddenSections" ? "map" : "boolean", "Job Sections", "cc_set_job_section")),
  O("changeOrders", "array", "CO items", "cc_create_change_order / cc_edit_change_order / cc_set_co_status / cc_convert_co_to_trip"),
  O("returnTrips", "array", "trip items", "cc_create_return_trip / cc_update_return_trip"),
  ...["roughQuestions", "finishQuestions"].map(k => O(k, "map", "{upper, main, basement: [question]}", "cc_add_question / cc_answer_question / cc_reopen_question")),
  O("jobNotes", "array", "note items", "cc_add_job_note / cc_add_note_line / cc_edit_note_line / cc_archive_note / cc_delete_note"),
  O("jobNotesMigratedAt", "text", "ISO, stamped by the first note write", "cc_add_job_note"),
  ...["roughUpdates", "finishUpdates"].map(k => O(k, "array", "daily update entries", "cc_add_daily_update")),
  ...["roughPunch", "finishPunch", "qcPunch"].map(k => O(k, "map", "the punch tree", "cc_punch_done / cc_add_punch_item / cc_assign_punch_item / cc_punch_waiting / cc_void_punch_item / cc_edit_punch_item")),
  O("punchTicks", "map", "{itemId: slot}", "cc_punch_done", "the check-off slots — never the map"),
  ...["roughMaterials", "finishMaterials", "commMaterials"].map(k => O(k, "array", "material cards", "cc_add_material_card / cc_edit_material_card / cc_tick_material_card")),

  // ── DENY (never from here) ────────────────────────────────────────────────
  D("id", "text", "the doc id", "the job's id — never"),
  D("deleted", "boolean", "", "Duet never deletes or marks deleted"),
  ...["archived", "archivedAt", "archivedBy"].map(k => D(k, k === "archived" ? "boolean" : "text", "", "cc_archive_job is the only door (Duet's reversible shape, Koy to confirm)")),
  ...["projectGroupId", "projectRole", "simproLead", "simproFolder"].map(k => D(k, "text", "", "the project link — cc_create_project / cc_join_project / cc_create_building write it as a set")),
  ...["tempPed", "hasTempPed", "tempPedNumber", "tempPedStatus", "tempPedScheduledDate", "tempPedSignedOff", "tempPedSignedOffBy", "tempPedSignedOffDate", "tempPedPhotos", "tempPedOutAt", "tempPedReturnedAt", "tempPedReturnedBy", "tempPedPickupIgnore"].map(k => D(k, /Photos$/.test(k) ? "array" : /^(tempPed|hasTempPed|tempPedSignedOff|tempPedPickupIgnore)$/.test(k) ? "boolean" : "text", "", "the Temp Peds lane has its own flow (Temp Peds Out); no Duet writer")),
  ...["panelizedLighting", "homeRuns", "panelCounts", "tapeLights", "gcContacts", "gcContactLabels", "plSectionLabels", "matterportLinks", "uploadedFiles", "customLinks", "photos", "roughInstructions", "finishInstructions", "roughInspectionReports", "finalInspectionReports", "taskDueDates", "clearedTasks", "coDoneDismissed", "rtDoneDismissed", "electricalPanels", "breakerOverrides", "applAmps", "applLinks", "applSpecOk", "fieldMilestones", "roughTally", "finishTally", "roughPunchShares", "finishPunchShares", "questionShares", "roughPunchExternal", "finishPunchExternal", "qcPunchExternal", "designerQuestions", "prepOverride", "presence", "simproStockCache", "simproCostCentersCache"].map(k => D(k, /Labels$|Counts$|^panelizedLighting$|^homeRuns$|^taskDueDates$|^applSpecOk$|^fieldMilestones$|Tally$|Filter|^prepOverride$|^presence$|Cache$|^designerQuestions$|^applAmps$|^applLinks$|^breakerOverrides$|^electricalPanels$/.test(k) ? "map" : "array", "", k === "coDoneDismissed" || k === "rtDoneDismissed" ? "a list of dismissed CO / RT ids (My Day); arrays have their own tools or none" : k === "gcContacts" ? "Simpro's list, replaced on every pull" : k === "prepOverride" ? "the prep override is an audit stamp {on, by, at, note}" : k === "presence" ? "who has the job open — the app's own" : /Cache$/.test(k) ? "a Simpro cache" : "an array / map field — those have their own tools or none")),
  ...["roughPunchFilter", "roughPunchFilterLabel", "finishPunchFilter", "finishPunchFilterLabel", "questionsFilter"].map(k => D(k, "text", "", "a saved view filter on the job doc; the app's own")),
  ...["matterportLink", "matterportStatus", "matterportStatusDate"].map(k => D(k, "text", "", k === "matterportLink" ? "the app derives it from matterportLinks[0] — add the link in the Matterport section; GC matterport email" : "the Matterport select — no Duet writer yet; coordinator `matterport` push on complete")),
  ...["planLink", "redlineLink", "lightingLink", "panelLink", "qcLink"].map(k => D(k, "text", "", "a legacy default with no app writer (links live in customLinks / the sections)")),
  D("loadMappingNotes", "text", "", "a legacy default — the app writes homeRuns.loadMappingNotes, not this key"),
  ...["driveFolderId", "docPull", "simproSync", "simproSyncAt", "simproBusinessGroup", "imported_at", "_importedFromSimpro", "lastActivityAt", "updated_at"].map(k => D(k, "text", "", "a Drive / Simpro / import / server stamp")),
  ...["simproMargin", "simproMarginIsEst"].map(k => D(k, k === "simproMargin" ? "number" : "boolean", "", "the Scoreboard's live Simpro margin (dailySimproTotals writes it)")),
  ...["roughInspectionDate", "finalInspectionDate"].map(k => D(k, "text", "", "a blankJob default the app never writes")),
  ...["qcSignedOff", "qcSignedOffBy", "qcSignedOffDate", "signedOff", "signedOffBy", "signedOffDate", "readyToInvoiceDate", "invoiceSent", "jobAccount", "preLien"].map(k => D(k, /^(qcSignedOff|signedOff|invoiceSent|preLien)$/.test(k) ? "boolean" : "text", "", /invoice|preLien|jobAccount/i.test(k) ? "a finance flag — say the words" : "a sign-off stamp — the app's own buttons")),
  ...["readyToSchedule", "roughScheduledDate", "finishScheduledDate", "roughInProgressMode", "finishInProgressMode", "roughNeedsHardDate", "finishNeedsHardDate", "roughNeedsByStart", "roughNeedsByEnd", "finishNeedsByStart", "finishNeedsByEnd", "prepStartDate", "finishStartDate", "isHot"].map(k => D(k, /^(readyToSchedule|roughNeedsHardDate|finishNeedsHardDate|isHot)$/.test(k) ? "boolean" : "text", "", /ScheduledDate$/.test(k) ? "legacy schedule date — gcNotify still emails the GC when it changes" : /InProgressMode$/.test(k) ? "the In-Progress pill's sub-mode (applyScheduleMode) — no Duet writer" : k === "isHot" ? "fires the GC \"house is hot\" email" : "a legacy scheduling default with no current writer")),
  ...["lightingSystem", "lightingSystemOther", "lightingSystemLocked"].map(k => D(k, k === "lightingSystemLocked" ? "boolean" : "text", "", "drives the Panelized Lighting section (Lutron-only switches) — say the words")),
  ...["quickJob", "quickJobType", "quickJobStatus", "quickJobDate", "quickJobEndDate", "type"].map(k => D(k, k === "quickJob" ? "boolean" : "text", "", "the quick-job / record type machinery — the app's own buttons")),
];

const BY_KEY = Object.fromEntries(POLICY.map(r => [r.key, r]));
if (Object.keys(BY_KEY).length !== POLICY.length) throw new Error("fieldPolicy: a key is listed twice");
const ALLOWED = POLICY.filter(r => r.class === "allow").map(r => r.key);
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;

// The class of one key, with the words the refusal uses.
function classify(key) {
  const k = String(key == null ? "" : key).trim();
  if (!KEY.test(k)) return { key: k, class: "unknown", why: "field must be a plain key like flagNote (letters, digits, _)." };
  const row = BY_KEY[k];
  if (!row) return { key: k, class: "unknown", why: `${k} isn't a Command Center job field Duet knows — unknown keys are refused so a typo can't invent one. Allowed: ${ALLOWED.join(", ")}.` };
  if (row.class === "owned") return { ...row, why: `${k} is written by ${row.tool} — use that tool (it does it the app's way${row.note ? `: ${row.note}` : ""}). Nothing was written.` };
  if (row.class === "deny") return { ...row, why: `${k} isn't a field Duet may set: ${row.note}. Nothing was written.` };
  return { ...row };
}

// value → the stored value for an allowed row, or a refusal.
function validate(row, value) {
  if (row.type === "boolean") {
    if (typeof value !== "boolean") return refuse(`${row.key} must be true or false.`);
    return { v: value };
  }
  if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") return refuse(`${row.key} must be text (or "" / null to clear it).`);
  const raw = value == null ? "" : String(value);
  if (row.type === "date") { const d = toMdy(raw, row.key); if (d.refused) return d; return { v: d.v == null ? "" : d.v }; }
  if (row.type === "url") {
    const s = raw.trim();
    if (s && !/^https?:\/\/\S+$/.test(s)) return refuse(`${row.key} must be a full https:// link (or "" to clear it).`);
    if (s.length > MAX_TEXT) return refuse(`${row.key} is over ${MAX_TEXT} characters.`);
    return { v: s };
  }
  const t = cleanText(raw);
  if (raw.length > MAX_TEXT) return refuse(`${row.key} is over ${MAX_TEXT} characters — shorten it (nothing is cut silently).`);
  return { v: t };
}

const sameVal = (a, b) => (a == null ? "" : a) === (b == null ? "" : b) || JSON.stringify(a) === JSON.stringify(b);

// job.setField — args: { field, value }; ctx: { job }. jobWrite's shape.
function planSetField(args, ctx) {
  const a = args || {};
  const cls = classify(a.field);
  if (cls.class !== "allow") return refuse(cls.why);
  const g = jobGate(ctx.job); if (g) return g;
  const d = ctx.job.data;
  if (cls.quickOnly && d.quickJob !== true) return refuse(`${cls.key} is a quick-job field; ${d.name || "this job"} isn't a quick job. Nothing was written.`);
  if (cls.notQuick && d.quickJob === true) return refuse(`${cls.key} on a quick job is set by its sign-off buttons (quickJobStatus moves with it) — not from here. Nothing was written.`);
  const val = validate(cls, a.value); if (val.refused) return val;
  const prev = d[cls.key] === undefined ? null : d[cls.key];
  if (sameVal(prev, val.v)) return { noop: true, result: { field: cls.key, [cls.key]: val.v, type: cls.type } };
  return {
    fields: { [cls.key]: val.v }, before: { [cls.key]: prev }, after: { [cls.key]: val.v },
    result: { field: cls.key, type: cls.type, format: cls.format, from: prev, to: val.v, [cls.key]: val.v, pushTo: [], pushes: cls.push ? [{ push: cls.push.split(" — ")[0], note: cls.push }] : [], note: cls.note },
  };
}

module.exports = { POLICY, BY_KEY, ALLOWED, classify, validate, planSetField, MAX_TEXT };
