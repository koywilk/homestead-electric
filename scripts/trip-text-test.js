#!/usr/bin/env node
// trip-text-test (v549, UX batch 2): Text / Email / Chat Trip used to print
// "Scheduled: not yet set" on every trip because it read t.date, a field the
// trip card never writes. Checks tripScheduleLine() (pulled verbatim from
// src/App.js) on the real Wade Residence Return Trip #3 (2026-10-16) and the
// other date shapes in the data. Exit 1 on failure. Prebuild.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const start = src.indexOf("function tripScheduleLine(");
if (start < 0) throw new Error("tripScheduleLine not found in App.js");
const end = src.indexOf("\n}\n", start) + 3;
const box = {};
vm.runInNewContext(src.slice(start, end) + "\nthis.f = tripScheduleLine;", box);
const f = box.f, now = new Date(2026, 9, 16);
let n = 0; const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// Wade Residence #694, Return Trip #3 as it was on 2026-10-16: date "", rtStatusDate set by the card.
eq(f({ date: "", rtStatus: "scheduled", rtStatusDate: "10/27/2026", assignedTo: "Colby Fogh" }, now), "Scheduled for Tue, Oct 27", "Wade RT #3 carries the card's date");
eq(f({ rtStatus: "needs", rtStatusDate: "10/12/2026" }, now), "Schedule by Mon, Oct 12", "a trip that still needs scheduling says Schedule by");
eq(f({ rtStatus: "scheduled", rtStatusDate: "", scheduledDate: "2026-11-03" }, now), "Scheduled for Tue, Nov 3", "falls back to the Crew Planner's scheduledDate");
eq(f({ rtStatus: "", date: "2026-11-04" }, now), "Scheduled for Wed, Nov 4", "falls back to the legacy date (Job Note → RT)");
eq(f({ rtStatus: "scheduled", rtStatusDate: "1/5/2027" }, now), "Scheduled for Tue, Jan 5, 2027", "adds the year when it isn't this year");
eq(f({ rtStatus: "needs", rtStatusDate: "", date: "" }, now), "Scheduled: not yet set", "no date at all still says not yet set");
eq(f({ rtStatusDate: "next week" }, now), "Scheduled for next week", "an unparseable date is printed as typed");
eq(f(null, now), "Scheduled: not yet set", "missing trip is safe");
console.log(`  ok  trip-text-test: ${n} checks`);
