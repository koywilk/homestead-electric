// Team rating and goals (SW v654): release math, the under-2-raters rule, trends, the guy's own
// goals, what his card may carry, and the rules that keep phones out. Run by prebuild.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../functions/myScores.js");

const A = (roundId, raterId, personId, s, updatedAt = "2026-11-01T00:00:00Z") =>
  ({ roundId, raterId, personId, raterToken: "tok" + raterId, updatedAt, why: {}, other: "",
     scores: { quality: s[0], pace: s[1], reliability: s[2], attitude: s[3], leading: s[4] } });

// rounds: 14 days, finished the day after endsOn (Denver), or when the round doc says closed
assert.strictEqual(M.endsOnOf("2026-11-02"), "2026-11-15");
assert.ok(!M.isFinished("2026-11-02", "2026-11-15"), "last day still open");
assert.ok(M.isFinished("2026-11-02", "2026-11-16"));
assert.ok(M.isFinished("2026-11-16", "2026-11-19", { id: "2026-11-16", closed: true }), "closed early");
assert.ok(!M.isFinished("bad", "2026-12-01"));

const answers = [
  // round 1 (Oct 19): Sam rated by k and g
  A("2026-10-19", "k", "sam", [3, 2, 4, 3, 3]),
  A("2026-10-19", "g", "sam", [3, 2, 4, 4, 3]),
  // round 2 (Nov 2): Sam rated by k, g, t; leading only rated low
  A("2026-11-02", "k", "sam", [3, 3, 4, 4, 2]),
  A("2026-11-02", "g", "sam", [3, 3, 4, 4, 2]),
  A("2026-11-02", "t", "sam", [4, 3, 3, 4, 2]),
  // an older duplicate from k for Sam, round 2: the newer one wins
  A("2026-11-02", "k", "sam", [1, 1, 1, 1, 1], "2026-10-01T00:00:00Z"),
  // Lee: one rater only in round 2
  A("2026-11-02", "k", "lee", [4, 4, 4, 4, 4]),
  // self-rating never counts
  A("2026-11-02", "sam", "sam", [1, 1, 1, 1, 1]),
  // round 3 (Nov 16) still open on Nov 19
  A("2026-11-16", "k", "sam", [1, 1, 1, 1, 1]),
  A("2026-11-16", "g", "sam", [1, 1, 1, 1, 1]),
  // incomplete answer: ignored
  { roundId: "2026-11-02", raterId: "z", personId: "sam", scores: { quality: 4 } },
];
const today = "2026-11-19";
const current = { id: "2026-11-16", endsOn: "2026-11-29" };
assert.deepStrictEqual(M.finishedRounds(answers, today, current), ["2026-11-02", "2026-10-19"], "open round left out, newest first");

const st = M.releaseStatus(answers, today, current, null);
assert.deepStrictEqual(st.latest, { roundId: "2026-11-02", startsOn: "2026-11-02", endsOn: "2026-11-15", people: 2 });
assert.strictEqual(st.needsRelease, true);
assert.deepStrictEqual(st.open, { roundId: "2026-11-16", endsOn: "2026-11-29" });
assert.strictEqual(M.releaseStatus(answers, today, current, { roundId: "2026-11-02" }).needsRelease, false);

assert.ok(M.buildRelease(answers, "2026-11-16", today, current, "x").refused, "an open round can't be released");
const r = M.buildRelease(answers, "2026-11-02", today, current, "2026-11-19T15:00:00Z");
assert.strictEqual(r.prevRoundId, "2026-10-19");
assert.strictEqual(r.people, 2);
const sam = r.docs.sam.areas;
assert.deepStrictEqual(sam.quality, { level: 3, word: "Solid", trend: "same", was: "" }, "3,3,4 → 3.3 → Solid");
assert.deepStrictEqual(sam.pace, { level: 3, word: "Solid", trend: "up", was: "Getting there" });
assert.deepStrictEqual(sam.reliability, { level: 4, word: "Strong", trend: "same", was: "" }, "4,4,3 → 3.7 → Strong");
assert.deepStrictEqual(sam.leading, { level: 2, word: "Getting there", trend: "down", was: "Solid" });
assert.deepStrictEqual(r.docs.lee.areas.quality, { level: 0, word: "", trend: "", was: "" }, "one rater → no word");
// nothing in a release can name or count raters, or carry an average
const blob = JSON.stringify(r.docs);
for (const bad of ["raterId", "raterToken", "\"k\"", "\"g\"", "\"t\"", "why", "avg", "raters", "3.3"]) assert.ok(!blob.includes(bad), "release doc never carries " + bad);

// the card
const card = M.buildCard({ scores: r.docs.sam, koyGoal: { text: "  Walk   your own punch list ", date: "2026-11-17" }, own: [{ id: "gabc1234", text: "Learn panel schedules", done: false, addedAt: "x" }, { id: "bad id", text: "x" }] });
assert.strictEqual(card.round.endsOn, "2026-11-15");
assert.deepStrictEqual(card.areas.map(a => a.word), ["Solid", "Solid", "Strong", "Strong", "Getting there"]);
assert.strictEqual(card.koyGoal.text, "Walk your own punch list");
assert.strictEqual(card.goals.length, 1, "a malformed goal is dropped");
const empty = M.buildCard({ scores: null, koyGoal: { text: "  " }, own: null });
assert.deepStrictEqual([empty.round, empty.areas, empty.koyGoal, empty.goals], [null, [], null, []]);

// own goals
let n = 0; const id = () => "gtest" + String(++n).padStart(4, "0");
let g = M.planGoalEdit([], { op: "add", text: "  Run a rough walk  " }, "t1", id);
assert.deepStrictEqual(g.goals, [{ id: "gtest0001", text: "Run a rough walk", done: false, addedAt: "t1", doneAt: "" }]);
assert.ok(M.planGoalEdit(g.goals, { op: "add", text: "run a ROUGH walk" }, "t", id).refused, "no duplicates");
assert.ok(M.planGoalEdit(g.goals, { op: "add", text: "a" }, "t", id).refused, "too short");
g = M.planGoalEdit(g.goals, { op: "toggle", id: "gtest0001" }, "t2", id);
assert.deepStrictEqual([g.goals[0].done, g.goals[0].doneAt], [true, "t2"]);
g = M.planGoalEdit(g.goals, { op: "toggle", id: "gtest0001" }, "t3", id);
assert.deepStrictEqual([g.goals[0].done, g.goals[0].doneAt], [false, ""]);
assert.ok(M.planGoalEdit(g.goals, { op: "remove", id: "nope" }, "t", id).refused);
assert.deepStrictEqual(M.planGoalEdit(g.goals, { op: "remove", id: "gtest0001" }, "t", id).goals, []);
let many = [];
for (let i = 0; i < M.GOALS_MAX; i++) many = M.planGoalEdit(many, { op: "add", text: "Goal number " + i }, "t", id).goals;
assert.ok(M.planGoalEdit(many, { op: "add", text: "One more" }, "t", id).refused, "capped at " + M.GOALS_MAX);
assert.strictEqual(M.planGoalEdit([], { op: "add", text: "x".repeat(400) }, "t", id).goals[0].text.length, M.GOAL_MAX);
assert.ok(M.planGoalEdit([], { op: "rename" }, "t", id).refused);

// rules: phones never read or write these four
const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
for (const c of ["myScores", "myScoresMeta", "crewGoals", "myGoals"]) {
  const m = new RegExp(`match /${c}/\\{id\\} \\{\\s*allow read, write: if false;\\s*\\}`).exec(rules);
  assert.ok(m, `firestore.rules locks ${c}`);
}
// the callables are gated by a live PIN
const idx = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
for (const [fn, gate] of [["myTeamCard", "requireMember"], ["myGoalEdit", "requireMember"], ["crewScoresRelease", "requireAdmin"]]) {
  const at = idx.indexOf(`exports.${fn} =`);
  assert.ok(at > 0, fn + " exported");
  assert.ok(idx.slice(at, at + 400).includes(`await ${gate}(data)`), `${fn} checks ${gate}`);
}
console.log("my-scores-test: ok");
