#!/usr/bin/env node
/**
 * gen-sync-dryrun.js — READ-ONLY dry run of the generator auto-sync.
 *
 * Runs the EXACT `reconcileGenLoads` / `flattenHomeRuns` from src/App.js
 * (extracted live from the source, not a hand copy) against real job data and
 * reports precisely what the sync WOULD change — without writing anything.
 *
 * The point: see the blast radius before a single write ever happens. The
 * headline check is "loads that would DISAPPEAR" — it MUST be 0, because
 * reconcile is designed to flag orphans, never delete.
 *
 * Usage:
 *   node scripts/gen-sync-dryrun.js --key ~/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json [--job <id>] [--limit N]
 *     --key <path>   service-account JSON (or set GOOGLE_APPLICATION_CREDENTIALS)
 *     --job <id>     one job — prints a per-load fate table
 *     --limit N      scan mode: first N homeowner_requests with genLoads (default 30)
 *
 * READ-ONLY. It never calls set/update/delete. It cannot modify Firestore.
 */
const path = require("path");
const fs = require("fs");
let admin;
try { admin = require("firebase-admin"); }
catch { admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }

const PROJECT_ID = "homestead-electric";
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  if (next === undefined || String(next).startsWith("--")) return true;
  return next;
};
const keyPath = arg("key", process.env.GOOGLE_APPLICATION_CREDENTIALS);
const oneJob = arg("job");
const limit = parseInt(arg("limit", "30"), 10);
if (!keyPath) { console.error("Missing --key (service-account JSON). See header."); process.exit(1); }

// ── Load the real shipping functions from src/App.js by extracting their exact
//    source (brace-balanced) into a temp CommonJS module and requiring it. No
//    eval / new Function — the temp file is written, required, then deleted. ──
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`could not find ${name} in src/App.js`);
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (depth === 0) break; } }
  return src.slice(start, i + 1);
}
const tmp = path.join(__dirname, ".gen-sync-fns.tmp.js");
fs.writeFileSync(tmp,
  `let _n = 0;\nfunction uid() { return "NEW#" + (++_n); }\n` +
  `${extract("flattenHomeRuns")}\n${extract("reconcileGenLoads")}\n` +
  `module.exports = { flattenHomeRuns, reconcileGenLoads };\n`);
const { reconcileGenLoads } = require(tmp);
process.on("exit", () => { try { fs.unlinkSync(tmp); } catch {} });

// ── Diff one job's genLoads: current vs. what reconcile would produce ──
function diffJob(homeRuns, genLoads) {
  const before = Array.isArray(genLoads) ? genLoads : [];
  const after = reconcileGenLoads(homeRuns || {}, before);
  const afterById = new Map(after.map(l => [l.id, l]));
  const rows = [];
  let added = 0, orphanedNew = 0, refreshed = 0, unchanged = 0, disappeared = 0, droppedSelected = 0, decisionChanged = 0;
  before.forEach(b => {
    const a = afterById.get(b.id);
    if (!a) {
      const sel = !!b.included || b.status === 'chosen';
      disappeared++;
      if (sel) { droppedSelected++; rows.push({ name: b.name, fate: "DROPPED but was homeowner-SELECTED (!!)" }); }
      else rows.push({ name: b.name, fate: "dropped (stale — not in Home Runs)" });
      return;
    }
    if (!!a.included !== !!b.included || !!a.recommended !== !!b.recommended || !!a.confirmed !== !!b.confirmed || a.priority !== b.priority || a.status !== b.status) decisionChanged++;
    const mirrorChanged = a.name !== b.name || (a.wire || "") !== (b.wire || "") || !!a.v240 !== !!b.v240 || !!a.needsSpecs !== !!b.needsSpecs || a.hrId !== b.hrId;
    if (!!a.orphaned && !b.orphaned) { orphanedNew++; rows.push({ name: b.name, fate: "flag ORPHANED (kept — keep/drop)" }); }
    else if (mirrorChanged) {
      const w = [];
      if (a.hrId !== b.hrId) w.push("hrId");
      if (a.name !== b.name) w.push("name");
      if ((a.wire || "") !== (b.wire || "")) w.push("wire");
      if (!!a.v240 !== !!b.v240) w.push("v240");
      if (!!a.needsSpecs !== !!b.needsSpecs) w.push("needsSpecs");
      refreshed++; rows.push({ name: b.name, fate: "refresh " + w.join(",") });
    } else unchanged++;
  });
  after.forEach(a => { if (String(a.id).startsWith("NEW#")) { added++; rows.push({ name: a.name, fate: "NEW (added OFF)" }); } });
  return { before: before.length, after: after.length, added, orphanedNew, refreshed, unchanged, disappeared, droppedSelected, decisionChanged, rows };
}

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))), projectId: PROJECT_ID });
  const db = admin.firestore();
  const getHomeRuns = (jobSnap) => { const d = jobSnap.data() || {}; return (d.data && d.data.homeRuns) || d.homeRuns || {}; };
  const getGenLoads = (hrSnap) => { const d = hrSnap.data() || {}; return d.genLoads || (d.data && d.data.genLoads) || []; };

  const jobsToScan = [];
  if (oneJob && oneJob !== true) jobsToScan.push(oneJob);
  else {
    const q = await db.collection("homeowner_requests").limit(500).get();
    q.forEach(doc => { const gl = getGenLoads(doc); if (Array.isArray(gl) && gl.length) jobsToScan.push(doc.id); });
    jobsToScan.splice(limit);
  }
  console.log(`\nDRY RUN — generator auto-sync against ${jobsToScan.length} job(s) with genLoads. READ-ONLY.\n`);

  let totDropped = 0, totDroppedSel = 0, totDecision = 0, totAdded = 0, totOrphan = 0, totRefresh = 0, jobsChanged = 0;
  for (const id of jobsToScan) {
    const [jobSnap, hrSnap] = await Promise.all([db.doc(`jobs/${id}`).get(), db.doc(`homeowner_requests/${id}`).get()]);
    if (!jobSnap.exists) { console.log(`  ${id}: (no job doc — skipped)`); continue; }
    const r = diffJob(getHomeRuns(jobSnap), getGenLoads(hrSnap));
    totDropped += r.disappeared; totDroppedSel += r.droppedSelected; totDecision += r.decisionChanged; totAdded += r.added; totOrphan += r.orphanedNew; totRefresh += r.refreshed;
    if (r.added + r.orphanedNew + r.refreshed + r.disappeared + r.decisionChanged) jobsChanged++;
    const flag = (r.droppedSelected || r.decisionChanged) ? "  <-- REVIEW" : "";
    console.log(`  ${id}: ${r.before}->${r.after} loads | +${r.added} new, ${r.refreshed} refreshed, ${r.orphanedNew} kept-flagged | dropped=${r.disappeared} (selected=${r.droppedSelected}) decisions-changed=${r.decisionChanged}${flag}`);
    if (oneJob && oneJob !== true) r.rows.forEach(row => console.log(`       - ${String(row.name || "(unnamed)").padEnd(30)} ${row.fate}`));
  }

  console.log("\n-------- SUMMARY (pure-mirror: gen list = Home Runs) --------");
  console.log(`jobs scanned:        ${jobsToScan.length}`);
  console.log(`jobs that'd change:  ${jobsChanged}`);
  console.log(`new rows added:      ${totAdded}  (home-run circuits not yet on the gen list, added OFF)`);
  console.log(`rows refreshed:      ${totRefresh}  (mirror fields: name/wire/v240/needsSpecs/hrId)`);
  console.log(`stale loads DROPPED: ${totDropped}  (not in Home Runs — intended)`);
  console.log(`selected non-matches KEPT+flagged: ${totOrphan}  (homeowner picks not in Home Runs — kept for review, never dropped)`);
  console.log(`\nSAFETY CHECKS (both MUST be 0):`);
  console.log(`  homeowner-SELECTED loads dropped:  ${totDroppedSel}  ${totDroppedSel === 0 ? "OK - no real pick lost" : "*** a homeowner pick would drop - REVIEW ***"}`);
  console.log(`  human decisions that would change: ${totDecision}  ${totDecision === 0 ? "OK - all preserved" : "*** selections altered - REVIEW ***"}`);
  console.log(`\nREAD-ONLY — nothing in Firestore was modified.`);
  process.exit(totDroppedSel === 0 && totDecision === 0 ? 0 : 2);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
