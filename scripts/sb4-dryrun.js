#!/usr/bin/env node
/* sb4-dryrun.js — Task 1 regression + knob harness for the scoring config
 * object (SB4_DEFAULTS / sb4Config) and the sb3Agg dual-shape shim.
 *
 * Extracts the REAL sb3Agg/sb3Build/SB3_DEFAULT_WEIGHTS/SB4_DEFAULTS/sb4Config
 * region, plus its four external helper deps (SBV2_EXCLUDE_NAME, sbv2WalkPunch,
 * _sbv2YMD, SBV2_TEST_JOB), verbatim from src/App.js source at runtime and
 * evals them in a vm sandbox — same brace-balance slice technique as
 * scripts/gen-stamp-dryrun.js, so there is no hand copy of the scoring math
 * to drift out of sync with what actually ships. (_sb3lc and the other
 * sb3-prefixed helpers don't need separate extraction: they live inside the
 * single SB3_DEFAULT_WEIGHTS…window.sb3Build span pulled below.)
 *
 * No Firestore, no fixtures beyond the synthetic jobs defined here. Asserts:
 *   1. REGRESSION — sb3Agg(jobs, sb4Config()) (new default config) produces
 *      the SAME sharedLinks/handoffScore/punch/updates/questions/shares/jobs
 *      as sb3Agg(jobs, SB3_DEFAULT_WEIGHTS) (the old legacy weights object),
 *      on the same fixtures. quality/ftpPct/ftpP/ftpT/appUsage are excluded —
 *      Tasks 2-3 change those formulas, so pinning them here would make this
 *      file a false-failure trap for that later, intentional work.
 *   2. KNOBS — sharedLinksCap and handoffDivisor actually move their output
 *      fields (proves the config is really wired in, not just accepted and
 *      ignored).
 * Plus three bonus blocks beyond the brief's literal minimum (see below for
 * why): pinning the bare SB4_DEFAULTS.handoffDivisor/.sharedLinksCap values,
 * appCaps knob coverage, and a structural deep-equal of SB4_DEFAULTS itself.
 *
 * Run: node scripts/sb4-dryrun.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// Brace-balance slice of a single `const NAME = ...` statement — same
// technique as extract() in scripts/gen-stamp-dryrun.js.
function extractConst(name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extractConst: "${marker}" not found in App.js`);
  const braceAt = src.indexOf("{", start);
  if (braceAt < 0) throw new Error(`extractConst: no "{" found after ${name}`);
  let i = braceAt, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`extractConst: unbalanced braces for ${name}`);
  return src.slice(start, i + 1) + ";";
}

// Slice raw text between two literal markers (inclusive of both).
function sliceBetween(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`sliceBetween: start marker not found: ${JSON.stringify(startMarker)}`);
  const endIdx = src.indexOf(endMarker, start);
  if (endIdx < 0) throw new Error(`sliceBetween: end marker not found: ${JSON.stringify(endMarker)}`);
  return src.slice(start, endIdx + endMarker.length);
}

// sb3Agg / sb3Build / sb3JobSignals call these; they're defined earlier in
// App.js, outside the contiguous SB3 region sliced below.
const HELPERS = ["SBV2_EXCLUDE_NAME", "sbv2WalkPunch", "_sbv2YMD", "SBV2_TEST_JOB"]
  .map(extractConst)
  .join("\n");

// The contiguous SB3 region: SB3_DEFAULT_WEIGHTS ... (Task 1 lands
// SB4_DEFAULTS/sb4Config inside this same span, directly above sb3Agg) ...
// sb3Agg ... sb3Build ... the window export line.
const MAIN = sliceBetween(
  "const SB3_DEFAULT_WEIGHTS = ",
  'if (typeof window !== "undefined") window.sb3Build = sb3Build;'
);

const combined =
  HELPERS + "\n" + MAIN +
  "\n({ sb3Agg, sb3Build, sb4Config, SB4_DEFAULTS, SB3_DEFAULT_WEIGHTS });\n";

let extracted;
try {
  const sandbox = vm.createContext({});
  extracted = vm.runInContext(combined, sandbox, { filename: "sb4-dryrun-extract.vm.js" });
} catch (e) {
  console.error("EXTRACTION FAILED — App.js source shape changed since this harness was written.");
  console.error("  " + e.message);
  process.exit(1);
}
const { sb3Agg, sb3Build, sb4Config, SB4_DEFAULTS, SB3_DEFAULT_WEIGHTS } = extracted;
void sb3Build; // extracted for completeness / future tasks; not exercised by this file yet

// ─── FIXTURES (verbatim from the task brief) ───────────────────────────────
const G = (n) => ({ id: "g"+n, foreman: "T", name: "Fixture "+n });
const jobA = { ...G(1), roughPunch: { main: { general: [
  { id:"p1", text:"x", done:true }, { id:"p2", text:"y", fromQC:true } ] } },
  roughUpdates: [{ text:"d1" }], roughQuestions:{ main:[{ question:"q" }] },
  qcStatus: "fail" };
const jobB = { ...G(2), finishPunch: { main: { general: [
  { id:"p3", text:"z", fromQC:true }, { id:"p4", text:"w", fromQC:true } ] } },
  qcStatus: "pass" };
const jobC = { ...G(3) }; // empty job
const jobs = [jobA, jobB, jobC];

let failures = 0;
function assertEq(actual, expected, label) {
  if (actual !== expected) {
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

console.log("── 1. REGRESSION: default sb4Config() vs legacy SB3_DEFAULT_WEIGHTS object ──");
const legacy = sb3Agg(jobs, SB3_DEFAULT_WEIGHTS);
const modern = sb3Agg(jobs, sb4Config());
const noArg  = sb3Agg(jobs); // dual-shape shim: no cfg arg at all must also default cleanly
["sharedLinks", "handoffScore", "punch", "updates", "questions", "shares", "jobs"].forEach((k) => {
  assertEq(modern[k], legacy[k], `field '${k}' (sb4Config() vs legacy weights)`);
  assertEq(noArg[k], legacy[k], `field '${k}' (no-arg vs legacy weights)`);
});

console.log("\n── 2. KNOBS ──");
// sharedLinksCap:1 + a job with exactly 1 share -> sharedLinks hits the ceiling (100).
const jobShares = { ...G(4), questionShares: [{ id: "s1" }] };
const capped = sb3Agg([jobShares], sb4Config({ sharedLinksCap: 1 }));
assertEq(capped.sharedLinks, 100, "sharedLinksCap:1, shares:1 fixture -> sharedLinks 100");

// handoffDivisor:20 doubles handoff sensitivity vs the default 40.
const punchItems = (total, openCount) =>
  Array.from({ length: total }, (_, i) => ({ id: "h"+i, text: "t", done: i >= openCount }));
const jobHandoff = { ...G(5), roughPunch: { main: { general: punchItems(10, 1) } } }; // 10 items, 1 open -> handoff = 10%
const h40 = sb3Agg([jobHandoff], sb4Config({ handoffDivisor: 40 })).handoffScore;
const h20 = sb3Agg([jobHandoff], sb4Config({ handoffDivisor: 20 })).handoffScore;
assertEq(h40, 75, "handoffDivisor:40 (default) handoffScore on the 10%-open fixture");
assertEq(h20, 50, "handoffDivisor:20 handoffScore on the same fixture");
assertTrue(
  (100 - h20) === 2 * (100 - h40),
  "handoffDivisor:20 doubles handoff sensitivity vs 40",
  `(100-${h20})=${100 - h20} should be 2*(100-${h40})=${2 * (100 - h40)}`
);

// ─── bonus, not required by the brief: pin the actual DEFAULTS ────────────
// Mutation-tested gap: the two required blocks above never read a bare
// default. REGRESSION compares legacy-weights-object vs sb4Config() — but
// BOTH sides fall back through the same SB4_DEFAULTS, so a wrong default
// moves them together and cancels out of the comparison (confirmed by
// hand: bumping the real SB4_DEFAULTS.handoffDivisor from 40 to 90 left
// this file printing "task1 ok"). And the two KNOBS assertions above only
// ever pass an EXPLICIT handoffDivisor/sharedLinksCap, so they never once
// read SB4_DEFAULTS's own value either. These two calls pass NO override,
// so they're the only assertions in this file that would fail if
// SB4_DEFAULTS.handoffDivisor or .sharedLinksCap drifted from spec.
console.log("\n── bonus: pin the real SB4_DEFAULTS.handoffDivisor / .sharedLinksCap (mutation-tested gap) ──");
const hDefault = sb3Agg([jobHandoff], sb4Config()).handoffScore; // sb4Config() with NO override -> reads the bare default
assertEq(hDefault, 75, "sb4Config() (no override) handoffScore == the handoffDivisor:40 case -> real default is 40");
const slDefault = sb3Agg([jobShares], sb4Config()).sharedLinks; // sb4Config() with NO override -> reads the bare default
assertEq(slDefault, 33, "sb4Config() (no override) sharedLinks on a 1-share fixture -> real default sharedLinksCap is 3 (1/3=33%)");

// ─── bonus, not required by the brief: appCaps knobs ──────────────────────
// The REGRESSION bullet above deliberately excludes appUsage (Tasks 2-3
// change its formula), which means a change to an appCaps.* default would
// otherwise go completely untested by this file. This block closes that gap
// without touching the required assertions above — safe to delete if a
// later task supersedes it with its own appUsage coverage.
console.log("\n── bonus: appCaps knobs (closes a coverage gap the brief's spec leaves open) ──");
const jobPunchy = { ...G(6), roughPunch: { main: { general: punchItems(150, 0) } } }; // 150 punch items, all closed
const apDefault = sb3Agg([jobPunchy], sb4Config()).appUsage;
const apCapped  = sb3Agg([jobPunchy], sb4Config({ appCaps: { punch: 150 } })).appUsage;
assertEq(apDefault, 17, "appCaps.punch default (300): 150 punch items -> appUsage 17");
assertEq(apCapped, 33, "appCaps.punch:150 (matches count): same fixture -> appUsage 33");

// ─── bonus, not required by the brief: SB4_DEFAULTS structural check ──────
// qc.* / appMix / strandedDays aren't consumed by sb3Agg in Task 1 at all
// (Tasks 2/3/6 read them) — there is NO behavioral assertion anywhere above
// that could ever catch a typo in those values (e.g. minorMaxCost: 500
// instead of 50). This is the only check in the file protecting them, and
// it also re-covers weights/appCaps/sharedLinksCap/handoffDivisor as a
// belt-and-suspenders exact-shape check against the brief's spec'd object.
console.log("\n── bonus: SB4_DEFAULTS deep-equals the brief's spec'd object ──");
const EXPECTED_SB4_DEFAULTS = {
  weights: { quality: 40, appUsage: 25, sharedLinks: 20, handoff: 15 },
  appMix: 50,
  qc: { seriousCredit: 0, minorDivisor: 40, minorMaxCost: 50 },
  appCaps: { punch: 300, updates: 40, questions: 60 },
  sharedLinksCap: 3,
  handoffDivisor: 40,
  strandedDays: 7,
};
assertEq(
  JSON.stringify(SB4_DEFAULTS),
  JSON.stringify(EXPECTED_SB4_DEFAULTS),
  "SB4_DEFAULTS deep-equals {weights,appMix,qc,appCaps,sharedLinksCap,handoffDivisor,strandedDays} from the brief"
);

console.log("");
if (failures) {
  console.error(`${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("task1 ok");
process.exit(0);
