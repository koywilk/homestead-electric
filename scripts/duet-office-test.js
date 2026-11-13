#!/usr/bin/env node
/* duet-office-test.js — Duet write access (connector D9), ship 10: the office
 * actions — announcements, My Day auto-task promotion, plan-intake decisions,
 * the Upcoming pipeline, crew teams and the crew roster.
 *
 * Drives functions/duetWrites/office.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction plus a fake of the app's own sendBroadcastAs and of the
 * watcher's decideById, and pins the parts that must equal App.js / index.js /
 * watcher.js text. Proves: autoTaskDoc / autoDelegation / parseAnyDate /
 * localYmd are App.js's text verbatim; the auto-task id catalog is the task
 * engine's (every fixed suffix, every templated-id pattern, every literal
 * title / desc); the announcement payload is the composer's exact shape with
 * recipients resolved the composer's way ("all" = its people list, label
 * "Everyone"), a non-broadcaster Koy is refused before any send, the test flag
 * goes to Koy only, the audit never carries the body, 10 / hour; the promote
 * is autoTaskDoc's literal with saveNeed's envelope through tx.create, or
 * pushTo's needPatch on the open doc — never a second doc; the plan-intake
 * decide is called with the exact Routine body + by: "Koy (via Duet)", a
 * closed item is the watcher's 409 passed through; the Upcoming add / edit,
 * team add / edit / remove and roster add / remove shapes with the settings
 * stamp; every other settings doc refused before any read; only needs /
 * settings.{upcoming_jobs,crewTeams,crewRoster} / duet_writes written by the
 * handler itself (broadcasts + bell copies are the app's sender's, the queue
 * the watcher's). No Firebase import. Prebuild.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const OF = require(path.join(root, "functions", "duetWrites", "office.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const ND = require(path.join(root, "functions", "notifyDelivery.js"));
const NS = require(path.join(root, "functions", "needShape.js"));
const MAIL = require(path.join(root, "functions", "planIntake", "mail.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-04T04:30:00.000Z";
const NOW_MS = Date.parse(NOW);
const TODAY = "2026-11-03";
const TZ = "America/Denver";
const clone = (x) => JSON.parse(JSON.stringify(x));
const app = fs.readFileSync(path.join(root, "src", "App.js"), "utf8");
const idx = fs.readFileSync(path.join(root, "functions", "index.js"), "utf8");
const watcher = fs.readFileSync(path.join(root, "functions", "planIntake", "watcher.js"), "utf8");
const officeSrc = fs.readFileSync(path.join(root, "functions", "duetWrites", "office.js"), "utf8");
const apiSrc = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");

// Balanced-brace extraction (the ship-7 pattern): from `marker` to the end of the body.
const extractFn = (src, marker) => { const start = src.indexOf(marker); assert.ok(start > 0, "marker " + marker); let i = src.indexOf("{", start), depth = 0, quote = null; for (; i < src.length; i++) { const c = src[i], d = src[i + 1]; if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; } if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; } if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2) + 1; continue; } if (c === '"' || c === "'" || c === "`") { quote = c; continue; } if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { i++; break; } } } return src.slice(start, i); };

// ── users / docs ─────────────────────────────────────────────────────────────
const USERS = [
  { id: "u1", name: "Koy", title: "admin", access: "admin", caps: ["resi.head"] },
  { id: "u2", name: "Josh Miller", title: "admin", access: "admin" },
  { id: "u3", name: "Keegan", title: "foreman", access: "manager" },
  { id: "u4", name: "Colby", title: "foreman", access: "standard" },
  { id: "u5", name: "Abe", title: "crew", access: "limited" },
  { id: "u6", name: "Sub Guy", title: "crew", access: "contractor" },
  { id: "u7", name: "Old Timer", title: "crew", access: "limited", active: false },
];
const FORTH = "1772863862618", GONE = "1772863862620", QUIET = "1772863862621";
const JOB = (over) => ({ id: FORTH, name: "Forth", foreman: "Keegan", roughStatus: "scheduled", roughStatusDate: "11/5/2026", taskDueDates: { [FORTH + "_rough_po"]: "2026-11-12" }, clearedTasks: [FORTH + "_qc_walk"],
  changeOrders: [{ id: "c1", desc: "Add cans", coStatus: "needs_sending" }], returnTrips: [{ id: "r1", scope: "Trim bath", rtStatus: "needs" }], ...(over || {}) });
const DOC = (data, over) => ({ data, updated_at: "2026-11-03T20:00:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 606, w: "606.abcdefgh", ...(over || {}) });
const OPEN_PUSH = { id: "need_1762000000001_aaaaa", kind: "task", text: "Order Job Start PO", plan: "", dueBucket: "week", dueDate: "2026-11-12", snoozedUntil: "", assignedTo: "Colby", assignedBy: "Koy", assignedAt: "2026-11-02T10:00:00.000Z", foreman: "Keegan", jobId: FORTH, jobName: "Forth", status: "open", createdBy: "Koy", createdAt: "2026-11-02T10:00:00.000Z", doneAt: "", doneBy: "", autoTaskId: FORTH + "_rough_po", startedBy: "Colby", startedAt: "2026-11-02T12:00:00.000Z" };
const DONE_PUSH = { ...OPEN_PUSH, id: "need_1762000000002_bbbbb", text: "Schedule Rough", autoTaskId: FORTH + "_rough_needs", status: "done", doneBy: "Colby", doneAt: "2026-11-03T10:00:00.000Z", startedBy: "", startedAt: "" };
const UPCOMING = [{ id: "1761000000001", name: "#2048 - Discovery Ridge Lot 317", address: "", city: "Kimball Junction", sales: "Justin", customer: "Milar", notes: "No hole yet.", lastFollowUp: "10/8/25", foreman: "", projectedStart: "", startConfirmed: false, photos: [{ id: "p1", url: "x" }] }];
const TEAMS = [{ id: "t1abc", lead: "Keegan", members: ["Abe"] }, { id: "t2abc", lead: "Colby", members: [] }];
const ROSTER = ["Keegan", "Colby", "Abe"];
const DOCS = () => ({
  ["jobs/" + FORTH]: DOC(JOB()),
  ["jobs/" + GONE]: DOC(JOB({ id: GONE, name: "Gone", archived: true })),
  ["jobs/" + QUIET]: DOC(JOB({ id: QUIET, name: "Quiet", taskDueDates: {}, clearedTasks: [], changeOrders: [], returnTrips: [] })),
  ["needs/" + OPEN_PUSH.id]: { data: clone(OPEN_PUSH), updated_at: "2026-11-02T10:00:00.000Z", saved_by: "Koy" },
  ["needs/" + DONE_PUSH.id]: { data: clone(DONE_PUSH), updated_at: "2026-11-03T10:00:00.000Z", saved_by: "Colby" },
  "settings/upcoming_jobs": { items: clone(UPCOMING), updated_at: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/crewTeams": { teams: clone(TEAMS), updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/crewRoster": { names: clone(ROSTER), updatedAt: "2026-11-01T10:00:00.000Z", tab: "t9", merged: false },
  "settings/main": { foremanColors: {} },
});
const QUEUE = () => ({
  "pi_open_1": { type: "email_pdf", status: "open", inboxFileId: "f1", filename: "Tolbert plans.pdf", from: "gc@example.com", createdAt: "2026-11-03T10:00:00.000Z" },
  "pi_done_2": { type: "email_pdf", status: "done", inboxFileId: "f2", filename: "Old.pdf", from: "gc@example.com" },
  "pi_walk_3": { type: "walk_unmatched", status: "open", eventId: "ev3", title: "Walk — Rivers", walkDate: "2026-11-05" },
});

// ── fake io ──────────────────────────────────────────────────────────────────
function fakeIo({ docs = DOCS(), users = USERS, recent = 0, recentActions = [], sender = "ok", queue = QUEUE(), mode = "live" } = {}) {
  const log = [], sends = [], decides = [];
  let rc = 0;   // the real io hands out a fresh random per call; the fake counts so two creates in one test never share an id
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path, d]); if (store[r.path]) { const e = new Error("6 ALREADY_EXISTS: " + r.path); e.code = 6; throw e; } if (JSON.stringify(d).includes("undefined")) throw new Error("undefined written"); store[r.path] = clone(d); },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => { if (d[k] === undefined) throw new Error("undefined written at " + k); setPath(cur, k, d[k]); }); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = clone(d); },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  const io = {
    log, store, sends, decides, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "ab" + String(++rc).padStart(3, "0"), tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => recent, getJob: async () => null, getUsers: async () => users, openNeeds: async () => [],
    recentActions: async () => recentActions,
    runTx: async (fn) => fn(tx), needRef: (id) => ref("needs", id), jobRef: (id) => ref("jobs", id), auditRef: (id) => ref("duet_writes", id),
    settingsRef: (id) => { log.push(["settingsRef", id]); if (!api.settingsDocAllowed(id)) throw new api.Refusal(400, "settings/" + id + " is not a document Duet may touch. Nothing was read or written."); return ref("settings", id); },
    needsByAutoTaskId: async (t, id) => { log.push(["query", "needs?data.autoTaskId=" + id]); return Object.keys(store).filter(k => k.startsWith("needs/") && store[k].data && store[k].data.autoTaskId === id).map(k => ({ id: k.slice(6), data: store[k].data, updated_at: store[k].updated_at || "" })); },
    isBroadcaster: ND.isBroadcaster,
    // The app's sendBroadcastAs, faked: records the payload it was handed and answers like the callable (or throws like it).
    sendBroadcastAs: async (user, payload) => {
      sends.push({ user: user.name, payload: clone(payload) });
      if (sender === "invalid") { const e = new Error("Pick at least one person."); e.code = "invalid-argument"; throw e; }
      if (sender === "boom") throw new Error("deliver threw");
      const picked = payload.test ? [user] : ND.resolveBroadcastRecipients(users, payload.to, user, false, (u) => u.id);
      return { ok: true, id: payload.id, test: payload.test, kind: payload.kind, title: payload.title || `Message from ${user.name}`, summary: { total: picked.length, phone: Math.max(0, picked.length - 1), retrying: [], bellOnly: picked.length ? [picked[picked.length - 1].name] : [], notSaved: [] } };
    },
    // The watcher's decideById, faked with its exact rules: mode prefix → 404, missing → 404, not open → 409, bad body → 422; records the body.
    planDecide: async (itemId, body) => {
      decides.push({ itemId, body: clone(body) });
      const p = mode === "live" ? "" : mode + "_";
      if (!itemId.startsWith(p) || (!p && /^(dry|test)_/.test(itemId))) throw Object.assign(new Error("no such item"), { code: 404 });
      const item = queue[itemId];
      if (!item || !item.type) throw Object.assign(new Error("no such item"), { code: 404 });
      if (item.status !== "open") throw Object.assign(new Error(`item is ${item.status}`), { code: 409 });
      if (body.action === "match_walk" && item.type !== "walk_unmatched") throw Object.assign(new Error("match_walk is for walk items"), { code: 422 });
      if (body.action === "file" && item.type !== "email_pdf") throw Object.assign(new Error("only a fetched email PDF can be filed"), { code: 422 });
      const out = body.action === "file" ? (mode === "dry" ? { status: "decided_dry", note: "would file as 1407 CABINET PLANS R2.pdf" } : { status: "done", note: "1407 CABINET PLANS R2.pdf" }) : body.action === "dismiss" ? { status: "dismissed", note: body.reason } : body.action === "unmatched" ? { status: "unmatched", note: body.reason } : { status: "done", note: `existing job #${body.number}` };
      queue[itemId] = { ...item, status: out.status, decision: { ...body, note: out.note, at: NOW }, decidedAt: NOW };
      return { ok: true, mode, item: itemId, type: item.type, filename: item.filename || "", from: item.from || "", ...out };
    },
    arrayUnion: (...x) => ({ __arrayUnion: x }), serverTimestamp: () => ({ __serverTimestamp: true }), deleteField: () => ({ __delete: true }), fieldPath: (...s) => s.join("."),
  };
  return io;
}
const RID = (k) => `99999999-9999-4999-8999-${String(k).padStart(12, "0")}`;
let rid = 0;
const call = (io, action, args, id) => api.handle({ requestId: id || RID(++rid), action, args }, io);
const NEED_ENVELOPE = ["app_build", "data", "device", "saved_by", "tab", "updated_at", "w"];
const PATCH_ENVELOPE = ["app_build", "device", "saved_by", "tab", "updated_at", "w"];
const SETTINGS_STAMP = ["merged", "tab", "updatedAt"];
const writes = (io, kind, p) => io.log.filter(l => l[0] === kind && (!p || l[1] === p));
const auditOf = (io, k) => io.store["duet_writes/" + RID(k)];
const onlyAllowed = (io) => { for (const l of io.log) if (l[0] === "update" || l[0] === "set" || l[0] === "create") assert.ok(/^(needs|duet_writes)\/|^settings\/(upcoming_jobs|crewTeams|crewRoster)$/.test(l[1]), "only needs / settings.{upcoming_jobs,crewTeams,crewRoster} / duet_writes written by the handler: " + l[1]); assert.ok(!io.log.some(l => l[0] === "delete"), "no delete"); };
const checkStamp = (upd, prevIso) => { assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-9999")); assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 609 && new RegExp("^" + upd.app_build + "\\.duet[a-z0-9]{6,}$").test(upd.w), "version-lock stamp >= 609"); assert.ok(Date.parse(upd.updated_at) > Date.parse(prevIso), "updated_at strictly newer"); };
const checkSettingsStamp = (upd, prevIso) => { assert.ok(upd.tab.startsWith("duet-9999")); assert.strictEqual(upd.merged, false); assert.ok(Date.parse(upd.updatedAt) > Date.parse(prevIso), "updatedAt strictly newer"); };

(async () => {
// ── pinned to App.js / index.js / watcher.js ─────────────────────────────────
await ok("office.js: parseAnyDate / localYmd / autoDelegation / autoTaskDoc are App.js's text verbatim (App.js keeps its copies; this refuses the build when they drift)", () => {
  assert.strictEqual(extractFn(officeSrc, "const parseAnyDate = (str) => {"), extractFn(app, "const parseAnyDate = (str) => {"), "parseAnyDate");
  assert.strictEqual(extractFn(officeSrc, "function localYmd(d) {"), extractFn(app, "function localYmd(d) {"), "localYmd");
  assert.strictEqual(extractFn(officeSrc, "function autoDelegation(needs) {"), extractFn(app, "function autoDelegation(needs) {"), "autoDelegation");
  assert.strictEqual(extractFn(officeSrc, "function autoTaskDoc(t, job, assignee, me, nowIso, id) {"), extractFn(app, "function autoTaskDoc(t, job, assignee, me, nowIso, id) {"), "autoTaskDoc");
  assert.strictEqual(OF.autoTaskDoc.toString(), extractFn(app, "function autoTaskDoc(t, job, assignee, me, nowIso, id) {"), "the exported function is that text");
  // The My Day Push itself: an open delegated doc is PATCHED (onPatchNeed assignedTo), else autoTaskDoc is saved.
  const push = extractFn(app, "const pushTo = (t, job, who) => {");
  assert.ok(/if \(cur && cur\.status !== "done"\) \{ onPatchNeed\(cur\.id, \{ assignedTo: who \}, cur\);/.test(push) && /onSaveNeed\(autoTaskDoc\(t, job, who, me, nowIso\(\)\)\)/.test(push), "pushTo: patch the open doc, else autoTaskDoc");
  assert.ok(/const delegation = autoDelegation\(needs\);/.test(app), "the board joins docs by autoDelegation");
});

await ok("office.js: the auto-task id catalog IS the task engine's — every fixed suffix of computeTasks + commercialTasks, every templated-id pattern, and every literal title / desc (null where the engine templates it)", () => {
  const engine = extractFn(app, "function computeTasks(jobs, opts) {") + "\n" + extractFn(app, "function commercialTasks(job, tasks) {");
  const fixed = new Set(), dynamic = new Set();
  const re = /id: *(?:job\.id *\+ *"(_[a-z_]+)"|`\$\{job\.id\}(_[a-z_]+)\$\{)/g;
  let m;
  const titles = {}, descs = {}, cats = {};
  while ((m = re.exec(engine))) {
    const suf = m[1] || m[2];
    const continues = /^\s*\+/.test(engine.slice(m.index + m[0].length));   // `job.id+"_co_"+co.id+…` → a templated id
    if (m[1] && !continues) {
      fixed.add(suf);
      const win = engine.slice(m.index, m.index + 700);
      const tm = /title: *("(?:[^"\\]|\\.)*"|`[^`]*`|[A-Za-z_][\w.]*)/.exec(win); const dm = /desc: *("(?:[^"\\]|\\.)*"|`[^`]*`|[A-Za-z_][\w.|() ]*)/.exec(win);
      titles[suf] = tm && tm[1].startsWith('"') ? JSON.parse(tm[1]) : null;
      descs[suf] = dm && dm[1].startsWith('"') ? JSON.parse(dm[1]) : null;
      cats[suf] = (/category: *"([a-z_]+)"/.exec(win) || [])[1] || null;
    } else dynamic.add(suf);
  }
  // Templated ids the regex above can't read as fixed: _co_<id>_x and _rt_<id>_x are `job.id+"_co_"+co.id+"_send"`.
  const coRt = [...engine.matchAll(/job\.id\+"_(co|rt)_"\+(?:co|rt)\.id\+"_([a-z]+)"/g)].map(x => `_${x[1]}_<id>_${x[2]}`);
  assert.deepStrictEqual([...fixed].sort(), Object.keys(OF.AUTO_TASK_FIXED).sort(), "every fixed suffix the engine writes, and none it doesn't");
  for (const suf of fixed) { assert.strictEqual(OF.AUTO_TASK_FIXED[suf].title, titles[suf], `title literal for ${suf}`); assert.strictEqual(OF.AUTO_TASK_FIXED[suf].desc, descs[suf], `desc literal for ${suf}`); if (cats[suf]) assert.strictEqual(OF.AUTO_TASK_FIXED[suf].category, cats[suf], `category for ${suf}`); else assert.strictEqual(OF.AUTO_TASK_FIXED[suf].category, "commercial", `commercial rows take category from their base: ${suf}`); }
  assert.deepStrictEqual(coRt.sort(), ["_co_<id>_approved", "_co_<id>_done", "_co_<id>_sched", "_co_<id>_send", "_rt_<id>_done", "_rt_<id>_needs", "_rt_<id>_sched"], "the CO / RT row kinds");
  for (const s of ["_co_c1_send", "_co_c1_approved", "_co_c1_sched", "_co_c1_done", "_rt_r1_done", "_rt_r1_needs", "_rt_r1_sched", "_comm_owed_9_ufer", "_comm_gearlate_g1"]) assert.ok(OF.autoTaskKind(s) && !OF.autoTaskKind(s).fixed, s);
  assert.deepStrictEqual([...dynamic].sort(), ["_co_", "_comm_gearlate_", "_comm_owed_", "_rt_"], "the templated ids: CO / RT rows and the two commercial template literals");
  assert.strictEqual(OF.autoTaskKind("_rough_po").title, "Order Job Start PO"); assert.strictEqual(OF.autoTaskKind("_prep").title, null); assert.strictEqual(OF.autoTaskKind("_nope"), null); assert.strictEqual(OF.autoTaskKind("_co_c1_bogus"), null);
});

await ok("office.js: the announcement payload is the composer's (App.js Bell → Send) — its people filter, its {id,name} picks, its bc_ id, its Everyone label; isBroadcaster is ND's (the callable's gate); plan categories are MAIL.CATEGORIES' keys; the decide actions are decide()'s branches; blankUpcoming's keys; the team literal", () => {
  assert.ok(/const people = useMemo\(\(\) => \(users \|\| \[\]\)\s*\.filter\(u => u && u\.name && u\.active !== false && getAccess\(u\) !== "contractor"\)/.test(app), "the composer's people filter");
  assert.ok(/to: test \? \[\] : picked\.map\(u => \(\{ id: u\.id \|\| "", name: u\.name \}\)\), test \}/.test(app), "the composer's payload: to = picked {id, name}, [] on a test");
  assert.ok(/const bcNewId = \(\) => `bc_\$\{Date\.now\(\)\.toString\(36\)\}_\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`;/.test(app), "bcNewId");
  assert.ok(/if \(picked\.length === people\.length\) return "Everyone";/.test(app), "the Everyone label rule");
  assert.ok(ND.BROADCAST_ID_RE.test(OF.broadcastId(NOW_MS, "abcde")), "the minted id passes the callable's cleanId");
  assert.deepStrictEqual(OF.broadcastPeople(USERS).map(u => u.name), ["Abe", "Colby", "Josh Miller", "Keegan", "Koy"], "active, named, not a contractor, sorted");
  assert.deepStrictEqual(OF.PLAN_CATEGORIES, Object.keys(MAIL.CATEGORIES));
  const decideSrc = extractFn(watcher, "async function decide(ctx, item, d) {");
  assert.deepStrictEqual([...decideSrc.matchAll(/d\.action (?:===|!==) "([a-z_]+)"/g)].map(x => x[1]).sort(), [...OF.PLAN_ACTIONS].sort());
  const bu = extractFn(app, "function blankUpcoming() {");
  const keys = [...bu.matchAll(/(\w+):/g)].map(x => x[1]);
  assert.deepStrictEqual(Object.keys(OF.blankUpcoming(() => "x")), keys, "blankUpcoming's keys in order");
  assert.ok(/_saveTeams\(\[\.\.\.\(crewTeams\|\|\[\]\), \{id:Date\.now\(\)\.toString\(36\), lead, members\}\]\)/.test(app), "saveTeamModal's team literal");
  assert.ok(/_saveRoster\(\[\.\.\.roster,crewAddName\.trim\(\)\]\)/.test(app) && /_saveRoster\(roster\.filter\(n=>n!==name\)\)/.test(app), "the roster add / remove lines");
  assert.ok(/mergeSaveSettingsFields\("upcoming_jobs",\{items:list,updated_at:new Date\(\)\.toISOString\(\)\}\)/.test(app), "the pipeline writes items + updated_at");
});

await ok("index.js: sendBroadcast's body is sendBroadcastAs (one body, two callers — the callable after requireBroadcaster, duetApi via officeDeps with ND.isBroadcaster); watcher.js: the /decide route runs runDecide and decideById is exported with the same reads, the open-only 409 and the same queue update; duetApi gets _planIntake.decideById", () => {
  assert.ok(/async function sendBroadcastAs\(sender, data\) \{/.test(idx), "sendBroadcastAs exists");
  assert.ok(/exports\.sendBroadcast = functions\.https\.onCall\(async \(data\) => \{\s*const sender = await requireBroadcaster\(data\);\s*return sendBroadcastAs\(sender, data\);\s*\}\);/.test(idx), "the callable = gate + the shared body");
  const sendBody = extractFn(idx, "async function sendBroadcastAs(sender, data) {");
  assert.ok(/broadcastRef\(id\)\.set\(\{\s*\.\.\.b, to: results\.map\(r => r\.name\), summary, replyCount: 0,/.test(sendBody) && /await deliverMany\(picked, notif, announceExtra\(b, \{ test \}\), "broadcast"\)/.test(sendBody) && /ND\.resolveBroadcastRecipients\(users, data && data\.to, sender, test, inboxKeyOf\)/.test(sendBody), "the record write, the deliver fan-out and the recipient resolution all live in the shared body");
  assert.ok(/officeDeps: \{ sendBroadcastAs, isBroadcaster: ND\.isBroadcaster, planDecide: _planIntake\.decideById \}/.test(idx), "duetApi gets the real sender, gate and decider");
  assert.ok(/materialDeps: \{ simproReqWithRetry, accessOf: gcAdminAccessOf, loadMailConfig: gcLoadMailConfig, gmailSend: _poGmail\.send \}/.test(idx), "ship 8's deps untouched");
  assert.ok(idx.indexOf("const _planIntake = require") < idx.indexOf("const _duet = require(\"./duetWrites/api.js\")"), "the watcher is built before duetApi");
  assert.ok(/async function runDecide\(cfg, iref, item, body, budgetMs\) \{/.test(watcher) && /async function decideById\(itemId, body\) \{/.test(watcher), "runDecide + decideById");
  const route = watcher.slice(watcher.indexOf('route === "/decide"'), watcher.indexOf('route === "/decide"') + 400);
  assert.ok(/if \(item\.status !== "open"\) \{ res\.status\(409\)/.test(route) && /await runDecide\(cfg, iref, item, req\.body \|\| \{\}, 250 \* 1000\)/.test(route), "the route keeps its 409 and calls runDecide");
  const byId = extractFn(watcher, "async function decideById(itemId, body) {");
  assert.ok(/if \(!id \|\| !id\.startsWith\(p\) \|\| \(!p && \/\^\(dry\|test\)_\/\.test\(id\)\)\) throw .*code: 404/.test(byId) && /if \(item\.status !== "open"\) throw .*code: 409/.test(byId) && /await runDecide\(cfg, iref, item, body, 100 \* 1000\)/.test(byId), "decideById: the route's prefix rule, 404s, 409, runDecide");
  assert.strictEqual((watcher.match(/await decide\(ctx, item, /g) || []).length, 3, "decide() is called from runDecide, planFileByHand and planDismissByHand only (the route's own call moved into runDecide)");
  assert.strictEqual((watcher.match(/iref\.update\(\{ status: out\.status, decision: /g) || []).length, 3, "the queue update lives in runDecide + the two by-hand callables");
  assert.ok(/decideById, _runOnce: runOnce/.test(watcher), "exported");
});

// ── announcements ────────────────────────────────────────────────────────────
await ok("handle broadcast.send to two names: the composer's exact payload (bc_ id, title, body, label '2 picked', kind, attachments [], to [{id,name}] resolved the composer's way, test false) handed to the app's OWN sender as Koy; the answer names every recipient; the audit keeps title length / kind / recipient ids — NEVER the body; nothing written by the handler but the audit", async () => {
  const io = fakeIo();
  const r = await call(io, "broadcast.send", { title: "Friday huddle", body: "Shop at 6:30 — bring the rough-in list.", kind: "important", to: ["Keegan", "colby"] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(io.sends.length, 1); assert.strictEqual(io.sends[0].user, "Koy");
  const p = io.sends[0].payload;
  assert.deepStrictEqual(Object.keys(p).sort(), ["attachments", "body", "id", "kind", "label", "test", "title", "to"]);
  assert.ok(ND.BROADCAST_ID_RE.test(p.id) && p.id.startsWith("bc_" + NOW_MS.toString(36) + "_"), p.id);
  assert.deepStrictEqual({ ...p, id: "x" }, { id: "x", title: "Friday huddle", body: "Shop at 6:30 — bring the rough-in list.", label: "2 picked", kind: "important", attachments: [], to: [{ id: "u3", name: "Keegan" }, { id: "u4", name: "Colby" }], test: false });
  assert.deepStrictEqual(r.body.recipients, ["Keegan", "Colby"]); assert.strictEqual(r.body.recipientCount, 2); assert.strictEqual(r.body.broadcastId, p.id); assert.strictEqual(r.body.recorded, true); assert.strictEqual(r.body.everyone, false); assert.strictEqual(r.body.kind, "important"); assert.ok(/Got it/.test(r.body.note)); assert.deepStrictEqual(r.body.pushTo, ["Keegan", "Colby"]);
  assert.ok(!JSON.stringify(r.body).includes("Shop at 6:30"), "the answer carries the title, not the body (Duet listed it to Koy already)");
  const a = auditOf(io, rid);
  assert.strictEqual(a.coll, "broadcasts"); assert.strictEqual(a.docId, p.id); assert.strictEqual(a.newDoc, true); assert.strictEqual(a.titleLength, 13); assert.strictEqual(a.bodyLength, 39); assert.strictEqual(a.kind, "important"); assert.strictEqual(a.recipientCount, 2); assert.deepStrictEqual(a.recipientIds, ["u3", "u4"]); assert.deepStrictEqual(a.docs, ["broadcasts/" + p.id, "notifications/*/items"]);
  assert.ok(!JSON.stringify(a).includes("Shop at 6:30"), "the audit never carries the body");
  assert.deepStrictEqual(io.log.filter(l => l[0] !== "get").map(l => [l[0], l[1]]), [["set", "duet_writes/" + RID(rid)]], "the handler itself writes only the audit — broadcasts/<id> and the bell copies are the sender's");
});

await ok('handle broadcast.send to "all": every active, named, non-contractor member (the composer\'s people list — no contractor, no deactivated), label "Everyone"; a given label wins; a test send goes to Koy only with to: [] and is not recorded', async () => {
  const io = fakeIo();
  const r = await call(io, "broadcast.send", { body: "Yard clean-up Saturday.", to: "all" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const p = io.sends[0].payload;
  assert.deepStrictEqual(p.to, [{ id: "u5", name: "Abe" }, { id: "u4", name: "Colby" }, { id: "u2", name: "Josh Miller" }, { id: "u3", name: "Keegan" }, { id: "u1", name: "Koy" }]);
  assert.strictEqual(p.label, "Everyone"); assert.strictEqual(p.kind, "announcement"); assert.strictEqual(p.title, ""); assert.strictEqual(r.body.title, "Message from Koy", "the callable's default title is what the answer shows"); assert.strictEqual(r.body.everyone, true);
  const r2 = await call(io, "broadcast.send", { body: "Yard clean-up Saturday.", to: ["Keegan"], label: "Foremen" });
  assert.strictEqual(io.sends[1].payload.label, "Foremen");
  const r3 = await call(io, "broadcast.send", { title: "Test", body: "Does this buzz?", to: ["Keegan", "Colby"], test: true });
  assert.strictEqual(r3.status, 200); const t = io.sends[2].payload; assert.strictEqual(t.test, true); assert.deepStrictEqual(t.to, []); assert.deepStrictEqual(r3.body.recipients, ["Koy"]); assert.strictEqual(r3.body.recorded, false); assert.ok(/TEST send/.test(r3.body.note));
  assert.strictEqual(auditOf(io, rid).newDoc, false); assert.deepStrictEqual(auditOf(io, rid).fields, []);
  void r2;
});

await ok("handle broadcast.send refusals — nothing is sent: unknown name (close matches listed), ambiguous first name, a contractor or deactivated name, empty body, body over 1000, title over 80, bad kind, no `to`, attachments; a Koy whose record isn't an office broadcaster (ND.isBroadcaster) → 403 before the sender; the sender's own invalid-argument → 400 'Nothing was sent'; an unclear sender failure → 502 with the MAY note; 10 / hour → 429", async () => {
  const io = fakeIo();
  const bad = async (args, re, status = 400) => { const r = await call(io, "broadcast.send", args); assert.strictEqual(r.status, status, JSON.stringify(r.body)); assert.ok(re.test(r.body.refused), r.body.refused); };
  await bad({ body: "x", to: ["Zed"] }, /"Zed" isn't on the active team list/);
  const two = fakeIo({ users: [...USERS, { id: "u8", name: "Josh Carter", title: "crew", access: "limited" }] });
  const amb = await call(two, "broadcast.send", { body: "x", to: ["Josh"] }); assert.strictEqual(amb.status, 400); assert.ok(/more than one person/.test(amb.body.refused)); assert.strictEqual(two.sends.length, 0);
  await bad({ body: "x", to: ["Sub Guy"] }, /isn't on the active team list/);
  await bad({ body: "x", to: ["Old Timer"] }, /isn't on the active team list/);
  await bad({ body: "   ", to: ["Keegan"] }, /Write a message first/);
  await bad({ body: "y".repeat(1001), to: ["Keegan"] }, /1001 characters.*1000/);
  await bad({ title: "t".repeat(81), body: "x", to: ["Keegan"] }, /81 characters.*80/);
  await bad({ body: "x", to: ["Keegan"], kind: "urgent" }, /kind must be one of announcement, important, discussion/);
  await bad({ body: "x" }, /to must be "all" or a list/);
  await bad({ body: "x", to: [] }, /to must be "all" or a list/);
  await bad({ body: "x", to: ["Keegan"], attachments: [{ name: "a.jpg", url: "https://x" }] }, /Attachments aren't sent from Duet/);
  assert.strictEqual(io.sends.length, 0, "no send on any refusal");
  const fm = fakeIo({ users: USERS.map(u => (u.name === "Koy" ? { ...u, title: "foreman", access: "manager", caps: [] } : u)) });
  assert.strictEqual(ND.isBroadcaster(fm.store && { name: "Koy", title: "foreman", access: "manager" }), false, "a manager-access foreman is NOT a broadcaster (five foremen carry Manager access)");
  const gate = await call(fm, "broadcast.send", { body: "x", to: ["Keegan"] });
  assert.strictEqual(gate.status, 403); assert.ok(/office broadcaster/.test(gate.body.refused)); assert.strictEqual(fm.sends.length, 0);
  const noKoy = fakeIo({ users: USERS.filter(u => u.name !== "Koy") });
  const nk = await call(noKoy, "broadcast.send", { body: "x", to: ["Keegan"] }); assert.strictEqual(nk.status, 400); assert.ok(/nobody to send as/.test(nk.body.refused));
  const inv = fakeIo({ sender: "invalid" });
  const r1 = await call(inv, "broadcast.send", { body: "x", to: ["Keegan"] }); assert.strictEqual(r1.status, 400); assert.ok(/Pick at least one person\. Nothing was sent\./.test(r1.body.refused)); assert.strictEqual(auditOf(inv, rid).senderCode, "invalid-argument");
  const boom = fakeIo({ sender: "boom" });
  const r2 = await call(boom, "broadcast.send", { body: "x", to: ["Keegan"] }); assert.strictEqual(r2.status, 502); assert.ok(/MAY have reached some people.*cc_list_announcements/.test(r2.body.refused));
  const busy = fakeIo({ recentActions: new Array(10).fill("broadcast.send").concat(["task.create"]) });
  await assert.rejects(call(busy, "broadcast.send", { body: "x", to: ["Keegan"] }), (e) => e instanceof api.Refusal && e.status === 429 && /10 team messages/.test(e.message));
  assert.strictEqual(busy.sends.length, 0);
  const fine = fakeIo({ recentActions: new Array(9).fill("broadcast.send").concat(new Array(20).fill("material.sendPo")) });
  assert.strictEqual((await call(fine, "broadcast.send", { body: "x", to: ["Keegan"] })).status, 200, "only broadcast.send counts against its own 10");
});

await ok("handle broadcast.send replay: the same requestId answers the first result and the sender is NOT called again", async () => {
  const io = fakeIo();
  const first = await call(io, "broadcast.send", { body: "once", to: ["Keegan"] }, RID("r1"));
  const again = await call(io, "broadcast.send", { body: "once", to: ["Keegan"] }, RID("r1"));
  assert.strictEqual(io.sends.length, 1); assert.strictEqual(again.body.replayed, true); assert.strictEqual(again.body.broadcastId, first.body.broadcastId);
});

// ── auto-task promotion ──────────────────────────────────────────────────────
await ok("handle autoTask.promote (no doc yet): ONE tx.create on needs/<id> whose data is EXACTLY autoTaskDoc(t, job, who, 'Koy', now, id) — the head's snoozed date (taskDueDates) wins and sets the bucket, the fixed title from the engine's catalog, saveNeed's envelope; the needs query ran under the tx; the audit is a create", async () => {
  const io = fakeIo();
  const r = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_deposit", assignee: "Josh" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const c = writes(io, "create"); assert.strictEqual(c.length, 1); assert.ok(c[0][1].startsWith("needs/need_" + NOW_MS + "_"));
  const doc = c[0][2];
  assert.deepStrictEqual(Object.keys(doc).sort(), NEED_ENVELOPE); assert.strictEqual(doc.updated_at, NOW); checkStamp(doc, "2026-11-03T20:00:00.000Z");
  const t = { id: FORTH + "_rough_deposit", jobId: FORTH, jobName: "Forth", title: "Material Deposit — Rough", desc: "Rough is scheduled — collect material deposit before start", dueDate: "", foreman: "Keegan", category: "invoice" };
  const want = OF.autoTaskDoc(t, { ...JOB(), id: FORTH }, "Josh Miller", "Koy", NOW, doc.data.id);
  assert.deepStrictEqual(doc.data, want, "the literal");
  assert.strictEqual(doc.data.kind, "task"); assert.strictEqual(doc.data.plan, t.desc); assert.strictEqual(doc.data.autoTaskId, FORTH + "_rough_deposit"); assert.strictEqual(doc.data.assignedBy, "Koy"); assert.strictEqual(doc.data.createdBy, "Koy"); assert.strictEqual(doc.data.dueBucket, "week"); assert.strictEqual(doc.data.dueDate, ""); assert.strictEqual(doc.data.foreman, "Keegan");
  assert.ok(io.log.some(l => l[0] === "query" && l[1] === "needs?data.autoTaskId=" + FORTH + "_rough_deposit"), "the dedupe query under the tx");
  assert.strictEqual(r.body.created, true); assert.strictEqual(r.body.assignedTo, "Josh Miller"); assert.deepStrictEqual(r.body.pushTo, ["Josh Miller"]); assert.strictEqual(r.body.suffix, "_rough_deposit");
  const a = auditOf(io, rid); assert.strictEqual(a.coll, "needs"); assert.strictEqual(a.newDoc, true); assert.deepStrictEqual(a.after, doc.data); assert.strictEqual(a.autoTaskId, FORTH + "_rough_deposit");
  // the snoozed date: the head's taskDueDates entry wins over the rule's date and is normalised to YYYY-MM-DD; a rule date (M/D/YYYY) is normalised too
  const io2 = fakeIo();
  const r2 = await call(io2, "autoTask.promote", { jobId: QUIET, autoTaskId: QUIET + "_rough_po", assignee: "Colby", dueDate: "11/12/2026" });
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); const d2 = writes(io2, "create")[0][2].data; assert.strictEqual(d2.dueDate, "2026-11-12", "M/D/YYYY normalised by parseAnyDate + localYmd"); assert.strictEqual(d2.dueBucket, "week"); assert.strictEqual(r2.body.snoozedDateUsed, false);
  const r3 = await call(io2, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_po", assignee: "Colby", dueDate: "11/30/2026" });
  assert.strictEqual(r3.body.noop, true, "Forth's _rough_po has an open doc on Colby already → noop; the date arg is ignored (pushTo passes only assignedTo)"); assert.strictEqual(writes(io2, "update", "needs/" + OPEN_PUSH.id).length, 0);
  onlyAllowed(io); onlyAllowed(io2);
});

await ok("handle autoTask.promote on a row with an OPEN pushed doc: pushTo's onPatchNeed — ONE needs update with needPatch's exact keys (assignedTo + assignedBy / assignedAt stamp + the hand-off Working reset), patchNeed's envelope, NO second doc; same person → noop; a DONE doc → a new doc (verify-before-clear leaves the done one alone) with earlierDoneDoc named", async () => {
  const io = fakeIo();
  const r = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_po", assignee: "Josh Miller" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(writes(io, "create").length, 0, "no second doc");
  const u = writes(io, "update", "needs/" + OPEN_PUSH.id); assert.strictEqual(u.length, 1);
  const upd = u[0][2];
  assert.deepStrictEqual(Object.keys(upd).filter(k => !k.startsWith("data.")).sort(), PATCH_ENVELOPE); checkStamp(upd, "2026-11-02T10:00:00.000Z");
  const want = NS.needPatch({ assignedTo: "Josh Miller" }, OPEN_PUSH, "Koy", NOW);
  assert.deepStrictEqual(Object.fromEntries(Object.keys(upd).filter(k => k.startsWith("data.")).map(k => [k.slice(5), upd[k]])), want);
  assert.deepStrictEqual(want, { assignedTo: "Josh Miller", startedBy: "", startedAt: "", assignedBy: "Koy", assignedAt: NOW }, "the hand-off ends Colby's Working");
  assert.strictEqual(r.body.repushed, true); assert.strictEqual(r.body.needId, OPEN_PUSH.id); assert.strictEqual(r.body.from, "Colby"); assert.deepStrictEqual(r.body.pushTo, ["Josh Miller"]);
  assert.deepStrictEqual(auditOf(io, rid).before, { assignedTo: "Colby", startedBy: "Colby", startedAt: "2026-11-02T12:00:00.000Z", assignedBy: "Koy", assignedAt: "2026-11-02T10:00:00.000Z" });
  assert.strictEqual(io.store["needs/" + OPEN_PUSH.id].data.text, "Order Job Start PO", "the rest of the doc untouched");
  const same = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_po", assignee: "Josh" });
  assert.strictEqual(same.body.noop, true); assert.strictEqual(writes(io, "update", "needs/" + OPEN_PUSH.id).length, 1);
  const done = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_needs", assignee: "Colby" });
  assert.strictEqual(done.status, 200, JSON.stringify(done.body)); assert.strictEqual(done.body.created, true); assert.strictEqual(done.body.earlierDoneDoc, DONE_PUSH.id);
  assert.strictEqual(writes(io, "create").length, 1); assert.deepStrictEqual(io.store["needs/" + DONE_PUSH.id].data, DONE_PUSH, "the done doc is left alone");
  onlyAllowed(io);
});

await ok("handle autoTask.promote refusals — nothing written: cleared row, unknown suffix (the catalog listed), a templated row without its title, a fixed row with a different title, a CO / RT row whose item isn't on the job, unknown / contractor assignee, bad date, archived job, missing job (404); a templated row WITH its title and a CO row for a real CO are accepted; the full <jobId><suffix> id form works; an id collision is a 409", async () => {
  const io = fakeIo();
  const bad = async (args, re, status = 400) => { const r = await call(io, "autoTask.promote", args); assert.strictEqual(r.status, status, JSON.stringify(r.body)); assert.ok(re.test(r.body.refused), r.body.refused); };
  await bad({ jobId: FORTH, autoTaskId: "_qc_walk", assignee: "Colby" }, /cleared by the head/);
  await bad({ jobId: FORTH, autoTaskId: "_bogus", assignee: "Colby" }, /isn't one of the task engine's auto rows\. Known: _rough_deposit, .*_co_<coId>_send/);
  await bad({ jobId: FORTH, autoTaskId: "_prep", assignee: "Colby" }, /pass title exactly as My Day shows it/);
  await bad({ jobId: FORTH, autoTaskId: "_rough_deposit", title: "Deposit!", assignee: "Colby" }, /The engine titles _rough_deposit "Material Deposit — Rough"/);
  await bad({ jobId: FORTH, autoTaskId: "_co_zz_send", title: "Send Change Order #9", assignee: "Colby" }, /has no change order with id zz/);
  await bad({ jobId: FORTH, autoTaskId: "_rt_zz_needs", title: "x", assignee: "Colby" }, /has no return trip with id zz/);
  await bad({ jobId: FORTH, autoTaskId: "_rough_deposit", assignee: "Zed" }, /"Zed" isn't on the active team list/);
  await bad({ jobId: FORTH, autoTaskId: "_rough_deposit", assignee: "Sub Guy" }, /isn't on the active team list/);
  await bad({ jobId: FORTH, autoTaskId: "_rough_deposit" }, /assignee is required/);
  await bad({ jobId: FORTH, autoTaskId: "_rough_deposit", assignee: "Colby", dueDate: "soon" }, /dueDate must be/);
  await bad({ jobId: GONE, autoTaskId: "_rough_deposit", assignee: "Colby" }, /is archived/);
  await bad({ jobId: "1772863862999", autoTaskId: "_rough_deposit", assignee: "Colby" }, /isn't in Command Center/, 404);
  await bad({ jobId: "abc", autoTaskId: "_rough_deposit", assignee: "Colby" }, /jobId must be/);
  assert.strictEqual(writes(io, "create").length + writes(io, "update").length, 0);
  const t1 = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: "_prep", title: "Pre Job Prep: Forth", desc: "Redlines, cabinets, appliances", assignee: "Josh" });
  assert.strictEqual(t1.status, 200, JSON.stringify(t1.body)); const d1 = writes(io, "create").at(-1)[2].data; assert.strictEqual(d1.text, "Pre Job Prep: Forth"); assert.strictEqual(d1.plan, "Redlines, cabinets, appliances"); assert.strictEqual(d1.autoTaskId, FORTH + "_prep");
  const t2 = await call(io, "autoTask.promote", { jobId: FORTH, autoTaskId: FORTH + "_co_c1_send", title: "Send Change Order #1", assignee: "Colby" });
  assert.strictEqual(t2.status, 200, JSON.stringify(t2.body)); assert.strictEqual(writes(io, "create").at(-1)[2].data.autoTaskId, FORTH + "_co_c1_send"); assert.strictEqual(t2.body.category, "co");
  const clash = fakeIo(); clash.store["needs/need_" + NOW_MS + "_ab001"] = { data: { id: "x" } };
  const r9 = await call(clash, "autoTask.promote", { jobId: FORTH, autoTaskId: "_rough_deposit", assignee: "Colby" });
  assert.strictEqual(r9.status, 409); assert.ok(/already exists/.test(r9.body.refused));
  onlyAllowed(io);
});

// ── plan intake ──────────────────────────────────────────────────────────────
await ok("handle planIntake.decide file: the watcher's decideById is called with EXACTLY the Routine's /decide body (item, action, kind, number, category, rev, date, reason) plus by: 'Koy (via Duet)'; the answer carries status / note / mode; the audit names the queue item and decide()'s other docs, the decision without the item; the handler writes nothing but the audit", async () => {
  const io = fakeIo();
  const r = await call(io, "planIntake.decide", { item: "pi_open_1", action: "file", kind: "job", number: "#1407", category: "Cabinet", rev: "2", date: "2026-11-03", reason: "title block: Tolbert" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(io.decides, [{ itemId: "pi_open_1", body: { item: "pi_open_1", action: "file", kind: "job", number: "1407", category: "cabinet", rev: "2", date: "2026-11-03", reason: "title block: Tolbert", by: "Koy (via Duet)" } }]);
  assert.strictEqual(r.body.status, "done"); assert.strictEqual(r.body.note, "1407 CABINET PLANS R2.pdf"); assert.strictEqual(r.body.mode, "live"); assert.strictEqual(r.body.by, "Koy (via Duet)"); assert.strictEqual(r.body.dryRun, false); assert.strictEqual(r.body.filename, "Tolbert plans.pdf"); assert.ok(/moved out of _Plan Inbox/.test(r.body.effect));
  const a = auditOf(io, rid); assert.strictEqual(a.coll, "agentQueue"); assert.strictEqual(a.docId, "pi_open_1"); assert.deepStrictEqual(a.docs, ["agentQueue/<item>", "agentFindings/*", "planIntakeState/*", "Drive: _Plan Inbox → the plan folder or Dismissed"]); assert.deepStrictEqual(a.decision, { action: "file", kind: "job", number: "1407", category: "cabinet", rev: "2", date: "2026-11-03", reason: "title block: Tolbert", by: "Koy (via Duet)" }); assert.deepStrictEqual(a.after, { status: "done", note: "1407 CABINET PLANS R2.pdf" });
  assert.deepStrictEqual(io.log.filter(l => l[0] !== "get").map(l => [l[0], l[1]]), [["set", "duet_writes/" + RID(rid)]]);
  // kind defaults to job; a quote; dismiss / unmatched / match_walk bodies
  const io2 = fakeIo();
  await call(io2, "planIntake.decide", { item: "pi_open_1", action: "dismiss", reason: "duplicate of yesterday's" });
  assert.deepStrictEqual(io2.decides[0].body, { item: "pi_open_1", action: "dismiss", reason: "duplicate of yesterday's", by: "Koy (via Duet)" });
  const io3 = fakeIo();
  await call(io3, "planIntake.decide", { item: "pi_open_1", action: "unmatched", bestGuess: "#1407", reason: "no address on the sheet" });
  assert.deepStrictEqual(io3.decides[0].body, { item: "pi_open_1", action: "unmatched", bestGuess: "#1407", reason: "no address on the sheet", by: "Koy (via Duet)" });
  const io4 = fakeIo();
  const w = await call(io4, "planIntake.decide", { item: "pi_walk_3", action: "match_walk", kind: "quote", number: "Q2201" });
  assert.deepStrictEqual(io4.decides[0].body, { item: "pi_walk_3", action: "match_walk", kind: "quote", number: "2201", by: "Koy (via Duet)" }); assert.strictEqual(w.status, 200);
  const dry = fakeIo({ mode: "dry", queue: { dry_pi_1: { type: "email_pdf", status: "open", inboxFileId: "f", filename: "x.pdf", from: "a@b" } } });
  const rd = await call(dry, "planIntake.decide", { item: "dry_pi_1", action: "file", number: "1407", category: "plans" });
  assert.strictEqual(rd.status, 200, JSON.stringify(rd.body)); assert.strictEqual(rd.body.status, "decided_dry"); assert.strictEqual(rd.body.dryRun, true); assert.ok(/Dry mode/.test(rd.body.effect)); assert.strictEqual(dry.decides[0].body.kind, "job");
});

await ok("handle planIntake.decide refusals: a closed item is the watcher's 409 passed through; an item from another mode / unknown → 404; the watcher's 422 → 400 with its words; bad category / action / missing number / missing reason / bad date / bad item id are refused BEFORE the watcher is called; an unclear failure → 502 with the MAY note", async () => {
  const io = fakeIo();
  const closed = await call(io, "planIntake.decide", { item: "pi_done_2", action: "dismiss", reason: "x" });
  assert.strictEqual(closed.status, 409); assert.ok(/already decided \(item is done\)/.test(closed.body.refused)); assert.strictEqual(io.decides.length, 1);
  const gone = await call(io, "planIntake.decide", { item: "pi_nope", action: "dismiss", reason: "x" }); assert.strictEqual(gone.status, 404);
  const wrongMode = await call(io, "planIntake.decide", { item: "dry_pi_1", action: "dismiss", reason: "x" }); assert.strictEqual(wrongMode.status, 404); assert.ok(/current mode/.test(wrongMode.body.refused));
  const walkOnPdf = await call(io, "planIntake.decide", { item: "pi_open_1", action: "match_walk", kind: "job", number: "1407" }); assert.strictEqual(walkOnPdf.status, 400); assert.ok(/match_walk is for walk items/.test(walkOnPdf.body.refused));
  const before = io.decides.length;
  const bad = async (args, re) => { const r = await call(io, "planIntake.decide", args); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.ok(re.test(r.body.refused), r.body.refused); };
  await bad({ item: "pi_open_1", action: "file", number: "1407", category: "invoice" }, /category must be one of plans, cabinet, appliance, design, specs, redlines/);
  await bad({ item: "pi_open_1", action: "burn" }, /action must be one of file, dismiss, unmatched, match_walk/);
  await bad({ item: "pi_open_1", action: "file", category: "plans" }, /number .* is required/);
  await bad({ item: "pi_open_1", action: "dismiss" }, /reason is required/);
  await bad({ item: "pi_open_1", action: "unmatched", bestGuess: "1407" }, /reason is required/);
  await bad({ item: "pi_open_1", action: "file", number: "1407", category: "plans", date: "11/3/2026" }, /date must be YYYY-MM-DD/);
  await bad({ item: "pi_open_1", action: "match_walk", number: "1" }, /kind: job or quote/);
  await bad({ item: "../x", action: "dismiss", reason: "x" }, /item must be the queue item's id/);
  assert.strictEqual(io.decides.length, before, "schema refusals never reach the watcher");
  const boom = fakeIo(); boom.planDecide = async () => { throw new Error("Drive 500"); };
  const r5 = await call(boom, "planIntake.decide", { item: "pi_open_1", action: "dismiss", reason: "x" }); assert.strictEqual(r5.status, 502); assert.ok(/MAY have landed.*cc_list_plan_intake_queue/.test(r5.body.refused));
});

// ── upcoming jobs ────────────────────────────────────────────────────────────
await ok("handle upcoming.add: blankUpcoming() + the fields, PREPENDED (the pipeline's + Add), id = the app's uid shape, foreman resolved to the team spelling; ONE settings/upcoming_jobs update with items + the pipeline's updated_at + the settings stamp and nothing else; the existing row byte-identical (photos kept); a duplicate name refused", async () => {
  const io = fakeIo();
  const r = await call(io, "upcoming.add", { name: "#2101 - Rivers Residence", city: "Heber", sales: "Justin", customer: "Rivers GC", notes: "Framing in March", lastFollowUp: "11/3/2026", foreman: "keegan", projectedStart: "3/2/2027", startConfirmed: false });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const u = writes(io, "update", "settings/upcoming_jobs"); assert.strictEqual(u.length, 1); const upd = u[0][2];
  assert.deepStrictEqual(Object.keys(upd).sort(), ["items", "updated_at", ...SETTINGS_STAMP].sort()); assert.strictEqual(upd.updated_at, NOW); checkSettingsStamp(upd, "2026-11-01T10:00:00.000Z");
  assert.strictEqual(upd.items.length, 2); assert.deepStrictEqual(upd.items[1], UPCOMING[0], "the existing row untouched, photos and all");
  const item = upd.items[0];
  assert.deepStrictEqual(item, { id: String(NOW_MS), name: "#2101 - Rivers Residence", address: "", city: "Heber", sales: "Justin", customer: "Rivers GC", notes: "Framing in March", lastFollowUp: "11/3/2026", foreman: "Keegan", projectedStart: "3/2/2027", startConfirmed: false, photos: [] });
  assert.deepStrictEqual(Object.keys(item), Object.keys(OF.blankUpcoming(() => "x")), "blankUpcoming's keys, in order");
  assert.strictEqual(r.body.itemId, String(NOW_MS)); assert.strictEqual(r.body.position, "top"); assert.strictEqual(r.body.listNow, 2);
  const a = auditOf(io, rid); assert.strictEqual(a.coll, "settings"); assert.strictEqual(a.docId, "upcoming_jobs"); assert.strictEqual(a.itemId, String(NOW_MS)); assert.deepStrictEqual(a.fields, ["upcoming_jobs.items", "upcoming_jobs.updated_at"]); assert.strictEqual(a.before, null); assert.deepStrictEqual(a.after, item);
  const dup = await call(io, "upcoming.add", { name: "#2048 - discovery ridge lot 317" }); assert.strictEqual(dup.status, 400); assert.ok(/already has "#2048 - Discovery Ridge Lot 317" \(id 1761000000001\)/.test(dup.body.refused));
  const noName = await call(io, "upcoming.add", { city: "Heber" }); assert.strictEqual(noName.status, 400); assert.ok(/name is required/.test(noName.body.refused));
  const badF = await call(io, "upcoming.add", { name: "X", foreman: "Zed" }); assert.strictEqual(badF.status, 400); assert.ok(/"Zed" isn't on the active team list/.test(badF.body.refused));
  const badD = await call(io, "upcoming.add", { name: "X", projectedStart: "spring" }); assert.strictEqual(badD.status, 400); assert.ok(/projectedStart must be a date/.test(badD.body.refused));
  assert.strictEqual(writes(io, "update").length, 1);
  const missing = fakeIo(); delete missing.store["settings/upcoming_jobs"];
  const r2 = await call(missing, "upcoming.add", { name: "First ever" }); assert.strictEqual(r2.status, 200); const s = writes(missing, "set", "settings/upcoming_jobs"); assert.strictEqual(s.length, 1); assert.deepStrictEqual(Object.keys(s[0][2]).sort(), ["items", "updated_at", ...SETTINGS_STAMP].sort()); assert.strictEqual(r2.body.newDoc, true);
  onlyAllowed(io); onlyAllowed(missing);
});

await ok("handle upcoming.edit: ONE row by id, only the given keys change (before / after per key), the rest of the row and the other rows byte-identical; unchanged values → noop; unknown id / no fields / a blank name are refused; startConfirmed must be a boolean; promote is NOT an action", async () => {
  const io = fakeIo();
  const r = await call(io, "upcoming.edit", { id: "1761000000001", notes: "Hole dug 11/3", lastFollowUp: "11/3/2026", foreman: "Colby", startConfirmed: true, projectedStart: "2026-12-01" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = writes(io, "update", "settings/upcoming_jobs")[0][2];
  assert.deepStrictEqual(upd.items[0], { ...UPCOMING[0], notes: "Hole dug 11/3", lastFollowUp: "11/3/2026", foreman: "Colby", startConfirmed: true, projectedStart: "2026-12-01" });
  assert.deepStrictEqual(r.body.changed, ["notes", "lastFollowUp", "projectedStart", "foreman", "startConfirmed"], "text fields in blankUpcoming order, then foreman, then startConfirmed");
  const a = auditOf(io, rid); assert.deepStrictEqual(a.before, { notes: "No hole yet.", lastFollowUp: "10/8/25", foreman: "", projectedStart: "", startConfirmed: false }); assert.strictEqual(a.after.foreman, "Colby");
  const same = await call(io, "upcoming.edit", { id: "1761000000001", notes: "Hole dug 11/3" }); assert.strictEqual(same.body.noop, true); assert.strictEqual(writes(io, "update").length, 1);
  const bad = async (args, re) => { const x = await call(io, "upcoming.edit", args); assert.strictEqual(x.status, 400, JSON.stringify(x.body)); assert.ok(re.test(x.body.refused), x.body.refused); };
  await bad({ id: "zzz", notes: "x" }, /No Upcoming row has id zzz/);
  await bad({ id: "1761000000001" }, /Nothing to change — give one or more of name, address, city/);
  await bad({ id: "1761000000001", startConfirmed: "yes" }, /startConfirmed must be true or false/);
  await bad({ notes: "x" }, /id must be the Upcoming row's id/);
  assert.ok(!api.ACTIONS.includes("upcoming.promote") && !api.ACTIONS.includes("upcoming.remove"), "no promote, no remove");
  onlyAllowed(io);
});

// ── crew teams + roster ──────────────────────────────────────────────────────
await ok("handle crewTeams.set add: {id: Date.now().toString(36), lead, members} (saveTeamModal's literal) APPENDED, names resolved to the team spelling, the lead never doubled in members; ONE settings/crewTeams update with teams + the stamp; the other teams byte-identical; edit lead / members by id; remove = the team leaves the list and the doc stays; refusals", async () => {
  const io = fakeIo();
  const r = await call(io, "crewTeams.set", { op: "add", lead: "josh", members: ["Abe", "Josh Miller", "abe"] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = writes(io, "update", "settings/crewTeams")[0][2];
  assert.deepStrictEqual(Object.keys(upd).sort(), ["teams", ...SETTINGS_STAMP].sort()); checkSettingsStamp(upd, "2026-11-01T10:00:00.000Z");
  assert.strictEqual(upd.teams.length, 3); assert.deepStrictEqual(upd.teams.slice(0, 2), TEAMS); assert.deepStrictEqual(upd.teams[2], { id: NOW_MS.toString(36), lead: "Josh Miller", members: ["Abe"] });
  assert.strictEqual(r.body.teamId, NOW_MS.toString(36)); assert.strictEqual(r.body.added, true);
  const e = await call(io, "crewTeams.set", { op: "edit", teamId: "t2abc", members: ["Abe", "Keegan"] });
  assert.strictEqual(e.status, 200, JSON.stringify(e.body)); const t2 = io.store["settings/crewTeams"].teams.find(t => t.id === "t2abc"); assert.deepStrictEqual(t2, { id: "t2abc", lead: "Colby", members: ["Abe", "Keegan"] }); assert.deepStrictEqual(e.body.changed, ["members"]);
  const e2 = await call(io, "crewTeams.set", { op: "edit", teamId: "t2abc", lead: "Keegan" });
  assert.deepStrictEqual(io.store["settings/crewTeams"].teams.find(t => t.id === "t2abc"), { id: "t2abc", lead: "Keegan", members: ["Abe"] }, "the new lead drops out of members (saveTeamModal's filter)"); assert.deepStrictEqual(e2.body.changed, ["lead", "members"]);
  const same = await call(io, "crewTeams.set", { op: "edit", teamId: "t2abc", lead: "Keegan" }); assert.strictEqual(same.body.noop, true);
  const rm = await call(io, "crewTeams.set", { op: "remove", teamId: "t1abc" });
  assert.strictEqual(rm.status, 200); assert.deepStrictEqual(io.store["settings/crewTeams"].teams.map(t => t.id), ["t2abc", NOW_MS.toString(36)]); assert.ok(io.store["settings/crewTeams"], "the doc stays"); assert.strictEqual(rm.body.removed, true); assert.deepStrictEqual(auditOf(io, rid).before, TEAMS[0]); assert.strictEqual(auditOf(io, rid).after, null);
  const bad = async (args, re) => { const x = await call(io, "crewTeams.set", args); assert.strictEqual(x.status, 400, JSON.stringify(x.body)); assert.ok(re.test(x.body.refused), x.body.refused); };
  await bad({ op: "add", members: ["Zed"] }, /"Zed" isn't on the active team list/);
  await bad({ op: "add" }, /needs a lead or at least one member/);
  await bad({ op: "edit", teamId: "nope" }, /No crew team has id nope/);
  await bad({ op: "edit", teamId: "t2abc" }, /Give lead and\/or members/);
  await bad({ op: "nuke", teamId: "t2abc" }, /op must be one of add, edit, remove/);
  await bad({ op: "add", lead: "Sub Guy" }, /isn't on the active team list/);
  onlyAllowed(io);
});

await ok("handle crewRoster.set: add appends the team spelling (_saveRoster([...roster, name])), a name already there → noop; remove filters it out (roster.filter), a name not there → noop; ONE settings/crewRoster update with names + the stamp; unknown / contractor names refused; a missing doc is set with the stamp", async () => {
  const io = fakeIo();
  const r = await call(io, "crewRoster.set", { op: "add", name: "josh" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const upd = writes(io, "update", "settings/crewRoster")[0][2]; assert.deepStrictEqual(Object.keys(upd).sort(), ["names", ...SETTINGS_STAMP].sort()); assert.deepStrictEqual(upd.names, ["Keegan", "Colby", "Abe", "Josh Miller"]); checkSettingsStamp(upd, "2026-11-01T10:00:00.000Z");
  assert.strictEqual(r.body.added, true); assert.strictEqual(r.body.name, "Josh Miller"); assert.strictEqual(auditOf(io, rid).itemId, "Josh Miller");
  const dup = await call(io, "crewRoster.set", { op: "add", name: "Abe" }); assert.strictEqual(dup.body.noop, true);
  const rm = await call(io, "crewRoster.set", { op: "remove", name: "Abe" }); assert.strictEqual(rm.status, 200); assert.deepStrictEqual(io.store["settings/crewRoster"].names, ["Keegan", "Colby", "Josh Miller"]); assert.strictEqual(rm.body.removed, true);
  const gone = await call(io, "crewRoster.set", { op: "remove", name: "Abe" }); assert.strictEqual(gone.body.noop, true);
  assert.strictEqual(writes(io, "update").length, 2);
  const bad = async (args, re) => { const x = await call(io, "crewRoster.set", args); assert.strictEqual(x.status, 400, JSON.stringify(x.body)); assert.ok(re.test(x.body.refused), x.body.refused); };
  await bad({ op: "add", name: "Zed" }, /"Zed" isn't on the active team list/);
  await bad({ op: "add", name: "Sub Guy" }, /isn't on the active team list/);
  await bad({ op: "add" }, /name is required/);
  await bad({ op: "drop", name: "Abe" }, /op must be add or remove/);
  const missing = fakeIo(); delete missing.store["settings/crewRoster"];
  const r2 = await call(missing, "crewRoster.set", { op: "add", name: "Koy" }); assert.strictEqual(r2.status, 200); assert.deepStrictEqual(writes(missing, "set", "settings/crewRoster")[0][2].names, ["Koy"]); assert.strictEqual(r2.body.newDoc, true);
  onlyAllowed(io); onlyAllowed(missing);
});

// ── allowlist / api.js pins ──────────────────────────────────────────────────
await ok("api.js: the seven office actions are routed by office(); BUILD 609; SETTINGS_DOCS = the ship-5/9 rows + crewTeams.teams (now written) + crewRoster.names + upcoming_jobs.items/updated_at and NOTHING else (settings/users, main, appGate still refused before any read); the door's two tx.delete are the only ones, exactly five .delete(, eight tx.create; the sender and the decider are called through io, never required as copies", async () => {
  assert.deepStrictEqual(api.OFFICE_ACTIONS, ["broadcast.send", "autoTask.promote", "planIntake.decide", "upcoming.add", "upcoming.edit", "crewTeams.set", "crewRoster.set"]);
  for (const a of api.OFFICE_ACTIONS) assert.ok(api.ACTIONS.includes(a) && !api.JOB_WRITE_ACTIONS.includes(a) && !api.JOB_SETUP_ACTIONS.includes(a), a);
  assert.ok(api.BUILD >= 609);   // ship 11 bumped it to 610 assert.strictEqual(api.BROADCAST_PER_HOUR, 10);
  assert.deepStrictEqual(api.SETTINGS_DOCS, { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: ["teams"], simproCandidates: ["candidates"], crewRoster: ["names"], upcoming_jobs: ["items", "updated_at"] });
  for (const id of ["users", "main", "appGate", "deviceVersions", "ccSnapshot", "upcoming", "crew", ""]) assert.strictEqual(api.settingsDocAllowed(id), false, id);
  const io = fakeIo();
  // every office action's settings reads went through settingsRef, and only to its own doc
  await call(io, "upcoming.edit", { id: "1761000000001", notes: "x" }); await call(io, "crewTeams.set", { op: "remove", teamId: "t1abc" }); await call(io, "crewRoster.set", { op: "add", name: "Koy" });
  assert.deepStrictEqual([...new Set(io.log.filter(l => l[0] === "settingsRef").map(l => l[1]))], ["upcoming_jobs", "crewTeams", "crewRoster"], "each action opens its own doc only (once to read, once to write)");
  assert.ok(!io.log.some(l => l[0] === "get" && l[1] === "settings/main"), "settings/main never read");
  assert.strictEqual((apiSrc.match(/tx\.delete\(/g) || []).length, 2, "exactly two tx.delete in api.js, both the door's (ship 12): doc.delete (confirm word = the docId) and its undo's docDelete (a plain create taken back)"); assert.strictEqual((apiSrc.match(/\.delete\(/g) || []).length, 5); assert.strictEqual((apiSrc.match(/tx\.create\(/g) || []).length, 8, "the task, the import, the project, the building, the promoted auto task, the door's three (ship 12: data create, plain create, the undo's docCreate)");
  assert.ok(!/require\("\.\.\/index\.js"\)/.test(apiSrc) && !/require\("\.\.\/planIntake\/watcher\.js"\)/.test(apiSrc), "api.js never requires index.js / watcher.js — the real functions arrive through officeDeps");
  assert.ok(/od\.sendBroadcastAs\(user, payload\)/.test(apiSrc) && /od\.planDecide\(itemId, body\)/.test(apiSrc), "called through officeDeps");
  assert.ok(!/broadcasts"\)/.test(apiSrc) && !/collection\("agentQueue"\)|collection\("planIntakeState"\)|collection\("agentFindings"\)|collection\("notifications"\)/.test(apiSrc), "api.js opens none of broadcasts / notifications / agentQueue / planIntakeState / agentFindings itself");
  assert.ok(!/stampDivision|computeTasks\(/.test(officeSrc), "office.js does not pretend to run the task engine");
  onlyAllowed(io);
});

await ok("handle: an unknown office-ish action is refused by the ACTIONS gate; a deterministic refusal replays the same way; a refusal audit names the doc", async () => {
  const io = fakeIo();
  await assert.rejects(call(io, "upcoming.promote", { id: "x" }), (e) => e instanceof api.Refusal && e.status === 400 && /action must be one of/.test(e.message));
  const r1 = await call(io, "crewRoster.set", { op: "add", name: "Zed" }, RID("rr"));
  const r2 = await call(io, "crewRoster.set", { op: "add", name: "Zed" }, RID("rr"));
  assert.strictEqual(r1.status, 400); assert.strictEqual(r2.status, 400); assert.strictEqual(r2.body.replayed, true);
  assert.strictEqual(io.store["duet_writes/" + RID("rr")].coll, "settings"); assert.strictEqual(io.store["duet_writes/" + RID("rr")].docId, "crewRoster");
});

console.log(`duet-office-test: ${n} checks passed`);
})().catch((e) => { console.error("duet-office-test FAILED:", e && e.stack || e); process.exit(1); });
