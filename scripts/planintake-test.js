// Plan-intake walk rules tests — run: node scripts/planintake-test.js (in the prebuild chain)
// Fixtures are Koy's real Jul–Sep 2026 calendar (title + location + creator only).
"use strict";
const W = require("../functions/planIntake/walks.js");
const assert = require("assert");
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

const MEET = { conferenceUrl: "https://meet.google.com/abc-defg-hij" };   // every event has one
const ev = (who, summary, location, extra = {}) =>
  ({ ...MEET, creator: { email: `${who}@homesteadelectric.net` }, summary, location, status: "confirmed", ...extra });

const cases = [
  // [event, kind, address tokens or null]
  [ev("josh", "Tolbert Residence - Redline Walkthrough", "1326 S 5360 E"), "walk", ["s", "5360", "e"]],
  [ev("justin", "Brandt Walk", "721 S 2200 E"), "walk", ["s", "2200", "e"]],
  [ev("josh", "Quote Walk - 4654 Holly Lane Remodel - Black Cactus Constructon", "4654 Holly Ln"), "walk", ["holly"]],
  [ev("justin", "Koplin Walk ", "1915 S Preserve Dr"), "walk", ["preserve"]],
  [ev("justin", "Skyridge 208 Walk", "1839 W Aries Pl"), "walk", ["aries"]],
  [ev("brady", "Edge Builders - Site Walk ", "7085 Glenwild Dr, Park City, UT 84098"), "walk", ["glenwild"]],
  [ev("brady", "Pierce Walk", "4535 North Old Ranch Road, Park City"), "walk", ["old", "ranch"]],
  [ev("brady", "Lot 91 - Redline Walk", undefined), "walk", null],
  [ev("brady", "Murphy Redlines", undefined), "walk", null],
  [ev("brady", "Kweller Designer walk", undefined), "walk", null],
  [ev("brady", "Miller AV Walk", undefined), "walk", null],
  [ev("justin", "Prosteel Walk", "Browning Safes & Pro-Steel Security Products"), "walk", null],
  [ev("josh", "Oak hill 5 - E Builders/Homestead", undefined), "maybe", null],
  [ev("brady", "Dave Hatton/Cowdrey Barn ", undefined), "maybe", null],
  [ev("josh", "Foreman Meeting", undefined), "skip", null],
  [ev("brady", "Kweller generator Google meet", undefined), "skip", null],
  [ev("brady", "Cougar Moon - Trade Partner Meeting", "8601 N Lark Pl"), "skip", null],
  [ev("brady", "Miller Meeting", "973 S Main St"), "skip", null],
  [ev("justin", "Park City Showcase", undefined), "skip", null],
  [ev("josh", "Welliver Zoom Call Walkthrough - E Builders", undefined), "skip", null],
  [ev("brady", "Sandlin Design - Google Meet", undefined), "skip", null],
  [ev("brady", "James - 2nd Interview", undefined), "skip", null],
  [ev("brady", "James Livingston 1st Day", undefined), "skip", null],
  [ev("brady", "Lutron Show Room", "438 S Commerce Dr"), "skip", null],               // test run, 2026-10-04
  [ev("justin", "1 of 3 Truck Detail", undefined), "skip", null],               // first dry run, 2026-10-04
  [ev("josh", "New hire first day - orientation", "974 S Main St"), "skip", null],
  [ev("josh", "Weekly Scramble", "974 S Main St", { recurringEventId: "r1" }), "skip", null],
  [ev("koy", "Brandt Walk", "721 S 2200 E"), "skip", null],                      // Koy's own events
  [ev("keegan", "Some Walk", "721 S 2200 E"), "skip", null],                     // not a walker
  [ev("josh", "#1407 Tolbert walk", "1326 S 5360 E"), "skip", null],             // names a job number
  [ev("josh", "Job 1430 redline walk", undefined), "skip", null],
  [ev("josh", "Brandt Walk", "721 S 2200 E", { status: "cancelled" }), "skip", null],
  [ev("josh", "Site walk", "974 S Main St"), "walk", null],                       // office is not a site address
];
for (const [e, kind, tokens] of cases) {
  const c = W.classifyEvent(e);
  eq(c.kind, kind, `kind: "${e.summary}" (${c.reason})`);
  if (kind !== "skip") eq(c.address && c.address.tokens, tokens, `address: "${e.summary}"`);
}
eq(W.classifyEvent(null).kind, "skip", "null event");

// addresses
const A = W.extractAddress;
assert(W.sameAddress(A("4654 Holly Ln"), A("4654 Holly Lane")), "Ln == Lane");
assert(W.sameAddress(A("721 S 2200 E "), A("721 S 2200 E")), "trailing space");
assert(W.sameAddress(A("4535 North Old Ranch Road, Park City"), A("4535 Old Ranch Rd")), "named street drops direction");
assert(!W.sameAddress(A("1326 S 5360 E"), A("1326 E 5360 S")), "grid directions matter");
assert(!W.sameAddress(A("1326 S 5360 E"), A("1327 S 5360 E")), "house number matters");
assert(!W.sameAddress(A("4654 Holly Ln"), A("4654 Hollow Ln")), "street name matters");
assert(W.sameAddress(A("1326 S 5360"), A("1326 S 5360 E")), "missing trailing grid direction still matches");
eq(A("Lot 91 - Redline Walk"), null, "lot only is not an address");
eq(A("Skyridge 208 Walk"), null, "lot number is not an address");
eq(A(""), null, "empty");

// which quote — real Simpro shapes from the Tolbert and Brandt sites (2026-10-03)
const tolbertQuotes = [
  { ID: 2299, Name: "Tolbert Residence - Wasatch County", Stage: "Complete", DateIssued: "2025-11-21", IsClosed: true, JobNo: 1407, LinkedJobID: null },
  { ID: 2503, Name: "Tolbert Residence - Temp Ped", Stage: "Approved", DateIssued: "2026-01-22", IsClosed: true, JobNo: 1227, LinkedJobID: null },
  { ID: 3074, Name: "7/20 Additional Items", Stage: "Approved", DateIssued: "2026-07-21", IsClosed: true, JobNo: 1407, LinkedJobID: null },
  { ID: 3147, Name: "8/5 Misc. Changes", Stage: "Approved", DateIssued: "2026-08-11", IsClosed: true, JobNo: 1407, LinkedJobID: null },
];
const tolbertJobs = [
  { ID: 1407, Name: "Tolbert Residence - Wasatch County", Stage: "Progress", DateIssued: "2026-07-15", ConvertedFrom: { ID: 2299, Type: "Quote", Date: "2026-07-15T08:04:33-06:00" } },
  { ID: 1227, Name: "Tolbert Residence - Temp Ped", Stage: "Invoiced", DateIssued: "2026-01-26", ConvertedFrom: { ID: 2503, Type: "Quote", Date: "2026-01-26T17:00:24-07:00" } },
];
eq(W.pickQuote({ walkDate: "2026-07-08", quotes: tolbertQuotes, jobs: tolbertJobs }), { result: "quote", quoteId: 2299 },
  "Tolbert walk 7/8 → 2299 (CO quotes merged into 1407 and the temp ped are not the walk's quote)");
eq(W.pickQuote({ walkDate: "2026-08-20", quotes: tolbertQuotes, jobs: tolbertJobs }), { result: "existing_job", jobId: 1407, openQuoteIds: [] },
  "a walk after conversion lands on the existing job");

const brandtQuotes = [
  { ID: 2642, Name: "Brandt Residence - Springville", Stage: "Approved", DateIssued: "2026-03-05", IsClosed: true, JobNo: 1430, LinkedJobID: null },
  { ID: 3038, Name: "Temp Ped Fix", Stage: "Approved", DateIssued: "2026-07-08", IsClosed: true, JobNo: 1405, LinkedJobID: null },
  { ID: 3287, Name: "Flood Light Addition", Stage: "Approved", DateIssued: "2026-09-24", IsClosed: false, JobNo: null, LinkedJobID: 1430 },
  { ID: 3198, Name: "4 x Infratech Heaters W/Simple Controls", Stage: "Approved", DateIssued: "2026-08-31", IsClosed: false, JobNo: null, LinkedJobID: null },
];
const brandtJobs = [
  { ID: 1430, Name: "Brandt Residence - Springville", Stage: "Progress", DateIssued: "2026-08-24", ConvertedFrom: { ID: 2642, Type: "Quote", Date: "2026-08-24T11:10:14-06:00" } },
  { ID: 1405, Name: "Temp Ped Fix", Stage: "Archived", DateIssued: "2026-07-08", ConvertedFrom: { ID: 3038, Type: "Quote", Date: "2026-07-08T12:17:51-06:00" } },
];
eq(W.pickQuote({ walkDate: "2026-08-18", quotes: brandtQuotes, jobs: brandtJobs }), { result: "quote", quoteId: 2642 },
  "Brandt walk 8/18 → 2642 (heaters quote issued 8/31 is past the 14-day lookahead)");
eq(W.pickQuote({ walkDate: "2026-09-20", quotes: brandtQuotes, jobs: brandtJobs }), { result: "existing_job", jobId: 1430, openQuoteIds: [3198] },
  "a later walk at a house with an active job lands on the job; the open add-on quote rides along (Pierce #1277 rule)");
eq(W.pickQuote({ walkDate: "2026-08-18", quotes: brandtQuotes, jobs: brandtJobs, now: "2026-08-18" }).quoteId, 2642,
  "live mode: now caps the lookahead");
eq(W.pickQuote({ walkDate: "2026-09-01", quotes: [
  { ID: 1, Name: "A", Stage: "Approved", DateIssued: "2026-08-01", IsClosed: false },
  { ID: 2, Name: "B", Stage: "Approved", DateIssued: "2026-08-02", IsClosed: false }], jobs: [] }),
  { result: "ambiguous", quoteIds: [1, 2] }, "two open main quotes → the Routine decides");
eq(W.pickQuote({ walkDate: "2026-09-01", quotes: [{ ID: 1, Name: "A", Stage: "Approved", DateIssued: "2026-01-01", IsClosed: true }], jobs: [] }),
  { result: "none" }, "closed without converting (lost) → none");
eq(W.pickQuote({ walkDate: "2026-09-01", quotes: [{ ID: 1, Name: "A", Stage: "Archived", DateIssued: "2026-08-01", IsClosed: false }], jobs: [] }),
  { result: "none" }, "archived quote is not a match");
eq(W.pickQuote({ walkDate: "2026-09-01" }), { result: "none" }, "no site data is safe");
eq(W.pickQuote({ walkDate: "2026-09-01", quotes: [{ ID: 9, Name: "New Build", Stage: "Approved", DateIssued: "2026-09-05", IsClosed: false }], jobs: [] }),
  { result: "quote", quoteId: 9 }, "quote walk before the quote exists → matched once it is written (lookahead)");
eq(W.pickQuote({ walkDate: "2026-09-01", quotes: [{ ID: 9, Name: "New Build", Stage: "Approved", DateIssued: "2026-09-20", IsClosed: false }], jobs: [] }),
  { result: "none" }, "a quote written past the 14-day lookahead is not the walk's");

console.log(`planintake-test: ${cases.length} calendar cases + address + quote-pick checks passed`);
