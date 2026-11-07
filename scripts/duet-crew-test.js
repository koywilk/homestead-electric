#!/usr/bin/env node
/* duet-crew-test.js — Duet write access (connector D9), ship 5: the weekly
 * Crew Planner, a job's foreman / lead / coordinator, time-off approvals.
 *
 * Drives functions/duetWrites/crew.js + timeOff.js (the planners) and
 * functions/duetWrites/api.js (the handler) against a fake Firestore
 * transaction holding a real-shaped week doc, job, teams, PTO list, time-off
 * list and board task. Proves: the Monday math on a YYYY-MM-DD (incl. a
 * Sunday-night UTC instant that is still Sunday in Mountain time) and the
 * weekend refusal; assignPerson's rule (a foreman into a cell with no lead →
 * lead, else crew, never twice); unassignPerson (an emptied cell is deleted);
 * crewToggleLead's make-lead half; assignTeam's expansion with PTO skipped;
 * one cell per write as FieldPath("assignments", key) + the settings stamp,
 * every other cell byte-identical; a missing week doc created with the app's
 * first-write shape; unknown / off / archived refusals; job people as ONE
 * scalar with the job envelope, "Unassigned" the foreman sentinel; time off:
 * the three writes exact, approve adds the PTO mirror once, deny / pending
 * pull it, pending reopens the need, a missing need is skipped, a decided
 * request refuses without force; and the settings allowlist — settings/users
 * or any other settings doc is refused before any read. No Firebase import.
 * Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const CR = require(path.join(root, "functions", "duetWrites", "crew.js"));
const TO = require(path.join(root, "functions", "duetWrites", "timeOff.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-03T20:15:00.000Z";          // Tue 1:15 PM Mountain
const TODAY = "2026-11-03";
const TZ = "America/Denver";
const USERS = [
  { id: 1, name: "Koy", title: "office", access: "admin" },
  { id: 2, name: "Josh", title: "office", access: "manager" },
  { id: 3, name: "Colby", title: "foreman" },
  { id: 4, name: "Keegan", title: "foreman" },
  { id: 5, name: "Daegan", title: "lead" },
  { id: 6, name: "Brady", title: "crew" },
  { id: 7, name: "Abe", title: "crew" },
  { id: 9, name: "Jon", title: "crew" },
  { id: 10, name: "Vasa", role: "foreman" },                 // legacy record: role, no title
  { id: 8, name: "Old Guy", title: "foreman", active: false },
  { id: 11, name: "Sub Guy", title: "crew", access: "contractor" },
];
const FORTH = "1772863862618", MILLER = "1772863862619", GONE = "1772863862620";
const MON = "2026-11-09";                         // a Monday
const WEEK = { assignments: {
  [FORTH + "_0"]: { lead: "Keegan", crew: ["Brady"], time: { start: "7:00", end: "15:30" } },
  [MILLER + "_2"]: { lead: "", crew: ["Abe"] },
  [FORTH + "_4"]: { lead: "", crew: ["Jon"] },
}, extraJobs: ["x1"], jobOrder: [FORTH, MILLER], pinnedJobs: [], hoursByJob: { [FORTH]: { rough: 40 } }, needsBodies: [MILLER], updatedAt: "2026-11-02T15:00:00.000Z", tab: "t9", merged: false };
const TEAMS = { teams: [{ id: "t1", lead: "Keegan", members: ["Brady", "Abe"] }, { id: "t2", lead: "Colby", members: ["Jon"] }, { id: "t3", lead: "", members: [] }], updatedAt: "x" };
const PTO = { list: [{ id: "pto_to_dec1234xyz", timeoffId: "to_dec1234xyz", name: "Brady", start: "11/20/2026", end: "11/21/2026", note: "Time off", usePaid: false },
  { id: "k1", name: "Abe", start: "11/11/2026", end: "", note: "Hunting" }], updatedAt: "2026-11-01T10:00:00.000Z" };
const R1 = { id: "to_abc1234lmn", name: "Daegan", start: "2026-11-09", end: "2026-11-09", note: "Dentist", usePaid: true, status: "pending", requestedAt: "2026-11-02T18:00:00.000Z" };
const R2 = { id: "to_dec1234xyz", name: "Brady", start: "11/20/2026", end: "11/21/2026", note: "", usePaid: false, status: "approved", requestedAt: "2026-10-30T18:00:00.000Z", decidedBy: "Josh", decidedAt: "2026-11-01T10:00:00.000Z" };
const R3 = { id: "to_koy1234self", name: "Koy", start: "2026-12-01", end: "2026-12-01", note: "", usePaid: true, status: "pending", requestedAt: "2026-11-03T10:00:00.000Z" };
const REQS = { list: [R3, R1, R2], updatedAt: "2026-11-03T10:00:00.000Z", tab: "t2", merged: false };
const NEED1 = { id: "toneed_" + R1.id, kind: "task", text: "Time off — Daegan: 2026-11-09 (PTO) — Dentist", assignedTo: "Koy", assignedBy: "Koy", assignedAt: "2026-11-02T18:00:00.000Z", createdBy: "", requestedBy: "Daegan", timeoffId: R1.id, dueDate: "2026-11-09", dueBucket: "week", status: "open", startedBy: "Koy", startedAt: "2026-11-03T12:00:00.000Z" };
const clone = (x) => JSON.parse(JSON.stringify(x));
const JOB_DOC = (name, extra) => ({ data: { name, foreman: "Keegan", lead: "Colby", coordinator: "", archived: false, changeOrders: [{ id: "c1" }], ...(extra || {}) }, updated_at: NOW, saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 603, w: "603.abcdefgh" });
const ctx = (over) => ({ nowIso: NOW, todayYmd: TODAY, bucketNow: `${TODAY}T12:00:00`, users: USERS, tz: TZ, ...(over || {}) });

// ── fake io ──────────────────────────────────────────────────────────────────
function fakeIo({ docs = {}, recent = 0, users = USERS, now = NOW, today = TODAY } = {}) {
  const log = [];
  const store = clone(docs);
  const settingsAsked = [];
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const setPath = (obj, dotted, v) => {
    const parts = dotted.split("."); let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]])) cur[parts[i]] = {}; cur = cur[parts[i]]; }
    if (v && v.__delete) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = v;
  };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path]); if (store[r.path]) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } store[r.path] = d; },
    // Both forms the Admin SDK takes: an object of dotted keys, or alternating field, value, field, value…
    update: (r, ...rest) => {
      let d;
      if (rest.length === 1 && isObj(rest[0])) d = rest[0];
      else { d = {}; for (let i = 0; i < rest.length; i += 2) d[String(rest[i])] = rest[i + 1]; log.push(["updateForm", r.path, "fieldPath"]); }
      log.push(["update", r.path, d]);
      if (!store[r.path]) throw new Error("update on a missing doc: " + r.path);
      const cur = clone(store[r.path]); Object.keys(d).forEach(k => setPath(cur, k, d[k])); store[r.path] = cur;
    },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called inside a transaction"); },
  };
  return {
    log, store, settingsAsked,
    nowIso: () => now, todayYmd: () => today, rand: () => "abcde", tz: TZ,
    getAudit: async (id) => store["duet_writes/" + id] || null,
    countRecent: async () => recent,
    getJob: async () => null,
    getUsers: async () => users,
    openNeeds: async () => [],
    runTx: async (fn) => fn(tx),
    needRef: (id) => ref("needs", id),
    jobRef: (id) => ref("jobs", id),
    hrRef: (id) => ref("homeowner_requests", id),
    auditRef: (id) => ref("duet_writes", id),
    // The real io throws on an id outside SETTINGS_DOCS; the fake records every ask and does the same.
    settingsRef: (id) => { settingsAsked.push(id); if (!api.settingsDocAllowed(id)) throw new api.Refusal(400, "settings/" + id + " is not a document Duet may touch."); return ref("settings", id); },
    fieldPath: (...segs) => segs.join("."),
    deleteField: () => ({ __delete: true }),
    arrayUnion: (...x) => ({ __arrayUnion: x }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
}
const DOCS = () => ({
  ["jobs/" + FORTH]: JOB_DOC("Forth"), ["jobs/" + MILLER]: JOB_DOC("Miller", { foreman: "Colby", lead: "" }), ["jobs/" + GONE]: JOB_DOC("Gone", { archived: true }),
  ["settings/schedule_" + MON]: clone(WEEK), "settings/crewTeams": clone(TEAMS), "settings/crewPTO": clone(PTO), "settings/timeOffRequests": clone(REQS),
  ["needs/" + NEED1.id]: { data: clone(NEED1), updated_at: "2026-11-02T18:00:00.000Z", saved_by: "Daegan" },
});
const run = (body, io) => api.handle(body, io);
const RID = "55555555-5555-4555-8555-555555555555";
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const NEED_ENVELOPE = ["app_build", "device", "saved_by", "tab", "updated_at", "w"];
const checkStamp = (upd, withActivity) => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.ok(upd.tab.startsWith("duet-5555"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 604 && /^\d+\.duet[a-z0-9]{6,}$/.test(upd.w), "version-lock stamp");
  if (withActivity) { assert.strictEqual(upd.merged, false); assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true }); }
};
const settingsWrite = (io, docId) => io.log.filter(l => (l[0] === "update" || l[0] === "set") && l[1] === "settings/" + docId).map(l => l[2]);

// ── dates ────────────────────────────────────────────────────────────────────
ok("weekFor: Mon–Fri → that week's Monday + dayIdx, Saturday / Sunday / bad dates refused, a week across a month end", () => {
  assert.deepStrictEqual(CR.weekFor("2026-11-09"), { monday: "2026-11-09", dayIdx: 0, label: "Mon", docId: "schedule_2026-11-09" });
  assert.deepStrictEqual(CR.weekFor("2026-11-11"), { monday: "2026-11-09", dayIdx: 2, label: "Wed", docId: "schedule_2026-11-09" });
  assert.deepStrictEqual(CR.weekFor("2026-11-13"), { monday: "2026-11-09", dayIdx: 4, label: "Fri", docId: "schedule_2026-11-09" });
  assert.deepStrictEqual(CR.weekFor("2026-12-01"), { monday: "2026-11-30", dayIdx: 1, label: "Tue", docId: "schedule_2026-11-30" });
  assert.match(CR.weekFor("2026-11-14").refused, /Saturday/); assert.match(CR.weekFor("2026-11-08").refused, /Sunday/);
  for (const bad of ["2026-02-30", "11/09/2026", "2026-11-9", "", "tomorrow"]) assert.match(CR.weekFor(bad).refused, /YYYY-MM-DD/, bad);
  assert.strictEqual(CR.dayOfWeek("2026-11-03"), 2, "today is a Tuesday");
});
ok("Monday math in Mountain time: 10:30 PM Sunday in Denver is already Monday in UTC — todayYmd stays Sunday, so a no-date call on a Sunday night refuses", () => {
  assert.strictEqual(CR.todayYmdFor("2026-11-09T05:30:00Z", TZ), "2026-11-08");       // Sun 10:30 PM MST
  assert.strictEqual(CR.todayYmdFor("2026-11-09T13:00:00Z", TZ), "2026-11-09");       // Mon 6:00 AM MST
  assert.strictEqual(CR.todayYmdFor("2026-11-14T05:59:00Z", TZ), "2026-11-13");       // Fri 10:59 PM MST → still Friday
  assert.match(CR.weekFor(CR.todayYmdFor("2026-11-09T05:30:00Z", TZ)).refused, /Sunday/);
  assert.strictEqual(CR.weekFor(CR.todayYmdFor("2026-11-14T05:59:00Z", TZ)).dayIdx, 4);
  assert.strictEqual(CR.weekFor(CR.todayYmdFor("2026-11-14T07:00:00Z", TZ)).refused.includes("Saturday"), true);   // midnight MST = 07:00Z in November
});
ok("isForeman reads title (or legacy role) on active users; onPTO matches name, M/D/YYYY or ISO, both ends inclusive, a blank end = the start", () => {
  assert.strictEqual(CR.isForeman("Keegan", USERS), true); assert.strictEqual(CR.isForeman("keegan", USERS), true); assert.strictEqual(CR.isForeman("Vasa", USERS), true);
  assert.strictEqual(CR.isForeman("Brady", USERS), false); assert.strictEqual(CR.isForeman("Daegan", USERS), false); assert.strictEqual(CR.isForeman("Old Guy", USERS), false);
  assert.ok(CR.onPTO("Brady", "2026-11-20", PTO.list)); assert.ok(CR.onPTO("Brady", "2026-11-21", PTO.list)); assert.strictEqual(CR.onPTO("Brady", "2026-11-22", PTO.list), null); assert.strictEqual(CR.onPTO("Brady", "2026-11-19", PTO.list), null);
  assert.ok(CR.onPTO("abe", "2026-11-11", PTO.list)); assert.strictEqual(CR.onPTO("Abe", "2026-11-12", PTO.list), null);
  assert.strictEqual(CR.ptoYmd("11/5/26"), "2026-11-05"); assert.strictEqual(CR.ptoYmd("2026-11-05"), "2026-11-05"); assert.strictEqual(CR.ptoYmd("soon"), null);
});

// ── the planner's mutators ───────────────────────────────────────────────────
ok("assignPerson: a foreman into a cell with no lead → lead; a foreman into a cell with a lead → crew; crew → crew; already there → no-op (case-insensitive); the cell's time is carried", () => {
  assert.deepStrictEqual(CR.assignPersonCell(null, "Colby", true), { cell: { lead: "Colby", crew: [] } });
  assert.deepStrictEqual(CR.assignPersonCell({ lead: "", crew: ["Brady"], time: { start: "7" } }, "Colby", true), { cell: { lead: "Colby", crew: ["Brady"], time: { start: "7" } } });
  assert.deepStrictEqual(CR.assignPersonCell({ lead: "Keegan", crew: [] }, "Colby", true), { cell: { lead: "Keegan", crew: ["Colby"] } });
  assert.deepStrictEqual(CR.assignPersonCell(null, "Brady", false), { cell: { lead: "", crew: ["Brady"] } });
  assert.strictEqual(CR.assignPersonCell({ lead: "Keegan", crew: ["Brady"] }, "brady", false).noop, true);
  assert.strictEqual(CR.assignPersonCell({ lead: "Keegan", crew: [] }, "KEEGAN", true).noop, true);
});
ok("unassignPerson: the lead cleared when it was them, crew filtered, an emptied cell deleted, a person not on it → no-op; the rebuilt cell is {lead, crew} (the app drops time, as it does)", () => {
  assert.deepStrictEqual(CR.unassignPersonCell({ lead: "", crew: ["Jon"] }, "Jon"), { cell: null, deleted: true });
  assert.deepStrictEqual(CR.unassignPersonCell({ lead: "Keegan", crew: [] }, "keegan"), { cell: null, deleted: true });
  assert.deepStrictEqual(CR.unassignPersonCell({ lead: "Keegan", crew: ["Brady"], time: { start: "7" } }, "Keegan"), { cell: { lead: "", crew: ["Brady"] } });
  assert.deepStrictEqual(CR.unassignPersonCell({ lead: "Keegan", crew: ["Brady", "Abe"] }, "Brady"), { cell: { lead: "Keegan", crew: ["Abe"] } });
  assert.strictEqual(CR.unassignPersonCell({ lead: "Keegan", crew: [] }, "Brady").noop, true); assert.strictEqual(CR.unassignPersonCell(null, "Brady").noop, true);
});
ok("setLead (crewToggleLead's make-lead half): off crew, onto lead, the old lead onto crew; already lead → no-op", () => {
  assert.deepStrictEqual(CR.setLeadCell({ lead: "Keegan", crew: ["Brady", "Abe"] }, "Brady"), { cell: { lead: "Brady", crew: ["Abe", "Keegan"] } });
  assert.deepStrictEqual(CR.setLeadCell({ lead: "", crew: ["Brady"], time: { start: "7" } }, "Brady"), { cell: { lead: "Brady", crew: [], time: { start: "7" } } });
  assert.strictEqual(CR.setLeadCell({ lead: "Brady", crew: [] }, "Brady").noop, true);
});
ok("assignTeam: lead → members in order, each by assignPerson's rule against the growing cell; people already on it skipped; nobody new → no-op", () => {
  const isF = (x) => CR.isForeman(x, USERS);
  assert.deepStrictEqual(CR.assignTeamCell(null, ["Keegan", "Brady", "Abe"], isF), { cell: { lead: "Keegan", crew: ["Brady", "Abe"] }, added: ["Keegan", "Brady", "Abe"] });
  assert.deepStrictEqual(CR.assignTeamCell({ lead: "Colby", crew: [] }, ["Keegan", "Brady"], isF), { cell: { lead: "Colby", crew: ["Keegan", "Brady"] }, added: ["Keegan", "Brady"] });
  assert.deepStrictEqual(CR.assignTeamCell({ lead: "", crew: ["Abe"] }, ["Keegan", "Brady", "Abe"], isF), { cell: { lead: "Keegan", crew: ["Abe", "Brady"] }, added: ["Keegan", "Brady"] });
  assert.strictEqual(CR.assignTeamCell({ lead: "Keegan", crew: ["Brady"] }, ["Keegan", "brady"], isF).noop, true);
});
ok("findTeam: \"Keegan's crew\" → his team; a team id; a member's name → the team he is on; an unknown or team-less name refused with the roster hint", () => {
  assert.strictEqual(CR.findTeam(TEAMS.teams, "Keegan's crew", USERS).team.id, "t1");
  assert.strictEqual(CR.findTeam(TEAMS.teams, "colby", USERS).team.id, "t2");
  assert.strictEqual(CR.findTeam(TEAMS.teams, "t2", USERS).team.id, "t2");
  assert.strictEqual(CR.findTeam(TEAMS.teams, "Jon", USERS).team.id, "t2");
  assert.match(CR.findTeam(TEAMS.teams, "Daegan", USERS).refused, /isn't on any crew team/);
  assert.match(CR.findTeam(TEAMS.teams, "Zed", USERS).refused, /isn't on the active team list/);
  assert.match(CR.findTeam([], "Keegan", USERS).refused, /no crew teams/);
  assert.deepStrictEqual(CR.teamMembers(TEAMS.teams[0]), ["Keegan", "Brady", "Abe"]);
});

(async () => {
  // ── crew.assign / unassign / setLead through the handler ─────────────────
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.assign", email: "koy@homesteadelectric.net", args: { jobId: FORTH, date: "2026-11-11", person: "colby" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual({ week: r.body.week, day: r.body.day, key: r.body.key, people: r.body.people, role: r.body.role, cell: r.body.cell, newWeekDoc: r.body.newWeekDoc }, { week: MON, day: "Wed", key: FORTH + "_2", people: ["Colby"], role: "lead", cell: { lead: "Colby", crew: [] }, newWeekDoc: false });
    assert.deepStrictEqual(io.log.map(l => l[0]), ["get", "get", "get", "updateForm", "update", "set"], "job, week doc, crewPTO read; ONE field-path update; audit — one transaction (no crewTeams read without a team)");
    assert.deepStrictEqual(io.log[1][1], "settings/schedule_" + MON); assert.deepStrictEqual(io.log[2][1], "settings/crewPTO");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), ["assignments." + FORTH + "_2", "merged", "tab", "updatedAt"], "the ONE cell as FieldPath(assignments, key) + the app's settings stamp, nothing else");
    assert.deepStrictEqual(upd["assignments." + FORTH + "_2"], { lead: "Colby", crew: [] }); assert.strictEqual(upd.merged, false); assert.ok(upd.tab.startsWith("duet-5555")); assert.ok(upd.updatedAt > WEEK.updatedAt);
    const week = io.store["settings/schedule_" + MON];
    assert.deepStrictEqual(week.assignments[FORTH + "_0"], WEEK.assignments[FORTH + "_0"]); assert.deepStrictEqual(week.assignments[MILLER + "_2"], WEEK.assignments[MILLER + "_2"]); assert.deepStrictEqual(week.assignments[FORTH + "_4"], WEEK.assignments[FORTH + "_4"]);
    assert.deepStrictEqual({ e: week.extraJobs, o: week.jobOrder, h: week.hoursByJob, nb: week.needsBodies }, { e: WEEK.extraJobs, o: WEEK.jobOrder, h: WEEK.hoursByJob, nb: WEEK.needsBodies }, "the rest of the week doc untouched");
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual({ coll: audit.coll, docId: audit.docId, fields: audit.fields, before: audit.before, after: audit.after, jobId: audit.jobId, dayIdx: audit.dayIdx }, { coll: "settings", docId: "schedule_" + MON, fields: ["assignments." + FORTH + "_2"], before: null, after: { lead: "Colby", crew: [] }, jobId: FORTH, dayIdx: 2 });
    assert.deepStrictEqual(audit.response.body, r.body);
    n++; console.log("ok   handle crew.assign: a foreman onto an empty Wed cell becomes lead; ONE FieldPath cell + settings stamp; other cells and the rest of the doc byte-identical; audit in the same tx");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Colby" } }, io);
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.role, "crew");
    assert.deepStrictEqual(io.store["settings/schedule_" + MON].assignments[FORTH + "_0"], { lead: "Keegan", crew: ["Brady", "Colby"], time: { start: "7:00", end: "15:30" } }, "a second foreman goes onto crew; time carried");
    const r2 = await run({ requestId: RID + "b", action: "crew.assign", args: { jobId: FORTH, date: MON, person: "josh" } }, io);
    assert.strictEqual(r2.body.role, "crew"); assert.deepStrictEqual(io.store["settings/schedule_" + MON].assignments[FORTH + "_0"].crew, ["Brady", "Colby", "Josh"]);
    const before = io.log.length;
    const r3 = await run({ requestId: RID + "c", action: "crew.assign", args: { jobId: FORTH, date: MON, person: "BRADY" } }, io);
    assert.strictEqual(r3.status, 200); assert.strictEqual(r3.body.noop, true); assert.match(r3.body.message, /already on that cell/);
    assert.deepStrictEqual(io.log.slice(before).filter(l => l[0] === "update").length, 0, "a duplicate assign writes nothing but its audit");
    const rep = await run({ requestId: RID, action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Colby" } }, io);
    assert.strictEqual(rep.body.replayed, true); assert.strictEqual(rep.body.role, "crew");
    n++; console.log("ok   handle crew.assign: a cell with a lead takes a foreman and an office person onto crew (no duplicates, case-insensitive), time kept; a repeat requestId replays");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.unassign", args: { jobId: FORTH, date: "2026-11-13", person: "Jon" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.cellDeleted, true); assert.strictEqual(r.body.cell, null);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(upd["assignments." + FORTH + "_4"], { __delete: true }, "the emptied cell is FieldValue.delete() on the ONE map key — unassignPerson's `delete nx[k]`");
    assert.deepStrictEqual(Object.keys(upd).sort(), ["assignments." + FORTH + "_4", "merged", "tab", "updatedAt"]);
    const week = io.store["settings/schedule_" + MON];
    assert.ok(!(FORTH + "_4" in week.assignments)); assert.deepStrictEqual(Object.keys(week.assignments).sort(), [FORTH + "_0", MILLER + "_2"].sort());
    assert.deepStrictEqual(week.assignments[FORTH + "_0"], WEEK.assignments[FORTH + "_0"]);
    const audit = io.store["duet_writes/" + RID]; assert.deepStrictEqual(audit.before, { lead: "", crew: ["Jon"] }); assert.strictEqual(audit.after, null); assert.strictEqual(audit.cellDeleted, true);
    const r2 = await run({ requestId: RID + "b", action: "crew.unassign", args: { jobId: FORTH, date: MON, person: "brady" } }, io);
    assert.strictEqual(r2.body.cellDeleted, false); assert.deepStrictEqual(r2.body.cell, { lead: "Keegan", crew: [] }, "the app rebuilds the cell as {lead, crew} — time is dropped, as unassignPerson does");
    const r3 = await run({ requestId: RID + "c", action: "crew.unassign", args: { jobId: MILLER, date: MON, person: "Abe" } }, io);
    assert.strictEqual(r3.body.noop, true); assert.match(r3.body.message, /isn't on that cell/);
    n++; console.log("ok   handle crew.unassign: the last person deletes the cell (FieldValue.delete on the key), the lead stays when crew leaves, a person not on the cell is a no-op; other cells byte-identical");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.setLead", args: { jobId: FORTH, date: MON, person: "Brady" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.previousLead, "Keegan");
    assert.deepStrictEqual(io.store["settings/schedule_" + MON].assignments[FORTH + "_0"], { lead: "Brady", crew: ["Keegan"], time: { start: "7:00", end: "15:30" } }, "crewToggleLead: Brady lead, Keegan onto crew, time kept");
    const r2 = await run({ requestId: RID + "b", action: "crew.setLead", args: { jobId: FORTH, date: MON, person: "Brady" } }, io);
    assert.strictEqual(r2.body.noop, true);
    const r3 = await run({ requestId: RID + "c", action: "crew.setLead", args: { jobId: FORTH, date: MON, person: "Colby" } }, io);
    assert.strictEqual(r3.status, 400); assert.match(r3.body.refused, /isn't on Forth Mon 2026-11-09 — assign first/);
    assert.deepStrictEqual(io.store["settings/schedule_" + MON].assignments[FORTH + "_0"].lead, "Brady", "nothing written by the refusal");
    n++; console.log("ok   handle crew.setLead: the make-lead half of crewToggleLead; already lead is a no-op; someone not on the cell refuses");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.assign", args: { jobId: MILLER, date: "2026-11-11", team: "Keegan's crew" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual({ people: r.body.people, skippedOff: r.body.skippedOff, team: r.body.team, cell: r.body.cell }, { people: ["Keegan", "Brady"], skippedOff: ["Abe"], team: "t1", cell: { lead: "Keegan", crew: ["Abe", "Brady"] } }, "assignTeam: Keegan lead (foreman, no lead), Brady crew, Abe skipped — he is off Nov 11 — and the Abe already on the cell kept");
    assert.deepStrictEqual(io.log.map(l => l[0]), ["get", "get", "get", "get", "updateForm", "update", "set"]); assert.strictEqual(io.log[2][1], "settings/crewTeams");
    const r2 = await run({ requestId: RID + "b", action: "crew.assign", args: { jobId: MILLER, date: "2026-11-11", team: "Keegan" } }, io);
    assert.strictEqual(r2.body.noop, true);
    const r3 = await run({ requestId: RID + "c", action: "crew.unassign", args: { jobId: MILLER, date: "2026-11-11", team: "Keegan" } }, io);
    assert.strictEqual(r3.status, 400); assert.match(r3.body.refused, /only be assigned/);
    const r4 = await run({ requestId: RID + "d", action: "crew.assign", args: { jobId: FORTH, date: "2026-11-11", team: "Daegan" } }, io);
    assert.strictEqual(r4.status, 400); assert.match(r4.body.refused, /isn't on any crew team/);
    n++; console.log("ok   handle crew.assign team: settings/crewTeams read only, lead + members expanded, PTO skipped and reported, unassign-by-team refused");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "crew.assign", args: { jobId: FORTH, date: "2026-11-17", person: "Keegan" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.newWeekDoc, true); assert.strictEqual(r.body.week, "2026-11-16");
    const set = io.log.find(l => l[0] === "set" && l[1] === "settings/schedule_2026-11-16")[2];
    assert.deepStrictEqual(Object.keys(set).sort(), ["assignments", "merged", "tab", "updatedAt"], "a missing week doc is created with the app's first _saveCrewData shape: {assignments} + the settings stamp");
    assert.deepStrictEqual(set.assignments, { [FORTH + "_1"]: { lead: "Keegan", crew: [] } });
    assert.ok(!io.log.some(l => l[0] === "updateForm"));
    const r2 = await run({ requestId: RID + "b", action: "crew.unassign", args: { jobId: FORTH, date: "2026-11-24", person: "Keegan" } }, io);
    assert.strictEqual(r2.body.noop, true); assert.ok(!io.store["settings/schedule_2026-11-23"], "unassign on a week with no doc writes nothing");
    n++; console.log("ok   handle crew.assign on a week with no doc yet: tx.set with the app's blank shape + the cell; unassign on a missing week is a no-op");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const sat = await run({ requestId: RID, action: "crew.assign", args: { jobId: FORTH, date: "2026-11-14", person: "Colby" } }, io);
    assert.strictEqual(sat.status, 400); assert.match(sat.body.refused, /Saturday — the Crew Planner runs Monday to Friday/);
    assert.ok(!io.log.some(l => l[0] === "get"), "weekend refused before any read");
    const sun = fakeIo({ docs: DOCS(), now: "2026-11-09T05:30:00Z", today: CR.todayYmdFor("2026-11-09T05:30:00Z", TZ) });
    const r = await run({ requestId: RID, action: "crew.assign", args: { jobId: FORTH, person: "Colby" } }, sun);
    assert.strictEqual(r.status, 400); assert.match(r.body.refused, /2026-11-08 is a Sunday/, "no date on a Sunday night (already Monday in UTC) is still Sunday in Mountain time");
    const zed = await run({ requestId: RID + "b", action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Bra" } }, io);
    assert.strictEqual(zed.status, 400); assert.match(zed.body.refused, /"Bra" isn't on the active team list. Close: Brady/);
    const sub = await run({ requestId: RID + "c", action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Sub Guy" } }, io);
    assert.strictEqual(sub.status, 400, "a contractor is not on the roster the planner offers");
    const old = await run({ requestId: RID + "d", action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Old Guy" } }, io);
    assert.strictEqual(old.status, 400);
    const off = await run({ requestId: RID + "e", action: "crew.assign", args: { jobId: FORTH, date: "2026-11-11", person: "Abe" } }, io);
    assert.strictEqual(off.status, 400); assert.match(off.body.refused, /Abe is off Wed 2026-11-11 \(time off: Hunting\)/);
    const arch = await run({ requestId: RID + "f", action: "crew.assign", args: { jobId: GONE, date: MON, person: "Colby" } }, io);
    assert.strictEqual(arch.status, 400); assert.match(arch.body.refused, /archived/);
    const gone = await run({ requestId: RID + "g", action: "crew.assign", args: { jobId: "1700000000000", date: MON, person: "Colby" } }, io);
    assert.strictEqual(gone.status, 404);
    const badOp = await run({ requestId: RID + "h", action: "crew.assign", args: { jobId: FORTH, date: MON } }, io);
    assert.strictEqual(badOp.status, 400); assert.match(badOp.body.refused, /Say who/);
    assert.deepStrictEqual(io.store["settings/schedule_" + MON].assignments, WEEK.assignments, "no refusal changed a cell");
    n++; console.log("ok   handle crew.*: weekend (before any read), Sunday-night Mountain, unknown name with hints, contractor, deactivated, PTO, archived and missing job all refuse and write nothing");
  })();

  // ── job.setPeople ─────────────────────────────────────────────────────────
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "job.setPeople", args: { jobId: FORTH, foreman: "colby" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual({ field: r.body.field, from: r.body.from, to: r.body.to, foreman: r.body.foreman, pushTo: r.body.pushTo }, { field: "foreman", from: "Keegan", to: "Colby", foreman: "Colby", pushTo: ["Colby"] });
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), [...ENVELOPE, "data.foreman"].sort(), "ONE scalar as data.foreman + the job envelope — u({foreman}) through saveJob");
    assert.strictEqual(upd["data.foreman"], "Colby"); checkStamp(upd, true); assert.ok(upd.updated_at > NOW);
    const audit = io.store["duet_writes/" + RID]; assert.deepStrictEqual({ coll: audit.coll, fields: audit.fields, before: audit.before, after: audit.after }, { coll: "jobs", fields: ["foreman"], before: { foreman: "Keegan" }, after: { foreman: "Colby" } });
    assert.deepStrictEqual(io.store["jobs/" + FORTH].data.changeOrders, [{ id: "c1" }]); assert.strictEqual(io.store["jobs/" + FORTH].data.lead, "Colby");
    const un = await run({ requestId: RID + "b", action: "job.setPeople", args: { jobId: FORTH, foreman: "Unassigned" } }, io);
    assert.strictEqual(un.body.to, "Unassigned"); assert.deepStrictEqual(un.body.pushTo, []); assert.strictEqual(io.store["jobs/" + FORTH].data.foreman, "Unassigned", "the app's own sentinel");
    const blank = await run({ requestId: RID + "c", action: "job.setPeople", args: { jobId: FORTH, foreman: "" } }, io);
    assert.strictEqual(blank.body.noop, true, "\"\" for foreman means Unassigned — already that");
    const notF = await run({ requestId: RID + "d", action: "job.setPeople", args: { jobId: FORTH, foreman: "Brady" } }, io);
    assert.strictEqual(notF.status, 400); assert.match(notF.body.refused, /isn't a foreman/);
    const lead = await run({ requestId: RID + "e", action: "job.setPeople", args: { jobId: FORTH, lead: "Daegan" } }, io);
    assert.deepStrictEqual({ from: lead.body.from, to: lead.body.to, pushTo: lead.body.pushTo }, { from: "Colby", to: "Daegan", pushTo: ["Daegan"] });
    assert.deepStrictEqual(Object.keys(io.log.filter(l => l[0] === "update").pop()[2]).filter(k => k.startsWith("data.")), ["data.lead"]);
    const noLead = await run({ requestId: RID + "f", action: "job.setPeople", args: { jobId: FORTH, lead: "" } }, io);
    assert.strictEqual(noLead.body.to, ""); assert.strictEqual(io.store["jobs/" + FORTH].data.lead, "", "the lead select's blank option");
    const coord = await run({ requestId: RID + "g", action: "job.setPeople", args: { jobId: FORTH, coordinator: "Josh" } }, io);
    assert.strictEqual(coord.body.to, "Josh"); assert.deepStrictEqual(coord.body.pushTo, []);
    const two = await run({ requestId: RID + "h", action: "job.setPeople", args: { jobId: FORTH, foreman: "Colby", lead: "Colby" } }, io);
    assert.strictEqual(two.status, 400); assert.match(two.body.refused, /exactly ONE/);
    const none = await run({ requestId: RID + "i", action: "job.setPeople", args: { jobId: FORTH } }, io);
    assert.strictEqual(none.status, 400);
    const zed = await run({ requestId: RID + "j", action: "job.setPeople", args: { jobId: FORTH, lead: "Zed" } }, io);
    assert.strictEqual(zed.status, 400); assert.match(zed.body.refused, /isn't on the active team list/);
    const arch = await run({ requestId: RID + "k", action: "job.setPeople", args: { jobId: GONE, foreman: "Colby" } }, io);
    assert.strictEqual(arch.status, 400); assert.match(arch.body.refused, /archived/);
    n++; console.log("ok   handle job.setPeople: ONE foreman / lead / coordinator scalar with the job envelope; Unassigned sentinel; a non-foreman refused for foreman; lead/coordinator clear with \"\"; two fields, no field, unknown name, archived job refuse");
  })();

  // ── timeOff.decide ────────────────────────────────────────────────────────
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const r = await run({ requestId: RID, action: "timeOff.decide", email: "koy@homesteadelectric.net", args: { id: R1.id, status: "approved" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual({ id: r.body.id, name: r.body.name, status: r.body.status, from: r.body.from, decidedBy: r.body.decidedBy, decidedAt: r.body.decidedAt, needUpdated: r.body.needUpdated, needStatus: r.body.needStatus, ptoAdded: r.body.ptoAdded, ptoRemoved: r.body.ptoRemoved, usePaid: r.body.usePaid, pushTo: r.body.pushTo },
      { id: R1.id, name: "Daegan", status: "approved", from: "pending", decidedBy: "Koy", decidedAt: NOW, needUpdated: true, needStatus: "done", ptoAdded: true, ptoRemoved: 0, usePaid: true, pushTo: ["Daegan"] });
    assert.deepStrictEqual(io.log.map(l => [l[0], l[1]]), [["get", "settings/timeOffRequests"], ["get", "needs/" + NEED1.id], ["get", "settings/crewPTO"], ["update", "settings/timeOffRequests"], ["update", "needs/" + NEED1.id], ["update", "settings/crewPTO"], ["set", "duet_writes/" + RID]], "three reads, then the three writes + audit, ONE transaction");
    // (a) the request list: the ONE entry changed, the others byte-identical, order kept, the settings stamp
    const a = settingsWrite(io, "timeOffRequests")[0];
    assert.deepStrictEqual(Object.keys(a).sort(), ["list", "merged", "tab", "updatedAt"]); assert.strictEqual(a.merged, false); assert.ok(a.tab.startsWith("duet-5555")); assert.ok(a.updatedAt > REQS.updatedAt);
    assert.deepStrictEqual(a.list, [R3, { ...R1, status: "approved", decidedBy: "Koy", decidedAt: NOW }, R2]);
    // (b) the head's board task: patchNeed's dotted keys + the version-lock envelope; the Working reset rides along
    const b = io.log.filter(l => l[0] === "update" && l[1].startsWith("needs/"))[0][2];
    assert.deepStrictEqual(Object.keys(b).sort(), [...NEED_ENVELOPE, "data.doneAt", "data.doneBy", "data.startedAt", "data.startedBy", "data.status", "data.timeoffDecision"].sort());
    assert.deepStrictEqual({ s: b["data.status"], by: b["data.doneBy"], at: b["data.doneAt"], td: b["data.timeoffDecision"], sb: b["data.startedBy"], sa: b["data.startedAt"] }, { s: "done", by: "Koy", at: NOW, td: "approved", sb: "", sa: "" });
    checkStamp(b, false); assert.ok(b.updated_at > "2026-11-02T18:00:00.000Z");
    assert.strictEqual(io.store["needs/" + NEED1.id].data.requestedBy, "Daegan"); assert.strictEqual(io.store["needs/" + NEED1.id].data.timeoffId, R1.id, "the need's other fields untouched");
    // (c) the PTO mirror: the app's entry key for key, appended, the existing entries untouched
    const c = settingsWrite(io, "crewPTO")[0];
    assert.deepStrictEqual(Object.keys(c).sort(), ["list", "merged", "tab", "updatedAt"]); assert.ok(c.updatedAt > PTO.updatedAt);
    assert.deepStrictEqual(c.list, [...PTO.list, { id: "pto_" + R1.id, timeoffId: R1.id, name: "Daegan", start: "2026-11-09", end: "2026-11-09", note: "Dentist", usePaid: true }]);
    assert.deepStrictEqual(Object.keys(c.list[2]), ["id", "timeoffId", "name", "start", "end", "note", "usePaid"], "TimeOffPage.decide's entry key order");
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual({ coll: audit.coll, docId: audit.docId, itemId: audit.itemId, docs: audit.docs, fields: audit.fields, needMissing: audit.needMissing }, { coll: "settings", docId: "timeOffRequests", itemId: R1.id, docs: ["settings/timeOffRequests", "needs/" + NEED1.id, "settings/crewPTO"], fields: ["timeOffRequests.list", "needs/" + NEED1.id + ".data.status", "needs/" + NEED1.id + ".data.doneAt", "needs/" + NEED1.id + ".data.doneBy", "needs/" + NEED1.id + ".data.timeoffDecision", "needs/" + NEED1.id + ".data.startedBy", "needs/" + NEED1.id + ".data.startedAt", "crewPTO.list"], needMissing: false });
    assert.deepStrictEqual(audit.before, { request: R1, need: { status: "open", doneBy: "", doneAt: "", timeoffDecision: "" }, pto: [] });
    assert.deepStrictEqual(audit.after, { request: a.list[1], need: { status: "done", doneBy: "Koy", doneAt: NOW, timeoffDecision: "approved" }, pto: [c.list[2]] });
    // approve again: nothing to change; the PTO entry is never added twice
    const again = await run({ requestId: RID + "b", action: "timeOff.decide", args: { id: R1.id, status: "approved" } }, io);
    assert.strictEqual(again.body.noop, true); assert.strictEqual(settingsWrite(io, "crewPTO").length, 1);
    assert.strictEqual(io.store["settings/crewPTO"].list.filter(p => p.timeoffId === R1.id).length, 1);
    n++; console.log("ok   handle timeOff.decide approve: TimeOffPage.decide's three writes exact in ONE tx — the one list entry, the board task done through needPatch (+timeoffDecision, Working reset), the PTO mirror appended once; before/after for all three in the audit");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    const noForce = await run({ requestId: RID, action: "timeOff.decide", args: { id: R2.id, status: "denied" } }, io);
    assert.strictEqual(noForce.status, 400); assert.match(noForce.body.refused, /already approved by Josh on 2026-11-01. Say force:true/);
    assert.ok(!io.log.some(l => l[0] === "update"), "a decided request writes nothing without force");
    const deny = await run({ requestId: RID + "b", action: "timeOff.decide", args: { id: R2.id, status: "denied", force: true } }, io);
    assert.strictEqual(deny.status, 200, JSON.stringify(deny.body));
    assert.deepStrictEqual({ from: deny.body.from, status: deny.body.status, needUpdated: deny.body.needUpdated, needStatus: deny.body.needStatus, ptoAdded: deny.body.ptoAdded, ptoRemoved: deny.body.ptoRemoved, pushTo: deny.body.pushTo }, { from: "approved", status: "denied", needUpdated: false, needStatus: null, ptoAdded: false, ptoRemoved: 1, pushTo: ["Brady"] });
    assert.deepStrictEqual(io.log.filter(l => l[0] === "update").map(l => l[1]), ["settings/timeOffRequests", "settings/crewPTO"], "no needs write — the older request has no board doc, skipped silently as the app's catch does");
    assert.deepStrictEqual(io.store["settings/crewPTO"].list, [PTO.list[1]], "the mirror entry pulled; Abe's hand-entered PTO untouched");
    assert.deepStrictEqual(io.store["settings/timeOffRequests"].list[2], { ...R2, status: "denied", decidedBy: "Koy", decidedAt: NOW });
    assert.strictEqual(io.store["duet_writes/" + (RID + "b")].needMissing, true); assert.deepStrictEqual(io.store["duet_writes/" + (RID + "b")].fields, ["timeOffRequests.list", "crewPTO.list"]);
    const denyAgain = await run({ requestId: RID + "c", action: "timeOff.decide", args: { id: R2.id, status: "denied", force: true } }, io);
    assert.strictEqual(denyAgain.body.noop, true);
    n++; console.log("ok   handle timeOff.decide: a decided request refuses without force; with force deny pulls the PTO mirror; a missing board task is skipped (needMissing in the audit)");
  })();
  await (async () => {
    const io = fakeIo({ docs: DOCS() });
    await run({ requestId: RID, action: "timeOff.decide", args: { id: R1.id, status: "approved" } }, io);
    const pend = await run({ requestId: RID + "b", action: "timeOff.decide", args: { id: R1.id, status: "pending", force: true } }, io);
    assert.strictEqual(pend.status, 200, JSON.stringify(pend.body));
    assert.deepStrictEqual({ from: pend.body.from, status: pend.body.status, needStatus: pend.body.needStatus, ptoRemoved: pend.body.ptoRemoved, ptoAdded: pend.body.ptoAdded }, { from: "approved", status: "pending", needStatus: "open", ptoRemoved: 1, ptoAdded: false });
    const b = io.log.filter(l => l[0] === "update" && l[1].startsWith("needs/")).pop()[2];
    assert.deepStrictEqual({ s: b["data.status"], by: b["data.doneBy"], at: b["data.doneAt"], td: b["data.timeoffDecision"] }, { s: "open", by: "", at: "", td: "pending" }, "pending reopens the board task (reopenPatch) and stamps the decision");
    assert.deepStrictEqual(io.store["settings/crewPTO"].list, PTO.list, "the mirror entry is gone again");
    assert.deepStrictEqual(io.store["settings/timeOffRequests"].list[1], { ...R1, status: "pending", decidedBy: "Koy", decidedAt: NOW });
    const pendNoForce = await run({ requestId: RID + "c", action: "timeOff.decide", args: { id: R1.id, status: "denied" } }, io);
    assert.strictEqual(pendNoForce.status, 200, "back to pending, a decision needs no force again");
    const self = await run({ requestId: RID + "d", action: "timeOff.decide", args: { id: R3.id, status: "approved" } }, io);
    assert.deepStrictEqual(self.body.pushTo, [], "Koy's own request: onTimeOffDecision skips self-decisions");
    n++; console.log("ok   handle timeOff.decide pending (force): the board task reopens, the PTO mirror is pulled, the request is pending again; self-decision pushes nobody");
  })();
  await (async () => {
    const docs = DOCS(); delete docs["settings/crewPTO"];
    const io = fakeIo({ docs });
    const r = await run({ requestId: RID, action: "timeOff.decide", args: { id: R1.id, status: "approved" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const set = io.log.find(l => l[0] === "set" && l[1] === "settings/crewPTO")[2];
    assert.deepStrictEqual(Object.keys(set).sort(), ["list", "merged", "tab", "updatedAt"], "no crewPTO doc yet → tx.set with the list + stamp, as mergeSaveSettingsFields does");
    assert.deepStrictEqual(set.list, [TO.ptoEntry(R1)]);
    const io2 = fakeIo({ docs: DOCS() });
    for (const [args, re] of [[{ id: "to_nope1234", status: "approved" }, /No time-off request with id/], [{ id: R1.id, status: "maybe" }, /status must be one of/], [{ id: "settings/users", status: "approved" }, /id must be/], [{ status: "approved" }, /id must be/]]) {
      const x = await run({ requestId: RID + Math.random().toString(36).slice(2, 6), action: "timeOff.decide", args }, io2);
      assert.strictEqual(x.status, 400, JSON.stringify(x.body)); assert.match(x.body.refused, re);
    }
    assert.ok(!io2.log.some(l => l[0] === "update" || (l[0] === "set" && !l[1].startsWith("duet_writes/"))), "refusals write nothing but their audit");
    const noDoc = fakeIo({ docs: { ["jobs/" + FORTH]: JOB_DOC("Forth") } });
    const x = await run({ requestId: RID, action: "timeOff.decide", args: { id: R1.id, status: "approved" } }, noDoc);
    assert.strictEqual(x.status, 400); assert.match(x.body.refused, /no time-off requests yet/);
    n++; console.log("ok   handle timeOff.decide: a missing crewPTO doc is set with the stamp; unknown id, bad status, path-shaped id and a missing request list refuse and write nothing");
  })();

  // ── the settings allowlist ────────────────────────────────────────────────
  await (async () => {
    assert.deepStrictEqual(api.SETTINGS_DOCS, { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: ["teams"], simproCandidates: ["candidates"], crewRoster: ["names"], upcoming_jobs: ["items", "updated_at"] });   // ship 9 added simproCandidates; ship 10 crewTeams.teams (written by crewTeams.set only — crew.* still only reads it), crewRoster.names, upcoming_jobs.items
    for (const id of ["users", "appGate", "main", "deviceVersions", "ccSnapshot", "simproPoSync", "schedule_", "schedule_2026-11-9", "schedule_users", "", "schedule_2026-11-09/x"])   // upcoming_jobs + crewRoster moved to the allowed list in ship 10 assert.strictEqual(api.settingsDocAllowed(id), false, id);
    for (const id of ["timeOffRequests", "crewPTO", "crewTeams", "schedule_2026-11-09", "schedule_2027-01-04"]) assert.strictEqual(api.settingsDocAllowed(id), true, id);
    assert.deepStrictEqual(api.settingsDocFields("schedule_2026-11-09"), ["assignments"]); assert.deepStrictEqual(api.settingsDocFields("crewTeams"), ["teams"]);   // ship 10: written by crewTeams.set only; the crew.* actions still only read it (checked below) assert.strictEqual(api.settingsDocFields("users"), null);
    // The real io: settingsRef throws before touching the database for anything outside the list.
    let touched = 0;
    const db = { collection: (c) => ({ doc: (id) => { touched++; return { path: c + "/" + id }; } }) };
    const real = api.firestoreIo({ db, FieldValue: { delete: () => "DEL", arrayUnion: () => 0, serverTimestamp: () => 0 }, FieldPath: function (...s) { this.segments = s; }, getUsers: async () => [], TZ });
    for (const id of ["users", "appGate", "schedule_x", "../users"]) assert.throws(() => real.settingsRef(id), (e) => e instanceof api.Refusal && e.status === 400 && /is not a document Duet may touch/.test(e.message), id);
    assert.strictEqual(touched, 0, "refused before any read: the database was never asked");
    assert.strictEqual(real.settingsRef("crewPTO").path, "settings/crewPTO"); assert.strictEqual(real.settingsRef("schedule_2026-11-09").path, "settings/schedule_2026-11-09"); assert.strictEqual(touched, 2);
    assert.deepStrictEqual(real.fieldPath("assignments", FORTH + "_0").segments, ["assignments", FORTH + "_0"], "the cell is written as FieldPath(assignments, key)");
    assert.strictEqual(real.deleteField(), "DEL");
    // Through the handler: every settings doc asked for across every ship-5 action is on the list.
    const io = fakeIo({ docs: DOCS() });
    const bodies = [
      { action: "crew.assign", args: { jobId: FORTH, date: MON, person: "Colby" } },
      { action: "crew.assign", args: { jobId: FORTH, date: "2026-11-12", team: "Colby's crew" } },
      { action: "crew.setLead", args: { jobId: FORTH, date: MON, person: "Colby" } },
      { action: "crew.unassign", args: { jobId: FORTH, date: MON, person: "Colby" } },
      { action: "crew.assign", args: { jobId: FORTH, date: "2026-11-18", person: "Jon" } },
      { action: "job.setPeople", args: { jobId: FORTH, lead: "Daegan" } },
      { action: "job.setPeople", args: { jobId: MILLER, foreman: "Unassigned" } },
      { action: "timeOff.decide", args: { id: R1.id, status: "denied" } },
      { action: "timeOff.decide", args: { id: R1.id, status: "approved", force: true } },
      { action: "timeOff.decide", args: { id: R2.id, status: "pending", force: true } },
    ];
    for (const [i, body] of bodies.entries()) {
      const r = await run({ requestId: RID + i, ...body }, io);
      assert.strictEqual(r.status, 200, body.action + ": " + JSON.stringify(r.body));
    }
    assert.ok(io.settingsAsked.length >= 10 && io.settingsAsked.every(id => api.settingsDocAllowed(id)), "every settings doc opened is on the list: " + [...new Set(io.settingsAsked)].join(", "));
    assert.ok(!io.settingsAsked.includes("users"));
    const writes = io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));
    assert.ok(writes.every(w => w[1] === "jobs/" + FORTH || w[1] === "jobs/" + MILLER || w[1] === "needs/" + NEED1.id || w[1].startsWith("duet_writes/") || (w[1].startsWith("settings/") && api.settingsDocAllowed(w[1].slice(9)))), "only jobs/<id>, needs/toneed_<id>, the allowed settings docs and duet_writes are written");
    assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create"), "never a doc delete, never a create");
    assert.ok(!writes.some(w => w[1] === "settings/crewTeams"), "crewTeams is read only");
    assert.ok(io.log.filter(l => (l[0] === "update" || l[0] === "set") && l[1].startsWith("settings/")).every(l => {
      const fields = api.settingsDocFields(l[1].slice(9));
      return Object.keys(l[2]).every(k => ["updatedAt", "tab", "merged"].includes(k) || fields.includes(k.split(".")[0]));
    }), "a settings write only ever touches that doc's one allowed field (+ the stamp)");
    assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/")).every(l => Object.keys(l[2]).every(k => k.startsWith("data.") ? CR.PEOPLE_FIELDS.includes(k.slice(5)) : ENVELOPE.includes(k))), "job writes touch only foreman / lead / coordinator");
    assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("needs/")).every(l => Object.keys(l[2]).every(k => k.startsWith("data.") ? ["status", "doneAt", "doneBy", "timeoffDecision", "startedBy", "startedAt"].includes(k.slice(5)) : NEED_ENVELOPE.includes(k))), "need writes touch only the decide fields");
    assert.strictEqual(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length, 10, "one audit doc per call");
    n++; console.log("ok   settings allowlist: exactly timeOffRequests.list, crewPTO.list, crewTeams (read), schedule_<ymd>.assignments; settings/users and every other id refused before any read; all ten ship-5 calls in a row touch nothing else, never delete or create");
  })();
  await (async () => {
    assert.deepStrictEqual(api.JOB_ACTIONS, ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"], "the ship-2 list is untouched");
    assert.deepStrictEqual(api.PEOPLE_ACTIONS, ["job.setPeople"]); assert.deepStrictEqual(api.CREW_ACTIONS, ["crew.assign", "crew.unassign", "crew.setLead"]); assert.deepStrictEqual(api.TIMEOFF_ACTIONS, ["timeOff.decide"]);
    assert.ok(api.JOB_WRITE_ACTIONS.includes("job.setPeople") && !api.JOB_WRITE_ACTIONS.includes("crew.assign"));
    assert.ok(api.BUILD >= 604, "BUILD is at least the ship-5 SW version");
    for (const a of ["crew.clearDay", "crew.setHours", "crew.copyWeek", "team.save", "timeOff.create", "timeOff.remove", "timeOff.delete", "users.save", "pto.add", "pto.remove"]) {
      await assert.rejects(run({ requestId: RID, action: a, args: {} }, fakeIo({ docs: DOCS() })), (e) => e.status === 400 && /action must be/.test(e.message), a);
    }
    const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
    assert.strictEqual((src.match(/tx\.delete\(/g) || []).length, 2, "exactly two tx.delete in api.js, both the door's (ship 12): doc.delete (confirm word = the docId) and its undo's docDelete (a plain create taken back)");
    assert.strictEqual((src.match(/\.delete\(/g) || []).length, 5, "exactly five deletes in api.js: the ship-3 Storage cleanup, the versions prune, and FieldValue.delete() for an emptied planner cell (a map key, never a doc) — plus (ship 12) the door's two tx.delete (doc.delete and its undo's docDelete), the only document deletes");
    assert.ok(/new FieldPath\(/.test(src) && /io\.fieldPath\("assignments", p\.key\)/.test(src), "the cell write goes through FieldPath(assignments, key)");
    assert.ok(/settingsRef: \(id\) => \{\s*if \(!settingsDocAllowed\(id\)\) throw/.test(src), "settingsRef is the only way in and it guards");
    assert.strictEqual((src.match(/collection\("settings"\)/g) || []).length, 2, "settings is opened in exactly two places: settingsRef (guarded) and usersRef (ship 12, team.edit only)");
    assert.strictEqual((src.replace(/\/\/[^\n]*/g, "").match(/doc\("users"\)/g) || []).length, 1, "exactly one code path names settings/users: usersRef"); assert.ok(/usersRef: \(\) => db\.collection\("settings"\)\.doc\("users"\)/.test(src), "and that path is usersRef");
    n++; console.log("ok   handle: no hours / clear-day / team-save / time-off-create / remove action exists; BUILD is the ship-5 SW version; api.js has two tx.delete (the door's, ship 12) and opens settings in two places: settingsRef (guarded) + usersRef (team.edit only)");
  })();
  console.log(`duet-crew-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
