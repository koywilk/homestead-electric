# Lead Meeting Prep (Tuesday sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Tuesday 6:00 AM Mountain, create a Google Doc "Lead Meeting Prep — Wed <date>" pre-filled from the app (Rough / Finish / Upcoming / crew out / inspection highlights / what shipped / last week's action items) and push Koy a link.

**Architecture:** Exact Friday Packet pattern. A PURE builder module (`functions/leadMeetingPrep.js`, no I/O) owns all predicates, parsing and HTML; the orchestrator in `functions/index.js` does the reads (Firestore, GitHub raw FEATURES.md, Google Docs API), the Drive upload and the push. A read-only dry-run script renders byte-identical output against prod for Koy's sign-off before deploy.

**Tech Stack:** Node 20 Cloud Functions (firebase-functions v4 `pubsub.schedule`), `googleapis` ^144 (Drive v3 create + Docs v1 get), plain-node assert tests run by the existing `prebuild` chain.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-08-lead-meeting-prep-design.md` (approved by Koy 2026-09-08).
- Recipient: **Koy only** — `sendToName("Koy", …)` (ungated ops send). No pref key, no `NOTIF_CATEGORIES` change.
- **Zero Firestore writes.** Read-only on `jobs`, `settings/upcoming_jobs`, `settings/crewPTO`, `settings/users`.
- Drive folder: reuse `PACKET_DRIVE_FOLDER_ID` (`1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb`, already shared with the service account).
- Notes doc id: `1gn8CcqImvP2Zra_0gC8xAhUTzV8M8UGOrw44ipLwFKg` — Koy must share it **Viewer** with `homestead-electric@appspot.gserviceaccount.com`; unreadable ⇒ degrade, never fail.
- FEATURES.md source: `https://raw.githubusercontent.com/koywilk/homestead-electric/main/FEATURES.md` (repo is public; verified 200).
- Cron `0 6 * * 2`, `TZ = "America/Denver"`, `runWith({ timeoutSeconds: 300, memory: "512MB" })`.
- No handbook section. Sections: Notes · Highlight · Lowlight · Training · Schedule Look Ahead (Rough / Finish / Upcoming / Crew out) · Action items.
- Finish "moving" cutoff **35 days**; start window −7..+14 days; upcoming horizon 60 days; PTO window 14 days; inspections window 7 days; shipped window 7 days.
- Do NOT use `lastActivityAt` as a work signal (presence ping). Use `roughUpdates`/`finishUpdates` `{date,text,addedBy,createdAt}` and `statusUpdate`/`statusUpdateAt`/`statusUpdateBy`.
- Functions-only ship: **no SW bump, no FEATURES.md gate impact** (Friday Packet precedent). Firestore rules untouched.
- Commit only when asked (Koy's one-paste convention via `homestead-deploy-hygiene`); pre-push hook runs the full CI build.

---

### Task 1: Pure builder module + tests

**Files:**
- Create: `functions/leadMeetingPrep.js`
- Create: `scripts/leadprep-test.js`
- Reference (copy from, then delete at Task 5): `docs/superpowers/mockups/2026-09-08-lead-meeting-prep-builder.draft.js`

**Interfaces:**
- Produces:
  - `buildModel({ jobs, upcoming, pto, featuresMd, notesDoc, now }) → model`
    - `jobs`: unwrapped job objects (`{id, ...raw.data}`), `upcoming`: array from `settings/upcoming_jobs.items`, `pto`: array from `settings/crewPTO.list`, `featuresMd`: string|null, `notesDoc`: Google Docs API JSON|null, `now`: Date.
    - `model = { meetingLabel, docDate, generated, rough:{rows}, finish:{moving, quiet}, upcoming:[...], pto:[...], highlights:[...], lowlights:[...], shipped:{rows, error}, actions:{rows, fromDate, error}, counts:{rough, finishMoving, finishQuiet, upcoming, pto, shipped, actions} }`
  - `renderHtml(model) → string` (self-contained inline-styled HTML; Drive converts to a Google Doc).
  - `extractShipped(featuresMd, today, days=7) → [{title, version, date}]`
  - `parseActionItems(docJson, today) → { fromDate: Date|null, rows: string[] }`
  - `TZ`

- [ ] **Step 1: Write the failing tests**

```js
// scripts/leadprep-test.js — pure-module tests, run: node scripts/leadprep-test.js
"use strict";
const L = require("../functions/leadMeetingPrep.js");
let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}
const NOW = new Date("2026-09-08T12:00:00Z"); // Tue Sep 8 2026, 6:00 AM MT

const JOBS = [
  { id: "a", name: "Pierce Residence", foreman: "Colby Fogh", lead: "Lead TBD", roughStatus: "inprogress", roughStage: "0%", roughProjectedStart: "9/7/2026",
    statusUpdate: "Underground should start 6/4", statusUpdateBy: "Colby Fogh", statusUpdateAt: "2026-05-22T10:00:00Z" },
  { id: "b", name: "Webb", foreman: "Gage Lund", lead: "Gage Lund", roughStatus: "complete", finishStatus: "inprogress", finishStage: "40%", finishProjectedStart: "8/12/2026",
    finishUpdates: [{ date: "3-17-26", text: "old" }, { date: "8/12/2026", text: "Whole house is boxed", addedBy: "Gage Lund" }],
    statusUpdate: "Design walk week of 8/14", statusUpdateBy: "Koy Wilkinson", statusUpdateAt: "2026-09-02T10:00:00Z" },
  { id: "c", name: "Cowdrey", foreman: "Keegan Wilkinson", roughStatus: "complete", finishStatus: "inprogress", finishStage: "95%", finishProjectedStart: "4/3/2026",
    finishUpdates: [{ date: "4/17/2026", text: "trim out", addedBy: "Keegan" }] },
  { id: "d", name: "Ashcraft", foreman: "Vasa Mataafa", roughStatus: "complete", finishStatus: "waiting_date", finishProjectedStart: "9/14/2026", statusUpdate: "mid-late Sept", statusUpdateAt: "2026-07-27T10:00:00Z" },
  { id: "e", name: "Becker", foreman: "Keegan Wilkinson", roughStatus: "" },
  { id: "f", name: "Garage Panel Breakers", foreman: "Unassigned", roughStatus: "" },
  { id: "g", name: "#2453 - Koplin Residence - Mapleton", type: "quote" },
  { id: "h", name: "Skyridge Lot 208 - Mayflower", foreman: "Keegan Wilkinson", roughStatus: "waiting", roughStage: "75%", statusUpdate: "need holes cored", statusUpdateAt: "2026-08-25T10:00:00Z" },
  { id: "i", name: "Done House", roughStatus: "complete", finishStatus: "complete" },
  { id: "j", name: "Temp ped", tempPed: true, roughStatus: "inprogress" },
  { id: "k", name: "Example Job", roughStatus: "inprogress" },
  { id: "l", name: "Passed House", roughStatus: "inprogress", roughInspectionDate: "9/4/2026", roughInspectionResult: "pass" },
  { id: "m", name: "Failed House", roughStatus: "complete", finishStatus: "inprogress", finalInspectionDate: "2026-09-05", finalInspectionResult: "fail",
    finishUpdates: [{ date: "9/5/2026", text: "failed final", addedBy: "Vasa" }] },
];
const UPCOMING = [
  { name: "#2385 - Skyridge Lot 208 - Mayflower", customer: "Trek", sales: "Brady", notes: "Follow up", lastFollowUp: "6/16/2026" },
  { name: "#2443 - Whitaker Farms 27", customer: "Branca Homes", sales: "Justin", notes: "Framing nearing completion", lastFollowUp: "7/16/2026", projectedStart: "" },
  { name: "#2478 - Miller Residence", customer: "Robison", sales: "Brady", projectedStart: "9/14/2026" },
];
const PTO = [
  { name: "Gage Lund", start: "9/15/2026", end: "9/21/2026", note: "Vacation" },
  { name: "Old Guy", start: "7/13/2026", end: "7/16/2026" },
  { name: "Far Guy", start: "10/13/2026", end: "10/16/2026" },
];
const FEATURES = [
  "- **Job Prep tab — redline walk strip** · `shipped 2026-08-29` · `SW v390` · long text",
  "  - **QC status flips per phase** · `shipped 2026-08-31` · `SW v391` · Koy: quoted text",
  "- **Old thing** · `shipped 2026-07-01` · `SW v340` · old",
  "- **Untagged** · `shipped` · no date",
].join("\n");
// Minimal Google Docs API shape: body.content[].paragraph.{elements[].textRun.content, bullet?}
const P = (text, bullet) => ({ paragraph: { elements: [{ textRun: { content: text + "\n" } }], ...(bullet ? { bullet: { listId: "x" } } : {}) } });
const NOTES_DOC = { body: { content: [
  P("Sep 9, 2026 | Weekly Lead Meeting"), P("Attendees: a b"), P("Notes"), P("", true), P("Action items"), P("", true),
  P("Sep 2, 2026 | Weekly Lead Meeting"), P("Notes"), P("Things are turning around", true), P("Action items"), P("Colby to order Pierce panel", true), P("Koy: call Webb designer", true), P(""),
  P("Aug 26, 2026 | Weekly Lead Meeting"), P("Action items"), P("stale item", true),
] } };

console.log("dates:");
t("US slash", L.toDateAny("8/12/2026").getDate() === 12);
t("US hyphen 2-digit year", L.toDateAny("3-17-26").getFullYear() === 2026);
t("ISO", L.toDateAny("2026-09-05").getMonth() === 8);
t("timestamp-ish", L.toDateAny({ _seconds: 1788390380 }) instanceof Date);
t("garbage null", L.toDateAny("soon") === null);

console.log("extractShipped:");
const sh = L.extractShipped(FEATURES, new Date(2026, 8, 8));
t("two within 7 days", sh.length === 2, JSON.stringify(sh));
t("title + version parsed", sh[0].title === "Job Prep tab — redline walk strip" && sh[0].version === "v390");
t("old + untagged skipped", !sh.some(s => s.title === "Old thing" || s.title === "Untagged"));
t("null md → []", L.extractShipped(null, new Date()).length === 0);

console.log("parseActionItems:");
const ai = L.parseActionItems(NOTES_DOC, new Date(2026, 8, 8));
t("picks newest dated section on/before today (Sep 2, not Sep 9)", ai.fromDate && ai.fromDate.getDate() === 2, JSON.stringify(ai));
t("two items carried", ai.rows.length === 2 && ai.rows[0] === "Colby to order Pierce panel");
t("stops at next section", !ai.rows.includes("stale item"));
t("empty doc → no rows", L.parseActionItems(null, new Date()).rows.length === 0);

console.log("buildModel:");
const m = L.buildModel({ jobs: JOBS, upcoming: UPCOMING, pto: PTO, featuresMd: FEATURES, notesDoc: NOTES_DOC, now: NOW });
t("meeting is Wed Sep 9", /Wednesday, September 9, 2026/.test(m.meetingLabel), m.meetingLabel);
const rn = m.rough.rows.map(r => r.name);
t("rough = in progress + waiting, no temp ped / Example Job", rn.includes("Pierce Residence") && rn.includes("Skyridge Lot 208 - Mayflower") && !rn.includes("Temp ped") && !rn.includes("Example Job"), rn.join(","));
t("rough flags missing lead", m.rough.rows.find(r => r.name === "Pierce Residence").flags.includes("no lead"));
t("finish moving has Webb (status line 6d old)", m.finish.moving.some(r => r.name === "Webb"));
t("Webb line uses freshest text (status update beats older daily update)", m.finish.moving.find(r => r.name === "Webb").update === "Design walk week of 8/14");
t("finish quiet has Cowdrey (144d)", m.finish.quiet.some(r => r.name === "Cowdrey"));
t("Done House excluded everywhere", !m.finish.moving.concat(m.finish.quiet).some(r => r.name === "Done House"));
const un = m.upcoming.map(u => u.name);
t("upcoming: pipeline + quote + owned rough-not-started + finish start ≤60d", un.includes("#2443 - Whitaker Farms 27") && un.includes("#2453 - Koplin Residence - Mapleton") && un.includes("Becker") && un.includes("Ashcraft (finish)"), un.join(" | "));
t("upcoming: unowned undated stub dropped", !un.includes("Garage Panel Breakers"));
t("upcoming: pipeline row for a job already on the board dropped", !un.includes("#2385 - Skyridge Lot 208 - Mayflower"));
t("upcoming sorted dated-first", m.upcoming[0].name === "#2478 - Miller Residence" || m.upcoming[0].name === "Ashcraft (finish)", m.upcoming[0].name);
t("pto: only next 14 days", m.pto.length === 1 && m.pto[0].name === "Gage Lund", JSON.stringify(m.pto));
t("highlight from pass ≤7d", m.highlights.length === 1 && /Passed House/.test(m.highlights[0]));
t("lowlight from fail ≤7d", m.lowlights.length === 1 && /Failed House/.test(m.lowlights[0]));
t("shipped rows", m.shipped.rows.length === 2 && !m.shipped.error);
t("actions carried", m.actions.rows.length === 2 && !m.actions.error);
t("counts", m.counts.rough === rn.length && m.counts.upcoming === un.length);

console.log("degradation:");
const bad = L.buildModel({ jobs: null, upcoming: null, pto: null, featuresMd: null, notesDoc: null, now: NOW });
t("null inputs never throw", bad && Array.isArray(bad.rough.rows) && bad.shipped.error === true && bad.actions.error === true);
const html = L.renderHtml(m);
t("html has every section", ["Notes", "Highlight", "Lowlight", "Training", "Schedule look ahead", "Rough", "Finish", "Upcoming", "Crew out", "Action items"].every(s => html.includes(s)));
t("html escapes", L.renderHtml(L.buildModel({ jobs: [{ id: "x", name: "<b>X</b>", roughStatus: "inprogress" }], now: NOW })).includes("&lt;b&gt;X&lt;/b&gt;"));
t("no handbook section", !/handbook/i.test(html));

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nall leadprep tests passed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/leadprep-test.js`
Expected: `Cannot find module '../functions/leadMeetingPrep.js'`

- [ ] **Step 3: Write the module**

Start from the draft builder (`docs/superpowers/mockups/2026-09-08-lead-meeting-prep-builder.draft.js`) and make these changes so the tests pass:

```js
// functions/leadMeetingPrep.js — header comment mirroring fridayPacket.js:
// PURE module (no Firestore, no network, no requires).
//   buildModel(inputs)            → model (all predicates, no I/O)
//   renderHtml(model)             → HTML string (Drive converts to a Google Doc)
//   extractShipped(md, today)     → FEATURES.md entries shipped in the last 7 days
//   parseActionItems(doc, today)  → last meeting's "Action items" bullets
// Content contract (Koy, 2026-09-08): a Tuesday prep sheet he pulls from for the
// Wednesday 6:30 lead meeting. Koy only. Every section degrades independently.
```

Signature changes vs the draft:
- `buildModel({ jobs, upcoming, pto, featuresMd, notesDoc, now })` — drop `shipped`, `prevActionItems`, `handbook`; compute `model.shipped = { rows: extractShipped(featuresMd, today), error: featuresMd == null }` and `model.actions = { ...parseActionItems(notesDoc, today), error: notesDoc == null }` inside try/catch each.
- Meeting date: `const dow = today.getDay(); const meeting = addDays(today, (3 - dow + 7) % 7);` (a Wednesday run means today). `model.docDate = meeting.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })` → "Wed Sep 9".
- `model.rough = { rows }` (no split), `model.finish = { moving, quiet }`, `model.counts = { rough, finishMoving, finishQuiet, upcoming, pto, shipped, actions }`.
- Wrap every input with `Array.isArray(x) ? x : []` so nulls never throw.
- Guard `real.filter` etc. inside one try/catch per section as fridayPacket does; a thrown section yields empty rows and `error: true`.

New pure functions:

```js
// FEATURES.md lines look like:
//   - **Title** · `shipped 2026-09-02` · `SW v392` · long description
// Only lines with a dated `shipped YYYY-MM-DD` tag inside the window count.
function extractShipped(md, today, days = 7) {
  if (!md || typeof md !== "string") return [];
  const out = [];
  md.split("\n").forEach(line => {
    const m = line.match(/\*\*(.+?)\*\*\s*·\s*`shipped (\d{4}-\d{2}-\d{2})`(?:\s*·\s*`SW (v\d+)`)?/);
    if (!m) return;
    const d = toDateAny(m[2]);
    if (!d) return;
    const age = daysBetween(today, d);
    if (age < 0 || age > days) return;
    out.push({ title: m[1].trim(), version: m[3] || "", date: d });
  });
  return out.sort((a, b) => a.date - b.date);
}

// Google Docs API JSON → the "Action items" bullets of the newest dated section
// on/before today. Calendar's notes template: an H2 "Sep 2, 2026 | Weekly Lead
// Meeting", then "Notes", bullets, "Action items", bullets.
function parseActionItems(doc, today) {
  const empty = { fromDate: null, rows: [] };
  const content = doc && doc.body && Array.isArray(doc.body.content) ? doc.body.content : null;
  if (!content) return empty;
  const paras = content.filter(c => c && c.paragraph).map(c => ({
    text: (c.paragraph.elements || []).map(e => (e.textRun && e.textRun.content) || "").join("").replace(/\s+/g, " ").trim(),
    bullet: !!c.paragraph.bullet,
  }));
  const sections = []; // {date, actions:[]}
  let cur = null, inActions = false;
  paras.forEach(p => {
    const hm = p.text.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4})\s*\|/);
    if (hm) { cur = { date: toDateAny(hm[1]), actions: [] }; sections.push(cur); inActions = false; return; }
    if (!cur) return;
    if (!p.bullet && /^action items?$/i.test(p.text)) { inActions = true; return; }
    if (!p.bullet && p.text) { inActions = false; return; } // next heading ends the list
    if (inActions && p.bullet && p.text) cur.actions.push(p.text);
  });
  const pick = sections.filter(s => s.date && daysBetween(today, s.date) >= 0).sort((a, b) => b.date - a.date)[0];
  return pick ? { fromDate: pick.date, rows: pick.actions } : empty;
}
```

Render changes vs the draft: Training section = `h3("New in the app since last meeting")` listing `shipped.rows` as `"<title> (<version>, <Mon D>)"` or the grey line "FEATURES.md unavailable this week" when `shipped.error`; Action items section = `h3("Carried from <Mon D>")` listing `actions.rows`, or grey "Couldn't read the notes doc — share it (Viewer) with homestead-electric@appspot.gserviceaccount.com" when `actions.error`, or "none recorded last week" when readable but empty. Delete the handbook block entirely. Export `{ buildModel, renderHtml, extractShipped, parseActionItems, toDateAny, TZ }`.

- [ ] **Step 4: Run tests until green**

Run: `node scripts/leadprep-test.js`
Expected: every line `ok`, final line `all leadprep tests passed`.

- [ ] **Step 5: Wire the test into the prebuild chain**

Modify `package.json` line 19 — append `&& node scripts/leadprep-test.js` to the `prebuild` script (same pattern as `gcnotify-test.js`).

Run: `npm run prebuild`
Expected: existing tests + `all leadprep tests passed`.

---

### Task 2: Orchestrator — schedule, test callable, Drive doc, push

**Files:**
- Modify: `functions/index.js` — insert immediately after `exports.sendTestFridayPacket` (after line ~4020, before the `DRIVE — shared helpers` banner).

**Interfaces:**
- Consumes: `fridayPacket`-block constants already in scope: `PACKET_DRIVE_FOLDER_ID`, `google` (googleapis), `db`, `getUsers`, `sendToName`, `requireAppKey`, `functions`, `TZ`, global `fetch` (Node 20).
- Produces: `runLeadMeetingPrep({ testRun })`, `exports.leadMeetingPrep`, `exports.sendTestLeadMeetingPrep`.

- [ ] **Step 1: Add the orchestrator**

```js
// ─────────────────────────────────────────────────────────────
// SCHEDULED — Tuesday 6:00am Mountain Time
// Lead Meeting Prep — a pre-filled sheet (Rough / Finish / Upcoming / crew out /
// inspection highlights / what shipped / last week's action items) for the
// Wednesday 6:30 lead meeting. Koy only ("just for me to pull from", 2026-09-08).
// Content comes from the PURE builder ./leadMeetingPrep.js so
// scripts/leadprep-dryrun.js renders byte-identical output for sign-off.
// Data safety: read-only on Firestore (jobs, upcoming_jobs, crewPTO, users);
// zero Firestore writes; one Drive doc per run in the packet folder.
// ─────────────────────────────────────────────────────────────
const leadPrepLib = require("./leadMeetingPrep.js");
const LEAD_NOTES_DOC_ID = "1gn8CcqImvP2Zra_0gC8xAhUTzV8M8UGOrw44ipLwFKg"; // Notes - Weekly Lead Meeting (Calendar-attached)
const FEATURES_MD_RAW_URL = "https://raw.githubusercontent.com/koywilk/homestead-electric/main/FEATURES.md";

async function runLeadMeetingPrep({ testRun = false } = {}) {
  const now = new Date();

  // 1 · Firestore reads (jobs are wrapped {data:{...}}; settings docs are not).
  const [snap, upSnap, ptoSnap] = await Promise.all([
    db.collection("jobs").get(),
    db.doc("settings/upcoming_jobs").get(),
    db.doc("settings/crewPTO").get(),
  ]);
  const jobs = snap.docs.map(d => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; });
  const upcoming = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];

  // 2 · FEATURES.md (public repo, raw) — Training section. Failure ⇒ null ⇒ section degrades.
  let featuresMd = null;
  try {
    const resp = await fetch(FEATURES_MD_RAW_URL, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) featuresMd = await resp.text();
    else functions.logger.warn("leadMeetingPrep FEATURES.md fetch failed", { status: resp.status });
  } catch (e) { functions.logger.warn("leadMeetingPrep FEATURES.md fetch error", { error: e.message }); }

  // 3 · Last week's action items from the Calendar notes doc (Docs API, read-only).
  //     Needs the doc shared Viewer with the service account; otherwise null ⇒ degrade.
  let notesDoc = null;
  try {
    const docsAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/documents.readonly"] });
    const docs = google.docs({ version: "v1", auth: docsAuth });
    const res = await docs.documents.get({ documentId: LEAD_NOTES_DOC_ID });
    notesDoc = res.data || null;
  } catch (e) { functions.logger.warn("leadMeetingPrep notes doc read failed", { error: e.message }); }

  // 4 · Build + render (pure).
  const model = leadPrepLib.buildModel({ jobs, upcoming, pto, featuresMd, notesDoc, now });
  const html = leadPrepLib.renderHtml(model);
  const docTitle = `Lead Meeting Prep — ${model.docDate}`;

  // 5 · Upload to Drive as a Google Doc (same folder + mechanism as the Friday Packet).
  let docLink = "", docId = "";
  try {
    const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const drive = google.drive({ version: "v3", auth });
    const createRes = await drive.files.create({
      requestBody: { name: docTitle, parents: [PACKET_DRIVE_FOLDER_ID], mimeType: "application/vnd.google-apps.document" },
      media: { mimeType: "text/html", body: html },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    docId = createRes.data.id || "";
    docLink = createRes.data.webViewLink || "";
  } catch (e) {
    functions.logger.error("leadMeetingPrep Drive upload failed", { error: e.message });
    await sendToName("Koy", { title: "⚠️ Lead Meeting Prep failed", body: `Drive upload error: ${e.message.slice(0, 120)}` });
    return { ok: false, error: e.message };
  }

  // 6 · Announce — Koy only, ungated (personal ops send).
  await sendToName("Koy", {
    title: testRun ? "📝 Lead Meeting Prep (test) ready" : "📝 Lead Meeting Prep ready",
    body: `${docTitle} is in Drive — open it there`,
    jobId: "",
    section: "",
  });

  functions.logger.info("leadMeetingPrep saved to Drive", { docId, docLink, testRun, ...model.counts });
  return { ok: true, docLink, docId, counts: model.counts };
}

exports.leadMeetingPrep = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("0 6 * * 2")
  .timeZone(TZ)
  .onRun(async () => { await runLeadMeetingPrep(); return null; });

// Manual trigger — a full real run any day (Drive doc + push to Koy) so the
// pipeline can be verified without waiting for a Tuesday.
exports.sendTestLeadMeetingPrep = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data) => {
    requireAppKey(data);
    return await runLeadMeetingPrep({ testRun: true });
  });
```

- [ ] **Step 2: Syntax + export check**

Run: `node --check functions/index.js && grep -c "^exports\." functions/index.js`
Expected: no output from `--check`; export count = previous count + 2 (record the number for the vault's Architecture note).

- [ ] **Step 3: Confirm Docs API exists in the installed googleapis**

Run: `node -e "const {google}=require('./functions/node_modules/googleapis'); console.log(typeof google.docs)"`
Expected: `function`. (If `undefined`, bump `googleapis` in `functions/package.json` — v144 has it.)

---

### Task 3: Read-only dry-run script (Koy's sign-off gate)

**Files:**
- Create: `scripts/leadprep-dryrun.js`
- Modify: `.gitignore` — add `leadprep-dryrun.html`

**Interfaces:**
- Consumes: `leadPrepLib.buildModel/renderHtml`; the local admin SDK credential path used by `scripts/packet-dryrun.js`.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/* READ-ONLY dry-run of the Lead Meeting Prep sheet against real prod data.
 * Mirrors runLeadMeetingPrep (functions/index.js) steps 1-4 exactly — same
 * reads, same FEATURES.md fetch, same pure builder — then writes the rendered
 * sheet to leadprep-dryrun.html at the repo root and prints section counts.
 * Does NOT create a Drive doc, does NOT push, writes nothing to Firestore.
 * The notes-doc read uses the same service-account JSON, so an "unreadable"
 * result here means Koy still has to share the doc (Viewer) with
 * homestead-electric@appspot.gserviceaccount.com. */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/firebase-admin"));
const { google } = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/googleapis"));
const SA_PATH = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)), projectId: "homestead-electric" });
const db = admin.firestore();
const lib = require(path.join(__dirname, "../functions/leadMeetingPrep.js"));
const LEAD_NOTES_DOC_ID = "1gn8CcqImvP2Zra_0gC8xAhUTzV8M8UGOrw44ipLwFKg";
const FEATURES_MD_RAW_URL = "https://raw.githubusercontent.com/koywilk/homestead-electric/main/FEATURES.md";

(async () => {
  const now = new Date();
  const [snap, upSnap, ptoSnap] = await Promise.all([
    db.collection("jobs").get(), db.doc("settings/upcoming_jobs").get(), db.doc("settings/crewPTO").get(),
  ]);
  const jobs = snap.docs.map(d => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; });
  const upcoming = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];

  let featuresMd = null;
  try { const r = await fetch(FEATURES_MD_RAW_URL); if (r.ok) featuresMd = await r.text(); else console.log("FEATURES.md fetch:", r.status); }
  catch (e) { console.log("FEATURES.md fetch error:", e.message); }

  let notesDoc = null;
  try {
    const auth = new google.auth.GoogleAuth({ keyFile: SA_PATH, scopes: ["https://www.googleapis.com/auth/documents.readonly"] });
    const docs = google.docs({ version: "v1", auth });
    notesDoc = (await docs.documents.get({ documentId: LEAD_NOTES_DOC_ID })).data;
  } catch (e) { console.log("Notes doc read failed (share it Viewer with the service account):", e.message.slice(0, 160)); }

  const model = lib.buildModel({ jobs, upcoming, pto, featuresMd, notesDoc, now });
  const html = lib.renderHtml(model);
  const outPath = path.join(__dirname, "..", "leadprep-dryrun.html");
  fs.writeFileSync(outPath, `<!doctype html><meta charset="utf-8"><title>Lead Meeting Prep — ${model.docDate}</title><body style="margin:0;background:#fff">${html}</body>`);

  console.log(`===== LEAD MEETING PREP — ${model.meetingLabel} =====`);
  console.log(`  Rough:     ${model.counts.rough}`);
  console.log(`  Finish:    ${model.counts.finishMoving} moving · ${model.counts.finishQuiet} quiet`);
  console.log(`  Upcoming:  ${model.counts.upcoming}`);
  console.log(`  Crew out:  ${model.counts.pto}`);
  console.log(`  Shipped:   ${model.shipped.error ? "UNAVAILABLE" : model.counts.shipped}`);
  console.log(`  Actions:   ${model.actions.error ? "UNAVAILABLE (doc not shared?)" : model.counts.actions + (model.actions.fromDate ? " from " + model.actions.fromDate.toDateString() : "")}`);
  console.log(`\nWrote ${outPath}`);
  console.log("READ-ONLY — nothing written to Firestore, Drive, or push.");
  process.exit(0);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `node scripts/leadprep-dryrun.js && open leadprep-dryrun.html`
Expected: counts printed; the HTML opens; Actions likely `UNAVAILABLE` until Koy shares the doc. Compare the Rough/Finish lists against the 2026-09-08 mockup (`docs/superpowers/mockups/…mockup.html`) — same jobs, same order.

- [ ] **Step 3: Sign-off gate**

Send `leadprep-dryrun.html` to Koy (SendUserFile). **Do not deploy until Koy says the render is right.**

---

### Task 4: Deploy + first real run

**Files:** none (ops).

- [ ] **Step 1: Koy shares the notes doc**

Koy: open `Notes - Weekly Lead Meeting` → Share → add `homestead-electric@appspot.gserviceaccount.com` as **Viewer**. (Without this the Action-items section prints the share hint; everything else works.)

- [ ] **Step 2: Deploy the two functions**

Run: `cd ~/Desktop/homestead-electric && firebase deploy --only functions:leadMeetingPrep,functions:sendTestLeadMeetingPrep`
Expected: both functions deploy; `firebase functions:list | grep -i leadmeeting` shows the schedule `0 6 * * 2` (America/Denver).

- [ ] **Step 3: Test run today**

Run (callable, app key from `APP_CALL_KEY` in `functions/index.js`):
```bash
curl -s -X POST https://us-central1-homestead-electric.cloudfunctions.net/sendTestLeadMeetingPrep \
  -H "Content-Type: application/json" \
  -d '{"data":{"_appKey":"<APP_CALL_KEY>"}}'
```
Expected: `{"result":{"ok":true,"docLink":"https://docs.google.com/…","counts":{…}}}`; Koy gets the "(test) ready" push; the doc sits in the packet Drive folder. Open it and confirm the Google-Doc conversion kept headings + bullets.

- [ ] **Step 4: Rerun the dry-run to confirm Action items now read**

Run: `node scripts/leadprep-dryrun.js`
Expected: `Actions: N from <last Wednesday>` (no longer UNAVAILABLE).

---

### Task 5: Docs, vault, cleanup, one-paste

**Files:**
- Delete: `docs/superpowers/mockups/2026-09-08-lead-meeting-prep-builder.draft.js` (superseded by the real module; keep the mockup HTML)
- Modify: `docs/superpowers/specs/2026-09-08-lead-meeting-prep-design.md` — status line → shipped date + export count
- Create (vault): `~/Desktop/Command Center/02-Features/Lead Meeting Prep.md` (frontmatter like `Thursday Packet.md`: `type: feature`, `status: shipped`, `area: [reporting, scheduling, notifications]`, `date: 2026-09-08`)
- Modify (vault): `~/Desktop/Command Center/01-Architecture/Architecture - Cloud Functions.md` — add `leadMeetingPrep` + `sendTestLeadMeetingPrep` to the scheduled/callable lists and bump the export count
- Create (vault): `~/Desktop/Command Center/Logs/2026-09-08 - Homestead Electric.md` (`type: log`, wikilinks to `[[Lead Meeting Prep]]`, `[[Friday Packet]]`)
- No SOP guide change: nothing in the app UI changed (`public/sops/` untouched).
- No FEATURES.md entry required (functions-only, same as the Friday Packet); no SW bump.

- [ ] **Step 1: Write the vault feature note**

Cover: Koy's ask + decisions (standalone · Koy only · no handbook · carry action items · 35d), the section table from the spec, the "don't trust lastActivityAt" rule, the Docs-API share prerequisite, the dry-run gate, and the deploy runbook.

- [ ] **Step 2: Run the deploy-hygiene checklist and produce the one-paste**

Invoke `anthropic-skills:homestead-deploy-hygiene`. Data-safety line for the commit: *read-only on jobs/settings; zero Firestore writes; no rules change; no SW bump; creates one Drive doc per run in the existing packet folder.*

Files in the commit: `functions/leadMeetingPrep.js`, `functions/index.js`, `scripts/leadprep-test.js`, `scripts/leadprep-dryrun.js`, `package.json`, `.gitignore`, `docs/superpowers/specs/2026-09-08-lead-meeting-prep-design.md`, `docs/superpowers/plans/2026-09-08-lead-meeting-prep.md`, `docs/superpowers/mockups/2026-09-08-lead-meeting-prep-mockup.html`.

Commit message: `Lead Meeting Prep: Tuesday 6am pre-filled sheet for the Wednesday lead meeting (functions-only)`.

- [ ] **Step 3: Update memory**

Update `project_lead_meeting_prep.md` (memory dir) to shipped status with the deploy date and the doc-share prerequisite.
