#!/usr/bin/env node
/* jobs-activity-audit-test.js — the Jobs / Activity dashboard audit (v580).
 * Runs the SHIPPED helpers out of src/App.js (same Babel + vm sandbox as
 * odash-model-test.js) on real-shaped jobs and proves:
 *   1. WAITING ON — GC = a question out to the GC / designer / homeowner (named
 *      outside the team, or shared by link); inspection = a target with no
 *      result (booked, or passed and not logged) or a fail with no re-inspection
 *      booked; us = a question the office owes, or an open need on the job.
 *      Blank when nothing waits. Ranked GC, inspection, us.
 *   2. DAYS IN STAGE — only from a date the job records for entering that
 *      stage: confirmed start (rough / finish in progress), rough pass (rough
 *      done, finish next), last fail (rough inspection failed), the passed start
 *      date. Holds, prep, no status and future starts are null, never guessed.
 *   3. QUESTION SPLIT — "me" (office) vs "others" (GC or a foreman named on
 *      it); oldest first, undated last, older than 2 days flagged; the two
 *      groups add up to odModel's open-question count.
 * Exit 1 on any failure. Runs in prebuild.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const { makeSandbox } = require(path.join(__dirname, "odash-model-test.js"));
const X = makeSandbox();
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); n++; };

const now = new Date(2026, 9, 30, 9, 0);            // Fri Oct 30 2026, 9:00 AM local
const users = [
  { id: "koy", name: "Koy Wilkinson", role: "admin" },
  { id: "josh", name: "Josh Cloward", title: "admin", access: "admin" },
  { id: "keegan", name: "Keegan Wilkinson", title: "foreman", access: "manager" },
  { id: "louis", name: "Louis Hoffman", title: "lead", access: "standard" },
  { id: "gone", name: "Vasa Gone", title: "foreman", active: false },
];
const q = (id, question, extra = {}) => ({ id, question, addedBy: "Louis Hoffman", addedAt: "2026-10-02T15:15:30.123Z", done: false, answer: "", for: "", ...extra });
const base = { name: "Ashcraft", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "40%", finishProjectedStart: "10/2/2026", finishStartConfirmed: true,
  roughQuestions: { upper: [], main: [], basement: [] }, finishQuestions: { upper: [], main: [], basement: [] }, roughInspectionAttempts: [{ result: "pass", date: "4/17/2026" }], roughInspectionResult: "pass", changeOrders: [], returnTrips: [] };

// 1. WAITING ON
//   Ashcraft as it was on 2026-10-30: 8 finish questions for "Gary" (the homeowner), 1 for nobody.
const ash = { ...base, id: "a1", finishQuestions: { upper: [], main: [q("1", "Can color", { for: "Gary" }), q("2", "TV box?", { for: "Gary" }), q("3", "Drawers shorter", { for: "" })], basement: [] } };
let w = X.odJobWaiting(ash, { users, needs: [], now });
eq(w.map(x => x.k), ["gc", "us"], "Ashcraft: out to the homeowner first, then the one the office owes");
eq(w[0].detail, "2 questions out to Gary", "GC detail names who");
eq(w[1].detail, "1 question to answer", "us detail counts the office's question");
//   Koplin: "fernando" (the GC's super, lower case, not on the team) + "Homeowner".
const kop = { ...base, id: "k1", name: "Koplin", roughQuestions: { upper: [], main: [q("1", "Panel spot", { for: "fernando" }), q("2", "Cans", { for: "Homeowner" })], basement: [] } };
eq(X.odJobWaiting(kop, { users, needs: [], now }).map(x => [x.k, x.detail]), [["gc", "2 questions out to fernando, Homeowner"]], "names outside the team are the GC side");
//   A question for a foreman is out to others but is NOT the GC; one for an admin is the office's.
const fm = { ...base, id: "f1", roughQuestions: { upper: [q("1", "Which panel", { for: "Keegan" }), q("2", "Approve?", { for: "Josh Cloward" })], main: [], basement: [] } };
eq(X.odJobWaiting(fm, { users, needs: [], now }).map(x => [x.k, x.detail]), [["us", "1 question to answer"]], "a foreman's question is not GC; the admin's is the office's");
//   Shared by link with no name typed: out to the link's party.
const sh = { ...base, id: "s1", questionShares: [{ id: "x", name: "Super Braden", ids: ["1"] }], roughQuestions: { upper: [q("1", "Beam height")], main: [], basement: [] } };
eq(X.odJobWaiting(sh, { users, needs: [], now })[0], { k: "gc", n: 1, detail: "1 question out to Super" }, "a link share puts the question on the GC side");
//   Inspections: booked, passed with no result, failed not re-booked, failed and re-booked, passed.
const insp = (extra) => X.odJobWaiting({ ...base, id: "i", ...extra }, { users, needs: [], now });
eq(insp({ fourWayTargetDate: "11/3/2026", roughInspectionResult: "", roughInspectionAttempts: [] }).map(x => x.detail), ["Rough booked 11/3"], "booked ahead");
eq(insp({ fourWayTargetDate: "10/13/2026", roughInspectionResult: "", roughInspectionAttempts: [] }).map(x => x.detail), ["Rough 10/13, no result logged"], "Pierce: target passed, nothing logged");
eq(insp({ fourWayTargetDate: "4/30/2026", roughInspectionResult: "fail", roughInspectionAttempts: [{ result: "fail", date: "5/5/2026" }] }).map(x => x.detail), ["Rough failed, not re-booked"], "Bukhshtaber: failed 5/5, target before the fail");
eq(insp({ fourWayTargetDate: "11/4/2026", roughInspectionResult: "fail", roughInspectionAttempts: [{ result: "fail", date: "10/28/2026" }] }).map(x => x.detail), ["Rough re-inspect 11/4"], "re-booked after the fail");
eq(insp({ finalInspectionTargetDate: "9/9/2026", finalInspectionResult: "fail", finalInspectionAttempts: [{ result: "fail", date: "9/9/2026" }] }).map(x => x.detail), ["Final failed, not re-booked"], "Austin Cloward: final failed on its target day");
eq(insp({}), [], "a passed rough with nothing open waits on nothing");
//   Needs: an open task on the job is "us"; done, voided, snoozed or another job's are not.
const needs = [{ id: "n1", jobId: "a1", status: "open", text: "generac cert" }, { id: "n2", jobId: "a1", status: "done" }, { id: "n3", jobId: "a1", status: "open", voided: true }, { id: "n4", jobId: "zz", status: "open" }, { id: "n5", jobId: "a1", status: "open", snoozedUntil: "2026-11-20" }];
eq(X.odJobWaiting({ ...base, id: "a1" }, { users, needs, now }), [{ k: "us", n: 1, detail: "1 open task" }], "one open need counts; done / voided / snoozed / other job do not");
eq(X.odJobWaiting(ash, { users, needs, now })[1].detail, "1 question to answer · 1 open task", "question + task on one line");
//   Ranking holds whatever order they were found in.
const all = X.odJobWaiting({ ...ash, fourWayTargetDate: "11/3/2026", roughInspectionResult: "", roughInspectionAttempts: [] }, { users, needs, now });
eq(all.map(x => x.k), ["gc", "insp", "us"], "GC, inspection, us");
eq(all.map(x => X.OD_WAIT_LABEL[x.k]), ["GC", "Inspection", "Us"], "labels");

// 2. DAYS IN STAGE
const rb = { ...base, roughStatus: "inprogress", finishStatus: "", finishStage: "0%", finishProjectedStart: "", roughInspectionResult: "", roughInspectionAttempts: [] };
const stage = (j) => X.odPhase(j, "2026-10-30");
const ds = (j) => { const r = X.odDaysInStage(j, stage(j), now); return r && [stage(j).key, r.days, r.src]; };
eq(ds({ ...rb, roughProjectedStart: "9/7/2026", roughStartConfirmed: true }), ["rough", 53, "start"], "Pierce: rough since its 9/7 start");
eq(ds(base), ["finish", 28, "start"], "Ashcraft: finish since its 10/2 start");
eq(ds({ ...rb, roughProjectedStart: "" }), null, "Oak Hill 5: in progress with no start date recorded is blank, not guessed");
eq(ds({ ...rb, roughProjectedStart: "11/9/2026" }), null, "a start still ahead is not an entry date");
eq(ds({ ...rb, roughStatus: "complete", finishStatus: "waiting_date", roughInspectionResult: "pass", roughInspectionAttempts: [{ result: "fail", date: "4/29/2026" }, { result: "pass", date: "5/4/2026" }] }), ["between", 179, "rough passed"], "Forth: rough done since the 5/4 pass, not the 4/29 fail");
eq(ds({ ...rb, roughStatus: "complete", finishStatus: "waiting_date" }), null, "rough done with no inspection logged is blank");
eq(ds({ ...rb, roughStatus: "complete", roughInspectionResult: "fail", roughInspectionAttempts: [{ result: "pass", date: "5/1/2026" }, { result: "fail", date: "10/13/2026" }], fourWayTargetDate: "10/13/2026" }), ["roughFail", 17, "failed"], "failed rough: since the last fail");
eq(ds({ ...rb, roughStatus: "scheduled", roughProjectedStart: "10/19/2026", prepDone: true }), ["roughDue", 11, "date passed"], "Namjoshi-style: start date passed 11 days ago");
eq(ds({ ...rb, roughStatus: "waiting" }), null, "on hold records no entry date");
eq(ds({ ...rb, roughStatus: "", prepDone: true }), null, "no status records no entry date");
eq(X.odDaysInStage(null, null, now), null, "safe on nothing");
ok(X.odDaysInStage({ ...base, finishProjectedStart: "10/30/2026" }, stage(base), now).days === 0, "started today is 0, never negative");

// 3. QUESTION SPLIT
const jobs = [ash, kop, fm, sh, { ...base, id: "u1", name: "Stratton", roughQuestions: { upper: [q("9", "Undated", { addedAt: "" })], main: [], basement: [] } },
  { ...base, id: "r1", name: "Rose", finishQuestions: { upper: [q("7", "Fresh", { addedAt: "2026-10-30T07:00:00.000Z", addedBy: "Keegan Wilkinson" })], main: [], basement: [] } }];
const sp = X.odSplitQuestions(jobs, users, now);
const model = X.odModel({ jobs, users, needs: [], upcoming: [], now });
eq(sp.mine.length + sp.others.length, model.openQs.length, "the two groups add up to the Open questions card");
eq(sp.mine.map(x => [x.job.name, x.text, x.age, x.old]), [["Ashcraft", "Drawers shorter", 27, true], ["Ashcraft", "Approve?", 27, true], ["Rose", "Fresh", 0, false], ["Stratton", "Undated", null, false]], "mine: office-owed, oldest first, today unflagged, undated last");
eq(sp.others.map(x => [x.job.name, x.to, x.why]), [["Ashcraft", "Gary", "gc"], ["Ashcraft", "Gary", "gc"], ["Ashcraft", "Keegan Wilkinson", "foreman"], ["Ashcraft", "Super Braden", "gc"], ["Koplin", "fernando", "gc"], ["Koplin", "Homeowner", "gc"]], "others: oldest first, ties by job, each with who it is out to");
ok(sp.others.every(x => x.why === "gc" || x.why === "foreman"), "others are GC-side or a foreman");
ok(sp.others.some(x => x.to === "Keegan Wilkinson" && x.why === "foreman"), "the foreman's question is on the others side");
ok(sp.others.some(x => x.to === "Super Braden"), "the link share names its party");
eq(sp.old, 8, "older-than-2-days count across both groups");
eq(X.odQuestionSide(q("1", "x", { for: "Vasa Gone" }), base, users), { side: "others", to: "Vasa Gone", why: "gc" }, "someone off the team is outside: GC side");
eq(X.odQuestionSide(q("1", "x", { for: "" }), base, users), { side: "me", to: "", why: "office" }, "no name: the office answers");
eq(X.odSplitQuestions([], users, now), { mine: [], others: [], old: 0 }, "empty is safe");

console.log(`  ok  jobs-activity-audit-test: ${n} checks`);
