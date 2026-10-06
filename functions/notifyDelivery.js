"use strict";
// Notification delivery — the pure half (FCM reliability pass, 2026-10-04).
//
// The inbox record in notifications/{userKey}/items is the notification.
// Push is the attention layer on top of it. index.js deliver() does the I/O:
//
//   1. persist   inbox item + pushQueue lease, one atomic batch, BEFORE any push
//   2. push      messaging.sendEach() — one message per device token
//   3. record    per-token outcome written back onto the inbox item
//   4. retry     transient failures stay in pushQueue; pushRetrySweep re-sends
//
// Everything in this file is deterministic and I/O-free so
// scripts/notify-delivery-test.js can run it in the prebuild chain.
const crypto = require("crypto");

// FCM error codes that mean "this token is dead forever" — prune it.
const STALE_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
];
// Codes that mean "FCM or the network hiccuped" — the same message to the same
// token can succeed later, so it goes back on the queue instead of being lost.
const TRANSIENT_CODES = [
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "messaging/unknown-error",
  "app/network-error",
  "app/network-timeout",
];

const MAX_ATTEMPTS = 5;
// Minutes to wait before attempt N+1 (index = attempts already made - 1).
const BACKOFF_MIN = [1, 3, 10, 30, 60];
// A push lease: if the function dies between persist and record, the sweep
// picks the item up once the lease runs out.
const LEASE_MS = 3 * 60 * 1000;
// Never ring a phone for something this old — the inbox already has it.
const PUSH_STALE_MS = 12 * 60 * 60 * 1000;
// FCM caps the whole payload at 4 KB. A long status note or punch text used to
// fail with messaging/invalid-argument and the push was gone. The inbox keeps
// the full text; the push carries a trimmed copy.
const PUSH_BODY_MAX = 900;
const PUSH_TITLE_MAX = 120;

// Categories (Settings → Notifications keys) that are attention-worthy but not
// urgent: bids/quotes, digests, routine reminders. Everything else — active-job
// events, assignments, direct nudges, COs, internal messages — is high.
const LOW_PRIORITY_CATEGORIES = new Set([
  "quote_converted",
  "reminder_po",
  "reminder_daily",
  "reminder_safety",
  "stale_job",
  "myday_digest",
  "matterport_chase",
  "bid",
  "quote_request",
]);

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const tokenTag = (token) => String(token || "").slice(0, 12);

function classifyError(code, message) {
  const c = String(code || "");
  const m = String(message || "");
  if (STALE_TOKEN_CODES.some(x => c === x || m.includes(x))) return "stale";
  if (TRANSIENT_CODES.some(x => c === x || m.includes(x))) return "transient";
  return "permanent";
}

function priorityOf(notif) {
  if (notif && (notif.priority === "high" || notif.priority === "normal")) return notif.priority;
  return LOW_PRIORITY_CATEGORIES.has(String((notif && notif.category) || "")) ? "normal" : "high";
}

function normalizeNotif(n) {
  const s = (v, max) => String(v == null ? "" : v).slice(0, max);
  const out = {
    title:    s(n && n.title, 300),
    body:     s(n && n.body, 4000),
    jobId:    s(n && n.jobId, 200),
    section:  s(n && n.section, 80),
    view:     s(n && n.view, 32),
    needId:   s(n && n.needId, 80),
    category: s(n && n.category, 60),
    eventKey: s(n && n.eventKey, 300),
  };
  out.priority = priorityOf({ ...out, priority: n && n.priority });
  return out;
}

// The app path the notification opens. Same shape the SW click handler and the
// app's URL-param readers already understand, plus nid so a cold open can mark
// the inbox item read.
function deepLinkOf(n, nid) {
  const q = [];
  if (n.view) {
    q.push(`view=${encodeURIComponent(n.view)}`);
    if (n.needId) q.push(`need=${encodeURIComponent(n.needId)}`);
  } else if (n.jobId) {
    q.push(`jobId=${encodeURIComponent(n.jobId)}`);
    if (n.section) q.push(`section=${encodeURIComponent(n.section)}`);
  }
  if (nid) q.push(`nid=${encodeURIComponent(nid)}`);
  return q.length ? `/?${q.join("&")}` : "/";
}

// Deterministic inbox doc id = idempotency key. A Firestore trigger can fire
// twice for one write (at-least-once delivery); the second deliver() hits
// ALREADY_EXISTS on create() and is skipped instead of double-pinging.
//   eventKey given → exact dedupe for that event + recipient.
//   otherwise      → same recipient + same content inside the same minute.
// Content ids start with the minute so they sort roughly by creation; event
// ids carry no time at all, so the same event maps to the same id forever.
function notifDocId(userKey, n, nowMs) {
  if (n.eventKey) return `e_${sha(`e|${userKey}|${n.eventKey}`).slice(0, 24)}`;
  const minute = Math.floor(nowMs / 60000);
  const basis = `c|${minute}|${userKey}|${n.title}|${n.body}|${n.jobId}|${n.section}|${n.view}|${n.needId}`;
  return `${minute.toString(36)}_${sha(basis).slice(0, 20)}`;
}

// One FCM message per device token. DATA-ONLY on purpose: the service worker
// renders every notification itself (see public/firebase-messaging-sw.js), so
// there is never a second auto-displayed copy, and no field ever goes into
// webpush.notification (that killed every push once — skill §6).
function buildMessage(token, n, { nid, userKey }) {
  const high = n.priority === "high";
  return {
    token,
    data: {
      title:   n.title.slice(0, PUSH_TITLE_MAX),
      body:    n.body.length > PUSH_BODY_MAX ? n.body.slice(0, PUSH_BODY_MAX - 1) + "…" : n.body,
      jobId:   n.jobId,
      section: n.section,
      view:    n.view,
      needId:  n.needId,
      nid:     nid || "",
      uk:      userKey || "",
      tk:      tokenTag(token),
      pri:     n.priority,
      // One notification per inbox record. The old tag was job+section, so a
      // second event on the same job (foreman assigned, then a status update)
      // silently REPLACED the first banner with renotify:false — no sound, no
      // banner. Retries of the same record reuse the tag, so they still dedupe.
      tag:     nid ? `he-${nid}` : `he-${Date.now()}`,
      link:    deepLinkOf(n, nid),
    },
    webpush: {
      headers: {
        Urgency: high ? "high" : "normal",
        // Seconds the push service holds it for an offline device. Past that,
        // the inbox is the record — a day-old banner is noise.
        TTL: high ? "86400" : "21600",
      },
    },
    // android/apns blocks only apply to native-app tokens; every token in this
    // app is a web token. Kept so a native wrapper later behaves the same.
    android: { priority: high ? "high" : "normal" },
    apns: {
      headers: { "apns-push-type": "alert", "apns-priority": high ? "10" : "5" },
    },
  };
}

// sendEach() BatchResponse (or a thrown whole-batch error) → per-token rows.
function summarizeResults(tokens, batchResponse, batchError) {
  return tokens.map((token, i) => {
    if (batchError) {
      const kind = classifyError(batchError.code, batchError.message);
      return { tk: tokenTag(token), token, ok: false, code: String(batchError.code || "batch-error"),
        error: String(batchError.message || "").slice(0, 200), kind: kind === "stale" ? "transient" : kind };
    }
    const r = (batchResponse && batchResponse.responses && batchResponse.responses[i]) || null;
    if (r && r.success) return { tk: tokenTag(token), token, ok: true, messageId: r.messageId || "" };
    const err = (r && r.error) || {};
    return { tk: tokenTag(token), token, ok: false, code: String(err.code || "unknown"),
      error: String(err.message || "").slice(0, 200), kind: classifyError(err.code, err.message) };
  });
}

// Roll per-token rows into the record's delivery status + what to do next.
//   sent      every device accepted it
//   partial   at least one accepted, others failed (stale/permanent/transient)
//   retrying  nothing accepted yet, some failures are transient → re-queued
//   failed    nothing accepted, nothing left to retry
//   no_tokens the person has no registered device (inbox only)
function rollup(rows, attempts) {
  const ok = rows.filter(r => r.ok).length;
  const transient = rows.filter(r => !r.ok && r.kind === "transient");
  const stale = rows.filter(r => !r.ok && r.kind === "stale");
  const permanent = rows.filter(r => !r.ok && r.kind === "permanent");
  const canRetry = transient.length > 0 && attempts < MAX_ATTEMPTS;
  let status;
  if (rows.length === 0) status = "no_tokens";
  else if (ok === rows.length) status = "sent";
  else if (ok > 0) status = "partial";
  else if (canRetry) status = "retrying";
  else status = "failed";
  return {
    status,
    ok,
    failed: rows.length - ok,
    stale: stale.length,
    permanent: permanent.length,
    transient: transient.length,
    retryTokens: canRetry ? transient.map(r => r.token) : [],
    nextAttemptMs: canRetry ? BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] * 60000 : null,
  };
}

// What gets stored on the inbox item (and so is readable in-app): token tags
// only, never full tokens.
function publicResults(rows) {
  return rows.map(r => {
    const o = { tk: r.tk, ok: !!r.ok };
    if (r.ok) o.messageId = r.messageId || "";
    else { o.code = r.code || ""; o.kind = r.kind || ""; }
    return o;
  });
}

// ── Broadcasts (Koy, 2026-10-05) ─────────────────────────────────────────────
// "send out a notification to either everyone or select people with a custom
// message". index.js sendBroadcast does the I/O; these two decide WHO gets it
// and how the result reads back to the sender.
const BROADCAST_MAX_RECIPIENTS = 200;
const BROADCAST_ID_RE = /^bc_[a-z0-9_]{6,40}$/;
const _norm = (v) => String(v || "").trim().toLowerCase();
// Resolve the client's picks ({id, name}) against the LIVE team list: matched by
// id first, then exact name; deactivated members and contractors never; each
// person once. A test send goes to the sender only. `keyOf` is index.js's
// inboxKeyOf, so dedupe uses the same key the bell does.
function resolveBroadcastRecipients(users, asked, sender, test, keyOf) {
  const accessOf = (u) => u.access || ({ admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard" }[u.role] || "limited");
  const live = (users || []).filter(u => u && u.active !== false && accessOf(u) !== "contractor");
  if (test) return sender ? [sender] : [];
  const out = [], seen = new Set();
  for (const r of (Array.isArray(asked) ? asked : []).slice(0, BROADCAST_MAX_RECIPIENTS)) {
    const rid = String((r && r.id) || "").trim();
    const rname = _norm(r && r.name);
    const u = (rid && live.find(x => x.id === rid)) || (rname && live.find(x => _norm(x.name) === rname)) || null;
    const k = u && keyOf(u);
    if (!u || !k || seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}
// Who may send a broadcast (Koy 2026-10-05: "Office only"). Office = title
// Admin, or Admin/Manager access WITHOUT a field title — access alone is wrong
// because five foremen carry Manager access. Live list: Koy, Josh, Brady,
// Justin, Jeromy. A per-person `caps: ["notify.broadcast"]` grant also counts
// (delegation without a code change). Mirrors bcIsOffice in src/App.js.
function isBroadcaster(u) {
  if (!u || u.active === false) return false;
  if (Array.isArray(u.caps) && u.caps.includes("notify.broadcast")) return true;
  const access = u.access || ({ admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard" }[u.role] || "limited");
  const title = u.title || (["admin", "justin", "jeromy"].includes(u.role) ? "admin" : (["foreman", "lead", "crew"].includes(u.role) ? u.role : "crew"));
  return title === "admin" || (["admin", "manager"].includes(access) && !["foreman", "jrforeman", "lead"].includes(title));
}
// deliver() statuses → what the sender needs to know. "phone" = a device took
// it now; "retrying" = the sweep keeps trying for 12 h; "bellOnly" = saved to
// their in-app bell but no phone set up / every device refused it; "notSaved" =
// even the bell copy failed (should never happen; listed by name if it does).
function summarizeBroadcast(results) {
  const names = (pred) => results.filter(pred).map(r => r.name);
  return {
    total: results.length,
    phone: names(r => r.status === "sent" || r.status === "partial").length,
    retrying: names(r => r.status === "retrying"),
    bellOnly: names(r => r.status === "no_tokens" || (r.status === "failed" && r.persisted !== false)),
    duplicate: names(r => r.status === "duplicate").length,
    notSaved: names(r => r.persisted === false || ["error", "no_recipient", "unknown"].includes(r.status)),
  };
}

// "is there a way to see who has viewed it so i know" (Koy, 2026-10-05).
// One recipient's bell copy → where they are with it, strongest signal first:
//   opened  — read in the app (tapped the push or the bell line, or cleared the
//             bell). `at` = the record's last-change time, which for a read item
//             is the moment they opened it (the rules only let the app flip
//             `read`, so there is no separate readAt field).
//   shown   — the banner came up on their phone (the push worker's receipt);
//             not opened yet. Reading a lock-screen banner lands here.
//   phone   — the push reached their phone; no display receipt yet.
//   trying  — the push is still being retried.
//   bell    — only in their bell (no phone set up, or every device refused it).
//   missing — no bell copy (it never saved; nothing in the app deletes them).
function seenStateOf(item, updatedIso) {
  if (!item) return { state: "missing", at: "" };
  if (item.read) return { state: "opened", at: updatedIso || "" };
  if (item.displayedAt) return { state: "shown", at: String(item.displayedAt) };
  const st = item.delivery && item.delivery.status;
  if (st === "sent" || st === "partial") return { state: "phone", at: String((item.delivery && item.delivery.sentAt) || "") };
  if (st === "retrying" || st === "pending") return { state: "trying", at: "" };
  return { state: "bell", at: "" };
}
const SEEN_ORDER = ["opened", "shown", "phone", "trying", "bell", "missing"];
function summarizeSeen(rows) {
  const counts = Object.fromEntries(SEEN_ORDER.map(k => [k, 0]));
  rows.forEach(r => { counts[r.state] = (counts[r.state] || 0) + 1; });
  const people = rows.slice().sort((a, b) =>
    (SEEN_ORDER.indexOf(a.state) - SEEN_ORDER.indexOf(b.state)) ||
    String(b.at || "").localeCompare(String(a.at || "")) ||
    String(a.name).localeCompare(String(b.name)));
  return { total: rows.length, opened: counts.opened, counts, people };
}

module.exports = {
  STALE_TOKEN_CODES, TRANSIENT_CODES, MAX_ATTEMPTS, BACKOFF_MIN, LEASE_MS, PUSH_STALE_MS,
  PUSH_BODY_MAX, LOW_PRIORITY_CATEGORIES, BROADCAST_MAX_RECIPIENTS, BROADCAST_ID_RE,
  tokenTag, classifyError, priorityOf, normalizeNotif, deepLinkOf, notifDocId,
  buildMessage, summarizeResults, rollup, publicResults,
  resolveBroadcastRecipients, summarizeBroadcast, seenStateOf, summarizeSeen, SEEN_ORDER, isBroadcaster,
};
