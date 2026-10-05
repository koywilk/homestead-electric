// Plan intake Phase 2 — make the Routine's API key (one time, or to rotate it).
//   node scripts/plan-intake-routine-token.js        (new token — redeploy planRoutineApi after)
//   node scripts/plan-intake-routine-token.js copy   (copy the saved token again)
// Generates a random 64-hex token, stores it as the Firebase secret
// PLAN_ROUTINE_TOKEN (planRoutineApi checks it), and copies it to the Mac
// clipboard so Koy can paste it into the Routine's API credential. It is never
// printed in full or written to disk beyond a temp file that is removed.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");
// `node scripts/plan-intake-routine-token.js copy` re-copies the saved token
// (no change — the deployed planRoutineApi keeps working).
if (process.argv[2] === "copy") {
  const saved = execFileSync("firebase", ["functions:secrets:access", "PLAN_ROUTINE_TOKEN", "--project", "homestead-electric"], { encoding: "utf8" }).trim();
  execFileSync("pbcopy", [], { input: saved });
  console.log(`OK — saved token (…${saved.slice(-4)}) copied to the clipboard.`);
  process.exit(0);
}
const token = crypto.randomBytes(32).toString("hex");
const tmp = path.join(os.tmpdir(), `pi-rt-${process.pid}`);
fs.writeFileSync(tmp, token, { mode: 0o600 });
try { execFileSync("firebase", ["functions:secrets:set", "PLAN_ROUTINE_TOKEN", "--data-file", tmp, "--project", "homestead-electric"], { stdio: "inherit" }); }
finally { fs.rmSync(tmp, { force: true }); }
execFileSync("pbcopy", [], { input: token });
console.log(`OK — PLAN_ROUTINE_TOKEN set (…${token.slice(-4)}) and copied to the clipboard. Paste it into the Routine's API credential as:  Authorization: Bearer <paste>`);
