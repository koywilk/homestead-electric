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

// ── 5. SOP guide manifest ───────────────────────────────────────────────────
// Scans public/sops/*.html and bakes the list into SOP_FILES_INLINE in
// src/App.js, so THE FILENAME IS THE WIRING: drop `homeruns.html` in that
// folder and the "?" turns on for the Home Runs tab, with no code edit.
//
// The title comes from each guide's own <title>, which a SOP Recorder export
// already sets from the recording's name — so a raw export needs no editing at
// all. Guides are NOT bundled (a recorded one is 2-5MB of data-URI
// screenshots); only this tiny index is, and the app fetches the file on tap.
//
// Key = filename minus .html. The app derives the same key from a tab label by
// lowercasing and stripping non-alphanumerics (`sopKeyForTab`), so a guide that
// matches no tab is almost always a typo — hence the loud warning below, which
// is the only thing standing between a misnamed file and a "?" that silently
// never appears.
const sopsDir = path.join(root, 'public', 'sops');
// Warn-list of valid keys, extracted from the REAL TABS const in src/App.js so
// this list can never drift when a tab is added or renamed. The baked fallback
// below only cushions a future TABS refactor that breaks the regex.
const appSrcForSops = fs.readFileSync(appPath, 'utf8');
const tabsSrcMatch = appSrcForSops.match(/const TABS = \[([\s\S]*?)\]/);
let TAB_KEYS = tabsSrcMatch
  ? (tabsSrcMatch[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1).toLowerCase().replace(/[^a-z0-9]/g, ''))
  : null;
if (!TAB_KEYS || TAB_KEYS.length < 5) {
  console.warn('version-from-sw: could not extract TABS from src/App.js — SOP filename warnings are using a baked fallback list that may be stale.');
  TAB_KEYS = ['jobinfo','activity','photos','planslinks','rough','finish','questions',
    'homeruns','panelizedlighting','tapelight','changeorders','returntrips','openitems','qc'];
}
// Not every guide belongs to a tab — some open from a "?" placed at a specific
// spot (the link-creation sites use section="sharelinks"). Any key that appears
// as a <HelpDot section="..."> literal in the source has a live mount, so it is
// valid by definition. Self-maintaining: mounting a dot for a new non-tab guide
// automatically whitelists its filename here, no list to update.
const mountedKeys = [...appSrcForSops.matchAll(/<HelpDot\s+section="([a-z0-9]+)"/g)].map(m => m[1]);
const VALID_SOP_KEYS = new Set([...TAB_KEYS, ...mountedKeys]);

let sopFiles = [];
if (fs.existsSync(sopsDir)) {
  sopFiles = fs.readdirSync(sopsDir)
    .filter(f => f.toLowerCase().endsWith('.html') && !f.startsWith('__') && !f.startsWith('.'))
    .sort()
    .map(f => {
      // Key is LOWERCASED so HomeRuns.html still lights up Home Runs — but the
      // fetch path keeps the EXACT filename. Production hosting is
      // case-sensitive even though this Mac's filesystem is not, so a path
      // rebuilt from the lowercased key would 404 in prod while working
      // perfectly in every local preview.
      const key = f.replace(/\.html$/i, '').toLowerCase();
      const html = fs.readFileSync(path.join(sopsDir, f), 'utf8').slice(0, 8000);
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      // Fall back to a readable form of the filename when a guide has no title;
      // collapse whitespace either way (a wrapped <title> otherwise carries \n).
      const raw = ((t && t[1]) || key.replace(/[-_]+/g, ' ')).replace(/\s+/g, ' ').trim();
      // SOP Recorder writes the title through escapeHtml(), so a guide called
      // "Home Runs & Panels" arrives as "Home Runs &amp; Panels" and would show
      // that way in the viewer header. Decode the five entities escapeHtml
      // emits — &amp; LAST, or "&amp;lt;" would decode twice into a real "<".
      const title = raw
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
        .replace(/&amp;/g, '&');
      return { key, title, file: '/sops/' + f };
    });
}
// Two files that differ only in case/punctuation collapse to one key — keep
// the first (readdir is sorted, so this is deterministic) and say so loudly.
const sopSeen = new Set();
sopFiles = sopFiles.filter(s => {
  if (sopSeen.has(s.key)) {
    console.warn('version-from-sw: NOTE — ' + s.file + ' ignored: its key "' + s.key +
      '" duplicates another guide (files differing only by case or punctuation).');
    return false;
  }
  sopSeen.add(s.key);
  return true;
});
sopFiles.forEach(s => {
  if (!VALID_SOP_KEYS.has(s.key)) {
    console.warn('version-from-sw: NOTE — public/sops/' + s.key + '.html matches no job tab');
    console.warn('  and no mounted <HelpDot section="' + s.key + '">, so its "?" will never appear.');
    console.warn('  If that is a typo, rename it to the tab name with spaces & symbols removed —');
    console.warn('  capitalization does not matter (e.g. "Home Runs" -> homeruns.html).');
  }
});

const sopStart = '/* SOPS_START */';
const sopEnd = '/* SOPS_END */';
const app2 = fs.readFileSync(appPath, 'utf8');
const ss = app2.indexOf(sopStart);
const se = app2.indexOf(sopEnd);
if (ss === -1 || se === -1) {
  console.error('version-from-sw: SOPS_START/SOPS_END markers not found in src/App.js');
  process.exit(1);
}
const sopBlock = sopStart + '\nconst SOP_FILES_INLINE = ' + JSON.stringify(sopFiles) + ';\n';
const currentSop = app2.slice(ss, se);
if (currentSop !== sopBlock) {
  fs.writeFileSync(appPath, app2.slice(0, ss) + sopBlock + app2.slice(se));
  console.log('version-from-sw: synced ' + sopFiles.length + ' SOP guide(s) — ' +
    (sopFiles.map(s => s.key).join(', ') || 'none'));
} else {
  console.log('version-from-sw: SOP guide manifest already in sync (' + sopFiles.length + ')');
}
