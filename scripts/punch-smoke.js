// punch-smoke: the PRODUCTION BUILD (./build) in headless Chrome with a throwaway profile. A generated test identity
// is placed in localStorage so the PIN gate is skipped; Firestore LISTEN channels are allowed (real job data
// renders) and every WRITE channel, callable function and upload is aborted at the browser, so nothing this
// run does can reach the server. Opens a real job's Rough → Punch List → Main Level, types a room (the fan-out
// path), checks Finish shows it, and fails on any page error.
const { chromium } = require("playwright-core");
const fs = require("fs"), path = require("path"), http = require("http");
const ROOT = path.join(process.cwd(), "build");
const OUT = path.join(process.cwd(), "render-check-out"); fs.mkdirSync(OUT, { recursive: true });
const PORT = 5390 + Math.floor(Math.random() * 100);
const JOB = process.argv[2] || "Miller Residence - Alpine";   // job NAME to open; ROSTER_ID = a real settings/users id (the gate kicks unknown ids)
const ROSTER_ID = process.env.ROSTER_ID || "koy";
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/service-worker.js") { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (path.extname(u)) { res.writeHead(404); return res.end(); } f = path.join(ROOT, "index.html"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => srv.listen(PORT, r));
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const ctx = await b.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true, isMobile: true });
  const blocked = [], seen = new Set();
  await ctx.route("**/*", r => {
    const u = r.request().url(), m = r.request().method();
    const isWrite = /Firestore\/Write\//.test(u) || /cloudfunctions\.net|\/functions\/|firebasestorage\.googleapis\.com.*(POST|PUT)/.test(u + " " + m) || (/firebasestorage\.googleapis\.com/.test(u) && m !== "GET") || (/firestore\.googleapis\.com\/v1\//.test(u) && m !== "GET" && !/\/Listen\//.test(u) && !/:runQuery|:batchGet/.test(u));
    if (isWrite) { blocked.push(m + " " + u.slice(0, 110)); return r.abort(); }
    if (/firestore|firebase|googleapis/.test(u)) seen.add(u.replace(/\?.*$/, "").slice(0, 100));
    return r.continue();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("he_identity", JSON.stringify({ id: process.env.ROSTER_ID || "koy", name: "Smoke Test", role: "admin", access: "admin", title: "admin", pin: "", pinVerifiedAt: Date.now() })); } catch {} });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e).slice(0, 400)));
  const logs = []; p.on("console", m => { const t = m.text(); if (/ccrooms|fieldink/i.test(t)) logs.push(m.type() + ": " + t.slice(0, 160)); });
  const shot = async (n) => p.screenshot({ path: path.join(OUT, n + ".png") });
  const tap = async (sel, t = 4000) => { const el = await p.waitForSelector(sel, { timeout: t }).catch(() => null); if (!el) return false; await el.click().catch(() => {}); return true; };
  const text = () => p.evaluate(() => document.body.innerText);
  const clickLoc = async (loc) => { const l = loc.first(); if (!(await l.count())) return false; await l.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(200); await l.click({ timeout: 4000 }).catch(() => {}); return true; };
  const openPunchFloor = async (floor) => {
    // the Section header "PUNCH LIST" (uppercase label); clicking toggles it — open only if the floor isn't visible yet
    const floorVisible = async () => (await p.locator(`text=${floor}`).count()) > 0;
    if (!(await floorVisible())) { await clickLoc(p.locator('text=/^\\s*Punch List\\s*$/i')); await p.waitForTimeout(700); }
    if (!(await floorVisible())) { await clickLoc(p.locator('text=/Punch List/i')); await p.waitForTimeout(700); }
    if (!(await floorVisible())) return false;
    const header = p.locator(`span:text-is("${floor}")`).first();
    await header.scrollIntoViewIfNeeded().catch(() => {});
    // the floor body shows the add-room input only when expanded
    const inputVisible = async () => (await p.locator('input[placeholder*="Add room"]').count()) > 0;
    if (!(await inputVisible())) { await header.click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(700); }
    return inputVisible();
  };
  const addRoom = async (name) => { const i = p.locator('input[placeholder*="Add room"]').first(); await i.scrollIntoViewIfNeeded(); await i.fill(name); await clickLoc(p.locator('button:has-text("+ Room")')); await p.waitForTimeout(1200); };
  const step = async (name, fn) => { try { const r = await fn(); console.log((r === false ? "  –  " : "  ok  ") + name); return r; } catch (e) { console.log("  ✗  " + name + ": " + e.message.slice(0, 160)); return false; } };
  await p.goto("http://localhost:" + PORT + "/", { waitUntil: "load", timeout: 60000 }); await p.waitForTimeout(6000);
  await shot("10-landing");
  await step("signed in as the test identity (no PIN screen)", async () => !/Who are you|Couldn't load the team/.test(await text()));
  await step("Job Board", async () => { await tap('button:has-text("Job Board")'); await p.waitForTimeout(2500); await shot("11-board"); return /Job Board|jobs/i.test(await text()); });
  const opened = await step("open " + JOB, async () => {
    const s = await p.$('input[placeholder*="Search" i], input[type="search"]'); if (s) { await s.fill(JOB.split(" ")[0]); await p.waitForTimeout(1200); }
    const ok = await tap(`text=/${JOB.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}/`, 6000); await p.waitForTimeout(2500); await shot("12-job"); return ok;
  });
  if (opened) {
    await step("Rough tab", async () => { await tap('button:has-text("Rough")'); await p.waitForTimeout(1500); await shot("13-rough"); return true; });
    await step("Rough › Punch List › Main Level open (add-room box visible)", async () => { const ok = await openPunchFloor("Main Level"); await shot("14-main"); return ok; });
    const before = ((await text()).match(/Smoke Kitchen/gi) || []).length;
    await step("+ Room on Rough (fan-out path)", async () => { await addRoom("Smoke Kitchen"); await shot("15-room-added"); return ((await text()).match(/Smoke Kitchen/gi) || []).length > before; });
    await step("Finish › Main Level shows the fanned-out room", async () => { await clickLoc(p.locator('button:has-text("Finish")')); await p.waitForTimeout(1500); const ok = await openPunchFloor("Main Level"); await shot("16-finish-main"); return ok && /Smoke Kitchen/i.test(await text()); });
    await step("same name typed on Finish is not duplicated back onto Rough", async () => { await addRoom("smoke kitchen"); const nF = ((await text()).match(/smoke kitchen/gi) || []).length; await clickLoc(p.locator('button:has-text("Rough")')); await p.waitForTimeout(1200); await openPunchFloor("Main Level"); const nR = ((await text()).match(/smoke kitchen/gi) || []).length; await shot("17-rough-again"); console.log(`     mentions — Finish: ${nF}, Rough: ${nR}`); return nR === 1; });   // nF may be 2: a same-named room on the list you are ON is existing "+ Room" behaviour (no dedupe there); only the OTHER list must not duplicate
    await step("FieldInk rooms button absent (no ccrooms doc sent yet for this job)", async () => !/FieldInk rooms/.test(await text()));
  }
  console.log(errs.length ? "  ✗  page errors:\n     " + errs.join("\n     ") : "  ok  no page errors");
  console.log("  –  writes blocked at the browser: " + blocked.length + (blocked.length ? "\n     " + Array.from(new Set(blocked)).slice(0, 6).join("\n     ") : ""));
  console.log("  –  firestore/firebase hosts seen: " + Array.from(seen).slice(0, 8).join(" | "));
  if (logs.length) console.log("  –  ccrooms/fieldink console: " + logs.slice(0, 6).join(" || "));
  await b.close(); srv.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error("smoke failed to run:", e.message); process.exit(1); });
