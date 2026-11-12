"use strict";
// Dashboard history and feed health (v626 ship 2, dashboard audit 2026-11-11).
//
// Why: every number the office dashboard gets from Simpro lives in ONE doc per feed that is
// overwritten each night (settings/goalsSimpro, phaseCosts, scoreboardCompleted, simproTotals).
// Nothing kept yesterday's value, so "is it getting better?" had no answer, the first pull of a new
// year erased last year's final numbers, and a night that failed left no trace on the page.
//
// Pure: no Firebase. functions/index.js reads the four docs (field-masked) and writes
//   dash_history/{YYYY-MM-DD}   one small row per day, create-only (never rewritten)
//   settings/dashFeeds          each feed's last good data time and whether it is on schedule
//   settings/goalsSimpro_<year> last year's final Goals doc, kept once at the first pull of a new year
// scripts/dash-history-test.js runs the same functions.

const TZ = "America/Denver";
const HOUR = 3600e3;
// Each feed: the settings doc's own time field, the autoDocRuns key its scheduler stamps, and
// whether it runs every day or weekdays only.
const FEEDS = [
  { k: "costs", label: "Job Costs", run: "feedPhaseCosts", weekdaysOnly: false },
  { k: "scoreboard", label: "Scoreboard", run: "feedScoreboard", weekdaysOnly: false },
  { k: "goals", label: "Goals", run: "feedGoals", weekdaysOnly: false },
  { k: "totals", label: "Simpro totals", run: "feedSimproTotals", weekdaysOnly: true },
];
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const r1 = (v) => (num(v) == null ? null : Math.round(v * 10) / 10);

// YYYY-MM-DD and the weekday (0 = Sunday) in Mountain time, whatever the server's clock zone is.
function localDay(now, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t) => (parts.find(p => p.type === t) || {}).value || "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")) };
}

// How old a feed's data may be before it counts as late. A daily feed: 30 hours. The weekday feed
// (6:15 AM Mon–Fri): 30 hours, stretched over the weekend so Friday's copy is fine on Saturday (54 h)
// and Sunday (78 h). Monday is a normal day: the check runs at 6:45, after Monday's 6:15 pull, so a
// copy still from Friday on Monday morning means Monday's pull was missed.
function maxAgeHours(feed, now, tz = TZ) {
  if (!feed.weekdaysOnly) return 30;
  const { dow } = localDay(now, tz);
  return dow === 6 ? 54 : dow === 0 ? 78 : 30;
}

// at: { costs, scoreboard, goals, totals } = each doc's own time (ISO). runs = settings/autoDocRuns.
// → { [k]: { label, at, ageH, ok, late, error } }. ok is false when there is no data time, the data
// is older than the feed's allowance, or the scheduler's newest stamp is a failure.
function feedHealth({ at = {}, runs = {}, now = new Date(), tz = TZ } = {}) {
  const out = {};
  FEEDS.forEach(f => {
    const iso = String(at[f.k] || ""), ms = Date.parse(iso);
    const ageH = ms ? Math.round(((now - ms) / HOUR) * 10) / 10 : null;
    const late = ageH == null || ageH > maxAgeHours(f, now, tz);
    const run = runs && runs[f.run] && !runs[f.run].test ? runs[f.run] : null;
    const runMs = run ? Date.parse(run.lastRunAt || "") : 0;
    const failed = !!run && run.ok === false && (!ms || runMs >= ms);
    out[f.k] = { label: f.label, at: ms ? iso : "", ageH, late, ok: !late && !failed, error: failed ? String(run.error || "failed").slice(0, 200) : "" };
  });
  return out;
}

// One day's row. Inputs are the (field-masked) settings docs; any of them may be missing.
// Simpro-derived numbers only — the app's own counts (open punch, quiet jobs, first pass) are
// computed in the browser by odModel and are not copied here.
function snapshotRow({ goals = null, costs = null, scoreboard = null, totals = null, feeds = {}, now = new Date(), tz = TZ } = {}) {
  const { ymd } = localDay(now, tz);
  const m = (goals && goals.measures) || {}, p2 = (goals && goals.phase2) || {};
  const byNo = (totals && totals.byNo) || {};
  let open = 0, contract = 0, invoiced = 0, left = 0;
  Object.values(byNo).forEach(e => {
    if (!e || e.stage !== "Progress" || num(e.total) == null) return;
    open++; contract += e.total; const inv = num(e.inv) || 0; invoiced += inv; left += Math.max(0, e.total - inv);
  });
  const row = {
    date: ymd, at: now.toISOString(),
    goals: goals ? {
      year: num(goals.year), pulledAt: String(goals.generated_at || ""), counted: num(m.counted), marginPct: r1(m.marginPct), hoursPct: r1(m.hoursPct), at15: num(m.at15),
      byTech: (Array.isArray(m.byTech) ? m.byTech : []).slice(0, 40).map(t => ({ tech: String((t && t.tech) || ""), n: num(t && t.n), marginPct: r1(t && t.marginPct), hoursPct: r1(t && t.hoursPct) })),
      warrantyPct: r1(p2.hours && p2.hours.warranty && p2.hours.warranty.sharePct), coHours: r1(p2.hours && p2.hours.co && p2.hours.co.hours),
      storeRuns: num(p2.storeRuns && p2.storeRuns.total), weeksAllTracked: num(p2.weekly && p2.weekly.weeksAll),
    } : null,
    costs: costs ? { pulledAt: String(costs.generated_at || ""), jobs: num(costs.counts && costs.counts.jobs), failed: num(costs.counts && costs.counts.failed) } : null,
    scoreboard: scoreboard ? { pulledAt: String(scoreboard.generated_at || ""), done: num(scoreboard.counts && scoreboard.counts.done), prog: num(scoreboard.counts && scoreboard.counts.prog) } : null,
    simpro: totals ? { pulledAt: String(totals.at || ""), entries: Object.keys(byNo).length, inProgress: open, contract: Math.round(contract), invoiced: Math.round(invoiced), leftToBill: Math.round(left) } : null,
    feeds: Object.fromEntries(Object.entries(feeds).map(([k, f]) => [k, { ok: !!f.ok, at: f.at || "", ageH: f.ageH == null ? null : f.ageH, error: f.error || "" }])),
  };
  return row;
}

// The Goals doc counts jobs invoiced THIS calendar year, so the first pull of a new year starts
// from nothing and overwrites last year's final numbers. → { id, doc } to keep once, or null.
function goalsYearEndCopy(prevDoc, year, docId = "goalsSimpro") {
  const py = prevDoc && Number(prevDoc.year);
  if (!py || !Number(year) || py >= Number(year)) return null;
  return { id: `${docId}_${py}`, doc: { ...prevDoc, keptAt: new Date().toISOString(), keptWhy: `final ${py} numbers, kept before the first ${year} pull` } };
}

module.exports = { FEEDS, TZ, localDay, maxAgeHours, feedHealth, snapshotRow, goalsYearEndCopy };
