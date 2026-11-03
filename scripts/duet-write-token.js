// Duet write access (connector decision D9) — make duetApi's bearer secret
// (one time, or to rotate it).
//   node scripts/duet-write-token.js        (new token — redeploy duetApi after, then paste into Vercel)
//   node scripts/duet-write-token.js copy   (copy the saved token again)
// Generates a random 64-hex token, stores it as the Firebase secret
// DUET_WRITE_TOKEN (duetApi checks it), and copies it to the Mac clipboard so
// Koy can paste it into the connector's Vercel project as CC_WRITE_TOKEN
// (Sensitive). It is never printed in full or written to disk beyond a temp
// file that is removed. Same shape as plan-intake-routine-token.js.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const NAME = "DUET_WRITE_TOKEN";
if (process.argv[2] === "copy") {
  const saved = execFileSync("firebase", ["functions:secrets:access", NAME, "--project", "homestead-electric"], { encoding: "utf8" }).trim();
  execFileSync("pbcopy", [], { input: saved });
  console.log(`OK — saved token (…${saved.slice(-4)}) copied to the clipboard.`);
  process.exit(0);
}
const token = crypto.randomBytes(32).toString("hex");
const tmp = path.join(os.tmpdir(), `duet-tk-${process.pid}`);
fs.writeFileSync(tmp, token, { mode: 0o600 });
try { execFileSync("firebase", ["functions:secrets:set", NAME, "--data-file", tmp, "--project", "homestead-electric"], { stdio: "inherit" }); }
finally { fs.rmSync(tmp, { force: true }); }
execFileSync("pbcopy", [], { input: token });
console.log(`OK — ${NAME} set (…${token.slice(-4)}) and copied to the clipboard. Paste it into Vercel › homestead-connector › Environment Variables as CC_WRITE_TOKEN (Sensitive), then redeploy duetApi.`);
