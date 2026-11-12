#!/usr/bin/env node
/* dash-history-test.js — dashboard history, feed health, and the Simpro totals carry-forward
 * (v626 ship 2, dashboard audit 2026-11-11). Pure functions from functions/dashHistory.js and
 * functions/simproSync.js, on shapes read from the live docs that night.
 * Proves:
 *   1. Feed health: on-schedule feeds are ok; a late feed, a missing feed and a failed run are not;
 *      the weekday-only Simpro totals feed is fine over a weekend and until Monday's pull.
 *   2. The daily row: Goals numbers, per-technician rows, in-progress money from the totals copy,
 *      and nothing breaks when a doc is missing.
 *   3. Year end: last year's Goals doc is kept once; the same year is never copied.
 *   4. Totals carry-forward: fresh entries get today's date, the rest keep their own, a job gone
 *      from the app or an entry over 180 days old is dropped.
 * Exit 1 on any failure. Runs in prebuild.
 */
"use strict";
const assert = require("assert");
const H = require("../functions/dashHistory.js");
const S = require("../functions/simproSync.js");
const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);
// Mountain time is UTC-7 in November (standard time).
const mt = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo, d, h + 7, mi));

// 1 · FEED HEALTH — the real night of Wed 2026-11-11 (all four ran), checked at 6:45 AM.
const wed = mt(2026, 10, 11, 6, 45);
const at = { costs: "2026-11-11T11:15:14.952Z", scoreboard: "2026-11-11T12:21:29.641Z", goals: "2026-11-11T12:40:12.748Z", totals: "2026-11-11T13:15:32.985Z" };
let f = H.feedHealth({ at, runs: {}, now: wed });
eq(Object.keys(f), ["costs", "scoreboard", "goals", "totals"]);
eq(Object.values(f).map(x => x.ok), [true, true, true, true], "the night everything ran");
eq([f.totals.label, f.totals.ageH], ["Simpro totals", 0.5]);
eq(H.localDay(wed), { ymd: "2026-11-11", dow: 3 }, "Mountain date and weekday, whatever the server clock");
eq(H.localDay(new Date("2026-11-12T03:30:00.000Z")).ymd, "2026-11-11", "8:30 PM Mountain is still the 11th");
// Goals did not run last night: its data is from the morning before.
f = H.feedHealth({ at: { ...at, goals: "2026-11-10T12:40:00.000Z" }, runs: {}, now: mt(2026, 10, 12, 6, 45) });
assert.ok(!f.goals.ok && f.goals.late && f.goals.ageH > 30, "a goals pull 42 hours old is late");
// A failed run newer than the data says why.
f = H.feedHealth({ at, runs: { feedGoals: { lastRunAt: "2026-11-11T12:41:00.000Z", ok: false, error: "only 100 of 204 jobs came back" } }, now: wed });
eq([f.goals.ok, f.goals.late, f.goals.error], [false, false, "only 100 of 204 jobs came back"], "fresh-looking data but the newest run failed");
f = H.feedHealth({ at, runs: { feedGoals: { lastRunAt: "2026-11-10T12:41:00.000Z", ok: false, error: "x" } }, now: wed });
assert.ok(f.goals.ok, "an old failure followed by a good pull is fine");
f = H.feedHealth({ at, runs: { feedGoals: { lastRunAt: "2026-11-11T12:41:00.000Z", ok: false, error: "x", test: true } }, now: wed });
assert.ok(f.goals.ok, "a test run's result is not the feed's");
eq(H.feedHealth({ at: {}, runs: {}, now: wed }).costs, { label: "Job Costs", at: "", ageH: null, late: true, ok: false, error: "" }, "no data time at all");
// Weekday-only feed: Friday 6:15 AM copy.
const fri = "2026-11-13T13:15:00.000Z";
const totalsOk = (now) => H.feedHealth({ at: { ...at, totals: fri }, runs: {}, now }).totals.ok;
eq([totalsOk(mt(2026, 10, 14, 6, 45)), totalsOk(mt(2026, 10, 15, 6, 45)), totalsOk(mt(2026, 10, 16, 6, 45)), totalsOk(mt(2026, 10, 17, 6, 45))], [true, true, false, false],
  "Friday's copy is fine Saturday and Sunday; at Monday's 6:45 check it means Monday's 6:15 pull was missed");
assert.ok(H.feedHealth({ at: { ...at, totals: "2026-11-16T13:15:00.000Z" }, runs: {}, now: mt(2026, 10, 16, 6, 45) }).totals.ok, "Monday's own pull is fine on Monday");
eq([H.maxAgeHours(H.FEEDS[0], wed), H.maxAgeHours(H.FEEDS[3], wed)], [30, 30]);

// 2 · THE DAILY ROW
const goals = { year: 2026, generated_at: at.goals, counts: { counted: 152 },
  measures: { counted: 152, marginPct: 10.6, hoursPct: 136, at15: 79, byTech: [{ tech: "Daegan Smith", n: 16, marginPct: 19.4, hoursPct: 128 }, { tech: "UNASSIGNED", n: 22, marginPct: 21.8, hoursPct: 47 }] },
  phase2: { hours: { warranty: { sharePct: 2.2 }, co: { hours: 310.44 } }, storeRuns: { total: 180 }, weekly: { weeksAll: 0 } } };
const totals = { at: at.totals, byNo: {
  "959": { total: 600879.08, inv: 432367.83, invPct: 71.96, stage: "Progress" },
  "1430": { total: 72735.14, inv: 41477.41, invPct: 57.03, stage: "Progress" },
  "920": { total: 82078.72, inv: 82078.72, invPct: 100, stage: "Invoiced" },
  "9": { stage: "Progress" } } };
const row = H.snapshotRow({ goals, costs: { generated_at: at.costs, counts: { jobs: 209, failed: 0 } }, scoreboard: { generated_at: at.scoreboard, counts: { done: 400, prog: 45 } }, totals, feeds: H.feedHealth({ at, runs: {}, now: wed }), now: wed });
eq([row.date, row.goals.marginPct, row.goals.hoursPct, row.goals.counted, row.goals.at15, row.goals.warrantyPct, row.goals.coHours, row.goals.storeRuns, row.goals.weeksAllTracked], ["2026-11-11", 10.6, 136, 152, 79, 2.2, 310.4, 180, 0]);
eq(row.goals.byTech[0], { tech: "Daegan Smith", n: 16, marginPct: 19.4, hoursPct: 128 });
eq(row.simpro, { pulledAt: at.totals, entries: 4, inProgress: 2, contract: 673614, invoiced: 473845, leftToBill: 199769 }, "in-progress jobs with a total only; an invoiced job is not 'left to bill'");
eq([row.costs.jobs, row.scoreboard.done, row.feeds.goals.ok], [209, 400, true]);
const empty = H.snapshotRow({ now: wed });
eq([empty.date, empty.goals, empty.costs, empty.scoreboard, empty.simpro, empty.feeds], ["2026-11-11", null, null, null, null, {}], "missing docs make an honest empty row, not a crash");
assert.ok(Buffer.byteLength(JSON.stringify(row)) < 4000, "a day's row stays small");

// 3 · YEAR END
const keep = H.goalsYearEndCopy({ year: 2026, measures: { marginPct: 10.6 }, jobs: [1, 2] }, 2027);
eq([keep.id, keep.doc.year, keep.doc.measures.marginPct, keep.doc.jobs.length], ["goalsSimpro_2026", 2026, 10.6, 2], "the whole doc, under last year's name");
assert.ok(/final 2026 numbers/.test(keep.doc.keptWhy));
eq([H.goalsYearEndCopy({ year: 2026 }, 2026), H.goalsYearEndCopy(null, 2027), H.goalsYearEndCopy({}, 2027), H.goalsYearEndCopy({ year: 2027 }, 2026)], [null, null, null, null], "same year, no doc, no year, or a newer doc: nothing to keep");

// 4 · TOTALS CARRY-FORWARD (settings/simproTotals.byNo)
const NOW = "2026-11-12T13:15:00.000Z";
const prev = { "920": { invPct: 100, stage: "Invoiced", at: "2026-11-10T13:15:00.000Z" }, "1406": { invPct: 100, stage: "Invoiced" }, "555": { invPct: 40, stage: "Progress", at: "2026-11-11T13:15:00.000Z" },
  "old": { invPct: 100, at: "2026-04-01T13:15:00.000Z" }, "junk": "x" };
const out = S.carryTotals(prev, { "1406": { invPct: 98.6, stage: "Complete" }, "959": { invPct: 72 } }, { live: new Set(["920", "1406", "959", "old"]), nowIso: NOW, prevAt: "2026-11-11T13:15:32.985Z" });
eq(out["1406"], { invPct: 98.6, stage: "Complete", at: NOW }, "re-read today: today's numbers and date");
eq(out["959"].at, NOW);
eq(out["920"], { invPct: 100, stage: "Invoiced", at: "2026-11-10T13:15:00.000Z" }, "not re-read: kept, with its own date");
eq(Object.keys(out).sort(), ["1406", "920", "959"], "a job gone from the app (555), an entry over 180 days old, and junk are dropped");
eq(S.carryTotals({ "7": { invPct: 1 } }, {}, { nowIso: NOW, prevAt: "2026-11-11T13:15:32.985Z" })["7"], { invPct: 1, at: "2026-11-11T13:15:32.985Z", atGuess: true }, "an entry from before entries had dates takes the old doc's date, marked as a guess");
assert.ok(!("atGuess" in out["920"]) && !("atGuess" in out["1406"]), "dated and fresh entries are not guesses");
eq(S.carryTotals({ "7": { invPct: 1 } }, {}, { nowIso: NOW }), {}, "…and with no date to give it, it is not carried");
eq(S.carryTotals(null, null, { nowIso: NOW }), {});

console.log("dash-history-test: all checks passed");
