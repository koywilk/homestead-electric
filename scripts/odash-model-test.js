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
 *   6. MONEY — ready to invoice and 60+ day change orders carry the job value.
 *   7. PEOPLE — quiet needs an active job; approved time off is "off"; 30+ days is
 *      "gone"; neither counts in the on-app denominator.
 *   8. PLANS — an unmatched plan waits until filed/dismissed, not until Seen.
 *   9. DOCS — "did not run" when the last due time passed with nothing made.
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
  fn("sameName"), fn("localYmd"), cst("parseAnyDate"), cst("effRS"), cst("effFS"), cst("sbv2WalkPunch"), cst("SBV2_EXCLUDE_NAME"),
  cst("commOf"), cst("commPhase"), cst("coIsConverted"), fn("matterportScanNeeded"), fn("qcWalkRows"), fn("qcBucketOf"),
  fn("isSnoozed"), fn("needIsOpen"), fn("needAssignee"), fn("needPriority"),
  src.slice(a, b),
];
const code = babel.transformSync(parts.join("\n\n"), { babelrc: false, configFile: false, sourceType: "script", presets: [[require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code;

function makeSandbox(extra = {}) {
  const sb = {
    console, Date, Math, JSON, Object, Array, String, Number, Set, Map, RegExp, isNaN, parseInt, parseFloat,
    React: { createElement: () => null }, Component: class {}, Fragment: "f",
    useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f(), useRef: () => ({}),
    Icon: () => null, toast: {}, gcAdminCallable: () => () => {}, updateDoc: () => {}, doc: () => {}, db: {}, query: () => {}, collection: () => {}, orderBy: () => {}, limit: () => {}, onSnapshot: () => () => {}, can: () => true,
    buildJobPhotos: () => [], prepClearedToStart: (j) => !!(j && j.prepDone !== false), allPrepChecked: () => true,
    ...extra,
  };
  vm.createContext(sb);
  vm.runInContext(code + "\n;globalThis.__x = { odModel, odPlanModel, odDocStatus, odRtInfo, odPhase, OD_NOFM, OD_DOCS };", sb, { filename: "odash-extract.js" });
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
      readyToInvoice: true, finishUpdates: [{ createdAt: ago(1).toISOString(), text: "x", addedBy: "Abraham Tristan" }] },
    { ...base, id: "j2", name: "Mangum", foreman: "Vasa Mataafa", simproNo: "920", roughStatus: "inprogress", roughStage: "70%",
      roughUpdates: [{ createdAt: ago(10).toISOString(), text: "x", addedBy: "Vasa Mataafa" }],
      changeOrders: [{ id: "c1", coStatus: "pending", submittedAt: ago(90).toISOString(), desc: "Add cans" }, { id: "c2", coStatus: "needs_sending", desc: "Move box" }],
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
    { ...base, id: "j8", name: "Nguyen", foreman: "Abraham Tristan", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finalInspectionResult: "fail",
      finalInspectionAttempts: [{ date: ymd(ago(5)), result: "fail", items: [] }, { date: ymd(ago(5)), result: "fail", items: [] }] },
  ];
  const needs = [{ id: "toneed_1", text: "Time off — James", timeoffId: "t1", status: "open", requestedBy: "James Livingston", dueDate: ymd(ago(-20)) },
    { id: "n2", text: "Call GC", status: "open", assignedTo: "Koy Wilkinson", priority: "urgent" }];
  const presence = { "Joel Old": new Date(2026, 7, 6).toISOString() };
  jobs[0].presence = presence;
  const pto = [{ name: "James Livingston", start: "2026-10-14", end: "2026-10-16", note: "PTO" }];
  const simTotals = { byNo: { "1304": { total: 41000 }, "920": { total: 63000 } } };
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
  eq(nf.live.map(j => j.name).sort(), ["Ashcraft", "Peterson", "Thayne"], "No foreman filter lists exactly those");
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

  // 6. MONEY
  assert.strictEqual(d.attnBy.invoice.extra, "$41k");
  assert.ok(/on 1 job, job value \$63k/.test(d.attnBy.coOld.extra), d.attnBy.coOld.extra);
  eq(d.coBy, { needs_sending: 1, pending: 2, approved: 1, scheduled: 0, other: 0 });
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

  // 9. DOCS
  const lead = X.OD_DOCS.find(x => x.k === "lead");
  const missed = X.odDocStatus(lead, { latestDocs: {}, runs: { lead: { lastRunAt: new Date(2026, 9, 6, 6, 2).toISOString(), ok: true } }, now });
  assert.ok(missed.missed && /did not run Tue/.test(missed.text), missed.text);
  const none = X.odDocStatus(lead, { latestDocs: {}, runs: {}, now });
  assert.ok(!none.missed && none.tone === "" && /no run recorded/.test(none.text), "nothing on record is not a missed run");
  const made = X.odDocStatus(lead, { latestDocs: {}, runs: { lead: { lastRunAt: new Date(2026, 9, 13, 6, 2).toISOString(), ok: true } }, now });
  assert.strictEqual(made.tone, "good");
  const failed = X.odDocStatus(lead, { latestDocs: {}, runs: { lead: { lastRunAt: new Date(2026, 9, 13, 6, 2).toISOString(), ok: false, error: "Drive 403" } }, now });
  assert.ok(failed.tone === "bad" && /Drive 403/.test(failed.text), failed.text);

  // 10. MONEY CANDIDATES (functions/fridayPacket.js, what dailySimproTotals fetches)
  const fp = require("../functions/fridayPacket.js");
  const mc = fp.collectMoneyCandidates([
    { simproNo: "1", readyToInvoice: true },
    { simproNo: "2", readyToInvoice: true, invoiceDismissed: true },
    { simproNo: "3", changeOrders: [{ coStatus: "pending", submittedAt: ago(61).toISOString() }] },
    { simproNo: "4", changeOrders: [{ coStatus: "pending", submittedAt: ago(10).toISOString() }] },
    { simproNo: "5", finishStatus: "complete", changeOrders: [{ coStatus: "approved" }] },
    { simproNo: "6", finishStatus: "complete", changeOrders: [{ coStatus: "completed" }] },
    { simproNo: "7", type: "quote", readyToInvoice: true },
    { simproNo: "", readyToInvoice: true },
  ], now);
  eq(mc, ["1", "3", "5"], "ready to invoice, CO waiting 60+ d, finished with open COs");

  console.log("odash-model-test: all checks passed");
}
