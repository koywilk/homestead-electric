// Office messages tabs + Temp Peds Out (v514) — regression tests.
// Run: node scripts/office-msgs-peds-test.js   Exit 0 = all pass. Wired into prebuild.
//
// The helpers are extracted LIVE from src/App.js (brace-balanced slice, the
// gen-selection-test recipe), so the test can't drift from the app.
//  1. bcGroupMessages — one row per office message from its bell copies, and the
//     ONE "needs you" rule the bell, My Day tabs and pins share.
//  2. tempPedGroups — which peds are out, one row per physical ped, auto-clear
//     from a completed pickup quick job, Undo, duplicates, days out.
//  3. Temp ped card → job card link (ask first): who's suggested, Link merges the
//     rows and ticks the job card, Not this one / Unlink never re-suggest.
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
  "tpToday", "tpAddrKey", "tpLive", "tpOnJob", "tpPickupDone", "tempPedGroups", "tpNeedsLook",
  "TP_NAME_SKIP", "tpNameWords", "tpIdMs", "tpLinkWhy", "tpLinkSuggestions", "tpLinkSuggestionsForJob",
  "tpLinkPatches", "tpUnlinkPatches", "tpSkipPatch"];
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

// ── 3. Temp ped card → job card link ─────────────────────────────────────
const DAY = 86400000, T0 = 1790000000000;           // ids are Date.now()-seeded
const idAt = (days) => String(T0 + days * DAY);
const inst = (o) => job({ tempPed: true, tempPedStatus: "completed", tempPedSignedOffDate: "8/1/2026", ...o });
t("name words drop filler and numbers", () => {
  assert.deepStrictEqual(F.tpNameWords("Welliver Residence - Temp Ped"), ["welliver"]);
  assert.deepStrictEqual(F.tpNameWords("Lot 12 New Build"), []);
});
t("suggested: name / address / Simpro # match; not old cards, other peds, quick jobs, quotes, skipped", () => {
  const i = inst({ id: idAt(0), name: "Welliver", tempPedNumber: "14", tempPedLinkSkip: [idAt(6)] });
  const why = (f) => F.tpLinkWhy(i, job(f));
  assert.strictEqual(why({ id: idAt(5), name: "Welliver Residence" }), "name matches “welliver”");
  assert.strictEqual(why({ id: idAt(5), name: "Lot 4", address: "", simproNo: "" }), null);
  assert.strictEqual(F.tpLinkWhy({ ...i, address: "12 Fawn Ln" }, job({ id: idAt(5), name: "Lot 4", address: "12 fawn ln." })), "same address");
  assert.strictEqual(why({ id: idAt(-60), name: "Welliver Shop" }), null, "made 2 months before the ped");
  assert.strictEqual(why({ id: idAt(-10), name: "Welliver Residence" }), "name matches “welliver”", "a few days early is fine");
  assert.strictEqual(why({ id: idAt(5), name: "Welliver", hasTempPed: true, tempPedNumber: "9" }), null, "has a different ped out");
  assert.strictEqual(why({ id: idAt(5), name: "Welliver", hasTempPed: true, tempPedNumber: "" }), "name matches “welliver”", "ticked with no # still links");
  assert.strictEqual(why({ id: idAt(5), name: "Welliver", quickJob: true }), null);
  assert.strictEqual(why({ id: idAt(5), name: "Welliver", type: "quote" }), null);
  assert.strictEqual(why({ id: idAt(6), name: "Welliver" }), null, "Not this one");
  assert.strictEqual(why({ id: idAt(5), name: "Welliver", tempPedInstallId: "other" }), null, "already linked");
});
t("lane + Job Info suggestions: only for ped rows that are just an install card", () => {
  const i = inst({ id: idAt(0), name: "Welliver", tempPedNumber: "14" });
  const f = job({ id: idAt(5), name: "Welliver Residence", address: "77 E Harbor Ln" });
  const other = inst({ id: idAt(1), name: "Smith", tempPedNumber: "3" });
  const jobs = [i, f, other];
  const groups = F.tempPedGroups(jobs, NOW);
  const sug = F.tpLinkSuggestions(groups, jobs);
  assert.strictEqual(sug.size, 1);
  const [list] = [...sug.values()];
  assert.deepStrictEqual(list.map(s => [s.inst.id, s.job.id]), [[i.id, f.id]]);
  assert.deepStrictEqual(F.tpLinkSuggestionsForJob(f, jobs, groups).map(s => [s.inst.id, s.num]), [[i.id, "14"]]);
  assert.deepStrictEqual(F.tpLinkSuggestionsForJob(i, jobs, groups), [], "never on the install card itself");
});
t("Link: job card ticked, # + out date carried, one row with the job card leading, no dup flag", () => {
  const i = inst({ id: idAt(0), name: "Welliver", tempPedNumber: "14", address: "Welliver" });
  const f = job({ id: idAt(5), name: "Welliver Residence", address: "77 E Harbor Ln" });
  const p = F.tpLinkPatches(i, f);
  assert.strictEqual(p.full.hasTempPed, true);
  assert.strictEqual(p.full.tempPedNumber, "14");
  assert.strictEqual(p.full.tempPedOutAt, "8/1/2026");
  assert.strictEqual(p.full.tempPedInstallId, i.id);
  assert.strictEqual(p.install.tempPedLinkedJobId, f.id);
  const jobs = [{ ...i, ...p.install }, { ...f, ...p.full }];
  const groups = F.tempPedGroups(jobs, NOW);
  assert.strictEqual(groups.length, 1, "different addresses, still one ped");
  assert.strictEqual(groups[0].primary.id, f.id);
  assert.strictEqual(groups[0].dupWith.length, 0);
  assert.strictEqual(groups[0].days, 66, "out since the install sign-off");
  assert.strictEqual(F.tpLinkSuggestions(groups, jobs).size, 0, "nothing left to suggest");
});
t("Link keeps the job card's own # and the earlier out date; clears an old pickup", () => {
  const i = inst({ id: idAt(0), name: "Welliver", tempPedNumber: "14", tempPedSignedOffDate: "9/20/2026" });
  const f = job({ id: idAt(5), name: "Welliver", hasTempPed: true, tempPedNumber: "14", tempPedOutAt: "9/1/2026" });
  const p = F.tpLinkPatches(i, f);
  assert.strictEqual(p.full.tempPedNumber, "14");
  assert.strictEqual(p.full.tempPedOutAt, "9/1/2026");
  const g = F.tpLinkPatches(i, job({ id: idAt(5), name: "Welliver", hasTempPed: true, tempPedReturnedAt: "3/1/2026", tempPedOutAt: "1/1/2026" }));
  assert.strictEqual(g.full.tempPedReturnedAt, "");
  assert.strictEqual(g.full.tempPedOutAt, "9/20/2026", "an old returned ped's date doesn't count");
});
t("Unlink puts the job card back and never suggests it again; Not this one adds to the skip list", () => {
  const i = inst({ id: idAt(0), name: "Welliver", tempPedNumber: "14" });
  const f = job({ id: idAt(5), name: "Welliver Residence" });
  const p = F.tpLinkPatches(i, f);
  const fl = { ...f, ...p.full }, il = { ...i, ...p.install };
  const u = F.tpUnlinkPatches(il, fl);
  const fu = { ...fl, ...u.full }, iu = { ...il, ...u.install };
  assert.strictEqual(fu.hasTempPed, false);
  assert.strictEqual(fu.tempPedNumber, "");
  assert.strictEqual(fu.tempPedInstallId, "");
  assert.strictEqual(F.tpLinkWhy(iu, fu), null, "skipped after Unlink");
  assert.strictEqual(F.tempPedGroups([iu, fu], NOW).length, 1, "the ped is still out on its install card");
  assert.deepStrictEqual(F.tpSkipPatch({ tempPedLinkSkip: ["a"] }, "b"), { tempPedLinkSkip: ["a", "b"] });
  assert.strictEqual(F.tpUnlinkPatches(undefined, fl).install, null, "install card deleted: job card still unlinks");
});

console.log(`\n${pass} passed`);
