#!/usr/bin/env node
/* sb4-dryrun.js — Task 1R regression + default-pinning harness for the
 * ScoreboardV4 scoring config (SB4_DEFAULTS / sb4Config).
 *
 * Supersedes the Task-1 version of this file (commit 33fc3a7), which
 * extracted sb3Agg/sb3Build — DEAD CODE with no render site (ScoreboardV3 is
 * never mounted anywhere). This version extracts the REAL, LIVE functions
 * the app actually renders: SB4_DEFAULT_WEIGHTS, _sb4Num, _sb4Special,
 * _sb4Median, _sb4Stage, sb4Agg, sb4Build (plus their shared helper deps —
 * _sb3lc/_sb3QCount/_sb3Completed live in the SB3 region but are reused by
 * V4; sbv2WalkPunch/SBV2_TEST_JOB/SBV2_EXCLUDE_NAME are the SBV2 shared
 * helpers) verbatim from src/App.js source at runtime and evals them in a vm
 * sandbox — same idea as the superseded version and scripts/gen-stamp-dryrun.js:
 * no hand copy of the scoring math to drift out of sync with what ships.
 *
 * Task 1R is PURE PLUMBING — SB4_DEFAULTS/sb4Config are produced and
 * sb4Agg/sb4Build gain an (unused-for-now) cfg param, but the scoring math
 * itself still runs on its original hardcoded literals (later tasks wire cfg
 * in). So the required proof here is NOT "does cfg move the output" (it
 * deliberately does not yet) but:
 *   1. REGRESSION — sb4Agg(js) and sb4Agg(js, sb4Config(null)) are deep-equal,
 *      and so is sb4Build's equivalent no-cfg vs explicit-default-cfg call.
 *      Proves the new param is a true no-op for existing callers.
 *   2. REGRESSION — sb4Build(jobs,"foremen",users), called with the PRE-task
 *      3-arg signature, produces the exact same numbers as before this task
 *      landed (margin/qc/handoff/app).
 *   3. DEFAULT PINNING — every leaf of SB4_DEFAULTS asserted against its
 *      spec'd value directly, reading the object itself rather than via a
 *      computed comparison. This matters because blocks 1-2 above can NEVER
 *      catch a wrong default: cfg is unused by sb4Agg this task, so both
 *      sides of every comparison in blocks 1-2 fall through to the exact
 *      same hardcoded literals regardless of what SB4_DEFAULTS says. A
 *      typo'd default (e.g. minorMaxCost: 500 instead of 50) would sail
 *      through blocks 1-2 with zero failures — block 3 is the only thing in
 *      this file that reads SB4_DEFAULTS's actual values at all.
 *   4. MERGE — sb4Config's deep-merge-over-defaults semantics: partial
 *      objects keep untouched siblings, non-numeric scalars are ignored,
 *      null input deep-equals the bare defaults.
 * Plus one check beyond the brief's literal minimum: SB4_DEFAULT_WEIGHTS is
 * asserted to be the SAME OBJECT (===) as SB4_DEFAULTS.weights, not just
 * equal in value — the task's "one source of truth" requirement (the
 * weights reset button and the useState initializer both read
 * SB4_DEFAULT_WEIGHTS; if it were ever a separate copy instead of a direct
 * reference, it could drift from SB4_DEFAULTS silently).
 *
 * Run: node scripts/sb4-dryrun.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// Extract a single top-level `const NAME = <expr>;` statement verbatim, by
// scanning forward from the marker and tracking (){}[] depth (skipping over
// string/template-literal contents so a `;` or bracket inside a string can't
// confuse it) until the first top-level `;`. Handles BOTH object literals /
// block-bodied arrows (`= {...}`, `=> {...}`) AND bare single-expression
// arrows with no braces at all (e.g. `_sb4Stage`, `_sb3lc`, and — after this
// task lands — `SB4_DEFAULT_WEIGHTS = SB4_DEFAULTS.weights`).
//
// A simpler "find the first `{` after the marker, then brace-balance from
// there" approach (what the Task-1 harness used) works fine for names whose
// own statement happens to contain a `{`, but silently breaks on brace-less
// ones: it walks forward into the NEXT statement's braces instead. Concretely,
// `_sb4Stage` has no braces at all — that approach would slice from
// `const _sb4Stage = ` all the way through the ENTIRE body of `sb4Agg` (the
// very next `{...}` in the file), smuggling a duplicate `sb4Agg` definition
// into the sandbox and blowing up with "Identifier 'sb4Agg' has already been
// declared" once sb4Agg is ALSO extracted on its own. Depth-tracking from the
// statement's own start avoids that class of bug entirely.
function extractConst(name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extractConst: "${marker}" not found in App.js`);
  let i = start + marker.length, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; continue; }
    if (c === ";" && depth === 0) { i++; break; }
  }
  if (quote) throw new Error(`extractConst: unterminated string literal for ${name}`);
  if (depth !== 0) throw new Error(`extractConst: unbalanced brackets for ${name}`);
  return src.slice(start, i);
}

// Slice raw text between two literal markers (inclusive of both) — same
// technique the Task-1 harness used to pull the contiguous SB3 region;
// retargeted here to the contiguous V4 region. Both markers are pre-existing
// text this task does not touch (the ScoreboardV4 header comment, and the
// window export line), so the span is stable whether SB4_DEFAULTS/sb4Config
// exist yet or not. That stability is exactly what makes the RED run below
// fail with "SB4_DEFAULTS is not defined" (a ReferenceError thrown by the
// trailing export line, because extraction itself still succeeds) rather
// than a "marker not found" extraction error.
function sliceBetween(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`sliceBetween: start marker not found: ${JSON.stringify(startMarker)}`);
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error(`sliceBetween: end marker not found: ${JSON.stringify(endMarker)}`);
  return src.slice(start, endIdx + endMarker.length);
}

// sb4Agg / sb4Build call these; they're defined earlier in App.js (the first
// three live in the SB3 region but are reused by V4; the last three are the
// shared SBV2 helpers), outside the contiguous V4 region sliced below.
const HELPERS = ["_sb3lc", "_sb3QCount", "_sb3Completed", "SBV2_EXCLUDE_NAME", "sbv2WalkPunch", "SBV2_TEST_JOB"]
  .map(extractConst)
  .join("\n");

// The contiguous V4 region: the ScoreboardV4 header comment (stable — Task 1R
// inserts SB4_DEFAULTS/sb4Config directly above SB4_DEFAULT_WEIGHTS, i.e.
// safely AFTER this marker) through SB4_DEFAULT_WEIGHTS, _sb4Num/_sb4Special/
// _sb4Median/_sb4Stage, sb4Agg, sb4Build, and the window export line.
const MAIN = sliceBetween(
  "// ScoreboardV4 (2026-07-16)",
  'if (typeof window !== "undefined") window.sb4Build = sb4Build;'
);

// Property order matters here: object-literal shorthand evaluates identifiers
// left to right, so SB4_DEFAULTS must come FIRST for the pre-implementation
// (RED) run to fail with "SB4_DEFAULTS is not defined" specifically, per the
// task brief, instead of tripping over sb4Config (also undefined pre-impl)
// first.
const combined =
  HELPERS + "\n" + MAIN +
  "\n({ SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build });\n";

let extracted;
try {
  const sandbox = vm.createContext({});
  extracted = vm.runInContext(combined, sandbox, { filename: "sb4-dryrun-extract.vm.js" });
} catch (e) {
  console.error("EXTRACTION/EVAL FAILED — either App.js source shape changed since this harness was written, or (pre-Task-1R) SB4_DEFAULTS/sb4Config don't exist yet.");
  console.error("  " + e.message);
  process.exit(1);
}
const { SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build } = extracted;

// ─── FIXTURES (verbatim from the task brief) ───────────────────────────────
const jobA = { id:"a", name:"Fixture A", foreman:"T", simproMargin: 20,
  roughPunch: { main: { general: [ {id:"p1",text:"x",done:true}, {id:"p2",text:"y",fromQC:true} ] } },
  roughUpdates: [{text:"d"}], roughQuestions: { main:[{question:"q"}] }, qcStatus: "fail" };
const jobB = { id:"b", name:"Fixture B", foreman:"T", simproMargin: 30,
  finishPunch: { main: { general: [ {id:"p3",text:"z",fromQC:true}, {id:"p4",text:"w"} ] } }, qcStatus: "pass" };
const users = [{ name:"T", title:"foreman", active:true }];
const jobs = [jobA, jobB];

let failures = 0;
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
function assertEq(actual, expected, label) {
  const ok = (typeof actual === "object" && actual !== null) || (typeof expected === "object" && expected !== null)
    ? deepEqual(actual, expected)
    : actual === expected;
  if (!ok) {
    failures++;
    console.error(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok   ${label}`);
  }
}
function assertTrue(cond, label, detail) {
  if (!cond) {
    failures++;
    console.error(`  FAIL ${label}` + (detail ? " — " + detail : ""));
  } else {
    console.log(`  ok   ${label}`);
  }
}

console.log("── 1. REGRESSION: cfg param is a no-op this task (sb4Agg/sb4Build) ──");
assertEq(sb4Agg(jobs), sb4Agg(jobs, sb4Config(null)), "sb4Agg(js) deep-equals sb4Agg(js, sb4Config(null))");
assertEq(sb4Build(jobs, "foremen", users), sb4Build(jobs, "foremen", users, sb4Config(null)), "sb4Build(...) deep-equals sb4Build(..., sb4Config(null))");

console.log("\n── 2. REGRESSION: sb4Build(jobs,\"foremen\",users) unchanged vs before this task ──");
const built = sb4Build(jobs, "foremen", users);
assertEq(built.length, 1, "sb4Build returns exactly 1 row (T has 2 jobs, clears the jobs>=2 gate)");
const row = built[0] || {};
assertEq(row.name, "T", "row.name");
assertEq(row.jobs, 2, "row.jobs");
assertEq(row.margin, 25, "row.margin (median of [20,30])");
assertEq(row.qc, 1, "row.qc (2 QC items / 2 QC walks)");
assertEq(row.handoff, 75, "row.handoff (3 open / 4 punch * 100)");
assertEq(row.app, 6, "row.app (punch 4 + updates 1 + questions 1)");

console.log("\n── 3. DEFAULT PINNING (mutation-proof — reads SB4_DEFAULTS directly; nothing above this line ever touches it) ──");
assertEq(SB4_DEFAULTS.weights.margin, 45, "SB4_DEFAULTS.weights.margin");
assertEq(SB4_DEFAULTS.weights.qc, 25, "SB4_DEFAULTS.weights.qc");
assertEq(SB4_DEFAULTS.weights.handoff, 20, "SB4_DEFAULTS.weights.handoff");
assertEq(SB4_DEFAULTS.weights.app, 10, "SB4_DEFAULTS.weights.app");
assertEq(SB4_DEFAULTS.marginDivisor, 50, "SB4_DEFAULTS.marginDivisor");
assertEq(SB4_DEFAULTS.handoffDivisor, 20, "SB4_DEFAULTS.handoffDivisor");
assertEq(SB4_DEFAULTS.appCap, 2500, "SB4_DEFAULTS.appCap");
assertEq(SB4_DEFAULTS.qc.minorDivisor, 40, "SB4_DEFAULTS.qc.minorDivisor");
assertEq(SB4_DEFAULTS.qc.minorMaxCost, 50, "SB4_DEFAULTS.qc.minorMaxCost");
assertEq(SB4_DEFAULTS.qc.seriousCredit, 0, "SB4_DEFAULTS.qc.seriousCredit");
assertEq(SB4_DEFAULTS.appMix, 50, "SB4_DEFAULTS.appMix");
assertEq(SB4_DEFAULTS.marginTarget, 15, "SB4_DEFAULTS.marginTarget");
assertEq(SB4_DEFAULTS.strandedDays, 7, "SB4_DEFAULTS.strandedDays");

console.log("\n── bonus: SB4_DEFAULT_WEIGHTS is the SAME OBJECT as SB4_DEFAULTS.weights (one source of truth) ──");
assertTrue(SB4_DEFAULT_WEIGHTS === SB4_DEFAULTS.weights, "SB4_DEFAULT_WEIGHTS === SB4_DEFAULTS.weights (reference equality, not just value equality)");

console.log("\n── 4. MERGE: sb4Config deep-merges `stored` over SB4_DEFAULTS ──");
assertEq(sb4Config({ weights: { margin: 10 } }).weights.qc, 25, "partial weights override keeps sibling qc at default (25)");
assertEq(sb4Config({ qc: { minorDivisor: 20 } }).qc.seriousCredit, 0, "partial qc override keeps sibling seriousCredit at default (0)");
assertEq(sb4Config(null), SB4_DEFAULTS, "sb4Config(null) deep-equals SB4_DEFAULTS");
assertEq(sb4Config({ appMix: "x" }).appMix, 50, "non-numeric appMix override is ignored, falls back to default (50)");

console.log("");
if (failures) {
  console.error(`${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("task1R ok");
process.exit(0);
