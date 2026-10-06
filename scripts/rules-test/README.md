# Firestore rules tests — Version Lock (Phase 2)

Tests `firestore.phase2.rules` (the prepared, NOT-deployed Phase 2 rules) in the
Firestore emulator. Separate from the app build: this folder has its own
`package.json` so `@firebase/rules-unit-testing` and `firebase-tools` never
enter the app's dependency tree.

```
cd scripts/rules-test
npm install
npm test          # = firebase emulators:exec --only firestore "node version-lock.rules.test.js"
```

Requirements: a Java runtime (the emulator is a JVM; `java -version` must work)
and the Firebase CLI. The authoring machine for Phase 1 (2026-10-06) had no Java,
so these tests were written but **not run** — run them before the Phase 2 rules
deploy, in the same quiet window.

What is covered: old build refused · same/newer build allowed · unchanged `w`
refused · missing stamp refused · `minBuild 0` allows any stamped write ·
missing gate doc = lock off (deliberate fail-open, see the rules comment) ·
delete unaffected · the pre-existing shape checks still apply · needs /
redlineWalks / settings untouched.

`node_modules/` here is gitignored.
