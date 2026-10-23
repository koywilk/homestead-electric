#!/usr/bin/env node
/* goals-model-test.js — the Dashboard › Goals tab's pure parts (SW v561), compiled out of
 * src/App.js by odash-model-test's sandbox so what is tested is exactly what ships.
 *
 * Proves:
 *   1. PARSE — the Team Goals sheet grid (a copy of the 10/23 CSV, blank column A) gives
 *      the mission, 8 goals, 10 measures (emojis stripped), 4 quarters; sections are found
 *      by their header cells, so a row inserted above them changes nothing.
 *   2. DUE — "Oct 31" on 10/23 is due in 8 d, "Jan" is next January, "Weekly, ongoing" is no date.
 *   3. STATUS — column F wins (Done / On track / At risk); blank falls back to the due flag.
 *   4. MEASURES — the dashboard repeats functions/goalsPull.js's math on the slim rows
 *      (weighted margin, hours, at-15 count, per technician).
 *   5. MODEL — no Simpro doc → every Simpro card says "No Simpro pull yet"; with one, the
 *      margin / hours / foreman / commercial / collect cards light up; app-measured goals
 *      not on the sheet land in `extra`; a sheet row naming one moves it onto the card.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const G = require(path.join(__dirname, "..", "functions", "goalsPull.js"));
const X = makeSandbox();
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const now = new Date(2026, 9, 23, 8, 0);   // Fri Oct 23 2026, 8:00 AM local

// 1. PARSE — the sheet as Google serves it (column A blank, section headers in column B).
const grid = [
  ["", "Team Goals 2026–2027", "", "", "", ""],
  ["", "Our goal: Be the best electrical contractor in Utah. That means jobs built right the first time.", "", "", "", ""],
  ["", "REST OF 2026  ·  OCTOBER – DECEMBER", "", "", "", ""],
  ["", "AREA", "GOAL", "WHO", "BY", "STATUS"],
  ["", "Field", "Every approved change order gets its hours booked to its own change-order cost center", "Koy", "Nov 30", ""],
  ["", "Field", "Book every hour to the right job and phase every day", "Koy, everyone in the field", "Starting now", "On track"],
  ["", "Field", "Monday hours-vs-estimate report reviewed with each crew", "Koy", "Weekly, ongoing", ""],
  ["", "Field", "Fewer mid-day supply runs: next day's orders in by 2:00", "Foremen", "Ongoing", "At risk"],
  ["", "Estimating", "Every quote built on the 2026 prebuilds; no quote below our margin floor", "Brady and Jeromy", "Every quote", ""],
  ["", "Office", "Invoices out within 2 days of the work; written follow-up rule for overdue accounts", "Josh", "Oct 31", ""],
  ["", "People", "Foreman hours bonus live: first payouts in January", "Josh", "Jan", "Done"],
  ["", "Shop", "Keep the shop clean and the inventory right", "Josh, Koy, foremen", "Starting now", ""],
  ["", "2027 SCOREBOARD", "", "", "", ""],
  ["", "MEASURE", "WHERE WE ARE TODAY", "2027 GOAL", "", ""],
  ["", "💲  Job margin (completed jobs, after labor and material)", "About 11.7%", "15% or better on every job", "", ""],
  ["", "🏢  Commercial projects (share of our work)", "Battle Creek, Wise Flooring, ProSteel and Riverton Retail & Laundromat underway", "About a quarter of our work", "", ""],
  ["", "⏱️  Hours vs estimate, company", "140% (old estimates)", "110% or better", "", ""],
  ["", "👷  Hours vs estimate, every foreman", "131–166%", "115% or better", "", ""],
  ["", "🔧  Warranty hours (share of all job hours)", "3.3%", "Under 2%", "", ""],
  ["", "📝  Change orders with hours booked to their own cost center", "Almost none", "Every approved change order", "", ""],
  ["", "🛒  Home Depot / ACE runs", "About 4 a week", "30% fewer", "", ""],
  ["", "💵  Days to collect on our invoices", "About 55", "Under 45", "", ""],
  ["", "📊  Jobs with hours tracked weekly", "Some", "Every job", "", ""],
  ["", "🧰  Shop and inventory", "Stock reset to zero in SimPro Oct 19", "Clean, organized shop", "", ""],
  ["", "2027 BY QUARTER", "", "", "", ""],
  ["", "Q1", "First foreman bonus payouts; change-order booking is a habit", "", "", ""],
  ["", "Q2", "Collect faster; small supply runs down 30%", "", "", ""],
  ["", "Q3", "Hours at 110% of estimate or better company-wide", "", "", ""],
  ["", "Q4", "Run every month at the standard", "", "", ""],
];
const sheet = X.odGoalsParse(grid);
assert.strictEqual(sheet.title, "Team Goals 2026–2027");
assert.ok(sheet.mission.startsWith("Be the best electrical contractor"), "mission loses its 'Our goal:' prefix");
eq([sheet.goals.length, sheet.measures.length, sheet.quarters.length], [8, 10, 4]);
eq(sheet.goals[0], { row: 5, area: "Field", goal: "Every approved change order gets its hours booked to its own change-order cost center", who: "Koy", by: "Nov 30", status: "" }, "row numbers are the sheet's own (1-based)");
eq(sheet.goals[5].status, "", "a blank STATUS cell stays blank");
eq(sheet.measures[0], { row: 15, name: "Job margin (completed jobs, after labor and material)", today: "About 11.7%", goal: "15% or better on every job" }, "emoji stripped, text kept");
eq(sheet.measures.map(x => x.name.charCodeAt(0) < 128), Array(10).fill(true), "no measure name starts with an emoji");
eq(sheet.quarters[0], { row: 26, q: "Q1", text: "First foreman bonus payouts; change-order booking is a habit" });
const shifted = X.odGoalsParse([["", "A note Josh added above everything", ""], [""], ...grid]);
eq([shifted.goals.length, shifted.measures.length, shifted.goals[0].row], [8, 10, 7], "sections found by headers after an inserted row; row numbers follow");
eq(X.odGoalsParse(null).goals, [], "no grid, no rows");
// v563: the export's own folding (seen live 2026-10-23): row 1 carries title + mission + section + AREA in one cell.
const folded = X.odGoalsParse([["", "Team Goals 2026–2027 Our goal: Be the best electrical contractor in Utah. That means jobs built right the first time. REST OF 2026  ·  OCTOBER – DECEMBER AREA", "GOAL", "WHO", "BY", "STATUS"], ...grid.slice(4)]);
eq([folded.goals.length, folded.measures.length, folded.quarters.length, folded.goals[0].status, folded.goals[1].status], [8, 10, 4, "", "On track"], "folded first row still yields every section and the STATUS column");
assert.ok(folded.mission.startsWith("Be the best electrical contractor") && !/REST OF/.test(folded.mission) && !/AREA$/.test(folded.mission), "mission is cut out of the folded cell cleanly: " + folded.mission);
eq(folded.title, "Team Goals 2026–2027");

// 2. DUE
eq(X.odGoalDue("Oct 31", now).text, "Due in 8 d");
eq(X.odGoalDue("Nov 30", now).text, "Due in 38 d");
eq([X.odGoalDue("Jan", now).due.getFullYear(), X.odGoalDue("Jan", now).due.getMonth()], [2027, 0], "a bare month behind us is next year");
eq(X.odGoalDue("Weekly, ongoing", now), null);
eq(X.odGoalDue("Starting now", now), null);
eq(X.odGoalDue("Oct 1", now).text, "Overdue 22 d");
eq(X.odGoalDue("Dec 15, 2026", now).days, 53);

// 3. STATUS
eq(X.odGoalStatus("Done", X.odGoalDue("Jan", now)), { text: "Done", tone: "good" });
eq(X.odGoalStatus("At risk", null).text, "At risk");
eq(X.odGoalStatus("", X.odGoalDue("Oct 31", now)), { text: "Due in 8 d", tone: "bad" }, "blank status shows the due flag");
eq(X.odGoalStatus("", null), { text: "No status yet", tone: "grey" });

// 4. MEASURES — same math as the server copy, on the same slim rows.
const slimJob = (id, over) => G.slimJob({ ID: id, Name: "J" + id, Technicians: [{ Name: "Keegan Wilkinson" }], Total: { ExTax: 10000 }, CustomFields: [],
  Totals: { InvoicePercentage: 100, NettMargin: { Actual: 12.5 }, NettProfitLoss: { Actual: 1250 }, MaterialsCost: { Actual: 3000 }, ResourcesCost: { Labor: { Actual: 4000 }, LaborHours: { Actual: 130, Estimate: 100 } } }, ...over });
const slim = [slimJob(1), slimJob(2, { Totals: { InvoicePercentage: 100, NettMargin: { Actual: 20 }, NettProfitLoss: { Actual: 2000 }, MaterialsCost: { Actual: 1 }, ResourcesCost: { Labor: { Actual: 1 }, LaborHours: { Actual: 100, Estimate: 100 } } } }),
  slimJob(3, { Technicians: [{ Name: "Colby Fogh" }], Totals: { InvoicePercentage: 100, NettMargin: { Actual: 5 }, NettProfitLoss: { Actual: 500 }, MaterialsCost: { Actual: 1 }, ResourcesCost: { Labor: { Actual: 1 }, LaborHours: { Actual: 160, Estimate: 100 } } } }),
  slimJob(4, { Totals: { InvoicePercentage: 50 } })];
eq(X.odGoalsMeasures(slim), G.measures(slim), "dashboard and function agree");
eq([X.odGoalsMeasures(slim).counted, X.odGoalsMeasures(slim).marginPct, X.odGoalsMeasures(slim).hoursPct, X.odGoalsMeasures(slim).at15], [3, 12.5, 130, 1]);

// 5. MODEL
const d = { firsts: [{ pass: true }, { pass: false }, { pass: true }, { pass: true }], attnBy: { coOld: { rows: [1, 2] }, quiet: { rows: [{}] } }, active: [{}, {}, {}],
  openQs: [{ at: "2026-10-01T10:00:00Z" }, { at: "2026-10-23T07:00:00Z" }], rtSum: { open: 3, late: 1, none: 1 }, notRebooked: [{}] };
const noSim = X.odGoalsModel({ sheet, sim: null, sb: null, d, plans: { waiting: 2, oldest: 18 }, now });
const simCards = noSim.measures.filter(x => ["margin", "commercial", "hoursCompany", "hoursForeman", "collect"].includes(x.key));
eq(simCards.length, 5, "five sheet measures map to Simpro cards");
eq(simCards.map(x => x.live.sub), Array(5).fill("No Simpro pull yet"), "no doc → every Simpro card says so, the tab still renders");
eq(noSim.measures.filter(x => !x.key).map(x => x.name.slice(0, 8)), ["Warranty", "Change o", "Home Dep", "Jobs wit", "Shop and"], "the five hand / Phase 2 measures have no live card");
eq(noSim.extra.map(e => e.key), ["firstPass", "coOld", "quiet", "questions", "returnTrips", "rebook", "plans"], "app-measured goals the sheet does not name");
eq(noSim.extra[0].value, "75%");
eq(noSim.extra[3].sub, "open crew questions · 1 older than 2 days");
eq(noSim.counts, { goals: 8, done: 1, dueSoon: 2, measures: 10, atGoal: 0, tracked: 0, daysLeft: 69 });
eq(noSim.quarters.map(q => q.next), [true, false, false, false], "Q1 2027 is next on Oct 23 2026");
eq(noSim.goals[9 - 4].pill, { text: "Due in 8 d", tone: "bad" }, "Josh's Oct 31 invoicing goal is flagged");
eq(noSim.goals[6].pill.text, "Done");

const sim = { generated_at: "2026-10-23T11:40:00Z", year: 2026, jobs: slim, invoices: { count: 5, paid: { n: 2, avgDays: 40, medianDays: 40 }, open: { n: 2, owed: 8000, pastDueN: 1, pastDue: 5000, over60N: 1, over60: 3000 }, byDivision: { commercial: 2000, residential: 9100, other: 0 } } };
const sb = { prog: [{ contract: 1000000, division: "commercial" }, { contract: 3000000, division: "residential" }] };
const withSim = X.odGoalsModel({ sheet, sim, sb, d, now });
const card = (k) => withSim.measures.find(x => x.key === k).live;
eq([card("margin").value, card("margin").tone, card("margin").sub], ["12.5%", "bad", "3 jobs invoiced in 2026, fully invoiced, costs posted · 1 of them at 15% or better"]);
eq([card("hoursCompany").value, card("hoursCompany").tone], ["130%", "bad"]);
eq(card("hoursForeman").value, "—", "nobody has 3 counted jobs in this fixture");
eq([card("commercial").value, card("commercial").sub], ["18%", "$2k of $11k invoiced in 2026 · in progress: 25% of $4.00M contract value is commercial"]);
eq([card("collect").value, card("collect").tone], ["40 d", "good"]);
eq(withSim.counts.tracked, 5); eq(withSim.counts.atGoal, 1);
assert.ok(withSim.measures.find(x => x.key === "margin").rule.includes("Builder Scorecard"), "the rule travels with the card");
// A sheet row that names an app-measured goal lights it up and leaves `extra`.
const sheet2 = X.odGoalsParse([...grid.slice(0, 24), ["", "✅  First-pass inspection rate", "72%", "90% or better", "", ""], ...grid.slice(24)]);
const m2 = X.odGoalsModel({ sheet: sheet2, sim, sb, d, now });
eq(m2.measures.find(x => x.key === "firstPass").live.value, "75%");
eq(m2.extra.map(e => e.key).includes("firstPass"), false);
eq(X.odGoalsModel({ sheet: null, sim: null, sb: null, d: null, now }).counts.goals, 0, "nothing loaded yet renders empty, not a crash");

console.log("goals-model-test: all checks passed");
