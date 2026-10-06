#!/usr/bin/env node
"use strict";
// FCM reliability pass (2026-10-04) — functions/notifyDelivery.js + the
// deliver() pipeline in functions/index.js, run against an in-memory
// Firestore + FCM fake (no network, no firebase-admin install needed).
//
// Proves: the inbox record is committed BEFORE any push; every outcome is
// recorded on the record; transient failures are queued and retried by
// pushRetrySweep; stale tokens are pruned; a re-fired event is suppressed; a
// failed inbox write still pushes and logs at ERROR; receipts land.
const assert = require("assert");
const Module = require("module");
const path = require("path");
const ND = require("../functions/notifyDelivery.js");

// ── 1. Pure helpers ──────────────────────────────────────────────────────────
assert.strictEqual(ND.classifyError("messaging/registration-token-not-registered"), "stale");
assert.strictEqual(ND.classifyError("x", "Requested entity was not found. messaging/invalid-registration-token"), "stale");
assert.strictEqual(ND.classifyError("messaging/internal-error"), "transient");
assert.strictEqual(ND.classifyError("messaging/server-unavailable"), "transient");
assert.strictEqual(ND.classifyError("messaging/invalid-argument"), "permanent");

assert.strictEqual(ND.priorityOf({ category: "punch_assigned" }), "high", "active-job events are high");
assert.strictEqual(ND.priorityOf({ category: "myday_digest" }), "normal", "digests are normal");
assert.strictEqual(ND.priorityOf({ category: "quote_converted" }), "normal", "quotes are normal");
assert.strictEqual(ND.priorityOf({}), "high", "unknown category defaults to high (never under-ring)");
assert.strictEqual(ND.priorityOf({ category: "myday_digest", priority: "high" }), "high", "explicit priority wins");

const n1 = ND.normalizeNotif({ title: "Punch", body: "x".repeat(5000), jobId: "J1", section: "punch" });
assert.strictEqual(n1.body.length, 4000, "inbox body capped at 4000");
const m1 = ND.buildMessage("tokenAAAAAAAAAAAAAAAA", n1, { nid: "abc", userKey: "u1" });
assert.ok(m1.data.body.length <= ND.PUSH_BODY_MAX, "push body trimmed under the 4KB FCM cap");
assert.ok(Buffer.byteLength(JSON.stringify(m1.data)) < 4096, "whole data payload under 4KB");
assert.strictEqual(m1.data.tag, "he-abc", "one banner per record (tag = record id, not job+section)");
assert.strictEqual(m1.data.tk, "tokenAAAAAAA", "token tag = first 12 chars");
assert.strictEqual(m1.notification, undefined, "data-only: no top-level notification");
assert.strictEqual(m1.webpush.notification, undefined, "never webpush.notification (skill §6)");
assert.strictEqual(m1.webpush.headers.Urgency, "high");
Object.values(m1.data).forEach(v => assert.strictEqual(typeof v, "string", "FCM data values must all be strings"));
const low = ND.buildMessage("t", ND.normalizeNotif({ title: "a", category: "myday_digest" }), { nid: "n" });
assert.strictEqual(low.webpush.headers.Urgency, "normal");

assert.strictEqual(ND.deepLinkOf({ jobId: "J 1", section: "punch" }, "n1"), "/?jobId=J%201&section=punch&nid=n1");
assert.strictEqual(ND.deepLinkOf({ view: "myday", needId: "N1", jobId: "J" }, ""), "/?view=myday&need=N1", "view wins over jobId");
assert.strictEqual(ND.deepLinkOf({}, ""), "/");

const t0 = Date.UTC(2026, 9, 4, 12, 0, 10);
const nn = ND.normalizeNotif({ title: "A", body: "B", jobId: "J" });
assert.strictEqual(ND.notifDocId("u1", nn, t0), ND.notifDocId("u1", nn, t0 + 30000), "same content, same minute → same id");
assert.notStrictEqual(ND.notifDocId("u1", nn, t0), ND.notifDocId("u2", nn, t0), "different recipient → different id");
assert.notStrictEqual(ND.notifDocId("u1", nn, t0), ND.notifDocId("u1", { ...nn, body: "C" }, t0), "different content → different id");
const ek = ND.normalizeNotif({ title: "A", eventKey: "evt-1" });
assert.strictEqual(ND.notifDocId("u1", ek, t0), ND.notifDocId("u1", { ...ek, title: "changed" }, t0 + 3600e3), "eventKey dedupes regardless of time/content");
assert.ok(!/[/]/.test(ND.notifDocId("u/1", nn, t0)), "doc id never contains a slash");

const rows = ND.summarizeResults(["a", "b", "c"], { responses: [
  { success: true, messageId: "m1" },
  { success: false, error: { code: "messaging/registration-token-not-registered", message: "gone" } },
  { success: false, error: { code: "messaging/internal-error", message: "oops" } },
] });
assert.deepStrictEqual(rows.map(r => r.kind || "ok"), ["ok", "stale", "transient"]);
let r = ND.rollup(rows, 1);
assert.strictEqual(r.status, "partial");
assert.deepStrictEqual(r.retryTokens, ["c"], "only the transient token is retried");
assert.strictEqual(r.nextAttemptMs, 60000);
r = ND.rollup(ND.summarizeResults(["a"], null, { code: "app/network-error", message: "net" }), 1);
assert.strictEqual(r.status, "retrying", "whole-batch network failure is retried, not dropped");
r = ND.rollup(ND.summarizeResults(["a"], null, { code: "app/network-error" }), ND.MAX_ATTEMPTS);
assert.strictEqual(r.status, "failed", "gives up after MAX_ATTEMPTS");
assert.strictEqual(ND.rollup([], 1).status, "no_tokens");
const pub = ND.publicResults(rows);
assert.ok(pub.every(p => !("token" in p)), "full tokens never stored on the record");

// ── 2. deliver() pipeline against fakes ──────────────────────────────────────
const store = new Map();          // "a/b/c/d" → data
const events = [];                // ordered I/O log: "commit", "push"
const logs = [];
let failNextCommits = 0;          // simulate Firestore outages
let commitErrorCode = 14;
let fcmPlan = () => ({ success: true, messageId: "mid" });

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
class DocSnap { constructor(p) { this.id = p.split("/").pop(); this.ref = new DocRef(p); this._d = store.get(p); } get exists() { return this._d !== undefined; } data() { return clone(this._d); } }
class DocRef {
  constructor(p) { this.path = p; this.id = p.split("/").pop(); }
  collection(c) { return new CollRef(`${this.path}/${c}`); }
  async get() { return new DocSnap(this.path); }
  async set(d, o) { applySet(this.path, d, o); }
  async create(d) { if (store.has(this.path)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; } store.set(this.path, clone(d)); }
  async delete() { store.delete(this.path); }
}
function applySet(p, d, o) {
  if (o && (o.merge || o.mergeFields)) store.set(p, { ...(store.get(p) || {}), ...clone(d) });
  else store.set(p, clone(d));
}
class CollRef {
  constructor(p, filters = [], lim = 1e9) { this.path = p; this.filters = filters; this.lim = lim; }
  doc(id) { return new DocRef(`${this.path}/${id || Math.random().toString(36).slice(2)}`); }
  where(f, op, v) { return new CollRef(this.path, [...this.filters, [f, op, v]], this.lim); }
  limit(n) { return new CollRef(this.path, this.filters, n); }
  orderBy() { return this; }
  async add(d) { const ref = this.doc(); store.set(ref.path, clone(d)); return ref; }
  async get() {
    const depth = this.path.split("/").length + 1;
    const docs = [...store.keys()].filter(k => k.startsWith(this.path + "/") && k.split("/").length === depth)
      .filter(k => this.filters.every(([f, op, v]) => { const x = store.get(k)[f]; return op === "<=" ? x <= v : op === "<" ? x < v : op === "==" ? x === v : true; }))
      .slice(0, this.lim).map(k => new DocSnap(k));
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}
const fakeDb = {
  collection: (c) => new CollRef(c),
  doc: (p) => new DocRef(p),
  batch() {
    const ops = [];
    return {
      create(ref, d) { ops.push(() => { if (store.has(ref.path)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; } store.set(ref.path, clone(d)); }); return this; },
      set(ref, d, o) { ops.push(() => applySet(ref.path, d, o)); return this; },
      update(ref, d) { ops.push(() => applySet(ref.path, d, { merge: true })); return this; },
      delete(ref) { ops.push(() => store.delete(ref.path)); return this; },
      async commit() {
        // Like the real SDK: a batch is spent once commit() is called, even if
        // that commit fails — retrying must build a new batch.
        if (this._spent) throw new Error("Cannot modify a WriteBatch that has been committed.");
        this._spent = true;
        if (failNextCommits > 0) { failNextCommits--; const e = new Error("unavailable"); e.code = commitErrorCode; throw e; }
        const snapshot = new Map(store);
        try { ops.forEach(f => f()); } catch (e) { store.clear(); snapshot.forEach((v, k) => store.set(k, v)); throw e; }
        events.push("commit");
      },
    };
  },
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => new DocSnap(ref.path),
      update: (ref, d) => writes.push(() => applySet(ref.path, d, { merge: true })),
      set: (ref, d, o) => writes.push(() => applySet(ref.path, d, o)),
    };
    const out = await fn(tx);
    writes.forEach(w => w());
    return out;
  },
};
const fakeMessaging = {
  async sendEach(msgs) {
    events.push("push");
    fakeMessaging.sent.push(...msgs);
    if (fcmPlan === "throw") { const e = new Error("network down"); e.code = "app/network-error"; throw e; }
    return { responses: msgs.map((m, i) => fcmPlan(m, i)) };
  },
  sent: [],
};

// Minimal firebase-functions/v1 + firebase-admin stand-ins.
const handlerOf = (fn) => fn;
const chain = new Proxy(function () {}, {
  get(_, k) {
    if (k === "logger") return { info: (...a) => logs.push(["info", ...a]), warn: (...a) => logs.push(["warn", ...a]), error: (...a) => logs.push(["error", ...a]), debug() {} };
    if (k === "https") return new Proxy({}, { get(_, kk) { if (kk === "HttpsError") return class HttpsError extends Error { constructor(c, m) { super(m); this.code = c; } }; return chain[kk]; } });
    if (["onCall", "onRun", "onUpdate", "onWrite", "onCreate", "onDelete", "onRequest", "onPublish", "onFinalize"].includes(k)) return handlerOf;
    if (k === "then") return undefined;
    return chain;
  },
  apply() { return chain; },
});
const adminStub = {
  initializeApp() {},
  firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => new Date().toISOString(), arrayUnion: (...a) => a, delete: () => undefined, increment: (n) => n }, Timestamp: { now: () => new Date(), fromDate: (d) => d } }),
  messaging: () => fakeMessaging,
  storage: () => new Proxy({}, { get: () => () => ({}) }),
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "firebase-admin") return adminStub;
  if (req.startsWith("firebase-functions")) return chain;
  if (req === "googleapis") return { google: new Proxy({}, { get: () => chain }) };
  return origLoad.call(this, req, ...rest);
};
const fx = require(path.join(__dirname, "../functions/index.js"));
Module._load = origLoad;

const APP = { _appKey: "hs-app-9f3c1e7a2b6d4085" };
const items = (uk) => [...store.keys()].filter(k => k.startsWith(`notifications/${uk}/items/`)).map(k => ({ id: k.split("/").pop(), ...store.get(k) }));
const queue = () => [...store.keys()].filter(k => k.startsWith("pushQueue/")).map(k => store.get(k));
const reset = () => { store.clear(); events.length = 0; logs.length = 0; fakeMessaging.sent.length = 0; failNextCommits = 0; commitErrorCode = 14; fcmPlan = () => ({ success: true, messageId: "mid" }); };
const seedUsers = (list) => store.set("settings/users", { list, updated_at: "2026-10-01T00:00:00Z", saved_by: "Koy" });

(async () => {
  // A. Happy path: persist first, push second, outcome recorded, lease cleared.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokA_1234567890", "tokB_1234567890"] }]);
  let res = await fx.reNudge({ ...APP, toName: "Gage", title: "Reminder", body: "Close the punch", jobId: "J1", section: "punch" });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(events.slice(0, 2), ["commit", "push"], "inbox committed BEFORE the push");
  let it = items("u1");
  assert.strictEqual(it.length, 1);
  assert.strictEqual(it[0].read, false);
  assert.strictEqual(it[0].title, "Reminder");
  assert.strictEqual(it[0].delivery.status, "sent");
  assert.strictEqual(it[0].delivery.okCount, 2);
  assert.strictEqual(it[0].link, `/?jobId=J1&section=punch&nid=${it[0].id}`);
  assert.strictEqual(queue().length, 0, "lease cleared after a clean send");
  assert.ok(fakeMessaging.sent.every(m => m.data.nid === it[0].id && m.data.uk === "u1"), "push carries the record id for click/receipt");
  assert.ok(logs.some(l => l[1] === "[notify] delivery" && l[2].status === "sent"), "structured delivery log line");

  // B. Duplicate trigger in the same minute → suppressed, no second push.
  const pushesBefore = fakeMessaging.sent.length;
  await fx.reNudge({ ...APP, toName: "Gage", title: "Reminder", body: "Close the punch", jobId: "J1", section: "punch" });
  assert.strictEqual(items("u1").length, 1, "no duplicate record");
  assert.strictEqual(fakeMessaging.sent.length, pushesBefore, "no duplicate push");
  assert.ok(logs.some(l => /duplicate suppressed/.test(l[1])));

  // C. Stale + transient mix → stale pruned (audit fields kept), transient queued, then retried.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokA_dead_00000", "tokB_flaky_0000", "tokC_good_00000"] }]);
  fcmPlan = (m) => m.token.startsWith("tokA") ? { success: false, error: { code: "messaging/registration-token-not-registered", message: "gone" } }
    : m.token.startsWith("tokB") ? { success: false, error: { code: "messaging/internal-error", message: "fcm 500" } }
    : { success: true, messageId: "ok" };
  await fx.reNudge({ ...APP, toName: "Gage", title: "CO approved", body: "Kitchen CO", jobId: "J2" });
  it = items("u1")[0];
  assert.strictEqual(it.delivery.status, "partial");
  assert.deepStrictEqual(store.get("settings/users").list[0].fcmTokens, ["tokB_flaky_0000", "tokC_good_00000"], "dead token pruned");
  assert.strictEqual(store.get("settings/users").updated_at, "2026-10-01T00:00:00Z", "prune never touches the users doc audit fields");
  let q = queue();
  assert.strictEqual(q.length, 1);
  assert.deepStrictEqual(q[0].tokens, ["tokB_flaky_0000"], "only the flaky device is queued");
  // Not due yet → sweep does nothing.
  fakeMessaging.sent.length = 0;
  await fx.pushRetrySweep();
  assert.strictEqual(fakeMessaging.sent.length, 0, "sweep respects nextAttemptAt");
  // Make it due; FCM recovers.
  [...store.keys()].filter(k => k.startsWith("pushQueue/")).forEach(k => store.set(k, { ...store.get(k), nextAttemptAt: "2000-01-01T00:00:00Z" }));
  fcmPlan = () => ({ success: true, messageId: "retry-ok" });
  await fx.pushRetrySweep();
  assert.strictEqual(fakeMessaging.sent.length, 1);
  assert.strictEqual(fakeMessaging.sent[0].token, "tokB_flaky_0000", "retry goes only to the failed device");
  it = items("u1")[0];
  assert.strictEqual(it.delivery.attempts, 2);
  assert.strictEqual(it.delivery.okCount, 2, "devices reached across attempts are cumulative");
  assert.strictEqual(queue().length, 0);

  // D. All transient, then max attempts → failed + ERROR log, record intact.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokB_flaky_0000"] }]);
  fcmPlan = "throw";
  await fx.reNudge({ ...APP, toName: "Gage", title: "Schedule moved", body: "Monday → Tuesday" });
  assert.strictEqual(items("u1")[0].delivery.status, "retrying");
  for (let i = 0; i < ND.MAX_ATTEMPTS + 1; i++) {
    [...store.keys()].filter(k => k.startsWith("pushQueue/")).forEach(k => store.set(k, { ...store.get(k), nextAttemptAt: "2000-01-01T00:00:00Z" }));
    await fx.pushRetrySweep();
  }
  it = items("u1")[0];
  assert.strictEqual(it.delivery.status, "failed");
  assert.strictEqual(it.read, false, "the inbox record survives a total push failure");
  assert.strictEqual(queue().length, 0);
  assert.ok(logs.some(l => l[0] === "error" && l[1] === "[notify] delivery" && l[2].status === "failed"), "give-up is logged at ERROR");

  // E. Read in-app before the retry → no late ring.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokB_flaky_0000"] }]);
  fcmPlan = "throw";
  await fx.reNudge({ ...APP, toName: "Gage", title: "Read me", body: "x" });
  const k = [...store.keys()].find(x => x.startsWith("notifications/u1/items/"));
  store.set(k, { ...store.get(k), read: true });
  [...store.keys()].filter(x => x.startsWith("pushQueue/")).forEach(x => store.set(x, { ...store.get(x), nextAttemptAt: "2000-01-01T00:00:00Z" }));
  fakeMessaging.sent.length = 0;
  await fx.pushRetrySweep();
  assert.strictEqual(fakeMessaging.sent.length, 0, "already read in-app → push dropped on purpose");
  assert.strictEqual(store.get(k).delivery.status, "read_before_push");

  // F. No devices → record still written, status no_tokens, no push.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund" }]);
  await fx.reNudge({ ...APP, toName: "Gage", title: "No phone", body: "x" });
  assert.strictEqual(items("u1")[0].delivery.status, "no_tokens");
  assert.strictEqual(fakeMessaging.sent.length, 0);
  assert.strictEqual(queue().length, 0);

  // G. Firestore down (after retries) → push still goes out, ERROR logged.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokC_good_00000"] }]);
  failNextCommits = 3;
  await fx.reNudge({ ...APP, toName: "Gage", title: "Outage", body: "x" });
  assert.strictEqual(items("u1").length, 0);
  assert.strictEqual(fakeMessaging.sent.length, 1, "push still attempted when the inbox write is down");
  assert.ok(logs.some(l => l[0] === "error" && /INBOX WRITE FAILED/.test(l[1])));
  // …and one transient blip is absorbed by the write retry.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokC_good_00000"] }]);
  failNextCommits = 1;
  await fx.reNudge({ ...APP, toName: "Gage", title: "Blip", body: "x" });
  assert.strictEqual(items("u1").length, 1, "one failed commit is retried");
  assert.deepStrictEqual(events.slice(0, 2), ["commit", "push"]);

  // H. Muted category → no record, no push, but logged (not silent).
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokC_good_00000"], notifPrefs: { renudge: false } }]);
  res = await fx.reNudge({ ...APP, toName: "Gage", title: "Muted", body: "x" });
  assert.strictEqual(res.reason, "muted");
  assert.strictEqual(items("u1").length, 0);

  // I. Receipt from the service worker lands on the record.
  reset();
  seedUsers([{ id: "u1", name: "Gage Lund", fcmTokens: ["tokC_good_00000"] }]);
  await fx.reNudge({ ...APP, toName: "Gage", title: "Receipt", body: "x" });
  const nid = items("u1")[0].id;
  assert.deepStrictEqual(await fx.pushReceipt({ ...APP, uk: "u1", nid, tk: "tokC_good_00", shown: true, visible: false }), { ok: true });
  it = items("u1")[0];
  assert.strictEqual(it.delivery.status, "sent", "receipt never clobbers status");
  assert.strictEqual(it.receipts.length, 1);
  assert.ok(it.displayedAt);
  // A later delivery-record write (e.g. a retry attempt) must not wipe the receipt.
  [...store.keys()].filter(x => x.startsWith("notifications/u1/items/")).forEach(x =>
    store.set(x, { ...store.get(x), delivery: { ...store.get(x).delivery, status: "retrying" } }));
  store.set(`pushQueue/u1__${nid}`, { userKey: "u1", nid, attempts: 1, notif: { title: "Receipt", body: "x" },
    tokens: ["tokC_good_00000"], nextAttemptAt: "2000-01-01T00:00:00Z", createdAt: new Date().toISOString() });
  failNextCommits = 1;   // first record commit fails → must retry with a FRESH batch
  await fx.pushRetrySweep();
  it = items("u1")[0];
  assert.strictEqual(it.delivery.attempts, 2, "record written after one failed commit");
  assert.strictEqual(it.receipts.length, 1, "delivery-record write leaves receipts alone");
  assert.deepStrictEqual(await fx.pushReceipt({ ...APP, uk: "u1", nid: "nope" }), { ok: true }, "unknown record → no-op, never creates");
  assert.strictEqual(items("u1").length, 1);
  assert.deepStrictEqual(await fx.pushReceipt({ ...APP, uk: "../x", nid: "a/b" }), { ok: false }, "path injection refused");
  await assert.rejects(fx.pushReceipt({ uk: "u1", nid }), "requires the app key");

  // J. Broadcasts (2026-10-05): admin-PIN gated, one ordinary notification per
  //    recipient through deliver(), bell-only people listed, a re-sent id never
  //    pings twice, test sends go to the sender only and aren't recorded.
  reset();
  seedUsers([
    { id: "koy", name: "Koy Wilkinson", access: "admin", pin: "1234", fcmTokens: ["tokK_1234567890"] },
    { id: "u1", name: "Colby Fogh", title: "foreman", access: "standard", pin: "5555", fcmTokens: ["tokC_1234567890"] },
    { id: "u3", name: "Jacob Spackman", title: "crew", access: "limited" },
    { id: "u4", name: "Old Hand", access: "limited", active: false, fcmTokens: ["tokO_1234567890"] },
    { id: "u5", name: "Design Build", access: "contractor", fcmTokens: ["tokG_1234567890"] },
    { id: "u6", name: "Gage Lund", title: "foreman", access: "manager", pin: "7777", fcmTokens: ["tokL_1234567890"] },
  ]);
  const BC = { ...APP, by: "Koy Wilkinson", pin: "1234" };
  const to = [{ id: "u1", name: "Colby Fogh" }, { id: "u3" }, { id: "u4" }, { id: "u5" }];
  await assert.rejects(fx.sendBroadcast({ ...APP, id: "bc_aaaaaa_1", body: "x", to }), "no PIN → refused");
  await assert.rejects(fx.sendBroadcast({ ...BC, pin: "0000", id: "bc_aaaaaa_1", body: "x", to }), "wrong PIN → refused");
  await assert.rejects(fx.sendBroadcast({ ...APP, by: "Colby Fogh", pin: "5555", id: "bc_aaaaaa_1", body: "x", to }), "a foreman can't broadcast");
  await assert.rejects(fx.sendBroadcast({ ...APP, by: "Gage Lund", pin: "7777", id: "bc_aaaaaa_1", body: "x", to }), "a foreman with Manager access can't broadcast (office only)");
  await assert.rejects(fx.listBroadcasts({ ...APP, by: "Gage Lund", pin: "7777" }), "nor read the history");
  await assert.rejects(fx.sendBroadcast({ ...BC, id: "bc_aaaaaa_1", body: "   ", to }), "empty message refused");
  await assert.rejects(fx.sendBroadcast({ ...BC, id: "../users", body: "x", to }), "bad id refused");
  assert.strictEqual(fakeMessaging.sent.length, 0, "nothing pushed by a refused call");
  res = await fx.sendBroadcast({ ...BC, id: "bc_mfx3k2_a9q4z1", title: "Bid Items moved", body: "It has its own tab now.", label: "Everyone", to });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.summary.total, 2, "deactivated + contractor dropped");
  assert.strictEqual(res.summary.phone, 1);
  assert.deepStrictEqual(res.summary.bellOnly, ["Jacob Spackman"], "no phone → listed as bell only");
  assert.strictEqual(items("u1").length, 1);
  assert.strictEqual(items("u1")[0].title, "ANNOUNCEMENT · Bid Items moved", "default kind = announcement, carried in the title");
  assert.strictEqual(items("u1")[0].headline, "Bid Items moved");
  assert.strictEqual(items("u1")[0].category, "broadcast");
  assert.strictEqual(items("u1")[0].delivery.status, "sent");
  assert.strictEqual(items("u3").length, 1, "bell copy even with no phone");
  assert.strictEqual(items("u4").length + items("u5").length, 0);
  const rec = store.get("broadcasts/bc_mfx3k2_a9q4z1");
  assert.ok(rec, "broadcast recorded");
  assert.deepStrictEqual(rec.to, ["Colby Fogh", "Jacob Spackman"]);
  assert.strictEqual(rec.by, "Koy Wilkinson");
  const pushedBefore = fakeMessaging.sent.length;
  res = await fx.sendBroadcast({ ...BC, id: "bc_mfx3k2_a9q4z1", title: "Bid Items moved", body: "It has its own tab now.", to });
  assert.strictEqual(res.summary.duplicate, 2, "same id again → suppressed for everyone");
  assert.strictEqual(fakeMessaging.sent.length, pushedBefore, "a re-sent broadcast never pings twice");
  assert.strictEqual(items("u1").length, 1);
  res = await fx.sendBroadcast({ ...BC, id: "bc_mfx3k3_t0t0t0", body: "Test", to, test: true });
  assert.strictEqual(res.summary.total, 1, "test goes to the sender only");
  assert.strictEqual(items("koy").length, 1);
  assert.strictEqual(items("u1").length, 1, "test never reaches the picks");
  assert.ok(!store.get("broadcasts/bc_mfx3k3_t0t0t0"), "test sends aren't recorded");
  const list = await fx.listBroadcasts({ ...BC });
  assert.strictEqual(list.items.length, 1);
  assert.strictEqual(list.items[0].count, 2);
  assert.strictEqual(list.items[0].opened, 0, "nobody has opened it yet");
  await assert.rejects(fx.listBroadcasts({ ...APP }), "history needs the admin PIN too");
  // Who has seen it: the record points at each person's real bell copy.
  assert.deepStrictEqual(rec.recipients.map(r => r.nid), [items("u1")[0].id, items("u3")[0].id], "record nids = the bell copies' ids");
  let seen = await fx.broadcastSeen({ ...BC, id: "bc_mfx3k2_a9q4z1" });
  assert.strictEqual(seen.opened, 0);
  assert.deepStrictEqual(seen.people.map(p => [p.name, p.state]), [["Colby Fogh", "phone"], ["Jacob Spackman", "bell"]]);
  // Colby opens it in the app (the client flips only `read`, as the rules allow).
  const colbyPath = [...store.keys()].find(k => k.startsWith("notifications/u1/items/"));
  store.set(colbyPath, { ...store.get(colbyPath), read: true });
  seen = await fx.broadcastSeen({ ...BC, id: "bc_mfx3k2_a9q4z1" });
  assert.strictEqual(seen.opened, 1);
  assert.deepStrictEqual(seen.people[0], { name: "Colby Fogh", state: "opened", at: "" }, "opened sorts first");
  assert.strictEqual((await fx.listBroadcasts({ ...BC })).items[0].opened, 1);
  await assert.rejects(fx.broadcastSeen({ ...APP, id: "bc_mfx3k2_a9q4z1" }), "seen list needs the admin PIN");
  await assert.rejects(fx.broadcastSeen({ ...BC, id: "bc_nope_000000" }), "unknown broadcast → not found");
  await assert.rejects(fx.broadcastSeen({ ...BC, id: "../x" }), "bad id refused");

  // K. Announcements (v513): kinds + attachments on the bell copy, Got it,
  //    open, replies fan out to everyone else, Remind, the morning sweep.
  reset();
  seedUsers([
    { id: "koy", name: "Koy Wilkinson", access: "admin", pin: "1234", fcmTokens: ["tokK_1234567890"] },
    { id: "u1", name: "Colby Fogh", title: "foreman", access: "manager", pin: "5555", fcmTokens: ["tokC_1234567890"] },
    { id: "u3", name: "Jacob Spackman", title: "crew", access: "limited", pin: "2222" },
    { id: "u6", name: "Gage Lund", title: "foreman", access: "manager", pin: "7777", fcmTokens: ["tokL_1234567890"] },
  ]);
  const KOY = { ...APP, by: "Koy Wilkinson", pin: "1234", uid: "koy" };
  const COLBY = { ...APP, by: "Colby Fogh", pin: "5555", uid: "u1" };
  const JACOB = { ...APP, by: "Jacob Spackman", pin: "2222", uid: "u3" };
  const GAGE = { ...APP, by: "Gage Lund", pin: "7777", uid: "u6" };
  const two = [{ id: "u1" }, { id: "u3" }];
  const goodUrl = "https://firebasestorage.googleapis.com/v0/b/homestead-electric.appspot.com/o/broadcasts%2Fbc_imp001_x%2Fa.jpg?alt=media&token=t";
  res = await fx.sendBroadcast({ ...KOY, id: "bc_imp001_x", kind: "important", title: "New PPE rule", body: "Hard hats Monday.",
    label: "2 picked", to: two, attachments: [{ name: "glasses.jpg", url: goodUrl, type: "image/jpeg" }, { name: "x", url: "https://evil.example/x.jpg" }] });
  assert.strictEqual(res.kind, "important");
  let ci = items("u1")[0];
  assert.strictEqual(ci.kind, "important"); assert.strictEqual(ci.broadcastId, "bc_imp001_x");
  assert.strictEqual(ci.headline, "New PPE rule"); assert.strictEqual(ci.from, "Koy Wilkinson");
  assert.strictEqual(ci.title, "IMPORTANT · New PPE rule", "push / bell title carries the kind");
  assert.strictEqual(ci.view, "announce"); assert.strictEqual(ci.needId, "bc_imp001_x");
  assert.deepStrictEqual(ci.attachments.map(a => a.name), ["glasses.jpg"], "non-Storage URLs dropped");
  assert.strictEqual(ci.read, false, "extra can't override the record's own fields");
  assert.strictEqual(store.get("broadcasts/bc_imp001_x").kind, "important");
  // Open: recipients yes, outsiders and bad PINs no.
  let op = await fx.broadcastOpen({ ...COLBY, id: "bc_imp001_x" });
  assert.strictEqual(op.isRecipient, true); assert.strictEqual(op.myAckAt, ""); assert.strictEqual(op.attachments.length, 1);
  await assert.rejects(fx.broadcastOpen({ ...GAGE, id: "bc_imp001_x" }), "not sent to Gage");
  await assert.rejects(fx.broadcastOpen({ ...COLBY, pin: "0000", id: "bc_imp001_x" }), "wrong PIN refused");
  assert.strictEqual((await fx.broadcastOpen({ ...KOY, id: "bc_imp001_x" })).isRecipient, false, "office can open it");
  // Got it: stamped server-side, idempotent, shows in the seen list.
  const ack1 = await fx.ackBroadcast({ ...COLBY, id: "bc_imp001_x" });
  ci = items("u1")[0];
  assert.strictEqual(ci.ackAt, ack1.ackAt); assert.strictEqual(ci.read, true);
  assert.strictEqual((await fx.ackBroadcast({ ...COLBY, id: "bc_imp001_x" })).ackAt, ack1.ackAt, "second tap keeps the first time");
  await assert.rejects(fx.ackBroadcast({ ...GAGE, id: "bc_imp001_x" }), "only recipients can Got it");
  let sn = await fx.broadcastSeen({ ...KOY, id: "bc_imp001_x" });
  assert.strictEqual(sn.acked, 1); assert.strictEqual(sn.opened, 1);
  assert.deepStrictEqual(sn.people[0], { name: "Colby Fogh", state: "acked", at: ack1.ackAt });
  assert.strictEqual((await fx.listBroadcasts({ ...KOY })).items[0].acked, 1);
  assert.strictEqual((await fx.broadcastOpen({ ...COLBY, id: "bc_imp001_x" })).myAckAt, ack1.ackAt);
  // Remind: only the one without Got it; same nonce twice never double-pings.
  let rm = await fx.remindBroadcast({ ...KOY, id: "bc_imp001_x", nonce: "r_abc123" });
  assert.deepStrictEqual(rm.reminded, ["Jacob Spackman"]);
  assert.strictEqual(items("u3").length, 2); assert.strictEqual(items("u1").length, 1);
  await fx.remindBroadcast({ ...KOY, id: "bc_imp001_x", nonce: "r_abc123" });
  assert.strictEqual(items("u3").length, 2, "a retried Remind is suppressed");
  await assert.rejects(fx.remindBroadcast({ ...GAGE, id: "bc_imp001_x", nonce: "r_abc124" }), "Remind is office only");
  // Morning sweep: 13 h old → Jacob reminded again (new day key), Colby (Got it) not.
  store.set("broadcasts/bc_imp001_x", { ...store.get("broadcasts/bc_imp001_x"), at: new Date(Date.now() - 13 * 3600e3).toISOString() });
  await fx.importantGotItReminder();
  assert.strictEqual(items("u3").length, 3); assert.strictEqual(items("u1").length, 1);
  await fx.importantGotItReminder();
  assert.strictEqual(items("u3").length, 3, "one sweep reminder per day");
  // Discussion: every reply notifies everyone else in it (recipients + sender).
  res = await fx.sendBroadcast({ ...KOY, id: "bc_disc01_x", kind: "discussion", title: "Thanksgiving week", body: "Mon–Wed?", to: two });
  const koyBefore = items("koy").length, jacobBefore = items("u3").length, colbyBefore = items("u1").length;
  let rp = await fx.replyBroadcast({ ...COLBY, id: "bc_disc01_x", rid: "r_reply01", text: "Works for me" });
  assert.strictEqual(rp.notified, 2);
  assert.strictEqual(items("koy").length, koyBefore + 1, "sender notified");
  assert.strictEqual(items("u3").length, jacobBefore + 1, "other recipient notified");
  assert.strictEqual(items("u1").length, colbyBefore, "replier not notified of their own reply");
  const kr = items("koy").find(i => i.category === "broadcast_reply");
  assert.strictEqual(kr.body, "Colby: Works for me"); assert.strictEqual(kr.kind, "discussion");
  rp = await fx.replyBroadcast({ ...COLBY, id: "bc_disc01_x", rid: "r_reply01", text: "Works for me" });
  assert.strictEqual(rp.duplicate, true);
  assert.strictEqual(items("koy").length, koyBefore + 1, "a retried reply never re-pings");
  await assert.rejects(fx.replyBroadcast({ ...GAGE, id: "bc_disc01_x", rid: "r_reply02", text: "hi" }), "outsider can't reply");
  await assert.rejects(fx.replyBroadcast({ ...COLBY, id: "bc_imp001_x", rid: "r_reply03", text: "hi" }), "no replies on Important");
  await fx.replyBroadcast({ ...KOY, id: "bc_disc01_x", rid: "r_reply04", text: "Locking it in" });
  op = await fx.broadcastOpen({ ...JACOB, id: "bc_disc01_x" });
  assert.deepStrictEqual(op.replies.map(r => [r.by, r.text]), [["Colby Fogh", "Works for me"], ["Koy Wilkinson", "Locking it in"]]);
  // The fake's FieldValue.increment(n) is a plain set (real Firestore adds), so
  // only check it was written; the two replies themselves are checked above.
  assert.ok(store.get("broadcasts/bc_disc01_x").replyCount >= 1);

  console.log("notify-delivery-test ok");
})().catch(e => { console.error(e); process.exit(1); });
