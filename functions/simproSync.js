"use strict";
// Simpro → app invoicing sync (v553). Koy, 2026-10-17: "ready to invoice should not
// show numbers in the app. instead i want invoicing to be tracked from simpro api,
// when something is invoiced mark it in the app as invoiced … if closed in simpro
// just auto mark it complete. changed orders not marked complete in the app but
// invoiced in simpro should mark complete auto as well."
//
// Pure: no Firebase. dailySimproTotals runs planSimproSync on each job's latest copy
// inside a transaction and writes the patch; scripts/simprosync-test.js and the
// dry run use the same function.
//
// What it does, per job, from that morning's Simpro numbers (Totals.InvoicedValue,
// InvoicePercentage, Stage):
//   1. Invoicing: records what Simpro has invoiced so far (simproInvoicedValue /
//      Pct / Total, and the day the sync first saw the latest amount). 99.5%+ is
//      invoiced in full: invoiceSent true (readyToInvoice off), the same fields the
//      app's "Invoice sent" button sets; a quick job moves to its Invoiced status.
//   2. Closed in Simpro (Stage Invoiced / Complete, 99.5%+): marks the job complete
//      in the app (finish complete, rough complete if it wasn't, holds off; quick
//      job Invoiced; temp ped Completed; commercial stage complete).
//   3. Change orders: on a job invoiced in full, an approved or scheduled CO (its
//      quote folds into this Simpro job) is marked completed, and its "merge or
//      invoice" task is cleared (it has been invoiced).
// Each change happens once per job / CO: simproSync remembers it, so if someone
// puts it back by hand (or Undo), the next morning does not redo it. Every change
// is logged on the job (simproSync.log: what changed, from what, and the Simpro
// numbers it was based on) so it can be undone.

const FULL = 99.5;
const CLOSED_STAGES = ["Invoiced", "Complete"];
const OPEN_CO = ["approved", "scheduled"];
const LOG_MAX = 20;
const SYNC_BY = "Simpro sync";

// The task lines of a CO's rich text, as the crew's punch list reads them (App.js
// coTaskLines / coTaskKey, v417): "- " lines are the checkable items.
function coItemKeys(html) {
  const t = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(div|p|li|h[1-6])(\s[^>]*)?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return t.split("\n").map(x => x.replace(/\s+/g, " ").trim()).filter(x => /^[-•*]/.test(x))
    .map(x => x.replace(/^[-•*]+\s*/, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120));
}
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

// Same "finished" the dashboard uses (odPhase).
function isDoneInApp(j) {
  if (j.quickJob) return ["complete", "invoice"].includes(j.quickJobStatus || "");
  if (j.tempPed) return j.tempPedStatus === "completed";
  if (j.division === "commercial") return ((j.commercial || {}).stage || "") === "complete";
  if (j.finishStatus) return j.finishStatus === "complete";
  return (parseInt(j.finishStage) || 0) === 100;
}

// The completion patch for one job and the values it replaces (for Undo).
function completePatch(j) {
  const p = {};
  if (j.quickJob) p.quickJobStatus = "invoice";
  else if (j.tempPed) p.tempPedStatus = "completed";
  else if (j.division === "commercial") p.commercial = { ...(j.commercial || {}), stage: "complete" };
  else {
    p.finishStatus = "complete";
    if (j.roughStatus !== "complete") p.roughStatus = "complete";
    if (j.finishOnHold) p.finishOnHold = false;
    if (j.roughOnHold) p.roughOnHold = false;
  }
  return p;
}

// Returns null when nothing changes, else { patch, entry, kinds }: patch holds
// top-level job data keys to write (whole values), entry is the log line.
// ── v626 ship 2 (dashboard audit 2026-11-11) ────────────────────────────────────────────────
// Rule 3 below assumes an approved change order's quote is already INSIDE the Simpro job, so a job
// invoiced in full means the CO was invoiced too. That is false for a CO approved after the job
// hit 100%: its quote is still its own open quote in Simpro, and closing the CO here cleared the
// reminder to bill it. So when the caller passes that morning's quotes (by quote number, each
// with `closed` = Simpro's IsClosed), a CO with a quote number is completed only once its quote is
// closed (converted into the job). No quote number on the CO = nothing to check it against: the
// v553 behaviour. No `quotes` argument at all (tests, old dry runs) = the v553 behaviour.
const quoteNoOf = (co) => String((co && co.quoteNumber) || "").replace(/^#/, "").trim();
function coQuoteState(co, quotes) {
  if (!quotes) return "unchecked";
  const qn = quoteNoOf(co);
  if (!/^\d+$/.test(qn)) return "none";
  const q = quotes[qn];
  if (!q) return "unread";                                   // not read this morning: wait, try tomorrow
  if (/archiv|declin|lost|cancel/i.test(`${q.stage || ""} ${q.status || ""}`)) return "dead";
  return q.closed === true ? "closed" : "open";
}
const CO_HOLD = ["unread", "open", "dead"];
// The quote numbers worth reading for the rule above: approved / scheduled COs the sync has not
// completed yet, on jobs that morning's totals show invoiced in full. Digits only, once each.
function openCoQuoteNos(jobs, byNo, cap = 80) {
  const out = [], seen = new Set();
  (jobs || []).forEach(j => {
    if (!j || j.type === "quote" || j.archived || j.deleted || j.archivedAt) return;
    const t = (byNo || {})[String(j.simproNo || "").trim()];
    if (!t || !(num(t.invPct) >= FULL)) return;
    const did = (j.simproSync && j.simproSync.cos) || {};
    (j.changeOrders || []).forEach(co => {
      if (!co || !OPEN_CO.includes(co.coStatus) || !co.id || did[co.id]) return;
      const qn = quoteNoOf(co);
      if (!/^\d+$/.test(qn) || seen.has(qn) || out.length >= cap) return;
      seen.add(qn); out.push(qn);
    });
  });
  return out;
}
// The COs rule 3 is holding open this morning, and why (for the run's own log line).
function heldCos(job, t, quotes) {
  const j = job || {};
  if (!t || !(num(t.invPct) >= FULL) || !Array.isArray(j.changeOrders)) return [];
  const did = (j.simproSync && j.simproSync.cos) || {};
  return j.changeOrders.filter(co => co && OPEN_CO.includes(co.coStatus) && co.id && !did[co.id] && CO_HOLD.includes(coQuoteState(co, quotes)))
    .map(co => ({ co: co.id, quote: quoteNoOf(co), why: coQuoteState(co, quotes) }));
}
// settings/simproTotals keeps one entry per Simpro number. The morning pull only re-reads the jobs
// it wants that day; with a plain merge, an entry it stopped reading (or whose read failed) stayed
// forever with no date on it. Now every entry carries `at`: fresh ones get this run's time, the
// rest keep their own, and an entry is dropped once its job is gone from the app or it is older
// than `maxDays`. `prevAt` dates entries written before entries had their own date (atGuess: true).
function carryTotals(prev, fresh, { live = null, nowIso, prevAt = "", maxDays = 180 } = {}) {
  const out = {}, now = Date.parse(nowIso);
  Object.entries(prev || {}).forEach(([k, e]) => {
    if (!e || typeof e !== "object" || (live && !live.has(k))) return;
    const at = e.at || prevAt || "", ms = Date.parse(at);
    if (!ms || now - ms > maxDays * 86400e3) return;
    // An entry written before entries had dates takes the old doc's date, marked as a guess (it may be older).
    out[k] = e.at ? { ...e, at } : { ...e, at, atGuess: true };
  });
  Object.entries(fresh || {}).forEach(([k, e]) => { if (e && typeof e === "object") out[k] = { ...e, at: nowIso }; });
  return out;
}

function planSimproSync(job, t, nowIso, quotes) {
  const j = job || {};
  if (!t || typeof t !== "object") return null;
  const inv = num(t.inv), pct = num(t.invPct), total = num(t.total);
  if (inv == null || pct == null) return null;           // an entry from before v551: nothing to go on
  const full = pct >= FULL;
  const prevSync = (j.simproSync && typeof j.simproSync === "object") ? j.simproSync : {};
  const sync = { ...prevSync, cos: { ...(prevSync.cos || {}) } };
  const patch = {}, changes = [], kinds = [];
  const set = (field, to, undo = true) => { const from = j[field] === undefined ? null : j[field]; patch[field] = to; changes.push({ field, from, to, undo }); };

  // 1 · invoicing so far (a fact from Simpro: logged, never undone)
  const prevInv = num(j.simproInvoicedValue);
  if (prevInv == null || Math.abs(inv - prevInv) > 0.5 || num(j.simproInvoicedPct) !== Math.round(pct * 10) / 10) {
    if (prevInv == null || Math.abs(inv - prevInv) > 0.5) { set("simproInvoicedValue", r2(inv), false); patch.simproInvoicedSeenAt = nowIso; if (inv > (prevInv || 0) + 0.5) kinds.push("invoiced"); }
    patch.simproInvoicedPct = Math.round(pct * 10) / 10;
    if (total != null) patch.simproInvoicedTotal = r2(total);
  }
  if (full && !j.invoiceSent && !prevSync.invoiceSent) {
    set("invoiceSent", true);
    if (j.readyToInvoice) set("readyToInvoice", false);
    if (!j.invoiceDismissed) set("invoiceDismissed", true);
    if (j.roughStatus === "invoice") set("roughStatus", "complete");
    if (j.finishStatus === "invoice") set("finishStatus", "complete");
    if (j.quickJob && j.quickJobStatus !== "invoice") set("quickJobStatus", "invoice");
    sync.invoiceSent = nowIso;
    kinds.push("invoicedFull");
  }

  // 2 · closed in Simpro → complete here (once)
  const view = { ...j, ...patch };
  if (CLOSED_STAGES.includes(t.stage) && full && !isDoneInApp(view) && !prevSync.complete) {
    Object.entries(completePatch(view)).forEach(([k, v]) => set(k, v));
    sync.complete = nowIso;
    kinds.push("complete");
  }

  // 3 · approved / scheduled COs on a job invoiced in full → completed (once each)
  if (full && Array.isArray(j.changeOrders)) {
    let touched = false;
    const done = new Set(j.coDoneDismissed || []);
    const next = j.changeOrders.map(co => {
      if (!co || !OPEN_CO.includes(co.coStatus) || !co.id || sync.cos[co.id]) return co;
      if (CO_HOLD.includes(coQuoteState(co, quotes))) return co;   // v626: its own quote is not closed in Simpro yet (see coQuoteState)
      touched = true;
      sync.cos[co.id] = nowIso;
      // Checked off exactly like the crew's "mark done" on the punch list (App.js markDone):
      // every task line ticked, punchDoneBy / punchDoneAt set — so the CO shows as done on the
      // punch list and as Work Completed on the COs tab, not just vanish.
      const checks = { ...(co.taskChecks || {}) };
      const day = new Date(nowIso).toLocaleDateString("en-US", { timeZone: "America/Denver" });
      coItemKeys(co.task).forEach(k => { if (!checks[k]) checks[k] = { by: SYNC_BY, at: day }; });
      changes.push({ co: co.id, desc: String(co.desc || "").slice(0, 80), quote: co.quoteNumber || "", from: co.coStatus, to: "completed", undo: true,
        prev: { taskChecks: co.taskChecks || null, punchDoneAt: co.punchDoneAt || "", punchDoneBy: co.punchDoneBy || "", needsByStart: co.needsByStart || "", needsByEnd: co.needsByEnd || "", needsHardDate: !!co.needsHardDate } });
      done.add(co.id);
      return { ...co, coStatus: "completed", coStatusDate: "", needsByStart: "", needsByEnd: "", needsHardDate: false,
        punchDoneBy: SYNC_BY, punchDoneAt: nowIso, taskChecks: checks, completedBySync: nowIso };
    });
    if (touched) {
      patch.changeOrders = next;
      patch.coDoneDismissed = [...done];
      kinds.push("cos");
    }
  }

  if (!Object.keys(patch).length) return null;
  const basis = { stage: String(t.stage || ""), status: String(t.status || ""), inv: r2(inv), invPct: Math.round(pct * 10) / 10, total: total == null ? null : r2(total) };
  const meaningful = changes.filter(c => c.undo !== false || c.co);
  const entry = { at: nowIso, by: SYNC_BY, kinds, changes, basis };
  // Only log runs that changed something people see (not a bare amount refresh with no increase).
  if (kinds.length || meaningful.length) sync.log = [...(prevSync.log || []), entry].slice(-LOG_MAX);
  sync.lastAt = nowIso;
  patch.simproSync = sync;
  return { patch, entry, kinds };
}

// What Undo writes for one log entry: the "from" value of every undoable field and
// each CO's previous status. The simproSync memory stays, so it is not redone.
function undoPatch(job, entry) {
  const j = job || {}, p = {};
  ((entry && entry.changes) || []).forEach(c => {
    if (c.undo === false) return;
    if (c.field) p[c.field] = c.from;
  });
  const coBack = {};
  ((entry && entry.changes) || []).forEach(c => { if (c.co) coBack[c.co] = c; });
  if (Object.keys(coBack).length && Array.isArray(j.changeOrders)) {
    p.changeOrders = j.changeOrders.map(co => { const c = co && coBack[co.id]; if (!c || co.coStatus !== "completed") return co;
      const { completedBySync, ...rest } = co; const pv = c.prev || {};
      return { ...rest, coStatus: c.from, taskChecks: pv.taskChecks || {}, punchDoneAt: pv.punchDoneAt || "", punchDoneBy: pv.punchDoneBy || "",
        needsByStart: pv.needsByStart || "", needsByEnd: pv.needsByEnd || "", needsHardDate: !!pv.needsHardDate }; });
    p.coDoneDismissed = (j.coDoneDismissed || []).filter(id => !coBack[id]);
  }
  return p;
}

module.exports = { planSimproSync, undoPatch, isDoneInApp, completePatch, FULL, CLOSED_STAGES, OPEN_CO, SYNC_BY, coQuoteState, openCoQuoteNos, heldCos, carryTotals };
