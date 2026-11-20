#!/usr/bin/env node
// scramble-door-test.js — the booking door for Duet (functions/scrambleDoor.js). Start to finish, with
// stand-ins for Simpro and Firestore: every rule that refuses, the 40-hour line, the hash, and what gets written.
"use strict";
const D = require("../functions/scrambleDoor.js");
const SB = require("../functions/scrambleBook.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

const users = [
  { id: "d", name: "Daegan Smith", title: "foreman", active: true },
  { id: "l", name: "Louis Hoffman", title: "jrforeman", foremanId: "d", active: true, pairId: "jl" },
  { id: "jl", name: "James Livingston", title: "crew", foremanId: "d", active: true, pairId: "l" },
  { id: "t", name: "Trever Worley", title: "lead", foremanId: "d", active: true },
  { id: "c", name: "Callen Jakeman", title: "crew", foremanId: "d", active: true },
  { id: "jo", name: "Joel Fey", title: "lead", active: true },                  // unassigned
  { id: "a", name: "Josh Cloward", title: "admin", active: true }];
const staff = [{ id: 1, name: "Daegan Smith" }, { id: 2, name: "Louis Hoffman" }, { id: 3, name: "James Livingston" }, { id: 4, name: "Trever Worley" }, { id: 5, name: "Callen Jakeman" }, { id: 6, name: "Joel Fey" }, { id: 7, name: "Josh Cloward" }];
const TODAY = "2026-11-23";   // a Monday
const sched = (id, date, s, e, ref, type) => ({ Type: type || "job", Reference: ref || "500-1", Date: date, Staff: { ID: id, Name: staff.find(x => x.id === id).name }, Blocks: [{ StartTime: s, EndTime: e, Hrs: (parseInt(e, 10) * 60 + +e.slice(3) - parseInt(s, 10) * 60 - +s.slice(3)) / 60 }] });

function world(over) {
  const w = { schedules: [], pto: [], posts: [], tripWrites: [], logs: [], job: { simproNo: "900", roughStatus: "complete", returnTrips: [{ id: "r1", number: 1, scope: "x", rtStatus: "needs", material: "" }, { id: "r2", number: 2, rtStatus: "complete" }, { id: "r3", number: 3, rtStatus: "needs", fromFailedRough: true, material: "wire" }] }, ...(over || {}) };
  const docOf = (data) => ({ get: async () => ({ exists: data != null, data: () => data }) });
  w.deps = {
    today: TODAY, getUsers: async () => users, staff: async () => staff, log: (m) => w.logs.push(m),
    db: { collection: (n) => n === "jobs" ? { doc: (id) => docOf(id === "J1" ? { data: w.job } : null) } : n === "settings" ? { doc: () => docOf({ list: w.pto }) } : n === "meetings" ? { doc: () => docOf({}) } : { add: async (x) => { w.logs.push(x); } } },
    tripWrite: async (jobId, no, plan, who) => { const p = plan(w.job.returnTrips); w.tripWrites.push({ jobId, no, who, p }); if (!p) return { ok: true, noop: true }; w.job.returnTrips = p.returnTrips; return { ok: true, rtStatus: p.after.rtStatus, rtStatusDate: p.after.rtStatusDate }; },
    simproReq: async (method, path, body) => {
      if (method === "POST") { w.posts.push({ path, body }); if (w.failAt && w.posts.length === w.failAt) return { ok: false, status: 422, data: "nope" }; return { ok: true, data: { ID: 7000 + w.posts.length } }; }
      if (/^\/jobs\/900\?/.test(path)) return { ok: true, data: { ID: 900, Name: "Door test", Stage: "Progress" } };
      if (/^\/jobs\/\d+\?/.test(path)) return { ok: false, status: 404 };
      if (/\/sections\/\?/.test(path)) return { ok: true, data: [{ ID: 11, Name: "Base", DisplayOrder: 1 }, { ID: 12, Name: "CO 3 - Added cans", DisplayOrder: 2 }] };
      if (/\/sections\/11\/costCenters\//.test(path)) return { ok: true, data: [{ ID: 101, Name: "Rough In" }, { ID: 102, Name: "Finish" }] };
      if (/\/sections\/12\/costCenters\//.test(path)) return { ok: true, data: [{ ID: 201, Name: "CO 3 Labor" }] };
      if (/^\/schedules\//.test(path)) { if (w.noSched) return { ok: false, status: 500 }; const m = /between\((\S+?),(\S+?)\)/.exec(path); return { ok: true, data: w.schedules.filter(s => s.Date >= m[1] && s.Date <= m[2]) }; }
      return { ok: false, status: 404 };
    } };
  return w;
}
const E = (person, date, start, end) => ({ person, date, start, end });
const base = (entries, more) => ({ mode: "preview", jobNo: "900", phase: "finish", entries, ...(more || {}) });
const rules = (r) => (r.refused || []).map(x => x.rule + ":" + x.person.split(" ")[0]).sort().join();

(async () => {
  // ── the request itself ──
  ok(D.checkRequest(base([E("Daegan", "2026-11-22", "07:00", "17:00")]), TODAY) !== "" && D.checkRequest(base([E("Daegan", "2026-11-24", "07:10", "17:00")]), TODAY) !== "" && D.checkRequest(base([E("Daegan", "2026-11-24", "07:00", "20:00")]), TODAY) !== "", "a past day, an odd time or a 13-hour day is refused before anything is read");
  ok(D.checkRequest(base([E("Daegan", "2026-11-24", "07:00", "17:00"), E("daegan", "2026-11-24", "12:00", "17:00")]), TODAY) !== "" && D.checkRequest({ ...base([E("Daegan", "2026-11-24", "07:00", "17:00")]), mode: "book" }, TODAY) !== "", "the same person twice on a day, or a book with no preview hash, is refused");
  ok(D.checkRequest({ ...base([E("Louis", "2026-11-24", "07:00", "11:00")]), phase: "trip" }, TODAY) !== "", "a trip needs the job id and the trip id");

  // ── a clean pair, preview then book ──
  let w = world();
  const pair = [E("Louis", "2026-11-24", "07:00", "17:00"), E("James Livingston", "2026-11-24", "07:00", "17:00")];
  let p = await D.run(w.deps, base(pair));
  ok(p.ok && p.canBook && p.hash && p.entries.length === 2 && p.costCenter.name === "Finish" && w.posts.length === 0, "a clean pair previews: two entries on Finish, a hash, and nothing written");
  ok(p.entries[0].person === "Louis Hoffman" && /7:00 AM–5:00 PM Normal Time/.test(p.entries[0].time), "the preview names the Crew Board person and the clock time and rate");
  let b = await D.run(w.deps, { ...base(pair), mode: "book", hash: p.hash });
  ok(b.ok && b.created.length === 2 && w.posts.length === 2 && w.posts[0].path === "/jobs/900/sections/11/costCenters/102/schedules/" && w.posts[0].body.Staff === 2 && w.posts[0].body.Blocks[0].StartTime === "07:00" && Object.keys(w.posts[0].body).sort().join() === "Blocks,Date,Staff", "book writes exactly those two entries, schedule fields only");
  let threw = ""; try { await D.run(world().deps, { ...base(pair), mode: "book", hash: "abc.def" }); } catch (e) { threw = e.message; }
  ok(/changed since that preview/.test(threw), "a book whose hash doesn't match the fresh build writes nothing");
  w = world(); p = await D.run(w.deps, base(pair)); w.schedules.push(sched(1, "2026-11-24", "07:00", "17:00"));   // someone else booked meanwhile, same week
  ok((await D.run(w.deps, { ...base(pair), mode: "book", hash: p.hash })).ok && w.posts.length === 2, "another person's booking doesn't change these entries, so the hash still holds");
  w = world(); p = await D.run(w.deps, base(pair)); ["2026-11-23", "2026-11-25", "2026-11-26", "2026-11-27"].forEach(d => w.schedules.push(sched(2, d, "07:00", "16:00", "501-1")));   // Louis picked up 36 h elsewhere this week: part of this day is now overtime
  threw = ""; try { await D.run(w.deps, { ...base(pair), mode: "book", hash: p.hash }); } catch (e) { threw = e.message; }
  ok(w.posts.length === 0 && /changed since that preview/.test(threw), "if Simpro changed so the entries would differ (here: overtime), the old preview can't be booked");

  // ── refusals ──
  w = world({ schedules: [sched(2, "2026-11-24", "12:00", "17:00", "777-1")] });
  p = await D.run(w.deps, base([E("Louis", "2026-11-24", "10:00", "15:00"), E("James Livingston", "2026-11-24", "10:00", "15:00")]));
  ok(!p.ok && !p.canBook && !p.hash && rules(p) === "double-booked:Louis" && /job 777/.test(p.refused[0].why), "booking someone already in Simpro 12-5 for 10-3 is refused, naming the job they're on");
  w = world({ schedules: [sched(2, "2026-11-24", "12:00", "17:00", "", "activity")] });
  ok(rules(await D.run(w.deps, base([E("Louis", "2026-11-24", "10:00", "15:00"), E("James Livingston", "2026-11-24", "10:00", "15:00")]))) === "double-booked:Louis", "an activity or time off in Simpro blocks too");
  b = await D.run(w.deps, { ...base([E("Louis", "2026-11-24", "10:00", "15:00"), E("James Livingston", "2026-11-24", "10:00", "15:00")]), mode: "book", hash: "a.b" });
  ok(!b.ok && b.mode === "preview" && w.posts.length === 0, "a book request with anything refused comes back as a refused preview, nothing written");
  w = world({ pto: [{ name: "Callen Jakeman", start: "2026-11-24", end: "2026-11-25" }] });
  ok(rules(await D.run(w.deps, base([E("Callen", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "time-off:Callen", "someone with approved time off that day is refused");
  w = world();
  ok(rules(await D.run(w.deps, base([E("Trever", "2026-11-26", "07:00", "17:00"), E("Callen", "2026-11-26", "07:00", "17:00")]))) === "holiday:Callen,holiday:Trever", "a company holiday (Thanksgiving) is refused");
  ok(rules(await D.run(w.deps, base([E("Trever", "2026-11-28", "07:00", "17:00"), E("Callen", "2026-11-28", "07:00", "17:00")]))) === "weekend:Callen,weekend:Trever", "a Saturday is refused");
  p = await D.run(w.deps, base([E("Trever", "2026-11-27", "07:00", "17:00"), E("Callen", "2026-11-27", "07:00", "17:00")]));
  ok(p.ok && p.notes.some(n => /Friday/.test(n)), "a Friday is allowed (by hand) and noted");
  ok(rules(await D.run(w.deps, base([E("Joel Fey", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "crew-board:Joel" && rules(await D.run(w.deps, base([E("Josh Cloward", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "crew-board:Josh", "someone unassigned, or an admin, is never booked");
  ok(rules(await D.run(w.deps, base([E("Nobody Atall", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "crew-board:Nobody", "a name that isn't on the Crew Board is refused");
  // pairs
  ok(rules(await D.run(w.deps, base([E("Louis", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]))) === "pair:Louis", "half of a set pair is refused when the other half is free");
  p = await D.run(w.deps, base([E("Louis", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")], { splitPairs: true }));
  ok(p.ok && p.notes.some(n => /Koy said to split/.test(n)), "Koy can say to split a pair, and the preview says so");
  w = world({ pto: [{ name: "James Livingston", start: "2026-11-24", end: "2026-11-24" }] });
  p = await D.run(w.deps, base([E("Louis", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]));
  ok(p.ok && p.notes.some(n => /set pair James is off/.test(n)), "someone whose pair is off goes without them, noted");
  w = world({ schedules: [sched(3, "2026-11-24", "07:00", "17:00", "777-1")] });
  p = await D.run(w.deps, base([E("Louis", "2026-11-24", "07:00", "17:00"), E("Trever", "2026-11-24", "07:00", "17:00")]));
  ok(p.ok && p.notes.some(n => /already booked in Simpro/.test(n)), "someone whose pair is booked in Simpro then goes without them, noted");
  // alone
  w = world();
  ok(rules(await D.run(w.deps, base([E("Callen", "2026-11-24", "07:00", "17:00")]))) === "alone:Callen" && rules(await D.run(w.deps, base([E("Callen", "2026-11-24", "07:00", "17:00")], { aloneOk: true }))) === "alone:Callen", "a crew member never goes alone, even when asked");
  ok(rules(await D.run(w.deps, base([E("Trever", "2026-11-24", "07:00", "17:00")]))) === "alone:Trever", "a lead alone is refused by default");
  p = await D.run(w.deps, base([E("Trever", "2026-11-24", "07:00", "17:00")], { aloneOk: true }));
  ok(p.ok && p.notes.some(n => /goes alone/.test(n)), "a lead can go alone when Koy says so, noted");
  w = world({ schedules: [sched(1, "2026-11-24", "07:00", "17:00", "900-1")] });
  ok((await D.run(w.deps, base([E("Callen", "2026-11-24", "07:00", "12:00")]))).ok, "joining someone Simpro already has on this job that day isn't alone");
  ok(rules(await D.run(world().deps, base([E("Callen", "2026-11-24", "07:00", "11:00"), E("Trever", "2026-11-24", "13:00", "17:00")]))) === "alone:Callen,alone:Trever", "two people at different times of the day are each alone");
  // v674: a leader whose set pair is off may go alone; a crew member or apprentice never
  w = world({ pto: [{ name: "James Livingston", start: "2026-11-24", end: "2026-11-24" }] });
  p = await D.run(w.deps, base([E("Louis", "2026-11-24", "07:00", "17:00")]));
  ok(p.ok && p.notes.some(n => /Louis goes alone 2026-11-24: their set pair James is off/.test(n)), "a junior foreman whose pair is off goes alone without asking, and the preview says why");
  w = world({ pto: [{ name: "Louis Hoffman", start: "2026-11-24", end: "2026-11-24" }] });
  ok(rules(await D.run(w.deps, base([E("James Livingston", "2026-11-24", "07:00", "17:00")], { aloneOk: true }))) === "alone:James", "a crew member whose pair is off still never goes alone");
  {
    const SCx = require("../functions/scrambleCal.js"), us = users.map(u => u.id === "c" ? { ...u, title: "apprentice" } : u), bd = SCx.crewBoard(us);
    const g2 = D.guard({ rows: [{ person: "Callen Jakeman", staffId: 5, title: (bd.crewOf("Callen Jakeman").title || {})["Callen Jakeman"], date: "2026-11-24", from: 420, to: 1020 }], board: bd, isOff: () => false, holidays: {}, schedules: [], staffAll: staff, jobNo: "900", aloneOk: true, splitPairs: false });
    ok(g2.refusals.length === 1 && g2.refusals[0].rule === "alone", "an apprentice (any title that isn't foreman, jr foreman or lead) never goes alone, even when asked");
  }

  // ── the 40-hour line ──
  w = world({ schedules: [sched(4, "2026-11-23", "07:00", "17:00"), sched(5, "2026-11-23", "07:00", "17:00"), sched(4, "2026-11-23", "17:00", "19:00", "", "activity")] });
  const week = ["2026-11-24", "2026-11-25", "2026-11-27"].flatMap(d => [E("Trever", d, "07:00", "17:00"), E("Callen", d, "07:00", "17:00")]);
  p = await D.run(w.deps, base(week.concat([E("Trever", "2026-11-30", "07:00", "11:00"), E("Callen", "2026-11-30", "07:00", "11:00")])));
  const fri = p.entries.find(e => e.person === "Trever Worley" && e.date === "2026-11-27"), wed = p.entries.find(e => e.person === "Trever Worley" && e.date === "2026-11-25"), mon = p.entries.find(e => e.person === "Trever Worley" && e.date === "2026-11-30");
  ok(p.ok && wed.overtimeHours === 0 && fri.overtimeHours === 0 && fri.weekHoursBefore === 30 && mon.overtimeHours === 0 && mon.weekHoursBefore === 0, "10 already in Simpro plus 30 is exactly 40: no overtime, the activity doesn't count, and the next week starts at zero");
  w.schedules.push(sched(4, "2026-11-26", "07:00", "11:00", "501-1"));
  p = await D.run(w.deps, base(week));
  const fri2 = p.entries.find(e => e.person === "Trever Worley" && e.date === "2026-11-27");
  ok(fri2.overtimeHours === 4 && /7:00 AM–1:00 PM Normal Time, 1:00 PM–5:00 PM Overtime 1.5x/.test(fri2.time) && p.totals.overtimeHours === 4, "a week that would hit 44 h gives a normal block to 40 and the last 4 h at 1.5x");
  b = await D.run(w.deps, { ...base(week), mode: "book", hash: p.hash });
  const friPost = w.posts.find(x => x.body.Staff === 4 && x.body.Date === "2026-11-27");
  ok(b.ok && w.posts.length === 6 && friPost.body.Blocks.length === 2 && friPost.body.Blocks[0].ScheduleRate === SB.RATE_NORMAL.id && friPost.body.Blocks[1].ScheduleRate === SB.RATE_OT.id, "a whole crew for a week is one preview and one confirm, with the overtime block at the 1.5x rate");

  // ── cost centers ──
  p = await D.run(world().deps, { ...base(pair), phase: "rough" });
  ok(p.costCenter.name === "Rough In", "rough-in work books to Rough In");
  p = await D.run(world().deps, base(pair, { costCenter: { sectionId: 12, id: 201 } }));
  ok(p.ok && p.costCenter.name === "CO 3 Labor" && p.costCenter.sectionName === "CO 3 - Added cans", "a change order's own cost center can be named, and the preview shows its name");
  threw = ""; try { await D.run(world().deps, base(pair, { costCenter: { sectionId: 12, id: 999 } })); } catch (e) { threw = e.message; }
  ok(/no cost center 999/.test(threw), "a cost center that isn't on that job is refused");
  threw = ""; try { await D.run(world().deps, { ...base(pair), jobNo: "12345" }); } catch (e) { threw = e.message; }
  ok(/no job #12345/.test(threw), "a job number Simpro doesn't have is refused");

  // ── warranty and invoiced cost centers (v674) ──
  {
    const CL = (pct) => ({ Claimed: { ToDate: { Percent: pct } } });
    const secs = (finPct, warr) => [{ ID: 11, Name: "Base", DisplayOrder: 1, ccs: [{ ID: 101, Name: "Rough In", CostCenter: { Name: "Residential (Rough In)" }, ...CL(100) }, { ID: 102, Name: "Finish", CostCenter: { Name: "Residential (Finish)" }, ...CL(finPct) }] },
      { ID: 19, Name: "Warranty", DisplayOrder: 9, ccs: warr }];
    const W = (id, name, pct) => ({ ID: id, Name: name, CostCenter: { Name: "Residential (Warranty)" }, ...CL(pct) });
    ok(SB.pickCostCenter(secs(0, []), "finish").id === 102, "an open Finish cost center is used as before");
    let c = SB.pickCostCenter(secs(100, [W(901, "Final inspection items", 100), W(902, "Vanity lights", 0)]), "finish");
    ok(c.id === 902 && c.sectionName === "Warranty" && c.warranty && /Finish is fully invoiced/.test(c.because), "a fully invoiced Finish sends the booking to the open warranty cost center, and says why");
    ok(/fully invoiced/.test(SB.pickCostCenter(secs(100, [W(901, "Final inspection items", 100)]), "finish").refused) && /fully invoiced/.test(SB.pickCostCenter(secs(100, []), "finish").refused), "invoiced Finish and no open warranty cost center: refused, never booked to an invoiced one");
    c = SB.pickCostCenter(secs(0, [W(902, "Vanity lights", 0), W(905, "Newer warranty item", 0)]), "trip", "warranty");
    ok(c.id === 905 && c.otherOpenWarranty.length === 1 && c.otherOpenWarranty[0].id === 902, "warranty work goes to the newest open warranty cost center, and lists the others");
    ok(/no open Warranty cost center/.test(SB.pickCostCenter(secs(0, []), "trip", "warranty").refused), "warranty work with no warranty cost center is refused with what to do");
    ok(SB.pickCostCenter(secs(0, [W(902, "Finish touch-up", 0)]), "finish").id === 102, "a warranty line that happens to say Finish is never mistaken for the Finish cost center");
    ok(D.tripCc({ scope: "Warranty punch list per Owusu" }, { roughStatus: "complete" }) === "warranty" && D.tripCc({ scope: "x", fromFailedRough: true }, {}) === "rough", "a trip whose scope says warranty is warranty work");
    ok(SB.validate({ mode: "preview", jobNo: "5", phase: "trip", cc: "warranty", staffIds: [1], days: [{ date: "2026-11-24", hours: 4 }] }, "2026-11-23") === "", "the Book button can ask for warranty");
  }

  // ── return trips ──
  w = world();
  const tr = { mode: "preview", jobNo: "900", phase: "trip", jobId: "J1", tripId: "r1", entries: [E("Louis", "2026-11-24", "07:00", "11:00"), E("James Livingston", "2026-11-24", "07:00", "11:00")] };
  p = await D.run(w.deps, tr);
  ok(p.ok && p.costCenter.name === "Finish" && p.trip.willBeMarkedScheduledOn === "2026-11-24" && /Send a PO/.test(p.trip.material), "a trip on a job whose rough-in is complete books to Finish; the preview says it will be marked Scheduled and that there's no material");
  b = await D.run(w.deps, { ...tr, mode: "book", hash: p.hash });
  const t1 = w.job.returnTrips.find(t => t.id === "r1");
  ok(b.ok && b.trip.markedScheduledOn === "2026-11-24" && t1.rtStatus === "scheduled" && t1.rtStatusDate === "2026-11-24" && t1.calBooked.ids.join() === "7001,7002" && w.job.roughStatus === "complete" && w.job.returnTrips.find(t => t.id === "r2").rtStatus === "complete", "a trip booked through it shows Scheduled with the date on the job; nothing else on the job changes");
  p = await D.run(world().deps, { ...tr, tripId: "r3" });
  ok(p.costCenter.name === "Rough In" && /on the trip/.test(p.trip.material), "a trip from a failed rough inspection books to Rough In");
  threw = ""; try { await D.run(world().deps, { ...tr, tripId: "r2" }); } catch (e) { threw = e.message; }
  ok(/already done/.test(threw), "a finished trip can't be booked");
  threw = ""; try { await D.run(world().deps, { ...tr, jobId: "NOPE" }); } catch (e) { threw = e.message; }
  ok(/isn't Simpro job/.test(threw), "the Command Center job has to be that Simpro job");

  // ── failure paths ──
  threw = ""; try { await D.run(world({ noSched: true }).deps, base(pair)); } catch (e) { threw = e.message; }
  ok(/Couldn't read Simpro's schedule/.test(threw), "if Simpro's schedule can't be read, nothing is previewed or written");
  w = world({ failAt: 2 }); p = await D.run(w.deps, base(pair)); b = await D.run(w.deps, { ...base(pair), mode: "book", hash: p.hash });
  ok(!b.ok && b.created.length === 1 && b.failed.person === "Louis Hoffman" || (!b.ok && b.created.length === 1 && b.failed), "if Simpro refuses an entry part way, it stops and says what was and wasn't written");

  // ── the calendar's own Book button: the same hard rules, pair and alone as notes ──
  {
    const ent = (id, name, date, s, e) => ({ staffId: id, name, date, blocks: [{ StartTime: s, EndTime: e }] });
    let h = D.humanCheck({ entries: [ent(2, "Louis Hoffman", "2026-11-24", "07:00", "17:00"), ent(4, "Trever Worley", "2026-11-24", "07:00", "17:00")], users, pto: [], holidays: null, schedules: [], jobNo: "900" });
    ok(h.refused.length === 0 && h.notes.some(n => /set pair James/.test(n)) && !h.notes.some(n => /Koy said/.test(n)), "a person's Book: a split pair is a note on the preview, not a refusal");
    h = D.humanCheck({ entries: [ent(5, "Callen Jakeman", "2026-11-24", "07:00", "17:00")], users, pto: [], holidays: null, schedules: [], jobNo: "900" });
    ok(h.refused.length === 0 && h.notes.some(n => /alone/.test(n)), "a person's Book: someone alone is a note");
    h = D.humanCheck({ entries: [ent(5, "Callen Jakeman", "2026-11-24", "07:00", "17:00"), ent(4, "Trever Worley", "2026-11-24", "07:00", "17:00")], users, pto: [{ name: "Callen Jakeman", start: "2026-11-24", end: "2026-11-24" }], holidays: null, schedules: [], jobNo: "900" });
    ok(h.refused.length === 1 && h.refused[0].rule === "time-off", "a person's Book: someone off that day is refused");
    h = D.humanCheck({ entries: [ent(6, "Joel Fey", "2026-11-24", "07:00", "17:00"), ent(4, "Trever Worley", "2026-11-28", "07:00", "17:00"), ent(5, "Callen Jakeman", "2026-11-26", "07:00", "17:00")], users, pto: [], holidays: null, schedules: [], jobNo: "900" });
    ok(h.refused.map(x => x.rule).sort().join() === "crew-board,holiday,weekend", "a person's Book: unassigned, a Saturday and a holiday are refused");
    h = D.humanCheck({ entries: [ent(5, "Callen Jakeman", "2026-11-27", "07:00", "17:00"), ent(4, "Trever Worley", "2026-11-27", "07:00", "17:00")], users, pto: [], holidays: null, schedules: [], jobNo: "900" });
    ok(h.refused.length === 0, "a person's Book: a Friday is allowed");
  }

  // ── never a stage or status ──
  const src = require("fs").readFileSync(require("path").join(__dirname, "../functions/scrambleDoor.js"), "utf8").replace(/\/\/[^\n]*/g, "");
  ok(!/Stage\s*:|Status\s*:|roughStatus\s*[:=][^=]|finishStatus\s*[:=][^=]|"PATCH"|"DELETE"|"PUT"/.test(src), "the door never writes a stage or status, and only ever creates schedule entries (no edit, no delete)");

  if (fails) { console.error(fails + " failed"); process.exit(1); }
  console.log("scramble-door-test: all passed");
})().catch(e => { console.error("FAIL the door test threw: " + (e && e.stack || e)); process.exit(1); });
