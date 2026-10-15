#!/usr/bin/env node
/* sharedoc-test.js — gate for the share-page "weak signal" fix (2026-10-15).
 *
 * Justin (commercial PM) opened a punch share link on job-site signal and got
 * "This punch list is not available." Koy opened the same link fine. The app
 * runs Firestore's persistent local cache: with no server reach, the SDK hands
 * back a CACHE-ONLY snapshot, and for a job the phone never downloaded that
 * snapshot says exists() === false. The share pages read that as "deleted".
 *
 * Extracts shareDocState VERBATIM from src/App.js and evals it in a vm sandbox
 * (house pattern: scripts/needs-dryrun.js), so the logic under test is exactly
 * what ships.
 *
 * Proves:
 *   1. DOC — exists → "ok" (cached or not); cache-only miss → "loading";
 *      server-confirmed miss → "missing"; no metadata / no snap → "loading"
 *      (never a false "not available").
 *   2. QUERY — the GC portal jobs list: non-empty → "ok"; cache-only empty →
 *      "loading"; server-confirmed empty → "missing" (the real empty state).
 *   3. WIRING — every share page that listens on a job / GC link subscribes
 *      with { includeMetadataChanges:true } (or the server's "it's gone"
 *      never arrives) and decides through shareDocState; none of them still
 *      turns a bare !snap.exists() into an error or a revoked link.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// Brace-balance from the first `{` after `marker` (skipping strings and
// comments) and return the verbatim slice. Fails loudly if missing.
function extractFrom(marker, label) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  // Body brace = first `{` after the parameter list's `)` — components take
  // destructured props (`({ jobId })`), whose brace is not the body.
  let i = src.indexOf("{", src.indexOf(")", start));
  if (i < 0) throw new Error(`extract: no open-brace for ${label}`);
  let depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; if (depth === 0) { i++; break; } continue; }
  }
  if (depth !== 0) throw new Error(`extract: unbalanced braces for ${label}`);
  return src.slice(start, i);
}
const extractFunction = (name) => extractFrom(`function ${name}(`, name);
// Whole component source: from `function Name(` to the next top-level
// function. Brace-balancing a big JSX component trips on apostrophes in page
// text, and the wiring checks below only need the region, not a parse.
const componentSource = (name) => {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`component ${name} not found in App.js`);
  const end = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, end < 0 ? src.length : end);
};

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction("shareDocState") + "\nthis.shareDocState = shareDocState;", sandbox);
const { shareDocState } = sandbox;

let passed = 0;
const check = (label, fn) => { fn(); passed++; };

// Fake snapshots — only the surface shareDocState reads.
const docSnap = (exists, fromCache) => ({ exists: () => exists, metadata: { fromCache } });
const qSnap = (n, fromCache) => ({ empty: n === 0, size: n, docs: [], metadata: { fromCache } });

// 1. DOC
check("doc: exists, from server → ok", () => assert.strictEqual(shareDocState(docSnap(true, false)), "ok"));
check("doc: exists, from this phone's cache → ok", () => assert.strictEqual(shareDocState(docSnap(true, true)), "ok"));
check("doc: cache-only miss (weak signal) → loading", () => assert.strictEqual(shareDocState(docSnap(false, true)), "loading"));
check("doc: server-confirmed miss → missing", () => assert.strictEqual(shareDocState(docSnap(false, false)), "missing"));
check("doc: no metadata → loading, never missing", () => assert.strictEqual(shareDocState({ exists: () => false }), "loading"));
check("doc: fromCache undefined → loading", () => assert.strictEqual(shareDocState({ exists: () => false, metadata: {} }), "loading"));
check("no snapshot → loading", () => { assert.strictEqual(shareDocState(null), "loading"); assert.strictEqual(shareDocState(undefined), "loading"); });

// 2. QUERY (GC portal jobs)
check("query: has docs → ok", () => { assert.strictEqual(shareDocState(qSnap(3, false)), "ok"); assert.strictEqual(shareDocState(qSnap(3, true)), "ok"); });
check("query: cache-only empty → loading", () => assert.strictEqual(shareDocState(qSnap(0, true)), "loading"));
check("query: server-confirmed empty → missing", () => assert.strictEqual(shareDocState(qSnap(0, false)), "missing"));

// 3. WIRING — the share pages themselves.
const PAGES = [
  ["HomeRunsSharePage", "jobs"], ["LoadsSharePage", "jobs"], ["LightingSharePage", "jobs"],
  ["LutronAdditionsSharePage", "jobs"], ["PunchSharePage", "jobs"], ["QuestionsSharePage", "jobs"],
  ["JobNoteSharePage", "jobs"], ["GCPortalPage", "gc_links"],
];
for (const [fn, coll] of PAGES) {
  const body = componentSource(fn);
  check(`${fn}: listens on ${coll} with includeMetadataChanges`, () => {
    const re = new RegExp(`onSnapshot\\(doc\\(db,\\s*["']${coll}["'][^)]*\\),\\s*\\{\\s*includeMetadataChanges\\s*:\\s*true\\s*\\}`);
    assert.ok(re.test(body), `${fn} must subscribe to ${coll} with { includeMetadataChanges:true }`);
  });
  check(`${fn}: decides through shareDocState`, () => assert.ok(/shareDocState\(snap\)/.test(body), `${fn} must call shareDocState(snap)`));
  check(`${fn}: no bare !snap.exists() → error/revoked`, () => {
    assert.ok(!/!snap\.exists\(\)\s*\)\s*\{?\s*(setError|setLink\(null\))/.test(body)
           && !/!snap\.exists\(\)\s*\|\|/.test(body),
      `${fn} still turns a bare !snap.exists() into "not available" — a weak signal would trip it`);
  });
}
// The punch / questions / note pages can also be fooled by an OLD saved copy
// that predates the link — they must wait for the server before saying closed.
for (const fn of ["PunchSharePage", "QuestionsSharePage", "JobNoteSharePage"]) {
  const body = componentSource(fn);
  check(`${fn}: stale saved copy waits for the server`, () =>
    assert.ok(/setCached\(!!snap\.metadata\.fromCache\)/.test(body) && /cached\s*&&|&&\s*cached/.test(body),
      `${fn} must track fromCache and show the weak-signal screen before "link closed"`));
}
check("ShareWeakSignal exists and says so", () => {
  const body = componentSource("ShareWeakSignal");
  assert.ok(body.includes("Weak signal — still loading…"));
  assert.ok(body.includes("Retry"));
});

console.log(`sharedoc-test: ${passed} checks passed`);
