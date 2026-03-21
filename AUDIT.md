# Homestead Electric App — Full Save & Tab Audit

## Save Mechanism Overview

The app uses a **debounced save** pattern:
1. Every field change calls `u(patch)` → which calls `onUpdate(updated)` → which calls `updateJob(updated)` → which calls `saveJob(job)`
2. `saveJob` immediately writes to `localStorage` as backup, then debounces a Firestore write by 500ms
3. On tab-away (`visibilitychange`) or close (`beforeunload`), `flushSaves()` fires immediately
4. Firebase `onSnapshot` keeps all devices in sync, with pending local edits preserved

**This is solid.** Every field change triggers a save. Here are the issues I found:

---

## CRITICAL Issues (data loss risk)

### 1. `flushSaves` saves ALL jobs, not just dirty ones
**File:** `src/App.js` ~line 9021
**Problem:** When the user tabs away or closes the browser, `flushSaves()` re-writes *every single job* to Firestore — even ones that haven't been touched. With 50+ jobs, this is 50+ Firestore writes on every tab-away. It also risks overwriting changes another user just made on a different device.

**Fix:** Only flush jobs that have pending save timers.

### 2. `isDirty` only tracks a single boolean, not per-job
**File:** `src/App.js` ~line 8926
**Problem:** `isDirty.current = false` fires after *any* single job saves successfully. If you edit Job A, then quickly edit Job B, Job A's successful save sets `isDirty = false`, which means if you tab away before Job B's timer fires, `flushSaves` won't run (because `isDirty` is already false).

**Fix:** Remove the `isDirty` gate on `flushSaves`, and instead check if any save timers are pending.

### 3. Return Trip photos stored as base64 in Firestore document
**File:** `src/App.js` ~line 2095
**Problem:** Photos are resized to 500px and stored as base64 data URLs directly in the job document. Each photo adds ~30-100KB to the Firestore document. The app already has a 1MB size check and alerts, but a few photos can push a job over the limit and block ALL saves for that job. The Plans & Links tab correctly uses Firebase Storage for uploads — Return Trips should too.

**Impact:** Medium-term risk. Won't cause immediate data loss, but will eventually block saves on photo-heavy jobs.

---

## MODERATE Issues (reliability / UX)

### 4. `flushSaves` doesn't set `isDirty = false` after firing
**File:** `src/App.js` ~line 9021
**Problem:** After `flushSaves` runs, `isDirty` stays `true` forever until a normal debounced save completes. Not harmful, but means subsequent tab-aways all trigger redundant full flushes.

### 5. No save confirmation on close — modal just closes
**File:** `src/App.js` ~line 4659
**Problem:** Clicking the backdrop or ✕ on JobDetail calls `onClose()` immediately. If a debounced save is in-flight (within the 500ms window), the modal closes and the user might navigate away. The save will still fire from the timer, but if the user immediately refreshes, the timer gets cleared.

**Fix:** Call `flushJob(job)` before `onClose()` in JobDetail.

### 6. Generator load saves use `window._genSave` global
**File:** `src/App.js` ~line 2985
**Problem:** `clearTimeout(window._genSave)` uses a global window property instead of a ref. If two HomeRunsTab instances exist (unlikely but possible), they'll clobber each other's timers. Minor, but easy to fix with a ref.

### 7. `normalizeJob` applies defaults that can mask missing data
**File:** `src/App.js` ~line 3969
**Problem:** `normalizeJob` spreads defaults first, then `...raw`, then re-applies specific fields. The double-spread pattern means some fields get set twice. Not a data loss risk, but makes it harder to reason about what state a job is actually in.

---

## PER-TAB AUDIT RESULTS

### Job Info Tab ✅
- All fields use `u({field: value})` → saves immediately
- Prep stage, checkboxes, access note, foreman/lead selectors — all wired correctly
- **No issues found**

### Rough Tab ✅
- Stage bar, status selector, date fields — all save via `u()`
- Punch list, material orders, daily updates, questions, notes — all pass onChange up to `u()`
- Auto-sets `roughStatus` when stage changes (nice)
- **No issues found**

### Finish Tab ✅
- Mirror of Rough tab with finish-specific fields
- Status changes correctly reset/preserve related fields (deposit dismissed, invoice dismissed)
- **No issues found**

### Home Runs Tab ✅
- All row edits go through `onHRChange` → `u({homeRuns: v})`
- Generator load section saves to separate Firestore doc (intentional)
- Panel counts save correctly
- **Minor:** `window._genSave` global (see issue #6)

### Panelized Lighting Tab ✅
- Keypad loads, CP4 loads, extra floors — all wired through `u()`
- Adding/removing extra floors correctly updates the panelizedLighting object
- **No issues found**

### Tape Light Tab ✅
- Simple: `onChange={v=>u({tapeLights:v})}`
- **No issues found**

### Change Orders Tab ✅
- Add/update/delete all go through `onChange` → `u({changeOrders: ...})`
- CO-to-RT conversion correctly creates a new RT and updates the CO in a single `onChange` call
- **No issues found**

### Return Trips Tab ⚠️
- Add/update/delete wired correctly
- **Photo storage is the risk** (see issue #3) — base64 in Firestore doc
- Sign-off flow saves correctly

### Plans & Links Tab ✅
- File uploads go to Firebase Storage (correct approach)
- File metadata stored in job doc (lightweight)
- Link sections save via `onUpdate` → `u()`
- **No issues found**

### QC Tab ✅
- Status, date, punch list, sign-off — all wired through `u()`
- Sign-off has undo capability
- **No issues found**

### Punch Lists (Rough/Finish/QC) ✅
- PunchItems: add/toggle/delete all call `onChange`
- PunchFloor → PunchSection → parent `u()` — chain is intact
- Room-based punch with extras floors all save correctly
- **No issues found**

---

## RECOMMENDED FIXES (Priority Order)

### Fix A — Make `flushSaves` only flush dirty jobs (CRITICAL)

### Fix B — Fix `isDirty` race condition (CRITICAL)

### Fix C — Flush pending save on modal close (MODERATE)
