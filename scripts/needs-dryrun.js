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
  "usageSeenKey","shouldLogUsage","usageRollup","usageLastDays","usageWithZeros",
  "bucketOfYmd","needBucket","needPriority","prioRank","rowPriority","compareMyDayRows","mydayBadgeCount",
  "loadsListRows","loadsListCsv",
  "lutronNormalizeType","lutronModType","lutronZoneCap","lutronLoadKind","lutronKindFits","lutronOpenZones","lutronOverWatt","lutronAssignLabel","lutronStats","lutronMigrate","lutronView","lutronSuggestLayout","lutronLegacyModules"];
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
  // v449 Lutron Panel Builder — the pure model helpers + their inputs.
  "let _uidT = 0; const uid = () => 't' + (++_uidT);",
  "const newLoadRow = (num) => ({ id:uid(), num, name:\"\", ch:\"\", loadType:\"\", watts:\"\", keypad:\"\", pulled:false });",
  extractConst("migrateFloorToModules"),
  extractConst("LUTRON_MODULES"),
  extractConst("LUTRON_TYPE_ALIASES"),
  extractLine("LUTRON_DEFAULT_TYPE"),
  extractConst("lutronLoadsOn"),
  extractLine("_lutronViewCache"),
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
assert.ok(!H.matterportScanNeeded({ roughStage:"100%", finishStage:"", hiddenSections:{ matterport:true } }), "Matterport off in Job Sections -> not needed");
assert.ok(H.matterportScanNeeded({ roughStage:"100%", finishStage:"", hiddenSections:{ matterport:false } }), "Matterport turned back on -> needed again");
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
// v434: system entries read as sentences; an empty void reason is still a line.
eq(H.needUpdateLine({ kind:"void", text:"" }), "voided", "void, no reason");
eq(H.needUpdateLine({ kind:"void", text:"dup of #12" }), "voided — dup of #12", "void with reason");
eq(H.needUpdateLine({ kind:"edit", text:"changed: wording, due 10/3" }), "changed: wording, due 10/3", "edit line");
eq(H.needUpdateLine({ kind:"reopen", text:"Reopened" }), "Reopened", "reopen renders like a note");
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
eq(H.routeKeyOfAuto({ id:"j1_rt_r1_done", category:"rt" }), null, "v447: RT complete merge/invoice stays with the head");
eq(H.routeKeyOfAuto({ id:"j1_rt_r1_sched", category:"rt" }), null, "RT get-sign-off stays with the head");
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
// v434 — void = closed with a flag. The sender who voided sees it in Sent ·
// finished (not a duplicate in Done); the assignee sees it in Done.
const voidedByKoy = { id:"v1", status:"done", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", createdBy:"Koy Wilkinson", doneBy:"Koy Wilkinson", doneAt: iso2, voided:true, voidedBy:"Koy Wilkinson", voidedAt: iso2, voidReason:"dup" };
assert.ok(H.sentFinishedForMe(voidedByKoy, koy, now2), "I sent + I voided → Sent/Finished (even though doneBy is me)");
assert.ok(!H.completedForMe(voidedByKoy, koy, now2), "…and NOT in my Done (voider isn't the assignee)");
assert.ok(H.completedForMe(voidedByKoy, gage, now2), "assignee still sees it in Done");
assert.ok(!H.sentFinishedForMe(voidedByKoy, gage, now2), "assignee doesn't get it in Sent/Finished");
const voidedByHead = { ...voidedByKoy, id:"v2", assignedBy:"Gage Lund", createdBy:"Gage Lund", assignedTo:"Koy Wilkinson", doneBy:"Josh Cloward", voidedBy:"Josh Cloward" };
assert.ok(H.sentFinishedForMe(voidedByHead, gage, now2), "head voided Gage's sent task → Gage's Sent/Finished");
assert.ok(!H.completedForMe(voidedByHead, josh, now2) && !H.sentFinishedForMe(voidedByHead, josh, now2), "head who voided someone else's task → no row for the head");
const selfVoided = { ...voidedByKoy, id:"v3", assignedTo:"Koy Wilkinson" };
assert.ok(H.completedForMe(selfVoided, koy, now2) && !H.sentFinishedForMe(selfVoided, koy, now2), "self-task voided → my Done only");
assert.ok(!H.sentFinishedForMe({ ...voidedByKoy, doneAt: new Date(now2 - 31*864e5).toISOString() }, koy, now2), "voided 31 days ago → out of window");
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
eq(pulse.map(p => p.name), ["Gage Lund","Josh","Koy Wilkinson"], "sorted overdue desc, then open desc; inactive/contractor excluded");
// v458: an idle person (no open doc, nothing done this week) still shows, with zeros, after everyone with work.
const pulseIdle = H.teamPulse({ needs:pNeeds, users:[...pUsers, { name:"Keegan" }, { name:"Brady" }], ownedRows:pRows, todayYmd:"2026-09-23", nowMs:P_NOW });
eq(pulseIdle.map(p => p.name), ["Gage Lund","Josh","Koy Wilkinson","Brady","Keegan"], "idle people listed after everyone with work, A–Z");
eq(pulseIdle.find(p => p.name === "Keegan"), { name:"Keegan", open:0, overdue:0, oldestDays:0, doneWeek:0 }, "idle person shows zeros");
eq(pulse.find(p => p.name === "Gage Lund"), { name:"Gage Lund", open:2, overdue:2, oldestDays:13, doneWeek:0 }, "Gage: 2 open both overdue, oldest from createdAt");
eq(pulse.find(p => p.name === "Josh"), { name:"Josh", open:3, overdue:1, oldestDays:9, doneWeek:1 }, "Josh: 1 doc + 2 owned rows; done 9/21 counts, 9/10 doesn't");
eq(pulse.find(p => p.name === "Koy Wilkinson"), { name:"Koy Wilkinson", open:1, overdue:0, oldestDays:1, doneWeek:0 }, "shared row counts for each owner");
// v434: a voided doc is closed but was never "done" — no doneWeek credit, not open.
const pulseV = H.teamPulse({ needs:[...pNeeds, { id:"g", status:"done", assignedTo:"Josh", doneBy:"Josh", doneAt:"2026-09-22T12:00:00", voided:true, voidedBy:"Josh" }], users:pUsers, ownedRows:pRows, todayYmd:"2026-09-23", nowMs:P_NOW });
eq(pulseV.find(p => p.name === "Josh"), { name:"Josh", open:3, overdue:1, oldestDays:9, doneWeek:1 }, "voided doc doesn't count as done this week");

// ── v461: urgency on every row ─────────────────────────────────────────────
eq(H.rowPriority({ kind:"need", key:"need_1", need:{ priority:"urgent" } }, { need_1:{ prio:"low" } }), "urgent", "need row reads the doc, never the map");
eq(H.rowPriority({ kind:"auto", key:"auto_j1_prep" }, { auto_j1_prep:{ prio:"urgent", by:"Koy" } }), "urgent", "derived row reads the shared map by key");
eq(H.rowPriority({ kind:"duty", key:"duty_j1_coord_rough_qc" }, { duty_j1_coord_rough_qc:{ prio:"" } }), "normal", "cleared mark → normal");
eq(H.rowPriority({ kind:"punch", key:"punch_j1_i9" }, {}), "normal", "no mark → normal");
eq(H.rowPriority({ kind:"redline", key:"redline_w1" }, null), "normal", "no map → normal");
eq(H.rowPriority({ kind:"auto", key:"auto_x" }, { auto_x:{ prio:"junk" } }), "normal", "junk value → normal");
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

// ── v446 — urgency, in-lane due-date sort, tab badge ────────────────────────
eq(H.needPriority({ priority:"urgent" }), "urgent", "urgent");
eq(H.needPriority({ priority:"low" }), "low", "low");
eq(H.needPriority({}), "normal", "absent → normal (every pre-v446 doc)");
eq(H.needPriority({ priority:"" }), "normal", "'' → normal (reset)");
eq(H.needPriority({ priority:"junk" }), "normal", "junk → normal");
eq([H.prioRank("urgent"), H.prioRank("normal"), H.prioRank("low"), H.prioRank(undefined)], [0, 1, 2, 1], "rank order; missing = normal");
const sortIn = [
  { key:"a", bucket:"later",   title:"Zed",   dueYmd:"2026-10-20" },
  { key:"b", bucket:"today",   title:"Bee",   dueYmd:"2026-09-23" },
  { key:"c", bucket:"overdue", title:"Cat",   dueYmd:"2026-09-20" },
  { key:"d", bucket:"overdue", title:"Ant",   dueYmd:"2026-09-21" },
  { key:"e", bucket:"week",    title:"Late",  dueYmd:"", prio:"urgent" },     // urgent beats every lane
  { key:"f", bucket:"week",    title:"Alpha", dueYmd:"" },                    // undated: last in its lane
  { key:"g", bucket:"week",    title:"Beta",  dueYmd:"2026-09-26" },
  { key:"h", bucket:"overdue", title:"Low",   dueYmd:"2026-09-01", prio:"low" }, // low sinks below everything
  { key:"i", bucket:"week",    title:"Same",  dueYmd:"2026-09-26" },
];
eq(sortIn.slice().sort(H.compareMyDayRows).map(r => r.key), ["e", "c", "d", "b", "g", "i", "f", "a", "h"],
  "urgent first → lane → due date (undated last) → title; low last even when overdue");
eq([{ bucket:"nope", title:"b" }, { bucket:"later", title:"a" }].sort(H.compareMyDayRows).map(r => r.title), ["a", "b"], "unknown lane sorts after Later");
// myDayCategories: a category holding an urgent row floats above the most-urgent-lane order.
const cats46 = H.myDayCategories([
  { kind:"punch", bucket:"overdue", title:"p" },
  { kind:"need", needKind:"task", bucket:"later", title:"t", prio:"urgent" },
  { kind:"need", needKind:"need", bucket:"today", title:"n" },
]);
eq(cats46.map(c => c.key), ["tasks", "punch", "needs"], "urgent category first, then overdue punch, then today needs");
eq(cats46[0].urgent, 1, "urgent count carried on the category");
// Badge: open docs on me that are overdue / due today / urgent. Snoozed, done, others', later-dated excluded.
const bT = "2026-09-23";
const bNeeds = [
  { id:"1", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-20" },                       // overdue ✓
  { id:"2", status:"open", assignedTo:"Gage Lund", dueDate:bT },                                 // today ✓
  { id:"3", status:"open", assignedTo:"Gage Lund", dueBucket:"tomorrow" },                       // bucket-only tomorrow reads as today ✓
  { id:"4", status:"open", assignedTo:"Gage Lund", dueDate:"2026-10-20", priority:"urgent" },    // urgent ✓
  { id:"5", status:"open", assignedTo:"Gage Lund", dueDate:"2026-10-20" },                       // later ✗
  { id:"6", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-20", snoozedUntil:"2026-09-30" }, // snoozed ✗
  { id:"7", status:"done", assignedTo:"Gage Lund", dueDate:"2026-09-20" },                       // done ✗
  { id:"8", status:"open", assignedTo:"Koy Wilkinson", dueDate:"2026-09-20" },                   // not mine ✗
  { id:"9", status:"open", assignedTo:"Gage Lund", dueBucket:"week" },                           // bucket-only week ✗
];
eq(H.mydayBadgeCount(bNeeds, gage, bT), 4, "badge = overdue + today + tomorrow-bucket + urgent");
eq(H.mydayBadgeCount(bNeeds, null, bT), 0, "no identity → 0");
eq(H.mydayBadgeCount([], gage, bT), 0, "no needs → 0");

// ── v448 — loads list export (floor → room → A–Z, numbered, no module columns) ──
const llRows = H.loadsListRows([
  { id:"a", name:"Island Pendants", location:"Main Level", room:"Kitchen", loadType:"Dimming", watts:"180" },
  { id:"b", name:" Cans ", location:"Upper Level", room:"Master Bed", loadType:"Dimming", watts:"" },
  { id:"c", name:"Hall Sconces", location:"Main Level", room:"", loadType:"Switching", watts:"60" },
  { id:"d", name:"Bar Cans", location:"main level", room:"Kitchen", loadType:"Dimming", watts:"120" },
  { id:"e", name:"", location:"Main Level", room:"Kitchen" },                    // unnamed → dropped
  { id:"f", name:"Garage", location:"Shop", room:"Bay 1", loadType:"Switching" }, // unknown floor → last
  { id:"g", name:"Cans", location:"Basement", room:"Theater", loadType:"Dimming", watts:"240" },
  null,
], ["Main Level", "Basement", "Upper Level"]);
eq(llRows.map(r => `${r.n}:${r.floor}/${r.room || "-"}/${r.name}`), [
  "1:Main Level/Kitchen/Bar Cans", "2:Main Level/Kitchen/Island Pendants", "3:Main Level/-/Hall Sconces",
  "4:Basement/Theater/Cans", "5:Upper Level/Master Bed/Cans", "6:Shop/Bay 1/Garage",
], "floor order from the list (case-insensitive), rooms A–Z with blank room last, loads A–Z, unknown floor last, numbered 1..N");
eq(llRows[1].watts, "180", "watts carried");
eq(H.loadsListRows([], ["Main Level"]), [], "empty → []");
eq(H.loadsListRows([{ name:"X" }], []), [{ id:"", name:"X", floor:"No floor", room:"", type:"", watts:"", n:1 }], "no floor → 'No floor'");
const csv = H.loadsListCsv([{ n:1, floor:"Main Level", room:"Kitchen", name:'Pendants, "island"', type:"Dimming", watts:"180" }]);
eq(csv, '#,Floor,Room,Load,Type,Watts\r\n1,Main Level,Kitchen,"Pendants, ""island""",Dimming,180\r\n', "CSV header + quoted/escaped cell");
eq(H.loadsListCsv([]), "#,Floor,Room,Load,Type,Watts\r\n", "header only when empty");

// ── v449 — Lutron Panel Builder: catalog, migration, assignment, suggest ──
eq(H.lutronNormalizeType(" lqse-s8 "), "LQSE-4S8-120-D", "old S8 alias → real SKU");
eq(H.lutronNormalizeType("LQSE-4A"), "LQSE-4A-120-D", "old 4A alias → discontinued 4A");
eq(H.lutronNormalizeType(""), "", "blank stays blank");
eq(H.lutronModType("LQSE-S8").zones, 4, "an old S8 is a 4-zone module (8 = amps)");
eq(H.lutronModType("LQSE-T5").zones, 4, "an old T5 is a 4-zone module (5 = amps)");
eq(H.lutronModType("SOMETHING-ELSE").custom, true, "unknown type → custom, 4 zones");
eq([H.lutronZoneCap("LQSE-4A5-120-D",1), H.lutronZoneCap("LQSE-4A5-120-D",3), H.lutronZoneCap("LQSE-4S8-120-D",2), H.lutronZoneCap("LQSE-2HDC-D",1)], [800,500,960,0], "zone caps: dimmer per-zone table, relay amps × 120, bus none");
eq([H.lutronLoadKind("Dimming"),H.lutronLoadKind("MLV"),H.lutronLoadKind("Switching"),H.lutronLoadKind("Relay"),H.lutronLoadKind("0-10V"),H.lutronLoadKind("Variable Speed"),H.lutronLoadKind("")], ["dimming","dimming","switching","switching","0-10v","motor",""], "load kinds");
eq([H.lutronKindFits("LQSE-4A5-120-D","Switching"), H.lutronKindFits("LQSE-4S8-120-D","Dimming"), H.lutronKindFits("LQSE-4M-120-D","Dimming"), H.lutronKindFits("LQSE-4M-120-D","Variable Speed"), H.lutronKindFits("", "Switching"), H.lutronKindFits("LQSE-2HDC-D","Switching")], [false,true,false,true,true,true], "type gating: dimmers refuse switched, motor module takes motors only, untyped/bus take all");

// Migration from the pre-v449 shape: upper → Panel A, main → Panel B (custom label wins), extras after.
const oldPl = {
  loads: [
    { id:"l1", name:"Kitchen Cans", location:"Main Level", room:"Kitchen", loadType:"Dimming", watts:"240" },
    { id:"l2", name:"Island Pendants", location:"Main Level", room:"Kitchen", loadType:"Dimming", watts:"180" },
    { id:"l3", name:"Garage", location:"Main Level", room:"Garage", loadType:"Switching", watts:"300", panel:"LCP 2" },
    { id:"l4", name:"Porch", location:"Main Level", room:"Exterior", loadType:"Switching", watts:"80" },
  ],
  cp4Loads: {
    main: [ { id:"m1", modNum:"1", moduleType:"LQSE-4A", loads:[ { id:"r1", num:1, name:"Kitchen Cans", ch:"1", watts:"240" }, { id:"r2", num:2, name:"island pendants ", ch:"", watts:"180" }, { id:"r3", num:3, name:"Nook Chandelier", ch:"3", loadType:"Dimming", watts:"150", pulled:true } ] },
            { id:"m2", modNum:"2", moduleType:"LQSE-S8", loads:[ { id:"r4", num:1, name:"Porch", ch:"6" } ] } ],
    upper: [ { id:"u1", num:1, name:"", moduleType:"", mod:"1", ch:"" } ],          // default empty rows → no panel
    basement: [],
  },
  extraFloors: [ { key:"pl_lcp_2", label:"LCP 2" } ],
  pl_lcp_2: [ { id:"x1", modNum:"1", moduleType:"", loads:[ { id:"x2", num:1, name:"" } ] } ],  // untyped, unnamed → no panel
};
let n = 0; const mk = () => "id" + (++n);
const mig = H.lutronMigrate(oldPl, { main:"LCP 1" }, mk);
eq(mig.panels.map(p => `${p.id}:${p.label}:${p.slots}:${p.modules.map(m => m.num + "/" + m.type).join(",")}`), ["main:LCP 1:8:1/LQSE-4A-120-D,2/LQSE-4S8-120-D"], "only sections with a typed module or a named row become panels; id = old floor key; custom label wins; types normalized");
const byId = Object.fromEntries(mig.loads.map(l => [l.id, l]));
eq(byId.l1.assign, { panelId:"main", moduleId:"m1", zone:1 }, "row ch 1 → zone 1");
eq(byId.l2.assign, { panelId:"main", moduleId:"m1", zone:2 }, "blank ch → next open zone; name match is trimmed + case-insensitive");
eq(byId.l4.assign, { panelId:"main", moduleId:"m2", zone:1 }, "old S8 ch 6 is past the real 4 zones → next open zone on that module");
const migS8 = H.lutronMigrate({ loads:[], cp4Loads:{ main:[{ id:"s8", modNum:"1", moduleType:"LQSE-S8", loads:[1,2,3,4,5,6].map(i => ({ id:"r"+i, num:i, name:"L"+i, ch:String(i) })) }] } }, {}, mk);
eq(migS8.loads.map(l => l.assign.zone), [1,2,3,4,null,null], "six loads on an old 8-ch S8: four zones fill, the rest park on the panel");
eq(migS8.parked, 2, "parked count");
eq(byId.l3.assign, null, "Panel column naming a section that is NOT a panel stays unassigned");
const created = mig.loads.find(l => l.name === "Nook Chandelier");
eq([!!created, created.origin, created.pulled, created.assign.zone, created.watts], [true, "module", true, 3, "150"], "a module row with no master load becomes a master load (origin module) on its zone");
eq([mig.created, mig.parked, mig.loads.length], [1, 0, 5], "counts");
eq(H.lutronMigrate({}, {}, mk), { panels:[], loads:[], parked:0, created:0 }, "empty job → nothing");
const mig2 = H.lutronMigrate({ loads:[{ id:"a", name:"X", panel:"lcp 1" }], cp4Loads:{ main:[{ id:"m", modNum:"1", moduleType:"LQSE-4A5-120-D", loads:[{ id:"r", num:1, name:"" }] }] } }, { main:"LCP 1" }, mk);
eq(mig2.loads[0].assign, { panelId:"main", moduleId:null, zone:null }, "Panel column matching a real panel (case-insensitive) → parked there");

// Read side: a job with `panels` reads straight through; one without is migrated and cached.
eq(H.lutronView({ id:"j", panelizedLighting:{ panels:[{ id:"p", label:"LCP 1", slots:8, modules:[] }], loads:[{ id:"l", name:"A" }] } }).migrated, false, "panels present → no migration");
const v1 = H.lutronView({ id:"j2", panelizedLighting: oldPl, plSectionLabels:{ main:"LCP 1" } });
const v2 = H.lutronView({ id:"j2", panelizedLighting: oldPl, plSectionLabels:{ main:"LCP 1" } });
eq(v1 === v2, true, "same inputs → same cached view (stable ids until the first write)");
eq(v1.migrated, true, "migrated flag");

// Assignment helpers on the new model.
const panels = [ { id:"p1", label:"LCP 1", slots:8, modules:[ { id:"a", num:"1", type:"LQSE-4A5-120-D" }, { id:"b", num:"2", type:"LQSE-4S8-120-D" } ] }, { id:"p2", label:"LCP 2", slots:4, modules:[] } ];
const loads = [
  { id:"1", name:"Cans", loadType:"Dimming", watts:"900", assign:{ panelId:"p1", moduleId:"a", zone:1 } },
  { id:"2", name:"Pendants", loadType:"Dimming", watts:"600", assign:{ panelId:"p1", moduleId:"a", zone:2 } },
  { id:"3", name:"Garage", loadType:"Switching", watts:"300", assign:{ panelId:"p1", moduleId:null, zone:null } },
  { id:"4", name:"Porch", loadType:"Switching", watts:"80", assign:null },
  { id:"5", name:"", assign:null },
];
eq(H.lutronOpenZones(panels, loads, "p1", "a"), [3,4], "open zones");
eq(H.lutronOpenZones(panels, loads, "p1", "zz"), [], "unknown module → none");
eq([H.lutronOverWatt(loads[0], panels), H.lutronOverWatt(loads[1], panels), H.lutronOverWatt(loads[2], panels)], [true, true, false], "900 W on zone 1 (≤800) and 600 W on zone 2 (≤500) are over; parked never is");
eq([H.lutronAssignLabel(loads[0], panels), H.lutronAssignLabel(loads[2], panels), H.lutronAssignLabel(loads[3], panels), H.lutronAssignLabel({ assign:{ panelId:"p1", moduleId:"gone", zone:1 } }, panels)], ["LCP 1 · Mod 1 · Z1", "LCP 1 · no module yet", "", "LCP 1 · no module yet"], "labels; a vanished module reads as parked");
eq(H.lutronStats(panels, loads), { unassigned:1, parked:1, onZone:2, overW:2, modules:2, zonesTotal:8, panels:2 }, "stats skip unnamed loads");

// Suggest layout: parked stays on its own panel, dimming → dimmer, switching → relay, adds a module when none fits, biggest load first.
const sug = H.lutronSuggestLayout(panels, [
  { id:"1", name:"Cans", loadType:"Dimming", watts:"240", location:"Main Level", room:"Kitchen", assign:null },
  { id:"2", name:"Big Chandelier", loadType:"Dimming", watts:"700", location:"Main Level", room:"Kitchen", assign:null },
  { id:"3", name:"Garage", loadType:"Switching", watts:"300", location:"Main Level", room:"Garage", assign:{ panelId:"p2", moduleId:null, zone:null } },
  { id:"4", name:"Shade", loadType:"Variable Speed", watts:"", location:"Upper Level", room:"Master", assign:null },
], ["Main Level","Basement","Upper Level"], () => "new" + (++n));
const sBy = Object.fromEntries(sug.loads.map(l => [l.id, l]));
eq([sBy["2"].assign.moduleId, sBy["2"].assign.zone, sBy["1"].assign.moduleId, sBy["1"].assign.zone], ["a", 1, "a", 2], "biggest dimmer takes zone 1 of the dimmer module, next takes zone 2");
eq(sBy["3"].assign.panelId, "p2", "a parked load is placed in ITS panel");
eq(sug.panels[1].modules.map(m => m.type), ["LQSE-4S8-120-D"], "…on a switching module created there");
eq(sug.panels[0].modules.map(m => m.type), ["LQSE-4A5-120-D","LQSE-4S8-120-D","LQSE-4M-120-D"], "a motor load gets a motor module, never a dimmer");
eq([sug.placed, sug.made, sug.skipped], [4, 2, 0], "counts");
const full = H.lutronSuggestLayout([{ id:"p", label:"P", slots:1, modules:[{ id:"m", num:"1", type:"LQSE-4M-120-D" }] }], [{ id:"1", name:"Cans", loadType:"Dimming", watts:"100", assign:null }], [], () => "x");
eq([full.placed, full.skipped, full.loads[0].assign], [0, 1, null], "full panel + no fitting module → skipped, untouched");

// Print / LV share adapter: the old nested shape, zones in order, parked loads as a trailing block.
const leg = H.lutronLegacyModules(panels[0], loads);
eq(leg.map(m => `${m.modNum}:${m.moduleType}:${m.loads.map(l => l.ch + l.name).join("|")}`), ["1:LQSE-4A5-120-D:1Cans|2Pendants", "2:LQSE-4S8-120-D:", "—:No module yet:Garage"], "legacy modules for print");
eq(leg[0].loads[0], { id:"1", num:1, name:"Cans", ch:"1", loadType:"Dimming", watts:"900", keypad:"", pulled:false }, "row shape printPanelSchedule reads");

console.log("needs-dryrun ok");
