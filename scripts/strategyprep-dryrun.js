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
// Simpro token/base are read from functions/index.js at runtime (same as simpro-plans-dryrun.js) so the
// credential is never copied into a second file and can't drift from the function's copy.
const fnSrc = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
const SIMPRO_TOKEN = (fnSrc.match(/const SIMPRO_TOKEN = "([^"]+)"/) || [])[1];
const SIMPRO_BASE  = (fnSrc.match(/const SIMPRO_BASE  = "([^"]+)"/) || [])[1];
if (!SIMPRO_TOKEN || !SIMPRO_BASE) { console.error("could not read SIMPRO_TOKEN / SIMPRO_BASE from functions/index.js"); process.exit(1); }
const NOTES_DOC = "1u5Z63PnYVANQJyjam1USUSDbKj6P62sRFJCpxjgkvOM";   // Josh's doc — read only
const PACKET_FOLDER = "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb";
const makePreview = process.argv.includes("--doc");

(async () => {
  const now = new Date(); const w = S.weekOf(now);
  const inputErrors = [];
  const soft = (name, p) => p.catch(e => { inputErrors.push(`${name}: ${String(e.message).slice(0, 80)}`); return null; });
  let snap, usersSnap, needSnap, upSnap, planSnap, ptoSnap, toSnap, stateSnap, findSnap;
  try {
    [snap, usersSnap, needSnap, upSnap, planSnap, ptoSnap, toSnap, stateSnap, findSnap] = await Promise.all([
      db.collection("jobs").get(), db.doc("settings/users").get(),
      soft("needs", db.collection("needs").get()), soft("upcoming_jobs", db.doc("settings/upcoming_jobs").get()),
      soft("schedule", db.doc(`settings/schedule_${w.weekYmds[0]}`).get()), soft("crewPTO", db.doc("settings/crewPTO").get()),
      soft("timeOffRequests", db.doc("settings/timeOffRequests").get()), soft("strategyPrep state", db.doc("settings/strategyPrep").get()),
      soft("agentFindings", db.collection("agentFindings").where("day", ">=", S.ymd(S.addDays(w.today, -7))).get()),
    ]);
  } catch (e) { console.error("FATAL read (jobs/users) failed:", e.message); process.exit(1); }
  const unwrap = (d) => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; };
  const jobs = snap.docs.map(unwrap), needs = needSnap ? needSnap.docs.map(unwrap) : [], users = usersSnap.exists ? (usersSnap.data().list || []) : [];
  const upcoming = upSnap && upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const plannerDoc = planSnap && planSnap.exists ? planSnap.data() : null, pto = ptoSnap && ptoSnap.exists ? (ptoSnap.data().list || []) : [];
  const timeOffRequests = toSnap && toSnap.exists ? (toSnap.data().list || []) : [], prevState = stateSnap && stateSnap.exists ? stateSnap.data() : null;
  const agentFindings = findSnap ? findSnap.docs.map(d => d.data()) : [];
  console.log(`jobs ${jobs.length} · needs ${needs.length} · users ${users.length} · planner ${plannerDoc ? "present" : "MISSING"} · state ${prevState ? "present" : "first run"}`);

  let scheduleEntries = [], simproOk = true, pagesRead = 0, lastPageLen = 0;
  try { for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}&Date=between(${w.weekYmds[0]},${w.weekYmds[4]})&columns=ID,Type,Date,Staff,Project`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { simproOk = false; break; } const b = await r.json(); if (!Array.isArray(b)) { simproOk = false; break; } scheduleEntries.push(...b); pagesRead = page; lastPageLen = b.length; if (b.length < 250) break; } } catch (e) { simproOk = false; }
  if (simproOk && pagesRead === 10 && lastPageLen === 250) { inputErrors.push("simpro schedule: 10 full pages read, later entries not loaded"); console.log("simpro schedule: page cap hit"); }
  if (!simproOk) scheduleEntries = [];
  console.log(`simpro schedule entries next week: ${scheduleEntries.length} (ok=${simproOk})`);
  const simproTotalsById = {};
  let wanted = [];
  try { wanted = S.collectSimproCandidates(jobs);
  for (let i = 0; i < wanted.length; i += 5) await Promise.all(wanted.slice(i, i + 5).map(async sn => { try {
    const r = await fetch(`${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(sn)}&pageSize=1&columns=ID,Total,Totals`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` }, signal: AbortSignal.timeout(20000) }); if (!r.ok) return;
    const sj = (await r.json())[0]; if (!sj) return; const t = sj.Totals || {}, a = t.NettMargin?.Actual ?? null, e = t.NettMargin?.Estimate ?? null, real = a !== null && a !== 100, top = sj.Total || {};
    simproTotalsById[sn] = { total: typeof top.IncTax === "number" ? top.IncTax : (typeof t.IncTax === "number" ? t.IncTax : null), margin: real ? a : e, isEstimate: !real }; } catch (e) {} })); } catch (e) { console.log("simpro totals error:", e.message); }
  console.log(`simpro totals fetched: ${Object.keys(simproTotalsById).length} of ${wanted.length}`);

  let calendarEvents = [];
  try { const raw = process.env.PLAN_INTAKE_GOOGLE_OAUTH; if (!raw) throw new Error("no PLAN_INTAKE_GOOGLE_OAUTH in env");
    const o = JSON.parse(raw); const auth = new google.auth.OAuth2(o.client_id, o.client_secret); auth.setCredentials({ refresh_token: o.refresh_token });
    const r = await google.calendar({ version: "v3", auth }).events.list({ calendarId: "koy@homesteadelectric.net", timeMin: `${w.weekYmds[0]}T00:00:00-06:00`, timeMax: `${w.weekYmds[4]}T23:59:59-07:00`, singleEvents: true, maxResults: 250 }, { timeout: 20000 });   // window one hour WIDER on both ends in every DST state
    calendarEvents = r.data.items || []; } catch (e) { inputErrors.push(`calendar: ${e.message}`); console.log("calendar:", e.message); }

  let notesDoc = null, notesError = null;
  try {
    const roAuth = new google.auth.GoogleAuth({ keyFile: SA_PATH, scopes: ["https://www.googleapis.com/auth/documents.readonly"] });
    notesDoc = (await google.docs({ version: "v1", auth: roAuth }).documents.get({ documentId: NOTES_DOC })).data || null;
  } catch (e) {
    inputErrors.push(`notes doc read: ${String(e.message).slice(0, 80)}`);
    notesError = S.NOTES_READ_HINT + " (and with firebase-adminsdk-fbsvc@homestead-electric.iam.gserviceaccount.com for this preview)";
    if (e.code === 403 || /permission/i.test(e.message)) console.log("notes doc: 403 — for the live function share Josh's doc (Viewer) with homestead-electric@appspot.gserviceaccount.com; for this preview also with firebase-adminsdk-fbsvc@homestead-electric.iam.gserviceaccount.com");
    else console.log("notes doc read:", e.message);
  }

  const inputs = { jobs, users, scheduleEntries, plannerDoc, pto, timeOffRequests, needs, upcoming, agentFindings, calendarEvents, prevState, simproTotalsById, notesDoc, notesError, simproOk, now };
  const model = S.buildModel(inputs);
  const lines = S.renderLines(model);
  if (inputErrors.length) lines.splice(1, 0, { text: "Some data did not load this run: " + inputErrors.join("; "), kind: "grey" });
  const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:13px;max-width:760px;margin:20px auto">${lines.map(l => l.kind === "h2" ? `<h1>${S.esc(l.text)}</h1>` : l.kind === "h3" ? `<h2>${S.esc(l.text)}</h2>` : l.kind === "h4" ? `<h3>${S.esc(l.text)}</h3>` : l.kind === "grey" ? `<p style="color:#777">${S.esc(l.text)}</p>` : l.kind === "check" ? `<div>\u2610 ${S.esc(l.text) || "&nbsp;"}</div>` : l.kind === "bullet" ? `<div>\u2022 ${S.esc(l.text) || "&nbsp;"}</div>` : `<p>${S.esc(l.text)}</p>`).join("\n")}</body></html>`;
  fs.writeFileSync(path.join(__dirname, "../strategyprep-dryrun.html"), html);
  console.log("wrote strategyprep-dryrun.html");
  if (makePreview) {
    const docsAuth = new google.auth.GoogleAuth({ keyFile: SA_PATH, scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.file"] });
    const docs = google.docs({ version: "v1", auth: docsAuth }), drive = google.drive({ version: "v3", auth: docsAuth });
    const created = await drive.files.create({ requestBody: { name: `PREVIEW — ${model.heading}`, parents: [PACKET_FOLDER], mimeType: "application/vnd.google-apps.document" }, fields: "id, webViewLink", supportsAllDrives: true });
    await docs.documents.batchUpdate({ documentId: created.data.id, requestBody: { requests: S.docsRequests(lines, 1) } });
    console.log(`preview doc: ${created.data.webViewLink || `https://docs.google.com/document/d/${created.data.id}/edit`}`);
  }

  // CHECKS — every live job and where it landed. Pipeline starts (jobId up_…) are not live jobs:
  // they are listed separately and never counted against the live-job bucket map.
  const live = S.liveJobs(jobs), liveIds = new Set(live.map(j => j.id));
  console.log("\nCHECKS");
  console.log("headline:", model.headline);
  console.log("counts:", JSON.stringify(model.counts));
  if (model.schedule.error) { console.log("schedule section failed:", model.schedule.error); process.exitCode = 2; }
  else {
    // The rendered model caps the booked list (CAPS.booked); the bucket map must see every job, so rebuild uncapped.
    const capBooked = S.CAPS.booked; S.CAPS.booked = 1e9; const full = S.buildModel(inputs); S.CAPS.booked = capBooked;
    const s = full.schedule;
    if (s.error) { console.log("uncapped schedule section failed:", s.error); process.exitCode = 2; }
    else {
      const bucketOf = {}, mark = (rows, label) => rows.forEach(r => { if (!liveIds.has(r.jobId)) return;
        if (bucketOf[r.jobId]) { console.log(`DUPLICATE ${r.name}: ${bucketOf[r.jobId]} + ${label}`); process.exitCode = 2; } bucketOf[r.jobId] = label; });
      // between must be exactly the two dateless exemptions. A between job with ANY start date on a phase that has not
      // started means a date went nowhere in the doc: a rule bug (exit 2).
      const BUG = "DATED IN THE PAST — RULE BUG", BUG_AHEAD = "DATED, NOT SHOWN — RULE BUG";
      const liveById = new Map(live.map(j => [j.id, j])), todayYmd = S.ymd(w.today);
      const pendingDate = (r) => { const j = liveById.get(r.jobId); if (!j) return null; const ds = ["rough", "finish"].filter(p => S.phasePending(j, p)).map(p => S.startDateOf(j, p)).filter(Boolean).sort((a, b) => a - b); return ds[0] || null; };
      const exempt = (r) => !r.finishStart && !pendingDate(r) && (r.kind === "between" || r.kind === "notStarted");
      mark(s.booked, "booked"); mark(s.idle, "nobody booked"); mark(s.starts.filter(r => !r.overdue), "start"); mark(s.starts.filter(r => r.overdue), "overdue start"); mark(s.onHold, "on hold");
      mark(s.later, "dated after next week (Coming up)");
      mark(s.between.filter(r => exempt(r) && r.kind === "between"), "between phases, no date (exempt)");
      mark(s.between.filter(r => exempt(r) && r.kind === "notStarted"), "not started, no date");
      mark(s.between.filter(r => !exempt(r) && (!pendingDate(r) || S.ymd(pendingDate(r)) < todayYmd)), BUG);
      mark(s.between.filter(r => !exempt(r) && pendingDate(r) && S.ymd(pendingDate(r)) >= todayYmd), BUG_AHEAD);
      live.sort((a, b) => a.name.localeCompare(b.name)).forEach(j => console.log(`  ${(bucketOf[j.id] || "MISSING — RULE BUG").padEnd(42)} ${j.name}`));
      const bugs = live.filter(j => bucketOf[j.id] === BUG || bucketOf[j.id] === BUG_AHEAD); if (bugs.length) process.exitCode = 2;
      const pipe = s.starts.filter(r => !liveIds.has(r.jobId));
      if (pipe.length) { console.log("\n  upcoming (not in app):"); pipe.forEach(r => console.log(`  ${"upcoming (not in app)".padEnd(42)} ${r.name}`)); }
      const missing = live.filter(j => !bucketOf[j.id]); console.log(`\nlive ${live.length} · booked ${s.booked.length} (doc shows ${model.schedule.booked.length} + ${model.schedule.bookedMore} more) · nobody booked ${s.idle.length} · starts ${s.starts.length} (${pipe.length} not in app) · on hold ${s.onHold.length} · later ${s.later.length} · between ${s.between.length} · rule bugs ${bugs.length} · MISSING ${missing.length}`);
      if (missing.length) process.exitCode = 2;
    }
  }
  console.log("blocked by group:", JSON.stringify(model.blocked.byGroup || model.blocked.error));
  console.log("simpro people booked next week:", [...(scheduleEntries.reduce((m, e) => { if (e.Type === "job" && e.Staff) m.add(e.Staff.Name); return m; }, new Set()))].join(", "));
})().catch(e => { console.error("dryrun failed:", e); process.exit(1); });
