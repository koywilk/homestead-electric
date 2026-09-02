# Forecast → Kanban Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Koy clear the Forecast → Kanban board inline — demote Ready-to-Invoice to a notification, snooze stale scheduling cards, and collapse columns — without hunting for jobs under each foreman.

**Architecture:** All changes live in the `SchedulingForecast` component (`src/App.js` ~L34039) and its `buildEvents`/`EventCard`/Kanban render. Forecast cards are *derived* from job state, so "clear" means flipping a reversible flag (`invoiceDismissed`) or writing a per-job `forecastSnooze` map — never deleting a row. Writes go through the existing `onUpdateJob({...job,...patch}, patch)` → `saveJob` funnel. Verification is a pure-logic node dry-run (the project's slice-real-source pattern) plus a CI build and live browser smoke.

**Tech Stack:** React (single `src/App.js`), Firestore, CRA build, Node dry-run harnesses in `scripts/`.

## Global Constraints

- **Work only in `~/Desktop/homestead-electric`** (the git repo). NOT `~/Documents/...` (stale copy).
- **The model never runs git.** Koy commits and pushes. Each task ends in a *Checkpoint* (build/harness), and Task 7 produces the single one-paste for Koy. No per-task commits.
- **No emojis in app UI.** Use existing `<Icon name="..."/>` glyphs or plain typographic chars already in use (`✕` per App.js:6939, `▾`). Do not introduce emoji.
- **Mobile/desktop parity is required.** The Clear affordance must not be hover-only — it is always visible on touch / narrow viewports.
- **All job writes:** `onUpdateJob({ ...job, ...patch }, patch)` — the full merged job first, patch delta second (App.js:53380). Gate every write on `canEdit`.
- **New field `forecastSnooze` lives inside the job `data` envelope** — the loader auto-unwraps it to `job.forecastSnooze` (App.js:44066). **No loader spread change.** It follows the existing `taskDueDates` map precedent (App.js:32819) exactly (whole-map replace on write).
- **Ship as SW v392.** Bump `public/service-worker.js` line 1 to `homestead-v392`. Add the v392 entry to `FEATURES.md` (the prebuild gate blocks any build whose SW version isn't in FEATURES.md).
- **Build check:** `CI=true npm run build`. **Never pipe it** (e.g. `| tail`) — piping masks the prebuild-gate failure. If CRA stalls on iCloud-dataless `node_modules`, materialize first / use the `.claude` build server.
- **Snooze applies to scheduling event types only** (`rough`, `finish`, `qc`, `rt_*`, `co_*`, `quick`). Invoice-flavored events get **Dismiss**, never Snooze.

---

## File structure

- `src/App.js` — all app changes:
  - Module-level: three pure helpers near `parseAnyDate` (App.js:31510) — `forecastEventSuffix`, `isForecastSnoozed`, `forecastSnoozePatch`.
  - `SchedulingForecast` (App.js:34039): `buildEvents` filter + invoice-dismiss gate; component write helpers + `undoToast`; invoice-notification render + bottom grouping; `EventCard` Clear/Snooze menu; collapsible column headers.
- `scripts/forecast-snooze-dryrun.js` — pure-logic node harness (no Firestore).
- `public/service-worker.js` — cache bump to v392.
- `FEATURES.md` — v392 entry.
- `public/sops/forecast.html` — SOP update (Clear/Snooze/collapse).

---

## Task 1: Snooze/dismiss logic in `buildEvents` (+ dry-run harness)

**Files:**
- Modify: `src/App.js` — add three module-level helpers near `parseAnyDate` (App.js:31510); wire into `buildEvents` (App.js:35171–35313), specifically the rough/finish `isInv` pushes (App.js:35210, 35238) and the `return events` line (App.js:35312).
- Create: `scripts/forecast-snooze-dryrun.js`

**Interfaces:**
- Produces:
  - `forecastEventSuffix(ev) -> string` — the event id minus `` `${job.id}_` ``.
  - `isForecastSnoozed(job, suffix, todayMidnight) -> boolean` — true while a snooze date is in the future.
  - `forecastSnoozePatch(job, suffix, isoDate) -> { forecastSnooze: object }` — merges one key, preserving others.

- [ ] **Step 1: Write the failing harness**

Create `scripts/forecast-snooze-dryrun.js`:

```js
#!/usr/bin/env node
/* READ-ONLY pure-logic dry-run for the Forecast snooze/dismiss helpers.
 * parseAnyDate + the three helpers are copied VERBATIM from src/App.js.
 * No Firestore, writes nothing. Run: node scripts/forecast-snooze-dryrun.js */

// ── verbatim from src/App.js:31510 ──
const parseAnyDate = (str) => {
  if(!str) return null;
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(mdy) { let [,m,d,y] = mdy; if(y.length===2) y = "20"+y; return new Date(+y, +m-1, +d); }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

// ── verbatim from src/App.js (the helpers this task adds) ──
const forecastEventSuffix = (ev) => ev.id.slice(ev.job.id.length + 1);
const isForecastSnoozed = (job, suffix, todayMidnight) => {
  const sd = job?.forecastSnooze?.[suffix];
  if (!sd) return false;
  const d = parseAnyDate(sd);
  if (!d) return false;
  const c = new Date(d); c.setHours(0, 0, 0, 0);
  return c > todayMidnight;
};
const forecastSnoozePatch = (job, suffix, isoDate) => ({
  forecastSnooze: { ...(job.forecastSnooze || {}), [suffix]: isoDate },
});

// ── assertions ──
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const today = new Date(); today.setHours(0,0,0,0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const plusDays = (n) => { const d = new Date(today); d.setDate(today.getDate()+n); return d; };

ok(forecastEventSuffix({id:"job1_rough", job:{id:"job1"}}) === "rough", "suffix: rough");
ok(forecastEventSuffix({id:"job1_finish", job:{id:"job1"}}) === "finish", "suffix: finish");
ok(forecastEventSuffix({id:"job1_rt_abc9", job:{id:"job1"}}) === "rt_abc9", "suffix: rt_<id>");
ok(forecastEventSuffix({id:"job1_co_77", job:{id:"job1"}}) === "co_77", "suffix: co_<id>");

ok(isForecastSnoozed({forecastSnooze:{rough:iso(plusDays(3))}}, "rough", today) === true,  "future snooze hides");
ok(isForecastSnoozed({forecastSnooze:{rough:iso(plusDays(-3))}}, "rough", today) === false, "past snooze shows again");
ok(isForecastSnoozed({forecastSnooze:{rough:iso(today)}}, "rough", today) === false, "today snooze shows (not > today)");
ok(isForecastSnoozed({}, "rough", today) === false, "no map -> not snoozed");
ok(isForecastSnoozed({forecastSnooze:{qc:iso(plusDays(3))}}, "rough", today) === false, "different key -> not snoozed");
ok(isForecastSnoozed({forecastSnooze:{rough:"garbage"}}, "rough", today) === false, "unparseable date -> not snoozed (never hide by accident)");

const merged = forecastSnoozePatch({forecastSnooze:{qc:iso(plusDays(3))}}, "rough", iso(plusDays(7))).forecastSnooze;
ok(merged.qc && merged.rough, "patch preserves existing keys while adding one");
ok(Object.keys(forecastSnoozePatch({}, "rough", iso(today)).forecastSnooze).length === 1, "patch works from empty");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/forecast-snooze-dryrun.js`
Expected: the file runs but this proves the *intended* logic before it exists in App.js. (The harness carries its own copy, so it passes here; the real check is Step 4 — that the copies match App.js.) If any assertion prints FAIL, the helper logic is wrong — fix before porting.

- [ ] **Step 3: Add the three helpers to `src/App.js`**

Immediately after `parseAnyDate` (after App.js:31524), paste the three helpers **verbatim identical** to the harness copies:

```js
// ── Forecast snooze/dismiss helpers ─────────────────────────────────────────
// Forecast cards are DERIVED from job state, so "snooze" is a per-job map keyed
// by the event's id suffix (the part after `${job.id}_`): rough / finish / qc /
// rt_<id> / co_<id> / quick. Value is a date; the card hides until it passes,
// then returns. Invoice-flavored events never snooze — they use invoiceDismissed.
const forecastEventSuffix = (ev) => ev.id.slice(ev.job.id.length + 1);
const isForecastSnoozed = (job, suffix, todayMidnight) => {
  const sd = job?.forecastSnooze?.[suffix];
  if (!sd) return false;
  const d = parseAnyDate(sd);
  if (!d) return false;
  const c = new Date(d); c.setHours(0, 0, 0, 0);
  return c > todayMidnight;
};
const forecastSnoozePatch = (job, suffix, isoDate) => ({
  forecastSnooze: { ...(job.forecastSnooze || {}), [suffix]: isoDate },
});
```

- [ ] **Step 4: Wire the snooze filter into `buildEvents`**

At the end of `buildEvents` (App.js:35312), change:

```js
    });
    return events;
  };
```
to:
```js
    });
    // Drop snoozed scheduling cards from EVERY forecast view + the tab counts.
    return events.filter(ev => !isForecastSnoozed(ev.job, forecastEventSuffix(ev), today));
  };
```

- [ ] **Step 5: Gate the rough/finish invoice-flavored cards on `invoiceDismissed`**

So one Dismiss also clears a phase stuck at `status==="invoice"`. At App.js:35210, change the rough push condition:

```js
        if(start||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"||rs==="inprogress"||isInv) events.push({
```
to:
```js
        if((start||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"||rs==="inprogress"||isInv) && !(isInv && job.invoiceDismissed)) events.push({
```
Apply the identical change to the finish push at App.js:35238 (`fs`/`isInv`).

- [ ] **Step 6: Re-run the harness + build**

Run: `node scripts/forecast-snooze-dryrun.js`
Expected: `ALL PASS`.
Run: `CI=true npm run build`
Expected: build succeeds (this change is additive; a job with no `forecastSnooze` and no `invoiceDismissed` yields byte-identical events).

- [ ] **Step 7: Checkpoint** — harness green, build green. No commit (see Global Constraints).

---

## Task 2: Component write helpers + `undoToast`

**Files:**
- Modify: `src/App.js` — inside `SchedulingForecast` (App.js:34039), near the existing component helpers (e.g. just after the `getBucket`/`isOverdue` block ~App.js:35169).

**Interfaces:**
- Consumes: `onUpdateJob`, `canEdit` props (App.js:55878–55880); `forecastEventSuffix`, `forecastSnoozePatch` (Task 1); `useState`, `useEffect`, `Icon`, `C`.
- Produces (for Tasks 3–5):
  - `patchJob(job, patch)` — gated write.
  - `dismissInvoice(ev)` — sets `{invoiceDismissed:true}` + stages undo.
  - `snoozeEvent(ev, isoDate)` — writes `forecastSnooze` + stages undo.
  - `isoPlusDays(n) -> "YYYY-MM-DD"`.
  - `undoToast` state + `commitUndo()` + a rendered undo bar.

- [ ] **Step 1: Add the write + undo helpers**

Inside `SchedulingForecast`, after the date helpers (~App.js:35169), add:

```js
  // ── Inline clear: write helpers + reversible undo (mirrors App.js:6857) ──
  const patchJob = (job, patch) => { if (canEdit && onUpdateJob) onUpdateJob({ ...job, ...patch }, patch); };
  const isoPlusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

  const [undoToast, setUndoToast] = useState(null); // {label, job, prevPatch, timer}
  useEffect(() => () => { if (undoToast?.timer) clearTimeout(undoToast.timer); }, [undoToast]);
  const stageUndo = (label, job, prevPatch) => {
    if (undoToast?.timer) clearTimeout(undoToast.timer);
    const timer = setTimeout(() => setUndoToast(null), 10000);
    setUndoToast({ label, job, prevPatch, timer });
  };
  const commitUndo = () => {
    if (!undoToast) return;
    const { job, prevPatch, timer } = undoToast;
    if (timer) clearTimeout(timer);
    patchJob(job, prevPatch);
    setUndoToast(null);
  };

  const dismissInvoice = (ev) => {
    const prevPatch = { invoiceDismissed: !!ev.job.invoiceDismissed }; // pre-image (false)
    patchJob(ev.job, { invoiceDismissed: true });
    stageUndo(`Dismissed ${ev.job.name || "invoice"}`, ev.job, prevPatch);
  };
  const snoozeEvent = (ev, isoDate) => {
    const prevPatch = { forecastSnooze: { ...(ev.job.forecastSnooze || {}) } }; // pre-image map
    patchJob(ev.job, forecastSnoozePatch(ev.job, forecastEventSuffix(ev), isoDate));
    stageUndo(`Snoozed ${ev.job.name || "card"}`, ev.job, prevPatch);
  };
```

- [ ] **Step 2: Render the undo bar**

Inside the component's top-level returned `<div>` (App.js:35566), just before its closing `</div>` (after the view blocks, ~App.js:36xxx — the last child before the component returns), add:

```jsx
      {undoToast && (
        <div style={{position:"fixed",left:"50%",bottom:20,transform:"translateX(-50%)",zIndex:200,
          display:"flex",alignItems:"center",gap:10,background:"#1B1F24",color:"#EEF0F3",
          borderRadius:9,padding:"9px 13px",border:`1px solid ${C.border}`,
          boxShadow:"0 8px 24px rgba(0,0,0,0.35)",fontSize:12,maxWidth:"92vw"}}>
          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{undoToast.label}</span>
          <button onClick={commitUndo}
            style={{background:C.blue,color:"#fff",border:"none",borderRadius:6,
              padding:"4px 12px",fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Undo</button>
          <button onClick={()=>{ if(undoToast.timer) clearTimeout(undoToast.timer); setUndoToast(null); }}
            style={{background:"none",border:"none",color:"#8A929D",cursor:"pointer",fontSize:14,padding:"0 4px"}}>✕</button>
        </div>
      )}
```

- [ ] **Step 3: Build**

Run: `CI=true npm run build`
Expected: build succeeds. (Helpers are defined but not yet called — no behavior change on screen. `canEdit` gating means read-only users never trigger a write.)

- [ ] **Step 4: Checkpoint** — build green. No commit.

---

## Task 3: Invoice notifications — bottom grouping + Dismiss

**Files:**
- Modify: `src/App.js` — the Kanban bucket render (App.js:35631–35652); add an `InvoiceNote` inline renderer near `EventCard` (App.js:35374).

**Interfaces:**
- Consumes: `dismissInvoice`, `undoToast` (Task 2); `EventCard`, `C`, `onSelectJob`, `canEdit`.
- Produces: invoice events render as demoted notification rows grouped under a `Ready to invoice (N)` divider at the bottom of each bucket.

- [ ] **Step 1: Add the `InvoiceNote` renderer**

Just after `EventCard` (App.js:35374 block ends), add inside `SchedulingForecast`:

```jsx
  const InvoiceNote = ({ ev }) => (
    <div onClick={()=>onSelectJob(ev.job)}
      style={{position:"relative",display:"flex",alignItems:"center",gap:9,cursor:"pointer",
        background:"#B06A2C10",border:"1px solid #B06A2C33",borderLeft:"2px solid #B06A2C",
        borderRadius:10,padding:"8px 10px",marginBottom:6}}>
      <span style={{width:22,height:22,borderRadius:6,flexShrink:0,display:"inline-flex",
        alignItems:"center",justifyContent:"center",background:"#B06A2C22",color:"#B06A2C",
        fontWeight:800,fontSize:13}}>$</span>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:8.5,fontWeight:800,letterSpacing:"0.08em",color:"#B06A2C"}}>READY TO INVOICE · {ev.job.foreman||"Koy"}</div>
        <div style={{fontSize:12,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.job.name||"Untitled"}</div>
      </div>
      {canEdit && (
        <button title="Dismiss — off the board" aria-label="Dismiss invoice notification"
          onClick={(e)=>{ e.stopPropagation(); dismissInvoice(ev); }}
          style={{width:22,height:22,borderRadius:6,flexShrink:0,border:"1px solid transparent",
            background:"none",color:"var(--dim)",cursor:"pointer",fontSize:15,lineHeight:1}}>✕</button>
      )}
    </div>
  );
```

- [ ] **Step 2: Split each bucket into scheduling + invoice, group invoice at bottom**

In the Kanban render (App.js:35645–35649), replace:

```jsx
                    {bEvs.length===0
                      ?<div style={{fontSize:11,color:"var(--muted)",fontStyle:"italic",padding:"16px 0",
                          textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>Empty</div>
                      :bEvs.map(ev=><EventCard key={ev.id} ev={ev}/>)
                    }
```
with:
```jsx
                    {bEvs.length===0
                      ?<div style={{fontSize:11,color:"var(--muted)",fontStyle:"italic",padding:"16px 0",
                          textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>Empty</div>
                      :(()=>{
                        const sched = bEvs.filter(ev=>ev.type!=="invoice");
                        const inv   = bEvs.filter(ev=>ev.type==="invoice");
                        return (<>
                          {sched.map(ev=><EventCard key={ev.id} ev={ev}/>)}
                          {inv.length>0 && (
                            <div style={{display:"flex",alignItems:"center",gap:7,margin:"10px 2px 6px",
                              fontSize:9.5,fontWeight:800,letterSpacing:"0.09em",color:"#B06A2C"}}>
                              READY TO INVOICE ({inv.length})
                              <span style={{flex:1,height:1,background:"#B06A2C40"}}/>
                            </div>
                          )}
                          {inv.map(ev=><InvoiceNote key={ev.id} ev={ev}/>)}
                        </>);
                      })()
                    }
```

- [ ] **Step 3: Build**

Run: `CI=true npm run build`
Expected: build succeeds.

- [ ] **Step 4: Live smoke**

Serve the build, log in as Koy, open Forecast → Kanban. Confirm: invoice cards now render as slim amber rows under a "READY TO INVOICE (N)" divider at the bottom of each column; clicking `✕` removes the row and shows the undo bar; Undo restores it; opening the job still shows its READY TO INVOICE banner (the flag is only `invoiceDismissed`, `readyToInvoice` untouched).

- [ ] **Step 5: Checkpoint** — build green, smoke green. No commit.

---

## Task 4: Scheduling card Clear → Snooze menu

**Files:**
- Modify: `src/App.js` — `EventCard` (App.js:35374–35410+). Add `position:relative`, a Clear affordance, and a snooze popover.

**Interfaces:**
- Consumes: `snoozeEvent`, `isoPlusDays` (Task 2); `canEdit`, `Icon`, `C`, `fmtDate`.
- Produces: scheduling `EventCard`s carry a Clear button that opens a Snooze menu (3 days / 1 week / pick date).

- [ ] **Step 1: Give `EventCard` its own menu state + Clear button**

At the top of the `EventCard` component body (App.js:35375), add:

```jsx
    const [snoozeOpen, setSnoozeOpen] = useState(false);
```

Ensure the card's outer `<div>` (App.js:35384) style includes `position:"relative"` (add it to the existing style object).

Before the card's closing `</div>`, add the Clear affordance + popover (scheduling cards only — invoice never reaches `EventCard` after Task 3, but guard anyway):

```jsx
        {canEdit && ev.type!=="invoice" && (
          <div style={{position:"absolute",top:8,right:8}} onClick={e=>e.stopPropagation()}>
            <button title="Clear / snooze this card" aria-label="Clear this card"
              onClick={()=>setSnoozeOpen(o=>!o)}
              style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
                width:24,height:24,borderRadius:7,border:`1px solid ${C.border}`,
                background:"var(--surface)",color:"var(--dim)",cursor:"pointer"}}>
              <Icon name="clock" size={13}/>
            </button>
            {snoozeOpen && (
              <div style={{position:"absolute",top:28,right:0,zIndex:30,minWidth:190,
                background:"var(--card)",border:`1px solid ${C.border}`,borderRadius:11,
                boxShadow:"0 6px 18px rgba(0,0,0,0.18)",padding:6}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.05em",color:"var(--dim)",
                  textTransform:"uppercase",padding:"6px 8px 4px"}}>Snooze — comes back if still open</div>
                {[{l:"Snooze 3 days",n:3},{l:"Snooze 1 week",n:7}].map(o=>(
                  <button key={o.n} onClick={()=>{ setSnoozeOpen(false); snoozeEvent(ev, isoPlusDays(o.n)); }}
                    style={{display:"flex",width:"100%",alignItems:"center",gap:8,textAlign:"left",
                      font:"inherit",fontSize:12.5,color:"var(--text)",background:"none",border:"none",
                      borderRadius:7,padding:8,cursor:"pointer"}}>
                    {o.l}<span style={{marginLeft:"auto",fontSize:10,color:"var(--dim)"}}>{fmtDate(isoPlusDays(o.n))}</span>
                  </button>
                ))}
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:"var(--accent)",
                  padding:8,cursor:"pointer",fontWeight:600}}>
                  Pick a date…
                  <input type="date" style={{marginLeft:"auto"}}
                    onChange={(e)=>{ if(e.target.value){ setSnoozeOpen(false); snoozeEvent(ev, e.target.value); } }}/>
                </label>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 2: Mobile parity — Clear always visible on touch**

The Clear button above has no hover dependency (it renders at `opacity:1`), so it is already tap-visible on mobile. Confirm no CSS elsewhere hides it. (If a later polish hides it behind `:hover` on desktop, add `@media (hover:none){ show always }`.)

- [ ] **Step 3: Build**

Run: `CI=true npm run build`
Expected: build succeeds.

- [ ] **Step 4: Live smoke (desktop + narrow viewport)**

Snooze an overdue scheduling card via 3 days / 1 week / pick-date → the card leaves the board (and all Forecast views) → the undo bar appears → Undo restores it. Resize to a phone width and confirm the Clear button is tappable without hover.

- [ ] **Step 5: Checkpoint** — build green, smoke green (both widths). No commit.

---

## Task 5: Collapsible columns (localStorage-persisted)

**Files:**
- Modify: `src/App.js` — `SchedulingForecast` state (add `collapsed`); the Kanban column header + body (App.js:35634–35650).

**Interfaces:**
- Consumes: `useState`, `BUCKETS` (App.js:35336).
- Produces: per-bucket collapse toggle persisted under `localStorage["he_forecast_collapsed"]`.

- [ ] **Step 1: Add collapse state**

Near the component's other `useState`s (top of `SchedulingForecast`, ~App.js:34041), add:

```jsx
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("he_forecast_collapsed") || "[]")); }
    catch { return new Set(); }
  });
  const toggleCollapsed = (key) => setCollapsed(prev => {
    const nx = new Set(prev); nx.has(key) ? nx.delete(key) : nx.add(key);
    try { localStorage.setItem("he_forecast_collapsed", JSON.stringify([...nx])); } catch {}
    return nx;
  });
```

- [ ] **Step 2: Make the column header a collapse toggle + hide the body**

In the Kanban bucket map (App.js:35634), make the header `div` clickable and add a chevron; hide the card list when collapsed. Replace the header `<div style={{display:"flex",alignItems:"center",gap:8,...}}>` (App.js:35635) opening with a clickable version:

```jsx
                    <div onClick={()=>toggleCollapsed(bucket.key)} style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                      paddingBottom:8,borderBottom:`2px solid ${bucket.color}55`,cursor:"pointer"}}>
                      <span style={{display:"inline-flex",transition:"transform 0.18s",
                        transform:collapsed.has(bucket.key)?"rotate(-90deg)":"none",color:bucket.color}}>▾</span>
                      <div style={{width:8,height:8,borderRadius:"50%",background:bucket.color,flexShrink:0}}/>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,
                        letterSpacing:"0.08em",color:bucket.color}}>{bucket.label}</div>
                      <div style={{marginLeft:"auto",background:`${bucket.color}18`,border:`1px solid ${bucket.color}33`,
                        borderRadius:99,padding:"1px 8px",fontSize:11,color:bucket.color,fontWeight:700}}>
                        {bEvs.length}
                      </div>
                    </div>
```

Then wrap the body (the `{bEvs.length===0 ? ... : ...}` block from Task 3) so it only renders when not collapsed:

```jsx
                    {!collapsed.has(bucket.key) && (
                      /* ...the Task 3 body block... */
                    )}
```

- [ ] **Step 3: Build**

Run: `CI=true npm run build`
Expected: build succeeds.

- [ ] **Step 4: Live smoke**

Collapse Overdue → its cards fold away, count still shows. Reload the page → Overdue stays collapsed (localStorage). Expand it again → cards return.

- [ ] **Step 5: Checkpoint** — build green, smoke green. No commit.

---

## Task 6: Deploy hygiene — SW v392, FEATURES.md, SOP guide

**Files:**
- Modify: `public/service-worker.js:1`, `FEATURES.md`, `public/sops/forecast.html`.

- [ ] **Step 1: Bump the service worker**

`public/service-worker.js` line 1: `const CACHE = "homestead-v391";` → `const CACHE = "homestead-v392";`

- [ ] **Step 2: Add the FEATURES.md entry**

Add a v392 entry describing: Forecast Kanban inline cleanup — Ready-to-Invoice demoted to a dismissible notification (bottom of column), scheduling cards gain Clear→Snooze (3d/1wk/pick date, `forecastSnooze`), collapsible columns (localStorage). Match the file's existing entry format. (The prebuild gate reads this; without it the build is blocked.)

- [ ] **Step 3: Update the Forecast SOP guide**

Confirm the guide filename: `ls public/sops/ | grep -i forecast` (tab label "Forecast" → `forecast.html`). Update it to document the three new behaviors (Dismiss an invoice notification, Clear→Snooze a card, collapse a column). If the guide is a recorded SOP, note in `~/Desktop/Command Center/11-Trainings/In-App SOP Recordings - Checklist.md` that a re-record is pending; otherwise edit the HTML copy directly.

- [ ] **Step 4: Build (prebuild gate must accept v392)**

Run: `CI=true npm run build`
Expected: build succeeds (proves FEATURES.md has the v392 entry).

- [ ] **Step 5: Checkpoint** — build green. No commit.

---

## Task 7: Verification + handoff to Koy

**Files:** none (handoff artifacts only).

- [ ] **Step 1: Full verification pass**

- `node scripts/forecast-snooze-dryrun.js` → `ALL PASS`.
- `CI=true npm run build` → success (not piped).
- `git status && git diff --stat` → only expected files changed; **surface any edits you didn't make** (parallel-chat collision — do NOT `git checkout`/`restore`).

- [ ] **Step 2: Perplexity verify-loop brief (stored-data change)**

Write a short markdown brief (new `forecastSnooze` field inside the `data` envelope; `invoiceDismissed` now written from the Forecast; loader untouched; whole-map replace follows `taskDueDates`) for Koy to paste into Perplexity. Reconcile any findings before the one-paste.

- [ ] **Step 3: Deploy-hygiene pass**

Run the `homestead-deploy-hygiene` checklist: data-safety line, SW bump (done), FEATURES.md (done), Firestore rules (unchanged — none needed), new-field audit (`forecastSnooze` inside data envelope, no loader change), parallel-chat collision.

- [ ] **Step 4: Produce the one-paste for Koy**

```bash
cd ~/Desktop/homestead-electric && git add src/App.js public/service-worker.js FEATURES.md public/sops/forecast.html scripts/forecast-snooze-dryrun.js docs/superpowers/specs/2026-09-02-forecast-kanban-cleanup-design.md docs/superpowers/plans/2026-09-02-forecast-kanban-cleanup.md && git commit -m "Forecast Kanban: inline clear — invoice as dismissible notification, card snooze, collapsible columns (SW v392)

Why it won't lose data: additive only. One new field forecastSnooze lives inside the job data envelope (loader auto-unwraps, no spread change) and follows the taskDueDates whole-map-replace precedent; Dismiss reuses the existing reversible invoiceDismissed flag (readyToInvoice untouched, so the invoice still shows on the job/Today). Snooze hides by future date and returns on its own — nothing schedulable is deleted. Writes ride the existing onUpdateJob->saveJob funnel; no rules change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" && git push
```

- [ ] **Step 5: After Koy ships — vault log**

Write `~/Desktop/Command Center/Logs/2026-09-02 - Homestead Electric.md` (type: log) and update `~/Desktop/Command Center/02-Features/Scheduling Forecast.md` with the v392 inline-cleanup behavior + `forecastSnooze` data note.

---

## Self-review

**Spec coverage:**
- Invoice → notification, bottom of column, one-tap Dismiss → Task 3. ✓
- One `invoiceDismissed` flag hides job-level + phase-invoice cards → Task 1 Step 5. ✓
- Scheduling card Snooze (3d/1wk/pick date), `forecastSnooze` map → Tasks 2, 4. ✓
- Snooze hides from all views + tab counts, returns on date → Task 1 Step 4. ✓
- Collapsible columns, localStorage → Task 5. ✓
- Writes via `onUpdateJob({...job,...patch}, patch)`, gated on `canEdit` → Task 2. ✓
- Undo on every action → Task 2 (`undoToast`). ✓
- No loader change; additive field in data envelope → Global Constraints + Task 1. ✓
- Deferred: inline Set start date → absent by design (non-goal). ✓
- SW v392 + FEATURES.md + SOP + perplexity + vault log → Tasks 6, 7. ✓
- Mobile parity → Task 4 Step 2. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code; the one "…the Task 3 body block…" reference in Task 5 Step 2 points at code written verbatim in Task 3 (same file, adjacent task) rather than repeating ~20 lines — acceptable since both tasks edit the same block in sequence.

**Type consistency:** `forecastEventSuffix` / `isForecastSnoozed` / `forecastSnoozePatch` (module-level) and `patchJob` / `snoozeEvent` / `dismissInvoice` / `isoPlusDays` / `stageUndo` / `commitUndo` / `undoToast` / `collapsed` / `toggleCollapsed` / `InvoiceNote` / `snoozeOpen` are named identically everywhere they appear. Harness copies are byte-identical to the App.js helpers (Task 1 Steps 1 & 3).
