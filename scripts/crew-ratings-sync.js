// crew-ratings-sync.js — the brain of the Rate Your Crew sync (SW v645).
//
// The one-on-one artifact cannot call a server or write to Firestore, and the ratings live in
// Firestore collections no client can read. A scheduled Claude task carries the data both ways
// with the Firebase and artifact tools; THIS file does every decision so the task stays cheap:
//   in : users (PIN-free roster), raters (crewRaters docs), round (crewRatingRounds/current),
//        answers (crewRatings docs), artifactPeople, requests (rater_requests rows with status
//        "new"), existing artifact ratings ids.
//   out: results (one per request), firestore writes/deletes (typed, ready to send), and the
//        artifact docs (ratings/*, ratings_meta/status, ratings_meta/links).
//
//   node scripts/crew-ratings-sync.js in.json out.json
//
// A request (written by the artifact, so Koy only; still validated here):
//   { id, op: "set",    personId: <artifact id of the rater>, rates: [<artifact ids>] }  create or change a link
//   { id, op: "revoke", personId }                                                       kill a link
//   { id, op: "round" }                                                                  open this week's round
const fs = require("fs");
const crypto = require("crypto");
const R = require("./lib/crewRatings.js");

const PROJECT = "projects/homestead-electric/databases/(default)/documents";
const BASE = "https://homestead-electric.vercel.app/rate/?r=";
const AID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const slug = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// ── typed Firestore values ───────────────────────────────────────────────────
function typed(v) {
  if (v && typeof v === "object" && v.__ts) return { timestampValue: v.__ts };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(typed) } };
  if (v && typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typed(x)])) } };
  return { nullValue: "NULL_VALUE" };
}
const upsert = (path, plain) => ({ path, name: `${PROJECT}/${path}`, document: { name: `${PROJECT}/${path}`, fields: Object.fromEntries(Object.entries(plain).map(([k, x]) => [k, typed(x)])) }, updateMask: { fieldPaths: Object.keys(plain) } });

// 23:59:59 Mountain on `day`, as a UTC instant (handles MST and MDT).
function endOfDayDenver(day) {
  for (const off of [6, 7]) {
    const t = new Date(`${day}T23:59:59Z`).getTime() + off * 3600e3;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(t));
    if (parts.replace(", ", "T") === `${day}T23:59:59`) return new Date(t).toISOString();
  }
  return `${day}T23:59:59Z`;
}
const roundDoc = (r) => ({ id: r.id, startsOn: r.startsOn, endsOn: r.endsOn, closesAt: { __ts: endOfDayDenver(r.endsOn) }, openedBy: r.openedBy || "Koy" });

// ── requests ─────────────────────────────────────────────────────────────────
function handleRequests({ users, raters, round, requests, artifactPeople, today, nowIso, mint }) {
  const onTeam = (users || []).filter(R.onTheCrew);
  const known = new Set((artifactPeople || []).map(p => p.id));
  const userOf = (pid) => AID.test(String(pid || "")) && known.has(pid) ? onTeam.find(u => slug(u.name) === pid) : null;
  const out = { raters: raters.map(x => ({ ...x })), round, results: [], writes: [], deletes: [] };
  for (const q of requests || []) {
    const res = { id: String(q && q.id), status: "error", err: "", url: "" };
    try {
      if (q.op === "round") {
        const nr = R.newRound(today, "Koy", nowIso);
        if (round && round.id === nr.id) { res.status = "done"; res.note = "A round is already open for this week."; }
        else { out.round = nr; out.writes.push(upsert("crewRatingRounds/current", roundDoc(nr))); res.status = "done"; res.note = "Round of " + nr.startsOn + " opened."; }
      } else if (q.op === "set") {
        const rater = userOf(q.personId);
        if (!rater) throw new Error("That person isn't on the team list, or is a contractor.");
        const rates = Array.from(new Set((Array.isArray(q.rates) ? q.rates : []).map(String))).slice(0, 30);
        const ppl = rates.map(userOf).filter(Boolean).filter(u => u.id !== rater.id);
        if (!ppl.length) throw new Error("Pick at least one person for them to rate.");
        const existing = out.raters.find(x => x.raterId === rater.id);
        const doc = { raterId: rater.id, name: rater.name, people: ppl.map(u => u.id), peopleCards: ppl.map(R.personCard) };
        if ([doc.raterId].concat(doc.people).some(id => String(id).includes("__"))) throw new Error("A team id has a double underscore.");
        const token = existing ? existing.token : mint();
        if (existing) Object.assign(existing, doc); else out.raters.push({ token, ...doc });
        out.writes.push(upsert(`crewRaters/${token}`, doc));
        res.status = "done"; res.url = BASE + token;
      } else if (q.op === "revoke") {
        const rater = userOf(q.personId);
        const existing = rater && out.raters.find(x => x.raterId === rater.id);
        if (!existing) throw new Error("They don't have a link.");
        out.raters = out.raters.filter(x => x !== existing);
        out.deletes.push(`${PROJECT}/crewRaters/${existing.token}`);
        res.status = "done";
      } else throw new Error("Unknown request.");
    } catch (e) { res.err = e.message || "Couldn't do that."; }
    out.results.push(res);
  }
  return out;
}

// ── what the artifact shows ──────────────────────────────────────────────────
// small helpers for the extra numbers
const hash = (str) => { let h = 5381; for (const ch of String(str)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return h.toString(36); };
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r1 = (v) => v == null ? null : Math.round(v * 10) / 10;
const clamp14 = (v) => Math.max(1, Math.min(4, v));

function compute({ users, raters, round, answers, feedback, artifactPeople, nowIso, existingRatingIds }) {
  const known = new Set((artifactPeople || []).map(p => p.id));
  const pidOf = (uid) => { const u = (users || []).find(x => x.id === uid); const s = u ? slug(u.name) : ""; return known.has(s) ? s : null; };
  const nameOf = (uid) => { const u = (users || []).find(x => x.id === uid); return u ? String(u.name || uid) : uid; };
  const empty = { ratings: {}, deleteRatings: (existingRatingIds || []).slice(), status: { noRound: true, syncedAt: nowIso, outstanding: [], ratersTotal: 0, ratersDone: 0 }, links: { links: [] }, feedback: { items: [], syncedAt: nowIso } };
  const links = { links: raters.map(x => ({ name: x.name, personId: pidOf(x.raterId) || "", count: x.people.length, url: BASE + x.token, rates: x.people.map(pidOf).filter(Boolean) })).sort((a, b) => a.name.localeCompare(b.name)) };
  if (!round) return { ...empty, links };

  const complete = (answers || []).filter(d => d && R.isComplete(d));
  const ok = complete.filter(d => d.roundId === round.id);
  const done = new Set(ok.map(d => `${d.raterId}|${d.personId}`));
  const by = R.byPerson(ok, users);

  // Fairness: some raters score everyone hard and some score everyone easy. Each rater's own
  // average (against the team's) is nudged out, more strongly the more people they rated.
  const gAll = mean(ok.flatMap(d => R.AREA_KEYS.map(k => d.scores[k])));
  const byRater = {};
  ok.forEach(d => (byRater[d.raterId] = byRater[d.raterId] || []).push(d));
  const off = {};
  for (const [rid, ds] of Object.entries(byRater)) off[rid] = (mean(ds.flatMap(d => R.AREA_KEYS.map(k => d.scores[k]))) - gAll) * (ds.length / (ds.length + 3));
  const adj = {};
  ok.forEach(d => { const a = adj[d.personId] = adj[d.personId] || { all: [], areas: {} };
    R.AREA_KEYS.forEach(k => { const v = clamp14(d.scores[k] - (off[d.raterId] || 0)); a.all.push(v); (a.areas[k] = a.areas[k] || []).push(v); }); });

  // History: every finished round, per person.
  const hist = {};
  complete.forEach(d => { const h = (hist[d.personId] = hist[d.personId] || {}); (h[d.roundId] = h[d.roundId] || []).push(d); });
  const historyOf = (personId) => Object.entries(hist[personId] || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([roundId, ds]) => ({
    roundId, n: ds.length,
    overall: r1(mean(ds.flatMap(d => R.AREA_KEYS.map(k => d.scores[k])))),
    areas: Object.fromEntries(R.AREA_KEYS.map(k => [k, r1(mean(ds.map(d => d.scores[k])))])),
  }));

  const recs = {};
  const newRec = (personId) => ({ name: nameOf(personId), roundId: round.id, raters: [], pending: [], areas: {}, overall: null, adjAreas: {}, adjOverall: null, other: [], kudos: [], history: historyOf(personId), syncedAt: nowIso });
  for (const x of raters) for (const personId of x.people) {
    const pid = pidOf(personId); if (!pid) continue;
    const rec = recs[pid] || (recs[pid] = newRec(personId));
    if (!done.has(`${x.raterId}|${personId}`)) rec.pending.push(x.name);
  }
  for (const personId of Object.keys(hist)) { const pid = pidOf(personId); if (pid && !recs[pid]) recs[pid] = newRec(personId); }
  for (const [personId, p] of Object.entries(by)) {
    const pid = pidOf(personId); if (!pid || !recs[pid]) continue;
    // a stable key per comment lets Koy's approvals survive every re-sync
    const areas = {};
    for (const [k, ar] of Object.entries(p.areas)) areas[k] = { avg: ar.avg, entries: ar.entries.map(e => ({ ...e, key: hash(k + "|" + e.why) })) };
    const a = adj[personId];
    Object.assign(recs[pid], {
      raters: p.raters, areas, overall: p.overall, other: p.other,
      adjAreas: a ? Object.fromEntries(R.AREA_KEYS.map(k => [k, r1(mean(a.areas[k] || []))])) : {}, adjOverall: a ? r1(mean(a.all)) : null,
      kudos: ok.filter(d => d.personId === personId && String(d.kudos || "").trim()).map(d => ({ rater: nameOf(d.raterId), text: String(d.kudos).trim(), key: hash("kudos|" + String(d.kudos).trim()) })).sort((x, y) => x.rater.localeCompare(y.rater)),
    });
  }
  Object.values(recs).forEach(r => r.pending.sort());
  const outstanding = raters.map(x => { const left = x.people.filter(id => !done.has(`${x.raterId}|${id}`)).length; return { name: x.name, left, of: x.people.length }; }).filter(o => o.left > 0).sort((a, b) => a.name.localeCompare(b.name));
  const fb = (feedback || []).filter(f => f && f.roundId === round.id && String(f.text || "").trim());
  const lastAnswerAt = ok.map(d => String(d.updatedAt || "")).concat(fb.map(f => String(f.updatedAt || ""))).sort().pop() || "";
  return {
    ratings: recs,
    deleteRatings: (existingRatingIds || []).filter(id => !recs[id]),
    status: { roundId: round.id, startsOn: round.startsOn, endsOn: round.endsOn, ratersTotal: raters.length, ratersDone: raters.length - outstanding.length, outstanding, lastAnswerAt, syncedAt: nowIso },
    links,
    // "From the field": anonymous notes about what would make the job better (rater shown only when Koy turns names on)
    feedback: { roundId: round.id, items: fb.map(f => ({ rater: nameOf(f.raterId), text: String(f.text).trim(), key: hash("fb|" + String(f.text).trim()) })).sort((x, y) => x.rater.localeCompare(y.rater)), syncedAt: nowIso },
  };
}

function run(input, mint = () => crypto.randomBytes(16).toString("hex")) {
  const h = handleRequests({ ...input, mint });
  const art = compute({ ...input, raters: h.raters, round: h.round });
  return { results: h.results, firestore: { writes: h.writes, deletes: h.deletes }, artifact: art };
}
module.exports = { run, handleRequests, compute, endOfDayDenver, slug, typed };

if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const out = run(input);
  fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
  // One file per artifact document, so the sync task passes file_path instead of retyping data.
  const dir = process.argv[3].replace(/\.json$/, "") + "-docs";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const put = (coll, id, data) => fs.writeFileSync(`${dir}/${coll}__${id}.json`, JSON.stringify(data));
  Object.entries(out.artifact.ratings).forEach(([pid, d]) => put("ratings", pid, d));
  put("ratings_meta", "status", out.artifact.status);
  put("ratings_meta", "links", out.artifact.links);
  put("ratings_meta", "feedback", out.artifact.feedback);
}
