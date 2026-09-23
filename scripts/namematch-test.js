#!/usr/bin/env node
"use strict";
// v432 — functions/nameMatch.js: server name → user lookup for pushes.
const assert = require("assert");
const { matchUserByName, findUserByName } = require("../functions/nameMatch.js");
const users = [
  { name: "Koy Wilkinson" }, { name: "Keegan Wilkinson" },
  { name: "Josh" }, { name: "Josh Anderson" },
  { name: "Gage Lund" }, { name: "Old Hand", active: false }, { name: "Jo Smith" },
  { name: "Brady Nelson" },
];
const m = (n) => matchUserByName(users, n);
assert.strictEqual(m("Koy Wilkinson").user.name, "Koy Wilkinson", "exact full name");
assert.strictEqual(m("  koy   wilkinson ").user.name, "Koy Wilkinson", "case + spacing tolerant");
assert.strictEqual(m("Josh").user.name, "Josh", "exact beats the longer 'Josh Anderson'");
assert.strictEqual(m("Josh").ambiguous, false, "exact match is not ambiguous");
assert.strictEqual(m("Josh Anderson").user.name, "Josh Anderson", "exact full name wins over single-name 'Josh'");
assert.strictEqual(m("Gage").user.name, "Gage Lund", "first name expands to the one full record");
assert.strictEqual(m("Brady").user.name, "Brady Nelson", "first name expands");
assert.strictEqual(m("Wilkinson").user, null, "a last name alone never matches");
assert.strictEqual(m("Koy").user.name, "Koy Wilkinson", "unique first name");
assert.strictEqual(m("Old Hand").user, null, "deactivated users never match");
assert.strictEqual(m("Old").user, null, "…not even by first name");
assert.strictEqual(m("Josh Smith").user.name, "Josh", "legacy single-name record matches a longer stored name");
assert.strictEqual(m("Jo").user.name, "Jo Smith", "word boundary: 'Jo' → Jo Smith, never Josh");
assert.strictEqual(m("Jos").user, null, "no partial-word matches");
assert.strictEqual(m("").user, null, "empty → null");
const dup = [{ name: "Chris Allen" }, { name: "Chris Baker" }];
const d = matchUserByName(dup, "Chris");
assert.ok(d.user && d.ambiguous, "shared first name → first candidate, flagged ambiguous");
let logged = null;
findUserByName(dup, "Chris", (asked, picked) => { logged = [asked, picked]; });
assert.deepStrictEqual(logged, ["Chris", "Chris Allen"], "ambiguity is logged");
console.log("namematch-test ok");
