// ─────────────────────────────────────────────────────────────
// Weekly Lead Meeting doc (v536) — PURE module (no I/O).
//
// Koy, 2026-10-13: the Oct 7 "Weekly Lead Meeting" doc ("Hours vs bid shows
// only jobs whose margin moved since the last meeting doc") was a one-off;
// "Yes, I want that every week." The Tuesday foremanMeetingPrep run already
// builds the full Foreman + Lead section (with every job's Simpro margin) for
// the running notes doc. weeklyModel() turns that model into the weekly doc's
// model: Hours vs bid keeps only jobs whose margin moved since the last run
// (each with "was N% last week"), the done groups keep only jobs finished since
// the last run, and it returns the margin history to save for next week.
//
// history (meetingPrepState/leadMargins): { lastYmd, jobs: { <simproNo>: [{ d: "YYYY-MM-DD", m: 51.2 }] } }
// ─────────────────────────────────────────────────────────────
"use strict";

const DOC_TAG = "| Weekly Lead Meeting";
const KEEP_ENTRIES = 8;      // weeks of margin kept per job
const DROP_AFTER_DAYS = 90;  // jobs not seen this long fall out of the history

const dayNum = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; };
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wasLabel = (prevYmd, todayYmd) => {
  const gap = dayNum(todayYmd) - dayNum(prevYmd);
  if (gap <= 10) return "last week";
  if (gap <= 17) return "two weeks ago";
  const [, mo, da] = String(prevYmd).split("-");
  return `on ${+mo}/${+da}`;
};
const r1 = (n) => Math.round(n * 10) / 10;

// model: foremanMeetingPrep.buildModel() output. todayYmd: the run's Mountain date.
function weeklyModel(model, history, todayYmd) {
  const hist = history && typeof history === "object" ? history : {};
  const jobs = hist.jobs && typeof hist.jobs === "object" ? hist.jobs : {};
  const lastYmd = typeof hist.lastYmd === "string" ? hist.lastYmd : "";
  const prevOf = (sn) => {
    const list = Array.isArray(jobs[sn]) ? jobs[sn] : [];
    let best = null;
    list.forEach(e => { if (e && typeof e.m === "number" && e.d < todayYmd && (!best || e.d > best.d)) best = e; });
    return best;
  };
  const wm = JSON.parse(JSON.stringify(model, (k, v) => v));   // plain deep copy (Dates become strings; restored below)
  const restoreDone = (src, dst) => dst.forEach((r, i) => { if (src[i] && src[i].done instanceof Date) r.done = src[i].done; });
  ["roughDone", "completed"].forEach(k => restoreDone(model.hours[k] || [], wm.hours[k] || []));

  let moved = 0, tracked = 0;
  if (!wm.hours.error) {
    ["rough", "finish", "other"].forEach(k => {
      wm.hours[k] = (wm.hours[k] || []).filter(r => {
        if (!r.sn || typeof r.margin !== "number") return false;      // no margin ⇒ nothing to compare
        tracked++;
        const prev = prevOf(r.sn);
        if (!prev) { r.firstTracked = true; return !lastYmd; }        // only on the very first run is "new" everything
        if (Math.round(prev.m) === Math.round(r.margin)) return false;
        r.was = { margin: Math.round(prev.m), label: wasLabel(prev.d, todayYmd) };
        moved++;
        return true;
      });
    });
    // Done groups: only jobs finished since the last weekly doc (7 days on the first run).
    const sinceDay = lastYmd ? dayNum(lastYmd) : dayNum(todayYmd) - 7;
    ["roughDone", "completed"].forEach(k => {
      wm.hours[k] = (wm.hours[k] || []).filter(r => r.done instanceof Date && dayNum(ymdOf(r.done)) > sinceDay);
    });
  }
  wm.heading = String(model.heading || "").replace(/\|\s*Foreman \+ Lead Meeting\s*$/, DOC_TAG);
  wm.note = "Combines the Foreman + Lead notes and the Lead Meeting Prep. Hours vs bid shows only jobs whose margin moved since the last meeting doc; every job is in the Foreman + Lead notes doc.";
  wm.hoursNote = lastYmd
    ? `Only jobs whose margin moved since ${lastYmd}. "Was" is the margin at the last meeting doc (or the one before, if it had none).`
    : "First week tracked: every job with a margin is listed. From next week, only jobs whose margin moved.";
  wm.hoursTitles = { roughDone: "Rough completed since last meeting", completed: "Finish completed since last meeting" };

  // Next history: today's margin for every job that has one, any bucket.
  const next = { lastYmd: todayYmd, jobs: {} };
  const todayN = dayNum(todayYmd);
  Object.keys(jobs).forEach(sn => {
    const list = (Array.isArray(jobs[sn]) ? jobs[sn] : []).filter(e => e && typeof e.m === "number" && dayNum(e.d) != null && todayN - dayNum(e.d) <= DROP_AFTER_DAYS && e.d !== todayYmd);
    if (list.length) next.jobs[sn] = list;
  });
  ["rough", "finish", "other", "roughDone", "completed"].forEach(k => (model.hours[k] || []).forEach(r => {
    if (!r || !r.sn || typeof r.margin !== "number") return;
    const list = (next.jobs[r.sn] || []).filter(e => e.d !== todayYmd);
    list.push({ d: todayYmd, m: r1(r.margin) });
    list.sort((a, b) => a.d.localeCompare(b.d));
    next.jobs[r.sn] = list.slice(-KEEP_ENTRIES);
  }));
  return { model: wm, history: next, moved, tracked };
}

// "Oct 14, 2026 | Foreman + Lead Meeting" → "2026-10-14" (doc title date).
function meetingYmd(heading) {
  const d = new Date(String(heading || "").split("|")[0].trim());
  return isNaN(d.getTime()) ? "" : ymdOf(d);
}

module.exports = { weeklyModel, meetingYmd, wasLabel, DOC_TAG };
