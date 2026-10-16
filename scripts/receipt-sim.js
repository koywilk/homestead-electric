// Store-run receipts (SW v548) — handler simulation. Run: node scripts/receipt-sim.js (prebuild chain).
// Drives the REAL functions/materialPO/receipt.js (attachStoreReceipt) against a
// fake Firestore and a fake Simpro, plus the app's own shrink / state helpers
// extracted from src/App.js (STORE_RECEIPT_HELPERS markers), and checks:
//   - a good attach: one file on the right PO, named for the crew member and day,
//   - a wrong number refused in plain words (Battle Creek's "1412" = the job number),
//     with nothing uploaded,
//   - a double tap / retry attaching once (simultaneous calls, then a repeat),
//   - a lost Simpro answer found on the PO instead of uploaded twice,
//   - a photo over 10 MB shrunk by the app, and refused by the server if one ever arrives.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const R = require(path.join(__dirname, "../functions/materialPO/rules.js"));

// ── clock (the claim ages) ──
let skew = 0;
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + skew); } static now() { return RealDate.now() + skew; } static parse(s) { return RealDate.parse(s); } static UTC(...a) { return RealDate.UTC(...a); } };

class HttpsError extends Error { constructor(code, msg, details) { super(msg); this.code = code; this.details = details; } }
const functions = { https: { HttpsError, onCall: (fn) => fn }, runWith() { return this; }, logger: { info() {}, warn() {} } };

function makeDb() {
  const store = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ref = (col, id) => ({
    async get() { const d = store.get(`${col}/${id}`); return { exists: !!d, data: () => clone(d) }; },
    async set(data, opts) { const k = `${col}/${id}`; store.set(k, opts && opts.merge ? { ...(store.get(k) || {}), ...clone(data) } : clone(data)); },
  });
  let lock = Promise.resolve();
  return {
    store,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction(fn) {
      const run = lock.then(async () => {
        const writes = [];
        const out = await fn({ get: (r) => r.get(), set: (r, d, o) => writes.push([r, d, o]) });
        for (const [r, d, o] of writes) await r.set(d, o);
        return out;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
}

// Real shapes from GET /vendorOrders/{id} (POs 7024 / 7285 / 1412, read 2026-10-16).
function makeSimpro() {
  const s = { files: {}, posts: 0, loseNextAnswer: false, refuseNext: false, slowMs: 0, nextFile: 900 };
  s.pos = {
    7024: { ID: 7024, Vendor: { ID: 30, Name: "Home Depot" }, Stage: "Approved", AssignedTo: { ID: 18663, CostCenter: { ID: 39, Name: "Residential (Finish)" }, Name: "1417-18663 Residential (Finish)", Job: 1417, Section: 23701 } },
    7285: { ID: 7285, Vendor: { ID: 30, Name: "Home Depot" }, Stage: "Voided", AssignedTo: { ID: 18950, CostCenter: { ID: 38, Name: "Residential (Rough In)" }, Name: "1444-18950 Residential (Rough In)", Job: 1444, Section: 25484 } },
    7250: { ID: 7250, Vendor: { ID: 13, Name: "CED" }, Stage: "Approved", AssignedTo: { ID: 18663, Name: "1417-18663 Residential (Finish)", Job: 1417 } },
    7300: { ID: 7300, Vendor: { ID: 31, Name: "Amazon" }, Stage: "Approved", AssignedTo: { ID: 5, Name: "1155-5 Residential (Rough In)", Job: 1155 } },
    1412: { ID: 1412, Vendor: { ID: 13, Name: "CED" }, Stage: "Approved", AssignedTo: { ID: 1267, CostCenter: { ID: 42, Name: "Change Order" }, Name: "328-1267 Change Order", Job: 328, Section: 757 } },
  };
  s.req = async (method, p, body) => {
    await new Promise((r) => setTimeout(r, 2));
    let m;
    if (method === "GET" && (m = p.match(/^\/vendorOrders\/(\d+)$/))) {
      const po = s.pos[m[1]];
      return po ? { ok: true, status: 200, data: JSON.parse(JSON.stringify(po)) } : { ok: false, status: 404, data: { errors: [{ message: "Not found" }] } };
    }
    if (method === "GET" && (m = p.match(/^\/vendorOrders\/(\d+)\/attachments\/files\//))) return { ok: true, status: 200, data: (s.files[m[1]] || []).map(f => ({ ID: f.ID, Filename: f.Filename })) };
    if (method === "POST" && (m = p.match(/^\/vendorOrders\/(\d+)\/attachments\/files\/$/))) {
      s.posts++;
      if (s.slowMs) await new Promise((r) => setTimeout(r, s.slowMs));
      if (s.refuseNext) { s.refuseNext = false; return { ok: false, status: 422, data: { errors: [{ message: "Filename is required" }] } }; }
      const f = { ID: String(s.nextFile++), Filename: body.Filename, Base64Data: body.Base64Data };
      (s.files[m[1]] = s.files[m[1]] || []).push(f);
      if (s.loseNextAnswer) { s.loseNextAnswer = false; return { ok: false, status: 504, data: "gateway timeout" }; }
      return { ok: true, status: 201, data: { ID: f.ID, Filename: f.Filename } };
    }
    return { ok: false, status: 404, data: { errors: [{ message: `fake has no ${method} ${p}` }] } };
  };
  return s;
}

// A small but real JPEG header + filler, as base64.
const jpeg = (bytes) => { const b = Buffer.alloc(bytes, 7); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; b[3] = 0xE0; return b.toString("base64"); };
const USERS = { braden: { name: "Braden Davis", access: "standard" }, koy: { name: "Koy Wilkinson", role: "admin" }, sub: { name: "Sparky Sub", access: "contractor" } };

function setup(cfg) {
  const db = makeDb(); const simpro = makeSimpro();
  db.store.set("gc_config/material_po", cfg || { mode: "live" });
  db.store.set("jobs/J1417", { data: { name: "Room Remodel", simproNo: "1417" } });
  db.store.set("jobs/J1412", { data: { name: "Battle Creek Plaza A&B", simproNo: "1412" } });
  const { attachStoreReceipt } = require(path.join(__dirname, "../functions/materialPO/receipt.js"))({
    functions, db, TZ: "America/Denver", simproReqWithRetry: simpro.req,
    requireMember: async (d) => { const u = USERS[d.by]; if (!u) throw new HttpsError("permission-denied", "who?"); return u; },
    accessOf: (u) => u.access || (u.role === "admin" ? "admin" : "limited"),
    sleep: (ms) => new Promise(r => setTimeout(r, Math.min(ms, 20))),
  });
  const call = (o = {}) => attachStoreReceipt({ by: "braden", jobId: "J1417", phase: "finish", orderId: "1791484665123", source: "Home Depot", po: "7024", receiptId: "rabc123def", photo: jpeg(900 * 1024), ...o });
  return { db, simpro, call };
}
const rejects = async (p, code, m) => { try { await p; } catch (e) { if (code) assert.strictEqual(e.code, code, `${m}: got ${e.code} ${e.message}`); return e; } assert.fail(`${m}: expected a refusal`); };
const logs = (db) => [...db.store.entries()].filter(([k]) => k.startsWith("material_receipt_log/")).map(([, v]) => v);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });

// ── the app's helpers, straight out of src/App.js ──
const src = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); if (i < 0 || j < i) { console.error(`receipt-sim: markers not found: ${a}`); process.exit(1); } return src.slice(i, j); };
const app = {};
vm.runInNewContext(
  slice("const PO_SEND_KIND", "const poPlainLines") + slice("// STORE_RECEIPT_HELPERS_START", "// STORE_RECEIPT_HELPERS_END")
  + "\nObject.assign(out, { poSendKind, receiptList, receiptState, receiptNudgeFor, receiptShrinkPlan, newReceiptId, RECEIPT_TARGET_BYTES, RECEIPT_SEND_MAX, RECEIPT_MAX_SIDE });",
  { out: app, Math, Date, String, Array });

let n = 0; const t = async (name, fn) => { skew = 0; try { await fn(); } catch (e) { console.error(`receipt-sim FAILED: ${name}\n`, e); process.exit(1); } n++; };

(async () => {
  await t("good attach: one file on PO 7024, named for the crew member and the day", async () => {
    const { db, simpro, call } = setup();
    const r = await call();
    assert(r.ok && !r.again);
    assert.strictEqual(r.poNo, "7024");
    assert.strictEqual(r.fileName, `PO 7024 receipt – Braden Davis – ${today}.jpg`, "Simpro shows no AddedBy for API uploads, so the name + date ride in the filename");
    assert.strictEqual(simpro.posts, 1);
    assert.strictEqual(simpro.files[7024].length, 1);
    assert.strictEqual(simpro.files[7024][0].Base64Data, jpeg(900 * 1024), "the photo goes up byte for byte");
    assert.strictEqual(r.simproFileId, simpro.files[7024][0].ID);
    assert.strictEqual(logs(db)[0].status, "done");
    assert.strictEqual(logs(db)[0].md5.length, 32, "the claim keeps a fingerprint, never the photo");
    assert(!("photo" in logs(db)[0]), "the photo isn't stored in Firestore");
  });

  await t("a second photo on the same PO is 'receipt 2'", async () => {
    const { simpro, call } = setup();
    await call();
    const r2 = await call({ receiptId: "rsecond01" });
    assert.strictEqual(r2.fileName, `PO 7024 receipt 2 – Braden Davis – ${today}.jpg`);
    assert.strictEqual(simpro.files[7024].length, 2);
  });

  await t("PO box formats: 'PO-7024', '#7024' work", async () => {
    const { simpro, call } = setup();
    await call({ po: "PO-7024" });
    await call({ po: "#7024", receiptId: "rhash0001" });
    assert.strictEqual(simpro.files[7024].length, 2);
  });

  await t("wrong number refused: Battle Creek's card holds 1412, the job number", async () => {
    const { db, simpro, call } = setup();
    const e = await rejects(call({ jobId: "J1412", phase: "rough", po: "1412" }), "failed-precondition", "job number");
    assert.strictEqual(e.message, "1412 isn't a Home Depot PO on this job. It looks like the job number. Fix the PO number on the card, then add the photo.");
    assert(e.details && e.details.badPo, "the app remembers the bad number (Not a PO # on Bid Items)");
    assert.strictEqual(simpro.posts, 0, "nothing uploaded");
    assert.strictEqual(logs(db)[0].status, "failed", "the claim is freed, so a fixed number can go");
    const c = await rejects(call({ jobId: "J1412", phase: "rough", po: "1412", checkOnly: true }), "failed-precondition", "check only");
    assert(/job number/.test(c.message), "the sheet's check says the same thing before any photo");
  });

  await t("other wrong numbers: another job, a CED PO, no such PO, voided, not a number", async () => {
    const { simpro, call } = setup();
    const other = await rejects(call({ po: "7300" }), "failed-precondition", "another job");
    assert.strictEqual(other.message, "PO 7300 is on job 1155, not this job (1417). Fix the PO number on the card, then add the photo.");
    const ced = await rejects(call({ po: "7250" }), "failed-precondition", "CED PO");
    assert(/is a CED PO, not a Home Depot, ACE or Amazon run/.test(ced.message), ced.message);
    const none = await rejects(call({ po: "9999" }), "failed-precondition", "no PO");
    assert(/Simpro has no PO 9999/.test(none.message), none.message);
    const job2 = setup();
    job2.db.store.set("jobs/J1444", { data: { simproNo: "1444" } });
    const voided = await rejects(job2.call({ jobId: "J1444", po: "7285" }), "failed-precondition", "voided");
    assert(/voided/.test(voided.message), voided.message);
    const word = await rejects(call({ po: "tomorrow" }), "failed-precondition", "not a number");
    assert(/isn't a PO number/.test(word.message), word.message);
    assert.strictEqual(simpro.posts + job2.simpro.posts, 0, "nothing uploaded on any of them");
  });

  await t("check only: a good number answers without uploading", async () => {
    const { db, simpro, call } = setup();
    const r = await call({ checkOnly: true, photo: undefined, receiptId: undefined });
    assert(r.ok && r.check && r.poNo === "7024" && r.vendor === "Home Depot");
    assert.strictEqual(simpro.posts, 0); assert.strictEqual(logs(db).length, 0);
  });

  await t("double tap: three simultaneous taps attach once", async () => {
    const { simpro, call } = setup();
    simpro.slowMs = 60;
    const rs = await Promise.all([call(), call(), call()]);
    assert.strictEqual(simpro.posts, 1, "one upload");
    assert.strictEqual(simpro.files[7024].length, 1, "one file on the PO");
    assert(rs.every(r => r.ok && r.fileName === rs[0].fileName), "every tap gets the same answer");
    assert.strictEqual(rs.filter(r => r.again).length, 2, "the extra taps waited for the first");
    const again = await call();
    assert(again.again && simpro.posts === 1, "a later retry of the same photo returns the same file");
  });

  await t("lost answer: the file is found on the PO instead of uploaded twice", async () => {
    const { db, simpro, call } = setup();
    simpro.loseNextAnswer = true;
    await rejects(call(), "unavailable", "lost answer");
    assert.strictEqual(logs(db)[0].status, "unknown");
    await rejects(call(), "unavailable", "too soon");        // waits a minute before checking
    skew = 65e3;
    const r = await call();
    assert(r.ok && r.again, "recovered");
    assert.strictEqual(simpro.posts, 1, "never uploaded again");
    assert.strictEqual(simpro.files[7024].length, 1);
    assert.strictEqual(r.simproFileId, simpro.files[7024][0].ID);
  });

  await t("Simpro refuses the upload: plain error, the same photo can go again", async () => {
    const { simpro, call } = setup();
    simpro.refuseNext = true;
    const e = await rejects(call(), "internal", "refused");
    assert(/Simpro didn't take the photo/.test(e.message));
    const r = await call();
    assert(r.ok && simpro.files[7024].length === 1);
  });

  await t("a photo over 10 MB: the app shrinks it; the server refuses one that slips through", async () => {
    // App: a 12 MP phone photo (4032×3024, ~12 MB as taken) is redrawn at 2000 px.
    const first = app.receiptShrinkPlan(4032, 3024, 0, 0);
    assert.deepStrictEqual([first.w, first.h], [2000, 1500]);
    assert(first.q >= 0.8, "good quality first");
    // A fake encoder whose output tracks pixels × quality: the loop stops at ~1 MB.
    const encode = (p) => Math.round(p.w * p.h * p.q * 1.25);
    let plan = first, bytes = 0, tries = 0;
    while (plan) { bytes = encode(plan); tries++; plan = app.receiptShrinkPlan(4032, 3024, bytes, plan.step + 1); }
    assert(bytes <= app.RECEIPT_TARGET_BYTES, `shrunk to ${bytes} bytes`);
    assert(tries <= 6, "a few tries at most");
    // An encoder that never gets small: the loop still ends, and the app's cap is under the server's.
    plan = first; tries = 0;
    while (plan) { tries++; plan = app.receiptShrinkPlan(4032, 3024, 50e6, plan.step + 1); }
    assert.strictEqual(tries, 6, "gives up after six tries (then the app says it's too big)");
    assert(app.RECEIPT_SEND_MAX < R.RECEIPT_MAX_BYTES, "the app refuses before the server would");
    assert(app.RECEIPT_SEND_MAX * 4 / 3 < 10 * 1024 * 1024, "what the app sends fits the 10 MB callable limit");
    assert.strictEqual(app.receiptShrinkPlan(800, 600, 0, 0).w, 800, "a small photo is never blown up");
    // Server: an 11 MB photo is refused before any claim or upload.
    const { db, simpro, call } = setup();
    const e = await rejects(call({ photo: jpeg(11 * 1024 * 1024) }), "invalid-argument", "too big");
    assert(/too big to send/.test(e.message), e.message);
    const notJpeg = await rejects(call({ photo: Buffer.alloc(5000, 1).toString("base64") }), "invalid-argument", "not a jpeg");
    assert(/didn't come through as a picture/.test(notJpeg.message));
    assert.strictEqual(simpro.posts, 0); assert.strictEqual(logs(db).length, 0);
  });

  await t("who: contractors can't, test mode is admins only, the off switches work", async () => {
    let s = setup();
    await rejects(s.call({ by: "sub" }), "permission-denied", "contractor");
    s = setup({ mode: "test" });
    await rejects(s.call(), "permission-denied", "test mode, crew");
    assert((await s.call({ by: "koy" })).ok, "test mode, admin");
    s = setup({ mode: "live", receipts: "off" });
    await rejects(s.call(), "failed-precondition", "receipts off");
    s = setup({ mode: "off" });
    await rejects(s.call(), "failed-precondition", "PO switch off");
    s = setup();
    await rejects(s.call({ source: "CED" }), "invalid-argument", "CED card");
    await rejects(s.call({ receiptId: "x" }), "invalid-argument", "bad receipt id");
  });

  await t("the card: badge state, the once-only reminder", async () => {
    const card = { id: "c1", source: "Home Depot", po: "7024", pickedUp: true };
    assert.strictEqual(app.receiptState(card), "missing");
    assert.strictEqual(app.receiptState({ ...card, receipts: [{ id: "r1", name: "x" }] }), "have");
    assert.strictEqual(app.receiptState({ ...card, po: "1412", receiptBadPo: "1412" }), "badpo");
    assert.strictEqual(app.receiptState({ ...card, po: "7031", receiptBadPo: "1412" }), "missing", "fixing the number clears Not a PO #");
    assert.strictEqual(app.receiptState({ ...card, source: "CED" }), "none", "CED cards have no receipt box");
    assert.strictEqual(app.receiptState({ ...card, po: "" }), "none", "no PO # yet → no box");
    assert.strictEqual(app.receiptState({ ...card, source: "Amazon" }), "missing");
    const asked = new Set();
    assert(app.receiptNudgeFor(card, asked)); asked.add("c1");
    assert(!app.receiptNudgeFor(card, asked), "asks once");
    assert(!app.receiptNudgeFor({ ...card, id: "c2", receipts: [{ id: "r" }] }, asked), "no reminder once a receipt is on");
    assert(/^r[a-z0-9]{6,}$/.test(app.newReceiptId()) && R.receiptKey("J1417", "finish", "c1", app.newReceiptId()), "the app's photo ids are valid claim keys");
    assert(R.receiptKey("J1", "comm", "c1", "rabc123def"), "commercial Materials cards work too");
  });

  console.log(`receipt-sim: ${n} scenarios passed`);
})();
