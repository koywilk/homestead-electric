// Plan-intake Phase 4 builders — run: node scripts/planintake-digest-test.js (in the prebuild chain)
"use strict";
const D = require("../functions/planIntake/digest.js");
const assert = require("assert");
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const f = (type, number, summary, createdAt, extra = {}) => ({ type, number, summary, createdAt, mode: "live", links: [], ...extra });

const findings = [
  f("plans_filed", "1430", "Filed \"Brandt Post Redline.pdf\" into #1430 / MOST UPDATED", "2026-10-04T16:00:00Z", { links: [{ label: "Folder", url: "https://drive.google.com/drive/folders/X" }] }),
  f("unmatched_plan", "#1443", "Plan not matched: set.pdf from gc@x.com — best guess #1443", "2026-10-04T15:00:00Z"),
  f("folder_created", "Q3178", "Created folder \"Quote #3178\"", "2026-10-04T14:00:00Z"),
  f("plans_filed", "1430", "Filed \"Cabinets.pdf\" into #1430 / MOST UPDATED / CABINET PLANS", "2026-10-04T17:00:00Z"),
  f("folder_conflict", "1407", "Job #1407 has two folders", "2026-10-04T18:00:00Z"),
  f("plans_filed", "1407", "<script>x</script>", "2026-10-04T18:30:00Z"),
  f("plans_filed", "9999", "dry row", "2026-10-04T18:30:00Z", { mode: "dry" }),
];
const g = D.groupFindings(findings);
eq(g.needs.map(x => x.type), ["folder_conflict", "unmatched_plan"], "needs-you first, worst first");
eq(g.groups.map(x => x.number), ["1430", "1407", "Q3178"], "groups busiest first; dry rows dropped");
eq(g.groups[0].rows.map(r => r.createdAt), ["2026-10-04T16:00:00Z", "2026-10-04T17:00:00Z"], "rows in time order");

const e = D.digestEmail({ day: "2026-10-04", findings });
eq(e.subject, "Plans today: 3 filed · 2 need you (Sun, Oct 4)", "subject counts filed + needs");
assert(e.html.indexOf("Needs you") < e.html.indexOf("#1430"), "needs-you section comes first");
assert(!e.html.includes("<script>"), "summaries are escaped");
assert(e.html.includes("Quote #3178"), "quote numbers read as Quote #N");
eq(D.digestEmail({ day: "2026-10-04", findings: [] }).total, 0, "empty day = 0 (the sender skips it)");
eq(D.numLabel(""), "No number", "blank number labelled");

const p = D.walkPush([
  { title: "Brandt Walk", status: "matched", quoteNo: "2642" },
  { title: "Pierce Walk", status: "existing_job", jobNo: "1277" },
  { title: "Oak hill 5", status: "queued" },
], { 2642: { filedCount: 11 } });
eq(p.title, "3 walks today", "several walks → one push");
eq(p.body.split("\n"), ["Brandt Walk: Quote #2642 folder ready · 11 plans in SIMPRO", "Pierce Walk: existing job #1277", "Oak hill 5: not matched yet"], "one line per walk");
eq(D.walkPush([{ title: "Koplin Walk", status: "matched", quoteNo: "2453" }], {}).title, "Walk today: Koplin Walk", "single walk title");
eq(D.walkPush([], {}), null, "no walks → no push");

console.log("planintake-digest-test: grouping, email, walk push passed");
