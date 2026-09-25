#!/usr/bin/env node
/* commercial-division-preview.js — READ-ONLY preview of what Settings → COMMERCIAL
 * DIVISION → "Check divisions against Simpro" will list. Writes NOTHING (no
 * Firestore, no Simpro): it reads the app's jobs (name, Simpro #, division) over the
 * Firestore REST API (jobs are world-readable per firestore.rules), reads each job's
 * "Business Group" custom field from Simpro, and prints the jobs whose app
 * division disagrees with Simpro — i.e. the ones that would move if you tap Apply.
 *
 * Run from the repo root on a machine that can reach Simpro (Koy's Mac):
 *   node scripts/commercial-division-preview.js            # preview only, writes nothing
 *   node scripts/commercial-division-preview.js --apply    # ALSO moves the "would move to
 *                                                          # commercial" jobs (Koy 2026-09-25:
 *                                                          # "auto pull the commercial jobs …
 *                                                          # so i dont have to do it manually")
 *   node scripts/commercial-division-preview.js --apply --resi-too   # and the resi moves
 * --apply writes exactly what the Settings "Apply" button writes: `division` alone inside
 * the job's `data` (plus `updated_at`), as a Firestore REST PATCH with an updateMask, so no
 * other field on the job is touched and the open app picks the change up live. It never
 * creates a doc (currentDocument.exists precondition) and never writes to Simpro.
 * Token: SIMPRO_TOKEN env var wins; otherwise read from functions/index.js.
 * Paces itself (~3 req/s) to stay under Simpro's per-token rate limit.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const BASE = process.env.SIMPRO_BASE || "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const PROJECT = "homestead-electric";
let TOKEN = process.env.SIMPRO_TOKEN || "";
if (!TOKEN) { try { const m = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8").match(/const SIMPRO_TOKEN\s*=\s*"([^"]+)"/); if (m) TOKEN = m[1]; } catch {} }
if (!TOKEN) { console.error("No SIMPRO_TOKEN (env) and none found in functions/index.js"); process.exit(1); }
const API_KEY = (() => { try { const m = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8").match(/apiKey:\s*"([^"]+)"/); return m ? m[1] : ""; } catch { return ""; } })();
// Same default the app uses (config/app.commercialBusinessGroups overrides it in prod).
const COMM_GROUPS = (process.env.COMM_GROUPS || "commercial,multi family").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const APPLY = process.argv.includes("--apply");
const RESI_TOO = process.argv.includes("--resi-too");
const FS_DOC = (id) => `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/jobs/${encodeURIComponent(id)}`;

// Mirrors the app's Settings → COMMERCIAL DIVISION → Apply: `division` = "commercial" or ""
// ("" reads as residential, same as the button). updateMask limits the write to that one
// nested field + updated_at; the doc keeps `data` (map) + `updated_at` (string), which is
// all firestore.rules asks of a jobs write.
async function setDivision(id, v) {
  const url = `${FS_DOC(id)}?updateMask.fieldPaths=data.division&updateMask.fieldPaths=updated_at&currentDocument.exists=true` + (API_KEY ? `&key=${API_KEY}` : "");
  const body = { fields: { data: { mapValue: { fields: { division: { stringValue: v } } } }, updated_at: { stringValue: new Date().toISOString() } } };
  const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function listJobs() {
  const out = []; let pageToken = "";
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/jobs?pageSize=300` +
      `&mask.fieldPaths=data.name&mask.fieldPaths=data.simproNo&mask.fieldPaths=data.division&mask.fieldPaths=data.type&mask.fieldPaths=data.archived&mask.fieldPaths=data.deleted&mask.fieldPaths=data.foreman` +
      (API_KEY ? `&key=${API_KEY}` : "") + (pageToken ? `&pageToken=${pageToken}` : "");
    const r = await fetch(url); if (!r.ok) throw new Error(`Firestore ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    (j.documents || []).forEach(d => {
      const f = ((d.fields || {}).data || {}).mapValue; const v = (f && f.fields) || {};
      const s = (k) => (v[k] && (v[k].stringValue ?? (v[k].integerValue != null ? String(v[k].integerValue) : ""))) || "";
      const b = (k) => !!(v[k] && v[k].booleanValue);
      out.push({ id: d.name.split("/").pop(), name: s("name"), simproNo: s("simproNo"), division: s("division"), type: s("type"), foreman: s("foreman"), archived: b("archived") || b("deleted") });
    });
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function businessGroup(simproNo) {
  const r = await fetch(`${BASE}/jobs/${encodeURIComponent(simproNo)}/customFields/`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
  if (r.status === 429) { await sleep(2000); return businessGroup(simproNo); }
  if (!r.ok) return { error: r.status };
  const rows = await r.json();
  const bg = (Array.isArray(rows) ? rows : []).find(x => x && x.CustomField && /^business\s*group$/i.test(String(x.CustomField.Name || "").trim()));
  return { value: bg && bg.Value != null ? String(bg.Value).trim() : "" };
}

(async () => {
  const jobs = (await listJobs()).filter(j => j.simproNo && j.type !== "quote" && !j.archived);
  console.log(`${jobs.length} app jobs with a Simpro # (quotes / archived skipped). Reading each job's Business Group from Simpro…\n`);
  const toCommercial = [], toResi = [], unknown = [], errors = [];
  const moveComm = [], moveResi = [];   // job ids behind the two "would move" lists
  for (const j of jobs) {
    const bg = await businessGroup(j.simproNo); await sleep(350);
    if (bg.error) { errors.push(`${j.name} (#${j.simproNo}) — Simpro ${bg.error}`); continue; }
    const hint = bg.value ? (COMM_GROUPS.includes(bg.value.toLowerCase()) ? "commercial" : "resi") : "";
    const appDiv = j.division === "commercial" ? "commercial" : "resi";
    const line = `${j.name || "(unnamed)"}  #${j.simproNo}  foreman: ${j.foreman || "—"}  Business Group: ${bg.value || "(unset)"}`;
    if (!hint) unknown.push(line);
    else if (hint !== appDiv) { (hint === "commercial" ? toCommercial : toResi).push(line); (hint === "commercial" ? moveComm : moveResi).push(j.id); }
  }
  console.log(`WOULD MOVE TO COMMERCIAL (${toCommercial.length}):`); toCommercial.forEach(l => console.log("  " + l));
  console.log(`\nWOULD MOVE TO RESIDENTIAL (${toResi.length}):`); toResi.forEach(l => console.log("  " + l));
  console.log(`\nNo Business Group set in Simpro — stays where it is (${unknown.length}):`); unknown.forEach(l => console.log("  " + l));
  if (errors.length) { console.log(`\nCouldn't read (${errors.length}):`); errors.forEach(l => console.log("  " + l)); }
  console.log(`\nEverything else (${jobs.length - toCommercial.length - toResi.length - unknown.length - errors.length}) already matches Simpro.`);
  if (!APPLY) { console.log("Nothing was written (preview only). Re-run with --apply to move the commercial jobs."); return; }
  const plan = [...moveComm.map(id => [id, "commercial"]), ...(RESI_TOO ? moveResi.map(id => [id, ""]) : [])];
  if (!plan.length) { console.log("\n--apply: nothing to move."); return; }
  console.log(`\n--apply: writing division on ${plan.length} job${plan.length === 1 ? "" : "s"}${RESI_TOO ? " (commercial + residential moves)" : " (commercial moves only; add --resi-too for the residential ones)"}…`);
  let ok = 0;
  for (const [id, v] of plan) {
    try { await setDivision(id, v); ok++; }
    catch (e) { console.log(`  FAILED ${id}: ${e.message}`); }
  }
  console.log(`--apply: ${ok}/${plan.length} written. Open the app in COMMERCIAL mode — they are on the Job Board now (Settings → COMMERCIAL DIVISION → Check should list ${RESI_TOO || !moveResi.length ? "nothing" : "only the residential moves"}).`);
})().catch(e => { console.error("preview failed:", e && e.message); process.exit(1); });
