# My Day — the head owns every auto-task; Push delegates

**Date:** 2026-09-15 · **Status:** approved by Koy in conversation, awaiting spec review
**Builds on:** My Day v398 (one task object, `resi.head` hat), Needs Board spec

## Problem

Koy (2026-09-15): the My Day board "is flooded with tasks that don't really make sense
for the foremans." Cause: `computeTasks` produces ~30 rule families (invoice, PO, CO,
return trip, scheduling, QC, matterport, temp ped, punch) and stamps each row with the
job's foreman; `MyDay` shows a foreman every auto row that names them (`t.category !==
"prep" && sameName(t.foreman, me)`). Almost all of those rules are office work.

## Decisions (Koy, verbatim intent)

1. "all of them flow through me" — every auto-task lands on the Head of Residential.
2. "a button or option to push task to job foreman or pick a person to push it to" —
   delegation is explicit, per task.
3. Delegate marks Done → "it comes back to you to verify" (choice 2 of 2).
4. Foreman's "On Koy" section: "keep it but shrink it to a single collapsed line …
   they can open it and they can add to it easily there as well."
5. Approach chosen: **push creates a task doc, the board joins it back** (approach 1).

## Design

### 1. Who sees what

| Role | Mine |
|---|---|
| Head (`resi.head` holder via `resiHead(users)`) | all open auto-tasks on every live job (excluding `category:"prep"`, temp peds, quick jobs) ∪ task docs assigned to head ∪ punch items assigned to head ∪ stage duties (`getCoordinatorDuties` / `getCompanyDuties`) |
| Foreman | task docs assigned to them ∪ punch items assigned to them. **No auto rows.** |
| Lead / crew | unchanged |

Lanes unchanged: overdue → today → this week → later (`autoBucket`). Cleared / snoozed
auto-tasks keep using the job's existing `clearedTasks` list and `taskDueDates` map.

### 2. Push (delegation) and verify

**Control** on every head auto row: `→ <job foreman>` (one tap; hidden when the job has
no foreman or the foreman is the head) and `Pick person…` (same roster picker as
Quick-add's **To:**).

**Write:** one `needs` doc through the existing `saveNeed` funnel:

```
kind: "task", title: t.title, desc: t.desc, jobId: t.jobId, foreman: job.foreman,
dueDate: t.dueDate (or the job's taskDueDates[t.id] override), dueBucket: derived,
assignedTo: <person>, assignedBy: <head>, assignedAt: now, status: "open",
autoTaskId: t.id            // NEW, additive, inside data
```

Only `autoTaskId` is new. It lives inside `data`, so the needs loader returns it verbatim.

**Join (derived, never stored):** `autoDelegation(needs) → Map<autoTaskId, doc>` picking,
per auto-task id, the most recent doc (open first, else the most recently done). The
head's row renders from that:

| Doc state | Head row |
|---|---|
| none | normal row + Push control |
| open, assigned to X | muted "with X · <age>"; buttons **Take back** (closes the doc: status done, doneBy head — review-round ruling; an open doc assigned to the head also reads as none), **Re-push** (picker) |
| done by X (status done, doneBy ≠ head) | "done by X · <age> · verify"; buttons **Done** (existing clear → `clearedTasks`; the doc is already done, nothing else written), **Send back** (reopen doc: status open, assignedTo X, note) |
| done by head | treated as none (the auto row already cleared through `clearedTasks`) |

**Guard:** one open doc per `autoTaskId`. Pushing while a doc is open PATCHES that doc's
`assignedTo/assignedBy/assignedAt` instead of creating a second.

**Delegate's side:** the doc is an ordinary task in Mine (title, job tag, due). Done /
Snooze / Undo as today. Nothing new to learn.

**Cross-effects:**
- Head clears an auto-task (Done) while a doc is open → the doc is closed too
  (`status: done, doneBy: head, doneAt`), so it leaves the delegate's board.
- Head snoozes the auto row → the doc is NOT touched (delegate keeps their date).
- Take back closes the delegate's doc (doneBy = head), so it leaves their board; no push fires (creator = head).
- Job state resolves the task (rule stops firing) → head row disappears; the open doc
  stays on the delegate until they close it (they did the work; it is their record).
- Job foreman changes after a push → doc stays with the person it was pushed to.

### 3. Folding duplicates

Two engines describe the same work. The head board keeps the **duty** row (it has
`markField` + `targetTab`) and hides the task-engine twin when a duty exists for the same
job + phase:

| Task-engine rule | Duty | Key |
|---|---|---|
| "Schedule QC Walk" / "Schedule Final QC Walk" | `coord_rough_qc` / `coord_finish_qc` | jobId + phase |
| "Order Job Start PO" (rough / finish) | `coord_rough_po` / `coord_finish_po` | jobId + phase |

Pure helper `foldDutyTwins(autoRows, dutyRows)`; neither engine changes.

### 4. Foreman's "On Koy" section

One collapsed line per job with anything on the head: **"Koy has N things on this job"**
(name from `resiHeadName(users)`). Tap → the read-only rows (task docs on head for that
job + head's auto rows for that job + duties, deduped as above) plus **+ Add for Koy**,
which opens `NeedQuickAdd` with `jobId` and **To:** = head prefilled. Jobs with nothing on
the head show no line. Collapsed state is local (`useState`), starts collapsed.

### 5. Notifications

One new branch in the existing `onNeedWrite` trigger (needs `firebase deploy --only functions:onNeedWrite`): a done→open flip by someone other than the assignee sends `need_assigned` "Task sent back" — without it Send back had no signal. Push → existing `need_assigned` (onNeedWrite diffs `assignedTo`).
Delegate Done → existing `need_done` to the creator (`assignedBy` = head). Take back /
Send back are reassignments → `need_assigned` again. Cloud Functions: that one branch only.

### 6. Testing (prebuild gate, `scripts/needs-dryrun.js`)

Extract the shipped helpers via `vm` and add cases:
1. foreman identity → zero auto rows; task docs + punch only
2. head identity → every non-prep auto row across all live jobs
3. `foldDutyTwins` hides QC / start-PO task rows when the duty exists; keeps them otherwise
4. push builds exactly one doc with `autoTaskId`; fields as in §2
5. second push with an open doc → patch (reassign), not a second doc
6. done-by-delegate → head row state `verify`; done-by-head → state `none`
7. head Done with an open doc → doc closed with `doneBy` = head
8. "On Koy" line count per job = task docs + auto rows + duties, deduped

### 7. Deploy hygiene

- SW bump (main is at v407 after today's GC Portal ships — merge `origin/main` into the
  worktree branch first, then bump to v408).
- FEATURES.md entry (build gate), guides `public/sops/myday.html` + `needs.html`.
- No Firestore rules change. No loader change (`autoTaskId` is inside `data`).
- **Data safety:** one additive field on task docs; auto-task state keeps the existing
  `clearedTasks` / `taskDueDates` whole-map precedents; foremen lose ROWS only; nothing
  deleted or renamed; the only new job write is the existing Done/Snooze path.

## Out of scope

Changing any `computeTasks` rule; per-foreman opt-in of auto rows; bulk push; assigning
duties (they stay head-only, read-only elsewhere).
