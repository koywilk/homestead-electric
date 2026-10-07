#!/usr/bin/env node
/**
 * Offline preview of the Weekly Lead Meeting prefill — NO Firestore, NO Simpro, NO Google calls.
 *
 *   node scripts/foremanprep-fixture.js
 *
 * Feeds the real builder (functions/foremanMeetingPrep.js + leadMeetingPrep.js) a small made-up
 * board whose numbers are copied from the Oct 7, 2026 meeting, prints what the doc would say,
 * then runs two checks:
 *   1. the "moved since last week" filter (jobs that did not move must be absent)
 *   2. the round trip: the section the run writes must parse back into the same margins, because
 *      next week's run falls back to that when no saved snapshot exists.
 * The live version of this is scripts/foremanprep-dryrun.js (needs the service-account JSON).
 */
const path = require("path");
const lib = require(path.join(__dirname, "../functions/foremanMeetingPrep.js"));
const leadLib = require(path.join(__dirname, "../functions/leadMeetingPrep.js"));

const now = new Date("2026-10-06T22:00:00Z");           // Tue Oct 6, 2026 4:00 PM Mountain
const job = (sn, name, o = {}) => ({ id: "j" + sn, simproNo: String(sn), name, foreman: "", lead: "", ...o });
const rough = (sn, name, o) => job(sn, name, { roughStatus: "inprogress", roughStage: "50", ...o });
const finish = (sn, name, o) => job(sn, name, { roughStatus: "complete", finishStatus: "inprogress", finishStage: "50", ...o });
const done = (sn, name, date, o) => job(sn, name, { roughStatus: "complete", finishStatus: "complete", finishStatusDate: date, ...o });

const jobs = [
  rough(959, "Stratton Residence", { roughStage: "95", lead: "Colby Fogh", roughUpdates: [{ date: "2026-10-02", text: "Waiting on bedroom 6&7 changes." }] }),
  rough(1438, "Miller Residence - Alpine", { roughStage: "55", lead: "Keegan Wilkinson", roughProjectedStart: "2026-10-09" }),
  rough(1454, "Oak Hill 5 - Alpine", { roughStage: "5", lead: "Louis Hoffman" }),
  rough(1430, "Brandt Residence", { roughStage: "95", lead: "Gage Lund" }),
  rough(9001, "Hold Steady Residence", { roughStage: "40", lead: "Jacob Spackman" }),              // margin did not move
  rough(9002, "Brand New Job", { roughStage: "10", lead: "Daegan Smith" }),                        // not in last week's snapshot
  finish(920, "Mangum Residence", { finishStage: "70", lead: "Louis Hoffman", finishUpdates: [{ date: "2026-10-05", text: "Trim out in the kitchen." }] }),
  finish(1230, "Nguyen Residence", { finishStage: "90", lead: "Daegan Smith" }),
  finish(1333, "Meyers", { finishStage: "95", lead: "Gage Lund" }),                                // margin did not move
  done(5001, "Nelson ADU - Detached Garage Power Feed", "2026-10-01"),
  done(5002, "Nguyen Remodel - Holladay", "2026-10-06"),
  done(5003, "Old Closed Job", "2026-09-10"),                                                      // closed 4 weeks ago: not "since last meeting"
];
const hrs = (used, est) => ({ used, est });
const simproTotalsById = {
  959: { margin: 51, rough: hrs(2079, 1370) },
  1438: { margin: 64, rough: hrs(608, 617) },
  1454: { margin: 83, rough: hrs(111, 543) },
  1430: { margin: 28, rough: hrs(551, 310) },
  9001: { margin: 55, rough: hrs(100, 200) },
  9002: { margin: 40, rough: hrs(20, 300) },
  920: { margin: 25, rough: hrs(250, 203), finish: hrs(340, 203) },
  1230: { margin: 11, rough: hrs(94, 69), finish: hrs(116, 69) },
  1333: { margin: 18, rough: hrs(100, 267), finish: hrs(66, 125) },
  5001: { margin: 20, isEstimate: true, finish: hrs(0, 5) },
  5002: { margin: -7, rough: hrs(200, 120), finish: hrs(204, 115) },
  5003: { margin: 30, finish: hrs(50, 60) },
};
// Last week's margins — what the saved snapshot would hold (everything except Brand New Job).
const byJob = {};
[[959, 56], [1438, 72], [1454, 96], [1430, 30], [9001, 55], [920, 26], [1230, 16], [1333, 18]].forEach(([sn, margin]) => { byJob[sn] = { margin, name: "" }; });
const marginBaseline = { at: new Date("2026-09-29T12:00:00Z"), complete: true, byJob, byName: {} };

const board = leadLib.buildModel({ jobs, upcoming: [], pto: [], featuresMd: null, notesDoc: null, now });
const model = lib.buildModel({
  jobs, needs: [], pto: [{ name: "Colby Fogh", start: "2026-10-05", end: "2026-10-15", note: "vacation" }, { name: "Jacob Spackman", start: "2026-10-08" }],
  scheduleEntries: [], simproTotalsById, lastActions: { fromLabel: "Sep 30, 2026", open: ["Colby / Jacob — real start date for Pierce (#1277) — by when"] },
  upcoming: [{ name: "Tuhaye Lot 10", projectedStart: "2026-09-28" }], upcomingBoard: board.upcoming,
  shipped: [{ title: "Drag and drop files onto any upload spot" }], now, crew: [],
  lookahead: leadLib.lookAheadRows(board), marginBaseline,
});
const lines = lib.renderLines(model);

console.log("=== WHAT THE DOC WOULD SAY (Tue Oct 6 run; fixture data, not live) ===\n");
lines.forEach(l => {
  const t = l.text.replace(/^\t/, "      ◦ ");
  const pre = { h1: "# ", h2: "\n## ", h3: "### ", h4: "  ** ", bullet: l.text.startsWith("\t") ? "" : "  • ", check: "  ☐ ", grey: "  (grey) ", p: "" }[l.kind];
  console.log(pre + t);
});

// ── checks ──
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) bad++; };
const text = lines.map(l => l.text).join("\n");
console.log("\n=== CHECKS ===");
const hoursText = text.slice(text.indexOf("Hours vs bid"), text.indexOf("Action items"));
check(!/Hold Steady/.test(hoursText) && !/Meyers/.test(hoursText), "jobs whose margin did not move (Hold Steady, Meyers) are not in Hours vs bid");
check(/Stratton Residence/.test(text) && /margin 51% \(was 56% last week\)/.test(text), "Stratton shows 'margin 51% (was 56% last week)'");
check(/Brand New Job/.test(text) && /margin 40% \(new\)/.test(text), "a job missing from the snapshot is tagged (new)");
check(/Nelson ADU/.test(text) && /Nguyen Remodel/.test(text) && !/Old Closed Job/.test(text), "completed list = closed since last meeting only");
check(/Hit 15%/.test(text) && /Missed 15%/.test(text), "completed jobs grouped Hit 15% / Missed 15%");
check(/Colby Fogh — Oct 5–Oct 15\b(?!,)/.test(text), "Crew out has no reasons");
check(lines.findIndex(l => l.text === "Hours vs bid") > lines.findIndex(l => l.text === "Schedule Look Ahead"), "section order: Look Ahead before Hours vs bid");
const colored = lines.filter(l => (l.spans || []).some(s => s.rgb && (s.rgb[0] !== 0 || s.rgb[1] !== 0 || s.rgb[2] !== 0))).length;
check(colored > 0, `margins are colored (${colored} colored lines)`);

// Round trip: render → fake Docs JSON → parseLastMargins must give back the printed margins.
const fakeDoc = { body: { content: lines.map(l => ({ paragraph: {
  elements: [{ textRun: { content: l.text.replace(/^\t/, "") + "\n" } }],
  paragraphStyle: { namedStyleType: { h1: "HEADING_1", h2: "HEADING_2", h3: "HEADING_3" }[l.kind] || "NORMAL_TEXT" },
  ...(l.kind === "bullet" || l.kind === "check" ? { bullet: l.text.startsWith("\t") ? { nestingLevel: 1 } : {} } : {}),
} })) } };
const parsed = lib.parseLastMargins(fakeDoc);
check(parsed.byName.strattonresidence === 51 && parsed.byName.nguyenresidence === 11, "doc fallback reads the margins back (Stratton 51, Nguyen 11)");
check(parsed.at instanceof Date, "doc fallback reads the section's meeting date");
const acts = lib.parseLastActions(fakeDoc);
check(acts.open.length === 1 && /real start date for Pierce/.test(acts.open[0]), "next week's run carries the unchecked action item (and skips the Owner placeholder)");
check(acts.fromLabel === "Oct 7, 2026", "action items read from the newest 'Weekly Lead Meeting' section");
console.log(`\n${bad ? bad + " check(s) FAILED" : "all checks passed"}`);
process.exit(bad ? 1 : 0);
