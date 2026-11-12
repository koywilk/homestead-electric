#!/usr/bin/env node
/* stage-sync-test.js — the app → Simpro stage sync (functions/stageSync.js).
 * Runs in prebuild. Pure: no Firebase, no network. Drives the exact file the
 * scheduledSimproStageSync function ships with, plus a few wiring checks.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const S = require(path.join(root, "functions", "stageSync.js"));

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error("  FAIL: " + label); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const PREP_DONE = { prepStage: "Job Prep Complete" };
const openItem = { id: "p1", text: "swap a device" };
const punch = (items) => ({ main: { general: items, hotcheck: [], rooms: [] } });
const sj = (id, statusId, name, stage = "Progress") => ({ ID: id, Name: "Simpro " + id, Stage: stage, Status: statusId ? { ID: statusId, Name: name } : {} });

// ── appStageOf: where the work actually is ────────────────────────────────
eq(S.appStageOf({}).key, "planPrep", "blank job is in prep");
eq(S.appStageOf({ ...PREP_DONE }).key, "readyToSchedule", "prepped, no rough date");
eq(S.appStageOf({ ...PREP_DONE, roughStatus: "waiting_date" }).key, "readyToSchedule", "prepped, awaiting a date");
eq(S.appStageOf({ ...PREP_DONE, roughStatus: "scheduled" }).key, "scheduled", "rough scheduled");
eq(S.appStageOf({ ...PREP_DONE, roughStatus: "date_confirmed" }).key, "scheduled", "rough date confirmed");
eq(S.appStageOf({ roughStatus: "scheduled" }).key, "planPrep", "dated but prep not cleared stays Plan Prep");
eq(S.appStageOf({ prepOverride: { on: true }, roughStatus: "scheduled" }).key, "scheduled", "prep override counts as cleared");
eq(S.appStageOf({ prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true }, prepNA: { readyToHandOff: true } }).key, "readyToSchedule", "checklist + Not Needed clears prep");
eq(S.appStageOf({ prepChecklist: { redlinePlans: true } }).key, "planPrep", "partial checklist is still prep");
// Oak Hill 5 (v532): rough in progress wins over an unticked prep item.
eq(S.appStageOf({ prepChecklist: { redlinePlans: true }, roughStatus: "inprogress", roughStage: "20%" }).key, "roughIn", "rough in progress beats unfinished prep");
eq(S.appStageOf({ roughStage: "35%" }).key, "roughIn", "rough % with no stored status");
eq(S.appStageOf({ roughStatus: "complete" }).key, "roughInComplete", "rough complete, finish not started");
eq(S.appStageOf({ roughStatus: "complete", finishStatus: "waiting_date" }).key, "roughInComplete", "in between, awaiting finish date");
eq(S.appStageOf({ roughStatus: "complete", finishStatus: "scheduled" }).key, "roughInComplete", "in between, finish scheduled");
eq(S.appStageOf({ roughStage: "100%" }).key, "roughInComplete", "rough 100% with no stored status");
// Rose 889: rough complete, finish 40% in progress.
eq(S.appStageOf({ roughStatus: "complete", roughStage: "100%", finishStatus: "inprogress", finishStage: "40%" }).key, "finish", "Rose: finish in progress");
eq(S.appStageOf({ finishStage: "10%" }).key, "finish", "finish % with no stored status");
// The Hideout: finish 95% with open punch → Punch List.
eq(S.appStageOf({ roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finishPunch: punch([openItem]) }).key, "punchList", "95% with open punch");
eq(S.appStageOf({ roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finishPunch: punch([{ ...openItem, done: true }]) }).key, "finish", "95% with nothing open is still Finish");
eq(S.appStageOf({ finishStatus: "inprogress", finishStage: "40%", finishPunchList: true }).key, "punchList", "foreman picked Punch List (v625)");
eq(S.appStageOf({ finishStatus: "inprogress", finishStage: "95%", finishPunchList: false, finishPunch: punch([openItem]) }).key, "finish", "foreman kept it off Punch List");
eq(S.appStageOf({ roughStatus: "complete", finishStatus: "complete", finishStage: "100%" }).key, "readyToInvoice", "finish complete, nothing open");
eq(S.appStageOf({ finishStatus: "complete", returnTrips: [{ id: "rt1", rtStatus: "needs" }] }).key, "punchList", "complete with an open return trip");
eq(S.appStageOf({ finishStatus: "complete", returnTrips: [{ id: "rt1", rtStatus: "complete" }] }).key, "readyToInvoice", "complete, trip done");
eq(S.appStageOf({ finishStatus: "invoice" }).key, "readyToInvoice", "legacy invoice status");
ok(S.appStageOf({ roughStatus: "waiting" }).hold === true, "rough on hold");
ok(S.appStageOf({ roughStatus: "complete", finishStatus: "waiting", finishOnHold: true }).hold === true, "finish on hold");
ok(S.appStageOf({ roughStatus: "inprogress", roughOnHold: true }).hold === true, "rough hold flag");
ok(!!S.appStageOf({ quickJob: true, quickJobStatus: "scheduled" }).skip, "quick job skipped");
ok(!!S.appStageOf({ tempPed: true }).skip, "temp ped skipped");
ok(!!S.appStageOf({ division: "commercial" }).skip, "commercial skipped");
ok(!!S.appStageOf({ type: "quote", simproNo: "2478" }).skip, "quote skipped");

// ── planOne: what happens in Simpro ───────────────────────────────────────
const rose = { roughStatus: "complete", finishStatus: "inprogress", finishStage: "40%" };
eq(S.planOne(rose, sj(889, 155, "Job - Material Deposit Paid")), { action: "set", toId: 331, toName: "Job - Finish", fromId: 155, fromName: "Job - Material Deposit Paid", section: "Finish In Progress" }, "Rose: Material Deposit Paid → Finish");
eq(S.planOne(rose, sj(889, 331, "Job - Finish")).action, "same", "already right is a no-op");
eq(S.planOne(rose, null).action, "skip", "not open in Simpro is skipped");
ok(/not open in Simpro/.test(S.planOne(rose, null).reason), "…and says why");
const money = S.planOne(rose, sj(889, 154, "Job - Ready to Invoice"));
ok(money.action === "skip" && money.conflict === true, "Ready to Invoice in Simpro is left for the office");
ok(S.planOne(rose, sj(889, 157, "Receipts Reviewed")).conflict === true, "Receipts Reviewed is left alone");
[333, 69, 263].forEach(id => ok(S.planOne(rose, sj(889, id, "hold")).conflict === true, `Simpro hold ${id} is left alone`));
eq(S.planOne({ finishStatus: "complete" }, sj(1, 154, "Job - Ready to Invoice")).action, "same", "complete + Ready to Invoice agree");
eq(S.planOne({ roughStatus: "waiting" }, sj(1, 329, "Job - Rough-In")).action, "skip", "app hold never changes Simpro");
eq(S.planOne({ ...PREP_DONE, roughStatus: "inprogress" }, sj(1, null, "")).fromName, "(no status)", "a job with no Simpro status still gets set");
eq(S.planOne({ roughStatus: "complete" }, sj(1, 196, "Job - Matterport")).toId, 330, "Matterport status is replaced by the stage");

// ── planAll: the night's plan ─────────────────────────────────────────────
const jobs = [
  { id: "a", simproNo: "889", name: "Rose", ...rose },
  { id: "b", simproNo: "1438", name: "Miller", roughStatus: "complete", finishStatus: "waiting_date" },
  { id: "c", simproNo: "", name: "No number", roughStatus: "inprogress" },
  { id: "d", simproNo: "1412", name: "Bldg A", roughStatus: "inprogress" },
  { id: "e", simproNo: "1412", name: "Bldg B", roughStatus: "inprogress" },
  { id: "f", simproNo: "1392", name: "Quick", quickJob: true },
  { id: "g", simproNo: "1000", name: "Archived", archived: true, roughStatus: "inprogress" },
  { id: "h", simproNo: "1107", name: "Kweller", roughStatus: "complete", finishStatus: "waiting_date" },
  { id: "i", simproNo: "2478", name: "A quote", type: "quote" },
];
const open = { "889": sj(889, 155, "Job - Material Deposit Paid"), "1438": sj(1438, 329, "Job - Rough-In"), "1107": sj(1107, 330, "Job - Rough-In Complete"),
  "1412": sj(1412, 329, "Job - Rough-In"), "1392": sj(1392, 152, "Job - Scheduled"), "1029": sj(1029, 332, "Job - Punch List"), "1476": sj(1476, 74, "Quote - Convert to Job", "Pending") };
const plan = S.planAll(jobs, open);
const row = (id) => plan.rows.find(r => r.id === id);
eq(row("a").action, "set", "planAll: Rose is set");
eq([row("b").action, row("b").toName], ["set", "Job - Rough-In Complete"], "planAll: Miller Rough-In → Rough-In Complete");
ok(row("c").action === "skip" && row("c").conflict && /no Simpro #/.test(row("c").reason), "planAll: missing Simpro # is flagged");
ok(row("d").conflict && row("e").conflict && /share Simpro #1412/.test(row("d").reason), "planAll: shared Simpro # is never guessed");
ok(!row("f") && !row("g") && !row("i"), "planAll: quick jobs, archived jobs and quotes are not listed");
eq(row("h").action, "same", "planAll: Kweller already matches");
eq(plan.simproOnly, [{ sn: "1029", name: "Simpro 1029", status: "Job - Punch List" }], "planAll: in progress in Simpro with no app job (Hansen)");
eq(plan.counts, { set: 2, same: 1, skip: 3, conflict: 3, downhill: 0, simproOnly: 1 }, "planAll: counts");
eq(S.planAll([], {}).counts, { set: 0, same: 0, skip: 0, conflict: 0, downhill: 0, simproOnly: 0 }, "planAll: empty");
eq(S.planAll(null, null).rows, [], "planAll: null-safe");

// ── Simpro's status order: up is sent, down is a person or "by hand" ───────
// Live ranks read 2026-11-11 (Simpro › Setup › Status Codes).
const PRI = S.priorityMap([{ ID: 153, Priority: 19 }, { ID: 156, Priority: 20 }, { ID: 152, Priority: 21 }, { ID: 329, Priority: 22 }, { ID: 330, Priority: 23 },
  { ID: 331, Priority: 24 }, { ID: 332, Priority: 25 }, { ID: 333, Priority: 26 }, { ID: 69, Priority: 27 }, { ID: 263, Priority: 28 }, { ID: 154, Priority: 29 },
  { ID: 157, Priority: 30 }, { ID: 196, Priority: 31 }, { ID: 155, Priority: 32 }, { ID: 74, Priority: 18 }, { ID: "x", Priority: 1 }, null]);
eq(PRI[155], 32, "priorityMap reads id → rank");
ok(!("x" in PRI), "priorityMap drops bad rows");
eq(S.priorityMap(null), {}, "priorityMap: null-safe");
// Rose: parked on Material Deposit Paid (rank 32, above every stage) → downhill:
// tried, expected to be refused, reported with what to do by hand.
const roseP = S.planOne(rose, sj(889, 155, "Job - Material Deposit Paid"), PRI);
ok(roseP.action === "set" && roseP.toId === 331 && roseP.downhill === true, "Rose: Material Deposit Paid → Finish is a downhill move");
ok(S.planOne({ roughStatus: "complete" }, sj(1, 196, "Job - Matterport"), PRI).downhill === true, "Matterport → Rough-In Complete is a downhill move");
// Up the order: sent as is.
const millerP = S.planOne({ roughStatus: "complete", finishStatus: "waiting_date" }, sj(1438, 329, "Job - Rough-In"), PRI);
ok(millerP.action === "set" && !("downhill" in millerP), "Miller: Rough-In → Rough-In Complete is a plain move");
ok(!("downhill" in S.planOne(rose, sj(1, 330, "Job - Rough-In Complete"), PRI)), "Rough-In Complete → Finish is plain");
ok(!("downhill" in S.planOne({ finishStatus: "complete" }, sj(694, 332, "Job - Punch List"), PRI)), "Punch List → Ready to Invoice is plain");
ok(!("downhill" in S.planOne({ ...PREP_DONE, roughStatus: "inprogress" }, sj(1, 74, "Quote - Convert to Job"), PRI)), "a new job on Quote - Convert to Job moves up, plain");
ok(!("downhill" in S.planOne({ ...PREP_DONE, roughStatus: "inprogress" }, sj(1, null, ""), PRI)), "no Simpro status: plain");
// Down the order from one stage to an earlier one: never forced.
const thayne = S.planOne({ ...PREP_DONE }, sj(881, 330, "Job - Rough-In Complete"), PRI);
ok(thayne.action === "skip" && thayne.conflict === true && /further along/.test(thayne.reason), "Thayne: Simpro further along than the app goes to a person");
ok(S.planOne({ roughStatus: "inprogress" }, sj(959, 330, "Job - Rough-In Complete"), PRI).conflict === true, "Stratton: Rough-In Complete → Rough-In is not forced");
ok(S.planOne({ roughStatus: "complete" }, sj(1006, 332, "Job - Punch List"), PRI).conflict === true, "T&M Pool House: Punch List → Rough-In Complete is not forced");
// Money and holds still win over everything.
ok(/left for the office/.test(S.planOne(rose, sj(889, 154, "Job - Ready to Invoice"), PRI).reason), "Ready to Invoice is still left for the office with ranks known");
const planP = S.planAll(jobs, open, PRI);
eq([planP.counts.set, planP.counts.downhill], [2, 1], "planAll with ranks: Rose downhill, Miller up");
ok(/off "Job - Material Deposit Paid"/.test(S.blockedNote(roseP)) && /"Job - Finish" by hand/.test(S.blockedNote(roseP)), "blockedNote says what to do by hand");
ok(S.STAGE_IDS.length === 8 && S.STAGE_IDS.includes(331), "STAGE_IDS are the eight targets");

// ── priority block detection ──────────────────────────────────────────────
ok(S.isPriorityBlock(422, '{"errors":[{"path":"Status","message":"Unable to update status. Check priority or enable \'Ignore Status Priority\' in Simpro."}]}'), "422 priority message is recognised");
ok(!S.isPriorityBlock(422, '{"errors":[{"path":"Status","message":"Invalid status"}]}'), "another 422 is not a priority block");
ok(!S.isPriorityBlock(500, "Ignore Status Priority"), "only a 422 counts");

// ── wiring ────────────────────────────────────────────────────────────────
const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
const prepBlock = (app.match(/const PREP_CHECKLIST_ITEMS = \[([\s\S]*?)\];/) || [])[1] || "";
eq([...prepBlock.matchAll(/key:"([^"]+)"/g)].map(m => m[1]), S.PREP_KEYS, "PREP_KEYS match App.js PREP_CHECKLIST_ITEMS");
eq(Object.values(S.STATUS).map(s => s.id).sort((a, b) => a - b), [152, 153, 154, 156, 329, 330, 331, 332], "the eight Simpro status ids");
ok(Object.values(S.STATUS).every(s => /^Job - /.test(s.name)), "every target is a Job status");
ok(!S.MONEY_IDS.concat(S.HOLD_IDS).some(id => id !== 154 && Object.values(S.STATUS).some(s => s.id === id)), "left-alone ids are not targets (except Ready to Invoice)");
const idx = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
ok(/exports\.scheduledSimproStageSync\s*=/.test(idx), "index.js exports scheduledSimproStageSync");
ok(/require\("\.\/stageSync\.js"\)/.test(idx), "index.js requires ./stageSync.js");
const runBody = (idx.match(/async function _runSimproStageSync[\s\S]*?\n}\n/) || [""])[0];
ok(/mode === "live"/.test(runBody) && /"dry"/.test(runBody), "the sync only writes when settings/simproStageSync.mode is exactly \"live\"");
ok(!/AutoAdjustStatus/.test(idx), "the sync never touches a job's Auto Adjust box (tried on Rose; it does not get past Simpro's status order)");
ok(/r\.mode === "live" && r\.failed\b/.test(idx), "only real failures push Koy; blocked jobs stay in the report");
ok(/stageSync\.planAll\(jobs, open, priorities\)/.test(runBody), "the function passes Simpro's status ranks to the planner");
ok(!/jobs\/\$\{|\.update\(|tx\.update|db\.collection\("jobs"\)\.doc/.test(runBody), "the sync never writes a job in the app");
ok(fs.readFileSync(path.join(root, "functions", "punchListStage.js")).equals(fs.readFileSync(path.join(root, "src", "punchListStage.js"))), "functions/punchListStage.js is the src copy");

console.log(`stage-sync-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
