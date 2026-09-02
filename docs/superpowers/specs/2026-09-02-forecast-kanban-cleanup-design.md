# Forecast → Kanban cleanup — design spec

- **Date:** 2026-09-02
- **Status:** approved for build (Koy signed off on the mockup 2026-09-02)
- **Surface:** `SchedulingForecast` (src/App.js:34039), Kanban view mode
- **Mockup:** `scratchpad/forecast-kanban-cleanup.html` (published artifact)
- **SW version:** v392 (current is v391 — bump `public/service-worker.js` line 1)

## Problem

The Forecast → Kanban board clutters with overdue cards and there is no way to
clear a card from the board — you have to open the job (which lives "under" its
foreman) and resolve it there. Two root causes:

1. **Ready-to-Invoice is a scheduling card.** `buildEvents` (src/App.js:35171)
   synthesizes a `type:"invoice"` event (src/App.js:35255) whenever
   `job.readyToInvoice && !job.invoiceDismissed`. Its `startDate` is
   `readyToInvoiceDate`, which is **auto-stamped the moment rough or finish stage
   crosses 85%** (src/App.js:26657, 26959) — usually weeks before billing. Because
   that date is old, `getBucket` (src/App.js:35157) drops every one into
   **Overdue**, where they accrete forever. Ready-to-Invoice is a *billing*
   signal, not a *scheduling* task, so it does not belong in a date column.

2. **No inline clear.** An `EventCard` (src/App.js:35374) only does
   `onClick → onSelectJob(job)`. There is no dismiss/snooze affordance, so the
   only way to clear a card is to open the job and change its state.

Koy confirmed the Overdue column is "a real mix" — invoice cards **and**
genuinely-stale scheduling cards (QC, RT, rough/finish) both clog it — and that
clearing should be **type-aware**: invoice gets a plain dismiss; real scheduling
work snoozes or takes a date, so nothing schedulable ever silently disappears.

## Goals

1. **Ready-to-Invoice stops reading as a scheduling task** — demoted to a slim
   "notification" row grouped at the bottom of its date column, with one-tap
   Dismiss. It stays visible on the board but is visually and behaviorally not a task.
2. **Every scheduling card gains an inline Clear** — Snooze (3 days / 1 week /
   pick a date). Snooze hides the card and it **reappears if still unhandled**.
3. **Columns collapse** — tap a header to fold a heavy column (esp. Overdue) out
   of the way so the week you're planning reads first.

## Non-goals (YAGNI / deferred)

- **Inline "Set start date"** on a card (writing `roughProjectedStart` etc. and
  flipping status) — deferred to a follow-up. Keeps this ship's writes limited to
  two fields. The mockup shows a greyed "Set start date…" affordance — **omit it
  from v1's menu** (Snooze presets + "pick a date" only). Snooze "pick a date"
  covers the custom-hide need.
- **Relocating invoice to a top strip or off the Forecast entirely** — Koy chose
  "bottom of the column," minimal disruption.
- **Bulk clear / drag-and-drop.**
- No change to bucketing, overdue math, or the other five view modes' layout
  (they inherit the snooze filter for free — see below).

## Approach

Three surgical changes, no restructure of the five date columns.

### Data model

| Concern | Field | Location | New? |
|---|---|---|---|
| Invoice dismissed off board | `invoiceDismissed: true` | job `data` envelope | **existing** (already respected at 35255) |
| Scheduling card snoozed | `forecastSnooze: { [eventKey]: "YYYY-MM-DD" }` | job `data` envelope | **new (additive)** |
| Column collapsed | `he_forecast_collapsed` (array of bucket keys) | `localStorage` | **new, client-only** |

- **`forecastSnooze`** is a per-job map keyed by the event's id **suffix** (the
  part after `job.id + "_"`): `rough`, `finish`, `qc`, `rt_<rtId>`, `co_<coId>`,
  `quick`. A value is an ISO date; the card is hidden while that date is in the
  future, and re-appears once it passes. Snooze applies to scheduling types only,
  never to `invoice`.
- **Data-shape note:** `forecastSnooze` lives *inside* the job `data` object, so
  the loader (src/App.js:44066) auto-unwraps it to top-level `job.forecastSnooze`
  — **no loader spread change needed** (this is job content, not a top-level meta
  field like `lastActivityAt`; see [[Data-Shape Gotchas]]).

### `buildEvents` changes (src/App.js:35171–35313)

1. **Snooze filter.** Add a helper and apply it so snoozed events vanish from
   **every** forecast view uniformly (Kanban, Week, Attention, Calendar, Crew) and
   from the foreman-tab counts:

   ```js
   const eventSuffix = (ev) => ev.id.slice(ev.job.id.length + 1);
   const isSnoozed = (ev) => {
     if (ev.type === "invoice") return false;           // invoice never snoozes
     const sd = ev.job.forecastSnooze?.[eventSuffix(ev)];
     if (!sd) return false;
     const d = parseAnyDate(sd); if (!d) return false;
     const c = new Date(d); c.setHours(0,0,0,0);
     return c > today;                                   // hidden until the date passes
   };
   ```
   Filter the returned `events` array by `!isSnoozed(ev)` (single point, so all
   consumers — including the `buildEvents(...)` calls that compute tab counts at
   src/App.js:35608 — stay consistent).

2. **Unify invoice-dismissed.** Gate the rough/finish `isInv` branches
   (src/App.js:35209, 35237) on `!job.invoiceDismissed`, matching the job-level
   invoice event's existing guard. Result: **one `invoiceDismissed` flag hides all
   invoice-flavored cards for that job** (the job-level `_invoice` event and any
   phase whose status is `"invoice"`), so a single Dismiss clears them together.

### Write path

`SchedulingForecast` receives `onUpdateJob = updateJob` (src/App.js:55880), whose
contract is `(fullUpdatedJob, patchDelta)` (src/App.js:53380 → `saveJob`). New
helpers inside the component:

```js
const patchJob = (job, patch) => onUpdateJob({ ...job, ...patch }, patch);

const dismissInvoice = (ev) => {
  const prev = !!ev.job.invoiceDismissed;
  patchJob(ev.job, { invoiceDismissed: true });
  toast("Dismissed — off the board", () => patchJob(ev.job, { invoiceDismissed: prev })); // Undo
};

const snoozeEvent = (ev, isoDate) => {
  const key  = eventSuffix(ev);
  const prev = ev.job.forecastSnooze || {};
  patchJob(ev.job, { forecastSnooze: { ...prev, [key]: isoDate } });
  toast(`Snoozed until ${fmtDate(isoDate)}`, () => {                                       // Undo
    const nx = { ...prev }; delete nx[key];
    patchJob(ev.job, { forecastSnooze: nx });
  });
};
```

- Snooze presets compute from `today`: 3 days, 1 week, or a picked date (a
  `<input type="date">` in the menu).
- **Undo** on every action (toast affordance) so a mis-tap is one click to reverse.

### UI (Kanban render, src/App.js:35626 + `EventCard` 35374)

- **Invoice notification.** Render invoice-flavored events (`ev.type==="invoice"`)
  as a slim amber notification row — distinct from the task-card treatment: no
  OVERDUE pill, thinner left border, a `$`/receipt glyph, `READY TO INVOICE · <fm>`
  micro-label, job name, and a one-tap **×** Dismiss. Within each bucket, group
  these **below** the scheduling cards under a `Ready to invoice (N)` divider so
  real work reads first. (Sort: scheduling cards first, invoice notifications last.)
- **Scheduling card Clear.** Add a `⋯` button (top-right) to scheduling
  `EventCard`s. It opens a small popover: *Snooze 3 days / Snooze 1 week / Pick a
  date…*. Gated on `canEdit`.
- **Collapsible columns.** Column header becomes a button (chevron + label +
  count). Clicking toggles the bucket key in the `he_forecast_collapsed`
  localStorage set; a collapsed column hides its body and keeps the count.
- **Mobile/desktop parity ([[Mobile-Desktop Parity]]):** the `⋯` must not be
  hover-only. Render it always-visible on touch / narrow viewports (e.g. via a
  coarse-pointer media query or always-on below a width breakpoint). The snooze
  popover is tap-driven. Verified on both.

### Permissions

All clear/dismiss/snooze affordances are gated on the existing
`canEdit = can(identity,"schedule.edit")` prop (src/App.js:55878). Read-only
(`schedule.view`-only) users see the board exactly as today — no affordances, no
writes. No new `PERMISSIONS` entry; no `firestore.rules` change (these office
roles already write `jobs` docs elsewhere; `invoiceDismissed`/`forecastSnooze` are
ordinary fields inside the same doc).

## Data safety (non-negotiable)

- **Additive only.** One new field (`forecastSnooze`) inside the `data` envelope;
  one reused existing flag (`invoiceDismissed`). No field removed or repurposed,
  no loader spread change, no `firestore.rules` change.
- **Nothing schedulable is ever deleted or permanently hidden.** A snooze is a
  future date; the card **returns on its own** once the date passes. Worst case is
  a card reappears — never that real work silently vanishes.
- **Invoice Dismiss is reversible** and non-committal: it sets `invoiceDismissed`
  only (does *not* assert `invoiceSent`), so the Ready-to-Invoice signal stays
  live on the job card / Tasks / Today. Undo restores it in one tap.
- **Writes ride the existing funnel** (`updateJob → saveJob`, patch mode) that
  every other job mutation uses — no new write path, no new bypass.
- Pairs with [[perplexity-verify-loop]] (case two: this ship changes stored job
  data — new field + writes from a previously read-only surface) **and**
  [[homestead-deploy-hygiene]]. Run both before the one-paste.

## Verification plan

- **Unit (node harness).** Slice `buildEvents` + `isSnoozed` verbatim out of
  App.js into a plain node module (the proven pattern from
  [[Scheduling Forecast]] v359) and assert: snoozed events drop out; a snooze with
  a past date shows again; `invoiceDismissed` hides both the job-level invoice
  event and a phase-status-`invoice` card; a job with no `forecastSnooze` is
  byte-identical to today's output (no movement until a dial is turned).
- **Build gate.** `CI=true npm run build` must pass (never pipe it — the prebuild
  gate failure is masked by `| tail`; see [[verify-build-before-handoff]]).
- **Live smoke.** Build, serve locally, log in as Koy: snooze a real overdue card
  → it leaves all views → Undo restores it; Dismiss an invoice card → leaves the
  board but the job card still shows READY TO INVOICE; collapse Overdue → persists
  across reload. Check on a narrow viewport for the `⋯` visibility.

## Deploy checklist

- [ ] Bump `public/service-worker.js` line 1 (`homestead-v<N>`).
- [ ] Add the `FEATURES.md` entry for the new SW version (prebuild gate blocks the
      build otherwise).
- [ ] Update the Forecast SOP guide (`public/sops/forecast.html`) to document
      Clear/Snooze + collapse (standing rule: guides track the app).
- [ ] Perplexity verify-loop brief (stored-data change) + deploy-hygiene pass.
- [ ] One-paste for Koy: `git add src/App.js public/service-worker.js FEATURES.md public/sops/forecast.html docs/... && git commit -m "..." && git push` with a specific "why it won't lose data" line.
- [ ] Vault log after ship (`~/Desktop/Command Center/Logs/2026-09-02 - Homestead Electric.md`) + update [[Scheduling Forecast]].

## Files touched

- `src/App.js` — `buildEvents` (snooze filter + invoiceDismissed gate), `EventCard`
  + Kanban render (notification style, subhead grouping, `⋯`/snooze menu,
  collapsible headers), new component helpers.
- `public/service-worker.js` — cache bump.
- `FEATURES.md` — SW version entry.
- `public/sops/forecast.html` — SOP update.

## Open follow-ups

- Inline "Set start date" on a card (deferred non-goal above).
- Optional: auto-clear a stale `forecastSnooze` key when its date passes (a
  read-side no-op today; only worth a write if the maps grow large).
