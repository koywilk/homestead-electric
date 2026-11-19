// jobsiteDay.js — the "My jobsite" card on My Day (SW v653, Louis Hoffman's ask via Koy, 2026-11-19:
// "a spot to be able to see everyone on his jobsite that day, and every punch item he assigned sorted
// out to the people"). Koy's picks: every open item on the job (not only the lead's own assignments),
// today plus tomorrow.
//
// Pure functions only (no React, no Firestore) so scripts/jobsite-day-test.js can run them in node.
// Read-only: nothing here writes. Who is on site comes from the Simpro schedule (the same
// getSimproSchedule callable the Crew Planner uses); punch comes from the job docs My Day already has.
"use strict";

const clean = (s) => String(s || "").trim();
const lc = (s) => clean(s).toLowerCase();
// Same rule as needShape.sameName: exact, or one is the other's first name.
const sameName = (a, b) => { const x = lc(a), y = lc(b); return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " ")); };
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12); return x; };

// The Simpro job number a CC job is booked under (quotes have none).
const jobNoOf = (job) => (job && job.type === "quote") ? "" : clean(job && (job.simproNo || job.number || job.jobNumber));

// A schedule row's job number: Project.ProjectID when Simpro sends it, else the "1291-17551" reference.
const entryJobNo = (e) => {
  if (!e) return "";
  const pid = e.Project && e.Project.ProjectID != null ? clean(e.Project.ProjectID) : "";
  if (pid) return pid;
  const ref = clean(e.Reference);
  return ref ? ref.split("-")[0] : "";
};

// "07:00" → "7:00 AM"
const clock = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(clean(t));
  if (!m) return "";
  let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};

// Everyone booked on this job on this day, one row per person, earliest start to latest end.
function bookedOn(entries, jobNo, day) {
  const by = new Map();
  (entries || []).forEach(e => {
    if (!e || (e.Type && e.Type !== "job")) return;
    if (clean(e.Date) !== day || !jobNo || entryJobNo(e) !== jobNo) return;
    const name = clean(e.Staff && e.Staff.Name);
    if (!name) return;
    const blocks = (e.Blocks || []).filter(b => b && b.StartTime && b.EndTime);
    const cur = by.get(lc(name)) || { name, start: "", end: "", hrs: 0 };
    blocks.forEach(b => {
      if (!cur.start || b.StartTime < cur.start) cur.start = b.StartTime;
      if (!cur.end || b.EndTime > cur.end) cur.end = b.EndTime;
      cur.hrs += +b.Hrs || 0;
    });
    by.set(lc(name), cur);
  });
  return [...by.values()].map(p => ({ ...p, hours: p.start && p.end ? `${clock(p.start)} – ${clock(p.end)}` : "" }));
}

// Every punch item on the job (rough, finish, QC; main floors + extras), voided ones left out.
const PHASES = [["Rough", "roughPunch"], ["Finish", "finishPunch"], ["QC", "qcPunch"]];
const FLOOR_LABEL = { upper: "Upper", main: "Main", basement: "Basement" };
function allPunch(job) {
  const out = [];
  if (!job) return out;
  PHASES.forEach(([phase, key]) => {
    const punch = job[key];
    if (!punch) return;
    const eat = (fl, floor) => {
      if (!fl) return;
      const push = (i, room) => { if (i && i.id != null && !i.voided) out.push({ item: i, phase, floor, room }); };
      (fl.general || []).forEach(i => push(i, `${floor} · General`));
      (fl.hotcheck || []).forEach(i => push(i, `${floor} · Hot check`));
      (fl.rooms || []).forEach(r => (r && r.items || []).forEach(i => push(i, clean(r.name) || floor)));
    };
    ["upper", "main", "basement"].forEach(k => eat(punch[k], FLOOR_LABEL[k]));
    (punch.extras || []).forEach(e => { if (e && e.key) eat(punch[e.key], clean(e.label) || e.key); });
  });
  return out;
}

// When an item was checked off, as YYYY-MM-DD ("" if unknown). checkedAtTs is ISO; checkedAt is "11/18/2026".
function checkedYmd(i) {
  if (i && i.checkedAtTs) { const d = new Date(i.checkedAtTs); if (!isNaN(d)) return ymd(d); }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(i && i.checkedAt));
  return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : "";
}

const row = (p) => ({ id: String(p.item.id), text: p.item.text || "", phase: p.phase, room: p.room,
  assignedTo: clean(p.item.assignedTo), waitingOn: clean(p.item.waitingOn), done: !!p.item.done, doneOn: checkedYmd(p.item) });

// The card for one job on one day.
//   people:   booked that day (lead first), each with open items assigned to them and items done in the last 7 days
//   notHere:  people with open items who aren't booked that day
//   unassigned: open, not waiting, nobody on it
//   waiting:  open and flagged waiting (any assignee), with the reason
function buildJobsiteDay(job, entries, day, now) {
  const jobNo = jobNoOf(job);
  const booked = bookedOn(entries, jobNo, day);
  const lead = clean(job && job.lead);
  booked.sort((a, b) => (sameName(b.name, lead) ? 1 : 0) - (sameName(a.name, lead) ? 1 : 0) || a.name.localeCompare(b.name));
  const today = now ? ymd(now) : day;
  const weekAgo = ymd(addDays(now || new Date(), -6));
  const raw = allPunch(job);
  const items = raw.map(row);
  const open = items.filter(i => !i.done);
  // The item's `waiting` flag decides; waitingOn is only its reason (it can be blank).
  const flagged = new Set(raw.filter(p => !p.item.done && p.item.waiting).map(p => String(p.item.id)));
  const openReady = open.filter(i => !flagged.has(i.id));
  const people = booked.map(b => ({
    name: b.name, hours: b.hours, lead: sameName(b.name, lead),
    open: openReady.filter(i => sameName(i.assignedTo, b.name)),
    done: items.filter(i => i.done && sameName(i.assignedTo, b.name) && i.doneOn && i.doneOn >= weekAgo && i.doneOn <= today)
      .sort((a, c) => c.doneOn.localeCompare(a.doneOn)),
  }));
  const notHereMap = new Map();
  openReady.forEach(i => {
    if (!i.assignedTo || booked.some(b => sameName(b.name, i.assignedTo))) return;
    const k = lc(i.assignedTo);
    if (!notHereMap.has(k)) notHereMap.set(k, { name: i.assignedTo, open: [] });
    notHereMap.get(k).open.push(i);
  });
  return {
    jobId: job && job.id, jobNo, jobName: clean(job && job.name), day,
    people,
    notHere: [...notHereMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unassigned: openReady.filter(i => !i.assignedTo),
    waiting: open.filter(i => flagged.has(i.id)),
    counts: {
      onSite: booked.length,
      assignedOpen: openReady.filter(i => i.assignedTo).length,
      unassigned: openReady.filter(i => !i.assignedTo).length,
      waiting: open.filter(i => flagged.has(i.id)).length,
    },
  };
}

// Which jobs get a card for this person: jobs they lead or are foreman on, booked today or tomorrow.
// Only leads, jr. foremen and foremen see it (Koy approved the plan as written).
const SEES = ["lead", "jrforeman", "foreman"];
function jobsiteJobs(me, title, jobs, entries, days) {
  if (!me || !SEES.includes(clean(title))) return [];
  return (jobs || []).filter(j => j && !j.tempPed && !j.quickJob && j.type !== "quote" && jobNoOf(j)
      && (sameName(j.lead, me) || sameName(j.foreman, me))
      && days.some(d => bookedOn(entries, jobNoOf(j), d).length > 0))
    // Jobs I lead come before jobs I'm only foreman on; then by job number.
    .sort((a, b) => (sameName(b.lead, me) ? 1 : 0) - (sameName(a.lead, me) ? 1 : 0) || jobNoOf(a).localeCompare(jobNoOf(b), undefined, { numeric: true }));
}

// Today and the next working day (Friday → Monday is NOT assumed: crews work optional Fridays, so
// tomorrow is simply the next calendar day; Saturday → Monday since nobody books weekends).
function cardDays(now) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let d1 = addDays(d0, 1);
  if (d1.getDay() === 6) d1 = addDays(d1, 2);
  else if (d1.getDay() === 0) d1 = addDays(d1, 1);
  return [ymd(d0), ymd(d1)];
}

const dayLabel = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  if (!m) return "";
  return new Date(+m[1], +m[2] - 1, +m[3], 12).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

module.exports = { sameName, ymd, jobNoOf, entryJobNo, clock, bookedOn, allPunch, checkedYmd, buildJobsiteDay, jobsiteJobs, cardDays, dayLabel, SEES };
