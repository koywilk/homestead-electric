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

// ── The foreman copy (SW v667) ───────────────────────────────────────────────
// Koy, 2026-11-18: reports "easily shown somewhere or copyable to send to
// people"; his standing rule: margin % is fine for foremen, but no dollar or
// cost figures outside the owners and admins. foremanSafe(md) is the one place
// that cut is made: the claudeReports callable hands it to everyone who isn't
// an admin (the share link included), and the dashboard's "Copy for foreman"
// copies it. A line goes when it has a dollar sign / USD, or a money word with
// a number that isn't a percent, hours or days. A table loses any column whose
// heading is a money word, then any row that still reads as money. Leaving too
// much out is the safe side; nothing here ever adds text.
const MONEY_WORD = /\b(costs?|costing|price[ds]?|pricing|invoice[ds]?|invoicing|revenue|profit|sell|selling|sold|sales|budget(?:ed)?|bill(?:ed|ing)|spen[dt]|spending|overhead|contract\s+(?:value|amount|total|price)|payments?|paid|pay|dollars?|bucks|wages?|payroll|gross\s+profit)\b/i;
// A number that is NOT a percent, hours or days (those are fine for foremen).
const AMOUNT = /(?:^|[^\w.,%])(\d[\d,]*(?:\.\d+)?)(?![\d,.]*\s*(?:%|percent\b|h\b|hrs?\b|hours?\b|days?\b|wks?\b|weeks?\b))/i;
const moneyText = (s) => {
  const t = String(s == null ? "" : s);
  if (DOLLARS.test(t)) return true;
  return MONEY_WORD.test(t) && AMOUNT.test(t);
};
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isRuleRow = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l.trim());
const splitCells = (row) => { let s = row.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|")) s = s.slice(0, -1); return s.split("|").map(c => c.trim()); };
// → { content, cut } — cut counts the lines (and table columns) taken out.
function foremanSafe(md) {
  const lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isTableRow(l) && i + 1 < lines.length && isRuleRow(lines[i + 1])) {
      const block = [];
      while (i < lines.length && isTableRow(lines[i])) block.push(lines[i++]);
      i--;
      const head = splitCells(block[0]);
      const drop = head.map(h => DOLLARS.test(h) || MONEY_WORD.test(h));
      cut += drop.filter(Boolean).length;
      if (drop.every(Boolean)) { cut += block.length - 2; continue; }
      const keep = (cells) => "| " + cells.filter((c, k) => !drop[k]).join(" | ") + " |";
      out.push(keep(head), keep(splitCells(block[1])));
      for (const row of block.slice(2)) {
        const cells = splitCells(row);
        const kept = cells.filter((c, k) => !drop[k]);
        if (moneyText(kept.join(" | "))) { cut++; continue; }
        out.push(keep(cells));
      }
      continue;
    }
    if (moneyText(l)) { cut++; continue; }
    out.push(l);
  }
  return { content: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), cut };
}
// True when the foreman copy would leave something out: the filing guard.
const hasMoney = (md) => foremanSafe(md).cut > 0;

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
  // v667: a cost figure without a dollar sign ("Material spent: 14,820") is the
  // same thing. Margin %, hours and days stay fine.
  if (!ownersOnly && (hasMoney(content) || moneyText(title))) {
    return { refused: "This report has cost figures (a money word with an amount, like \"material spent 14,820\"). File it with ownersOnly:true, or take those lines out. Margin %, hours and days are fine. Nothing was filed." };
  }
  const fid = fileId(a);
  if (fid.refused) return fid;
  if (prior && String(prior.jobId || "") !== jobId) return { refused: "That key is already used by a report on another job. Nothing was filed." };
  const doc = {
    jobId, jobNo, jobName: line(job.name, 120), type, title, content, ownersOnly, forWho: line(a.forWho, 80),
    chars: content.length,
    filedAt: (prior && prior.filedAt) || nowIso, updatedAt: nowIso, filedBy: "Duet (Koy)",
    version: ((prior && prior.version) || 0) + 1, archived: false, archivedAt: "",
    // v667: a newer version keeps the share link the way an admin left it.
    shareOff: !!(prior && prior.shareOff), shareOffAt: (prior && prior.shareOffAt) || "",
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
    .filter(r => r && ID.test(r.id) && (isAdmin || (!r.ownersOnly && !r.shareOff)) && (includeArchived || !r.archived))
    .map(r => ({ id: r.id, jobId: r.jobId || "", jobNo: r.jobNo || "", jobName: r.jobName || "", type: r.type || "other",
      typeLabel: REPORT_TYPES[r.type] || "Other", title: r.title || "", forWho: r.forWho || "", ownersOnly: !!r.ownersOnly,
      filedAt: r.filedAt || "", updatedAt: r.updatedAt || r.filedAt || "", version: r.version || 1, chars: r.chars || 0, archived: !!r.archived, shareOff: !!r.shareOff }))
    .sort((x, y) => (y.updatedAt > x.updatedAt ? 1 : y.updatedAt < x.updatedAt ? -1 : 0));
}
// v667: anyone who isn't an admin gets the foreman copy (never the full text),
// and only while the report is live: an archived report, or one an admin turned
// sharing off on, reads as not found to them (that is how a share link stops).
// Admins get the full text plus the foreman copy, so "Copy for foreman" in the
// dashboard copies exactly what a foreman would see.
function buildOne(id, d, { isAdmin }) {
  if (!d || !ID.test(String(id || "")) || (d.ownersOnly && !isAdmin)) return { ok: false, notFound: true };
  if (!isAdmin && (d.archived || d.shareOff)) return { ok: false, notFound: true };
  const [meta] = buildList([[id, d]], { isAdmin, includeArchived: true });
  const full = String(d.content || "");
  const fm = foremanSafe(full);
  if (!isAdmin) return { ok: true, report: { ...meta, content: fm.content, cut: fm.cut, foremanCopy: true } };
  return { ok: true, report: { ...meta, content: full, foremanContent: d.ownersOnly ? "" : fm.content, foremanCut: fm.cut } };
}

// Turn the share link on or off (admins only; the callable checks the tier).
// args: { id, share: true|false } → { refused } | { id, patch } | { noop }
function planShare(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const id = String(a.id || "");
  if (!ID.test(id)) return { refused: "Bad report id." };
  if (typeof a.share !== "boolean") return { refused: "share must be true or false" };
  if (!prior) return { refused: "That report isn't there any more." };
  if (prior.ownersOnly && a.share) return { refused: "Owners-only reports can't be shared." };
  const off = !a.share;
  if (!!prior.shareOff === off) return { id, patch: null, noop: true };
  return { id, patch: { shareOff: off, shareOffAt: off ? nowIso : "" } };
}

module.exports = { REPORT_ACTIONS, REPORT_TYPES, MAX_CONTENT, fileId, planFile, planArchive, planShare, buildList, buildOne, hasDollars, hasMoney, moneyText, foremanSafe };
