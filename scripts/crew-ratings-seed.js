// crew-ratings-seed.js — mint the Rate Your Crew rater links (SW v645).
// Input: a JSON array of team members (id, name, title, foremanId, active, access) — the
// PIN-free roster. Output: crewRaters docs (one per rater who has someone to rate) and the
// links to text. Pure planning: it writes nothing; the docs go in through the admin SDK.
//   node scripts/crew-ratings-seed.js roster.json > raters.json
const fs = require("fs");
const crypto = require("crypto");
const R = require("./lib/crewRatings.js");

function plan(users, mint = () => crypto.randomBytes(16).toString("hex"), extrasByRater = {}) {
  const out = [];
  for (const u of users) {
    const people = R.whoIRate(u, users, extrasByRater[u.id]);
    if (!people.length) continue;
    const bad = people.concat(u).find(p => String(p.id).includes("__"));
    if (bad) throw new Error("id with a double underscore breaks the doc id: " + bad.id);
    out.push({ token: mint(), raterId: u.id, name: u.name, people: people.map(p => p.id), peopleCards: people.map(R.personCard) });
  }
  return out;
}
module.exports = { plan };

if (require.main === module) {
  const users = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  process.stdout.write(JSON.stringify(plan(users), null, 2));
}
