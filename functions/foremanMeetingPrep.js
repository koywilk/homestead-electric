// ─────────────────────────────────────────────────────────────
// Foreman + Lead Meeting Prep — PURE module (no Firestore, no network, no requires).
//
//   parseLastActions(doc)          → { fromLabel, open: [text...] } from the top section of the notes doc
//   buildModel(inputs)             → plain model (all predicates, no I/O)
//   renderLines(model)             → [{ text, kind }] — the new section, top to bottom
//   docsRequests(lines, at = 1)    → Docs API batchUpdate requests that insert the lines at `at`
//   collectSimproHours(nos, getJson) → per-job margin + rough/finish/extras labor hours (I/O injected)
//
// One running Google Doc ("Foreman + Lead Meeting — Weekly Notes") is attached to
// the Wednesday 6:30 meeting. Every Tuesday evening the orchestrator
// (index.js exports.foremanMeetingPrep) reads the doc, carries forward the
// unchecked action items from the newest section, and inserts the coming
// meeting's section at the top. Sections (Koy, 2026-09-21, matches the Meetings
// agenda): carried action items · needs · this week's Simpro schedule · hours vs
// bid · inspections since last meeting · crew out · action items.
//
// Every section degrades independently: a thrown section renders one grey line
// and never kills the run. Kept pure so scripts can dry-run byte-identical output.
// ─────────────────────────────────────────────────────────────

const TZ = "America/Denver";
const SECTION_TAG = "| Foreman + Lead Meeting";  // heading suffix — parseLastActions keys on it
const INSPECTION_DAYS = 7;
const PTO_DAYS = 7;
const NEEDS_CAP = 30;
const COMPLETED_DAYS = 30;   // "Completed" hours/margin group looks back this far

// ── date helpers (same accept-anything parser the lead prep uses) ────────────
function toDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") { try { const d = v.toDate(); return isNaN(d.getTime()) ? null : d; } catch (e) { return null; } }
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const arr = (v) => (Array.isArray(v) ? v : []);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
const clip = (s, n = 90) => { s = stripHtml(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Residential filter — a job belongs to the meeting if its foreman OR lead is one
// of the residential crew (first-name match, case-insensitive). Empty list ⇒ all jobs.
function isResJob(j, crew) {
  if (!crew || !crew.length) return true;
  const set = new Set(crew.map(n => first(n).toLowerCase()));
  return set.has(first(j.foreman).toLowerCase()) || set.has(first(j.lead).toLowerCase());
}
// Effective phase status — mirrors the app's effRS/effFS (leadMeetingPrep.js).
const effStatus = (j, phase) => {
  const st = j[phase + "Status"];
  if (st) return st;
  const p = parseInt(j[phase + "Stage"]) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
};
const isComplete = (j) => j && (j.finishStatus === "complete" || parseInt(j.finishStage) === 100);
// When a job closed: the finish status date (set when the status flips), else the
// scheduled finish end, else the last save. Null ⇒ unknown ⇒ left out.
const completedOn = (j) => toDateAny(j.finishStatusDate) || toDateAny(j.finishScheduledEnd) || toDateAny(j.updated_at) || null;
// When rough closed: the rough status date, else the scheduled rough end.
const roughDoneOn = (j) => toDateAny(j.roughStatusDate) || toDateAny(j.roughScheduledEnd) || null;
function roughRecentlyDone(j, today, days = COMPLETED_DAYS) {
  if (!j || !j.name || j.type === "quote" || j.deleted || j.archived || j.archivedAt || isComplete(j)) return false;
  if (effStatus(j, "rough") !== "complete") return false;
  const d = roughDoneOn(j); if (!d) return false;
  const age = daysBetween(today, d);
  return age >= 0 && age <= days;
}
function recentlyCompleted(j, today, days = COMPLETED_DAYS) {
  if (!j || !j.name || j.type === "quote" || j.deleted || !isComplete(j)) return false;
  const d = completedOn(j); if (!d) return false;
  const age = daysBetween(today, d);
  return age >= 0 && age <= days;
}
const isActive = (j) => j && j.name && j.type !== "quote" && !j.archived && !j.deleted && !j.archivedAt &&
  !(j.finishStatus === "complete" || parseInt(j.finishStage) === 100);

// ── read the notes doc: newest section's unchecked action items ──────────────
// Sections start with an H1 whose text ends in SECTION_TAG. Inside a section the
// "Action items" heading (and "Carried from last week") opens a checklist; any
// other non-bullet paragraph closes it. Done = the paragraph's text is fully
// struck through (what Docs does when a checklist box is ticked) or the text
// starts with a ✓/[x]. Placeholder bullets ("Owner — what — by when") are skipped.
function parseLastActions(doc) {
  const empty = { fromLabel: "", open: [] };
  const content = doc && doc.body && Array.isArray(doc.body.content) ? doc.body.content : null;
  if (!content) return empty;
  const paras = content.filter(c => c && c.paragraph).map(c => {
    const els = arr(c.paragraph.elements).filter(e => e && e.textRun && e.textRun.content);
    const text = els.map(e => e.textRun.content).join("").replace(/\s+/g, " ").trim();
    const struck = els.length > 0 && els.every(e => !e.textRun.content.trim() || (e.textRun.textStyle && e.textRun.textStyle.strikethrough));
    return { text, bullet: !!c.paragraph.bullet, struck, style: (c.paragraph.paragraphStyle || {}).namedStyleType || "" };
  });
  let section = null;
  for (const p of paras) {
    if (!p.bullet && p.text.endsWith(SECTION_TAG)) {
      if (section) break;                    // second section = last week's; stop
      section = { label: p.text.replace(SECTION_TAG, "").trim(), open: [], inList: false };
      continue;
    }
    if (!section) continue;
    if (!p.bullet && /^(action items?|carried from last week)$/i.test(p.text)) { section.inList = true; continue; }
    if (!p.bullet && p.text) { section.inList = false; continue; }
    if (section.inList && p.bullet && p.text) {
      const t = p.text.replace(/^(\[\s*[xX✓]\s*\]|✓|✔)\s*/, "");
      const done = p.struck || t !== p.text;
      if (done || /^owner\s+[—-]\s+what/i.test(t)) continue;
      section.open.push(t);
    }
  }
  return section ? { fromLabel: section.label, open: section.open } : empty;
}


// ── Simpro hours + margin per job (I/O injected — getJson(path) → parsed JSON or null) ──
// For each Simpro job: /jobs/{id} Totals (net margin) and every cost center's
// LaborHours {Actual, Estimate}, bucketed by name: "rough" (/rough/i), "finish"
// (/finish|trim/i), everything else "extras" (change orders, feeds, add-ons).
// Cost-center list rows carry Totals on this tenant; a row without them falls
// back to the cost-center detail call. 5 jobs in flight at a time.
function bucketOf(name) {
  const n = String(name || "").toLowerCase();
  if (/rough/.test(n)) return "rough";
  if (/finish|trim/.test(n)) return "finish";
  return "extras";
}
async function collectSimproHours(simproNos, getJson, { concurrency = 5 } = {}) {
  const out = {};
  const one = async (sn) => {
    const rec = { margin: null, isEstimate: true, rough: null, finish: null, extras: null };
    const jobRows = await getJson(`/jobs/?ID=${encodeURIComponent(sn)}&pageSize=1&columns=ID,Totals`);
    const sj = Array.isArray(jobRows) ? jobRows[0] : null;
    const nm = sj && sj.Totals && sj.Totals.NettMargin;
    if (nm) {
      const hasReal = typeof nm.Actual === "number" && nm.Actual !== 100;
      rec.margin = hasReal ? nm.Actual : (typeof nm.Estimate === "number" ? nm.Estimate : null);
      rec.isEstimate = !hasReal;
    }
    const sections = await getJson(`/jobs/${encodeURIComponent(sn)}/sections/?columns=ID,Name&pageSize=100`);
    for (const sec of arr(sections)) {
      const ccs = await getJson(`/jobs/${encodeURIComponent(sn)}/sections/${sec.ID}/costCenters/?pageSize=250`);
      for (const cc of arr(ccs)) {
        let lh = cc && cc.Totals && cc.Totals.ResourcesCost && cc.Totals.ResourcesCost.LaborHours;
        if (!lh && cc && cc.ID != null) {
          const d = await getJson(`/jobs/${encodeURIComponent(sn)}/sections/${sec.ID}/costCenters/${cc.ID}`);
          lh = d && d.Totals && d.Totals.ResourcesCost && d.Totals.ResourcesCost.LaborHours;
        }
        if (!lh) continue;
        const b = bucketOf(cc.Name);
        const cur = rec[b] || { used: 0, est: 0 };
        cur.used += Number(lh.Actual) || 0;
        cur.est += Number(lh.Estimate) || 0;
        rec[b] = cur;
      }
    }
    out[sn] = rec;
  };
  const list = [...new Set(arr(simproNos).map(String).filter(Boolean))];
  for (let i = 0; i < list.length; i += concurrency) {
    await Promise.all(list.slice(i, i + concurrency).map(sn => one(sn).catch(() => { /* one job failing just leaves it off the list */ })));
  }
  return out;
}

// ── model ────────────────────────────────────────────────────────────────────
function buildModel(inputs) {
  // upcoming: the raw rows of settings/upcoming_jobs (the app's Upcoming tab);
  // upcomingBoard: leadMeetingPrep.buildModel().upcoming — dated rough/finish starts
  //   and pipeline rows off the job board ({name, kind, who, start, startsIn, note});
  // shipped: rows from leadMeetingPrep.extractShipped() ({title, version, date}) — app trainings.
  const { jobs = [], needs = [], pto = [], scheduleEntries = [], simproTotalsById = {},
          lastActions = null, upcoming = null, upcomingBoard = null, shipped = null, now, crew = [] } = inputs || {};
  const realNow = now instanceof Date ? now : new Date();
  const mtNow = new Date(realNow.toLocaleString("en-US", { timeZone: TZ }));
  const today = startOfDay(mtNow);
  const meeting = addDays(today, (3 - today.getDay() + 7) % 7);       // next Wednesday (today if Wed)
  const monday = addDays(meeting, -2);
  const weekDays = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map(i => addDays(monday, i));   // this week + next
  const weekYmds = weekDays.map(ymd);
  const DAY_LBL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed", "Thu", "Fri"];

  const m = {
    heading: `${meeting.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${SECTION_TAG}`,
    generated: realNow.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }),
    carried: { from: "", rows: [], error: false },
    needs: { bodies: [], tasks: [], error: false },
    schedule: { days: [], error: false },      // [{label, rows:[text]}]
    hours: { rough: [], finish: [], other: [], roughDone: [], completed: [], error: false },   // rows: {name, phase, cur, rough, finish, extras, margin, marginEst}
    inspections: { passed: [], failed: [], error: false },   // [text] — feed Highlight / Lowlight
    upcoming: { pastDue: [], soon: [], error: false },        // [text]
    shipped: { rows: [], more: 0, error: false },             // [text] — Training
    pto: { rows: [], error: false },
  };

  const live = arr(jobs).filter(isActive);
  const res = live.filter(j => isResJob(j, crew));
  const byId = new Map(res.map(j => [j.id, j]));
  const bySimpro = new Map(res.filter(j => j.simproNo).map(j => [String(j.simproNo), j]));
  const byAnySimpro = new Map(live.filter(j => j.simproNo).map(j => [String(j.simproNo), j]));   // any active job, for schedule labels

  // Carried action items
  try {
    if (lastActions && lastActions.open) { m.carried.from = lastActions.fromLabel || ""; m.carried.rows = lastActions.open.slice(0, 40); }
    m.carried.error = lastActions == null;
  } catch (e) { m.carried.error = true; }

  // Needs — open, residential (by foreman/job/assignee), oldest first
  try {
    const crewSet = new Set(arr(crew).map(n => first(n).toLowerCase()));
    const mine = (n) => !crewSet.size || crewSet.has(first(n.foreman).toLowerCase()) ||
      crewSet.has(first(n.assignedTo).toLowerCase()) || crewSet.has(first(n.createdBy).toLowerCase()) ||
      (n.jobId && byId.has(n.jobId));
    const open = arr(needs).filter(n => n && n.status !== "done" && mine(n))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    open.forEach(n => {
      const who = n.assignedTo ? ` (${first(n.assignedTo)})` : "";
      const job = n.jobName ? `${n.jobName} — ` : "";
      if (n.kind === "bodies") {
        const c = n.count ? `${n.count} ${n.count === 1 ? "body" : "bodies"}` : "bodies";
        m.needs.bodies.push(`${job}${c}${n.note ? `, ${clip(n.note, 40)}` : ""}`);
      } else {
        m.needs.tasks.push(`${job}${clip(n.text || "", 60)}${who}`);
      }
    });
    m.needs.bodies = m.needs.bodies.slice(0, NEEDS_CAP);
    m.needs.tasks = m.needs.tasks.slice(0, NEEDS_CAP);
  } catch (e) { m.needs.error = true; }

  // Schedule — Simpro bookings for the meeting week + next week, ONE line per job:
  // "Job — Mon–Thu". Every job with a Simpro booking that week.
  try {
    const crewSet = new Set(arr(crew).map(n => first(n).toLowerCase()));
    const byWeek = { this: new Map(), next: new Map() };     // week → (label → {days:Set, staff:Set})
    arr(scheduleEntries).forEach(s => {
      if (!s || s.Type !== "job" || !s.Date) return;
      const i = weekYmds.indexOf(s.Date); if (i < 0) return;
      const pid = String((s.Project && s.Project.ProjectID) || "");
      const nm = first(s.Staff && s.Staff.Name);
      if (!pid || !nm) return;
      // Every job booked in Simpro (Koy, 2026-09-21) — no residential filter here.
      const j = bySimpro.get(pid) || byAnySimpro.get(pid);
      const label = j ? j.name : ((s.Project && s.Project.Name) || `Simpro #${pid}`);
      const wk = i < 5 ? byWeek.this : byWeek.next;
      if (!wk.has(label)) wk.set(label, { days: new Set(), staff: new Set() });
      wk.get(label).days.add(i % 5); wk.get(label).staff.add(nm);
    });
    const dayRange = (set) => {
      const d = [...set].sort((a, b) => a - b);
      if (!d.length) return "";
      const lbl = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const consecutive = d.every((v, k) => k === 0 || v === d[k - 1] + 1);
      return d.length === 1 ? lbl[d[0]] : consecutive ? `${lbl[d[0]]}–${lbl[d[d.length - 1]]}` : d.map(v => lbl[v]).join("/");
    };
    m.schedule.days = ["this", "next"].map(w => ({
      week: w, label: w,
      rows: [...byWeek[w].entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([job, v]) => `${job} — ${dayRange(v.days)}`),   // no crew names (Koy, 2026-09-21)
    }));
  } catch (e) { m.schedule.error = true; }

  // Hours vs bid — per phase from Simpro cost centers ("Rough In" / "Finish"),
  // grouped by the phase the job is in (rough not complete ⇒ rough, else finish),
  // plus the job's net margin. simproTotalsById[sn] = { margin, isEstimate,
  // rough:{used,est}, finish:{used,est}, extras:{used,est} } (any part may be null).
  try {
    const ph = (p) => (p && p.est != null && p.used != null && p.est > 0) ? { used: Math.round(p.used), est: Math.round(p.est), ratio: p.used / p.est } : null;
    res.forEach(j => {
      const t = j.simproNo ? simproTotalsById[String(j.simproNo)] : null;
      if (!t) return;
      const rough = ph(t.rough), finish = ph(t.finish), extras = ph(t.extras);
      const inFinish = effStatus(j, "rough") === "complete" || (finish && finish.used > 0 && !(rough && rough.used > 0));
      // No "Rough"/"Finish" cost centers at all (small jobs, service calls) ⇒ "Other", whole-job hours.
      if (!rough && !finish) {
        if (!extras || extras.used <= 0) return;
        m.hours.other.push({ name: j.name, phase: "other", cur: extras, rough: null, finish: null, extras: null,
          margin: (typeof t.margin === "number") ? t.margin : null, marginEst: !!t.isEstimate, ratio: extras.ratio });
        return;
      }
      const cur = inFinish ? finish : rough;
      if (!inFinish && rough && rough.used === 0 && !(finish && finish.used > 0)) return;   // not started
      const row = { name: j.name, phase: inFinish ? "finish" : "rough", cur, rough, finish, extras,
        margin: (typeof t.margin === "number") ? t.margin : null, marginEst: !!t.isEstimate,
        ratio: cur ? cur.ratio : 0 };
      m.hours[inFinish ? "finish" : "rough"].push(row);
    });
    m.hours.rough.sort((a, b) => b.ratio - a.ratio);
    m.hours.finish.sort((a, b) => b.ratio - a.ratio);
    m.hours.other.sort((a, b) => b.ratio - a.ratio);
    // Rough completed in the last 30 days — rough hours + margin as it stands (rough bands).
    res.forEach(j => {
      if (!roughRecentlyDone(j, today)) return;
      const t = j.simproNo ? simproTotalsById[String(j.simproNo)] : null;
      if (!t) return;
      const cur = ph(t.rough);
      m.hours.roughDone.push({ name: j.name, phase: "roughDone", cur, rough: null, finish: null, extras: null,
        margin: (typeof t.margin === "number") ? t.margin : null, marginEst: !!t.isEstimate, ratio: cur ? cur.ratio : 0, done: roughDoneOn(j) });
    });
    m.hours.roughDone.sort((a, b) => b.done - a.done);
    // Completed in the last 30 days — whole-job hours + final margin (finish bands).
    arr(jobs).filter(j => recentlyCompleted(j, today) && isResJob(j, crew)).forEach(j => {
      const t = j.simproNo ? simproTotalsById[String(j.simproNo)] : null;
      if (!t) return;
      const parts = [t.rough, t.finish, t.extras].filter(Boolean);
      const tot = parts.length ? { used: parts.reduce((n, p) => n + (p.used || 0), 0), est: parts.reduce((n, p) => n + (p.est || 0), 0) } : null;
      const cur = ph(tot);
      m.hours.completed.push({ name: j.name, phase: "completed", cur, rough: ph(t.rough), finish: ph(t.finish), extras: null,
        margin: (typeof t.margin === "number") ? t.margin : null, marginEst: !!t.isEstimate, ratio: cur ? cur.ratio : 0, done: completedOn(j) });
    });
    m.hours.completed.sort((a, b) => b.done - a.done);
  } catch (e) { m.hours.error = true; }

  // Inspections since last meeting — attempts arrays, then the single-field fallback
  try {
    const seen = new Set();
    res.forEach(j => {
      [["rough", "Rough"], ["final", "Final"]].forEach(([k, label]) => {
        const attempts = arr(j[`${k}InspectionAttempts`]).map(a => ({ d: toDateAny(a && a.date), r: String((a && a.result) || "").toLowerCase() }));
        if (!attempts.length) {
          const d = toDateAny(j[`${k}InspectionDate`]); const r = String(j[`${k}InspectionResult`] || "").toLowerCase();
          if (d && r) attempts.push({ d, r });
        }
        attempts.forEach(a => {
          if (!a.d || !a.r) return;
          const age = daysBetween(today, a.d);
          if (age < 0 || age > INSPECTION_DAYS) return;
          const verdict = a.r === "pass" || a.r === "passed" ? "passed" : a.r === "fail" || a.r === "failed" ? "FAILED" : a.r;
          const line = `${j.name} — ${label} inspection ${verdict} (${fmtShort(a.d)})`;
          if (!seen.has(line)) { seen.add(line); m.inspections[verdict === "FAILED" ? "failed" : "passed"].push({ line, d: a.d }); }
        });
      });
    });
    ["passed", "failed"].forEach(k => { m.inspections[k].sort((a, b) => b.d - a.d); m.inspections[k] = m.inspections[k].map(r => r.line); });
  } catch (e) { m.inspections.error = true; }

  // Upcoming and past due — every row on the app's Upcoming tab
  // (settings/upcoming_jobs.items: name, projectedStart, startConfirmed, foreman,
  // customer, sales, city, notes). Past due = projected start before the meeting.
  // Undated rows sit at the bottom of Upcoming. (Koy, 2026-09-21: all of them, no filter.)
  try {
    if (upcoming == null) m.upcoming.error = true;
    else {
      arr(upcoming).forEach(u => {
        if (!u || !String(u.name || "").trim()) return;
        const d = toDateAny(u.projectedStart);
        const n = d ? daysBetween(d, meeting) : null;
        const who = "";   // no names in Upcoming (Koy, 2026-09-21)
        const when = d ? `${fmtShort(d)} ${u.startConfirmed ? "confirmed" : "projected"}` : "no date";
        if (n != null && n < 0) m.upcoming.pastDue.push({ n, text: `${String(u.name).trim()} — ${fmtShort(d)} ${u.startConfirmed ? "confirmed" : "projected"} (${-n}d past)${who}` });
        else m.upcoming.soon.push({ n: n == null ? 9999 : n, text: `${String(u.name).trim()} — ${when}${who}` });
      });
      // Plus the job-board rows (dated rough starts, finish starts, pipeline) the
      // lead prep already computes — skipped when the same job is on the tab.
      const norm = (n) => String(n || "").toLowerCase().replace(/\(finish\)/g, "").replace(/#\d+\s*[-–—]?\s*/g, "").replace(/[^a-z0-9]/g, "");
      const onTab = new Set(arr(upcoming).map(u => norm(u && u.name)).filter(Boolean));
      // Board rows carry no confirmed flag; look the job up by name and read the
      // phase's *StartConfirmed field so the label matches the tab rows.
      const jobByName = new Map(arr(jobs).map(j => [norm(j && j.name), j]));
      arr(upcomingBoard).forEach(u => {
        if (!u || !u.name || onTab.has(norm(u.name))) return;
        const d = u.start ? toDateAny(u.start) : null;
        const n = d ? daysBetween(d, meeting) : null;
        const j = jobByName.get(norm(u.name));
        const confirmed = j ? !!(/finish/i.test(u.kind || "") || /\(finish\)/i.test(u.name) ? j.finishStartConfirmed : j.roughStartConfirmed) : false;
        const label = d ? ` ${confirmed ? "confirmed" : "projected"}` : "";
        if (n != null && n < 0) m.upcoming.pastDue.push({ n, text: `${u.name} — ${fmtShort(d)}${label} (${-n}d past)` });
        else m.upcoming.soon.push({ n: n == null ? 9999 : n, text: `${u.name} — ${d ? fmtShort(d) + label : "no date"}` });
      });
      m.upcoming.pastDue.sort((a, b) => a.n - b.n); m.upcoming.soon.sort((a, b) => a.n - b.n);
      m.upcoming.pastDue = m.upcoming.pastDue.map(r => r.text); m.upcoming.soon = m.upcoming.soon.map(r => r.text);
    }
  } catch (e) { m.upcoming.error = true; }

  // Training — what shipped in the app since last meeting (FEATURES.md)
  try {
    if (shipped == null) m.shipped.error = true;
    else {
      const all = arr(shipped).map(r => String(r.title || "").replace(/\s*[·—-]\s*(shipped|SW).*$/i, "")).filter(Boolean);
      m.shipped.rows = all.slice(-8);                 // newest 8; the rest is in the app
      m.shipped.more = Math.max(0, all.length - 8);
    }
  } catch (e) { m.shipped.error = true; }

  // Crew out — next 7 days from the meeting
  try {
    const winEnd = addDays(meeting, PTO_DAYS);
    m.pto.rows = arr(pto).map(p => ({ name: (p && p.name) || "", s: toDateAny(p && p.start), e: toDateAny(p && p.end) || toDateAny(p && p.start), note: (p && p.note) || "" }))
      .filter(p => p.name && p.s && p.e && p.e >= meeting && p.s <= winEnd)
      .sort((a, b) => a.s - b.s)
      .map(p => `${p.name} — ${p.s.getTime() === p.e.getTime() ? fmtShort(p.s) : `${fmtShort(p.s)}–${fmtShort(p.e)}`}${p.note ? `, ${clip(p.note, 60)}` : ""}`);
  } catch (e) { m.pto.error = true; }

  m.counts = {
    carried: m.carried.rows.length, bodies: m.needs.bodies.length, tasks: m.needs.tasks.length,
    scheduled: m.schedule.days.reduce((n, d) => n + d.rows.length, 0),
    hours: m.hours.rough.length + m.hours.finish.length + m.hours.other.length, roughDone: m.hours.roughDone.length, completed: m.hours.completed.length,
    inspections: m.inspections.passed.length + m.inspections.failed.length,
    pastDue: m.upcoming.pastDue.length, upcoming: m.upcoming.soon.length, shipped: m.shipped.rows.length, pto: m.pto.rows.length,
  };
  return m;
}

// ── render → lines ───────────────────────────────────────────────────────────
// A line may carry `spans`: [{ start, len, rgb, bold }] (offsets into text) for
// the colored bits — margin and OVER flags. Everything else is plain black.
// Margin thresholds (Koy, 2026-09-21): a job in rough still has finish costs
// coming, so it needs to sit higher — rough: green ≥ 50%, yellow 40–50, red < 40;
// finish (and Other): green ≥ 25%, yellow 20–25, red < 20.
const RGB = { green: [0.2, 0.55, 0.3], amber: [0.8, 0.55, 0], red: [0.75, 0.15, 0.15] };
const MARGIN_BANDS = { rough: { green: 50, yellow: 40 }, finish: { green: 25, yellow: 20 }, other: { green: 25, yellow: 20 }, roughDone: { green: 50, yellow: 50 }, completed: { green: 15, yellow: 15 } };   // done groups: hit or missed — no middle
const marginColor = (pct, phase) => { const b = MARGIN_BANDS[phase] || MARGIN_BANDS.finish; return pct >= b.green ? "green" : pct >= b.yellow ? "amber" : "red"; };
const pct = (p) => `${Math.round(p.ratio * 100)}%`;
function hoursLine(r) {
  // One consistent shape per line, easy to scan (Koy, 2026-09-21):
  //   **Job name**   214 / 420 h   51%   margin 77%
  //   **Job name**   547 / 310 h   176%  +237h over   margin 30%
  // Job name bold; hours grey; "+Nh over" red; margin colored by band.
  const spans = [];
  let text = "";
  const push = (str, color, bold) => { spans.push({ start: text.length, len: str.length, rgb: color ? RGB[color] : [0, 0, 0], bold: !!bold }); text += str; };
  const grey = (str) => { spans.push({ start: text.length, len: str.length, rgb: [0.45, 0.45, 0.45], bold: false }); text += str; };
  push(r.name, null, true);
  if ((r.phase === "completed" || r.phase === "roughDone") && r.done) grey(`   done ${fmtShort(r.done)}`);
  if (r.cur) {
    grey(`   ${r.cur.used} / ${r.cur.est} h`);
    text += `   ${pct(r.cur)}`;
    if (r.cur.used > r.cur.est) { text += "   "; push(`+${r.cur.used - r.cur.est}h over`, "red", true); }
  } else grey("   hours not in Simpro");
  if (r.phase === "finish" && r.rough) {
    const diff = r.rough.used - r.rough.est;
    grey(diff > 0 ? `   rough +${diff}h` : diff < 0 ? `   rough ${diff}h` : "   rough on bid");
  }
  text += "   ";
  if (r.margin == null) grey("margin n/a");
  else { text += "margin "; push(`${r.margin.toFixed(0)}%${r.marginEst ? " est" : ""}`, marginColor(r.margin, r.phase), true); }
  return { text, kind: "bullet", spans };
}

// kind: h1 | h2 | h3 | h4 (bold plain line) | p | grey | bullet | check
function renderLines(m) {
  const L = [];
  const H1 = (t) => L.push({ text: t, kind: "h1" });
  const H2 = (t) => L.push({ text: t, kind: "h2" });
  const H3 = (t) => L.push({ text: t, kind: "h3" });
  const P = (t) => L.push({ text: t, kind: "p" });
  const G = (t) => L.push({ text: t, kind: "grey" });
  const B = (t) => L.push({ text: t, kind: "bullet" });
  const C = (t) => L.push({ text: t, kind: "check" });
  const list = (rows, err, none) => { if (err) G("Could not load this section."); else if (!rows.length) G(none); else rows.forEach(B); };

  H1(m.heading);
  G(`Prepared ${m.generated}.`);

  H2("Notes");
  B("");

  H2("Highlight");
  if (m.inspections.error) G("Could not read inspections.");
  else m.inspections.passed.forEach(B);
  B("");

  H2("Lowlight");
  if (m.inspections.error) G("Could not read inspections.");
  else m.inspections.failed.forEach(B);
  B("");

  H2("Carried from last week");
  if (m.carried.error) G("Could not read last week's section.");
  else if (!m.carried.rows.length) G(m.carried.from ? `Nothing open from ${m.carried.from}.` : "First meeting — nothing to carry.");
  else m.carried.rows.forEach(C);

  H2("Needs");
  H3("Bodies");
  list(m.needs.bodies, m.needs.error, "No open requests for bodies.");
  H3("Open tasks");
  list(m.needs.tasks, m.needs.error, "No open tasks on the needs board.");

  H2("Schedule (Simpro)");
  if (m.schedule.error) G("Could not load Simpro.");
  else ["this", "next"].forEach(w => {
    H3(w === "this" ? "This week" : "Next week");
    const wk = m.schedule.days.find(d => d.week === w);
    if (!wk || !wk.rows.length) G(w === "this" ? "Nothing booked in Simpro." : "Not set in Simpro yet.");
    else wk.rows.forEach(B);
  });

  H2("Upcoming and past due");
  H3("Past due");
  list(m.upcoming.pastDue, m.upcoming.error, "Nothing past its start date.");
  H3("Upcoming");
  list(m.upcoming.soon, m.upcoming.error, "Nothing on the Upcoming tab.");

  H2("Hours vs bid");
  if (m.hours.error) G("Could not load Simpro hours.");
  else [["rough", "In rough"], ["finish", "In finish"], ["other", "Other"], ["roughDone", "Rough completed in the last 30 days"], ["completed", "Finish completed in the last 30 days"]].forEach(([k, label]) => {
    const rows = m.hours[k];
    if (k === "other" && !rows.length) return;
    H3(label);
    if (!rows.length) { G(k === "completed" ? "No jobs finished in the last 30 days." : k === "roughDone" ? "No roughs completed in the last 30 days." : `No residential jobs in ${k} with hours in Simpro.`); return; }
    // Grouped by margin band (Koy, 2026-09-21): on pace / middle ground / bad place / no margin yet.
    const band = (r) => r.margin == null ? "none" : marginColor(r.margin, r.phase);
    const bands = k === "completed"
      ? [["green", "Hit 15%"], ["red", "Missed 15%"], ["none", "No margin in Simpro yet"]]
      : k === "roughDone"
      ? [["green", "Hit 50%"], ["red", "Missed 50%"], ["none", "No margin in Simpro yet"]]
      : [["green", "On pace"], ["amber", "Middle ground"], ["red", "Bad place"], ["none", "No margin in Simpro yet"]];
    bands.forEach(([b, title]) => {
      const rs = rows.filter(r => band(r) === b);
      if (!rs.length) return;
      L.push({ text: title, kind: "h4", spans: b === "none" ? [] : [{ start: 0, len: title.length, rgb: RGB[b], bold: true }] });
      rs.forEach(r => L.push(hoursLine(r)));
    });
  });

  H2("Training");
  if (m.shipped.error) G("Could not read what shipped in the app.");
  else { m.shipped.rows.forEach(B); if (m.shipped.more) G(`+${m.shipped.more} more app updates this week.`); }
  B("");

  H2("Crew out");
  list(m.pto.rows, m.pto.error, "Nobody out.");

  H2("Action items");
  C("Owner — what — by when");
  P("");
  return L;
}

// ── lines → Docs API requests ────────────────────────────────────────────────
// Inserts every line (joined by newlines) at `at`, then styles paragraphs by
// range. Insert first, then style: bullets and paragraph styles don't move
// indices. Text is ASCII/BMP only (no emoji) so JS length == UTF-16 index math.
function docsRequests(lines, at = 1) {
  const text = lines.map(l => l.text).join("\n") + "\n";
  const reqs = [{ insertText: { location: { index: at }, text } }];
  let idx = at;
  const ranges = [];
  lines.forEach(l => {
    const start = idx, end = idx + l.text.length + 1;   // include the newline
    ranges.push({ ...l, start, end });
    idx = end;
  });
  const named = { h1: "HEADING_1", h2: "HEADING_2", h3: "HEADING_3", h4: "NORMAL_TEXT", p: "NORMAL_TEXT", grey: "NORMAL_TEXT", bullet: "NORMAL_TEXT", check: "NORMAL_TEXT" };
  const size = { h1: 18, h2: 14, h3: 12, h4: 11, p: 11, grey: 9, bullet: 11, check: 11 };
  const black = { color: { rgbColor: { red: 0, green: 0, blue: 0 } } };
  const grey = { color: { rgbColor: { red: 0.5, green: 0.5, blue: 0.5 } } };
  ranges.forEach((r, li) => {
    const tag = (q) => { q._line = li; return q; };
    reqs.push(tag({ updateParagraphStyle: { range: { startIndex: r.start, endIndex: r.end - 1 }, paragraphStyle: { namedStyleType: named[r.kind] }, fields: "namedStyleType" } }));
    if (!r.text) return;
    // Inserted text inherits whatever style sits at the insertion point (the doc's
    // grey intro line), so every run gets an explicit, deterministic text style.
    reqs.push(tag({ updateTextStyle: {
      range: { startIndex: r.start, endIndex: r.end - 1 },
      textStyle: { foregroundColor: r.kind === "grey" ? grey : black, fontSize: { magnitude: size[r.kind], unit: "PT" },
                   bold: r.kind === "h1" || r.kind === "h2" || r.kind === "h3" || r.kind === "h4", italic: false, strikethrough: false },
      fields: "foregroundColor,fontSize,bold,italic,strikethrough",
    } }));
    (r.spans || []).forEach(sp => {
      reqs.push(tag({ updateTextStyle: {
        range: { startIndex: r.start + sp.start, endIndex: r.start + sp.start + sp.len },
        textStyle: { foregroundColor: { color: { rgbColor: { red: sp.rgb[0], green: sp.rgb[1], blue: sp.rgb[2] } } }, bold: !!sp.bold },
        fields: "foregroundColor,bold",
      } }));
    });
  });
  // Bullets: group consecutive same-kind runs so each list is one request.
  let run = null;
  // endIndex stops BEFORE the run's last newline: a range that reaches the next
  // paragraph's start index pulls that paragraph (the following heading) into the list.
  const flush = () => { if (run) { reqs.push({ _line: run.line, createParagraphBullets: { range: { startIndex: run.start, endIndex: run.end - 1 }, bulletPreset: run.kind === "check" ? "BULLET_CHECKBOX" : "BULLET_DISC_CIRCLE_SQUARE" } }); run = null; } };
  ranges.forEach((r, li) => {
    if (r.kind === "bullet" || r.kind === "check") {
      if (run && run.kind === r.kind) run.end = r.end; else { flush(); run = { kind: r.kind, start: r.start, end: r.end, line: li }; }
    } else flush();
  });
  flush();
  // Apply everything after the insert BOTTOM-UP. createParagraphBullets strips the
  // leading tabs that nest the schedule rows, which deletes characters and shifts
  // every index below it; working from the highest index down means nothing that
  // still has to run sits below a deletion. (Learned the hard way, 2026-09-21.)
  // Sort by LINE (not raw index) so a line's whole-line black style still runs
  // before its colored spans; Array.sort is stable, so same-line order is kept.
  const rest = reqs.slice(1).sort((a, b) => b._line - a._line);
  rest.forEach(q => { delete q._line; });
  return [reqs[0], ...rest];
}

module.exports = { parseLastActions, buildModel, renderLines, docsRequests, collectSimproHours, recentlyCompleted, roughRecentlyDone, toDateAny, isResJob, TZ, SECTION_TAG };
