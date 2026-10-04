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

function world({ ccJobs = {}, appQuoteFolder = null } = {}) {
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
    collection: (coll) => ({ doc: (id) => docRef(coll, id), where: (f, op, v) => query(coll, [[f, op, v]]) }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), update: (r, v) => r.update(v), set: (r, v, o) => r.set(v, o) }); },
  };
  for (const [id, data] of Object.entries(ccJobs)) store.set(`jobs/${id}`, { data, updated_at: "x" });

  // ── Drive ──
  const files = new Map();               // id → {id,name,mimeType,parents,md5Checksum}
  let nextId = 1; const driveLog = [];
  files.set(PARENT, { id: PARENT, name: "Job Plans", mimeType: "application/vnd.google-apps.folder", parents: [] });
  if (appQuoteFolder) files.set(appQuoteFolder, { id: appQuoteFolder, name: "Tolbert Residence", mimeType: "application/vnd.google-apps.folder", parents: [PARENT] });
  const drive = { files: {
    async list({ q }) { const pid = q.match(/'([^']+)' in parents/)[1]; return { data: { files: [...files.values()].filter(f => f.parents.includes(pid)) } }; },
    async create({ requestBody }) { const id = `F${nextId++}`; files.set(id, { id, name: requestBody.name, mimeType: requestBody.mimeType, parents: requestBody.parents }); driveLog.push(["create", requestBody.name]); return { data: { id } }; },
    async get({ fileId }) { const f = files.get(fileId); if (!f) throw new Error("404"); return { data: { ...f } }; },
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
    const id = `U${nextId++}`; files.set(id, { id, name, mimeType: "application/pdf", parents: [parentId], md5Checksum: crypto.createHash("md5").update(buffer).digest("hex") });
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
  };
  const pushes = [];
  const HttpsError = class extends Error { constructor(code, msg) { super(msg); this.code = code; } };
  const chain = { runWith: () => chain, pubsub: { schedule: () => ({ timeZone: () => ({ onRun: (fn) => fn }) }) }, https: { onCall: (fn) => fn, HttpsError }, logger: { info() {}, warn() {}, error() {} } };
  const pi = makePlanIntake({
    functions: chain, db, google, TZ: "America/Denver", FieldValue: { arrayUnion: (v) => ({ __arrayUnion: true, v }) },
    simproReqWithRetry: simpro, driveFullClient: () => ({ drive, auth: {} }), driveUploadResumable: upload, planDocPull,
    jobFolderName: (j) => (j.simproNo ? `#${j.simproNo} - ${j.name}` : j.name), JOBS_PARENT_FOLDER_ID: PARENT,
    requireAppKey: (d) => { if (!d || d._appKey !== "k") throw new HttpsError("permission-denied", "key"); },
    sendToName: async (name, n) => { pushes.push({ name, ...n }); },
  });
  const setMode = (mode, extra = {}) => store.set("planIntakeState/config", { ...(get("planIntakeState/config") || {}), mode, ...extra });
  const docs = (coll) => [...store.keys()].filter(k => k.startsWith(`${coll}/`)).map(k => ({ id: k.slice(coll.length + 1), ...get(k) }));
  return { pi, store, get, writes, files, driveLog, setMode, docs, pushes, simproCalls: () => simproCalls };
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

console.log("planintake-sim: dry / live / idempotent / conflict / import-link / adopt / sign-in-alert scenarios passed");
})().catch((e) => { console.error(e); process.exit(1); });
