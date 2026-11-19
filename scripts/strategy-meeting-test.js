#!/usr/bin/env node
process.env.TZ = "UTC";   // the prefill runs in Cloud Functions (UTC)
// Friday Strategy meeting (SW v657): the Thursday-night prefill rows (functions/strategyMeeting.js) and
// the page's own model (src/meetingModel.js: Job numbers with dollars, parked items, sections).
// Run: node scripts/strategy-meeting-test.js
"use strict";
const SP = require("../functions/strategyPrep.js");
const SM = require("../functions/strategyMeeting.js");
const M = require("../src/meetingModel.js");
let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// Thu Nov 19 2026, 9:00 PM Mountain = Fri 04:00Z. Meeting Fri 11/20; next week Mon 11/23 .. Fri 11/27.
const NOW = new Date("2026-11-20T04:00:00Z");
const users = [
  { id: "koy", name: "Koy Wilkinson", role: "admin" },
  { id: "daegan", name: "Daegan Smith", title: "foreman" },
  { id: "louis", name: "Louis Hoffman", title: "jrforeman", foremanId: "daegan" },
  { id: "noah", name: "Noah Davis", title: "crew" },
];
const jobs = [
  // In progress, nobody booked next week, punch + question + waiting item, no crew named.
  { id: "A1", name: "Alpha Residence", simproNo: "1291", roughStatus: "inprogress", roughStage: "60%",
    roughPunch: { main: { general: [{ text: "x", done: false }, { text: "y", done: false, waiting: true, waitingOn: "fixtures not delivered" }] } },
    roughQuestions: { main: [{ question: "Where does the TV go?", answer: "" }] },
    returnTrips: [{ id: "t1", scope: "Hang pendants", material: "3 pendants PO 7224", rtStatus: "scheduled", rtStatusDate: "2026-11-24", assignedTo: "Noah Davis" },
      { id: "t2", scope: "Fix GFCI", rtStatus: "needs", rtStatusDate: "2026-11-10" }],
    changeOrders: [{ id: "c1", coStatus: "approved", desc: "Add two cans" }] },
  // Rough start Tue 11/24, lead, prep 5/5, but no material PO → AT RISK (nobody booked too).
  { id: "B2", name: "Bravo Home", simproNo: "1300", foreman: "Daegan Smith", lead: "Louis Hoffman", roughProjectedStart: "2026-11-24", roughStartConfirmed: true,
    prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true } },
  // Booked Mon in Simpro, finish start Mon with a PO on the finish card.
  { id: "C3", name: "Charlie Lot 4", simproNo: "1310", foreman: "Daegan Smith", lead: "Louis Hoffman", roughStatus: "complete", roughStage: "100%",
    finishProjectedStart: "2026-11-23", finishStartConfirmed: true, finishMaterials: [{ id: 1, po: "7300" }],
    prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true },
    finishStatus: "date_confirmed" },
  { id: "E5", name: "Echo Finish", simproNo: "1330", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%", finalInspectionTargetDate: "2026-11-26" },
  // Simpro says Scheduled, nothing booked.
  { id: "D4", name: "Delta Shop", simproNo: "1320", roughStatus: "", roughStage: "0" },
];
const scheduleEntries = [
  { Type: "job", Date: "2026-11-23", Staff: { Name: "Louis Hoffman" }, Project: { ID: 1310 } },
  { Type: "job", Date: "2026-11-23", Staff: { Name: "Noah Davis" }, Project: { ID: 1310 } },
];
const totals = { "1291": { margin: -4.2, stage: "Progress", status: "Job - In Progress", total: 41000 }, "1320": { margin: 20, stage: "Pending", status: "Job - Scheduled", total: 9000 } };
const prevState = { dates: { "B2:roughStart": [{ d: "2026-11-13", v: "2026-11-17" }] } };
const model = SP.buildModel({ jobs, users, scheduleEntries, plannerDoc: null, pto: [{ name: "Noah Davis", start: "11/25/2026", end: "11/25/2026" }], timeOffRequests: [], needs: [], upcoming: [], agentFindings: [],
  calendarEvents: [], prevState, simproTotalsById: {}, notesDoc: null, notesError: "not read", simproOk: true, now: NOW });
const P = SM.buildPrefill({ model, jobs, totals, now: NOW });
const R = P.rows;
const by = (sec, re) => (R[sec] || []).find(r => re.test(r.key));

t("meeting is Friday 11/20, next week 11/23–11/27", P.meetingYmd === "2026-11-20" && P.weekYmds[0] === "2026-11-23" && P.weekYmds[4] === "2026-11-27", JSON.stringify([P.meetingYmd, P.weekYmds]));
t("every section key is there", SM.SECS.every(([k]) => Array.isArray(R[k])));
t("rows store as plain JSON", JSON.stringify(R) === JSON.stringify(JSON.parse(JSON.stringify(R))));
t("every job row carries number and name", Object.values(R).flat().filter(r => r.jobId).every(r => r.no && r.title), JSON.stringify(Object.values(R).flat().filter(r => r.jobId && !(r.no && r.title))));

const idle = by("schedule", /^i_A1/);
t("in-progress job with nobody booked is under Needs booking with NO CREW", idle && idle.group === "Needs booking" && idle.tag === "NO CREW", JSON.stringify(idle));
t("…with punch, questions and what it waits on", idle && /2 punch/.test(idle.detail) && /1 question/.test(idle.detail) && /waiting on Material/.test(idle.detail), idle && idle.detail);
const booked = by("schedule", /^b_C3/);
t("booked job shows the day and who", booked && booked.group === "Booked next week" && /Mon: .*Louis/.test(booked.detail), booked && booked.detail);

const sB = by("starts", /^st_B2/), sC = by("starts", /^st_C3/);
t("start with nobody booked and no PO is AT RISK", sB && sB.tag === "AT RISK" && /nobody booked/.test(sB.detail) && /no material PO/.test(sB.detail), sB && sB.detail);
t("booked start with lead, prep 5/5 and a PO is on track", sC && sC.tag === "On track" && /PO 7300/.test(sC.detail), sC && JSON.stringify(sC));

const t1 = by("trips", /^t_A1_t1/), t2 = by("trips", /^t_A1_t2/), co = by("trips", /^co_A1/);
t("booked trip shows day and person, material and the PO from its text", t1 && /^Booked Tue 11\/24 · Noah/.test(t1.tag) && /PO 7224/.test(t1.detail) && !t1.bad, t1 && JSON.stringify(t1));
t("unbooked trip is flagged", t2 && t2.bad);
t("approved CO not on a trip is listed, one row per job", co && co.tag === "Approved CO, no trip" && /CO 1: Add two cans/.test(co.detail));

t("past-due unfinished trip needs a date", !!by("needsdate", /^pd_A1_t2/));
t("Simpro Job - Scheduled with nothing booked needs a date", !!by("needsdate", /^ss_1320/));
t("a booked Scheduled job is not listed", !by("needsdate", /^ss_1310/));

const mv = (R.moved || []).find(r => r.jobId === "B2");
t("moved start date shows from → to", mv && /rough start: 11\/17 → 11\/24/.test(mv.detail), JSON.stringify(R.moved));
const fin = (R.oncal || []).find(r => r.jobId === "E5" && /Final/.test(r.tag));
t("final inspection is on the calendar under its day", fin && fin.group === "Thu 11/26", JSON.stringify(R.oncal));
t("time off lands in People out", (R.out || []).some(r => r.title === "Noah Davis" && r.tag === "Out"), JSON.stringify(R.out));

t("Top lists the job losing money first", R.top[0] && R.top[0].key === "top_losing" && /#1291 Alpha Residence -4%/.test(R.top[0].detail), JSON.stringify(R.top[0]));
t("Top has at most six items", R.top.length <= 6 && R.top.length >= 3, String(R.top.length));
t("prefill never carries dollar figures", !/\$\d/.test(JSON.stringify(R)));

// ── the page's own model ──
const costs = [
  { no: "1291", name: "Alpha Residence", rough_hrsEst: 100, rough_hrsUsed: 95, rough_sell: 20000, rough_matAct: 6000, rough_labAct: 15000, rough_matEst: 5000, rough_labEst: 12000 },
  { no: "1310", name: "Charlie Lot 4", rough_hrsEst: 80, rough_hrsUsed: 70, rough_sell: 18000, rough_matAct: 4000, rough_labAct: 8000, rough_matEst: 5000, rough_labEst: 9000, finish_hrsEst: 60, finish_hrsUsed: 2, finish_sell: 9000 },
];
const N = M.strategyNumbers({ jobs, costs, totals: { ...totals, "1310": { margin: 31, stage: "Progress", status: "Job - In Progress", total: 52000 } }, users, effFS: j => j.finishStatus });
t("Job numbers: worst total margin first", N[0] && N[0].no === "1291" && N[1].no === "1310", JSON.stringify(N.map(r => [r.no, r.total])));
t("Job numbers carry the dollars", N[0].money.total === 41000 && N[0].money.rough.profit === -1000 && N[0].money.rough.sell === 20000, JSON.stringify(N[0].money));
t("a phase not started shows no profit", N[1].finish.state === "not started" && N[1].money.finish.profit == null);
t("over-bid flags come along", N[0].over === true);
const lead = M.marginRows({ jobs, costs, totals, users, effFS: j => j.finishStatus });
t("the Lead / Foreman table still carries no dollars", !lead.some(r => r.money));

const parked = M.parkedRows(jobs, { j_B2_r: { off: true, by: "Koy Wilkinson", at: "2026-11-19T20:00:00Z" }, "t_A1_t2": { off: true }, j_B2_f: { s: "2026-11-30" }, "j_B2_r~2026-11-24": { off: true } });
t("parked items: removed rough and trip, not a plan or a copy", parked.length === 2 && parked[0].no === "1300" && parked[0].tag === "Parked" && /Rough-in taken off the crew calendar by Koy/.test(parked[0].detail), JSON.stringify(parked));
const SS = M.buildStrategySections({ prefill: { rows: R }, jobs, costs, totals, users, effFS: j => j.finishStatus, calPrefs: { cal: { j_B2_r: { off: true } } } });
t("sections: every strategy section is built", M.STRATEGY_SECS.every(([k]) => Array.isArray(SS[k])));
t("sections: parked items join Needs a date", SS.needsdate.some(r => r.tag === "Parked"));
t("sections: Notes start empty", SS.notes.length === 0);
t("no prefill yet: sections are empty, not an error", (() => { const E = M.buildStrategySections({ prefill: null, jobs, costs: [], totals: {} }); return E.top.length === 0 && E.schedule.length === 0; })());
t("CFG: Friday Strategy is Friday 8:00", M.CFG.strategy.dow === 5 && M.meetingDate(new Date(2026, 10, 19, 12), "strategy") === "2026-11-20");
t("SECS match between the prefill and the page", JSON.stringify(SM.SECS) === JSON.stringify(M.STRATEGY_SECS));

if (failures) { console.error(`strategy-meeting-test: ${failures} failed`); process.exit(1); }
console.log("strategy-meeting-test: all passed");
