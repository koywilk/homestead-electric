// planIntake/review.js — PURE rules for the improvement loop (Koy 2026-10-30): which
// unplaced plan deserves another look, and the weekly score. No I/O.
"use strict";

const MAX_RELATED_LOOKS = 3;
const REOPEN_DAYS = 60;           // a bid can sit for weeks before its quote exists
const STUCK_DAYS = 7;
const DAY = 86400e3;

// Words every plan and job share, so they say nothing about which project it is.
const STOP = new Set(("residence residential home house project none best guess plan plans planset drawing drawings set sets final " +
  "new updated update revised revision small large full copy merged stamped permit bid bids quote quotes design designs group " +
  "lighting electrical electric panel panels layout layouts schedule sheet specs spec cabinet cabinetry appliance appliances " +
  "redline redlines proposed architectural structural addition remodel build builder builders construction homes custom " +
  "street road drive lane court circle north south east west color colors unknown " +
  "valley ridge park city utah hill hills lake canyon mountain view creek farm farms point estate estates").split(" "));

// Letters of 4+ or a 3+ digit number. Dates and lot numbers are too short or too common to identify a job.
function terms(text) {
  const out = new Set();
  const spaced = String(text || "").toLowerCase().replace(/\.pdf\b/g, " ").replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  for (const w of spaced.split(/[^a-z0-9]+/)) {
    if (!w || STOP.has(w)) continue;
    if (/^\d+$/.test(w) ? (w.length >= 3 && w.length !== 8) : w.length >= 4) out.add(w);
  }
  return out;
}

// Never the Routine's free-text reason: it names the jobs it ruled out, and those would match.
function itemTerms(item) {
  const d = (item && item.decision) || {};
  return terms([item && item.filename, item && item.subject, d.bestGuess].filter(Boolean).join(" "));
}

function relatedCandidates(item, fresh) {
  const mine = itemTerms(item);
  return (fresh || []).filter(c => {
    const theirs = terms([c.name, c.site, c.address, c.number].filter(Boolean).join(" "));
    for (const t of theirs) if (mine.has(t)) return true;
    return false;
  });
}

// reopenCount was spent by any new job in the list, related or not, so it no longer blocks.
function mayReopen(item, now) {
  if (!item || item.type !== "email_pdf" || !item.inboxFileId) return false;
  if ((item.relatedReopenCount || 0) >= MAX_RELATED_LOOKS) return false;
  return Date.parse(item.decidedAt || item.createdAt || "") >= now - REOPEN_DAYS * DAY;
}

function sameProject(a, b) {
  const theirs = itemTerms(b);
  for (const t of itemTerms(a)) if (theirs.has(t)) return true;
  return false;
}

// file = Drive's { name, trashed } or null; folders = the parent chain's names, nearest first.
// aliases = the job number a quote converted into, whose folder carries the file with it.
function filedState(filed, file, folders, aliases) {
  if (!file) return "gone";
  if (file.trashed) return "trashed";
  if (filed.note && file.name !== filed.note) return "renamed";
  const nums = [filed.number, ...(aliases || [])].filter(Boolean).map(String);
  const has = (name, n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(String(name));
  return (folders || []).some(name => nums.some(n => has(name, n))) ? "ok" : "moved";
}

const handDecided = (it) => !!(it.decision && it.decision.by);
const digits = (s) => String(s || "").replace(/\D/g, "");

function scoreQueue(items, { now = Date.now(), days = 30, filedStates = {}, guesses = {} } = {}) {
  const since = now - days * DAY;
  const waiting = (it) => it.status === "open" || it.status === "unmatched";
  const rows = (items || []).filter(it => waiting(it) || Date.parse(it.decidedAt || it.createdAt || "") >= since);
  const count = (fn) => rows.filter(fn).length;
  const opens = (items || []).map(it => Date.parse(it.fileFetchedAt || "")).filter(Boolean);
  // The stamp only began with this code, so earlier decisions say nothing about opening the PDF.
  const tracking = opens.length ? Math.min(...opens) : Infinity;
  const states = Object.values(filedStates);
  return {
    days,
    total: rows.length,
    filed: count(it => it.status === "done"),
    dismissed: count(it => it.status === "dismissed"),
    unmatched: count(it => it.status === "unmatched"),
    open: count(it => it.status === "open"),
    byHand: count(handDecided),
    overrodeGuess: count(it => it.status === "done" && handDecided(it) && digits(guesses[it.id]) && digits(guesses[it.id]) !== digits(it.decision.number)),
    stuck7d: count(it => it.status === "unmatched" && Date.parse(it.createdAt || "") < now - STUCK_DAYS * DAY),
    outOfRetries: count(it => it.status === "unmatched" && (it.relatedReopenCount || 0) >= MAX_RELATED_LOOKS),
    filesChecked: states.length,
    movedAfterFiling: states.filter(x => x !== "ok").length,
    decidedUnopened: count(it => it.inboxFileId && !handDecided(it) && !it.fileFetchedAt && ["done", "dismissed"].includes(it.status) && Date.parse(it.decidedAt || "") >= tracking),
  };
}

module.exports = { relatedCandidates, mayReopen, sameProject, filedState, scoreQueue, terms, MAX_RELATED_LOOKS };
