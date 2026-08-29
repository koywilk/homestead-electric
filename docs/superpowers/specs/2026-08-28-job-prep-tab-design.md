# Job Prep Tab — Design Spec

**Date:** 2026-08-28
**Status:** Approved design + approved clickable mockup; awaiting implementation plan
**Visual spec:** `jobprep-mockup.html` (repo root) — token-faithful, clickable, fake data. The mockup is the authority on look and interaction feel; this document is the authority on data model and integration.
**Owner sign-offs so far:** design conversation 2026-08-28 (tab layout, N/A handling, override rules), mockup approved same day.

## Problem

1. Justin's three office-admin checkboxes — **Job account created** (`jobAccount`), **Pre-lien filed** (`preLien`), **Temp pedestal on site** (`hasTempPed` + `tempPedNumber`) — live only in a collapsed "Admin" section at the bottom of the Job Info drawer. There is no cross-job view; finding which jobs are missing a pre-lien means opening every job.
2. Pre-Job Prep (the 5-item `prepChecklist`) has no good cross-job surface either — only the drawer section and a Koy-only collapsed list inside Tasks that shows stage, not per-item status.
3. `allPrepDone()` requires **all five** checklist items — including **Cabinet Plans Received**, which routinely arrives mid-rough. One late item keeps the whole job in "Pre Job Prep" on the Upcoming Jobs stage board indefinitely, so jobs are never marked ready until they're already being roughed.

## Goals

- One office-only **"Job Prep" tab** (modeled on the CO tracker): cross-job board with two lanes — Office Admin (Justin's) and Pre-Job Prep (Koy's) — editable directly from the board.
- A **"Start without full prep" override** so a job can advance to Rough — Not Started with items still outstanding, without those items being forgotten.
- **N/A state** for admin items that genuinely don't apply (e.g. no temp ped on a remodel).

## Non-goals (explicitly out of scope for v1)

- No notifications/nudges for missing pre-liens or overdue prep.
- No per-item waive on the prep checklist (the job-level override covers the real workflow).
- No changes to the legacy `prepStage` dropdown or `PREP_STAGES` flow.
- No removal of the existing Tasks-view "JOB PREP" section or restructuring of the drawer sections. The **one deliberate drawer change** (part of the approved design, not a violation of this non-goal): the override button + badge are added to the drawer's Pre-Job Prep section — see Override semantics. Everything else in the drawer stays byte-for-byte.
- No `functions/index.js` changes in v1 (see the Cloud Functions rows in the consumer matrix).

## Data model (all additive, all inside `job.data`)

New fields — written through the existing `u()` → `saveJob()` funnel. **No loader change is needed**: only *top-level* meta fields require the jobs-loader spread (historically called "the L44066 loader"; today it lives at ~L51316 — `raw?.data ? {...raw.data, updated_at, _saved_by, _device, _tab, _merged, lastActivityAt}`); fields inside `data` unwrap automatically, and `normalizeJob` (~L24022) spreads `...raw` first, so `adminNA` / `prepOverride` survive drawer-local normalization too.

```js
// N/A markers for Justin's items. Absent map or absent key = "not N/A".
// The existing booleans keep their exact meaning (done = true).
adminNA: { jobAccount?: true, preLien?: true, tempPed?: true }

// The start override — an AUDIT STAMP, never auto-cleared (decision below).
prepOverride: { on: true, by: "<name>", at: "<ISO date>", note: "<optional>" }
```

Item state derivation (admin lane):
- **done** = existing boolean true (`jobAccount` / `preLien` / `hasTempPed`)
- **N/A** = `adminNA.<key>` true (and boolean false)
- **outstanding** = neither

Write semantics for all three menu transitions (the model is two independent fields, so each must be explicit):
- **Set N/A:** boolean → false, `adminNA.<key>` → true; ped item also clears `tempPedNumber`.
- **Mark done:** boolean → true, `adminNA.<key>` → deleted/false.
- **Mark outstanding:** boolean → false **and** `adminNA.<key>` → deleted/false (clearing only the boolean would leave the chip stuck on N/A); ped item also clears `tempPedNumber`.

The drawer's existing checkboxes keep working unchanged — they only ever toggle the booleans, which is compatible (checking a box on an N/A item renders as "done"; the tab's menu is the only place N/A is set/cleared in v1).

**Data safety:** purely additive nested fields; no existing field is renamed, retyped, or removed; every write path is the existing saveJob patch funnel; no new collections, so Firestore rules are untouched (rules deploy is a no-op — still verify complete rules per standing rule if any deploy happens). Old devices on a stale bundle ignore the new fields harmlessly; their saves flow through the same patch mode and don't strip them (patch mode writes only changed keys).

## The gate split (the override mechanic)

Replace the single `allPrepDone()` (App.js ~L1852) with two helpers:

```js
// STRICT — identical to today's allPrepDone, legacy prepStage fallback kept.
const allPrepChecked = (job) => { /* current allPrepDone body, renamed */ };

// CLEARED — strict OR override.
const prepClearedToStart = (job) => allPrepChecked(job) || !!job.prepOverride?.on;
```

Consumer matrix (this is the load-bearing table):

| Consumer | Location (approx) | Uses |
|---|---|---|
| Upcoming Jobs stage board — "Pre Job Prep" section test | ~L30306 | `prepClearedToStart` (negated) |
| Upcoming Jobs stage board — "Rough — Not Started" test | ~L30309 | `prepClearedToStart` |
| Auto-task builder ("Pre Job Prep: <job>", assigned Koy) | ~L31358 | **strict** `allPrepChecked` — task lives until every box is truly checked; desc gains an "OVERRIDE ACTIVE" marker when overridden |
| Job Info drawer "Pre-Job Prep" `defaultOpen` + complete line | ~L28716, ~L28738 | **strict** |
| New tab — prep lane membership, badges, counts | new | **strict** for lane membership; `prepClearedToStart` for the header "cleared to start" count |
| `PrepTaskList` (Tasks view) | ~L32518 | unchanged (still keyed on legacy `prepStage`) |
| **Cloud Functions — job-write trigger** ("Job Prep Complete" push to foreman + coordinator on not-done→done) | `functions/index.js` ~L656-667 (own duplicate `allPrepDone` at ~L79-85) | **strict — untouched in v1.** Correct as-is: the completion push should fire only when everything is truly checked. |
| **Cloud Functions — daily prep nudges** ("Job Starts in 1 Week — Prep Not Done" / "URGENT — Job Starts in 2 Days, Prep Incomplete" to Koy) | `functions/index.js` ~L1404-1418 | **strict — untouched in v1, consequence accepted:** an overridden job with outstanding items keeps firing these at Koy. That aligns with override ≠ forget, but it nags the person who overrode. Optional fast-follow (needs a functions deploy): skip the URGENT nudge when `prepOverride.on`. |

Within App.js the matrix is exhaustive — `allPrepDone` has exactly 6 hits (definition + the 5 rows above). `functions/index.js` keeps its own duplicate; do NOT rename it in v1.

Line numbers are landmarks, not gospel — re-grep at implementation time (App.js grows).

### Override semantics (decided)

- **Who:** admin + manager (gate UI with the existing tier check; the button simply isn't rendered for others).
- **Where:** button on the new tab's prep-lane row AND in the drawer's Pre-Job Prep section (this is the one drawer addition — see Non-goals).
- **Confirm modal:** lists the still-outstanding items, optional note, "Mark Ready to Start". Stamps `by`/`at` automatically.
- **Guard against the legacy auto-flip (required):** the Rough tab's stage handler (~L26512) auto-writes `prepStage:"Job Prep Complete"` the moment rough % > 0. For a job with NO `prepChecklist` object, `allPrepChecked`'s legacy fallback would then read strictly complete — silently dropping the overridden job's tracking with nothing checked. Therefore **confirming an override also initializes the checklist in the same patch**: `prepChecklist: { ...(job.prepChecklist || {}) }` (an empty object is enough — the checklist path then evaluates the five booleans and stays false until they're truly checked). The L26512 writer itself stays untouched.
- **Retention (decision, 2026-08-28):** `prepOverride` is **kept forever as an audit stamp** — matching the app's audit-field convention (`qcSignedOffBy` etc.). It is never auto-cleared by checking boxes. The OVERRIDE badge/note hide when `allPrepChecked` becomes true, and honestly reappear if a box is later unchecked. **Undo Override** (explicit button, shown while not strictly complete) sets `prepOverride` to `null` — the only clearing path.
- Overriding a job flips nothing else: `roughStartConfirmed`, statuses, and dates are untouched. The override only feeds `prepClearedToStart`.

## The tab

- **Nav:** new entry `{key:"jobprep", label:"Job Prep"}` in the top nav (~L53628), gated by new `PERMISSIONS["jobprep.view"] = ["admin","manager"]` (map at ~L3644); view mount in the router (~L55197 area) before the scoreboard route. **Namespace warning:** a `jobprep.own` cap ALREADY exists (~L3682, the "Job prep & redlines" company-hat checkbox, gating Coordinator Book company duties). It is per-user cap-granted with an empty tier default — the opposite gating style from the tier-gated `jobprep.view` being added. Neither the nav key `"jobprep"` nor `"jobprep.view"` collides with it, but do not "deduplicate" or touch `jobprep.own` — it is load-bearing for the Coordinator Book.
- **Which jobs:** full jobs only — exclude `j.tempPed` (temp-ped-only jobs), `j.quickJob`, and `j.type === "quote"`. Jobs whose finish is complete (`effFS(j) === "complete"`) drop off the tab entirely.
- **Sort:** both lanes ascending by `roughProjectedStart`, **parsed, never string-compared** — `DateInp` stores it as `M/D/YYYY` (its own comment: "Convert YYYY-MM-DD from browser to M/D/YYYY for storage", ~L5408), and legacy `YYYY-MM-DD` values also occur, which is why `parseAnyDate` (~L31378) exists. Sort with `parseAnyDate` (or `new Date(a) - new Date(b)` like the stage board does at ~L30359); missing/unparseable dates sink to the bottom. "Start soon" highlight when the parsed date is within 10 calendar days.
- **Header:** "JOB PREP" (Bebas 28), subtitle counts, defined exactly (over the tab's included job set, BEFORE search/foreman filtering):
  - **active jobs** = size of the included set (post-exclusions below);
  - **held in prep** (red) = `!prepClearedToStart(j)`;
  - **started on override** (amber) = `j.prepOverride?.on && !allPrepChecked(j)` — note this count DROPS as boxes get checked even though the stamp is retained forever;
  - **cleared to start** (green) = `prepClearedToStart(j)`.

  Counts are **always company-wide**; when search/foreman filter is active, append the "totals are all jobs — lanes below are filtered" hint (the lane pills count the filtered set). Controls: search, foreman filter, Show complete toggle.
- **Lane 1 — OFFICE ADMIN (blue #3B5BA5, "Justin's lane"):** row per job with name/simpro#/foreman dot/projected start/GC + three tri-state chips (ACCOUNT · PRE-LIEN · TEMP PED). Tap toggles outstanding↔done; the ▾ caret menu offers Mark done / Mark outstanding / Not needed; tapping an N/A chip opens the menu (deliberate exit). TEMP PED done keeps the existing Ped # select (`— select —`, "Ped #1"–"Ped #100", surface background, dim/400 until chosen then blue/700 — matches the drawer's control). Lane pill: "N no account · N no pre-lien · N no ped" (counts the filtered set). Complete rows (all three done-or-N/A) collapse into a green dashed strip.
- **Lane 2 — PRE-JOB PREP (teal #3E7D7A, "Koy's lane"):** row per job not strictly complete: the 5 checklist chips inline and tappable (no carets — binary items), legacy `prepStage` pill, "n/5" progress, "NEXT: <item>" hint, and the override button/badge/note. Complete strip as above.
- **Stage pill colors** — `prepStage` takes the 8 `PREP_STAGES` strings (~L1843), which do NOT map onto `REDLINE_STATUSES` (different vocabulary; the mockup's 4 sample pills are a simplification). Reuse the app's own precedent, `PrepTaskList.stageColor` (~L32533) — lift it to module scope or duplicate it:
  - `'Redline Plans Need to be Updated'` (= `PREP_STAGE_ALERT`) → red `#B23A3A`
  - `'Job Prep Complete'` → green `#3E7D5A` (rows with this stage are usually in the complete strip via the legacy fallback anyway)
  - any other known stage → position ramp: first ~third `#B0892C`, middle `#3B5BA5`, last ~third `#3E7D7A`
  - unset/unknown stage → gray `#5E6670`, label "No stage set"
- **Complete strips:** per-strip manual expand state that survives re-renders; the Show complete button sets both.
- **Empty states:** distinguish "no jobs match the filter" from the green all-complete message.
- **Row click** on the job name opens the standard job drawer (`setSelected`), same as the CO tracker.
- **Mobile parity:** verified in the mockup at 375px — chips wrap, no horizontal scroll, tap targets ≥ ~32px.

Standing-rule notes: no emojis (text glyphs ✓ ○ ▾ only, all already used in-app); amber `#B0892C` never leads the design — it appears only as the override accent and inside the app's own established stage colors (the stageColor ramp's early band, `co_sent`); light-theme `C` tokens throughout.

## Error handling / edge cases

- Job with no `prepChecklist` and no `prepStage`: strict check is false (all 5 outstanding) — appears in the prep lane as 0/5, exactly like today's stage board behavior.
- Legacy jobs where `prepStage === "Job Prep Complete"` but no checklist: `allPrepChecked` fallback returns true (unchanged from today) — they land in the complete strip, not the open lane.
- `prepOverride` on a job that later becomes strictly complete: badge hides, stamp retained (see decision).
- Overridden job with no `prepChecklist` when rough work starts: guarded by the override's checklist initialization (see Override semantics — otherwise the ~L26512 `prepStage` auto-flip would make it strictly complete with nothing checked).
- Concurrent edits: chip toggles are single-field patches through saveJob's debounce/merge like every other job mutation; no special handling needed. The tab re-renders from the live `jobs` snapshot like the CO tracker.

## Testing / acceptance

Mirror the mockup's verified behaviors in the real build: tri-state chip cycle incl. N/A menu round-trip; ped select appears/clears; admin row completes only when all three are done-or-N/A; override modal → badge/note → undo; overridden job appears under "Rough — Not Started" on Upcoming Jobs while its auto prep task and prep-lane row persist; strict completion moves the row to the strip and clears the auto task; sort order by `roughProjectedStart`; filter behavior and company-wide header counts; mobile at 375px. `CI=true npm run build` (never piped) before any handoff.

## Ship checklist (same ship, per standing rules)

- SW cache bump in `public/service-worker.js` (check current version at ship time — v386 was already sitting uncommitted in the tree on 2026-08-28, likely another session's in-flight work; collision-check before the one-paste).
- `FEATURES.md` entry (prebuild gate requires the SW version in it).
- **New SOP guide:** drop `public/sops/jobprep.html` with `<title>Job Prep — Office Guide</title>` in the file itself — **never hand-edit `SOP_FILES_INLINE`** (it's regenerated between the SOPS_START/SOPS_END markers by `scripts/version-from-sw.js` at prebuild, scanning `public/sops/` and reading each guide's own `<title>`). Because "Job Prep" is a top-nav view (not a job-drawer tab), the key `jobprep` only validates if the view mounts an explicit `<HelpDot section="jobprep"/>` (gcportal pattern, ~L43349) — the drawer's auto-mount doesn't cover top-nav views, and the prebuild only WARNS on an unmatched key, so a missing mount ships a tab with no "?". Add the guide to the vault recording checklist.
- Specific "why it won't lose data" note (see Data safety above).
- Daily vault log + vault feature note after ship.
