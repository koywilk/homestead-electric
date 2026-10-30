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
// Phase 2 (bottom) takes an injected `get` like collectSimproHours, so it has no I/O of its own.
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


// ── Phase 2 (SW v583, dashboard audit 2026-10-30) ─────────────────────────────
// The four 2027-scoreboard cards that v562 left grey: warranty hours, change-order
// hours in their own cost center, Home Depot / ACE runs, hours tracked weekly. Pure
// math below; pullPhase2 at the bottom takes an injected `get` (collectSimproHours's
// pattern) so index.js, the tests and a read-only local run share one code path.
// Everything lands under ONE new key, settings/goalsSimpro.phase2 — Phase 1 is untouched.

// Which Phase 2 bucket a job cost center belongs to, from its COMPANY cost center's name
// (probe 2026-10-30: "Residential (Warranty)", "Residential - Change Order (Rough In)",
// "Commercial - Change Order (Finish)", …), falling back to the job cost center's own
// name when the company one is missing. Everything else is null.
function phase2CcKind(cc) {
  const company = String((cc && cc.CostCenter && cc.CostCenter.Name) || (cc && cc.companyCc) || "").trim();
  const own = String((cc && cc.Name) || (cc && cc.name) || "").trim();
  const t = (company || own).toLowerCase();
  if (/warranty/.test(t)) return "warranty";
  if (/change\s*order/.test(t)) return "co";
  return null;
}

// Warranty and change-order hours over the slim rows (this year's jobs). `ccs` are the
// warranty / CO job cost centers already read: { jobId, kind, hrsAct, hrsEst }. Hours are
// Simpro's LaborHours; the share's denominator is every actual hour on the same jobs.
function phase2Hours(ccs, slim) {
  const rows = (ccs || []).filter(c => c && (c.kind === "warranty" || c.kind === "co"));
  const allHours = (slim || []).reduce((s, j) => s + (num(j && j.hrs_act) || 0), 0);
  const mk = () => ({ hours: 0, estHours: 0, ccs: 0, withHours: 0, expected: 0, jobs: 0, byJob: {} });
  const o = { warranty: mk(), co: mk() };
  rows.forEach(c => {
    const b = o[c.kind], h = num(c.hrsAct) || 0, e = num(c.hrsEst) || 0, k = String(c.jobId);
    b.ccs++; b.hours += h; b.estHours += e;
    if (h > 0) b.withHours++;
    if (e > 0) b.expected++;                       // a CO sold with hours should get hours booked
    if (e > 0 && h > 0) b.expectedWith = (b.expectedWith || 0) + 1;
    b.byJob[k] = r1((b.byJob[k] || 0) + h);
  });
  ["warranty", "co"].forEach(k => { const b = o[k]; b.jobs = Object.keys(b.byJob).length; b.hours = r1(b.hours); b.estHours = r1(b.estHours); b.expectedWith = b.expectedWith || 0; });
  o.allHours = r1(allHours);
  o.warranty.sharePct = allHours > 0 ? Math.round(1000 * o.warranty.hours / allHours) / 10 : null;
  return o;
}

// The last `n` full Monday–Sunday weeks before the week `todayYmd` is in.
function weekRanges(todayYmd, n = 8) {
  const t = Date.UTC(+todayYmd.slice(0, 4), +todayYmd.slice(5, 7) - 1, +todayYmd.slice(8, 10));
  const dow = (new Date(t).getUTCDay() + 6) % 7;               // Monday = 0
  const thisMon = t - dow * 864e5;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const out = [];
  for (let i = n; i >= 1; i--) { const start = thisMon - i * 7 * 864e5; out.push({ start: iso(start), end: iso(start + 6 * 864e5) }); }
  return out;
}

// "Every active crew member" = Settings › Team: active, titled foreman / jr. foreman / lead /
// crew, not an outside contractor (Paul). Office and admins are not crew.
function crewMembers(users) {
  return (users || []).filter(u => u && String(u.name || "").trim() && u.active !== false && ["foreman", "jrforeman", "lead", "crew"].includes(String(u.title || "").toLowerCase()) && String(u.access || "").toLowerCase() !== "contractor")
    .map(u => String(u.name).trim());
}
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
// Team names → Simpro employees, by normalized full name ("Justin Cloward " matches "Justin Cloward").
function matchEmployees(crewNames, employees) {
  const emp = (employees || []).filter(e => e && !e.Archived && e.ID != null);
  const matched = [], unmatched = [];
  (crewNames || []).forEach(n => { const e = emp.find(x => nameKey(x.Name) === nameKey(n)); if (e) matched.push({ name: n, id: e.ID }); else unmatched.push(n); });
  return { matched, unmatched };
}

// Hours tracked weekly: for each of the weeks, did every crew member log JOB hours (timesheet
// entries of ScheduleType "Job"; activities such as shop time do not count)? `people` =
// [{ name, entries: [{ Date, TotalHrs, ScheduleType }] }]. Someone with no job hours in any
// of the weeks is listed under `idle` and left out of the weekly test (a new hire's first
// days, or a Team row that should be deactivated) — the card says who.
function weeklyHours(weeks, people) {
  const inWeek = (d, w) => d >= w.start && d <= w.end;
  const ppl = (people || []).map(p => {
    const job = (p.entries || []).filter(e => e && /^job$/i.test(String(e.ScheduleType || "")) && (num(e.TotalHrs) || 0) > 0 && ymd(e.Date));
    const byWeek = weeks.map(w => r1(job.filter(e => inWeek(ymd(e.Date), w)).reduce((s, e) => s + (num(e.TotalHrs) || 0), 0)));
    return { name: p.name, byWeek, weeksLogged: byWeek.filter(h => h > 0).length, hours: r1(byWeek.reduce((s, h) => s + h, 0)) };
  });
  const idle = ppl.filter(p => p.weeksLogged === 0).map(p => p.name);
  const active = ppl.filter(p => p.weeksLogged > 0);
  const rows = weeks.map((w, i) => { const missed = active.filter(p => !(p.byWeek[i] > 0)).map(p => p.name); return { start: w.start, end: w.end, logged: active.length - missed.length, of: active.length, all: active.length > 0 && missed.length === 0, missed }; });
  const weeksAll = rows.filter(r => r.all).length;
  return { weeks: rows, weeksAll, of: weeks.length, sharePct: weeks.length ? Math.round(100 * weeksAll / weeks.length) : null,
    people: active.map(p => ({ name: p.name, weeksLogged: p.weeksLogged, hours: p.hours })).sort((a, b) => a.weeksLogged - b.weeksLogged || a.name.localeCompare(b.name)),
    peopleAll: active.filter(p => p.weeksLogged === weeks.length).length, idle };
}

// Store-run vendors: Home Depot and ACE Hardware (not Ace Rentals), by name, from Simpro's vendor list.
function storeVendorIds(vendors) {
  const out = { homeDepot: [], ace: [] };
  (vendors || []).forEach(v => { if (!v || v.ID == null) return; const n = String(v.Name || "");
    if (/home\s*depot/i.test(n)) out.homeDepot.push(v.ID); else if (/\bace\b/i.test(n) && !/rental/i.test(n)) out.ace.push(v.ID); });
  return out;
}
const storeOf = (name) => /home\s*depot/i.test(String(name || "")) ? "homeDepot" : (/\bace\b/i.test(String(name || "")) && !/rental/i.test(String(name || ""))) ? "ace" : null;
// Home Depot / ACE runs = Simpro vendor orders to those vendors this year (crew Simpro Mobile POs
// and the app's "Get a PO number" both make one, so the app's log is a sub-line, never added on
// top). `orders` = [{ ID, DateIssued, Vendor: { ID, Name } }]; `appLog` = material_po_log docs
// of kind "number" ({ supplierName, at }). Rates: the year so far and the last 8 full weeks.
function storeRuns(orders, appLog, todayYmd, weeks) {
  const yr = todayYmd.slice(0, 4);
  const yearOrders = (orders || []).filter(o => o && ymd(o.DateIssued).startsWith(yr + "-") && storeOf(o.Vendor && o.Vendor.Name));
  const by = { homeDepot: 0, ace: 0 }; yearOrders.forEach(o => { by[storeOf(o.Vendor.Name)]++; });
  const weeksElapsed = Math.max(1, dayDiff(`${yr}-01-01`, todayYmd) + 1) / 7;
  const w8 = weeks && weeks.length ? weeks : weekRanges(todayYmd, 8);
  const last8 = yearOrders.filter(o => { const d = ymd(o.DateIssued); return d >= w8[0].start && d <= w8[w8.length - 1].end; }).length;
  const byWeek = w8.map(w => yearOrders.filter(o => { const d = ymd(o.DateIssued); return d >= w.start && d <= w.end; }).length);
  const app = (appLog || []).filter(l => l && String(l.kind || "number") === "number" && storeOf(l.supplierName) && ymd(l.at).startsWith(yr + "-")).length;
  return { year: Number(yr), total: yearOrders.length, homeDepot: by.homeDepot, ace: by.ace, app, perWeek: Math.round(10 * yearOrders.length / weeksElapsed) / 10,
    last8, last8PerWeek: Math.round(10 * last8 / w8.length) / 10, byWeek, weeks: w8.map(w => w.start) };
}

// The whole Phase 2 read with injected I/O. `get(path)` returns parsed JSON or null (never throws
// for a 4xx — index.js's getJson logs and returns null); `fs` = { users: Settings › Team list,
// appLog: material_po_log "number" docs }. ~30 list calls + one per warranty / CO section + one
// per crew member. Each part fails on its own: a thrown part leaves its key null with `errors`.
async function pullPhase2({ get, year, todayYmd, slim, users, appLog, concurrency = 4, log = () => {} }) {
  const errors = [];
  const weeks = weekRanges(todayYmd, 8);
  const jobSet = new Set((slim || []).map(j => String(j.id)));
  const run = async (items, f) => { const q = items.slice(); await Promise.all(Array.from({ length: concurrency }, async () => { while (q.length) { const x = q.shift(); await f(x); } })); };
  // 1. warranty + CO cost centers on this year's jobs
  let hours = null;
  try {
    const list = [];
    for (let page = 1; page <= 60; page++) {
      const d = await get(`/jobCostCenters/?pageSize=250&page=${page}&columns=ID,Name,Job,Section,CostCenter`);
      if (!Array.isArray(d)) { if (page === 1) throw new Error("jobCostCenters list failed"); break; }
      list.push(...d);
      if (d.length < 250) break;
    }
    const wanted = list.filter(c => c && c.Job && jobSet.has(String(c.Job.ID)) && phase2CcKind(c));
    const groups = {};
    wanted.forEach(c => { const k = `${c.Job.ID}/${c.Section && c.Section.ID}`; (groups[k] = groups[k] || { jobId: c.Job.ID, sectionId: c.Section && c.Section.ID, ids: new Set() }).ids.add(c.ID); });
    const ccs = [];
    await run(Object.values(groups), async (g) => {
      const d = await get(`/jobs/${g.jobId}/sections/${g.sectionId}/costCenters/?columns=ID,Name,CostCenter,Totals&pageSize=250`);
      if (!Array.isArray(d)) { errors.push(`section ${g.jobId}/${g.sectionId} unread`); return; }
      d.forEach(cc => { const kind = phase2CcKind(cc); if (!kind || !g.ids.has(cc.ID)) return; const lh = cc.Totals && cc.Totals.ResourcesCost && cc.Totals.ResourcesCost.LaborHours;
        ccs.push({ jobId: g.jobId, ccId: cc.ID, kind, name: cc.Name, companyCc: cc.CostCenter && cc.CostCenter.Name, hrsAct: lh ? num(lh.Actual) || 0 : 0, hrsEst: lh ? num(lh.Estimate) || 0 : 0 }); });
    });
    hours = phase2Hours(ccs, slim);
    hours.listed = list.length; hours.sections = Object.keys(groups).length;
    log("phase2 hours", { listed: list.length, wanted: wanted.length, sections: hours.sections, ccs: ccs.length });
  } catch (e) { errors.push(`hours: ${e.message}`); }
  // 2. Home Depot / ACE runs
  let runs = null;
  try {
    const vendors = await get("/vendors/?pageSize=250&columns=ID,Name");
    if (!Array.isArray(vendors)) throw new Error("vendor list failed");
    const ids = storeVendorIds(vendors);
    const orders = [];
    for (const vid of [...ids.homeDepot, ...ids.ace]) {
      for (let page = 1; page <= 20; page++) {
        const d = await get(`/vendorOrders/?pageSize=250&page=${page}&columns=ID,DateIssued,Vendor&Vendor.ID=${vid}&DateIssued=between(${year}-01-01,${year}-12-31)`);
        if (!Array.isArray(d)) { errors.push(`vendor ${vid} orders page ${page} unread`); break; }
        orders.push(...d);
        if (d.length < 250) break;
      }
    }
    runs = storeRuns(orders, appLog, todayYmd, weeks);
    log("phase2 store runs", { vendors: ids, orders: orders.length, app: runs.app });
  } catch (e) { errors.push(`storeRuns: ${e.message}`); }
  // 3. hours tracked weekly
  let weekly = null;
  try {
    const employees = await get("/employees/?pageSize=100&columns=ID,Name,Archived");
    if (!Array.isArray(employees)) throw new Error("employee list failed");
    const crew = crewMembers(users);
    const { matched, unmatched } = matchEmployees(crew, employees);
    const people = [];
    await run(matched, async (m) => {
      const d = await get(`/employees/${m.id}/timesheets/?StartDate=${weeks[0].start}&EndDate=${weeks[weeks.length - 1].end}`);
      if (!Array.isArray(d)) { errors.push(`timesheets ${m.name} unread`); return; }
      people.push({ name: m.name, entries: d });
    });
    weekly = weeklyHours(weeks, people);
    weekly.unmatched = unmatched; weekly.crew = crew.length;
    log("phase2 weekly", { crew: crew.length, matched: matched.length, unmatched, weeksAll: weekly.weeksAll, idle: weekly.idle });
  } catch (e) { errors.push(`weekly: ${e.message}`); }
  return { generated_at: new Date().toISOString(), year, hours, storeRuns: runs, weekly, errors };
}

module.exports = { slimJob, jobCounts, distinctJobIds, invoiceStats, measures, divisionOf,
  phase2CcKind, phase2Hours, weekRanges, crewMembers, matchEmployees, weeklyHours, storeVendorIds, storeRuns, pullPhase2 };
