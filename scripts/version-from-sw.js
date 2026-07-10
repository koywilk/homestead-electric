// Prebuild (runs on every `npm run build`, Vercel included). Three jobs:
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
