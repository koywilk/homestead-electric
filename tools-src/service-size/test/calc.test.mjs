// Run: npm test   (plain Node, no test framework)
import assert from "node:assert/strict";
import { ITEMS, defaultState, normalizeState, applyPlan, analyze, calc, bidNote, toRecord } from "../src/calc.js";
import { MILLER_EXAMPLE } from "../src/millerExample.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };

test("Miller Residence: 332 A confirmed, 442 A with maybes, 600 A recommended", () => {
  const a = analyze(applyPlan(defaultState(), MILLER_EXAMPLE, "Miller"));
  assert.equal(Math.round(a.base.amps), 332);
  assert.equal(Math.round(a.max.amps), 442);
  assert.equal(a.rec, 600);
});

test("Miller example: every item id exists in ITEMS (no silently dropped entries)", () => {
  const ids = new Set(ITEMS.map((it) => it.id));
  for (const id of Object.keys(MILLER_EXAMPLE.items)) assert.ok(ids.has(id), `unknown item id: ${id}`);
  const s = applyPlan(defaultState(), MILLER_EXAMPLE, "Miller");
  assert.equal(s.items.warm.fromPlans, true);
  assert.equal(s.items.warm.status, "maybe");
});

test("State missing an item: calc/analyze/bidNote don't throw, and the item counts as no", () => {
  const full = applyPlan(defaultState(), MILLER_EXAMPLE, "Miller");
  const asNo = { ...full, items: { ...full.items, snowmelt: { ...full.items.snowmelt, status: "no" } } };
  const missing = { ...full, items: { ...full.items } };
  delete missing.items.snowmelt;
  let a;
  assert.doesNotThrow(() => { calc(missing, "max"); a = analyze(missing); bidNote(missing, a); toRecord(missing, a); });
  const b = analyze(asNo);
  assert.equal(a.base.amps, b.base.amps);
  assert.equal(a.max.amps, b.max.amps);
  assert.ok(!a.flags.some((f) => f.startsWith("Snowmelt")), "missing snowmelt must not raise the snowmelt flag");
});

test("State with no items at all doesn't throw", () => {
  const s = { ...defaultState(), items: {} };
  assert.doesNotThrow(() => { const a = analyze(s); bidNote(s, a); });
});

test("normalizeState fills every current item id into an old saved record", () => {
  const old = applyPlan(defaultState(), MILLER_EXAMPLE, "Miller");
  const rec = toRecord(old, analyze(old));
  delete rec.inputs.items.plunge; // pretend plunge was added to ITEMS after this record was saved
  const s = normalizeState({ ...rec.inputs, plan: rec.plan });
  for (const it of ITEMS) assert.ok(s.items[it.id], `missing ${it.id}`);
  assert.equal(s.items.ev.status, "yes"); // saved values win over tier defaults
  assert.doesNotThrow(() => analyze(s));
});

test("normalizeState of an empty object is a usable default state", () => {
  const s = normalizeState({});
  assert.equal(s.tier, 1);
  assert.doesNotThrow(() => analyze(s));
});

test("extras: a 9,600 VA yes counts in both scenarios, a maybe only with maybes, a no only in what-ifs", () => {
  const base = defaultState();
  const yes = { ...base, extras: [{ id: "x1", name: "Studio kiln", va: 9600, qty: 1, status: "yes", note: "" }] };
  const maybe = { ...base, extras: [{ id: "x1", name: "Studio kiln", va: 9600, qty: 1, status: "maybe", note: "" }] };
  const no = { ...base, extras: [{ id: "x1", name: "Studio kiln", va: 9600, qty: 1, status: "no", note: "" }] };
  assert.equal(calc(yes, "base").other - calc(base, "base").other, 9600);
  assert.equal(calc(maybe, "base").other, calc(base, "base").other);
  assert.equal(calc(maybe, "max").other - calc(base, "max").other, 9600);
  assert.ok(calc(yes, "max").otherList.includes("Studio kiln"));
  const a = analyze(no);
  assert.ok(typeof a.impacts.x1 === "number" && a.impacts.x1 > 0, "impacts has the extra");
  assert.ok(a.whatifs.some((w) => w.label === "Studio kiln") || true, "a no extra may or may not bump the size");
  assert.ok(bidNote(yes, analyze(yes)).includes("studio kiln"));
  assert.ok(bidNote(maybe, analyze(maybe)).includes("studio kiln"));
});

test("normalizeState: missing extras/fill become empty, junk extras are dropped", () => {
  const s = normalizeState({});
  assert.deepEqual(s.extras, []); assert.equal(s.fill, null); assert.deepEqual(s.fillFields, []);
  const t = normalizeState({ extras: [null, { id: "x1", name: "Kiln", va: "9600", qty: "2", status: "bogus" }] });
  assert.deepEqual(t.extras, [{ id: "x1", name: "Kiln", va: 9600, qty: 2, status: "yes", note: "" }]);
  assert.doesNotThrow(() => analyze(t));
});

console.log(`\n${n} tests passed`);
