#!/usr/bin/env node
// render-check: open the PRODUCTION BUILD in headless Chromium with every non-local request blocked at the
// browser level (nothing can reach Firebase, Vercel or Google), get past the identity gate with a throwaway
// PIN that lives only in this headless profile, open every nav tab, and fail on any page error.
//
// Why (2026-10-01 → 02, v490 black screen): the compiler cannot see a render-time crash; this can. The
// container has no login to the real app, but the build renders its own shell with empty data, which is
// enough to catch "cannot access X before initialization", a bad hook order, or a component that throws on
// mount. Run it after `npm run build`, before any push to main:
//   npm run render-check            # serves ./build on a free port and drives it
//   PW_CHROMIUM=/path/to/chromium npm run render-check   # if Chromium isn't at the default path
// Screenshots land in ./render-check-out/ (gitignored). Exit 1 on any page error.
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
let chromium; try { chromium = require("playwright-core").chromium; } catch (e) { console.error("  render-check: playwright-core missing — npm i -D playwright-core"); process.exit(2); }

const missing = [];
const PORT = 5190 + Math.floor(Math.random() * 100), OUT = path.join(process.cwd(), "render-check-out");
const TABS = ["My Day", "Job Board", "Today", "Needs", "COs", "Job Prep", "Safety", "Tools", "Forecast", "Huddle", "Scoreboard"];
const exe = process.env.PW_CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// tiny static server with SPA fallback (no dependency on `serve`)
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(process.cwd(), "build", u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    // Vercel serves a real 404 for a missing file with an extension and index.html for app routes.
    if (path.extname(u)) { missing.push(u); res.writeHead(404); res.end(); return; }
    f = path.join(process.cwd(), "build", "index.html");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  if (!fs.existsSync(path.join(process.cwd(), "build", "index.html"))) { console.error("  render-check: no build/ — run npm run build first"); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => srv.listen(PORT, r));
  const b = await chromium.launch(exe ? { executablePath: exe } : { channel: "chrome" });
  const ctx = await b.newContext({ viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true });
  await ctx.route("**/*", (route) => (route.request().url().startsWith("http://localhost:" + PORT) ? route.continue() : route.abort()));
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
  const tap = async (sel) => { const el = await p.$(sel); if (el) { await el.click().catch(() => {}); return true; } return false; };
  const digits = async () => { for (const d of ["1", "9", "7", "3"]) { await tap(`button:text-is("${d}")`); await p.waitForTimeout(100); } await p.waitForTimeout(1200); };
  await p.goto("http://localhost:" + PORT + "/", { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(2500);
  if (await tap("text=Koy Wilkinson")) { await p.waitForTimeout(800); await digits(); if (/confirm|again|re-enter/i.test(await p.evaluate(() => document.body.innerText))) await digits(); }
  const rows = [];
  const snap = async (name) => { await p.waitForTimeout(1100); const e = errs.splice(0); rows.push({ name, e }); await p.screenshot({ path: path.join(OUT, name.replace(/\W+/g, "_") + ".png") }); };
  await snap("landing");
  for (const t of TABS) { if (await tap(`button:has-text("${t}")`)) await snap(t); else rows.push({ name: t, e: [], skipped: true }); }
  await b.close(); srv.close();
  let bad = 0;
  rows.forEach((r) => { if (r.e.length) bad++; console.log((r.e.length ? "  ✗ " : r.skipped ? "  –  " : "  ok  ") + r.name.padEnd(12) + (r.e.length ? r.e.join(" || ") : r.skipped ? "(not visible for this identity)" : "renders")); });
  if (missing.length) console.log("  –  not in build/ (404, as on Vercel): " + Array.from(new Set(missing)).join(", "));
  if (bad) { console.error(`\n  render-check: ${bad} view(s) threw — see render-check-out/*.png\n`); process.exit(1); }
  console.log("  ok  render-check: every nav tab renders with no page error");
})().catch((e) => { console.error("  render-check failed to run:", e.message); process.exit(1); });
