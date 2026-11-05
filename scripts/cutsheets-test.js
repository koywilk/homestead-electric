// Cut sheets library (Plans & Links) — extracts the shipped helpers VERBATIM from src/App.js.
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("// ── Cut sheets helpers"), b = src.indexOf("// ── end Cut sheets helpers");
if (a < 0 || b < 0) { console.error("cutsheets-test: helper markers not found in App.js"); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(src.slice(a, b) + `\nthis.T = { cutSheetRow, filterCutSheets };`, ctx);
const T = ctx.T;
let n = 0; const ok = (m) => { n++; console.log("  ok  " + m); };
console.log("── cut sheets ──");

const pdf = "application/pdf";
const r1 = T.cutSheetRow({ id: "a1", name: "Square D – Homeline 1P 20A Breaker – HOM120.pdf", mimeType: pdf, webViewLink: "https://drive/x" },
  ["02 Breakers, Panels & Disconnects", "Square D"]);
assert.strictEqual(r1.title, "Homeline 1P 20A Breaker – HOM120"); ok("brand prefix dropped from the title");
assert.strictEqual(r1.category, "Breakers, Panels & Disconnects"); ok("category number dropped");
assert.strictEqual(r1.brand, "Square D"); ok("brand comes from the folder");
assert.strictEqual(r1.url, "https://drive/x"); ok("Drive link kept");
const r2 = T.cutSheetRow({ id: "b2", name: "Carlton Floor Outlet Finishes.pdf", mimeType: pdf }, ["07 Floor Boxes & Outlets", "Carlton"]);
assert.strictEqual(r2.title, "Carlton Floor Outlet Finishes"); ok("older names without the dash pattern stay whole");
assert.strictEqual(r2.url, "https://drive.google.com/file/d/b2/view"); ok("link built from the id when Drive sends none");
const r3 = T.cutSheetRow({ id: "c3", name: "GM Track With Flange Cut Sheet.pdf", mimeType: pdf }, ["03 Lighting", "GM Tape Lighting"]);
assert.strictEqual(r3.brand, "GM Tape Lighting"); ok("brand folder name used as is");

const rows = [
  r1,
  T.cutSheetRow({ id: "d4", name: "RAB – 2in 5CCT Wafer White Smooth – WFRX-2.pdf", mimeType: pdf }, ["03 Lighting", "RAB"]),
  T.cutSheetRow({ id: "e5", name: "Keystone – 4in 5CCT Wafer – KT-WDLED9-4 A-B-BB.pdf", mimeType: pdf }, ["03 Lighting", "Keystone"]),
  T.cutSheetRow({ id: "f6", name: "RAB – 4in 5CCT Wafer Black Baffle – WFRL4R99FA120BB.pdf", mimeType: pdf }, ["03 Lighting", "RAB"]),
];
const ids = (q) => T.filterCutSheets(rows, q).map(s => s.id).join(",");
assert.strictEqual(ids(""), "a1,d4,e5,f6"); ok("empty search shows everything");
assert.strictEqual(ids("hom120"), "a1"); ok("part number ignores case");
assert.strictEqual(ids("wfrx2"), "d4"); ok("part number ignores the dash");
assert.strictEqual(ids("4in wafer"), "e5,f6"); ok("every word must match");
assert.strictEqual(ids("rab wafer"), "d4,f6"); ok("brand words match");
assert.strictEqual(ids("lighting keystone"), "e5"); ok("category words match");
assert.strictEqual(ids("zzz"), ""); ok("no match returns nothing");

console.log(`cutsheets-test: ${n} passed`);
