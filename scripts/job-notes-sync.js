#!/usr/bin/env node
/* job-notes-sync.js — keeps functions/jobNotesShape.js byte-identical to
 * src/jobNotesShape.js, and functions/escapeHtml.js to src/escapeHtml.js
 * (v603, 2026-11-03, Duet write access D9 ship 4).
 *
 * Same reason as need-shape-sync.js: the CRA bundle can only import from
 * src/, and `firebase deploy` ships only functions/ — so the job-notes
 * migration the phones run and the one duetApi runs (and the escapeHtml a
 * question's answer goes through) must be the SAME code in two places.
 * Default mode CHECKS and fails the build when they differ; `--write` copies
 * src → functions.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const PAIRS = [
  ["src/jobNotesShape.js", "functions/jobNotesShape.js"],
  ["src/escapeHtml.js", "functions/escapeHtml.js"],
];

let bad = 0;
for (const [from, to] of PAIRS) {
  const SRC = path.join(root, from), DST = path.join(root, to);
  const src = fs.readFileSync(SRC);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(DST, src);
    console.log(`job-notes-sync: wrote ${to} from ${from}`);
    continue;
  }
  let same = false;
  try { same = fs.existsSync(DST) && fs.readFileSync(DST).equals(src); } catch (e) { same = false; }
  if (!same) { bad++; console.error(`job-notes-sync: ${to} differs from ${from} — run "node scripts/job-notes-sync.js --write" and commit it`); }
  else console.log(`job-notes-sync: ${to} matches ${from}`);
}
process.exit(bad ? 1 : 0);
