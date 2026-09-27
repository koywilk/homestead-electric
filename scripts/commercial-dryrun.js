#!/usr/bin/env node
/* commercial-dryrun.js — harness for the Commercial-mode pure helpers.
 * Extracts the shipped helpers VERBATIM from src/App.js and evals them in a vm
 * sandbox (house pattern: scripts/needs-dryrun.js), so what's under test is
 * exactly what ships — no hand copy to drift.
 *
 * Spec: docs/superpowers/specs/2026-09-25-commercial-mode-design.md
 * Plan: docs/superpowers/plans/2026-09-25-commercial-mode-phase1.md
 *
 * Proves:
 *   1. DIVISION — jobDivision(): absent / "" / wrong case / null → "resi";
 *      exactly "commercial" → "commercial"; isCommercial mirrors it.
 *   2. GUARD — App() never re-introduces the jobsRef data-loss hazard
 *      (plan Task 2, hazard 1): no `useRef(jobs)` and no `jobsRef.current = jobs`
 *      inside App(); jobsRef must track allJobs.
 *   3. PHASES — commPhase() is derived from the checks (spec §6.2): fresh job →
 *      1; residential → null; last item closes a phase and the next opens; a
 *      move-on override closes a phase with owed items; un-checking an earlier
 *      item pulls the job back; all twelve closed → null; tracker items derive
 *      from the Gear & Submittals log and the Drive pull (§6.3 / §6.7).
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// One-line arrow consts: take the whole source line.
const extractLine = (name) => { const m = new RegExp(`^const ${name}\\s*=`, "m").exec(src); if (!m) throw new Error(`extract: const ${name} not found`); const i = m.index; return src.slice(i, src.indexOf("\n", i)); };

// Brace-balanced block (house pattern, scripts/needs-dryrun.js) for multi-line arrow consts.
function extractFrom(marker, label) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  let i = src.indexOf("{", start);
  let depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; if (depth === 0) { i++; break; } continue; }
  }
  if (depth !== 0) throw new Error(`extract: unbalanced braces for ${label}`);
  return src.slice(start, i) + ";";
}
const extractArray = (name) => { const start = src.indexOf(`const ${name} = [`); if (start < 0) throw new Error(`extract: const ${name} not found`); const end = src.indexOf("\n];", start); return src.slice(start, end + 3) + ";"; };

const combined = [
  extractLine("jobDivision"),
  extractLine("isCommercial"),
  extractArray("COMM_START_STEPS"),
  extractLine("COMM_PHASE_BY_N"),
  extractLine("commStartOf"),
  extractLine("commItemKey"),
  extractFrom("const commTrackerDone = ", "commTrackerDone"),
  extractFrom("const commItemState = ", "commItemState"),
  extractLine("commPhaseChecked"),
  extractLine("commPhaseClosed"),
  extractLine("commPhaseDone"),
  extractLine("commPhase"),
  extractLine("commOwedItems"),
  `({ jobDivision, isCommercial, COMM_START_STEPS, COMM_PHASE_BY_N, commItemState, commPhaseChecked, commPhaseDone, commPhase, commOwedItems, commTrackerDone })`,
].join("\n");
const sandbox = vm.createContext({});
const H = vm.runInContext(combined, sandbox, { filename: "commercial-extract.vm.js" });

let n = 0;
const check = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };

// 1. DIVISION
check(H.jobDivision({}), "resi", "absent → resi");
check(H.jobDivision({ division: "" }), "resi", "empty → resi");
check(H.jobDivision({ division: "Commercial" }), "resi", "wrong case is NOT commercial (exact string only)");
check(H.jobDivision({ division: "multi family" }), "resi", "unknown string → resi");
check(H.jobDivision({ division: "commercial" }), "commercial", "commercial → commercial");
check(H.jobDivision(null), "resi", "null → resi");
check(H.jobDivision(undefined), "resi", "undefined → resi");
check(H.isCommercial({ division: "commercial" }), true, "isCommercial true");
check(H.isCommercial({ type: "quote" }), false, "quote without division is resi");
check(H.isCommercial({ quickJob: true }), false, "quick job without division is resi");

// 2. GUARD — jobsRef must never track the filtered list (plan Task 2 hazard 1).
const appStart = src.indexOf("\nfunction App()");
assert.ok(appStart > 0, "function App() not found");
const appSrc = src.slice(appStart);
check(/useRef\(\s*jobs\s*\)/.test(appSrc), false, "App(): useRef(jobs) would seed jobsRef from the filtered list");
check(/jobsRef\.current\s*=\s*jobs\b/.test(appSrc), false, "App(): jobsRef.current = jobs would drop the other division's pending edits");
if (/const \[allJobs\s*,\s*setAllJobs\]/.test(appSrc)) {
  check(/useRef\(\s*allJobs\s*\)/.test(appSrc) || /jobsRef\.current\s*=\s*allJobs\b/.test(appSrc), true, "App(): jobsRef must track allJobs");
  check(/\bsetJobs\(/.test(appSrc), false, "App(): a leftover setJobs( call after the rename");
}

// 3. PHASES
const doneThrough = (upTo, except = []) => { const o = {}; H.COMM_START_STEPS.filter(p => p.n <= upTo).forEach(p => p.items.forEach(([k, , kind]) => { const K = `${p.n}.${k}`; if (kind !== "trk" && !except.includes(K)) o[K] = { done: true }; })); return o; };
const fullLog = [{ item:"Switchgear", requestedAt:"9/1/2026", leadTimeWeeks:22, priceConfirmed:true, status:"approved", poNo:"PO-1", releasedAt:"9/10/2026", promisedShip:"2/1/2027", requiredOnSite:"2/10/2027", shipMode:"complete" }];
const cj = (start, extra = {}) => ({ division:"commercial", driveFolderId:"f1", docPull:{ status:"done" }, commercial:{ start:{ items:{}, na:{}, notes:{}, overrides:{}, ...start }, submittals: fullLog, rfis:[{ no:"001" }] }, ...extra });
check(H.commPhase({ name:"resi job" }), null, "residential → null");
check(H.commPhase({ division:"commercial" }), 1, "fresh commercial job → phase 1");
check(H.commPhase(cj({ items: doneThrough(1) })), 2, "phase 1 checked → phase 2");
check(H.commPhase(cj({ items: doneThrough(2) })), 3, "phase 2 checked (folders via Drive) → phase 3");
check(H.commPhase(cj({ items: doneThrough(2) }, { driveFolderId:"" })), 2, "no Drive folder → 2.folders open → still phase 2");
check(H.commPhase(cj({ items: doneThrough(3) })), 4, "phase 3 checks + log → phase 4");
check(H.commPhase(cj({ items: doneThrough(4) })), 5, "phase 4 → 5");
check(H.commPhase(cj({ items: doneThrough(5) })), 6, "phase 5 (log satisfies trackers) → 6");
check(H.commPhase(cj({ items: doneThrough(12) })), null, "all twelve checked → null (Ready to Start)");
const ov = cj({ items: doneThrough(3), overrides: { 4: { by:"Brady", at:"9/25/2026" } } });
check(H.commPhase(ov), 5, "move-on override on 4 → phase 5");
check(H.commOwedItems(ov).length, 3, "phase 4's three non-tracker items are owed");
check(H.commPhase(cj({ items: doneThrough(7, ["1.award"]) })), 1, "un-checking a phase-1 item from phase 8 pulls the job back to 1");
check(H.commItemState(cj({ na: { "6.bim": true } }), 6, "bim"), "na", "N/A reads as na");
check(H.commPhaseDone(cj({ items: doneThrough(1) }), 1), 4, "phase 1 done count");
check(H.commTrackerDone(cj({}, { commercial:{ start:{items:{},na:{},notes:{},overrides:{}}, submittals:[] } }), 4, "approved"), false, "empty log → 4.approved false");
check(H.commTrackerDone(cj({}, { commercial:{ start:{items:{},na:{},notes:{},overrides:{}}, submittals:[{ status:"approved" }] } }), 5, "released"), false, "approved without PO → 5.released false");
check(H.commTrackerDone(cj({}), 5, "released"), true, "approved + PO + released → 5.released true");
check(H.commTrackerDone(cj({}, { commercial:{ start:{items:{},na:{},notes:{},overrides:{}}, submittals:[{ status:"revise" }] } }), 4, "approved"), false, "revise → not approved");

console.log(`commercial-dryrun ok (${n} checks)`);
