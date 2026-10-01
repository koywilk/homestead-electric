#!/usr/bin/env node
// tdz-scan: fail the build if any function in src/App.js reads a `const`/`let`
// before the line that declares it, in code that runs synchronously in that
// function body (the "Cannot access 'X' before initialization" crash).
//
// Why this exists (2026-10-01, v490 → v491 → v492): two hotfixes in a row for a
// React component whose hooks/refs were declared BELOW the render-time code
// that read them. `npm run build` compiled fine — the bug is a runtime order
// error — and the live app black-screened for every user. Koy: "gotta be more
// careful than that." This runs in prebuild, so it can never reach Vercel again.
//
// Reads inside nested functions (handlers, effects, JSX callbacks) are skipped:
// they run later, after the declaration has happened. Usage:
//   node scripts/tdz-scan.js            # scans src/App.js
//   node scripts/tdz-scan.js <file.js>  # scans another file (used by the self-test)
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const SELFTEST = process.argv[2] === "--selftest";
const FIXTURE = `
function Comp(props) {
  const rows = [];
  props.items.forEach(q => { rows.push(a[q.id]); });          // forEach callback reads a — runs now (bug 1)
  const n = (() => b.length)();                               // IIFE reads b — runs now (bug 2)
  const m = useMemo(() => c + 1, [c]);                        // memo initializer reads c — runs now (bug 3)
  const onClick = () => d.length;                              // handler reads d — runs later (ok)
  useEffect(() => { e.length; }, []);                          // effect reads e — runs later (ok)
  if (props.x) { const f = 1; rows.push(f); }                  // inner f, shadow-safe (ok)
  const f = 2;
  for (let i = 0; i < 3; i++) { if (i && g) rows.push(g); let g = i; }   // loop-carried let (ok)
  const a = {}, b = [], c = 1, d = [], e = [];
  return rows.length + n + m + f + onClick;
}`;
const target = SELFTEST ? "(selftest fixture)" : (process.argv[2] || path.join(__dirname, "..", "src", "App.js"));
const src = SELFTEST ? FIXTURE : fs.readFileSync(target, "utf8");
const ast = parser.parse(src, { sourceType: "module", plugins: ["jsx"], errorRecovery: true });

const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"]);
const problems = [];

// A nested function whose body runs synchronously while the outer function runs:
// an IIFE, a callback to an array iterator, or a React lazy initializer / memo.
const SYNC_ITER = new Set(["forEach", "map", "filter", "reduce", "reduceRight", "some", "every", "find", "findIndex", "findLast", "flatMap", "sort", "toSorted"]);
const SYNC_HOOKS = new Set(["useMemo", "useState", "useReducer"]);
function runsNow(p) {
  const parent = p.parentPath;
  if (!parent || !parent.isCallExpression()) return false;
  const call = parent.node;
  if (call.callee === p.node) return true;                                   // (() => {...})()
  if (!call.arguments.includes(p.node)) return false;
  const c = call.callee;
  if (c.type === "MemberExpression" && !c.computed && SYNC_ITER.has(c.property.name)) return true;   // xs.forEach(x => ...)
  if (c.type === "Identifier" && SYNC_HOOKS.has(c.name)) return true;       // useMemo(() => ...), useState(() => ...)
  return false;
}

function scanFunction(fnPath) {
  const body = fnPath.get("body");
  if (!body || !body.isBlockStatement()) return;
  const fnName = (fnPath.node.id && fnPath.node.id.name) || (fnPath.parentPath.isVariableDeclarator() && fnPath.parentPath.node.id.name) || "(anonymous)";
  const seen = new Set();
  body.traverse({
    Function(p) { if (!runsNow(p)) p.skip(); },   // handlers / effects run later; forEach/map/IIFE/useMemo run NOW
    Identifier(p) {
      if (!p.isReferencedIdentifier()) return;
      const n = p.node.name;
      const b = p.scope.getBinding(n);   // the binding this reference actually resolves to
      if (!b || (b.kind !== "const" && b.kind !== "let")) return;
      if (b.scope.getFunctionParent() !== fnPath.scope) return;   // declared in another function — not ours
      const decl = b.path.node;
      if (!decl || p.node.start >= decl.start) return;
      // a loop body may read a `let` declared earlier in the same loop on a later turn: skip loops
      if (p.findParent(x => x.isLoop() && x.node.start < decl.start && x.node.end > decl.end && x.scope.getFunctionParent() === fnPath.scope)) return;
      const key = n + "@" + p.node.loc.start.line;
      if (seen.has(key)) return; seen.add(key);
      problems.push({ fn: fnName, name: n, readLine: p.node.loc.start.line, declLine: decl.loc.start.line });
    },
  });
}

traverse(ast, { Function(p) { scanFunction(p); } });

if (SELFTEST) {
  const got = problems.map(x => x.name).sort().join(",");
  const want = "a,b,c";
  if (got !== want) { console.error(`  tdz-scan SELFTEST FAILED: expected [${want}] got [${got}]`); process.exit(1); }
  console.log("  ok  tdz-scan self-test: catches forEach / IIFE / useMemo reads, ignores handlers, effects, shadows, loops");
  process.exit(0);
}
const rel = path.relative(process.cwd(), target);
if (problems.length) {
  console.error(`\n  tdz-scan: ${problems.length} read-before-declare in ${rel} — this black-screens the app at runtime:\n`);
  problems.forEach(x => console.error(`  ✗ ${x.fn}(): '${x.name}' read at line ${x.readLine}, but declared at line ${x.declLine}`));
  console.error(`\n  Move the declaration above the first read (or the read below the declaration).\n`);
  process.exit(1);
}
console.log(`  ok  tdz-scan: no read-before-declare in ${rel}`);
