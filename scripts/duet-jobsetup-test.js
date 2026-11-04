#!/usr/bin/env node
/* duet-jobsetup-test.js — Duet write access (connector D9), ship 9: job setup —
 * a job from a Simpro candidate, projects + buildings, Job Info scalars, Job
 * Sections, archive / unarchive.
 *
 * Drives functions/jobShape.js (the SHARED defaults — a byte copy of
 * src/jobShape.js that App.js imports back), functions/duetWrites/jobSetup.js
 * (the planners) and functions/duetWrites/api.js (the handler) against a fake
 * Firestore transaction holding real-shaped jobs, a candidates list and a
 * project. Proves: App.js defines blankJob / blankQuickJob / the row factories /
 * the Projects one-liners / gcRunningToggle / jobSectionPatch FROM jobShape.js
 * and JOB_SECTIONS matches JOB_SECTION_DEFS row for row; the created job doc is
 * key-for-key blankJob() + the import fields with data.id === the doc id and
 * every default a phone writes; the Simpro-# conflict refusal; a duplicate
 * create refused by tx.create (nothing overwritten); the candidates list
 * rewritten without the one imported and nothing else on that doc touched; set
 * info per field (division "" like the patch funnel, the running-contact taps
 * mirrored exactly as gcRunningToggle does); the section patch + the legacy
 * flags; the archive guard + force and the reversible shape; project create +
 * the Site / Shared job patch in ONE transaction; the building rules (conflict,
 * duplicate short name, copied fields, simproLead, hiddenSections + legacy
 * flags); the join patch; everything else on every doc byte-identical; only
 * jobs / projects / settings.simproCandidates / duet_writes written. No
 * Firebase import. Prebuild.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const JS = require(path.join(root, "functions", "jobShape.js"));
const JSU = require(path.join(root, "functions", "duetWrites", "jobSetup.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";
const NOW_MS = Date.parse(NOW);
const TODAY = "2026-11-03";
const TZ = "America/Denver";
const USERS = [{ id: 1, name: "Koy", title: "office", access: "admin" }, { id: 3, name: "Colby", title: "foreman" }];
const FORTH = "1772863862618", CLEAN = "1772863862619", GONE = "1772863862620", COMM = "1772863862621", SITE = "1772863862622", HOUSE1 = "1772863862623", QUOTE = "1772863862624";
const PRJ = "prj_1772863862700";
const clone = (x) => JSON.parse(JSON.stringify(x));
const mint = (seed) => { let i = seed; return () => String(++i); };

// ── real-shaped docs ─────────────────────────────────────────────────────────
const CONTACTS = [{ id: "c11", name: "Gina Super", role: "Site super", phone: "801-555-0111", email: "gina@gc.example", primary: true }, { id: "c12", name: "Paul PM", role: "PM", phone: "801-555-0112" }, { id: "c13", name: "Dee Owner", phone: "801-555-0113" }];
const BASE = () => ({ ...JS.blankJob(mint(1700000000000)), id: FORTH, name: "Forth", address: "1 Main", gc: "Acme Builders", gcContact: "", phone: "", gcContacts: CONTACTS, simproNo: "1438", foreman: "Keegan", division: "residential",
  roughPunch: { upper: { general: [{ id: "pu1", text: "Nail plates", done: false }], hotcheck: [], rooms: [], photos: [] }, main: [], basement: [] }, punchTicks: {},
  changeOrders: [{ id: "c1", desc: "Add cans", coStatus: "approved" }, { id: "c2", desc: "Old", coStatus: "completed" }], returnTrips: [{ id: "r1", scope: "Trim bath", rtStatus: "needs", signedOff: false }, { id: "r2", scope: "Done one", rtStatus: "complete", signedOff: true }],
  lightingSystem: "Lutron", panelizedLighting: { ...JS.blankJob(mint(1700000001000)).panelizedLighting, loads: [{ id: "L1", name: "Kitchen cans" }] } });
const DOC = (data, over) => ({ data, updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 606, w: "606.abcdefgh", ...(over || {}) });
const CANDS = () => [
  { simproId: "1500", name: "Stratton Residence", address: "Stratton Residence", customer: "Stratton Homes", businessGroup: "Residential", divisionHint: "resi", firstSeenAt: "2026-11-01T10:00:00.000Z", ignored: false, ignoredAt: null },
  { simproId: "1501", name: "Battle Creek B", address: "88 Creek Rd, Alpine", customer: "Creek LLC", businessGroup: "Commercial", divisionHint: "commercial", firstSeenAt: "2026-11-02T10:00:00.000Z", ignored: false, ignoredAt: null },
  { simproId: "1502", name: "No Group Job", address: "", customer: "", businessGroup: "", divisionHint: "", firstSeenAt: "2026-11-03T10:00:00.000Z", ignored: true, ignoredAt: "2026-11-03T11:00:00.000Z" },
  { simproId: "1438", name: "Forth again", address: "", customer: "", businessGroup: "Residential", divisionHint: "resi", firstSeenAt: "2026-11-03T10:00:00.000Z", ignored: false, ignoredAt: null },
];
const PROJECT = () => ({ id: PRJ, name: "Fratto Farms", division: "", gc: "Fratto GC", address: "9 Farm Rd", notes: "", simproNo: "1482", createdAt: "2026-10-29T15:00:00.000Z", createdBy: "Koy" });
const DOCS = () => ({
  ["jobs/" + FORTH]: DOC(BASE()),
  ["jobs/" + CLEAN]: DOC({ ...BASE(), id: CLEAN, name: "Clean", simproNo: "1440", gcContacts: [], roughPunch: JS.emptyPunch(), changeOrders: [], returnTrips: [], lightingSystem: "" }),
  ["jobs/" + GONE]: DOC({ ...BASE(), id: GONE, name: "Gone", simproNo: "1441", archived: true, archivedAt: "2026-10-01T00:00:00.000Z", archivedBy: "Koy" }),
  ["jobs/" + COMM]: DOC({ ...BASE(), id: COMM, name: "Battle Creek A", simproNo: "1450", division: "commercial", changeOrders: [], returnTrips: [], roughPunch: JS.emptyPunch(), commercial: { phases: {} } }),
  ["jobs/" + SITE]: DOC({ ...BASE(), id: SITE, name: "Fratto Farms · Site / Shared", simproNo: "1482", projectGroupId: PRJ, projectRole: "site", simproFolder: "", foreman: "Colby", gcContactLead: "c11", gcContact: "Gina Super", phone: "801-555-0111", changeOrders: [], returnTrips: [], roughPunch: JS.emptyPunch() }),
  ["jobs/" + HOUSE1]: DOC({ ...BASE(), id: HOUSE1, name: "Fratto Farms · House 1", simproNo: "1482", projectGroupId: PRJ, projectRole: "", simproFolder: "House 1", simproLead: true, changeOrders: [], returnTrips: [], roughPunch: JS.emptyPunch() }),
  ["jobs/" + QUOTE]: DOC({ ...BASE(), id: QUOTE, name: "A quote", simproNo: "", type: "quote", changeOrders: [], returnTrips: [], roughPunch: JS.emptyPunch() }),
  "settings/simproCandidates": { candidates: CANDS(), updated_at: "2026-11-03T12:00:00.000Z", divisionMismatches: [{ jobId: FORTH, simproDivision: "commercial" }], lastRefreshAt: "2026-11-03T12:00:00.000Z" },
  ["projects/" + PRJ]: { data: PROJECT(), updated_at: "2026-10-29T15:00:00.000Z", saved_by: "Koy", app_build: 575, w: "575.abcdefgh" },
});
const ctx = (over) => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: `${TODAY}T12:00:00`, users: USERS, tz: TZ, ...(over || {}) });
const jobOf = (docs, id) => ({ id, data: docs["jobs/" + id].data });
const liveJobs = (docs) => Object.keys(docs).filter(k => k.startsWith("jobs/")).map(k => ({ id: k.slice(5), ...docs[k].data }));
const J = (id = FORTH, extra) => { const d = DOCS(); return ctx({ job: { id, data: { ...d["jobs/" + id].data, ...(extra || {}) } }, conflicts: liveJobs(d), candidates: CANDS(), projects: [PROJECT()], project: PROJECT(), siblings: liveJobs(d) }); };

// ── fake io: api.js's transaction + the three queries over ONE store ─────────
function fakeIo({ docs = DOCS(), recent = 0 } = {}) {
  const log = [];
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path, d]); if (store[r.path]) { const e = new Error("6 ALREADY_EXISTS: document already exists: " + r.path); e.code = 6; throw e; } if (JSON.stringify(d).includes("undefined")) throw new Error("undefined written"); store[r.path] = clone(d); },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => { if (d[k] === undefined) throw new Error("undefined written at " + k); setPath(cur, k, d[k]); }); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  const jobs = () => Object.keys(store).filter(k => k.startsWith("jobs/")).map(k => ({ id: k.slice(5), ...store[k].data }));
  const io = {
    log, store, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => recent, getJob: async () => null, getUsers: async () => USERS, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), hrRef: (id) => ref("homeowner_requests", id), auditRef: (id) => ref("duet_writes", id),
    settingsRef: (id) => { if (!api.settingsDocAllowed(id)) throw new api.Refusal(400, "settings/" + id + " is not a document Duet may touch."); return ref("settings", id); },
    projectRef: (id) => { if (!JSU.PROJECT_ID.test(String(id))) throw new api.Refusal(400, "bad project id"); return ref("projects", id); },
    jobsBySimproNo: async (t, no) => { log.push(["query", "jobs?data.simproNo=" + no]); const nn = String(no).replace(/^#/, ""); return jobs().filter(j => [nn, "#" + nn].includes(String(j.simproNo || ""))).map(j => ({ id: j.id, name: j.name || "", simproNo: j.simproNo || "", projectGroupId: j.projectGroupId || "", archived: !!j.archived, deleted: !!j.deleted })); },
    jobsByProject: async (t, pid) => { log.push(["query", "jobs?data.projectGroupId=" + pid]); return jobs().filter(j => j.projectGroupId === pid); },
    allProjects: async () => { log.push(["query", "projects"]); return Object.keys(store).filter(k => k.startsWith("projects/")).map(k => ({ id: k.slice(9), ...store[k].data })); },
    readDoc: async (r) => store[r.path] || null,
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }), deleteField: () => ({ __delete: true }), fieldPath: (...s) => s.join("."),
  };
  return io;
}
const RID = (k) => `99999999-9999-4999-8999-${String(k).padStart(12, "0")}`;
let rid = 0;
const call = (io, action, args) => api.handle({ requestId: RID(++rid), action, args }, io);
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const CREATE_ENVELOPE = ["app_build", "data", "device", "saved_by", "tab", "updated_at", "w"];
const writes = (io, kind, path) => io.log.filter(l => l[0] === kind && (!path || l[1] === path));
const oneUpdate = (io, path) => { const u = writes(io, "update", path); assert.strictEqual(u.length, 1, "exactly one update on " + path); return u[0][2]; };
const dataKeys = (upd) => Object.keys(upd).filter(k => k.startsWith("data.")).map(k => k.slice(5)).sort();
const checkStamp = (upd, prevIso = "2026-11-03T20:00:00.000Z") => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-9999"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 608 && new RegExp("^" + upd.app_build + "\\.duet[a-z0-9]{6,}$").test(upd.w), "version-lock stamp >= 608");
  assert.strictEqual(upd.merged, false); assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true });
  assert.ok(Date.parse(upd.updated_at) > Date.parse(prevIso), "updated_at strictly newer than the doc's");
  assert.deepStrictEqual(Object.keys(upd).filter(k => !k.startsWith("data.")).sort(), ENVELOPE);
};
const restIdentical = (io, path, keysWritten) => {
  const before = DOCS()[path], after = io.store[path];
  const b = before.data || before, a = after.data || after;
  const wrote = new Set(keysWritten);
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) if (!wrote.has(k)) assert.deepStrictEqual(a[k], b[k], path + " ." + k + " untouched");
};
const auditOf = (io, k) => io.store["duet_writes/" + RID(k)];
const onlyAllowed = (io) => { for (const l of io.log) if (l[0] === "update" || l[0] === "set" || l[0] === "create") assert.ok(/^(jobs|projects|duet_writes)\/|^settings\/simproCandidates$/.test(l[1]), "only jobs / projects / settings.simproCandidates / duet_writes written: " + l[1]); for (const l of io.log) if (l[1] === "settings/simproCandidates" && l[0] !== "get") assert.deepStrictEqual(Object.keys(l[2]).sort(), ["candidates", "updated_at"], "only the two fields the app sets on the candidates doc"); };
const untouched = (io, paths) => { for (const p of paths) assert.deepStrictEqual(io.store[p], DOCS()[p], p + " untouched"); };
const ID = /^\d{13}$/;
const fields = (p) => { assert.ok(!p.refused && !p.noop, "planned: " + JSON.stringify(p.refused || p)); return p.fields; };

// Every key blankJob() writes, pinned (a phone's "+ New" and the server's import must agree on this list).
const BLANK_KEYS = ["id", "name", "address", "gc", "phone", "gcContacts", "gcContactLead", "gcContactLead2", "gcContact2", "phone2", "gcContactLabels", "simproNo", "simproQuoteNo", "foreman", "lead", "flagged", "flagNote", "planLink", "redlineLink", "lightingLink", "panelLink", "qcLink", "matterportLink", "matterportLinks", "driveFolderId", "uploadedFiles", "prepStage", "roughStage", "finishStage", "roughScheduled", "finishScheduled", "roughScheduledDate", "finishScheduledDate", "prepStartDate", "finishStartDate", "roughQuestions", "roughPunch", "roughMaterials", "roughUpdates", "roughNotes", "qcPunch", "finishPunch", "finishMaterials", "finishUpdates", "finishNotes", "finishQuestions", "changeOrders", "returnTrips", "roughInspectionResult", "roughInspectionDate", "roughInspectionItems", "roughInspectionAttempts", "finalInspectionResult", "finalInspectionDate", "finalInspectionItems", "finalInspectionAttempts", "roughStatus", "roughStatusDate", "roughScheduledEnd", "roughProjectedStart", "finishStatus", "finishStatusDate", "finishScheduledEnd", "finishProjectedStart", "qcStatus", "qcStatusDate", "qcSignedOff", "qcSignedOffBy", "qcSignedOffDate", "roughQCTaskFired", "roughStartConfirmed", "finishStartConfirmed", "roughNeedsHardDate", "roughNeedsByStart", "roughNeedsByEnd", "finishNeedsHardDate", "finishNeedsByStart", "finishNeedsByEnd", "readyToSchedule", "readyToInvoice", "invoiceDismissed", "matterportDismissed", "taskDueDates", "roughOnHold", "finishOnHold", "tempPed", "hasTempPed", "tempPedNumber", "tempPedStatus", "tempPedScheduledDate", "homeRuns", "panelCounts", "panelizedLighting", "tapeLights", "loadMappingNotes"];
const QUICK_KEYS = ["id", "name", "address", "gc", "phone", "simproNo", "foreman", "lead", "flagged", "flagNote", "quickJob", "quickJobType", "quickJobStatus", "quickJobDate", "quickJobEndDate", "scope", "material", "notes", "photos", "signedOff", "signedOffBy", "signedOffDate", "readyToInvoice", "invoiceDismissed", "invoiceSent", "readyToInvoiceDate", "accessNote", "taskDueDates", "changeOrders", "returnTrips"];

(async () => {
// ── pinned to App.js ─────────────────────────────────────────────────────────
await ok("App.js imports jobShape.js and defines blankJob / blankQuickJob / the row factories / the Projects one-liners / gcRunningToggle / jobSectionPatch FROM it; functions/jobShape.js is the byte copy", () => {
  const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
  assert.ok(app.includes('import JobShape from "./jobShape";'));
  for (const line of ['const blankJob = () => JobShape.blankJob(uid);', 'const blankQuickJob = (type = "service") => JobShape.blankQuickJob(uid, type);', 'const newHRRow     = (num) => JobShape.newHRRow(uid, num);', 'const newCP4Row    = (num) => JobShape.newCP4Row(uid, num);', 'const newKPRow         = (num) => JobShape.newKPRow(uid, num);', 'const emptyPunch   = JobShape.emptyPunch;',
    'const isSimproJoinable = JobShape.isSimproJoinable;', 'const projectBuildings = JobShape.projectBuildings;', 'const buildingJobName = JobShape.buildingJobName;', 'const buildingShortName = JobShape.buildingShortName;', 'const simproNoConflict = JobShape.simproNoConflict;', 'const gcContactKey = JobShape.gcContactKey;', 'const gcRunningToggle = JobShape.gcRunningToggle;', 'const jobSectionPatch = JobShape.jobSectionPatch;']) assert.ok(app.includes(line), "App.js: " + line);
  assert.ok(!/^const blankJob = \(\) => \(\{/m.test(app) && !/^const gcRunningToggle = \(job, k\) => \{/m.test(app), "the old literals are gone from App.js");
  assert.ok(fs.readFileSync(path.join(root, "src", "jobShape.js")).equals(fs.readFileSync(path.join(root, "functions", "jobShape.js"))), "functions/jobShape.js === src/jobShape.js");
  assert.ok(!/require\(/.test(fs.readFileSync(path.join(root, "src", "jobShape.js"), "utf8")), "jobShape.js requires nothing");
  // importSimproCandidate's stamps, still in App.js, in the order the planner writes them.
  for (const s of ['j.simproNo = String(cand.simproId || "");', 'j.customer = cand.customer || "";', 'if (cand.divisionHint === "commercial") j.division = "commercial";', 'else if (cand.divisionHint === "resi") delete j.division;', 'if (cand.businessGroup) j.simproBusinessGroup = String(cand.businessGroup);', 'j.foreman = "Unassigned";', 'j._importedFromSimpro = true;', 'j.imported_at = new Date().toISOString();', 'if (kind === "tempped") j.tempPed = true;']) assert.ok(app.includes(s), "importSimproCandidate: " + s);
  assert.ok(app.includes('u({ division: k==="commercial" ? "commercial" : "" });'), "the patch funnel writes division \"\" for resi");
  assert.ok(app.includes('onPatch({ projectGroupId: p.id, projectRole: "", simproLead: false, simproFolder: "" });'), "the join patch");
  assert.ok(app.includes('onPatch({ projectGroupId: p.id, projectRole: "site", simproFolder: "", name: buildingJobName(name, "Site / Shared") });'), "the Site / Shared patch");
  assert.ok(app.includes('ctx.patchProject(project.id, { archived:true, archivedBy: ctx.identity?.name || "", archivedAt: new Date().toISOString() })'), "the project archive shape");
  assert.ok(!/const (archiveJob|unarchiveJob|setJobArchived) = /.test(app), "the app still has NO job archive handler (Duet's shape is its own)");
});
await ok("JOB_SECTIONS in App.js matches JOB_SECTION_DEFS row for row (key, label, commercial, parent, legacy flag)", () => {
  const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
  const start = app.indexOf("const JOB_SECTIONS = ["), end = app.indexOf("\n];", start);
  assert.ok(start > 0 && end > start);
  const body = app.slice(start, end);
  const rows = [...body.matchAll(/\{ key:"([^"]+)", label:"([^"]+)"(,\s*commercial:true)?(?:,\s*parent:"([^"]+)")?(?:,\s*legacy:(topFlag|plFlag)\("([^"]+)"\))?/g)].map(m => ({ key: m[1], label: m[2], commercial: !!m[3], parent: m[4] || null, legacy: m[5] ? (m[5] === "topFlag" ? { top: m[6] } : { pl: m[6] }) : null }));
  const defs = JS.JOB_SECTION_DEFS.map(s => ({ key: s.key, label: s.label, commercial: !!s.commercial, parent: s.parent || null, legacy: s.legacy || null }));
  assert.deepStrictEqual(rows, defs);
  assert.strictEqual(rows.length, 21);
  assert.ok(body.includes('appliesTo:(j)=>(j.lightingSystem||"")==="Lutron"'), "techLighting is Lutron-only in App.js");
  assert.ok(JS.JOB_SECTION_DEF_BY_KEY.techLighting.lutronOnly === true);
});

// ── 1. the shared defaults ──────────────────────────────────────────────────
await ok("blankJob(uid): the pinned key list, 71 ids minted in order (the job's id first), ten rows per floor, the keypad / CP4 rows, empty punch floors; blankQuickJob pinned too", () => {
  const u = mint(1700000000000);
  const j = JS.blankJob(u);
  assert.deepStrictEqual(Object.keys(j), BLANK_KEYS);
  assert.strictEqual(j.id, "1700000000001"); assert.strictEqual(u(), "1700000000072", "71 ids used");
  assert.strictEqual(j.homeRuns.main.length, 10); assert.deepStrictEqual(j.homeRuns.main[0], { id: "1700000000002", num: 1, wire: "", name: "", status: "", panel: "" });
  assert.deepStrictEqual(j.panelizedLighting.mainKeypad[0], { id: "1700000000032", num: 1, name: "", status: "" });
  assert.deepStrictEqual(Object.keys(j.panelizedLighting.cp4Loads[0]), ["id", "num", "name", "moduleType", "mod", "ch", "loadType", "watts", "keypad", "bus", "pdu", "chainPos", "panel", "breaker", "phase", "status"]);
  assert.deepStrictEqual(j.roughPunch, { upper: [], main: [], basement: [] }); assert.strictEqual(j.foreman, "Koy"); assert.ok(!("division" in j) && !("customer" in j));
  const q = JS.blankQuickJob(mint(1700000000000)); assert.deepStrictEqual(Object.keys(q), QUICK_KEYS); assert.strictEqual(q.quickJobType, "service"); assert.strictEqual(JS.blankQuickJob(mint(1), "tempped").quickJobType, "tempped");
});

// ── 2. job.createFromSimpro ─────────────────────────────────────────────────
await ok("planCreateFromSimpro: blankJob + the import stamps key for key; resi hint → no division key; address equal to the name → blank; data.id is the doc id; the candidates list without that one", () => {
  const p = JSU.planCreateFromSimpro({ simproId: "1500" }, J());
  assert.ok(!p.refused, p.refused);
  const expect = JS.blankJob(mint(NOW_MS)); Object.assign(expect, { name: "Stratton Residence", address: "", simproNo: "1500", customer: "Stratton Homes", simproBusinessGroup: "Residential", foreman: "Unassigned", _importedFromSimpro: true, imported_at: NOW });
  assert.deepStrictEqual(p.job, expect, "the import = blankJob() + the stamps, nothing else");
  assert.deepStrictEqual(Object.keys(p.job), [...BLANK_KEYS, "customer", "simproBusinessGroup", "_importedFromSimpro", "imported_at"]);
  assert.strictEqual(p.docId, p.job.id); assert.ok(ID.test(p.docId) && p.docId === String(NOW_MS + 1));
  assert.strictEqual(p.division, "resi"); assert.ok(!("division" in p.job));
  assert.deepStrictEqual(p.candidatesAfter.map(c => c.simproId), ["1501", "1502", "1438"]);
  // commercial hint → division:"commercial"; a real address kept
  const c = JSU.planCreateFromSimpro({ simproId: "1501" }, J());
  assert.strictEqual(c.job.division, "commercial"); assert.strictEqual(c.job.address, "88 Creek Rd, Alpine"); assert.strictEqual(c.division, "commercial");
  // temp ped and quick job kinds
  assert.strictEqual(JSU.planCreateFromSimpro({ simproId: "1500", kind: "tempped" }, J()).job.tempPed, true);
  const q = JSU.planCreateFromSimpro({ simproId: "1500", kind: "quick" }, J()); assert.strictEqual(q.job.quickJob, true); assert.deepStrictEqual(Object.keys(q.job), [...QUICK_KEYS, "customer", "simproBusinessGroup", "_importedFromSimpro", "imported_at"]);
  // no hint → division required (the device's mode in the app); the arg stands in; an ignored candidate still imports (said)
  assert.ok(/no Business Group hint/.test(JSU.planCreateFromSimpro({ simproId: "1502" }, J()).refused));
  const r = JSU.planCreateFromSimpro({ simproId: "1502", division: "commercial" }, J()); assert.strictEqual(r.job.division, "commercial"); assert.strictEqual(r.wasIgnored, true);
  assert.ok(!("division" in JSU.planCreateFromSimpro({ simproId: "1502", division: "resi" }, J()).job));
  // a hint beats the arg
  assert.ok(!("division" in JSU.planCreateFromSimpro({ simproId: "1500", division: "commercial" }, J()).job), "the Business Group hint wins over the arg, as the app's import does");
});
await ok("planCreateFromSimpro refusals: bad id, unknown kind, not in the inbox, no candidates list, Simpro # already on a live job (an archived one doesn't count)", () => {
  assert.ok(/simproId must be/.test(JSU.planCreateFromSimpro({ simproId: "abc" }, J()).refused));
  assert.ok(/kind must be/.test(JSU.planCreateFromSimpro({ simproId: "1500", kind: "service" }, J()).refused));
  assert.ok(/isn't in the Simpro inbox/.test(JSU.planCreateFromSimpro({ simproId: "9999" }, J()).refused));
  assert.ok(/no Simpro candidates list/.test(JSU.planCreateFromSimpro({ simproId: "1500" }, J(FORTH, null) && ctx({ candidates: null, conflicts: [] })).refused));
  assert.ok(/already belongs to Forth/.test(JSU.planCreateFromSimpro({ simproId: "1438" }, J()).refused), "simproNoConflict");
  const arch = ctx({ candidates: [{ simproId: "1441", name: "Gone again", divisionHint: "resi" }], conflicts: liveJobs(DOCS()) });
  assert.ok(!JSU.planCreateFromSimpro({ simproId: "1441" }, arch).refused, "an archived job's Simpro # is free again (the app's rule)");
});
await ok("handle job.createFromSimpro: tx.create on jobs/<data.id> with the app's {data, updated_at} envelope + the stamp (no lastActivityAt — the import's setDoc has none), the candidates doc updated with ONLY candidates + updated_at (divisionMismatches kept), the audit names both docs, every other doc untouched", async () => {
  const io = fakeIo();
  const r = await call(io, "job.createFromSimpro", { simproId: "#1501" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const created = writes(io, "create"); assert.strictEqual(created.length, 1); const [, pth, doc] = created[0];
  assert.strictEqual(pth, "jobs/" + r.body.jobId); assert.strictEqual(doc.data.id, r.body.jobId, "data.id === doc id (the loader keys by it)");
  assert.deepStrictEqual(Object.keys(doc).sort(), CREATE_ENVELOPE); assert.strictEqual(doc.updated_at, NOW); assert.strictEqual(doc.saved_by, "Duet (Koy)"); assert.ok(Number.isInteger(doc.app_build) && doc.app_build >= 608); assert.ok(new RegExp("^" + doc.app_build + "\\.duet").test(doc.w));
  const expect = JS.blankJob(mint(NOW_MS)); Object.assign(expect, { division: "commercial", name: "Battle Creek B", address: "88 Creek Rd, Alpine", simproNo: "1501", customer: "Creek LLC", simproBusinessGroup: "Commercial", foreman: "Unassigned", _importedFromSimpro: true, imported_at: NOW });
  assert.deepStrictEqual(doc.data, expect, "the written doc is blankJob() + the import fields, byte for byte");
  const cu = oneUpdate(io, "settings/simproCandidates"); assert.deepStrictEqual(Object.keys(cu).sort(), ["candidates", "updated_at"]); assert.deepStrictEqual(cu.candidates.map(c => c.simproId), ["1500", "1502", "1438"]); assert.strictEqual(cu.updated_at, NOW);
  assert.deepStrictEqual(io.store["settings/simproCandidates"].divisionMismatches, DOCS()["settings/simproCandidates"].divisionMismatches, "the other fields on the candidates doc survive (the app's setDoc would have dropped them)");
  assert.deepStrictEqual(r.body.follows.length, 5); assert.strictEqual(r.body.candidatesLeft, 3); assert.strictEqual(r.body.division, "commercial"); assert.strictEqual(r.body.foreman, "Unassigned");
  const au = auditOf(io, rid); assert.strictEqual(au.coll, "jobs"); assert.strictEqual(au.docId, r.body.jobId); assert.strictEqual(au.newDoc, true); assert.strictEqual(au.before, null); assert.strictEqual(au.after.simproNo, "1501"); assert.deepStrictEqual(au.docs, ["jobs/" + r.body.jobId, "settings/simproCandidates.candidates"]); assert.strictEqual(au.candidateRemoved, "1501");
  untouched(io, Object.keys(DOCS()).filter(k => k !== "settings/simproCandidates")); onlyAllowed(io);
});
await ok("handle job.createFromSimpro: a second write to an existing id is refused by tx.create (409, nothing overwritten, nothing else written); a conflict / unknown candidate audits a refusal and writes nothing", async () => {
  const io = fakeIo();
  io.store["jobs/" + String(NOW_MS + 1)] = DOC({ ...BASE(), id: String(NOW_MS + 1), name: "Already here", simproNo: "7777" });
  const r = await call(io, "job.createFromSimpro", { simproId: "1500" });
  assert.strictEqual(r.status, 409, JSON.stringify(r.body)); assert.ok(/already exists/.test(r.body.refused));
  assert.strictEqual(io.store["jobs/" + String(NOW_MS + 1)].data.name, "Already here", "nothing overwritten");
  assert.strictEqual(writes(io, "update").length, 0, "the candidates list was not rewritten (the whole transaction failed)");
  const c = await call(io, "job.createFromSimpro", { simproId: "1438" });
  assert.strictEqual(c.status, 400); assert.ok(/already belongs to Forth/.test(c.body.refused)); assert.strictEqual(writes(io, "create").length, 1, "no second create");
  const u = await call(io, "job.createFromSimpro", { simproId: "4242" }); assert.strictEqual(u.status, 400); assert.ok(/isn't in the Simpro inbox/.test(u.body.refused));
  delete io.store["settings/simproCandidates"];
  const m = await call(io, "job.createFromSimpro", { simproId: "1500" }); assert.strictEqual(m.status, 404); assert.ok(/no Simpro candidates list/.test(m.body.refused));
  const bad = await call(io, "job.createFromSimpro", { simproId: "x" }); assert.strictEqual(bad.status, 400);
  assert.ok(auditOf(io, rid).ok === false);
});

// ── 3. job.setInfo ──────────────────────────────────────────────────────────
await ok("planSetInfo: each text scalar writes the cleaned string; name never blank; a Site / Shared job's name is the project's; division commercial / resi → \"\" (the patch funnel's value); simproNo digits + conflict; noop when equal; one field; unknown field lists the allowed ones", () => {
  for (const f of ["address", "gc", "gcContact", "phone", "gcContact2", "phone2", "customer", "simproQuoteNo"]) { const p = JSU.planSetInfo({ field: f, value: "  New value\u0007 " }, J()); assert.deepStrictEqual(fields(p), { [f]: "New value" }, f); assert.deepStrictEqual(Object.keys(p.before), [f]); }
  assert.deepStrictEqual(fields(JSU.planSetInfo({ field: "name", value: "Forth Residence" }, J())), { name: "Forth Residence" });
  assert.ok(/can't be blank/.test(JSU.planSetInfo({ field: "name", value: "  " }, J()).refused));
  assert.ok(/Site \/ Shared/.test(JSU.planSetInfo({ field: "name", value: "X" }, J(SITE)).refused));
  assert.deepStrictEqual(fields(JSU.planSetInfo({ field: "division", value: "commercial" }, J())), { division: "commercial" });
  const resi = JSU.planSetInfo({ field: "division", value: "resi" }, J(COMM)); assert.deepStrictEqual(fields(resi), { division: "" }); assert.strictEqual(resi.result.to, "resi");
  assert.ok(JSU.planSetInfo({ field: "division", value: "resi" }, J()).noop, "\"residential\" on the doc reads as resi already");
  assert.ok(/commercial or resi/.test(JSU.planSetInfo({ field: "division", value: "multi" }, J()).refused));
  assert.deepStrictEqual(fields(JSU.planSetInfo({ field: "simproNo", value: "#1999" }, J())), { simproNo: "1999" });
  assert.ok(/already belongs to Clean/.test(JSU.planSetInfo({ field: "simproNo", value: "1440" }, J()).refused));
  assert.ok(/already belongs to Fratto Farms · Site/.test(JSU.planSetInfo({ field: "simproNo", value: "1482" }, J()).refused), "a project's shared # outside the project conflicts");
  assert.ok(!JSU.planSetInfo({ field: "simproNo", value: "1482" }, J(HOUSE1, { simproNo: "" })).refused, "inside the same project the shared # is fine (simproNoConflict's pid rule)");
  assert.ok(/digits/.test(JSU.planSetInfo({ field: "simproNo", value: "12a" }, J()).refused));
  assert.deepStrictEqual(fields(JSU.planSetInfo({ field: "simproNo", value: "" }, J())), { simproNo: "" });
  assert.ok(JSU.planSetInfo({ field: "gc", value: "Acme Builders" }, J()).noop);
  assert.ok(/field must be one of/.test(JSU.planSetInfo({ field: "gcContacts", value: "x" }, J()).refused));
  assert.ok(/field must be one of/.test(JSU.planSetInfo({ field: "foreman", value: "x" }, J()).refused), "people are cc_set_job_people's");
  assert.ok(/archived/.test(JSU.planSetInfo({ field: "gc", value: "x" }, J(GONE)).refused));
  assert.ok(/must be text/.test(JSU.planSetInfo({ field: "gc", value: { a: 1 } }, J()).refused));
});
await ok("planSetInfo gcContactLead / gcContactLead2: the app's taps, composed — pick mirrors name + phone into the boxes, clearing slot 1 promotes slot 2, a third contact never bumps anyone, unknown id lists the contacts", () => {
  // empty slots: pick c11 → slot 1 + boxes
  let p = JSU.planSetInfo({ field: "gcContactLead", value: "c11" }, J());
  assert.deepStrictEqual(fields(p), { gcContactLead: "c11", gcContact: "Gina Super", phone: "801-555-0111" }); assert.deepStrictEqual(p.result.taps, ["c11"]); assert.deepStrictEqual(p.result.mirrored, ["gcContact", "phone"]);
  // slot 1 = c11: pick c12 for slot 2
  const one = J(FORTH, { gcContactLead: "c11", gcContact: "Gina Super", phone: "801-555-0111" });
  p = JSU.planSetInfo({ field: "gcContactLead2", value: "c12" }, one);
  assert.deepStrictEqual(fields(p), { gcContactLead2: "c12", gcContact2: "Paul PM", phone2: "801-555-0112" });
  // slot 2 before slot 1 → refused (the tap would land in slot 1)
  assert.ok(/first running-contact slot is empty/.test(JSU.planSetInfo({ field: "gcContactLead2", value: "c12" }, J()).refused));
  // both set: change slot 1 to c13 → clear 2, clear 1, tap c13, put c12 back (four taps; same result the app reaches)
  const both = J(FORTH, { gcContactLead: "c11", gcContact: "Gina Super", phone: "801-555-0111", gcContactLead2: "c12", gcContact2: "Paul PM", phone2: "801-555-0112" });
  p = JSU.planSetInfo({ field: "gcContactLead", value: "c13" }, both);
  assert.deepStrictEqual(fields(p), { gcContactLead: "c13", gcContact: "Dee Owner", phone: "801-555-0113" }); assert.deepStrictEqual(p.result.taps, ["c12", "c11", "c13", "c12"]);
  // both set: slot 1 := the slot-2 contact → the clear promotes it (two becomes one, slot 2 empties)
  p = JSU.planSetInfo({ field: "gcContactLead", value: "c12" }, both);
  assert.deepStrictEqual(fields(p), { gcContactLead: "c12", gcContactLead2: "", gcContact: "Paul PM", phone: "801-555-0112", gcContact2: "", phone2: "" }); assert.deepStrictEqual(p.result.taps, ["c11"]);
  // clear slot 1 with a second set → promotion (gcRunningToggle's own rule)
  p = JSU.planSetInfo({ field: "gcContactLead", value: "" }, both);
  assert.deepStrictEqual(fields(p), { gcContactLead: "c12", gcContactLead2: "", gcContact: "Paul PM", phone: "801-555-0112", gcContact2: "", phone2: "" });
  // clear slot 1 alone → only the id clears, the typed boxes stay (as it always did)
  p = JSU.planSetInfo({ field: "gcContactLead", value: "" }, one); assert.deepStrictEqual(fields(p), { gcContactLead: "" });
  // clear slot 2
  p = JSU.planSetInfo({ field: "gcContactLead2", value: "" }, both); assert.deepStrictEqual(fields(p), { gcContactLead2: "" });
  // slot 2 := the slot-1 contact → refused; same value → noop; unknown id → the list
  assert.ok(/already the first running contact/.test(JSU.planSetInfo({ field: "gcContactLead2", value: "c11" }, both).refused));
  assert.ok(JSU.planSetInfo({ field: "gcContactLead", value: "c11" }, both).noop); assert.ok(JSU.planSetInfo({ field: "gcContactLead", value: "" }, J()).noop);
  const bad = JSU.planSetInfo({ field: "gcContactLead", value: "c99" }, J()); assert.ok(/isn't a contact/.test(bad.refused) && /c11 \(Gina Super, Site super\)/.test(bad.refused) && /c13 \(Dee Owner\)/.test(bad.refused));
  assert.ok(/pull the job from Simpro first/.test(JSU.planSetInfo({ field: "gcContactLead", value: "c1" }, J(CLEAN)).refused));
  // a contact keyed by email / name / index when it has no id (gcContactKey's fallback)
  const noIds = J(FORTH, { gcContacts: [{ name: "Only Name", phone: "1" }, { email: "e@x", phone: "2" }] });
  assert.deepStrictEqual(fields(JSU.planSetInfo({ field: "gcContactLead", value: "e@x" }, noIds)), { gcContactLead: "e@x", phone: "2" }, "gcContact stays \"\" → not rewritten");
});
await ok("handle job.setInfo: ONE jobs/<id> update with the dotted field + the 608 envelope, before / after in the audit, the rest byte-identical; simproNo runs the conflict query first", async () => {
  const io = fakeIo();
  const r = await call(io, "job.setInfo", { jobId: FORTH, field: "gc", value: "Acme Builders Inc" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = oneUpdate(io, "jobs/" + FORTH); checkStamp(upd); assert.deepStrictEqual(dataKeys(upd), ["gc"]); assert.strictEqual(upd["data.gc"], "Acme Builders Inc");
  assert.deepStrictEqual(r.body.changed, ["gc"]); assert.strictEqual(r.body.from, "Acme Builders");
  const au = auditOf(io, rid); assert.deepStrictEqual(au.before, { gc: "Acme Builders" }); assert.deepStrictEqual(au.after, { gc: "Acme Builders Inc" }); assert.deepStrictEqual(au.fields, ["gc"]);
  restIdentical(io, "jobs/" + FORTH, ["gc"]); untouched(io, Object.keys(DOCS()).filter(k => k !== "jobs/" + FORTH));
  const s = await call(io, "job.setInfo", { jobId: FORTH, field: "simproNo", value: "1440" });
  assert.strictEqual(s.status, 400); assert.ok(/already belongs to Clean/.test(s.body.refused)); assert.ok(io.log.some(l => l[0] === "query" && l[1] === "jobs?data.simproNo=1440"), "the conflict query ran");
  const nn = await call(io, "job.setInfo", { jobId: FORTH, field: "gc", value: "Acme Builders Inc" }); assert.strictEqual(nn.body.noop, true);
  const missing = await call(io, "job.setInfo", { jobId: "1700000000999", field: "gc", value: "x" }); assert.strictEqual(missing.status, 404);
  onlyAllowed(io);
});

// ── 4. job.setSection ───────────────────────────────────────────────────────
await ok("planSetSection: hiddenSections spread + the legacy flag (top-level for panelized / tapeLight, ONE dotted panelizedLighting key for keypads / techLighting); commercial keys only on commercial jobs; techLighting Lutron-only; noop reads the legacy flag; unknown key lists this job's sections", () => {
  let p = JSU.planSetSection({ key: "generator", hidden: true }, J());
  assert.deepStrictEqual(fields(p), { hiddenSections: { generator: true } }); assert.deepStrictEqual(p.before, { hiddenSections: null }); assert.strictEqual(p.result.legacyFlag, null);
  p = JSU.planSetSection({ key: "panelized", hidden: true }, J(FORTH, { hiddenSections: { generator: true } }));
  assert.deepStrictEqual(fields(p), { hiddenSections: { generator: true, panelized: true }, noPanelizedLighting: true }); assert.deepStrictEqual(p.before, { hiddenSections: { generator: true }, noPanelizedLighting: null });
  p = JSU.planSetSection({ key: "tapeLight", hidden: true }, J()); assert.deepStrictEqual(fields(p), { hiddenSections: { tapeLight: true }, noTapeLight: true });
  p = JSU.planSetSection({ key: "keypads", hidden: true }, J());
  assert.deepStrictEqual(fields(p), { hiddenSections: { keypads: true }, "panelizedLighting.noKeypadLoads": true }); assert.strictEqual(p.result.legacyFlag, "panelizedLighting.noKeypadLoads"); assert.strictEqual(p.result.parent, "panelized"); assert.strictEqual(p.result.parentHidden, false);
  assert.deepStrictEqual(JS.jobSectionPatch(J().job.data, "keypads", true).panelizedLighting.loads, [{ id: "L1", name: "Kitchen cans" }], "the app's patch spreads the map — the server writes the one flag instead, same resulting doc");
  p = JSU.planSetSection({ key: "techLighting", hidden: true }, J()); assert.deepStrictEqual(fields(p), { hiddenSections: { techLighting: true }, "panelizedLighting.excludeFromLutronHub": true });
  assert.ok(/only applies to Lutron jobs/.test(JSU.planSetSection({ key: "techLighting", hidden: true }, J(CLEAN)).refused));
  // turn back on; noop reads the legacy flag as the source of truth
  p = JSU.planSetSection({ key: "panelized", hidden: false }, J(FORTH, { noPanelizedLighting: true })); assert.deepStrictEqual(fields(p), { hiddenSections: { panelized: false }, noPanelizedLighting: false });
  assert.ok(JSU.planSetSection({ key: "panelized", hidden: true }, J(FORTH, { noPanelizedLighting: true })).noop, "legacy flag already set → noop even with no hiddenSections");
  assert.ok(JSU.planSetSection({ key: "generator", hidden: false }, J()).noop);
  // commercial vs residential lists
  const bad = JSU.planSetSection({ key: "commPower", hidden: true }, J()); assert.ok(/residential job has: /.test(bad.refused) && /panelized \(Panelized Lighting\)/.test(bad.refused) && /keypads \(Keypads, under panelized\)/.test(bad.refused) && !/commPower/.test(bad.refused.split("has: ")[1]));
  assert.deepStrictEqual(fields(JSU.planSetSection({ key: "commPower", hidden: true }, J(COMM))), { hiddenSections: { commPower: true } });
  assert.ok(/commercial job has/.test(JSU.planSetSection({ key: "generator", hidden: true }, J(COMM)).refused));
  assert.ok(/hidden must be/.test(JSU.planSetSection({ key: "generator", hidden: "yes" }, J()).refused));
  assert.ok(/key must be/.test(JSU.planSetSection({ key: "nope", hidden: true }, J()).refused));
  assert.ok(/archived/.test(JSU.planSetSection({ key: "generator", hidden: true }, J(GONE)).refused));
});
await ok("handle job.setSection: the dotted keys (hiddenSections + panelizedLighting.noKeypadLoads) on ONE update, loads untouched, the audit holds every field before / after", async () => {
  const io = fakeIo();
  const r = await call(io, "job.setSection", { jobId: FORTH, key: "keypads", hidden: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = oneUpdate(io, "jobs/" + FORTH); checkStamp(upd); assert.deepStrictEqual(dataKeys(upd), ["hiddenSections", "panelizedLighting.noKeypadLoads"]);
  assert.deepStrictEqual(io.store["jobs/" + FORTH].data.panelizedLighting.loads, [{ id: "L1", name: "Kitchen cans" }]); assert.strictEqual(io.store["jobs/" + FORTH].data.panelizedLighting.noKeypadLoads, true);
  const au = auditOf(io, rid); assert.deepStrictEqual(au.before, { hiddenSections: null, "panelizedLighting.noKeypadLoads": null }); assert.deepStrictEqual(au.after, { hiddenSections: { keypads: true }, "panelizedLighting.noKeypadLoads": true });
  restIdentical(io, "jobs/" + FORTH, ["hiddenSections", "panelizedLighting"]); onlyAllowed(io);
});

// ── 5. job.archive ──────────────────────────────────────────────────────────
await ok("planArchive: Duet's reversible shape; refused on open punch (slots applied) / open COs / open trips without force, listing them; force archives and says so; unarchive clears the three; noop; deleted refused; archivedAt alone counts as archived", () => {
  const g = JSU.planArchive({ archived: true }, J());
  assert.ok(/1 open punch item; 1 open change order \(#c1 approved\); 1 open return trip \(#r1 needs\)/.test(g.refused) && /force:true/.test(g.refused), g.refused);
  const slot = J(FORTH, { punchTicks: { pu1: { done: true, by: "Koy", at: "11/3/2026", ts: NOW } }, changeOrders: [], returnTrips: [] });
  assert.ok(!JSU.planArchive({ archived: true }, slot).refused, "a check-off slot closes the open item (applyPunchTicks)");
  let p = JSU.planArchive({ archived: true, force: true }, J());
  assert.deepStrictEqual(fields(p), { archived: true, archivedAt: NOW, archivedBy: "Koy" }); assert.deepStrictEqual(p.before, { archived: null, archivedAt: null, archivedBy: null }); assert.strictEqual(p.result.forced, true); assert.strictEqual(p.result.openWork.punch, 1);
  p = JSU.planArchive({ archived: true }, J(CLEAN)); assert.deepStrictEqual(fields(p), { archived: true, archivedAt: NOW, archivedBy: "Koy" }); assert.strictEqual(p.result.forced, undefined);
  p = JSU.planArchive({ archived: false }, J(GONE)); assert.deepStrictEqual(fields(p), { archived: false, archivedAt: "", archivedBy: "" }); assert.strictEqual(p.result.wasArchivedBy, "Koy");
  assert.ok(JSU.planArchive({ archived: true }, J(GONE)).noop); assert.ok(JSU.planArchive({ archived: false }, J(CLEAN)).noop);
  assert.ok(JSU.planArchive({ archived: true }, J(CLEAN, { archivedAt: "2026-01-01T00:00:00.000Z" })).noop, "archivedAt alone = archived (isInactiveJob's rule)");
  assert.ok(/deleted/.test(JSU.planArchive({ archived: true }, J(CLEAN, { deleted: true })).refused));
  assert.ok(/archived must be/.test(JSU.planArchive({ archived: "yes" }, J(CLEAN)).refused));
  assert.ok(!JSON.stringify(fields(JSU.planArchive({ archived: true }, J(CLEAN)))).includes("deleted"), "never `deleted`");
});
await ok("handle job.archive + unarchive: the three fields on ONE update each, round-trips to the original, works ON an archived job (the one exception to the archived gate), the audit holds before / after", async () => {
  const io = fakeIo();
  const r = await call(io, "job.archive", { jobId: CLEAN, archived: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = oneUpdate(io, "jobs/" + CLEAN); checkStamp(upd); assert.deepStrictEqual(dataKeys(upd), ["archived", "archivedAt", "archivedBy"]); assert.strictEqual(upd["data.archivedBy"], "Koy");
  assert.strictEqual(io.store["jobs/" + CLEAN].data.archived, true);
  const edit = await call(io, "job.setInfo", { jobId: CLEAN, field: "gc", value: "x" }); assert.strictEqual(edit.status, 400); assert.ok(/archived/.test(edit.body.refused) && /cc_archive_job with archived:false/.test(edit.body.refused));
  const back = await call(io, "job.archive", { jobId: CLEAN, archived: false });
  assert.strictEqual(back.status, 200); assert.strictEqual(io.store["jobs/" + CLEAN].data.archived, false); assert.strictEqual(io.store["jobs/" + CLEAN].data.archivedAt, ""); assert.strictEqual(io.store["jobs/" + CLEAN].data.archivedBy, "");
  const au = auditOf(io, rid); assert.deepStrictEqual(au.before, { archived: true, archivedAt: NOW, archivedBy: "Koy" }); assert.deepStrictEqual(au.after, { archived: false, archivedAt: "", archivedBy: "" });
  restIdentical(io, "jobs/" + CLEAN, ["archived", "archivedAt", "archivedBy"]);
  const guard = await call(io, "job.archive", { jobId: FORTH, archived: true }); assert.strictEqual(guard.status, 400); assert.ok(/force:true/.test(guard.body.refused)); assert.strictEqual(writes(io, "update", "jobs/" + FORTH).length, 0);
  onlyAllowed(io);
});

// ── 6. projects ─────────────────────────────────────────────────────────────
await ok("planCreateProject: the project literal + the Site / Shared patch; refused on a quote / temp ped / quick job, a job already in a project, a blank name, a live same-division duplicate name", () => {
  const p = JSU.planCreateProject({ jobId: FORTH, name: "  Forth Estates " }, J());
  assert.ok(!p.refused, p.refused);
  assert.deepStrictEqual(p.project, { id: "prj_" + String(NOW_MS + 1), name: "Forth Estates", division: "", gc: "Acme Builders", address: "1 Main", notes: "", simproNo: "1438", createdAt: NOW, createdBy: "Koy" });
  assert.deepStrictEqual(p.jobPatch, { projectGroupId: p.project.id, projectRole: "site", simproFolder: "", name: "Forth Estates · Site / Shared" });
  assert.deepStrictEqual(p.before, { projectGroupId: null, projectRole: null, simproFolder: null, name: "Forth" });
  assert.strictEqual(JSU.planCreateProject({ jobId: COMM, name: "BC" }, J(COMM)).project.division, "commercial");
  assert.ok(/quote/.test(JSU.planCreateProject({ name: "Q" }, J(QUOTE)).refused));
  assert.ok(/temp ped/.test(JSU.planCreateProject({ name: "T" }, J(CLEAN, { tempPed: true })).refused));
  assert.ok(/quick job/.test(JSU.planCreateProject({ name: "T" }, J(CLEAN, { quickJob: true })).refused));
  assert.ok(/already in project prj_/.test(JSU.planCreateProject({ name: "T" }, J(HOUSE1)).refused));
  assert.ok(/name is the project's name/.test(JSU.planCreateProject({ name: " " }, J()).refused));
  assert.ok(/already exists \(prj_1772863862700\)/.test(JSU.planCreateProject({ name: "fratto farms" }, J()).refused));
  assert.ok(!JSU.planCreateProject({ name: "Fratto Farms" }, J(FORTH, null) && ctx({ job: J().job, projects: [{ ...PROJECT(), archived: true }] })).refused, "an archived project's name is free");
});
await ok("handle project.create: tx.create on projects/prj_<id> with the app's envelope AND the job's Site / Shared patch in the SAME transaction; the audit names both docs; a repeat on the now-Site job refuses", async () => {
  const io = fakeIo();
  const r = await call(io, "project.create", { jobId: FORTH, name: "Forth Estates" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const created = writes(io, "create"); assert.strictEqual(created.length, 1); assert.strictEqual(created[0][1], "projects/" + r.body.projectId);
  assert.deepStrictEqual(Object.keys(created[0][2]).sort(), CREATE_ENVELOPE); assert.strictEqual(created[0][2].data.createdBy, "Koy"); assert.strictEqual(created[0][2].data.simproNo, "1438");
  const upd = oneUpdate(io, "jobs/" + FORTH); checkStamp(upd); assert.deepStrictEqual(dataKeys(upd), ["name", "projectGroupId", "projectRole", "simproFolder"]); assert.strictEqual(upd["data.name"], "Forth Estates · Site / Shared"); assert.strictEqual(upd["data.projectRole"], "site");
  assert.strictEqual(r.body.siteJobName, "Forth Estates · Site / Shared"); assert.strictEqual(r.body.wasName, "Forth");
  const au = auditOf(io, rid); assert.strictEqual(au.coll, "projects"); assert.strictEqual(au.newDoc, true); assert.deepStrictEqual(au.docs, ["projects/" + r.body.projectId, "jobs/" + FORTH]); assert.deepStrictEqual(au.job.before, { projectGroupId: null, projectRole: null, simproFolder: null, name: "Forth" });
  restIdentical(io, "jobs/" + FORTH, ["name", "projectGroupId", "projectRole", "simproFolder"]);
  const again = await call(io, "project.create", { jobId: FORTH, name: "Forth Estates 2" }); assert.strictEqual(again.status, 400); assert.ok(/already in project/.test(again.body.refused)); assert.strictEqual(writes(io, "create").length, 1);
  onlyAllowed(io);
});
await ok("planPatchProject: simproNo (conflict outside the project) / notes / archived (+ archivedBy + archivedAt, the app's shape; unarchive clears) — one per call; noop; archived project refuses edits; missing project", () => {
  let p = JSU.planPatchProject({ simproNo: "#1490" }, J()); assert.deepStrictEqual(p.patch, { simproNo: "1490" }); assert.deepStrictEqual(p.before, { simproNo: "1482" });
  assert.ok(/already belongs to Forth outside this project/.test(JSU.planPatchProject({ simproNo: "1438" }, J()).refused));
  assert.ok(!JSU.planPatchProject({ simproNo: "1482" }, J()).refused === false || JSU.planPatchProject({ simproNo: "1482" }, J()).noop, "same value → noop");
  p = JSU.planPatchProject({ notes: " Gate code 1234\n" }, J()); assert.deepStrictEqual(p.patch, { notes: "Gate code 1234" });
  p = JSU.planPatchProject({ archived: true }, J()); assert.deepStrictEqual(p.patch, { archived: true, archivedBy: "Koy", archivedAt: NOW }); assert.ok(/No job and nothing inside a job is deleted/.test(p.result.note));
  p = JSU.planPatchProject({ archived: false }, ctx({ project: { ...PROJECT(), archived: true, archivedBy: "Koy", archivedAt: "x" } })); assert.deepStrictEqual(p.patch, { archived: false, archivedBy: "", archivedAt: "" });
  assert.ok(/exactly one of/.test(JSU.planPatchProject({ notes: "a", simproNo: "1" }, J()).refused)); assert.ok(/exactly one of/.test(JSU.planPatchProject({}, J()).refused));
  assert.ok(/is archived/.test(JSU.planPatchProject({ notes: "a" }, ctx({ project: { ...PROJECT(), archived: true } })).refused));
  assert.ok(/doesn't exist/.test(JSU.planPatchProject({ notes: "a" }, ctx({ project: null })).refused));
  assert.ok(/digits/.test(JSU.planPatchProject({ simproNo: "x1" }, J()).refused));
});
await ok("handle project.patch: ONE projects/<id> update — dotted data.<k> + updated_at (strictly newer) + saved_by + the stamp (patchProject's envelope), the rest of the project untouched", async () => {
  const io = fakeIo();
  const r = await call(io, "project.patch", { projectId: PRJ, notes: "Gate code 1234" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = oneUpdate(io, "projects/" + PRJ); assert.deepStrictEqual(Object.keys(upd).sort(), ["app_build", "data.notes", "device", "saved_by", "tab", "updated_at", "w"]); assert.ok(Date.parse(upd.updated_at) > Date.parse("2026-10-29T15:00:00.000Z"));
  assert.deepStrictEqual(io.store["projects/" + PRJ].data, { ...PROJECT(), notes: "Gate code 1234" });
  const a = await call(io, "project.patch", { projectId: PRJ, archived: true }); assert.strictEqual(a.status, 200); assert.strictEqual(writes(io, "update", "projects/" + PRJ).length, 2);
  assert.strictEqual(io.store["projects/" + PRJ].data.archived, true); assert.strictEqual(io.store["projects/" + PRJ].data.archivedBy, "Koy");
  const bad = await call(io, "project.patch", { projectId: "nope", notes: "x" }); assert.strictEqual(bad.status, 400); assert.ok(/prj_/.test(bad.body.refused));
  const gone = await call(io, "project.patch", { projectId: "prj_1700000000000", notes: "x" }); assert.strictEqual(gone.status, 404);
  onlyAllowed(io); untouched(io, Object.keys(DOCS()).filter(k => k !== "projects/" + PRJ));
});
await ok("planCreateBuilding: createBuilding line for line — shared Simpro # + folder (no lead while one exists; lead when none), own # conflict, duplicate short name, the copied fields from the Site job, the foreman, hiddenSections + legacy flags, division from the project", () => {
  let p = JSU.planCreateBuilding({ name: "House 2", shareSimpro: true }, J());
  assert.ok(!p.refused, p.refused);
  const j = p.job;
  assert.strictEqual(j.name, "Fratto Farms · House 2"); assert.strictEqual(j.projectGroupId, PRJ); assert.strictEqual(j.simproNo, "1482"); assert.strictEqual(j.simproFolder, "House 2"); assert.ok(!("simproLead" in j), "House 1 already leads the shared #");
  assert.strictEqual(j.foreman, "Colby", "the Site job's foreman"); assert.strictEqual(j.gcContactLead, "c11"); assert.strictEqual(j.gcContact, undefined, "gcContact (the typed box) is NOT in createBuilding's copy list — only the lead id is, as the app does"); assert.strictEqual(j.address, "1 Main"); assert.deepStrictEqual(j.gcContacts, CONTACTS); assert.strictEqual(j.customer, undefined, "no customer anywhere → not set");
  assert.ok(!("division" in j)); assert.deepStrictEqual(j.hiddenSections, {}); assert.strictEqual(j.id, String(NOW_MS + 1)); assert.strictEqual(p.docId, j.id);
  const keys = Object.keys(j); for (const k of BLANK_KEYS) assert.ok(keys.includes(k), "blank key " + k);
  // no joinable sibling with the shared # → this one leads
  // the Site / Shared job is joinable and carries the shared # (so House 2 above never leads); without it, a non-lead House 1 is not joinable → this one leads
  const noLead = ctx({ project: PROJECT(), siblings: liveJobs(DOCS()).filter(x => x.id !== SITE).map(x => x.id === HOUSE1 ? { ...x, simproLead: false } : x) });
  assert.strictEqual(JSU.planCreateBuilding({ name: "House 2", shareSimpro: true, simproFolder: "H2 folder" }, noLead).job.simproLead, true);
  assert.strictEqual(JSU.planCreateBuilding({ name: "House 2", shareSimpro: true, simproFolder: "H2 folder" }, noLead).job.simproFolder, "H2 folder");
  // own number
  p = JSU.planCreateBuilding({ name: "Clubhouse", ownSimproNo: "#1600" }, J()); assert.strictEqual(p.job.simproNo, "1600"); assert.strictEqual(p.job.simproFolder, ""); assert.ok(!("simproLead" in p.job));
  assert.ok(/already belongs to Forth/.test(JSU.planCreateBuilding({ name: "Clubhouse", ownSimproNo: "1438" }, J()).refused));
  assert.ok(/already has a house 1/.test(JSU.planCreateBuilding({ name: "house 1", shareSimpro: true }, J()).refused), "the app names the short name as typed");
  assert.ok(/Name the building/.test(JSU.planCreateBuilding({ name: " " }, J()).refused));
  assert.ok(/no Simpro # to share/.test(JSU.planCreateBuilding({ name: "X", shareSimpro: true }, ctx({ project: { ...PROJECT(), simproNo: "" }, siblings: [] })).refused));
  // hidden sections + legacy flags; keys limited to the division's top-level switches
  p = JSU.planCreateBuilding({ name: "House 3", shareSimpro: true, hiddenSections: { panelized: true, generator: true, tapeLight: false } }, J());
  assert.deepStrictEqual(p.job.hiddenSections, { panelized: true, generator: true, tapeLight: false }); assert.strictEqual(p.job.noPanelizedLighting, true); assert.ok(!("noTapeLight" in p.job), "a false switch writes no legacy flag (the app's filter)");
  assert.ok(/hiddenSections keys for a residential building must be among/.test(JSU.planCreateBuilding({ name: "H", shareSimpro: true, hiddenSections: { commPower: true } }, J()).refused));
  assert.ok(/true\/false/.test(JSU.planCreateBuilding({ name: "H", shareSimpro: true, hiddenSections: { generator: "x" } }, J()).refused));
  // commercial project → division commercial + commercial keys
  const cp = ctx({ project: { ...PROJECT(), id: "prj_1772863862701", name: "Creek", division: "commercial", simproNo: "1450" }, siblings: [], conflicts: [] });
  p = JSU.planCreateBuilding({ name: "Bldg C", shareSimpro: true, hiddenSections: { commRfis: true } }, cp); assert.strictEqual(p.job.division, "commercial"); assert.strictEqual(p.job.foreman, "Unassigned"); assert.strictEqual(p.job.simproLead, true); assert.deepStrictEqual(p.job.hiddenSections, { commRfis: true });
  assert.ok(/is archived/.test(JSU.planCreateBuilding({ name: "X" }, ctx({ project: { ...PROJECT(), archived: true } })).refused));
});
await ok("handle project.createBuilding: tx.create on jobs/<data.id> after the sibling + conflict queries; a repeat with the same name refuses (duplicate short name) and the first doc stands", async () => {
  const io = fakeIo();
  const r = await call(io, "project.createBuilding", { projectId: PRJ, name: "House 2", shareSimpro: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const created = writes(io, "create"); assert.strictEqual(created.length, 1); assert.strictEqual(created[0][1], "jobs/" + r.body.jobId); assert.strictEqual(created[0][2].data.id, r.body.jobId);
  assert.deepStrictEqual(Object.keys(created[0][2]).sort(), CREATE_ENVELOPE); assert.strictEqual(created[0][2].data.name, "Fratto Farms · House 2"); assert.strictEqual(r.body.buildingsNow, 3); assert.deepStrictEqual(r.body.copiedFrom, { jobId: SITE, name: "Fratto Farms · Site / Shared" });
  assert.ok(io.log.some(l => l[0] === "query" && l[1] === "jobs?data.projectGroupId=" + PRJ), "siblings read under the transaction");
  const au = auditOf(io, rid); assert.strictEqual(au.newDoc, true); assert.strictEqual(au.projectId, PRJ); assert.strictEqual(au.after.simproLead, false); assert.deepStrictEqual(au.after.copied, ["address", "gc", "phone", "gcContacts", "gcContactLead", "gcContactLabels"], "pick(): a blank on the Site job falls back to the project record, which has no such key → not copied (the app's rule)");
  const dup = await call(io, "project.createBuilding", { projectId: PRJ, name: "house 2", shareSimpro: true }); assert.strictEqual(dup.status, 400); assert.ok(/already has a house 2/.test(dup.body.refused)); assert.strictEqual(writes(io, "create").length, 1);
  untouched(io, Object.keys(DOCS())); onlyAllowed(io);
});
await ok("planJoinProject + handle project.join: the four-field patch; same division only; not already in a project; not a quote / temp ped / quick job; the shared-# note; noop when already in it", async () => {
  const p = JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), FORTH), project: PROJECT() }));
  assert.deepStrictEqual(fields(p), { projectGroupId: PRJ, projectRole: "", simproLead: false, simproFolder: "" }); assert.deepStrictEqual(p.before, { projectGroupId: null, projectRole: null, simproLead: null, simproFolder: null }); assert.strictEqual(p.result.sharesSimpro, false);
  assert.strictEqual(JSU.planJoinProject({}, ctx({ job: { id: CLEAN, data: { ...DOCS()["jobs/" + CLEAN].data, simproNo: "1482" } }, project: PROJECT() })).result.sharesSimpro, true);
  assert.ok(/commercial/.test(JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), COMM), project: PROJECT() })).refused));
  assert.ok(/already in project/.test(JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), FORTH), project: { ...PROJECT(), id: "prj_1772863862701" } }) && ctx({ job: jobOf(DOCS(), HOUSE1), project: { ...PROJECT(), id: "prj_1772863862701" } })).refused));
  assert.ok(JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), HOUSE1), project: PROJECT() })).noop);
  assert.ok(/quote/.test(JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), QUOTE), project: PROJECT() })).refused));
  assert.ok(/is archived/.test(JSU.planJoinProject({}, ctx({ job: jobOf(DOCS(), FORTH), project: { ...PROJECT(), archived: true } })).refused));
  const io = fakeIo();
  const r = await call(io, "project.join", { jobId: FORTH, projectId: PRJ });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = oneUpdate(io, "jobs/" + FORTH); checkStamp(upd); assert.deepStrictEqual(dataKeys(upd), ["projectGroupId", "projectRole", "simproFolder", "simproLead"]);
  assert.strictEqual(auditOf(io, rid).projectId, PRJ); restIdentical(io, "jobs/" + FORTH, ["projectGroupId", "projectRole", "simproFolder", "simproLead"]); onlyAllowed(io);
});

// ── 7. api.js wiring ────────────────────────────────────────────────────────
await ok("api.js: the eight ship-9 actions are routed by jobSetup(), not jobWrite(); BUILD 608; SETTINGS_DOCS gains ONLY simproCandidates.candidates (settings/users still refused); still no tx.delete and exactly three .delete(; replay of a requestId answers the same without a second create", async () => {
  assert.deepStrictEqual(api.JOB_SETUP_ACTIONS, ["job.createFromSimpro", "job.setInfo", "job.setSection", "job.archive", "project.create", "project.patch", "project.createBuilding", "project.join"]);
  for (const a of api.JOB_SETUP_ACTIONS) assert.ok(api.ACTIONS.includes(a) && !api.JOB_WRITE_ACTIONS.includes(a));
  assert.ok(api.BUILD >= 608);   // ship 10 bumped it to 609
  assert.deepStrictEqual(api.SETTINGS_DOCS, { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: ["teams"], simproCandidates: ["candidates"], crewRoster: ["names"], upcoming_jobs: ["items", "updated_at"] });   // ship 10: crewTeams now written (teams), crewRoster.names, upcoming_jobs.items (+ the pipeline's updated_at)
  assert.ok(api.settingsDocAllowed("simproCandidates") && !api.settingsDocAllowed("users") && !api.settingsDocAllowed("main"));
  const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
  assert.ok(!/tx\.delete\(/.test(src), "no tx.delete in api.js"); assert.strictEqual((src.match(/\.delete\(/g) || []).length, 3, "exactly three .delete( (Storage cleanup, versions prune, the planner cell sentinel)");
  assert.strictEqual((src.match(/tx\.create\(/g) || []).length, 5, "five tx.create: the task, the import, the project, the building, the promoted auto task (ship 10)");
  assert.ok(!/require\((?!"\.\.\/jobShape\.js"|"\.\.\/punchTicks\.js"|"\.\/punch\.js"|"\.\/needs\.js")/.test(fs.readFileSync(path.join(root, "functions", "duetWrites", "jobSetup.js"), "utf8")), "jobSetup.js requires no Firebase");
  const io = fakeIo();
  const first = await api.handle({ requestId: RID(777), action: "job.createFromSimpro", args: { simproId: "1500" } }, io);
  const again = await api.handle({ requestId: RID(777), action: "job.createFromSimpro", args: { simproId: "1500" } }, io);
  assert.strictEqual(first.status, 200); assert.strictEqual(again.body.replayed, true); assert.strictEqual(again.body.jobId, first.body.jobId); assert.strictEqual(writes(io, "create").length, 1, "idempotent: one create");
  assert.ok(src.includes("'simproCandidates'") || src.includes('simproCandidates: ["candidates"]'));
  const pre = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.prebuild;
  assert.ok(pre.includes("node scripts/job-shape-sync.js") && pre.includes("node scripts/duet-jobsetup-test.js"), "both in the prebuild");
});

console.log(`duet-jobsetup-test: ${n} checks passed`);
})().catch((e) => { console.error("duet-jobsetup-test FAILED:", e && e.stack || e); process.exit(1); });
