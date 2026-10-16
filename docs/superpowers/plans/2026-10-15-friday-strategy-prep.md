# Friday Strategy/Scheduling Meeting Pre-fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Friday 6:00 AM MT a Cloud Function writes this week's pre-filled meeting doc ("Friday Strategy Prep — <date>", packet Drive folder, styled to paste straight into Josh's "Notes - Weekly Strategy/Scheduling Meeting") — schedule gaps, blocked jobs by who we wait on, pipeline, money, QC, last week — built so that no live job is silently dropped and crew is never inferred from a job's roles.

**Architecture:** All content logic is a PURE module `functions/strategyPrep.js` (`buildModel(inputs)` → plain object, `renderLines(model)` → `[{kind,text,spans}]`, `parseNotesCarry(doc, now)`), reusing `foremanMeetingPrep.docsRequests` for the Docs API requests. `functions/index.js` gains `runStrategyPrep` (reads, Simpro, Calendar, read of Josh's doc for carry-forward, doc create + fill, HTML fallback, additive state merge, push) with cron + test callable. A plain-node harness with fixtures from the real Lot 208 / Namjoshi cases runs in `prebuild`; a read-only dry-run renders the exact doc as a PREVIEW doc for Koy's sign-off.

**Tech Stack:** Node 22 Cloud Functions (`firebase-functions/v1`, googleapis Docs v3/Calendar v3/Drive v3, `fetch`), plain-node test scripts (no framework), Firestore, FCM via the existing `deliver` layer.

**Spec:** `docs/superpowers/specs/2026-10-15-friday-strategy-prep-design.md` — the plan argues from it; read both.

## Global Constraints

- **Work in a fresh worktree off `origin/main`.** The Desktop checkout is behind live (SW v538 vs live v541) and dirty. `git fetch origin && git worktree add ../he-strategy-prep origin/main -b strategy-prep` (superpowers:using-git-worktrees). Commit per task in the worktree. **Push and deploy only when Koy says ship.**
- **Pure module stays pure.** `functions/strategyPrep.js`: no `require` except `./foremanMeetingPrep.js` for `docsRequests` (itself pure), no Firestore, no network, no `Date.now()` — `now` arrives in `inputs`.
- **Accuracy rules (spec §3) are tests, not comments.** Booked = Simpro ∪ planner only. Every live job with a phase in progress / scheduled / date-confirmed / on hold lands in exactly one schedule bucket. Conflicts print, never merge. Dead fields never read: `roughScheduledDate`, `finishScheduledDate`, `lastActivityAt`.
- **Docs text is ASCII/BMP only — no emoji** (JS `length` must equal UTF-16 index math in `docsRequests`). Push titles: `Friday prep`, no glyph.
- **Dates:** `TZ = "America/Denver"`; `MARGIN_TARGET = 15`; `toDateAny` accepts ISO, `M/D/YY`, `M/D/YYYY`, Firestore Timestamp, ms-epoch strings (app ids).
- **`functions/index.js` export count:** 106 before this plan → 108 after Task 6 → 106 after Task 8 retires the packet. Check with `cd functions && node -e "console.log(Object.keys(require('./index.js')).length)"` before and after every edit to that file. Edit in place, never rewrite from a snapshot.
- **Reads only.** The only Firestore write is one `set(..., {merge:true})` on `settings/strategyPrep`; test runs skip it. The only Docs write is one `batchUpdate` into the doc this run just created. Josh's notes doc is only ever read.
- **FCM:** deep-link fields ride `data.*`; never add fields to `webpush.notification`. The notif object is `{ title, body, url }` (`notifyDelivery.js` reads `url`).
- **Service account access:** the functions SA (`homestead-electric@appspot.gserviceaccount.com`) got **403** on Josh's doc on 2026-10-15. That only affects the Carried section (a read): sharing the doc with the SA as **Viewer** enables it; until then the section prints the share hint. Everything else writes to its own new doc in the packet folder (Koy, 2026-10-15: *"lets just have it on its own doc, ill copy and paste each week to the meeting doc."*).
- **Client ship (Task 9) rules:** SW bump to current+1 (re-read `public/service-worker.js` line 1 at execution time; live was v541 on 2026-10-15), FEATURES.md entry naming the same `SW v<N>`, `CI=true npm run build` with NO pipe, no emoji in UI copy, no yellow.

## Review Focus

Inputs the spec implies but no task's tests cover unless added; each line's test is added to the owning task below.

1. **Simpro schedule has staff on a job with no app record** (Project.ProjectID not matched to any `simproNo`) — must not crash; row appears under Booked as `Simpro #1302 (not in app)`. → Task 1 test.
2. **Planner cell on a job with no Simpro entry and the person is on PTO that day** — Booked shows the person, Conflicts shows `X booked Mon but out (PTO)`. → Task 2 test.
3. **A job's `simproNo` has trailing spaces** (`"1182 "`, seen live 2026-09-29) — trim before every Simpro match and fetch. → Task 1 test.
4. **Josh's doc has two sections for the same date** (Google template + ours) — `parseNotesCarry` picks the newest section strictly before today and ignores our own header line. → Task 5 test.
5. **Simpro returns a non-array (HTML error page) for schedules** — `scheduleEntries = []`, Booked prints "Simpro unavailable; planner only", idle rows carry "(Simpro not checked)". → Task 1 (pure flag) + Task 6 (orchestrator) tests.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `functions/strategyPrep.js` | Pure content: predicates, buckets, ranking, caps, lines, notes-doc parser | Create |
| `scripts/strategyprep-test.js` | Plain-node regression harness with the real-case fixtures; wired into `prebuild` | Create |
| `scripts/strategyprep-dryrun.js` | Read-only prod render into a PREVIEW copy doc + `checks` block | Create |
| `functions/index.js` | `runStrategyPrep`, `exports.strategyPrep`, `exports.sendTestStrategyPrep`; later retire `fridayPacket` | Modify |
| `functions/autoDocs.js` | Replace `packet` + `strategy` sources with one `strategy` doc link | Modify (Task 8) |
| `src/App.js` | `OD_DOCS` card text, `NOTIF_CATEGORIES` entry | Modify (Task 9) |
| `public/service-worker.js`, `FEATURES.md` | Cache bump + feature entry | Modify (Task 9) |
| `package.json` | add `node scripts/strategyprep-test.js` to `prebuild` | Modify (Task 1) |

---

### Task 1: Module skeleton, helpers, live-job set, schedule index, and the "no job dropped" classification

**Files:**
- Create: `functions/strategyPrep.js`
- Create: `scripts/strategyprep-test.js`
- Modify: `package.json` (`prebuild` chain, append `&& node scripts/strategyprep-test.js`)

**Interfaces:**
- Produces (module exports used by later tasks): `TZ`, `MARGIN_TARGET`, `CAPS`, `toDateAny(v)`, `startOfDay(d)`, `addDays(d,n)`, `daysBetween(a,b)`, `ymd(d)`, `fmtShort(d)`, `fmtMD(d)`, `esc(s)`, `stripHtml(s)`, `snOf(j)`, `effStatus(j, phase)`, `liveJobs(jobs)`, `walkPunch(punch, cb)`, `waitingItems(j)`, `openQuestions(j)`, `waitBucket(text)`, `SPECIAL_JOB`, `buildScheduleIndex(scheduleEntries, plannerDoc, jobs, weekYmds)` → `{ byJob: Map<jobId,{days:{di:{people:[], source:"simpro"|"planner"|"both"}}}>, byPerson: Map<firstKey,{name, days:{di:Set<jobName>}}>, unknownSimpro: [{pid, days:[di], people:[]}], simproOk: bool, plannerPresent: bool }`, `classifySchedule(live, idx, weekYmds, today)` → `{ booked:[], idle:[], starts:[], onHold:[], between:[] }` (every row `{jobId, name, phase, pct, ...}`), `weekOf(now)` → `{ today, nextMon, weekDays, weekYmds, meeting, DAY_LBL }`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Create the harness with a fixture built from the real 2026-10-15 cases**

Create `scripts/strategyprep-test.js`:

```js
#!/usr/bin/env node
// Friday Strategy/Scheduling prep — pure-module tests. Run: node scripts/strategyprep-test.js
// Fixtures are the REAL cases Koy caught on 2026-10-15 (Lot 208, Namjoshi/Treycen/Hideout), simplified.
"use strict";
const S = require("../functions/strategyPrep.js");
let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fri Oct 16 2026, 6:00 AM Mountain (12:00Z). Next week = Mon 10/19 .. Fri 10/23.
const NOW = new Date("2026-10-16T12:00:00Z");

function fixture(over = {}) {
  const users = [
    { id: "koy", name: "Koy Wilkinson", role: "admin" },
    { id: "josh", name: "Josh Cloward", role: "admin" },
    { id: "brady", name: "Brady Nelson", role: "admin" },
    { id: "justin", name: "Justin Cloward", role: "admin" },
    { id: "daegan", name: "Daegan Smith", title: "foreman" },
    { id: "abraham", name: "Abraham Tristan", title: "foreman" },
    { id: "keegan", name: "Keegan Wilkinson", title: "foreman" },
    { id: "treycen", name: "Treycen Rollene", title: "lead" },
    { id: "bailey", name: "Bailey Smith", title: "crew" },
    { id: "braden", name: "Braden Davis", title: "crew" },
    { id: "old", name: "Laid Off", title: "crew", active: false },
  ];
  const item = (o) => ({ text: "item", done: false, voided: false, ...o });
  const jobs = [
    // Lot 208: rough in progress 80%, READY TO INVOICE since 10/1, QC needs, waiting items, no booking.
    { id: "L208", name: "Skyridge Lot 208 - Mayflower", simproNo: "1419 ", foreman: "Keegan Wilkinson", lead: "Keegan Wilkinson",
      roughStatus: "inprogress", roughStage: "80%", readyToInvoice: true, readyToInvoiceDate: "10/1/2026", qcStatus: "needs",
      roughPunch: { main: { general: [item({ waiting: true, waitingOn: "Need ufer clamp" }), item({ waiting: true, waitingOn: "Pocket door framed" }), item({})] } },
      roughQuestions: { main: [{ question: "Cabinet plans", answer: "", done: false, addedAt: "2026-08-18T10:00:00Z" }] },
      roughUpdates: [{ date: "9/21/2026", text: "Waiting for answers", addedBy: "Keegan" }] },
    // Namjoshi: rough CONFIRMED for Mon 10/19, lead Treycen — who Simpro has at The Hideout Monday. Nobody booked on Namjoshi.
    { id: "NAM", name: "Namjoshi Basement Remodel - SLC", simproNo: "1444", foreman: "Daegan Smith", lead: "Treycen Rollene",
      roughStatus: "date_confirmed", roughStage: "0%", roughProjectedStart: "10/19/2026", roughStartConfirmed: true,
      prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true } },
    // Hideout: finish 95%, invoiced, 6 waiting items, Simpro has Treycen + Bailey there Monday.
    { id: "HIDE", name: "The Hideout", simproNo: "1302", foreman: "Abraham Tristan", lead: "Abraham Tristan",
      roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", invoiceSent: true, invoiceDismissed: true,
      finishPunch: { main: { general: [item({ waiting: true, waitingOn: "Waiting for cabinetry" }), item({ waiting: true, waitingOn: "Waiting for fixture" })] } } },
    // Riverton: rough PROJECTED Mon 10/19, no foreman/lead, prep 2/5, nobody booked.
    { id: "RIV", name: "Riverton & Laundromat", simproNo: "1460", foreman: "Unassigned", lead: "",
      roughStatus: "waiting_date", roughProjectedStart: "10/19/2026", prepChecklist: { redlinePlans: true, plansUploaded: true } },
    // Rose: finish on hold (waiting on paint).
    { id: "ROSE", name: "Rose", simproNo: "889", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "waiting", finishStage: "60%" },
    // Micek: between phases, NO finish date → not listed (Koy 2026-09-23), but counted.
    { id: "MIC", name: "Micek Residence", simproNo: "1321", foreman: "Keegan Wilkinson", roughStatus: "complete", roughStatusDate: "4/15/2026", finishStatus: "" },
    // Oak Hill: rough in progress, Simpro has Louis Mon-Fri → Booked.
    { id: "OAK", name: "Oak Hill 5 - Alpine", simproNo: "1454", foreman: "Louis Hoffman", lead: "Louis Hoffman", roughStatus: "inprogress", roughStage: "10%" },
    // Done job and a quote never appear.
    { id: "DONE", name: "Wood", finishStatus: "complete", finishStage: "100%" },
    { id: "Q", name: "#3019 - Chapman", type: "quote" },
    // Entangled: temp power → margin watch excluded (Task 4) but schedule still lists it when in progress.
    { id: "TP", name: "Smith Temp Power", simproNo: "1470", roughStatus: "inprogress", roughStage: "50%" },
  ];
  const simpro = (date, pid, name) => ({ Type: "job", Date: date, Project: { ProjectID: pid }, Staff: { Name: name }, Blocks: [{ Hrs: 10 }] });
  const scheduleEntries = [
    simpro("2026-10-19", 1302, "Treycen Rollene"), simpro("2026-10-19", 1302, "Bailey Smith"),
    simpro("2026-10-19", 1454, "Louis Hoffman"), simpro("2026-10-20", 1454, "Louis Hoffman"), simpro("2026-10-21", 1454, "Louis Hoffman"),
    simpro("2026-10-22", 1454, "Louis Hoffman"), simpro("2026-10-23", 1454, "Louis Hoffman"),
    simpro("2026-10-20", 9999, "Zane Watkins"),                       // a Simpro job the app does not know
    { Type: "activity", Date: "2026-10-23", Project: "", Staff: { Name: "James Christen" } }, // not a job → ignored
  ];
  return { jobs, users, scheduleEntries, plannerDoc: null, pto: [], timeOffRequests: [], needs: [], upcoming: [],
    agentFindings: [], calendarEvents: [], prevState: null, simproTotalsById: {}, notesDoc: null, simproOk: true, now: NOW, ...over };
}

// ── Task 1: helpers, live set, schedule index, classification ────────────────
{
  t("toDateAny: M/D/YYYY", S.ymd(S.toDateAny("10/19/2026")) === "2026-10-19");
  t("toDateAny: M/D/YY", S.ymd(S.toDateAny("3/19/26")) === "2026-03-19");
  t("toDateAny: ISO", S.ymd(S.toDateAny("2026-08-18T10:00:00Z")) === "2026-08-18");
  t("toDateAny: ms-epoch id (app ids)", S.toDateAny("1785948806355") instanceof Date);
  t("toDateAny: junk → null", S.toDateAny("Monday-ish") === null);
  t("snOf trims", S.snOf({ simproNo: "1419 " }) === "1419");

  const f = fixture();
  const live = S.liveJobs(f.jobs);
  t("liveJobs drops done + quote", !live.some(j => j.id === "DONE" || j.id === "Q") && live.length === 8, String(live.length));

  const w = S.weekOf(NOW);
  t("weekOf: next Monday 10/19, Friday 10/23", w.weekYmds[0] === "2026-10-19" && w.weekYmds[4] === "2026-10-23", JSON.stringify(w.weekYmds));
  t("weekOf: today is Fri 10/16", S.ymd(w.today) === "2026-10-16");

  const idx = S.buildScheduleIndex(f.scheduleEntries, f.plannerDoc, live, w.weekYmds);
  t("index: Hideout has Treycen + Bailey Mon (simpro)", eq(idx.byJob.get("HIDE").days[0].people, ["Treycen Rollene", "Bailey Smith"]) && idx.byJob.get("HIDE").days[0].source === "simpro", JSON.stringify(idx.byJob.get("HIDE")));
  t("index: Oak Hill all five days", Object.keys(idx.byJob.get("OAK").days).length === 5);
  t("index: Namjoshi has NO booking (lead field is not a booking)", !idx.byJob.has("NAM"));
  t("index: byPerson Treycen Mon → The Hideout", idx.byPerson.get("treycen").days[0].has("The Hideout"));
  t("index: Simpro job unknown to the app is kept, not dropped", idx.unknownSimpro.length === 1 && idx.unknownSimpro[0].pid === "9999" && idx.unknownSimpro[0].people[0] === "Zane Watkins");
  t("index: activity rows ignored", !idx.byPerson.has("james"));
  t("index: plannerPresent false when doc null", idx.plannerPresent === false && idx.simproOk === true);

  const c = S.classifySchedule(live, idx, w.weekYmds, w.today);
  const ids = (k) => c[k].map(r => r.jobId);
  t("booked: Hideout + Oak Hill", eq(ids("booked"), ["OAK", "HIDE"]) || eq(ids("booked"), ["HIDE", "OAK"]), JSON.stringify(ids("booked")));
  t("idle: Lot 208 is listed even though ready to invoice + waiting", ids("idle").includes("L208"), JSON.stringify(ids("idle")));
  t("idle: Lot 208 row carries RTI age, QC, punch count, wait buckets", (() => { const r = c.idle.find(x => x.jobId === "L208"); return r && r.rtiDays === 15 && r.qcNeeds === true && r.openPunch === 3 && r.waitBuckets.length >= 1 && r.phase === "rough" && r.pct === 80; })(), JSON.stringify(c.idle.find(x => x.jobId === "L208")));
  t("idle: temp power job listed too (in progress, nobody booked)", ids("idle").includes("TP"));
  t("starts: Namjoshi + Riverton (dated in window, phase not started)", eq(ids("starts").sort(), ["NAM", "RIV"]), JSON.stringify(ids("starts")));
  t("starts: Namjoshi confirmed, nobody booked, lead elsewhere named", (() => { const r = c.starts.find(x => x.jobId === "NAM"); return r && r.confirmed === true && r.crewBooked === false && r.elsewhere[0] === "lead Treycen Rollene is at The Hideout Mon"; })(), JSON.stringify(c.starts.find(x => x.jobId === "NAM")));
  t("starts: Riverton projected, no foreman/lead, prep 2/5 naming missing", (() => { const r = c.starts.find(x => x.jobId === "RIV"); return r && r.confirmed === false && r.missingRoles.join("+") === "foreman+lead" && r.prep.done === 2 && eq(r.prep.missing, ["Cabinet Plans Received", "Appliance Specs Received", "Ready to Hand Off to Foreman"]); })(), JSON.stringify(c.starts.find(x => x.jobId === "RIV")));
  t("onHold: Rose", eq(ids("onHold"), ["ROSE"]));
  t("between (not printed, counted): Micek", eq(ids("between"), ["MIC"]));
  const all = [...ids("booked"), ...ids("idle"), ...ids("starts"), ...ids("onHold"), ...ids("between")];
  t("every live job lands in exactly one bucket", all.length === live.length && new Set(all).size === live.length, JSON.stringify(all));
  t("no dead fields read", !/roughScheduledDate|finishScheduledDate|lastActivityAt/.test(require("fs").readFileSync(require.resolve("../functions/strategyPrep.js"), "utf8")));
}

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log("\nall strategy prep tests passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/strategyprep-test.js`
Expected: `Cannot find module '../functions/strategyPrep.js'`; exit 1.

- [ ] **Step 3: Create `functions/strategyPrep.js` with helpers, live set, schedule index, classification**

```js
// ─────────────────────────────────────────────────────────────
// Friday Strategy/Scheduling Meeting pre-fill — PURE module (no Firestore, no network).
//   buildModel(inputs) → plain model · renderLines(model) → [{kind,text,spans}] · parseNotesCarry(doc, now)
// Spec: docs/superpowers/specs/2026-10-15-friday-strategy-prep-design.md
// Accuracy rules (Koy, 2026-10-15: "it just needs to be 100 percent accurate"):
//   booked = Simpro schedules ∪ planner, NEVER job.foreman/lead · no live job silently dropped ·
//   conflicts shown, never merged · dead fields (roughScheduledDate etc.) never read.
// ─────────────────────────────────────────────────────────────
"use strict";
const { docsRequests } = require("./foremanMeetingPrep.js");

const TZ = "America/Denver";
const MARGIN_TARGET = 15;
const CAPS = { carried: 20, booked: 15, calendar: 12, blockedPerGroup: 10, coming: 15, findings: 6, rti: 10, movers: 5, qc: 10, approved: 12 };
const DAY_LBL = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SPECIAL_JOB = /phase|temp power|temp p\b|t&m|ev charger|light change|whip|\bstc\b/i;   // entangled jobs: margin is fiction
const PREP_ITEMS = [["redlinePlans", "Redline Plans Up to Date"], ["cabinetPlans", "Cabinet Plans Received"], ["applianceSpecs", "Appliance Specs Received"], ["plansUploaded", "Plans Uploaded to App & SimPro"], ["readyToHandOff", "Ready to Hand Off to Foreman"]];
const WAIT_BUCKETS = [
  ["Inspection", /inspect|ahj|4.?way|final\b/i],
  ["Material", /deliver|fixture|material|light\b|chandelier|order|on site|onsite|not on s|bulb|shade|supply/i],
  ["GC / builder", /\bgc\b|builder|fram|drywall|paint|cabinet|counter|tile|scaffold|ceiling|drop|insulat|trim|shelv|baseboard|wallpaper|island|fur out|pocket door|measure/i],
  ["Homeowner / designer", /design|selection|spec\b|layout|decision|confirm|detail|location|height|homeowner|customer|client|owner/i],
  ["Other trades", /plumb|hvac|mechanical|sauna|utility|trade/i],
];

// ── dates / text ─────────────────────────────────────────────────────────────
function toDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") { try { const d = v.toDate(); return isNaN(d.getTime()) ? null : d; } catch (e) { return null; } }
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (m && !/T\d/.test(s)) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{12,14}$/.test(s)) { const d = new Date(+s); return isNaN(d.getTime()) ? null : d; }
  if (!/\d/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtMD = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}` : "";
const firstKey = (name) => String(name || "").trim().toLowerCase().split(/\s+/)[0];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])); }
function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
const fmtMoney = (v) => v >= 950 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10; }

// ── jobs ─────────────────────────────────────────────────────────────────────
const snOf = (j) => String((j && j.simproNo) || "").trim();
const effStatus = (j, phase) => { const st = j[phase + "Status"]; if (st) return st; const p = parseInt(j[phase + "Stage"]) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };
const pctOf = (j, phase) => parseInt(j[phase + "Stage"]) || 0;
const ACTIVE_ST = new Set(["inprogress", "scheduled", "date_confirmed"]);
const STARTED_ST = new Set(["inprogress", "complete", "invoice", "waiting"]);
const hasForeman = (j) => !!j.foreman && !/^unassigned$/i.test(String(j.foreman).trim());
const leadOf = (j) => { const l = String(j.lead || "").trim(); return l && !/unassigned|tbd/i.test(l) ? l : ""; };
const isDone = (j) => j.finishStatus === "complete" || j.finishStatus === "invoice" || parseInt(j.finishStage) === 100 ||
  (j.tempPed && j.tempPedStatus === "completed") || (j.quickJob && ["complete", "invoice"].includes(j.quickJobStatus));
function liveJobs(jobs) {
  return arr(jobs).filter(j => j && j.name && String(j.name).trim() !== "Example Job" && j.type !== "quote" && !j.archived && !j.deleted && !j.archivedAt && !isDone(j));
}
function walkPunch(punch, cb) {
  if (!punch || typeof punch !== "object") return;
  const floors = ["upper", "main", "basement"].concat(arr(punch.extras).map(e => e && e.key).filter(Boolean));
  floors.forEach(fk => { const f = punch[fk]; if (!f || typeof f !== "object") return;
    arr(f.general).forEach(i => i && cb(i)); arr(f.hotcheck).forEach(i => i && cb(i)); arr(f.rooms).forEach(r => arr(r && r.items).forEach(i => i && cb(i))); });
}
function openPunchCount(j) { let n = 0; ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (!i.done && !i.voided) n++; })); return n; }
function waitingItems(j) { const out = []; ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (!i.done && !i.voided && i.waiting) out.push({ text: stripHtml(i.text), waitingOn: String(i.waitingOn || "").trim(), since: toDateAny(i.waitingSince || i.addedAtTs || i.addedAt) }); })); return out; }
function openQuestions(j) {
  const out = [];
  ["roughQuestions", "finishQuestions"].forEach(k => { const qs = j[k]; if (!qs || typeof qs !== "object") return;
    Object.values(qs).forEach(list => arr(list).forEach(q => { if (!q || q.done || q.deleted || String(q.answer || "").trim() || arr(q.answerPhotos).length) return;
      out.push({ text: stripHtml(q.question || q.text || ""), since: toDateAny(q.addedAt) || toDateAny(q.date) || toDateAny(q.id) }); })); });
  return out.filter(q => q.text);
}
function waitBucket(text) { const r = String(text || "").trim(); if (!r) return "Unspecified"; for (const [label, re] of WAIT_BUCKETS) if (re.test(r)) return label; return "Other"; }
function prepOf(j) {
  const c = j.prepChecklist || {}, na = j.prepNA || {};
  if (!j.prepChecklist && !j.prepNA) { const done = (j.prepStage || "") === "Job Prep Complete"; return { done: done ? 5 : 0, total: 5, missing: done ? [] : PREP_ITEMS.map(x => x[1]), legacy: true }; }
  const missing = PREP_ITEMS.filter(([k]) => !c[k] && !na[k]).map(x => x[1]);
  return { done: 5 - missing.length, total: 5, missing, legacy: false };
}

// ── calendar window ──────────────────────────────────────────────────────────
function weekOf(now) {
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const today = startOfDay(mtNow);
  const meeting = addDays(today, (5 - today.getDay() + 7) % 7);          // the Friday on/after today
  const nextMon = addDays(meeting, 3);
  const weekDays = [0, 1, 2, 3, 4].map(i => addDays(nextMon, i));
  return { today, meeting, nextMon, weekDays, weekYmds: weekDays.map(ymd), DAY_LBL };
}
function daysLabel(dis) {
  if (dis.length === 5) return "all week";
  const runs = []; let s = dis[0], p = dis[0];
  for (let i = 1; i <= dis.length; i++) { const c = dis[i]; if (c === p + 1) { p = c; continue; } runs.push(s === p ? DAY_LBL[s] : `${DAY_LBL[s]}–${DAY_LBL[p]}`); s = p = c; }
  return runs.join(", ");
}

// ── schedule index: WHO is booked WHERE next week (Simpro ∪ planner) ────────
// Never reads job.foreman/lead. unknownSimpro keeps Simpro jobs the app has no record of.
function buildScheduleIndex(scheduleEntries, plannerDoc, live, weekYmds) {
  const byJob = new Map(), byPerson = new Map(), unknown = new Map();
  const jobBySn = new Map(); live.forEach(j => { const sn = snOf(j); if (sn) jobBySn.set(sn, j); });
  const note = (job, di, person, source) => {
    if (!byJob.has(job.id)) byJob.set(job.id, { days: {} });
    const d = byJob.get(job.id).days; if (!d[di]) d[di] = { people: [], source };
    if (!d[di].people.some(p => firstKey(p) === firstKey(person))) d[di].people.push(person);
    if (d[di].source !== source) d[di].source = "both";
    const k = firstKey(person); if (!byPerson.has(k)) byPerson.set(k, { name: person, days: {} });
    const pd = byPerson.get(k).days; if (!pd[di]) pd[di] = new Set(); pd[di].add(job.name);
  };
  arr(scheduleEntries).forEach(s => {
    if (!s || s.Type !== "job" || !s.Date) return;
    const di = weekYmds.indexOf(String(s.Date).slice(0, 10)); if (di < 0) return;
    const pid = String((s.Project && (s.Project.ProjectID || s.Project.ID)) || "").trim(); const nm = (s.Staff && s.Staff.Name) || "";
    if (!pid || !nm) return;
    const j = jobBySn.get(pid);
    if (j) { note(j, di, nm, "simpro"); return; }
    if (!unknown.has(pid)) unknown.set(pid, { pid, days: new Set(), people: [] });
    const u = unknown.get(pid); u.days.add(di); if (!u.people.some(p => firstKey(p) === firstKey(nm))) u.people.push(nm);
  });
  const assignments = (plannerDoc && plannerDoc.assignments) || {};
  const liveById = new Map(live.map(j => [j.id, j]));
  Object.entries(assignments).forEach(([key, cell]) => {
    const parts = key.split("_"), di = Number(parts.pop()), jid = parts.join("_");
    const j = liveById.get(jid); if (!j || !(di >= 0 && di <= 4) || !cell) return;
    [cell.lead, ...arr(cell.crew)].filter(Boolean).forEach(p => note(j, di, p, "planner"));
  });
  return { byJob, byPerson, unknownSimpro: [...unknown.values()].map(u => ({ ...u, days: [...u.days].sort() })),
    simproOk: true, plannerPresent: !!(plannerDoc && Object.keys(assignments).length) };
}

// ── classification: every live job → exactly one bucket ─────────────────────
function classifySchedule(live, idx, weekYmds, today) {
  const out = { booked: [], idle: [], starts: [], onHold: [], between: [] };
  const inWindow = (d) => d && weekYmds.includes(ymd(d));
  const elsewhere = (j, di) => {
    const who = [["foreman", hasForeman(j) ? j.foreman : ""], ["lead", leadOf(j)]].filter(x => x[1]);
    return who.map(([role, name]) => { const p = idx.byPerson.get(firstKey(name)); const there = p && p.days[di] ? [...p.days[di]].filter(n => n !== j.name) : [];
      return there.length ? `${role} ${name} is at ${there.join(" / ")} ${DAY_LBL[di]}` : ""; }).filter(Boolean);
  };
  live.forEach(j => {
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");
    const phase = ACTIVE_ST.has(fs) || fs === "waiting" || (rs === "complete" && fs) ? "finish" : "rough";
    const st = phase === "finish" ? fs : rs;
    const base = { jobId: j.id, name: j.name, phase, pct: pctOf(j, phase), foreman: hasForeman(j) ? j.foreman : "", lead: leadOf(j) };
    const b = idx.byJob.get(j.id);
    const bookedDays = b ? Object.keys(b.days).map(Number).sort() : [];
    // Dated start for a phase not yet started (never roughScheduledDate — dead field).
    const startOf = (p) => { const s = effStatus(j, p); if (STARTED_ST.has(s) || pctOf(j, p) > 0) return null; const d = toDateAny(j[p + "ProjectedStart"]); return d ? { phase: p, date: d, confirmed: !!j[p + "StartConfirmed"] || ["scheduled", "date_confirmed"].includes(s) } : null; };
    const start = startOf("rough") || startOf("finish");
    if (bookedDays.length) {
      const seen = new Set(), people = []; bookedDays.forEach(di => b.days[di].people.forEach(p => { const k = firstKey(p); if (!seen.has(k)) { seen.add(k); people.push(p); } }));
      out.booked.push({ ...base, firstDay: bookedDays[0], days: daysLabel(bookedDays), people, source: [...new Set(bookedDays.map(di => b.days[di].source))].join("+"), qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start && inWindow(start.date) ? { ...start } : null });
      return;
    }
    if (start && inWindow(start.date)) {
      const di = weekYmds.indexOf(ymd(start.date)); const prep = prepOf(j);
      const missingRoles = [!hasForeman(j) ? "foreman" : "", !leadOf(j) ? "lead" : ""].filter(Boolean);
      const soon = daysBetween(start.date, today) <= 7;
      out.starts.push({ ...base, phase: start.phase, date: start.date, di, confirmed: start.confirmed, crewBooked: false, missingRoles, prep, elsewhere: elsewhere(j, di), atRisk: soon && (missingRoles.length > 0 || prep.done < 5 || true) });
      return;
    }
    if (st === "waiting") { out.onHold.push({ ...base, since: toDateAny(j[phase + "StatusDate"]) }); return; }
    if (ACTIVE_ST.has(st) || (st === "" && pctOf(j, phase) > 0)) {
      const waits = waitingItems(j), qs = openQuestions(j);
      const byB = {}; waits.forEach(w => { const k = waitBucket(w.waitingOn); byB[k] = (byB[k] || 0) + 1; });
      const upd = [...arr(j.roughUpdates), ...arr(j.finishUpdates)].map(u => toDateAny(u && (u.date || u.createdAt))).filter(Boolean).sort((a, c) => c - a)[0] || toDateAny(j.statusUpdateAt);
      const rd = toDateAny(j.readyToInvoiceDate);
      out.idle.push({ ...base, lastUpdate: upd || null, openPunch: openPunchCount(j), questions: qs.length, waitBuckets: Object.entries(byB).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k} ${n}`),
        rti: !!(j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent), rtiDays: j.readyToInvoice && rd ? Math.max(0, daysBetween(today, rd)) : null, qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start || null });
      return;
    }
    // Rough done, finish not started, dated later or undated → between (not printed; counted in checks).
    out.between.push({ ...base, finishStart: start ? start.date : null });
  });
  out.booked.sort((a, b) => a.firstDay - b.firstDay || a.name.localeCompare(b.name));
  out.starts.sort((a, b) => a.di - b.di || a.name.localeCompare(b.name));
  out.idle.sort((a, b) => (b.pct || 0) - (a.pct || 0) || a.name.localeCompare(b.name));
  return out;
}

module.exports = { TZ, MARGIN_TARGET, CAPS, DAY_LBL, SPECIAL_JOB, PREP_ITEMS, WAIT_BUCKETS, toDateAny, startOfDay, addDays, daysBetween, ymd, fmtShort, fmtMD, firstKey, plural, arr, clip, esc, stripHtml, fmtMoney, median,
  snOf, effStatus, pctOf, hasForeman, leadOf, liveJobs, walkPunch, openPunchCount, waitingItems, openQuestions, waitBucket, prepOf, weekOf, daysLabel, buildScheduleIndex, classifySchedule, docsRequests };
```

Note on `atRisk`: the fixture asserts Namjoshi (confirmed, prep 5/5, nobody booked) is a start with `crewBooked:false`; a start inside 7 days with nobody booked is always at risk, so the `|| true` term is correct for the starts bucket (every start row here has no booking by construction — booked starts went to `booked` with `start` attached). Keep it as written; the renderer (Task 5) prints **at risk** for `atRisk`, **confirmed** / **projected** otherwise.

- [ ] **Step 4: Run the tests**

Run: `node scripts/strategyprep-test.js`
Expected: every Task 1 line `ok`, `all strategy prep tests passed`, exit 0. If "idle: Lot 208 row carries…" fails on `openPunch`, check the fixture: three items, one not waiting, all open → 3.

- [ ] **Step 5: Wire the harness into prebuild**

In `package.json` `"prebuild"`, append ` && node scripts/strategyprep-test.js` at the end of the chain (after `node scripts/leadmeetingdoc-test.js`). Run `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` to confirm valid JSON.

- [ ] **Step 6: Commit**

```bash
git add functions/strategyPrep.js scripts/strategyprep-test.js package.json
git commit -m "Friday prep: pure module skeleton, schedule index, no-job-dropped classification (Lot 208 / Namjoshi fixtures)"
```

---

### Task 2: Dates that moved, calendar events, people + capacity, conflicts

**Files:**
- Modify: `functions/strategyPrep.js` (add functions + exports)
- Modify: `scripts/strategyprep-test.js` (append a Task 2 block before the `if (failures)` line)

**Interfaces:**
- Produces: `dateKeys(live)` → `{ "<jobId>:<field>": "YYYY-MM-DD" }` for `roughProjectedStart`, `finishProjectedStart`, `fourWayTargetDate`, `finalInspectionTargetDate`, `qcStatusDate`, `finishQcStatusDate`, `matterportStatusDate`, and `rt:<index>` for `returnTrips[].rtStatusDate`; `movedDates(live, prevDates, today)` → `{ rows:[{name, label, from, to, nth}], passed:[{name, label, date}], firstRun }`; `calendarRows(live, calendarEvents, weekYmds)` → `[{di, label, name, who}]`; `peopleRows({users, pto, timeOffRequests, needs, prevUserIds, idx, weekDays, today})` → `{ out:[], pending:[], bodies:[], newUsers:[], capacity:[{di, booked, available, thin}] }`; `conflictRows(idx, pto, weekYmds)` → `[string]`.
- Consumes: Task 1 helpers and `buildScheduleIndex` output.

- [ ] **Step 1: Append Task 2 tests**

Insert before `if (failures)` in `scripts/strategyprep-test.js`:

```js
// ── Task 2: moved dates, calendar, people, capacity, conflicts ───────────────
{
  const f = fixture({
    pto: [{ name: "Braden Davis", start: "10/19/2026", end: "10/23/2026", note: "Out of town" }, { name: "Bailey Smith", start: "10/19/2026", end: "10/19/2026", note: "" }],
    timeOffRequests: [{ id: "to1", name: "Keegan Wilkinson", start: "10/28/2026", end: "10/30/2026", status: "pending", requestedAt: "2026-10-14T10:00:00Z" }, { id: "to2", name: "Braden Davis", start: "10/19/2026", end: "10/23/2026", status: "approved", requestedAt: "2026-10-01T10:00:00Z" }],
    needs: [{ id: "n1", kind: "bodies", text: "2 bodies Mon-Wed for Oak Hill 5", jobName: "Oak Hill 5 - Alpine", createdBy: "Louis Hoffman", createdAt: "2026-10-14T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" }],
    calendarEvents: [
      { summary: "Miller site walk with homeowners", start: { dateTime: "2026-10-22T10:00:00-06:00" }, location: "Alpine", attendees: [{ email: "koy@homesteadelectric.net" }, { email: "brady@homesteadelectric.net" }] },
      { summary: "Dentist", start: { dateTime: "2026-10-20T09:00:00-06:00" } },
    ],
  });
  f.jobs.push({ id: "MIL", name: "Miller Residence - Alpine", simproNo: "1438", foreman: "Keegan Wilkinson", lead: "Keegan Wilkinson", roughStatus: "inprogress", roughStage: "75%", fourWayTargetDate: "10/21/2026", qcStatus: "scheduled", qcStatusDate: "10/21/2026", matterportStatus: "scheduled", matterportStatusDate: "10/23/2026",
    returnTrips: [{ rtStatus: "scheduled", rtStatusDate: "10/20/2026", scope: "Pool panel feed", assignedTo: "Keegan" }] });
  const live = S.liveJobs(f.jobs), w = S.weekOf(NOW);
  const idx = S.buildScheduleIndex(f.scheduleEntries, f.plannerDoc, live, w.weekYmds);

  const keys = S.dateKeys(live);
  t("dateKeys: Namjoshi rough start + Miller 4-way/QC/scan/RT", keys["NAM:roughProjectedStart"] === "2026-10-19" && keys["MIL:fourWayTargetDate"] === "2026-10-21" && keys["MIL:qcStatusDate"] === "2026-10-21" && keys["MIL:matterportStatusDate"] === "2026-10-23" && keys["MIL:rt:0"] === "2026-10-20", JSON.stringify(keys));
  const prev = { "NAM:roughProjectedStart": [{ d: "2026-10-02", v: "2026-10-08" }, { d: "2026-10-09", v: "2026-10-12" }], "L208:fourWayTargetDate": [{ d: "2026-10-09", v: "2026-10-01" }] };
  const mv = S.movedDates(live, prev, w.today);
  t("movedDates: Namjoshi 10/12 → 10/19 is the 3rd date", (() => { const r = mv.rows.find(x => x.name.startsWith("Namjoshi")); return r && r.from === "10/12" && r.to === "10/19" && r.nth === 3 && r.label === "rough start"; })(), JSON.stringify(mv.rows));
  t("movedDates: unchanged keys don't print", !mv.rows.some(x => x.name.startsWith("Miller")));
  t("movedDates: firstRun false with history", mv.firstRun === false && S.movedDates(live, null, w.today).firstRun === true);
  t("movedDates: passed date = Riverton? no (in window); Rose none; Lot 208 has none → passed empty", mv.passed.length === 0, JSON.stringify(mv.passed));
  const f2 = fixture(); f2.jobs.find(j => j.id === "RIV").roughProjectedStart = "10/12/2026";
  const mv2 = S.movedDates(S.liveJobs(f2.jobs), {}, w.today);
  t("movedDates: a start before today with status not started prints under passed", mv2.passed.length === 1 && mv2.passed[0].name === "Riverton & Laundromat" && mv2.passed[0].label === "rough start", JSON.stringify(mv2.passed));

  const cal = S.calendarRows(live, f.calendarEvents, w.weekYmds);
  const labels = cal.map(r => `${w.DAY_LBL[r.di]} ${r.label} ${r.name}`);
  t("calendar: RT Tue, 4-way Wed, QC Wed, walk Thu, scan Fri; dentist ignored", eq(labels, ["Tue Return trip Miller Residence - Alpine", "Wed Rough inspection Miller Residence - Alpine", "Wed Rough QC walk Miller Residence - Alpine", "Thu Site walk Miller Residence - Alpine", "Fri Matterport scan Miller Residence - Alpine"]), JSON.stringify(labels));
  t("calendar: walk row names attendees by first name", cal.find(r => r.label === "Site walk").who === "Koy, Brady");

  const pp = S.peopleRows({ users: f.users, pto: f.pto, timeOffRequests: f.timeOffRequests, needs: f.needs, prevUserIds: ["koy", "josh", "brady", "justin", "daegan", "abraham", "keegan", "treycen", "bailey", "old"], idx, weekDays: w.weekDays, today: w.today });
  t("people: out rows (Braden all week, Bailey Mon)", eq(pp.out.map(r => `${r.name}|${r.range}`), ["Braden Davis|Mon–Fri", "Bailey Smith|Mon"]), JSON.stringify(pp.out));
  t("people: pending request with age", pp.pending.length === 1 && pp.pending[0].name === "Keegan Wilkinson" && pp.pending[0].requestedDays === 2, JSON.stringify(pp.pending));
  t("people: bodies request printed from text", pp.bodies.length === 1 && /2 bodies Mon-Wed/.test(pp.bodies[0].text) && pp.bodies[0].by === "Louis Hoffman");
  t("people: new user since last Friday = Braden", eq(pp.newUsers.map(u => u.name), ["Braden Davis"]));
  // roster = foreman/lead/crew with active!==false: Daegan, Abraham, Keegan, Treycen, Bailey, Braden = 6. Mon: PTO Braden+Bailey → 4 available; booked Mon = Treycen, Bailey, Louis(not a user, still booked) = 3.
  t("capacity: Mon 3/4 (Bailey booked AND out counts as booked), Fri 1/5", pp.capacity[0].booked === 3 && pp.capacity[0].available === 4 && pp.capacity[4].booked === 1 && pp.capacity[4].available === 5, JSON.stringify(pp.capacity));
  t("capacity: thin flag under 70%", pp.capacity[4].thin === true && pp.capacity[0].thin === false);

  const cf = S.conflictRows(idx, f.pto, w.weekYmds);
  t("conflicts: Bailey booked Mon but out", cf.some(s => /Bailey Smith .*booked Mon.*out/.test(s)), JSON.stringify(cf));
  const idx2 = S.buildScheduleIndex([...f.scheduleEntries, { Type: "job", Date: "2026-10-19", Project: { ProjectID: 1454 }, Staff: { Name: "Treycen Rollene" } }], f.plannerDoc, live, w.weekYmds);
  t("conflicts: same person two jobs same day", S.conflictRows(idx2, [], w.weekYmds).some(s => /Treycen Rollene .*Mon.*The Hideout.*Oak Hill 5/.test(s) || /Treycen Rollene .*Mon.*Oak Hill 5.*The Hideout/.test(s)), JSON.stringify(S.conflictRows(idx2, [], w.weekYmds)));
  const idx3 = S.buildScheduleIndex(f.scheduleEntries, { assignments: { "HIDE_0": { lead: "Abraham Tristan", crew: [] } } }, live, w.weekYmds);
  t("conflicts: planner says Abraham on Hideout Mon, Simpro doesn't → disagreement line", S.conflictRows(idx3, [], w.weekYmds).some(s => /planner.*Abraham Tristan.*Hideout.*Mon.*Simpro/.test(s)), JSON.stringify(S.conflictRows(idx3, [], w.weekYmds)));
}
```

- [ ] **Step 2: Run to verify the new block fails**

Run: `node scripts/strategyprep-test.js`
Expected: `TypeError: S.dateKeys is not a function` (or the first new `FAIL`), exit 1.

- [ ] **Step 3: Implement the four functions**

Add to `functions/strategyPrep.js` before `module.exports` (and add the names to the export list):

```js
// ── dates that moved since last Friday ───────────────────────────────────────
const DATE_FIELDS = [["roughProjectedStart", "rough start"], ["finishProjectedStart", "finish start"], ["fourWayTargetDate", "rough inspection"], ["finalInspectionTargetDate", "final inspection"], ["qcStatusDate", "rough QC walk"], ["finishQcStatusDate", "finish QC walk"], ["matterportStatusDate", "Matterport scan"]];
function dateKeys(live) {
  const out = {};
  live.forEach(j => {
    DATE_FIELDS.forEach(([f]) => { const d = toDateAny(j[f]); if (d) out[`${j.id}:${f}`] = ymd(d); });
    arr(j.returnTrips).forEach((rt, i) => { if (!rt || rt.signedOff || rt.rtStatus === "complete") return; const d = toDateAny(rt.rtStatusDate); if (d) out[`${j.id}:rt:${i}`] = ymd(d); });
  });
  return out;
}
const labelOfKey = (k) => { const f = k.split(":")[1]; if (f === "rt") return "return trip"; const e = DATE_FIELDS.find(x => x[0] === f); return e ? e[1] : f; };
const mdOfYmd = (s) => { const d = toDateAny(s); return d ? fmtMD(d) : s; };
// prevDates: { key: [{d: runYmd, v: valueYmd}, ...] } (kept newest-last, cap 6). nth = how many distinct values seen incl. this one.
function movedDates(live, prevDates, today) {
  const firstRun = !prevDates || typeof prevDates !== "object";
  const cur = dateKeys(live), nameOf = new Map(live.map(j => [j.id, j]));
  const rows = [], passed = [];
  Object.entries(cur).forEach(([k, v]) => {
    const j = nameOf.get(k.split(":")[0]); if (!j) return;
    const hist = firstRun ? [] : arr(prevDates[k]);
    const last = hist.length ? hist[hist.length - 1].v : null;
    if (last && last !== v) rows.push({ name: j.name, label: labelOfKey(k), from: mdOfYmd(last), to: mdOfYmd(v), nth: new Set([...hist.map(h => h.v), v]).size });
  });
  // Date passed: a start/inspection/QC/scan date before today whose status never moved.
  live.forEach(j => {
    const chk = (f, label, stillPending) => { const d = toDateAny(j[f]); if (d && ymd(d) < ymd(today) && stillPending) passed.push({ name: j.name, label, date: fmtMD(d) }); };
    chk("roughProjectedStart", "rough start", !STARTED_ST.has(effStatus(j, "rough")) && pctOf(j, "rough") === 0);
    chk("finishProjectedStart", "finish start", effStatus(j, "rough") === "complete" && !STARTED_ST.has(effStatus(j, "finish")) && pctOf(j, "finish") === 0);
    chk("fourWayTargetDate", "rough inspection", !j.roughInspectionResult && !arr(j.roughInspectionAttempts).length);
    chk("finalInspectionTargetDate", "final inspection", !j.finalInspectionResult && !arr(j.finalInspectionAttempts).length);
    chk("qcStatusDate", "rough QC walk", j.qcStatus === "scheduled");
    chk("finishQcStatusDate", "finish QC walk", j.finishQcStatus === "scheduled");
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, passed, firstRun };
}
// Next state for the snapshot: append today's value when it differs from the last one.
function nextDates(live, prevDates, todayYmd) {
  const cur = dateKeys(live), out = {};
  Object.entries(cur).forEach(([k, v]) => { const hist = arr(prevDates && prevDates[k]).slice(-5); if (!hist.length || hist[hist.length - 1].v !== v) hist.push({ d: todayYmd, v }); out[k] = hist.slice(-6); });
  return out;
}

// ── on the calendar next week ────────────────────────────────────────────────
const normName = (n) => String(n || "").toLowerCase().replace(/^#?\d{3,5}\s*-?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
function calendarRows(live, calendarEvents, weekYmds) {
  const rows = [];
  const add = (j, raw, label, who) => { const d = toDateAny(raw); if (!d) return; const di = weekYmds.indexOf(ymd(d)); if (di >= 0) rows.push({ di, label, name: j.name, who: who || "" }); };
  live.forEach(j => {
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");
    const lastAttempt = (l) => arr(l).map(a => toDateAny(a && a.date)).filter(Boolean).sort((a, b) => b - a)[0] || null;
    const insp = (target, result, attempts, label) => { const at = toDateAny(target); if (!at || result) return; const la = lastAttempt(attempts); if (la && ymd(la) >= ymd(at)) return; add(j, target, label); };
    if (rs !== "complete" && !STARTED_ST.has(fs)) insp(j.fourWayTargetDate, j.roughInspectionResult, j.roughInspectionAttempts, "Rough inspection");
    if (STARTED_ST.has(fs) || pctOf(j, "finish") > 0) insp(j.finalInspectionTargetDate, j.finalInspectionResult, j.finalInspectionAttempts, "Final inspection");
    if (j.qcStatus === "scheduled") add(j, j.qcStatusDate, "Rough QC walk");
    if (j.finishQcStatus === "scheduled") add(j, j.finishQcStatusDate, "Finish QC walk");
    const scanned = arr(j.matterportLinks).length || j.matterportLink;
    if (j.matterportStatus === "scheduled" && !scanned) add(j, j.matterportStatusDate, "Matterport scan");
    arr(j.returnTrips).forEach(rt => { if (rt && !rt.signedOff && rt.rtStatus === "scheduled") add(j, rt.rtStatusDate, "Return trip", String(rt.assignedTo || "").trim()); });
  });
  // Koy's calendar: an event whose title carries a live job's name is a site walk/meeting for it.
  // Keys per job: the first word when it is a real name (5+ letters, not a number — "miller"), plus the
  // first two words ("lot 23"), matched as whole words so "Miller site walk" hits Miller Residence - Alpine.
  const names = live.map(j => { const n = normName(j.name).split(" ").filter(Boolean); const keys = [];
    if (n[0] && n[0].length >= 5 && !/^\d+$/.test(n[0])) keys.push(n[0]); if (n.length >= 2) keys.push(n.slice(0, 2).join(" ")); return { j, keys }; }).filter(x => x.keys.length);
  arr(calendarEvents).forEach(ev => {
    if (!ev || !ev.start) return;
    const raw = ev.start.dateTime || ev.start.date; const d = toDateAny(raw); if (!d) return;
    const title = normName(ev.summary);
    const hit = names.find(x => x.keys.some(k => new RegExp(`(^| )${k}( |$)`).test(title))); if (!hit) return;
    const who = arr(ev.attendees).map(a => String((a && a.email) || "").split("@")[0]).filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
    add(hit.j, raw, /walk/i.test(ev.summary) ? "Site walk" : "Meeting", who);
  });
  return rows.sort((a, b) => a.di - b.di || a.label.localeCompare(b.label));
}

// ── people: out, pending, bodies, new, capacity ──────────────────────────────
const isRoster = (u) => !!u && u.active !== false && ["foreman", "lead", "crew"].includes(u.title || u.role || "");
function overlapDays(startRaw, endRaw, weekDays) {
  const s = toDateAny(startRaw), e = toDateAny(endRaw || startRaw); if (!s || !e) return [];
  return weekDays.map((d, i) => (ymd(d) >= ymd(s) && ymd(d) <= ymd(e)) ? i : -1).filter(i => i >= 0);
}
function peopleRows({ users, pto, timeOffRequests, needs, prevUserIds, idx, weekDays, today }) {
  const out = arr(pto).map(p => ({ name: p.name, dis: overlapDays(p.start, p.end, weekDays), note: p.note || "" })).filter(p => p.dis.length).map(p => ({ name: p.name, range: daysLabel(p.dis), dis: p.dis, note: p.note }));
  const pending = arr(timeOffRequests).filter(r => r && r.status === "pending").map(r => { const s = toDateAny(r.start), e = toDateAny(r.end || r.start), q = toDateAny(r.requestedAt);
    return { name: r.name, range: s ? `${fmtShort(s)}${e && ymd(e) !== ymd(s) ? `–${fmtShort(e)}` : ""}` : "", requestedDays: q ? daysBetween(today, q) : null }; });
  const bodies = arr(needs).filter(n => n && n.kind === "bodies" && n.status !== "done" && !n.voided).map(n => ({ text: clip(stripHtml(n.text || `${n.count || "some"} bodies`), 120), job: n.jobName || "", by: String(n.createdBy || "").trim(), ageDays: toDateAny(n.createdAt) ? daysBetween(today, toDateAny(n.createdAt)) : null }));
  const prev = new Set(arr(prevUserIds));
  const newUsers = prevUserIds == null ? [] : arr(users).filter(u => u && u.active !== false && !prev.has(u.id || u.name)).map(u => ({ name: u.name, title: u.title || u.role || "" }));
  const roster = arr(users).filter(isRoster);
  const capacity = weekDays.map((d, di) => {
    const outToday = new Set(out.filter(o => o.dis.includes(di)).map(o => firstKey(o.name)));
    const available = roster.filter(u => !outToday.has(firstKey(u.name))).length;
    let booked = 0; idx.byPerson.forEach(p => { if (p.days[di]) booked++; });
    return { di, booked, available, thin: available > 0 ? booked / available < 0.7 : false };
  });
  return { out, pending, bodies, newUsers, capacity };
}

// ── conflicts ────────────────────────────────────────────────────────────────
function conflictRows(idx, pto, weekYmds) {
  const rows = [];
  idx.byPerson.forEach(p => Object.entries(p.days).forEach(([di, jobsSet]) => { if (jobsSet.size > 1) rows.push(`${p.name} is on two jobs ${DAY_LBL[di]}: ${[...jobsSet].join(" and ")}`); }));
  const weekDays = weekYmds.map(s => toDateAny(s));
  arr(pto).forEach(o => { const dis = overlapDays(o.start, o.end, weekDays); const p = idx.byPerson.get(firstKey(o.name)); if (!p) return;
    dis.forEach(di => { if (p.days[di]) rows.push(`${o.name} is booked ${DAY_LBL[di]} (${[...p.days[di]].join(", ")}) but out that day${o.note ? ` — ${o.note}` : ""}`); }); });
  idx.byJob.forEach((b, jobId) => Object.entries(b.days).forEach(([di, day]) => { if (day.source !== "planner") return;
    const name = [...idx.byPerson.values()].find(p => p.days[di] && day.people.some(x => firstKey(x) === firstKey(p.name)));
    const jobName = name ? [...name.days[di]][0] : jobId;
    rows.push(`planner has ${day.people.join(", ")} on ${jobName} ${DAY_LBL[di]} but Simpro has nothing there that day`); }));
  return rows;
}
```

Add to `module.exports`: `dateKeys, movedDates, nextDates, calendarRows, peopleRows, conflictRows, isRoster, normName, overlapDays`.

- [ ] **Step 4: Run the tests**

Run: `node scripts/strategyprep-test.js`
Expected: all `ok`, exit 0. If the planner-disagreement line fails, note that `day.source` is `"planner"` only when no Simpro entry touched that job-day — that is the disagreement definition.

- [ ] **Step 5: Commit**

```bash
git add functions/strategyPrep.js scripts/strategyprep-test.js
git commit -m "Friday prep: moved dates, calendar rows, people + capacity, conflicts"
```

---

### Task 3: Blocked — one line per job, grouped by who we wait on, with cleared markers

**Files:**
- Modify: `functions/strategyPrep.js`
- Modify: `scripts/strategyprep-test.js` (append a Task 3 block before `if (failures)`)

**Interfaces:**
- Produces: `blockedRows({ live, needs, users, prevBlockerKeys, today })` → `{ groups: [{ name, rows:[{jobId, name, what, who, ageDays, more}], more:number }], cleared:[{name, group}], keys:[string], total:number, byGroup:{[group]:number}, firstRun }`. Group order: `GC / builder`, `Homeowner / designer`, `Material`, `Inspection`, `Other trades`, `On hold`, `Us (office owes the field)`, `Sold work not on the calendar`, `Other`. Key format `${jobId}:${group}`.
- Consumes: Task 1 `waitingItems`, `openQuestions`, `waitBucket`, `effStatus`, `leadOf`, `hasForeman`, `stripHtml`, `daysBetween`, `toDateAny`.

- [ ] **Step 1: Append Task 3 tests**

```js
// ── Task 3: blocked ──────────────────────────────────────────────────────────
{
  const f = fixture({
    needs: [
      { id: "n1", kind: "need", text: "Updated pantry redlines", jobName: "Oak Hill 5 - Alpine", jobId: "OAK", createdBy: "Louis Hoffman", createdAt: "2026-10-05T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" },
      { id: "n2", kind: "need", text: "Fresh one", jobName: "Oak Hill 5 - Alpine", jobId: "OAK", createdBy: "Louis Hoffman", createdAt: "2026-10-14T15:00:00Z", status: "open", assignedTo: "Koy Wilkinson" },   // < 5 days → not a block yet
      { id: "n3", kind: "task", text: "Pick up spider box", createdBy: "Koy Wilkinson", createdAt: "2026-09-20T15:00:00Z", status: "open", assignedTo: "Keegan Wilkinson" },           // field-assigned → not "us"
      { id: "n4", kind: "need", text: "Old done", jobId: "OAK", createdAt: "2026-09-01T15:00:00Z", status: "done", assignedTo: "Koy Wilkinson" },
    ],
  });
  f.jobs.push(
    { id: "BUL", name: "Bulowski", simproNo: "866", foreman: "Colby Fogh", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%",
      changeOrders: [{ coStatus: "approved", createdAt: "2026-05-11T10:00:00Z", desc: "More Dimmers" }, { coStatus: "approved", createdAt: "2026-05-11T10:00:00Z", desc: "Tape light" }, { coStatus: "completed", createdAt: "2026-04-01T10:00:00Z" }] },
    { id: "COW", name: "Cowdrey", simproNo: "929", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%",
      returnTrips: [{ rtStatus: "needs", createdAt: "2026-06-17T10:00:00Z", scope: "Floor outlets" }, { rtStatus: "complete", signedOff: true }] },
    { id: "ASH", name: "Ashcraft", simproNo: "1291", foreman: "Vasa Mataafa", roughStatus: "complete", finishStatus: "inprogress", finishStage: "90%",
      finishQuestions: { main: Array.from({ length: 10 }, (_, i) => ({ question: `Q${i}`, answer: "", done: false, addedAt: "2026-10-02T10:00:00Z" })) }, flagged: true, flagNote: "Need an update from Louis" },
  );
  const live = S.liveJobs(f.jobs), w = S.weekOf(NOW);
  const b = S.blockedRows({ live, needs: f.needs, users: f.users, prevBlockerKeys: ["L208:GC / builder", "ROSE:On hold", "HIDE:Material", "MIC:Material"], today: w.today });
  const g = (n) => (b.groups.find(x => x.name === n) || { rows: [] }).rows;
  t("blocked: Lot 208 under GC / builder (pocket door framing), one line, age 59d from the oldest open question (8/18)", (() => { const r = g("GC / builder").find(x => x.jobId === "L208"); return r && r.ageDays === 59 && /ufer clamp|Pocket door/.test(r.what); })(), JSON.stringify(g("GC / builder")));
  t("blocked: Lot 208 appears in ONE group only", b.groups.filter(x => x.rows.some(r => r.jobId === "L208")).length === 1, JSON.stringify(b.groups.map(x => [x.name, x.rows.map(r => r.jobId)])));
  t("blocked: Hideout under Material (cabinetry → GC) — highest-count bucket wins: 1 Material vs 1 GC → first by bucket order = GC / builder", g("GC / builder").some(r => r.jobId === "HIDE") || g("Material").some(r => r.jobId === "HIDE"));
  t("blocked: Ashcraft under Homeowner / designer with 10 questions since 10/2", (() => { const r = g("Homeowner / designer").find(x => x.jobId === "ASH"); return r && /10 questions/.test(r.what) && r.ageDays === 14; })(), JSON.stringify(g("Homeowner / designer")));
  t("blocked: Rose under On hold", g("On hold").some(r => r.jobId === "ROSE"));
  t("blocked: Us = Oak Hill need open 11d (fresh one and field-assigned task excluded); flagged Ashcraft counted under Us too", (() => { const us = g("Us (office owes the field)"); return us.some(r => r.jobId === "OAK" && /pantry redlines/.test(r.what) && r.ageDays === 11) && !us.some(r => /Fresh one|spider/.test(r.what)) && us.some(r => r.jobId === "ASH" && /flagged/.test(r.what)); })(), JSON.stringify(g("Us (office owes the field)")));
  t("blocked: sold work — Bulowski 2 approved COs 158d, Cowdrey RT 121d", (() => { const s = g("Sold work not on the calendar"); const bu = s.find(r => r.jobId === "BUL"), co = s.find(r => r.jobId === "COW"); return bu && /2 approved COs/.test(bu.what) && bu.ageDays === 158 && co && /return trip/.test(co.what) && co.ageDays === 121; })(), JSON.stringify(g("Sold work not on the calendar")));
  t("blocked: cleared = Micek Material (key gone), not Lot 208 (still blocked, group may differ → still counted as moved not cleared)", eq(b.cleared.map(c => c.name), ["Micek Residence"]), JSON.stringify(b.cleared));
  t("blocked: keys cover every printed row; total + byGroup consistent", b.keys.length === b.total && Object.values(b.byGroup).reduce((a, n) => a + n, 0) === b.total);
  t("blocked: firstRun false with prev keys; true with null", b.firstRun === false && S.blockedRows({ live, needs: [], users: f.users, prevBlockerKeys: null, today: w.today }).firstRun === true);
  const big = S.blockedRows({ live: Array.from({ length: 14 }, (_, i) => ({ id: "H" + i, name: "Hold " + i, roughStatus: "waiting" })), needs: [], users: f.users, prevBlockerKeys: [], today: w.today });
  t("blocked: cap 10 per group + more", big.groups[0].rows.length === 10 && big.groups[0].more === 4);
}
```

Fix the two age numbers before running: Lot 208's oldest open item is the question dated 2026-08-18 → 59 days before 2026-10-16 (the waiting items carry no date in the fixture). Oak Hill's need 10/5 → 11 days. Bulowski COs 5/11 → 158. Cowdrey RT 6/17 → 121. Ashcraft questions 10/2 → 14.

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/strategyprep-test.js` → `S.blockedRows is not a function`.

- [ ] **Step 3: Implement `blockedRows`**

```js
// ── blocked: one line per job, grouped by who we wait on ────────────────────
const GROUP_ORDER = ["GC / builder", "Homeowner / designer", "Material", "Inspection", "Other trades", "On hold", "Us (office owes the field)", "Sold work not on the calendar", "Other", "Unspecified"];
const OFFICE_NAMES = /^(koy|josh|jeromy|justin|brady)\b/i;
const CO_OPEN_APPROVED = (co) => co && String(co.coStatus || "").toLowerCase() === "approved" && !co.scheduledDate;
function blockedRows({ live, needs, users, prevBlockerKeys, today }) {
  const firstRun = !Array.isArray(prevBlockerKeys);
  const prev = new Set(firstRun ? [] : prevBlockerKeys);
  const age = (d) => d ? Math.max(0, daysBetween(today, d)) : null;
  const oldest = (dates) => { const ds = dates.filter(Boolean).sort((a, b) => a - b); return ds.length ? ds[0] : null; };
  const perJob = new Map(); // jobId → [{group, what, who, since}]
  const push = (j, group, what, since, who) => { if (!perJob.has(j.id)) perJob.set(j.id, []); perJob.get(j.id).push({ group, what, since: since || null, who: who || "" }); };
  live.forEach(j => {
    const waits = waitingItems(j), qs = openQuestions(j);
    const byBucket = {};
    waits.forEach(w => { const b = waitBucket(w.waitingOn); (byBucket[b] = byBucket[b] || []).push(w); });
    Object.entries(byBucket).forEach(([b, list]) => push(j, b, `${plural(list.length, "waiting-on item")}: ${list.slice(0, 2).map(w => clip(w.waitingOn || w.text, 40)).join(", ")}`, oldest(list.map(w => w.since))));
    if (qs.length) { const b = qs.map(q => waitBucket(q.text)).find(x => x !== "Other" && x !== "Unspecified" && x !== "Homeowner / designer") || "Homeowner / designer"; push(j, b, `${plural(qs.length, "question")} unanswered since ${fmtMD(oldest(qs.map(q => q.since)) || today)}`, oldest(qs.map(q => q.since))); }
    [["rough", "Rough"], ["finish", "Finish"]].forEach(([p, L]) => { if (effStatus(j, p) === "waiting") push(j, "On hold", `${L} on hold`, toDateAny(j[p + "StatusDate"])); });
    if (j.flagged) push(j, "Us (office owes the field)", `flagged${j.flagNote ? ` — ${clip(stripHtml(j.flagNote), 60)}` : ""}`, toDateAny(j.flaggedAt));
    const cos = arr(j.changeOrders).filter(CO_OPEN_APPROVED);
    if (cos.length) push(j, "Sold work not on the calendar", `${plural(cos.length, "approved CO")}, no date`, oldest(cos.map(c => toDateAny(c.createdAt) || toDateAny(c.id))));
    const rts = arr(j.returnTrips).filter(rt => rt && !rt.signedOff && rt.rtStatus === "needs" && !toDateAny(rt.rtStatusDate) && !toDateAny(rt.scheduledDate));
    if (rts.length) push(j, "Sold work not on the calendar", `${plural(rts.length, "return trip")} with no date${rts[0].scope ? ` — ${clip(stripHtml(rts[0].scope), 40)}` : ""}`, oldest(rts.map(r => toDateAny(r.createdAt) || toDateAny(r.date))));
  });
  const liveById = new Map(live.map(j => [j.id, j]));
  arr(needs).forEach(n => {
    if (!n || n.status === "done" || n.voided || n.kind === "bodies") return;
    if (!OFFICE_NAMES.test(String(n.assignedTo || ""))) return;
    const c = toDateAny(n.createdAt); if (!c || daysBetween(today, c) < 5) return;
    const j = liveById.get(n.jobId) || live.find(x => x.name === n.jobName);
    const target = j || { id: `need:${n.id}`, name: n.jobName || "(no job)" };
    push(target, "Us (office owes the field)", `${clip(stripHtml(n.text), 70)} (${String(n.createdBy || "").split(" ")[0] || "crew"})`, c, String(n.assignedTo || "").split(" ")[0]);
  });
  // One line per job per audience: among the "waiting on someone else" groups the highest item count wins
  // (ties → GROUP_ORDER). "Us" and "Sold work" are their own audiences and additive — a job can sit in one
  // waiting group AND under Us AND under Sold work, never twice within the waiting groups.
  const US = "Us (office owes the field)", SOLD = "Sold work not on the calendar";
  const groups = new Map(GROUP_ORDER.map(g => [g, []])), keys = [], byGroup = {};
  perJob.forEach((items, jobId) => {
    const jobName = (liveById.get(jobId) || {}).name || (arr(needs).find(n => `need:${n.id}` === jobId) || {}).jobName || jobId;
    const sold = items.filter(i => i.group === SOLD), us = items.filter(i => i.group === US), rest = items.filter(i => i.group !== SOLD && i.group !== US);
    const emit = (list, groupName) => {
      if (!list.length) return;
      const sinceAll = oldest(list.map(i => i.since));
      const what = list.map(i => i.what).join(" · ");
      groups.get(groupName).push({ jobId, name: jobName, what: clip(what, 140), who: list.map(i => i.who).filter(Boolean)[0] || "", ageDays: age(sinceAll), more: Math.max(0, list.length - 2), _since: sinceAll ? sinceAll.getTime() : Infinity });
      keys.push(`${jobId}:${groupName}`); byGroup[groupName] = (byGroup[groupName] || 0) + 1;
    };
    if (rest.length) {
      const count = {}; rest.forEach(i => { count[i.group] = (count[i.group] || 0) + 1; });
      const winner = Object.keys(count).sort((a, b) => count[b] - count[a] || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))[0];
      emit(rest, winner);
    }
    emit(us, US);
    emit(sold, SOLD);
  });
  const outGroups = [];
  groups.forEach((rows, name) => { if (!rows.length) return; rows.sort((a, b) => a._since - b._since || a.name.localeCompare(b.name)); rows.forEach(r => delete r._since);
    outGroups.push({ name, rows: rows.slice(0, CAPS.blockedPerGroup), more: Math.max(0, rows.length - CAPS.blockedPerGroup) }); });
  const nowKeys = new Set(keys), nowJobs = new Set(keys.map(k => k.split(":")[0]));
  const cleared = firstRun ? [] : [...prev].filter(k => !nowKeys.has(k) && !nowJobs.has(k.split(":")[0])).map(k => { const [jobId, group] = [k.split(":")[0], k.split(":").slice(1).join(":")]; const j = liveById.get(jobId); return { name: j ? j.name : jobId, group }; }).filter(c => c.name && c.name !== c.group);
  return { groups: outGroups, cleared, keys, total: keys.length, byGroup, firstRun };
}
```

Add `blockedRows, GROUP_ORDER` to the exports.

- [ ] **Step 4: Run the tests; fix the fixture expectations against real arithmetic**

Run: `node scripts/strategyprep-test.js`. Expected all `ok`. If "cleared" prints Rose or Hideout, check that `cleared` excludes any job that is still blocked in *some* group (the `nowJobs` test) — that is intended: a job that moved groups is not a win.

- [ ] **Step 5: Commit**

```bash
git add functions/strategyPrep.js scripts/strategyprep-test.js
git commit -m "Friday prep: blocked jobs grouped by who we wait on, cleared since last Friday"
```

---

### Task 4: Coming up, Money, QC, Last week, headline, nextState — `buildModel`

**Files:**
- Modify: `functions/strategyPrep.js`
- Modify: `scripts/strategyprep-test.js` (append Task 4 block)

**Interfaces:**
- Produces: `buildModel(inputs)` where `inputs = { jobs, users, scheduleEntries, plannerDoc, pto, timeOffRequests, needs, upcoming, agentFindings, calendarEvents, prevState, simproTotalsById, notesDoc, simproOk, now }` → model `{ heading, attendeesLine, preLine, weekLabel, carried, headline:[3 strings], schedule:{booked, idle, starts, moved, passed, calendar, people, capacity, conflicts, unknownSimpro, simproOk, plannerPresent, between}, blocked, coming, money, qc, lastWeek, counts, nextState }`. Each section object carries `error:false|string`.
- `collectSimproCandidates(jobs, cap=50)` → `[simproNo]` for ready-to-invoice + finishing-not-finished jobs (trimmed).
- `resolveRecipients(users)` → `[{user, reason}]` for admins ∪ `EXTRA_RECIPIENTS` (first-name prefixes `["josh","brady","justin"]`), never plain manager access.
- Consumes: Tasks 1–3.

- [ ] **Step 1: Append Task 4 tests**

```js
// ── Task 4: buildModel — coming, money, qc, last week, headline, state ───────
{
  const f = fixture({
    upcoming: [
      { id: "u1", name: "#3019 - Chapman Residence", customer: "E Builders", projectedStart: "10/27/2026", startConfirmed: false, sales: "Josh Cloward", lastFollowUp: "10/1/2026", notes: "framing" },
      { id: "u2", name: "Forth", customer: "", projectedStart: "11/17/2026", startConfirmed: true },
      { id: "u3", name: "Peterson", customer: "", projectedStart: "", notes: "waiting on Heber P&L drawings" },
      { id: "u4", name: "Oak Hill 5 - Alpine", projectedStart: "10/26/2026" },   // already a live job → not listed
    ],
    agentFindings: [
      { type: "folder_created", summary: "Hemsley plans filed", createdAt: "2026-10-13T10:00:00Z", day: "2026-10-13" },
      { type: "unmatched_plan", summary: "Plan not matched: Robert Brown", createdAt: "2026-10-14T10:00:00Z", day: "2026-10-14" },
      { type: "folder_created", summary: "Old", createdAt: "2026-10-01T10:00:00Z", day: "2026-10-01" },
    ],
    simproTotalsById: { "1419": { total: 53000, margin: 37.4, isEstimate: false }, "1302": { total: 0, margin: -5.0, isEstimate: false } },
    prevState: { blockerKeys: [], marginByJob: { HIDE: 1.8 }, dates: {}, userIds: [], weeks: [{ ymd: "2026-10-09", counts: { rtCreated: 2 } }, { ymd: "2026-10-02", counts: { rtCreated: 3 } }] },
  });
  f.jobs.push(
    { id: "WADE", name: "Wade Residence", simproNo: "694", foreman: "Colby Fogh", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", simproMargin: -6.0,
      changeOrders: [{ coStatus: "approved", createdAt: "2026-10-01T10:00:00Z", coStatusDate: "10/13/2026", quoteNumber: "3329", desc: "Car lift" }] },
    { id: "WEBB", name: "Webb", simproNo: "1304", foreman: "Gage Lund", roughStatus: "complete", finishStatus: "inprogress", finishStage: "98%",
      finalInspectionAttempts: [{ date: "2026-10-14", result: "pass" }], finishPunch: { main: { general: [{ text: "a", done: false }, { text: "b", done: true, checkedAtTs: "2026-10-13T12:00:00Z" }] } } },
    { id: "WOOD2", name: "Kweller", simproNo: "1107", finishStatus: "complete", finishStage: "100%", finishStatusDate: "10/13/2026" },
    { id: "PREP", name: "Cougar Moon Lot 84 - Kamas", simproNo: "1402", foreman: "Daegan Smith", roughStatus: "complete", finishStatus: "date_confirmed", finishProjectedStart: "11/2/2026", finishStartConfirmed: true, prepChecklist: { redlinePlans: true, cabinetPlans: true, applianceSpecs: true, plansUploaded: true, readyToHandOff: true },
      returnTrips: [{ rtStatus: "needs", createdAt: "2026-10-12T10:00:00Z", scope: "new" }] },
  );
  const m = S.buildModel(f);
  t("model: heading = the doc title", m.heading === "Friday Strategy Prep — Oct 16, 2026", m.heading);
  t("model: preLine names the window", /Mon 10\/19 – Fri 10\/23/.test(m.preLine) && /6:00 AM/.test(m.preLine), m.preLine);
  t("coming: Chapman week of 10/26, Cougar Moon (live, finish 11/2) week of 11/2, Forth week of 11/16; Peterson under no date; Oak Hill (live) excluded", (() => { const c = m.coming; const labels = c.weeks.map(w => `${w.label}:${w.rows.map(r => r.name).join(",")}`); return eq(labels, ["Week of 10/26:#3019 - Chapman Residence", "Week of 11/2:Cougar Moon Lot 84 - Kamas", "Week of 11/16:Forth"]) && c.noDate.length === 1 && c.noDate[0].name === "Peterson" && !JSON.stringify(c).includes("Oak Hill"); })(), JSON.stringify(m.coming.weeks));
  t("coming: Cougar Moon in prep inside 21 days? (11/2 is 17 days) → yes, 5/5", m.coming.prep.length === 1 && m.coming.prep[0].name.startsWith("Cougar Moon") && m.coming.prep[0].done === 5, JSON.stringify(m.coming.prep));
  t("coming: findings last 7 days = 2, oldest dropped", m.coming.findings.length === 2);
  t("coming: freeing = Hideout 95, Wade 95, Webb 98, Lot 208 RTI; starts in 2 weeks = Namjoshi, Riverton + Chapman 10/27", m.coming.freeing.length === 4 && m.coming.startsSoon === 3, JSON.stringify([m.coming.freeing.map(x => x.name), m.coming.startsSoon]));
  t("money: RTI = Lot 208 $53k idle 15d margin 37.4 (live wins)", (() => { const r = m.money.rti.rows[0]; return r && r.name.startsWith("Skyridge") && r.dollars === 53000 && r.idleDays === 15 && r.margin === 37.4 && r.flag === ""; })(), JSON.stringify(m.money.rti));
  t("money: margin watch = finishing not finished, not RTI, not invoiced, not entangled → Wade -6 (cached), Webb none, Hideout excluded (invoiced), Temp power excluded", (() => { const names = m.money.margin.rows.map(r => r.name); return eq(names, ["Wade Residence"]) && m.money.margin.rows[0].margin === -6; })(), JSON.stringify(m.money.margin.rows));
  t("money: movers need prev value; Hideout invoiced so not in watch → no movers", m.money.margin.movers.length === 0 && m.money.margin.firstRun === false);
  t("money: approved this week = Wade #3329 (10/9), none dated", m.money.approved.rows.length === 1 && m.money.approved.rows[0].quote === "3329" && m.money.approved.undated === 1, JSON.stringify(m.money.approved));
  t("qc: Lot 208 (needs, 3 punch → not small), Webb (final passed, no QC), Wade/Bulowski/Cowdrey at ≥90 without QC", (() => { const names = m.qc.rows.map(r => r.name); return names.includes("Skyridge Lot 208 - Mayflower") && names.includes("Webb") && names.includes("Wade Residence"); })(), JSON.stringify(m.qc.rows));
  t("qc: small tag when open punch ≤ 3", (() => { const w = m.qc.rows.find(r => r.name === "Webb"); return w && w.small === true; })());
  t("lastWeek: finished Kweller; inspections 1 passed; punch closed 1; approved COs 1", m.lastWeek.finished.includes("Kweller") && m.lastWeek.inspPassed === 1 && m.lastWeek.punchClosed === 1 && m.lastWeek.cosApproved === 1, JSON.stringify(m.lastWeek));
  t("lastWeek: rt 4-week average from state weeks = 2.5", m.lastWeek.rtAvg4 === 2.5, String(m.lastWeek.rtAvg4));
  t("headline: three lines, line 1 counts", m.headline.length === 3 && /jobs crewed/.test(m.headline[0]) && /nobody booked/.test(m.headline[0]) && /starts/.test(m.headline[0]), JSON.stringify(m.headline));
  t("headline: line 3 money", /\$53k ready to bill on 1 job/.test(m.headline[2]), m.headline[2]);
  t("nextState: blockerKeys, marginByJob, dates, userIds, weeks (cap 8), lastRunAt absent (orchestrator adds)", Array.isArray(m.nextState.blockerKeys) && m.nextState.marginByJob.WADE === -6 && m.nextState.dates["NAM:roughProjectedStart"] && m.nextState.userIds.length === f.users.length && m.nextState.weeks.length === 3 && m.nextState.weeks[0].ymd === "2026-10-16", JSON.stringify(Object.keys(m.nextState)));
  t("counts: every §4.3 bucket counted + between", typeof m.counts.booked === "number" && typeof m.counts.between === "number");
  const bad = S.buildModel({ ...f, jobs: null, scheduleEntries: "garbage", simproOk: false });
  t("degrade: null jobs → every section error string, model still returned", typeof bad.schedule.error === "string" && typeof bad.blocked.error === "string" && Array.isArray(bad.headline));
  const noSimpro = S.buildModel({ ...f, scheduleEntries: [], simproOk: false });
  t("degrade: simproOk false flags schedule.simproOk false", noSimpro.schedule.simproOk === false);
  t("recipients: admins + josh/brady/justin, never manager, deduped", (() => { const r = S.resolveRecipients([...f.users, { id: "jer", name: "Jeromy Cloward", access: "manager" }]); const n = r.map(x => x.user.name); return n.includes("Koy Wilkinson") && n.includes("Brady Nelson") && !n.includes("Jeromy Cloward") && new Set(n).size === n.length; })());
  t("collectSimproCandidates: RTI + finishing, trimmed, cap", (() => { const c = S.collectSimproCandidates(f.jobs); return c.includes("1419") && c.includes("694") && !c.includes("1444") && c.every(s => s === s.trim()); })(), JSON.stringify(S.collectSimproCandidates(f.jobs)));
}
```

- [ ] **Step 2: Run to verify it fails** → `S.buildModel is not a function`.

- [ ] **Step 3: Implement coming / money / qc / lastWeek / headline / buildModel**

```js
// ── coming up ────────────────────────────────────────────────────────────────
const mondayOf = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return startOfDay(m); };
function comingRows({ live, upcoming, agentFindings, weekYmds, today, cls }) {
  const liveNames = new Set(live.map(j => normName(j.name)));
  const after = weekYmds[4];
  const rows = [];
  arr(upcoming).forEach(u => { if (!u || !(u.name || "").trim() || liveNames.has(normName(u.name))) return;
    const d = toDateAny(u.projectedStart); const fu = toDateAny(u.lastFollowUp);
    rows.push({ name: String(u.name).trim(), customer: u.customer || "", date: d, confirmed: !!u.startConfirmed, note: clip(stripHtml(u.notes), 60), followUpDays: fu ? daysBetween(today, fu) : null, sales: u.sales || "" }); });
  live.forEach(j => { const s = ["rough", "finish"].map(p => { const st = effStatus(j, p); if (STARTED_ST.has(st) || pctOf(j, p) > 0) return null; const d = toDateAny(j[p + "ProjectedStart"]); return d && ymd(d) > after ? { p, d, c: !!j[p + "StartConfirmed"] || ["scheduled", "date_confirmed"].includes(st) } : null; }).filter(Boolean)[0];
    if (s && !(s.p === "finish" && effStatus(j, "rough") !== "complete")) rows.push({ name: j.name, customer: j.customer || "", date: s.d, confirmed: s.c, note: `${s.p} start`, followUpDays: null, sales: "" }); });
  const dated = rows.filter(r => r.date && ymd(r.date) > after).sort((a, b) => a.date - b.date);
  const weeks = []; dated.forEach(r => { const wk = ymd(mondayOf(r.date)); let w = weeks.find(x => x.ymd === wk); if (!w) { w = { ymd: wk, label: `Week of ${fmtMD(toDateAny(wk))}`, rows: [] }; weeks.push(w); } w.rows.push(r); });
  const noDate = rows.filter(r => !r.date);
  // In prep: a start AFTER next week (next week's starts are already in §4.3) but inside 21 days, phase not started.
  const prep = live.filter(j => { const d = toDateAny(j.roughProjectedStart) || toDateAny(j.finishProjectedStart); return d && ymd(d) > after && daysBetween(d, today) <= 21 && effStatus(j, "rough") !== "inprogress"; }).map(j => { const p = prepOf(j); return { name: j.name, done: p.done, missing: p.missing }; });
  const cutoff = addDays(today, -7);
  const findings = arr(agentFindings).filter(f => f && toDateAny(f.createdAt) && toDateAny(f.createdAt) >= cutoff).sort((a, b) => toDateAny(b.createdAt) - toDateAny(a.createdAt)).slice(0, CAPS.findings).map(f => ({ type: f.type, summary: clip(stripHtml(f.summary), 90) }));
  const freeing = live.filter(j => (effStatus(j, "finish") === "inprogress" && pctOf(j, "finish") >= 90) || (j.readyToInvoice && !j.invoiceSent)).map(j => ({ name: j.name, foreman: hasForeman(j) ? j.foreman : "" }));
  const twoWeeks = ymd(addDays(today, 14));
  const startsSoon = cls.starts.length + dated.filter(r => ymd(r.date) <= twoWeeks).length;
  return { error: false, weeks: weeks.slice(0, 6), noDate, prep, findings, freeing, startsSoon, quotes: null };
}

// ── money (the Friday Packet's engine, moved) ────────────────────────────────
const isFinishingOpen = (j) => { const fs = effStatus(j, "finish"); return ((pctOf(j, "finish") > 0) || fs === "inprogress") && fs !== "complete" && fs !== "invoice" && !j.readyToInvoice && !j.invoiceSent && !SPECIAL_JOB.test(String(j.name || "")); };
const isRti = (j) => !!j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent;
function collectSimproCandidates(jobs, cap = 50) {
  const live = liveJobs(jobs); const out = [], seen = new Set();
  [...live.filter(isRti), ...live.filter(isFinishingOpen)].forEach(j => { const sn = snOf(j); if (!sn || seen.has(sn) || out.length >= cap) return; seen.add(sn); out.push(sn); });
  return out;
}
function moneyRows({ live, simproTotalsById, prevMargin, today }) {
  const totalsOf = (j) => (simproTotalsById || {})[snOf(j)] || null;
  const marginOf = (j) => { const t = totalsOf(j); if (t && typeof t.margin === "number") return Math.round(t.margin * 10) / 10; return (typeof j.simproMargin === "number" && isFinite(j.simproMargin)) ? Math.round(j.simproMargin * 10) / 10 : null; };
  const rti = live.filter(isRti).map(j => { const t = totalsOf(j), rd = toDateAny(j.readyToInvoiceDate), m = marginOf(j);
    return { name: j.name, foreman: hasForeman(j) ? j.foreman : "", dollars: t && typeof t.total === "number" ? t.total : null, idleDays: rd ? Math.max(0, daysBetween(today, rd)) : null, margin: m, flag: m == null ? "" : m < 0 ? "negative margin, check Simpro costs" : m < MARGIN_TARGET ? `${Math.round((MARGIN_TARGET - m) * 10) / 10} pts under` : "" }; })
    .sort((a, b) => (b.dollars || 0) - (a.dollars || 0) || (b.idleDays || 0) - (a.idleDays || 0));
  const known = rti.filter(r => r.dollars != null);
  const rows = live.filter(isFinishingOpen).map(j => ({ jobId: j.id, name: j.name, margin: marginOf(j), stage: `finish ${pctOf(j, "finish")}%` })).filter(r => r.margin != null).sort((a, b) => a.margin - b.margin);
  const firstRun = !prevMargin || typeof prevMargin !== "object";
  const movers = firstRun ? [] : rows.filter(r => typeof prevMargin[r.jobId] === "number" && Math.abs(r.margin - prevMargin[r.jobId]) >= 3).map(r => ({ name: r.name, from: prevMargin[r.jobId], to: r.margin, delta: Math.round((r.margin - prevMargin[r.jobId]) * 10) / 10 })).sort((a, b) => a.delta - b.delta).slice(0, CAPS.movers);
  const weekAgo = addDays(today, -7);
  const approved = []; live.forEach(j => arr(j.changeOrders).forEach(co => { if (!co || String(co.coStatus).toLowerCase() !== "approved") return; const d = toDateAny(co.coStatusSyncedAt) || toDateAny(co.coStatusDate); if (!d || d < weekAgo) return; approved.push({ name: j.name, quote: String(co.quoteNumber || "").trim(), desc: clip(stripHtml(co.desc || co.task), 50), dated: !!co.scheduledDate }); }));
  const marginByJob = {}; rows.forEach(r => { marginByJob[r.jobId] = r.margin; });
  return { error: false, rti: { rows: rti.slice(0, CAPS.rti), more: Math.max(0, rti.length - CAPS.rti), count: rti.length, total: known.reduce((s, r) => s + r.dollars, 0), knownCount: known.length },
    margin: { median: median(rows.map(r => r.margin)), count: rows.length, underCount: rows.filter(r => r.margin < MARGIN_TARGET).length, rows: rows.slice(0, 15), movers, firstRun },
    approved: { rows: approved.slice(0, CAPS.approved), count: approved.length, undated: approved.filter(a => !a.dated).length }, marginByJob };
}

// ── QC to schedule ───────────────────────────────────────────────────────────
function qcRows({ live, today }) {
  const weekAgo = addDays(today, -7);
  const rows = live.map(j => {
    const needs = j.qcStatus === "needs" || j.finishQcStatus === "needs";
    const noQc = !j.qcStatus && !j.finishQcStatus;
    const high = effStatus(j, "finish") === "inprogress" && pctOf(j, "finish") >= 90;
    const passedFinal = arr(j.finalInspectionAttempts).some(a => a && a.result === "pass" && toDateAny(a.date) && toDateAny(a.date) >= weekAgo) && !["completed", "pass", "passed_items", "fixed"].includes(j.finishQcStatus || j.qcStatus);
    if (!needs && !(noQc && high) && !passedFinal) return null;
    const open = openPunchCount(j);
    const since = toDateAny(j.finishQcStatus === "needs" ? j.finishQcStatusDate : j.qcStatusDate);
    const why = needs ? "QC needs" : passedFinal ? "final passed, no QC yet" : `finish ${pctOf(j, "finish")}%, no QC status`;
    return { name: j.name, foreman: hasForeman(j) ? j.foreman : "", why, since: since ? fmtMD(since) : "", openPunch: open, small: open <= 3 };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  return { error: false, rows: rows.slice(0, CAPS.qc), more: Math.max(0, rows.length - CAPS.qc) };
}

// ── last week ────────────────────────────────────────────────────────────────
function lastWeekRows({ jobs, live, users, prevState, blocked, today }) {
  const mon = mondayOf(today), inWin = (raw) => { const d = toDateAny(raw); return d && ymd(d) >= ymd(mon) && ymd(d) <= ymd(today); };
  const all = arr(jobs).filter(j => j && j.name && j.type !== "quote" && !j.archived && !j.deleted);
  const finished = all.filter(j => (j.finishStatus === "complete" || parseInt(j.finishStage) === 100) && inWin(j.finishStatusDate)).map(j => j.name);
  let inspPassed = 0, inspFailed = 0, cosCreated = 0, cosApproved = 0, cosConverted = 0, rtCreated = 0, punchClosed = 0, qAsked = 0, qAnswered = 0;
  all.forEach(j => {
    ["roughInspectionAttempts", "finalInspectionAttempts"].forEach(k => arr(j[k]).forEach(a => { if (a && inWin(a.date)) { if (a.result === "fail") inspFailed++; else if (a.result) inspPassed++; } }));
    arr(j.changeOrders).forEach(co => { if (!co) return; if (inWin(co.createdAt)) cosCreated++; const sd = co.coStatusSyncedAt || co.coStatusDate; if (inWin(sd) && String(co.coStatus).toLowerCase() === "approved") cosApproved++; if (inWin(sd) && String(co.coStatus).toLowerCase() === "converted") cosConverted++; });
    arr(j.returnTrips).forEach(rt => { if (rt && inWin(rt.createdAt || rt.date)) rtCreated++; });
    ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (i.done && !i.voided && inWin(i.checkedAtTs || i.checkedAt)) punchClosed++; }));
    ["roughQuestions", "finishQuestions"].forEach(k => { const qs = j[k]; if (!qs || typeof qs !== "object") return; Object.values(qs).forEach(l => arr(l).forEach(q => { if (!q) return; if (inWin(q.addedAt)) qAsked++; if (inWin(q.answeredAt)) qAnswered++; })); });
  });
  const weeks = arr(prevState && prevState.weeks);
  const rts = weeks.slice(-4).map(w => w && w.counts && w.counts.rtCreated).filter(n => typeof n === "number");
  const rtAvg4 = rts.length ? Math.round(rts.reduce((a, n) => a + n, 0) / rts.length * 10) / 10 : null;
  const counts = { finished: finished.length, inspPassed, inspFailed, cosCreated, cosApproved, cosConverted, rtCreated, punchClosed, qAsked, qAnswered, blocksCleared: blocked.cleared.length };
  return { error: false, finished, inspPassed, inspFailed, cosCreated, cosApproved, cosConverted, rtCreated, rtAvg4, punchClosed, qAsked, qAnswered, cleared: blocked.cleared, counts };
}

// ── recipients ───────────────────────────────────────────────────────────────
const EXTRA_RECIPIENTS = ["josh", "brady", "justin"];
function resolveRecipients(users) {
  const accessOf = (u) => u.access || ({ admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard" }[u.role] || "limited");
  const out = [], seen = new Set();
  arr(users).forEach(u => { if (!u || u.active === false) return; const n = String(u.name || "").toLowerCase().trim(); const isAdmin = accessOf(u) === "admin", isExtra = EXTRA_RECIPIENTS.some(x => n === x || n.startsWith(x + " "));
    if (!isAdmin && !isExtra) return; const id = u.id || u.name; if (!id || seen.has(id)) return; seen.add(id); out.push({ user: u, reason: isAdmin ? "admin" : "added" }); });
  return out;
}

// ── model ────────────────────────────────────────────────────────────────────
function buildModel(inputs) {
  const I = inputs || {}; const now = I.now instanceof Date ? I.now : new Date();
  const w = weekOf(now), { today, meeting, weekYmds, weekDays } = w;
  const ERR = (e) => ({ error: `Section unavailable this week: ${(e && e.message) || e}` });
  const m = {
    heading: `Friday Strategy Prep — ${meeting.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,   // the doc title; the body carries no heading (it is pasted under Google's own)
    preLine: `pre-filled Fri 6:00 AM MT from the crew app · next week Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])} · booked = Simpro + planner as of 6:00 AM · details live in the app`,
    weekLabel: `Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])}`, meetingYmd: ymd(meeting), todayYmd: ymd(today),
    carried: { error: false, fromLabel: "", rows: [] }, headline: [], schedule: { error: true }, blocked: { error: true }, coming: { error: true }, money: { error: true }, qc: { error: true }, lastWeek: { error: true }, counts: {}, nextState: null,
  };
  let live = [];
  try { if (!Array.isArray(I.jobs)) throw new Error("jobs missing"); live = liveJobs(I.jobs); } catch (e) { const err = ERR(e); m.schedule = err; m.blocked = err; m.coming = err; m.money = err; m.qc = err; m.lastWeek = err; return m; }
  const prev = I.prevState && typeof I.prevState === "object" ? I.prevState : null;
  try { m.carried = parseNotesCarry(I.notesDoc, meeting); } catch (e) { m.carried = { ...ERR(e), fromLabel: "", rows: [] }; }
  let cls = { booked: [], idle: [], starts: [], onHold: [], between: [] }, idx = null;
  try {
    idx = buildScheduleIndex(Array.isArray(I.scheduleEntries) ? I.scheduleEntries : [], I.plannerDoc, live, weekYmds); idx.simproOk = I.simproOk !== false && Array.isArray(I.scheduleEntries);
    cls = classifySchedule(live, idx, weekYmds, today);
    const mv = movedDates(live, prev && prev.dates, today);
    const people = peopleRows({ users: I.users, pto: I.pto, timeOffRequests: I.timeOffRequests, needs: I.needs, prevUserIds: prev ? prev.userIds : null, idx, weekDays, today });
    m.schedule = { error: false, booked: cls.booked.slice(0, CAPS.booked), bookedMore: Math.max(0, cls.booked.length - CAPS.booked), idle: cls.idle, starts: cls.starts, onHold: cls.onHold, between: cls.between, moved: mv.rows, passed: mv.passed, movedFirstRun: mv.firstRun,
      calendar: calendarRows(live, I.calendarEvents, weekYmds).slice(0, CAPS.calendar), people, conflicts: conflictRows(idx, I.pto, weekYmds), unknownSimpro: idx.unknownSimpro, simproOk: idx.simproOk, plannerPresent: idx.plannerPresent };
  } catch (e) { m.schedule = ERR(e); }
  try { m.blocked = { error: false, ...blockedRows({ live, needs: I.needs, users: I.users, prevBlockerKeys: prev ? prev.blockerKeys : null, today }) }; } catch (e) { m.blocked = ERR(e); }
  try { m.coming = comingRows({ live, upcoming: I.upcoming, agentFindings: I.agentFindings, weekYmds, today, cls }); } catch (e) { m.coming = ERR(e); }
  try { m.money = moneyRows({ live, simproTotalsById: I.simproTotalsById, prevMargin: prev ? prev.marginByJob : null, today }); } catch (e) { m.money = ERR(e); }
  try { m.qc = qcRows({ live, today }); } catch (e) { m.qc = ERR(e); }
  try { m.lastWeek = lastWeekRows({ jobs: I.jobs, live, users: I.users, prevState: prev, blocked: m.blocked.error ? { cleared: [] } : m.blocked, today }); } catch (e) { m.lastWeek = ERR(e); }
  // headline — each line drops if its section failed
  try {
    const H = [];
    if (!m.schedule.error) { const s = m.schedule, risk = s.starts.filter(x => !x.crewBooked).length; H.push(`Next week: ${plural(cls.booked.length, "job")} crewed · ${s.idle.length} in progress with nobody booked · ${plural(s.starts.length, "start")}${risk ? `, ${risk} with no crew` : ""}.`); }
    if (!m.blocked.error) { const parts = GROUP_ORDER.filter(g => m.blocked.byGroup[g]).map(g => `${m.blocked.byGroup[g]} on ${g.replace(" (office owes the field)", "").toLowerCase()}`); H.push(`${plural(m.blocked.total, "job")} blocked${parts.length ? `: ${parts.join(", ")}` : ""}.`); }
    if (!m.money.error) { const r = m.money.rti, g = m.money.margin; H.push(`${r.count ? `${fmtMoney(r.total)}${r.knownCount < r.count ? "+" : ""} ready to bill on ${plural(r.count, "job")}` : "Nothing ready to bill"}${g.median != null ? ` · margin at finish median ${g.median}% vs ${MARGIN_TARGET}%, ${g.underCount} under` : ""}.`); }
    m.headline = H;
  } catch (e) { m.headline = []; }
  m.counts = { live: live.length, booked: cls.booked.length, idle: cls.idle.length, starts: cls.starts.length, onHold: cls.onHold.length, between: cls.between.length, blocked: m.blocked.error ? null : m.blocked.total, rti: m.money.error ? null : m.money.rti.count, qc: m.qc.error ? null : m.qc.rows.length, carried: m.carried.rows.length };
  const weekRow = { ymd: ymd(today), counts: m.lastWeek.error ? {} : m.lastWeek.counts };
  m.nextState = { blockerKeys: m.blocked.error ? arr(prev && prev.blockerKeys) : m.blocked.keys, marginByJob: m.money.error ? (prev && prev.marginByJob) || {} : m.money.marginByJob,
    dates: nextDates(live, prev && prev.dates, ymd(today)), userIds: arr(I.users).map(u => u && (u.id || u.name)).filter(Boolean), weeks: [weekRow, ...arr(prev && prev.weeks).filter(x => x && x.ymd !== weekRow.ymd)].slice(0, 8) };
  return m;
}
```

`parseNotesCarry` is written in Task 5; until then add a stub at the top of the module so Task 4's tests run: `let parseNotesCarry = () => ({ error: false, fromLabel: "", rows: [] });` and replace it with the real function in Task 5 (declared with `function`, delete the stub).

Add to exports: `buildModel, comingRows, moneyRows, qcRows, lastWeekRows, collectSimproCandidates, resolveRecipients, isFinishingOpen, isRti, mondayOf, EXTRA_RECIPIENTS`.

- [ ] **Step 4: Run the tests; reconcile numbers**

Run: `node scripts/strategyprep-test.js`. Expected all `ok`. Likely adjustments: the `qc` test expects Wade (finish 95%, no QC status) and Webb (final passed 10/14, no QC) — both satisfy the rule; Bulowski/Cowdrey (90/95, no QC) also appear, which the test allows.

- [ ] **Step 5: Commit**

```bash
git add functions/strategyPrep.js scripts/strategyprep-test.js
git commit -m "Friday prep: coming up, money (packet engine), QC, last week, headline, state snapshot"
```

---

### Task 5: Notes-doc parser (Docs JSON) and the line renderer

**Files:**
- Modify: `functions/strategyPrep.js` (replace the `parseNotesCarry` stub; add `renderLines`)
- Modify: `scripts/strategyprep-test.js` (append Task 5 block)

**Interfaces:**
- Produces: `parseNotesCarry(doc, meetingDate)` → `{ error:false, fromLabel:"Oct 9, 2026", rows:[{text, weeks}] }` where `doc` is the Docs API `documents.get` body (`{ body: { content: [...] } }`) and `rows` are last meeting's un-struck Notes/General bullets + unchecked Action items, `weeks` = how many consecutive past sections carried the same normalized text (≥1). `renderLines(model)` → `[{ kind: "h2"|"h3"|"h4"|"p"|"grey"|"bullet"|"check", text, spans?: [{start, len, rgb:[r,g,b], bold}] }]` consumed by `docsRequests(lines, 1)`.
- Consumes: Task 4 `buildModel` output shape.

- [ ] **Step 1: Append Task 5 tests**

```js
// ── Task 5: notes-doc parser + renderer ─────────────────────────────────────
{
  // Minimal Docs JSON in the shape Google's meeting-notes template produces (checked 2026-10-15: H2 date headings, bullets with nestingLevel, strikethrough on done items).
  const para = (text, o = {}) => ({ paragraph: { elements: [{ textRun: { content: text + "\n", textStyle: o.struck ? { strikethrough: true } : {} } }], paragraphStyle: { namedStyleType: o.style || "NORMAL_TEXT" }, ...(o.bullet ? { bullet: { nestingLevel: o.nest || 0 } } : {}) } });
  const doc = { body: { content: [
    para("Meeting Notes", { style: "HEADING_1" }),
    // OUR OWN section for today must be skipped as a source (Review Focus 4).
    para("Oct 16, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }), para("Attendees: Koy"), para("Carried from Oct 9", { style: "HEADING_3" }), para("Rose — still haven't heard from Austin", { bullet: true }),
    para("Oct 9, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }),
    para("Attendees: Justin Cloward Brady Nelson Joshua Cloward Koy Wilkinson"),
    para("Notes"),
    para("Cox overhead temp - Before thursday.", { bullet: true, struck: true }), para("Tuesday Treycen", { bullet: true, nest: 1 }),   // child of a struck item → dropped
    para("Rose", { bullet: true }), para("Still havent heard from austin", { bullet: true, nest: 1 }),
    para("Ashcraft", { bullet: true }), para("Any update?", { bullet: true, nest: 1 }),
    para("Ready to invoice"),
    para("Koplin", { bullet: true }),                                              // not Notes/General/Action → ignored
    para("QCs needed"), para("", { bullet: true }),
    para("Action items"), para("Call Edge about Pierce", { bullet: true }), para("Order spider box", { bullet: true, struck: true }),
    para("Oct 2, 2026 | Weekly Strategy/Scheduling Meeting", { style: "HEADING_2" }),
    para("Notes"), para("Rose", { bullet: true }), para("Pierce - Need Update from Colby", { bullet: true }),
    para("Action items"), para("Call Edge about Pierce", { bullet: true }),
  ] } };
  const meeting = new Date(2026, 9, 16, 12, 0, 0);
  const c = S.parseNotesCarry(doc, meeting);
  t("carry: source section is Oct 9 (not our own Oct 16 one)", c.fromLabel === "Oct 9, 2026", c.fromLabel);
  const texts = c.rows.map(r => r.text);
  t("carry: struck item and its child dropped; parent + child of open items kept as one line", eq(texts, ["Rose — Still havent heard from austin", "Ashcraft — Any update?", "Call Edge about Pierce"]), JSON.stringify(texts));
  t("carry: weeks counted across earlier sections (Rose 2, Ashcraft 1, Pierce action 2)", eq(c.rows.map(r => r.weeks), [2, 1, 2]), JSON.stringify(c.rows.map(r => r.weeks)));
  t("carry: null doc → empty, no throw", S.parseNotesCarry(null, meeting).rows.length === 0);
  t("carry: cap", S.parseNotesCarry({ body: { content: [para("Oct 9, 2026 | X", { style: "HEADING_2" }), para("Notes"), ...Array.from({ length: 30 }, (_, i) => para("row " + i, { bullet: true }))] } }, meeting).rows.length === 20);

  const m = S.buildModel(fixture({ notesDoc: doc }));
  const lines = S.renderLines(m);
  const txt = lines.map(l => l.text);
  t("render: body starts with the grey pre-line, then the headline; no H2 heading, no attendee line", lines[0].kind === "grey" && /pre-filled/.test(lines[0].text) && lines[1].kind === "p" && !lines.some(l => l.kind === "h2") && !txt.some(s => /^Attendees/.test(s)));
  t("render: section headings in meeting order", (() => { const h = lines.filter(l => l.kind === "h3").map(l => l.text.replace(/ [·—].*$/, "")); return eq(h, ["Carried from Oct 9", "Schedule next week", "Blocked", "Coming up", "Money", "QC to schedule", "Last week", "Action items"]); })(), JSON.stringify(lines.filter(l => l.kind === "h3").map(l => l.text)));
  t("render: Namjoshi start row says nobody booked and where the lead is", txt.some(s => /Namjoshi.*rough starts Mon 10\/19.*confirmed.*nobody booked.*lead Treycen Rollene is at The Hideout Mon/.test(s)), txt.filter(s => /Namjoshi/.test(s)).join(" | "));
  t("render: Lot 208 under nobody booked with reasons", txt.some(s => /Skyridge Lot 208.*rough 80%.*ready to invoice 15d.*QC needs.*3 punch.*GC \/ builder/.test(s)), txt.filter(s => /Skyridge/.test(s)).join(" | "));
  t("render: Simpro job unknown to the app printed, not dropped", txt.some(s => /Simpro #9999 \(not in app\).*Zane Watkins/.test(s)));
  t("render: no emoji / non-BMP", lines.every(l => !/[\u{10000}-\u{10FFFF}]/u.test(l.text)));
  t("render: every bullet line is 'bullet' or 'check'; blank check line closes each list", lines.filter(l => l.kind === "check").length >= 6);
  t("render: Micek (between, no date) is NOT printed", !txt.some(s => /Micek/.test(s)));
  const reqs = S.docsRequests(lines, 1);
  t("docsRequests: first is insertText at 1, rest styles/bullets", reqs[0].insertText && reqs[0].insertText.location.index === 1 && reqs.length > 10);
  const err = S.renderLines({ ...m, schedule: { error: "Section unavailable this week: boom" } });
  t("render: a failed section prints its one grey line and the rest still renders", err.some(l => l.kind === "grey" && /boom/.test(l.text)) && err.some(l => l.text === "Money"));
}
```

- [ ] **Step 2: Run to verify it fails** → `parseNotesCarry` returns the stub's empty rows → `carry: source section` FAIL.

- [ ] **Step 3: Implement `parseNotesCarry` (replace the stub) and `renderLines`**

```js
// ── Josh's notes doc → last meeting's carry-forward (Docs API JSON) ─────────
// Sections start at a paragraph whose text begins "Mon D, YYYY |" (Google's meeting-notes heading; any style).
// Inside a section, a non-bullet paragraph names the list: Notes / General / Next week's top priorities / Action items carry;
// Ready to invoice / QCs / Invoicing do not. Struck-through text (what Docs does to a ticked checkbox) = done; its children go with it.
const HEAD_RE = /^([A-Z][a-z]{2} \d{1,2}, \d{4})\s*\|/;
const CARRY_SECTION = /^(notes|general|next week'?s? top priorities|action items?|carried from .+)$/i;
const SKIP_SECTION = /^(ready to invoice|qcs? needed.*|invoicing|invoice ready|app additions.*|schedule.*|money|coming up|blocked|last week|qc to schedule)$/i;
const normText = (s) => String(s || "").toLowerCase().replace(/\(carried \d+ wks?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function docParas(doc) {
  const content = doc && doc.body && Array.isArray(doc.body.content) ? doc.body.content : [];
  return content.filter(c => c && c.paragraph).map(c => {
    const els = arr(c.paragraph.elements).filter(e => e && e.textRun && typeof e.textRun.content === "string");
    const text = els.map(e => e.textRun.content).join("").replace(/\s+/g, " ").trim();
    const struck = els.length > 0 && els.every(e => !e.textRun.content.trim() || (e.textRun.textStyle && e.textRun.textStyle.strikethrough));
    return { text, bullet: !!c.paragraph.bullet, nest: (c.paragraph.bullet && c.paragraph.bullet.nestingLevel) || 0, struck };
  });
}
function sectionsOf(paras) {
  const secs = [];
  paras.forEach(p => { const m = !p.bullet && p.text.match(HEAD_RE); if (m) { const d = toDateAny(m[1]); if (d) secs.push({ label: m[1], date: d, paras: [] }); return; } if (secs.length) secs[secs.length - 1].paras.push(p); });
  return secs;
}
function carryItems(sec) {
  const rows = []; let list = null, struckNest = null, parent = null;
  for (const p of sec.paras) {
    if (!p.bullet) { const t = p.text.replace(/^[*_]+|[*_]+$/g, "").trim(); if (!t) continue; if (CARRY_SECTION.test(t)) { list = "carry"; struckNest = null; parent = null; continue; } if (SKIP_SECTION.test(t) || /^attendees/i.test(t)) { list = "skip"; continue; } if (list === "carry") list = null; continue; }
    if (list !== "carry" || !p.text) continue;
    if (/^owner\s+[—-]\s+what/i.test(p.text)) continue;
    if (struckNest != null && p.nest > struckNest) continue;       // child of a struck item
    struckNest = null;
    if (p.struck) { struckNest = p.nest; if (p.nest === 0) parent = null; continue; }
    if (p.nest === 0) { parent = { text: p.text, children: [] }; rows.push(parent); }
    else if (parent) parent.children.push(p.text);
    else rows.push({ text: p.text, children: [] });
  }
  return rows.map(r => r.children.length ? `${r.text} — ${r.children.join("; ")}` : r.text);
}
function parseNotesCarry(doc, meetingDate) {
  const empty = { error: false, fromLabel: "", rows: [] };
  if (!doc) return empty;
  const meet = meetingDate instanceof Date ? startOfDay(meetingDate) : new Date();
  const secs = sectionsOf(docParas(doc)).filter(s => s.date < meet).sort((a, b) => b.date - a.date);
  if (!secs.length) return empty;
  const items = carryItems(secs[0]);
  const earlier = secs.slice(1).map(s => new Set(carryItems(s).map(normText)));
  const rows = items.map(text => { const k = normText(text); let weeks = 1; for (const set of earlier) { if (set.has(k) || [...set].some(x => x && (k.includes(x) || x.includes(k)))) weeks++; else break; } return { text, weeks }; });
  return { error: false, fromLabel: secs[0].label, rows: rows.slice(0, CAPS.carried) };
}

// ── lines for the Docs API (consumed by foremanMeetingPrep.docsRequests) ─────
const RED = [0.72, 0.14, 0.14], GREEN = [0.12, 0.48, 0.3], AMBER = [0.71, 0.33, 0.1], BLUE = [0.18, 0.4, 0.77];
function renderLines(m) {
  const L = [];
  const H3 = (t) => L.push({ text: t, kind: "h3" }), H4 = (t) => L.push({ text: t, kind: "h4" });
  const P = (t) => L.push({ text: t, kind: "p" }), G = (t) => L.push({ text: t, kind: "grey" }), C = (t) => L.push({ text: t, kind: "check" });
  const B = (t, spans) => L.push({ text: t, kind: "bullet", spans: spans || [] });
  const tag = (word, rgb, rest) => { B(`${word} ${rest}`, [{ start: 0, len: word.length, rgb, bold: true }]); };
  const fail = (sec) => G(typeof sec.error === "string" ? sec.error : "Section unavailable this week.");
  const more = (n) => { if (n > 0) G(`…and ${n} more in the app`); };
  const who = (r) => [r.foreman, r.lead && r.lead !== r.foreman ? r.lead : ""].filter(Boolean).join(" · ");
  const age = (n) => n == null ? "no date" : `${n}d`;

  G(m.preLine);
  if (m.headline.length) m.headline.forEach(P);

  // Carried
  H3(m.carried.fromLabel ? `Carried from ${m.carried.fromLabel}` : "Carried from last meeting");
  if (m.carried.error) fail(m.carried); else if (!m.carried.rows.length) G("Nothing carried.");
  else m.carried.rows.forEach(r => C(`${r.text}${r.weeks > 1 ? ` (carried ${r.weeks} wks)` : ""}`));
  C("");

  // Schedule
  H3(`Schedule next week · ${m.weekLabel}`);
  if (m.schedule.error) fail(m.schedule); else {
    const s = m.schedule;
    H4(`Booked${s.simproOk ? "" : " — Simpro unavailable; planner only"}${s.plannerPresent ? "" : " (no planner for next week; Simpro only)"}`);
    if (!s.booked.length) G("Nothing booked for next week yet (as of 6:00 AM).");
    s.booked.forEach(r => B(`${r.name} — ${r.phase}${r.pct ? ` ${r.pct}%` : ""} · ${r.days} · ${r.people.join(", ")}${r.qcNeeds ? " · QC after" : ""}${r.start ? ` · ${r.start.phase} start ${fmtMD(r.start.date)} ${r.start.confirmed ? "confirmed" : "projected"}` : ""}`));
    more(s.bookedMore);
    s.unknownSimpro.forEach(u => B(`Simpro #${u.pid} (not in app) · ${daysLabel(u.days)} · ${u.people.join(", ")}`));
    H4("In progress, nobody booked");
    if (!s.idle.length) G("Every in-progress job has crew next week.");
    s.idle.forEach(r => tag("NO CREW", RED, `${r.name} — ${r.phase} ${r.pct}% · last update ${r.lastUpdate ? fmtMD(r.lastUpdate) : "none on file"}${r.rti ? ` · ready to invoice ${age(r.rtiDays)}` : ""}${r.qcNeeds ? " · QC needs" : ""} · ${r.openPunch} punch${r.questions ? ` · ${plural(r.questions, "question")}` : ""}${r.waitBuckets.length ? ` · waiting: ${r.waitBuckets.slice(0, 2).join(", ")}` : ""}${!s.simproOk ? " (Simpro not checked)" : ""}`));
    H4("Starts");
    if (!s.starts.length) G("No starts dated inside next week.");
    s.starts.forEach(r => { const chip = r.atRisk ? ["AT RISK", RED] : r.confirmed ? ["CONFIRMED", GREEN] : ["PROJECTED", AMBER];
      tag(chip[0], chip[1], `${r.name} — ${r.phase} starts ${DAY_LBL[r.di]} ${fmtMD(r.date)} ${r.confirmed ? "confirmed" : "projected"} · nobody booked${r.missingRoles.length ? ` · no ${r.missingRoles.join(", no ")}` : who(r) ? ` · ${who(r)}` : ""} · prep ${r.prep.done}/${r.prep.total}${r.prep.missing.length && r.prep.done < 5 ? ` (${r.prep.missing.map(x => x.replace(/ Received| Up to Date| to App & SimPro| to Foreman/g, "")).join(", ")})` : ""}${r.elsewhere.length ? ` · ${r.elsewhere.join("; ")}` : ""}`); });
    H4("Dates that moved since last Friday");
    if (s.movedFirstRun) G("Tracking starts this week."); else if (!s.moved.length && !s.passed.length) G("Nothing moved.");
    s.moved.forEach(r => B(`${r.name} — ${r.label} ${r.from} → ${r.to}${r.nth > 2 ? ` (${r.nth}${r.nth === 3 ? "rd" : "th"} date)` : ""}`));
    s.passed.forEach(r => tag("DATE PASSED", AMBER, `${r.name} — ${r.label} ${r.date}, status never moved`));
    H4("On the calendar");
    if (!s.calendar.length) G("No inspections, walks or scans dated next week.");
    s.calendar.forEach(r => B(`${DAY_LBL[r.di]} — ${r.label} · ${r.name}${r.who ? ` · ${r.who}` : ""}`));
    H4("People");
    const p = s.people;
    if (p.out.length) B(`Out: ${p.out.map(o => `${o.name} ${o.range}${o.note ? ` (${o.note})` : ""}`).join(" · ")}`); else B("Nobody out next week.");
    p.pending.forEach(r => B(`Pending request: ${r.name} · ${r.range}${r.requestedDays != null ? ` · asked ${r.requestedDays}d ago` : ""}`));
    p.bodies.forEach(r => B(`Bodies asked for: ${r.text}${r.job ? ` [${r.job}]` : ""} (${r.by}${r.ageDays != null ? `, ${r.ageDays}d ago` : ""})`));
    p.newUsers.forEach(u => B(`New on the team: ${u.name}${u.title ? ` · ${u.title}` : ""}`));
    B(`Capacity (booked / available): ${p.capacity.map(c => `${DAY_LBL[c.di]} ${c.booked}/${c.available}`).join(" · ")}`, p.capacity.filter(c => c.thin).length ? [] : []);
    if (s.conflicts.length) { H4("Conflicts"); s.conflicts.forEach(c => tag("CONFLICT", RED, c)); }
    if (s.onHold.length) G(`${plural(s.onHold.length, "job")} on hold listed under Blocked.`);
  }
  C("");

  // Blocked
  H3("Blocked — what we are waiting on, from whom, how long");
  if (m.blocked.error) fail(m.blocked); else {
    if (!m.blocked.groups.length) G("Nothing blocked.");
    m.blocked.groups.forEach(g => { H4(`${g.name} · ${g.rows.length + g.more}`); g.rows.forEach(r => B(`${r.name} — ${r.what}${r.who ? ` · ${r.who}` : ""} · ${age(r.ageDays)}`)); more(g.more); });
    if (m.blocked.cleared.length) { H4("Cleared since last Friday"); m.blocked.cleared.forEach(c => tag("CLEARED", GREEN, `${c.name} — ${c.group}`)); }
  }
  C("");

  // Coming up
  H3("Coming up · next 2–8 weeks");
  if (m.coming.error) fail(m.coming); else {
    const c = m.coming;
    if (!c.weeks.length) G("No dated starts after next week.");
    c.weeks.forEach(w => B(`${w.label} — ${w.rows.map(r => `${r.name}${r.customer ? ` (${r.customer})` : ""} ${fmtMD(r.date)} ${r.confirmed ? "confirmed" : "projected"}${r.note ? ` · ${r.note}` : ""}`).join(" · ")}`));
    if (c.noDate.length) B(`No date yet: ${c.noDate.map(r => `${r.name}${r.note ? ` (${r.note})` : ""}`).join(" · ")}`);
    if (c.prep.length) B(`In prep, start inside 3 weeks: ${c.prep.map(r => `${r.name} ${r.done}/5${r.missing.length ? ` (${r.missing.map(x => x.replace(/ Received| Up to Date| to App & SimPro| to Foreman/g, "")).join(", ")})` : ""}`).join(" · ")}`);
    c.findings.forEach(f => B(`Plan intake: ${f.summary}`));
    B(`Crews freeing up (finish ≥ 90% or ready to invoice): ${c.freeing.length ? c.freeing.map(r => r.name).join(", ") : "none"} · starts in the next two weeks: ${c.startsSoon}`);
  }
  C("");

  // Money
  H3("Money");
  if (m.money.error) fail(m.money); else {
    const r = m.money.rti, g = m.money.margin, a = m.money.approved;
    H4(`Ready to invoice · ${r.count}`);
    if (!r.rows.length) G("Nothing ready to invoice.");
    r.rows.forEach(x => B(`${x.name}${x.foreman ? ` · ${x.foreman}` : ""}${x.dollars != null ? ` · ${fmtMoney(x.dollars)}` : ""}${x.idleDays != null ? ` · idle ${x.idleDays}d` : ""}${x.margin != null ? ` · ${x.margin}% margin` : ""}${x.flag ? ` · ${x.flag}` : ""}`, x.flag ? [{ start: 0, len: x.name.length, rgb: RED, bold: false }] : []));
    more(r.more);
    H4("Margin at finish");
    if (g.median == null) G("No margin data on finishing jobs."); else {
      B(`Median ${g.median}% across ${plural(g.count, "finishing job")} · target ${MARGIN_TARGET}% · ${g.underCount} under`);
      if (g.firstRun) G("Movers: tracking starts this week."); else if (!g.movers.length) G("No margin moved 3 points or more since last Friday.");
      g.movers.forEach(x => B(`${x.name} ${x.from}% → ${x.to}% (${x.delta > 0 ? "+" : ""}${x.delta})`));
    }
    H4(`Approved this week · ${a.count}`);
    if (!a.rows.length) G("No change orders approved this week.");
    a.rows.forEach(x => B(`${x.name}${x.quote ? ` #${x.quote}` : ""}${x.desc ? ` — ${x.desc}` : ""}`));
    if (a.count) B(`${a.undated} of ${a.count} not dated yet`);
  }
  C("");

  // QC
  H3("QC to schedule");
  if (m.qc.error) fail(m.qc); else { if (!m.qc.rows.length) G("Nothing waiting on a QC walk."); m.qc.rows.forEach(r => B(`${r.name}${r.foreman ? ` · ${r.foreman}` : ""} — ${r.why}${r.since ? ` since ${r.since}` : ""} · ${r.openPunch} punch open${r.small ? " · small — pics may do" : ""}`)); more(m.qc.more); }
  C("");

  // Last week
  H3("Last week");
  if (m.lastWeek.error) fail(m.lastWeek); else {
    const l = m.lastWeek;
    B(`Finished: ${l.finished.length ? l.finished.join(", ") : "none"}`);
    B(`Inspections: ${l.inspPassed} passed · ${l.inspFailed} failed`);
    B(`Change orders: ${l.cosCreated} created · ${l.cosApproved} approved · ${l.cosConverted} converted to return trip`);
    B(`Return trips created: ${l.rtCreated}${l.rtAvg4 != null ? ` (4-week average ${l.rtAvg4})` : ""}`);
    B(`Punch closed: ${l.punchClosed} · questions answered ${l.qAnswered} of ${l.qAsked} asked`);
    B(`Blocks cleared: ${l.cleared.length}`);
  }

  // Action items
  H3("Action items");
  G("Owner — what — by when");
  C(""); C(""); C(""); C("");
  return L;
}
```

Export `parseNotesCarry, renderLines, docParas, sectionsOf, carryItems`. Delete the Task 4 stub.

- [ ] **Step 4: Run the tests** → all `ok`. If "render: Lot 208 under nobody booked" fails on the wait bucket text, the fixture's "Pocket door framed" matches `GC / builder` (regex has `pocket door`), "Need ufer clamp" matches none → "Other"; the row prints the top two buckets, so `GC / builder 1` must appear.

- [ ] **Step 5: Commit**

```bash
git add functions/strategyPrep.js scripts/strategyprep-test.js
git commit -m "Friday prep: notes-doc carry parser (Docs JSON) + Docs line renderer"
```

---

### Task 6: Orchestrator — `runStrategyPrep`, cron, test callable

**Files:**
- Modify: `functions/index.js` — insert the block directly ABOVE the `// SCHEDULED — Tuesday 6:00am Mountain Time` comment that precedes `runLeadMeetingPrep` (so it sits next to the packet code it replaces).

**Interfaces:**
- Consumes: `strategyPrep.js` exports from Tasks 1–5; existing `db`, `functions`, `google`, `getUsers`, `deliverIfWanted`, `sendToName`, `requireAppKey`, `SIMPRO_BASE`, `SIMPRO_TOKEN`, `TZ`, `PACKET_DRIVE_FOLDER_ID`, `foremanPrepLib.docsRequests` (already required as `foremanPrepLib`).
- Produces: `runStrategyPrep({ testRun })` → `{ ok, docLink, docId, counts, recipients, fallback? }`; `exports.strategyPrep` (cron `0 6 * * 5`, secrets `["PLAN_INTAKE_GOOGLE_OAUTH"]`); `exports.sendTestStrategyPrep` (callable, app key; body `{ _appKey }`; writes a `TEST — ` doc).

- [ ] **Step 1: Record the export count**

Run: `cd functions && node -e "console.log(Object.keys(require('./index.js')).length)"` → expect `106`.

- [ ] **Step 2: Add the orchestrator block**

```js
// ─────────────────────────────────────────────────────────────
// SCHEDULED — Friday 6:00am Mountain Time
// Weekly Strategy/Scheduling Meeting pre-fill — writes this week's doc
// "Friday Strategy Prep — <date>" to the packet Drive folder, styled like a Docs
// section so Koy pastes its body into Josh's running notes doc (Koy, 2026-10-15:
// "lets just have it on its own doc, ill copy and paste each week to the meeting
// doc"). Content is the PURE builder ./strategyPrep.js so scripts/strategyprep-dryrun.js
// renders the identical doc as a PREVIEW for sign-off. Replaces fridayPacket
// (spec docs/superpowers/specs/2026-10-15-friday-strategy-prep-design.md).
// Reads jobs/needs/settings/agentFindings, Simpro schedules + totals, Koy's
// calendar (PLAN_INTAKE_GOOGLE_OAUTH, same as the plan-intake watcher), Josh's
// doc read-only (carry-forward); writes ONE new doc + ONE additive merge to
// settings/strategyPrep.
// ─────────────────────────────────────────────────────────────
const STRATEGY_NOTES_DOC_ID = "1u5Z63PnYVANQJyjam1USUSDbKj6P62sRFJCpxjgkvOM";   // Josh's notes doc — READ ONLY here
const strategyLib = require("./strategyPrep.js");

async function runStrategyPrep({ testRun = false } = {}) {
  const now = new Date();
  const w = strategyLib.weekOf(now);
  const windowStart = w.weekYmds[0], windowEnd = w.weekYmds[4];
  const inputErrors = [];

  // 1 · Firestore reads (jobs/needs wrapped {data}; settings docs not wrapped).
  const [snap, needSnap, upSnap, planSnap, ptoSnap, toSnap, stateSnap, findSnap, users] = await Promise.all([
    db.collection("jobs").get(), db.collection("needs").get(), db.doc("settings/upcoming_jobs").get(),
    db.doc(`settings/schedule_${w.weekYmds[0]}`).get(), db.doc("settings/crewPTO").get(), db.doc("settings/timeOffRequests").get(),
    db.doc("settings/strategyPrep").get(), db.collection("agentFindings").where("day", ">=", strategyLib.ymd(strategyLib.addDays(w.today, -7))).get().catch(e => { inputErrors.push(`agentFindings: ${e.message}`); return { docs: [] }; }),
    getUsers(),
  ]);
  const unwrap = (d) => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; };
  const jobs = snap.docs.map(unwrap), needs = needSnap.docs.map(unwrap);
  const upcoming = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const plannerDoc = planSnap.exists ? planSnap.data() : null;
  const pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];
  const timeOffRequests = toSnap.exists ? (toSnap.data().list || []) : [];
  const prevState = stateSnap.exists ? stateSnap.data() : null;
  const agentFindings = findSnap.docs.map(d => d.data());

  // 2 · Simpro schedules for next week — between() filter (verified 2026-10-15), paged just in case.
  let scheduleEntries = [], simproOk = true;
  try {
    for (let page = 1; page <= 10; page++) {
      const resp = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}&Date=between(${windowStart},${windowEnd})&columns=ID,Type,Date,Staff,Project`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
      if (!resp.ok) { simproOk = false; functions.logger.warn("strategyPrep simpro schedule page failed", { page, status: resp.status }); break; }
      const batch = await resp.json();
      if (!Array.isArray(batch)) { simproOk = false; functions.logger.warn("strategyPrep simpro schedule non-array"); break; }
      scheduleEntries.push(...batch);
      if (batch.length < 250) break;
    }
  } catch (e) { simproOk = false; functions.logger.warn("strategyPrep simpro schedule fetch error", { error: e.message }); }
  if (!simproOk) scheduleEntries = [];

  // 3 · Simpro totals for ready-to-invoice + finishing jobs (cap 50, concurrency 5). Parsing mirrors getSimproJobFinancials.
  const simproTotalsById = {};
  try {
    const wanted = strategyLib.collectSimproCandidates(jobs);
    for (let i = 0; i < wanted.length; i += 5) {
      await Promise.all(wanted.slice(i, i + 5).map(async (sn) => {
        try {
          const resp = await fetch(`${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(sn)}&pageSize=1&columns=ID,Total,Totals`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
          if (!resp.ok) return;
          const results = await resp.json(); const sj = Array.isArray(results) ? results[0] : null; if (!sj) return;
          const t = sj.Totals || {}, actual = t.NettMargin?.Actual ?? null, estimate = t.NettMargin?.Estimate ?? null, hasReal = actual !== null && actual !== 100, top = sj.Total || {};
          simproTotalsById[sn] = { total: typeof top.IncTax === "number" ? top.IncTax : (typeof t.IncTax === "number" ? t.IncTax : null), margin: hasReal ? actual : estimate, isEstimate: !hasReal };
        } catch (e) { /* cache fallback */ }
      }));
    }
  } catch (e) { functions.logger.warn("strategyPrep simpro totals error", { error: e.message }); }

  // 4 · Koy's calendar next week (read as Koy via the plan-intake OAuth secret). Missing secret ⇒ no calendar rows.
  let calendarEvents = [];
  try {
    const raw = process.env.PLAN_INTAKE_GOOGLE_OAUTH; if (!raw) throw new Error("PLAN_INTAKE_GOOGLE_OAUTH not set");
    const o = JSON.parse(raw); const auth = new google.auth.OAuth2(o.client_id, o.client_secret); auth.setCredentials({ refresh_token: o.refresh_token });
    const cal = google.calendar({ version: "v3", auth });
    const r = await cal.events.list({ calendarId: "koy@homesteadelectric.net", timeMin: `${windowStart}T00:00:00-06:00`, timeMax: `${windowEnd}T23:59:59-06:00`, singleEvents: true, maxResults: 250 });
    calendarEvents = (r.data && r.data.items) || [];
  } catch (e) { inputErrors.push(`calendar: ${e.message}`); functions.logger.warn("strategyPrep calendar read failed", { error: e.message }); }

  // 5 · Josh's notes doc, READ ONLY, for carry-forward. 403 until shared with the service account as Viewer ⇒ section degrades.
  let notesDoc = null;
  try {
    const roAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/documents.readonly"] });
    notesDoc = (await google.docs({ version: "v1", auth: roAuth }).documents.get({ documentId: STRATEGY_NOTES_DOC_ID })).data || null;
  } catch (e) { inputErrors.push(`notes doc read: ${e.message.slice(0, 80)}`); functions.logger.warn("strategyPrep notes doc read failed", { error: e.message }); }

  // 6 · Build (pure).
  const model = strategyLib.buildModel({ jobs, users, scheduleEntries, plannerDoc, pto, timeOffRequests, needs, upcoming, agentFindings, calendarEvents, prevState, simproTotalsById, notesDoc, simproOk, now });
  const lines = strategyLib.renderLines(model);
  if (inputErrors.length) lines.splice(1, 0, { text: `Some data did not load this run: ${inputErrors.join("; ")}`, kind: "grey" });
  const docTitle = `${testRun ? "TEST — " : ""}${model.heading}`;

  // 7 · Create the week's doc in the packet folder and fill it with the Docs API (styled, pastes clean).
  //     If styling fails, fall back to an HTML-converted Drive doc so the meeting still has one.
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/documents"] });
  const drive = google.drive({ version: "v3", auth }), docs = google.docs({ version: "v1", auth });
  let docId = "", docLink = "", fallback = false;
  try {
    const created = await drive.files.create({ requestBody: { name: docTitle, parents: [PACKET_DRIVE_FOLDER_ID], mimeType: "application/vnd.google-apps.document" }, fields: "id, webViewLink", supportsAllDrives: true });
    docId = created.data.id; docLink = created.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: strategyLib.docsRequests(lines, 1) } });
  } catch (e) {
    functions.logger.error("strategyPrep doc create/fill failed", { error: e.message, docId });
    try {
      const esc = strategyLib.esc;
      const html = `<div style="font-family:Arial,sans-serif;font-size:13px">${lines.map(l => l.kind === "h3" ? `<h2>${esc(l.text)}</h2>` : l.kind === "h4" ? `<h3>${esc(l.text)}</h3>` : l.kind === "grey" ? `<p style="color:#777">${esc(l.text)}</p>` : (l.kind === "bullet" || l.kind === "check") ? `<li>${esc(l.text) || "&nbsp;"}</li>` : `<p>${esc(l.text)}</p>`).join("")}</div>`;
      const created = await drive.files.create({ requestBody: { name: `${docTitle} (fallback)`, parents: [PACKET_DRIVE_FOLDER_ID], mimeType: "application/vnd.google-apps.document" }, media: { mimeType: "text/html", body: html }, fields: "id, webViewLink", supportsAllDrives: true });
      docId = created.data.id; docLink = created.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`; fallback = true;
      await sendToName("Koy", { title: "Friday prep: plain-text fallback", body: `${e.message.slice(0, 100)} — unstyled doc in Drive`, url: docLink });
    } catch (e2) {
      functions.logger.error("strategyPrep fallback failed", { error: e2.message });
      await sendToName("Koy", { title: "Friday prep failed", body: e.message.slice(0, 120) });
      return { ok: false, error: e.message };
    }
  }

  // 8 · State (real runs only; additive merge).
  if (!testRun && model.nextState) {
    try { await db.doc("settings/strategyPrep").set({ ...model.nextState, lastRunAt: now.toISOString(), history: [{ date: model.meetingYmd, docId, docLink }, ...((prevState && prevState.history) || [])].slice(0, 26) }, { merge: true }); }
    catch (e) { functions.logger.warn("strategyPrep state write failed", { error: e.message }); }
  }

  // 9 · Push: headline line 1, tap opens the doc. Test runs → Koy only.
  const notif = { title: "Friday prep", body: (model.headline[0] || `${docTitle} is ready`).slice(0, 180), url: docLink };
  let recipients = [];
  if (testRun) { recipients = ["Koy (test)"]; await sendToName("Koy", notif); }
  else { const resolved = strategyLib.resolveRecipients(users); recipients = resolved.map(r => `${r.user.name} (${r.reason})`); await Promise.all(resolved.map(r => deliverIfWanted(r.user, "friday_packet", notif))); }

  functions.logger.info("strategyPrep done", { docId, docLink, testRun, fallback, recipients, inputErrors, ...model.counts });
  return { ok: true, docId, docLink, fallback, recipients, counts: model.counts, inputErrors };
}

exports.strategyPrep = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB", secrets: ["PLAN_INTAKE_GOOGLE_OAUTH"] })
  .pubsub.schedule("0 6 * * 5")
  .timeZone(TZ)
  .onRun(async () => { await runStrategyPrep(); return null; });

// Manual test: a full real run that writes a "TEST — …" doc, pushes Koy only, and does NOT advance state.
exports.sendTestStrategyPrep = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB", secrets: ["PLAN_INTAKE_GOOGLE_OAUTH"] })
  .https.onCall(async (data) => {
    requireAppKey(data);
    return await runStrategyPrep({ testRun: true });
  });
```

- [ ] **Step 3: Load check and export count**

Run: `cd functions && node --check index.js && node -e "console.log(Object.keys(require('./index.js')).length)"` → `108`.

- [ ] **Step 4: Orchestrator degrade test (Review Focus 5) — a plain-node check that the non-array branch is wired**

Run: `grep -c "simpro schedule non-array" functions/index.js` → `1`, and `node -e "const S=require('./functions/strategyPrep.js'); const m=S.buildModel({jobs:[],scheduleEntries:[],simproOk:false,now:new Date()}); console.log(m.schedule.simproOk===false?'ok':'FAIL')"` → `ok`.

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "Friday prep: strategyPrep orchestrator — reads, Simpro, calendar, Docs insert, Drive fallback, state, push"
```

---

### Task 7: Read-only dry-run into a preview copy, with the `checks` block

**Files:**
- Create: `scripts/strategyprep-dryrun.js`

**Interfaces:**
- Consumes: `functions/strategyPrep.js` (every export used by Task 6), the SA key at `/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json`, `functions/node_modules` (`firebase-admin`, `googleapis`).
- Produces: `strategyprep-dryrun.html` (gitignored like the other dryrun outputs — add the name to `.gitignore` if not matched by an existing pattern) and, with `--doc`, a PREVIEW Google Doc in the packet folder; prints the `checks` block.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/* PREVIEW of the Friday Strategy/Scheduling section against real prod data.
 * Mirrors runStrategyPrep (functions/index.js) steps 1–6 exactly: same reads, same Simpro
 * fetches, same pure builder, same Docs requests — writes strategyprep-dryrun.html and, with
 * --doc, creates "PREVIEW — Friday Strategy Prep — <date>" in the packet folder (delete it when
 * done). Reads Josh's notes doc read-only for carry-forward (403 until shared with the service
 * account as Viewer). Never writes to Josh's doc, never pushes, writes nothing to Firestore. Calendar rows need the OAuth JSON in env PLAN_INTAKE_GOOGLE_OAUTH
 * (copy from Secret Manager); without it the calendar section just says so.
 * The CHECKS block at the end lists every live job and the bucket it landed in — read it
 * before signing off: a job you expected and do not see is a rule bug, not a data gap. */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/firebase-admin"));
const { google } = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/googleapis"));
const SA_PATH = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)), projectId: "homestead-electric" });
const db = admin.firestore();
const S = require(path.join(__dirname, "../functions/strategyPrep.js"));
const SIMPRO_TOKEN = "402222413e886be0bda7bd5173aa8e215d34bcdb";   // same as functions/index.js — keep in sync
const SIMPRO_BASE  = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const NOTES_DOC = "1u5Z63PnYVANQJyjam1USUSDbKj6P62sRFJCpxjgkvOM";   // Josh's doc — read only
const PACKET_FOLDER = "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb";
const makePreview = process.argv.includes("--doc");

(async () => {
  const now = new Date(); const w = S.weekOf(now);
  const unwrap = (d) => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; };
  const [snap, needSnap, upSnap, planSnap, ptoSnap, toSnap, stateSnap, usersSnap, findSnap] = await Promise.all([
    db.collection("jobs").get(), db.collection("needs").get(), db.doc("settings/upcoming_jobs").get(), db.doc(`settings/schedule_${w.weekYmds[0]}`).get(),
    db.doc("settings/crewPTO").get(), db.doc("settings/timeOffRequests").get(), db.doc("settings/strategyPrep").get(), db.doc("settings/users").get(),
    db.collection("agentFindings").where("day", ">=", S.ymd(S.addDays(w.today, -7))).get().catch(() => ({ docs: [] })),
  ]);
  const jobs = snap.docs.map(unwrap), needs = needSnap.docs.map(unwrap), users = usersSnap.exists ? (usersSnap.data().list || []) : [];
  const upcoming = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const plannerDoc = planSnap.exists ? planSnap.data() : null, pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];
  const timeOffRequests = toSnap.exists ? (toSnap.data().list || []) : [], prevState = stateSnap.exists ? stateSnap.data() : null;
  const agentFindings = findSnap.docs.map(d => d.data());
  console.log(`jobs ${jobs.length} · needs ${needs.length} · users ${users.length} · planner ${plannerDoc ? "present" : "MISSING"} · state ${prevState ? "present" : "first run"}`);

  let scheduleEntries = [], simproOk = true;
  try { for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}&Date=between(${w.weekYmds[0]},${w.weekYmds[4]})&columns=ID,Type,Date,Staff,Project`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
    if (!r.ok) { simproOk = false; break; } const b = await r.json(); if (!Array.isArray(b)) { simproOk = false; break; } scheduleEntries.push(...b); if (b.length < 250) break; } } catch (e) { simproOk = false; }
  if (!simproOk) scheduleEntries = [];
  console.log(`simpro schedule entries next week: ${scheduleEntries.length} (ok=${simproOk})`);
  const simproTotalsById = {};
  const wanted = S.collectSimproCandidates(jobs);
  for (let i = 0; i < wanted.length; i += 5) await Promise.all(wanted.slice(i, i + 5).map(async sn => { try {
    const r = await fetch(`${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(sn)}&pageSize=1&columns=ID,Total,Totals`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } }); if (!r.ok) return;
    const sj = (await r.json())[0]; if (!sj) return; const t = sj.Totals || {}, a = t.NettMargin?.Actual ?? null, e = t.NettMargin?.Estimate ?? null, real = a !== null && a !== 100, top = sj.Total || {};
    simproTotalsById[sn] = { total: typeof top.IncTax === "number" ? top.IncTax : (typeof t.IncTax === "number" ? t.IncTax : null), margin: real ? a : e, isEstimate: !real }; } catch (e) {} }));
  console.log(`simpro totals fetched: ${Object.keys(simproTotalsById).length} of ${wanted.length}`);

  let calendarEvents = [];
  try { const raw = process.env.PLAN_INTAKE_GOOGLE_OAUTH; if (!raw) throw new Error("no PLAN_INTAKE_GOOGLE_OAUTH in env");
    const o = JSON.parse(raw); const auth = new google.auth.OAuth2(o.client_id, o.client_secret); auth.setCredentials({ refresh_token: o.refresh_token });
    const r = await google.calendar({ version: "v3", auth }).events.list({ calendarId: "koy@homesteadelectric.net", timeMin: `${w.weekYmds[0]}T00:00:00-06:00`, timeMax: `${w.weekYmds[4]}T23:59:59-06:00`, singleEvents: true, maxResults: 250 });
    calendarEvents = r.data.items || []; } catch (e) { console.log("calendar:", e.message); }

  const docsAuth = new google.auth.GoogleAuth({ keyFile: SA_PATH, scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.file"] });
  const docs = google.docs({ version: "v1", auth: docsAuth }), drive = google.drive({ version: "v3", auth: docsAuth });
  let notesDoc = null;
  try { notesDoc = (await docs.documents.get({ documentId: NOTES_DOC })).data; } catch (e) { console.log("notes doc read:", e.message, "(share Josh's doc with the service account as Viewer to get carry-forward)"); }

  const model = S.buildModel({ jobs, users, scheduleEntries, plannerDoc, pto, timeOffRequests, needs, upcoming, agentFindings, calendarEvents, prevState, simproTotalsById, notesDoc, simproOk, now });
  const lines = S.renderLines(model);
  const html = `<html><body style="font-family:Arial,sans-serif;font-size:13px;max-width:760px;margin:20px auto">${lines.map(l => l.kind === "h2" ? `<h1>${S.esc(l.text)}</h1>` : l.kind === "h3" ? `<h2>${S.esc(l.text)}</h2>` : l.kind === "h4" ? `<h3>${S.esc(l.text)}</h3>` : l.kind === "grey" ? `<p style="color:#777">${S.esc(l.text)}</p>` : (l.kind === "bullet" || l.kind === "check") ? `<div>&bull; ${S.esc(l.text) || "&nbsp;"}</div>` : `<p>${S.esc(l.text)}</p>`).join("\n")}</body></html>`;
  fs.writeFileSync(path.join(__dirname, "../strategyprep-dryrun.html"), html);
  console.log("wrote strategyprep-dryrun.html");
  if (makePreview) {
    const created = await drive.files.create({ requestBody: { name: `PREVIEW — ${model.heading}`, parents: [PACKET_FOLDER], mimeType: "application/vnd.google-apps.document" }, fields: "id, webViewLink", supportsAllDrives: true });
    await docs.documents.batchUpdate({ documentId: created.data.id, requestBody: { requests: S.docsRequests(lines, 1) } });
    console.log(`preview doc: ${created.data.webViewLink || `https://docs.google.com/document/d/${created.data.id}/edit`}`);
  }

  // CHECKS — every live job and where it landed.
  const live = S.liveJobs(jobs), s = model.schedule;
  console.log("\nCHECKS");
  console.log("headline:", model.headline);
  console.log("counts:", JSON.stringify(model.counts));
  if (!s.error) {
    const bucketOf = {}; s.booked.forEach(r => bucketOf[r.jobId] = "booked"); s.idle.forEach(r => bucketOf[r.jobId] = "nobody booked"); s.starts.forEach(r => bucketOf[r.jobId] = "start"); s.onHold.forEach(r => bucketOf[r.jobId] = "on hold"); s.between.forEach(r => bucketOf[r.jobId] = "between phases, no date (not printed)");
    live.sort((a, b) => a.name.localeCompare(b.name)).forEach(j => console.log(`  ${(bucketOf[j.id] || "MISSING — RULE BUG").padEnd(42)} ${j.name}`));
    const missing = live.filter(j => !bucketOf[j.id]); console.log(`\nlive ${live.length} · booked ${s.booked.length + s.bookedMore} · nobody booked ${s.idle.length} · starts ${s.starts.length} · on hold ${s.onHold.length} · between ${s.between.length} · MISSING ${missing.length}`);
    if (missing.length) process.exitCode = 2;
  } else console.log("schedule section failed:", s.error);
  console.log("blocked by group:", JSON.stringify(model.blocked.byGroup || model.blocked.error));
  console.log("simpro people booked next week:", [...(scheduleEntries.reduce((m, e) => { if (e.Type === "job" && e.Staff) m.add(e.Staff.Name); return m; }, new Set()))].join(", "));
})().catch(e => { console.error("dryrun failed:", e); process.exit(1); });
```

- [ ] **Step 2: Run it against prod (read-only), HTML only**

Run: `node scripts/strategyprep-dryrun.js` → prints counts and the CHECKS list; `MISSING 0`. Open `strategyprep-dryrun.html`. Check the CHECKS list against what Koy knows (Lot 208 under "nobody booked", Namjoshi under "start" with the Treycen line).

- [ ] **Step 3: Preview doc**

Run `node scripts/strategyprep-dryrun.js --doc` → a `PREVIEW — Friday Strategy Prep — <date>` doc in the packet folder, styled exactly as the function will write it. Koy opens it, and pastes its body into a scratch doc to confirm checkboxes and colors survive a copy-paste. **Koy signs off here (spec §8 step 2).** Delete the preview doc afterwards.

- [ ] **Step 4: Commit**

```bash
git add scripts/strategyprep-dryrun.js .gitignore
git commit -m "Friday prep: read-only dry-run with CHECKS block into a preview copy"
```

---

### Task 8: Deploy, first real Friday, then retire the packet and the routine

**Files:**
- Modify: `functions/index.js` (delete `runFridayPacket`, `exports.fridayPacket`, `exports.sendTestFridayPacket`, the `fridayPacketLib` require and the packet comment block; keep `_stripHtml` — it has other callers)
- Delete: `functions/fridayPacket.js`, `scripts/packet-dryrun.js`
- Modify: `functions/autoDocs.js`, `scripts/autodocs-test.js`
- Modify (other repo, one note only): `~/Desktop/homestead-command-center/scripts/strategy-prep.mjs` header comment: `// RETIRED 2026-10-xx — replaced by functions/strategyPrep.js in the crew app.`

**Interfaces:**
- `AUTO_DOC_SOURCES`: remove `packet`; change `strategy` to `{ key: "strategy", folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Friday Strategy Prep — " }`; `pickLatest` and `autoDocsLatest` unchanged.

- [ ] **Step 1: Prerequisite and deploy (Koy's terminal)**

Optional but recommended: Josh (or Koy, if he has edit rights) shares the notes doc with `homestead-electric@appspot.gserviceaccount.com` as **Viewer** so the Carried section fills. Then:

```bash
cd functions && FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:strategyPrep,functions:sendTestStrategyPrep
```

Test run (app key from `APP_CALL_KEY` in functions/index.js):

```bash
curl -s -X POST https://us-central1-homestead-electric.cloudfunctions.net/sendTestStrategyPrep -H "Content-Type: application/json" -d '{"data":{"_appKey":"<APP_CALL_KEY>"}}'
```

Expected: `{"result":{"ok":true,"docLink":"…","counts":{…}}}`; a `TEST — Friday Strategy Prep — <date>` doc in the packet folder; Koy's phone gets "Friday prep" with headline line 1; tapping opens the doc.

- [ ] **Step 2: First real Friday**

Leave `fridayPacket` running this one Friday too (belt and braces). At 6:05 check: `Friday Strategy Prep — <date>` in the packet folder, push received. Koy pastes the body under Google's dated heading in Josh's doc; confirm checkboxes and colors survive the paste.

- [ ] **Step 3: Retire the packet (code)**

In `functions/index.js`: delete from the `// SCHEDULED — Friday 5:30am Mountain Time … Friday Packet` comment through the end of `exports.sendTestFridayPacket`, plus `const fridayPacketLib = require("./fridayPacket.js");`. Keep `_stripHtml`. Run `grep -n "fridayPacketLib\|runFridayPacket" functions/index.js` → no hits. `node --check index.js`; export count → `106`. Delete `functions/fridayPacket.js` and `scripts/packet-dryrun.js`; `grep -rn "fridayPacket.js\|packet-dryrun" scripts functions --include=*.js --include=*.json` → only `autodocs-test.js` fixture names (fine).

- [ ] **Step 4: autoDocs**

```js
const AUTO_DOC_SOURCES = [
  { key: "lead",     folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Lead Meeting Prep — " },
  { key: "weekly",   folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Weekly Lead Meeting — " },
  { key: "strategy", folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Friday Strategy Prep — " },
  { key: "monday",   folder: "1-_A2XYgbz85O83K1Hwspka4KCnYeZQYP", prefix: "Monday Office Meeting — " },
];
```

`pickLatest` and the `autoDocsLatest` loop are unchanged (same folder, new prefix). In `scripts/autodocs-test.js` replace the packet-prefix fixture names with `Friday Strategy Prep — 2026-10-16` / `TEST — Friday Strategy Prep — 2026-10-16` and assert the TEST doc never wins (`pickLatest` requires the name to START with the prefix). Run it.

- [ ] **Step 5: Deploy the retirement + disable the routine**

```bash
cd functions && FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only functions:autoDocsLatest
firebase functions:delete fridayPacket sendTestFridayPacket --force
firebase functions:list | grep -i "packet\|strategy"
```

Expected: `strategyPrep`, `sendTestStrategyPrep` present; no `fridayPacket`. Disable the `friday-strategy-prep` scheduled task (Claude app → Scheduled tasks → off) and add the RETIRED line to `strategy-prep.mjs`.

- [ ] **Step 6: Commit**

```bash
git add functions/index.js functions/autoDocs.js scripts/autodocs-test.js
git rm functions/fridayPacket.js scripts/packet-dryrun.js
git commit -m "Friday prep live: retire fridayPacket + packet dry-run; autoDocs strategy card points at Josh's notes doc"
```

---

### Task 9: Client ship — Dashboard card, Settings toggle, FEATURES.md, SW bump, vault + crew brief

**Files:**
- Modify: `src/App.js` (`OD_DOCS` entries `packet` + `strategy`; `NOTIF_CATEGORIES` Reminders group)
- Modify: `public/service-worker.js` line 1, `FEATURES.md` (entry under the newest ship section)
- Modify: `public/sops/dashboard.html` (one sentence in the Automated docs paragraph: the Friday card opens Josh's notes doc)
- Vault: `~/Desktop/Command Center/Logs/<date> - Homestead Electric.md`, `02-Features/Thursday Packet.md` (status → superseded, link to the new feature note), new `02-Features/Friday Strategy Prep.md`; crew brief in `docs/crew-briefs/` via the `crew-brief` skill (office-facing).

- [ ] **Step 1: `OD_DOCS`**

Replace the `packet` and `strategy` entries with one:

```js
  { k: "strategy", title: "Friday meeting prep", when: "Fridays 6:00 AM", by: "App (strategyPrep)", what: "Next week's schedule gaps, blocked jobs, money and QC — paste it into Josh's meeting notes", url: OD_GFOLDER("1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb"), folder: true, latest: "strategy" },
```

Remove the `settings/fridayPacket.lastRunAt` read if the card used it (grep `fridayPacket` in App.js; swap to `settings/strategyPrep` `lastRunAt`).

- [ ] **Step 2: Settings toggle**

In `NOTIF_CATEGORIES`, in the Reminders group, add: `{ key:"friday_packet", label:"Friday meeting prep (Fri 6:00 AM)", roles:["admin","manager"] },`. (Key kept so the server gate `deliverIfWanted(user, "friday_packet", …)` and any stored prefs still line up.)

- [ ] **Step 3: SW + FEATURES.md + guide**

`public/service-worker.js` line 1 → `homestead-v<current+1>` (re-read at execution). FEATURES.md, top of the newest section:

```
- **Friday meeting prep replaces the Friday Packet — this week's section lands at the top of Josh's Weekly Strategy/Scheduling notes doc** · `shipped <date>` · `SW v<N>` · `strategyPrep` · `functions/strategyPrep.js` · Koy: *"Friday strategy meeting needs to be completly redone. The pull right now doesnt really help me … Real block and scheduling concerns need to be addressed in this meeting."* and *"it just needs to be 100 percent accurate."* Fridays 6:00 AM the function writes a new doc (packet folder; Koy pastes it into Josh's notes): carried items, a 3-line headline, next week's schedule (booked from Simpro + planner only — never a job's foreman/lead; every in-progress job with nobody booked, with its wait reason; starts checked for crew, roles and Job Prep; dates that moved since last Friday; inspections/QC/scans/walks; PTO, pending requests, bodies, new hires, capacity; conflicts), blocked jobs grouped by who we wait on with "cleared" marks, coming starts and crews freeing, money (ready to invoice, margin at finish, approved COs), QC to schedule, last week, blank action table. Dashboard card opens the doc; Settings → Notifications gains the toggle. `fridayPacket` deleted. Harness `scripts/strategyprep-test.js` (prebuild) with the real Lot 208 / Namjoshi cases; `scripts/strategyprep-dryrun.js` renders into a preview copy. **Why it won't lose data:** read-only on jobs, needs, users and settings; one additive merge to `settings/strategyPrep`; one range-limited Docs insert; no loader, rules or job write change.
```

`public/sops/dashboard.html`: in the Automated docs paragraph replace the Friday Packet sentence with "Friday meeting prep makes a new doc every Friday at 6:00 AM; the card opens the newest one, and Koy pastes it into Josh's meeting notes."

- [ ] **Step 4: Build gate**

Run: `CI=true npm run build` (no pipe). Expected: prebuild chain green including `strategyprep-test.js`; build succeeds.

- [ ] **Step 5: Commit, then Koy pushes**

```bash
git add src/App.js public/service-worker.js FEATURES.md public/sops/dashboard.html
git commit -m "Dashboard + Settings: Friday meeting prep card and toggle; Friday Packet card retired (SW v<N>)"
```

Koy pushes from the worktree branch (pre-push gate runs the CI build again). After the push: vault log, feature note, update `Thursday Packet.md` to superseded, memory `project_friday_strategy_prep.md` → SHIPPED, crew brief (office-facing: "Josh's Friday doc fills itself at 6 AM; here is what each section means and what to do when a row is wrong").

---

## Self-review

**Spec coverage.** §3.1 booked rule → Task 1 (`buildScheduleIndex` never reads roles; Namjoshi test). §3.2 no job dropped → Task 1 (`classifySchedule` + "every live job lands in exactly one bucket" test) and Task 7 CHECKS. §3.3 conflicts → Task 2. §3.4 ages from stored dates → Tasks 2–4 (`daysBetween` on stored fields; "no date" fallback in renderer). §3.5 "as of 6:00 AM" → Task 4 `preLine`. §3.6 dead fields → Task 1 grep test. §3.7 pure + dry-run + harness → Tasks 1, 7. §3.8 TEST doc first → Tasks 7, 8. §4.1 → Task 5. §4.2 → Task 4. §4.3 → Tasks 1, 2, 5 (people/capacity/conflicts/calendar/moved). §4.4 → Task 3. §4.5 → Task 4 (`comingRows`; `quotes` count is `null` — quotes carry no reliable date; the spec's "Quotes: count + oldest age" is dropped here deliberately and the renderer omits the line). §4.6 → Task 4. §4.7 → Task 4. §4.8 → Task 4. §4.9 → Task 5. §5 reads/writes → Task 6. §6 architecture/retire → Tasks 6, 8, 9. §7 errors → Tasks 4 (per-section `ERR`), 6 (fallback doc). §8 testing/sign-off → Tasks 7, 8. §10 decisions → Task 4 recipients, Task 6 cron/doc.

**Placeholder scan.** No TBD/TODO. `<N>`, `<date>`, `<previewDocId>`, `<APP_CALL_KEY>` are values the executor reads at execution time, each with where to read it.

**Type consistency.** `buildScheduleIndex` returns `byJob/byPerson/unknownSimpro/simproOk/plannerPresent` (Tasks 1, 2, 4, 5 agree). `classifySchedule` rows: `booked[].people/days/firstDay/source/qcNeeds/start`, `idle[].lastUpdate/openPunch/questions/waitBuckets/rti/rtiDays/qcNeeds`, `starts[].di/date/confirmed/crewBooked/missingRoles/prep/elsewhere/atRisk` — renderer (Task 5) uses exactly these. `blockedRows` → `groups/cleared/keys/total/byGroup/firstRun`; `buildModel` spreads it with `error:false`. `peopleRows` → `out/pending/bodies/newUsers/capacity`. `movedDates` → `rows/passed/firstRun`; model stores `moved/passed/movedFirstRun`. `nextDates` written by `buildModel.nextState.dates`; read back as `prevState.dates`. Notif object `{title, body, url}`.

**Review Focus coverage.** 1 unknown Simpro job → Task 1 test + Task 5 render test. 2 PTO vs booked → Task 2 conflicts test. 3 trailing-space simproNo → Task 1 `snOf` test (`"1419 "` in the Lot 208 fixture flows through `buildScheduleIndex` and `collectSimproCandidates`). 4 two sections same date → Task 5 test (our Oct 16 section skipped). 5 Simpro non-array → Task 4 degrade test + Task 6 step 4.

**Known soft spots for the executor.** (a) Task 3's `blocked: Hideout` test is intentionally permissive on group (Material vs GC) because "cabinetry" matches GC and "fixture" matches Material at 1 each — the tie rule is GROUP_ORDER, so expect GC / builder. Ashcraft lands in BOTH Homeowner / designer (10 questions) and Us (flagged) by design: Us and Sold work are additive audiences. (b) Josh's real doc may use HEADING_2 with a link textRun for the second half of the heading; `HEAD_RE` keys on the date prefix only. (c) The capacity test's arithmetic depends on fixture roster size; recount if the fixture changes.
