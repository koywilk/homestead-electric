# Crew Board v2 — tap-to-edit, foreman columns, no coordinators

**Status:** Design, awaiting Koy's approval
**Date:** 2026-09-21
**Owner:** Koy
**Mockup:** `crewboard-mockup.html` (repo root, open in a browser; clickable)
**Replaces:** the v1 board in `CrewBoard` (App.js ~L51835), spec `08-Specs/CREW_BOARD_SPEC.md` in the vault
**Related:** Job Board "crews, not books" (v399), Head of Residential hat (v398), Deactivate (v366)

## Problem (Koy, 2026-09-21)

> "in crew board of settings the drag to move feature sucks and coordinators should be
> removed and replaced with foreman. make it easy to make someone foreman or lead etc
> from crew board and swap anyone around with ease"

Three things are wrong with v1:

1. **Drag is the primary interaction.** HTML5 drag does not fire on touch, so phones get a
   separate "pick up, then tap a destination" mode. Drop targets only accept the "right"
   kind of card, so drops silently do nothing when you aim at the wrong box.
2. **The board is grouped by coordinator.** Coordinators and books were retired in v398/v399.
   The grouping is dead structure that makes the board taller and hides the thing Koy
   actually manages: which foreman each person is under.
3. **Titles can't be changed on the board.** Promoting a lead to foreman, or demoting a
   foreman, still means opening Team Members and editing the record.

## Design

### Layout

- **Crews**: one column per active foreman, sorted A–Z. Column header = foreman's name,
  colour bar (`getPersonColor`), crew count. Crew cards inside, leads first then A–Z,
  each with a LEAD / CREW pill.
- **Unassigned**: a flat pool of active leads/crew with no foreman, or whose foreman is
  deactivated or no longer a foreman (the v366 rule, kept).
- Admins/office stay off the board (as today). Deactivated people stay off the board.
- No coordinator groups, no "No coordinator" band. Section stays collapsed by default
  in Settings with the counts on the header (Koy's everything-starts-collapsed rule).

### One interaction: tap a person, get a sheet

Tapping any card (crew card or foreman column header) opens a **person sheet**: a bottom
sheet on phones, a centred dialog on desktop, same content. No drag anywhere. No
pick-up mode.

The sheet has:

- **Header**: name, current role, current crew.
- **ROLE** chips: Foreman · Lead · Crew. Current one highlighted. One tap changes it.
- **CREW** chips (hidden for foremen): one chip per foreman, plus Unassigned. Current one
  highlighted. One tap moves them.
- **Done** closes it. Tapping outside closes it. Every chip applies immediately to the
  staged list, so the sheet header and the board behind it update live.

"Swap two people" is two taps in two sheets. No separate swap mode.

### Role change rules

| Change | Effect on the staged list |
|---|---|
| Anyone → Foreman | `title:"foreman"`, `foremanId:""`. A new empty column appears immediately. |
| Lead ↔ Crew | `title` only. Crew placement unchanged. |
| Foreman with **no** crew → Lead/Crew | `title` set, `foremanId:""`. They land in Unassigned. |
| Foreman **with** crew → Lead/Crew | The sheet asks **"X has N crew. Hand them (and X) to…"** with a chip per other foreman plus Unassigned. Choosing sets every crew member's `foremanId` AND the demoted foreman's own `foremanId` to that target, then applies the title. Cancel reverts to no change. |

The hand-off step exists so a foreman swap is one flow: demote A into B's crew, then tap
B (or whoever) and make them foreman. Nothing is ever left pointing at a person who is
no longer a foreman.

### Staged save (unchanged from v1, safety-critical)

- Board reads from the `users` prop; every tap mutates local component state only.
- Footer shows a **pending-changes list** in plain words ("Braden: → Gage's crew",
  "Owen: lead → foreman") so Koy can read what Save will write.
- **Save changes** calls the existing guarded `saveUsers` (v218 stale-write guard, audit
  stamp, "Team saved" toast). **Discard** reverts to the prop. Unsaved changes stay
  local; the prop → state sync stays suppressed while dirty (v1 behaviour).
- Only `title` and `foremanId` are ever written by the board. Every other field on every
  user is spread through untouched.

### Coordinator field

- The board **stops reading and stops writing** `coordinator`. It does not clear it.
- Scoreboard's Coordinators board, Huddle book chips, and the functions' `coordUserOf`
  routing still read `coordinator`; they are out of scope and keep working on the
  values already stored. Team Members' COORDINATOR select on foreman records is also
  left alone this ship. Retiring those is a separate, later cleanup.

### Gating

`can(identity, "users.manage")`, same as today. The Settings mount point, section title,
and `saveUsers` wiring do not change.

## Non-goals

- Editing names, PINs, access, hats, active flag: stays in Team Members.
- Adding or removing people: stays in Team Members.
- Reordering within a crew: cosmetic, skip.
- Touching `jobs` documents. A job's `foreman` string is not rewritten when a foreman is
  demoted; the Job Board's foreman picker already handles reassigning jobs.

## Edge cases

- Foreman with no crew: column shows "no crew yet", still tappable.
- Person whose `foremanId` points at a deactivated or demoted foreman: shows in
  Unassigned (v366 rule); the CREW row shows Unassigned highlighted.
- Demoting the last foreman with crew: the hand-off chips show only Unassigned.
- Concurrent edit on another device: the `saveUsers` guard refuses the stale write and
  pulls fresh; board re-renders on the latest and Koy re-does the moves (rare, safe).
- Deep sheets on phones: the sheet scrolls if the foreman chip row is long; the board
  behind it does not scroll.

## Testing

- Manual smoke on desktop and phone (Koy): each row of the role-change table, one
  move, one demote-with-crew hand-off, Save, re-open Settings, confirm.
- Read-back check after Save: no user lost a field other than the two the board owns
  (compare `settings/users` before/after in the console once, as with v1).
- `CI=true npm run build` before hand-off (standing rule).

## Ship hygiene

- SW bump to v419. FEATURES.md entry with the why-it-won't-lose-data line.
- No SOP guide exists for Settings/Crew Board; none to update. If Koy wants one, it is a
  new recording, not a fix.
- Vault: update `08-Specs/CREW_BOARD_SPEC.md` status to "superseded by v2 (2026-09-21)"
  and write the daily log after the ship.

## Acceptance

- [ ] Settings → Crew Board shows foreman columns + Unassigned, no coordinator groups.
- [ ] Tapping any person opens the sheet on both desktop and phone; no drag handlers remain.
- [ ] Role chips change `title`; making someone foreman creates their column at once.
- [ ] Demoting a foreman with crew requires a hand-off target; crew and the foreman move together.
- [ ] Footer lists pending changes in words; Save persists via `saveUsers`; Discard reverts.
- [ ] Re-read of `settings/users` after Save shows only `title`/`foremanId` changed on touched users.
- [ ] `coordinator` values are byte-identical before and after any board save.

## Addendum (same ship): Jr. Foreman title

Koy: "add Jr. foreman as a role." New title `jrforeman` ("Jr. Foreman"), a fourth ROLE chip
(order on the board: Jr. Foreman, Lead, Crew). Semantics: a crew-side title one rung above
Lead. Still sits under a foreman (keeps `foremanId`); counts as a lead everywhere a lead
does via `isLeadTitle()` (lead pickers, return-trip crew options, notification defaults,
Scoreboard Leads board, My Day landing, login card); not a job foreman (no foreman pickers,
no own column). Server: the two daily lead reminders include the title; needs a functions
deploy. If a Jr. Foreman should run their own jobs instead, that is a follow-up.
