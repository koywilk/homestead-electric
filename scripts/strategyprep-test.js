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

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall strategy prep tests passed");
