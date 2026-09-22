# Task updates and "waiting on" (My Day) — design

**Status:** Built 2026-09-21, SW v421, awaiting Koy's push + `onNeedWrite` deploy
**Owner:** Koy · **Mockup:** `taskupdates-mockup.html` (repo root)
**Related:** My Day v398, head task loop v408, `needs` docs, `onNeedWrite`

## Problem (Koy, 2026-09-21)

> "we need to be able to either start a discussion or add a note to tasks assigned to us,
> i dont want them to think im ignoring request if i myself am waiting to hear back from
> someone."

A task doc could only be open, snoozed, or done, and snooze was silent. To the requester,
snoozed and ignored looked identical. The loop only signalled assigned / done / sent back.

## Design

**Updates, not chat.** Every real task doc gets a note button on both sides. The panel has
two presets: **Note** (one-liner) and **Waiting on…** (who/what + optional **Back on**
date). Each entry is `{by, at, kind: note|waiting, text, until?}`.

- Latest entry shows under the task on both sides (orange for waiting, `· back M/D`);
  tap for the full history.
- Assignee's waiting-with-date also snoozes the row. Any entry from the other side
  clears the snooze so the reply is seen.
- The other side gets a push (`need_update`: "Task on hold" / "Task update"), deep-linked
  to My Day. Audience = the other side of the task, never the author: assignee posts →
  requester (`assignedBy`, else `createdBy`); anyone else → assignee.
- **Sent** group (new, folded by default, `N waiting` badge): not-done docs I asked for
  that sit on someone else. The requester's views (On <head>, Sent) include snoozed docs
  so a task on hold stays visible with its reason; a snoozed task with no update shows
  `on hold · back M/D`.
- Needs board cards show the latest line.

## Data

- `updates` is an additive array inside `data`; appended with `arrayUnion` (never a
  whole-array write). Only other field touched: `snoozedUntil` (existing), via dotted
  `data.*` paths. No loader change, no rules change. Pre-v421 docs read as before.
- Auto rows on the head's board are not docs until pushed, so they get updates only once
  pushed. Punch items are a separate object; not in this pass.

## Code

`needUpdates` / `lastNeedUpdate` / `needRequester` / `needUpdateAudience` /
`needUpdateLine` / `sentByMe` (top-level pure fns, harness §15) · `addNeedUpdate` (app
root, next to `patchNeed`) · `MyDay` row panel + Sent group · `NeedsBoard` latest line ·
`NOTIF_CATEGORIES` `need_update` · `onNeedWrite` branch 4 · guide `myday.html` steps 5–6.
