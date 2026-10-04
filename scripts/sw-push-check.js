#!/usr/bin/env node
"use strict";
// FCM reliability pass (2026-10-04) — real-Chromium check of the push worker,
// public/firebase-messaging-sw.js. Pushes are injected with the DevTools
// protocol (ServiceWorker.deliverPushMessage), so no FCM project, token or
// network is involved. Run:  npm run sw-push-check
//   PW_CHROMIUM=/path/to/chromium npm run sw-push-check   # if Chromium isn't at the default path
//   NO_SDK=1 npm run sw-push-check   # simulate the gstatic CDN being unreachable
// Checks, with the page VISIBLE (the case phones used to miss):
//  - a push delivered while the page is VISIBLE produces an OS notification
//  - two pushes for the same job → two notifications (no silent replace)
//  - the same record twice → still one (tag dedupe)
//  - receipt POST carries uk/nid/tk/_appKey
const http = require("http");
const fs = require("fs");
const path = require("path");
let chromium; try { chromium = require("playwright-core").chromium; } catch (e) { console.error("  sw-push-check: playwright-core missing — npm i -D playwright-core"); process.exit(2); }
const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const exe = process.env.PW_CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const page_html = `<!doctype html><html><body><h1>sw test</h1><script>
window.__msgs = [];
navigator.serviceWorker.addEventListener("message", e => window.__msgs.push(e.data));
window.__reg = navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/firebase-cloud-messaging-push-scope" })
  .then(r => new Promise(res => { const w = r.installing || r.waiting || r.active;
    if (r.active) return res(r); w.addEventListener("statechange", () => w.state === "activated" && res(r)); }));
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/" || u.pathname === "/sw-test.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page_html); }
  const f = path.join(PUB, u.pathname);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { "content-type": f.endsWith(".js") ? "application/javascript" : "application/octet-stream" });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => server.listen(4179, r));
  const origin = "http://localhost:4179";
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["notifications"], { origin });
  const receipts = [];
  await ctx.route("https://us-central1-homestead-electric.cloudfunctions.net/**", async route => {
    receipts.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"result":{"ok":true}}' });
  });
  if (!process.env.NO_SDK) {
    await ctx.route("https://www.gstatic.com/firebasejs/**", route => {
      const f = route.request().url().split("/").pop();
      route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(ROOT, "node_modules/firebase", f)) });
    });
  }
  const page = await ctx.newPage();
  const swLogs = [];
  ctx.on("serviceworker", w => w.on("console", m => swLogs.push(m.text())));
  await page.goto(origin + "/sw-test.html");
  await page.evaluate(() => window.__reg);

  const cdp = await ctx.newCDPSession(page);
  const regs = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", e => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await new Promise(r => setTimeout(r, 500));
  const reg = regs.find(r => r.scopeURL.includes("firebase-cloud-messaging-push-scope"));
  if (!reg) throw new Error("messaging registration not found: " + JSON.stringify(regs));

  const push = async (data) => {
    await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId: reg.registrationId, data: JSON.stringify({ data, from: "318598172684", fcmMessageId: "x" }) });
    await new Promise(r => setTimeout(r, 700));
  };
  const notifs = () => page.evaluate(async () => (await (await window.__reg).getNotifications()).map(n => ({ title: n.title, tag: n.tag, data: n.data, silent: n.silent })));
  const vis = await page.evaluate(() => document.visibilityState);

  await push({ title: "Punch Assigned", body: "Outlet in kitchen", jobId: "J1", section: "punch", nid: "n1", uk: "u1", tk: "tokAAAAAAAAA", tag: "he-n1", link: "/?jobId=J1&section=punch&nid=n1", pri: "high" });
  let n = await notifs();
  console.log("page visibility:", vis, "| after push 1:", n.length, n.map(x => x.tag));
  if (n.length !== 1) throw new Error("FOREGROUND PUSH SHOWED NO NOTIFICATION");

  await push({ title: "Status Update", body: "needs a lift", jobId: "J1", section: "Job Info", nid: "n2", uk: "u1", tk: "tokAAAAAAAAA", tag: "he-n2", link: "/?jobId=J1&section=Job%20Info&nid=n2", pri: "high" });
  n = await notifs();
  console.log("after push 2 (same job, different event):", n.length);
  if (n.length !== 2) throw new Error("second event on same job replaced the first");

  await push({ title: "Status Update", body: "needs a lift", jobId: "J1", section: "Job Info", nid: "n2", uk: "u1", tk: "tokAAAAAAAAA", tag: "he-n2", pri: "high" });
  n = await notifs();
  console.log("after retry of record n2:", n.length);
  if (n.length !== 2) throw new Error("retried record stacked a duplicate");

  await push({ title: "Your day", body: "3 tasks", view: "myday", nid: "n3", uk: "u1", tk: "tokAAAAAAAAA", tag: "he-n3", link: "/?view=myday&nid=n3", pri: "normal" });
  n = await notifs();
  const low = n.find(x => x.tag === "he-n3");
  console.log("low-priority silent:", low && low.silent, "| url:", low && low.data.url);
  if (!low || low.silent !== true || !low.data.url.endsWith("/?view=myday&nid=n3")) throw new Error("low-priority shape wrong");

  // Test push from the Doctor: no uk → no receipt.
  await push({ title: "Test push", body: "x", __test: "1", nid: "test-1", uk: "", tag: "he-test-1" });

  console.log("receipts:", receipts.map(r => `${r.data.uk}/${r.data.nid}/${r.data.tk}/key=${r.data._appKey ? "y" : "n"}/visible=${r.data.visible}`).join("  "));
  if (receipts.length !== 4) throw new Error("expected 4 receipts (test push sends none), got " + receipts.length);
  if (!receipts.every(r => r.data._appKey === "hs-app-9f3c1e7a2b6d4085" && r.data.shown === true)) throw new Error("receipt shape");
  const fwd = await page.evaluate(() => window.__msgs.filter(m => m && (m.messageType === "push-received" || m.isFirebaseMessaging)).length);
  console.log("firebase SDK forwards to visible page:", fwd);
  if (!process.env.NO_SDK && fwd < 1) throw new Error("SDK did not forward to the visible page (onMessage toast path)");
  console.log("SW console:", swLogs.filter(l => /HE sw/.test(l)).slice(0, 3).join(" | "));
  console.log("sw-push-check ok" + (process.env.NO_SDK ? " (Firebase SDK unavailable)" : ""));
  await browser.close(); server.close();
})().catch(async e => { console.error("FAIL:", e.message); process.exit(1); });
