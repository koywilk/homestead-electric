#!/usr/bin/env node
/* punch-ticks-sync.js — keeps functions/punchTicks.js byte-identical to
 * src/punchTicks.js (v559, 2026-10-22).
 *
 * Why two copies: the CRA bundle can only import from src/, and `firebase
 * deploy` ships only the functions/ folder — so the punch-slot overlay that
 * the phones apply and the one the Cloud Functions readers apply must be the
 * SAME code in two places. Default mode CHECKS and fails the build when they
 * differ (a silent copy at build time would hide drift: deploys ship the
 * working tree, not the build). `--write` copies src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "punchTicks.js");
const DST = path.join(root, "functions", "punchTicks.js");

const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) {
  fs.writeFileSync(DST, src);
  console.log("punch-ticks-sync: wrote functions/punchTicks.js from src/punchTicks.js");
  process.exit(0);
}
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) {
  console.error('punch-ticks-sync: functions/punchTicks.js differs from src/punchTicks.js — run "node scripts/punch-ticks-sync.js --write" and commit it');
  process.exit(1);
}
console.log("punch-ticks-sync: functions/punchTicks.js matches src/punchTicks.js");
