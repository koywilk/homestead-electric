#!/usr/bin/env node
// scramble-suggest-test.js — the suggest door for Duet (functions/scrambleSuggest.js). Start to finish with stand-ins
// for Firestore and Simpro: what is refused, what is saved, how it shows on the calendar, and that nothing is booked.
"use strict";
const S = require("../functions/scrambleSuggest.js");
const R = require("../functions/scrambleRead.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

const users = [
  { id: "d", name: "Daegan Smith", title: "foreman", active: true },
  { id: "l", name: "Louis Hoffman", title: "jrforeman", foremanId: "d", active: true, pairId: "jl" },
  { id: "jl", name: "James Livingston", title: "crew", foremanId: "d", active: true, pairId: "l" },
  { id: "t", name: "Trever Worley", title: "lead", foremanId: "d", active: true },
  { id: "c", name: "Callen Jakeman", title: "crew", foremanId: "d", active: true },
  { id: "a", name: "Josh Cloward", title: "admin", active: true }];
const NOW = new Date(2026, 10, 23, 9);   // Monday 11/23/2026
const sched = (id, name, date, s, e, ref) => ({ Type: "job", Reference: ref, Date: date, Staff: { ID: id, Name: name }, Blocks: [{ StartTime: s, EndTime: e, Hrs: (parseInt(e, 10) - parseInt(s, 10)) }] });

function world(over) {
  const w = { schedules: [], pto: [], prefs: {}, sets: [], simpro: [], ...(over || {}) };
  w.jobs = [
    { id: "J1", data: { data: { id: "J1", simproNo: "900", name: "Suggest test", roughStatus: "complete", finishStatus: "inprogress", finishStage: "20", foreman: "Daegan Smith",
      returnTrips: [{ id: "r1", number: 1, scope: "x", rtStatus: "needs", needsByStart: "11/30/2026", material: "wire" }] } } },
    { id: "J2", data: { data: { id: "J2", simproNo: "901", name: "Other job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "20", foreman: "Daegan Smith" } } }];
  const docOf = (data) => ({ exists: data != null, data: () => data });
  w.deps = { now: NOW, tz: "America/Denver", getUsers: async () => users, del: () => "__DELETE__", id: () => "dpTEST",
    simproReq: async (method, path) => { w.simpro.push(method + " " + path); const m = /between\((\S+?),(\S+?)\)/.exec(path); return { ok: true, data: w.schedules.filter(s => s.Date >= m[1] && s.Date <= m[2]) }; },
    db: { collection: (n) => n === "jobs" ? { get: async () => ({ docs: w.jobs.map(d => ({ id: d.id, data: () => d.data })) }) }
      : n === "settings" ? { doc: (id) => ({ get: async () => docOf(id === "crewPTO" ? { list: w.pto } : id === "phaseHours" ? { jobs: { "900": { f: [20, 100] }, "901": { f: [20, 100] } } } : id === "upcoming_jobs" ? { items: [] } : {}) }) }
      : { doc: (id) => ({ get: async () => docOf(w.prefs), set: async (patch, opt) => { w.sets.push({ id, patch, opt });
          ["cal", "duet"].forEach(k => { if (patch[k]) { w.prefs[k] = { ...(w.prefs[k] || {}) }; Object.keys(patch[k]).forEach(x => { if (patch[k][x] === "__DELETE__") delete w.prefs[k][x]; else w.prefs[k][x] = patch[k][x]; }); } }); } }) } } };
  return w;
}
const E = (person, date, start, end) => ({ person, date, start, end });
const req = (entries, more) => ({ jobNo: "900", phase: "finish", entries, reason: "Finish is next and the GC said the tile is done.", ...(more || {}) });
const rules = (r) => (r.refused || []).map(x => x.rule + ":" + x.person.split(" ")[0]).sort().join();
const viewOf = async (w, from, to) => R.assemble({ ...(await R.gather(w.deps)), from, to });

(async () => {
  // ── a clean proposal ──
  let w = world();
  const two = [E("Trever", "2026-11-24", "07:00", "17:00"), E("Callen", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-25", "07:00", "12:00"), E("Callen", "2026-11-25", "07:00", "12:00")];
  let p = await S.propose(w.deps, req(two));
  ok(p.ok && p.saved && p.proposalId === "dpTEST" && p.key === "j_J1_f" && p.days.length === 2 && w.sets.length === 1 && w.sets[0].id === "scramble__prefs" && w.sets[0].opt.merge === true, "a clean proposal is saved once, on the plans doc, as a merge");
  ok(Object.keys(w.sets[0].patch).sort().join() === "duet,saved_by,updated_at" && !w.sets[0].patch.cal && w.prefs.duet["j_J1_f"].why.startsWith("Finish is next") && w.prefs.duet["j_J1_f"].hours === 30, "it is saved beside the plans (duet), never in them, with its reason and hours");
  ok(w.simpro.every(x => x.startsWith("GET ")), "proposing only ever reads Simpro");
  let v = await viewOf(w, "2026-11-23", "2026-11-27");
  const b24 = v.days.find(d => d.date === "2026-11-24").blocks.find(b => b.key === "j_J1_f"), b25 = v.days.find(d => d.date === "2026-11-25").blocks.find(b => b.key === "j_J1_f");
  ok(b24 && b24.kind === "duet-proposal" && b24.people.join() === "Trever Worley,Callen Jakeman" && b24.from === "07:00" && b24.to === "17:00" && b24.proposalId === "dpTEST" && /tile is done/.test(b24.reason), "the calendar shows it as a Duet block with its people, time and reason");
  ok(b25 && b25.to === "12:00" && !v.days.find(d => d.date === "2026-11-26").blocks.some(b => b.key === "j_J1_f") && !v.days.find(d => d.date === "2026-11-23").blocks.some(b => b.key === "j_J1_f"), "it covers exactly the days proposed, each with its own time");
  const other = v.days.find(d => d.date === "2026-11-24").blocks.find(b => b.key === "j_J2_f");
  ok(!other || !other.people.some(n => /Trever|Callen/.test(n)), "the auto-schedule lays its own guesses around the proposal (no one on both)");

  // gaps between days are not filled
  w = world(); p = await S.propose(w.deps, req([E("Trever", "2026-11-24", "07:00", "17:00"), E("Callen", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-12-01", "07:00", "17:00"), E("Callen", "2026-12-01", "07:00", "17:00")]));
  v = await viewOf(w, "2026-11-23", "2026-12-04");
  ok(p.ok && v.days.filter(d => d.blocks.some(b => b.key === "j_J1_f")).map(d => d.date).join() === "2026-11-24,2026-12-01", "days in between that weren't proposed stay empty");

  // ── a person's plan always wins ──
  w = world({ prefs: { cal: { "j_J1_f": { s: "2026-11-24", hours: 20, crew: 2, staff: [{ name: "Daegan Smith" }, { name: "Callen Jakeman" }], by: "Koy Wilkinson" } } } });
  let threw = ""; try { await S.propose(w.deps, req(two)); } catch (e) { threw = e.message; }
  ok(/never replaces a plan a person placed/.test(threw) && w.sets.length === 0, "a job a person already placed can't be proposed over");
  w = world({ prefs: { cal: { "j_J2_f": { s: "2026-11-24", hours: 20, crew: 2, staff: [{ name: "Trever Worley" }, { name: "Callen Jakeman" }], by: "Koy Wilkinson" } } } });
  p = await S.propose(w.deps, req(two));
  ok(!p.ok && !p.saved && w.sets.length === 0 && rules(p).includes("on-a-plan:Trever") && rules(p).includes("on-a-plan:Callen"), "people on a plan a person placed elsewhere at that time are refused");
  w = world({ prefs: { cal: { "j_J1_f": { off: true, why: "Waiting on material", by: "Koy Wilkinson" } } } });
  threw = ""; try { await S.propose(w.deps, req(two)); } catch (e) { threw = e.message; }
  ok(/taken off the calendar/.test(threw), "a job a person took off the calendar can't be proposed");
  // a plan placed later replaces the proposal on the screen
  w = world(); await S.propose(w.deps, req(two)); w.prefs.cal = { "j_J1_f": { s: "2026-11-26", hours: 20, crew: 2, staff: [{ name: "Daegan Smith" }, { name: "Trever Worley" }], by: "Koy Wilkinson" } };
  v = await viewOf(w, "2026-11-23", "2026-12-04");
  ok(!v.days.some(d => d.blocks.some(b => b.kind === "duet-proposal")), "once a person places the job, the proposal no longer shows");

  // ── the same rules as a booking ──
  w = world({ schedules: [sched(4, "Trever Worley", "2026-11-24", "12:00", "17:00", "777-1")] });
  ok(rules(await S.propose(w.deps, req(two))) === "in-simpro:Trever" && w.sets.length === 0, "someone Simpro already has then is refused");
  w = world({ pto: [{ name: "Callen Jakeman", start: "2026-11-24", end: "2026-11-24" }] });
  ok(rules(await S.propose(w.deps, req(two))) === "time-off:Callen", "someone off that day is refused");
  w = world();
  ok(rules(await S.propose(w.deps, req([E("Louis", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "pair:Louis", "half of a set pair is refused");
  ok(rules(await S.propose(w.deps, req([E("Callen", "2026-11-24", "07:00", "17:00")]))) === "alone:Callen" && rules(await S.propose(w.deps, req([E("Trever", "2026-11-24", "07:00", "17:00")]))) === "alone:Trever", "nobody is proposed alone");
  ok(rules(await S.propose(w.deps, req([E("Josh Cloward", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "crew-board:Josh", "an admin is never proposed");
  ok(rules(await S.propose(w.deps, req([E("Trever", "2026-11-27", "07:00", "17:00"), E("Callen", "2026-11-27", "07:00", "17:00")]))) === "friday:Callen,friday:Trever", "Fridays are placed by hand, not proposed");
  ok(rules(await S.propose(w.deps, req([E("Trever", "2026-11-26", "07:00", "17:00"), E("Callen", "2026-11-26", "07:00", "17:00")]))) === "holiday:Callen,holiday:Trever", "a company holiday is refused");
  for (const [bad, re] of [[req(two, { reason: "ok" }), /needs a reason/], [req([E("Trever", "2026-11-24", "07:00", "17:00"), E("Callen", "2026-11-24", "08:00", "17:00")]), /one start and finish/], [req(two, { jobNo: "555" }), /isn't on the calendar's list/]]) {
    threw = ""; try { await S.propose(world().deps, bad); } catch (e) { threw = e.message; }
    ok(re.test(threw), "refused outright: " + re.source);
  }
  w = world({ schedules: [sched(1, "Daegan Smith", "2026-11-24", "07:00", "17:00", "900-1"), sched(5, "Callen Jakeman", "2026-11-24", "07:00", "17:00", "900-1")] });
  ok(rules(await S.propose(w.deps, req([E("Trever", "2026-11-24", "07:00", "17:00"), E("Louis", "2026-11-24", "07:00", "17:00"), E("James Livingston", "2026-11-24", "07:00", "17:00")]))).includes("already-booked"), "a day Simpro already has this job booked isn't proposed over");

  // ── a return trip ──
  w = world();
  p = await S.propose(w.deps, { jobNo: "900", phase: "trip", jobId: "J1", tripId: "r1", entries: [E("Louis", "2026-11-24", "07:00", "11:00"), E("James Livingston", "2026-11-24", "07:00", "11:00")], reason: "Owusu asked for the warranty trip this week." });
  ok(p.ok && p.key === "t_J1_r1" && w.jobs[0].data.data.returnTrips[0].rtStatus === "needs", "a return trip can be proposed; the trip itself is not changed");

  // ── replace, withdraw ──
  w = world(); await S.propose(w.deps, req(two)); p = await S.propose(w.deps, req([E("Trever", "2026-11-30", "07:00", "17:00"), E("Callen", "2026-11-30", "07:00", "17:00")]));
  ok(p.ok && p.replacedEarlierProposal && w.prefs.duet["j_J1_f"].s === "2026-11-30", "a new proposal for the same job replaces Duet's earlier one");
  let wd = await S.withdraw(w.deps, { jobNo: "900", phase: "finish" });
  ok(wd.withdrawn && !w.prefs.duet["j_J1_f"] && (await S.withdraw(w.deps, { jobNo: "900", phase: "finish" })).noop, "Duet can take its own proposal back; twice is a no-op");

  // ── waiting on something ──
  w = world(); await S.propose(w.deps, req(two));
  let wt = await S.wait(w.deps, { jobNo: "900", phase: "finish", why: "Waiting on GC or homeowner", note: "GC texted 11/20: tile not done until the 2nd." });
  ok(wt.waiting && w.prefs.cal["j_J1_f"].off === true && w.prefs.cal["j_J1_f"].by === "Duet" && !w.prefs.duet["j_J1_f"] && w.jobs[0].data.data.finishStatus === "inprogress", "waiting takes it off the calendar with the reason; the job's status is untouched and Duet's proposal goes with it");
  v = await viewOf(w, "2026-11-23", "2026-12-04");
  ok(!v.days.some(d => d.blocks.some(b => b.key === "j_J1_f")), "a waiting job has no block on the calendar");
  ok((await S.wait(w.deps, { jobNo: "900", phase: "finish", why: "On hold", note: "still waiting on them" })).noop, "already off the calendar: a no-op");
  for (const [args, re] of [[{ jobNo: "900", phase: "finish", why: "Because", note: "long enough note" }, /why must be one of/], [{ jobNo: "900", phase: "finish", why: "On hold", note: "x" }, /Say what it is waiting on/]]) {
    threw = ""; try { await S.wait(world().deps, args); } catch (e) { threw = e.message; }
    ok(re.test(threw), "waiting refused: " + re.source);
  }
  w = world({ prefs: { cal: { "j_J1_f": { s: "2026-11-24", hours: 20, crew: 2, staff: [{ name: "Daegan Smith" }, { name: "Callen Jakeman" }], by: "Koy Wilkinson" } } } });
  threw = ""; try { await S.wait(w.deps, { jobNo: "900", phase: "finish", why: "On hold", note: "GC said hold off" }); } catch (e) { threw = e.message; }
  ok(/Only a person takes a placed block off/.test(threw) && w.sets.length === 0, "a block a person placed is never taken off by Duet");
  w = world({ schedules: [sched(1, "Daegan Smith", "2026-11-24", "07:00", "17:00", "900-1"), sched(5, "Callen Jakeman", "2026-11-24", "07:00", "17:00", "900-1")] });
  threw = ""; try { await S.wait(w.deps, { jobNo: "900", phase: "finish", why: "On hold", note: "GC said hold off" }); } catch (e) { threw = e.message; }
  ok(/Simpro has it booked ahead/.test(threw), "waiting never hides a job Simpro has booked ahead");

  // ── what people did with proposals comes back in the read ──
  w = world({ prefs: { duetDone: { dpA: { key: "j_J1_f", job: "#900 Suggest test", outcome: "kept", by: "Koy Wilkinson", at: "2026-11-23T16:00:00Z" }, dpB: { key: "j_J2_f", outcome: "removed", by: "Josh Cloward", at: "2026-11-23T17:00:00Z" } } } });
  v = await viewOf(w, "2026-11-23", "2026-11-27");
  ok(v.duetOutcomes.length === 2 && v.duetOutcomes[0].proposalId === "dpB" && v.duetOutcomes[0].outcome === "removed" && v.duetOutcomes[1].outcome === "kept", "kept / changed / removed is handed back to Duet, newest first");

  // ── never a booking, a job write, a stage or a status ──
  const src = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleSuggest.js"), "utf8").replace(/\/\/[^\n]*/g, "");
  ok(!/"POST"|"PATCH"|"DELETE"|collection\("jobs"\)\.doc|Status\s*:|Stage\s*:/.test(src) && (src.match(/\.set\(/g) || []).length === 3 && !/\.update\(|\)\.add\(|runTransaction|batch\(/.test(src), "the suggest door writes only the calendar's plans doc: no Simpro write, no job write, no stage or status");

  if (fails) { console.error(fails + " failed"); process.exit(1); }
  console.log("scramble-suggest-test: all passed");
})().catch(e => { console.error("FAIL the suggest test threw: " + (e && e.stack || e)); process.exit(1); });
