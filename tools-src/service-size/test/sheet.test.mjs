// Run: npm test   (plain Node, no test framework)
// The printable sheets (v501): what the customer copy says, what the office rows carry, and which numbers are still estimates.
import assert from "node:assert/strict";
import { defaultState, analyze, normalizeState } from "../src/calc.js";
import { applyProfile } from "../src/profile.js";
import { sheetData, estimates, sourceOf, contributors, gauge } from "../src/sheet.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };

const appl = (loads) => ({ v: 1, source: "appliance-loads", at: "2026-10-02T10:00:00Z", label: "#1438 Miller Residence",
  job: { no: "1438", name: "Miller Residence", address: "1732 East Elk Ridge Lane" }, house: { sqft: 17000, sac: 0, laundry: 0 }, hvac: null, service: null, sizeFor: null, loads });
const L = (name, volts, amps, o = {}) => ({ name, kind: "", qty: 1, volts, amps, va: volts && amps ? volts * amps : null, status: "yes", confidence: "ok", ...o });

test("customer copy: plain drivers, allowances, up to five changes, no VA or code ids in the driver lines", () => {
  const s = applyProfile(defaultState(1), appl([L("Kitchen · Range", 240, 42.5), L("Laundry · Dryer", 240, 24, { qty: 2 }), L("Garage · EV charger", 240, 48), L("Basement · Sauna", 240, 40), L("Studio · Kiln", 240, 40)]));
  const a = analyze(s);
  const d = sheetData(s, a);
  assert.equal(d.rec, String(a.rec));
  assert.ok(d.drivers.some((x) => /range/i.test(x)) && d.drivers.some((x) => /2 electric dryers/.test(x)) && d.drivers.some((x) => /EV charger/.test(x)) && d.drivers.some((x) => /Sauna/.test(x)) && d.drivers.some((x) => /Kiln/.test(x)), d.drivers.join(" | "));
  assert.ok(d.drivers.every((x) => !/\bVA\b|220\.82|\bev2?\b/.test(x)), "customer lines carry no VA figures or item ids");
  assert.ok(d.allowances.length > 0, "tier-1 maybes show as allowances when sized for maybes");
  assert.ok(d.changes.length <= 5 && d.changes.every((c) => /\d+ A$|600\+ A$/.test(c.to)));
  assert.equal(s.address, "1732 East Elk Ridge Lane");
  assert.ok(d.plainWhy.includes("40%"));
});

test("confirmed-only sizing lists no allowances", () => {
  const s = { ...defaultState(1), sizeFor: "base" };
  const d = sheetData(s, analyze(s));
  assert.deepEqual(d.allowances, []);
  assert.equal(d.sizedFor, "base");
});

test("estimates: typical values, specs to confirm and extras with no VA are named; real nameplates are not", () => {
  const s = applyProfile(defaultState(1), appl([
    L("Kitchen · Range", 240, 42.5),
    L("Garage · EV charger", null, null),
    L("Kitchen · Dishwasher", 120, 15),
    L("Pantry · Dishwasher (2nd)", 120, 15, { confidence: "unconfirmed" }),
    L("Studio · Kiln", null, null),
    L("Patio · Hot tub", 240, 40, { confidence: "unconfirmed" }),
  ]));
  const e = estimates(s);
  const why = Object.fromEntries(e.map((x) => [x.name, x.why]));
  assert.equal(why["EV charger, 48 A"], "typical value");
  assert.equal(why["Second dishwasher"], "spec to confirm");
  assert.equal(why["Hot tub"], "spec to confirm");
  assert.equal(why["Studio · Kiln"], "needs VA");
  assert.ok(!("range" in why) && !e.some((x) => /Range/i.test(x.name)), "the range has a real nameplate");
  const d = sheetData(s, analyze(s));
  assert.equal(d.estimates.length, e.length);
});

test("office rows carry a source for every counted item", () => {
  const s = applyProfile(defaultState(1), appl([L("Kitchen · Range", 240, 42.5), L("Studio · Kiln", 240, 40)]));
  const d = sheetData(s, analyze(s));
  assert.ok(d.rows.length > 0);
  for (const r of d.rows) assert.ok(r.source && typeof r.va === "number" && ["yes", "maybe"].includes(r.status), JSON.stringify(r));
  const kiln = d.rows.find((r) => r.name === "Studio · Kiln"); assert.equal(kiln.source, "loads · nameplate");
  const ev = d.rows.find((r) => r.name === "EV charger, 48 A"); assert.equal(ev.source, "typed", "a tier default that no fill touched is 'typed'");
  assert.equal(sourceOf({ fromPlans: true }, null), "plans");
});

test("normalizeState keeps address; an old record without one gets an empty string", () => {
  assert.equal(normalizeState({}).address, "");
  assert.equal(normalizeState({ address: "1 Elm" }).address, "1 Elm");
});

test("contributors: items are listed one by one (never also as 'other'), sorted, top 8 + the rest; gauge marks the chosen size", () => {
  const s = applyProfile(defaultState(1), appl([L("Kitchen · Range", 240, 42.5), L("Garage · EV charger", 240, 48), L("Basement · Sauna", 240, 40), L("Studio · Kiln", 240, 40)]));
  const a = analyze(s);
  const c = contributors(s, a);
  assert.ok(c.top.length <= 8 && c.top.length > 0);
  for (let i = 1; i < c.top.length; i++) assert.ok(c.top[i - 1].va >= c.top[i].va, "sorted by VA");
  assert.ok(!c.top.some((x) => /other appliances/i.test(x.label)), "no 'other appliances' lump");
  const labels = [...c.top, ...Array(0)].map((x) => x.label).join(" | ");
  assert.ok(/Lighting & receptacles/.test(labels) && /tons/.test(labels), labels);
  const sumItems = c.top.reduce((n, x) => n + x.va, 0) + c.restVA;
  assert.equal(sumItems, c.total);
  assert.ok(Math.abs(c.total - (a.basis.B + a.basis.hvac)) <= 1, `contributors ${c.total} should equal B + hvac ${a.basis.B + a.basis.hvac}`);
  const g = gauge(a);
  assert.ok(g.ticks.some((t) => t.sel && t.x === a.rec));
  assert.ok(g.ml >= g.bl);
  const d = sheetData(s, a);
  assert.equal(d.contrib.total, c.total); assert.ok(d.gauge && d.gauge.ticks.length);
});

console.log(`\n${n} tests passed`);
