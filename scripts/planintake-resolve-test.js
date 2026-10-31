#!/usr/bin/env node
// planintake-resolve-test.js — v542 plan-intake changes, against an in-memory Firestore.
//   1. An unmatched plan's finding carries a second guess from the sender's history
//      (never the same number as the best guess).
//   2. Dismissing resolves the unmatched finding; resolving never creates a stub.
//   3. reopenUnmatched re-opens recent unmatched emailed PDFs (max 3 times each),
//      and leaves old ones, walks, and other modes alone.
"use strict";
const assert = require("assert");
const makePlanIntake = require("../functions/planIntake/watcher.js");

const store = new Map();
const get = (k) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined;
const docRef = (coll, id) => ({
  id, ref: null,
  async get() { const d = get(`${coll}/${id}`); return { exists: !!d, id, data: () => d }; },
  async set(v, opt) { store.set(`${coll}/${id}`, opt && opt.merge ? { ...(get(`${coll}/${id}`) || {}), ...JSON.parse(JSON.stringify(v)) } : JSON.parse(JSON.stringify(v))); },
  async create(v) { if (store.has(`${coll}/${id}`)) { const e = new Error("exists"); e.code = 6; throw e; } store.set(`${coll}/${id}`, JSON.parse(JSON.stringify(v))); },
  async update(v) { const cur = get(`${coll}/${id}`); if (!cur) { const e = new Error("NOT_FOUND"); e.code = 5; throw e; } store.set(`${coll}/${id}`, { ...cur, ...JSON.parse(JSON.stringify(v)) }); },
});
const db = {
  collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    where: (f, op, v) => ({ async get() {
      const docs = [...store.keys()].filter(k => k.startsWith(coll + "/")).map(k => ({ id: k.slice(coll.length + 1), data: () => get(k) }))
        .filter(d => (d.data() || {})[f] === v).map(d => ({ ...d, ref: docRef(coll, d.id) }));
      return { docs };
    } }),
  }),
};
const functions = { logger: { warn() {}, info() {} }, https: { HttpsError: Error, onCall: () => ({}), onRequest: () => ({}) }, runWith: () => functions, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: () => ({}) }) }) } };
functions.https.onCall = () => ({}); functions.https.onRequest = () => ({});
const P = makePlanIntake({ functions, db, google: {}, TZ: "America/Denver", FieldValue: { arrayUnion: (x) => x, increment: (n) => n } });

(async () => {
  const ctx = { cfg: { mode: "live" }, drive: {} };
  // Sender history: AVS filed 4 into #1454, 1 into #1006.
  await db.collection("planIntakeState").doc("sender_jeran@avsutah.com").set({ type: "sender", numbers: { "#1454": 4, "#1006": 1 } });
  const item = { id: "email_a", type: "email_pdf", filename: "Brown_Panel_Layout.pdf", from: "jeran@avsutah.com", gmailLink: "g" };
  await P._decide(ctx, item, { action: "unmatched", bestGuess: "#1006", reason: "no address" });
  const f = get("agentFindings/unmatched_email_a");
  assert.strictEqual(f.altGuess, "1454", "second guess is the sender's most-filed job");
  assert.ok(/4 earlier files/.test(f.altWhy), f.altWhy);
  await P._decide(ctx, { ...item, id: "email_b" }, { action: "unmatched", bestGuess: "#1454" });
  assert.strictEqual(get("agentFindings/unmatched_email_b").altGuess, "1006", "never the same number as the best guess");

  // Dismiss → resolved (no inbox file → no Drive move); a dismiss with no finding creates nothing.
  await P._decide(ctx, item, { action: "dismiss", reason: "not ours", by: "Koy" });
  const r = get("agentFindings/unmatched_email_a");
  assert.strictEqual(r.resolved, true); assert.strictEqual(r.resolvedHow, "dismissed"); assert.strictEqual(r.resolvedBy, "Koy");
  await P._decide(ctx, { ...item, id: "email_zzz" }, { action: "dismiss" });
  assert.strictEqual(get("agentFindings/unmatched_email_zzz"), undefined, "resolving never creates a stub finding");

  // Re-open: related, recent, unplaced PDFs only, capped at 3 related looks.
  const iso = (days) => new Date(Date.now() - days * 86400e3).toISOString();
  const pdf = (fid, extra) => ({ type: "email_pdf", inboxFileId: fid, status: "unmatched", filename: "Walton Residence.pdf", decidedAt: iso(1), ...extra });
  await db.collection("agentQueue").doc("email_1").set(pdf("f1", { reopenCount: 3 }));   // used up by unrelated jobs: still gets a look
  await db.collection("agentQueue").doc("email_2").set(pdf("f2", { decidedAt: iso(70) }));   // too old
  await db.collection("agentQueue").doc("email_3").set(pdf("f3", { relatedReopenCount: 3 })); // capped
  await db.collection("agentQueue").doc("email_5").set(pdf("f5", { filename: "Sunnata Colors.pdf" }));   // unrelated
  await db.collection("agentQueue").doc("walk_unmatched_x").set({ type: "walk_unmatched", status: "unmatched", decidedAt: iso(1) });            // a walk
  await db.collection("agentQueue").doc("test_email_4").set(pdf("f4"));     // test mode
  const n = await P._reopenUnmatched("live", "new in the candidate list", [{ key: "Q3330", number: "3330", name: "Walton Residence" }, { key: "#1469", number: "1469", name: "Orem cabinetry outlet" }]);
  assert.strictEqual(n, 1);
  const e1 = get("agentQueue/email_1");
  assert.strictEqual(e1.status, "open"); assert.strictEqual(e1.reopenCount, 4); assert.strictEqual(e1.relatedReopenCount, 1);
  assert.ok(/Q3330/.test(e1.reopenWhy)); assert.ok(!/1469/.test(e1.reopenWhy), "only the related job is named");
  ["email_2", "email_3", "email_5", "walk_unmatched_x", "test_email_4"].forEach(id => assert.strictEqual(get(`agentQueue/${id}`).status, "unmatched", id));

  // Koy files one by hand: the plan still waiting from that project gets another look, and the filed one doesn't.
  await db.collection("agentQueue").doc("email_6").set(pdf("f6", { filename: "Brown_Panel_Layout - Panel Layout.pdf" }));
  await db.collection("agentQueue").doc("email_7").set(pdf("f7", { filename: "Brown_Panel_Layout_10-21 - Panel Layout (1).pdf" }));
  assert.strictEqual(await P._reopenSiblings("live", { id: "email_7", filename: "Brown_Panel_Layout_10-21 - Panel Layout (1).pdf" }, "#1454", "Koy Wilkinson"), 1);
  assert.strictEqual(get("agentQueue/email_6").status, "open"); assert.ok(/Koy Wilkinson filed .* to #1454/.test(get("agentQueue/email_6").reopenWhy));
  assert.strictEqual(get("agentQueue/email_7").status, "unmatched");
  console.log("planintake-resolve-test: all checks passed");
})().catch(e => { console.error(e); process.exit(1); });
