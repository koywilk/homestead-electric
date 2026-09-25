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
  // §6 — the 12-phase Job Start process (checks, N/A, notes, per-phase move-on stamps)
  start:      { items:{}, na:{}, notes:{}, overrides:{} },     // shape in §6.2; current phase is DERIVED from it
  submittals: [ … ],                                            // §6.3 gear & submittals log (phases 3–5 derive from it)
  rfis:       [ … ],                                            // §6.3
  systems:    { gear:true, … },                                 // §6.4 scope by system
  milestones: { tempPower, footing, underground, slab, walls, ceilings, permPower, startup, final },  // §6.4, M/D/YYYY

  // §7 — only the stages a phase can't derive; "" while the job is in phases 1–12 or In Progress
  stage:      "" | "hold" | "closeout" | "complete",
  stageDate:  "M/D/YYYY",

  // §7 — job facts that residential doesn't have (all optional strings)
  projectNo, gcPm, gcSuper, gcSuperPhone, contractValue, permitNo, permitBy, planSetRev,
  siteHours, badgeReq, parkingNote, laydownNote, tempPowerOwner,
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
| Simpro Import (inbox modal) | `division` comes from the candidate's Simpro **Business Group** (Q2, answered): the poller stores `businessGroup` on each candidate, the row shows a COMMERCIAL pill, and Import writes the division with no picker. Missing / unmapped group → defaults to the current mode with an "unmapped group" hint. |
| Job Info → **Division** control (admin/manager, new perm `job.division`) | Segmented Resi / Commercial. Switching asks once: "Move *X* to Commercial? It leaves every residential board and its residential tabs are hidden. Nothing is deleted." Writes `division` only; every other field stays. The job is still in `allJobs`, so it reappears the moment the mode changes. |
| Upcoming → Promote | Inherits the mode the promote happens in. |
| Quotes → Convert | Keeps whatever `division` the quote had (quotes get the division of the mode they were created in). |

## 4. The mode switch

- **State:** `mode` in `App()`, `"resi" | "commercial"`, initialised from `localStorage`
  `he_mode` (try/catch, same idiom as `myday.view`), written on every change. Device-local,
  like every other view preference — the same person on a phone and a desktop can be in
  different modes, which is fine.
- **Default per user (Phase 1):** `defaultMode` on the user record next to
  `defaultScheduleView` (Settings → My Preferences, and settable per person in Team Members),
  for the people who do mostly commercial. Login → `myday` stays, but the mode is set from
  `defaultMode` before the landing; absent = residential = today.
- **Who sees the switch:** new perm `commercial.view`, all four internal tiers (crews work
  both divisions — Koy, 2026-09-25). Contractors never see it. A person deep-linked to a job
  in the other division still opens it (§4 "deep links").
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

## 6. Commercial Job Prep = the Job Start Process (Koy's 12 steps, 2026-09-25)

Koy pasted Homestead's **Commercial Electrical Job Start Process** (12 steps, from contract
award through the slab pour) and corrected the owner: *"Pre con checklist will not be on Koy
for commercial it will be Brady/Justin."* Step 6 is marked *"Zane/Abe."* The earlier two-lane
straw-man is withdrawn; this section replaces it. The residential Job Prep **mechanics** stay
(tri-state chips with N/A, owners per lane, header counts, override with audit stamp,
complete strip) — the **shape** changes from two lanes of chips to **twelve steps with
sub-items, three owners, and two trackers**.

### 6.1 Owners are hats, never names

| Hat (caps) | Label in Settings | Who today | Owns |
|---|---|---|---|
| `comm.precon` | Commercial pre-con (shared) | Brady, Justin | Steps 1–5 |
| `comm.site` | Commercial site coordination (shared) | Zane, Abe | Step 6 |
| `comm.precon` (same hat) | | Brady, Justin | Steps 7–12 — **all twelve steps are pre-construction; there is no on-site work in this process** (Koy, 2026-09-25: *"none of this is foreman phase? its all done pre construction there is no on site work yet"*). Open: whether any of 7–12 should sit with Zane/Abe instead (Q3b). |
| `comm.head` | Head of Commercial | **Brady** (Koy, 2026-09-25) | fallback owner for every commercial row nobody wears the hat for; sees all |

The job's foreman owns nothing in this process. Foremen see the Job Start board read-only
(so they know what state a job is in before they mobilize) and take over when the on-site
phases arrive in Phase 2.

Shared hats follow the existing rule ("walked together: one row on both" boards). Resolution
follows `resiHead(users)`: nobody wearing `comm.precon` → `comm.head` → `resi.head`.

### 6.2 The twelve steps are phases — one at a time, auto-advancing (Koy, 2026-09-25)

> "we are thinking for each number is a phase of it. so it can come up with the phase and
> checklist under, when all are checked it goes to the next phase and checklist"

That is the core mechanic:

- **A commercial job is in exactly one phase, 1 → 12.** The board and the job card show
  **that phase's checklist** front and centre; earlier phases sit above it collapsed with a
  ✓, later phases sit below it collapsed and greyed (visible so people can see what's coming,
  not editable until the job gets there).
- **Checking the last item advances the job** to the next phase, on the spot: toast "Phase 9
  done — now in Phase 10: Foundation Electrical", the next checklist unfolds, the auto-task
  rows and owner change with it (§6.5). No button to press.
- **Current phase is derived, not stored:** `commPhase(j)` = the first phase with an item
  that is neither done nor N/A nor covered by an override. Deriving it means un-checking an
  item in an earlier phase honestly pulls the job back (same "honestly reappears" rule as the
  residential override badge) and nothing can get out of sync.
- **"Move on with items owed"** (the per-phase override, replaces the single mobilize
  override): a phase can be closed with items still outstanding — for the real-world case
  where gear approval (phase 4/5) drags while the site is ready to dig (7–9). Same modal as
  residential (lists what is owed, optional note), same never-auto-cleared audit stamp, same
  Undo. The owed items stay red with an OWED badge inside their collapsed phase and keep
  their My Day rows until they're truly checked. The board counts them ("2 items owed in
  earlier phases") so nothing is forgotten.
- **After phase 12** the job leaves Job Start: `commPhase(j)` returns `null`, the Job Board
  moves it to **In Progress** (§7), and Phase 2's above-slab tracking takes over.

All twelve phases are pre-construction — Brady & Justin, with Zane & Abe on phase 6. Nothing
here is on-site work; the job mobilizes only after phase 12 closes. Each phase is a group of items; each item is a **check** (chip), a **field** (a value on Job
Info), a **photo** item (chip + the existing `PhotoAttacher`), or a **tracker** item whose
done-state is *derived* from a log (§6.3). All of it lives under `job.commercial.start`:

```js
commercial.start: {
  items:     { "<phase>.<item>": { done:true, by:"<name>", at:"<ISO>" } },   // absent = outstanding
  na:        { "<phase>.<item>": true },                                     // not needed
  notes:     { "<phase>": "free text" },
  overrides: { "<phase>": { by, at, note } },   // "move on with items owed" — audit stamp, never auto-cleared
}
```

The registry `COMM_START_STEPS` (module scope, next to `PREP_CHECKLIST_ITEMS`) is the single
source of truth for labels, order, owner and item kind. Straw-man contents, item by item from
Koy's list (**Koy edits this table, not the code**):

| # | Step | Owner | Items (chip label · kind) |
|---|---|---|---|
| 1 | Quote Approval / Contract Award | `comm.precon` | AWARD DOC (PO / subcontract / NTP received) · check — PERMIT RESPONSIBILITY (who pulls; inspection reqs) · check + `permitBy` field — UTILITY / SERVICE COORD · check — CONTACTS SET (PM, super/foreman, GC contacts, comms process) · check, satisfied by Job Info contact fields |
| 2 | Project Setup & Initial Review | `comm.precon` | JOB # / COST CODES / PURCHASING · check (job account = existing `jobAccount`) — PROJECT FOLDERS · check (Drive folder is auto; link rows) — PLAN / SPEC REVIEW · check — SCHEDULE + MILESTONES · check (fills §6.4 milestone dates) — SCOPE BY SYSTEM · check, satisfied when the systems checklist (§6.4) has been set |
| 3 | Request Vendor Submittals | `comm.precon` | CED SENT PLANS/SPECS · check — FA CO. SENT PLANS/SPECS · check — LONG-LEAD REQUESTED · **tracker**: every submittal-log row has a request date — LEAD TIMES + PRICING · **tracker**: every row has lead time + price confirmed |
| 4 | Electrical Submittal Review | `comm.precon` | PM/ESTIMATOR REVIEWED · check — DIMENSIONS / CLEARANCES · check — RFI LIST · **tracker**: RFI log exists (0 open allowed) — SENT TO GC · **tracker**: every row ≥ submitted — ALL APPROVED · **tracker**: every row approved / approved-as-noted — COMMENTS RESOLVED · check |
| 5 | Release / Order Long-Lead Gear | `comm.precon` | RELEASED + PO · **tracker**: every approved row has PO # + released date — SHIP DATES IN WRITING · **tracker**: every released row has promised ship — PROCUREMENT LOG · **tracker**: every row has required-on-site — SHIP COMPLETE / SPLIT · **tracker**: every row has a shipping mode — DELIVERY / STORAGE · check — WEEKLY GEAR CHECK · *not a chip*: a weekly My Day row (§6.5) |
| 6 | Preconstruction / Site Coordination | `comm.site` | GC KICKOFF ATTENDED · check — SCHEDULE CONFIRMED · check — MANPOWER PLAN · check — MILESTONES SET · check, satisfied when §6.4 milestone dates are in — LAYDOWN / STORAGE · check — TEMP POWER NEEDS · check — TRAILER / CONTAINER · check — CRANE / FORKLIFT · check — RENTALS + DATES · check — BIM / CLASH · check (N/A common) |
| 7 | Site Work Takeoff & Ordering | `comm.precon` | SITE TAKEOFF DONE · check — SITE MATERIAL ORDERED · check — the ten material lines (PVC, sweeps, duct bank, pull boxes, grounding, site lighting, utility/service, vaults, comm/FA pathways, tape/spacers/encasement) are a **sub-checklist** inside the step, each N/A-able |
| 8 | Temporary Power | `comm.precon` | REQUIREMENTS · check — TEMP UTILITY SERVICE · check — SERVICE / METER / MAIN · check — DISTRIBUTION · check — SPIDER BOXES / GFCI · check — TEMP LIGHTING · check — TRAILER POWER · check — CRANE / HOIST POWER · check — INSPECTED + ENERGIZED · check + date — MAINTENANCE OWNER · field |
| 9 | Ufer / CEE | `comm.precon` | FOOTING SCHEDULE REVIEWED · check — ELECTRODE CONFIG · check — CONCRETE / REBAR COORD · check — UFER INSTALLED · check — PHOTOS · **photo** — INSPECTION · check + date — GEC ACCESS CONFIRMED · check |
| 10 | Foundation Electrical / Blockouts | `comm.precon` | DRAWINGS OVERLAID · check — SERVICE CONDUITS · SLEEVES · FEEDERS · GEN / XFMR CONDUITS · SITE LIGHTING · LV PATHWAYS · GROUNDING · ROOM PENETRATIONS · HOUSEKEEPING PADS · checks (N/A-able) — BLOCKOUTS BEFORE POUR · check |
| 11 | Building Underground | `comm.precon` | TRADE OVERLAY · check — LAYOUT DONE · check — BANKS / CROSSINGS FIRST · check — CLEARANCES · check — STUB-UPS SET + SECURED · check — CAPPED / SEALED · check — PULL STRINGS · check — PHOTOS + DIMENSIONS · **photo** — CONDUIT CHECK · check — INSPECTED BEFORE COVER · check + date |
| 12 | Slab-on-Grade Coordination | `comm.precon` | FLOOR BOXES · EQUIPMENT FEEDS · KITCHEN · ISLANDS / CASEWORK · FLOOR RECEPTS · MECHANICAL · SPECIALTY · LV SLEEVES · checks (N/A-able) — DIMS FROM CONTROL LINES · check — PRE-POUR CHECKLIST / INSPECTION · check + date |

**Gate:** `commPhase(j)` (above) is the only state. `commPhaseChecked(j, n)` = every item in
phase *n* done or N/A (tracker items evaluate their rule). A phase is *closed* when checked
**or** `start.overrides[n]` exists. **"Ready to start"** = all twelve phases closed
(`commPhase(j) === null`) — a derived Job Board stage, not a separate flag. That is the
moment the job leaves pre-construction and a foreman and crew can be put on it.

### 6.3 The two trackers (logs, not chips)

Steps 3, 4 and 5 are one thing seen three times: **a long-lead item moving from requested to
on-site**. One log row per item, columns straight from Koy's steps:

```js
commercial.submittals: [{
  id, item:"Switchgear", vendor:"CED" | "FA Co." | "…", system:"gear",   // system from the §6.4 checklist
  requestedAt, leadTimeWeeks, priceConfirmed:true,                        // step 3
  status:"requested"|"submitted"|"revise"|"approved"|"approvedAsNoted",   // step 4
  submittedToGcAt, approvedAt, comments:"",
  poNo, releasedAt, promisedShip, requiredOnSite, shipMode:"complete"|"split", // step 5
  deliveredAt, storage:"",                                                //
  lastCheckedAt, lastCheckedBy,                                            // weekly gear check
}]
commercial.rfis: [{ id, no, question, sentAt, sentTo, answeredAt, answer, blocks:"purchasing"|"underground"|"" }]
```

Default rows offered on first open (deletable): switchgear, switchboards, transformers,
panelboards, generator / ATS, meter equipment, lighting package, lighting controls, fire
alarm, specialty. The Job Start board shows a **GEAR** summary pill per job
("3 approved · 2 released · 1 late") and turns red when `promisedShip` is past and
`deliveredAt` is empty, or `requiredOnSite` is inside 14 days with no `promisedShip`.

### 6.4 Job-level facts the steps fill in (on Job Info, commercial block)

- **Scope by system** (step 2): `commercial.systems: { gear, distribution, lighting,
  lightingControls, branchPower, fireAlarm, lowVoltage, siteElectrical, generatorAts, ev, other }`
  — a checklist of what this job has. This is the commercial twin of Job Sections: later
  phases and the submittal log are grouped by system, and a system that is off simply
  doesn't appear.
- **Milestone dates** (steps 2 and 6): `commercial.milestones: { tempPower, footing,
  underground, slab, walls, ceilings, permPower, startup, final }` — `M/D/YYYY` via
  `DateInp`. These are the dates the Forecast / Crew Planner shows for a commercial job, and
  the dates the nudges in §6.5 key on.
- **Fields:** `permitBy` (us / GC / other), `tempPowerOwner`, plus the §3 commercial block.

### 6.5 Rows on My Day (auto-tasks, commercial rules)

| Row | Owner | Fires while |
|---|---|---|
| "Phase <n> · <phase name>: <job>" | the phase's owner hat (`comm.precon`, or `comm.site` for phase 6) | the job's current phase is *n* — one row per job, it changes owner as the job advances |
| "Owed: <item> on <job>" | the owning hat of that item's phase | an item in an earlier phase was left owed by a move-on override (never clears until checked — same as residential) |
| "Gear check: <job>" (weekly, Monday) | `comm.precon` | any submittal row released and not delivered — Koy's *"don't wait until the promised delivery date to discover a delay"*. Done stamps `lastCheckedAt` on every open row. |
| "Gear late: <item> on <job>" | `comm.precon` | `promisedShip` past, not delivered |
| "Ufer before pour: <job>" | `comm.precon` | `milestones.footing` within 7 days and phase 9 not closed |
| "Underground before slab: <job>" | `comm.precon` | `milestones.slab` within 7 days and phase 11 not closed |
| "Ready to start — assign a foreman: <job>" | `comm.head` | all twelve phases closed and the job has no foreman / no Crew Planner assignment |

All rows use the existing `computeTasks` shape (`category`, `jobId`, `dueDate`, cleared via
`clearedTasks`), so Push / snooze / Done / verify work unchanged. Owners resolve through hats
exactly like `resi.head`. Server nudges for these are Phase 2 (client rows are enough to start).

### 6.6 The Job Start board (top-nav tab, replaces the "Pre-Con" tab in the earlier draft)

Nav key `jobstart`, label **Job Start**, perm `commstart.view` (admin, manager, standard —
foremen see it read-only; editing needs `comm.precon` / `comm.site` / `comm.head`). Layout
(see mockup):

- **Header:** JOB START · counts: active (in a phase) · items owed in earlier phases ·
  ready to start (all twelve closed).
- **Grouped by phase**, 1 → 12, each group a collapsible section headed "PHASE 5 · RELEASE /
  ORDER LONG-LEAD GEAR · Brady · Justin" with the job count; empty phases are hidden. Inside,
  **one card per job in that phase**, sorted by nearest milestone. Card header: name, GC,
  foreman, the milestone strip (footing / underground / slab dates), the GEAR pill, and a
  **12-segment phase bar** (done teal · current blue · owed amber · upcoming grey).
- **The current phase's checklist is open on the card**: the item chips (tap: ○ → ✓ → N/A,
  same tri-state as the residential tab), tracker items open the log inline, photo items
  show the attacher, the phase note, and **MOVE ON WITH ITEMS OWED**. Checking the last item
  animates the card into the next phase's section. Tapping an earlier segment of the bar
  expands that phase read-only with its ✓ / OWED items (owed items stay tappable); later
  segments show a greyed preview.
- **Filters:** search, foreman, **Mine** (phases I own — the section list shrinks to those),
  Show complete (jobs past phase 12).
- Every write is a single-key patch through `saveJob` (`commercial.start.items["9.photos"]`
  etc.), so two people checking different steps on the same job never collide beyond the
  existing debounce/merge.

The same component mounts inside the job card as the **Job Start** tab (drawer twin), the way
`JobPrepDrawerOverride` twins the board today.

## 7. The commercial job lifecycle

### Stage board (`COMM_STAGE_SECTIONS`, replaces rough/finish on the commercial Job Board)

| Stage | Test | Colour |
|---|---|---|
| **Pre-Con** | `commPhase(j)` in 1–12 — row pill shows `PHASE 3 · SUBMITTALS`; every job starts here | teal |
| **Ready to Start** | `commPhase(j) === null` (all twelve closed) and `stage === ""` — waiting on a foreman and a crew | green |
| **In Progress** | `stage === "inprogress"` — set from the Job Info pill when the crew mobilizes (Phase 2: auto when the Crew Planner first schedules the job) | blue |
| **On Hold** | `stage === "hold"` | amber (app's existing hold colour) |
| **Closeout** | `stage === "closeout"` | purple |
| **Complete** | `stage === "complete"` | green, collapsed by default |

`commercial.stage` is set from a pill on Job Info (like `InProgressModePill`), with a date
stamp. There is no rough % / finish %; Phase 2 adds per-area phase tracking (below) for the
on-site work (temp power → underground → slab → walls → ceilings → permanent power → startup
→ final, Koy's milestone list) — that is where the foreman's checklists live.

### Job card tabs (`COMM_TABS`, used by `tabsForJob` when `isCommercial(job)`)

Phase 1: **Job Info · Activity · Photos · Plans & Links · Job Start · Gear & Submittals · RFIs · Change Orders · Open Items**

- **Job Info** (commercial layout): name, address, GC + GC contacts (existing fields), then
  the commercial block: project #, GC PM, GC super + phone, contract value, permit # +
  permit-by, plan set rev, site hours, badge / orientation, parking, laydown, temp-power
  owner; **Scope by system** checklist; **Milestones** dates. Foreman / lead pickers
  unchanged. Division control (§3). Stage pill. Job Sections panel still applies.
- **Job Start**: §6.6 inside the drawer.
- **Gear & Submittals**: the §6.3 log as a table (phone: cards), status chips, PO / ship /
  required-on-site dates, late highlighting, "Mark checked" for the weekly review.
- **RFIs**: the §6.3 RFI log — number, question, sent to, answer, what it blocks.
- **Activity / Photos / Plans & Links / Change Orders / Open Items**: the existing components
  as-is. Plans & Links gets rows for **Spec book**, **Submittals folder**, **GC schedule**.
- **Not on the commercial card**: Rough, Finish, Questions (floor-keyed), Home Runs, Panelized
  Lighting, Tape Light, Return Trips, QC. Questions and Return Trips are the likeliest early
  returns (Q6).

Phase 2 (after one real job): **Phases** (areas × systems above the slab), **Punch**
(area-scoped), **Daily Log**, **Inspections** as first-class records, server nudges for §6.5.
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
| `commercial.view` | admin, manager, standard, limited | see the mode switch (everyone internal — crews work both, Koy 2026-09-25) |
| `comm.head` | hat (caps) — Brady | Head of Commercial — owner of commercial auto-tasks and duties nobody else's hat covers; falls back to `resi.head` |
| `commstart.view` | admin, manager, standard | see the Job Start board (foremen read-only) |
| `commstart.edit` | admin, manager (+ `comm.precon` / `comm.site` / `comm.head` hats) | check items, move on, edit the logs |
| `comm.precon` | hat (caps, shared) | Commercial pre-con — phases 1–5 (Brady, Justin) |
| `comm.site` | hat (caps, shared) | Commercial site coordination — phase 6 (Zane, Abe) |
| `job.division` | admin, manager | move a job between divisions |

Hats appear in Settings → Team Members → company hats, next to `resi.head` / `jobprep.own`.
Nothing is hardcoded to a person (the `resiHead(users)` rule).

## 9. Open questions for Koy (answers change the build)

### Answered 2026-09-25

1. **Who runs commercial?** Koy: *"Crews can be on both but there will probably be people who
   do mostly commercial."* → Decisions:
   - `commercial.view` is granted to **everyone internal** (all four tiers) — no
     `commercial.crew` hat. Anyone can flip the switch, because anyone may be sent to a
     commercial job. (§8 updated.)
   - **`defaultMode` on the user record ships in Phase 1**, not 1.5: Settings → My
     Preferences ("Land in: Residential / Commercial"), and Team Members can set it for a
     person. The mostly-commercial people land on the commercial My Day; everyone else lands
     exactly where they do today.
   - The Crew Planner stays one company-wide planner (the "busy on a resi job" rule in §5).
     Q8 is therefore only about presentation, not a second planner.
2. **Can Simpro tell us?** Koy: *"simpro does flag resi or commercial in the jobs settings →
   business group."* → Decisions:
   - **Simpro's Business Group is the source of truth for `division` at import.** The
     candidate poller adds `BusinessGroup` to the columns it requests, stores
     `businessGroup: "<Name>"` on each candidate, and the import pre-sets `division` from it
     — the import gets no division picker unless the group is missing or unmapped, in which
     case it defaults to the current mode and shows an "unmapped group" hint.
   - The mapping is a small map in `config/app` (`commercialBusinessGroups: ["Commercial"]`,
     matched case-insensitively) so a renamed or added group is a settings edit, not a
     deploy. The Job Info **Division** control (§3) stays as the manual correction.
   - **Existing jobs:** the same poller run reports every app job whose Simpro business
     group is commercial but whose `division` is absent, into
     `settings/simproCandidates.divisionMismatches`. Settings → Simpro shows the list with
     an admin-only **Apply** per row (writes `division` only, through `saveJob`). Nothing is
     backfilled automatically. This is how today's already-running commercial jobs get their
     division without hand-editing.
   - Before any of this is built, run `node scripts/simpro-discover.js` once (two probes
     added 2026-09-25: the setup list of business groups and `BusinessGroup` as a bulk
     `/jobs/` column) — this tenant silently rejects unknown bulk columns, so the field name
     has to be confirmed against real data first. If the bulk list refuses it, the poller
     reads it from the per-job detail fetch the auto-pull already does.
   - Follow-up decision for Koy: if a job's business group changes in Simpro after import,
     should the app follow it (poller flips `division`) or only flag it? Proposed: **flag
     only** (same mismatch list), never silently move a live job between boards.

3. **Pre-con checklist.** Answered by the pasted *Commercial Electrical Job Start Process*
   (§6.2) — Brady/Justin own it, Zane/Abe own step 6, every step is pre-construction, and
   **Brady is Head of Commercial** (`comm.head`).

### Still open

3b. **Phases 7–12 owner:** defaulted to Brady/Justin (`comm.precon`). Should any of site
    takeoff / temp power / Ufer / blockouts / underground / slab coordination sit with
    Zane/Abe (`comm.site`) instead? One-word answer per phase is enough.
3c. **Foremen on the Job Start board:** read-only as proposed, or hidden entirely until the
    job is Ready to Start?
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
  `commPhase`, `phaseChecked`, `owedItems`, the tracker-item rules, and the mode filter;
  cases: absent division → resi; `"commercial"` → commercial; unknown string → resi; a fresh
  job → phase 1; last item of phase 3 checked → phase 4; a move-on override on phase 4 with
  two items open → phase 5 with two owed items; un-checking a phase-2 item from phase 7 →
  back to phase 2; all twelve closed → `null`; a submittal row with PO + released date
  satisfies "RELEASED + PO", a row without doesn't.
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
- **New SOP guides:** `public/sops/jobstart.html` (the Job Start board and phases) and a short
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
- [ ] Job Start board: jobs grouped by current phase (1–12), the current phase's checklist open on the card, checking the last item rolls the job into the next phase with a toast, move-on override per phase with audit stamp + owed badges + Undo, header counts, look-back / peek on the phase bar.
- [ ] Owners resolve by hat: phases 1–5 and 7–12 → `comm.precon`, 6 → `comm.site`, fallback `comm.head`; never the foreman; one "Phase n: <job>" My Day row per job, changing owner as the job advances; owed items keep their rows.
- [ ] All twelve closed → the job shows under Ready to Start; nothing in the process is gated on a foreman or on-site work.
- [ ] Gear & Submittals log drives the phase 3 and 5 tracker chips; late rows flag the GEAR pill.
- [ ] Offline save, backup snapshot and restore all operate on `allJobs`.
- [ ] Deep links from pushes / My Day / Needs auto-switch the mode.
- [ ] Residential-process functions skip commercial jobs; generic functions unchanged.
