# Design — Redline Walk milestones in the Job Prep tab

**Date:** 2026-08-29
**Author:** Koy + Claude (brainstormed)
**Area:** Job Prep tab (`JobPrepTracker` / `JobPrepPrepRow`) ↔ redline walks (`redlineWalks`)
**Status:** design — pending Koy review, then implementation plan

## Goal

Koy's redline flow: **he does the redline walk → cleans the plans → hands off to Jeromy for the
updated quote/CO.** Today the Job Prep tab's Pre-Job Prep lane tracks the *output* of that flow
("Redline Plans Up to Date") but not the two milestones in front of it — **Walk Scheduled** (with a
date) and **Walk Completed**. Add those two milestones to the Pre-Job Prep lane, backed by the
**same** `redlineWalks` record the Change Orders board already uses, so a walk edited in prep shows
on the CO board and vice versa.

## Decisions (locked with Koy)

- **Approach A — walk strip** at the front of each Pre-Job Prep row (not new checklist chips, not
  read-only).
- **Date: display-only** — Koy sets/edits the walk date; it shows on the card; **no reminders/nudges**.
- **Sync with redline/CO records** — the strip reads and writes the shared `redlineWalks` record
  (linked by `jobId`), through the existing `onAddRedline` / `onUpdateRedline` handlers. No new field,
  no new collection, no migration.
- **Visible tracking only — no new gates.** The walk strip never affects `allPrepChecked` /
  `prepClearedToStart`. "Redline Plans Up to Date" + the existing 5 items stay the completion gate.

## Data model (reuse, unchanged)

`redlineWalks/<walkId>` = `{ data: <walk>, updated_at }`, walk shape from `newRedlineWalk` (App.js
~L2083). Fields this feature touches:

- `jobId` — link to the job (already optional on the record; we set it on create).
- `address` — display name; set to `job.name` on create.
- `walkDate` (YYYY-MM-DD) — **the scheduled walk date** shown/edited in the strip (this is the same
  date field the CO card edits, per the v365 "walk date stays editable" note).
- `status` — REDLINE_STATUSES lifecycle: `scheduled` → `plans_prep` (**Walk Done — Cleaning Plans**)
  → `co_owed` → `co_sent` → `signed`.
- `walkedBy` / `walkedByUid` — set from identity on create.

**Milestone mapping:**
- **Walk Scheduled** = record exists with `status: "scheduled"` and a `walkDate`.
- **Walk Completed** = advance `status` `scheduled → plans_prep` (Koy's "walk done, now cleaning plans").
- `co_owed` and beyond = **Jeromy's territory** → the strip shows it as a read-only tail, not editable
  from prep.

## The "active walk" selector (new pure helper)

A job can have multiple `redlineWalks` (repeat redline events). The strip shows **one** — the active one:

```
activeRedlineWalk(job, redlineWalks):
  candidates = redlineWalks.filter(w => w.jobId === job.id)
  if none → null                       // strip shows "＋ Schedule Redline Walk"
  open = candidates.filter(w => w.status !== "signed" && !w.coQuoteNumber)
  pool = open.length ? open : candidates
  return pool sorted by (walkDate || createdAt) desc → [0]
```

Managing multiple walks stays on the CO board; prep surfaces the newest open one.

## UI — the walk strip (in `JobPrepPrepRow`)

A compact sub-row rendered **below the checklist chips** (same slot pattern as the existing "NEXT:"
line), inside the row's middle column. Three visual states:

1. **No walk record** → a small ghost button **`＋ Schedule Redline Walk`**. Tap → `onAddRedline({ jobId,
   address: job.name, status: "scheduled", walkDate: <today> })`. (Snapshot refresh re-renders the row
   into state 2.)
2. **`status === "scheduled"`** → `REDLINE WALK` label · an inline **date input** bound to `walkDate`
   (edit → `onUpdateRedline({ ...walk, walkDate })`) · a **`WALK DONE`** action (→ `onUpdateRedline({
   ...walk, status: "plans_prep" })`). Color: RL purple (`#6A5E97`) to match the CO board's walk chip.
3. **`status` past scheduled** →
   - `plans_prep` → **`✓ WALK DONE — CLEANING PLANS`** chip + walkDate shown; a small **↩** reverts to
     `scheduled` (in case of a misclick). This stage is still Koy's, so keep it reversible here.
   - `co_owed` / `co_sent` / `signed` → **read-only tail** using the REDLINE_STATUSES label + color
     ("Walk Done — CO Owed" / "Redline CO Sent" / "CO Signed") — with Jeromy's quote # if present. No
     edit controls in prep for these.

`onUpdateRedline` receives the **whole** live walk object spread with the change (`{ ...walk, ... }`),
matching the CO board's clobber-safe whole-doc write pattern; `walk` comes from the freshest
`redlineWalks` snapshot prop.

## Component / wiring changes

1. **`JobPrepTracker`** (App.js ~L49123, rendered ~L55903): add props `redlineWalks`, `onAddRedline`,
   `onUpdateRedline`. At the render site these are already in scope (`redlineWalks`, `addRedlineWalk`,
   `updateRedlineWalk` — passed to `ChangeOrderTracker` just above at ~L55882). Build a
   `walksByJob` Map (jobId → active walk) once via `activeRedlineWalk`, memoized on `[jobs, redlineWalks]`.
2. **`JobPrepPrepRow`** (App.js ~L48954): accept `walk`, `onAddRedline`, `onUpdateRedline`; render the
   walk strip below the chips per the states above. Pass `walk={walksByJob.get(j.id)||null}` at each of
   the three call sites (held / override-cleared / done strips).
3. **`activeRedlineWalk`** — new module-level pure helper near the other redline helpers.
4. No change to `JobPrepAdminRow`, the CO board, the handlers, or any gate function.

## Out of scope (v1)

- The job **drawer's** Pre-Job Prep section (`Section label="Pre-Job Prep"`, ~L28834) — tab only for
  now (confirm if Koy wants the strip there too).
- **Reminders/nudges** on the walk date — explicitly excluded ("display only").
- Creating/managing **multiple** walks per job from prep — that stays on the CO board.
- Cloud Functions — `redlineWalks` is read by no function/nudge; nothing server-side changes.

## Error handling & edge cases

- Create/update failures already `console.error` inside `saveRedlineWalk`; the strip stays optimistic
  via `setRedlineWalks` (existing behavior). No new error surface.
- A walk whose `jobId` points at a job not in the prep universe simply never appears in prep (still on
  the CO board) — no orphan.
- A job already past `signed`/quoted shows the read-only tail; `＋ Schedule` still available only when
  **no** record exists (repeat walks are created from the CO board to avoid accidental dupes in prep).

## Data safety

Additive UI over an existing collection. Writes go through the **same** `onAddRedline`/`onUpdateRedline`
whole-doc `setDoc` the CO board uses — no new field, no new collection, no shape change, no migration.
The only invariant deliberately changed: `redlineWalks` was previously read only in the CO tab; it is
now also read in the Job Prep tab (a read, plus writes through the existing funnel). No Cloud Function,
nudge, scoreboard, or report reads the collection, so no server behavior changes.

## Testing (manual, live — repo has no suite)

1. Prep job with no walk → `＋ Schedule Redline Walk` → record appears on the CO board's Walk Scheduled
   column with the job linked.
2. Set/edit the date in prep → same `walkDate` shows on the CO card; edit on the CO card → prep updates.
3. `WALK DONE` in prep → CO board card moves to "Cleaning Plans" (`plans_prep`); `↩` reverts.
4. Advance to `co_owed`+ on the CO board → prep shows the read-only tail, no edit controls.
5. Prep completion gate unaffected: a job with a scheduled-but-not-done walk still clears/holds purely on
   the 5 checklist items + override.

## Ship hygiene (at implementation, not now)

- SW cache bump + FEATURES.md App-map entry (prebuild gate).
- `public/sops/jobprep.html` guide line about the walk strip (standing "guides track the app" rule).
- `CI=true npm run build` green before handoff.
