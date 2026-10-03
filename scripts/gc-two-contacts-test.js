// GC "running this job" — up to TWO contacts (Justin, 2026-10-02: design-build
// jobs have an on-site super AND an office PM, and job setup requires both).
// Run: node scripts/gc-two-contacts-test.js
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
//
// gcContactKey / gcRunningToggle are extracted LIVE from src/App.js (balanced
// slice, no hand copy) so the test can't drift from what the Job Info tab runs.
//
// Pinned:
//  1. One-contact jobs behave byte-for-byte as before (tap marks, tap clears,
//     boxes mirror the pick, clearing leaves typed boxes alone).
//  2. A second tap marks slot 2 and mirrors into gcContact2 / phone2 — it never
//     touches the primary GC Contact / GC Phone boxes the crew calls from.
//  3. A third contact is REFUSED ({full:true}), never swapped in silently.
//  4. Clearing slot 1 PROMOTES slot 2 so the primary boxes never go stale-empty.
//  5. Picks are keyed by the Simpro contact id, so they survive a re-pull that
//     replaces gcContacts wholesale and reorders it.
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
const tmp = path.join(__dirname, ".gc-two-contacts-fns.tmp.js");
fs.writeFileSync(tmp, `${extract("gcContactKey")}\n${extract("gcRunningToggle")}\nmodule.exports = { gcContactKey, gcRunningToggle };\n`);
let gcContactKey, gcRunningToggle;
try { ({ gcContactKey, gcRunningToggle } = require(tmp)); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ } }

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };
const apply = (job, r) => (r.patch ? { ...job, ...r.patch } : job);

const mitch = { id: "11", name: "Mitch Cordner", phone: "385-335-999", email: "mitch@design-build.biz" };
const chad  = { id: "22", name: "Chad Young",    phone: "(801) 995-1833", email: "chad@design-build.biz", primary: true };
const lori  = { id: "33", name: "Lori Williams", phone: "", email: "admin@design-build.biz" };
const fresh = () => ({ gcContacts: [mitch, chad, lori], gcContactLead: "", gcContactLead2: "", gcContact: "", phone: "", gcContact2: "", phone2: "" });

t("tap #1 marks the contact and mirrors into the primary boxes", () => {
  const j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  assert.strictEqual(j.gcContactLead, "11");
  assert.strictEqual(j.gcContact, "Mitch Cordner");
  assert.strictEqual(j.phone, "385-335-999");
  assert.strictEqual(j.gcContactLead2, "");
});

t("tap the lone lead again clears it and leaves the typed boxes alone", () => {
  const one = apply(fresh(), gcRunningToggle(fresh(), "11"));
  const r = gcRunningToggle(one, "11");
  assert.deepStrictEqual(r.patch, { gcContactLead: "" });
});

t("tap #2 fills slot 2 and its own boxes, primary boxes untouched", () => {
  const one = apply(fresh(), gcRunningToggle(fresh(), "11"));
  const two = apply(one, gcRunningToggle(one, "22"));
  assert.strictEqual(two.gcContactLead, "11");
  assert.strictEqual(two.gcContactLead2, "22");
  assert.strictEqual(two.gcContact, "Mitch Cordner");
  assert.strictEqual(two.phone, "385-335-999");
  assert.strictEqual(two.gcContact2, "Chad Young");
  assert.strictEqual(two.phone2, "(801) 995-1833");
});

t("a third contact is refused, nothing changes", () => {
  let j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  j = apply(j, gcRunningToggle(j, "22"));
  const r = gcRunningToggle(j, "33");
  assert.strictEqual(r.full, true);
  assert.strictEqual(r.patch, undefined);
});

t("clearing slot 2 leaves slot 1 and its boxes alone", () => {
  let j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  j = apply(j, gcRunningToggle(j, "22"));
  const after = apply(j, gcRunningToggle(j, "22"));
  assert.strictEqual(after.gcContactLead, "11");
  assert.strictEqual(after.gcContactLead2, "");
  assert.strictEqual(after.gcContact, "Mitch Cordner");
});

t("clearing slot 1 promotes slot 2 into the primary boxes and empties the 2nd boxes", () => {
  let j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  j = apply(j, gcRunningToggle(j, "22"));
  const after = apply(j, gcRunningToggle(j, "11"));
  assert.strictEqual(after.gcContactLead, "22");
  assert.strictEqual(after.gcContactLead2, "");
  assert.strictEqual(after.gcContact, "Chad Young");
  assert.strictEqual(after.phone, "(801) 995-1833");
  assert.strictEqual(after.gcContact2, "");
  assert.strictEqual(after.phone2, "");
});

t("promotion falls back to the 2nd boxes when slot 2's contact left the Simpro list", () => {
  let j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  j = apply(j, gcRunningToggle(j, "22"));
  j = { ...j, gcContacts: [mitch, lori] }; // Chad removed by a later pull
  const after = apply(j, gcRunningToggle(j, "11"));
  assert.strictEqual(after.gcContactLead, "22");
  assert.strictEqual(after.gcContact, "Chad Young");
  assert.strictEqual(after.phone, "(801) 995-1833");
});

t("picks are keyed by Simpro id, so a re-pull that reorders the list changes nothing", () => {
  let j = apply(fresh(), gcRunningToggle(fresh(), "11"));
  j = apply(j, gcRunningToggle(j, "22"));
  j = { ...j, gcContacts: [lori, chad, mitch] };
  assert.strictEqual(gcRunningToggle(j, "22").patch.gcContactLead2, "");
  assert.strictEqual(gcRunningToggle(j, "11").patch.gcContactLead, "22");
});

t("an unknown key is a no-op, not a crash", () => {
  assert.deepStrictEqual(gcRunningToggle(fresh(), "999"), { patch: null });
  assert.deepStrictEqual(gcRunningToggle({}, "1"), { patch: null });
  assert.deepStrictEqual(gcRunningToggle(null, "1"), { patch: null });
});

t("gcContactKey keeps the id > email > name > index fallback the list always used", () => {
  assert.strictEqual(gcContactKey({ id: "7", email: "a@b", name: "N" }, 0), "7");
  assert.strictEqual(gcContactKey({ email: "a@b", name: "N" }, 0), "a@b");
  assert.strictEqual(gcContactKey({ name: "N" }, 0), "N");
  assert.strictEqual(gcContactKey({}, 4), "4");
});

console.log(`\n${pass} passed`);
