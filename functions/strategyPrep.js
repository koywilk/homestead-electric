// ─────────────────────────────────────────────────────────────
// Friday Strategy/Scheduling Meeting pre-fill — PURE module (no Firestore, no network).
//   buildModel(inputs) → plain model · renderLines(model) → [{kind,text,spans}] · parseNotesCarry(doc, now)
// Spec: docs/superpowers/specs/2026-10-15-friday-strategy-prep-design.md
// Accuracy rules (Koy, 2026-10-15: "it just needs to be 100 percent accurate"):
//   booked = Simpro schedules ∪ planner, NEVER job.foreman/lead · no live job silently dropped ·
//   conflicts shown, never merged · the retired *ScheduledDate and last-activity fields are never read.
// Layout (Koy, 2026-10-16, from his hand-edited TEST doc): see the comment above renderLines.
// ─────────────────────────────────────────────────────────────
"use strict";
const { docsRequests } = require("./foremanMeetingPrep.js");
const { applyPunchTicks } = require("./punchTicks.js");   // v559: punch check-off slots overlaid before reading `done`

const TZ = "America/Denver";
const NOTES_READ_HINT = "Couldn't read Josh's notes doc. Share it (Viewer) with homestead-electric@appspot.gserviceaccount.com to get carry-forward.";
const MARGIN_TARGET = 15;
const CAPS = { carried: 20, booked: 15, calendar: 12, blockedPerGroup: 10, coming: 15, findings: 6, rti: 10, movers: 5, qc: 10, approved: 12 };
const DAY_LBL = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const SPECIAL_JOB = /phase|temp power|temp p\b|t&m|ev charger|light change|whip|\bstc\b/i;   // entangled jobs: margin is fiction
const PREP_ITEMS = [["redlinePlans", "Redline Plans Up to Date"], ["cabinetPlans", "Cabinet Plans Received"], ["applianceSpecs", "Appliance Specs Received"], ["plansUploaded", "Plans Uploaded to App & SimPro"], ["readyToHandOff", "Ready to Hand Off to Foreman"]];
const WAIT_BUCKETS = [
  ["Inspection", /inspect|ahj|4.?way|final\b/i],
  ["Material", /deliver|fixture|material|light\b|chandelier|order|on site|onsite|not on s|bulb|shade|supply/i],
  ["GC / builder", /\bgc\b|builder|fram|drywall|paint|cabinet|counter|tile|scaffold|ceiling|drop|insulat|trim|shelv|baseboard|wallpaper|island|fur out|pocket door|measure/i],
  ["Homeowner / designer", /design|selection|spec\b|layout|decision|confirm|detail|location|height|homeowner|customer|client|owner/i],
  ["Other trades", /plumb|hvac|mechanical|sauna|utility|trade/i],
];

// ── dates / text ─────────────────────────────────────────────────────────────
// Every Date this module works with is Mountain WALL-CLOCK held in the process's local fields (weekOf does the same
// for "now"), so ymd()/getDate() read the MT day whether the process runs in UTC (Cloud Functions) or in MT (this Mac).
// An ABSOLUTE instant (ISO with a time, Firestore Timestamp, epoch ms) is converted to that wall-clock; a date-only
// string (YYYY-MM-DD, M/D/YY) is already a calendar day and stays as written (noon, so no shift can move it).
const mtWall = (d) => { if (isNaN(d.getTime())) return null; const w = new Date(d.toLocaleString("en-US", { timeZone: TZ })); return isNaN(w.getTime()) ? null : w; };
function toDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;   // already one of ours (wall-clock); never re-shifted
  if (typeof v === "object") {
    if (typeof v.toDate === "function") { try { const d = v.toDate(); return d instanceof Date ? mtWall(d) : null; } catch (e) { return null; } }
    if (typeof v.seconds === "number") return mtWall(new Date(v.seconds * 1000));
    if (typeof v._seconds === "number") return mtWall(new Date(v._seconds * 1000));
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (m && !/T\d/.test(s)) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{12,14}$/.test(s)) return mtWall(new Date(+s));
  if (!/\d/.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return /T\d|\d:\d\d/.test(s) ? mtWall(d) : d;   // a written time = an instant; a bare written day ("Oct 9, 2026") stays that day
}
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const fmtMD = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}` : "";
const firstKey = (name) => String(name || "").trim().toLowerCase().split(/\s+/)[0];   // display helper only — NOT identity
// Identity key: first name + last initial, so two people sharing a first name stay two people ("jacob n" vs "jacob s").
const personKey = (name) => { const t = String(name || "").trim().toLowerCase().split(/\s+/).filter(Boolean); return t.length > 1 ? `${t[0]} ${t[t.length - 1][0]}` : (t[0] || ""); };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])); }
function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
const fmtMoney = (v) => v >= 950 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10; }

// ── jobs ─────────────────────────────────────────────────────────────────────
const snOf = (j) => String((j && j.simproNo) || "").trim();
// Projects (spec 2026-10-15 §6.3): buildings sharing one Simpro # → only the lead answers for it.
const simproJoinable = (j) => !(j.projectGroupId && j.simproFolder) || !!j.simproLead;
// Who answers for each Simpro #: every joinable live job, then (Projects spec §6.3) when the lead has finished the first live
// project sibling — Site first, then name — so exactly one building answers per shared #.
function answeringBySn(live) {
  const m = new Map(); arr(live).forEach(j => { const sn = snOf(j); if (sn && simproJoinable(j)) m.set(sn, j); });
  arr(live).filter(j => j.projectGroupId && snOf(j) && !m.has(snOf(j)))
    .sort((a, b) => (b.projectRole === "site") - (a.projectRole === "site") || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .forEach(j => { const sn = snOf(j); if (!m.has(sn)) m.set(sn, j); });
  return m;
}
const effStatus = (j, phase) => { const st = j[phase + "Status"]; if (st) return st; const p = parseInt(j[phase + "Stage"]) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };
const pctOf = (j, phase) => parseInt(j[phase + "Stage"]) || 0;
const ACTIVE_ST = new Set(["inprogress", "scheduled", "date_confirmed"]);
const STARTED_ST = new Set(["inprogress", "complete", "invoice", "waiting"]);
// A phase's start date, by the app's own rule (src/App.js forecast, rough + finish): when the phase is scheduled
// or in progress the status date is the start (`<phase>StatusDate || <phase>ProjectedStart`); otherwise the
// projected start wins (`<phase>ProjectedStart || <phase>StatusDate`). Reads the raw status, as the app does.
function startDateOf(j, phase) {
  const st = j[phase + "Status"];
  const raw = (st === "scheduled" || st === "inprogress") ? (j[phase + "StatusDate"] || j[phase + "ProjectedStart"]) : (j[phase + "ProjectedStart"] || j[phase + "StatusDate"]);
  return toDateAny(raw);
}
const phasePending = (j, p) => !STARTED_ST.has(effStatus(j, p)) && pctOf(j, p) === 0;
const roughDone = (j) => ["complete", "invoice"].includes(effStatus(j, "rough"));
const startConfirmed = (j, p) => !!j[p + "StartConfirmed"] || ["scheduled", "date_confirmed"].includes(effStatus(j, p));
// The job's NEXT start: rough while rough has not started; finish once rough is done and finish has not started.
// A job whose rough never started and carries no rough date but does carry a finish date (a finish-only job) starts
// at that finish date. null while rough is under way (or both phases are past starting); date null = no date on file.
function nextStartOf(j) {
  let phase = phasePending(j, "rough") ? "rough" : (roughDone(j) && phasePending(j, "finish")) ? "finish" : null;
  if (!phase) return null;
  if (phase === "rough" && !startDateOf(j, "rough") && phasePending(j, "finish") && startDateOf(j, "finish")) phase = "finish";
  return { phase, date: startDateOf(j, phase), confirmed: startConfirmed(j, phase) };
}
const hasForeman = (j) => !!j.foreman && !/^unassigned$/i.test(String(j.foreman).trim());
const leadOf = (j) => { const l = String(j.lead || "").trim(); return l && !/unassigned|tbd/i.test(l) ? l : ""; };
const isDone = (j) => j.finishStatus === "complete" || j.finishStatus === "invoice" || parseInt(j.finishStage) === 100 ||
  (j.tempPed && j.tempPedStatus === "completed") || (j.quickJob && ["complete", "invoice"].includes(j.quickJobStatus));
// Names are trimmed here, once, so every row built from a live job shows "Cowdrey", never "Cowdrey ".
function liveJobs(jobs) {
  return arr(jobs).filter(j => j && j.name && String(j.name).trim() && String(j.name).trim() !== "Example Job" && j.type !== "quote" && !j.archived && !j.deleted && !j.archivedAt && !isDone(j))
    .map(j => String(j.name) === String(j.name).trim() ? j : { ...j, name: String(j.name).trim() });
}
function walkPunch(punch, cb) {
  if (!punch || typeof punch !== "object") return;
  const floors = ["upper", "main", "basement"].concat(arr(punch.extras).map(e => e && e.key).filter(Boolean));
  floors.forEach(fk => { const f = punch[fk]; if (!f || typeof f !== "object") return;
    arr(f.general).forEach(i => i && cb(i)); arr(f.hotcheck).forEach(i => i && cb(i)); arr(f.rooms).forEach(r => arr(r && r.items).forEach(i => i && cb(i))); });
}
function openPunchCount(j) { let n = 0; const jt = applyPunchTicks(j); ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(jt[k], i => { if (!i.done && !i.voided) n++; })); return n; }
function waitingItems(j) { const out = []; const jt = applyPunchTicks(j); ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(jt[k], i => { if (!i.done && !i.voided && i.waiting) out.push({ text: stripHtml(i.text), waitingOn: String(i.waitingOn || "").trim(), since: toDateAny(i.waitingSince || i.addedAtTs || i.addedAt) }); })); return out; }
function openQuestions(j) {
  const out = [];
  ["roughQuestions", "finishQuestions"].forEach(k => { const qs = j[k]; if (!qs || typeof qs !== "object") return;
    Object.values(qs).forEach(list => arr(list).forEach(q => { if (!q || q.done || q.deleted || String(q.answer || "").trim() || arr(q.answerPhotos).length) return;
      out.push({ text: stripHtml(q.question || q.text || ""), since: toDateAny(q.addedAt) || toDateAny(q.date) || toDateAny(q.id) }); })); });
  return out.filter(q => q.text);
}
function waitBucket(text) { const r = String(text || "").trim(); if (!r) return "no reason given"; for (const [label, re] of WAIT_BUCKETS) if (re.test(r)) return label; return "Other"; }
const waitReason = (w) => w.waitingOn || w.text;   // a waiting item with no "waiting on" text is bucketed by its own text
// A question is for the homeowner / designer unless its text NAMES another party (an object word like "cabinet"
// or "ceiling" is not a party). Several parties named → the one named first.
const QUESTION_PARTIES = [["GC / builder", /\bgc\b|builder|contractor|framer|drywall|painter|cabinet guy|tile guy/i], ["Other trades", /plumb|hvac|utility/i], ["Inspection", /inspect/i]];
function questionBucket(text) {
  const t = String(text || ""); let best = null, at = Infinity;
  QUESTION_PARTIES.forEach(([label, re]) => { const m = t.match(re); if (m && m.index < at) { at = m.index; best = label; } });
  return best || "Homeowner / designer";
}
function prepOf(j) {
  const c = j.prepChecklist || {}, na = j.prepNA || {};
  if (!j.prepChecklist && !j.prepNA) { const done = (j.prepStage || "") === "Job Prep Complete"; return { done: done ? 5 : 0, total: 5, missing: done ? [] : PREP_ITEMS.map(x => x[1]), legacy: true }; }
  const missing = PREP_ITEMS.filter(([k]) => !c[k] && !na[k]).map(x => x[1]);
  return { done: 5 - missing.length, total: 5, missing, legacy: false };
}

// ── calendar window ──────────────────────────────────────────────────────────
function weekOf(now) {
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const today = startOfDay(mtNow);
  const meeting = addDays(today, (5 - today.getDay() + 7) % 7);          // the Friday on/after today
  const nextMon = addDays(meeting, 3);
  const weekDays = [0, 1, 2, 3, 4].map(i => addDays(nextMon, i));
  return { mtNow, today, meeting, nextMon, weekDays, weekYmds: weekDays.map(ymd), DAY_LBL };
}
function daysLabel(dis) {
  if (dis.length === 5) return "all week";
  const runs = []; let s = dis[0], p = dis[0];
  for (let i = 1; i <= dis.length; i++) { const c = dis[i]; if (c === p + 1) { p = c; continue; } runs.push(s === p ? DAY_LBL[s] : `${DAY_LBL[s]}–${DAY_LBL[p]}`); s = p = c; }
  return runs.join(", ");
}

// ── schedule index: WHO is booked WHERE next week (Simpro ∪ planner) ────────
// Never reads job.foreman/lead. unknownSimpro keeps Simpro jobs the app has no record of.
// allJobs (optional): every job doc, so a Simpro booking on a job the app has already finished/archived names it.
function buildScheduleIndex(scheduleEntries, plannerDoc, live, weekYmds, allJobs) {
  const byJob = new Map(), byPerson = new Map(), unknown = new Map();
  const jobBySn = answeringBySn(live);
  const liveIds = new Set(live.map(j => j.id)), offBySn = new Map();
  arr(allJobs).forEach(j => { if (!j || j.deleted || j.type === "quote" || liveIds.has(j.id)) return; const sn = snOf(j); if (sn && simproJoinable(j) && !jobBySn.has(sn) && !offBySn.has(sn)) offBySn.set(sn, j); });
  const note = (job, di, person, source) => {
    if (!byJob.has(job.id)) byJob.set(job.id, { name: job.name, days: {} });
    const d = byJob.get(job.id).days; if (!d[di]) d[di] = { people: [], source, by: {} };
    const pk = personKey(person);
    if (!d[di].people.some(p => personKey(p) === pk)) d[di].people.push(person);
    if (d[di].source !== source) d[di].source = "both";
    d[di].by[pk] = (d[di].by[pk] && d[di].by[pk] !== source) ? "both" : source;
    const k = personKey(person); if (!byPerson.has(k)) byPerson.set(k, { name: person, days: {} });
    const pd = byPerson.get(k).days; if (!pd[di]) pd[di] = new Set(); pd[di].add(job.name);
  };
  arr(scheduleEntries).forEach(s => {
    if (!s || s.Type !== "job" || !s.Date) return;
    const di = weekYmds.indexOf(String(s.Date).slice(0, 10)); if (di < 0) return;
    const pid = String((s.Project && (s.Project.ProjectID || s.Project.ID)) || "").trim(); const nm = (s.Staff && s.Staff.Name) || "";
    if (!pid || !nm) return;
    const j = jobBySn.get(pid);
    if (j) { note(j, di, nm, "simpro"); return; }
    if (!unknown.has(pid)) { const off = offBySn.get(pid); unknown.set(pid, { pid, days: new Set(), people: [], appName: off ? String(off.name || "").trim() : "", appState: off ? (isDone(off) ? "finished in app" : "archived in app") : "" }); }
    const u = unknown.get(pid); u.days.add(di); if (!u.people.some(p => personKey(p) === personKey(nm))) u.people.push(nm);
  });
  const assignments = (plannerDoc && plannerDoc.assignments) || {};
  const liveById = new Map(live.map(j => [j.id, j]));
  Object.entries(assignments).forEach(([key, cell]) => {
    const parts = key.split("_"), di = Number(parts.pop()), jid = parts.join("_");
    const j = liveById.get(jid); if (!j || !(di >= 0 && di <= 4) || !cell) return;
    [cell.lead, ...arr(cell.crew)].filter(Boolean).forEach(p => note(j, di, p, "planner"));
  });
  return { byJob, byPerson, unknownSimpro: [...unknown.values()].map(u => ({ ...u, days: [...u.days].sort() })),
    simproOk: true, plannerPresent: !!(plannerDoc && Object.keys(assignments).length) };
}

// ── classification: every live job → exactly one bucket ─────────────────────
// booked · starts (inside next week; or OVERDUE = dated before next Monday, not started) · onHold · later (next start
// dated after next week: counted, printed under Coming up) · idle (in progress / scheduled with nobody booked) ·
// between (rough complete + no finish date, or nothing started + no date — the deliberate exemption).
const STATUS_LBL = { scheduled: "scheduled", date_confirmed: "start date set", waiting_date: "awaiting start date", inprogress: "in progress", waiting: "on hold" };
function classifySchedule(live, idx, weekYmds, today) {
  const out = { booked: [], idle: [], starts: [], onHold: [], between: [], later: [] };
  const inWindow = (d) => d && weekYmds.includes(ymd(d));
  const elsewhere = (j, di) => {
    const who = [["foreman", hasForeman(j) ? j.foreman : ""], ["lead", leadOf(j)]].filter(x => x[1]);
    return who.map(([role, name]) => { const p = idx.byPerson.get(personKey(name)); const there = p && p.days[di] ? [...p.days[di]].filter(n => n !== j.name) : [];
      return there.length ? `${role} ${name} is at ${there.join(" / ")} ${DAY_LBL[di]}` : ""; }).filter(Boolean);
  };
  live.forEach(j => {
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");
    const phase = ACTIVE_ST.has(fs) || fs === "waiting" || (rs === "complete" && fs) ? "finish" : "rough";
    const st = phase === "finish" ? fs : rs;
    const base = { jobId: j.id, name: j.name, phase, pct: pctOf(j, phase), foreman: hasForeman(j) ? j.foreman : "", lead: leadOf(j) };
    const b = idx.byJob.get(j.id);
    const bookedDays = b ? Object.keys(b.days).map(Number).sort() : [];
    // Dated start for a phase not yet started (start date by the app's rule; the retired scheduled-date field is dead).
    const startOf = (p) => { if (!phasePending(j, p)) return null; const d = startDateOf(j, p); return d ? { phase: p, date: d, confirmed: startConfirmed(j, p) } : null; };
    const ns = nextStartOf(j);
    // While rough is under way a finish start inside next week is still a start (rough wraps up, finish begins).
    const start = ns ? (ns.date ? { phase: ns.phase, date: ns.date, confirmed: ns.confirmed } : null) : (phasePending(j, "rough") ? null : startOf("finish"));
    if (bookedDays.length) {
      const seen = new Set(), people = []; bookedDays.forEach(di => b.days[di].people.forEach(p => { const k = personKey(p); if (!seen.has(k)) { seen.add(k); people.push(p); } }));
      out.booked.push({ ...base, firstDay: bookedDays[0], days: daysLabel(bookedDays), people, source: [...new Set(bookedDays.map(di => b.days[di].source))].join("+"), qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start && inWindow(start.date) ? { ...start } : null });
      return;
    }
    const startRow = (s0, extra) => { const missingRoles = [!hasForeman(j) ? "foreman" : "", !leadOf(j) ? "lead" : ""].filter(Boolean);
      return { ...base, phase: s0.phase, date: s0.date, di: -1, confirmed: s0.confirmed, crewBooked: false, missingRoles, prep: prepOf(j), elsewhere: [], atRisk: true, overdue: false, ...extra }; };
    const hard = ns && j[ns.phase + "NeedsHardDate"] && !ns.confirmed ? { hardDate: true, hardBy: toDateAny(j[ns.phase + "NeedsByStart"]) } : {};
    if (start && inWindow(start.date)) {
      const di = weekYmds.indexOf(ymd(start.date));
      const soon = daysBetween(start.date, today) <= 7;
      out.starts.push(startRow(start, { di, elsewhere: elsewhere(j, di), atRisk: soon || !!hard.hardDate, ...(start.phase === (ns && ns.phase) ? hard : {}) }));
      return;
    }
    // Not started and dated before next Monday: an overdue start (MISSING 0 must prove something).
    if (ns && ns.date && ymd(ns.date) < weekYmds[0]) { out.starts.push(startRow(ns, { overdue: true, daysLate: daysBetween(today, ns.date), ...hard })); return; }
    // A customer-committed hard date with nothing locked in (the Friday Packet's hard_date blocker) is an at-risk start.
    if (hard.hardDate) { out.starts.push(startRow(ns, hard)); return; }
    if (st === "waiting") { out.onHold.push({ ...base, since: toDateAny(j[phase + "StatusDate"]) }); return; }
    if (ns && ns.date && ymd(ns.date) > weekYmds[4]) { out.later.push({ ...base, phase: ns.phase, date: ns.date, confirmed: ns.confirmed }); return; }
    if (ACTIVE_ST.has(st) || (st === "" && pctOf(j, phase) > 0)) {
      const waits = waitingItems(j), qs = openQuestions(j);
      const byB = {}; waits.forEach(w => { const k = waitBucket(waitReason(w)); byB[k] = (byB[k] || 0) + 1; });
      const upd = [...arr(j.roughUpdates), ...arr(j.finishUpdates)].map(u => toDateAny(u && (u.date || u.createdAt))).filter(Boolean).sort((a, c) => c - a)[0] || toDateAny(j.statusUpdateAt);
      const rd = toDateAny(j.readyToInvoiceDate);
      // A phase that is scheduled / start-date-set but not in progress prints its status, not "0%".
      const pd = st !== "inprogress" && st !== "" ? startDateOf(j, phase) : null;
      const statusText = st !== "inprogress" && st !== "" ? `${phase} ${STATUS_LBL[st] || st}${pd ? ` ${fmtMD(pd)}${ymd(pd) < ymd(today) ? " (passed)" : ""}` : ", no date"}` : "";
      out.idle.push({ ...base, statusText, lastUpdate: upd || null, openPunch: openPunchCount(j), questions: qs.length, waitBuckets: Object.entries(byB).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k} ${n}`),
        rti: !!(j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent), rtiDays: j.readyToInvoice && rd ? Math.max(0, daysBetween(today, rd)) : null, qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start || null });
      return;
    }
    // Not printed; counted in the dry-run checks. kind says which exemption it is.
    out.between.push({ ...base, kind: roughDone(j) ? "between" : "notStarted", finishStart: ns && ns.date ? ns.date : null });
  });
  out.booked.sort((a, b) => a.firstDay - b.firstDay || a.name.localeCompare(b.name));
  out.starts.sort((a, b) => a.di - b.di || a.name.localeCompare(b.name));
  out.idle.sort((a, b) => (b.pct || 0) - (a.pct || 0) || a.name.localeCompare(b.name));
  out.later.sort((a, b) => a.date - b.date || a.name.localeCompare(b.name));
  return out;
}

// ── dates that moved since last Friday ───────────────────────────────────────
// Starts are keyed `<jobId>:roughStart` / `:finishStart` with the RESOLVED start (startDateOf), and only while that
// phase has not started (once it starts the key drops out quietly — a started phase is not a cleared date).
// Snapshots written before the resolver used `:roughProjectedStart` / `:finishProjectedStart`; normPrevDates reads those.
const START_KEYS = [["rough", "roughStart", "rough start"], ["finish", "finishStart", "finish start"]];
const DATE_FIELDS = [["roughStart", "rough start"], ["finishStart", "finish start"], ["fourWayTargetDate", "rough inspection"], ["finalInspectionTargetDate", "final inspection"], ["qcStatusDate", "rough QC walk"], ["finishQcStatusDate", "finish QC walk"], ["matterportStatusDate", "Matterport scan"]];
const rtKeyOf = (rt, i) => (rt && rt.id != null && String(rt.id) !== "") ? String(rt.id) : String(i);
function dateKeys(live) {
  const out = {};
  live.forEach(j => {
    START_KEYS.forEach(([p, f]) => { if (!phasePending(j, p)) return; const d = startDateOf(j, p); if (d) out[`${j.id}:${f}`] = ymd(d); });
    DATE_FIELDS.slice(2).forEach(([f]) => { const d = toDateAny(j[f]); if (d) out[`${j.id}:${f}`] = ymd(d); });
    // Return trips key on their id (index only when a trip has none), so deleting an earlier trip never shifts a key.
    arr(j.returnTrips).forEach((rt, i) => { if (!rt || rt.signedOff || rt.rtStatus === "complete") return; const d = toDateAny(rt.rtStatusDate); if (d) out[`${j.id}:rt:${rtKeyOf(rt, i)}`] = ymd(d); });
  });
  return out;
}
// Old start key names → new ones (a new-name entry, when present, wins).
function normPrevDates(prevDates) {
  if (!prevDates || typeof prevDates !== "object") return prevDates;
  const out = {};
  Object.keys(prevDates).forEach(k => { const m = k.match(/^(.*):(rough|finish)ProjectedStart$/); if (!m) { out[k] = prevDates[k]; return; } const nk = `${m[1]}:${m[2]}Start`; if (!(nk in prevDates)) out[nk] = prevDates[k]; });
  return out;
}
const rtOfKey = (j, id) => { const rts = arr(j.returnTrips); const byId = rts.find(rt => rt && rt.id != null && String(rt.id) === id); if (byId) return byId;
  const rt = /^\d+$/.test(id) ? rts[Number(id)] : null; return rt && (rt.id == null || String(rt.id) === "") ? rt : null; };   // an index key only names a trip that has no id
// Keys that had a date last Friday and have none now, on a job that is still live. A return trip that was
// completed/signed off (or removed) is not a cleared date, so rt keys only count while that trip is still open.
// A start whose phase has since started is not a cleared date either. A saved history list can hold junk
// (null, a number, an entry without a string v); skip those, never throw.
const cleanHist = (h) => arr(h).filter(e => e && typeof e === "object" && typeof e.v === "string");
function clearedKeys(live, prevDates, cur) {
  if (!prevDates || typeof prevDates !== "object") return [];
  const byId = new Map(live.map(j => [j.id, j])), out = [];
  Object.keys(prevDates).forEach(k => {
    if (k in cur) return;
    const parts = k.split(":"), j = byId.get(parts[0]); if (!j) return;
    const hist = cleanHist(prevDates[k]); if (!hist.length) return;
    if (parts[1] === "rt") { const rt = rtOfKey(j, parts.slice(2).join(":")); if (!rt || rt.signedOff || rt.rtStatus === "complete") return; }
    const sk = START_KEYS.find(x => x[1] === parts[1]); if (sk && !phasePending(j, sk[0])) return;
    out.push({ k, j, hist });
  });
  return out;
}
const labelOfKey = (k) => { const f = k.split(":")[1]; if (f === "rt") return "return trip"; const e = DATE_FIELDS.find(x => x[0] === f); return e ? e[1] : f; };
const mdOfYmd = (s) => { const d = toDateAny(s); return d ? fmtMD(d) : s; };
const nthOf = (hist, v) => new Set([...hist.map(h => h.v), v].filter(Boolean)).size;   // distinct real dates; "" (no date) is not a date
// prevDates: { key: [{d: runYmd, v: valueYmd}, ...] } (kept newest-last, cap 6). nth = how many distinct values seen incl. this one.
function movedDates(live, prevDatesRaw, today) {
  const firstRun = !prevDatesRaw || typeof prevDatesRaw !== "object";
  const prevDates = normPrevDates(prevDatesRaw);
  const cur = dateKeys(live), nameOf = new Map(live.map(j => [j.id, j]));
  const rows = [], passed = [];
  Object.entries(cur).forEach(([k, v]) => {
    const j = nameOf.get(k.split(":")[0]); if (!j) return;
    const hist = firstRun ? [] : cleanHist(prevDates[k]);
    const last = hist.length ? hist[hist.length - 1].v : null;
    if (last === "") rows.push({ name: j.name, label: labelOfKey(k), from: "no date", to: mdOfYmd(v), nth: nthOf(hist, v) });   // cleared last time, dated again now
    else if (last && last !== v) rows.push({ name: j.name, label: labelOfKey(k), from: mdOfYmd(last), to: mdOfYmd(v), nth: nthOf(hist, v) });
  });
  // A date that was there last Friday and is gone now (job still live) is a move to "no date".
  clearedKeys(live, firstRun ? null : prevDates, cur).forEach(({ k, j, hist }) => {
    const last = hist[hist.length - 1].v; if (!last) return;
    rows.push({ name: j.name, label: labelOfKey(k), from: mdOfYmd(last), to: "no date", nth: nthOf(hist, "") });
  });
  // Date passed: a start/inspection/QC date before today whose status never moved.
  live.forEach(j => {
    const chkD = (d, kind, label, stillPending) => { if (d && ymd(d) < ymd(today) && stillPending) passed.push({ jobId: j.id, name: j.name, kind, label, date: fmtMD(d), days: daysBetween(today, d) }); };
    const chk = (f, kind, label, stillPending) => chkD(toDateAny(j[f]), kind, label, stillPending);
    chkD(startDateOf(j, "rough"), "start", "rough start", phasePending(j, "rough"));
    chkD(startDateOf(j, "finish"), "start", "finish start", roughDone(j) && phasePending(j, "finish"));
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");   // same phase guards as calendarRows
    chk("fourWayTargetDate", "inspection", "rough inspection", rs !== "complete" && !STARTED_ST.has(fs) && !j.roughInspectionResult && !arr(j.roughInspectionAttempts).length);
    chk("finalInspectionTargetDate", "inspection", "final inspection", (STARTED_ST.has(fs) || pctOf(j, "finish") > 0) && fs !== "complete" && !j.finalInspectionResult && !arr(j.finalInspectionAttempts).length);
    chk("qcStatusDate", "qc", "rough QC walk", j.qcStatus === "scheduled");
    chk("finishQcStatusDate", "qc", "finish QC walk", j.finishQcStatus === "scheduled");
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, passed, firstRun };
}
// Next state for the snapshot: append today's value when it differs from the last one.
function nextDates(live, prevDatesRaw, todayYmd) {
  const prevDates = normPrevDates(prevDatesRaw);
  const cur = dateKeys(live), out = {};
  Object.entries(cur).forEach(([k, v]) => { const hist = cleanHist(prevDates && prevDates[k]).slice(-5); if (!hist.length || hist[hist.length - 1].v !== v) hist.push({ d: todayYmd, v }); out[k] = hist.slice(-6); });
  // Cleared dates get a "" entry once, so next week last === current-absent and no row repeats. Done jobs drop out.
  clearedKeys(live, prevDates, cur).forEach(({ k, hist }) => { const h = hist.slice(); if (h[h.length - 1].v !== "") h.push({ d: todayYmd, v: "" }); out[k] = h.slice(-6); });
  return out;
}

// ── on the calendar next week ────────────────────────────────────────────────
const normName = (n) => String(n || "").toLowerCase().replace(/^#?\d{3,5}\s*-?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
function calendarRows(live, calendarEvents, weekYmds) {
  const rows = [];
  const add = (j, raw, label, who, ambiguous) => { const d = toDateAny(raw); if (!d) return; const di = weekYmds.indexOf(ymd(d)); if (di >= 0) rows.push({ di, label, name: j.name, who: who || "", ambiguous: !!ambiguous }); };
  live.forEach(j => {
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");
    const lastAttempt = (l) => arr(l).map(a => toDateAny(a && a.date)).filter(Boolean).sort((a, b) => b - a)[0] || null;
    const insp = (target, result, attempts, label) => { const at = toDateAny(target); if (!at || result) return; const la = lastAttempt(attempts); if (la && ymd(la) >= ymd(at)) return; add(j, target, label); };
    if (rs !== "complete" && !STARTED_ST.has(fs)) insp(j.fourWayTargetDate, j.roughInspectionResult, j.roughInspectionAttempts, "Rough inspection");
    if (STARTED_ST.has(fs) || pctOf(j, "finish") > 0) insp(j.finalInspectionTargetDate, j.finalInspectionResult, j.finalInspectionAttempts, "Final inspection");
    if (j.qcStatus === "scheduled") add(j, j.qcStatusDate, "Rough QC walk");
    if (j.finishQcStatus === "scheduled") add(j, j.finishQcStatusDate, "Finish QC walk");
    const scanned = arr(j.matterportLinks).length || j.matterportLink;
    if (j.matterportStatus === "scheduled" && !scanned) add(j, j.matterportStatusDate, "Matterport scan");
    arr(j.returnTrips).forEach(rt => { if (rt && !rt.signedOff && rt.rtStatus === "scheduled") add(j, rt.rtStatusDate, "Return trip", String(rt.assignedTo || "").trim()); });
  });
  // Koy's calendar: an event whose title carries a live job's name is a site walk/meeting for it.
  // Keys per job: the first word when it is a real name (5+ letters, not a number — "miller"), plus the
  // first two words ("lot 23"), matched as whole words so "Miller site walk" hits Miller Residence - Alpine.
  const names = live.map(j => { const n = normName(j.name).split(" ").filter(Boolean); const keys = [];
    if (n[0] && n[0].length >= 5 && !/^\d+$/.test(n[0])) keys.push(n[0]); if (n.length >= 2) keys.push(n.slice(0, 2).join(" ")); return { j, keys }; }).filter(x => x.keys.length);
  arr(calendarEvents).forEach(ev => {
    if (!ev || !ev.start || ev.status === "cancelled") return;
    // day = the date part as written (local to the event), never the UTC-shifted instant
    const rawDT = ev.start.dateTime; const raw = typeof rawDT === "string" && rawDT ? rawDT.slice(0, 10) : (rawDT || ev.start.date); const d = toDateAny(raw);
    if (!d) return;
    const title = normName(ev.summary);
    const hits = names.filter(x => x.keys.some(k => new RegExp(`(^| )${k}( |$)`).test(title))); if (!hits.length) return;
    const who = arr(ev.attendees).map(a => String((a && a.email) || "").split("@")[0]).filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
    hits.forEach(hit => add(hit.j, raw, /walk/i.test(ev.summary) ? "Site walk" : "Meeting", who, hits.length > 1));   // several jobs match → one row each, marked ambiguous
  });
  return rows.sort((a, b) => a.di - b.di || a.label.localeCompare(b.label));
}

// ── people: out, pending, bodies, new, capacity ──────────────────────────────
const isRoster = (u) => !!u && u.active !== false && ["foreman", "jrforeman", "lead", "crew"].includes(u.title || u.role || "");
function overlapDays(startRaw, endRaw, weekDays) {
  const s = toDateAny(startRaw), e = toDateAny(endRaw || startRaw); if (!s || !e) return [];
  return weekDays.map((d, i) => (ymd(d) >= ymd(s) && ymd(d) <= ymd(e)) ? i : -1).filter(i => i >= 0);
}
function peopleRows({ users, pto, timeOffRequests, needs, prevUserIds, idx, weekDays, today }) {
  const out = arr(pto).map(p => ({ name: p.name, dis: overlapDays(p.start, p.end, weekDays), note: clip(p.note, 40) })).filter(p => p.dis.length).map(p => ({ name: p.name, range: daysLabel(p.dis), dis: p.dis, note: p.note }));
  const pending = arr(timeOffRequests).filter(r => r && r.status === "pending").map(r => { const s = toDateAny(r.start), e = toDateAny(r.end || r.start), q = toDateAny(r.requestedAt);
    return { name: r.name, range: s ? `${fmtShort(s)}${e && ymd(e) !== ymd(s) ? `–${fmtShort(e)}` : ""}` : "", requestedDays: q ? daysBetween(today, q) : null }; });
  const bodies = arr(needs).filter(n => n && n.kind === "bodies" && n.status !== "done" && !n.voided).map(n => ({ text: clip(stripHtml(n.text || `${n.count || "some"} bodies`), 120), job: n.jobName || "", by: String(n.createdBy || "").trim(), ageDays: toDateAny(n.createdAt) ? daysBetween(today, toDateAny(n.createdAt)) : null }));
  const prev = new Set(arr(prevUserIds));
  const newUsers = !arr(prevUserIds).length ? [] : arr(users).filter(u => u && u.active !== false && !prev.has(u.id || u.name)).map(u => ({ name: u.name, title: u.title || u.role || "" }));
  const roster = arr(users).filter(isRoster);
  const capacity = weekDays.map((d, di) => {
    const outToday = new Set(out.filter(o => o.dis.includes(di)).map(o => personKey(o.name)));
    const available = roster.filter(u => !outToday.has(personKey(u.name))).length;
    let booked = 0; idx.byPerson.forEach(p => { if (p.days[di]) booked++; });
    return { di, booked, available, thin: available > 0 ? booked / available < 0.7 : false };
  });
  return { out, pending, bodies, newUsers, capacity };
}

// ── conflicts ────────────────────────────────────────────────────────────────
function conflictRows(idx, pto, weekYmds) {
  const rows = [];
  idx.byPerson.forEach(p => Object.entries(p.days).forEach(([di, jobsSet]) => { if (jobsSet.size > 1) rows.push(`${p.name} is on two jobs ${DAY_LBL[di]}: ${[...jobsSet].join(" and ")}`); }));
  const weekDays = weekYmds.map(s => toDateAny(s));
  arr(pto).forEach(o => { const dis = overlapDays(o.start, o.end, weekDays); const p = idx.byPerson.get(personKey(o.name)); if (!p) return;
    dis.forEach(di => { if (p.days[di]) rows.push(`${o.name} is booked ${DAY_LBL[di]} (${[...p.days[di]].join(", ")}) but out that day${o.note ? ` — ${o.note}` : ""}`); }); });
  // Planner vs Simpro, per person: a planner-only person on a day Simpro staffs, or a whole day only the planner has.
  idx.byJob.forEach((b, jobId) => Object.entries(b.days).forEach(([di, day]) => {
    const jobName = b.name || jobId;
    if (day.source === "planner") { rows.push(`planner has ${day.people.join(", ")} on ${jobName} ${DAY_LBL[di]} but Simpro has nothing there that day`); return; }
    day.people.forEach(name => { if (day.by && day.by[personKey(name)] === "planner") rows.push(`planner has ${name} on ${jobName} ${DAY_LBL[di]} but Simpro does not list them`); });
  }));
  return rows;
}

// ── blocked: one line per job, grouped by who we wait on ────────────────────
const GROUP_ORDER = ["GC / builder", "Homeowner / designer", "Material", "Inspection", "Other trades", "On hold", "Us (office owes the field)", "Sold work not on the calendar", "Other", "no reason given"];
const OFFICE_NAMES = /^(koy|josh|jeromy|justin|brady)\b/i;
const HEAD_GROUP = { "GC / builder": "GC / builder", "Homeowner / designer": "homeowner / designer", Material: "material", Inspection: "inspection", "Other trades": "other trades",
  "On hold": "on hold", "Us (office owes the field)": "on us", "Sold work not on the calendar": "sold work not dated", Other: "other", "no reason given": "no reason given" };   // headline line 2 labels
// The app's coIsConverted (src/App.js): converted when its status says so, or a return trip was made from it
// (rt.fromCOId === co.id) and the convert was not undone. COs carry no scheduled date: a CO is "dated" when it
// has a needsByStart, or a linked return trip has an rtStatusDate.
const coIsConverted = (co, rts) => !!co && (String(co.coStatus || "").toLowerCase() === "converted" ||
  (!co.convertUndoneAt && co.id != null && arr(rts).some(rt => rt && rt.fromCOId === co.id)));
const coOpenApproved = (co, rts) => !!co && String(co.coStatus || "").toLowerCase() === "approved" && !coIsConverted(co, rts);
const coDated = (co, rts) => !!co && (!!String(co.needsByStart || "").trim() || (co.id != null && arr(rts).some(rt => rt && rt.fromCOId === co.id && toDateAny(rt.rtStatusDate))));
function blockedRows({ live, needs, users, prevBlockerKeys, today, now }) {
  const firstRun = !Array.isArray(prevBlockerKeys);
  const prev = new Set(firstRun ? [] : prevBlockerKeys);
  const age = (d) => d ? Math.max(0, daysBetween(today, d)) : null;
  const oldest = (dates) => { const ds = dates.filter(Boolean).sort((a, b) => a - b); return ds.length ? ds[0] : null; };
  const perJob = new Map(); // jobId → [{group, what, who, since, n, jobName}]  (n = how many underlying items this entry stands for)
  const push = (j, group, what, since, who, n) => { if (!perJob.has(j.id)) perJob.set(j.id, []); perJob.get(j.id).push({ group, what, since: since || null, who: who || "", n: n || 1, jobName: j.name }); };
  live.forEach(j => {
    const waits = waitingItems(j), qs = openQuestions(j);
    const byBucket = {};
    waits.forEach(w => { const b = waitBucket(waitReason(w)); (byBucket[b] = byBucket[b] || []).push(w); });
    Object.entries(byBucket).forEach(([b, list]) => { const seen = new Set(), texts = [];
      list.forEach(w => { const t = clip(waitReason(w), 40), k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); texts.push(t); } });   // same text twice reads once
      push(j, b, `${plural(list.length, "waiting-on item")}${texts.length ? ` — ${texts.slice(0, 2).join(", ")}` : ""}`, oldest(list.map(w => w.since)), "", list.length); });
    // Each question buckets by its own text; one entry per bucket with its own count.
    const qByB = {}; qs.forEach(q => { const b = questionBucket(q.text); (qByB[b] = qByB[b] || []).push(q); });
    Object.entries(qByB).forEach(([b, list]) => { const since = oldest(list.map(q => q.since)); push(j, b, `${plural(list.length, "question")} unanswered${since ? ` since ${fmtMD(since)}` : ""}`, since, "", list.length); });
    [["rough", "Rough"], ["finish", "Finish"]].forEach(([p, L]) => { if (effStatus(j, p) === "waiting") push(j, "On hold", `${L} on hold`, toDateAny(j[p + "StatusDate"])); });
    if (j.flagged) push(j, "Us (office owes the field)", `flagged${j.flagNote ? ` — ${clip(stripHtml(j.flagNote), 60)}` : ""}`, toDateAny(j.flaggedAt));
    const cos = arr(j.changeOrders).filter(co => coOpenApproved(co, j.returnTrips));
    if (cos.length) { const needBy = oldest(cos.map(c => toDateAny(c.needsByStart)));
      push(j, "Sold work not on the calendar", `${plural(cos.length, "approved CO")}, not done${needBy ? ` · needed by ${fmtMD(needBy)}` : ""}`, oldest(cos.map(c => toDateAny(c.createdAt) || toDateAny(c.id))), "", cos.length); }
    const rts = arr(j.returnTrips).filter(rt => rt && !rt.signedOff && rt.rtStatus === "needs" && !toDateAny(rt.rtStatusDate) && !toDateAny(rt.scheduledDate));
    if (rts.length) push(j, "Sold work not on the calendar", `${plural(rts.length, "return trip")} with no date${rts[0].scope ? ` — ${clip(stripHtml(rts[0].scope), 40)}` : ""}`, oldest(rts.map(r => toDateAny(r.createdAt) || toDateAny(r.date))), "", rts.length);
  });
  const liveById = new Map(live.map(j => [j.id, j]));
  // Office = the named office people plus whoever holds the resi.head hat.
  const heads = arr(users).filter(u => u && u.active !== false && u.caps && u.caps["resi.head"]).map(u => String(u.name || "").trim()).filter(Boolean);
  const isOffice = (name) => { const n = String(name || "").trim(); if (!n) return false; if (OFFICE_NAMES.test(n)) return true;
    return heads.some(h => personKey(h) === personKey(n) || (!/\s/.test(n) && firstKey(h) === n.toLowerCase())); };
  const nowWall = now instanceof Date ? now : today;
  // Us = the field asked the office and the office has not answered in 5+ days. Requester = assignedBy || createdBy and
  // must be a field person; the assignee (assignedTo, else the legacy coordinator) must be office and not the requester.
  // Self-made office to-dos, time-off docs and snoozed needs are never blocks.
  arr(needs).forEach(n => {
    if (!n || n.status === "done" || n.voided || n.kind === "bodies" || n.timeoffId) return;
    const requester = String(n.assignedBy || n.createdBy || "").trim(), assignee = String(n.assignedTo || n.coordinator || "").trim();
    if (!requester || isOffice(requester) || !isOffice(assignee) || personKey(assignee) === personKey(requester)) return;
    const sn = toDateAny(n.snoozedUntil); if (sn && sn > nowWall) return;
    const c = toDateAny(n.createdAt); if (!c || daysBetween(today, c) < 5) return;
    const j = liveById.get(n.jobId) || live.find(x => x.name === String(n.jobName || "").trim());
    const target = j || { id: `need_${n.id}`, name: String(n.jobName || "").trim() || "(no job)" };
    push(target, "Us (office owes the field)", `${clip(stripHtml(n.text), 70)} (${requester.split(" ")[0]})`, c, assignee.split(" ")[0], 1);
  });
  // One line per job per audience: among the "waiting on someone else" groups the group with the largest
  // summed item count (each entry's n = underlying waiting items / questions) wins; ties → GROUP_ORDER. "On hold",
  // "Us" and "Sold work" are their own audiences and additive — a job can sit in one waiting group AND under
  // On hold AND Us AND Sold work, never twice within the waiting groups.
  const US = "Us (office owes the field)", SOLD = "Sold work not on the calendar", HOLD = "On hold";
  const groups = new Map(GROUP_ORDER.map(g => [g, []])), keys = [], byGroup = {};
  perJob.forEach((items, jobId) => {
    const jobName = items[0].jobName || jobId;
    const sold = items.filter(i => i.group === SOLD), us = items.filter(i => i.group === US), hold = items.filter(i => i.group === HOLD), rest = items.filter(i => i.group !== SOLD && i.group !== US && i.group !== HOLD);
    const emit = (list, groupName) => {
      if (!list.length) return;
      const sinceAll = oldest(list.map(i => i.since));
      const what = list.map(i => i.what).join(" · ");
      groups.get(groupName).push({ jobId, name: jobName, what: clip(what, 140), who: list.map(i => i.who).filter(Boolean)[0] || "", ageDays: age(sinceAll), more: Math.max(0, list.length - 2), _since: sinceAll ? sinceAll.getTime() : Infinity });
      keys.push(`${jobId}:${groupName}`); byGroup[groupName] = (byGroup[groupName] || 0) + 1;
    };
    if (rest.length) {
      const count = {}; rest.forEach(i => { count[i.group] = (count[i.group] || 0) + i.n; });
      const winner = Object.keys(count).sort((a, b) => count[b] - count[a] || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b))[0];
      emit(rest, winner);
    }
    emit(hold, HOLD);
    emit(us, US);
    emit(sold, SOLD);
  });
  const outGroups = [];
  groups.forEach((rows, name) => { if (!rows.length) return; rows.sort((a, b) => a._since - b._since || a.name.localeCompare(b.name)); rows.forEach(r => delete r._since);
    outGroups.push({ name, rows: rows.slice(0, CAPS.blockedPerGroup), more: Math.max(0, rows.length - CAPS.blockedPerGroup) }); });
  // Cleared = a job still live that had a blocker last Friday and has none now. Listed once, under its first previous
  // group in GROUP_ORDER. Jobs that left `live` (finished/archived) belong in Last week; synthetic need_ rows never clear.
  const nowJobs = new Set(keys.map(k => k.slice(0, k.indexOf(":"))));
  const prevGroups = new Map();
  prev.forEach(k => { const i = k.indexOf(":"); if (i < 0) return; const jobId = k.slice(0, i), group = k.slice(i + 1);
    if (jobId.startsWith("need_") || nowJobs.has(jobId) || !liveById.has(jobId)) return;
    if (!prevGroups.has(jobId)) prevGroups.set(jobId, []); prevGroups.get(jobId).push(group); });
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };
  const cleared = [...prevGroups].map(([jobId, gs]) => ({ name: liveById.get(jobId).name, group: gs.sort((x, y) => rank(x) - rank(y))[0] }));
  return { groups: outGroups, cleared, keys, total: keys.length, jobs: new Set(keys.map(k => k.split(":")[0])).size, byGroup, firstRun };
}

// ── coming up ────────────────────────────────────────────────────────────────
const mondayOf = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return startOfDay(m); };
function comingRows({ live, upcoming, agentFindings, weekYmds, today, cls }) {
  const liveNames = new Set(live.map(j => normName(j.name)));
  const after = weekYmds[4];
  const rows = [];
  arr(upcoming).forEach(u => { if (!u || !(u.name || "").trim() || liveNames.has(normName(u.name))) return;
    const d = toDateAny(u.projectedStart); const fu = toDateAny(u.lastFollowUp);
    rows.push({ upcoming: true, upId: u.id || "", name: String(u.name).trim(), customer: u.customer || "", date: d, confirmed: !!u.startConfirmed, note: clip(stripHtml(u.notes), 60), followUpDays: fu ? daysBetween(today, fu) : null, sales: u.sales || "" }); });
  // Live jobs whose NEXT start (resolved by the app's rule) is after next week — the same set classifySchedule counts as `later`.
  live.forEach(j => { const s = nextStartOf(j); if (s && s.date && ymd(s.date) > after) rows.push({ name: j.name, customer: j.customer || "", date: s.date, confirmed: s.confirmed, note: `${s.phase} start`, followUpDays: null, sales: "" }); });
  const dated = rows.filter(r => r.date && ymd(r.date) > after).sort((a, b) => a.date - b.date);
  const weeks = []; dated.forEach(r => { const wk = ymd(mondayOf(r.date)); let w = weeks.find(x => x.ymd === wk); if (!w) { w = { ymd: wk, label: `Week of ${fmtMD(toDateAny(wk))}`, rows: [] }; weeks.push(w); } w.rows.push(r); });
  const noDate = rows.filter(r => !r.date);
  // Upcoming (not-yet-live) rows dated inside next week belong in §4.3 Starts; ones dated before next Monday are overdue follow-ups.
  const upRows = rows.filter(r => r.upcoming && r.date);
  const startsNextWeek = upRows.filter(r => weekYmds.includes(ymd(r.date)));
  const overdue = upRows.filter(r => ymd(r.date) < weekYmds[0]).map(r => ({ name: r.name, customer: r.customer, date: r.date, confirmed: r.confirmed }));
  // In prep: a start AFTER next week (next week's starts are already in §4.3) but inside 21 days, phase not started.
  const prep = live.filter(j => { const s = nextStartOf(j); return s && s.date && ymd(s.date) > after && daysBetween(s.date, today) <= 21; }).map(j => { const p = prepOf(j); return { name: j.name, done: p.done, missing: p.missing }; });
  const cutoff = addDays(today, -7);
  const findings = arr(agentFindings).filter(f => f && toDateAny(f.createdAt) && toDateAny(f.createdAt) >= cutoff).sort((a, b) => toDateAny(b.createdAt) - toDateAny(a.createdAt)).slice(0, CAPS.findings).map(f => ({ type: f.type, summary: clip(stripHtml(f.summary), 90) }));
  const freeing = live.filter(j => (effStatus(j, "finish") === "inprogress" && pctOf(j, "finish") >= 90) || isRti(j)).map(j => ({ name: j.name, foreman: hasForeman(j) ? j.foreman : "" }));
  const twoWeeks = ymd(addDays(today, 14));
  const startsSoon = cls.starts.filter(r => !r.overdue && r.di >= 0).length + startsNextWeek.length + dated.filter(r => ymd(r.date) <= twoWeeks).length;
  const laterCount = weeks.slice(6).reduce((n, wk) => n + wk.rows.length, 0);   // starts in the weeks past the six printed
  return { error: false, weeks: weeks.slice(0, 6), laterCount, noDate, prep, findings, freeing, startsSoon, startsNextWeek, overdue, quotes: null };
}

// ── money (the Friday Packet's engine, moved) ────────────────────────────────
const isFinishingOpen = (j) => { const fs = effStatus(j, "finish"); return ((pctOf(j, "finish") > 0) || fs === "inprogress") && fs !== "complete" && fs !== "invoice" && !j.readyToInvoice && !j.invoiceSent && !SPECIAL_JOB.test(String(j.name || "")); };
const isRti = (j) => !!j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent;
function collectSimproCandidates(jobs, cap = 50) {
  const live = liveJobs(jobs); const out = [], seen = new Set();
  [...live.filter(isRti), ...live.filter(isFinishingOpen)].forEach(j => { const sn = snOf(j); if (!sn || seen.has(sn) || out.length >= cap) return; seen.add(sn); out.push(sn); });
  return out;
}
function moneyRows({ live, simproTotalsById, prevMargin, today }) {
  // One building per shared Simpro # (the same answer the schedule index uses); jobs without a project or a # are untouched.
  const answering = answeringBySn(live);
  const counts = (j) => !j.projectGroupId || !snOf(j) || answering.get(snOf(j)) === j;
  const totalsOf = (j) => (simproTotalsById || {})[snOf(j)] || null;
  const marginOf = (j) => { const t = totalsOf(j); if (t && typeof t.margin === "number") return Math.round(t.margin * 10) / 10; return (typeof j.simproMargin === "number" && isFinite(j.simproMargin)) ? Math.round(j.simproMargin * 10) / 10 : null; };
  const rti = live.filter(j => isRti(j) && counts(j)).map(j => { const t = totalsOf(j), rd = toDateAny(j.readyToInvoiceDate), m = marginOf(j);
    return { name: j.name, foreman: hasForeman(j) ? j.foreman : "", dollars: t && typeof t.total === "number" ? t.total : null, idleDays: rd ? Math.max(0, daysBetween(today, rd)) : null, margin: m, flag: m == null ? "" : m < 0 ? "negative margin, check Simpro costs" : m < MARGIN_TARGET ? `${Math.round((MARGIN_TARGET - m) * 10) / 10} pts under` : "" }; })
    .sort((a, b) => (b.dollars || 0) - (a.dollars || 0) || (b.idleDays || 0) - (a.idleDays || 0));
  const known = rti.filter(r => r.dollars != null);
  const finishing = live.filter(j => isFinishingOpen(j) && counts(j));
  const rows = finishing.map(j => ({ jobId: j.id, name: j.name, margin: marginOf(j), stage: `finish ${pctOf(j, "finish")}%` })).filter(r => r.margin != null).sort((a, b) => a.margin - b.margin);
  const firstRun = !prevMargin || typeof prevMargin !== "object";
  const movers = firstRun ? [] : rows.filter(r => typeof prevMargin[r.jobId] === "number" && Math.abs(r.margin - prevMargin[r.jobId]) >= 3).map(r => ({ name: r.name, from: prevMargin[r.jobId], to: r.margin, delta: Math.round((r.margin - prevMargin[r.jobId]) * 10) / 10 })).sort((a, b) => a.delta - b.delta).slice(0, CAPS.movers);
  const mon = ymd(mondayOf(today)), tdy = ymd(today);   // Monday..today: the same window Last week counts approvals in
  const approved = []; live.forEach(j => arr(j.changeOrders).forEach(co => { if (!co || String(co.coStatus).toLowerCase() !== "approved") return; const d = toDateAny(co.coStatusSyncedAt) || toDateAny(co.coStatusDate); if (!d || ymd(d) < mon || ymd(d) > tdy) return; approved.push({ name: j.name, quote: String(co.quoteNumber || "").trim(), desc: clip(stripHtml(co.desc || co.task), 50), dated: coDated(co, j.returnTrips) }); }));
  const marginByJob = {}; rows.forEach(r => { marginByJob[r.jobId] = r.margin; });
  return { error: false, rti: { rows: rti.slice(0, CAPS.rti), more: Math.max(0, rti.length - CAPS.rti), count: rti.length, total: known.reduce((s, r) => s + r.dollars, 0), knownCount: known.length },
    margin: { median: median(rows.map(r => r.margin)), count: rows.length, finishingCount: finishing.length, underCount: rows.filter(r => r.margin < MARGIN_TARGET).length, rows: rows.slice(0, 15), movers, firstRun },
    approved: { rows: approved.slice(0, CAPS.approved), count: approved.length, undated: approved.filter(a => !a.dated).length }, marginByJob };
}

// ── QC to schedule ───────────────────────────────────────────────────────────
function qcRows({ live, today }) {
  const weekAgo = addDays(today, -7);
  const QC_DONE = ["completed", "pass", "passed_items", "fixed", "scheduled"], QC_FAIL = ["fail", "failed"];
  const WHY_RANK = { "QC needs": 0, "QC failed, re-walk after fixes": 1, "final passed, no QC yet": 2 };
  const rows = live.map(j => {
    const sts = [j.finishQcStatus, j.qcStatus].map(x => String(x || "").toLowerCase());
    const needs = j.qcStatus === "needs" || j.finishQcStatus === "needs";
    const noQc = !j.qcStatus && !j.finishQcStatus;
    const high = effStatus(j, "finish") === "inprogress" && pctOf(j, "finish") >= 90;
    const recentPass = arr(j.finalInspectionAttempts).some(a => a && a.result === "pass" && toDateAny(a.date) && toDateAny(a.date) >= weekAgo);
    const failed = recentPass && sts.some(x => QC_FAIL.includes(x));
    const passedFinal = recentPass && !sts.some(x => QC_DONE.includes(x)) && !failed;
    if (!needs && !failed && !(noQc && high) && !passedFinal) return null;
    const open = openPunchCount(j);
    const since = toDateAny(j.finishQcStatus === "needs" ? j.finishQcStatusDate : j.qcStatusDate);
    const why = needs ? "QC needs" : failed ? "QC failed, re-walk after fixes" : passedFinal ? "final passed, no QC yet" : `finish ${pctOf(j, "finish")}%, no QC status`;
    return { name: j.name, foreman: hasForeman(j) ? j.foreman : "", why, since: since ? fmtMD(since) : "", openPunch: open, small: open <= 3 };
  }).filter(Boolean).sort((a, b) => (WHY_RANK[a.why] != null ? WHY_RANK[a.why] : 3) - (WHY_RANK[b.why] != null ? WHY_RANK[b.why] : 3) || a.name.localeCompare(b.name));
  return { error: false, rows: rows.slice(0, CAPS.qc), more: Math.max(0, rows.length - CAPS.qc) };
}

// ── last week ────────────────────────────────────────────────────────────────
function lastWeekRows({ jobs, live, users, prevState, blocked, today }) {
  const mon = mondayOf(today), inWin = (raw) => { const d = toDateAny(raw); return d && ymd(d) >= ymd(mon) && ymd(d) <= ymd(today); };
  const all = arr(jobs).filter(j => j && j.name && j.type !== "quote" && !j.archived && !j.deleted);
  const finished = all.filter(j => (j.finishStatus === "complete" || parseInt(j.finishStage) === 100) && inWin(j.finishStatusDate)).map(j => String(j.name).trim());
  let inspPassed = 0, inspFailed = 0, cosCreated = 0, cosApproved = 0, cosConverted = 0, rtCreated = 0, punchClosed = 0, qAsked = 0, qAnswered = 0;
  all.forEach(j => {
    ["roughInspectionAttempts", "finalInspectionAttempts"].forEach(k => arr(j[k]).forEach(a => { if (a && inWin(a.date)) { if (a.result === "fail") inspFailed++; else if (a.result) inspPassed++; } }));
    arr(j.changeOrders).forEach(co => { if (!co) return; if (inWin(co.createdAt)) cosCreated++; const sd = co.coStatusSyncedAt || co.coStatusDate; if (inWin(sd) && String(co.coStatus).toLowerCase() === "approved") cosApproved++; if (inWin(sd) && String(co.coStatus).toLowerCase() === "converted") cosConverted++; });
    arr(j.returnTrips).forEach(rt => { if (rt && inWin(rt.createdAt || rt.date)) rtCreated++; });
    ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(applyPunchTicks(j)[k], i => { if (i.done && !i.voided && inWin(i.checkedAtTs || i.checkedAt)) punchClosed++; }));
    ["roughQuestions", "finishQuestions"].forEach(k => { const qs = j[k]; if (!qs || typeof qs !== "object") return; Object.values(qs).forEach(l => arr(l).forEach(q => { if (!q) return; if (inWin(q.addedAt)) qAsked++; if (inWin(q.answeredAt)) qAnswered++; })); });
  });
  const weeks = arr(prevState && prevState.weeks);
  const rts = weeks.filter(w => w && w.ymd !== ymd(today)).slice(0, 4).map(w => w && w.counts && w.counts.rtCreated).filter(n => typeof n === "number");
  const rtAvg4 = rts.length ? Math.round(rts.reduce((a, n) => a + n, 0) / rts.length * 10) / 10 : null;
  const counts = { finished: finished.length, inspPassed, inspFailed, cosCreated, cosApproved, cosConverted, rtCreated, punchClosed, qAsked, qAnswered, blocksCleared: blocked.cleared.length };
  return { error: false, finished, inspPassed, inspFailed, cosCreated, cosApproved, cosConverted, rtCreated, rtAvg4, punchClosed, qAsked, qAnswered, cleared: blocked.cleared, counts };
}

// ── recipients ───────────────────────────────────────────────────────────────
const EXTRA_RECIPIENTS = ["josh", "brady", "justin"];
function resolveRecipients(users) {
  const accessOf = (u) => u.access || ({ admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard" }[u.role] || "limited");
  const out = [], seen = new Set();
  arr(users).forEach(u => { if (!u || u.active === false) return; const n = String(u.name || "").toLowerCase().trim(); const isAdmin = accessOf(u) === "admin", isExtra = EXTRA_RECIPIENTS.some(x => n === x || n.startsWith(x + " "));
    if (!isAdmin && !isExtra) return; const id = u.id || u.name; if (!id || seen.has(id)) return; seen.add(id); out.push({ user: u, reason: isAdmin ? "admin" : "added" }); });
  return out;
}

// ── model ────────────────────────────────────────────────────────────────────
function buildModel(inputs) {
  const I = inputs || {}; const now = I.now instanceof Date ? I.now : new Date();
  const w = weekOf(now), { today, meeting, weekYmds, weekDays } = w;
  const ERR = (e) => ({ error: `Section unavailable this week: ${(e && e.message) || e}` });
  // When the doc was actually generated, in MT (a test run at 9:41 must not claim 6:00 AM).
  const builtAt = now.toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/[\u00a0\u202f]/g, " ");
  const m = {
    heading: `Friday Strategy Prep — ${meeting.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,   // the doc title; the body carries no heading (it is pasted under Google's own)
    preLine: `pre-filled ${builtAt} MT from the crew app · next week Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])} · booked = Simpro + planner as of ${builtAt} MT · details live in the app`, builtAt,
    weekLabel: `Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])}`, meetingYmd: ymd(meeting), todayYmd: ymd(today),
    carried: { error: false, fromLabel: "", rows: [] }, headline: [], schedule: { error: true }, blocked: { error: true }, coming: { error: true }, money: { error: true }, qc: { error: true }, lastWeek: { error: true }, counts: {}, nextState: null,
  };
  const prev = I.prevState && typeof I.prevState === "object" ? I.prevState : null;
  const prevFallback = () => prev ? { blockerKeys: arr(prev.blockerKeys), marginByJob: prev.marginByJob || {}, dates: prev.dates || {}, userIds: arr(prev.userIds), weeks: arr(prev.weeks) } : null;
  // A failed read of Josh's doc must say so (never "Nothing carried."); the orchestrator passes notesError from its catch.
  if (I.notesError) m.carried = { error: typeof I.notesError === "string" && I.notesError.trim() ? I.notesError : NOTES_READ_HINT, fromLabel: "", rows: [] };
  else { try { m.carried = parseNotesCarry(I.notesDoc, meeting); } catch (e) { m.carried = { ...ERR(e), fromLabel: "", rows: [] }; } }
  let live = [];
  try { if (!Array.isArray(I.jobs)) throw new Error("jobs missing"); live = liveJobs(I.jobs); } catch (e) { const err = ERR(e); m.schedule = err; m.blocked = err; m.coming = err; m.money = err; m.qc = err; m.lastWeek = err; m.nextState = prevFallback(); return m; }
  let cls = { booked: [], idle: [], starts: [], onHold: [], between: [], later: [] }, idx = null;
  try {
    idx = buildScheduleIndex(Array.isArray(I.scheduleEntries) ? I.scheduleEntries : [], I.plannerDoc, live, weekYmds, I.jobs); idx.simproOk = I.simproOk !== false && Array.isArray(I.scheduleEntries);
    cls = classifySchedule(live, idx, weekYmds, today);
    const mv = movedDates(live, prev && prev.dates, today);
    // An overdue start already prints under Starts; its DATE PASSED start row would be a duplicate.
    const overdueIds = new Set(cls.starts.filter(r => r.overdue).map(r => r.jobId));
    mv.passed = mv.passed.filter(r => !(r.kind === "start" && overdueIds.has(r.jobId)));
    const people = peopleRows({ users: I.users, pto: I.pto, timeOffRequests: I.timeOffRequests, needs: I.needs, prevUserIds: prev ? prev.userIds : null, idx, weekDays, today });
    m.schedule = { error: false, booked: cls.booked.slice(0, CAPS.booked), bookedMore: Math.max(0, cls.booked.length - CAPS.booked), idle: cls.idle, starts: cls.starts, onHold: cls.onHold, between: cls.between, later: cls.later, moved: mv.rows, passed: mv.passed, movedFirstRun: mv.firstRun,
      calendar: calendarRows(live, I.calendarEvents, weekYmds).slice(0, CAPS.calendar), people, conflicts: conflictRows(idx, I.pto, weekYmds), unknownSimpro: idx.unknownSimpro, simproOk: idx.simproOk, plannerPresent: idx.plannerPresent };
  } catch (e) { m.schedule = ERR(e); }
  try { m.blocked = { error: false, ...blockedRows({ live, needs: I.needs, users: I.users, prevBlockerKeys: prev ? prev.blockerKeys : null, today, now: w.mtNow }) }; } catch (e) { m.blocked = ERR(e); }
  try { m.coming = comingRows({ live, upcoming: I.upcoming, agentFindings: I.agentFindings, weekYmds, today, cls }); } catch (e) { m.coming = ERR(e); }
  // Pipeline (upcoming) rows dated inside next week are starts too (spec §4.3): no live job, so nobody is crewed.
  if (!m.schedule.error && !m.coming.error) {
    const extra = m.coming.startsNextWeek.map(r => ({ jobId: "up_" + (r.upId || r.name), name: r.name, phase: "rough", pct: 0, foreman: "", lead: "", date: r.date, di: weekYmds.indexOf(ymd(r.date)), confirmed: r.confirmed,
      crewBooked: false, missingRoles: ["foreman", "lead"], prep: { done: 0, total: 5, missing: [], legacy: true }, elsewhere: [], atRisk: true, pipeline: true }));
    m.schedule.starts = [...m.schedule.starts, ...extra].sort((a, b) => a.di - b.di || a.name.localeCompare(b.name));
  }
  try { m.money = moneyRows({ live, simproTotalsById: I.simproTotalsById, prevMargin: prev ? prev.marginByJob : null, today }); } catch (e) { m.money = ERR(e); }
  try { m.qc = qcRows({ live, today }); } catch (e) { m.qc = ERR(e); }
  try { m.lastWeek = lastWeekRows({ jobs: I.jobs, live, users: I.users, prevState: prev, blocked: m.blocked.error ? { cleared: [] } : m.blocked, today }); } catch (e) { m.lastWeek = ERR(e); }
  // headline — each line drops if its section failed
  try {
    const H = [];
    if (!m.schedule.error) { const s = m.schedule, risk = s.starts.filter(x => x.atRisk).length;
      const crew = !s.simproOk && !s.plannerPresent ? "crew unknown: Simpro unavailable, no planner for next week" : `${plural(cls.booked.length, "job")} crewed · ${s.idle.length} in progress with nobody booked`;
      H.push(`Next week: ${crew} · ${plural(s.starts.length, "start")}${risk ? `, ${risk} at risk` : ""}.`); }
    if (!m.blocked.error) { const parts = GROUP_ORDER.filter(g => m.blocked.byGroup[g]).map(g => `${m.blocked.byGroup[g]} ${HEAD_GROUP[g] || g.toLowerCase()}`); H.push(`${plural(m.blocked.jobs, "job")} blocked${parts.length ? `: ${parts.join(" · ")}` : ""}.`); }
    if (!m.money.error) { const r = m.money.rti, g = m.money.margin;
      const bill = !r.count ? "Nothing ready to bill" : r.knownCount === 0 ? `${plural(r.count, "job")} ready to bill ($ not fetched)`
        : r.knownCount < r.count ? `${fmtMoney(r.total)} on ${r.knownCount} of ${plural(r.count, "job")} ready to bill` : `${fmtMoney(r.total)} ready to bill on ${plural(r.count, "job")}`;
      H.push(`${bill}${g.median != null ? ` · margin at finish median ${g.median}% vs ${MARGIN_TARGET}%, ${g.underCount} under` : ""}.`); }
    m.headline = H;
  } catch (e) { m.headline = []; }
  m.counts = { live: live.length, booked: cls.booked.length, idle: cls.idle.length, starts: m.schedule.error ? cls.starts.length : m.schedule.starts.length, onHold: cls.onHold.length, between: cls.between.length, later: cls.later.length, blocked: m.blocked.error ? null : m.blocked.jobs, rti: m.money.error ? null : m.money.rti.count, qc: m.qc.error ? null : m.qc.rows.length, carried: m.carried.rows.length };
  const weekRow = { ymd: ymd(today), counts: m.lastWeek.error ? {} : m.lastWeek.counts };
  try {
    m.nextState = { blockerKeys: m.blocked.error ? arr(prev && prev.blockerKeys) : m.blocked.keys, marginByJob: m.money.error ? (prev && prev.marginByJob) || {} : m.money.marginByJob,
      dates: nextDates(live, prev && prev.dates, ymd(today)), userIds: arr(I.users).map(u => u && (u.id || u.name)).filter(Boolean), weeks: [weekRow, ...arr(prev && prev.weeks).filter(x => x && x.ymd !== weekRow.ymd)].slice(0, 8) };
  } catch (e) { m.nextState = prevFallback() || { blockerKeys: [], marginByJob: {}, dates: {}, userIds: [], weeks: [] }; m.stateError = (e && e.message) || String(e); }
  return m;
}

// ── Josh's notes doc → last meeting's carry-forward (Docs API JSON) ─────────
// Sections start at a paragraph whose text begins "Mon D, YYYY |" (Google's meeting-notes heading; any style).
// Inside a section, a non-bullet paragraph names the list: Notes / General / Next week's top priorities / Action items carry;
// Ready to invoice / QCs / Invoicing do not. Struck-through text (what Docs does to a ticked checkbox) = done; its children go with it.
const HEAD_RE = /^([A-Z][a-z]{2} \d{1,2}, \d{4})\s*\|/;
const CARRY_SECTION = /^(notes|general|next week'?s? top priorities|action items?|carried from .+)$/i;
const SKIP_SECTION = /^(ready to invoice|qcs? needed.*|invoicing|invoice ready|app additions.*|schedule.*|money|coming up|blocked|last week|qc to schedule)$/i;
const CARRIED_SUFFIX = /\s*\(carried \d+ wks?\)\s*$/;
const normText = (s) => String(s || "").toLowerCase().replace(/\(carried \d+ wks?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function docParas(doc) {
  const content = doc && doc.body && Array.isArray(doc.body.content) ? doc.body.content : [];
  return content.filter(c => c && c.paragraph).map(c => {
    const els = arr(c.paragraph.elements).filter(e => e && e.textRun && typeof e.textRun.content === "string");
    const text = els.map(e => e.textRun.content).join("").replace(/\s+/g, " ").trim();
    const struck = els.length > 0 && els.every(e => !e.textRun.content.trim() || (e.textRun.textStyle && e.textRun.textStyle.strikethrough));
    return { text, bullet: !!c.paragraph.bullet, nest: (c.paragraph.bullet && c.paragraph.bullet.nestingLevel) || 0, struck };
  });
}
function sectionsOf(paras) {
  const secs = [];
  paras.forEach(p => { const m = !p.bullet && p.text.match(HEAD_RE); if (m) { const d = toDateAny(m[1]); if (d) secs.push({ label: m[1], date: d, paras: [] }); return; } if (secs.length) secs[secs.length - 1].paras.push(p); });
  return secs;
}
function carryItems(sec) {
  const rows = []; let list = null, struckNest = null, parent = null;
  for (let p of sec.paras) {
    // A list heading may end with a colon ("Notes:", "Ready to invoice:"); it is stripped before matching.
    if (!p.bullet) { const t = p.text.replace(/^[*_]+|[*_]+$/g, "").trim().replace(/\s*:\s*$/, ""); if (!t) continue; if (CARRY_SECTION.test(t)) { list = "carry"; struckNest = null; parent = null; continue; } if (SKIP_SECTION.test(t) || /^attendees/i.test(t)) { list = "skip"; continue; } if (list === "carry") list = null; continue; }
    if (list !== "carry" || !p.text) continue;
    p = { ...p, text: p.text.replace(CARRIED_SUFFIX, "") };   // our own "(carried N wks)" tag, read back from the Carried section we wrote
    if (!p.text) continue;
    if (/^owner\s+[—-]\s+what/i.test(p.text)) continue;
    if (struckNest != null && p.nest > struckNest) continue;       // child of a struck item
    struckNest = null;
    if (p.struck) { struckNest = p.nest; if (p.nest === 0) parent = null; continue; }
    if (p.nest === 0) { parent = { text: p.text, children: [] }; rows.push(parent); }
    else if (parent) parent.children.push(p.text);
    else rows.push({ text: p.text, children: [] });
  }
  return rows.map(r => r.children.length ? `${r.text} — ${r.children.join("; ")}` : r.text);
}
function parseNotesCarry(doc, meetingDate) {
  const empty = { error: false, fromLabel: "", rows: [] };
  if (!doc) return empty;
  if (!(meetingDate instanceof Date)) return empty;   // pure module: no clock read
  const meet = startOfDay(meetingDate);
  const secs = sectionsOf(docParas(doc)).filter(s => s.date < meet).sort((a, b) => b.date - a.date);
  if (!secs.length) return empty;
  const items = carryItems(secs[0]);
  const earlier = secs.slice(1).map(s => new Set(carryItems(s).map(normText)));
  // A substring match counts only between real sentences (12+ chars each): "Rose" is not "Rose Residence panel swap".
  const rows = items.map(text => { const k = normText(text); let weeks = 1; for (const set of earlier) { if (set.has(k) || [...set].some(x => x && k.length >= 12 && x.length >= 12 && (k.includes(x) || x.includes(k)))) weeks++; else break; } return { text, weeks }; });
  return { error: false, fromLabel: secs[0].label, rows: rows.slice(0, CAPS.carried) };
}

// ── lines for the Docs API (consumed by foremanMeetingPrep.docsRequests) ─────
// Layout = Koy's hand-edited TEST doc of 2026-10-15 ("exactly how I want it structured and templated in the
// future pulls"): no header or headline, Carried only when there is something to carry, a free Notes list,
// every job as a small tree (name › status › Plan), Blocked = GC / builder + Us only, one job per Coming-up
// line with QC to schedule folded in, no Money, no DATE PASSED, no OVERDUE / DUE starts, no Plan-intake /
// In-prep / Near-done rows. The model still computes everything (state, counts, dry-run checks); only the
// rendering changed. Nesting = leading tabs (what createParagraphBullets reads as the level); every span
// offset is shifted past them.
const RED = [0.72, 0.14, 0.14], GREEN = [0.12, 0.48, 0.3], AMBER = [0.71, 0.33, 0.1], BLUE = [0.18, 0.4, 0.77], BLACK = [0, 0, 0], CREW_GREEN = [0.22, 0.46, 0.11];
const BLOCKED_GROUPS_SHOWN = new Set(["GC / builder", "Us (office owes the field)"]);   // Koy 2026-10-16: the other groups never print
function renderLines(m) {
  const L = [];
  const H3 = (t) => L.push({ text: t, kind: "h3" }), H4 = (t) => L.push({ text: t, kind: "h4" });
  const P = (t) => L.push({ text: t, kind: "p" }), G = (t) => L.push({ text: t, kind: "grey" }), C = (t) => L.push({ text: t, kind: "check" });
  const B = (t, spans, depth = 0) => L.push({ text: "\t".repeat(depth) + t, kind: "bullet", spans: (spans || []).map(sp => ({ ...sp, start: sp.start + depth })) });
  const B1 = (t, spans) => B(t, spans, 1), B2 = (t, spans) => B(t, spans, 2);
  const BLANK = () => P("");
  const bold = (t) => [{ start: 0, len: t.length, rgb: BLACK, bold: true }];
  // "NO CREW Name" — coloured bold tag, then the name in bold black (the whole parent line is bold, like Koy's).
  const tag = (word, rgb, rest) => B(`${word} ${rest}`, [{ start: 0, len: word.length, rgb, bold: true }, { start: word.length + 1, len: rest.length, rgb: BLACK, bold: true }]);
  const fail = (sec) => G(typeof sec.error === "string" ? sec.error : "Section unavailable this week.");
  const more = (n) => { if (n > 0) G(`…and ${n} more in the app`); };
  const who = (r) => [r.foreman, r.lead && r.lead !== r.foreman ? r.lead : ""].filter(Boolean).join(" · ");
  const age = (n) => n == null ? "no date" : `${n}d`;
  const sec = (fallback, fn) => { const start = L.length; try { fn(); } catch (e) { L.length = start; H3(fallback); G(`Section could not be rendered: ${(e && e.message) || e}`); } };
  const prepShort = (xs) => xs.map(x => x.replace(/ Received| Up to Date| to App & SimPro| to Foreman/g, "")).join(", ");
  const conf = (c) => c ? "confirmed" : "projected";

  // Carried — only when Josh's doc was read AND something carries. A failed read is logged by the
  // orchestrator (and shown in the dashboard card), not printed in the meeting doc (Koy 2026-10-16).
  if (!m.carried.error && m.carried.rows.length) {
    sec("Carried from last meeting", () => {
      H3(m.carried.fromLabel ? `Carried from ${m.carried.fromLabel.replace(/,\s*\d{4}$/, "")}` : "Carried from last meeting");   // "Carried from Oct 9" — the same heading Josh's notes use
      m.carried.rows.forEach(r => C(`${r.text}${r.weeks > 1 ? ` (carried ${r.weeks} wks)` : ""}`));
    });
    C("");
  }

  // Schedule
  sec("Schedule next week", () => {
  H3(`Schedule next week · ${m.weekLabel}`);
  if (m.schedule.error) fail(m.schedule); else {
    const s = m.schedule;
    H4("Notes"); B("");
    const crewUnknown = !s.simproOk && !s.plannerPresent;
    H4(crewUnknown ? "Scheduled — crew unknown: Simpro unavailable and no planner for next week" : `Scheduled · ${s.booked.length + (s.bookedMore || 0)}${s.simproOk ? (s.plannerPresent ? "" : " (no planner for next week; Simpro only)") : " — Simpro unavailable; planner only"}`);
    if (!s.booked.length && !crewUnknown) G(`Nothing booked for next week yet${m.builtAt ? ` (as of ${m.builtAt} MT)` : ""}.`);
    s.booked.forEach((r, i) => {
      if (i) BLANK();
      B(r.name, bold(r.name));
      B1(`${r.phase}${r.pct ? ` ${r.pct}%` : ""}${r.qcNeeds ? " · QC after" : ""}${r.start ? ` · ${r.start.phase} start ${fmtMD(r.start.date)} ${conf(r.start.confirmed)}` : ""}`);
      B1("Plan");
      const crew = `${r.people.join(", ")} · ${r.days}`;
      B2(crew, [{ start: 0, len: crew.length, rgb: CREW_GREEN, bold: false }]);
    });
    more(s.bookedMore);
    s.unknownSimpro.forEach(u => B(`Simpro #${u.pid} ${u.appName ? `${u.appName} (${u.appState})` : "(not in app)"} · ${daysLabel(u.days)} · ${u.people.join(", ")}`));
    H4(`Need to be scheduled next week · ${s.idle.length}`);
    if (!s.idle.length) G("Every in-progress job has crew next week.");
    s.idle.forEach((r, i) => {
      if (i) BLANK();
      tag("NO CREW", RED, r.name);
      B1(`${r.statusText || `${r.phase} ${r.pct}%`} · last update ${r.lastUpdate ? fmtMD(r.lastUpdate) : "none on file"}${r.rti ? ` · ready to invoice ${age(r.rtiDays)}` : ""}${r.qcNeeds ? " · QC needs" : ""}${r.openPunch ? ` · ${r.openPunch} punch` : ""}${r.questions ? ` · ${plural(r.questions, "question")}` : ""}${r.waitBuckets.length ? ` · waiting: ${r.waitBuckets.slice(0, 2).join(", ")}` : ""}${!s.simproOk ? " (Simpro not checked)" : ""}`);
      B1("Plan");
    });
    // OVERDUE / DUE rows (dated before next Monday, not started) are gone for good (Koy 2026-10-16);
    // the model keeps them so the dry-run's every-job-in-one-bucket check still sees them.
    const starts = s.starts.filter(r => !r.overdue);
    H4(`Starts · ${starts.length}`);
    if (!starts.length) G("No starts dated inside next week.");
    starts.forEach((r, i) => {
      if (i) BLANK();
      if (r.pipeline) {
        tag("UPCOMING", AMBER, r.name);
        B1(`${r.phase} ${conf(r.confirmed)} start ${DAY_LBL[r.di]} ${fmtMD(r.date)} · not in the app yet`);
        B1("nobody booked"); B1("Plan"); return;
      }
      const hardTail = r.hardDate ? ` · needs a hard date${r.hardBy ? ` by ${fmtMD(r.hardBy)}` : ""}` : "";
      if (r.hardDate && r.di < 0) { tag("HARD DATE NEEDED", RED, r.name); B1(`${r.phase} needs a hard date${r.hardBy ? ` by ${fmtMD(r.hardBy)}` : ""}`); }
      else {
        const chip = r.atRisk ? ["AT RISK", RED] : r.confirmed ? ["CONFIRMED", GREEN] : ["PROJECTED", AMBER];
        tag(chip[0], chip[1], r.name);
        B1(`${r.phase} ${conf(r.confirmed)} start ${DAY_LBL[r.di]} ${fmtMD(r.date)}${hardTail}`);
      }
      B1(`nobody booked${r.missingRoles.length ? ` · no ${r.missingRoles.join(", no ")}` : who(r) ? ` · ${who(r)}` : ""}`);
      B1(`prep ${r.prep.done}/${r.prep.total}${r.prep.missing.length && r.prep.done < 5 ? ` (${prepShort(r.prep.missing)})` : ""}`);
      r.elsewhere.forEach(e => B1(e));
      B1("Plan");
    });
    H4("Dates that moved since last Friday");
    if (s.movedFirstRun) G("Tracking starts this week."); else if (!s.moved.length) G("Nothing moved.");
    s.moved.forEach(r => B(r.to === "no date" ? `${r.name} — ${r.label} ${r.from} → no date (cleared)` : `${r.name} — ${r.label} ${r.from} → ${r.to}${r.nth > 2 ? ` (${r.nth}${r.nth === 3 ? "rd" : "th"} date)` : ""}`));
    // DATE PASSED rows (old inspections / walks with no result) are gone for good (Koy 2026-10-16).
    H4("On the calendar");
    if (!s.calendar.length) G("No inspections, walks or scans dated next week.");
    s.calendar.forEach(r => B(`${DAY_LBL[r.di]} — ${r.label} · ${r.name}${r.who ? ` · ${r.who}` : ""}${r.ambiguous ? " (name match — check which job)" : ""}`));
    H4("People");
    const p = s.people;
    if (p.out.length) { B("Out:"); p.out.forEach(o => B1(`${o.name} ${o.range}${o.note ? ` (${o.note})` : ""}`)); } else B("Nobody out next week.");
    p.pending.forEach(r => B(`Pending request: ${r.name} · ${r.range}${r.requestedDays != null ? ` · asked ${r.requestedDays}d ago` : ""}`));
    p.bodies.forEach(r => B(`Bodies asked for: ${r.text}${r.job ? ` [${r.job}]` : ""} (${r.by}${r.ageDays != null ? `, ${r.ageDays}d ago` : ""})`));
    p.newUsers.forEach(u => B(`New on the team: ${u.name}${u.title ? ` · ${u.title}` : ""}`));
    B(`Capacity (booked / available): ${p.capacity.map(c => `${DAY_LBL[c.di]} ${c.booked}/${c.available}`).join(" · ")}`);
    if (s.conflicts.length) { H4("Conflicts"); s.conflicts.forEach(c => tag("CONFLICT", RED, c)); }
  }
  });
  C("");

  // Blocked — GC / builder and Us only (Koy 2026-10-16). Every group is still computed for state + the dashboard.
  sec("Blocked", () => {
  H3("Blocked — what we are waiting on, from whom, how long");
  if (m.blocked.error) fail(m.blocked); else {
    const groups = m.blocked.groups.filter(g => BLOCKED_GROUPS_SHOWN.has(g.name));
    if (!groups.length) G("Nothing blocked on the GC or on us.");
    groups.forEach(g => { H4(`${g.name} · ${g.rows.length + g.more}`); g.rows.forEach(r => B(`${r.name} — ${r.what}${r.who ? ` · ${r.who}` : ""} · ${age(r.ageDays)}`)); more(g.more); });
    const cleared = m.blocked.cleared.filter(c => BLOCKED_GROUPS_SHOWN.has(c.group));
    if (cleared.length) { H4("Cleared since last Friday"); cleared.forEach(c => tag("CLEARED", GREEN, `${c.name} — ${c.group}`)); }
  }
  });
  C("");

  // Coming up — one job per line; the first line of a week carries the week label.
  sec("Coming up", () => {
  H3("Coming up · next 2–8 weeks");
  if (m.coming.error) fail(m.coming); else {
    const c = m.coming;
    if (!c.weeks.length) G("No dated starts after next week.");
    c.weeks.forEach(w => w.rows.forEach((r, i) => B(`${i === 0 ? `${w.label} — ` : ""}${r.name}${r.customer ? ` (${r.customer})` : ""} ${fmtMD(r.date)} ${conf(r.confirmed)}${r.note ? ` · ${r.note}` : ""}`)));
    if (c.laterCount > 0) G(`…and ${c.laterCount} later`);
    if (arr(c.overdue).length) B(`Projected start passed, still in Upcoming: ${c.overdue.map(r => `${r.name} ${fmtMD(r.date)}`).join(", ")}`);
    c.noDate.forEach((r, i) => B(`${i === 0 ? "No date yet: " : ""}${r.name}${r.note ? ` (${r.note})` : ""}`));
    // In prep / Plan intake / Near done rows are gone for good (Koy 2026-10-16).
  }
  });
  // QC to schedule — folded into Coming up as a sub-list (Koy 2026-10-16), each walk a small tree.
  sec("QC to schedule", () => {
  BLANK();
  H4("QC to schedule");
  if (m.qc.error) fail(m.qc); else {
    if (!m.qc.rows.length) G("Nothing waiting on a QC walk.");
    m.qc.rows.forEach(r => { B(`${r.name}${r.foreman ? ` · ${r.foreman}` : ""}`); B1(`${r.why}${r.since ? ` since ${r.since}` : ""} · ${r.openPunch} punch open${r.small ? " · small — pics may do" : ""}`); B1("Plan"); });
    more(m.qc.more);
  }
  });
  C("");

  // Money — not printed (Koy 2026-10-16). moneyRows still runs: marginByJob state + the dry-run counts need it.

  // Last week
  sec("Last week", () => {
  H3("Last week");
  if (m.lastWeek.error) fail(m.lastWeek); else {
    const l = m.lastWeek;
    B(`Finished: ${l.finished.length ? l.finished.join(", ") : "none"}`);
    B(`Inspections: ${l.inspPassed} passed · ${l.inspFailed} failed`);
    B(`Change orders: ${l.cosCreated} created · ${l.cosApproved} approved · ${l.cosConverted} converted to return trip`);
    B(`Return trips created: ${l.rtCreated}${l.rtAvg4 != null ? ` (4-week average ${l.rtAvg4})` : ""}`);
    B(`Punch closed: ${l.punchClosed} · questions answered ${l.qAnswered} of ${l.qAsked} asked`);
    B(`Blocks cleared: ${l.cleared.length}`);
  }
  });

  // Action items
  if (typeof m.stateError === "string" && m.stateError) G(`State snapshot not updated this run: ${m.stateError}`);
  H3("Action items");
  G("Owner — what — by when");
  C(""); C(""); C(""); C("");
  return L;
}

module.exports = { TZ, NOTES_READ_HINT, startDateOf, nextStartOf, phasePending, normPrevDates, MARGIN_TARGET, CAPS, DAY_LBL, SPECIAL_JOB, PREP_ITEMS, WAIT_BUCKETS, toDateAny, startOfDay, addDays, daysBetween, ymd, fmtShort, fmtMD, firstKey, personKey, plural, arr, clip, esc, stripHtml, fmtMoney, median,
  snOf, effStatus, pctOf, hasForeman, leadOf, liveJobs, walkPunch, openPunchCount, waitingItems, openQuestions, waitBucket, prepOf, weekOf, daysLabel, buildScheduleIndex, classifySchedule, docsRequests,
  dateKeys, movedDates, nextDates, calendarRows, peopleRows, conflictRows, isRoster, normName, overlapDays, blockedRows, GROUP_ORDER,
  buildModel, parseNotesCarry, renderLines, docParas, sectionsOf, carryItems, comingRows, moneyRows, qcRows, lastWeekRows, collectSimproCandidates, resolveRecipients, isFinishingOpen, isRti, mondayOf, EXTRA_RECIPIENTS };
