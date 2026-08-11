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
 * TASK 2R EXTENSION — severity-aware QC score. cfg.qc now actually drives
 * sb4Agg's `qc` field (no longer a plumbing no-op for that sub-object): a
 * walk with any `severity === "serious"` item scores 0 credit (by default —
 * tunable via cfg.qc.seriousCredit), otherwise it loses a little per minor
 * item, floored at cfg.qc.minorMaxCost. `qc` becomes the MEAN of these
 * per-walk 0-1 scores (previously: raw qcItems/qcWalks, a defect COUNT, not
 * a score). New fields `qcSeriousPct`/`qcMinorAvg`/`qcWalks` ride along for
 * the stat card. Block 5 below extracts `clamp`/`NORM` too — both are
 * declared INSIDE the ScoreboardV4 component body, past the MAIN region's
 * end marker, so they need their own extraction — to prove the single
 * highest-risk line in this task: NORM.qc must become the identity clamp
 * `v => clamp(v)`, because sb4Agg's `qc` is now ALREADY a 0-1 "higher is
 * better" score. Leaving the old `1 - v/8` formula in place would silently
 * INVERT it (a serious-item walk scoring 0 would normalize to ~1, i.e.
 * "great"). Block 2's `row.qc` assertion is updated from the Task 1R
 * literal (`1`, the old raw-count semantics) to `0.975` (the new severity
 * score) — margin/handoff/app in that block are untouched and still prove
 * true non-regression; qc's VALUE changing is Task 2R's entire point, so
 * pinning it to the new number is the correct regression gate going
 * forward, not a weakening of it.
 *
 * TASK 3R EXTENSION — per-job completeness blended into App Usage. `app`
 * stops being a raw volume total (punch+updates+questions) and becomes a 0-1
 * BLENDED score: `compAvg` — the mean of `sb4JobComplete(j)` (0-1, null for
 * tempPed/quickJob jobs) across a person's completeness-eligible jobs — is
 * blended against `clamp(appVolume/appCap)` by the admin-tunable `appMix`
 * knob (0 = pure volume, 100 = pure completeness). Two new display fields
 * ride along: `appVolume` (the untouched raw total over the SAME job set as
 * before — the stat card's headline number) and `appComplete` (0-100 int or
 * null — the stat card's sub-line). `sb4JobComplete`/`_sb4HasPhoto` are new
 * module-scope consts declared beside `sb4Agg` — unlike `clamp`/`NORM` they
 * need no separate extraction call, they simply fall inside the existing
 * MAIN region slice — so block 7 below only needs to add them to the export
 * object. Block 7 proves this task's own inversion trap: NORM.app must
 * become the identity clamp `v => clamp(v)`, mirroring Task 2R's NORM.qc
 * fix, because sb4Agg's `app` is now ALREADY a 0-1 "higher is better" score.
 * Leaving the old `v => clamp(v / 2500)` formula in place would collapse
 * every blended score toward zero (a 0.2512 blend would normalize to
 * ~0.0001, i.e. "terrible").
 *
 * TASK 5 EXTENSION — deriveQcVerdict(job), the pure function behind the new
 * middle "QC Passed with Items" status. Declared beside sb4Agg's other QC
 * helpers (directly above it, right after sb4JobComplete), so — like
 * sb4JobComplete/_sb4HasPhoto before it — it falls inside the existing MAIN
 * region slice with no separate extraction call; block 8 below only adds it
 * to the export object. It walks the SAME three punch trees sb4Agg scores
 * ([roughPunch, finishPunch, qcPunch]) via the shared sbv2WalkPunch helper,
 * counting only live (non-voided) fromQC items: zero such items anywhere ->
 * "pass"; any item with severity==="serious" -> "fail"; otherwise (>=1 item,
 * none serious) -> "passed_items". It does not touch qcStatus or write
 * anything — the QC tab renders its result as a confirmable suggestion, the
 * walker still picks the real value by hand.
 *
 * TASK 5 FIX ROUND 1 (2026-08-10) — deriveQcVerdict gained an optional
 * `phase` param ("rough" | "finish" | omitted). Review finding: the two QC
 * tab suggestion chips both called the WHOLE-JOB deriveQcVerdict(job) with
 * no phase attribution, so a job walked on ONE phase only could make the
 * OTHER (never-walked) phase's chip suggest — and a single click WRITE — a
 * verdict for a walk that hadn't happened. Phase mode walks ONLY that
 * phase's own tree (roughPunch or finishPunch) and DELIBERATELY EXCLUDES
 * qcPunch (a shared "Legacy QC Items" tree with no rough/finish attribution
 * — attributing it to both phases is exactly the class of bug this mode
 * exists to prevent). Phase omitted still walks all three trees exactly as
 * before — an explicitly required non-regression, since later tasks and any
 * other existing caller depend on that exact contract. Block 9 below proves
 * both the new phase-scoped behavior (including the qcPunch-exclusion, via
 * jobD's qcPunch-only serious item being invisible to EITHER phase call) and
 * that whole-job mode is byte-for-byte unchanged.
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

// clamp/NORM are declared INSIDE the ScoreboardV4 component function body —
// past MAIN's end marker — so they need their own extraction. Same
// extractConst technique (marker + depth-tracked slice); it doesn't care
// about nesting/indentation, only that "const NAME = " appears once and the
// statement is self-contained. Both are: clamp is a one-line arrow with no
// external deps; NORM is a one-line object literal whose fields call
// `clamp(...)` by closure — declared in that order below so it reads
// naturally, though closure means either order would work since neither is
// actually CALLED until block 5, well after both const statements have run.
const RENDER_BITS = ["clamp", "NORM"].map(extractConst).join("\n");

// Property order matters here: object-literal shorthand evaluates identifiers
// left to right, so SB4_DEFAULTS must come FIRST for the pre-implementation
// (RED) run to fail with "SB4_DEFAULTS is not defined" specifically, per the
// task brief, instead of tripping over sb4Config (also undefined pre-impl)
// first.
const combined =
  HELPERS + "\n" + MAIN + "\n" + RENDER_BITS +
  "\n({ SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build, sb4JobComplete, _sb4HasPhoto, NORM, deriveQcVerdict });\n";

let extracted;
try {
  const sandbox = vm.createContext({});
  extracted = vm.runInContext(combined, sandbox, { filename: "sb4-dryrun-extract.vm.js" });
} catch (e) {
  console.error("EXTRACTION/EVAL FAILED — either App.js source shape changed since this harness was written, or (pre-Task-1R) SB4_DEFAULTS/sb4Config don't exist yet.");
  console.error("  " + e.message);
  process.exit(1);
}
const { SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build, sb4JobComplete, _sb4HasPhoto, NORM, deriveQcVerdict } = extracted;

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
// Task 2R: qc's VALUE is intentionally different from the Task 1R baseline
// (was raw count 1 = "2 items / 2 walks"; now a severity score — mean of two
// 1-minor-item walks, 0.975 each). margin/handoff above and below are
// untouched, still proving true non-regression.
assertEq(row.qc, 0.975, "row.qc (Task 2R severity score: mean of two 1-minor walks = 0.975, not the old raw count)");
assertEq(row.qcSeriousPct, 0, "row.qcSeriousPct survives sb4Build's spread (0 — no serious items in these fixtures)");
assertEq(row.qcWalks, 2, "row.qcWalks survives sb4Build's spread (2 — both jobs had a QC walk)");
assertEq(row.handoff, 75, "row.handoff (3 open / 4 punch * 100)");
// Task 3R: app's VALUE is likewise intentionally different from the Task 1R/2R
// baseline (was the raw total 6; now a 0-1 blended score). That raw total
// didn't disappear — it survives under its new name, appVolume, unchanged.
// Full derivation of 0.2512 and the completeness math behind it is in block 7.
assertEq(row.appVolume, 6, "row.appVolume (punch 4 + updates 1 + questions 1 — the old row.app, renamed and untouched)");
assertEq(row.appComplete, 50, "row.appComplete survives sb4Build's spread (50 — see block 7 for the per-job math)");
assertEq(row.app, 0.2512, "row.app (Task 3R blended score, not the old raw total — see block 7 for the full derivation)");

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

console.log("\n── 5. TASK 2R: severity-aware QC score (sb4Agg.qc/qcSeriousPct/qcMinorAvg/qcWalks + NORM.qc) ──");
// jobB2: a deep clone of jobB with its one fromQC item (p3) marked serious —
// NOT a mutation of the shared `jobB` fixture, which block 2 above still
// needs unmodified (1 minor item, walk score 0.975).
const jobB2 = JSON.parse(JSON.stringify(jobB));
jobB2.finishPunch.main.general.find(it => it.id === "p3").severity = "serious";

// Base case, defaults (seriousCredit 0, minorDivisor 40, minorMaxCost 50):
// jobA has 1 fromQC item (p2), no severity => minor. jobB has 1 fromQC item
// (p3), no severity => minor. Neither job has a serious item.
//   walk score (either job) = 1 - min(0.5, 1/40) = 1 - 0.025 = 0.975
const baseAgg = sb4Agg([jobA, jobB]);
assertEq(baseAgg.qc, 0.975, "base: qc = mean(0.975, 0.975) = 0.975 (two 1-minor-item walks)");
assertEq(baseAgg.qcSeriousPct, 0, "base: qcSeriousPct = 0 (no serious items anywhere)");
assertEq(baseAgg.qcMinorAvg, 1, "base: qcMinorAvg = 1 (1 minor item/walk average)");
assertEq(baseAgg.qcWalks, 2, "base: qcWalks = 2 (both jobs had a QC walk)");

// jobB2's p3 is now serious => its walk scores seriousCredit/100 = 0/100 = 0
// regardless of minor count (it has none) — ANY serious item zeroes the
// walk. jobA is untouched at 0.975.
const seriousAgg = sb4Agg([jobA, jobB2]);
assertEq(seriousAgg.qc, 0.4875, "serious: qc = mean(0.975, 0) = 0.4875 — one serious item drags the mean, doesn't just shave it");
assertEq(seriousAgg.qcSeriousPct, 50, "serious: qcSeriousPct = 50 (1 of 2 walks has >=1 serious item)");

// Knob proof 1 — raising seriousCredit gives the serious walk PARTIAL credit
// instead of zero (still uses jobB2, the severity-marked fixture).
const creditAgg = sb4Agg([jobA, jobB2], sb4Config({ qc: { seriousCredit: 50 } }));
assertEq(creditAgg.qc, 0.7375, "knob: seriousCredit 50 => jobB2 walk 0.5 => mean(0.975, 0.5) = 0.7375");

// Knob proof 2 — a harsher minorDivisor bites into a purely-minor walk. jobA
// ALONE (not jobA+jobB) so this isolates the single-walk formula per the
// brief's "jobA walk" wording, uncontaminated by jobB's own score.
const divisorAgg = sb4Agg([jobA], sb4Config({ qc: { minorDivisor: 2 } }));
assertEq(divisorAgg.qc, 0.5, "knob: minorDivisor 2 => jobA walk 1 - min(0.5, 1/2) = 0.5");

// Self-review Q1 — "does a walk with one serious item really score zero?"
// jobB2 ISOLATED (not blended with jobA), so this is a direct proof, not an
// inference from a mean: the walk's OWN score is exactly 0, at defaults.
assertEq(sb4Agg([jobB2]).qc, 0, "self-review: jobB2 alone (its only fromQC item is serious) scores exactly 0, isolated from any blending");

// Self-review Q2 — "does a job with zero QC items still count as a clean
// walk when the status says a walk happened?" jobC has a qcStatus ("pass")
// but NO punch tree at all — zero fromQC items, serious or minor. Walk
// detection (unchanged per the brief) still flags it as a walk via qcStatus,
// so it must score a PERFECT 1.0 (0 serious, 0 minor => no penalty), not be
// dropped or scored as if undiagnosed.
const jobC = { id: "c", name: "Fixture C", foreman: "T", qcStatus: "pass" };
const cleanAgg = sb4Agg([jobC]);
assertEq(cleanAgg.qc, 1, "self-review: qcStatus-only walk with zero fromQC items scores a perfect 1 (clean walk, not undiagnosed)");
assertEq(cleanAgg.qcWalks, 1, "self-review: qcStatus alone (no punch tree) still counts as a walk — detection logic is unchanged");
assertEq(cleanAgg.qcSeriousPct, 0, "self-review: a clean walk contributes 0 to qcSeriousPct");
assertEq(cleanAgg.qcMinorAvg, 0, "self-review: a clean walk contributes 0 to qcMinorAvg");

// Self-review Q3 — the brief flags j.qcPunch by name as a preserve-this trap
// ("the live sb4Agg already walks it and you must preserve that"). jobD's
// ONLY punch tree is qcPunch (no roughPunch/finishPunch at all), with one
// serious + one minor fromQC item, so a severity-rewrite that accidentally
// dropped qcPunch from the walked array would silently score this job as an
// undiagnosed null instead of a failed (score-0) walk.
const jobD = { id: "d", name: "Fixture D", foreman: "T", qcStatus: "fail",
  qcPunch: { main: { general: [ { id: "q1", text: "a", fromQC: true, severity: "serious" }, { id: "q2", text: "b", fromQC: true } ] } } };
const qcPunchAgg = sb4Agg([jobD]);
assertEq(qcPunchAgg.qcWalks, 1, "self-review: qcPunch-only job still counts as a walk (qcPunch is walked, not dropped)");
assertEq(qcPunchAgg.qc, 0, "self-review: qcPunch's serious item (q1) zeroes the walk, proving qcPunch items are read");
assertEq(qcPunchAgg.qcSeriousPct, 100, "self-review: qcPunch-only walk registers as 100% serious");

// Self-review Q4 — the brief spells out "it.fromQC && !it.voided": a voided
// serious item must NOT zero the walk. jobE has one voided serious item
// (excluded entirely, same as it always was for punch/openPunch) and one
// live minor item — the walk should score as a plain 1-minor walk (0.975),
// exactly as if the voided item were never there.
const jobE = { id: "e", name: "Fixture E", foreman: "T", qcStatus: "fail",
  roughPunch: { main: { general: [
    { id: "v1", text: "voided-serious", fromQC: true, severity: "serious", voided: true },
    { id: "v2", text: "live-minor", fromQC: true } ] } } };
const voidedAgg = sb4Agg([jobE]);
assertEq(voidedAgg.qc, 0.975, "self-review: a voided serious item doesn't count — walk scores as if it only had the 1 live minor item");
assertEq(voidedAgg.qcSeriousPct, 0, "self-review: a voided serious item doesn't move qcSeriousPct");

// REVIEW FIX ROUND 1 — unguarded divide-by-zero (src/App.js:39738). When
// c.qc.minorDivisor is tuned to 0 (reachable via Task 7R's admin slider) AND
// a walk is clean (minorCount 0 — jobC, reused from above), the original
// code computed `minorCount / c.qc.minorDivisor` = 0/0 = NaN, poisoning that
// walk's score, the whole aggregate's `qc` (via reduce), and — because
// NORM.qc(NaN) = clamp(NaN) = NaN, and `NaN != null` is true in JS — NOT
// getting filtered by overallOf's `n != null` guard, so it would have
// silently corrupted the standings sort. `assertEq`'s strict `===` alone
// would still technically catch this (NaN === 1 is false), but the printed
// diagnostic is actively misleading (JSON.stringify(NaN) prints "null",
// making a FAIL look like the actual value was null) — so each case below
// gets an explicit Number.isNaN(...) check first, using assertTrue rather
// than assertEq(x, NaN) (NaN === NaN is ALSO false, so that pattern can
// never pass no matter what x is — useless as an equality check either way).
console.log("\n── 6. REVIEW FIX ROUND 1: minorDivisor:0 divide-by-zero guard ──");

// Case 1 — the exact failure scenario: a CLEAN walk (jobC: qcStatus "pass",
// zero fromQC items => minorCount 0) under minorDivisor:0. Intended
// semantics: zero minor items means zero penalty, regardless of divisor.
const cleanZeroDiv = sb4Agg([jobC], sb4Config({ qc: { minorDivisor: 0 } }));
assertTrue(Number.isNaN(cleanZeroDiv.qc) === false, "fix: clean walk (0 minor) under minorDivisor:0 is not NaN", `got ${cleanZeroDiv.qc}`);
assertEq(cleanZeroDiv.qc, 1, "fix: clean walk (0 minor) under minorDivisor:0 scores exactly 1 (no minors = no penalty)");

// Case 2 — nonzero minor count under minorDivisor:0. minorCount/0 is
// +Infinity (not NaN — only 0/0 is NaN), and Math.min(cap, Infinity) already
// correctly resolves to cap on its own; verified this holds (not assumed)
// with a direct node repro before relying on it. Intended semantics: clamp
// to the max penalty, same as an extremely harsh (but finite) divisor would.
const minorZeroDiv = sb4Agg([jobA], sb4Config({ qc: { minorDivisor: 0 } }));
assertTrue(Number.isNaN(minorZeroDiv.qc) === false, "fix: 1-minor walk (jobA) under minorDivisor:0 is not NaN", `got ${minorZeroDiv.qc}`);
assertEq(minorZeroDiv.qc, 0.5, "fix: jobA (1 minor item) under minorDivisor:0 clamps to the max penalty => 1 - minorMaxCost/100 = 0.5");

// Case 3 — a mixed aggregate (jobC clean + jobA 1-minor) under
// minorDivisor:0 must stay finite and equal the mean of the two walk
// scores above (1 and 0.5) — proves the fix doesn't just handle isolated
// single-job cases but the real multi-walk aggregation path.
const mixedZeroDiv = sb4Agg([jobC, jobA], sb4Config({ qc: { minorDivisor: 0 } }));
assertTrue(Number.isNaN(mixedZeroDiv.qc) === false, "fix: mixed aggregate (1 clean + 1 minor walk) under minorDivisor:0 is not NaN", `got ${mixedZeroDiv.qc}`);
assertEq(mixedZeroDiv.qc, 0.75, "fix: mixed aggregate = mean(1, 0.5) = 0.75");

// Non-regression — divisor > 0 must be byte-identical to before this fix.
// Re-run two of the existing (already-passing) cases through the exact same
// code path to prove the guard is a true no-op whenever minorDivisor isn't 0.
assertEq(sb4Agg([jobA, jobB]).qc, 0.975, "fix: no behavior change for the default divisor (40) — base case still 0.975");
assertEq(sb4Agg([jobA], sb4Config({ qc: { minorDivisor: 2 } })).qc, 0.5, "fix: no behavior change for a normal positive divisor (2) — knob proof still 0.5");

// No-walk case: qc (and the display fields) must stay null, not 0 — a person
// with zero QC walks is undiagnosed, not "perfect."
assertEq(sb4Agg([]).qc, null, "empty jobs list: qc stays null (no walks, not a perfect score)");
assertEq(sb4Agg([]).qcSeriousPct, null, "empty jobs list: qcSeriousPct stays null");
assertEq(sb4Agg([]).qcMinorAvg, null, "empty jobs list: qcMinorAvg stays null");
assertEq(sb4Agg([]).qcWalks, 0, "empty jobs list: qcWalks is 0");

// THE INVERSION TRAP. sb4Agg's qc is now an already-normalized 0-1 "higher
// is better" score, so NORM.qc must be the IDENTITY clamp. If NORM.qc were
// still (or reverted to) the old raw-count formula `v => clamp(1 - v/8)`,
// this assertion catches it immediately and loudly:
//   clamp(1 - 0.4875/8) = clamp(1 - 0.0609375) = clamp(0.9390625) ≈ 0.939
// — a walk that scored 0.4875 (half-serious) would normalize to ~0.94
// ("great"), the exact inversion the brief calls the single highest-risk
// line in this task.
assertEq(NORM.qc(0.4875), 0.4875, "NORM.qc(0.4875) === 0.4875 — identity clamp, NOT 1 - v/8 (the inversion trap)");
assertEq(NORM.qc(1), 1, "NORM.qc(1) === 1 — a perfect walk score stays perfect (old formula would give clamp(1-1/8)=0.875)");
assertEq(NORM.qc(0), 0, "NORM.qc(0) === 0 — an all-serious score stays 0 (old formula would give clamp(1-0/8)=1, i.e. \"perfect\")");
assertEq(NORM.qc(null), null, "NORM.qc(null) === null");

console.log("\n── 7. TASK 3R: per-job completeness blended into App Usage (sb4JobComplete/_sb4HasPhoto/sb4Agg.app+appVolume+appComplete + NORM.app) ──");

// sb4JobComplete: 4 presence checks / 4 — non-QC punch, updates, questions,
// photo anywhere. Reuses the shared jobA/jobB fixtures from block 2 as-is
// (read-only here — no mutation, block 2 still needs them unmodified).
// jobA: p1 counts (no fromQC), p2 doesn't (fromQC:true) => 1 non-QC punch item.
//   roughUpdates has 1, roughQuestions.main has 1, no photos anywhere.
assertEq(sb4JobComplete(jobA), 0.75, "sb4JobComplete(jobA) = 3/4 (punch, updates, questions; no photo)");
// jobB: p4 counts (no fromQC), p3 doesn't (fromQC:true) => 1 non-QC punch item.
//   no roughUpdates/finishUpdates, no roughQuestions/finishQuestions, no photos.
assertEq(sb4JobComplete(jobB), 0.25, "sb4JobComplete(jobB) = 1/4 (punch only)");

// tempPed / quickJob exclusion — null, not 0, no matter how complete the job
// otherwise looks (both fixtures below carry updates AND questions).
const jobTP = { id: "tp", name: "Fixture TP", foreman: "T", tempPed: true,
  roughUpdates: [{ text: "d" }], roughQuestions: { main: [{ question: "q" }] } };
const jobQJ = { id: "qj", name: "Fixture QJ", foreman: "T", quickJob: true,
  roughUpdates: [{ text: "d" }], roughQuestions: { main: [{ question: "q" }] } };
assertEq(sb4JobComplete(jobTP), null, "sb4JobComplete(tempPed job) === null, regardless of how complete it otherwise looks");
assertEq(sb4JobComplete(jobQJ), null, "sb4JobComplete(quickJob) === null, regardless of how complete it otherwise looks");

// Photo detection — deliberately broad, recursive over the WHOLE job, not
// just punch trees. Two placements per the brief, each a fresh deep clone of
// jobB (not the shared fixture — block 2 needs jobB unmodified), so both
// isolate a single added photo against jobB's known 1/4 baseline.
const jobB_punchPhoto = JSON.parse(JSON.stringify(jobB));
jobB_punchPhoto.finishPunch.main.general.find(it => it.id === "p4").photos = [{ url: "u", storagePath: "s" }];
assertEq(sb4JobComplete(jobB_punchPhoto), 0.5, "photo on a punch item flips jobB's 4th check: 1/4 -> 2/4 = 0.5");

const jobB_coPhoto = JSON.parse(JSON.stringify(jobB));
jobB_coPhoto.changeOrders = [{ id: "co1", description: "x", photos: [{ url: "u", storagePath: "s" }] }];
assertEq(sb4JobComplete(jobB_coPhoto), 0.5, "photo on a CO (outside any punch tree) also flips jobB's 4th check = 0.5 — detection is job-wide, not punch-only");

// Depth cap — _sb4HasPhoto(o, depth) refuses to look past depth 6. Bury a
// photo exactly at the depth-6 boundary (found) and one level past it
// (depth 7, not found) to prove the cap's off-by-one edge directly, rather
// than trusting the punch/CO placements above (both well within the cap) to
// exercise it incidentally.
let deepOK = { url: "u", storagePath: "s" };
for (let i = 0; i < 6; i++) deepOK = { nest: deepOK };   // photo reachable at depth 6
const deepTooFar = { nest: deepOK };                      // photo reachable at depth 7 — one past the cap
assertEq(_sb4HasPhoto(deepOK, 0), true, "_sb4HasPhoto finds a photo nested exactly at the depth-6 boundary");
assertEq(_sb4HasPhoto(deepTooFar, 0), false, "_sb4HasPhoto stops at depth 6 — one level deeper is NOT found (the cap is honored)");

// appVolume — the SAME formula/job-set as the old raw `app` (ALL punch items
// incl. fromQC, not sb4JobComplete's filtered non-QC-only count). Re-derives
// the pre-Task-3R pinned value (was row.app === 6, block 2) under its new
// name, proving volume's job set didn't change.
const volAgg = sb4Agg([jobA, jobB]);
assertEq(volAgg.appVolume, 6, "appVolume(jobA,jobB) = 6 (punch 4 [ALL punch items] + updates 1 + questions 1) — same total as the old raw `app`, unchanged job set");

// compAvg = mean(0.75, 0.25) = 0.5 -> appComplete = round(0.5*100) = 50.
assertEq(volAgg.appComplete, 50, "appComplete = round(compAvg*100) = 50 (mean of jobA 0.75 and jobB 0.25)");

// Blend at the default appMix (50): app = 0.5*clamp(appVolume/appCap) + 0.5*compAvg.
assertEq(volAgg.app, 0.2512, "app @ default appMix 50 = 0.5*clamp(6/2500) + 0.5*0.5 = 0.0012 + 0.25 = 0.2512");

// appMix 0 => pure volume — EXACT match to what `app` used to mean pre-Task-3R
// (clamp(appVolume/appCap)), the volume-only regression the brief calls out.
const mix0Agg = sb4Agg([jobA, jobB], sb4Config({ appMix: 0 }));
assertEq(mix0Agg.app, mix0Agg.appVolume / 2500, "appMix 0: app === clamp(appVolume/appCap) exactly (volume-only regression)");

// appMix 100 => pure completeness — compAvg exactly, volume plays no part.
const mix100Agg = sb4Agg([jobA, jobB], sb4Config({ appMix: 100 }));
assertEq(mix100Agg.app, 0.5, "appMix 100: app === compAvg exactly = 0.5 (completeness-only)");

// tempPed exclusion from compAvg — adding jobTP (updates+questions both
// present, but excluded by tempPed) alongside jobA/jobB must NOT move
// compAvg/appComplete at all, though it DOES still add to appVolume (the
// raw total's job set is unchanged by this task, per the brief).
const withTPAgg = sb4Agg([jobA, jobB, jobTP]);
assertEq(withTPAgg.appComplete, 50, "adding a tempPed job doesn't move appComplete — it's excluded from compAvg entirely");
assertEq(withTPAgg.appVolume, 8, "but the tempPed job's own updates(1)+questions(1) DO still count toward appVolume (6 + 2 = 8) — volume's job set is unchanged");

// Self-review — "does a foreman whose jobs are all temp peds still get a
// sane score rather than a crash or a zero?" allTPAgg has ZERO
// completeness-eligible jobs: compAvg must be null (not 0), and app must
// fall back to pure volume (not 0, not null, not a crash).
const allTPAgg = sb4Agg([jobTP]);
assertEq(allTPAgg.appComplete, null, "all-tempPed aggregate: appComplete is null (zero eligible jobs, not zero-scored)");
assertEq(allTPAgg.app, allTPAgg.appVolume / 2500, "all-tempPed aggregate: app falls back to pure volume (not 0, not null, not a crash)");
assertTrue(allTPAgg.app > 0, "all-tempPed aggregate: app is a real positive number (jobTP has updates+questions, so appVolume>0)", `got ${allTPAgg.app}`);

// Empty jobs list — no crash, sane null/0 defaults (mirrors the qc empty-list
// checks in block 6 above).
const emptyAgg = sb4Agg([]);
assertEq(emptyAgg.appVolume, 0, "empty jobs list: appVolume is 0");
assertEq(emptyAgg.appComplete, null, "empty jobs list: appComplete is null");
assertEq(emptyAgg.app, 0, "empty jobs list: app is 0 (clamp(0/2500), compAvg null so pure volume)");

// THE INVERSION TRAP. sb4Agg's app is now an already-normalized 0-1 "higher
// is better" score, so NORM.app must be the IDENTITY clamp. If NORM.app were
// still (or reverted to) the old raw-total formula `v => clamp(v / 2500)`,
// this assertion catches it immediately and loudly:
//   clamp(0.2512 / 2500) = clamp(0.00010048) ≈ 0.0001
// — a blended score of 0.2512 would normalize to ~0.0001 ("terrible"),
// exactly the inversion the brief flags as this task's highest-risk line.
assertEq(NORM.app(0.2512), 0.2512, "NORM.app(0.2512) === 0.2512 — identity clamp, NOT v/2500 (the inversion trap)");
assertEq(NORM.app(1), 1, "NORM.app(1) === 1 — a perfect blended score stays perfect (old formula would give clamp(1/2500)=0.0004)");
assertEq(NORM.app(0), 0, "NORM.app(0) === 0");
assertEq(NORM.app(null), null, "NORM.app(null) === null");

console.log("\n── 8. TASK 5: deriveQcVerdict(job) — pure, three-tree, severity-based verdict ──");

// No items anywhere -> "pass". Truly empty job (no punch trees, no fields at all).
assertEq(deriveQcVerdict({}), "pass", "deriveQcVerdict({}): no punch trees at all -> pass (clean walk, nothing called)");
// Defensive: a null/undefined job must not throw (called from render, where a job could
// theoretically be mid-load) — mirrors the `job && job.roughPunch` guard in the implementation.
assertEq(deriveQcVerdict(null), "pass", "deriveQcVerdict(null): no crash, no items -> pass");

// jobA (block 2 fixture): roughPunch has ONE fromQC item (p2), no severity set -> minor-only.
// Proves the roughPunch tree specifically can drive a passed_items verdict.
assertEq(deriveQcVerdict(jobA), "passed_items", "deriveQcVerdict(jobA): 1 minor fromQC item in roughPunch -> passed_items");

// jobB (block 2 fixture): finishPunch has ONE fromQC item (p3), no severity set -> minor-only.
// Proves the finishPunch tree specifically can drive a passed_items verdict.
assertEq(deriveQcVerdict(jobB), "passed_items", "deriveQcVerdict(jobB): 1 minor fromQC item in finishPunch -> passed_items");

// jobB2 (block 5 fixture): jobB's clone with its one fromQC item marked severity:"serious".
// Any serious item anywhere -> fail, regardless of minor count (it has none here).
assertEq(deriveQcVerdict(jobB2), "fail", "deriveQcVerdict(jobB2): finishPunch's one fromQC item is serious -> fail");

// jobD (block 5 fixture): qcPunch ONLY (no roughPunch/finishPunch at all), one serious (q1) +
// one minor (q2). Proves the qcPunch tree is actually walked (the brief's own preserve-this
// trap) and that a serious item there fails the job just like rough/finish would.
assertEq(deriveQcVerdict(jobD), "fail", "deriveQcVerdict(jobD): qcPunch has a serious item -> fail (qcPunch tree is walked, not dropped)");

// jobE (block 5 fixture): roughPunch has one VOIDED serious item + one live minor item. The
// voided item must be excluded entirely — it does not fail the walk, and the live minor item
// alone determines the verdict -> passed_items, NOT fail and NOT pass (voided != absent).
assertEq(deriveQcVerdict(jobE), "passed_items", "deriveQcVerdict(jobE): voided serious item is ignored -> only the live minor item counts -> passed_items");

// New fixture — qcPunch-only, MINOR-only (no serious at all). jobD above already proved
// qcPunch can drive a fail; this proves the tree's OTHER branch (passed_items) too, so
// qcPunch gets the same two-outcome coverage as rough/finish above.
const jobF = { id: "f", name: "Fixture F", foreman: "T",
  qcPunch: { main: { general: [ { id: "f1", text: "minor in qcPunch", fromQC: true } ] } } };
assertEq(deriveQcVerdict(jobF), "passed_items", "deriveQcVerdict(jobF): qcPunch-only, 1 minor item, no serious -> passed_items");

// New fixture — regular (non-fromQC) punch items only, in both rough and finish, zero fromQC
// items anywhere. Proves ordinary punch items never count toward the verdict, only fromQC ones.
const jobG = { id: "g", name: "Fixture G", foreman: "T",
  roughPunch:  { main: { general: [ { id: "g1", text: "not QC", done: false } ] } },
  finishPunch: { main: { general: [ { id: "g2", text: "also not QC", done: true } ] } } };
assertEq(deriveQcVerdict(jobG), "pass", "deriveQcVerdict(jobG): only non-fromQC punch items present -> pass (regular punch never counts)");

// New fixture — severity split ACROSS trees: roughPunch has a minor item, finishPunch has the
// serious one. Proves the verdict is a true UNION over all three trees (any serious item
// anywhere fails the whole job), not scoped to whichever tree is checked first/last.
const jobH = { id: "h", name: "Fixture H", foreman: "T",
  roughPunch:  { main: { general: [ { id: "h1", text: "minor",   fromQC: true } ] } },
  finishPunch: { main: { general: [ { id: "h2", text: "serious", fromQC: true, severity: "serious" } ] } } };
assertEq(deriveQcVerdict(jobH), "fail", "deriveQcVerdict(jobH): minor in roughPunch + serious in finishPunch -> fail (union across all three trees)");

// New fixture — the reviewer's missing case: a SERIOUS item isolated in roughPunch only (no
// finishPunch, no qcPunch). jobH above proves rough contributes to a cross-tree UNION; this
// proves rough's own serious detection in isolation, mirroring jobB2 (finish-only serious) and
// jobD (qcPunch-only serious) which already had isolated coverage.
const jobI = { id: "i", name: "Fixture I", foreman: "T",
  roughPunch: { main: { general: [ { id: "i1", text: "serious", fromQC: true, severity: "serious" } ] } } };
assertEq(deriveQcVerdict(jobI), "fail", "deriveQcVerdict(jobI): roughPunch-only serious item -> fail (isolated proof, not just via cross-tree union like jobH)");

console.log("\n── 9. TASK 5 FIX ROUND 1: deriveQcVerdict(job, phase) — phase-scoped mode ──");
// Review finding (Important): both QC-tab suggestion chips called the WHOLE-JOB
// deriveQcVerdict(job) with no phase attribution, so a job walked on ONE phase only
// could make the OTHER (never-walked) phase's chip suggest — and one click WRITE —
// a verdict for a walk that never happened. Fix: deriveQcVerdict(job, "rough"|"finish")
// walks ONLY that phase's own tree; qcPunch is excluded from phase mode entirely (see
// the comment on deriveQcVerdict's definition for why). These assertions are the ones
// the review explicitly asked for, plus the missing rough-only-serious fixture (jobI,
// added above) exercised in both phase-scoped directions for symmetry with jobA/jobB2.

// Required test 1 — minor items ONLY in roughPunch (jobA: no finishPunch key at all).
// The FINISH phase has zero evidence of its own and must derive "pass" (not leak
// rough's "passed_items"); the ROUGH phase must still derive "passed_items".
assertEq(deriveQcVerdict(jobA, "finish"), "pass", "deriveQcVerdict(jobA,\"finish\"): jobA has no finishPunch at all -> pass (no cross-phase leak from rough's minor item)");
assertEq(deriveQcVerdict(jobA, "rough"), "passed_items", "deriveQcVerdict(jobA,\"rough\"): rough's own 1 minor item -> passed_items");

// Required test 2 — a serious item ONLY in finishPunch (jobB2: no roughPunch key at all).
// The ROUGH phase has zero evidence and must derive "pass"; FINISH must derive "fail".
// This is the EXACT failure mode from the review: pre-fix, the rough chip would have
// shown "Suggested: QC Fail" driven entirely by a finish walk that already happened,
// or (as reported) the reverse — a rough walk's evidence leaking onto an unwalked finish.
assertEq(deriveQcVerdict(jobB2, "rough"), "pass", "deriveQcVerdict(jobB2,\"rough\"): jobB2 has no roughPunch at all -> pass (no cross-phase leak from finish's serious item)");
assertEq(deriveQcVerdict(jobB2, "finish"), "fail", "deriveQcVerdict(jobB2,\"finish\"): finish's own serious item -> fail");

// jobI (rough-only serious, added above) exercised the other direction for symmetry:
// rough sees its own serious item, finish (no finishPunch key) sees nothing.
assertEq(deriveQcVerdict(jobI, "rough"), "fail", "deriveQcVerdict(jobI,\"rough\"): rough's own serious item -> fail");
assertEq(deriveQcVerdict(jobI, "finish"), "pass", "deriveQcVerdict(jobI,\"finish\"): jobI has no finishPunch at all -> pass (no cross-phase leak from rough's serious item)");

// Required test 3 — whole-job mode (phase omitted) is UNCHANGED. Re-run every existing
// whole-job fixture from block 8 above, explicitly passing `undefined` as the second arg
// this time (rather than simply omitting it, as block 8 did) to prove the default
// parameter path is truly identical either way. jobD is the qcPunch-only fixture — it
// MUST still derive from qcPunch when no phase is given, exactly as block 8 already
// pinned; restating it here answers the review's explicit ask directly rather than just
// pointing back at block 8.
assertEq(deriveQcVerdict(jobA, undefined), deriveQcVerdict(jobA), "deriveQcVerdict(jobA, undefined) === deriveQcVerdict(jobA): default phase param is a true no-op");
assertEq(deriveQcVerdict(jobB, undefined), deriveQcVerdict(jobB), "deriveQcVerdict(jobB, undefined) === deriveQcVerdict(jobB): default phase param is a true no-op");
assertEq(deriveQcVerdict(jobB2, undefined), "fail", "deriveQcVerdict(jobB2, undefined): whole-job mode unchanged -> fail (same as block 8's deriveQcVerdict(jobB2))");
assertEq(deriveQcVerdict(jobD, undefined), "fail", "deriveQcVerdict(jobD, undefined): qcPunch-only fixture STILL derives from qcPunch in whole-job mode -> fail (unchanged contract)");
assertEq(deriveQcVerdict(jobE, undefined), "passed_items", "deriveQcVerdict(jobE, undefined): whole-job mode unchanged -> passed_items (same as block 8's deriveQcVerdict(jobE))");
assertEq(deriveQcVerdict(jobH, undefined), "fail", "deriveQcVerdict(jobH, undefined): whole-job cross-tree union unchanged -> fail (same as block 8's deriveQcVerdict(jobH))");

// Required test 4 — voided items still ignored in PHASE mode, not just whole-job mode.
// jobE: roughPunch has one voided serious item + one live minor item, no finishPunch.
// The voided item must not flip rough's verdict to "fail" — only the live minor counts.
assertEq(deriveQcVerdict(jobE, "rough"), "passed_items", "deriveQcVerdict(jobE,\"rough\"): voided serious item ignored in phase mode too -> passed_items (only the live minor item counts)");
assertEq(deriveQcVerdict(jobE, "finish"), "pass", "deriveQcVerdict(jobE,\"finish\"): jobE has no finishPunch at all -> pass");

// qcPunch exclusion from phase mode, proven directly — jobD's qcPunch-only serious item
// (which whole-job mode DOES pick up, per the "unchanged contract" assertion above) must
// NOT be visible to EITHER phase-scoped call, since qcPunch has no rough/finish
// attribution of its own. This is the core of the fix: qcPunch is what would otherwise
// leak a "fail" onto whichever phase's chip happened to render, even with rough AND
// finish both genuinely unwalked.
assertEq(deriveQcVerdict(jobD, "rough"), "pass", "deriveQcVerdict(jobD,\"rough\"): jobD's serious item lives in qcPunch, NOT roughPunch -> pass (qcPunch excluded from phase mode)");
assertEq(deriveQcVerdict(jobD, "finish"), "pass", "deriveQcVerdict(jobD,\"finish\"): same qcPunch item, NOT finishPunch -> pass (qcPunch excluded from phase mode)");

console.log("");
if (failures) {
  console.error(`${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("sb4-dryrun ok (Task 1R/2R/3R/5/5-fix1)");
process.exit(0);
