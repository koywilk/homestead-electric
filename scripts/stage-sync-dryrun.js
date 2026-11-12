#!/usr/bin/env node
/* stage-sync-dryrun.js — what the app → Simpro stage sync WOULD do tonight,
 * against the live jobs and live Simpro. Read-only unless --set-one is given.
 *
 *   node scripts/stage-sync-dryrun.js              the whole plan, nothing written
 *   node scripts/stage-sync-dryrun.js --json       same, as JSON
 *   node scripts/stage-sync-dryrun.js --set-one=889
 *        writes ONE job's planned status to Simpro (the same PATCH the live
 *        sync sends) and reads it back. For proving the write on a job Koy named.
 *
 * Uses the same pure planner the function ships with (functions/stageSync.js).
 * Never writes Firestore.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const admin = require(path.join(root, "functions", "node_modules", "firebase-admin"));
const SA_PATH = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)), projectId: "homestead-electric" });
const db = admin.firestore();
const S = require(path.join(root, "functions", "stageSync.js"));
// Simpro token/base are read from functions/index.js at runtime (same as strategyprep-dryrun.js)
// so the credential is never copied into a second file.
const fnSrc = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const SIMPRO_TOKEN = (fnSrc.match(/const SIMPRO_TOKEN = "([^"]+)"/) || [])[1];
const SIMPRO_BASE  = (fnSrc.match(/const SIMPRO_BASE  = "([^"]+)"/) || [])[1];
if (!SIMPRO_TOKEN || !SIMPRO_BASE) { console.error("could not read SIMPRO_TOKEN / SIMPRO_BASE from functions/index.js"); process.exit(1); }
const H = { Authorization: `Bearer ${SIMPRO_TOKEN}`, "Content-Type": "application/json" };

const arg = (name) => { const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`)); return a ? (a.includes("=") ? a.split("=")[1] : true) : null; };

async function simproOpenJobs() {
  const out = {};
  for (const stage of S.OPEN_SIMPRO_STAGES) {
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${SIMPRO_BASE}/jobs/?Stage=${stage}&columns=ID,Name,Stage,Status&pageSize=250&page=${page}`, { headers: H });
      if (!r.ok) throw new Error(`Simpro ${stage} job list failed on page ${page}: ${r.status}`);
      const rows = await r.json();
      rows.forEach(x => { out[String(x.ID)] = x; });
      if (rows.length < 250) break;
    }
  }
  return out;
}

(async () => {
  const snap = await db.collection("jobs").select("data.name", "data.type", "data.archived", "data.archivedAt", "data.deleted", "data.simproNo",
    "data.division", "data.quickJob", "data.tempPed", "data.roughStatus", "data.roughStage", "data.roughOnHold",
    "data.finishStatus", "data.finishStage", "data.finishOnHold", "data.finishPunchList", "data.finishPunch", "data.qcPunch",
    "data.finalInspectionResult", "data.finalInspectionItems", "data.returnTrips",
    "data.prepStage", "data.prepOverride", "data.prepChecklist", "data.prepNA").get();
  const jobs = snap.docs.map(d => ({ id: d.id, ...((d.data() || {}).data || {}) }));
  const open = await simproOpenJobs();
  const pr = await fetch(`${SIMPRO_BASE}/setup/statusCodes/projects/?pageSize=250&columns=ID,Name,Priority`, { headers: H });
  const priorities = S.priorityMap(pr.ok ? await pr.json() : []);
  const plan = S.planAll(jobs, open, priorities);

  const one = arg("set-one");
  if (one) {
    const r = plan.rows.find(x => x.sn === String(one));
    if (!r) { console.error(`no synced app job carries Simpro #${one}`); process.exit(1); }
    console.log(`#${r.sn} ${r.name}: ${r.action}${r.action === "set" ? ` "${r.fromName}" → "${r.toName}"${r.downhill ? "  (down Simpro's status order: Simpro is expected to refuse)" : ""}` : r.reason ? ` (${r.reason})` : ""}`);
    if (r.action !== "set") process.exit(0);
    const w = await fetch(`${SIMPRO_BASE}/jobs/${encodeURIComponent(r.sn)}`, { method: "PATCH", headers: H, body: JSON.stringify({ Status: r.toId }) });
    const text = await w.text();
    console.log(`PATCH → ${w.status}${S.isPriorityBlock(w.status, text) ? "  BLOCKED: " + S.blockedNote(r) : text ? "  " + text.slice(0, 200) : ""}`);
    const back = await (await fetch(`${SIMPRO_BASE}/jobs/${encodeURIComponent(r.sn)}?columns=ID,Stage,Status,AutoAdjustStatus`, { headers: H })).json();
    console.log(`Simpro now says: "${(back.Status && back.Status.Name) || "(no status)"}"   Auto Adjust: ${back.AutoAdjustStatus ? "on" : "off"}`);
    process.exit(0);
  }

  if (arg("json")) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const sets = plan.rows.filter(r => r.action === "set"), conflicts = plan.rows.filter(r => r.conflict), skips = plan.rows.filter(r => r.action === "skip" && !r.conflict);
  console.log(`app jobs read: ${jobs.length}   Simpro open jobs: ${Object.keys(open).length}   looked at: ${plan.rows.length}`);
  console.log(`would change: ${plan.counts.set} (${plan.counts.downhill} of them Simpro will refuse until moved by hand)   already match: ${plan.counts.same}   skipped: ${plan.counts.skip} (${plan.counts.conflict} need a person)   in Simpro only: ${plan.counts.simproOnly}`);
  console.log(`\nWOULD CHANGE IN SIMPRO (${sets.length})`);
  sets.forEach(r => console.log(`  #${pad(r.sn, 5)} ${pad(r.name, 34)} ${pad(r.fromName, 30)} → ${pad(r.toName, 26)} ${r.downhill ? "BY HAND " : ""}(${r.section})`));
  console.log(`\nNEEDS A PERSON (${conflicts.length})`);
  conflicts.forEach(r => console.log(`  #${pad(r.sn || "—", 5)} ${pad(r.name, 34)} ${r.reason}`));
  console.log(`\nSKIPPED, NOTHING TO DO (${skips.length})`);
  const by = {}; skips.forEach(r => { by[r.reason] = (by[r.reason] || 0) + 1; });
  Object.entries(by).forEach(([k, n]) => console.log(`  ${n} × ${k}`));
  console.log(`\nIN PROGRESS IN SIMPRO, NO APP JOB (${plan.simproOnly.length})`);
  plan.simproOnly.forEach(r => console.log(`  #${pad(r.sn, 5)} ${pad(r.name, 40)} ${r.status}`));
  process.exit(0);
})().catch(e => { console.error("stage-sync-dryrun failed:", e.message); process.exit(1); });
