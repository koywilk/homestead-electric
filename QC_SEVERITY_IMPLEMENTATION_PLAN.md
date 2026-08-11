# QC Severity + Scoreboard V4 Implementation Plan (REVISION R1 — retargeted to the live board)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved QC-severity + scoreboard-fairness design (spec: `QC_SEVERITY_SCOREBOARD_SPEC.md`): per-item QC severity, derived three-tier QC verdicts, return trips by explicit choice, severity-based QC scoring, blended App Usage, and every scoring constant on an admin dial.

**REVISION R1 (why this document changed):** The original plan targeted `ScoreboardV3` (`sb3Agg`/`sb3Build`/`sbv3QC`). **That component is dead code.** The route at `src/App.js` renders **`ScoreboardV4`** (shipped 2026-07-16, SW v337/v339, admin-gated on `scoreboard.editWeights`) with a different dimension set: `{ margin: 45, qc: 25, handoff: 20, app: 10 }`. All scoring tasks are retargeted to V4. Consequences:
- Task 1's original commit `33fc3a7` edited dead V3 code and is **superseded** by Task 1R below, which reverts it.
- **First-time inspection pass is already absent from the live board** — V4 has no ftp dimension. The spec's "remove ftp" requirement needs no work; do not add or remove anything for it.
- **Shared Links does not exist on the live board.** Ignore every spec reference to a `sharedLinks` dimension or `sharedLinksCap`.
- Tasks 4, 5, 6 (QC item severity UI, derived verdict, RT-by-choice + stranded tripwire) are **unaffected by the retarget** — they touch QC punch items and the QC tab, not the scoreboard.

**Architecture:** All changes live in `src/App.js` (house monolith — do NOT split files). Scoring stays pure functions verified by a node dry-run harness BEFORE any UI wiring (house pattern: `scripts/sb-*dryrun.js`). UI tasks are verified by `CI=true npm run build` plus browser checks. One ship at the end via the homestead-deploy-hygiene one-paste.

**Tech Stack:** React (single-file App.js), Firestore via existing `u()`/`saveJob` funnel and `settings/scoreboardV4Weights`, node for dry-run harnesses. No new dependencies (`npm install` is forbidden here — `node_modules` is a symlink into the parent repo).

## Global Constraints

- House rules: no emojis in UI (`<Icon>` + text); mobile/desktop parity; **the model never runs `git push` and never touches `main`** — implementers commit locally on the current branch only, Koy ships at the end.
- **Never edit anything outside this worktree.** The parent repo at `~/Desktop/homestead-electric` holds unshipped production work (v372/v373) in its working tree.
- **LABELING RULE (Koy, 2026-08-10: "make sure its all labeled better like qc needs to be included where it applies").** Every user-facing label for a QC thing must contain the word "QC". Never ship a bare "minor"/"serious"/"Passed with Items"/"items per job" that leaves the reader guessing which system it belongs to — these pills and stats render beside Return Trip, Matterport and punch surfaces. Concretely binding on this plan: severity chips read EXACTLY **"Minor QC item"** and **"Serious QC item"**; the new status label is EXACTLY **"QC Passed with Items"**; the RT-choice prompt titles read **"QC Fail — return trip needed?"** and **"QC Passed with Items — return trip needed?"**; the scoreboard QC stat card and its weight-editor slider must use the SAME words as each other. (Already shipped separately in v374: `QC_STATUSES.needs` → "QC Needs to be Scheduled", plus the sibling RT/Matterport labels that shared the identical bare string.)
- Absent `severity` = minor (zero migration). Historical QC statuses keep their meaning.
- All new job fields are ADDITIVE inside the `data` envelope (no loader change): item `severity`, job `qcRtChoice`/`qcRtChoiceBy`/`qcRtChoiceAt`.
- New RTs from either non-clean verdict carry `fromQCFail: true`; NEW dedupe checks key off that flag, never `scope.startsWith("QC Fail")` (legacy string checks stay for old data).
- Scoring config lives as ADDITIVE keys on the existing `settings/scoreboardV4Weights` doc (existing admin-only write path — no rules change). Missing keys → defaults → **exactly current behavior**.
- V4 stat cards must stay self-describing plain language (Koy's v339 directive): each stat says what it measures and which direction is good. No cryptic dimension codes.
- Margin is untouched by this work. Do not change margin math, the 15% target, or who can see the board.
- Update Discipline dimension: REJECTED by Koy — do not add.
- Never compare Firestore-derived values with raw `JSON.stringify` — use `_jeq`/`_jcanon` (v371 lesson) if any new equality check is needed.

**Code anchors** (line numbers drift — always locate by grep):
- LIVE board: `function ScoreboardV4` · `const sb4Agg` · `const sb4Build` · `const SB4_DEFAULT_WEIGHTS` · `const SB4_MARGIN_TARGET` · `const NORM = ` (inside ScoreboardV4) · `overallOf` · `scoreboardV4Weights`
- DEAD, do not edit: `function ScoreboardV3` · `sb3Agg` · `sb3Build` · `sbv3QC` · `sbv3Inspections` · `sb3JobSignals`
- Shared helpers used by V4 (leave intact): `sbv2WalkPunch` · `_sb3lc` · `_sb3Completed` · `_sb3QCount` · `SBV2_TEST_JOB` · `SBV2_EXCLUDE_NAME`
- QC/RT surfaces: `QC_STATUSES` · `fromQCFail:true` · `"QC Fail — return trip needed"` (2 sites: rough + finish) · Open Items builder (grep `sourceTab: "Return Trips"`)

**Testing reality:** there is **no jest/vitest and you must not add one.** Verification is (1) a standalone node harness under `scripts/` that extracts the real functions from `src/App.js` source at runtime and asserts against them — imitate `scripts/sb-scoreboard-dryrun.js` and the existing `scripts/sb4-dryrun.js`; and (2) `CI=true npm run build` (~2 min, lint warnings are errors). Run the build once before committing, not repeatedly.

---

### Task 1R: Retarget scoring config to ScoreboardV4 (supersedes commit 33fc3a7)

**Files:**
- Modify: `src/App.js` — revert the Task 1 edits in the `sb3JobSignals`/`sb3Agg` region; add the config beside `SB4_DEFAULT_WEIGHTS`
- Modify: `scripts/sb4-dryrun.js` — retarget from sb3 to sb4 functions
- Test: `scripts/sb4-dryrun.js`

**Interfaces:**
- Produces: `const SB4_DEFAULTS = { weights: { margin:45, qc:25, handoff:20, app:10 }, marginDivisor: 50, marginTarget: 15, qc: { seriousCredit: 0, minorDivisor: 40, minorMaxCost: 50 }, handoffDivisor: 20, appCap: 2500, appMix: 50, strandedDays: 7 }`
- Produces: `const sb4Config = (stored) => {...}` — deep-merges `stored` over `SB4_DEFAULTS` (missing keys → defaults; `weights` and `qc` merged key-by-key; numeric scalars replaced only when `typeof === "number"`).
- Produces: `sb4Agg(js, cfg)` — second parameter added, defaulting to `sb4Config(null)` so existing callers keep working.
- Consumes (existing, unchanged): `sb4Build(jobs, board, users)` — gains an optional 4th param `cfg` passed through to `sb4Agg`.

- [ ] **Step 1: Revert the superseded Task 1 App.js edits**

```bash
git show 33fc3a7 -- src/App.js | git apply -R
```

Verify with `git diff --stat` that only `src/App.js` changed and the `sb3Agg`/`sb3JobSignals` region is back to its original form. Do NOT revert `scripts/sb4-dryrun.js` — it is retargeted in Step 3, not discarded.

- [ ] **Step 2: Retarget the harness to sb4 and make it fail**

Rewrite `scripts/sb4-dryrun.js` to extract `SB4_DEFAULT_WEIGHTS`, `_sb4Num`, `_sb4Special`, `_sb4Median`, `_sb4Stage`, `sb4Agg`, `sb4Build` (plus the shared helpers they call) from `src/App.js` source, using the same extraction technique the file already uses for sb3. Assertions:

```js
// FIXTURES — foreman "T", two jobs, using the shapes V4 actually reads:
const jobA = { id:"a", name:"Fixture A", foreman:"T", simproMargin: 20,
  roughPunch: { main: { general: [ {id:"p1",text:"x",done:true}, {id:"p2",text:"y",fromQC:true} ] } },
  roughUpdates: [{text:"d"}], roughQuestions: { main:[{question:"q"}] }, qcStatus: "fail" };
const jobB = { id:"b", name:"Fixture B", foreman:"T", simproMargin: 30,
  finishPunch: { main: { general: [ {id:"p3",text:"z",fromQC:true}, {id:"p4",text:"w"} ] } }, qcStatus: "pass" };
const users = [{ name:"T", title:"foreman", active:true }];

// 1. REGRESSION: sb4Agg(js) and sb4Agg(js, sb4Config(null)) must be deep-equal.
// 2. REGRESSION: sb4Build(jobs,"foremen",users) unchanged vs before this task (margin
//    median 25, qc 1 item/walk over 2 walks = 1, handoff = openPunch/punch*100, app total).
// 3. DEFAULT PINNING (mutation-proof — a wrong default must fail, not cancel out):
//    assert SB4_DEFAULTS.weights.margin === 45 && .qc === 25 && .handoff === 20 && .app === 10
//    assert SB4_DEFAULTS.marginDivisor === 50 && handoffDivisor === 20 && appCap === 2500
//    assert SB4_DEFAULTS.qc.minorDivisor === 40 && minorMaxCost === 50 && seriousCredit === 0
//    assert SB4_DEFAULTS.appMix === 50 && marginTarget === 15 && strandedDays === 7
// 4. MERGE: sb4Config({weights:{margin:10}}).weights.qc === 25 (partial merge keeps siblings)
//    sb4Config({qc:{minorDivisor:20}}).qc.seriousCredit === 0
//    sb4Config(null) deep-equals SB4_DEFAULTS
//    sb4Config({appMix:"x"}).appMix === 50 (non-numeric ignored)
console.log("task1R ok");
```

Run `node scripts/sb4-dryrun.js` — expect failure (`SB4_DEFAULTS is not defined`).

- [ ] **Step 3: Implement the config**

Directly above `const SB4_DEFAULT_WEIGHTS`, add `SB4_DEFAULTS` and `sb4Config` exactly as specified in Interfaces. Then make `SB4_DEFAULT_WEIGHTS` derive from it so there is ONE source of truth:

```js
const SB4_DEFAULT_WEIGHTS = SB4_DEFAULTS.weights;
```

Change `const sb4Agg = (js) => {` to `const sb4Agg = (js, cfg) => {` and add as its first line `const c = cfg || sb4Config(null);` — `c` is unused in this task (the math still uses its current literals) and that is correct: this task only establishes plumbing with zero behavior change. Add the optional 4th param to `sb4Build` and pass it through to every `sb4Agg(...)` call inside it.

- [ ] **Step 4: Run harness — expect `task1R ok`.** Then `CI=true npm run build` — green.
- [ ] **Step 5: Commit** — `git add src/App.js scripts/sb4-dryrun.js && git commit -m "QC severity Task 1R: retarget scoring config to ScoreboardV4"`

### Task 2R: Severity-aware QC on the live board

**Files:**
- Modify: `src/App.js` — `sb4Agg` (QC accumulation + returned fields), `ScoreboardV4`'s `NORM.qc`, and the "QC items per job" stat card
- Modify: `scripts/sb4-dryrun.js`

**Interfaces:**
- Consumes: `sb4Config` / `SB4_DEFAULTS` (Task 1R), `c` inside `sb4Agg`.
- Changes: `sb4Agg` returns `qc` as a **0–1 score** (was: raw items-per-walk), plus new display fields `qcSeriousPct` (0–100 int or null), `qcMinorAvg` (1dp or null), `qcWalks` (int).
- Per-walk score: `seriousCount > 0 ? c.qc.seriousCredit/100 : 1 - Math.min(c.qc.minorMaxCost/100, minorCount / c.qc.minorDivisor)`; `qc` = mean of per-walk scores, or `null` when no walks.
- Changes: `NORM.qc` becomes the identity clamp `v => v == null ? null : clamp(v)` — the score is already normalized. **This is load-bearing:** leaving `1 - v/8` in place would invert the new score.

- [ ] **Step 1: Add failing assertions**

```js
// Defaults: seriousCredit 0, minorDivisor 40, minorMaxCost 50.
// jobA: 1 fromQC item, no severity => 1 minor  => walk score 1 - min(0.5, 1/40) = 0.975
// jobB: 1 fromQC item, no severity => 1 minor  => walk score 0.975
//   => agg qc = 0.975, qcSeriousPct = 0, qcMinorAvg = 1, qcWalks = 2
// Mark jobB's p3 severity:"serious" => jobB walk score = 0
//   => agg qc = 0.4875, qcSeriousPct = 50
// Knob proof: cfg with qc.seriousCredit 50 => jobB walk score 0.5 => agg qc = 0.7375
// Knob proof: cfg with qc.minorDivisor 2 => jobA walk 1 - min(0.5, 0.5) = 0.5
// NORM proof: NORM.qc(0.4875) === 0.4875 (identity), NORM.qc(null) === null
```

- [ ] **Step 2: Run — expect fail** (`qc` still a raw item count).
- [ ] **Step 3: Implement.** In `sb4Agg`'s job loop replace the `qcDefects` counting with severity counting (`it.severity === "serious"` → serious, else minor; still only `it.fromQC && !it.voided`, still across `[j.roughPunch, j.finishPunch, j.qcPunch]`), accumulate per-walk scores into an array, and return the new fields. Update `NORM.qc` in `ScoreboardV4` to the identity clamp.
- [ ] **Step 4: Update the stat card** (grep `QC items per job`). New label **"Serious QC walks"**, value `r.qcSeriousPct == null ? "—" : r.qcSeriousPct + "%"`, sub-line `fewer is better · avg {r.qcMinorAvg ?? "—"} minor items per walk`. Keep the existing card markup/classes — swap only label, value and sub-line so the plain-language v339 style is preserved.
- [ ] **Step 5: Harness green, `CI=true npm run build` green, commit.**

### Task 3R: Per-job completeness blended into App Usage

**Files:**
- Modify: `src/App.js` — `sb4Agg` (app accumulation), `ScoreboardV4`'s `NORM.app`, the "Logged in app" stat card
- Modify: `scripts/sb4-dryrun.js`

**Interfaces:**
- Produces: `sb4JobComplete(j)` → `null` when `j.tempPed || j.quickJob`, else `0..1` = passed checks / 4, where the checks are: has ≥1 non-QC punch item · has ≥1 daily update · has ≥1 question · has ≥1 photo anywhere on the job.
- Changes: `sb4Agg` returns `app` as a **0–1 blended score** (was: a raw total), plus display fields `appVolume` (the raw total, for the card) and `appComplete` (0–100 int or null).
- Blend: `volume = clamp(appVolume / c.appCap)`; `mix = clamp(c.appMix/100)`; `app = compAvg == null ? volume : (1 - mix) * volume + mix * compAvg`.
- Changes: `NORM.app` becomes the identity clamp (same reasoning as `NORM.qc`).

- [ ] **Step 1: Add failing assertions**

```js
// jobA: punch(non-QC) 1, updates 1, questions 1, photos 0 => complete 0.75
// jobB: punch(non-QC) 1, updates 0, questions 0, photos 0 => complete 0.25
//   => compAvg 0.5 ; appVolume = punch+updates+questions (assert the actual total)
//   => at appMix 50: app = 0.5*clamp(appVolume/2500) + 0.5*0.5
// appMix 0 => app === clamp(appVolume/2500) exactly (volume-only regression)
// appMix 100 => app === 0.5 exactly (completeness-only)
// tempPed fixture => sb4JobComplete(...) === null and is excluded from compAvg
// photo detection: adding {url:"u",storagePath:"s"} anywhere on jobB (punch item photos[],
//   or a CO photos[]) flips its 4th check => complete 0.5
```

- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement `sb4JobComplete` + `_sb4HasPhoto`** beside `sb4Agg`:

```js
// Presence, not volume — that is what makes it size-proof and un-farmable.
// Temp peds / quick jobs are excluded: nobody posts dailies on a temp ped, and
// counting them unfairly drags foremen who carry lots of small work.
const _sb4HasPhoto = (o, depth) => {
  if (!o || depth > 6) return false;
  if (Array.isArray(o)) return o.some(x => _sb4HasPhoto(x, depth + 1));
  if (typeof o !== "object") return false;
  if (typeof o.url === "string" && typeof o.storagePath === "string") return true;
  return Object.values(o).some(v => _sb4HasPhoto(v, depth + 1));
};
const sb4JobComplete = (j) => {
  if (!j || j.tempPed || j.quickJob) return null;
  let punch = 0;
  [j.roughPunch, j.finishPunch, j.qcPunch].forEach(pp => sbv2WalkPunch(pp, (it) => { if (it && !it.voided && !it.fromQC) punch++; }));
  const updates = (Array.isArray(j.roughUpdates) ? j.roughUpdates.length : 0) + (Array.isArray(j.finishUpdates) ? j.finishUpdates.length : 0);
  const questions = _sb3QCount(j.roughQuestions) + _sb3QCount(j.finishQuestions);
  return [punch > 0, updates > 0, questions > 0, _sb4HasPhoto(j, 0)].filter(Boolean).length / 4;
};
```

Wire the accumulation into `sb4Agg`, apply the blend, set `NORM.app` to the identity clamp.

- [ ] **Step 4: Update the stat card** (grep `Logged in app`). Keep label **"Logged in app"**, value stays the raw `r.appVolume` (a number foremen recognize), sub-line becomes `{r.appComplete ?? "—"}% of jobs fully tracked · more is better`.
- [ ] **Step 5: Harness green, build green, commit.**

### Task 4: Severity toggle on QC items + RT clone stamping

**Files:**
- Modify: `src/App.js` — the punch item row render where the `fromQC` badge shows (grep `fromQC` inside the punch item JSX), and the QC-fail RT clone construction (grep `fromQCFail:true`)

**Interfaces:**
- Item field: `severity: "serious" | undefined` (undefined = minor; never write `"minor"` explicitly — `sanitize()` drops undefined, so toggling back yields the exact legacy shape).

- [ ] **Step 1: Implement the chip** on every `fromQC` item row, using the row's existing item-update helper (the same one the row's done-checkbox calls):

```jsx
{item.fromQC && (
  <span onClick={(e) => { e.stopPropagation(); updateItem(item.id, { severity: item.severity === "serious" ? undefined : "serious" }); }}
    style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", borderRadius: 99, padding: "2px 8px",
      cursor: "pointer", userSelect: "none", flexShrink: 0,
      border: `1.5px solid ${item.severity === "serious" ? "#B23A3A" : C.border}`,
      background: item.severity === "serious" ? "#B23A3A14" : C.bg,
      color: item.severity === "serious" ? "#B23A3A" : C.muted }}>
    {item.severity === "serious" ? "Serious QC item" : "Minor QC item"}
  </span>
)}
```

- [ ] **Step 2: Stamp clones** — in the QC-RT item-clone map (both rough and finish sites), add `severity: src.severity` to each cloned item.
- [ ] **Step 3: `CI=true npm run build` green; commit.**
- [ ] **Step 4: Browser check** via the build-preview server on a real job with QC items: chip renders on `fromQC` rows only, labels read exactly "Minor QC item"/"Serious QC item", toggle survives a reload.

### Task 5: `passed_items` status + derived verdict

**Files:**
- Modify: `src/App.js` — `QC_STATUSES`, and the QC walk-completion UI where the walker sets pass/fail (the block that hosts the `"QC Fail — return trip needed"` sites)

**Interfaces:**
- Registry entry between pass and fail: `{ value: "passed_items", label: "QC Passed with Items", color: "#B0892C" }` — copy a neighbouring entry's exact object shape and change the three values. The label MUST carry "QC" (labeling rule in Global Constraints): every other entry in `QC_STATUSES` now does, and this pill renders next to RT and Matterport pills on job cards.
- Produces: `const deriveQcVerdict = (job) => {...}` beside `sb4Agg`'s QC helpers — walks `[job.roughPunch, job.finishPunch, job.qcPunch]` for non-voided `fromQC` items; no items → `"pass"`, any `severity === "serious"` → `"fail"`, otherwise → `"passed_items"`.

- [ ] **Step 1: Add the registry entry.** Grep every render of `QC_STATUSES` — pills and pickers map the array, so the new status appears automatically. Then grep `"fail"` within 5 lines of `qcStatus` and extend any binary pass/fail conditional to treat `passed_items` as non-fail and non-terminal.
- [ ] **Step 2: Pre-derive in the completion flow** — compute `deriveQcVerdict(job)` and pre-select it as the presented default. Do NOT remove the manual buttons; the walker confirms.
- [ ] **Step 3: Extend the `fixed` transition** ("QC Items Fixed — Pass") from `qcStatus === "fail"` to `["fail","passed_items"].includes(qcStatus)` so a passed-with-items job reaches the terminal state when its items close.
- [ ] **Step 4: Build green; commit; browser check** — a minor-only walk pre-selects Passed with Items; adding a serious item flips it to Fail; the amber pill renders everywhere the status shows.

### Task 6: RT by choice (auto-create removed) + stranded-QC tripwire

**Files:**
- Modify: `src/App.js` — both auto-RT sites (grep `"QC Fail — return trip needed"`), the Open Items builder (grep `sourceTab: "Return Trips"`)

**Interfaces:**
- Job fields written in the same `u()` patch as the verdict: `qcRtChoice: "rt" | "crew"`, `qcRtChoiceBy` (name), `qcRtChoiceAt` (ISO string).
- RT scopes: fail → `"QC Fail — return trip needed"` (unchanged text) · passed_items → `"QC Items — return trip"`. BOTH carry `fromQCFail: true`.
- NEW dedupe predicate: `(job.returnTrips||[]).some(rt => rt && !rt.signedOff && (rt.fromQCFail === true || (typeof rt.scope === "string" && rt.scope.startsWith("QC Fail"))))`

- [ ] **Step 1: Replace both auto-creates with the prompt:**

```js
const makeRt = await showConfirm({
  title: verdict === "fail" ? "QC Fail — return trip needed?" : "QC Passed with Items — return trip needed?",
  message: "Severity set the verdict. Site reality sets the return trip: if nobody is coming back to this job, make it a return trip so the items can't get missed. If a crew is on site, they handle it in stride.",
  confirmLabel: "Create return trip",
  cancelLabel: "Crew on site has it",
  danger: false,
});
if (makeRt) { /* existing RT construction, verbatim, with the scope chosen per verdict */ }
u({ qcRtChoice: makeRt ? "rt" : "crew", qcRtChoiceBy: identity?.name || "", qcRtChoiceAt: new Date().toISOString(), ...verdictPatch });
```

(`showConfirm` is the house global returning `Promise<boolean>`; the options shape above is verified in-repo.) The prompt fires for BOTH non-clean verdicts; nothing auto-creates any more.

- [ ] **Step 2: Stranded tripwire** in the Open Items builder, per job — adapt the push to the builder's existing row shape by copying a neighbouring push:

```js
const openQc = [];
[j.roughPunch, j.finishPunch, j.qcPunch].forEach(pp => sbv2WalkPunch(pp, it => { if (it && !it.voided && it.fromQC && !it.done) openQc.push(it); }));
const hasQcRt = (j.returnTrips || []).some(rt => rt && !rt.signedOff && (rt.fromQCFail === true || (typeof rt.scope === "string" && rt.scope.startsWith("QC Fail"))));
const ageDays = j.qcRtChoiceAt ? (Date.now() - Date.parse(j.qcRtChoiceAt)) / 86400000 : null;
if (openQc.length && !hasQcRt && j.qcRtChoice === "crew" && ageDays != null && ageDays >= sb4Config(null).strandedDays) {
  // label: `${openQc.length} stranded QC item(s) — crew was handling it, still open after ${Math.floor(ageDays)}d`
}
```

- [ ] **Step 3: Build green; commit; browser check** — a minor-only walk shows the two-button prompt; "Crew on site has it" writes the choice and creates no RT; the fail + "Create return trip" path produces the same RT as today with items cloned and check-off sync working in both directions.

### Task 7R: Wire config through ScoreboardV4 + scoring knobs panel

**Files:**
- Modify: `src/App.js` — `ScoreboardV4` (weights snapshot/save, `NORM`, `overallOf`, the `.wedit` weights editor)

**Interfaces:**
- Consumes: `sb4Config`, `SB4_DEFAULTS` (Task 1R) and the new agg fields from Tasks 2R/3R.
- The `settings/scoreboardV4Weights` snapshot handler currently accepts only `{margin,qc,handoff,app}` numbers. It must now load the full config via `sb4Config(snapshotData)` while keeping the existing weights behavior identical when only weight keys are present.
- `saveWeights` writes the full config object (`{ merge: true }` preserved).

- [ ] **Step 1: Load the full config.** Replace the `weights` state with a `cfg` state seeded from `sb4Config(null)`; keep a derived `const weights = cfg.weights;` so existing JSX and `overallOf` keep working unchanged. In the `onSnapshot` handler, set `sb4Config(s.exists() ? s.data() : null)`.
- [ ] **Step 2: Pass `cfg` into the pipeline** — `sb4Build(windowedJobs, board, users, cfg)`; replace the hardcoded divisors in `NORM` with `cfg.marginDivisor`, `cfg.handoffDivisor` (and the identity clamps from Tasks 2R/3R for qc and app). Replace `SB4_MARGIN_TARGET` reads in the card/legend with `cfg.marginTarget`; leave the `SB4_MARGIN_TARGET` constant in place as the default source.
- [ ] **Step 3a: Fix the stale QC wording in the editor** (labeling rule). The weight slider still reads `"QC items/job"` (grep it) and the header summary line still reads the pre-severity framing — both now describe a metric that no longer exists. The slider label must match the stat card's words exactly: **"Serious QC walks"**. Grep the whole `ScoreboardV4` component for any other text describing the QC dimension as an item count and update it in the same pass.
- [ ] **Step 3: Grow `.wedit` into the grouped Scoring panel** using the existing `.wrow` slider markup. Groups and plain-English labels: **Weights** (Margin/QC/Handoff/App — existing) · **QC quality** (`qc.seriousCredit` "Credit for a walk with a serious item %", `qc.minorDivisor` "Minor QC items that cost half a walk", `qc.minorMaxCost` "Most a walk can lose to minor items %") · **App usage** (`appMix` "Completeness share of App Usage %", `appCap` "Logged items for full credit") · **Other** (`marginDivisor` "Margin % for full credit", `marginTarget` "Margin goal", `handoffDivisor` "Open-punch % that scores zero", `strandedDays` "Days before crew-held QC items surface on Open Items"). Each group gets a Reset button restoring that group from `SB4_DEFAULTS`. Keep the existing "Reset to 45 / 25 / 20 / 10" button working for weights.
- [ ] **Step 4: Build green; commit; browser check** — admin sees the panel, dragging a knob re-ranks the board live, a non-admin identity sees no panel, cards render the new sub-lines.

### Task 8: Real-data sign-off, FEATURES/SW, ship

**Files:**
- Modify: `scripts/sb4-dryrun.js` (real-data mode) · `FEATURES.md` · `public/service-worker.js`

- [ ] **Step 1: Real-data old-vs-new print.** Add a mode that loads a real jobs export and prints the foremen board old-vs-new per dimension. **HARD GATE: stop and show Koy; get his explicit go before continuing.** Reference point from the live board today (all jobs, default weights): Keegan 83, Daegan 66, Gage 65, Abraham 52, Josh 49, Vasa 47, Colby 47 — and Gage currently scores 0 of 25 QC points at 10.6 items/walk despite the best margin in the company, which is the unfairness this ship exists to fix.
- [ ] **Step 2: FEATURES.md + SW bump in the same edit session, BEFORE the final build** (v368 lesson — the prebuild gate validates the version being shipped). Grep the current `const CACHE` first; the entry goes under the Scoreboard section and must cover severity QC, derived verdicts, RT-by-choice, the stranded tripwire, the App Usage blend, and the knobs panel.
- [ ] **Step 3: Final `CI=true npm run build`** on the exact tree being shipped — green.
- [ ] **Step 4: One-paste via the homestead-deploy-hygiene skill.** Data-safety paragraph writes itself from Global Constraints: additive fields only, no loader or rules change, auto-RT replaced by an explicit prompt plus a read-only tripwire, scoring recomputes live from config whose defaults reproduce current behavior until Koy moves a dial. Koy pushes. Then: vault log + flip the spec's status to SHIPPED.

---

## Self-review (R1)

- **Retarget coverage:** every task that touched `sb3*` now touches `sb4*`; Tasks 4/5/6 verified independent of the scoreboard; ftp removal dropped as already-true on V4; sharedLinks references struck.
- **Load-bearing risk called out:** `NORM.qc` and `NORM.app` MUST become identity clamps in the same commits that change what `sb4Agg` returns, or the board inverts. Stated in both task Interfaces blocks.
- **Type consistency:** `sb4Config` shape matches every read in Tasks 2R/3R/6/7R (`c.qc.minorDivisor`, `cfg.marginDivisor`, `sb4Config(null).strandedDays`); `sb4Agg`'s new return fields (`qc`, `qcSeriousPct`, `qcMinorAvg`, `qcWalks`, `app`, `appVolume`, `appComplete`) match the card and `overallOf` reads.
- **One intentional deviation from the spec** (unchanged from the original plan): the stranded-QC net uses an age tripwire (`strandedDays`) rather than a crew-schedule cross-reference, because schedule data is not reachable from the Open Items builder without new plumbing; age catches the same miss.
