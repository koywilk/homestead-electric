#!/usr/bin/env node
/* duet-meetings-test.js — v676: Claude adds ONE item to a dashboard meeting
 * (functions/duetWrites/meetings.js, api.js meetingAdd, undo.js).
 *
 * Proves: the week is worked out the dashboard's way (Monday-to-Sunday week,
 * Lead / Foreman on Wednesday, Friday Strategy on Friday; "next" by default;
 * past weeks and the Scramble refused); only the per-week sections take an
 * item; a Lead / Foreman item with dollar or cost figures is refused (margin %
 * and hours pass); a named job is read here and saved with its number and
 * name; a who is matched against the Team list; the write is ONE merge set of
 * ONE key that leaves everything else in the record alone, makes next week's
 * record when it doesn't exist, audits in the same transaction and replays by
 * requestId; the same words twice are refused; preview writes nothing; undo
 * takes the key back off while it still reads what the call left, and refuses
 * once someone changed it. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const MT = require(path.join(root, "functions", "duetWrites", "meetings.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));
const AD = require(path.join(root, "functions", "duetWrites", "anyDoc.js"));

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-21T02:00:00.000Z";
const TODAY = "2026-11-20";   // a Friday (Mountain)
const clone = (x) => JSON.parse(JSON.stringify(x));
function assertNoUndefined(v, p) {
  if (v === undefined) throw new Error('undefined at "' + p + '"');
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, p + "[" + i + "]"));
  else if (v && typeof v === "object") Object.keys(v).forEach(k => assertNoUndefined(v[k], p ? p + "." + k : k));
}
const USERS = [
  { id: "u1", name: "Koy Wilkinson", title: "admin", access: "admin" },
  { id: "u2", name: "Keegan Smith", title: "foreman", access: "manager" },
  { id: "u3", name: "Daegan Jones", title: "foreman", access: "manager" },
  { id: "u4", name: "Old Hand", title: "crew", active: false },
  { id: "u5", name: "Sub Guy", title: "crew", access: "contractor" },
];
const JOB = { id: "1772863862618", name: "Tuhaye Hollow", foreman: "Keegan Smith", archived: false, deleted: false, simproNo: "1393" };
const LEAD_THIS = { type: "lead", date: "2026-11-18", notes: { notes: "typed in the box" }, added: { a1: { sec: "highlight", text: "Pierce passed rough", by: "Koy Wilkinson", at: "2026-11-18T13:00:00.000Z" } },
  actions: { x1: { sec: "nextsteps", text: "Order wire", who: "Keegan Smith", due: "", by: "Koy Wilkinson", at: "2026-11-18T13:05:00.000Z" } }, prefill: { at: "2026-11-18T12:00:00.000Z", rows: {} }, updated_at: "2026-11-18T14:00:00.000Z", saved_by: "Koy Wilkinson" };

function deepMerge(a, b) {
  const out = a && typeof a === "object" && !Array.isArray(a) ? clone(a) : {};
  Object.keys(b).forEach(k => { const v = b[k]; out[k] = v && typeof v === "object" && !Array.isArray(v) && !v.__delete ? deepMerge(out[k], v) : v; });
  return out;
}
function fakeIo({ docs = {}, job = JOB } = {}) {
  const log = [];
  const store = clone(docs);
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!(cur[parts[i]] && typeof cur[parts[i]] === "object")) cur[parts[i]] = {}; cur = cur[parts[i]]; } if (v && v.__delete) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => clone(d) }; },
    create: (r, d) => { assertNoUndefined(d, ""); log.push(["create", r.path, d]); store[r.path] = clone(d); },
    update: (r, d) => { assertNoUndefined(d, ""); log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc"); const cur = clone(store[r.path]); Object.keys(d).forEach(k => setPath(cur, k, d[k])); store[r.path] = cur; },
    set: (r, d, o) => { assertNoUndefined(d, ""); log.push(["set", r.path, d, o]); store[r.path] = o && o.merge ? deepMerge(store[r.path], d) : clone(d); },
    delete: (r) => { log.push(["delete", r.path]); delete store[r.path]; },
  };
  return {
    log, store, nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: "America/Denver",
    getAudit: async (id) => store["duet_writes/" + id] || null, countRecent: async () => 0, recentActions: async () => [],
    getJob: async (id) => (job && id === job.id ? clone(job) : null), getUsers: async () => USERS, openNeeds: async () => [],
    runTx: async (fn) => fn(tx), auditRef: (id) => ref("duet_writes", id), jobRef: (id) => ref("jobs", id), needRef: (id) => ref("needs", id),
    anyRef: (coll, id) => { const why = AD.neverReason(coll, id); if (why) throw new api.Refusal(400, why); return ref(coll, id); },
    deleteField: () => ({ __delete: true }), serverTimestamp: () => ({ __serverTimestamp: true }), arrayUnion: (...x) => ({ __arrayUnion: x }),
  };
}
let seq = 0;
const rid = () => "mtg-test-" + String(++seq).padStart(4, "0");
const run = (io, action, args, id) => api.handle({ requestId: id || rid(), action, email: "koy@homesteadelectric.net", args }, io);
const writes = (io) => io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]) && !String(l[1]).startsWith("duet_writes/"));

(async () => {
await ok("meeting.addItem is an action; the week is the dashboard's: Lead / Foreman Wednesday, Strategy Friday, default next", () => {
  assert.ok(api.ACTIONS.includes("meeting.addItem"));
  assert.strictEqual(MT.meetingYmd("2026-11-20", "lead"), "2026-11-18");
  assert.strictEqual(MT.meetingYmd("2026-11-23", "lead"), "2026-11-25");
  assert.strictEqual(MT.meetingYmd("2026-11-22", "lead"), "2026-11-18", "Sunday is still the week that started Monday");
  assert.strictEqual(MT.meetingYmd("2026-11-20", "strategy"), "2026-11-20");
  assert.strictEqual(MT.weekOf("lead", undefined, TODAY).ymd, "2026-11-25");
  assert.strictEqual(MT.weekOf("lead", "this", TODAY).ymd, "2026-11-18");
  assert.strictEqual(MT.weekOf("lead", "2026-11-27", TODAY).ymd, "2026-11-25");
  assert.match(MT.weekOf("lead", "2026-11-11", TODAY).refused, /passed/);
  assert.match(MT.weekOf("lead", "2027-03-01", TODAY).refused, /8 weeks/);
  assert.match(MT.weekOf("lead", "soon", TODAY).refused, /week must be/);
  assert.strictEqual(MT.kindOf("Lead Meeting"), "lead"); assert.strictEqual(MT.kindOf("Friday Strategy"), "strategy"); assert.strictEqual(MT.kindOf("Foreman"), "foreman");
});

await ok("check: sections per meeting, Scramble refused, money refused on Lead / Foreman only, who / due only on action items", () => {
  assert.strictEqual(MT.check({ meeting: "lead", section: "Highlight", text: "x" }, TODAY).sec, "highlight");
  assert.strictEqual(MT.check({ meeting: "lead", section: "action items", text: "x" }, TODAY).sec, "nextsteps");
  assert.strictEqual(MT.check({ meeting: "lead", text: "x" }, TODAY).sec, "notes", "Notes by default");
  assert.match(MT.check({ meeting: "lead", section: "Schedule", text: "x" }, TODAY).refused, /Notes, Highlight, Lowlight, Training, Action items/);
  assert.match(MT.check({ meeting: "foreman", section: "Jobs", text: "x" }, TODAY).refused, /Team check, Action items/);
  assert.strictEqual(MT.check({ meeting: "strategy", section: "Job numbers", text: "Pierce is $4,000 over" }, TODAY).sec, "numbers", "owners meeting: dollars allowed");
  assert.match(MT.check({ meeting: "scramble", text: "x" }, TODAY).refused, /Scramble/);
  assert.match(MT.check({ meeting: "lead", text: "Pierce is $4,000 over" }, TODAY).refused, /dollar or cost/);
  assert.match(MT.check({ meeting: "foreman", section: "team", text: "material cost 3400 on Pierce" }, TODAY).refused, /dollar or cost/);
  assert.ok(!MT.check({ meeting: "lead", text: "Pierce margin is 38%, 40 hours over bid" }, TODAY).refused, "margin % and hours are fine");
  assert.match(MT.check({ meeting: "lead", section: "notes", text: "x", who: "Keegan" }, TODAY).refused, /who is only/);
  assert.match(MT.check({ meeting: "lead", section: "actions", text: "x", due: "Friday" }, TODAY).refused, /YYYY-MM-DD/);
  assert.match(MT.check({ meeting: "lead", text: "   " }, TODAY).refused, /empty/);
  assert.match(MT.check({ meeting: "lead", text: "y".repeat(501) }, TODAY).refused, /500/);
});

await ok("preview: answers what would be written, writes nothing, audits nothing", async () => {
  const io = fakeIo();
  const r = await run(io, "meeting.addItem", { meeting: "lead", section: "Notes", text: "Talk through cut sheets", jobId: JOB.id, preview: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.preview, true); assert.strictEqual(r.body.wrote, false);
  assert.strictEqual(r.body.docId, "lead_2026-11-25"); assert.strictEqual(r.body.section, "Notes");
  assert.strictEqual(r.body.text, "Tuhaye Hollow: Talk through cut sheets"); assert.strictEqual(r.body.jobNo, "1393"); assert.strictEqual(r.body.newRecord, true);
  assert.strictEqual(writes(io).length, 0); assert.strictEqual(Object.keys(io.store).length, 0);
});

await ok("add to next week's Lead Notes with a job: makes the record with ONE added key {sec, text, jobId, jobNo, by:Claude}; audit like doc.set in the same transaction; replay writes nothing twice", async () => {
  const io = fakeIo();
  const r = await run(io, "meeting.addItem", { meeting: "lead", section: "notes", text: "Talk through cut sheets", jobId: JOB.id }, "mtg-add-0001");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const d = io.store["meetings/lead_2026-11-25"];
  assert.strictEqual(d.type, "lead"); assert.strictEqual(d.date, "2026-11-25"); assert.strictEqual(d.saved_by, "Duet (Koy)"); assert.strictEqual(d.updated_at, NOW);
  assert.deepStrictEqual(Object.keys(d.added), ["cl_mtg_add_0001"]);
  assert.deepStrictEqual(d.added.cl_mtg_add_0001, { sec: "notes", text: "Tuhaye Hollow: Talk through cut sheets", jobId: JOB.id, jobNo: "1393", by: "Claude", at: NOW });
  assert.ok(!d.prefill, "the app's own prefill still runs when the week opens");
  const a = io.store["duet_writes/mtg-add-0001"];
  assert.strictEqual(a.action, "meeting.addItem"); assert.strictEqual(a.coll, "meetings"); assert.strictEqual(a.docId, "lead_2026-11-25");
  assert.strictEqual(a.path, "added.cl_mtg_add_0001"); assert.strictEqual(a.before, null); assert.deepStrictEqual(a.after, d.added.cl_mtg_add_0001); assert.strictEqual(a.newDoc, true);
  assert.strictEqual(writes(io).length, 1); assert.deepStrictEqual(writes(io)[0][3], { merge: true });
  const again = await run(io, "meeting.addItem", { meeting: "lead", section: "notes", text: "Talk through cut sheets", jobId: JOB.id }, "mtg-add-0001");
  assert.strictEqual(again.body.replayed, true); assert.strictEqual(writes(io).length, 1);
});

await ok("add to this week's record leaves everything else alone; same words twice refused; who matched to the Team list", async () => {
  const io = fakeIo({ docs: { "meetings/lead_2026-11-18": LEAD_THIS } });
  const r = await run(io, "meeting.addItem", { meeting: "lead", week: "this", section: "Action items", text: "Call the inspector about Pierce", who: "keegan", due: "2026-11-24" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.who, "Keegan Smith");
  const d = io.store["meetings/lead_2026-11-18"];
  assert.deepStrictEqual(d.notes, LEAD_THIS.notes); assert.deepStrictEqual(d.added, LEAD_THIS.added); assert.deepStrictEqual(d.prefill, LEAD_THIS.prefill);
  assert.deepStrictEqual(d.actions.x1, LEAD_THIS.actions.x1); assert.strictEqual(Object.keys(d.actions).length, 2);
  const mine = Object.values(d.actions).find(x => x.by === "Claude");
  assert.deepStrictEqual(mine, { sec: "nextsteps", text: "Call the inspector about Pierce", who: "Keegan Smith", due: "2026-11-24", by: "Claude", at: NOW });
  assert.ok(d.updated_at > LEAD_THIS.updated_at);
  const dup = await run(io, "meeting.addItem", { meeting: "lead", week: "this", section: "highlight", text: "pierce passed ROUGH" });
  assert.strictEqual(dup.status, 409); assert.match(dup.body.refused, /already in Highlight/);
  const nobody = await run(io, "meeting.addItem", { meeting: "lead", section: "actions", text: "x", who: "Old Hand" });
  assert.strictEqual(nobody.status, 404);
  const sub = await run(io, "meeting.addItem", { meeting: "lead", section: "actions", text: "x", who: "Sub Guy" });
  assert.strictEqual(sub.status, 404, "contractors aren't on the meeting");
  const nojob = await run(io, "meeting.addItem", { meeting: "lead", text: "x", jobId: "1700000000000" });
  assert.strictEqual(nojob.status, 404);
});

await ok("refusals before any read are audited and write nothing to meetings", async () => {
  const io = fakeIo();
  const r = await run(io, "meeting.addItem", { meeting: "lead", text: "Wire is $2.10 a foot now" }, "mtg-money-0001");
  assert.strictEqual(r.status, 400); assert.strictEqual(writes(io).length, 0);
  assert.strictEqual(io.store["duet_writes/mtg-money-0001"].ok, false);
});

await ok("undo takes the one key back off; refused once someone changed the item", async () => {
  const io = fakeIo({ docs: { "meetings/lead_2026-11-18": LEAD_THIS } });
  await run(io, "meeting.addItem", { meeting: "lead", week: "this", section: "training", text: "Color matching devices on painted walls" }, "mtg-undo-0001");
  assert.ok(io.store["meetings/lead_2026-11-18"].added.cl_mtg_undo_0001);
  const u = await run(io, "undo.apply", { requestId: "mtg-undo-0001" });
  assert.strictEqual(u.status, 200, JSON.stringify(u.body));
  const d = io.store["meetings/lead_2026-11-18"];
  assert.ok(!d.added.cl_mtg_undo_0001); assert.deepStrictEqual(d.added, LEAD_THIS.added); assert.deepStrictEqual(d.notes, LEAD_THIS.notes);
  await run(io, "meeting.addItem", { meeting: "lead", week: "this", section: "training", text: "Box fill on 4 square boxes" }, "mtg-undo-0002");
  io.store["meetings/lead_2026-11-18"].added.cl_mtg_undo_0002.text = "Box fill, edited in the meeting";
  const u2 = await run(io, "undo.apply", { requestId: "mtg-undo-0002" });
  assert.strictEqual(u2.status, 400); assert.match(u2.body.refused, /Changed since/);
  assert.strictEqual(io.store["meetings/lead_2026-11-18"].added.cl_mtg_undo_0002.text, "Box fill, edited in the meeting");
});

console.log(`\nduet-meetings-test: ${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
