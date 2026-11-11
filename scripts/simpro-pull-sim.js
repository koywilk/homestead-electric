// Simpro PO pull — handler simulation. Run: node scripts/simpro-pull-sim.js (prebuild chain).
// Drives the REAL functions/materialPO/simproPull.js against a fake Firestore and a
// fake Simpro, with PO shapes read live on 2026-11-02, and checks the promises made
// to Koy: right job and list, no duplicates, no card overwritten, removed stays
// removed, receipt = Picked Up once, and the app's save keeps a card the server added.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const make = require(path.join(__dirname, "../functions/materialPO/simproPull.js"));

class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const functions = {
  https: { HttpsError, onCall: (fn) => fn },
  runWith() { return this; },
  pubsub: { schedule() { return { timeZone() { return { onRun: (fn) => fn }; } }; } },
  logger: { info() {}, warn() {}, error() {} },
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function makeDb() {
  const store = new Map();
  const setPath = (o, dotted, v) => { const ks = dotted.split("."); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks[ks.length - 1]] = v; };
  const ref = (col, id) => ({
    col, id,
    async get() { const d = store.get(`${col}/${id}`); return { exists: !!d, id, data: () => clone(d) }; },
    async set(data, opts) { const k = `${col}/${id}`; store.set(k, opts && opts.merge ? { ...(store.get(k) || {}), ...clone(data) } : clone(data)); },
    async update(data) { const k = `${col}/${id}`; const cur = clone(store.get(k)) || {}; Object.entries(data).forEach(([p, v]) => setPath(cur, p, clone(v))); store.set(k, cur); },
  });
  const docs = (col, keep) => {
    const out = [];
    store.forEach((v, k) => { if (k.startsWith(`${col}/`) && (!keep || keep(v))) out.push({ id: k.slice(col.length + 1), data: () => clone(v) }); });
    return { docs: out, forEach: (fn) => out.forEach(fn) };
  };
  let lock = Promise.resolve();
  return {
    store, ref, reads: { jobs: 0 },
    collection: function (col) {
      const self = this;
      return {
        doc: (id) => ref(col, id),
        get: async () => { if (col === "jobs") self.reads.jobs++; return docs(col); },
        where: (f, op, val) => ({ get: async () => docs(col, (v) => v[f] >= val) }),
      };
    },
    runTransaction(fn) {
      const run = lock.then(async () => {
        const writes = [];
        const out = await fn({ get: (r) => r.get(), set: (r, d, o) => writes.push(["set", r, d, o]), update: (r, d) => writes.push(["update", r, d]) });
        for (const [k, r, d, o] of writes) await r[k](d, o);
        return out;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
}

const PO = (id, job, cc, o = {}) => ({
  ID: id, Stage: "Approved", Status: { ID: 23, Name: o.status || "Purchase Orders : Created" }, Vendor: { ID: 13, Name: o.vendor || "CED" },
  AssignedTo: job ? { ID: 18000 + id, CostCenter: cc ? { ID: 38, Name: cc } : undefined, Name: `${job}-${18000 + id} ${cc}`, Job: job, Section: 1 } : {},
  DateIssued: o.date || "2026-10-20", DueDate: o.due || null, VendorNotes: o.notes === undefined ? "<div>6x 2 wire splice kits</div><div>1x 4G Cut in</div><div>1x 1G cut in</div>" : o.notes,
  PrivateNotes: o.priv || "", Archived: false, CreatedBy: o.by === undefined ? { ID: 1, Name: "Treycen Rollene" } : { ID: 1, Name: o.by },
});
function makeSimpro() {
  const s = { pos: [], receipts: {}, lines: {}, details: {}, gets: 0, fail: false, writes: 0, failLines: false };
  s.req = async (method, p) => {
    if (method !== "GET") { s.writes++; throw new Error(`Simpro ${method} is not allowed here: ${p}`); }
    s.gets++;
    let m;
    if (p.startsWith("/vendorOrders/?")) {
      if (s.fail) return { ok: false, status: 503, data: {} };
      const q = new URLSearchParams(p.split("?")[1]);
      const j = q.get("AssignedTo.Job");
      assert(!q.get("Job.ID"), "must not use the filter Simpro ignores");
      const rows = s.pos.filter((x) => !x.Archived && (!j || String(x.AssignedTo.Job) === j));
      const page = Number(q.get("page") || 1), size = Number(q.get("pageSize"));
      return { ok: true, status: 200, data: clone(rows.slice((page - 1) * size, page * size)) };
    }
    if ((m = p.match(/^\/vendorOrders\/(\d+)\/receipts\/$/))) return { ok: true, status: 200, data: clone(s.receipts[m[1]] || []) };
    if ((m = p.match(/^\/vendorOrders\/(\d+)\/catalogs\//)) && s.failLines) return { ok: false, status: 503, data: {} };
    if (m) return { ok: true, status: 200, data: clone(s.lines[m[1]] || []) };
    if ((m = p.match(/^\/vendorOrders\/(\d+)$/))) { const d = s.details[m[1]] || s.pos.find((x) => String(x.ID) === m[1]); return d ? { ok: true, status: 200, data: clone(d) } : { ok: false, status: 404, data: {} }; }
    throw new Error(`unexpected GET ${p}`);
  };
  return s;
}
function setup(jobs, mode = "live") {
  const db = makeDb(), sim = makeSimpro();
  Object.entries(jobs).forEach(([id, data]) => db.store.set(`jobs/${id}`, { data, updated_at: "x" }));
  if (mode) db.store.set("settings/simproPoSync", { mode, startDate: "2026-10-03" });
  const pull = make({ functions, db, simproReqWithRetry: sim.req, requireAppKey: () => {} });
  const job = (id) => db.store.get(`jobs/${id}`).data;
  const led = (id) => db.store.get(`simpro_po_link/${id}`);
  return { db, sim, pull, job, led };
}
const STRATTON = () => ({ name: "Stratton Residence", simproNo: "959", roughMaterials: [], finishMaterials: [
  { id: "1789706966989", po: "7114", source: "CED", items: "1x something else entirely here", ordered: true, pickedUp: true, pickedUpBy: "Treycen Rollene" },
] });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("a Finish PO makes one new card on Finish, with what Simpro knows", async () => {
  const { sim, pull, job, led } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)", { status: "Purchase Orders : Sent to Supplier", due: "2026-10-23" })];
  await pull.run({});
  const c = job("s").finishMaterials.find((x) => x.po === "7302");
  assert(c, "card made");
  assert.equal(c.id, "simpro_7302"); assert.equal(c.source, "CED"); assert.equal(c.date, "10/20/2026"); assert.equal(c.pickupDate, "10/23/2026");
  assert.equal(c.ordered, true); assert.equal(c.needsOrder, false, "must not land in the unsent-PO list"); assert.equal(c.pickedUp, false);
  assert.equal(c.orderedBy, "Treycen Rollene"); assert.equal(c.simproCostCenter, "Residential (Finish)"); assert.equal(c.simproPulled, true);
  assert.equal(c.items, "6x 2 wire splice kits<br>1x 4G Cut in<br>1x 1G cut in");
  assert.equal(job("s").roughMaterials.length, 0);
  assert.equal(led("7302").how, "created");
  assert.equal(sim.writes, 0);
});

test("cost centers pick the list: rough, finish, CO phases, commercial job, warranty with a label", async () => {
  const { sim, pull, job } = setup({ r: { name: "R", simproNo: "1" }, c: { name: "C", simproNo: "2", division: "commercial" } });
  sim.pos = [
    PO(1001, 1, "Residential (Rough In)", { notes: "a" }), PO(1002, 1, "Residential (Finish)", { notes: "b" }), PO(1003, 1, "Residential - Change Order (Rough In)", { notes: "c" }),
    PO(1004, 1, "Residential (Warranty)", { notes: "d" }), PO(1005, 1, "Change Order", { notes: "e" }), PO(1006, 2, "Commercial (Lighting Package)", { notes: "f" }), PO(1007, 2, "Residential (Rough In)", { notes: "g" }),
  ];
  await pull.run({});
  const ids = (l) => (job(l.split(":")[0])[l.split(":")[1]] || []).map((c) => c.po);
  assert.deepEqual(ids("r:roughMaterials"), ["1001", "1003"]);
  assert.deepEqual(ids("r:finishMaterials"), ["1002", "1004", "1005"]);
  assert.deepEqual(ids("c:commMaterials"), ["1006", "1007"]);
  assert.equal(job("r").finishMaterials.find((c) => c.po === "1004").simproChip, "Warranty");
  assert.equal(job("r").finishMaterials.find((c) => c.po === "1005").simproChip, "Change Order");
  assert.equal(job("r").finishMaterials.find((c) => c.po === "1002").simproChip, undefined);
});

test("a PO the app sent never gets a second card: by tag, by send log, by order log", async () => {
  const { db, sim, pull, job, led } = setup({ s: STRATTON() });
  db.store.set("material_po_log/a", { poNo: "7001" });
  db.store.set("material_po_log/o", { kind: "order", poNos: ["7002"] });
  sim.pos = [
    PO(7384, 959, "Residential (Finish)", { priv: "<div>Sent from the Command Center by Koy Wilkinson.</div><div>CC-b9d290ded7</div>", by: "" }),
    PO(7001, 959, "Residential (Finish)"), PO(7002, 959, "Residential (Finish)"),
  ];
  await pull.run({});
  assert.equal(job("s").finishMaterials.length, 1);
  assert.equal(led("7384").how, "app");
});

test("a typed number links in place, whatever way it was typed, and nothing visible changes", async () => {
  const j = STRATTON();
  j.roughMaterials = [
    { id: "a", po: "PO-7500", source: "CED", items: "typed list", date: "1/2/2026", ordered: false, needsOrder: true },
    { id: "b", po: "7115 (Under Power Finish Lower Level) ", source: "CED", items: "x" },
    { id: "c", po: "7250/ 7252", source: "CED", items: "y" },
  ];
  const { sim, pull, job, led } = setup({ s: j });
  // Cost center says Finish, the crew put 7500 on Rough: it stays where the crew put it.
  sim.pos = [PO(7500, 959, "Residential (Finish)"), PO(7115, 959, "Residential (Finish)"), PO(7252, 959, "Residential (Finish)")];
  await pull.run({});
  const after = job("s");
  assert.equal(after.roughMaterials.length, 3); assert.equal(after.finishMaterials.length, 1);
  const a = after.roughMaterials[0];
  assert.equal(a.po, "PO-7500"); assert.equal(a.items, "typed list"); assert.equal(a.date, "1/2/2026"); assert.equal(a.ordered, false); assert.equal(a.simproPoId, "7500");
  assert.equal(a.simproPulled, undefined);
  assert.equal(led("7500").how, "typed"); assert.equal(led("7115").how, "typed"); assert.equal(led("7252").how, "typed");
});

test("a typed number on ANOTHER job doesn't stop the card on the right job", async () => {
  const { sim, pull, job } = setup({ lot: { name: "Lot 23", simproNo: "1386" }, br: { name: "Bridle Wood", simproNo: "940", roughMaterials: [{ id: "z", po: "7235", items: "q" }] } });
  sim.pos = [PO(7235, 1386, "Residential (Finish)")];
  await pull.run({});
  assert.equal(job("lot").finishMaterials[0].po, "7235");
  assert.equal(job("br").roughMaterials[0].po, "7235", "their card stays");
});

test("same list, no PO #: fills the blanks on that card and overwrites nothing", async () => {
  const j = { name: "Lot 23", simproNo: "1386", finishMaterials: [
    { id: "k", po: "", source: "", date: "", items: "20 ft of 3/4” Liquidtight flex<br>1 - 3/4” Liquidtight 90° connector.<br>1 - 2pole 15 amp breaker homeline.", ordered: true, orderedBy: "Abraham Tristan", orderedAt: "10/20/2026", pickedUp: false, needsOrder: true },
  ] };
  const { sim, pull, job, led } = setup({ s: j });
  sim.pos = [PO(7305, 1386, "Residential (Warranty)", { notes: "<div>20 ft of 3/4&rdquo; Liquidtight flex</div><div>1 - 3/4&rdquo; Liquidtight 90&deg; connector.</div><div>1 - 2pole 15 amp breaker homeline.</div>", by: "Abraham Tristan" })];
  await pull.run({});
  assert.equal(job("s").finishMaterials.length, 1, "no second card");
  const c = job("s").finishMaterials[0];
  assert.equal(c.po, "7305"); assert.equal(c.source, "CED"); assert.equal(c.date, "10/20/2026"); assert.equal(c.simproLinked, true);
  assert(c.items.startsWith("20 ft of 3/4”"), "the crew's list stays"); assert.equal(c.orderedBy, "Abraham Tristan");
  assert.equal(led("7305").how, "linked");
});

test("linking never happens by supplier alone, on a thin list, on two matches, or on an old card", async () => {
  const same = "1x whisper green fan<br>1x 4 gang box<br>6x rolls of 12/2";
  const j = { name: "J", simproNo: "1", roughMaterials: [
    { id: "e", po: "", source: "CED", items: "totally different material list here now" },
    { id: "t", po: "", source: "CED", items: "fan" },
  ], finishMaterials: [
    { id: "d1", po: "", source: "CED", items: same }, { id: "d2", po: "", source: "", items: same },
  ], commMaterials: [] };
  const old = String(Date.parse("2026-01-05"));
  const j2 = { name: "J2", simproNo: "2", roughMaterials: [{ id: old, po: "", source: "CED", items: same }] };
  const { sim, pull, job, led } = setup({ a: j, b: j2 });
  sim.pos = [
    PO(2001, 1, "Residential (Rough In)", { notes: "<div>one thing</div><div>another thing</div><div>third thing</div>" }),   // same supplier, different list
    PO(2002, 1, "Residential (Rough In)", { notes: "fan" }),                                                                    // thin list
    PO(2003, 1, "Residential (Rough In)", { notes: "<div>1x whisper green fan</div><div>1x 4 gang box</div><div>6x rolls of 12/2</div>" }),   // two cards match
    PO(2004, 2, "Residential (Rough In)", { notes: "<div>1x whisper green fan</div><div>1x 4 gang box</div><div>6x rolls of 12/2</div>" }),   // card is 9 months older
  ];
  await pull.run({});
  ["2001", "2002", "2003", "2004"].forEach((id) => assert.equal(led(id).how, "created", id));
  assert.equal(job("a").roughMaterials[0].po, ""); assert.equal(job("a").finishMaterials[0].po, ""); assert.equal(job("a").finishMaterials[1].po, "");
  assert.equal(job("b").roughMaterials[0].po, "");
});

test("one no-PO card with a different list stays untouched, and the PO gets its own card", async () => {
  const { sim, pull, job, led } = setup({ a: { name: "A", simproNo: "1", roughMaterials: [{ id: "c", po: "", source: "CED", items: "1x panel<br>4x breakers<br>2x rolls of wire" }] } });
  sim.pos = [PO(3100, 1, "Residential (Rough In)", { notes: "<div>6x whisper fans</div><div>2x gang boxes</div><div>9x cover plates</div>" })];
  await pull.run({});
  assert.equal(job("a").roughMaterials[0].po, ""); assert.equal(led("3100").how, "created");
});

test("a stale read of what's been handled can't bring back a removed card", async () => {
  const { db, sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const d = db.store.get("jobs/s").data; d.finishMaterials = d.finishMaterials.filter((c) => c.po !== "7302");
  // Another run's list read came back before the ledger doc landed: only the transaction's own read can stop it.
  const real = db.collection;
  db.collection = function (col) { const c = real.call(this, col); return col === "simpro_po_link" ? { ...c, where: () => ({ get: async () => ({ docs: [] }) }) } : c; };
  await pull.run({});
  assert(!job("s").finishMaterials.some((c) => c.po === "7302"));
});

test("the second PO with one matching card gets its own card, not the same card", async () => {
  const list = "<div>1x whisper green fan</div><div>1x 4 gang box</div><div>6x rolls of 12/2</div>";
  const { sim, pull, job } = setup({ a: { name: "A", simproNo: "1", roughMaterials: [{ id: "c", po: "", source: "CED", items: list }] } });
  sim.pos = [PO(3002, 1, "Residential (Rough In)", { notes: list }), PO(3001, 1, "Residential (Rough In)", { notes: list })];
  await pull.run({});
  const r = job("a").roughMaterials;
  assert.equal(r.length, 2); assert.equal(r[0].po, "3001", "oldest PO takes the card"); assert.equal(r[1].po, "3002");
});

test("running again changes nothing, and a removed card stays removed", async () => {
  const { sim, pull, job, db } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const first = JSON.stringify(job("s"));
  await pull.run({}); await pull.run({ full: true });
  assert.equal(JSON.stringify(job("s")), first, "no second card, no rewrite");
  const d = db.store.get("jobs/s").data; d.finishMaterials = d.finishMaterials.filter((c) => c.po !== "7302");
  await pull.run({}); await pull.run({ full: true });
  assert(!job("s").finishMaterials.some((c) => c.po === "7302"), "stays removed");
});

test("several overlapping runs still make one card", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await Promise.all([pull.run({}), pull.run({}), pull.run({})]);
  assert.equal(job("s").finishMaterials.filter((c) => c.po === "7302").length, 1);
});

test("no list in the notes: uses the PO's lines, or leaves it blank", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7383, 959, "Residential (Finish)", { notes: "" }), PO(7350, 959, "Residential (Finish)", { notes: "", vendor: "Hansen Lighting" })];
  sim.lines["7383"] = [{ Catalog: { Name: "FG RANGE/DRYER BOX 42 CU IN" }, Allocations: [{ Quantity: { Total: 2 } }] }];
  await pull.run({});
  const f = job("s").finishMaterials;
  assert.equal(f.find((c) => c.po === "7383").items, "2 x FG RANGE/DRYER BOX 42 CU IN");
  const h = f.find((c) => c.po === "7350");
  assert.equal(h.items, ""); assert.equal(h.source, "Hansen Lighting", "a listed Simpro supplier keeps its name (SW v621)"); assert.equal(h.simproSupplier, "Hansen Lighting");
});

test("sourceFor: every Simpro supplier keeps its name; an unlisted one is Other (SW v621)", async () => {
  const sp = require(path.join(__dirname, "..", "functions", "materialPO", "simproPull.js"));
  assert.equal(sp.sourceFor("Lowes"), "Lowe's");
  assert.equal(sp.sourceFor("ACE Hardware"), "ACE");
  assert.equal(sp.sourceFor("Cameron Crane "), "Cameron Crane");
  assert.equal(sp.sourceFor("Codale"), "Codale");
  assert.equal(sp.sourceFor("Some New Supplier"), "Other");
  // a crew card made before v621 says Other; it still takes the matching Codale PO's number
  const po = { ID: 7400, Vendor: { Name: "Codale" }, DateIssued: "2026-11-10", VendorNotes: "<div>3/4 EMT x 20</div><div>3/4 couplings x 40</div>", AssignedTo: { CostCenter: { Name: "Residential (Rough In)" } } };
  const card = { id: "c9", source: "Other", po: "", items: "3/4 EMT x 20<br>3/4 couplings x 40", needsOrder: true };
  const r = sp.planPo(po, { id: "j" }, { roughMaterials: [card] }, { nowIso: "2026-11-11T00:00:00Z" });
  assert.equal(r.how, "linked"); assert.equal(r.cardId, "c9"); assert.equal(r.patch.source, undefined, "the crew's Other is left alone");
});

test("notes can't put markup on the card", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7400, 959, "Residential (Finish)", { notes: "<div>2 &lt; 3 &amp; <img src=x onerror=alert(1)>wire &lt;script&gt;</div>" })];
  await pull.run({});
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7400").items, "2 &lt; 3 &amp; wire &lt;script&gt;");
});

test("skips: no job, job not in the app, a shared number, an archived job. Each comes in once it's fixed", async () => {
  const { db, sim, pull, job } = setup({ a: { name: "A", simproNo: "1370" }, b: { name: "A copy", simproNo: "1370" }, z: { name: "Z", simproNo: "77", archived: true } });
  sim.pos = [PO(4001, null, ""), PO(4002, 999, "Residential (Finish)"), PO(4003, 1370, "Residential (Finish)"), PO(4004, 77, "Residential (Finish)")];
  await pull.run({ full: true });
  assert(!db.store.has("simpro_po_link/4001") && !db.store.has("simpro_po_link/4002") && !db.store.has("simpro_po_link/4003") && !db.store.has("simpro_po_link/4004"));
  assert.equal((job("a").finishMaterials || []).length, 0);
  const lastRun = db.store.get("settings/simproPoSync").lastRun;
  assert.equal(lastRun.skips.length, 3);
  // Between hourly runs the waiting POs don't cost a read of every job.
  const before = db.reads.jobs;
  await pull.run({});
  assert.equal(db.reads.jobs, before, "no job read for POs already waiting");
  db.store.set("jobs/n", { data: { name: "New", simproNo: "999" } });
  await pull.run({ full: true });
  assert.equal(job("n").finishMaterials[0].po, "4002");
});

test("a quiet run reads no jobs and doesn't touch the status doc", async () => {
  const { db, sim, pull } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const reads = db.reads.jobs, at = db.store.get("settings/simproPoSync").lastRun.at, gets = sim.gets;
  await pull.run({});
  assert.equal(db.reads.jobs, reads); assert.equal(db.store.get("settings/simproPoSync").lastRun.at, at);
  assert.equal(sim.gets, gets + 1, "one list call");
});

test("Receipt already in Simpro: the new card arrives Picked Up, by Simpro, on the receipt's date", async () => {
  const { sim, pull, job, led } = setup({ s: STRATTON() });
  sim.pos = [PO(7319, 959, "Residential (Warranty)", { status: "Purchase Orders : Completed", date: "2026-10-21", notes: "<div>5x WR GFCI</div>" })];
  sim.receipts["7319"] = [{ ID: 8267, DateIssued: "2026-10-22" }];
  await pull.run({});
  const c = job("s").finishMaterials.find((x) => x.po === "7319");
  assert.equal(c.pickedUp, true); assert.equal(c.pickedUpBy, "Simpro"); assert.equal(c.pickedUpAt, "10/22/2026"); assert(led("7319").receiptAt);
});

test("Receipt comes later: the hourly run ticks Picked Up, once. Un-ticking stays un-ticked", async () => {
  const { db, sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  await pull.run({});   // not hourly, no receipt yet
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7302").pickedUp, false);
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }];
  await pull.run({});   // 5-minute run doesn't look for receipts
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7302").pickedUp, false);
  await pull.run({ full: true });
  const c = () => job("s").finishMaterials.find((x) => x.po === "7302");
  assert.equal(c().pickedUp, true); assert.equal(c().pickedUpBy, "Simpro"); assert.equal(c().pickedUpAt, "10/21/2026");
  const d = db.store.get("jobs/s").data; d.finishMaterials = d.finishMaterials.map((x) => (x.po === "7302" ? { ...x, pickedUp: false, pickedUpBy: "", pickedUpAt: "" } : x));
  const gets = sim.gets;
  await pull.run({ full: true });
  assert.equal(c().pickedUp, false, "a person's un-tick wins");
  assert.equal(sim.gets, gets + 1, "and it doesn't keep asking Simpro");
});

test("Someone ticks Picked Up while the hourly run is checking: theirs stands", async () => {
  const { db, sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const realReq = sim.req;
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }];
  const pull2 = make({ functions, db, requireAppKey: () => {}, simproReqWithRetry: async (m, p) => {
    if (p.includes("/receipts/")) { const d = db.store.get("jobs/s").data; d.finishMaterials = d.finishMaterials.map((c) => (c.po === "7302" ? { ...c, pickedUp: true, pickedUpBy: "Keegan", pickedUpAt: "10/30/2026" } : c)); }
    return realReq(m, p);
  } });
  await pull2.run({ full: true });
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7302").pickedUpBy, "Keegan");
});

test("A 5-minute run with a new PO still leaves older cards' receipts for the hourly run", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }];
  sim.pos.push(PO(7303, 959, "Residential (Finish)", { notes: "<div>keep</div>" }));
  await pull.run({});
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7302").pickedUp, false);
  assert(job("s").finishMaterials.some((c) => c.po === "7303"));
});

test("Receipt ticks typed and filled-in cards too, but never an app-sent card, and never overrides a person", async () => {
  const j = STRATTON();
  j.finishMaterials = [
    { id: "t", po: "7600", source: "CED", items: "typed" },
    { id: "p", po: "7601", source: "CED", items: "typed", pickedUp: true, pickedUpBy: "Keegan", pickedUpAt: "10/25/2026" },
    { id: "s", po: "7603", source: "CED", items: "typed", deliveredToShop: true },
    { id: "a", po: "7602", source: "CED", items: "app", poSentVia: "app", ordered: true },
  ];
  const { sim, pull, job } = setup({ s: j });
  sim.pos = [PO(7600, 959, "Residential (Finish)"), PO(7601, 959, "Residential (Finish)"), PO(7603, 959, "Residential (Finish)"), PO(7602, 959, "Residential (Finish)", { priv: "Sent from the Command Center" })];
  ["7600", "7601", "7602", "7603"].forEach((id) => { sim.receipts[id] = [{ ID: 1, DateIssued: "2026-10-22" }]; });
  await pull.run({ full: true });
  const f = (po) => job("s").finishMaterials.find((c) => c.po === po);
  assert.equal(f("7600").pickedUpBy, "Simpro");
  assert.equal(f("7601").pickedUpBy, "Keegan"); assert.equal(f("7601").pickedUpAt, "10/25/2026");
  assert.notEqual(f("7603").pickedUp, true);
  assert.notEqual(f("7602").pickedUp, true, "app-sent cards are outside this pull");
});

test("Someone types the number on their own card later: the pull folds its copy in", async () => {
  const { db, sim, pull, job, led } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }];
  await pull.run({});
  const d = db.store.get("jobs/s").data; d.roughMaterials = [{ id: "mine", po: "7302", source: "CED", items: "my list" }];
  await pull.run({ full: true });
  assert(!job("s").finishMaterials.some((c) => c.id === "simpro_7302"), "pull's copy gone");
  const m = job("s").roughMaterials[0];
  assert.equal(m.items, "my list"); assert.equal(m.pickedUp, true); assert.equal(m.pickedUpBy, "Simpro");
  assert.equal(led("7302").cardId, "mine"); assert.equal(led("7302").how, "typed");
});

test("A pull-made card someone has worked is never folded away", async () => {
  const { db, sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const d = db.store.get("jobs/s").data;
  d.finishMaterials = d.finishMaterials.map((c) => (c.po === "7302" ? { ...c, pickedUp: true, pickedUpBy: "Keegan" } : c));
  d.roughMaterials = [{ id: "mine", po: "7302", items: "my list" }];
  await pull.run({ full: true });
  assert(job("s").finishMaterials.some((c) => c.id === "simpro_7302"));
});

test("A PO voided in Simpro marks its pull-made card and deletes nothing", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)"), PO(7303, 959, "Residential (Finish)", { notes: "<div>keep</div>" })];
  await pull.run({});
  const gone = sim.pos[0]; sim.pos = [sim.pos[1]];
  sim.details["7302"] = { ...gone, Archived: true, Stage: "Voided" };
  await pull.run({ full: true });
  const c = job("s").finishMaterials.find((x) => x.po === "7302");
  assert(c, "still there"); assert.equal(c.simproVoided, true);
  assert.equal(job("s").finishMaterials.find((x) => x.po === "7303").simproVoided, undefined);
});

test("A draft (Stage Pending) waits until it's approved", async () => {
  const { sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [{ ...PO(7302, 959, "Residential (Finish)"), Stage: "Pending" }];
  await pull.run({ full: true });
  assert.equal(job("s").finishMaterials.length, 1);
  sim.pos[0].Stage = "Approved";
  await pull.run({ full: true });
  assert.equal(job("s").finishMaterials.length, 2);
});

test("Every write stamps its own moment: never repeated, never older than a save during the run", async () => {
  const { db, sim, job } = setup({ s: { name: "S", simproNo: "959", finishMaterials: [] } });
  sim.pos = [PO(7302, 959, "Residential (Finish)", { notes: "<div>a1</div><div>a2</div><div>a3</div>" }), PO(7303, 959, "Residential (Finish)", { notes: "<div>b1</div><div>b2</div><div>b3</div>" })];
  const realReq = sim.req; let clientStamp = "";
  const pull = make({ functions, db, requireAppKey: () => {}, simproReqWithRetry: async (m, p) => {
    if (p.includes("/receipts/") && clientStamp) { await new Promise((r) => setTimeout(r, 5)); clientStamp = new Date().toISOString(); db.store.get("jobs/s").updated_at = clientStamp; }
    return realReq(m, p);
  } });
  await pull.run({});
  assert.equal(job("s").finishMaterials.length, 2);
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }]; sim.receipts["7303"] = [{ ID: 2, DateIssued: "2026-10-21" }];
  clientStamp = "start";
  const seen = []; const real = db.ref; const update = db.store.set.bind(db.store);
  db.store.set = (k, v) => { if (k === "jobs/s" && v.saved_by === "Simpro PO pull") seen.push(v.updated_at); return update(k, v); };
  await pull.run({ full: true });
  assert.equal(seen.length, 2, "both receipts written");
  assert.notEqual(seen[0], seen[1], "a repeated stamp doesn't re-seed the open job");
  assert(db.store.get("jobs/s").updated_at >= clientStamp, "not older than the save made during the run");
});

test("A person ticks first, then un-ticks: a receipt later doesn't re-tick it", async () => {
  const { db, sim, pull, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  const c = () => job("s").finishMaterials.find((x) => x.po === "7302");
  const set = (p) => { const d = db.store.get("jobs/s").data; d.finishMaterials = d.finishMaterials.map((x) => (x.po === "7302" ? { ...x, ...p } : x)); };
  set({ pickedUp: true, pickedUpBy: "Keegan" });
  await pull.run({ full: true });
  set({ pickedUp: false, pickedUpBy: "" });
  sim.receipts["7302"] = [{ ID: 1, DateIssued: "2026-10-21" }];
  await pull.run({ full: true });
  assert.equal(c().pickedUp, false);
});

test("A pull-made card someone edited is never folded away, whichever field they changed", async () => {
  for (const edit of [{ items: "my edited list" }, { pickupDate: "11/9/2026" }, { source: "Other" }, { date: "11/1/2026" }]) {
    const { db, sim, pull, job } = setup({ s: STRATTON() });
    sim.pos = [PO(7302, 959, "Residential (Finish)")];
    await pull.run({});
    const d = db.store.get("jobs/s").data;
    d.finishMaterials = d.finishMaterials.map((c) => (c.po === "7302" ? { ...c, ...edit } : c));
    d.roughMaterials = [{ id: "mine", po: "7302", items: "other" }];
    await pull.run({ full: true });
    assert(job("s").finishMaterials.some((c) => c.id === "simpro_7302"), JSON.stringify(edit));
  }
});

test("One job failing in the hourly pass doesn't stop the others, and it's logged", async () => {
  const { db, sim, pull, job } = setup({ a: { name: "A", simproNo: "1" }, b: { name: "B", simproNo: "2" } });
  sim.pos = [PO(5001, 1, "Residential (Finish)"), PO(5002, 2, "Residential (Finish)")];
  await pull.run({});
  sim.receipts["5001"] = [{ ID: 1, DateIssued: "2026-10-21" }]; sim.receipts["5002"] = [{ ID: 2, DateIssued: "2026-10-21" }];
  const realTx = db.runTransaction.bind(db); let n = 0;
  db.runTransaction = (fn) => (n++ === 0 ? Promise.reject(new Error("too big")) : realTx(fn));
  const r = await pull.run({ full: true });
  assert.equal(r.errors.length, 1); assert.equal(r.counts.picked, 1);
  assert.equal(db.store.get("settings/simproPoSync").lastRun.errors.length, 1);
  db.runTransaction = realTx;
  await pull.run({ full: true });
  assert.equal(job("a").finishMaterials[0].pickedUp, true); assert.equal(job("b").finishMaterials[0].pickedUp, true);
});

test("Turning it off during a run stays off", async () => {
  const { db, sim, job } = setup({ s: STRATTON() });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  const realReq = sim.req;
  const pull = make({ functions, db, requireAppKey: () => {}, simproReqWithRetry: async (m, p) => { db.store.get("settings/simproPoSync").mode = "off"; return realReq(m, p); } });
  await pull.run({});
  assert.equal(db.store.get("settings/simproPoSync").mode, "off");
  assert(job("s").finishMaterials.length >= 1);
});

test("Simpro failing on the PO's lines retries instead of making a blank card for good", async () => {
  const { sim, pull, job, led } = setup({ s: STRATTON() });
  sim.pos = [PO(7383, 959, "Residential (Finish)", { notes: "" })];
  sim.lines["7383"] = [{ Catalog: { Name: "BOX" }, Allocations: [{ Quantity: { Total: 2 } }] }];
  sim.failLines = true;
  const r = await pull.run({});
  assert.equal(r.errors.length, 1); assert.equal(led("7383"), undefined);
  assert(!job("s").finishMaterials.some((c) => c.po === "7383"));
  sim.failLines = false;
  await pull.run({});
  assert.equal(job("s").finishMaterials.find((c) => c.po === "7383").items, "2 x BOX");
});

test("An archived copy sharing the number doesn't hold up the live job", async () => {
  const { sim, pull, job } = setup({ a: { name: "Live", simproNo: "1370" }, b: { name: "Old copy", simproNo: "1370", archived: true } });
  sim.pos = [PO(4003, 1370, "Residential (Finish)")];
  await pull.run({});
  assert.equal(job("a").finishMaterials[0].po, "4003"); assert.equal(job("b").finishMaterials, undefined);
});

test("A card with no id can't break a job", async () => {
  const j = STRATTON(); j.roughMaterials = [{ po: "7302", items: "no id here" }];
  const { sim, pull, led } = setup({ s: j });
  sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await pull.run({});
  assert.equal(led("7302").how, "created"); assert.equal(led("7302").cardId, "simpro_7302");
});

const fakeSheets = (fail) => { const calls = { update: [], clear: [] }; return { calls, api: { spreadsheets: { values: {
  batchUpdate: async (a) => { if (fail) throw new Error("no access"); calls.update.push(a); },
  batchClear: async (a) => { calls.clear.push(a); },
} } } }; };
const withSheets = (ctx, fs) => make({ functions, db: ctx.db, simproReqWithRetry: ctx.sim.req, requireAppKey: () => {}, getSheets: () => fs.api });

test("The hourly run rewrites the sheet: every PO, right status, Needs a look, sorted newest first", async () => {
  const j = STRATTON();
  j.finishMaterials.push({ id: "t", po: "7600", source: "CED", items: "typed list", ordered: true });
  const ctx = setup({ s: j, br: { name: "Bridle Wood", simproNo: "940", roughMaterials: [{ id: "z", po: "7235", items: "q" }] }, lot: { name: "Lot 23", simproNo: "1386" } });
  ctx.sim.pos = [
    PO(7302, 959, "Residential (Finish)"), PO(7319, 959, "Residential (Warranty)", { notes: "<div>5x WR GFCI</div>", date: "2026-10-21" }), PO(7600, 959, "Residential (Finish)"),
    PO(7384, 959, "Residential (Finish)", { priv: "Sent from the Command Center", by: "" }), PO(7345, 1460, "Residential (Finish)"), PO(7235, 1386, "Residential (Finish)"), PO(4001, null, ""),
  ];
  ctx.sim.receipts["7319"] = [{ ID: 1, DateIssued: "2026-10-22" }];
  const fs = fakeSheets();
  await withSheets(ctx, fs).run({ full: true });
  const data = Object.fromEntries(fs.calls.update[0].requestBody.data.map((d) => [d.range, d.values]));
  assert.equal(fs.calls.update[0].requestBody.valueInputOption, "RAW", "notes can't become formulas");
  const all = data["'All POs'!A2"];
  assert.deepEqual(all.map((r) => r[0]), [7600, 7384, 7345, 7319, 7302, 7235], "newest first, the no-job stock PO left out");
  const row = (po) => all.find((r) => r[0] === po);
  assert.deepEqual(row(7319).slice(2, 12), [959, "Stratton Residence", "CED", "Finish", "Residential (Warranty)", "Treycen Rollene", "New from Simpro", "Picked Up", "Simpro · 10/22/2026", "5x WR GFCI"]);
  assert.equal(row(7319)[1], 46316, "10/21/2026 as a sortable date");
  assert.equal(row(7302)[9], "Order Sent"); assert.equal(row(7600)[8], "Typed on a card"); assert.equal(row(7384)[8], "Sent from the app");
  assert.equal(row(7345)[3], "(no open job in the app)"); assert.equal(row(7345)[9], "Waiting");
  const needs = data["'Needs a look'!A2"];
  assert.deepEqual(needs.map((r) => [r[1], r[0]]).sort((a, b) => a[0] - b[0]), [[7235, "Typed on another job's card"], [7345, "No open job has this Simpro #"], [7384, "Sent from the app, but no card has the number"]]);
  assert(needs.find((r) => r[1] === 7235)[6].includes("Bridle Wood"));
  const sum = data["Summary!A3"];
  assert.deepEqual(sum[0], ["All jobs", "", 6, 3, 1, 0, 1, 3, 1, 3]);
  const st = sum.find((r) => r[0] === "Stratton Residence");
  assert.deepEqual(st.slice(1), [959, 4, 2, 1, 0, 1, 2, 1, 1]);
  assert(data["Summary!A1"][0][0].includes("10/3/2026"));
  assert.deepEqual(fs.calls.clear[0].requestBody.ranges, [`Summary!A${3 + sum.length}:J`, `'All POs'!A${2 + all.length}:L`, `'Needs a look'!A${2 + needs.length}:G`], "old rows below get cleared, after the write");
  const cfg = ctx.db.store.get("settings/simproPoSync");
  assert.equal(cfg.totals.pos, 6); assert.equal(cfg.totals.needsLook, 3); assert.equal(cfg.sheetError, ""); assert(cfg.sheetAt);
  // 2026-11-04: the dashboard's own copy of Needs a look and Summary, on the same doc.
  assert.equal(cfg.view.needs.length, 3); assert.equal(cfg.sheetOff, false);
  assert.deepEqual(Object.keys(cfg.view.needs[0]).sort(), ["date", "job", "jobNo", "po", "todo", "vendor", "what"]);
  assert.equal(cfg.view.jobs.length, sum.length - 1, "per-job rows, the All jobs total left out");
  assert.equal(cfg.view.jobs.find((r) => r.job === "Stratton Residence").pos, 4);
});

test("Sheet switched off: the dashboard copy still updates, the sheet is not touched", async () => {
  const ctx = setup({ s: STRATTON() });
  ctx.db.store.set("settings/simproPoSync", { mode: "live", sheet: "off" });
  ctx.sim.pos = [PO(7302, 959, "Residential (Finish)"), PO(7345, 1460, "Residential (Finish)")];
  const fs = fakeSheets();
  await withSheets(ctx, fs).run({ full: true });
  assert.equal(fs.calls.update.length, 0); assert.equal(fs.calls.clear.length, 0);
  const cfg = ctx.db.store.get("settings/simproPoSync");
  assert.equal(cfg.sheetOff, true); assert.equal(cfg.view.needs.length, 1); assert(cfg.viewAt); assert.equal(cfg.sheetAt, undefined);
});

test("A sheet failure changes nothing else, is logged, and old rows stay", async () => {
  const ctx = setup({ s: STRATTON() });
  ctx.sim.pos = [PO(7302, 959, "Residential (Finish)")];
  const fs = fakeSheets(true);
  const r = await withSheets(ctx, fs).run({ full: true });
  assert.equal(r.ok, true); assert.equal(fs.calls.clear.length, 0, "nothing cleared when the write failed");
  assert(ctx.job("s").finishMaterials.some((c) => c.po === "7302"));
  assert.equal(ctx.db.store.get("settings/simproPoSync").sheetError, "no access");
});

test("The sheet only rewrites hourly, and a voided PO stays on it", async () => {
  const ctx = setup({ s: STRATTON() });
  ctx.sim.pos = [PO(7302, 959, "Residential (Finish)")];
  const fs = fakeSheets();
  const pull = withSheets(ctx, fs);
  await pull.run({});
  assert.equal(fs.calls.update.length, 0, "not on a 5-minute run");
  const gone = ctx.sim.pos[0]; ctx.sim.pos = [];
  ctx.sim.details["7302"] = { ...gone, Archived: true, Stage: "Voided" };
  await pull.run({ full: true });
  const data = Object.fromEntries(fs.calls.update[0].requestBody.data.map((d) => [d.range, d.values]));
  assert.equal(data["'All POs'!A2"][0][9], "Voided in Simpro");
  assert.equal(data["'Needs a look'!A2"][0][0], "Voided in Simpro");
});

test("Watch mode (also when the setting is missing) changes no job and writes only its own log", async () => {
  for (const mode of ["dry", null]) {
    const { db, sim, pull, job } = setup({ s: STRATTON() }, mode);
    sim.pos = [PO(7302, 959, "Residential (Finish)"), PO(7384, 959, "Residential (Finish)", { priv: "Sent from the Command Center" })];
    const before = JSON.stringify(job("s"));
    assert.equal((await pull.run({})).skipped, true, "watch mode only looks hourly");
    await pull.run({ full: true });
    assert.equal(JSON.stringify(job("s")), before);
    assert(![...db.store.keys()].some((k) => k.startsWith("simpro_po_link/")));
    const lr = db.store.get("settings/simproPoSync").lastRun;
    assert.equal(lr.counts.created, 1); assert.equal(lr.rows[0].po, 7302); assert.equal(lr.counts.fromApp, 1);
  }
});

test("Off stops everything. A Simpro failure changes nothing and is logged", async () => {
  const off = setup({ s: STRATTON() }, "off");
  off.sim.pos = [PO(7302, 959, "Residential (Finish)")];
  await off.pull.run({ full: true });
  assert.equal(off.sim.gets, 0);
  const bad = setup({ s: STRATTON() });
  bad.sim.pos = [PO(7302, 959, "Residential (Finish)")]; bad.sim.fail = true;
  const r = await bad.pull.run({ full: true });
  assert.equal(r.ok, false); assert.equal(bad.job("s").finishMaterials.length, 1);
  assert(bad.db.store.get("settings/simproPoSync").lastError);
});

test("One job's card write failing doesn't stop the others", async () => {
  const { db, sim, pull, job } = setup({ a: { name: "A", simproNo: "1" }, b: { name: "B", simproNo: "2" } });
  sim.pos = [PO(5001, 1, "Residential (Finish)"), PO(5002, 2, "Residential (Finish)")];
  const realTx = db.runTransaction.bind(db); let n = 0;
  db.runTransaction = (fn) => (n++ === 1 ? Promise.reject(new Error("contention")) : realTx(fn));
  const r = await pull.run({});
  assert.equal(r.errors.length, 1);
  assert.equal([job("a").finishMaterials, job("b").finishMaterials].filter(Boolean).length, 1);
  db.runTransaction = realTx;
  await pull.run({ full: true });
  assert.equal(job("a").finishMaterials[0].po, "5001"); assert.equal(job("b").finishMaterials[0].po, "5002");
});

test("The one-job callable uses the job filter that works", async () => {
  const { sim, pull, job } = setup({ a: { name: "A", simproNo: "1" }, b: { name: "B", simproNo: "2" } });
  sim.pos = [PO(5001, 1, "Residential (Finish)"), PO(5002, 2, "Residential (Finish)")];
  await pull.run({ jobNo: "1" });
  assert.equal(job("a").finishMaterials[0].po, "5001");
  assert.equal(job("b").finishMaterials, undefined);
});

test("The app's save keeps a card the server added while someone had the job open", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
  const start = src.indexOf("const _threeWayMerge = (base, client, server) => {");
  const end = src.indexOf("\n};", start) + 3;
  assert(start > 0 && end > start, "found _threeWayMerge");
  const ctx = {};
  vm.runInNewContext(`const _jeq = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);\n${src.slice(start, end)}\nthis.merge = _threeWayMerge;`, ctx);
  const base = [{ id: "a", po: "1", items: "x" }];
  const client = [{ id: "a", po: "1", items: "x edited on a phone" }];
  const server = [{ id: "a", po: "1", items: "x" }, { id: "simpro_7302", po: "7302", simproPulled: true }];
  const out = JSON.parse(JSON.stringify(ctx.merge(base, client, server)));
  assert.equal(out.length, 2); assert.equal(out[0].items, "x edited on a phone"); assert.equal(out[1].id, "simpro_7302");
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; }
    catch (e) { console.error(`FAIL: ${name}\n`, e); process.exit(1); }
  }
  console.log(`simpro-pull-sim: ${passed} scenarios passed`);
})();
