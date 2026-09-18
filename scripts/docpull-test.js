// Doc-pull planner tests — run: node scripts/docpull-test.js (in the prebuild chain)
"use strict";
const D = require("../functions/docPull.js");
const assert = require("assert");
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

const files = [
  { id: "a", name: "Wise Flooring 09-08-2026.pdf", bytes: 45800000, mime: "application/pdf", folder: "" },
  { id: "b", name: "WiseFlooring05-07-2026.pdf", bytes: 26000000, mime: "application/pdf", folder: "Plans" },
  { id: "c", name: "Gear BOM (6).pdf", bytes: 300000, mime: "application/pdf", folder: "Quotes " },   // Simpro trailing space
  { id: "d", name: "Gear BOM (6).pdf", bytes: 300000, mime: "application/pdf", folder: "Quotes" },    // dupe in source
  { id: "e", name: "  Site/Underground  plan.pdf ", bytes: 900000, mime: "", folder: "Take-offs" },
  { id: "f", name: "", bytes: 1, mime: "", folder: "" },
  null,
];
const plan = D.planDocPull({ files, folders: ["Plans", "Quotes ", "Take-offs", "Empty Folder"], driveFolders: { Plans: "d1" },
  driveFiles: [{ name: "WiseFlooring05-07-2026.pdf", folderName: "Plans" }] });
eq(plan.copies.map(c => c.id), ["a", "c", "e"], "already-in-Drive + duplicate + nameless skipped; others copy");
eq(plan.copies[1].folderName, "Quotes", "folder names are trimmed");
eq(plan.copies[2].name, "Site-Underground plan.pdf", "slashes -> dashes, whitespace collapsed");
eq(plan.copies[2].mime, "application/octet-stream", "missing mime falls back");
eq(plan.skipped.map(s => s.reason), ["already in Drive", "duplicate name in source", "no filename"], "skip reasons");
eq(plan.makeFolders, ["Empty Folder", "Quotes", "Take-offs"], "folders to create = wanted minus existing, incl. EMPTY source folders, sorted");
eq(plan.totalBytes, 45800000 + 300000 + 900000, "total bytes of what will be copied");
eq(D.planDocPull({}).copies, [], "empty plan is safe");
eq(D.planDocPull({ files, driveFiles: files.map(f => f && { name: f.name, folderName: f.folder }).filter(Boolean) }).copies, [], "second run copies nothing");

eq(D.docPullLine({ status: "running", provider: "simpro", done: 14, total: 22, lastFile: "x.pdf" }), "Pulling from Simpro… 14 of 22 · x.pdf", "running line");
eq(D.docPullLine({ status: "done", done: 1, skipped: 0, errors: [] }), "1 file pulled", "done singular");
eq(D.docPullLine({ status: "done", done: 20, skipped: 3, errors: [{ name: "big.pdf" }] }), "20 files pulled · 3 already there · 1 failed", "done with skips + errors");
eq(D.docPullLine({ status: "error", message: "Simpro 401" }), "Pull failed — Simpro 401", "error line");
eq(D.docPullLine(null), "", "null-safe");
console.log("docpull-test ok");
