#!/usr/bin/env node
/* claude-work-test.js — gate for Automations + Needs you in the Claude tab (SW v633).
 *
 * Koy, 2026-11-12: every automation listed in the Claude section, and flagged
 * items workable from the dashboard ("So I can work in one spot"); a Yes there
 * should "Change it right then". His standing rules: never a stage or rough /
 * finish status change, no dollar figures outside owners and admins.
 *
 * Covers: functions/duetWrites/claudeWork.js (schedule words, routine sync and
 * check-in, flag post / refresh / reopen, the proposal allow-list, Koy's answer
 * and its retry, the dashboard read), duetApi's routine / flag path and the
 * okBy stamp through a fake io, and the rules blocks.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const CW = require("../functions/duetWrites/claudeWork.js");
const API = require("../functions/duetWrites/api.js");

let n = 0;
const check = (label, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("  ok  " + label); }, (e) => { console.error("  FAIL " + label + "\n       " + (e && e.stack || e)); process.exit(1); });

const NOW = "2026-11-13T02:10:00.000Z";
const JOB = { simproNo: "1107", name: "Kweller" };
const T1 = "trig_016dsXEFR8CoWVoWSvcxgLGC", T2 = "trig_01NrF8rnyigPGuyvJdrsKsCM";
const coFlag = { key: "1107-Q2819", routine: "Job issues watch", routineId: T1, channel: "job-issues", jobId: "1772863862618", kind: "co",
  title: "Quote 2819 approved, not in Command Center", detail: "Approved Nov 10.\nSimpro section 12.", ask: "yes_no",
  proposal: [{ action: "co.create", args: { jobId: "1772863862618", desc: "Add 2 recessed cans", quote: "2819", status: "approved" } }] };

(async () => {
  console.log("claude-work-test");

  await check("schedule words in Denver time (Denver crons as written, UTC shifted)", () => {
    assert.strictEqual(CW.scheduleText("CRON_TZ=America/Denver 47 6 * * 1-5", NOW), "Weekdays 6:47 AM");
    assert.strictEqual(CW.scheduleText("CRON_TZ=America/Denver 23 14 * * 5", NOW), "Fridays 2:23 PM");
    assert.strictEqual(CW.scheduleText("CRON_TZ=America/Denver 0 7,12,16,21 * * *", NOW), "Daily 7 AM, 12 PM, 4 PM, 9 PM");
    assert.strictEqual(CW.scheduleText("35 12 * * *", NOW), "Daily 5:35 AM");                 // MST in November
    assert.strictEqual(CW.scheduleText("35 12 * * *", "2026-07-01T00:00:00Z"), "Daily 6:35 AM"); // MDT in July
    assert.strictEqual(CW.scheduleText("0 * * * *", NOW), "Every hour");
    assert.strictEqual(CW.scheduleText("", NOW), "On demand");
  });

  await check("routine.sync keeps only listed fields: a prompt is refused, never stored", () => {
    const p = CW.planSync({ routines: [
      { id: T1, name: "Job issues watch", cron: "CRON_TZ=America/Denver 13 7,10,13,16 * * 1-5", enabled: true, nextAt: "2026-11-13T14:13:00Z", lastRunAt: "2026-11-12T23:14:20Z", lastStatus: "ok", about: "Missing COs, failed inspections", onItsOwn: ["Adds rows to the Watch tab"], channelName: "job-issues" },
      { id: T2, name: "CED pickups", prompt: "You run once…" },
      { id: "bad", name: "x" },
    ] }, {}, NOW);
    assert.strictEqual(p.docs.length, 1);
    assert.strictEqual(p.skipped.length, 2);
    assert(/unknown field prompt/.test(p.skipped[0].why));
    const d = p.docs[0].doc;
    assert.strictEqual(d.when, "Weekdays 7:13 AM, 10:13 AM, 1:13 PM, 4:13 PM");
    assert.strictEqual(d.lastStatus, "ok");
    assert.deepStrictEqual(d.onItsOwn, ["Adds rows to the Watch tab"]);
    assert(!("prompt" in d));
  });

  await check("routine.sync full:true marks routines that are gone as removed", () => {
    const prior = { [T1]: { name: "a" }, [T2]: { name: "b" } };
    const p = CW.planSync({ full: true, routines: [{ id: T1, name: "a", enabled: true }] }, prior, NOW);
    assert.deepStrictEqual(p.removedIds, [T2]);
    assert.deepStrictEqual(CW.planSync({ routines: [{ id: T1, name: "a", enabled: true }] }, prior, NOW).removedIds, []);
  });

  await check("routine.checkin: ok / failed / nothing, failed needs a note, no dollars, first check-in needs a name", () => {
    assert(CW.planCheckin({ id: T2, status: "ok" }, null, NOW).refused);
    const first = CW.planCheckin({ id: T2, name: "CED pickups", status: "ok", flagged: 0 }, null, NOW);
    assert(!first.refused && first.created && first.patch.lastStatus === "ok" && first.patch.enabled === true);
    assert(CW.planCheckin({ id: T2, status: "failed" }, { name: "x" }, NOW).refused);
    const f = CW.planCheckin({ id: T2, status: "failed", note: "Simpro didn't answer" }, { name: "x" }, NOW);
    assert(!f.refused && f.patch.lastStatus === "failed" && !("enabled" in f.patch));
    assert(CW.planCheckin({ id: T2, status: "ok", note: "saved $400" }, { name: "x" }, NOW).refused);
    assert(CW.planCheckin({ id: T2, status: "ok", prompt: "x" }, { name: "x" }, NOW).refused);
    const no = CW.planCheckin({ id: T2, status: "nothing" }, { name: "x" }, NOW);
    assert(no.patch.lastNothing === true && no.patch.lastStatus === "ok");
  });

  await check("flag.post: a known jobId wins over a typed number and name", () => {
    const f = { ...coFlag, jobNo: "9999", jobName: "Wrong" }; const p = CW.planFlags({ flags: [f] }, { "1772863862618": JOB }, {}, NOW);
    assert.strictEqual(p.docs.length, 1, JSON.stringify(p.skipped));
    const d = p.docs[0].doc;
    assert.strictEqual(d.jobNo, "1107"); assert.strictEqual(d.jobName, "Kweller");
    assert.strictEqual(d.status, "open"); assert.strictEqual(d.firstSeen, NOW);
    assert.strictEqual(p.docs[0].id, CW.flagId("1107-q2819"));   // the key is case-blind
    assert.strictEqual(p.results[0].result, "new");
  });

  await check("flag.post: never a stage or status change, an email, an announcement or any-document write", () => {
    for (const action of ["phase.setStage", "phase.setStatus", "qc.setStatus", "material.sendPo", "broadcast.send", "question.reply", "doc.set", "undo.apply", "job.setField"]) {
      const p = CW.planFlags({ flags: [{ ...coFlag, proposal: [{ action, args: { jobId: "1772863862618" } }] }] }, { "1772863862618": JOB }, {}, NOW);
      assert.strictEqual(p.docs.length, 0, action);
    }
    const stage = CW.planFlags({ flags: [{ ...coFlag, proposal: [{ action: "phase.setStage", args: {} }] }] }, { "1772863862618": JOB }, {}, NOW);
    assert(/stage/.test(stage.skipped[0].why));
    for (const a of CW.FLAG_ACTIONS) assert(!CW.NEVER_ACTIONS.includes(a), a);
  });

  await check("flag.post: a change on another job, dollars without ownersOnly, unknown fields, too many changes are refused", () => {
    const J = { "1772863862618": JOB };
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, proposal: [{ action: "co.create", args: { jobId: "1772863869999" } }] }] }, J, {}, NOW).docs.length, 0);
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, detail: "Quote is $4,200" }] }, J, {}, NOW).docs.length, 0);
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, detail: "Quote is $4,200", ownersOnly: true }] }, J, {}, NOW).docs.length, 1);
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, prompt: "x" }] }, J, {}, NOW).docs.length, 0);
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, proposal: Array(11).fill(coFlag.proposal[0]) }] }, J, {}, NOW).docs.length, 0);
    assert.strictEqual(CW.planFlags({ flags: [{ ...coFlag, jobId: "1772863860000" }] }, J, {}, NOW).docs.length, 0);
    assert(CW.planFlags({ flags: [] }, J, {}, NOW).refused);
  });

  await check("flag.post again: open → refreshed (first seen kept); answered → only lastSeen, answer handed back; reopen:true → open again with history", () => {
    const J = { "1772863862618": JOB };
    const first = CW.planFlags({ flags: [coFlag] }, J, {}, "2026-11-10T14:00:00.000Z").docs[0];
    const again = CW.planFlags({ flags: [coFlag] }, J, { [first.id]: first.doc }, NOW);
    assert.strictEqual(again.docs[0].doc.firstSeen, "2026-11-10T14:00:00.000Z");
    assert.strictEqual(again.docs[0].doc.seen, 2);
    assert.strictEqual(again.results[0].result, "updated");
    const answered = { ...first.doc, status: "dismissed", answer: { choice: "dismiss", at: "2026-11-11T00:00:00Z", by: "Koy" } };
    const quiet = CW.planFlags({ flags: [coFlag] }, J, { [first.id]: answered }, NOW);
    assert.strictEqual(quiet.docs[0].patch, true);
    assert.deepStrictEqual(Object.keys(quiet.docs[0].doc).sort(), ["lastSeen", "seen"]);
    assert.strictEqual(quiet.results[0].result, "alreadyAnswered");
    assert.strictEqual(quiet.results[0].answer.choice, "dismiss");
    const re = CW.planFlags({ flags: [{ ...coFlag, reopen: true, why: "New quote 3004" }] }, J, { [first.id]: answered }, NOW);
    assert.strictEqual(re.docs[0].doc.status, "open");
    assert.strictEqual(re.docs[0].doc.history.length, 1);
    assert.strictEqual(re.docs[0].doc.reopenedWhy, "New quote 3004");
  });

  await check("flag.close: a watch marks it handled with a reason; closed flags are a no-op", () => {
    const id = CW.flagId(coFlag.key);
    assert(CW.planClose({ key: coFlag.key }, { status: "open" }, NOW).refused);
    const c = CW.planClose({ key: coFlag.key, why: "CO 12 now in Command Center" }, { status: "open" }, NOW);
    assert.strictEqual(c.id, id); assert.strictEqual(c.patch.status, "handled");
    assert(CW.planClose({ key: coFlag.key, why: "x" }, { status: "applied" }, NOW).noop);
  });

  await check("Koy's answer: the flag must be as he saw it, yes runs the proposal, others just record", () => {
    const doc = { ...CW.planFlags({ flags: [coFlag] }, { "1772863862618": JOB }, {}, "2026-11-12T10:00:00.000Z").docs[0].doc };
    const id = CW.flagId(coFlag.key);
    assert(CW.planAnswer({ id, choice: "yes", seenAt: "old" }, doc, NOW).refused);
    const yes = CW.planAnswer({ id, choice: "yes", seenAt: doc.updatedAt }, doc, NOW);
    assert.strictEqual(yes.run.length, 1); assert.strictEqual(yes.status, "applying");
    const no = CW.planAnswer({ id, choice: "no", seenAt: doc.updatedAt }, doc, NOW);
    assert.strictEqual(no.run.length, 0); assert.strictEqual(no.status, "answered");
    assert.strictEqual(CW.finishAnswer(no, [], NOW).status, "answered");
    assert.strictEqual(CW.planAnswer({ id, choice: "dismiss", seenAt: doc.updatedAt }, doc, NOW).status, "dismissed");
    assert.strictEqual(CW.planAnswer({ id, choice: "done", seenAt: doc.updatedAt }, doc, NOW).status, "done");
    assert(CW.planAnswer({ id, choice: "answer", text: "", seenAt: doc.updatedAt }, doc, NOW).refused);
    assert.strictEqual(CW.planAnswer({ id, choice: "answer", text: "Tuesday", seenAt: doc.updatedAt }, doc, NOW).answer.text, "Tuesday");
    assert(CW.planAnswer({ id, choice: "yes", seenAt: doc.updatedAt }, { ...doc, status: "applied" }, NOW).refused);
    // A stage change smuggled into a stored proposal is refused at the Yes too.
    assert(CW.planAnswer({ id, choice: "yes", seenAt: doc.updatedAt }, { ...doc, proposal: [{ action: "phase.setStage", args: {} }] }, NOW).refused);
  });

  await check("v636 plain buttons: Add to my tasks makes one My Day task, Schedule it writes nothing", () => {
    const ask = { key: "josh-chat-2026-11-13-1107", routine: "Asks watch", routineId: "trig_01BhZ7Nmn6MAhRpk2tg7sqKh", channel: "asks-of-me", jobId: "1772863862618", kind: "schedule", title: "Colby asks for a crew to put in heat tape", ask: "yes_no" };
    const doc = { ...CW.planFlags({ flags: [ask] }, { "1772863862618": JOB }, {}, "2026-11-12T10:00:00.000Z").docs[0].doc };
    const id = CW.flagId(ask.key);
    const t = CW.planAnswer({ id, choice: "task", seenAt: doc.updatedAt }, doc, NOW);
    assert.strictEqual(t.run.length, 1); assert.strictEqual(t.run[0].action, "task.create");
    assert.strictEqual(t.run[0].args.text, ask.title); assert.strictEqual(t.run[0].args.jobId, "1772863862618");
    assert.strictEqual(CW.finishAnswer(t, [{ i: 0, action: "task.create", ok: true, requestId: "fa_t" }], NOW).status, "tasked");
    assert.strictEqual(CW.finishAnswer(t, [{ i: 0, action: "task.create", ok: false, refused: "dup" }], NOW).status, "failed");
    const s = CW.planAnswer({ id, choice: "schedule", seenAt: doc.updatedAt }, doc, NOW);
    assert.strictEqual(s.run.length, 0); assert.strictEqual(s.status, "toSchedule");
    assert.strictEqual(CW.finishAnswer(s, [], NOW).status, "toSchedule");
    assert(CW.planAnswer({ id, choice: "book", seenAt: doc.updatedAt }, doc, NOW).refused);
    const noJob = CW.taskFor({ title: "Call the builder" });
    assert.strictEqual(noJob.args.jobId, undefined);
    // A task answer never runs a stored proposal, even on a card that has one.
    const co = { ...CW.planFlags({ flags: [coFlag] }, { "1772863862618": JOB }, {}, "2026-11-12T10:00:00.000Z").docs[0].doc };
    const t2 = CW.planAnswer({ id: CW.flagId(coFlag.key), choice: "task", seenAt: co.updatedAt }, co, NOW);
    assert.deepStrictEqual(t2.run.map(r => r.action), ["task.create"]);
    // The watches read the new answers back.
    const rows = [[id, { ...doc, ...CW.finishAnswer(s, [], NOW) }]];
    assert.strictEqual(CW.listView(rows, { status: "answered" })[0].answer.choice, "schedule");
  });

  await check("a Yes that stopped part way: failed, and the next Yes runs only what didn't go through", () => {
    const doc = { ...CW.planFlags({ flags: [{ ...coFlag, proposal: [coFlag.proposal[0], { action: "rt.create", args: { jobId: "1772863862618", title: "Cans" } }] }] }, { "1772863862618": JOB }, {}, "2026-11-12T10:00:00.000Z").docs[0].doc };
    const id = CW.flagId(coFlag.key);
    const p = CW.planAnswer({ id, choice: "yes", seenAt: doc.updatedAt }, doc, NOW);
    const out = CW.finishAnswer(p, [{ i: 0, action: "co.create", ok: true, requestId: "fa_a" }, { i: 1, action: "rt.create", ok: false, refused: "No such job" }], NOW);
    assert.strictEqual(out.status, "failed"); assert.strictEqual(out.applied.why, "No such job");
    const after = { ...doc, ...out };
    const retry = CW.planAnswer({ id, choice: "yes", seenAt: after.updatedAt }, after, "2026-11-13T03:00:00.000Z");
    assert.deepStrictEqual(retry.run.map(r => r.action), ["rt.create"]);
    const fin = CW.finishAnswer(retry, [{ i: 1, action: "rt.create", ok: true }], NOW);
    assert.strictEqual(fin.status, "applied"); assert.strictEqual(fin.applied.results.length, 2);
    // Stuck "applying" (the run died): no second Yes, but Done / Dismiss close it.
    const stuck = { ...doc, status: "applying", updatedAt: "2026-11-13T01:00:00.000Z" };
    assert(CW.planAnswer({ id, choice: "yes", seenAt: stuck.updatedAt }, stuck, NOW).refused);
    assert.strictEqual(CW.planAnswer({ id, choice: "done", seenAt: stuck.updatedAt }, stuck, NOW).status, "done");
    assert(CW.planAnswer({ id, choice: "done", seenAt: "2026-11-13T02:09:00.000Z" }, { ...doc, status: "applying", updatedAt: "2026-11-13T02:09:00.000Z" }, NOW).refused);
  });

  await check("flag.list hands answers back to the watches, never the proposal args", () => {
    const rows = [[CW.flagId("a-1"), { key: "a-1", status: "answered", answer: { choice: "no" }, updatedAt: NOW, proposal: [{ action: "co.create", args: { x: 1 } }] }],
      [CW.flagId("b-2"), { key: "b-2", status: "open", updatedAt: NOW }]];
    const ans = CW.listView(rows, {});
    assert.strictEqual(ans.length, 1); assert.strictEqual(ans[0].answer.choice, "no"); assert(!("proposal" in ans[0]));
    assert.strictEqual(CW.listView(rows, { status: "open" }).length, 1);
    assert.strictEqual(CW.listView(rows, { status: "all", keys: ["B-2"] }).length, 1);
  });

  await check("the dashboard read: open oldest first, health per routine, only Koy can answer", () => {
    const routines = [
      [T1, { name: "Job issues watch", enabled: true, nextAt: "2026-11-12T20:00:00.000Z", lastRunAt: "2026-11-12T17:00:00.000Z", lastStatus: "ok" }],
      [T2, { name: "CED pickups", enabled: true, nextAt: "2026-11-13T13:47:00.000Z", lastRunAt: "2026-11-12T13:47:00.000Z", lastStatus: "failed" }],
      ["trig_0000000000old", { name: "Old one", enabled: false }],
      ["trig_00000000gone1", { name: "Gone", enabled: true, removed: true }],
    ];
    const flags = [[CW.flagId("x-1"), { key: "x-1", status: "open", firstSeen: "2026-11-12T00:00:00.000Z", updatedAt: NOW, title: "b" }],
      [CW.flagId("x-2"), { key: "x-2", status: "open", firstSeen: "2026-11-05T00:00:00.000Z", updatedAt: NOW, title: "a" }],
      [CW.flagId("x-3"), { key: "x-3", status: "applied", firstSeen: "2026-11-05T00:00:00.000Z", updatedAt: NOW, title: "c" }]];
    const w = CW.buildWork({ routines, flags, viewer: { id: "koy" }, nowIso: NOW });
    assert.strictEqual(w.canAnswer, true);
    assert.deepStrictEqual(w.open.map(f => f.key), ["x-2", "x-1"]);
    assert.strictEqual(w.open[0].daysOpen, 8);
    assert.strictEqual(w.closed.length, 1);
    const h = Object.fromEntries(w.routines.map(r => [r.name, r.health]));
    assert.deepStrictEqual(h, { "Job issues watch": "missed", "CED pickups": "failed", "Old one": "off" });
    assert.strictEqual(CW.buildWork({ routines, flags, viewer: { id: "josh" }, nowIso: NOW }).canAnswer, false);
  });

  // duetApi end to end through a fake io (the same handle() the connector calls).
  const store = { claude_routines: {}, claude_flags: {} }, audits = {};
  const io = {
    nowIso: () => NOW, todayYmd: () => "2026-11-12", getAudit: async (id) => audits[id] || null, countRecent: async () => 0, getUsers: async () => [],
    getJobData: async (id) => (id === "1772863862618" ? JOB : null),
    getRoutines: async (ids) => { if (!ids) return { ...store.claude_routines }; const o = {}; ids.forEach(i => { if (store.claude_routines[i]) o[i] = store.claude_routines[i]; }); return o; },
    getFlags: async (ids) => { const o = {}; ids.forEach(i => { if (store.claude_flags[i]) o[i] = store.claude_flags[i]; }); return o; },
    listFlags: async () => Object.entries(store.claude_flags),
    writeWork: async (coll, rows) => rows.forEach(({ id, doc, merge }) => { store[coll][id] = merge ? { ...(store[coll][id] || {}), ...doc } : doc; }),
  };
  await check("duetApi: routine.checkin then routine.sync land in claude_routines; no duet_writes audit", async () => {
    let r = await API.handle({ requestId: "chk_000000001", action: "routine.checkin", args: { id: T2, name: "CED pickups", status: "ok", flagged: 0 } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    r = await API.handle({ requestId: "syn_000000001", action: "routine.sync", args: { full: true, routines: [{ id: T2, name: "CED pickups: mark POs picked up", cron: "CRON_TZ=America/Denver 47 6 * * 1-5", enabled: true }] } }, io);
    assert.strictEqual(r.body.synced, 1);
    assert.strictEqual(store.claude_routines[T2].when, "Weekdays 6:47 AM");
    assert.strictEqual(store.claude_routines[T2].lastFrom, "checkin");   // the check-in's run is kept
    assert.strictEqual(Object.keys(audits).length, 0);
  });
  await check("duetApi: flag.post, flag.list, flag.close", async () => {
    let r = await API.handle({ requestId: "flg_000000001", action: "flag.post", args: { flags: [coFlag, { ...coFlag, key: "1107-stage", proposal: [{ action: "phase.setStage", args: {} }] }] } }, io);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.results.length, 1); assert.strictEqual(r.body.skipped.length, 1);
    r = await API.handle({ requestId: "lst_000000001", action: "flag.list", args: { status: "open" } }, io);
    assert.strictEqual(r.body.flags.length, 1); assert.strictEqual(r.body.flags[0].jobName, "Kweller");
    r = await API.handle({ requestId: "cls_000000001", action: "flag.close", args: { key: coFlag.key, why: "CO now in CC" } }, io);
    assert.strictEqual(r.body.status, "handled");
  });

  await check("duetApi stamps okBy on the audit when Koy's dashboard Yes runs a change", () => {
    const src = fs.readFileSync(path.join(__dirname, "../functions/duetWrites/api.js"), "utf8");
    assert(/async function handle\(body, io, opts\)/.test(src));
    assert(/okBy: String\(opts\.okBy\)/.test(src));
    assert(/runAsKoy/.test(src));
    const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
    assert(/exports\.claudeFlagAnswer/.test(idx) && /user\.id !== "koy"/.test(idx), "only Koy answers");
    assert(/_duet\.runAsKoy\(/.test(idx));
    assert(API.ACTIONS.includes("flag.post") && API.ACTIONS.includes("routine.sync"));
  });

  await check("rules: claude_routines and claude_flags are server-only", () => {
    const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
    for (const c of ["claude_routines", "claude_flags"]) assert(new RegExp(`match /${c}/\\{id\\} \\{\\s*allow read, write: if false;`).test(rules), c);
  });

  console.log(`claude-work-test: ${n} passed`);
})();
