# Tools Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Appliance Loads, Generator Sizing and Service Size fill each other through a device-local load profile, with opt-in Fill buttons and no Firestore writes.

**Architecture:** One UMD module (`public/tools/shared/load-profile.js`) owns the profile shape, the appliance classifier, localStorage read/write and the generator-row mappers. Service Size gets a pure `profile.js` (profile ↔ its state) plus `extras` in its calc; the generator page and `ToolsView`/`ApplianceLoadsView` get thin additive hooks around it. Spec: `docs/superpowers/specs/2026-10-02-tools-handoff-design.md`.

**Tech Stack:** Vanilla JS (generator page), React 19 + esbuild (Service Size, built from `tools-src/service-size`), CRA React (App.js), plain Node asserts for tests.

## Global Constraints

- Work in the scratchpad worktree (`…/scratchpad/wt`, branch `tools-handoff`, off `origin/main` d61ebba). Never commit from the shared `~/Desktop/homestead-electric` folder. Never `git add -A` at the root.
- Josh's generator regions stay byte-identical: `PRESETS`, `AIR`, `LIQ`, `PIPE`, `COND`, `CM`, `ATS_WHOLE`, `ATS_ESS`, `calc`, `renderFuel`, `renderPad`, `renderConnections`, `render`. Task 7 diffs them.
- No Firestore reads or writes anywhere in this change. localStorage keys: `he_tools_profile_v1`, `he_tools_visible_v1`.
- New generator-page code builds DOM with `createElement` / `textContent` (profile labels come from localStorage, which another page wrote), never HTML strings.
- No emojis in UI. Steel blue accent, never yellow. Mobile and desktop parity (buttons wrap).
- SW cache bump to the next free version (v497 at planning time) and a matching FEATURES.md entry, or the prebuild gate fails the build. Never pipe the build output.
- Service Size `index.html` (src and built) must keep `PLANS_KEY: "f8fc52cb9af2741148bc6fedd4ce04a55db1659808826cbb"`.

---

### Task 1: Shared load-profile module with tests

**Files:**
- Create: `public/tools/shared/load-profile.js`
- Create: `tools-src/service-size/test/profile.test.mjs` (classifier + generator mapping half; Task 3 adds the Service Size half)
- Modify: `tools-src/service-size/package.json` (test script)

**Interfaces:**
- Produces (module exports, also `window.HELoadProfile`): `KEY`, `VISIBLE_KEY`, `SOURCES`, `KINDS`, `kindInfo(kind)`, `classify(name, {volts, amps, va}) → kind`, `vaOf({volts, amps}) → number|null`, `kindFromPresetKey(key) → kind|""`, `readProfiles() → {source: profile}`, `writeProfile(profile) → bool`, `onProfiles(cb) → unsubscribe`, `readVisible() → string[]|null`, `writeVisible(keys)`, `isVisible(key) → bool`, `ago(iso, nowMs) → string`, `openTool(key)`, `toGeneratorRows(profile, PRESETS) → {rows, skipped, typical}`, `fromGeneratorRows(rows, inputs) → profile`.

- [ ] **Step 1: Write the failing test** — `tools-src/service-size/test/profile.test.mjs`: a `test()` helper like `calc.test.mjs`; table-driven `classify` cases (wash tower → dryer, gas dryer → covered, dual fuel range → range, induction cooktop → cooktop, double wall oven → doubleoven, wall oven → walloven, speed oven / microwave drawer → speed, refrigerator → covered, Tesla Wall Connector → ev, Rinnai tankless → wh_tankless, heat pump water heater → wh_hpwh, 50 gal water heater → wh_tank, AC condenser → ac, heat pump → heatpump, mini split → minisplit, furnace → airhandler, unit heater → electricheat, floor heat → floorheat, snowmelt → snowmelt, steam shower generator → steam, sauna, cold plunge → plunge, hot tub → hottub, swim spa → swimspa, pool pump → pool, well pump → wellpump, sewage ejector → sump, recirc pump → booster, elevator, door opener → garage, welder → shop, kiln → other); `classify("Water heater", {va: 27000}) === "wh_tankless"`; `vaOf` (240×24 = 5760, null when either is missing); `toGeneratorRows` with a mini PRESETS table (real VA wins, missing VA → preset VA + `flag: "typical VA"` + `typical` count, refrigerator skipped, ac ≥ 8000 VA → `ac_large`, a `maybe` row left out unless `sizeFor === "max"`, then `flag: "maybe"`); `fromGeneratorRows` (preset `key` → kind, unknown name → classify, inputs → `house`/`service`/`job`, `flag: "maybe"` → `status: "maybe"`, label `"Miller · 3 loads"`); `ago` ("just now", "20 min ago", "3 h ago", "2 d ago").

- [ ] **Step 2: Run** `cd tools-src/service-size && node test/profile.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Write the module** — UMD wrapper (`module.exports` when present, else `root.HELoadProfile`). `KINDS` is an ordered `[kind, regex, {gen, motorIf?}]` table; first match wins, so specific kinds (speed, warm, wash tower → dryer, covered, hpwh, tankless) sit above general ones (oven, water heater, heat pump, ac). `classify` upgrades a water heater at or above 15,000 VA to `wh_tankless`. `PRESET_KIND` maps generator preset keys to kinds. Storage helpers wrap every `localStorage` call in try/catch and merge into the one key by `profile.source`. `onProfiles` calls back now and on the `storage` event for the key. `isVisible` reads the visible list; when it is missing, only `service-size` is hidden. `openTool` posts `{type:"he-tools-open", key}` to `window.parent` with `location.origin`, else navigates to `/tools/<key>/`. `toGeneratorRows` copies the preset's fields, sets `key`, `name`, `qty`, `soft:false`, keeps `motor` from the load only for kind `other`, uses the load's VA or the preset's (flagging `typical VA`), flags `maybe`, skips kinds with `gen: null`. `fromGeneratorRows` maps rows to loads (kind from `key` else classifier), `house` from sqft/sac/laundry, `service` from svcA, `job` from the job-sheet fields, `sizeFor: "max"`.

- [ ] **Step 4:** package.json `"test": "node test/calc.test.mjs && node test/profile.test.mjs"`; run → `7 tests passed`.

- [ ] **Step 5: Commit** `public/tools/shared/load-profile.js tools-src/service-size/test/profile.test.mjs tools-src/service-size/package.json`.

---

### Task 2: Service Size calc counts free-form extras

**Files:** Modify `tools-src/service-size/src/calc.js`, `tools-src/service-size/test/calc.test.mjs`.

**Interfaces:** state keys `extras: [{id, name, va, qty, status, note}]`, `fill: {source, tag, label, at, covered, notes, placed, needVA} | null`, `fillFields: string[]`; `calc(state, scn, ov)` accepts `ov.extras = {id: status}`; `analyze().impacts[extraId]`.

- [ ] **Step 1: Failing tests** (append to `calc.test.mjs`): a 9,600 VA extra `yes` adds 9,600 to `other` in both scenarios; `maybe` only in max; `no` appears in `impacts` and what-ifs; `bidNote` includes the lowercased name. `normalizeState({})` gives `extras: []`, `fill: null`, `fillFields: []`; junk extras are dropped and fields coerced (`va: "9600"` → 9600, `status: "bogus"` → "yes").
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**: `defaultState` adds the three keys; `extrasOf(state)` helper; `normalizeState` sanitizes; `calc` loops extras after ITEMS (`ov.extras` override, `yes` or max+`maybe`, `va × qty` into `r.other` / `r.otherList`); `analyze` adds what-ifs for `no` extras with VA and `impacts[x.id]`; `bidNote` appends extras to the yes / maybe name lists.
- [ ] **Step 4: Run** → `8 tests passed`; Miller still 332 / 442 / 600.
- [ ] **Step 5: Commit.**

---

### Task 3: Service Size profile mapping (`profile.js`) with tests

**Files:** Create `tools-src/service-size/src/profile.js`; append to `test/profile.test.mjs`.

**Interfaces:** `applyProfile(prev, profile) → state`, `toProfile(state, analysis) → profile`, `fillSummary(state) → string`, re-export `LP`.

- [ ] **Step 1: Failing tests**: Appliance Loads profile (cooktop + wall oven → `cook_wall`; 2 dryers → `elec` × 2; tankless 240 V × 112 A → `tankless`; two EVs → `ev` + `ev2` yes with 11,520 VA; fridge and first dishwasher → `fill.covered`; second dishwasher → `dw2`; kiln 240 V × 40 A → one extra at 9,600; unit heater with no amps → `garageheat` yes at its default 5,000 VA; AC condenser → `cool: "ac"`, heating untouched; snowmelt 240 × 50 → `snowmelt` qty 300 at 40 VA/sq ft; `fill.tag === "loads"`; `fillFields` has job/range/dryer/dryerQty/wh/whQty/cool and not sqft; `fillSummary` mentions "1 added under Extras"). An unknown load with no amps → extra `va: 0`, `note: "needs VA"`, summary says "1 need VA". Generator profile (via `LP.fromGeneratorRows`) → sqft/sac/laundry land, heat pump → `heat: "hp"`, wh ×2 → `tank` qty 2, pool and EV items yes, `fill.tag === "generator"`. `toProfile` of a heat-pump luxury state → heatpump row (motor, VA > 0) + strips row, tankless 27,000, dryer qty 2, snowmelt as one load of total VA, hot tub `maybe`, kiln extra as `other`, `service.amps === a.rec`, `house.sac === 4`; `toGeneratorRows` of it includes the hot tub flagged `maybe` only with `sizeFor: "max"`.
- [ ] **Step 2: Run** → FAIL, module not found.
- [ ] **Step 3: Write `profile.js`**: `KIND_ITEM` (kind → item id) and `ITEM_KIND` (item id → kind); `applyProfile` normalizes a copy, sets job/house/hvac from the profile when present, classifies loads, resolves cooking (range > cooktop+double > cooktop+wall > single piece as 12 kW range with a note), dryer count, water heater kind precedence tankless > hpwh > tank with total count, HVAC from load kinds only when the profile has no `hvac` block, items via `putItem` (status yes/maybe, `fromFill`, `fillNote`, real VA when known; EV second unit → `ev2`; dishwasher first → covered, rest → `dw2`; snowmelt → qty = VA ÷ 40; floor → qty count), extras for `other`/`booster` (`needs VA` when 0), covered for `covered`/`airhandler`/`garage`, then `fill` and `fillFields`. `fillSummary` builds the one-line status. `toProfile` emits HVAC rows with the calc's own figures (`tons × 1500 + systems × 1000`, strips at `strip kW`, baseboard `sqft × 10`), big appliances by enum (undecided → `maybe`), items with status (unit items as one load of total VA), extras, `house`, `hvac`, `service`, `sizeFor`, label `"<job> · <rec> A"`.
- [ ] **Step 4: Run** `npm test` → both files pass.
- [ ] **Step 5: Commit.**

---

### Task 4: Service Size UI: fill panel, extras group, send button, publish

**Files:** Modify `ServiceSizeCalculator.jsx`, `ServiceSizeCalculator.css`.

- [ ] **Step 1: State**: `profiles` from `LP.readProfiles()` + `LP.onProfiles(setProfiles)`; `undo`, `fillMsg`; `initialJson` ref and `dirty` ref; publish effect on `[s, a]` (skips while the state equals the initial JSON, then debounces `LP.writeProfile(toProfile(s, a))` 300 ms); `fillFrom(src)`, `undoFill`, `sendToGenerator`, `removeExtra`, `setExtra`; `Tag` shows `plans`, else the fill tag.
- [ ] **Step 2: Fill panel** after the drop zone: `Start from another tool`, a `ssc-btnrow` of `Fill from <Source> · <label> · <ago>` ghost buttons for `appliance-loads` and `generator-sizing`, an empty-state hint, `Open Generator Sizing` when `LP.isVisible("generator-sizing")`, the status line with Undo.
- [ ] **Step 3: Item rows** show the fill tag and `fillNote`.
- [ ] **Step 4: Extras group** `From <Source>` after the categories: name + note + `remove` link, VA and qty inputs, Yes/Maybe/No segment, Adds; a hint that they count as fixed appliances; then the covered-by-allowances line from `fill.covered`.
- [ ] **Step 5: Send to Generator Sizing** button in the bid-note row.
- [ ] **Step 6: CSS** `.ssc-link` rule.
- [ ] **Step 7:** `npm install && npm test && npm run build` in the worktree's `tools-src/service-size`; confirm the built `index.html` still has the key; `git status --short public/tools/service-size`.
- [ ] **Step 8: Commit** the two source files and `public/tools/service-size` (scoped add).

---

### Task 5: Generator Sizing fill bar, publish and preset keys

**Files:** Modify `public/tools/generator-sizing/index.html`.

- [ ] **Step 1: Snapshot Josh's regions** to `<scratchpad>/gen/before.json` with a Node script that regex-grabs each named region (`const PRESETS = {…};`, `AIR`, `LIQ`, `PIPE`, `COND`, `CM`, `ATS_WHOLE`, `ATS_ESS`, `function calc(){…}`, `renderFuel`, `renderPad`, `renderConnections`, `render`).
- [ ] **Step 2: CSS** for `.fillrow`, `.fillrow .ghost`, `#fillNote .undo`.
- [ ] **Step 3: Markup** `<section id="fillCard">` with idx `00`, heading `Start from another tool`, sub text, `#fillBtns`, `#fillNote` (hidden).
- [ ] **Step 4:** `<script src="/tools/shared/load-profile.js"></script>` before the inline script.
- [ ] **Step 5: Preset keys** on the six default rows and in the Add handler (`key: v`).
- [ ] **Step 6: Handoff block** before the "PWA service-worker registration removed" comment: `LP = window.HELoadProfile`; `dirty` / `undo` / debounce; `inputsNow()`; `publish()` only when dirty; `el(tag, cls, text)` helper; `renderFillBar(all)` builds buttons with `createElement` + `textContent` (`data-fill` / `data-open`); `showFillNote(parts, canUndo)` builds text nodes and an Undo button; `snapshot()` / `restore()`; `fillFrom(src)` replaces rows via `LP.toGeneratorRows(p, PRESETS)`, sets house inputs, picks the smallest `#svcA` option ≥ `service.amps`, sets customer/address, re-renders, publishes, shows the note (counts, typical VA, covered, service note); listeners: `LP.onProfiles(renderFillBar)`, click delegation on `#fillBtns` and `#fillNote`, document-level `input` and relevant `click` events mark dirty and schedule a publish.
- [ ] **Step 7: Verify standalone**: a scratchpad static server over the worktree's `public/` (add `tools-preview` to `.claude/launch.json`); seed a profile and the visible list through `javascript_tool`; Fill → rows, customer, note, recommendation change; Undo restores; console clean; `generator-sizing` profile now present.
- [ ] **Step 8: Commit.**

---

### Task 6: App.js: ToolsView switch + Appliance Loads publish and Send buttons

**Files:** Modify `src/App.js` (`ApplianceLoadsView`, `ToolsView`), `public/service-worker.js`, `FEATURES.md`.

- [ ] **Step 1: Module helpers** above `ApplianceLoadsView`: `TOOLS_PROFILE_KEY`, `TOOLS_VISIBLE_KEY`, `applToolProfile(cur, cc)` (rows → loads with effective amps, VA only when volts and amps are both present, `kind: ""`; job from the CC job or the sheet label), `writeToolProfile(p)` (merge into the key, try/catch, returns bool).
- [ ] **Step 2: ApplianceLoadsView** takes `onOpenTool`, `tools`; `useEffect` publishes when a job page is open (deps `[cur && cur.no, rowsEff]`); `sendTo(key)` publishes then `onOpenTool(key)` or sets a hint message.
- [ ] **Step 3: Buttons** `Send to Generator Sizing` (when `tools` is absent or lists it) and `Send to Service Size` (only when `tools` lists it) before the Import button.
- [ ] **Step 4: ToolsView** writes the visible list on render, listens for same-origin `he-tools-open` messages and calls `pick(key)` for visible tools; passes `onOpenTool={pick}` and `tools` to the native view.
- [ ] **Step 5: SW bump + FEATURES entry** (manifest line + the entry text in the spec's wording, with the data-safety line).
- [ ] **Step 6: Build** `CI=true npm run build` (never piped) → `Compiled successfully.`
- [ ] **Step 7: Commit** `src/App.js public/service-worker.js FEATURES.md`.

---

### Task 7: Guide, Josh-region diff, docs, crew brief

- [ ] **Step 1: Diff Josh's regions** (`after.json` vs `before.json`) → every region `identical`.
- [ ] **Step 2: Guide** `public/sops/tools.html`: new section *Tools that fill each other* (open the job, tap Fill, check what landed, calculators both ways, same-device note) and a Questions row for a missing Fill button; footer date.
- [ ] **Step 3: Crew brief** `docs/crew-briefs/v497.md` per the crew-brief skill.
- [ ] **Step 4: Commit** guide, brief, spec, plan.
- [ ] **Step 5:** Final `CI=true npm run build`; report with the push command; push only on Koy's go. Close the session with the vault log and a `Tools Tab.md` section.
