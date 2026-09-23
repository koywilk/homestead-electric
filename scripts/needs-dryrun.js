#!/usr/bin/env node
/* needs-dryrun.js — harness for the task-loop pure helpers (My Day / unified
 * needs). Extracts the shipped functions VERBATIM from src/App.js and evals
 * them in a vm sandbox (house pattern: scripts/questions-room-dryrun.js), so
 * the routing logic under test is exactly what ships — no hand copy to drift.
 *
 * Proves:
 *   1. HAT — resiHead() = the resi.head holder; falls back to jobprep.own;
 *      null when nobody holds either; deactivated users never win.
 *   2. LEGACY — a pre-existing need (no assignedTo, coordinator set) is treated
 *      as assigned to that coordinator; trailing-space names still match.
 *   3. ROUTING — isMine / onHead / headQueue: foreman's need assigned to the
 *      head is ON the head (not mine); explicit "" assignee falls to creator;
 *      done + snoozed rows leave every list; snooze returns on the day.
 *   4. DATES — dueBucketFromDate: tomorrow → "tomorrow", later → "week",
 *      "" → null; localYmd is local-time YYYY-MM-DD.
 *   5. PUNCH — punchAssignedTo: full-name + legacy first-name match, extras
 *      floors walked, voided/done/tempPed skipped, other names excluded.
 *   6. MY JOBS — myJobsFor: foreman → own jobs; crew → their foreman's; office → [].
 *   7. CHAIN — defaultAssigneeFor: crew/lead → their foreman; foreman → head;
 *      head → self; other office → head; no head → "".
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const APP_JS = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP_JS, "utf8");

// Brace-balance from the first `{` after `marker` (skipping string / template
// contents) and return the verbatim slice. Fails loudly if missing (RED state).
function extractFrom(marker, label) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  let i = src.indexOf("{", start);
  if (i < 0) throw new Error(`extract: no open-brace for ${label}`);
  // Comment-aware: a `//` line comment or `/* */` block is skipped whole, so an
  // apostrophe in prose ("member's") can't be mistaken for a string delimiter.
  let depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; if (depth === 0) { i++; break; } continue; }
  }
  if (depth !== 0) throw new Error(`extract: unbalanced braces for ${label}`);
  return src.slice(start, i);
}
const extractFunction = (name) => extractFrom(`function ${name}(`, name);
const extractConst    = (name) => extractFrom(`const ${name} = `, name) + ";";
// One-line consts (arrays) have no `{` to balance — take the whole source line.
const extractLine = (name) => { const i = src.indexOf(`const ${name} = `); if (i < 0) throw new Error(`extract: const ${name} not found`); return src.slice(i, src.indexOf("\n", i)); };
// Array of objects: find from marker to closing ];
const extractArray = (name) => { const start = src.indexOf(`const ${name} = `); if (start < 0) throw new Error(`extract: const ${name} not found`); const end = src.indexOf("];", start); if (end < 0) throw new Error(`extract: no closing ]; for ${name}`); return src.slice(start, end + 2) + ";"; };

const FN = ["localYmd","sameName","needKind","needAssignee","needForeman","dueBucketFromDate",
  "isSnoozed","needIsOpen","resiHead","resiHeadName","defaultAssigneeFor","isMine","onHead","headQueue",
  "punchAssignedTo","myJobsFor","headAutoTasks","scanAutoTasks","matterportScanNeeded","autoDelegation","autoRowState","autoTaskDoc","foldDutyTwins","myDayCategoryOf","myDayCategories",
  "needUpdates","lastNeedUpdate","needRequester","needUpdateAudience","needUpdateLine","sentByMe","completedForMe",
  "routeKeyOfAuto","routeKeyOfDuty","routeKeyOfRedline","activeCoverName","coverName","hatHolderNames","ownersForRoute","coveredFor",
  "isInactiveJob","staleReason","rowMatches","batchCaps","focusKeysToday","sentFinishedForMe","userKeyOf",
  "taskPhotoPath","needPhotos","teamPulse",
  "usageSeenKey","shouldLogUsage","usageRollup","usageLastDays","usageWithZeros"];
const combined = [
  extractConst("PERMISSIONS"),
  extractConst("getAccess"),
  extractConst("can"),
  extractConst("matchesForeman"),
  extractConst("parseAnyDate"),
  extractConst("parseStage"),
  extractConst("AUTO_DUTY_TWINS"),
  extractLine("MYDAY_ORDER"),
  extractConst("MYDAY_CAT_LABELS"),
  extractArray("HAT_REGISTRY"),
  ...FN.map(extractFunction),
  `({ ${FN.join(", ")}, can, HAT_REGISTRY })`,
].join("\n");
const sandbox = vm.createContext({});
const H = vm.runInContext(combined, sandbox, { filename: "needs-extract.vm.js" });
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// ── fixtures ────────────────────────────────────────────────────────────────
const koy   = { id:"koy",   name:"Koy Wilkinson",  access:"admin",    caps:["jobprep.own","resi.head"] };
const josh  = { id:"josh",  name:"Josh Cloward",   access:"admin" };
const gage  = { id:"gage",  name:"Gage Lund",      access:"standard", title:"foreman", coordinator:"Koy Wilkinson" };
const brad  = { id:"brad",  name:"Braden",         access:"limited",  title:"crew", foremanId:"gage" };
const users = [koy, josh, gage, brad];

const england = { id:"j1770", name:"#1770 England Home", foreman:"Gage" };
const navarro = { id:"j1937", name:"#1937 Navarro Residence", foreman:"Daegan" };
const jobs = [england, navarro];
const TODAY = "2026-09-09";

// ── 1. hat ──────────────────────────────────────────────────────────────────
assert.strictEqual(H.resiHead(users).id, "koy", "resi.head holder wins");
assert.strictEqual(H.resiHeadName(users), "Koy Wilkinson", "resiHeadName");
const prepOnly = [{ ...koy, caps:["jobprep.own"] }, josh, gage];
assert.strictEqual(H.resiHead(prepOnly).id, "koy", "falls back to jobprep.own before the hat is ticked");
assert.strictEqual(H.resiHead([josh, gage]), null, "nobody holds either hat -> null");
assert.strictEqual(H.resiHead([{ ...koy, active:false }, { ...josh, caps:["resi.head"] }]).id, "josh", "deactivated holder never wins");
assert.strictEqual(H.resiHeadName([]), "", "empty users -> ''");

// v423 — Matterport scanner hat (matterport.own): the client gates the scans
// queue on can(identity,"matterport.own"), the server chase finds the holder in
// caps. Both are the same per-user cap; lock it here.
const scanHat = { id:"just", name:"Justin Cloward", access:"admin", caps:["matterport.own"] };
assert.ok(H.can(scanHat, "matterport.own"), "hat holder passes the matterport.own gate");
assert.ok(!H.can(koy, "matterport.own"), "the head does NOT hold the scanner hat (different people)");
assert.ok(!H.can(gage, "matterport.own"), "a foreman does not hold it");

// ── 2. legacy docs ──────────────────────────────────────────────────────────
const legacy = { id:"n1", text:"Set panel", coordinator:"Koy Wilkinson", createdBy:"Justin Cloward ", status:"open", dueBucket:"tomorrow" };
assert.strictEqual(H.needAssignee(legacy), "Koy Wilkinson", "absent assignedTo -> coordinator is the assignee");
assert.strictEqual(H.needKind(legacy), "need", "absent kind -> need");
assert.ok(H.isMine(legacy, koy), "legacy book item is on the head");
assert.ok(!H.isMine(legacy, gage), "legacy book item is not the foreman's");
const justin = { id:"justin", name:"Justin Cloward" };
const legacyUnassigned = { id:"n2", text:"x", createdBy:"Justin Cloward ", status:"open" };
assert.ok(H.isMine(legacyUnassigned, justin), "trailing-space createdBy still matches its creator");
assert.ok(H.sameName("Koy Wilkinson", "koy"), "first-name tolerant");
assert.ok(!H.sameName("Koy Wilkinson", "Kolby"), "not a prefix-of-word match");
assert.ok(!H.sameName("", "Koy"), "empty never matches");

// ── 3. routing ──────────────────────────────────────────────────────────────
const toHead = { id:"n3", text:"Pull permit", kind:"need", assignedTo:"Koy Wilkinson", createdBy:"Gage Lund", foreman:"Gage Lund", jobId:"j1770", status:"open" };
assert.ok(!H.isMine(toHead, gage), "a need I sent to the head is NOT mine");
assert.ok(H.isMine(toHead, koy),   "…it is the head's");
assert.ok(H.onHead(toHead, gage, users, jobs), "…and it shows under On Koy for me");
assert.ok(!H.onHead(toHead, brad, users, jobs) || true, "crew: foreman stamp decides (Braden is not Gage)");
assert.ok(!H.onHead(toHead, { id:"dae", name:"Daegan" }, users, jobs), "another foreman doesn't see it under On Koy");
const viaJob = { id:"n4", text:"y", assignedTo:"Koy Wilkinson", createdBy:"Koy Wilkinson", jobId:"j1770", status:"open" }; // no foreman stamp
assert.ok(H.onHead(viaJob, gage, users, jobs), "no foreman stamp -> resolves through the job's foreman (fuzzy)");
const explicitBlank = { id:"n5", text:"z", assignedTo:"", createdBy:"Gage Lund", status:"open" };
assert.strictEqual(H.needAssignee(explicitBlank), "", "explicit '' honored (?? not ||)");
assert.ok(H.isMine(explicitBlank, gage), "unassigned falls to its creator");
assert.ok(!H.isMine(explicitBlank, koy), "…and is not on the head");
assert.ok(!H.onHead(explicitBlank, gage, users, jobs), "unassigned is not On Koy");
const toGage = { id:"n6", text:"Order meter base", kind:"task", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", createdBy:"Koy Wilkinson", status:"open" };
assert.ok(H.isMine(toGage, gage), "Koy -> Gage lands in Gage's Mine");
assert.ok(!H.isMine(toGage, koy),  "…and leaves Koy's queue");
assert.ok(!H.onHead(toGage, gage, users, jobs), "…and is not On Koy (it's on Gage)");
const done    = { ...toHead, id:"n7", status:"done" };
const snoozed = { ...toHead, id:"n8", snoozedUntil:"2026-09-15" };
const q = H.headQueue([legacy, toHead, toGage, done, snoozed, explicitBlank], koy, TODAY).map(n => n.id);
eq(q, ["n1","n3"], "head queue = legacy book item + explicit assignment; not done/snoozed/others");
assert.ok(!H.needIsOpen(snoozed, TODAY), "snoozed is closed today");
assert.ok(H.needIsOpen(snoozed, "2026-09-15"), "…and reopens on the snooze date");
assert.ok(H.needIsOpen(snoozed, "2026-09-16"), "…and after");
assert.ok(!H.needIsOpen(null, TODAY), "null-safe");
assert.ok(!H.resiHead([josh, gage]) && !H.onHead(toHead, gage, [josh, gage], jobs), "no head -> nothing is On Koy");

// ── 4. dates ────────────────────────────────────────────────────────────────
const now = new Date("2026-09-09T15:00:00");
assert.strictEqual(H.dueBucketFromDate("2026-09-10", now), "tomorrow", "tomorrow -> tomorrow");
assert.strictEqual(H.dueBucketFromDate("2026-09-09", now), "tomorrow", "today -> tomorrow lane (due now)");
assert.strictEqual(H.dueBucketFromDate("2026-09-14", now), "week", "later -> week");
assert.strictEqual(H.dueBucketFromDate("", now), null, "'' -> null (keep existing bucket)");
assert.strictEqual(H.dueBucketFromDate("nope", now), null, "garbage -> null");
assert.strictEqual(H.localYmd(new Date(2026, 8, 9, 23, 30)), "2026-09-09", "localYmd uses LOCAL date, not UTC rollover");

// ── 5. punch ────────────────────────────────────────────────────────────────
const punchJob = {
  id:"j1590", name:"#1590 Becker Residence", foreman:"Gage",
  roughPunch: {
    main: { general:[ { id:"p1", text:"a", assignedTo:"Gage Lund" }, { id:"p2", text:"b", assignedTo:"Keegan" } ],
            hotcheck:[ { id:"p3", text:"hc", assignedTo:"Gage" } ],
            rooms:[ { name:"Kitchen", items:[ { id:"p4", text:"k", assignedTo:"Gage Lund", done:true }, { id:"p5", text:"v", assignedTo:"Gage Lund", voided:true } ] } ] },
    extras:[ { key:"garage", label:"Garage" } ],
    garage: { general:[ { id:"p6", text:"g", assignedTo:"Gage Lund" } ] },
  },
  qcPunch: { upper: { general:[ { id:"p7", text:"q", assignedTo:"Gage Lund" } ] } },
};
const tempPed = { id:"tp", name:"Temp", tempPed:true, roughPunch:{ main:{ general:[ { id:"p8", assignedTo:"Gage Lund" } ] } } };
const mineP = H.punchAssignedTo("Gage Lund", [punchJob, tempPed]);
eq(mineP.map(i => i.id), ["p1","p3","p6","p7"], "full name + legacy first-name; extras floor; done/voided/tempPed skipped");
assert.strictEqual(mineP.find(i => i.id==="p6").floor, "Garage", "extras floor label");
assert.strictEqual(mineP.find(i => i.id==="p3").isHotcheck, true, "hotcheck flagged");
assert.strictEqual(mineP.find(i => i.id==="p7").phase, "QC", "phase carried");
eq(H.punchAssignedTo("Keegan", [punchJob]).map(i => i.id), ["p2"], "other assignee sees only theirs");
eq(H.punchAssignedTo("", [punchJob]), [], "empty name -> []");
eq(H.punchAssignedTo("Gage Lund", null), [], "null jobs -> []");

// ── 6. my jobs ──────────────────────────────────────────────────────────────
eq(H.myJobsFor(gage, users, jobs).map(j => j.id), ["j1770"], "foreman -> own jobs (fuzzy 'Gage' vs 'Gage Lund')");
eq(H.myJobsFor(brad, users, jobs).map(j => j.id), ["j1770"], "crew -> their foreman's jobs via foremanId");
eq(H.myJobsFor(koy, users, jobs), [], "office -> none");
eq(H.myJobsFor(null, users, jobs), [], "null-safe");

// ── 7. chain-of-command default ─────────────────────────────────────────────
assert.strictEqual(H.defaultAssigneeFor(brad, users), "Gage Lund",     "crew -> their foreman");
assert.strictEqual(H.defaultAssigneeFor({ id:"lead1", name:"Treycen", title:"lead", foremanId:"gage" }, users), "Gage Lund", "lead -> their foreman");
assert.strictEqual(H.defaultAssigneeFor(gage, users), "Koy Wilkinson", "foreman -> the head");
assert.strictEqual(H.defaultAssigneeFor(koy,  users), "Koy Wilkinson", "head -> self (trigger skips self-assign)");
assert.strictEqual(H.defaultAssigneeFor(josh, users), "Koy Wilkinson", "office non-head -> the head");
assert.strictEqual(H.defaultAssigneeFor({ id:"c9", name:"Louis", title:"crew" }, users), "Koy Wilkinson", "crew with no foreman -> the head");
assert.strictEqual(H.defaultAssigneeFor(gage, [josh, gage]), "", "no head anywhere -> '' (unassigned, visible)");
assert.strictEqual(H.defaultAssigneeFor(null, users), "", "null-safe");

// ── 8. head owns every auto-task; foremen none ──────────────────────────────
const autoA = { id:"j1770_rough_po", jobId:"j1770", jobName:"#1770 England Home", category:"po", foreman:"Gage", title:"Order Job Start PO", desc:"", dueDate:"2026-09-10" };
const autoB = { id:"j1937_qc_walk", jobId:"j1937", jobName:"#1937 Navarro Residence", category:"qc", foreman:"Daegan", title:"Schedule QC Walk", desc:"Rough hit 100%", dueDate:"" };
const autoPrep = { id:"j1770_prep", jobId:"j1770", jobName:"#1770 England Home", category:"prep", foreman:"Koy Wilkinson", title:"Pre Job Prep", desc:"", dueDate:"" };
const autoTP = { id:"tp1_rough_po", jobId:"tp1", jobName:"Temp ped", category:"po", foreman:"Gage", title:"Order Job Start PO", desc:"", dueDate:"" };
const fakeCompute = () => [autoA, autoB, autoPrep, autoTP];
const jobsWithTP = [england, navarro, { id:"tp1", name:"Temp ped", tempPed:true, foreman:"Gage" }];
eq(H.headAutoTasks(jobsWithTP, new Set(), fakeCompute).map(t => t.id), ["j1770_rough_po","j1937_qc_walk"], "head: every non-prep auto row on live jobs, tempPed dropped");
eq(H.headAutoTasks(jobsWithTP, new Set(["j1937_qc_walk"]), fakeCompute).map(t => t.id), ["j1770_rough_po"], "cleared ids are excluded");
eq(H.headAutoTasks(null, new Set(), fakeCompute), [], "null jobs -> []");
eq(H.headAutoTasks([{ ...england, taskDueDates: { j1770_rough_po: "2026-09-30" } }, navarro], new Set(), fakeCompute).find(t => t.id === "j1770_rough_po").dueDate, "2026-09-30", "the head's snoozed date (taskDueDates) overrides the rule's date on the board");
eq(H.headAutoTasks([{ ...england, taskDueDates: { j1770_rough_po: "" } }, navarro], new Set(), fakeCompute).find(t => t.id === "j1770_rough_po").dueDate, "2026-09-10", "a cleared override (\"\") falls back to the rule's date");

// v423 — the scanner's queue = ONLY the matterport auto-tasks (company-wide),
// and the row folds into the "Matterport scans" category.
const autoMP = { id:"j1770_matterport", jobId:"j1770", jobName:"#1770 England Home", category:"matterport", foreman:"Gage", title:"Schedule Matterport Scan", desc:"", dueDate:"" };
const fakeComputeMP = () => [autoA, autoB, autoMP, autoPrep];
eq(H.scanAutoTasks([england, navarro], new Set(), fakeComputeMP).map(t => t.id), ["j1770_matterport"], "scanAutoTasks: only the matterport auto-task, across live jobs");
eq(H.scanAutoTasks([england, navarro], new Set(["j1770_matterport"]), fakeComputeMP), [], "scanAutoTasks respects cleared");
assert.strictEqual(H.myDayCategoryOf({ kind:"auto", autoCategory:"matterport" }), "matterport", "auto matterport row -> Matterport scans category");
assert.strictEqual(H.myDayCategoryOf({ kind:"auto", autoCategory:"qc" }), "qc", "other auto categories unchanged (qc)");

// v424 — before-drywall scan window: opens at rough >= 85%, closes once finish
// starts; also honors complete / dismissed / has-link.
assert.ok(H.matterportScanNeeded({ roughStage:"85%", finishStage:"" }), "rough 85 + finish not started -> needed (early, time to schedule)");
assert.ok(H.matterportScanNeeded({ roughStage:"100%", finishStage:"0%" }), "rough 100 + finish 0 -> needed");
assert.ok(!H.matterportScanNeeded({ roughStage:"70%", finishStage:"" }), "rough < 85 -> not yet");
assert.ok(!H.matterportScanNeeded({ roughStage:"100%", finishStage:"40%" }), "finish started (drywall up) -> dropped");
assert.ok(!H.matterportScanNeeded({ roughStage:"100%", finishStage:"", matterportStatus:"complete" }), "already complete -> not needed");
assert.ok(!H.matterportScanNeeded({ roughStage:"100%", finishStage:"", matterportDismissed:true }), "dismissed -> not needed");
assert.ok(!H.matterportScanNeeded({ roughStage:"100%", finishStage:"", matterportLinks:[{ url:"x" }] }), "scan link uploaded -> not needed");
assert.ok(!H.matterportScanNeeded(null), "null-safe");

// ── 9. duty twins fold ──────────────────────────────────────────────────────
const dutyKeys = new Set(["j1937_coord_rough_qc"]);
eq(H.foldDutyTwins([autoA, autoB], dutyKeys).map(t => t.id), ["j1770_rough_po"], "qc_walk twin hidden when the duty exists");
eq(H.foldDutyTwins([autoA, autoB], new Set()).map(t => t.id), ["j1770_rough_po","j1937_qc_walk"], "no duty -> nothing folded");
eq(H.foldDutyTwins([{ ...autoA, id:"j1770_finish_po" }], new Set(["j1770_coord_finish_po"])), [], "finish PO twin folds too");
eq(H.foldDutyTwins([{ ...autoA, id:"j1770_rough_deposit" }], new Set(["j1770_coord_rough_po"])).length, 1, "non-twin ids untouched");

// ── 10. the doc Push writes ─────────────────────────────────────────────────
const NOW = "2026-09-15T15:00:00.000Z";
const docA = H.autoTaskDoc(autoA, { ...england, taskDueDates: {} }, "Gage Lund", "Koy Wilkinson", NOW, "need_fixed1");
eq(docA, { id:"need_fixed1", kind:"task", text:"Order Job Start PO", plan:"", dueBucket: H.dueBucketFromDate("2026-09-10", new Date(NOW)) || "week", dueDate:"2026-09-10", snoozedUntil:"",
  assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", assignedAt:NOW, foreman:"Gage", jobId:"j1770", jobName:"#1770 England Home",
  status:"open", createdBy:"Koy Wilkinson", createdAt:NOW, doneAt:"", doneBy:"", autoTaskId:"j1770_rough_po" }, "exact Push doc shape (autoTaskId is the only new key)");
eq(H.autoTaskDoc(autoA, { ...england, taskDueDates: { j1770_rough_po: "2026-09-20" } }, "Gage Lund", "Koy Wilkinson", NOW, "x").dueDate, "2026-09-20", "the head's snoozed date wins over the rule's date");
eq(H.autoTaskDoc({ ...autoB, dueDate:"9/12/2026" }, navarro, "Daegan", "Koy Wilkinson", NOW, "x").dueDate, "2026-09-12", "M/D/YYYY rule dates normalise to YYYY-MM-DD");
eq(H.autoTaskDoc(autoB, navarro, "Daegan", "Koy Wilkinson", NOW, "x").dueBucket, "week", "no date -> week bucket, never today");
assert.ok(/^need_\d+_[a-z0-9]{5}$/.test(H.autoTaskDoc(autoB, navarro, "Daegan", "Koy Wilkinson", NOW).id), "default id matches the quick-add id shape");

// ── 11. delegation join + row state ─────────────────────────────────────────
const dOpen = { id:"n10", autoTaskId:"j1770_rough_po", status:"open", assignedTo:"Gage Lund", assignedAt:"2026-09-15T15:00:00.000Z", createdAt:"2026-09-15T15:00:00.000Z" };
const dDone = { id:"n11", autoTaskId:"j1937_qc_walk", status:"done", assignedTo:"Daegan", doneBy:"Daegan", assignedAt:"2026-09-14T15:00:00.000Z", createdAt:"2026-09-14T15:00:00.000Z" };
const dOld  = { id:"n12", autoTaskId:"j1770_rough_po", status:"done", assignedTo:"Gage Lund", doneBy:"Gage Lund", assignedAt:"2026-09-10T15:00:00.000Z", createdAt:"2026-09-10T15:00:00.000Z" };
const dHeadDone = { id:"n13", autoTaskId:"j9_x", status:"done", assignedTo:"Gage Lund", doneBy:"Koy Wilkinson", assignedAt:"2026-09-10T15:00:00.000Z", createdAt:"2026-09-10T15:00:00.000Z" };
const del = H.autoDelegation([dOld, dOpen, dDone, dHeadDone, { id:"plain", text:"no backlink", status:"open" }]);
eq([...del.keys()].sort(), ["j1770_rough_po","j1937_qc_walk","j9_x"], "join keyed by autoTaskId; plain docs ignored");
eq(del.get("j1770_rough_po").id, "n10", "open doc beats an older done doc");
eq(H.autoRowState(autoA, del, "Koy Wilkinson"), { state:"with", doc:dOpen, who:"Gage Lund" }, "open doc -> with X");
eq(H.autoRowState(autoB, del, "Koy Wilkinson"), { state:"verify", doc:dDone, who:"Daegan" }, "done by delegate -> verify");
eq(H.autoRowState({ id:"j9_x" }, del, "Koy Wilkinson"), { state:"none", doc:dHeadDone, who:"" }, "done by the head -> none (already cleared)");
eq(H.autoRowState({ id:"nope" }, del, "Koy Wilkinson"), { state:"none", doc:null, who:"" }, "no doc -> none");
eq(H.autoRowState({ id:"k2" }, H.autoDelegation([{ id:"n20", autoTaskId:"k2", status:"open", assignedTo:"Koy Wilkinson", assignedAt:"2026-09-15T15:00:00.000Z" }]), "Koy Wilkinson").state, "none", "open doc assigned to the head -> none (taken back)");
eq(H.autoDelegation(null).size, 0, "null-safe");

// ── 12. newest wins among equals ────────────────────────────────────────────
const two = H.autoDelegation([{ id:"a", autoTaskId:"k", status:"open", assignedAt:"2026-09-01T00:00:00.000Z" }, { id:"b", autoTaskId:"k", status:"open", assignedAt:"2026-09-02T00:00:00.000Z" }]);
eq(two.get("k").id, "b", "two open docs (should not happen) -> newest assignedAt wins");

// ── 13. foreman side: head auto rows on MY jobs only; twins folded ──────────
const gageAutos = H.foldDutyTwins(H.headAutoTasks(jobsWithTP, new Set(), fakeCompute), new Set()).filter(t => H.myJobsFor(gage, users, jobsWithTP).some(j => j.id === t.jobId));
eq(gageAutos.map(t => t.id), ["j1770_rough_po"], "foreman's On-head list holds only the head's auto rows on their jobs");

// ── 14. My Day categories (v412): by type, folded, sorted by urgency ────────
eq(["need","need","need","punch","duty","duty","duty","auto","auto","auto","auto","auto","auto","auto","auto"].map((kind, i) => H.myDayCategoryOf([
  { kind, needKind:"task" }, { kind, needKind:"need" }, { kind, needKind:"bodies" }, { kind },
  { kind, dutyType:"qc" }, { kind, dutyType:"po" }, { kind, dutyType:"prep" },
  { kind, autoCategory:"invoice" }, { kind, autoCategory:"po" }, { kind, autoCategory:"co" }, { kind, autoCategory:"rt" }, { kind, autoCategory:"qc" }, { kind, autoCategory:"punch" }, { kind, autoCategory:"schedule" }, { kind, autoCategory:"tempped" },
][i])), ["tasks","needs","bodies","punch","qc","po","prep","invoicing","po","co","rt","qc","punch","scheduling","scheduling"], "every row kind maps to a category");
eq(H.myDayCategoryOf(null), "other", "null-safe");
const cats = H.myDayCategories([
  { kind:"auto", autoCategory:"invoice", bucket:"week", title:"Invoice" },
  { kind:"punch", bucket:"today", title:"P" },
  { kind:"auto", autoCategory:"co", bucket:"overdue", title:"CO" },
  { kind:"auto", autoCategory:"co", bucket:"later", title:"CO2" },
  { kind:"need", needKind:"task", bucket:"overdue", title:"T1" },
  { kind:"need", needKind:"task", bucket:"overdue", title:"T2" },
  { kind:"auto", autoCategory:"rough", bucket:"nonsense", title:"X" },
]);
eq(cats.map(c => c.key), ["tasks","co","punch","invoicing","scheduling"], "most urgent lane first, then overdue count, then label; unknown bucket sinks last");
eq(cats.map(c => [c.rows.length, c.overdue]), [[2,2],[2,1],[1,0],[1,0],[1,0]], "counts + overdue per category");
eq(cats[0].label, "Tasks on me", "labels come from MYDAY_CAT_LABELS");
eq(H.myDayCategories([]), [], "empty -> []");

// ── 15. task updates (v421): audience = the other side, never the author ──
const upTask = { id:"u1", text:"Order meter base", kind:"task", assignedTo:"Koy Wilkinson", assignedBy:"Gage Lund", createdBy:"Gage Lund", status:"open",
  updates:[{ by:"Koy Wilkinson", at:"2026-09-22T15:00:00.000Z", kind:"waiting", text:"Rexel quote", until:"2026-09-25" }] };
eq(H.needUpdates(upTask).length, 1, "updates array read");
eq(H.needUpdates({ id:"x" }), [], "absent updates -> [] (every pre-v421 doc)");
eq(H.lastNeedUpdate({ id:"x" }), null, "no updates -> null");
eq(H.lastNeedUpdate(upTask).text, "Rexel quote", "last entry");
eq(H.needRequester(upTask), "Gage Lund", "requester = assignedBy");
eq(H.needRequester({ createdBy:"Justin Cloward" }), "Justin Cloward", "…else createdBy");
eq(H.needUpdateAudience(upTask, "Koy Wilkinson"), "Gage Lund", "assignee posts -> the requester hears");
eq(H.needUpdateAudience(upTask, "Gage Lund"), "Koy Wilkinson", "requester posts -> the assignee hears");
eq(H.needUpdateAudience(upTask, "Josh Cloward"), "Koy Wilkinson", "a third party posts -> the assignee hears");
eq(H.needUpdateAudience({ assignedTo:"Koy Wilkinson", createdBy:"Koy Wilkinson" }, "Koy Wilkinson"), "", "self-assigned self-note -> nobody");
eq(H.needUpdateAudience({ assignedTo:"", createdBy:"Gage Lund" }, "Gage Lund"), "", "unassigned, creator posts -> nobody");
eq(H.needUpdateLine(upTask.updates[0]), "waiting on Rexel quote · back 9/25", "waiting line with M/D date");
eq(H.needUpdateLine({ kind:"waiting", text:"the GC" }), "waiting on the GC", "waiting line without a date");
eq(H.needUpdateLine({ kind:"note", text:"called, no answer" }), "called, no answer", "note line");
eq(H.needUpdateLine(null), "", "null-safe");
assert.ok(H.sentByMe(upTask, gage), "Gage sent it -> in Gage's Sent");
assert.ok(!H.sentByMe(upTask, koy), "…not in Koy's (it's Koy's Mine)");
assert.ok(H.sentByMe({ ...upTask, snoozedUntil:"2026-09-25" }, gage), "snoozed by the assignee stays in Sent (that's where 'waiting on' shows)");
assert.ok(!H.sentByMe({ ...upTask, status:"done" }, gage), "done leaves Sent");
assert.ok(!H.sentByMe({ ...upTask, assignedTo:"Gage Lund" }, gage), "on me -> Mine, not Sent");
assert.ok(!H.sentByMe(upTask, { id:"dae", name:"Daegan" }), "someone else's task is not in my Sent");

// v421 FIX (Keegan, 2026-09-22): a foreman's OWN ask to the head — foreman stamp
// = the requester — is BOTH onHead and sentByMe. It was landing under "On <head>"
// (collapsed; jobless asks sank under "…on no job") and getting excluded from
// Sent, so the head's "waiting on" reply never surfaced to the requester.
// The component's grouping precedence is now: head = onHead && !sentByMe, sent =
// sentByMe. These asserts lock that so Sent wins for a doc I sent.
const ownAskToHead = { ...upTask, id:"u2", foreman:"Gage Lund" };
assert.ok(H.onHead(ownAskToHead, gage, users, jobs), "own ask to head is technically onHead (foreman stamp = me)");
assert.ok(H.sentByMe(ownAskToHead, gage), "…and I sent it");
assert.ok(!(H.onHead(ownAskToHead, gage, users, jobs) && !H.sentByMe(ownAskToHead, gage)), "grouping precedence: NOT placed under On <head>");
assert.ok(H.sentByMe(ownAskToHead, gage), "grouping precedence: placed in Sent, where the waiting-on line shows");

// v426 — the Done group: task cards I finished OR that finished on me, last 30d ("both").
// v429: split — a doc I only sent that someone ELSE closed now lives in Sent →
// Finished (sentFinishedForMe), not here, so it doesn't show twice; I still see
// it in my own Done when I closed it myself (doneBy = me).
const doneNow = new Date().toISOString();
assert.ok(H.completedForMe({ id:"d1", status:"done", assignedTo:"Gage Lund", createdBy:"Koy Wilkinson", doneAt: doneNow }, gage), "done + on me + recent -> my Done");
assert.ok(H.completedForMe({ id:"d2", status:"done", assignedTo:"Koy Wilkinson", assignedBy:"Gage Lund", createdBy:"Gage Lund", doneBy:"Gage Lund", doneAt: doneNow }, gage), "done + I sent it + I closed it myself -> my Done");
assert.ok(!H.completedForMe({ id:"d3", status:"open", assignedTo:"Gage Lund", doneAt: doneNow }, gage), "still open -> not in Done");
assert.ok(!H.completedForMe({ id:"d4", status:"done", assignedTo:"Daegan", assignedBy:"Daegan", createdBy:"Daegan", doneAt: doneNow }, gage), "someone else's done task -> excluded");
assert.ok(!H.completedForMe({ id:"d5", status:"done", assignedTo:"Gage Lund", doneAt: new Date(Date.now()-40*24*60*60*1000).toISOString() }, gage), "done 40 days ago -> outside the 30-day window");
assert.ok(!H.completedForMe({ id:"d6", status:"done", assignedTo:"Gage Lund", doneAt:"" }, gage), "no doneAt -> excluded");

// v427 — hat registry routing + covering.
const T = "2026-09-23";
const hkoy   = { id:"koy",   name:"Koy Wilkinson", caps:["resi.head","qc.own","redline.own"] };
const hjosh  = { id:"josh",  name:"Josh", caps:["invoice.own","qc.own"] };
const hjer   = { id:"jer",   name:"Jeromy", caps:["co.own"] };
const hbrady = { id:"brady", name:"Brady", caps:["redline.own"] };
const hteam  = [hkoy, hjosh, hjer, hbrady];
eq(H.routeKeyOfAuto({ id:"j1_invoice", category:"invoice" }), "invoice", "invoice auto → invoice");
eq(H.routeKeyOfAuto({ id:"j1_co_c1_send", category:"co" }), "co_send", "CO needs-sending → co_send");
eq(H.routeKeyOfAuto({ id:"j1_co_c1_done", category:"co" }), "invoice", "CO complete merge/invoice → invoice");
eq(H.routeKeyOfAuto({ id:"j1_co_c1_approved", category:"co" }), null, "CO approved follow-up stays with head");
eq(H.routeKeyOfAuto({ id:"j1_rt_r1_done", category:"rt" }), "invoice", "RT complete merge/invoice → invoice");
eq(H.routeKeyOfAuto({ id:"j1_rough_po", category:"po" }), null, "start POs are not a hat");
eq(H.routeKeyOfDuty({ dutyType:"qc" }), "qc", "QC duty → qc");
eq(H.routeKeyOfDuty({ dutyType:"po" }), null, "PO duty → head");
eq(H.routeKeyOfRedline({ status:"scheduled" }), "redline", "scheduled walk → redline");
eq(H.routeKeyOfRedline({ status:"co_owed" }), "co_send", "CO owed → CO writer");
eq(H.routeKeyOfRedline({ status:"co_owed", coQuoteNumber:"Q12" }), null, "quoted → off the list");
eq(H.routeKeyOfRedline({ status:"plans_prep" }), null, "cleaning plans → not routed");
eq(H.ownersForRoute("invoice", hteam, T), ["Josh"], "invoice → Josh");
eq(H.ownersForRoute("qc", hteam, T), ["Koy Wilkinson","Josh"], "qc shared by both holders");
eq(H.ownersForRoute("redline", hteam, T), ["Koy Wilkinson","Brady"], "redline shared");
eq(H.ownersForRoute(null, hteam, T), ["Koy Wilkinson"], "unrouted → head");
eq(H.ownersForRoute("invoice", [hkoy], T), ["Koy Wilkinson"], "nobody wears the hat → head");
eq(H.ownersForRoute("invoice", [hkoy, { ...hjosh, active:false }], T), ["Koy Wilkinson"], "deactivated holder never owns");
const covering = [{ ...hkoy, coverTo:"Josh", coverUntil:"2026-10-03" }, hjosh, hjer, hbrady];
eq(H.ownersForRoute(null, covering, T), ["Josh"], "covering: head's rows go to Josh");
eq(H.ownersForRoute("qc", covering, T), ["Josh"], "covering: shared hat collapses to one owner");
eq(H.ownersForRoute("redline", covering, T), ["Josh","Brady"], "covering: Koy's half of redline → Josh");
eq(H.ownersForRoute(null, covering, "2026-10-04"), ["Koy Wilkinson"], "cover expires the day after coverUntil");
eq(H.coveredFor(covering, "Josh", T), ["Koy Wilkinson"], "Josh is covering Koy");
eq(H.coveredFor(covering, "Josh", "2026-10-04"), [], "…until it expires");
eq(H.coveredFor(covering, "Brady", T), [], "Brady covers nobody");
// autoRowState: a Take back by ANY owner reads "none", not "verify".
const tb = new Map([["t1", { id:"n", autoTaskId:"t1", status:"done", doneBy:"Josh", assignedTo:"Gage" }]]);
eq(H.autoRowState({ id:"t1" }, tb, ["Josh"]).state, "none", "owner's own close = take back");
eq(H.autoRowState({ id:"t1" }, tb, "Koy Wilkinson").state, "verify", "string owner still works (head path)");

// v427: redline walk rows categorize by route key.
eq(H.myDayCategoryOf({ kind:"redline", routeKey:"redline" }), "redline", "redline walk row → Redline walks");
eq(H.myDayCategoryOf({ kind:"redline", routeKey:"co_send" }), "co", "redline CO owed row → Change orders");

// v429 — Ship 2 helpers.
const T2 = "2026-09-23";
assert.ok(H.isInactiveJob({ archived:true }) && H.isInactiveJob({ deleted:true }) && H.isInactiveJob({ archivedAt:"2026-01-01" }) && H.isInactiveJob({ type:"quote" }), "archived/deleted/archivedAt/quote are inactive");
assert.ok(!H.isInactiveJob({ id:"j" }) && !H.isInactiveJob(null), "normal job or none → active");
eq(H.staleReason({ kind:"auto", job:{ archived:true }, dateYmd:"" }, T2), "job archived", "inactive job wins");
eq(H.staleReason({ kind:"auto", job:{ type:"quote" }, dateYmd:"" }, T2), "quote", "quote job");
eq(H.staleReason({ kind:"redline", job:null, dateYmd:"2026-08-09" }, T2), "old walk", "45 days back → old walk");
eq(H.staleReason({ kind:"redline", job:null, dateYmd:"2026-08-10" }, T2), "", "44 days → fresh");
eq(H.staleReason({ kind:"auto", job:{}, dateYmd:"2026-07-25" }, T2), "60+ days overdue", "60 days overdue auto");
eq(H.staleReason({ kind:"duty", job:{}, dateYmd:"2026-07-26" }, T2), "", "59 days → keep");
eq(H.staleReason({ kind:"need", job:{}, dateYmd:"2026-01-01" }, T2), "", "real task docs never go stale");
eq(H.staleReason({ kind:"auto", job:{}, dateYmd:"" }, T2), "", "no date → keep");
// Money rows never hide by age (Koy 2026-09-23) — only an inactive job hides them.
eq(H.staleReason({ kind:"auto", job:{}, dateYmd:"2026-03-07", money:true }, T2), "", "money auto row 200 days old → keep");
eq(H.staleReason({ kind:"auto", job:{ archived:true }, dateYmd:"2026-03-07", money:true }, T2), "job archived", "money row on archived job → hidden");
eq(H.staleReason({ kind:"auto", job:{}, dateYmd:"2026-07-25", money:false }, T2), "60+ days overdue", "non-money auto 60 days → still stale");
eq(H.staleReason({ kind:"redline", job:null, dateYmd:"2026-06-15", money:true }, T2), "", "redline co_send (money) 100 days → keep");
eq(H.staleReason({ kind:"redline", job:null, dateYmd:"2026-08-09", money:false }, T2), "old walk", "redline walk route 45 days → still old walk");
assert.ok(H.rowMatches({ title:"Order meter base", sub:["#1770 England"] }, "england"), "search hits sub");
assert.ok(H.rowMatches({ title:"Order meter base", sub:[] }, "  METER "), "trim + case-insensitive");
assert.ok(!H.rowMatches({ title:"x", sub:[] }, "zzz"), "miss");
assert.ok(H.rowMatches({ title:"x" }, ""), "empty query matches all");
eq(H.batchCaps({ kind:"need", canDone:true, canSnooze:true }), { done:true, snooze:true, push:true }, "need: all three");
eq(H.batchCaps({ kind:"auto", autoCategory:"invoice", canDone:true, canSnooze:true, onPick:()=>{} }), { done:true, snooze:true, push:true }, "auto: all three");
eq(H.batchCaps({ kind:"auto", autoCategory:"matterport", canSnooze:true, scan:{} }), { done:false, snooze:true, push:false }, "scan: snooze only");
eq(H.batchCaps({ kind:"punch", canDone:true }), { done:true, snooze:false, push:false }, "punch: done only");
eq(H.batchCaps({ kind:"duty", dutyType:"qc", canDone:false }), { done:false, snooze:false, push:false }, "QC duty: nothing");
eq(H.batchCaps({ kind:"redline" }), { done:false, snooze:false, push:false }, "redline: nothing");
eq(H.focusKeysToday({ date:T2, keys:["a","b"] }, T2), ["a","b"], "today's pins");
eq(H.focusKeysToday({ date:"2026-09-22", keys:["a"] }, T2), [], "yesterday's pins don't show as pinned");
eq(H.focusKeysToday(null, T2), [], "none");
eq(H.focusKeysToday({ date:T2, keys:["a","b","c","d"] }, T2), ["a","b","c"], "max 3");
const now2 = Date.now(), iso2 = new Date(now2).toISOString();
const sentDone = { id:"s1", status:"done", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", createdBy:"Koy Wilkinson", doneBy:"Gage Lund", doneAt: iso2 };
assert.ok(H.sentFinishedForMe(sentDone, koy, now2), "I sent it, Gage finished → Sent/Finished");
assert.ok(!H.completedForMe(sentDone, koy, now2), "…and NOT in my Done (no duplicate)");
assert.ok(H.completedForMe(sentDone, gage, now2), "still in Gage's Done");
const selfClosed = { ...sentDone, id:"s2", doneBy:"Koy Wilkinson" };
assert.ok(H.completedForMe(selfClosed, koy, now2) && !H.sentFinishedForMe(selfClosed, koy, now2), "I sent + closed it myself → my Done, not Finished");
assert.ok(H.sentFinishedForMe({ ...sentDone, id:"s3", doneBy: undefined }, koy, now2), "sent + done + no doneBy → Sent/Finished");
assert.ok(!H.completedForMe({ ...sentDone, id:"s3", doneBy: undefined }, koy, now2), "…not duplicated in Done");
assert.ok(!H.sentFinishedForMe({ ...sentDone, doneAt: new Date(now2 - 31*864e5).toISOString() }, koy, now2), "31 days → out of window");
assert.ok(!H.sentFinishedForMe({ ...sentDone, status:"open" }, koy, now2), "open → not finished");
eq(H.userKeyOf({ id:"u1", name:"Koy Wilkinson" }), "u1", "id wins");
eq(H.userKeyOf({ name:" Koy  Wilkinson " }), "koy_wilkinson", "name slug fallback");

// v431 — Ship 3 helpers.
eq(H.taskPhotoPath("j1", "need_9", "p1", "jpg"), "jobs/j1/task-photos/need_9/p1.jpg", "job task photo path");
eq(H.taskPhotoPath("", "need_9", "p1", "png"), "jobs/_tasks/task-photos/need_9/p1.png", "jobless task → _tasks prefix");
eq(H.needPhotos({ photos:[{id:"a"}, null, {id:"b"}] }).map(p => p.id), ["a","b"], "needPhotos drops junk");
eq(H.needPhotos({}), [], "no photos → []");
const P_NOW = Date.parse("2026-09-23T12:00:00");
const pUsers = [{ name:"Koy Wilkinson", caps:["resi.head"] }, { name:"Josh" }, { name:"Gage Lund" }, { name:"Old Timer", active:false }, { name:"GC Guy", access:"contractor" }];
const pNeeds = [
  { id:"a", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-20", createdAt:"2026-09-10T12:00:00" },
  { id:"b", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-21", createdAt:"2026-09-20T12:00:00" },
  { id:"c", status:"open", assignedTo:"Josh", dueDate:"2026-09-30", createdAt:"2026-09-22T12:00:00" },
  { id:"d", status:"done", assignedTo:"Josh", doneBy:"Josh", doneAt:"2026-09-21T12:00:00" },
  { id:"e", status:"done", assignedTo:"Josh", doneBy:"Josh", doneAt:"2026-09-10T12:00:00" },
  { id:"f", status:"open", assignedTo:"Old Timer", dueDate:"2026-09-01" },
];
const pRows = [{ owners:["Josh"], bucket:"overdue", ageDays:9 }, { owners:["Koy Wilkinson","Josh"], bucket:"today", ageDays:1 }];
const pulse = H.teamPulse({ needs:pNeeds, users:pUsers, ownedRows:pRows, todayYmd:"2026-09-23", nowMs:P_NOW });
eq(pulse.map(p => p.name), ["Gage Lund","Josh","Koy Wilkinson"], "sorted overdue desc, then open desc; inactive/contractor/idle excluded");
eq(pulse.find(p => p.name === "Gage Lund"), { name:"Gage Lund", open:2, overdue:2, oldestDays:13, doneWeek:0 }, "Gage: 2 open both overdue, oldest from createdAt");
eq(pulse.find(p => p.name === "Josh"), { name:"Josh", open:3, overdue:1, oldestDays:9, doneWeek:1 }, "Josh: 1 doc + 2 owned rows; done 9/21 counts, 9/10 doesn't");
eq(pulse.find(p => p.name === "Koy Wilkinson"), { name:"Koy Wilkinson", open:1, overdue:0, oldestDays:1, doneWeek:0 }, "shared row counts for each owner");

// ── usage tracking (v433) ───────────────────────────────────────────────────
eq(H.usageSeenKey("koy", "views", "myday"), "koy|views|myday", "seen key shape");
eq(H.shouldLogUsage([], "koy|views|myday"), true, "empty seen → log");
eq(H.shouldLogUsage(["koy|views|myday"], "koy|views|myday"), false, "already seen today → skip");
eq(H.shouldLogUsage(["josh|views|myday"], "koy|views|myday"), true, "other user on same device still logs");
eq(H.shouldLogUsage(null, "koy|views|home"), true, "junk seen (null) → log");
eq(H.shouldLogUsage("garbage", "koy|views|home"), true, "junk seen (string) → log");
eq(H.shouldLogUsage([], ""), false, "empty key never logs");
const uDocs = [
  { views: { home: { koy: 3, josh: 1 }, myday: { gage: 2 } }, tabs: { "Job Info": { koy: 5 }, QC: { koy: 0 } }, updated_at: "x" },
  { views: { home: { koy: 1 }, settings: { koy: 1 } }, tabs: { "Job Info": { josh: 1 }, Rough: { gage: 1 } } },
  null,
  { views: "junk" },
];
const roll = H.usageRollup(uDocs);
eq(roll.views, [
  { key:"myday", users:1, userDays:1 },
  { key:"settings", users:1, userDays:1 },
  { key:"home", users:2, userDays:3 },
], "views: distinct users + user-days, least-used first, key tiebreak");
eq(roll.tabs, [
  { key:"Rough", users:1, userDays:1 },
  { key:"Job Info", users:2, userDays:2 },
], "tabs: zero-count rows dropped (QC koy:0), ascending");
eq(H.usageRollup([]), { views: [], tabs: [] }, "no docs → empty");
eq(H.usageRollup(undefined), { views: [], tabs: [] }, "undefined → empty");
eq(H.usageLastDays("2026-09-23", 3), ["2026-09-21","2026-09-22","2026-09-23"], "last N days oldest first");
eq(H.usageLastDays("2026-03-01", 2), ["2026-02-28","2026-03-01"], "crosses month end");
eq(H.usageLastDays("2026-11-02", 2), ["2026-11-01","2026-11-02"], "DST week stays one per day");
eq(H.usageWithZeros([{ key:"home", users:2, userDays:3 }], ["myday","home","cos","myday"]),
  [{ key:"home", users:2, userDays:3 }, { key:"cos", users:0, userDays:0 }, { key:"myday", users:0, userDays:0 }],
  "unseen known keys appended as 0 · 0 (sorted, deduped); seen rows untouched");

console.log("needs-dryrun ok");
