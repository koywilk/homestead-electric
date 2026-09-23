"use strict";
// Pure morning-digest math for dailyMyDayDigest (v427). Mirrors ONLY the simple
// hat rules from App.js computeTasks/HAT_REGISTRY — QC + Matterport are left
// out on purpose (QC's rule is complex; scans have dailyMatterportChase).
// Keep HATS in sync with HAT_REGISTRY in src/App.js.
const HATS = { invoice: "invoice.own", co_send: "co.own", redline: "redline.own" };
const norm = (s) => String(s || "").trim().toLowerCase();
const same = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true; return x.split(" ")[0] === y || y.split(" ")[0] === x; };
const live = (users) => (users || []).filter(u => u && u.name && u.active !== false);
const coverOf = (users, name, today) => { const u = (users || []).find(x => x && same(x.name, name)); return (u && u.active !== false && u.coverTo && u.coverUntil && String(u.coverUntil) >= today) ? u.coverTo : name; };
const head = (users) => { const L = live(users); const h = L.find(u => (u.caps || []).includes("resi.head")) || L.find(u => (u.caps || []).includes("jobprep.own")); return h ? h.name : ""; };
function owners(users, cap, today) {
  const out = [];
  live(users).filter(u => (u.caps || []).includes(cap)).forEach(u => { const n = coverOf(users, u.name, today); if (!out.some(x => same(x, n))) out.push(n); });
  if (out.length) return out;
  const h = head(users); return h ? [coverOf(users, h, today)] : [];
}
function digestCounts({ users, jobs, needs, redlines, todayYmd }) {
  const m = new Map();
  const slot = (name) => { const k = (live(users).find(u => same(u.name, name)) || {}).name || name; if (!m.has(k)) m.set(k, { overdue: 0, today: 0, hats: { invoice: 0, co_send: 0, redline: 0 } }); return m.get(k); };
  live(users).forEach(u => slot(u.name));
  (needs || []).forEach(n => {
    if (!n || n.status === "done") return;
    if (n.snoozedUntil && String(n.snoozedUntil) > todayYmd) return;
    const a = String((n.assignedTo ?? n.coordinator) || "").trim() || String(n.createdBy || "").trim();
    if (!a || !n.dueDate) return;
    const who = coverOf(users, a, todayYmd);
    if (n.dueDate < todayYmd) slot(who).overdue++; else if (n.dueDate === todayYmd) slot(who).today++;
  });
  const bump = (hat) => owners(users, HATS[hat], todayYmd).forEach(o => slot(o).hats[hat]++);
  (jobs || []).forEach(j => {
    if (!j || j.type === "quote" || j.tempPed || j.quickJob) return;
    const cleared = new Set(j.clearedTasks || []);
    if (j.readyToInvoice && !j.invoiceDismissed && !cleared.has(j.id + "_invoice")) bump("invoice");
    const coDone = new Set(j.coDoneDismissed || []);
    (j.changeOrders || []).forEach(co => {
      if (!co) return;
      if ((co.coStatus || "needs_sending") === "needs_sending" && !cleared.has(`${j.id}_co_${co.id}_send`)) bump("co_send");
      if (co.coStatus === "completed" && !coDone.has(co.id) && !cleared.has(`${j.id}_co_${co.id}_done`)) bump("invoice");
    });
    const rtDone = new Set(j.rtDoneDismissed || []);
    (j.returnTrips || []).forEach(rt => { if (rt && rt.rtStatus === "complete" && !rtDone.has(rt.id) && !cleared.has(`${j.id}_rt_${rt.id}_done`)) bump("invoice"); });
  });
  (redlines || []).forEach(w => {
    if (!w) return;
    if (w.status === "scheduled") bump("redline");
    else if (w.status === "co_owed" && !w.coQuoteNumber) bump("co_send");
  });
  return m;
}
function digestLine(c) {
  if (!c) return "";
  const parts = [];
  if (c.overdue) parts.push(`${c.overdue} overdue`);
  if (c.today) parts.push(`${c.today} today`);
  if (c.hats.invoice) parts.push(`${c.hats.invoice} to invoice`);
  if (c.hats.co_send) parts.push(`${c.hats.co_send} CO quote${c.hats.co_send !== 1 ? "s" : ""}`);
  if (c.hats.redline) parts.push(`${c.hats.redline} redline walk${c.hats.redline !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}
module.exports = { digestCounts, digestLine };
