# Drive → Firestore Sync Report

**Date:** 2026-03-21 (Scheduled Run)
**Status:** ⚠️ Partial — Drive folders listed, Firestore update blocked

---

## Drive Folders Found: 8

| # | Folder Name | Folder ID |
|---|-------------|-----------|
| 1 | #1260 - Colton Residence | `1XJI7olUAAduEpTjtda_JNLwCgvwFCKTB` |
| 2 | #959 Stratton Residence Plans | `1rJQBPS8CVHSfFPLtwGp0VIl-BIIvzfbB` |
| 3 | #998 Forth | `1Xf2PRkFgqXgscCyZR6z1KZG-PNURyZR7` |
| 4 | Ashcraft Plans | `1uqcj3UlLKJ6uYyYPWcG6TGf0iwir6Ksd` |
| 5 | Casten-Vaught Residence | `1Zf3JVJviLasIAx0apPcgt06U9CTGmarp` |
| 6 | Meyers Plans | `1KRZxKR79Z6OE4nJ1aCxDwrRDKeSDPUYj` |
| 7 | The Hideout - Black Oak | `1Mjm2mz5Wqaaw8GnoTkBcw_YSOkKSBpO0` |
| 8 | Webb - Aspen Lane | `1ISzn-Rc5WHOXSr4jzyDgGqX9uJidJcii` |

**New since last scan:** `#959 Stratton Residence Plans` (folder ID: `1rJQBPS8CVHSfFPLtwGp0VIl-BIIvzfbB`, created 2026-01-20)

## Firestore Access: BLOCKED

The Firestore REST API (`firestore.googleapis.com`) is blocked by the VM's egress proxy (HTTP 403 — `blocked-by-allowlist`). This means:

- **Cannot read** current job list to check which jobs already have `driveFolderId` set
- **Cannot write** updated `driveFolderId` values to job documents

## Recommended Action

The app's built-in `syncDriveFoldersToJobs()` function (in `App.js` around line 3517) runs in the browser and CAN access Firestore directly. **Trigger a sync from the app UI** to link these Drive folders to their matching jobs.

Alternatively, to make this scheduled task work autonomously, the Firestore domain (`firestore.googleapis.com`) would need to be added to the VM's egress allowlist.

## Folder-to-Job Match Preview

Based on the naming conventions, these matches would likely be made when the in-app sync runs:

| Drive Folder | Expected Job Match |
|---|---|
| #1260 - Colton Residence | Colton |
| #959 Stratton Residence Plans | Stratton |
| #998 Forth | Forth |
| Ashcraft Plans | Ashcraft |
| Casten-Vaught Residence | Casten-Vaught |
| Meyers Plans | Meyers |
| The Hideout - Black Oak | The Hideout / Black Oak |
| Webb - Aspen Lane | Webb |
