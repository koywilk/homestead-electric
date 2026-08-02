// Reproduces the pre-ship blocker and proves the fix, by running the CURRENT
// function bodies extracted from src/App.js across simulated sessions.
//
// The bug: TAB_ID is regenerated on every page load and persistPending only ever
// deleted its OWN slot, so a session that died before its write confirmed left a
// slot no future session could remove — replayed to Firestore on every launch,
// forever, each time with no merge baseline (union semantics => deleted punch
// items resurrect, stale scalars overwrite newer ones).
const fs = require("fs");
const vm = require("vm");

const APP = require("path").join(__dirname, "..", "src", "App.js");
const src = fs.readFileSync(APP, "utf8");

// Pull the CURRENT bodies out of App.js so this can never test a stale copy.
function extract(startMarker) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error("not found: " + startMarker);
  const b = src.indexOf("\n  }, []);", a);
  if (b === -1) throw new Error("end not found for: " + startMarker);
  return src.slice(a, b + "\n  }, []);".length);
}
const adoptSrc = extract("const adoptPersistedPending = useCallback(() => {");
const persistSrc = extract("const persistPending = useCallback(() => {");

function backdate(store, ms) {
  const d = store.dump(); if (!d) return;
  Object.keys(d).forEach(k => { d[k].at = Date.now() - ms; });
  store.api.setItem("he_pending_patches", JSON.stringify(d));
}

function makeStore() {
  const store = {};
  return {
    api: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    dump: () => (store["he_pending_patches"] ? JSON.parse(store["he_pending_patches"]) : null),
  };
}

// One "page load": fresh TAB_ID, shared localStorage, real function bodies.
function session(store, tabId, pending) {
  const sandbox = {
    PENDING_KEY: "he_pending_patches",
    PENDING_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    TAB_ID: tabId,
    localStorage: store.api,
    console: { warn() {}, log() {} },
    useCallback: fn => fn,
    pendingPatches: { current: pending },
    Date,
    JSON,
    Object,
    Infinity,
    out: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${adoptSrc}\n${persistSrc}\nout.adopt = adoptPersistedPending; out.persist = persistPending;`,
    sandbox
  );
  return { adopt: sandbox.out.adopt, persist: sandbox.out.persist, pp: sandbox.pendingPatches };
}

let fails = 0;
const check = (name, cond, detail) => {
  if (cond) console.log("  ok   " + name);
  else { fails++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
};

const store = makeStore();

console.log("\n1. A session dies offline with an unsynced edit");
{
  const s = session(store, "tab_crashed", { job1: { roughNotes: "edit with no signal" } });
  s.persist();                       // the synchronous mirror saveJob performs
  backdate(store, 60000);   // the tab died a minute ago
  check("its slot is durably stored", "tab_crashed" in (store.dump() || {}), JSON.stringify(store.dump()));
}
// ...the tab is killed. tab_crashed never runs again.

console.log("\n2. Three later launches, each with a NEW random TAB_ID");
{
  let last = null;
  ["tab_a", "tab_b", "tab_c"].forEach(tab => {
    const s = session(store, tab, {});
    const ids = Object.keys(s.adopt());
    if (tab === "tab_a") check("first launch rescues the edit", ids.includes("job1"), JSON.stringify(ids));
    else check(`launch ${tab} does NOT re-adopt it (this was the infinite replay)`, ids.length === 0, JSON.stringify(ids));
    s.pp.current = {};               // server confirmed the replay
    s.persist();
    last = store.dump();
  });
  check("orphan slot is gone", last === null || !("tab_crashed" in last), JSON.stringify(last));
  check("storage cleared once nothing is pending", last === null, JSON.stringify(last));
}

console.log("\n3. Ownership transfer is atomic (a kill mid-adopt loses nothing)");
{
  const st = makeStore();
  session(st, "tab_dead", { job9: { finishNotes: "x" } }).persist();
  backdate(st, 60000);
  session(st, "tab_new", {}).adopt();          // adopt, then die before replaying
  const tabs = Object.keys(st.dump() || {});
  check("work still durable after adopt", tabs.length === 1, JSON.stringify(tabs));
  check("…now owned by the live session", tabs[0] === "tab_new", JSON.stringify(tabs));
  // tab_new stamped its slot fresh on adoption, so a session starting in the
  // same instant correctly leaves it alone (live sibling). Once that session is
  // also gone, the slot ages out and the next launch rescues it.
  backdate(st, 60000);
  check("a later session can still rescue it",
    Object.keys(session(st, "tab_next", {}).adopt()).includes("job9"));
}

console.log("\n4. A live sibling tab's work is not stolen");
{
  const st = makeStore();
  session(st, "tab_live", { job5: { a: 1 } }).persist();      // fresh timestamp
  check("recent foreign slot left alone", Object.keys(session(st, "tab_other", {}).adopt()).length === 0);
  check("…and still present in storage", "tab_live" in (st.dump() || {}));
}

console.log("\n5. Ancient slots are discarded rather than replayed");
{
  const st = makeStore();
  st.api.setItem("he_pending_patches", JSON.stringify({
    tab_ancient: { at: Date.now() - 8 * 24 * 60 * 60 * 1000, patches: { job7: { x: 1 } } },
  }));
  check("8-day-old slot not replayed", Object.keys(session(st, "tab_now", {}).adopt()).length === 0);
  check("…and removed from storage", st.dump() === null, JSON.stringify(st.dump()));
}

console.log("");
if (fails) { console.error(`orphan-test: ${fails} FAILURE(S)\n`); process.exit(1); }
console.log("orphan-test: all checks passed\n");
