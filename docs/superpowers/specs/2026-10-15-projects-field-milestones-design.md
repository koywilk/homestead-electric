---
title: Projects and Field Milestones Spec
type: spec
status: awaiting-approval
area: [homestead, job-board, drive, milestones]
created: 2026-10-15
updated: 2026-10-15
tags: [type/spec, area/homestead, mockup-first, projects, milestones]
---

# Projects and Field Milestones Spec

**Source:** Granola meeting notes Koy pasted 2026-10-14 (Job Structure, Google Drive, Milestones, Next Steps), brainstormed with Claude 2026-10-14/15.
**Mockup (clickable, app tokens, v537 sizes):** `projects-milestones-mockup.html` at the repo root (served locally by the `projects-mockup` entry in `.claude/launch.json`, port 4211). It was UX-critiqued and revised 2026-10-15.
**Status:** **awaiting Koy's approval.** No app code written. Koy: *"be sure to not deploy anything until i approve of it all."*
**Goal after approval:** build it, then send Koy's bosses a **real Vercel preview link on live data** (Koy, 2026-10-15).

---

## 1. Why

The meeting raised four app problems:

1. **Multi-building jobs are merged.** Fratto Farms (several houses) lives as one job. Every house's punch, questions, photos and plans are mixed together. The group wants each building separate (Steven had wanted them merged; the group overruled).
2. **Plans can't go to one building.** Drive folders are one per Simpro job number, and the Simpro → Drive pull dumps every attachment into that one folder.
3. **No place to log field milestones** like "Blockouts in" or "UFR in". Commercial jobs only have 9 fixed date boxes.
4. **Plans & Links opens fully expanded.** The meeting asked for it to start collapsed.

**Success looks like:** a foreman opens "Fratto Farms · House 3" and sees only House 3's plans, plus the project-wide sheets. The office adds House 6 in under a minute. Anyone logs "UFR in" in two taps. The crew's current app keeps working untouched the whole time.

## 2. Scope

| In v1 | Out of v1 (and why) |
|---|---|
| Projects: a project groups normal jobs (buildings) | **Project notes cleanup** — Koy parked it 2026-10-14 ("hold off on this for now") |
| Add Building, Simpro folder picker, project-wide plans | **GC Portal grouping** — the GC sees each building as its own portal entry until a follow-up spec (Koy, 2026-10-14) |
| Plan routing by Simpro attachment folder (Phase 2, see §8) | **Formal milestones** (dates, due, notifications) — the meeting said build them up over time |
| Add-only Field Milestones on every job | A third "Projects" mode on the Resi/Commercial switch — Koy chose grouped rows instead |
| Plans & Links starts folded with counts | Auto-splitting old merged data between buildings |
| Commercial: 9 GC dates move to their own section | |
| A live-data Vercel preview for the bosses | |

## 3. Decisions (all Koy's, 2026-10-14/15)

| # | Decision |
|---|---|
| D1 | **A building is a normal job.** A project is a small new record that groups them (Option A). Not sub-objects inside one job (B), not a naming convention (C). |
| D2 | Simpro setup **varies by job**. A building either has its own Simpro # or shares the project's. |
| D3 | **Everything is per building:** plans + Drive, milestones + progress, punch / QC / questions, crew / schedule / materials / POs. |
| D4 | Projects show as **folded grouped rows inside the existing Resi / Commercial modes**. No third mode. |
| D5 | Shared Simpro #: the **office files each building's plans into a matching Simpro attachment folder**, and the app routes by that folder. Unfiled files go to the project's **Shared / Unsorted**. |
| D6 | Field milestones on **every job, both divisions**. |
| D7 | Milestones are **add-only and start empty**. Nothing pre-filled. Auto who/when stamp; no due dates. |
| D8 | Commercial's 9 fixed date boxes **move out** of Milestones into a folded **GC Schedule Dates** section. Their data is unchanged, so the Forecast and Ufer / underground reminders keep working. |
| D9 | **Remove with Undo.** A removed entry is hidden, never deleted. |
| D10 | Converting a merged job: **the old job becomes the "Site / Shared" building** with every old item untouched. New houses start clean. |
| D11 | **Project-wide plans show in every building** from one Project-wide Drive folder. |
| D12 | Preview uses a **test project on live data** ("ZZ Preview – Projects Test"). Fratto Farms stays untouched until the real ship. |
| D13 | **The database rule for projects ships before the preview; the server routing change waits** for Koy's full approval. |

## 4. Feature A — Plans & Links starts folded

- The four blocks (**Drive Plans, Uploaded Files, Links, Custom Sections**), plus **Project-wide plans** on project buildings, each become a folded header carrying a count:
  - "Drive Plans · 14 files · House 3 folder"
  - "Uploaded Files · 2 files"
  - "Links · 3 of 4 set"
  - "Custom Sections · 1 section"
- **Folded every time the tab opens.** No remembered open state (standing rule: everything starts collapsed).
- **Behavior is otherwise unchanged.** `DriveFilesSection` still lists the job's Drive folder live and recursively, from any source: Simpro pull, Plan Intake, hand-dropped in Drive. FieldInk keeps reading the same folder tree.
- Code: `PlansTab` (App.js ~27285), `DriveFilesSection` (~26597), `FileUploadSection` (~27098), wrapped in the existing `Section` component.

## 5. Feature B — Field Milestones

**Data.** `jobs/{id}.data.fieldMilestones = [{ id, text, by, at, removed?, removedBy?, removedAt? }]`
- It lives **inside `data`**, so the loader spreads it to `job.fieldMilestones` with no loader change (see [[Data-Shape Gotchas]]).
- **Add** appends one entry by `id` through the existing `u()` → `saveJob` funnel. It is reconciled against the funnel's locked `prev`, never a component copy (the stale-copy rule from v473), so two people adding at once both stick.
- **Remove** sets `removed: true` plus who/when. **Undo** clears it. Nothing is ever deleted.
- Every write carries the version-lock stamp via the funnel (`stampWrite`).

**UI.**
- **Residential:** a new **Milestones** section on Job Info. It starts folded, and the header shows "none yet", or "3 · latest: UFR in (10/14)".
- **Commercial:** the existing Milestones section (App.js ~33957) becomes the same add-only list. The 9 `COMM_MILESTONES` date boxes move to a new folded **GC Schedule Dates** section placed above it, badged "MOVED" for one release. `commercial.milestones` is untouched.
- **"+ Add" button on the folded header:** one tap opens the section and focuses the box. Enter submits.
- Each entry shows text, then "Name · M/D/YYYY", with a 40px **Remove** button that triggers an Undo toast.
- Internal only: no GC Portal, no pushes.

## 6. Feature C — Projects

### 6.1 Data model

**New collection `projects/{projectGroupId}`**, same shape as `needs` / `manualTasks` (`{ data, updated_at }`, written with the version-lock stamp):

```
data: {
  name, division ("" resi | "commercial"),
  gc, contacts, notes,
  driveFolderId,        // project parent folder
  wideFolderId,         // "Project-wide" subfolder
  unsortedFolderId,     // "Shared / Unsorted" subfolder
  simproNo?,            // only when buildings share one
  wideSimproFolder?,    // Simpro folder that feeds Project-wide (e.g. "Site Plans")
  leadJobId?,           // the Simpro lead building when the number is shared
  archived?
}
```

**On each building's job** (inside `data`, so the loader spreads it; no loader change):
- `projectGroupId`
- `simproFolder`: the Simpro attachment folder that feeds this building when the number is shared
- `projectRole: "site"` on the Site / Shared building only

**Naming:** the field is `projectGroupId`, not `projectId`. `projectId` already means three other things in this code: the Firebase project, a Simpro project, and the timesheet grouping.

**Building job names carry the project:** "Fratto Farms · House 3". The crew's current app knows nothing about projects and must still show sensible names until the real ship.

### 6.2 Screens (see mockup)

- **Job Board:**
  - A project is one folded row: name, a steel-blue PROJECT tag, and a roll-up line "2 in rough · 1 in finish · 1 behind". Site / Shared is not counted.
  - Unfolded, the first row is **Project page ›**, then the building rows. Each opens a normal job card.
  - Search on a building name or Simpro # opens the group and outlines the match.
  - Projects appear in whichever mode their buildings are in.
- **Project page:**
  - Building chips first: stage, flags, SIMPRO LEAD on the lead building, the Site / Shared explanation. Then **+ Add Building**.
  - A folded **Project info** section: GC, project notes, Drive folder, Project-wide plans, and Shared / Unsorted with its file count in orange.
- **Add Building:**
  - Name, then one of: **Shares the project's Simpro #**, picking from the Simpro attachment folders the job actually has (shows "used by House 2" and "project-wide plans", a green "Found in Simpro", or a warning if the folder doesn't exist yet). Or **Has its own Simpro #**.
  - Copies GC, contacts, address, foreman and division from the project.
  - Tab toggles = the existing Job Sections checklist (`hiddenSections`).
  - Creating it makes the job and its Drive folder inside the project folder.
- **Inside a building:**
  - Breadcrumb "FRATTO FARMS › HOUSE 3" plus labeled hop buttons "‹ House 2" and "House 4 ›".
  - Job Info gets a **Project** section: which project, the Simpro folder with ✓ / warning, Change folder, Change project, Leave project. Leaving never deletes anything.
  - Plans & Links gets the **Project-wide plans** block.
- **Making a project from an existing job:** "Part of a project" on Job Info. Start a new project (the job becomes Site / Shared) or attach to an existing one.

### 6.3 Simpro lead rule (shared Simpro #)

When buildings share one Simpro #, **exactly one building is the Simpro lead.** Anything that turns a Simpro # into "the job" resolves to the project, or to the lead building, never to more than one. Known lookup sites to sweep in the plan:

- `functions/fridayPacket.js` ~481 (`jobBySimproNo`)
- `functions/foremanMeetingPrep.js` ~234 (`bySimpro`)
- App.js ~38630 (`jobBySimproNo`, crew timesheet view)
- Scoreboard margins: one bid must count once
- CO auto-approval from Simpro, Bid Items, POs, `weeklyCommercialDocPull`, and any other `simproNo` → job join the sweep finds

POs stay on the building that ordered them in the app. In Simpro they post to the shared job number.

### 6.4 Drive layout and plan routing

```
Fratto Farms (project parent)        projects.driveFolderId
├── Project-wide                     wideFolderId   ← Simpro folder "Site Plans"
├── Shared / Unsorted                unsortedFolderId ← unmatched Simpro files
├── Site / Shared                    the OLD merged job folder, MOVED here (same ID)
├── House 1                          building job's driveFolderId ← Simpro folder "House 1"
└── House 2 …
```

- **The old merged folder is moved into the new parent, not used as the parent.** If it were the parent, Site / Shared's recursive listing would show every house's plans. A moved Drive folder keeps its ID, so links and FieldInk keep working.
- **What the app shows:** each building lists its own folder live and recursively from any source, plus a folded **Project-wide plans** block that lists `wideFolderId`.
- **Simpro → Drive pull** (`pullJobDocsToDrive` / `_pullJobDocs`, `docPull.js`): for a building with a shared Simpro #, `planDocPull` copies only rows whose Simpro `folder` matches the building's `simproFolder`. The project-level pull sends the `wideSimproFolder` rows to Project-wide and everything else unmatched to Shared / Unsorted. A building with its own Simpro # pulls exactly as today.
- **Folder creation** (`createJobDriveFolder` and the catch-up sweep near functions/index.js ~5376): a building job is created **inside** its project folder. The sweep must never make a top-level folder for a building.
- **Plan Intake:** plan emails matched to a shared Simpro # file into the project's Shared / Unsorted folder (or the building's, if it can tell). They never land in a random building.
- `weeklyCommercialDocPull` honors the same filter.

### 6.5 Converting a merged job (D10)

"Make this a project" on an existing job:
1. Creates the `projects` record from the job's name, GC, contacts and division.
2. Creates the project parent, Project-wide and Shared / Unsorted folders.
3. **Moves** the job's existing Drive folder inside the parent.
4. Stamps the job `projectGroupId` + `projectRole: "site"` and renames it "<Project> · Site / Shared".

Nothing inside the job (punch, questions, photos, COs) is moved or changed. Steps 2–3 are server-side (Phase 2). Until then, conversion records the project and leaves the Drive folder where it is.

## 7. Live-data preview for the bosses

- **How:** build on a feature branch in a clean worktree. Pushing the branch makes Vercel build a **preview deployment automatically**; this is already happening for other branches. Vercel's login protection (`ssoProtection: all_except_custom_domains`) covers preview URLs, so Koy sends the bosses a **Vercel Share link** for that deployment, which needs no Vercel login. The bosses sign in with their own PINs; the preview domain is a separate origin with its own sign-in and service worker.
- **Live data means real writes.** Everything clicked in the preview hits production immediately.
  - Bosses work only in **"ZZ Preview – Projects Test"**: test buildings, test milestones. Fratto Farms is not touched.
  - After the review, the test project and its buildings are **archived**, never deleted.
  - Test building names start with "ZZ Preview" so the crew's Job Board sorts them last and nobody mistakes them for real work.
- **What works in the preview (Phase 1):** everything except plan routing by building. That covers grouping, the project page, Add Building, the folder picker, milestones, folded Plans & Links, the Project-wide block (it lists folders that already exist), and the breadcrumb and hops.
- **Prerequisite live change, with Koy's OK:** the additive `projects` rule (§9). Without it the preview can't save a project.

## 8. Phases and deploy gates

**Every arrow is a Koy approval. Nothing deploys on its own.**

1. **Phase 1, client (App.js):** Features A + B + C screens and data. The `projects` rule. The Simpro-lead sweep for the **client-side** lookups. SOP guides + FEATURES.md.
   → Koy approves the diff → **deploy the `projects` rule** → **push the feature branch** → Vercel preview → Share link to the bosses.
2. **Phase 2, functions:** Simpro-folder routing in the pull, project folder creation, the move-into-parent for conversion, Plan Intake routing, the server-side Simpro-lead sweep (Friday Packet, foreman prep).
   → Koy approves → functions deploy.
3. **Ship:** merge to `main` (production), crew brief, vault log. Then convert the real Fratto Farms with Koy.

## 9. Data safety

- **New job fields** (`fieldMilestones`, `projectGroupId`, `simproFolder`, `projectRole`) all live **inside `data`.** The loader spreads them; the current crew build carries them through patch saves (it only writes changed keys) and full-write saves (it spreads the whole loaded `data`). The plan runs the `firestore-data-shape-audit` on the loader and every write path in [[Data-Shape Gotchas]] to prove it before any push.
- **Milestone writes** are append and flag only, reconciled against the funnel's locked `prev` (v473 rule). They are never a whole-array replace from a component copy, so a stale phone can't wipe someone else's entry.
- **The new `projects` rule** mirrors `needs`: read open, write requires `data` map + `updated_at` string. It is purely additive; no existing rule changes. Writes carry `app_build` via `stampWrite`, and the server-enforced version lock applies.
- **Creating a building** = creating a normal job through the existing new-job path (stamped, full write). Its fields are inherited, not linked; editing the project later never rewrites building jobs silently.
- **Leaving a project / archiving** clears pointers. Nothing is deleted.
- **Backups:** per-field versions, recovery_ledger, PITR (7 days), and the nightly / weekly exports cover every write above.

## 10. Testing

- Unit-style dry runs (like `scripts/commercial-dryrun.js`):
  - the roll-up counts (Site excluded)
  - the Simpro-lead resolver (shared vs own number)
  - `planDocPull` folder filtering (match, project-wide, unsorted, own number unchanged)
  - milestone add / remove / undo merges under two concurrent writers
- The data-shape audit on loader + write paths.
- `CI=true npm run build` (the pre-push gate) and eslint `no-undef`.
- A preview smoke test on the test project: every mockup path, at phone and desktop width.
- Confirm the current production build shows the test buildings sensibly and saves them without dropping the new fields.

## 11. Docs that ship with it

- `public/sops/jobinfo.html` (Milestones, Project section, GC Schedule Dates move)
- `public/sops/planslinks.html` (folded blocks, Project-wide plans)
- `public/sops/commercialmode.html` (GC Schedule Dates section)
- new `public/sops/projects.html` (Job Board project rows, project page, Add Building, Simpro folder picker), wired to a HelpDot on the project page. There is no Job Board guide today, so the project rows are explained here.
- `FEATURES.md` entry with the SW version
- the crew brief and the vault log on ship

## 12. Risks and open items

- **Bosses' clicks are real.** Mitigated by the test-project rule (§7). Koy reminds them to stay inside "ZZ Preview".
- **Simpro folder hygiene:** routing is only as good as the office's filing. The picker plus the "not in Simpro yet" warning catches typos. Shared / Unsorted catches the rest.
- **Lookup sweep completeness:** a missed `simproNo` → job join could double-count a shared bid. The plan includes a grep-based inventory and a dry run per site.
- **GC Portal:** each building is its own portal entry until the follow-up spec.

## Not app work (from the same meeting)
- Riverton: log the 3 floor drains on the Panel 1 wall as an RFI on the RFIs tab (possible code issue).
- Check unsent Simpro POs on Riverton (Battle Creek likely resolved).
- Fire alarm follow-up; resend the scheduling email to Chloe.

## Related
- [[Data-Shape Gotchas]] · [[Version Lock Spec]] · [[Server-Enforced Version Lock]] · [[Simpro → Drive plan pull]] · [[Plan Intake System]]
