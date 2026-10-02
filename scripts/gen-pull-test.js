// Generator-selection pull (v498): the pure mapping from a job's selected
// generator loads to the handoff profile's loads, checked against a copy of
// Miller #1438 (fixtures/gen-pull-miller.json). Run: node scripts/gen-pull-test.js
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
// Helpers are extracted LIVE from src/App.js (same balanced-slice approach as
// scripts/gen-selection-test.js), so the test cannot drift from the app.
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`could not find ${name} in src/App.js`);
  let depth = 0, inStr = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const code = ["WIRE_BREAKER", "canBe240", "effectivePoles", "flattenHomeRuns", "applNum", "applRowKey", "genSelectionLoads"].map(extract).join("\n");
const fns = new Function(code + "\nreturn { genSelectionLoads, flattenHomeRuns };")();
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gen-pull-miller.json"), "utf8"));

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };
const loads = fns.genSelectionLoads(fx.included, fx.job, fx.sheetRows);
const by = (re) => loads.filter((l) => re.test(l.name));

test("every included load comes through once; a sheet-described Home Run comes through as its sheet rows", () => {
  assert.equal(fx.included.length, 54);
  assert.ok(loads.length >= 54, `expected at least 54 loads, got ${loads.length}`);
  assert.equal(by(/^Kitchen range$/).length, 0, "the Home Run name is replaced by the sheet row");
  assert.equal(by(/Main kitchen · Range/).length, 1);
  assert.equal(by(/Hood/).length, 2, "the hood Home Run stands for two sheet rows (liner + blower)");
});

test("homeowner priority order, office-added loads after", () => {
  assert.ok(/Range/.test(loads[0].name), `first should be the range (p1), got ${loads[0].name}`);
  assert.ok(/Electric dryer/.test(loads[1].name), `second should be the dryer (p2), got ${loads[1].name}`);
  const lastRanked = loads.findIndex((l) => /\(p29\)/.test(l.note));
  const firstOffice = loads.findIndex((l) => !/\(p\d+\)/.test(l.note));
  assert.ok(lastRanked >= 0 && firstOffice > lastRanked, "office-added (priority 0) loads come after the homeowner's ranked ones");
});

test("real nameplates where the sheet has them, with volts from the Home Run wire when the sheet is blank", () => {
  const range = by(/Main kitchen · Range/)[0];
  assert.equal(range.volts, 240); assert.equal(range.amps, 42.5); assert.equal(range.va, 10200); assert.equal(range.confidence, "ok");
  const dryer = by(/Electric dryer/)[0];
  assert.equal(dryer.volts, 240); assert.equal(dryer.va, 6000);
  const dw = by(/Main kitchen · Dishwasher/)[0];
  assert.equal(dw.va, 1800); assert.equal(dw.confidence, "unconfirmed", "breaker-only amps are flagged");
});

test("Home Runs with no sheet row carry their wire's volts and no amps (never breaker × volts)", () => {
  const ac = by(/^AC 1/)[0];
  assert.equal(ac.volts, 240); assert.equal(ac.amps, null); assert.equal(ac.va, null); assert.equal(ac.confidence, "none");
  const wh = by(/^Water heater 1$/)[0];
  assert.equal(wh.volts, 120, "a 12/2 run is 120 V, so the classifier will treat it as a gas unit's accessory");
  const lights = by(/Great room \+ sitting/)[0];
  assert.ok(lights && lights.va === null, "lighting circuits come through for the classifier to count, never sized here");
  assert.equal(by(/Garage door 1 \+ 2/)[0].qty, 2);
});

test("a job with no Home Runs or sheet rows still maps every selected load by name", () => {
  const out = fns.genSelectionLoads([{ name: "Sauna", wire: "6/3", priority: 1, included: true }], { simproNo: "9", homeRuns: null }, []);
  assert.equal(out.length, 1); assert.equal(out[0].volts, 240); assert.equal(out[0].va, null);
});

console.log(`\n${n} tests passed`);
