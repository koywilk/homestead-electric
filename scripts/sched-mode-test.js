#!/usr/bin/env node
/* sched-mode-test.js — the In Progress scheduling pill (src/schedMode.js, v627).
 * Runs in prebuild. Pure checks on the exact file that ships, plus wiring checks
 * that App.js and the server use it the way the rule says.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const M = require(path.join(root, "src", "schedMode.js"));

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) pass++; else { fail++; console.error("  FAIL: " + label); } };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ── what the pill shows ───────────────────────────────────────────────────
// Koy's screenshot: finish In Progress, saved "ongoing", then scheduled in Simpro.
eq(M.inProgressMode("ongoing", true), "scheduled", "saved Ongoing + on Simpro's schedule → On Schedule, no refresh");
eq(M.inProgressMode("scheduled", false), "ongoing", "saved On Schedule + fell off Simpro's schedule → Ongoing");
eq(M.inProgressMode("needsSched", true), "scheduled", "Needs Sched + Simpro has it → On Schedule");
eq(M.inProgressMode("needsSched", false), "needsSched", "Needs Sched stays a person's flag while Simpro doesn't have it");
eq(M.inProgressMode("", true), "scheduled", "nothing saved + on schedule");
eq(M.inProgressMode(undefined, false), "ongoing", "nothing saved + not on schedule");
eq(M.inProgressMode("ongoing", false), "ongoing", "Ongoing stays Ongoing");
eq(M.inProgressMode("scheduled", true), "scheduled", "On Schedule stays On Schedule");
// Simpro unknown (no Simpro #, or not loaded yet): exactly the old behavior.
["scheduled", "needsSched", "ongoing"].forEach(m => eq(M.inProgressMode(m, null), m, `unknown Simpro keeps saved "${m}"`));
eq(M.inProgressMode("", null), "ongoing", "unknown Simpro, nothing saved → Ongoing (old default)");
eq(M.inProgressMode("garbage", null), "ongoing", "unknown Simpro, bad saved value → Ongoing");
eq(M.inProgressMode("garbage", undefined), "ongoing", "undefined counts as unknown");

// ── what a tap does ───────────────────────────────────────────────────────
eq(M.nextMode("scheduled", true), null, "on Simpro's schedule: the tap changes nothing");
eq(M.nextMode("ongoing", false), "needsSched", "not on schedule: Ongoing → Needs Sched");
eq(M.nextMode("needsSched", false), "ongoing", "not on schedule: Needs Sched → Ongoing");
eq(M.nextMode("scheduled", false), "needsSched", "not on schedule, planner showed On Schedule → Needs Sched");
eq([M.nextMode("scheduled", null), M.nextMode("needsSched", null), M.nextMode("ongoing", null), M.nextMode(null, null)],
  ["needsSched", "ongoing", "scheduled", "scheduled"], "unknown Simpro: the old three-way cycle");
// A tap never lands on a mode the pill would immediately show differently.
[true, false].forEach(on => ["scheduled", "needsSched", "ongoing"].forEach(cur => {
  const n = M.nextMode(cur, on);
  if (n) ok(M.inProgressMode(n, on) === n, `tap from ${cur} (Simpro ${on}) saves "${n}" and the pill shows it`);
}));
ok(typeof M.LOCKED_NOTE === "string" && /Simpro/.test(M.LOCKED_NOTE), "a refused tap says why");
ok(M.STALE_MS === 5 * 60 * 1000 && M.REFRESH_MS >= M.STALE_MS, "refresh timings");

// ── wiring: App.js ────────────────────────────────────────────────────────
const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
ok(/import SchedMode from "\.\/schedMode";/.test(app), "App.js imports schedMode");
const derive = (app.match(/const deriveScheduleMode = \(job, phase\) => \{[\s\S]*?\n\};/) || [""])[0];
ok(/SchedMode\.inProgressMode\(mode, simproOnSchedule\(job\)\)/.test(derive), "deriveScheduleMode reads Simpro live for an In Progress phase");
ok(!/mode==="scheduled" \|\| mode==="needsSched" \|\| mode==="ongoing"\) return mode/.test(derive), "the saved value no longer wins by itself");
ok(/useSimproOnSchedule\(!!identity\)/.test(app), "the shared Simpro read is kept fresh for the whole app once signed in");
const hook = (app.match(/function useSimproOnSchedule\(enabled\) \{[\s\S]*?\n\}/) || [""])[0];
ok(/setInterval/.test(hook) && /visibilitychange/.test(hook) && /clearInterval/.test(hook) && /removeEventListener/.test(hook), "the hook refreshes on a timer and on return to the app, and cleans up");
ok(!/setDoc|updateDoc|saveJob|\bu\(/.test(hook), "the hook never writes");
eq((app.match(/SchedMode\.nextMode\(/g) || []).length, 3, "the three tap sites (rough, finish, Crew Planner) use the shared rule");
eq((app.match(/toast\.info\(SchedMode\.LOCKED_NOTE\)/g) || []).length, 3, "each tap site explains a refused tap");
ok(!/cur==="ongoing"\s+\? "scheduled"/.test(app), "no tap site still cycles Ongoing → On Schedule by hand");
const onSched = (app.match(/function simproOnSchedule\(job\) \{[\s\S]*?\n\}/) || [""])[0];
ok(/job\.type !== "quote"/.test(onSched) && /return null/.test(onSched), "simproOnSchedule: quotes and jobs with no Simpro # are unknown, not 'not scheduled'");
eq((app.match(/simproOnSchedule\(job\) !== null \? deriveScheduleMode\(job, "(rough|finish)"\)/g) || []).length, 2, "Forecast / Huddle rows use the live read too");
// The refresh arrow stays (no control removed) and still forces a re-read.
ok(/onSync=\{job\.finishStatus==="inprogress" \? \(\)=>resyncInProgressMode\("finish"\) : null\}/.test(app), "the refresh arrow is still there on Finish");

// ── wiring: server ────────────────────────────────────────────────────────
const idx = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const fn = (idx.match(/exports\.getSimproSchedule = [\s\S]*?\n\}\);/) || [""])[0];
ok(/Date=between\(\$\{dateFrom\},\$\{dateTo\}\)/.test(fn), "getSimproSchedule asks Simpro for the date range");
ok(/&page=\$\{page\}/.test(fn) && /SIMPRO_SCHEDULE_MAX_PAGES/.test(fn) && /rows\.length < 250/.test(fn), "…and pages through it");
ok(/isIsoDay\(dateFrom\) && isIsoDay\(dateTo\)/.test(fn), "only well-formed dates go into the Simpro URL");
const isIsoDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
ok(isIsoDay("2026-11-11") && !isIsoDay("2026-11-11)&x=1") && !isIsoDay("11/11/2026") && !isIsoDay(null), "isIsoDay shape");

console.log(`sched-mode-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
