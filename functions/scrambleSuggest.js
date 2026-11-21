// scrambleSuggest.js — the suggest door for Duet (SW v670, Koy 2026-11-20; Builds 3 and 4 of Duet's crew-calendar spec).
//
// Duet proposes a block on the crew calendar: a job's rough-in or finish, or a return trip, with named people, days,
// clock times and a one-line reason. Nothing here books anything and nothing touches Simpro or a job.
//   propose  — checks the proposal against the same rules as a booking (scrambleDoor.js: Crew Board, time off,
//              holidays, weekends, set pairs, nobody alone, Simpro's bookings) and against every plan a person placed,
//              then saves it beside the saved plans (meetings/scramble__prefs.duet[key]), never on top of one.
//   withdraw — takes Duet's own proposal back.
//   wait     — marks a job or trip as waiting on something (the calendar's own "Remove… with a reason"), only when no
//              person has placed or removed it. The job's status is never touched.
// The calendar shows a proposal as its own kind of block, with the reason. A person keeps it (it becomes a plan),
// changes it, or removes it; the screen records which under duetDone[proposalId], and the calendar read hands that
// back to Duet. A proposal sits at the forecast level: a plan a person placed, taking the job off the calendar, a
// Simpro booking and time off all win.
"use strict";
const SC = require("./scrambleCal.js");
const SB = require("./scrambleBook.js");
const D = require("./scrambleDoor.js");
const R = require("./scrambleRead.js");

const MAX_PROPOSALS = 60;
const WAIT_WHY = ["Waiting on GC or homeowner", "Waiting on material", "Waiting on inspection", "On hold", "Other"];   // the screen's SCAL_WAIT
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
class Refused extends Error { constructor(message) { super(message); this.refused = true; } }

// The calendar item a request is about: a job's rough-in / finish (by Simpro number) or a return trip (by its id).
function findItem(V, a) {
  const no = String(a.jobNo || "");
  if (a.phase === "trip") return V.items.find(it => it.kind === "trip" && !it.copyOf && String(it.no) === no && String(it.tripId || "") === String(a.tripId || "")) || null;
  return V.items.find(it => it.kind === a.phase && !it.copyOf && String(it.no) === no) || null;
}

// The people-and-time rows as a calendar plan: every day has its own people and window; workdays in between that
// weren't asked for are skipped, so the block is exactly the days Duet named. Returns { plan } or { why }.
function planFromRows(rows) {
  const byDate = {}; rows.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  const dates = Object.keys(byDate).sort(), pdl = []; let hours = 0, crew = 1;
  for (const d of dates) {
    // v678 (Koy 2026-11-21: "why they can't be on the same block with different times"): each person keeps their own
    // start and finish. The day's t / e is the span; w holds everyone's own times when they differ.
    const l = byDate[d], dw = SC.dayWindows(l.map(r => ({ name: r.person, t: r.start, e: r.end })));
    hours += l.reduce((x, r) => x + r.hours, 0); crew = Math.max(crew, l.length);
    pdl.push({ d, n: l.map(r => r.person), t: dw.t, e: dw.e, ...(dw.pw ? { w: SC.wOf(dw.pw) } : {}) });
  }
  // the workdays between the first and last day that weren't named: nobody, and no hours spent
  for (let d = SC.workAfter(dates[0]), g = 0; d < dates[dates.length - 1] && g < 200; d = SC.workAfter(d), g++) if (!byDate[d]) pdl.push({ d, x: 1 });
  const everyone = [...new Set(rows.map(r => r.person))];
  return { plan: { s: dates[0], hours: Math.round(hours * 4) / 4, crew, staff: everyone.map(name => ({ name })), pdl: pdl.sort((a, b) => a.d < b.d ? -1 : 1) } };
}

// deps: { db, getUsers, simproReq, tz, now?, del (FieldValue.delete()), id?() }. args: { jobNo, phase, tripId?,
// entries: [{ person, date, start, end }], reason, splitPairs? }.
async function propose(deps, args) {
  const a = args || {}, inp = await R.gather(deps), today = SC.ymd(inp.now);
  const bad = D.checkRequest({ ...a, mode: "preview", jobId: a.phase === "trip" ? (a.jobId || "x") : undefined }, today);
  if (bad) throw new Refused(bad);
  const reason = String(a.reason || "").replace(/\s+/g, " ").trim();
  if (reason.length < 8) throw new Refused("A proposal needs a reason: one line on why these people, this job, this day.");
  if (reason.length > 200) throw new Refused("Keep the reason to one line (200 characters).");
  const V = R.calendarOf(inp, { proposals: false });   // judged against everything but Duet's own proposals
  const it = findItem(V, a);
  if (!it) throw new Refused(a.phase === "trip" ? "That return trip isn't open on the calendar's list." : `Job #${a.jobNo}'s ${a.phase === "rough" ? "rough-in" : "finish"} isn't on the calendar's list (it needs to be In Progress or have a start date, and be residential).`);
  if (it.plan) throw new Refused(`${it.plan.by || "Someone"} already placed this on the calendar. A proposal never replaces a plan a person placed.`);
  if (it.off) throw new Refused(`This was taken off the calendar${it.off.why ? ` (${it.off.why})` : ""}. Clear that on the calendar first.`);
  const board = SC.crewBoard(inp.users || []);
  // Simpro employees as the schedule names them; anyone with nothing in Simpro these weeks can't clash there
  const byName = {}; (inp.schedules || []).forEach(s => { const n = s && s.Staff && s.Staff.Name, id = s && s.Staff && s.Staff.ID; if (n && id) byName[String(n).toLowerCase()] = { id: Number(id), name: String(n) }; });
  const staffAll = Object.values(byName); let fake = -1;
  (inp.users || []).forEach(u => { if (u && u.name && !staffAll.some(s => { const x = board.find(s.name); return x && x.id === u.id; })) staffAll.push({ id: fake--, name: u.name }); });
  const who = D.resolvePeople(a.entries, board, staffAll);
  const rows = who.rows, refusals = [...who.refusals];
  rows.forEach(r => { if (SC.dowOf(r.date) === 4) refusals.push({ person: r.person, date: r.date, rule: "friday", why: `${r.date} is a Friday. Fridays are placed by hand, not proposed.` }); });
  const prefs = inp.prefs || {};
  const g = D.guard({ rows, board, isOff: D.offDays(inp.pto, board), holidays: D.holidayMap(prefs.holidays), schedules: inp.schedules, staffAll, jobNo: String(a.jobNo), aloneOk: false, splitPairs: !!a.splitPairs, unplaced: who.refusals.map(x => x.date) });
  refusals.push(...g.refusals.filter(x => !(x.rule === "weekend" && false)));
  SB.overlaps(inp.schedules, D.entriesFor(rows, {})).forEach(c => { const r = rows.find(x => x.staffId === c.staffId && x.date === c.date);
    refusals.push({ person: r ? r.person : c.name, date: c.date, rule: "in-simpro", why: `${first(r ? r.person : c.name)} is already booked in Simpro ${c.date} ${c.at}${c.ref ? " on job " + c.ref.split("-")[0] : ""}.` }); });
  // a plan a person placed for that person at that time
  const chips = SC.chipsOf(V, board), busy = SC.busyOf(chips, board, V);
  rows.forEach(r => (((busy[r.person] || {})[r.date]) || []).forEach(b => { if (b.soft || b.booked || b.key === it.key) return;
    if (r.from / 60 < b.to - 1e-6 && b.from < r.to / 60 - 1e-6) refusals.push({ person: r.person, date: r.date, rule: "on-a-plan", why: `${first(r.person)} is on a plan a person placed then (${b.label}).` }); }));
  // Simpro already has this job or trip on one of those days: its booking is the block
  rows.forEach(r => { if (it.booked.some(b => b.iso === r.date)) refusals.push({ person: r.person, date: r.date, rule: "already-booked", why: `Simpro already has this ${it.kind === "trip" ? "trip" : "job"} booked ${r.date}. Propose other days, or book into it.` }); });
  const seen = new Set(), list = refusals.filter(x => { const k = x.person + "|" + x.date + "|" + x.rule; if (seen.has(k)) return false; seen.add(k); return true; });
  const made = list.length ? null : planFromRows(rows);
  if (made && made.why) throw new Refused(made.why);
  const what = { key: it.key, jobNo: String(it.no || ""), job: String(it.name || ""), what: String(it.tag || "") };
  if (list.length) return { ok: false, saved: false, ...what, refused: list, notes: g.notes, message: "Nothing was saved. Fix what is refused and propose again." };
  const cur = prefs.duet || {};
  if (!cur[it.key] && Object.keys(cur).length >= MAX_PROPOSALS) throw new Refused(`There are already ${MAX_PROPOSALS} proposals on the calendar. Withdraw some first.`);
  const id = (deps.id ? deps.id() : "dp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const doc = { id, ...made.plan, why: reason, by: "Duet", at: new Date().toISOString() };
  await deps.db.collection("meetings").doc("scramble__prefs").set({ duet: { [it.key]: doc }, updated_at: doc.at, saved_by: "Duet (proposal)" }, { merge: true });
  return { ok: true, saved: true, proposalId: id, ...what, replacedEarlierProposal: !!cur[it.key], days: made.plan.pdl.filter(x => !x.x).map(x => ({ date: x.d, people: x.n, from: x.t, to: x.e })), reason, notes: g.notes,
    message: "Saved as a proposal on the crew calendar. It books nothing. A person keeps, changes or removes it there." };
}

async function withdraw(deps, args) {
  const a = args || {}, inp = await R.gather(deps), V = R.calendarOf(inp), it = findItem(V, a);
  const cur = (inp.prefs && inp.prefs.duet) || {};
  const key = it ? it.key : Object.keys(cur).find(k => cur[k] && cur[k].id && cur[k].id === String(a.proposalId || ""));
  if (!key || !cur[key]) return { ok: true, noop: true, message: "There is no proposal from Duet on that job or trip." };
  await deps.db.collection("meetings").doc("scramble__prefs").set({ duet: { [key]: deps.del() }, updated_at: new Date().toISOString(), saved_by: "Duet (proposal)" }, { merge: true });
  return { ok: true, withdrawn: true, key, proposalId: cur[key].id || "" };
}

// Waiting on something: the calendar's own Remove-with-a-reason. Only when nobody has placed or removed it.
async function wait(deps, args) {
  const a = args || {}, why = String(a.why || ""), note = String(a.note || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!WAIT_WHY.includes(why)) throw new Refused(`why must be one of: ${WAIT_WHY.join("; ")}.`);
  if (note.length < 5) throw new Refused("Say what it is waiting on and who said so, in a line.");
  const inp = await R.gather(deps), V = R.calendarOf(inp), it = findItem(V, a);
  if (!it) throw new Refused("That job's phase or trip isn't on the calendar's list.");
  if (it.plan) throw new Refused(`${it.plan.by || "Someone"} placed this on the calendar. Only a person takes a placed block off.`);
  if (it.off) return { ok: true, noop: true, message: `It is already off the calendar${it.off.why ? ` (${it.off.why})` : ""}.` };
  if (it.booked.some(b => b.iso >= SC.ymd(inp.now))) throw new Refused("Simpro has it booked ahead. Waiting doesn't unbook anything; change the booking in Simpro if it really can't go.");
  const at = new Date().toISOString();
  await deps.db.collection("meetings").doc("scramble__prefs").set({ cal: { [it.key]: { off: true, why, note, by: "Duet", at } }, duet: { [it.key]: deps.del() }, updated_at: at, saved_by: "Duet (waiting)" }, { merge: true });
  return { ok: true, waiting: true, key: it.key, jobNo: String(it.no || ""), job: String(it.name || ""), what: String(it.tag || ""), why, note,
    message: "It is under Waiting on the crew calendar and the auto-schedule leaves it alone. The job's status was not changed. A person ticks Wait cleared to put it back." };
}

// v674 (Koy 2026-11-20: "why can't it make its own editing calendar?" → "yes build it"): Duet changes a block on the
// calendar itself, including one a person placed, but only after Koy's yes. Two steps like a booking: a preview that
// shows what the block is now, what it would become and what changes, then the same request with the preview's hash.
// The same people rules as a booking apply. It is saved as a plan ("Duet (Koy's yes)"), so the auto-schedule leaves it
// alone, and it goes in the edit log like any hand edit. backToAuto: true hands the block back to the auto-schedule.
// It books nothing and touches no job. deps adds fp(...segs) (a Firestore field path, so one block is replaced whole).
const hashOf = (x) => { const t = JSON.stringify(x); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36) + "." + t.length.toString(36); };
async function edit(deps, args) {
  const a = args || {}, apply = a.mode === "apply", inp = await R.gather(deps), today = SC.ymd(inp.now), prefs = inp.prefs || {};
  const reason = String(a.reason || "").replace(/\s+/g, " ").trim();
  if (reason.length < 8) throw new Refused("Say why in a line: what Koy asked for.");
  const V = R.calendarOf(inp), it = findItem(V, a);
  if (!it) throw new Refused(a.phase === "trip" ? "That return trip isn't open on the calendar's list." : `Job #${a.jobNo}'s ${a.phase === "rough" ? "rough-in" : "finish"} isn't on the calendar's list.`);
  if (it.off && !a.backToAuto) throw new Refused(`This was taken off the calendar${it.off.why ? ` (${it.off.why})` : ""}. A person clears that on the calendar first.`);
  const f0 = it.plan || it.auto || null, was = SC.planSummary(f0), src = it.plan ? "plan" : f0 ? (f0.src === "duet" ? "duet" : "auto") : "list";
  const cur = (prefs.cal || {})[it.key] || null, what = { key: it.key, jobNo: String(it.no || ""), job: String(it.name || ""), what: String(it.tag || ""), ...(it.plan && it.plan.by ? { placedBy: it.plan.by } : {}) };
  let plan = null, notes = [], list = [];
  if (a.backToAuto) { if (!cur) return { ok: true, noop: true, ...what, message: "Nobody has placed that block; it is already the auto-schedule's." }; }
  else {
    const bad = D.checkRequest({ ...a, mode: "preview", jobId: a.phase === "trip" ? (a.jobId || "x") : undefined }, today);
    if (bad) throw new Refused(bad);
    const board = SC.crewBoard(inp.users || []);
    const byName = {}; (inp.schedules || []).forEach(x => { const n = x && x.Staff && x.Staff.Name, id = x && x.Staff && x.Staff.ID; if (n && id) byName[String(n).toLowerCase()] = { id: Number(id), name: String(n) }; });
    const staffAll = Object.values(byName); let fake = -1;
    (inp.users || []).forEach(u => { if (u && u.name && !staffAll.some(x => { const y = board.find(x.name); return y && y.id === u.id; })) staffAll.push({ id: fake--, name: u.name }); });
    const who = D.resolvePeople(a.entries, board, staffAll), rows = who.rows; list = [...who.refusals];
    const g = D.guard({ rows, board, isOff: D.offDays(inp.pto, board), holidays: D.holidayMap(prefs.holidays), schedules: inp.schedules, staffAll, jobNo: String(a.jobNo), aloneOk: !!a.aloneOk, splitPairs: !!a.splitPairs, unplaced: who.refusals.map(x => x.date) });
    list.push(...g.refusals); notes = g.notes;
    rows.forEach(r => { if ((V.offByDay[r.date] || []).includes(r.person) && !list.some(x => x.person === r.person && x.date === r.date)) list.push({ person: r.person, date: r.date, rule: "time-off", why: `${first(r.person)} is off ${r.date} (leave in Simpro).` }); });
    SB.overlaps(inp.schedules, D.entriesFor(rows, {})).forEach(c => { const r = rows.find(x => x.staffId === c.staffId && x.date === c.date);
      list.push({ person: r ? r.person : c.name, date: c.date, rule: "in-simpro", why: `${first(r ? r.person : c.name)} is already booked in Simpro ${c.date} ${c.at}${c.ref ? " on job " + c.ref.split("-")[0] : ""}.` }); });
    const chips = SC.chipsOf(V, board), busy = SC.busyOf(chips, board, V);
    rows.forEach(r => (((busy[r.person] || {})[r.date]) || []).forEach(b => { if (b.soft || b.booked || b.key === it.key) return;
      if (r.from / 60 < b.to - 1e-6 && b.from < r.to / 60 - 1e-6) list.push({ person: r.person, date: r.date, rule: "on-a-plan", why: `${first(r.person)} is on another placed block then (${b.label}). Change that block first.` }); }));
    rows.forEach(r => { if (it.booked.some(b => b.iso === r.date)) list.push({ person: r.person, date: r.date, rule: "already-booked", why: `Simpro already has this ${it.kind === "trip" ? "trip" : "job"} booked ${r.date}; the booking is the block that day.` }); });
    const seen = new Set(); list = list.filter(x => { const k = x.person + "|" + x.date + "|" + x.rule; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!list.length) { const made = planFromRows(rows); if (made.why) throw new Refused(made.why); plan = made.plan; }
  }
  const now = a.backToAuto ? { backToAuto: true } : plan ? SC.planSummary({ ...plan, pd: SC.pdOf(plan.pdl) }) : null;
  const hash = hashOf([it.key, plan, !!a.backToAuto, (cur && cur.at) || ""]);
  const base = { ...what, isNow: was || "not on the calendar", cameFrom: src === "plan" ? "a plan a person placed" : src === "duet" ? "Duet's suggestion" : src === "auto" ? "the auto-schedule's guess" : "the list (not placed)" };
  if (list.length) return { ok: false, mode: "preview", canApply: false, ...base, refused: list, notes, message: "Nothing was changed. Fix what is refused and preview again." };
  if (!apply) return { ok: true, mode: "preview", canApply: true, ...base, wouldBecome: now, whatChanges: SC.planDiff(was, now), notes, hash, message: "Nothing is changed yet. Show Koy this. To make exactly this change, send the same request with mode apply and this hash." };
  if (String(a.hash || "") !== hash) throw new Refused("The calendar changed since that preview, or the request isn't the same one. Nothing was changed. Preview again.");
  const at = new Date().toISOString(), by = "Duet (Koy's yes)", ref = deps.db.collection("meetings").doc("scramble__prefs");
  const logId = (String(it.key).replace(/[^A-Za-z0-9_-]/g, "_") + "_" + today.replace(/-/g, "")).slice(0, 90), prevLog = (prefs.calLog || {})[logId] || null;
  const entry = { key: it.key, job: `${it.no ? "#" + it.no + " " : ""}${it.name || ""}`.trim(), what: String(it.tag || ""), src: prevLog ? prevLog.src : src, by, at, reason: reason.slice(0, 200),
    ...((prevLog ? prevLog.was : was) ? { was: prevLog ? prevLog.was : was } : {}), now, changed: SC.planDiff(prevLog ? prevLog.was : was, now).slice(0, 6) };
  await ref.update(deps.fp("cal", it.key), plan ? { ...plan, by, at } : deps.del(), deps.fp("duet", it.key), deps.del(), deps.fp("calLog", logId), entry, "updated_at", at, "saved_by", by);
  return { ok: true, mode: "apply", changed: true, ...base, isNow: now, whatChanged: entry.changed, notes,
    message: a.backToAuto ? "Handed back to the auto-schedule." : "Changed on the crew calendar as a plan. Nothing was booked; book it from the calendar or with cc_book_schedule when it's right." };
}

// A rule Duet proposes about how Koy schedules, from what it saw in duetOutcomes and handEdits. It is saved as
// "proposed" and does nothing until a person approves it on the calendar; only approved rules are handed back as rules.
// deps: { db, id?() }. args: { rule, evidence }.
const MAX_LESSONS = 60;
async function lesson(deps, args) {
  const a = args || {}, text = String(a.rule || "").replace(/\s+/g, " ").trim(), evidence = String(a.evidence || "").replace(/\s+/g, " ").trim();
  if (text.length < 12) throw new Refused("Write the rule as one full line, e.g. \"Keep Louis and James together on finishes\".");
  if (text.length > 240) throw new Refused("Keep the rule to one line (240 characters).");
  if (evidence.length < 12) throw new Refused("Say what you saw that makes you think so (which changes, how many times).");
  const ref = deps.db.collection("meetings").doc("scramble__prefs"), snap = await ref.get(), cur = (snap.exists && (snap.data() || {}).lessons) || {};
  const same = Object.keys(cur).find(k => String((cur[k] || {}).text || "").toLowerCase() === text.toLowerCase());
  if (same) return { ok: true, noop: true, id: same, status: cur[same].status || "proposed", message: cur[same].status === "approved" ? "That rule is already approved." : "That rule is already waiting on a person." };
  if (Object.keys(cur).length >= MAX_LESSONS) throw new Refused(`There are already ${MAX_LESSONS} rules. Ask Koy to clear some first.`);
  const id = deps.id ? deps.id() : "ls" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at = new Date().toISOString();
  await ref.set({ lessons: { [id]: { text, evidence: evidence.slice(0, 300), from: "Duet", at, status: "proposed" } }, updated_at: at, saved_by: "Duet (rule)" }, { merge: true });
  return { ok: true, saved: true, id, status: "proposed", rule: text, message: "Saved as a proposed rule. It does nothing until a person approves it on the crew calendar, under How you schedule." };
}

module.exports = { MAX_PROPOSALS, MAX_LESSONS, WAIT_WHY, findItem, planFromRows, propose, withdraw, wait, lesson, edit, Refused };
