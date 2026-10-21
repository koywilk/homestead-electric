# v556 — Control4 receiver and imported device labels

Built on production v555 (1446b0e3de36460ec620d0f74bd989d188ea4425). FieldInk's v737+ explicit lighting system and Lux/Contemporary collection reached the bridge but were discarded on import. Command Center called every smart wallbox load RA3.

Incoming chips, Wallbox Devices rows/order totals, Loads Ran and keypad labels now use explicit per-plan system information. New panel/tape, wallbox and keypad imports retain valid system/collection metadata. Existing load rows hydrate known metadata through the existing current-job/server-confirmed sync; existing keypad labels resolve live bridge metadata without refilling or unlocking confirmed sections. Unknown/absent metadata never clears a saved choice; explicit Lutron clears an obsolete Control4 collection. Legacy rows without system information keep their prior RA3 fallback. No inference from the job's panel-builder selection.

Physical routing stays unchanged: panel + tape → Loads; smart wallbox + standard switches → Wallbox Devices. Counts split by actual system/collection. Standard devices remain Standard even on a Control4 plan.

Review caught a snapshot interaction: a metadata-only update must not advance unapproved name/room/floor changes. The automatic patch now advances only the description fields actually accepted automatically. Manual changes remain offered; office edits, device choice, pulled stamps, assignments, archives and keypad confirmation/engraving are preserved.

## Validation

- 93 new receiver checks execute current helper bodies: imports, old-row hydration, explicit/unknown/missing metadata, mixed system totals, idempotency, pending manual names, confirmed keypads, removal/restore and current UI adapter connections.
- 186 existing bridge and 67 save/merge checks passed. The complete mandatory prebuild chain and production build passed (existing lint/bundle warnings). The production landing render passed; role-gated tabs were unavailable to its disposable identity, so that smoke check does not prove their behavior. A separate browser fixture exercised the current Wallbox Devices and Field Keypad components at 390px and 1440px: correct mixed-system labels/counts, legacy metadata hydration, confirmed keypad display, and office edit preservation; no overflow, page errors or external network calls.
- Rose read-only check on 2026-10-20: linked live share, 54 active load records (15 panel, 6 tape, 18 smart wallbox, 15 standard) and 20 active keypads; all loads explicitly Control4. The job initially had no imported load/wallbox rows. A live import through the normal UI is the remaining end-to-end verification, not a direct database patch.

Why this won't lose data: additive validated metadata only, using existing per-row save/merge and server-confirmed synchronization. No removal, reassignment, plan geometry, security-rule, sharing-permission, backend-function or FieldInk PDF/Drive changes. The original Desktop checkout's unrelated work is untouched; release source is the isolated `/private/tmp/rose-cc-diagnosis` checkout.
