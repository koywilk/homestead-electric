// Drop files on any upload spot (Koy, 2026-10-05) — the accept matching that
// decides whether a dropped file may go to the input it landed on.
// Run: node scripts/file-drop-test.js
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
//
// heDropAccepts / heDropKind are extracted LIVE from src/App.js (balanced
// slice, no hand copy) so the test can't drift from the drop layer.
//
// Pinned:
//  1. The accept strings the app's 17 upload spots actually use: image/*,
//     image/*,application/pdf, the plan-file list with .dwg/.dxf, .json.
//  2. A phone photo the desktop browser gives a blank type (HEIC) still counts
//     as a photo, so a photos-only spot takes it.
//  3. A photos-only spot refuses a PDF; a files spot takes it.
//  4. Extension matching is case-insensitive (PLAN.PDF, IMG_1.JPG).
//  5. The settings restore input (.json) never matches a photo or a PDF.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`could not find ${name} in src/App.js`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const tmp = path.join(__dirname, ".file-drop-fns.tmp.js");
fs.writeFileSync(tmp, `${extract("heDropAccepts")}\n${extract("heDropKind")}\nmodule.exports = { heDropAccepts, heDropKind };\n`);
let heDropAccepts, heDropKind;
try { ({ heDropAccepts, heDropKind } = require(tmp)); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ } }

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };
const f = (name, type = "") => ({ name, type });

const PHOTOS = "image/*";
const PLAN_FILES = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf";
const PUNCH = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf";
const PORTAL = "image/*,application/pdf";

t("photos spot takes a jpeg and a png", () => {
  assert.ok(heDropAccepts(f("IMG_1.JPG", "image/jpeg"), PHOTOS));
  assert.ok(heDropAccepts(f("shot.png", "image/png"), PHOTOS));
});
t("photos spot takes an iPhone HEIC the browser left untyped", () => {
  assert.ok(heDropAccepts(f("IMG_2044.HEIC", ""), PHOTOS));
  assert.ok(heDropAccepts(f("IMG_2044.heif", ""), PHOTOS));
});
t("photos spot refuses a PDF and a spreadsheet", () => {
  assert.ok(!heDropAccepts(f("plans.pdf", "application/pdf"), PHOTOS));
  assert.ok(!heDropAccepts(f("takeoff.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), PHOTOS));
});
t("plan files spot takes PDF by extension (any case), DWG, DXF and photos", () => {
  assert.ok(heDropAccepts(f("PLAN.PDF", "application/pdf"), PLAN_FILES));
  assert.ok(heDropAccepts(f("E1.dwg", ""), PLAN_FILES));
  assert.ok(heDropAccepts(f("site.DXF", "application/octet-stream"), PLAN_FILES));
  assert.ok(heDropAccepts(f("panel.jpg", "image/jpeg"), PLAN_FILES));
});
t("plan files spot refuses a zip and a video", () => {
  assert.ok(!heDropAccepts(f("plans.zip", "application/zip"), PLAN_FILES));
  assert.ok(!heDropAccepts(f("walk.mov", "video/quicktime"), PLAN_FILES));
});
t("punch / GC portal spots match application/pdf by MIME type", () => {
  assert.ok(heDropAccepts(f("rfi.pdf", "application/pdf"), PUNCH));
  assert.ok(heDropAccepts(f("rfi.pdf", "application/pdf"), PORTAL));
  assert.ok(!heDropAccepts(f("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), PORTAL));
});
t("settings restore (.json) never matches a photo or a PDF", () => {
  assert.ok(!heDropAccepts(f("IMG_1.jpg", "image/jpeg"), ".json"));
  assert.ok(!heDropAccepts(f("plans.pdf", "application/pdf"), ".json"));
});
t("an input with no accept takes anything", () => {
  assert.ok(heDropAccepts(f("anything.bin", "application/octet-stream"), ""));
  assert.ok(heDropAccepts(f("anything.bin", ""), undefined));
});
t("a file with no extension and no type only goes to a no-accept spot", () => {
  assert.ok(!heDropAccepts(f("README", ""), PHOTOS));
  assert.ok(!heDropAccepts(f("README", ""), PLAN_FILES));
});
t("heDropKind words the hint: photos-only vs files", () => {
  assert.strictEqual(heDropKind("image/*"), "photos");
  assert.strictEqual(heDropKind("image/png, image/jpeg"), "photos");
  assert.strictEqual(heDropKind(PLAN_FILES), "files");
  assert.strictEqual(heDropKind(""), "files");
});

console.log(`\n${pass} passed`);
