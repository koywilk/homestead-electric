"use strict";
// myScores.js — Team rating and goals on My Day (SW v654, Koy 2026-11-19).
//
// Koy: "a few guys have asked me for acess to their one on one scores from the guys that rated
// them so can see it any remember what they need to work on ... put that at the top of their my
// day card ... along with they goal they set with me during the meeting". Then, to the mockup:
// show scores "after i release", start the card collapsed, title it "team rating and goals",
// and "give them the ability to add more goals if they want to".
//
// Pure: no Firebase import (functions/index.js does the reads and writes, scripts/my-scores-test.js
// runs this file). Four server-only collections, every one denied to phones by firestore.rules:
//   myScores/{userId}        written ONLY by crewScoresRelease (Koy taps Release in the Claude tab):
//                            { roundId, startsOn, endsOn, areas: { k: { level 0-4, word, trend } },
//                              releasedAt }. Words only: no average, no rater names, no rater count.
//   myScoresMeta/release     { roundId, startsOn, endsOn, people, releasedAt, releasedBy }.
//   crewGoals/fromKoy        { byUser: { <userId>: { text, date } }, updated_at }: each guy's latest
//                            goal from Koy's One-on-Ones tracker, copied in by a nightly cloud
//                            routine through the Duet door (cc_write_doc set byUser).
//   myGoals/{userId}         { goals: [{ id, text, done, addedAt, doneAt }], updatedAt }: the guy's
//                            own goals, written only by myGoalEdit (his own live PIN).
// Rule for privacy: an area rated by fewer than 2 people shows no word ("Not enough ratings yet"),
// so one person's rating never shows on its own.

const AREAS = [
  { key: "quality", label: "Quality" },
  { key: "pace", label: "Pace against hours" },
  { key: "reliability", label: "Reliability" },
  { key: "attitude", label: "Attitude" },
  { key: "leading", label: "Leading others" },
];
const AREA_KEYS = AREAS.map(a => a.key);
const WORDS = { 1: "Needs work", 2: "Getting there", 3: "Solid", 4: "Strong" };
const ROUND_DAYS = 14;
const MIN_RATERS = 2;
const ROUND_ID = /^\d{4}-\d{2}-\d{2}$/;
const GOAL_MAX = 200, GOALS_MAX = 10, KOY_GOAL_MAX = 500;
const GOAL_ID = /^g[a-z0-9]{6,24}$/;

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
function addDays(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const endsOnOf = (roundId) => addDays(roundId, ROUND_DAYS - 1);
// Today in Denver as YYYY-MM-DD.
function denverDay(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(now || new Date());
}

// A finished answer: all five areas rated 1-4 (the rater page can't save less).
function isComplete(d) {
  if (!d || typeof d !== "object" || !d.scores || typeof d.scores !== "object") return false;
  if (!ROUND_ID.test(String(d.roundId || "")) || !clean(d.personId) || !clean(d.raterId)) return false;
  return AREA_KEYS.every(k => Number.isInteger(d.scores[k]) && d.scores[k] >= 1 && d.scores[k] <= 4);
}
// One answer per rater + person + round: the newest wins (a re-sent link keeps the same rater id).
function dedupe(answers) {
  const by = {};
  for (const d of answers || []) {
    if (!isComplete(d)) continue;
    const k = `${d.roundId}|${d.raterId}|${d.personId}`;
    if (!by[k] || String(d.updatedAt || "") > String(by[k].updatedAt || "")) by[k] = d;
  }
  return Object.values(by).filter(d => d.raterId !== d.personId);
}

// A round is finished once its last day has passed in Denver, or the round doc says closed.
function isFinished(roundId, today, current) {
  if (!ROUND_ID.test(String(roundId || ""))) return false;
  if (current && current.id === roundId && current.closed === true) return true;
  return endsOnOf(roundId) < String(today || "");
}
// Finished rounds that have answers, newest first.
function finishedRounds(answers, today, current) {
  const ids = Array.from(new Set(dedupe(answers).map(d => d.roundId)));
  return ids.filter(id => isFinished(id, today, current)).sort().reverse();
}

// Per person, per area: the rounded average as a level 1-4, or 0 when fewer than 2 people rated.
function levelsFor(answers, roundId) {
  const out = {};
  for (const d of dedupe(answers).filter(x => x.roundId === roundId)) {
    const p = out[d.personId] || (out[d.personId] = {});
    for (const k of AREA_KEYS) (p[k] || (p[k] = [])).push(d.scores[k]);
  }
  const res = {};
  for (const [pid, areas] of Object.entries(out)) {
    res[pid] = {};
    for (const k of AREA_KEYS) {
      const xs = areas[k] || [];
      res[pid][k] = xs.length >= MIN_RATERS ? Math.min(4, Math.max(1, Math.round(xs.reduce((a, b) => a + b, 0) / xs.length))) : 0;
    }
  }
  return res;
}

// What Release writes: one myScores doc per person rated in roundId, with the trend against the
// finished round before it (only where both rounds show a word).
function buildRelease(answers, roundId, today, current, nowIso) {
  if (!ROUND_ID.test(String(roundId || ""))) return { refused: "Bad round." };
  const rounds = finishedRounds(answers, today, current);
  if (!rounds.includes(roundId)) return { refused: "That round isn't finished yet, or nobody finished a rating in it." };
  const prevId = rounds.find(id => id < roundId) || null;
  const now = levelsFor(answers, roundId);
  const before = prevId ? levelsFor(answers, prevId) : {};
  const docs = {};
  for (const [pid, lv] of Object.entries(now)) {
    const areas = {};
    for (const k of AREA_KEYS) {
      const l = lv[k], p = before[pid] ? before[pid][k] : 0;
      areas[k] = { level: l, word: l ? WORDS[l] : "", trend: l && p ? (l > p ? "up" : l < p ? "down" : "same") : "", was: l && p && l !== p ? WORDS[p] : "" };
    }
    docs[pid] = { roundId, startsOn: roundId, endsOn: endsOnOf(roundId), areas, releasedAt: nowIso };
  }
  return { roundId, startsOn: roundId, endsOn: endsOnOf(roundId), prevRoundId: prevId, docs, people: Object.keys(docs).length };
}

// Koy's Release card: the newest finished round and whether it's out.
function releaseStatus(answers, today, current, meta) {
  const rounds = finishedRounds(answers, today, current);
  const latest = rounds[0] || null;
  const people = latest ? Object.keys(levelsFor(answers, latest)).length : 0;
  const released = meta && ROUND_ID.test(String(meta.roundId || "")) ? { roundId: meta.roundId, startsOn: meta.startsOn || meta.roundId, endsOn: meta.endsOn || endsOnOf(meta.roundId), people: meta.people || 0, releasedAt: meta.releasedAt || "", releasedBy: meta.releasedBy || "" } : null;
  const open = current && ROUND_ID.test(String(current.id || "")) && !isFinished(current.id, today, current) ? { roundId: current.id, endsOn: current.endsOn || endsOnOf(current.id) } : null;
  return {
    ok: true,
    latest: latest ? { roundId: latest, startsOn: latest, endsOn: endsOnOf(latest), people } : null,
    released,
    needsRelease: !!latest && (!released || released.roundId < latest),
    open,
  };
}

// The guy's own goals.
function cleanGoals(list) {
  return (Array.isArray(list) ? list : []).filter(g => g && GOAL_ID.test(String(g.id || "")) && clean(g.text))
    .slice(0, GOALS_MAX)
    .map(g => ({ id: g.id, text: clean(g.text).slice(0, GOAL_MAX), done: g.done === true, addedAt: String(g.addedAt || ""), doneAt: g.done === true ? String(g.doneAt || "") : "" }));
}
// op: add { text } | toggle { id } | remove { id }. → { goals } | { refused }
function planGoalEdit(existing, args, nowIso, newId) {
  const a = args && typeof args === "object" ? args : {};
  const goals = cleanGoals(existing);
  if (a.op === "add") {
    const text = clean(a.text).slice(0, GOAL_MAX);
    if (text.length < 3) return { refused: "Type the goal first." };
    if (goals.length >= GOALS_MAX) return { refused: `You can keep ${GOALS_MAX} goals. Remove one first.` };
    if (goals.some(g => g.text.toLowerCase() === text.toLowerCase())) return { refused: "That goal is already on your list." };
    return { goals: [...goals, { id: newId(), text, done: false, addedAt: nowIso, doneAt: "" }] };
  }
  const i = goals.findIndex(g => g.id === String(a.id || ""));
  if (a.op === "toggle") {
    if (i < 0) return { refused: "That goal isn't on your list anymore." };
    const g = goals[i], done = !g.done;
    return { goals: goals.map((x, j) => j === i ? { ...g, done, doneAt: done ? nowIso : "" } : x) };
  }
  if (a.op === "remove") {
    if (i < 0) return { refused: "That goal isn't on your list anymore." };
    return { goals: goals.filter((_, j) => j !== i) };
  }
  return { refused: "Unknown change." };
}

// What the guy's card gets: his own record only.
function buildCard({ scores, koyGoal, own }) {
  const s = scores && ROUND_ID.test(String(scores.roundId || "")) ? scores : null;
  const areas = s ? AREAS.map(a => {
    const x = (s.areas && s.areas[a.key]) || {};
    const level = Number.isInteger(x.level) && x.level >= 0 && x.level <= 4 ? x.level : 0;
    return { key: a.key, label: a.label, level, word: level ? WORDS[level] : "", trend: level && ["up", "down", "same"].includes(x.trend) ? x.trend : "", was: level ? clean(x.was) : "" };
  }) : [];
  const kg = koyGoal && clean(koyGoal.text) ? { text: clean(koyGoal.text).slice(0, KOY_GOAL_MAX), date: ROUND_ID.test(String(koyGoal.date || "")) ? koyGoal.date : "" } : null;
  return {
    ok: true,
    round: s ? { roundId: s.roundId, startsOn: s.startsOn || s.roundId, endsOn: s.endsOn || endsOnOf(s.roundId) } : null,
    areas,
    koyGoal: kg,
    goals: cleanGoals(own),
  };
}

module.exports = { AREAS, AREA_KEYS, WORDS, ROUND_DAYS, MIN_RATERS, GOAL_MAX, GOALS_MAX, KOY_GOAL_MAX, GOAL_ID,
  addDays, endsOnOf, denverDay, isComplete, dedupe, isFinished, finishedRounds, levelsFor, buildRelease, releaseStatus,
  cleanGoals, planGoalEdit, buildCard };
