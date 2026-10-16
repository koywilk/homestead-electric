#!/usr/bin/env node
// timeoff-decision-test (v549, UX batch 2): onTimeOffDecision diffs the
// settings/timeOffRequests list and pushes the requester. Checks the pure diff
// in functions/timeOffDecision.js on James Livingston's real request
// (2026-10-14 → approved by Koy 2026-10-15) and the other transitions.
// Exit 1 on failure. Prebuild.
"use strict";
const assert = require("assert");
const path = require("path");
const { timeOffDecisionPushes: diff, fmtRange } = require(path.join(__dirname, "..", "functions", "timeOffDecision.js"));
const now = new Date(2026, 9, 16);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const james = { id: "to_v1hbh12mv8wn2u6", name: "James Livingston", start: "11/20/2026", end: "11/27/2026", note: "Family vacation", usePaid: false, status: "pending", requestedAt: "2026-10-15T02:13:36.414Z" };
const other = { id: "to_x", name: "Colby Fogh", start: "10/19/2026", end: "10/19/2026", status: "pending" };
const approved = { ...james, status: "approved", decidedBy: "Koy Wilkinson", decidedAt: "2026-10-15T16:22:19.449Z" };

let p = diff([james, other], [approved, other], now);
ok(p.length === 1 && p[0].requesterName === "James Livingston", "only the decided request pushes");
ok(p[0].title === "Time off approved", "approved title");
ok(p[0].body === "Fri, Nov 20 – Fri, Nov 27 (unpaid) · approved by Koy. It's on the crew schedule.", "approved body: weekday range, unpaid tag, first name");

p = diff([james], [{ ...james, status: "denied", decidedBy: "Josh Cloward" }], now);
ok(p.length === 1 && p[0].title === "Time off not approved" && /not approved by Josh\. Talk to Josh/.test(p[0].body), "denied push names who to talk to");

p = diff([approved], [{ ...james, status: "pending", decidedBy: "", decidedAt: "" }], now);
ok(p.length === 1 && p[0].title === "Time off back to pending", "Undo back to pending tells them");
ok(diff([james], [james], now).length === 0, "no change, no push");
ok(diff([], [james], now).length === 0, "a brand-new request is not a decision");
ok(diff([james], [], now).length === 0, "a removed request is not a decision");
ok(diff([james], [{ ...james, status: "approved", decidedBy: "James Livingston" }], now).length === 0, "deciding your own request sends you nothing");
ok(diff([approved], [{ ...approved, status: "denied", decidedBy: "Koy Wilkinson" }], now)[0].title === "Time off not approved", "a changed decision pushes the new answer");
ok(fmtRange({ start: "10/19/2026", end: "10/19/2026" }, now) === "Mon, Oct 19", "one-day range");
ok(fmtRange({ start: "12/28/2026", end: "1/2/2027" }, now) === "Mon, Dec 28 – Sat, Jan 2, 2027", "next-year end gets the year");
ok(diff(null, undefined, now).length === 0, "missing lists are safe");
console.log(`  ok  timeoff-decision-test: ${n} checks`);
