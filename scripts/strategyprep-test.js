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
  t("index: byPerson Treycen Mon → The Hideout", idx.byPerson.get("treycen").days[0].has("The Hideout"));
  t("index: Simpro job unknown to the app is kept, not dropped", idx.unknownSimpro.length === 1 && idx.unknownSimpro[0].pid === "9999" && idx.unknownSimpro[0].people[0] === "Zane Watkins");
  t("index: activity rows ignored", !idx.byPerson.has("james"));
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
}

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall strategy prep tests passed");
