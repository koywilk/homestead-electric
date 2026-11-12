#!/usr/bin/env node
// punch-list-stage-test (v624): the Punch List stage on the Job Board.
// Runs the SHIPPED src/punchListStage.js on jobs shaped like the live ones on
// 2026-11-11 (The Hideout #1302, Austin Cloward #1187, Casten-Vaught #1327,
// Helmondollar #1192, Rose #889) and checks:
//   - 90%+ in progress with open finish punch → Punch List; 85% doesn't,
//   - Complete with leftovers (punch, QC, failed final items, open trip) → Punch List,
//   - a done / signed-off / voided item, a passed or fully fixed inspection,
//     and a trip marked complete do NOT keep a job there,
//   - On Hold stays On Hold; quick jobs, temp peds, quotes, commercial never,
//   - App.js files the board through it: the Finish and Completed sections
//     both exclude Punch List jobs, so no job shows in two sections.
// Exit 1 on any failure. Runs in prebuild.
"use strict";
const fs = require("fs");
const path = require("path");
const P = require("../src/punchListStage.js");

let n = 0, bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.error("  FAIL " + msg); } };

const item = (text, extra) => ({ id: text, text, ...(extra || {}) });
const tree = (items) => ({ main: { general: items, hotcheck: [], rooms: [] } });

// The Hideout #1302: finish In Progress 95%, 2 open finish punch, rough walked.
const hideout = { name: "The Hideout", roughStatus: "complete", roughStage: "100%", finishStatus: "inprogress", finishStage: "95%",
  finishPunch: { upper: { general: [item("a")], rooms: [{ items: [item("b"), item("c", { done: true })] }] } } };
ok(P.isPunchListJob(hideout, "inprogress"), "Hideout 95% + 2 open → Punch List");
ok(P.punchListOpen(hideout).finishPunch === 2, "Hideout counts 2 (done item ignored)");
ok(P.punchListLine(P.punchListOpen(hideout)) === "2 punch items", "Hideout line");

// Austin Cloward #1187: 95%, 2 open punch, one return trip needing a date, final
// inspection "fail" with every failed item already done.
const austin = { ...hideout, name: "Austin Cloward", finishPunch: tree([item("x"), item("y")]),
  finalInspectionResult: "fail", finalInspectionItems: [item("loose recep", { done: true }), item("label ufer", { done: true })],
  returnTrips: [{ id: "rt1", scope: "Install last casetta switch", rtStatus: "needs" }] };
const ao = P.punchListOpen(austin);
ok(P.isPunchListJob(austin, "inprogress"), "Austin → Punch List");
ok(ao.inspection === 0 && ao.trips === 1 && ao.total === 3, "Austin: fixed inspection items don't count, the trip does");
ok(P.punchListLine(ao) === "2 punch items · 1 return trip", "Austin line");

// Casten-Vaught #1327: marked Complete at 90% with 8 open finish punch.
const casten = { name: "Casten-Vaught", finishStatus: "complete", finishStage: "90%", finishPunch: tree(Array.from({ length: 8 }, (_, i) => item("p" + i))) };
ok(P.isPunchListJob(casten, "complete"), "Complete with 8 open → Punch List");
ok(P.isPunchListJob(casten, "invoice"), "legacy invoice status counts as complete");

// Helmondollar #1192: Complete 100%, three trips marked complete (not signed off),
// failed final with no open items → Completed.
const helm = { name: "Helmondollar", finishStatus: "complete", finishStage: "100%", finalInspectionResult: "fail", finalInspectionItems: [],
  returnTrips: [{ rtStatus: "complete" }, { rtStatus: "complete" }, { rtStatus: "complete" }] };
ok(!P.isPunchListJob(helm, "complete"), "trips marked complete don't hold a job on Punch List");
ok(!P.isPunchListJob({ ...helm, returnTrips: [{ rtStatus: "needs", signedOff: true }] }, "complete"), "signed-off trip is closed");

// Lot 23 Vista Meadows #1386: Complete 100%, one trip that needs a date → Punch List.
ok(P.isPunchListJob({ finishStatus: "complete", finishStage: "100%", returnTrips: [{ rtStatus: "needs" }] }, "complete"), "open trip on a completed job → Punch List");
ok(P.isPunchListJob({ finishStatus: "complete", returnTrips: [{ rtStatus: "" }] }, "complete"), "trip with no status yet is open");

// Failed final with open items, QC-walk items, voided items, extra floors.
ok(P.punchListOpen({ finalInspectionResult: "fail", finalInspectionItems: [item("a"), item("b", { done: true })] }).inspection === 1, "open failed-final item counts");
ok(P.punchListOpen({ finalInspectionResult: "pass", finalInspectionItems: [item("a")] }).inspection === 0, "a passed final ignores leftover items");
ok(P.punchListOpen({ qcPunch: tree([item("qc")]) }).qcPunch === 1, "QC-walk item counts");
ok(P.punchListOpen({ finishPunch: tree([item("v", { voided: true })]) }).total === 0, "voided item doesn't count");
ok(P.punchListOpen({ finishPunch: { extras: [{ key: "garage" }], garage: { hotcheck: [item("g")] } } }).finishPunch === 1, "extra floor + hot check items count");
ok(P.punchListOpen({ roughPunch: tree([item("r")]) }).total === 0, "rough punch is not finish punch");
ok(P.punchListOpen({}).total === 0 && P.punchListOpen(null).total === 0, "empty / missing job");

// The threshold and the statuses that never move.
ok(!P.isPunchListJob({ ...hideout, finishStage: "85%" }, "inprogress"), "85% with open items stays in Finish");
ok(P.isPunchListJob({ ...hideout, finishStage: "90%" }, "inprogress"), "90% is the line");
ok(!P.isPunchListJob({ ...hideout, finishStage: "25%", name: "Rose" }, "inprogress"), "Rose at 25% stays in Finish");
ok(!P.isPunchListJob({ ...hideout, finishPunch: {} }, "inprogress"), "95% with nothing open stays in Finish");
ok(!P.isPunchListJob(hideout, "waiting"), "On Hold stays On Hold");
ok(!P.isPunchListJob(hideout, "scheduled"), "not started never");
for (const k of [{ quickJob: true }, { tempPed: true }, { type: "quote" }, { division: "commercial" }])
  ok(!P.isPunchListJob({ ...casten, ...k }, "complete"), "never on " + JSON.stringify(k));

// v625: the Finish dropdown's "Punch List" choice (finishPunchList flag).
const low = { name: "Ashcraft", finishStatus: "inprogress", finishStage: "45%", finishPunch: tree([item("a")]) };
ok(!P.isPunchListJob(low, "inprogress"), "Ashcraft 45% is not on Punch List by itself");
ok(P.isPunchListJob({ ...low, finishPunchList: true }, "inprogress"), "picked by hand → Punch List at any %");
ok(P.isPunchListJob({ ...low, finishPunch: {}, finishPunchList: true }, "inprogress"), "picked by hand → Punch List even with nothing open");
ok(!P.isPunchListJob({ ...hideout, finishPunchList: false }, "inprogress"), "foreman kept it off → stays in Finish at 95% with open items");
ok(P.isPunchListJob({ ...hideout, finishPunchList: null }, "inprogress"), "cleared flag → the automatic rule again");
ok(!P.isPunchListJob({ ...low, finishPunchList: true }, "waiting"), "On Hold beats the flag");
ok(!P.isPunchListJob({ ...casten, finishPunch: {}, finishPunchList: true }, "complete"), "Complete ignores the flag (nothing open → Completed)");
ok(P.isPunchListJob({ ...casten, finishPunchList: false }, "complete"), "Complete ignores a false flag too (open items → Punch List)");
const opts = P.finishStatusOptions([{ value: "" }, { value: "scheduled" }, { value: "inprogress" }, { value: "waiting" }, { value: "complete" }]).map(o => o.value);
ok(JSON.stringify(opts) === JSON.stringify(["", "scheduled", "inprogress", "punchlist", "waiting", "complete"]), "dropdown: Punch List right after In Progress");
ok(P.finishStatusShown(hideout, "inprogress") === "punchlist", "dropdown shows Punch List for an automatic one");
ok(P.finishStatusShown({ ...low, finishPunchList: true }, "inprogress") === "punchlist", "dropdown shows Punch List when picked");
ok(P.finishStatusShown(low, "inprogress") === "inprogress", "dropdown shows In Progress otherwise");
ok(P.finishStatusShown(casten, "complete") === "complete", "a completed job's dropdown still says Complete");
const pk = (j, v) => JSON.stringify(P.punchListPick(j, j.finishStatus, v));
ok(pk(low, "punchlist") === JSON.stringify({ status: "inprogress", finishPunchList: true }), "pick Punch List → stored as In Progress + flag");
ok(pk(hideout, "inprogress") === JSON.stringify({ status: "inprogress", finishPunchList: false }), "pick In Progress while it shows Punch List → kept off");
ok(pk(low, "inprogress") === JSON.stringify({ status: "inprogress", finishPunchList: null }), "pick In Progress otherwise → flag cleared");
for (const v of ["", "scheduled", "waiting", "complete"]) ok(JSON.parse(pk({ ...low, finishPunchList: true }, v)).finishPunchList === null && JSON.parse(pk(low, v)).status === v, "pick " + (v || "unset") + " clears the flag");

// App.js wiring: one rule, sections exclusive.
const app = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
const sec = (key) => { const m = app.match(new RegExp(`\\{ key:"${key}",[^\\n]*\\n\\s*(?:extra:[^\\n]*\\n\\s*)?test:[^\\n]*(?:\\n\\s+\\|\\|[^\\n]*)*`)); return m ? m[0] : ""; };
ok(/import PunchListStage from "\.\/punchListStage"/.test(app), "App.js imports the module");
ok(/<select value=\{fsShown\}/.test(app) && /finishStatusOptions\(FINISH_STATUSES\)\.map/.test(app), "the Finish dropdown offers and shows Punch List");
ok(/const pick=punchListPick\(job, effFS\(job\), e\.target\.value\);/.test(app) && /finishPunchList:pick\.finishPunchList/.test(app), "the Finish dropdown writes the flag");
ok(/isPunchList\(j\)/.test(sec("punchList")), "Punch List section tests isPunchList");
ok(/!isPunchList\(j\)/.test(sec("finish")), "Finish In Progress excludes Punch List jobs");
const ci = app.indexOf('{ key:"complete",'); const complete = ci > 0 ? app.slice(ci, app.indexOf("\n];", ci)) : "";
ok(/!isPunchList\(j\)/.test(complete), "Completed excludes Punch List jobs");
const order = ["key:\"finish\"", "key:\"punchList\"", "key:\"complete\""].map(k => app.indexOf(k));
ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), "Punch List sits between Finish and Completed");

if (bad) { console.error(`  punch-list-stage-test: ${bad} of ${n} checks FAILED`); process.exit(1); }
console.log(`  ok  punch-list-stage-test: ${n} checks (Hideout, Austin Cloward, Casten-Vaught, Helmondollar, Vista Meadows, Rose)`);
