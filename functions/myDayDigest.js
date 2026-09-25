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
// The assignee of a need doc, as the app resolves it: assignedTo (explicit ""
// honored), else the legacy coordinator, else the creator.
const assigneeOf = (n) => String((n.assignedTo ?? n.coordinator) || "").trim() || String(n.createdBy || "").trim();
function digestCounts({ users, jobs, needs, redlines, todayYmd }) {
  const m = new Map();
  const slot = (name) => { const k = (live(users).find(u => same(u.name, name)) || {}).name || name; if (!m.has(k)) m.set(k, { overdue: 0, today: 0, urgent: 0, hats: { invoice: 0, co_send: 0, redline: 0 } }); return m.get(k); };
  live(users).forEach(u => slot(u.name));
  (needs || []).forEach(n => {
    if (!n || n.status === "done") return;
    if (n.snoozedUntil && String(n.snoozedUntil) > todayYmd) return;
    const a = assigneeOf(n);
    if (!a) return;
    const who = coverOf(users, a, todayYmd);
    // v446: urgent counts whether or not it carries a date.
    if (n.priority === "urgent") slot(who).urgent++;
    if (!n.dueDate) return;
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
    // v447: return trips (including "complete — merge or invoice") are the
    // head's rows, not the invoicing hat's — no RT bump here.
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
  if (c.urgent) parts.push(`${c.urgent} urgent`);
  if (c.overdue) parts.push(`${c.overdue} overdue`);
  if (c.today) parts.push(`${c.today} today`);
  if (c.hats.invoice) parts.push(`${c.hats.invoice} to invoice`);
  if (c.hats.co_send) parts.push(`${c.hats.co_send} CO quote${c.hats.co_send !== 1 ? "s" : ""}`);
  if (c.hats.redline) parts.push(`${c.hats.redline} redline walk${c.hats.redline !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}

// ── v446 overdue chase ───────────────────────────────────────────────────────
// Koy (2026-09-24): nothing chased a stalled task — pushes fired on assign /
// done / reply only. Runs inside the same morning function, weekdays. Rules
// (deterministic on days-overdue, so no chase bookkeeping is written back):
//   • ASSIGNEE: a doc overdue 2+ days, on every EVEN day overdue (2, 4, 6…),
//     unless the assignee posted an update in the last 48h (they're talking).
//   • REQUESTER (assignedBy, else createdBy, when a different person): every
//     5th day overdue (5, 10, 15…), so they know it's still sitting.
// Snoozed docs, done docs, undated docs and "low" priority docs are skipped
// (low = the sender said it can wait). Covering applies to both sides.
const DAY = 864e5;
const daysBetween = (fromYmd, toYmd) => Math.round((Date.parse(toYmd + "T00:00:00Z") - Date.parse(fromYmd + "T00:00:00Z")) / DAY);
function chaseTargets({ needs, users, todayYmd, nowMs }) {
  const out = [];
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  (needs || []).forEach(n => {
    if (!n || n.status === "done" || n.kind === "bodies" || n.priority === "low") return;
    if (n.snoozedUntil && String(n.snoozedUntil) > todayYmd) return;
    if (!n.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(n.dueDate)) || !(n.dueDate < todayYmd)) return;
    const raw = assigneeOf(n);
    if (!raw) return;
    const days = daysBetween(n.dueDate, todayYmd);
    if (days < 2) return;
    const assignee = coverOf(users, raw, todayYmd);
    const ups = Array.isArray(n.updates) ? n.updates : [];
    const lastByAssignee = ups.filter(u => u && same(u.by, raw)).reduce((m, u) => Math.max(m, Date.parse(u.at || "") || 0), 0);
    const quiet = (now - lastByAssignee) >= 2 * DAY;
    const item = { id: n.id, text: String(n.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60), jobName: n.jobName || "", daysOverdue: days, assignee: raw, urgent: n.priority === "urgent" };
    if (days % 2 === 0 && quiet) out.push({ name: assignee, role: "assignee", need: item });
    const req = String(n.assignedBy || n.createdBy || "").trim();
    if (days >= 5 && days % 5 === 0 && req && !same(req, raw)) out.push({ name: coverOf(users, req, todayYmd), role: "requester", need: item });
  });
  return out;
}
// One push per person per role. `needId` is set only when exactly one task is
// in the push, so the tap lands on that task; otherwise on the list.
function chaseMessages(targets) {
  const by = new Map();
  (targets || []).forEach(t => {
    if (!t || !t.name) return;
    const k = norm(t.name) + "|" + t.role;
    if (!by.has(k)) by.set(k, { name: t.name, role: t.role, items: [] });
    by.get(k).items.push(t.need);
  });
  const first = (s) => String(s || "").split(" ")[0];
  return [...by.values()].map(({ name, role, items }) => {
    items.sort((a, b) => (b.urgent - a.urgent) || (b.daysOverdue - a.daysOverdue));
    const lead = items[0];
    const one = `${lead.urgent ? "URGENT · " : ""}${lead.text}${lead.jobName ? ` · ${lead.jobName}` : ""} (${lead.daysOverdue}d overdue)`;
    const more = items.length > 1 ? ` +${items.length - 1} more` : "";
    return role === "assignee"
      ? { name, title: items.length === 1 ? "⏰ Still open on you" : `⏰ ${items.length} overdue tasks on you`, body: `${one}${more} — reply, snooze, or mark it done`, view: "myday", needId: items.length === 1 ? lead.id : "" }
      : { name, title: items.length === 1 ? "⏰ Still waiting on someone" : `⏰ ${items.length} tasks you sent are still open`, body: `${first(lead.assignee)} hasn't closed: ${one}${more}`, view: "myday", needId: items.length === 1 ? lead.id : "" };
  });
}
module.exports = { digestCounts, digestLine, chaseTargets, chaseMessages };
