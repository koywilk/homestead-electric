# Commercial Mode — a second division inside the same app

**Status:** Design draft for Koy's review — nothing implemented, no code touched
**Date:** 2026-09-25
**Owner:** Koy
**Mockup:** `commercial-mockup.html` (repo root, open in a browser; clickable, fake data)
**Related:** Job Prep tab (v386, spec 2026-08-28), Job Sections (v439/v440), My Day + hats (v398–v447), Simpro candidates inbox (v415), GC Portal

## What Koy asked for (2026-09-25)

> "we need to start working on a commercial side of the app. i want it to be a completely
> separate mode that only shows our commercial jobs. so each job will need a way to assign
> resi or commercial. commercial jobs will have a completely different job prep process and
> process overall. so we really need to dive in and design before implementing"

Three asks, in order of certainty:

1. **A division on every job** — residential or commercial. (Certain.)
2. **A Commercial mode** that shows only commercial jobs, everywhere. (Certain.)
3. **A different process** for commercial jobs — prep first, then the whole job lifecycle.
   (Certain that it differs; the *content* of that process is the part this document
   proposes and Koy needs to correct — see §9 Open questions.)

This document is split the same way. §2–§5 are the foundation and can be built as soon as
Koy signs off; §6–§8 are a straw-man commercial process for him to mark up.

## 1. What the code looks like today (facts the design rests on)

- **No division field exists.** A job is classified only by `type:"quote"`, `quickJob:true`,
  or `tempPed:true` (all inside `job.data`). Nothing in the app, functions, or docs mentions
  commercial.
- **There is no central job filter.** `App()` holds one `jobs` array from a single
  `onSnapshot(collection("jobs"))` listener (~L56823) and passes the raw array to every view;
  each view excludes quotes / temp peds / quick jobs on its own (`isInactiveJob`, Today's
  `allJobs`, `jobPrepIncluded`, My Day's live-jobs rule, …). About 15 view mounts take `jobs`
  directly; inside `App()` there are ~44 reads of `jobs.*` and ~30 `setJobs(...)` calls.
- **The residential process is baked into the job shape.** Punch lists, questions, home runs
  and keypads are keyed `upper / main / basement` (custom floors exist via `punch.extras`).
  Status is `roughStatus` / `finishStatus` with a fixed vocabulary, and the Job Board groups
  by `STAGE_SECTIONS` (Pre Job Prep → Rough → In Between → Finish → Completed). Job Prep is
  five fixed checklist items + three office-admin items with N/A and an override.
- **Job Sections (v439)** already lets a job hide the tabs it doesn't need
  (`JOB_SECTIONS`, `tabsForJob(job, activeTab)`). That is the precedent for "a commercial job
  card shows different tabs" — the tab bar is already per-job.
- **Server side reads every job.** A dozen scheduled functions (`dailyMorningChecks` prep
  nudges, `dailyCoChase`, `dailyRtChase`, `dailyMatterportChase`, `dailyStaleJobChase`,
  `dailyUpdateMissing`, `dailyMyDayDigest`, `foremanMeetingPrep`, `leadMeetingPrep`,
  `fridayPacket`, the Simpro PO / CO-status syncs, `techLightingWeeklyDigest`) and the
  `onJobUpdate` push trigger walk `collection("jobs")` with no division awareness. A commercial
  job created today would immediately start receiving residential prep nudges.
- **Simpro** is the source of new jobs (Pending-stage poller → `settings/simproCandidates` →
  admin Import as job / temp ped / quick). Cost centers per job are already fetched and cached
  (`simproCostCentersCache`, with `claimedPct`) — that is the hook for commercial progress
  billing later.
- **Per-user preferences** follow two patterns: device-local `localStorage` keys
  (`myday.view`, `planner.mode`, …) and fields on the user record in `settings/users`
  (`defaultScheduleView`, hats in `caps[]`).

## 2. Decisions proposed (Koy to confirm)

| # | Decision | Why |
|---|---|---|
| D1 | One app, one `jobs` collection, one job doc shape. Commercial is a **division value on the job**, not a second collection or second app. | Same people, same roster, same Needs / My Day / Crew Planner / Simpro inbox / GC portal. A second collection would mean duplicating every loader, rule, ledger, backup and function. |
| D2 | `division` is stored **inside `job.data`**; **absent means residential**. | Zero migration, zero writes to existing jobs, no loader change (fields inside `data` unwrap for free), no rules change. Every job that exists today is residential by definition. |
| D3 | **Mode is a device-level switch, filtered once at the top of `App()`.** `allJobs` (state) → `jobs` (derived, `division === mode`) → every view unchanged. | This is the only way "only shows our commercial jobs" is true in all ~15 views without touching each one. It also means residential mode automatically stops showing commercial jobs. |
| D4 | Commercial jobs get **their own tab list** on the job card, driven by the same per-job tab mechanism Job Sections uses. Residential tabs that don't apply are simply not in the list. | "Completely different process" = different tabs, different prep, different stage board. The v439 precedent (`tabsForJob`) already does per-job tabs. |
| D5 | **New commercial data lives under one namespace, `job.commercial = {…}`.** Shared structures (change orders, photos, links, notes, punch) are reused as-is. | Additive, one place to audit, one place for the functions to look. Reuse keeps CO / photo / link tooling working on day one. |
| D6 | **Server nudges that encode the residential process skip commercial jobs.** Generic plumbing (Drive folder, ledger, backup, PO sync, GC portal mirror) stays division-blind. | Otherwise Koy gets "Job starts in 2 days — prep incomplete" for a job whose prep is a different checklist. Needs one functions deploy. |
| D7 | Phase 1 ships **only the foundation** (§3–§5) plus a commercial Job Prep board and a commercial job card skeleton. Phases, daily log, RFIs, billing come after Koy has run one real job through it. | The commercial process content is the uncertain part; the foundation is not. Ship the certain part, learn from a real job. |

## 3. Data model (Phase 1 — all additive, all inside `job.data`)

```js
// The division. Absent / "" / anything unknown reads as residential.
division: "commercial"            // or absent (= "resi")

// Everything commercial-specific, one namespace. Created lazily on first write.
commercial: {
  // §6 — pre-construction checklist (the commercial "job prep")
  prep:     { <itemKey>: true },              // done
  prepNA:   { <itemKey>: true },              // not needed — same pattern as prepNA/adminNA
  prepOverride: { on:true, by, at, note },    // "Mobilize without full prep" — same audit-stamp rule as prepOverride
  stage:    "precon" | "mobilized" | "inprogress" | "closeout" | "complete",   // §7
  stageDate: "M/D/YYYY",

  // §7 — job facts that residential doesn't have (all optional strings)
  projectNo, gcPm, gcSuper, gcSuperPhone, contractValue, permitNo, planSetRev,
  siteHours, badgeReq, parkingNote, laydownNote,
}
```

Helpers (module scope, next to `isInactiveJob`):

```js
const jobDivision = (j) => (j && j.division === "commercial") ? "commercial" : "resi";
const isCommercial = (j) => jobDivision(j) === "commercial";
```

**Data safety:** `division` and `commercial` are new keys inside `data`, written through the
existing `u()` → `saveJob()` patch funnel (patch mode writes only changed keys, so an old
device on a stale bundle can't strip them). No existing field is renamed, retyped, moved or
removed. No loader change (only *top-level envelope* fields need the ~L56672 spread). No
`firestore.rules` change (same collection, same `data` map + `updated_at` string contract).
`migrate()` and `normalizeJob()` spread `...raw` first, so both keys survive drawer-local
normalization. Run the `firestore-data-shape-audit` skill at implementation time anyway.

**Where `division` gets set:**

| Path | Behaviour |
|---|---|
| "+ New Job" / "+ Temp Ped" / "+ Quick" while in Commercial mode | `division:"commercial"` on the blank job. In Residential mode the key is not written at all. |
| Simpro Import (inbox modal) | A fourth choice next to job / temp ped / quick: **Division: Resi · Commercial**, defaulting to the current mode. Candidate rows show a `COMMERCIAL?` hint if Simpro can tell us (Open question Q2). |
| Job Info → **Division** control (admin/manager, new perm `job.division`) | Segmented Resi / Commercial. Switching asks once: "Move *X* to Commercial? It leaves every residential board and its residential tabs are hidden. Nothing is deleted." Writes `division` only; every other field stays. The job is still in `allJobs`, so it reappears the moment the mode changes. |
| Upcoming → Promote | Inherits the mode the promote happens in. |
| Quotes → Convert | Keeps whatever `division` the quote had (quotes get the division of the mode they were created in). |

## 4. The mode switch

- **State:** `mode` in `App()`, `"resi" | "commercial"`, initialised from `localStorage`
  `he_mode` (try/catch, same idiom as `myday.view`), written on every change. Device-local,
  like every other view preference — the same person on a phone and a desktop can be in
  different modes, which is fine.
- **Default per user (optional, Phase 1.5):** `defaultMode` on the user record next to
  `defaultScheduleView` (Settings → My Preferences), for people who live in one division.
  Login → `myday` stays, but the mode is set from `defaultMode` before the landing.
- **Who sees the switch:** new perm `commercial.view`. Tier default `["admin","manager"]`
  plus a per-user hat `commercial.crew` (empty tier list, granted through `caps[]` like the
  existing hats) so the specific foremen / leads / crew who run commercial work get it. No
  `commercial.view` → no switch, the app is residential exactly as today, and any commercial
  job the person is deep-linked to (§4 "deep links") still opens.
- **Where it lives:** in the command header, left of the tab strip: a two-segment pill
  `RESI | COMMERCIAL`. Commercial mode recolours the header accent (the mockup uses the app's
  existing teal `#3E7D7A`, never amber) and prefixes the brand with **COMMERCIAL** so nobody
  makes a change on the wrong board without noticing. Phone: same pill, sits on the brand row.
- **The filter (the load-bearing line):**

  ```js
  const [allJobs, setAllJobs] = useState([]);           // was `jobs`, `setJobs`
  const jobs = useMemo(() => allJobs.filter(j => jobDivision(j) === mode), [allJobs, mode]);
  ```

  Every view prop stays `jobs={jobs}` — untouched. **Everything in `App()` that writes, merges,
  deletes, backs up, restores or dedupes must switch to `allJobs`**: `saveJob` / `flushJob` /
  `flushSaves` merge lookups, `deleteJobRemote`, the reconnect re-merge, `hejobs_backup`
  snapshot, `__HE_RESTORE`, the Simpro-candidate dedupe, `nextQuoteNumber`, `setSelected`
  refresh-by-id. Rule of thumb for the implementer: **read for display → `jobs`; anything
  that touches Firestore or localStorage → `allJobs`.** The ~44 `jobs.*` reads and ~30
  `setJobs` calls inside `App()` get reviewed one by one against that rule (this is the
  single biggest implementation risk and the reason for the Phase 1 test list in §10).
- **Selected job follows the mode:** if `selected` is in the other division when the mode
  flips, close the drawer (`setSelected(null)`) — never show a residential drawer over a
  commercial board.
- **Deep links auto-switch:** a push notification, a My Day row, a Needs row, a question link
  or a GC-portal handoff that opens a job from the *other* division sets `mode` to that job's
  division first, then opens it (toast: "Switched to Commercial"). Without this, "the push
  opens the task" (v446) would open nothing.
- **Cross-division data that must NOT be filtered by the mode:** `settings/users`, the
  crew roster / PTO / weekly schedule docs, `simproCandidates` (both modes see the inbox; the
  import writes the division), notifications inbox, time-off, Settings. **Needs docs** follow
  their job: a need with a `jobId` shows in the mode that job belongs to; a need with no job
  shows in both.

## 5. What each existing surface does in Commercial mode (Phase 1)

| Surface | Commercial mode |
|---|---|
| **My Day** | Same board, mode-filtered through `jobs`. Auto-task rules that read residential fields (rough %, finish status, matterport, temp ped, punch) produce nothing for commercial jobs; task docs and duties on commercial jobs show normally. Owner of commercial auto rows = the **`comm.head`** hat (new, mirrors `resi.head`; falls back to `resi.head` when nobody wears it). |
| **Job Board** | Commercial stage board (§7) — its own `COMM_STAGE_SECTIONS`, not the residential `STAGE_SECTIONS`. Search, foreman cards, flag toggle reused. |
| **Job Prep** | The commercial pre-con board (§6). Same two-lane / chips / N/A / override pattern as the residential tab, different items. |
| **Needs** | Unchanged, mode-filtered by job. |
| **COs** | Unchanged tracker over commercial jobs' `changeOrders` (the CO pipeline is division-neutral; Phase 2 may add PCO/COR naming — Q7). |
| **Forecast / Crew Planner** | Shows commercial jobs' events and assignments. People are company-wide: a person already on a residential job that day shows as busy (`Resi · <job>`) so the two modes never double-book. (Decision for Koy — Q8.) |
| **Today, Huddle, Scoreboard, QC, Quotes, Upcoming, Plan Changes, Tasks** | **Hidden from the commercial nav in Phase 1.** Their engines are residential (rough/finish pulse counters, book chips, scoring rules, Lutron hub). Each comes back only when a commercial version is designed. Quotes are the likeliest early return (Q9). |
| **Contractors, Safety, Time Off, Settings, App Map, Nav** | Shared, unchanged. |
| **GC Portal** | Phase 2. The mirror rebuild should carry `division` so a link can be scoped to commercial jobs; commercial GCs are the ones who will actually use it. |
| **Simpro inbox** | Visible in both modes (admin). Import gains the division choice (§3). |
| **Push notifications / functions** | §5.1. |

### 5.1 Functions (one deploy, Phase 1)

Add `const isCommercialJob = (d) => d && d.division === "commercial";` in `functions/index.js`
and skip commercial jobs in the residential-process functions: `dailyMorningChecks` (prep and
start nudges), `dailyCoChase`, `dailyRtChase`, `dailyMatterportChase`, `dailyStaleJobChase`,
`dailyUpdateMissing`, `foremanMeetingPrep` / `leadMeetingPrep` / `fridayPacket` (residential
meetings), `techLightingWeeklyDigest`, and the `onJobUpdate` branches that fire "Job Prep
Complete" / rough / finish pushes. **Leave division-blind:** ledgers, backup, `ensureJobDriveFolder`
/ `nightlyDriveSync`, PO sync, CO-status sync, `onNeedWrite`, GC portal, Simpro candidates.
`dailyMyDayDigest` keeps everything (it digests task docs, which are already per person).

## 6. Commercial Job Prep = Pre-Construction (straw-man — Koy to edit)

The residential Job Prep tab's mechanics are proven (tri-state chips with N/A, two lanes with
owners, header counts, override with audit stamp, complete strip). Keep all of that; swap the
items and the gate name. The gate is **"Cleared to mobilize"** instead of "Cleared to start".

### Lane 1 — OFFICE ADMIN (blue, Justin's lane)

| Key | Chip | Notes |
|---|---|---|
| `jobAccount` | ACCOUNT | Simpro job account created — **same field the residential tab uses**, so the chip reads the existing boolean. |
| `preLien` | PRELIM NOTICE | Preliminary notice / pre-lien filed — **same existing field**. |
| `coi` | COI SENT | Certificate of insurance to the GC. |
| `subcontract` | CONTRACT | Signed subcontract / PO from the GC received. |
| `sov` | SOV | Schedule of values submitted (feeds progress billing, Phase 3). |
| `billingSetup` | BILLING | GC billing portal / pay-app format set up (Textura, Procore, AIA G702/703…). |
| `permit` | PERMIT | Electrical permit pulled; `permitNo` on Job Info. |

### Lane 2 — PRE-CON (teal, Koy's / commercial PM's lane)

| Key | Chip | Notes |
|---|---|---|
| `plansCurrent` | PLANS + SPECS | Current plan set + spec book + addenda in Plans & Links; `planSetRev` recorded. |
| `submittalsSent` | SUBMITTALS SENT | Gear, fixtures, devices, fire alarm / LV as the spec requires. |
| `submittalsApproved` | SUBMITTALS OK | Approved or approved-as-noted. |
| `longLeadOrdered` | LONG-LEAD ORDERED | Switchgear / panels / generator / fixtures with lead times released. |
| `gcSchedule` | GC SCHEDULE | GC's schedule received; our milestones (underground, rough, gear, trim) copied to the job. |
| `kickoff` | KICKOFF | Pre-con / kickoff meeting held; super + PM names on Job Info. |
| `siteLogistics` | SITE LOGISTICS | Badges / orientation / drug test / parking / laydown / hours known. |
| `foremanHandoff` | HAND-OFF | Foreman assigned and walked the plans. Mirrors residential `readyToHandOff`. |

**Gate:** `commPrepChecked(j)` = every lane-2 item done or N/A (lane 1 is tracked, not gating —
same as residential). `commClearedToMobilize(j)` = checked **or** `commercial.prepOverride.on`.
Override = "MOBILIZE WITHOUT FULL PREP", same modal, same never-auto-cleared audit stamp,
same Undo. Header counts: active · held in pre-con · mobilized on override · cleared.

**Auto-task:** one "Pre-Con: <job>" row on the `comm.head`'s My Day until strictly complete,
exactly like "Pre Job Prep: <job>" — reuse the rule with the commercial predicate.

**Nudges:** none in Phase 1 (residential's 7-day / 2-day prep nudges are keyed on
`roughScheduledDate`, which commercial jobs don't have; a "mobilize date" nudge is Phase 2).

## 7. The commercial job lifecycle (straw-man — Koy to edit)

### Stage board (`COMM_STAGE_SECTIONS`, replaces rough/finish on the commercial Job Board)

| Stage | Test | Colour |
|---|---|---|
| **Pre-Con** | `!commClearedToMobilize(j)` | teal |
| **Mobilizing** | cleared, `commercial.stage` empty or `"mobilized"` | grey |
| **In Progress** | `stage === "inprogress"` | blue |
| **On Hold** | `stage === "hold"` | amber (app's existing hold colour) |
| **Closeout** | `stage === "closeout"` | purple |
| **Complete** | `stage === "complete"` | green, collapsed by default |

`commercial.stage` is set from a pill on Job Info (like `InProgressModePill`), with a date
stamp. There is no rough % / finish %; Phase 2 adds per-area phase tracking (below).

### Job card tabs (`COMM_TABS`, used by `tabsForJob` when `isCommercial(job)`)

Phase 1: **Job Info · Activity · Photos · Plans & Links · Pre-Con · Change Orders · Open Items**

- **Job Info** (commercial layout): name, address, GC + GC contacts (existing fields), then
  the commercial block: project #, GC PM, GC super + phone, contract value, permit #, plan set
  rev, site hours, badge / orientation, parking, laydown. Foreman / lead pickers unchanged.
  Division control (§3). Stage pill. Job Sections panel still applies (hide Matterport etc.).
- **Pre-Con**: the job's own view of §6 (both lanes, chips, override) — the drawer twin of
  the board, like the residential "Pre-Job Prep" drawer section but a full tab because there
  are 15 items.
- **Activity / Photos / Plans & Links / Change Orders / Open Items**: the existing components
  as-is. They read division-neutral fields. Plans & Links gets two extra link rows in its
  registry for commercial jobs: **Spec book** and **Submittals folder**.
- **Not on the commercial card**: Rough, Finish, Questions (floor-keyed), Home Runs, Panelized
  Lighting, Tape Light, Return Trips, QC. Questions and Return Trips are the likeliest early
  returns (Q6).

Phase 2 (after one real job): **Phases** (areas × phases), **Punch** (area-scoped), **Daily
Log**, **RFIs**, **Submittals** (as a tracked list, not just a chip), **Inspections**.
Phase 3: **Billing** (SOV lines ↔ Simpro cost centers' `claimedPct`), **Closeout** checklist
(as-builts, O&M, warranty letter, panel schedules, final inspection, lien release).

### Areas × phases (Phase 2 sketch, so the Phase 1 data model doesn't paint us in)

```js
commercial.areas:  [{ id, name }]                       // "Level 1", "Level 2", "Site", "Bldg B"
commercial.phases: [{ key, label }]                     // from a default list, editable per job
commercial.progress: { [areaId]: { [phaseKey]: { status, pct, updatedAt, updatedBy } } }
```

Default phase list: Underground / Slab · Rough-in · Gear & Service · Trim & Devices ·
Fixtures · Low Voltage / FA · Closeout. Punch lists for commercial jobs reuse the existing
punch structure with **areas as the floors** (`punch.extras = [{key,label}]` already supports
custom floors; the fixed upper/main/basement keys are simply not created for commercial jobs).

## 8. Permissions and hats (Phase 1)

| Key | Tiers | Purpose |
|---|---|---|
| `commercial.view` | admin, manager (+ `commercial.crew` hat) | see the mode switch |
| `commercial.crew` | hat (caps) | field people who work commercial jobs |
| `comm.head` | hat (caps) | Head of Commercial — owner of commercial auto-tasks and duties; falls back to `resi.head` |
| `commprep.view` | admin, manager | the commercial Job Prep board (mirrors `jobprep.view`) |
| `job.division` | admin, manager | move a job between divisions |

Hats appear in Settings → Team Members → company hats, next to `resi.head` / `jobprep.own`.
Nothing is hardcoded to a person (the `resiHead(users)` rule).

## 9. Open questions for Koy (answers change the build)

1. **Who runs commercial?** Same foremen and crews as residential, a dedicated commercial
   crew, or a mix? (Decides whether `commercial.crew` is a hat on a few people or everyone,
   and whether `defaultMode` on the user record is needed in Phase 1.)
2. **Can Simpro tell us a job is commercial** — job type, a tag, a cost-center name, the
   customer type, or a naming convention? If yes, the candidate poller can pre-set the
   division and the import needs no choice. (`scripts/simpro-discover.js` can probe this.)
3. **Pre-con checklist (§6):** which items are real for Homestead, which are missing, which
   are Justin's vs yours? Is there a commercial PM who owns lane 2 instead of you?
4. **Stages (§7):** is Pre-Con → Mobilizing → In Progress → Closeout → Complete right, or do
   you think in GC milestones (underground / rough / gear / trim / final)?
5. **Progress:** one % per job, or per area × phase? What are the phases on your jobs?
6. **Which residential tabs do commercial jobs still need on day one** — Questions? Return
   Trips (warranty calls)? Home Runs / panel schedules?
7. **Change orders:** is the residential CO pipeline fine, or do commercial COs need
   PCO → COR → approved with T&M tickets signed by the super?
8. **Crew Planner:** one company-wide planner filtered by mode (proposed), or a separate
   commercial planner?
9. **Quotes / bidding:** should commercial bids live in the Quotes tab in commercial mode from
   day one?
10. **Billing:** progress billing by cost center out of Simpro (the `claimedPct` we already
    pull), or AIA pay apps outside the app? Who owns it (Josh's invoicing hat)?
11. **Daily reports:** do your GCs require a daily log (crew count, hours, work done, weather,
    deliveries, delays)? That is the strongest candidate for the first Phase 2 tab.
12. **GC portal:** should commercial GCs get portal links in Phase 1, or wait?

## 10. Testing (Phase 1)

- `scripts/*-dryrun.js` style `vm` extraction of `jobDivision`, `isCommercial`,
  `commPrepChecked`, `commClearedToMobilize`, and the mode filter; cases: absent division →
  resi; `"commercial"` → commercial; unknown string → resi; override with nothing checked →
  cleared but not checked.
- **The `allJobs` audit:** a checklist in the implementation plan listing every `jobs.*` read
  and `setJobs` call in `App()` with its verdict (display → `jobs`, write/merge/backup →
  `allJobs`). Manual test: in Commercial mode, edit a commercial job, kill the tab mid-save,
  reopen in Residential mode → the pending offline save still flushes and no residential job
  was overwritten (`hejobs_backup` must hold all jobs).
- Mode flip with a residential drawer open closes it; a push for a commercial task opens it in
  Commercial mode; Simpro import in Commercial mode writes `division:"commercial"`; moving a
  job between divisions writes only `division` (console read-back before / after).
- Functions: run `dailyMorningChecks` locally against a job with `division:"commercial"` and
  an overdue residential prep → no push.
- `CI=true npm run build` before hand-off (standing rule). Mobile at 375px on the mockup.

## 11. Ship hygiene (when Phase 1 ships)

- SW bump; FEATURES.md entry with the why-it-won't-lose-data line (§3); complete
  `firestore.rules` deploy is a **no-op** (no rules change) — still verify the full file.
- Functions deploy for §5.1 (one file, additive guards).
- **New SOP guides:** `public/sops/commprep.html` (commercial Job Prep board) and a short
  `public/sops/commercialmode.html`; **update** `jobinfo.html` (Division control) and
  `myday.html` (Head of Commercial). Add both to the vault recording checklist.
- Vault (on Koy's Mac — not reachable from this session): add
  `08-Specs/COMMERCIAL_MODE_SPEC.md` pointing at this file, a `05-Decisions` note for D1–D7,
  and the daily log after the ship.
- Packaged `homestead-electric-app` skill: §10 "planned" gains Commercial mode.

## 12. Non-goals (explicit)

- No second Firestore collection, no second app, no second roster.
- No backfill: existing jobs are never written to; residential behaviour is byte-identical
  when nobody wears `commercial.view`.
- No residential feature changes ride this ship.
- No commercial Scoreboard, Today, Huddle, QC or Lutron surfaces in Phase 1.
- No Simpro writes.

## Acceptance (Phase 1)

- [ ] `division` absent → job behaves exactly as today in every view and every function.
- [ ] Mode switch visible only with `commercial.view`; persists per device; header clearly says COMMERCIAL.
- [ ] In Commercial mode every view shows only commercial jobs; in Residential mode none of them.
- [ ] New / imported / promoted jobs in Commercial mode carry `division:"commercial"`; Job Info can move a job either way with a confirm; only `division` changes on that write.
- [ ] Commercial job card shows the `COMM_TABS` list; residential-only tabs never render for it.
- [ ] Commercial Job Prep board: 15 chips with N/A, two lanes, override with audit stamp, header counts, complete strip; the `comm.head` gets one "Pre-Con: <job>" My Day row per held job.
- [ ] Offline save, backup snapshot and restore all operate on `allJobs`.
- [ ] Deep links from pushes / My Day / Needs auto-switch the mode.
- [ ] Residential-process functions skip commercial jobs; generic functions unchanged.
