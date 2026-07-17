// Dump a GC's REAL portal payload (jobs → actual projection wall → JSON) for
// the boss-demo artifact. Read-only against Firestore; writes one JSON file.
//   node scripts/gcportal-dump.js robison /path/to/out.json
"use strict";
const fs = require("fs");
const path = require("path");
const admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const gcPortal = require(path.join(__dirname, "..", "functions", "gcPortal.js"));
const KEY = path.join(process.env.HOME, "Desktop", "homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json");

admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const db = admin.firestore();

(async () => {
  const gcName = process.argv[2] || "robison";
  const out = process.argv[3];
  if (!out) { console.error("usage: node scripts/gcportal-dump.js <gc> <out.json>"); process.exit(1); }
  const gcKey = gcPortal.gcKeyOf(gcName);
  const all = await db.collection("jobs").get();
  const views = [];
  all.docs.forEach((d) => {
    const job = (d.data() || {}).data;
    if (!job || gcPortal.gcKeyOf(job.gc) !== gcKey) return;
    const v = gcPortal.projectJobForPortal(d.id, job);
    if (v) views.push(v);
  });
  if (!views.length) { console.error("no jobs matched gcKey", JSON.stringify(gcKey)); process.exit(1); }

  // leak guard on the exact payload being shipped into the artifact
  const blob = JSON.stringify(views).toLowerCase();
  const banned = ["simpromargin", "netpl", "roughnotes", "finishnotes", "accessnote",
    "flagnote", "dailyupdates", "saved_by", "material", "lockbox", "panelbeforegen",
    "foreman", "statusupdate"];
  const hit = banned.find((b) => blob.includes(b));
  if (hit) { console.error("LEAK GUARD TRIPPED:", hit); process.exit(2); }

  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), gcKey, jobs: views }, null, 1));
  console.log("dumped", views.length, "projected jobs →", out);
  console.log(views.map((v) => v.name + " (rough " + (v.rough.stage || "—") + " / finish " + (v.finish.stage || "—") + ")").join("\n"));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
