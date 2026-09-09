#!/usr/bin/env node
/* questions-room-dryrun.js — Task 1 harness for the Questions-by-Room pure
 * helpers (groupQuestionsByRoom / roomSuggestions). Extracts both function
 * declarations verbatim from src/App.js source and evals them in a vm sandbox
 * (same house pattern as scripts/sb4-dryrun.js) so the grouping/suggestion
 * logic under test is exactly what ships — no hand copy to drift.
 *
 * Proves:
 *   1. GROUPING — General (no room) first; remaining rooms A-Z case-insensitive;
 *      same room in different casing merges (first-seen casing kept); in-group
 *      order preserved; empty groups dropped.
 *   2. SUGGESTIONS — union of this phase+floor's punch rooms and every question
 *      room on the job, trimmed, de-duped case-insensitively, sorted A-Z;
 *      empty-safe on missing/legacy shapes.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// Extract a top-level `function NAME(...) { ... }` verbatim: find the marker,
// scan to the first `{` of the body, then brace-balance (skipping string /
// template contents so a brace inside a string can't fool it) to the matching
// close. Fails loudly if the function isn't there yet — that's the RED state.
function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extractFunction: "${marker}" not found in App.js`);
  let i = src.indexOf("{", start);
  if (i < 0) throw new Error(`extractFunction: no body open-brace for ${name}`);
  let depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; if (depth === 0) { i++; break; } continue; }
  }
  if (depth !== 0) throw new Error(`extractFunction: unbalanced braces for ${name}`);
  return src.slice(start, i);
}

const combined = [
  extractFunction("groupQuestionsByRoom"),
  extractFunction("roomSuggestions"),
  "({ groupQuestionsByRoom, roomSuggestions })",
].join("\n");
const sandbox = vm.createContext({});
const { groupQuestionsByRoom, roomSuggestions } = vm.runInContext(combined, sandbox, { filename: "questions-room-extract.vm.js" });

// Arrays returned by the extracted fns are born in the vm realm, so their
// prototype differs from the host's — assert.deepStrictEqual checks prototypes
// and would reject them even when contents match. Compare structurally via JSON.
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// ── 1. grouping ──────────────────────────────────────────────────────────
const A = { id: "a", question: "x", room: "Kitchen" };
const B = { id: "b", question: "y" };                  // no room -> General
const C = { id: "c", question: "z", room: "kitchen" }; // same room, diff casing
const D = { id: "d", question: "w", room: "Bath" };
const groups = groupQuestionsByRoom([A, B, C, D]);
assert.strictEqual(groups[0].room, "", "General group first");
assert.strictEqual(groups[0].label, "General", "General labelled");
assert.strictEqual(groups[0].questions.length, 1, "General holds the roomless B");
assert.strictEqual(groups[1].label, "Bath", "Bath before Kitchen (A-Z)");
assert.strictEqual(groups[2].label, "Kitchen", "Kitchen keeps first-seen casing");
assert.strictEqual(groups[2].questions.length, 2, "Kitchen merges A+C case-insensitively");
assert.strictEqual(groups[2].questions[0].id, "a", "in-group order preserved (a before c)");
// empty groups dropped: all-roomless input yields only General
assert.strictEqual(groupQuestionsByRoom([B]).length, 1, "no empty room groups");
// whitespace-only room counts as General
assert.strictEqual(groupQuestionsByRoom([{ id: "e", room: "   " }])[0].room, "", "blank room -> General");
// non-array safe
eq(groupQuestionsByRoom(null), [], "null-safe");

// ── 2. suggestions ─────────────────────────────────────────────────────────
const job = {
  roughPunch: { main: { rooms: [{ name: "Kitchen" }, { name: "Pantry" }] } },
  roughQuestions: { main: [{ id: "q", room: "Mudroom" }], upper: [], basement: [] },
  finishQuestions: { main: [{ id: "q2", room: "kitchen" }] }, // dup of punch Kitchen, diff case
};
eq(roomSuggestions(job, "rough", "main"), ["Kitchen", "Mudroom", "Pantry"], "union punch+question rooms, sorted A-Z, deduped case-insensitively");
eq(roomSuggestions({}, "rough", "main"), [], "empty job -> []");
eq(roomSuggestions(null, "rough", "main"), [], "null job -> []");
// finish phase reads finishPunch; legacy bare-array floor yields no punch rooms but no throw
eq(roomSuggestions({ finishQuestions: { main: [{ id: "z", room: "Loft" }] } }, "finish", "main"), ["Loft"], "finish phase + missing punch is safe");

console.log("questions-room ok");
