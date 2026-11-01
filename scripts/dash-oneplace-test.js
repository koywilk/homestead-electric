#!/usr/bin/env node
/* dash-oneplace-test.js — One Place, ship 1 (v594). The push worker's tap routing runs for real in a vm;
 * the dashboard mounts are checked against the shipped source, so they can't quietly drift.
 *
 * Proves:
 *   1. PUSH ROUTING — setting off: exactly today's behavior (the app's window, the app's address). Setting on:
 *      only a job push moves to the dashboard; a task or view push never does. A dashboard window alone still
 *      gets the tap, so it isn't dropped.
 *   2. SAME SCREENS — /dashboard mounts the one job card, bell, quick-add, toast, version popups and save status
 *      the app mounts, and the app still mounts each of them.
 *   3. USAGE — a dashboard visit logs as "dash", never My Day.
 *   4. ROUTING — a view item on the dashboard goes to the app with its nid; the hand-off to /?jobId= is gone.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");
const root = path.join(__dirname, "..");
const sw = fs.readFileSync(path.join(root, "public", "firebase-messaging-sw.js"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");

const a = sw.indexOf("function notifClickPlan("), b = sw.indexOf('// Best-effort "the device displayed it" ping');
assert.ok(a > 0 && b > a, "notifClickPlan found in the push worker");
const sb = { URL, String };
vm.createContext(sb);
vm.runInContext(sw.slice(a, b) + "\n;globalThis.plan = notifClickPlan;", sb);
const O = "https://x.app", appW = { url: O + "/" }, dashW = { url: O + "/dashboard" }, other = { url: "https://other.app/dashboard" };
const job = { jobId: "1", view: "" }, task = { jobId: "", view: "myday" }, jobUrl = O + "/?jobId=1&section=Rough&nid=9", taskUrl = O + "/?view=myday&need=2";
const P = (w, t, u, on) => { const r = sb.plan(w, t, u, on, O); return { c: r.client, u: r.url }; };

// Setting off: the app, as before.
assert.strictEqual(P([], job, jobUrl, false).u, jobUrl);
assert.strictEqual(P([dashW, appW], job, jobUrl, false).c, appW);
assert.strictEqual(P([dashW], job, jobUrl, false).c, dashW, "the only open window still gets it");
assert.strictEqual(P([other], job, jobUrl, false).c, null, "another site's window is never used");
// Setting on: a job push moves, keeping section and nid.
assert.strictEqual(P([], job, jobUrl, true).u, O + "/dashboard?jobId=1&section=Rough&nid=9");
assert.strictEqual(P([appW, dashW], job, jobUrl, true).c, dashW);
assert.strictEqual(P([appW], job, jobUrl, true).c, appW, "no dashboard open: the app window handles it in place");
// Setting on: a task push never moves.
assert.strictEqual(P([], task, taskUrl, true).u, taskUrl);
assert.strictEqual(P([dashW, appW], task, taskUrl, true).c, appW);
// An address we don't recognize is left alone.
assert.strictEqual(P([], job, O + "/", true).u, O + "/");
// Trouble reading the setting means the app.
assert.ok(/setTimeout\(\(\) => resolve\(false\), 400\)/.test(sw), "a stuck read can't hold up a tap");

const dashStart = app.indexOf("  if (IS_DASH_PAGE) {\n    const dashOk");
assert.ok(dashStart > 0, "dashboard return found");
const dash = app.slice(dashStart, app.indexOf("\n  }\n", dashStart));
["{jobDrawer}", "{quickAddSheet}", "{versionLockUi}", "{pushToastEl}", "{inboxOverlays}", "{inboxBellBtn}", "{saveHud}", "<HEPhotoLightboxHost/>", "appGlobalStyle", "ProjectsCtx.Provider", "openJobById(job.id, section)"].forEach(x =>
  assert.ok(dash.includes(x), "dashboard mounts " + x));
const main = app.slice(app.indexOf("\n", app.indexOf("</ProjectsCtx.Provider>", dashStart) + 30));
["{jobDrawer}", "{quickAddSheet}", "{versionLockUi}", "{pushToastEl}", "{inboxOverlays}", "{inboxBellBtn}", "{saveHud}", "{appGlobalStyle}"].forEach(x =>
  assert.ok(main.includes(x), "the app still mounts " + x));

assert.ok(app.includes('logUsage("views", IS_DASH_PAGE ? "dash" : view)'), "usage key");
assert.ok(app.includes('if (view !== "myday" || IS_DASH_PAGE) return;'), "no My Day open counted on the dashboard");
assert.ok(!app.includes('window.location.href = "/?jobId="'), "the reload hand-off is gone");
assert.ok(/IS_DASH_PAGE\) \{\s*\n\s*if \(item\.view\) window\.location\.href = `\/\?view=/.test(app), "view items go to the app");
assert.ok(/&nid=\$\{encodeURIComponent\(item\.id\)\}/.test(app), "and carry the nid");

console.log("dash-oneplace-test: all checks passed");
