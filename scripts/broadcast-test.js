// Broadcast notifications (Koy, 2026-10-05) — who gets one, and how the result
// reads back to the sender. Pure helpers from functions/notifyDelivery.js (the
// same module sendBroadcast requires), so nothing here is a hand copy.
// Run: node scripts/broadcast-test.js
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
//
// Pinned:
//  1. Picks resolve by id first, then exact name (any case); unknown picks drop.
//  2. Deactivated members and contractors never get one, even if picked.
//  3. Each person once, keyed the way the bell keys them (id, else name slug).
//  4. A test send goes to the sender only, whatever was picked.
//  5. The 200-recipient cap holds.
//  6. The summary splits phone / retrying / bell only / not saved by name.
//  7. The broadcast id format the client mints passes; junk does not.
"use strict";
const path = require("path");
const assert = require("assert");
const ND = require(path.join(__dirname, "..", "functions", "notifyDelivery.js"));

const keyOf = (u) => (u && (u.id || String(u.name || "").trim().toLowerCase().replace(/\s+/g, "_"))) || null;
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ok  " + name); };

const koy    = { id: "koy", name: "Koy Wilkinson", access: "admin" };
const colby  = { id: "u_1", name: "Colby Fogh", title: "foreman", access: "standard" };
const keegan = { id: "u_2", name: "Keegan", title: "foreman", access: "standard" };
const jacob  = { id: "u_3", name: "Jacob Spackman", title: "crew", access: "limited" };
const gone   = { id: "u_4", name: "Old Hand", title: "crew", access: "limited", active: false };
const gc     = { id: "u_5", name: "Design Build GC", access: "contractor" };
const legacy = { name: "Josh Cloward", role: "admin" };   // pre-id legacy user
const team = [koy, colby, keegan, jacob, gone, gc, legacy];

t("picks resolve by id, then by exact name in any case", () => {
  const out = ND.resolveBroadcastRecipients(team, [{ id: "u_1" }, { name: "keegan" }, { name: "JOSH CLOWARD" }], koy, false, keyOf);
  assert.deepStrictEqual(out.map(u => u.name), ["Colby Fogh", "Keegan", "Josh Cloward"]);
});
t("unknown picks drop silently", () => {
  const out = ND.resolveBroadcastRecipients(team, [{ id: "nope" }, { name: "Nobody" }, null, {}], koy, false, keyOf);
  assert.strictEqual(out.length, 0);
});
t("deactivated members and contractors never get one, even when picked", () => {
  const out = ND.resolveBroadcastRecipients(team, [{ id: "u_4" }, { id: "u_5" }, { name: "Old Hand" }, { id: "u_3" }], koy, false, keyOf);
  assert.deepStrictEqual(out.map(u => u.name), ["Jacob Spackman"]);
});
t("each person once, even picked by id and by name", () => {
  const out = ND.resolveBroadcastRecipients(team, [{ id: "u_1" }, { name: "Colby Fogh" }, { id: "u_1" }], koy, false, keyOf);
  assert.strictEqual(out.length, 1);
});
t("a test send goes to the sender only", () => {
  const out = ND.resolveBroadcastRecipients(team, [{ id: "u_1" }, { id: "u_2" }], koy, true, keyOf);
  assert.deepStrictEqual(out.map(u => u.name), ["Koy Wilkinson"]);
});
t("the 200-recipient cap holds", () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ id: "m" + i, name: "M" + i, access: "limited" }));
  const out = ND.resolveBroadcastRecipients(many, many.map(u => ({ id: u.id })), koy, false, keyOf);
  assert.strictEqual(out.length, ND.BROADCAST_MAX_RECIPIENTS);
});
t("summary splits phone / retrying / bell only / not saved", () => {
  const s = ND.summarizeBroadcast([
    { name: "A", status: "sent", persisted: true },
    { name: "B", status: "partial", persisted: true },
    { name: "C", status: "retrying", persisted: true },
    { name: "D", status: "no_tokens", persisted: true },
    { name: "E", status: "failed", persisted: true },
    { name: "F", status: "duplicate" },
    { name: "G", status: "error" },
    { name: "H", status: "sent", persisted: false },
  ]);
  assert.strictEqual(s.total, 8);
  assert.strictEqual(s.phone, 3);              // A, B, H (pushed even though the bell copy failed)
  assert.deepStrictEqual(s.retrying, ["C"]);
  assert.deepStrictEqual(s.bellOnly, ["D", "E"]);
  assert.strictEqual(s.duplicate, 1);
  assert.deepStrictEqual(s.notSaved, ["G", "H"]);
});
t("broadcast ids: the client's format passes, junk does not", () => {
  assert.ok(ND.BROADCAST_ID_RE.test("bc_mfx3k2_a9q4z1"));
  assert.ok(!ND.BROADCAST_ID_RE.test("bc_"));
  assert.ok(!ND.BROADCAST_ID_RE.test("../../users"));
  assert.ok(!ND.BROADCAST_ID_RE.test("bc_ABC/def"));
});
t("a broadcast is high priority (it buzzes), and the eventKey makes the bell id stable", () => {
  const n = ND.normalizeNotif({ title: "Bid Items moved", body: "x", category: "broadcast", eventKey: "bc_abc123_x" });
  assert.strictEqual(n.priority, "high");
  assert.strictEqual(ND.notifDocId("u_1", n, 1), ND.notifDocId("u_1", n, 999999999));
  assert.notStrictEqual(ND.notifDocId("u_1", n, 1), ND.notifDocId("u_2", n, 1));
});

t("seen state: opened beats banner beats phone beats bell", () => {
  assert.deepStrictEqual(ND.seenStateOf({ read: true, displayedAt: "2026-10-05T10:00:00Z" }, "2026-10-05T11:00:00Z"), { state: "opened", at: "2026-10-05T11:00:00Z" });
  assert.deepStrictEqual(ND.seenStateOf({ read: false, displayedAt: "2026-10-05T10:00:00Z" }), { state: "shown", at: "2026-10-05T10:00:00Z" });
  assert.strictEqual(ND.seenStateOf({ read: false, delivery: { status: "sent", sentAt: "x" } }).state, "phone");
  assert.strictEqual(ND.seenStateOf({ read: false, delivery: { status: "partial" } }).state, "phone");
  assert.strictEqual(ND.seenStateOf({ read: false, delivery: { status: "retrying" } }).state, "trying");
  assert.strictEqual(ND.seenStateOf({ read: false, delivery: { status: "no_tokens" } }).state, "bell");
  assert.strictEqual(ND.seenStateOf({ read: false, delivery: { status: "failed" } }).state, "bell");
  assert.strictEqual(ND.seenStateOf(null).state, "missing");
});
t("seen summary counts opened and lists opened first, newest first", () => {
  const s = ND.summarizeSeen([
    { name: "Zed", state: "bell", at: "" },
    { name: "Amy", state: "opened", at: "2026-10-05T09:00:00Z" },
    { name: "Bob", state: "opened", at: "2026-10-05T10:00:00Z" },
    { name: "Cal", state: "shown", at: "2026-10-05T08:00:00Z" },
  ]);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.opened, 2);
  assert.strictEqual(s.counts.shown, 1);
  assert.deepStrictEqual(s.people.map(p => p.name), ["Bob", "Amy", "Cal", "Zed"]);
});

t("only the office can send: title Admin, or Admin/Manager access without a field title", () => {
  const live = {
    koy:      { name: "Koy Wilkinson", role: "admin" },
    josh:     { name: "Josh Cloward", role: "admin", title: "admin" },
    justin:   { name: "Justin Cloward ", role: "admin" },
    jeromy:   { name: "Jeromy Cloward", access: "manager", title: "crew" },
    keegan:   { name: "Keegan Wilkinson", access: "manager", title: "foreman", role: "lead" },
    colby:    { name: "Colby Fogh", access: "manager", title: "foreman" },
    zane:     { name: "Zane Watkins", access: "standard", title: "foreman" },
    justinC:  { name: "Justin Cloward", access: "limited", title: "crew" },
    braden:   { name: "Braden Davis", access: "standard", title: "lead" },
    gc:       { name: "Paul", access: "contractor", title: "foreman" },
  };
  const yes = Object.entries(live).filter(([, u]) => ND.isBroadcaster(u)).map(([k]) => k);
  assert.deepStrictEqual(yes, ["koy", "josh", "justin", "jeromy"]);
  assert.ok(!ND.isBroadcaster({ ...live.koy, active: false }), "deactivated never");
  assert.ok(ND.isBroadcaster({ ...live.colby, caps: ["notify.broadcast"] }), "a per-person grant counts");
});

t("announcement kinds: unknown falls back to announcement; the push title carries the kind", () => {
  assert.strictEqual(ND.normalizeKind("important"), "important");
  assert.strictEqual(ND.normalizeKind("discussion"), "discussion");
  assert.strictEqual(ND.normalizeKind("shout"), "announcement");
  assert.strictEqual(ND.normalizeKind(undefined), "announcement");
  assert.strictEqual(ND.broadcastPushTitle("important", "New PPE rule"), "IMPORTANT · New PPE rule");
  assert.strictEqual(ND.broadcastPushTitle("nope", "x"), "ANNOUNCEMENT · x");
});
t("attachments: only Firebase Storage download links, names cleaned, 10 max", () => {
  const ok = "https://firebasestorage.googleapis.com/v0/b/homestead-electric.firebasestorage.app/o/broadcasts%2Fbc_a%2Fx.pdf?alt=media&token=1";
  const out = ND.cleanAttachments([
    { name: "<b>plan</b>.pdf", url: ok, type: "application/pdf" },
    { name: "evil", url: "https://evil.example/x.pdf" },
    { name: "js", url: "javascript:alert(1)" },
    { name: "", url: ok, type: "image/jpeg" },
  ]);
  assert.deepStrictEqual(out.map(a => a.name), ["bplan/b.pdf", "file"]);
  assert.strictEqual(ND.cleanAttachments(Array.from({ length: 14 }, () => ({ url: ok }))).length, 10);
  assert.strictEqual(ND.cleanAttachments(Array.from({ length: 9 }, () => ({ url: ok })), 6).length, 6);
  assert.deepStrictEqual(ND.cleanAttachments("nope"), []);
});
t("participants: the people it was sent to, plus the sender", () => {
  const b = { by: "Koy Wilkinson", recipients: [{ name: "Colby Fogh", key: "u1" }, { name: "Jacob Spackman", key: "u3" }] };
  assert.ok(ND.isParticipant(b, "u1", "Colby Fogh"));
  assert.ok(ND.isParticipant(b, "", "jacob spackman"));
  assert.ok(ND.isParticipant(b, "koy", "Koy Wilkinson"), "sender");
  assert.ok(!ND.isParticipant(b, "u6", "Gage Lund"));
  assert.ok(!ND.isParticipant(null, "u1", "Colby Fogh"));
});
t("Got it is the strongest seen state and counts as opened", () => {
  assert.deepStrictEqual(ND.seenStateOf({ read: true, ackAt: "2026-10-06T14:00:00Z" }), { state: "acked", at: "2026-10-06T14:00:00Z" });
  const s = ND.summarizeSeen([{ name: "A", state: "acked", at: "x" }, { name: "B", state: "opened", at: "y" }, { name: "C", state: "bell", at: "" }]);
  assert.strictEqual(s.acked, 1); assert.strictEqual(s.opened, 2);
  assert.deepStrictEqual(s.people.map(p => p.name), ["A", "B", "C"]);
  assert.ok(ND.REPLY_ID_RE.test("r_mfx3k2_a9q4z1")); assert.ok(!ND.REPLY_ID_RE.test("r_x/../y"));
});
t("inbox cleanup: bell items go after 30 days, office messages stay a year", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const ago = (d) => new Date(now - d * 86400000).toISOString();
  assert.ok(ND.isPrunable({ createdAt: ago(31) }, now), "old bell item goes");
  assert.ok(!ND.isPrunable({ createdAt: ago(29) }, now), "recent bell item stays");
  assert.ok(!ND.isPrunable({ createdAt: ago(200), broadcastId: "bc_x" }, now), "office message stays");
  assert.ok(!ND.isPrunable({ createdAt: ago(200), broadcastId: "bc_x", replyBy: "Gage Lund" }, now), "discussion reply stays");
  assert.ok(ND.isPrunable({ createdAt: ago(366), broadcastId: "bc_x" }, now), "office message past a year goes");
  assert.ok(!ND.isPrunable({ createdAt: "" }, now), "no date → left alone");
  assert.ok(!ND.isPrunable(null, now));
});

console.log(`\n${pass} passed`);
