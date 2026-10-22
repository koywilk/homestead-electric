#!/usr/bin/env node
/* livesave-loop-test.js — gate for the mobile rich-text sheet's live-save
 * (v558, 2026-10-22). Keegan: typing in Rough Notes on his phone, "when I stop
 * typing part of what I typed disappears."
 *
 * Root cause: RichMobileSheet's live-save effect listed `onLiveSave` in its
 * deps; every TA call site passes a fresh arrow, and the live-save itself
 * re-renders the parent, so the first 400 ms pause started a loop — a phantom
 * save every ~0.4 s for as long as the sheet was open, each one re-rendering
 * the whole app, rewriting hejobs_backup and re-arming saveJob's 500 ms
 * debounce (the real Firestore write never went out while the box was open).
 *
 * The REAL components (RichEditor, RichMobileSheet, TA) are cut out of
 * src/App.js, compiled with the app's own Babel preset and mounted in jsdom
 * under a replica of JobDetail.u() -> updateJob -> saveJob (500 ms debounce,
 * in-flight queue). Proves:
 *   1. PAUSE — after typing stops, exactly one live-save fires and the write
 *      reaches the (fake) server; no further saves while the sheet sits idle.
 *   2. OPEN — opening the sheet on unchanged text sends nothing.
 *   3. DONE — text typed after the pause is committed in full on Done.
 *   4. DRAFT — a restored localStorage draft (newer, different) still
 *      live-saves once, as it did before.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const REPO = path.join(__dirname, "..");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
const win = dom.window;
global.window = win; global.document = win.document;
Object.defineProperty(global, "navigator", { value: win.navigator, configurable: true, writable: true });
global.HTMLElement = win.HTMLElement; global.Node = win.Node; global.Event = win.Event;
global.localStorage = win.localStorage; global.getComputedStyle = win.getComputedStyle;
win.getSelection = () => ({ rangeCount: 0 });
global.requestAnimationFrame = (f) => setTimeout(f, 16);
global.IS_REACT_ACT_ENVIRONMENT = false;

const React = require("react");
const ReactDOM = require("react-dom/client");
const SafeHtml = require(path.join(REPO, "src", "sanitizeHtml.js"));
SafeHtml.configureSanitizer(win);

const src = fs.readFileSync(path.join(REPO, "src", "App.js"), "utf8");
const slice = (startRe, endRe) => {
  const s = src.search(startRe); if (s < 0) throw new Error("livesave-loop-test: start not found " + startRe);
  const e = src.slice(s).search(endRe); if (e < 0) throw new Error("livesave-loop-test: end not found " + endRe);
  return src.slice(s, s + e);
};
const chunk = [
  slice(/\nconst RichEditor = \(/, /\n\/\/ Mobile sheet wrapping/),
  slice(/\nconst MAT_SOURCES = /, /\nconst stripHtml = /),
  slice(/\nconst RichMobileSheet = \(/, /\n\/\/ Time ago helper/),
  slice(/\nconst TA = \(/, /\n\n\/\/ Clickable address/),
].join("\n");
const prelude = `
const { useState, useRef, useEffect, useMemo } = React;
const C = new Proxy({}, { get: () => '#888' });
const RICH_COLORS = ["#C62828","#2F5BD9"];
const ON_MOBILE = true;
const safeHtml = SafeHtml.sanitizeHtml, safeProps = SafeHtml.sanitizeProps;
const heTrack = () => {};
`;
const code = babel.transformSync(prelude + chunk + "\nmodule.exports = { TA };", {
  presets: [[require.resolve("@babel/preset-react"), { runtime: "classic" }]], babelrc: false, configFile: false,
}).code;
const mod = { exports: {} };
new Function("module", "exports", "React", "SafeHtml", "localStorage", "document", "window", code)(mod, mod.exports, React, SafeHtml, win.localStorage, win.document, win);
const { TA } = mod.exports;

// ── Replica of the app's save timing: JobDetail.u -> updateJob -> saveJob ──
const TAB_ID = "tab_test";
function makeWorld() {
  const w = { uCalls: 0, writes: [], server: { roughNotes: "", updated_at: "t0" }, pending: {}, timers: {}, seq: 0 };
  w.saveJob = (job, patch) => {
    if (patch) w.pending[job.id] = { ...(w.pending[job.id] || {}), ...patch };
    clearTimeout(w.timers[job.id]);
    w.timers[job.id] = setTimeout(async () => {
      w.timers[job.id] = null;
      const acc = { ...(w.pending[job.id] || {}) };
      if (!Object.keys(acc).length) return;
      const n = ++w.seq;
      await new Promise(r => setTimeout(r, 150));
      w.server = { ...w.server, ...acc, updated_at: "t" + n, _tab: TAB_ID };
      w.writes.push(acc.roughNotes);
      Object.keys(acc).forEach(k => { if (w.pending[job.id] && w.pending[job.id][k] === acc[k]) delete w.pending[job.id][k]; });
    }, 500);
  };
  return w;
}
function Detail({ job: rawJob, onUpdate, world, draftKey }) {
  const [job, setJob] = React.useState(rawJob);
  const jobRef = React.useRef(job);
  React.useEffect(() => { jobRef.current = job; }, [job]);
  React.useEffect(() => {
    if (rawJob._tab === TAB_ID && rawJob.roughNotes === jobRef.current.roughNotes) return;
    setJob(rawJob);
  }, [rawJob.updated_at]);   // eslint-disable-line
  const u = (patch) => { world.uCalls++; const updated = { ...jobRef.current, ...patch }; jobRef.current = updated; setJob(updated); onUpdate(updated, patch); };
  return React.createElement(TA, { value: job.roughNotes, onChange: e => u({ roughNotes: e.target.value }), placeholder: "Document…", rows: 5, draftKey });
}
function App({ world, initial, draftKey }) {
  const [selected, setSelected] = React.useState({ id: "j1", roughNotes: initial, updated_at: "t0" });
  const updateJob = (updated, patch) => { setSelected(s => s && s.id === updated.id ? updated : s); world.saveJob(updated, patch); };
  return React.createElement(Detail, { job: selected, onUpdate: updateJob, world, draftKey });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fire = (el, type, Ctor = win.Event) => el.dispatchEvent(new Ctor(type, { bubbles: true }));
async function typeText(ed, text, gapMs) {
  for (const ch of text) { ed.innerHTML = ed.innerHTML + ch; fire(ed, "input"); await sleep(gapMs); }
}
async function mount(world, initial, draftKey) {
  const host = win.document.getElementById("root");
  const root = ReactDOM.createRoot(host);
  root.render(React.createElement(App, { world, initial, draftKey }));
  await sleep(30);
  fire(host.querySelector("div"), "click", win.MouseEvent);   // the TA tap target opens the sheet
  await sleep(30);
  const ed = win.document.querySelector("[contenteditable]");
  assert(ed, "sheet editor not mounted");
  fire(ed, "focusin", win.FocusEvent);
  return { root, ed, host };
}
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

(async () => {
  // 1 + 2 + 3 — open on unchanged text, type, pause, keep typing, Done.
  {
    const world = makeWorld();
    const { root, ed, host } = await mount(world, "Panel on the east wall");
    await sleep(900);
    ok(world.uCalls === 0, `OPEN: opening the sheet on unchanged text must send nothing (got ${world.uCalls} saves)`);
    await typeText(ed, ", GC wants it moved", 25);
    await sleep(1600);                     // Keegan stops typing
    ok(world.uCalls === 1, `PAUSE: exactly one live-save after the pause (got ${world.uCalls})`);
    ok(world.writes.length === 1 && world.writes[0] === "Panel on the east wall, GC wants it moved",
      `PAUSE: the write must reach the server while the sheet is open (writes: ${JSON.stringify(world.writes)})`);
    await sleep(1200);                     // still idle
    ok(world.uCalls === 1, `IDLE: no phantom saves while the sheet sits open (got ${world.uCalls})`);
    await typeText(ed, " to the garage", 25);
    const done = [...win.document.querySelectorAll("button")].find(b => b.textContent === "Done");
    fire(done, "click", win.MouseEvent);
    await sleep(900);
    ok(world.server.roughNotes === "Panel on the east wall, GC wants it moved to the garage",
      `DONE: full text committed (server has "${world.server.roughNotes}")`);
    ok(host.querySelector("div").textContent === "Panel on the east wall, GC wants it moved to the garage", "DONE: the box shows the full text");
    root.unmount(); await sleep(20);
  }
  // 4 — a restored draft (newer + different) still live-saves once.
  {
    const world = makeWorld();
    win.localStorage.setItem("he_taDraft_k1", JSON.stringify({ html: "draft text from before the reload", material: "", matSource: "", savedAt: Date.now() }));
    const { root } = await mount(world, "older server text", "k1");
    await sleep(900);
    ok(world.uCalls === 1, `DRAFT: a restored draft live-saves once (got ${world.uCalls})`);
    await sleep(900);
    ok(world.uCalls === 1, `DRAFT: and only once (got ${world.uCalls})`);
    root.unmount(); await sleep(20);
    win.localStorage.removeItem("he_taDraft_k1");
  }
  console.log(`livesave-loop-test: ${checks} checks passed`);
  process.exit(0);
})().catch(e => { console.error("livesave-loop-test FAILED:", e && e.message || e); process.exit(1); });
