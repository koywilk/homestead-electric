# Lutron Panel Builder — design (draft for Koy)

**Status:** Design phase — Koy is shaping it in /design first (canvas: https://claude.ai/artifact/AmASTdBUAU4avf4A41b2nf). No app code until he approves the canvas.
**Date:** 2026-09-25 · **Owner:** Koy
**Mockup:** https://claude.ai/artifact/BxxWDH4iimqu9xpoqAM5o3 (clickable; private until shared)
**Replaces:** the Lutron / Control 4 / Crestron "Panel Loads" section (`PanelModulesSection`) and the
"Assign to module" batch flow on `LoadsList`
**Shipped alongside this draft:** the clean load-list download (PDF / CSV, v448)

## Problem (Koy, 2026-09-25)

> "panelized lighting, specifically lutron needs a way better way to organize and assign modules
> and panels etc."

What the code does today, and why it fights him:

1. **A panel is a floor.** Modules live in `panelizedLighting.cp4Loads.{main|basement|upper}`
   and "extra floors" (`extraFloors` + `pl[extraKey]`) are really extra panels. Panel names are
   an overlay (`plSectionLabels`) on floor sections, and each module also carries a free-text
   `panel` field. Lutron panels are LCP 1 / LCP 2 in a mech room and a closet; the floor grouping
   is meaningless for laying them out.
2. **Assigning copies the load.** "Assign to module" pushes a *copy* of the load's name, type and
   watts into the module's own `loads` array. The link back to the master list is the trimmed
   name string (`assignedModMap`). Rename a load in one place and the badge breaks; a load can
   sit on two modules; deleting a module row doesn't unassign the master row.
3. **No capacity anywhere.** Channel caps exist per module type (`chCap`) but nothing shows slots
   used per panel, open zones per module, or watts per dimmer zone until you count by hand.
4. **Placement is one dropdown per load.** Select rows, pick `floor|modNum|isExtra` from a select,
   then move singles between modules from another select inside the module card.

## Design

### Model: panel → module → zone, load assigned by reference

- `panelizedLighting.panels = [{ id, label, where, slots, modules: [{ id, num, type }] }]`
- each load in `panelizedLighting.loads[]` gains `assign: { panelId, moduleId, zone } | null`.
  `moduleId` and `zone` may be `null`: the load is **parked on the panel with no module yet**
  (Koy, 2026-09-25: "have the option to put on a panel too, that way I can separate panels without
  having to set modules yet"). Parked loads count as needing a zone, show in the panel card's
  "On this panel, no module yet" tray, and Suggest layout only ever fills them into that panel.
- module type catalog is replaced by the verified Lutron list below (`kind`, zones, `maxW` /
  `maxA` per zone and per module).

Loads stay the single source of truth. Modules hold no copies. Everything a module "contains" is
derived: `loads.filter(l => l.assign?.moduleId === m.id)`.

### Screen (see the mockup)

- **Summary strip:** unassigned count, zones used / total, panels · modules, zones over watts.
- **Loads tray** (left / top on phones): floor → room → A–Z, type chip, watts, and for assigned
  loads a green `LCP 1 · Mod 2 · Z3` chip. Search, Dimming / Switching filter, Unassigned /
  Everything toggle, Select for batch.
- **Panels** (right / below on phones): one card per panel with location and a slot meter; one
  block per module with `MOD n · type · used/zones · ≤W`, a row per zone (filled or dashed
  "open zone"), and empty slot placeholders that add a module.
- **One interaction, no drag** (the Crew Board v2 rule): tap a load → sheet with Panel chips →
  Module chips (first chip is **No module yet**, which parks the load on the panel; then one per
  module with its open-zone count, greyed when it can't fit) → Zone chips (occupied zones show who
  they'd bump) → Assign / Move here / Clear zone. Tap an open zone → sheet listing unassigned
  loads, matching type first. Select N loads → "Put on a module…" fills the next open zones in
  order and says how many didn't fit.
- **Suggest layout:** walks unassigned loads floor → room, puts dimming on dimmer modules and
  switching on switching modules with open zones and enough wattage headroom, creates modules
  in open slots when none fit, and stops when a panel is full. It's a starting point; every
  placement is one tap to change.
- **+ Module** picks a type from chips; **+ Panel** asks label, location, slot count.

### Migration (the risky part — needs a decision)

Read-side: on first open of a job with no `panels`, derive panels from the floor sections and
extras, modules from `migrateFloorToModules(...)`, and `assign` on each master load by matching
the module row's name to a master load (the same name match `assignedModMap` uses today).
Module rows whose name matches no master load become new master loads (flagged `origin:
"module"`) so nothing is lost. Write-side: the first save from the new builder persists
`panels` + `assign` and leaves the old floor arrays untouched.

Consumers of the old shape that must keep working or move in the same ship:
`migrateFloorToModules` callers, the keypad suggestion filter (`_assignedNames`), the LV collab
share page (`LightingSharePage` — the LV company WRITES module/channel info into the old shape),
`LutronAdditionsSharePage` / `LightingHubPage`, the panel schedule print/download
(`printPanelSchedule`), and the loads share page's `assignedTo.panelLabel` grouping. Option A:
move them all to the new model in one ship (bigger, clean). Option B: keep a derived mirror of
the old floor arrays written alongside `panels` so old readers keep working for one release
(smaller ship, temporary double-write). Recommendation: A for readers, and the collab share page
gets its own small rewrite since it writes.

Savant is untouched — it already has the slot-first, load-as-entity model (`allSavantLoadsForJob`).

### Data safety

Additive: `panels` is a new array; `assign` is a new key on existing load rows; the old floor
arrays are never cleared by the builder. A wrong `assign` is one tap to fix; a wrong migration
is visible immediately as "unassigned" rows, never as lost loads. Per-field job version history
and the recovery ledger cover `panelizedLighting`.

## Module catalog (verified 2026-09-25 against Lutron spec submittals; on the canvas as "Module catalog")

Lutron's HomeWorks "Modules" list today is exactly eight 120 V DIN power modules. Ratings below
are from Lutron's own spec sheets (3691126, 3691052, 3691060, 3691054, 3691278, 3691107, 3691251,
369842, QSX Link Equipment sheet), not distributor pages.

| Model | What | Zones | Per zone · module | Width | App today |
|---|---|---|---|---|---|
| LQSE-4A5-120-D | PRO LED+ phase adaptive dimmer; replaces every legacy RPM dimmer (App Note 840) | 4 | Z1 800 W INC/ELV, 6.6 A LED, 400 W fwd-phase LED; Z2–4 500 W, 4.2 A LED, 200 W fwd-phase; 16 A module | 12 DIN | **missing** |
| LQSE-4S8-120-D | Switching, zero-cross relays, air gap per output; no general receptacles | 4 | 8 A/zone; 16 A max/module; 1/3 HP | 9 DIN | **"LQSE-S8" with 8 ch — wrong: 4 zones, 8 = amps** |
| LQSE-4T5-120-D | 0–10 V dimming + switching relays | 4 | 5 A/zone; 20 A max/module; 50 mA 0–10 V | 9 DIN | **"LQSE-T5" with 5 ch — wrong: 4 zones, 5 = amps** |
| LQSE-4T20-120-D | 0–10 V + Softswitch, heavy; receptacles OK; replaces RPM-4R; QSX only | 4 | 20 A/zone tungsten/general, 16 A LED drivers, 1 HP | 12 DIN | missing |
| LQSE-4M-120-D | Motor control, interlocked raise/lower, motors only, one per zone | 4 | 5 A/zone; 16 A total | 9 DIN | missing |
| LQSE-2HDC-D | HomeWorks Digital power module (Ketra / Lumaris / HW Digital drivers); QSX only | 2 buses | 64 loads per bus, 250 mA | 9 DIN | missing |
| LQSE-1DAL2-D | DALI-2 single-bus master, current U.S. DALI part; QSX only | 1 bus | 64 loads, 64 zones | 9 DIN | missing |
| LQSE-4A1-D | Adaptive dimmer 120–240 V, 1 A/zone (niche) | 4 | 1 A/zone; 4 A module | 9 DIN | missing, optional |
| LQSE-4A-120-D | Phase adaptive dimmer — **discontinued** per Lutron's 2025 QSX panel spec (3691193) | 4 | Z1 400 W; Z2–4 250 W; 2 A LED; 10 A module | 12 DIN | as "LQSE-4A" (keep as legacy) |
| LQSE-2ECO-D | EcoSystem loop controller (HomeWorks QS era; in QS panel spec 3691055, not the QSX one) | 2 loops | 64 drivers per loop | 9 DIN | as "LQSE-2ECO" (legacy) |
| LQSE-2DAL-D | DALI v1, two buses; superseded by 1DAL2 on QSX | 2 buses | 64 loads, 16 zones per bus | 9 DIN | as "LQSE-2DAL" (legacy) |

Legacy HW-RPM-4A/4U/4E/4J/4R/4M/4FSQ remote power modules are non-DIN cabinets and stay out of
the picker (App Note 840 maps each to a DIN module above).

**Panels (slots per enclosure, from 3691193 / 3691055):** current QSX feed-through line
PD2-16T-DV (2), PD4-42T-DV (4, control), PD6-42T-DV (6), PD8-65T-DV (8, control), PD10-65T-DV
(10); older QS line PD2-16F-120 (2), PD4-36F-120 (4), PD5-36F-120 (5), PD8-59F-120 (8),
PD9-59F-120 (9); breaker panels PD8-65A-120… (8 + 8 AFCI breakers); PD8 retrofit subplate (8).
Every module takes one slot regardless of DIN width. Which panels Homestead actually buys is still
Koy's call; slot count stays editable per panel.

**Catalog for the builder.** `kind` drives Suggest layout and type gating; `maxW` / `maxA` now
have real values:

- dimming: 4A5 (zones [800, 500, 500, 500] W, module 16 A), 4A legacy ([400, 250, 250, 250] W,
  10 A), 4A1 (1 A/zone). Zone 1 is the big zone → Suggest puts each module's largest load there.
  Refuse receptacles and non-dimmable loads.
- switching: 4S8 (8 A/zone, 16 A module). 0-10V: 4T5 (5 A/zone, 20 A module), 4T20 (20 A/zone,
  the only one that may switch receptacles).
- motor: 4M (5 A/zone, 16 A module, motor loads only).
- bus: 2HDC (2 × 64), 1DAL2 (1 × 64), 2ECO (2 × 64, legacy), 2DAL (2 × 64, legacy) — hold up to
  their load count; the zone number is the fixture address.

Migration: existing docs that stored "LQSE-S8" read as 4S8-120-D and "LQSE-T5" as 4T5-120-D;
loads sitting on channels 5–8 of an "S8" (or 5 of a "T5") land unassigned and the builder says so.
"LQSE-4A" stays valid as the legacy 4A-120-D. Default for a new module: 4A5-120-D.

## Koy's answers (2026-09-25)

- Homestead assigns modules on Lutron jobs → the builder is the source; the PDF goes to Tech Lighting.
- Panel slot counts / module list / watt limits: unknown yet → confirm with Tech Lighting before enforcing; the builder ships with slot count editable per panel and watt limits off until set.
- Word on screen: **zones**.
- Lutron only for the first ship (Control 4 / Crestron keep today's section).
- Migration: option A, the clean move, once the design is approved.

## Open questions (original list, kept for the record)

1. **Who assigns modules on a Lutron job — Homestead or Tech Lighting?** The guide says Tech
   Lighting sends the loads list on Lutron jobs. If they design the panels, the builder is a
   *mirror* of their schedule (and the hub link should show it); if Homestead designs, the
   builder is the source and the PDF goes to them.
2. **Panel sizes.** How many module slots does each panel type you buy hold (LCP 4 / 6 / 8)?
   And the real module list: is `LQSE-4A / 2ECO / S8 / T5 / 2DAL` complete, and what are the
   per-zone watt limits you want enforced (the mockup guesses 800 W on the 4A)?
3. **Zones vs channels.** Lutron calls them zones; the app says "Ch". Which word on screen?
4. **Control 4 and Crestron.** Same builder with their module catalogs, or Lutron only first?
5. **Migration option A or B** above.

## Acceptance (once approved)

- [ ] Open a Lutron job: summary strip, tray, panels render from existing data with zero loads lost (unassigned count = master loads not matched to a module row).
- [ ] Tap load → assign, or park on a panel with no module; tap zone → move / off-module-keep-panel / clear; batch place; suggest layout respects parked panels; add module; add panel — all on phone and laptop, no drag.
- [ ] Capacity: slots, zones, watts shown and enforced (over-watt flagged red, full modules greyed in the sheet).
- [ ] Every old consumer listed above reads the new model (or the mirror, if option B).
- [ ] Guides `panelizedlighting.html` + `lightinglinks.html` updated; FEATURES entry; SW bump; `needs-dryrun` (or a new harness) covers migration + suggest layout.
