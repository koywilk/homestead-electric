// Plan-intake retry + weekly score tests — run: node scripts/planintake-review-test.js (in the prebuild chain)
// Fixtures are real queue items from 2026-10-30 (filename, sender, the Routine's best guess).
"use strict";
const assert = require("assert");
const R = require("../functions/planIntake/review.js");

const rivers = { filename: "RIVERS_DV_50PERCENTDD_OCt12_SMALL.pdf", subject: "RIVERS_DV_50PERCENTDD_OCt12_SMALL.pdf",
  decision: { bestGuess: "none - new Rivers Residence (Deer Valley), Sausage Space", reason: "Re-checked with #1469 added (Orem cabinetry outlet, unrelated); still no Rivers job" } };
const walton = { filename: "Walton Residence.pdf", decision: { bestGuess: "none - new Walton Residence, Cottages at H.C. Lot 06 (Curtis Design Group)" } };
const brownOld = { filename: "Brown_Panel_Layout - Panel Layout.pdf", from: "jeran.rybal@avsutah.com", decision: { bestGuess: "#1006 (John Brown, Elk Ridge)" } };
const brownNew = { filename: "Brown_Panel_Layout_10-21 - Panel Layout (1).pdf" };
const whitaker = { filename: "Whitaker Farms New Layout 10-16-2026.pdf", decision: { bestGuess: "Q3359 / Q3358" } };
const colors = { filename: "Sunnata Colors.pdf", decision: { bestGuess: "none" } };

// ── Which new job or quote is worth another look? ──
const orem = { key: "#1469", number: "1469", name: "Orem cabinetry outlet" };
assert.deepStrictEqual(R.relatedCandidates(rivers, [orem]), [], "an unrelated new job must not use up a retry, even when the old reason names it");
assert.strictEqual(R.relatedCandidates(rivers, [{ key: "Q3400", number: "3400", name: "Rivers Residence" }]).length, 1, "the Rivers quote reopens Rivers");
assert.strictEqual(R.relatedCandidates(walton, [{ key: "Q3401", number: "3401", name: "New build", site: "Walton Residence" }]).length, 1, "a match on the Simpro site counts");
assert.strictEqual(R.relatedCandidates(walton, [{ key: "Q3402", number: "3402", name: "Addition", address: "12 Cottages Way" }]).length, 1, "a match on the address counts");
assert.strictEqual(R.relatedCandidates(whitaker, [{ key: "Q3359", number: "3359", name: "Lot 12" }]).length, 1, "a number the Routine already guessed counts");
assert.deepStrictEqual(R.relatedCandidates(rivers, [{ key: "Q3208", number: "3208", name: "Pioneer Valley Candy" }]), [], "a shared place word is not the same project");
assert.deepStrictEqual(R.relatedCandidates(colors, [{ key: "Q3403", number: "3403", name: "Residence plans lighting design" }]), [], "words every job shares never match");

// ── May it be reopened? The old counter was burned by unrelated jobs, so it no longer blocks. ──
const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (d) => new Date(NOW - d * 86400e3).toISOString();
const base = { type: "email_pdf", inboxFileId: "f", status: "unmatched", decidedAt: ago(1) };
assert.strictEqual(R.mayReopen({ ...base, reopenCount: 3 }, NOW), true, "items that used all 3 old retries get a fresh start");
assert.strictEqual(R.mayReopen({ ...base, relatedReopenCount: 3 }, NOW), false, "3 related looks is the limit");
assert.strictEqual(R.mayReopen({ ...base, decidedAt: ago(45) }, NOW), true, "a plan can wait weeks for its quote");
assert.strictEqual(R.mayReopen({ ...base, decidedAt: ago(61) }, NOW), false, "past 60 days it stays on the card");
assert.strictEqual(R.mayReopen({ ...base, inboxFileId: "" }, NOW), false, "a link that couldn't be fetched can't be filed");
assert.strictEqual(R.mayReopen({ ...base, type: "walk_unmatched" }, NOW), false);

// ── When Koy files one by hand, its unplaced siblings get another look. ──
assert.strictEqual(R.sameProject(brownOld, brownNew), true, "the earlier Brown layout follows the one Koy filed");
assert.strictEqual(R.sameProject(walton, brownNew), false);
assert.strictEqual(R.sameProject(colors, brownNew), false, "generic words alone are not the same project");

// ── Is a filed plan still where it was put? ──
const inPlace = { number: "1454", note: "#1454 – 2026-10-22 – Plan.pdf" };
assert.strictEqual(R.filedState(inPlace, { name: inPlace.note, trashed: false }, ["MOST UPDATED", "#1454 - Oak Hill 5", "Job Plans"]), "ok");
assert.strictEqual(R.filedState(inPlace, { name: inPlace.note, trashed: true }, ["#1454 - Oak Hill 5"]), "trashed");
assert.strictEqual(R.filedState(inPlace, { name: "Oak Hill plan.pdf", trashed: false }, ["#1454 - Oak Hill 5"]), "renamed");
assert.strictEqual(R.filedState(inPlace, { name: inPlace.note, trashed: false }, ["MOST UPDATED", "#1006 - John Brown"]), "moved");
assert.strictEqual(R.filedState(inPlace, null, []), "gone");
const quote = { number: "3340", note: "Q3340 – 2026-09-09 – Plan.pdf" };
assert.strictEqual(R.filedState(quote, { name: quote.note, trashed: false }, ["MOST UPDATED", "Quote #3340 - Bellini"]), "ok");
assert.strictEqual(R.filedState(quote, { name: quote.note, trashed: false }, ["MOST UPDATED", "#1470 - Bellini"], ["1470"]), "ok", "a quote that became a job moved with its folder");

// ── The weekly score. ──
const item = (id, status, x = {}) => ({ id, type: "email_pdf", inboxFileId: "f" + id, status, createdAt: ago(10), decidedAt: ago(9), ...x });
const rows = [
  item("a", "done", { decision: { number: "1454" }, fileFetchedAt: ago(9) }),
  item("b", "done", { decision: { number: "1454", by: "Koy Wilkinson" } }),
  item("c", "dismissed", { decision: { reason: "commercial" }, decidedAt: ago(2) }),
  item("d", "dismissed", { decision: { by: "Koy Wilkinson" } }),
  item("e", "unmatched", { createdAt: ago(16), reopenCount: 3 }),
  item("f", "unmatched", { createdAt: ago(3), relatedReopenCount: 3 }),
  item("g", "open", { createdAt: ago(1), decidedAt: "" }),
  item("old", "done", { createdAt: ago(90), decidedAt: ago(90), decision: {} }),
];
const s = R.scoreQueue(rows, { now: NOW, days: 30, filedStates: { a: "ok", b: "moved" }, guesses: { b: "#1006" } });
assert.strictEqual(s.total, 7, "the 30-day window plus anything still waiting");
assert.strictEqual(s.filed, 2); assert.strictEqual(s.dismissed, 2); assert.strictEqual(s.unmatched, 2); assert.strictEqual(s.open, 1);
assert.strictEqual(s.byHand, 2, "Koy's own decisions");
assert.strictEqual(s.overrodeGuess, 1, "Koy filed it somewhere other than the Routine's guess");
assert.strictEqual(s.stuck7d, 1, "only the plan waiting more than a week");
assert.strictEqual(s.outOfRetries, 1, "the old counter no longer counts");
assert.strictEqual(s.movedAfterFiling, 1); assert.strictEqual(s.filesChecked, 2);
assert.strictEqual(s.decidedUnopened, 1, "only decisions after the first opened file: c, not the older ones");
assert.deepStrictEqual(R.scoreQueue([], { now: NOW }).total, 0);

console.log("planintake-review-test: all checks passed");
