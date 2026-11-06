// v616: inspection attempts can be corrected. Runs in prebuild.
// node scripts/insp-attempts-test.js
const assert = require("assert");
const A = require("../src/inspAttempts.js");
const N = require("../functions/gcNotify.js");
const fs = require("fs");
const path = require("path");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };
const att = (id, date, result, by = "Koy Wilkinson", extra = {}) => ({ id, date, result, items: [], by, ...extra });
const fails = (b, a) => N.newAttempts(b, a).some((x) => /fail/i.test((x && x.result) || ""));

console.log("taps:");
t("first tap appends", () => assert.deepStrictEqual(A.inspLogTap(undefined, att("1", "8/7/2026", "pass")).map((x) => x.id), ["1"]));
t("a re-tap the same day by the same person replaces that day's attempt", () => {
  const out = A.inspLogTap([att("0", "7/28/2026", "fail"), att("1", "8/7/2026", "pass")], att("2", "8/7/2026", "fail"));
  assert.deepStrictEqual(out.map((x) => [x.id, x.result]), [["0", "fail"], ["2", "fail"]]);
});
t("another day appends", () => assert.strictEqual(A.inspLogTap([att("1", "8/7/2026", "fail")], att("2", "8/11/2026", "pass")).length, 2));
t("another person the same day appends", () => assert.strictEqual(A.inspLogTap([att("1", "8/7/2026", "fail", "Keegan Wilkinson")], att("2", "8/7/2026", "pass")).length, 2));
t("a Failed again attempt is never replaced", () => assert.strictEqual(A.inspLogTap([att("1", "8/7/2026", "fail", "Koy Wilkinson", { repeat: true })], att("2", "8/7/2026", "pass")).length, 2));
t("the input list is not changed", () => { const l = [att("1", "8/7/2026", "pass")]; A.inspLogTap(l, att("2", "8/7/2026", "fail")); assert.strictEqual(l[0].result, "pass"); });

// Kweller's real taps (job 1107, rough): seven appends under the old code.
const KW = [["7/28/2026", "fail", "Koy Wilkinson"], ["8/3/2026", "pass", "Keegan Wilkinson"], ["8/7/2026", "pass"], ["8/7/2026", "fail"], ["8/7/2026", "pass"], ["8/11/2026", "fail"], ["8/11/2026", "pass"]];
t("Kweller's seven taps now log four attempts, one per person per day", () => {
  let l = [];
  KW.forEach(([d, r, by], i) => { l = A.inspLogTap(l, att(String(i), d, r, by || "Koy Wilkinson")); });
  assert.deepStrictEqual(l.map((x) => `${x.date} ${x.result}`), ["7/28/2026 fail", "8/3/2026 pass", "8/7/2026 pass", "8/11/2026 pass"]);
});

console.log("remove + undo:");
const L = [att("a", "8/7/2026", "pass"), att("b", "8/7/2026", "fail"), att("c", "8/7/2026", "pass")];
t("remove takes out one attempt by position", () => assert.deepStrictEqual(A.inspRemoveAttempt(L, 1).map((x) => x.id), ["a", "c"]));
t("remove leaves the input alone", () => assert.strictEqual(L.length, 3));
t("undo puts it back in place, marked restored", () => {
  const back = A.inspRestoreAttempt(L, L[1]);
  assert.deepStrictEqual(back.map((x) => x.id), ["a", "b", "c"]);
  assert.strictEqual(back[1].restored, true);
  assert.ok(!back[0].restored && !back[2].restored);
});

console.log("alerts (server):");
t("a new fail at the end alerts", () => assert.ok(fails([att("a", "8/7/2026", "pass")], [att("a", "8/7/2026", "pass"), att("b", "8/8/2026", "fail")])));
t("a same-day pass corrected to fail alerts (list stays the same length)", () => assert.ok(fails([att("a", "8/7/2026", "pass")], [att("b", "8/7/2026", "fail")])));
t("a fail corrected to pass is quiet", () => assert.ok(!fails([att("a", "8/7/2026", "fail")], [att("b", "8/7/2026", "pass")])));
t("removing a fail is quiet", () => assert.ok(!fails(L, A.inspRemoveAttempt(L, 1))));
t("undoing that remove is quiet", () => { const gone = A.inspRemoveAttempt(L, 1); assert.ok(!fails(gone, A.inspRestoreAttempt(L, L[1]))); });
t("removing one and leaving a fail at the end is quiet", () => assert.ok(!fails(L, A.inspRemoveAttempt(L, 2))));
t("lists without ids keep the old tail rule", () => {
  assert.ok(fails([{ result: "fail" }], [{ result: "fail" }, { result: "fail", repeat: true }]));
  assert.ok(!fails([{ result: "fail" }], [{ result: "fail" }]));
});
t("a Remove while the result stays failed sends no GC repeat-fail email", () => {
  const b = { name: "K", roughInspectionResult: "fail", roughInspectionAttempts: L };
  const a = { name: "K", roughInspectionResult: "fail", roughInspectionAttempts: A.inspRemoveAttempt(L, 0) };
  assert.ok(!N.detectTriggers(b, a).some((x) => x.type === "inspection"));
});
t("Failed again still emails the GC", () => {
  const b = { name: "K", roughInspectionResult: "fail", roughInspectionAttempts: [att("a", "8/7/2026", "fail")] };
  const a = { name: "K", roughInspectionResult: "fail", roughInspectionAttempts: [att("a", "8/7/2026", "fail"), att("b", "8/9/2026", "fail", "Koy Wilkinson", { repeat: true })] };
  assert.strictEqual(N.detectTriggers(b, a).filter((x) => x.type === "inspection").length, 1);
});

console.log("wiring:");
const app = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
t("both Pass / Fail rows log through inspLogTap", () => {
  assert.strictEqual((app.match(/InspectionAttempts = inspAtt\.inspLogTap\(job\.(rough|final)InspectionAttempts,/g) || []).length, 2);
  assert.ok(!/\.\.\.\(job\.(rough|final)InspectionAttempts\|\|\[\]\),\s*\{ id:uid\(\), date:ymd/.test(app), "no raw append left on the Pass / Fail buttons");
});
t("both rows show History", () => assert.strictEqual((app.match(/<InspHistory attempts=\{job\.(rough|final)InspectionAttempts\}/g) || []).length, 2));
t("onJobUpdate's push uses newAttempts", () => assert.ok(/const _newFail = \(b, a\) => gcNotify\.newAttempts\(b, a\)/.test(idx)));

console.log(`\nALL PASS (${n})`);
