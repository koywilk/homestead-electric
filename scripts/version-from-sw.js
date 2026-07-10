// Prebuild (runs on every `npm run build`, Vercel included). Four jobs:
//
// 1. Bake the service-worker CACHE version into the bundle as
//    REACT_APP_VERSION so the running app knows exactly which build it is
//    (the SW itself can't be asked — skipWaiting means the NEW worker takes
//    over while an OLD bundle is still running, so it would lie). Powers the
//    always-current auto-update system. The SW bump stays the single version
//    anyone maintains.
//
// 2. Sync FEATURES.md (repo root, the App Map source of truth) into the
//    FEATURES_MD_INLINE literal in src/App.js, so the in-app App Map page
//    and the AI help box can never drift from the real doc again.
//
// 3. ENFORCE that FEATURES.md mentions the version being shipped — the
//    build FAILS otherwise. Every SW bump must come with its App Map entry
//    (Koy, 2026-07-10: "the app map should be flipped and updated whenever
//    one of the features there is built").
//
// 4. ENFORCE zero undefined identifiers in src/App.js (eslint no-undef) —
//    the build FAILS otherwise. Added after the v319 cleanup (da3a481)
//    deleted WIRE_BREAKER/wireAmpsVolts as "dead code" while live call
//    sites remained: every homeowner generator share link blank-screened
//    with a ReferenceError. JS only throws at render, so the gate has to
//    catch orphaned references before Vercel ships them.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// ── 1. version bake ─────────────────────────────────────────────────────────
const sw = fs.readFileSync(path.join(root, 'public', 'service-worker.js'), 'utf8');
const m = sw.match(/CACHE\s*=\s*"([^"]+)"/);
if (!m) { console.error('version-from-sw: CACHE const not found in public/service-worker.js'); process.exit(1); }
const fullVersion = m[1];                       // e.g. homestead-v319
const shortVersion = fullVersion.split('-').pop(); // e.g. v319
fs.writeFileSync(path.join(root, '.env.production.local'), `REACT_APP_VERSION=${fullVersion}\n`);
console.log('version-from-sw: baked', fullVersion);

// ── 3. enforcement (checked before the sync so a failure leaves no writes) ──
const featuresPath = path.join(root, 'FEATURES.md');
const features = fs.readFileSync(featuresPath, 'utf8');
if (!features.includes(shortVersion)) {
  console.error('');
  console.error('  BUILD BLOCKED: FEATURES.md does not mention ' + shortVersion + '.');
  console.error('  Every SW bump ships with its App Map entry — add or update a');
  console.error('  line in FEATURES.md tagged with `SW ' + shortVersion + '` (and bump the');
  console.error('  "Last manifest update" header), then build again.');
  console.error('');
  process.exit(1);
}

// ── 4. no-undef gate (also before the sync — a failure leaves no writes) ────
// Runs eslint (already installed via react-scripts) with the single `no-undef`
// rule over src/App.js. Config lives in scripts/no-undef.eslintrc.json.
// A fatal parse error can't verify anything — warn loudly but let the real
// build surface it (babel fails on true syntax errors); only confirmed
// orphaned identifiers block the build.
const { spawnSync } = require('child_process');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!fs.existsSync(eslintBin)) {
  console.error('version-from-sw: no-undef gate could not find eslint at ' + eslintBin);
  process.exit(1);
}
const lint = spawnSync(process.execPath, [
  eslintBin, '--no-eslintrc', '-c', path.join(__dirname, 'no-undef.eslintrc.json'),
  '--format', 'json', 'src/App.js',
], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let lintMessages = null;
try { lintMessages = JSON.parse(lint.stdout)[0].messages; } catch (e) { /* handled below */ }
if (!lintMessages) {
  console.error('version-from-sw: no-undef gate could not run eslint: ' +
    ((lint.error && lint.error.message) || (lint.stderr || '').trim() || 'no output'));
  process.exit(1);
}
const fatal = lintMessages.filter(msg => msg.fatal);
if (fatal.length) {
  console.warn('version-from-sw: WARNING — no-undef gate skipped, eslint could not parse src/App.js:');
  fatal.slice(0, 3).forEach(msg => console.warn(`  line ${msg.line}: ${msg.message}`));
  console.warn('  (a true syntax error will fail the build itself; if the build passes, App.js');
  console.warn('  uses syntax newer than scripts/no-undef.eslintrc.json allows — update it)');
} else {
  const undef = lintMessages.filter(msg => msg.ruleId === 'no-undef');
  if (undef.length) {
    const names = [...new Set(undef.map(msg => (msg.message.match(/'([^']+)'/) || [])[1] || '?'))];
    console.error('');
    console.error('  BUILD BLOCKED: src/App.js references identifiers that are never defined —');
    console.error('  each one is a ReferenceError waiting to blank-screen whoever renders it');
    console.error('  (this is exactly how the v319 cleanup broke the homeowner generator links):');
    undef.slice(0, 20).forEach(msg => console.error('    line ' + msg.line + ': ' + msg.message));
    if (undef.length > 20) console.error('    …and ' + (undef.length - 20) + ' more');
    console.error('  Undefined: ' + names.join(', '));
    console.error('  Restore the missing definition(s) or remove the orphaned call sites,');
    console.error('  then build again.');
    console.error('');
    process.exit(1);
  }
  console.log('version-from-sw: no-undef gate clean — 0 orphaned identifiers in src/App.js');
}

// ── 2. inline sync ──────────────────────────────────────────────────────────
// Template-literal safety: backticks would terminate the String.raw literal
// and ${ would interpolate even inside String.raw — neutralize both.
const safe = features.replace(/`/g, "'").replace(/\$\{/g, '$ {');
const appPath = path.join(root, 'src', 'App.js');
const app = fs.readFileSync(appPath, 'utf8');
const startMarker = 'const FEATURES_MD_INLINE = String.raw`';
const endMarker = '\n`;';
const si = app.indexOf(startMarker);
if (si === -1) { console.error('version-from-sw: FEATURES_MD_INLINE marker not found in src/App.js'); process.exit(1); }
const contentStart = si + startMarker.length;
const ei = app.indexOf(endMarker, contentStart);
if (ei === -1) { console.error('version-from-sw: FEATURES_MD_INLINE end marker not found'); process.exit(1); }
const current = app.slice(contentStart, ei);
const next = '\n' + safe.trim() + '\n';
if (current !== next) {
  fs.writeFileSync(appPath, app.slice(0, contentStart) + next + app.slice(ei));
  console.log('version-from-sw: synced FEATURES.md into FEATURES_MD_INLINE (' + safe.length + ' chars)');
} else {
  console.log('version-from-sw: FEATURES_MD_INLINE already in sync');
}
