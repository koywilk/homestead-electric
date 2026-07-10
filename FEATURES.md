# Homestead Electric — Feature Tree

Source of truth for every feature in the app, organized by area. The in-app App Map page (`/?appmap=1`) and the AI help box are grounded on a copy of this file that is synced into the bundle automatically at build time — see "How this file is maintained" at the bottom.

**Status legend:** `shipped` · `in-flight` · `planned`

**Last manifest update:** 2026-07-10 · App SW version: v320

---

## Top-Level Views (Nav Tabs)

- **Job Board** · `shipped` · the home screen
  - Grouped by stage with collapsible sections
  - Search bar (job name + CO quote number)
  - Foreman filter via tabs
  - Stage filter (rough/finish/QC/etc.)
  - Flag-only toggle
  - Drag-to-reorder within stage
- **Today** · `shipped 2026-05-21` · `SW v180` · cross-job command center (gated to admin/manager/foreman)
  - Pulse counters (active jobs, foremen on app, punches closed, COs added, photos, failed inspections)
  - Needs Attention (failed inspections, stale jobs, unassigned punches, COs missing quote #)
  - Live Activity feed (reverse-chrono across all jobs)
  - Jobs Today grid (jobs touched today, sorted by `lastActivityAt`)
  - Foreman Heartbeat row (green/amber/gray status per foreman)
  - Photos strip (thumbnails from jobs touched today)
- **Safety** · `shipped` · safety meetings / topics
- **Forecast** · `shipped` · `SchedulingForecast` · upcoming work calendar view
- **Nav** · `shipped` · `NavView` · map view of jobs
- **Upcoming** · `shipped` · `UpcomingJobs` · jobs in the pipeline before they're full jobs
- **Quotes** · `shipped` · proposed jobs awaiting conversion
- **Walks** · `shipped` · `QuoteWalksTab` · quote walks tracking
- **Tasks** · `shipped` · `Tasks` · cross-job and manual tasks
- **Huddle** · `shipped` · `HuddleSheet` · weekly team huddle prep
- **Subcontractors** · `shipped` · external contractor view
- **Scoreboard** · `shipped` · `ScoreboardV2` · admin-only, behavior-driven scoring (info + quality)
  - Foreman board
  - Lead board
  - Champions view
  - Drill-down per row
  - "How it works" panel
  - Weight editor (admin only)
- **App Map** · `shipped 2026-05-21` · `SW v183` · in-app feature tree (visible to everyone)
  - Renders FEATURES.md as collapsible tree with status badges
  - Search filter + expand/collapse all
  - Suggest-a-feature form (writes to `suggestions` collection)
  - Suggestion inbox + triage controls (admin/manager only) — status + notes + delete
- **Settings** · `shipped` · admin/manager only

---

## Job Detail (the heart of the app)

The biggest screen. Tabs inside Job Detail change based on job type (regular / quick / temp ped).

- **Job Info** · `shipped` · basics: name, address, customer, foreman, lead, Simpro #
  - Status pills with date windows
  - Finish stage cleanup + scheduled window (May 11–22) · `shipped 2026-05-17` · `SW v173`
  - InProgressModePill (rough/finish status with date picker)
- **Up Next panel** · `shipped 2026-05-19` · `SW v178` · `UpNextPanel` · `36-rule engine`
  - Sits between header and tabs
  - Primary button for literal next action
  - "▾ N more" expander
  - Calm fallback when nothing urgent
  - Snooze per rule (recent) · `_isSnoozed` helper + `getSnoozedUpNextRules`
- **Phase tracking** · `shipped` · rough / finish / QC phases each with their own tab + workflow
  - Rough phase
  - Finish phase
  - QC phase (separate from rough/finish punches)
- **Punch lists** · `shipped` · `PunchSection`, `PunchFloor`, `PunchItems`
  - Per-phase: rough, finish, QC
  - Per-floor: upper, main, basement
  - Per-room (custom names) plus general + hotcheck buckets
  - Item shape: `{id, text, addedBy, addedAt, done, checkedBy, checkedAt, assignedTo, photos}`
  - Punch assignments (`assignedTo` field) · `shipped 2026-04-26` · `SW v12`
  - "Assigned" tab in foreman view (cross-job)
  - Photos attachable per punch item
  - Convert punch → Return Trip
- **Change Orders** · `shipped` · `ChangeOrders`, `CoQuoteNumberField`
  - CO list with status pipeline (needs_sending → simpro_task → pending → approved → scheduled → completed)
  - Quote # field + searchable · `shipped 2026-05-15` · `SW v172`
  - CO photos
  - Email CO
  - Chat CO
  - Send to Simpro
- **Return Trips** · `shipped` · `ReturnTrips`
  - Items list per RT
  - Schedule RT
  - Photos per RT
  - Punch items linked to RT (PunchLinker)
- **Inspections** · `shipped`
  - Rough inspection (pass/fail + items)
  - 4-way inspection (rules 14/15/16)
  - Final inspection (rules 23/24)
  - QC walks (`QCWalkSection`)
  - Failed inspection → punch items
- **Photos** · `shipped` · `PhotoAttacher` · shared upload+thumbnail component
  - Per punch item
  - Per CO
  - Per RT
  - Per inspection
  - Per Q&A
- **Daily Updates** · `shipped` · `DailyUpdates`
  - Auto-roll from closed punches today · `shipped 2026-04-26` · `SW v12`
  - Manual updates
  - Email daily update
- **Job Notes** · `in-flight` · `JobNoteCard`, `JobNotesSection`, `JobNoteLine`
  - Phase-scoped checklist notes (rough/finish/general)
  - Multi-select promote to: CO, RT, Punch, PO, Call
  - Destination pickers: Punch / RT / CO / Call / PO (`JobNoteDestination*`)
  - Sits on top of Open Items (doesn't replace it)
  - REPLACES PhaseInstructions UI slot (Option A, 7-layer data safety migration)
- **Open Items** · `shipped` · `JobOpenItems` · unified visits/punch/purchase/calls backend
- **Phase Instructions** · `shipped` · `PhaseInstructions` (legacy slot, being replaced by Job Notes)
- **Materials** · `shipped`
  - Rough materials
  - Finish materials
  - Material orders (POs) per phase · `MaterialOrders`
  - Material tally · `MaterialTally`
  - Add to PO from punch
- **Q&A** · `shipped` · `QASection`, `QAList`
  - Rough questions
  - Finish questions
  - GC answer map (for sharing)
- **Plans tab** · `shipped` · `PlansTab`
- **Drive Files** · `shipped` · `DriveFilesSection`
  - Drive folder sync (`syncDriveFoldersToJobs()`)
  - Files upload (`FileUploadSection`)
- **Home Runs (panels)** · `shipped` · `HomeRunsTab`, `HomeRunLevel`
  - Per-floor home runs
  - Bulk paste home runs
  - Generator load section
  - Electrical panel schedules
  - FieldInk home-runs publish (mirror to the PDF markup app)
- **Savant Lighting** · `shipped 2026-05-18` · `SW v175` · slot-first rebuild
  - `SavantSlotFirstTab` (one screen per panel, slot list 1..N)
  - Tap empty slot to add, tap occupied to edit
  - Bottom sheet for forms (`SavantSheet`, `SavantSheetBody`)
  - Tandem feeder breaker support
  - Loads list (`LoadsList`)
  - Keypad section
  - (Savant V1/V1.5 editor chain removed in the 2026-07-10 cleanup · SW v319)
- **Panelized Lighting tab (Lutron / Control 4 / Crestron)** · `shipped` · system pills + lock, Loads / Keypads / Panel Loads sections, system-accent colors (blue = Lutron) · `SW v310`
  - **Plan Changes log ("Changes From Original Plan")** · `shipped 2026-07-09` · `SW v313–v317` · Lutron jobs, sits at the TOP of the tab
    - Rooms matching plan labels; items with change types Added / Moved / Removed / Changed (Moved carries from → to)
    - Per-change and job-level discussion threads with file/photo attach (`QAThread` reuse) — Tech Lighting asks, crew replies
    - "Incorporated" green line once Tech Lighting folds a change into plans + quote
    - Copy-summary buttons for email pastes
  - **On Tech Lighting's link checkbox** · `shipped 2026-07-09` · `SW v315` · office-only (`lutron.manage`), confirm on uncheck; same flag as the Plan Changes hide/Restore
- **Homeowner Q&A** · `shipped` · `HomeownerPage`
  - Submit answers via share link
  - Lighting collab section
  - Generator page: confirm-first flow + amps/volts · `shipped 2026-07-08` · `SW v307`
  - Generator page crash fix · `shipped 2026-07-10` · `SW v320` · restored `WIRE_BREAKER`/`wireAmpsVolts` + Savant V2 slot helpers wrongly deleted as dead code in the v319 cleanup (blank-screened homeowner generator links); crew-board needs-date `endKey` ReferenceError fixed
- **Status Update inline** · `shipped` · `StatusUpdateInline`
- **Bid Items Panel** · `shipped` · pulls Simpro cost centers

---

## Sharing & External Pages

Pages designed to be opened by people outside the company via share links (no auth).

- **Homeowner page** · `shipped` · `HomeownerPage` · `?homeowner=`
- **Home Runs share** · `shipped` · `HomeRunsSharePage`
- **Lighting collab share** · `shipped` · `LightingSharePage` · `?lighting=` · LV company adds module/channel assignments; per-row three-way merge so a stale tab can't drop rows · `SW v313`
- **Panelized loads share** · `shipped 2026-07-07` · `SW v305` · `LoadsSharePage` · `?loads=` · read-only, baseline-locked
- **Lighting hub (Tech Lighting portal)** · `shipped 2026-07-08` · `SW v308/v315` · `LightingHubPage` · `?lightinghub=1` · lists every on-link Lutron job, "to review" + "replies" badges, auto-refetch on refocus, Try-again error state
- **Plan Changes share** · `shipped 2026-07-09` · `SW v313` · `LutronAdditionsSharePage` · `?lutronshare=<jobId>` · per-job change list, Mark incorporated (+ undo, plan-rev note), questions with attachments, job discussion; honors the On-their-link switch
- **Punch share** · `shipped` · `PunchSharePage`
- **Questions share** · `shipped` · `QuestionsSharePage`
  - Answers/notes/photos AUTO-SAVE as recipients type (no Submit needed); Submit stays the formal "done" that closes questions · `shipped 2026-07-09` · `SW v314`
  - Discussion replies live in `homeowner_requests.questionThreads` (side doc — crew saves can never wipe them) · `SW v313`
  - Respondent name badges (replaces hardcoded "GC") · `SW v316`
- **Job Note share** · `shipped` · `JobNoteSharePage`
- **All public pages**: error toasts render (HEToastHost mounted), failures speak instead of silently dropping input · `SW v315`

---

## Cross-Job Tools

- **Tasks** · `shipped` · `Tasks`, `TaskCard`, `AddTaskForm`
  - Manual tasks (Firestore `manualTasks` collection)
  - Per-foreman task filtering
  - Pre-job prep tasks
- **Crew Planner V2** · `in-flight` · `SimproCrewSchedule`
  - Compact rows, click-cell picker
  - Foreman filter
  - Simpro-driven pill date
  - Availability grouping
  - Mon-Fri grid
  - **Coming:** push schedule to Simpro (instead of duplicating)
  - **Coming:** pull in all dated events (inspections, 4-way, QC walks, RTs)
- **Scheduling Forecast** · `shipped` · `SchedulingForecast`
- **Plan Changes view** · `shipped 2026-07-09` · `SW v313–v317` · `LutronAdditionsView` · nav More → Plan Changes
  - Every Lutron job, unprocessed + awaiting-reply badges, awaiting-first sort
  - Reply to Tech Lighting questions inline; job-level discussions
  - "Manage their link" master list (office-only) — see/edit every job's on-link state in one spot · `SW v317`
- **Needs board** · `shipped` · coordinator board for deadline-bound contractor call-ins (`needs` collection)
- **Redline walks → CO tracking** · `shipped 2026-07-08` · `SW v306` · quoted walks surface in the Change Orders board
- **Huddle Sheet** · `shipped` · `HuddleSheet`, `HuddleConfigPanel`
- **Quote Walks** · `shipped` · `QuoteWalksTab`, `QuoteWalkDetail`
- **Job Activity (per job)** · `shipped` · `JobActivity`
- **Job Photos (per job)** · `shipped` · `JobPhotos`

---

## Office Tools (Settings + Admin)

- **Settings page** · `shipped` · `SettingsPage`
  - Activity log · `ActivityLog`
  - Notification Doctor · `NotifDoctor`
  - Fleet Notification Health · `FleetHealth` (admin only)
  - Devices — app versions · `DeviceVersionsCard` (admin only) · fleet list vs latest deployed version, stale devices glow red · `shipped 2026-07-10` · `SW v318`
  - User management · `UserManagement`
  - Color overrides
  - Backup / restore + Force Update All Devices
- **Huddle config** · `shipped` · `HuddleConfigPanel`
- **Scoreboard weights editor** · `shipped` · admin only
- **Backup-status banner** · `shipped 2026-07-09` · `SW v313` · red strip for admin/manager when the nightly Firestore backup is missing or >48h stale

---

## Shared Components & Utilities

- **PhotoAttacher** · `shipped` · reusable upload widget — used by COs, punches, RTs, walks
- **Icon** · `shipped` · SVG icon registry (`ICON_PATHS`, ~80 icons)
- **Spinner** · `shipped` · loading indicator
- **Section** · `shipped` · collapsible group component
- **EmailModal** · `shipped` · email composer
- **UserPicker** · `shipped` · user selection modal with PIN
- **InProgressModePill** · `shipped` · status + date pill for phases
- **NeedsAttention** (per job) · `shipped` · per-job version of cross-job Needs Attention
- **StatusUpdateHover** · `shipped` · status note hover preview
- **HEConfirmHost / HEToastHost** · `shipped` · confirm dialogs + toasts
- **FromJobNoteBadge** · `shipped` · "from Job Note" attribution
- **RoomNameEdit** · `shipped` · rename rooms inline
- **QuickJobCard / QuickJobDetail** · `shipped` · simplified job for quick entries
- **TempPedCard / TempPedDetail** · `shipped` · temporary pedestal jobs

---

## Infrastructure

- **Service Worker** · `shipped` · network-first cache; version bumps trigger fleet-wide refresh
  - Current: `v181`
  - Bumped on every deploy that changes bundle
- **Firestore offline support** · `shipped` · `persistentLocalCache` + `persistentMultipleTabManager`
- **Push notifications (FCM)** · `shipped` · per-foreman; `FCM_MSG.data` shape (NOT `webpush.notification.data`)
- **PWA manifest** · `shipped` · installable on iOS/Android
- **Backup system** · `shipped`
  - localStorage `hejobs_backup` (per-device snapshot)
  - `__HE_RESTORE` (manual restore — admin console only)
  - Backup by email (`backupByEmail`)
- **Drive sync** · `shipped` · `syncDriveFoldersToJobs()` (around App.js L3517)
  - Parent folder ID: `1laC4udt1sBdV-_QUMzzbKJfD03q4_Ml3`
  - `namesMatch()` helper for tolerant folder→job matching
- **Simpro sync** · `shipped` · `simproCandidates` doc, Simpro import flow
- **Activity tracking (lastActivityAt)** · `shipped 2026-05-21` · `SW v180`
  - `lastActivityAt: serverTimestamp()` on all 7 job-write paths
  - Loader at L44066 preserves the field through unwrap
  - Drives the Today command center's activity sort + staleness
- **Smart merge on reconnect** · `shipped` · `_smartMergeForReconnect`
- **Debounced save (`saveJob`)** · `shipped` · hot path for all job mutations; three-way merge + per-tab echo identity (`TAB_ID`, Kweller burst-wipe fix) · `SW v312`
- **Pending patches queue** · `shipped` · `pendingPatches.current` per-job patch accumulator
- **Force update mechanism** · `shipped` · admin can push `config/app` doc to force fleet refresh
- **Always-current auto-update** · `shipped 2026-07-10` · `SW v318` · bundle-baked version (prebuild) vs served SW version; safe self-reload (never mid-typing / with unsaved work), bottom-left update pill, loop guard, device-version pings
- **Link Safety funnel** · `shipped 2026-07-09` · `SW v313` · every `homeowner_requests` write goes through `saveHomeownerRequest` with version snapshots (last 10 per job, `versions` subcollection) — any clobber is a 2-minute restore
- **Nightly Firestore backup** · `shipped 2026-07-09 (deployed)` · 1:00 AM MT cloud function, 30-day retention in Storage `backups/`, `runBackupNow` manual trigger, `settings/backupStatus` stamp feeding the in-app banner

---

## Permissions Model

- **Access tiers** (highest → lowest): `admin` · `manager` · `standard` (foreman) · `limited` (lead/crew)
- **Permission feature flags** (`PERMISSIONS` map at ~L2770):
  - `tasks.view` / `tasks.addTask` / `tasks.setDueDate`
  - `schedule.view` / `schedule.edit`
  - `pipeline.view` / `pipeline.manage`
  - `reports.view`
  - `settings.view`
  - `users.manage`
  - `job.delete` (admin only)
  - `quotes.view` / `quotes.convert`
  - `scoreboard.view` / `scoreboard.editWeights` (both admin only currently)
  - `today.view` (admin/manager/standard) · `shipped 2026-05-21`
  - `board.view` / `board.add` (admin/manager/standard) · Needs board
  - `lutron.view` (everyone) · Plan Changes nav tab
  - `lutron.manage` (admin/manager) · On-Tech-Lighting's-link checkbox + hide/Restore · `SW v315`

---

## In-Flight & Planned

- **Job Notes** · `in-flight` · phase-scoped checklist notes (rough/finish/general) — REPLACES PhaseInstructions UI slot
- **Crew Planner V2 polish** · `in-flight` (since 2026-04-26)
- **Crew Planner → push schedule to Simpro** · `planned` · turn the planner into a real Simpro scheduling source (so it stops duplicating)
- **Crew Planner → pull in all dated events** · `planned` · inspections + 4-way + QC walks + RTs as rows in the week grid
- **External read-only API for coworker** · `planned` · small Cloud Functions API with key auth + whitelisted fields for coworker's material-forecasting tool
- **App Map artifact** · `shipped 2026-05-21` · this Cowork artifact (you're looking at the data right now)
- **Scoreboard celebration UI** · `planned` · pivot from iterating weights to celebration design

---

## Separate Projects

- **PDF Markup App** · `in-flight` (planning stage)
  - V3 architecture: Drawboard + Morpholio Trace hybrid with layers
  - QC redesign: QC walk items feed into roughPunch/finishPunch with `fromQC` tag

---

## Conventions & Rules

These exist to keep the codebase consistent and avoid past incidents.

- **No emojis in app UI** — use `<Icon name="..."/>` component (SVG paths in `ICON_PATHS`)
- **Mobile + desktop parity** — every flow works on both, no mobile-first or desktop-only designs
- **Features over refactor** — don't propose standalone refactors; lift code only when touching it for a feature
- **Data safety explanation** — every change needs a specific "why this won't lose data" line
- **Complete Firestore rules** — partial rule deploys have broken prod; always include catch-all
- **Verify before replacing** — never overwrite `functions/index.js`, `firestore.rules`, or SW from an old snapshot
- **Don't add fields to `webpush.notification`** — use `FCM_MSG.data` instead (a `data` field on `webpush.notification` killed all pushes silently once)

---

## How this file is maintained

This file is the source of truth. The in-app App Map page (`/?appmap=1`) and the AI help box are grounded on `FEATURES_MD_INLINE` in `src/App.js`, which is **synced from this file automatically by the prebuild script** (`scripts/version-from-sw.js`) on every `npm run build` — the bundled copy can no longer drift from this file.

Enforcement: **the build FAILS if this file does not mention the service-worker version being shipped** (e.g. `v319`). That means every deploy that bumps the SW cache must also add or update at least one entry here tagged with that version — a feature can't ship without its App Map entry, by construction (Koy, 2026-07-10: "the app map should be flipped and updated whenever one of the features there is built").

If you spot a feature missing, just tell me and I'll add it.
