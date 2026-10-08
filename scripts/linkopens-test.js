// Link opens (share-link open tracking) — extracts the shipped helpers VERBATIM from src/App.js.
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("// ── Link opens helpers"), b = src.indexOf("// ── end Link opens helpers");
if (a < 0 || b < 0) { console.error("linkopens-test: helper markers not found in App.js"); process.exit(1); }
assert.ok(src.includes('const IDENTITY_KEY   = "he_identity"'), "isStaffDevice hardcodes he_identity — IDENTITY_KEY must still be that");
// URLSearchParams is a browser/Node global, not a JS builtin — hand it to the sandbox.
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(src.slice(a, b) + `
this.T = { LINK_OPENS_SINCE, LINK_OPEN_THROTTLE_MS, LINK_OPEN_FRESH_MS, linkOpenTarget, isStaffDevice,
  shouldRecordOpen, isBotAgent, deviceLabel, formatOpenWhen, linkOpenState };`, ctx);
const T = ctx.T;
const deq = (x, y) => assert.strictEqual(JSON.stringify(x), JSON.stringify(y));
let n = 0; const ok = (m) => { n++; console.log("  ok  " + m); };
console.log("── link opens ──");

// linkOpenTarget
deq(T.linkOpenTarget("?questions=123&s=s_ab12cd3"), { jobId: "123", key: "questions:s_ab12cd3" }); ok("named questions link");
deq(T.linkOpenTarget("?questions=123"), { jobId: "123", key: "questions:base" }); ok("base questions link");
deq(T.linkOpenTarget("?roughpunch=9&s=s_x1"), { jobId: "9", key: "roughpunch:s_x1" }); ok("named rough punch");
deq(T.linkOpenTarget("?finishpunch=9"), { jobId: "9", key: "finishpunch:base" }); ok("base finish punch");
deq(T.linkOpenTarget("?qcpunch=9"), { jobId: "9", key: "qcpunch:base" }); ok("qc punch");
for (const k of ["homeowner", "homeruns", "loads", "lighting", "lutronshare"]) deq(T.linkOpenTarget(`?${k}=77`), { jobId: "77", key: k + ":base" });
ok("one-per-job kinds key as :base");
deq(T.linkOpenTarget("?homeruns=77&s=zzz"), { jobId: "77", key: "homeruns:base" }); ok("?s= ignored on kinds without named shares");
deq(T.linkOpenTarget("?jobnote=55:n_9f:abcdef0123"), { jobId: "55", key: "jobnote:n_9f" }); ok("job note keys by note id, token dropped");
assert.strictEqual(T.linkOpenTarget("?jobnote=55"), null); ok("job note without a note id is skipped");
assert.strictEqual(T.linkOpenTarget("?questions=123&s=s_1&preview=1"), null); ok("preview never counts");
assert.strictEqual(T.linkOpenTarget("?lightinghub=1"), null); ok("lighting hub skipped");
assert.strictEqual(T.linkOpenTarget("?lightinghub=1&lutronshare=4"), null); ok("router order: hub wins over lutronshare, so skipped");
assert.strictEqual(T.linkOpenTarget("?gcportal=tok"), null); ok("GC portal skipped");
assert.strictEqual(T.linkOpenTarget("?appmap=1"), null); ok("app map skipped");
assert.strictEqual(T.linkOpenTarget(""), null); assert.strictEqual(T.linkOpenTarget("?view=cos"), null); ok("internal app URLs skipped");
assert.strictEqual(T.linkOpenTarget("?questions="), null); assert.strictEqual(T.linkOpenTarget("?questions=a/b"), null); ok("empty or slash job id skipped");
deq(T.linkOpenTarget("?questions=123&s=bad id!"), { jobId: "123", key: "questions:base" }); ok("unsafe share id falls back to base");
deq(T.linkOpenTarget("?homeowner=1&questions=2"), { jobId: "1", key: "homeowner:base" }); ok("router order: homeowner first");

// isStaffDevice
assert.strictEqual(T.isStaffDevice(k => (k === "he_identity" ? "{}" : null)), true); ok("signed-in device is staff");
assert.strictEqual(T.isStaffDevice(k => (k === "he_staff_device" ? "1" : null)), true); ok("expired-PIN device still staff via flag");
assert.strictEqual(T.isStaffDevice(() => null), false); ok("fresh browser is not staff");
assert.strictEqual(T.isStaffDevice(() => { throw new Error("blocked"); }), false); ok("storage throwing -> counted");

// shouldRecordOpen
const t0 = new Date(2026, 9, 7, 9, 0).getTime();
assert.strictEqual(T.shouldRecordOpen(null, t0), true); ok("first open records");
assert.strictEqual(T.shouldRecordOpen(new Date(t0 - 29 * 60000).toISOString(), t0), false); ok("29 min later: no");
assert.strictEqual(T.shouldRecordOpen(new Date(t0 - 30 * 60000).toISOString(), t0), true); ok("30 min later: yes");
assert.strictEqual(T.shouldRecordOpen("garbage", t0), true); ok("bad stamp records");
assert.strictEqual(T.shouldRecordOpen(new Date(t0 + 60000).toISOString(), t0), true); ok("future stamp records");

// isBotAgent
assert.strictEqual(T.isBotAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36", false), true); ok("HeadlessChrome is a bot");
assert.strictEqual(T.isBotAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", true), true); ok("webdriver is a bot");
assert.strictEqual(T.isBotAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", false), true); ok("Googlebot is a bot");
assert.strictEqual(T.isBotAgent("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", false), true); ok("Slackbot is a bot");
assert.strictEqual(T.isBotAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", false), false); ok("iPhone Safari is not a bot");
assert.strictEqual(T.isBotAgent(undefined, undefined), false); ok("missing UA is not a bot");

// deviceLabel
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1"), "iPhone · Chrome");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "iPad · Safari");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"), "Android · Chrome");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"), "Mac · Chrome");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), "Mac · Safari");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "Windows · Edge");
assert.strictEqual(T.deviceLabel("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0"), "Windows · Firefox");
assert.strictEqual(T.deviceLabel(""), "Other · Browser"); ok("device labels");

// formatOpenWhen (local time)
const now = new Date(2026, 9, 7, 15, 0).getTime(); // Wed Oct 7 2026, 3:00 pm
assert.strictEqual(T.formatOpenWhen(new Date(2026, 9, 7, 9, 12).toISOString(), now), "today 9:12 am");
assert.strictEqual(T.formatOpenWhen(new Date(2026, 9, 6, 18, 55).toISOString(), now), "yesterday 6:55 pm");
assert.strictEqual(T.formatOpenWhen(new Date(2026, 9, 2, 16, 40).toISOString(), now), "Fri 4:40 pm");
assert.strictEqual(T.formatOpenWhen(new Date(2026, 8, 30, 20, 31).toISOString(), now), "Sep 30, 8:31 pm");
assert.strictEqual(T.formatOpenWhen("nope", now), ""); ok("when formatting");

// linkOpenState
const since = "2026-10-07T00:00:00";
const iso = (d, h = 12) => new Date(2026, 9, d, h, 0).toISOString();
let s = T.linkOpenState({ opens: 6, lastAt: new Date(2026, 9, 7, 9, 12).toISOString(), devices: { a: {}, b: {} } }, iso(2), now, since);
deq([s.state, s.label], ["on", "Opened 6× · 2 devices · last today 9:12 am"]); ok("on: many opens");
s = T.linkOpenState({ opens: 1, lastAt: new Date(2026, 9, 2, 16, 40).toISOString(), devices: { a: {} } }, null, now, since);
deq([s.state, s.label], ["once", "Opened once · Fri 4:40 pm"]); ok("once: stale single open, no createdAt needed");
s = T.linkOpenState({ opens: 3, lastAt: new Date(now - 3 * 86400000 + 60000).toISOString(), devices: { a: {} } }, null, now, since);
assert.strictEqual(s.state, "on"); ok("just under 3 days stays green");
s = T.linkOpenState({ opens: 3, lastAt: new Date(now - 3 * 86400000).toISOString(), devices: { a: {} } }, null, now, since);
deq([s.state, s.label.startsWith("Opened 3× · 1 device · last ")], ["once", true]); ok("3 days exactly turns blue, singular device");
s = T.linkOpenState(undefined, null, now, since);
deq([s.state, s.label], ["pre", "No opens since Oct 7"]); ok("no createdAt -> pre");
s = T.linkOpenState({}, "2026-09-12T10:00:00.000Z", now, since);
assert.strictEqual(s.state, "pre"); ok("made before tracking -> pre");
const nowLate = new Date(2026, 9, 14, 15, 0).getTime();
s = T.linkOpenState(null, iso(10, 9), nowLate, since);
deq([s.state, s.label], ["late", "Not opened · sent 4 days ago"]); ok("late after 3+ days");
s = T.linkOpenState(null, iso(7, 9), now, since);
deq([s.state, s.label], ["none", "Not opened yet · sent today"]); ok("none: sent today");
s = T.linkOpenState(null, iso(8, 9), new Date(2026, 9, 9, 8, 0).getTime(), since);
deq([s.state, s.label], ["none", "Not opened yet · sent yesterday"]); ok("none: sent yesterday");
s = T.linkOpenState({ opens: 0 }, iso(7, 9), now, since);
assert.strictEqual(s.state, "none"); ok("opens:0 entry treated as unopened");

console.log(`linkopens-test: ${n} passed`);
