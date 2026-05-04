# Homestead Electric App — Handoff

## Deploy Workflow (CRITICAL — read first)

**Only edit:** `/sessions/pensive-tender-mayer/mnt/src/App.js`
This path syncs directly to `~/Desktop/homestead-electric/src/App.js` on the Mac.
**Never edit** `mnt/homestead-electric/src/App.js` — that path does NOT sync back.

**To deploy the React app after any App.js change:**
```bash
cd ~/Desktop/homestead-electric
git add src/App.js
git commit -m "describe the change"
git push
```
Vercel auto-deploys on push to main.

**To deploy Firebase functions (only needed when functions/index.js changes):**
```bash
cp ~/Desktop/homestead-electric/src/functions_index_updated.js ~/Desktop/homestead-electric/functions/index.js
cd ~/Desktop/homestead-electric
firebase deploy --only functions
```

---

## Project Overview

- **React app** (single file, ~14,000 lines): `~/Desktop/homestead-electric/src/App.js`
- **Firebase project**: `homestead-electric`
- **Firestore**: `jobs` collection — each doc has a `data` map (`data.name`, `data.simproNo`, `data.driveFolderId`, etc.)
- **Firebase API key**: `AIzaSyAQl6V74U502_ZHF3h_1W0yYDuKr2mLI5Q`
- **Drive parent folder ID**: `1laC4udt1sBdV-_QUMzzbKJfD03q4_Ml3`
- **Simpro URL**: `homesteadelectric.simprosuite.com`
- **Simpro API token**: `402222413e886be0bda7bd5173aa8e215d34bcdb`
- **Simpro company ID**: `0`

---

## VM Network Constraints

- `firestore.googleapis.com` is **BLOCKED** from the VM (app in browser can access it fine)
- `www.googleapis.com` is **BLOCKED** from the VM (Drive API)
- npm registry is **BLOCKED** from the VM — cannot install packages
- Google Drive MCP tool works via OAuth from the VM
- **Simpro API** (`homesteadelectric.simprosuite.com`) is **accessible** from the VM

---

## What Was Built This Session

### 1. Push Plans to Simpro (NEW — needs 2 deploys)

**What it does:** Button in Plans & Links tab on each job that pushes Google Drive plan files to the matching Simpro job. Additive only — never deletes from Simpro. Mirrors Drive subfolder structure.

**How it works:**
- Firebase Cloud Function (`pushPlansToSimpro`) handles all the work server-side:
  1. Fetches existing Simpro attachments (checks by filename to skip duplicates)
  2. Lists Drive files recursively using the API key
  3. Downloads each new file from Drive, uploads to Simpro as base64 JSON
  4. Creates matching Simpro attachment folders for Drive subfolders
- 15MB per-file cap; Google Docs/Sheets types are skipped (PDFs and images only)

**Button appears:** In the `DriveFilesSection` header — only visible when the job has both a Simpro Job # and a Drive folder linked.

**Files changed:**
- `mnt/src/App.js` — added `getFunctions`/`httpsCallable` import, `const functions = getFunctions(firebaseApp)`, `simproSync` state + `handlePushToSimpro` function in `DriveFilesSection`, button UI + results panel
- `mnt/src/functions_index_updated.js` — complete updated `functions/index.js` with `pushPlansToSimpro` callable function (user needs to cp this to `functions/index.js` and run `firebase deploy --only functions`)

**Deploy status:** App.js deployed ✅ (after syntax fix below). Firebase function — user needs to run the cp + deploy command above.

### 2. PO Preview Syntax Fix (bug fix)

The PO collapsed-state preview (shows first line of material items + "N more") was using an IIFE pattern `(()=>{...})()` inside JSX that CRA's Babel parser rejected at build time. Fixed by extracting it to a helper function `poItemsPreview()` defined just above the `MaterialOrders` component.

---

## Features Built in Previous Sessions (summary)

- **Multi-line material needed field** on punch items — auto-formats as bullet list, smart-appends to open PO or creates new one
- **Order Sent to Supplier** status on PO cards — orange → blue → green flow
- **Material items display vertically** in PO (uses `<br>` tags, not `\n`)
- **Material needed shows on mobile** punch list (RichMobileSheet has `showMaterial` prop)
- **Auto-save on phone lock / navigate away** — `visibilitychange` listener in RichMobileSheet calls `onDone`
- **Cancel saves instead of discarding** if content exists; backdrop tap-to-dismiss removed
- **Material Count List** — own section with Clear Counts + Add to PO buttons; Add to PO uses same smart-append PO logic
- **Material needed editable on existing punch items** — not just on creation
- **Upcoming jobs delete** — fixed with dedicated `onDelete` prop calling `deleteUpcomingItem` directly
- **Inspection UI redesign** — planned but not yet built (see memory)

---

## Key Code Locations in App.js

| Feature | Function/Line |
|---|---|
| Drive files section + Push to Simpro | `DriveFilesSection` (~line 4570) |
| Drive recursive file fetch | `fetchDriveFilesRecursive` (~line 4487) |
| Drive→job folder sync | `syncDriveFoldersToJobs` (~line 4540) |
| PO preview helper | `poItemsPreview` (just above `MaterialOrders`) |
| Material orders UI | `MaterialOrders` (~line 2335) |
| Material tally / count list | `MaterialTally` (~line 2460) |
| Punch items | `PunchItems` (~line 1695) |
| Mobile sheet editor | `RichMobileSheet` (~line 1410) |
| Job detail modal | `JobDetail` (search `function JobDetail`) |
| Plans tab | `PlansTab` (~line 5055) |

---

## Simpro API Quick Reference

```
Base: https://homesteadelectric.simprosuite.com/api/v1.0/companies/0
Auth: Authorization: Bearer 402222413e886be0bda7bd5173aa8e215d34bcdb

GET  /jobs/{simproNo}/attachments/files/     → list files [{ID, Filename}]
GET  /jobs/{simproNo}/attachments/folders/   → list folders [{ID, Name}]
POST /jobs/{simproNo}/attachments/folders/   → create folder {Name: "..."}
POST /jobs/{simproNo}/attachments/files/     → upload file {Filename, Base64Data, Folder?: id}
```

CORS: Simpro does NOT return `Access-Control-Allow-Origin`, so API calls must go through the Firebase Cloud Function (not directly from the browser).

---

## User Preferences

- Always explain **why a change won't lose data** before making it
- Always deploy **complete Firestore rules** (partial deploys silently broke prod)
- Never edit `mnt/homestead-electric/src/App.js` — only `mnt/src/App.js`
