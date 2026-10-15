#!/usr/bin/env node
// design-lint: fail the build on three design regressions in src/App.js.
//
// Why this exists (design pass 2026-10-14): v537 raised the app's small type
// once, but nothing stopped 9px text, emoji and hand-typed colours creeping
// back. This runs in prebuild, like tdz-scan, so the rules hold on every build.
//
//   1. TEXT SIZE FLOOR — a `fontSize` below 11 (fontSize: 9, fontSize: "9px",
//      either side of a ternary like `big ? 13 : 9`, or a `font: "700 9px ..."`
//      shorthand). Crews read this app outdoors on a phone.
//   2. NO EMOJI — an emoji in a string, template or JSX text that renders.
//      Use the <Icon name="..."/> component instead (vault decision "No Emojis
//      in App UI"). Comments are ignored. The FEATURES_MD_INLINE changelog data
//      is allowed (it is synced from FEATURES.md; the App Map strips emoji when
//      it renders it). Arrows and shapes such as → ↗ ▶ ◀ ✓ ✕ ★ are text, not
//      emoji, and are allowed.
//   3. NO NEW COPIES OF TOKEN COLOURS (a ratchet) — a hex literal that exactly
//      repeats a value from `const C` / `const D` (e.g. "#2F5BD9" instead of
//      C.accent). Hundreds already exist, so this only fails when the count goes
//      ABOVE the number stored in scripts/design-lint-baseline.json. When you
//      swap some for tokens, lower the baseline with --update-baseline so the
//      ratchet holds the gain.
//
// Usage:
//   node scripts/design-lint.js                    # scans src/App.js (prebuild)
//   node scripts/design-lint.js <file.js>          # scans another file
//   node scripts/design-lint.js --selftest         # proves each rule fires
//   node scripts/design-lint.js --update-baseline  # rewrites the ratchet number
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const MIN_FONT = 11;
const BASELINE_FILE = path.join(__dirname, "design-lint-baseline.json");
// Real emoji: anything shown as an emoji by default, plus the text-default
// symbols the app has used as emoji before (warning, sun, stopwatch, alarm,
// hourglass, check box), and the emoji variation selector.
const EMOJI_RE = /[\p{Emoji_Presentation}⚠☀⏱⏲⏰⌛⏳✅☑☎⚙⚡️]/u;
// Names whose string contents are data, not UI.
const ALLOW_EMOJI_IN = new Set(["FEATURES_MD_INLINE"]);

function lint(src, opts = {}) {
  const ast = parser.parse(src, { sourceType: "module", plugins: ["jsx"], errorRecovery: true });
  const fontProblems = [], emojiProblems = [], hexHits = [];

  // Token values from `const C = {...}` and `const D = {...}`.
  const tokenHex = new Map(); // "#2F5BD9" -> "C.accent"
  const tokenDeclRanges = [];
  traverse(ast, {
    VariableDeclarator(p) {
      const id = p.node.id;
      if (id.type !== "Identifier" || (id.name !== "C" && id.name !== "D")) return;
      if (!p.node.init || p.node.init.type !== "ObjectExpression") return;
      if (p.parentPath.parentPath && p.parentPath.parentPath.node.type !== "Program") return;
      tokenDeclRanges.push([p.node.start, p.node.end]);
      for (const prop of p.node.init.properties) {
        if (prop.type !== "ObjectProperty" || prop.value.type !== "StringLiteral") continue;
        const v = prop.value.value.toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(v)) continue;
        const k = prop.key.name || prop.key.value;
        if (!tokenHex.has(v)) tokenHex.set(v, `${id.name}.${k}`);
      }
    },
  });
  const inTokenDecl = (n) => tokenDeclRanges.some(([a, b]) => n.start >= a && n.end <= b);
  const line = (n) => (n.loc && n.loc.start.line) || 0;

  // Numbers a fontSize expression can produce (literal, either ternary branch, || / ?? fallbacks).
  const sizesOf = (node) => {
    if (!node) return [];
    switch (node.type) {
      case "NumericLiteral": return [node.value];
      case "StringLiteral": { const m = node.value.match(/^\s*(\d+(?:\.\d+)?)px\s*$/); return m ? [parseFloat(m[1])] : []; }
      case "ConditionalExpression": return [...sizesOf(node.consequent), ...sizesOf(node.alternate)];
      case "LogicalExpression": return [...sizesOf(node.left), ...sizesOf(node.right)];
      default: return [];
    }
  };
  const allowedEmoji = (p) => !!p.findParent(q => q.isVariableDeclarator() && q.node.id.type === "Identifier" && ALLOW_EMOJI_IN.has(q.node.id.name));
  const checkEmoji = (p, text, what) => {
    if (!text || !EMOJI_RE.test(text) || allowedEmoji(p)) return;
    const ch = text.match(EMOJI_RE)[0];
    emojiProblems.push({ line: line(p.node), msg: `emoji "${ch}" in ${what} — use the <Icon name="..."/> component instead (no emoji in the app).` });
  };
  const countHex = (n, text) => {
    if (!text || inTokenDecl(n)) return;
    for (const m of text.matchAll(/#[0-9A-Fa-f]{6}(?![0-9A-Fa-f])/g)) {
      const v = m[0].toUpperCase();
      if (tokenHex.has(v)) hexHits.push({ line: line(n), hex: m[0], token: tokenHex.get(v) });
    }
  };

  traverse(ast, {
    ObjectProperty(p) {
      const k = p.node.key; const name = k.type === "Identifier" ? k.name : k.type === "StringLiteral" ? k.value : "";
      if (name === "fontSize") {
        for (const v of sizesOf(p.node.value)) {
          if (v < MIN_FONT) fontProblems.push({ line: line(p.node), msg: `text size ${v}px is below the ${MIN_FONT}px floor — use ${MIN_FONT} or larger.` });
        }
      } else if (name === "font") {
        const v = p.node.value;
        const str = v.type === "StringLiteral" ? v.value : v.type === "TemplateLiteral" ? v.quasis.map(q => q.value.cooked).join("") : "";
        const m = str.match(/(?:^|\s)(\d+(?:\.\d+)?)px/);
        if (m && parseFloat(m[1]) < MIN_FONT) fontProblems.push({ line: line(p.node), msg: `font shorthand "${str.trim()}" sets ${m[1]}px, below the ${MIN_FONT}px floor.` });
      }
    },
    StringLiteral(p) {
      if (p.parentPath.isImportDeclaration() || p.parentPath.isExportDeclaration()) return;
      if (p.parentPath.isObjectProperty() && p.parentPath.node.key === p.node) return; // a key, not shown
      checkEmoji(p, p.node.value, "a string");
      countHex(p.node, p.node.value);
    },
    TemplateElement(p) {
      const t = p.node.value.cooked != null ? p.node.value.cooked : p.node.value.raw;
      checkEmoji(p, t, "a template string");
      countHex(p.node, t);
    },
    JSXText(p) {
      checkEmoji(p, p.node.value, "JSX text");
      countHex(p.node, p.node.value);
    },
  });
  return { fontProblems, emojiProblems, hexHits, tokens: tokenHex.size };
}

function readBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")); } catch { return null; }
}

// ── Self-test: each rule must fire on a known-bad fixture and stay quiet on a clean one.
if (process.argv[2] === "--selftest") {
  const BAD = `
const C = { text:"#1B1F24", accent:"#2F5BD9" };
const D = { bg1:"#141821" };
const FEATURES_MD_INLINE = String.raw\`- 📷 photos shipped\`;     // data: allowed
function A({ big }) {
  // a comment with 📷 and fontSize: 8 is ignored
  return <div style={{ fontSize: 9, color: "#2F5BD9" }}>
    <span style={{ fontSize: big ? 13 : 10 }}>x</span>
    <span style={{ fontSize: "8px" }}>y</span>
    <span style={{ font: "700 9px system-ui" }}>z</span>
    <span style={{ fontSize: 12, background: \`\${"#1B1F24"}\` }}>📅 Today</span>
    {"⚠ warning"}
    <span>→ ↗ ✓ ✕ ★ ▶</span>
  </div>;
}`;
  const CLEAN = `
const C = { text:"#1B1F24", accent:"#2F5BD9" };
function B() { return <div style={{ fontSize: 11, color: C.accent, font: "700 12px system-ui" }}><span style={{ fontSize: x ? 13 : 11 }}>→ ok ✓</span></div>; }`;
  const bad = lint(BAD), clean = lint(CLEAN);
  const fails = [];
  if (bad.fontProblems.length !== 4) fails.push(`expected 4 small-text hits, got ${bad.fontProblems.length}`);
  if (bad.emojiProblems.length !== 2) fails.push(`expected 2 emoji hits (📅, ⚠), got ${bad.emojiProblems.length}`);
  if (bad.hexHits.length !== 2) fails.push(`expected 2 token-copy hex hits, got ${bad.hexHits.length}`);
  if (clean.fontProblems.length || clean.emojiProblems.length || clean.hexHits.length) fails.push("clean fixture should pass");
  if (fails.length) { console.error("design-lint SELFTEST FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("design-lint selftest: OK (small text, emoji and token-copy rules all fire; clean code passes)");
  process.exit(0);
}

const UPDATE = process.argv[2] === "--update-baseline";
const target = (!UPDATE && process.argv[2]) || path.join(__dirname, "..", "src", "App.js");
const { fontProblems, emojiProblems, hexHits } = lint(fs.readFileSync(target, "utf8"));
const rel = path.relative(process.cwd(), target) || target;

if (UPDATE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    "//": "design-lint ratchet: hex literals in src/App.js that copy a C/D token value. The build fails above this number. Lower it (node scripts/design-lint.js --update-baseline) after swapping copies for tokens.",
    tokenHexCopies: hexHits.length,
  }, null, 2) + "\n");
  console.log(`design-lint: baseline set to ${hexHits.length} token-colour copies.`);
  process.exit(0);
}

let failed = false;
const report = (title, list) => {
  if (!list.length) return;
  failed = true;
  console.error(`\ndesign-lint: ${title} (${list.length})`);
  list.slice(0, 40).forEach(p => console.error(`  ${rel} line ${p.line}: ${p.msg}`));
  if (list.length > 40) console.error(`  ...and ${list.length - 40} more`);
};
report("text smaller than 11px", fontProblems);
report("emoji in the app UI", emojiProblems);

const base = readBaseline();
const limit = base && Number.isFinite(base.tokenHexCopies) ? base.tokenHexCopies : null;
if (limit == null) {
  failed = true;
  console.error(`\ndesign-lint: no ratchet number in ${path.relative(process.cwd(), BASELINE_FILE)} — run: node scripts/design-lint.js --update-baseline`);
} else if (hexHits.length > limit) {
  failed = true;
  const byToken = {};
  hexHits.forEach(h => { byToken[h.token] = (byToken[h.token] || 0) + 1; });
  console.error(`\ndesign-lint: ${hexHits.length} hand-typed copies of token colours, the limit is ${limit} (+${hexHits.length - limit}).`);
  console.error("  A new line typed a colour like \"#2F5BD9\" instead of using the token (C.accent).");
  console.error("  Use the token. Most-copied: " + Object.entries(byToken).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join(", "));
  console.error("  The newest copies are usually in the lines you just changed, e.g.: " + hexHits.slice(-5).map(h => `line ${h.line} ${h.hex}`).join("; "));
}

if (failed) {
  console.error("\ndesign-lint FAILED — fix the lines above (see scripts/design-lint.js for the why).");
  process.exit(1);
}
const lower = limit != null && hexHits.length < limit ? ` (below the ${limit} limit — run --update-baseline to lock in the gain)` : "";
console.log(`design-lint: OK — no text under ${MIN_FONT}px, no emoji, ${hexHits.length} token-colour copies${lower}.`);
