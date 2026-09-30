// Generator Load Selection — regression tests for the "keeps unselecting what I
// select" report (Keegan, Miller, 2026-09-30), plus the v474 stale-copy audit
// (homeowner submit, redline walks, crew roster, crewPTO delete, settings/main).
// Run: node scripts/gen-selection-test.js
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
//
// Same shape as scripts/gen-sync-dryrun.js: the helpers are extracted LIVE from
// src/App.js (brace-balanced slice, no hand copy), so the test can't drift.
//
// Three mechanisms, each pinned here:
//  1. A tab holding a STALE genLoads copy re-syncs from Home Runs and must not
//     roll back a check another device saved — the auto-sync reconciles against
//     the SERVER copy (the funnel's locked prev), never the tab's copy.
//  2. A submitted homeowner response is overlaid onto the office list only while
//     the submission is NEWER than the office's last save (`genLoadsAt`); once
//     the office edits after it, the office list stands.
//  3. The funnel skips the write (and the version snapshot) when a mutator
//     returns null — so a no-change re-sync is not a write.
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
// Balanced slice: from `const <name> = ` to the first `;` at bracket depth 0
// (counts (), [] and {} together), so a brace-less arrow (genLoadsSig, the
// overlay gate) and a block-bodied one (reconcileGenLoads) both extract cleanly.
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
const extractExpr = extract;
const tmp = path.join(__dirname, ".gen-selection-fns.tmp.js");
fs.writeFileSync(tmp,
  `let _n = 0;\nfunction uid() { return "NEW#" + (++_n); }\n` +
  `${extract("flattenHomeRuns")}\n${extract("genLoadsSig")}\n${extract("reconcileGenLoads")}\n` +
  `${extract("applyHomeownerChoices")}\n${extractExpr("homeownerOverlayApplies")}\n${extract("applyHomeownerSubmitToGenLoads")}\n` +
  `module.exports = { flattenHomeRuns, genLoadsSig, reconcileGenLoads, applyHomeownerChoices, homeownerOverlayApplies, applyHomeownerSubmitToGenLoads };\n`);
let F;
try { F = require(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
const { reconcileGenLoads, genLoadsSig, applyHomeownerChoices, homeownerOverlayApplies, applyHomeownerSubmitToGenLoads } = F;

let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// ── fixtures: a Miller-shaped slice ──────────────────────────────────────────
const row = (id, name, wire, status) => ({ id, name, wire, status: status || "Pulled", panel: "" });
const homeRuns = {
  main: [row("hr1", "Office + hallway", "12/2"), row("hr2", "Pantry fridge/ freezer", "12/2"), row("hr3", "Laundry counter outlets", "12/2")],
  upper: [], basement: [], extraFloors: [],
};
const load = (id, hrId, name, included) => ({ id, hrId, name, wire: "12/2", v240: false, needsSpecs: false, origin: "homerun",
  recommended: false, included: !!included, confirmed: false, priority: 0, status: included ? "chosen" : "off", notes: "" });

console.log("\n── 1. stale-tab re-sync must not roll back another device's checks ──");
{
  // Server: Keegan checked all three on his phone.
  const server = [load("g1", "hr1", "Office + hallway", true), load("g2", "hr2", "Pantry fridge/ freezer", true), load("g3", "hr3", "Laundry counter outlets", true)];
  // Koy's tab loaded the doc this morning, before Keegan's checks.
  const staleTab = [load("g1", "hr1", "Office + hallway", false), load("g2", "hr2", "Pantry fridge/ freezer", false), load("g3", "hr3", "Laundry counter outlets", false)];
  // A home-run row changes (crew marks a pull) → the stale tab's sync effect fires.
  const hrAfterPull = { ...homeRuns, main: homeRuns.main.map(r => r.id === "hr3" ? { ...r, status: "Pulled" } : { ...r, status: "Not Pulled" }) };
  const fromTab = reconcileGenLoads(hrAfterPull, staleTab);
  t("the OLD path (reconcile against the tab's copy) really does produce an all-off list — the bug",
    fromTab.every(l => !l.included));
  // The shipped path: the mutator reconciles against the funnel's locked server prev.
  const fromServer = reconcileGenLoads(hrAfterPull, server);
  t("reconciling against the server copy keeps every check", fromServer.every(l => l.included));
  t("…and keeps the server's ids (no re-keyed loads for the homeowner link)", fromServer.map(l => l.id).join() === "g1,g2,g3");
  t("re-sync is a no-op when nothing changed (same sig → no write)", genLoadsSig(reconcileGenLoads(homeRuns, server)) === genLoadsSig(server));
  t("reconcile is idempotent", genLoadsSig(reconcileGenLoads(homeRuns, fromServer)) === genLoadsSig(fromServer));
}

console.log("\n── 2. homeowner overlay applies only while the submission is newer than the office's last save ──");
{
  const items = [{ id: "g1", included: false, status: "off" }, { id: "g2", included: false, status: "off" }, { id: "g3", included: true, status: "chosen" }];
  const submitted = { submitted: true, submittedAt: "2026-09-20T10:00:00.000Z", items };
  t("legacy doc: submitted, no genLoadsAt → overlay applies (pre-write-back jobs still auto-reflect)", homeownerOverlayApplies(submitted) === true);
  t("office saved AFTER the submission → overlay does NOT apply", homeownerOverlayApplies({ ...submitted, genLoadsAt: "2026-09-30T14:00:00.000Z" }) === false);
  t("office saved BEFORE the submission → overlay applies", homeownerOverlayApplies({ ...submitted, genLoadsAt: "2026-09-19T14:00:00.000Z" }) === true);
  t("not submitted → never applies", homeownerOverlayApplies({ submitted: false, items, genLoadsAt: "2026-09-19T14:00:00.000Z" }) === false);
  t("submitted but no items → never applies", homeownerOverlayApplies({ submitted: true, submittedAt: "2026-09-20T10:00:00.000Z", items: [] }) === false);
  t("submitted with no submittedAt (very old doc), office has saved since → does not apply", homeownerOverlayApplies({ submitted: true, items, genLoadsAt: "2026-09-30T14:00:00.000Z" }) === false);
  t("submitted with no submittedAt, office never saved → applies", homeownerOverlayApplies({ submitted: true, items }) === true);
  t("null / missing doc → false", homeownerOverlayApplies(null) === false && homeownerOverlayApplies(undefined) === false);
  // And the overlay itself is what it was: it is the re-application that had to be gated, not the mapping.
  const office = [load("g1", "hr1", "Office + hallway", true), load("g2", "hr2", "Pantry fridge/ freezer", true), load("g3", "hr3", "Laundry counter outlets", true)];
  const overlaid = applyHomeownerChoices(office, items);
  t("the overlay really does uncheck what the homeowner did not pick (why re-applying it after an office edit was the bug)",
    overlaid.filter(l => l.included).map(l => l.id).join() === "g3");
}

console.log("\n── 3. funnel: a null mutator result skips the write ──");
{
  const fn = src.slice(src.indexOf("async function saveHomeownerRequest("), src.indexOf("\n}\n", src.indexOf("async function saveHomeownerRequest(")) + 3);
  t("saveHomeownerRequest treats a null patch as 'nothing to write'", /patch\s*==\s*null/.test(fn) || /patch\s*===\s*null/.test(fn));
  t("…and does not stash a version snapshot for a skipped write", /if\s*\(\s*!?skipped/.test(fn) || /skipped\s*\)\s*return/.test(fn));
}

console.log("\n── 4. wiring in HomeRunsTab / GeneratorLoadSection ──");
{
  const hrt = src.slice(src.indexOf("function HomeRunsTab("), src.indexOf("function HomeRunsTab(") + 12000);
  t("HomeRunsTab subscribes to homeowner_requests live (onSnapshot), not a one-shot getDoc", /onSnapshot\(doc\(db,'homeowner_requests',jobId\)/.test(hrt));
  t("HomeRunsTab stamps genLoadsAt on every office save", /genLoadsAt/.test(hrt));
  t("HomeRunsTab gates the overlay with homeownerOverlayApplies", /homeownerOverlayApplies\(/.test(hrt));
  t("the auto-sync reconciles inside the funnel mutator (against prev.genLoads)", /saveHomeownerRequest\(jobId,\s*\(prev\)\s*=>\s*\{[\s\S]{0,400}?reconcileGenLoads\(/.test(hrt));
  const gls = src.slice(src.indexOf("function GeneratorLoadSection("), src.indexOf("function GeneratorLoadSection(") + 3000);
  t("GeneratorLoadSection waits for the saved list before its first auto-sync (ready gate)", /if\s*\(\s*!ready\s*\)\s*return/.test(gls));
}

console.log("\n── 5. v474: homeowner SUBMIT maps choices onto the SERVER list, not the page's copy ──");
{
  // Page opened Monday with three loads; office since renamed one, added one, removed one, and Keegan checked one.
  const pageCopy = [load("g1", "hr1", "Office + hallway", false), load("g2", "hr2", "Pantry fridge", false), load("g3", "hr3", "Laundry counter outlets", false)];
  const server   = [load("g1", "hr1", "Office + hallway", true), load("g2", "hr2", "Pantry fridge/ freezer", false), load("g4", "hr4", "Well pump", true)];
  const outItems = [{ id: "g1", included: false, confirmed: false, status: "off", priority: 0, notes: "" },
                    { id: "g2", included: true,  confirmed: true,  status: "chosen", priority: 1, notes: "keep the freezer" },
                    { id: "g3", included: true,  confirmed: true,  status: "chosen", priority: 2, notes: "" }];
  const oldPath = pageCopy.map(l => { const c = outItems.find(i => i.id === l.id); return c ? { ...l, included: c.included } : l; });
  t("the OLD path really did drop the office's added load and resurrect the removed one — the bug",
    !oldPath.some(l => l.id === "g4") && oldPath.some(l => l.id === "g3"));
  const out = applyHomeownerSubmitToGenLoads(server, outItems);
  t("homeowner's choice applied by id (g2 chosen, with their note)", out.find(l => l.id === "g2").included === true && out.find(l => l.id === "g2").notes === "keep the freezer");
  t("homeowner's un-pick applied (g1 off) — their signed answer wins on loads they saw", out.find(l => l.id === "g1").included === false);
  t("office's rename since the open is kept", out.find(l => l.id === "g2").name === "Pantry fridge/ freezer");
  t("office's added load (no item) is kept exactly as the office set it", !!out.find(l => l.id === "g4") && out.find(l => l.id === "g4").included === true);
  t("office's removed load is not brought back", !out.some(l => l.id === "g3"));
  t("server order and ids preserved", out.map(l => l.id).join() === "g1,g2,g4");
  t("empty inputs are safe", applyHomeownerSubmitToGenLoads([], outItems).length === 0 && applyHomeownerSubmitToGenLoads(server, null).length === 3);
}

console.log("\n── 6. v474 wiring: the other four stale-copy writers ──");
{
  const hp = src.slice(src.indexOf("function HomeownerPage("), src.indexOf("function HomeownerPage(") + 20000);
  t("HomeownerPage submit mutator reads prev and maps onto the server list", /saveHomeownerRequest\(jobId,\s*\(prev\)\s*=>\s*\{[\s\S]{0,600}?applyHomeownerSubmitToGenLoads\(/.test(hp));
  const rw = src.slice(src.indexOf("const saveRedlineWalk = async"), src.indexOf("const saveRedlineWalk = async") + 2500);
  t("saveRedlineWalk writes dotted data.<k> paths for changed keys only", /upd\["data\." \+ k\]/.test(rw) && /_jeq\(next\[k\], before\[k\]\)/.test(rw));
  t("saveRedlineWalk removes a dropped key with deleteField, never writes undefined", /deleteField\(\)/.test(rw));
  const urw = src.slice(src.indexOf("const updateRedlineWalk ="), src.indexOf("const updateRedlineWalk =") + 600);
  t("updateRedlineWalk diffs against the live baseline ref", /redlineWalksRef\.current/.test(urw));
  t("redlineWalks listener feeds the baseline ref", /redlineWalksRef\.current = loaded/.test(src));
  t("crew roster saves through mergeSaveSettingsFields", /mergeSaveSettingsFields\("crewRoster",\{names:n\}\)/.test(src));
  t("crew roster listener sets its merge baseline", /_settingsBaselines\["crewRoster"\]/.test(src));
  t("no raw setDoc left on settings/crewRoster", !/setDoc\(doc\(db,"settings","crewRoster"\)/.test(src));
  t("no raw setDoc left on settings/crewPTO", !/setDoc\(doc\(db,"settings","crewPTO"\)/.test(src));
  t("settings/main color save is a merge, not a doc replace", /setDoc\(doc\(db,"settings","main"\),\{colorOverrides\},\{merge:true\}\)/.test(src));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
