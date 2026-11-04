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
