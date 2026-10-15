#!/usr/bin/env node
/* punchnotes-test.js — gate for notes on punch items from the share link
 * (2026-10-15). Koy: "need the recipient to be able to leave a note on a
 * punch item, like if we have something we say we are waiting on they can
 * say its ready now."
 *
 * The app half (src/App.js) is evaluated VERBATIM in a vm sandbox — the block
 * from the "Punch-item notes" banner down to `const PunchNotesCtx` — so what
 * runs here is exactly what ships. The server half is functions/punchNotes.js.
 *
 * Proves:
 *   1. APPEND — a note lands under "<punchKey>_<itemId>"; text trimmed and
 *      capped; empty text / missing id → null (nothing written); the same
 *      note id twice (a retry after a dropped reply) → null, never a dupe;
 *      other items' notes are carried over untouched.
 *   2. ACK — "Got it" stamps every unseen note on that item and keeps the
 *      text; nothing unseen → null; other items untouched.
 *   3. PRIVACY — punchNotesForShare only returns notes from the same link.
 *   4. BADGES — unseenNoteCount counts unseen notes across items.
 *   5. SERVER — newPunchNotes finds only notes whose id is new (an ack is not
 *      new), skips junk; punchItemText finds the item in general / hotcheck /
 *      rooms and strips HTML; the push names the job, the sender and the item.
 *   6. WIRING — the share page saves through saveHomeownerRequest (never the
 *      job doc), honours preview=1, and the "punch_note" toggle exists.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const A = src.indexOf("// ── Punch-item notes from share-link recipients");
const B = src.indexOf("const PunchNotesCtx = createContext(null);");
if (A < 0 || B < 0 || B < A) throw new Error("punchnotes-test: helper block not found in App.js");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src.slice(A, B) + `
this.H = { PUNCH_NOTE_MAX, punchNoteKey, punchNoteList, appendPunchNote, ackPunchNotes,
  unseenPunchNotes, punchNotesForShare, unseenNoteCount };`, sandbox);
const H = sandbox.H;
const S = require("../functions/punchNotes.js");

let passed = 0;
const check = (label, fn) => { try { fn(); passed++; } catch (e) { e.message = `${label}: ${e.message}`; throw e; } };
const plain = (v) => JSON.parse(JSON.stringify(v)); // vm objects → this realm, for deepStrictEqual

const K = H.punchNoteKey("roughPunch", "it_7");
const note = (id, text, extra = {}) => ({ id, text, by: "Justin - PM", share: "s1", at: "2026-10-15T20:14:00.000Z", ...extra });

// 1. APPEND
check("key shape", () => assert.strictEqual(K, "roughPunch_it_7"));
check("first note on an empty doc", () => {
  const next = plain(H.appendPunchNote(undefined, K, note("n1", "  Ready now  ")));
  assert.deepStrictEqual(next, { [K]: [{ id: "n1", text: "Ready now", by: "Justin - PM", share: "s1", at: "2026-10-15T20:14:00.000Z" }] });
});
check("appends after an existing note, keeps other items", () => {
  const prev = { [K]: [note("n1", "Ready now")], finishPunch_x: [note("f1", "other")] };
  const next = plain(H.appendPunchNote(prev, K, note("n2", "Cabinets are in")));
  assert.deepStrictEqual(next[K].map(n => n.id), ["n1", "n2"]);
  assert.deepStrictEqual(next.finishPunch_x, plain(prev.finishPunch_x));
});
check("retry of the same note id → null (no duplicate)", () => {
  assert.strictEqual(H.appendPunchNote({ [K]: [note("n1", "Ready now")] }, K, note("n1", "Ready now")), null);
});
check("empty / whitespace text → null", () => {
  assert.strictEqual(H.appendPunchNote({}, K, note("n1", "   ")), null);
  assert.strictEqual(H.appendPunchNote({}, K, note("n1", "")), null);
});
check("missing id or key → null", () => {
  assert.strictEqual(H.appendPunchNote({}, K, { text: "x" }), null);
  assert.strictEqual(H.appendPunchNote({}, "", note("n1", "x")), null);
});
check("text capped at PUNCH_NOTE_MAX", () => {
  const next = H.appendPunchNote({}, K, note("n1", "a".repeat(H.PUNCH_NOTE_MAX + 50)));
  assert.strictEqual(next[K][0].text.length, H.PUNCH_NOTE_MAX);
});
check("junk existing value is treated as empty, not thrown on", () => {
  const next = plain(H.appendPunchNote({ [K]: "oops" }, K, note("n1", "x")));
  assert.strictEqual(next[K].length, 1);
});

// 2. ACK
check("Got it stamps unseen notes, keeps text", () => {
  const prev = { [K]: [note("n1", "Ready now"), note("n0", "old", { ackBy: "Koy", ackAt: "2026-10-14T00:00:00Z" })], other: [note("o1", "x")] };
  const next = plain(H.ackPunchNotes(prev, K, "Brady", "2026-10-15T21:00:00Z"));
  assert.strictEqual(next[K][0].text, "Ready now");
  assert.strictEqual(next[K][0].ackBy, "Brady");
  assert.strictEqual(next[K][0].ackAt, "2026-10-15T21:00:00Z");
  assert.strictEqual(next[K][1].ackBy, "Koy", "an already-seen note keeps its first ack");
  assert.deepStrictEqual(next.other, plain(prev.other));
});
check("nothing unseen → null", () => {
  assert.strictEqual(H.ackPunchNotes({ [K]: [note("n1", "x", { ackAt: "t" })] }, K, "Koy", "t2"), null);
  assert.strictEqual(H.ackPunchNotes({}, K, "Koy", "t2"), null);
});

// 3. PRIVACY
check("only this link's notes", () => {
  const list = [note("a", "mine"), note("b", "theirs", { share: "s2" }), note("c", "legacy", { share: "" })];
  assert.deepStrictEqual(plain(H.punchNotesForShare(list, "s1")).map(n => n.id), ["a"]);
  assert.deepStrictEqual(plain(H.punchNotesForShare(list, "")).map(n => n.id), ["c"]);
});

// 4. BADGES
check("unseen count across items", () => {
  const map = { roughPunch_a: [note("1", "x"), note("2", "y", { ackAt: "t" })], roughPunch_b: [note("3", "z")], finishPunch_a: [note("4", "w")] };
  assert.strictEqual(H.unseenNoteCount(map, "roughPunch", [{ id: "a" }, { id: "b" }, { id: "c" }, null]), 2);
  assert.strictEqual(H.unseenNoteCount(null, "roughPunch", [{ id: "a" }]), 0);
});

// 5. SERVER
check("newPunchNotes: only new ids", () => {
  const before = { roughPunch_it_7: [note("n1", "Ready now")] };
  const after = { roughPunch_it_7: [note("n1", "Ready now"), note("n2", "Also the fan")], qcPunch_q1: [note("q", "Done")] };
  const found = S.newPunchNotes(before, after);
  assert.deepStrictEqual(found.map(f => [f.punchKey, f.itemId, f.note.id]), [["roughPunch", "it_7", "n2"], ["qcPunch", "q1", "q"]]);
});
check("newPunchNotes: an ack is not new", () => {
  const before = { roughPunch_a: [note("n1", "Ready now")] };
  const after = { roughPunch_a: [note("n1", "Ready now", { ackBy: "Koy", ackAt: "t" })] };
  assert.strictEqual(S.newPunchNotes(before, after).length, 0);
});
check("newPunchNotes: junk skipped, no throw", () => {
  assert.strictEqual(S.newPunchNotes(undefined, undefined).length, 0);
  assert.strictEqual(S.newPunchNotes({}, { notAPunchKey_x: [note("1", "x")], roughPunch_a: "oops", roughPunch_b: [null, { id: "z", text: "  " }] }).length, 0);
});
const job = { name: "Webb", roughPunch: {
  upper: { general: [{ id: "g1", text: "Box <b>Eve</b>&nbsp;outlets" }], hotcheck: [], rooms: [] },
  main:  { general: [], rooms: [{ id: "r", name: "Pantry", items: [{ id: "it_7", text: "Hang pantry light" }] }] },
}};
check("punchItemText finds general + room items, strips HTML", () => {
  assert.strictEqual(S.punchItemText(job, "roughPunch", "g1"), "Box Eve outlets");
  assert.strictEqual(S.punchItemText(job, "roughPunch", "it_7"), "Hang pantry light");
  assert.strictEqual(S.punchItemText(job, "roughPunch", "missing"), "");
  assert.strictEqual(S.punchItemText(null, "roughPunch", "g1"), "");
});
check("push names job, sender, note and item", () => {
  const [found] = S.newPunchNotes({}, { roughPunch_it_7: [note("n1", "Ready now")] });
  const n = S.punchNoteNotification(job, found);
  assert.strictEqual(n.title, "Punch note on Webb");
  assert.strictEqual(n.body, 'Justin - PM: "Ready now" — on: Hang pantry light');
  assert.strictEqual(n.section, "Rough");
});

// 6. WIRING
const comp = (name) => { const s = src.indexOf(`\nfunction ${name}(`); const e = src.indexOf("\nfunction ", s + 1); return src.slice(s, e); };
check("share page saves notes through saveHomeownerRequest", () => {
  const body = comp("PunchSharePage");
  assert.ok(/saveHomeownerRequest\(jobId,[\s\S]*?appendPunchNote/.test(body));
  assert.ok(!/updateDoc\([^)]*\)[^;]*punchNotes/.test(body), "notes must never be written to the job doc");
  assert.ok(/if \(!text \|\| preview\) return;/.test(body), "preview=1 must never write");
});
check("office Got it goes through the funnel", () => {
  assert.ok(/saveHomeownerRequest\(job\.id,[\s\S]{0,200}ackPunchNotes/.test(comp("JobDetail")));
});
check("punch_note notification toggle exists", () => {
  assert.ok(/key:"punch_note"/.test(src));
  assert.ok(/"punch_note"/.test(fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8")));
});

console.log(`punchnotes-test: ${passed} checks passed`);
