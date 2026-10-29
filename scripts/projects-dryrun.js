#!/usr/bin/env node
/* projects-dryrun.js — harness for the Projects + Field Milestones pure helpers.
 * Extracts the shipped helpers VERBATIM from src/App.js and evals them in a vm
 * sandbox (house pattern: scripts/commercial-dryrun.js), so what's under test is
 * exactly what ships.
 *
 * Spec: docs/superpowers/specs/2026-10-15-projects-field-milestones-design.md
 * Plan: docs/superpowers/plans/2026-10-15-projects-field-milestones-phase1.md
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "App.js"), "utf8");

const extractLine = (name) => { const m = new RegExp(`^const ${name}\\s*=`, "m").exec(src); if (!m) throw new Error(`extract: const ${name} not found`); const i = m.index; return src.slice(i, src.indexOf("\n", i)); };
function extractFrom(marker, label) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  let i = src.indexOf("{", start);
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
  return src.slice(start, i) + ";";
}

const NAMES = ["isSimproJoinable", "projectBuildings", "projectRollup", "splitProjectJobs", "buildingHops", "buildingJobName", "buildingShortName", "simproNoConflict", "liveMilestones", "milestoneAdd", "milestoneSetRemoved", "milestoneHeaderMeta"];
const combined = [
  ...NAMES.map(extractLine),
  extractFrom("const _jeq = ", "_jeq"),
  extractFrom("const _threeWayMerge = ", "_threeWayMerge"),
  `return ({ ${NAMES.join(", ")}, _threeWayMerge });`,
].join("\n");
// Evaluated in THIS realm (not vm.createContext): objects built by the helpers
// must share Object.prototype with the assertions, or deepStrictEqual fails on
// prototypes even when the values match.
const H = vm.runInThisContext(`(function () {\n${combined}\n})()`, { filename: "projects-extract.vm.js" });

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// 1. SIMPRO JOINS (spec §6.3, plan deviation 2)
eq(H.isSimproJoinable({ simproNo: "1482" }), true, "standalone job joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", projectRole: "site", simproNo: "1482" }), true, "Site / Shared (no simproFolder) joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "1482", simproFolder: "House 3" }), false, "shared non-lead building never joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "1482", simproFolder: "House 1", simproLead: true }), true, "shared lead joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "2210" }), true, "own-number building joins");
eq(H.isSimproJoinable(null), true, "null-safe");

// 2. BUILDINGS + ROLLUP + BOARD SPLIT (spec §6.2, Review Focus 3)
const jobs = [
  { id: "a", name: "Fratto Farms · House 10", projectGroupId: "p1" },
  { id: "b", name: "Fratto Farms · House 2", projectGroupId: "p1", flagged: true },
  { id: "s", name: "Fratto Farms · Site / Shared", projectGroupId: "p1", projectRole: "site", flagged: true },
  { id: "x", name: "Fratto Farms · House 9", projectGroupId: "p1", archived: true },
  { id: "o", name: "Kweller" },
  { id: "g", name: "Ghost · House 1", projectGroupId: "gone" },
  { id: "z", name: "Old · House 1", projectGroupId: "p2" },
];
eq(H.projectBuildings(jobs, "p1").map(j => j.id), ["s", "b", "a"], "Site first, then natural order (2 before 10), archived out");
eq(H.projectBuildings(jobs, ""), [], "empty pid → none");
const stage = (j) => (j.id === "a" ? "finish" : "rough");
eq(H.projectRollup(H.projectBuildings(jobs, "p1"), stage), { houses: 2, rough: 1, finish: 1, flagged: 1 }, "Site excluded from counts and flags");
const split = H.splitProjectJobs(jobs, [{ id: "p1", name: "Fratto Farms" }, { id: "p2", name: "Old", archived: true }]);
eq(Object.keys(split.byProject), ["p1"], "only live projects group");
eq(split.byProject.p1.map(j => j.id), ["a", "b", "s", "x"], "split keeps every p1 job (archive filtering is projectBuildings' job)");
eq(split.rest.map(j => j.id), ["o", "g", "z"], "unknown / archived project → building stays a normal row");
eq(H.splitProjectJobs(jobs, null).rest.length, jobs.length, "no projects loaded (rule not deployed) → nothing hidden");

// 3. HOPS + NAMES + CONFLICT (spec §6.2, deviation 5)
const bl = H.projectBuildings(jobs, "p1");
eq([H.buildingHops(bl, "s").prev, H.buildingHops(bl, "s").next.id], [null, "b"], "first has no prev");
eq([H.buildingHops(bl, "a").prev.id, H.buildingHops(bl, "a").next], ["b", null], "last has no next");
eq(H.buildingHops(bl, "nope"), { prev: null, next: null }, "unknown id");
eq(H.buildingJobName(" Fratto Farms ", " House 6 "), "Fratto Farms · House 6", "joined + trimmed");
eq(H.buildingShortName({ name: "Fratto Farms · House 6" }, { name: "Fratto Farms" }), "House 6", "short name");
eq(H.buildingShortName({ name: "Kweller" }, { name: "Fratto Farms" }), "Kweller", "no prefix → whole name");
const sj = [{ id: "f", name: "Fratto Farms", simproNo: "1482" }, { id: "q", name: "Done", simproNo: "77", archived: true }, { id: "b1", name: "ZZ · B1", simproNo: "1482", projectGroupId: "zz" }];
eq(H.simproNoConflict(sj, "#1482", "p9").id, "f", "'#1482' matches 1482 outside the project");
eq(H.simproNoConflict([sj[0]], "1482", undefined).id, "f", "no project yet → any match conflicts");
eq(H.simproNoConflict(sj.filter(j => j.id !== "f"), "1482", "zz"), null, "same-project use is fine");
eq(H.simproNoConflict(sj, "77", "p9"), null, "archived job ignored");
eq(H.simproNoConflict(sj, "  ", "p9"), null, "blank → no conflict");

// 4. MILESTONES (spec §5, Review Focus 1)
let L = [];
L = H.milestoneAdd(L, "  Blockouts in  ", "Brady", "10/9/2026", "m1");
eq(L, [{ id: "m1", text: "Blockouts in", by: "Brady", at: "10/9/2026" }], "trimmed add");
const same = H.milestoneAdd(L, "   ", "Brady", "10/9/2026", "m2");
eq(same === L, true, "blank add returns the SAME array (caller can detect no-op)");
eq(H.milestoneAdd([], "x".repeat(200), "", "", "m3")[0].text.length, 140, "140 cap");
L = H.milestoneAdd(L, "UFR in", "Abe", "10/14/2026", "m2");
eq(H.milestoneHeaderMeta(L), "2 · latest: UFR in (10/14)", "header meta");
eq(H.milestoneHeaderMeta([]), "none yet", "empty");
eq(H.milestoneHeaderMeta(undefined), "none yet", "missing field");
const R = H.milestoneSetRemoved(L, "m2", true, "Koy", "10/15/2026");
eq(H.liveMilestones(R).map(m => m.id), ["m1"], "removed hidden");
eq(R.find(m => m.id === "m2").removedBy, "Koy", "remove stamped, item kept");
const U = H.milestoneSetRemoved(R, "m2", false);
eq(H.liveMilestones(U).map(m => m.id), ["m1", "m2"], "undo restores");
eq(U.find(m => m.id === "m2").removed, false, "undo writes removed:false (merge-safe, no key deletion)");
// Two devices add at once: base [m1], phone A adds a, phone B (server) added b.
const base = [{ id: "m1", text: "Blockouts in" }];
const mine = [...base, { id: "a", text: "UFR in" }];
const server = [...base, { id: "b", text: "Temp power on" }];
eq(H._threeWayMerge(base, mine, server).map(m => m.id).sort(), ["a", "b", "m1"], "concurrent adds both survive the save merge");
// Remove on A while B adds: base [m1,m2], mine m2 removed:true, server added c.
const base2 = [{ id: "m1", text: "x" }, { id: "m2", text: "y" }];
const mine2 = [{ id: "m1", text: "x" }, { id: "m2", text: "y", removed: true }];
const server2 = [...base2, { id: "c", text: "z" }];
const out2 = H._threeWayMerge(base2, mine2, server2);
eq(out2.find(m => m.id === "m2").removed, true, "my remove applies");
eq(out2.some(m => m.id === "c"), true, "their add survives my remove");

// 5. SERVER GUARDS PRESENT (Review Focus 2) — the functions aren't pure, so
// assert the guard text is in place; the functions' own dry-runs cover behavior.
const fn = (p) => fs.readFileSync(path.join(ROOT, "functions", p), "utf8");
eq(/if \(job\.projectGroupId\) return false;/.test(fn("index.js")), true, "ensureJobDriveFolder skips project buildings");
eq(/exports\.listSimproJobFolders = /.test(fn("index.js")), true, "listSimproJobFolders exported");
eq(/simproJoinable\(j\)/.test(fn("fridayPacket.js")), true, "Friday Packet join guard");
eq(/simproJoinable\(j\)/.test(fn("foremanMeetingPrep.js")), true, "foreman prep join guard");
eq(/simproJoinable\(j\)/.test(fn("strategyPrep.js")), true, "strategy prep join guard");
eq(/Number\(j\.simproNo\) && isSimproJoinable\(j\)\)\.map\(/.test(src), true, "Scoreboard V5 appJobs credits a shared Simpro # once");
eq(/const prev = out\[sn\]; const mAll = misses/.test(src), true, "Scoreboard V5 QC adds up across buildings sharing a Simpro #");

console.log(`projects-dryrun: ${n} checks passed`);
