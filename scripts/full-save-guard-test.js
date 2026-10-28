// Full-copy save guard (Namjoshi punch wipe, 2026-10-28).
//
// Runs the CURRENT bodies extracted from src/App.js — the three-way merge and
// the stale-copy guard helpers (same markers as panel-loads-merge-test.js) —
// plus a static sweep of saveJob, so it can never test a stale copy. Runs in
// `prebuild`, so a regression fails the build (and the pre-push hook).
//
// What happened (server history, PITR reads of jobs/1789498767402):
//   17:42–17:51Z  Trever adds 4 basement rooms / 9 rough-punch items.
//   18:14:23Z     Koy opens Namjoshi in a fresh tab (tab_38fyvhnu, dev_qrb7zi);
//                 the presence ping queues {presence}.
//   18:14:26Z     One write lands with merged:false that replaces EVERY data key
//                 from a copy stamped 15:02:41 (tab_3pbln154): roughPunch back
//                 to the empty pre-rooms tree, presence rolled back, and the
//                 loader's own meta (_device, _tab, _merged, _saved_by,
//                 updated_at, lastActivityAt) written INTO data for the first
//                 time in the doc's life.
// Only one writer can put loader meta into `data`: saveJob's no-patch branch
// (it merges sanitize(job), every key of the in-memory copy). A patch-mode save
// writes only the keys it was handed. That branch is reached whenever the
// timer fires with NOTHING queued — and with a baseline fresher than the copy,
// every key takes the merge's "server == base → client verbatim" fast path.
//
// What it pins down:
//   1. MECHANISM, on the real Namjoshi values: fresh baseline + 15:02 copy →
//      Trever's rooms and the newer presence stamps are written over verbatim.
//   2. The queue race that reaches the no-patch branch for an EXISTING job: a
//      save armed while an earlier write for the same job is in flight finds
//      the queue drained by that write when its own timer fires.
//   3. THE GUARD: with nothing queued, a debounced save may only CREATE a
//      missing doc — it never writes over an existing one — and saveJob's
//      no-patch transaction has no update path left.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const slice = (startMarker, endMarker) => {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker, a + 1);
  if (a === -1 || b === -1 || b < a) { console.error(`full-save-guard-test: markers not found: ${startMarker}`); process.exit(1); }
  return src.slice(a, b);
};
const mergeSrc = slice("// ── Three-way merge (Cougar Moon data-loss fix", "// ── Stale-copy guards (Miller panel-loads rollback");
const guardSrc = slice("// ── Stale-copy guards (Miller panel-loads rollback", "// ── end Stale-copy guards");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(mergeSrc + "\n" + guardSrc + "\nthis._threeWayMerge = _threeWayMerge; this._jeq = _jeq;" +
  "\nthis.debouncedSaveMode = typeof debouncedSaveMode === 'function' ? debouncedSaveMode : null;" +
  "\nthis.drainWrittenKeys = typeof drainWrittenKeys === 'function' ? drainWrittenKeys : null;", ctx);
const { _threeWayMerge, _jeq, debouncedSaveMode, drainWrittenKeys } = ctx;

let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
};
const ok = (name, cond) => { n++; if (!cond) { fails++; console.error(`  FAIL ${name}`); } };

// ── fixtures: jobs/1789498767402 as PITR returned it ─────────────────────────
const item = (id, text, ts) => ({ addedAt: "2026-10-28", addedAtTs: ts, addedBy: "Trever Worley", done: false, id, text });
const floor = (rooms) => ({ general: [], hotcheck: [], photos: [], rooms });
const treverPunch = {   // 18:13:00Z — 4 rooms, 9 items (the alert's "13")
  basement: floor([
    { id: "1793209191966", name: "Bed 1", items: [item("1793209191974", "Box outlets", "2026-10-28T17:44:10.689Z"), item("1793209191975", "Rope outlets", "2026-10-28T17:44:15.448Z"), item("1793209191976", "Box lights", "2026-10-28T17:44:32.088Z")] },
    { id: "1793209191969", name: "Bed 2", items: [item("1793209191977", "Box lights", "2026-10-28T17:44:43.497Z"), item("1793209191978", "Box outlets&nbsp;", "2026-10-28T17:44:56.555Z"), item("1793209191979", "Rope outlets", "2026-10-28T17:45:01.248Z"), item("1793209192044", "Cut out low volt", "2026-10-28T17:51:18.336Z")] },
    { id: "1793209191970", name: "Mech", items: [item("1793209192045", "Make up new circuits&nbsp;", "2026-10-28T17:51:28.384Z")] },
    { id: "1793209191971", name: "Garage", items: [item("1793209191972", "EV charger (try not to cut drywall in drop) (can cut drywall in garage)", "2026-10-28T17:42:55.090Z")] },
  ]),
  extras: [], main: floor([]), upper: floor([]),
};
const copy1502Punch = { upper: [], basement: [], main: [] };   // what 18:14:26Z wrote
const presence1813 = { "Koy Wilkinson": "2026-10-28T15:02:40.732Z", "Noah Davis": "2026-10-28T16:38:39.815Z", "Trever Worley": "2026-10-28T17:50:54.881Z" };
const presenceCopy = { "Koy Wilkinson": "2026-10-28T18:14:23.270Z", "Noah Davis": "2026-10-28T12:55:23.934Z", "Trever Worley": "2026-10-28T13:21:41.304Z" };
const count = (rp) => { let r = 0, i = 0; ["upper", "main", "basement"].forEach(f => { const rooms = rp && rp[f] && rp[f].rooms; (rooms || []).forEach(x => { r++; i += (x.items || []).length; }); }); return { rooms: r, items: i }; };

// ── 1. MECHANISM — the 18:14:26Z write, key by key ──────────────────────────
{
  // Baseline already holds the server's 17:51 state; the copy is from 15:02.
  const rp = _threeWayMerge(treverPunch, copy1502Punch, treverPunch);
  eq("MECHANISM: fresh baseline + 15:02 copy → roughPunch written verbatim (Trever's rooms gone)", rp, copy1502Punch);
  eq("MECHANISM: …which is 0 rooms / 0 items, down from 4 / 9", [count(treverPunch), count(rp)], [{ rooms: 4, items: 9 }, { rooms: 0, items: 0 }]);
  const pr = _threeWayMerge(presence1813, presenceCopy, presence1813);
  eq("MECHANISM: presence rolled back too (Trever 17:50 → 13:21) — every key took the fast path", pr["Trever Worley"], "2026-10-28T13:21:41.304Z");
}
// The same merge with an HONEST baseline (what the copy derives from) is safe —
// so the bug is not the merge, it is a whole-copy write from a copy older than
// its baseline.
{
  const rp = _threeWayMerge(copy1502Punch, copy1502Punch, treverPunch);
  eq("INVARIANT: baseline = the copy's own origin → Trever's rooms survive", count(rp), { rooms: 4, items: 9 });
}

// ── 2 + 3. the queue race and the guard ─────────────────────────────────────
ok("GUARD: debouncedSaveMode exists in the Stale-copy guards block", typeof debouncedSaveMode === "function");
ok("GUARD: drainWrittenKeys exists in the Stale-copy guards block", typeof drainWrittenKeys === "function");
if (debouncedSaveMode && drainWrittenKeys) {
  // Replays saveJob's queue bookkeeping with the real helpers.
  const P = { "Koy Wilkinson": "2026-10-28T18:14:23.270Z" };
  let pending = { presence: P };                       // u({presence}) → saveJob queues it
  const accA = { ...pending };                          // timer A fires, snapshots the queue
  eq("RACE: timer A writes the queued presence patch", debouncedSaveMode(Object.keys(accA), Object.keys(accA)), "patch");
  pending = { ...pending, ...{} };                      // a second save for the job arrives with nothing new (empty patch / no-patch retry) → timer B armed
  pending = drainWrittenKeys(pending, accA);            // A's transaction confirms → clears exactly what it wrote
  eq("RACE: A's confirm drains the queue B was counting on", pending, null);
  const accB = { ...(pending || {}) };                  // timer B fires with nothing queued
  eq("GUARD: B with nothing queued may only CREATE a missing doc (was: merge the whole stale copy over the job)",
    debouncedSaveMode(Object.keys(accB), Object.keys(accB)), "createOnly");

  // Bookkeeping it must keep doing exactly as before.
  eq("drain: keeps a key re-queued with a NEWER value during the write", drainWrittenKeys({ roughPunch: "v2", presence: P }, { roughPunch: "v1", presence: P }), { roughPunch: "v2" });
  eq("drain: keeps a key queued after the snapshot", drainWrittenKeys({ notes: "x", presence: P }, { presence: P }), { notes: "x" });
  eq("drain: nothing queued stays nothing", drainWrittenKeys(undefined, { presence: P }), null);
  eq("mode: only the panel-loads intent left → nothing to write", debouncedSaveMode([], ["__plIntent"]), "nothing");
  eq("mode: any queued field → patch (unchanged)", debouncedSaveMode(["roughPunch"], ["roughPunch"]), "patch");
}

// ── static sweep: saveJob's no-patch branch can no longer update a job ──────
{
  const a = src.indexOf("  const saveJob = (job, patch) => {");
  const b = src.indexOf("// RECONNECT FLUSH", a);
  ok("SWEEP: saveJob found", a !== -1 && b > a);
  const body = src.slice(a, b);
  ok("SWEEP: saveJob decides its write through debouncedSaveMode", /debouncedSaveMode\(/.test(body));
  ok("SWEEP: saveJob drains its queue through drainWrittenKeys", /drainWrittenKeys\(/.test(body));
  const c = body.indexOf('mode === "createOnly"');
  ok("SWEEP: saveJob has a createOnly branch", c !== -1);
  const branch = c === -1 ? "" : body.slice(c, body.indexOf("isDirty.current = false;", c));
  ok("SWEEP: the createOnly branch never calls tx.update / updateDoc / _mergePatchAgainstServer",
    branch.length > 0 && !/tx\.update\(|updateDoc\(|_mergePatchAgainstServer\(/.test(branch));
  ok("SWEEP: the createOnly branch refuses an existing doc", /snap\.exists\(\)/.test(branch) && /REFUSED/.test(branch));
}

console.log(`full-save-guard-test: ${n - fails}/${n} checks passed`);
if (fails) { console.error(`full-save-guard-test: ${fails} FAILED`); process.exit(1); }
