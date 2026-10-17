// Firestore-emulator test for the v551 (UX batch 0) inbox rule in the LIVE
// rules file (../../firestore.rules): a bell item may change only read /
// readAt / readVia, and the new function-only job_events log refuses clients.
// Run from this folder:
//
//   npm install
//   npx firebase emulators:exec --only firestore --project demo-he-rules \
//       "node inbox-read.rules.test.js"
//
// Expected: every check prints "ok", exit code 0.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = path.join(__dirname, "..", "..", "firestore.rules");
const PROJECT = process.env.GCLOUD_PROJECT || "demo-he-rules";
let fails = 0;
const check = async (name, promise) => {
  try { await promise; console.log("  ok   " + name); }
  catch (e) { fails++; console.error("  FAIL " + name + " — " + (e && e.message)); }
};

(async () => {
  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(RULES, "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) },
  });
  const db = () => env.unauthenticatedContext().firestore();   // the app has no Firebase Auth
  const ITEM = "notifications/treycen_rollene/items/n1";
  const seed = () => env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(ITEM).set({ title: "Punch Assigned", body: "2 items", read: false, createdAt: "2026-10-17T15:00:00Z" }));

  console.log("\nbell items: read flip + read stamp only");
  await seed();
  await check("read flip alone is allowed (unchanged from today)", assertSucceeds(db().doc(ITEM).update({ read: true })));
  await check("readAt + readVia stamp is allowed", assertSucceeds(db().doc(ITEM).update({ readAt: "2026-10-17T15:01:00Z", readVia: "bell" })));
  await seed();
  await check("read + readAt + readVia together are allowed", assertSucceeds(db().doc(ITEM).update({ read: true, readAt: "2026-10-17T15:01:00Z", readVia: "push" })));
  await check("changing the title is refused", assertFails(db().doc(ITEM).update({ title: "edited" })));
  await check("read plus another field is refused", assertFails(db().doc(ITEM).update({ read: true, body: "edited" })));
  await check("a client can't create a bell item", assertFails(db().doc("notifications/treycen_rollene/items/n2").set({ title: "x", read: false })));
  await check("a client can still clear (delete) its item", assertSucceeds(db().doc(ITEM).delete()));

  console.log("\njob_events: function-only");
  await check("a client can't write a job event", assertFails(db().doc("job_events/e1").set({ jobId: "1", kind: "field" })));
  await check("a client can't read job events", assertFails(db().doc("job_events/e1").get()));

  await env.cleanup();
  if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
  console.log("\nall inbox / job_events rule checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
