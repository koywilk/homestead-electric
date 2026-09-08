# Lead Meeting Prep — Tuesday pre-filled sheet

**Status:** BUILT 2026-09-08 (tests green, prod dry-run rendered) — deploy pending Koy's sign-off. APPROVED by Koy 2026-09-08 (standalone doc · Koy only · no handbook section · carry action items forward · 35-day finish cutoff).
**Ask (Koy, 2026-09-08):** "I need something like [the Weekly Lead Meeting notes doc]
sent to me every Tuesday morning pre filled with info."

## What the doc is

`Notes - Weekly Lead Meeting` (Google Doc 1gn8CcqI…) is the Calendar-attached notes
doc for the Wednesday 6:30 AM Weekly Lead Meeting. Per-week sections: Notes ·
Highlight · Lowlight · Training · Handbook Reminder/s · Schedule Look Ahead
(Rough / Finish / Upcoming) · Action items.

## What the app can pre-fill (validated against the Sep 2 notes)

| Section | Source | Rule |
|---|---|---|
| Rough | jobs with `roughStatus` in progress / scheduled / date confirmed / waiting | show all (list is short), sorted by start date; each line = foreman / lead · status + stage % · start (–end) · freshest of last crew daily update vs office `statusUpdate`, with author + age · flags (no foreman, no lead, flagged) |
| Finish | same for `finishStatus` | split: **moving** (crew update or status line ≤ 35d, or start within −7..+14d, or scheduled/date-confirmed) vs a one-line "also on the board, quiet" tail |
| Upcoming | `settings/upcoming_jobs` items + quotes + rough-not-started jobs (only if a foreman or a date exists) + rough-done jobs whose finish start is within 60d | deduped against the board by normalized name; shows kind · sales/foreman · customer · date (days out) · note · last follow-up age |
| Crew out | `settings/crewPTO` overlapping the next 14 days | name · dates · note |
| Highlight / Lowlight | rough/final inspections passed / failed in the last 7 days | suggestions only, clearly labelled |
| Training | FEATURES.md entries shipped since the last meeting | "New in the app since last meeting" list + blank "Your topics" |
| Action items | the newest dated section of the notes doc (Docs API, read-only) | bullets under "Action items" carried forward; if the doc isn't readable the section says so and names the service account to share with |
| Notes | — | blank |

Signals deliberately NOT used: `lastActivityAt` (stamped by merely opening a job —
Today view dropped it in v368). Daily updates (`roughUpdates`/`finishUpdates`
`{date,text,addedBy,createdAt}`) are sparse and mixed-format (`3-17-26`, `8/12/2026`,
ISO) — parser accepts all three.

Mockup (real data, 2026-09-08): `docs/superpowers/mockups/2026-09-08-lead-meeting-prep-mockup.html`
Pure builder draft: `docs/superpowers/mockups/2026-09-08-lead-meeting-prep-builder.draft.js`

## Delivery options

1. **Cloud Function `leadMeetingPrep`, Tue 6:00 AM MT** (recommended) — exact Friday
   Packet pattern: pure `functions/leadMeetingPrep.js` + orchestrator in `index.js`,
   Google Doc created in the existing packet Drive folder (already shared with the
   service account — zero setup), push to Koy "Lead Meeting prep ready", `sendTest…`
   callable + `scripts/leadprep-dryrun.js` sign-off gate. Bulletproof (server-side cron).
2. Claude desktop scheduled task — only runs while the desktop app is open. Not
   bulletproof; rejected for a mission-critical weekly send.
3. Phase 2 on top of (1): write straight into the Calendar notes doc under that week's
   header via the Docs API (needs the doc shared with the service account as Editor;
   layout depends on Calendar's template — fragile, so second step, not first).

## Decisions (Koy, 2026-09-08)

- **Option 1** — standalone Google Doc in the packet Drive folder + push, "just for me to pull from".
- **Recipient: Koy only** (`sendToName("Koy")`, no pref gating needed; ops alert on failure also Koy).
- **No Handbook section** — Koy doesn't own that content ("i dont know what the handbook reminders is"); the sheet keeps Notes / Highlight / Lowlight / Training / Schedule Look Ahead / Action items.
- **Carry action items forward: yes.** The function reads `Notes - Weekly Lead Meeting`
  (doc id `1gn8CcqImvP2Zra_0gC8xAhUTzV8M8UGOrw44ipLwFKg`) via the Docs API with the
  service account; Koy shares it as **Viewer** with `homestead-electric@appspot.gserviceaccount.com`.
  Unreadable ⇒ section degrades to a one-line hint, never fails the run.
- **35-day finish cutoff stays.**

## Build shape (mirrors Friday Packet exactly)

- `functions/leadMeetingPrep.js` — PURE: `buildModel(inputs)`, `renderHtml(model)`,
  `parseActionItems(docJson)`. No requires, no I/O.
- `functions/index.js` — `exports.leadMeetingPrep` (`0 6 * * 2`, TZ America/Denver,
  300s/512MB): reads `jobs` (wrapped-unwrap), `settings/upcoming_jobs`, `settings/crewPTO`,
  `settings/featureManifest`? — NO: FEATURES.md isn't in Firestore. Training list comes
  from `settings/leadMeetingPrep.shipped` (see below) — fetches the notes doc, builds,
  uploads Drive doc `Lead Meeting Prep — <Wed date>` to `PACKET_DRIVE_FOLDER_ID`, pushes
  to Koy. `exports.sendTestLeadMeetingPrep` callable (requireAppKey) for a real run any day.
- Training source: the function cannot read the repo. The prebuild `version-from-sw.js`
  already syncs FEATURES.md into the bundle; the app can't write it either without a
  deploy step. **Decision: the orchestrator fetches `https://<app host>/features.md`
  (the synced copy served with the bundle) and the pure module extracts entries tagged
  `shipped YYYY-MM-DD` within the last 7 days.** If the fetch fails the Training list
  says "unavailable this week" — the sheet never fails on it.
- `scripts/leadprep-dryrun.js` — read-only dry run against prod, writes
  `leadprep-dryrun.html`, prints counts. Sign-off gate before deploy.
- Firestore writes: **none** (no state doc needed — nothing is diffed run over run).
