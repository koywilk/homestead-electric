#!/usr/bin/env node
/* scramble-cal-sync.js — keeps functions/scrambleCal.js byte-identical to src/scrambleCal.js (v668, 2026-11-20).
 *
 * Why two copies: the app bundle can only import from src/, and `firebase deploy` ships only the functions/ folder.
 * The calendar read for Duet (functions/scrambleRead.js) has to lay the calendar out with the SAME rules the screen
 * uses, so it is the same file in two places. Default mode CHECKS and fails the build when they differ (a silent copy
 * at build time would hide drift: deploys ship the working tree). `--write` copies src → functions.
 * Same pattern as scripts/punch-ticks-sync.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "scrambleCal.js");
const DST = path.join(root, "functions", "scrambleCal.js");
const src = fs.readFileSync(SRC);
if (process.argv.includes("--write")) { fs.writeFileSync(DST, src); console.log("scramble-cal-sync: wrote functions/scrambleCal.js from src/scrambleCal.js"); process.exit(0); }
let same = false;
try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
if (!same) { console.error('scramble-cal-sync: functions/scrambleCal.js differs from src/scrambleCal.js — run "node scripts/scramble-cal-sync.js --write" and commit it'); process.exit(1); }
console.log("scramble-cal-sync: functions/scrambleCal.js matches src/scrambleCal.js");
