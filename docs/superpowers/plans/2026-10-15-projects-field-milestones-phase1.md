# Projects + Field Milestones — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Plans & Links folded, add-only Field Milestones on every job, and multi-building Projects (grouping, project page, Add Building, breadcrumb). Do it on a feature branch whose Vercel preview Koy can send his bosses, on live data, after his explicit OK.

**Architecture:**
- A **building is a normal job** that carries `projectGroupId`. A small new `/projects/{id}` record (same `{data, updated_at}` envelope as `/needs`) holds the shared name, GC, notes and Simpro #.
- All new job fields live **inside `data`**, so the loader passes them through untouched. Milestones are an id'd array, so the existing save transaction's three-way merge (`_threeWayMerge`) keeps two devices' adds.
- Pure helpers sit at module scope and are tested verbatim through a `vm` harness (house pattern: `scripts/commercial-dryrun.js`).
- Three tiny server pieces ship before the preview: a Drive-folder guard, a read-only Simpro folder list, and a Simpro-number join guard.

**Tech Stack:** React (CRA) single file `src/App.js`, Firestore (web SDK v9 modular), Firebase Cloud Functions (`firebase-functions/v1`, Node 22), Vercel (preview deployments from branches).

**Spec:** `docs/superpowers/specs/2026-10-15-projects-field-milestones-design.md` (vault: `~/Desktop/Command Center/08-Specs/Projects and Field Milestones Spec.md`). Mockup: `projects-milestones-mockup.html` (repo root, uncommitted in the shared folder).

## Global Constraints

- **Nothing deploys, pushes, or publishes without Koy's explicit OK in chat.** That covers rules, functions, branch push, and the Vercel Share link. (Koy: *"be sure to not deploy anything until i approve of it all."*)
- Build in a **clean git worktree off `origin/main`**, never in the shared `~/Desktop/homestead-electric` folder (4+ sessions push to main).
- Every client save keeps the version-lock stamp: job writes go through `saveJob` or `stampWrite(...)`; `/projects` writes use `stampWrite(...)`.
- New job fields go **inside `data`** (`fieldMilestones`, `projectGroupId`, `simproFolder`, `simproLead`, `projectRole`). No loader change, no top-level fields.
- Field name is **`projectGroupId`**, never `projectId` (already used three other ways).
- Nothing is ever deleted: milestone Remove = `removed:true`; Undo = `removed:false`; leaving a project clears pointers only; the project rule denies delete.
- UI: everything starts **folded** with counts/badges on headers. Font sizes ≥ 11 (prefer 12.5–15). Touch targets ≥ 40px (tabs/inputs 44px). **No emoji. No amber/yellow.** Use `C.*` tokens, never hand-typed copies of token hexes (design-lint ratchet). Project identity color is `PROJECT_COLOR = "#3D6FA8"` (steel blue, new).
- Dates shown/stamped as **M/D/YYYY** (`new Date().toLocaleDateString("en-US")`).
- Building job names are **"<Project> · <Building>"**, so the crew's current (old) build shows sensible names.
- The preview's test project is **"ZZ Preview – Projects Test"**, with **no Simpro number**. Fratto Farms is not touched in Phase 1.
- `CI=true npm run build` must pass (prebuild gates: tdz-scan, design-lint, all `*-test.js` / `*-dryrun.js`). Never pipe the build output (`| tail` masks the exit code).

## Deviations from the spec (Koy must OK these at plan review)

1. **Three small server pieces move into Phase 1** (the spec had only the rule before the preview). Without them the preview would misbehave on live data:
   - `ensureJobDriveFolder` (live trigger) would create a **top-level Drive folder for every test building**. Guard: skip jobs with `projectGroupId`.
   - The Add Building picker needs the Simpro job's real folder names. No callable lists them today. New **read-only** `listSimproJobFolders`.
   - Friday Packet + foreman meeting prep map Simpro # → job with last-one-wins. Guard them with the same "joinable" rule as the client.
2. **Simpro lead is a job flag** (`simproLead: true`), not `project.leadJobId`. A building that *shares* the project's number (has `simproFolder`) only joins Simpro lookups if it's the lead. Site / Shared (no `simproFolder`) and own-number buildings always join. This keeps the rule a pure one-liner every lookup can call.
3. **Job Board:** projects get their own folded **PROJECTS** group at the top of the board. Their buildings are taken out of the stage groups (In Rough, etc.), so **no job shows twice**. The mockup had the project row inside "In progress".
4. **Phase 1 buildings get no Drive folder.** Folders inside the project folder are Phase 2. Drive Plans on a building says so instead of offering "Create Drive folder" (which would make a top-level folder).
5. **Simpro # conflict guard (new):** a project or own-number building can't take a Simpro # already used by a job outside the project. The message says to convert that job into a project instead.

## Review Focus

1. **Two phones add a milestone to the same job at the same moment.** Both must survive. Pinned by `_threeWayMerge` cases in Task 1.
2. **A building that shares the project's Simpro # but isn't the lead must never be picked by a Simpro # → job lookup.** An own-number building and the Site / Shared job must still be picked. Pinned in Task 1 (`isSimproJoinable`) and Task 6 (server guard source assert).
3. **The `projects` rule isn't deployed yet, or a project record is missing or archived.** Buildings must fall back to normal Job Board rows, never vanish. Pinned in Task 1 (`splitProjectJobs` with an unknown or archived project); the listener logs and carries on.
4. **The Simpro folder list can't be read** (callable not deployed, Simpro down, project has no Simpro #). The picker must fall back to a typed name with a plain warning, not a dead form. Pinned in Task 4, Step 6 (fallback branch) and the Task 9 smoke.
5. **Double-tapping "Create building".** Must create exactly one job. Pinned in Task 4 (`busy` guard) and the Task 9 smoke.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/App.js` | modify | helpers block (after `const uid`); `FoldSection` (after `Section`); `FieldMilestones`; `PlansTab` folding; `DriveFilesSection` count + building note; `ProjectsCtx`; `ProjectsBoardSection` / `ProjectGroupRow`; `ProjectSheet` / `AddBuildingForm` / `SimproFolderPicker`; `JobProjectSection`; `ProjectCrumb`; App-root projects state, listener, funnels; Simpro join sweep |
| `scripts/projects-dryrun.js` | create | vm harness: pure helpers + `_threeWayMerge` milestone cases + server guard source asserts |
| `package.json` | modify | add `node scripts/projects-dryrun.js` to `prebuild` |
| `firestore.rules` | modify | additive `match /projects/{projectId}` |
| `functions/index.js` | modify | `_needsDriveFolder` guard; new `listSimproJobFolders` callable |
| `functions/fridayPacket.js` | modify | joinable guard on `jobBySimproNo` |
| `functions/foremanMeetingPrep.js` | modify | joinable guard on `bySimpro` / `byAnySimpro` |
| `public/sops/projects.html` | create | new guide (project rows, project page, Add Building, picker) |
| `public/sops/jobinfo.html`, `planslinks.html`, `commercialmode.html` | modify | Milestones / Project section / folded blocks / GC Schedule Dates |
| `public/service-worker.js` | modify | `CACHE` → next free version (v542 at time of writing) |
| `FEATURES.md` | modify | new entry tagged `SW v542` + manifest line |

---

### Task 0: Clean worktree + green baseline

**Files:** none changed.

- [ ] **Step 1: Create the worktree off origin/main** (use superpowers:using-git-worktrees). Keep it outside iCloud so `node_modules` isn't evicted.

```bash
cd /Users/koyhomestead/Desktop/homestead-electric
git fetch origin main
git worktree add /Users/koyhomestead/he-worktrees/projects-milestones -b feat/projects-milestones origin/main
cd /Users/koyhomestead/he-worktrees/projects-milestones
git config core.hooksPath .githooks
npm ci
(cd functions && npm ci)
```

- [ ] **Step 2: Baseline build passes before any change**

Run: `cd /Users/koyhomestead/he-worktrees/projects-milestones && CI=true npm run build`
Expected: exit 0, "Compiled successfully". If it fails here, stop and report; the failure isn't ours.

- [ ] **Step 3: Note the live SW version**

Run: `head -1 public/service-worker.js`
Expected: `const CACHE = "homestead-v541";` (or higher). The next free version is used in Task 8.

---

### Task 1: Pure helpers + dry-run harness (TDD)

**Files:**
- Modify: `src/App.js` (insert directly after the line `const uid = () => String(++_uid);`, ≈ line 2552)
- Create: `scripts/projects-dryrun.js`
- Modify: `package.json` (`prebuild`)

**Interfaces — Produces (module scope in App.js, used by every later task):**
- `PROJECT_COLOR: string` = `"#3D6FA8"`
- `ProjectsCtx: React.Context` (value shape defined in Task 3)
- `isSimproJoinable(job) → boolean`
- `projectBuildings(jobs, projectGroupId) → job[]` (Site first, then natural name order; excludes archived/deleted)
- `projectRollup(buildings, stageOf) → {houses, rough, finish, flagged}` (excludes Site; `stageOf(job)` returns `"rough" | "finish" | "other"`)
- `splitProjectJobs(jobs, projects) → {rest: job[], byProject: {[pid]: job[]}}` (only live projects group)
- `buildingHops(buildings, id) → {prev: job|null, next: job|null}`
- `buildingJobName(projectName, buildingName) → string` ("A · B")
- `buildingShortName(job, project) → string`
- `simproNoConflict(jobs, simproNo, projectGroupId) → job|null`
- `liveMilestones(list) → item[]`
- `milestoneAdd(list, text, by, at, id) → item[]` (trims, 140 cap, blank → same array)
- `milestoneSetRemoved(list, id, removed, by, at) → item[]` (`removed:true` + who/when, or `removed:false`)
- `milestoneHeaderMeta(list) → string` ("none yet" | "3 · latest: UFR in (10/14)")

- [ ] **Step 1: Write the failing harness** `scripts/projects-dryrun.js`

```js
#!/usr/bin/env node
/* projects-dryrun.js — harness for the Projects + Field Milestones pure helpers.
 * Extracts the shipped helpers VERBATIM from src/App.js and evals them in a vm
 * sandbox (house pattern: scripts/commercial-dryrun.js), so what's under test is
 * exactly what ships.
 *
 * Spec: docs/superpowers/specs/2026-10-15-projects-field-milestones-design.md
 * Plan: docs/superpowers/plans/2026-10-15-projects-field-milestones-phase1.md
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "App.js"), "utf8");

const extractLine = (name) => { const m = new RegExp(`^const ${name}\\s*=`, "m").exec(src); if (!m) throw new Error(`extract: const ${name} not found`); const i = m.index; return src.slice(i, src.indexOf("\n", i)); };
function extractFrom(marker, label) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  let i = src.indexOf("{", start);
  let depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); if (i < 0) i = src.length; continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2); if (i < 0) i = src.length; else i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; if (depth === 0) { i++; break; } continue; }
  }
  if (depth !== 0) throw new Error(`extract: unbalanced braces for ${label}`);
  return src.slice(start, i) + ";";
}

const NAMES = ["isSimproJoinable", "projectBuildings", "projectRollup", "splitProjectJobs", "buildingHops", "buildingJobName", "buildingShortName", "simproNoConflict", "liveMilestones", "milestoneAdd", "milestoneSetRemoved", "milestoneHeaderMeta"];
const combined = [
  ...NAMES.map(extractLine),
  extractFrom("const _jeq = ", "_jeq"),
  extractFrom("const _threeWayMerge = ", "_threeWayMerge"),
  `({ ${NAMES.join(", ")}, _threeWayMerge })`,
].join("\n");
const H = vm.runInContext(combined, vm.createContext({}), { filename: "projects-extract.vm.js" });

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// 1. SIMPRO JOINS (spec §6.3, plan deviation 2)
eq(H.isSimproJoinable({ simproNo: "1482" }), true, "standalone job joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", projectRole: "site", simproNo: "1482" }), true, "Site / Shared (no simproFolder) joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "1482", simproFolder: "House 3" }), false, "shared non-lead building never joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "1482", simproFolder: "House 1", simproLead: true }), true, "shared lead joins");
eq(H.isSimproJoinable({ projectGroupId: "p1", simproNo: "2210" }), true, "own-number building joins");
eq(H.isSimproJoinable(null), true, "null-safe");

// 2. BUILDINGS + ROLLUP + BOARD SPLIT (spec §6.2, Review Focus 3)
const jobs = [
  { id: "a", name: "Fratto Farms · House 10", projectGroupId: "p1" },
  { id: "b", name: "Fratto Farms · House 2", projectGroupId: "p1", flagged: true },
  { id: "s", name: "Fratto Farms · Site / Shared", projectGroupId: "p1", projectRole: "site", flagged: true },
  { id: "x", name: "Fratto Farms · House 9", projectGroupId: "p1", archived: true },
  { id: "o", name: "Kweller" },
  { id: "g", name: "Ghost · House 1", projectGroupId: "gone" },
  { id: "z", name: "Old · House 1", projectGroupId: "p2" },
];
eq(H.projectBuildings(jobs, "p1").map(j => j.id), ["s", "b", "a"], "Site first, then natural order (2 before 10), archived out");
eq(H.projectBuildings(jobs, ""), [], "empty pid → none");
const stage = (j) => (j.id === "a" ? "finish" : "rough");
eq(H.projectRollup(H.projectBuildings(jobs, "p1"), stage), { houses: 2, rough: 1, finish: 1, flagged: 1 }, "Site excluded from counts and flags");
const split = H.splitProjectJobs(jobs, [{ id: "p1", name: "Fratto Farms" }, { id: "p2", name: "Old", archived: true }]);
eq(Object.keys(split.byProject), ["p1"], "only live projects group");
eq(split.byProject.p1.map(j => j.id), ["a", "b", "s", "x"], "split keeps every p1 job (archive filtering is projectBuildings' job)");
eq(split.rest.map(j => j.id), ["o", "g", "z"], "unknown / archived project → building stays a normal row");
eq(H.splitProjectJobs(jobs, null).rest.length, jobs.length, "no projects loaded (rule not deployed) → nothing hidden");

// 3. HOPS + NAMES + CONFLICT (spec §6.2, deviation 5)
const bl = H.projectBuildings(jobs, "p1");
eq([H.buildingHops(bl, "s").prev, H.buildingHops(bl, "s").next.id], [null, "b"], "first has no prev");
eq([H.buildingHops(bl, "a").prev.id, H.buildingHops(bl, "a").next], ["b", null], "last has no next");
eq(H.buildingHops(bl, "nope"), { prev: null, next: null }, "unknown id");
eq(H.buildingJobName(" Fratto Farms ", " House 6 "), "Fratto Farms · House 6", "joined + trimmed");
eq(H.buildingShortName({ name: "Fratto Farms · House 6" }, { name: "Fratto Farms" }), "House 6", "short name");
eq(H.buildingShortName({ name: "Kweller" }, { name: "Fratto Farms" }), "Kweller", "no prefix → whole name");
const sj = [{ id: "f", name: "Fratto Farms", simproNo: "1482" }, { id: "q", name: "Done", simproNo: "77", archived: true }, { id: "b1", name: "ZZ · B1", simproNo: "1482", projectGroupId: "zz" }];
eq(H.simproNoConflict(sj, "#1482", "p9").id, "f", "'#1482' matches 1482 outside the project");
eq(H.simproNoConflict([sj[0]], "1482", undefined).id, "f", "no project yet → any match conflicts");
eq(H.simproNoConflict(sj.filter(j => j.id !== "f"), "1482", "zz"), null, "same-project use is fine");
eq(H.simproNoConflict(sj, "77", "p9"), null, "archived job ignored");
eq(H.simproNoConflict(sj, "  ", "p9"), null, "blank → no conflict");

// 4. MILESTONES (spec §5, Review Focus 1)
let L = [];
L = H.milestoneAdd(L, "  Blockouts in  ", "Brady", "10/9/2026", "m1");
eq(L, [{ id: "m1", text: "Blockouts in", by: "Brady", at: "10/9/2026" }], "trimmed add");
const same = H.milestoneAdd(L, "   ", "Brady", "10/9/2026", "m2");
eq(same === L, true, "blank add returns the SAME array (caller can detect no-op)");
eq(H.milestoneAdd([], "x".repeat(200), "", "", "m3")[0].text.length, 140, "140 cap");
L = H.milestoneAdd(L, "UFR in", "Abe", "10/14/2026", "m2");
eq(H.milestoneHeaderMeta(L), "2 · latest: UFR in (10/14)", "header meta");
eq(H.milestoneHeaderMeta([]), "none yet", "empty");
eq(H.milestoneHeaderMeta(undefined), "none yet", "missing field");
const R = H.milestoneSetRemoved(L, "m2", true, "Koy", "10/15/2026");
eq(H.liveMilestones(R).map(m => m.id), ["m1"], "removed hidden");
eq(R.find(m => m.id === "m2").removedBy, "Koy", "remove stamped, item kept");
const U = H.milestoneSetRemoved(R, "m2", false);
eq(H.liveMilestones(U).map(m => m.id), ["m1", "m2"], "undo restores");
eq(U.find(m => m.id === "m2").removed, false, "undo writes removed:false (merge-safe, no key deletion)");
// Two devices add at once: base [m1], phone A adds a, phone B (server) added b.
const base = [{ id: "m1", text: "Blockouts in" }];
const mine = [...base, { id: "a", text: "UFR in" }];
const server = [...base, { id: "b", text: "Temp power on" }];
eq(H._threeWayMerge(base, mine, server).map(m => m.id).sort(), ["a", "b", "m1"], "concurrent adds both survive the save merge");
// Remove on A while B adds: base [m1,m2], mine m2 removed:true, server added c.
const base2 = [{ id: "m1", text: "x" }, { id: "m2", text: "y" }];
const mine2 = [{ id: "m1", text: "x" }, { id: "m2", text: "y", removed: true }];
const server2 = [...base2, { id: "c", text: "z" }];
const out2 = H._threeWayMerge(base2, mine2, server2);
eq(out2.find(m => m.id === "m2").removed, true, "my remove applies");
eq(out2.some(m => m.id === "c"), true, "their add survives my remove");

// 5. SERVER GUARDS PRESENT (Review Focus 2) — the functions aren't pure, so
// assert the guard text is in place; the functions' own dry-runs cover behavior.
const fn = (p) => fs.readFileSync(path.join(ROOT, "functions", p), "utf8");
eq(/if \(job\.projectGroupId\) return false;/.test(fn("index.js")), true, "ensureJobDriveFolder skips project buildings");
eq(/exports\.listSimproJobFolders = /.test(fn("index.js")), true, "listSimproJobFolders exported");
eq(/simproJoinable\(j\)/.test(fn("fridayPacket.js")), true, "Friday Packet join guard");
eq(/simproJoinable\(j\)/.test(fn("foremanMeetingPrep.js")), true, "foreman prep join guard");

console.log(`projects-dryrun: ${n} checks passed`);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/projects-dryrun.js`
Expected: FAIL with `extract: const isSimproJoinable not found`.

- [ ] **Step 3: Add the helpers block to App.js** directly after `const uid = () => String(++_uid);`

```js

// ── Projects + field milestones (spec 2026-10-15, docs/superpowers/specs/2026-10-15-projects-field-milestones-design.md) ──
// A project groups normal jobs ("buildings") through job.projectGroupId; the
// project record lives in /projects (same {data, updated_at} envelope as
// /needs). Buildings that SHARE the project's Simpro # carry simproFolder (the
// Simpro attachment folder that feeds them); exactly one may carry simproLead.
// Pure one-liners — scripts/projects-dryrun.js extracts and tests them verbatim.
const PROJECT_COLOR = "#3D6FA8";
const ProjectsCtx = createContext(null);
const isSimproJoinable = (j) => !(j && j.projectGroupId && j.simproFolder) || !!(j && j.simproLead);
const projectBuildings = (jobs, pid) => (jobs || []).filter(j => j && pid && j.projectGroupId === pid && !j.archived && !j.deleted).sort((a, b) => ((a.projectRole === "site") !== (b.projectRole === "site")) ? (a.projectRole === "site" ? -1 : 1) : String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
const projectRollup = (buildings, stageOf) => { const h = (buildings || []).filter(b => b && b.projectRole !== "site"); const st = h.map(b => stageOf(b)); return { houses: h.length, rough: st.filter(s => s === "rough").length, finish: st.filter(s => s === "finish").length, flagged: h.filter(b => b.flagged).length }; };
const splitProjectJobs = (jobs, projects) => { const live = new Set((projects || []).filter(p => p && p.id && !p.archived).map(p => p.id)); const rest = [], byProject = {}; (jobs || []).forEach(j => { if (j && j.projectGroupId && live.has(j.projectGroupId)) (byProject[j.projectGroupId] = byProject[j.projectGroupId] || []).push(j); else rest.push(j); }); return { rest, byProject }; };
const buildingHops = (buildings, id) => { const list = buildings || []; const i = list.findIndex(b => b && b.id === id); return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null }; };
const buildingJobName = (projectName, buildingName) => `${String(projectName || "").trim()} · ${String(buildingName || "").trim()}`;
const buildingShortName = (job, project) => { const n = String((job && job.name) || ""); const p = String((project && project.name) || "").trim(); return p && n.startsWith(p + " · ") ? n.slice(p.length + 3) : n; };
const simproNoConflict = (jobs, no, pid) => { const n = String(no || "").replace(/^#/, "").trim(); if (!n) return null; return (jobs || []).find(j => j && !j.archived && !j.deleted && String(j.simproNo || "").replace(/^#/, "").trim() === n && (!pid || j.projectGroupId !== pid)) || null; };
const liveMilestones = (list) => (Array.isArray(list) ? list : []).filter(m => m && !m.removed);
const milestoneAdd = (list, text, by, at, id) => { const base = Array.isArray(list) ? list : []; const t = String(text || "").trim().slice(0, 140); return t ? [...base, { id, text: t, by: by || "", at: at || "" }] : base; };
const milestoneSetRemoved = (list, id, removed, by, at) => (Array.isArray(list) ? list : []).map(m => (!m || m.id !== id) ? m : (removed ? { ...m, removed: true, removedBy: by || "", removedAt: at || "" } : { ...m, removed: false }));
const milestoneHeaderMeta = (list) => { const l = liveMilestones(list); if (!l.length) return "none yet"; const last = l[l.length - 1]; return `${l.length} · latest: ${last.text}${last.at ? ` (${String(last.at).replace(/\/\d{4}$/, "")})` : ""}`; };
```

Note: `milestoneAdd` returns the *same array* for a blank add, but a fresh `[]` when `list` is undefined. The harness checks the defined case only.

- [ ] **Step 4: Run sections 1–4** (section 5 fails until Task 6, which is expected)

Run: `node scripts/projects-dryrun.js`
Expected: FAIL at `ensureJobDriveFolder skips project buildings`, with every check before it passing. If an earlier check fails, fix the helper, not the test.

- [ ] **Step 5: Wire into prebuild.** In `package.json`, in the `prebuild` string, insert ` && node scripts/projects-dryrun.js` immediately after `node scripts/commercial-dryrun.js`. (Prebuild will fail until Task 6. That's intended; don't build until then.)

- [ ] **Step 6: Commit**

```bash
git add src/App.js scripts/projects-dryrun.js package.json
git commit -m "Projects + milestones: pure helpers and dry-run harness (server-guard asserts pending)"
```

---

### Task 2: `FoldSection` + Field Milestones (resi + commercial) + GC Schedule Dates

**Files:**
- Modify: `src/App.js`: add `FoldSection` right after the `Section` component (`function Section({label, ...})`, ≈ line 6069); add `FieldMilestones` right after `FoldSection`; JobDetail: `patchMilestones`, resi insert, commercial replace.

**Interfaces:**
- Consumes: `liveMilestones`, `milestoneAdd`, `milestoneSetRemoved`, `milestoneHeaderMeta` (Task 1); `uid`, `toast`, `readableInk`, `C`.
- Produces: `FoldSection({label, color, meta, badge:{text,color}|null, action, open, onToggle, defaultOpen, keepMounted, children})`, used by Tasks 3–5. `FieldMilestones({list, patchList, identity, color, badge})`.

- [ ] **Step 1: Add `FoldSection` after `Section`**

```jsx
// Folded section with a count / meta line on the header — Koy's standing rule:
// everything starts collapsed, counts + badges on the header (Projects spec
// 2026-10-15). Controlled when `open` is passed (so a header button can open
// it). keepMounted renders children hidden while folded so they still load and
// report counts (the Drive listing).
function FoldSection({label, color=C.dim, meta=null, badge=null, action=null, open: openProp, onToggle, defaultOpen=false, keepMounted=false, children}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp !== undefined ? openProp : openState;
  const toggle = () => { if (onToggle) onToggle(!open); else setOpenState(o => !o); };
  const ink = readableInk(color, C.bg);
  return (
    <div style={{marginBottom:4}}>
      <div onClick={toggle} role="button" aria-expanded={open}
        style={{display:"flex",alignItems:"center",gap:8,minHeight:46,borderBottom:`2px solid ${color}44`,
          marginTop:4,marginBottom:open?14:0,cursor:"pointer",userSelect:"none"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",color:ink,whiteSpace:"nowrap"}}>{label}</div>
        {badge && <span style={{fontSize:11,fontWeight:800,letterSpacing:"0.06em",color:"#fff",background:badge.color,borderRadius:4,padding:"1px 5px"}}>{badge.text}</span>}
        <div style={{flex:1,minWidth:0,textAlign:"right",fontSize:13,fontWeight:600,color:C.faint,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{meta}</div>
        {action && <div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>{action}</div>}
        <span style={{color:ink,fontSize:15,fontWeight:700}}>{open?"▾":"▸"}</span>
      </div>
      {keepMounted ? <div style={{display:open?"block":"none"}}>{children}</div> : (open && <div>{children}</div>)}
    </div>
  );
}
```

- [ ] **Step 2: Add `FieldMilestones` after `FoldSection`**

```jsx
// Field milestones (Projects spec §5): an add-only note list on every job. It
// starts empty and folded; each entry is stamped who + M/D/YYYY; Remove sets
// removed:true (never deleted) with an inline Undo. patchList(fn) hands fn the
// job's FRESHEST list (JobDetail's jobRef) — never this render's copy — and the
// save transaction's three-way merge keeps another phone's adds (items have ids).
function FieldMilestones({ list, patchList, identity, color = C.teal, badge = null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [undo, setUndo] = useState(null); // { id, text }
  const inputRef = useRef(null);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(t); }, [undo]);
  const live = liveMilestones(list);
  const stamp = () => new Date().toLocaleDateString("en-US");
  const who = identity?.name || "";
  const ink = readableInk(color, C.bg);
  const openAndFocus = () => { setOpen(true); setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0); };
  const add = () => {
    if (!String(text).trim()) { toast.info("Type a milestone first"); return; }
    patchList(cur => milestoneAdd(cur, text, who, stamp(), uid()));
    setText("");
  };
  const remove = (m) => { patchList(cur => milestoneSetRemoved(cur, m.id, true, who, stamp())); setUndo({ id: m.id, text: m.text }); };
  const restore = () => { if (!undo) return; const id = undo.id; patchList(cur => milestoneSetRemoved(cur, id, false)); setUndo(null); };
  const btn = { fontFamily:"inherit", cursor:"pointer", minHeight:40, borderRadius:8, fontWeight:700, fontSize:13 };
  return (
    <FoldSection label="Milestones" color={color} badge={badge} meta={milestoneHeaderMeta(list)} open={open} onToggle={setOpen}
      action={<button type="button" onClick={openAndFocus} style={{...btn, border:`1px solid ${ink}`, background:"#fff", color:ink, padding:"0 12px", fontWeight:800}}>+ Add</button>}>
      {live.length === 0 && <div style={{fontSize:13,color:C.dim,marginBottom:6}}>Nothing logged yet. Add the first one when it happens in the field.</div>}
      {live.map(m => (
        <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 6px 6px 10px",marginBottom:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14.5,color:C.text}}>{m.text}</div>
            <div style={{fontSize:13,color:C.faint}}>{m.by}{m.at ? ` · ${m.at}` : ""}</div>
          </div>
          <button type="button" onClick={() => remove(m)} style={{...btn, marginLeft:"auto", background:"none", border:`1px solid ${C.border}`, color:C.dim, padding:"0 12px"}}>Remove</button>
        </div>
      ))}
      {undo && (
        <div style={{display:"flex",alignItems:"center",gap:10,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"4px 6px 4px 10px",marginBottom:6,fontSize:13,color:C.dim}}>
          <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Removed “{undo.text}”</span>
          <button type="button" onClick={restore} style={{...btn, marginLeft:"auto", background:"none", border:"none", color:C.accent, fontWeight:800, padding:"0 12px"}}>Undo</button>
        </div>
      )}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <input ref={inputRef} value={text} maxLength={140} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="e.g. Blockouts in, UFR in…"
          style={{flex:1,minWidth:0,minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit",color:C.text,background:"#fff"}}/>
        <button type="button" onClick={add} style={{...btn, minHeight:44, border:"none", padding:"0 16px", fontSize:14, background:color, color:"#fff"}}>Add</button>
      </div>
      <div style={{fontSize:13,color:C.dim,marginTop:6}}>Stamped with your name and today's date. No due dates yet.</div>
    </FoldSection>
  );
}
```

- [ ] **Step 3: Add `patchMilestones` in JobDetail**, directly after the `u` funnel's closing `};` (the `const u = patch => { … onUpdate(updated, finalPatch); };` block, ≈ line 29483–29517):

```js
  // Field milestones: fn gets the FRESHEST list (jobRef), never a render copy
  // (stale-copy rule, v473) — the save transaction merges by item id.
  const patchMilestones = (fn) => u({ fieldMilestones: fn(jobRef.current.fieldMilestones) });
```

- [ ] **Step 4: Residential: insert Milestones after Pre-Job Prep.** Find `<Section label="Pre-Job Prep"` (≈ 34054), then its matching closing `</Section>`. Directly after that `</Section>`, insert:

```jsx
              {!isCommercial(job) && (
                <FieldMilestones list={job.fieldMilestones} patchList={patchMilestones} identity={identity} color={C.teal} badge={{text:"NEW",color:C.blue}}/>
              )}
```

If the Pre-Job Prep section is itself inside a resi-only conditional, the `!isCommercial(job) &&` guard is redundant but harmless. Keep it.

- [ ] **Step 5: Commercial: replace the Milestones `Section`.** Replace the whole block from `<Section label="Milestones" color={C.teal} defaultOpen={false}>` through its closing `</Section>` (≈ 34157–34164) with:

```jsx
                <FoldSection label="GC Schedule Dates" color={C.teal} badge={{text:"MOVED",color:C.dim}}
                  meta={`${COMM_MILESTONES.filter(([k]) => ms[k]).length} of ${COMM_MILESTONES.length} set`}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"10px 14px"}}>
                    {COMM_MILESTONES.map(([k,l]) => (
                      <div key={k}>{lbl(l)}<DateInp value={ms[k]||""} onChange={e=>{ const v=e.target.value; cu(x=>({...x, milestones:{...(x.milestones||{}), [k]:v}})); }}/></div>
                    ))}
                  </div>
                  <div style={{fontSize:13,color:C.dim,marginTop:8}}>The dates the Forecast shows for a commercial job and the Ufer / underground reminders key on (from the GC schedule — phases 2 and 6). Same dates as before — they just moved out of Milestones.</div>
                </FoldSection>
                <FieldMilestones list={job.fieldMilestones} patchList={patchMilestones} identity={identity} color={C.teal}/>
```

The inner grid and `DateInp` lines are byte-identical to the old block. Only the wrapper and the hint change. `commercial.milestones` is untouched.

- [ ] **Step 6: Verify syntax + lint fast** (the full build waits for Task 6):

Run: `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} --rule 'no-undef:error' --env browser,es2022 --global process src/App.js 2>&1 | grep -E "FoldSection|FieldMilestones|patchMilestones|liveMilestones|milestone" ; node scripts/design-lint.js`
Expected: no `no-undef` lines mentioning the new names; design-lint passes.

- [ ] **Step 7: Commit**

```bash
git add src/App.js
git commit -m "Field milestones: add-only list on every job (folded, stamped, Remove + Undo); commercial GC dates move to their own section"
```

---

### Task 3: Plans & Links starts folded

**Files:**
- Modify: `src/App.js`: `DriveFilesSection` (≈ 26776) and `PlansTab` (≈ 27464).

**Interfaces:**
- Consumes: `FoldSection` (Task 2), `LINK_FIELDS`, `LINK_FIELD_SECTION`, `isSectionHidden`, `PROJECT_COLOR`, `ProjectsCtx` (the project-wide block reads the ctx if present; it renders nothing until Task 4 provides it).
- Produces: `DriveFilesSection` accepts an optional `onCount(n:number)`.

- [ ] **Step 1: `DriveFilesSection` reports its file count and explains building folders.** Change the signature line to:

```jsx
function DriveFilesSection({ job, onUpdate, onCount = null }) {
```

In the listing `useEffect`:
- replace `if (!folderId) { setDriveFiles([]); setTreeFolderIds([]); return; }` with `if (!folderId) { setDriveFiles([]); setTreeFolderIds([]); if (onCount) onCount(0); return; }`
- right after `setDriveFiles(allFiles);` add `if (onCount) onCount(allFiles.length);`

Then, at the top of the component's `return (`, before its first child, add:

```jsx
      {job.projectGroupId && !job.driveFolderId && (
        <div style={{fontSize:13,color:C.dim,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 12px",marginBottom:10,lineHeight:1.4}}>
          This building's Drive folder gets made inside the project's folder in the next step of Projects. Until then its plans live on the project page and in Project-wide plans.
        </div>
      )}
```

Find the JSX in this component that renders the "Create Drive folder" button (search `handleCreateFolder` inside the component's JSX). Wrap that button element in `{!job.projectGroupId && ( … )}` so a building can't make a top-level folder.

- [ ] **Step 2: Fold the four blocks in `PlansTab`.** Replace the start of `PlansTab` through the end of the LINKS map, and wrap the custom-sections block. The final shape:

```jsx
function PlansTab({job, onUpdate, onOpenBidItems=null}) {
  // v542 (Projects spec §4): every block starts folded with a count on its header.
  const [driveCount, setDriveCount] = useState(null);
  const pctx = useContext(ProjectsCtx);
  const project = job.projectGroupId && pctx ? (pctx.projects || []).find(p => p.id === job.projectGroupId && !p.archived) : null;
  const linkKeys = LINK_FIELDS.filter(([k])=>!(LINK_FIELD_SECTION[k] && isSectionHidden(job, LINK_FIELD_SECTION[k])));
  const linksSet = linkKeys.filter(([k]) => ((job.linkSections?.[k]) || (job[k] ? [{url:job[k]}] : [])).some(l => l && l.url)).length;
  const uploads = (job.planFiles || []).length;
  const customs = (job.customLinks || []).length;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <div>
      {/* (keep the existing "Looking for Bid Items (Simpro)?" button exactly as it is) */}

      <FoldSection label="Drive Plans" color={C.blue} keepMounted
        meta={driveCount == null ? "loading…" : `${plural(driveCount, "file")}${project ? ` · ${buildingShortName(job, project)} folder` : ""}`}>
        <DriveFilesSection job={job} onUpdate={onUpdate} onCount={setDriveCount} />
      </FoldSection>

      {project && (
        <FoldSection label="Project-wide plans" color={PROJECT_COLOR} badge={{text:"NEW",color:C.blue}}
          meta={project.wideFolderId ? `every building · ${project.name}` : "made with the project folders"}>
          <div style={{fontSize:13,color:C.dim,lineHeight:1.4}}>
            Site, civil and shared sheets for every building in {project.name} live in one Project-wide Drive folder, so a revision gets replaced once and every building sees it. The folder gets made in the next step of Projects.
          </div>
        </FoldSection>
      )}

      <FoldSection label="Uploaded Files" color={C.blue} meta={plural(uploads, "file")}>
        <FileUploadSection jobId={job.id} files={job.planFiles || []} onChange={v => onUpdate({ planFiles: v })} />
      </FoldSection>

      <FoldSection label="Links" color={C.blue} meta={`${linksSet} of ${linkKeys.length} set`}>
        {linkKeys.map(([k,l]) => {
          /* ← the existing LINK_FIELDS map body, unchanged */
        })}
      </FoldSection>

      <FoldSection label="Custom Sections" color={C.blue} meta={plural(customs, "section")}>
        {/* ← the existing custom-sections block (from its "CUSTOM SECTIONS" header row with + Add Section, through the list), unchanged */}
      </FoldSection>
    </div>
  );
}
```

Concretely, for the engineer:
- **Remove** the old divider `div` that wrapped `FileUploadSection`, and the old `LINKS` heading `div`.
- The existing `LINK_FIELDS.filter(...).map(([k,l])=>{ … })` becomes `linkKeys.map(([k,l])=>{ … })` with the **same body**.
- The custom-sections block moves inside the last `FoldSection` with **no edits**.
- `useContext` is already imported (used by `PunchNotesCtx`). Confirm with `grep -n "useContext" src/App.js | head -2`.

- [ ] **Step 3: Lint**

Run: `node scripts/design-lint.js && npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} --rule 'no-undef:error' --env browser,es2022 --global process src/App.js 2>&1 | grep -cE "error"`
Expected: design-lint passes; the error count equals the baseline count you note on the first run (no new `no-undef`).

- [ ] **Step 4: Commit**

```bash
git add src/App.js
git commit -m "Plans & Links: every block starts folded with a count; buildings can't make a top-level Drive folder"
```

---

### Task 4: Projects data layer — rule, listener, funnels, context

**Files:**
- Modify: `firestore.rules` (insert before `// ── EVERYTHING ELSE`)
- Modify: `src/App.js`, inside `function App()` (≈ 65853): state, listener next to `unsubNeeds` (≈ 66750), cleanup line (≈ 66818), funnels next to `saveNeed` (≈ 67615), provider at the root `return (` (≈ 69154), `ProjectSheet` mount.

**Interfaces:**
- Consumes: Task 1 helpers; `blankJob`, `sanitize`, `stampWrite`, `reportWriteDenied(e, coll, id)`, `getAccess`, `jobDivision`, `setDoc`, `updateDoc`, `doc`, `db`, `flushJob`, `setSelected`, `setOpenTab`, `allJobs`, `setAllJobs`, `identity`.
- Produces: the ctx value `projectsCtx = { projects, allJobs, identity, canManage, saveNewProject(p)→Promise<bool>, patchProject(id, patch)→Promise<bool>, createBuilding(project, opts)→Promise<job|null>, openProject(id), openJob(job) }` and `opts = { name, shareSimpro:boolean, simproFolder, ownSimproNo, hiddenSections }`.

- [ ] **Step 1: Additive rule.** In `firestore.rules`, directly above `// ── EVERYTHING ELSE`, add:

```
    // ── PROJECTS (multi-building) ─────────────────────────────────────────────
    // Projects spec 2026-10-15. A project groups normal jobs (buildings) via
    // job.data.projectGroupId. Same envelope + light validation as /needs.
    // Never deleted — archived:true inside data (spec §9).
    match /projects/{projectId} {
      allow read: if true;
      allow create, update: if request.resource.data.keys().hasAll(['data', 'updated_at'])
                            && request.resource.data.data is map
                            && request.resource.data.updated_at is string;
      allow delete: if false;
    }
```

- [ ] **Step 2: State + listener.** In `App()`, next to `const [needs, setNeeds] = useState([]);`, add:

```js
  const [projects, setProjects] = useState([]);           // Projects spec 2026-10-15
  const [openProjectId, setOpenProjectId] = useState(null);
```

Directly after the `unsubNeeds` `onSnapshot(...)` block, add:

```js
    // Projects (spec 2026-10-15) — /projects, same `data` envelope as needs.
    // Until the rule is deployed this errors with permission-denied: we log and
    // keep going, and every building simply shows as a normal job row.
    const unsubProjects = onSnapshot(collection(db,"projects"),
      (snap) => { setProjects(snap.docs.map(d => d.data().data).filter(Boolean)); },
      (err) => { console.warn("Projects snapshot error (rule not deployed yet?):", err && err.code); }
    );
```

In the cleanup line that calls `unsubNeeds();`, add `unsubProjects();` right after it.

- [ ] **Step 3: Funnels.** Directly after the `saveNeed` function, add:

```js
  // ── Projects funnels (spec 2026-10-15 §6) ── create = one stamped setDoc;
  // edits = dotted data.<field> updateDoc (field-surgical, like patchNeed) so two
  // people editing different fields never last-write-wins each other.
  const canManageProjects = ["admin","manager"].includes(getAccess(identity));
  const saveNewProject = async (p) => {
    setProjects(prev => [...(prev||[]).filter(x => x.id !== p.id), p]);
    try { await setDoc(doc(db,"projects",p.id), stampWrite({ data: sanitize(p), updated_at: new Date().toISOString(), saved_by: identity?.name || "" })); return true; }
    catch (e) { console.error("saveNewProject error:", e); if (!(await reportWriteDenied(e, "projects", p.id))) toast.error(`Couldn't save the project: ${e.message || e}`); setProjects(prev => (prev||[]).filter(x => x.id !== p.id)); return false; }
  };
  const patchProject = async (id, patch) => {
    setProjects(prev => (prev||[]).map(p => p.id === id ? { ...p, ...patch } : p));
    const upd = { updated_at: new Date().toISOString(), saved_by: identity?.name || "" };
    Object.keys(patch).forEach(k => { upd["data." + k] = patch[k]; });
    try { await updateDoc(doc(db,"projects",id), stampWrite(upd)); return true; }
    catch (e) { console.error("patchProject error:", e); if (!(await reportWriteDenied(e, "projects", id))) toast.error(`Couldn't save the project: ${e.message || e}`); return false; }
  };
  const createBuilding = async (project, opts) => {
    if (!canManageProjects) { toast.error("Adding a building is office-only."); return null; }
    const short = String(opts.name || "").trim();
    if (!short) { toast.error("Name the building first."); return null; }
    const siblings = projectBuildings(allJobs, project.id);
    const ownNo = String(opts.ownSimproNo || "").replace(/^#/, "").trim();
    if (!opts.shareSimpro && ownNo) { const clash = simproNoConflict(allJobs, ownNo, project.id); if (clash) { toast.error(`Simpro #${ownNo} already belongs to ${clash.name}. Make that job part of the project instead.`); return null; } }
    if (siblings.some(b => buildingShortName(b, project).toLowerCase() === short.toLowerCase())) { toast.error(`${project.name} already has a ${short}.`); return null; }
    const src = siblings.find(b => b.projectRole === "site") || siblings[0] || null;
    const pick = (k) => (src && src[k] !== undefined && src[k] !== "") ? src[k] : (project[k] !== undefined ? project[k] : undefined);
    const j = blankJob();
    if (project.division === "commercial") j.division = "commercial"; else delete j.division;
    j.name = buildingJobName(project.name, short);
    j.projectGroupId = project.id;
    j.simproNo = opts.shareSimpro ? String(project.simproNo || "") : ownNo;
    j.simproFolder = opts.shareSimpro && project.simproNo ? String(opts.simproFolder || short).trim() : "";
    if (j.simproFolder && !siblings.some(b => isSimproJoinable(b) && String(b.simproNo || "") === String(project.simproNo || ""))) j.simproLead = true;
    ["address","gc","phone","gcContacts","gcContactLead","gcContactLead2","gcContact2","phone2","gcContactLabels","customer"].forEach(k => { const v = pick(k); if (v !== undefined) j[k] = v; });
    j.foreman = (src && src.foreman) || "Unassigned";
    j.hiddenSections = { ...(opts.hiddenSections || {}) };
    try {
      await setDoc(doc(db,"jobs",j.id), stampWrite({ data: sanitize(j), updated_at: new Date().toISOString() }));
      setAllJobs(js => [j, ...js]);
      toast.success(`${short} added to ${project.name}`);
      return j;
    } catch (e) { console.error("createBuilding error:", e); if (!(await reportWriteDenied(e, "jobs", j.id))) toast.error(`Couldn't add the building: ${e.message || e}`); return null; }
  };
  const openProject = (id) => { if (selected) flushJob(selected); setSelected(null); setOpenTab(null); setOpenProjectId(id); };
  const openJobFromProject = (j) => { if (selected) flushJob(selected); setOpenProjectId(null); setOpenTab(null); setSelected(allJobs.find(x => x.id === j.id) || j); };
  const projectsCtx = { projects, allJobs, identity, canManage: canManageProjects, saveNewProject, patchProject, createBuilding, openProject, openJob: openJobFromProject };
```

Check before writing: `grep -n "const \[selected, setSelected\]\|const flushJob\|const \[openTab, setOpenTab\]\|updateDoc" src/App.js | head`. All four must exist in `App()` scope. If `updateDoc` isn't imported, add it to the existing `firebase/firestore` import line.

- [ ] **Step 4: Provider + ProjectSheet mount.** In `App()`'s root `return (`, wrap the outermost `<div style={{minHeight:"100vh",…}}>` element:

```jsx
  return (
    <ProjectsCtx.Provider value={projectsCtx}>
    <div style={{minHeight:"100vh",background:"transparent",fontFamily:"'DM Sans',sans-serif",color:C.text,position:"relative"}}>
      …existing children…
      {openProjectId && !selected && (
        <ProjectSheet projectId={openProjectId} onClose={() => setOpenProjectId(null)} />
      )}
    </div>
    </ProjectsCtx.Provider>
  );
```

(`ProjectSheet` is defined in Task 5. Until then, add a temporary stub directly above `function App()`, `function ProjectSheet(){ return null; }`, and delete it in Task 5, Step 3.)

- [ ] **Step 5: Lint + dry-run**

Run: `node scripts/design-lint.js && node scripts/projects-dryrun.js 2>&1 | tail -3`
Expected: design-lint passes; the dry-run still fails only at the server-guard section.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules src/App.js
git commit -m "Projects data layer: additive /projects rule, listener, create/patch funnels, createBuilding, context"
```

---

### Task 5: Job Board project rows, project page, Add Building, job breadcrumb, Job Info Project section

**Files:**
- Modify: `src/App.js`: new components placed directly **above** `function StageSectionList(` (≈ 35918): `ProjectsBoardSection`, `ProjectGroupRow`, `SimproFolderPicker`, `AddBuildingForm`, `ProjectSheet`, `ProjectCrumb`, `JobProjectSection`. Edits to `StageSectionList`, `JobDetail` (crumb + Job Info section).

**Interfaces:**
- Consumes: ctx (Task 4), Task 1 helpers, `FoldSection`, `JOB_SECTIONS`, `isCommercial`, `effRS`, `effFS`, `httpsCallable`, `functions`, `showConfirm`.
- Produces: `buildingStage(job) → "rough"|"finish"|"other"`. The callable contract `listSimproJobFolders({simproNo}) → {folders:[{id,name}]}` is implemented server-side in Task 6.

- [ ] **Step 1: Add the components above `StageSectionList`**

```jsx
// ── Projects UI (spec 2026-10-15 §6.2) ───────────────────────────────────────
const buildingStage = (b) => { const f = effFS(b), r = effRS(b); const active = ["scheduled","date_confirmed","inprogress"]; if (active.includes(f)) return "finish"; if (active.includes(r)) return "rough"; return "other"; };

// One folded PROJECTS group at the top of the board (plan deviation 3): its
// buildings are taken out of the stage groups, so no job shows twice.
function ProjectsBoardSection({ byProject, ctx, JobRow, fc, startCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const list = Object.keys(byProject).map(id => (ctx.projects || []).find(p => p.id === id)).filter(Boolean)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
  if (!list.length) return null;
  const ink = readableInk(PROJECT_COLOR, C.bg);
  return (
    <div style={{marginBottom:24}}>
      <div onClick={() => setCollapsed(c => !c)} role="button" aria-expanded={!collapsed}
        style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,paddingBottom:8,borderBottom:`2px solid ${PROJECT_COLOR}33`,cursor:"pointer",userSelect:"none",minHeight:40}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:PROJECT_COLOR,flexShrink:0}}/>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:ink}}>PROJECTS</div>
        <div style={{background:`${PROJECT_COLOR}18`,border:`1px solid ${PROJECT_COLOR}33`,borderRadius:99,padding:"2px 10px",fontSize:12.5,color:ink,fontWeight:700}}>{list.length}</div>
        <div style={{marginLeft:"auto",color:ink,fontSize:14,fontWeight:700}}>{collapsed ? "▸" : "▾"}</div>
      </div>
      {!collapsed && list.map(p => <ProjectGroupRow key={p.id} project={p} visible={byProject[p.id]} ctx={ctx} JobRow={JobRow} fc={fc}/>)}
    </div>
  );
}

function ProjectGroupRow({ project, visible, ctx, JobRow, fc }) {
  const all = projectBuildings(ctx.allJobs, project.id);
  const shown = projectBuildings(visible, project.id);
  const narrowed = shown.length < all.length;           // a search / filter is on → open by itself
  const [openState, setOpenState] = useState(false);
  const open = narrowed || openState;
  const r = projectRollup(all, buildingStage);
  const ink = readableInk(PROJECT_COLOR, C.card);
  if (!shown.length) return null;
  return (
    <div style={{marginBottom:8}}>
      <div onClick={() => setOpenState(o => !o)} role="button" aria-expanded={open}
        style={{display:"flex",alignItems:"center",gap:10,background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${PROJECT_COLOR}`,borderRadius:10,padding:"10px 12px",minHeight:52,cursor:"pointer"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:15,color:C.text}}>{project.name}
            <span style={{display:"inline-block",fontSize:11,fontWeight:800,letterSpacing:"0.06em",border:`1px solid ${PROJECT_COLOR}`,color:ink,borderRadius:4,padding:"2px 6px",marginLeft:6,verticalAlign:2}}>PROJECT · {r.houses} {project.division === "commercial" ? "BUILDING" : "HOUSE"}{r.houses === 1 ? "" : "S"}</span>
          </div>
          <div style={{fontSize:13,color:C.faint,marginTop:2}}>{r.rough} in rough · {r.finish} in finish{r.flagged ? <b style={{color:C.red}}> · {r.flagged} flagged</b> : null}</div>
        </div>
        <span style={{color:ink,fontWeight:800,fontSize:16}}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{margin:"6px 0 4px 14px",paddingLeft:10,borderLeft:`2px solid ${PROJECT_COLOR}55`}}>
          <div onClick={() => ctx.openProject(project.id)} role="button"
            style={{display:"flex",alignItems:"center",minHeight:48,padding:"0 12px",marginBottom:6,borderRadius:10,border:`1px solid ${PROJECT_COLOR}66`,background:`${PROJECT_COLOR}0D`,color:ink,fontWeight:800,cursor:"pointer"}}>
            <span style={{flex:1}}>Project page</span><span>›</span>
          </div>
          {shown.map(job => <JobRow key={job.id} job={job} fc={fc || undefined} showForeman={!fc}/>)}
        </div>
      )}
    </div>
  );
}

// Simpro attachment-folder picker (spec §6.2). Reads the job's real folders via
// the read-only listSimproJobFolders callable; if that can't be read it falls
// back to a typed name with a plain warning (Review Focus 4).
function SimproFolderPicker({ simproNo, value, onChange, usedBy = {} }) {
  const [state, setState] = useState({ loading: !!simproNo, folders: null, error: "" });
  useEffect(() => {
    if (!simproNo) { setState({ loading: false, folders: null, error: "" }); return; }
    let live = true;
    setState({ loading: true, folders: null, error: "" });
    httpsCallable(functions, "listSimproJobFolders", { timeout: 30000 })({ simproNo: String(simproNo) })
      .then(res => { if (live) setState({ loading: false, folders: ((res && res.data && res.data.folders) || []).map(f => f.name).filter(Boolean), error: "" }); })
      .catch(e => { if (live) setState({ loading: false, folders: null, error: e.message || "Couldn't read Simpro" }); });
    return () => { live = false; };
  }, [simproNo]);
  const field = { width:"100%",minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit",color:C.text,background:"#fff",marginTop:6 };
  const warn = { border:`1px solid ${C.orange}55`,background:`${C.orange}0D`,color:C.text,borderRadius:8,padding:"8px 10px",fontSize:13,marginTop:8,lineHeight:1.4 };
  if (!simproNo) return <div style={{fontSize:13,color:C.dim,marginTop:6}}>The project has no Simpro # yet. Add it on the project page to pick a folder.</div>;
  if (state.loading) return <div style={{fontSize:13,color:C.dim,marginTop:6}}>Reading Simpro folders…</div>;
  if (!state.folders) return (
    <div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="Simpro folder name, e.g. House 3" style={field}/>
      <div style={warn}><b>Couldn't read Simpro's folders</b> ({state.error}). Type the folder name exactly as it is in Simpro. If it doesn't match, this building's plans land in Shared / Unsorted.</div>
    </div>
  );
  const found = state.folders.includes(value);
  return (
    <div>
      <select value={value} onChange={e => onChange(e.target.value)} style={field}>
        {state.folders.map(f => <option key={f} value={f}>{f}{usedBy[f] ? ` · used by ${usedBy[f]}` : ""}</option>)}
        {!found && <option value={value}>{value || "(no folder)"} · not in Simpro yet</option>}
      </select>
      {found
        ? <div style={{color:C.green,fontWeight:700,fontSize:13,marginTop:6}}>✓ Found in Simpro — plans will route here.</div>
        : <div style={warn}><b>No Simpro folder named “{value}” yet.</b> Make it in Simpro, or pick one above. Until then this building's plans land in Shared / Unsorted.</div>}
    </div>
  );
}

function AddBuildingForm({ project, ctx, onDone }) {
  const sibs = projectBuildings(ctx.allJobs, project.id);
  const [name, setName] = useState(`${project.division === "commercial" ? "Building" : "House"} ${sibs.filter(b => b.projectRole !== "site").length + 1}`);
  const [share, setShare] = useState(!!project.simproNo);
  const [folder, setFolder] = useState(name);
  const [folderTouched, setFolderTouched] = useState(false);
  const [ownNo, setOwnNo] = useState("");
  const [hidden, setHidden] = useState({});
  const [busy, setBusy] = useState(false);
  const usedBy = Object.fromEntries(sibs.filter(b => b.simproFolder).map(b => [b.simproFolder, buildingShortName(b, project)]));
  const sections = JOB_SECTIONS.filter(s => !s.parent && (!s.commercial || project.division === "commercial") && (!s.appliesTo || s.appliesTo({ division: project.division })));
  const k = { fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim,margin:"14px 0 4px" };
  const radio = (on) => ({ display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",border:`1px solid ${on ? PROJECT_COLOR : C.border}`,boxShadow:on?`0 0 0 1px ${PROJECT_COLOR}`:"none",borderRadius:8,background:"#fff",marginBottom:6,cursor:"pointer",minHeight:48 });
  const create = async () => {
    if (busy) return;                                   // Review Focus 5: one tap, one job
    setBusy(true);
    const j = await ctx.createBuilding(project, { name, shareSimpro: share, simproFolder: folder, ownSimproNo: ownNo, hiddenSections: hidden });
    setBusy(false);
    if (j) onDone(j);
  };
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginTop:10}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:C.text}}>Add Building</div>
      <div style={k}>BUILDING NAME</div>
      <input value={name} onChange={e => { setName(e.target.value); if (!folderTouched) setFolder(e.target.value); }}
        style={{width:"100%",minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit"}}/>
      <div style={k}>SIMPRO</div>
      <div style={radio(share)} onClick={(e) => { if (e.target.closest("select,input")) return; setShare(true); }}>
        <div style={{flex:1,minWidth:0}}><b>Shares the project's Simpro {project.simproNo ? `#${project.simproNo}` : "#"}</b>
          {share && <SimproFolderPicker simproNo={project.simproNo} value={folder} usedBy={usedBy} onChange={(v) => { setFolder(v); setFolderTouched(true); }}/>}
        </div>
      </div>
      <div style={radio(!share)} onClick={(e) => { if (e.target.closest("input")) return; setShare(false); }}>
        <div style={{flex:1,minWidth:0}}><b>Has its own Simpro #</b>
          {!share ? <input value={ownNo} onChange={e => setOwnNo(e.target.value)} inputMode="numeric" placeholder="Simpro job # (or leave blank)"
            style={{width:"100%",minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit",marginTop:6}}/>
            : <div style={{fontSize:13,color:C.dim,marginTop:2}}>Pulls plans exactly like any job today.</div>}
        </div>
      </div>
      <div style={k}>COPIED FROM THE PROJECT</div>
      <div style={{fontSize:13,color:C.dim}}>✓ GC + contacts · ✓ Address · ✓ Foreman · ✓ Division</div>
      <div style={k}>TABS THIS BUILDING SHOWS</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {sections.map(s => { const on = !hidden[s.key]; return (
          <span key={s.key} role="button" onClick={() => setHidden(h => ({ ...h, [s.key]: on }))}
            style={{display:"inline-flex",alignItems:"center",gap:6,borderRadius:99,fontSize:12.5,fontWeight:700,letterSpacing:"0.04em",cursor:"pointer",userSelect:"none",minHeight:40,padding:"0 13px",
              border:`1px ${on?"solid":"dashed"} ${on?C.green:C.faint}`,color:on?C.green:C.dim,background:on?`${C.green}0F`:C.surface}}>
            {on ? "✓" : "—"} {String(s.label).toUpperCase()}</span>); })}
      </div>
      <div style={{fontSize:13,color:C.dim,marginTop:6}}>Same as Job Sections. Job Info, Activity, Photos and Plans &amp; Links always show.</div>
      <button type="button" onClick={create} disabled={busy}
        style={{width:"100%",marginTop:14,minHeight:48,border:"none",borderRadius:8,background:PROJECT_COLOR,color:"#fff",fontWeight:700,fontSize:15,cursor:busy?"default":"pointer",opacity:busy?0.6:1,fontFamily:"inherit"}}>
        {busy ? "Creating…" : "Create building"}</button>
    </div>
  );
}

function ProjectSheet({ projectId, onClose }) {
  const ctx = useContext(ProjectsCtx);
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState(null);   // null = not editing
  const project = ctx && (ctx.projects || []).find(p => p.id === projectId);
  if (!ctx || !project) return null;
  const bl = projectBuildings(ctx.allJobs, project.id);
  const r = projectRollup(bl, buildingStage);
  const chip = { background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:10,cursor:"pointer",minHeight:76 };
  const saveSimproNo = async (raw) => {
    const no = String(raw || "").replace(/^#/, "").trim();
    if (no === String(project.simproNo || "")) return;
    const clash = simproNoConflict(ctx.allJobs, no, project.id);
    if (clash) { toast.error(`Simpro #${no} already belongs to ${clash.name}. Make that job part of the project instead.`); return; }
    await ctx.patchProject(project.id, { simproNo: no });
  };
  return (
    <div style={{position:"fixed",inset:0,zIndex:900,background:C.bg,overflowY:"auto"}}>
      <div style={{maxWidth:900,margin:"0 auto",padding:"14px 16px 80px"}}>
        <button type="button" onClick={onClose} style={{background:"none",border:"none",color:C.accent,fontWeight:700,fontSize:14,minHeight:40,padding:0,cursor:"pointer",fontFamily:"inherit"}}>‹ Job Board</button>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:"0.06em",lineHeight:1,color:C.text}}>{project.name}</div>
        <div style={{fontSize:13,color:C.faint,marginTop:4}}>{project.division === "commercial" ? "Commercial" : "Residential"} project · {r.houses} {project.division === "commercial" ? "building" : "house"}{r.houses === 1 ? "" : "s"}{bl.some(b => b.projectRole === "site") ? " + site" : ""}{project.simproNo ? ` · shares Simpro #${project.simproNo}` : ""}</div>
        <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.1em",color:C.dim,margin:"16px 2px 6px"}}>BUILDINGS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
          {bl.map(b => (
            <div key={b.id} style={chip} role="button" onClick={() => ctx.openJob(b)}>
              <div style={{fontWeight:800,fontSize:15,color:C.text}}>{buildingShortName(b, project)}</div>
              {b.simproLead && <div style={{marginTop:4,fontSize:11,fontWeight:800,letterSpacing:"0.06em",color:readableInk(PROJECT_COLOR, C.card)}}>SIMPRO LEAD</div>}
              {b.projectRole === "site" && <div style={{fontSize:13,color:C.dim,marginTop:3}}>The original job — every old item is kept here</div>}
              <div style={{fontSize:13,color:C.faint,marginTop:6}}>{({rough:"In rough",finish:"In finish",other:"Not started / done"})[buildingStage(b)]}</div>
              {b.flagged && <div style={{fontSize:12.5,color:C.red,fontWeight:700,marginTop:4}}>Flagged</div>}
            </div>
          ))}
          {ctx.canManage && !adding && (
            <div role="button" onClick={() => setAdding(true)} style={{...chip,border:`1.5px dashed ${PROJECT_COLOR}`,color:readableInk(PROJECT_COLOR, C.bg),display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:15}}>+ Add Building</div>
          )}
        </div>
        {adding && <AddBuildingForm project={project} ctx={ctx} onDone={() => setAdding(false)}/>}
        <div style={{marginTop:14}}>
          <FoldSection label="Project info" color={PROJECT_COLOR} meta={`GC · notes · Simpro${project.simproNo ? ` #${project.simproNo}` : ""}`}>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim,marginBottom:4}}>GC</div>
            <div style={{marginBottom:10,fontSize:14}}>{project.gc || "—"}</div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim,marginBottom:4}}>PROJECT NOTES</div>
            {notes === null
              ? <div style={{marginBottom:10,fontSize:14,lineHeight:1.45,whiteSpace:"pre-wrap"}}>{project.notes || "—"} {ctx.canManage && <button type="button" onClick={() => setNotes(project.notes || "")} style={{background:"none",border:"none",color:C.accent,fontWeight:700,fontSize:13,minHeight:40,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>}</div>
              : <div style={{marginBottom:10}}>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} style={{width:"100%",padding:10,border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit"}}/>
                  <button type="button" onClick={async () => { await ctx.patchProject(project.id, { notes }); setNotes(null); }} style={{marginTop:6,minHeight:44,border:"none",borderRadius:8,background:PROJECT_COLOR,color:"#fff",fontWeight:700,padding:"0 16px",cursor:"pointer",fontFamily:"inherit"}}>Save notes</button>
                </div>}
            <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim,marginBottom:4}}>SHARED SIMPRO #</div>
            {ctx.canManage
              ? <input defaultValue={project.simproNo || ""} onBlur={e => saveSimproNo(e.target.value)} inputMode="numeric" placeholder="Only if the buildings share one"
                  style={{width:"100%",maxWidth:260,minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit"}}/>
              : <div style={{fontSize:14}}>{project.simproNo || "—"}</div>}
            <div style={{fontSize:13,color:C.dim,marginTop:10,lineHeight:1.4}}>The project's Drive folder, its Project-wide plans folder and Shared / Unsorted get made in the next step of Projects.</div>
            {ctx.canManage && (
              <button type="button" onClick={async () => { if (await showConfirm({ title:`Archive ${project.name}?`, message:"The project grouping goes away and its buildings show as normal jobs again. No job and nothing inside a job is deleted.", confirmLabel:"Archive project" })) { await ctx.patchProject(project.id, { archived:true, archivedBy: ctx.identity?.name || "", archivedAt: new Date().toISOString() }); onClose(); } }}
                style={{marginTop:14,minHeight:44,background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,fontWeight:700,padding:"0 14px",cursor:"pointer",fontFamily:"inherit"}}>Archive project</button>
            )}
          </FoldSection>
        </div>
      </div>
    </div>
  );
}

// Breadcrumb + labeled hops at the top of a building's job card (spec §6.2).
function ProjectCrumb({ job, ctx }) {
  const project = (ctx.projects || []).find(p => p.id === job.projectGroupId && !p.archived);
  if (!project) return null;
  const { prev, next } = buildingHops(projectBuildings(ctx.allJobs, project.id), job.id);
  const hop = { flex:1,minWidth:0,minHeight:40,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontWeight:700,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",padding:"0 10px",cursor:"pointer",fontFamily:"inherit" };
  return (
    <div style={{padding:"6px 22px 4px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:700,letterSpacing:"0.05em",color:C.dim}}>
        <button type="button" onClick={() => ctx.openProject(project.id)} style={{background:"none",border:"none",padding:0,minHeight:40,color:readableInk(PROJECT_COLOR, C.card),fontWeight:800,fontSize:13,letterSpacing:"0.05em",cursor:"pointer",fontFamily:"inherit"}}>{project.name.toUpperCase()}</button>
        <span>›</span><span style={{color:C.text}}>{buildingShortName(job, project).toUpperCase()}</span>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:4}}>
        <button type="button" disabled={!prev} onClick={() => prev && ctx.openJob(prev)} style={{...hop,textAlign:"left",opacity:prev?1:0.4}}>‹ {prev ? buildingShortName(prev, project) : "First"}</button>
        <button type="button" disabled={!next} onClick={() => next && ctx.openJob(next)} style={{...hop,textAlign:"right",opacity:next?1:0.4}}>{next ? buildingShortName(next, project) : "Last"} ›</button>
      </div>
    </div>
  );
}

// Job Info → Project (spec §6.2 / §6.5). In a project: which project, Simpro
// folder, Leave. Not in one: Make this a project (the job becomes Site / Shared).
// Every job write goes through JobDetail's u() funnel (onPatch).
function JobProjectSection({ job, ctx, onPatch }) {
  const [pname, setPname] = useState(null);   // null = not converting
  const [busy, setBusy] = useState(false);
  const project = job.projectGroupId ? (ctx.projects || []).find(p => p.id === job.projectGroupId && !p.archived) : null;
  const btn = { minHeight:44,background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontWeight:700,fontSize:14,padding:"0 14px",cursor:"pointer",fontFamily:"inherit" };
  if (project) return (
    <FoldSection label="Project" color={PROJECT_COLOR} badge={{text:"NEW",color:C.blue}} meta={`${project.name}${job.simproFolder ? ` · folder ${job.simproFolder}` : ""}`}>
      <div style={{fontSize:14}}>{project.name}{job.projectRole === "site" ? " · Site / Shared (the original job)" : ""}</div>
      {job.simproFolder
        ? <div style={{marginTop:6}}><div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim}}>SIMPRO FOLDER FOR PLANS</div>
            <SimproFolderPicker simproNo={project.simproNo} value={job.simproFolder} onChange={(v) => onPatch({ simproFolder: String(v || "").trim() })}/></div>
        : <div style={{fontSize:13,color:C.dim,marginTop:6}}>{job.simproNo && String(job.simproNo) !== String(project.simproNo || "") ? `Own Simpro #${job.simproNo} — pulls plans like any job.` : "Plans come from this job's own Drive folder."}</div>}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
        <button type="button" style={btn} onClick={() => ctx.openProject(project.id)}>Open project page</button>
        {ctx.canManage && <button type="button" style={btn} onClick={async () => {
          if (!(await showConfirm({ title:`Take this job out of ${project.name}?`, message:"It becomes a normal job again. Nothing on it is deleted.", confirmLabel:"Leave project" }))) return;
          onPatch({ projectGroupId:"", simproFolder:"", simproLead:false, projectRole:"" });
        }}>Leave project</button>}
      </div>
      <div style={{fontSize:13,color:C.dim,marginTop:6}}>Leaving never deletes anything — this job just becomes standalone again.</div>
    </FoldSection>
  );
  if (!ctx.canManage) return null;
  return (
    <FoldSection label="Project" color={PROJECT_COLOR} meta="not part of a project">
      {pname === null ? (
        <>
          <div style={{fontSize:13,color:C.dim,lineHeight:1.4,marginBottom:8}}>Several houses or buildings on this job? Make it a project. This job becomes the project's <b>Site / Shared</b> building and keeps every item it already has. Then add each house as its own job.</div>
          <button type="button" style={btn} onClick={() => setPname(job.name || "")}>Make this a project</button>
        </>
      ) : (
        <>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.1em",color:C.dim,marginBottom:4}}>PROJECT NAME</div>
          <input value={pname} onChange={e => setPname(e.target.value)} style={{width:"100%",minHeight:44,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:15,fontFamily:"inherit"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button type="button" disabled={busy} style={{...btn,background:PROJECT_COLOR,color:"#fff",border:"none",opacity:busy?0.6:1}} onClick={async () => {
              const name = String(pname || "").trim(); if (!name || busy) return;
              setBusy(true);
              const p = { id: "prj_" + uid(), name, division: isCommercial(job) ? "commercial" : "", gc: job.gc || "", address: job.address || "", notes: "", simproNo: String(job.simproNo || ""), createdAt: new Date().toISOString(), createdBy: ctx.identity?.name || "" };
              const ok = await ctx.saveNewProject(p);
              setBusy(false);
              if (!ok) return;
              onPatch({ projectGroupId: p.id, projectRole: "site", simproFolder: "", name: buildingJobName(name, "Site / Shared") });
              setPname(null);
              toast.success(`${name} is a project — add its buildings from the project page`);
            }}>{busy ? "Saving…" : "Create project"}</button>
            <button type="button" style={btn} onClick={() => setPname(null)}>Cancel</button>
          </div>
        </>
      )}
    </FoldSection>
  );
}
```

- [ ] **Step 2: `StageSectionList` pulls buildings into the PROJECTS group.** At the top of `function StageSectionList(...)`, after the `toggle` line, add:

```jsx
  const pctx = useContext(ProjectsCtx);
  const { rest: stageJobs, byProject } = pctx ? splitProjectJobs(jobs, pctx.projects) : { rest: jobs, byProject: {} };
```

Inside the section filter, change `const filtered = jobs.filter(sec.test);` to `const filtered = stageJobs.filter(sec.test);`. Then, directly inside the returned top `<div>` and before `{sections.map(sec => {`, add:

```jsx
      {pctx && Object.keys(byProject).length > 0 && (
        <ProjectsBoardSection byProject={byProject} ctx={pctx} JobRow={JobRow} fc={fc} startCollapsed={startCollapsed}/>
      )}
```

- [ ] **Step 3: Remove the Task 4 stub** `function ProjectSheet(){ return null; }`.

- [ ] **Step 4: JobDetail: crumb + Job Info section.** At the top of `function JobDetail(...)`, next to `const jobRef = useRef(job);`, add `const pctx = useContext(ProjectsCtx);`. Directly above the `{/* Tabs */}` comment in JobDetail's header (≈ 30980), add:

```jsx
        {job.projectGroupId && pctx && <ProjectCrumb job={job} ctx={pctx}/>}
```

On Job Info, add the Project section as the **first** child inside `{tab==="Job Info"&&(` → its outer wrapper (≈ 33715, before the existing first section):

```jsx
              {pctx && <JobProjectSection job={job} ctx={pctx} onPatch={u}/>}
```

- [ ] **Step 5: Lint**

Run: `node scripts/design-lint.js && npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} --rule 'no-undef:error' --env browser,es2022 --global process src/App.js 2>&1 | grep -E "Project|building|Simpro|pctx" | head`
Expected: design-lint passes; no `no-undef` for any new name. `httpsCallable` and `functions` are existing imports/consts (`pullJobDocsToDrive` already calls `httpsCallable(functions, …)`).

- [ ] **Step 6: Commit**

```bash
git add src/App.js
git commit -m "Projects UI: PROJECTS group on the Job Board, project page, Add Building with Simpro folder picker, breadcrumb + hops, Job Info Project section"
```

---

### Task 6: Simpro-number join guards (client + server) + Phase-1 server pieces

**Files:**
- Modify: `src/App.js` (join sites ≈ 38830, 43352, 46842, 48826, 61708)
- Modify: `functions/index.js` (`_needsDriveFolder` ≈ 5396; new export after `exports.weeklyCommercialDocPull` block ≈ 2899)
- Modify: `functions/fridayPacket.js` (≈ 481), `functions/foremanMeetingPrep.js` (≈ 234)

**Interfaces:**
- Consumes: `isSimproJoinable` (Task 1); `DOC_PROVIDERS.simpro.listFolders(no) → [{id, name}]` (existing, functions/index.js ≈ 2758).
- Produces: callable `listSimproJobFolders({simproNo}) → {folders:[{id,name}]}` (read-only).

- [ ] **Step 1: Client joins.** Apply each edit exactly:

| Where (search for) | Change to |
|---|---|
| `jobs.forEach(j => { if (j.simproNo) map[String(j.simproNo)] = j; });` | `jobs.forEach(j => { if (j.simproNo && isSimproJoinable(j)) map[String(j.simproNo)] = j; });` |
| `const matchedJob = jobs.find(j => String(j.simproNo\|\|"") === String(pid));` | `const matchedJob = jobs.find(j => isSimproJoinable(j) && String(j.simproNo\|\|"") === String(pid));` |
| `d.allLive.find(j => String(j.simproNo \|\| "").trim() === k)` | `d.allLive.find(j => isSimproJoinable(j) && String(j.simproNo \|\| "").trim() === k)` |
| `const ccFor = (no) => (jobs\|\|[]).find(j => String(j.simproNo\|\|"").trim() === String(no));` | `const ccFor = (no) => (jobs\|\|[]).find(j => isSimproJoinable(j) && String(j.simproNo\|\|"").trim() === String(no));` |
| `const m = _sb4Num(j.simproMargin), sp = _sb4Special(j.name);` | `const m = isSimproJoinable(j) ? _sb4Num(j.simproMargin) : null, sp = _sb4Special(j.name); // a shared Simpro # counts its margin once` |

Then sweep for any join this table missed:

Run: `grep -nE "find\(j *=> *[^)]*simproNo|\.simproNo\)\] *=|map\[String\(j\.simproNo" src/App.js`
Expected: every hit either already has `isSimproJoinable(` or is a single-job lookup by its own id (not a Simpro # → job join). Add the guard to any true join it lists, and note it in the commit message.

- [ ] **Step 2: Drive-folder guard.** In `functions/index.js` `_needsDriveFolder(job)`, add as the first line of the function body:

```js
  if (job.projectGroupId) return false; // Projects (spec 2026-10-15): a building's folder is made INSIDE its project folder (Phase 2), never at the top level
```

This covers both callers (the `ensureJobDriveFolder` trigger and the catch-up sweep, ≈ 5421 and 5536). Confirm with `grep -n "_needsDriveFolder(" functions/index.js`.

- [ ] **Step 3: Read-only folder list.** Directly after the `exports.weeklyCommercialDocPull = …;` statement, add:

```js
// Read-only: the attachment folder NAMES on one Simpro job — feeds the Add
// Building "Simpro folder" picker (Projects spec 2026-10-15 §6.2). No writes,
// no file contents; same open posture as getSimproJobBasics.
exports.listSimproJobFolders = functions.https.onCall(async (data) => {
  const no = String((data && data.simproNo) || "").replace(/^#/, "").trim();
  if (!/^\d+$/.test(no)) throw new functions.https.HttpsError("invalid-argument", "simproNo must be a Simpro job number");
  const folders = await DOC_PROVIDERS.simpro.listFolders(no);
  return { folders: (folders || []).filter(f => f && f.name).map(f => ({ id: f.id, name: f.name })) };
});
```

- [ ] **Step 4: Friday Packet guard.** In `functions/fridayPacket.js`, replace

```js
    activeJobs.forEach(j => { if (j.simproNo) jobBySimproNo.set(String(j.simproNo), j); });
```

with

```js
    // Projects (spec 2026-10-15 §6.3): buildings sharing one Simpro # → only the lead answers for it.
    const simproJoinable = (j) => !(j.projectGroupId && j.simproFolder) || !!j.simproLead;
    activeJobs.forEach(j => { if (j.simproNo && simproJoinable(j)) jobBySimproNo.set(String(j.simproNo), j); });
```

- [ ] **Step 5: Foreman prep guard.** In `functions/foremanMeetingPrep.js`, replace the two lines

```js
  const bySimpro = new Map(res.filter(j => j.simproNo).map(j => [snOf(j), j]));
  const byAnySimpro = new Map(live.filter(j => j.simproNo).map(j => [snOf(j), j]));   // any active job, for schedule labels
```

with

```js
  // Projects (spec 2026-10-15 §6.3): buildings sharing one Simpro # → only the lead answers for it.
  const simproJoinable = (j) => !(j.projectGroupId && j.simproFolder) || !!j.simproLead;
  const bySimpro = new Map(res.filter(j => j.simproNo && simproJoinable(j)).map(j => [snOf(j), j]));
  const byAnySimpro = new Map(live.filter(j => j.simproNo && simproJoinable(j)).map(j => [snOf(j), j]));   // any active job, for schedule labels
```

- [ ] **Step 6: Run the harness and the affected server dry-runs**

Run: `node scripts/projects-dryrun.js && node scripts/foremanprep-dryrun.js && node scripts/leadprep-test.js && node -e "require('./functions/fridayPacket.js'); require('./functions/foremanMeetingPrep.js'); console.log('modules load')"`
Expected: `projects-dryrun: N checks passed` (all sections), the existing dry-runs pass unchanged, and `modules load`. If `packet-dryrun.js` exists, run it too (`ls scripts | grep packet`).

- [ ] **Step 7: Commit**

```bash
git add src/App.js functions/index.js functions/fridayPacket.js functions/foremanMeetingPrep.js
git commit -m "Projects: a shared Simpro # joins only its lead building (client + Friday Packet + foreman prep); buildings never get a top-level Drive folder; read-only listSimproJobFolders"
```

---

### Task 7: SOP guides

**Files:**
- Create: `public/sops/projects.html`
- Modify: `public/sops/jobinfo.html`, `public/sops/planslinks.html`, `public/sops/commercialmode.html`
- Modify: `src/App.js`, adding a HelpDot to `ProjectSheet` (the SOP list itself is baked by prebuild from `public/sops/*.html`)

- [ ] **Step 1: Create `projects.html`.** Copy `public/sops/planslinks.html`'s `<head>…</head>` block verbatim (fonts + styles), change `<title>` to `Projects — Office &amp; Crew Guide`, and use this body:

```html
<body><div class="wrap">
<div class="kicker">Homestead Electric · Office &amp; Crew Guide</div>
<h1>Projects</h1>
<p class="sub">One job with several houses or buildings? A project keeps each building separate and still groups them.</p>
<div class="tldr"><h2>The short version</h2><p>A project is a folder of normal jobs. Each house or building is its own job with its own punch, questions, crew, POs and milestones. On the Job Board, projects sit in one folded <b>PROJECTS</b> group at the top.</p></div>

<h2 class="sec">Find a project's buildings</h2>
<div class="step"><div class="num">1</div><div class="body"><h3>Open PROJECTS on the Job Board</h3><p>Each project is one row: its name, how many houses, and how many are in rough or finish. Tap it to unfold.</p></div></div>
<div class="step"><div class="num">2</div><div class="body"><h3>Tap a building</h3><p>Every building opens a normal job card. Searching a building name or Simpro # opens the project by itself.</p></div></div>
<div class="step"><div class="num">3</div><div class="body"><h3>Hop between buildings</h3><p>Inside a building, the line at the top reads <b>PROJECT › BUILDING</b>. The two buttons under it jump to the previous and next building. Tap the project name for the project page.</p></div></div>

<h2 class="sec">Make a project (office)</h2>
<div class="step"><div class="num">1</div><div class="body"><h3>Job Info → Project → Make this a project</h3><p>Name it and tap Create project. The job you were on becomes the project's <b>Site / Shared</b> building and keeps everything it already had. Nothing is moved or deleted.</p></div></div>
<div class="step"><div class="num">2</div><div class="body"><h3>Add each building</h3><p>On the project page tap <b>+ Add Building</b>. Name it ("House 3"). If the buildings share one Simpro job, pick the building's <b>Simpro folder</b>; the list shows the folders Simpro actually has. If the folder isn't in Simpro yet you'll see a warning, and its plans wait in Shared / Unsorted until someone makes it. A building with its own Simpro # works like any job.</p></div></div>
<div class="step"><div class="num">3</div><div class="body"><h3>Pick its tabs</h3><p>Switch off the tabs that building doesn't need, the same switches as Job Sections. GC, address and foreman copy over from the project.</p></div></div>

<h2 class="sec">Good to know</h2>
<div class="call" style="background:#fff;border:1px solid var(--border)"><b>Shared Simpro #:</b> one building is the <b>Simpro lead</b>. Margins, timesheets and the Friday Packet count that Simpro job once, on the lead (or on Site / Shared).</div>
<div class="call" style="background:#fff;border:1px solid var(--border)"><b>Leave or archive:</b> taking a job out of a project, or archiving a project, never deletes a job or anything on it.</div>
<div class="call" style="background:#fff;border:1px solid var(--border)"><b>Coming next:</b> the project's own Drive folder, Project-wide plans (site and civil sheets every building sees) and plans routed to each building automatically.</div>
</div></body></html>
```

- [ ] **Step 2: Update the three existing guides** (same file style; add a section, don't restyle):
  - `jobinfo.html`: add a `<h2 class="sec">Milestones</h2>` section (+ Add on the folded header, type it, Add or Enter; stamped with your name and date; Remove then Undo; nothing pre-filled, no due dates) and a `<h2 class="sec">Project</h2>` section (what it shows; Make this a project; Leave project never deletes).
  - `planslinks.html`: replace any line saying blocks start open with: "Every block starts folded with a count on its header (Drive Plans · 14 files). Tap a header to open it. On a building in a project, Drive Plans names the building's folder, and Project-wide plans holds the sheets every building shares."
  - `commercialmode.html`: add "The 9 GC dates (temp power through final) moved to their own folded **GC Schedule Dates** section on Job Info. Same dates, same Forecast and Ufer reminders. **Milestones** is now an add-only list for field milestones like Blockouts in or UFR in."

- [ ] **Step 3: HelpDot on the project page.** In `ProjectSheet`, right after the project name `div`, add `<HelpDot section="projects" label="How projects work" color={PROJECT_COLOR}/>`. Check the exact HelpDot prop names first: `grep -n "<HelpDot section=" src/App.js | head -3`.

- [ ] **Step 4: Commit**

```bash
git add public/sops src/App.js
git commit -m "SOPs: new Projects guide; Job Info (Milestones, Project), Plans & Links (folded), Commercial (GC Schedule Dates)"
```

---

### Task 8: Version + FEATURES.md

**Files:** `public/service-worker.js`, `FEATURES.md`

- [ ] **Step 1: Next free SW version.** `git fetch origin main && git show origin/main:public/service-worker.js | head -1`. Set this branch's line 1 to one above it (e.g. `const CACHE = "homestead-v542";`). If main moves again before merge, renumber at merge time. The preview build uses whatever this branch has.

- [ ] **Step 2: FEATURES.md.** Update the "Last manifest update" line to today plus the new SW version, and add this entry at the top of the list:

```markdown
- **Projects: several houses on one job become one project — each building its own job, grouped on the Job Board; add-only field milestones on every job; Plans & Links starts folded** · `in-flight 2026-10-15` · `SW v542` · `ProjectsCtx` · `ProjectSheet` · `AddBuildingForm` · `SimproFolderPicker` · `FieldMilestones` · `FoldSection` · `functions:listSimproJobFolders` · Meeting 2026-10-14 (Fratto Farms). **Projects:** a project is a `/projects` record grouping normal jobs via `projectGroupId`; the Job Board shows one folded PROJECTS group (buildings leave the stage groups, nothing shown twice); project page with buildings first, + Add Building (Simpro folder picker from the job's real Simpro folders, own-number option, Job Sections toggles), folded Project info; breadcrumb + labeled hops inside a building; Job Info → Project (Make this a project → the job becomes Site / Shared, nothing moved). A shared Simpro # joins only its lead building (client lookups, Scoreboard margin, Friday Packet, foreman prep). **Milestones:** add-only, starts empty, stamped who + date, Remove + Undo; commercial's 9 GC dates moved to a folded GC Schedule Dates section (same data, Forecast + Ufer reminders unchanged). **Plans & Links:** every block folded with a count. **Why it won't lose data:** new job fields live inside `data` (loader passes them through); milestones are id'd items so the save transaction's three-way merge keeps two phones' adds; `/projects` is a new additive collection (create/update validated like `/needs`, delete denied); buildings never get a top-level Drive folder (`_needsDriveFolder` guard); nothing is ever deleted. Deploy: rules (`projects`) + functions (`ensureJobDriveFolder`, `listSimproJobFolders`, `fridayPacket`, `foremanMeetingPrep`). Phase 2 (project Drive folders + plan routing) is separate.
```

- [ ] **Step 3: Full build — the real gate**

Run: `CI=true npm run build` (do NOT pipe it)
Expected: exit 0. Prebuild runs `projects-dryrun.js`, tdz-scan, design-lint and every existing test.

- [ ] **Step 4: Commit**

```bash
git add public/service-worker.js FEATURES.md src/App.js
git commit -m "Projects + field milestones (SW v542)"
```

---

### Task 9: Verification before anything leaves this Mac

**Files:** none (any fixes get their own commits).

- [ ] **Step 1: Data-shape audit.** Run the `firestore-data-shape-audit` skill on the loader and every job write path in the vault note *Data-Shape Gotchas*. Confirm: (a) all new fields live in `data` and reach components through the loader spread; (b) `normalizeJob` spreads `...raw`, so they survive the merge's normalization; (c) `fieldMilestones` writes go only through `u()` → `saveJob`. Record the result in the PR/handoff notes.

- [ ] **Step 2: Local preview of the production build.** Serve `build/` with `.claude/build-server.js` (memory: iCloud eviction; materialize first if the build stalls). Open it in the browser pane. Sign-in needs Koy's PIN, which is **Koy's step**. Without it, verify everything reachable signed-out and the console. Then hand Koy the click-through list from Step 3.

- [ ] **Step 3: Click-through checklist** (phone width 375 and desktop; this is the list Koy and the preview walk):
  1. Plans & Links: 4 folded headers with counts; Drive count fills in; opening each block works; no "Create Drive folder" on a building.
  2. A resi job: Milestones folded "none yet"; + Add opens it and focuses; Enter adds; entry shows name + M/D/YYYY; Remove then Undo; reopen the job and the entry is still there.
  3. A commercial job: GC Schedule Dates (MOVED) shows the same 9 dates; Milestones add-only below it.
  4. Job Info → Project → Make this a project on a **ZZ test job only**: project created; job renamed "<name> · Site / Shared"; PROJECTS group appears on the Job Board.
  5. + Add Building ×2 (one shared without a Simpro #, one own-number blank); double-tap Create makes one job; the new jobs show only under PROJECTS, not in the stage groups.
  6. Breadcrumb + hops move between buildings; the project name opens the project page; ‹ Job Board closes it.
  7. Search "ZZ" opens the group by itself.
  8. Leave project on one building: it returns to a normal row; nothing lost.
  9. Archive project: the group disappears; the buildings show as normal rows.
  10. No console errors; design-lint and the build are green.

- [ ] **Step 4: Request code review.** Use superpowers:requesting-code-review on the whole branch diff (`git diff origin/main...HEAD`). Fix anything real, re-run Task 8, Step 3.

---

### Task 10: Koy-gated release steps (STOP at every arrow until Koy says yes in chat)

- [ ] **Step 1: Show Koy the full diff + a two-line summary per file** (memory rule: full diff before any one-paste). Wait for his OK.

- [ ] **Step 2 (Koy OK required): Deploy rules + the four functions.**

```bash
cd /Users/koyhomestead/he-worktrees/projects-milestones
firebase deploy --only firestore:rules --project homestead-electric
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:ensureJobDriveFolder,functions:listSimproJobFolders,functions:fridayPacket,functions:foremanMeetingPrep --project homestead-electric
```

Before running, confirm the exact exported names of the Friday Packet and foreman-prep functions with `grep -n "^exports\.\(friday\|foreman\|sendTestForeman\)" functions/index.js` and deploy every export that wraps those two modules. Expected: `Deploy complete!` for both.

- [ ] **Step 3 (Koy OK required): Push the branch → Vercel preview.**

```bash
git push -u origin feat/projects-milestones
```

The pre-push hook runs the full CI build. Vercel builds the preview automatically. Get its URL with the Vercel MCP `list_deployments` (projectId `prj_oeaUQzuojQ2eTFTLfK5zTLPRcKMo`, teamId `team_tb4zfA6iiZ2Q6v4Noe4ivIt3`, branch `feat/projects-milestones`) and wait for `READY`.

- [ ] **Step 4: Koy makes the Share link** in the Vercel dashboard for that deployment (Share button). It bypasses Vercel login for that one deployment, without changing project settings. That's his account action. Give him the dashboard URL (`inspectorUrl`).

- [ ] **Step 5 (with Koy): Set up "ZZ Preview – Projects Test"** on the preview: pick or create a **test job with no Simpro #** → Make this a project → add 3 buildings. Bosses get the Share link plus a two-line note: "Click anything inside ZZ Preview – Projects Test. It's live data, so stay out of real jobs."

- [ ] **Step 6: Afterwards.** Archive the ZZ project and archive its building jobs through the app's normal archive action. Never delete. Then the vault log and crew brief per CLAUDE.md, when the work ships to `main` (merge is a separate Koy-approved step after the bosses review).

---

## Self-Review (done while writing)

- **Spec coverage:**
  - §4 Plans & Links → Task 3.
  - §5 milestones + GC Schedule Dates → Task 2.
  - §6.1 data → Tasks 1 and 4.
  - §6.2 screens → Task 5.
  - §6.3 Simpro lead → Task 6 (job flag, deviation 2).
  - §6.4 Drive layout / routing / Plan Intake / folder creation inside the project → **Phase 2** by design; Phase 1 only guards (Task 6, Step 2) and explains (Task 3, Step 1).
  - §6.5 conversion → Task 5 (`JobProjectSection`); the Drive move is Phase 2.
  - §7 preview → Task 10.
  - §9 data safety → Global Constraints + Task 1 merge cases + Task 9, Step 1.
  - §10 testing → Tasks 1, 6, 8, 9.
  - §11 docs → Tasks 7 and 8.
  - Project-wide plans block → Task 3 (placeholder text until Phase 2 makes the folder).
- **Type consistency:**
  - `simproFolder` / `simproLead` / `projectRole` / `projectGroupId` are spelled the same in every task.
  - ctx members (`projects, allJobs, identity, canManage, saveNewProject, patchProject, createBuilding, openProject, openJob`) are defined in Task 4, Step 3 and used with those names in Task 5.
  - `createBuilding(project, {name, shareSimpro, simproFolder, ownSimproNo, hiddenSections})` matches between Task 4 and `AddBuildingForm`.
- **Review Focus → tests:**
  - 1 → Task 1 §4 merge cases.
  - 2 → Task 1 §1 + §5.
  - 3 → Task 1 §2 split cases.
  - 4 → `SimproFolderPicker` fallback + Task 9, Step 3 item 5.
  - 5 → `busy` guard + Task 9, Step 3 item 5.
