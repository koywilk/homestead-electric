// Lead Meeting Prep pure-module tests — run: node scripts/leadprep-test.js
"use strict";
const L = require("../functions/leadMeetingPrep.js");
let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}
const NOW = new Date("2026-09-08T12:00:00Z"); // Tue Sep 8 2026, 6:00 AM MT

const JOBS = [
  { id: "a", name: "Pierce Residence", foreman: "Colby Fogh", lead: "Lead TBD", roughStatus: "inprogress", roughStage: "0%", roughProjectedStart: "9/7/2026",
    statusUpdate: "Underground should start 6/4", statusUpdateBy: "Colby Fogh", statusUpdateAt: "2026-05-22T10:00:00Z" },
  { id: "b", name: "Webb", foreman: "Gage Lund", lead: "Gage Lund", roughStatus: "complete", finishStatus: "inprogress", finishStage: "40%", finishProjectedStart: "8/12/2026",
    finishUpdates: [{ date: "3-17-26", text: "old" }, { date: "8/12/2026", text: "Whole house is boxed", addedBy: "Gage Lund" }],
    statusUpdate: "Design walk week of 8/14", statusUpdateBy: "Koy Wilkinson", statusUpdateAt: "2026-09-02T10:00:00Z" },
  { id: "c", name: "Cowdrey", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finishProjectedStart: "4/3/2026",
    finishUpdates: [{ date: "4/17/2026", text: "trim out", addedBy: "Keegan" }] },
  { id: "d", name: "Ashcraft", foreman: "Vasa Mataafa", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "9/14/2026", statusUpdate: "mid-late Sept", statusUpdateAt: "2026-07-27T10:00:00Z" },
  { id: "e", name: "Becker", foreman: "Keegan Wilkinson", roughStatus: "" },
  { id: "f", name: "Garage Panel Breakers", foreman: "Unassigned", roughStatus: "" },
  { id: "g", name: "#2453 - Koplin Residence - Mapleton", type: "quote" },
  { id: "h", name: "Skyridge Lot 208 - Mayflower", foreman: "Keegan Wilkinson", roughStatus: "waiting", roughStage: "75%", statusUpdate: "need holes cored", statusUpdateAt: "2026-08-25T10:00:00Z" },
  { id: "i", name: "Done House", roughStatus: "complete", finishStatus: "complete" },
  { id: "j", name: "Temp ped", tempPed: true, roughStatus: "inprogress" },
  { id: "k", name: "Example Job", roughStatus: "inprogress" },
  { id: "l", name: "Passed House", roughStatus: "inprogress", roughInspectionDate: "9/4/2026", roughInspectionResult: "pass" },
  { id: "m", name: "Failed House", roughStatus: "complete", finishStatus: "inprogress", finalInspectionDate: "2026-09-05", finalInspectionResult: "fail",
    finishUpdates: [{ date: "9/5/2026", text: "failed final", addedBy: "Vasa" }] },
];
const UPCOMING = [
  { name: "#2385 - Skyridge Lot 208 - Mayflower", customer: "Trek", sales: "Brady", notes: "Follow up", lastFollowUp: "6/16/2026" },
  { name: "#2443 - Whitaker Farms 27", customer: "Branca Homes", sales: "Justin", notes: "Framing nearing completion", lastFollowUp: "7/16/2026", projectedStart: "" },
  { name: "#2478 - Miller Residence", customer: "Robison", sales: "Brady", projectedStart: "9/14/2026" },
];
const PTO = [
  { name: "Gage Lund", start: "9/15/2026", end: "9/21/2026", note: "Vacation" },
  { name: "Old Guy", start: "7/13/2026", end: "7/16/2026" },
  { name: "Far Guy", start: "10/13/2026", end: "10/16/2026" },
];
const FEATURES = [
  "- **Job Prep tab — redline walk strip** · `shipped 2026-09-02` · `SW v390` · long text",
  "  - **QC status flips per phase** · `shipped 2026-09-05` · `SW v391` · Koy: quoted text",
  "- **Old thing** · `shipped 2026-08-31` · `SW v340` · 8 days ago — outside the window",
  "- **Untagged** · `shipped` · no date",
  "  - Kanban inline cleanup · `shipped 2026-09-06` · `SW v392` · plain (non-bold) sub-entry title",
].join("\n");
// Minimal Google Docs API shape: body.content[].paragraph.{elements[].textRun.content, bullet?}
const P = (text, bullet) => ({ paragraph: { elements: [{ textRun: { content: text + "\n" } }], ...(bullet ? { bullet: { listId: "x" } } : {}) } });
const NOTES_DOC = { body: { content: [
  P("Sep 9, 2026 | Weekly Lead Meeting"), P("Attendees: a b"), P("Notes"), P("", true), P("Action items"), P("", true),
  P("Sep 2, 2026 | Weekly Lead Meeting"), P("Notes"), P("Things are turning around", true), P("Action items"), P("Colby to order Pierce panel", true), P("Koy: call Webb designer", true), P(""),
  P("Aug 26, 2026 | Weekly Lead Meeting"), P("Action items"), P("stale item", true),
] } };

console.log("dates:");
t("US slash", L.toDateAny("8/12/2026").getDate() === 12);
t("US hyphen 2-digit year", L.toDateAny("3-17-26").getFullYear() === 2026);
t("ISO", L.toDateAny("2026-09-05").getMonth() === 8);
t("timestamp-ish", L.toDateAny({ _seconds: 1788390380 }) instanceof Date);
t("garbage null", L.toDateAny("soon") === null);

console.log("extractShipped:");
const sh = L.extractShipped(FEATURES, new Date(2026, 8, 8));
t("three within 7 days (incl. plain-title sub-entry)", sh.length === 3, JSON.stringify(sh));
t("title + version parsed", sh[0] && sh[0].title === "Job Prep tab — redline walk strip" && sh[0].version === "v390");
t("old + untagged skipped", !sh.some(s => s.title === "Old thing" || s.title === "Untagged"));
t("plain-title sub-entry parsed", sh.some(s => s.title === "Kanban inline cleanup" && s.version === "v392"));
t("null md → []", L.extractShipped(null, new Date()).length === 0);

console.log("parseActionItems:");
const ai = L.parseActionItems(NOTES_DOC, new Date(2026, 8, 8));
t("picks newest dated section on/before today (Sep 2, not Sep 9)", ai.fromDate && ai.fromDate.getDate() === 2, JSON.stringify(ai));
t("two items carried", ai.rows.length === 2 && ai.rows[0] === "Colby to order Pierce panel");
t("stops at next section", !ai.rows.includes("stale item"));
t("empty doc → no rows", L.parseActionItems(null, new Date()).rows.length === 0);

console.log("buildModel:");
const m = L.buildModel({ jobs: JOBS, upcoming: UPCOMING, pto: PTO, featuresMd: FEATURES, notesDoc: NOTES_DOC, now: NOW });
t("meeting is Wed Sep 9", /Wednesday, September 9, 2026/.test(m.meetingLabel), m.meetingLabel);
const rn = m.rough.rows.map(r => r.name);
t("rough = in progress + waiting, no temp ped / Example Job", rn.includes("Pierce Residence") && rn.includes("Skyridge Lot 208 - Mayflower") && !rn.includes("Temp ped") && !rn.includes("Example Job"), rn.join(","));
t("rough flags missing lead", m.rough.rows.find(r => r.name === "Pierce Residence").flags.includes("no lead"));
t("finish moving has Webb (status line 6d old)", m.finish.moving.some(r => r.name === "Webb"));
t("Webb line uses freshest text (status update beats older daily update)", m.finish.moving.find(r => r.name === "Webb").update === "Design walk week of 8/14");
t("finish quiet has Cowdrey (144d)", m.finish.quiet.some(r => r.name === "Cowdrey"));
t("Done House excluded everywhere", !m.finish.moving.concat(m.finish.quiet).some(r => r.name === "Done House"));
const un = m.upcoming.map(u => u.name);
t("upcoming: pipeline + quote + owned rough-not-started + finish start ≤60d", un.includes("#2443 - Whitaker Farms 27") && un.includes("#2453 - Koplin Residence - Mapleton") && un.includes("Becker") && un.includes("Ashcraft (finish)"), un.join(" | "));
t("upcoming: unowned undated stub dropped", !un.includes("Garage Panel Breakers"));
t("upcoming: pipeline row for a job already on the board dropped", !un.includes("#2385 - Skyridge Lot 208 - Mayflower"));
t("upcoming sorted dated-first", m.upcoming[0].name === "#2478 - Miller Residence" || m.upcoming[0].name === "Ashcraft (finish)", m.upcoming[0].name);
t("pto: only next 14 days", m.pto.length === 1 && m.pto[0].name === "Gage Lund", JSON.stringify(m.pto));
t("highlight from pass ≤7d", m.highlights.length === 1 && /Passed House/.test(m.highlights[0]));
t("lowlight from fail ≤7d", m.lowlights.length === 1 && /Failed House/.test(m.lowlights[0]));
t("shipped rows", m.shipped.rows.length === 3 && !m.shipped.error);
t("actions carried", m.actions.rows.length === 2 && !m.actions.error);
t("counts", m.counts.rough === rn.length && m.counts.upcoming === un.length);

console.log("degradation:");
const bad = L.buildModel({ jobs: null, upcoming: null, pto: null, featuresMd: null, notesDoc: null, now: NOW });
t("null inputs never throw", bad && Array.isArray(bad.rough.rows) && bad.shipped.error === true && bad.actions.error === true);
const html = L.renderHtml(m);
if (process.env.LEADPREP_DUMP) require("fs").writeFileSync(process.env.LEADPREP_DUMP, html); // debug affordance
t("html has every section", ["Notes", "Highlight", "Lowlight", "Training", "Schedule Look Ahead", "Rough", "Finish", "Upcoming", "Crew out", "Action items"].every(s => html.includes(s)));
t("presenting style: no foreman/stage/age/flag detail", !/d ago|⚑|Colby Fogh|95%|in progress/.test(html));
t("job line = name — plain phrase", html.includes("Webb — Design walk week of 8/14") && html.includes("Rose") === false || html.includes("Webb — Design walk week of 8/14"));
t("date beats prose", html.includes("Ashcraft finish — Sep 14</li>"));
t("leading bullet glyphs stripped", !/— [•·]/.test(html));
t("quiet jobs not rendered", !html.includes("Cowdrey"));
t("training = bare titles", html.includes("Job Prep tab — redline walk strip") && !html.includes("v390"));
t("carried action items rendered", html.includes("Colby to order Pierce panel"));
t("html escapes", L.renderHtml(L.buildModel({ jobs: [{ id: "x", name: "<b>X</b>", roughStatus: "inprogress" }], now: NOW })).includes("&lt;b&gt;X&lt;/b&gt;"));
t("no handbook section", !/handbook/i.test(html));

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nall leadprep tests passed");
