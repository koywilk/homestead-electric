// Firestore-emulator test for the v546 settings/users shrink guard in the LIVE
// rules file (../../firestore.rules). Run from this folder:
//
//   npm install
//   npx firebase emulators:exec --only firestore --project demo-he-rules \
//       "node settings-shrink.rules.test.js"
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
const team = (n) => ({ list: Array.from({ length: n }, (_, i) => ({ id: "u" + i, name: "Person " + i })), updated_at: new Date().toISOString(), saved_by: "test" });

(async () => {
  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(RULES, "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) },
  });
  const client = () => env.unauthenticatedContext().firestore();   // the app has no Firebase Auth
  const seed = (doc) => env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("settings/users").set(doc));

  console.log("\nsettings/users shrink guard");
  await env.clearFirestore();
  await check("create with a 36-person list (no doc yet)", assertSucceeds(client().doc("settings/users").set(team(36))));
  await check("same size is allowed", assertSucceeds(client().doc("settings/users").set(team(36))));
  await check("grow is allowed", assertSucceeds(client().doc("settings/users").set(team(37))));
  await seed(team(36));
  await check("shrink by one (a real removal) is allowed", assertSucceeds(client().doc("settings/users").set(team(35))));
  await seed(team(36));
  await check("shrink by two is refused", assertFails(client().doc("settings/users").set(team(34))));
  await check("the sign-in overwrite (36 → 1) is refused", assertFails(client().doc("settings/users").set(team(1))));
  await check("a write with no list at all is refused", assertFails(client().doc("settings/users").set({ updated_at: "x" })));
  await seed({ note: "legacy doc without a list" });
  await check("legacy doc without a list accepts a fresh list", assertSucceeds(client().doc("settings/users").set(team(36))));
  await check("delete stays refused on settings/users", assertFails(client().doc("settings/users").delete()));

  console.log("\nother /settings docs untouched");
  await check("settings/main write still open", assertSucceeds(client().doc("settings/main").set({ colorOverrides: {} })));
  await check("settings/main delete still open", assertSucceeds(client().doc("settings/main").delete()));

  await env.cleanup();
  console.log(fails ? `\n${fails} FAILED` : "\nall ok");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
