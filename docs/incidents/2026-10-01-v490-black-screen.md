---
type: incident
date: 2026-10-01
app: Homestead Electric
versions: v490 (broken) → v491 (partial) → v492 (fixed)
severity: app-wide black screen, every user, ~25 minutes
---

# v490 black screen — My Day read-before-declare

**What the crew saw.** App opened to a black screen for everyone. My Day is the landing page, so nothing else was reachable.

**Root cause.** v490 moved the "New since last look" flag pass up the `MyDay` component so the New group could be built from it, but left the three things it reads below it: `qThreads` (the question-discussion listener state, v487 work) and `prevSeenRef` / `mineKeysRef` (the seen-store refs). In a function body `const` is in the temporal dead zone until its line runs, so React threw `ReferenceError: Cannot access 'X' before initialization` during render. CRA compiled fine — it is a runtime order error, not a syntax error.

Koy's console: `ReferenceError: Cannot access 'Zt' before initialization at nN (App.js:57221:18)` — the `prevSeenRef` read.

**Why it got through.** Claude's checks were `npm run build` (compiles), the prebuild test scripts (pure helpers only), and an SSR render of the Lutron builder. Nothing rendered `MyDay` with a logged-in identity. The container cannot sign in to the live app, so the component was never executed before shipping.

**Fixes.**
- v491: moved the `qThreads` listener block above the question-row builder. Fixed only the question-holder case, so Koy still saw black.
- v492: moved the seen-store refs above the flag pass. Fixed for everyone.

**Data impact.** None. Both crashes happened while drawing the screen, before any save could run; v490 added no new Firestore writes (only a read-only listener).

**Guard added (branch, v493).** `scripts/tdz-scan.js` runs in `prebuild`, before every build: it parses `src/App.js` with Babel and fails the build if any function reads a `const`/`let` before its declaration in code that runs synchronously (plain body, `forEach`/`map`/… callbacks, IIFEs, `useMemo`/`useState` initializers). Handlers, effects, shadowed inner names and loop-carried `let`s are ignored. Proven against history: v488 clean, v490 flags all three bugs, v491 flags the two remaining, v492 clean. `--selftest` guards the guard.

**Standing rule going forward (Koy: "gotta be more careful than that").** For any change inside a React component that moves or adds render-time code, run `node scripts/tdz-scan.js` and, where the component can be rendered without auth, an SSR smoke render — before the one-paste, not after. Hotfixes go out one at a time only after the scan is clean; the v491 half-fix cost a second cycle.

**Copy to vault:** `~/Desktop/Command Center/04-Incidents/2026-10-01 - v490 black screen (My Day TDZ).md`.
