#!/usr/bin/env node
/* duet-materials-test.js — Duet write access (connector D9), ship 8: material
 * cards and the PO sender (the first action in the plan that emails a vendor).
 *
 * Drives functions/duetWrites/materials.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction holding real-shaped jobs, AND the REAL functions/materialPO/
 * send.js (sendMaterialPO) against a fake Firestore / fake Simpro / fake Gmail
 * exactly as scripts/materialpo-sim.js does — wired through api.js's own
 * in-process path (a `functions` whose onCall hands back the handler,
 * requireMember replaced by Koy's record). Proves: + Add PO's card literal and
 * list routing (comm only on commercial jobs); appendToOpen = the newest open
 * same-source card with the helpers' <br> append; the edit / tick literals and
 * date conversion; the preview from the pure rules with a fake config (test vs
 * live recipients, number-only supplier, already-sent detection, mode off);
 * sendPo refuses without a fresh matching preview, in mode off, over its own
 * 10 / hour; passes clientTest:false ONLY in live; makes ONE Simpro PO + ONE
 * email per send, none on a refusal; a 504 is not retried and leaves the card
 * alone; writes the send sheet's exact card patch; the audit carries poNo /
 * mode / recipients and never the mail key; only jobs + duet_writes (+ the
 * sender's own material_po_log) are written. No Firebase import. Prebuild.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const MA = require(path.join(root, "functions", "duetWrites", "materials.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const R = require(path.join(root, "functions", "materialPO", "rules.js"));
const makeSend = require(path.join(root, "functions", "materialPO", "send.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";          // Tue 9:30 PM Mountain (Nov 3) — a UTC-vs-Mountain date trap on purpose
const TODAY = "2026-11-03";
const MDY = "11/3/2026";
const TZ = "America/Denver";
const MAIL_KEY = "re_SECRET_MAIL_KEY_never_in_an_audit";
const SOAK = "koy.test@homesteadelectric.example";
const USERS = [{ id: 1, name: "Koy", title: "office", access: "admin" }, { id: 3, name: "Colby", title: "foreman" }];
const FORTH = "1772863862618", GONE = "1772863862620", COMM = "1772863862621";
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── real-shaped jobs ─────────────────────────────────────────────────────────
const CED_OPEN = { id: "1761000000101", date: "", po: "", pickupDate: "", source: "CED", items: "10x spanners<br>500&#39; 12/2 romex<br>", pickedUp: false, needsOrder: true };
const CED_ORDERED = { id: "1761000000102", date: "10/30/2026", po: "7290", pickupDate: "10/31/2026", source: "CED", items: "panel", pickedUp: false, needsOrder: true, ordered: true, orderedBy: "Keegan", orderedAt: "10/30/2026" };
const HD_OPEN = { id: "1761000000103", date: "", po: "", pickupDate: "", source: "Home Depot", items: "2x 1/2&quot; EMT straps", pickedUp: false, needsOrder: true };
const SIMPRO_CARD = { id: "simpro_7001", date: "10/1/2026", po: "7001", pickupDate: "", source: "CED", items: "wire", pickedUp: true, pickedUpBy: "Colby", pickedUpAt: "10/2/2026", needsOrder: true, ordered: true, simproPulled: true, simproPoId: "7001" };
const SHOP_OPEN = { id: "1761000000104", date: "", po: "", pickupDate: "", source: "Shop", items: "staples", pickedUp: false, needsOrder: true };
const SENT_CARD = { id: "1761000000105", date: "11/1/2026", po: "7295", pickupDate: "11/2/2026", source: "CED", items: "cans", pickedUp: false, needsOrder: true, ordered: true, orderedBy: "Koy", orderedAt: "11/1/2026", simproPoId: "7295", poSentVia: "app", poSentMode: "live", poSentBy: "Koy", poSentAt: "11/1/2026", poEmailOk: true, poEmailedTo: "ced@example" };
const BASE = () => ({ name: "Forth", simproNo: "1438", foreman: "Keegan", archived: false, division: "residential",
  roughMaterials: [CED_ORDERED, CED_OPEN, HD_OPEN, SIMPRO_CARD, SHOP_OPEN], finishMaterials: [SENT_CARD], roughPunch: { upper: { general: [], rooms: [], hotcheck: [], photos: [] } }, changeOrders: [{ id: "c1" }] });
const DOC = (data) => ({ data, updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 606, w: "606.abcdefgh" });
const JOBS = () => ({
  ["jobs/" + FORTH]: DOC(BASE()),
  ["jobs/" + GONE]: DOC({ ...BASE(), name: "Gone", archived: true }),
  ["jobs/" + COMM]: DOC({ ...BASE(), name: "Battle Creek A", division: "commercial", roughMaterials: [], finishMaterials: [], commMaterials: [{ ...CED_OPEN, id: "1761000000201" }] }),
});
const ctx = (over) => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: `${TODAY}T12:00:00`, users: USERS, tz: TZ, ...(over || {}) });
const jobCtx = (id, extra) => ctx({ job: { id, data: { ...JOBS()["jobs/" + id].data, ...(extra || {}) } } });
const J = (extra) => jobCtx(FORTH, extra);

// ── fake Simpro (the sim's, trimmed) ─────────────────────────────────────────
function makeSimpro() {
  const s = { pos: [], nextId: 7300, loseNextAnswer: false, posts: 0, patches: [], gets: 0 };
  s.req = async (method, p, body) => {
    if (method === "GET") s.gets++;
    if (method === "GET" && p.startsWith("/vendors/?")) return { ok: true, status: 200, data: [{ ID: 13, Name: "CED", Email: "homestead@cedaf.example" }, { ID: 30, Name: "Home Depot", Email: "" }, { ID: 4, Name: "Ace Rentals" }] };
    if (method === "GET" && /^\/vendors\/\d+$/.test(p)) return { ok: true, status: 200, data: { Address: { Address: "698 East 1300 South", City: "American Fork", State: "UT", PostalCode: "84003" } } };
    if (method === "GET" && p.startsWith("/storageDevices/")) return { ok: true, status: 200, data: [{ ID: 1, Name: "Shop" }] };
    if (method === "GET" && p.startsWith("/setup/statusCodes/")) return { ok: true, status: 200, data: [{ ID: 24, Name: "Purchase Orders : Sent to Supplier" }] };
    if (method === "GET" && p.startsWith("/employees/?")) return { ok: true, status: 200, data: [{ ID: 1, Name: "Koy" }, { ID: 100, Name: "Keegan Wilkinson" }] };
    if (method === "GET" && /^\/employees\/\d+$/.test(p)) return { ok: true, status: 200, data: { Name: "Koy", Position: "Owner", PrimaryContact: { Email: "koy@homesteadelectric.example", CellPhone: "(801) 555-0100" } } };
    if (method === "GET" && /^\/jobs\/1438\/sections\/$/.test(p)) return { ok: true, status: 200, data: [{ ID: 25087, Name: "Base", DisplayOrder: 1 }] };
    if (method === "GET" && /costCenters/.test(p)) return { ok: true, status: 200, data: [{ ID: 18864, Name: "Rough In ", CostCenter: { Name: "Residential (Rough In)" } }, { ID: 18865, Name: "Finish", CostCenter: { Name: "Residential (Finish)" } }] };
    if (method === "GET" && /^\/jobs\/1438\?/.test(p)) return { ok: true, status: 200, data: { ID: 1438, Name: "Forth Residence", Site: { ID: 6576 } } };
    if (method === "GET" && p === "/sites/6576") return { ok: true, status: 200, data: { Address: { Address: "1 Main", City: "Alpine", State: "UT", PostalCode: "84004" } } };
    if (method === "GET" && p === "") return { ok: true, status: 200, data: { Name: "Homestead Electric", Phone: "(801) 992-1588", Email: "bids@homesteadelectric.net", Address: { Line1: "974 S Main St" } } };
    if (method === "GET" && p.startsWith("/vendorOrders/?")) return { ok: true, status: 200, data: [...s.pos].reverse().map(o => ({ ID: o.ID, PrivateNotes: o.PrivateNotes })) };
    if (method === "POST" && p === "/vendorOrders/") {
      s.posts++;
      const po = { ID: s.nextId++, ...body }; s.pos.push(po);
      if (s.loseNextAnswer) { s.loseNextAnswer = false; return { ok: false, status: 504, data: "gateway timeout" }; }
      return { ok: true, status: 201, data: { ID: po.ID } };
    }
    const am = p.match(/^\/vendorOrders\/(\d+)\/attachments\/files\//);
    if (am) { s.files = s.files || {}; const list = (s.files[am[1]] = s.files[am[1]] || []); if (method === "GET") return { ok: true, status: 200, data: list.map(f => ({ ID: f.ID, Filename: f.Filename })) }; const f = { ID: `f${list.length + 1}`, Filename: body.Filename }; list.push(f); return { ok: true, status: 201, data: { ID: f.ID } }; }
    if (method === "PATCH" && /^\/vendorOrders\/\d+$/.test(p)) { s.patches.push({ p, body }); return { ok: true, status: 200, data: {} }; }
    return { ok: false, status: 404, data: { errors: [{ message: `fake has no ${method} ${p}` }] } };
  };
  return s;
}

// ── fake io: api.js's transaction + the send factory's Firestore, ONE store ──
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const FUNCTIONS = { https: { HttpsError }, logger: { info() {}, warn() {}, error() {} } };
function fakeIo({ docs = JOBS(), mode = "test", recent = 0, liveAccess, users = USERS } = {}) {
  const log = [];
  const store = clone(docs);
  if (mode !== undefined) store["gc_config/material_po"] = { mode, ...(liveAccess ? { liveAccess } : {}) };
  store["gc_config/mail"] = { key: MAIL_KEY, soakTo: SOAK, from: "updates@homesteadelectric.net" };
  const simpro = makeSimpro();
  const mails = [];
  const sent = [];       // what reached the real handler
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r) => { log.push(["create", r.path]); throw new Error("create must never be called by a ship-8 write"); },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => { if (d[k] === undefined) throw new Error("undefined written at " + k); setPath(cur, k, d[k]); }); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  // The send factory's db: the same store, the sim's shape (serialized transactions).
  const sref = (col, id) => ({ id,
    async get() { const d = store[`${col}/${id}`]; return { exists: !!d, data: () => clone(d) }; },
    async set(data, opts) { const k = `${col}/${id}`; log.push(["sender-set", k]); store[k] = opts && opts.merge ? { ...(store[k] || {}), ...clone(data) } : clone(data); } });
  let lock = Promise.resolve();
  const sdb = { collection: (col) => ({ doc: (id) => sref(col, id) }),
    runTransaction(fn) { const run = lock.then(async () => { const w = []; const t = { get: (r) => r.get(), set: (r, d, o) => w.push([r, d, o]) }; const out = await fn(t); for (const [r, d, o] of w) await r.set(d, o); return out; }); lock = run.catch(() => {}); return run; } };
  const loadMailConfig = async () => ({ key: MAIL_KEY, from: "updates@homesteadelectric.net", soakTo: SOAK });
  const accessOf = (u) => (u && u.access) || "limited";
  const io = {
    log, store, simpro, mails, sent, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => recent, getJob: async () => null, getUsers: async () => users, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), hrRef: (id) => ref("homeowner_requests", id), auditRef: (id) => ref("duet_writes", id),
    readDoc: async (r) => { log.push(["read", r.path]); return store[r.path] || null; },
    settingsRef: (id) => { throw new api.Refusal(400, "settings/" + id + " must never be opened by a ship-8 write"); },
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }),
    // ship 8 — mirrors firestoreIo's additions over the same store
    loadPoCfg: async () => { const c = store["gc_config/material_po"] || {}; log.push(["read", "gc_config/material_po"], ["read", "gc_config/mail.soakTo"]); const m = ["off", "test", "live"].includes(c.mode) ? c.mode : "test"; return { mode: m, liveAccess: Array.isArray(c.liveAccess) && c.liveAccess.length ? c.liveAccess : ["admin", "manager", "standard", "limited"], testTo: c.testTo || SOAK, bids: c.bids || "bids@homesteadelectric.net" }; },
    readPoLog: async (jobId, phase, cardId) => { const k = R.logKey(jobId, phase, cardId); const l = k && store["material_po_log/" + k]; log.push(["read", "material_po_log/" + k]); return l ? { status: l.status || "", poNo: l.poNo || "", mode: l.mode || "", emailOk: !!l.emailOk, emailedTo: l.emailedTo || [] } : null; },
    accessOf,
    vendorEmail: async (name) => { const r = await simpro.req("GET", "/vendors/?pageSize=250&columns=ID,Name,Email"); const v = R.vendorFor({ simproName: name }, r.data); return (v && v.Email) || ""; },
    senderEmail: async () => "koy@homesteadelectric.example",
    recentActions: async (since) => Object.keys(store).filter(k => k.startsWith("duet_writes/")).map(k => store[k]).filter(a => a && a.at > since).map(a => a.action),
    sendPo: async (data, user) => {
      sent.push({ data: clone(data), user: clone(user) });
      const stub = { https: { HttpsError, onCall: (fn) => fn }, runWith() { return this; }, logger: FUNCTIONS.logger };
      const { sendMaterialPO } = makeSend({ functions: stub, db: sdb, TZ, simproReqWithRetry: simpro.req, requireMember: async () => user, accessOf, loadMailConfig,
        gmailSend: async ({ to, cc, replyTo, subject, attachments }) => { mails.push({ to, cc, replyTo, subject, attachments: (attachments || []).length }); return { ok: true, id: "gm_" + mails.length }; } });
      return sendMaterialPO(data);
    },
  };
  return io;
}
const RID = (k) => `88888888-8888-4888-8888-${String(k).padStart(12, "0")}`;
let rid = 0;
const call = (io, action, args, jobId = FORTH) => api.handle({ requestId: RID(++rid), action, args: { jobId, ...args } }, io);
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const jobUpdates = (io, jobId = FORTH) => io.log.filter(l => l[0] === "update" && l[1] === "jobs/" + jobId);
const jobUpdate = (io, jobId = FORTH) => { const u = jobUpdates(io, jobId); assert.strictEqual(u.length, 1, "exactly one job update"); return u[0][2]; };
const dataKeys = (upd) => Object.keys(upd).filter(k => k.startsWith("data.")).map(k => k.slice(5)).sort();
const checkStamp = (upd) => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-8888"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 607 && new RegExp("^" + upd.app_build + "\\.duet[a-z0-9]{6,}$").test(upd.w), "version-lock stamp >= 607");
  assert.strictEqual(upd.merged, false); assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true });
  assert.ok(Date.parse(upd.updated_at) > Date.parse("2026-11-03T20:00:00.000Z"), "updated_at strictly newer than the doc's");
  assert.deepStrictEqual(Object.keys(upd).filter(k => !k.startsWith("data.")).sort(), ENVELOPE);
};
const restIdentical = (io, jobId, keysWritten) => {
  const before = JOBS()["jobs/" + jobId].data, after = io.store["jobs/" + jobId].data;
  const wrote = new Set(keysWritten);
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!wrote.has(k)) assert.deepStrictEqual(after[k], before[k], "data." + k + " untouched");
};
const auditOf = (io, k) => io.store["duet_writes/" + RID(k)];
const fields = (p) => { assert.ok(!p.refused && !p.noop, "planned: " + JSON.stringify(p.refused || p)); return p.fields; };
const onlyAllowed = (io) => { for (const l of io.log) if (l[0] === "update" || l[0] === "set" || l[0] === "create") assert.ok(/^(jobs|duet_writes)\//.test(l[1]), "only jobs + duet_writes written by api.js: " + l[1]); for (const l of io.log) if (l[0] === "sender-set") assert.ok(/^material_po_log\//.test(l[1]), "the sender writes only material_po_log: " + l[1]); };
const noKey = (io) => assert.ok(!JSON.stringify(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).map(k => io.store[k])).includes(MAIL_KEY), "the mail key never reaches an audit doc");
const ID = /^\d{13}$/;

(async () => {
// ── pinned to App.js ─────────────────────────────────────────────────────────
await ok("SOURCES, the + Add PO literal and the helpers' append are App.js's text (MaterialOrders / onAddMaterial)", () => {
  const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
  assert.ok(app.includes(`const SOURCES = ${JSON.stringify(MA.SOURCES)};`), "MaterialOrders SOURCES");
  assert.ok(app.includes(`{id:uid(),date:"",po:"",pickupDate:"",source:"",items:"",pickedUp:false,needsOrder:true}`), "+ Add PO literal");
  assert.deepStrictEqual(MA.newCard("1", "", ""), { id: "1", date: "", po: "", pickupDate: "", source: "", items: "", pickedUp: false, needsOrder: true });
  assert.ok(app.includes(`items:o.items?o.items.replace(/(<br\\s*\\/?>)+$/i,'')+'<br>'+text:text`), "the helpers' append");
  assert.strictEqual(MA.appendHtml("a<br>b<br><br>", "c"), "a<br>b<br>c"); assert.strictEqual(MA.appendHtml("", "c"), "c");
  assert.ok(app.includes(`.find(o=>o.needsOrder&&!o.ordered&&!o.pickedUp&&(source?(o.source||"")===(source||""):true))`), "the open-card rule");
  assert.ok(/poSentVia === "app"/.test(app) && !/poSentVia === "duet"/.test(app), "App.js switches on poSentVia === \"app\" (Send / PO form buttons) — so the patch keeps \"app\" and adds poSentFrom");
  assert.ok(app.includes(`upd(o.id,{ordered:val,orderedBy:val?(who?.name||""):"",orderedAt:val?new Date().toLocaleDateString("en-US"):""})`), "the checkbox literal");
  assert.ok(app.includes(`const patch = { po:String(res.poNo), simproPoId:String(res.poNo), poSentVia:"app", poSentMode:res.mode||"",`), "the send sheet's patch head");
  assert.ok(app.includes(`if (res.kind !== "email" || res.emailOk) Object.assign(patch, { ordered:true, orderedBy:me.name||"", orderedAt:poTodayMDY() });`), "the ordered rule");
  assert.ok(!/require\((?!"crypto"|"\.\.\/materialPO\/rules\.js"|"\.\.\/escapeHtml\.js"|"\.\/jobItems\.js"|"\.\/needs\.js"|"\.\/stages\.js")/.test(fs.readFileSync(path.join(root, "functions", "duetWrites", "materials.js"), "utf8")), "materials.js requires no Firebase");
});

// ── 1. add a card ────────────────────────────────────────────────────────────
await ok("material.addCard: + Add PO's literal appended to the right list, lines escaped and <br>-joined, id a fresh millisecond string", () => {
  const p = MA.planAddCard({ phase: "rough", source: "ced", items: ["20x 4\" cans", "Tom's <special> order & more"] }, J());
  const list = fields(p).roughMaterials;
  assert.strictEqual(list.length, 6); const card = list[5];
  assert.ok(ID.test(card.id) && !BASE().roughMaterials.some(c => c.id === card.id));
  assert.deepStrictEqual(card, { id: card.id, date: "", po: "", pickupDate: "", source: "CED", items: "20x 4&quot; cans<br>Tom&#39;s &lt;special&gt; order &amp; more", pickedUp: false, needsOrder: true });
  assert.deepStrictEqual(R.itemsToLines(card.items), ["20x 4\" cans", "Tom's <special> order & more"], "the sender reads the lines back as typed");
  assert.deepStrictEqual(list.slice(0, 5), BASE().roughMaterials, "the other cards untouched");
  assert.deepStrictEqual(p.before, { roughMaterials: null }); assert.deepStrictEqual(p.after, { roughMaterials: card }); assert.strictEqual(p.itemId, card.id);
  assert.deepStrictEqual(Object.keys(p.result).sort(), ["appendedToOpenCard", "card", "cardId", "field", "lines", "linesAdded", "number", "phase", "pushTo", "source"].sort());
  assert.strictEqual(fields(MA.planAddCard({ phase: "finish", items: ["x"] }, J())).finishMaterials.length, 2, "finish list");
  assert.strictEqual(fields(MA.planAddCard({ phase: "finish", items: ["x"] }, J())).finishMaterials[1].source, "", "no source → \"\"");
});
await ok("material.addCard: comm only on commercial jobs; source from the card's list; empty / non-list items, archived job refused", () => {
  assert.ok(/isn't a commercial job/.test(MA.planAddCard({ phase: "comm", items: ["x"] }, J()).refused));
  const c = MA.planAddCard({ phase: "comm", source: "CED", items: ["x"] }, jobCtx(COMM));
  assert.strictEqual(fields(c).commMaterials.length, 2);
  assert.ok(/source must be one of/.test(MA.planAddCard({ phase: "rough", source: "Graybar", items: ["x"] }, J()).refused));
  assert.ok(!MA.planAddCard({ phase: "rough", source: "lowe's", items: ["x"] }, J()).refused, "Lowe's is a card source (SW v621)");
  assert.ok(/phase must be/.test(MA.planAddCard({ phase: "qc", items: ["x"] }, J()).refused));
  assert.ok(/at least one line/.test(MA.planAddCard({ phase: "rough", items: ["", "  "] }, J()).refused));
  assert.ok(/list of plain text lines/.test(MA.planAddCard({ phase: "rough", items: "20x cans" }, J()).refused));
  assert.ok(/plain text lines/.test(MA.planAddCard({ phase: "rough", items: [{ a: 1 }] }, J()).refused));
  assert.ok(/archived/.test(MA.planAddCard({ phase: "rough", items: ["x"] }, jobCtx(GONE)).refused));
});
await ok("material.addCard appendToOpen: the NEWEST open card with the same source gets the helpers' append; ordered / picked-up / other-source cards are skipped; none open → a new card", () => {
  const p = MA.planAddCard({ phase: "rough", source: "CED", items: ["3x boxes"], appendToOpen: true }, J());
  const list = fields(p).roughMaterials;
  assert.strictEqual(list.length, 5, "no new card");
  assert.strictEqual(list[1].id, CED_OPEN.id); assert.strictEqual(list[1].items, "10x spanners<br>500&#39; 12/2 romex<br>3x boxes", "trailing <br> stripped, then <br> + text");
  assert.strictEqual(list[0].items, CED_ORDERED.items, "the ordered CED card untouched");
  assert.deepStrictEqual(p.before, { roughMaterials: CED_OPEN }); assert.deepStrictEqual(p.after, { roughMaterials: list[1] }); assert.strictEqual(p.result.appendedToOpenCard, true);
  // Newest wins: a second open CED card after the first takes the append.
  const two = J({ roughMaterials: [CED_OPEN, { ...CED_OPEN, id: "1761000000199", items: "" }] });
  const q = fields(MA.planAddCard({ phase: "rough", source: "CED", items: ["y"], appendToOpen: true }, two)).roughMaterials;
  assert.strictEqual(q[1].items, "y", "empty items → just the text"); assert.strictEqual(q[0].items, CED_OPEN.items);
  // No open Platt card → new card with that source.
  const r = MA.planAddCard({ phase: "rough", source: "Platt", items: ["z"], appendToOpen: true }, J());
  assert.strictEqual(fields(r).roughMaterials.length, 6); assert.strictEqual(r.result.appendedToOpenCard, false); assert.strictEqual(r.after.roughMaterials.source, "Platt");
  // Only a picked-up card with that source → new card (the open rule).
  const s = MA.planAddCard({ phase: "rough", source: "CED", items: ["w"], appendToOpen: true }, J({ roughMaterials: [{ ...CED_OPEN, pickedUp: true }] }));
  assert.strictEqual(fields(s).roughMaterials.length, 2);
});

// ── 2. edit / tick ───────────────────────────────────────────────────────────
await ok("material.editCard: source / date / pickupDate (YYYY-MM-DD → M/D/YYYY) / po / items / appendLines / needsOrder; po refused on a Simpro-made card; noop; nothing given refused", () => {
  const p = MA.planEditCard({ cardId: CED_OPEN.id, source: "Platt", date: "2026-11-05", pickupDate: "11/06/2026", po: "PO 7310", needsOrder: false, appendLines: ["1x <box>"] }, J());
  const next = fields(p).roughMaterials[1];
  assert.deepStrictEqual(next, { ...CED_OPEN, source: "Platt", date: "11/5/2026", pickupDate: "11/6/2026", po: "PO 7310", needsOrder: false, items: "10x spanners<br>500&#39; 12/2 romex<br>1x &lt;box&gt;" });
  assert.deepStrictEqual(p.result.changed.sort(), ["appendLines", "date", "items", "needsOrder", "pickupDate", "po", "source"].filter(k => k !== "appendLines").sort());
  assert.deepStrictEqual(p.before, { roughMaterials: CED_OPEN }); assert.strictEqual(p.itemId, CED_OPEN.id);
  assert.strictEqual(fields(MA.planEditCard({ cardId: CED_OPEN.id, items: ["only this"] }, J())).roughMaterials[1].items, "only this", "items replaces");
  assert.ok(/not both/.test(MA.planEditCard({ cardId: CED_OPEN.id, items: ["a"], appendLines: ["b"] }, J()).refused));
  assert.ok(/Simpro made/.test(MA.planEditCard({ cardId: SIMPRO_CARD.id, po: "9" }, J()).refused));
  assert.ok(/Simpro made/.test(MA.planEditCard({ cardId: SENT_CARD.id, po: "9" }, J()).refused), "a card the app sent carries simproPoId");
  assert.strictEqual(fields(MA.planEditCard({ cardId: SENT_CARD.id, pickupDate: "2026-11-09" }, J())).finishMaterials[0].pickupDate, "11/9/2026", "other fields still edit on a sent card");
  assert.ok(MA.planEditCard({ cardId: CED_ORDERED.id, po: "7290", date: "2026-10-30" }, J()).noop, "same values → noop");
  assert.ok(/Nothing to change/.test(MA.planEditCard({ cardId: CED_OPEN.id }, J()).refused));
  assert.ok(/must be YYYY-MM-DD/.test(MA.planEditCard({ cardId: CED_OPEN.id, date: "Nov 5" }, J()).refused));
  assert.ok(/No material card/.test(MA.planEditCard({ cardId: "nope" }, J()).refused));
  assert.ok(/source must be/.test(MA.planEditCard({ cardId: CED_OPEN.id, source: "Graybar" }, J()).refused));
  assert.ok(/needsOrder must be/.test(MA.planEditCard({ cardId: CED_OPEN.id, needsOrder: "yes" }, J()).refused));
});
await ok("material.tick: the checkbox literals (on → By Koy + At Mountain M/D/YYYY, off → \"\"), every field, noop when already so, never a receipt", () => {
  for (const f of ["ordered", "pickedUp", "deliveredToShop"]) {
    const on = fields(MA.planTick({ cardId: HD_OPEN.id, field: f, on: true }, J())).roughMaterials[2];
    assert.deepStrictEqual(on, { ...HD_OPEN, [f]: true, [f + "By"]: "Koy", [f + "At"]: MDY }, f + " on (Nov 3 Mountain, not Nov 4 UTC)");
    assert.ok(!("receipts" in on));
  }
  const off = fields(MA.planTick({ cardId: CED_ORDERED.id, field: "ordered", on: false }, J())).roughMaterials[0];
  assert.deepStrictEqual(off, { ...CED_ORDERED, ordered: false, orderedBy: "", orderedAt: "" });
  assert.ok(MA.planTick({ cardId: CED_ORDERED.id, field: "ordered", on: true }, J()).noop);
  assert.ok(/field must be/.test(MA.planTick({ cardId: HD_OPEN.id, field: "receipts", on: true }, J()).refused));
  assert.ok(/on must be/.test(MA.planTick({ cardId: HD_OPEN.id, field: "ordered" }, J()).refused));
  assert.ok(/receipt photo/.test(MA.planTick({ cardId: HD_OPEN.id, field: "pickedUp", on: true }, J()).result.receiptsNote), "a store-run pick-up says receipts are the app's path");
});
await ok("api.handle: the three card actions write ONE list as data.<list> with the envelope, audit the one card, leave the rest of the job byte-identical, touch only jobs + duet_writes", async () => {
  const io = fakeIo();
  const a = await call(io, "material.addCard", { phase: "rough", source: "CED", items: ["20x cans"] });
  assert.strictEqual(a.status, 200); assert.ok(a.body.ok && ID.test(a.body.cardId));
  const u1 = jobUpdate(io); checkStamp(u1); assert.deepStrictEqual(dataKeys(u1), ["roughMaterials"]);
  restIdentical(io, FORTH, ["roughMaterials"]); assert.strictEqual(io.store["jobs/" + FORTH].data.roughMaterials.length, 6);
  const au = auditOf(io, rid); assert.strictEqual(au.coll, "jobs"); assert.deepStrictEqual(au.fields, ["roughMaterials"]); assert.strictEqual(au.itemId, a.body.cardId); assert.strictEqual(au.before.roughMaterials, null); assert.strictEqual(au.after.roughMaterials.items, "20x cans");
  const e = await call(io, "material.editCard", { cardId: a.body.cardId, appendLines: ["4x boxes"], pickupDate: "2026-11-07" });
  assert.strictEqual(e.status, 200); assert.deepStrictEqual(e.body.changed.sort(), ["items", "pickupDate"]);
  assert.strictEqual(io.store["jobs/" + FORTH].data.roughMaterials[5].items, "20x cans<br>4x boxes");
  const t = await call(io, "material.tick", { cardId: a.body.cardId, field: "ordered", on: true });
  assert.strictEqual(t.status, 200); assert.strictEqual(t.body.by, "Koy"); assert.strictEqual(t.body.at, MDY);
  assert.strictEqual(io.store["jobs/" + FORTH].data.roughMaterials[5].orderedBy, "Koy");
  const t2 = await call(io, "material.tick", { cardId: a.body.cardId, field: "ordered", on: true });
  assert.ok(t2.body.noop && jobUpdates(io).length === 3);
  const r = await call(io, "material.editCard", { cardId: "zzz", po: "1" });
  assert.strictEqual(r.status, 400); assert.ok(/No material card/.test(r.body.refused)); assert.strictEqual(jobUpdates(io).length, 3);
  const g = await call(io, "material.addCard", { phase: "rough", items: ["x"] }, GONE);
  assert.strictEqual(g.status, 400); assert.ok(/archived/.test(g.body.refused));
  const again = await api.handle({ requestId: RID(rid - 4), action: "material.editCard", args: { jobId: FORTH, cardId: a.body.cardId, appendLines: ["dup"] } }, io);
  assert.ok(again.body.replayed && jobUpdates(io).length === 3, "same requestId → replay, nothing written");
  onlyAllowed(io); noKey(io);
  assert.strictEqual(io.simpro.posts, 0); assert.strictEqual(io.mails.length, 0);
});

// ── 3. preview ───────────────────────────────────────────────────────────────
const CFG = (mode, over) => ({ mode, liveAccess: ["admin", "manager", "standard", "limited"], testTo: SOAK, bids: "bids@homesteadelectric.net", ...(over || {}) });
await ok("planPreview test mode: supplier kind email, the lines from the card's HTML, the pickup line, recipients = ONLY the test inbox, the log key, the hash; mode off / non-admin → wouldRefuse", () => {
  const p = MA.planPreview({ cardId: CED_OPEN.id, get: "willcall", date: "2026-11-05", copyTo: "Jeromy@homesteadelectric.net" }, J(), CFG("test"), { koyAccess: "admin" });
  assert.ok(!p.refused, p.refused);
  const v = p.preview;
  assert.strictEqual(v.kind, "email"); assert.strictEqual(v.supplier, "CED"); assert.deepStrictEqual(v.lines, ["10x spanners", "500' 12/2 romex"]);
  assert.strictEqual(v.pickup, "For will call on Thu 11/5 please."); assert.strictEqual(v.dueDate, "2026-11-05");
  assert.deepStrictEqual(v.recipients, { to: [SOAK], cc: [], replyTo: "" }, "test: the test inbox only, nobody copied — even with a CC list");
  assert.deepStrictEqual(v.copyTo, ["Jeromy@homesteadelectric.net"]); assert.ok(/TEST mode: only/.test(v.recipientsNote) && /void it/.test(v.recipientsNote));
  assert.strictEqual(v.logKey, `${FORTH}_rough_${CED_OPEN.id}`); assert.strictEqual(v.mode, "test"); assert.strictEqual(v.alreadySent, false); assert.strictEqual(v.canSend, true);
  assert.ok(/^[0-9a-f]{32}$/.test(v.previewHash) && p.hash === v.previewHash);
  assert.strictEqual(p.send.date, "11/5/2026"); assert.strictEqual(p.send.clientTest, undefined);
  const off = MA.planPreview({ cardId: CED_OPEN.id }, J(), CFG("off"), { koyAccess: "admin" });
  assert.ok(/turned off/.test(off.preview.wouldRefuse) && off.preview.canSend === false);
  const notAdmin = MA.planPreview({ cardId: CED_OPEN.id }, J(), CFG("test"), { koyAccess: "manager" });
  assert.ok(/Only admins/.test(notAdmin.preview.wouldRefuse));
  const noJobNo = MA.planPreview({ cardId: CED_OPEN.id }, J({ simproNo: "" }), CFG("test"), { koyAccess: "admin" });
  assert.ok(/Simpro job number/.test(noJobNo.preview.wouldRefuse));
  // the hash moves with the lines, the mode, the pickup and the CC list
  const h = (args, cfg) => MA.planPreview({ cardId: CED_OPEN.id, ...args }, J(), cfg || CFG("test"), { koyAccess: "admin" }).hash;
  assert.notStrictEqual(h({}), h({ get: "deliver" })); assert.notStrictEqual(h({}), h({ copyTo: "a@b.co" })); assert.notStrictEqual(h({}), h({}, CFG("live"))); assert.strictEqual(h({ get: "willcall" }), h({}));
  assert.notStrictEqual(h({}), MA.planPreview({ cardId: CED_OPEN.id }, J({ roughMaterials: [{ ...CED_OPEN, items: "other" }, CED_ORDERED, HD_OPEN, SIMPRO_CARD, SHOP_OPEN] }), CFG("test"), { koyAccess: "admin" }).hash);
});
await ok("planPreview live mode: the vendor's Simpro email To, bids@ + Koy's email + the CC list copied, reply-to Koy; without the lookup the To is named, not guessed", () => {
  const p = MA.planPreview({ cardId: CED_OPEN.id, copyTo: ["a@x.co", "B@y.co"] }, J(), CFG("live"), { koyAccess: "admin", vendorEmail: "homestead@cedaf.example", senderEmail: "koy@homesteadelectric.example" });
  assert.deepStrictEqual(p.preview.recipients, { to: ["homestead@cedaf.example"], cc: ["bids@homesteadelectric.net", "koy@homesteadelectric.example", "a@x.co", "B@y.co"], replyTo: "koy@homesteadelectric.example" });
  assert.ok(/^LIVE: CED gets the email/.test(p.preview.recipientsNote));
  const q = MA.planPreview({ cardId: CED_OPEN.id }, J(), CFG("live"), { koyAccess: "admin" });
  assert.deepStrictEqual(q.preview.recipients.to, ["<CED's email on its Simpro vendor record>"]); assert.ok(/at send time/.test(q.preview.recipientsNote));
  assert.notStrictEqual(p.hash, q.hash, "the hash binds the vendor address once known");
  assert.ok(/isn't an email address/.test(MA.planPreview({ cardId: CED_OPEN.id, copyTo: "not an email" }, J(), CFG("live"), {}).refused));
  assert.ok(/up to 5/.test(MA.planPreview({ cardId: CED_OPEN.id, copyTo: "a@a.co b@a.co c@a.co d@a.co e@a.co f@a.co" }, J(), CFG("live"), {}).refused));
});
await ok("planPreview: number-only supplier (Home Depot) → no recipients, store-run wording; Shop / blank refused; empty CED list refused; custom needs words; already sent via the log or the card", () => {
  const hd = MA.planPreview({ cardId: HD_OPEN.id }, J(), CFG("live"), { koyAccess: "admin" });
  assert.strictEqual(hd.preview.kind, "number"); assert.strictEqual(hd.preview.recipients, null); assert.ok(/store run/.test(hd.preview.recipientsNote)); assert.strictEqual(hd.preview.pickup, undefined);
  assert.ok(/can't send to Shop/.test(MA.planPreview({ cardId: SHOP_OPEN.id }, J(), CFG("test"), {}).refused));
  assert.ok(/Add the material list/.test(MA.planPreview({ cardId: CED_OPEN.id }, J({ roughMaterials: [{ ...CED_OPEN, items: "<br>" }] }), CFG("test"), {}).refused));
  assert.ok(/Custom box/.test(MA.planPreview({ cardId: CED_OPEN.id, get: "custom", custom: "   " }, J(), CFG("test"), {}).refused));
  const cu = MA.planPreview({ cardId: CED_OPEN.id, get: "custom", custom: "Leave it at the gate\nthanks", date: "2026-11-05" }, J(), CFG("test"), { koyAccess: "admin" });
  assert.strictEqual(cu.preview.pickup, "Leave it at the gate thanks"); assert.strictEqual(cu.preview.dueDate, "", "custom: no date"); assert.strictEqual(cu.send.date, "");
  const byLog = MA.planPreview({ cardId: CED_OPEN.id }, J(), CFG("test"), { koyAccess: "admin", log: { status: "done", poNo: "7299", mode: "test", emailOk: true, emailedTo: [SOAK] } });
  assert.ok(byLog.preview.alreadySent && byLog.preview.existingPo === "7299" && /same PO/.test(byLog.preview.alreadySentNote) && byLog.preview.existingSend.emailOk === true);
  const byCard = MA.planPreview({ cardId: SENT_CARD.id }, J(), CFG("live"), { koyAccess: "admin" });
  assert.ok(byCard.preview.alreadySent && byCard.preview.existingPo === "7295" && byCard.preview.phase === "finish");
  assert.ok(/needs ccId/.test(MA.planPreview({ cardId: "1761000000201" }, jobCtx(COMM), CFG("test"), {}).refused), "comm needs the cost center");
  const comm = MA.planPreview({ cardId: "1761000000201", ccId: "19094" }, jobCtx(COMM), CFG("test"), { koyAccess: "admin" });
  assert.strictEqual(comm.preview.costCenter, "Simpro job cost center 19094"); assert.strictEqual(comm.send.ccId, "19094");
});
await ok("api.handle material.previewPo: a READ — no job update, the audit holds the hash / recipients / mode and never the mail key; previewId = the requestId; refusals audited", async () => {
  const io = fakeIo({ mode: "test" });
  const r = await call(io, "material.previewPo", { cardId: CED_OPEN.id, get: "deliver", date: "2026-11-06" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.previewId, RID(rid)); assert.deepStrictEqual(r.body.recipients, { to: [SOAK], cc: [], replyTo: "" }); assert.strictEqual(r.body.mode, "test"); assert.strictEqual(r.body.koyAccess, "admin");
  assert.strictEqual(r.body.pickup, "Please deliver to the job on Fri 11/6.");
  assert.strictEqual(jobUpdates(io).length, 0, "nothing written to the job");
  const au = auditOf(io, rid); assert.strictEqual(au.action, "material.previewPo"); assert.strictEqual(au.ok, true); assert.strictEqual(au.read, true); assert.strictEqual(au.docId, FORTH); assert.strictEqual(au.itemId, CED_OPEN.id);
  assert.strictEqual(au.preview.hash, r.body.previewHash); assert.deepStrictEqual(au.preview.recipients.to, [SOAK]); assert.strictEqual(au.preview.mode, "test");
  assert.ok(io.log.some(l => l[1] === "gc_config/material_po") && io.log.some(l => l[1] === "gc_config/mail.soakTo") && !io.log.some(l => l[1] === "gc_config/mail"), "only soakTo from gc_config/mail");
  assert.strictEqual(io.simpro.gets, 0, "test mode: no Simpro call for the preview");
  noKey(io); onlyAllowed(io);
  const live = fakeIo({ mode: "live" });
  const l = await call(live, "material.previewPo", { cardId: CED_OPEN.id });
  assert.deepStrictEqual(l.body.recipients, { to: ["homestead@cedaf.example"], cc: ["bids@homesteadelectric.net", "koy@homesteadelectric.example"], replyTo: "koy@homesteadelectric.example" }, "live: the vendor's Simpro address looked up (one GET)");
  assert.strictEqual(live.simpro.gets, 1); assert.strictEqual(live.simpro.posts, 0);
  const bad = await call(io, "material.previewPo", { cardId: SHOP_OPEN.id });
  assert.strictEqual(bad.status, 400); assert.ok(/can't send to Shop/.test(bad.body.refused)); assert.strictEqual(auditOf(io, rid).ok, false);
  const gone = await call(io, "material.previewPo", { cardId: CED_OPEN.id }, GONE);
  assert.strictEqual(gone.status, 400); assert.ok(/archived/.test(gone.body.refused));
  const noKoy = fakeIo({ mode: "test", users: [{ id: 3, name: "Colby" }] });
  const nk = await call(noKoy, "material.previewPo", { cardId: CED_OPEN.id });
  assert.strictEqual(nk.status, 400); assert.ok(/Koy isn't on the active team list/.test(nk.body.refused));
});

// ── 4. send ──────────────────────────────────────────────────────────────────
await ok("material.sendPo refuses: no confirmPreviewId / unknown / another card's / stale (> 15 min) / changed card (hash) / mode off / sender's gate — no Simpro POST, no email, no card write, each audited", async () => {
  const io = fakeIo({ mode: "test" });
  const none = await call(io, "material.sendPo", { cardId: CED_OPEN.id });
  assert.strictEqual(none.status, 400); assert.ok(/confirmPreviewId must be the previewId/.test(none.body.refused));
  const unk = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: RID(999) });
  assert.strictEqual(unk.status, 409); assert.ok(/isn't a successful cc_preview_material_po call/.test(unk.body.refused));
  const pvHd = await call(io, "material.previewPo", { cardId: HD_OPEN.id }); const hdId = pvHd.body.previewId;
  const other = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: hdId });
  assert.strictEqual(other.status, 409); assert.ok(/another job or card/.test(other.body.refused));
  const pv = await call(io, "material.previewPo", { cardId: CED_OPEN.id, get: "willcall", date: "2026-11-05" }); const pvId = pv.body.previewId;
  io.store["duet_writes/" + pvId].at = new Date(Date.parse(NOW) - 16 * 60e3).toISOString();
  const stale = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pvId, get: "willcall", date: "2026-11-05" });
  assert.strictEqual(stale.status, 409); assert.ok(/older than 15 minutes/.test(stale.body.refused));
  io.store["duet_writes/" + pvId].at = NOW;
  const diffOpts = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pvId, get: "deliver", date: "2026-11-05" });
  assert.strictEqual(diffOpts.status, 409); assert.ok(/changed since that preview/.test(diffOpts.body.refused));
  io.store["jobs/" + FORTH].data.roughMaterials[1].items = "10x spanners<br>600&#39; 12/2 romex";
  const changed = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pvId, get: "willcall", date: "2026-11-05" });
  assert.strictEqual(changed.status, 409); assert.ok(/changed since that preview/.test(changed.body.refused));
  io.store["jobs/" + FORTH].data.roughMaterials[1].items = CED_OPEN.items;
  io.store["gc_config/material_po"] = { mode: "off" };
  const off = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pvId, get: "willcall", date: "2026-11-05" });
  assert.strictEqual(off.status, 400); assert.ok(/turned off/.test(off.body.refused));
  io.store["gc_config/material_po"] = { mode: "live", liveAccess: ["manager"] };
  const pvL = await call(io, "material.previewPo", { cardId: CED_OPEN.id });
  assert.ok(/access level can't send/.test(pvL.body.wouldRefuse));
  const gate = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pvL.body.previewId });
  assert.strictEqual(gate.status, 403); assert.ok(/access level can't send/.test(gate.body.refused));
  assert.strictEqual(io.simpro.posts, 0, "no PO"); assert.strictEqual(io.mails.length, 0, "no email"); assert.strictEqual(io.sent.length, 0, "the sender never ran"); assert.strictEqual(jobUpdates(io).length, 0, "no card write");
  for (const k of [none, unk, other, stale, diffOpts, changed, off, gate]) assert.ok(k.body.ok === false);
  assert.ok(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length >= 11, "every refusal audited");
  onlyAllowed(io); noKey(io);
});
await ok("material.sendPo TEST mode (CED): the REAL sendMaterialPO runs as Koy with clientTest:true → ONE Simpro PO marked TEST on the rough cost center, ONE [TEST] email to the test inbox only, Sent to Supplier marked, the send sheet's exact card patch, audit = poNo / mode / recipients, never the key", async () => {
  const io = fakeIo({ mode: "test" });
  const pv = await call(io, "material.previewPo", { cardId: CED_OPEN.id, get: "willcall", date: "2026-11-05", copyTo: "jeromy@homesteadelectric.net" });
  assert.strictEqual(pv.status, 200);
  const r = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId, get: "willcall", date: "2026-11-05", copyTo: "jeromy@homesteadelectric.net" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(io.sent.length, 1); const d = io.sent[0].data;
  assert.strictEqual(d.clientTest, true, "test mode: clientTest is NOT false"); assert.strictEqual(io.sent[0].user.name, "Koy"); assert.strictEqual(io.sent[0].user.access, "admin");
  assert.deepStrictEqual({ jobId: d.jobId, phase: d.phase, orderId: d.orderId, source: d.source, items: d.items, get: d.get, date: d.date, copyTo: d.copyTo }, { jobId: FORTH, phase: "rough", orderId: CED_OPEN.id, source: "CED", items: CED_OPEN.items, get: "willcall", date: "11/5/2026", copyTo: "jeromy@homesteadelectric.net" }, "the send sheet's own payload");
  assert.strictEqual(io.simpro.posts, 1, "one PO"); const po = io.simpro.pos[0];
  assert.strictEqual(po.Vendor, 13); assert.strictEqual(po.AssignedTo, 18864, "rough cost center"); assert.strictEqual(po.DueDate, "2026-11-05"); assert.ok(/TEST from the Command Center.*Koy/.test(po.PrivateNotes)); assert.ok(/For will call on Thu 11\/5 please/.test(po.VendorNotes));
  assert.strictEqual(io.mails.length, 1); assert.deepStrictEqual(io.mails[0].to, [SOAK]); assert.deepStrictEqual(io.mails[0].cc, [], "nobody copied in test"); assert.ok(io.mails[0].subject.startsWith("[TEST] PO 7300 – Forth Residence"), io.mails[0].subject);
  assert.strictEqual(io.simpro.patches.length, 1, "Sent to Supplier");
  assert.deepStrictEqual({ poNo: r.body.poNo, mode: r.body.mode, emailOk: r.body.emailOk, emailedTo: r.body.emailedTo, again: r.body.again, cardPatched: r.body.cardPatched }, { poNo: "7300", mode: "test", emailOk: true, emailedTo: [SOAK], again: false, cardPatched: true });
  assert.ok(/TEST send: PO 7300 is real in Simpro/.test(r.body.note));
  const u = jobUpdate(io); checkStamp(u); assert.deepStrictEqual(dataKeys(u), ["roughMaterials"]);
  const card = io.store["jobs/" + FORTH].data.roughMaterials[1];
  assert.deepStrictEqual(card, { ...CED_OPEN, po: "7300", simproPoId: "7300", poSentVia: "app", poSentFrom: "duet", poSentMode: "test", poSentBy: "Koy", poSentAt: MDY, poCostCenter: "Rough In", poEmailOk: true, poEmailedTo: SOAK,
    ordered: true, orderedBy: "Koy", orderedAt: MDY, date: MDY, pickupDate: "11/5/2026" }, "the send sheet's patch: dates filled because the card's were empty");
  restIdentical(io, FORTH, ["roughMaterials"]);
  const au = auditOf(io, rid); assert.deepStrictEqual(au.fields, ["roughMaterials"]); assert.strictEqual(au.itemId, CED_OPEN.id); assert.deepStrictEqual(au.before.roughMaterials, CED_OPEN); assert.strictEqual(au.after.roughMaterials.po, "7300");
  assert.deepStrictEqual(au.send, { poNo: "7300", kind: "email", mode: "test", supplier: "CED", costCenter: "Rough In", emailOk: true, emailError: "", emailedTo: [SOAK], copied: [], again: false }); assert.strictEqual(au.confirmPreviewId, pv.body.previewId); assert.strictEqual(au.logKey, `${FORTH}_rough_${CED_OPEN.id}`);
  const logDoc = io.store["material_po_log/" + au.logKey]; assert.ok(logDoc && logDoc.poNo === "7300" && logDoc.status === "done" && logDoc.by === "Koy", "the sender's own log");
  noKey(io); onlyAllowed(io);
  // The same requestId → replayed, no second PO. A NEW send on the same card → the sender's one-send-per-card claim: same PO, no second POST, no second email (already emailed).
  const rep = await api.handle({ requestId: RID(rid), action: "material.sendPo", args: { jobId: FORTH, cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId, get: "willcall", date: "2026-11-05", copyTo: "jeromy@homesteadelectric.net" } }, io);
  assert.ok(rep.body.replayed && rep.body.poNo === "7300" && io.simpro.posts === 1);
  const pv2 = await call(io, "material.previewPo", { cardId: CED_OPEN.id, get: "willcall", date: "2026-11-05", copyTo: "jeromy@homesteadelectric.net" });
  assert.ok(pv2.body.alreadySent && pv2.body.existingPo === "7300", "the preview now says already sent");
  const r2 = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv2.body.previewId, get: "willcall", date: "2026-11-05", copyTo: "jeromy@homesteadelectric.net" });
  assert.strictEqual(r2.status, 200); assert.strictEqual(r2.body.poNo, "7300"); assert.strictEqual(r2.body.again, true); assert.strictEqual(io.simpro.posts, 1, "never a second PO"); assert.strictEqual(io.mails.length, 1, "never a second email");
});
await ok("material.sendPo LIVE mode (CED): clientTest:false, the email to CED's Simpro address with bids@ + Koy + the CC list copied, poSentMode live", async () => {
  const io = fakeIo({ mode: "live" });
  const pv = await call(io, "material.previewPo", { cardId: CED_OPEN.id, get: "deliver", date: "2026-11-06", copyTo: "jeromy@homesteadelectric.net" });
  assert.deepStrictEqual(pv.body.recipients.to, ["homestead@cedaf.example"]);
  const r = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId, get: "deliver", date: "2026-11-06", copyTo: "jeromy@homesteadelectric.net" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(io.sent[0].data.clientTest, false, "live: clientTest false, exactly as a current app copy sends");
  assert.strictEqual(io.simpro.posts, 1); assert.ok(/Sent from the Command Center by Koy/.test(io.simpro.pos[0].PrivateNotes) && !/TEST/.test(io.simpro.pos[0].PrivateNotes));
  assert.strictEqual(io.mails.length, 1); assert.deepStrictEqual(io.mails[0].to, ["homestead@cedaf.example"]); assert.deepStrictEqual(io.mails[0].cc, ["bids@homesteadelectric.net", "koy@homesteadelectric.example", "jeromy@homesteadelectric.net"]); assert.strictEqual(io.mails[0].replyTo, "koy@homesteadelectric.example");
  assert.ok(io.mails[0].subject.startsWith("PO 7300 – Forth Residence"), io.mails[0].subject);
  const card = io.store["jobs/" + FORTH].data.roughMaterials[1];
  assert.strictEqual(card.poSentMode, "live"); assert.strictEqual(card.poEmailedTo, "homestead@cedaf.example"); assert.strictEqual(card.ordered, true); assert.strictEqual(card.pickupDate, "11/6/2026");
  assert.deepStrictEqual(r.body.send.copied, ["jeromy@homesteadelectric.net"]); assert.ok(/emailed to homestead@cedaf.example/.test(r.body.note));
  noKey(io); onlyAllowed(io);
});
await ok("material.sendPo store run (Home Depot): ONE PO, NO email, ordered + PO # on the card, poEmailOk false; the card's own date kept when set", async () => {
  const io = fakeIo({ mode: "live" });
  io.store["jobs/" + FORTH].data.roughMaterials[2].date = "11/1/2026";
  const pv = await call(io, "material.previewPo", { cardId: HD_OPEN.id });
  assert.strictEqual(pv.body.kind, "number"); assert.strictEqual(pv.body.recipients, null);
  const r = await call(io, "material.sendPo", { cardId: HD_OPEN.id, confirmPreviewId: pv.body.previewId });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(io.simpro.posts, 1); assert.strictEqual(io.simpro.pos[0].Vendor, 30); assert.strictEqual(io.mails.length, 0); assert.strictEqual(io.simpro.patches.length, 0, "no Sent to Supplier for a store run");
  const card = io.store["jobs/" + FORTH].data.roughMaterials[2];
  assert.deepStrictEqual(card, { ...HD_OPEN, date: "11/1/2026", po: "7300", simproPoId: "7300", poSentVia: "app", poSentFrom: "duet", poSentMode: "live", poSentBy: "Koy", poSentAt: MDY, poCostCenter: "Rough In", poEmailOk: false, poEmailedTo: "", ordered: true, orderedBy: "Koy", orderedAt: MDY });
  assert.ok(/ready for the store run/.test(r.body.note));
});
await ok("material.sendPo: Simpro answers 504 → the sender marks the log unknown, ONE POST (no retry), the answer says a PO may exist + where to look, the card is NOT written, the audit holds the sender code", async () => {
  const io = fakeIo({ mode: "test" });
  io.simpro.loseNextAnswer = true;
  const pv = await call(io, "material.previewPo", { cardId: CED_OPEN.id });
  const r = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId });
  assert.strictEqual(r.status, 502, JSON.stringify(r.body)); assert.ok(/A PO MAY exist: check material_po_log\//.test(r.body.refused) && /cc_list_material_cards/.test(r.body.refused), r.body.refused);
  assert.strictEqual(io.simpro.posts, 1, "exactly one POST — never retried"); assert.strictEqual(io.mails.length, 0); assert.strictEqual(jobUpdates(io).length, 0, "card untouched");
  assert.deepStrictEqual(io.store["jobs/" + FORTH].data.roughMaterials[1], CED_OPEN);
  const au = auditOf(io, rid); assert.strictEqual(au.ok, false); assert.strictEqual(au.senderCode, "unavailable"); assert.strictEqual(au.logKey, `${FORTH}_rough_${CED_OPEN.id}`);
  assert.strictEqual(io.store["material_po_log/" + au.logKey].status, "unknown");
  noKey(io); onlyAllowed(io);
});
await ok("material.sendPo: its own 10 / hour counter (429, nothing sent) on top of the global 60; previews don't count against it", async () => {
  const io = fakeIo({ mode: "test" });
  for (let i = 0; i < 10; i++) io.store["duet_writes/old" + i] = { at: new Date(Date.parse(NOW) - (i + 1) * 60e3).toISOString(), action: "material.sendPo", ok: true };
  for (let i = 0; i < 20; i++) io.store["duet_writes/pv" + i] = { at: NOW, action: "material.previewPo", ok: true };
  const pv = await call(io, "material.previewPo", { cardId: CED_OPEN.id });
  assert.strictEqual(pv.status, 200);
  await assert.rejects(call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId }), (e) => e instanceof api.Refusal && e.status === 429 && /sent 10 POs in the last hour/.test(e.message), "429 like the global limit (a Refusal → HTTP 429, never audited)");
  assert.strictEqual(io.simpro.posts, 0); assert.strictEqual(io.sent.length, 0);
  io.store["duet_writes/old0"].at = new Date(Date.parse(NOW) - 61 * 60e3).toISOString();
  const r2 = await call(io, "material.sendPo", { cardId: CED_OPEN.id, confirmPreviewId: pv.body.previewId });
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); assert.strictEqual(io.simpro.posts, 1);
  const g = fakeIo({ mode: "test", recent: 60 });
  await assert.rejects(call(g, "material.previewPo", { cardId: CED_OPEN.id }), (e) => e instanceof api.Refusal && e.status === 429, "the global 60 still applies");
});
await ok("api.js: the action lists and allowlist hold the five ship-8 actions; BUILD 607; the only tx.delete are the door's two (ship 12)", () => {
  assert.deepStrictEqual(api.MATERIAL_CARD_ACTIONS, ["material.addCard", "material.editCard", "material.tick"]);
  assert.deepStrictEqual(api.MATERIAL_PO_ACTIONS, ["material.previewPo", "material.sendPo"]);
  for (const a of api.MATERIAL_CARD_ACTIONS) assert.ok(api.JOB_WRITE_ACTIONS.includes(a) && api.ACTIONS.includes(a));
  for (const a of api.MATERIAL_PO_ACTIONS) assert.ok(!api.JOB_WRITE_ACTIONS.includes(a) && api.ACTIONS.includes(a));
  assert.ok(api.BUILD >= 607, "BUILD at least 607 (ship 9 bumped it to 608)"); assert.strictEqual(api.SEND_PO_PER_HOUR, 10);
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.strictEqual((src.match(/tx\.delete\(/g) || []).length, 2, "exactly two tx.delete in api.js, both the door's (ship 12): doc.delete (confirm word = the docId) and its undo's docDelete (a plain create taken back)");
  assert.ok(/clientTest: cfg\.mode === "live" \? false : true/.test(src), "clientTest false only when live");
  assert.ok(/soakTo/.test(src) && !/mail\.key|\.key\b/.test(src.split("loadPoCfg")[1].split("readPoLog")[0]), "loadPoCfg never touches the key");
  const idx = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
  assert.ok(idx.indexOf("const _poGmail = require") < idx.indexOf("exports.duetApi = require"), "the Gmail sender is built before duetApi");
  assert.ok(/materialDeps: \{ simproReqWithRetry, accessOf: gcAdminAccessOf, loadMailConfig: gcLoadMailConfig, gmailSend: _poGmail\.send \}/.test(idx), "duetApi gets the sender's real deps");
  assert.strictEqual((idx.match(/const _poGmail = require/g) || []).length, 1, "one Gmail sender instance");
});

console.log(`duet-materials-test: ${n} checks passed`);
})().catch((e) => { console.error("duet-materials-test FAILED:", e && e.stack || e); process.exit(1); });
