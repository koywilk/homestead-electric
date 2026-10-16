#!/usr/bin/env node
process.env.TZ = "UTC";   // Cloud Functions run in UTC: the harness proves production behavior, not this Mac's Mountain clock.
// Friday Strategy/Scheduling prep — pure-module tests. Run: node scripts/strategyprep-test.js
// Fixtures are the REAL cases Koy caught on 2026-10-15 (Lot 208, Namjoshi/Treycen/Hideout), simplified.
"use strict";
const S = require("../functions/strategyPrep.js");
let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fri Oct 16 2026, 6:00 AM Mountain (12:00Z). Next week = Mon 10/19 .. Fri 10/23.
const NOW = new Date("2026-10-16T12:00:00Z");

function fixture(over = {}) {
  const users = [
    { id: "koy", name: "Koy Wilkinson", role: "admin" },
    { id: "josh", name: "Josh Cloward", role: "admin" },
    { id: "brady", name: "Brady Nelson", role: "admin" },
    { id: "justin", name: "Justin Cloward", role: "admin" },
    { id: "daegan", name: "Daegan Smith", title: "foreman" },
    { id: "abraham", name: "Abraham Tristan", title: "foreman" },
    { id: "keegan", name: "Keegan Wilkinson", title: "foreman" },
    { id: "treycen", name: "Treycen Rollene", title: "lead" },
    { id: "bailey", name: "Bailey Smith", title: "crew" },
    { id: "braden", name: "Braden Davis", title: "crew" },
    { id: "old", name: "Laid Off", title: "crew", active: false },
  ];
  const item = (o) => ({ text: "item", done: false, voided: false, ...o });
  const jobs = [
    // Lot 208: rough in progress 80%, READY TO INVOICE since 10/1, QC needs, waiting items, no booking.
    { id: "L208", name: "Skyridge Lot 208 - Mayflower", simproNo: "1419 ", foreman: "Keegan Wilkinson", lead: "Keegan Wilkinson",
      roughStatus: "inprogress", roughStage: "80%", readyToInvoice: true, readyToInvoiceDate: "10/1/2026", qcStatus: "needs",
      roughPunch: { main: { general: [item({ waiting: true, waitingOn: "Need ufer clamp" }), item({ waiting: true, waitingOn: "Pocket door framed" }), item({})] } },
      roughQuestions: { main: [{ question: "Cabinet plans", answer: "", done: false, addedAt: "2026-08-18T10:00:00Z" }] },
      roughUpdates: [{ date: "9/21/2026", text: "Waiting for answers", addedBy: "Keegan" }] },
    // Namjoshi: rough CONFIRMED for Mon 10/19, lead Treycen — who Simpro has at The Hideout Monday. Nobody booked on Namjoshi.
    { id: "NAM", name: "Namjoshi Basement Remodel - SLC", simproNo: "1444", foreman: "Daegan Smith", lead: "Treycen Rollene",
      roughStatus: "date_confirmed", roughStage: "0%", roughProjectedStart: "10/19/2026", roughStartConfirmed: true,
      prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true } },
    // Hideout: finish 95%, invoiced, 6 waiting items, Simpro has Treycen + Bailey there Monday.
    { id: "HIDE", name: "The Hideout", simproNo: "1302", foreman: "Abraham Tristan", lead: "Abraham Tristan",
      roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", invoiceSent: true, invoiceDismissed: true,
      finishPunch: { main: { general: [item({ waiting: true, waitingOn: "Waiting for cabinetry" }), item({ waiting: true, waitingOn: "Waiting for fixture" })] } } },
    // Riverton: rough PROJECTED Mon 10/19, no foreman/lead, prep 2/5, nobody booked.
    { id: "RIV", name: "Riverton & Laundromat", simproNo: "1460", foreman: "Unassigned", lead: "",
      roughStatus: "waiting_date", roughProjectedStart: "10/19/2026", prepChecklist: { redlinePlans: true, plansUploaded: true } },
    // Rose: finish on hold (waiting on paint).
    { id: "ROSE", name: "Rose", simproNo: "889", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "waiting", finishStage: "60%" },
    // Micek: between phases, NO finish date → not listed (Koy 2026-09-23), but counted.
    { id: "MIC", name: "Micek Residence", simproNo: "1321", foreman: "Keegan Wilkinson", roughStatus: "complete", roughStatusDate: "4/15/2026", finishStatus: "" },
    // Oak Hill: rough in progress, Simpro has Louis Mon-Fri → Booked.
    { id: "OAK", name: "Oak Hill 5 - Alpine", simproNo: "1454", foreman: "Louis Hoffman", lead: "Louis Hoffman", roughStatus: "inprogress", roughStage: "10%" },
    // Done job and a quote never appear.
    { id: "DONE", name: "Wood", finishStatus: "complete", finishStage: "100%" },
    { id: "Q", name: "#3019 - Chapman", type: "quote" },
    // Entangled: temp power → margin watch excluded (Task 4) but schedule still lists it when in progress.
    { id: "TP", name: "Smith Temp Power", simproNo: "1470", roughStatus: "inprogress", roughStage: "50%" },
  ];
  const simpro = (date, pid, name) => ({ Type: "job", Date: date, Project: { ProjectID: pid }, Staff: { Name: name }, Blocks: [{ Hrs: 10 }] });
  const scheduleEntries = [
    simpro("2026-10-19", 1302, "Treycen Rollene"), simpro("2026-10-19", 1302, "Bailey Smith"),
    simpro("2026-10-19", 1454, "Louis Hoffman"), simpro("2026-10-20", 1454, "Louis Hoffman"), simpro("2026-10-21", 1454, "Louis Hoffman"),
    simpro("2026-10-22", 1454, "Louis Hoffman"), simpro("2026-10-23", 1454, "Louis Hoffman"),
    simpro("2026-10-20", 9999, "Zane Watkins"),                       // a Simpro job the app does not know
    { Type: "activity", Date: "2026-10-23", Project: "", Staff: { Name: "James Christen" } }, // not a job → ignored
  ];
  return { jobs, users, scheduleEntries, plannerDoc: null, pto: [], timeOffRequests: [], needs: [], upcoming: [],
    agentFindings: [], calendarEvents: [], prevState: null, simproTotalsById: {}, notesDoc: null, simproOk: true, now: NOW, ...over };
}

// ── Task 1: helpers, live set, schedule index, classification ────────────────
{
  t("toDateAny: M/D/YYYY", S.ymd(S.toDateAny("10/19/2026")) === "2026-10-19");
  t("toDateAny: M/D/YY", S.ymd(S.toDateAny("3/19/26")) === "2026-03-19");
  t("toDateAny: ISO", S.ymd(S.toDateAny("2026-08-18T10:00:00Z")) === "2026-08-18");
  t("toDateAny: ms-epoch id (app ids)", S.toDateAny("1785948806355") instanceof Date);
  t("toDateAny: junk → null", S.toDateAny("Monday-ish") === null);
  t("snOf trims", S.snOf({ simproNo: "1419 " }) === "1419");

  const f = fixture();
  const live = S.liveJobs(f.jobs);
  t("liveJobs drops done + quote", !live.some(j => j.id === "DONE" || j.id === "Q") && live.length === 8, String(live.length));

  const w = S.weekOf(NOW);
  t("weekOf: next Monday 10/19, Friday 10/23", w.weekYmds[0] === "2026-10-19" && w.weekYmds[4] === "2026-10-23", JSON.stringify(w.weekYmds));
  t("weekOf: today is Fri 10/16", S.ymd(w.today) === "2026-10-16");

  const idx = S.buildScheduleIndex(f.scheduleEntries, f.plannerDoc, live, w.weekYmds);
  t("index: Hideout has Treycen + Bailey Mon (simpro)", eq(idx.byJob.get("HIDE").days[0].people, ["Treycen Rollene", "Bailey Smith"]) && idx.byJob.get("HIDE").days[0].source === "simpro", JSON.stringify(idx.byJob.get("HIDE")));
  t("index: Oak Hill all five days", Object.keys(idx.byJob.get("OAK").days).length === 5);
  t("index: Namjoshi has NO booking (lead field is not a booking)", !idx.byJob.has("NAM"));
  t("index: byPerson Treycen Mon → The Hideout", idx.byPerson.get("treycen r").days[0].has("The Hideout"));
  t("index: Simpro job unknown to the app is kept, not dropped", idx.unknownSimpro.length === 1 && idx.unknownSimpro[0].pid === "9999" && idx.unknownSimpro[0].people[0] === "Zane Watkins");
  t("index: activity rows ignored", !idx.byPerson.has("james c"));
  t("index: plannerPresent false when doc null", idx.plannerPresent === false && idx.simproOk === true);

  const c = S.classifySchedule(live, idx, w.weekYmds, w.today);
  const ids = (k) => c[k].map(r => r.jobId);
  t("booked: Hideout + Oak Hill", eq(ids("booked"), ["OAK", "HIDE"]) || eq(ids("booked"), ["HIDE", "OAK"]), JSON.stringify(ids("booked")));
  t("idle: Lot 208 is listed even though ready to invoice + waiting", ids("idle").includes("L208"), JSON.stringify(ids("idle")));
  t("idle: Lot 208 row carries RTI age, QC, punch count, wait buckets", (() => { const r = c.idle.find(x => x.jobId === "L208"); return r && r.rtiDays === 15 && r.qcNeeds === true && r.openPunch === 3 && r.waitBuckets.length >= 1 && r.phase === "rough" && r.pct === 80; })(), JSON.stringify(c.idle.find(x => x.jobId === "L208")));
  t("idle: temp power job listed too (in progress, nobody booked)", ids("idle").includes("TP"));
  t("starts: Namjoshi + Riverton (dated in window, phase not started)", eq(ids("starts").sort(), ["NAM", "RIV"]), JSON.stringify(ids("starts")));
  t("starts: Namjoshi confirmed, nobody booked, lead elsewhere named", (() => { const r = c.starts.find(x => x.jobId === "NAM"); return r && r.confirmed === true && r.crewBooked === false && r.elsewhere[0] === "lead Treycen Rollene is at The Hideout Mon"; })(), JSON.stringify(c.starts.find(x => x.jobId === "NAM")));
  t("starts: Riverton projected, no foreman/lead, prep 2/5 naming missing", (() => { const r = c.starts.find(x => x.jobId === "RIV"); return r && r.confirmed === false && r.missingRoles.join("+") === "foreman+lead" && r.prep.done === 2 && eq(r.prep.missing, ["Cabinet Plans Received", "Appliance Specs Received", "Ready to Hand Off to Foreman"]); })(), JSON.stringify(c.starts.find(x => x.jobId === "RIV")));
  t("onHold: Rose", eq(ids("onHold"), ["ROSE"]));
  t("between (not printed, counted): Micek", eq(ids("between"), ["MIC"]));
  const all = [...ids("booked"), ...ids("idle"), ...ids("starts"), ...ids("onHold"), ...ids("between")];
  t("every live job lands in exactly one bucket", all.length === live.length && new Set(all).size === live.length, JSON.stringify(all));
  t("no dead fields read", !/roughScheduledDate|finishScheduledDate|lastActivityAt/.test(require("fs").readFileSync(require.resolve("../functions/strategyPrep.js"), "utf8")));

  // People are keyed by first name + last initial (the app's two-Jacobs rule), never first name alone.
  t("personKey: first name + last initial", S.personKey("Treycen Rollene") === "treycen r" && S.personKey("Jacob Nuffer") === "jacob n" && S.personKey("Jacob Spackman") === "jacob s" && S.personKey("Paul") === "paul");
  {
    const f2 = fixture();
    const live2 = S.liveJobs(f2.jobs);
    const ent = [...f2.scheduleEntries,
      { Type: "job", Date: "2026-10-21", Project: { ProjectID: 1302 }, Staff: { Name: "Jacob Nuffer" }, Blocks: [{ Hrs: 10 }] },
      { Type: "job", Date: "2026-10-21", Project: { ProjectID: 1302 }, Staff: { Name: "Jacob Spackman" }, Blocks: [{ Hrs: 10 }] }];
    const i2 = S.buildScheduleIndex(ent, null, live2, w.weekYmds);
    t("two Jacobs on one job-day are both kept", i2.byJob.get("HIDE").days[2].people.length === 2 && eq(i2.byJob.get("HIDE").days[2].people, ["Jacob Nuffer", "Jacob Spackman"]), JSON.stringify(i2.byJob.get("HIDE").days[2]));
    t("two Jacobs are two byPerson entries", i2.byPerson.has("jacob n") && i2.byPerson.has("jacob s") && !i2.byPerson.has("jacob"));
    const c2 = S.classifySchedule(live2, i2, w.weekYmds, w.today);
    t("booked row lists both Jacobs", c2.booked.find(r => r.jobId === "HIDE").people.filter(p => /^Jacob/.test(p)).length === 2);
  }
  {
    const f3 = fixture();
    const live3 = S.liveJobs(f3.jobs);
    const planner = { assignments: { OAK_0: { lead: "Louis Hoffman", crew: [] } } };
    const i3 = S.buildScheduleIndex(f3.scheduleEntries, planner, live3, w.weekYmds);
    t("same person from Simpro + planner is ONE person, source both", i3.byJob.get("OAK").days[0].people.length === 1 && i3.byJob.get("OAK").days[0].source === "both" && i3.plannerPresent === true, JSON.stringify(i3.byJob.get("OAK").days[0]));
    t("same person from Simpro + planner: per-person source is both", i3.byJob.get("OAK").days[0].by["louis h"] === "both", JSON.stringify(i3.byJob.get("OAK").days[0]));
  }
  {
    const f4 = fixture();
    f4.scheduleEntries.push({ Type: "job", Date: "2026-10-20", Project: { ProjectID: 1419 }, Staff: { Name: "Keegan Wilkinson" }, Blocks: [{ Hrs: 10 }] });
    const live4 = S.liveJobs(f4.jobs);
    const c4 = S.classifySchedule(live4, S.buildScheduleIndex(f4.scheduleEntries, null, live4, w.weekYmds), w.weekYmds, w.today);
    t("trailing-space simproNo matches: Lot 208 moves idle -> booked", c4.booked.some(r => r.jobId === "L208" && r.days === "Tue") && !c4.idle.some(r => r.jobId === "L208"), JSON.stringify(c4.booked.map(r => r.jobId)));
  }
}

// ── Task 2: moved dates, calendar, people, capacity, conflicts ───────────────
{
  const f = fixture({
    pto: [{ name: "Braden Davis", start: "10/19/2026", end: "10/23/2026", note: "Out of town" }, { name: "Bailey Smith", start: "10/19/2026", end: "10/19/2026", note: "" }],
    timeOffRequests: [{ id: "to1", name: "Keegan Wilkinson", start: "10/28/2026", end: "10/30/2026", status: "pending", requestedAt: "2026-10-14T10:00:00Z" }, { id: "to2", name: "Braden Davis", start: "10/19/2026", end: "10/23/2026", status: "approved", requestedAt: "2026-10-01T10:00:00Z" }],
    needs: [{ id: "n1", kind: "bodies", text: "2 bodies Mon-Wed for Oak Hill 5", jobName: "Oak Hill 5 - Alpine", createdBy: "Louis Hoffman", createdAt: "2026-10-14T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" }],
    calendarEvents: [
      { summary: "Miller site walk with homeowners", start: { dateTime: "2026-10-22T10:00:00-06:00" }, location: "Alpine", attendees: [{ email: "koy@homesteadelectric.net" }, { email: "brady@homesteadelectric.net" }] },
      { summary: "Dentist", start: { dateTime: "2026-10-20T09:00:00-06:00" } },
    ],
  });
  f.jobs.push({ id: "MIL", name: "Miller Residence - Alpine", simproNo: "1438", foreman: "Keegan Wilkinson", lead: "Keegan Wilkinson", roughStatus: "inprogress", roughStage: "75%", fourWayTargetDate: "10/21/2026", qcStatus: "scheduled", qcStatusDate: "10/21/2026", matterportStatus: "scheduled", matterportStatusDate: "10/23/2026",
    returnTrips: [{ rtStatus: "scheduled", rtStatusDate: "10/20/2026", scope: "Pool panel feed", assignedTo: "Keegan" }] });
  const live = S.liveJobs(f.jobs), w = S.weekOf(NOW);
  const idx = S.buildScheduleIndex(f.scheduleEntries, f.plannerDoc, live, w.weekYmds);

  const keys = S.dateKeys(live);
  t("dateKeys: Namjoshi rough start + Miller 4-way/QC/scan/RT", keys["NAM:roughStart"] === "2026-10-19" && keys["MIL:fourWayTargetDate"] === "2026-10-21" && keys["MIL:qcStatusDate"] === "2026-10-21" && keys["MIL:matterportStatusDate"] === "2026-10-23" && keys["MIL:rt:0"] === "2026-10-20", JSON.stringify(keys));
  const prev = { "NAM:roughProjectedStart": [{ d: "2026-10-02", v: "2026-10-08" }, { d: "2026-10-09", v: "2026-10-12" }], "L208:fourWayTargetDate": [{ d: "2026-10-09", v: "2026-10-01" }] };
  const mv = S.movedDates(live, prev, w.today);
  t("movedDates: Namjoshi 10/12 → 10/19 is the 3rd date", (() => { const r = mv.rows.find(x => x.name.startsWith("Namjoshi")); return r && r.from === "10/12" && r.to === "10/19" && r.nth === 3 && r.label === "rough start"; })(), JSON.stringify(mv.rows));
  t("movedDates: unchanged keys don't print", !mv.rows.some(x => x.name.startsWith("Miller")));
  t("movedDates: firstRun false with history", mv.firstRun === false && S.movedDates(live, null, w.today).firstRun === true);
  t("movedDates: passed date = Riverton? no (in window); Rose none; Lot 208 has none → passed empty", mv.passed.length === 0, JSON.stringify(mv.passed));
  const f2 = fixture(); f2.jobs.find(j => j.id === "RIV").roughProjectedStart = "10/12/2026";
  const mv2 = S.movedDates(S.liveJobs(f2.jobs), {}, w.today);
  t("movedDates: a start before today with status not started prints under passed", mv2.passed.length === 1 && mv2.passed[0].name === "Riverton & Laundromat" && mv2.passed[0].label === "rough start", JSON.stringify(mv2.passed));

  const cal = S.calendarRows(live, f.calendarEvents, w.weekYmds);
  const labels = cal.map(r => `${w.DAY_LBL[r.di]} ${r.label} ${r.name}`);
  t("calendar: RT Tue, 4-way Wed, QC Wed, walk Thu, scan Fri; dentist ignored", eq(labels, ["Tue Return trip Miller Residence - Alpine", "Wed Rough inspection Miller Residence - Alpine", "Wed Rough QC walk Miller Residence - Alpine", "Thu Site walk Miller Residence - Alpine", "Fri Matterport scan Miller Residence - Alpine"]), JSON.stringify(labels));
  t("calendar: walk row names attendees by first name", cal.find(r => r.label === "Site walk").who === "Koy, Brady");

  const pp = S.peopleRows({ users: f.users, pto: f.pto, timeOffRequests: f.timeOffRequests, needs: f.needs, prevUserIds: ["koy", "josh", "brady", "justin", "daegan", "abraham", "keegan", "treycen", "bailey", "old"], idx, weekDays: w.weekDays, today: w.today });
  t("people: out rows (Braden all week, Bailey Mon)", eq(pp.out.map(r => `${r.name}|${r.range}`), ["Braden Davis|all week", "Bailey Smith|Mon"]), JSON.stringify(pp.out));
  t("people: pending request with age", pp.pending.length === 1 && pp.pending[0].name === "Keegan Wilkinson" && pp.pending[0].requestedDays === 2, JSON.stringify(pp.pending));
  t("people: bodies request printed from text", pp.bodies.length === 1 && /2 bodies Mon-Wed/.test(pp.bodies[0].text) && pp.bodies[0].by === "Louis Hoffman");
  t("people: new user since last Friday = Braden", eq(pp.newUsers.map(u => u.name), ["Braden Davis"]));
  // roster = foreman/lead/crew with active!==false: Daegan, Abraham, Keegan, Treycen, Bailey, Braden = 6. Mon: PTO Braden+Bailey → 4 available; booked Mon = Treycen, Bailey, Louis(not a user, still booked) = 3.
  t("capacity: Mon 3/4 (Bailey booked AND out counts as booked), Fri 1/5", pp.capacity[0].booked === 3 && pp.capacity[0].available === 4 && pp.capacity[4].booked === 1 && pp.capacity[4].available === 5, JSON.stringify(pp.capacity));
  t("capacity: thin flag under 70%", pp.capacity[4].thin === true && pp.capacity[0].thin === false);

  const cf = S.conflictRows(idx, f.pto, w.weekYmds);
  t("conflicts: Bailey booked Mon but out", cf.some(s => /Bailey Smith .*booked Mon.*out/.test(s)), JSON.stringify(cf));
  const idx2 = S.buildScheduleIndex([...f.scheduleEntries, { Type: "job", Date: "2026-10-19", Project: { ProjectID: 1454 }, Staff: { Name: "Treycen Rollene" } }], f.plannerDoc, live, w.weekYmds);
  t("conflicts: same person two jobs same day", S.conflictRows(idx2, [], w.weekYmds).some(s => /Treycen Rollene .*Mon.*The Hideout.*Oak Hill 5/.test(s) || /Treycen Rollene .*Mon.*Oak Hill 5.*The Hideout/.test(s)), JSON.stringify(S.conflictRows(idx2, [], w.weekYmds)));
  // Simpro has Treycen + Bailey at the Hideout Mon (source "both" once the planner adds Abraham), nobody Tue → the Tue cell is the planner-only disagreement.
  // Case (a): planner adds Abraham on Hideout Mon alongside Simpro's Treycen + Bailey → per-person line.
  const idxA = S.buildScheduleIndex(f.scheduleEntries, { assignments: { "HIDE_0": { lead: "Abraham Tristan", crew: [] } } }, live, w.weekYmds);
  const hd0 = idxA.byJob.get("HIDE").days[0], cfA = S.conflictRows(idxA, [], w.weekYmds);
  t("conflicts: planner-only person on a Simpro-staffed day → 'Simpro does not list them'", cfA.some(s => /planner has Abraham Tristan on The Hideout Mon but Simpro does not list them/.test(s)) && !cfA.some(s => /Treycen|Bailey/.test(s) && /planner has/.test(s)), JSON.stringify(cfA));
  t("index: per-person source on a mixed day", hd0.by["abraham t"] === "planner" && hd0.by["treycen r"] === "simpro" && hd0.source === "both" && eq(hd0.people, ["Treycen Rollene", "Bailey Smith", "Abraham Tristan"]), JSON.stringify(hd0));
  const idx3 = S.buildScheduleIndex(f.scheduleEntries, { assignments: { "HIDE_1": { lead: "Abraham Tristan", crew: [] } } }, live, w.weekYmds);
  t("conflicts: planner says Abraham on Hideout Tue, Simpro doesn't → disagreement line", S.conflictRows(idx3, [], w.weekYmds).some(s => /planner.*Abraham Tristan.*Hideout.*Tue.*Simpro/.test(s)), JSON.stringify(S.conflictRows(idx3, [], w.weekYmds)));
}

// ── Task 2 review fixes: jrforeman, cleared dates, ambiguous calendar, passed guards, nextDates ──
{
  const w = S.weekOf(NOW);
  const live0 = S.liveJobs(fixture().jobs);
  // 1. jrforeman is roster
  {
    const base = fixture(), withJr = fixture(); withJr.users.push({ id: "jr", name: "Payton Hale", title: "jrforeman" });
    const cap = (f) => { const l = S.liveJobs(f.jobs); return S.peopleRows({ users: f.users, pto: [], timeOffRequests: [], needs: [], prevUserIds: null, idx: S.buildScheduleIndex(f.scheduleEntries, null, l, w.weekYmds), weekDays: w.weekDays, today: w.today }).capacity; };
    const c0 = cap(base), c1 = cap(withJr);
    t("roster: jrforeman adds one available person every day", c0.every((c, i) => c1[i].available === c.available + 1), JSON.stringify([c0, c1]));
  }
  // 2. cleared dates
  {
    const prev = { "NAM:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-19" }] };
    const f = fixture(); delete f.jobs.find(j => j.id === "NAM").roughProjectedStart;
    const live = S.liveJobs(f.jobs);
    const mv = S.movedDates(live, prev, w.today);
    t("cleared date: Namjoshi rough start 10/19 → no date", mv.rows.length === 1 && mv.rows[0].name.startsWith("Namjoshi") && mv.rows[0].label === "rough start" && mv.rows[0].from === "10/19" && mv.rows[0].to === "no date", JSON.stringify(mv.rows));
    const nx = S.nextDates(live, prev, "2026-10-16");
    t("cleared date: nextDates ends with an empty value (old key name read, new key name written)", nx["NAM:roughStart"].length === 2 && nx["NAM:roughStart"][1].v === "" && nx["NAM:roughStart"][1].d === "2026-10-16" && !("NAM:roughProjectedStart" in nx), JSON.stringify(nx["NAM:roughStart"]));
    t("cleared date: second run with that history prints no row", S.movedDates(live, nx, w.today).rows.length === 0 && eq(S.nextDates(live, nx, "2026-10-23")["NAM:roughStart"], nx["NAM:roughStart"]));
    const gone = S.nextDates(live.filter(j => j.id !== "NAM"), prev, "2026-10-16");
    t("cleared date: a job no longer live drops out of next and prints nothing", !("NAM:roughProjectedStart" in gone) && !("NAM:roughStart" in gone) && S.movedDates(live.filter(j => j.id !== "NAM"), prev, w.today).rows.length === 0);
    // a completed return trip is not a cleared date
    const f3 = fixture(); f3.jobs.push({ id: "RTJ", name: "RT Job", roughStatus: "inprogress", roughStage: "20%", returnTrips: [{ rtStatus: "complete", rtStatusDate: "10/20/2026" }] });
    const mv3 = S.movedDates(S.liveJobs(f3.jobs), { "RTJ:rt:0": [{ d: "2026-10-09", v: "2026-10-20" }] }, w.today);
    t("cleared date: a completed return trip is not reported as cleared", mv3.rows.length === 0, JSON.stringify(mv3.rows));
  }
  // 4. nextDates behavior
  {
    const same = S.nextDates(live0, { "NAM:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-19" }] }, "2026-10-16");
    t("nextDates: unchanged value is not appended", same["NAM:roughStart"].length === 1 && same["NAM:roughStart"][0].d === "2026-10-09");
    const chg = S.nextDates(live0, { "NAM:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-12" }] }, "2026-10-16");
    t("nextDates: changed value appends today's entry", eq(chg["NAM:roughStart"], [{ d: "2026-10-09", v: "2026-10-12" }, { d: "2026-10-16", v: "2026-10-19" }]), JSON.stringify(chg["NAM:roughStart"]));
    const six = [1, 2, 3, 4, 5, 6].map(n => ({ d: `2026-09-0${n}`, v: `2026-09-1${n}` }));
    const cap = S.nextDates(live0, { "NAM:roughProjectedStart": six }, "2026-10-16")["NAM:roughStart"];
    t("nextDates: history capped at 6, oldest dropped", cap.length === 6 && cap[0].d === "2026-09-02" && cap[5].v === "2026-10-19", JSON.stringify(cap));
    t("nextDates: first run (null prev) seeds one entry per key", S.nextDates(live0, null, "2026-10-16")["NAM:roughStart"].length === 1);
  }
  // 4/5. passed branches and guards
  {
    const f = fixture();
    f.jobs.push({ id: "FIN", name: "Finish Start Job", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "10/12/2026" });
    f.jobs.push({ id: "FIN2", name: "Final Insp Job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finalInspectionTargetDate: "10/10/2026" });
    f.jobs.push({ id: "OLD", name: "Rough Done Old Target", roughStatus: "complete", roughStage: "100%", finishStatus: "waiting_date", fourWayTargetDate: "8/1/2026" });
    const mv = S.movedDates(S.liveJobs(f.jobs), {}, w.today);
    const p = (n) => mv.passed.filter(x => x.name === n).map(x => ({ name: x.name, label: x.label, date: x.date }));
    t("passed: finish start before today, finish not started", eq(p("Finish Start Job"), [{ name: "Finish Start Job", label: "finish start", date: "10/12" }]), JSON.stringify(mv.passed));
    t("passed: final inspection before today, finish in progress, no result", eq(p("Final Insp Job"), [{ name: "Final Insp Job", label: "final inspection", date: "10/10" }]), JSON.stringify(mv.passed));
    t("passed: rough-complete job with an old 4-way target is NOT in passed", p("Rough Done Old Target").length === 0, JSON.stringify(mv.passed));
  }
  // 3. calendar: ambiguity, cancelled, all-day
  {
    const f = fixture();
    f.jobs.push({ id: "MIL", name: "Miller Residence - Alpine", simproNo: "1438", roughStatus: "inprogress", roughStage: "75%" });
    f.jobs.push({ id: "MIL2", name: "Miller Residence - Floor Boxes", roughStatus: "inprogress" });
    const live = S.liveJobs(f.jobs);
    const walk = { summary: "Miller site walk with homeowners", start: { dateTime: "2026-10-22T10:00:00-06:00" } };
    const cal = S.calendarRows(live, [walk], w.weekYmds);
    t("calendar: event matching two jobs → two Site walk rows, both ambiguous", cal.length === 2 && cal.every(r => r.label === "Site walk" && r.ambiguous === true) && eq(cal.map(r => r.name).sort(), ["Miller Residence - Alpine", "Miller Residence - Floor Boxes"]), JSON.stringify(cal));
    t("calendar: cancelled event yields nothing", S.calendarRows(live, [{ ...walk, status: "cancelled" }], w.weekYmds).length === 0);
    const one = S.calendarRows(S.liveJobs(fixture().jobs.concat([{ id: "MIL", name: "Miller Residence - Alpine", roughStatus: "inprogress", roughStage: "75%" }])), [walk], w.weekYmds);
    t("calendar: single match is ambiguous false", one.length === 1 && one[0].ambiguous === false);
    const allDay = S.calendarRows(live, [{ summary: "Miller meeting", start: { date: "2026-10-21" } }], w.weekYmds);
    const lateEv = S.calendarRows(live, [{ summary: "Miller walk", start: { dateTime: "2026-10-22T22:30:00-06:00" } }], w.weekYmds);
    t("calendar: 22:30-06:00 event stays on Thu (day from the written date, not the UTC instant)", lateEv.length === 2 && lateEv.every(r => r.di === 3), JSON.stringify(lateEv));
    t("calendar: all-day event lands on Wed (Meeting)", allDay.length === 2 && allDay.every(r => w.DAY_LBL[r.di] === "Wed" && r.label === "Meeting"), JSON.stringify(allDay));
  }
  // 4. people edge cases
  {
    const f = fixture({ pto: [{ name: "Bailey Smith", start: "10/20/2026" }] });
    const live = S.liveJobs(f.jobs), idx = S.buildScheduleIndex(f.scheduleEntries, null, live, w.weekYmds);
    const args = { users: f.users, pto: f.pto, timeOffRequests: [], needs: [], idx, weekDays: w.weekDays, today: w.today };
    const pp = S.peopleRows({ ...args, prevUserIds: ["koy"] });
    t("people: PTO with no end counts one day", pp.out.length === 1 && eq(pp.out[0].dis, [1]) && pp.out[0].range === "Tue", JSON.stringify(pp.out));
    t("people: prevUserIds null → newUsers empty", S.peopleRows({ ...args, prevUserIds: null }).newUsers.length === 0);
    t("people: prevUserIds [] → newUsers empty (empty snapshot must not flag the team)", S.peopleRows({ ...args, prevUserIds: [] }).newUsers.length === 0);
    t("people: non-empty prevUserIds still flags the new ones", S.peopleRows({ ...args, prevUserIds: ["koy"] }).newUsers.length === 9);
  }
}

// ── Task 3: blocked ──────────────────────────────────────────────────────────
{
  const f = fixture({
    needs: [
      { id: "n1", kind: "need", text: "Updated pantry redlines", jobName: "Oak Hill 5 - Alpine", jobId: "OAK", createdBy: "Louis Hoffman", createdAt: "2026-10-05T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" },
      { id: "n2", kind: "need", text: "Fresh one", jobName: "Oak Hill 5 - Alpine", jobId: "OAK", createdBy: "Louis Hoffman", createdAt: "2026-10-14T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" },   // < 5 days → not a block yet
      { id: "n3", kind: "task", text: "Pick up spider box", createdBy: "Koy Wilkinson", createdAt: "2026-09-20T15:00:00Z", status: "open", assignedTo: "Keegan Wilkinson" },           // field-assigned → not "us"
      { id: "n4", kind: "need", text: "Old done", jobId: "OAK", createdAt: "2026-09-01T15:00:00Z", status: "done", assignedTo: "Koy Wilkinson" },
    ],
  });
  f.jobs.push(
    { id: "BUL", name: "Bulowski", simproNo: "866", foreman: "Colby Fogh", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%",
      changeOrders: [{ coStatus: "approved", createdAt: "2026-05-11T10:00:00Z", desc: "More Dimmers" }, { coStatus: "approved", createdAt: "2026-05-11T10:00:00Z", desc: "Tape light" }, { coStatus: "completed", createdAt: "2026-04-01T10:00:00Z" }] },
    { id: "COW", name: "Cowdrey", simproNo: "929", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%",
      returnTrips: [{ rtStatus: "needs", createdAt: "2026-06-17T10:00:00Z", scope: "Floor outlets" }, { rtStatus: "complete", signedOff: true }] },
    { id: "ASH", name: "Ashcraft", simproNo: "1291", foreman: "Vasa Mataafa", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%",
      finishQuestions: { main: Array.from({ length: 10 }, (_, i) => ({ question: `Q${i}`, answer: "", done: false, addedAt: "2026-10-02T10:00:00Z" })) }, flagged: true, flagNote: "Need an update from Louis" },
  );
  const live = S.liveJobs(f.jobs), w = S.weekOf(NOW);
  const b = S.blockedRows({ live, needs: f.needs, users: f.users, prevBlockerKeys: ["L208:GC / builder", "ROSE:On hold", "HIDE:Material", "MIC:Material"], today: w.today });
  const g = (n) => (b.groups.find(x => x.name === n) || { rows: [] }).rows;
  t("blocked: Lot 208 under GC / builder (pocket door framing), one line, age 59d from the oldest open question (8/18)", (() => { const r = g("GC / builder").find(x => x.jobId === "L208"); return r && r.ageDays === 59 && /ufer clamp|Pocket door/.test(r.what); })(), JSON.stringify(g("GC / builder")));
  t("blocked: Lot 208 appears in ONE group only", b.groups.filter(x => x.rows.some(r => r.jobId === "L208")).length === 1, JSON.stringify(b.groups.map(x => [x.name, x.rows.map(r => r.jobId)])));
  t("blocked: Hideout 1 GC (cabinetry) vs 1 Material (fixture) → tie → GROUP_ORDER → GC / builder", g("GC / builder").some(r => r.jobId === "HIDE") && !g("Material").some(r => r.jobId === "HIDE"), JSON.stringify(b.groups.map(x => [x.name, x.rows.map(r => r.jobId)])));
  t("blocked: Ashcraft under Homeowner / designer with 10 questions since 10/2", (() => { const r = g("Homeowner / designer").find(x => x.jobId === "ASH"); return r && /10 questions/.test(r.what) && r.ageDays === 14; })(), JSON.stringify(g("Homeowner / designer")));
  t("blocked: Rose under On hold", g("On hold").some(r => r.jobId === "ROSE"));
  t("blocked: Us = Oak Hill need open 11d (fresh one and field-assigned task excluded); flagged Ashcraft counted under Us too", (() => { const us = g("Us (office owes the field)"); return us.some(r => r.jobId === "OAK" && /pantry redlines/.test(r.what) && r.ageDays === 11) && !us.some(r => /Fresh one|spider/.test(r.what)) && us.some(r => r.jobId === "ASH" && /flagged/.test(r.what)); })(), JSON.stringify(g("Us (office owes the field)")));
  t("blocked: sold work — Bulowski 2 approved COs 158d, Cowdrey RT 121d", (() => { const s = g("Sold work not on the calendar"); const bu = s.find(r => r.jobId === "BUL"), co = s.find(r => r.jobId === "COW"); return bu && /2 approved COs/.test(bu.what) && bu.ageDays === 158 && co && /return trip/.test(co.what) && co.ageDays === 121; })(), JSON.stringify(g("Sold work not on the calendar")));
  t("blocked: cleared = Micek Material (key gone), not Lot 208 (still blocked, group may differ → still counted as moved not cleared)", eq(b.cleared.map(c => c.name), ["Micek Residence"]), JSON.stringify(b.cleared));
  t("blocked: keys cover every printed row; total + byGroup consistent", b.keys.length === b.total && Object.values(b.byGroup).reduce((a, n) => a + n, 0) === b.total);
  t("blocked: firstRun false with prev keys; true with null", b.firstRun === false && S.blockedRows({ live, needs: [], users: f.users, prevBlockerKeys: null, today: w.today }).firstRun === true);
  const big = S.blockedRows({ live: Array.from({ length: 14 }, (_, i) => ({ id: "H" + i, name: "Hold " + i, roughStatus: "waiting" })), needs: [], users: f.users, prevBlockerKeys: [], today: w.today });
  const bigHold = big.groups.find(x => x.name === "On hold") || { rows: [], more: -1 };
  t("blocked: cap 10 per group + more (On hold)", bigHold.rows.length === 10 && bigHold.more === 4, JSON.stringify(big.groups.map(x => [x.name, x.rows.length, x.more])));
  // review fixes
  const item = (o) => ({ text: "item", done: false, voided: false, ...o });
  const keyPrev = (prev) => S.blockedRows({ live, needs: f.needs, users: f.users, prevBlockerKeys: prev, today: w.today });
  const multi = keyPrev(["MIC:Material", "MIC:On hold", "MIC:GC / builder"]);
  t("blocked: several cleared keys on one job → ONE entry, first previous group in GROUP_ORDER", eq(multi.cleared, [{ name: "Micek Residence", group: "GC / builder" }]), JSON.stringify(multi.cleared));
  const gone = keyPrev(["GONE:Material", "need_old:Us (office owes the field)"]);
  t("blocked: job no longer live / synthetic need_ key → not cleared, no raw id printed", gone.cleared.length === 0 && !/GONE|need_/.test(JSON.stringify(gone.cleared)), JSON.stringify(gone.cleared));
  const unNeeds = [{ id: "u1", kind: "need", text: "Call the inspector", createdBy: "Louis Hoffman", createdAt: "2026-10-07T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" }];
  const un1 = S.blockedRows({ live, needs: unNeeds, users: f.users, prevBlockerKeys: null, today: w.today });
  const unRow = (un1.groups.find(x => x.name === "Us (office owes the field)") || { rows: [] }).rows.find(r => r.name === "(no job)");
  t("blocked: unattached need (no jobId, no jobName, 9d) → one Us row named (no job), key need_…", unRow && /Call the inspector/.test(unRow.what) && unRow.ageDays === 9 && un1.keys.some(k => k === "need_u1:Us (office owes the field)"), JSON.stringify(unRow) + JSON.stringify(un1.keys));
  const un2 = S.blockedRows({ live, needs: [{ ...unNeeds[0], status: "done" }, { id: "u2", kind: "need", text: "Another loose one", createdBy: "Louis Hoffman", createdAt: "2026-10-07T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" }], users: f.users, prevBlockerKeys: un1.keys, today: w.today });
  t("blocked: resolved unattached need is NOT cleared; the other unattached one still prints; no crash", !un2.cleared.some(c => /no job|u1/.test(c.name)) && un2.keys.includes("need_u2:Us (office owes the field)") && !un2.keys.includes("need_u1:Us (office owes the field)"), JSON.stringify(un2.cleared));
  const cnt = S.blockedRows({ live: [{ id: "CNT", name: "Count Test", roughStatus: "complete", finishStatus: "inprogress", finishPunch: { main: { general: [
    item({ waiting: true, waitingOn: "Waiting for fixture A" }), item({ waiting: true, waitingOn: "Waiting for fixture B" }), item({ waiting: true, waitingOn: "Waiting for fixture C" }), item({ waiting: true, waitingOn: "Waiting for cabinetry" })] } } }], needs: [], users: f.users, prevBlockerKeys: [], today: w.today });
  t("blocked: 3 Material items vs 1 GC item → lands under Material (summed item count, not entry count)", eq(cnt.keys, ["CNT:Material"]), JSON.stringify(cnt.keys));
  const undated = S.blockedRows({ live: [{ id: "UND", name: "Undated", roughStatus: "complete", finishStatus: "inprogress", changeOrders: [{ coStatus: "approved" }], returnTrips: [{ rtStatus: "needs" }] }], needs: [], users: f.users, prevBlockerKeys: [], today: w.today });
  const undRow = (undated.groups.find(x => x.name === "Sold work not on the calendar") || { rows: [] }).rows[0];
  t("blocked: CO with no createdAt + RT with no dates → row present, ageDays null", undRow && undRow.ageDays === null && /approved CO/.test(undRow.what) && /return trip/.test(undRow.what), JSON.stringify(undRow));
  const empty = S.blockedRows({ live: [], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  t("blocked: empty live + empty needs → empty result, no throw", eq(empty.groups, []) && eq(empty.cleared, []) && eq(empty.keys, []) && empty.total === 0, JSON.stringify(empty));
}

// ── Task 4: buildModel — coming, money, qc, last week, headline, state ───────
{
  const f = fixture({
    upcoming: [
      { id: "u1", name: "#3019 - Chapman Residence", customer: "E Builders", projectedStart: "10/27/2026", startConfirmed: false, sales: "Josh Cloward", lastFollowUp: "10/1/2026", notes: "framing" },
      { id: "u2", name: "Forth", customer: "", projectedStart: "11/17/2026", startConfirmed: true },
      { id: "u3", name: "Peterson", customer: "", projectedStart: "", notes: "waiting on Heber P&L drawings" },
      { id: "u4", name: "Oak Hill 5 - Alpine", projectedStart: "10/26/2026" },   // already a live job → not listed
    ],
    agentFindings: [
      { type: "folder_created", summary: "Hemsley plans filed", createdAt: "2026-10-13T10:00:00Z", day: "2026-10-13" },
      { type: "unmatched_plan", summary: "Plan not matched: Robert Brown", createdAt: "2026-10-14T10:00:00Z", day: "2026-10-14" },
      { type: "folder_created", summary: "Old", createdAt: "2026-10-01T10:00:00Z", day: "2026-10-01" },
    ],
    simproTotalsById: { "1419": { total: 53000, margin: 37.4, isEstimate: false }, "1302": { total: 0, margin: -5.0, isEstimate: false } },
    prevState: { blockerKeys: [], marginByJob: { HIDE: 1.8 }, dates: {}, userIds: [], weeks: [{ ymd: "2026-10-09", counts: { rtCreated: 2 } }, { ymd: "2026-10-02", counts: { rtCreated: 3 } }] },
  });
  f.jobs.push(
    { id: "WADE", name: "Wade Residence", simproNo: "694", foreman: "Colby Fogh", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", simproMargin: -6.0,
      changeOrders: [{ coStatus: "approved", createdAt: "2026-10-01T10:00:00Z", coStatusDate: "10/13/2026", quoteNumber: "3329", desc: "Car lift" }] },
    { id: "WEBB", name: "Webb", simproNo: "1304", foreman: "Gage Lund", roughStatus: "complete", finishStatus: "inprogress", finishStage: "98%",
      finalInspectionAttempts: [{ date: "2026-10-14", result: "pass" }], finishPunch: { main: { general: [{ text: "a", done: false }, { text: "b", done: true, checkedAtTs: "2026-10-13T12:00:00Z" }] } } },
    { id: "WOOD2", name: "Kweller", simproNo: "1107", finishStatus: "complete", finishStage: "100%", finishStatusDate: "10/13/2026" },
    { id: "PREP", name: "Cougar Moon Lot 84 - Kamas", simproNo: "1402", foreman: "Daegan Smith", roughStatus: "complete", finishStatus: "date_confirmed", finishProjectedStart: "11/2/2026", finishStartConfirmed: true, prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true },
      returnTrips: [{ rtStatus: "needs", createdAt: "2026-10-12T10:00:00Z", scope: "new" }] },
  );
  const m = S.buildModel(f);
  t("model: heading = the doc title", m.heading === "Friday Strategy Prep — Oct 16, 2026", m.heading);
  t("model: preLine names the window", /Mon 10\/19 – Fri 10\/23/.test(m.preLine) && /6:00 AM/.test(m.preLine), m.preLine);
  t("coming: Chapman week of 10/26, Cougar Moon (live, finish 11/2) week of 11/2, Forth week of 11/16; Peterson under no date; Oak Hill (live) excluded", (() => { const c = m.coming; const labels = c.weeks.map(w => `${w.label}:${w.rows.map(r => r.name).join(",")}`); return eq(labels, ["Week of 10/26:#3019 - Chapman Residence", "Week of 11/2:Cougar Moon Lot 84 - Kamas", "Week of 11/16:Forth"]) && c.noDate.length === 1 && c.noDate[0].name === "Peterson" && !JSON.stringify(c).includes("Oak Hill"); })(), JSON.stringify(m.coming.weeks));
  t("coming: Cougar Moon in prep inside 21 days? (11/2 is 17 days) → yes, 5/5", m.coming.prep.length === 1 && m.coming.prep[0].name.startsWith("Cougar Moon") && m.coming.prep[0].done === 5, JSON.stringify(m.coming.prep));
  t("coming: findings last 7 days = 2, oldest dropped", m.coming.findings.length === 2);
  t("coming: freeing = Hideout 95, Wade 95, Webb 98, Lot 208 RTI; starts in 2 weeks = Namjoshi, Riverton + Chapman 10/27", m.coming.freeing.length === 4 && m.coming.startsSoon === 3, JSON.stringify([m.coming.freeing.map(x => x.name), m.coming.startsSoon]));
  t("money: RTI = Lot 208 $53k idle 15d margin 37.4 (live wins)", (() => { const r = m.money.rti.rows[0]; return r && r.name.startsWith("Skyridge") && r.dollars === 53000 && r.idleDays === 15 && r.margin === 37.4 && r.flag === ""; })(), JSON.stringify(m.money.rti));
  t("money: margin watch = finishing not finished, not RTI, not invoiced, not entangled → Wade -6 (cached), Webb none, Hideout excluded (invoiced), Temp power excluded", (() => { const names = m.money.margin.rows.map(r => r.name); return eq(names, ["Wade Residence"]) && m.money.margin.rows[0].margin === -6; })(), JSON.stringify(m.money.margin.rows));
  t("money: movers need prev value; Hideout invoiced so not in watch → no movers", m.money.margin.movers.length === 0 && m.money.margin.firstRun === false);
  t("money: approved this week = Wade #3329 (10/9), none dated", m.money.approved.rows.length === 1 && m.money.approved.rows[0].quote === "3329" && m.money.approved.undated === 1, JSON.stringify(m.money.approved));
  t("qc: Lot 208 (needs, 3 punch → not small), Webb (final passed, no QC), Wade/Bulowski/Cowdrey at ≥90 without QC", (() => { const names = m.qc.rows.map(r => r.name); return names.includes("Skyridge Lot 208 - Mayflower") && names.includes("Webb") && names.includes("Wade Residence"); })(), JSON.stringify(m.qc.rows));
  t("qc: small tag when open punch ≤ 3", (() => { const w = m.qc.rows.find(r => r.name === "Webb"); return w && w.small === true; })());
  t("lastWeek: finished Kweller; inspections 1 passed; punch closed 1; approved COs 1", m.lastWeek.finished.includes("Kweller") && m.lastWeek.inspPassed === 1 && m.lastWeek.punchClosed === 1 && m.lastWeek.cosApproved === 1, JSON.stringify(m.lastWeek));
  t("lastWeek: rt 4-week average from state weeks = 2.5", m.lastWeek.rtAvg4 === 2.5, String(m.lastWeek.rtAvg4));
  t("headline: three lines, line 1 counts", m.headline.length === 3 && /jobs crewed/.test(m.headline[0]) && /nobody booked/.test(m.headline[0]) && /starts/.test(m.headline[0]), JSON.stringify(m.headline));
  t("headline: line 3 money", /\$53k ready to bill on 1 job/.test(m.headline[2]), m.headline[2]);
  t("nextState: blockerKeys, marginByJob, dates, userIds, weeks (cap 8), lastRunAt absent (orchestrator adds)", Array.isArray(m.nextState.blockerKeys) && m.nextState.marginByJob.WADE === -6 && m.nextState.dates["NAM:roughStart"] && m.nextState.userIds.length === f.users.length && m.nextState.weeks.length === 3 && m.nextState.weeks[0].ymd === "2026-10-16", JSON.stringify(Object.keys(m.nextState)));
  t("counts: every §4.3 bucket counted + between", typeof m.counts.booked === "number" && typeof m.counts.between === "number");
  const bad = S.buildModel({ ...f, jobs: null, scheduleEntries: "garbage", simproOk: false });
  t("degrade: null jobs → every section error string, model still returned", typeof bad.schedule.error === "string" && typeof bad.blocked.error === "string" && Array.isArray(bad.headline));
  const noSimpro = S.buildModel({ ...f, scheduleEntries: [], simproOk: false });
  t("degrade: simproOk false flags schedule.simproOk false", noSimpro.schedule.simproOk === false);
  t("recipients: admins + josh/brady/justin, never manager, deduped", (() => { const r = S.resolveRecipients([...f.users, { id: "jer", name: "Jeromy Cloward", access: "manager" }]); const n = r.map(x => x.user.name); return n.includes("Koy Wilkinson") && n.includes("Brady Nelson") && !n.includes("Jeromy Cloward") && new Set(n).size === n.length; })());
  t("collectSimproCandidates: RTI + finishing, trimmed, cap", (() => { const c = S.collectSimproCandidates(f.jobs); return c.includes("1419") && c.includes("694") && !c.includes("1444") && c.every(s => s === s.trim()); })(), JSON.stringify(S.collectSimproCandidates(f.jobs)));
}

// ── Task 4 review fixes ──────────────────────────────────────────────────────
{
  const mk = (jobs, over = {}) => S.buildModel(fixture({ jobs, ...over }));
  const rtWeeks = [1, 2, 3, 4, 50, 60].map((n, i) => ({ ymd: `2026-10-${String(9 - i).padStart(2, "0")}`, counts: { rtCreated: n } }));
  const m1 = mk([{ id: "A", name: "A", roughStatus: "inprogress", roughStage: "10%" }], { prevState: { blockerKeys: [], marginByJob: {}, dates: {}, userIds: [], weeks: rtWeeks } });
  t("fix1: rtAvg4 uses the NEWEST four prior weeks (1,2,3,4 → 2.5), not the oldest", m1.lastWeek.rtAvg4 === 2.5, String(m1.lastWeek.rtAvg4));
  const m1b = mk([{ id: "A", name: "A", roughStatus: "inprogress", roughStage: "10%" }], { prevState: { blockerKeys: [], marginByJob: {}, dates: {}, userIds: [], weeks: [{ ymd: "2026-10-16", counts: { rtCreated: 99 } }, ...rtWeeks] } });
  t("fix1: a stored row for today is ignored in the average", m1b.lastWeek.rtAvg4 === 2.5, String(m1b.lastWeek.rtAvg4));

  const pass = [{ date: "2026-10-14", result: "pass" }];
  const qj = (id, o) => ({ id, name: id, roughStatus: "complete", finishStatus: "inprogress", finishStage: "70%", finalInspectionAttempts: pass, ...o });
  const q2 = mk([qj("SCHED", { finishQcStatus: "scheduled" }), qj("FAILED", { qcStatus: "fail" }), qj("PLAIN", {}), qj("DONEQ", { qcStatus: "completed" })]).qc.rows;
  t("fix2: final passed + QC scheduled / completed → not listed", !q2.some(r => r.name === "SCHED" || r.name === "DONEQ"), JSON.stringify(q2));
  t("fix2: qcStatus fail → own row 'QC failed, re-walk after fixes'; plain passed final still 'final passed, no QC yet'", (q2.find(r => r.name === "FAILED") || {}).why === "QC failed, re-walk after fixes" && (q2.find(r => r.name === "PLAIN") || {}).why === "final passed, no QC yet", JSON.stringify(q2));

  const prepAll = { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true };
  const m3 = mk([{ id: "STALE", name: "Stale Rough Date", roughStatus: "complete", roughProjectedStart: "6/1/2026", finishStatus: "date_confirmed", finishProjectedStart: "11/2/2026", finishStartConfirmed: true, prepChecklist: prepAll }]);
  t("fix3: rough complete with stale rough date, finish 11/2 prep 5/5 → listed under prep", m3.coming.prep.length === 1 && m3.coming.prep[0].name === "Stale Rough Date" && m3.coming.prep[0].done === 5, JSON.stringify(m3.coming.prep));

  const m4 = mk([{ id: "DISM", name: "Dismissed RTI", roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", readyToInvoice: true, invoiceDismissed: true }, { id: "RTI2", name: "Live RTI", roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", readyToInvoice: true }]);
  t("fix4: ready-to-invoice + dismissed at finish 50% is NOT in freeing; undismissed RTI is", !m4.coming.freeing.some(x => x.name === "Dismissed RTI") && m4.coming.freeing.some(x => x.name === "Live RTI"), JSON.stringify(m4.coming.freeing));

  const m5 = mk([{ id: "A", name: "A", roughStatus: "inprogress", roughStage: "10%" }], { upcoming: [
    { id: "in1", name: "Pipeline In-Window", customer: "GC", projectedStart: "10/21/2026", startConfirmed: true },
    { id: "od1", name: "Pipeline Overdue", customer: "GC2", projectedStart: "9/30/2026" },
    { id: "a1", name: "A", projectedStart: "10/22/2026" },
  ] });
  const st5 = m5.schedule.starts.find(x => x.name === "Pipeline In-Window");
  t("fix5: upcoming row dated 10/21 → m.schedule.starts, pipeline true, di 2, jobId up_in1, no crew", st5 && st5.pipeline === true && st5.di === 2 && st5.jobId === "up_in1" && st5.crewBooked === false && st5.confirmed === true && eq(st5.missingRoles, ["foreman", "lead"]) && st5.prep.legacy === true, JSON.stringify(st5));
  t("fix5: upcoming row dated 9/30 → coming.overdue; a name matching a live job is neither", m5.coming.overdue.length === 1 && m5.coming.overdue[0].name === "Pipeline Overdue" && m5.coming.overdue[0].customer === "GC2" && !JSON.stringify(m5.coming.startsNextWeek).includes('"A"'), JSON.stringify(m5.coming.overdue));
  t("fix5: neither appears in coming.weeks / noDate; counted in counts.starts", !JSON.stringify(m5.coming.weeks).includes("Pipeline") && !JSON.stringify(m5.coming.noDate).includes("Pipeline") && m5.counts.starts === m5.schedule.starts.length && m5.counts.starts >= 1);

  let m6; let threw = false;
  try { m6 = S.buildModel(fixture({ prevState: { blockerKeys: ["K:Material"], marginByJob: { Z: 1 }, dates: { "NAM:roughProjectedStart": [null, 7, { d: "2026-10-09" }, { d: "2026-10-09", v: "2026-10-12" }], "RIV:roughProjectedStart": null }, userIds: ["koy"], weeks: [] } })); } catch (e) { threw = true; }
  t("fix6: poisoned prevState.dates (null, number, no-v entries) → whole model survives; bad entries dropped, today's value appended", !threw && m6.schedule.error === false && Array.isArray(m6.nextState.blockerKeys) && !m6.stateError && (() => { const h = m6.nextState.dates["NAM:roughStart"]; return h && h[h.length - 1].v === "2026-10-19" && h[h.length - 1].d === "2026-10-16" && h.every(e => e && typeof e.v === "string"); })(), threw ? "threw" : JSON.stringify(m6 && m6.nextState && m6.nextState.dates) + String(m6 && m6.schedule.error));
  t("fix6: the one valid history entry still drives a moved row (Namjoshi 10/12 → 10/19)", !threw && m6.schedule.moved.some(r => /Namjoshi/.test(r.name) && r.from === "10/12" && r.to === "10/19"), JSON.stringify(m6 && m6.schedule.moved));
  const m6b = S.buildModel(fixture({ jobs: null, notesDoc: null, prevState: { blockerKeys: ["K:Material"], marginByJob: {}, dates: {}, userIds: [], weeks: [] } }));
  t("fix6: missing jobs array → carried section still produced, nextState = prev fallback (not null)", m6b.carried && m6b.carried.error === false && m6b.nextState && eq(m6b.nextState.blockerKeys, ["K:Material"]));
  t("fix6: missing jobs and no prev → nextState null", S.buildModel(fixture({ jobs: null })).nextState === null);

  const many = Array.from({ length: 12 }, (_, i) => ({ id: "Q" + i, name: i < 3 ? `Zeta ${i}` : `Alpha ${i}`, roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", ...(i < 3 ? { qcStatus: "needs" } : {}) }));
  const q7 = mk(many).qc;
  t("fix7: 12 candidates, cap 10 → every 'QC needs' row kept, first in order", q7.rows.length === 10 && q7.more === 2 && q7.rows.slice(0, 3).every(r => r.why === "QC needs") && q7.rows.filter(r => r.why === "QC needs").length === 3, JSON.stringify(q7.rows.map(r => r.name + ":" + r.why)));
}

// ── Task 5: notes-doc parser + renderer ─────────────────────────────────────
{
  // Minimal Docs JSON in the shape Google's meeting-notes template produces (checked 2026-10-15: H2 date headings, bullets with nestingLevel, strikethrough on done items).
  const para = (text, o = {}) => ({ paragraph: { elements: [{ textRun: { content: text + "\n", textStyle: o.struck ? { strikethrough: true } : {} } }], paragraphStyle: { namedStyleType: o.style || "NORMAL_TEXT" }, ...(o.bullet ? { bullet: { nestingLevel: o.nest || 0 } } : {}) } });
  const doc = { body: { content: [
    para("Meeting Notes", { style: "HEADING_1" }),
    // OUR OWN section for today must be skipped as a source (Review Focus 4).
    para("Oct 16, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }), para("Attendees: Koy"), para("Carried from Oct 9", { style: "HEADING_3" }), para("Rose — still haven't heard from Austin", { bullet: true }),
    para("Oct 9, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }),
    para("Attendees: Justin Cloward Brady Nelson Joshua Cloward Koy Wilkinson"),
    para("Notes"),
    para("Cox overhead temp - Before thursday.", { bullet: true, struck: true }), para("Tuesday Treycen", { bullet: true, nest: 1 }),   // child of a struck item → dropped
    para("Rose", { bullet: true }), para("Still havent heard from austin", { bullet: true, nest: 1 }),
    para("Ashcraft", { bullet: true }), para("Any update?", { bullet: true, nest: 1 }),
    para("Ready to invoice"),
    para("Koplin", { bullet: true }),                                              // not Notes/General/Action → ignored
    para("QCs needed"), para("", { bullet: true }),
    para("Action items"), para("Call Edge about Pierce", { bullet: true }), para("Order spider box", { bullet: true, struck: true }),
    para("Oct 2, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }),
    para("Notes"), para("Rose", { bullet: true }), para("Pierce - Need Update from Colby", { bullet: true }),
    para("Action items"), para("Call Edge about Pierce", { bullet: true }),
  ] } };
  const meeting = new Date(2026, 9, 16, 12, 0, 0);
  const c = S.parseNotesCarry(doc, meeting);
  t("carry: source section is Oct 9 (not our own Oct 16 one)", c.fromLabel === "Oct 9, 2026", c.fromLabel);
  const texts = c.rows.map(r => r.text);
  t("carry: struck item and its child dropped; parent + child of open items kept as one line", eq(texts, ["Rose — Still havent heard from austin", "Ashcraft — Any update?", "Call Edge about Pierce"]), JSON.stringify(texts));
  // M3 (final wave): a substring match needs both texts 12+ chars, so last week's bare "Rose" no longer counts toward
  // "Rose — Still havent heard from austin" (it used to: weeks 2). The exact-text Pierce action item still counts.
  t("carry: weeks counted across earlier sections (Rose 1 under M3, Ashcraft 1, Pierce action 2)", eq(c.rows.map(r => r.weeks), [1, 1, 2]), JSON.stringify(c.rows.map(r => r.weeks)));
  t("carry: null doc → empty, no throw", S.parseNotesCarry(null, meeting).rows.length === 0);
  t("carry: cap", S.parseNotesCarry({ body: { content: [para("Oct 9, 2026 | X", { style: "HEADING_2" }), para("Notes"), ...Array.from({ length: 30 }, (_, i) => para("row " + i, { bullet: true }))] } }, meeting).rows.length === 20);

  const m = S.buildModel(fixture({ notesDoc: doc }));
  const lines = S.renderLines(m);
  const txt = lines.map(l => l.text);
  t("render: body starts with the grey pre-line, then the headline; no H2 heading, no attendee line", lines[0].kind === "grey" && /pre-filled/.test(lines[0].text) && lines[1].kind === "p" && !lines.some(l => l.kind === "h2") && !txt.some(s => /^Attendees/.test(s)));
  t("render: section headings in meeting order", (() => { const h = lines.filter(l => l.kind === "h3").map(l => l.text.replace(/ [·—].*$/, "")); return eq(h, ["Carried from Oct 9", "Schedule next week", "Blocked", "Coming up", "Money", "QC to schedule", "Last week", "Action items"]); })(), JSON.stringify(lines.filter(l => l.kind === "h3").map(l => l.text)));
  t("render: Namjoshi start row says nobody booked and where the lead is", txt.some(s => /Namjoshi.*rough starts Mon 10\/19.*confirmed.*nobody booked.*lead Treycen Rollene is at The Hideout Mon/.test(s)), txt.filter(s => /Namjoshi/.test(s)).join(" | "));
  t("render: Lot 208 under nobody booked with reasons", txt.some(s => /Skyridge Lot 208.*rough 80%.*ready to invoice 15d.*QC needs.*3 punch.*GC \/ builder/.test(s)), txt.filter(s => /Skyridge/.test(s)).join(" | "));
  t("render: Simpro job unknown to the app printed, not dropped", txt.some(s => /Simpro #9999 \(not in app\).*Zane Watkins/.test(s)));
  t("render: no emoji / non-BMP", lines.every(l => !/[\u{10000}-\u{10FFFF}]/u.test(l.text)));
  t("render: every bullet line is 'bullet' or 'check'; blank check line closes each list", lines.filter(l => l.kind === "check").length >= 6);
  t("render: Micek (between, no date) is NOT printed", !txt.some(s => /Micek/.test(s)));
  const reqs = S.docsRequests(lines, 1);
  t("docsRequests: first is insertText at 1, rest styles/bullets", reqs[0].insertText && reqs[0].insertText.location.index === 1 && reqs.length > 10);
  const err = S.renderLines({ ...m, schedule: { error: "Section unavailable this week: boom" } });
  t("render: a failed section prints its one grey line and the rest still renders", err.some(l => l.kind === "grey" && /boom/.test(l.text)) && err.some(l => l.text === "Money"));

  // Round-review model fields (items 1-4, 7): each has its rendered form.
  const mk5 = (over) => S.buildModel(fixture({ upcoming: [
    { id: "in1", name: "Pipeline In-Window", customer: "GC", projectedStart: "10/21/2026", startConfirmed: true },
    { id: "od1", name: "Pipeline Overdue", customer: "GC2", projectedStart: "9/30/2026" },
    { id: "od2", name: "Pipeline Older", customer: "GC3", projectedStart: "10/5/2026" },
  ], ...over }));
  const m5 = mk5({});
  const t5 = S.renderLines(m5).map(l => l.text);
  const up = S.renderLines(m5).find(l => /Pipeline In-Window/.test(l.text) && /^UPCOMING/.test(l.text));
  t("render: pipeline start → 'UPCOMING <name> — rough starts Wed 10/21 confirmed · not in the app yet · nobody booked', no roles/prep tail, amber tag span", !!up && up.text === "UPCOMING Pipeline In-Window — rough starts Wed 10/21 confirmed · not in the app yet · nobody booked" && up.spans.length === 1 && up.spans[0].start === 0 && up.spans[0].len === 8, up && up.text);
  t("render: overdue pipeline rows → one 'Projected start passed, still in Upcoming' bullet", t5.filter(s => /^Projected start passed, still in Upcoming: /.test(s)).length === 1 && t5.some(s => s === "Projected start passed, still in Upcoming: Pipeline Overdue 9/30, Pipeline Older 10/5") && !t5.some(s => /Pipeline In-Window/.test(s) && /Projected start passed/.test(s)), t5.filter(s => /Projected start/.test(s)).join(" | "));
  t("render: no overdue bullet when none overdue", !txt.some(s => /Projected start passed/.test(s)));

  const mAmb = S.buildModel(fixture({ notesDoc: doc }));
  mAmb.schedule.calendar = [{ di: 1, label: "Site walk", name: "Dup Job", who: "Koy", ambiguous: true }, { di: 2, label: "Meeting", name: "Solo Job", who: "", ambiguous: false }];
  const tAmb = S.renderLines(mAmb).map(l => l.text);
  t("render: ambiguous calendar row gets the '(name match — check which job)' suffix; unambiguous row does not", tAmb.includes("Tue — Site walk · Dup Job · Koy (name match — check which job)") && tAmb.includes("Wed — Meeting · Solo Job"), tAmb.filter(s => /Dup Job|Solo Job/.test(s)).join(" | "));

  const mMv = S.buildModel(fixture({ notesDoc: doc }));
  mMv.schedule.moved = [{ name: "Cleared Job", label: "rough start", from: "10/12", to: "no date", nth: 2 }, { name: "Slid Job", label: "rough start", from: "10/12", to: "10/19", nth: 3 }];
  const tMv = S.renderLines(mMv).map(l => l.text);
  t("render: moved-to-no-date prints '→ no date (cleared)'; a normal move keeps its date and ordinal", tMv.includes("Cleared Job — rough start 10/12 → no date (cleared)") && tMv.includes("Slid Job — rough start 10/12 → 10/19 (3rd date)"), tMv.filter(s => /Cleared Job|Slid Job/.test(s)).join(" | "));

  const mSe = S.buildModel(fixture({ notesDoc: doc })); mSe.stateError = "boom state";
  const lSe = S.renderLines(mSe), iSe = lSe.findIndex(l => l.text === "State snapshot not updated this run: boom state"), iAct = lSe.findIndex(l => l.kind === "h3" && l.text === "Action items");
  t("render: stateError → one grey line directly before the Action items heading; absent otherwise", iSe >= 0 && lSe[iSe].kind === "grey" && iAct === iSe + 1 && !txt.some(s => /State snapshot not updated/.test(s)), String(iSe) + "/" + String(iAct));
}

// ── Task 5 review fixes ──────────────────────────────────────────────────────
{
  const para = (text, o = {}) => ({ paragraph: { elements: [{ textRun: { content: text + "\n", textStyle: {} } }], paragraphStyle: { namedStyleType: o.style || "NORMAL_TEXT" }, ...(o.bullet ? { bullet: { nestingLevel: o.nest || 0 } } : {}) } });
  const H = (d) => para(`${d} | Weekly Strategy/Scheduling Meeting`, { style: "HEADING_2" });
  const meeting = new Date(2026, 9, 16, 12, 0, 0);
  // Last Friday's section holds the Carried list OUR renderer wrote (with its "(carried N wks)" tag); older sections hold the plain item.
  const doc = { body: { content: [
    H("Oct 9, 2026"), para("Carried from Oct 2", { style: "HEADING_3" }), para("Rose — still waiting (carried 2 wks)", { bullet: true }), para("Child note (carried 1 wk)", { bullet: true, nest: 1 }),
    H("Oct 2, 2026"), para("Notes"), para("Rose — still waiting", { bullet: true }),
    H("Sep 25, 2026"), para("Notes"), para("Rose — still waiting", { bullet: true }),
  ] } };
  const c = S.parseNotesCarry(doc, meeting);
  t("review1: own '(carried N wks)' suffix stripped from parent and child; weeks keep counting", eq(c.rows, [{ text: "Rose — still waiting — Child note", weeks: 3 }]), JSON.stringify(c.rows));
  const doc2 = { body: { content: [H("Oct 9, 2026"), para("Carried from Oct 2", { style: "HEADING_3" }), para("Rose — still waiting (carried 2 wks)", { bullet: true }), H("Oct 2, 2026"), para("Notes"), para("Rose — still waiting", { bullet: true }), H("Sep 25, 2026"), para("Notes"), para("Rose — still waiting", { bullet: true })] } };
  const c2 = S.parseNotesCarry(doc2, meeting);
  t("review1: row text exactly 'Rose — still waiting', weeks 3", c2.rows.length === 1 && c2.rows[0].text === "Rose — still waiting" && c2.rows[0].weeks === 3, JSON.stringify(c2.rows));
  const l2 = S.renderLines(S.buildModel(fixture({ notesDoc: doc2 }))).map(l => l.text).filter(x => /^Rose — still waiting/.test(x));
  t("review1: rendered line carries the tag exactly once, ends '(carried 3 wks)'", l2.length === 1 && l2[0] === "Rose — still waiting (carried 3 wks)", JSON.stringify(l2));

  t("review2: meetingDate not a Date → empty result, no throw, no clock read", (() => { try { const r = S.parseNotesCarry(doc2, undefined); return r.error === false && r.fromLabel === "" && r.rows.length === 0; } catch (e) { return false; } })());

  const mBad = S.buildModel(fixture());
  mBad.schedule.starts = [{ jobId: "X", name: "Broken Row", phase: "rough", pct: 0, foreman: "", lead: "", date: new Date(2026, 9, 19), di: 0, confirmed: true, crewBooked: false, missingRoles: [], atRisk: true, prep: undefined, elsewhere: undefined }];
  let bad = null, threw = false; try { bad = S.renderLines(mBad); } catch (e) { threw = true; }
  const bt = bad ? bad.map(l => l.text) : [];
  t("review3: malformed start row → schedule prints heading + one grey 'could not be rendered'; Money and Action items still render", !threw && bad.some(l => l.kind === "grey" && /could not be rendered/.test(l.text)) && bad.some(l => l.kind === "h3" && /^Schedule next week/.test(l.text)) && bt.includes("Money") && bt.includes("Action items") && bt.filter(x => /could not be rendered/.test(x)).length === 1 && !bt.some(x => /Broken Row/.test(x)), bt.filter(x => /rendered|Schedule/.test(x)).join(" | "));
}

// ── Final fix wave: CRITICAL (C1–C3) ─────────────────────────────────────────
{
  const HINT = "Couldn't read Josh's notes doc. Share it (Viewer) with homestead-electric@appspot.gserviceaccount.com to get carry-forward.";
  // C1 — a failed notes-doc read must say so, never "Nothing carried."
  const mErr = S.buildModel(fixture({ notesDoc: null, notesError: HINT }));
  const tErr = S.renderLines(mErr).map(l => l.text);
  t("C1: notesError → carried.error is the share hint, no rows", mErr.carried.error === HINT && mErr.carried.rows.length === 0 && mErr.carried.fromLabel === "", JSON.stringify(mErr.carried));
  t("C1: render prints the hint line and never 'Nothing carried.'", tErr.includes(HINT) && !tErr.includes("Nothing carried."), tErr.slice(0, 8).join(" | "));
  t("C1: the hint constant is exported for the orchestrator", S.NOTES_READ_HINT === HINT);
  const mOk = S.buildModel(fixture({ notesDoc: null }));
  t("C1: no error + no doc → still 'Nothing carried.'", S.renderLines(mOk).some(l => l.text === "Nothing carried.") && mOk.carried.error === false);

  // C2 — start dates follow the app: scheduled/inprogress → StatusDate || ProjectedStart; else ProjectedStart || StatusDate.
  const prepAll = { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true };
  const c2Jobs = [
    { id: "SCH", name: "Status Dated", foreman: "Daegan Smith", lead: "Treycen Rollene", roughStatus: "scheduled", roughStatusDate: "10/21/2026", prepChecklist: prepAll },
    { id: "SCH2", name: "Scheduled Beats Projected", roughStatus: "scheduled", roughStatusDate: "10/20/2026", roughProjectedStart: "10/12/2026" },
    { id: "WD", name: "Waiting Date Projected Wins", roughStatus: "waiting_date", roughProjectedStart: "10/22/2026", roughStatusDate: "9/1/2026" },
    { id: "LATER", name: "Confirmed Three Weeks Out", roughStatus: "complete", finishStatus: "date_confirmed", finishProjectedStart: "11/6/2026", finishStartConfirmed: true },
    { id: "IDLS", name: "Scheduled No Date", roughStatus: "complete", finishStatus: "scheduled" },
    { id: "PREPS", name: "Finish Scheduled By Status Date", roughStatus: "complete", finishStatus: "scheduled", finishStatusDate: "10/30/2026", prepChecklist: prepAll },
  ];
  const f2 = fixture(); f2.jobs.push(...c2Jobs);
  const m2 = S.buildModel(f2), s2 = m2.schedule;
  const st = (id) => s2.starts.find(r => r.jobId === id);
  t("C2: scheduled, no projected start, status date 10/21 inside the window → Starts, confirmed, Wed", !!st("SCH") && st("SCH").confirmed === true && st("SCH").di === 2 && !st("SCH").overdue, JSON.stringify(st("SCH")));
  t("C2: scheduled → status date (10/20) beats a stale projected start (10/12)", !!st("SCH2") && st("SCH2").di === 1 && !st("SCH2").overdue, JSON.stringify(st("SCH2")));
  t("C2: waiting_date → projected start (10/22) beats the status date (9/1)", !!st("WD") && st("WD").di === 3, JSON.stringify(st("WD")));
  t("C2/F1: confirmed finish start three weeks out → later, not idle", s2.later.some(r => r.jobId === "LATER") && !s2.idle.some(r => r.jobId === "LATER") && m2.counts.later >= 1, JSON.stringify({ later: s2.later, idle: s2.idle.map(r => r.jobId) }));
  t("C2/F1: the later job still shows under Coming up (week of 11/2)", m2.coming.weeks.some(w => w.label === "Week of 11/2" && w.rows.some(r => r.name === "Confirmed Three Weeks Out")), JSON.stringify(m2.coming.weeks.map(w => [w.label, w.rows.map(r => r.name)])));
  t("C2: finish scheduled by status date 10/30 → Coming up week of 10/26 and In prep", m2.coming.weeks.some(w => w.label === "Week of 10/26" && w.rows.some(r => r.name === "Finish Scheduled By Status Date")) && m2.coming.prep.some(r => r.name === "Finish Scheduled By Status Date"), JSON.stringify([m2.coming.weeks, m2.coming.prep]));
  const lines2 = S.renderLines(m2).map(l => l.text);
  const idl = lines2.find(x => /Scheduled No Date/.test(x));
  t("C2: idle row for a not-in-progress status prints the status, not N%", s2.idle.some(r => r.jobId === "IDLS") && !!idl && /finish scheduled, no date/.test(idl) && !/finish 0%/.test(idl), idl);
  const k2 = S.dateKeys(S.liveJobs(f2.jobs));
  t("C2: dateKeys keys the resolved start as <id>:<phase>Start", k2["SCH:roughStart"] === "2026-10-21" && k2["SCH2:roughStart"] === "2026-10-20" && k2["WD:roughStart"] === "2026-10-22" && !("SCH:roughProjectedStart" in k2) && !("L208:roughStart" in k2), JSON.stringify(k2));
  const mv2 = S.movedDates(S.liveJobs(f2.jobs), { "SCH:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-14" }] }, S.weekOf(NOW).today);
  t("C2: history under the OLD key name still drives a moved row (10/14 → 10/21)", mv2.rows.some(r => r.name === "Status Dated" && r.label === "rough start" && r.from === "10/14" && r.to === "10/21"), JSON.stringify(mv2.rows));
  const live2 = S.liveJobs(f2.jobs), all2 = [...s2.booked, ...s2.idle, ...s2.starts.filter(r => !r.pipeline), ...s2.onHold, ...s2.between, ...s2.later].map(r => r.jobId);
  t("C2: every live job lands in exactly one bucket (with later)", all2.length === live2.length && new Set(all2).size === live2.length, JSON.stringify(all2));

  // C3 — a past-dated start is an OVERDUE start, not a silent "between".
  const f3 = fixture();
  f3.jobs.push({ id: "HIGH", name: "Hightower Remodel", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "8/13/2026" },
    { id: "NS", name: "Nothing Started", roughStatus: "waiting_date" },
    { id: "INSP", name: "Old Final", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finalInspectionTargetDate: "5/20/2026" });
  const m3 = S.buildModel(f3), s3 = m3.schedule;
  const hi = s3.starts.find(r => r.jobId === "HIGH");
  t("C3: Hightower (rough complete, finish waiting_date, start 8/13) → Starts with overdue:true", !!hi && hi.overdue === true && hi.phase === "finish" && S.ymd(hi.date) === "2026-08-13" && hi.atRisk === true, JSON.stringify(hi));
  t("C3: Hightower is not between and has no DATE PASSED start row", !s3.between.some(r => r.jobId === "HIGH") && !s3.passed.some(r => r.name === "Hightower Remodel"), JSON.stringify([s3.between, s3.passed]));
  t("C3: between is exactly rough-complete-no-finish-date + nothing-started-no-date", eq(s3.between.map(r => `${r.jobId}:${r.kind}`).sort(), ["MIC:between", "NS:notStarted"]), JSON.stringify(s3.between));
  t("C3: inspection DATE PASSED rows are kept", s3.passed.some(r => r.name === "Old Final" && r.label === "final inspection"), JSON.stringify(s3.passed));
  const t3 = S.renderLines(m3);
  const ov = t3.find(l => /^OVERDUE Hightower/.test(l.text));
  t("C3: render 'OVERDUE Hightower Remodel — finish start was 8/13 (64d) · nobody booked · no lead · prep 0/5 …' with an amber tag", !!ov && /^OVERDUE Hightower Remodel — finish start was 8\/13 \(64d\) · nobody booked · no lead · prep 0\/5/.test(ov.text) && ov.spans[0].len === 7 && eq(ov.spans[0].rgb, [0.71, 0.33, 0.1]), ov && ov.text);
}

// ── Final fix wave: IMPORTANT (I1–I11) ───────────────────────────────────────
{
  const w = S.weekOf(NOW);
  const item = (o) => ({ text: "item", done: false, voided: false, ...o });
  // I1 — absolute instants read as Mountain wall-clock; date-only strings stay as written.
  t("I1: process runs in UTC (harness proves production)", new Date(0).getTimezoneOffset() === 0);
  t("I1: an evening MT stamp stays on its MT day", S.ymd(S.toDateAny("2026-10-12T23:30:00-06:00")) === "2026-10-12", S.ymd(S.toDateAny("2026-10-12T23:30:00-06:00")));
  t("I1: a Firestore Timestamp at 23:30 MT stays on its MT day", S.ymd(S.toDateAny({ seconds: Date.parse("2026-10-13T05:30:00Z") / 1000 })) === "2026-10-12" && S.ymd(S.toDateAny({ toDate: () => new Date("2026-10-13T05:30:00Z") })) === "2026-10-12");
  t("I1: an epoch-ms id at 23:30 MT stays on its MT day", S.ymd(S.toDateAny(String(Date.parse("2026-10-13T05:30:00Z")))) === "2026-10-12");
  t("I1: date-only strings are not shifted", S.ymd(S.toDateAny("2026-10-12")) === "2026-10-12" && S.ymd(S.toDateAny("10/12/2026")) === "2026-10-12");

  // I2 — On hold is additive: an on-hold job keeps its On hold row AND its waiting row.
  const holdJobs = [
    { id: "HG", name: "Hold With GC Waits", roughStatus: "complete", finishStatus: "waiting", finishStage: "40%", finishPunch: { main: { general: [item({ waiting: true, waitingOn: "Framing" }), item({ waiting: true, waitingOn: "Drywall" })] } } },
    { id: "HR", name: "Rough Hold Finish Scheduled", roughStatus: "waiting", finishStatus: "scheduled" },
    { id: "HP", name: "Plain Hold", roughStatus: "waiting" },
  ];
  const b2 = S.blockedRows({ live: holdJobs, needs: [], users: [], prevBlockerKeys: [], today: w.today });
  const inG = (b, g, id) => ((b.groups.find(x => x.name === g) || { rows: [] }).rows).some(r => r.jobId === id);
  t("I2: on-hold job with GC waits → a row under On hold AND under GC / builder", inG(b2, "On hold", "HG") && inG(b2, "GC / builder", "HG"), JSON.stringify(b2.groups.map(g => [g.name, g.rows.map(r => r.jobId)])));
  t("I2: byGroup['On hold'] equals the number of on-hold live jobs (3)", b2.byGroup["On hold"] === 3, JSON.stringify(b2.byGroup));

  // I3 — each question buckets by its own text; a question leaves Homeowner / designer only when it names a party.
  const qj = { id: "QJ", name: "Question Job", roughStatus: "inprogress", roughStage: "40%", roughQuestions: { main: [
    ...["Cabinet plans?", "Ceiling height in the den?", "Which chandelier?", "Pendant location?", "Island outlet?"].map((q, i) => ({ question: q, answer: "", addedAt: `2026-10-0${i + 1}T12:00:00Z` })),
    { question: "ask the GC about framing", answer: "", addedAt: "2026-10-08T12:00:00Z" }] } };
  const b3 = S.blockedRows({ live: [qj], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  t("I3: 5 homeowner-ish questions + 1 'ask the GC about framing' → Homeowner / designer wins (5 vs 1)", eq(b3.keys, ["QJ:Homeowner / designer"]) && /5 questions/.test(b3.groups[0].rows[0].what) && /1 question unanswered/.test(b3.groups[0].rows[0].what), JSON.stringify(b3.groups));
  const wj = { id: "WJ", name: "Blank Reason Job", roughStatus: "inprogress", roughStage: "40%", roughPunch: { main: { general: [item({ waiting: true, waitingOn: "", text: "Waiting on cabinets" })] } } };
  const b3b = S.blockedRows({ live: [wj], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  t("I3: a waiting item with blank waitingOn buckets by its text ('Waiting on cabinets' → GC / builder)", eq(b3b.keys, ["WJ:GC / builder"]), JSON.stringify(b3b.keys));

  // I4 — approved-open COs: approved and not converted; dated = needsByStart or a linked RT with a date.
  const coJob = { id: "COJ", name: "CO Job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "60%",
    changeOrders: [
      { id: "c1", coStatus: "approved", createdAt: "2026-05-11T10:00:00Z", desc: "Dimmers", needsByStart: "2026-11-02", coStatusDate: "10/13/2026" },
      { id: "c2", coStatus: "approved", createdAt: "2026-05-12T10:00:00Z", desc: "Tape light" },
      { id: "c3", coStatus: "approved", createdAt: "2026-04-01T10:00:00Z", desc: "Converted one", coStatusDate: "10/14/2026" },
      { id: "c4", coStatus: "converted", createdAt: "2026-04-01T10:00:00Z", desc: "Status converted" }],
    returnTrips: [{ id: "r1", fromCOId: "c3", rtStatus: "scheduled", rtStatusDate: "10/28/2026" }] };
  const b4 = S.blockedRows({ live: [coJob], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  const sold = ((b4.groups.find(x => x.name === "Sold work not on the calendar") || { rows: [] }).rows)[0];
  t("I4: converted COs (via RT, or status converted) are excluded; row '2 approved COs, not done · needed by 11/2'", !!sold && /^2 approved COs, not done · needed by 11\/2$/.test(sold.what) && sold.ageDays === 158, JSON.stringify(sold));
  const m4 = S.buildModel(fixture({ jobs: [coJob] }));
  const ap = m4.money.approved;
  t("I4: Approved this week — needsByStart CO counts as dated; RT-linked CO with an rtStatusDate counts as dated", ap.count === 2 && ap.undated === 0 && ap.rows.every(r => r.dated === true), JSON.stringify(ap));
  t("I4: no CO reads the nonexistent scheduledDate field", !/co\.scheduledDate|CO_OPEN_APPROVED/.test(require("fs").readFileSync(require.resolve("../functions/strategyPrep.js"), "utf8")));

  // I5 — the Us rule.
  const NEED = (o) => ({ kind: "need", status: "open", createdAt: "2026-10-05T15:00:00Z", jobId: "OAK", jobName: "Oak Hill 5 - Alpine", ...o });
  const usOf = (needs) => S.blockedRows({ live: S.liveJobs(fixture().jobs), needs, users: fixture().users, prevBlockerKeys: [], today: w.today, now: new Date(2026, 9, 16, 6, 0, 0) });
  const usRows = (b) => ((b.groups.find(x => x.name === "Us (office owes the field)") || { rows: [] }).rows);
  const b5 = usOf([
    NEED({ id: "k1", text: "Koy self to-do", createdBy: "Koy Wilkinson", assignedTo: "Koy Wilkinson" }),
    NEED({ id: "k2", text: "Time off doc", createdBy: "Louis Hoffman", assignedTo: "Koy Wilkinson", timeoffId: "to1" }),
    NEED({ id: "k3", text: "Louis needs redlines", createdBy: "Louis Hoffman", assignedTo: "Koy Wilkinson" }),
    NEED({ id: "k4", text: "Snoozed ask", createdBy: "Louis Hoffman", assignedTo: "Koy Wilkinson", snoozedUntil: "2026-10-20" }),
    NEED({ id: "k5", text: "Coordinator fallback", createdBy: "Keegan Wilkinson", assignedTo: "", coordinator: "Josh Cloward" }),
    NEED({ id: "k6", text: "Assigned by field", assignedBy: "Treycen Rollene", createdBy: "Koy Wilkinson", assignedTo: "Brady Nelson" }),
  ]);
  const u5 = usRows(b5).map(r => r.what).join(" | ");
  t("I5: Koy-created Koy-assigned need → excluded", !/Koy self/.test(u5), u5);
  t("I5: timeoffId doc → excluded; snoozed need → excluded", !/Time off doc|Snoozed ask/.test(u5), u5);
  t("I5: Louis→Koy need open 11d → included, credited to Louis", usRows(b5).some(r => /Louis needs redlines \(Louis\)/.test(r.what) && r.ageDays === 11 && r.who === "Koy"), u5);
  t("I5: assignee falls back to coordinator; requester = assignedBy || createdBy", /Coordinator fallback \(Keegan\)/.test(u5) && /Assigned by field \(Treycen\)/.test(u5), u5);
  // M6 rides with I5: the resi.head hat holder counts as office.
  const b6 = S.blockedRows({ live: [], needs: [NEED({ id: "h1", jobId: "", jobName: "", text: "Head owes this", createdBy: "Louis Hoffman", assignedTo: "Casey Hatholder" })],
    users: [{ id: "casey", name: "Casey Hatholder", caps: { "resi.head": true } }], prevBlockerKeys: [], today: w.today, now: new Date(2026, 9, 16, 6, 0, 0) });
  t("M6: a need assigned to the resi.head hat holder counts as office-owed", usRows(b6).some(r => /Head owes this/.test(r.what)), JSON.stringify(b6.groups));

  // I6 — margin denominator.
  const fj = (id, m) => ({ id, name: id, simproNo: id === "F1" ? "501" : "", roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", ...(m != null ? { simproMargin: m } : {}) });
  const m6 = S.buildModel(fixture({ jobs: [fj("F1", 12), fj("F2", null), fj("F3", null)] }));
  t("I6: moneyRows reports finishingCount before the margin filter", m6.money.margin.finishingCount === 3 && m6.money.margin.count === 1, JSON.stringify(m6.money.margin));
  t("I6: render 'Median 12% across 1 of 3 finishing jobs (2 have no Simpro margin)'", S.renderLines(m6).some(l => /^Median 12% across 1 of 3 finishing jobs \(2 have no Simpro margin\) · target 15% · 1 under$/.test(l.text)), S.renderLines(m6).filter(l => /^Median/.test(l.text)).map(l => l.text).join());

  // I7 — "Crews freeing up" relabelled.
  const t7 = S.renderLines(S.buildModel(fixture())).map(l => l.text);
  t("I7: 'Near done (finish ≥ 90% or ready to invoice): …' replaces 'Crews freeing up'", t7.some(x => /^Near done \(finish ≥ 90% or ready to invoice\): /.test(x)) && !t7.some(x => /Crews freeing up/.test(x)));

  // I8 — return-trip keys on rt.id.
  const rtJob = (rts) => ({ id: "RTJ", name: "RT Job", roughStatus: "inprogress", roughStage: "20%", returnTrips: rts });
  const A = { id: "a", rtStatus: "scheduled", rtStatusDate: "10/20/2026" }, B = { id: "b", rtStatus: "scheduled", rtStatusDate: "10/27/2026" };
  t("I8: return trips key as <jobId>:rt:<rt.id>", eq(Object.keys(S.dateKeys([rtJob([A, B])])).sort(), ["RTJ:rt:a", "RTJ:rt:b"]), JSON.stringify(S.dateKeys([rtJob([A, B])])));
  const prev8 = S.nextDates([rtJob([A, B])], null, "2026-10-09");
  const mv8 = S.movedDates([rtJob([B])], prev8, w.today);
  t("I8: deleting the earlier return trip produces no false moved / cleared row", mv8.rows.length === 0, JSON.stringify(mv8.rows));
  const mv8b = S.movedDates([rtJob([B])], { "RTJ:rt:0": [{ d: "2026-10-09", v: "2026-10-20" }] }, w.today);
  t("I8: a legacy index key whose trip now has an id is not reported as cleared", mv8b.rows.length === 0, JSON.stringify(mv8b.rows));

  // I9 — a Simpro booking on a job the app has finished.
  const f9 = fixture(); f9.jobs.find(j => j.id === "DONE").simproNo = "1111";
  f9.scheduleEntries.push({ Type: "job", Date: "2026-10-20", Project: { ProjectID: 1111 }, Staff: { Name: "Zane Watkins" } });
  const t9 = S.renderLines(S.buildModel(f9)).map(l => l.text);
  t("I9: 'Simpro #1111 Wood (finished in app) · Tue · Zane Watkins'; unknown 9999 still '(not in app)'", t9.includes("Simpro #1111 Wood (finished in app) · Tue · Zane Watkins") && t9.some(x => /^Simpro #9999 \(not in app\)/.test(x)), t9.filter(x => /^Simpro #/.test(x)).join(" | "));

  // I10 — headline risk counts at-risk starts only; crew unknown when Simpro and the planner are both missing.
  const WED = new Date("2026-10-14T12:00:00Z");   // Wed 6 AM MT: Fri 10/23 is 9 days out → not at risk
  const f10 = fixture({ now: WED }); f10.jobs.find(j => j.id === "RIV").roughProjectedStart = "10/23/2026";
  const m10 = S.buildModel(f10);
  t("I10: headline line 1 counts at-risk starts, not every start ('2 starts, 1 at risk')", /2 starts, 1 at risk\./.test(m10.headline[0]), m10.headline[0]);
  const m10b = S.buildModel(fixture({ scheduleEntries: [], simproOk: false, plannerDoc: null }));
  const t10b = S.renderLines(m10b).map(l => l.text);
  const bh = t10b.find(x => /^Booked/.test(x));
  t("I10: both sources missing → 'crew unknown: Simpro unavailable', no 'in progress with nobody booked'", /crew unknown: Simpro unavailable/.test(m10b.headline[0]) && !/nobody booked/.test(m10b.headline[0]), m10b.headline[0]);
  t("I10: Booked heading does not contradict itself when both sources are missing", !!bh && !(/planner only/.test(bh) && /Simpro only/.test(bh)) && /crew unknown/.test(bh), bh);

  // I11 — NeedsHardDate with nothing confirmed → an AT RISK start row.
  const f11 = fixture();
  f11.jobs.push({ id: "HD", name: "Hard Date Job", foreman: "Daegan Smith", roughStatus: "waiting_date", roughNeedsHardDate: true, roughNeedsByStart: "11/2/2026" },
    { id: "HDC", name: "Hard Date Confirmed", roughStatus: "waiting_date", roughNeedsHardDate: true, roughNeedsByStart: "11/2/2026", roughStartConfirmed: true });
  const m11 = S.buildModel(f11), hd = m11.schedule.starts.find(r => r.jobId === "HD");
  t("I11: hard date needed, nothing confirmed → Starts row, hardDate, atRisk", !!hd && hd.hardDate === true && hd.atRisk === true && S.ymd(hd.hardBy) === "2026-11-02", JSON.stringify(hd));
  t("I11: a confirmed phase gets no hard-date row", !m11.schedule.starts.some(r => r.jobId === "HDC"));
  const hdl = S.renderLines(m11).find(l => /^HARD DATE NEEDED Hard Date Job/.test(l.text));
  t("I11: render 'HARD DATE NEEDED Hard Date Job — rough needs a hard date by 11/2 · nobody booked · no lead · prep 0/5 …' red tag", !!hdl && /^HARD DATE NEEDED Hard Date Job — rough needs a hard date by 11\/2 · nobody booked · no lead · prep 0\/5/.test(hdl.text) && hdl.spans[0].len === 16 && eq(hdl.spans[0].rgb, [0.72, 0.14, 0.14]), hdl && hdl.text);
}

// ── Final fix wave: LEDGER F-items ───────────────────────────────────────────
{
  const w = S.weekOf(NOW);
  const item = (o) => ({ text: "item", done: false, voided: false, ...o });
  const HG = { id: "HG", name: "Hold With GC Waits", roughStatus: "complete", finishStatus: "waiting", finishStage: "40%", finishPunch: { main: { general: [item({ waiting: true, waitingOn: "Framing" })] } } };
  const SOLDJ = { id: "SJ", name: "Sold Job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "60%", changeOrders: [{ id: "c1", coStatus: "approved", createdAt: "2026-06-01T10:00:00Z" }] };
  // F2 — distinct jobs; plain lower-case group labels.
  const m2 = S.buildModel(fixture({ jobs: [HG, SOLDJ], needs: [{ id: "n1", kind: "need", text: "Redlines", jobId: "HG", createdBy: "Louis Hoffman", assignedTo: "Koy Wilkinson", createdAt: "2026-10-05T15:00:00Z", status: "open" }] }));
  t("F2: headline line 2 counts distinct jobs and lists groups as '1 GC / builder · 1 on hold · 1 on us · 1 sold work not dated'", m2.headline[1] === "2 jobs blocked: 1 GC / builder · 1 on hold · 1 on us · 1 sold work not dated.", m2.headline[1]);
  t("F2: counts.blocked = distinct jobs (2), rows stay 4", m2.counts.blocked === 2 && m2.blocked.total === 4, JSON.stringify([m2.counts.blocked, m2.blocked.total]));

  // F3 — ready-to-bill line when dollars are missing or partial.
  const rtiJ = (id, sn) => ({ id, name: id, simproNo: sn, roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", readyToInvoice: true, readyToInvoiceDate: "10/1/2026" });
  const m3a = S.buildModel(fixture({ jobs: [rtiJ("R1", "11"), rtiJ("R2", "12")], simproTotalsById: {} }));
  const m3b = S.buildModel(fixture({ jobs: [rtiJ("R1", "11"), rtiJ("R2", "12")], simproTotalsById: { "11": { total: 53000, margin: 20 } } }));
  t("F3: no dollars fetched → '2 jobs ready to bill ($ not fetched)'", /^2 jobs ready to bill \(\$ not fetched\)/.test(m3a.headline[2]), m3a.headline[2]);
  t("F3: partial → '$53k on 1 of 2 jobs ready to bill'", /^\$53k on 1 of 2 jobs ready to bill/.test(m3b.headline[2]), m3b.headline[2]);

  // F4 — the generated time, never a hard-coded 6:00 AM.
  const m4 = S.buildModel(fixture({ now: new Date("2026-10-16T15:41:00Z") }));
  const t4 = S.renderLines(m4).map(l => l.text);
  t("F4: preLine carries the real generated time in MT", /^pre-filled Fri, Oct 16, 9:41 AM MT from the crew app/.test(m4.preLine) && /as of Fri, Oct 16, 9:41 AM MT/.test(m4.preLine), m4.preLine);
  t("F4: no '6:00 AM' anywhere when the run was at 9:41", !t4.some(x => /6:00 AM/.test(x)), t4.filter(x => /6:00/.test(x)).join(" | "));

  // F5 — deduped item texts, em dash, questions joined.
  const dj = { id: "DJ", name: "Dup Job", roughStatus: "inprogress", roughStage: "40%", roughPunch: { main: { general: [item({ waiting: true, waitingOn: "Knob and tube??" }), item({ waiting: true, waitingOn: "knob and TUBE??" }), item({ waiting: true, waitingOn: "Knob and tube??" })] } },
    roughQuestions: { main: [{ question: "Which knob?", answer: "", addedAt: "2026-10-02T12:00:00Z" }] } };
  const b5 = S.blockedRows({ live: [dj], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  t("F5: 'N waiting-on items — t1 · N questions unanswered since M/D', texts deduped case-insensitively", b5.groups[0] && b5.groups[0].rows[0].what === "3 waiting-on items — Knob and tube?? · 1 question unanswered since 10/2", JSON.stringify(b5.groups));

  // F6 — "Unspecified" is now "no reason given".
  const b6 = S.blockedRows({ live: [{ id: "NR", name: "No Reason", roughStatus: "inprogress", roughStage: "40%", roughPunch: { main: { general: [item({ waiting: true, waitingOn: "", text: "" })] } } }], needs: [], users: [], prevBlockerKeys: [], today: w.today });
  t("F6: a waiting item with no reason and no text → group 'no reason given'", eq(b6.keys, ["NR:no reason given"]) && S.GROUP_ORDER.includes("no reason given") && !S.GROUP_ORDER.includes("Unspecified"), JSON.stringify(b6.keys));

  // F8 — job names trimmed at every display boundary.
  const tj = { id: "TJ", name: "  Trim Job  ", simproNo: "77", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", readyToInvoice: true, readyToInvoiceDate: "10/1/2026", finishQcStatus: "needs",
    finalInspectionTargetDate: "10/21/2026", finishPunch: { main: { general: [item({ waiting: true, waitingOn: "Fixture" })] } } };
  const m8 = S.buildModel(fixture({ jobs: [tj], calendarEvents: [{ summary: "Trim Job walk", start: { date: "2026-10-22" } }] }));
  const names8 = [m8.schedule.idle[0].name, m8.blocked.groups[0].rows[0].name, m8.money.rti.rows[0].name, m8.qc.rows[0].name, ...m8.schedule.calendar.map(r => r.name), m8.coming.freeing[0].name];
  t("F8: name trimmed in idle, blocked, money, qc, calendar, near done", names8.length === 7 && names8.every(n => n === "Trim Job"), JSON.stringify(names8));
  t("F8: no rendered line carries the untrimmed name", S.renderLines(m8).filter(l => /Trim Job/.test(l.text)).length >= 6 && !S.renderLines(m8).some(l => /\s{2}Trim Job|Trim Job\s{2}/.test(l.text)), S.renderLines(m8).filter(l => /Trim Job/.test(l.text)).map(l => JSON.stringify(l.text)).join(" | "));

  // F9 — clip collapses whitespace; PTO notes clipped to 40.
  t("F9: clip collapses whitespace", S.clip("a   b\n\n c", 50) === "a b c", JSON.stringify(S.clip("a   b\n\n c", 50)));
  const pp9 = S.peopleRows({ users: [], pto: [{ name: "Colby Fogh", start: "10/19/2026", note: "We had to schedule Lizzie's pediatrician appointment for that day. We are able to get her other appointments" }], timeOffRequests: [], needs: [], prevUserIds: null, idx: S.buildScheduleIndex([], null, [], w.weekYmds), weekDays: w.weekDays, today: w.today });
  t("F9: PTO note clipped to 40 chars", pp9.out[0].note.length <= 40 && /…$/.test(pp9.out[0].note), JSON.stringify(pp9.out[0].note));

  // F10 — counts on the schedule h4s.
  const h4 = S.renderLines(S.buildModel(fixture())).filter(l => l.kind === "h4").map(l => l.text);
  t("F10: 'Booked · 2', 'In progress, nobody booked · 2', 'Starts · 2'", h4.includes("Booked · 2 (no planner for next week; Simpro only)") && h4.includes("In progress, nobody booked · 2") && h4.includes("Starts · 2"), JSON.stringify(h4));

  // F11 — DATE PASSED wording per kind.
  const f11 = fixture();
  f11.jobs.push({ id: "INSP", name: "Old Final", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finalInspectionTargetDate: "5/20/2026" },
    { id: "QCW", name: "Old Walk", roughStatus: "inprogress", roughStage: "50%", qcStatus: "scheduled", qcStatusDate: "10/5/2026" });
  const t11 = S.renderLines(S.buildModel(f11)).map(l => l.text);
  t("F11: 'DATE PASSED Old Final — final inspection 5/20 (149d), no result logged'", t11.includes("DATE PASSED Old Final — final inspection 5/20 (149d), no result logged"), t11.filter(x => /DATE PASSED/.test(x)).join(" | "));
  t("F11: 'DATE PASSED Old Walk — rough QC walk 10/5 (11d), walk not logged'", t11.includes("DATE PASSED Old Walk — rough QC walk 10/5 (11d), walk not logged"), t11.filter(x => /DATE PASSED/.test(x)).join(" | "));

  // F12 — calendar guard; orchestrator window, push body, fallback charset.
  const src = require("fs").readFileSync(require.resolve("../functions/strategyPrep.js"), "utf8");
  const calSrc = src.slice(src.indexOf("function calendarRows"), src.indexOf("// ── people"));
  t("F12b: calendarRows guard 'if (!d) return;' is live code on its own line, not inside a comment", /\n\s*if \(!d\) return;/.test(calSrc), "");
  const idxSrc = require("fs").readFileSync(require.resolve("../functions/index.js"), "utf8");
  const run = idxSrc.slice(idxSrc.indexOf("async function runStrategyPrep"), idxSrc.indexOf("exports.strategyPrep ="));
  t("F12a: calendar window timeMin …T00:00:00-06:00, timeMax …T23:59:59-07:00", /timeMin: `\$\{windowStart\}T00:00:00-06:00`/.test(run) && /timeMax: `\$\{windowEnd\}T23:59:59-07:00`/.test(run));
  t("F12c: push body slices the HEADLINE to 110, then appends the doc pointer (not cut)", /\(model\.headline\[0\] \|\| "This week's prep is ready"\)\.slice\(0, 110\)\} — doc "\$\{docTitle\}" is in the Friday Packets Drive folder`/.test(run) && !/Drive folder`\.slice\(0, 180\)/.test(run));
  t("F12d: fallback HTML declares utf-8", /<meta charset="utf-8">/.test(run));

  // F13 — a date cleared last week and set again now prints "no date → M/D".
  const f13 = S.liveJobs(fixture().jobs);
  const mv13 = S.movedDates(f13, { "NAM:roughStart": [{ d: "2026-10-02", v: "2026-10-08" }, { d: "2026-10-09", v: "" }] }, w.today);
  t("F13: last value '' and a date now → 'rough start no date → 10/19', nth counts real dates only (2)", mv13.rows.length === 1 && mv13.rows[0].from === "no date" && mv13.rows[0].to === "10/19" && mv13.rows[0].nth === 2, JSON.stringify(mv13.rows));
}

// ── Final fix wave: MINOR (M1–M5, M7, M8; M6 is with I5) ────────────────────
{
  // M1 — week rows separate jobs with "; " and say how many weeks' worth were cut.
  const ups = ["10/26/2026", "10/27/2026", "11/2/2026", "11/9/2026", "11/16/2026", "11/23/2026", "11/30/2026", "12/7/2026", "12/8/2026"].map((d, i) => ({ id: "w" + i, name: "Up " + i, projectedStart: d }));
  const m1 = S.buildModel(fixture({ upcoming: ups }));
  const t1 = S.renderLines(m1).map(l => l.text);
  t("M1: jobs within a week row are separated by '; '", t1.includes("Week of 10/26 — Up 0 10/26 projected; Up 1 10/27 projected"), t1.filter(x => /^Week of/.test(x)).join(" | "));
  t("M1: after six weeks → '…and 2 later' (12/7 + 12/8 are the 7th week)", t1.filter(x => /^Week of/.test(x)).length === 6 && t1.includes("…and 2 later"), t1.filter(x => /later/.test(x)).join(" | "));

  // M2 / M3 — notes parser: "Notes:" heading; short-text substring matches don't count as carried weeks.
  const para = (text, o = {}) => ({ paragraph: { elements: [{ textRun: { content: text + "\n", textStyle: {} } }], paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, ...(o.bullet ? { bullet: { nestingLevel: 0 } } : {}) } });
  const H = (d) => para(`${d} | Weekly Strategy/Scheduling Meeting`);
  const doc = { body: { content: [
    H("Oct 9, 2026"), para("Notes:"), para("Rose", { bullet: true }), para("Call Edge about Pierce panel", { bullet: true }), para("Ready to invoice:"), para("Koplin", { bullet: true }),
    H("Oct 2, 2026"), para("Notes"), para("Rose Residence panel swap", { bullet: true }), para("Call Edge about Pierce panel today", { bullet: true }),
  ] } };
  const c = S.parseNotesCarry(doc, new Date(2026, 9, 16, 12, 0, 0));
  t("M2: 'Notes:' carries and 'Ready to invoice:' skips (trailing colon stripped)", eq(c.rows.map(r => r.text), ["Rose", "Call Edge about Pierce panel"]), JSON.stringify(c.rows));
  t("M3: 'Rose' inside 'Rose Residence panel swap' is not a carried week (short text); long substring still counts", eq(c.rows.map(r => r.weeks), [1, 2]), JSON.stringify(c.rows));

  // M5 — Approved this week = Monday..today, same window as Last week.
  const coJ = { id: "AJ", name: "Approved Job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "50%", changeOrders: [
    { id: "x1", coStatus: "approved", coStatusDate: "10/10/2026", desc: "Saturday before" }, { id: "x2", coStatus: "approved", coStatusDate: "10/12/2026", desc: "Monday" }] };
  const m5 = S.buildModel(fixture({ jobs: [coJ] }));
  t("M5: a CO approved Sat 10/10 is outside Mon–today; Mon 10/12 is in; matches Last week's count", m5.money.approved.count === 1 && m5.money.approved.rows[0].desc === "Monday" && m5.lastWeek.cosApproved === 1, JSON.stringify([m5.money.approved, m5.lastWeek.cosApproved]));

  // M7 — no "· 0 punch".
  const m7 = S.buildModel(fixture({ jobs: [{ id: "Z", name: "Zero Punch", roughStatus: "inprogress", roughStage: "30%" }] }));
  const z = S.renderLines(m7).find(l => /^NO CREW Zero Punch/.test(l.text));
  t("M7: idle row omits '· 0 punch'", !!z && !/0 punch/.test(z.text), z && z.text);

  // M4 / M8 — orchestrator: whole-field state write; Simpro page cap is reported.
  const idxSrc = require("fs").readFileSync(require.resolve("../functions/index.js"), "utf8");
  const run = idxSrc.slice(idxSrc.indexOf("async function runStrategyPrep"), idxSrc.indexOf("exports.strategyPrep ="));
  t("M4: state write uses mergeFields of the payload's keys (stale map keys replaced), not merge:true", /\{ mergeFields: Object\.keys\(statePayload\) \}/.test(run) && !/settings\/strategyPrep"\)\.set\([^;]*\{ merge: true \}/.test(run));
  t("M8: 10 full Simpro schedule pages → logged and pushed to inputErrors", /simpro schedule: 10 full pages/.test(run) && /strategyPrep simpro schedule page cap hit/.test(run));
}

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall strategy prep tests passed");
