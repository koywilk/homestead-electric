// Office messages tabs + Temp Peds Out (v514) — regression tests.
// Run: node scripts/office-msgs-peds-test.js   Exit 0 = all pass. Wired into prebuild.
//
// The helpers are extracted LIVE from src/App.js (brace-balanced slice, the
// gen-selection-test recipe), so the test can't drift from the app.
//  1. bcGroupMessages — one row per office message from its bell copies, and the
//     ONE "needs you" rule the bell, My Day tabs and pins share.
//  2. tempPedGroups — which peds are out, one row per physical ped, auto-clear
//     from a completed pickup quick job, Undo, duplicates, days out.
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
const names = ["parseAnyDate", "bcGroupMessages", "bcTabOrder", "bcNeedLabel",
  "tpToday", "tpAddrKey", "tpLive", "tpOnJob", "tpPickupDone", "tempPedGroups", "tpNeedsLook"];
const body = [
  'const BC_KINDS = { announcement: {}, important: {}, discussion: {} };',
  'const bcKindOf = (k) => (BC_KINDS[k] ? k : "announcement");',
  'const stripEmoji = (s) => String(s || "");',
  ...names.map(extract),
  `module.exports = { ${names.join(", ")} };`,
].join("\n");
const tmp = path.join(__dirname, ".office-msgs-peds-fns.tmp.js");
fs.writeFileSync(tmp, body);
let F;
try { F = require(tmp); } finally { fs.unlinkSync(tmp); }

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok ", name); };

// ── 1. Office messages ────────────────────────────────────────────────────
const at = (m) => `2026-10-06T${String(m).padStart(2, "0")}:00:00Z`;
t("one row per message: original + reminder + replies merge, tests drop out", () => {
  const rows = F.bcGroupMessages([
    { id: "a1", broadcastId: "bc_ppe", kind: "important", headline: "PPE rule", body: "Hard hats", from: "Josh", createdAt: at(7), read: true },
    { id: "a2", broadcastId: "bc_ppe", kind: "important", reminder: true, body: "Still needs your Got it.", createdAt: at(9), read: false },
    { id: "b1", broadcastId: "bc_thx", kind: "discussion", headline: "Thanksgiving", body: "Mon–Wed?", createdAt: at(6), read: true },
    { id: "b2", broadcastId: "bc_thx", kind: "discussion", replyBy: "Gage Lund", body: "Gage: works", createdAt: at(8), read: false },
    { id: "b3", broadcastId: "bc_thx", kind: "discussion", replyBy: "Keegan", body: "Keegan: fine", createdAt: at(10), read: false },
    { id: "c1", broadcastId: "bc_test", kind: "announcement", test: true, createdAt: at(11), read: false },
    { id: "x", kind: "announcement", createdAt: at(5) },   // no broadcastId → not an office message row
  ]);
  assert.deepStrictEqual(rows.map(r => r.id), ["bc_thx", "bc_ppe"], "newest activity first; test + loose items out");
  const ppe = rows[1], thx = rows[0];
  assert.strictEqual(ppe.body, "Hard hats", "body comes from the original, not the reminder");
  assert.deepStrictEqual(ppe.unreadIds, ["a2"]);
  assert.strictEqual(thx.newReplies, 2); assert.strictEqual(thx.replyCount, 2);
  assert.strictEqual(thx.lastReply, "Keegan: fine");
  assert.strictEqual(F.bcNeedLabel(thx), "2 new replies");
});
t("needs-you rule: Important until Got it, Announcement until opened, Discussion while replies are unread", () => {
  const [imp] = F.bcGroupMessages([{ id: "1", broadcastId: "b1", kind: "important", createdAt: at(1), read: true }]);
  assert.ok(imp.needs, "read but no Got it still needs you");
  const [impDone] = F.bcGroupMessages([{ id: "1", broadcastId: "b1", kind: "important", createdAt: at(1), read: true, ackAt: at(2) }]);
  assert.ok(!impDone.needs);
  const [ann] = F.bcGroupMessages([{ id: "1", broadcastId: "b2", kind: "announcement", createdAt: at(1), read: false }]);
  assert.ok(ann.needs);
  const [annRem] = F.bcGroupMessages([{ id: "1", broadcastId: "b2", kind: "announcement", createdAt: at(1), read: true },
    { id: "2", broadcastId: "b2", kind: "announcement", reminder: true, createdAt: at(2), read: false }]);
  assert.ok(annRem.needs, "an unread reminder brings it back");
  const [disNew] = F.bcGroupMessages([{ id: "1", broadcastId: "b3", kind: "discussion", createdAt: at(1), read: false }]);
  assert.ok(disNew.needs && F.bcNeedLabel(disNew) === "New", "never opened");
  const [disDone] = F.bcGroupMessages([{ id: "1", broadcastId: "b3", kind: "discussion", createdAt: at(1), read: true },
    { id: "2", broadcastId: "b3", kind: "discussion", replyBy: "A", createdAt: at(2), read: true }]);
  assert.ok(!disDone.needs);
  // The sender only ever gets reply copies: no original, still a row.
  const [sender] = F.bcGroupMessages([{ id: "9", broadcastId: "b4", kind: "discussion", replyBy: "Gage", headline: "Xmas", body: "Gage: 19th", createdAt: at(3), read: false }]);
  assert.strictEqual(sender.orig, null); assert.ok(sender.needs); assert.strictEqual(sender.headline, "Xmas");
  const [senderImp] = F.bcGroupMessages([{ id: "9", broadcastId: "b5", kind: "important", reminder: true, createdAt: at(3), read: false }]);
  assert.ok(!senderImp.needs, "no original copy = nothing to Got it");
});
t("tab / pager order: needs first, then the rest, newest first in each", () => {
  const rows = F.bcGroupMessages([
    { id: "1", broadcastId: "old_done", kind: "announcement", createdAt: at(9), read: true },
    { id: "2", broadcastId: "new_need", kind: "announcement", createdAt: at(5), read: false },
    { id: "3", broadcastId: "old_need", kind: "announcement", createdAt: at(1), read: false },
  ]);
  assert.deepStrictEqual(F.bcTabOrder(rows).map(r => r.id), ["new_need", "old_need", "old_done"]);
});

// ── 2. Temp Peds Out ──────────────────────────────────────────────────────
const NOW = new Date(2026, 9, 6, 12).getTime();   // Oct 6 2026 local
const job = (o) => ({ id: o.id, name: o.id, address: "", ...o });
t("who's out: ticked full jobs + completed installs; quotes, archived, quick jobs, unticked never", () => {
  const g = F.tempPedGroups([
    job({ id: "full", hasTempPed: true, tempPedNumber: "14", address: "77 E Harbor Ln", tempPedOutAt: "9/6/2026" }),
    job({ id: "inst", tempPed: true, tempPedStatus: "completed", tempPedNumber: "22", address: "2291 W Fawn", tempPedSignedOffDate: "6/2/2026" }),
    job({ id: "sched", tempPed: true, tempPedStatus: "scheduled", tempPedNumber: "3" }),
    job({ id: "off", hasTempPed: false, tempPedNumber: "9" }),
    job({ id: "arch", hasTempPed: true, tempPedNumber: "8", archivedAt: "x" }),
    job({ id: "quote", hasTempPed: true, type: "quote" }),
  ], NOW);
  assert.deepStrictEqual(g.map(x => x.primary.id).sort(), ["full", "inst"]);
  const full = g.find(x => x.primary.id === "full"), inst = g.find(x => x.primary.id === "inst");
  assert.strictEqual(full.days, 30); assert.strictEqual(inst.days, 126);
});
t("install + full job at the same address with the same Ped # = one ped, full job leads", () => {
  const g = F.tempPedGroups([
    job({ id: "inst", tempPed: true, tempPedStatus: "completed", tempPedNumber: "7", address: "418 S Ridge Rd", tempPedSignedOffDate: "5/1/2026" }),
    job({ id: "full", hasTempPed: true, tempPedNumber: "7", address: "418 s. ridge rd" }),
  ], NOW);
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0].primary.id, "full");
  assert.strictEqual(g[0].members.length, 2); assert.deepStrictEqual(g[0].dupWith, []);
  assert.ok(g[0].days > 150, "out-since = the earliest member date");
});
t("needs a look: no Ped #, or the same # on two different jobs", () => {
  const g = F.tempPedGroups([
    job({ id: "a", hasTempPed: true, tempPedNumber: "14", address: "1 A St" }),
    job({ id: "b", hasTempPed: true, tempPedNumber: "14", address: "2 B St" }),
    job({ id: "c", hasTempPed: true, tempPedNumber: "", address: "3 C St" }),
    job({ id: "d", hasTempPed: true, tempPedNumber: "31", address: "4 D St" }),
  ], NOW);
  const by = Object.fromEntries(g.map(x => [x.primary.id, x]));
  assert.deepStrictEqual(by.a.dupWith, ["b"]); assert.deepStrictEqual(by.b.dupWith, ["a"]);
  assert.ok(F.tpNeedsLook(by.c) && !F.tpNeedsLook(by.d));
  assert.strictEqual(by.d.days, null, "no date recorded");
});
t("Picked up stamp returns it; a returned ped no longer counts as a duplicate", () => {
  const g = F.tempPedGroups([
    job({ id: "a", hasTempPed: true, tempPedNumber: "14", address: "1 A St", tempPedReturnedAt: "10/6/2026", tempPedReturnedBy: "Justin" }),
    job({ id: "b", hasTempPed: true, tempPedNumber: "14", address: "2 B St" }),
  ], NOW);
  const by = Object.fromEntries(g.map(x => [x.primary.id, x]));
  assert.deepStrictEqual(by.a.returned, { at: "10/6/2026", by: "Justin", auto: false });
  assert.deepStrictEqual(by.b.dupWith, []);
});
t("auto-clear: a completed pickup quick job linked to the ped returns it; Undo (ignore) brings it back", () => {
  const base = [
    job({ id: "a", hasTempPed: true, tempPedNumber: "14", address: "1 A St" }),
    job({ id: "q1", quickJob: true, quickJobType: "tempped", pickupPedFor: "a", quickJobStatus: "scheduled", quickJobDate: "10/9/2026" }),
  ];
  let [g] = F.tempPedGroups(base, NOW);
  assert.strictEqual(g.returned, null); assert.strictEqual(g.openPickup.id, "q1");
  const done = [base[0], { ...base[1], quickJobStatus: "complete", signedOff: true, signedOffBy: "Gage Lund", signedOffDate: "10/9/2026" }];
  [g] = F.tempPedGroups(done, NOW);
  assert.deepStrictEqual(g.returned, { at: "10/9/2026", by: "Gage Lund", auto: true, pickupId: "q1" });
  assert.strictEqual(g.openPickup, null);
  [g] = F.tempPedGroups([{ ...done[0], tempPedPickupIgnore: ["q1"] }, done[1]], NOW);
  assert.strictEqual(g.returned, null, "undone");
  // An unlinked Temp Ped Pickup quick job never clears anything.
  [g] = F.tempPedGroups([base[0], job({ id: "q2", quickJob: true, quickJobType: "tempped", quickJobStatus: "complete" })], NOW);
  assert.strictEqual(g.returned, null);
});

console.log(`\n${pass} passed`);
