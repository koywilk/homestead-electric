# Homestead Electric — Feature Tree

Source of truth for every feature in the app, organized by area. The Cowork "App Map" artifact reads this file and renders it as a collapsible tree with status badges and ship dates.

**Status legend:** `shipped` · `in-flight` · `planned`

**Last manifest update:** 2026-05-21 · App SW version: v181

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
  - Meter loads
  - Breaker counts
  - Generator load section
  - Electrical panel schedules
- **Savant Lighting** · `shipped 2026-05-18` · `SW v175` · slot-first rebuild
  - `SavantSlotFirstTab` (one screen per panel, slot list 1..N)
  - `SavantPanelSchedule`, `SavantPanelSimple`, `SavantPanelCard`
  - Tap empty slot to add, tap occupied to edit
  - Bottom sheet for forms (`SavantSheet`, `SavantSheetBody`)
  - Tandem feeder breaker support
  - Loads list (`LoadsList`)
  - Keypad section
  - Master loads (`SavantMasterLoadsList`) — still available for review
- **Homeowner Q&A** · `shipped` · `HomeownerPage`
  - Submit answers via share link
  - Lighting collab section
- **Status Update inline** · `shipped` · `StatusUpdateInline`
- **Bid Items Panel** · `shipped` · pulls Simpro cost centers

---

## Sharing & External Pages

Pages designed to be opened by people outside the company via share links (no auth).

- **Homeowner page** · `shipped` · `HomeownerPage` · `/homeowner/:jobId`
- **Home Runs share** · `shipped` · `HomeRunsSharePage`
- **Lighting share** · `shipped` · `LightingSharePage`
- **Punch share** · `shipped` · `PunchSharePage`
- **Questions share** · `shipped` · `QuestionsSharePage`
- **Job Note share** · `shipped` · `JobNoteSharePage`

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
- **Bulk Edit Table** · `shipped` · admin tool · `BulkEditTable`
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
  - User management · `UserManagement`
  - Color overrides
  - Backup / restore
- **Huddle config** · `shipped` · `HuddleConfigPanel`
- **Scoreboard weights editor** · `shipped` · admin only

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
- **Debounced save (`saveJob`)** · `shipped` · hot path for all job mutations
- **Pending patches queue** · `shipped` · `pendingPatches.current` per-job patch accumulator
- **Force update mechanism** · `shipped` · admin can push `config/app` doc to force fleet refresh

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

This file is the source of truth. The Cowork "App Map" artifact reads it (via `mcp__workspace__bash` to run `cat` against the repo) and renders it as a collapsible tree.

When something new ships:
- I (Claude) update this file alongside the App.js change as part of the same commit
- The Monday cron task that refreshes the `homestead-electric-app` skill also checks this file for drift and offers an update

If you spot a feature missing, just tell me and I'll add it.
