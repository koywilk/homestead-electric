"use strict";
// Version lock — server side (08-Specs/Version Lock Spec.md, Phase 1).
//
// Pure helpers, no Firebase imports, so scripts/version-lock-test.js can run
// them under plain node. functions/index.js wires `noteUnstampedJobWrite` into
// the existing onJobUpdate trigger.
//
// WHAT THIS MEASURES: every client write to jobs is supposed to carry a fresh
// stamp (top-level `app_build` int + a `w` string that changes on every
// write). The Phase 2 rules refuse writes without one. Before those rules go
// live, this counts the writes that land WITHOUT a fresh stamp, per day, in
// settings/versionLockStats, so the soak criterion ("zero unstamped client
// writes for 3 working days") is a number Koy can read in Settings → Devices.
//
// Server writes (Admin SDK, bypass the rules) never carry a stamp either, so
// they must not pollute the count. There is no hard marker on them, so the
// classifier uses what the write touched:
//   client-shaped  updated_at / tab / device / saved_by / lastActivityAt
//                  changed, and the data fields changed are not only the
//                  server-owned ones below
//   server-shaped  everything else (auto-heal, Drive folder, docPull, CO sync…)
// Both kinds are recorded with the keys they changed, so a misclassified
// writer is visible and can be moved between the two lists.
const SERVER_OWNED_DATA_KEYS = new Set(["driveFolderId", "docPull"]);
const CLIENT_TOP_KEYS = ["updated_at", "tab", "device", "saved_by", "lastActivityAt"];

const same = (a, b) => {
  try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
  catch (e) { return a === b; }
};

function isFreshlyStamped(rawBefore, rawAfter) {
  const a = rawAfter || {}, b = rawBefore || {};
  return Number.isInteger(a.app_build) && typeof a.w === "string" && a.w.length > 0 && a.w !== b.w;
}

function changedDataKeys(rawBefore, rawAfter) {
  const bd = (rawBefore && rawBefore.data) || {}, ad = (rawAfter && rawAfter.data) || {};
  const keys = new Set([...Object.keys(bd), ...Object.keys(ad)]);
  return [...keys].filter((k) => !same(bd[k], ad[k])).sort();
}

// null when the write carried a fresh stamp; otherwise a record of what landed.
function classifyUnstamped(rawBefore, rawAfter) {
  if (isFreshlyStamped(rawBefore, rawAfter)) return null;
  const b = rawBefore || {}, a = rawAfter || {};
  const topChanged = CLIENT_TOP_KEYS.filter((k) => !same(b[k], a[k]));
  const dataKeys = changedDataKeys(b, a);
  const serverOnlyData = dataKeys.length > 0 && dataKeys.every((k) => SERVER_OWNED_DATA_KEYS.has(k));
  const kind = (topChanged.length > 0 && !serverOnlyData) ? "client" : "server";
  return {
    kind,
    topChanged,
    dataKeys,
    app_build: Number.isInteger(a.app_build) ? a.app_build : null,
    wSame: typeof a.w === "string" && a.w === b.w,
    saved_by: typeof a.saved_by === "string" ? a.saved_by : "",
    device: typeof a.device === "string" ? a.device : "",
    tab: typeof a.tab === "string" ? a.tab : "",
  };
}

// YYYY-MM-DD in the company timezone.
function dayKey(date, tz) {
  try { return new Date(date || Date.now()).toLocaleDateString("en-CA", { timeZone: tz || "America/Denver" }); }
  catch (e) { return new Date(date || Date.now()).toISOString().slice(0, 10); }
}

// Fold one unstamped write into the stats doc. Pure: returns the next doc.
//   { days: { "2026-10-07": { client: n, server: n, last: [entry…≤10] } }, updatedAt }
function foldStats(cur, ymd, entry, opts) {
  const maxDays = (opts && opts.maxDays) || 30, maxLast = (opts && opts.maxLast) || 10;
  const days = { ...((cur && cur.days) || {}) };
  const day = { ...(days[ymd] || { client: 0, server: 0, last: [] }) };
  day[entry.kind] = (Number(day[entry.kind]) || 0) + 1;
  day.last = [entry, ...(Array.isArray(day.last) ? day.last : [])].slice(0, maxLast);
  days[ymd] = day;
  const keep = Object.keys(days).sort().slice(-maxDays);
  const pruned = {};
  keep.forEach((k) => { pruned[k] = days[k]; });
  return { days: pruned, updatedAt: entry.at };
}

// Trigger-side: classify, log, and count. Never throws into the caller's path.
async function noteUnstampedJobWrite(db, logger, { jobId, rawBefore, rawAfter, tz, now }) {
  const c = classifyUnstamped(rawBefore, rawAfter);
  if (!c) return null;
  const at = new Date(now || Date.now()).toISOString();
  const entry = {
    jobId: String(jobId || ""), at, kind: c.kind,
    saved_by: c.saved_by, device: c.device, tab: c.tab,
    app_build: c.app_build, wSame: c.wSame,
    topChanged: c.topChanged.slice(0, 6), dataKeys: c.dataKeys.slice(0, 8),
  };
  const level = c.kind === "client" ? "warn" : "info";
  logger[level]("[versionLock] unstamped job write", entry);
  const ref = db.doc("settings/versionLockStats");
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() || {}) : {};
    tx.set(ref, foldStats(cur, dayKey(at, tz), entry), { merge: false });
  });
  return entry;
}

module.exports = {
  SERVER_OWNED_DATA_KEYS, CLIENT_TOP_KEYS,
  isFreshlyStamped, changedDataKeys, classifyUnstamped, dayKey, foldStats, noteUnstampedJobWrite,
};
