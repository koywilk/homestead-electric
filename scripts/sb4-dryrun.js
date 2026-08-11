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
 * TASK 6 EXTENSION (2026-08-10) — qcStrandedItems(job, cfg, nowMs), the pure
 * predicate behind the Open Items "Stranded QC Items" row. Task 6 replaced
 * automatic return-trip creation on QC Fail with an explicit confirm choice
 * (fired for BOTH fail and passed_items now), recorded as qcRtChoice/
 * qcRtChoiceBy/qcRtChoiceAt on the job. Removing the automatic safety net is
 * only safe if something else catches items nobody comes back for — this
 * function is that something else: read-only, fires only when a job has
 * open fromQC items, no open QC return trip exists (fromQCFail flag OR the
 * legacy "QC Fail" scope-string prefix — a passed_items RT's scope, "QC
 * Items — return trip", never matches the string alone), the recorded
 * choice was "crew" (site reality said "crew has it"), and that choice is
 * at least cfg.strandedDays old. Declared beside deriveQcVerdict (directly
 * above sb4Agg), so — like sb4JobComplete/deriveQcVerdict before it — it
 * falls inside the existing MAIN region slice with no separate extraction
 * call; block 10 below only adds it to the export object. nowMs/cfg are
 * both explicit params (no internal Date.now()/sb4Config(null) — well,
 * cfg does fall back to sb4Config(null) when omitted, mirroring sb4Agg's
 * own `cfg || sb4Config(null)` pattern), which is what makes this testable
 * without touching the wall clock.
 *
 * TASK 7R EXTENSION (2026-08-10) — cfg is finally wired LIVE: ScoreboardV4
 * holds a `cfg` state seeded from sb4Config(null), the onSnapshot handler sets
 * sb4Config(doc-data) on every settings/scoreboardV4Weights change, saveCfg is
 * the one write path for every knob (weights still route through saveWeights,
 * unchanged call shape), and sb4Build(...,cfg) + NORM(cfg) both consume it —
 * NORM changed from a plain object closing over hardcoded literals to a
 * FACTORY (`NORM(c) => ({...})`) so marginDivisor/handoffDivisor can be
 * admin-tunable AND so this harness can call it with an explicit cfg instead
 * of depending on a React-state free variable. Block 5/7's existing
 * NORM.qc(...)/NORM.app(...) calls are updated to N0.qc(...)/N0.app(...)
 * (N0 = NORM(sb4Config(null)), defined once below) — same assertions, same
 * expected values, just the new call shape; nothing about what they prove
 * changes. Three defects, deferred to this task because they only become
 * reachable once a live config (and the admin sliders that write it) exists,
 * are closed and proven in the new block 11 below:
 *   1. appCap:0 (sb4Agg's app-volume blend) — identical bug class to Task 2R's
 *      qc.minorDivisor fix: appVolume/0 is 0/0=NaN exactly when a person has
 *      logged nothing at all. Fixed with the same "short-circuit the
 *      zero-numerator case before dividing" pattern. While auditing every
 *      divisor/cap for the same class of bug (this task's own self-review
 *      instruction), NORM's marginDivisor/handoffDivisor got the identical
 *      guard — both are newly slider-reachable-to-0 by this same task, so
 *      block 11 proves those two as well, not just the one named defect.
 *   2. sb4Config's `qc` sub-object gains per-field typeof validation, matching
 *      every top-level scalar's existing `typeof s.X === "number" ? s.X :
 *      default` guard — a corrupted/hand-edited doc's non-numeric qc.* no
 *      longer reaches sb4Agg's arithmetic.
 *   3. Backward compatibility — sb4Config now detects the PRE-Task-7R legacy
 *      doc shape (flat top-level {margin,qc,handoff,app} numbers, no nested
 *      `weights` key) via a top-level numeric `margin` (never present in the
 *      new full-config shape) and routes it into the weights sub-object, so
 *      an untouched legacy doc reproduces today's live scoring output
 *      byte-for-byte. This is proven three ways: the config object itself
 *      deep-equals sb4Config(null) for the brief's literal same-as-default
 *      fixture; a SECOND fixture using DIFFERENT (non-default) weight values
 *      proves the flat->nested mapping is real, not a coincidence of the
 *      first fixture's numbers happening to match SB4_DEFAULTS; and a THIRD
 *      fixture proves a doc carrying BOTH stale legacy fields (never deleted
 *      by a later {merge:true} write, since merge only touches fields present
 *      in the write) and a fresh nested `weights` prefers the fresh one.
 *
 * TASK 7R FIX ROUND 1 (2026-08-10) — review finding: strandedDays had exactly
 * ONE consumer (qcStrandedItems) and qcStrandedItems had exactly ONE caller
 * (buildJobActivity, behind the JobActivity/Open Items component), and that
 * caller hardcoded sb4Config(null) — so the admin panel's strandedDays slider
 * saved correctly but was completely inert for its only stated purpose.
 * Fixed by giving JobActivity its own live (non-admin-gated — Open Items must
 * work for everyone) onSnapshot on settings/scoreboardV4Weights and threading
 * a new cfg param through buildJobActivity into that qcStrandedItems call.
 * Block 12 below proves the two things this harness CAN reach (qcStrandedItems
 * and sb4Config are pure/extracted; JobActivity itself is a React component,
 * not unit-testable here — same reasoning already applied to ScoreboardV4's
 * own onSnapshot): the same 10-day-old "crew" choice is flagged at the
 * default strandedDays (7) and NOT flagged at 14, proving the knob's value
 * genuinely changes the outcome; and sb4Config resolves both of JobActivity's
 * branches (nothing loaded -> defaults, a loaded doc -> its real values) sanely.
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
  "\n({ SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build, sb4JobComplete, _sb4HasPhoto, NORM, deriveQcVerdict, qcStrandedItems });\n";

let extracted;
try {
  const sandbox = vm.createContext({});
  extracted = vm.runInContext(combined, sandbox, { filename: "sb4-dryrun-extract.vm.js" });
} catch (e) {
  console.error("EXTRACTION/EVAL FAILED — either App.js source shape changed since this harness was written, or (pre-Task-1R) SB4_DEFAULTS/sb4Config don't exist yet.");
  console.error("  " + e.message);
  process.exit(1);
}
const { SB4_DEFAULTS, sb4Config, SB4_DEFAULT_WEIGHTS, sb4Agg, sb4Build, sb4JobComplete, _sb4HasPhoto, NORM, deriveQcVerdict, qcStrandedItems } = extracted;

// TASK 7R: NORM is now a factory (`c => ({margin,qc,handoff,app})`), not a
// plain object — it needs an explicit cfg, the same way sb4Agg/sb4Build do.
// N0 is the default-cfg normalizer, reused by every existing NORM.qc(...)/
// NORM.app(...) call below (now N0.qc(...)/N0.app(...) — same assertions,
// same expected values) and by block 11's new marginDivisor/handoffDivisor
// guard proofs.
const N0 = NORM(sb4Config(null));

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
// TASK 7R: NORM is now a factory — N0 = NORM(sb4Config(null)), defined once
// near the top of this file. Same assertions, same expected values as before;
// only the call shape (NORM.qc -> N0.qc) changed.
assertEq(N0.qc(0.4875), 0.4875, "N0.qc(0.4875) === 0.4875 — identity clamp, NOT 1 - v/8 (the inversion trap)");
assertEq(N0.qc(1), 1, "N0.qc(1) === 1 — a perfect walk score stays perfect (old formula would give clamp(1-1/8)=0.875)");
assertEq(N0.qc(0), 0, "N0.qc(0) === 0 — an all-serious score stays 0 (old formula would give clamp(1-0/8)=1, i.e. \"perfect\")");
assertEq(N0.qc(null), null, "N0.qc(null) === null");

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
// TASK 7R: NORM.app -> N0.app (see the N0 comment above block 5).
assertEq(N0.app(0.2512), 0.2512, "N0.app(0.2512) === 0.2512 — identity clamp, NOT v/2500 (the inversion trap)");
assertEq(N0.app(1), 1, "N0.app(1) === 1 — a perfect blended score stays perfect (old formula would give clamp(1/2500)=0.0004)");
assertEq(N0.app(0), 0, "N0.app(0) === 0");
assertEq(N0.app(null), null, "N0.app(null) === null");

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

console.log("\n── 10. TASK 6 (FIX ROUND 1, 2026-08-10): qcStrandedItems(job, cfg, nowMs) — per-phase choice, item-scoped coverage ──");
// Fixed clock — deterministic regardless of when this script actually runs.
// All fixture qcRtChoice*At values are built from this via toISOString(),
// which always renders "Z" (UTC), so the math is timezone-proof too.
const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const daysAgoIso = (n) => new Date(NOW - n * 86400000).toISOString();
const cfgDefault = sb4Config(null); // strandedDays: 7, per block 3's pin

// ── Never-walked guard — still must hold after the rewrite. No choice
// field anywhere (neither phase-specific nor the flat fallback) resolves
// to undefined on both phases, which fails the "==='crew'" check immediately.
const jobNeverWalked = { id:"nw1", name:"Never QC-Walked",
  roughPunch: { main: { general: [ { id:"n1", text:"x", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobNeverWalked, cfgDefault, NOW), null, "never-walked guard: open fromQC items but no qcRtChoice fields at all (neither phase-specific nor flat) -> null, can NEVER fire");

// ── Open-item state gates: done, voided (the review's named gap), and a mix ──
const jobAllDone = { id:"ad1", name:"All Items Done", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [ { id:"ad-1", text:"x", fromQC:true, done:true } ] } } };
assertEq(qcStrandedItems(jobAllDone, cfgDefault, NOW), null, "item is done (not open) -> null, nothing stranded");

const jobAllVoided = { id:"av1", name:"All Items Voided", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [
    { id:"av-1", text:"a", fromQC:true, done:false, voided:true },
    { id:"av-2", text:"b", fromQC:true, done:false, voided:true },
  ] } } };
assertEq(qcStrandedItems(jobAllVoided, cfgDefault, NOW), null, "review gap fix: ALL QC items voided (not merely done) -> null, nothing stranded");

const jobMixedItems = { id:"mi1", name:"Voided + Done + Live", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [
    { id:"v1", text:"voided",   fromQC:true, done:false, voided:true },
    { id:"v2", text:"done",     fromQC:true, done:true },
    { id:"v3", text:"live-one", fromQC:true, done:false },
  ] } } };
assertEq(qcStrandedItems(jobMixedItems, cfgDefault, NOW), 1, "voided + done fromQC items excluded from the count -> only the 1 live open item counts");

// ── Age gate + boundary + multi-tree summing ──
const jobTooRecent = { id:"tr1", name:"Too Recent", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(2),
  roughPunch: { main: { general: [ { id:"t1", text:"x", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobTooRecent, cfgDefault, NOW), null, "choice only 2 days old (< strandedDays 7) -> null, too soon to flag");

// Exactly strandedDays old (>=, not >) fires. Also proves qcPunch sums in via
// the OR'd (unattributable) gate alongside roughPunch's own gate.
const jobAtBoundary = { id:"bd1", name:"Exactly At Boundary", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(7),
  roughPunch: { main: { general: [ { id:"b1", text:"a", fromQC:true, done:false } ] } },
  qcPunch:    { main: { general: [ { id:"b2", text:"b", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobAtBoundary, cfgDefault, NOW), 2, "boundary: rough choice exactly 7 days old (strandedDays) -> fires (>=, not >); count sums roughPunch (own gate) + qcPunch (OR'd gate) = 2");

// ═══════════════════════════════════════════════════════════════════════
// REQUIRED TEST 1 — THE REVIEW'S CRITICAL FINDING, VERBATIM SCENARIO.
// Rough walk -> "crew" 10 days ago (items left open, never covered). Finish
// walk LATER -> "rt", which creates its OWN RT covering ONLY finish's item.
// Under the pre-fix job-level model this returned null for TWO independent
// reasons: (a) an RT existed at all (job-level hasQcRt), and (b) the flat
// qcRtChoice field had been overwritten from "crew" to "rt" by the later
// finish write. Rough's abandoned item — the exact "forgotten after the
// crew leaves" case the removed automatic RT-creation used to guarantee
// against — MUST still surface.
// ═══════════════════════════════════════════════════════════════════════
const jobReviewScenario = { id:"rev1", name:"Review Scenario — rough abandoned despite finish's own RT+choice",
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(10),
  qcRtChoiceFinish:"rt",  qcRtChoiceFinishAt:daysAgoIso(1),
  roughPunch:  { main: { general: [ { id:"rough1", text:"rough item", fromQC:true, done:false } ] } },
  finishPunch: { main: { general: [ { id:"finish1", text:"finish item", fromQC:true, done:false } ] } },
  returnTrips: [ { id:"rt1", scope:"QC Items — return trip", fromQCFail:true, signedOff:false,
    punch: [ { id:"p1", text:"finish item", fromQC:true, done:false, originItemId:"finish1", originPhase:"finish" } ] } ] };
assertEq(qcStrandedItems(jobReviewScenario, cfgDefault, NOW), 1,
  "REVIEW SCENARIO (Critical finding): rough chose crew 10d ago, uncovered; finish chose rt later and got its own RT covering only finish's item. Old job-level code returned null (RT existed at all; flat choice overwritten to 'rt'). Rough's item MUST still surface -> 1");

// ── Required test 2 — item-scoped coverage: exactly ONE of two, not 0 or 2 ──
const jobPartialCoverage = { id:"pc1", name:"Item-Scoped Coverage — 2 open, 1 covered",
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [
    { id:"pc-a", text:"a", fromQC:true, done:false },
    { id:"pc-b", text:"b", fromQC:true, done:false },
  ] } },
  returnTrips: [ { id:"rt2", scope:"QC Items — return trip", fromQCFail:true, signedOff:false,
    punch: [ { id:"p2", text:"a", fromQC:true, done:false, originItemId:"pc-a", originPhase:"rough" } ] } ] };
assertEq(qcStrandedItems(jobPartialCoverage, cfgDefault, NOW), 1, "item-scoped coverage: 2 open rough items, RT covers only the first by originItemId -> exactly 1 stranded (not 0, not 2)");

// ── Required test 3 — a signed-off RT does not count as coverage ──
const jobSignedOffCoverage = { id:"soc1", name:"Signed-Off RT Is Not Coverage",
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [ { id:"soc-a", text:"a", fromQC:true, done:false } ] } },
  returnTrips: [ { id:"rt3", scope:"QC Items — return trip", fromQCFail:true, signedOff:true,
    punch: [ { id:"p3", text:"a", fromQC:true, done:true, originItemId:"soc-a", originPhase:"rough" } ] } ] };
assertEq(qcStrandedItems(jobSignedOffCoverage, cfgDefault, NOW), 1, "signed-off RT does not count as coverage: item still stranded even though a (closed, signed-off) RT once referenced it");

// ── Required test 4 — per-phase independence ──
const jobPerPhase = { id:"pp1", name:"Per-Phase Independence",
  qcRtChoiceRough:"rt",    qcRtChoiceRoughAt:daysAgoIso(30),
  qcRtChoiceFinish:"crew", qcRtChoiceFinishAt:daysAgoIso(30),
  roughPunch:  { main: { general: [ { id:"pp-r1", text:"r", fromQC:true, done:false } ] } },
  finishPunch: { main: { general: [ { id:"pp-f1", text:"f", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobPerPhase, cfgDefault, NOW), 1, "per-phase independence: rough chose 'rt' (not stranded), finish chose 'crew'/old (stranded) -> only finish's 1 item counted");

// ── Required test 5 — qcPunch items are unattributable to a phase: OR, not AND ──
const jobQcPunchEither = { id:"qpe1", name:"qcPunch — fires when EITHER phase is old-crew",
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  qcRtChoiceFinish:"rt",  qcRtChoiceFinishAt:daysAgoIso(30),
  qcPunch: { main: { general: [ { id:"qpe-1", text:"q", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobQcPunchEither, cfgDefault, NOW), 1, "qcPunch item: rough chose 'crew'/old (finish chose 'rt') -> unattributable item still flagged (OR across phases, over-warn bias for a safety net)");

const jobQcPunchNeither = { id:"qpn1", name:"qcPunch — silent when BOTH phases are rt",
  qcRtChoiceRough:"rt", qcRtChoiceRoughAt:daysAgoIso(30),
  qcRtChoiceFinish:"rt", qcRtChoiceFinishAt:daysAgoIso(30),
  qcPunch: { main: { general: [ { id:"qpn-1", text:"q", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobQcPunchNeither, cfgDefault, NOW), null, "qcPunch item: BOTH phases chose 'rt' -> not stranded (null)");

// ── Fallback: old flat qcRtChoice/qcRtChoiceAt (the shape this task shipped
// with for one commit) applies to BOTH phases when no phase-specific field
// exists, and a present phase-specific field always wins over a conflicting
// flat value. Nothing has shipped, so this is a courtesy, not a real
// migration — still required by the fix's own spec, so pinned here. ──
const jobFlatFallbackBoth = { id:"ffb1", name:"Flat Fallback Applies To Both Phases",
  qcRtChoice:"crew", qcRtChoiceAt:daysAgoIso(30), // ONLY the pre-fix-round-1 flat fields
  roughPunch:  { main: { general: [ { id:"ffb-r", text:"r", fromQC:true, done:false } ] } },
  finishPunch: { main: { general: [ { id:"ffb-f", text:"f", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobFlatFallbackBoth, cfgDefault, NOW), 2, "fallback: a job with ONLY the old flat qcRtChoice/qcRtChoiceAt (no phase-specific fields at all) applies that choice to BOTH phases -> both rough AND finish items counted (2)");

const jobPhaseWinsOverFlat = { id:"pwf1", name:"Phase-Specific Wins Over A Conflicting Flat Value",
  qcRtChoice:"rt", qcRtChoiceAt:daysAgoIso(30),                    // flat says "rt" (would NOT strand)
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),         // rough-specific overrides to "crew"
  roughPunch: { main: { general: [ { id:"pwf-r", text:"r", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobPhaseWinsOverFlat, cfgDefault, NOW), 1, "fallback priority: phase-specific qcRtChoiceRough===\"crew\" wins over a conflicting flat qcRtChoice===\"rt\" -> stranded (1)");

// ── Regression guard: an unrelated-feature RT (the "Failed 4-way inspection"
// conversion, which links via fromRoughInspectionId, never originItemId)
// must NOT accidentally provide coverage. ──
const jobUnrelatedRtNoCoverage = { id:"urn1", name:"Unrelated Inspection RT Provides No Coverage",
  qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(30),
  roughPunch: { main: { general: [ { id:"urn-a", text:"a", fromQC:true, done:false } ] } },
  returnTrips: [ { id:"rt4", scope:"Failed 4-way inspection items", signedOff:false,
    punch: [ { id:"p4", text:"a", done:false, fromRoughInspectionId:"urn-a" } ] } ] };
assertEq(qcStrandedItems(jobUnrelatedRtNoCoverage, cfgDefault, NOW), 1, "regression guard: an unrelated-feature RT (4-way inspection conversion, fromRoughInspectionId not originItemId) provides NO coverage -> item still stranded (1)");

// ── Config knob — same job, two different strandedDays ──
const jobKnob = { id:"kb1", name:"Knob", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:daysAgoIso(3),
  roughPunch: { main: { general: [ { id:"k1", text:"x", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobKnob, cfgDefault, NOW), null, "knob: 3 days old < default strandedDays(7) -> null");
assertEq(qcStrandedItems(jobKnob, sb4Config({ strandedDays: 2 }), NOW), 1, "knob: same job, strandedDays tuned to 2 -> 3 days clears it -> fires (1)");

// cfg omitted (undefined) falls back to sb4Config(null) defaults, same as an explicit cfgDefault.
assertEq(qcStrandedItems(jobAtBoundary, undefined, NOW), qcStrandedItems(jobAtBoundary, cfgDefault, NOW), "cfg omitted (undefined) falls back to sb4Config(null) defaults, same result as explicit cfgDefault");

// ── Defensive — null/undefined job, and a malformed/empty qcRtChoiceRoughAt,
// must never throw or return NaN-poisoned garbage. ──
assertEq(qcStrandedItems(null, cfgDefault, NOW), null, "defensive: qcStrandedItems(null, ...) -> null, no crash");
assertEq(qcStrandedItems(undefined, cfgDefault, NOW), null, "defensive: qcStrandedItems(undefined, ...) -> null, no crash");
const jobBadDate = { id:"bd2", name:"Bad Date", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:"not-a-date",
  roughPunch: { main: { general: [ { id:"bad1", text:"x", fromQC:true, done:false } ] } } };
assertTrue(qcStrandedItems(jobBadDate, cfgDefault, NOW) === null, "defensive: unparseable qcRtChoiceRoughAt -> null, not NaN/crash (NaN>=0 is false)");
const jobEmptyAt = { id:"ea1", name:"Empty qcRtChoiceRoughAt", qcRtChoiceRough:"crew", qcRtChoiceRoughAt:"",
  roughPunch: { main: { general: [ { id:"ea2", text:"x", fromQC:true, done:false } ] } } };
assertEq(qcStrandedItems(jobEmptyAt, cfgDefault, NOW), null, "defensive: qcRtChoiceRoughAt==='' (falsy) -> null, no crash");

console.log("\n── 11. TASK 7R: cfg wired live — appCap/marginDivisor/handoffDivisor NaN guards, qc sub-validation, backward compat ──");

// ── DEFECT 1 (+ two siblings found via this task's own self-review: "try 0
// for each divisor/cap"): appCap:0 no longer produces NaN. appVolume/0 for
// any appVolume>0 is +Infinity, which _sb4Clamp already resolves to 1 on its
// own (Math.min/max never produce NaN from Infinity) — only the EXACT
// appVolume===0 case is 0/0=NaN. Two fixtures below exercise the two
// DIFFERENT code paths a NaN volume can poison: an empty jobs list (compAvg
// stays null -> the `compAvg==null ? volume : ...` TRUE branch) and a single
// job with genuinely zero logged activity but which is NOT tempPed/quickJob
// (compAvg becomes a real 0, not null -> the FALSE/blend branch, where
// `(1-mix)*NaN` is NaN regardless of mix, even at mix=1, since 0*NaN=NaN in
// IEEE754 — so compAvg==0 does NOT "save" the blend from a poisoned volume). ──
const emptyZeroCap = sb4Agg([], sb4Config({ appCap: 0 }));
assertTrue(Number.isNaN(emptyZeroCap.app) === false, "fix: empty jobs list under appCap:0 is not NaN (compAvg==null branch)", `got ${emptyZeroCap.app}`);
assertEq(emptyZeroCap.app, 0, "fix: empty jobs list under appCap:0 scores exactly 0 (zero volume = zero credit, regardless of cap)");

const jobZero = { id: "z", name: "Fixture Zero Activity", foreman: "T" }; // no punch/updates/questions/photos anywhere, NOT tempPed/quickJob
assertEq(sb4JobComplete(jobZero), 0, "sanity: jobZero's own completeness is a real 0 (0/4 checks), NOT null — it's an eligible job that happens to be empty, unlike tempPed/quickJob");
const zeroActAgg = sb4Agg([jobZero], sb4Config({ appCap: 0 }));
assertTrue(Number.isNaN(zeroActAgg.app) === false, "fix: a single genuinely-empty job under appCap:0 is not NaN (compAvg==0, the BLEND branch — 0*NaN would still be NaN pre-fix, proving compAvg alone can't mask the volume bug)", `got ${zeroActAgg.app}`);
assertEq(zeroActAgg.appVolume, 0, "fix: jobZero's appVolume is 0 (nothing logged)");
assertEq(zeroActAgg.appComplete, 0, "fix: jobZero's appComplete is 0 (not null — it's an eligible, just empty, job)");
assertEq(zeroActAgg.app, 0, "fix: jobZero under appCap:0 blends to exactly 0 — (1-mix)*0 + mix*0 = 0");

// Non-regression — appVolume>0 under appCap:0 was ALREADY correct pre-fix
// (Math.min/clamp resolve +Infinity to 1 on their own); re-run jobA+jobB
// (block 2/7's appVolume=6, compAvg=0.5 fixtures) to prove the fix doesn't
// disturb that side of the formula.
const volNonZeroZeroCap = sb4Agg([jobA, jobB], sb4Config({ appCap: 0 }));
assertTrue(Number.isNaN(volNonZeroZeroCap.app) === false, "non-regression: appVolume=6 under appCap:0 is not NaN (was never at risk — only the 0/0 case is)");
assertEq(volNonZeroZeroCap.appVolume, 6, "non-regression: appVolume itself is untouched by appCap");
assertEq(volNonZeroZeroCap.app, 0.75, "non-regression: appCap:0 with real volume clamps to full volume credit (1) — (1-0.5)*1 + 0.5*0.5 = 0.75");

// Same bug class, same fix pattern, found while auditing every divisor/cap
// per this task's self-review instruction: NORM.margin/NORM.handoff are
// NEWLY slider-reachable to 0 by this very task (marginDivisor/handoffDivisor
// were hardcoded 50/20 before Task 7R, never adjustable, never 0). v===0 is
// the only NaN-risk value (v/0 for v!=0 is +-Infinity, already resolved
// correctly by clamp's Math.min/max) — short-circuited BEFORE dividing,
// exactly like appCap/qc.minorDivisor above.
const Nzero = NORM(sb4Config({ marginDivisor: 0, handoffDivisor: 0 }));
assertTrue(Number.isNaN(Nzero.margin(0)) === false, "fix: NORM.margin(0) under marginDivisor:0 is not NaN (0% margin, the exact 0/0 case)", `got ${Nzero.margin(0)}`);
assertEq(Nzero.margin(0), 0, "fix: NORM.margin(0) under marginDivisor:0 is exactly 0 (0% margin = 0 credit, regardless of the divisor)");
assertTrue(Number.isNaN(Nzero.margin(20)) === false, "fix: NORM.margin(20) under marginDivisor:0 is not NaN (nonzero numerator, was never actually at risk)");
assertEq(Nzero.margin(20), 1, "fix: NORM.margin(20) under marginDivisor:0 clamps to 1 (any positive margin over a 0 divisor is +Infinity -> full credit)");
assertEq(Nzero.margin(-5), 0, "fix: NORM.margin(-5) under marginDivisor:0 clamps to 0 (a negative margin over a 0 divisor is -Infinity -> zero credit)");
assertEq(Nzero.margin(null), null, "fix: NORM.margin(null) stays null under marginDivisor:0 too — the null guard runs before any division");
assertTrue(Number.isNaN(Nzero.handoff(0)) === false, "fix: NORM.handoff(0) under handoffDivisor:0 is not NaN (0% open punch, the exact 0/0 case)", `got ${Nzero.handoff(0)}`);
assertEq(Nzero.handoff(0), 1, "fix: NORM.handoff(0) under handoffDivisor:0 is exactly 1 (a perfectly clean handoff is always full credit, regardless of the divisor)");
assertTrue(Number.isNaN(Nzero.handoff(50)) === false, "fix: NORM.handoff(50) under handoffDivisor:0 is not NaN (nonzero numerator, was never actually at risk)");
assertEq(Nzero.handoff(50), 0, "fix: NORM.handoff(50) under handoffDivisor:0 clamps to 0 (any open punch over a 0 divisor scores zero)");
assertEq(Nzero.handoff(null), null, "fix: NORM.handoff(null) stays null under handoffDivisor:0 too");
// Non-regression — the short-circuit's value equals what the undivided
// formula already gave for v===0 at any NORMAL (nonzero) divisor, so this is
// a true no-op for the live board today, not a behavior change. Also sanity
// pins a normal nonzero value through each formula.
assertEq(N0.margin(0), 0, "non-regression: NORM.margin(0) at the default marginDivisor(50) is still exactly 0 — same value the guard produces");
assertEq(N0.margin(25), 0.5, "non-regression: NORM.margin(25) at the default marginDivisor(50) is unaffected by the guard — clamp(25/50)=0.5");
assertEq(N0.handoff(0), 1, "non-regression: NORM.handoff(0) at the default handoffDivisor(20) is still exactly 1 — same value the guard produces");
assertEq(N0.handoff(10), 0.5, "non-regression: NORM.handoff(10) at the default handoffDivisor(20) is unaffected by the guard — clamp(1-10/20)=0.5");

// NORM's own contract changed shape (Task 7R) — a factory, not a plain
// object — pinned directly so a future revert back to a closure-only NORM
// (which would silently break testability, not correctness) is caught.
assertEq(typeof NORM, "function", "NORM is now a factory function (cfg => normalizer), not a plain object closing over hardcoded literals or React state");

// ── DEFECT 2: sb4Config's qc sub-object now validates each field
// individually, exactly like every top-level scalar already does
// (`typeof s.X === "number" ? s.X : default`). A corrupted/hand-edited
// doc's non-numeric qc.* must fall back to its own default, not reach
// sb4Agg's arithmetic, and a valid sibling in the SAME patch must survive. ──
const qcBadDivisor = sb4Config({ qc: { minorDivisor: "bad", seriousCredit: 10 } });
assertEq(qcBadDivisor.qc.minorDivisor, 40, "fix: a non-numeric qc.minorDivisor (string) falls back to SB4_DEFAULTS.qc.minorDivisor (40)");
assertEq(qcBadDivisor.qc.seriousCredit, 10, "fix: a VALID sibling in the same patch (seriousCredit) is still kept, not collateral damage from minorDivisor's fallback");
assertEq(qcBadDivisor.qc.minorMaxCost, 50, "fix: an untouched sibling (minorMaxCost) falls back to its own default independently");

const qcBadCredit = sb4Config({ qc: { seriousCredit: "x", minorMaxCost: 30 } });
assertEq(qcBadCredit.qc.seriousCredit, 0, "fix: a non-numeric qc.seriousCredit (string) falls back to SB4_DEFAULTS.qc.seriousCredit (0)");
assertEq(qcBadCredit.qc.minorMaxCost, 30, "fix: a valid sibling (minorMaxCost) in the same patch is kept");

assertEq(sb4Config({ qc: { minorMaxCost: null } }).qc.minorMaxCost, 50, "fix: a non-numeric qc.minorMaxCost (null) falls back to SB4_DEFAULTS.qc.minorMaxCost (50) — typeof null is \"object\", not \"number\"");

// qc entirely non-object (worse corruption than a bad sub-field) must not
// throw and must fall back to full defaults, not partially crash.
assertEq(sb4Config({ qc: "corrupted" }).qc, SB4_DEFAULTS.qc, "fix: qc itself as a non-object (string) falls back to full SB4_DEFAULTS.qc, no crash");
assertEq(sb4Config({ qc: null }).qc, SB4_DEFAULTS.qc, "fix: qc itself as null falls back to full SB4_DEFAULTS.qc, no crash (typeof null==='object' would slip past a naive typeof-only guard — the `s.qc &&` truthiness check catches it)");

// Non-regression — a FULLY valid qc object still round-trips exactly (proves
// the per-field rewrite didn't change behavior for well-formed input).
assertEq(sb4Config({ qc: { seriousCredit: 15, minorDivisor: 25, minorMaxCost: 60 } }).qc, { seriousCredit: 15, minorDivisor: 25, minorMaxCost: 60 }, "non-regression: a fully valid qc object still round-trips exactly, field for field");

// ── DEFECT 3 (BACKWARD COMPATIBILITY — load-bearing, the most important
// assertion in this task): the settings/scoreboardV4Weights doc in
// production today holds ONLY flat top-level {margin,qc,handoff,app} numbers
// — no nested `weights` key, no other config key. sb4Config must turn that
// into a full config with every OTHER key at its default, so the live
// board's behavior is UNCHANGED the moment this ships, until the owner
// actually moves a slider. Proven three ways below. ──

// Prong 1 — the literal brief fixture: flat values that happen to MATCH the
// hardcoded defaults. Strongest possible pin: the resulting config is
// deep-equal to SB4_DEFAULTS itself (and therefore to sb4Config(null), which
// block 4 already pins deep-equal to SB4_DEFAULTS) — not just "close enough".
const legacyDocSameAsDefault = { margin: 45, qc: 25, handoff: 20, app: 10 };
const cfgFromLegacySame = sb4Config(legacyDocSameAsDefault);
assertEq(cfgFromLegacySame, SB4_DEFAULTS, "BACKWARD COMPAT (most important assertion in this task): a legacy weights-only doc — flat {margin,qc,handoff,app}, no nested `weights` key, nothing else — round-trips through sb4Config to a full config deep-equal to SB4_DEFAULTS");
// End-to-end through the actual scoring pipeline, not just the config shape
// — sb4Build's OUTPUT for the legacy doc must match sb4Build's output for
// the real defaults, using the same jobs/users fixtures blocks 1-2 already
// verified sb4Build against.
assertEq(sb4Build(jobs, "foremen", users, cfgFromLegacySame), sb4Build(jobs, "foremen", users, sb4Config(null)), "BACKWARD COMPAT: sb4Build's SCORING OUTPUT for the legacy doc is identical to sb4Config(null)'s — not merely the config object, the actual computed rows");

// Prong 2 — DIFFERENT (non-default) weight values. Fixture 1 alone can't
// discriminate "the flat->nested mapping actually works" from "sb4Config
// just always falls back to defaults regardless of input", because its
// numbers happen to BE the defaults. This fixture closes that gap: a real
// legacy doc with values Koy actually chose must map EXACTLY, not collapse
// to defaults.
const legacyDocDifferent = { margin: 12, qc: 63, handoff: 9, app: 16 };
const cfgFromLegacyDifferent = sb4Config(legacyDocDifferent);
assertEq(cfgFromLegacyDifferent.weights, { margin: 12, qc: 63, handoff: 9, app: 16 }, "BACKWARD COMPAT (stronger proof): a legacy doc with DIFFERENT non-default weight values maps its flat fields into weights EXACTLY — proves this is a real mapping, not a coincidence of fixture 1's numbers matching the defaults");
assertEq(cfgFromLegacyDifferent.marginDivisor, SB4_DEFAULTS.marginDivisor, "a true legacy doc never had marginDivisor — falls back to default even though OTHER fields (weights) were present and valid");
assertEq(cfgFromLegacyDifferent.marginTarget, SB4_DEFAULTS.marginTarget, "same — marginTarget falls back to default");
assertEq(cfgFromLegacyDifferent.handoffDivisor, SB4_DEFAULTS.handoffDivisor, "same — handoffDivisor falls back to default");
assertEq(cfgFromLegacyDifferent.appCap, SB4_DEFAULTS.appCap, "same — appCap falls back to default");
assertEq(cfgFromLegacyDifferent.appMix, SB4_DEFAULTS.appMix, "same — appMix falls back to default");
assertEq(cfgFromLegacyDifferent.strandedDays, SB4_DEFAULTS.strandedDays, "same — strandedDays falls back to default");
// The qc NAME COLLISION: the legacy doc's top-level `qc` is a WEIGHT number
// (63), not the qc severity sub-config object — sb4Config must not let it
// leak into cfg.qc (proven safe by the `typeof s.qc === "object"` guard in
// DEFECT 2's fix above; this pins the specific legacy-doc scenario directly).
assertEq(cfgFromLegacyDifferent.qc, SB4_DEFAULTS.qc, "BACKWARD COMPAT / qc name collision: the legacy doc's top-level `qc` (63) is a WEIGHT, not the severity sub-config — cfg.qc stays at SB4_DEFAULTS.qc entirely, uncorrupted by the collision");

// Prong 3 — coexistence: a doc carrying BOTH stale legacy flat fields (never
// deleted by a later {merge:true} write — merge only touches fields present
// in the write, so pre-Task-7R margin/qc/handoff/app linger forever once a
// NEW-shape save adds `weights` alongside them) AND a fresh nested `weights`
// must prefer the fresh one, not the stale flat numbers.
const coexistDoc = {
  margin: 999, qc: 999, handoff: 999, app: 999,          // stale, pre-Task-7R leftovers
  weights: { margin: 11, qc: 22, handoff: 33, app: 44 }, // fresh, post-Task-7R shape
  marginDivisor: 77,
};
const cfgCoexist = sb4Config(coexistDoc);
assertEq(cfgCoexist.weights, { margin: 11, qc: 22, handoff: 33, app: 44 }, "BACKWARD COMPAT / coexistence: once a fresh nested `weights` exists, it wins over stale leftover flat fields from before this shipped — NOT the stale 999s");
assertEq(cfgCoexist.marginDivisor, 77, "coexistence: a real new-shape scalar (marginDivisor) reads correctly regardless of stale flat fields sitting alongside it");
assertEq(cfgCoexist.qc, SB4_DEFAULTS.qc, "coexistence: the stale flat `qc:999` still doesn't leak into the qc sub-config, same as prong 2");

console.log("\n── 12. TASK 7R FIX ROUND 1 (2026-08-10): strandedDays actually reaches Open Items ──");
// Review finding (Important): buildJobActivity's qcStrandedItems call
// (src/App.js, behind the JobActivity component's Open Items feed) was
// hardcoded to sb4Config(null) — strandedDays has exactly ONE consumer
// (qcStrandedItems) and qcStrandedItems has exactly ONE caller (that line),
// so the admin panel's "Days before crew-held QC items surface on Open
// Items" slider was completely inert: it saved, the number on screen
// updated, but the Open Items warning never actually changed. Fix:
// JobActivity now holds its own live cfg (a second, independent,
// NON-admin-gated onSnapshot on the SAME settings/scoreboardV4Weights doc —
// Open Items must work for every user, unlike ScoreboardV4's admin-only
// tab), seeded with sb4Config(null) and threaded through buildJobActivity's
// new cfg param into this exact qcStrandedItems call.
//
// qcStrandedItems/sb4Config are pure and extracted, so the two REQUIRED
// proofs below can exercise the real mechanism the fix relies on:
// qcStrandedItems genuinely responding to a non-default strandedDays, and
// sb4Config genuinely resolving both of JobActivity's two branches (nothing
// loaded / loaded) sanely. But neither of those, on its own, proves
// buildJobActivity/JobActivity actually WIRE a live cfg into that call —
// JobActivity is a React component with hooks (an onSnapshot listener), not
// unit-testable in this VM sandbox (same boundary this file already accepts
// for ScoreboardV4's own onSnapshot wiring) — so a THIRD check, after the two
// required ones, greps the raw source text (already loaded as `src`, above)
// for the exact wiring itself: this is deliberately a structural pin, not a
// behavioral test, and it exists specifically so a future revert of the
// wiring (reverting buildJobActivity's signature, or deleting JobActivity's
// listener, while leaving qcStrandedItems/sb4Config untouched) is still
// caught — the two behavioral proofs above cannot catch that on their own,
// since they call qcStrandedItems/sb4Config directly and would keep passing
// even if buildJobActivity/JobActivity regressed back to the hardcoded form.

// Required test 1 — same job, same 10-day-old "crew" choice, two different
// strandedDays: default (7) fires, tuned to 14 (more lenient) does not.
// Asserted in BOTH directions so this can't pass by only checking the
// direction that happens to match a null-safe default.
const jobStranded10d = { id: "sd1", name: "Fix Round 1 — strandedDays knob actually bites",
  qcRtChoiceRough: "crew", qcRtChoiceRoughAt: daysAgoIso(10),
  roughPunch: { main: { general: [ { id: "sd-1", text: "x", fromQC: true, done: false } ] } } };
assertEq(qcStrandedItems(jobStranded10d, sb4Config(null), NOW), 1, "fix: at the DEFAULT strandedDays (7), a 10-day-old 'crew' choice IS old enough -> flagged (1)");
assertEq(qcStrandedItems(jobStranded10d, sb4Config({ strandedDays: 14 }), NOW), null, "fix: the SAME job/choice at strandedDays TUNED TO 14 is NOT old enough yet -> not flagged (null) — proves the knob's value actually changes the outcome, not just that it saves");

// Required test 2 — the accessor/fallback I introduced is a direct reuse of
// sb4Config (no new wrapper function): JobActivity's useState(() =>
// sb4Config(null)) seed AND its onSnapshot's `s.exists() ? s.data() : null`
// ternary both resolve through it. Prove both branches directly.
assertEq(sb4Config(null), SB4_DEFAULTS, "fallback: 'nothing loaded' (JobActivity's initial useState seed, and a missing/not-yet-loaded settings/scoreboardV4Weights doc, both call sb4Config(null)) resolves to full SB4_DEFAULTS — no crash, no partial/undefined cfg");
const loadedDoc = { strandedDays: 21, marginTarget: 18 };
const loadedCfg = sb4Config(loadedDoc);
assertEq(loadedCfg.strandedDays, 21, "fallback: 'loaded' (a real settings/scoreboardV4Weights doc, JobActivity's s.exists()===true branch) resolves to the STORED strandedDays (21), not the default (7)");
assertEq(loadedCfg.marginTarget, 18, "fallback: 'loaded' also carries through a second, independent field (marginTarget) in the same doc — not a strandedDays-only special case");

// Structural wiring pin (not behavioral — see the comment above): the raw
// source text, not a VM-evaluated value, so it directly catches a revert of
// the wiring itself, independent of whether qcStrandedItems/sb4Config still
// behave correctly in isolation.
assertTrue(src.includes("function buildJobActivity(job, cfg) {"), "wiring: buildJobActivity's signature carries a cfg param (source text) — reverting this would silently drop the argument even if the call site below still looked right");
assertTrue(src.includes("qcStrandedItems(job, cfg, Date.now());"), "wiring: buildJobActivity's qcStrandedItems call passes the threaded cfg, not a fresh sb4Config(null)");
assertTrue(!src.includes("qcStrandedItems(job, sb4Config(null), Date.now());"), "wiring: the OLD hardcoded call is gone — not just replaced-but-also-still-present somewhere else in the file");
const scoreboardV4WeightsSubscribers = (src.match(/onSnapshot\(doc\(db, "settings", "scoreboardV4Weights"\)/g) || []).length;
assertEq(scoreboardV4WeightsSubscribers, 2, "wiring: settings/scoreboardV4Weights now has TWO live subscribers in the source — ScoreboardV4's original admin-gated one, and JobActivity's new non-admin-gated one (Open Items must work for everyone)");

console.log("");
if (failures) {
  console.error(`${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("sb4-dryrun ok (Task 1R/2R/3R/5/5-fix1/6/6-fix1/7R/7R-fix1)");
process.exit(0);
