# Friday Strategy/Scheduling Meeting pre-fill — design

**Errata (2026-10-15, final review wave):** COs carry no `scheduledDate`; "dated" = `needsByStart` or a linked return trip (`rt.fromCOId === co.id`) with an `rtStatusDate`, and "approved, not done" excludes converted COs (the app's `coIsConverted`) (I4). "Crews freeing up" is relabelled "Near done". `*NeedsHardDate` is implemented as an AT RISK start ("HARD DATE NEEDED"). Starts use the app's start-date rule (scheduled/in progress: `StatusDate || ProjectedStart`; otherwise `ProjectedStart || StatusDate`), a not-started start dated before next Monday prints as OVERDUE under Starts, and one dated after next week is counted as "later" (it prints under Coming up). The header shows the actual build time, not a fixed 6:00 AM.

**Status:** DRAFT for Koy's review, 2026-10-15. Design approved in chat ("yes looks a lot more useful … way better structure") with one standing requirement: **"it just needs to be 100 percent accurate."** Nothing is built.
**Mockup:** artifact `Wk6dTFtqMeDQaPdPYNofWC` (illustrative rows; the two errors Koy caught are fixed in §3 below).
**Delivery (Koy, 2026-10-15, after approving the spec):** *"lets just have it on its own doc, ill copy and paste each week to the meeting doc."* The function writes its own Google Doc each week; nothing writes into Josh's doc. Sections below are amended accordingly.
**Replaces:** the Friday Packet doc (`exports.fridayPacket`), the `friday-strategy-prep` Claude routine + `homestead-command-center/scripts/strategy-prep.mjs`, and the hand-built "Weekly Strategy Meeting —" docs.

## 1. Goal

Every Friday at 6:00 AM MT a new Google Doc **"Friday Strategy Prep — <date>"** lands in the packet Drive folder, filled from the crew app and Simpro and styled like a Docs section so Koy pastes its body into Josh's running notes doc **"Notes - Weekly Strategy/Scheduling Meeting"** (the calendar attachment, id `1u5Z63PnYVANQJyjam1USUSDbKj6P62sRFJCpxjgkvOM`) in one copy-paste. Its order is the order the meeting runs: what rolled over, next week's schedule and its holes, what is blocked and by whom, what is coming, money, QC, last week, action items. The group (Koy, Josh, Brady, Justin) reads it instead of reconstructing the week from memory.

Koy, 2026-10-15: *"Real block and scheduling concerns need to be addressed in this meeting. Anything else strategy related."*

## 2. Why the three existing pulls fail

| Pull | What it is | Why it does not help |
|---|---|---|
| Friday Packet (`fridayPacket`, Fri 5:30, separate doc) | Money / Blockers / Week Ahead, v2 2026-07-30 | A money report in a second doc; its v3 by-coordinator-book plan (2026-08-21) was never built and the books no longer exist |
| `strategy-prep.mjs` + Claude routine (Fri 6:00) | Per-lead and per-foreman inventory of every question, CO, RT, punch count | An inventory, not decisions; 20 KB; the routine has never run |
| "Weekly Strategy Meeting — 2026-10-08 / 10-15" docs | Hand-built by sessions in the v3 layout | Grouped by coordinators that no longer exist; most books read "nothing sourced" |

Josh's notes show what the meeting actually is: about ten jobs a week as "Job — what — day — who", then Ready to invoice, QCs needed, Action items. Nothing in any pull says what is blocked, by whom, since when, or what will go wrong next week.

## 3. Accuracy rules (non-negotiable)

These come from the two errors Koy caught in the mockup, checked against live data on 2026-10-15.

1. **Booked means Simpro or the planner, never a job's roles.** Crew on a job next week = Simpro `/schedules/` entries (`Type:"job"`, `Date` in the window, `Project.ID` = job's `simproNo`) ∪ `settings/schedule_<nextMonday>` planner cells. The job's `foreman` / `lead` fields are *who is responsible*, not who is booked. (Live: Namjoshi is rough-confirmed for Mon 10/19 with Treycen as lead; Simpro has Treycen and Bailey at The Hideout on 10/19; the planner for 10/19 does not exist. The doc must say: "Namjoshi — rough starts Mon 10/19 confirmed · **nobody booked** · lead Treycen is at The Hideout Mon.")
2. **No live job is silently dropped from the schedule section.** Every live job (not quote, archived, deleted, finish complete/invoiced, or a done temp ped / quick job) with a phase in progress, scheduled, date-confirmed or on hold lands in exactly one of: Booked, In progress with nobody booked, Starts, or On hold (printed under Blocked §4.4). A wait reason is appended to the row; it never removes the row. Ready to invoice does not remove a job either. The one deliberate exemption: a job between phases (rough complete, finish not started) with **no finish date** is not listed anywhere; Koy, 2026-09-23: *"i will get finish dates when they come to me."* The dry-run's `checks` block still lists those jobs under "between phases, no date" so the count is visible. (Live: Skyridge Lot 208 is rough in progress 80%, ready to invoice since 10/1, QC needs, 15 open punch, no booking — it must appear under "nobody booked" with "QC needs · 15 punch · waiting: ufer clamp, pocket door framing, specs".)
3. **Conflicts are shown, not merged.** A person in Simpro on two jobs the same day, or a planner cell that disagrees with Simpro, prints as a conflict line. A confirmed start whose foreman or lead is booked elsewhere that day prints "X is at Y that day".
4. **Every row names its source day and age.** "idle 15d", "since 10/2", "carried 3 wks" come from stored dates, never from the run date alone. No date field on the job means the row says "no date", not a guess.
5. **The doc says when it was built.** Header: "pre-filled Fri 6:00 AM MT". Simpro's next-week schedule is sparse at 6 AM (the meeting itself fills it); the Booked list is explicitly "as of 6:00 AM".
6. **Dead fields are never read.** `roughScheduledDate` / `finishScheduledDate` (the app stopped writing them; this is what emptied the old Thursday packet), `lastActivityAt` (a presence ping). Return-trip dates come from `rtStatusDate` (`scheduledDate` is empty in live data).
7. **Pure builder + dry-run gate + regression harness.** `functions/strategyPrep.js` has no I/O. `scripts/strategyprep-dryrun.js` renders the exact section from live data to an HTML file; Koy signs off on the render before the first insert. `scripts/strategyprep-test.js` carries fixtures built from the real cases above (Lot 208, Namjoshi/Treycen/Hideout) and runs in `prebuild`.
8. **First live run is a TEST doc.** The test callable writes `TEST — Friday Strategy Prep — <date>` to the packet folder (state not advanced); Koy compares it with what he knows; only then does the cron go live.

## 4. The section, top to bottom

Same rendering contract as the Tuesday weekly doc (v536): create an empty Google Doc in the packet folder, then one Docs API `batchUpdate` (`insertText` at index 1, then range-limited paragraph/text styles and bullet presets), ASCII/BMP only, no emoji. One line per job, hard caps with "…and N more in the app", every section degrades alone to one grey line ("Section unavailable this week: <reason>").

The doc title carries the date (`Friday Strategy Prep — Oct 16, 2026`). The body has no heading and no attendee line of its own: it starts with a grey line `pre-filled Fri 6:00 AM MT from the crew app · next week Mon 10/19 – Fri 10/23 · booked = Simpro + planner as of 6:00 AM · details live in the app`, so Koy pastes it under Google's own dated heading in Josh's doc without a duplicate.

### 4.1 Carried from <last meeting date>
Last dated section of Josh's notes doc (Docs API `documents.get`, read-only, newest dated heading before today). Needs the doc shared with the functions service account as **Viewer** (it got 403 on 2026-10-15); until then this section prints "Couldn't read Josh's notes doc — share it with the service account to get carry-forward." Rules from `strategy-prep.mjs` `parseNotesCarry`, ported: struck-through = done (its children go with it); un-struck Notes/General bullets and unchecked Action items carry; each gets `(carried N wks)` counted from the first section it appeared in (match by normalized text). Cap 20. One blank checkbox line at the end. Unreadable doc ⇒ "Couldn't read last week's notes" line.

### 4.2 Headline (three lines; each drops if its data failed)
- `Next week: {booked} jobs crewed · {idle} in progress with nobody booked · {starts} starts, {startsAtRisk} with no crew.`
- `{blocked} jobs blocked: {byBucket…}.` (e.g. "6 on GC/builder, 4 on homeowner or designer answers, 2 on material, 2 on us")
- `{rtiTotal} ready to bill on {rtiCount} jobs · margin at finish median {m}% vs 15%, {under} under.`

### 4.3 Schedule next week · Mon–Fri
**Booked** (cap 15, sorted by first day): `Job — phase · days · names` from Simpro ∪ planner merged per job per day, dedupe by lowercased first name (the Friday Packet's Week Ahead code, kept). Consecutive days collapse (`Mon–Fri`, `Mon, Wed`). Phase = finish if finish status is in progress/scheduled/date confirmed, else rough; `%` from the stage. Append `QC after` when `qcStatus`/`finishQcStatus` is needs.

**In progress, nobody booked** (red, no cap): live jobs with rough or finish status `inprogress`, `scheduled` or `date_confirmed` (or stage > 0 with no status) and zero Simpro/planner people in the window, excluding `waiting` (On hold goes to §4.4). Row: `Job — phase % · last update <date or "none on file"> · <counts: N open punch, N questions> · waiting: <top 2 waiting-on buckets>`. Ready to invoice adds `ready to invoice 15d`.

**Starts**: `roughProjectedStart` / `finishProjectedStart` inside the window (only for a phase not yet started, per the dashboard's `odPhase` rule) plus `settings/upcoming_jobs` rows with `projectedStart` in the window and no live job of the same normalized name. Each row: chip **confirmed** (`*StartConfirmed` or status scheduled/date_confirmed) or **projected**; `crew booked` / **nobody booked**; `foreman · lead` or **no foreman / no lead**; Job Prep `k/5` from `PREP_CHECKLIST_ITEMS` (redlinePlans, cabinetPlans, applianceSpecs, plansUploaded, readyToHandOff; N/A items count as handled, as `allPrepChecked` does) naming the missing ones; and, when the foreman or lead is in Simpro on another job that day, `lead Treycen is at The Hideout Mon`. Chip **at risk** = confirmed or projected start inside 7 days with nobody booked or prep < 5/5. Also lists `*NeedsHardDate` jobs with no confirmed date (the packet's hard_date blocker).

**Dates that moved since last Friday**: compare this run's projected starts, RT dates, inspection targets and QC dates with the snapshot in `settings/strategyPrep.dates` (keyed `jobId:field`). Row: `Job — rough start 10/12 → 10/19 (3rd date)`; count from the snapshot's history (keep last 6 values per key). Plus **date passed**: a start/inspection/QC date before today whose status never moved (the dashboard's "date passed" rule). First run: "Tracking starts this week."

**On the calendar**: inspection targets (`fourWayTargetDate`, `finalInspectionTargetDate`) with no result and no attempt on/after the target; QC walks (`qcStatus`/`finishQcStatus` = scheduled + date); Matterport (`matterportStatus` scheduled, no link); return trips with `rtStatusDate` while `rtStatus` = scheduled; events on Koy's Google Calendar in the window whose title or address matches a live job (the plan-intake watcher already reads this calendar; reuse its match). Sorted by day, cap 12.

**People**: `settings/crewPTO` overlapping the window → `Out: name · days`; `settings/timeOffRequests` pending → `Pending: name · dates · requested Nd ago`; Needs board docs of kind `bodies` not done → `Bodies asked for: by, count, days, job` (confirm the doc shape against a live bodies need before coding; if the shape differs, the row prints the doc's `text`); users added since last Friday (`settings/users` diff vs the snapshot's user id list) → `New: name · title · under foreman`. **Capacity**: five tiles `Mon 17/19` = distinct people booked that day (Simpro ∪ planner) / active field roster (`active !== false`, title foreman/lead/crew) minus PTO that day; red under 70%.

**Conflicts** (only when present): same person on two jobs the same day; planner cell vs Simpro disagreement.

### 4.4 Blocked — what we are waiting on, from whom, how long
One line per job (highest-scored item wins the line; others fold into counts), grouped by who we wait on, using the Friday Packet's `WAIT_BUCKETS` keyword map plus two new groups:
- **GC / builder**, **Homeowner / designer answers**, **Material**, **Inspection**, **Other trades** — from open waiting-on punch items (`waiting` + `waitingOn` text) and unanswered questions (`roughQuestions` / `finishQuestions`, no `answer`, not done; questions default to the homeowner/designer group unless the text matches another bucket).
- **On hold** — rough or finish status `waiting` (the app's "On Hold"), with the status date.
- **Us (office owes the field)** — Needs board docs open 5+ days assigned to Koy, Josh, Jeromy, Justin or the resi-head hat holder, and jobs with `flagged` + `flagNote`.
- **Sold work not on the calendar** — approved COs with no scheduled date (`coStatus` approved; age from `createdAt`), return trips with status `needs` and no `rtStatusDate` (age from `createdAt`/`date`). Rendered as one compact line per job: `Bulowski — 2 approved COs, 158d`.

Row shape: `Job — <what> · <who, when known> · <oldest age>d`. Age = oldest open item in the group. A job cleared since last Friday (its `jobId:bucket` key in the snapshot, gone now) prints once under the group with a green **cleared** chip. Cap 10 rows per group; counts for the rest.

Known gap: jobs carry no GC or builder name (`customer` only), so "who" is the bucket. Adding a builder/GC field later turns this into a call list; out of scope here.

### 4.5 Coming up · next 2–8 weeks (Justin)
- Starts by week from `upcoming_jobs` (`kind`, `customer`, `projectedStart`, `startConfirmed`, `notes`, `lastFollowUp` age) and live jobs whose first phase starts after next week; grouped `Week of 10/26`, `Week of 11/2`, then `Later`. Cap 15.
- **In prep, start inside 21 days**: Job Prep checklist count and missing items.
- **Temp power prepping**: temp ped jobs with status not completed and no set date.
- **Plan intake this week**: `agentFindings` from the plan-intake watcher in the last 7 days (plans filed, walks scheduled), one line each, cap 6.
- **Quotes**: count + oldest age.
- **Capacity line**: jobs at finish ≥ 90% or ready to invoice (crews freeing) vs starts in the same two weeks.

### 4.6 Money (Josh)
The Friday Packet's engine, moved here unchanged in logic:
- **Ready to invoice**: `readyToInvoice && !invoiceDismissed && !invoiceSent`, live Simpro `Total.IncTax`, idle days from `readyToInvoiceDate`, margin flag (negative → "check Simpro costs"; under 15% → "N pts under"). Cap 10.
- **Margin at finish**: finishing-and-not-finished jobs (finish started, not complete/invoiced/ready-to-invoice, entangled-name regex excluded), live `NettMargin` else cached `simproMargin`; median line + **movers** ≥ 3 pts vs the snapshot's `marginByJob`, cap 5. First run: "Tracking starts this week."
- **Approved this week**: COs with `coStatus` approved and `coStatusSyncedAt`/`coStatusDate` in the last 7 days, `Job #quote`, with "none dated yet" / "N dated". No dollars (COs carry none in the app).
- Dropped from the packet: Billed since last packet, Pipeline counts (now §4.5), Double-booked (now Conflicts).

### 4.7 QC to schedule (Koy + Josh)
`qcStatus` or `finishQcStatus` = needs (date it was set), finish ≥ 90% with no QC status, final inspections passed in the last 7 days with no QC after. Tag `small` when open punch ≤ 3 (Koy's pics rule; the call stays his). Cap 10, then a blank checkbox line.

### 4.8 Last week · Mon–Fri
Counts only, names when ≤ 3: jobs finished (`finishStatusDate` in window), inspections passed/failed (attempts in window), COs created/approved/converted, return trips created, punch closed (`checkedAtTs`), questions answered/asked, blocks cleared (from §4.4), roster changes. The 4-week averages come from `settings/strategyPrep.weeks[]` (last 8 weekly count rows).

### 4.9 Action items
Blank 3-column table (Owner · What · By when, 4 rows). Next Friday, unchecked rows roll into §4.1.

## 5. Data and state

**Reads (all read-only):** `jobs` (wrapped `{data}` envelope, unwrap as the packet does), `needs`, `settings/users`, `settings/upcoming_jobs`, `settings/schedule_<nextMonday>`, `settings/crewPTO`, `settings/timeOffRequests`, `settings/strategyPrep` (state), `agentFindings` (last 7 days), Simpro `/schedules/?Date=between(<mon>,<fri>)` (the `between()` filter works; verified 2026-10-15, so no 60-page crawl), Simpro `/jobs/?ID=…&columns=ID,Total,Totals` for ready-to-invoice + margin-watch candidates (cap 50, concurrency 5), Koy's Google Calendar (plan-intake credentials), Josh's notes doc (Docs API).

**Writes:** one new Google Doc per run in the packet folder (`PACKET_DRIVE_FOLDER_ID`), filled by one Docs `batchUpdate`; one merge into `settings/strategyPrep` = `{ lastRunAt, dates: {key: [{d, v}…]}, blockerKeys: [], marginByJob: {}, userIds: [], weeks: [{ymd, counts}] (cap 8), history: [{date, docLink}] (cap 26) }`. Test runs never write state. **No job write path, no loader change, no rules change** (`settings/*` already readable; the doc is the only thing holding margins, same as today).

## 6. Architecture

- `functions/strategyPrep.js` — PURE: `buildModel(inputs)`, `renderLines(model)` (the Tuesday builder's line shape: `{kind, text, spans}`), reuse `foremanMeetingPrep.docsRequests(lines, 1)` for the Docs API requests, `parseNotesCarry(doc)` (ported from `strategy-prep.mjs` to the Docs JSON shape, since the function reads the doc through the API, not Drive markdown), `collectSimproCandidates`, `resolveRecipients`. Moves in from `fridayPacket.js`: date helpers, `WAIT_BUCKETS`/`waitBucket`, `flatPunchWaiting`, `countUnansweredQuestions`, the blockers scoring (as the per-job "highest item" rule), the Week Ahead merge/dedupe, `SPECIAL_JOB`, `MARGIN_TARGET`.
- `functions/index.js` — `runStrategyPrep({testRun})`: reads above, Simpro fetches (schedule window + totals), read of Josh's doc (carry), create + fill the week's doc, state merge, push. `exports.strategyPrep` cron `0 6 * * 5` America/Denver, 540 s, 512 MB. `exports.sendTestStrategyPrep` callable (app key): full run writing a `TEST — ` doc, push to Koy only, no state write. Push: title `Friday prep`, body = headline line 1, `data.url` = doc link, recipients Koy, Josh, Brady, Justin (admins ∪ explicit list; never plain "manager"), pref key `friday_packet` reused so the existing Settings toggle still governs it (its label changes to "Friday meeting prep (Fri 6:00 AM)" in the next client push).
- Fallback: if the Docs styling fails, upload the same content as an HTML-converted Drive doc (the packet's upload code) and push Koy the ops alert, so the meeting still has a doc.
- Retire: `exports.fridayPacket` + `exports.sendTestFridayPacket` (delete after the first clean live Friday); `fridayPacket.js` deleted once its helpers have moved; `autoDocs.js` "packet" and "strategy" sources replaced by one `strategy` entry with prefix `Friday Strategy Prep — ` in the packet folder (the Dashboard card opens the newest); the `friday-strategy-prep` Claude routine disabled and `strategy-prep.mjs` marked retired in the command-center repo (that repo is Koy's; one note, no deletion).
- Export count: +2 then −2 (106 → 106 after retirement; verify with the usual one-liner before and after each edit).

## 7. Errors

Each section is wrapped; a throw renders one grey line with the reason and never kills the insert. Simpro schedule failure ⇒ Booked prints "Simpro unavailable; planner only" and §4.3 idle rows carry "(Simpro not checked)". Totals failure ⇒ cached margins, no dollars. Notes doc unreadable ⇒ §4.1 degrades, insert still happens (Docs write scope covers the read). Docs styling failure ⇒ HTML upload fallback + ungated ops push to Koy. All failures logged with `strategyPrep <step>` prefixes.

## 8. Testing and sign-off

1. `scripts/strategyprep-test.js` (plain node, prebuild): fixtures reproduce Lot 208 (in progress, RTI, QC needs, waiting items ⇒ appears under nobody booked with reasons), Namjoshi (confirmed start, lead booked elsewhere ⇒ at risk with the "is at" line), Hideout (finish 95%, invoiced, waiting items ⇒ Booked when Simpro says so, Blocked/material otherwise), a planner-vs-Simpro conflict, a cleared block, a moved date with history, first-run behaviour of every snapshot-dependent section, every section's degrade path, and that no live job is missing from §4.3's union.
2. `scripts/strategyprep-dryrun.js`: read-only prod render → `strategyprep-dryrun.html` + a `checks` block listing every live job and which §4.3 bucket it landed in. **Koy approves the render.**
3. Deploy `strategyPrep` + `sendTestStrategyPrep`; Koy fires the test callable; a `TEST — Friday Strategy Prep — <date>` doc appears in the packet folder; Koy compares it against his own knowledge of next week.
4. Cron live. First real Friday: Koy pastes the body under Google's dated heading in Josh's doc; check the paste keeps checkboxes and colors.
5. After one clean Friday: delete `fridayPacket`, disable the routine, update FEATURES.md, the Dashboard card, the vault, and the crew brief (office-facing).

## 9. Data safety

Read-only on jobs, needs, users, settings except one additive merge to `settings/strategyPrep`. One new Drive doc per run (the mechanism the Friday Packet and Lead Meeting Prep have used since July); Josh's doc is only ever read. No loader, rules, SW or client change in the first ship; the Dashboard card and FEATURES.md ride a later client push. Rollback = `firebase functions:delete strategyPrep`; the packet function can be redeployed from git until it is deleted.

## 10. Decisions assumed (object if wrong)

1. ~~Insert into Josh's calendar doc, not a separate doc.~~ **Changed by Koy 2026-10-15:** its own doc each week in the packet folder; Koy copies the body into the meeting doc.
2. Fold the Friday Packet into this and stop the packet doc.
3. Disable the Claude routine and retire `strategy-prep.mjs` once this is live.
4. Recipients: Koy, Josh, Brady, Justin. Jeromy does not get the push (he was approved for the packet in August; say so if he should).
5. Run at 6:00 AM Friday. Simpro's next-week schedule is thin at that hour; the doc says "as of 6:00 AM".

## 11. Out of scope

Builder/GC field on jobs; Crew Planner dated-event rows; a Monday or Wednesday version; dollars on change orders; any client UI beyond the Dashboard card text.
