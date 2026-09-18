// Approved-COs-on-punch derivations (v417) — extracts the shipped helpers VERBATIM from src/App.js.
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("// ── Approved COs on the punch list"), b = src.indexOf("// ── end Approved COs derivations");
if (a < 0 || b < 0) { console.error("copunch-test: markers not found"); process.exit(1); }
const ctx = vm.createContext({ parseStage: (s) => s === "Scheduled" ? 1 : (parseInt(s) || 0), coIsConverted: (co) => co.coStatus === "converted" || !!co._rt });
vm.runInContext(src.slice(a, b) + "\nthis.coTaskLines = coTaskLines; this.coTaskKey = coTaskKey; this.coPunchPhase = coPunchPhase; this.approvedCOsForPunch = approvedCOsForPunch;", ctx);
const { coTaskLines, coTaskKey, coPunchPhase, approvedCOsForPunch } = ctx;
const eq = (x, y, m) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y), m);
// real Miller CO markup
const html = '<div><b>Add 5x lighting control switchlegs</b></div><div><b>Basement&nbsp;</b></div>Basement exercise stairs<div>- Add 2 wafers</div><div>Steam shower feed&nbsp;</div><div>- 100 amp circuit&nbsp;</div><div><p>&nbsp;- add 2x fans in sport court</p></div><div><br></div>';
eq(coTaskLines(html), [
  { kind: "head", text: "Add 5x lighting control switchlegs" }, { kind: "head", text: "Basement" }, { kind: "head", text: "Basement exercise stairs" },
  { kind: "item", text: "Add 2 wafers" }, { kind: "head", text: "Steam shower feed" }, { kind: "item", text: "100 amp circuit" }, { kind: "item", text: "add 2x fans in sport court" },
], "rich-text task -> headings + '- ' items; nbsp + blank lines dropped");
eq(coTaskLines('<font color="#8a929d">-&nbsp;<span>primary suite Hall</span><span>&nbsp;- we added 3 flushmounts</span></font>'), [{ kind: "item", text: "primary suite Hall - we added 3 flushmounts" }], "inline spans join into one line");
eq(coTaskLines("Plain sentence, no bullets"), [{ kind: "head", text: "Plain sentence, no bullets" }], "no bullets -> a heading line, never a phantom check");
eq(coTaskLines(""), [], "empty");
eq(coTaskKey("  Add 2X  Wafers "), "add 2x wafers", "key normalises case + whitespace");
eq(coPunchPhase({ roughStage: "5%" }), "rough", "rough in progress -> rough");
eq(coPunchPhase({ roughStage: "100%" }), "finish", "rough done -> finish");
eq(coPunchPhase({}), "rough", "no stage -> rough");
const cos = [
  { id: "a", coStatus: "approved", desc: "A" },
  { id: "b", coStatus: "pending", desc: "B" },
  { id: "c", coStatus: "completed", punchDoneAt: "2026-09-18T00:00:00Z", desc: "C" },
  { id: "d", coStatus: "completed", desc: "D (office-completed, no punch stamp)" },
  { id: "e", coStatus: "approved", _rt: true, desc: "E converted" },
  { id: "f", coStatus: "approved", desc: "F" },
];
eq(approvedCOsForPunch(cos, []).map(e => [e.co.id, e.idx, e.done]), [["a", 0, false], ["f", 5, false], ["c", 2, true]], "approved (not converted) open first, punch-done last; pending / office-completed / converted excluded; idx = original position");
eq(approvedCOsForPunch(null, null), [], "null-safe");
console.log("copunch-test ok");
