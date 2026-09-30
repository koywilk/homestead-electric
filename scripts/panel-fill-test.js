#!/usr/bin/env node
/* panel-fill-test.js — placeBreakers (the panel-schedule FILL) must place every
 * breaker exactly once. Extracts the shipped code verbatim from src/App.js
 * (house pattern: scripts/commercial-dryrun.js). Regression for v468: a 30-slot
 * fill of Miller's 54 Dedicated Loads breakers produced 59 entries with
 * "Water heater 1" twice and one circuit unplaced. */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extractFrom(marker) {
  const start = src.indexOf(marker); if (start < 0) throw new Error(`extract: "${marker}" not found`);
  let i = src.indexOf("{", start), depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i) + ";";
}
const H = vm.runInContext([extractFrom("const WIRE_BREAKER = "), extractFrom("const effectivePoles = "), extractFrom("const placeBreakers = "), "({ placeBreakers, WIRE_BREAKER })"].join("\n"), vm.createContext({}));
let n = 0;
const base = (name) => String(name || "").replace(/\s*\(240V cont\.\)\s*$/i, "").trim();
// Invariant: every breaker lands exactly once (a 2-pole = its two rows), nothing twice, nothing lost.
const checkOnce = (breakers, slotCount, label) => {
  const out = H.placeBreakers(breakers, slotCount);
  const placed = {};
  Object.values(out.circuits).forEach(c => { const k = base(c.name); placed[k] = (placed[k] || 0) + 1; });
  const unplaced = {}; out.unplaced.forEach(b => { unplaced[b.name] = (unplaced[b.name] || 0) + 1; });
  breakers.forEach(b => {
    const want = b.poles === 2 ? 2 : 1;
    const got = (placed[b.name] || 0) + (unplaced[b.name] || 0) * want;
    assert.strictEqual(got, want, `${label} @${slotCount}: "${b.name}" appears ${got} time(s), expected ${want}`);
  });
  const rows = Object.keys(out.circuits).length;
  assert.ok(rows <= slotCount * 2, `${label} @${slotCount}: ${rows} rows exceed ${slotCount} slots x2`);
  n++;
  return out;
};
const mk = (name, wire, v240) => ({ name, amps: H.WIRE_BREAKER[wire].amps, poles: (wire.endsWith("/3") || ["8/2","6/2"].includes(wire) || v240) ? 2 : 1, wire });
// Miller-shaped set: 4 two-pole + 50 one-pole across 20A / 15A.
const miller = [mk("Kitchen range", "6/3"), mk("Main level dryer", "10/3"), mk("AC 1", "8/2"), mk("AC 3", "8/2"),
  ...Array.from({ length: 28 }, (_, i) => mk(`Load20 ${i + 1}`, "12/2")), ...Array.from({ length: 22 }, (_, i) => mk(`Load15 ${i + 1}`, "14/2")), mk("Water heater 1", "12/2")];
const out30 = checkOnce(miller, 30, "miller");
assert.strictEqual(Object.values(out30.circuits).filter(c => base(c.name) === "Water heater 1").length, 1, "v468: Water heater 1 placed once at 30 slots");
checkOnce(miller, 40, "miller"); checkOnce(miller, 20, "miller"); checkOnce(miller, 60, "miller");
// Odd-count leftovers with mixed amps force the split-tandem path.
const mixed = [mk("A", "12/2"), mk("B", "12/2"), mk("C", "14/2"), mk("D", "10/2"), mk("E", "10/2"), mk("F", "14/2"), mk("G", "12/2")];
checkOnce(mixed, 4, "mixed"); checkOnce(mixed, 3, "mixed"); checkOnce(mixed, 2, "mixed");
// Random sets: the invariant must hold for any mix and any size.
let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const wires = ["14/2", "12/2", "10/2", "8/2", "6/3", "10/3", "12/3"];
for (let t = 0; t < 200; t++) {
  const cnt = 1 + Math.floor(rnd() * 70);
  const set = Array.from({ length: cnt }, (_, i) => mk(`R${t}-${i}`, wires[Math.floor(rnd() * wires.length)], rnd() < 0.1));
  checkOnce(set, 2 + Math.floor(rnd() * 60), `random${t}`);
}
console.log(`panel-fill-test ok (${n} placements verified)`);
