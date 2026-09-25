# Lutron Panel Builder — design (draft for Koy)

**Status:** Draft, awaiting Koy's answers to the open questions below
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
- each load in `panelizedLighting.loads[]` gains `assign: { panelId, moduleId, zone } | null`
- module type catalog (`LQSE-4A` 4 zones dimming, `LQSE-2ECO` 2, `LQSE-S8` 8 switching,
  `LQSE-T5` 5, `LQSE-2DAL` 2) gains `kind` and, where Tech Lighting confirms it, `maxW` per zone.

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
  Module chips (open-zone count, greyed when it can't fit) → Zone chips (occupied zones show who
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

## Open questions for Koy

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
- [ ] Tap load → assign; tap zone → move / clear; batch place; suggest layout; add module; add panel — all on phone and laptop, no drag.
- [ ] Capacity: slots, zones, watts shown and enforced (over-watt flagged red, full modules greyed in the sheet).
- [ ] Every old consumer listed above reads the new model (or the mirror, if option B).
- [ ] Guides `panelizedlighting.html` + `lightinglinks.html` updated; FEATURES entry; SW bump; `needs-dryrun` (or a new harness) covers migration + suggest layout.
