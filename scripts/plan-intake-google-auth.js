// Plan intake — one-time Google sign-in for the calendar watcher.
//   node scripts/plan-intake-google-auth.js [path to the downloaded client_secret_*.json]   (omit to reuse the saved client)
// Workspace only lets outside accounts see free/busy, so planIntakeWatcher reads
// Koy's calendar AS Koy. This opens Google's sign-in in the browser; sign in as
// koy@homesteadelectric.net and allow read-only Calendar. The script checks the
// token really reads that calendar, then stores {client_id, client_secret,
// refresh_token} in Firebase Secret Manager as PLAN_INTAKE_GOOGLE_OAUTH. Nothing
// is printed or left on disk. Re-run it any time the sign-in stops working (the
// watcher pushes Koy if it does). Phase 2 adds read-only Gmail to SCOPES.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync, spawnSync } = require("child_process");
const { google } = require(path.join(__dirname, "../functions/node_modules/googleapis"));

// Phase 2 (2026-10-04) adds read-only Gmail — the watcher can never label, move or delete mail.
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/gmail.readonly"];
const CALENDAR = "koy@homesteadelectric.net";
const SECRET = "PLAN_INTAKE_GOOGLE_OAUTH";
const PROJECT = "homestead-electric";

// Client: the downloaded client_secret_*.json if given, otherwise the client
// already stored in the secret (re-runs after the file was deleted).
const file = process.argv[2];
let c;
if (file) {
  if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1); }
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  c = json.installed || json.web;
} else {
  try { c = JSON.parse(execFileSync("firebase", ["functions:secrets:access", SECRET, "--project", PROJECT], { encoding: "utf8" }).trim()); }
  catch (e) { console.error("No client file given and the saved sign-in couldn't be read:", e.message.split("\n")[0]); process.exit(1); }
}
if (!c || !c.client_id || !c.client_secret) { console.error("That file isn't an OAuth client file (no client_id / client_secret)."); process.exit(1); }

const server = http.createServer();
server.listen(0, "127.0.0.1", () => {
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const oauth = new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
  const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, login_hint: CALENDAR });
  console.log("Opening Google sign-in. Sign in as", CALENDAR, "and allow read-only Calendar and read-only Gmail.");
  spawnSync("open", [url]);
  server.on("request", async (req, res) => {
    const code = new URL(req.url, redirect).searchParams.get("code");
    if (!code) { res.end("No code — close this tab and run the script again."); return; }
    try {
      const { tokens } = await oauth.getToken(code);
      if (!tokens.refresh_token) throw new Error("Google sent no refresh token — remove the app at myaccount.google.com/permissions and run again.");
      oauth.setCredentials(tokens);
      // Prove it reads Koy's calendar before storing anything.
      const cal = google.calendar({ version: "v3", auth: oauth });
      const r = await cal.events.list({ calendarId: CALENDAR, timeMin: new Date().toISOString(), maxResults: 5, singleEvents: true });
      const n = (r.data.items || []).length;
      const g = await google.gmail({ version: "v1", auth: oauth }).users.getProfile({ userId: "me" });
      if (String(g.data.emailAddress || "").toLowerCase() !== CALENDAR) throw new Error(`signed in as ${g.data.emailAddress} — sign in as ${CALENDAR}`);
      const tmp = path.join(os.tmpdir(), `pi-oauth-${process.pid}.json`);
      fs.writeFileSync(tmp, JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: tokens.refresh_token }), { mode: 0o600 });
      try {
        execFileSync("firebase", ["functions:secrets:set", SECRET, "--data-file", tmp, "--project", PROJECT], { stdio: "inherit" });
      } finally { fs.rmSync(tmp, { force: true }); }
      res.end("Signed in. The plan intake watcher can read your calendar. You can close this tab.");
      console.log(`OK — read ${n} upcoming event(s) and the Gmail profile of ${CALENDAR}; saved as secret ${SECRET}.`);
      server.close(); process.exit(0);
    } catch (e) {
      res.end(`Sign-in failed: ${e.message}`);
      console.error("Sign-in failed:", e.message);
      server.close(); process.exit(1);
    }
  });
});
