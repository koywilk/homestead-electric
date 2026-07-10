// Prebuild: bake the service-worker CACHE version into the bundle as
// REACT_APP_VERSION, so the running app knows exactly which build it is
// (the SW itself can't be asked — skipWaiting means the NEW worker takes
// over while an OLD bundle is still running, so it would lie).
// Runs automatically via the "prebuild" npm script on every `npm run build`
// (Vercel included). The SW bump stays the single version to maintain.
const fs = require('fs');
const path = require('path');
const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
const m = sw.match(/CACHE\s*=\s*"([^"]+)"/);
if (!m) { console.error('version-from-sw: CACHE const not found in public/service-worker.js'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '..', '.env.production.local'), `REACT_APP_VERSION=${m[1]}\n`);
console.log('version-from-sw: baked', m[1]);
