# Homestead Electric — Handoff for New Chat

## Project basics
- **App.js to edit:** `/sessions/<session>/mnt/Desktop--homestead-electric/src/App.js` (syncs to Mac)
- **Do NOT edit** `mnt/homestead-electric/src/App.js` — writes there don't reach the Mac
- **Deploy:** from Mac Terminal:
  ```
  cd ~/Desktop/homestead-electric
  git add src/App.js && git commit -m "..." && git push
  ```
- Vercel auto-deploys on push.
- **Parse check:** `node -e "require('@babel/parser').parse(require('fs').readFileSync('src/App.js','utf8'),{sourceType:'module',plugins:['jsx']})"`

## Data-safety rule
Every change needs a specific "why it won't lose data" note. For pure CSS/JSX edits, say "no data writes touched."

## Firestore rules rule
Always deploy COMPLETE rules (all collections + catch-all). Partial rule deploys silently broke prod in the past.

---

## 1. React #310 fix — done locally, NOT YET PUSHED

**Status:** fixed in local App.js, needs git push to deploy.

**Root cause:** `BidItemsPanel` (starts line 4089) had `useRef` + `useEffect` *after* three early returns. First render (data loading) ran 5 hooks; second render (data ready) ran 7 hooks → React threw minified error #310 at `Fx (App.js:4244:20)`.

**Fix applied:** Moved `useRef` (`prevQRef`, `searchCtxRef`) and the `useEffect` to the top of the component, above all early returns. The effect reads `q`/`tokens`/`visible`/`fetchQtyForCc` from `searchCtxRef.current`, which the render body populates each render (line ~4252).

**To ship it:**
```
cd ~/Desktop/homestead-electric
git add src/App.js
git commit -m "Fix React #310 in BidItemsPanel: hoist hooks above early returns"
git push
```

**Data safety:** pure hook-order refactor inside one component. No Firestore writes, no prop shape changes, no data paths touched.

---

## 2. Forecast view overlap — UNRESOLVED (user's current pain point)

**User's words:** "this is looking bad and overlapping"

**Where:** Job Board → **Forecast** button (kanban viewMode). The Overdue column shows cards where "OVERDUE" letter-breaks into "OVER" / "DUE" and overlaps the ROUGH phase pill and the job title.

**Why it's breaking:**
- Pill row at line 13656 is `display:flex` with `gap:6`, **no `flexWrap`**
- All sibling pills (ROUGH, foreman, Simpro, Not scheduled) have `flexShrink:0` and are set as proper pills with bg/border
- The OVERDUE span at line 13667 is different:
  ```js
  {over&&<span style={{fontSize:9,fontWeight:800,color:C.red,
    letterSpacing:"0.07em",marginLeft:"auto"}}>OVERDUE</span>}
  ```
  — no `flexShrink:0`, no `whiteSpace:"nowrap"`, no bg/border (not styled like the others)
- Columns are narrow: `gridTemplateColumns:"repeat(5,minmax(230px,1fr))"`
- When cards get squeezed, OVERDUE's span shrinks, its text wraps, and it visually overlaps the other pills on row 1

**Suggested fix (verify first by reading lines 13642–13685):**
1. Make OVERDUE a real pill matching the others: add `flexShrink:0`, `whiteSpace:"nowrap"`, a red bg/border like other pills use, and a small `Icon name="alertTriangle"` for prominence
2. Add `flexWrap:"wrap"` + `rowGap:4` to the flex row at line 13656 so if everything can't fit, pills flow to a clean second line instead of colliding
3. Consider moving OVERDUE to the front of the row (drop the `marginLeft:"auto"`) so it's guaranteed visible without relying on squeeze behavior

**Data safety:** pure JSX/CSS edit, no data writes.

**Verify:** open the Forecast → kanban view, confirm narrow-width cards in Overdue column render cleanly with no overlap.

---

## Context files to read in new chat
- `.auto-memory/MEMORY.md` — index of all memories
- `.auto-memory/feedback_appjs_delivery.md` — edit path rule
- `.auto-memory/feedback_data_safety_explanation.md` — always explain data safety
- `.auto-memory/feedback_firestore_rules.md` — complete rules only
- `.auto-memory/project_qc_redesign.md` — QC walk spec (items feed roughPunch/finishPunch with fromQC:true)

## Known app structure (shortcuts for new chat)
- `BidItemsPanel` — line 4089
- `JobDetail` — line 8601 (has QC/RT bidirectional sync wrappers at 8618–8766)
- `EventCard` (Forecast kanban cards) — line 13642
- `BUCKETS` (Forecast kanban columns) — line 13603
- `Scoreboard` — line 14202 (simple updatesPosted, no miss tracking)
- `JobRow` QC FAIL red priority + pill — line ~17821
- Simpro cost centers hook in JobDetail — line ~8799

## First thing to do in new chat
Read `src/HANDOFF.md` (this file). Then tackle the Forecast overlap — it's the current visible bug.
