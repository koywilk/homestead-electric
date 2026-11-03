#!/usr/bin/env node
/* stage-change-sync.js — keeps functions/stageChange.js byte-identical to
 * src/stageChange.js (v606, 2026-11-03, Duet write access D9 ship 7).
 *
 * Same reason as punch-ticks-sync.js: the CRA bundle can only import from
 * src/, and `firebase deploy` ships only functions/ — so the stage plan the
 * phones run and the one duetApi runs must be the SAME code in two
 * places. Default mode CHECKS and fails the build when they differ; `--write`
 * copies src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "stageChange.js");
const DST = path.join(root, "functions", "stageChange.js");

const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) {
  fs.writeFileSync(DST, src);
  console.log("stage-change-sync: wrote functions/stageChange.js from src/stageChange.js");
  process.exit(0);
}
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) {
  console.error('stage-change-sync: functions/stageChange.js differs from src/stageChange.js — run "node scripts/stage-change-sync.js --write" and commit it');
  process.exit(1);
}
console.log("stage-change-sync: functions/stageChange.js matches src/stageChange.js");
