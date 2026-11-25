// myJobs.js — the My Jobs page (/myjobs), its pure half (SW v686, Koy 2026-11-25).
//
// Koy: "I need something set up for all the foremen. that shows them in the job costs in the
// dashboard. I want them to see the job costs and all of their reports in one spot. Organized and
// neat, drop downs, starting collapsed" ... "put it on their home screen like we do with the command
// center". Then: "all of the junior foremen and leads need to have their own page to see their jobs
// as well. So the foremans will show their whole crews, and then the leads and junior foremans will
// just show theirs."
//
// Who sees which jobs (the Crew Board in Settings is the source: a person's title and foremanId):
//   foreman            every job run or led by the foreman or anyone on their crew
//   jr. foreman, lead  only the jobs they run (foreman) or lead
//   anyone else        only the jobs they run or lead (usually none)
// A "job" is a Command Center job that is live: not archived, deleted, a quote or a temp ped.
//
// Reports: the Claude tab's reports (the claudeReports callable), matched by job number. The server
// already leaves owners-only reports out for anyone who isn't an admin and hands them the foreman copy
// (no dollar or cost lines). This file leaves owners-only, shared-off and archived ones out again, so
// even an admin opening My Jobs never sees one here.
//
// Pure CommonJS, no imports: scripts/my-jobs-test.js runs it under node.
"use strict";

const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
// Same rule as the rest of the app: "Koy" matches "Koy Wilkinson", never a part of a word.
const sameName = (a, b) => { const x = lc(a), y = lc(b); return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " ")); };
const titleOf = (u) => (u && (u.title || (["admin", "justin", "jeromy"].includes(u.role) ? "admin" : ["foreman", "lead", "crew"].includes(u.role) ? u.role : "crew"))) || "crew";
const TITLE_LABEL = { foreman: "Foreman", jrforeman: "Jr. Foreman", lead: "Lead", crew: "Crew", admin: "Admin" };

// The signed-in person's live record on the team list (by id, else by name).
function recordOf(identity, users) {
  if (!identity) return null;
  return (users || []).find(u => u && (u.id === identity.id || sameName(u.name, identity.name))) || identity;
}
// Who counts as "mine": the person, plus their crew when they are a foreman on the Crew Board.
function peopleFor(rec, users) {
  if (!rec || !String(rec.name || "").trim()) return { title: "", people: [], crew: [] };
  const t = titleOf(rec);
  const me = String(rec.name).trim();
  if (t !== "foreman") return { title: t, people: [me], crew: [] };
  const crew = (users || []).filter(u => u && u.active !== false && u.id !== rec.id && u.foremanId === rec.id && String(u.name || "").trim()
    && !["foreman", "admin"].includes(titleOf(u))).map(u => String(u.name).trim()).sort((a, b) => a.localeCompare(b));
  return { title: t, people: [me, ...crew], crew };
}
const isLiveJob = (j) => !!j && !j.archived && !j.deleted && !j.archivedAt && j.type !== "quote" && !j.tempPed && !!String(j.name || "").trim();
// Every live job one of `people` runs (foreman) or leads, with who it is through.
// → [{ job, via: "foreman" | "lead", person }] ordered by job number, high to low (newest first), no number last.
function jobsFor(people, jobs) {
  const out = [];
  (jobs || []).forEach(j => {
    if (!isLiveJob(j)) return;
    const fm = (people || []).find(p => sameName(j.foreman, p));
    const ld = fm ? null : (people || []).find(p => sameName(j.lead, p));
    if (fm || ld) out.push({ job: j, via: fm ? "foreman" : "lead", person: fm || ld });
  });
  const num = (j) => { const n = parseInt(String(j.simproNo || "").replace(/^#/, ""), 10); return isFinite(n) ? n : -1; };
  return out.sort((a, b) => num(b.job) - num(a.job) || String(a.job.name).localeCompare(String(b.job.name)));
}
function myJobsFor(identity, users, jobs) {
  const rec = recordOf(identity, users);
  const p = peopleFor(rec, users);
  return { rec, title: p.title, titleLabel: TITLE_LABEL[p.title] || "", crew: p.crew, rows: jobsFor(p.people, jobs) };
}
// The My Jobs link in Command Center: foremen, jr. foremen and leads (the people the page is for).
const showsMyJobsLink = (rec) => !!rec && rec.active !== false && ["foreman", "jrforeman", "lead"].includes(titleOf(rec));

// ── Reports, grouped for one job ──────────────────────────────────────────────
// Finish plans and foreman packets are new report types from 2026-11-25; the rest are the kinds the
// Foreman Meeting already shows. A report's group comes from its title (the type list is small and
// "plan" covers several kinds), newest first inside each group.
const REPORT_GROUPS = [
  { key: "finish", label: "Finish plans", test: (t) => /finish[\s-]*(in\s+)?plan/i.test(t) },
  { key: "packet", label: "Foreman packets", test: (t) => /foreman'?s?\s+packet|\bpacket\b/i.test(t) },
  { key: "postrough", label: "Post-rough-in reports", test: (t) => /post[\s-]*rough/i.test(t) },
  { key: "margin", label: "Margin watch", test: (t) => /margin\s+watch/i.test(t) },
  { key: "jobreport", label: "Job reports", test: (t) => /job\s+report/i.test(t) },
  { key: "other", label: "Other reports", test: () => true },
];
const jobNoOf = (v) => String(v == null ? "" : v).replace(/^#/, "").trim();
function reportGroupOf(r) {
  const t = String((r && r.title) || "");
  return (REPORT_GROUPS.find(g => g.test(t)) || REPORT_GROUPS[REPORT_GROUPS.length - 1]).key;
}
// → [{ key, label, reports: [...] }] only groups with reports, in REPORT_GROUPS order.
function reportsByGroup(reports, jobNo) {
  const no = jobNoOf(jobNo);
  if (!no) return [];
  const mine = (Array.isArray(reports) ? reports : [])
    .filter(r => r && jobNoOf(r.jobNo) === no && !r.ownersOnly && !r.shareOff && !r.archived)
    .sort((a, b) => (String(b.updatedAt || "") > String(a.updatedAt || "") ? 1 : String(b.updatedAt || "") < String(a.updatedAt || "") ? -1 : 0));
  return REPORT_GROUPS.map(g => ({ key: g.key, label: g.label, reports: mine.filter(r => reportGroupOf(r) === g.key) })).filter(g => g.reports.length);
}
// A report's name without the "1435 Hardman: " the filer often puts in front.
function reportName(r) {
  const t = String((r && r.title) || ""), i = t.indexOf(": ");
  return i > 0 && /^\s*#?\d+/.test(t) ? t.slice(i + 2) : (t || (r && r.typeLabel) || "Report");
}

module.exports = { sameName, titleOf, recordOf, peopleFor, isLiveJob, jobsFor, myJobsFor, showsMyJobsLink, REPORT_GROUPS, reportGroupOf, reportsByGroup, reportName };
