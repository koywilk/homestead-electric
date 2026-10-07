// Pulled-by-day derivations for Daily Job Updates — extracts the shipped helpers VERBATIM from src/App.js.
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const slice = (from, to) => {
  const a = src.indexOf(from); if (a < 0) { console.error("pulleddaily-test: marker not found: " + from); process.exit(1); }
  const b = src.indexOf(to, a); if (b < 0) { console.error("pulleddaily-test: end marker not found after: " + from); process.exit(1); }
  return src.slice(a, b + to.length);
};
// the two real helpers the derivations lean on, plus the derivations themselves
const parseAnyDateSrc = slice("const parseAnyDate = (str) => {", "\n};\n");
const flattenSrc = slice("const flattenModulesToRows = (arr) => {", "\n};\n");
const a = src.indexOf("// ── Pulled-by-day derivations"), b = src.indexOf("// ── end Pulled-by-day derivations");
if (a < 0 || b < 0) { console.error("pulleddaily-test: derivation markers not found"); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(parseAnyDateSrc + "\n" + flattenSrc + "\n" + src.slice(a, b) +
  "\nthis.pulledHomeRunsByDay = pulledHomeRunsByDay; this.pulledLegsByDay = pulledLegsByDay; this.pulledDayKey = pulledDayKey;", ctx);
const { pulledHomeRunsByDay, pulledLegsByDay, pulledDayKey } = ctx;
// arrays built inside the vm sandbox have a different prototype, so compare by JSON (as the other gates do)
const deq = (x, y) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y));
const keys = (m) => [...m.keys()].sort();
const names = (m, k) => (m.get(k) || []).map(x => x.name);
const find = (m, day, name) => (m.get(day) || []).filter(x => x.name === name);

let n = 0; const ok = (m) => { n++; console.log("  ok  " + m); };
console.log("── pulled-by-day (Daily Job Updates) ──");

// Day keys
assert.strictEqual(pulledDayKey("10/6/2026"), "2026-10-06"); ok("M/D/YYYY -> ymd");
assert.strictEqual(pulledDayKey("10/06/26"), "2026-10-06"); ok("two-digit year -> ymd");
assert.strictEqual(pulledDayKey("2026-10-06"), "2026-10-06"); ok("ISO date -> ymd");
assert.strictEqual(pulledDayKey("2026-10-07T09:00:00"), "2026-10-07"); ok("ISO date-time with no zone -> its own local day");
assert.strictEqual(pulledDayKey(""), ""); assert.strictEqual(pulledDayKey(undefined), ""); assert.strictEqual(pulledDayKey("not a date"), ""); assert.strictEqual(pulledDayKey(12345), ""); ok("blank / junk / number -> no day");
assert.strictEqual(pulledDayKey("2026"), ""); assert.strictEqual(pulledDayKey("12345"), ""); assert.strictEqual(pulledDayKey("1/1/1900"), ""); assert.strictEqual(pulledDayKey("1/1/2200"), ""); assert.strictEqual(pulledDayKey("  10/6/2026  "), "2026-10-06"); ok("stray numbers / absurd years are rejected, padded real stamps are fine");

assert.strictEqual(pulledDayKey("13/45/2026"), ""); assert.strictEqual(pulledDayKey("0/0/2026"), ""); assert.strictEqual(pulledDayKey("2/30/2026"), ""); assert.strictEqual(pulledDayKey("2026-02-31"), ""); assert.strictEqual(pulledDayKey("2/28/2026"), "2026-02-28"); ok("impossible dates that roll over are rejected, real ones kept");

// Home runs
const hr = {
  main: [
    { id: "a", name: "Kitchen island", status: "Pulled", statusBy: "Colby Fogh", statusAt: "10/6/2026", panel: "Main", wire: "12/2" },
    { id: "b", name: "Garage freezer", status: "Pulled", statusBy: "Daegan", statusAt: "10/5/2026", panel: "Sub", wire: "12/2" },
    { id: "c", name: "Dryer", status: "Need Specs", statusBy: "", statusAt: "" },
    { id: "d", name: "Old pulled, never stamped", status: "Pulled" },
    { id: "e", name: "   ", status: "Pulled", statusAt: "10/6/2026" },
    { id: "f", name: "Range", status: "", statusAt: "10/6/2026" },
    null,
  ],
  basement: [{ id: "g", name: "Sump pump", status: "Pulled", statusBy: "Colby Fogh", statusAt: "10/6/2026" }],
  extraFloors: [{ key: "guest", label: "Guest House" }, null, {}],
  guest: [{ id: "h", name: "Mini split", status: "Pulled", statusBy: "Keegan", statusAt: "10/6/2026", wire: "10/2" }],
};
const h = pulledHomeRunsByDay(hr);
deq(keys(h), ["2026-10-05", "2026-10-06"]); ok("home runs land on the day of their own stamp");
deq(names(h, "2026-10-06").sort(), ["Kitchen island", "Mini split", "Sump pump"]); ok("only Pulled + named + stamped; includes basement and an extra floor");
deq(names(h, "2026-10-05"), ["Garage freezer"]); ok("yesterday's pull stays under yesterday");
const k = h.get("2026-10-06").find(x => x.name === "Kitchen island");
assert.strictEqual(k.by, "Colby Fogh"); assert.strictEqual(k.meta, "Main · Main Level · 12/2"); ok("who + panel/floor/wire carried");
assert.ok(h.get("2026-10-06").find(x => x.name === "Mini split").meta.includes("Guest House")); ok("extra floor keeps its own label");
assert.strictEqual(pulledHomeRunsByDay(null).size, 0); assert.strictEqual(pulledHomeRunsByDay({}).size, 0); ok("empty home runs are safe");
assert.strictEqual(pulledHomeRunsByDay({ main: "x", extraFloors: [null, {}] }).size, 0); ok("junk rows / junk extra floors are safe");
assert.strictEqual(pulledHomeRunsByDay({ extraFloors: {} }).size, 0); assert.strictEqual(pulledHomeRunsByDay({ extraFloors: "x", main: [{ name: "A", status: "Pulled", statusAt: "10/6/2026" }] }).size, 1); ok("extraFloors that is not a list cannot throw (render-safe)");
assert.strictEqual(pulledHomeRunsByDay({ main: [{ id: "z", name: "Z", status: "Pulled", statusAt: "10/6/2026" }], extraFloors: [{ key: "main", label: "Dup" }, { key: "g2" }, { key: "g2" }], g2: [{ id: "q", name: "Q", status: "Pulled", statusAt: "10/6/2026" }] }).get("2026-10-06").length, 2); ok("an extra floor that reuses a standard key, or repeats one, is not read twice");
assert.strictEqual(typeof pulledHomeRunsByDay({ main: [{ id: 1, name: "A", status: "Pulled", statusAt: "10/6/2026", statusBy: 42 }] }).get("2026-10-06")[0].by, "string"); ok("who is always text");

// Switch legs
const pl = {
  loads: [
    { id: "L1", name: "Kitchen pendants", pulled: true, pulledBy: "Colby Fogh", pulledAt: "10/6/2026", room: "Kitchen", location: "Main", panel: "Panel B" },
    { id: "L2", name: "Hall can lights", pulled: true, pulledBy: "Daegan", pulledAt: "10/5/2026" },
    { id: "L3", name: "Unpulled load", pulled: false, pulledAt: "10/6/2026" },
    { id: "L4", name: "Old pulled, no stamp", pulled: true },
    { id: "L5", name: "Cans", pulled: true, pulledBy: "Colby Fogh", pulledAt: "10/6/2026", location: "Main Level" },
    { id: "L6", name: "Cans", pulled: true, pulledBy: "Colby Fogh", pulledAt: "10/6/2026", location: "Upper Level" },
  ],
  cp4Loads: {
    main: [{ id: "m1", modNum: "3", loads: [
      { id: "x1", name: "Dining chandelier", pulled: true, pulledBy: "Keegan", pulledAt: "10/6/2026" },
      { id: "x2", name: "Kitchen pendants", pulled: true, pulledBy: "Keegan", pulledAt: "10/6/2026" },   // same leg as L1, same day
      { id: "x3", name: "Savant leg, no stamp", pulled: true },
      { id: "x4", name: "Hall can lights", pulled: true, pulledBy: "Keegan", pulledAt: "10/6/2026" },    // L2 was ticked yesterday: today is a new stamp
    ] }, null],
    upper: [{ id: "f1", name: "Primary sconces", pulled: true, pulledBy: "Colby Fogh", pulledAt: "10/6/2026", mod: "7", ch: "A" }],  // flat rows
  },
  extraFloors: [{ key: "pool", label: "Pool House" }],
  pool: [{ id: "p1", modNum: "1", loads: [{ id: "px", name: "Pool lights", pulled: true, pulledBy: "Colby Fogh", pulledAt: "10/6/2026" }] }],
};
const l = pulledLegsByDay(pl, { upper: "Kitchen Panel" });
deq(keys(l), ["2026-10-05", "2026-10-06"]); ok("legs land on the day of their own stamp");
deq(names(l, "2026-10-05"), ["Hall can lights"]); ok("yesterday's leg stays under yesterday");
assert.ok(!names(l, "2026-10-06").includes("Unpulled load")); ok("an unpulled load is never listed, even with a date");
assert.ok(!JSON.stringify([...l.values()]).includes("no stamp")); ok("pulled with no stamp (old, Pull all, paste, Savant) is skipped, not mis-dated");
assert.strictEqual(find(l, "2026-10-06", "Kitchen pendants").length, 1); ok("same leg in the Loads list and a panel schedule, same day, counts once");
assert.strictEqual(find(l, "2026-10-06", "Kitchen pendants")[0].by, "Colby Fogh"); ok("...and the Loads list copy is the one kept");
assert.strictEqual(find(l, "2026-10-06", "Cans").length, 2); ok("two different legs with the same name both stay (matched by row, not name)");
assert.strictEqual(find(l, "2026-10-06", "Hall can lights").length, 1); assert.strictEqual(find(l, "2026-10-05", "Hall can lights").length, 1); ok("a leg ticked on two different days shows on each day it was stamped");
deq(names(l, "2026-10-06").sort(), ["Cans", "Cans", "Dining chandelier", "Hall can lights", "Kitchen pendants", "Pool lights", "Primary sconces"]); ok("Loads list + nested module loads + flat rows + extra floor, all in");
assert.strictEqual(find(l, "2026-10-06", "Primary sconces")[0].meta, "Kitchen Panel · Mod 7"); ok("panel schedule uses the job's own panel name (plSectionLabels), not a floor name");
assert.strictEqual(find(l, "2026-10-06", "Dining chandelier")[0].meta, "Panel B · Mod 3"); ok("default panel names (upper A / main B / basement C) when none is set");
assert.strictEqual(find(l, "2026-10-06", "Pool lights")[0].meta, "Pool House · Mod 1"); ok("extra floor keeps its own label, plus the module");
assert.strictEqual(find(l, "2026-10-06", "Kitchen pendants")[0].meta, "Kitchen · Main · Panel B"); ok("Loads list row shows room, location and panel");
const allKeys = [...l.values()].flat().map(x => x.key);
assert.strictEqual(new Set(allKeys).size, allKeys.length); ok("every row has a unique React key");
assert.strictEqual(pulledLegsByDay(null).size, 0); assert.strictEqual(pulledLegsByDay({}).size, 0); assert.strictEqual(pulledLegsByDay({}, null).size, 0); ok("empty panelized data is safe");
assert.strictEqual(pulledLegsByDay({ loads: [null, 5], cp4Loads: { main: "x" }, extraFloors: [null] }).size, 0); ok("junk loads / junk floors are safe");
assert.strictEqual(pulledLegsByDay({ extraFloors: {}, cp4Loads: { main: [{ modNum: "1", loads: "oops" }] } }).size, 0); ok("extraFloors / module loads that are not lists cannot throw (render-safe)");
const idLess = pulledLegsByDay({ cp4Loads: { main: [{ name: "A", pulled: true, pulledAt: "10/6/2026" }, { name: "A", pulled: true, pulledAt: "10/6/2026" }] } }).get("2026-10-06");
assert.strictEqual(new Set(idLess.map(x => x.key)).size, 2); ok("rows with no id still get distinct keys");

// reviewer holes: Loads list vs several panel schedules, and an unstamped Loads-list twin
const multi = pulledLegsByDay({
  loads: [{ id: "a", name: "Cans", pulled: true, pulledBy: "A", pulledAt: "10/6/2026" }],
  cp4Loads: { main: [{ modNum: "1", loads: [{ id: "b", name: "Cans", pulled: true, pulledBy: "B", pulledAt: "10/6/2026" }] }],
              upper: [{ modNum: "2", loads: [{ id: "c", name: "Cans", pulled: true, pulledBy: "C", pulledAt: "10/6/2026" }] }] },
}).get("2026-10-06");
assert.strictEqual(multi.length, 2); ok("one Loads-list leg + two same-name schedule legs = 2 (one is the Loads-list leg again, one is a real second leg)");
const twin = pulledLegsByDay({
  loads: [{ id: "a", name: "Cans", pulled: true }],   // Lutron-migration shape: ticked, but no stamp
  cp4Loads: { main: [{ modNum: "1", loads: [{ id: "b", name: "Cans", pulled: true, pulledBy: "B", pulledAt: "10/6/2026" }] }] },
}).get("2026-10-06");
assert.strictEqual(twin.length, 1); assert.strictEqual(twin[0].by, "B"); ok("an unstamped Loads-list twin never hides a stamped schedule row");
assert.strictEqual(pulledLegsByDay({ cp4Loads: { main: [{ modNum: "1", loads: [{ id: "b", name: "X", pulled: true, pulledAt: "10/6/2026" }] }] }, extraFloors: [{ key: "main", label: "Dup" }, { key: "w" }, { key: "w" }], w: [{ modNum: "1", loads: [{ id: "k", name: "Y", pulled: true, pulledAt: "10/6/2026" }] }] }).get("2026-10-06").length, 2); ok("an extra floor that reuses a standard key, or repeats one, is not read twice");

// wiring (nothing else gates the component): the Rough tab passes all three props, both memos are guarded, Finish passes none
assert.ok(src.includes("homeRuns={job.homeRuns} panelized={job.panelizedLighting} plLabels={job.plSectionLabels}/>")); ok("Rough tab passes homeRuns, panelized and plLabels");
assert.ok(/try \{ return pulledHomeRunsByDay\(homeRuns\); \} catch/.test(src) && /try \{ return pulledLegsByDay\(panelized, plLabels\); \} catch/.test(src)); ok("both memos are try/catch-guarded (the app has no error boundary)");
assert.ok(src.includes("phasePunch={job.finishPunch}/>") && !/phasePunch=\{job\.finishPunch\}[^<]{0,80}homeRuns=/.test(src)); ok("Finish tab call site is unchanged");

console.log("\nall " + n + " passed");
