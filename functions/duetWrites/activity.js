"use strict";
// activity.js — the Claude tab's own log (Koy, 2026-11-04: bring the "Claude
// Scheduling Write Log" sheet into Command Center). Two duetApi actions:
//
//   activity.simpro  a Simpro schedule write Duet made (the sheet's Log tab)
//   activity.watch   a message Duet read and what it did with it (the Watch tab)
//
// Each call carries 1–50 rows and writes claude_activity/<id> docs, one per row.
// These are a LOG, not a change to Command Center: no job, need or settings doc is
// touched, so there is no duet_writes audit, no undo, and they don't count toward
// the hourly change limit. The id is a hash of the row (or the caller's own key),
// so sending the same row twice — a retry, or the backfill run twice — writes the
// same doc, never a second one.
//
// Pure: no Firebase import (scripts/claude-activity-test.js runs it under node).

const crypto = require("crypto");

const ACTIVITY_ACTIONS = ["activity.simpro", "activity.watch"];
const MAX_ROWS = 50;
const KEY = /^[A-Za-z0-9_-]{6,40}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Plain one-line text: control characters out, links out (a message can carry a
// signed or tokened link — the dashboard never shows one), capped.
function clean(v, n) {
  return String(v == null ? "" : v)
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, n);
}
function jobNo(v) {
  const s = clean(v, 12).replace(/^#/, "");
  return /^Q?\d{1,6}$/i.test(s) ? s.replace(/^q/, "Q") : "";
}

function whenIso(v, nowIso) {
  const t = Date.parse(String(v || ""));
  if (isNaN(t)) return null;
  const now = Date.parse(nowIso);
  if (t > now + 86400 * 1000) return null;            // tomorrow or later: a typo
  if (t < now - 400 * 86400 * 1000) return null;      // older than the backfill reaches
  return new Date(t).toISOString();
}

const SIMPRO_FIELDS = ["at", "jobNo", "jobName", "who", "workDate", "what", "notes", "okBy", "removed", "key"];
const WATCH_FIELDS = ["at", "source", "from", "msgAt", "jobNo", "jobName", "said", "did", "why", "key"];

function planRow(kind, r, nowIso) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { why: "each row must be an object" };
  const extra = Object.keys(r).filter(k => !(kind === "simpro" ? SIMPRO_FIELDS : WATCH_FIELDS).includes(k));
  if (extra.length) return { why: `unknown field ${extra.slice(0, 3).join(", ")}` };
  const at = whenIso(r.at, nowIso);
  if (!at) return { why: "at must be a date and time from the last 400 days" };
  let doc;
  if (kind === "simpro") {
    const what = clean(r.what, 160);
    if (!what) return { why: "what is required (e.g. Schedule 7-5)" };
    const wd = clean(r.workDate, 10);
    if (wd && !YMD.test(wd)) return { why: "workDate must be YYYY-MM-DD" };
    doc = { kind, at, jobNo: jobNo(r.jobNo), jobName: clean(r.jobName, 120), who: clean(r.who, 60), workDate: wd, what, notes: clean(r.notes, 300), okBy: clean(r.okBy, 60), removed: r.removed === true };
  } else {
    const did = clean(r.did, 80);
    if (!did) return { why: "did is required (e.g. Flagged to Koy)" };
    const msgAt = r.msgAt ? whenIso(r.msgAt, nowIso) : "";
    if (msgAt === null) return { why: "msgAt must be a date and time" };
    doc = { kind, at, source: clean(r.source, 20), from: clean(r.from, 80), msgAt, jobNo: jobNo(r.jobNo), jobName: clean(r.jobName, 120), said: clean(r.said, 300), did, why: clean(r.why, 300) };
  }
  let id;
  if (r.key != null && r.key !== "") {
    if (!KEY.test(String(r.key))) return { why: "key must be 6–40 letters, digits, - or _" };
    id = `${kind === "simpro" ? "sim" : "wat"}_${r.key}`;
  } else {
    const basis = kind === "simpro"
      ? [doc.at, doc.jobNo, doc.workDate, doc.who, doc.what].join("|")
      : [doc.at, doc.source, doc.from, doc.msgAt, doc.said, doc.did].join("|");
    id = `${kind === "simpro" ? "sim" : "wat"}_${crypto.createHash("sha1").update(basis).digest("hex").slice(0, 24)}`;
  }
  return { id, doc };
}

// args: { rows: [...] }. → { refused } | { docs: [{id, doc}], skipped: [{row, why}] }
function planActivity(action, args, nowIso) {
  const kind = action === "activity.simpro" ? "simpro" : action === "activity.watch" ? "watch" : null;
  if (!kind) return { refused: "not an activity action" };
  const rows = args && Array.isArray(args.rows) ? args.rows : null;
  if (!rows || !rows.length) return { refused: "rows must be a list of 1 to 50 rows" };
  if (rows.length > MAX_ROWS) return { refused: `at most ${MAX_ROWS} rows a call — send the rest in another call` };
  const docs = [], skipped = [], seen = new Set();
  rows.forEach((r, i) => {
    const p = planRow(kind, r, nowIso);
    if (p.why) { skipped.push({ row: i + 1, why: p.why }); return; }
    if (seen.has(p.id)) { skipped.push({ row: i + 1, why: "same as an earlier row in this call" }); return; }
    seen.add(p.id);
    docs.push({ id: p.id, doc: { ...p.doc, loggedAt: nowIso, expireAt: new Date(Date.parse(nowIso) + 400 * 86400 * 1000).toISOString() } });
  });
  if (!docs.length) return { refused: `no row could be logged: ${skipped.slice(0, 5).map(s => `row ${s.row} ${s.why}`).join("; ")}` };
  return { docs, skipped };
}

module.exports = { ACTIVITY_ACTIONS, MAX_ROWS, planActivity, planRow, clean };
