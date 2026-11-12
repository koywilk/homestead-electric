# Dashboard: Truth and Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan ship by ship. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every number on `/dashboard` is right, says how old it is, agrees with Simpro or says where it doesn't, and the page answers Koy's questions in the fewest taps.

**Architecture:** Five ships, each one push. Ships 1, 3 and 4 are frontend only (`src/App.js`, the `od*` helper block and `OfficeDash`). Ship 2 is Cloud Functions only and needs one functions deploy. Pure helpers stay in the audit blocks above `function OfficeDash(` and are tested in `scripts/*-test.js`, which the prebuild runs.

**Tech Stack:** React (one file), Firestore, Firebase Functions (Node 22, `firebase-functions/v1`), Simpro REST read-only.

**Spec:** the audit of 2026-11-11: `dashboard-audit-findings.md` and `dashboard-audit-evidence.md` (shared notes folder; finding ids W1–W15, S1–S8, M1–M7 below refer to it).

## Global Constraints

- Simpro is read-only. Nothing in this plan writes to Simpro.
- No ship changes how a job is saved (`saveJob`, the loader, `firestore.rules`) except ship 2 task 4, which narrows an existing server write.
- Every ship: next free SW version, a FEATURES.md entry with a "Why it won't lose data" line, `public/sops/dashboard.html` updated, a crew brief in the ship commit, `CI=true npm run build` green before handoff.
- Build in a worktree off `origin/main`. Koy pushes main and runs deploys; every deploy line carries `--project homestead-electric`.
- UI rules: new sections start collapsed with a count on the header; no yellow or amber; never add taps; phone and desktop show the same things; plain labels; one number per stat.
- Layout changes (ship 4) get a real-data mockup first.
- Owned by the whole-app audit session, not this plan: `getSimproSchedule` paging (S5 backend half), `job.simproMargin` refresh (S8), deleting Scoreboard V2–V4.

## Review Focus

- A time-off row typed end-before-start, or with an unreadable date: it must not crash or show for the wrong week (ship 1, tested).
- A weekend, or Monday before 7 AM: Friday's Simpro copy must not read as "missed" (ship 1, tested).
- A job with no Simpro number, or two app jobs sharing one: must never be flagged "disagrees with Simpro" (ship 3 task 2 test).
- Jan 1: the Goals tab must still show a year of numbers, not an empty year (ship 2 task 2 test).
- A person on two crews, or named only by first name: counted once on People after the all-jobs change (ship 3 task 1 test).

---

## Ship 1 — Truth fixes (frontend, SW v626) — BUILT 2026-11-11, branch `dash-truth-fixes`

Files: `src/App.js`, `scripts/odash-model-test.js`, `scripts/goals-model-test.js`, `FEATURES.md`, `public/sops/dashboard.html`, `public/service-worker.js`, `docs/crew-briefs/v626.md`.

- [x] W1 time off: `odModel` reads `pto` dates as real dates (`ptoIso`), so "Out this week" and "off" work with the M/D/YYYY the app stores.
- [x] S1 (display half): `odSimAsOf(at, now) → { text, stale, at }`; a line under the header, red when a weekday pull is missed.
- [x] W5: `d.simDoneOpen` + a Needs you line "Complete in Simpro, still open here".
- [x] W7 + S4 (parser half): `odGoalStatus` Done test anchored; `odGoalDue(by, now, listYear)`; headings parse with any year; `sheet.goalsYear`.
- [x] W8 (QC half): `passed_items` counts as a walk.
- [x] W9: `odDocStatus` ignores `test:true` runs.
- [x] W14: an unfiled plan keeps waiting past 14 days.
- [x] W13: the Claude tab shows an error on a failed load; sample rows only on `not-found` / `unimplemented`.
- [x] S2 (display half): Job Costs header says when rows are older than the run, red when the pull stops.
- [x] W15: Upcoming list sorts by date; Team pulse sorts before it cuts to ten.
- [x] Tests: 18 new checks in `odash-model-test.js`, 9 in `goals-model-test.js`; all dashboard test scripts pass.
- [ ] `CI=true npm run build`, show Koy the diff, Koy pushes main and deploys hosting.

## Ship 2 — Feeds you can trust (Cloud Functions; one deploy)

Files: `functions/index.js`, `functions/fridayPacket.js`, `functions/simproSync.js`, `functions/goalsPull.js`, new `functions/dashHistory.js`, tests `scripts/simprosync-test.js`, `scripts/goals-pull-test.js`, new `scripts/dash-history-test.js`.

### Task 1: Simpro totals are whole and current (S1 backend)
- [ ] `fetchSimproTotals` stamps each entry with `at` (ISO).
- [ ] `collectMoneyCandidates` also returns jobs finished and fully billed whose `simproInvoicedSeenAt` is under 60 days old (new group, capped with the rest).
- [ ] `dailySimproTotals` writes `byNo` and `quotes` as whole maps (`db.doc(...).set(payload, { mergeFields: ["at","source","byNo","quotes","syncLast"] })`), carrying forward an entry only when its `at` is under 7 days old and the job was wanted but the fetch failed.
- [ ] Test: an entry for a job no longer wanted is gone; a failed fetch keeps yesterday's entry with its old `at`; a finished job billed 100% 10 days ago is re-read.

### Task 2: History (M2, S4)
- [ ] `functions/dashHistory.js`: `snapshotRow({ goals, phaseCosts, simproTotals, jobs, now }) → { date, marginPct, hoursPct, counted, activeJobs, openPunch, cosWaiting60, firstPass90, failedNotRebooked, quietJobs, feeds: { goals, costs, scoreboard, totals } }` (pure).
- [ ] `dashHistoryNightly` at 6:45 AM MT writes `dash_history/{YYYY-MM-DD}` (create-only) and `settings/dashFeeds` (`{ goals, costs, scoreboard, totals }`, each `{ at, ok, error }`).
- [ ] `runGoalsPull`: before overwriting, when the stored doc's `year` is lower than this year, copy it to `settings/goalsSimpro_<year>`; write phase 1 before phase 2 starts.
- [ ] Add `dash_history` to `BACKUP_COLLECTIONS` and to `firestore.rules` (admin read, server write); deploy rules complete, never partial.
- [ ] Test: Jan 1 run keeps `goalsSimpro_2026`; snapshot is create-only; a missing feed shows `ok:false`.

### Task 3: Real run stamps (S3, S6)
- [ ] `scoreboardNightly`, `goalsNightly`, `phaseCostsNightly`, `dailySimproTotals` each call `stampAutoRun(key, run)` so a failure is on record.
- [ ] Frontend follow-up lands in ship 3 task 5 (Overview "Data feeds" line reads `settings/dashFeeds`).

### Task 4: A change order is closed only when its own quote is (W12)
- [ ] `planSimproSync(job, totals, nowIso, quotes)`: complete an approved or scheduled CO on a fully billed job only when `quotes[quoteNo]` exists with `stage` Approved and `closed === true`, or the CO has no quote number and the job total rose since the CO was approved. Otherwise leave it and log `kinds: ["coHeld"]`.
- [ ] `fetchSimproQuotes` also reads `IsClosed`; `collectQuoteCandidates` adds quotes of approved COs.
- [ ] Test: CO approved after the job hit 100% with an open quote is held; Mangum-shaped case (quote closed, total rose) completes.

## Ship 3 — Answers it can't give today (frontend)

Files: `src/App.js`, `scripts/odash-model-test.js`, `scripts/overview-audit-test.js`, `scripts/people-autos-audit-test.js`.

### Task 1: People and the job sheet read all jobs (W2, W6)
- [ ] `odModel` builds `eventsAll` and `lastWorkAll` from `allLive` of BOTH divisions (new `allJobs` argument from `App`), and `people` from `eventsAll`. The job sheet reads `eventsAll`, `lastWorkAll`, an unfiltered schedule.
- [ ] `odWorkDaysBetween(a, b)`; quiet thresholds become 2 work days (people) and 3 work days (jobs); `lastWork` counts only crew entries (daily update, punch closed, photo, question), not office notes or the CO sync stamp. One constant per threshold, named in the label.
- [ ] Test: Friday activity is not quiet on Monday 8 AM; a foreman filter does not change anyone's status.

### Task 2: Where the app and Simpro disagree (W4, W11)
- [ ] `odSimDisagree(j, simEntry, phase) → null | { kind: "stage"|"tech", app, simpro }` using a fixed table from Simpro status name to the app's stages; jobs with no Simpro # or a shared one return null.
- [ ] Jobs tab: Simpro's status under "Where it is" (no new column on phones). Overview attention line "Stage differs from Simpro" and "Simpro technician is not the app's foreman or lead", both folded, with counts.
- [ ] Test: the ten audited jobs' shapes give the audited answers.

### Task 3: Labor used up before finish starts (M1)
- [ ] Overview reads `settings/phaseCostsHrs` (hours only, already written nightly) and adds the attention line "Labor budget used before finish starts": finish not started in the app and hours used ≥ 90% of the whole-job estimate, worst first.
- [ ] Test: Kweller (1,277 of 888, finish not started) and Brandt (574 of 575) shapes are listed; a job in finish is not.

### Task 4: Job Costs grades only finished jobs (W3), per-foreman margin on Goals (M6)
- [ ] Open-job margin cells and chart bars render grey with "so far"; tiles for open jobs lose the under-15% tag.
- [ ] Goals per-foreman card shows `byTech[].marginPct` beside hours (hidden in Foreman view).

### Task 5: Feeds line, counts, leftovers (S6, W8, W10, Unused)
- [ ] Overview "Data feeds" fold from `settings/dashFeeds`: each feed's last good run; red and open when one failed.
- [ ] Failed inspections: active jobs only, plus a separate folded "Closed with a failed final" list.
- [ ] Every "X of N" header matches its rows or says "showing 5 of N"; "Crew questions" in Needs you counts only those waiting on the office.
- [ ] Remove never-read model fields and the unreachable `chartSel` / `actDay` code, after an eslint no-undef pass.

## Ship 4 — Faster to read (layout; mockup first)

- [ ] Real-data mockup of all ten tabs with every section folded, counts and worst-item badge on each header; Koy approves before code.
- [ ] One fold component replaces the three in use; open state per visit.
- [ ] Phone: Job Costs keeps Technician and Status (stacked under the job name); Jobs table and week grid become cards under 760px; every hover-only explanation moves into the fold's "How it is counted".
- [ ] Labels: one "quiet" rule per subject, named with its number; spell out "change orders"; say which direction is good; one number per stat (drop "avg" beside weighted, "(median N)" beside average).
- [ ] The active foreman and coordinator filters show as chips beside the tab strip on every tab.
- [ ] Colour: Koy's call on rust orange `#B4531A` and Job Costs `#FF6A13`; default proposal is the dashboard's copper for leads and red only for late or failed.

## Ship 5 — One place, and a dashboard that learns

- [ ] My Day as the first tab (the one-place plan's ship 2), so time off and urgent tasks are decided without leaving the page.
- [ ] PostHog key into the Vercel and hosting build environments (Koy's setting), then a weekly "what was never tapped" read.
- [ ] Learning loops on `dash_history`: nightly truth check of one tab against Simpro by a second path; flag scoring 14 and 30 days later; a "this looks wrong" tap on any row.
