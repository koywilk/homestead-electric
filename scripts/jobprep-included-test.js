// Job Prep tab universe (v623) — regression tests.
// Run: node scripts/jobprep-included-test.js   Exit 0 = all pass. Wired into prebuild.
//
// jobPrepIncluded is extracted LIVE from src/App.js (brace-balanced slice, the
// office-msgs-peds-test recipe), so the test can't drift from the app. It decides
// which jobs the Job Prep tab shows at all; JobPrepTracker then puts Commercial
// jobs in their own lane and keeps quick jobs out of the Resi prep lane.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`could not find ${name} in src/App.js`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const names = ["parseAnyDate", "effFS", "jobDivision", "isCommercial", "jobPrepIncluded"];
const body = [...names.map(extract), `module.exports = { ${names.join(", ")} };`].join("\n");
const tmp = path.join(__dirname, ".jobprep-included-fns.tmp.js");
fs.writeFileSync(tmp, body);
let F;
try { F = require(tmp); } finally { fs.unlinkSync(tmp); }

let passed = 0;
const t = (name, fn) => { fn(); passed++; };
const ids = (list) => F.jobPrepIncluded(list).map(j => j.id);

t("resi full jobs show until finish is complete", () => {
  assert.deepStrictEqual(ids([
    { id: "a", name: "A" },
    { id: "b", name: "B", finishStage: "50%" },
    { id: "c", name: "C", finishStage: "100%" },
    { id: "d", name: "D", finishStatus: "complete" },
  ]), ["a", "b"]);
});

t("commercial jobs now show (the tracker gives them their own lane)", () => {
  const got = F.jobPrepIncluded([{ id: "r", name: "Resi" }, { id: "c", name: "Comm", division: "commercial" }]);
  assert.deepStrictEqual(got.map(j => j.id).sort(), ["c", "r"]);
  assert.deepStrictEqual(got.filter(F.isCommercial).map(j => j.id), ["c"]);
});

t("v683: every quick job shows, job # or not, until it's complete or ready to invoice", () => {
  assert.deepStrictEqual(ids([
    { id: "q1", name: "Q1", quickJob: true, simproNo: "12345" },
    { id: "q2", name: "Q2", quickJob: true, simproNo: "" },
    { id: "q3", name: "Q3", quickJob: true, simproNo: "   " },
    { id: "q4", name: "Q4", quickJob: true },
    { id: "q5", name: "Q5", quickJob: true, simproNo: "222", quickJobStatus: "inprogress" },
    { id: "q6", name: "Q6", quickJob: true, simproNo: "333", quickJobStatus: "complete" },
    { id: "q7", name: "Q7", quickJob: true, simproNo: "444", quickJobStatus: "invoice" },
  ]).sort(), ["q1", "q2", "q3", "q4", "q5"]);
});

t("v683: temp ped cards show until Completed; temp ped pickup runs show like any quick job", () => {
  assert.deepStrictEqual(ids([
    { id: "tp0", name: "Ped0", tempPed: true },
    { id: "tp1", name: "Ped1", tempPed: true, tempPedStatus: "ready" },
    { id: "tp2", name: "Ped2", tempPed: true, tempPedStatus: "scheduled" },
    { id: "tp3", name: "Ped3", tempPed: true, tempPedStatus: "completed" },
    { id: "run", name: "Pickup", quickJob: true, quickJobType: "tempped", simproNo: "555" },
    { id: "runDone", name: "Pickup2", quickJob: true, quickJobType: "tempped", quickJobStatus: "complete" },
  ]).sort(), ["run", "tp0", "tp1", "tp2"]);
});

t("quotes and deleted / archived jobs never show", () => {
  assert.deepStrictEqual(ids([
    { id: "bid", name: "Bid", type: "quote", simproNo: "Q-9" },
    { id: "del", name: "Del", deleted: true },
    { id: "arc", name: "Arc", archived: true },
    { id: "arc2", name: "Arc2", quickJob: true, archivedAt: "11/1/2026" },
  ]), []);
});

t("a quick job's finish stage doesn't drop it — its own status does", () => {
  assert.deepStrictEqual(ids([{ id: "q", name: "Q", quickJob: true, simproNo: "1", finishStage: "100%" }]), ["q"]);
});

t("next projected start first; no date goes last, by name", () => {
  assert.deepStrictEqual(ids([
    { id: "late", name: "Z", roughProjectedStart: "12/1/2026" },
    { id: "nodateB", name: "B" },
    { id: "soon", name: "Y", roughProjectedStart: "2026-11-15" },
    { id: "nodateA", name: "A", quickJob: true, simproNo: "9" },
  ]), ["soon", "late", "nodateA", "nodateB"]);
});

console.log(`jobprep-included-test: ${passed} passed`);
