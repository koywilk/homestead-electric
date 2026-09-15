# My Day: Head Owns Auto-Tasks + Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foremen stop receiving auto-generated office tasks on My Day; the Head of Residential sees every auto-task and can Push one to a person, then verify when they mark it done.

**Architecture:** Everything lives in `src/App.js` (single-file CRA app, house pattern). New pure helpers sit next to the existing My Day helpers (~L51562) and are extracted verbatim by `scripts/needs-dryrun.js` (prebuild gate). Delegation is one `needs` doc per pushed auto-task carrying a new additive `autoTaskId`; the head's board joins docs back to auto rows at render time (nothing stored on jobs for the push itself). Spec: `docs/superpowers/specs/2026-09-15-myday-head-owns-auto-tasks-design.md`.

**Tech Stack:** React (CRA), Firestore via the existing `saveNeed` / `patchNeed` / `updateJob` funnels, Node `vm` test harness (`scripts/needs-dryrun.js`), `CI=true npm run build`.

## Global Constraints

- **Commit locally per task on this worktree branch; NEVER push.** Koy pushes via the final one-paste (merge --ff-only + push). Commit message format: `<title> (SW v408)` + body + `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not `git stash`, `git checkout`, or `git restore` (parallel-session rule). Never `git add` the untracked `.claude/` folder.
- Work only in this worktree: `/Users/koyhomestead/Desktop/homestead-electric/.claude/worktrees/objective-visvesvaraya-7a3368` (branch `claude/sharp-margulis-7c8590`, already fast-forwarded to `origin/main` at v407).
- SW cache bump `homestead-v407` → `homestead-v408` (Task 1). The prebuild gate (`scripts/version-from-sw.js`) FAILS any build whose SW version is not mentioned in `FEATURES.md`, so the FEATURES entry lands in Task 1 too.
- Never pipe the build (`npm run build | tail` masks failures). Always `CI=true npm run build > <log> 2>&1; echo EXIT $?`.
- No emojis in UI; use `<Icon name="..."/>` (registry `ICON_PATHS`). Icons used here already exist: `check`, `clock`, `chevronRight`, `users`, `arrowRight`, `rotateCw`.
- Mobile/desktop parity: every new control must work at 375px width (the `narrow` flag in `MyDay`).
- Every persistent job edit goes through `onUpdateJob(nextJob, patch)` (= `updateJob`), every need write through `onSaveNeed` / `onPatchNeed` (= `saveNeed` / `patchNeed`). Never `setDoc` directly from `MyDay`.
- One `u()`/`onUpdateJob` call per user action on `panelizedLighting`-style whole maps (`clearedTasks`, `taskDueDates`): build the next array/map, write once.
- `autoTaskId` is the ONLY new persisted field. It lives inside the need doc's `data` (the needs loader returns `data` verbatim). No Firestore rules change, no Cloud Functions change, no jobs-loader change.
- Names compare with `sameName(a, b)`; the head is `resiHead(users)` / `resiHeadName(users)` — never a literal name.
- Colors from `C` (`C.blue #3B5BA5`, `C.green`, `C.dim`, `C.orange`, `C.border`, `C.card`, `C.surface`). No yellow/amber.

---

### Task 1: Ship scaffolding — SW bump + FEATURES.md entry (gates green)

**Files:**
- Modify: `public/service-worker.js:1`
- Modify: `FEATURES.md` (insert directly ABOVE the line starting `- **My Day** (\`myday\`) · \`shipped 2026-09-09\` · \`SW v398\``, currently line 14)

**Interfaces:**
- Produces: a working tree where `node scripts/version-from-sw.js` passes for v408, so every later task can run the gates.

- [ ] **Step 1: Bump the SW cache**

```bash
sed -i '' 's/const CACHE = "homestead-v407";/const CACHE = "homestead-v408";/' public/service-worker.js && head -1 public/service-worker.js
```
Expected: `const CACHE = "homestead-v408";`

- [ ] **Step 2: Add the FEATURES.md entry**

Insert this single line above the existing My Day entry (keep it one line; FEATURES.md entries are one line each):

```markdown
- **My Day — the head owns every auto-task; Push delegates** · `shipped 2026-09-15` · `SW v408` · Koy: *"it is flooded with tasks that don't really make sense for the foremans… all of them flow through me… a button or option to push task to job foreman or pick a person."* **Who sees what:** foremen no longer get auto rows at all — Mine = task docs on them ∪ their punch items; the Head of Residential (`resiHead`) gets EVERY non-prep auto-task on every live job (`headAutoTasks`), plus task docs, punch, and stage duties; lanes unchanged. **Push:** each head auto row has `→ <job foreman>` (one tap) and `Pick person…` (roster). Pushing writes ONE `needs` doc through `saveNeed` (`autoTaskDoc`: kind task, the rule's title/desc/job/due, assignedTo, assignedBy = head, and the new additive **`autoTaskId`**). The delegate sees an ordinary task in Mine and gets the existing `need_assigned` push. The head row then reads its state from the doc (`autoDelegation` join, never stored): **with X · age** (Take back / Re-push) → when X marks it Done, **done by X · verify** (Koy chose verify-before-clear) with Done (existing `clearedTasks` clear) and Send back (reopens the doc to X). One open doc per auto-task: pushing again reassigns via `patchNeed`, never a second doc. Head Done with an open doc closes the doc too (`doneBy` head). **Duplicates folded:** the duties engine's Rough/Finish QC walk and start-PO rows win over the task engine's `_qc_walk` / `_final_qc_walk` / `_rough_po` / `_finish_po` twins on the head board (`foldDutyTwins`; neither engine changed). **Foreman's "On Koy":** collapsed to one line per job — *"Koy has N things on this job"* — opening to the read-only rows plus **+ Add for Koy** (Quick-add preset with job + To: head; `NeedQuickAdd` now honours `preset.assignedTo`). Harness `scripts/needs-dryrun.js` gains sections 8–12 (foreman zero auto rows, head all, twins, autoTaskDoc shape, delegation states + reassign-not-duplicate). Guides `myday.html` + `needs.html` updated. No rules / functions / loader change. **Why it won't lose data:** one additive field (`autoTaskId`) inside the need doc's `data`; auto-task Done/Snooze keep the existing whole-map `clearedTasks` / `taskDueDates` precedents (one `updateJob` per tap); foremen lose ROWS only — no doc, field, or job value is deleted or renamed; Push/Take back/Send back are ordinary `saveNeed` / `patchNeed` writes with version snapshots via the ledger.
```

- [ ] **Step 3: Run the gates**

```bash
node scripts/version-from-sw.js && node scripts/needs-dryrun.js
```
Expected: `version-from-sw: baked homestead-v408`, `no-undef gate clean`, `needs-dryrun ok`.

- [ ] **Step 4: Commit**

```bash
git add public/service-worker.js FEATURES.md docs/superpowers/specs/2026-09-15-myday-head-owns-auto-tasks-design.md docs/superpowers/plans/2026-09-15-myday-head-owns-auto-tasks.md && git commit -m "My Day v408 scaffolding: SW bump + FEATURES entry + spec/plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers — `headAutoTasks`, `autoDelegation`, `autoRowState`, `autoTaskDoc`, `foldDutyTwins` (+ harness sections 8–12)

**Files:**
- Modify: `src/App.js` — insert a new block immediately AFTER the `myJobsFor` function (it ends with `return (jobs || []).filter(j => j && !j.tempPed && matchesForeman(j, fmName));\n}` around L51655) and BEFORE the `// ── MY DAY ───` banner comment.
- Modify: `scripts/needs-dryrun.js` — extend `FN`, add extraction of `computeTasks` dependencies is NOT needed (we pass auto rows as plain objects); append sections 8–12 before the final `console.log("needs-dryrun ok")`.

**Interfaces:**
- Consumes: `sameName`, `needAssignee`, `dueBucketFromDate`, `localYmd`, `parseAnyDate` (a `const` arrow at ~L32248), `computeTasks` (App.js, runtime only).
- Produces (exact signatures, all top-level functions in App.js):
  - `headAutoTasks(jobs, cleared) → Task[]` — every `computeTasks` row with `category !== "prep"` on jobs that are not `tempPed` / `quickJob`, excluding ids in the `cleared` Set.
  - `autoDelegation(needs) → Map<autoTaskId, needDoc>` — per auto-task id the winning doc: an open doc beats a done one; among equals the newest `assignedAt || createdAt` wins.
  - `autoRowState(t, delegation, headName) → { state: "none"|"with"|"verify", doc, who }`.
  - `autoTaskDoc(t, job, assignee, me, nowIso, id) → needDoc` — the exact doc Push writes.
  - `foldDutyTwins(autoTasks, dutyKeys) → Task[]` — drops auto rows whose id is `<jobId>_qc_walk` / `_final_qc_walk` / `_rough_po` / `_finish_po` when `dutyKeys` (a Set of `<jobId>_coord_rough_qc` etc.) holds the twin.
  - `AUTO_DUTY_TWINS` — the id-suffix map used by `foldDutyTwins`.

- [ ] **Step 1: Write the failing harness sections**

Append to `scripts/needs-dryrun.js` right BEFORE `console.log("needs-dryrun ok");`:

```js
// ── 8. head owns every auto-task; foremen none ──────────────────────────────
const autoA = { id:"j1770_rough_po", jobId:"j1770", jobName:"#1770 England Home", category:"po", foreman:"Gage", title:"Order Job Start PO", desc:"", dueDate:"2026-09-10" };
const autoB = { id:"j1937_qc_walk", jobId:"j1937", jobName:"#1937 Navarro Residence", category:"qc", foreman:"Daegan", title:"Schedule QC Walk", desc:"Rough hit 100%", dueDate:"" };
const autoPrep = { id:"j1770_prep", jobId:"j1770", jobName:"#1770 England Home", category:"prep", foreman:"Koy Wilkinson", title:"Pre Job Prep", desc:"", dueDate:"" };
const autoTP = { id:"tp1_rough_po", jobId:"tp1", jobName:"Temp ped", category:"po", foreman:"Gage", title:"Order Job Start PO", desc:"", dueDate:"" };
const fakeCompute = () => [autoA, autoB, autoPrep, autoTP];
const jobsWithTP = [england, navarro, { id:"tp1", name:"Temp ped", tempPed:true, foreman:"Gage" }];
eq(H.headAutoTasks(jobsWithTP, new Set(), fakeCompute).map(t => t.id), ["j1770_rough_po","j1937_qc_walk"], "head: every non-prep auto row on live jobs, tempPed dropped");
eq(H.headAutoTasks(jobsWithTP, new Set(["j1937_qc_walk"]), fakeCompute).map(t => t.id), ["j1770_rough_po"], "cleared ids are excluded");
eq(H.headAutoTasks(null, new Set(), fakeCompute), [], "null jobs -> []");

// ── 9. duty twins fold ──────────────────────────────────────────────────────
const dutyKeys = new Set(["j1937_coord_rough_qc"]);
eq(H.foldDutyTwins([autoA, autoB], dutyKeys).map(t => t.id), ["j1770_rough_po"], "qc_walk twin hidden when the duty exists");
eq(H.foldDutyTwins([autoA, autoB], new Set()).map(t => t.id), ["j1770_rough_po","j1937_qc_walk"], "no duty -> nothing folded");
eq(H.foldDutyTwins([{ ...autoA, id:"j1770_finish_po" }], new Set(["j1770_coord_finish_po"])), [], "finish PO twin folds too");
eq(H.foldDutyTwins([{ ...autoA, id:"j1770_rough_deposit" }], new Set(["j1770_coord_rough_po"])).length, 1, "non-twin ids untouched");

// ── 10. the doc Push writes ─────────────────────────────────────────────────
const NOW = "2026-09-15T15:00:00.000Z";
const docA = H.autoTaskDoc(autoA, { ...england, taskDueDates: {} }, "Gage Lund", "Koy Wilkinson", NOW, "need_fixed1");
eq(docA, { id:"need_fixed1", kind:"task", text:"Order Job Start PO", plan:"", dueBucket: H.dueBucketFromDate("2026-09-10", new Date(NOW)) || "week", dueDate:"2026-09-10", snoozedUntil:"",
  assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", assignedAt:NOW, foreman:"Gage", jobId:"j1770", jobName:"#1770 England Home",
  status:"open", createdBy:"Koy Wilkinson", createdAt:NOW, doneAt:"", doneBy:"", autoTaskId:"j1770_rough_po" }, "exact Push doc shape (autoTaskId is the only new key)");
eq(H.autoTaskDoc(autoA, { ...england, taskDueDates: { j1770_rough_po: "2026-09-20" } }, "Gage Lund", "Koy Wilkinson", NOW, "x").dueDate, "2026-09-20", "the head's snoozed date wins over the rule's date");
eq(H.autoTaskDoc({ ...autoB, dueDate:"9/12/2026" }, navarro, "Daegan", "Koy Wilkinson", NOW, "x").dueDate, "2026-09-12", "M/D/YYYY rule dates normalise to YYYY-MM-DD");
eq(H.autoTaskDoc(autoB, navarro, "Daegan", "Koy Wilkinson", NOW, "x").dueBucket, "week", "no date -> week bucket, never today");
assert.ok(/^need_\d+_[a-z0-9]{5}$/.test(H.autoTaskDoc(autoB, navarro, "Daegan", "Koy Wilkinson", NOW).id), "default id matches the quick-add id shape");

// ── 11. delegation join + row state ─────────────────────────────────────────
const dOpen = { id:"n10", autoTaskId:"j1770_rough_po", status:"open", assignedTo:"Gage Lund", assignedAt:"2026-09-15T15:00:00.000Z", createdAt:"2026-09-15T15:00:00.000Z" };
const dDone = { id:"n11", autoTaskId:"j1937_qc_walk", status:"done", assignedTo:"Daegan", doneBy:"Daegan", assignedAt:"2026-09-14T15:00:00.000Z", createdAt:"2026-09-14T15:00:00.000Z" };
const dOld  = { id:"n12", autoTaskId:"j1770_rough_po", status:"done", assignedTo:"Gage Lund", doneBy:"Gage Lund", assignedAt:"2026-09-10T15:00:00.000Z", createdAt:"2026-09-10T15:00:00.000Z" };
const dHeadDone = { id:"n13", autoTaskId:"j9_x", status:"done", assignedTo:"Gage Lund", doneBy:"Koy Wilkinson", assignedAt:"2026-09-10T15:00:00.000Z", createdAt:"2026-09-10T15:00:00.000Z" };
const del = H.autoDelegation([dOld, dOpen, dDone, dHeadDone, { id:"plain", text:"no backlink", status:"open" }]);
eq([...del.keys()].sort(), ["j1770_rough_po","j1937_qc_walk","j9_x"], "join keyed by autoTaskId; plain docs ignored");
eq(del.get("j1770_rough_po").id, "n10", "open doc beats an older done doc");
eq(H.autoRowState(autoA, del, "Koy Wilkinson"), { state:"with", doc:dOpen, who:"Gage Lund" }, "open doc -> with X");
eq(H.autoRowState(autoB, del, "Koy Wilkinson"), { state:"verify", doc:dDone, who:"Daegan" }, "done by delegate -> verify");
eq(H.autoRowState({ id:"j9_x" }, del, "Koy Wilkinson"), { state:"none", doc:dHeadDone, who:"" }, "done by the head -> none (already cleared)");
eq(H.autoRowState({ id:"nope" }, del, "Koy Wilkinson"), { state:"none", doc:null, who:"" }, "no doc -> none");
eq(H.autoDelegation(null).size, 0, "null-safe");

// ── 12. newest wins among equals ────────────────────────────────────────────
const two = H.autoDelegation([{ id:"a", autoTaskId:"k", status:"open", assignedAt:"2026-09-01T00:00:00.000Z" }, { id:"b", autoTaskId:"k", status:"open", assignedAt:"2026-09-02T00:00:00.000Z" }]);
eq(two.get("k").id, "b", "two open docs (should not happen) -> newest assignedAt wins");
```

Also extend the extraction list. Change:

```js
const FN = ["localYmd","sameName","needKind","needAssignee","needForeman","dueBucketFromDate",
  "isSnoozed","needIsOpen","resiHead","resiHeadName","defaultAssigneeFor","isMine","onHead","headQueue",
  "punchAssignedTo","myJobsFor"];
```
to:
```js
const FN = ["localYmd","sameName","needKind","needAssignee","needForeman","dueBucketFromDate",
  "isSnoozed","needIsOpen","resiHead","resiHeadName","defaultAssigneeFor","isMine","onHead","headQueue",
  "punchAssignedTo","myJobsFor","headAutoTasks","autoDelegation","autoRowState","autoTaskDoc","foldDutyTwins"];
```
and in `combined`, after `extractConst("matchesForeman"),` add:
```js
  extractConst("parseAnyDate"),
  extractConst("AUTO_DUTY_TWINS"),
```

- [ ] **Step 2: Run the harness to see it fail**

```bash
node scripts/needs-dryrun.js
```
Expected: throws `extract: "function headAutoTasks(" not found in App.js`.

- [ ] **Step 3: Add the helpers to App.js**

Insert after the closing `}` of `myJobsFor` (search for the exact line `  return (jobs || []).filter(j => j && !j.tempPed && matchesForeman(j, fmName));` then the `}` that follows):

```js
// ── MY DAY delegation helpers (v408: the head owns every auto-task) ─────────
// Koy, 2026-09-15: "it is flooded with tasks that don't really make sense for
// the foremans… all of them flow through me… a button or option to push task
// to job foreman or pick a person." Foremen get NO auto rows; the Head of
// Residential gets all of them and PUSHES one by writing an ordinary `needs`
// task doc that carries `autoTaskId` (the only new field). The head board joins
// docs back to auto rows at render (autoDelegation) — nothing stored on jobs.
// Verify-before-clear (Koy's choice): a doc the delegate closed shows as
// "done by X · verify" until the head clears the auto-task itself.
// Pure — extracted verbatim by scripts/needs-dryrun.js.
function headAutoTasks(jobs, cleared, compute = computeTasks) {
  const live = (jobs || []).filter(j => j && !j.tempPed && !j.quickJob);
  if (!live.length) return [];
  const liveIds = new Set(live.map(j => j.id));
  return compute(live).filter(t => t && t.category !== "prep" && liveIds.has(t.jobId) && !(cleared && cleared.has(t.id)));
}
// The task-engine ids that say the same thing as a duties-engine row. The duty
// row wins on the head board (it has the Mark-sent field + the tab jump).
const AUTO_DUTY_TWINS = { _qc_walk: "_coord_rough_qc", _final_qc_walk: "_coord_finish_qc", _rough_po: "_coord_rough_po", _finish_po: "_coord_finish_po" };
function foldDutyTwins(autoTasks, dutyKeys) {
  const keys = dutyKeys || new Set();
  return (autoTasks || []).filter(t => {
    if (!t || !t.jobId) return true;
    for (const suffix in AUTO_DUTY_TWINS) {
      if (t.id === t.jobId + suffix && keys.has(t.jobId + AUTO_DUTY_TWINS[suffix])) return false;
    }
    return true;
  });
}
// Per auto-task id, the doc that describes its delegation: an OPEN doc beats a
// done one; among equals the newest assignedAt/createdAt wins. Docs without
// autoTaskId (hand-typed tasks) are ignored.
function autoDelegation(needs) {
  const m = new Map();
  for (const n of needs || []) {
    if (!n || !n.autoTaskId) continue;
    const cur = m.get(n.autoTaskId);
    if (!cur) { m.set(n.autoTaskId, n); continue; }
    const nOpen = n.status !== "done", cOpen = cur.status !== "done";
    if (nOpen !== cOpen) { if (nOpen) m.set(n.autoTaskId, n); continue; }
    const nAt = String(n.assignedAt || n.createdAt || ""), cAt = String(cur.assignedAt || cur.createdAt || "");
    if (nAt > cAt) m.set(n.autoTaskId, n);
  }
  return m;
}
// What the head's row should show for auto-task `t`.
function autoRowState(t, delegation, headName) {
  const doc = (delegation && t && delegation.get(t.id)) || null;
  if (!doc) return { state: "none", doc: null, who: "" };
  if (doc.status !== "done") return { state: "with", doc, who: needAssignee(doc) };
  if (doc.doneBy && !sameName(doc.doneBy, headName)) return { state: "verify", doc, who: doc.doneBy };
  return { state: "none", doc, who: "" };
}
// The exact doc Push writes — same shape NeedQuickAdd.save() builds, plus
// autoTaskId. Due date: the head's snoozed date (taskDueDates) wins, else the
// rule's date, normalised to YYYY-MM-DD; no date → "week", never "today".
function autoTaskDoc(t, job, assignee, me, nowIso, id) {
  const raw = (job && job.taskDueDates && job.taskDueDates[t.id]) || t.dueDate || "";
  const d = raw ? parseAnyDate(raw) : null;
  const dueDate = d ? localYmd(d) : "";
  return {
    id: id || ("need_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
    kind: "task", text: t.title || "(auto task)", plan: t.desc || "",
    dueBucket: dueDate ? (dueBucketFromDate(dueDate, new Date(nowIso)) || "week") : "week",
    dueDate, snoozedUntil: "",
    assignedTo: assignee || "", assignedBy: me, assignedAt: nowIso,
    foreman: (job && job.foreman) || t.foreman || "",
    jobId: t.jobId || "", jobName: t.jobName || (job && job.name) || "",
    status: "open", createdBy: me, createdAt: nowIso, doneAt: "", doneBy: "",
    autoTaskId: t.id,
  };
}
```

Check the second parameter of `dueBucketFromDate` first:

```bash
sed -n "$(grep -n '^function dueBucketFromDate' src/App.js | cut -d: -f1),+8p" src/App.js
```
If its signature is `(ymd, now)` with `now` a Date, the code above is right. If it takes no `now`, drop the second argument in BOTH the helper and harness section 10.

- [ ] **Step 4: Run the harness**

```bash
node scripts/needs-dryrun.js && node scripts/version-from-sw.js
```
Expected: `needs-dryrun ok`, `no-undef gate clean`. If `parseAnyDate` extraction fails with "not found", confirm it is declared `const parseAnyDate = (str) => {` (it is at ~L32248) — `extractConst` needs that exact prefix.

- [ ] **Step 5: Hand-off note**

Report the harness count and that `headAutoTasks` keeps the injectable `compute` param for tests only (App.js callers never pass it).

---

### Task 3: MyDay — foremen lose auto rows, the head gets them all, with Push / Take back / Re-push / Verify

**Files:**
- Modify: `src/App.js` — `MyDay` component (starts `function MyDay({ identity, users = [], jobs = [], needs = [], onPatchNeed, ...`), the mount at `<MyDay identity={identity} ...` (~L57563).

**Interfaces:**
- Consumes: Task 2 helpers; `saveNeed(need)` and `patchNeed(id, patch, current)` from the app root.
- Produces: `MyDay` accepts a new prop `onSaveNeed`; row objects gain optional `state`, `who`, `age`, `actions: [{label, title, onClick, tone}]` used by `Row`.

- [ ] **Step 1: Pass `saveNeed` into MyDay**

At the mount (~L57563) change
```jsx
          onPatchNeed={patchNeed} onOpenJob={openJobById} onTogglePunch={togglePunchItemDone} onUpdateJob={updateJob}
```
to
```jsx
          onPatchNeed={patchNeed} onSaveNeed={saveNeed} onOpenJob={openJobById} onTogglePunch={togglePunchItemDone} onUpdateJob={updateJob}
```
and the signature to
```js
function MyDay({ identity, users = [], jobs = [], needs = [], onPatchNeed, onSaveNeed, onOpenJob, onTogglePunch, onUpdateJob, onGoHome, onOpenCrew, onOpenBoard, openQuickAdd, canCreate = false, canBoard = false }) {
```

- [ ] **Step 2: Replace the auto-row block**

Replace this whole block inside `MyDay`:
```js
  if (myTitle === "foreman" || iAmHead) {
    computeTasks(jobs || []).filter(t => t.category !== "prep" && sameName(t.foreman, me) && !cleared.has(t.id)).forEach(t => {
      const job = jobById(t.jobId);
      mineRows.push({ key: "auto_" + t.id, kind: "auto", bucket: autoBucket(t), title: t.title, tag: "Auto", tagColor: C.dim,
        sub: [t.jobName, t.desc].filter(Boolean), jobId: t.jobId, section: null, canDone: !!job, canSnooze: !!job,
        onDone: () => { if (!job) return; const prev = job.clearedTasks || []; const next = [...prev, t.id]; onUpdateJob({ ...job, clearedTasks: next }, { clearedTasks: next }); stage("Cleared", () => onUpdateJob({ ...job, clearedTasks: prev }, { clearedTasks: prev })); },
        onSnooze: (ymd) => { if (!job) return; const prev = { ...(job.taskDueDates || {}) }; const next = { ...prev, [t.id]: ymd }; onUpdateJob({ ...job, taskDueDates: next }, { taskDueDates: next }); stage("Snoozed", () => onUpdateJob({ ...job, taskDueDates: prev }, { taskDueDates: prev })); } });
    });
  }
```
(verify the exact current text with `grep -n 'myTitle === "foreman" || iAmHead' src/App.js` and read through the closing `}` of the `if`) with:

```js
  // v408: auto-tasks are the HEAD's, all of them. Foremen see none (Koy: they
  // "don't really make sense for the foremans"). Each head row carries its
  // delegation state from the joined task doc (autoDelegation).
  const [pushFor, setPushFor] = useState(null);   // auto-task id whose "Pick person" list is open
  const roster = (users || []).filter(u => u && u.name && u.active !== false && getAccess(u) !== "contractor").map(u => u.name).sort();
  const delegation = autoDelegation(needs);
  const nowIso = () => new Date().toISOString();
  const pushTo = (t, job, who) => {
    if (!who) return;
    const cur = delegation.get(t.id);
    if (cur && cur.status !== "done") { onPatchNeed(cur.id, { assignedTo: who }, cur); }
    else if (onSaveNeed) { onSaveNeed(autoTaskDoc(t, job, who, me, nowIso())); }
    setPushFor(null);
    toast.success(`Pushed to ${first(who)}`);
  };
  const clearAuto = (t, job, openDoc) => {
    const prev = job.clearedTasks || []; const next = [...prev, t.id];
    onUpdateJob({ ...job, clearedTasks: next }, { clearedTasks: next });
    // An open delegate doc is closed with the head as doneBy so it leaves their board too.
    if (openDoc && openDoc.status !== "done") onPatchNeed(openDoc.id, { status: "done", doneAt: nowIso(), doneBy: me }, openDoc);
    stage("Cleared", () => { onUpdateJob({ ...job, clearedTasks: prev }, { clearedTasks: prev }); if (openDoc && openDoc.status !== "done") onPatchNeed(openDoc.id, { status: "open", doneAt: "", doneBy: "" }, openDoc); });
  };
  if (iAmHead) {
    const dutyKeys = new Set((jobs || []).filter(j => j && !j.tempPed && !j.quickJob).flatMap(getCoordinatorDuties).map(d => d.jobId + "_" + d.id));
    foldDutyTwins(headAutoTasks(jobs, cleared), dutyKeys).forEach(t => {
      const job = jobById(t.jobId); if (!job) return;
      const st = autoRowState(t, delegation, headName);
      const fm = job.foreman && !sameName(job.foreman, me) ? job.foreman : "";
      const row = { key: "auto_" + t.id, kind: "auto", bucket: autoBucket(t), title: t.title, tag: "Auto", tagColor: C.dim,
        sub: [t.jobName, t.desc].filter(Boolean), jobId: t.jobId, section: null, canSnooze: true,
        onSnooze: (ymd) => { const prev = { ...(job.taskDueDates || {}) }; const next = { ...prev, [t.id]: ymd }; onUpdateJob({ ...job, taskDueDates: next }, { taskDueDates: next }); stage("Snoozed", () => onUpdateJob({ ...job, taskDueDates: prev }, { taskDueDates: prev })); },
        state: st.state, who: st.who, age: st.doc ? timeAgo(st.state === "verify" ? st.doc.doneAt : (st.doc.assignedAt || st.doc.createdAt)) : "",
        pushOpen: pushFor === t.id, roster, onPick: (who) => pushTo(t, job, who), onTogglePick: () => setPushFor(p => p === t.id ? null : t.id) };
      if (st.state === "none") {
        row.canDone = true; row.onDone = () => clearAuto(t, job, null);
        row.actions = [
          ...(fm ? [{ label: `→ ${first(fm)}`, title: `Push to ${fm}, this job's foreman`, onClick: () => pushTo(t, job, fm), tone: "primary" }] : []),
          { label: "Pick person", title: "Push to someone else", onClick: row.onTogglePick, tone: "ghost" },
        ];
      } else if (st.state === "with") {
        row.canDone = true; row.onDone = () => clearAuto(t, job, st.doc);
        row.actions = [
          { label: "Take back", title: "Put it back on you", onClick: () => { onPatchNeed(st.doc.id, { assignedTo: me }, st.doc); toast.success("Back on you"); }, tone: "ghost" },
          { label: "Re-push", title: "Push to someone else", onClick: row.onTogglePick, tone: "ghost" },
        ];
      } else { // verify
        row.canDone = true; row.onDone = () => clearAuto(t, job, null);
        row.actions = [
          { label: "Send back", title: `Reopen it for ${first(st.who)}`, onClick: () => { onPatchNeed(st.doc.id, { status: "open", doneAt: "", doneBy: "", assignedTo: st.who }, st.doc); toast.success(`Sent back to ${first(st.who)}`); }, tone: "ghost" },
        ];
      }
      mineRows.push(row);
    });
  }
```

Note: `toast` is the app-wide toast object already used by `NeedQuickAdd` (`toast.success(...)`); `timeAgo` is the top-level helper (`const timeAgo = (isoStr) => ...`); `getAccess` is top-level. The foreman branch is intentionally gone.

- [ ] **Step 3: Render state + actions in `Row`**

In `Row`, directly after the `<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: C.dim, marginTop: 3 }}> … </div>` sub-line (the one that maps `r.sub`), add:

```jsx
          {r.state === "with" && <div style={{ fontSize: 12, color: C.blue, fontWeight: 600, marginTop: 4 }}>with {first(r.who)}{r.age ? ` · ${r.age}` : ""}</div>}
          {r.state === "verify" && <div style={{ fontSize: 12, color: C.green, fontWeight: 700, marginTop: 4 }}>done by {first(r.who)}{r.age ? ` · ${r.age}` : ""} · verify</div>}
          {r.actions && r.actions.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {r.actions.map(a => (
                <button key={a.label} title={a.title} onClick={e => { e.stopPropagation(); a.onClick(); }}
                  style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 10px", minHeight: 32, borderRadius: 8, cursor: "pointer",
                    background: a.tone === "primary" ? C.blue : "transparent", color: a.tone === "primary" ? "#fff" : C.blue, border: `1px solid ${C.blue}` }}>{a.label}</button>
              ))}
            </div>
          )}
          {r.pushOpen && (
            <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, padding: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              {r.roster.filter(n => !sameName(n, me)).map(n => (
                <button key={n} onClick={() => r.onPick(n)}
                  style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 10px", minHeight: 32, borderRadius: 999, cursor: "pointer", background: C.card, color: C.text, border: `1px solid ${C.border}` }}>{n}</button>
              ))}
            </div>
          )}
```

The title `<div>` that opens the job has `onClick`; the action buttons stop propagation so tapping Push never opens the job. Rows with `state === "with"` should read muted: change the title style line to
```jsx
          <div style={{ fontSize: 14, fontWeight: 600, color: r.state === "with" ? C.dim : C.text, wordBreak: "break-word", lineHeight: 1.35 }}>{r.title}</div>
```

- [ ] **Step 4: Gates + a manual render check**

```bash
node scripts/version-from-sw.js && node scripts/needs-dryrun.js
```
Expected: both green (no-undef catches any typo in `toast`, `timeAgo`, `getAccess`, `first`).

Then build once and eyeball locally (PIN gate: you can only reach the identity picker, which proves the bundle boots):
```bash
CI=true npm run build > /tmp/build-t3.log 2>&1; echo EXIT $?; tail -3 /tmp/build-t3.log
```
Expected: `EXIT 0`.

- [ ] **Step 5: Hand-off note**

Report: foreman branch removed; head branch uses `foldDutyTwins(headAutoTasks(...))`; new prop `onSaveNeed` wired at the mount.

---

### Task 4: Foreman's "On Koy" → one collapsed line per job with "+ Add for Koy"

**Files:**
- Modify: `src/App.js` — `MyDay` (`headRows` / `groups` / `Group`), `NeedQuickAdd` (`preset.assignedTo`).

**Interfaces:**
- Consumes: `openQuickAdd(preset)` (already a MyDay prop; the root does `setQuickAdd(preset||{})`), `NeedQuickAdd({ preset })`.
- Produces: `NeedQuickAdd` honours `preset.assignedTo` (string name) in addition to `preset.job`; the foreman's second group renders per-job collapsed lines.

- [ ] **Step 1: Let Quick-add take a preset assignee**

In `NeedQuickAdd`, change
```js
  const [assignedTo, setAssignedTo] = useState(() => defaultAssigneeFor(identity, users));
```
to
```js
  const [assignedTo, setAssignedTo] = useState(() => (preset && preset.assignedTo) || defaultAssigneeFor(identity, users));
```

- [ ] **Step 2: Build per-job lines for the foreman**

In `MyDay`, replace
```js
  const headRows = iAmHead ? [] : [
    ...openNeeds.filter(n => onHead(n, identity, users, jobs)).map(n => needRow(n, true)),
    ...derivedDutiesForForeman(jobs, identity, users).map(d => dutyRow(d, true)),
  ];
```
with
```js
  // v408: "On <head>" is one collapsed line per job ("Koy has N things on this
  // job"), opening to the read-only rows + "+ Add for Koy" (Koy, 2026-09-15).
  // Rows = task docs on the head about my jobs ∪ the head's auto rows on my
  // jobs ∪ duties, with duty twins folded exactly like the head's own board.
  const [openHeadJobs, setOpenHeadJobs] = useState(() => new Set());
  const toggleHeadJob = (id) => setOpenHeadJobs(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const headRows = iAmHead ? [] : (() => {
    const rows = [...openNeeds.filter(n => onHead(n, identity, users, jobs)).map(n => needRow(n, true)),
      ...derivedDutiesForForeman(jobs, identity, users).map(d => dutyRow(d, true))];
    const myIds = new Set(myJobs.map(j => j.id));
    const dutyKeys = new Set(derivedDutiesForForeman(jobs, identity, users).map(d => d.id)); // already `${jobId}_${dutyId}`
    foldDutyTwins(headAutoTasks(jobs, cleared), dutyKeys).filter(t => myIds.has(t.jobId)).forEach(t => {
      const st = autoRowState(t, delegation, headName);
      if (st.state === "with" && sameName(st.who, me)) return; // it's in Mine already
      rows.push({ key: "auto_" + t.id, kind: "auto", bucket: autoBucket(t), title: t.title, tag: "Auto", tagColor: C.dim,
        sub: [t.jobName, st.state === "with" ? `with ${first(st.who)}` : `${headFirst}'s`].filter(Boolean), jobId: t.jobId, section: null, canDone: false, canSnooze: false });
    });
    return rows;
  })();
  const headByJob = (() => {
    const m = new Map();
    headRows.forEach(r => { const k = r.jobId || "_none"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].map(([jobId, rows]) => ({ jobId, job: jobById(jobId), rows: sortRows(rows) }))
      .sort((a, b) => String((a.job && a.job.name) || "").localeCompare(String((b.job && b.job.name) || "")));
  })();
```
`sortRows` is defined a few lines below in the current file — move its `const sortRows = ...` line ABOVE this block so it is in scope.

- [ ] **Step 3: Render the per-job lines**

Replace the `groups` const:
```js
  const groups = [
    { key: "mine", title: "Mine", rows: sortRows(mineRows), empty: "All clear — nothing on you right now." },
    ...(iAmHead ? [] : [{ key: "head", title: `On ${headFirst}`, rows: sortRows(headRows), empty: `Nothing waiting on ${headFirst} for your jobs.` }]),
  ];
```
with
```js
  const groups = [
    { key: "mine", title: "Mine", rows: sortRows(mineRows), empty: "All clear — nothing on you right now." },
    ...(iAmHead ? [] : [{ key: "head", title: `On ${headFirst}`, rows: headRows, byJob: headByJob, empty: `Nothing waiting on ${headFirst} for your jobs.` }]),
  ];
```
and in `Group`, replace the body render line
```jsx
        {isOpen && (g.rows.length
          ? <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{g.rows.map(Row)}</div>
          : <div style={{ padding: 12, textAlign: "center", color: C.dim, fontSize: 13, background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{g.empty}</div>)}
```
with
```jsx
        {isOpen && (g.byJob
          ? (g.byJob.length
            ? <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {g.byJob.map(({ jobId, job, rows }) => {
                  const open = openHeadJobs.has(jobId);
                  const n = rows.length;
                  return (
                    <div key={jobId} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                      <div onClick={() => toggleHeadJob(jobId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", cursor: "pointer", minHeight: 44 }}>
                        <span style={{ display: "inline-flex", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none", color: C.dim }}><Icon name="chevronRight" size={16} stroke={2.25} /></span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{headFirst} has {n} thing{n === 1 ? "" : "s"} on {(job && job.name) || "this job"}</span>
                      </div>
                      {open && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "0 10px 10px" }}>
                          {rows.map(Row)}
                          {canCreate && openQuickAdd && (
                            <button onClick={() => openQuickAdd({ job, assignedTo: headName })}
                              style={{ alignSelf: "flex-start", fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 12px", minHeight: 36, borderRadius: 8, cursor: "pointer", background: "transparent", color: C.accent, border: `1px dashed ${C.accent}` }}>
                              + Add for {headFirst}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            : <div style={{ padding: 12, textAlign: "center", color: C.dim, fontSize: 13, background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{g.empty}</div>)
          : (g.rows.length
            ? <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{g.rows.map(Row)}</div>
            : <div style={{ padding: 12, textAlign: "center", color: C.dim, fontSize: 13, background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 10 }}>{g.empty}</div>))}
```
The group header's count `{g.rows.length}` still shows the total rows across jobs; leave it.

- [ ] **Step 4: Harness section 13 (foreman side)**

Append to `scripts/needs-dryrun.js` before `console.log("needs-dryrun ok")`:
```js
// ── 13. foreman side: head auto rows on MY jobs only; twins folded ──────────
const gageAutos = H.foldDutyTwins(H.headAutoTasks(jobsWithTP, new Set(), fakeCompute), new Set()).filter(t => H.myJobsFor(gage, users, jobsWithTP).some(j => j.id === t.jobId));
eq(gageAutos.map(t => t.id), ["j1770_rough_po"], "foreman's On-head list holds only the head's auto rows on their jobs");
```
Run: `node scripts/needs-dryrun.js` → `needs-dryrun ok`.

- [ ] **Step 5: Gates**

```bash
node scripts/version-from-sw.js && node scripts/needs-dryrun.js
```
Expected: green.

---

### Task 5: Guides, vault log, final build, one-paste

**Files:**
- Modify: `public/sops/myday.html` (sections "Mine", "On Koy"), `public/sops/needs.html` (section "Hand it to someone").
- Create: `~/Desktop/Command Center/Logs/2026-09-15 - Homestead Electric.md` (vault, outside the repo).
- Modify: `~/Desktop/Command Center/02-Features/Needs Board Spec.md` — append a "v408" paragraph (if the file is named `NEEDS_BOARD_SPEC.md` in `08-Specs`, append there instead).

- [ ] **Step 1: myday.html**

Under `<h3>Mine</h3>` replace the paragraph text with:
```html
<p>Everything on <b>you</b>: tasks someone put on you, and punch items assigned to you. If you're a foreman, the automatic office tasks (POs, invoices, scheduling) are not yours anymore — they sit with Koy until he pushes one to you, and then it shows up here like any other task with the job on it.</p>
```
Under `<h3>On Koy</h3>` replace with:
```html
<p>One line per job: <b>"Koy has 4 things on this job."</b> Tap it to see what he owes on your job — his tasks, his automatic ones, the QC walks and start POs. It's read-only. Need something from him on that job? <b>+ Add for Koy</b> is right there, already set to that job and to him.</p>
```
Add a new step block after "On Koy" (same markup as the neighbouring `<div class="step">` blocks):
```html
<div class="step"><div class="num">·</div><div class="body">
<h3>If you're Koy: Push</h3>
<p>Every automatic task on every job lands on you. On each one: <b>→ Gage</b> pushes it to that job's foreman in one tap, <b>Pick person</b> sends it to anyone. The row stays on your list as <b>with Gage · 2d</b> (Take back, Re-push). When they mark it done it comes back as <b>done by Gage · verify</b> — tap Done to clear it, or <b>Send back</b> if it isn't really done. QC walks and start POs show once, as the duty row.</p>
</div></div>
```

- [ ] **Step 2: needs.html**

Under `<h3>Hand it to someone</h3>` append one sentence to the existing paragraph:
```html
 The automatic office tasks on My Day work the same way — Koy pushes one to a person and it becomes a task on their day.
```

- [ ] **Step 3: Full build + gates**

```bash
CI=true npm run build > /tmp/build-v408.log 2>&1; echo EXIT $?; grep -E "needs-dryrun ok|baked homestead-v408" /tmp/build-v408.log
```
Expected: `EXIT 0` and both lines.

- [ ] **Step 4: Vault log**

Create `~/Desktop/Command Center/Logs/2026-09-15 - Homestead Electric.md` with the house frontmatter (`type: log`, `date: 2026-09-15`, `app: Homestead Electric`, `sw_version: v408 built, awaiting Koy's push`) and a section "My Day: the head owns every auto-task; Push delegates (v408)" quoting Koy's three decisions (all flow through me; push to foreman or pick a person; verify before clear; On Koy collapsed with add), linking `[[Needs Board Spec]]`, `[[Head of Residential]]`, and the spec path. Note that GC Portal v405–v407 shipped the same day from another session.

- [ ] **Step 5: Deploy hygiene + one-paste**

Run the checklist (`git status --short`, `git diff --stat`, `git diff src/App.js | grep -E "^@@"` — every hunk must be yours; no `firestore.rules` / `functions/` in the diff). Then give Koy:

```bash
cd ~/Desktop/homestead-electric/.claude/worktrees/objective-visvesvaraya-7a3368 && git add src/App.js public/service-worker.js FEATURES.md scripts/needs-dryrun.js public/sops/myday.html public/sops/needs.html docs/superpowers/specs/2026-09-15-myday-head-owns-auto-tasks-design.md docs/superpowers/plans/2026-09-15-myday-head-owns-auto-tasks.md && git commit -m "My Day: the head owns every auto-task; Push delegates (SW v408)

Foremen no longer receive auto-generated office tasks (POs, invoices, scheduling, COs); Mine = tasks on them + their punch items. The Head of Residential sees every non-prep auto-task on every live job and can Push one to the job's foreman (one tap) or pick a person: Push writes an ordinary needs task doc carrying the new additive autoTaskId; the head row shows with X (Take back / Re-push) and, once X marks it done, done by X · verify with Done (existing clearedTasks) and Send back. One open doc per auto-task (re-push reassigns). Duty twins (QC walks, start POs) fold to the duty row. Foreman's On Koy is one collapsed line per job with + Add for Koy. Harness needs-dryrun sections 8-13. Guides + FEATURES.md + spec + plan included.

Why it won't lose data: one additive field (autoTaskId) inside the need doc's data; auto-task Done/Snooze keep the existing whole-map clearedTasks/taskDueDates precedents (one updateJob per tap); foremen lose rows only, no doc, field, or job value is deleted or renamed; Push/Take back/Send back are ordinary saveNeed/patchNeed writes. No rules, functions, or loader change.

SW cache bumped v407 -> v408.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && cd ~/Desktop/homestead-electric && git merge --ff-only claude/sharp-margulis-7c8590 && git push
```

- [ ] **Step 6: Smoke script for Koy (PIN-gated, his to run)**

1. As Koy: My Day shows every auto task; a row on a Gage job shows `→ Gage` and `Pick person`.
2. Tap `→ Gage`: toast "Pushed to Gage", row turns muted "with Gage · just now"; Gage's My Day (or the Needs board under All) shows the task with the job.
3. As Gage: mark it Done → Koy's row reads "done by Gage · verify"; Done clears it; Send back reopens it for Gage.
4. As Gage: My Day → Mine has no Auto rows; On Koy shows "Koy has N things on #1770…"; open it; "+ Add for Koy" opens Quick-add with To: Koy and the job set.
