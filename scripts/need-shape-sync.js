#!/usr/bin/env node
/* need-shape-sync.js — keeps functions/needShape.js byte-identical to
 * src/needShape.js (v600, 2026-11-03, Duet write access D9).
 *
 * Same reason as punch-ticks-sync.js: the CRA bundle can only import from
 * src/, and `firebase deploy` ships only functions/ — so the task shape the
 * phones write and the one duetApi writes must be the SAME code in two
 * places. Default mode CHECKS and fails the build when they differ; `--write`
 * copies src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "needShape.js");
const DST = path.join(root, "functions", "needShape.js");

const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) {
  fs.writeFileSync(DST, src);
  console.log("need-shape-sync: wrote functions/needShape.js from src/needShape.js");
  process.exit(0);
}
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) {
  console.error('need-shape-sync: functions/needShape.js differs from src/needShape.js — run "node scripts/need-shape-sync.js --write" and commit it');
  process.exit(1);
}
console.log("need-shape-sync: functions/needShape.js matches src/needShape.js");
