# Claude handoff — v343 portal audit fixes (Grok draft)

**Status:** Draft implementation by Grok. **Claude has final say on what to push.**  
**Branch:** `cursor/v343-audit-fixes-for-claude-93ef`  
**Base:** `main` @ `17779df` (v343)  
**Do not merge / do not bump SW until Claude reviews.**

---

## Intent

Claude’s push-triggered audit on v343 found portal bugs around Needs & scheduling / Matterport / inbox anchors. Grok implemented the high + medium findings (plus cheap lows that rode along) so Claude can tweak and decide what ships.

**Working rule (Koy):** Claude always has final say on what to push. This PR stays draft until Claude approves.

---

## Data safety

| Change | Writes? | Why it won’t lose data |
|--------|---------|------------------------|
| Inbox `itemId` label | No | Display-only in `GCPortalInbox` |
| Matterport complete guard + shared `_gcMpNeedsDate` | No | Display / CTA gating only |
| `_gcStatusPills` status map | No | Display-only |
| Matterport `k:"act"` + tag copy | No | Display / tile count only |
| Matterport `dateKind` confirm/suggest | Client submit only | Same `gc_requests` funnel; no job docs |
| `matterportStatusDate` projection | Mirror publish only | Additive field on portal mirror; never touches `jobs/{id}` |
| `gcPortalSubmit` date validate + dedupe | `gc_requests` only | Rejects bad/empty dates; returns existing open request id on dup — no job writes |
| Logo Set reset on token/`logoUrl` | No | UI state only |

**Firestore rules:** not touched.  
**Job documents:** not written by any of these paths.

---

## What Grok changed

### 1. High — Office inbox shows date anchors
**File:** `src/App.js` → `GCPortalInbox`  
**Fix:** Render human label from `itemId`:
- `finish_start` → “Finish start”
- `matterport` → “Matterport”
- other date anchors → “Return trip”
- answer → “Question”

Line shape: `Suggested a date · Finish start`

### 2. Medium — Matterport no longer solicits after complete
**File:** `src/App.js`  
**Fix:** Shared `_gcMpNeedsDate(j)`:
- requires `matterport.status`
- excludes `status === "complete"`
- requires zero links  
Used by **card `tagsOf`** and **modal Needs & scheduling** so they cannot drift.

### 3. Medium — Finish status pills map from `Fn.status`
**File:** `src/App.js` → `_gcStatusPills`  
**Fix:** Explicit map matching `FINISH_STATUSES` / `ROUGH_STATUSES` labels. Removed the buggy `projectedStart → Awaiting Start Date` branch. Empty finish + rough complete still shows “Finish: not started”. Rough pills also expanded to the same status set (Claude: trim if too chatty on cards).

### 4. Medium — Project `matterportStatusDate`
**File:** `functions/gcPortal.js` → `matterportView`  
**Fix:** Mirror now includes `statusDate`. Portal dates row + Matterport Needs copy show it when present.  
**Note:** Existing mirror docs refresh on next job publish / rebuild — Claude may want an optional `gcPortalRebuild` nudge in the PR notes.

### 5. Medium — Matterport `dateKind` confirm vs suggest
**File:** `src/App.js` → `GCPortalDetail` Matterport `GCSendBox`  
**Fix:** `scheduled` → `confirm` + “Confirm date or suggest a different one”; otherwise `suggest` + “Suggest a scan date”. Matches finish-start / RT pattern.

### 6. Medium — Server date validation + dedupe
**File:** `functions/index.js` → `gcPortalSubmit`  
**Fix for `type:"date"`:**
- require non-empty `date`
- whitelist `dateKind` to `suggest|confirm|needs-by`
- validate `itemId`:
  - `finish_start` — rough complete + finish empty/`waiting_date`
  - `matterport` — status set, not complete, no links
  - other — must match a return-trip id on the mirror
- dedupe: if an open (`status:"new"`) same `(portalId, jobId, itemId, type:date)` exists, return that `requestId` with `deduped:true` instead of adding another

**Deploy note:** functions change needs `firebase deploy --only functions:gcPortalSubmit` (or full functions) after client ships — Claude decide order.

### 7. Low — Matterport counts in “Need your input”
**File:** `src/App.js` → `tagsOf`  
**Fix:** Matterport actionable tags use `k:"act"` (was `k:"date"`).

### 8. Low — Logo broken-Set resets
**File:** `src/App.js` → `GCPortalPage`  
**Fix:** `useEffect` clears `gcLogoBroken` when `token` or `link.logoUrl` changes so a repaired URL isn’t stuck skipped for the session.

### Tests
**File:** `scripts/gcportal-test.js`  
Added assertions that `statusDate` projects when set / empty when unset.

---

## Intentionally left for Claude

1. **SW bump** — still `homestead-v343`. Bump to v344 + FEATURES.md only if Claude wants this ship as a release.
2. **Forecast OVERDUE pill overlap** (HANDOFF.md) — not in this PR; separate UI bug.
3. **React #310 BidItemsPanel** — HANDOFF says fixed locally, not pushed; out of scope here.
4. **GCSendBox session “already sent”** — server dedupe covers the queue; client session lock not added (Claude may want it anyway).
5. **Split confirm vs counter-propose UI** — auditor suggestion only; not implemented.
6. **UI-state matrix tests** for `_gcStatusPills` / `_gcMpNeedsDate` — only projection unit tests added.
7. **Rough pill expansion** — Grok made rough pills as rich as finish; Claude may prefer keeping rough to complete/inprogress only for card density.

---

## Suggested Claude review checklist

- [ ] Inbox: finish_start vs matterport vs RT visually distinct
- [ ] Portal card: Matterport `complete` with no links → no schedule CTA / no Need-your-input bump
- [ ] Portal card: Matterport `needs` / `scheduled` with no links → amber act tag + modal CTA
- [ ] `_gcStatusPills`: `waiting_date` without projectedStart → “Finish: Awaiting Start Date”; projectedStart alone without that status → not “Awaiting…”
- [ ] After functions deploy: empty date rejected; duplicate open date request returns `deduped`
- [ ] Decide SW v344 + FEATURES ship note
- [ ] Decide functions deploy timing vs Vercel client deploy

---

## How to ship (after Claude sign-off)

```bash
# 1. Claude tweaks on this branch, then:
git add -A && git commit -m "…" && git push

# 2. Merge PR → Vercel auto-deploys client

# 3. If functions changed in the merge:
firebase deploy --only functions:gcPortalSubmit
# (or broader functions deploy if preferred)

# 4. Optional: rebuild portals so statusDate appears on existing mirrors
```

---

## Parse / test commands Grok ran (or Claude should re-run)

```bash
node scripts/gcportal-test.js
node -e "require('@babel/parser').parse(require('fs').readFileSync('src/App.js','utf8'),{sourceType:'module',plugins:['jsx']})"
```

---

## Source audits

- Automation: [Claude audit](https://cursor.com/automations/39b355af-81fc-11f1-a7d1-d6b4613131ce)
- Latest audit agent: https://cursor.com/agents/bc-7d8f5fc0-70ae-4c52-a984-b2bb21657300 (v343 / `17779df`)
