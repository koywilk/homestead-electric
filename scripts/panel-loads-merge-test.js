// Stale-copy guard tests (Miller panel-loads rollback, 2026-09-30).
//
// Runs the CURRENT bodies extracted from src/App.js — the three-way merge
// (between the "Three-way merge" and "v338 scalar-conflict telemetry" markers)
// and the stale-copy guard helpers (between the "Stale-copy guards" markers) —
// so it can never test a stale copy. Runs in `prebuild`, so a regression fails
// the build (and the pre-push hook).
//
// What it pins down:
//   1. The MECHANISM of the Miller rollback: a device whose merge baseline is
//      fresher than its on-screen copy takes the merge's "server == base →
//      client verbatim" fast path and rolls the whole loads list back (renames
//      revert, a removed load returns, a load added elsewhere vanishes).
//   2. The INVARIANT that prevents it: when the baseline is what the local copy
//      actually derives from, the same merge keeps every server change and
//      applies only the one local edit.
//   3. The guard helpers that keep the invariant true and trip when it isn't:
//      jobContentEquals (adopt an echo that carries content we don't have),
//      baselineAdvanceKeys (advance only keys the local copy already holds),
//      plBumpRev / plWriteIsStale (a panel-loads write from a copy older than
//      the baseline is refused instead of written).
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const slice = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker);
  if (a === -1 || b === -1 || b < a) { console.error(`panel-loads-merge-test: markers not found: ${startMarker}`); process.exit(1); }
  return src.slice(a, b);
};
const mergeSrc = slice("// ── Three-way merge (Cougar Moon data-loss fix", "// ── Stale-copy guards (Miller panel-loads rollback");
const guardSrc = slice("// ── Stale-copy guards (Miller panel-loads rollback", "// ── end Stale-copy guards");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(mergeSrc + "\n" + guardSrc + "\nthis._jeq = _jeq; this._threeWayMerge = _threeWayMerge; this.jobContentEquals = jobContentEquals; this.baselineAdvanceKeys = baselineAdvanceKeys; this.plBumpRev = plBumpRev; this.plWriteIsStale = plWriteIsStale; this.plDiffIntent = plDiffIntent; this.plMergeIntents = plMergeIntents; this.plApplyIntent = plApplyIntent; this.plMergedRev = plMergedRev; this.plRepairUnticks = plRepairUnticks;", ctx);
const { _jeq, _threeWayMerge, jobContentEquals, baselineAdvanceKeys, plBumpRev, plWriteIsStale, plDiffIntent, plMergeIntents, plApplyIntent, plMergedRev, plRepairUnticks } = ctx;

let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
};
const ok = (name, cond) => { n++; if (!cond) { fails++; console.error(`  FAIL ${name}`); } };

// ── fixtures: Miller-shaped loads list ──────────────────────────────────────
const A = { panelId: "pnl_1", moduleId: "mod_4", zone: 1 };
const old = [
  { id: "L1", name: "Stairway Cans", room: "Main Stairway", assign: null },
  { id: "L2", name: "Primary Bath 2 Vanity Sconces", room: "Primary Bath 2", assign: null },
  { id: "L3", name: "Exterior coach Sconce", room: "Exterior", assign: null },
];
// What another device did since: renamed + placed L1 and L2, removed L3, imported + placed L4.
const fresh = [
  { id: "L1", name: "Main Stairway Cans", room: "Main Stairway", assign: A },
  { id: "L2", name: "Primary Bath 2 North Vanity Sconces", room: "Primary Bath 2", assign: { panelId: "pnl_3", moduleId: "mod_5", zone: 2 } },
  { id: "L4", name: "East Stair Case Main Level Night lights going down", room: "East Stair", assign: { panelId: "pnl_1", moduleId: "mod_4", zone: 3 } },
];
const names = (arr) => arr.map(l => l.id + ":" + l.name + (l.assign ? "@" + l.assign.zone : ""));

// ── 1. the rollback mechanism (base fresher than the on-screen copy) ────────
{
  // The stale device taps one load (L2 → zone 4) on its OLD copy while its
  // baseline already holds the fresh server state.
  const client = old.map(l => l.id === "L2" ? { ...l, assign: { panelId: "pnl_3", moduleId: "mod_5", zone: 4 } } : l);
  const out = _threeWayMerge(fresh, client, fresh);
  eq("MECHANISM: fresh baseline + stale copy = verbatim rollback (renames revert, L3 returns, L4 vanishes)",
    names(out), names(client));
}

// ── 2. the invariant (base == what the local copy derives from) ─────────────
{
  const client = old.map(l => l.id === "L2" ? { ...l, assign: { panelId: "pnl_3", moduleId: "mod_5", zone: 4 } } : l);
  const out = _threeWayMerge(old, client, fresh);
  const byId = Object.fromEntries(out.map(l => [l.id, l]));
  eq("INVARIANT: L1 keeps the server's rename + zone", [byId.L1.name, byId.L1.assign], ["Main Stairway Cans", A]);
  eq("INVARIANT: L2 takes the server's rename, keeps the local zone tap", [byId.L2.name, byId.L2.assign.zone], ["Primary Bath 2 North Vanity Sconces", 4]);
  ok("INVARIANT: removed load stays removed", !byId.L3);
  ok("INVARIANT: load added elsewhere survives", !!byId.L4 && byId.L4.assign.zone === 3);
}

// ── 3a. jobContentEquals — own echo with only meta changed is skippable ─────
{
  const local = { id: "j1", name: "Miller", panelizedLighting: { loads: fresh, baseline: null }, updated_at: "2026-09-30T10:00:00.000Z", _tab: "tab_a" };
  const echoSame = { id: "j1", name: "Miller", panelizedLighting: { loads: fresh, baseline: null }, updated_at: "2026-09-30T10:00:01.000Z", _tab: "tab_a", _saved_by: "Koy", lastActivityAt: { seconds: 1 } };
  const echoForeign = { ...echoSame, panelizedLighting: { loads: old, baseline: null } };
  const echoNewKey = { ...echoSame, presence: { Josh: "2026-09-30T10:00:01.000Z" } };
  ok("jobContentEquals: same data, different meta → equal", jobContentEquals(local, echoSame));
  ok("jobContentEquals: foreign change inside panelizedLighting → not equal", !jobContentEquals(local, echoForeign));
  ok("jobContentEquals: key only on the echo → not equal", !jobContentEquals(local, echoNewKey));
  ok("jobContentEquals: null-safe", !jobContentEquals(null, echoSame) && jobContentEquals(null, null));
}

// ── 3b. baselineAdvanceKeys — advance only what the local copy already holds ─
{
  const prev = { id: "j1", roughPunch: { main: [] }, panelizedLighting: { loads: old }, updated_at: "2026-09-30T09:00:00.000Z" };
  const local = { id: "j1", roughPunch: { main: [{ id: "p1" }] }, panelizedLighting: { loads: old }, updated_at: "2026-09-30T09:00:00.000Z" };
  const echo = { id: "j1", roughPunch: { main: [{ id: "p1" }] }, panelizedLighting: { loads: fresh }, updated_at: "2026-09-30T10:00:00.000Z", _tab: "tab_a", _saved_by: "Koy" };
  const next = baselineAdvanceKeys(prev, echo, local, (x) => x);
  eq("baselineAdvanceKeys: key the local copy already holds → advanced", next.roughPunch, echo.roughPunch);
  eq("baselineAdvanceKeys: key the local copy lacks → kept at the old baseline", next.panelizedLighting, prev.panelizedLighting);
  eq("baselineAdvanceKeys: updated_at follows the echo", next.updated_at, echo.updated_at);
  ok("baselineAdvanceKeys: meta keys are not copied as data", !("_saved_by" in next) || next._saved_by === undefined);
  const nb = baselineAdvanceKeys(prev, echo, local, (x) => ({ ...x, panelizedLighting: { ...x.panelizedLighting, baseline: null } }));
  eq("baselineAdvanceKeys: compares through the normalizer, stores the raw echo value", nb.roughPunch, echo.roughPunch);
}

// ── 3c. plBumpRev / plWriteIsStale — the tripwire ───────────────────────────
{
  eq("plBumpRev: legacy (no rev) → 1", plBumpRev({ loads: [] }).plRev, 1);
  eq("plBumpRev: 15 → 16, siblings kept", plBumpRev({ plRev: 15, loads: old, lutronRooms: [1] }), { plRev: 16, loads: old, lutronRooms: [1] });
  eq("plBumpRev: null-safe", plBumpRev(null).plRev, 1);
  const base15 = { plRev: 15, loads: fresh }, srv15 = { plRev: 15, loads: fresh };
  ok("fresh copy (local 15 → write 16) against base 15 → not stale", !plWriteIsStale(plBumpRev({ plRev: 15 }), base15, srv15));
  ok("burst (local 15 → 16 → 17) against base 15 → not stale", !plWriteIsStale(plBumpRev(plBumpRev({ plRev: 15 })), base15, srv15));
  ok("stale copy (local 10 → write 11) against base 15 → STALE", plWriteIsStale(plBumpRev({ plRev: 10 }), base15, srv15));
  ok("copy equal to base but unbumped (11 vs 11) → STALE", plWriteIsStale({ plRev: 11 }, { plRev: 11 }, srv15));
  ok("legacy base (no rev) → never stale", !plWriteIsStale(plBumpRev({}), { loads: old }, { loads: old }));
  ok("no baseline: replayed old patch (11) against server 15 → STALE", plWriteIsStale({ plRev: 11 }, undefined, srv15));
  ok("no baseline: fresh write (16) against server 15 → not stale", !plWriteIsStale({ plRev: 16 }, undefined, srv15));
  ok("no baseline, legacy server → not stale", !plWriteIsStale(plBumpRev({}), undefined, { loads: old }));
  ok("no baseline, no server doc → not stale", !plWriteIsStale(plBumpRev({}), undefined, undefined));
  ok("concurrent: local 15 → 16 while server already at 16 but base still 15 → not stale (structural merge handles it)", !plWriteIsStale({ plRev: 16 }, base15, { plRev: 16 }));
  ok("client with no rev at all → not stale", !plWriteIsStale({ loads: [] }, base15, srv15));
}

// ── 4. Intent merge (Miller 2026-10-01): the two rollbacks v471 missed ──────
{
  const L = (id, name, extra) => ({ id, name, room: "R", pulled: false, ...extra });
  const tick = (who) => ({ pulled: true, pulledBy: who, pulledAt: "10/1/2026" });
  const untick = { pulled: false, pulledBy: "", pulledAt: "" };
  // Noah 10/1 5:12 pm: the server holds five ticks by others; the phone's copy predates
  // them (un-ticked), then ticks L9 and un-ticks its own L7.
  const srv = { plRev: 2097, loads: [L("L1", "WAFER", tick("Braden")), L("L2", "Tape", tick("Austin")), L("L3", "Exercise", tick("Keegan")), L("L4", "Chand", tick("Austin")), L("L5", "Bath", tick("Braden")), L("L7", "Patio", tick("Noah")), L("L9", "Family")] };
  const phonePrev = { plRev: 2092, loads: [L("L1", "WAFER"), L("L2", "Tape"), L("L3", "Exercise"), L("L4", "Chand"), L("L5", "Bath"), L("L7", "Patio", tick("Noah")), L("L9", "Family")] };
  const phoneNext = { plRev: 2094, loads: phonePrev.loads.map(l => l.id === "L9" ? { ...l, ...tick("Noah") } : l.id === "L7" ? { ...l, ...untick } : l) };
  const intent = plDiffIntent(phonePrev, phoneNext);
  eq("plDiffIntent: only the two loads the phone touched, field by field", intent, { changed: { L7: ["pulled", "pulledBy", "pulledAt"], L9: ["pulled", "pulledBy", "pulledAt"] }, added: [], removed: [], keys: [], untracked: false });
  const out = plMergedRev(plApplyIntent(srv, phoneNext, intent, phonePrev), phoneNext, srv);
  eq("MILLER 10/1 5:12 pm: the five foreign ticks survive, the phone's own tick and un-tick land", out.loads.map(l => l.id + ":" + l.pulled + ":" + (l.pulledBy || "")), ["L1:true:Braden", "L2:true:Austin", "L3:true:Keegan", "L4:true:Austin", "L5:true:Braden", "L7:false:", "L9:true:Noah"]);
  eq("…and plRev lands above the server (2094 vs 2097 → 2098)", out.plRev, 2098);
  // Austin 9/30 3:57 pm: the server renamed loads the phone never touched; the phone ticks one.
  const srv2 = { plRev: 2050, loads: [L("L1", "Primary Hallway by Closet Cans"), L("L2", "Primary Hallway Sconce"), L("L3", "Upper Office Cans")] };
  const ph2 = { plRev: 38, loads: [L("L1", "Primary Hall Cans"), L("L2", "Primary Hall Sconce"), L("L3", "Upper Office Cans")] };
  const ph2n = { plRev: 39, loads: ph2.loads.map(l => l.id === "L3" ? { ...l, ...tick("Austin") } : l) };
  const out2 = plMergedRev(plApplyIntent(srv2, ph2n, plDiffIntent(ph2, ph2n), ph2), ph2n, srv2);
  eq("MILLER 9/30 3:57 pm: the renames survive, the tick lands, rev 2051", [out2.loads.map(l => l.name).join("|"), out2.loads[2].pulled, out2.plRev], ["Primary Hallway by Closet Cans|Primary Hallway Sconce|Upper Office Cans", true, 2051]);
  // add / remove / server-side add + delete / edit-vs-delete
  const base3 = { plRev: 5, loads: [L("A", "a"), L("B", "b"), L("C", "c"), L("D", "d")] };
  const srv3 = { plRev: 7, loads: [L("A", "a"), L("B", "b-server"), L("E", "e-added-elsewhere")] };   // server removed C + D, renamed B, added E
  const cli3 = { plRev: 6, loads: [L("A", "a"), L("B", "b"), L("D", "d-edited-here"), L("F", "f-added-here")] };   // client removed C, edited D, added F
  const i3 = plDiffIntent(base3, cli3);
  eq("plDiffIntent: removed / changed / added", [i3.removed, Object.keys(i3.changed), i3.added], [["C"], ["D"], ["F"]]);
  eq("apply: server rename kept, client delete honored, client edit of a server-deleted load kept, both adds kept", plApplyIntent(srv3, cli3, i3, base3).loads.map(l => l.id + ":" + l.name), ["A:a", "B:b-server", "D:d-edited-here", "F:f-added-here", "E:e-added-elsewhere"]);
  // other panelizedLighting keys: a client change goes through the baseline merge; untouched keys come from the server
  const srv4 = { plRev: 3, loads: [], panels: [{ id: "p1", modules: [{ id: "m1", num: 1 }] }], mainKeypad: "server" };
  const base4 = { plRev: 3, loads: [], panels: [{ id: "p1", modules: [{ id: "m1", num: 1 }] }], mainKeypad: "old" };
  const cli4 = { plRev: 4, loads: [], panels: [{ id: "p1", modules: [{ id: "m1", num: 1 }, { id: "m2", num: 2 }] }], mainKeypad: "old" };
  const i4 = plDiffIntent(base4, cli4);
  eq("plDiffIntent: other panelizedLighting keys", i4.keys, ["panels"]);
  const out4 = plApplyIntent(srv4, cli4, i4, base4);
  eq("apply: changed key merged (module added), untouched key from the server", [out4.panels[0].modules.map(m => m.id), out4.mainKeypad], [["m1", "m2"], "server"]);
  ok("plDiffIntent: a load with no id marks the intent untracked (caller falls back to the baseline merge)", plDiffIntent({ loads: [{ name: "x" }] }, { loads: [{ name: "y" }] }).untracked);
  // bursts: union; add-then-remove = remove; remove-then-add = add
  eq("plMergeIntents: union of fields + keys, add-then-remove drops the add", plMergeIntents({ changed: { A: ["pulled"] }, added: ["N1"], removed: [], keys: [] }, { changed: { A: ["name"], B: ["room"] }, added: [], removed: ["N1"], keys: ["panels"] }), { changed: { A: ["pulled", "name"], B: ["room"] }, added: [], removed: ["N1"], keys: ["panels"], untracked: false });
  eq("plMergeIntents: remove-then-add keeps the add", plMergeIntents({ changed: {}, added: [], removed: ["X"], keys: [] }, { changed: {}, added: ["X"], removed: [], keys: [] }), { changed: {}, added: ["X"], removed: [], keys: [], untracked: false });
  eq("plMergeIntents: null-safe", plMergeIntents(null, { changed: {}, added: [], removed: [], keys: [] }), { changed: {}, added: [], removed: [], keys: [] });
  // plMergedRev — the rev never goes backwards through a merge
  eq("plMergedRev: copy behind the server → server + 1 (2094 vs 2097 → 2098)", plMergedRev({ plRev: 2094 }, { plRev: 2094 }, { plRev: 2097 }).plRev, 2098);
  eq("plMergedRev: copy ahead keeps its rev (2096 vs 2094)", plMergedRev({ plRev: 2096 }, { plRev: 2096 }, { plRev: 2094 }).plRev, 2096);
  eq("plMergedRev: restored server 1042 vs a copy at 45 → 1043, never 46", plMergedRev({ plRev: 45 }, { plRev: 45 }, { plRev: 1042 }).plRev, 1043);
  { const same = { plRev: 9 }; ok("plMergedRev: already right → same object", plMergedRev(same, { plRev: 9 }, { plRev: 8 }) === same); }
  // plRepairUnticks (baseline-merge path only)
  const srv5 = { loads: [L("L1", "a", tick("Braden")), L("L2", "b", tick("Austin")), L("L3", "c")] };
  const bad5 = { loads: [{ ...L("L1", "a"), pulled: false, pulledBy: "Braden", pulledAt: "10/1/2026" }, { ...L("L2", "b"), ...untick }, L("L3", "c")] };
  const r5 = plRepairUnticks(bad5, srv5);
  eq("plRepairUnticks: pulled:false with someone's pulledBy = merge damage → server tick restored; a real un-tick (cleared stamp) stands", [r5.repaired, r5.pl.loads.map(l => l.id + ":" + l.pulled)], [["a"], ["L1:true", "L2:false", "L3:false"]]);
  ok("plRepairUnticks: nothing to repair → same object", plRepairUnticks(srv5, srv5).pl === srv5);
}

if (fails) { console.error(`panel-loads-merge-test: ${fails} of ${n} checks failed`); process.exit(1); }
console.log(`panel-loads-merge-test: ${n} checks passed`);
