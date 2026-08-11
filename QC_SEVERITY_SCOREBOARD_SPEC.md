# QC Severity + Scoreboard Fairness — Design Spec

**Author:** Koy (with Claude) · **Date:** 2026-08-10 · **Status:** APPROVED DESIGN — not yet built
**Surfaces:** QC sections (Rough/Finish tabs), QC status pill (everywhere it renders), Return Trip creation, Open Items tab, **ScoreboardV4** quality math

> ### CORRECTION R1 (2026-08-10, discovered during build)
> The scoring sections below were written against **`ScoreboardV3`, which is dead code.**
> The live route renders **`ScoreboardV4`** (shipped 2026-07-16, SW v337/v339, admin-gated),
> whose dimensions are `{ margin: 45, qc: 25, handoff: 20, app: 10 }` with
> `NORM = { margin: v/50, qc: 1 − v/8, handoff: 1 − v/20, app: v/2500 }` and weights doc
> `settings/scoreboardV4Weights`. Read the scoring sections with these corrections:
> - **First-time inspection pass:** already absent from the live board — nothing to remove.
> - **Shared Links:** does not exist on the live board — ignore every reference to it.
> - **The QC cliff is real on V4 too**, at `1 − items/8` instead of `/6`. The severity redesign
>   stands unchanged; only its landing site moves.
> - **Margin is 45% of the live board** and is untouched by this design.
> - Verified live board (all jobs, default weights): Keegan 83, Daegan 66, Gage 65, Abraham 52,
>   Josh 49, **Vasa 47, Colby 47** — confirming Koy's report exactly (Vasa last, tied with Colby).
>   Gage scores **0 of 25 QC points** at 10.6 items/walk despite the best margin in the company
>   (55.8%) — the clearest single case of the unfairness this ship fixes.
>
> The authoritative build document is `QC_SEVERITY_IMPLEMENTATION_PLAN.md` **REVISION R1**,
> which is retargeted to V4. Where this spec and that plan disagree, the plan governs.
**Origin:** Koy: "the scoreboard feels a little unfair… on QCs there needs to be a different option besides QC fail — sometimes it's not a fail, it's just some items we need to take care of."

---

## Problem (verified with live data, 2026-08-10)

Running `sb3Build` on the live jobs: **Vasa ties or beats Colby on 3 of 4 board
dimensions** (first-time pass 100% both, app usage 99 vs 97, handoff 84 vs 80) —
the entire rank gap comes from **QC items per walk (6.0 vs 4.5)** hitting the
quality normalizer `1 − qcPerJob/6`, which maps 6 items/walk to **exactly zero
credit** (the cliff). QC item volume tracks JOB SIZE, not craftsmanship — a
foreman on monster customs collects more cosmetic items per walk than one on
small remodels doing identical work. Compounding it, the QC walk outcome is
binary: 3 caulk touch-ups and 15 real defects both get called "QC Fail," and a
fail auto-fires the whole return-trip machinery whether or not anyone needs it.

Decisions made in the brainstorm (Koy, 2026-08-10):
- Severity — not raw count — decides what a fail is. One serious item = fail;
  twenty cosmetic items ≠ fail.
- Severity lives ON EACH ITEM (default minor, one-tap Serious toggle); the walk
  verdict derives automatically. (Option A over per-walk judgment.)
- Return trips decouple from the verdict: site reality decides. Crew on site →
  no RT needed; nobody coming back → RT so it can't be missed. Both non-clean
  verdicts get the same explicit RT-or-crew choice; nothing auto-fires.
- Scoring is severity-dominant with a whisper of volume (Option B over pure
  severity): serious kills a walk's credit, heavy minor counts drag a little.

---

## Design

### 1 · Per-item severity

- QC punch items (`fromQC: true` items in `roughPunch`/`finishPunch` trees, and
  their RT clones) gain `severity: "minor" | "serious"`.
- **Absent = minor.** Zero migration: every historical QC item reads as minor,
  which regrades history gently the moment this ships.
- UX: one red chip/toggle on the QC item row (walker-facing, one tap, only
  used for safety/code/doesn't-work items). **Labels read "Minor QC item" and
  "Serious QC item"** — never bare "minor"/"serious" (Koy, 2026-08-10). No
  emoji — `<Icon>` + text per house convention. Also stamped onto RT clones at
  creation so the clone carries the same severity.

### 2 · Derived verdict (new middle status)

- `QC_STATUSES` gains `{value:"passed_items", label:"Passed with Items"}` in
  the app's amber (`#B0892C`), sitting between pass and fail. Existing values
  (`pass`, `fixed`, `fail`, …) unchanged — old data keeps its meaning.
- Derivation at walk completion (the existing QC section flow where the walker
  currently picks pass/fail): no open QC items → `pass` · only minor items →
  `passed_items` · ≥1 serious item → `fail`. The UI pre-derives and confirms —
  the walker never hand-picks the verdict. The existing "QC Items Fixed — Pass"
  (`fixed`) remains the terminal state once passed_items items all close.

### 3 · Return trip becomes an explicit choice

- On any non-clean verdict (passed_items OR fail), one prompt replaces the
  current auto-create: **"Return trip needed?"** / **"Crew on site is handling
  it."**
  - RT path: reuses the existing QC-fail RT machinery VERBATIM (scope
    "QC Fail — return trip needed" for fails; "QC Items — return trip" for
    passed_items; items cloned with `fromQC`/`originItemId`/`originPhase`,
    check-off sync both ways). No new RT semantics. IMPORTANT: both new RTs
    carry `fromQCFail: true` (the machine marker), and the "does a QC RT
    already exist" dedupe checks must key off that FLAG — today they string-match
    `scope.startsWith("QC Fail")`, which a passed_items scope would never match.
    Legacy string checks stay for old RTs; new checks read the flag.
  - Crew path: items stay on the punch list in normal flow. Record the call as
    additive fields on the job: `qcRtChoice: "crew"`, `qcRtChoiceBy`,
    `qcRtChoiceAt` (inside the data envelope — no loader change).
- **Remove the auto-RT-on-fail** at both QC Fail button sites (rough + finish;
  grep `QC Fail — return trip needed` / `fromQCFail:true` creation sites).
- **Safety net (what makes no-auto-RT safe):** Open Items gains a derived
  "Stranded QC items" row per job where ALL of: open `fromQC` items exist ·
  no un-signed-off RT contains their clones · no upcoming crew-schedule day for
  the job. Pure read-side derivation from existing data; zero writes.

### 4 · Scoreboard quality math (severity-dominant, volume whisper)

In `sb3Agg` / `sb3JobSignals` (ScoreboardV3):

- Per job-with-walk, replace the defect count with severity-aware counts:
  `seriousCount`, `minorCount` (severity absent → minor).
- Per-walk score: `walkScore = seriousCount > 0 ? 0 : 1 − min(0.5, minorCount/40)`
  — 0 minors = 1.0 · 20 minors = 0.5 · floor 0.5 (minors can cost half a walk,
  never all of it) · any serious = 0.
- `nQc = average(walkScore)` across jobs-with-walks, replacing
  `Math.max(0, 1 − qcPerJob/6)`.
- **First-time inspection pass is REMOVED from scoring entirely** (Koy,
  2026-08-10). Verified reason: status-implied passes make it a near-constant
  (100/100/100/95/85/82/75 across the live board, mostly implied rather than
  logged) — it diluted the QC signal without differentiating anyone. Quality
  becomes `nQc` alone: the Quality section IS the severity walk score. The
  `sbv3Inspections` helper, ftp counters, and the section's pass-% display all
  come out. Weights and every other dimension untouched.
- Section sub-label swaps "N QC/job" for "N% serious-free walks · avg M minor".
- Huddle sentence: **"don't have serious defects."**
- Expected effect on live data: Vasa's quality 50 → mid-70s (his 6.0 items/walk
  are all legacy-minor); board middle reorders on skill, not square footage.

### 4a2 · Update Discipline dimension — CONSIDERED AND REJECTED (Koy, 2026-08-10)

An update-discipline dimension (% of crew-scheduled days with a daily posted)
was added to the tuner, played with, and cut same-day — Koy: "remove it i hate
it." Recorded so a future session doesn't re-propose it. The board stays four
dimensions.

### 4b · EVERY constant is a knob (Koy, 2026-08-10: "make all the scoring
adjustable so I can fuck with it and get it where I want it")

All scoring constants move into one admin-tunable config, persisted as
ADDITIVE keys on the existing `settings/scoreboardWeights` doc (same write
path and `scoreboard.editWeights` gate as the shipped weights editor — no new
rules). Defaults reproduce current behavior exactly; missing keys fall back to
defaults, so old docs keep working:

```js
{
  weights: { quality:40, appUsage:25, sharedLinks:20, handoff:15 },  // existing
  qc:      { seriousCredit:0, minorDivisor:40, minorFloor:0.5 },     // §4 math
  appUsage:{ punchCap:300, updatesCap:40, questionsCap:60 },
  sharedLinksCap: 3,
  handoffDivisor: 40,
}
```

The weights editor grows into a grouped "Scoring" panel: numeric inputs with
plain-English labels ("minor items to cost half a walk", "punch items for full
app-usage credit"…), per-group reset-to-default, and the board re-ranks LIVE as
values change (sb3Agg already recomputes per render — it just reads the config
instead of literals). The mockup ships these as working sliders over the real
exported board rows so Koy can find the feel before anything is built.

### 4c · App Usage v2 — per-job completeness (RECOMMENDED, awaiting Koy's pick)

Prototyped 2026-08-10 with real data after Koy asked "what do you think is the
best way to measure quality and app usage." Instead of volume-vs-caps, each of
a foreman's jobs scores 0–100% for having (a) punch items logged, (b) dailies
posted, (c) questions used, (d) photos attached — his App Usage = the average
across his jobs. Rate-based, size-proof, un-farmable, and it names the fix
("Murphy has no dailies"). Real spread: 5% (Josh) to 95% (Gage) vs the volume
meter's 71–100 saturation; under it Gage jumps from last to 4th and Abraham
takes #1 from Keegan (83% vs 44% completeness). RESOLUTION (Koy: "volume speaks loud when it comes to app usage, but idk"):
**App Usage ships as a BLEND** — `appUsage = (1−mix)·volumeScore + mix·completeness`
with `appMix` (% completeness, default 50) as one more admin dial. Volume
rewards effort (un-fakeable at 1,500 items), completeness rewards discipline
(un-farmable by volume); the dial sets how loud each speaks, and 0/100 remain
reachable extremes. Completeness definition (tightened, verified on real data):
per real job (temp peds + quick jobs EXCLUDED, same as the board filter) —
has punch items (non-QC) · has dailies · has questions · has a photo ANYWHERE
on the job; each 25%, per-check inclusion/weights become knobs at build time. Quality upgrades from the same conversation, also recommended:
rolling window (last ~10 walks / 60 days) as THE score once walk dates exist,
and a serious-free STREAK stat displayed per foreman for huddle drama.

### 5 · Explicitly out of scope (this ship)

- Redesigning the App Usage / Shared Links FORMULAS. Their caps become knobs
  (§4b) so Koy can tune them himself — e.g. cranking `sharedLinksCap` or
  zeroing its weight kills the dead dimension without a deploy. Structural
  redesign only if knob-tuning can't get the feel right.
- Boards structure, monthly/yearly views: untouched.
- No tripwire timer for lingering minors (revisit only if stranded-QC rows show
  it's needed).

---

## Build order

1. **Clickable mockup FIRST** (Koy's standing preference): walk flow with the
   Serious toggle, derived-verdict pill, RT-or-crew prompt, and the new
   scoreboard quality sub-label. Get Koy's sign-off on the mockup before app
   code.
2. Data + UI: severity toggle, passed_items status, derived verdict, RT prompt
   (remove auto-create), stranded-QC derivation on Open Items.
3. Scoring: sb3 changes behind a dry-run script first (house pattern —
   `scripts/sb-*dryrun.js`): print old vs new board from live jobs, confirm
   with Koy, then wire the UI.
4. Ship with SW bump + FEATURES.md entry; huddle blurb for the crew explaining
   the new QC options and what the board now measures.

## Data safety

Additive only: new item field (`severity`), new status value (`passed_items`),
three new job fields (`qcRtChoice/By/At`) — all inside the `data` envelope, no
loader change, no rules change, no field removed or repurposed. Scoreboard
recomputes live from job data (nothing stored). The removed auto-RT is replaced
by an explicit prompt plus a read-only stranded-items surface, so the failure
mode it protected against (forgotten items after crew leaves) stays covered.
Legacy: absent severity = minor; historical `fail` statuses keep their meaning;
RT machinery byte-identical.
