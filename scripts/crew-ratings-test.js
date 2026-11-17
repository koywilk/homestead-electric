// Rate Your Crew: who rates who, answer validation, round math, the per-person roll-up, and
// the shape of the Firestore rules. Run by prebuild.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("./lib/crewRatings.js");
const { plan } = require("./crew-ratings-seed.js");

const U = (id, name, title, foremanId, extra = {}) => ({ id, name, title, foremanId, active: true, access: "limited", ...extra });
const users = [
  U("k", "Keegan", "foreman"), U("g", "Gage", "jrforeman", "k"), U("a", "Austin", "crew", "k"), U("p", "Payton", "crew", "k"),
  U("d", "Daegan", "foreman"), U("l", "Louis", "jrforeman", "d"), U("t", "Trever", "lead", "d"), U("c", "Callen", "crew", "d"),
  U("z", "Zane", "foreman"), U("b", "Braden", "lead", "z"),
  U("j", "Joel", "lead"),                                // lead, no foreman
  U("x", "Paul", "foreman", "", { access: "contractor" }),
  U("o", "Old", "crew", "k", { active: false }),         // deactivated: never rated
  U("kk", "Koy", undefined, undefined, { role: "admin" }),
];
const names = (r) => R.whoIRate(users.find(u => u.id === r), users).map(p => p.name);
assert.deepStrictEqual(names("k"), ["Austin", "Gage", "Payton"], "a foreman rates the crew under them");
assert.deepStrictEqual(names("g"), ["Austin", "Keegan", "Payton"], "a jr foreman rates crewmates and their own foreman, never self");
assert.deepStrictEqual(names("t"), ["Callen", "Daegan", "Louis"]);
assert.deepStrictEqual(names("z"), ["Braden"]);
assert.deepStrictEqual(names("b"), ["Zane"], "a lone lead still rates their foreman");
assert.deepStrictEqual(names("j"), [], "no foreman set → nobody yet");
assert.deepStrictEqual(names("x"), [], "contractors never rate");
assert.deepStrictEqual(names("kk"), [], "office never rates");
assert.ok(!names("k").includes("Old"), "deactivated people are never rated");

const raters = plan(users, (() => { let n = 0; return () => "tok" + String(++n).padStart(14, "0"); })());
assert.deepStrictEqual(raters.map(r => r.name), ["Keegan", "Gage", "Daegan", "Louis", "Trever", "Zane", "Braden"], "only raters with someone to rate get a link");
assert.ok(raters.every(r => r.peopleCards.length === r.people.length));
assert.ok(!JSON.stringify(raters).match(/"(pin|pay|wage|margin|cost|price|amount)[A-Za-z]*":/i), "no pay, pin or dollar field anywhere");

const good = { scores: { quality: 3, pace: 2, reliability: 4, attitude: 3, leading: 1 }, why: { quality: "clean", pace: "slow rough", reliability: "always there", attitude: "good", leading: "new" }, other: " hi " };
assert.ok(R.validateAnswer(good).ok);
assert.strictEqual(R.validateAnswer(good).other, "hi");
assert.ok(!R.validateAnswer({ ...good, scores: { ...good.scores, pace: 5 } }).ok, "rating 1-4 only");
assert.ok(!R.validateAnswer({ ...good, why: { ...good.why, pace: "  " } }).ok, "a why is required for a 2");
assert.ok(!R.validateAnswer({ ...good, why: { ...good.why, reliability: "" } }).ok, "a why is required for a 4");
assert.ok(R.validateAnswer({ ...good, why: { ...good.why, attitude: "" } }).ok, "a plain Solid needs no why");
assert.ok(!R.validateAnswer({ scores: good.scores }).ok);

// extras: Koy adds someone off the crew; never self, never a contractor, never a duplicate
const withExtra = (r, ex) => R.whoIRate(users.find(u => u.id === r), users, ex).map(p => p.name);
assert.deepStrictEqual(withExtra("g", ["c", "g", "x", "a", "nope", "o"]), ["Austin", "Callen", "Keegan", "Payton"], "extra added once; self, contractor, unknown and deactivated ignored");
assert.deepStrictEqual(withExtra("b", ["a"]), ["Austin", "Zane"], "an extra is added beside the foreman");
assert.deepStrictEqual(plan(users, () => "t".repeat(16), { z: ["a"] }).find(r => r.name === "Zane").people, ["a", "b"]);
assert.deepStrictEqual(R.outstanding(users, [], { z: ["a"] }).find(o => o.name === "Zane"), { raterId: "z", name: "Zane", left: 2, of: 2 });

// rounds: the Monday of the week; 14 days
assert.strictEqual(R.mondayOf("2026-11-16"), "2026-11-16");
assert.strictEqual(R.mondayOf("2026-11-19"), "2026-11-16");
assert.strictEqual(R.mondayOf("2026-11-22"), "2026-11-16");
assert.strictEqual(R.newRound("2026-11-16", "Koy", "x").endsOn, "2026-11-29");
assert.ok(R.roundIsOpen(R.newRound("2026-11-16"), "2026-11-29"));
assert.ok(!R.roundIsOpen(R.newRound("2026-11-16"), "2026-11-30"));

// roll-up + outstanding
const docs = [
  { raterId: "k", personId: "a", ...good },
  { raterId: "g", personId: "a", scores: { quality: 1, pace: 1, reliability: 1, attitude: 1, leading: 1 }, why: good.why, other: "" },
  { raterId: "k", personId: "p", scores: good.scores, why: { ...good.why, pace: "" }, other: "" }, // incomplete: ignored
];
const bp = R.byPerson(docs, users);
assert.deepStrictEqual(Object.keys(bp), ["a"]);
assert.strictEqual(bp.a.areas.quality.avg, 2);
assert.strictEqual(bp.a.overall, 1.8);
assert.strictEqual(bp.a.areas.quality.entries[0].word, "Needs work");
const out = R.outstanding(users, docs);
assert.deepStrictEqual(out.find(o => o.name === "Keegan"), { raterId: "k", name: "Keegan", left: 2, of: 3 });
assert.deepStrictEqual(out.find(o => o.name === "Braden"), { raterId: "b", name: "Braden", left: 1, of: 1 });

// the Firestore rules: client can create/update with a valid token only; never list/delete/read broadly
const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const p2 = fs.readFileSync(path.join(__dirname, "..", "firestore.phase2.rules"), "utf8");
for (const f of [rules, p2]) {
  const blk = f.slice(f.indexOf("match /crewRaters/"), f.indexOf("// ── EVERYTHING ELSE"));
  assert.ok(/match \/crewRaters\/\{token\} \{\s*allow get: if true;\s*allow list: if false;\s*allow write: if false;/.test(blk), "raters: get only");
  assert.ok(/match \/crewRatingRounds\/\{id\} \{\s*allow get: if true;\s*allow list: if false;\s*allow write: if false;/.test(blk), "rounds: get only");
  assert.ok(/match \/crewRatings\/\{docId\} \{\s*allow get: if true;\s*allow list: if false;\s*allow delete: if false;/.test(blk), "answers: no list, no delete");
  assert.ok(/crewRatingRounds\/current\)\.data\.closesAt/.test(blk), "writes stop when the round closes");
  assert.ok(/match \/crewUpward\/\{docId\} \{\s*allow get: if true;\s*allow list: if false;\s*allow delete: if false;/.test(blk), "upward: no list, no delete");
  assert.ok(!/dollar|margin|pay\b/i.test(blk.replace(/No pay, margin or dollar field/, "")), "no money field in the rules");
}
assert.ok(rules.indexOf("match /crewRatings/") < rules.indexOf("match /{document=**}"), "catch-all deny stays last");
// the rater page must keep writing exactly the keys the rules accept
const page = fs.readFileSync(path.join(__dirname, "..", "public", "rate", "index.html"), "utf8");
for (const k of ["roundId", "raterToken", "raterId", "personId", "scores", "why", "other", "updatedAt"]) assert.ok(page.includes(k + ":") || page.includes(k + ","), "page writes " + k);

// ── the sync: requests in, firestore writes + artifact docs out ──
const SY = require("./crew-ratings-sync.js");
assert.strictEqual(SY.endOfDayDenver("2026-11-29"), "2026-11-30T06:59:59.000Z", "MST is UTC-7");
assert.strictEqual(SY.endOfDayDenver("2026-07-12"), "2026-07-13T05:59:59.000Z", "MDT is UTC-6");
const sy = [
  { id: "k", name: "Keegan W", title: "foreman", active: true }, { id: "g", name: "Gage L", title: "jrforeman", foremanId: "k", active: true },
  { id: "a", name: "Austin S", title: "crew", foremanId: "k", active: true }, { id: "x", name: "Paul", title: "foreman", access: "contractor", active: true },
  { id: "e", name: "Ed Office", title: "admin", active: true }];
const ppl = ["keegan-w", "gage-l", "austin-s", "paul", "ed-office"].map(id => ({ id }));
let n = 0; const mint = () => "tok" + String(++n).padStart(13, "0");
const base = { users: sy, raters: [], round: null, answers: [], artifactPeople: ppl, today: "2026-11-16", nowIso: "2026-11-16T20:00:00Z", existingRatingIds: ["old-person"] };
let o = SY.run({ ...base, requests: [{ id: "r1", op: "round" }, { id: "r2", op: "set", personId: "keegan-w", rates: ["gage-l", "austin-s", "keegan-w", "nobody"] }, { id: "r3", op: "set", personId: "paul", rates: ["austin-s"] }, { id: "r4", op: "set", personId: "gage-l", rates: [] }] }, mint);
assert.deepStrictEqual(o.results.map(r => r.status), ["done", "done", "error", "error"], "contractor and empty list are refused");
assert.strictEqual(o.results[1].url, "https://homestead-electric.vercel.app/rate/?r=tok0000000000001");
const kw = o.firestore.writes.find(w => w.path === "crewRaters/tok0000000000001");
assert.deepStrictEqual(kw.document.fields.people.arrayValue.values.map(v => v.stringValue), ["g", "a"], "self and unknown dropped");
assert.ok(o.firestore.writes.some(w => w.path === "crewRatingRounds/current" && w.document.fields.closesAt.timestampValue === "2026-11-30T06:59:59.000Z"));
assert.deepStrictEqual(o.artifact.deleteRatings, ["old-person"], "stale artifact ratings are cleared");
assert.strictEqual(o.artifact.status.ratersTotal, 1);
assert.deepStrictEqual(o.artifact.ratings["gage-l"].pending, ["Keegan W"]);
// an existing rater keeps their token when the list changes; an answer shows up; revoke deletes
const raters1 = [{ token: "tokA", raterId: "k", name: "Keegan W", people: ["g", "a"], peopleCards: [] }];
const round1 = R.newRound("2026-11-16", "Koy", "x");
const ans = { roundId: "2026-11-16", raterToken: "tokA", raterId: "k", personId: "a", scores: { quality: 3, pace: 3, reliability: 3, attitude: 3, leading: 3 }, why: { quality: "good", pace: "good", reliability: "good", attitude: "good", leading: "good" }, other: "", updatedAt: "2026-11-16T21:00:00Z" };
o = SY.run({ ...base, raters: raters1, round: round1, answers: [ans, { ...ans, roundId: "2026-11-02", personId: "g" }], requests: [{ id: "r5", op: "set", personId: "keegan-w", rates: ["austin-s"] }] }, mint);
assert.ok(o.firestore.writes.some(w => w.path === "crewRaters/tokA"), "same token reused");
assert.strictEqual(o.artifact.ratings["austin-s"].raters[0], "Keegan W");
assert.strictEqual(o.artifact.ratings["austin-s"].overall, 3);
assert.strictEqual(o.artifact.status.ratersDone, 1, "everyone on the shortened list is done");
assert.strictEqual(o.artifact.status.lastAnswerAt, "2026-11-16T21:00:00Z");
assert.strictEqual(o.artifact.links.links[0].rates[0], "austin-s");
o = SY.run({ ...base, raters: raters1, round: round1, requests: [{ id: "r6", op: "revoke", personId: "keegan-w" }, { id: "r7", op: "revoke", personId: "gage-l" }] }, mint);
assert.deepStrictEqual(o.results.map(r => r.status), ["done", "error"]);
assert.deepStrictEqual(o.firestore.deletes, ["projects/homestead-electric/databases/(default)/documents/crewRaters/tokA"]);
assert.deepStrictEqual(o.artifact.links.links, []);
assert.ok(SY.run({ ...base, requests: [{ id: "r8", op: "round" }], round: round1 }, mint).results[0].note.includes("already open"), "a second tap in the same week changes nothing");

// ── history, fairness, kudos, the field feedback ──
{
  const us = [{ id: "a", name: "Ann A", title: "crew", foremanId: "f", active: true }, { id: "f", name: "Fred F", title: "foreman", active: true },
              { id: "h", name: "Hard H", title: "lead", foremanId: "f", active: true }, { id: "e", name: "Easy E", title: "lead", foremanId: "f", active: true }];
  const rs = [{ token: "t1", raterId: "h", name: "Hard H", people: ["a"] }, { token: "t2", raterId: "e", name: "Easy E", people: ["a"] }];
  const W = (w) => ({ quality: w, pace: w, reliability: w, attitude: w, leading: w });
  const mk = (rid, pid, sc, round, other, kudos) => ({ roundId: round, raterId: rid, personId: pid, scores: { quality: sc, pace: sc, reliability: sc, attitude: sc, leading: sc }, why: W("ok " + rid), other: other || "", kudos, updatedAt: "2026-11-20T00:00:00Z" });
  const old = { id: "2026-11-02", startsOn: "2026-11-02", endsOn: "2026-11-15" }, cur = { id: "2026-11-16", startsOn: "2026-11-16", endsOn: "2026-11-29" };
  const answers = [mk("h", "a", 1, cur.id, "", "Stayed late to finish the rough"), mk("e", "a", 4, cur.id, "", ""), mk("h", "a", 2, old.id), mk("e", "a", 2, old.id),
                   mk("h", "e", 1, cur.id), mk("e", "h", 4, cur.id)];
  const c = SY.compute({ users: us, raters: rs, round: cur, answers, feedback: [{ roundId: cur.id, raterId: "h", text: "Better trucks please", updatedAt: "2026-11-21T00:00:00Z" }, { roundId: old.id, raterId: "h", text: "old", updatedAt: "2026-11-03T00:00:00Z" }], artifactPeople: ["ann-a", "fred-f", "hard-h", "easy-e"].map(id => ({ id })), nowIso: "n", existingRatingIds: [] });
  const ra = c.ratings["ann-a"];
  assert.strictEqual(ra.overall, 2.5, "plain average of a hard 1 and an easy 4");
  assert.ok(ra.adjOverall > 2.4 && ra.adjOverall < 2.6 && Math.abs(ra.adjOverall - ra.overall) < 1, "adjustment stays in range");
  assert.strictEqual(ra.history.length, 2, "both rounds are kept");
  assert.deepStrictEqual(ra.history.map(h => h.roundId), ["2026-11-02", "2026-11-16"]);
  assert.strictEqual(ra.history[0].overall, 2); assert.strictEqual(ra.history[1].overall, 2.5);
  assert.strictEqual(ra.kudos.length, 1); assert.strictEqual(ra.kudos[0].rater, "Hard H");
  assert.ok(ra.areas.quality.entries.every(e => /^[0-9a-z]+$/.test(e.key)), "every comment has a stable key");
  const again = SY.compute({ users: us, raters: rs, round: cur, answers, artifactPeople: ["ann-a", "fred-f", "hard-h", "easy-e"].map(id => ({ id })), nowIso: "m", existingRatingIds: [] });
  assert.deepStrictEqual(again.ratings["ann-a"].areas.quality.entries.map(e => e.key), ra.areas.quality.entries.map(e => e.key), "keys do not change between syncs");
  assert.deepStrictEqual(c.feedback.items.map(f => f.text), ["Better trucks please"], "only this round's field notes");
  assert.strictEqual(c.status.lastAnswerAt, "2026-11-21T00:00:00Z", "a new field note counts as news for the sync check");
}
// a sync fed answers with the scores stripped must refuse, not write an empty picture
{
  const base = { users: [{ id: "a", name: "Ann A", title: "crew", foremanId: "f", active: true }, { id: "f", name: "Fred F", title: "foreman", active: true }], raters: [{ token: "t", raterId: "f", name: "Fred F", people: ["a"] }], round: { id: "2026-11-16", startsOn: "2026-11-16", endsOn: "2026-11-29" }, artifactPeople: [{ id: "ann-a" }], requests: [], existingRatingIds: [], today: "2026-11-17", nowIso: "n" };
  assert.throws(() => SY.run({ ...base, answers: [{ roundId: "2026-11-16", raterId: "f", personId: "a", updatedAt: "x" }] }), /missing scores or why/, "stripped answers are refused");
  assert.throws(() => SY.run({ ...base, answers: [], feedback: [{ roundId: "2026-11-16", raterId: "f", updatedAt: "x" }] }), /missing text/, "stripped field notes are refused");
  assert.doesNotThrow(() => SY.run({ ...base, answers: [] }), "no answers at all is fine");
}
// ── upward feedback (how Koy is doing) ──
{
  assert.strictEqual(R.UPWARD.length, 7, "seven scored questions");
  assert.deepStrictEqual(R.UPWARD_KEYS, ["direction", "available", "obstacles", "fair", "followthrough", "listens", "setup"]);
  const sc = (n) => Object.fromEntries(R.UPWARD_KEYS.map(k => [k, n]));
  assert.ok(R.validateUpward({ scores: sc(3), start: " more notice ", stop: "" }).ok);
  assert.strictEqual(R.validateUpward({ scores: sc(3), start: " more notice " }).start, "more notice");
  assert.ok(!R.validateUpward({ scores: { ...sc(3), listens: 5 } }).ok, "1-4 only");
  assert.ok(!R.validateUpward({ scores: { direction: 3 } }).ok, "all seven needed");
  const us = [{ id: "f1", name: "F One", title: "foreman", active: true }, { id: "f2", name: "F Two", title: "foreman", active: true }, { id: "l1", name: "L One", title: "lead", active: true }, { id: "c1", name: "C One", title: "crew", active: true }];
  const rd = { id: "2026-11-16", startsOn: "2026-11-16", endsOn: "2026-11-29" };
  const U = (rid, n, round, start, stop) => ({ roundId: round || rd.id, raterToken: "t" + rid, raterId: rid, scores: sc(n), start, stop, updatedAt: "2026-11-20T00:00:00Z" });
  const sm = SY.compute({ users: us, raters: [], round: rd, answers: [], upward: [U("f1", 4, null, "Give more notice", "Interrupting"), U("f2", 2, null, "", "Interrupting"), U("l1", 3, null, "More notice on schedule", ""), U("c1", 3, "2026-11-02")], artifactPeople: [], nowIso: "n", existingRatingIds: [] }).upward;
  assert.strictEqual(sm.n, 3, "only this round counts toward the summary");
  assert.strictEqual(sm.overall, 3, "mean of 4, 2, 3");
  assert.deepStrictEqual(sm.areas.direction.dist, [0, 1, 1, 1]);
  assert.deepStrictEqual(Object.keys(sm.byRole), ["foreman"], "a role needs 2+ raters to be shown, so no one is singled out");
  assert.strictEqual(sm.byRole.foreman.n, 2);
  assert.deepStrictEqual(sm.starts.map(x => x.text).sort(), ["Give more notice", "More notice on schedule"]);
  assert.strictEqual(sm.stops.length, 2);
  assert.ok(!JSON.stringify(sm).match(/F One|F Two|L One|raterId|raterToken/), "no rater names or ids in what the artifact sees");
  assert.strictEqual(sm.history.length, 2, "history keeps both rounds");
  assert.throws(() => SY.run({ users: us, raters: [], round: rd, answers: [], upward: [{ roundId: rd.id, raterId: "f1" }], artifactPeople: [], requests: [], existingRatingIds: [], today: "2026-11-17", nowIso: "n" }), /missing scores/, "stripped upward answers are refused");
}
console.log("crew-ratings-test: ok");
