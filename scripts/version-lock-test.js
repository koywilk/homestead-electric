// Version Lock (08-Specs/Version Lock Spec.md) — Phase 1 harness. Prebuild-wired.
//
// Runs the CURRENT function bodies extracted from src/App.js (never a stale
// copy), the same way pending-queue-test.js does:
//   1. unit: parseAppBuild, stampWrite, isVersionRefusal, reportWriteDenied
//   2. THE correctness point the spec gates enforcement on: a permission-denied
//      on a job save KEEPS the patch in pendingPatches AND he_pending_patches,
//      and the next session (after "Update now") replays it ONCE, stamped
//      with the new build, through the same transactional funnel
//   3. flushJob / flushSaves refusal → patch back in the queue, popup raised
//   4. a non-version denial keeps today's retry and never raises the popup
//   5. static sweep: every client write to jobs / needs / redlineWalks in
//      App.js is stamped, except the named console rescue utilities
//   6. functions/versionLock.js: classifier + stats fold
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const APP = path.join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP, "utf8");

let fails = 0;
const check = (name, cond, detail) => {
  if (cond) console.log("  ok   " + name);
  else { fails++; console.error("  FAIL " + name + (detail !== undefined ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "")); }
};

// ── live extraction ─────────────────────────────────────────────────────────
function between(startMarker, endMarker, { inclusiveEnd = false } = {}) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error("not found: " + startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  if (b === -1) throw new Error("end not found for: " + startMarker);
  return src.slice(a, inclusiveEnd ? b + endMarker.length : b);
}
// A component-scope function: from its `const name = …` line to the last
// top-level `\n  };` before the next landmark.
function componentFn(startMarker, nextLandmark) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error("not found: " + startMarker);
  const lim = src.indexOf(nextLandmark, a);
  if (lim === -1) throw new Error("landmark not found: " + nextLandmark);
  const region = src.slice(a, lim);
  const end = region.lastIndexOf("\n  };");
  if (end === -1) throw new Error("no closing for: " + startMarker);
  return region.slice(0, end + "\n  };".length);
}
const helpersSrc = between("// VERSION_LOCK_HELPERS_START", "// VERSION_LOCK_HELPERS_END");
const refusalSrc = between("const _versionLock = {", "  return true;\n};", { inclusiveEnd: true });
const persistSrc = between("const persistPending = useCallback(() => {", "\n  }, []);", { inclusiveEnd: true });
const adoptSrc = between("const adoptPersistedPending = useCallback(() => {", "\n  }, []);", { inclusiveEnd: true });
const saveJobSrc = componentFn("const saveJob = (job, patch) => {", "\n  // RECONNECT FLUSH:");
const flushJobSrc = componentFn("const flushJob = async (job) => {", "\n  const deleteJobRemote = async");
const flushSavesSrc = componentFn("const flushSaves = () => {", "\n  // Save on background/close");

// ── fakes ───────────────────────────────────────────────────────────────────
function makeStore() {
  const store = {};
  return {
    api: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    dump: () => (store["he_pending_patches"] ? JSON.parse(store["he_pending_patches"]) : null),
    raw: store,
  };
}
const DENY = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

// One page load. `version` is the bundle's REACT_APP_VERSION; `gate` is what
// getDoc(appGate/version) answers (number, or "unreadable" before Phase 2).
function session({ tabId, version, gate, local, sess, pending = {}, txMode = "ok", serverData = { name: "Job 1" } }) {
  const timers = []; let tid = 0;
  const writes = []; const events = { refusal: [], getDocCalls: 0, toasts: [] };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    process: { env: { REACT_APP_VERSION: version } },
    Math, JSON, Object, Date, Number, String, Array, Promise, Error, Infinity, parseInt, RegExp,
    setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    localStorage: local.api,
    sessionStorage: sess.api,
    useCallback: fn => fn,
    PENDING_KEY: "he_pending_patches",
    PENDING_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    TAB_ID: tabId,
    PL_INTENT_KEY: "_plIntent",
    plMergeIntents: (a, b) => b,
    pendingPatches: { current: pending },
    saveTimers: { current: {} },
    serverBaselines: { current: {} },
    upcomingSaveTimer: { current: null },
    flushUpcoming: () => {},
    jobsRef: { current: [{ id: "job1", name: "Job 1" }] },
    initialLoad: { current: false },
    isDirty: { current: false },
    identity: { name: "Tester" },
    setSyncStatus: () => {}, setAllJobs: () => {}, setSelected: () => {}, heSaveRipple: () => {},
    publishCcChangeOrders() {}, publishCcQuestions() {}, publishCcHomeruns() {},
    toast: { error: (m) => events.toasts.push(m), success() {}, warn() {} },
    sanitize: (o) => JSON.parse(JSON.stringify(o)),
    serverTimestamp: () => "<serverTimestamp>",
    db: {}, doc: (db, coll, id) => ({ coll, id }),
    getDoc: async () => { events.getDocCalls++; if (gate === "unreadable") throw DENY(); return { exists: () => gate !== "missing", data: () => ({ minBuild: gate }) }; },
    _mergePatchAgainstServer: (jobId, name, cleanPatch) => { const o = {}; Object.keys(cleanPatch).forEach(k => { o["data." + k] = cleanPatch[k]; }); return o; },
    _advanceMergeBaseline: () => {},
    runTransaction: async (db, fn) => {
      const tx = {
        get: async (ref) => ({ exists: () => true, data: () => ({ data: serverData }) }),
        set: (ref, payload) => writes.push({ op: "set", ref, payload }),
        update: (ref, payload) => writes.push({ op: "update", ref, payload }),
      };
      await fn(tx);
      if (txMode === "deny") throw DENY();
      if (txMode === "offline") throw Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" });
    },
    out: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${helpersSrc}\n${refusalSrc}\n_versionLock.onRefusal = (m) => out.refusal.push(m);\n` +
    `${persistSrc}\n${adoptSrc}\n${saveJobSrc}\n${flushJobSrc}\n${flushSavesSrc}\n` +
    `out.saveJob = saveJob; out.flushJob = flushJob; out.flushSaves = flushSaves; out.adopt = adoptPersistedPending; out.persist = persistPending;` +
    `out.parseAppBuild = parseAppBuild; out.stampWrite = stampWrite; out.isVersionRefusal = isVersionRefusal; out.isPermissionDenied = isPermissionDenied; out.reportWriteDenied = reportWriteDenied; out.APP_BUILD = APP_BUILD;`,
    sandbox
  );
  sandbox.out.refusal = events.refusal;
  // Runs the timers armed so far (one "tick"), not the ones they arm — a
  // refused save re-arms a 5 s retry, which must stay visible to the checks.
  const flushTimers = async () => { const batch = timers.splice(0); for (const t of batch) await t.fn(); };
  const settle = () => new Promise(r => setImmediate(r));
  return { ...sandbox.out, sb: sandbox, timers, writes, events, flushTimers, settle, pp: sandbox.pendingPatches, saveTimers: sandbox.saveTimers };
}

(async () => {
  console.log("\n1. Build parse + stamp + refusal detection");
  {
    const s = session({ tabId: "t", version: "homestead-v514", gate: 0, local: makeStore(), sess: makeStore() });
    check("homestead-v514 → 514", s.parseAppBuild("homestead-v514") === 514);
    check("homestead-v1 → 1", s.parseAppBuild("homestead-v1") === 1);
    check("junk → 0", s.parseAppBuild("junk") === 0);
    check("empty / undefined → 0", s.parseAppBuild("") === 0 && s.parseAppBuild(undefined) === 0);
    check("APP_BUILD derived from REACT_APP_VERSION", s.APP_BUILD === 514);
    const p = { data: { a: 1 }, updated_at: "x" };
    const w1 = s.stampWrite(p), w2 = s.stampWrite(p);
    check("stampWrite sets app_build as an int", Number.isInteger(w1.app_build) && w1.app_build === 514);
    check("stampWrite sets w = '<build>.<8 chars>'", /^514\.[a-z0-9]{8}$/.test(w1.w), w1.w);
    check("w is fresh on every write", w1.w !== w2.w);
    check("payload kept, input not mutated", w1.data === p.data && w1.updated_at === "x" && !("w" in p));
    check("stampWrite(undefined) still stamps", Number.isInteger(s.stampWrite(undefined).app_build));
    const deny = DENY();
    check("permission-denied + minBuild above build → version refusal", s.isVersionRefusal(deny, 600) === true);
    check("permission-denied + minBuild == build → not a version refusal", s.isVersionRefusal(deny, 514) === false);
    check("permission-denied + minBuild 0 (kill switch) → not", s.isVersionRefusal(deny, 0) === false);
    check("permission-denied + unknown minBuild → not", s.isVersionRefusal(deny, null) === false && s.isVersionRefusal(deny, undefined) === false);
    check("other error codes → not", s.isVersionRefusal({ code: "unavailable", message: "offline" }, 600) === false);
    check("message-only denial is recognised", s.isPermissionDenied({ message: "PERMISSION_DENIED: nope" }) === true);
  }

  console.log("\n2. reportWriteDenied reads the gate and raises the popup only for a version refusal");
  {
    const a = session({ tabId: "t", version: "homestead-v514", gate: 600, local: makeStore(), sess: makeStore() });
    check("gate 600 > build 514 → true + popup", (await a.reportWriteDenied(DENY(), "jobs", "j")) === true && a.events.refusal[0] === 600);
    const b = session({ tabId: "t", version: "homestead-v514", gate: 500, local: makeStore(), sess: makeStore() });
    check("gate 500 ≤ build 514 → false, no popup", (await b.reportWriteDenied(DENY(), "jobs", "j")) === false && b.events.refusal.length === 0);
    const c = session({ tabId: "t", version: "homestead-v514", gate: "unreadable", local: makeStore(), sess: makeStore() });
    check("gate unreadable (Phase 1 rules) → false, never throws", (await c.reportWriteDenied(DENY(), "jobs", "j")) === false);
    const d = session({ tabId: "t", version: "homestead-v514", gate: 600, local: makeStore(), sess: makeStore() });
    check("non-denial error → false without reading the gate", (await d.reportWriteDenied({ code: "unavailable", message: "x" }, "jobs", "j")) === false && d.events.getDocCalls === 0);
  }

  console.log("\n3. THE funnel proof: a refused job save keeps the patch, and the next build replays it once");
  const local = makeStore(), sess = makeStore();
  const job = { id: "job1", name: "Job 1", roughNotes: "old" };
  {
    const s1 = session({ tabId: "tab_old", version: "homestead-v514", gate: 600, local, sess, txMode: "deny" });
    s1.saveJob(job, { roughNotes: "typed on the old build" });
    check("patch queued in pendingPatches before any network work", s1.pp.current.job1 && s1.pp.current.job1.roughNotes === "typed on the old build");
    check("…and mirrored to he_pending_patches", (local.dump() || {}).tab_old && local.dump().tab_old.patches.job1.roughNotes === "typed on the old build", local.dump());
    await s1.flushTimers();            // the 500 ms debounce fires → transaction → refused
    const attempted = s1.writes.find(w => w.op === "update");
    check("the attempt was stamped with the OLD build (514) and a w", attempted && attempted.payload.app_build === 514 && /^514\./.test(attempted.payload.w), attempted && attempted.payload);
    check("server refused it (permission-denied) → patch STILL in pendingPatches", s1.pp.current.job1 && s1.pp.current.job1.roughNotes === "typed on the old build", s1.pp.current);
    check("…and STILL in he_pending_patches", local.dump() && local.dump().tab_old && local.dump().tab_old.patches.job1.roughNotes === "typed on the old build", local.dump());
    check("popup raised with the gate's minimum (600)", s1.events.refusal[0] === 600, s1.events.refusal);
    check("no 5 s retry armed for a version refusal (would be refused again)", s1.timers.length === 0, s1.timers.length);
    // "Update now": flushSaves finds nothing armed (saveTimers cleared), hands the queue over, reloads.
    s1.flushSaves();
    sess.api.setItem("he_pending_handoff", "tab_old");
  }
  {
    // Same slot would NOT be adopted by a stranger session within 20 s (live-sibling rule)…
    const stranger = session({ tabId: "tab_stranger", version: "homestead-v600", gate: 600, local, sess: makeStore() });
    check("without the handoff marker a fresh slot is left alone (live-sibling rule — why the handoff exists)", Object.keys(stranger.adopt()).length === 0);
    // …but the session that REPLACES the old tab after Update now carries the marker.
    const s2 = session({ tabId: "tab_new", version: "homestead-v600", gate: 600, local, sess, txMode: "ok" });
    const restored = s2.adopt();
    check("after the Update now reload the new session adopts the queue immediately", restored.job1 && restored.job1.roughNotes === "typed on the old build", restored);
    check("handoff marker consumed", sess.api.getItem("he_pending_handoff") === null);
    check("slot re-keyed under the new session (ownership transferred)", local.dump() && local.dump().tab_new && !local.dump().tab_old, local.dump());
    s2.pp.current = restored;         // what the App's restore block does with adopt()'s result
    s2.sb.pendingPatches.current = restored;
    // Startup drain → saveJob(job, patch) through the normal funnel
    s2.saveJob(job, { ...restored.job1 });
    await s2.flushTimers();
    const ups = s2.writes.filter(w => w.op === "update");
    check("replayed exactly once", ups.length === 1, ups.length);
    check("replay carries the NEW build (600) and a fresh w", ups[0] && ups[0].payload.app_build === 600 && /^600\.[a-z0-9]{8}$/.test(ups[0].payload.w), ups[0] && ups[0].payload);
    check("replay writes the kept edit", ups[0] && ups[0].payload["data.roughNotes"] === "typed on the old build");
    check("server confirmed → pendingPatches cleared", !s2.sb.pendingPatches.current.job1, s2.sb.pendingPatches.current);
    check("…and he_pending_patches cleared", local.dump() === null, local.dump());
    check("no popup on the new build", s2.events.refusal.length === 0);
  }

  console.log("\n4. flushJob / flushSaves refusals put the patch back and raise the popup");
  {
    const l = makeStore();
    const s = session({ tabId: "tab_f", version: "homestead-v514", gate: 600, local: l, sess: makeStore(), txMode: "deny" });
    s.saveJob(job, { finishNotes: "half done" });          // arms the timer
    await s.flushJob(job);                                   // close-flush → refused
    await s.settle();
    check("flushJob: patch back in pendingPatches", s.pp.current.job1 && s.pp.current.job1.finishNotes === "half done", s.pp.current);
    check("flushJob: patch persisted", l.dump() && l.dump().tab_f && l.dump().tab_f.patches.job1.finishNotes === "half done", l.dump());
    check("flushJob: popup raised", s.events.refusal.length === 1);
    const l2 = makeStore();
    const t = session({ tabId: "tab_g", version: "homestead-v514", gate: 600, local: l2, sess: makeStore(), txMode: "deny" });
    t.saveJob(job, { roughNotes: "tab switch" });
    t.flushSaves();                                          // visibilitychange → refused (async .catch)
    await t.settle(); await t.settle(); await t.settle();
    check("flushSaves: patch back in pendingPatches", t.pp.current.job1 && t.pp.current.job1.roughNotes === "tab switch", t.pp.current);
    check("flushSaves: patch persisted", l2.dump() && l2.dump().tab_g && l2.dump().tab_g.patches.job1.roughNotes === "tab switch", l2.dump());
    check("flushSaves: popup raised", t.events.refusal.length === 1);
  }

  console.log("\n5. A denial that is NOT a version refusal keeps today's behaviour");
  {
    const s = session({ tabId: "tab_h", version: "homestead-v514", gate: 500, local: makeStore(), sess: makeStore(), txMode: "deny" });
    s.saveJob(job, { roughNotes: "x" });
    await s.flushTimers();
    check("patch kept", s.pp.current.job1 && s.pp.current.job1.roughNotes === "x");
    check("retry re-armed (5 s)", s.timers.length === 1 && s.timers[0].ms === 5000, s.timers.map(t => t.ms));
    check("no popup", s.events.refusal.length === 0);
    const o = session({ tabId: "tab_i", version: "homestead-v514", gate: 600, local: makeStore(), sess: makeStore(), txMode: "offline" });
    o.saveJob(job, { roughNotes: "y" });
    await o.flushTimers();
    check("offline failure: patch kept, retry armed, no popup, gate never read", o.pp.current.job1 && o.timers.length === 1 && o.events.refusal.length === 0 && o.events.getDocCalls === 0);
  }

  console.log("\n6. Static sweep: every client write to the locked collections is stamped");
  {
    const lines = src.split("\n");
    const RESCUE = /window\.__HE_RESTORE|_hsRescueDataUrlPhotos|__HE_BULK_ADD_LOADS/;
    // The console utilities are long (the photo rescue's write sits ~140 lines
    // below its `window._hsRescueDataUrlPhotos =` header), hence the reach.
    const nearRescue = (i) => lines.slice(Math.max(0, i - 220), i + 1).some(l => RESCUE.test(l));
    const direct = [], unstampedDirect = [], rescue = [];
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      if (/(updateDoc|setDoc)\(\s*doc\(\s*(db|window\.__HE_DB)\s*,\s*["'](jobs|needs|redlineWalks|manualTasks|quoteWalks)["']/.test(l)) {
        direct.push(i + 1);
        if (!/stampWrite\(/.test(l)) (nearRescue(i) ? rescue : unstampedDirect).push(i + 1);
      }
    });
    check(`direct updateDoc/setDoc writes found (${direct.length})`, direct.length >= 15, direct);
    check("every direct write outside the rescue utilities is stamped", unstampedDirect.length === 0, unstampedDirect);
    check("exactly the three console rescue writes stay unstamped (__HE_RESTORE, _hsRescueDataUrlPhotos, __HE_BULK_ADD_LOADS)", rescue.length === 3, rescue);
    // Transaction writers: tx.set / tx.update on a jobs/needs ref must be fed by a stampWrite'd meta within the same function.
    const txSites = [];
    lines.forEach((l, i) => { if (/tx\.(set|update)\(\s*(jref|ref)\s*,/.test(l)) txSites.push(i + 1); });
    const txUnstamped = txSites.filter(n => {
      const back = lines.slice(Math.max(0, n - 45), n).join("\n");
      const isLocked = /doc\(db,\s*["'](jobs|needs)["']/.test(back);
      return isLocked && !/stampWrite\(/.test(back);
    });
    check(`transaction writes on jobs/needs refs found (${txSites.length})`, txSites.length >= 9, txSites);
    check("every jobs/needs transaction write is stamped", txUnstamped.length === 0, txUnstamped);
    const loaderLine = lines.find(l => /const loaded = migrate\(snap\.docs\.map/.test(l)) || "";
    check("jobs loader builds from raw.data (stamp never reaches the in-memory job)", /\{\.\.\.raw\.data,/.test(loaderLine) && !/\{\.\.\.raw,/.test(loaderLine));
    check("manualTasks / quoteWalks have no client writer (nothing to stamp)", !lines.some(l => /(updateDoc|setDoc|runTransaction)[^\n]*["'](manualTasks|quoteWalks)["']/.test(l) && !/^\s*\/\//.test(l)));
  }

  console.log("\n7. functions/versionLock.js — classifier + stats fold");
  {
    const VL = require(path.join(__dirname, "..", "functions", "versionLock.js"));
    const base = { data: { name: "J", roughNotes: "a" }, updated_at: "t1", tab: "tab_x", app_build: 600, w: "600.aaaaaaaa" };
    check("fresh stamp → null (not counted)", VL.classifyUnstamped(base, { ...base, data: { ...base.data, roughNotes: "b" }, updated_at: "t2", w: "600.bbbbbbbb" }) === null);
    const old = VL.classifyUnstamped(base, { ...base, data: { ...base.data, roughNotes: "b" }, updated_at: "t2", tab: "tab_old", saved_by: "Keegan" });
    check("old build's updateDoc (w inherited, updated_at+tab changed) → client", old && old.kind === "client" && old.wSame === true && old.dataKeys.join() === "roughNotes", old);
    const heal = VL.classifyUnstamped(base, { ...base, data: { ...base.data, roughQuestions: [] } });
    check("auto-heal (no top-level meta changed) → server", heal && heal.kind === "server", heal);
    const drive = VL.classifyUnstamped(base, { ...base, data: { ...base.data, driveFolderId: "f1" }, updated_at: "t3" });
    check("Drive folder write (updated_at changed, data key server-owned) → server", drive && drive.kind === "server", drive);
    const create = VL.classifyUnstamped({}, { data: { name: "x" }, updated_at: "t", app_build: 600, w: "600.cccccccc" });
    check("stamped create → null", create === null);
    const strBuild = VL.classifyUnstamped(base, { ...base, updated_at: "t4", app_build: "600", w: "600.dddddddd" });
    check("app_build as a string counts as unstamped", strBuild && strBuild.kind === "client" && strBuild.app_build === null);
    let doc = VL.foldStats({}, "2026-10-07", { kind: "client", at: "a", jobId: "j1" });
    doc = VL.foldStats(doc, "2026-10-07", { kind: "server", at: "b", jobId: "j2" });
    doc = VL.foldStats(doc, "2026-10-07", { kind: "client", at: "c", jobId: "j3" });
    check("fold counts per kind per day", doc.days["2026-10-07"].client === 2 && doc.days["2026-10-07"].server === 1, doc);
    check("fold keeps the newest entries first, capped", doc.days["2026-10-07"].last[0].jobId === "j3" && doc.days["2026-10-07"].last.length === 3);
    let many = {}; for (let i = 0; i < 40; i++) many = VL.foldStats(many, "2026-01-" + String((i % 28) + 1).padStart(2, "0"), { kind: "client", at: "x" + i });
    check("fold prunes to 30 days", Object.keys(many.days).length <= 30);
    check("dayKey is YYYY-MM-DD in Denver", /^\d{4}-\d{2}-\d{2}$/.test(VL.dayKey("2026-10-07T05:30:00Z", "America/Denver")) && VL.dayKey("2026-10-07T05:30:00Z", "America/Denver") === "2026-10-06");
    // noteUnstampedJobWrite against a fake db
    const stored = {}; const logs = [];
    const fakeDb = { doc: (p) => ({ p }), runTransaction: async (fn) => fn({ get: async (r) => ({ exists: !!stored[r.p], data: () => stored[r.p] }), set: (r, v) => { stored[r.p] = v; } }) };
    const logger = { warn: (m, e) => logs.push(["warn", e]), info: (m, e) => logs.push(["info", e]) };
    const entry = await VL.noteUnstampedJobWrite(fakeDb, logger, { jobId: "j9", rawBefore: base, rawAfter: { ...base, updated_at: "t5", device: "dev_1" }, tz: "America/Denver", now: "2026-10-07T18:00:00Z" });
    check("telemetry writes settings/versionLockStats", entry && stored["settings/versionLockStats"] && stored["settings/versionLockStats"].days["2026-10-07"].client === 1, stored);
    check("telemetry logs a warning for a client-shaped write", logs[0] && logs[0][0] === "warn" && logs[0][1].jobId === "j9");
    const none = await VL.noteUnstampedJobWrite(fakeDb, logger, { jobId: "j9", rawBefore: base, rawAfter: { ...base, updated_at: "t6", w: "600.eeeeeeee" } });
    check("stamped write → no telemetry write", none === null && stored["settings/versionLockStats"].days["2026-10-07"].client === 1);
  }

  console.log("");
  if (fails) { console.error(`version-lock-test: ${fails} FAILURE(S)\n`); process.exit(1); }
  console.log("version-lock-test: all checks passed\n");
})().catch((e) => { console.error("version-lock-test crashed:", e && e.stack || e); process.exit(1); });
