#!/usr/bin/env node
/* duet-notes-test.js — Duet write access (connector D9), ship 4: questions,
 * job notes, daily updates.
 *
 * Drives functions/duetWrites/questions.js + notesUpdates.js (the planners),
 * functions/jobNotesShape.js + functions/escapeHtml.js (byte copies of the
 * app's own modules) and functions/duetWrites/api.js (the handler) against a
 * fake Firestore transaction holding a real-shaped job. Proves: a Duet-added
 * question is key for key QAList.addQuestion's entry on exactly one of the
 * three floors; an answer is My Day's shape with the app's escapeHtml and
 * answeredVia "duet"; a question is found by id across upper / main /
 * basement; an existing answer refuses unless overwrite; done-only writes
 * {done:true}; reopen clears the stamps (+ the gcRejected variant); a thread
 * reply copies postQuestionThreadMessage — key "<phase>_<floor>_<qid>", set
 * for a first doc, the one dotted questionThreads.<key> otherwise, the
 * versions snapshot pruned to 10 and nothing else ever deleted; a job note on
 * an unmigrated job materializes the legacy instructions with
 * buildMigratedJobNotes and stamps jobNotesMigratedAt in the same write (the
 * app's first-write rule); edits by id on such a job refuse; add / addLine /
 * editLine / archive / delete are the app's shapes and delete is soft only;
 * a daily update is PREPENDED with today's Mountain date; every write
 * carries the job envelope and the audit doc rides in the same transaction;
 * only jobs + homeowner_requests (+ its versions) + duet_writes are written.
 * No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const QS = require(path.join(root, "functions", "duetWrites", "questions.js"));
const NU = require(path.join(root, "functions", "duetWrites", "notesUpdates.js"));
const JN = require(path.join(root, "functions", "jobNotesShape.js"));
const { escapeHtml } = require(path.join(root, "functions", "escapeHtml.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-03T20:15:00.000Z";          // 1:15 PM Mountain
const NOW_MS = Date.parse(NOW);
const TODAY = "2026-11-03";
const USERS = [
  { id: 1, name: "Koy", title: "office", access: "admin" },
  { id: 2, name: "Josh", title: "office", access: "manager" },
  { id: 3, name: "Colby", title: "foreman" },
  { id: 4, name: "Keegan", title: "foreman" },
  { id: 8, name: "Old Guy", title: "crew", active: false },
];
const Q1 = { id: "1762000000001", question: "Fan box height?", answer: "", done: false, for: "GC", addedBy: "Keegan", addedAt: "2026-10-30T15:00:00.000Z" };
const Q2 = { id: "1762000000002", question: "Island pendant count?", answer: "Three", done: true, for: "Designer", room: "Kitchen", addedBy: "Koy", addedAt: "2026-10-30T16:00:00.000Z", answeredBy: "Dusty", answeredAt: "2026-11-01T10:00:00.000Z", answeredVia: "link", gcAnswered: true, answerPhotos: [{ url: "https://x/a.jpg" }, { nope: true }] };
const Q3 = { id: "1762000000003", question: "Plate color in the basement bath?", answer: "", done: false, for: "Dusty", addedBy: "Colby", addedAt: "2026-11-01T15:00:00.000Z" };
const Q4 = { id: "1762000000004", question: "Done without answer one", answer: "", done: true, for: "", addedBy: "Koy", addedAt: "2026-11-01T16:00:00.000Z" };
const L1 = { id: "1762100000002", text: "Move the fridge receptacle", createdAt: "2026-10-20T15:00:00.000Z", photos: [], promoted: null };
const L2 = { id: "1762100000003", text: "Add a can over the sink", createdAt: "2026-10-20T15:00:00.000Z", photos: [], promoted: { type: "punch", id: "p77" } };
const N1 = { id: "1762100000001", title: "Rough walk", phase: "rough", createdAt: "2026-10-20T15:00:00.000Z", createdBy: "Keegan", updatedAt: "2026-10-21T15:00:00.000Z", lines: [L1, L2], photos: [], archived: false, deleted: false, migratedFrom: null };
const N2 = { id: "1762100000004", title: "Old", phase: "general", createdAt: "2026-10-20T15:00:00.000Z", createdBy: "Koy", updatedAt: "2026-10-25T15:00:00.000Z", lines: [{ id: "1762100000005", text: "x", createdAt: "2026-10-20T15:00:00.000Z", photos: [], promoted: null }], photos: [], archived: true, archivedAt: "2026-10-25T15:00:00.000Z", deleted: false, migratedFrom: null };
const N3 = { ...N2, id: "1762100000006", title: "Gone", archived: false, archivedAt: null, deleted: true, lines: [{ id: "1762100000007", text: "y", createdAt: "2026-10-20T15:00:00.000Z", photos: [], promoted: null }] };
const U1 = { id: "1762050000001", date: "2026-11-02", text: "Rough 60% — upstairs done", addedBy: "Keegan", createdAt: "2026-11-02T22:00:00.000Z" };
const JOB = { id: "1772863862618", data: {
  name: "Forth", foreman: "Keegan", lead: "Colby", archived: false, deleted: false,
  roughQuestions: { upper: [Q2], main: [Q1, Q4], basement: [], garage: [] },
  finishQuestions: { upper: [], main: [], basement: [Q3] },
  jobNotes: [N1, N2, N3], jobNotesMigratedAt: "2026-10-20T15:00:00.000Z",
  roughInstructions: [{ id: "ri0", label: "Ignored once migrated", text: "x" }],
  roughUpdates: [U1], finishUpdates: [],
} };
// A job that still shows its legacy instructions as notes (the migration trap).
const LEGACY = { id: "1772863862619", data: {
  name: "Miller", foreman: "Colby", archived: false,
  roughInstructions: [
    { id: "ri1", label: "Panel", text: "<p>200A in the garage<br>feed from the <b>north</b> wall&nbsp;&amp; up</p>" },
    { id: "ri2", label: "", text: "" },
    { id: "ri3", label: "", text: "Keep the island on its own circuit" },
  ],
  finishInstructions: [{ id: "fi1", label: "<b>Plates</b>", text: "Screwless white" }],
  jobNotes: [],
} };
// Migrated before the HTML cleanup: stored notes still carry markup.
const HTMLJOB = { id: "1772863862620", data: { name: "Stratton", archived: false, jobNotesMigratedAt: "2026-09-01T00:00:00.000Z",
  jobNotes: [{ id: "1761000000001", title: "<p>Spec</p>", phase: "spec", createdAt: "x", createdBy: "", updatedAt: "x", lines: [{ id: "1761000000002", text: "Plates&nbsp;white", createdAt: "x", photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: null }] } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const ctx = (job) => ({ nowIso: NOW, todayYmd: TODAY, users: USERS, tz: "America/Denver", job: job === undefined ? clone(JOB) : job });

// ── shared modules ───────────────────────────────────────────────────────────
ok("functions/jobNotesShape.js and functions/escapeHtml.js are byte copies of src/ (the sync gate)", () => {
  assert.ok(fs.readFileSync(path.join(root, "src", "jobNotesShape.js")).equals(fs.readFileSync(path.join(root, "functions", "jobNotesShape.js"))));
  assert.ok(fs.readFileSync(path.join(root, "src", "escapeHtml.js")).equals(fs.readFileSync(path.join(root, "functions", "escapeHtml.js"))));
  const san = require(path.join(root, "src", "sanitizeHtml.js"));
  assert.strictEqual(san.escapeHtml, require(path.join(root, "src", "escapeHtml.js")).escapeHtml, "SafeHtml.escapeHtml IS the lifted function (same reference in the app)");
  assert.strictEqual(san.escapeHtml.toString(), escapeHtml.toString(), "…and the functions/ copy is the same lines");
  assert.strictEqual(escapeHtml(`5 < 6 & "quoted" 'single'`), "5 &lt; 6 &amp; &quot;quoted&quot; &#39;single&#39;");
});
ok("jobNotesShape: HTML → text, looks-like-HTML, migration build (skips empty rows, label → title, 'Migrated note' fallback, migratedFrom), display sanitize, needMigration", () => {
  assert.strictEqual(JN.jobNoteHtmlToText("<p>200A in the garage<br>feed from the <b>north</b> wall&nbsp;&amp; up</p>"), "200A in the garage\nfeed from the north wall & up");
  assert.strictEqual(JN.jobNoteHtmlToText("plain text"), "plain text");
  assert.strictEqual(JN.jobNoteLooksLikeHtml("Plates&nbsp;white"), true); assert.strictEqual(JN.jobNoteLooksLikeHtml("5 < 6"), false);
  let i = 0; const uid = () => String(100 + i++);
  const m = JN.buildMigratedJobNotes(LEGACY.data, uid, NOW);
  assert.deepStrictEqual(m, [
    { id: "100", title: "Panel", phase: "rough", createdAt: NOW, createdBy: "", updatedAt: NOW, lines: [{ id: "101", text: "200A in the garage\nfeed from the north wall & up", createdAt: NOW, photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: { phase: "rough", originalId: "ri1" } },
    { id: "102", title: "Migrated note", phase: "rough", createdAt: NOW, createdBy: "", updatedAt: NOW, lines: [{ id: "103", text: "Keep the island on its own circuit", createdAt: NOW, photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: { phase: "rough", originalId: "ri3" } },
    { id: "104", title: "Plates", phase: "finish", createdAt: NOW, createdBy: "", updatedAt: NOW, lines: [{ id: "105", text: "Screwless white", createdAt: NOW, photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: { phase: "finish", originalId: "fi1" } },
  ]);
  assert.deepStrictEqual(Object.keys(m[0]), ["id", "title", "phase", "createdAt", "createdBy", "updatedAt", "lines", "photos", "archived", "deleted", "migratedFrom"], "the app's key order");
  const cleaned = JN.sanitizeJobNotesForDisplay(HTMLJOB.data.jobNotes);
  assert.strictEqual(cleaned[0].title, "Spec"); assert.strictEqual(cleaned[0].lines[0].text, "Plates white"); assert.strictEqual(cleaned[0].id, "1761000000001");
  assert.strictEqual(JN.sanitizeJobNotesForDisplay(JOB.data.jobNotes), JOB.data.jobNotes, "plain notes come back as the same array");
  assert.strictEqual(JN.normalizeJobNotes(JOB.data, uid), JOB.data.jobNotes);
  assert.deepStrictEqual(JN.normalizeJobNotes({ jobNotes: [], jobNotesMigratedAt: "x", roughInstructions: LEGACY.data.roughInstructions }, uid), [], "an intentional clear stays empty");
  assert.strictEqual(JN.normalizeJobNotes(LEGACY.data, uid).length, 3);
  assert.strictEqual(JN.jobNotesNeedMigration(LEGACY.data), true); assert.strictEqual(JN.jobNotesNeedMigration(JOB.data), false); assert.strictEqual(JN.jobNotesNeedMigration({ jobNotes: [], jobNotesMigratedAt: "x" }), false);
});

// ── questions ────────────────────────────────────────────────────────────────
ok("floorsOf / findQuestion: the three floors always present, extra keys carried, a question found by id on any of the three", () => {
  const qs = QS.floorsOf(clone(JOB), "finish");
  assert.deepStrictEqual(Object.keys(qs).sort(), ["basement", "main", "upper"]); assert.deepStrictEqual(qs.basement, [Q3]);
  assert.deepStrictEqual(Object.keys(QS.floorsOf(clone(JOB), "rough")).sort(), ["basement", "garage", "main", "upper"]);
  assert.deepStrictEqual(QS.floorsOf({ data: {} }, "rough"), { upper: [], main: [], basement: [] });
  assert.strictEqual(QS.findQuestion(clone(JOB), "rough", Q2.id).floor, "upper");
  assert.strictEqual(QS.findQuestion(clone(JOB), "rough", Q4.id).index, 1);
  assert.strictEqual(QS.findQuestion(clone(JOB), "finish", Q3.id).floor, "basement");
  assert.strictEqual(QS.findQuestion(clone(JOB), "finish", Q1.id), null, "a rough id is not found on finish");
});
ok("resolveFor: a team name (case-folded), GC / Designer, or a recipient already on the job; anything else refuses with the names used", () => {
  const j = clone(JOB);
  assert.deepStrictEqual(QS.resolveFor("colby", ctx(), j), { name: "Colby" });
  assert.deepStrictEqual(QS.resolveFor("gc", ctx(), j), { name: "GC" }); assert.deepStrictEqual(QS.resolveFor("designer", ctx(), j), { name: "Designer" });
  assert.deepStrictEqual(QS.resolveFor("dusty", ctx(), j), { name: "Dusty" }, "already used on this job's questions");
  assert.deepStrictEqual(QS.resolveFor("", ctx(), j), { name: "" }); assert.deepStrictEqual(QS.resolveFor(undefined, ctx(), j), { name: "" });
  assert.match(QS.resolveFor("Zed", ctx(), j).refused, /isn't on the active team list.*GC or Designer.*Dusty/);
  assert.match(QS.resolveFor("Old Guy", ctx(), j).refused, /isn't on the active team/);
});
ok("planAddQuestion: QAList.addQuestion's entry key for key (room only when given), Koy as addedBy, appended to ONE floor, other floors + extra keys untouched", () => {
  const r = QS.planAddQuestion({ phase: "rough", floor: "main", question: "  Where does the EV charger go?  ", for: "GC" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.q, { id: String(NOW_MS), question: "Where does the EV charger go?", answer: "", done: false, for: "GC", addedBy: "Koy", addedAt: NOW });
  assert.deepStrictEqual(Object.keys(r.q), ["id", "question", "answer", "done", "for", "addedBy", "addedAt"]);
  assert.strictEqual(r.field, "roughQuestions"); assert.strictEqual(r.floor, "main"); assert.strictEqual(r.number, 3);
  assert.deepStrictEqual(r.questions, { upper: [Q2], main: [Q1, Q4, r.q], basement: [], garage: [] });
  const room = QS.planAddQuestion({ phase: "finish", floor: "upper", question: "Sconce height?", room: "Primary bath" }, ctx());
  assert.deepStrictEqual(Object.keys(room.q), ["id", "question", "answer", "done", "for", "room", "addedBy", "addedAt"]);
  assert.strictEqual(room.q.for, ""); assert.strictEqual(room.q.room, "Primary bath"); assert.deepStrictEqual(room.questions.basement, [Q3]);
  const bumped = QS.planAddQuestion({ phase: "rough", floor: "basement", question: "x" }, ctx({ ...clone(JOB), data: { ...clone(JOB.data), finishQuestions: { upper: [], main: [{ ...Q3, id: String(NOW_MS) }], basement: [] } } }));
  assert.strictEqual(bumped.q.id, String(NOW_MS + 1), "id bumped past one already on the job (either phase)");
  const empty = QS.planAddQuestion({ phase: "rough", floor: "main", question: "x" }, ctx({ id: "1", data: { name: "Bare" } }));
  assert.deepStrictEqual(empty.questions, { upper: [], main: [empty.q], basement: [] }, "a job with no questions field gets the app's three-floor object");
});
ok("planAddQuestion: refuses a fourth floor, a bad phase, no text, an unknown recipient, an archived / missing job", () => {
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "garage", question: "x" }, ctx()).refused, /no other floors/);
  assert.match(QS.planAddQuestion({ phase: "qc", floor: "main", question: "x" }, ctx()).refused, /phase must be/);
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "main", question: "   " }, ctx()).refused, /needs its text/);
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "main", question: { html: 1 } }, ctx()).refused, /must be text/);
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "main", question: "x", for: "Zed" }, ctx()).refused, /Nothing was written/);
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "main", question: "x" }, ctx({ id: "1", data: { ...JOB.data, archived: true } })).refused, /archived/);
  assert.match(QS.planAddQuestion({ phase: "rough", floor: "main", question: "x" }, ctx(null)).refused, /doesn't exist/);
});
ok("planAnswerQuestion: My Day's shape — escapeHtml'd answer, done, Koy, now, answeredVia duet (+ answerNote); found across the three floors; others byte-identical", () => {
  const r = QS.planAnswerQuestion({ phase: "rough", qId: Q1.id, answer: `5 < 6 "quoted" works`, answerNote: "Dusty confirmed on site" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.patch, { answer: "5 &lt; 6 &quot;quoted&quot; works", done: true, answeredBy: "Koy", answeredAt: NOW, answeredVia: "duet", answerNote: "Dusty confirmed on site" });
  assert.deepStrictEqual(r.q, { ...Q1, ...r.patch }); assert.deepStrictEqual(r.before, Q1); assert.strictEqual(r.floor, "main"); assert.strictEqual(r.number, 1);
  assert.deepStrictEqual(r.questions, { upper: [Q2], main: [r.q, Q4], basement: [], garage: [] });
  const b = QS.planAnswerQuestion({ phase: "finish", qId: Q3.id, answer: "White" }, ctx());
  assert.strictEqual(b.floor, "basement"); assert.strictEqual(b.field, "finishQuestions"); assert.deepStrictEqual(Object.keys(b.patch), ["answer", "done", "answeredBy", "answeredAt", "answeredVia"]);
  assert.strictEqual(QS.ANSWERED_VIA, "duet");
});
ok("planAnswerQuestion: an existing answer refuses unless overwrite:true; doneOnly writes {done:true} only; done already → no-op; not found names the three floors", () => {
  const already = QS.planAnswerQuestion({ phase: "rough", qId: Q2.id, answer: "Four" }, ctx());
  assert.match(already.refused, /already has an answer from Dusty.*"Three".*overwrite:true/);
  const over = QS.planAnswerQuestion({ phase: "rough", qId: Q2.id, answer: "Four", overwrite: true }, ctx());
  assert.strictEqual(over.q.answer, "Four"); assert.strictEqual(over.q.answeredVia, "duet"); assert.strictEqual(over.q.gcAnswered, true, "the My Day shape doesn't touch gcAnswered");
  const d = QS.planAnswerQuestion({ phase: "rough", qId: Q1.id, doneOnly: true }, ctx());
  assert.deepStrictEqual(d.patch, { done: true }); assert.deepStrictEqual(d.q, { ...Q1, done: true });
  assert.strictEqual(QS.planAnswerQuestion({ phase: "rough", qId: Q4.id, doneOnly: true }, ctx()).noop, true);
  assert.match(QS.planAnswerQuestion({ phase: "rough", qId: Q1.id, doneOnly: true, answer: "x" }, ctx()).refused, /not both/);
  assert.match(QS.planAnswerQuestion({ phase: "rough", qId: Q1.id }, ctx()).refused, /answer is required/);
  assert.match(QS.planAnswerQuestion({ phase: "rough", qId: Q3.id, answer: "x" }, ctx()).refused, /No rough question with id .* upper, main and basement/);
  assert.match(QS.planAnswerQuestion({ phase: "rough", qId: Q1.id, answer: ["x"] }, ctx()).refused, /must be text/);
});
ok("planReopenQuestion: {done:false, answeredBy:'', answeredAt:''}; a link answer also gets gcAnswered:false, answeredVia:'', gcRejected {answer, photoUrls}; open already → no-op; the answer text stays", () => {
  const plain = QS.planReopenQuestion({ phase: "rough", qId: Q4.id }, ctx());
  assert.deepStrictEqual(plain.patch, { done: false, answeredBy: "", answeredAt: "" }); assert.deepStrictEqual(plain.q, { ...Q4, done: false, answeredBy: "", answeredAt: "" });
  const gc = QS.planReopenQuestion({ phase: "rough", qId: Q2.id }, ctx());
  assert.deepStrictEqual(gc.patch, { done: false, answeredBy: "", answeredAt: "", gcAnswered: false, answeredVia: "", gcRejected: { answer: "Three", photoUrls: ["https://x/a.jpg"] } });
  assert.strictEqual(gc.q.answer, "Three", "the answer stays as a draft, as the app's reopen does"); assert.strictEqual(gc.floor, "upper");
  assert.strictEqual(QS.planReopenQuestion({ phase: "rough", qId: Q1.id }, ctx()).noop, true);
  assert.match(QS.planReopenQuestion({ phase: "finish", qId: "nope" }, ctx()).refused, /No finish question/);
});
ok("planThreadReply + threadAppend: key <phase>_<floor>_<qid>, My Day's crew message key for key, set for a first doc, the one dotted key otherwise, id bumped past the thread's", () => {
  const r = QS.planThreadReply({ phase: "finish", qId: Q3.id, text: "  Yes — white, Dusty picked them  " }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.strictEqual(r.key, `finish_basement_${Q3.id}`); assert.strictEqual(r.floor, "basement");
  assert.deepStrictEqual(r.msg, { id: String(NOW_MS), by: "Koy", role: "crew", text: "Yes — white, Dusty picked them", photos: [], at: NOW });
  assert.deepStrictEqual(Object.keys(r.msg), ["id", "by", "role", "text", "photos", "at"]);
  const first = QS.threadAppend(null, JOB.id, r.key, r.msg);
  assert.deepStrictEqual(first, { set: { jobId: JOB.id, questionThreads: { [r.key]: [r.msg] } }, msg: r.msg, count: 1, before: 0 });
  const prev = { jobId: JOB.id, questionThreads: { [r.key]: [{ id: String(NOW_MS), by: "Dusty", role: "client", text: "Which white?", photos: [], at: "2026-11-02T00:00:00.000Z" }], other_key: [{ id: "z" }] }, planChangeAcks: { a: 1 } };
  const upd = QS.threadAppend(prev, JOB.id, r.key, r.msg);
  assert.deepStrictEqual(Object.keys(upd.update), ["questionThreads." + r.key], "ONE dotted key — other threads and fields untouched");
  assert.strictEqual(upd.update["questionThreads." + r.key].length, 2); assert.strictEqual(upd.msg.id, String(NOW_MS + 1), "bumped past the client's message id"); assert.strictEqual(upd.before, 1);
  assert.deepStrictEqual(upd.update["questionThreads." + r.key][0], prev.questionThreads[r.key][0], "the designer's message is byte-identical");
  const long = QS.planThreadReply({ phase: "rough", qId: Q1.id, text: "x".repeat(3000) }, ctx());
  assert.strictEqual(long.msg.text.length, 2000);
  assert.match(QS.planThreadReply({ phase: "rough", qId: Q1.id, text: "" }, ctx()).refused, /needs its text/);
  assert.match(QS.planThreadReply({ phase: "rough", qId: Q3.id, text: "x" }, ctx()).refused, /No rough question/);
});

// ── job notes ────────────────────────────────────────────────────────────────
ok("idMaker / currentNotes: ids count up from now past every note + line id; a legacy job materializes, a saved job keeps its list, an old-HTML job comes back cleaned (what the app's next write persists)", () => {
  const next = NU.idMaker(1000, ["1000", "1002"]);
  assert.deepStrictEqual([next(), next(), next()], ["1001", "1003", "1004"]);
  const leg = NU.currentNotes(clone(LEGACY), ctx());
  assert.strictEqual(leg.migrate, true); assert.strictEqual(leg.notes.length, 3); assert.strictEqual(leg.notes[0].id, String(NOW_MS)); assert.strictEqual(leg.notes[2].lines[0].id, String(NOW_MS + 5));
  const saved = NU.currentNotes(clone(JOB), ctx());
  assert.strictEqual(saved.migrate, false); assert.deepStrictEqual(saved.notes, [N1, N2, N3]); assert.strictEqual(saved.cleaned, false);
  const html = NU.currentNotes(clone(HTMLJOB), ctx());
  assert.strictEqual(html.migrate, false); assert.strictEqual(html.cleaned, true); assert.strictEqual(html.notes[0].title, "Spec");
});
ok("planAddNote: addNote's note key for key with title + first line filled, Koy as creator, appended last, no migration stamp on a saved job", () => {
  const r = NU.planAddNote({ title: "GC call 11/3", text: "Panel moves to the garage wall", phase: "rough" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.note, { id: String(NOW_MS), title: "GC call 11/3", phase: "rough", createdAt: NOW, createdBy: "Koy", updatedAt: NOW, lines: [{ id: String(NOW_MS + 1), text: "Panel moves to the garage wall", createdAt: NOW, photos: [], promoted: null }], photos: [], archived: false, deleted: false, migratedFrom: null });
  assert.deepStrictEqual(Object.keys(r.note), ["id", "title", "phase", "createdAt", "createdBy", "updatedAt", "lines", "photos", "archived", "deleted", "migratedFrom"]);
  assert.deepStrictEqual(Object.keys(r.fields), ["jobNotes"]); assert.deepStrictEqual(r.fields.jobNotes, [N1, N2, N3, r.note]); assert.strictEqual(r.migrated, 0); assert.strictEqual(r.number, 4);
  const gen = NU.planAddNote({ text: "just a line" }, ctx());
  assert.strictEqual(gen.note.phase, "general"); assert.strictEqual(gen.note.title, "");
  assert.strictEqual(NU.planAddNote({ title: "Spec only", phase: "spec" }, ctx()).note.lines[0].text, "");
  assert.match(NU.planAddNote({}, ctx()).refused, /title or some text/);
  assert.match(NU.planAddNote({ text: "x", phase: "qc" }, ctx()).refused, /phase must be/);
  assert.match(NU.planAddNote({ text: "x" }, ctx({ id: "1", data: { ...JOB.data, archived: true } })).refused, /archived/);
});
ok("planAddNote on an unmigrated job: the legacy notes are materialized with the app's code, the new note is appended after them and jobNotesMigratedAt is stamped in the SAME write", () => {
  const r = NU.planAddNote({ text: "First real note" }, ctx(clone(LEGACY)));
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(Object.keys(r.fields).sort(), ["jobNotes", "jobNotesMigratedAt"]);
  assert.strictEqual(r.fields.jobNotesMigratedAt, NOW); assert.strictEqual(r.migrated, 3); assert.strictEqual(r.number, 4);
  assert.deepStrictEqual(r.fields.jobNotes.slice(0, 3), JN.buildMigratedJobNotes(LEGACY.data, NU.idMaker(NOW_MS, []), NOW), "exactly buildMigratedJobNotes' output");
  assert.strictEqual(r.fields.jobNotes[3], r.note); assert.strictEqual(r.note.id, String(NOW_MS + 6)); assert.strictEqual(r.note.lines[0].id, String(NOW_MS + 7));
  const cleaned = NU.planAddNote({ text: "x" }, ctx(clone(HTMLJOB)));
  assert.deepStrictEqual(Object.keys(cleaned.fields), ["jobNotes"], "already migrated → no stamp");
  assert.strictEqual(cleaned.fields.jobNotes[0].title, "Spec", "the old HTML note goes back cleaned, as the app's next write does");
});
ok("planAddLine / planEditLine: addLine's line appended + updatedAt; a promoted line refuses; same text no-op; \"\" clears; archived / deleted / unknown refuse; an unmigrated job refuses by id", () => {
  const r = NU.planAddLine({ noteId: N1.id, text: "Check the dryer circuit" }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.line, { id: String(NOW_MS), text: "Check the dryer circuit", createdAt: NOW, photos: [], promoted: null });
  assert.deepStrictEqual(r.note, { ...N1, lines: [L1, L2, r.line], updatedAt: NOW }); assert.deepStrictEqual(r.fields.jobNotes, [r.note, N2, N3]); assert.strictEqual(r.number, 1);
  const e = NU.planEditLine({ noteId: N1.id, lineId: L1.id, text: "Move the fridge receptacle 6\" left" }, ctx());
  assert.deepStrictEqual(e.line, { ...L1, text: "Move the fridge receptacle 6\" left" }); assert.deepStrictEqual(e.note.lines[1], L2); assert.strictEqual(e.note.updatedAt, NOW); assert.deepStrictEqual(e.beforeLine, L1);
  assert.match(NU.planEditLine({ noteId: N1.id, lineId: L2.id, text: "x" }, ctx()).refused, /promoted to punch/);
  assert.strictEqual(NU.planEditLine({ noteId: N1.id, lineId: L1.id, text: L1.text }, ctx()).noop, true);
  assert.strictEqual(NU.planEditLine({ noteId: N1.id, lineId: L1.id, text: "" }, ctx()).line.text, "");
  assert.match(NU.planEditLine({ noteId: N1.id, lineId: L1.id }, ctx()).refused, /text is required/);
  assert.match(NU.planEditLine({ noteId: N1.id, lineId: "zz", text: "x" }, ctx()).refused, /No line with id zz/);
  assert.match(NU.planAddLine({ noteId: N2.id, text: "x" }, ctx()).refused, /archived — unarchive it first/);
  assert.match(NU.planAddLine({ noteId: N3.id, text: "x" }, ctx()).refused, /was deleted/);
  assert.match(NU.planAddLine({ noteId: "nope", text: "x" }, ctx()).refused, /No job note with id nope/);
  assert.match(NU.planAddLine({ noteId: N1.id, text: "" }, ctx()).refused, /needs its text/);
  assert.match(NU.planAddLine({ noteId: String(NOW_MS), text: "x" }, ctx(clone(LEGACY))).refused, /haven't been saved in the new format yet.*Add a note first/);
});
ok("planArchiveNote / planDeleteNote: archive {archived:true, archivedAt, updatedAt}, unarchive {archived:false, archivedAt:null, updatedAt}, delete is {deleted:true, updatedAt} with the note KEPT in the array", () => {
  const a = NU.planArchiveNote({ noteId: N1.id, archived: true }, ctx());
  assert.deepStrictEqual(a.note, { ...N1, archived: true, archivedAt: NOW, updatedAt: NOW }); assert.deepStrictEqual(a.fields.jobNotes, [a.note, N2, N3]);
  const u = NU.planArchiveNote({ noteId: N2.id, archived: false }, ctx());
  assert.deepStrictEqual(u.note, { ...N2, archived: false, archivedAt: null, updatedAt: NOW });
  assert.strictEqual(NU.planArchiveNote({ noteId: N2.id, archived: true }, ctx()).noop, true); assert.strictEqual(NU.planArchiveNote({ noteId: N1.id, archived: false }, ctx()).noop, true);
  assert.match(NU.planArchiveNote({ noteId: N1.id, archived: "yes" }, ctx()).refused, /archived must be true/);
  assert.match(NU.planArchiveNote({ noteId: N3.id, archived: true }, ctx()).refused, /was deleted/);
  const d = NU.planDeleteNote({ noteId: N1.id }, ctx());
  assert.deepStrictEqual(d.note, { ...N1, deleted: true, updatedAt: NOW }); assert.strictEqual(d.fields.jobNotes.length, 3, "soft delete: the array keeps its length"); assert.deepStrictEqual(d.fields.jobNotes[0].lines, [L1, L2], "lines kept for audit"); assert.strictEqual(d.promotedLines, 1);
  assert.ok(!NU.planDeleteNote({ noteId: N2.id }, ctx()).refused, "an archived note can be deleted (the app's archive fold offers it)");
  assert.match(NU.planDeleteNote({ noteId: N3.id }, ctx()).refused, /was deleted/);
  assert.match(NU.planDeleteNote({ noteId: String(NOW_MS) }, ctx(clone(LEGACY))).refused, /haven't been saved/);
});

// ── daily updates ────────────────────────────────────────────────────────────
ok("planAddDailyUpdate: DailyUpdates.add's entry key for key, PREPENDED, dated today in Mountain time unless given; finish goes to finishUpdates; refusals", () => {
  const r = NU.planAddDailyUpdate({ phase: "rough", text: "  Upstairs rough done, basement tomorrow  " }, ctx());
  assert.ok(!r.refused, r.refused);
  assert.deepStrictEqual(r.entry, { id: String(NOW_MS), date: TODAY, text: "Upstairs rough done, basement tomorrow", addedBy: "Koy", createdAt: NOW });
  assert.deepStrictEqual(Object.keys(r.entry), ["id", "date", "text", "addedBy", "createdAt"]);
  assert.deepStrictEqual(r.updates, [r.entry, U1], "newest FIRST — the Scoreboard and the card read it that way"); assert.strictEqual(r.field, "roughUpdates"); assert.strictEqual(r.number, 2);
  const f = NU.planAddDailyUpdate({ phase: "finish", text: "Trim started", date: "2026-11-02" }, ctx());
  assert.strictEqual(f.field, "finishUpdates"); assert.strictEqual(f.entry.date, "2026-11-02"); assert.deepStrictEqual(f.updates, [f.entry]);
  assert.match(NU.planAddDailyUpdate({ phase: "rough", text: "x", date: "11/3/2026" }, ctx()).refused, /YYYY-MM-DD/);
  assert.match(NU.planAddDailyUpdate({ phase: "qc", text: "x" }, ctx()).refused, /rough or finish/);
  assert.match(NU.planAddDailyUpdate({ phase: "rough" }, ctx()).refused, /needs its text/);
  assert.match(NU.planAddDailyUpdate({ phase: "rough", text: "x" }, ctx(null)).refused, /doesn't exist/);
});

// ── api.handle against a fake Firestore ──────────────────────────────────────
function fakeIo({ docs = {}, versions = {}, recent = 0, users = USERS } = {}) {
  const log = [];
  const store = { ...docs };
  const vstore = clone(versions);   // homeowner_requests/<id>/versions → [{id, snap, at, by}]
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id });
  const setPath = (obj, dotted, v) => { const parts = dotted.split("."); let cur = obj; for (let i = 0; i < parts.length - 1; i++) { if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; };
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path]); if (store[r.path]) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } store[r.path] = d; },
    update: (r, d) => { log.push(["update", r.path, d]); if (!store[r.path]) throw new Error("update on a missing doc: " + r.path); const cur = clone(store[r.path]); Object.keys(d).forEach(k => setPath(cur, k, d[k])); store[r.path] = cur; },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called inside a transaction"); },
  };
  let vseq = 0;
  return {
    log, store, vstore,
    nowIso: () => NOW, todayYmd: () => TODAY, rand: () => "abcde", tz: "America/Denver",
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
    snapshotHrVersion: async (jobId, prev, tag, nowIso) => {
      log.push(["snapshot", `homeowner_requests/${jobId}/versions`, { prev: !!prev, tag }]);
      if (!prev) return false;
      const list = vstore[jobId] || (vstore[jobId] = []);
      list.push({ id: "v" + (++vseq), snap: prev, at: nowIso, by: tag });
      list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      list.splice(10).forEach(v => log.push(["delete", `homeowner_requests/${jobId}/versions/${v.id}`]));
      return true;
    },
    arrayUnion: (...x) => ({ __arrayUnion: x }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
  };
}
const JOB_DOC = (j) => ({ data: clone((j || JOB).data), updated_at: NOW, saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 602, w: "602.abcdefgh" });
const jobIo = (extra) => fakeIo({ docs: { ["jobs/" + JOB.id]: JOB_DOC(), ["jobs/" + LEGACY.id]: JOB_DOC(LEGACY) }, ...(extra || {}) });
const run = (body, io) => api.handle(body, io);
const RID = "44444444-4444-4444-8444-444444444444";
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const ALLOWED_JOB_FIELDS = ["roughQuestions", "finishQuestions", "jobNotes", "jobNotesMigratedAt", "roughUpdates", "finishUpdates"];
const checkEnvelope = (upd) => {
  assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.strictEqual(upd.merged, false); assert.ok(upd.tab.startsWith("duet-4444"));
  assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 603 && /^\d+\.duet[a-z0-9]{6,}$/.test(upd.w), "version-lock stamp");
  assert.deepStrictEqual(upd.lastActivityAt, { __serverTimestamp: true }); assert.ok(upd.updated_at > NOW, "updated_at strictly newer than the doc's");
};

(async () => {
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "question.add", email: "koy@homesteadelectric.net", args: { jobId: JOB.id, phase: "rough", floor: "main", question: "Where does the EV charger go?", for: "gc" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.floor, "main"); assert.strictEqual(r.body.number, 3); assert.deepStrictEqual(r.body.pushTo, ["foreman", "coordinator"]); assert.strictEqual(r.body.for, "GC");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), [...ENVELOPE, "data.roughQuestions"].sort(), "ONE dotted key — the whole three-floor object — plus the job envelope");
    checkEnvelope(upd);
    assert.deepStrictEqual(Object.keys(upd["data.roughQuestions"]).sort(), ["basement", "garage", "main", "upper"]); assert.deepStrictEqual(upd["data.roughQuestions"].upper, [Q2]); assert.strictEqual(upd["data.roughQuestions"].main[2].id, r.body.qId);
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.coll, "jobs"); assert.deepStrictEqual(audit.fields, ["roughQuestions"]); assert.strictEqual(audit.itemId, r.body.qId); assert.strictEqual(audit.before.roughQuestions, null); assert.strictEqual(audit.after.roughQuestions.question, "Where does the EV charger go?");
    assert.deepStrictEqual(io.log.map(l => l[0]), ["get", "update", "set"], "read, write, audit — one transaction");
    assert.strictEqual(io.store["jobs/" + JOB.id].data.finishQuestions.basement[0].id, Q3.id, "the other phase untouched");
    n++; console.log("ok   handle question.add: read-modify-write, dotted data.roughQuestions (three floors + extras), job envelope, item-level audit in one tx; onJobUpdate's job_question push follows");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "question.answer", args: { jobId: JOB.id, phase: "finish", qId: Q3.id, answer: `White <screwless>` } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.floor, "basement"); assert.strictEqual(r.body.answeredVia, "duet"); assert.deepStrictEqual(r.body.pushTo, []);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")), ["data.finishQuestions"]);
    assert.strictEqual(upd["data.finishQuestions"].basement[0].answer, "White &lt;screwless&gt;"); assert.strictEqual(upd["data.finishQuestions"].basement[0].done, true);
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual(audit.before.finishQuestions, Q3); assert.strictEqual(audit.after.finishQuestions.answeredBy, "Koy");
    const again = await run({ requestId: RID, action: "question.answer", args: { jobId: JOB.id, phase: "finish", qId: Q3.id, answer: "Different", overwrite: true } }, io);
    assert.strictEqual(again.body.replayed, true); assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1, "same requestId → nothing written, even with different args");
    const twice = await run({ requestId: RID + "2", action: "question.answer", args: { jobId: JOB.id, phase: "finish", qId: Q3.id, answer: "Different" } }, io);
    assert.strictEqual(twice.status, 400); assert.match(twice.body.refused, /already has an answer from Koy/); assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1);
    const noop = await run({ requestId: RID + "n", action: "question.answer", args: { jobId: JOB.id, phase: "rough", qId: Q4.id, doneOnly: true } }, io);
    assert.strictEqual(noop.body.noop, true); assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1, "a no-op is audited only");
    const re = await run({ requestId: RID + "r", action: "question.reopen", args: { jobId: JOB.id, phase: "rough", qId: Q2.id } }, io);
    assert.strictEqual(re.status, 200, JSON.stringify(re.body)); assert.strictEqual(re.body.gcRejected, true); assert.strictEqual(re.body.floor, "upper");
    const q2 = io.store["jobs/" + JOB.id].data.roughQuestions.upper[0];
    assert.strictEqual(q2.done, false); assert.strictEqual(q2.gcAnswered, false); assert.deepStrictEqual(q2.gcRejected, { answer: "Three", photoUrls: ["https://x/a.jpg"] }); assert.strictEqual(q2.answer, "Three");
    assert.deepStrictEqual(io.store["jobs/" + JOB.id].data.roughQuestions.main, [Q1, Q4], "the other floor byte-identical");
    n++; console.log("ok   handle question.answer / reopen: found by id on the basement / upper floor, only that question changes, already-answered refuses, replay + no-op write nothing");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "note.add", args: { jobId: LEGACY.id, title: "GC call", text: "Panel to the garage wall", phase: "rough" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.migratedLegacyNotes, 3); assert.strictEqual(r.body.notesOnJob, 4); assert.strictEqual(r.body.number, 4);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")).sort(), ["data.jobNotes", "data.jobNotesMigratedAt"], "the migration stamp rides in the SAME write (JobDetail u()'s rule)");
    assert.strictEqual(upd["data.jobNotesMigratedAt"], NOW); assert.strictEqual(upd["data.jobNotes"].length, 4); assert.strictEqual(upd["data.jobNotes"][0].title, "Panel"); assert.strictEqual(upd["data.jobNotes"][3].id, r.body.noteId);
    checkEnvelope(upd);
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual(audit.fields.sort(), ["jobNotes", "jobNotesMigratedAt"]); assert.deepStrictEqual(audit.before, { jobNotes: null, jobNotesMigratedAt: null }); assert.strictEqual(audit.after.jobNotes.title, "GC call"); assert.strictEqual(audit.after.jobNotesMigratedAt, NOW);
    assert.deepStrictEqual(io.store["jobs/" + LEGACY.id].data.roughInstructions, LEGACY.data.roughInstructions, "the legacy instructions themselves are never touched");
    // The job is migrated now: the second note stamps nothing more, and edits by the returned ids work.
    const r2 = await run({ requestId: RID + "2", action: "note.add", args: { jobId: LEGACY.id, text: "Second" } }, io);
    assert.strictEqual(r2.status, 200); assert.strictEqual(r2.body.migratedLegacyNotes, 0); assert.strictEqual(r2.body.notesOnJob, 5);
    assert.deepStrictEqual(Object.keys(io.log.filter(l => l[0] === "update")[1][2]).filter(k => k.startsWith("data.")), ["data.jobNotes"]);
    const line = await run({ requestId: RID + "l", action: "note.addLine", args: { jobId: LEGACY.id, noteId: r.body.noteId, text: "Second line" } }, io);
    assert.strictEqual(line.status, 200, JSON.stringify(line.body)); assert.strictEqual(line.body.lines, 2);
    const note = io.store["jobs/" + LEGACY.id].data.jobNotes.find(x => x.id === r.body.noteId);
    assert.strictEqual(note.lines[1].id, line.body.lineId); assert.strictEqual(note.lines[1].text, "Second line");
    const edit = await run({ requestId: RID + "e", action: "note.editLine", args: { jobId: LEGACY.id, noteId: r.body.noteId, lineId: r.body.lineId, text: "Panel to the garage wall, north side" } }, io);
    assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
    assert.strictEqual(io.store["jobs/" + LEGACY.id].data.jobNotes.find(x => x.id === r.body.noteId).lines[0].text, "Panel to the garage wall, north side");
    assert.strictEqual(io.store["duet_writes/" + RID + "e"].before.jobNotes.lines[0].text, "Panel to the garage wall", "the whole note before/after is the undo material");
    n++; console.log("ok   handle note.add on an unmigrated job: legacy notes materialized + jobNotesMigratedAt in ONE write; then addLine / editLine by the returned ids");
  })();
  await (async () => {
    const io = jobIo();
    const before = await run({ requestId: RID + "x", action: "note.addLine", args: { jobId: LEGACY.id, noteId: String(NOW_MS), text: "x" } }, io);
    assert.strictEqual(before.status, 400); assert.match(before.body.refused, /haven't been saved in the new format yet/); assert.strictEqual(io.log.filter(l => l[0] === "update").length, 0);
    const a = await run({ requestId: RID, action: "note.archive", args: { jobId: JOB.id, noteId: N1.id, archived: true } }, io);
    assert.strictEqual(a.status, 200, JSON.stringify(a.body)); assert.strictEqual(a.body.archived, true);
    const notes1 = io.store["jobs/" + JOB.id].data.jobNotes;
    assert.strictEqual(notes1[0].archived, true); assert.strictEqual(notes1[0].archivedAt, NOW); assert.deepStrictEqual(notes1[1], N2); assert.deepStrictEqual(notes1[2], N3);
    const u = await run({ requestId: RID + "u", action: "note.archive", args: { jobId: JOB.id, noteId: N2.id, archived: false } }, io);
    assert.strictEqual(u.status, 200); assert.strictEqual(io.store["jobs/" + JOB.id].data.jobNotes[1].archivedAt, null);
    const d = await run({ requestId: RID + "d", action: "note.delete", args: { jobId: JOB.id, noteId: N1.id } }, io);
    assert.strictEqual(d.status, 200, JSON.stringify(d.body)); assert.strictEqual(d.body.softDelete, true); assert.strictEqual(d.body.promotedLinesKept, 1);
    const notes2 = io.store["jobs/" + JOB.id].data.jobNotes;
    assert.strictEqual(notes2.length, 3, "soft delete — nothing leaves the array"); assert.strictEqual(notes2[0].deleted, true); assert.deepStrictEqual(notes2[0].lines, [L1, L2]);
    const dd = await run({ requestId: RID + "dd", action: "note.delete", args: { jobId: JOB.id, noteId: N1.id } }, io);
    assert.strictEqual(dd.status, 400); assert.match(dd.body.refused, /was deleted/);
    const prom = await run({ requestId: RID + "p", action: "note.editLine", args: { jobId: JOB.id, noteId: N2.id, lineId: "1762100000005", text: "x" } }, io);
    assert.strictEqual(prom.status, 200, "N2 was unarchived above, so its line edits");
    assert.ok(!io.log.some(l => l[0] === "delete"), "never a Firestore delete");
    n++; console.log("ok   handle note.archive / unarchive / delete: the app's flags, soft delete keeps the note and its lines, an unmigrated job refuses edits by id, never a delete");
  })();
  await (async () => {
    const io = jobIo();
    const r = await run({ requestId: RID, action: "dailyUpdate.add", args: { jobId: JOB.id, phase: "rough", text: "Upstairs rough done" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.date, TODAY); assert.deepStrictEqual(r.body.pushTo, ["coordinator"]); assert.strictEqual(r.body.number, 2);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")), ["data.roughUpdates"]);
    assert.strictEqual(upd["data.roughUpdates"][0].id, r.body.updateId); assert.deepStrictEqual(upd["data.roughUpdates"][1], U1, "prepended — the old entry is byte-identical behind it");
    checkEnvelope(upd);
    const audit = io.store["duet_writes/" + RID];
    assert.deepStrictEqual(audit.fields, ["roughUpdates"]); assert.strictEqual(audit.before.roughUpdates, null); assert.strictEqual(audit.after.roughUpdates.addedBy, "Koy");
    const f = await run({ requestId: RID + "f", action: "dailyUpdate.add", args: { jobId: JOB.id, phase: "finish", text: "Trim started", date: "2026-11-02" } }, io);
    assert.strictEqual(f.status, 200); assert.deepStrictEqual(io.store["jobs/" + JOB.id].data.finishUpdates.map(x => x.date), ["2026-11-02"]);
    n++; console.log("ok   handle dailyUpdate.add: prepended to data.<phase>Updates with today's Mountain date; onJobUpdate's daily_update push to the coordinator follows");
  })();
  await (async () => {
    // First reply ever on this job's side doc: tx.set of the whole {jobId, questionThreads}; no prior doc → no snapshot.
    const io = jobIo();
    const r = await run({ requestId: RID, action: "question.reply", args: { jobId: JOB.id, phase: "finish", qId: Q3.id, text: "Yes — white" } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.key, `finish_basement_${Q3.id}`); assert.strictEqual(r.body.newThreadDoc, true); assert.strictEqual(r.body.versionSnapshot, false); assert.strictEqual(r.body.messagesInThread, 1); assert.strictEqual(r.body.role, "crew");
    assert.deepStrictEqual(io.log.map(l => l[0] + " " + l[1]), ["get jobs/" + JOB.id, "get homeowner_requests/" + JOB.id, "set homeowner_requests/" + JOB.id, "set duet_writes/" + RID, "snapshot homeowner_requests/" + JOB.id + "/versions"], "job read (to find the floor), thread doc read under lock, set, audit, then the snapshot AFTER the write");
    const setDoc = io.log.find(l => l[0] === "set" && l[1].startsWith("homeowner_requests"))[2];
    assert.deepStrictEqual(setDoc, { jobId: JOB.id, questionThreads: { [r.body.key]: [{ id: r.body.messageId, by: "Koy", role: "crew", text: "Yes — white", photos: [], at: NOW }] } }, "postQuestionThreadMessage's first-doc set, key for key");
    assert.ok(!io.log.some(l => l[0] === "update" && l[1].startsWith("jobs/")), "the JOB doc is never written by a reply (the Kweller rule)");
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.coll, "homeowner_requests"); assert.strictEqual(audit.docId, JOB.id); assert.strictEqual(audit.itemId, Q3.id); assert.deepStrictEqual(audit.fields, ["questionThreads." + r.body.key]); assert.strictEqual(audit.newDoc, true);
    assert.deepStrictEqual(audit.before.questionThreads[r.body.key], { messages: 0 }); assert.strictEqual(audit.after.questionThreads[r.body.key].text, "Yes — white");
    // Second reply: the doc exists → ONE dotted update, other threads untouched, snapshot of the prior doc, pruned to 10.
    io.store["homeowner_requests/" + JOB.id].questionThreads["rough_main_" + Q1.id] = [{ id: "m1", by: "Dusty", role: "client", text: "4 ft?", photos: [], at: "2026-11-02T00:00:00.000Z" }];
    io.store["homeowner_requests/" + JOB.id].planChangeAcks = { x: true };
    io.vstore[JOB.id] = Array.from({ length: 12 }, (_, i) => ({ id: "old" + i, snap: {}, at: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`, by: "MyDay" }));
    const r2 = await run({ requestId: RID + "2", action: "question.reply", args: { jobId: JOB.id, phase: "rough", qId: Q1.id, text: "Set it at 48\"" } }, io);
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.body)); assert.strictEqual(r2.body.newThreadDoc, false); assert.strictEqual(r2.body.versionSnapshot, true); assert.strictEqual(r2.body.messagesInThread, 2); assert.strictEqual(r2.body.floor, "main");
    const upd = io.log.filter(l => l[0] === "update").at(-1);
    assert.strictEqual(upd[1], "homeowner_requests/" + JOB.id); assert.deepStrictEqual(Object.keys(upd[2]), ["questionThreads.rough_main_" + Q1.id], "ONE dotted key, no updatedAt (as the app)");
    assert.strictEqual(upd[2]["questionThreads.rough_main_" + Q1.id][0].by, "Dusty"); assert.strictEqual(upd[2]["questionThreads.rough_main_" + Q1.id][1].text, "Set it at 48\"");
    const hr = io.store["homeowner_requests/" + JOB.id];
    assert.strictEqual(hr.questionThreads[r.body.key].length, 1, "the finish thread untouched"); assert.deepStrictEqual(hr.planChangeAcks, { x: true }, "other fields untouched"); assert.strictEqual(hr.jobId, JOB.id);
    const deletes = io.log.filter(l => l[0] === "delete");
    assert.strictEqual(deletes.length, 3, "12 old + 1 new → the 3 oldest pruned (newest 10 kept)");
    assert.ok(deletes.every(l => l[1].startsWith("homeowner_requests/" + JOB.id + "/versions/")), "the ONLY deletes are this writer's own version snapshots");
    assert.strictEqual(io.vstore[JOB.id].length, 10); assert.strictEqual(io.vstore[JOB.id][0].by, "duet"); assert.deepStrictEqual(io.vstore[JOB.id][0].snap.questionThreads[r.body.key].length, 1, "the snapshot is the doc BEFORE this reply");
    // Refusals: a question that isn't on the job, a missing job — the thread doc is never read or written.
    const io2 = jobIo();
    const nope = await run({ requestId: RID + "n", action: "question.reply", args: { jobId: JOB.id, phase: "rough", qId: Q3.id, text: "x" } }, io2);
    assert.strictEqual(nope.status, 400); assert.match(nope.body.refused, /No rough question/); assert.ok(!io2.log.some(l => l[1].startsWith("homeowner_requests")), "no side-doc read or write on a refusal");
    const gone = await run({ requestId: RID + "g", action: "question.reply", args: { jobId: "1999999999999", phase: "rough", qId: Q1.id, text: "x" } }, jobIo());
    assert.strictEqual(gone.status, 404);
    const bad = await run({ requestId: RID + "b", action: "question.reply", args: { jobId: "../settings/users", phase: "rough", qId: Q1.id, text: "x" } }, io2);
    assert.strictEqual(bad.status, 400); assert.strictEqual(io2.log.filter(l => l[0] === "get").length, 1, "a path-shaped jobId never reaches a read");
    n++; console.log("ok   handle question.reply: postQuestionThreadMessage on homeowner_requests — set for a first doc, ONE dotted key after, job doc never written, versions snapshot after the write pruned to 10 (the only deletes), refusals touch no side doc");
  })();
  await (async () => {
    const io = jobIo();
    const bodies = [
      { action: "question.add", args: { jobId: JOB.id, phase: "rough", floor: "upper", question: "a" } },
      { action: "question.answer", args: { jobId: JOB.id, phase: "rough", qId: Q1.id, answer: "b" } },
      { action: "question.reopen", args: { jobId: JOB.id, phase: "rough", qId: Q1.id } },
      { action: "note.add", args: { jobId: JOB.id, text: "c" } },
      { action: "note.addLine", args: { jobId: JOB.id, noteId: N1.id, text: "d" } },
      { action: "note.editLine", args: { jobId: JOB.id, noteId: N1.id, lineId: L1.id, text: "e" } },
      { action: "note.archive", args: { jobId: JOB.id, noteId: N1.id, archived: true } },
      { action: "note.delete", args: { jobId: JOB.id, noteId: N2.id } },
      { action: "dailyUpdate.add", args: { jobId: JOB.id, phase: "finish", text: "f" } },
      { action: "question.reply", args: { jobId: JOB.id, phase: "rough", qId: Q1.id, text: "g" } },
    ];
    for (const [i, body] of bodies.entries()) {
      const r = await run({ requestId: RID + i, ...body }, io);
      assert.strictEqual(r.status, 200, body.action + ": " + JSON.stringify(r.body));
    }
    const writes = io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));
    assert.ok(writes.every(w => w[1] === "jobs/" + JOB.id || w[1] === "homeowner_requests/" + JOB.id || w[1].startsWith("duet_writes/")), "only jobs/<id> + homeowner_requests/<id> + duet_writes written");
    assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create"), "never a delete, never a create");
    assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/")).every(l => Object.keys(l[2]).every(k => k.startsWith("data.") ? ALLOWED_JOB_FIELDS.includes(k.slice(5)) : ENVELOPE.includes(k))), "no other job field is ever written");
    assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("homeowner_requests/")).every(l => Object.keys(l[2]).every(k => k.startsWith("questionThreads."))), "the side doc only ever gets a questionThreads.<key>");
    const job = io.store["jobs/" + JOB.id].data;
    assert.strictEqual(job.name, "Forth"); assert.strictEqual(job.foreman, "Keegan"); assert.strictEqual(job.jobNotes.length, 4); assert.strictEqual(job.roughQuestions.upper.length, 2); assert.strictEqual(job.finishUpdates.length, 1);
    assert.deepStrictEqual(job.roughInstructions, JOB.data.roughInstructions);
    assert.strictEqual(Object.keys(io.store).filter(k => k.startsWith("duet_writes/")).length, 10, "one audit doc per call");
    n++; console.log("ok   handle: all ten ship-4 actions in a row touch only jobs/<id> + homeowner_requests/<id> + duet_writes, never delete or create, never another field");
  })();
  await (async () => {
    assert.deepStrictEqual(api.JOB_ACTIONS, ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"], "the ship-2 list is untouched");
    assert.deepStrictEqual(api.QUESTION_ACTIONS, ["question.add", "question.answer", "question.reopen"]);
    assert.deepStrictEqual(api.NOTE_ACTIONS, ["note.add", "note.addLine", "note.editLine", "note.archive", "note.delete", "dailyUpdate.add"]);
    assert.deepStrictEqual(api.THREAD_ACTIONS, ["question.reply"]);
    assert.ok(api.BUILD >= 603 && Number.isInteger(api.BUILD));
    for (const a of ["question.delete", "note.remove", "note.hardDelete", "dailyUpdate.delete", "dailyUpdate.edit", "question.removeLine", "thread.delete"]) {
      await assert.rejects(run({ requestId: RID, action: a, args: {} }, jobIo()), (e) => e.status === 400 && /action must be/.test(e.message), a);
    }
    const src = fs.readFileSync(path.join(root, "functions", "duetWrites", "api.js"), "utf8");
    assert.ok(!/tx\.delete\(/.test(src), "no tx.delete anywhere in api.js");
    assert.strictEqual((src.match(/\.delete\(/g) || []).length, 3, "exactly three deletes in api.js: the ship-3 Storage cleanup, the versions prune, and (ship 5) FieldValue.delete() on an emptied planner cell — a map key, never a doc");
    n++; console.log("ok   handle: no hard-delete / edit-update action exists; BUILD is the ship-4 SW version; api.js has no tx.delete");
  })();
  console.log(`duet-notes-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
