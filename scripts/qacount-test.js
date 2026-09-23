#!/usr/bin/env node
"use strict";
// v432 — functions/qaCount.js: onQuestionAnswered's answer counter.
const assert = require("assert");
const { countAnswers } = require("../functions/qaCount.js");
const real = {
  rough: { upper: [{ id: "a", answer: "Yes" }, { id: "b", answer: "" }], main: [{ id: "c", answer: "Cans at 36\"" }], basement: [] },
  finish: { main: [{ id: "d", answer: "  " }, { id: "e", answer: "Brushed nickel" }], extra_1: [{ id: "f", answer: "ok" }] },
  answeredBy: "Koy Wilkinson",                 // the string that used to crash it
  answeredAt: "2026-09-23T18:51:00.000Z",
};
assert.strictEqual(countAnswers(real), 4, "counts non-blank answers across phases/floors incl. extras; ignores answeredBy/answeredAt");
assert.strictEqual(countAnswers({ answeredBy: "Koy", answeredAt: null }), 0, "metadata only → 0, no throw");
assert.strictEqual(countAnswers({ rough: { main: "oops" }, finish: null }), 0, "junk floor / null phase skipped");
assert.strictEqual(countAnswers({ rough: { main: [null, { answer: 5 }, { answer: "x" }] } }), 1, "null items + non-string answers skipped");
assert.strictEqual(countAnswers(null), 0, "null → 0");
assert.strictEqual(countAnswers(undefined), 0, "undefined → 0");
const before = { ...real, finish: { main: [] } };
assert.ok(countAnswers(real) > countAnswers(before), "a new answer increases the count (the trigger's gate)");
console.log("qacount-test ok");
