"use strict";
// Duet write access (D9), ship 4: job questions. PURE planners — given the
// request, the live job and what the server knows (clock, team list), they
// return either a refusal or exactly what to write, copied from the app's own
// handlers in src/App.js:
//   • add      → QAList.addQuestion (~L37536): {id, question, answer:"", done:false,
//                for, room?, addedBy, addedAt} appended to data.<phase>Questions.<floor>
//   • answer   → My Day's Save answer (~L69447): {answer: escapeHtml(t), done:true,
//                answeredBy, answeredAt, answeredVia} (+ answerNote, the QAList input)
//   • done     → My Day's "Done without answer": {done:true}
//   • reopen   → the QAList checkbox un-tick (~L37663): {done:false, answeredBy:'',
//                answeredAt:''} (+ gcAnswered:false, answeredVia:'', gcRejected when
//                the answer came through a link)
//   • reply    → postQuestionThreadMessage (~L22943) on homeowner_requests/<jobId>
//                .questionThreads["<phase>_<floor>_<qid>"]: {id, by, role:"crew",
//                text, photos:[], at}
// Questions live on exactly three floors, upper / main / basement (the app's
// normalizer, ~L30935); a question is found by id across those three. No
// Firestore here: api.js does the transaction, scripts/duet-notes-test.js
// drives these with fixtures.
const { ME, resolvePerson, cleanText } = require("./needs.js");
const { newItemId, jobGate } = require("./jobItems.js");
const { escapeHtml } = require("../escapeHtml.js");

const PHASES = ["rough", "finish"];
const FLOORS = ["upper", "main", "basement"];
// The two recipients the app's own text names besides people ("a person's
// name, or "GC" / "Designer"…", App.js ~L68947).
const FIXED_RECIPIENTS = ["GC", "Designer"];
const ANSWERED_VIA = "duet";   // added to ANSWER_METHODS in App.js (v603) so the chip renders

const refuse = (why) => ({ refused: why });
const fieldOf = (phase) => `${phase}Questions`;
const byId = (arr, id) => (Array.isArray(arr) ? arr : []).findIndex(x => x && String(x.id) === String(id));
const phaseGate = (phase) => (PHASES.includes(phase) ? null : refuse(`phase must be rough or finish.`));

// The in-memory shape the app keeps: the three floors always present as
// arrays, any other key on the raw object carried along untouched.
function floorsOf(job, phase) {
  const raw = job.data[fieldOf(phase)];
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { ...base };
  for (const f of FLOORS) out[f] = Array.isArray(base[f]) ? base[f] : [];
  return out;
}
// Every question id on the job (both phases, every key) so a new id is bumped
// past all of them — the app's uid() counter never repeats within a page.
function allQuestionIds(job) {
  const ids = [];
  for (const p of PHASES) { const qs = floorsOf(job, p); Object.keys(qs).forEach(k => (Array.isArray(qs[k]) ? qs[k] : []).forEach(q => q && q.id != null && ids.push(q.id))); }
  return ids;
}
function allRecipients(job) {
  const set = new Set();
  for (const p of PHASES) { const qs = floorsOf(job, p); Object.keys(qs).forEach(k => (Array.isArray(qs[k]) ? qs[k] : []).forEach(q => { const r = String((q && q.for) || "").trim(); if (r) set.add(r); })); }
  return [...set];
}
// Find one question by id across the three floors of a phase.
function findQuestion(job, phase, qId) {
  const qs = floorsOf(job, phase);
  for (const floor of FLOORS) {
    const i = byId(qs[floor], qId);
    if (i >= 0) return { qs, floor, index: i, q: qs[floor][i], list: qs[floor] };
  }
  return null;
}
const notFound = (job, phase, qId) => refuse(`No ${phase} question with id ${qId} on ${job.data.name || "that job"} (looked on upper, main and basement). Nothing was written.`);

// `for` is the recipient chip: a team member's name as the team list spells
// it, GC, Designer, or a recipient already used on this job's questions (the
// app's "Assign to" offers exactly those plus free text; free text is where
// typos come from, so anything else is refused with the close names).
function resolveFor(value, ctx, job) {
  if (value == null || value === "") return { name: "" };
  if (typeof value !== "string") return refuse("for must be text.");
  const want = cleanText(value).slice(0, 80);
  if (!want) return { name: "" };
  const fixed = FIXED_RECIPIENTS.find(r => r.toLowerCase() === want.toLowerCase());
  if (fixed) return { name: fixed };
  const person = resolvePerson(want, ctx.users);
  if (!person.refused) return { name: person.name };
  const existing = allRecipients(job).find(r => r.toLowerCase() === want.toLowerCase());
  if (existing) return { name: existing };
  const used = allRecipients(job);
  return refuse(`"${want}" isn't on the active team list, isn't GC or Designer, and isn't a recipient already on this job's questions${used.length ? ` (${used.join(", ")})` : ""}. Nothing was written.`);
}

// QAList.addQuestion: the exact entry, key for key, appended to the floor.
function planAddQuestion(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "");
  const pg = phaseGate(phase); if (pg) return pg;
  const floor = String(a.floor || "");
  if (!FLOORS.includes(floor)) return refuse(`floor must be one of ${FLOORS.join(", ")} — questions have no other floors.`);
  if (a.question != null && typeof a.question !== "string" && typeof a.question !== "number") return refuse("question must be text.");
  const question = cleanText(a.question);
  if (!question) return refuse("A question needs its text (question).");
  if (a.room != null && typeof a.room !== "string") return refuse("room must be text.");
  const room = a.room != null ? cleanText(a.room).slice(0, 120) : "";
  const who = resolveFor(a.for, ctx, ctx.job); if (who.refused) return who;
  const qs = floorsOf(ctx.job, phase);
  const list = qs[floor];
  const q = { id: newItemId(Date.parse(ctx.nowIso), allQuestionIds(ctx.job)), question, answer: "", done: false, for: who.name, ...(room ? { room } : {}), addedBy: ME, addedAt: ctx.nowIso };
  return { q, field: fieldOf(phase), questions: { ...qs, [floor]: [...list, q] }, floor, number: list.length + 1 };
}

// My Day's Save answer (escapeHtml, done:true, who/when/via) or its "Done
// without answer" ({done:true}). An answer already on the question is kept
// unless overwrite:true.
function planAnswerQuestion(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "");
  const pg = phaseGate(phase); if (pg) return pg;
  const f = findQuestion(ctx.job, phase, a.qId);
  if (!f) return notFound(ctx.job, phase, a.qId);
  const q = f.q;
  const hasAnswer = a.answer != null && a.answer !== "";
  if (a.doneOnly === true) {
    if (hasAnswer) return refuse("Give an answer OR doneOnly:true, not both.");
    if (q.done) return { noop: true, q, floor: f.floor, number: f.index + 1 };
    return finish(f, { done: true }, phase);
  }
  if (a.answer != null && typeof a.answer !== "string" && typeof a.answer !== "number") return refuse("answer must be text.");
  const text = cleanText(a.answer);
  if (!text) return refuse("answer is required (or doneOnly:true to tick it done without one).");
  const current = String(q.answer || "").trim();
  if (current && a.overwrite !== true) return refuse(`That question already has an answer${q.answeredBy ? ` from ${q.answeredBy}` : ""}: "${current.slice(0, 120)}${current.length > 120 ? "…" : ""}". Say overwrite:true to replace it. Nothing was written.`);
  const patch = { answer: escapeHtml(text), done: true, answeredBy: ME, answeredAt: ctx.nowIso, answeredVia: ANSWERED_VIA };
  if (a.answerNote != null) {
    if (typeof a.answerNote !== "string") return refuse("answerNote must be text.");
    patch.answerNote = cleanText(a.answerNote).slice(0, 300);
  }
  return finish(f, patch, phase);
}

// The un-tick: a REAL reopen (App.js ~L37663) — stamps cleared so the row stops
// claiming it's answered; a link answer also gets its gcRejected snapshot so the
// next Submit from the link can't close it right back up. The answer text stays.
function planReopenQuestion(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "");
  const pg = phaseGate(phase); if (pg) return pg;
  const f = findQuestion(ctx.job, phase, a.qId);
  if (!f) return notFound(ctx.job, phase, a.qId);
  const q = f.q;
  if (!q.done) return { noop: true, q, floor: f.floor, number: f.index + 1 };
  const patch = { done: false, answeredBy: "", answeredAt: "" };
  if (q.gcAnswered) {
    patch.gcAnswered = false;
    patch.answeredVia = "";
    patch.gcRejected = { answer: String(q.answer || ""), photoUrls: (q.answerPhotos || []).map(p => p && p.url).filter(Boolean) };
  }
  return finish(f, patch, phase);
}

function finish(f, patch, phase) {
  const next = { ...f.q, ...patch };
  const list = f.list.map(x => x === f.q ? next : x);
  return { q: next, before: f.q, patch, changed: Object.keys(patch), field: fieldOf(phase), questions: { ...f.qs, [f.floor]: list }, floor: f.floor, number: f.index + 1 };
}

// ── Thread reply (homeowner_requests) ────────────────────────────────────────

// The message My Day posts (~L69437): role "crew", no photos, text ≤ 2000. The
// question must exist on the job (that is where the floor for the key comes
// from); the thread itself lives on homeowner_requests/<jobId>, never on the
// job doc (the Kweller rule for outside-party data).
function planThreadReply(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "");
  const pg = phaseGate(phase); if (pg) return pg;
  const f = findQuestion(ctx.job, phase, a.qId);
  if (!f) return notFound(ctx.job, phase, a.qId);
  if (a.text != null && typeof a.text !== "string" && typeof a.text !== "number") return refuse("text must be text.");
  const text = cleanText(a.text);
  if (!text) return refuse("A reply needs its text.");
  const key = `${phase}_${f.floor}_${f.q.id}`;
  const msg = { id: String(Math.floor(Date.parse(ctx.nowIso))), by: ME, role: "crew", text, photos: [], at: ctx.nowIso };
  return { key, msg, q: f.q, floor: f.floor, number: f.index + 1 };
}

// postQuestionThreadMessage's write, given the locked prev doc: a first-ever
// doc is tx.set({jobId, questionThreads:{[key]:[msg]}}), anything else is
// tx.update({['questionThreads.'+key]: next}). The message id is bumped past
// ids already in the thread so two can never share one.
function threadAppend(prevDoc, jobId, key, msg) {
  const cur = ((prevDoc || {}).questionThreads || {})[key] || [];
  const list = Array.isArray(cur) ? cur : [];
  const id = newItemId(Number(msg.id), list.map(m => m && m.id));
  const m = { ...msg, id };
  const next = [...list, m];
  if (!prevDoc) return { set: { jobId, questionThreads: { [key]: next } }, msg: m, count: next.length, before: 0 };
  return { update: { ["questionThreads." + key]: next }, msg: m, count: next.length, before: list.length };
}

module.exports = { PHASES, FLOORS, FIXED_RECIPIENTS, ANSWERED_VIA, floorsOf, findQuestion, resolveFor, planAddQuestion, planAnswerQuestion, planReopenQuestion, planThreadReply, threadAppend };
