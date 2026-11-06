"use strict";
// reports.js — Reports in the Claude tab (Koy, 2026-11-05/06: reports "easily
// accessable from the claude section in dashboard", "from here on any reports
// will go there as well organized neatly", then "Yes, build it").
//
// Two duetApi actions, both on claude_reports/<rep_…> and nothing else:
//
//   report.file     file (or replace) one report on one job
//   report.archive  take one report off the list (archived:true; never a delete)
//
// claude_reports is SERVER-ONLY: the rules give the app no access at all, so
// the only way to read a report is the live-PIN callable claudeReports
// (functions/index.js), which hands owners-only reports to admins alone.
//
// Guardrails, enforced here:
//   • the job comes from Command Center (its jobs/<id> doc), never from the
//     caller's own words: number and name are the job's simproNo and name
//   • a report with a dollar figure must be owners-only (Koy: no cost or margin
//     dollars outside the owners and admins; foremen may see margin %)
//   • content is plain markdown text, at most 100,000 characters; the app
//     draws it as text (never as HTML), so a link or a tag in it is inert
//   • the same job + type + title is the same report: filing it again replaces
//     it (a newer version), so a retry never makes a second copy
//
// Pure: no Firebase import (scripts/claude-reports-test.js runs it under node).

const crypto = require("crypto");

const REPORT_ACTIONS = ["report.file", "report.archive"];
const REPORT_TYPES = { plan: "Game plan", material: "Material report", margin: "Margin math", forecast: "Forecast", other: "Other" };
const MAX_CONTENT = 100000;
const ID = /^rep_[A-Za-z0-9_-]{6,48}$/;
const KEY = /^[A-Za-z0-9_-]{6,40}$/;
// "$1,234", "$ 12", "$0.50", "-$300", "USD 400"
const DOLLARS = /(\$\s?-?\d)|(\bUSD\s?\d)/i;

function line(v, n) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, n);
}
// Markdown keeps its line breaks and tabs; every other control character goes.
function body(v) {
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
}
const hasDollars = (s) => DOLLARS.test(String(s || ""));

// The report's id: rep_<key> when the caller gives a key, else a hash of job +
// type + title, so filing the same report again lands on the same doc.
function fileId(args) {
  const a = args && typeof args === "object" ? args : {};
  if (a.key != null && a.key !== "") {
    if (!KEY.test(String(a.key))) return { refused: "key must be 6–40 letters, digits, - or _" };
    return { id: `rep_${a.key}` };
  }
  const basis = [String(a.jobId || ""), String(a.type || ""), line(a.title, 160).toLowerCase()].join("|");
  return { id: `rep_${crypto.createHash("sha1").update(basis).digest("hex").slice(0, 24)}` };
}

// args:  { jobId, type, title, content, ownersOnly, forWho?, key? }
// job:   the live jobs/<jobId> data, unwrapped ({ simproNo, name, … }), or null
// prior: the claude_reports doc already at fileId(args), or null
// → { refused } | { id, doc, replaced }
function planFile(args, job, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const allowed = ["jobId", "type", "title", "content", "ownersOnly", "forWho", "key"];
  const extra = Object.keys(a).filter(k => !allowed.includes(k));
  if (extra.length) return { refused: `unknown field ${extra.slice(0, 3).join(", ")}` };
  const jobId = String(a.jobId || "");
  if (!jobId) return { refused: "jobId is required (the Command Center job the report is about)" };
  if (!job) return { refused: `No Command Center job ${jobId}. Nothing was filed.` };
  const jobNo = line(job.simproNo, 12).replace(/^#/, "");
  if (!/^\d{1,6}$/.test(jobNo)) return { refused: "That job has no Simpro job number in Command Center, so the report can't be filed by number. Nothing was filed." };
  const type = String(a.type || "");
  if (!REPORT_TYPES[type]) return { refused: `type must be one of ${Object.keys(REPORT_TYPES).join(", ")}` };
  const title = line(a.title, 160);
  if (!title) return { refused: "title is required" };
  const content = body(a.content);
  if (!content) return { refused: "content is required (the report, as markdown text)" };
  if (content.length > MAX_CONTENT) return { refused: `content is ${content.length} characters; the limit is ${MAX_CONTENT}` };
  if (a.ownersOnly != null && typeof a.ownersOnly !== "boolean") return { refused: "ownersOnly must be true or false" };
  const ownersOnly = a.ownersOnly === true;
  if (!ownersOnly && (hasDollars(content) || hasDollars(title))) {
    return { refused: "This report has dollar figures. File it with ownersOnly:true (owners and admins only), or take the dollars out. Nothing was filed." };
  }
  const fid = fileId(a);
  if (fid.refused) return fid;
  if (prior && String(prior.jobId || "") !== jobId) return { refused: "That key is already used by a report on another job. Nothing was filed." };
  const doc = {
    jobId, jobNo, jobName: line(job.name, 120), type, title, content, ownersOnly, forWho: line(a.forWho, 80),
    chars: content.length,
    filedAt: (prior && prior.filedAt) || nowIso, updatedAt: nowIso, filedBy: "Duet (Koy)",
    version: ((prior && prior.version) || 0) + 1, archived: false, archivedAt: "",
  };
  return { id: fid.id, doc, replaced: !!prior };
}

// args: { id, archived? } → { refused } | { id, patch }
function planArchive(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const id = String(a.id || "");
  if (!ID.test(id)) return { refused: "id must be a report id like rep_…" };
  if (!prior) return { refused: `No report ${id}. Nothing changed.` };
  const archived = a.archived !== false;
  if (!!prior.archived === archived) return { id, patch: null, noop: true };
  return { id, patch: { archived, archivedAt: archived ? nowIso : "", updatedAt: nowIso } };
}

// The callable's answer. viewer = the live-PIN member record; isAdmin = access tier admin.
// List mode: every report the viewer may see, newest first, without content.
// One mode (id): that report with its content, or not found (an owners-only
// report reads as not found for a non-admin, so its title never leaks).
function buildList(rows, { isAdmin, includeArchived }) {
  return (rows || [])
    .map(([id, d]) => ({ id, ...d }))
    .filter(r => r && ID.test(r.id) && (isAdmin || !r.ownersOnly) && (includeArchived || !r.archived))
    .map(r => ({ id: r.id, jobId: r.jobId || "", jobNo: r.jobNo || "", jobName: r.jobName || "", type: r.type || "other",
      typeLabel: REPORT_TYPES[r.type] || "Other", title: r.title || "", forWho: r.forWho || "", ownersOnly: !!r.ownersOnly,
      filedAt: r.filedAt || "", updatedAt: r.updatedAt || r.filedAt || "", version: r.version || 1, chars: r.chars || 0, archived: !!r.archived }))
    .sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : y.updatedAt < x.updatedAt ? -1 : 0));
}
function buildOne(id, d, { isAdmin }) {
  if (!d || !ID.test(String(id || "")) || (d.ownersOnly && !isAdmin)) return { ok: false, notFound: true };
  const [meta] = buildList([[id, d]], { isAdmin, includeArchived: true });
  return { ok: true, report: { ...meta, content: String(d.content || "") } };
}

module.exports = { REPORT_ACTIONS, REPORT_TYPES, MAX_CONTENT, fileId, planFile, planArchive, buildList, buildOne, hasDollars };
