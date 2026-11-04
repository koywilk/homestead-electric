#!/usr/bin/env node
/* job-shape-sync.js — keeps functions/jobShape.js byte-identical to
 * src/jobShape.js (v608, 2026-11-03, Duet write access D9 ship 9).
 *
 * Same reason as punch-ticks-sync.js: the CRA bundle can only import from
 * src/, and `firebase deploy` ships only functions/ — so the job defaults the
 * phones write and the ones duetApi writes must be the SAME code in two
 * places. Default mode CHECKS and fails the build when they differ; `--write`
 * copies src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "jobShape.js");
const DST = path.join(root, "functions", "jobShape.js");

const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) {
  fs.writeFileSync(DST, src);
  console.log("job-shape-sync: wrote functions/jobShape.js from src/jobShape.js");
  process.exit(0);
}
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) {
  console.error('job-shape-sync: functions/jobShape.js differs from src/jobShape.js — run "node scripts/job-shape-sync.js --write" and commit it');
  process.exit(1);
}
console.log("job-shape-sync: functions/jobShape.js matches src/jobShape.js");
