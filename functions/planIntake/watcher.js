// planIntake/watcher.js — PLAN_INTAKE_SPEC.md Phase 1 (2026-10-03).
// Calendar walk → Simpro quote → Drive folder → rename on conversion → file
// new Simpro attachments. Rule-based only; anything needing judgment goes to
// agentQueue for the Routine. index.js passes in its existing helpers (Simpro
// retry wrapper, the v413 Drive helpers, the docPull planner, the CC folder
// namer) so nothing already deployed is edited.
//
// DATA SAFETY (spec ground rules):
//  - Drive: create folders, upload files, rename, move. Never delete/trash/overwrite.
//  - Simpro + Calendar: read-only.
//  - Firestore: writes planIntakeState / agentQueue / agentFindings, plus ONE
//    job field — data.driveFolderId — and only inside a transaction that
//    re-reads it empty (dotted path, ISO updated_at, same as createJobDriveFolder).
//  - Mode on planIntakeState/config: "dry" (default — findings only, no Drive
//    or job writes), "test" (Drive writes under config.testParentId, no job
//    writes), "live". dry/test state lives under a "<mode>_" doc-id prefix so
//    flipping modes never inherits a rehearsal's "done" markers.
"use strict";
const crypto = require("crypto");
const W = require("./walks.js");
const { cleanName } = require("../docPull.js");
const MAIL = require("./mail.js");

const STATE = "planIntakeState", QUEUE = "agentQueue", FINDINGS = "agentFindings";
const QUOTES_FOLDER = "_Quotes";
// Koy's job-folder layout (2026-10-03): SIMPRO = an exact mirror of Simpro's
// attachment folders (plans, take-offs, vendor quotes); MOST UPDATED = the
// current set, in standard category folders; ARCHIVE = superseded plans. The
// watcher only ever files into SIMPRO — what is "current" and what gets
// archived is judgment, so MOST UPDATED / ARCHIVE are filled by people and the
// Routine (Phases 2–3). Folders that already have their own MOST UPDATED /
// ARCHIVE (any spelling) are left alone.
const SIMPRO_DIR = "SIMPRO", CURRENT_DIR = "MOST UPDATED", ARCHIVE_DIR = "ARCHIVE";
const CURRENT_CATEGORIES = ["DESIGN", "CABINET PLANS", "APPLIANCE SPECS", "SPECS", "REDLINES"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_CALENDAR = "koy@homesteadelectric.net";
const RUN_BUDGET_MS = 470 * 1000;           // function ceiling is 540 s
const RETRY_MS = 6 * 3600 * 1000;           // a walk with no quote yet is re-checked every 6 h
const FILES_CHECK_MS = 2 * 3600 * 1000;     // each tracked folder re-checks Simpro every 2 h
const TRACK_DAYS = 180;                     // stop watching a quote/job's attachments after this
const LOCK_MS = 10 * 60 * 1000;
// Workspace won't share Koy's calendar details with an outside service account
// (only free/busy — checked 2026-10-03), so the watcher reads it as Koy: a
// read-only Calendar sign-in made once with scripts/plan-intake-google-auth.js,
// stored as JSON {client_id, client_secret, refresh_token} in this secret.
const OAUTH_SECRET = "PLAN_INTAKE_GOOGLE_OAUTH";

const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
const simproJobUrl = (n) => `https://homesteadelectric.simprosuite.com/staff/editProject.php?jobID=${n}`;
// Job Info's link box can hold a pasted URL (App.js extractDriveFolderId).
function folderIdOf(v) {
  const s = String(v || "").trim();
  const m = s.match(/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : "";
}

module.exports = function makePlanIntake(deps) {
  const { functions, db, google, TZ, simproReqWithRetry, driveFullClient, driveUploadResumable,
    planDocPull, jobFolderName, JOBS_PARENT_FOLDER_ID, requireAppKey, sendToName, sendGcMail, requireAdmin, gcAccessOf } = deps;
  const log = functions.logger;
  const nowIso = () => new Date().toISOString();
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });   // YYYY-MM-DD, Denver
  const prefixOf = (mode) => (mode === "live" ? "" : `${mode}_`);
  const arrayUnion = (v) => deps.FieldValue.arrayUnion(v);

  // ── Firestore helpers ───────────────────────────────────────────────────
  async function loadConfig() {
    const snap = await db.collection(STATE).doc("config").get();
    const c = snap.exists ? snap.data() : {};
    const mode = ["dry", "test", "live"].includes(c.mode) ? c.mode : "dry";
    return { ...c, mode, calendarId: c.calendarId || DEFAULT_CALENDAR };
  }
  // Findings are write-once (create): a retry never resets `seen` or duplicates a row.
  async function finding(mode, id, f) {
    const doc = {
      number: String(f.number || ""), type: f.type, summary: f.summary, links: f.links || [],
      createdAt: nowIso(), day: today(), seen: false, mode, source: "planIntakeWatcher", ...(f.extra || {}),
    };
    try { await db.collection(FINDINGS).doc(`${prefixOf(mode)}${id}`).create(doc); }
    catch (e) { if (e.code !== 6) log.warn("planIntake: finding write failed", { id, error: e.message }); }
  }
  async function enqueue(mode, id, item) {
    try { await db.collection(QUEUE).doc(`${prefixOf(mode)}${id}`).create({ ...item, status: "open", mode, createdAt: nowIso() }); }
    catch (e) { if (e.code !== 6) log.warn("planIntake: queue write failed", { id, error: e.message }); }
  }
  // App records by Simpro number. simproNo is a string in practice; accept a number too.
  async function ccJobsBy(field, value) {
    const v = String(value || "").trim();
    if (!v) return [];
    const vals = /^\d+$/.test(v) ? [v, Number(v)] : [v];
    try {
      const snap = await db.collection("jobs").where(`data.${field}`, "in", vals).limit(10).get();
      return snap.docs.map(d => ({ id: d.id, ref: d.ref, ...(d.data().data || {}) }))
        // Pre-v365 quote records can carry their QUOTE # in simproNo — never
        // treat one of those as the job a folder belongs to.
        .filter(j => !j.deleted && !j.archived && !(field === "simproNo" && j.type === "quote"));
    } catch (e) { log.warn("planIntake: jobs lookup failed", { field, value: v, error: e.message }); return []; }
  }
  // The ONLY job write: link a folder when the job still has none. The
  // transaction re-reads, so a folder someone linked a second ago is never replaced.
  async function stampFolder(jobRef, folderId) {
    return db.runTransaction(async (tx) => {
      const s = await tx.get(jobRef);
      if (!s.exists) return { ok: false, why: "job gone" };
      // ANY non-empty value counts as taken — the Link Folder box can hold a
      // pasted string that isn't ID-shaped, and that is still someone's choice.
      const raw = String((s.data().data || {}).driveFolderId || "").trim();
      const cur = folderIdOf(raw) || raw;
      if (raw) return { ok: cur === folderId, why: cur === folderId ? "already linked" : "has another folder", current: cur };
      tx.update(jobRef, { "data.driveFolderId": folderId, updated_at: nowIso() });   // ISO string — rules require it
      return { ok: true, why: "linked" };
    });
  }

  // ── Simpro ──────────────────────────────────────────────────────────────
  async function sget(path) {
    const r = await simproReqWithRetry("GET", path);
    if (!r.ok) throw new Error(`Simpro ${r.status} ${path.split("?")[0]}`);
    return r.data;
  }
  // ── Residential only (Koy, 2026-10-04: "this is residential only") ────────
  // Simpro's "Business Group" custom field (jobs AND quotes; one call each,
  // cached) decides. Commercial / Multi Family per config/app (same setting the
  // app's commercial mode reads). Unset = residential.
  const groupCache = new Map();
  async function businessGroup(kind, no) {
    const key = `${kind}_${no}`;
    if (groupCache.has(key)) return groupCache.get(key);
    const rows = await sget(`/${kind === "quote" ? "quotes" : "jobs"}/${encodeURIComponent(no)}/customFields/`).catch(() => []);
    const bg = (Array.isArray(rows) ? rows : []).find(x => x && x.CustomField && /^business\s*group$/i.test(String(x.CustomField.Name || "").trim()));
    const v = bg && bg.Value != null ? String(bg.Value).trim() : "";
    groupCache.set(key, v);
    return v;
  }
  async function isCommercial(kind, no, ccJob) {
    if (ccJob && ccJob.division === "commercial") return true;
    const g = (await businessGroup(kind, no)).toLowerCase();
    const list = deps.commercialGroups ? await deps.commercialGroups() : ["commercial", "multi family"];
    return !!g && list.includes(g);
  }
  const notResi = (what) => Object.assign(new Error(`${what} is commercial — plan intake is residential only`), { code: 422 });

  async function siteFacts(addr, cache) {
    const key = `${addr.number} ${addr.tokens.join(" ")}`;
    if (cache.has(key)) return cache.get(key);
    const sites = await sget(`/sites/?Address.Address=${encodeURIComponent(`%${addr.number}%`)}&columns=ID,Name,Address&pageSize=50`);
    const hits = (Array.isArray(sites) ? sites : []).filter(s => W.sameAddress(addr, W.extractAddress(s.Address && s.Address.Address)));
    const quotes = [], jobs = [];
    for (const s of hits) {
      quotes.push(...await sget(`/quotes/?Site.ID=${s.ID}&columns=ID,Name,Stage,DateIssued,IsClosed,JobNo,LinkedJobID&pageSize=100`));
      jobs.push(...await sget(`/jobs/?Site.ID=${s.ID}&columns=ID,Name,Stage,DateIssued,ConvertedFrom&pageSize=100`));
    }
    const facts = { sites: hits, quotes, jobs };
    cache.set(key, facts);
    return facts;
  }

  // ── Drive ───────────────────────────────────────────────────────────────
  async function listChildren(drive, folderId) {
    const out = []; let pageToken;
    do {
      const r = await drive.files.list({ q: `'${folderId}' in parents and trashed=false`, pageToken, pageSize: 1000,
        fields: "nextPageToken,files(id,name,mimeType,md5Checksum)", supportsAllDrives: true, includeItemsFromAllDrives: true });
      out.push(...(r.data.files || [])); pageToken = r.data.nextPageToken;
    } while (pageToken);
    return out;
  }
  async function findOrMakeFolder(drive, parentId, name, { create }) {
    const hit = (await listChildren(drive, parentId)).find(f => f.mimeType === FOLDER_MIME && String(f.name).trim() === name);
    if (hit) return { id: hit.id, made: false };
    if (!create) return { id: "", made: false };
    const r = await drive.files.create({ requestBody: { name, parents: [parentId], mimeType: FOLDER_MIME }, fields: "id", supportsAllDrives: true });
    return { id: r.data.id, made: true };
  }
  function homeParent(cfg) { return cfg.mode === "test" ? String(cfg.testParentId || "") : JOBS_PARENT_FOLDER_ID; }
  // Rename to the CC job name and, if it is still under _Quotes, move it up to
  // the jobs parent. Same folder ID throughout — every saved link keeps working.
  async function promoteFolder(drive, folderId, newName, homeId) {
    const f = await drive.files.get({ fileId: folderId, fields: "id,name,parents", supportsAllDrives: true });
    const parents = f.data.parents || [];
    const req = { fileId: folderId, requestBody: { name: newName }, fields: "id,name,parents", supportsAllDrives: true };
    const quotesParent = [];
    for (const p of parents) {
      if (p === homeId) continue;
      const pf = await drive.files.get({ fileId: p, fields: "id,name", supportsAllDrives: true });
      if (String(pf.data.name).trim() === QUOTES_FOLDER) quotesParent.push(p);
    }
    if (quotesParent.length) { req.addParents = homeId; req.removeParents = quotesParent.join(","); }
    const r = await drive.files.update(req);
    return { name: r.data.name, moved: quotesParent.length > 0, oldName: f.data.name };
  }

  // Make SIMPRO / MOST UPDATED (+ categories) / ARCHIVE where missing. Additive
  // only; an existing "Most Updated Plans" or "Archive" counts as present.
  async function ensureSkeleton(drive, folderId, { create }) {
    const top = (await listChildren(drive, folderId)).filter(f => f.mimeType === FOLDER_MIME);
    const find = (re) => top.find(f => re.test(String(f.name || "")));
    let simpro = find(/^\s*simpro\s*$/i);
    if (!create) return { simproId: simpro ? simpro.id : "" };
    if (!simpro) simpro = { id: (await findOrMakeFolder(drive, folderId, SIMPRO_DIR, { create })).id };
    if (!find(/most\s*updated/i)) {
      const cur = await findOrMakeFolder(drive, folderId, CURRENT_DIR, { create });
      for (const c of CURRENT_CATEGORIES) await findOrMakeFolder(drive, cur.id, c, { create });
    }
    if (!find(/archive/i)) await findOrMakeFolder(drive, folderId, ARCHIVE_DIR, { create });
    return { simproId: simpro.id };
  }
  // Every md5 anywhere in the job folder (MOST UPDATED, ARCHIVE, old root
  // Plans/ from the v413 pull…) — a file people already filed is never re-copied.
  async function treeMd5s(drive, folderId, depth = 0, out = new Set()) {
    if (depth > 4) return out;
    for (const it of await listChildren(drive, folderId)) {
      if (it.mimeType === FOLDER_MIME) await treeMd5s(drive, it.id, depth + 1, out);
      else if (it.md5Checksum) out.add(it.md5Checksum);
    }
    return out;
  }

  // ── Attachments: Simpro quote/job → its Drive folder ────────────────────
  // Same planner as the v413 pull (filename dedupe within a folder, same
  // subfolder names), plus an MD5 check against what Drive already holds and
  // a ledger of Simpro file IDs so nothing is downloaded twice.
  async function fileSource(ctx, kind, no, folderId, ledger) {
    const { cfg, drive, auth, deadline } = ctx;
    const base = kind === "quote" ? `/quotes/${encodeURIComponent(no)}` : `/jobs/${encodeURIComponent(no)}`;
    const files = await sget(`${base}/attachments/files/`);
    const fresh = (Array.isArray(files) ? files : []).filter(f => !ledger[`${kind}_${f.ID}`]);
    if (!fresh.length) return { copied: [], present: 0, would: 0 };
    const folders = await sget(`${base}/attachments/folders/`);
    const details = [];
    for (const f of fresh) {
      const d = await sget(`${base}/attachments/files/${f.ID}`).catch(() => null);
      details.push(d ? { id: d.ID, name: String(d.Filename || ""), bytes: Number(d.FileSizeBytes) || 0, mime: String(d.MimeType || ""),
        folder: d.Folder && d.Folder.Name ? String(d.Folder.Name) : "" } : { id: f.ID, name: String(f.Filename || ""), bytes: 0, mime: "", folder: "" });
    }
    // Files land in <job folder>/SIMPRO/<Simpro's folder>; dedupe by name
    // inside SIMPRO (same planner as the v413 pull) and by md5 across the tree.
    const driveFolders = {}, driveFiles = [];
    let md5s = new Set();
    const { simproId } = folderId ? await ensureSkeleton(drive, folderId, { create: cfg.mode !== "dry" }) : { simproId: "" };
    if (simproId) {
      for (const it of await listChildren(drive, simproId)) {
        if (it.mimeType === FOLDER_MIME) driveFolders[String(it.name || "").trim()] = it.id;
        else driveFiles.push({ name: it.name, folderName: "" });
      }
      for (const [name, id] of Object.entries(driveFolders)) {
        for (const it of await listChildren(drive, id)) if (it.mimeType !== FOLDER_MIME) driveFiles.push({ name: it.name, folderName: name });
      }
    }
    if (folderId) md5s = await treeMd5s(drive, folderId);
    const plan = planDocPull({ files: details, folders: (Array.isArray(folders) ? folders : []).map(f => String(f.Name || "")), driveFolders, driveFiles });
    // Mark what the planner skipped so it is never fetched again (same cleanName as the planner).
    const copyIds = new Set(plan.copies.map(c => String(c.id)));
    for (const s of plan.skipped) {
      for (const d of details) {
        if (copyIds.has(String(d.id)) || cleanName(d.name) !== cleanName(s.name) || cleanName(d.folder) !== cleanName(s.folderName)) continue;
        ledger[`${kind}_${d.id}`] = { status: s.reason === "already in Drive" ? "present" : "skipped", name: s.name, at: nowIso() };
      }
    }
    if (cfg.mode === "dry" || !folderId || !simproId) return { copied: [], present: plan.skipped.length, would: plan.copies.length, wouldBytes: plan.totalBytes, wouldNames: plan.copies.map(c => c.name) };
    for (const name of plan.makeFolders) {
      const r = await drive.files.create({ requestBody: { name, parents: [simproId], mimeType: FOLDER_MIME }, fields: "id", supportsAllDrives: true });
      driveFolders[name] = r.data.id;
    }
    const copied = [];
    let incomplete = false;
    for (const c of plan.copies) {
      if (deadline() < 60 * 1000) { incomplete = true; break; }   // the rest go next run (the ledger knows what's done)
      try {
        const r = await simproReqWithRetry("GET", `${base}/attachments/files/${c.id}?display=Base64`, null, { maxAttempts: 3 });
        if (!r.ok || !r.data || !r.data.Base64Data) throw new Error(`Simpro download ${r.status}`);
        const buffer = Buffer.from(r.data.Base64Data, "base64");
        const md5 = crypto.createHash("md5").update(buffer).digest("hex");
        if (md5s.has(md5)) { ledger[`${kind}_${c.id}`] = { status: "present", name: c.name, md5, at: nowIso() }; continue; }
        const parentId = c.folderName ? driveFolders[c.folderName] : simproId;
        const driveId = await driveUploadResumable(auth, { name: c.name, mime: c.mime, parentId, buffer });
        md5s.add(md5);
        ledger[`${kind}_${c.id}`] = { status: "copied", name: c.name, folder: c.folderName, md5, driveId, at: nowIso() };
        await md5Mark(cfg.mode, md5, { fileId: driveId, where: `simpro ${kind} ${no}`, name: c.name }).catch(() => {});   // so an emailed copy is known
        copied.push(`${SIMPRO_DIR}/${c.folderName ? `${c.folderName}/` : ""}${c.name}`);
      } catch (e) {
        log.warn("planIntake: file copy failed", { kind, no, file: c.name, error: e.message });   // no ledger mark → retried next run
      }
    }
    return { copied, present: plan.skipped.length, would: 0, incomplete };
  }

  // ── Quote folder ────────────────────────────────────────────────────────
  async function ensureQuoteFolder(ctx, quoteNo, why) {
    const { cfg, drive } = ctx;
    const p = prefixOf(cfg.mode);
    const ref = db.collection(STATE).doc(`${p}quote_${quoteNo}`);
    const snap = await ref.get();
    if (snap.exists && (snap.data().folderId || cfg.mode === "dry")) {
      if (why.eventId) await ref.update({ walkEventIds: arrayUnion(why.eventId) }).catch(() => {});
      return snap.data();
    }
    // 1. An app quote record for this Simpro quote that already has a folder → adopt it.
    // (Never in test mode — a rehearsal must not rename a real folder later.)
    const appQuotes = cfg.mode === "test" ? [] : (await ccJobsBy("simproQuoteNo", quoteNo)).filter(j => folderIdOf(j.driveFolderId));
    let folderId = "", folderName = "", adoptedFrom = "", inQuotes = false, made = false;
    if (appQuotes.length === 1) {
      folderId = folderIdOf(appQuotes[0].driveFolderId); adoptedFrom = appQuotes[0].id;
      try { folderName = (await drive.files.get({ fileId: folderId, fields: "name", supportsAllDrives: true })).data.name || ""; } catch (_) { /* name is cosmetic */ }
    } else {
      // 2. Our own folder: <jobs parent>/_Quotes/Quote #N (found again if a run died mid-way).
      const home = homeParent(cfg);
      const create = cfg.mode !== "dry";
      const qf = await findOrMakeFolder(drive, home, QUOTES_FOLDER, { create });
      const name = `Quote #${quoteNo}`;
      if (qf.id) {
        const f = await findOrMakeFolder(drive, qf.id, name, { create });
        folderId = f.id; made = f.made;
        if (folderId && create) await ensureSkeleton(drive, folderId, { create });
      }
      folderName = name; inQuotes = true;
    }
    const st = {
      type: "quote", mode: cfg.mode, quoteNo: String(quoteNo), quoteName: why.quoteName || "", siteName: why.siteName || "",
      folderId, folderName, inQuotesFolder: inQuotes, adoptedFromJobId: adoptedFrom, source: why.source || "walk",
      walkEventIds: why.eventId ? [why.eventId] : [], tracking: true, jobNo: "", ledger: {}, createdAt: nowIso(), updatedAt: nowIso(),
    };
    await ref.set(st, { merge: true });
    const verb = cfg.mode === "dry" ? "Would create" : adoptedFrom ? "Using the app's folder for" : made ? "Created" : "Found";
    await finding(cfg.mode, `folder_${quoteNo}`, {
      number: `Q${quoteNo}`, type: adoptedFrom ? "folder_adopted" : "folder_created",
      summary: `${verb} ${adoptedFrom ? `Quote #${quoteNo} (${folderName})` : `folder "Quote #${quoteNo}"`}${why.quoteName ? ` — ${why.quoteName}` : ""}${why.walkTitle ? ` · walk: ${why.walkTitle} (${why.walkDate})` : ""}`,
      links: folderId ? [{ label: "Folder", url: folderUrl(folderId) }] : [],
    });
    return st;
  }

  // ── Step A: calendar walks ──────────────────────────────────────────────
  function calendarAuth() {
    const raw = process.env[OAUTH_SECRET];
    if (!raw) throw new Error(`calendar sign-in missing — run scripts/plan-intake-google-auth.js (secret ${OAUTH_SECRET})`);
    let o;
    try { o = JSON.parse(raw); } catch (_) { throw new Error(`secret ${OAUTH_SECRET} is not valid JSON`); }
    if (!o.client_id || !o.client_secret || !o.refresh_token) throw new Error(`secret ${OAUTH_SECRET} is missing a field`);
    const auth = new google.auth.OAuth2(o.client_id, o.client_secret);
    auth.setCredentials({ refresh_token: o.refresh_token });
    return auth;
  }
  async function processWalks(ctx, counts) {
    const { cfg } = ctx;
    const p = prefixOf(cfg.mode);
    const cal = google.calendar({ version: "v3", auth: calendarAuth() });
    // config.lookbackDays (1–200) lets a test run replay older walks; default = the 14-day lookahead + 1.
    const lookback = Math.min(200, Math.max(1, Number(cfg.lookbackDays) || W.LOOKAHEAD_DAYS + 1));
    const timeMin = new Date(Date.now() - lookback * 86400e3).toISOString();
    const timeMax = new Date(Date.now() + 90 * 86400e3).toISOString();
    const events = []; let pageToken;
    do {
      const r = await cal.events.list({ calendarId: cfg.calendarId, timeMin, timeMax, singleEvents: true, maxResults: 250, pageToken });
      events.push(...(r.data.items || [])); pageToken = r.data.nextPageToken;
    } while (pageToken);
    counts.events = events.length;
    const cache = new Map();
    for (const ev of events) {
      if (ctx.deadline() < 120 * 1000) { counts.deferred = (counts.deferred || 0) + 1; continue; }
      const c = W.classifyEvent(ev);
      if (c.kind === "skip") continue;
      // config.walksSince: walks dated before it are never acted on (Koy, going
      // live 2026-10-04: "i dont need a rollback, just from here on").
      const startIso = String((ev.start && (ev.start.dateTime || ev.start.date)) || "");
      if (cfg.walksSince && startIso && new Date(startIso).getTime() < Date.parse(cfg.walksSince)) continue;
      const ref = db.collection(STATE).doc(`${p}walk_${ev.id}`);
      const prev = (await ref.get()).data();
      if (prev && ["matched", "existing_job", "queued", "commercial"].includes(prev.status)) continue;
      if (prev && prev.status === "pending" && Date.now() - Date.parse(prev.lastTriedAt || 0) < RETRY_MS) continue;
      const walkDate = String((ev.start && (ev.start.dateTime || ev.start.date)) || "").slice(0, 10);
      const base = {
        type: "walk", mode: cfg.mode, eventId: ev.id, title: String(ev.summary || "").trim(), walkDate,
        creator: String((ev.creator && ev.creator.email) || ""), location: String(ev.location || ""),
        kind: c.kind, reason: c.reason, address: c.address ? c.address.raw : "", htmlLink: ev.htmlLink || "",
        firstSeenAt: (prev && prev.firstSeenAt) || nowIso(), lastTriedAt: nowIso(), attempts: ((prev && prev.attempts) || 0) + 1,
      };
      const calLink = ev.htmlLink ? [{ label: "Calendar", url: ev.htmlLink }] : [];
      const queueIt = async (why, candidates = []) => {
        await enqueue(cfg.mode, `walk_unmatched_${ev.id}`, {
          type: "walk_unmatched", eventId: ev.id, title: base.title, walkDate, creator: base.creator, location: base.location,
          address: base.address, classification: c.kind, reason: why, candidates, htmlLink: base.htmlLink });
        await finding(cfg.mode, `walk_unmatched_${ev.id}`, { number: "", type: "walk_unmatched",
          summary: `Walk not matched: ${base.title} (${walkDate}) — ${why}${candidates.length ? ` · quotes ${candidates.join(", ")}` : ""}`, links: calLink });
        await ref.set({ ...base, status: "queued", queueReason: why }, { merge: true });
        counts.queued++;
      };
      try {
        if (c.kind === "maybe" || !c.address) { await queueIt(c.kind === "maybe" ? "maybe a walk; no address" : "no address"); continue; }
        const facts = await siteFacts(c.address, cache);
        // Past the lookahead (walk date + 14 d) with still no quote → hand it to the Routine.
        const pastWindow = !!walkDate && new Date(`${walkDate}T12:00:00Z`).getTime() + W.LOOKAHEAD_DAYS * 86400e3 < Date.now();
        const pendOrQueue = async (why) => {
          if (pastWindow) return queueIt(why);
          await ref.set({ ...base, status: "pending", pendingReason: why }, { merge: true });
          counts.pending++;
        };
        if (!facts.sites.length) { await pendOrQueue(`no Simpro site at ${c.address.raw}`); continue; }
        const pick = W.pickQuote({ walkDate, quotes: facts.quotes, jobs: facts.jobs, now: today() });
        if ((pick.result === "quote" && await isCommercial("quote", pick.quoteId)) || (pick.result === "existing_job" && await isCommercial("job", pick.jobId))) {
          // Residential only: a commercial walk gets no folder and no card row.
          await ref.set({ ...base, status: "commercial", quoteNo: String(pick.quoteId || ""), jobNo: String(pick.jobId || "") }, { merge: true });
          counts.commercial = (counts.commercial || 0) + 1;
          continue;
        }
        if (pick.result === "quote") {
          const q = facts.quotes.find(x => x.ID === pick.quoteId) || {};
          const site = facts.sites[0] || {};
          await ensureQuoteFolder(ctx, pick.quoteId, { eventId: ev.id, quoteName: q.Name || "", siteName: site.Name || "", walkTitle: base.title, walkDate, source: "walk" });
          await ref.set({ ...base, status: "matched", quoteNo: String(pick.quoteId) }, { merge: true });
          counts.matched++;
        } else if (pick.result === "existing_job") {
          await ref.set({ ...base, status: "existing_job", jobNo: String(pick.jobId), openQuoteIds: pick.openQuoteIds || [] }, { merge: true });
          await finding(cfg.mode, `walk_job_${ev.id}`, { number: String(pick.jobId), type: "walk_existing_job",
            summary: `Walk on existing job #${pick.jobId}: ${base.title} (${walkDate})${(pick.openQuoteIds || []).length ? ` · open quotes ${pick.openQuoteIds.join(", ")}` : ""}`,
            links: [{ label: "Simpro", url: simproJobUrl(pick.jobId) }, ...calLink] });
          counts.existingJob++;
        } else if (pick.result === "ambiguous") {
          await queueIt("more than one open quote at this address", pick.quoteIds);
        } else {
          await pendOrQueue("no open quote at this address yet");
        }
      } catch (e) {
        counts.errors.push(`walk ${base.title}: ${e.message}`.slice(0, 200));
        log.warn("planIntake: walk failed", { eventId: ev.id, error: e.message });
      }
    }
  }

  // ── Step B: conversions ─────────────────────────────────────────────────
  async function convertQuote(ctx, ref, st, job) {
    const { cfg, drive } = ctx;
    const jobNo = String(job.ID);
    const cc = await ccJobsBy("simproNo", jobNo);
    const ccOne = cc.length === 1 ? cc[0] : null;
    const name = (ccOne && ccOne.name) || (job.Site && job.Site.Name) || job.Name || "";
    const newName = jobFolderName({ name, simproNo: jobNo }) || `#${jobNo}`;
    let renamed = null, stamp = null;
    if (cfg.mode !== "dry" && st.folderId) {
      renamed = await promoteFolder(drive, st.folderId, newName, homeParent(cfg));
      if (cfg.mode === "live" && ccOne) stamp = await stampFolder(ccOne.ref, st.folderId);
    }
    await ref.update({ jobNo, convertedAt: String((job.ConvertedFrom && job.ConvertedFrom.Date) || nowIso()), renamedTo: newName,
      renamedAt: renamed ? nowIso() : "", inQuotesFolder: renamed ? false : st.inQuotesFolder, linkedCcJobId: stamp && stamp.ok ? ccOne.id : (st.linkedCcJobId || ""), updatedAt: nowIso() });
    const links = st.folderId ? [{ label: "Folder", url: folderUrl(st.folderId) }, { label: "Simpro", url: simproJobUrl(jobNo) }] : [{ label: "Simpro", url: simproJobUrl(jobNo) }];
    const verb = cfg.mode === "dry" ? "Would rename" : "Renamed";
    let tail = "";
    if (cfg.mode === "live") {
      if (!cc.length) tail = " · not in the app yet — linked when it's imported";
      else if (cc.length > 1) tail = ` · ${cc.length} app jobs carry Simpro #${jobNo} — link by hand`;
      else if (stamp && stamp.why === "linked") tail = " · linked to the app job";
      else if (stamp && stamp.why === "has another folder") tail = " · the app job already had a different folder — both kept, check which is right";
    }
    await finding(cfg.mode, `converted_${st.quoteNo}`, { number: jobNo, type: "folder_renamed",
      summary: `${verb} Quote #${st.quoteNo} → "${newName}" (converted to job #${jobNo})${tail}`, links });
    if (stamp && stamp.why === "has another folder") {
      await finding(cfg.mode, `conflict_${jobNo}`, { number: jobNo, type: "folder_conflict",
        summary: `Job #${jobNo} has two folders: the app's and Quote #${st.quoteNo}'s. Nothing was moved or deleted.`,
        links: [{ label: "Quote folder", url: folderUrl(st.folderId) }, { label: "App folder", url: folderUrl(stamp.current) }] });
    }
  }
  async function processConversions(ctx, tracked, counts) {
    for (const { ref, st } of tracked) {
      if (st.jobNo || ctx.deadline() < 90 * 1000) continue;
      try {
        const q = await sget(`/quotes/${encodeURIComponent(st.quoteNo)}?columns=ID,Name,Stage,IsClosed,JobNo`);
        if (q.JobNo) {
          const job = await sget(`/jobs/${encodeURIComponent(q.JobNo)}?columns=ID,Name,Site,Stage,ConvertedFrom`);
          if (job.ConvertedFrom && String(job.ConvertedFrom.ID) === String(st.quoteNo)) { await convertQuote(ctx, ref, st, job); counts.converted++; }
          else {
            // Folded into an existing job as a change order — leave the folder where it is.
            await ref.update({ tracking: false, mergedIntoJob: String(q.JobNo), updatedAt: nowIso() });
            await finding(ctx.cfg.mode, `merged_${st.quoteNo}`, { number: String(q.JobNo), type: "quote_merged",
              summary: `Quote #${st.quoteNo} became part of existing job #${q.JobNo} — folder left as "${st.folderName}"`,
              links: st.folderId ? [{ label: "Folder", url: folderUrl(st.folderId) }] : [] });
          }
        } else if (q.Stage === "Archived" || q.IsClosed) {
          await ref.update({ tracking: false, closedAt: nowIso(), updatedAt: nowIso() });
          await finding(ctx.cfg.mode, `closed_${st.quoteNo}`, { number: `Q${st.quoteNo}`, type: "quote_closed",
            summary: `Quote #${st.quoteNo} closed without becoming a job — folder left in ${QUOTES_FOLDER}`,
            links: st.folderId ? [{ label: "Folder", url: folderUrl(st.folderId) }] : [] });
        }
      } catch (e) {
        counts.errors.push(`quote ${st.quoteNo}: ${e.message}`.slice(0, 200));
      }
    }
  }

  // ── Step C: new attachments on tracked quotes + the jobs they became ────
  async function processFiles(ctx, tracked, counts) {
    const due = tracked
      .filter(t => t.st.tracking && (t.st.folderId || ctx.cfg.mode === "dry") && Date.now() - Date.parse(t.st.lastFilesCheckAt || 0) >= FILES_CHECK_MS)
      .sort((a, b) => String(a.st.lastFilesCheckAt || "").localeCompare(String(b.st.lastFilesCheckAt || "")));
    for (const { ref, st } of due) {
      if (ctx.deadline() < 90 * 1000) break;
      const ledger = { ...(st.ledger || {}) };
      const sources = [["quote", st.quoteNo]];
      if (st.jobNo && !st.mergedIntoJob) sources.push(["job", st.jobNo]);
      const filed = [], would = [];
      let wouldBytes = 0, incomplete = false;
      try {
        for (const [kind, no] of sources) {
          const r = await fileSource(ctx, kind, no, st.folderId, ledger);
          filed.push(...r.copied); if (r.incomplete) incomplete = true; if (r.would) { would.push(...(r.wouldNames || [])); wouldBytes += r.wouldBytes || 0; }
        }
      } catch (e) { counts.errors.push(`files ${st.quoteNo}: ${e.message}`.slice(0, 200)); }
      const old = Date.now() - Date.parse(st.createdAt || 0) > TRACK_DAYS * 86400e3;
      // A run cut short by the time budget leaves lastFilesCheckAt alone, so the
      // next run (30 min) carries on instead of waiting the full 2 h.
      await ref.update({ ledger, ...(incomplete ? {} : { lastFilesCheckAt: nowIso() }), updatedAt: nowIso(), ...(old ? { tracking: false } : {}) });
      const number = st.jobNo || `Q${st.quoteNo}`;
      const links = st.folderId ? [{ label: "Folder", url: folderUrl(st.folderId) }] : [];
      if (filed.length) {
        counts.filed += filed.length;
        await finding(ctx.cfg.mode, `filed_${st.quoteNo}_${Date.now()}`, { number, type: "plans_filed",
          summary: `${filed.length} file${filed.length === 1 ? "" : "s"} filed into ${st.renamedTo || st.folderName}: ${filed.slice(0, 4).join(", ")}${filed.length > 4 ? ` +${filed.length - 4} more` : ""}`, links });
      }
      if (would.length) {
        await finding(ctx.cfg.mode, `wouldfile_${st.quoteNo}`, { number, type: "plans_filed",
          summary: `Would copy ${would.length} file${would.length === 1 ? "" : "s"} (${(wouldBytes / 1048576).toFixed(1)} MB) from Simpro: ${would.slice(0, 4).join(", ")}${would.length > 4 ? ` +${would.length - 4} more` : ""}`, links });
      }
    }
  }

  // ══ Phase 2 — email intake (PLAN_INTAKE_SPEC.md, Koy 2026-10-04) ═══════════
  // Koy's mailbox only, read-only, from config.mailSince on. Rule skips drop the
  // automated mail; every other PDF (attachment, or a Drive / Dropbox link) is
  // copied to <jobs parent>/_Plan Inbox and queued as `email_pdf` for the Routine.
  // Box links can't be fetched without Box's API → queued as a link to look at.
  const INBOX_FOLDER = "_Plan Inbox";
  const MAX_FETCH_BYTES = 150 * 1024 * 1024;
  const gmailLink = (threadId) => `https://mail.google.com/mail/?authuser=koy%40homesteadelectric.net#all/${threadId}`;
  const md5Of = (buf) => crypto.createHash("md5").update(buf).digest("hex");
  async function md5Seen(mode, md5) { return (await db.collection(STATE).doc(`${prefixOf(mode)}md5_${md5}`).get()).data() || null; }
  async function md5Mark(mode, md5, where) { await db.collection(STATE).doc(`${prefixOf(mode)}md5_${md5}`).set({ type: "md5", mode, ...where, at: nowIso() }, { merge: true }); }
  async function inboxId(ctx) {
    if (ctx.inboxId) return ctx.inboxId;
    const f = await findOrMakeFolder(ctx.drive, homeParent(ctx.cfg), INBOX_FOLDER, { create: ctx.cfg.mode !== "dry" });
    ctx.inboxId = f.id; return f.id;
  }
  async function senderHistory(mode, email) {
    const d = (await db.collection(STATE).doc(`${prefixOf(mode)}sender_${email}`).get()).data();
    return d && d.numbers ? d.numbers : {};
  }

  async function processMail(ctx, counts) {
    const { cfg, drive, auth } = ctx;
    if (!cfg.mailSince) return;                                   // email intake not switched on yet
    const gmail = google.gmail({ version: "v1", auth: calendarAuth() });
    const after = Math.floor(Date.parse(cfg.mailSince) / 1000);
    const q = `after:${after} -in:sent -in:chats -in:spam -in:trash (filename:pdf OR "drive.google.com" OR "dropbox.com" OR "box.com")`;
    const ids = []; let pageToken;
    do {
      const r = await gmail.users.messages.list({ userId: "me", q, maxResults: 100, pageToken });
      ids.push(...(r.data.messages || []).map(m => m.id)); pageToken = r.data.nextPageToken;
    } while (pageToken && ids.length < 300);
    counts.mail = counts.mail || { seen: 0, skipped: 0, queued: 0, duplicate: 0, links: 0 };
    for (const id of ids.reverse()) {                              // oldest first
      if (ctx.deadline() < 120 * 1000) break;
      const sref = db.collection(STATE).doc(`${prefixOf(cfg.mode)}mail_${id}`);
      // Already handled — except mail the pre-v509 rule skipped as a "newsletter":
      // our bids@ group stamps list headers on everything, so re-check it with the fixed rule.
      const prev = (await sref.get()).data();
      if (prev && !(prev.status === "skipped" && prev.reason === "newsletter")) continue;
      const msg = (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
      counts.mail.seen++;
      const from = MAIL.senderEmail(msg), subject = MAIL.header(msg, "Subject");
      const date = new Date(Number(msg.internalDate) || Date.now()).toLocaleDateString("en-CA", { timeZone: TZ });
      const base = { type: "mail", mode: cfg.mode, from, subject, date, threadId: msg.threadId, at: nowIso() };
      const skip = MAIL.skipReason(msg);
      if (skip) {
        await sref.set({ ...base, status: "skipped", reason: skip });
        counts.mail.skipped++; continue;
      }
      const body = MAIL.bodyText(msg);
      const history = await senderHistory(cfg.mode, from);
      const ctxItem = { from, subject, date, threadId: msg.threadId, gmailLink: gmailLink(msg.threadId), body: body.slice(0, 1500), senderHistory: history };
      let n = 0, queued = 0;
      const ingest = async (buffer, filename, source) => {
        n++;
        const md5 = md5Of(buffer);
        const seen = await md5Seen(cfg.mode, md5);
        if (seen) { counts.mail.duplicate++; return; }
        let fileId = "";
        if (cfg.mode !== "dry") {
          const name = `${date} – ${String(filename || "plans.pdf").replace(/[\\/]/g, "-")}`;
          fileId = await driveUploadResumable(auth, { name, mime: "application/pdf", parentId: await inboxId(ctx), buffer });
          await md5Mark(cfg.mode, md5, { fileId, where: "inbox", name });
        }
        await enqueue(cfg.mode, `email_${id}_${n}`, { type: "email_pdf", ...ctxItem, filename, source, md5, bytes: buffer.length, inboxFileId: fileId });
        queued++;
      };
      for (const p of MAIL.pdfParts(msg)) {
        try {
          const a = await gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: p.attachmentId });
          await ingest(Buffer.from(String(a.data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64"), p.filename, "attachment");
        } catch (e) { counts.errors.push(`mail attachment ${p.filename}: ${e.message}`.slice(0, 200)); }
      }
      for (const l of MAIL.shareLinks(body)) {
        counts.mail.links++;
        try {
          if (l.kind === "drive") {
            const f = (await drive.files.get({ fileId: l.id, fields: "id,name,mimeType,size", supportsAllDrives: true })).data;
            if (!/pdf/i.test(f.mimeType || "")) continue;
            if (Number(f.size) > MAX_FETCH_BYTES) throw new Error("too large");
            const r = await drive.files.get({ fileId: l.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
            await ingest(Buffer.from(r.data), f.name, "drive link");
          } else if (l.kind === "dropbox") {
            const r = await fetch(l.direct, { redirect: "follow" });
            if (!r.ok) throw new Error(`Dropbox ${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > MAX_FETCH_BYTES || buf.slice(0, 5).toString() !== "%PDF-") continue;   // folders / non-PDFs are left for a person
            const name = decodeURIComponent((l.url.split("?")[0].split("/").pop() || "dropbox.pdf"));
            await ingest(buf, /\.pdf$/i.test(name) ? name : `${name}.pdf`, "dropbox link");
          } else {
            n++;
            await enqueue(cfg.mode, `email_${id}_${n}`, { type: "email_pdf", ...ctxItem, filename: "", source: "box link", link: l.url, inboxFileId: "" });
            queued++;
          }
        } catch (e) {
          // A link we can't open (private Drive file, expired Dropbox) still goes to the Routine as a link.
          n++;
          await enqueue(cfg.mode, `email_${id}_${n}`, { type: "email_pdf", ...ctxItem, filename: "", source: `${l.kind} link (not fetched: ${String(e.message).slice(0, 60)})`, link: l.url, inboxFileId: "" });
          queued++;
        }
      }
      counts.mail.queued += queued;
      await sref.set({ ...base, status: queued ? "queued" : (n ? "duplicate" : "no pdf"), pieces: n, queued });
    }
  }

  // Once a day: the jobs + open quotes the Routine may file against, with
  // addresses — so the Routine never needs Simpro or Firestore access itself.
  async function refreshCandidates(ctx, counts) {
    const ref = db.collection(STATE).doc("candidates");
    const prev = (await ref.get()).data() || {};
    if (prev.at && prev.resiOnly && Date.now() - Date.parse(prev.at) < 20 * 3600 * 1000) return;
    if (ctx.deadline() < 240 * 1000) return;
    const snap = await db.collection("jobs").get();
    const jobs = [], appQuotes = [];
    for (const d of snap.docs) {
      const j = d.data().data || {};
      if (j.deleted || j.archived || j.division === "commercial") continue;   // residential only
      const row = { name: String(j.name || ""), address: String(j.address || ""), gc: String(j.gc || ""), hasFolder: !!String(j.driveFolderId || "").trim() };
      if (j.type === "quote") { if (/^\d+$/.test(String(j.simproQuoteNo || ""))) appQuotes.push({ number: String(j.simproQuoteNo), ...row }); }
      else if (/^\d+$/.test(String(j.simproNo || "").trim())) jobs.push({ number: String(j.simproNo).trim(), ...row });
    }
    const siteAddr = { ...(prev.siteAddr || {}) };
    const groups = { ...(prev.groups || {}) };              // quote # → Business Group, kept between runs
    const commList = deps.commercialGroups ? await deps.commercialGroups() : ["commercial", "multi family"];
    const quotes = [];
    const cutoff = new Date(Date.now() - 180 * 86400e3).toISOString().slice(0, 10);
    for (let page = 1; page <= 3; page++) {
      const rows = await sget(`/quotes/?pageSize=250&page=${page}&orderby=-ID&columns=ID,Name,Site,DateIssued,IsClosed,Stage,LinkedJobID`);
      if (!Array.isArray(rows) || !rows.length) break;
      for (const q of rows) {
        if (String(q.DateIssued || "") < cutoff || q.IsClosed || q.Stage === "Archived" || q.LinkedJobID) continue;
        const sid = q.Site && q.Site.ID;
        if (sid && siteAddr[sid] === undefined && ctx.deadline() > 120 * 1000) {
          const s = await sget(`/sites/${sid}`).catch(() => null);
          siteAddr[sid] = s && s.Address ? [s.Address.Address, s.Address.City].filter(Boolean).join(", ").trim() : "";
        }
        if (groups[q.ID] === undefined && ctx.deadline() > 90 * 1000) groups[q.ID] = await businessGroup("quote", q.ID);
        if (groups[q.ID] && commList.includes(String(groups[q.ID]).toLowerCase())) continue;   // residential only
        quotes.push({ number: String(q.ID), name: String(q.Name || ""), site: (q.Site && q.Site.Name) || "", address: siteAddr[sid] || "", issued: q.DateIssued });
      }
      if (String(rows[rows.length - 1].DateIssued || "") < cutoff) break;
    }
    await ref.set({ at: nowIso(), resiOnly: true, jobs, appQuotes, quotes, siteAddr, groups });
    counts.candidates = { jobs: jobs.length, quotes: quotes.length };
  }

  // ══ Routine API (Phase 2) ═══════════════════════════════════════════════
  // The Routine's ONLY door in: bearer token (secret PLAN_ROUTINE_TOKEN, held by
  // the Routine as an API credential). It can read the queue, fetch a queued
  // PDF, and post a decision; this function does every move and write, and
  // only ever moves a queued file out of _Plan Inbox into a plan folder.
  const ROUTINE_SECRET = "PLAN_ROUTINE_TOKEN";
  const CATS = Object.keys(MAIL.CATEGORIES);
  function tokenOk(req) {
    const want = String(process.env[ROUTINE_SECRET] || "");
    const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (want.length < 32 || got.length !== want.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  }
  async function currentFolder(drive, folderId, create) {
    const meta = (await drive.files.get({ fileId: folderId, fields: "id,name", supportsAllDrives: true })).data;
    if (/most\s*updated/i.test(meta.name || "")) return meta.id;                 // job linked straight to MOST UPDATED (Koplin)
    await ensureSkeleton(drive, folderId, { create });
    const kids = (await listChildren(drive, folderId)).filter(f => f.mimeType === FOLDER_MIME);
    const cur = kids.find(f => /most\s*updated/i.test(f.name || ""));
    return cur ? cur.id : "";
  }
  async function folderFor(ctx, kind, number) {
    if (kind === "job") {
      const js = await ccJobsBy("simproNo", number);
      if (js.length !== 1) throw Object.assign(new Error(js.length ? `${js.length} app jobs carry #${number}` : `no app job #${number}`), { code: 422 });
      if (await isCommercial("job", number, js[0])) throw notResi(`job #${number}`);
      const id = folderIdOf(js[0].driveFolderId);
      if (!id) throw Object.assign(new Error(`job #${number} has no Drive folder yet`), { code: 422 });
      return { folderId: id, jobId: js[0].id };
    }
    if (await isCommercial("quote", number)) throw notResi(`quote #${number}`);
    const st = (await db.collection(STATE).doc(`${prefixOf(ctx.cfg.mode)}quote_${number}`).get()).data();
    if (st && st.folderId) return { folderId: st.folderId };
    const q = await sget(`/quotes/${encodeURIComponent(number)}?columns=ID,Name,Site`).catch(() => null);
    if (!q || !q.ID) throw Object.assign(new Error(`no Simpro quote ${number}`), { code: 422 });
    const made = await ensureQuoteFolder(ctx, number, { quoteName: q.Name || "", siteName: (q.Site && q.Site.Name) || "", source: "email" });
    return { folderId: made.folderId };
  }
  async function decide(ctx, item, d) {
    const { cfg, drive } = ctx;
    const live = cfg.mode !== "dry";
    if (d.action === "dismiss") {
      // Out of sight, not gone: dismissed PDFs move to _Plan Inbox/Dismissed.
      if (live && item.inboxFileId) {
        try {
          const inbox = await inboxId(ctx);
          const f = (await drive.files.get({ fileId: item.inboxFileId, fields: "id,parents", supportsAllDrives: true })).data;
          if ((f.parents || []).includes(inbox)) {
            const dis = (await findOrMakeFolder(drive, inbox, "Dismissed", { create: true })).id;
            await drive.files.update({ fileId: item.inboxFileId, addParents: dis, removeParents: inbox, fields: "id", supportsAllDrives: true });
          }
        } catch (e) { log.warn("planIntake: dismiss move failed", { item: item.id, error: e.message }); }
      }
      return { status: "dismissed", note: String(d.reason || "").slice(0, 200) };
    }
    if (d.action === "unmatched") {
      await finding(cfg.mode, `unmatched_${item.id}`, { number: String(d.bestGuess || ""), type: "unmatched_plan",
        extra: { item: item.id, bestGuess: String(d.bestGuess || ""), canFile: !!item.inboxFileId, filename: item.filename || "", from: item.from || "" },
        summary: `Plan not matched: ${item.filename || item.link || "link"} from ${item.from}${d.bestGuess ? ` — best guess ${d.bestGuess}` : ""}${d.reason ? ` (${String(d.reason).slice(0, 120)})` : ""}`,
        links: [...(item.inboxFileId ? [{ label: "File", url: `https://drive.google.com/file/d/${item.inboxFileId}/view` }] : []), { label: "Email", url: item.gmailLink }] });
      return { status: "unmatched", note: String(d.reason || "").slice(0, 200) };
    }
    if (d.action === "match_walk") {
      if (item.type !== "walk_unmatched") throw Object.assign(new Error("match_walk is for walk items"), { code: 422 });
      const number = String(d.number || "").replace(/\D/g, "");
      if (await isCommercial(d.kind === "job" ? "job" : "quote", number)) throw notResi(`${d.kind === "job" ? "job" : "quote"} #${number}`);
      if (d.kind === "job") {
        await finding(cfg.mode, `walk_job_${item.eventId}`, { number, type: "walk_existing_job", summary: `Walk on existing job #${number}: ${item.title} (${item.walkDate}) — matched by the Routine` });
        return { status: "done", note: `existing job #${number}` };
      }
      const q = await sget(`/quotes/${number}?columns=ID,Name,Site`).catch(() => null);
      if (!q || !q.ID) throw Object.assign(new Error(`no Simpro quote ${number}`), { code: 422 });
      await ensureQuoteFolder(ctx, number, { eventId: item.eventId, quoteName: q.Name || "", siteName: (q.Site && q.Site.Name) || "", walkTitle: item.title, walkDate: item.walkDate, source: "walk (Routine)" });
      await db.collection(STATE).doc(`${prefixOf(cfg.mode)}walk_${item.eventId}`).set({ status: "matched", quoteNo: number, matchedBy: "routine" }, { merge: true });
      return { status: "done", note: `quote #${number}` };
    }
    if (d.action !== "file") throw Object.assign(new Error(`unknown action ${d.action}`), { code: 422 });
    if (item.type !== "email_pdf" || !item.inboxFileId) throw Object.assign(new Error("only a fetched email PDF can be filed"), { code: 422 });
    const kind = d.kind === "quote" ? "quote" : "job";
    const number = String(d.number || "").replace(/\D/g, "");
    if (!number) throw Object.assign(new Error("number required"), { code: 422 });
    const cat = String(d.category || "").toLowerCase();
    if (!CATS.includes(cat)) throw Object.assign(new Error(`category must be one of ${CATS.join(", ")}`), { code: 422 });
    const name = MAIL.filedName({ number, kind, rev: d.rev, date: d.date || item.date, original: item.filename });
    if (!live) return { status: "decided_dry", note: `would file as ${name}` };
    const { folderId } = await folderFor(ctx, kind, number);
    const cur = await currentFolder(drive, folderId, true);
    if (!cur) throw Object.assign(new Error("no MOST UPDATED folder"), { code: 500 });
    const kids = (await listChildren(drive, cur)).filter(f => f.mimeType === FOLDER_MIME).map(f => f.name);
    const cf = MAIL.categoryFolder(cat, kids);
    const targetId = cf.name ? (await findOrMakeFolder(drive, cur, cf.name, { create: true })).id : cur;
    const f = (await drive.files.get({ fileId: item.inboxFileId, fields: "id,parents", supportsAllDrives: true })).data;
    const inbox = await inboxId(ctx);
    if (!(f.parents || []).includes(inbox)) throw Object.assign(new Error("file is no longer in _Plan Inbox — someone moved it"), { code: 409 });
    await drive.files.update({ fileId: item.inboxFileId, addParents: targetId, removeParents: inbox, requestBody: { name }, fields: "id", supportsAllDrives: true });
    await md5Mark(cfg.mode, item.md5, { fileId: item.inboxFileId, where: `${kind} ${number}`, name });
    await db.collection(STATE).doc(`${prefixOf(cfg.mode)}sender_${item.from}`).set({ type: "sender", numbers: { [`${kind === "quote" ? "Q" : "#"}${number}`]: deps.FieldValue.increment(1) } }, { merge: true });
    await finding(cfg.mode, `filed_${item.id}`, { number: kind === "quote" ? `Q${number}` : number, type: "plans_filed",
      summary: `Filed "${item.filename}" from ${item.from} into ${kind === "quote" ? "Q" : "#"}${number} / MOST UPDATED${cf.name ? ` / ${cf.name}` : ""} as "${name}"${d.reason ? ` — ${String(d.reason).slice(0, 120)}` : ""}`,
      links: [{ label: "Folder", url: folderUrl(targetId) }, { label: "Email", url: item.gmailLink }] });
    return { status: "done", note: name };
  }

  const planRoutineApi = functions
    // invoker "public": this deploy created planRoutineApi private (Google's own 403
    // page, 2026-10-04) while the older https functions are public. Google's door
    // stays open so the Routine can reach it; the bearer-token check is the gate.
    .runWith({ timeoutSeconds: 300, memory: "1GB", secrets: [ROUTINE_SECRET], invoker: "public" })
    .https.onRequest(async (req, res) => {
      if (!tokenOk(req)) { res.status(401).json({ error: "unauthorized" }); return; }
      try {
        const cfg = await loadConfig();
        const p = prefixOf(cfg.mode);
        const route = String(req.path || "/").replace(/\/+$/, "") || "/";
        if (req.method === "GET" && route === "/work") {
          const snap = await db.collection(QUEUE).where("status", "==", "open").get();
          const items = snap.docs.filter(d => p ? d.id.startsWith(p) : !/^(dry|test)_/.test(d.id))
            .map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, 40);
          const cand = (await db.collection(STATE).doc("candidates").get()).data() || {};
          res.json({ mode: cfg.mode, today: today(), categories: CATS, items, candidates: { at: cand.at, jobs: cand.jobs || [], appQuotes: cand.appQuotes || [], quotes: cand.quotes || [] } });
          return;
        }
        const itemId = String((req.query && req.query.item) || (req.body && req.body.item) || "");
        if (!itemId || !itemId.startsWith(p) || (!p && /^(dry|test)_/.test(itemId))) { res.status(404).json({ error: "no such item" }); return; }
        const iref = db.collection(QUEUE).doc(itemId);
        const item = { id: itemId, ...((await iref.get()).data() || {}) };
        if (!item.type) { res.status(404).json({ error: "no such item" }); return; }
        if (req.method === "GET" && route === "/file") {
          if (!item.inboxFileId) { res.status(404).json({ error: "this item has no fetched file", link: item.link || "" }); return; }
          const { drive } = driveFullClient();
          const r = await drive.files.get({ fileId: item.inboxFileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
          res.set("Content-Type", "application/pdf").send(Buffer.from(r.data));
          return;
        }
        if (req.method === "POST" && route === "/decide") {
          if (item.status !== "open") { res.status(409).json({ error: `item is ${item.status}` }); return; }
          const { drive, auth } = driveFullClient();
          const started = Date.now();
          const ctx = { cfg, drive, auth, deadline: () => 250 * 1000 - (Date.now() - started) };
          const out = await decide(ctx, item, req.body || {});
          await iref.update({ status: out.status, decision: { ...(req.body || {}), note: out.note, at: nowIso() }, decidedAt: nowIso() });
          res.json({ ok: true, ...out });
          return;
        }
        res.status(404).json({ error: "unknown route" });
      } catch (e) {
        log.warn("planRoutineApi failed", { error: e.message });
        res.status(e.code && e.code >= 400 && e.code < 600 ? e.code : 500).json({ error: String(e.message || e).slice(0, 300) });
      }
    });

  // ══ Phase 4 — delivery (PLAN_INTAKE_SPEC.md, Koy 2026-10-04) ═══════════════
  // 5 pm summary email (Resend, to koywilkinson@gmail.com until the domain is
  // verified — config.digestTo overrides), 6:30 am walk push to Koy, and
  // "file it from the card" for plans the Routine wasn't sure about.
  const DIGEST = require("./digest.js");
  const planIntakeDigest = functions.pubsub.schedule("0 17 * * *").timeZone(TZ).onRun(async () => {
    const cfg = await loadConfig();
    if (cfg.mode !== "live" || !sendGcMail) return null;
    const day = today();
    const snap = await db.collection(FINDINGS).where("day", "==", day).get();
    const rows = snap.docs.filter(d => !/^(dry|test)_/.test(d.id)).map(d => d.data());
    const mail = DIGEST.digestEmail({ day, findings: rows });
    const cfgRef = db.collection(STATE).doc("config");
    if (!mail.total) { await cfgRef.set({ lastDigest: { at: nowIso(), day, sent: false, reason: "nothing today" } }, { merge: true }); return null; }
    const to = String(cfg.digestTo || "koywilkinson@gmail.com");
    const sent = await sendGcMail({ to, subject: mail.subject, html: mail.html });
    await cfgRef.set({ lastDigest: { at: nowIso(), day, sent: !!sent, to, total: mail.total, needs: mail.needs } }, { merge: true });
    if (!sent && sendToName) await sendToName("Koy", { title: "Plan intake summary didn't send", body: `${mail.subject} — open Today → Plans`, view: "today" }).catch(() => {});
    return null;
  });

  const planIntakeWalkPush = functions.pubsub.schedule("30 6 * * *").timeZone(TZ).onRun(async () => {
    const cfg = await loadConfig();
    if (cfg.mode !== "live" || !sendToName) return null;
    const day = today();
    const snap = await db.collection(STATE).where("walkDate", "==", day).get();
    const walks = snap.docs.filter(d => d.id.startsWith("walk_")).map(d => d.data()).filter(w => w.type === "walk");
    const quotes = {};
    for (const w of walks) {
      if (!w.quoteNo || quotes[w.quoteNo]) continue;
      const q = (await db.collection(STATE).doc(`quote_${w.quoteNo}`).get()).data() || {};
      quotes[w.quoteNo] = { folderName: q.renamedTo || q.folderName || "", filedCount: Object.values(q.ledger || {}).filter(x => x && x.status === "copied").length };
    }
    const push = DIGEST.walkPush(walks, quotes);
    if (push) await sendToName("Koy", { ...push, view: "today" });
    return null;
  });

  const planFileByHand = functions
    .runWith({ timeoutSeconds: 120 })
    .https.onCall(async (data) => {
      const user = await requireAdmin(data);              // app key + name + PIN, admin/manager tier
      const isHead = Array.isArray(user.caps) && user.caps.includes("resi.head");
      if (!isHead && gcAccessOf(user) !== "admin") throw new functions.https.HttpsError("permission-denied", "Only the Head of Residential can file plans from the card.");
      const cfg = await loadConfig();
      if (cfg.mode !== "live") throw new functions.https.HttpsError("failed-precondition", `plan intake is in ${cfg.mode} mode`);
      const itemId = String((data && data.item) || "");
      if (!itemId || /^(dry|test)_/.test(itemId)) throw new functions.https.HttpsError("not-found", "No such plan.");
      const iref = db.collection(QUEUE).doc(itemId);
      const item = { id: itemId, ...((await iref.get()).data() || {}) };
      if (item.type !== "email_pdf") throw new functions.https.HttpsError("not-found", "No such plan.");
      if (!["open", "unmatched"].includes(item.status)) throw new functions.https.HttpsError("failed-precondition", `This plan is already ${item.status}.`);
      const { drive, auth } = driveFullClient();
      const started = Date.now();
      const ctx = { cfg, drive, auth, deadline: () => 100 * 1000 - (Date.now() - started) };
      let out;
      try {
        out = await decide(ctx, item, { action: "file", kind: data.kind === "quote" ? "quote" : "job", number: data.number, category: data.category, rev: data.rev, date: data.date, reason: `filed by ${user.name} from the Plans card` });
      } catch (e) {
        throw new functions.https.HttpsError(e.code === 409 ? "failed-precondition" : e.code === 422 ? "invalid-argument" : "internal", String(e.message || e));
      }
      await iref.update({ status: out.status, decision: { action: "file", number: String(data.number || ""), category: String(data.category || ""), by: user.name, note: out.note, at: nowIso() }, decidedAt: nowIso() });
      await db.collection(FINDINGS).doc(`unmatched_${itemId}`).set({ seen: true, seenAt: nowIso(), seenBy: user.name }, { merge: true }).catch(() => {});
      return { ok: true, name: out.note };
    });

  // ── The run ─────────────────────────────────────────────────────────────
  async function runOnce() {
    const started = Date.now();
    const cfg = await loadConfig();
    const cfgRef = db.collection(STATE).doc("config");
    // One run at a time (a slow Simpro day must not let two runs double-copy).
    const gotLock = await db.runTransaction(async (tx) => {
      const s = await tx.get(cfgRef);
      const lock = s.exists ? s.data().runLockAt : "";
      if (lock && Date.now() - Date.parse(lock) < LOCK_MS) return false;
      tx.set(cfgRef, { runLockAt: nowIso() }, { merge: true });
      return true;
    });
    if (!gotLock) { log.info("planIntake: previous run still going — skipped"); return { skipped: true }; }
    const counts = { events: 0, matched: 0, existingJob: 0, pending: 0, queued: 0, converted: 0, filed: 0, errors: [] };
    try {
      if (cfg.mode === "test" && !cfg.testParentId) throw new Error("test mode needs planIntakeState/config.testParentId");
      const { drive, auth } = driveFullClient();
      const ctx = { cfg, drive, auth, deadline: () => RUN_BUDGET_MS - (Date.now() - started) };
      await processWalks(ctx, counts).catch(e => { counts.errors.push(`calendar: ${e.message}`.slice(0, 200)); });
      await processMail(ctx, counts).catch(e => { counts.errors.push(`mail: ${e.message}`.slice(0, 200)); });
      const p = prefixOf(cfg.mode);
      const snap = await db.collection(STATE).where("type", "==", "quote").get();
      const tracked = snap.docs.filter(d => d.id.startsWith(`${p}quote_`))
        .map(d => ({ ref: d.ref, st: d.data() })).filter(t => t.st.tracking !== false);
      await processConversions(ctx, tracked, counts);
      const fresh = (await db.collection(STATE).where("type", "==", "quote").get()).docs
        .filter(d => d.id.startsWith(`${p}quote_`)).map(d => ({ ref: d.ref, st: d.data() }));
      await processFiles(ctx, fresh.filter(t => t.st.tracking !== false), counts);
      await refreshCandidates(ctx, counts).catch(e => { counts.errors.push(`candidates: ${e.message}`.slice(0, 200)); });
    } catch (e) {
      counts.errors.push(String(e.message || e).slice(0, 200));
    } finally {
      const summary = { at: nowIso(), mode: cfg.mode, ms: Date.now() - started, ...counts, errors: counts.errors.slice(0, 10) };
      await cfgRef.set({ runLockAt: "", lastRun: summary, ...(counts.errors.length ? { lastErrorAt: nowIso() } : { lastOkAt: nowIso() }) }, { merge: true });
      const calErr = counts.errors.find(e => e.startsWith("calendar:"));
      if (calErr && sendToName) {
        const s = (await cfgRef.get()).data() || {};
        if (s.lastCalendarAlertDay !== today()) {
          await cfgRef.set({ lastCalendarAlertDay: today() }, { merge: true });
          const dead = /invalid_grant|missing|expired|revoked/i.test(calErr);
          await sendToName("Koy", {
            title: "Plan intake can't read your calendar",
            body: dead ? "The calendar sign-in stopped working. Re-run the plan intake sign-in (scripts/plan-intake-google-auth.js)." : calErr.slice(0, 140),
          }).catch(e => log.warn("planIntake: calendar alert push failed", { error: e.message }));
        }
      }
      if (counts.errors.length) {
        await finding(cfg.mode, `watcher_error_${today()}`, { number: "", type: "watcher_error",
          summary: `Plan intake hit ${counts.errors.length} error${counts.errors.length === 1 ? "" : "s"}: ${counts.errors[0]}` });
      }
      log.info("planIntake run", summary);
    }
    return counts;
  }

  const planIntakeWatcher = functions
    .runWith({ timeoutSeconds: 540, memory: "2GB", secrets: [OAUTH_SECRET] })
    .pubsub.schedule("*/30 * * * *")
    .timeZone(TZ)
    .onRun(async () => { await runOnce(); return null; });

  // Called by the app right before "Create Drive folder" (and the commercial
  // import chain). If this job — or the app quote record — came from a quote the
  // watcher already made a folder for, link THAT folder instead of creating a
  // duplicate. Returns { linked:false } in every other case, and the app carries
  // on exactly as before. Live mode only.
  const linkQuoteFolder = functions
    .runWith({ timeoutSeconds: 120 })
    .https.onCall(async (data) => {
      requireAppKey(data);
      const jobId = String((data && data.jobId) || "").trim();
      if (!jobId) throw new functions.https.HttpsError("invalid-argument", "Missing jobId");
      const cfg = await loadConfig();
      if (cfg.mode !== "live") return { linked: false, mode: cfg.mode };
      const jobRef = db.collection("jobs").doc(jobId);
      const snap = await jobRef.get();
      if (!snap.exists) throw new functions.https.HttpsError("not-found", "Job not found");
      const job = snap.data().data || {};
      if (String(job.driveFolderId || "").trim()) return { linked: false, alreadyLinked: true };
      const isQuote = job.type === "quote";
      let quoteNo = isQuote ? String(job.simproQuoteNo || "").trim() : "";
      let sjob = null;
      if (!isQuote && /^\d+$/.test(String(job.simproNo || "").trim())) {
        try {
          sjob = await sget(`/jobs/${encodeURIComponent(String(job.simproNo).trim())}?columns=ID,Name,Site,ConvertedFrom`);
          if (sjob.ConvertedFrom && sjob.ConvertedFrom.Type === "Quote") quoteNo = String(sjob.ConvertedFrom.ID);
        } catch (e) { log.warn("linkQuoteFolder: Simpro lookup failed", { jobId, error: e.message }); }
      }
      if (!quoteNo) return { linked: false };
      const ref = db.collection(STATE).doc(`quote_${quoteNo}`);
      const st = (await ref.get()).data();
      if (!st || !st.folderId) return { linked: false };
      const { drive } = driveFullClient();
      let folderName = st.renamedTo || st.folderName;
      if (!isQuote && !st.renamedTo) {
        const newName = jobFolderName({ name: job.name, simproNo: String(job.simproNo).trim() }) || `#${job.simproNo}`;
        const r = await promoteFolder(drive, st.folderId, newName, JOBS_PARENT_FOLDER_ID);
        folderName = r.name;
        await ref.update({ jobNo: String(job.simproNo).trim(), renamedTo: r.name, renamedAt: nowIso(), inQuotesFolder: false, updatedAt: nowIso() });
      }
      const stamp = await stampFolder(jobRef, st.folderId);
      if (!stamp.ok) return { linked: false, why: stamp.why };
      await ref.update({ linkedCcJobId: jobId, updatedAt: nowIso() });
      await finding("live", `linked_${jobId}`, { number: isQuote ? `Q${quoteNo}` : String(job.simproNo), type: "folder_linked",
        summary: `Linked ${job.name || jobId} to the existing folder "${folderName}" (from Quote #${quoteNo}) instead of making a new one`,
        links: [{ label: "Folder", url: folderUrl(st.folderId) }] });
      return { linked: true, folderId: st.folderId, folderName };
    });

  return { planIntakeWatcher, linkQuoteFolder, planRoutineApi, planIntakeDigest, planIntakeWalkPush, planFileByHand, _runOnce: runOnce, _folderIdOf: folderIdOf, _decide: decide };
};
