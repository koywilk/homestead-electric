# v555 — FieldInk load removals follow through to CC

Built on production v554 (2ff475dcf24ef160108952d9bbd62cb8c1539898). The initial local v539 draft was based on an older checkout and was not deployed; this release preserves v554's method routing, Wallbox Devices, keypad fill, and row-intent merge.

An explicit FieldInk deletion now removes a linked imported row from the active Loads or Wallbox Devices list. Its complete office row is archived under `fieldRemovedLoads` or `fieldRemovedWallboxDevices`. A newer explicit FieldInk undo restores it. Missing bridge rows and offline/cache snapshots never count as deletions; reconciliation is fenced to the current job's server-confirmed snapshot.

Why it won't lose data: the save transaction archives the latest server row, retaining office notes, wattage, pulled stamps, assignments, and concurrent edits. Restore does not steal an occupied Lutron zone or override a newer deletion. Manually entered rows and independent legacy module rows remain unchanged. No FieldInk app, PDF, Drive, rules, permissions, or backend function change.

Validation: 186 bridge checks, 67 save/merge checks, complete prebuild checks, and production compilation. The original FieldInk bridge tests also passed (454 checks). The specific production load was not directly edited. After this release is live, opening the relevant job online reconciles FieldInk's explicit removal.

User explicitly requested deployment in this task. Ship only this release's frontend, tests, feature/guide notes, and crew brief. The original Desktop checkout has unrelated local work and is not used as the deployment source.
