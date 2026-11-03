// Plan intake — Google Chat sign-in for the watcher (Koy 2026-11-03: "yes, reuse it").
//   node scripts/plan-intake-chat-auth.js         sign in, check it reads Chat, save it
//   node scripts/plan-intake-chat-auth.js --on    after the deploy: read Chat from now on
//   node scripts/plan-intake-chat-auth.js --off   stop reading Chat (nothing else changes)
// Reuses the Homestead connector's OAuth client (Cloud project homestead-connector,
// the client its `npm run chat-token` uses, redirect http://localhost:8080/callback)
// with the same two READ-ONLY Chat scopes, and gets a refresh token of its own, so
// the connector's sign-in in Vercel is untouched. The token is saved as `chat`
// inside the existing PLAN_INTAKE_GOOGLE_OAUTH secret (the calendar + Gmail sign-in
// is kept as it is), so planIntakeWatcher needs no new secret. Nothing is printed
// or left on disk. Redeploy planIntakeWatcher afterwards so it picks the new
// secret version up.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const readline = require("readline");
const { execFileSync, spawnSync } = require("child_process");
const { google } = require(path.join(__dirname, "../functions/node_modules/googleapis"));

const SCOPES = ["https://www.googleapis.com/auth/chat.spaces.readonly", "https://www.googleapis.com/auth/chat.messages.readonly"];
const SECRET = "PLAN_INTAKE_GOOGLE_OAUTH";
const PROJECT = "homestead-electric";
const PORT = 8080;
const REDIRECT = `http://localhost:${PORT}/callback`;
const KOY = "koy@homesteadelectric.net";
// Koy's Chat user id, found by the connector's chat-token run (2026-11-03). Posts
// from this id are never picked up. Override with GOOGLE_CHAT_MY_USER.
const MY_USER = process.env.GOOGLE_CHAT_MY_USER || "users/118138567027707443539";
const ADMIN_KEY = path.join(os.homedir(), "Desktop", "homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json");

const ask = (q) => new Promise((done) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); done(a.trim()); }); });

async function setSwitch(on) {
  const admin = require(path.join(__dirname, "../functions/node_modules/firebase-admin"));
  admin.initializeApp({ credential: admin.credential.cert(require(ADMIN_KEY)), projectId: PROJECT });
  const at = new Date().toISOString();
  await admin.firestore().collection("planIntakeState").doc("config").set(on ? { chatSince: at, chatCursor: "" } : { chatSince: "" }, { merge: true });
  console.log(on ? `OK: Plan Intake reads Google Chat from ${at} on (next watcher run, within 30 min).` : "OK: Plan Intake stopped reading Google Chat.");
  process.exit(0);
}

async function signIn() {
  let saved;
  try { saved = JSON.parse(execFileSync("firebase", ["functions:secrets:access", SECRET, "--project", PROJECT], { encoding: "utf8" }).trim()); }
  catch (e) { console.error("Couldn't read the saved plan intake sign-in:", e.message.split("\n")[0]); process.exit(1); }
  if (!saved.client_id || !saved.refresh_token) { console.error(`${SECRET} has no calendar sign-in; run scripts/plan-intake-google-auth.js first.`); process.exit(1); }

  const clientId = process.env.GOOGLE_CHAT_CLIENT_ID || (await ask("The connector's OAuth client ID (Vercel GOOGLE_CHAT_CLIENT_ID, or Google Cloud › homestead-connector › Clients): "));
  // The secret comes from the clipboard, never typed or shown (typed input leaked once in Claude's Terminal panel).
  let clientSecret = process.env.GOOGLE_CHAT_CLIENT_SECRET || "";
  while (!/^GOCSPX-[\w-]{10,}$/.test(clientSecret)) {
    await ask("Copy that client's secret in Google Cloud (the copy icon), then press Enter: ");
    clientSecret = execFileSync("pbpaste").toString().trim();
    if (!/^GOCSPX-[\w-]{10,}$/.test(clientSecret)) console.log("  That isn't a client secret (they start with GOCSPX-). Copy it again.");
  }
  console.log("  Secret read from the clipboard (not shown).");

  const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
  const state = crypto.randomBytes(16).toString("hex");
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", REDIRECT);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const ok = !u.searchParams.get("error") && u.searchParams.get("code") && u.searchParams.get("state") === state;
      res.end(ok ? "Signed in. You can close this tab and go back to Terminal." : `Sign-in failed: ${u.searchParams.get("error") || "state mismatch"}`);
      server.close();
      ok ? resolve(u.searchParams.get("code")) : reject(new Error(u.searchParams.get("error") || "state mismatch"));
    });
    server.listen(PORT, () => {
      console.log(`Opening Google sign-in. Sign in as ${KOY} and allow read-only Chat.`);
      spawnSync("open", [oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, login_hint: KOY, state })]);
    });
  });
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google sent no refresh token. Run it again.");
  oauth.setCredentials(tokens);
  // Prove it reads Chat before saving anything.
  const r = await google.chat({ version: "v1", auth: oauth }).spaces.list({ pageSize: 100 });
  const n = (r.data.spaces || []).length;

  const tmp = path.join(os.tmpdir(), `pi-chat-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ ...saved, chat: { client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, my_user: MY_USER } }), { mode: 0o600 });
  try { execFileSync("firebase", ["functions:secrets:set", SECRET, "--data-file", tmp, "--project", PROJECT], { stdio: "inherit" }); }
  finally { fs.rmSync(tmp, { force: true }); }
  console.log(`OK: read ${n} Chat space(s) as ${KOY}; saved inside ${SECRET} (calendar + Gmail sign-in kept).`);
  console.log("Next: redeploy planIntakeWatcher, then run this script with --on.");
  process.exit(0);
}

const arg = process.argv[2];
(arg === "--on" ? setSwitch(true) : arg === "--off" ? setSwitch(false) : signIn())
  .catch((e) => { console.error("Failed:", e.message); process.exit(1); });
