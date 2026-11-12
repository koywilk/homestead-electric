#!/usr/bin/env node
/* simprosync-test.js — the Simpro → app invoicing sync (v553, functions/simproSync.js).
 * Koy, 2026-10-17: "when something is invoiced mark it in the app as invoiced … if
 * closed in simpro just auto mark it complete. changed orders not marked complete in
 * the app but invoiced in simpro should mark complete auto as well."
 * Proves, on job shapes from the 2026-10-17 audit:
 *   1. Invoiced so far is recorded; 99.5%+ marks it invoiced in full (invoiceSent),
 *      a partial invoice never does.
 *   2. Closed in Simpro (Invoiced / Complete at 99.5%+) completes the job here, by
 *      job kind; a job only 80% invoiced or still in progress in Simpro is untouched.
 *   3. Approved / scheduled COs on a job invoiced in full are completed, their
 *      "merge or invoice" task cleared; pending COs are left alone.
 *   4. Each change happens once: a second run changes nothing, and a change put
 *      back by hand (Undo) is not redone.
 *   5. Every change is logged with from / to and the Simpro numbers; undoPatch puts
 *      it back.
 * Exit 1 on any failure. Runs in prebuild.
 */
"use strict";
const assert = require("assert");
const S = require("../functions/simproSync.js");
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);
const NOW = "2026-10-19T12:15:00.000Z", LATER = "2026-10-20T12:15:00.000Z";
const apply = (j, plan) => ({ ...j, ...plan.patch });

// 1 · Skyridge Lot 208: 62% invoiced, in progress — recorded, not "invoiced", not completed.
const sky = { name: "Skyridge Lot 208", roughStatus: "inprogress", roughStage: "90%", readyToInvoice: true };
let p = S.planSimproSync(sky, { total: 52877, inv: 32643, invPct: 61.73, stage: "Progress" }, NOW);
eq([p.patch.simproInvoicedValue, p.patch.simproInvoicedPct, p.patch.simproInvoicedTotal, p.patch.simproInvoicedSeenAt], [32643, 61.7, 52877, NOW], "invoiced so far recorded");
assert.ok(!("invoiceSent" in p.patch) && !("readyToInvoice" in p.patch) && !("roughStatus" in p.patch), "a partial invoice is not 'invoiced' and completes nothing");
eq(p.kinds, ["invoiced"]);
assert.strictEqual(S.planSimproSync(apply(sky, p), { total: 52877, inv: 32643, invPct: 61.73, stage: "Progress" }, LATER), null, "same numbers next morning: no write");
const p2 = S.planSimproSync(apply(sky, p), { total: 52877, inv: 45000, invPct: 85.1, stage: "Progress" }, LATER);
eq([p2.patch.simproInvoicedValue, p2.patch.simproInvoicedSeenAt], [45000, LATER], "a new progress invoice moves the amount and the date");

// 2 · Webb: Invoiced in Simpro at 100%, finish in progress here, failed final, approved CO.
const webb = { name: "Webb", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finishOnHold: false, readyToInvoice: true,
  finalInspectionResult: "fail", changeOrders: [{ id: "a", coStatus: "approved", desc: "Add can", quoteNumber: "3093", needsByStart: "10/20/2026" }, { id: "b", coStatus: "pending", desc: "Fan" }, { id: "c", coStatus: "completed" }], coDoneDismissed: [] };
const tW = { total: 41000, inv: 41000, invPct: 100, stage: "Invoiced", status: "Job - Ready to Invoice" };
p = S.planSimproSync(webb, tW, NOW);
eq([p.patch.invoiceSent, p.patch.readyToInvoice, p.patch.invoiceDismissed, p.patch.finishStatus, "roughStatus" in p.patch], [true, false, true, "complete", false], "invoiced in full + completed (rough already complete)");
eq(p.patch.changeOrders.map(c => c.coStatus), ["completed", "pending", "completed"], "approved CO completed, pending left alone");
eq([p.patch.changeOrders[0].needsByStart, p.patch.changeOrders[0].completedBySync, p.patch.coDoneDismissed], ["", NOW, ["a"]], "the CO's window cleared like Mark Work Completed; its invoice task cleared");
// Checked off on the crew's punch list exactly like their own "mark done" (App.js markDone).
const webbCo = { ...webb, changeOrders: [{ id: "a", coStatus: "approved", desc: "Add can", task: "<div><b>Kitchen</b></div><div>- Add 2 cans</div><div>- Move switch</div>", taskChecks: { "add 2 cans": { by: "Gage", at: "10/1/2026" } } }] };
const pc = S.planSimproSync(webbCo, tW, NOW).patch.changeOrders[0];
eq([pc.punchDoneBy, pc.punchDoneAt, Object.keys(pc.taskChecks).sort(), pc.taskChecks["add 2 cans"].by, pc.taskChecks["move switch"].by],
  ["Simpro sync", NOW, ["add 2 cans", "move switch"], "Gage", "Simpro sync"], "punchDoneBy/At set, every task line ticked, the crew's own ticks kept");
const pcEntry = S.planSimproSync(webbCo, tW, NOW).entry;
const coUndo = S.undoPatch({ ...webbCo, changeOrders: [pc] }, pcEntry).changeOrders[0];
eq([coUndo.coStatus, coUndo.punchDoneAt, coUndo.punchDoneBy, coUndo.taskChecks, "completedBySync" in coUndo], ["approved", "", "", { "add 2 cans": { by: "Gage", at: "10/1/2026" } }, false], "Undo puts the CO back on the punch list as it was");
eq(p.kinds, ["invoiced", "invoicedFull", "complete", "cos"]);
eq(p.entry.basis, { stage: "Invoiced", status: "Job - Ready to Invoice", inv: 41000, invPct: 100, total: 41000 }, "the Simpro numbers are on the log");
assert.ok(p.entry.changes.some(c => c.field === "finishStatus" && c.from === "inprogress" && c.to === "complete"), "from / to logged");
assert.strictEqual(p.patch.finalInspectionResult, undefined, "inspections are never touched");
let w2 = apply(webb, p);
assert.strictEqual(S.planSimproSync(w2, tW, LATER), null, "4 · second run: nothing to do");
// Undo by hand → not redone.
const undone = { ...w2, ...S.undoPatch(w2, p.entry) };
eq([undone.finishStatus, undone.invoiceSent, undone.readyToInvoice, undone.changeOrders[0].coStatus, "completedBySync" in undone.changeOrders[0], undone.coDoneDismissed], ["inprogress", undefined === webb.invoiceSent ? null : webb.invoiceSent, true, "approved", false, []], "5 · undoPatch puts every field and the CO back");
assert.strictEqual(S.planSimproSync(undone, tW, LATER), null, "4 · undone by hand: the sync does not redo it");

// 2b · Lot 23 Vista Meadows: Simpro Complete at 100% → completed; Lot 23 at 80% (Complete) → untouched.
p = S.planSimproSync({ name: "Lot 23", roughStatus: "complete", finishStatus: "inprogress", finishOnHold: true }, { total: 30000, inv: 30000, invPct: 100, stage: "Complete" }, NOW);
eq([p.patch.finishStatus, p.patch.finishOnHold], ["complete", false], "Complete stage counts as closed; the hold comes off");
p = S.planSimproSync({ name: "Lot 23", roughStatus: "complete", finishStatus: "inprogress" }, { total: 30000, inv: 24000, invPct: 80, stage: "Complete" }, NOW);
assert.ok(p && !("finishStatus" in p.patch) && !("invoiceSent" in p.patch), "80% invoiced: only the amount is recorded");
// Billed in full but still Progress in Simpro (Thayne): invoiced + COs completed, job NOT completed.
p = S.planSimproSync({ name: "Thayne", roughStatus: "inprogress", changeOrders: [{ id: "t", coStatus: "approved" }] }, { total: 9000, inv: 9000, invPct: 100, stage: "Progress" }, NOW);
eq([p.patch.invoiceSent, "roughStatus" in p.patch, "finishStatus" in p.patch, p.patch.changeOrders[0].coStatus], [true, false, false, "completed"], "Progress in Simpro: invoiced and COs done, the job stays open");

// 2c · by kind
eq(S.completePatch({ quickJob: true, quickJobStatus: "inprogress" }), { quickJobStatus: "invoice" }, "quick job → Invoiced");
eq(S.completePatch({ tempPed: true, tempPedStatus: "scheduled" }), { tempPedStatus: "completed" }, "temp ped → Completed");
eq(S.completePatch({ division: "commercial", commercial: { stage: "inprogress", note: "x" } }), { commercial: { stage: "complete", note: "x" } }, "commercial → complete, the rest of its block kept");
eq(S.completePatch({ roughStatus: "waiting", roughOnHold: true }), { finishStatus: "complete", roughStatus: "complete", roughOnHold: false }, "resi: rough completed too");
p = S.planSimproSync({ name: "Temp Ped", tempPed: true, tempPedStatus: "scheduled", readyToInvoice: true }, { total: 400, inv: 400, invPct: 100, stage: "Invoiced" }, NOW);
eq([p.patch.tempPedStatus, p.patch.invoiceSent], ["completed", true], "a billed temp ped is completed and invoiced");
p = S.planSimproSync({ name: "Quick", quickJob: true, quickJobStatus: "complete" }, { total: 1652, inv: 1652, invPct: 100, stage: "Invoiced" }, NOW);
eq([p.patch.quickJobStatus, p.kinds.includes("complete")], ["invoice", false], "a finished quick job billed in full moves to Invoiced (already done, not 'completed' again)");

// 3 · nothing to go on → nothing
assert.strictEqual(S.planSimproSync(webb, { total: 41000 }, NOW), null, "an entry from before v551 (total only) changes nothing");
assert.strictEqual(S.planSimproSync(webb, null, NOW), null);
// 99.5% rule
assert.ok(S.planSimproSync({ name: "x" }, { total: 100, inv: 99.6, invPct: 99.6, stage: "Progress" }, NOW).patch.invoiceSent, "99.6% is in full");
assert.ok(!("invoiceSent" in S.planSimproSync({ name: "x" }, { total: 100, inv: 99.4, invPct: 99.4, stage: "Invoiced" }, NOW).patch), "99.4% is not");
// log capped
const many = { name: "m", simproSync: { log: Array.from({ length: 25 }, (_, i) => ({ at: `2026-09-${String(i + 1).padStart(2, "0")}`, kinds: ["invoiced"], changes: [] })) } };
assert.strictEqual(S.planSimproSync(many, { total: 10, inv: 5, invPct: 50, stage: "Progress" }, NOW).patch.simproSync.log.length, 20, "log keeps the last 20");

// 6 · v626 ship 2 — a change order is completed only once ITS OWN quote is closed in Simpro.
// Mangum #920 on 2026-11-11: invoiced in full; two COs whose quotes (3306, 3377) were converted into the
// job (IsClosed true), one approved CO whose quote (3423) is still open "Waiting on GC", one with no quote #.
const mangum = { name: "Mangum", roughStatus: "complete", finishStatus: "complete", invoiceSent: true, simproInvoicedValue: 82078.72, simproInvoicedPct: 100, simproSync: { invoiceSent: NOW, complete: NOW, cos: {} },
  changeOrders: [{ id: "c6", coStatus: "approved", desc: "Attic outlet", quoteNumber: "3306" }, { id: "c8", coStatus: "scheduled", desc: "Coach lights", quoteNumber: "#3377" },
    { id: "c9", coStatus: "approved", desc: "Disposal plug", quoteNumber: "3423" }, { id: "c10", coStatus: "approved", desc: "No quote on it" }, { id: "c11", coStatus: "approved", desc: "Quote not read", quoteNumber: "3500" },
    { id: "c12", coStatus: "approved", desc: "Quote archived", quoteNumber: "3600" }, { id: "c13", coStatus: "pending", desc: "Still with the GC", quoteNumber: "3306" }] };
const tM = { total: 82078.72, inv: 82078.72, invPct: 100, stage: "Invoiced", status: "Job - Ready to Invoice" };
const quotes = { "3306": { total: 1276.33, stage: "Approved", status: "Quote - Convert to Job", closed: true }, "3377": { total: 657.15, stage: "Approved", status: "Quote - Convert to Job", closed: true },
  "3423": { total: 282.87, stage: "Approved", status: "Quote: Change Order - Waiting on GC", closed: false }, "3600": { total: 10, stage: "Archived", status: "Quote - Declined", closed: true } };
eq(mangum.changeOrders.map(co => S.coQuoteState(co, quotes)), ["closed", "closed", "open", "none", "unread", "dead", "closed"]);
p = S.planSimproSync(mangum, tM, NOW, quotes);
eq(p.patch.changeOrders.map(co => co.coStatus), ["completed", "completed", "approved", "completed", "approved", "approved", "pending"],
  "closed quotes and a CO with no quote # complete; an open, unread or dead quote holds its CO; a pending CO is never touched");
eq(p.entry.changes.filter(c => c.co).map(c => c.co), ["c6", "c8", "c10"]);
eq(S.heldCos(mangum, tM, quotes), [{ co: "c9", quote: "3423", why: "open" }, { co: "c11", quote: "3500", why: "unread" }, { co: "c12", quote: "3600", why: "dead" }], "what is held, and why, for the run's log");
// Next morning the GC's quote is converted: the held CO completes then, the others are not redone.
const day2 = S.planSimproSync(apply(mangum, p), tM, LATER, { ...quotes, "3423": { ...quotes["3423"], closed: true, status: "Quote - Convert to Job" } });
eq(day2.entry.changes.filter(c => c.co).map(c => c.co), ["c9"], "completes the day its quote closes");
// Same quotes next morning: nothing to write, the holds stay holds.
assert.strictEqual(S.planSimproSync(apply(mangum, p), tM, LATER, quotes), null, "a held CO causes no write");
// No quotes passed at all (the v553 call): every approved / scheduled CO completes, as before.
eq(S.planSimproSync(mangum, tM, NOW).patch.changeOrders.map(co => co.coStatus), ["completed", "completed", "completed", "completed", "completed", "completed", "pending"], "without a quotes map the old rule stands");
eq(S.heldCos(mangum, tM, undefined), [], "…and nothing counts as held");
eq(S.heldCos(mangum, { ...tM, invPct: 80 }, quotes), [], "a job not invoiced in full holds nothing (the rule does not apply yet)");
// Which quotes to read: open COs the sync has not completed, on jobs invoiced in full this morning.
eq(S.openCoQuoteNos([{ ...mangum, simproNo: "920" }, { simproNo: "1", changeOrders: [{ id: "x", coStatus: "approved", quoteNumber: "77" }] }, { simproNo: "2", archived: true, changeOrders: [{ id: "y", coStatus: "approved", quoteNumber: "78" }] },
  { simproNo: "3", simproSync: { cos: { z: NOW } }, changeOrders: [{ id: "z", coStatus: "approved", quoteNumber: "79" }] }],
  { "920": tM, "1": { invPct: 60 }, "2": { invPct: 100 }, "3": { invPct: 100 } }), ["3306", "3377", "3423", "3500", "3600"], "digits only, once each; not a part-billed job, an archived job, or a CO already completed by the sync");

console.log("simprosync-test: all checks passed");
