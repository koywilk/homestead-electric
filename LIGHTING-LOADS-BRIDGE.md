# Lighting Loads bridge — Command Center (office) side

Field → office lighting loads. FieldInk (TraceVault v580) publishes each roped
lighting load to `ccloads/<jobId>` on the **field-ink** Firebase project
(`fieldinkDb`). The office reads them into an inbox and (next increment) assigns
each to a Savant module output, then prints a clean **Load Sheet** for the client.

`<jobId>` is the office job id (`String(job.id)`) — confirmed the same id FieldInk
keys every cc* bridge on (publishCcJobsIndex writes `{id:String(j.id)}`).

## Bridge contract — `ccloads/<jobId>` (identical copy lives in the FieldInk repo)

`loads` is a **MAP keyed by field load id** (control-group id — NOT an array like
cccos). Each entry:

```
loads: {
  [id]: {
    // ── field-owned (FieldInk writes; office NEVER writes these) ──
    loadId, name, room, roomCode, sheet, floor,
    control: 'dimmer'|'switched'|'panel'|'tape',
    fixtures: [{ key, name, n }], tapeFt, tapeRuns,
    planShareId, removedAt (null | ts), fieldUpdatedAt,
    // ── office-owned (this app writes; FieldInk NEVER writes these) ──
    office: { floor, fixtureNames, assignedTo:{floor,moduleId,output}, dismissed, officeUpdatedAt }
  }
}
```

Because `loads` is a MAP, the office write-back is a **targeted merge**:
`setDoc(doc(fieldinkDb,'ccloads',jobId), { loads: { [id]: { office: {...} } } }, {merge:true})`.
Firestore `merge:true` deep-merges nested maps (only arrays are replaced wholesale),
so this preserves every field-owned key AND every other load with no pre-read — the
read-then-merge dance cccos/ccquestions need does not apply. See `publishCcLoadOffice`.

## Bridge v2 contract — FieldInk v686 ↔ Command Center SW v554 (Koy approved 2026-10-17, "do all recs", controls-standard review Sheet 7)

Line refs as of SW v554 (they drift; grep the names).

- **The doc:** `ccloads/<ccJobId>` in FieldInk's Firebase. Rule is `isOrgMember`, so no rules deploy.
- **`loads[id].control` is FROZEN:** `'switched' | 'dimmer' | 'panel' | 'tape'`, byte for byte as before.
- **New `loads[id].method`:** `'switch' | 'wallbox' | 'panel' | 'tape'`.
  - `switch` = Standard hard-wired. A hard-wired dimmer is still `switch`; `control === 'dimmer'` carries dimming.
  - `wallbox` = RA3 (FieldInk kind `'control'`), including legacy loads with no kind.
  - `panel` = panel load. `tape` = tape run.
  - Unknown or absent = fall back to `control` (CC: only control `'panel'` is placeable — today's rule; an older FieldInk iPad's switched / dimmer / tape loads wait in the inbox).
  - `'module'` and `system` are reserved; FieldInk doesn't send them yet (CC treats them as unknown).
- **New top-level `keypads[kpId]`, field-owned:** `{ label, kpType: 'ra3'|'panel', page, sheet, floor, room, assigned: [{ key, loadId }], planShareId, removedAt, fieldUpdatedAt }`
  - `assigned` has at most 40 entries. `key` is the id in the `loads` map, but that load may be missing from `loads`.
  - `room` is the most common room of its assigned loads, else the room zone at the keypad, else `''`.
- **Office-owned:** `keypads[kpId].office = { ... }` (CC writes `confirmed`, `confirmedBy`, `confirmedAt`, `engraving: { <loadKey>: text≤40 }`, `officeUpdatedAt`). FieldInk preserves it verbatim on every publish.
- **Removal and merge rules (FieldInk `mergeKeypads`):**
  - A keypad deleted in FieldInk gets `removedAt`. It is never hard-deleted.
  - A keypad whose loads were all removed stays live: `assigned: []` and `removedAt: null`.
  - A blank label, a blank room, or a `'Pg N'` sheet never overwrites content.
  - Only the publishing plan's keypads (matched by `planShareId`) are ever marked removed.
- **Who publishes:** crew devices never publish. Owner devices publish about 3 s after any change; expect repeated identical writes.
- **Office writes go ONLY inside `loads[id].office` and `keypads[id].office`.** Since SW v554 every CC write goes through `ccOfficeWritePayload` (~L1174) → `{ loads|keypads: { id: { office: {…, officeUpdatedAt} } } }`, merge:true; the old top-level `updatedAt` / `updatedBy:"office"` stamps are gone (those are FieldInk's).

### CC side (SW v554) — where each piece lives

- `ccLoadMethod` / `ccLoadDest` (~L940): method → `'loads'` (panel, tape) | `'wallbox'` (wallbox, switch) | null.
- `ccLoadImportRows` (panel + tape → `panelizedLighting.loads`, tape as `loadType:"LED"` + `tapeFt`), `ccWallboxImportRows` / `ccWallboxOrder` (→ `panelizedLighting.wallboxDevices`), both idempotent on `fieldLoadId`.
- `ccLoadSyncPlan(rows, inbox, floorOptions, dest)`: name / room / location only; the JobDetail auto-follow effect (~L31433) runs it for both lists in ONE `u()`.
- Keypads: `ccKeypadPrefillPlan` → `ccKeypadFillPatch` (existing floor sections, blank rows first, skips `confirmedKeypads[key]`, idempotent on `fieldKeypadId`), `ccKeypadRemovedRows` (flag, never drop), `ccKeypadConfirmPatch`, `ccKeypadEngravePatch`, writer `publishCcKeypadOfficeMany` (~L806). UI: "Keypads from FieldInk" strip at the bottom of the inbox, `FieldKeypadPanel` under filled rows, `WallboxDevicesSection` under the Loads list.
- Tests: `scripts/ccloads-suggest-test.js` (prebuild gate).

## Status

- **B1 — inbox (SHIPPED, SW v394, read-only + office-owned dismiss).**
  `ccLoadInbox` listener in JobDetail (mirrors the cccos listener); an "Incoming
  from FieldInk" block above the Loads SectionHead; Dismiss writes only
  `office.dismissed` via `publishCcLoadOffice`. Touches NO job data.
- **B2 / B3 — assign + fixture-name override (NEXT increment — job-data writes).**
- **B4 — Load Sheet print + `?loadsheet=` share (NEXT increment — read-only).**
- **v2 — methods, Wallbox Devices, keypads (SHIPPED, SW v554, pairs with FieldInk v686).** See the contract above.

## Reconciled model for the NEXT increment (mapping surfaced 3 corrections to the spec)

1. **Savant outputs are DERIVED, not stored.** `getSavantV2ForFloor` (~L3544)
   REBUILDS modules/outputs on every read from V1 `pl.cp4Loads[floor]` via
   `migrateToSavantV2`; `buildOutput` (~L3402) HARD-WHITELISTS output fields
   (name, loadType, watts, keypad, room, pulled, notes, _legacyId). `modules[].id`
   is `uid()` minted fresh per read (unstable). Consequences for **assign**:
   - Write name / loadType(dim↔switch) / room into the V1 `cp4Loads` row for that
     module+channel via the existing single-patch save (`handleSaveSlot` ~L25643),
     NOT by adding fields to the output object (silently dropped).
   - Store the additive fields (`fieldLoadId`, `fixtures`, `tapeFt`) in NEW SPARSE
     OVERRIDE MAPS in `pl.savantV2[floor]` (e.g. `outputFieldLoadId`,
     `outputFixtures`, `outputTapeFt`), keyed by `modNum`+channel like the existing
     `outputRooms`/`inputAssignments`, and inject them in `getSavantV2ForFloor`
     right after the `outputRooms` block (~L3569). Only mod#-paired outputs can
     carry overrides (unpaired modules have `modNum:''`).
   - **NEVER fire multiple single-field Savant handlers in a row** — each reads the
     frozen `job` and `u()` replaces `panelizedLighting` wholesale, so only the LAST
     survives (the H6 bug). One combined patch per assign.
   - Every persistent edit goes through `u()` (~L30625, inside JobDetail), never `setJob`.
2. **ccloads is a MAP, not the cccos array** — office write-back is the targeted
   merge above (already built as `publishCcLoadOffice`).
3. **The Load Sheet renders the office's OWN assigned loads** (`allSavantLoadsForJob`),
   it does NOT read ccloads. Clone `LoadsSharePage` (~L55699, reads `doc(db,'jobs',id)`)
   for a `?loadsheet=` route (beside the `?loads=` route, ~L68285), and clone a print helper (printSavantV2PanelCover
   ~L4800, keep the pop-up-blocked guard) for `printLightingLoadSheet`; button beside
   the existing Savant print buttons (~L25948), passing the whole-job loads.

Deploy: bump `public/service-worker.js` CACHE; Koy commits + pushes; NO
homestead-electric own-project firestore.rules change (writes go to its own `jobs`
collection via saveJob, and to the field-ink project's ccloads governed by that
project's already-deployed rules).
