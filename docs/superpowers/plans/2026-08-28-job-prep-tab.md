# Job Prep Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the office-only "Job Prep" tab — a cross-job board for Justin's admin items (account / pre-lien / temp ped, with N/A) and Koy's 5-item pre-job prep checklist — plus the "Start without full prep" override that unblocks the Upcoming Jobs stage board without losing tracking.

**Architecture:** One new view component (`JobPrepTracker`) in `src/App.js` modeled on `ChangeOrderTracker`, reading/writing existing per-job fields through the established `updateJob` funnel. The single `allPrepDone()` gate splits into `allPrepChecked` (strict) and `prepClearedToStart` (strict OR override). Two additive nested fields (`adminNA`, `prepOverride`) — no loader, rules, or functions changes.

**Tech Stack:** React (single-file `src/App.js`), Firestore via the existing `saveJob`/`updateJob` funnel, inline styles with the `C` palette, Vercel deploy.

**Authorities:** Spec = `docs/superpowers/specs/2026-08-28-job-prep-tab-design.md` (data model + integration). Visual/interaction reference = `jobprep-mockup.html` (approved clickable mockup).

## Global Constraints

- **NEVER run `git commit` or `git push` — Koy commits.** Tasks end with verification, not commits. The final task produces a one-paste command for Koy. (This overrides this plan template's usual per-task commit steps.)
- Work ONLY in `~/Desktop/homestead-electric` (the Desktop mount — `~/Documents/...` is a stale copy).
- All line numbers below are landmarks from 2026-08-28 — **re-grep before editing**; App.js grows. Each task lists a grep anchor.
- No emojis in app UI — text glyphs `✓ ○ ▾ —` only (all already used in-app). Use `<Icon/>` only for icons already in `ICON_PATHS`.
- Amber `#B0892C` only as the override accent (and where the app's own stage colors already use it).
- Mobile/desktop parity — every surface must work at 375px wide (chips wrap, no horizontal scroll).
- Verification cycle per task: reload the app in the browser via the `build-preview` launch config (`.claude/launch.json` → `node .claude/build-server.js`, port 8210) and check the listed behaviors + console. Full `CI=true npm run build` (NEVER piped — piping masks the prebuild-gate failure) runs in Task 1 (riskiest rename) and Task 8 (ship gate).
- Do NOT touch: `functions/index.js` (its duplicate `allPrepDone` stays), `firestore.rules` (no new collections), the Rough tab's `prepStage` auto-flip (~L26512), `PrepTaskList`'s local `stageColor`, or the existing `jobprep.own` permission cap (~L3682 — load-bearing for the Coordinator Book).
- Parallel-chat caution: uncommitted v386 changes to `src/App.js` / `public/service-worker.js` / `FEATURES.md` were already in the tree on 2026-08-28 from another session. `git status` + `git diff` before starting AND at ship; never `git checkout`/`git restore` these files.

---

### Task 1: Gate split — `allPrepChecked` + `prepClearedToStart`

**Files:**
- Modify: `src/App.js` ~L1852 (definition; anchor: `grep -n "const allPrepDone" src/App.js`)
- Modify: the 5 App.js call sites (anchors below)

**Interfaces:**
- Consumes: existing `allPrepDone(job)` and its consumers.
- Produces: `allPrepChecked(job) -> boolean` (strict: all 5 checklist booleans, legacy `prepStage === "Job Prep Complete"` fallback when no checklist) and `prepClearedToStart(job) -> boolean` (`allPrepChecked(job) || !!job.prepOverride?.on`). Later tasks call BOTH by these exact names.

- [ ] **Step 1: Replace the definition** (~L1852):

```js
const allPrepChecked = (job) => {
  if (job.prepChecklist) {
    const c = job.prepChecklist;
    return !!(c.redlinePlans && c.cabinetPlans && c.applianceSpecs && c.plansUploaded && c.readyToHandOff);
  }
  return (job.prepStage||"") === "Job Prep Complete";
};
// Cleared to break ground: strictly checked, OR a standing "start without full
// prep" override. The override NEVER makes allPrepChecked true — outstanding
// items keep their tracking (Job Prep tab row, auto prep task) until checked.
const prepClearedToStart = (job) => allPrepChecked(job) || !!(job.prepOverride && job.prepOverride.on);
```

- [ ] **Step 2: Update the two stage-board tests** (anchor: `grep -n "Pre Job Prep\|Rough — Not Started" src/App.js` around L30305-30309). "Pre Job Prep" section: `!allPrepDone(j)` → `!prepClearedToStart(j)`. "Rough — Not Started": `allPrepDone(j)` → `prepClearedToStart(j)`. Nothing else in either test changes.

- [ ] **Step 3: Update the auto-task builder** (anchor: `grep -n "Pre Job Prep — always assigned to Koy" src/App.js`, ~L31358). Replace the block's gate and add the override marker to the desc:

```js
    if(!job.tempPed && job.type!=="quote" && !allPrepChecked(job)) {
      const c=job.prepChecklist||{};
      const items=PREP_CHECKLIST_ITEMS;
      const doneCount=items.filter(i=>c[i.key]).length;
      const nextItem=items.find(i=>!c[i.key]);
      const ovr = job.prepOverride && job.prepOverride.on;
      tasks.push({
        id: job.id+"_prep", jobId: job.id, jobName: job.name,
        type: "auto", category: "prep", foreman: "Koy",
        prepStage: job.prepStage||"",
        title: `Pre Job Prep: ${job.name||"Untitled"}`,
        desc: (doneCount===0?"Not started":`${doneCount}/${items.length} complete${nextItem?` — Next: ${nextItem.label}`:""}`)
              + (ovr ? " — OVERRIDE ACTIVE (job cleared to start)" : ""),
        color: "#3E7D7A", cleared: false,
      });
    }
```

- [ ] **Step 4: Update the two drawer references** (anchor: `grep -n "allPrepDone" src/App.js`, ~L28716 `defaultOpen={!allPrepDone(job)}` → `defaultOpen={!allPrepChecked(job)}`; ~L28738 `{allPrepDone(job)&&(` → `{allPrepChecked(job)&&(`).

- [ ] **Step 5: Verify no stragglers.** Run: `grep -n "allPrepDone" src/App.js` — Expected: **0 hits**. (`grep -n "allPrepDone" functions/index.js` still hits — correct, functions keeps its own copy untouched.)

- [ ] **Step 6: Full build gate.** Run: `CI=true npm run build` (never piped). Expected: build succeeds. (If node_modules is iCloud-evicted and the build stalls, materialize it first: `find node_modules -type f -print0 | xargs -0 stat -f%z > /dev/null` or re-`npm ci` per the repo's iCloud lesson.)

- [ ] **Step 7: Behavior check in browser** (build-preview server): Upcoming Jobs stage board and the drawer behave exactly as before for every job (no `prepOverride` exists yet, so `prepClearedToStart === allPrepChecked` everywhere — this task must be a pure no-op in prod behavior).

---

### Task 2: Permission, nav tab, view shell, router mount

**Files:**
- Modify: `src/App.js` PERMISSIONS map (anchor: `grep -n "const PERMISSIONS = {" src/App.js`, ~L3644)
- Modify: nav tabs array (anchor: `grep -n '{key:"cos",label:"COs"}' src/App.js`, ~L53628)
- Create: `JobPrepTracker` component — insert directly ABOVE `function ChangeOrderTracker` (anchor: `grep -n "function ChangeOrderTracker" src/App.js`)
- Modify: view router (anchor: `grep -n 'view==="cos"&&can' src/App.js`, ~L55197)

**Interfaces:**
- Consumes: `can(identity, key)`, `getAccess(identity)`, `updateJob(updatedJob, patch)`, `setSelected(job)`, `HelpDot({section})`, `C` palette.
- Produces: `PERMISSIONS["jobprep.view"]`; component `JobPrepTracker({ jobs, identity, onSelectJob, onUpdateJob })` where `onSelectJob(job)` opens the drawer and `onUpdateJob(jobId, patch)` saves a patch; view key `"jobprep"`. Tasks 3-6 build inside this component and rely on these prop names/signatures.

- [ ] **Step 1: Add the permission.** Inside the PERMISSIONS map add (do NOT touch the existing `"jobprep.own": []` cap further down — different feature, cap-granted, load-bearing for Coordinator Book):

```js
  "jobprep.view":    ["admin","manager"],
```

- [ ] **Step 2: Add the nav tab.** In the non-contractor tabs array, insert immediately after the `cos` row:

```js
              ...(can(identity,"jobprep.view")?[{key:"jobprep",label:"Job Prep"}]:[]),
```

- [ ] **Step 3: Create the component shell** (above `ChangeOrderTracker`):

```jsx
// ── Job Prep tab — cross-job board for office admin items + pre-job prep ──
// Spec: docs/superpowers/specs/2026-08-28-job-prep-tab-design.md
// Visual reference: jobprep-mockup.html (approved 2026-08-28)
function JobPrepTracker({ jobs = [], identity, onSelectJob, onUpdateJob }) {
  return (
    <div style={{padding:"16px 18px 40px", maxWidth:1120, margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:14}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>JOB PREP</div>
            <HelpDot section="jobprep"/>
          </div>
          <div style={{fontSize:12,color:C.dim,marginTop:4}}>{(jobs||[]).length} jobs loaded</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount in the router.** Immediately AFTER the closing `)}` of the `view==="cos"` block:

```jsx
      {view==="jobprep"&&can(identity,"jobprep.view")&&(
        <JobPrepTracker
          jobs={jobs}
          identity={identity}
          onSelectJob={(j)=>{ const full = jobs.find(x => x.id === j.id); if (full) setSelected(full); }}
          onUpdateJob={(jobId,patch)=>{ const job=jobs.find(j=>j.id===jobId); if(job) updateJob({...job,...patch},patch); }}
        />
      )}
```

(`updateJob` is in scope here — the Tasks mounts at ~L54730/L55092 use this exact pattern.)

- [ ] **Step 5: Verify in browser.** As Koy (admin): the "Job Prep" tab appears after COs, clicking it shows the JOB PREP header, console clean. The `?` HelpDot renders nothing yet (no SOP entry until Task 7 — expected; component returns null for unknown sections).

---

### Task 3: Office Admin lane (Justin's) — tri-state chips, menu, ped #, complete strip

**Files:**
- Modify: `src/App.js` — module-scope helpers above `JobPrepTracker`, plus the component body

**Interfaces:**
- Consumes: `parseAnyDate(str) -> Date|null` (~L31378, handles both `M/D/YYYY` and `YYYY-MM-DD`), `effFS(j)` (~L30069). `getPersonColor` is NOT available in this scope — the foreman dot renders in neutral `C.dim` (in `JobPrepJobInfo` below), matching the mockup's dot shape without per-person color.
- Produces (used by Tasks 4-6): `JOBPREP_ADMIN_ITEMS`, `adminItemState(job, item) -> "done"|"na"|"todo"`, `adminAllHandled(job) -> boolean`, `jobPrepIncluded(jobs) -> job[]` (filtered + sorted), `JOBPREP_CHIP_STATES`, `jobPrepRowStyle(edgeColor)`, `jobPrepSoon(job)`, and MODULE-SCOPE row components `JobPrepJobInfo({job, onSelectJob})`, `JobPrepAdminRow({job, onSelectJob, onUpdateJob, onOpenMenu})`, `JobPrepCompleteStrip({open, onToggle, count, children})`. Components are module-scope ON PURPOSE — defined inside `JobPrepTracker` they'd get a new identity every parent render and React would remount every row (open Ped # selects snap shut on every background jobs snapshot; full-board DOM teardown per keystroke).

- [ ] **Step 1: Add module-scope helpers** (directly above `JobPrepTracker`):

```js
const JOBPREP_ADMIN_ITEMS = [
  { key:"jobAccount", boolKey:"jobAccount",  chip:"ACCOUNT",  label:"Job account created" },
  { key:"preLien",    boolKey:"preLien",     chip:"PRE-LIEN", label:"Pre-lien filed" },
  { key:"tempPed",    boolKey:"hasTempPed",  chip:"TEMP PED", label:"Temp pedestal on site" },
];
// done = existing boolean true; N/A = adminNA flag (boolean false); else outstanding.
const adminItemState = (job, item) =>
  job[item.boolKey] ? "done" : ((job.adminNA||{})[item.key] ? "na" : "todo");
const adminAllHandled = (job) => JOBPREP_ADMIN_ITEMS.every(it => adminItemState(job, it) !== "todo");
// The tab's job universe: full jobs only, until finish completes; next start on top.
// roughProjectedStart is M/D/YYYY (DateInp storage) with legacy YYYY-MM-DD mixed in —
// parseAnyDate handles both; NEVER string-compare these.
const jobPrepIncluded = (jobs) => (jobs||[])
  .filter(j => j && !j.tempPed && !j.quickJob && j.type !== "quote" && effFS(j) !== "complete")
  .sort((a,b) => {
    const da = parseAnyDate(a.roughProjectedStart), db = parseAnyDate(b.roughProjectedStart);
    if (!da && !db) return (a.name||"").localeCompare(b.name||"");
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });
```

- [ ] **Step 2: Write the admin-item patch builder** (module scope, under the helpers). All three transitions are explicit — "Mark outstanding" must clear BOTH fields or a stale `adminNA` leaves the chip stuck on N/A:

```js
// target: "done" | "todo" | "na". Returns the saveJob patch for one admin item.
const adminItemPatch = (job, item, target) => {
  const na = { ...(job.adminNA||{}) };
  if (target === "na") na[item.key] = true; else na[item.key] = false;
  return {
    [item.boolKey]: target === "done",
    adminNA: na,
    ...(item.key === "tempPed" && target !== "done" ? { tempPedNumber: "" } : {}),
  };
};
```

- [ ] **Step 3: Add the module-scope row components** (directly below the Step 1-2 helpers, ABOVE `JobPrepTracker`). Module scope on purpose — see Interfaces. Same reason `ChangeOrderTracker` renders its rows inline instead of nesting components:

```jsx
const JOBPREP_CHIP_STATES = {
  todo: { border:"#B23A3A55", bg:"#B23A3A0A", fg:"#B23A3A", mark:"○ " },
  done: { border:"#46916A55", bg:"#46916A0F", fg:"#46916A", mark:"✓ " },
  na:   { border:"#CDD3DB",   bg:"#F4F6F8",   fg:"#5E6670", mark:"" },
};
const jobPrepRowStyle = (edge) => ({ background:"#fff", border:`1px solid ${C.border}`, borderLeft:`3px solid ${edge}`,
  borderRadius:10, padding:"14px 16px", marginBottom:10, boxShadow:"0 4px 16px rgba(15,31,61,0.08)",
  display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" });
const jobPrepSoon = (j) => {
  const d = parseAnyDate(j.roughProjectedStart);
  return d ? (d - new Date()) / 86400000 <= 10 : false;
};

function JobPrepJobInfo({ job, onSelectJob }) {
  return (
    <div style={{minWidth:200, flex:"1 1 200px"}}>
      <div onClick={()=>onSelectJob(job)}
        style={{fontWeight:700, fontSize:14, color:C.text, cursor:"pointer"}}>{job.name||"Untitled Job"}</div>
      <div style={{display:"flex", alignItems:"center", gap:8, marginTop:3, fontSize:11, color:C.dim, flexWrap:"wrap"}}>
        {job.simproNo && <span>#{job.simproNo}</span>}
        {job.foreman && <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
          <span style={{width:7,height:7,borderRadius:99,background:C.dim,display:"inline-block"}}/>{job.foreman}</span>}
        <span style={{fontWeight:600, color: jobPrepSoon(job) ? C.orange : C.dim}}>
          {job.roughProjectedStart ? `Start ${job.roughProjectedStart}` : "No start date"}
        </span>
        {job.gc && <span>{job.gc}</span>}
      </div>
    </div>
  );
}

function JobPrepAdminRow({ job, onSelectJob, onUpdateJob, onOpenMenu }) {
  const ped = JOBPREP_ADMIN_ITEMS[2];
  return (
    <div style={jobPrepRowStyle(adminAllHandled(job) ? "#46916A" : C.red)}>
      <JobPrepJobInfo job={job} onSelectJob={onSelectJob}/>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
        {JOBPREP_ADMIN_ITEMS.map(item => {
          const state = adminItemState(job, item);
          const s = JOBPREP_CHIP_STATES[state];
          return (
            <span key={item.key} style={{display:"inline-flex", alignItems:"center", borderRadius:99, fontSize:10,
              fontWeight:700, letterSpacing:"0.05em", cursor:"pointer", userSelect:"none",
              border:`1px ${state==="na" ? "dashed" : "solid"} ${s.border}`, background:s.bg, color:s.fg,
              minHeight:32, overflow:"hidden"}}>
              <span onClick={(e)=> state==="na"
                  ? onOpenMenu(e, job.id, item.key)   // leaving N/A is deliberate — menu only
                  : onUpdateJob(job.id, adminItemPatch(job, item, state === "done" ? "todo" : "done"))}
                style={{padding:"9px 5px 9px 12px", whiteSpace:"nowrap",
                  textDecoration: state==="na" ? "line-through" : "none"}}>{s.mark}{item.chip}</span>
              <span onClick={(e)=>onOpenMenu(e, job.id, item.key)}
                style={{padding:"9px 10px 9px 5px", opacity:0.55, fontSize:9}}>▾</span>
            </span>
          );
        })}
        {adminItemState(job, ped) === "done" && (
          <select value={job.tempPedNumber||""} onChange={e=>onUpdateJob(job.id,{tempPedNumber:e.target.value})}
            style={{padding:"6px 10px", borderRadius:7, border:`1px solid ${C.border}`, fontSize:12,
              fontFamily:"inherit", background:C.surface, outline:"none", cursor:"pointer",
              color: job.tempPedNumber ? C.blue : C.dim, fontWeight: job.tempPedNumber ? 700 : 400}}>
            <option value="">— select —</option>
            {Array.from({length:100},(_,i)=>String(i+1)).map(n=><option key={n} value={n}>Ped #{n}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function JobPrepCompleteStrip({ open, onToggle, count, children }) {
  if (count === 0) return null;
  return (
    <div style={{border:"1px dashed #46916A55", borderRadius:10, marginTop:4, overflow:"hidden"}}>
      <div onClick={onToggle}
        style={{padding:"9px 14px", fontSize:11, fontWeight:700, color:"#46916A", cursor:"pointer",
          display:"flex", alignItems:"center", background:"#46916A08"}}>
        <span>✓ {count} complete</span><span style={{marginLeft:"auto", opacity:0.6, fontSize:10}}>▾</span>
      </div>
      {open && <div style={{padding:"6px 10px 10px"}}>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 3b: Rebuild the component body.** Replace the shell's body with state + the admin lane (the prep lane lands in Task 4). Full component at this point:

```jsx
function JobPrepTracker({ jobs = [], identity, onSelectJob, onUpdateJob }) {
  const [menu, setMenu] = useState(null);          // {jobId, itemKey, x, y}
  const [stripOpen, setStripOpen] = useState({ admin:false, prep:false });

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (e && e.target && e.target.closest && e.target.closest("[data-jobprep-menu]")) return; setMenu(null); };
    const closeOnScroll = () => setMenu(null);     // fixed-position menu detaches on scroll — just close it
    document.addEventListener("click", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => { document.removeEventListener("click", close); window.removeEventListener("scroll", closeOnScroll, true); };
  }, [menu]);

  const openMenu = (e, jobId, itemKey) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(m => (m && m.jobId===jobId && m.itemKey===itemKey) ? null   // re-tap same caret = close
      : { jobId, itemKey,
          x: Math.min(r.left, window.innerWidth - 180),
          y: Math.min(r.bottom + 4, window.innerHeight - 110) });      // clamp so a bottom-row menu stays on-screen
  };

  const included = useMemo(() => jobPrepIncluded(jobs), [jobs]);
  const aOpen = included.filter(j => !adminAllHandled(j));
  const aDone = included.filter(adminAllHandled);

  return (
    <div style={{padding:"16px 18px 40px", maxWidth:1120, margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:14}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>JOB PREP</div>
            <HelpDot section="jobprep"/>
          </div>
          <div style={{fontSize:12,color:C.dim,marginTop:4}}>{included.length} active jobs</div>
        </div>
      </div>

      {/* ══ LANE 1 — OFFICE ADMIN ══ */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:10,
          borderBottom:"2px solid #3B5BA522",flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:C.blue}}>OFFICE ADMIN</div>
          <div style={{marginLeft:"auto",fontSize:10,fontWeight:700,letterSpacing:"0.06em",color:C.dim,textTransform:"uppercase"}}>Justin's lane</div>
        </div>
        {aOpen.length === 0
          ? <div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"18px 0"}}>✓ Every job has account, pre-lien, and ped handled</div>
          : aOpen.map(j => <JobPrepAdminRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob} onOpenMenu={openMenu}/>)}
        <JobPrepCompleteStrip open={stripOpen.admin} onToggle={()=>setStripOpen(s=>({...s,admin:!s.admin}))} count={aDone.length}>
          {aDone.map(j => <JobPrepAdminRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob} onOpenMenu={openMenu}/>)}
        </JobPrepCompleteStrip>
      </div>

      {/* menu popover */}
      {menu && (() => {
        const job = jobs.find(j=>j.id===menu.jobId);
        const item = JOBPREP_ADMIN_ITEMS.find(i=>i.key===menu.itemKey);
        if (!job || !item) return null;
        const state = adminItemState(job, item);
        const opt = (label, target) => (
          <button key={target} onClick={()=>{ onUpdateJob(job.id, adminItemPatch(job, item, target)); setMenu(null); }}
            style={{display:"block",width:"100%",textAlign:"left",padding:"10px 12px",fontSize:12,fontFamily:"inherit",
              border:"none",background:"none",borderRadius:6,cursor:"pointer",color:C.text}}>{label}</button>
        );
        return (
          <div data-jobprep-menu style={{position:"fixed", left:menu.x, top:menu.y, zIndex:60, background:"#fff",
            border:`1px solid ${C.border}`, borderRadius:9, boxShadow:"0 8px 28px rgba(15,31,61,0.16)", padding:4, minWidth:150}}>
            {state !== "done" && opt("✓ Mark done", "done")}
            {state !== "todo" && opt("○ Mark outstanding", "todo")}
            {state !== "na" && opt("— Not needed (N/A)", "na")}
          </div>
        );
      })()}
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser** (build-preview): each chip cycles todo→done on tap and back; ▾ menu offers exactly the two non-current states, stays fully on-screen for a bottom-row chip at 375px, and closes on scroll; "Not needed" grays + strikes the chip and tapping it opens the menu (not a toggle); TEMP PED done reveals the Ped # select and picking sticks after reload (Firestore write-through); **ped # CLEARS:** set a Ped #, flip the chip to outstanding, re-mark it done — the select must be back at "— select —" (the patch blanked `tempPedNumber`); repeat via N/A; marking all three done-or-N/A moves the row into the "✓ N complete" strip; an open Ped # dropdown does NOT snap shut when a background save lands (module-scope rows — no remount); rows are sorted soonest-start first; a job's drawer opens from the job name. Check the drawer's Admin section agrees with the chips (same fields).

- [ ] **Step 5: Data-shape sanity.** In the browser console on a test job: toggle PRE-LIEN done, reload, confirm the chip is still done and `adminNA` did not appear at TOP level of the Firestore doc (it must live under `data.` — it will automatically via saveJob; this is a confirm-only step).

---

### Task 4: Pre-Job Prep lane (Koy's) — 5 chips, stage pill, progress, complete strip

**Files:**
- Modify: `src/App.js` — one module-scope helper + extend `JobPrepTracker`

**Interfaces:**
- Consumes: `PREP_CHECKLIST_ITEMS` (~L1845), `PREP_STAGES` / `PREP_STAGE_ALERT` (~L1843-1844), `allPrepChecked` (Task 1), `JobPrepJobInfo` / `jobPrepRowStyle` / `JOBPREP_CHIP_STATES` / `JobPrepCompleteStrip` (Task 3).
- Produces: `prepStageColor(stage) -> hex` (module scope — do NOT rewire `PrepTaskList`'s local `stageColor`; it keeps its current behavior per spec) and module-scope `JobPrepPrepRow({ job, onSelectJob, onUpdateJob })`. Task 5 REPLACES `JobPrepPrepRow` wholesale with an override-aware version (full code there) — build this one first anyway; it's the reviewable checkpoint.

- [ ] **Step 1: Add the stage color helper** (module scope, near the other jobprep helpers). Same logic as `PrepTaskList.stageColor` plus an explicit gray for unset/unknown:

```js
const prepStageColor = (stage) => {
  if (stage === PREP_STAGE_ALERT) return "#B23A3A";
  if (stage === "Job Prep Complete") return "#3E7D5A";
  const idx = PREP_STAGES.indexOf(stage);
  if (idx === -1) return "#5E6670";                 // unset/unknown → gray
  const pct = idx / (PREP_STAGES.length - 1);
  if (pct < 0.3) return "#B0892C";
  if (pct < 0.7) return "#3B5BA5";
  return "#3E7D7A";
};
```

- [ ] **Step 2: Add the prep lane to the component.** Below the admin lane markup, add (and add `const pOpen = included.filter(j => !allPrepChecked(j)); const pDone = included.filter(allPrepChecked);` next to `aOpen`/`aDone`):

```jsx
      {/* ══ LANE 2 — PRE-JOB PREP ══ */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:10,
          borderBottom:"2px solid #3E7D7A22",flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:C.teal}}>PRE-JOB PREP</div>
          <div style={{marginLeft:"auto",fontSize:10,fontWeight:700,letterSpacing:"0.06em",color:C.dim,textTransform:"uppercase"}}>Koy's lane</div>
        </div>
        {pOpen.length === 0
          ? <div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"18px 0"}}>✓ All prep complete</div>
          : pOpen.map(j => <JobPrepPrepRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>)}
        <JobPrepCompleteStrip open={stripOpen.prep} onToggle={()=>setStripOpen(s=>({...s,prep:!s.prep}))} count={pDone.length}>
          {pDone.map(j => <JobPrepPrepRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>)}
        </JobPrepCompleteStrip>
      </div>
```

- [ ] **Step 3: Write `JobPrepPrepRow`** (module scope, next to `JobPrepAdminRow`):

```jsx
function JobPrepPrepRow({ job, onSelectJob, onUpdateJob }) {
    const c = job.prepChecklist || {};
    const done = allPrepChecked(job);
    const stage = job.prepStage || "";
    const stageCol = prepStageColor(stage);
    const nDone = PREP_CHECKLIST_ITEMS.filter(i=>c[i.key]).length;
    const next = PREP_CHECKLIST_ITEMS.find(i=>!c[i.key]);
    const edge = done ? "#46916A" : C.red;   // Task 5 adds the amber override edge
    return (
      <div style={jobPrepRowStyle(edge)}>
        <JobPrepJobInfo job={job} onSelectJob={onSelectJob}/>
        <div style={{flex:"1 1 260px"}}>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:4}}>
            <span style={{fontSize:10, fontWeight:700, borderRadius:99, padding:"3px 9px", letterSpacing:"0.04em",
              whiteSpace:"nowrap", color:stageCol, background:`${stageCol}14`, border:`1px solid ${stageCol}44`}}>
              {stage || "No stage set"}
            </span>
            <span style={{fontSize:11, fontWeight:700, color:C.teal}}>{nDone}/5</span>
          </div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
            {PREP_CHECKLIST_ITEMS.map(item => {
              const on = !!c[item.key];
              const s = on ? JOBPREP_CHIP_STATES.done : JOBPREP_CHIP_STATES.todo;
              return (
                <span key={item.key}
                  onClick={()=>onUpdateJob(job.id, { prepChecklist: { ...(job.prepChecklist||{}), [item.key]: !on } })}
                  style={{display:"inline-flex", alignItems:"center", borderRadius:99, fontSize:10, fontWeight:700,
                    letterSpacing:"0.05em", cursor:"pointer", userSelect:"none", border:`1px solid ${s.border}`,
                    background:s.bg, color:s.fg, minHeight:32, padding:"9px 12px", whiteSpace:"nowrap"}}>
                  {s.mark}{item.label}
                </span>
              );
            })}
          </div>
          {!done && next && (
            <div style={{fontSize:10.5, color:C.dim, marginTop:3}}>
              NEXT: <b style={{color:C.orange, fontWeight:700}}>{next.label}</b>
            </div>
          )}
        </div>
      </div>
    );
}
```

- [ ] **Step 4: Verify in browser:** chips check/uncheck and persist; `n/5` and NEXT update; checking all five moves the row to the prep complete strip AND (cross-surface check) the job leaves "Pre Job Prep" on the Upcoming Jobs stage board and the drawer's checklist agrees; stage pill shows red for "Redline Plans Need to be Updated", gray "No stage set" when unset; the Koy-only auto prep task in Tasks view disappears when strictly complete.

---

### Task 5: Override — modal, stamp, badge, undo, drawer button

**Files:**
- Modify: `src/App.js` — extend `JobPrepTracker` (`PrepRow` + modal) and the drawer's Pre-Job Prep `Section` (anchor: `grep -n 'Section label="Pre-Job Prep"' src/App.js`, ~L28716)

**Interfaces:**
- Consumes: `can(identity,"jobprep.view")` (same admin+manager tiers — reused as the override gate), `toast.success`, `u(patch)` in the drawer scope, `identity.name`.
- Produces: `prepOverride` writes shaped exactly `{ on:true, by, at, note }` / `null`. **Every override confirm ALSO writes `prepChecklist: { ...(job.prepChecklist||{}) }` in the same patch** — this guards against the Rough tab's `prepStage:"Job Prep Complete"` auto-flip (~L26512) making a checklist-less overridden job read strictly complete. Never omit it.

- [ ] **Step 1: Add modal state + actions** to `JobPrepTracker`:

```jsx
  const [ovr, setOvr] = useState(null);            // { jobId, note } while modal open
  const canOverride = can(identity, "jobprep.view");
  const confirmOverride = () => {
    const job = jobs.find(j=>j.id===ovr.jobId); if (!job) { setOvr(null); return; }
    onUpdateJob(job.id, {
      prepOverride: { on:true, by:(identity&&identity.name)||"", at:new Date().toISOString().slice(0,10), note:(ovr.note||"").trim() },
      prepChecklist: { ...(job.prepChecklist||{}) },   // REQUIRED guard — see Interfaces
    });
    setOvr(null);
    toast.success(`${job.name||"Job"} — cleared to start. Outstanding prep items stay tracked here.`);
  };
  const undoOverride = (job) => {
    onUpdateJob(job.id, { prepOverride: null });
    toast.success(`${job.name||"Job"} — override removed, back behind the prep gate.`);
  };
```

- [ ] **Step 2: Replace `JobPrepPrepRow` wholesale** with the override-aware version (new signature adds `canOverride`, `onStartOverride`, `onUndoOverride`), and update BOTH call sites (open lane + complete strip) to:
`<JobPrepPrepRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob} canOverride={canOverride} onStartOverride={()=>setOvr({ jobId:j.id, note:"" })} onUndoOverride={()=>undoOverride(j)}/>`

```jsx
function JobPrepPrepRow({ job, onSelectJob, onUpdateJob, canOverride, onStartOverride, onUndoOverride }) {
    const c = job.prepChecklist || {};
    const done = allPrepChecked(job);
    const stage = job.prepStage || "";
    const stageCol = prepStageColor(stage);
    const nDone = PREP_CHECKLIST_ITEMS.filter(i=>c[i.key]).length;
    const next = PREP_CHECKLIST_ITEMS.find(i=>!c[i.key]);
    const ovrOn = !!(job.prepOverride && job.prepOverride.on);
    const edge = done ? "#46916A" : (ovrOn ? "#B0892C" : C.red);
    return (
      <div style={jobPrepRowStyle(edge)}>
        <JobPrepJobInfo job={job} onSelectJob={onSelectJob}/>
        <div style={{flex:"1 1 260px"}}>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:4}}>
            <span style={{fontSize:10, fontWeight:700, borderRadius:99, padding:"3px 9px", letterSpacing:"0.04em",
              whiteSpace:"nowrap", color:stageCol, background:`${stageCol}14`, border:`1px solid ${stageCol}44`}}>
              {stage || "No stage set"}
            </span>
            <span style={{fontSize:11, fontWeight:700, color:C.teal}}>{nDone}/5</span>
          </div>
          <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
            {PREP_CHECKLIST_ITEMS.map(item => {
              const on = !!c[item.key];
              const s = on ? JOBPREP_CHIP_STATES.done : JOBPREP_CHIP_STATES.todo;
              return (
                <span key={item.key}
                  onClick={()=>onUpdateJob(job.id, { prepChecklist: { ...(job.prepChecklist||{}), [item.key]: !on } })}
                  style={{display:"inline-flex", alignItems:"center", borderRadius:99, fontSize:10, fontWeight:700,
                    letterSpacing:"0.05em", cursor:"pointer", userSelect:"none", border:`1px solid ${s.border}`,
                    background:s.bg, color:s.fg, minHeight:32, padding:"9px 12px", whiteSpace:"nowrap"}}>
                  {s.mark}{item.label}
                </span>
              );
            })}
          </div>
          {!done && next && (
            <div style={{fontSize:10.5, color:C.dim, marginTop:3}}>
              NEXT: <b style={{color:C.orange, fontWeight:700}}>{next.label}</b>
            </div>
          )}
        </div>
        <div style={{display:"flex", alignItems:"center", gap:8, marginLeft:"auto", flexWrap:"wrap"}}>
          {ovrOn && !done && (
            <span style={{background:"#B0892C18", border:"1px solid #B0892C55", color:"#B0892C", borderRadius:99,
              padding:"3px 10px", fontSize:9.5, fontWeight:800, letterSpacing:"0.07em", whiteSpace:"nowrap"}}>
              OVERRIDE · READY TO START
            </span>
          )}
          {!done && canOverride && (ovrOn
            ? <button onClick={onUndoOverride}
                style={{padding:"8px 13px", borderRadius:99, fontSize:10, fontWeight:700, letterSpacing:"0.05em",
                  border:`1px solid ${C.muted}`, background:C.surface, color:C.dim, cursor:"pointer",
                  fontFamily:"inherit", whiteSpace:"nowrap"}}>UNDO OVERRIDE</button>
            : <button onClick={onStartOverride}
                style={{padding:"8px 13px", borderRadius:99, fontSize:10, fontWeight:700, letterSpacing:"0.05em",
                  border:"1px solid #B0892C66", background:"#B0892C0D", color:"#B0892C", cursor:"pointer",
                  fontFamily:"inherit", whiteSpace:"nowrap"}}>START WITHOUT FULL PREP</button>)}
        </div>
        {ovrOn && !done && (
          <div style={{flexBasis:"100%", fontSize:11, color:C.dim, fontStyle:"italic",
            borderTop:`1px dashed ${C.border}`, paddingTop:7, marginTop:2}}>
            <b style={{color:"#B0892C", fontStyle:"normal"}}>Override by {job.prepOverride.by||"?"} · {job.prepOverride.at||""}</b>
            {job.prepOverride.note ? ` — ${job.prepOverride.note}` : ""} · job shows as Rough — Not Started on Upcoming Jobs
          </div>
        )}
      </div>
    );
}
```

- [ ] **Step 3: Add the modal** (end of the component's returned JSX):

```jsx
      {ovr && (() => {
        const job = jobs.find(j=>j.id===ovr.jobId); if (!job) return null;
        const missing = PREP_CHECKLIST_ITEMS.filter(i=>!(job.prepChecklist||{})[i.key]);
        return (
          <div onClick={(e)=>{ if(e.target===e.currentTarget) setOvr(null); }}
            style={{position:"fixed", inset:0, background:"rgba(20,24,33,0.45)", zIndex:90,
              display:"flex", alignItems:"center", justifyContent:"center", padding:18}}>
            <div style={{background:"#fff", borderRadius:14, maxWidth:430, width:"100%",
              boxShadow:"0 20px 60px rgba(15,31,61,0.35)", padding:"20px 22px"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:"0.06em", color:C.text}}>START WITHOUT FULL PREP</div>
              <div style={{fontSize:12, color:C.dim, margin:"4px 0 12px"}}>
                <b>{job.name||"Untitled Job"}</b>{job.foreman?` · ${job.foreman}`:""}{job.roughProjectedStart?` · projected start ${job.roughProjectedStart}`:""}
              </div>
              <div style={{background:"#B23A3A0A", border:"1px solid #B23A3A33", borderRadius:9, padding:"9px 12px", marginBottom:12}}>
                <div style={{fontSize:9.5, fontWeight:700, letterSpacing:"0.05em", color:C.red, textTransform:"uppercase", marginBottom:5}}>Still outstanding — stays tracked</div>
                {missing.map(i=><div key={i.key} style={{fontSize:12, color:C.text, marginLeft:4}}>· {i.label}</div>)}
              </div>
              <label style={{fontSize:9.5, color:C.dim, textTransform:"uppercase", fontWeight:700, letterSpacing:"0.03em", display:"block"}}>Note (optional)
                <textarea value={ovr.note} onChange={e=>setOvr(o=>({...o, note:e.target.value}))}
                  placeholder="e.g. cabinet plans due 9/15 — GC confirmed"
                  style={{width:"100%", padding:"7px 9px", borderRadius:7, border:`1px solid ${C.border}`, fontSize:12.5,
                    fontFamily:"inherit", color:C.text, outline:"none", marginTop:4, resize:"vertical", minHeight:52}}/>
              </label>
              <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:14}}>
                <button onClick={()=>setOvr(null)} style={{padding:"8px 14px", borderRadius:8, border:`1px solid ${C.border}`,
                  background:"#fff", color:C.dim, fontWeight:600, fontSize:12.5, fontFamily:"inherit", cursor:"pointer"}}>Cancel</button>
                <button onClick={confirmOverride} style={{padding:"9px 16px", borderRadius:8, border:"1px solid #B0892C88",
                  background:"#B0892C18", color:"#B0892C", fontWeight:700, fontSize:12.5, fontFamily:"inherit", cursor:"pointer"}}>Mark Ready to Start</button>
              </div>
              <div style={{fontSize:10.5, color:C.dim, marginTop:10, lineHeight:1.5}}>
                Stamps your name + date automatically. The job advances to <b>Rough — Not Started</b> on Upcoming Jobs;
                the outstanding items above stay red on this board until checked. Undo any time.
              </div>
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 4: Drawer override — same confirm flow as the tab** (the spec defines ONE confirm flow: outstanding-items list + optional note; the drawer must not be a one-tap shortcut). Add a self-contained module-scope component (next to the other `JobPrep*` components) and mount it inside the drawer's `<Section label="Pre-Job Prep" ...>` after the checklist items / complete line — the ONE sanctioned drawer addition per the spec's non-goals:

```jsx
// Drawer-side override control. Self-contained (own confirm state) so the giant
// drawer component doesn't need new state; renders the SAME confirm content as
// the tab's modal: outstanding items + optional note.
function JobPrepDrawerOverride({ job, identity, u }) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  if (!can(identity, "jobprep.view") || allPrepChecked(job)) return null;
  const ovrOn = !!(job.prepOverride && job.prepOverride.on);
  if (ovrOn) return (
    <div style={{marginTop:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
      <span style={{background:"#B0892C18", border:"1px solid #B0892C55", color:"#B0892C", borderRadius:99,
        padding:"3px 10px", fontSize:9.5, fontWeight:800, letterSpacing:"0.07em"}}>OVERRIDE · READY TO START</span>
      <span style={{fontSize:11, color:C.dim, fontStyle:"italic"}}>
        by {job.prepOverride.by||"?"} · {job.prepOverride.at||""}{job.prepOverride.note?` — ${job.prepOverride.note}`:""}
      </span>
      <button onClick={()=>u({ prepOverride:null })}
        style={{padding:"5px 10px", borderRadius:99, fontSize:9.5, fontWeight:700, border:`1px solid ${C.muted}`,
          background:C.surface, color:C.dim, cursor:"pointer", fontFamily:"inherit"}}>UNDO</button>
    </div>
  );
  if (!confirming) return (
    <button onClick={()=>{ setConfirming(true); setNote(""); }}
      style={{marginTop:10, padding:"8px 13px", borderRadius:99, fontSize:10, fontWeight:700, letterSpacing:"0.05em",
        border:"1px solid #B0892C66", background:"#B0892C0D", color:"#B0892C", cursor:"pointer", fontFamily:"inherit"}}>
      START WITHOUT FULL PREP</button>
  );
  const missing = PREP_CHECKLIST_ITEMS.filter(i=>!(job.prepChecklist||{})[i.key]);
  return (
    <div style={{marginTop:10, border:"1px solid #B0892C55", borderRadius:9, padding:"10px 12px", background:"#B0892C08"}}>
      <div style={{fontSize:9.5, fontWeight:700, letterSpacing:"0.05em", color:C.red, textTransform:"uppercase", marginBottom:5}}>
        Still outstanding — stays tracked</div>
      {missing.map(i=><div key={i.key} style={{fontSize:12, color:C.text, marginLeft:4}}>· {i.label}</div>)}
      <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional) — e.g. cabinet plans due 9/15"
        style={{width:"100%", padding:"7px 9px", borderRadius:7, border:`1px solid ${C.border}`, fontSize:12.5,
          fontFamily:"inherit", color:C.text, outline:"none", marginTop:8, resize:"vertical", minHeight:44}}/>
      <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:8}}>
        <button onClick={()=>setConfirming(false)} style={{padding:"6px 12px", borderRadius:8, border:`1px solid ${C.border}`,
          background:"#fff", color:C.dim, fontWeight:600, fontSize:12, fontFamily:"inherit", cursor:"pointer"}}>Cancel</button>
        <button onClick={()=>{
            u({ prepOverride:{ on:true, by:(identity&&identity.name)||"", at:new Date().toISOString().slice(0,10), note:note.trim() },
                prepChecklist:{ ...(job.prepChecklist||{}) } });   // REQUIRED auto-flip guard — same as the tab
            setConfirming(false);
          }}
          style={{padding:"7px 14px", borderRadius:8, border:"1px solid #B0892C88", background:"#B0892C18",
            color:"#B0892C", fontWeight:700, fontSize:12, fontFamily:"inherit", cursor:"pointer"}}>Mark Ready to Start</button>
      </div>
    </div>
  );
}
```

Mount inside the Section:

```jsx
                <JobPrepDrawerOverride job={job} identity={identity} u={u}/>
```

(Check `identity` is in scope at the mount site before using it — anchor: `grep -n "myName={identity?.name}" src/App.js`. If the drawer receives it under another prop name, pass that.)

- [ ] **Step 5: Verify the full override loop in browser:** overriding a 3/5 job → toast, amber edge + badge + note line, job moves to "Rough — Not Started" on Upcoming Jobs, row STAYS in the prep lane, auto prep task in Tasks still present with "OVERRIDE ACTIVE"; check the 7-day/2-day prep nudges are untouched code (`git diff functions/` empty); undo restores everything; checking all 5 boxes on an overridden job hides badge/button and moves the row to the strip; unchecking one box brings the badge back (retained stamp — expected per spec); the DRAWER button opens the same outstanding-items + optional-note confirm (never a one-tap write), and its badge/undo mirror the tab state; a "standard"-tier user (foreman) sees no override button on either surface.
- [ ] **Step 6: Auto-flip guard test:** on a job with NO checklist object and an override, set Rough stage to 5% (fires the ~L26512 `prepStage` auto-flip), then verify the job still shows in the prep lane at 0/5 with OVERRIDE badge (the initialized empty checklist keeps `allPrepChecked` false).

---

### Task 6: Header counts, search, foreman filter, Show complete, lane pills, empty states

**Files:**
- Modify: `src/App.js` — `JobPrepTracker` header + lane blocks

**Interfaces:**
- Consumes: everything above. Produces the final component behavior; exact count formulas below are the spec's (do not improvise).

- [ ] **Step 1: Add filter state + derived sets.** This REPLACES all four earlier derivations (`aOpen`/`aDone` from Task 3, `pOpen`/`pDone` from Task 4) — delete those lines and use this block, which derives them from the filtered `vis` instead of `included`:

```jsx
  const [search, setSearch] = useState("");
  const [foremanFilter, setForemanFilter] = useState("");
  const [showComplete, setShowComplete] = useState(false);

  const foremenList = useMemo(() => {
    const s = new Set(); included.forEach(j => { if (j.foreman) s.add(j.foreman); });
    return Array.from(s).sort();
  }, [included]);

  const q = search.trim().toLowerCase();
  const filtered = !!(q || foremanFilter);
  const vis = included.filter(j =>
    (!q || `${j.name||""} ${j.gc||""} ${j.simproNo||""} ${j.foreman||""}`.toLowerCase().includes(q)) &&
    (!foremanFilter || j.foreman === foremanFilter));

  const aOpen = vis.filter(j => !adminAllHandled(j)), aDone = vis.filter(adminAllHandled);
  const pOpen = vis.filter(j => !allPrepChecked(j)), pDone = vis.filter(allPrepChecked);

  // Header counts — ALWAYS over the full included set (company-wide), never the filtered one.
  const held    = included.filter(j => !prepClearedToStart(j)).length;
  const onOvr   = included.filter(j => j.prepOverride && j.prepOverride.on && !allPrepChecked(j)).length;
  const cleared = included.filter(prepClearedToStart).length;
```

- [ ] **Step 2: Header subtitle + controls.** Replace the `{included.length} active jobs` line and add controls to the pagehead's right side:

```jsx
          <div style={{fontSize:12,color:C.dim,marginTop:4}}>
            {included.length} active jobs
            {held > 0 && <span style={{color:C.red,fontWeight:700}}> · {held} held in prep</span>}
            {onOvr > 0 && <span style={{color:"#B0892C",fontWeight:700}}> · {onOvr} started on override</span>}
            <span style={{color:"#3E7D5A",fontWeight:700}}> · {cleared} cleared to start</span>
            {filtered && <span> · totals are all jobs — lanes below are filtered</span>}
          </div>
```

```jsx
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs…"
            style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:"#fff",
              color:C.text,fontFamily:"inherit",outline:"none",minWidth:240}}/>
          <select value={foremanFilter} onChange={e=>setForemanFilter(e.target.value)}
            style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:"#fff",
              color:C.text,fontFamily:"inherit",outline:"none"}}>
            <option value="">All foremen</option>
            {foremenList.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={()=>{ const v=!showComplete; setShowComplete(v); setStripOpen({admin:v,prep:v}); }}
            style={{padding:"6px 12px",borderRadius:7,fontSize:12,border:`1px solid ${C.border}`,
              background: showComplete ? C.accent : "#fff", color: showComplete ? "#fff" : C.dim,
              cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>{showComplete?"Hide complete":"Show complete"}</button>
        </div>
```

- [ ] **Step 3: Lane pills + no-match empty states.** In each lane header, after the Bebas title, add its pill; and swap each lane's empty message for a filter-aware one:

```jsx
          {/* admin lane pill */}
          <span style={{borderRadius:99,padding:"2px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",
            background:"#B23A3A14",border:"1px solid #B23A3A33",color:"#B23A3A"}}>
            {vis.filter(j=>adminItemState(j,JOBPREP_ADMIN_ITEMS[0])==="todo").length} no account
            {" · "}{vis.filter(j=>adminItemState(j,JOBPREP_ADMIN_ITEMS[1])==="todo").length} no pre-lien
            {" · "}{vis.filter(j=>adminItemState(j,JOBPREP_ADMIN_ITEMS[2])==="todo").length} no ped
          </span>
```

```jsx
          {/* prep lane pill */}
          <span style={{borderRadius:99,padding:"2px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",
            background:"#3E7D7A14",border:"1px solid #3E7D7A33",color:"#3E7D7A"}}>
            {pOpen.length} not complete{pOpen.filter(j=>j.prepOverride&&j.prepOverride.on).length>0
              ? ` · ${pOpen.filter(j=>j.prepOverride&&j.prepOverride.on).length} overridden` : ""}
          </span>
```

```jsx
          {/* empty-state pattern — apply to BOTH lanes (admin shown; prep lane's fallback text stays "✓ All prep complete") */}
          {aOpen.length === 0
            ? <div style={{fontSize:12,color:C.dim,textAlign:"center",padding:"18px 0"}}>
                {filtered && vis.length===0 ? "No jobs match the search / filter" : "✓ Every job has account, pre-lien, and ped handled"}
              </div>
            : aOpen.map(j => <JobPrepAdminRow key={j.id} job={j} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob} onOpenMenu={openMenu}/>)}
```

- [ ] **Step 4: Verify in browser:** search narrows both lanes and their pills while the header totals hold steady with the "totals are all jobs" hint; a no-match search shows "No jobs match", not the green message; foreman filter works; Show complete expands both strips and manual strip clicks survive typing in search (state-based, not re-render-clobbered); the "started on override" count drops when an overridden job's last box is checked.
- [ ] **Step 5: Mobile pass:** at 375px (device emulation): no horizontal scroll, chips wrap, modal fits, menu popover stays on-screen, all tap targets usable.

---

### Task 7: SOP guide for the tab's "?"

**Files:**
- Create: `public/sops/jobprep.html`

**Interfaces:**
- Consumes: the `<HelpDot section="jobprep"/>` mounted in Task 2. The prebuild (`scripts/version-from-sw.js`) scans `public/sops/`, reads each guide's own `<title>`, and REGENERATES `SOP_FILES_INLINE` — **never hand-edit that block in App.js.**
- Produces: the tab's working "?" after the next build.

- [ ] **Step 1: Create the guide.** A hand-authored interim guide is fine (Koy re-records with SOP Recorder later — the vault checklist tracks that). It must carry its own `<title>`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Job Prep — Office Guide</title>
<style>
  body{font-family:-apple-system,'DM Sans',sans-serif;color:#1B1F24;background:#F4F6F8;margin:0;padding:24px;line-height:1.55;}
  .wrap{max-width:720px;margin:0 auto;background:#fff;border:1px solid #E1E4E9;border-radius:12px;padding:22px 26px;}
  h1{font-size:22px;margin:0 0 4px;} h2{font-size:15px;margin:20px 0 6px;color:#3B5BA5;}
  p,li{font-size:14px;color:#333;} .tag{display:inline-block;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700;}
</style>
</head>
<body><div class="wrap">
<h1>Job Prep — Office Guide</h1>
<p>One board for everything that has to happen before a job breaks ground. Office only (admin + manager).</p>
<h2>Office Admin lane (Justin)</h2>
<p>Every active job shows three chips: <b>ACCOUNT</b>, <b>PRE-LIEN</b>, <b>TEMP PED</b>. Tap a chip to mark it done;
tap the small ▾ for the menu — including <b>Not needed (N/A)</b> for jobs that genuinely don't need one (gray chip,
counts as handled). When Temp Ped is done, pick the Ped # right on the row. When all three are done or N/A, the
row drops into the ✓ complete strip.</p>
<h2>Pre-Job Prep lane (Koy)</h2>
<p>The five prep checklist items are tappable right on the board — redline plans, cabinet plans, appliance specs,
plans uploaded, hand-off. The row shows the prep stage, progress, and what's next.</p>
<h2>Start Without Full Prep (the override)</h2>
<p>When a job needs to start but something (usually cabinet plans) hasn't arrived: hit <b>START WITHOUT FULL PREP</b>,
add a note if useful, and confirm. The job immediately shows as <b>Rough — Not Started</b> on Upcoming Jobs — but the
missing items STAY red on this board with an amber OVERRIDE badge until they're actually checked off. Nothing gets
forgotten. Undo any time. The override records who cleared it and when.</p>
<h2>Counts up top</h2>
<p><b>Held in prep</b> = jobs the gate is still blocking. <b>Started on override</b> = running jobs with prep items
still owed. <b>Cleared to start</b> = fully prepped or overridden. Totals are company-wide even when you filter.</p>
</div></body>
</html>
```

- [ ] **Step 2: Verify (only meaningful AFTER a build has run — run `CI=true npm run build` here, or fold this check into Task 8 Step 4):** `grep -c '"/sops/jobprep.html"' src/App.js` — Expected: exactly `1` (the regenerated `SOP_FILES_INLINE` entry; nothing else in the file matches that string). In the browser the tab's "?" opens the guide, and the prebuild output must NOT warn about an unmatched `jobprep` key (the Task 2 HelpDot mount satisfies it).

---

### Task 8: Ship — SW bump, FEATURES.md, collision check, one-paste

**Files:**
- Modify: `public/service-worker.js` line 1, `FEATURES.md`

- [ ] **Step 1: Collision check.** `git status` + `git diff --stat`. The pre-existing uncommitted v386 work (App.js/SW/FEATURES from another session) may still be in the tree: if so, STOP and surface it to Koy — bundle (Option A) or let the other session commit first + `git pull --rebase` (Option B). Never `git checkout`/`git restore`.
- [ ] **Step 2: SW bump.** `public/service-worker.js` line 1 → next unused version (current tree shows `homestead-v386`; bump to the version AFTER whatever is current at ship time).
- [ ] **Step 3: FEATURES.md entry** following the file's existing entry format, tagged with the exact SW version (the build FAILS if the shipped SW version isn't mentioned). Content: Job Prep tab (two lanes, N/A, override), the gate split, the auto-flip guard, and the data-safety line.
- [ ] **Step 4: Final build gate.** `CI=true npm run build` — full output, never piped. Must pass.
- [ ] **Step 5: Full regression sweep in browser** (build-preview): every Task 3-6 verify list, plus: Upcoming Jobs board, Tasks view, drawer, and the CO tab all behave normally; no console errors anywhere.
- [ ] **Step 6: One-paste for Koy** (adjust the file list to what actually changed):

```
cd ~/Desktop/homestead-electric && git add src/App.js public/service-worker.js FEATURES.md public/sops/jobprep.html docs/superpowers/specs/2026-08-28-job-prep-tab-design.md docs/superpowers/plans/2026-08-28-job-prep-tab.md jobprep-mockup.html && git commit -m "Job Prep tab: admin + prep lanes, N/A, start-without-full-prep override (SW vNNN)" && git push
```

  With the data-safety note: *additive only — two new nested fields (`adminNA`, `prepOverride`) inside `job.data` through the existing saveJob patch funnel; the gate rename is behavior-identical for every job without an override; no loader, rules, functions, or existing-field changes; the override's `prepChecklist:{}` initialization only ever creates an empty object where none existed.*
- [ ] **Step 7: Post-ship close-out:** verify prod after Vercel deploy (~60s + SW refresh); write the daily vault log (`~/Desktop/Command Center/Logs/2026-08-28 - Homestead Electric.md` convention, wikilinks to the feature note); add a feature note + update `11-Trainings/In-App SOP Recordings - Checklist.md` with the jobprep guide row; update auto-memory if new lessons surfaced.

---

## Self-review notes (done at write time)

- Spec coverage: data model (T3 S1-2, T5), gate split + consumer matrix (T1), tab/nav/permission (T2), admin lane + N/A (T3), prep lane + stage colors (T4), override incl. auto-flip guard + drawer button (T5), header counts/filters/empty states/sort (T3 S1 + T6), SOP + HelpDot (T2 S3 + T7), ship checklist (T8), functions untouched (Global Constraints + T5 S5). Cloud Functions rows: no task — correct, v1 leaves them.
- Type consistency: `allPrepChecked`/`prepClearedToStart` (T1) used in T4-T6 by those names; `onUpdateJob(jobId, patch)` signature consistent T2-T6; `adminItemPatch(job, item, target)` consistent T3; `prepOverride` shape identical in T5 tab + drawer.
- No placeholders: every step carries real code or an exact command/expected result.
