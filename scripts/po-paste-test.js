// New order from the bid → "Type in parts or notes": a pasted list becomes one
// typed row per line (each row is its own line on the card and the PO PDF).
// Runs the CURRENT poSplitTyped body extracted from src/App.js so it can never
// test a stale copy, and pins the client's row cap to the server's
// (functions/materialPO/rules.js cleanOrderGroups). Runs in `prebuild`.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("const PO_TYPED_MAX"), b = src.indexOf("function PoCustomBox");
if (a === -1 || b === -1 || b < a) { console.error("po-paste-test: poSplitTyped not found in src/App.js"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + "\nthis.PO_TYPED_MAX = PO_TYPED_MAX; this.poSplitTyped = poSplitTyped;", ctx);
const { PO_TYPED_MAX, poSplitTyped } = ctx;

let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
};

eq("one line stays one row", poSplitTyped('2 boxes 1/2" NM connectors'), ['2 boxes 1/2" NM connectors']);
eq("newline list → one row per line", poSplitTyped("20A breaker x4\n12/2 wire 250ft\nwire nuts"), ["20A breaker x4", "12/2 wire 250ft", "wire nuts"]);
eq("Windows and old-Mac line breaks", poSplitTyped("a\r\nb\rc"), ["a", "b", "c"]);
eq("blank lines and padding dropped", poSplitTyped("\n  a  \n\n\t\nb\n"), ["a", "b"]);
eq("bullets come off", poSplitTyped("- 20A breaker\n• 12/2 wire\n* tape\n– staples\n· nuts"), ["20A breaker", "12/2 wire", "tape", "staples", "nuts"]);
eq("a dash inside a part stays", poSplitTyped("-48 V supply\nTR-15 receptacle"), ["-48 V supply", "TR-15 receptacle"]);
eq("numbered lines keep their numbers", poSplitTyped("1. breaker\n2. wire"), ["1. breaker", "2. wire"]);
eq("spreadsheet tabs → spaces", poSplitTyped("4\t20A breaker\tQO120"), ["4 20A breaker QO120"]);
eq("empty / null → nothing", [poSplitTyped(""), poSplitTyped(null), poSplitTyped("\n\n")], [[], [], []]);

// The server keeps the first 60 typed rows of a cost center; the warning uses the same number.
const rules = fs.readFileSync(path.join(__dirname, "..", "functions", "materialPO", "rules.js"), "utf8");
const m = rules.match(/g\.typed\.slice\(0,\s*(\d+)\)/);
eq("client row cap matches the server's", m && Number(m[1]), PO_TYPED_MAX);

if (fails) { console.error(`po-paste-test: ${fails} of ${n} failed`); process.exit(1); }
console.log(`po-paste-test: ${n} checks passed`);
