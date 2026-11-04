#!/usr/bin/env node
// claude-activity-test: the Claude tab's server cut (functions/claudeActivity.js).
// The rule that matters: message words reach Koy's record only. Every other
// admin — and Koy when he picks "Owners' view" — gets counts, never `watch`.
const assert = require("assert");
const { buildActivity, didKind } = require("../functions/claudeActivity.js");

const duet = [
  ["r1", { at: "2026-11-04T05:38:05.627Z", action: "timeOff.decide", coll: "settings", docId: "timeOffRequests", ok: true, response: { body: {} } }],
  ["r2", { at: "2026-11-04T00:55:19.309Z", action: "co.convert", coll: "jobs", docId: "1773670526965", ok: true, response: { body: { jobName: "989 Bohannan" } } }],
  ["r3", { at: "2026-11-04T00:55:00.000Z", action: "co.create", coll: "jobs", docId: "1773670526965", ok: false, why: "bad input" }],   // refused: changed nothing, left off
  ["r4", { at: "2026-11-03T20:10:15.227Z", action: "rt.update", coll: "jobs", docId: "1773670526965", ok: true, undoneBy: "r9", response: { body: {} } }],
];
const activity = [
  ["s1", { kind: "simpro", at: "2026-11-04T15:46:00.000Z", jobNo: "1443", jobName: "Koplin Residence", who: "Gage Lund", workDate: "2026-11-05", what: "Schedule 7-5", okBy: "Koy" }],
  ["w1", { kind: "watch", at: "2026-11-04T14:15:00.000Z", source: "Text", from: "Someone", said: "PRIVATE WORDS", did: "Flagged to Koy", why: "no PO" }],
  ["w2", { kind: "watch", at: "2026-11-04T14:15:00.000Z", source: "Chat", from: "Someone", said: "MORE WORDS", did: "Already handled", why: "Koy answered" }],
];
const koy = { id: "koy", name: "Koy Wilkinson" }, josh = { id: "josh", name: "Josh Cloward" };

const k = buildActivity({ duet, activity, viewer: koy, nowIso: "2026-11-04T18:00:00Z" });
assert.strictEqual(k.view, "koy");
assert.strictEqual(k.changes.length, 4, "3 ok Duet writes + 1 Simpro write; the refused one is left off");
assert.strictEqual(k.changes[0].app, "Simpro", "newest first");
assert.strictEqual(k.changes.find(c => c.id === "r4").undone, true);
assert.strictEqual(k.changes.find(c => c.id === "r2").what, "Turned a change order into a return trip");
assert.strictEqual(k.watch.length, 2);
assert.deepStrictEqual([k.watchCounts.checked, k.watchCounts.flagged, k.watchCounts.handled], [2, 1, 1]);

for (const [label, out] of [["Josh", buildActivity({ duet, activity, viewer: josh })], ["Koy's owners' view", buildActivity({ duet, activity, viewer: koy, wantOwners: true })]]) {
  assert.strictEqual(out.view, "owners", label);
  assert.strictEqual(out.watch, undefined, `${label}: no message list`);
  assert.ok(!JSON.stringify(out).includes("WORDS"), `${label}: no message words anywhere in the answer`);
  assert.strictEqual(out.watchCounts.flagged, 1, `${label}: counts still there`);
  assert.strictEqual(out.changes.length, 4, `${label}: same changes`);
}

// Plan Intake rows: the Routine's decisions and Koy's own, practice runs left off,
// the email's file name only in Koy's view.
const { fromPlan } = require("../functions/claudeActivity.js");
const plans = [
  ["email_a_1", { filename: "E200 Lighting Plans rev5.pdf", status: "done", decidedAt: "2026-11-04T13:00:00Z", decision: { action: "file", at: "2026-11-04T13:00:00Z", note: "#1277 – Rev 5 – 2026-10-06 – E200 Lighting Plans rev5.pdf" } }],
  ["email_b_1", { filename: "Claar ADU.pdf", status: "done", decision: { action: "file", at: "2026-11-04T12:00:00Z", note: "Q3322 – 2026-09-29 – Claar ADU.pdf" } }],
  ["email_c_1", { filename: "Resume.pdf", status: "dismissed", decision: { action: "dismiss", by: "Koy Wilkinson", at: "2026-11-04T11:00:00Z", note: "not plans" } }],
  ["walk_x", { title: "Oak Hill 5 - Homeworks", status: "done", decision: { action: "match_walk", at: "2026-11-04T10:00:00Z", note: "existing job #1454" } }],
  ["test_email_d_1", { filename: "practice.pdf", decision: { action: "file", at: "2026-11-04T10:00:00Z", note: "#1 – x" } }],
];
assert.strictEqual(fromPlan("test_email_d_1", plans[4][1]), null);
const pk = buildActivity({ plans, plansWaiting: 2, viewer: koy });
const pr = (id) => pk.changes.find(c => c.id === id);
assert.strictEqual(pr("email_a_1").jobNo, "1277"); assert.strictEqual(pr("email_a_1").what, "Filed a plan"); assert.strictEqual(pr("email_a_1").app, "Plan Intake");
assert.strictEqual(pr("email_b_1").quoteNo, "Q3322"); assert.strictEqual(pr("email_b_1").jobNo, "");
assert.strictEqual(pr("email_c_1").who, "Koy Wilkinson", "Koy's own decision says so");
assert.strictEqual(pr("walk_x").jobNo, "1454");
assert.strictEqual(pr("email_a_1").detail, "E200 Lighting Plans rev5.pdf");
assert.deepStrictEqual(pk.planCounts, { filed: 2, setAside: 1, walks: 1, waiting: 2 });
const po = buildActivity({ plans, plansWaiting: 2, viewer: josh });
assert.ok(po.changes.every(c => c.detail === ""), "owners' cut drops the emailed file names");
assert.deepStrictEqual(po.planCounts, pk.planCounts);

assert.strictEqual(didKind("Flagged to Koy"), "flagged");
assert.strictEqual(didKind("Already handled"), "handled");
assert.strictEqual(didKind("Scheduled it"), "acted");
assert.strictEqual(didKind("Nothing needed"), "dismissed");

// The tab's browser helpers, compiled out of src/App.js as shipped (no JSX in them).
const fs = require("fs"), path = require("path"), vm = require("vm");
const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const grab = (name) => { const i = app.indexOf(`function ${name}(`); assert.ok(i >= 0, name); let depth = 0, j = app.indexOf("{", i);
  for (; j < app.length; j++) { if (app[j] === "{") depth++; else if (app[j] === "}" && --depth === 0) break; } return app.slice(i, j + 1); };
const sb = {}; vm.createContext(sb);
vm.runInContext(["odClaudeJobLabel", "odClaudeFold", "odClaudeSample", "odPoSample"].map(grab).join("\n") + "\n;globalThis.__x = { odClaudeJobLabel, odClaudeFold, odClaudeSample, odPoSample };", sb);
const { odClaudeJobLabel, odClaudeFold, odClaudeSample, odPoSample } = sb.__x;
const jobsX = [{ id: "1773670526965", simproNo: "989", name: "Bohannan" }, { id: "2", simproNo: "1443", name: "1443 Koplin Residence" }];
assert.strictEqual(odClaudeJobLabel({ jobId: "1773670526965" }, jobsX).label, "989 Bohannan");
assert.strictEqual(odClaudeJobLabel({ jobId: "2" }, jobsX).label, "1443 Koplin Residence", "a name that already starts with its number is not doubled");
assert.strictEqual(odClaudeJobLabel({ jobNo: "1430", jobName: "Brandt Residence" }, jobsX).label, "1430 Brandt Residence");
assert.strictEqual(odClaudeJobLabel({}, jobsX).label, "No job");
const photos = [0, 1, 2].map(i => ({ id: "p" + i, at: new Date(Date.UTC(2026, 10, 3, 23, 18, 10 - i)).toISOString(), app: "Command Center", action: "photo.add", jobId: "1773670526965", jobNo: "", what: "Added a photo" }));
const folded = odClaudeFold([...photos, { id: "s", at: "2026-11-03T20:00:00Z", app: "Simpro", action: "simpro.schedule", jobNo: "1443", what: "Schedule 7-5" }]);
assert.strictEqual(folded.length, 2); assert.strictEqual(folded[0].what, "Added 3 photos");
const smp = odClaudeSample(jobsX, [{ name: "Gage Lund" }], false);
assert.strictEqual(smp.sample, true); assert.strictEqual(smp.watch, undefined, "sample owners' view has no message list either");
assert.ok(odClaudeSample(jobsX, [], true).watch.length > 0);
assert.ok(odClaudeSample([], [], true).changes.length > 0, "no jobs loaded yet: still draws");
const ps = odPoSample(jobsX); assert.strictEqual(ps.sample, true); assert.ok(ps.needs.length && ps.jobs.length);
assert.ok(odPoSample([]).needs.length, "draws with no jobs loaded");
console.log("claude-activity-test: ok");

// duetApi's two log actions (functions/duetWrites/activity.js through api.js handle()):
// rows → claude_activity docs, same row twice → same doc, no duet_writes audit,
// links stripped, bad rows skipped with a reason, nothing else touched.
(async () => {
  const api = require("../functions/duetWrites/api.js");
  const AC = require("../functions/duetWrites/activity.js");
  assert.deepStrictEqual(api.ACTIVITY_ACTIONS, ["activity.simpro", "activity.watch"]);
  assert.ok(api.ACTIVITY_ACTIONS.every(a => api.ACTIONS.includes(a) && !api.JOB_WRITE_ACTIONS.includes(a)));
  const store = {}, log = [];
  const io = { nowIso: () => "2026-11-04T18:00:00.000Z", writeActivity: async (docs) => { docs.forEach(d => { store[d.id] = d.doc; log.push(d.id); }); },
    getAudit: async () => { throw new Error("activity must not read duet_writes"); }, countRecent: async () => { throw new Error("activity is not in the hourly limit"); }, runTx: async () => { throw new Error("no transaction"); } };
  const sim = { at: "2026-11-04T15:46:00Z", jobNo: "#1443", jobName: "Koplin Residence", who: "Gage Lund", workDate: "2026-11-05", what: "Schedule 7-5", okBy: "Koy" };
  const r1 = await api.handle({ requestId: "act_test_0001", action: "activity.simpro", args: { rows: [sim, { ...sim, workDate: "11/5" }, { at: "2027-03-01T00:00:00Z", what: "x" }] } }, io);
  assert.strictEqual(r1.status, 200); assert.strictEqual(r1.body.logged, 1); assert.strictEqual(r1.body.skipped.length, 2);
  const id = r1.body.ids[0]; assert.ok(/^sim_[0-9a-f]{24}$/.test(id));
  assert.strictEqual(store[id].jobNo, "1443"); assert.strictEqual(store[id].kind, "simpro"); assert.strictEqual(store[id].removed, false);
  const r2 = await api.handle({ requestId: "act_test_0002", action: "activity.simpro", args: { rows: [sim] } }, io);
  assert.strictEqual(r2.body.ids[0], id, "same row, same doc — a retry or a second backfill writes nothing new");
  const w = await api.handle({ requestId: "act_test_0003", action: "activity.watch", args: { rows: [{ at: "2026-11-04T14:15:00Z", source: "Text", from: "Someone", said: "see https://x.example/s?token=abc for the plan", did: "Flagged to Koy", why: "no PO", key: "row-0042" }] } }, io);
  assert.strictEqual(w.body.ids[0], "wat_row-0042"); assert.ok(!store["wat_row-0042"].said.includes("token"), "links never stored");
  const bad = await api.handle({ requestId: "act_test_0004", action: "activity.watch", args: { rows: [{ at: "2026-11-04T14:15:00Z", did: "x", email: "a@b.c" }] } }, io);
  assert.strictEqual(bad.status, 400, "an unknown field (an email) is refused, not stored");
  assert.strictEqual((await api.handle({ requestId: "act_test_0005", action: "activity.watch", args: { rows: new Array(51).fill({ at: "2026-11-04T14:15:00Z", did: "x" }) } }, io)).status, 400);
  assert.ok(Object.keys(store).every(k => /^(sim|wat)_/.test(k)));
  // The rows land exactly as the Claude tab reads them.
  const tab = buildActivity({ activity: Object.entries(store), viewer: koy });
  assert.strictEqual(tab.changes[0].jobNo, "1443"); assert.strictEqual(tab.watch[0].kind, "flagged");
  assert.strictEqual(AC.clean("a\u0000b  c", 10), "a b c");
  const src = fs.readFileSync(path.join(__dirname, "..", "functions", "duetWrites", "activity.js"), "utf8");
  assert.ok(!/require\(["']firebase/i.test(src), "activity.js imports no Firebase");
  console.log("claude-activity-test: duetApi log actions ok");
})().catch((e) => { console.error("claude-activity-test FAILED:", e && e.stack || e); process.exit(1); });
