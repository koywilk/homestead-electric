// docPull.js — PURE planner for "pull the job's documents out of the
// system-of-record into its Drive folder" (Koy, 2026-09-17: "when I click
// Create a Drive Folder … pull both the subfolders and all the plans out of
// Simpro into that Drive Folder … automatically"). No I/O here: the callable
// in index.js feeds it what Simpro and Drive said and executes the plan.
// Provider-agnostic on purpose (Simpro → Procore, March 2027): the planner
// only sees {id, name, bytes, mime, folder} rows.
"use strict";

// Drive is happy with almost any filename; we only collapse whitespace and
// strip the two characters Drive itself rejects in a name.
function cleanName(s) { return String(s || "").replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim(); }

// planDocPull({ files, folders, driveFolders, driveFiles }) →
//   { makeFolders: [name], copies: [{id, name, bytes, mime, folderName}], skipped: [{name, folderName, reason}], totalBytes }
// - files:        source rows {id, name, bytes, mime, folder ("" = root)}
// - folders:      source folder names (so EMPTY folders still get made)
// - driveFolders: {name → driveId} of subfolders already under the job folder
// - driveFiles:   [{name, folderName}] already in Drive (folderName "" = root)
// Dedupe is by cleaned filename WITHIN a folder — a second run only fills gaps.
// Duplicate names inside one source folder keep the first (Simpro allows dupes).
function planDocPull({ files = [], folders = [], driveFolders = {}, driveFiles = [] } = {}) {
  const have = new Set((driveFiles || []).map(f => `${cleanName(f.folderName)}/${cleanName(f.name)}`));
  const seen = new Set();
  const copies = [], skipped = [];
  let totalBytes = 0;
  for (const f of files || []) {
    if (!f || !f.id) continue;
    const name = cleanName(f.name), folderName = cleanName(f.folder);
    if (!name) { skipped.push({ name: String(f.name || f.id), folderName, reason: "no filename" }); continue; }
    const key = `${folderName}/${name}`;
    if (have.has(key)) { skipped.push({ name, folderName, reason: "already in Drive" }); continue; }
    if (seen.has(key)) { skipped.push({ name, folderName, reason: "duplicate name in source" }); continue; }
    seen.add(key);
    copies.push({ id: f.id, name, bytes: Number(f.bytes) || 0, mime: f.mime || "application/octet-stream", folderName });
    totalBytes += Number(f.bytes) || 0;
  }
  const wantFolders = new Set([...(folders || []).map(cleanName), ...copies.map(c => c.folderName)].filter(Boolean));
  const makeFolders = [...wantFolders].filter(n => !driveFolders || !driveFolders[n]).sort();
  return { makeFolders, copies, skipped, totalBytes };
}

// The one-line status the app shows under the Drive section.
function docPullLine(p) {
  if (!p || !p.status) return "";
  const n = (x) => Number(x) || 0;
  if (p.status === "running") return `Pulling from ${p.provider === "procore" ? "Procore" : "Simpro"}… ${n(p.done)} of ${n(p.total)}${p.lastFile ? ` · ${p.lastFile}` : ""}`;
  if (p.status === "done") {
    const bits = [`${n(p.done)} file${n(p.done) === 1 ? "" : "s"} pulled`];
    if (n(p.skipped)) bits.push(`${n(p.skipped)} already there`);
    if (Array.isArray(p.errors) && p.errors.length) bits.push(`${p.errors.length} failed`);
    return bits.join(" · ");
  }
  if (p.status === "error") return `Pull failed — ${p.message || "unknown error"}`;
  return "";
}

module.exports = { planDocPull, docPullLine, cleanName };
