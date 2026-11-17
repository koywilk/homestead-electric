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
assert.deepStrictEqual(names("g"), ["Austin", "Payton"], "a jr foreman rates crewmates, not self and not the foreman");
assert.deepStrictEqual(names("t"), ["Callen", "Louis"]);
assert.deepStrictEqual(names("z"), ["Braden"]);
assert.deepStrictEqual(names("b"), [], "an only child has no one to rate");
assert.deepStrictEqual(names("j"), [], "no foreman set → nobody yet");
assert.deepStrictEqual(names("x"), [], "contractors never rate");
assert.deepStrictEqual(names("kk"), [], "office never rates");
assert.ok(!names("k").includes("Old"), "deactivated people are never rated");

const raters = plan(users, (() => { let n = 0; return () => "tok" + String(++n).padStart(14, "0"); })());
assert.deepStrictEqual(raters.map(r => r.name), ["Keegan", "Gage", "Daegan", "Louis", "Trever", "Zane"], "only raters with someone to rate get a link");
assert.ok(raters.every(r => r.peopleCards.length === r.people.length));
assert.ok(!JSON.stringify(raters).match(/"(pin|pay|wage|margin|cost|price|amount)[A-Za-z]*":/i), "no pay, pin or dollar field anywhere");

const good = { scores: { quality: 3, pace: 2, reliability: 4, attitude: 3, leading: 1 }, why: { quality: "clean", pace: "slow rough", reliability: "always there", attitude: "good", leading: "new" }, other: " hi " };
assert.ok(R.validateAnswer(good).ok);
assert.strictEqual(R.validateAnswer(good).other, "hi");
assert.ok(!R.validateAnswer({ ...good, scores: { ...good.scores, pace: 5 } }).ok, "rating 1-4 only");
assert.ok(!R.validateAnswer({ ...good, why: { ...good.why, attitude: "  " } }).ok, "a why is required");
assert.ok(!R.validateAnswer({ scores: good.scores }).ok);

// extras: Koy adds someone off the crew; never self, never a contractor, never a duplicate
const withExtra = (r, ex) => R.whoIRate(users.find(u => u.id === r), users, ex).map(p => p.name);
assert.deepStrictEqual(withExtra("g", ["c", "g", "x", "a", "nope", "o"]), ["Austin", "Callen", "Payton"], "extra added once; self, contractor, unknown and deactivated ignored");
assert.deepStrictEqual(withExtra("b", ["a"]), ["Austin"], "an only child can still get an extra");
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
assert.ok(!out.find(o => o.name === "Braden"));

// the Firestore rules: client can create/update with a valid token only; never list/delete/read broadly
const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const p2 = fs.readFileSync(path.join(__dirname, "..", "firestore.phase2.rules"), "utf8");
for (const f of [rules, p2]) {
  const blk = f.slice(f.indexOf("match /crewRaters/"), f.indexOf("// ── EVERYTHING ELSE"));
  assert.ok(/match \/crewRaters\/\{token\} \{\s*allow get: if true;\s*allow list: if false;\s*allow write: if false;/.test(blk), "raters: get only");
  assert.ok(/match \/crewRatingRounds\/\{id\} \{\s*allow get: if true;\s*allow list: if false;\s*allow write: if false;/.test(blk), "rounds: get only");
  assert.ok(/match \/crewRatings\/\{docId\} \{\s*allow get: if true;\s*allow list: if false;\s*allow delete: if false;/.test(blk), "answers: no list, no delete");
  assert.ok(/crewRatingRounds\/current\)\.data\.closesAt/.test(blk), "writes stop when the round closes");
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
console.log("crew-ratings-test: ok");
