#!/usr/bin/env node
/* READ-ONLY dry-run of the Lead Meeting Prep sheet against real prod data.
 * Mirrors runLeadMeetingPrep (functions/index.js) steps 1-4 exactly — same
 * reads, same FEATURES.md fetch, same pure builder (../functions/leadMeetingPrep.js)
 * — then writes the rendered sheet to leadprep-dryrun.html at the repo root and
 * prints section counts. Does NOT create a Drive doc, does NOT push, writes
 * nothing to Firestore. The notes-doc read uses the same service-account JSON,
 * so "UNAVAILABLE" here means Koy still has to share the doc (Viewer) with
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
  } catch (e) { console.log("Notes doc read failed (share it Viewer with the service account):", String(e.message).slice(0, 160)); }

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
