# Link Opens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every share link records when it's opened, and the office sees "Opened 6× · 2 devices · last today 9:12 am" (or "Not opened yet") next to each link.

**Architecture:**
- A pure helper block in `src/App.js` decides what an open is, what it's called and how it's labeled. It's tested in Node by extracting the shipped code verbatim.
- One fire-and-forget recorder, called at the top of `App()` before the share-link routes, writes counters to a new `link_opens/{jobId}` doc.
- A small `LinkOpensLine` component, fed by an `onSnapshot` hook, renders the line in the two SAVED LINKS lists and under each one-link-per-job Share button.

**Tech Stack:** React (CRA) single-file app `src/App.js`, Firebase Firestore web SDK v9 modular (`doc`, `getDoc`, `setDoc`, `onSnapshot`, `increment`, all already imported on line 6), Firestore rules, Node `vm` test harness wired into `prebuild`.

**Spec:** `docs/superpowers/specs/2026-10-07-link-opens-design.md` · **Mockup (build target):** https://claude.ai/artifact/VVztH2GiyiiMFLmcRbaaN6

## Global Constraints

- Work only in this worktree: `/private/tmp/claude-501/-Users-koyhomestead-Desktop-homestead-electric/5c7c8398-01c2-401e-8628-b120aec6d08e/scratchpad/wt-linkopens`, branch `link-opens`. Never commit in `~/Desktop/homestead-electric`. Never `git add -A`; stage explicit files only.
- **Nothing is written to `jobs/{id}`.** The only new write target is `link_opens/{jobId}`.
- Throttle: same device + same link counts again only after **30 minutes**. Freshness: "on" (green) if last open is **< 3 days** old. "late" (red) if never opened and sent **≥ 3 days** ago.
- Skip staff devices: raw localStorage `he_identity` present OR `he_staff_device === "1"`. Skip `preview=1`. Skip `?lightinghub=`, `?appmap=`, the GC Portal.
- Link key = `<kind>:<shareId|base>`. Job notes use `jobnote:<noteId>`, and the share token is never stored.
- Device label = `<iPhone|iPad|Android|Mac|Windows|Other> · <Safari|Chrome|Edge|Firefox|Browser>`. No IP address, location or name.
- Colors from `C`: green `C.green` `#3E7D5A`, blue `C.blue` `#3B5BA5`, red `C.red` `#B23A3A`, hollow/dashed `C.muted`. **No yellow or amber.**
- Recorder and line never throw, never toast, never block render. Failures go to `console.warn("[HE link-opens] …")`. If the office snapshot errors, the line renders nothing.
- Display only: no pushes, no emails, no roll-up page.
- `CI=true npm run build` must pass. Never pipe the build (`| tail` masks a prebuild failure).
- Line numbers below were taken from `origin/main` @ `36ce984` and will drift. Always find code by the quoted anchor text, and confirm each anchor matches exactly once before editing.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/App.js` | modify | Helper block + recorder (near `_setUsageUser`), call in `App()`, staff-device flag, `useLinkOpens` / `LinkOpensLine` / `LinkOpens`, wiring into 8 surfaces |
| `scripts/linkopens-test.js` | create | Verbatim-extraction tests for the pure helpers |
| `package.json` | modify | Add `node scripts/linkopens-test.js` to `prebuild` |
| `firestore.rules` | modify | New `link_opens` block |
| `public/sops/*.html` | modify | Guides that show these share controls |
| `FEATURES.md`, `public/service-worker.js`, `docs/crew-briefs/vNNN.md` | modify/create | Ship bookkeeping (Task 5) |

---

### Task 1: Pure helpers and their test

**Files:**
- Modify: `src/App.js`. Insert directly **above** the comment line `// Who usage is counted for: set from the internal app shell's render (never` (about line 58985).
- Create: `scripts/linkopens-test.js`
- Modify: `package.json` (`prebuild`)

**Interfaces:**
- Produces (module-level in `App.js`, all between the markers `// ── Link opens helpers` and `// ── end Link opens helpers`):
  - `LINK_OPENS_SINCE: string` (local ISO, no zone), `LINK_OPEN_THROTTLE_MS = 1800000`, `LINK_OPEN_FRESH_MS = 259200000`, `LINK_KEY_SAFE: RegExp`
  - `linkOpenTarget(search: string) → { jobId: string, key: string } | null`
  - `isStaffDevice(getItem: (k)=>string|null) → boolean`
  - `shouldRecordOpen(lastIso: string|null, nowMs: number) → boolean`
  - `deviceLabel(ua: string) → string`
  - `formatOpenWhen(iso: string, nowMs: number) → string` ("today 9:12 am" / "yesterday 6:55 am" / "Fri 4:40 pm" / "Oct 4, 8:31 pm" / "")
  - `linkOpenState(entry: {opens,lastAt,firstAt,devices}|null|undefined, createdAt: string|null, nowMs: number, sinceIso: string) → { state: 'on'|'once'|'none'|'late'|'pre', label: string, opens: number, devices: number }`

- [ ] **Step 1: Write the failing test** at `scripts/linkopens-test.js`:

```js
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
  shouldRecordOpen, deviceLabel, formatOpenWhen, linkOpenState };`, ctx);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/linkopens-test.js`
Expected: exit 1 with `linkopens-test: helper markers not found in App.js`

- [ ] **Step 3: Insert the helper block** in `src/App.js`, directly above `// Who usage is counted for: set from the internal app shell's render (never`:

```js
// ── Link opens helpers ─────────────────────────────────────────────────────
// Share-link open tracking (spec: docs/superpowers/specs/2026-10-07-link-opens-design.md).
// Pure — tested verbatim by scripts/linkopens-test.js. The recorder and the
// office line below use these; nothing here touches Firestore.
const LINK_OPENS_SINCE = "2026-10-07T00:00:00";      // local; tracking start (set to ship day)
const LINK_OPEN_THROTTLE_MS = 30 * 60 * 1000;          // same device + link counts again after 30 min
const LINK_OPEN_FRESH_MS = 3 * 24 * 60 * 60 * 1000;    // green under 3 days; red when unopened 3+ days
const LINK_KEY_SAFE = /^[A-Za-z0-9_-]{1,64}$/;
// Same order as the routes at the top of App() — the first match is the page shown.
const LINK_OPEN_ROUTES = ["homeowner", "questions", "homeruns", "loads", "lighting", "lightinghub",
  "lutronshare", "roughpunch", "finishpunch", "qcpunch", "jobnote"];
const LINK_OPEN_NAMED = { questions: 1, roughpunch: 1, finishpunch: 1, qcpunch: 1 };
const linkOpenTarget = (search) => {
  let p;
  try { p = new URLSearchParams(search || ""); } catch (e) { return null; }
  if (p.get("preview") === "1") return null;
  for (const kind of LINK_OPEN_ROUTES) {
    const raw = p.get(kind);
    if (raw == null) continue;
    if (kind === "lightinghub") return null;
    if (kind === "jobnote") {
      const parts = String(raw).split(":");
      const jobId = (parts[0] || "").trim(), noteId = (parts[1] || "").trim();
      if (!jobId || jobId.length > 128 || jobId.includes("/") || !LINK_KEY_SAFE.test(noteId)) return null;
      return { jobId, key: "jobnote:" + noteId };
    }
    const jobId = String(raw).trim();
    if (!jobId || jobId.length > 128 || jobId.includes("/")) return null;
    const s = (p.get("s") || "").trim();
    const shareId = LINK_OPEN_NAMED[kind] && LINK_KEY_SAFE.test(s) ? s : "base";
    return { jobId, key: kind + ":" + shareId };
  }
  return null;
};
// A device that has ever been signed into the app is staff. Reads the raw
// identity key (IDENTITY_KEY) on purpose — getIdentity() deletes an expired one.
const isStaffDevice = (getItem) => {
  try { return !!(getItem("he_identity") || getItem("he_staff_device") === "1"); }
  catch (e) { return false; }
};
const shouldRecordOpen = (lastIso, nowMs) => {
  const t = Date.parse(lastIso || "");
  if (!isFinite(t)) return true;
  return nowMs - t >= LINK_OPEN_THROTTLE_MS || nowMs < t;
};
const deviceLabel = (ua) => {
  const s = String(ua || "");
  const dev = /iPad/.test(s) ? "iPad" : /iPhone|iPod/.test(s) ? "iPhone" : /Android/.test(s) ? "Android"
    : /Macintosh|Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : "Other";
  const br = /Edg(e|A|iOS)?\//.test(s) ? "Edge" : /Firefox\/|FxiOS\//.test(s) ? "Firefox"
    : /Chrome\/|CriOS\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
  return dev + " · " + br;
};
const linkOpenDayDiff = (fromMs, nowMs) => {
  const f = new Date(fromMs), n = new Date(nowMs);
  const a = new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((b - a) / 86400000);
};
const formatOpenWhen = (iso, nowMs) => {
  const ms = Date.parse(iso || "");
  if (!isFinite(ms)) return "";
  const d = new Date(ms);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s+/g, " ").toLowerCase();
  const days = linkOpenDayDiff(ms, nowMs);
  if (days === 0) return "today " + t;
  if (days === 1) return "yesterday " + t;
  if (days > 1 && days < 7) return d.toLocaleDateString("en-US", { weekday: "short" }) + " " + t;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + t;
};
const linkOpenState = (entry, createdAt, nowMs, sinceIso) => {
  const opens = (entry && Number(entry.opens)) || 0;
  if (opens > 0) {
    const devs = entry.devices && typeof entry.devices === "object" ? Object.keys(entry.devices).length : 0;
    const devices = Math.max(devs, 1);
    const lastMs = Date.parse(entry.lastAt || "");
    const when = formatOpenWhen(entry.lastAt, nowMs);
    const fresh = isFinite(lastMs) && nowMs - lastMs < LINK_OPEN_FRESH_MS;
    const label = opens === 1
      ? "Opened once" + (when ? " · " + when : "")
      : "Opened " + opens + "× · " + devices + " device" + (devices === 1 ? "" : "s") + (when ? " · last " + when : "");
    return { state: fresh ? "on" : "once", label, opens, devices };
  }
  const sinceMs = Date.parse(sinceIso || "");
  const madeMs = Date.parse(createdAt || "");
  if (!isFinite(madeMs) || !isFinite(sinceMs) || madeMs < sinceMs) {
    const since = isFinite(sinceMs) ? new Date(sinceMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "tracking started";
    return { state: "pre", label: "No opens since " + since, opens: 0, devices: 0 };
  }
  const days = Math.max(0, linkOpenDayDiff(madeMs, nowMs));
  if (nowMs - madeMs >= LINK_OPEN_FRESH_MS) return { state: "late", label: "Not opened · sent " + days + " days ago", opens: 0, devices: 0 };
  const ago = days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
  return { state: "none", label: "Not opened yet · sent " + ago, opens: 0, devices: 0 };
};
// ── end Link opens helpers ─────────────────────────────────────────────────
```

- [ ] **Step 4: Run the test**

Run: `node scripts/linkopens-test.js`
Expected: every line `ok`, then `linkopens-test: 38 passed` (exit 0). If the `formatOpenWhen` time assertions fail only on the space character, check that the `.replace(/\s+/g, " ")` is present: Node 20+ ICU uses U+202F before "AM".

- [ ] **Step 5: Wire it into the build gate.** In `package.json` `prebuild`, append ` && node scripts/linkopens-test.js` after `node scripts/pulleddaily-test.js` (inside the same string).

- [ ] **Step 6: Commit**

```bash
git add src/App.js scripts/linkopens-test.js package.json
git commit -m "Link opens: pure helpers + prebuild test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Recorder, staff-device flag, Firestore rule

**Files:**
- Modify: `src/App.js`. Recorder goes directly below `// ── end Link opens helpers ──…`. The flag goes in `function _setUsageUser(identity) {`. The call goes in `function App() {`.
- Modify: `firestore.rules`

**Interfaces:**
- Consumes (Task 1): `linkOpenTarget`, `isStaffDevice`, `shouldRecordOpen`, `deviceLabel`, `LINK_KEY_SAFE`.
- Produces: `recordLinkOpen(): void`. It writes `link_opens/{jobId}` = `{ links: { [key]: { opens, firstAt, lastAt, devices: { [deviceId]: { label, opens, lastAt } } } }, updated_at }`.

- [ ] **Step 1: Add the recorder** right after the `// ── end Link opens helpers` line:

```js
// Fire-and-forget: count this page load as one open of the share link in the
// URL. Runs once per page load (called at the top of App(), before the share
// routes). Never throws, never blocks, never toasts. Writes ONLY
// link_opens/{jobId} — never jobs/{id}.
let _linkOpenDone = false;
function recordLinkOpen() {
  if (_linkOpenDone) return;
  _linkOpenDone = true;
  try {
    const target = linkOpenTarget(window.location.search);
    if (!target) return;
    let ls = null;
    try { ls = window.localStorage; } catch (e) {}
    const get = (k) => (ls ? ls.getItem(k) : null);
    const put = (k, v) => { try { if (ls) ls.setItem(k, v); } catch (e) {} };
    if (isStaffDevice(get)) return;
    const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
    const throttleKey = "he_lo_" + target.jobId + "_" + target.key;
    let last = null;
    try { last = get(throttleKey); } catch (e) {}
    if (!shouldRecordOpen(last, nowMs)) return;
    put(throttleKey, nowIso);
    let deviceId = null;
    try { deviceId = get("he_link_device"); } catch (e) {}
    if (!deviceId || !LINK_KEY_SAFE.test(deviceId)) {
      deviceId = "d_" + Math.random().toString(36).slice(2, 12);
      put("he_link_device", deviceId);
    }
    const label = deviceLabel(typeof navigator !== "undefined" ? navigator.userAgent : "");
    const ref = doc(db, "link_opens", target.jobId);
    getDoc(ref).catch(() => null).then((snap) => {
      const prev = snap && snap.exists() ? ((((snap.data() || {}).links) || {})[target.key] || {}) : {};
      const entry = {
        opens: increment(1),
        lastAt: nowIso,
        devices: { [deviceId]: { label, opens: increment(1), lastAt: nowIso } },
      };
      if (!prev.firstAt) entry.firstAt = nowIso;
      return setDoc(ref, { links: { [target.key]: entry }, updated_at: nowIso }, { merge: true });
    }).catch((e) => console.warn("[HE link-opens] write failed:", e && e.message));
  } catch (e) {
    console.warn("[HE link-opens] skipped:", e && e.message);
  }
}
```

- [ ] **Step 2: Mark staff devices.** Replace the body of `_setUsageUser`. The anchor must match exactly once:

Old:
```js
function _setUsageUser(identity) {
  _usageUser = (identity && identity.id && getAccess(identity) !== "contractor") ? identity : null;
}
```
New:
```js
let _staffMarked = false;
function _setUsageUser(identity) {
  _usageUser = (identity && identity.id && getAccess(identity) !== "contractor") ? identity : null;
  // Link opens: any device that has rendered the app shell signed in (contractors
  // included) is staff forever, so its share-link opens never count — even
  // after the PIN expires and he_identity is cleared.
  if (!_staffMarked && identity && identity.id) {
    _staffMarked = true;
    try { localStorage.setItem("he_staff_device", "1"); } catch (e) {}
  }
}
```

- [ ] **Step 3: Call the recorder at the router.** In `function App() {`, insert as the first statement, directly above `  // Homeowner page route — ?homeowner=JOB_ID`:

```js
  // Link opens: count this load if it's a share link (no-op for the app itself).
  recordLinkOpen();
```

- [ ] **Step 4: Add the rule.** In `firestore.rules`, insert this block directly above the line `    // ── HOMEOWNER REQUESTS ────` (keep its indentation):

```
    // ── LINK OPENS ────────────────────────────────────────────────────────────
    // Share-link open counters, one doc per job (spec 2026-10-07-link-opens).
    // Public share pages bump them; the office reads them. Never on jobs/{id}.
    // Nothing sensitive and nothing decides on it, so writes are open like the
    // rest of the share surface — but the shape is fixed and nobody can delete.
    match /link_opens/{jobId} {
      allow read: if true;
      allow create, update: if request.resource.data.keys().hasOnly(['links', 'updated_at'])
                            && request.resource.data.links is map
                            && request.resource.data.updated_at is string;
      allow delete: if false;
    }

```

- [ ] **Step 5: Verify**

Run: `node scripts/linkopens-test.js && node scripts/tdz-scan.js`
Expected: both pass. tdz-scan proves `recordLinkOpen` and its consts are defined before `App()` uses them.

Run: `grep -n "recordLinkOpen()" src/App.js`
Expected: exactly 1 call site, inside `function App()`.

- [ ] **Step 6: Commit**

```bash
git add src/App.js firestore.rules
git commit -m "Link opens: recorder at the share router, staff-device flag, link_opens rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Office line component and SAVED LINKS wiring

**Files:**
- Modify: `src/App.js`. The components go directly below `recordLinkOpen` from Task 2. Wiring goes in `function QuestionPicker(` and `function PunchPicker(`.

**Interfaces:**
- Consumes: `linkOpenState`, `formatOpenWhen`, `LINK_OPENS_SINCE`, `C`.
- Produces:
  - `useLinkOpens(jobId: string|null) → object|null`. Returns the `links` map, `{}` when the doc is missing, and `null` while loading, on error, or when `jobId` is null.
  - `LinkOpensLine({ opens, linkKey, createdAt, style })` renders nothing when `opens` is null.
  - `LinkOpens({ jobId, linkKey, createdAt, style })` subscribes itself (used in Task 4).

- [ ] **Step 1: Add the hook and components** below `recordLinkOpen`:

```js
// Office side: live read of link_opens/{jobId}. null = loading / failed / off
// (callers render nothing — never a wrong "Not opened"); {} = no opens yet.
function useLinkOpens(jobId) {
  const [links, setLinks] = useState(null);
  useEffect(() => {
    if (!jobId) { setLinks(null); return; }
    let alive = true;
    const unsub = onSnapshot(doc(db, "link_opens", String(jobId)),
      (snap) => { if (alive) setLinks(snap.exists() ? (((snap.data() || {}).links) || {}) : {}); },
      (e) => { console.warn("[HE link-opens] read failed:", e && e.message); if (alive) setLinks(null); });
    return () => { alive = false; unsub(); };
  }, [jobId]);
  return links;
}
const LINK_OPEN_DOT = { on: C.green, once: C.blue, late: C.red };
function LinkOpensLine({ opens, linkKey, createdAt = null, style }) {
  const [open, setOpen] = useState(false);
  if (!opens || !linkKey) return null;
  const entry = opens[linkKey] || null;
  const nowMs = Date.now();
  const st = linkOpenState(entry, createdAt, nowMs, LINK_OPENS_SINCE);
  const solid = LINK_OPEN_DOT[st.state];
  const dot = (
    <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", display: "inline-block", boxSizing: "border-box",
      background: solid || "transparent", border: solid ? "none" : `1.5px ${st.state === "pre" ? "dashed" : "solid"} ${C.muted}` }}/>
  );
  const color = st.state === "on" ? C.green : st.state === "late" ? C.red : C.dim;
  const base = { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 10.5, fontWeight: 600, color,
    fontFamily: "inherit", background: "none", border: "none", padding: "2px 0", textAlign: "left", ...(style || {}) };
  if (st.opens === 0) return <span style={base}>{dot}{st.label}</span>;
  const devs = Object.entries((entry && entry.devices) || {})
    .map(([id, d]) => ({ id, ...(d || {}) }))
    .sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")));
  const kv = (k, v) => (
    <div style={{ display: "flex", gap: 10 }}>
      <span style={{ width: 92, flex: "none" }}>{k}</span>
      <span style={{ color: C.text, fontVariantNumeric: "tabular-nums" }}>{v || "—"}</span>
    </div>
  );
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ ...base, cursor: "pointer" }}>
        {dot}{st.label}
        <span style={{ color: C.muted, fontSize: 9, display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
      </button>
      {open && (
        <div style={{ margin: "6px 0 2px 14px", padding: "8px 10px", background: "#fff", border: `1px solid ${C.border}`,
          borderRadius: 8, fontSize: 11, color: C.dim, display: "grid", gap: 4, maxWidth: 420 }}>
          {kv("First opened", formatOpenWhen(entry.firstAt, nowMs))}
          {kv("Last opened", formatOpenWhen(entry.lastAt, nowMs))}
          <div style={{ borderTop: "1px solid #E7EAEF", margin: "3px 0" }}/>
          {devs.map(d => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
              <b style={{ fontWeight: 600, color: C.text }}>{d.label || "Unknown device"}</b>
              <span>{(Number(d.opens) || 0)}× · last {formatOpenWhen(d.lastAt, nowMs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// Self-subscribing variant for spots that show one link (Task 4).
function LinkOpens({ jobId, linkKey, createdAt = null, style }) {
  const opens = useLinkOpens(jobId);
  return <LinkOpensLine opens={opens} linkKey={linkKey} createdAt={createdAt} style={style}/>;
}
```

- [ ] **Step 2: QuestionPicker — subscribe while the modal is open.** In `function QuestionPicker(`, directly below the anchor line `  const [previewId, setPreviewId] = useState(null);` (it continues with a `// saved-share id shown in the read-only preview iframe` comment), add:

```js
  // Link opens for the SAVED LINKS rows — listener only while the modal is open.
  const linkOpens = useLinkOpens(open ? jobId : null);
  const showBaseOpens = filter != null || !!(linkOpens && linkOpens["questions:base"]);
```

- [ ] **Step 3: QuestionPicker — show the block when the base row is the only row.** Replace `              {totalShares>0 && (` with `              {(totalShares>0 || showBaseOpens) && (`. Only the first match, the one directly above `<div style={{marginBottom:18,background:'#F4F6F8'`.

- [ ] **Step 4: QuestionPicker — line on each named row.** In the `shares.map(s=>{` block, the count line is the anchor (unique, contains `hand-picked +`):

```jsx
                          <div style={{fontSize:10,color:'#99A0AA'}}>{cnt} question{cnt!==1?'s':''} on link{picked!==cnt && <span style={{color:'#B0892C'}}> · {picked} hand-picked + {cnt-picked} auto-assigned</span>}</div>
```
Insert directly after it, at the same indent:
```jsx
                          <LinkOpensLine opens={linkOpens} linkKey={`questions:${s.id}`} createdAt={s.createdAt||null}/>
```

- [ ] **Step 5: QuestionPicker — base row.** Directly after the closing `                  })}` of `shares.map` and before `{editingId && <button onClick={startNew}`, insert:

```jsx
                  {showBaseOpens && (
                    <div style={{padding:'7px 0',borderTop:'1px solid #E7EAEF'}}>
                      <div style={{fontSize:12.5,fontWeight:700,color:'#1B1F24'}}>Base link (Share all)</div>
                      <LinkOpensLine opens={linkOpens} linkKey="questions:base"/>
                    </div>
                  )}
```

- [ ] **Step 6: PunchPicker — same three changes.** In `function PunchPicker(`, directly below `  const stageParam = stage.toLowerCase() + 'punch';` add:

```js
  // Link opens for the SAVED LINKS rows — listener only while the modal is open.
  const linkOpens = useLinkOpens(open ? jobId : null);
  const showBaseOpens = filter != null || !!(linkOpens && linkOpens[`${stageParam}:base`]);
```
Replace `              {shareList.length>0 && (` with `              {(shareList.length>0 || showBaseOpens) && (` (the one directly above `<div style={{marginBottom:16,background:'#F4F6F8'`).
After the anchor (unique inside PunchPicker):
```jsx
                          <div style={{fontSize:10,color:'#99A0AA'}}>{cnt} item{cnt!==1?'s':''}</div>
```
insert:
```jsx
                          <LinkOpensLine opens={linkOpens} linkKey={`${stageParam}:${s.id}`} createdAt={s.createdAt||null}/>
```
After that `shareList.map`'s closing `                  })}` and before its `{editingId && <button onClick={startNew}`, insert:
```jsx
                  {showBaseOpens && (
                    <div style={{padding:'7px 0',borderTop:'1px solid #E7EAEF'}}>
                      <div style={{fontSize:12.5,fontWeight:700,color:'#1B1F24'}}>Base link (Share all)</div>
                      <LinkOpensLine opens={linkOpens} linkKey={`${stageParam}:base`}/>
                    </div>
                  )}
```

- [ ] **Step 7: Verify**

Run: `node scripts/linkopens-test.js && node scripts/tdz-scan.js && npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module,ecmaFeatures:{jsx:true} --rule 'no-undef:error' --env browser,es2022 src/App.js 2>&1 | grep -E "LinkOpens|useLinkOpens|linkOpens|showBaseOpens" || echo "no undefined link-opens names"`
Expected: tests pass, and the grep prints `no undefined link-opens names`. If eslint can't parse with those flags, the Task 5 build is the gate; don't skip it.

- [ ] **Step 8: Commit**

```bash
git add src/App.js
git commit -m "Link opens: office line (useLinkOpens + LinkOpensLine) on Questions and Punch SAVED LINKS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One-link-per-job spots

**Files:**
- Modify: `src/App.js`. `HomeRunsTab` (two spots), `JobDetail` (lighting collab, Plan Changes, loads), `JobNoteCard`.

**Interfaces:**
- Consumes: `LinkOpens({ jobId, linkKey, createdAt, style })` from Task 3.

Every one of these strips is a `display:'flex', … flexWrap:'wrap'` row. A full-width child `<div style={{flexBasis:'100%',marginTop:-4}}>` drops the line under the button, as in the mockup.

- [ ] **Step 1: Home Runs live view.** In `HomeRunsTab`, the anchor is `        <HelpDot section="liveviewlink"/>`, which must be unique. Insert directly after it:

```jsx
        <div style={{flexBasis:'100%',marginTop:-4}}><LinkOpens jobId={jobId} linkKey="homeruns:base"/></div>
```

- [ ] **Step 2: Homeowner generator page.** In `HomeRunsTab`, the anchor is `          <HelpDot section="generatorlink"/>`. If it isn't unique, use the one directly after the `openUrl(hoLink)` Preview button. Insert directly after it:

```jsx
          <div style={{flexBasis:'100%',marginTop:-4}}><LinkOpens jobId={jobId} linkKey="homeowner:base"/></div>
```

- [ ] **Step 3: Lighting collab.** In `JobDetail`, the anchor is the line `                <HelpDot section="lightinglinks"/>` directly followed by `                </>)}`. Use the pair as the anchor so it's unique. Insert between them:

```jsx
                <div style={{flexBasis:'100%',marginTop:-4}}><LinkOpens jobId={job.id} linkKey="lighting:base"/></div>
```

- [ ] **Step 4: Plan Changes (Lutron).** In the same strip, the anchor is `                    <span style={{fontSize:11,color:C.dim}}>One-time link — lists every Lutron job for them</span>`. Insert directly after it:

```jsx
                    <div style={{flexBasis:'100%',marginTop:-4,display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:10.5,color:C.dim}}>This job's Plan Changes page:</span>
                      <LinkOpens jobId={job.id} linkKey="lutronshare:base" style={{marginTop:0}}/>
                    </div>
```

- [ ] **Step 5: Panel loads.** In `JobDetail`, the anchor is the `Share loads` button's closing:

```jsx
                    Share loads
                  </button>
```
Insert directly after `</button>`, inside the same `&& (` group. Wrap the button and the line in a fragment so the condition still applies to both. The result is:

```jsx
                {(job.lightingSystem||"Control 4")!=="Lutron" && !isSectionHidden(job,"loadsShare") && (<>
                  <button title="Copy a read-only link to send the AV programmer"
                    …unchanged…>
                    Share loads
                  </button>
                  <span style={{display:'inline-flex',marginLeft:4}}><LinkOpens jobId={job.id} linkKey="loads:base" style={{marginTop:0}}/></span>
                </>)}
```
This strip is a header-action slot, not a wrapping row, so the line sits inline after the button instead of beneath it. Change only the opening `&& (` to `&& (<>` and the matching `)}` to `</>)}`. Leave the button's body untouched.

- [ ] **Step 6: Job notes.** In `JobNoteCard`, the anchor is:

```jsx
                <span style={{ fontSize:10, color: C.dim }}>
                  Created {note.sharedAt ? new Date(note.sharedAt).toLocaleString() : '—'}
                </span>
```
Insert directly after the closing `</span>`:

```jsx
                <LinkOpens jobId={jobId} linkKey={`jobnote:${note.id}`} createdAt={note.sharedAt||null} style={{marginTop:0}}/>
```

- [ ] **Step 7: Verify the build**

Run: `CI=true npm run build` (no pipe; read the whole tail of the output yourself)
Expected: `Compiled successfully` and `The build folder is ready to be deployed`. All prebuild tests print, including `linkopens-test: N passed`.

- [ ] **Step 8: Visual check against the mockup.** Start the preview build server (`.claude/build-server.js` in the shared folder serves a `build/` dir; or use preview_start) on this worktree's `build/`. Then:
  1. Open a job with named question shares and open Share Questions. Each row shows a line ("No opens since Oct 7" before any opens), and there are no layout breaks.
  2. In a private window (no `he_identity`), open that row's link. Back in the app, the row reads "Opened once · today …" within a few seconds, and clicking it unfolds First/Last opened plus one device.
  3. Reload the private window and confirm it still reads once (throttle).
  4. Open the link in the signed-in window and confirm there's no change (staff skip).
  5. Check Home Runs, Lighting, the Homeowner link and a job note show their line.
  6. Take a screenshot of the Share Questions modal for the ship report.

  This step needs `link_opens` rules deployed to count anything. Until Koy deploys rules, the recorder's write is refused, the line keeps reading "No opens since Oct 7", and a `[HE link-opens] write failed` warning appears in the console. That counts as a pass for layout; the counting check moves to the post-ship live check.

- [ ] **Step 9: Commit**

```bash
git add src/App.js
git commit -m "Link opens: line under Home Runs, Homeowner, Lighting, Plan Changes, Loads and Job Note shares

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Guides, FEATURES, SW bump, ship prep

**Files:**
- Modify: `public/sops/questionlinks.html`, `public/sops/liveviewlink.html`, `public/sops/lightinglinks.html`, `public/sops/generatorlink.html`, plus any guide found in Step 1
- Modify: `FEATURES.md`, `public/service-worker.js`
- Create: `docs/crew-briefs/v<N>.md`

- [ ] **Step 1: Find every guide that shows a share control.**

Run: `grep -l -i -E "saved links|share ↗|copy link|share loads|share link" public/sops/*.html`
Expected: at least the four files above. Note any punch or job-note guide in the list.

- [ ] **Step 2: Add one short section to each matching guide.** Match each guide's existing markup: copy the structure of its nearest existing `<h2>`/`<p>` or step block, and don't invent new CSS. Content, in plain words:

> **Did they open it?** Under each link you'll see a small line: *Opened 3× · 2 devices · last today 9:12 am*. Tap it to see when it was first and last opened and on which devices. A red line means it hasn't been opened in 3+ days, so give them a call. Your own opens never count, and neither does Preview. Links made before Oct 7 say "No opens since Oct 7" until someone opens them.

- [ ] **Step 3: Set the tracking start date.** If shipping on a day other than 2026-10-07, change `LINK_OPENS_SINCE` to `"<ship-date>T00:00:00"`, and change the `since` const and the `"No opens since Oct 7"` expectation in `scripts/linkopens-test.js` to match. Re-run `node scripts/linkopens-test.js`.

- [ ] **Step 4: Ship bookkeeping (homestead-deploy-hygiene skill).** Run the `anthropic-skills:homestead-deploy-hygiene` checklist.
  1. Bump `public/service-worker.js` `const CACHE = "homestead-vNNN";` to the next free version. Check `git fetch && git show origin/main:public/service-worker.js | head -1` right before committing.
  2. Add the FEATURES.md entry (`'SW vNNN'`), which the prebuild gate requires.
  3. Write `docs/crew-briefs/vNNN.md` with the `crew-brief` skill.
  4. Data-safety line: "Additive only — new `link_opens` collection written solely by public share pages; no `jobs/{id}` field, loader, or existing write path touched; the office only reads it; the recorder can't break a share page (try/catch, no await on render)."

- [ ] **Step 5: Final build**

Run: `CI=true npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 6: Commit (do NOT push)**

```bash
git add public/sops/*.html FEATURES.md public/service-worker.js docs/crew-briefs/ scripts/linkopens-test.js src/App.js
git commit -m "Link opens: guides, FEATURES, SW vNNN

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand Koy the one-paste.** Pushing to main and deploying rules are Koy's call:
  - `git push origin link-opens:main` from this worktree. If rejected, rebase onto `origin/main`, re-bump the SW to the next free version, rebuild, and retry (up to 4×).
  - `firebase deploy --only firestore:rules`. This must land for counting to start; until then writes are refused harmlessly.
  - After the push: run the live check (spec → Testing), write the vault log `~/Desktop/Command Center/Logs/2026-10-07 - Homestead Electric.md`, and send the crew brief.
