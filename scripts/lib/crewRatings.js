// crewRatings.js — Rate Your Crew (SW v645, 2026-11-16).
//
// Before each biweekly one-on-one, foremen, leads and jr. foremen rate the other
// people on their crew in the same five areas the one-on-one uses. Koy sees every
// rater's answers for a person, hidden until he taps open "Team ratings".
//
// PRIVACY: the app's Firestore rules are open, so the ratings live in two
// collections the rules deny to every client (crewRatings, crewRatingRounds).
// Only the PIN-checked callables in functions/index.js touch them, and every one
// of them reads this module for the rules of who rates whom. No pay, margin or
// dollar figure exists anywhere in this feature.
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js) and the Cloud
// Functions require a COPY (functions/crewRatings.js). scripts/crew-ratings-test.js
// fails the build when the two copies differ, and drives the file that ships.

const AREAS = [
  { key: "quality", label: "Quality" },
  { key: "pace", label: "Pace against hours" },
  { key: "reliability", label: "Reliability" },
  { key: "attitude", label: "Attitude" },
  { key: "leading", label: "Leading others" },
];
const AREA_KEYS = AREAS.map(a => a.key);
const WORDS = { 1: "Needs work", 2: "Getting there", 3: "Solid", 4: "Strong" };
const RATER_TITLES = ["foreman", "jrforeman", "lead"];
const WHY_MAX = 500;
const OTHER_MAX = 1000;
const ROUND_DAYS = 14;

const clean = (v) => String(v == null ? "" : v).trim();
const lower = (v) => clean(v).toLowerCase();

// The same fallback the rest of the app uses for a user with no Team title.
function titleOf(u) {
  if (!u) return "crew";
  if (u.title) return u.title;
  if (["admin", "justin", "jeromy"].includes(u.role)) return "admin";
  if (["foreman", "lead", "crew"].includes(u.role)) return u.role;
  return "crew";
}
const isActive = (u) => !!u && u.active !== false;
const isContractor = (u) => !!u && (u.access === "contractor" || u.role === "contractor");
const idOf = (u) => clean(u && u.id);

// Everyone active, on the field team, not a contractor: foreman, jr. foreman, lead, crew.
function onTheCrew(u) {
  return isActive(u) && !isContractor(u) && ["foreman", "jrforeman", "lead", "crew"].includes(titleOf(u));
}

// Which foreman's crew a person belongs to ("" = none): a foreman leads their own.
function crewKeyOf(u) {
  if (!u) return "";
  if (titleOf(u) === "foreman") return idOf(u);
  return clean(u.foremanId);
}

function canRate(u) {
  return isActive(u) && !isContractor(u) && RATER_TITLES.includes(titleOf(u));
}

// The people `rater` rates: everyone on their foreman's crew except themselves and
// except the foreman (a foreman rates the crew under them; a lead rates their crewmates).
// `extras` = people Koy added by hand for this rater (someone off their crew who works
// beside them a lot): an array of user ids. Anyone active and not a contractor can be
// added, never the rater themself.
function whoIRate(rater, users, extras) {
  if (!canRate(rater)) return [];
  const key = crewKeyOf(rater);
  const crew = key ? (users || []).filter(u => onTheCrew(u) && titleOf(u) !== "foreman" && clean(u.foremanId) === key && idOf(u) !== idOf(rater)) : [];
  const have = new Set(crew.map(idOf));
  const added = (Array.isArray(extras) ? extras : [])
    .map(id => (users || []).find(u => idOf(u) === clean(id)))
    .filter(u => u && isActive(u) && !isContractor(u) && idOf(u) !== idOf(rater) && !have.has(idOf(u)) && (have.add(idOf(u)), true));
  return crew.concat(added).sort((a, b) => clean(a.name).localeCompare(clean(b.name)));
}

function personCard(u) {
  return { id: idOf(u), name: clean(u.name), title: titleOf(u) };
}

// ── Rounds ────────────────────────────────────────────────────────────────────
// A round is the two weeks starting the Monday it opens. id = that Monday, YYYY-MM-DD.
function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
// The Monday on or before the given local calendar day ("YYYY-MM-DD" in, "YYYY-MM-DD" out).
function mondayOf(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(day));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - back);
  return ymd(d);
}
function addDays(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(day));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function newRound(today, by, nowIso) {
  const id = mondayOf(today);
  return { id, startsOn: id, endsOn: addDays(id, ROUND_DAYS - 1), openedBy: clean(by).slice(0, 80), openedAt: clean(nowIso), closed: false };
}
// A round takes answers while it is not closed and its last day has not passed.
function roundIsOpen(round, today) {
  if (!round || round.closed) return false;
  return clean(today) <= clean(round.endsOn);
}
const ROUND_ID = /^\d{4}-\d{2}-\d{2}$/;
const PERSON_ID = /^[A-Za-z0-9_-]{1,80}$/;
const docId = (roundId, raterId, personId) => `${roundId}__${raterId}__${personId}`;

// ── Answers ───────────────────────────────────────────────────────────────────
// Every area needs a 1-4 rating AND a why. Koy does not want number-only answers.
function validateAnswer(input) {
  const scores = {}, why = {};
  for (const k of AREA_KEYS) {
    const s = Number(input && input.scores && input.scores[k]);
    if (!Number.isInteger(s) || s < 1 || s > 4) return { ok: false, err: `Pick a rating for ${AREAS.find(a => a.key === k).label}.` };
    const w = clean(input && input.why && input.why[k]);
    if (!w) return { ok: false, err: `Add a short why for ${AREAS.find(a => a.key === k).label}.` };
    scores[k] = s;
    why[k] = w.slice(0, WHY_MAX);
  }
  return { ok: true, scores, why, other: clean(input && input.other).slice(0, OTHER_MAX) };
}
const isComplete = (doc) => !!doc && validateAnswer(doc).ok;

// ── Koy's view ────────────────────────────────────────────────────────────────
const avg = (xs) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

// docs = every answer for one round. Returns, per person rated, each area's
// rater-by-rater word + why, the area average, and the overall average.
function byPerson(docs, users) {
  const nameOf = (id) => { const u = (users || []).find(x => idOf(x) === id); return u ? clean(u.name) : id; };
  const people = {};
  for (const d of docs || []) {
    if (!isComplete(d)) continue;
    const p = people[d.personId] || (people[d.personId] = { personId: d.personId, name: nameOf(d.personId), raters: [], areas: {}, overall: null, other: [] });
    p.raters.push(nameOf(d.raterId));
    if (clean(d.other)) p.other.push({ rater: nameOf(d.raterId), text: clean(d.other) });
    for (const k of AREA_KEYS) {
      (p.areas[k] || (p.areas[k] = { entries: [], avg: null })).entries.push({ rater: nameOf(d.raterId), score: d.scores[k], word: WORDS[d.scores[k]], why: d.why[k] });
    }
  }
  for (const p of Object.values(people)) {
    const all = [];
    for (const k of AREA_KEYS) {
      const a = p.areas[k];
      a.entries.sort((x, y) => x.rater.localeCompare(y.rater));
      a.avg = avg(a.entries.map(e => e.score));
      a.entries.forEach(e => all.push(e.score));
    }
    p.overall = avg(all);
    p.raters.sort((x, y) => x.localeCompare(y));
  }
  return people;
}

// Who still owes ratings this round: every rater with at least one person left undone.
function outstanding(users, docs, extrasByRater) {
  const done = new Set((docs || []).filter(isComplete).map(d => `${d.raterId}|${d.personId}`));
  const out = [];
  for (const r of users || []) {
    if (!canRate(r)) continue;
    const mine = whoIRate(r, users, (extrasByRater || {})[idOf(r)]);
    if (!mine.length) continue;
    const left = mine.filter(p => !done.has(`${idOf(r)}|${idOf(p)}`));
    if (left.length) out.push({ raterId: idOf(r), name: clean(r.name), left: left.length, of: mine.length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  AREAS, AREA_KEYS, WORDS, RATER_TITLES, ROUND_DAYS, WHY_MAX, OTHER_MAX, ROUND_ID, PERSON_ID,
  titleOf, canRate, whoIRate, personCard, onTheCrew,
  mondayOf, addDays, newRound, roundIsOpen, docId,
  validateAnswer, isComplete, byPerson, outstanding,
};
