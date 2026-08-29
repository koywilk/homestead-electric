# Redline Walk Strip in Job Prep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline — this is a single-file change in `src/App.js`) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Surface each job's redline walk (Scheduled + date, Walk Completed) as a strip in the Job Prep tab's Pre-Job Prep lane, reading/writing the shared `redlineWalks` record so it mirrors the Change Orders board.

**Architecture:** Reuse the existing top-level `redlineWalks` collection and its `onAddRedline`/`onUpdateRedline` handlers. Add one pure selector (`activeRedlineWalk`), thread `redlineWalks` + the two handlers into `JobPrepTracker`, and render a new `JobPrepWalkStrip` inside `JobPrepPrepRow`. Visible tracking only — no gate functions change.

**Tech Stack:** React (CRA), single file `src/App.js`. No test framework — verification is `CI=true npm run build` (must stay green) + manual check against the CO board.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-29-jobprep-redline-walk-strip-design.md`.
- Additive only: no new field, no new collection, no migration; writes go through the existing whole-doc `onUpdateRedline({ ...walk, ...patch })` / `onAddRedline(patch)` funnel.
- No gate change: `allPrepChecked` / `prepClearedToStart` must be byte-identical in behavior.
- Prep owns `scheduled ↔ plans_prep`; `co_owed`/`co_sent`/`signed` render read-only in prep.
- Walk date is display/edit only — NO reminders/nudges.
- Ship hygiene at the end: SW cache bump, FEATURES.md entry, `public/sops/jobprep.html` line, green build. Koy pushes.

---

### Task 1: `activeRedlineWalk` selector

**Files:** Modify `src/App.js` — insert after `prepStageColor` (~L48896), before `function JobPrepJobInfo`.

**Interfaces:**
- Consumes: `parseAnyDate` (existing), the `redlineWalks` array shape (`{id, jobId, status, walkDate, createdAt, coQuoteNumber, ...}`).
- Produces: `activeRedlineWalk(job, redlineWalks) → walk | null`.

- [ ] **Step 1: Add the helper**

```js
// The one redline walk a job's prep row surfaces: the newest still-open walk
// (unsigned, unquoted) linked to this job, else the newest walk of any status,
// else null (the row shows "＋ Schedule Redline Walk"). Repeat walks are created
// from the CO board, not prep — prep only ever edits the active one.
const activeRedlineWalk = (job, redlineWalks) => {
  const linked = (redlineWalks || []).filter(w => w && w.jobId === job.id);
  if (!linked.length) return null;
  const open = linked.filter(w => w.status !== "signed" && !w.coQuoteNumber);
  const pool = open.length ? open : linked;
  const ts = w => { const d = parseAnyDate(w.walkDate) || parseAnyDate(w.createdAt); return d ? d.getTime() : 0; };
  return pool.slice().sort((a, b) => ts(b) - ts(a))[0];
};
```

- [ ] **Step 2: Build** — `CI=true npm run build` → must compile (no consumers yet; just confirms syntax + no-undef).

---

### Task 2: `JobPrepWalkStrip` component

**Files:** Modify `src/App.js` — insert immediately after `activeRedlineWalk` (before `JobPrepJobInfo`).

**Interfaces:**
- Consumes: `REDLINE_STATUSES` (existing), `C` (palette), `jobPrepLocalDate` (existing, ~L48866), `onAddRedline(patch)`, `onUpdateRedline(fullWalk)`.
- Produces: `<JobPrepWalkStrip job walk onAddRedline onUpdateRedline />`.

- [ ] **Step 1: Add the component**

```js
// Redline-walk strip on a Pre-Job Prep row. Reads/writes the SHARED redlineWalks
// record (same doc the CO board edits) via the passed handlers — visible tracking
// only, never touches the prep gate. Prep owns scheduled↔plans_prep; co_owed+ is
// Jeromy's and shows read-only. onUpdateRedline gets the WHOLE live walk spread
// with the change (the CO board's clobber-safe whole-doc write contract).
function JobPrepWalkStrip({ job, walk, onAddRedline, onUpdateRedline }) {
  const RL = "#6A5E97";                                   // C.purple — matches the CO board walk chip
  const wrap = { marginTop:6, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" };
  if (!walk) {
    return (
      <button onClick={() => onAddRedline && onAddRedline({
          jobId: job.id, address: job.name || "", status: "scheduled", walkDate: jobPrepLocalDate() })}
        style={{ marginTop:6, background:"none", border:`1px dashed ${RL}66`, color:RL, borderRadius:8,
          fontSize:10.5, fontWeight:700, letterSpacing:"0.04em", padding:"6px 10px", cursor:"pointer",
          fontFamily:"inherit" }}>
        ＋ SCHEDULE REDLINE WALK
      </button>
    );
  }
  const st = REDLINE_STATUSES.find(s => s.value === walk.status) || REDLINE_STATUSES[0];
  const set = (patch) => onUpdateRedline && onUpdateRedline({ ...walk, ...patch });
  const pill = (color) => ({ fontSize:10, fontWeight:800, letterSpacing:"0.06em", color,
    background:`${color}14`, border:`1px solid ${color}44`, borderRadius:99, padding:"4px 10px" });
  if (walk.status === "scheduled") {
    return (
      <div style={wrap}>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:"0.06em", color:RL }}>REDLINE WALK</span>
        <input type="date" value={walk.walkDate || ""} onChange={e => set({ walkDate: e.target.value })}
          style={{ border:`1px solid ${RL}44`, background:`${RL}0C`, color:RL, borderRadius:7,
            fontSize:11, fontWeight:700, padding:"5px 8px", fontFamily:"inherit", cursor:"pointer" }}/>
        <button onClick={() => set({ status: "plans_prep" })}
          style={{ background:RL, border:"none", color:"#fff", borderRadius:7, fontSize:10.5, fontWeight:700,
            letterSpacing:"0.04em", padding:"6px 12px", cursor:"pointer", fontFamily:"inherit" }}>
          WALK DONE
        </button>
      </div>
    );
  }
  if (walk.status === "plans_prep") {
    return (
      <div style={wrap}>
        <span style={pill(st.color)}>✓ {st.label}</span>
        {walk.walkDate && <span style={{ fontSize:10.5, color:C.dim }}>{walk.walkDate}</span>}
        <span onClick={() => set({ status: "scheduled" })} title="Back to scheduled"
          style={{ fontSize:12, color:C.dim, cursor:"pointer", padding:"2px 6px" }}>↩</span>
      </div>
    );
  }
  // co_owed / co_sent / signed — Jeromy's territory: read-only tail.
  return (
    <div style={wrap}>
      <span style={pill(st.color)}>{st.label}</span>
      {walk.coQuoteNumber && <span style={{ fontSize:10.5, color:C.dim }}>CO #{walk.coQuoteNumber}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Build** — `CI=true npm run build` → must compile (no consumers yet).

---

### Task 3: Render the strip in `JobPrepPrepRow`

**Files:** Modify `src/App.js` — `JobPrepPrepRow` signature (~L48954) + the middle column's closing (~L49011).

**Interfaces:**
- Consumes: `JobPrepWalkStrip` (Task 2), new props `walk`, `onAddRedline`, `onUpdateRedline`.
- Produces: `JobPrepPrepRow` now expects `walk`, `onAddRedline`, `onUpdateRedline`.

- [ ] **Step 1: Add props to the signature**

Change `function JobPrepPrepRow({ job, onSelectJob, onUpdateJob, onOpenMenu, canOverride, onStartOverride, onUndoOverride }) {`
to add `, walk, onAddRedline, onUpdateRedline` before the closing `}`.

- [ ] **Step 2: Render the strip at the end of the middle column**

Immediately before the middle column's closing `</div>` (the one closing `<div style={{flex:"1 1 260px"}}>`, right after the `legacy ? ... : <>...</>` conditional), insert:

```jsx
          <JobPrepWalkStrip job={job} walk={walk} onAddRedline={onAddRedline} onUpdateRedline={onUpdateRedline}/>
```

- [ ] **Step 3: Build** — `CI=true npm run build` → must compile.

---

### Task 4: Thread props through `JobPrepTracker` + render site

**Files:** Modify `src/App.js` — `JobPrepTracker` signature (~L49123), its 3 `JobPrepPrepRow` call sites (~L49275/49278/49281), and the render site (~L55903).

**Interfaces:**
- Consumes: `activeRedlineWalk` (Task 1); at the render site, in-scope `redlineWalks`, `addRedlineWalk`, `updateRedlineWalk`.
- Produces: `JobPrepTracker` accepts `redlineWalks`, `onAddRedline`, `onUpdateRedline`.

- [ ] **Step 1: Add props + `walksByJob` memo**

Signature → `function JobPrepTracker({ jobs = [], identity, onSelectJob, onUpdateJob, redlineWalks = [], onAddRedline, onUpdateRedline }) {`

Near the top of the component body (after the existing hooks), add:

```js
  const walksByJob = useMemo(() => {
    const m = new Map();
    (jobs || []).forEach(j => { const w = activeRedlineWalk(j, redlineWalks); if (w) m.set(j.id, w); });
    return m;
  }, [jobs, redlineWalks]);
```

- [ ] **Step 2: Pass walk + handlers at all 3 `JobPrepPrepRow` call sites**

To each `<JobPrepPrepRow ... />` (the `pHeld`, `pOvr`, and `pDone` maps), add:

```jsx
 walk={walksByJob.get(j.id)||null} onAddRedline={onAddRedline} onUpdateRedline={onUpdateRedline}
```

- [ ] **Step 3: Wire the render site**

At `<JobPrepTracker ... />` (~L55903), add three props:

```jsx
          redlineWalks={redlineWalks}
          onAddRedline={addRedlineWalk}
          onUpdateRedline={updateRedlineWalk}
```

- [ ] **Step 4: Build + manual verify**

Run `CI=true npm run build` (green). Then in the running app, on the Job Prep tab:
1. A held prep job with no walk shows `＋ SCHEDULE REDLINE WALK` → tap → the CO board shows a "Walk Scheduled" card linked to that job.
2. Edit the date in prep → same date on the CO card; edit on the CO card → prep updates.
3. `WALK DONE` → CO card moves to "Cleaning Plans"; `↩` reverts.
4. Advance to `co_owed`+ on the CO board → prep shows the read-only tail.
5. Prep completion gate unchanged (scheduled-but-undone walk doesn't hold/clear a job).

---

### Task 5: Ship hygiene

**Files:** `public/service-worker.js`, `FEATURES.md`, `public/sops/jobprep.html`.

- [ ] **Step 1:** Bump `CACHE` in `public/service-worker.js` to the next version (`v389 → v390`).
- [ ] **Step 2:** Add a FEATURES.md App-map entry tagged `SW v390` under the Job Prep area, and update the manifest header line.
- [ ] **Step 3:** Add a short line to `public/sops/jobprep.html` describing the redline-walk strip (standing "guides track the app" rule).
- [ ] **Step 4:** `CI=true npm run build` green (prebuild gate finds v390 in FEATURES.md).
- [ ] **Step 5:** Produce the one-paste (deploy-hygiene) for Koy to push. Data-safety line: "Additive UI over the existing redlineWalks collection; writes go through the same onAddRedline/onUpdateRedline whole-doc funnel the CO board uses — no new field/collection/migration, no gate change."

## Self-Review

- **Spec coverage:** walk strip (Task 2/3), sync via shared record (Tasks 1–4), date display-only (Task 2 scheduled state), no gate change (Global Constraints; no gate fn touched), active-walk selector (Task 1), read-only Jeromy tail (Task 2), create-from-prep (Task 2 no-walk state), out-of-scope drawer/reminders/multi-walk (not built). ✓
- **Placeholders:** none — every step has real code. ✓
- **Type consistency:** `activeRedlineWalk(job, redlineWalks)`, `JobPrepWalkStrip({job,walk,onAddRedline,onUpdateRedline})`, `onUpdateRedline(fullWalk)`, `onAddRedline(patch)` consistent across Tasks 1–4. ✓
