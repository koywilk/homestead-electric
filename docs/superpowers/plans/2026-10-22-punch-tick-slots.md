# Punch Check-off Slots (v559) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a punch check or un-check impossible to lose to another phone's stale whole-tree save, by writing each flip as its own `data.punchTicks.<itemId>` slot and overlaying the slots on every read.

**Architecture:** One pure CommonJS module (`src/punchTicks.js`, copied byte-for-byte to `functions/punchTicks.js` by a prebuild check) holds the diff (`punchTickPatches`), the read overlay (`applyPunchTicks`) and the local fold (`foldTickPatches`). The three punch writers add `"punchTicks.<id>"` keys to the patch they already send; `saveJob` / `flushJob` / `flushSaves` already write `"data." + key`, so only `_mergePatchAgainstServer` learns a slot branch (latest `ts` wins, never baseline-merged). The overlay runs inside `normalizeJob` (which the jobs listener reaches through `migrate`) and in the five Cloud Functions readers. Stored punch trees are unchanged.

**Tech Stack:** Create React App (`src/App.js`, ~74k lines), Cloud Functions (CommonJS, `functions/`), plain-node prebuild gate scripts (`vm` extraction of real App.js code, as in `scripts/panel-loads-merge-test.js` and `scripts/punchnotes-test.js`).

**Spec:** `docs/superpowers/specs/2026-10-22-punch-tick-slots-design.md` (approved by Koy 2026-10-22). Read it first; this plan uses its names and values verbatim.

## Global Constraints

- Slot shape, exactly: `data.punchTicks.<itemId> = { done: true|false, by: "<name>", at: "M/D/YYYY", ts: "<ISO>" }`. Written ONLY as dotted paths `data.punchTicks.<itemId>`, never as a whole map from a client (one exception, the legacy no-patch full save, is merged server-side inside the transaction; Task 4).
- Done slot = the item's own `checkedBy` / `checkedAt` / `checkedAtTs`; un-done slot = `done:false` + who/when of the un-tick. Overlay on `done:false` clears `checkedBy`, `checkedAt`, `checkedAtTs`.
- Newer-tick exception: a tree item that is done with `checkedAtTs` NEWER than the slot's `ts` keeps the tree.
- Latest `ts` wins per item; a slot is never baseline-merged and never flags `merged`.
- Whole-tree write still happens unchanged. No migration. No `firestore.rules` change. Return-trip punch, `changeOrders[].taskChecks`, 4-way items and public share pages are untouched (linked RT entries only FOLLOW their origin item's slot on read).
- Service worker: line 1 of `public/service-worker.js` becomes `const CACHE = "homestead-v559";`.
- Do not push, do not deploy. Local commits only; Koy pushes. End commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Work only in `~/dev/homestead-electric`. Never read anything under `~/Desktop` except the one vault-log write in Task 7.
- Line numbers drift: find code with the grep anchors given in each task.

## Review Focus

Inputs and conditions the spec implies but does not spell out, most likely to bite first. Each has a named test in the owning task.

1. A done item with NO `checkedAtTs` (the RT cascade helper `_flipInFloors` and `handleSignOffRT` stamp `checkedAt` but sometimes no Ts): the slot must still get a valid `ts`, and the overlay must not crash or flip on it. (Task 1)
2. Same item ticked, un-ticked and re-ticked inside one pending burst, or replayed after an offline gap with a `ts` OLDER than the server's slot: the pending key is replaced (last tap in the queue) and the server's newer slot still wins. (Tasks 3, 4)
3. Jobs with a missing/`null` punch tree (`qcPunch` is not defaulted by `normalizeJob`), a `punchTicks` that is `null`, a string, or holds a malformed slot: `applyPunchTicks` must return the job untouched and never throw (it runs for every job on every snapshot). (Task 1)
4. The literal dotted key `"punchTicks.<id>"` leaking onto a job object (via `{...job, ...patch}`, the `_advanceMergeBaseline` loop, or the CONVERGENCE re-seed in `saveJob`), onto `hejobs_backup`, or into the baseline. (Tasks 3, 4)
5. Document growth: a slot must stay tiny (JSON under 160 bytes) because jobs with photos already sit near the 1 MB limit. (Task 1)

## File Structure

| File | Responsibility |
|---|---|
| `src/punchTicks.js` (new) | Pure helpers: `isTickKey`, `tickIdOf`, `slotWins`, `mergeTickMaps`, `punchTickPatches`, `applyPunchTicks`, `foldTickPatches`. CommonJS, no requires. Source of truth. |
| `functions/punchTicks.js` (new) | Byte-identical copy for Cloud Functions. Never hand-edited. |
| `scripts/punch-ticks-sync.js` (new) | Prebuild check that the two files are identical; `--write` copies. |
| `scripts/punch-ticks-test.js` (new) | The gate: module unit tests, Miller 15:32 replay through the real merge code, writer tripwires, functions-reader tests. |
| `src/App.js` | Import; `normalizeJob` wrapper; `u()`, `togglePunchItemDone`, `handleSignOffRT` call `punchTickPatches`; `updateJob`/`saveJob` fold; `_mergePatchAgainstServer` slot branches; `_advanceMergeBaseline` + CONVERGENCE block skip literal slot keys. |
| `functions/strategyPrep.js`, `functions/gcPortal.js`, `functions/fridayPacket.js`, `functions/index.js` | Apply overlay before reading `done`; `punchTicks` added to the versions WATCH list. |
| `scripts/punch-versions.js` (untracked, read-only) | Overlay in its report. Stays untracked: do not `git add` it. |
| `package.json` | `prebuild` chain gains the sync check (right after `version-from-sw.js`) and the gate (last). |
| `public/service-worker.js`, `FEATURES.md`, `docs/crew-briefs/v559.md` | Ship hygiene (Task 7). |

## Design-to-code reconciliation (what the code showed)

- The jobs listener builds `loaded` with `migrate(...)`, and `migrate` returns `normalizeJob(...)`. So ONE application point (`normalizeJob`) covers the listener, `hejobs_backup` seeding, JobDetail adoption, `refreshJob`, the baseline recorder AND the `base`/`nServer` copies inside `_mergePatchAgainstServer`. The design's "two places" collapse to one; tripwires pin the chain.
- `functions/fridayPacket.js` `buildModel` has no caller since the Friday Packet was retired (v545; only `collectMoneyCandidates`/`collectQuoteCandidates` are used). The reader is patched for consistency but is dead code today.
- `functions/gcPortal.js` is called through `projectJobForPortal(jobId, job)` only (mirror trigger plus `gcPortalRebuildMirror`); patching that one entry covers `punchOpenCount`, `punchView`, `qcItemsOf` and the RT view. `gcPortal-test.js` calls `punchView(tree)` directly on trees, which stays unchanged.
- "The prebuild step copies and refuses to build if the two differ" is implemented as: default mode CHECKS (fails with the fix command); `--write` copies. A silent copy at build time would hide drift because `firebase deploy` ships the working tree.
- `setMinBuild` is an admin-PIN callable, driven from Settings → Devices → App Versions → "Require v___". There is no shell command for it (Task 7 says so).

---

### Task 1: `src/punchTicks.js` pure module (tests first)

**Files:**
- Create: `scripts/punch-ticks-test.js` (module sections only; later tasks append)
- Create: `src/punchTicks.js`

**Interfaces:**
- Produces (CommonJS `module.exports`, all pure, none mutates its input):
  - `isTickKey(k: string): boolean` true when `k` starts with `"punchTicks."` and has a non-empty id.
  - `tickIdOf(k: string): string` the id after the prefix.
  - `slotWins(serverSlot: object|undefined, ourSlot: object): boolean` true = write ours. Server slot missing/invalid → true; server `ts` strictly newer than ours → false; tie or unparseable → true.
  - `mergeTickMaps(serverMap: object|undefined, clientMap: object|undefined): object` per-id union, newer `ts` wins (used only by the legacy full-save branch).
  - `punchTickPatches(prevTree: object|undefined, nextTree: object|undefined, who: string, nowIso: string): { [“punchTicks.<id>”]: Slot }`.
  - `applyPunchTicks(jobData: object): object` (same object identity when nothing changes).
  - `foldTickPatches(job: object, patch: object): object` returns `job` with every `"punchTicks.<id>"` key of `patch` folded into `job.punchTicks`, and any literal `"punchTicks.*"` keys removed from the job; same object when there is nothing to fold or strip.
- Tree shape walked: `punch.upper|main|basement` plus `punch[e.key]` for each `punch.extras[{key}]`; each floor `{ general:[item], rooms:[{id,name,items:[item]}], hotcheck:[item] }`. Trees: `roughPunch`, `finishPunch`, `qcPunch`. RT entries: `returnTrips[].punch[]` with `originItemId`.

- [ ] **Step 1: Write `scripts/punch-ticks-test.js` with the module sections (it must fail: module missing)**

Fixtures and helpers at the top, then one `check(label, fn)` per line below (all use `assert` from node). Ends with `console.log(\`punch-ticks-test: ${n} checks passed\`)`; later tasks insert sections ABOVE that line.

```js
const PT = require("../src/punchTicks.js");
const T1 = "2026-10-22T15:31:48.355Z", T2 = "2026-10-22T15:32:10.000Z", T3 = "2026-10-22T15:33:00.000Z";
const item = (id, done, o = {}) => ({ id, text: "item " + id, done, checkedBy: done ? "Austin" : "", checkedAt: done ? "10/22/2026" : "", checkedAtTs: done ? T1 : "", ...o });
const floor = (items) => ({ general: items, rooms: [], hotcheck: [] });
const tree = (items) => ({ main: floor(items) });
const flat = (t) => { const out = []; if (!t) return out; ["upper","main","basement",...(t.extras||[]).map(e=>e.key)].forEach(k => { const f = t[k]; if (!f) return; out.push(...f.general, ...f.hotcheck, ...f.rooms.flatMap(r => r.items)); }); return out; };
const byId = (t, id) => flat(t).find(i => i.id === id);
```

Tests (name → assertions):
  - `punchTickPatches: only the item whose done changed` — prev `[1 open, 2 open]`, next `[1 done by "Keegan Wilkinson" Ts T1, 2 open]` → `deepStrictEqual(patches, { "punchTicks.1": { done:true, by:"Keegan Wilkinson", at:"10/22/2026", ts:T1 } })`.
  - `punchTickPatches: un-tick slot is done:false with who/when` — prev `[1 done]`, next `[1 open]`, who `"Keegan Wilkinson"`, now `T2` → slot has `done:false`, `by:"Keegan Wilkinson"`, `ts:T2`, `at` matching `/^\d{1,2}\/\d{1,2}\/\d{4}$/`.
  - `punchTickPatches: done item with no checkedAtTs gets nowIso` (Review Focus 1) — next item done with `checkedAtTs:""`, `checkedBy:""` → slot `ts === T2`, `by === who`.
  - `punchTickPatches: adds, text edits, voids, removals and moves make no slot` — next tree adds item 3 already done, edits text of 1, sets `voided:true` on 2, removes 4, moves 5 to another room → `{}`.
  - `punchTickPatches: walks rooms, hotcheck and extras floors` — flip one item in each of a room, `hotcheck`, and a floor under `extras:[{key:"garage",label:"Garage"}]` → three keys.
  - `punchTickPatches: missing trees are harmless` — `(undefined, undefined)`, `(null, tree)`, `(tree, null)` → `{}`.
  - `slot stays small` (Review Focus 5) — `JSON.stringify(slot).length < 160` for a done slot with a 25-char name.
  - `applyPunchTicks: no punchTicks field → same object`; `punchTicks: {}` → same object; `punchTicks: null`, `"x"`, and `{ "1": null, "2": { done: "yes" } }` → same object, no throw (Review Focus 3). A job with `qcPunch` undefined and a slot that matches nothing → same object.
  - `applyPunchTicks: done slot sets done and stamps in all three trees, rooms/general/hotcheck/extras` — item ids 1 (rough general), 2 (finish room), 3 (qc hotcheck), 4 (rough extras floor), each with a done slot → `byId(...).done === true` and `checkedBy/checkedAt/checkedAtTs` equal the slot's `by/at/ts`.
  - `applyPunchTicks: done:false slot clears done and all three stamps` — tree item done by Austin T1, slot `{done:false, ts:T2}` → `done false`, `checkedBy "" checkedAt "" checkedAtTs ""`.
  - `applyPunchTicks: newer tree tick beats older slot` — tree item done `checkedAtTs:T3`, slot `{done:false, ts:T2}` → stays done with T3 stamps; and tree done `checkedAtTs:T1` + slot `{done:false, ts:T2}` → cleared (older tree loses).
  - `applyPunchTicks: linked return-trip entries follow the origin slot` — `returnTrips:[{punch:[{id:"p1", originItemId:"1", originPhase:"rough", done:false}, {id:"p2", done:false}]}]`, slot 1 done → `p1.done === true` with the slot's stamps, `p2` untouched (identity).
  - `applyPunchTicks: idempotent and non-mutating` — `JSON.stringify(input)` unchanged after the call; `applyPunchTicks(applyPunchTicks(x)) === applyPunchTicks(x)` (identity on second pass) and `deepStrictEqual` to it.
  - `applyPunchTicks: untouched floors and items keep identity` — a slot on item 1 leaves `job.finishPunch === out.finishPunch` and the sibling item objects `===`.
  - `foldTickPatches: folds slots, strips literal keys` — `foldTickPatches({ a:1, punchTicks:{ "9":S9 }, "punchTicks.1":junk }, { roughPunch:{}, "punchTicks.1":S1 })` → result has `punchTicks` `{ "9":S9, "1":S1 }`, no key starting `punchTicks.`, `a` kept, input not mutated.
  - `foldTickPatches: nothing to fold → same object`.
  - `isTickKey / tickIdOf` — `isTickKey("punchTicks.123")` true; `"punchTicks"`, `"punchTicks."`, `"roughPunch"` false; `tickIdOf("punchTicks.123") === "123"`.
  - `slotWins` — no server slot → true; server ts newer → false; older → true; equal → true; server slot `{}` → true; our ts unparseable → true.
  - `mergeTickMaps` — per-id newer ts wins; ids on only one side kept; `undefined` sides tolerated.

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/dev/homestead-electric && node scripts/punch-ticks-test.js`
Expected: FAIL with `Cannot find module '../src/punchTicks.js'`.

- [ ] **Step 3: Implement `src/punchTicks.js`**

CommonJS with `"use strict"` and a header comment in the style of `src/sanitizeHtml.js`: why it exists (Miller #1788319922110, 2026-10-22 15:32:34Z), "copied to functions/punchTicks.js by scripts/punch-ticks-sync.js — edit this file only". Approach for the two non-trivial functions:
  - `punchTickPatches`: index both trees into `Map<id, item>` through one shared `walkTree(tree, cb)` (floors upper/main/basement + `extras[].key`; general, hotcheck, rooms[].items; skip falsy items and items without `id`); for every id present in BOTH maps whose `!!done` differs, emit the slot. `at` for an un-done slot and for a done item lacking `checkedAt` is `new Date(nowIso).toLocaleDateString("en-US")`. Done slot `by` falls back to `who`; `ts` falls back to `nowIso`.
  - `applyPunchTicks`: return the input at once unless `jobData.punchTicks` is a plain object with at least one VALID slot (`typeof done === "boolean"`). Rewrite items with a per-item function `resolve(item, slot)` returning the same item when nothing changes (done flag and the three stamps already equal the slot's), otherwise a copy; rewrite floors/trees/RT entries copy-on-write so unchanged branches keep identity; return the original `jobData` if no branch changed. `resolve`: if the item is done, has `checkedAtTs`, and `Date.parse(checkedAtTs) > Date.parse(slot.ts)` return it as is (newer tree tick); else set `done = slot.done`, and stamps from the slot when done / `""` when not. RT entries use the same `resolve`, looked up by `originItemId`.

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/punch-ticks-test.js`
Expected: every line `ok`, final line `punch-ticks-test: <n> checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/punchTicks.js scripts/punch-ticks-test.js
git commit -m "feat: punchTicks pure module (diff, overlay, fold) with unit gate (v559)"
```

---

### Task 2: Prebuild sync check for `functions/punchTicks.js`

**Files:**
- Create: `scripts/punch-ticks-sync.js`
- Create: `functions/punchTicks.js` (generated by `--write`)
- Modify: `package.json` ("prebuild" chain)

**Interfaces:**
- Consumes: `src/punchTicks.js` (Task 1).
- Produces: `node scripts/punch-ticks-sync.js` exits 0 when `functions/punchTicks.js` is byte-identical to `src/punchTicks.js`, exits 1 otherwise with the message `punch-ticks-sync: functions/punchTicks.js differs from src/punchTicks.js — run "node scripts/punch-ticks-sync.js --write" and commit it`. `--write` copies src → functions and exits 0. A missing target counts as differing.

- [ ] **Step 1: Show the failure first**

Run: `node scripts/punch-ticks-sync.js`
Expected: FAIL `Cannot find module` / file not found (script does not exist yet).

- [ ] **Step 2: Implement `scripts/punch-ticks-sync.js`**

Plain node, `fs.readFileSync` both files, compare buffers (`Buffer.equals`), behaviors exactly as in Interfaces. Header comment says why (CRA cannot import outside `src/`; `functions/` deploys only its own folder).

- [ ] **Step 3: Behavior check (the three states)**

Run in order:
```bash
node scripts/punch-ticks-sync.js            # expect exit 1, message above (target missing)
node scripts/punch-ticks-sync.js --write    # expect exit 0
node scripts/punch-ticks-sync.js            # expect exit 0
printf ' ' >> functions/punchTicks.js && node scripts/punch-ticks-sync.js; echo "exit=$?"   # expect exit=1
node scripts/punch-ticks-sync.js --write && node scripts/punch-ticks-sync.js && echo clean   # expect "clean"
```

- [ ] **Step 4: Chain it into `prebuild`**

In `package.json` insert `node scripts/punch-ticks-sync.js && ` immediately after `node scripts/version-from-sw.js && ` (before `tdz-scan`; the later `strategyprep-test.js` / `gcportal-test.js` require files that load `functions/punchTicks.js` from Task 5 on). Do not add the gate yet (Task 5).
Run: `node -e "console.log(require('./package.json').scripts.prebuild.split(' && ').slice(0,3).join('\n'))"`
Expected: first three entries are `node scripts/version-from-sw.js`, `node scripts/punch-ticks-sync.js`, `node scripts/tdz-scan.js --selftest`.

- [ ] **Step 5: Commit**

```bash
git add scripts/punch-ticks-sync.js functions/punchTicks.js package.json
git commit -m "build: prebuild check that functions/punchTicks.js equals src/punchTicks.js (v559)"
```

---

### Task 3: Gate sections for the client wiring (written red: Miller replay, merge slot branch, writer tripwires)

**Files:**
- Modify: `scripts/punch-ticks-test.js` (append sections above the final `console.log`)

**Interfaces:**
- Consumes: Task 1 exports; the REAL App.js text via `fs`/`vm` extraction (no App.js change in this task, so the new sections must FAIL).
- Produces: the executable definition of Task 4's wiring. Markers the extraction relies on (Task 4 must not move them):
  - merge: `// ── Three-way merge (Cougar Moon data-loss fix` … `// ── Stale-copy guards (Miller panel-loads rollback` (merge), `… // ── end Stale-copy guards` (guards).
  - `  const _mergePatchAgainstServer = (` … `  // Advance the three-way-merge baseline to EXACTLY`.
  - `u`: after `function JobDetail(`, from `\n  const u = patch => {` to `\n  // Simpro auto-pull: onBlur of Simpro #`.
  - `  const togglePunchItemDone = (jobId, phase, itemId) => {` … `\n  // Punch items assigned to the currently-active foreman`.
  - `  const handleSignOffRT = (jobId, rtId) => {` … `\n  const allTaskDueDates`.
  - `  const updateJob = (updated, patch) => {` … `  // ── Redline walks save / update / delete / add`.
  - `  const _advanceMergeBaseline = (` … `  const saveJob = (job, patch) => {`; saveJob head: `  const saveJob = (job, patch) => {` … `    // Always write to localStorage immediately`; CONVERGENCE: `// CONVERGENCE (2026-09-30, Miller panel-loads rollback)` … `} else if (accumulatedKeys.length > 0) {`.
  - `  const migrate = (loaded) => {` … `  // Real-time listener — all devices stay in sync automatically`.

- [ ] **Step 1: Add the extraction harness**

`body(start, end, from = 0)` returns `src.slice(a, b)` and throws a readable error naming the marker if either is missing (copy `slice()` from `scripts/panel-loads-merge-test.js`). Build one `vm` context with: `console`, the punchTicks exports (`isTickKey, tickIdOf, slotWins, mergeTickMaps, applyPunchTicks, punchTickPatches, foldTickPatches`), `serverBaselines = { current: {} }`, `_noBaselineWarned = new Set()`, `_scalarTelemetrySkip = new Set()`, `normalizeName = x => x`, `toast = { error() {} }`, and `normalizeJob = raw => applyPunchTicks({ roughPunch:{}, finishPunch:{}, qcPunch:{}, ...raw })`. Run `mergeSrc + guardSrc + mpSrc + "\nthis.merge = _mergePatchAgainstServer; this._threeWayMerge = _threeWayMerge; this.jobContentEquals = jobContentEquals; this.baselineAdvanceKeys = baselineAdvanceKeys;"`. Helpers: `commit(clientPatch, baseline)` sets `serverBaselines.current.J = baseline`, calls `merge("J","Miller", JSON.parse(JSON.stringify(clientPatch)), server.data, rescued)` and applies the returned `"data.<dotted path>"` writes into `server.data` with a nested-set `applyUpdate` (split on `.`, create intermediate objects, deep-clone the value); returns `{ wp, rescued }`.

- [ ] **Step 2: Add the replay sections (assertions)**

  - `MILLER 15:32: stale whole-tree save cannot un-tick a slot-backed item` — server tree `[X="1788319922110" open, Y open]`. Austin's patch = `{ roughPunch: A, ...punchTickPatches(base, A, "Austin", T1) }` committed with baseline = server (verbatim path). Then Keegan's stale phone (screen tree has X open) ticks Y: patch `{ roughPunch: B, ...punchTickPatches(screenTree, B, "Keegan Wilkinson", T2) }` committed with baseline = `JSON.parse(JSON.stringify(server.data))` (the failure: baseline fresher than the screen). Assert (a) mechanism: `byId(server.data.roughPunch, X).done === false` (the stored tree lost it, as in production); (b) `Object.keys(wp)` for Keegan's write contains `"data.punchTicks.<Y>"` and not any slot for X; (c) `applyPunchTicks(server.data).roughPunch` has X done with `checkedBy "Austin"` and Y done; (d) control: `applyPunchTicks({ ...server.data, punchTicks: undefined })` has X open (proves the overlay, not the merge, saved it); (e) `rescued.length === 0` for both writes.
  - `LATEST TAP WINS: a late slot with an older ts is dropped` (Review Focus 2) — server already holds `punchTicks[X] = { done:false, by:"Keegan Wilkinson", ts:T2 }` and tree X open; Austin's late replay patch carries `"punchTicks.X": { done:true, ts:T1 }` and a tree with X done. Assert `wp` has no `"data.punchTicks.X"` key, `rescued.length === 0`, overlay shows X open. Mirror: server slot ts T1, patch slot ts T3 → `wp["data.punchTicks.X"]` is written and overlay shows the patch's state.
  - `UN-CHECK STICKS` — tree X done (Ts T1), slot `{ done:false, ts:T3 }`: `applyPunchTicks` twice leaves X open with cleared stamps; adding a newer deliberate re-tick slot `{ done:true, ts: "…:34:00Z" }` makes it done.
  - `BURST: tick, untick, re-tick keeps one pending key` — `Object.assign({}, a, b, c)` of three `punchTickPatches` results for the same id keeps only the last slot (documents why `{...prevPending, ...patch}` in `saveJob` is enough).
  - `DOTTED KEY ROUND TRIP` (Review Focus 4) — a patch with `"punchTicks.7"` produces exactly `"data.punchTicks.7"` and never `"data.punchTicks"`; after `applyUpdate` the server doc has nested `punchTicks["7"]`; `jobContentEquals(jobA, jobB)` on two jobs with equal `punchTicks` is true and with different slot `ts` is false; with a literal `"punchTicks.7"` key on one side it returns a boolean without throwing; `baselineAdvanceKeys(prev, echo, local, normalizeJob)` returns an object whose own keys contain no `punchTicks.` prefix and whose `punchTicks` equals the echo's when local holds the same slots.
  - `LEGACY FULL SAVE: a whole punchTicks map is merged per id, never replaced` — `merge("J","Miller",{ punchTicks: clientMap }, server.data, [])` returns `"data.punchTicks"` equal to `mergeTickMaps(server.punchTicks, clientMap)` (server's newer slot survives, client-only ids kept).

- [ ] **Step 3: Add the writer tripwires and behavior checks**

  - Tripwire (one assertion per body, message names the writer): `u()`, `togglePunchItemDone`, `handleSignOffRT` bodies each contain `punchTickPatches(`; `updateJob` and `saveJob` heads each contain `foldTickPatches(`; `_advanceMergeBaseline` body contains `isTickKey(`; the CONVERGENCE block contains `foldTickPatches(`; `src` contains `const normalizeJob = (raw) => applyPunchTicks(_normalizeJobShape(raw));` and `const _normalizeJobShape = (raw) => ({`; the `migrate` body contains `normalizeJob(`; `src` contains `import PunchTicks from "./punchTicks";`.
  - Behavior, `togglePunchItemDone`: build it with `new Function("allJobs","identity","getIdentity","updateJob","punchTickPatches", tpSrc + "\nreturn togglePunchItemDone;")`. Job with `roughPunch` item "1" open and a linked RT entry. Toggle → `updateJob` called once; its `patch` keys are exactly `["punchTicks.1","roughPunch","returnTrips"]` (sorted compare), `patch["punchTicks.1"].done === true`; toggling again produces a `done:false` slot.
  - Behavior, `handleSignOffRT`: same technique with params `jobs, onUpdateJob, getIdentity, punchTickPatches`. RT `r1` with an open entry linked (`originItemId:"1"`, `originPhase:"rough"`) → `onUpdateJob("J", patch)` where `patch["punchTicks.1"].done === true` and `patch.roughPunch` item 1 is done.
  - Behavior, `u()`: `new Function("jobRef","setJob","onUpdate","identity","getIdentity","plBumpRev","plDiffIntent","PL_INTENT_KEY","punchTickPatches","foldTickPatches", uSrc + "\nreturn u;")`. `u({ roughPunch: next })` → `onUpdate` receives `(updated, finalPatch)` with `finalPatch["punchTicks.<id>"]` present, `updated.punchTicks[id].done === true`, and no key of `updated` starting `punchTicks.`; `u({ roughNotes: "x" })` adds no slot keys.

- [ ] **Step 4: Run to verify it fails for the right reasons**

Run: `node scripts/punch-ticks-test.js`
Expected: the Task 1 sections print `ok`; the first new section FAILS (MILLER: `byId(...)` assertion about slot keys or the harness throws `marker not found` for markers Task 4 creates). No false green.

- [ ] **Step 5: Commit (gate is not in `prebuild` yet, so nothing else breaks)**

```bash
git add scripts/punch-ticks-test.js
git commit -m "test: punch-ticks gate — Miller 15:32 replay, slot merge, writer tripwires (red until wired)"
```

---

### Task 4: Wire the client — writers, fold, normalizeJob, merge slot branch

**Files:**
- Modify: `src/App.js` (anchors below)

**Interfaces:**
- Consumes: `PunchTicks` default export of `src/punchTicks.js` (Task 1).
- Produces: patches carrying `"punchTicks.<id>"` keys from `u()`, `togglePunchItemDone`, `handleSignOffRT`; `normalizeJob` applies the overlay; `_mergePatchAgainstServer` slot branches.

- [ ] **Step 1: Import and destructure next to `SafeHtml`**

After `import SafeHtml from "./sanitizeHtml";` add `import PunchTicks from "./punchTicks";` and, after the `safeImageSrc` line in the sanitization block's neighbourhood (any module-scope spot above first use), `const { isTickKey, tickIdOf, slotWins, mergeTickMaps, punchTickPatches, applyPunchTicks, foldTickPatches } = PunchTicks;`.

- [ ] **Step 2: `normalizeJob` wrapper** (anchor `const normalizeJob = (raw) => ({`)

Rename the existing arrow to `const _normalizeJobShape = (raw) => ({ … })` (body untouched) and add directly after its closing `});`:
`const normalizeJob = (raw) => applyPunchTicks(_normalizeJobShape(raw));`

- [ ] **Step 3: `u()` diff** (anchor `function JobDetail(` → `  const u = patch => {`)

After the `panelizedLighting` block and before `const updated = {...jobRef.current, ...patchForJob};` compute `who = (getIdentity && getIdentity()?.name) || identity?.name || ""`, `nowIso = new Date().toISOString()`, and for each of `roughPunch`, `finishPunch`, `qcPunch` that is an own key of `finalPatch`, merge `punchTickPatches(jobRef.current[key], finalPatch[key], who, nowIso)` into one `tickPatch`. If non-empty: `finalPatch = { ...finalPatch, ...tickPatch }`. Change the local copy to `const updated = foldTickPatches({...jobRef.current, ...patchForJob}, tickPatch);` (the dotted keys ride `finalPatch` only, the same trick as `PL_INTENT_KEY`).

- [ ] **Step 4: `togglePunchItemDone`** (anchor `const togglePunchItemDone = (jobId, phase, itemId) => {`)

Before `updateJob({ ...job, ...patch }, patch);` add `Object.assign(patch, punchTickPatches(punch, newPunch, who, whenTs));` (`punch` is the pre-flip tree, `who`/`whenTs` already exist).

- [ ] **Step 5: `handleSignOffRT`** (anchor `const handleSignOffRT = (jobId, rtId) => {`)

Before `onUpdateJob(jobId, patch);` add `Object.assign(patch, punchTickPatches(job.roughPunch, nextRough, who, todayTs), punchTickPatches(job.finishPunch, nextFinish, who, todayTs));`.

- [ ] **Step 6: Fold in `updateJob` and `saveJob`** (anchors `const updateJob = (updated, patch) => {`, `const saveJob = (job, patch) => {`)

`updateJob`: first line `updated = foldTickPatches(updated, patch);` (parameter reassigned; `{...job, ...patch}` callers at `onUpdateJob` sites spread the dotted keys into `updated`, this strips them and puts the slot into `punchTicks` for `allJobs`/`selected`). `saveJob`: after the `initialLoad` guard add `job = foldTickPatches(job, patch);` so `hejobs_backup` and the create-whole fallback never carry a literal slot key (the replay paths call `saveJob(job, pendingPatch)` with a server-derived `job`).

- [ ] **Step 7: Slot branches in `_mergePatchAgainstServer`** (top of the `Object.entries(cleanPatch).forEach(([k, v]) => {` body)

```js
if (isTickKey(k)) {                                   // one punch check-off: latest tap wins, never baseline-merged, never "merged"
  if (slotWins(nServer.punchTicks && nServer.punchTicks[tickIdOf(k)], v)) writePatch["data." + k] = v;
  return;
}
if (k === "punchTicks") {                             // legacy no-patch full save only: per-id union inside the transaction
  writePatch["data.punchTicks"] = mergeTickMaps(nServer.punchTicks, v);
  return;
}
```
`rescuedKeys` is deliberately not touched.

- [ ] **Step 8: Keep literal slot keys out of the baseline and the re-seed**

`_advanceMergeBaseline`: in the `Object.keys(writtenPatch).forEach(pk => {` loop add `if (isTickKey(pk.slice(5))) return;` after the `data.` check. CONVERGENCE block in `saveJob` (anchor `const fields = {};`): when collecting `fields`, put keys where `isTickKey(pk.slice(5))` into a separate `tickWritten` object (`tickWritten[pk.slice(5)] = _writtenPatch[pk]`) and change `apply` to `(x) => foldTickPatches({ ...x, ...fields, ...stamp }, tickWritten)`.

- [ ] **Step 9: Run the gate and the repo checks**

Run: `node scripts/punch-ticks-test.js` → expected all `ok`, exit 0.
Run: `node scripts/tdz-scan.js && node scripts/panel-loads-merge-test.js && node scripts/pending-queue-test.js && node scripts/version-lock-test.js && node scripts/livesave-loop-test.js` → expected all pass (the merge/queue code they extract is the code you just edited).
Run: `grep -n "punchTicks\." src/App.js | grep -v "^[0-9]*: *//" | head -20` → expected only the intentional references (branch, tripwire strings in comments are fine); no `data.punchTicks` string built anywhere else.

- [ ] **Step 10: One-time live-path check (cheap, do not skip)**

Firestore field-path segments that are all digits: confirm with the emulator that `updateDoc(ref, { "data.punchTicks.1788319922110": {...} })` creates the nested map. If the emulator is unavailable, state so in the commit body and flag it to Koy; do NOT guess. (`scripts/rules-test/` already runs the emulator.)

- [ ] **Step 11: Commit**

```bash
git add src/App.js
git commit -m "feat: punch check-offs write per-item slots; overlay on read (v559)"
```

---

### Task 5: Cloud Functions readers + WATCH list (tests first), then gate into `prebuild`

**Files:**
- Modify: `scripts/punch-ticks-test.js`, `functions/strategyPrep.js`, `functions/gcPortal.js`, `functions/fridayPacket.js`, `functions/index.js`, `package.json`

**Interfaces:**
- Consumes: `functions/punchTicks.js` (Task 2) `applyPunchTicks`.
- Produces: every `done` reader sees the overlay; `punchTicks` in `onJobUpdate`'s `WATCH`.

- [ ] **Step 1: Append reader tests to the gate (must fail)**

Fixture `J`: `roughPunch` with items 1, 2, 3 all tree-open (item 3 `waiting:true`), `finishPunch` item 4 tree-DONE (`checkedAtTs` = Monday of the test week), `punchTicks: { "1": done slot, "4": { done:false, ts: later than its Ts } , "3": done slot }`.
  - `strategyPrep.openPunchCount(J) === 1` (item 2 only) and `waitingItems(J)` is empty (item 3 done by slot). Without `punchTicks` the same job gives 3 and 1.
  - `strategyPrep.lastWeekRows({ jobs:[J], live:[J], users:[], prevState:null, blocked:{cleared:[]}, today })` → `counts.punchClosed` counts items 1 and 3 (their slot `ts` is in the window) and NOT item 4. Use `process.env.TZ = "UTC"` like `scripts/strategyprep-test.js`.
  - `gcPortal.projectJobForPortal("J", J)`: `rough.punchOpen === 1`, `finish.punchOpen === 1`, `punch.rough.done === 2`; `JSON.stringify(view)` does NOT contain `"punchTicks"` (the allowlist wall holds).
  - Source tripwires: `functions/fridayPacket.js` text contains `applyPunchTicks(j)` before the `flatPunchWaiting(` calls; `functions/index.js` contains `require("./punchTicks.js")`, a `flatPunch` that calls `applyPunchTicks(`, and a WATCH array containing `"punchTicks"`.

Run: `node scripts/punch-ticks-test.js` → expected FAIL on the first reader assertion.

- [ ] **Step 2: `functions/strategyPrep.js`**

Add `const { applyPunchTicks } = require("./punchTicks.js");` under the existing `require`. In `openPunchCount(j)` and `waitingItems(j)` start with `const jt = applyPunchTicks(j);` and walk `jt[k]`. In `lastWeekRows` (the `all.forEach(j => {` loop, the `walkPunch(j[k], i => { if (i.done …punchClosed++` line) walk `applyPunchTicks(j)[k]`.

- [ ] **Step 3: `functions/gcPortal.js`**

Add the require. At the top of `projectJobForPortal(jobId, job)` after the null/archived guards: `job = applyPunchTicks(job);` (covers `punchOpenCount`, `qcItemsOf`, `punchView`, and the return-trip view that reads RT entries).

- [ ] **Step 4: `functions/fridayPacket.js`**

Dead path today (see reconciliation) but kept consistent: add the require, update the header's "no requires" line to say `./punchTicks.js` is the one pure exception, and in `buildModel`'s waiting-items block (anchor `const waiting = [...flatPunchWaiting(j.roughPunch)`) use `const jt = applyPunchTicks(j);` and `jt.roughPunch / jt.finishPunch / jt.qcPunch`.

- [ ] **Step 5: `functions/index.js`**

Add `const { applyPunchTicks } = require("./punchTicks.js");` next to the `gcPortal` require. In the punch-assignment block (anchor `const flatPunch = (j) => {`) start with `j = applyPunchTicks(j);`. In the version-snapshot block change `const WATCH = [` to include `"punchTicks"` (anchor `const WATCH = ["roughQuestions"`).

- [ ] **Step 6: Run the gate and the function suites**

Run: `node scripts/punch-ticks-test.js && node scripts/strategyprep-test.js && node scripts/gcportal-test.js && node scripts/gcnotify-test.js && node scripts/autodocs-test.js && node scripts/odash-model-test.js` → expected all pass.
Run: `node -e "require('./functions/gcPortal.js'); require('./functions/strategyPrep.js'); require('./functions/fridayPacket.js'); console.log('load ok')"` → `load ok`.
Run: `node --check functions/index.js` (syntax only; `index.js` needs live env to load) → no output.

- [ ] **Step 7: Put the gate in `prebuild`**

Append ` && node scripts/punch-ticks-test.js` to the END of the `prebuild` string in `package.json` (after `node scripts/livesave-loop-test.js`).
Run: `grep -c "punch-ticks-test.js" package.json` → `1`.

- [ ] **Step 8: Commit**

```bash
git add functions/ scripts/punch-ticks-test.js package.json
git commit -m "feat: functions readers apply punch tick overlay; punchTicks in versions WATCH; gate in prebuild (v559)"
```

---

### Task 6: Recovery tooling: `scripts/punch-versions.js` applies the overlay

**Files:**
- Modify: `scripts/punch-versions.js` (untracked; stays untracked, do NOT `git add` it)

**Interfaces:**
- Consumes: `functions/punchTicks.js` `applyPunchTicks`.
- Produces: `walkVersions(field, versions, current, liveTicks?)` where `liveTicks` is the live doc's `punchTicks`; each row's before/after trees are overlaid with the slot map as of that moment.

- [ ] **Step 1: Extend `selfTest()` first (fails)**

Fixture: versions as in the existing self-test plus `prev.punchTicks` on the later version only; live `punchTicks` with a done slot for item "1". Assert that the row where the stored tree shows item "1" un-ticked (the Miller shape) reports NO `unticked` entry once the overlay is applied, and the old call without `liveTicks` still reports it. Run `node scripts/punch-versions.js --self-test` → expected FAIL.

- [ ] **Step 2: Implement**

Require `../functions/punchTicks.js`. Slot map as of a moment = the version's own `prev.punchTicks`, else the first LATER version's `prev.punchTicks` (versions store only changed WATCH fields, so the map is unchanged between them), else `liveTicks`. In `walkVersions`, overlay `before` and `after` with `applyPunchTicks({ [field]: tree, punchTicks: map })[field]`; pass `job.data.punchTicks` from `report()`. Add to the header: "Slots (`data.punchTicks`) are overlaid when reporting; a PITR restore of a punch tree must restore `punchTicks` with it, or the older slots will overlay the restored tree. Nothing outside src/ and functions/ reads punch `done` directly except the standalone Scoreboard repo (percentages only, not patched)."

- [ ] **Step 3: Verify**

Run: `node scripts/punch-versions.js --self-test` → `punch-versions self-test: ok` (old assertions still pass).

---

### Task 7: Ship hygiene, full build, adversarial verification, hand-off

**Files:**
- Modify: `public/service-worker.js` (line 1), `FEATURES.md`
- Create: `docs/crew-briefs/v559.md`

- [ ] **Step 1: Version bump**

Line 1 of `public/service-worker.js` → `const CACHE = "homestead-v559";`. No other app version constant exists (`scripts/version-from-sw.js` bakes `REACT_APP_VERSION` from it).

- [ ] **Step 2: `FEATURES.md`**

Change the header line to `**Last manifest update:** 2026-10-22 · App SW version: v559` and insert the new entry as the FIRST bullet under the `---` (above the v558 bullet), same style: `- **Punch check-offs can't be un-done by someone else's stale phone** · \`shipped 2026-10-22\` · \`SW v559\` · …`. Body must carry: Koy's quote ("I feel like we've had to fix this problem several times."), the Miller #1788319922110 15:32:34Z mechanism (Keegan's phone un-ticked Austin's "Cut in floor outlets" 46 s after a `merged:true` save), the nine prior incidents, what changed (`data.punchTicks.<itemId>` slots written as dotted paths; overlay in `normalizeJob` and five Cloud Functions readers; `punchTicks` in the versions WATCH list; files `src/punchTicks.js`, `functions/punchTicks.js`, `scripts/punch-ticks-sync.js`, `scripts/punch-ticks-test.js`), the mixed-version window and the minBuild raise, the deploy line, and:
**Why it won't lose data:** the whole-tree write still happens unchanged, so every reader that ignores slots still converges; each slot is a dotted-path write to its own key, so no phone ever sends a copy of the map back and two phones ticking different items cannot collide; the offline queue, `he_pending_patches` mirror, replay and build stamp carry slots exactly like any other pending key; the overlay is read-only, idempotent and returns jobs without slots unchanged, so removing it returns the app to today's behavior; nothing in Firestore is migrated or deleted and `firestore.rules` is untouched.
Run `node scripts/version-from-sw.js` to confirm FEATURES.md mentions v559 (it fails the build otherwise).

- [ ] **Step 3: `docs/crew-briefs/v559.md`** (format of `docs/crew-briefs/v558.md`, `.claude/skills/crew-brief/`)

`APP UPDATE v559`, "Pull down to refresh and check Settings shows v559." (this ship specifically needs the refresh), a FIXES bullet in plain language: checking off a punch item is now saved on its own, so a check mark no longer disappears when another phone saves the same job (Keegan and Austin on Miller), un-checking still works the same, nothing looks different. Closing line "Send what you find to Koy: which screen, which job, what you expected."

- [ ] **Step 4: SOP guides**

Nothing visible changes (same screens, reports, GC portal), so no `public/sops/*.html` edit; say so in the commit body.

- [ ] **Step 5: Full gate**

Run: `cd ~/dev/homestead-electric && CI=true npm run build` (runs the whole `prebuild`, including sync check and the new gate). Expected: exit 0, "Compiled successfully", and the log contains `punch-ticks-test:` followed by a pass count. Do not pipe this command (exit status matters).

- [ ] **Step 6: Adversarial verification (standing rule)**

Dispatch a fresh read-only verifier with the diff and the spec, told to try to break these, and to report evidence not opinions: (1) a tick that shows on the phone but is absent server-side one second later (trace `u()` → `onUpdate` → `updateJob` → `saveJob` → transaction → `data.punchTicks.<id>`); (2) the overlay reviving a deliberate un-check (`slotWins`, equal-ts ties, clock skew between phones); (3) any punch write path that skips `punchTickPatches` (grep every `done:` writer and every `onUpdateJob`/`updateJob` caller that carries a punch tree); (4) literal `"punchTicks.<id>"` landing on a job object, baseline, `hejobs_backup`, or `he_pending_patches` shape consumers (`pending-queue-test.js`); (5) a screen or report that reads punch `done` from somewhere the overlay does not reach (known: the public homeowner punch share page reads the job doc directly around the `getDoc(doc(db,'jobs',jobId))` in the share component, a stated non-goal).

- [ ] **Step 7: Commit (local only)**

```bash
git add public/service-worker.js FEATURES.md docs/crew-briefs/v559.md src/App.js
git commit -m "chore: v559 ship hygiene — SW bump, FEATURES entry, crew brief"
```
(`src/App.js` appears because `version-from-sw.js` re-syncs `FEATURES_MD_INLINE` into it at build time; include it only if `git status` shows it modified.)

- [ ] **Step 8: Vault log (CLAUDE.md standing rule; the only Desktop touch)**

Write `~/Desktop/Command Center/Logs/2026-10-22 - Homestead Electric.md` (append if it exists) with `type: log` frontmatter and wikilinks to the Miller incident note and the version-lock decision. Write-only: do not read other Desktop files (iCloud reads hang). If the session cannot touch the Desktop, say so in the hand-off instead.

- [ ] **Step 9: Hand Koy the one-paste (do not run it)**

```bash
cd ~/dev/homestead-electric
git fetch origin && git merge-base --is-ancestor origin/main HEAD && echo "copy is current with main"   # CLAUDE.md: prove you are current before any deploy
git push origin main
firebase deploy --only hosting
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:onJobUpdate,functions:strategyPrep,functions:sendTestStrategyPrep,functions:gcPortalHealMirrors,functions:gcPortalCreateLink,functions:gcPortalCreateSuperLink,functions:gcPortalUpdateLink,functions:gcPortalSetRevoked,functions:gcPortalBackfill
```
Before handing it over, re-derive the gcPortal list with `awk '/^exports\.[A-Za-z0-9_]+ *=/{n=$1} /gcPortalRebuildMirror\(/ && !/^async function/{print n}' functions/index.js | sort -u` and add any export it prints that is missing above. Deploy hosting and functions in the same sitting (spec §4).
**Why it won't lose data (for the one-paste):** ticks are separate dotted-path writes; the whole-tree write is unchanged; the overlay is read-only; no migration, no rules change.
**Next morning (spec §4):** raise the lock so no old build can write: Settings → Devices → App Versions → "Require v559" (calls the admin-PIN callable `setMinBuild`; there is no shell command). Never raise it at deploy time, and if a rollback is ever needed lower it FIRST (comment above `exports.setMinBuild`).
**Verify live (positive proof):** on a test job, tick an item on one phone and open `jobs/<id>` in the Firebase console: `data.punchTicks.<itemId>` exists with `done:true`; un-tick it: `done:false` with a later `ts`; `jobs/<id>/versions` gains a snapshot whose `changed` includes `punchTicks`.

---

## Self-review

- **Spec coverage:** §1 storage → Tasks 1, 4; §2 write side (three writers, `saveJob` folding, merge slot branch) → Task 4 with tripwires and behavior tests in Task 3; §3 read side (`normalizeJob` / loader, five readers) → Tasks 4, 5; §4 mixed-version window + minBuild → Task 7 Step 9; §4b WATCH list + `punch-versions.js` → Tasks 5, 6; §5 gate items 1–6 → Tasks 1 (3 idempotence, 4 diff, 4c RT), 3 (1, 2, 3, 4b, 6); Constraints (SW, FEATURES, crew brief, vault log, subagent verification, deploy lines, no rules change) → Task 7.
- **Types:** `punchTickPatches` / `applyPunchTicks` / `foldTickPatches` / `slotWins` / `mergeTickMaps` / `isTickKey` / `tickIdOf` have one signature (Task 1) used identically in Tasks 3–6.
- **Order of tasks vs the request's list:** (1) module = Task 1, (2) sync = Task 2, (5) gate = Task 3 (red, written before the code it tests) + Task 5 Step 1, (3) wiring = Task 4, (4) readers = Task 5, recovery tooling = Task 6, (6) hygiene = Task 7.
