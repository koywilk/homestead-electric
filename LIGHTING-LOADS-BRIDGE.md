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

## Status

- **B1 — inbox (SHIPPED, SW v394, read-only + office-owned dismiss).**
  `ccLoadInbox` listener in JobDetail (mirrors the cccos listener); an "Incoming
  from FieldInk" block above the Loads SectionHead; Dismiss writes only
  `office.dismissed` via `publishCcLoadOffice`. Touches NO job data.
- **B2 / B3 — assign + fixture-name override (NEXT increment — job-data writes).**
- **B4 — Load Sheet print + `?loadsheet=` share (NEXT increment — read-only).**

## Reconciled model for the NEXT increment (mapping surfaced 3 corrections to the spec)

1. **Savant outputs are DERIVED, not stored.** `getSavantV2ForFloor` (~L2387)
   REBUILDS modules/outputs on every read from V1 `pl.cp4Loads[floor]` via
   `migrateToSavantV2`; `buildOutput` (~L2245) HARD-WHITELISTS output fields
   (name, loadType, watts, keypad, room, pulled, notes, _legacyId). `modules[].id`
   is `uid()` minted fresh per read (unstable). Consequences for **assign**:
   - Write name / loadType(dim↔switch) / room into the V1 `cp4Loads` row for that
     module+channel via the existing single-patch save (`handleSaveSlot` ~L21162),
     NOT by adding fields to the output object (silently dropped).
   - Store the additive fields (`fieldLoadId`, `fixtures`, `tapeFt`) in NEW SPARSE
     OVERRIDE MAPS in `pl.savantV2[floor]` (e.g. `outputFieldLoadId`,
     `outputFixtures`, `outputTapeFt`), keyed by `modNum`+channel like the existing
     `outputRooms`/`inputAssignments`, and inject them in `getSavantV2ForFloor`
     right after the `outputRooms` block (~L2412). Only mod#-paired outputs can
     carry overrides (unpaired modules have `modNum:''`).
   - **NEVER fire multiple single-field Savant handlers in a row** — each reads the
     frozen `job` and `u()` replaces `panelizedLighting` wholesale, so only the LAST
     survives (the H6 bug). One combined patch per assign.
   - Every persistent edit goes through `u()` (~L25030), never `setJob`.
2. **ccloads is a MAP, not the cccos array** — office write-back is the targeted
   merge above (already built as `publishCcLoadOffice`).
3. **The Load Sheet renders the office's OWN assigned loads** (`allSavantLoadsForJob`),
   it does NOT read ccloads. Clone `LoadsSharePage` (~L44593, reads `doc(db,'jobs',id)`)
   for a `?loadsheet=` route (~L51735), and clone a print helper (printSavantV2PanelCover
   ~L3346, keep the pop-up-blocked guard) for `printLightingLoadSheet`; button beside
   the existing Savant print buttons (~L21467), passing the whole-job loads.

Deploy: bump `public/service-worker.js` CACHE; Koy commits + pushes; NO
homestead-electric own-project firestore.rules change (writes go to its own `jobs`
collection via saveJob, and to the field-ink project's ccloads governed by that
project's already-deployed rules).
