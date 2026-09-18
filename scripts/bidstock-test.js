// Bid stock derivation tests (v416) — extracts the shipped helpers VERBATIM from src/App.js.
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("// ── Bid stock derivations"), b = src.indexOf("// ── end Bid stock derivations");
if (a < 0 || b < 0) { console.error("bidstock-test: markers not found"); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(src.slice(a, b) + "\nthis.bidWireLike = bidWireLike; this.bidStockStatus = bidStockStatus; this.bidWireRollup = bidWireRollup;", ctx);
const { bidWireLike, bidStockStatus, bidWireRollup } = ctx;
const eq = (x, y, m) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y), m);
// wire detection (real Miller names)
eq(["NM-B-12/2-CU-WG-250CL","NM-B-14/2-WG-CU-500CL","UF-B-12/2-CU-WG-250CL","*THERMOSTAT WIRE 500' 47104807","12/2 MC Lighting Whip"].map(n => bidWireLike(n, "")), [true,true,true,true,true], "wire names");
eq(["ROMEX STAPLE 12/2 AND 14/2 (5000)","1G ANGLED FLEX BOX","WHT DRI-BOX VERT","JOBSITE MARKER SHARP BLACK","WIRE NUT RED"].map(n => bidWireLike(n, "")), [false,false,false,false,false], "not wire: staples, boxes, markers, wire nuts");
eq(bidWireLike("", "14/2X250"), false, "part number alone isn't enough");
// status
eq(bidStockStatus({ required: 3750, assigned: 6000 }), { kind: "over", diff: 2250 }, "over by 2250");
eq(bidStockStatus({ required: 5150, assigned: 1500 }), { kind: "short", diff: 3650 }, "short by 3650");
eq(bidStockStatus({ required: 5000, assigned: 5000 }), { kind: "ok", diff: 0 }, "on the number");
eq(bidStockStatus({ required: -4320, assigned: 0 }), { kind: "deduction", diff: 0 }, "negative Required = Simpro deduction line, never over");
eq(bidStockStatus({ required: 0, assigned: 0 }), { kind: "none", diff: 0 }, "empty");
eq(bidStockStatus(null), { kind: "none", diff: 0 }, "null-safe");
// rollup nets deductions and merges storage
const roll = bidWireRollup([
  { rows: [{ catalogId: 9958, name: "NM-B-14/2-WG-CU-500CL", partNo: "NMB KS14/2X500", required: 15265, assigned: 0, breakdown: [] }, { catalogId: 1661, name: "1G ANGLED FLEX BOX", partNo: "", required: 322, assigned: 300, breakdown: [] }] },
  { rows: [{ catalogId: 9958, name: "NM-B-14/2-WG-CU-500CL", partNo: "NMB KS14/2X500", required: -4320, assigned: 0, breakdown: [] }] },
  { rows: [{ catalogId: 7118, name: "NM-B-14/2-CU-WG-250CL", partNo: "14/2X250", required: 3750, assigned: 6000, breakdown: [{ storage: "Shop", qty: 6000 }] }, { catalogId: 7118, name: "NM-B-14/2-CU-WG-250CL", partNo: "14/2X250", required: 100, assigned: 50, breakdown: [{ storage: "Shop", qty: 50 }] }] },
]);
eq(roll.map(r => [r.catalogId, r.required, r.assigned, r.ccCount]), [[9958, 10945, 0, 2], [7118, 3850, 6050, 2]], "wire only, summed across cost centers, deduction netted, sorted by required");
eq(roll[1].breakdown, [{ storage: "Shop", qty: 6050 }], "storage merged");
eq(bidWireRollup(null), [], "null-safe");
console.log("bidstock-test ok");
