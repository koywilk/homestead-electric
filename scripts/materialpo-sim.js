// Crew POs from the app — handler simulation. Run: node scripts/materialpo-sim.js (prebuild chain).
// Drives the REAL functions/materialPO/send.js against a fake Firestore, a fake
// Simpro and a fake email service, and checks the safety rules from the
// 2026-10-08 review: never two POs for one card, test sends reach only the test
// inbox, a failed email retries without a new PO, a lost Simpro answer is
// recovered instead of duplicated.
"use strict";
const assert = require("assert");
const path = require("path");
// The PDF needs pdf-lib from functions/node_modules. The root build (Vercel) doesn't
// install those, so there the sim checks the fallback (list in the email) instead.
let HAS_PDF = true;
try { require.resolve("pdf-lib", { paths: [path.join(__dirname, "../functions")] }); } catch (e) { HAS_PDF = false; }

// ── clock ──
const realNow = Date.now;
let skew = 0;
Date.now = () => realNow() + skew;
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + skew); } static now() { return RealDate.now() + skew; } static parse(s) { return RealDate.parse(s); } static UTC(...a) { return RealDate.UTC(...a); } };

// ── fake firebase-functions (v1 shape) ──
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const functions = { https: { HttpsError, onCall: (fn) => fn }, runWith() { return this; }, logger: { info() {}, warn() {} } };

// ── fake Firestore with serialized transactions ──
function makeDb() {
  const store = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ref = (col, id) => ({
    id, _k: `${col}/${id}`,
    async get() { const d = store.get(`${col}/${id}`); return { exists: !!d, data: () => clone(d) }; },
    async set(data, opts) { const k = `${col}/${id}`; store.set(k, opts && opts.merge ? { ...(store.get(k) || {}), ...clone(data) } : clone(data)); },
  });
  let lock = Promise.resolve();
  const db = {
    store,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction(fn) {
      const run = lock.then(async () => {
        const writes = [];
        const tx = { get: (r) => r.get(), set: (r, d, o) => writes.push([r, d, o]) };
        const out = await fn(tx);
        for (const [r, d, o] of writes) await r.set(d, o);
        return out;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
  return db;
}

// ── fake Simpro ──
function makeSimpro() {
  const s = { pos: [], nextId: 7300, loseNextAnswer: false, refuseNext: false, patches: [] };
  s.req = async (method, p, body) => {
    await new Promise((r) => setTimeout(r, 2));
    if (method === "GET" && p.startsWith("/vendors/")) return { ok: true, status: 200, data: [
      { ID: 13, Name: "CED", Email: "homestead@cedaf.example" }, { ID: 30, Name: "Home Depot", Email: "" }, { ID: 4, Name: "Ace Rentals" }] };
    if (method === "GET" && p.startsWith("/storageDevices/")) return { ok: true, status: 200, data: [{ ID: 1, Name: "Shop" }] };
    if (method === "GET" && p.startsWith("/setup/statusCodes/")) return { ok: true, status: 200, data: [{ ID: 24, Name: "Purchase Orders : Sent to Supplier" }] };
    if (method === "GET" && p.startsWith("/employees/?")) return { ok: true, status: 200, data: [{ ID: 100, Name: "Keegan Wilkinson" }, { ID: 1, Name: "Koy Wilkinson" }] };
    if (method === "GET" && /^\/employees\/\d+$/.test(p)) return { ok: true, status: 200, data: { Name: "Keegan Wilkinson", Position: "Project Lead", PrimaryContact: { Email: "keegan@homesteadelectric.example", CellPhone: "(801) 874-9395" } } };
    if (method === "GET" && /^\/jobs\/1438\/sections\/$/.test(p)) return { ok: true, status: 200, data: [{ ID: 26935, Name: "Change Order - 10/7/26", DisplayOrder: 2 }, { ID: 25087, Name: "Base", DisplayOrder: 1 }] };
    if (method === "GET" && /sections\/26935\/costCenters/.test(p)) return { ok: true, status: 200, data: [
      { ID: 19094, Name: "Pool Feed, Compressor and Pressure Washer Power", CostCenter: { Name: "Residential (Rough In)" } }] };
    if (method === "GET" && /costCenters/.test(p)) return { ok: true, status: 200, data: [
      { ID: 18864, Name: "Rough In ", CostCenter: { Name: "Residential (Rough In)" } }, { ID: 18865, Name: "Finish", CostCenter: { Name: "Residential (Finish)" } }] };
    if (method === "GET" && /^\/jobs\/1438\?/.test(p)) return { ok: true, status: 200, data: { ID: 1438, Name: "Miller Residence - Alpine", Site: { ID: 6576 } } };
    if (method === "GET" && p === "/sites/6576") return { ok: true, status: 200, data: { Address: { Address: "1732 East Elk Ridge Lane", City: "Alpine", State: "UT", PostalCode: "84004" } } };
    if (method === "GET" && /^\/vendors\/\d+$/.test(p)) return { ok: true, status: 200, data: { Address: { Address: "698 East 1300 South", City: "American Fork", State: "UT", PostalCode: "84003" } } };
    if (method === "GET" && p === "") return { ok: true, status: 200, data: { Name: "Homestead Electric", Phone: "(801) 992-1588", Email: "bids@homesteadelectric.net", Address: { Line1: "974 S Main St, Pleasant Grove UT 84062" } } };
    if (method === "GET" && p.startsWith("/vendorOrders/?")) return { ok: true, status: 200, data: [...s.pos].reverse().map(o => ({ ID: o.ID, PrivateNotes: o.PrivateNotes })) };
    if (method === "POST" && p === "/vendorOrders/") {
      s.posts = (s.posts || 0) + 1;
      if (s.refuseNext || s.refuseCcId === body.AssignedTo) { s.refuseNext = false; s.refuseCcId = null; return { ok: false, status: 422, data: { errors: [{ message: "Vendor is required" }] } }; }
      const po = { ID: s.nextId++, ...body }; s.pos.push(po);
      if (s.loseNextAnswer) { s.loseNextAnswer = false; return { ok: false, status: 504, data: "gateway timeout" }; }
      return { ok: true, status: 201, data: { ID: po.ID } };
    }
    if (method === "PATCH" && /^\/vendorOrders\/\d+$/.test(p)) { s.patches.push({ p, body }); return { ok: true, status: 200, data: {} }; }
    return { ok: false, status: 404, data: { errors: [{ message: `fake has no ${method} ${p}` }] } };
  };
  return s;
}

// ── fake email service ──
const mails = []; let failMail = 0;
global.fetch = async (url, opts) => {
  assert.strictEqual(url, "https://api.resend.com/emails", "only Resend is called directly");
  if (failMail > 0) { failMail--; return { ok: false, status: 500, text: async () => "down", json: async () => ({}) }; }
  mails.push(JSON.parse(opts.body));
  return { ok: true, status: 200, json: async () => ({ id: `em_${mails.length}` }), text: async () => "" };
};

const USERS = { koy: { name: "Koy Wilkinson", role: "admin" }, keegan: { name: "Keegan Wilkinson", access: "manager" } };
function setup(mode, extraCfg, gmailSend) {
  const db = makeDb(); const simpro = makeSimpro();
  if (mode || extraCfg) db.store.set("gc_config/material_po", { ...(mode ? { mode } : {}), ...(extraCfg || {}) });
  db.store.set("jobs/J1438", { data: { name: "Miller Residence", simproNo: "1438" } });
  const { sendMaterialPO, sendMaterialOrder } = require(path.join(__dirname, "../functions/materialPO/send.js"))({
    functions, db, TZ: "America/Denver", simproReqWithRetry: simpro.req,
    requireMember: async (d) => { const u = USERS[d.by]; if (!u) throw new HttpsError("permission-denied", "who?"); return u; },
    accessOf: (u) => u.access || (u.role === "admin" ? "admin" : "limited"),
    loadMailConfig: async () => ({ key: "re_test", from: "onboarding@resend.dev", soakTo: "koywilkinson@gmail.example" }),
    gmailSend: gmailSend || null,
  });
  const ORDER = { by: "koy", jobId: "J1438", phase: "rough", orderId: "o1791500000000", source: "CED", get: "willcall", date: "10/9/2026", clientTest: true,
    groups: [
      { ccId: 18864, items: [{ catalogId: 9958, part: "NMB KS14/2X500", name: "NM-B-14/2-WG-CU-500CL", qty: 3750 }], typed: [] },
      { ccId: 19094, items: [{ catalogId: 1, part: "ALUM SER1/0", name: "SER ALUMINUM 1/0-1/0-1/0-2", qty: 275 }, { catalogId: 2, part: "QO2125", name: "QO BREAKER PLUG IN 2P 240V 125A", qty: 1 }],
        typed: ["Please bundle the SER on one reel"] },
    ] };
  return { db, simpro, order: (o = {}) => sendMaterialOrder({ ...ORDER, ...o }), send: (o = {}) => sendMaterialPO({ by: "koy", jobId: "J1438", phase: "rough", orderId: "1791484665123", source: "CED", items: "10x spanners<br>500' 12/2 romex", get: "willcall", date: "10/9/2026", clientTest: true, ...o }) };
}
const rejects = async (p, code, m) => { try { await p; } catch (e) { if (code) assert.strictEqual(e.code, code, `${m}: got ${e.code} ${e.message}`); return e; } assert.fail(`${m}: expected a refusal`); };
let n = 0; const t = async (name, fn) => { mails.length = 0; failMail = 0; skew = 0; await fn(); n++; };

(async () => {
  await t("test send: one PO, email only to the test inbox", async () => {
    const { simpro, send } = setup(null);           // no config doc = test
    const r = await send();
    assert.strictEqual(simpro.pos.length, 1, "one PO");
    assert.strictEqual(r.poNo, "7300"); assert.strictEqual(r.mode, "test"); assert(r.emailOk, "emailed");
    assert.strictEqual(mails.length, 1);
    assert.deepStrictEqual(mails[0].to, ["koywilkinson@gmail.example"], "test inbox only");
    assert(!mails[0].cc && !mails[0].reply_to, "nobody copied in test");
    assert(mails[0].subject.startsWith("[TEST] PO 7300 – Miller Residence - Alpine"), mails[0].subject);
    assert(/TEST from the Command Center/.test(simpro.pos[0].PrivateNotes), "Simpro PO marked TEST");
    assert.strictEqual(simpro.pos[0].AssignedTo, 18864, "rough cost center"); assert.strictEqual(simpro.pos[0].Vendor, 13);
    assert.strictEqual(simpro.pos[0].DueDate, "2026-10-09");
    assert.strictEqual(simpro.patches.length, 1, "marked Sent to Supplier");
    assert.strictEqual(simpro.patches[0].body.StatusAutoAdjust, true, "auto-adjust stays on, like a Simpro Mobile PO, so receipting completes it");
    const att = mails[0].attachments || [];
    if (HAS_PDF) {
      assert.strictEqual(att.length, 1, "the PO form PDF is attached");
      assert.strictEqual(att[0].filename, "Purchase_Order_No_7300.pdf", "named like Simpro's");
      assert(Buffer.from(att[0].content, "base64").slice(0, 5).toString() === "%PDF-", "a real PDF");
      assert(/is attached/.test(mails[0].html) && !/<li/.test(mails[0].html), "Simpro wording; the list lives in the PDF");
    } else {
      assert.strictEqual(att.length, 0, "no PDF library here: nothing attached");
      assert(/<li/.test(mails[0].html) && !/is attached/.test(mails[0].html), "fallback: the list is in the email");
    }
  });

  await t("test mode: non-admins are refused before anything happens", async () => {
    const { simpro, send } = setup("test");
    await rejects(send({ by: "keegan" }), "permission-denied", "manager in test");
    assert.strictEqual(simpro.pos.length, 0); assert.strictEqual(mails.length, 0);
  });

  await t("two taps at once: one PO", async () => {
    const { simpro, send } = setup("test");
    const out = await Promise.allSettled([send(), send(), send()]);
    assert.strictEqual(simpro.pos.length, 1, `exactly one PO (got ${simpro.pos.length})`);
    const ok = out.filter(o => o.status === "fulfilled");
    assert(ok.length >= 1, "at least one answered");
    for (const o of out) if (o.status === "rejected") assert.strictEqual(o.reason.code, "already-exists", o.reason.message);
    assert.strictEqual(mails.length, 1, "one email");
    const again = await send();
    assert.strictEqual(again.poNo, "7300"); assert(again.again, "a later tap returns the same PO"); assert.strictEqual(simpro.pos.length, 1);
  });

  await t("email fails: PO kept, retry emails without a new PO", async () => {
    const { simpro, send } = setup("test");
    failMail = 1;
    const r1 = await send();
    assert.strictEqual(r1.emailOk, false); assert.strictEqual(r1.poNo, "7300");
    const r2 = await send();
    assert.strictEqual(r2.poNo, "7300"); assert.strictEqual(r2.emailOk, true);
    assert.strictEqual(simpro.pos.length, 1, "no second PO"); assert.strictEqual(mails.length, 1);
  });

  await t("lost Simpro answer: no duplicate, recovered by claim id", async () => {
    const { simpro, send } = setup("test");
    simpro.loseNextAnswer = true;
    await rejects(send(), "unavailable", "unclear answer");
    assert.strictEqual(simpro.pos.length, 1, "Simpro did make it");
    await rejects(send(), "unavailable", "too soon to check");
    skew = 2 * 60e3;
    const r = await send();
    assert.strictEqual(r.poNo, "7300", "adopted the PO Simpro made"); assert(r.emailOk);
    assert.strictEqual(simpro.pos.length, 1, "still one PO"); assert.strictEqual(mails.length, 1);
  });

  await t("Simpro refuses: card freed, next try creates", async () => {
    const { simpro, send } = setup("test");
    simpro.refuseNext = true;
    await rejects(send(), "internal", "refused");
    assert.strictEqual(simpro.pos.length, 0);
    const r = await send();
    assert.strictEqual(r.poNo, "7300"); assert.strictEqual(simpro.pos.length, 1);
  });

  await t("live: old app copies refused, new ones email CED with bids@ and the sender copied", async () => {
    const { simpro, send } = setup("live");
    await rejects(send({ by: "keegan" }), "failed-precondition", "old build says test");
    assert.strictEqual(simpro.pos.length, 0);
    const r = await send({ by: "keegan", clientTest: false });
    assert.strictEqual(r.mode, "live");
    assert.deepStrictEqual(mails[0].to, ["homestead@cedaf.example"]);
    assert.deepStrictEqual(mails[0].cc, ["bids@homesteadelectric.net", "keegan@homesteadelectric.example"]);
    assert.strictEqual(mails[0].reply_to, "keegan@homesteadelectric.example");
    assert(!/TEST/.test(mails[0].subject + mails[0].html), "no test marks live");
  });

  await t("live PO whose email failed, switch flipped back to test: retry goes only to the test inbox", async () => {
    const { db, simpro, send } = setup("live");
    failMail = 1;
    const r1 = await send({ clientTest: false });
    assert.strictEqual(r1.emailOk, false);
    db.store.set("gc_config/material_po", { mode: "test" });
    const r2 = await send();
    assert(r2.emailOk);
    assert.deepStrictEqual(mails[0].to, ["koywilkinson@gmail.example"], "never the supplier while on test");
    assert(!mails[0].cc, "nobody copied");
    assert.strictEqual(simpro.pos.length, 1);
  });

  await t("a test send doesn't block the real one once live", async () => {
    const { db, simpro, send } = setup("test");
    await send();
    db.store.set("gc_config/material_po", { mode: "live" });
    const r = await send({ clientTest: false });
    assert.strictEqual(r.mode, "live"); assert.strictEqual(r.poNo, "7301", "a new live PO");
    assert.strictEqual(simpro.pos.length, 2);
    assert([...db.store.keys()].some(k => k.includes("__test_")), "test log archived");
  });

  await t("store run: number only, no email", async () => {
    const { simpro, send } = setup("test");
    const r = await send({ source: "Home Depot", items: "" });
    assert.strictEqual(r.kind, "number"); assert.strictEqual(r.poNo, "7300");
    assert.strictEqual(mails.length, 0); assert.strictEqual(simpro.pos[0].Vendor, 30);
  });

  await t("bad input never reaches Simpro", async () => {
    const { simpro, send } = setup("test");
    await rejects(send({ source: "Platt" }), "invalid-argument", "unknown supplier");
    await rejects(send({ items: "" }), "invalid-argument", "empty list");
    await rejects(send({ phase: "gear" }), "invalid-argument", "bad phase");
    await rejects(send({ jobId: "NOPE" }), "not-found", "unknown job");
    assert.strictEqual(simpro.pos.length, 0);
  });

  // ── Orders from the bid: one PO per cost center, one email ──
  await t("order: one PO per cost center on the right cost center, one test email with both forms", async () => {
    const { simpro, order } = setup("test");
    const r = await order();
    assert(r.ok, JSON.stringify(r));
    assert.strictEqual(simpro.pos.length, 2, "two POs");
    assert.deepStrictEqual(simpro.pos.map(p => p.AssignedTo), [18864, 19094], "each on its own cost center");
    assert.deepStrictEqual(r.pos.map(p => p.poNo), ["7300", "7301"]);
    assert(/Base · Rough In/.test(r.pos[0].costCenter) && /Change Order - 10\/7\/26 · Pool Feed/.test(r.pos[1].costCenter), "cost center names from Simpro");
    assert(/3750 x NMB KS14\/2X500 NM-B-14\/2-WG-CU-500CL/.test(simpro.pos[0].VendorNotes), "bid item in supplier notes");
    assert(/275 x ALUM SER1\/0/.test(simpro.pos[1].VendorNotes) && /bundle the SER/.test(simpro.pos[1].VendorNotes), "items + typed on PO 2");
    assert(/Part of one order/.test(simpro.pos[0].PrivateNotes), "private note says it's one order");
    assert.strictEqual(mails.length, 1, "one email");
    assert.deepStrictEqual(mails[0].to, ["koywilkinson@gmail.example"], "test inbox only");
    assert(!mails[0].cc, "nobody copied in test");
    assert(mails[0].subject.startsWith("[TEST] POs 7300 & 7301 – "), mails[0].subject);
    assert(/7300 and 7301/.test(mails[0].html), "both PO numbers in the email");
    if (HAS_PDF) assert.deepStrictEqual((mails[0].attachments || []).map(a => a.filename), ["Purchase_Order_No_7300.pdf", "Purchase_Order_No_7301.pdf"], "one form per PO");
    assert.strictEqual(simpro.patches.length, 2, "both marked Sent to Supplier");
  });

  await t("order: three taps at once still make two POs and one email", async () => {
    const { simpro, order } = setup("test");
    const out = await Promise.allSettled([order(), order(), order()]);
    assert.strictEqual(simpro.pos.length, 2, `two POs (got ${simpro.pos.length})`);
    assert.strictEqual(mails.length, 1, `one email (got ${mails.length})`);
    for (const o of out) if (o.status === "rejected") assert.strictEqual(o.reason.code, "already-exists", o.reason.message);
    const again = await order();
    assert(again.ok && again.pos.map(p => p.poNo).join() === "7300,7301", "a later tap returns the same two POs");
    assert.strictEqual(simpro.pos.length, 2); assert.strictEqual(mails.length, 1, "no second email");
  });

  await t("order: one cost center refused, Send again finishes without remaking the first", async () => {
    const { simpro, order } = setup("test");
    simpro.refuseCcId = 19094;
    const r1 = await order();
    assert.strictEqual(r1.ok, false); assert.strictEqual(r1.pos.length, 1, "first PO kept"); assert.strictEqual(r1.failed.ccId, 19094);
    assert.strictEqual(mails.length, 0, "no email until every PO exists");
    const r2 = await order();
    assert(r2.ok); assert.deepStrictEqual(r2.pos.map(p => p.poNo), ["7300", "7301"]);
    assert.strictEqual(simpro.pos.length, 2, "no duplicate of the first"); assert.strictEqual(mails.length, 1);
  });

  await t("order: Send again without a cost center whose PO is made still emails that PO", async () => {
    const { simpro, order } = setup("test");
    simpro.refuseCcId = 19094;
    const r1 = await order();
    assert.strictEqual(r1.ok, false); assert.strictEqual(r1.pos.length, 1);
    // The crew emptied the first cost center before tapping Send again.
    const r2 = await order({ groups: [{ ccId: 19094, items: [{ catalogId: 2, part: "QO2125", name: "QO BREAKER PLUG IN 2P 240V 125A", qty: 1 }], typed: [] }] });
    assert(r2.ok && r2.emailOk); assert.deepStrictEqual(r2.pos.map(p => p.poNo).sort(), ["7300", "7301"], "both POs come back");
    assert.strictEqual(simpro.pos.length, 2); assert.strictEqual(mails.length, 1);
    assert(/POs 7301 & 7300|POs 7300 & 7301/.test(mails[0].subject), mails[0].subject);
    if (HAS_PDF) assert.strictEqual((mails[0].attachments || []).length, 2, "both PO forms attached");
  });

  await t("order: Finish sending from a card (no groups) emails what the order made, once", async () => {
    const { simpro, order } = setup("test");
    failMail = 1;
    const r1 = await order();
    assert(r1.ok && r1.emailOk === false);
    const r2 = await order({ groups: [], resume: true });
    assert(r2.ok && r2.emailOk, "finished"); assert.deepStrictEqual(r2.pos.map(p => p.poNo).sort(), ["7300", "7301"]);
    assert.strictEqual(simpro.pos.length, 2, "no new POs"); assert.strictEqual(mails.length, 1);
    const r3 = await order({ groups: [], resume: true });
    assert(r3.ok && r3.emailOk && r3.again, "a second Finish is a no-op"); assert.strictEqual(mails.length, 1, "no second email");
  });

  await t("order: Finish sending with nothing made is refused; empty without resume is refused", async () => {
    const { simpro, order } = setup("test");
    await rejects(order({ groups: [], resume: true, orderId: "o-nothing" }), "failed-precondition", "nothing made");
    await rejects(order({ groups: [] }), "invalid-argument", "empty order");
    assert.strictEqual(simpro.pos.length, 0); assert.strictEqual(mails.length, 0);
  });

  await t("order: something added to an order already emailed gets its own email with only the new PO", async () => {
    const { simpro, order } = setup("test");
    const r1 = await order();
    assert(r1.ok && r1.emailOk); assert.strictEqual(mails.length, 1);
    const more = { ccId: 18865, items: [{ catalogId: 7, part: "RAB R3-15B", name: "RAB 3IN CAN", qty: 12 }], typed: [] };
    const base = [
      { ccId: 18864, items: [{ catalogId: 9958, part: "NMB KS14/2X500", name: "NM-B-14/2-WG-CU-500CL", qty: 3750 }], typed: [] },
      { ccId: 19094, items: [{ catalogId: 2, part: "QO2125", name: "QO BREAKER PLUG IN 2P 240V 125A", qty: 1 }], typed: [] }];
    const r2 = await order({ groups: [...base, more] });
    assert(r2.ok && r2.emailOk); assert.strictEqual(simpro.pos.length, 3, "only the new cost center made a PO");
    assert.strictEqual(mails.length, 2, "a second email for the addition");
    assert(/PO 7302 /.test(mails[1].subject) && !/7300|7301/.test(mails[1].subject), mails[1].subject);
    if (HAS_PDF) assert.strictEqual((mails[1].attachments || []).length, 1, "only the new PO form");
    await order({ groups: [...base, more] });
    assert.strictEqual(mails.length, 2, "tapping again sends nothing new");
  });

  await t("gmail: live order goes through Google as bids@ with every PO form, never through Resend", async () => {
    const sent = [];
    const { simpro, order } = setup("live", null, async (m) => { sent.push(m); return { ok: true, id: "g1", via: "gmail" }; });
    const r = await order({ clientTest: false });
    assert(r.ok && r.emailOk, JSON.stringify(r));
    assert.strictEqual(sent.length, 1, "one Google email"); assert.strictEqual(mails.length, 0, "Resend not used");
    const m = sent[0];
    assert.strictEqual(m.user, "koy@homesteadelectric.net"); assert.strictEqual(m.fromAddr, "bids@homesteadelectric.net");
    assert.deepStrictEqual(m.to, ["homestead@cedaf.example"]);
    assert(m.cc.includes("bids@homesteadelectric.net"), "bids@ copied");
    if (HAS_PDF) assert.strictEqual((m.attachments || []).length, 2, "both PO forms");
    assert.strictEqual(simpro.pos.length, 2);
  });

  await t("gmail: a Google failure is a visible failure (no .cc fallback); Send again finishes once", async () => {
    let fail = 1; const sent = [];
    const { simpro, order } = setup("live", null, async (m) => { if (fail-- > 0) return { ok: false, error: "Google email: refused" }; sent.push(m); return { ok: true, id: "g2" }; });
    const r1 = await order({ clientTest: false });
    assert(r1.ok && r1.emailOk === false && /Google/.test(r1.emailError), JSON.stringify(r1));
    assert.strictEqual(mails.length, 0, "never falls back to Resend");
    const r2 = await order({ clientTest: false });
    assert(r2.emailOk); assert.strictEqual(sent.length, 1); assert.strictEqual(simpro.pos.length, 2, "no new POs");
  });

  await t("gmail: sender 'resend' in the config still uses Resend; test mode via Google goes to the test inbox only", async () => {
    const sent = [];
    const a = setup("live", { sender: "resend" }, async (m) => { sent.push(m); return { ok: true }; });
    const r = await a.order({ clientTest: false });
    assert(r.emailOk); assert.strictEqual(sent.length, 0); assert.strictEqual(mails.length, 1, "Resend used");
    mails.length = 0;
    const b = setup("test", null, async (m) => { sent.push(m); return { ok: true }; });
    const r2 = await b.order();
    assert(r2.emailOk); assert.strictEqual(sent.length, 1); assert.deepStrictEqual(sent[0].to, ["koywilkinson@gmail.example"], "test inbox only");
    assert(!(sent[0].cc || []).length, "nobody copied in test"); assert(/^\[TEST\]/.test(sent[0].subject));
  });

  await t("order: a cost center not on the job is refused before anything is made", async () => {
    const { simpro, order } = setup("test");
    await rejects(order({ groups: [{ ccId: 999999, items: [{ catalogId: 1, part: "X", name: "Y", qty: 1 }] }] }), "failed-precondition", "unknown cost center");
    assert.strictEqual(simpro.pos.length, 0); assert.strictEqual(mails.length, 0);
  });

  await t("order: email fails, POs kept, retry emails once without new POs", async () => {
    const { simpro, order } = setup("test");
    failMail = 1;
    const r1 = await order();
    assert(r1.ok && r1.emailOk === false);
    const r2 = await order();
    assert(r2.emailOk); assert.strictEqual(simpro.pos.length, 2); assert.strictEqual(mails.length, 1);
  });

  await t("order: two retries at once after a failed email still send one email", async () => {
    const { simpro, order } = setup("test");
    failMail = 1;
    const r1 = await order();
    assert(r1.ok && r1.emailOk === false);
    const out = await Promise.allSettled([order(), order()]);
    assert.strictEqual(mails.length, 1, `one email (got ${mails.length})`);
    assert.strictEqual(simpro.pos.length, 2);
    for (const o of out) if (o.status === "rejected") assert.strictEqual(o.reason.code, "already-exists", o.reason.message);
  });

  await t("order: live emails CED with bids@ and the sender copied; typed-only order works", async () => {
    const { simpro, order } = setup("live");
    await rejects(order({ by: "keegan" }), "failed-precondition", "old build says test");
    const r = await order({ by: "keegan", clientTest: false, groups: [{ ccId: 19094, typed: ["2 boxes 1/2\" NM connectors"] }] });
    assert(r.ok); assert.strictEqual(simpro.pos.length, 1);
    assert.deepStrictEqual(mails[0].to, ["homestead@cedaf.example"]);
    assert.deepStrictEqual(mails[0].cc, ["bids@homesteadelectric.net", "keegan@homesteadelectric.example"]);
    assert(!/TEST/.test(mails[0].subject));
  });

  await t("order: non-admins refused in test, empty orders refused", async () => {
    const { simpro, order } = setup("test");
    await rejects(order({ by: "keegan" }), "permission-denied", "manager in test");
    await rejects(order({ groups: [{ ccId: 18864, items: [], typed: [] }] }), "invalid-argument", "empty");
    assert.strictEqual(simpro.pos.length, 0);
  });

  console.log(`materialpo-sim: ${n} scenarios passed (${HAS_PDF ? "with" : "without"} the PDF library)`);
  process.exit(0);
})().catch((e) => { console.error("materialpo-sim FAILED:", e.message); process.exit(1); });
