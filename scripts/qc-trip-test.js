#!/usr/bin/env node
// qc-trip-test (v549, UX batch 2): the QC verdict sheet reads qcTripPlan() from
// src/App.js. Pulled out verbatim and checked: a rough verdict only takes open
// rough QC items (it used to sweep finish items onto the rough trip), done and
// voided items stay off, an already-open QC trip gets only the items it doesn't
// carry yet, and the next trip number is right. Exit 1 on failure. Prebuild.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`extract: ${name} not found in App.js`);
  let i = src.indexOf(") {", start) + 2, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const box = {};
vm.runInNewContext(extractFunction("qcTripPlan") + "\nthis.qcTripPlan = qcTripPlan;", box);
const plan = box.qcTripPlan;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const qc = (id, extra = {}) => ({ id, text: "item " + id, fromQC: true, done: false, ...extra });
const job = {
  name: "Miller Residence - Alpine",
  roughPunch: {
    main: { general: [qc("r1"), qc("r2", { done: true }), { id: "r3", text: "not from QC", done: false }],
            rooms: [{ name: "Kitchen", items: [qc("r4"), qc("r5", { voided: true })] }], hotcheck: [qc("r6")] },
    upper: { general: [], rooms: [] },
    extras: [{ key: "extra_exterior", label: "Exterior" }],
    extra_exterior: { general: [qc("r7")], rooms: [] },
  },
  finishPunch: { main: { general: [qc("f1"), qc("f2")], rooms: [] } },
  returnTrips: [{ scope: "Smurf tube", signedOff: true }, { scope: "Floor outlets", signedOff: false }],
};

let p = plan(job, "rough");
ok(JSON.stringify(p.items.map((i) => i.id).sort()) === JSON.stringify(["r1", "r4", "r6", "r7"]), "rough: 4 open QC items (general, room, hotcheck, extra floor)");
ok(p.items.every((i) => i.id[0] === "r"), "rough: no finish items swept in");
ok(!p.items.some((i) => ["r2", "r3", "r5"].includes(i.id)), "rough: done, non-QC and voided items stay off");
ok(p.items.every((i) => i.__phase === "rough"), "rough: items tagged with their phase");
ok(p.existingIdx === -1 && p.newItems.length === 4 && p.nextTripNo === 3, "no open QC trip: all items new, next trip is #3");

p = plan(job, "finish");
ok(p.items.length === 2 && p.items.every((i) => i.id[0] === "f"), "finish: only finish QC items");

const withTrip = { ...job, returnTrips: [...job.returnTrips, { scope: "QC Fail — return trip needed", fromQCFail: true, signedOff: false, punch: [{ originItemId: "r1" }, { originItemId: "r4" }] }] };
p = plan(withTrip, "rough");
ok(p.existingIdx === 2, "open QC trip found (Return Trip #3)");
ok(JSON.stringify(p.newItems.map((i) => i.id).sort()) === JSON.stringify(["r6", "r7"]), "only the items the trip doesn't carry yet");
const legacy = { ...job, returnTrips: [{ scope: "QC Fail - old", signedOff: false, punch: [] }] };
ok(plan(legacy, "rough").existingIdx === 0, "legacy 'QC Fail' scope counts as an open QC trip");
const signed = { ...job, returnTrips: [{ scope: "QC Fail — return trip needed", fromQCFail: true, signedOff: true }] };
ok(plan(signed, "rough").existingIdx === -1, "a signed-off QC trip doesn't count");
ok(plan({}, "rough").items.length === 0 && plan(null, "finish").nextTripNo === 1, "empty job is safe");

console.log(`  ok  qc-trip-test: ${n} checks`);
