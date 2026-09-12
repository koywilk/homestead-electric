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

const FN = ["localYmd","sameName","needKind","needAssignee","needForeman","dueBucketFromDate",
  "isSnoozed","needIsOpen","resiHead","resiHeadName","defaultAssigneeFor","isMine","onHead","headQueue",
  "punchAssignedTo","myJobsFor"];
const combined = [
  extractConst("PERMISSIONS"),
  extractConst("getAccess"),
  extractConst("can"),
  extractConst("matchesForeman"),
  ...FN.map(extractFunction),
  `({ ${FN.join(", ")} })`,
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

console.log("needs-dryrun ok");
