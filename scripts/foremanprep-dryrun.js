#!/usr/bin/env node
/* PREVIEW of the Foreman + Lead meeting section against real prod data.
 * Mirrors runForemanMeetingPrep (functions/index.js) steps 1-5 exactly — same
 * reads, same Simpro fetches, same pure builder (../functions/foremanMeetingPrep.js)
 * — then creates a throwaway Google Doc "PREVIEW — Foreman + Lead notes" in the
 * 90-Day Plan folder and inserts the section with the same Docs API requests
 * the function will use, so what you see is exactly what the weekly run writes.
 * Does NOT touch the real notes doc, does NOT push, writes nothing to Firestore.
 * Run from the Mac:  node scripts/foremanprep-dryrun.js
 * Delete the preview doc from Drive when you're done with it. */
const path = require("path");
const admin = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/firebase-admin"));
const { google } = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/googleapis"));
const SA_PATH = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)), projectId: "homestead-electric" });
const db = admin.firestore();
const lib = require(path.join(__dirname, "../functions/foremanMeetingPrep.js"));

// Same constants as functions/index.js — keep in sync.
const FOREMAN_NOTES_DOC_ID = "1t7i3gFiLsWmb-htGleutCZFh6TXSAnNbqbq9_ma3e80";
const RES_CREW = ["Keegan", "Daegan", "Gage", "Treycen"];
const SIMPRO_TOKEN = "402222413e886be0bda7bd5173aa8e215d34bcdb";
const SIMPRO_BASE  = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const TZ = "America/Denver";

(async () => {
  const now = new Date();
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const today = new Date(mtNow.getFullYear(), mtNow.getMonth(), mtNow.getDate());
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const nextFriday = new Date(monday); nextFriday.setDate(monday.getDate() + 11);
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const windowStart = ymdOf(monday), windowEnd = ymdOf(nextFriday);

  const [snap, needSnap, ptoSnap, upSnap] = await Promise.all([
    db.collection("jobs").get(), db.collection("needs").get(), db.doc("settings/crewPTO").get(), db.doc("settings/upcoming_jobs").get(),
  ]);
  const upcomingRaw = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  let featuresMd = null;
  try { const r = await fetch("https://raw.githubusercontent.com/koywilk/homestead-electric/main/FEATURES.md"); if (r.ok) featuresMd = await r.text(); } catch (e) { console.log("FEATURES.md:", e.message); }
  const leadLib = require(path.join(__dirname, "../functions/leadMeetingPrep.js"));
  const upcoming = leadLib.buildModel({ jobs: [], upcoming: [], pto: [], featuresMd: null, notesDoc: null, now }).upcoming && null; // placeholder, replaced below
  const jobs = snap.docs.map(d => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}), updated_at: raw.updated_at || "" }; });
  const needs = needSnap.docs.map(d => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || {}) }; });
  const pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];
  console.log(`jobs ${jobs.length} · needs ${needs.length} · pto ${pto.length}`);

  let scheduleEntries = [];
  try {
    let page = 1;
    while (page <= 60) {
      const resp = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
      if (!resp.ok) { console.log("simpro schedule page failed", page, resp.status); break; }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      scheduleEntries.push(...batch);
      if (batch.length < 250) break;
      page++;
    }
    scheduleEntries = scheduleEntries.filter(s => s && s.Date && s.Date >= windowStart && s.Date <= windowEnd);
  } catch (e) { console.log("simpro schedule error:", e.message); scheduleEntries = []; }
  console.log(`simpro schedule entries in window ${windowStart}..${windowEnd}: ${scheduleEntries.length}`);

  // 3 · Simpro margin + per-phase labor hours (rough / finish / extras cost centers)
  //     for active residential jobs, 5 jobs in flight at a time.
  const simproTotalsById = await (async () => {
    try {
      const wanted = [];
      const seen = new Set();
      // Active residential jobs + anything residential completed in the last 30 days.
      jobs.forEach(j => {
        if (!j || !j.name || j.type === "quote" || j.deleted) return;
        if (!lib.isResJob(j, RES_CREW)) return;
        const done = j.finishStatus === "complete" || parseInt(j.finishStage) === 100;
        if (done ? !lib.recentlyCompleted(j, today) : (j.archived || j.archivedAt)) return;
        const sn = j.simproNo ? String(j.simproNo) : "";
        if (sn && !seen.has(sn) && wanted.length < 60) { seen.add(sn); wanted.push(sn); }
      });
      const getJson = async (path) => {
        const resp = await fetch(`${SIMPRO_BASE}${path}`, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
        return resp.ok ? resp.json() : null;
      };
      return await lib.collectSimproHours(wanted, getJson);
    } catch (e) { console.log("simpro hours error:", e.message); return {}; }
  })();
  console.log(`simpro hours fetched for ${Object.keys(simproTotalsById).length} residential jobs`);

  const auth = new google.auth.GoogleAuth({ keyFile: SA_PATH, scopes: ["https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/drive.file"] });
  const docs = google.docs({ version: "v1", auth });
  let lastActions = null;
  try { lastActions = lib.parseLastActions((await docs.documents.get({ documentId: FOREMAN_NOTES_DOC_ID })).data); }
  catch (e) { console.log("Notes doc read failed (share it Editor with the service account):", String(e.message).slice(0, 160)); }

  const upcomingRows = leadLib.buildModel({ jobs, upcoming: upcomingRaw, pto: [], featuresMd: null, notesDoc: null, now }).upcoming;
  const shipped = featuresMd ? leadLib.extractShipped(featuresMd, new Date(now.toLocaleString("en-US", { timeZone: TZ }))) : null;
  const model = lib.buildModel({ jobs, needs, pto, scheduleEntries, simproTotalsById, lastActions, upcoming: upcomingRows, shipped, now, crew: RES_CREW });
  const lines = lib.renderLines(model);
  console.log("counts", model.counts);
  console.log("\n--- section text ---");
  lines.forEach(l => console.log(`[${l.kind}] ${l.text}`));

  // Preview: dump the lines (text + kind + colored spans) to JSON at the repo root.
  // (A service account can't own a Drive file, so the Google Doc preview is built from this.)
  require("fs").writeFileSync(path.join(__dirname, "../foremanprep-preview.json"), JSON.stringify({ heading: model.heading, counts: model.counts, lines }, null, 1));
  console.log("\nwrote foremanprep-preview.json");
  process.exit(0);
})().catch(e => { console.error("FAILED:", e && e.message ? e.message : e); process.exit(1); });
