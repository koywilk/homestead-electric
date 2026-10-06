// planIntake/walks.js — PURE rules for "a site walk landed on Koy's calendar →
// which Simpro quote is it?" (PLAN_INTAKE_SPEC.md Phase 1, 2026-10-03). No I/O:
// the watcher feeds it calendar events and what Simpro said about a site, and
// acts on the verdict. Anything these rules can't decide confidently goes to
// the Routine as `walk_unmatched` — judgment lives there, not here.
"use strict";

// Only walks scheduled by these people count (Koy's own events are his).
const WALKERS = new Set(["josh", "brady", "justin"]);

// Every event in this Workspace carries an auto-attached Google Meet link —
// walks included — so "virtual" is read from the TITLE, never from
// conferenceData. (Found in Koy's Jul–Sep 2026 calendar: 100% had a Meet URL.)
const VIRTUAL_RE = /\b(zoom|google meet|meet|teams|facetime|phone call|call)\b/i;
// "James Livingston 1st Day" (first dry run, 2026-10-04): new-hire events aren't walks.
// Test run 2026-10-04 added "Lutron Show Room" and "1 of 3 Truck Detail" — not walks.
const MEETING_RE = /\b(meeting|trade partner|interview|training|lunch|scramble|strategy|coordination|showcase|onboarding|orientation|show ?room|truck)\b|\b(1st|first) day\b/i;
const WALK_RE = /\b(walk|walks|walkthrough|walk-through|walk through|redlines?|red[ -]lines?)\b/i;
// "#1407", "Job 1407", "job #1407" — a walk on a job we already have.
const JOB_REF_RE = /#\s?\d{3,5}\b|\bjob\s*#?\s*\d{3,5}\b/i;
// The office (974 S Main, and the 973 typo) is where meetings happen, not a site.
const OFFICE_RE = /\b97[34]\s+s\.?\s+main\b/i;

function _creatorKey(ev) {
  const e = String((ev && ev.creator && ev.creator.email) || "").toLowerCase();
  return e.endsWith("@homesteadelectric.net") ? e.split("@")[0] : "";
}

function _isPhysicalLocation(loc) {
  const s = String(loc || "").trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s) || /meet\.google|zoom\.us|teams\.microsoft/i.test(s)) return false;
  if (OFFICE_RE.test(s)) return false;
  return true;
}

// classifyEvent(ev) → { kind: "walk" | "maybe" | "skip", reason, address }
//   walk  = schedule it for matching
//   maybe = from a walker, not ruled out, but no walk word and no site location
//           ("Oak hill 5 - E Builders/Homestead") → the Routine decides
//   skip  = not ours / not a walk
function classifyEvent(ev) {
  if (!ev) return { kind: "skip", reason: "no event", address: null };
  const title = String(ev.summary || "").trim();
  if (ev.status === "cancelled") return { kind: "skip", reason: "cancelled", address: null };
  if (!WALKERS.has(_creatorKey(ev))) return { kind: "skip", reason: "not created by josh/brady/justin", address: null };
  if (ev.recurringEventId) return { kind: "skip", reason: "recurring", address: null };
  if (MEETING_RE.test(title)) return { kind: "skip", reason: "meeting", address: null };
  if (VIRTUAL_RE.test(title)) return { kind: "skip", reason: "virtual", address: null };
  if (JOB_REF_RE.test(title)) return { kind: "skip", reason: "references a job number", address: null };

  const physical = _isPhysicalLocation(ev.location);
  const address = (physical && extractAddress(ev.location)) || extractAddress(title);
  if (WALK_RE.test(title)) return { kind: "walk", reason: "walk keyword", address };
  if (physical) return { kind: "walk", reason: "site location", address };
  return { kind: "maybe", reason: "no walk word, no site location", address };
}

// ── Addresses ────────────────────────────────────────────────────────────
// Utah grid addresses ("1326 S 5360 E") and named streets ("4654 Holly Ln",
// "1915 S Preserve Dr") both reduce to { number, tokens } where tokens are the
// street's significant words — directions and suffixes dropped, so
// "Holly Lane" == "Holly Ln" and "721 S 2200 E " == "721 S 2200 E".
const DIRS = new Set(["n", "s", "e", "w", "north", "south", "east", "west", "ne", "nw", "se", "sw"]);
const SUFFIX = new Set(["st", "street", "ln", "lane", "dr", "drive", "rd", "road", "ave", "avenue", "pl", "place",
  "ct", "court", "cir", "circle", "way", "blvd", "boulevard", "loop", "trl", "trail", "pkwy", "parkway", "cv", "cove"]);
// Words that end a street name inside a title ("4654 Holly Lane Remodel - Black Cactus").
const STOP = new Set(["remodel", "residence", "walk", "walkthrough", "redline", "redlines", "quote", "addition",
  "basement", "new", "build", "construction", "home", "house", "lot", "unit", "apt", "suite"]);

function extractAddress(text) {
  const s = String(text || "");
  // first "number + street words" run; the city / state after a comma is ignored
  const m = s.match(/\b(\d{2,6})\s+((?:[A-Za-z0-9.'-]+\s*){1,6})/);
  if (!m) return null;
  const words = m[2].split(/[\s,]+/).map(w => w.toLowerCase().replace(/[.']/g, "")).filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (STOP.has(w) || w === "-") break;
    if (SUFFIX.has(w)) break;                // the suffix ends the street name
    kept.push(DIRS.has(w) && w.length > 2 ? w[0] : w);   // "North" → "n", "NE" stays "ne"
    if (kept.filter(t => !DIRS.has(t)).length >= 3) break;
  }
  // Grid addresses ("1326 S 5360 E") need their directions — "1326 E 5360 S" is
  // a different house. Named streets drop them ("4535 North Old Ranch Rd" ==
  // "4535 Old Ranch Rd"), since people write the prefix inconsistently.
  const grid = kept.some(t => /^\d+$/.test(t));
  const tokens = grid ? kept : kept.filter(t => !DIRS.has(t));
  if (!tokens.some(t => !DIRS.has(t))) return null;
  return { number: m[1], tokens, raw: s.slice(m.index, m.index + m[0].length).trim() };
}

// "Whitaker Farm Way" (calendar) vs "Whitaker Farms Way" (Simpro) is the same street —
// a trailing "s" on a word of 4+ letters is ignored. Grid numbers ("2200") compare exactly.
function _same(t, u) {
  if (t === u) return true;
  if (/^\d+$/.test(String(t)) || /^\d+$/.test(String(u))) return false;
  const stem = w => (w || "").length > 3 ? w.replace(/s$/, "") : w;
  return stem(t) === stem(u);
}

function sameAddress(a, b) {
  if (!a || !b || a.number !== b.number) return false;
  // the shorter token list must be a prefix of the longer ("old ranch" vs "old ranch")
  const [x, y] = a.tokens.length <= b.tokens.length ? [a.tokens, b.tokens] : [b.tokens, a.tokens];
  return x.length > 0 && x.every((t, i) => _same(t, y[i]));
}

// ── Which quote? ─────────────────────────────────────────────────────────
// pickQuote({ walkDate, quotes, jobs, now }) — quotes/jobs are every Simpro
// quote/job at the matched site(s). Simpro shapes (verified 2026-10-03):
//   quote: { ID, Name, Stage, DateIssued, IsClosed, JobNo, LinkedJobID }
//   job:   { ID, Name, Stage, DateIssued, ConvertedFrom: { ID, Type, Date } }
// A quote is "the walk's quote" when, as of the walk date, it was open and it
// is a MAIN quote — not a change-order quote (LinkedJobID set, or merged into a
// job that was converted from a different quote) and not a temp-ped quote.
// Returns { result: "quote", quoteId } | { result: "ambiguous", quoteIds }
//       | { result: "existing_job", jobId } | { result: "none" }
const LOOKAHEAD_DAYS = 14;   // a quote walk often happens before the quote exists
const TEMP_RE = /\btemp(orary)?\.?\s*(ped|pedestal|power)\b/i;

function _day(s) { return String(s || "").slice(0, 10); }
function _addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function pickQuote({ walkDate, quotes = [], jobs = [], now } = {}) {
  const T = _day(walkDate);
  const horizon = [_addDays(T, LOOKAHEAD_DAYS), _day(now || "9999-12-31")].sort()[0];
  const jobById = new Map(jobs.filter(Boolean).map(j => [String(j.ID), j]));
  const convertedAt = new Map();
  for (const j of jobs) {
    const cf = j && j.ConvertedFrom;
    if (cf && cf.Type === "Quote" && cf.ID != null) convertedAt.set(String(cf.ID), _day(cf.Date || j.DateIssued));
  }
  const isCO = q => {
    if (q.LinkedJobID) return true;
    if (q.JobNo == null || q.JobNo === "") return false;
    const j = jobById.get(String(q.JobNo));
    return !!(j && j.ConvertedFrom && String(j.ConvertedFrom.ID) !== String(q.ID));
  };
  const eligible = quotes.filter(q => {
    if (!q || q.Stage === "Archived" || TEMP_RE.test(q.Name || "") || isCO(q)) return false;
    if (_day(q.DateIssued) > horizon) return false;
    const conv = convertedAt.get(String(q.ID));
    if (conv) return conv >= T;            // converted on/after the walk → it was open at the walk
    return !q.IsClosed;                    // closed without converting = declined/lost
  });
  // A quote already open on the walk date wins. The lookahead only counts when
  // nothing existed yet (a quote walk BEFORE the quote is written) — otherwise
  // an add-on quote written a week after a redline walk would look like a rival.
  const before = eligible.filter(q => _day(q.DateIssued) <= T);
  const open = before.length ? before : eligible;
  // An active job at the address wins: an open quote there is an add-on for
  // that job (Pierce #1277 + "Lutron Ra3 Lighting Control"), and a separate
  // quote folder would split the house's plans in two. The open quotes ride
  // along so the finding can name them.
  const active = jobs.find(j => j && (j.Stage === "Progress" || j.Stage === "Pending") && !TEMP_RE.test(j.Name || "")
    && _day(j.DateIssued) <= T);
  if (active) return { result: "existing_job", jobId: active.ID, openQuoteIds: open.map(q => q.ID) };
  if (open.length === 1) return { result: "quote", quoteId: open[0].ID };
  if (open.length > 1) return { result: "ambiguous", quoteIds: open.map(q => q.ID) };
  return { result: "none" };
}

module.exports = { WALKERS, classifyEvent, extractAddress, sameAddress, pickQuote, LOOKAHEAD_DAYS };
