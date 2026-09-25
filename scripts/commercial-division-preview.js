#!/usr/bin/env node
/* commercial-division-preview.js — READ-ONLY preview of what Settings → COMMERCIAL
 * DIVISION → "Check divisions against Simpro" will list. Writes NOTHING (no
 * Firestore, no Simpro): it reads the app's jobs (name, Simpro #, division) over the
 * Firestore REST API (jobs are world-readable per firestore.rules), reads each job's
 * "Business Group" custom field from Simpro, and prints the jobs whose app
 * division disagrees with Simpro — i.e. the ones that would move if you tap Apply.
 *
 * Run from the repo root on a machine that can reach Simpro (Koy's Mac):
 *   node scripts/commercial-division-preview.js
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
  for (const j of jobs) {
    const bg = await businessGroup(j.simproNo); await sleep(350);
    if (bg.error) { errors.push(`${j.name} (#${j.simproNo}) — Simpro ${bg.error}`); continue; }
    const hint = bg.value ? (COMM_GROUPS.includes(bg.value.toLowerCase()) ? "commercial" : "resi") : "";
    const appDiv = j.division === "commercial" ? "commercial" : "resi";
    const line = `${j.name || "(unnamed)"}  #${j.simproNo}  foreman: ${j.foreman || "—"}  Business Group: ${bg.value || "(unset)"}`;
    if (!hint) unknown.push(line);
    else if (hint !== appDiv) (hint === "commercial" ? toCommercial : toResi).push(line);
  }
  console.log(`WOULD MOVE TO COMMERCIAL (${toCommercial.length}):`); toCommercial.forEach(l => console.log("  " + l));
  console.log(`\nWOULD MOVE TO RESIDENTIAL (${toResi.length}):`); toResi.forEach(l => console.log("  " + l));
  console.log(`\nNo Business Group set in Simpro — stays where it is (${unknown.length}):`); unknown.forEach(l => console.log("  " + l));
  if (errors.length) { console.log(`\nCouldn't read (${errors.length}):`); errors.forEach(l => console.log("  " + l)); }
  console.log(`\nNothing was written. Everything else (${jobs.length - toCommercial.length - toResi.length - unknown.length - errors.length}) already matches Simpro.`);
})().catch(e => { console.error("preview failed:", e && e.message); process.exit(1); });
