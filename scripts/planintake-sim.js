// Plan-intake watcher simulation — run: node scripts/planintake-sim.js (in the prebuild chain)
// Drives functions/planIntake/watcher.js end-to-end against in-memory fakes of
// Calendar, Simpro, Drive and Firestore, using the real Tolbert shapes
// (walk 2026-07-08 → Quote #2299 → Job #1407). No network, no credentials.
// Proves: dry writes nothing outside planIntakeState/agentQueue/agentFindings;
// live creates _Quotes/Quote #2299, renames + moves it to "#1407 - Tolbert
// Residence" with the SAME id, links the app job only when it had no folder,
// files attachments once (name + md5 dedupe), never deletes, and is idempotent.
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const makePlanIntake = require("../functions/planIntake/watcher.js");
const { planDocPull } = require("../functions/docPull.js");

const PARENT = "PARENT";
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);

function world({ ccJobs = {}, appQuoteFolder = null, seedFiles = [], mail = [] } = {}) {
  // ── Firestore ──
  const store = new Map();               // "coll/id" → object
  const writes = [];
  const get = (k) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined;
  const setPath = (o, path, v) => { const ks = path.split("."); let c = o; for (const k of ks.slice(0, -1)) c = c[k] = c[k] || {}; c[ks[ks.length - 1]] = v; };
  const docRef = (coll, id) => ({
    id, path: `${coll}/${id}`,
    async get() { const d = get(`${coll}/${id}`); return { exists: !!d, id, data: () => d, ref: docRef(coll, id) }; },
    async set(v, opt) { writes.push({ op: "set", path: `${coll}/${id}`, v }); store.set(`${coll}/${id}`, opt && opt.merge ? { ...(get(`${coll}/${id}`) || {}), ...JSON.parse(JSON.stringify(v)) } : JSON.parse(JSON.stringify(v))); },
    async create(v) { if (store.has(`${coll}/${id}`)) { const e = new Error("exists"); e.code = 6; throw e; } writes.push({ op: "create", path: `${coll}/${id}`, v }); store.set(`${coll}/${id}`, JSON.parse(JSON.stringify(v))); },
    async update(v) {
      const cur = get(`${coll}/${id}`); if (!cur) throw new Error(`no doc ${coll}/${id}`);
      writes.push({ op: "update", path: `${coll}/${id}`, v });
      for (const [k, val] of Object.entries(v)) {
        if (val && val.__arrayUnion) { const arr = k.split(".").reduce((o, x) => o && o[x], cur) || []; setPath(cur, k, [...new Set([...arr, val.v])]); }
        else setPath(cur, k, JSON.parse(JSON.stringify(val)));
      }
      store.set(`${coll}/${id}`, cur);
    },
  });
  const query = (coll, filters) => ({
    where(f, op, v) { return query(coll, [...filters, [f, op, v]]); },
    limit() { return this; },
    async get() {
      const docs = [...store.keys()].filter(k => k.startsWith(`${coll}/`)).map(k => k.slice(coll.length + 1))
        .filter(id => filters.every(([f, op, v]) => { const val = f.split(".").reduce((o, x) => o && o[x], get(`${coll}/${id}`)); return op === "in" ? v.includes(val) : val === v; }))
        .map(id => ({ id, ref: docRef(coll, id), data: () => get(`${coll}/${id}`) }));
      return { docs };
    },
  });
  const db = {
    collection: (coll) => ({ doc: (id) => docRef(coll, id), where: (f, op, v) => query(coll, [[f, op, v]]), get: () => query(coll, []).get() }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), update: (r, v) => r.update(v), set: (r, v, o) => r.set(v, o) }); },
  };
  for (const [id, data] of Object.entries(ccJobs)) store.set(`jobs/${id}`, { data, updated_at: "x" });

  // ── Drive ──
  const files = new Map();               // id → {id,name,mimeType,parents,md5Checksum}
  let nextId = 1; const driveLog = [];
  files.set(PARENT, { id: PARENT, name: "Job Plans", mimeType: "application/vnd.google-apps.folder", parents: [] });
  if (appQuoteFolder) files.set(appQuoteFolder, { id: appQuoteFolder, name: "Tolbert Residence", mimeType: "application/vnd.google-apps.folder", parents: [PARENT] });
  for (const f of seedFiles) files.set(f.id, { mimeType: "application/pdf", ...f });
  const drive = { files: {
    async list({ q }) { const pid = q.match(/'([^']+)' in parents/)[1]; return { data: { files: [...files.values()].filter(f => f.parents.includes(pid)) } }; },
    async create({ requestBody }) { const id = `F${String(nextId++).padStart(12, "0")}`; /* Drive-length ids: the real id check wants 10+ */ files.set(id, { id, name: requestBody.name, mimeType: requestBody.mimeType, parents: requestBody.parents }); driveLog.push(["create", requestBody.name]); return { data: { id } }; },
    async get({ fileId, alt }) { const f = files.get(fileId); if (!f) throw new Error("404"); if (alt === "media") return { data: f.content || Buffer.alloc(0) }; const { content, ...meta } = f; return { data: meta }; },
    async update({ fileId, requestBody, addParents, removeParents }) {
      const f = files.get(fileId);
      if (requestBody && requestBody.name) f.name = requestBody.name;
      if (removeParents) f.parents = f.parents.filter(p => !removeParents.split(",").includes(p));
      if (addParents) f.parents.push(addParents);
      driveLog.push(["update", f.name, addParents || ""]); return { data: { ...f } };
    },
    async delete() { throw new Error("DELETE CALLED — never allowed"); },
  } };
  const upload = async (auth, { name, parentId, buffer }) => {
    const id = `U${String(nextId++).padStart(12, "0")}`; files.set(id, { id, name, mimeType: "application/pdf", parents: [parentId], md5Checksum: crypto.createHash("md5").update(buffer).digest("hex"), content: buffer });
    driveLog.push(["upload", name]); return id;
  };

  // ── Simpro (Tolbert) ──
  const pdf = (s) => Buffer.from(`%PDF-${s}`).toString("base64");
  const quoteFiles = [{ ID: 11, Filename: "Tolbert Residence Full Set.pdf", folder: "Plans", b: pdf("full") },
                      { ID: 12, Filename: "TOLBERT ELECTRICAL — Redlines.pdf", folder: "Plans", b: pdf("red") }];
  const jobFiles = [{ ID: 21, Filename: "Tolbert Residence Full Set.pdf", folder: "Plans", b: pdf("full") },     // same file, carried over
                    { ID: 22, Filename: "Tolbert Full Set REV2.pdf", folder: "Plans", b: pdf("full") }];       // renamed copy → md5 dedupe
  let simproCalls = 0;
  const simpro = async (method, path) => {
    simproCalls++;
    assert.strictEqual(method, "GET", "Simpro is read-only");
    const p = path.split("?")[0];
    const ok = (data) => ({ ok: true, status: 200, data });
    if (p === "/sites/") return ok([{ ID: 6488, Name: "Tolbert Residence", Address: { Address: "1326 S 5360 E" } }]);
    if (p === "/quotes/" ) return ok([{ ID: 2299, Name: "Tolbert Residence - Wasatch County", Stage: "Complete", DateIssued: "2025-11-21", IsClosed: true, JobNo: 1407, LinkedJobID: null },
                                      { ID: 3074, Name: "7/20 Additional Items", Stage: "Approved", DateIssued: "2026-07-21", IsClosed: true, JobNo: 1407, LinkedJobID: null }]);
    if (p === "/jobs/") return ok([{ ID: 1407, Name: "Tolbert Residence - Wasatch County", Stage: "Progress", DateIssued: "2026-07-15", ConvertedFrom: { ID: 2299, Type: "Quote", Date: "2026-07-15T08:04:33-06:00" } }]);
    if (p === "/quotes/2299") return ok({ ID: 2299, Name: "Tolbert Residence - Wasatch County", Stage: "Complete", IsClosed: true, JobNo: 1407 });
    if (p === "/jobs/1407") return ok({ ID: 1407, Name: "Tolbert Residence - Wasatch County", Site: { ID: 6488, Name: "Tolbert Residence" }, ConvertedFrom: { ID: 2299, Type: "Quote", Date: "2026-07-15T08:04:33-06:00" } });
    const m = p.match(/^\/(quotes|jobs)\/(\d+)\/attachments\/(folders|files)\/(\d+)?$/);
    if (m) {
      const list = m[1] === "quotes" ? quoteFiles : jobFiles;
      if (m[3] === "folders") return ok([{ ID: 1, Name: "Plans" }, { ID: 2, Name: "Take-offs" }]);
      if (!m[4]) return ok(list.map(f => ({ ID: f.ID, Filename: f.Filename })));
      const f = list.find(x => String(x.ID) === m[4]);
      if (path.includes("display=Base64")) return ok({ Base64Data: f.b });
      return ok({ ID: f.ID, Filename: f.Filename, FileSizeBytes: 1000, MimeType: "application/pdf", Folder: { Name: f.folder } });
    }
    throw new Error(`unexpected Simpro path ${path}`);
  };

  // ── Calendar + google + functions shims ──
  const events = [
    { id: "ev1", summary: "Tolbert Residence - Redline Walkthrough", location: "1326 S 5360 E", status: "confirmed", creator: { email: "josh@homesteadelectric.net" },
      start: { dateTime: "2026-07-08T09:00:00-06:00" }, conferenceUrl: "https://meet.google.com/x", htmlLink: "https://cal/ev1" },
    { id: "ev2", summary: "Weekly Scramble", location: "974 S Main St", recurringEventId: "r", creator: { email: "josh@homesteadelectric.net" }, start: { dateTime: "2026-07-07T09:00:00-06:00" } },
    { id: "ev3", summary: "Lot 91 - Redline Walk", creator: { email: "brady@homesteadelectric.net" }, start: { dateTime: "2026-08-03T09:00:00-06:00" } },
  ];
  process.env.PLAN_INTAKE_GOOGLE_OAUTH = JSON.stringify({ client_id: "c", client_secret: "s", refresh_token: "r" });
  const google = {
    auth: { GoogleAuth: function () {}, OAuth2: class { constructor(id, sec) { this.id = id; } setCredentials(c) { this.c = c; } } },
    calendar: () => ({ events: { list: async () => ({ data: { items: events } }) } }),
    gmail: () => ({ users: { messages: {
      list: async () => ({ data: { messages: mail.map(m => ({ id: m.id })).reverse() } }),
      get: async ({ id }) => ({ data: mail.find(m => m.id === id) }),
      attachments: { get: async ({ messageId, id }) => ({ data: { data: Buffer.from(mail.find(m => m.id === messageId).bytes[id]).toString("base64").replace(/\+/g, "-").replace(/\//g, "_") } }) },
    } } }),
  };
  const pushes = [], mails = [];
  const HttpsError = class extends Error { constructor(code, msg) { super(msg); this.code = code; } };
  const chain = { runWith: () => chain, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (fn) => fn }) }) }, https: { onCall: (fn) => fn, onRequest: (fn) => fn, HttpsError }, logger: { info() {}, warn() {}, error() {} } };
  const pi = makePlanIntake({
    functions: chain, db, google, TZ: "America/Denver", FieldValue: { arrayUnion: (v) => ({ __arrayUnion: true, v }), increment: (n) => n },
    simproReqWithRetry: simpro, driveFullClient: () => ({ drive, auth: {} }), driveUploadResumable: upload, planDocPull,
    jobFolderName: (j) => (j.simproNo ? `#${j.simproNo} - ${j.name}` : j.name), JOBS_PARENT_FOLDER_ID: PARENT,
    requireAppKey: (d) => { if (!d || d._appKey !== "k") throw new HttpsError("permission-denied", "key"); },
    sendToName: async (name, n) => { pushes.push({ name, ...n }); },
    sendGcMail: async (m) => { mails.push(m); return true; },
    requireAdmin: async (d) => { const u = { koy: { name: "Koy", caps: ["resi.head"], access: "admin" }, keegan: { name: "Keegan", caps: [], access: "manager" } }[String(d && d.by).toLowerCase()]; if (!u || d.pin !== "1234") throw new HttpsError("permission-denied", "pin"); return u; },
    gcAccessOf: (u) => u.access,
  });
  const setMode = (mode, extra = {}) => store.set("planIntakeState/config", { ...(get("planIntakeState/config") || {}), mode, ...extra });
  const docs = (coll) => [...store.keys()].filter(k => k.startsWith(`${coll}/`)).map(k => ({ id: k.slice(coll.length + 1), ...get(k) }));
  return { pi, store, get, writes, files, driveLog, setMode, docs, pushes, mails, simproCalls: () => simproCalls };
}
const jobWrites = (w) => w.writes.filter(x => x.path.startsWith("jobs/"));
const outsideAllowed = (w) => w.writes.filter(x => !/^(planIntakeState|agentQueue|agentFindings|jobs)\//.test(x.path));

(async () => {
// 1 ── DRY: findings only, nothing in Drive, no job writes
{
  const w = world({ ccJobs: { j1407: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" } } });
  const c = await (w.pi._runOnce());
  eq([c.matched, c.queued, c.converted], [1, 1, 1], "dry: 1 walk matched, Lot 91 queued, conversion seen");
  eq(w.driveLog, [], "dry: no Drive writes at all");
  eq(jobWrites(w), [], "dry: no job writes");
  eq(outsideAllowed(w), [], "dry: writes only to planIntakeState / agentQueue / agentFindings");
  assert(w.docs("agentFindings").every(f => f.mode === "dry" && f.id.startsWith("dry_")), "dry findings are tagged + prefixed");
  assert(w.docs("agentFindings").some(f => /Would create folder "Quote #2299"/.test(f.summary)), "dry says what it would create");
  assert(w.docs("agentFindings").some(f => /Would rename Quote #2299 → "#1407 - Tolbert Residence"/.test(f.summary)), "dry says what it would rename");
  assert(w.docs("agentQueue").some(q => q.type === "walk_unmatched" && q.title === "Lot 91 - Redline Walk"), "Lot 91 queued for the Routine");
  assert(!w.docs("planIntakeState").some(d => d.id === "quote_2299"), "dry never writes un-prefixed (live) state");
}

// 2 ── LIVE: folder made in _Quotes, renamed + moved on conversion (same id), app job linked, files once
{
  const w = world({ ccJobs: { j1407: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" } } });
  w.setMode("live");
  await (w.pi._runOnce());
  const quotes = [...w.files.values()].find(f => f.name === "_Quotes");
  assert(quotes && quotes.parents[0] === PARENT, "_Quotes made under the jobs parent");
  const st = w.get("planIntakeState/quote_2299");
  const folder = w.files.get(st.folderId);
  eq(folder.name, "#1407 - Tolbert Residence", "renamed to CC's job format");
  eq(folder.parents, [PARENT], "moved out of _Quotes into the jobs parent (same id)");
  eq(w.get("jobs/j1407").data.driveFolderId, st.folderId, "app job linked to the quote folder");
  eq(jobWrites(w).map(x => Object.keys(x.v).sort()), [["data.driveFolderId", "updated_at"]], "the ONLY job write is driveFolderId (+ ISO updated_at)");
  const uploads = w.driveLog.filter(x => x[0] === "upload").map(x => x[1]);
  eq(uploads.sort(), ["TOLBERT ELECTRICAL — Redlines.pdf", "Tolbert Residence Full Set.pdf"], "quote files copied; job's same-name + same-bytes copies deduped");
  const kids = (id) => [...w.files.values()].filter(f => f.parents.includes(id));
  const kid = (id, name) => kids(id).find(f => f.name === name);
  eq(kids(st.folderId).map(f => f.name).sort(), ["ARCHIVE", "MOST UPDATED", "SIMPRO"], "job folder = SIMPRO / MOST UPDATED / ARCHIVE");
  eq(kids(kid(st.folderId, "MOST UPDATED").id).map(f => f.name).sort(), ["APPLIANCE SPECS", "CABINET PLANS", "DESIGN", "REDLINES", "SPECS"], "MOST UPDATED has the standard categories");
  const simproPlans = kid(kid(st.folderId, "SIMPRO").id, "Plans");
  eq(kids(simproPlans.id).map(f => f.name).sort(), ["TOLBERT ELECTRICAL — Redlines.pdf", "Tolbert Residence Full Set.pdf"], "Simpro's Plans folder mirrored under SIMPRO");
  assert(kid(kid(st.folderId, "SIMPRO").id, "Take-offs"), "empty Simpro folders are mirrored too");
  eq(kids(kid(st.folderId, "MOST UPDATED").id).filter(f => f.mimeType !== "application/vnd.google-apps.folder").length, 0, "the watcher never files into MOST UPDATED");
  assert(Object.values(st.ledger || w.get("planIntakeState/quote_2299").ledger).length === 4, "all 4 Simpro files are in the ledger");
  // second run: nothing new
  const before = { drive: w.driveLog.length, findings: w.docs("agentFindings").length };
  w.store.set("planIntakeState/quote_2299", { ...w.get("planIntakeState/quote_2299"), lastFilesCheckAt: "" });   // force a files re-check
  await (w.pi._runOnce());
  eq(w.driveLog.length, before.drive, "re-run: no Drive changes");
  eq(w.docs("agentFindings").length, before.findings, "re-run: no duplicate findings");
}

// 3 ── LIVE: app job already has its own folder → conflict finding, nothing replaced
{
  const w = world({ ccJobs: { j1407: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "handmade" } } });
  w.setMode("live");
  await (w.pi._runOnce());
  eq(w.get("jobs/j1407").data.driveFolderId, "handmade", "an existing link (even a short, non-ID value) is never replaced");
  assert(w.docs("agentFindings").some(f => f.type === "folder_conflict"), "conflict is reported");
}

// 4 ── LIVE: job not imported yet → linkQuoteFolder links it at import, instead of a duplicate
{
  const w = world({});
  w.setMode("live");
  await (w.pi._runOnce());
  const st = w.get("planIntakeState/quote_2299");
  w.store.set("jobs/new1", { data: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" }, updated_at: "x" });
  const r = await (w.pi.linkQuoteFolder({ jobId: "new1", _appKey: "k" }));
  eq([r.linked, r.folderId], [true, st.folderId], "import links the existing quote folder");
  eq(w.get("jobs/new1").data.driveFolderId, st.folderId, "and stamps it on the job");
  const again = await (w.pi.linkQuoteFolder({ jobId: "new1", _appKey: "k" }));
  eq(again.alreadyLinked, true, "second call is a no-op");
  await assert.rejects(w.pi.linkQuoteFolder({ jobId: "new1" }), /key/, "app key required");
}

// 5 ── DRY/TEST: linkQuoteFolder never links outside live
{
  const w = world({});
  w.store.set("jobs/new1", { data: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" }, updated_at: "x" });
  const r = await (w.pi.linkQuoteFolder({ jobId: "new1", _appKey: "k" }));
  eq([r.linked, r.mode], [false, "dry"], "dry: the app's Create Drive folder runs exactly as today");
}

// 6 ── LIVE: an app quote record that already has a folder is adopted, not duplicated
{
  const w = world({ ccJobs: { q1: { type: "quote", name: "Tolbert Residence", simproQuoteNo: "2299", simproNo: "", driveFolderId: "1AppQuoteFolder_abcdefghijkl" } }, appQuoteFolder: "1AppQuoteFolder_abcdefghijkl" });
  w.setMode("live");
  await (w.pi._runOnce());
  eq(w.get("planIntakeState/quote_2299").folderId, "1AppQuoteFolder_abcdefghijkl", "the app quote's own folder is reused");
  assert(![...w.files.values()].some(f => f.name === "Quote #2299"), "no second folder made");
}

// 7 ── calendar sign-in missing: run still tracks quotes, Koy gets ONE push a day, an error finding is logged
{
  const w = world({});
  w.setMode("live");
  await (w.pi._runOnce());                                   // seed quote state with the sign-in present
  const saved = process.env.PLAN_INTAKE_GOOGLE_OAUTH;
  delete process.env.PLAN_INTAKE_GOOGLE_OAUTH;
  try {
    const c = await (w.pi._runOnce());
    assert(c.errors.some(e => /^calendar: calendar sign-in missing/.test(e)), "missing sign-in is a calendar error");
    eq(w.pushes.length, 1, "Koy is pushed once");
    eq(w.pushes[0].name, "Koy", "the push goes to Koy");
    assert(/stopped working/.test(w.pushes[0].body), "the push says what to do");
    await (w.pi._runOnce());
    eq(w.pushes.length, 1, "no second push the same day");
    assert(w.docs("agentFindings").some(f => f.type === "watcher_error"), "error finding logged");
  } finally { process.env.PLAN_INTAKE_GOOGLE_OAUTH = saved; }
}

// 8 ── an app folder people already organised: their "Most Updated Plans" is kept, a plan they filed is not re-copied
{
  const APP = "1AppQuoteFolder_abcdefghijkl";
  const fullMd5 = crypto.createHash("md5").update(Buffer.from("%PDF-full")).digest("hex");
  const w = world({ ccJobs: { q1: { type: "quote", name: "Tolbert Residence", simproQuoteNo: "2299", simproNo: "", driveFolderId: APP } }, appQuoteFolder: APP,
    seedFiles: [{ id: "MUP", name: "Most Updated Plans", mimeType: "application/vnd.google-apps.folder", parents: [APP] },
                { id: "CAB", name: "Cabinet + Appliance Specs", mimeType: "application/vnd.google-apps.folder", parents: ["MUP"] },
                { id: "HAND", name: "Tolbert set (from GC).pdf", parents: ["CAB"], md5Checksum: fullMd5 }] });
  w.setMode("live");
  await (w.pi._runOnce());
  const top = [...w.files.values()].filter(f => f.parents.includes(APP)).map(f => f.name).sort();
  eq(top, ["ARCHIVE", "Most Updated Plans", "SIMPRO"], "existing Most Updated Plans kept, no second MOST UPDATED; SIMPRO + ARCHIVE added");
  eq(w.driveLog.filter(x => x[0] === "upload").map(x => x[1]), ["TOLBERT ELECTRICAL — Redlines.pdf"], "the full set people already filed (same bytes, other name) is not copied again");
  assert(w.driveLog.every(x => x[0] !== "update" || x[1] !== "Tolbert set (from GC).pdf"), "hand-filed files untouched");
}

// 9 ── going live "from here on": walks dated before walksSince are never acted on
{
  const w = world({ ccJobs: { j1407: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" } } });
  w.setMode("live", { walksSince: "2026-10-04T06:00:00Z" });
  const c = await (w.pi._runOnce());
  eq([c.matched, c.queued, c.pending, c.existingJob], [0, 0, 0, 0], "no past walk is matched, queued or retried");
  eq(w.driveLog, [], "no Drive writes for past walks");
  eq(jobWrites(w), [], "no job writes for past walks");
  eq(w.docs("agentQueue").length, 0, "nothing queued for past walks");
}

// 10 ── Phase 2: email capture → _Plan Inbox → Routine API decisions
{
  const hdr = (from, subject, extra = []) => [{ name: "From", value: from }, { name: "Subject", value: subject }, ...extra];
  const pdfPart = (name, id) => ({ filename: name, mimeType: "application/pdf", body: { attachmentId: id, size: 10 } });
  const body = (t) => ({ mimeType: "text/plain", body: { data: Buffer.from(t).toString("base64") } });
  const mail = [
    { id: "m1", threadId: "t1", internalDate: String(Date.parse("2026-10-04T15:00:00Z")), bytes: { a: "%PDF-co" },
      payload: { headers: hdr("bids@homesteadelectric.net", "Quote/Change Order Approved - Tuhaye Hollow"), parts: [pdfPart("CO.pdf", "a")] } },
    { id: "m2", threadId: "t2", internalDate: String(Date.parse("2026-10-04T16:00:00Z")), bytes: { a: "%PDF-cabinets-rev2" },
      payload: { headers: hdr("Josh <josh@homesteadelectric.net>", "Fwd: Tolbert cabinets"), parts: [body("Updated cabinets attached"), pdfPart("Tolbert Cabinets Rev 2.pdf", "a")] } },
    { id: "m3", threadId: "t3", internalDate: String(Date.parse("2026-10-04T17:00:00Z")), bytes: { a: "%PDF-cabinets-rev2" },
      payload: { headers: hdr("designer@studio.com", "cabinets again"), parts: [pdfPart("copy.pdf", "a")] } },
    { id: "m4", threadId: "t4", internalDate: String(Date.parse("2026-10-04T18:00:00Z")), bytes: {},
      payload: { headers: hdr("gc@builder.com", "plans link"), parts: [body("Set is here https://app.box.com/s/abc123xyz")] } },
  ];
  const w = world({ ccJobs: { j1407: { name: "Tolbert Residence", simproNo: "1407", driveFolderId: "" } }, mail });
  w.setMode("live", { mailSince: "2026-10-04T00:00:00Z" });
  const c10 = await (w.pi._runOnce());
  if (process.env.SIMDEBUG) console.log("RUN10", JSON.stringify(c10), JSON.stringify(w.get("jobs/j1407")));
  const q = w.docs("agentQueue").filter(x => x.type === "email_pdf");
  eq(q.map(x => x.source).sort(), ["attachment", "box link"], "CO approval skipped, duplicate dropped, attachment + Box link queued");
  const item = q.find(x => x.source === "attachment");
  const inbox = [...w.files.values()].find(f => f.name === "_Plan Inbox");
  assert(inbox && inbox.parents[0] === PARENT, "_Plan Inbox made under the jobs parent");
  eq(w.files.get(item.inboxFileId).parents, [inbox.id], "PDF copied into _Plan Inbox");
  eq(item.from, "josh@homesteadelectric.net", "sender recorded");
  eq(w.get("planIntakeState/mail_m1").status, "skipped", "skip recorded so it is never re-read");
  eq(w.get("planIntakeState/mail_m3").status, "duplicate", "same bytes from another email = duplicate");

  const TOKEN = "f".repeat(64);
  process.env.PLAN_ROUTINE_TOKEN = TOKEN;
  const call = async (method, path, { body: b = {}, query = {}, token = TOKEN } = {}) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, set() { return this; }, send(x) { this.body = x; return this; } };
    await w.pi.planRoutineApi({ method, path, query, body: b, get: (h) => (h.toLowerCase() === "authorization" && token ? `Bearer ${token}` : "") }, res);
    return res;
  };
  eq((await call("GET", "/work", { token: "x".repeat(64) })).code, 401, "wrong key refused");
  const work = await call("GET", "/work");
  assert(work.body.items.some(x => x.id === item.id) && work.body.categories.includes("cabinet"), "/work lists the queue + categories");
  const file = await call("GET", "/file", { query: { item: item.id } });
  eq(Buffer.from(file.body).toString(), "%PDF-cabinets-rev2", "/file returns the queued PDF");
  eq((await call("POST", "/decide", { body: { item: item.id, action: "file", kind: "job", number: "1407", category: "invoice" } })).code, 422, "unknown category refused");
  const ok = await call("POST", "/decide", { body: { item: item.id, action: "file", kind: "job", number: "1407", category: "cabinet", rev: "2", date: "2026-10-04", reason: "title block: Tolbert, 1326 S 5360 E" } });
  if (!ok.body.ok) console.log("DECIDE:", ok.code, JSON.stringify(ok.body));
  eq(ok.body.note, "#1407 – Rev 2 – 2026-10-04 – Tolbert Cabinets Rev 2.pdf", "filed with Koy's name");
  const moved = w.files.get(item.inboxFileId);
  const cab = w.files.get(moved.parents[0]), cur = w.files.get(cab.parents[0]);
  eq([cab.name, cur.name, w.files.get(cur.parents[0]).id], ["CABINET PLANS", "MOST UPDATED", w.get("jobs/j1407").data.driveFolderId], "moved into the job's MOST UPDATED / CABINET PLANS");
  eq((await call("POST", "/decide", { body: { item: item.id, action: "file", kind: "job", number: "1407", category: "cabinet" } })).code, 409, "a decided item can't be decided twice");
  const box = q.find(x => x.source === "box link");
  eq((await call("POST", "/decide", { body: { item: box.id, action: "file", kind: "job", number: "1407", category: "plans" } })).code, 422, "a link-only item can't be filed");
  eq((await call("POST", "/decide", { body: { item: box.id, action: "unmatched", bestGuess: "#1407", reason: "Box link — needs a person" } })).body.status, "unmatched", "link-only → unmatched with a best guess");
  assert(w.docs("agentFindings").some(f => f.type === "plans_filed" && /CABINET PLANS/.test(f.summary)), "filing logged");
  assert(w.docs("agentFindings").some(f => f.type === "unmatched_plan" && /best guess #1407/.test(f.summary)), "unmatched logged with the guess");
  eq((await call("POST", "/decide", { body: { item: "dry_x", action: "dismiss" } })).code, 404, "items from another mode are invisible");
  eq(w.driveLog.filter(x => x[0] === "delete").length, 0, "nothing deleted");

  // 11 ── Phase 4: file an unsure plan from the card, the 5 pm email, the walk push
  const att2 = { id: "m5", threadId: "t5", internalDate: String(Date.parse("2026-10-04T19:00:00Z")), bytes: { a: "%PDF-design-book" },
    payload: { headers: hdr("designer@studio.com", "design book"), parts: [pdfPart("Design Book.pdf", "a")] } };
  mail.push(att2);
  w.store.set("planIntakeState/config", { ...w.get("planIntakeState/config"), runLockAt: "" });
  await (w.pi._runOnce());
  const unsure = w.docs("agentQueue").find(x => x.filename === "Design Book.pdf");
  await call("POST", "/decide", { body: { item: unsure.id, action: "unmatched", bestGuess: "#1407", reason: "designer book, no address" } });
  const fnd = w.get(`agentFindings/unmatched_${unsure.id}`);
  eq([fnd.item, fnd.bestGuess, fnd.canFile], [unsure.id, "#1407", true], "unsure finding carries the item + guess for the card");
  await assert.rejects(w.pi.planFileByHand({ item: unsure.id, number: "1407", category: "design", by: "Keegan", pin: "1234" }), /Head of Residential/, "a manager without the hat can't file");
  await assert.rejects(w.pi.planFileByHand({ item: unsure.id, number: "1407", category: "design", by: "Koy", pin: "0000" }), /pin/, "wrong PIN refused");
  const byHand = await (w.pi.planFileByHand({ item: unsure.id, kind: "job", number: "1407", category: "design", by: "Koy", pin: "1234" }));
  eq(byHand.name, "#1407 – 2026-10-04 – Design Book.pdf", "filed from the card with Koy's name format");
  eq(w.files.get(w.files.get(unsure.inboxFileId).parents[0]).name, "DESIGN", "landed in MOST UPDATED / DESIGN");
  eq(w.get(`agentFindings/unmatched_${unsure.id}`).seen, true, "the unsure row clears once filed");
  await assert.rejects(w.pi.planFileByHand({ item: unsure.id, kind: "job", number: "1407", category: "design", by: "Koy", pin: "1234" }), /already/, "can't file twice");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  for (const d of w.docs("agentFindings")) w.store.set(`agentFindings/${d.id}`, { ...w.get(`agentFindings/${d.id}`), day: today });
  await w.pi.planIntakeDigest();
  eq(w.mails.length, 1, "5 pm email sent");
  eq(w.mails[0].to, "koywilkinson@gmail.com", "to Koy's Gmail until the domain is verified");
  assert(/filed/.test(w.mails[0].subject) && /Plan intake/.test(w.mails[0].html), "subject + body built");

  w.store.set("planIntakeState/walk_evToday", { type: "walk", walkDate: today, title: "Brandt Walk", status: "matched", quoteNo: "2299" });
  const before = w.pushes.length;
  await w.pi.planIntakeWalkPush();
  const wp = w.pushes[before];
  eq([wp.name, wp.title, wp.view], ["Koy", "Walk today: Brandt Walk", "today"], "6:30 push to Koy only, opens Today");
  assert(/Quote #2299 folder ready · 2 plans in SIMPRO/.test(wp.body), "push names the quote and how many plans are filed");
}

console.log("planintake-sim: dry / live / idempotent / conflict / import-link / adopt / sign-in-alert / layout / hand-filed / from-here-on / email+routine-api / phase-4 delivery scenarios passed");
})().catch((e) => { console.error(e); process.exit(1); });
