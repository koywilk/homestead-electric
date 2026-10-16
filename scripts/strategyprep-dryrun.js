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

  // CHECKS — every live job and where it landed. Pipeline starts (jobId up_…) are not live jobs:
  // they are listed separately and never counted against the live-job bucket map.
  const live = S.liveJobs(jobs), s = model.schedule, liveIds = new Set(live.map(j => j.id));
  console.log("\nCHECKS");
  console.log("headline:", model.headline);
  console.log("counts:", JSON.stringify(model.counts));
  if (!s.error) {
    const bucketOf = {}, mark = (rows, label) => rows.forEach(r => { if (liveIds.has(r.jobId)) bucketOf[r.jobId] = label; });
    mark(s.booked, "booked"); mark(s.idle, "nobody booked"); mark(s.starts, "start"); mark(s.onHold, "on hold"); mark(s.between, "not started or between phases, no date (not printed)");
    live.sort((a, b) => a.name.localeCompare(b.name)).forEach(j => console.log(`  ${(bucketOf[j.id] || "MISSING — RULE BUG").padEnd(42)} ${j.name}`));
    const pipe = s.starts.filter(r => !liveIds.has(r.jobId));
    if (pipe.length) { console.log("\n  upcoming (not in app):"); pipe.forEach(r => console.log(`  ${"upcoming (not in app)".padEnd(42)} ${r.name}`)); }
    const missing = live.filter(j => !bucketOf[j.id]); console.log(`\nlive ${live.length} · booked ${s.booked.length + s.bookedMore} · nobody booked ${s.idle.length} · starts ${s.starts.length} (${pipe.length} not in app) · on hold ${s.onHold.length} · between ${s.between.length} · MISSING ${missing.length}`);
    if (missing.length) process.exitCode = 2;
  } else console.log("schedule section failed:", s.error);
  console.log("blocked by group:", JSON.stringify(model.blocked.byGroup || model.blocked.error));
  console.log("simpro people booked next week:", [...(scheduleEntries.reduce((m, e) => { if (e.Type === "job" && e.Staff) m.add(e.Staff.Name); return m; }, new Set()))].join(", "));
})().catch(e => { console.error("dryrun failed:", e); process.exit(1); });
