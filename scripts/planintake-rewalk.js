// Plan intake: re-check one calendar walk. The watcher treats a walk's
// matched / existing_job / queued / commercial verdict as final, so after a
// rules fix a walk it got wrong stays wrong. This clears that walk's state
// (live mode) and its stale "walk on job" Today row, so the next watcher pass
// (every 30 min) decides it again under the current rules. Folders are untouched.
//   node scripts/planintake-rewalk.js <calendarEventId>            (shows what it would clear)
//   node scripts/planintake-rewalk.js <calendarEventId> --apply
// First use: Whitaker Farms 27 (7vdcvdtler79tcvi8p5473jsa1), filed under floor box job #1348, 2026-10-06.
"use strict";
const path = require("path"), os = require("os");
const admin = require("../functions/node_modules/firebase-admin");
const [eventId, flag] = process.argv.slice(2);
if (!eventId) { console.error("usage: node scripts/planintake-rewalk.js <calendarEventId> [--apply]"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(path.join(os.homedir(), "Desktop", "homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json"))), projectId: "homestead-electric" });
const db = admin.firestore();
(async () => {
  const walkRef = db.collection("planIntakeState").doc(`walk_${eventId}`);
  const w = (await walkRef.get()).data();
  if (!w) { console.log(`No live walk record for ${eventId} — the watcher will pick it up on its own.`); process.exit(0); }
  console.log(`${w.title} (${w.walkDate}) — now: ${w.status}${w.jobNo ? ` #${w.jobNo}` : ""}${w.quoteNo ? ` Q${w.quoteNo}` : ""}`);
  const stale = db.collection("agentFindings").doc(`walk_job_${eventId}`);
  const hasStale = (await stale.get()).exists;
  if (flag !== "--apply") { console.log(`Would clear walk_${eventId}${hasStale ? ` and the Today row walk_job_${eventId}` : ""}. Re-run with --apply.`); process.exit(0); }
  await walkRef.delete();
  if (hasStale) await stale.delete();
  console.log("Cleared. The next watcher pass (within 30 min) re-checks this walk.");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
