# Tools tab: the three calculators fill each other (design)

Date: 2026-10-02 · Owner: Koy · Status: approved (design), building
Ships as SW v497 (or the next free number at ship time).

Koy: "so we have the three tools in the tools tab now, generator calc, appliance
loads, and load calc. We want them to be able to all three work together to fill
each one out if we want."

## What it does

Each tool in the Tools tab can **fill itself from another tool** with one tap,
and nothing moves unless you tap.

- **Appliance Loads** (native view, reads the master Google Sheet) is a **source
  only**. Its rows come from the nightly Drive run; the app cannot write rows into
  the Sheet, so the calculators cannot fill it. Opening a job's page makes that
  job's appliances available to the two calculators, and the page gets
  `Send to Service Size` / `Send to Generator Sizing` buttons.
- **Generator Sizing** (iframe, Josh's vanilla-JS page) gets a *Start from another
  tool* bar: `Fill from Appliance Loads · #1438 Miller · 14 loads`,
  `Fill from Service Size · Miller Residence · 3 min ago`, each with Undo, plus
  `Open in Service Size`.
- **Service Size** (iframe, Josh's bundled React page) gets the same bar
  (`Fill from Appliance Loads`, `Fill from Generator Sizing`) next to its
  *Start from plans* panel, a `Send to Generator Sizing` button next to
  *Copy bid note*, and a new **From another tool** group under Extras for loads
  that have no fixed item (counted as fixed appliances at nameplate).

Decisions Koy made 2026-10-02:
1. Same-device handoff slot (localStorage), not a job field. No Firestore writes.
2. Unknown appliances become free-form, countable Extras rows in Service Size.
3. `Send to …` switches the tool chip and the target shows the Fill button; it
   does not auto-fill (nothing you typed there is replaced unseen).

## The handoff: a load profile in one localStorage key

All three tools run on the same origin (the app shell and both iframes), so a
localStorage key is a shared mailbox with no server and no postMessage for data.

Key: `he_tools_profile_v1`. Value: JSON object keyed by **source**:

```js
{
  "appliance-loads": <profile>,   // written when a job page is opened or Send is tapped
  "service-size":    <profile>,   // written on every state change once the page is "dirty"
  "generator-sizing":<profile>    // same rule
}
```

A profile:

```js
{
  v: 1,
  source: "appliance-loads" | "service-size" | "generator-sizing",
  at: "2026-10-02T15:04:05.000Z",
  label: "#1438 Miller Residence",          // what the Fill button shows
  job:   { no: "1438", name: "Miller Residence", address: "…" },   // any may be ""
  house: { sqft: 3200, sac: 3, laundry: 1 } | null,
  hvac:  { heat: "gas"|"hp"|"baseboard"|"undecided", cool: "ac"|"none", tons: 4 } | null,
  service: { amps: 200 } | null,            // Service Size's recommended size
  sizeFor: "max" | "base" | null,           // Service Size only: whether maybes count
  loads: [
    { name: "Laundry · Dryer", model: "LG DLEX…", kind: "dryer", qty: 1,
      volts: 240, amps: 24, va: 5760,       // volts/amps/va null when the sheet had none
      motor: false, status: "yes"|"maybe",   // status from Service Size; "yes" otherwise
      note: "typical VA" | "" }
  ]
}
```

`kind` is the canonical appliance key below. The writer classifies when it knows
(Service Size items, generator presets); otherwise it leaves `kind` empty and the
**reader** classifies by name with the shared classifier. Appliance Loads sends raw
rows (`kind` empty) so App.js never carries a copy of the keyword table.

"Dirty" for the two calculators: the user changed any input, or filled from
another tool. The generator's demo rows and Service Size's defaults are never
published on their own.

Reads: each tool reads the key on load and listens to the `storage` event, so a
tool left open sees a newer profile appear without a reload. Everything is in
try/catch; if localStorage throws, the fill bar says "Nothing to fill from yet"
and the tool works as before.

`Send to …`: the source writes its profile, then `window.parent.postMessage(
{ type: "he-tools-open", key }, location.origin)`. `ToolsView` listens, checks
the key is a tool this user can see, and switches the chip. Full-screen (own tab)
falls back to a plain link to `/tools/<key>/`. The native Appliance Loads view
calls an `onOpenTool(key)` prop instead; when it is mounted from a job card (no
ToolsView) the button writes the profile and shows "Open Tools → Service Size
and tap Fill from Appliance Loads."

Which tools a person may see: `ToolsView` writes `he_tools_visible_v1`
(`["generator-sizing","appliance-loads","service-size"]`) on render; the iframe
pages hide `Open in Service Size` when it is not listed. The chip list remains the
real gate (the page URL was never locked, see the Tools Tab vault note).

## Shared classifier: `public/tools/shared/load-profile.js`

One UMD file (classic `<script>` for the generator page, bundled by esbuild into
Service Size, `require`-able from Node tests). It owns:

- `KINDS`: the canonical keys with their generator preset key, Service Size
  target and default handling.
- `classify(name, {volts, amps, va})` → kind (keyword regex table; ties broken by
  VA/volts, e.g. a water heater over 15 kVA is `wh_tankless`).
- `vaOf({volts, amps, qty})` → VA per unit or null.
- `readProfiles()` / `writeProfile(profile)` / `onProfiles(cb)` (localStorage +
  `storage` event, all guarded).
- `toGeneratorRows(profile, PRESETS)` and `fromGeneratorRows(rows, inputs)` so
  the generator mapping is pure and testable.
- `ago(iso)` for the button labels.

### Kinds and where each lands

| kind | matches (examples) | Generator preset | Service Size |
|---|---|---|---|
| range | range, stove, dual fuel | range | Cooking: `range` |
| cooktop | cooktop, induction top | cooktop | Cooking: `cook_wall` when a wall oven is present too |
| walloven | wall oven, built-in oven | walloven | Cooking (see above) |
| doubleoven | double oven, double wall oven | walloven ×2 | Cooking: `cook_double` with a cooktop |
| dryer | dryer (not gas) | dryer | Dryer `elec`, `dryerQty` = count |
| wh_tank | water heater, WH | wh | Water heater `tank`, `whQty` |
| wh_hpwh | heat pump water heater, hybrid WH | wh | `hpwh` |
| wh_tankless | tankless, on-demand, or any WH ≥ 15 kVA | tankless | `tankless` |
| ac | condenser, A/C, air conditioner | ac / ac_large by VA | `cool: "ac"` |
| heatpump | heat pump (not WH) | heatpump | `heat: "hp"` |
| minisplit | mini split, ductless | minisplit | item `minisplit` |
| airhandler | air handler, furnace blower, FAU | airhandler | nothing (inside 220.82(C)) |
| electricheat | baseboard, electric furnace, unit heater, wall heater | electricheat | item `garageheat` if "garage" in name, else `heat: "baseboard"` |
| floorheat | floor heat, radiant floor, warm floor | electricheat | item `floor` |
| snowmelt | snowmelt, snow melt, heat trace, de-icing | snowmelt | item `snowmelt` |
| ev | EV, EVSE, car charger, Tesla, wall connector | evse | item `ev` (second one → `ev2`) |
| wellpump | well pump | wellpump | item `well` |
| sump | sump, sewage, ejector, grinder | sump | item `ejector` |
| booster | booster, circulator, recirc pump | booster | extra |
| pool | pool pump, pool heater | pool | item `pool` |
| hottub | hot tub, spa (not swim spa) | pool | item `hottub` |
| swimspa | swim spa | pool | item `swimspa` |
| steam | steam shower, steam generator | generic | item `steam` |
| sauna | sauna | generic | item `sauna` |
| plunge | cold plunge, chiller | generic_motor | item `plunge` |
| elevator | elevator, lift | elevator | item `elevator` |
| garage | garage door, opener | garage | nothing (general) |
| shop | welder, compressor, shop receptacle | generic_motor | item `shop` |
| dishwasher | dishwasher | dishwasher | first → covered (basics); second → item `dw2` |
| warm | warming drawer | generic | item `warm` |
| speed | speed oven, steam oven, microwave drawer | generic | item `speed` |
| covered | refrigerator, fridge, freezer, microwave, disposal, hood, wine, beverage, ice maker, washer, trash compactor, under-counter fridge | **not sent** | listed under "covered by the standard allowances", not counted |
| other | anything else | generic (motor if "pump"/"motor"/"compressor") | **extra row** |

Service Size rule for `other` with no amps on the sheet: still an extra row with
VA 0 and the note "needs VA" so it is visible, never silently dropped.

## Generator Sizing changes (`public/tools/generator-sizing/index.html`)

Josh's regions stay byte-identical: `PRESETS`, `AIR`, `LIQ`, `PIPE`, `COND`,
`CM`, `ATS_WHOLE`, `ATS_ESS`, `calc`, `renderFuel`, `renderPad`,
`renderConnections`, `render`. Verified by diffing those function bodies before
and after.

Additive:
- `<script src="/tools/shared/load-profile.js">` before the inline script.
- Rows carry `key` (preset key) when created from a preset or the defaults, so a
  round trip to Service Size keeps the kind without name guessing.
- A **Start from another tool** card above the load rows: one button per other
  source that has a profile, a status line after a fill (`Filled 12 loads from
  Appliance Loads #1438 · 2 had no amps on the sheet and use typical values ·
  Undo`), and `Open in Service Size` when visible.
- Fill from a profile: replace `rows` with `toGeneratorRows`; set `#sqft`,
  `#saCkt`, `#lndCkt` from `house` when present; `#svcA` to the smallest option
  ≥ `service.amps` (100/150/200/400) when present; `#jobCust` ← job name,
  `#jobAddr` ← address. Rows from a Service Size "maybe" get `flag: "maybe"`
  (shown with the existing flag pill) and arrive only when the profile's
  `sizeFor` is `max`. Rows whose VA came from the preset default get
  `flag: "typical VA"`. Undo restores the previous rows and inputs.
- Publish: after any input/row change once dirty, write the generator profile
  (`fromGeneratorRows`: rows → loads with kind from `key` or classifier, house
  from the three inputs, service from `#svcA`, job from the job-sheet fields).

## Service Size changes (`tools-src/service-size/`)

`calc.js` (pure, tested):
- State gains `extras: [{ id, name, va, qty, status, note }]`, `fill: { source,
  label, at, covered: [] } | null`, `fillFields: []`. `normalizeState` fills them in.
- `calc()` counts extras exactly like `g: "appl"` items: `yes` always, `maybe` in
  the max scenario, at `va × qty`, added to `r.other` and `r.otherList`.
- `analyze()`: what-ifs include extras marked `no`; `impacts` get an entry per
  extra id.
- `bidNote()`: extras appear in the Included / Allowances lists by name.
- New `src/profile.js`: `applyProfile(state, profile)` → new state with the
  mapping above, `fillFields` for every top-level key it set, item patches with
  `fromFill: true` and a note, `fill.covered` for the skipped kinds;
  `toProfile(state, analysis)` → the Service Size profile (loads from range /
  dryer / WH / HVAC / items with status, `house`, `hvac`, `service.amps = a.rec`,
  `sizeFor`). HVAC → generator: heat pump row VA = `tons × 1500 + systems × 1000`
  (the same figures the calc uses) plus a strips row at `strip kW`; central AC
  the same without strips; baseboard = `sqft × 10`.
- `applyPlan` is untouched. A plan fill and a tool fill can both be shown; the
  tag text says which (`plans` vs `loads` / `generator`).

`ServiceSizeCalculator.jsx`:
- *Start from another tool* panel under *Start from plans*: Fill buttons per
  available source, status line with Undo, `Open in Generator Sizing` (postMessage
  to parent / link when full screen).
- Extras panel gains a **From another tool** group listing `state.extras` with
  the same row layout (name editable, VA, qty, Yes/Maybe/No, Adds, and ×), plus
  the "Covered by the standard allowances and not listed: fridge, microwave…"
  hint from `fill.covered`.
- Bid note row gains `Send to Generator Sizing`.
- Publish: `useEffect` on state writes the profile once dirty.
- `main.jsx` passes `publish`/`open` helpers from the shared module; `index.html`
  (src and built copies) loads nothing extra because the module is bundled.

Tests: `test/calc.test.mjs` (extras in (B), normalize) and new
`test/profile.test.mjs` (classifier table, appliance rows → state, state →
profile → generator rows round trip, covered list, VA-less row becomes an extra
with "needs VA").

Rebuild: `npm install` + `npm run build` in a scratch copy of `tools-src/service-size`
(node_modules is not present in the repo folder), copy the built files back,
confirm `index.html` still carries the real `PLANS_KEY`.

## App.js changes (`ApplianceLoadsView`, `ToolsView`)

- `ToolsView`: writes `he_tools_visible_v1`; listens for `he-tools-open`
  messages from its iframe (same origin only) and calls `pick(key)` when the key
  is a visible tool; passes `onOpenTool={pick}` and `tools` to
  `ApplianceLoadsView`.
- `ApplianceLoadsView`: when `cur` (an open job page) changes, write the
  appliance-loads profile: `job` from the matched Command Center job (`name`,
  `address`, `simproNo`) or the sheet label, `loads` from `cur.rows` using the
  effective (hand-set) amps, `va = volts × amps` only when both are present, `kind`
  empty. Two buttons next to *Import appliances to Home Runs*: `Send to Service
  Size` (only when that tool is in `tools`) and `Send to Generator Sizing`. With
  `onOpenTool` they write and switch; without it (job-card mount) they write and
  set `msg` to the "Open Tools → …" hint.
- No new job fields. No Firestore writes. No loader, rules or function change.

## Service worker, guide, docs

- `public/service-worker.js`: `CACHE` → `homestead-v497` (next free at ship).
  `/tools/shared/` is already under the `/tools/` guard and cache.
- `public/sops/tools.html`: new section *Tools that fill each other* (what Fill
  does, where Send lands, what "covered by the standard allowances" means, that
  it is per device and nothing is saved to the job).
- `FEATURES.md`: one entry with the data-safety line.
- Vault at ship: `02-Features/Tools Tab.md` section, daily log, crew brief.

## Data safety

Nothing in this change reads or writes Firestore. The handoff lives in one
localStorage key on the device, like `he_tools_last`. Josh's generator tables
and calc are byte-identical. Service Size's calc change is additive (new state
keys with defaults; an old or plan-filled state normalizes with `extras: []`) and
covered by tests. Appliance Loads keeps its single write path (import,
applLinks, applSpecOk, applAmps) unchanged.

## Out of scope (deliberate)

- Writing into the Appliance Loads Sheet from a calculator.
- Saving a profile on the job (Koy chose device-local).
- Auto-filling on arrival after `Send to …`.
- Estimating HVAC tonnage from condenser amps (Service Size keeps its sq-ft estimate).
