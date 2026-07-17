// Test-drive seeder for the GC portal (Piece 2). Reads REAL jobs, runs them
// through the actual projection wall, seeds a clearly-namespaced test link +
// mirror into the (dark) gc_links/gc_portal collections, prints the portal URL.
//   node scripts/gcportal-seed.js robison        # seed for GC name "robison"
//   node scripts/gcportal-seed.js --clean        # remove all gcp_test_* seed docs
// SA key is read-only-ish here; this writes ONLY to the new dark collections.
"use strict";
const path = require("path");
const admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const gcPortal = require(path.join(__dirname, "..", "functions", "gcPortal.js"));
const KEY = path.join(process.env.HOME, "Desktop", "homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json");

admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const db = admin.firestore();

const TEST_TOKEN = "gcp_test_token_robison";
const TEST_PORTAL = "gcp_test_portal_robison";

async function clean() {
  const jobs = await db.collection("gc_portal").doc(TEST_PORTAL).collection("jobs").get();
  const b = db.batch();
  jobs.docs.forEach((d) => b.delete(d.ref));
  b.delete(db.collection("gc_portal").doc(TEST_PORTAL));
  b.delete(db.collection("gc_links").doc(TEST_TOKEN));
  await b.commit();
  console.log("cleaned:", jobs.size, "job docs + link + mirror parent");
}

async function seed(gcName) {
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

  // leak double-check on the actual seeded payload
  const blob = JSON.stringify(views).toLowerCase();
  const banned = ["simpromargin", "netpl", "roughnotes", "finishnotes", "accessnote", "flagnote", "dailyupdates", "saved_by", "material"];
  const hit = banned.find((b) => blob.includes(b));
  if (hit) { console.error("LEAK GUARD TRIPPED — banned token in seeded payload:", hit); process.exit(2); }

  await db.collection("gc_links").doc(TEST_TOKEN).set({
    token: TEST_TOKEN, slug: "robison-test", label: "Robison Build Co", gc: gcName, gcKey,
    portalId: TEST_PORTAL, accentColor: "#4A5D3A",
    contacts: [
      { name: "Austin", role: "Site Super", phone: "(435) 555-0187", email: true, text: true },
      { name: "Robison Office", role: "Scheduling", phone: "(801) 555-0169", email: true, text: false },
    ],
    supersByJob: {},
    revoked: false, createdAt: new Date().toISOString(), createdBy: "seed",
  });
  // assign a super to the first two jobs so the filter/super-tag renders
  const supersByJob = {};
  views.slice(0, 2).forEach((v) => { supersByJob[v.id] = ["Austin"]; });
  await db.collection("gc_links").doc(TEST_TOKEN).update({ supersByJob });

  const pref = db.collection("gc_portal").doc(TEST_PORTAL);
  const b = db.batch();
  views.forEach((v) => b.set(pref.collection("jobs").doc(v.id), v));
  b.set(pref, { gcKey, updatedAt: new Date().toISOString() });
  await b.commit();

  console.log("seeded", views.length, "jobs · leak-guard clean · byline sample:");
  views.slice(0, 3).forEach((v) => console.log("   -", v.name, "| rough", v.rough.stage, "| Q open", v.questions.open, "| RT", v.returnTrips.length, "| QC", v.qc.items.length, "| MP links", v.matterport.links.length));
  console.log("\nPORTAL URL (append to your served origin):  /?gcportal=" + TEST_TOKEN);
}

(async () => {
  try {
    if (process.argv[2] === "--clean") { await clean(); }
    else { await seed(process.argv[2] || "robison"); }
    process.exit(0);
  } catch (e) { console.error("ERROR:", e.message); process.exit(1); }
})();
