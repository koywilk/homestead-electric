# Punch check-offs as per-item slots — design (2026-10-22)

**Status:** approved in chat by Koy 2026-10-22 ("I like that. Go ahead."). Builds today, Koy pushes.

## Intent and the why

A punch check-off on a phone is saved today by re-sending the WHOLE punch tree
(`roughPunch` / `finishPunch` / `qcPunch`) from that phone's copy, then a client-side
three-way merge decides whose copy wins. That merge depends on a per-phone "baseline"
staying in step with the on-screen copy, and it has failed at least nine times since
July (Cougar Moon, Kweller ×3, Home Runs refresh, Miller ×3, and today: Miller
#1788319922110, 15:32:34Z, Keegan's phone un-ticked Austin's "Cut in floor outlets"
46 s after a `merged:true` save — baseline moved to the merged copy, screen did not).

Koy: "I feel like we've had to fix this problem several times." The check-off is what
bites the crew. This design makes the check-off itself impossible to lose to a stale
whole-tree save, without changing how the punch list is stored or shown.

## Goals

- A check or un-check made on any phone survives every other phone's whole-tree save,
  always, with no baseline bookkeeping involved.
- Two phones ticking different items never collide. Same item: latest tap wins.
- Nothing visible changes: same screens, same reports, same GC portal view.
- Offline, version-lock stamp, pending-queue replay and the reconnect flush keep
  working for ticks exactly as for any other save.
- Reversible: removing the read-side overlay returns the app to today's behaviour.

## Non-goals

- Adds, edits, renames, moves, voids and deletes of punch items still ride the
  whole-tree merge (far rarer losses; the per-item re-storage on Koy's task card is
  the eventual answer).
- Return-trip punch (`returnTrips[].punch`), CO task checks (`changeOrders[].taskChecks`),
  4-way inspection items and the public share pages are untouched.
- No migration of stored data.

## Anti-goals (what would make this a failure)

- A tick that shows on the phone but is not on the server a second later.
- The overlay reviving a check that someone deliberately un-checked.
- Any screen or report disagreeing with the punch list a phone shows.
- A new write path that bypasses the save queue (offline loss) or the build stamp.

## The design

### 1. Storage: `data.punchTicks` — one slot per item id

```
data.punchTicks: {
  "<itemId>": { done: true|false, by: "Keegan Wilkinson", at: "10/22/2026", ts: "2026-10-22T15:31:48.355Z" }
}
```

Written ONLY with Firestore dotted field paths (`data.punchTicks.<itemId>`), never as
a whole map, so the server merges slot by slot and no client copy of the map is ever
sent back. Item ids are the existing `uid()` strings (digits only) — safe as map keys.

### 2. Write side: a pure helper at every writer (builder check, 2026-10-22)

Not every flip goes through `JobDetail.u()`: `togglePunchItemDone` (My Day Done button,
its Undo, the foreman Assigned tab → `updateJob` → `saveJob`) and `handleSignOffRT`
(return-trip sign-off cascade → `onUpdateJob`) write punch trees on their own. So the
diff is a MODULE-LEVEL pure helper, `punchTickPatches(prevTree, nextTree, who, nowIso)`
(in `src/punchTicks.js`), returning `{ "punchTicks.<itemId>": slot }` for every item
whose `done` differs between the tree the writer started from and the tree it is
sending. It is called at the three writers — `u()` (prev = `jobRef.current[key]`),
`togglePunchItemDone` (prev = the job before the flip), `handleSignOffRT` (prev = the
job before the cascade) — and the prebuild gate greps that each of those three bodies
contains `punchTickPatches(` (tripwire for a future bypasser). "What this writer
changed" is the only honest source: diffing against a per-job "last seen" tree in
`saveJob` would, in the exact race this fixes, emit slots for items the writer never
touched.

A done slot carries the item's own stamp (`by/at/ts` = `checkedBy/checkedAt/checkedAtTs`);
an un-done slot carries `done:false` plus who un-ticked and when (`by/at/ts`), for
forensics only — the overlay clears the item's three stamps on `done:false`, matching
the app's convention (`toggleItem`, `togglePunchItemDone`).

The local job state gets the slot folded into `job.punchTicks` (same trick as
`PL_INTENT_KEY`: the dotted key rides the patch to `saveJob`, never lands on the job
object as a literal key); `saveJob` does the folding for the two writers outside `u()`.

The whole-tree write still happens (it carries done too, so readers that never see
slots converge). The slot is the authority on read.

`saveJob` / `flushJob` / `flushSaves` already write `"data." + key` per pending key, so
`punchTicks.<id>` becomes `data.punchTicks.<id>` with no change to the queue, the
durable mirror (`he_pending_patches`), the replay, or the version-lock stamp.

In `_mergePatchAgainstServer`, a key starting with `punchTicks.` is a slot write:
compare against the server's existing slot (`nServer.punchTicks[id]`); if the server's
`ts` is newer than ours, keep the server's (latest tap wins); otherwise write ours.
Never baseline-merged, never flagged `merged`.

### 3. Read side: `applyPunchTicks(job)` — pure, shared, idempotent

For each of the three trees, for every item with an id that has a slot: set `done`
from the slot; when the slot is done, copy `checkedBy/checkedAt/checkedAtTs` from it,
when un-done clear all three. One exception, for the mixed-version window: a tree item
that is done with a `checkedAtTs` NEWER than the slot's `ts` keeps the tree (an older
build ticked it after the last slot). Linked return-trip entries
(`returnTrips[].punch[].originItemId` with a slot) take the same `done` and stamps, so
the Return Trip screen cannot disagree with the punch list. Pure and idempotent.

Applied in exactly these places so every reader sees the same list:
- the jobs listener's `loaded` mapping (feeds `allJobs`: cards, Scoreboard, Huddle,
  Today, packets built in-app, `hejobs_backup`);
- `normalizeJob` (JobDetail adoption, `refreshJob`, baseline recorder);
- the five server-side readers that look at `done`: `functions/strategyPrep.js`
  (`openPunchCount`, `waitingItems`, `punchClosed`), `functions/gcPortal.js`
  (`punchOpenCount`, `punchView`, `qcItemsOf`), `functions/fridayPacket.js`
  (`flatPunchWaiting`), `functions/index.js` line ~1484 (whatever it counts), and the
  tripwire counts (unchanged — they count items, not done).

The helper lives in `src/punchTicks.js` (CommonJS, like `src/sanitizeHtml.js`) and is
copied to `functions/punchTicks.js` by a prebuild step that refuses to build if the
two differ (CRA cannot import outside `src/`; `functions/` deploys only its own folder).

### 4. Mixed-version window (old phones still on v558 or earlier)

An old build flips only through the tree. A tree TICK newer than the slot wins (above);
a tree UN-TICK by an old build on an item that has a slot is reverted on read until that
phone updates. Decision: accept the window (hours, not days: the app refreshes on next
open), ship hosting + functions together, and the crew brief says to refresh; Koy
raises `appGate/version.minBuild` to 559 the next morning (one-paste includes the
command) so no old build can write after that.

### 4b. Recovery tooling (builder check)

`punchTicks` joins the `onJobUpdate` versions WATCH list so every tick keeps a
before-copy with who saved it (25 kept, tiny docs). `scripts/punch-versions.js` applies
the overlay when it reports, and its header notes that a PITR restore of a punch tree
must restore `punchTicks` with it. Nothing outside `src/` and `functions/` reads punch
`done` from Firestore directly except the standalone Scoreboard repo (percentages only;
documented, not patched).

### 5. Gate: `scripts/punch-ticks-test.js` (prebuild)

Extracts the real `applyPunchTicks`, the real `_threeWayMerge` + `_mergePatchAgainstServer`
slot branch and the `u()` diff helper, and replays:
1. **Miller 15:32** — phone A ticks X (slot + tree), phone B's stale tree write lacks X →
   after `applyPunchTicks` on the server doc, X is done. Old code: X lost.
2. **Latest tap wins** — A ticks X at t1, B un-ticks X at t2 > t1, A's slot write arrives
   late → server keeps B's.
3. **Un-check sticks** — un-tick writes a `done:false` slot; overlay does not revive it.
4. **Diff helper** — only items whose `done` changed get slots; adds/renames/voids get none;
   un-done slot clears the item's stamps; newer tree tick beats an older slot.
4b. **Writers** — the bodies of `u()`, `togglePunchItemDone` and `handleSignOffRT` in
   `src/App.js` each contain `punchTickPatches(` (grep tripwire).
4c. **Linked RT entries** follow the origin item's slot.
5. **Idempotent + no slot = tree as is** — jobs with no `punchTicks` are byte-identical.
6. **Dotted key round trip** — pending key `punchTicks.<id>` → `data.punchTicks.<id>`;
   `jobContentEquals` / `baselineAdvanceKeys` ignore nothing and never throw on it.

## Constraints (Koy's standing rules)

Same-ship hygiene: `public/service-worker.js` → v559, FEATURES.md entry with a
specific "why it won't lose data", crew brief `docs/crew-briefs/v559.md`, vault log,
adversarial subagent verification, `CI=true npm run build` green, Koy pushes and runs
`firebase deploy --only hosting` plus a functions deploy for the three readers
(`FUNCTIONS_DISCOVERY_TIMEOUT=120`). No change to `firestore.rules` (the jobs rule only
requires `data` map + `updated_at` string, both kept by a dotted update).

## Left to the builder

- Prebuild sync script name and failure message.
- Exact slot folding in `saveJob` for writers outside `u()`.
