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
vm.runInContext(mergeSrc + "\n" + guardSrc + "\nthis._jeq = _jeq; this._threeWayMerge = _threeWayMerge; this.jobContentEquals = jobContentEquals; this.baselineAdvanceKeys = baselineAdvanceKeys; this.plBumpRev = plBumpRev; this.plWriteIsStale = plWriteIsStale;", ctx);
const { _jeq, _threeWayMerge, jobContentEquals, baselineAdvanceKeys, plBumpRev, plWriteIsStale } = ctx;

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

if (fails) { console.error(`panel-loads-merge-test: ${fails} of ${n} checks failed`); process.exit(1); }
console.log(`panel-loads-merge-test: ${n} checks passed`);
