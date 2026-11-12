#!/usr/bin/env node
/* punch-list-stage-sync.js — keeps functions/punchListStage.js byte-identical to
 * src/punchListStage.js (2026-11-11, Simpro stage sync).
 *
 * Same reason as punch-ticks-sync.js: the CRA bundle can only import from
 * src/, and `firebase deploy` ships only functions/ — so the Punch List rule the
 * phones run and the one the Simpro stage sync runs must be the SAME code in two
 * places. Default mode CHECKS and fails the build when they differ; `--write`
 * copies src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "punchListStage.js");
const DST = path.join(root, "functions", "punchListStage.js");

const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) {
  fs.writeFileSync(DST, src);
  console.log("punch-list-stage-sync: wrote functions/punchListStage.js from src/punchListStage.js");
  process.exit(0);
}
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) {
  console.error('punch-list-stage-sync: functions/punchListStage.js differs from src/punchListStage.js — run "node scripts/punch-list-stage-sync.js --write" and commit it');
  process.exit(1);
}
console.log("punch-list-stage-sync: functions/punchListStage.js matches src/punchListStage.js");
