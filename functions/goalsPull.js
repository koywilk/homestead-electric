// goalsPull.js — the pure half of the nightly Goals pull (SW v562, 2026-10-23).
//
// Josh's Builder Scorecard rule, adopted by Koy on 2026-10-23 as the Goals tab's Simpro
// truth: every customer invoice dated this calendar year → its jobs → each job's Simpro
// Totals. A job COUNTS when it is 100% invoiced and has real costs posted. Margin is
// weighted (Σ net profit ÷ Σ contract ex tax, Simpro cost rates), hours are Σ actual ÷
// Σ estimate, credit is Simpro's technician. This is deliberately NOT the Scoreboard
// tab's rule (per-job average, completed this year, app foreman/lead credit).
//
// No I/O here: index.js does the Simpro reads and the Firestore write; the dashboard
// does the same math on the slim rows this file produces (odGoalsModel in src/App.js).
// Tested by scripts/goals-pull-test.js.
"use strict";

const num = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r1 = (v) => { const n = num(v); return n == null ? null : Math.round(n * 10) / 10; };
const r0 = (v) => { const n = num(v); return n == null ? null : Math.round(n); };

// Division from Simpro's "Business Group" custom field; "" when unset (the dashboard,
// like the Scoreboard page, treats "" as residential).
function divisionOf(job) {
  const bg = (job && Array.isArray(job.CustomFields) ? job.CustomFields : []).find(c => c && c.CustomField && /business group/i.test(c.CustomField.Name || ""));
  if (!bg || !bg.Value) return "";
  const d = String(bg.Value).toLowerCase().replace(/\s+/g, "");
  return d === "multi-family" ? "multifamily" : d;
}

// One slim row per job — what settings/goalsSimpro keeps (percent / hour / dollar inputs only).
function slimJob(j) {
  const t = (j && j.Totals) || {}, rc = t.ResourcesCost || {};
  const techs = Array.isArray(j && j.Technicians) ? j.Technicians.map(x => x && x.Name).filter(Boolean) : [];
  const row = {
    id: j.ID, name: (j && j.Name) || "", stage: (j && j.Stage) || "", status: String((j && j.Status && j.Status.Name) || "").replace(/^Job\s*-\s*/i, "").trim(),
    type: (j && j.Type) || null, division: divisionOf(j), tech: techs.length ? techs.join(" / ") : "UNASSIGNED",
    contract: r0(j && j.Total && j.Total.ExTax), inv_pct: r1(t.InvoicePercentage),
    nm_act: r1(t.NettMargin && t.NettMargin.Actual), nm_est: r1(t.NettMargin && t.NettMargin.Estimate),
    npl_act: r0(t.NettProfitLoss && t.NettProfitLoss.Actual),
    hrs_act: r1(rc.LaborHours && rc.LaborHours.Actual), hrs_est: r1(rc.LaborHours && rc.LaborHours.Estimate),
    mat_act: r0(t.MaterialsCost && t.MaterialsCost.Actual), lab_act: r0(rc.Labor && rc.Labor.Actual),
  };
  row.counts = jobCounts(row);
  return row;
}

// Counts toward the headline: fully invoiced (Koy 2026-10-17: 99.95 covers the last
// invoice's rounding) and costs posted (Simpro shows an empty job as 100% margin).
function jobCounts(s) {
  if (!s) return false;
  const invoiced = s.inv_pct != null && s.inv_pct >= 99.95;
  const costs = s.nm_act != null && s.nm_act !== 100 && ((s.mat_act || 0) > 0 || (s.lab_act || 0) > 0 || (s.hrs_act || 0) > 0);
  return !!(invoiced && costs);
}

function distinctJobIds(invoices) {
  const out = [];
  (invoices || []).forEach(i => (i && Array.isArray(i.Jobs) ? i.Jobs : []).forEach(j => { const id = num(j && j.ID); if (id != null && out.indexOf(id) < 0) out.push(id); }));
  return out;
}

const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : "";

// Days to collect and the open book, over the year's customer invoices. Credits are not
// invoices. A paid invoice whose DatePaid is before DateIssued (Simpro data entry) is left
// out of the days-to-paid average rather than pulling it negative.
function invoiceStats(invoices, todayYmd, divisionOfJob) {
  const real = (invoices || []).filter(i => i && !i.IsCredit);
  const days = [];
  let paidN = 0;
  const open = { n: 0, owed: 0, pastDueN: 0, pastDue: 0, over60N: 0, over60: 0 };
  const byDivision = { commercial: 0, residential: 0, other: 0 };
  real.forEach(i => {
    const issued = ymd(i.DateIssued), total = i.Total || {};
    const ex = num(total.ExTax) || 0;
    const jid = i.Jobs && i.Jobs[0] && num(i.Jobs[0].ID);
    const div = jid != null && typeof divisionOfJob === "function" ? (divisionOfJob(jid) || "") : "";
    byDivision[div === "commercial" ? "commercial" : (div === "residential" || div === "" ? "residential" : "other")] += ex;
    if (i.IsPaid) {
      // paid.n = invoices that contribute a day count; a bad-dated one is reported nowhere.
      const paid = ymd(i.DatePaid);
      if (issued && paid) { const d = dayDiff(issued, paid); if (d >= 0) { days.push(d); paidN++; } }
      return;
    }
    const owed = Math.max(0, (num(total.IncTax) || 0) - (num(total.Paid) || 0));
    open.n++; open.owed += owed;
    const due = ymd(i.DueDate);
    if (due && todayYmd && due < todayYmd) { open.pastDueN++; open.pastDue += owed; }
    if (issued && todayYmd && dayDiff(issued, todayYmd) > 60) { open.over60N++; open.over60 += owed; }
  });
  days.sort((a, b) => a - b);
  const avg = days.length ? Math.round(days.reduce((s, x) => s + x, 0) / days.length) : null;
  const med = !days.length ? null : (days.length % 2 ? days[days.length >> 1] : Math.round((days[days.length / 2 - 1] + days[days.length / 2]) / 2));
  ["owed", "pastDue", "over60"].forEach(k => { open[k] = Math.round(open[k]); });
  Object.keys(byDivision).forEach(k => { byDivision[k] = Math.round(byDivision[k]); });
  return { count: real.length, paid: { n: paidN, avgDays: avg, medianDays: med }, open, byDivision };
}

// The headline math on slim rows. The dashboard repeats it (same formulas) so the two
// can be checked against each other; the server copy also goes in the cache doc.
function measures(slim) {
  const c = (slim || []).filter(jobCounts);
  const sum = (a, f) => a.reduce((s, j) => s + (num(f(j)) || 0), 0);
  const pct = (a, b) => (b > 0 ? Math.round(1000 * a / b) / 10 : null);
  const byTech = {};
  c.forEach(j => {
    const t = String(j.tech || "").split(" / ")[0] || "UNASSIGNED";
    const o = byTech[t] || (byTech[t] = { tech: t, n: 0, npl: 0, rev: 0, ha: 0, he: 0 });
    o.n++; o.npl += num(j.npl_act) || 0; o.rev += num(j.contract) || 0; o.ha += num(j.hrs_act) || 0; o.he += num(j.hrs_est) || 0;
  });
  const techs = Object.values(byTech).map(o => ({ tech: o.tech, n: o.n, hoursPct: o.he > 0 ? Math.round(100 * o.ha / o.he) : null, marginPct: pct(o.npl, o.rev) }))
    .sort((a, b) => b.n - a.n || a.tech.localeCompare(b.tech));
  return {
    counted: c.length,
    marginPct: pct(sum(c, j => j.npl_act), sum(c, j => j.contract)),
    hoursPct: sum(c, j => j.hrs_est) > 0 ? Math.round(100 * sum(c, j => j.hrs_act) / sum(c, j => j.hrs_est)) : null,
    at15: c.filter(j => num(j.nm_act) != null && j.nm_act >= 15).length,
    byTech: techs,
  };
}

module.exports = { slimJob, jobCounts, distinctJobIds, invoiceStats, measures, divisionOf };
