#!/usr/bin/env node
/* duet-stages-test.js — Duet write access (connector D9), ship 7: phase status,
 * stage, inspections, QC status, prep checklist, schedule dates.
 *
 * Drives functions/duetWrites/stages.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction holding real-shaped jobs. Proves, key for key against the
 * app's own handlers (src/App.js main a1dbe8d): every STATUS select value
 * incl. the StartConfirmed rule, the hasDate rule and the rough-only
 * Matterport / QC flips on the first complete; complete refused with open
 * punch, counted with the punchTicks slots laid over the tree (a slot-closed
 * item does not block); the stage through the app's OWN stageChangePlan
 * (src/stageChange.js = functions/stageChange.js); Pass / Fail with the
 * attempt literal, clear writes only the result, Failed again's repeat
 * literal + its guard; failed items add / tick with the return-trip mirror on
 * rough only; the → Create Return Trip literals (rough: every item, done kept,
 * backlink, reports; final: open only) and → Add N to the open trip; QC
 * statuses incl. then: rt | crew with the qcTripPlan clones and the
 * qcRtChoice<P> stamps; prep's two maps whole; date conversions; everything
 * else on the job byte-identical; the envelope; the audit's before / after
 * carrying every field written; only jobs + duet_writes ever written. Pins the
 * shared module's lists and qcTripPlan text to App.js. No Firebase import.
 * Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
const SG = require(path.join(root, "functions", "duetWrites", "stages.js"));
const ST = require(path.join(root, "functions", "stageChange.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const { applyPunchTicks } = require(path.join(root, "functions", "punchTicks.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";          // Tue 9:30 PM Mountain (Nov 3) — a UTC-vs-Mountain date trap on purpose
const TODAY = "2026-11-03";
const MDY = "11/3/2026";
const TZ = "America/Denver";
const USERS = [{ id: 1, name: "Koy", title: "office", access: "admin" }, { id: 3, name: "Colby", title: "foreman" }, { id: 4, name: "Keegan", title: "foreman" }];
const FORTH = "1772863862618", GONE = "1772863862620", CLEAN = "1772863862621", SLOT = "1772863862622", FINFAIL = "1772863862623";
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── real-shaped jobs ─────────────────────────────────────────────────────────
const PU1 = { id: "1761000000001", text: "Nail plates on the hall run", done: false, addedBy: "Keegan", addedAt: "2026-10-28", addedAtTs: "2026-10-28T15:00:00.000Z" };
const PR1 = { id: "1761000000003", text: "Box for the fan", done: false, fromQC: true, severity: "serious", addedBy: "Koy", addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:00:00.000Z", photos: [{ id: "ph1", url: "u" }], materialNeeded: "fan box", materialSource: "CED" };
const PR2 = { id: "1761000000004", text: "Old voided one", done: false, fromQC: true, voided: true, voidReason: "dup", addedBy: "Koy" };
const PR3 = { id: "1761000000005", text: "Done QC one", done: true, fromQC: true, checkedBy: "Colby", checkedAt: "11/2/2026", checkedAtTs: "2026-11-02T15:00:00.000Z", addedBy: "Koy" };
const PR4 = { id: "1761000000006", text: "Second open QC", done: false, fromQC: true, addedBy: "Koy", addedAt: "2026-11-02", addedAtTs: "2026-11-02T16:00:00.000Z" };
const PF1 = { id: "1761000000007", text: "Trim plates kitchen", done: false, fromQC: true, addedBy: "Colby", addedAt: "2026-11-02", addedAtTs: "2026-11-02T15:00:00.000Z" };
const PQ1 = { id: "1761000000009", text: "Legacy QC item", done: false, addedBy: "Josh" };
const EMPTY = () => ({ general: [], rooms: [], hotcheck: [], photos: [] });
const ROUGH = () => ({ upper: { general: [PU1], rooms: [{ id: "r_bath", name: "Primary bath", items: [PR1, PR2, PR3] }], hotcheck: [], photos: [] }, main: EMPTY(), basement: { general: [PR4], rooms: [], hotcheck: [], photos: [] }, extras: [] });
const ROUGH_CLEAN = () => ({ upper: { general: [{ ...PU1, done: true, checkedBy: "Keegan", checkedAt: "11/2/2026", checkedAtTs: "2026-11-02T15:00:00.000Z" }], rooms: [], hotcheck: [], photos: [] }, main: EMPTY(), basement: EMPTY(), extras: [] });
const FINISH = () => ({ upper: { general: [PF1], rooms: [], hotcheck: [], photos: [] }, main: EMPTY(), basement: EMPTY(), extras: [] });
const QC = () => ({ upper: { general: [PQ1], rooms: [], hotcheck: [], photos: [] }, main: EMPTY(), basement: EMPTY() });
const I1 = { id: "i1", text: "Nail plates missing hall", done: false }, I2 = { id: "i2", text: "Strap the feeder", done: true }, I3 = { id: "i3", text: "Box fill in the bath", done: false };
const ATT1 = { id: "a1", date: "11/1/2026", result: "fail", items: [{ text: "Nail plates missing hall" }, { text: "Strap the feeder" }], by: "Keegan" };
const RT_INSP = { id: "rt1", scope: "Failed 4-way inspection items", fromFailedRough: true, signedOff: false, photos: [], needsSchedule: true,
  punch: [{ id: "e1", text: "Nail plates missing hall", done: false, addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:00:00.000Z", fromRoughInspectionId: "i1" }, { id: "e2", text: "Strap the feeder", done: true, addedAt: "2026-11-01", addedAtTs: "2026-11-01T15:00:00.000Z", fromRoughInspectionId: "i2" }] };
const RT_OTHER = { id: "rt2", scope: "Other trip", rtStatus: "scheduled", signedOff: false, photos: [], punch: [{ id: "e9", text: "x", done: false, originItemId: PR1.id, originPhase: "rough" }] };
const RT_QC = { id: "rt3", scope: "QC Fail — return trip needed", fromQCFail: true, rtStatus: "needs", signedOff: false, photos: [], punch: [{ id: "c1", text: "Box for the fan", done: false, fromQC: true, originItemId: PR1.id, originPhase: "rough" }] };
const BASE = () => ({
  name: "Forth", foreman: "Keegan", lead: "Colby", archived: false, division: "residential",
  roughStatus: "inprogress", roughStatusDate: "11/5/2026", roughStartConfirmed: true, roughProjectedStart: "11/1/2026", roughScheduledEnd: "11/7/2026", roughNeedsSchedHard: false, roughOnHold: false, roughScheduled: false, roughWaitingOn: "",
  finishStatus: "", finishStatusDate: "", finishProjectedStart: "",
  roughStage: "75%", finishStage: "0%", roughQCTaskFired: false, prepStage: "Redline Plans Made",
  qcStatus: "scheduled", qcStatusDate: "11/4/2026", finishQcStatus: "",
  roughInspectionResult: "fail", roughInspectionAttempts: [ATT1], roughInspectionItems: [I1, I2, I3], roughInspectionReports: [{ id: "rp1", url: "https://x/report.pdf", name: "report.pdf", type: "application/pdf" }],
  finalInspectionResult: "", finalInspectionAttempts: [], finalInspectionItems: [],
  prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: false, plansUploaded: true, readyToHandOff: true }, prepNA: {},
  roughPunch: ROUGH(), finishPunch: FINISH(), qcPunch: QC(), returnTrips: [RT_INSP, RT_OTHER], punchTicks: {}, changeOrders: [{ id: "c1" }], jobNotes: [],
});
const DOC = (data) => ({ data, updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 605, w: "605.abcdefgh" });
const JOBS = () => ({
  ["jobs/" + FORTH]: DOC(BASE()),
  ["jobs/" + GONE]: DOC({ ...BASE(), name: "Gone", archived: true }),
  // CLEAN: no open punch anywhere, no QC status, no matterport → complete allowed with both flips; no StartConfirmed on finish.
  ["jobs/" + CLEAN]: DOC({ ...BASE(), name: "Clean", roughPunch: ROUGH_CLEAN(), finishPunch: { upper: EMPTY(), main: EMPTY(), basement: EMPTY(), extras: [] }, qcPunch: { upper: EMPTY(), main: EMPTY(), basement: EMPTY() }, qcStatus: "", qcStatusDate: "", returnTrips: [], roughStartConfirmed: undefined, roughStatusDate: undefined, roughProjectedStart: undefined, finishStatusDate: undefined, finishProjectedStart: undefined }),
  // SLOT: the tree says PU1 is open, the slot says done → the app shows it done → complete is allowed.
  ["jobs/" + SLOT]: DOC({ ...BASE(), name: "Slot", roughPunch: { upper: { general: [PU1], rooms: [], hotcheck: [], photos: [] }, main: EMPTY(), basement: EMPTY(), extras: [] }, punchTicks: { [PU1.id]: { done: true, by: "Koy", at: "11/3/2026", ts: "2026-11-03T21:00:00.000Z" } } }),
  // FINFAIL: a failed final with items; an open QC trip for the append case; finish status waiting (hold already on).
  ["jobs/" + FINFAIL]: DOC({ ...BASE(), name: "FinFail", finalInspectionResult: "fail", finalInspectionAttempts: [{ id: "f1", date: "11/2/2026", result: "fail", items: [], by: "Koy" }], finalInspectionItems: [{ id: "g1", text: "Cover plate missing", done: false }, { id: "g2", text: "Label the panel", done: true }], finalInspectionReports: [{ id: "rp2", url: "u2", name: "final.jpg" }], returnTrips: [RT_QC], finishStatus: "waiting", finishOnHold: true }),
});
const ctx = (over) => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: `${TODAY}T12:00:00`, users: USERS, tz: TZ, ...(over || {}) });
const jobCtx = (id, extra) => ctx({ job: { id, data: { ...JOBS()["jobs/" + id].data, ...(extra || {}) } } });
const J = (extra) => jobCtx(FORTH, extra);

// ── fake io ──────────────────────────────────────────────────────────────────
function fakeIo({ docs = JOBS(), recent = 0 } = {}) {
  const log = [];
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r) => { log.push(["create", r.path]); throw new Error("create must never be called by a ship-7 write"); },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => { if (d[k] === undefined) throw new Error("undefined written at " + k); setPath(cur, k, d[k]); }); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => recent, getJob: async () => null, getUsers: async () => USERS, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), hrRef: (id) => ref("homeowner_requests", id), auditRef: (id) => ref("duet_writes", id),
    settingsRef: (id) => { throw new api.Refusal(400, "settings/" + id + " must never be opened by a ship-7 write"); },
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }),
  };
}
const RID = (k) => `77777777-7777-4777-8777-${String(k).padStart(12, "0")}`;
let rid = 0;
const call = (io, action, args, jobId = FORTH) => api.handle({ requestId: RID(++rid), action, args: { jobId, ...args } }, io);
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const jobUpdate = (io, jobId = FORTH) => { const u = io.log.filter(l => l[0] === "update" && l[1] === "jobs/" + jobId); assert.strictEqual(u.length, 1, "exactly one job update"); return u[0][2]; };
const dataKeys = (upd) => Object.keys(upd).filter(k => k.startsWith("data.")).map(k => k.slice(5)).sort();
const checkStamp = (upd) => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-7777"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 606 && new RegExp("^" + upd.app_build + "\\.duet[a-z0-9]{6,}$").test(upd.w), "version-lock stamp >= 606");
  assert.strictEqual(upd.merged, false); assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true });
  assert.ok(Date.parse(upd.updated_at) > Date.parse("2026-11-03T20:00:00.000Z"), "updated_at strictly newer than the doc's");
};
const restIdentical = (io, jobId, keysWritten) => {
  const before = JOBS()["jobs/" + jobId].data, after = io.store["jobs/" + jobId].data;
  const wrote = new Set(keysWritten);
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!wrote.has(k)) assert.deepStrictEqual(after[k], before[k], "data." + k + " untouched");
};
const auditOf = (io, k) => io.store["duet_writes/" + RID(k)];
const fields = (p) => { assert.ok(!p.refused && !p.noop, "planned: " + JSON.stringify(p.refused || p)); return p.fields; };
const ID = /^\d{13}$/;

(async () => {
// ── shared module pinned to App.js ───────────────────────────────────────────
await ok("src/stageChange.js: ROUGH_STATUSES / QC_STATUSES / PREP_CHECKLIST_ITEMS carry App.js's values, labels and hasDate; parseStage is App.js's line; qcTripPlan is App.js's text; functions copy identical", () => {
  const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
  const arr = (name) => { const i = app.indexOf(`const ${name} = [`); assert.ok(i > 0, name); return app.slice(i, app.indexOf("];", i) + 2); };
  const box = { C: new Proxy({}, { get: () => "#000" }) };
  vm.runInNewContext([arr("ROUGH_STATUSES"), arr("QC_STATUSES"), arr("PREP_CHECKLIST_ITEMS"), "this.R = ROUGH_STATUSES; this.Q = QC_STATUSES; this.P = PREP_CHECKLIST_ITEMS;"].join("\n"), box);
  const slim = (l) => l.map(s => ({ value: s.value, label: s.label, ...(s.hasDate ? { hasDate: true } : {}) }));
  assert.deepStrictEqual(clone(slim(box.R)), slim(ST.ROUGH_STATUSES)); assert.deepStrictEqual(clone(slim(box.Q)), slim(ST.QC_STATUSES)); assert.deepStrictEqual(clone(box.P), ST.PREP_CHECKLIST_ITEMS);
  const line = (src, name) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf("\n", i)); };
  const mod = fs.readFileSync(path.join(root, "src", "stageChange.js"), "utf8");
  assert.strictEqual(line(app, "parseStage"), line(mod, "parseStage"), "parseStage one-liner identical");
  assert.strictEqual(line(app, "getStatusDef"), line(mod, "getStatusDef"), "getStatusDef identical");
  const extractFn = (src, marker) => { const start = src.indexOf(marker); assert.ok(start > 0, marker); let i = src.indexOf(") {", start) + 2, depth = 0, quote = null; for (; i < src.length; i++) { const c = src[i], d = src[i + 1]; if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; } if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; } if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2) + 1; continue; } if (c === '"' || c === "'" || c === "`") { quote = c; continue; } if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } } return src.slice(start, i); };
  assert.strictEqual(extractFn(app, "function qcTripPlan("), ST.qcTripPlan.toString(), "qcTripPlan copied verbatim");
  assert.ok(!/function stageChangePlan\(/.test(app) && /const \{ stageChangePlan, READY_TO_INVOICE_ALERTS \} = StageChange;/.test(app), "App.js takes stageChangePlan from the module");
  assert.ok(fs.readFileSync(path.join(root, "functions", "stageChange.js")).equals(fs.readFileSync(path.join(root, "src", "stageChange.js"))), "functions/stageChange.js byte-identical");
  assert.ok(!/require\(|firebase/.test(mod), "the shared module requires nothing");
});
await ok("toMdy: YYYY-MM-DD → M/D/YYYY as DateInp stores it, M/D/YYYY kept (zero-padding dropped), \"\" clears, junk / Feb 30 refused", () => {
  assert.deepStrictEqual(SG.toMdy("2026-11-05", "x"), { v: "11/5/2026" }); assert.deepStrictEqual(SG.toMdy("2026-01-09", "x"), { v: "1/9/2026" });
  assert.deepStrictEqual(SG.toMdy("11/5/2026", "x"), { v: "11/5/2026" }); assert.deepStrictEqual(SG.toMdy("01/09/2026", "x"), { v: "1/9/2026" });
  assert.deepStrictEqual(SG.toMdy("", "x"), { v: "" }); assert.deepStrictEqual(SG.toMdy(undefined, "x"), { v: undefined });
  assert.ok(/must be YYYY-MM-DD or M\/D\/YYYY/.test(SG.toMdy("Nov 5", "x").refused)); assert.ok(/real date/.test(SG.toMdy("2026-02-30", "x").refused));
});

// ── 1. phase status ──────────────────────────────────────────────────────────
await ok("phase.setStatus rough: every status value writes the select's exact patch (OnHold / Scheduled / StartConfirmed rule / StatusDate hasDate rule / ProjectedStart written back / DepositDismissed on scheduled)", () => {
  const base = { roughProjectedStart: "11/1/2026" };
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "" }, J())), { roughStatus: "", roughOnHold: false, roughScheduled: false, roughStartConfirmed: false, roughStatusDate: "", ...base });
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "waiting_date" }, J())), { roughStatus: "waiting_date", roughOnHold: false, roughScheduled: false, roughStartConfirmed: false, roughStatusDate: "", ...base });
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "date_confirmed" }, J())), { roughStatus: "date_confirmed", roughOnHold: false, roughScheduled: false, roughStartConfirmed: true, roughStatusDate: "11/5/2026", ...base });
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "scheduled" }, J())), { roughStatus: "scheduled", roughOnHold: false, roughScheduled: true, roughStartConfirmed: true, roughStatusDate: "11/5/2026", ...base, roughDepositDismissed: false });
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "inprogress" }, J({ roughStatus: "scheduled" }))), { roughStatus: "inprogress", roughOnHold: false, roughScheduled: false, roughStartConfirmed: true, roughStatusDate: "11/5/2026", ...base });
  assert.deepStrictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "waiting" }, J())), { roughStatus: "waiting", roughOnHold: true, roughScheduled: false, roughStartConfirmed: true, roughStatusDate: "", ...base });
  // StartConfirmed rule: scheduled / inprogress / complete / waiting KEEP the job's value — false stays false, an absent one is dropped (the app's sanitize).
  assert.strictEqual(fields(SG.planSetPhaseStatus({ phase: "rough", status: "waiting" }, J({ roughStartConfirmed: false }))).roughStartConfirmed, false);
  const absent = fields(SG.planSetPhaseStatus({ phase: "finish", status: "waiting" }, jobCtx(CLEAN)));
  assert.ok(!("finishStartConfirmed" in absent) && !("finishProjectedStart" in absent), "absent fields the select copies from the job are not written (sanitize)");
  assert.deepStrictEqual(absent, { finishStatus: "waiting", finishOnHold: true, finishScheduled: false, finishStatusDate: "" }, "StatusDate is the literal \"\" on a status with no date, so it IS written");
  const p = SG.planSetPhaseStatus({ phase: "rough", status: "inprogress" }, J());
  assert.ok(p.noop && /already In Progress/.test(p.result.message), "same status → noop");
  assert.ok(/status must be one of/.test(SG.planSetPhaseStatus({ phase: "rough", status: "done" }, J()).refused)); assert.ok(/phase must be/.test(SG.planSetPhaseStatus({ phase: "qc", status: "" }, J()).refused));
  assert.ok(/archived/.test(SG.planSetPhaseStatus({ phase: "rough", status: "" }, jobCtx(GONE)).refused));
});
await ok("phase.setStatus complete: refused while the phase's punch has open items — counted with the slots laid over (a slot-closed item does not block); finish counts finish + Legacy QC; the first complete on rough flips Matterport + QC (finish never does)", () => {
  const r = SG.planSetPhaseStatus({ phase: "rough", status: "complete" }, J());
  assert.ok(/Cannot mark Rough as complete — 4 open punch items remaining on Forth/.test(r.refused), r.refused);   // PU1, PR1, PR2 (voided counts: the app's countFloor only tests done), PR4
  const f = SG.planSetPhaseStatus({ phase: "finish", status: "complete" }, J());
  assert.ok(/Cannot mark Finish as complete — 1 finish punch item and 1 QC item still open/.test(f.refused), f.refused);
  // SLOT: raw tree open, slot says done → allowed (applyPunchTicks first, as normalizeJob does).
  assert.strictEqual(applyPunchTicks(JOBS()["jobs/" + SLOT].data).roughPunch.upper.general[0].done, true);
  const s = SG.planSetPhaseStatus({ phase: "rough", status: "complete" }, jobCtx(SLOT));
  // SLOT: QC already scheduled → no qcFlip; Matterport unset with finish at 0% → the matterport flip applies.
  assert.deepStrictEqual(fields(s), { roughStatus: "complete", roughOnHold: false, roughScheduled: false, roughStartConfirmed: true, roughStatusDate: "", roughProjectedStart: "11/1/2026", matterportStatus: "needs" });
  assert.ok(s.result.matterportFlipped && !s.result.qcFlipped); assert.deepStrictEqual(s.result.pushes.map(x => x.push), ["milestone_complete"]);
  const c = SG.planSetPhaseStatus({ phase: "rough", status: "complete" }, jobCtx(CLEAN));
  assert.deepStrictEqual(fields(c), { roughStatus: "complete", roughOnHold: false, roughScheduled: false, roughStatusDate: "", matterportStatus: "needs", qcStatus: "needs" }, "CLEAN: both flips, no StartConfirmed / StatusDate / ProjectedStart (absent)");
  assert.ok(c.result.matterportFlipped && c.result.qcFlipped);
  assert.deepStrictEqual(c.result.pushes.map(x => x.push), ["milestone_complete", "qc_ready"]); assert.deepStrictEqual(c.result.pushTo, ["coordinator", "foreman"]); assert.deepStrictEqual(c.result.gcEmail, ["Rough complete (gcNotify)"]);
  // Already complete → no flips (the `job.roughStatus !== "complete"` guard) and no push.
  const again = SG.planSetPhaseStatus({ phase: "rough", status: "complete" }, jobCtx(CLEAN, { roughStatus: "complete", roughOnHold: true }));
  assert.deepStrictEqual(fields(again), { roughStatus: "complete", roughOnHold: false, roughScheduled: false, roughStatusDate: "" }); assert.deepStrictEqual(again.result.pushes, []);
  // Finish complete on CLEAN: no flips at all.
  const fc = SG.planSetPhaseStatus({ phase: "finish", status: "complete" }, jobCtx(CLEAN));
  assert.deepStrictEqual(fields(fc), { finishStatus: "complete", finishOnHold: false, finishScheduled: false, finishStatusDate: "" }); assert.deepStrictEqual(fc.result.pushes.map(x => x.push), ["milestone_complete"]);
});
await ok("phase.setStatus extras: statusDate stored M/D/YYYY on a hasDate status, refused otherwise; waitingOn trimmed to 140 on waiting / waiting_date, refused otherwise; job_hold push only when neither phase read hold before", () => {
  const d = fields(SG.planSetPhaseStatus({ phase: "rough", status: "scheduled", statusDate: "2026-11-12" }, J()));
  assert.strictEqual(d.roughStatusDate, "11/12/2026");
  assert.ok(/doesn't take a date/.test(SG.planSetPhaseStatus({ phase: "rough", status: "waiting", statusDate: "2026-11-12" }, J()).refused));
  assert.ok(/must be YYYY-MM-DD/.test(SG.planSetPhaseStatus({ phase: "rough", status: "scheduled", statusDate: "soon" }, J()).refused));
  const w = SG.planSetPhaseStatus({ phase: "rough", status: "waiting", waitingOn: "  GC to pour the  slab\n" + "x".repeat(200) }, J());
  assert.strictEqual(w.fields.roughWaitingOn.length, 140); assert.ok(w.fields.roughWaitingOn.startsWith("GC to pour the slab x"));
  assert.deepStrictEqual(w.result.pushes.map(x => x.push), ["job_hold"]); assert.deepStrictEqual(w.result.pushTo, ["coordinator"]);
  assert.ok(/waitingOn goes with waiting/.test(SG.planSetPhaseStatus({ phase: "rough", status: "scheduled", waitingOn: "x" }, J()).refused));
  // FINFAIL already has finish waiting → rough waiting adds no job_hold (the server tests both phases).
  const h = SG.planSetPhaseStatus({ phase: "rough", status: "waiting_date" }, jobCtx(FINFAIL));
  assert.deepStrictEqual(h.result.pushes, []);
  const h2 = SG.planSetPhaseStatus({ phase: "finish", status: "waiting_date" }, J());
  assert.deepStrictEqual(h2.result.pushes.map(x => x.push), ["job_hold"], "waiting_date matches the server's /hold|waiting/");
});

// ── 2. stage ─────────────────────────────────────────────────────────────────
await ok("phase.setStage: the patch IS stageChangePlan's on the shown job (85% → QC task fired, prep complete, Matterport; QC already scheduled stays); 100% refused with open punch (slot-closed allowed); finish 100% counts QC; '85' accepted; the app's lines come back", () => {
  const p = SG.planSetStage({ phase: "rough", stage: "85%" }, J());
  const want = ST.stageChangePlan(applyPunchTicks(J().job.data), "rough", "85%", { openPunch: 4 });
  assert.deepStrictEqual(fields(p), want.patch);
  assert.deepStrictEqual(p.fields, { roughStage: "85%", roughQCTaskFired: true, prepStage: "Job Prep Complete", matterportStatus: "needs", roughStatus: "inprogress" });
  assert.deepStrictEqual(p.result.lines, want.lines); assert.strictEqual(p.result.title, want.title); assert.strictEqual(p.result.from, "75%");
  assert.deepStrictEqual(p.before, { roughStage: "75%", roughQCTaskFired: false, prepStage: "Redline Plans Made", matterportStatus: null, roughStatus: "inprogress" });
});
await ok("phase.setStage pushes + refusals", () => {
  // The fixture has a prepChecklist map, so the server's allPrepDone reads the MAP (applianceSpecs false) → no prep_complete even though prepStage flips.
  const p = SG.planSetStage({ phase: "rough", stage: "85%" }, J());
  assert.deepStrictEqual(p.result.pushes, [], "prepStage flip alone fires nothing when the map says an item is open");
  const noMap = SG.planSetStage({ phase: "rough", stage: "5%" }, J({ prepChecklist: undefined, prepNA: undefined }));
  assert.deepStrictEqual(noMap.result.pushes.map(x => x.push), ["prep_complete"], "no map → prepStage decides → prep_complete");
  const r = SG.planSetStage({ phase: "rough", stage: "100%" }, J());
  assert.ok(/Rough can't be 100% yet\. 4 punch items are still open on Forth\./.test(r.refused), r.refused);
  const s = SG.planSetStage({ phase: "rough", stage: "100" }, jobCtx(SLOT));
  assert.strictEqual(s.fields.roughStage, "100%"); assert.strictEqual(s.fields.roughStatus, "complete"); assert.deepStrictEqual(s.result.pushes.map(x => x.push), ["milestone_complete"]); assert.deepStrictEqual(s.result.gcEmail, ["Rough complete (gcNotify)"]);
  const f = SG.planSetStage({ phase: "finish", stage: "100%" }, J());
  assert.ok(/1 finish punch item and 1 QC item still open on Forth/.test(f.refused), f.refused);
  const f2 = SG.planSetStage({ phase: "finish", stage: "80%" }, J());
  assert.deepStrictEqual(f2.fields, { finishStage: "80%", finishQcStatus: "needs", finishStatus: "inprogress" });
  assert.ok(SG.planSetStage({ phase: "rough", stage: "75%" }, J({ prepStage: "Job Prep Complete" })).noop, "same stage, nothing else → noop");
  assert.deepStrictEqual(SG.planSetStage({ phase: "rough", stage: "75%" }, J()).fields, { roughStage: "75%", prepStage: "Job Prep Complete", roughStatus: "inprogress" }, "the same % still re-applies the plan's side effects (prep complete), as the select does");
  assert.ok(/stage must be one of/.test(SG.planSetStage({ phase: "rough", stage: "83%" }, J()).refused));
  // On hold keeps its status (stageChangePlan's rule) — pinned through the planner.
  const hold = SG.planSetStage({ phase: "finish", stage: "40%" }, jobCtx(FINFAIL));
  assert.ok(!("finishStatus" in hold.fields) && hold.result.lines.some(l => /Still on hold/.test(l)));
});

// ── 3. inspection result ─────────────────────────────────────────────────────
await ok("inspection.setResult: fail → pass appends the Pass attempt literal {id, date M/D/YYYY Mountain, result, items: every item's text, by:'Koy'}; same result → noop; clear writes only the result; final fail from unset adds the attempt + failed_inspection push", () => {
  const p = SG.planSetInspection({ which: "rough", result: "pass" }, J());
  const att = p.fields.roughInspectionAttempts[1];
  assert.deepStrictEqual(Object.keys(p.fields), ["roughInspectionResult", "roughInspectionAttempts"]);
  assert.strictEqual(p.fields.roughInspectionResult, "pass"); assert.deepStrictEqual(p.fields.roughInspectionAttempts[0], ATT1);
  assert.ok(ID.test(att.id)); assert.deepStrictEqual(att, { id: att.id, date: MDY, result: "pass", items: [{ text: I1.text }, { text: I2.text }, { text: I3.text }], by: "Koy" });
  assert.deepStrictEqual(Object.keys(att), ["id", "date", "result", "items", "by"], "key order as the app writes it");
  assert.deepStrictEqual(p.before, { roughInspectionResult: "fail", roughInspectionAttempts: [ATT1] }); assert.deepStrictEqual(p.after, { roughInspectionResult: "pass", roughInspectionAttempts: att });
  assert.deepStrictEqual(p.result.pushes, []); assert.deepStrictEqual(p.result.gcEmail, ["4-way inspection pass (gcNotify)"]); assert.strictEqual(p.result.openFailedItems, 2);
  const same = SG.planSetInspection({ which: "rough", result: "fail" }, J());
  assert.ok(same.noop && /already reads fail/.test(same.result.message), "fail on fail is a noop, not the app's toggle-off — clear is explicit");
  const c = SG.planSetInspection({ which: "rough", result: "clear" }, J());
  assert.deepStrictEqual(c.fields, { roughInspectionResult: "" }); assert.deepStrictEqual(c.before, { roughInspectionResult: "fail" }); assert.strictEqual(c.result.attemptAdded, false);
  assert.ok(SG.planSetInspection({ which: "final", result: "clear" }, J()).noop);
  const f = SG.planSetInspection({ which: "final", result: "fail" }, J());
  assert.strictEqual(f.fields.finalInspectionResult, "fail"); assert.deepStrictEqual(f.fields.finalInspectionAttempts[0], { id: f.fields.finalInspectionAttempts[0].id, date: MDY, result: "fail", items: [], by: "Koy" });
  assert.deepStrictEqual(f.result.pushes.map(x => x.push), ["failed_inspection"]); assert.deepStrictEqual(f.result.pushTo, ["foreman", "coordinator"]); assert.strictEqual(f.result.failureNumber, 1); assert.ok(/add what the inspector called/.test(f.result.note));
  assert.ok(/which must be/.test(SG.planSetInspection({ which: "finish", result: "pass" }, J()).refused)); assert.ok(/result must be/.test(SG.planSetInspection({ which: "rough", result: "passed" }, J()).refused));
});
await ok("inspection.setResult failedAgain: only while it reads fail; appends {…, result:'fail', items: OPEN items only, by:'Koy', repeat:true}, result untouched; failure number counts like odRealAtts; refused on pass / unset / with result:'pass'", () => {
  const p = SG.planSetInspection({ which: "rough", failedAgain: true }, J());
  assert.deepStrictEqual(Object.keys(p.fields), ["roughInspectionAttempts"], "the result field is NOT written");
  const att = p.fields.roughInspectionAttempts[1];
  assert.deepStrictEqual(att, { id: att.id, date: MDY, result: "fail", items: [{ text: I1.text }, { text: I3.text }], by: "Koy", repeat: true });
  assert.strictEqual(p.result.failureNumber, 2); assert.strictEqual(p.result.result, "fail"); assert.deepStrictEqual(p.result.pushes.map(x => x.push), ["failed_inspection"]); assert.deepStrictEqual(p.result.gcEmail, ["repeat fail (gcNotify)"]);
});
await ok("odRealAtts (copied): same result + same date collapses unless repeat; a blank result pops the last", () => {
  const a = { id: 1, date: MDY, result: "fail" }, b = { id: 2, date: MDY, result: "fail" }, c = { id: 3, date: MDY, result: "fail", repeat: true };
  assert.strictEqual(SG.inspFailCount([a, b], "fail"), 1); assert.strictEqual(SG.inspFailCount([a, c], "fail"), 2); assert.strictEqual(SG.inspFailCount([a, c], ""), 1);
  assert.ok(/not failed — Failed again is only offered/.test(SG.planSetInspection({ which: "final", failedAgain: true }, J()).refused));
  assert.ok(/not failed/.test(SG.planSetInspection({ which: "rough", failedAgain: true }, J({ roughInspectionResult: "pass" })).refused));
  assert.ok(/leave result out or say fail/.test(SG.planSetInspection({ which: "rough", failedAgain: true, result: "pass" }, J()).refused));
  const withFail = SG.planSetInspection({ which: "rough", failedAgain: true, result: "fail" }, J());
  assert.ok(withFail.fields && withFail.fields.roughInspectionAttempts.length === 2, "result:'fail' with failedAgain is accepted");
});

// ── 4. failed items ──────────────────────────────────────────────────────────
await ok("inspection.items add: {id, text, done:false} appended (text plain, trimmed); only while the result reads fail", () => {
  const p = SG.planInspectionItems({ which: "rough", op: "add", text: "  Missing   nail plate <b>garage</b>\n" }, J());
  const it = p.fields.roughInspectionItems[3];
  assert.deepStrictEqual(Object.keys(p.fields), ["roughInspectionItems"]); assert.ok(ID.test(it.id));
  assert.deepStrictEqual(it, { id: it.id, text: "Missing nail plate <b>garage</b>", done: false }, "a plain <input> — the text is stored as typed, no HTML escaping");
  assert.deepStrictEqual(p.fields.roughInspectionItems.slice(0, 3), [I1, I2, I3]); assert.deepStrictEqual(p.before, { roughInspectionItems: [I1, I2, I3] }); assert.deepStrictEqual(p.after, { roughInspectionItems: it });
  assert.strictEqual(p.result.number, 4); assert.strictEqual(p.result.openFailedItems, 3);
  assert.ok(/only shows while it reads failed/.test(SG.planInspectionItems({ which: "final", op: "add", text: "x" }, J()).refused));
  assert.ok(/needs text/.test(SG.planInspectionItems({ which: "rough", op: "add", text: "  " }, J()).refused));
  assert.ok(/op must be/.test(SG.planInspectionItems({ which: "rough", op: "delete", itemId: "i1" }, J()).refused));
});
await ok("inspection.items setDone: rough flips done AND mirrors `done` (only) onto returnTrips[].punch[] entries with fromRoughInspectionId, in the same write; final has no mirror; noop when already", () => {
  const p = SG.planInspectionItems({ which: "rough", op: "setDone", itemId: "i1", done: true }, J());
  assert.deepStrictEqual(Object.keys(p.fields).sort(), ["returnTrips", "roughInspectionItems"]);
  assert.deepStrictEqual(p.fields.roughInspectionItems, [{ ...I1, done: true }, I2, I3]);
  const e1 = p.fields.returnTrips[0].punch[0];
  assert.deepStrictEqual(e1, { ...RT_INSP.punch[0], done: true }, "only done changes on the mirrored entry — no checkedBy / checkedAt (the app's mirror)");
  assert.deepStrictEqual(p.fields.returnTrips[0].punch[1], RT_INSP.punch[1]); assert.deepStrictEqual(p.fields.returnTrips[1], RT_OTHER);
  assert.deepStrictEqual(p.before.returnTrips, [{ rtId: "rt1", entry: RT_INSP.punch[0] }]); assert.deepStrictEqual(p.after.returnTrips, [{ rtId: "rt1", entry: e1 }]);
  assert.strictEqual(p.result.returnTripEntriesMirrored, 1); assert.strictEqual(p.result.openFailedItems, 1);
  const un = SG.planInspectionItems({ which: "rough", op: "setDone", itemId: "i3", done: true }, J());
  assert.deepStrictEqual(Object.keys(un.fields), ["roughInspectionItems"], "no linked entry → returnTrips not written");
  assert.ok(SG.planInspectionItems({ which: "rough", op: "setDone", itemId: "i2", done: true }, J()).noop);
  assert.ok(/No 4-way failed item with id/.test(SG.planInspectionItems({ which: "rough", op: "setDone", itemId: "zz", done: true }, J()).refused));
  const fin = SG.planInspectionItems({ which: "final", op: "setDone", itemId: "g1", done: true }, jobCtx(FINFAIL));
  assert.deepStrictEqual(Object.keys(fin.fields), ["finalInspectionItems"]); assert.deepStrictEqual(fin.fields.finalInspectionItems[0], { id: "g1", text: "Cover plate missing", done: true });
});

// ── 5. the return trip from failed items ─────────────────────────────────────
await ok("inspection.createTrip rough (no open trip): the → Create Return Trip literal — EVERY item carried with its done state, the backlink, punchStamp YMD Mountain, the reports with fromInspection:'rough', fromFailedRough, needsSchedule, NO rtStatus; key order as the app writes it", () => {
  const trips = [RT_OTHER];
  const p = SG.planCreateInspectionTrip({ which: "rough" }, J({ returnTrips: trips }));
  assert.deepStrictEqual(Object.keys(p.fields), ["returnTrips"]); assert.strictEqual(p.fields.returnTrips.length, 2); assert.deepStrictEqual(p.fields.returnTrips[0], RT_OTHER);
  const rt = p.fields.returnTrips[1];
  assert.ok(ID.test(rt.id));
  assert.deepStrictEqual(Object.keys(rt), ["id", "date", "scope", "material", "punch", "photos", "fromFailedRough", "assignedTo", "signedOff", "signedOffBy", "signedOffDate", "needsSchedule", "needsScheduleDate", "rtScheduled", "scheduledDate"]);
  assert.deepStrictEqual({ ...rt, id: "X", punch: "P" }, { id: "X", date: "", scope: "Failed 4-way inspection items", material: "", punch: "P", photos: [{ id: "rp1", url: "https://x/report.pdf", name: "report.pdf", type: "application/pdf", fromInspection: "rough" }], fromFailedRough: true, assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "" });
  assert.ok(!("rtStatus" in rt), "the app's literal writes no rtStatus");
  assert.strictEqual(rt.punch.length, 3, "every 4-way item, done and open");
  rt.punch.forEach((e, i) => { assert.ok(ID.test(e.id)); assert.deepStrictEqual(e, { id: e.id, text: [I1, I2, I3][i].text, done: [false, true, false][i], addedAt: TODAY, addedAtTs: NOW, fromRoughInspectionId: [I1, I2, I3][i].id }); assert.deepStrictEqual(Object.keys(e), ["id", "text", "done", "addedAt", "addedAtTs", "fromRoughInspectionId"]); });
  assert.strictEqual(new Set([rt.id, ...rt.punch.map(e => e.id)]).size, 4, "fresh ids, none shared");
  assert.deepStrictEqual(p.before, { returnTrips: null }); assert.deepStrictEqual(p.after.returnTrips, rt); assert.strictEqual(p.itemId, rt.id);
  assert.deepStrictEqual({ ...p.result, rtId: "X" }, { which: "rough", rtId: "X", number: 2, appended: false, scope: "Failed 4-way inspection items", itemsOnTrip: 3, openItemsCarried: 2, doneItemsCarried: 1, reportsCarried: 1, rtStatus: "", needsSchedule: true, pushTo: [], note: p.result.note });
  assert.ok(/No open failed 4-way inspection items/.test(SG.planCreateInspectionTrip({ which: "rough" }, J({ roughInspectionItems: [I2] })).refused));
});
await ok("inspection.createTrip with an open trip from this inspection: → Add N to the return trip — only items not on it by id or by text; nothing new → noop; final: open items only, done:false, no backlink, fromFailedFinal, fromInspection:'final'", () => {
  // RT_INSP carries i1 (by id) and "Strap the feeder" (i2, done anyway); i3 is new.
  const p = SG.planCreateInspectionTrip({ which: "rough" }, J());
  assert.strictEqual(p.fields.returnTrips.length, 2); assert.deepStrictEqual(p.fields.returnTrips[1], RT_OTHER);
  const rt = p.fields.returnTrips[0];
  assert.strictEqual(rt.punch.length, 3); assert.deepStrictEqual(rt.punch.slice(0, 2), RT_INSP.punch);
  assert.deepStrictEqual(rt.punch[2], { id: rt.punch[2].id, text: I3.text, done: false, addedAt: TODAY, addedAtTs: NOW, fromRoughInspectionId: "i3" });
  assert.deepStrictEqual({ ...rt, punch: "P" }, { ...RT_INSP, punch: "P" }, "the rest of the trip untouched");
  assert.deepStrictEqual(p.before, { returnTrips: RT_INSP }); assert.deepStrictEqual(p.after.returnTrips, { rtId: "rt1", added: [rt.punch[2]] });
  assert.deepStrictEqual(p.result, { which: "rough", rtId: "rt1", number: 1, appended: true, itemsAdded: 1, itemsOnTrip: 3, scope: "Failed 4-way inspection items", pushTo: [] });
  // Matched by text where the trip keeps no id: an item whose text is already on the trip is not added again.
  const byText = SG.planCreateInspectionTrip({ which: "rough" }, J({ roughInspectionItems: [I1, { id: "i9", text: "  strap THE feeder ", done: false }] }));
  assert.ok(byText.noop && /Already on a return trip \(#1, 2 items\)/.test(byText.result.message), JSON.stringify(byText));
  // A signed-off trip doesn't count as open → a new trip is made.
  const signed = SG.planCreateInspectionTrip({ which: "rough" }, J({ returnTrips: [{ ...RT_INSP, signedOff: true }] }));
  assert.strictEqual(signed.fields.returnTrips.length, 2); assert.strictEqual(signed.result.appended, false);
  // Final.
  const f = SG.planCreateInspectionTrip({ which: "final" }, jobCtx(FINFAIL));
  const frt = f.fields.returnTrips[1];
  assert.deepStrictEqual(f.fields.returnTrips[0], RT_QC);
  assert.deepStrictEqual(Object.keys(frt), ["id", "date", "scope", "material", "punch", "photos", "fromFailedFinal", "assignedTo", "signedOff", "signedOffBy", "signedOffDate", "needsSchedule", "needsScheduleDate", "rtScheduled", "scheduledDate"]);
  assert.strictEqual(frt.scope, "Failed final inspection items"); assert.strictEqual(frt.fromFailedFinal, true); assert.ok(!("fromFailedRough" in frt));
  assert.deepStrictEqual(frt.punch, [{ id: frt.punch[0].id, text: "Cover plate missing", done: false, addedAt: TODAY, addedAtTs: NOW }], "open items only, no backlink");
  assert.deepStrictEqual(frt.photos, [{ id: "rp2", url: "u2", name: "final.jpg", fromInspection: "final" }]);
  assert.strictEqual(f.result.doneItemsCarried, 0);
});

// ── 6. QC status ─────────────────────────────────────────────────────────────
await ok("qc.setStatus: the base patch {qcStatus, qcStatusDate: hasDate ? existing : ''}; statusDate stored M/D/YYYY on scheduled / completed, refused elsewhere; needs → qc_ready; pass → qc_passed; finish writes finishQcStatus / finishQcStatusDate with no push; noop", () => {
  const c = SG.planSetQcStatus({ phase: "rough", status: "completed" }, J());
  assert.deepStrictEqual(c.fields, { qcStatus: "completed", qcStatusDate: "11/4/2026" }); assert.deepStrictEqual(c.before, { qcStatus: "scheduled", qcStatusDate: "11/4/2026" }); assert.deepStrictEqual(c.result.pushes, []);
  const d = SG.planSetQcStatus({ phase: "rough", status: "scheduled", statusDate: "2026-11-06" }, J());
  assert.deepStrictEqual(d.fields, { qcStatus: "scheduled", qcStatusDate: "11/6/2026" }); assert.deepStrictEqual(d.result.changed, ["qcStatusDate"]);
  const n0 = SG.planSetQcStatus({ phase: "rough", status: "needs" }, J());
  assert.deepStrictEqual(n0.fields, { qcStatus: "needs", qcStatusDate: "" }); assert.deepStrictEqual(n0.result.pushes.map(x => x.push), ["qc_ready"]); assert.deepStrictEqual(n0.result.pushTo, ["foreman", "coordinator"]);
  const pass = SG.planSetQcStatus({ phase: "rough", status: "pass" }, J());
  assert.deepStrictEqual(pass.fields, { qcStatus: "pass", qcStatusDate: "" }); assert.deepStrictEqual(pass.result.pushes.map(x => x.push), ["qc_passed"]);
  assert.deepStrictEqual(SG.planSetQcStatus({ phase: "rough", status: "fixed" }, J({ qcStatus: "pass" })).result.pushes, [], "pass → fixed: already passing, no second push");
  assert.ok(/doesn't take a date/.test(SG.planSetQcStatus({ phase: "rough", status: "pass", statusDate: "2026-11-06" }, J()).refused));
  assert.ok(/then only goes with fail or passed_items/.test(SG.planSetQcStatus({ phase: "rough", status: "scheduled", then: "rt" }, J()).refused));
  const f = SG.planSetQcStatus({ phase: "finish", status: "needs" }, J());
  assert.deepStrictEqual(f.fields, { finishQcStatus: "needs", finishQcStatusDate: "" }); assert.deepStrictEqual(f.result.pushes, []); assert.ok(/No push/.test(f.result.pushNote));
  const absent = SG.planSetQcStatus({ phase: "finish", status: "scheduled" }, J());
  assert.deepStrictEqual(absent.fields, { finishQcStatus: "scheduled" }, "an absent date stays absent (hasDate ? existing : '' → undefined → sanitize)");
  assert.ok(SG.planSetQcStatus({ phase: "rough", status: "scheduled" }, J()).noop);
  assert.ok(/status must be one of/.test(SG.planSetQcStatus({ phase: "rough", status: "passed" }, J()).refused));
});
await ok("qc.setStatus fail / passed_items: then required; crew → base + qcRtChoice<P> 'crew' / By 'Koy' / At now, no trip; rt → the QC trip literal with qcTripPlan's clones (open fromQC items on THIS phase, slots applied; voided / done skipped) or the missing clones onto the open QC trip", () => {
  assert.ok(/who fixes the QC items\?.*then: "rt".*then: "crew"/.test(SG.planSetQcStatus({ phase: "rough", status: "fail" }, J()).refused));
  const crew = SG.planSetQcStatus({ phase: "rough", status: "fail", then: "crew" }, J());
  assert.deepStrictEqual(crew.fields, { qcStatus: "fail", qcStatusDate: "", qcRtChoiceRough: "crew", qcRtChoiceRoughBy: "Koy", qcRtChoiceRoughAt: NOW });
  assert.deepStrictEqual(crew.before, { qcStatus: "scheduled", qcStatusDate: "11/4/2026", qcRtChoiceRough: null, qcRtChoiceRoughBy: null, qcRtChoiceRoughAt: null });
  assert.strictEqual(crew.result.openQcItems, 2); assert.ok(/crew on site has it/.test(crew.result.tripNote)); assert.deepStrictEqual(crew.result.pushes, []);
  const rt = SG.planSetQcStatus({ phase: "rough", status: "fail", then: "rt" }, J());
  assert.deepStrictEqual(Object.keys(rt.fields).sort(), ["qcRtChoiceRough", "qcRtChoiceRoughAt", "qcRtChoiceRoughBy", "qcStatus", "qcStatusDate", "returnTrips"]);
  assert.strictEqual(rt.fields.returnTrips.length, 3); assert.deepStrictEqual(rt.fields.returnTrips.slice(0, 2), [RT_INSP, RT_OTHER]);
  const t = rt.fields.returnTrips[2];
  assert.deepStrictEqual(Object.keys(t), ["id", "date", "scope", "material", "punch", "photos", "assignedTo", "signedOff", "signedOffBy", "signedOffDate", "needsSchedule", "needsScheduleDate", "rtScheduled", "scheduledDate", "rtStatus", "fromQCFail"]);
  assert.deepStrictEqual({ ...t, id: "X", punch: "P" }, { id: "X", date: "", scope: "QC Fail — return trip needed", material: "", punch: "P", photos: [], assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "", rtStatus: "needs", fromQCFail: true });
  assert.strictEqual(t.punch.length, 2, "PR1 + PR4 (PR2 voided, PR3 done, PF1 is finish)");
  assert.deepStrictEqual(t.punch[0], { id: t.punch[0].id, text: "Box for the fan", done: false, fromQC: true, severity: "serious", originItemId: PR1.id, originPhase: "rough", addedAt: TODAY, addedAtTs: NOW, photos: [{ id: "ph1", url: "u" }], materialNeeded: "fan box", materialSource: "CED" });
  assert.deepStrictEqual(Object.keys(t.punch[0]), ["id", "text", "done", "fromQC", "severity", "originItemId", "originPhase", "addedAt", "addedAtTs", "photos", "materialNeeded", "materialSource"]);
  assert.deepStrictEqual(t.punch[1], { id: t.punch[1].id, text: "Second open QC", done: false, fromQC: true, originItemId: PR4.id, originPhase: "rough", addedAt: TODAY, addedAtTs: NOW, photos: [], materialNeeded: "", materialSource: "" }, "no severity key when the item has none (sanitize)");
  assert.ok(ID.test(t.id) && t.punch.every(e => ID.test(e.id)) && new Set([t.id, ...t.punch.map(e => e.id)]).size === 3);
  assert.deepStrictEqual(rt.before.returnTrips, null); assert.deepStrictEqual(rt.after.returnTrips, t); assert.strictEqual(rt.itemId, t.id);
  assert.strictEqual(rt.result.rtNumber, 3); assert.strictEqual(rt.result.tripCreated, true); assert.strictEqual(rt.result.scope, "QC Fail — return trip needed");
  const pi = SG.planSetQcStatus({ phase: "rough", status: "passed_items", then: "rt" }, J());
  assert.strictEqual(pi.fields.returnTrips[2].scope, "QC Items — return trip"); assert.strictEqual(pi.fields.qcRtChoiceRough, "rt");
  // FINFAIL has an open QC trip carrying PR1 → only PR4 is added to it.
  const app = SG.planSetQcStatus({ phase: "rough", status: "fail", then: "rt" }, jobCtx(FINFAIL));
  assert.strictEqual(app.fields.returnTrips.length, 1); assert.strictEqual(app.fields.returnTrips[0].punch.length, 2); assert.deepStrictEqual(app.fields.returnTrips[0].punch[0], RT_QC.punch[0]);
  assert.strictEqual(app.fields.returnTrips[0].punch[1].originItemId, PR4.id); assert.strictEqual(app.result.tripAppended, true); assert.strictEqual(app.result.itemsAdded, 1); assert.strictEqual(app.result.rtNumber, 1);
  assert.deepStrictEqual(app.before.returnTrips, RT_QC);
  // Every open item already on the trip → status + stamps only, trip untouched.
  const full = SG.planSetQcStatus({ phase: "rough", status: "fail", then: "rt" }, jobCtx(FINFAIL, { roughPunch: { ...ROUGH(), basement: EMPTY() } }));
  assert.ok(!("returnTrips" in full.fields)); assert.ok(/already has every open QC item/.test(full.result.tripNote));
  // Finish fail: the finish phase's fromQC items, the Finish stamps.
  const fin = SG.planSetQcStatus({ phase: "finish", status: "fail", then: "rt" }, J());
  assert.deepStrictEqual(Object.keys(fin.fields).sort(), ["finishQcStatus", "finishQcStatusDate", "qcRtChoiceFinish", "qcRtChoiceFinishAt", "qcRtChoiceFinishBy", "returnTrips"]);
  assert.strictEqual(fin.fields.returnTrips[2].punch.length, 1); assert.strictEqual(fin.fields.returnTrips[2].punch[0].originPhase, "finish"); assert.deepStrictEqual(fin.result.pushes, []);
  // Slots applied: a slot that closes PR4 drops it from the clones.
  const slotted = SG.planSetQcStatus({ phase: "rough", status: "fail", then: "rt" }, J({ punchTicks: { [PR4.id]: { done: true, by: "Colby", at: MDY, ts: NOW } } }));
  assert.strictEqual(slotted.fields.returnTrips[2].punch.length, 1);
  // The crew answer on the same verdict twice is still a write (the At stamp moves) — never a noop.
  assert.ok(!SG.planSetQcStatus({ phase: "rough", status: "fail", then: "crew" }, J({ qcStatus: "fail", qcStatusDate: "", qcRtChoiceRough: "crew", qcRtChoiceRoughBy: "Koy", qcRtChoiceRoughAt: "2026-11-01T00:00:00.000Z" })).noop);
});

// ── 7. prep ──────────────────────────────────────────────────────────────────
await ok("prep.tick: both maps written WHOLE (prepItemPatch) — done, na, clear; prep_complete push only when all five are ticked done (the server ignores not-needed); allPrepChecked counts N/A; noop", () => {
  const d = SG.planTickPrep({ key: "applianceSpecs", state: "done" }, J());
  assert.deepStrictEqual(d.fields, { prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true }, prepNA: { applianceSpecs: false } });
  assert.deepStrictEqual(d.before, { prepChecklist: BASE().prepChecklist, prepNA: {} }); assert.deepStrictEqual(d.after, d.fields);
  assert.deepStrictEqual(d.result.pushes.map(x => x.push), ["prep_complete"]); assert.deepStrictEqual(d.result.pushTo, ["foreman", "coordinator"]); assert.strictEqual(d.result.allPrepChecked, true); assert.deepStrictEqual(d.result.outstanding, []);
  const na = SG.planTickPrep({ key: "applianceSpecs", state: "na" }, J());
  assert.deepStrictEqual(na.fields, { prepChecklist: { ...BASE().prepChecklist, applianceSpecs: false }, prepNA: { applianceSpecs: true } });
  assert.deepStrictEqual(na.result.pushes, []); assert.strictEqual(na.result.allPrepChecked, true); assert.strictEqual(na.result.allPrepDoneForPush, false); assert.ok(/only fires when all five are ticked done/.test(na.result.note));
  const clr = SG.planTickPrep({ key: "redlinePlans", state: "clear" }, J({ prepNA: { redlinePlans: true } }));
  assert.deepStrictEqual(clr.fields, { prepChecklist: { ...BASE().prepChecklist, redlinePlans: false }, prepNA: { redlinePlans: false } }); assert.deepStrictEqual(clr.result.outstanding, ["redlinePlans", "applianceSpecs"]);
  const none = SG.planTickPrep({ key: "cabinetPlans", state: "done" }, J({ prepNA: { cabinetPlans: false } }));
  assert.ok(none.noop && /already done/.test(none.result.message));
  const first = SG.planTickPrep({ key: "cabinetPlans", state: "done" }, J({ prepChecklist: undefined, prepNA: undefined }));
  assert.deepStrictEqual(first.fields, { prepChecklist: { cabinetPlans: true }, prepNA: { cabinetPlans: false } }); assert.deepStrictEqual(first.before, { prepChecklist: null, prepNA: null });
  assert.ok(/key must be one of redlinePlans/.test(SG.planTickPrep({ key: "permits", state: "done" }, J()).refused)); assert.ok(/state must be/.test(SG.planTickPrep({ key: "redlinePlans", state: "yes" }, J()).refused));
});

// ── 8. schedule dates ────────────────────────────────────────────────────────
await ok("phase.setDates: the window (start / end / hard in one patch, hard clears the end, M/D/YYYY), PROJ. START (+ waiting_date when the status is blank, job_hold push, GC email), CONFIRM (+ date_confirmed; un-confirm a date_confirmed phase → waiting_date); nothing given refused", () => {
  const w = SG.planSetScheduleDates({ phase: "rough", statusDate: "2026-11-10" }, J());
  assert.deepStrictEqual(w.fields, { roughStatusDate: "11/10/2026", roughScheduledEnd: "11/7/2026", roughNeedsSchedHard: false }, "end and hard come from the job, as the modal prefills them");
  assert.deepStrictEqual(w.before, { roughStatusDate: "11/5/2026", roughScheduledEnd: "11/7/2026", roughNeedsSchedHard: false }); assert.deepStrictEqual(w.result.set, ["window"]); assert.deepStrictEqual(w.result.pushes, []);
  const h = SG.planSetScheduleDates({ phase: "rough", needsSchedHard: true }, J());
  assert.deepStrictEqual(h.fields, { roughStatusDate: "11/5/2026", roughScheduledEnd: "", roughNeedsSchedHard: true }, "hard clears the end");
  const e = SG.planSetScheduleDates({ phase: "rough", scheduledEnd: "11/9/2026", needsSchedHard: false }, J());
  assert.deepStrictEqual(e.fields, { roughStatusDate: "11/5/2026", roughScheduledEnd: "11/9/2026", roughNeedsSchedHard: false });
  const ps = SG.planSetScheduleDates({ phase: "finish", projectedStart: "2026-12-01" }, J());
  assert.deepStrictEqual(ps.fields, { finishProjectedStart: "12/1/2026", finishStatus: "waiting_date" }); assert.deepStrictEqual(ps.result.pushes.map(x => x.push), ["job_hold"]); assert.deepStrictEqual(ps.result.gcEmail, ["Finish projected start changed (gcNotify)"]);
  const ps2 = SG.planSetScheduleDates({ phase: "rough", projectedStart: "2026-12-01" }, J());
  assert.deepStrictEqual(ps2.fields, { roughProjectedStart: "12/1/2026" }, "status already set → untouched");
  const cf = SG.planSetScheduleDates({ phase: "finish", startConfirmed: true }, J());
  assert.deepStrictEqual(cf.fields, { finishStartConfirmed: true, finishStatus: "date_confirmed" }); assert.deepStrictEqual(cf.result.pushes, []);
  const un = SG.planSetScheduleDates({ phase: "rough", startConfirmed: false }, J({ roughStatus: "date_confirmed" }));
  assert.deepStrictEqual(un.fields, { roughStartConfirmed: false, roughStatus: "waiting_date" });
  const un2 = SG.planSetScheduleDates({ phase: "rough", startConfirmed: false }, J());
  assert.deepStrictEqual(un2.fields, { roughStartConfirmed: false }, "un-confirm on inprogress leaves the status");
  const both = SG.planSetScheduleDates({ phase: "finish", projectedStart: "2026-12-01", startConfirmed: true }, J());
  assert.deepStrictEqual(both.fields, { finishProjectedStart: "12/1/2026", finishStatus: "date_confirmed", finishStartConfirmed: true }, "the DateInp then the Confirm button, in that order");
  assert.ok(SG.planSetScheduleDates({ phase: "rough", startConfirmed: true }, J({ roughStatus: "date_confirmed" })).noop);
  assert.ok(/Say what to set/.test(SG.planSetScheduleDates({ phase: "rough" }, J()).refused)); assert.ok(/needsSchedHard must be/.test(SG.planSetScheduleDates({ phase: "rough", needsSchedHard: "yes" }, J()).refused));
});

// ── through handle(): the transaction, the envelope, the audit ───────────────
await ok("handle phase.setStatus: one jobs/<id> update with the dotted fields + the 606 envelope, the audit doc with EVERY written field before / after, everything else byte-identical", async () => {
  const io = fakeIo();
  const r = await call(io, "phase.setStatus", { phase: "rough", status: "waiting", waitingOn: "GC to pour the slab" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = jobUpdate(io); checkStamp(upd);
  assert.deepStrictEqual(dataKeys(upd), ["roughOnHold", "roughProjectedStart", "roughScheduled", "roughStartConfirmed", "roughStatus", "roughStatusDate", "roughWaitingOn"]);
  assert.strictEqual(upd["data.roughOnHold"], true); assert.strictEqual(upd["data.roughStatusDate"], "");
  const a = auditOf(io, rid);
  assert.strictEqual(a.coll, "jobs"); assert.strictEqual(a.docId, FORTH); assert.strictEqual(a.by, "Duet (Koy)"); assert.strictEqual(a.action, "phase.setStatus");
  assert.deepStrictEqual([...a.fields].sort(), dataKeys(upd)); assert.deepStrictEqual(Object.keys(a.before).sort(), dataKeys(upd)); assert.deepStrictEqual(Object.keys(a.after).sort(), dataKeys(upd));
  assert.strictEqual(a.before.roughStatus, "inprogress"); assert.strictEqual(a.before.roughStatusDate, "11/5/2026"); assert.strictEqual(a.after.roughWaitingOn, "GC to pour the slab");
  assert.deepStrictEqual(r.body.pushTo, ["coordinator"]); assert.deepStrictEqual(r.body.changed, ["roughStatus", "roughOnHold", "roughStatusDate", "roughWaitingOn"]);
  restIdentical(io, FORTH, dataKeys(upd));
  const after = io.store["jobs/" + FORTH].data;
  assert.strictEqual(after.roughStatus, "waiting"); assert.strictEqual(after.roughOnHold, true); assert.deepStrictEqual(after.roughPunch, ROUGH());
});
await ok("handle: stage, inspection (fail → failedAgain → trip), QC fail → rt, prep, dates — each one update; the trip's rt entries land; idempotent replay; archived 400; missing 404; the rate limit 429; only jobs + duet_writes written, never a delete / create / settings / needs", async () => {
  const io = fakeIo();
  const start = rid;
  const calls = [
    ["phase.setStage", { phase: "rough", stage: "85%" }],
    ["inspection.setResult", { which: "final", result: "fail" }],
    ["inspection.items", { which: "final", op: "add", text: "Cover plate missing in the garage" }],
    ["inspection.setResult", { which: "final", failedAgain: true }],
    ["inspection.createTrip", { which: "final" }],
    ["inspection.items", { which: "rough", op: "setDone", itemId: "i1", done: true }],
    ["qc.setStatus", { phase: "rough", status: "fail", then: "rt" }],
    ["prep.tick", { key: "applianceSpecs", state: "na" }],
    ["phase.setDates", { phase: "finish", projectedStart: "2026-12-01", startConfirmed: true }],
  ];
  for (const [action, args] of calls) { const r = await call(io, action, args); assert.strictEqual(r.status, 200, action + " " + JSON.stringify(r.body)); }
  const updates = io.log.filter(l => l[0] === "update" && l[1] === "jobs/" + FORTH);
  assert.strictEqual(updates.length, calls.length, "one update per call"); updates.forEach(u => checkStamp(u[2]));
  const KEY = /^data\.(roughStatus|roughStage|roughQCTaskFired|prepStage|matterportStatus|finalInspectionResult|finalInspectionAttempts|finalInspectionItems|roughInspectionItems|returnTrips|qcStatus|qcStatusDate|qcRtChoiceRough(By|At)?|prepChecklist|prepNA|finishProjectedStart|finishStatus|finishStartConfirmed)$/;
  assert.ok(updates.every(u => Object.keys(u[2]).every(k => KEY.test(k) || ENVELOPE.includes(k))), "job writes touch only the ship-7 fields");
  const writes = io.log.filter(l => ["update", "set", "create", "delete"].includes(l[0]));
  assert.ok(writes.every(w => w[1] === "jobs/" + FORTH || w[1].startsWith("duet_writes/")), "only the job and the audit collection");
  assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create" || l[1].startsWith("settings/") || l[1].startsWith("needs/")));
  assert.strictEqual(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length, calls.length);
  const after = io.store["jobs/" + FORTH].data;
  assert.strictEqual(after.roughStage, "85%"); assert.strictEqual(after.matterportStatus, "needs"); assert.strictEqual(after.prepStage, "Job Prep Complete");
  assert.strictEqual(after.finalInspectionResult, "fail"); assert.strictEqual(after.finalInspectionAttempts.length, 2); assert.strictEqual(after.finalInspectionAttempts[1].repeat, true); assert.deepStrictEqual(after.finalInspectionAttempts[1].items, [{ text: "Cover plate missing in the garage" }]);
  assert.strictEqual(after.finalInspectionItems.length, 1);
  assert.strictEqual(after.returnTrips.length, 4, "RT_INSP, RT_OTHER, the final-inspection trip, the QC-Fail trip");
  assert.strictEqual(after.returnTrips[2].scope, "Failed final inspection items"); assert.strictEqual(after.returnTrips[2].punch[0].text, "Cover plate missing in the garage");
  assert.strictEqual(after.returnTrips[0].punch[0].done, true, "the 4-way mirror landed"); assert.strictEqual(after.roughInspectionItems[0].done, true);
  assert.strictEqual(after.returnTrips[3].fromQCFail, true); assert.strictEqual(after.returnTrips[3].punch.length, 2); assert.strictEqual(after.qcStatus, "fail"); assert.strictEqual(after.qcRtChoiceRough, "rt"); assert.strictEqual(after.qcRtChoiceRoughBy, "Koy");
  assert.deepStrictEqual(after.prepNA, { applianceSpecs: true }); assert.strictEqual(after.finishProjectedStart, "12/1/2026"); assert.strictEqual(after.finishStatus, "date_confirmed"); assert.strictEqual(after.finishStartConfirmed, true);
  assert.deepStrictEqual(after.roughPunch, ROUGH()); assert.deepStrictEqual(after.changeOrders, [{ id: "c1" }]); assert.strictEqual(after.foreman, "Keegan"); assert.strictEqual(after.roughInspectionResult, "fail");
  // Audits: the QC trip's audit carries the new trip whole under after, null before; the stage audit carries the five fields.
  const qa = auditOf(io, start + 7); assert.strictEqual(qa.before.returnTrips, null); assert.strictEqual(qa.after.returnTrips.fromQCFail, true); assert.strictEqual(qa.itemId, qa.after.returnTrips.id); assert.deepStrictEqual([...qa.fields].sort(), ["qcRtChoiceRough", "qcRtChoiceRoughAt", "qcRtChoiceRoughBy", "qcStatus", "qcStatusDate", "returnTrips"]);
  const sa = auditOf(io, start + 1); assert.deepStrictEqual(sa.before, { roughStage: "75%", roughQCTaskFired: false, prepStage: "Redline Plans Made", matterportStatus: null, roughStatus: "inprogress" });
  // Replay: same requestId → same answer, no new write.
  const n0 = io.log.length;
  const again = await api.handle({ requestId: RID(start + 1), action: "phase.setStage", args: { jobId: FORTH, phase: "rough", stage: "5%" } }, io);
  assert.strictEqual(again.body.replayed, true); assert.strictEqual(again.body.to, "85%"); assert.strictEqual(io.log.length, n0);
  // Noop answer through handle.
  const no = await call(io, "prep.tick", { key: "applianceSpecs", state: "na" });
  assert.strictEqual(no.status, 200); assert.strictEqual(no.body.noop, true); assert.strictEqual(io.log.filter(l => l[0] === "update" && l[1] === "jobs/" + FORTH).length, calls.length, "a noop writes no job update");
  // Refusals.
  const gone = await call(io, "phase.setStatus", { phase: "rough", status: "" }, GONE); assert.strictEqual(gone.status, 400); assert.ok(/archived/.test(gone.body.refused));
  const miss = await call(io, "prep.tick", { key: "redlinePlans", state: "done" }, "1700000000000"); assert.strictEqual(miss.status, 404);
  const bad = await call(io, "phase.setStage", { phase: "rough", stage: "100%" }); assert.strictEqual(bad.status, 400); assert.ok(/can't be 100% yet/.test(bad.body.refused));
  assert.ok(auditOf(io, rid).ok === false && /can't be 100%/.test(auditOf(io, rid).why), "a refusal is audited too");
  const badId = await call(io, "prep.tick", { key: "redlinePlans", state: "done" }, "abc"); assert.strictEqual(badId.status, 400); assert.ok(/jobId must be/.test(badId.body.refused));
  const busy = fakeIo({ recent: 60 });
  await assert.rejects(call(busy, "prep.tick", { key: "redlinePlans", state: "done" }), (e) => e.status === 429);
  assert.strictEqual(busy.log.filter(l => l[0] === "update").length, 0);
});
await ok("handle: the eight actions exist, nothing like a delete does (job.archive became a real action in ship 9 — its own reversible shape); BUILD is 606; the ship-6 and ship-2 lists are untouched; api.js still has exactly three .delete( and no tx.delete; stages.js is pure", async () => {
  assert.deepStrictEqual(api.STAGE_ACTIONS, ["phase.setStatus", "phase.setStage", "inspection.setResult", "inspection.items", "inspection.createTrip", "qc.setStatus", "prep.tick", "phase.setDates"]);
  assert.ok(api.STAGE_ACTIONS.every(a => api.JOB_WRITE_ACTIONS.includes(a) && api.ACTIONS.includes(a)));
  assert.deepStrictEqual(api.PUNCH_ACTIONS, ["punch.setDone", "punch.add", "punch.assign", "punch.waiting", "punch.void", "punch.restore", "punch.editText"]);
  assert.deepStrictEqual(api.JOB_ACTIONS, ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"]);
  assert.ok(api.BUILD >= 606, "BUILD at least 606 (ship 8 bumped it to 607)");
  for (const a of ["job.delete", "job.create", "job.unarchive", "inspection.deleteItem", "inspection.clearAttempts", "prep.override", "phase.setMode"]) {   // job.setField became a real action in ship 11 (fieldPolicy.js allowlist)
    await assert.rejects(api.handle({ requestId: RID(900), action: a, args: {} }, fakeIo()), (e) => e.status === 400 && /action must be/.test(e.message), a);
  }
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.ok(!/tx\.delete\(/.test(src)); assert.strictEqual((src.match(/\.delete\(/g) || []).length, 3, "no new delete in api.js");
  const sg = fs.readFileSync(path.join(root, "functions", "duetWrites", "stages.js"), "utf8");
  assert.ok(!/firebase|require\("firebase-admin"\)|\.delete\(|FieldValue/.test(sg), "stages.js is pure");
  assert.ok(/require\("\.\.\/stageChange\.js"\)/.test(sg) && /require\("\.\.\/punchTicks\.js"\)/.test(sg), "the stage plan and the slot overlay come from the app's own shared modules");
});
console.log(`duet-stages-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
