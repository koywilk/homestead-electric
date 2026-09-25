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
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// One-line arrow consts: take the whole source line.
const extractLine = (name) => { const i = src.indexOf(`const ${name} = `); if (i < 0) throw new Error(`extract: const ${name} not found`); return src.slice(i, src.indexOf("\n", i)); };

const combined = [
  extractLine("jobDivision"),
  extractLine("isCommercial"),
  `({ jobDivision, isCommercial })`,
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

console.log(`commercial-dryrun ok (${n} checks)`);
