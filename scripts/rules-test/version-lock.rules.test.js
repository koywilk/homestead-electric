// Firestore-emulator tests for the Phase 2 Version Lock rules
// (../../firestore.phase2.rules — NOT the live file). Run from this folder:
//
//   npm install
//   npx firebase emulators:exec --only firestore --project demo-he-rules \
//       "node version-lock.rules.test.js"
//
// Needs the Firebase CLI and a Java runtime (the emulator is a JVM). These
// tests were WRITTEN but NOT RUN on the authoring machine (no Java) — see the
// Phase 1 report. Expected: every check prints "ok", exit code 0.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

const RULES = path.join(__dirname, "..", "..", "firestore.phase2.rules");
const PROJECT = process.env.GCLOUD_PROJECT || "demo-he-rules";

let fails = 0;
const check = async (name, promise) => {
  try { await promise; console.log("  ok   " + name); }
  catch (e) { fails++; console.error("  FAIL " + name + " — " + (e && e.message)); }
};
const stamped = (build, w, extra) => ({ data: { name: "Job" }, updated_at: new Date().toISOString(), app_build: build, w, ...(extra || {}) });

(async () => {
  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(RULES, "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) },
  });
  const client = () => env.unauthenticatedContext().firestore();   // the app has no Firebase Auth
  const seedGate = (minBuild) => env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore().doc("appGate/version");
    if (minBuild === null) await d.delete(); else await d.set({ minBuild, setBy: "test", setAt: new Date().toISOString() });
  });
  const seedJob = (id, doc) => env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("jobs/" + id).set(doc));

  console.log("\nappGate/version");
  await seedGate(520);
  await check("client can READ the gate", assertSucceeds(client().doc("appGate/version").get()));
  await check("client cannot WRITE the gate", assertFails(client().doc("appGate/version").set({ minBuild: 0 })));
  await check("client cannot CREATE another gate doc", assertFails(client().doc("appGate/other").set({ minBuild: 0 })));

  console.log("\njobs — minBuild 520");
  await seedJob("j1", stamped(519, "519.aaaaaaaa"));
  await check("old build (514) refused on update", assertFails(client().doc("jobs/j1").update(stamped(514, "514.bbbbbbbb"))));
  await check("old build (514) refused on create", assertFails(client().doc("jobs/j-new-old").set(stamped(514, "514.cccccccc"))));
  await check("same build (520) allowed on update", assertSucceeds(client().doc("jobs/j1").update(stamped(520, "520.dddddddd"))));
  await check("newer build (521) allowed on create", assertSucceeds(client().doc("jobs/j-new").set(stamped(521, "521.eeeeeeee"))));
  await check("unchanged w refused (inherited stamp)", assertFails(client().doc("jobs/j1").update({ "data.name": "x", updated_at: new Date().toISOString(), app_build: 520, w: "520.dddddddd" })));
  await check("missing stamp refused (old build's updateDoc shape)", assertFails(client().doc("jobs/j1").update({ "data.name": "y", updated_at: new Date().toISOString() })));
  await check("app_build as a string refused", assertFails(client().doc("jobs/j1").update({ updated_at: new Date().toISOString(), app_build: "520", w: "520.ffffffff" })));
  await check("empty w refused", assertFails(client().doc("jobs/j1").update({ updated_at: new Date().toISOString(), app_build: 520, w: "" })));
  await check("existing shape check still applies (no updated_at)", assertFails(client().doc("jobs/j-shape").set({ data: {}, app_build: 520, w: "520.gggggggg" })));
  await check("existing shape check still applies (data not a map)", assertFails(client().doc("jobs/j-shape").set({ data: "nope", updated_at: "x", app_build: 520, w: "520.hhhhhhhh" })));
  await check("delete unaffected (no stamp needed)", assertSucceeds(client().doc("jobs/j1").delete()));

  console.log("\njobs — minBuild 0 (kill switch)");
  await seedGate(0);
  await seedJob("j2", stamped(100, "100.aaaaaaaa"));
  await check("stamped write from any build allowed", assertSucceeds(client().doc("jobs/j2").update(stamped(1, "1.bbbbbbbb"))));
  await check("…but w must still change", assertFails(client().doc("jobs/j2").update(stamped(1, "1.bbbbbbbb"))));
  await check("…and a stamp is still required", assertFails(client().doc("jobs/j2").update({ updated_at: new Date().toISOString() })));

  console.log("\njobs — gate doc missing (deliberate fail-OPEN, see rules comment)");
  await seedGate(null);
  await seedJob("j3", stamped(100, "100.aaaaaaaa"));
  await check("stamped write allowed when appGate/version does not exist", assertSucceeds(client().doc("jobs/j3").update(stamped(1, "1.cccccccc"))));
  await check("unstamped write still refused when the gate doc is missing", assertFails(client().doc("jobs/j3").update({ updated_at: new Date().toISOString() })));

  console.log("\nother collections untouched in Phase 2");
  await seedGate(520);
  await check("needs: unstamped write still allowed (Phase 3)", assertSucceeds(client().doc("needs/n1").set({ data: { title: "x" }, updated_at: new Date().toISOString() })));
  await check("redlineWalks: unstamped write still allowed (Phase 3)", assertSucceeds(client().doc("redlineWalks/r1").set({ data: {}, updated_at: new Date().toISOString() })));
  await check("settings: still open", assertSucceeds(client().doc("settings/versionLockStats").set({ days: {} })));

  await env.cleanup();
  console.log("");
  if (fails) { console.error(`version-lock rules: ${fails} FAILURE(S)\n`); process.exit(1); }
  console.log("version-lock rules: all checks passed\n");
})().catch((e) => { console.error("version-lock rules test could not run:", e && e.message); process.exit(2); });
