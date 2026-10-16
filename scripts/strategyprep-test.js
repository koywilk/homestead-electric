#!/usr/bin/env node
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
  t("dateKeys: Namjoshi rough start + Miller 4-way/QC/scan/RT", keys["NAM:roughProjectedStart"] === "2026-10-19" && keys["MIL:fourWayTargetDate"] === "2026-10-21" && keys["MIL:qcStatusDate"] === "2026-10-21" && keys["MIL:matterportStatusDate"] === "2026-10-23" && keys["MIL:rt:0"] === "2026-10-20", JSON.stringify(keys));
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
    t("cleared date: nextDates ends with an empty value", nx["NAM:roughProjectedStart"].length === 2 && nx["NAM:roughProjectedStart"][1].v === "" && nx["NAM:roughProjectedStart"][1].d === "2026-10-16", JSON.stringify(nx["NAM:roughProjectedStart"]));
    t("cleared date: second run with that history prints no row", S.movedDates(live, nx, w.today).rows.length === 0 && eq(S.nextDates(live, nx, "2026-10-23")["NAM:roughProjectedStart"], nx["NAM:roughProjectedStart"]));
    const gone = S.nextDates(live.filter(j => j.id !== "NAM"), prev, "2026-10-16");
    t("cleared date: a job no longer live drops out of next and prints nothing", !("NAM:roughProjectedStart" in gone) && S.movedDates(live.filter(j => j.id !== "NAM"), prev, w.today).rows.length === 0);
    // a completed return trip is not a cleared date
    const f3 = fixture(); f3.jobs.push({ id: "RTJ", name: "RT Job", roughStatus: "inprogress", roughStage: "20%", returnTrips: [{ rtStatus: "complete", rtStatusDate: "10/20/2026" }] });
    const mv3 = S.movedDates(S.liveJobs(f3.jobs), { "RTJ:rt:0": [{ d: "2026-10-09", v: "2026-10-20" }] }, w.today);
    t("cleared date: a completed return trip is not reported as cleared", mv3.rows.length === 0, JSON.stringify(mv3.rows));
  }
  // 4. nextDates behavior
  {
    const same = S.nextDates(live0, { "NAM:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-19" }] }, "2026-10-16");
    t("nextDates: unchanged value is not appended", same["NAM:roughProjectedStart"].length === 1 && same["NAM:roughProjectedStart"][0].d === "2026-10-09");
    const chg = S.nextDates(live0, { "NAM:roughProjectedStart": [{ d: "2026-10-09", v: "2026-10-12" }] }, "2026-10-16");
    t("nextDates: changed value appends today's entry", eq(chg["NAM:roughProjectedStart"], [{ d: "2026-10-09", v: "2026-10-12" }, { d: "2026-10-16", v: "2026-10-19" }]), JSON.stringify(chg["NAM:roughProjectedStart"]));
    const six = [1, 2, 3, 4, 5, 6].map(n => ({ d: `2026-09-0${n}`, v: `2026-09-1${n}` }));
    const cap = S.nextDates(live0, { "NAM:roughProjectedStart": six }, "2026-10-16")["NAM:roughProjectedStart"];
    t("nextDates: history capped at 6, oldest dropped", cap.length === 6 && cap[0].d === "2026-09-02" && cap[5].v === "2026-10-19", JSON.stringify(cap));
    t("nextDates: first run (null prev) seeds one entry per key", S.nextDates(live0, null, "2026-10-16")["NAM:roughProjectedStart"].length === 1);
  }
  // 4/5. passed branches and guards
  {
    const f = fixture();
    f.jobs.push({ id: "FIN", name: "Finish Start Job", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "10/12/2026" });
    f.jobs.push({ id: "FIN2", name: "Final Insp Job", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finalInspectionTargetDate: "10/10/2026" });
    f.jobs.push({ id: "OLD", name: "Rough Done Old Target", roughStatus: "complete", roughStage: "100%", finishStatus: "waiting_date", fourWayTargetDate: "8/1/2026" });
    const mv = S.movedDates(S.liveJobs(f.jobs), {}, w.today);
    const p = (n) => mv.passed.filter(x => x.name === n);
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
  const un2 = S.blockedRows({ live, needs: [{ ...unNeeds[0], status: "done" }, { id: "u2", kind: "need", text: "Another loose one", createdAt: "2026-10-07T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" }], users: f.users, prevBlockerKeys: un1.keys, today: w.today });
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
  t("nextState: blockerKeys, marginByJob, dates, userIds, weeks (cap 8), lastRunAt absent (orchestrator adds)", Array.isArray(m.nextState.blockerKeys) && m.nextState.marginByJob.WADE === -6 && m.nextState.dates["NAM:roughProjectedStart"] && m.nextState.userIds.length === f.users.length && m.nextState.weeks.length === 3 && m.nextState.weeks[0].ymd === "2026-10-16", JSON.stringify(Object.keys(m.nextState)));
  t("counts: every §4.3 bucket counted + between", typeof m.counts.booked === "number" && typeof m.counts.between === "number");
  const bad = S.buildModel({ ...f, jobs: null, scheduleEntries: "garbage", simproOk: false });
  t("degrade: null jobs → every section error string, model still returned", typeof bad.schedule.error === "string" && typeof bad.blocked.error === "string" && Array.isArray(bad.headline));
  const noSimpro = S.buildModel({ ...f, scheduleEntries: [], simproOk: false });
  t("degrade: simproOk false flags schedule.simproOk false", noSimpro.schedule.simproOk === false);
  t("recipients: admins + josh/brady/justin, never manager, deduped", (() => { const r = S.resolveRecipients([...f.users, { id: "jer", name: "Jeromy Cloward", access: "manager" }]); const n = r.map(x => x.user.name); return n.includes("Koy Wilkinson") && n.includes("Brady Nelson") && !n.includes("Jeromy Cloward") && new Set(n).size === n.length; })());
  t("collectSimproCandidates: RTI + finishing, trimmed, cap", (() => { const c = S.collectSimproCandidates(f.jobs); return c.includes("1419") && c.includes("694") && !c.includes("1444") && c.every(s => s === s.trim()); })(), JSON.stringify(S.collectSimproCandidates(f.jobs)));
}

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall strategy prep tests passed");
