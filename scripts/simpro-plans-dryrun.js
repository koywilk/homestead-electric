#!/usr/bin/env node
/* simpro-plans-dryrun.js — DRY RUN for "pull plans from Simpro into the job's
 * Drive folder" (Koy, 2026-09-17). Lists a Simpro job's attachment folders and
 * files with sizes, groups them the way they would land in Drive, and reports
 * the largest file + totals so we learn Simpro's real ceilings before building
 * the Cloud Function. READ-ONLY: never downloads bytes, never writes anywhere.
 * Reads SIMPRO_TOKEN / SIMPRO_BASE out of functions/index.js so it can't drift.
 *   node scripts/simpro-plans-dryrun.js <simproJobNo> [--json]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
const TOKEN = (src.match(/const SIMPRO_TOKEN = "([^"]+)"/) || [])[1];
const BASE  = (src.match(/const SIMPRO_BASE  = "([^"]+)"/) || [])[1];
if (!TOKEN || !BASE) { console.error("could not read SIMPRO_TOKEN / SIMPRO_BASE from functions/index.js"); process.exit(1); }
const jobNo = process.argv[2];
const asJson = process.argv.includes("--json");
if (!jobNo) { console.error("usage: node scripts/simpro-plans-dryrun.js <simproJobNo> [--json]"); process.exit(1); }

// Same shape as functions/index.js simproReqWithRetry: 429/5xx → backoff, up to 5 tries.
async function get(p, attempt = 1) {
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
  if ((r.status === 429 || r.status >= 500) && attempt < 5) {
    const ra = Number(r.headers.get("retry-after"));
    await new Promise(res => setTimeout(res, (ra > 0 ? ra * 1000 : Math.min(15000, 1000 * 2 ** (attempt - 1))) + Math.random() * 400));
    return get(p, attempt + 1);
  }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const mb = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
// Simpro's Base64 transfer inflates ~4/3; a 2 GB function comfortably holds
// files well past this — the flag is informational until we learn Simpro's own ceiling.
const FLAG_BYTES = 100 * 1024 * 1024;

(async () => {
  const job = await get(`/jobs/${jobNo}`);
  if (job.status !== 200) { console.error(`job ${jobNo}: HTTP ${job.status}`, typeof job.data === "string" ? job.data.slice(0, 200) : job.data); process.exit(1); }
  const jobName = job.data.Name || job.data.Site?.Name || job.data.Description || "";
  const [filesRes, foldersRes] = await Promise.all([get(`/jobs/${jobNo}/attachments/files/`), get(`/jobs/${jobNo}/attachments/folders/`)]);
  const list = Array.isArray(filesRes.data) ? filesRes.data : [];
  const folders = Array.isArray(foldersRes.data) ? foldersRes.data : [];
  // The list endpoint is ID+Filename only; size/folder/mime live on the detail
  // call — one request per file, sequential to respect ~60 req/min.
  const files = [];
  for (const f of list) {
    const d = await get(`/jobs/${jobNo}/attachments/files/${f.ID}`);
    if (d.status !== 200 || !d.data || typeof d.data !== "object") { files.push({ id: f.ID, name: f.Filename, error: `HTTP ${d.status}` }); continue; }
    const x = d.data;
    files.push({ id: x.ID, name: x.Filename, bytes: Number(x.FileSizeBytes) || 0, mime: x.MimeType || "", folder: (x.Folder && x.Folder.Name) ? String(x.Folder.Name).trim() : "", folderId: x.Folder && x.Folder.ID, added: x.DateAdded, by: x.AddedBy && x.AddedBy.Name });
  }
  const byFolder = new Map();
  for (const f of files) { const k = f.folder || "(root)"; if (!byFolder.has(k)) byFolder.set(k, []); byFolder.get(k).push(f); }
  const ok = files.filter(f => !f.error);
  const total = ok.reduce((n, f) => n + f.bytes, 0);
  const largest = ok.slice().sort((a, b) => b.bytes - a.bytes)[0] || null;
  const flagged = ok.filter(f => f.bytes > FLAG_BYTES);
  const dupNames = [...ok.reduce((m, f) => m.set(f.name, (m.get(f.name) || 0) + 1), new Map())].filter(([, n]) => n > 1).map(([n]) => n);
  const report = { simproJobNo: jobNo, jobName, folders: folders.map(f => f.Name), files: files.length, errors: files.filter(f => f.error).length,
    totalBytes: total, largest: largest && { name: largest.name, bytes: largest.bytes, folder: largest.folder }, flaggedOver100MB: flagged.map(f => f.name),
    duplicateNames: dupNames, tree: Object.fromEntries([...byFolder.entries()].map(([k, fs]) => [k, fs.map(f => ({ name: f.name, bytes: f.bytes, mime: f.mime }))])) };
  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Simpro job ${jobNo} — ${jobName}`);
  console.log(`Folders in Simpro: ${folders.length ? folders.map(f => `"${f.Name.trim()}"`).join(", ") : "(none)"}`);
  console.log(`Files: ${files.length} (${report.errors} unreadable) · total ${mb(total)} · largest ${largest ? `${mb(largest.bytes)} — ${largest.name}` : "n/a"}`);
  console.log(`Over 100 MB: ${flagged.length ? flagged.map(f => f.name).join(", ") : "none"} · duplicate filenames: ${dupNames.length ? dupNames.join(", ") : "none"}`);
  console.log("Would land in Drive as:");
  for (const [k, fs] of [...byFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${k === "(root)" ? "<job folder>" : k + "/"}  (${fs.length} files, ${mb(fs.reduce((n, f) => n + (f.bytes || 0), 0))})`);
    for (const f of fs.slice().sort((a, b) => a.name.localeCompare(b.name))) console.log(`     ${f.error ? "!! " : ""}${f.name}  ${f.error || mb(f.bytes)}${f.mime && f.mime !== "application/pdf" ? "  [" + f.mime + "]" : ""}`);
  }
})().catch(e => { console.error("dry run failed:", e.message); process.exit(1); });
