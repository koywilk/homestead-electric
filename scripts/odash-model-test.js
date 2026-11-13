#!/usr/bin/env node
/* odash-model-test.js — the office dashboard's numbers (v542 information audit).
 * Compiles the SHIPPED dashboard helpers out of src/App.js (Babel, JSX → calls;
 * nothing renders) and runs odModel / odPlanModel / odDocStatus in a vm sandbox
 * on hand-made jobs, so what is tested is exactly what ships.
 *
 * Proves:
 *   1. ROSTER — one foreman list: titled foremen + team members named on an
 *      active job; Paul / Unassigned / someone off the team → "no foreman".
 *   2. RETURN TRIPS — late (visit passed / schedule-by passed), booked, to book,
 *      no date; one summary everywhere.
 *   3. FAILED ROUGH — "Rough inspection failed" stage, re-inspection target shows
 *      on the schedule, no finish-start ask while not re-booked.
 *   4. DEDUPE — back-to-back Fail taps count once in Activity too.
 *   5. QUESTIONS — open = not done and not answered.
 *   6. MONEY — v553: no Ready to invoice line or dollars; the Simpro sync's
 *      changes listed for a week with Undo; 60+ day change orders carry their
 *      Simpro quote $, not the job value (v551).
 *   7. PEOPLE — quiet needs an active job; approved time off is "off"; 30+ days is
 *      "gone"; neither counts in the on-app denominator.
 *   8. PLANS — an unmatched plan waits until filed/dismissed, not until Seen.
 *   9. DOCS — "did not run" when the last due time passed with nothing made.
 *  12. CLOSED IN SIMPRO — Invoiced / Complete at 100% billed leaves the active,
 *      punch, quiet and no-foreman counts and waits in "close it here?" (v551).
 *  13. BILLED COs — an approved CO on a job Simpro billed in full is "Billed —
 *      mark done?", not work to book (v551).
 *  14. v552 — Simpro technician as the suggested foreman, coordinator (job, else
 *      the foreman's book) and its filter, one "Needs a date" (jobs only), and
 *      the Move / unconfirm patch.
 * Also exported (require it) for a read-only run on real data.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");
const babel = require("@babel/core");
// Values come from a vm sandbox (another realm): compare as JSON.
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");

// Statement extractor: from `marker` to the end of that top-level statement
// (balanced brackets, string / template / comment aware).
function extractStatement(marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  let depth = 0, quote = null, sawBody = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i) - 1; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) { depth++; sawBody = true; continue; }
    if (")]}".includes(c)) { depth--; if (depth === 0 && c === "}" && marker.startsWith("function ")) return src.slice(start, i + 1); continue; }
    if (depth === 0 && c === ";") return src.slice(start, i + 1);
    if (depth === 0 && c === "\n" && sawBody) {
      const line = src.slice(src.lastIndexOf("\n", i - 1) + 1, i).trim();
      if (!/(=>|=|\?|:|\|\||&&|\+|,|\()$/.test(line)) return src.slice(start, i);
    }
  }
  throw new Error(`extract: unterminated ${marker}`);
}
const fn = (n) => extractStatement(`function ${n}(`);
const cst = (n) => extractStatement(`const ${n} = `);

// The dashboard block (Plans card through the helpers right above OfficeDash).
const a = src.indexOf("// ── Plan intake: Today → Plans card");
const b = src.indexOf("function OfficeDash(");
if (a < 0 || b < 0) throw new Error("dashboard block markers not found");
const parts = [
  cst("C"), cst("ROUGH_STATUSES"), cst("QC_STATUSES"), cst("getStatusDef"), cst("parseStage"), cst("getAccess"),
  fn("localYmd"), cst("parseAnyDate"), cst("effRS"), cst("effFS"), cst("sbv2WalkPunch"), cst("SBV2_EXCLUDE_NAME"),
  cst("commOf"), cst("commPhase"), cst("coIsConverted"), fn("matterportScanNeeded"), fn("qcWalkRows"), fn("qcBucketOf"),
  fn("isSnoozed"), fn("needIsOpen"), fn("needPriority"), cst("effectiveShareIds"), cst("computeEffectiveSharedIds"),
  src.slice(a, b),
  cst("canOpenDash"),
];
const code = babel.transformSync(parts.join("\n\n"), { babelrc: false, configFile: false, sourceType: "script", presets: [[require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code;

// v600: sameName / needAssignee live in src/needShape.js (shared with duetApi) — the shipped module, as globals.
const NEED_SHAPE = require(path.join(__dirname, "..", "src", "needShape.js"));
function makeSandbox(extra = {}) {
  const sb = {
    sameName: NEED_SHAPE.sameName, needAssignee: NEED_SHAPE.needAssignee,
    // v624: the Punch List stage lives in src/punchListStage.js (the shipped module, as globals).
    ...require(path.join(__dirname, "..", "src", "punchListStage.js")),
    console, Date, Math, JSON, Object, Array, String, Number, Set, Map, RegExp, isNaN, parseInt, parseFloat,
    React: { createElement: () => null }, Component: class {}, Fragment: "f",
    useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}),
    Icon: () => null, toast: {}, gcAdminCallable: () => () => {}, updateDoc: () => {}, doc: () => {}, db: {}, query: () => {}, collection: () => {}, orderBy: () => {}, limit: () => {}, onSnapshot: () => () => {}, can: () => true,
    buildJobPhotos: () => [], prepClearedToStart: (j) => !!(j && j.prepDone !== false), allPrepChecked: () => true,
    ...extra,
  };
  vm.createContext(sb);
  vm.runInContext(code + "\n;globalThis.__x = { odModel, odPlanModel, odDocStatus, odSimAsOf, odFeedProblems, odLaborEarly, OD_BEFORE_FINISH, odWorkDaysSince, odStageDiffs, odRtInfo, odPhase, OD_NOFM, OD_NOCOORD, OD_COORDS, odStartPatch, odSyncUndo, OD_DOCS, canOpenDash, odGoalsParse, odGoalsModel, odGoalsSheetAge, odGoalDue, odGoalStatus, odGoalsMeasures, OD_GOALS_SHEET, OD_GOAL_LIVE, odCostsJoin, odCostsSummary, odCostsCrew, odCostsJobPct, odCostsMargins, odCostsJosh, OD_COST_DONE, odCrews, odCostsByCrew, odCostsPeople, odGoalWarranty, odGoalCoHours, odGoalStoreRuns, odGoalHoursWeekly, odCostsRoughOverruns, odCostsOwners, odCostsCoHours, OD_P2_PENDING, odMondayKey, odSimproStaffByDay, odStartCoverage, odInspCalled, odInspToCall, odTimeOffByDay, odFirstPassByForeman, OD_RT_CAUSES, odRtCause, odRtCauses, odReinspByDate, odPlannerMonday, odPlannerDayIdx, odPlannerPerson, odClock, odBlockSpan, odTodayByPerson, odTodayText, odPeopleByCrew, OD_TIER, OD_TIER_LABEL, odPrevRun, odOpenQuestions, odQuestionSide, odSplitQuestions, odJobWaiting, odDaysInStage, OD_WAIT_LABEL, OD_WAIT_RANK, odTodayByCrew, odWeekBounds, odStartsUnconfirmedWeek, odMoneyAtRisk };", sb, { filename: "odash-extract.js" });
  return sb.__x;
}
module.exports = { makeSandbox };

if (require.main === module) {
  const X = makeSandbox();
  const now = new Date(2026, 9, 15, 7, 30);          // Thu Oct 15 2026, 7:30 AM local
  const ymd = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const ago = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 9);
  const users = [
    { id: "koy", name: "Koy Wilkinson", title: "admin", access: "admin" },
    { id: "abe", name: "Abraham Tristan", title: "foreman" },
    { id: "vasa", name: "Vasa Mataafa", title: "lead" },             // not titled foreman, runs jobs
    { id: "zane", name: "Zane Watkins", title: "foreman" },           // titled, no jobs
    { id: "joel", name: "Joel Old", title: "crew" },                  // seen 8/6 → gone
    { id: "jim", name: "James Livingston", title: "foreman" },        // approved off today
    { id: "old", name: "Old Foreman", title: "crew", role: "foreman", active: false }, // deactivated, still on a job
  ];
  const base = { roughPunch: {}, finishPunch: {}, qcPunch: {}, changeOrders: [], returnTrips: [], prepDone: true };
  const jobs = [
    { ...base, id: "j1", name: "Webb", foreman: "Abraham Tristan", simproNo: "1304", roughStatus: "complete", finishStatus: "inprogress", finishStage: "80%",
      readyToInvoice: true, readyToInvoiceDate: "10/1/2026", finishUpdates: [{ createdAt: ago(1).toISOString(), text: "x", addedBy: "Abraham Tristan" }] },
    { ...base, id: "j2", name: "Mangum", foreman: "Vasa Mataafa", simproNo: "920", roughStatus: "inprogress", roughStage: "70%",
      roughUpdates: [{ createdAt: ago(10).toISOString(), text: "x", addedBy: "Vasa Mataafa" }],
      changeOrders: [{ id: "c1", coStatus: "pending", submittedAt: ago(90).toISOString(), desc: "Add cans", quoteNumber: "5501" }, { id: "c2", coStatus: "needs_sending", desc: "Move box" },
        { id: "c5", coStatus: "pending", submittedAt: ago(70).toISOString(), desc: "Fan box", quoteNumber: "#5502" }],
      returnTrips: [
        { id: "r1", scope: "Floor outlets", rtStatus: "needs", rtStatusDate: ymd(ago(3)) },            // schedule-by passed → late 3
        { id: "r2", scope: "Fans", rtStatus: "scheduled", rtStatusDate: ymd(ago(10)) },                 // visit passed → late 10
        { id: "r3", scope: "Gen", rtStatus: "scheduled", rtStatusDate: ymd(ago(-4)) },                  // booked
        { id: "r4", scope: "Radon", rtStatus: "needs", rtStatusDate: ymd(ago(-12)) },                   // to book
        { id: "r5", scope: "Label panel" },                                                              // no date
        { id: "r6", scope: "Done one", signedOff: true },
      ],
      roughQuestions: { main: [{ question: "Height?", addedAt: ago(2).toISOString(), addedBy: "Louis" }, { question: "Old", addedAt: ago(5).toISOString(), done: true, answer: "x" }] } },
    { ...base, id: "j3", name: "Kweller", foreman: "Abraham Tristan", simproNo: "1107", roughStatus: "complete", finishStatus: "waiting_date",
      roughInspectionResult: "fail", fourWayTargetDate: ymd(ago(70)),
      roughInspectionAttempts: [{ date: ymd(ago(80)), result: "fail", items: [] }, { date: ymd(ago(70)), result: "fail", items: [{ text: "box fill" }] }, { date: ymd(ago(70)), result: "fail", items: [{ text: "box fill" }] }] },
    { ...base, id: "j4", name: "Thayne", foreman: "Paul", simproNo: "881", roughStatus: "", changeOrders: [{ id: "c3", coStatus: "approved" }] },
    { ...base, id: "j5", name: "Peterson", foreman: "Unassigned", roughStatus: "" },
    { ...base, id: "j6", name: "Old done job", foreman: "Abraham Tristan", simproNo: "500", roughStatus: "complete", finishStatus: "complete", changeOrders: [{ id: "c4", coStatus: "pending", submittedAt: ago(30).toISOString() }] },
    { ...base, id: "j7", name: "Miller", foreman: "Vasa Mataafa", roughStatus: "inprogress", roughStage: "95%", matterportStatus: "", finishStage: "",
      finishProjectedStart: ymd(ago(-3)) },
    { ...base, id: "j9", name: "Ashcraft", foreman: "Old Foreman", roughStatus: "inprogress", roughStage: "40%" },
    { ...base, id: "j10", name: "", foreman: "Unassigned", roughStatus: "" },                 // empty shell record: ignored
    // v551 (decisions audit 2026-10-17) — the shapes the audit found against live Simpro:
    { ...base, id: "j11", name: "Sandlin Temp Ped", tempPed: true, simproNo: "1400", readyToInvoice: true, readyToInvoiceDate: "9/21/2026" },   // billed 100%, Simpro Invoiced
    { ...base, id: "j12", name: "Cowdrey", foreman: "Abraham Tristan", simproNo: "777", roughStatus: "complete", finishStatus: "inprogress", finishStage: "60%",   // closed in Simpro
      finishPunch: { main: { general: [{ id: "p1", text: "Cover plate" }, { id: "p2", text: "Label panel" }] } },
      finishQuestions: { main: [{ question: "Which plate?", addedAt: ago(30).toISOString(), addedBy: "Louis" }] },
      changeOrders: [{ id: "c6", coStatus: "approved", desc: "Extra can", quoteNumber: "6001" }] },
    { ...base, id: "j13", name: "Maddox", foreman: "Unassigned", simproNo: "778", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%" },   // closed in Simpro, no foreman
    { ...base, id: "j14", name: "Skyridge 208", foreman: "Abraham Tristan", simproNo: "1500", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%",
      readyToInvoice: true, finishUpdates: [{ createdAt: ago(1).toISOString(), text: "x", addedBy: "Abraham Tristan" }] },   // 62% billed
    { ...base, id: "j15", name: "Miller Ready", foreman: "Abraham Tristan", simproNo: "1600", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", readyToInvoice: true },   // not pulled yet
    { ...base, id: "j16", name: "Lot 23", foreman: "Abraham Tristan", simproNo: "1700", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%" },   // Complete but 80% billed: still open
    { ...base, id: "j8", name: "Nguyen", foreman: "Abraham Tristan", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finalInspectionResult: "fail",
      finalInspectionAttempts: [{ date: ymd(ago(5)), result: "fail", items: [] }, { date: ymd(ago(5)), result: "fail", items: [] }] },
  ];
  const needs = [{ id: "toneed_1", text: "Time off — James", timeoffId: "t1", status: "open", requestedBy: "James Livingston", dueDate: ymd(ago(-20)) },
    { id: "n2", text: "Call GC", status: "open", assignedTo: "Koy Wilkinson", priority: "urgent" }];
  const presence = { "Joel Old": new Date(2026, 7, 6).toISOString() };
  jobs[0].presence = presence;
  // v626: the shape settings/crewPTO really holds (the app's date picker writes M/D/YYYY). The year-first
  // sample this used to carry is why "Out this week" never showing went unnoticed.
  const pto = [{ name: "James Livingston", start: "10/14/2026", end: "10/16/2026", note: "PTO" }];
  const simTotals = {
    byNo: {
      "1304": { total: 41000, inv: 20500, invPct: 50, stage: "Progress", status: "Job - In Progress" },
      "920": { total: 63000, inv: 0, invPct: 0, stage: "Progress" },
      "881": { total: 9000, inv: 9000, invPct: 100, stage: "Progress" },                 // Thayne: billed in full, still in progress
      "1400": { total: 400, inv: 400, invPct: 100, stage: "Invoiced", status: "Receipts Reviewed" },
      "777": { total: 88000, inv: 88000, invPct: 100, stage: "Invoiced", status: "Receipts Reviewed" },
      "778": { total: 52000, inv: 51990, invPct: 99.98, stage: "Invoiced", status: "Receipts Reviewed" },
      "1500": { total: 52877, inv: 32643, invPct: 61.73, stage: "Progress" },
      "1700": { total: 30000, inv: 24000, invPct: 80, stage: "Complete", status: "Job - Ready to Invoice" },
    },
    quotes: { "5501": { total: 9800, stage: "Pending" }, "5502": { total: 3500, stage: "Pending" } },
  };
  const d = X.odModel({ jobs, users, needs, upcoming: [], foreman: "", range: 14, pto, simTotals, now });

  // 1. ROSTER
  eq(d.roster, ["Abraham Tristan", "James Livingston", "Vasa Mataafa", "Zane Watkins"], "roster = titled foremen + Vasa (named on jobs)");
  eq(d.noForemanJobs.map(j => j.name).sort(), ["Ashcraft", "Peterson", "Thayne"], "Paul, Unassigned and a deactivated foreman are no-foreman jobs");
  assert.ok(!d.roster.includes("Old Foreman"), "a deactivated person is never on the roster");
  assert.strictEqual(d.whyNoFm("Old Foreman"), "deactivated on the team list");
  assert.ok(/1 on Old Foreman \(deactivated\)/.test(d.noFmText), d.noFmText);
  eq(d.offTeam, ["Old Foreman", "Paul"], "names on jobs off the roster stay filterable");
  assert.ok(!d.allLive.some(j => !j.name), "nameless records are skipped");
  const nf = X.odModel({ jobs, users, needs, upcoming: [], foreman: X.OD_NOFM, range: 14, pto, simTotals, now });
  eq(nf.live.map(j => j.name).sort(), ["Ashcraft", "Maddox", "Peterson", "Sandlin Temp Ped", "Thayne"], "No foreman filter: those, plus closed-in-Simpro jobs with no foreman (v551)");
  eq(nf.active.map(j => j.name).sort(), ["Ashcraft", "Peterson", "Thayne"], "…of which only the open ones are active");
  assert.ok(d.byForeman["No foreman"] && !d.byForeman["Paul"], "Quality punch-by-foreman uses the same roster");

  // 2. RETURN TRIPS
  eq(d.rtSum, { open: 5, late: 2, booked: 1, tobook: 1, none: 1 }, "return-trip summary");
  assert.strictEqual(d.openRTs[0].ri.late, 10, "late first, most late first");
  assert.strictEqual(d.attnBy.rtLate.rows.length, 2);
  assert.ok(/not scheduled by/.test(d.attnBy.rtLate.rows[1].sub) && /visit was/.test(d.attnBy.rtLate.rows[0].sub), "two kinds of late labelled apart");

  // 3. FAILED ROUGH
  const kw = d.secOf(jobs[2]);
  assert.strictEqual(kw.key, "roughFail", "failed rough is not 'Rough done'");
  assert.ok(/re-inspect not booked/.test(kw.note), kw.note);
  assert.ok(d.needsDate.some(n => n.job && n.job.name === "Kweller" && n.what === "Rough re-inspection"), "asks for a re-inspection date");
  assert.ok(!d.needsDate.some(n => n.job && n.job.name === "Kweller" && n.what === "Finish start"), "no finish-start ask");
  const kw2 = { ...jobs[2], fourWayTargetDate: ymd(ago(-2)) };
  const d2 = X.odModel({ jobs: [kw2], users, needs: [], upcoming: [], now });
  assert.ok(/re-inspect 10\/17/.test(d2.secOf(kw2).note), "re-inspect date in the note");
  assert.ok(d2.sched.some(s => s.type === "insp" && s.label === "Rough re-inspection"), "re-inspection shows on the schedule");
  assert.ok(!d2.needsDate.some(n => n.job && n.job.name === "Kweller"), "booked re-inspection needs no date");

  // 4. DEDUPE — 3 Fail taps (two identical back-to-back) → 2 attempts in Activity and in the job rollup.
  assert.strictEqual(d.events.filter(e => e.type === "insp" && e.job.name === "Nguyen").length, 1, "Activity dedupes double taps");
  assert.strictEqual(d.failGroupOf["j8|Final"].noList, true, "a fail with no items and nothing live is flagged: no correction list");
  const g = d.failGroupOf["j3|Rough"];
  assert.strictEqual(g.n, 2); assert.strictEqual(d.failStatus(g), "not re-booked");

  // 5. QUESTIONS
  assert.strictEqual(d.openQs.length, 1); assert.strictEqual(d.openQs[0].age, 1, "46 hours = 1 full day, like punch ages");

  // 6. MONEY — v553: no Ready to invoice line and no dollars for it anywhere (Koy:
  //    "ready to invoice should not show numbers in the app"); invoicing comes from Simpro.
  assert.ok(!d.attnBy.invoice && !d.attn.some(a => /invoice/i.test(a.label) && !/change order/i.test(a.label)), "no Ready to invoice line");
  //    The Simpro sync's changes show for a week, newest first, and Undo puts them back.
  const syncJob = { ...base, id: "sy", name: "Synced", foreman: "Abraham Tristan", simproNo: "9001", roughStatus: "complete", finishStatus: "complete",
    changeOrders: [{ id: "k1", coStatus: "completed", desc: "Fan", completedBySync: ago(1).toISOString() }], coDoneDismissed: ["k1"],
    simproSync: { complete: ago(1).toISOString(), cos: { k1: ago(1).toISOString() }, log: [
      { at: ago(1).toISOString(), by: "Simpro sync", kinds: ["complete", "cos"], basis: { stage: "Invoiced", invPct: 100 },
        changes: [{ field: "finishStatus", from: "inprogress", to: "complete", undo: true }, { co: "k1", desc: "Fan", from: "approved", to: "completed", undo: true, prev: { taskChecks: null, punchDoneAt: "", punchDoneBy: "", needsByStart: "", needsByEnd: "", needsHardDate: false } }] },
      { at: ago(20).toISOString(), by: "Simpro sync", kinds: ["invoicedFull"], basis: { stage: "Progress", invPct: 100 }, changes: [{ field: "invoiceSent", from: false, to: true, undo: true }] }] } };
  const sdm = X.odModel({ jobs: [syncJob], users, needs: [], upcoming: [], simTotals: { byNo: { "9001": { total: 1, inv: 1, invPct: 100, stage: "Invoiced" } } }, now });
  eq([sdm.syncLog.length, sdm.syncWeek.length], [2, 1], "a week of sync changes on the dashboard");
  eq(sdm.closedSim.length + sdm.coBilled.length, 0, "nothing left to close by hand");
  const reopened = { ...syncJob, finishStatus: "inprogress", changeOrders: [{ id: "k1", coStatus: "approved", desc: "Fan" }] };
  const rd = X.odModel({ jobs: [reopened], users, needs: [], upcoming: [], simTotals: { byNo: { "9001": { total: 1, inv: 1, invPct: 100, stage: "Invoiced" } } }, now });
  eq([rd.closedSim.length, rd.coBilled.length, rd.active.length], [0, 0, 1], "undone by hand: counts as open again, not nagged to close");
  const up1 = X.odSyncUndo(syncJob, syncJob.simproSync.log[0]);
  eq([up1.finishStatus, up1.changeOrders[0].coStatus, "completedBySync" in up1.changeOrders[0], up1.coDoneDismissed, !!up1.simproSync.log[0].undoneAt, up1.simproSync.complete === syncJob.simproSync.complete],
    ["inprogress", "approved", false, [], true, true], "Undo: status and CO back, CO task back, memory kept so it is not redone");
  const sv = require("../functions/simproSync.js").undoPatch(syncJob, syncJob.simproSync.log[0]);
  eq([sv.finishStatus, sv.changeOrders, sv.coDoneDismissed], [up1.finishStatus, up1.changeOrders, up1.coDoneDismissed], "dashboard Undo = the server's undoPatch");
  // 60+ day change orders: quote $, summed per change order.
  const co60 = d.attnBy.coOld.rows;
  eq(co60.map(r => r.money), [9800, 3500], "each CO carries its own quote total, most first");
  assert.ok(/quote \$9\.8k/.test(co60[0].sub) && !/job value/.test(co60[0].sub), co60[0].sub);
  assert.strictEqual(d.attnBy.coOld.extra, "on 1 job, quotes $13k", "quotes $9.8k + $3.5k, not the $63k job value");
  // Thayne (live, 10/17): 14 COs on one Simpro quote — the quote counts once.
  const shared = { ...base, id: "js", name: "Thayne", simproNo: "881", changeOrders: [1, 2, 3].map(i => ({ id: "s" + i, coStatus: "pending", submittedAt: ago(123).toISOString(), desc: "Outlet " + i, quoteNumber: "7001" })) };
  const sq = X.odModel({ jobs: [shared], users, needs: [], upcoming: [], simTotals: { byNo: {}, quotes: { "7001": { total: 2300 } } }, now });
  assert.strictEqual(sq.attnBy.coOld.extra, "on 1 job, quotes $2.3k", "one quote under three COs counts once");
  assert.ok(/quote \$2\.3k, one quote for 3 COs/.test(sq.attnBy.coOld.rows[0].sub), sq.attnBy.coOld.rows[0].sub);
  const noQ = X.odModel({ jobs: [jobs[1]], users, needs: [], upcoming: [], simTotals: { byNo: {}, quotes: {} }, now });
  assert.ok(/Quote 5501, no \$ yet/.test(noQ.attnBy.coOld.rows[0].sub), noQ.attnBy.coOld.rows[0].sub);
  assert.strictEqual(noQ.attnBy.coOld.extra, "on 1 job");
  eq(d.coBy, { needs_sending: 1, pending: 3, approved: 0, billed: 2, scheduled: 0, other: 0 });
  assert.strictEqual(d.coOnDone.length, 1, "open CO on a finished job is counted apart");

  // 7. PEOPLE
  const st = Object.fromEntries(d.people.map(p => [p.name, p.status]));
  assert.strictEqual(st["James Livingston"], "off"); assert.strictEqual(st["Joel Old"], "gone");
  assert.strictEqual(st["Zane Watkins"], "gone", "never seen → gone (not quiet)");
  assert.strictEqual(st["Abraham Tristan"], "earlier"); assert.strictEqual(st["Vasa Mataafa"], "quiet", "quiet = 3–30 days while running an active job");
  assert.strictEqual(d.teamN, 2, "off and gone people are left out of the on-app denominator");

  // 8. PLANS
  const f0 = { id: "unmatched_email_1", type: "unmatched_plan", item: "email_1", seen: true, createdAt: ago(3).toISOString(), bestGuess: "#920" };
  const f1 = { id: "unmatched_email_2", type: "unmatched_plan", item: "email_2", seen: true, createdAt: ago(2).toISOString() };
  const f2 = { id: "filed_email_2", type: "plans_filed", createdAt: ago(1).toISOString() };
  const f3 = { id: "unmatched_email_3", type: "unmatched_plan", item: "email_3", createdAt: ago(1).toISOString(), resolved: true };
  const pm = X.odPlanModel([f2, f3, f1, f0], now);
  eq(pm.waiting.map(f => f.id), ["unmatched_email_1"], "seen but unfiled still waits; filed or resolved does not");
  assert.ok(pm.byNo["920"], "plan waiting is findable by job number");

  // 9. DOCS — the Wednesday card reads the "weekly" stamp (foremanMeetingPrep, due Tue 4 PM);
  //    the Friday card reads the "friday" stamp (strategyPrep, due Fri 6 AM). v544.
  const wed = X.OD_DOCS.find(x => x.k === "wednesday");
  const missed = X.odDocStatus(wed, { latestDocs: {}, runs: { weekly: { lastRunAt: new Date(2026, 9, 6, 16, 2).toISOString(), ok: true } }, now });
  assert.ok(missed.missed && /did not run Tue/.test(missed.text), missed.text);
  const none = X.odDocStatus(wed, { latestDocs: {}, runs: {}, now });
  assert.ok(!none.missed && none.tone === "" && /no run recorded/.test(none.text), "nothing on record is not a missed run");
  const made = X.odDocStatus(wed, { latestDocs: {}, runs: { weekly: { lastRunAt: new Date(2026, 9, 13, 16, 2).toISOString(), ok: true } }, now });
  assert.strictEqual(made.tone, "good");
  const failed = X.odDocStatus(wed, { latestDocs: {}, runs: { weekly: { lastRunAt: new Date(2026, 9, 13, 16, 2).toISOString(), ok: false, error: "Drive 403" } }, now });
  assert.ok(failed.tone === "bad" && /Drive 403/.test(failed.text), failed.text);
  const fri = X.OD_DOCS.find(x => x.k === "friday");
  eq([fri.latest, fri.by], ["friday", "App (strategyPrep)"], "Friday card reads the autoDocsLatest 'friday' key");
  const friMade = X.odDocStatus(fri, { latestDocs: { friday: { url: "u", name: "Friday Strategy Prep — Oct 9, 2026", createdTime: new Date(2026, 9, 9, 6, 4).toISOString() } }, runs: { friday: { lastRunAt: new Date(2026, 9, 9, 6, 4).toISOString(), ok: true } }, now });
  assert.ok(friMade.tone === "good" && /made Fri/.test(friMade.text), friMade.text);
  const friMissed = X.odDocStatus(fri, { latestDocs: {}, runs: { friday: { lastRunAt: new Date(2026, 9, 2, 6, 4).toISOString(), ok: true } }, now });
  assert.ok(friMissed.missed && /did not run Fri 6:00 AM/.test(friMissed.text), friMissed.text);
  assert.ok(!X.OD_DOCS.some(x => ["packet", "lead", "weekly", "strategy"].includes(x.k)), "retired doc keys are gone (packet / lead / weekly / strategy)");
  eq(X.OD_DOCS.filter(x => x.latest).map(x => x.latest), ["monday", "wednesday", "friday"], "latest keys match functions/autoDocs.js AUTO_DOC_SOURCES");

  // 12. CLOSED IN SIMPRO (v551)
  eq(d.closedSim.map(j => j.name), ["Cowdrey", "Maddox", "Sandlin Temp Ped"], "Invoiced / Complete at 99.5%+ while open here");
  const act = d.active.map(j => j.name);
  assert.ok(!act.includes("Cowdrey") && !act.includes("Maddox") && !act.includes("Sandlin Temp Ped"), "closed in Simpro is not active");
  assert.ok(act.includes("Lot 23"), "Simpro Complete at 80% billed stays active");
  assert.ok(act.includes("Thayne"), "billed in full but still in progress in Simpro stays active");
  assert.ok(!d.openPunch.some(p => p.job.name === "Cowdrey"), "its punch leaves the open-punch count");
  assert.strictEqual(d.info.j12.punch.length, 2, "the punch is still there on the job");
  assert.ok(!d.attnBy.quiet.rows.some(r => r.job.name === "Cowdrey" || r.job.name === "Maddox"), "not a quiet job");
  assert.ok(!d.noForemanJobs.some(j => j.name === "Maddox"), "not a no-foreman job");
  assert.ok(!d.openQs.some(x => x.job.name === "Cowdrey") && d.info.j12.questions.length === 1, "its crew question leaves the count but stays on the job");
  assert.ok(!d.byForeman["Abraham Tristan"].items.some(p => p.job.name === "Cowdrey"), "foreman card punch leaves it out");
  const noSim = X.odModel({ jobs, users, needs, upcoming: [], foreman: "", range: 14, pto, simTotals: null, now });
  assert.ok(noSim.active.some(j => j.name === "Cowdrey") && !noSim.closedSim.length, "with no Simpro pull nothing is hidden");

  // 13. BILLED COs (v551) — the parent job is what Simpro bills.
  eq(d.coBilled.map(x => x.job.name).sort(), ["Cowdrey", "Thayne"], "approved COs on jobs billed in full");
  assert.strictEqual(d.attnBy.coBilled.label, "Approved change orders Simpro has billed — mark done?");
  assert.ok(/Billed: job 100% invoiced in Simpro · mark the CO done/.test(d.attnBy.coBilled.rows[0].sub), d.attnBy.coBilled.rows[0].sub);
  const partly = X.odModel({ jobs: [jobs[3]], users, needs: [], upcoming: [], simTotals: { byNo: { "881": { total: 9000, inv: 4000, invPct: 44, stage: "Progress" } } }, now });
  eq([partly.coBy.approved, partly.coBy.billed, partly.attnBy.coBilled.rows.length], [1, 0, 0], "a partly billed job's approved CO is still work to book");

  // 10. MONEY CANDIDATES (functions/fridayPacket.js, what dailySimproTotals fetches) — v551:
  //     every ready-to-invoice job first and uncapped, then COs, then every open job.
  const fp = require("../functions/fridayPacket.js");
  const cand = [
    { simproNo: "1", readyToInvoice: true, finishStatus: "complete" },
    { simproNo: "2", readyToInvoice: true, invoiceDismissed: true, finishStatus: "complete" },
    { simproNo: "3", finishStatus: "complete", changeOrders: [{ coStatus: "pending", submittedAt: ago(61).toISOString(), quoteNumber: "901" }] },
    { simproNo: "4", finishStatus: "complete", changeOrders: [{ coStatus: "pending", submittedAt: ago(10).toISOString(), quoteNumber: "902" }] },
    { simproNo: "5", finishStatus: "complete", changeOrders: [{ coStatus: "approved" }] },
    { simproNo: "6", finishStatus: "complete", changeOrders: [{ coStatus: "completed" }] },
    { simproNo: "7", type: "quote", readyToInvoice: true },
    { simproNo: "", readyToInvoice: true },
    { simproNo: "8", roughStatus: "inprogress" },                                    // open job → Stage / billed %
    { simproNo: "9", quickJob: true, quickJobStatus: "invoice" },                     // quick job invoiced = finished
    { simproNo: "10", tempPed: true, tempPedStatus: "" },                             // temp ped not completed = open
    { simproNo: "11", archived: true, roughStatus: "inprogress" },
    { simproNo: "12", finishStatus: "complete", changeOrders: [{ coStatus: "pending", submittedAt: ago(57).toISOString(), quoteNumber: "#903" }, { coStatus: "pending", submittedAt: ago(80).toISOString(), quoteNumber: "901" }] },
    { simproNo: "13", finishStatus: "complete", simproInvoicedPct: 100 },               // v553: finished and invoiced in full → no longer watched
  ];
  eq(fp.collectMoneyCandidates(cand, now), ["1", "3", "12", "5", "4", "8", "10", "2", "6", "9"], "ready to invoice, 55+ d COs, approved COs, finished with open COs, open jobs, then (v553) finished jobs not yet invoiced in full");
  // v626 ship 2: finished and invoiced in full is still re-read while Simpro's amount last moved under 60 days ago
  // (Barry #1406: $272 added in Simpro after it read 100%); after that, or with no date, it drops off as before.
  const settle = (no, days) => ({ simproNo: no, finishStatus: "complete", simproInvoicedPct: 100, ...(days == null ? {} : { simproInvoicedSeenAt: ago(days).toISOString() }) });
  eq(fp.collectMoneyCandidates([settle("20", 14), settle("21", 59), settle("22", 61), settle("23", null), { simproNo: "24", roughStatus: "inprogress" }], now), ["24", "20", "21"], "open jobs first, then finished jobs still settling");
  const many = Array.from({ length: 300 }, (_, i) => ({ simproNo: String(1000 + i), roughStatus: "inprogress" }));
  const capped = fp.collectMoneyCandidates([...many, { simproNo: "77", readyToInvoice: true, finishStatus: "complete" }], now);
  assert.strictEqual(capped.length, 250, "250 Simpro reads at most; ready to invoice always gets in");
  assert.strictEqual(capped[0], "77", "ready to invoice first even when listed last");
  eq(fp.collectQuoteCandidates(cand, now), ["901", "903"], "quotes of COs pending 55+ days, '#' dropped, once each");

  // 14. v552
  //  Item 5 — suggested foreman from Simpro's technicians.
  const tj = (id, name, foreman, sn, extra = {}) => ({ ...base, id, name, foreman, simproNo: sn, roughStatus: "inprogress", roughStage: "40%", ...extra });
  const sugJobs = [tj("t1", "Vasa job", "Vasa Gone", "3001"), tj("t2", "Tech off team", "Unassigned", "3002"), tj("t3", "Crew tech", "", "3003"), tj("t4", "No tech", "Unassigned", "3004")];
  const sugUsers = [...users, { id: "vg", name: "Vasa Gone", title: "foreman", active: false }, { id: "cr", name: "Crew Member", title: "crew" }];
  const sugSim = { byNo: { "3001": { total: 1, inv: 0, invPct: 0, stage: "Progress", techs: ["Zane Watkins"] }, "3002": { total: 1, inv: 0, invPct: 0, stage: "Progress", techs: ["Someone Else"] },
    "3003": { total: 1, inv: 0, invPct: 0, stage: "Progress", techs: ["Crew Member"] }, "3004": { total: 1, inv: 0, invPct: 0, stage: "Progress" } } };
  const sd = X.odModel({ jobs: sugJobs, users: sugUsers, needs: [], upcoming: [], simTotals: sugSim, now });
  eq(sd.noForemanJobs.map(j => [j.name, sd.suggestFm(j)]), [["Vasa job", "Zane Watkins"], ["Tech off team", ""], ["Crew tech", "Crew Member"], ["No tech", ""]],
    "a foreman on the list first, else an active team member; nobody off the team; nothing when Simpro has no technician");
  //  Item 6 — coordinator: set on the job, else the foreman's book; filter by it.
  const cUsers = users.map(u => u.name === "Abraham Tristan" ? { ...u, coordinator: "Josh Cloward" } : u);
  const cJobs = [tj("c1", "Book job", "Abraham Tristan", ""), tj("c2", "Own job", "Abraham Tristan", "", { coordinator: "Brady Nelson" }), tj("c3", "Nobody's", "Zane Watkins", "")];
  const cd = X.odModel({ jobs: cJobs, users: cUsers, needs: [], upcoming: [{ name: "Up Abe", foreman: "Abraham Tristan" }, { name: "Up Zane", foreman: "Zane Watkins" }], now });
  eq(cJobs.map(j => cd.coordOf(j)), [{ name: "Josh Cloward", via: "book" }, { name: "Brady Nelson", via: "job" }, { name: "", via: "" }], "job first, then the foreman's book");
  eq(X.OD_COORDS, ["Koy Wilkinson", "Josh Cloward", "Brady Nelson", "Justin Cloward"]);
  const josh = X.odModel({ jobs: cJobs, users: cUsers, needs: [], upcoming: [{ name: "Up Abe", foreman: "Abraham Tristan" }, { name: "Up Zane", foreman: "Zane Watkins" }], coordinator: "Josh Cloward", now });
  eq([josh.active.map(j => j.name), josh.up.map(u => u.name)], [["Book job"], ["Up Abe"]], "Josh's filter: his book (not the job Brady owns) and his upcoming jobs");
  eq(X.odModel({ jobs: cJobs, users: cUsers, needs: [], upcoming: [], coordinator: X.OD_NOCOORD, now }).active.map(j => j.name), ["Nobody's"], "No coordinator filter");
  //  Item 8 — one Needs a date: jobs only; upcoming with no date counted apart.
  const nd = X.odModel({ jobs: [tj("n1", "Dateless", "Zane Watkins", "", { roughStatus: "", roughStage: "" })], users, needs: [], upcoming: [{ name: "Up none" }, { name: "Up dated", projectedStart: "11/2/2026" }], now });
  eq([nd.needsDate.map(n => n.job && n.job.name), nd.attnBy.needsDate.rows.length, nd.upNoDate.map(u => u.name)], [["Dateless"], 1, ["Up none"]], "Overview, Schedule and Jobs read the same list");
  //  Item 7 — Move / unconfirm patch (Namjoshi and Rose on 2026-10-17).
  const namjoshi = { roughStatus: "date_confirmed", roughProjectedStart: "10/19/2026", roughStartConfirmed: true };
  eq(X.odStartPatch(namjoshi, "rough", { confirm: false }), { roughStartConfirmed: false, roughStatus: "waiting_date" }, "unconfirm keeps the date, status back to Awaiting Start Date");
  eq(X.odStartPatch(namjoshi, "rough", { date: "2026-10-26" }), { roughProjectedStart: "10/26/2026", roughStartConfirmed: false, roughStatus: "waiting_date" }, "a moved start is projected");
  eq(X.odStartPatch({ finishStatus: "date_confirmed" }, "finish", { date: "2026-11-02", confirm: true }), { finishProjectedStart: "11/2/2026", finishStartConfirmed: true, finishStatus: "date_confirmed" }, "move and confirm");
  eq(X.odStartPatch({ roughStatus: "inprogress" }, "rough", {}), { roughStartConfirmed: false }, "never touches a started status");
  eq(X.odStartPatch({ roughStatus: "scheduled" }, "rough", { date: "bad" }), { roughStartConfirmed: false, roughStatus: "waiting_date" }, "a bad date writes no date");

  // 11. WHO OPENS THE PAGE (v543): any active admin, by access or legacy role; nobody else.
  assert.strictEqual(X.canOpenDash({ id: "koy", name: "Koy Wilkinson", access: "admin" }), true);
  assert.strictEqual(X.canOpenDash({ id: "u1", name: "Josh Cloward", role: "admin" }), true, "legacy admin role counts");
  assert.strictEqual(X.canOpenDash({ id: "u2", name: "Keegan Wilkinson", access: "manager" }), false, "managers do not");
  assert.strictEqual(X.canOpenDash({ id: "u3", name: "Old Admin", access: "admin", active: false }), false, "a deactivated admin does not");
  assert.strictEqual(X.canOpenDash(null), false);
  assert.ok(X.OD_DOCS.filter(x => x.koyOnly).map(x => x.k).join() === "bonus,ninety", "Koy's own doc tiles are marked");

  // 12. v626 TRUTH FIXES (dashboard audit 2026-11-11)
  //  Time off typed 10/14/2026 must read as out this week and off today.
  eq(d.ptoWeek.map(p => [p.name, p.start, p.end]), [["James Livingston", "2026-10-14", "2026-10-16"]], "M/D/YYYY time off shows in Out this week");
  assert.ok(d.offToday("James Livingston"), "…and counts as off today");
  assert.ok((d.people.find(p => p.name === "James Livingston") || {}).off, "the person's row carries the approved day off");
  eq(X.odModel({ jobs: [], users, needs: [], upcoming: [], pto: [{ name: "X", start: "garbage" }, { name: "Y", start: "10/16/2026", end: "10/15/2026" }, { name: "Z", start: "2026-10-20" }], now }).ptoList.map(p => [p.name, p.start, p.end]),
    [["Y", "2026-10-15", "2026-10-16"], ["Z", "2026-10-20", "2026-10-20"]], "unreadable start dropped; reversed dates put right; year-first still works");
  //  Complete in Simpro at 80% billed: still an active job, and listed for Koy.
  eq(d.simDoneOpen.map(j => j.name), ["Lot 23"], "Complete in Simpro, still open here");
  assert.ok(d.active.some(j => j.name === "Lot 23") && !d.closedSim.some(j => j.name === "Lot 23"), "…it stays active and is not in Closed in Simpro");
  assert.ok(!d.simDoneOpen.some(j => d.closedSim.includes(j)), "the two lists never share a job");
  //  How old the Simpro copy is (pull = weekdays 6:15 AM).
  const pulled = (y, m, dd) => new Date(y, m, dd, 6, 15).toISOString();
  const today615 = X.odSimAsOf(pulled(2026, 9, 15), now);
  assert.ok(!today615.stale && /as of today 6:15/.test(today615.text), today615.text);
  const wedOnly = X.odSimAsOf(pulled(2026, 9, 14), now);
  assert.ok(wedOnly.stale && /did not run/.test(wedOnly.text), "Thursday 7:30 with only Wednesday's pull = this morning's was missed");
  assert.strictEqual(X.odSimAsOf(pulled(2026, 9, 16), new Date(2026, 9, 18, 15, 0)).stale, false, "Friday's pull is fine on Sunday");
  assert.strictEqual(X.odSimAsOf(pulled(2026, 9, 16), new Date(2026, 9, 19, 6, 30)).stale, false, "…and on Monday before the pull is due");
  assert.strictEqual(X.odSimAsOf(pulled(2026, 9, 16), new Date(2026, 9, 19, 8, 0)).stale, true, "…but not after Monday 7 AM");
  assert.ok(X.odSimAsOf("", now).stale && /no pull/.test(X.odSimAsOf(null, now).text), "no stamp at all is said plainly");
  //  A "Run now" test is not the real run.
  const testRun = X.odDocStatus(wed, { latestDocs: {}, runs: { weekly: { lastRunAt: new Date(2026, 9, 13, 16, 2).toISOString(), ok: true, test: true } }, now });
  eq([testRun.tone, testRun.text], [none.tone, none.text], "a test run alone reads the same as nothing on record, not green");
  const testFail = X.odDocStatus(wed, { latestDocs: {}, runs: { weekly: { lastRunAt: new Date(2026, 9, 13, 16, 2).toISOString(), ok: false, error: "x", test: true } }, now });
  assert.notStrictEqual(testFail.tone, "bad", "a failed test does not turn the card red either");
  //  A plan nobody filed keeps waiting past 14 days; a note that only waits to be seen does not come back.
  const oldPlan = { id: "unmatched_email_9", type: "unmatched_plan", item: "email_9", createdAt: ago(40).toISOString() };
  const oldFiled = { id: "unmatched_email_8", type: "unmatched_plan", item: "email_8", createdAt: ago(40).toISOString(), resolved: true };
  const pm2 = X.odPlanModel([f0, oldPlan, oldFiled], now);
  eq(pm2.waiting.map(f => f.id), ["unmatched_email_9", "unmatched_email_1"], "oldest first, the 40-day-old one included; a resolved old one is not");
  assert.strictEqual(pm2.oldest.id, "unmatched_email_9");
  assert.ok(!pm2.fl.some(f => f.id === "unmatched_email_9"), "the 14-day activity list itself is unchanged");

  // 13. v628 SHIP 3a — answers from the overnight data (shapes read live 2026-11-11 / 11-12)
  //  a. Labor used before finish starts (settings/phaseHours: r / f = [used, estimate] by Simpro number).
  const hrs = { "1107": { r: [1248.5, 394.4], f: [28.6, 410.9] }, "1430": { r: [567.8, 341.7], f: [5.9, 233.4] }, "1291": { r: [920.1, 553.1], f: [311.3, 477.6] },
    "1438": { r: [500, 789.4], f: [0, 639.7] }, "7000": { r: [300, 100] }, "7001": { r: [95, 100], f: [0, 0] }, "7002": { r: [500, 100], f: [0, 100] }, "7003": { r: [500, 100], f: [0, 100] } };
  const lj = [
    tj("l1", "Kweller", "Zane Watkins", "1107", { roughStatus: "complete", roughStage: "100%", finishStatus: "waiting_date" }),          // rough done, finish not started
    tj("l2", "Brandt", "Zane Watkins", "1430", { roughStatus: "inprogress", roughStage: "95%" }),                                        // still in rough
    tj("l3", "Ashcraft", "Zane Watkins", "1291", { roughStatus: "complete", finishStatus: "inprogress", finishStage: "45%" }),          // finish started: not this list
    tj("l4", "Miller", "Zane Watkins", "1438", { roughStatus: "complete", finishStatus: "waiting_date" }),                              // 35% used: fine
    tj("l5", "Building A", "Zane Watkins", "7000", {}), tj("l6", "Building B", "Zane Watkins", "7000", {}),                             // one Simpro # on two jobs: skipped
    tj("l7", "Rough-only estimate", "Zane Watkins", "7001", {}),                                                                        // 95% of a rough-only estimate
    tj("l8", "Quick one", "Zane Watkins", "7002", { quickJob: true, quickJobStatus: "inprogress" }),
    tj("l9", "Shop TI", "Zane Watkins", "7003", { division: "commercial" }),
    tj("l10", "No hours row", "Zane Watkins", "7999", {}),
  ];
  const ld = X.odModel({ jobs: lj, users, needs: [], upcoming: [], hours: hrs, now });
  eq(ld.laborEarly.map(x => [x.job.name, x.used, x.est, Math.round(x.pct * 100)]), [["Kweller", 1277, 805, 159], ["Brandt", 574, 575, 100], ["Rough-only estimate", 95, 100, 95]],
    "worst first; a job in finish, a job under 90%, a shared Simpro #, a quick job, a commercial job and a job with no hours row are not listed");
  const le = ld.attnBy.laborEarly.rows[0];
  assert.ok(/1,277 of 805 estimated hours used/.test(le.sub) && le.right === "159%" && le.job.name === "Kweller", le.sub);
  eq(X.odModel({ jobs: lj, users, needs: [], upcoming: [], now }).laborEarly, [], "no hours doc yet: no rows, no crash");
  eq(X.odLaborEarly(lj, { "1107": { r: ["x", null], f: [] } }, () => ({ key: "between", label: "b" })), [], "junk numbers are zero, not NaN rows");
  assert.ok(!X.OD_BEFORE_FINISH.includes("finish") && !X.OD_BEFORE_FINISH.includes("punchList") && X.OD_BEFORE_FINISH.includes("between"));
  //  b. Simpro technician vs who runs the job here. Crews: Abe's crew = Abe + Vasa (foremanId).
  const tUsers = users.map(u => u.id === "vasa" ? { ...u, foremanId: "abe" } : u);
  const tJobs = [tj("t1", "Same person", "Abraham Tristan", "801"), tj("t2", "Same crew", "Abraham Tristan", "802"), tj("t3", "Lead is the tech", "Zane Watkins", "803", { lead: "Vasa Mataafa" }),
    tj("t4", "Vista Meadows", "Abraham Tristan", "804"), tj("t5", "No tech", "Abraham Tristan", "805"), tj("t6", "Other crew", "Zane Watkins", "806"),
    tj("t7", "Not read", "Abraham Tristan", "807"), tj("t8", "Nobody here", "", "808"), tj("t9", "Quick", "Abraham Tristan", "809", { quickJob: true, quickJobStatus: "inprogress" })];
  const tSim = { byNo: { "801": { techs: ["Abraham Tristan"] }, "802": { techs: ["Vasa Mataafa"] }, "803": { techs: ["Vasa Mataafa"] }, "804": { techs: ["Jonathan Harding"] }, "805": { techs: [] },
    "806": { techs: ["Vasa Mataafa"] }, "807": { total: 5 }, "808": { techs: ["Jonathan Harding"] }, "809": { techs: ["Jonathan Harding"] } } };
  const td = X.odModel({ jobs: tJobs, users: tUsers, needs: [], upcoming: [], simTotals: tSim, now });
  eq(td.techDiff.map(x => [x.job.name, x.kind]), [["Vista Meadows", "gone"], ["No tech", "none"], ["Other crew", "other"]],
    "left the team first, then no technician, then another crew; same person, same crew, the lead, an unread job, a job with nobody named and a quick job agree or are skipped");
  assert.ok(/Jonathan Harding is not on the team/.test(td.techDiff[0].text) && /Abraham's crew/.test(td.techDiff[2].text), td.techDiff[2].text);
  assert.ok(/here: Abraham Tristan/.test(td.attnBy.techDiff.rows[0].sub) && td.attnBy.techDiff.rows[0].right === "#804");
  //  c. Invoiced in full, then more added in Simpro (Barry #1406: 98.6% after reading 100%).
  const bJobs = [tj("b1", "Barry", "Abraham Tristan", "1406", { roughStatus: "complete", finishStatus: "complete", invoiceSent: true }),
    tj("b2", "Sync said so", "Abraham Tristan", "901", { roughStatus: "complete", finishStatus: "complete", simproSync: { invoiceSent: "2026-10-28T12:15:17.574Z" } }),
    tj("b3", "Never invoiced in full", "Abraham Tristan", "902", { roughStatus: "complete", finishStatus: "complete" }),
    tj("b4", "Still full", "Abraham Tristan", "903", { roughStatus: "complete", finishStatus: "complete", invoiceSent: true }),
    tj("b5", "Open job", "Abraham Tristan", "904", { roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", invoiceSent: true }),
    tj("b6", "Pennies", "Abraham Tristan", "905", { roughStatus: "complete", finishStatus: "complete", invoiceSent: true })];
  const bSim = { byNo: { "1406": { total: 19615.48, inv: 19343.21, invPct: 98.61, stage: "Complete" }, "901": { total: 1000, inv: 400, invPct: 40, stage: "Complete" }, "902": { total: 1000, inv: 400, invPct: 40, stage: "Progress" },
    "903": { total: 1000, inv: 1000, invPct: 100, stage: "Invoiced" }, "904": { total: 1000, inv: 400, invPct: 40, stage: "Progress" }, "905": { total: 100, inv: 99.4, invPct: 99.4, stage: "Invoiced" } } };
  const bd = X.odModel({ jobs: bJobs, users, needs: [], upcoming: [], simTotals: bSim, now });
  eq(bd.billedThenMore.map(j => [j.name, Math.round(bd.leftOf(j))]), [["Sync said so", 600], ["Barry", 272]], "largest unbilled first; never-invoiced, still-full, open and under-a-dollar jobs are not listed");
  //  d. Feed health (settings/dashFeeds as dashHistoryNightly wrote it 2026-11-12 6:45 AM).
  const okFeeds = { at: "2026-11-12T13:45:05.433Z", feeds: { costs: { label: "Job Costs", ok: true, at: "2026-11-12T11:15:23.580Z", ageH: 2.5, error: "" }, goals: { label: "Goals", ok: true, at: "2026-11-12T12:40:04.237Z", ageH: 1.1, error: "" },
    scoreboard: { label: "Scoreboard", ok: true, at: "2026-11-12T12:20:56.216Z", ageH: 1.4, error: "" }, totals: { label: "Simpro totals", ok: true, at: "2026-11-12T13:15:38.915Z", ageH: 0.5, error: "" } } };
  const seven = new Date("2026-11-12T14:00:00.000Z");
  eq(X.odFeedProblems(okFeeds, seven).rows, [], "the clean night: nothing to show");
  eq([X.odFeedProblems(null, seven).rows, X.odFeedProblems({}, seven).rows, X.odFeedProblems({ at: "2026-11-12T13:45:05.433Z" }, seven).rows], [[], [], []], "no doc yet (before the first run): silent, not an alarm");
  const badFeeds = { ...okFeeds, feeds: { ...okFeeds.feeds, goals: { label: "Goals", ok: false, late: false, at: "2026-11-11T12:40:12.748Z", ageH: 25, error: "only 100 of 204 jobs came back" }, totals: { label: "Simpro totals", ok: false, late: true, at: "", ageH: null, error: "" } } };
  const feedRows = X.odFeedProblems(badFeeds, seven).rows;
  eq(feedRows.map(r => r.title), ["Goals: last pull failed", "Simpro totals: pull is late"], "only the feeds that are not ok, in a fixed order");
  assert.ok(/only 100 of 204 jobs came back/.test(feedRows[0].sub) && /last good pull/.test(feedRows[0].sub) && /no pull on record/.test(feedRows[1].sub), feedRows[0].sub);
  const staleCheck = X.odFeedProblems(okFeeds, new Date("2026-11-14T14:00:00.000Z")).rows;
  eq(staleCheck.map(r => r.k), ["check"], "a check over 30 hours old says the check itself did not run");

  // 14. v629 SHIP 3b (in its own block: this file is one long scope)
  {
  const localDay = (t) => t ? `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}` : "";
  //  a. Work days: weekends do not count against anyone.
  const D = (y, m, dd, h = 9) => new Date(y, m, dd, h);
  eq([X.odWorkDaysSince(D(2026, 10, 13, 15), D(2026, 10, 16, 8)), X.odWorkDaysSince(D(2026, 10, 12), D(2026, 10, 17)), X.odWorkDaysSince(D(2026, 10, 16), D(2026, 10, 16, 17)), X.odWorkDaysSince(D(2026, 10, 14), D(2026, 10, 15)), X.odWorkDaysSince(null, now)],
    [1, 3, 0, 0, 0], "Fri → Mon is 1; Thu → Tue is 3 (Fri, Mon, Tue); same day 0; Sat → Sun 0");
  //  b. People are counted from every job, whatever the filter or division. Monday 8 AM clock.
  const mon = new Date(2026, 10, 16, 8, 0);                                   // Mon Nov 16 2026
  const agoM = (n, h = 15) => new Date(2026, 10, 16 - n, h, 0);
  const pUsers = [{ id: "abe", name: "Abraham Tristan", title: "foreman" }, { id: "zane", name: "Zane Watkins", title: "foreman" }, { id: "kee", name: "Keegan Wilkinson", title: "foreman" }];
  const upd = (who, at) => [{ createdAt: at.toISOString(), text: "x", addedBy: who }];
  const resi = [tj("p1", "Abe resi job", "Abraham Tristan", "", { roughUpdates: upd("Abraham Tristan", agoM(3)) }),               // Friday 3 PM
    tj("p2", "Zane resi job", "Zane Watkins", "", { roughUpdates: upd("Zane Watkins", agoM(5)) })];                                   // Wednesday: 3 work days ago
  const comm = [{ ...tj("p3", "Shop TI", "Keegan Wilkinson", "", { roughUpdates: upd("Keegan Wilkinson", agoM(0, 7)) }), division: "commercial" }];   // today, on a commercial job
  const st = (dd) => dd.people.map(p => `${p.name}: ${p.status}`).sort();
  const both = X.odModel({ jobs: resi, allJobs: [...resi, ...comm], users: pUsers, needs: [], upcoming: [], now: mon });
  eq(st(both), ["Abraham Tristan: earlier", "Keegan Wilkinson: active", "Zane Watkins: quiet"], "Friday's update is not quiet on Monday; Wednesday's is; a commercial-only foreman counts in Residential view");
  const filt = X.odModel({ jobs: resi, allJobs: [...resi, ...comm], users: pUsers, needs: [], upcoming: [], foreman: "Zane Watkins", now: mon });
  eq(st(filt), st(both), "a foreman filter changes no one's status");
  eq([filt.events.map(e => e.job.name), filt.evById.p1.length, !!filt.lastAct.p1, filt.liveIds.has("p1")], [["Zane resi job"], 1, true, false], "the feed follows the filter; a job outside it still has its events and last work for the job pop-up");
  eq(X.odModel({ jobs: resi, users: pUsers, needs: [], upcoming: [], now: mon }).people.find(p => p.name === "Keegan Wilkinson").status, "gone", "without allJobs (older callers) it is this division only, as before");
  eq(both.people.find(p => p.name === "Keegan Wilkinson").jobsOn.map(j => j.name), ["Shop TI"], "jobs a person runs include the other division's");
  //  c. A Simpro sync stamp is in the feed but is not work.
  const autoJob = [tj("a1", "Synced CO", "Abraham Tristan", "", { roughUpdates: upd("Abraham Tristan", agoM(9)), changeOrders: [{ id: "c", coStatus: "approved", desc: "Add can", coStatusSyncedAt: agoM(0, 6).toISOString() }] })];
  const am = X.odModel({ jobs: autoJob, users: pUsers, needs: [], upcoming: [], now: mon });
  assert.ok(am.events.some(e => /\(Simpro\)/.test(e.label)), "the sync row still shows in the feed");
  eq(localDay(am.lastAct.a1), localDay(agoM(9)), "last work is the crew's update nine days ago, not this morning's sync stamp");
  assert.ok(am.attnBy.quiet.rows.some(r => r.job.id === "a1"), "so the job is still listed as quiet");
  //  d. A failed inspection on a finished job is its own line, not a re-book.
  const fj = [tj("f1", "Vista Meadows", "Abraham Tristan", "", { roughStatus: "complete", finishStatus: "complete", finalInspectionResult: "fail", finalInspectionAttempts: [{ date: "10/22/2026", result: "fail", items: [] }] }),
    tj("f2", "Open fail", "Abraham Tristan", "", { roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", finalInspectionResult: "fail", finalInspectionAttempts: [{ date: "11/10/2026", result: "fail", items: [] }] })];
  const fm = X.odModel({ jobs: fj, users: pUsers, needs: [], upcoming: [], now: mon });
  eq([fm.failOpenG.map(g => g.job.name), fm.notRebooked.map(g => g.job.name), fm.failClosed.map(g => g.job.name), fm.attnBy.failClosed.rows.map(r => r.title)], [["Open fail"], ["Open fail"], ["Vista Meadows"], ["Vista Meadows"]]);
  //  e. Stage differences, from the stage sync's plan as written 2026-11-12 4:45 AM (settings/simproStageSync).
  const syncDoc = { lastRunAt: "2026-11-12T11:45:06.467Z", modeRan: "dry", rows: [
    { action: "skip", conflict: true, id: "1773243207133", name: "Menlove Additions", reason: "no Simpro # on the job", sn: "" },
    { action: "set", fromName: "Job - Punch List", id: "1773186762720", name: "Wade Residence", result: "would change", section: "Completed", sn: "694", toName: "Job - Ready to Invoice" },
    { action: "skip", id: "1773416026025", name: "Wagstaff Residence", reason: "not open in Simpro (closed, archived or not found)", sn: "713" },
    { action: "skip", conflict: true, id: "1773186761939", name: "Stratton Residence", reason: "Simpro is further along (\"Job - Rough-In Complete\"), app says Rough In Progress: fix whichever is wrong", sn: "959" },
    { action: "same", id: "x", name: "Agrees", sn: "1" }, null ],
    simproOnly: [{ name: "Hansen Design TI", sn: "1029", status: "Job - Punch List" }] };
  const sd = X.odStageDiffs(syncDoc, new Date("2026-11-12T15:00:00.000Z"));
  eq(sd.rows.map(r => [r.k, r.name]), [["conflict", "Menlove Additions"], ["conflict", "Stratton Residence"], ["simproOnly", "Hansen Design TI"], ["set", "Wade Residence"]], "needs-a-person first, then only-in-Simpro, then what the sync would change; matched and closed rows left out");
  eq([sd.nConflict, sd.nOnly, sd.nSet, sd.dry, sd.old], [2, 1, 1, true, false]);
  assert.ok(/Here: Completed · Simpro: Punch List · the sync would set Simpro to Ready to Invoice/.test(sd.rows[3].text), sd.rows[3].text);
  assert.ok(/Open in Simpro \(Punch List\), not in the app/.test(sd.rows[2].text));
  const liveSync = X.odStageDiffs({ ...syncDoc, modeRan: "live", rows: [{ action: "set", result: "changed", name: "Done", sn: "5", section: "Completed", fromName: "Job - Finish", toName: "Job - Punch List" }, { action: "set", result: "blocked", name: "Blocked", sn: "6", section: "Completed", fromName: "Job - Finish", toName: "Job - Punch List" }], simproOnly: [] }, new Date("2026-11-14T15:00:00.000Z"));
  eq([liveSync.rows.map(r => r.name), liveSync.dry, liveSync.old], [["Blocked"], false, true], "live: a change that went through is not a difference, a blocked one is; a check over 36 hours old is marked");
  eq([X.odStageDiffs(null, now).rows, X.odStageDiffs({ lastRunAt: "2026-11-12T11:45:06.467Z" }, now).rows], [[], []], "no doc or no rows: silent");
  }

  console.log("odash-model-test: all checks passed");
}
