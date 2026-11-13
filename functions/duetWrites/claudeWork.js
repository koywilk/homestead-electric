"use strict";
// claudeWork.js — Automations and Needs you in the Claude tab (SW v633).
//
// Koy, 2026-11-12: "I would like it added there in the dashboard for sure ...
// in the [Claude] section. And then I want to be able to like work things from
// the dashboard as well, like be able to click on what on see, see all of it.
// So I can work in one spot." Asked whether a Yes in the dashboard should make
// the change right then or wait for Claude: "Change it right then".
//
// Two server-only collections, written only through duetApi (the connector):
//
//   claude_routines/<trig_…>  one row per Claude routine: name, what it checks,
//                             when it runs, what it does on its own, its channel,
//                             last run and how it went. routine.sync writes the
//                             whole list (from a session that can list the
//                             routines); routine.checkin is one routine saying
//                             "I just ran" at the end of its own run.
//   claude_flags/<flg_…>      one row per thing a watch needs Koy for. flag.post
//                             adds or refreshes flags (the same key is the same
//                             flag, so a watch that sees it again only bumps
//                             lastSeen), flag.list hands the answers back to the
//                             watches, flag.close marks one handled when a watch
//                             sees it fixed.
//
// Koy answers a flag in the dashboard (callable claudeFlagAnswer, his own live
// PIN). A Yes on a flag that carries a proposal runs each proposed change
// through duetApi's own handle() in-process — the same guard rails, audit and
// undo as every Duet write — right then. A proposal can only use the actions in
// FLAG_ACTIONS: never a stage or a rough / finish status (Koy, 2026-11-11:
// "never change a job's stage"), never an email, announcement, homeowner reply,
// any-document write, undo or archive.
//
// Pure: no Firebase import (scripts/claude-work-test.js runs it under node).

const crypto = require("crypto");

const ROUTINE_ACTIONS = ["routine.sync", "routine.checkin"];
const FLAG_ACTIONS_API = ["flag.post", "flag.list", "flag.close"];
// What a Yes may run. Everything else duetApi can do is refused at flag.post AND
// again when the Yes is pressed (the list could change between the two).
const FLAG_ACTIONS = [
  "co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate",
  "question.add", "question.answer", "question.reopen",
  "note.add", "note.addLine", "note.editLine", "dailyUpdate.add",
  "punch.setDone", "punch.add", "punch.assign", "punch.waiting", "punch.editText",
  "rtPunch.add", "rtPunch.setDone", "rtPunch.waiting", "rtPunch.editText",
  "inspection.setResult", "inspection.items", "inspection.createTrip", "prep.tick", "phase.setDates",
  "material.addCard", "material.editCard", "material.tick",
  "task.create", "task.update", "job.setPeople", "job.createFromSimpro", "job.setInfo",
  "crew.assign", "crew.unassign", "crew.setLead", "timeOff.decide", "autoTask.promote", "planIntake.decide",
];
// Named so a reader sees the rule, and so a later edit to FLAG_ACTIONS can't slip one in.
const NEVER_ACTIONS = ["phase.setStage", "phase.setStatus", "qc.setStatus", "job.setField", "job.archive", "material.sendPo", "material.previewPo",
  "broadcast.send", "question.reply", "photo.add", "undo.apply", "note.archive", "note.delete", "punch.void", "punch.restore"];
const STATUS = ["open", "answered", "done", "dismissed", "applied", "failed", "handled"];
const CLOSED = new Set(["answered", "done", "dismissed", "applied", "handled"]);
const ASKS = ["yes_no", "date", "name", "text", "done"];
const KINDS = { co: "Change order", inspection: "Inspection", schedule: "Scheduling", trip: "Return trip", po: "PO / material", quote: "Quote", question: "Question", task: "Task", email: "Email", time: "Time off", job: "Job setup", other: "Other" };
const MAX_FLAGS = 25, MAX_PROPOSAL = 10, MAX_ROUTINES = 80;
const TRIG = /^trig_[A-Za-z0-9]{10,40}$/;
const FLAG_ID = /^flg_[0-9a-f]{24}$/;
const DOLLARS = /(\$\s?-?\d)|(\bUSD\s?\d)/i;

function line(v, n) {
  return String(v == null ? "" : v).replace(/https?:\/\/\S+/gi, "[link]").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, n);
}
// Multi-line text: line breaks kept, links and other control characters out.
function text(v, n) {
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
}
const hasDollars = (s) => DOLLARS.test(String(s || ""));
function jobNo(v) { const s = line(v, 12).replace(/^#/, ""); return /^Q?\d{1,6}$/i.test(s) ? s.replace(/^q/, "Q") : ""; }
function iso(v) { const t = Date.parse(String(v || "")); return isNaN(t) ? "" : new Date(t).toISOString(); }
const flagId = (key) => `flg_${crypto.createHash("sha1").update(line(key, 80).toLowerCase()).digest("hex").slice(0, 24)}`;

// ── When it runs, in Denver time ─────────────────────────────────────────────
// Routines carry 5-field crons, either "CRON_TZ=America/Denver m h dom mon dow"
// or plain UTC. Plain UTC hours are shifted to Denver with the offset at nowIso
// (MST -7 / MDT -6), so the words match what Koy's clock says this week.
const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOWS_LONG = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
function denverOffsetHours(nowIso) {
  const d = new Date(nowIso || Date.now());
  const y = d.getUTCFullYear();
  const nth = (month, n) => { const first = new Date(Date.UTC(y, month, 1)); const add = (7 - first.getUTCDay()) % 7; return Date.UTC(y, month, 1 + add + 7 * (n - 1)); };
  const dstStart = nth(2, 2) + 9 * 3600e3;    // 2nd Sunday of March, 2 AM MST = 09:00 UTC
  const dstEnd = nth(10, 1) + 8 * 3600e3;     // 1st Sunday of November, 2 AM MDT = 08:00 UTC
  return d.getTime() >= dstStart && d.getTime() < dstEnd ? -6 : -7;
}
function listOf(field, lo, hi) {
  if (field === "*") return null;
  const out = [];
  for (const part of field.split(",")) {
    const m = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part) || /^\*\/(\d+)$/.exec(part);
    if (!m) return undefined;
    if (part.startsWith("*/")) { for (let i = lo; i <= hi; i += +m[1]) out.push(i); continue; }
    const a = +m[1], b = m[2] != null ? +m[2] : a, step = m[3] ? +m[3] : 1;
    for (let i = a; i <= b; i += step) out.push(i);
  }
  return out;
}
function clock(h, m) { const ap = h < 12 ? "AM" : "PM"; const hh = h % 12 === 0 ? 12 : h % 12; return m ? `${hh}:${String(m).padStart(2, "0")} ${ap}` : `${hh} ${ap}`; }
function daysText(dow) {
  if (dow === null) return "Daily";
  if (dow === undefined) return "";
  const s = [...new Set(dow.map(d => d % 7))].sort((a, b) => a - b);
  if (s.join() === "1,2,3,4,5") return "Weekdays";
  if (s.length === 7) return "Daily";
  if (s.length === 1) return DOWS_LONG[s[0]];
  return s.map(d => DOWS[d]).join(", ");
}
function scheduleText(cron, nowIso) {
  let c = String(cron || "").trim();
  if (!c) return "On demand";
  let denver = false;
  const tz = /^CRON_TZ=(\S+)\s+/.exec(c);
  if (tz) { if (tz[1] !== "America/Denver") return c.slice(0, 60); denver = true; c = c.slice(tz[0].length); }
  const f = c.split(/\s+/);
  if (f.length !== 5) return c.slice(0, 60);
  const mins = listOf(f[0], 0, 59), hours = listOf(f[1], 0, 23), dom = f[2], mon = f[3], dow = listOf(f[4], 0, 7);
  if (mins === undefined || hours === undefined || dow === undefined || !mins || mins.length !== 1) return c.slice(0, 60);
  if (hours === null) return mins[0] === 0 ? "Every hour" : `Every hour at :${String(mins[0]).padStart(2, "0")}`;
  const off = denver ? 0 : denverOffsetHours(nowIso);
  let dayShift = 0;
  const hs = hours.map(h => { let x = h + off; if (x < 0) { x += 24; dayShift = -1; } return x; }).sort((a, b) => a - b);
  let dws = dow;
  if (dayShift && dow) dws = dow.map(d => (d + 6) % 7);
  if (dom !== "*" || mon !== "*") {
    const when = hs.map(h => clock(h, mins[0])).join(", ");
    return dom !== "*" && mon !== "*" ? `Once a year (${mon}/${dom}) ${when}` : `Day ${dom} of the month ${when}`;
  }
  return `${daysText(dws)} ${hs.map(h => clock(h, mins[0])).join(", ")}`.trim();
}

// ── routine.sync ─────────────────────────────────────────────────────────────
// args: { routines: [{ id, name, cron?, runOnceAt?, enabled, nextAt?, lastRunAt?,
//          lastStatus?, about?, onItsOwn?: [..], channelId?, channelName?, archivedChannel? }], full? }
// Only these fields are kept. A routine's prompt, connectors, folders and session
// ids are never accepted (unknown field → that routine is skipped).
const SYNC_FIELDS = ["id", "name", "cron", "runOnceAt", "enabled", "nextAt", "lastRunAt", "lastStatus", "about", "onItsOwn", "channelId", "channelName", "archivedChannel"];
function planSync(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const list = Array.isArray(a.routines) ? a.routines : null;
  if (!list || !list.length) return { refused: "routines must be a list of 1–80 routines" };
  if (list.length > MAX_ROUTINES) return { refused: `at most ${MAX_ROUTINES} routines per call` };
  const docs = [], skipped = [];
  const seen = new Set();
  list.forEach((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) { skipped.push({ i, why: "each routine must be an object" }); return; }
    const extra = Object.keys(r).filter(k => !SYNC_FIELDS.includes(k));
    if (extra.length) { skipped.push({ i, why: `unknown field ${extra.slice(0, 3).join(", ")}` }); return; }
    const id = String(r.id || "");
    if (!TRIG.test(id)) { skipped.push({ i, why: "id must be a routine id like trig_…" }); return; }
    if (seen.has(id)) { skipped.push({ i, why: "listed twice" }); return; }
    seen.add(id);
    const name = line(r.name, 100);
    if (!name) { skipped.push({ i, why: "name is required" }); return; }
    const p = (prior && prior[id]) || {};
    const own = Array.isArray(r.onItsOwn) ? r.onItsOwn.map(x => line(x, 140)).filter(Boolean).slice(0, 8) : (p.onItsOwn || []);
    const cron = line(r.cron, 80);
    const doc = {
      id, name, cron, runOnceAt: iso(r.runOnceAt),
      when: cron ? scheduleText(cron, nowIso) : (iso(r.runOnceAt) ? "One time" : "On demand"),
      enabled: r.enabled === true, archivedChannel: r.archivedChannel === true,
      nextAt: r.enabled === true ? iso(r.nextAt) : "",
      about: r.about != null ? line(r.about, 240) : (p.about || ""),
      onItsOwn: own,
      channelId: r.channelId != null ? line(r.channelId, 40) : (p.channelId || ""),
      channelName: r.channelName != null ? line(r.channelName, 60) : (p.channelName || ""),
      removed: false, syncAt: nowIso,
    };
    // Last run: whichever is newer — the routine's own check-in or the list's record.
    const listRun = iso(r.lastRunAt);
    const st = ["ok", "failed"].includes(String(r.lastStatus || "")) ? String(r.lastStatus) : "";
    if (listRun && (!p.lastRunAt || listRun > p.lastRunAt)) {
      doc.lastRunAt = listRun; doc.lastStatus = st || "ok"; doc.lastFrom = "list";
      if (p.lastRunAt && p.lastFrom === "checkin" && p.lastRunAt.slice(0, 13) === listRun.slice(0, 13)) { doc.lastFrom = "checkin"; doc.lastNote = p.lastNote || ""; doc.lastFlagged = p.lastFlagged || 0; doc.lastStatus = p.lastStatus || doc.lastStatus; }
    }
    docs.push({ id, doc });
  });
  const removedIds = a.full === true && prior ? Object.keys(prior).filter(id => !seen.has(id) && !(prior[id] && prior[id].removed)) : [];
  return { docs, skipped, removedIds };
}

// ── routine.checkin ──────────────────────────────────────────────────────────
// args: { id, name?, status: "ok" | "failed" | "nothing", note?, flagged? }
function planCheckin(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const allowed = ["id", "name", "status", "note", "flagged"];
  const extra = Object.keys(a).filter(k => !allowed.includes(k));
  if (extra.length) return { refused: `unknown field ${extra.slice(0, 3).join(", ")}` };
  const id = String(a.id || "");
  if (!TRIG.test(id)) return { refused: "id must be your routine's id (trig_…)" };
  const status = String(a.status || "");
  if (!["ok", "failed", "nothing"].includes(status)) return { refused: "status must be ok, failed or nothing" };
  const flagged = a.flagged == null ? 0 : parseInt(a.flagged, 10);
  if (isNaN(flagged) || flagged < 0 || flagged > 500) return { refused: "flagged must be a count from 0 to 500" };
  const note = line(a.note, 200);
  if (status !== "ok" && status !== "nothing" && !note) return { refused: "a failed run needs a note saying what failed" };
  if (hasDollars(note)) return { refused: "no dollar figures in a check-in note" };
  const name = line(a.name, 100) || (prior && prior.name) || "";
  if (!name) return { refused: "name is required the first time a routine checks in" };
  const patch = { id, name, lastRunAt: nowIso, lastStatus: status === "failed" ? "failed" : "ok", lastNothing: status === "nothing", lastNote: note, lastFlagged: flagged, lastFrom: "checkin", checkinAt: nowIso };
  if (!prior) Object.assign(patch, { cron: "", when: "", enabled: true, about: "", onItsOwn: [], channelId: "", channelName: "", removed: false, archivedChannel: false, nextAt: "", runOnceAt: "" });
  return { id, patch, created: !prior };
}

// ── flag.post ────────────────────────────────────────────────────────────────
// args: { flags: [{ key, routine, routineId?, channel?, jobId?, jobNo?, jobName?, kind, title,
//         detail?, ask?, choices?, proposal?: [{ action, args }], ownersOnly?, reopen?, why? }] }
// jobs: { <jobId>: live job data } for every jobId named (number + name come from there)
// prior: { <flg_id>: existing doc }
const FLAG_FIELDS = ["key", "routine", "routineId", "channel", "jobId", "jobNo", "jobName", "kind", "title", "detail", "ask", "choices", "proposal", "ownersOnly", "reopen", "why"];
function checkProposal(list, jobId) {
  if (list == null) return { proposal: [] };
  if (!Array.isArray(list)) return { why: "proposal must be a list of { action, args }" };
  if (list.length > MAX_PROPOSAL) return { why: `a proposal holds at most ${MAX_PROPOSAL} changes` };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p !== "object" || Array.isArray(p)) return { why: `change ${i + 1} must be { action, args }` };
    const extra = Object.keys(p).filter(k => !["action", "args"].includes(k));
    if (extra.length) return { why: `change ${i + 1}: unknown field ${extra[0]}` };
    const action = String(p.action || "");
    if (NEVER_ACTIONS.includes(action)) return { why: `change ${i + 1}: ${action} can never be done from a flag${/stage|status/i.test(action) ? " (job stages and rough / finish status stay Koy's own call)" : ""}` };
    if (!FLAG_ACTIONS.includes(action)) return { why: `change ${i + 1}: ${action || "(none)"} isn't a change a flag can make` };
    const args = p.args && typeof p.args === "object" && !Array.isArray(p.args) ? p.args : null;
    if (!args) return { why: `change ${i + 1}: args must be an object` };
    let size = 0; try { size = JSON.stringify(args).length; } catch (e) { return { why: `change ${i + 1}: args can't be read` }; }
    if (size > 20000) return { why: `change ${i + 1}: args are too big` };
    if (jobId && args.jobId && String(args.jobId) !== jobId) return { why: `change ${i + 1} is on another job than the flag` };
    out.push({ action, args });
  }
  return { proposal: out };
}
function planFlags(args, jobs, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const list = Array.isArray(a.flags) ? a.flags : null;
  if (!list || !list.length || list.length > MAX_FLAGS) return { refused: `flags must be a list of 1–${MAX_FLAGS} flags` };
  const docs = [], skipped = [], results = [];
  const seen = new Set();
  list.forEach((f, i) => {
    const skip = (why) => { skipped.push({ i, key: f && f.key ? line(f.key, 80) : "", why }); };
    if (!f || typeof f !== "object" || Array.isArray(f)) return skip("each flag must be an object");
    const extra = Object.keys(f).filter(k => !FLAG_FIELDS.includes(k));
    if (extra.length) return skip(`unknown field ${extra.slice(0, 3).join(", ")}`);
    const key = line(f.key, 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9 #+._:\/-]{2,79}$/.test(key)) return skip("key must be the flag's id, e.g. 1107-Q2819 (3–80 letters, digits, - + . _ : / #)");
    const id = flagId(key);
    if (seen.has(id)) return skip("listed twice");
    seen.add(id);
    const routine = line(f.routine, 100);
    if (!routine) return skip("routine is required (the name of the routine raising it)");
    if (f.routineId != null && f.routineId !== "" && !TRIG.test(String(f.routineId))) return skip("routineId must be trig_…");
    const title = line(f.title, 160);
    if (!title) return skip("title is required");
    const kind = KINDS[f.kind] ? f.kind : "other";
    const ask = ASKS.includes(f.ask) ? f.ask : (Array.isArray(f.proposal) && f.proposal.length ? "yes_no" : "yes_no");
    const detail = text(f.detail, 3000);
    if (f.ownersOnly != null && typeof f.ownersOnly !== "boolean") return skip("ownersOnly must be true or false");
    const ownersOnly = f.ownersOnly === true;
    if (!ownersOnly && (hasDollars(title) || hasDollars(detail))) return skip("this flag has dollar figures: send it with ownersOnly:true or take them out");
    const choices = Array.isArray(f.choices) ? f.choices.map(c => line(c, 60)).filter(Boolean).slice(0, 6) : [];
    let jobIdV = "", jobNoV = "", jobNameV = "";
    if (f.jobId) {
      jobIdV = String(f.jobId);
      const j = jobs && jobs[jobIdV];
      if (!j) return skip(`No Command Center job ${jobIdV.slice(0, 20)}`);
      jobNoV = jobNo(j.simproNo); jobNameV = line(j.name, 120);
    } else { jobNoV = jobNo(f.jobNo); jobNameV = jobNoV ? line(f.jobName, 120) : ""; }
    const pr = checkProposal(f.proposal, jobIdV);
    if (pr.why) return skip(pr.why);
    const p = prior && prior[id];
    const base = {
      key, routine, routineId: f.routineId ? String(f.routineId) : "", channel: line(f.channel, 60),
      jobId: jobIdV, jobNo: jobNoV, jobName: jobNameV, kind, title, detail, ask, choices,
      proposal: pr.proposal, ownersOnly, lastSeen: nowIso,
    };
    if (!p) {
      docs.push({ id, doc: { ...base, status: "open", firstSeen: nowIso, seen: 1, updatedAt: nowIso, answer: null, applied: null, history: [] } });
      results.push({ key, id, result: "new" });
      return;
    }
    if (CLOSED.has(p.status) && f.reopen !== true) {
      docs.push({ id, doc: { lastSeen: nowIso, seen: (p.seen || 1) + 1 }, patch: true });
      results.push({ key, id, result: "alreadyAnswered", status: p.status, answer: p.answer || null });
      return;
    }
    if (CLOSED.has(p.status) || p.status === "failed") {
      const hist = (Array.isArray(p.history) ? p.history : []).concat([{ status: p.status, answer: p.answer || null, at: (p.answer && p.answer.at) || p.updatedAt || "" }]).slice(-10);
      docs.push({ id, doc: { ...base, status: "open", firstSeen: p.firstSeen || nowIso, seen: (p.seen || 1) + 1, updatedAt: nowIso, answer: null, applied: null, history: hist, reopenedWhy: line(f.why, 200) } });
      results.push({ key, id, result: "reopened" });
      return;
    }
    docs.push({ id, doc: { ...base, status: "open", firstSeen: p.firstSeen || nowIso, seen: (p.seen || 1) + 1, updatedAt: nowIso, answer: null, applied: null, history: p.history || [] } });
    results.push({ key, id, result: "updated" });
  });
  return { docs, skipped, results };
}

// ── flag.close ── a watch saw the thing fixed on its own. args: { key, why }
function planClose(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const key = line(a.key, 80);
  if (!key) return { refused: "key is required" };
  const id = flagId(key);
  if (!prior) return { refused: `No flag ${key}. Nothing changed.` };
  if (prior.status !== "open" && prior.status !== "failed") return { id, noop: true, status: prior.status };
  const why = line(a.why, 200);
  if (!why) return { refused: "why is required (what you saw that shows it's handled)" };
  return { id, patch: { status: "handled", updatedAt: nowIso, answer: { choice: "handled", text: why, at: nowIso, by: "Claude" } } };
}

// ── flag.list ── what the watches read back. args: { status?: open|answered|all, keys?: [..], since? }
function listView(rows, a) {
  const st = ["open", "answered", "all"].includes(a && a.status) ? a.status : "answered";
  const keys = Array.isArray(a && a.keys) ? new Set(a.keys.map(k => flagId(k))) : null;
  const since = iso(a && a.since);
  return rows.map(([id, d]) => ({ id, ...d }))
    .filter(f => FLAG_ID.test(f.id) && (!keys || keys.has(f.id)) && (!since || (f.updatedAt || "") >= since)
      && (st === "all" || (st === "open" ? f.status === "open" : f.status !== "open")))
    .map(f => ({ key: f.key, status: f.status, routine: f.routine, jobNo: f.jobNo, jobName: f.jobName, title: f.title, answer: f.answer || null,
      applied: f.applied ? { ok: !!f.applied.ok, done: (f.applied.results || []).filter(r => r.ok).length, of: (f.applied.results || []).length, why: f.applied.why || "" } : null,
      firstSeen: f.firstSeen, updatedAt: f.updatedAt }))
    .slice(0, 300);
}

// ── Koy's answer from the dashboard ──────────────────────────────────────────
// args: { id, choice: yes|no|done|dismiss|answer, text?, seenAt } — seenAt is the
// flag's updatedAt as the dashboard drew it, so a Yes never runs a proposal that
// changed after Koy read it.
function planAnswer(args, prior, nowIso) {
  const a = args && typeof args === "object" ? args : {};
  const id = String(a.id || "");
  if (!FLAG_ID.test(id)) return { refused: "Bad flag id." };
  if (!prior) return { refused: "That flag is gone. Refresh." };
  // "applying" left behind by a run that died part way (5+ minutes old): Koy can close
  // it out, but a Yes can't run again — what went through is unknown, so check the job.
  const stuck = prior.status === "applying" && Date.parse(nowIso) - Date.parse(prior.updatedAt || nowIso) > 5 * 60e3;
  if (prior.status !== "open" && prior.status !== "failed" && !stuck) return { refused: prior.status === "applying" ? "That Yes is still running. Refresh in a minute." : `Already ${prior.status}. Refresh to see it.` };
  if (stuck && String(a.choice || "") === "yes") return { refused: "The last Yes on this stopped part way. Check the job, then mark it Done or Dismiss it." };
  if (String(a.seenAt || "") !== String(prior.updatedAt || "")) return { refused: "This flag changed since you opened it. Refresh and look again before answering." };
  const choice = String(a.choice || "");
  if (!["yes", "no", "done", "dismiss", "answer"].includes(choice)) return { refused: "Pick Yes, No, Done, Dismiss or type an answer." };
  const t = line(a.text, 400);
  if (choice === "answer" && !t) return { refused: "Type your answer first." };
  const answer = { choice, text: t, at: nowIso, by: "Koy" };
  // A Yes again on a flag whose earlier Yes stopped part way runs only the changes
  // that didn't go through, so nothing is made twice.
  const doneIdx = new Set(prior.status === "failed" && prior.applied && Array.isArray(prior.applied.results) ? prior.applied.results.filter(r => r.ok).map(r => r.i) : []);
  const run = choice === "yes" ? (prior.proposal || []).map((p, i) => ({ ...p, i })).filter(p => !doneIdx.has(p.i)) : [];
  for (const p of run) if (!FLAG_ACTIONS.includes(p.action) || NEVER_ACTIONS.includes(p.action)) return { refused: `${p.action} can't be done from a flag. Nothing was changed.` };
  const status = choice === "dismiss" ? "dismissed" : choice === "done" ? "done" : run.length ? "applying" : "answered";
  const kept = prior.applied && Array.isArray(prior.applied.results) ? prior.applied.results.filter(r => doneIdx.has(r.i)) : [];
  return { id, answer, run, status, kept };
}
// After the run: results [{ i, action, ok, refused?, requestId }] for the changes tried
// (the run stops at the first one refused).
function finishAnswer(plan, results, nowIso) {
  if (!plan.run.length) return { status: plan.status, updatedAt: nowIso, answer: plan.answer, applied: null };
  const ok = results.length === plan.run.length && results.every(r => r.ok);
  const bad = results.find(r => !r.ok);
  const all = (plan.kept || []).concat(results.map(r => ({ i: r.i, action: r.action, ok: !!r.ok, requestId: r.requestId || "", why: line(r.refused || "", 200) }))).sort((a, b) => a.i - b.i);
  return { status: ok ? "applied" : "failed", updatedAt: nowIso, answer: plan.answer,
    applied: { ok, at: nowIso, results: all, why: bad ? line(bad.refused || "", 200) : "" } };
}

// ── The dashboard's read ─────────────────────────────────────────────────────
// viewer = live-PIN admin record. Only Koy's own record can answer; owners-only
// flags go to admins anyway (the callable is admin-only).
function buildWork({ routines, flags, viewer, nowIso }) {
  const isKoy = !!viewer && viewer.id === "koy";
  const now = Date.parse(nowIso);
  const rs = (routines || []).map(([id, d]) => ({ id, ...d })).filter(r => TRIG.test(r.id) && !r.removed)
    .map(r => {
      const last = Date.parse(r.lastRunAt || "");
      const next = Date.parse(r.nextAt || "");
      // "Missed": on, its next run time has passed by more than 2 hours, and nothing ran since.
      const missed = r.enabled && !r.archivedChannel && !isNaN(next) && now - next > 2 * 3600e3 && (isNaN(last) || last < next);
      const health = !r.enabled ? "off" : r.archivedChannel ? "paused" : r.lastStatus === "failed" ? "failed" : missed ? "missed" : r.lastRunAt ? "ok" : "new";
      return { id: r.id, name: r.name, when: r.when || "", enabled: !!r.enabled, health, about: r.about || "", onItsOwn: r.onItsOwn || [],
        channelName: r.channelName || "", lastRunAt: r.lastRunAt || "", lastStatus: r.lastStatus || "", lastNote: r.lastNote || "",
        lastFlagged: r.lastFlagged || 0, lastNothing: !!r.lastNothing, nextAt: r.nextAt || "", syncAt: r.syncAt || "", checkinAt: r.checkinAt || "" };
    })
    .sort((a, b) => (a.enabled === b.enabled ? a.name.localeCompare(b.name) : a.enabled ? -1 : 1));
  const fs = (flags || []).map(([id, d]) => ({ id, ...d })).filter(f => FLAG_ID.test(f.id))
    .map(f => ({ id: f.id, key: f.key, routine: f.routine, channel: f.channel || "", jobId: f.jobId || "", jobNo: f.jobNo || "", jobName: f.jobName || "",
      kind: f.kind || "other", kindLabel: KINDS[f.kind] || "Other", title: f.title, detail: f.detail || "", ask: f.ask || "yes_no", choices: f.choices || [],
      proposal: f.proposal || [], ownersOnly: !!f.ownersOnly, status: f.status, firstSeen: f.firstSeen || "", lastSeen: f.lastSeen || "",
      updatedAt: f.updatedAt || "", seen: f.seen || 1, answer: f.answer || null, applied: f.applied || null, reopenedWhy: f.reopenedWhy || "",
      daysOpen: Math.max(0, Math.floor((now - Date.parse(f.firstSeen || nowIso)) / 86400e3)) }));
  const open = fs.filter(f => f.status === "open" || f.status === "failed" || f.status === "applying").sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : 1));
  const closed = fs.filter(f => !open.includes(f) && now - Date.parse(f.updatedAt || nowIso) <= 14 * 86400e3).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1)).slice(0, 100);
  const syncAt = rs.reduce((m, r) => (r.syncAt > m ? r.syncAt : m), "");
  return { ok: true, canAnswer: isKoy, routines: rs, open, closed, syncAt };
}

module.exports = {
  ROUTINE_ACTIONS, FLAG_ACTIONS_API, FLAG_ACTIONS, NEVER_ACTIONS, STATUS, KINDS, ASKS, TRIG, FLAG_ID,
  flagId, scheduleText, denverOffsetHours, planSync, planCheckin, planFlags, planClose, listView, planAnswer, finishAnswer, buildWork, hasDollars,
};
