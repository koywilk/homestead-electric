# Goals tab on the office dashboard — design

**Date:** 2026-10-23 · **Asked by:** Koy · **Status:** approved in chat (mockup + Simpro rule), building as SW v562

## Intent

Koy and Josh keep the company's goals in one Google Sheet, *Homestead Electric – Team Goals
2026–2027* (Koy's copy, id `1p4ZPUck4VM4GxffWx_zkHZCis0ZR3PWqHtDHRrYY-l4`, one tab "Goals").
Koy wants that sheet on his dashboard with the live "where we are" next to each goal, so the
goals get looked at every day instead of once a quarter. Koy, 2026-10-23: *"Simpro numbers are
the source of truth in this case, so we need to make those match before we do anything."*

## What it is

An eighth tab, **Goals**, on `/dashboard` (`OfficeDash`, admins only like the rest of the page).

1. **The mission line** from the sheet, verbatim.
2. **2027 scoreboard**: one card per MEASURE row. Each shows *Sheet says* (the sheet's "where we
   are today" cell), *Simpro today* or *App today* when the app can measure it, the 2027 goal, a
   status pill, and the rule in a fold. Measures the app cannot measure show "Not tracked yet"
   or "Hand count" and the sheet's text only.
3. **Rest of 2026**: the AREA / GOAL / WHO / BY rows. Status comes from a new column **F
   "STATUS"** that Koy or Josh type in the sheet (`Not started` / `On track` / `At risk` /
   `Done`); the app only adds a due flag from the BY cell (Due in N d, Overdue). Each row opens
   the sheet on that row.
4. **2027 by quarter**: the four Q rows, the next quarter marked.
5. **Measured by the app, not on the sheet yet**: a folded list of the measures the dashboard
   already tracks that no sheet row names (first-pass inspections, old change orders, quiet
   jobs, open questions, return trips, failed inspections not re-booked, plans waiting), each
   with today's number. Adding a row to the sheet whose MEASURE cell names it lights it up; the
   app never writes to the sheet.
6. Header actions: **Open sheet**, **Refresh** (re-reads the sheet), **Pull from Simpro now**
   (admins; runs the nightly pull on demand, same pattern as the Scoreboard).

## The Simpro rule (Josh's Builder Scorecard rule, adopted by Koy 2026-10-23)

Every customer invoice **dated this calendar year** → its jobs → each job's Simpro Totals.
A job **counts** when it is 100% invoiced (`InvoicePercentage ≥ 99.95`) and has costs posted
(`NettMargin.Actual ≠ 100` and any of materials, labor or hours > 0).

- **Job margin** = Σ `NettProfitLoss.Actual` ÷ Σ `Total.ExTax` over counted jobs (weighted,
  Simpro cost rates). Second line: jobs at 15% or better, of counted.
- **Hours vs estimate, company** = Σ `LaborHours.Actual` ÷ Σ `LaborHours.Estimate`, same jobs.
- **Hours vs estimate, every foreman** = the same ratio per **Simpro technician** on the job
  (`Technicians[].Name`, first one), counted jobs only, people with 3+ jobs; former crew and
  UNASSIGNED are listed last / left off the headline.
- **Commercial share** = invoice dollars (`Total.ExTax`, credits excluded) on jobs whose Simpro
  *Business Group* is Commercial ÷ all 2026 invoice dollars; second line = commercial share of
  in-progress contract value from the Scoreboard cache (`settings/scoreboardCompleted.prog`).
- **Days to collect** = mean and median of `DatePaid − DateIssued` over invoices paid this
  year; beside it the open book: invoices not paid and not credits, Σ (`Total.IncTax − Total.Paid`),
  past due (DueDate before today), over 60 days since issue.
- A job with no Business Group is residential (same default as the Scoreboard page).

Reproduced read-only on 2026-10-23: 153 counted jobs, 11.2% / 136%; sheet said 11.7 / 140 on
Oct 20, Josh's scorecard 13.9 / 132 on 143 jobs Oct 15. Same rule, moving set.

This rule is deliberately **not** the Scoreboard tab's (per-job average, completed this year,
credit by app foreman/lead). The two pages differ on purpose; the Goals tab says so in its rule
fold.

## Data flow

- **Sheet:** read on tab open and on Refresh, as CSV without sign-in
  (`https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=Goals`), exactly
  like the Appliance Loads read (`fetchApplSheetRows`). Sections are found by their header
  cells ("REST OF 2026", "2027 SCOREBOARD", "2027 BY QUARTER"); emojis are stripped from
  measure names (house rule: none in the UI).
- **Simpro:** new scheduled function `goalsNightly` (5:40 AM Mountain, after `scoreboardNightly`)
  and callable `sendTestGoalsPull` (app key, same as the Scoreboard's). Read-only against
  Simpro: `/customerInvoices/?DateIssued=between(<year>-01-01,<year>-12-31)` paged by 250 with
  columns `ID,DateIssued,IsPaid,DatePaid,DueDate,Total,Jobs,Customer,IsCredit`, then
  `/jobs/{id}` for each distinct job (concurrency 6, `simproReqWithRetry`). Writes ONE doc
  `settings/goalsSimpro`: `{ generated_at, year, reason, jobs:[slim], invoices:{…}, counts,
  seconds }`. Refuses to overwrite when fewer than 90% of listed jobs came back or the doc
  would exceed ~900 KB (the Scoreboard's two guards). The pure parts (slim job, invoice stats,
  which jobs count) live in `functions/goalsPull.js` and are tested without Simpro.
- **Dashboard:** `OfficeDash` reads `settings/goalsSimpro` once when the Goals tab opens
  (getDoc, like `simproTotals`) and the sheet CSV; a pure `odGoalsModel` turns the parsed sheet,
  the Simpro doc, the Scoreboard cache and the existing `odModel` output into what the tab
  renders. It is tested by `scripts/goals-model-test.js` through the same sandbox as
  `odash-model-test.js`.

## Non-goals (Phase 2, later)

Warranty hours, change-order hours in their own cost center, Home Depot / ACE runs, jobs with
hours tracked weekly: each needs per-job cost-center or vendor-order reads. The cards exist
and say "Not tracked yet" with the plan. The app never writes to the sheet; proposed goals go
in only when Koy adds the rows.

## Constraints

- No emojis; no yellow lead colour; steel blue `OD_A` accent, light page, existing `odash`
  tokens; everything folded by default except the mission and the scoreboard cards.
- Dollars may show here (office page), never on crew screens.
- Nothing in Simpro is written. Firestore: one new `settings/` doc, covered by the existing
  `settings/{docId}` read rule; no rules change; no job write; no loader change.
- Guide `public/sops/dashboard.html` gets a Goals section in the same ship. FEATURES.md entry
  tagged `SW v562`. Crew brief `docs/crew-briefs/v562.md`.
