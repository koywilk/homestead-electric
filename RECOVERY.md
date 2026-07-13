# Data Recovery Runbook — Homestead Electric

**If you think data was lost or overwritten, act within 7 days.** The Firestore
database (`homestead-electric`, Blaze tier) has **Point-In-Time Recovery ENABLED
with a 7-day retention window.** Any document can be read as it existed at any
minute in the last 7 days. After 7 days that history is gone — so recovery is
time-sensitive.

> **The one hard limit:** PITR only recovers what was actually **written** to the
> database. A save that silently no-op'd (the July 2026 Kweller thread bug) was
> never written, so PITR cannot bring it back. If in doubt, try anyway — reading
> is free and non-destructive.

The longer-horizon nets (beyond 7 days), newest → oldest reach:
- **Recovery ledger** — `recovery_ledger` (per-doc pre-images, 90-day TTL). See below.
- **Nightly JSON backup** (`nightlyFirestoreBackup`, v313) — gzipped whole-collection
  dumps in Storage `backups/`, 30-day retention. Banner turns red if
  `settings/backupStatus` is missing or >48h stale.
- **Native Firestore backups (Google-managed)** — a **daily** schedule (20-day
  retention) and a **weekly** schedule (98-day / 14-week retention, added
  2026-07-13). These restore to a **fresh database instance**, not in place:
  `firebase firestore:backups:list`, then `firebase firestore:databases:restore`.
  They cannot silently fail-to-deploy the way app code can — list them anytime with
  `firebase firestore:backups:schedules:list`.

### Recovery ledger — the delete/overwrite net (fastest for a *deleted* doc)

Before today, a **hard-deleted** doc (job, manualTask, need, quoteWalk, redlineWalk,
suggestion) had **no app-layer capture at all** — `onJobUpdate` never fires on delete,
and the per-field `jobs/versions` snapshots are update-only. The `recovery_ledger`
(added 2026-07-13) closes that. A per-collection `onWrite` trigger writes the full
prior document image to `recovery_ledger` on every **delete** (and on **updates** for
the small per-item collections + `homeowner_requests`) as
`{key:"coll|docId", coll, docId, op, at, savedBy, device, before{}}`, kept 90 days.

**One-call restore** (undo the newest delete/overwrite of a doc):

```js
// from the app (admin/manager), or any admin-SDK script:
firebase.functions().httpsCallable('restoreFromLedger')({
  _appKey: APP_CALL_KEY,   // the app's httpsCallable wrapper injects this — see APP_CALL_KEY in src/App.js
  coll: 'jobs', docId: '<JOB_ID>'
  // optional: at: '<exact ledger .at ISO>' to restore a specific version
});
```

It re-`set`s the doc from the newest ledger `before` image. To browse what's available
first, read `recovery_ledger where key == "jobs|<JOB_ID>"` in the console. Ledger writes
are admin-only (the firestore.rules catch-all denies clients), so use the console or the
callable — never a client write.

**Per-field version snapshots (fastest surgical restore).** Two subcollections now
hold prior copies of the loss-prone fields, independent of PITR's 7-day window:
- `homeowner_requests/{jobId}/versions/*` — snapshotted before every funnel write
  (link answers, acks, plan-change threads, lighting collab). Kept newest ~10.
- `jobs/{jobId}/versions/*` — the `onJobUpdate` trigger stashes the PRIOR value of
  any changed high-value field (`roughQuestions`, `finishQuestions`, the punch
  trees, `changeOrders`, `designerQuestions`) as `{at, savedBy, device, changed[],
  prev{}}`. Kept newest ~25 per job (HD2, 2026-07-13). Admin/console read only.
Read these FIRST when a specific field was clobbered — they're smaller and more
targeted than a whole-doc PITR read, and reach back further than 7 days.

---

## Step 1 — Get an admin key (only you can do this; ~2 min)

Reading the past requires an admin credential; the app's normal login can't do it.

1. **console.firebase.google.com** → open the **homestead-electric** project.
2. Gear → **Project settings** → **Service accounts** tab.
3. **Generate new private key** → **Generate key**. A `.json` downloads.
4. Move it **outside this repo** (e.g. `~/Desktop/he-admin-key.json`) so it can
   never be committed to git.

This key is full admin access — treat it like a master password. **Delete the
file and revoke the key (same screen) as soon as you're done** (Step 5).

## Step 2 — Read the lost document at a past time (READ-ONLY)

```
node scripts/pitr-recover.js \
  --key ~/Desktop/he-admin-key.json \
  --doc jobs/<JOB_ID> \
  --at 2026-07-09T14:00:00Z \
  --diff --out /tmp/snapshot.json
```

- `--at` is **UTC**. Mountain Time is UTC-6 in summer, so **8:00 AM MT = 14:00:00Z**.
- `--diff` prints which top-level fields differ between that snapshot and now.
- `--find "<name>"` deep-searches the snapshot for a string (e.g. a person's name)
  and prints every path it appears at — handy for locating specific content.
- `--out` saves the full document so you can inspect it offline.

Read at a few different times (e.g. 8am, noon, just before the suspected wipe) and
compare — the freshest pre-loss snapshot has the most.

## Step 3 — Extract ONLY the lost fields

Open the saved JSON and pull out exactly the fields that were lost (e.g. a
question's `answer`, a punch floor's items). Do **not** plan to write back the
whole document.

## Step 4 — Surgical merge-back (bespoke, reviewed, never automated)

**Never overwrite the whole document** — that reverts everything legitimately
changed since the loss. Instead, write a small one-off script that:

1. Reads the **current** live doc.
2. Sets back **only** the specific lost fields (matched by id — question id,
   punch item id, etc.), leaving every other current value untouched.
3. Uses a `runTransaction` so a concurrent edit is merged against, not clobbered.
4. Prints a before/after diff of exactly what it will change, and is run only
   after you've reviewed that diff.

Recipient-writable data (questions, homeowner_requests) must go back onto its
safe home (`homeowner_requests`), **never** onto `jobs/{id}` — see
`~/Desktop/Command Center` link-safety conventions.

## Step 5 — Clean up the credential

- Delete the key file (`rm ~/Desktop/he-admin-key.json`).
- In the Firebase console → Service accounts → **revoke** the key you generated.

---

## Worked example — Kweller questions (2026-07-09)

A designer's Q&A on job `1773092930059` appeared lost. PITR reads across the
window showed: her **answers survived** (only 3 of 17 changed, and that was a
July-10 edit, not the incident). Her **discussion thread replies** were never
recoverable — they had silently no-op'd and never hit the database (Mechanism 1).
Lesson: the durable fix is preventing silent-save failures, not just having
recovery. See `~/Desktop/Command Center/04-Incidents/Kweller Questions Thread Wipe.md`.
