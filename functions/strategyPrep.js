// ─────────────────────────────────────────────────────────────
// Friday Strategy/Scheduling Meeting pre-fill — PURE module (no Firestore, no network).
//   buildModel(inputs) → plain model · renderLines(model) → [{kind,text,spans}] · parseNotesCarry(doc, now)
// Spec: docs/superpowers/specs/2026-10-15-friday-strategy-prep-design.md
// Accuracy rules (Koy, 2026-10-15: "it just needs to be 100 percent accurate"):
//   booked = Simpro schedules ∪ planner, NEVER job.foreman/lead · no live job silently dropped ·
//   conflicts shown, never merged · the retired *ScheduledDate and last-activity fields are never read.
// ─────────────────────────────────────────────────────────────
"use strict";
const { docsRequests } = require("./foremanMeetingPrep.js");

const TZ = "America/Denver";
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
function toDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") { try { const d = v.toDate(); return isNaN(d.getTime()) ? null : d; } catch (e) { return null; } }
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (m && !/T\d/.test(s)) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{12,14}$/.test(s)) { const d = new Date(+s); return isNaN(d.getTime()) ? null : d; }
  if (!/\d/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
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
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c])); }
function stripHtml(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }
const fmtMoney = (v) => v >= 950 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
function median(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10; }

// ── jobs ─────────────────────────────────────────────────────────────────────
const snOf = (j) => String((j && j.simproNo) || "").trim();
const effStatus = (j, phase) => { const st = j[phase + "Status"]; if (st) return st; const p = parseInt(j[phase + "Stage"]) || 0; return p === 100 ? "complete" : p > 0 ? "inprogress" : ""; };
const pctOf = (j, phase) => parseInt(j[phase + "Stage"]) || 0;
const ACTIVE_ST = new Set(["inprogress", "scheduled", "date_confirmed"]);
const STARTED_ST = new Set(["inprogress", "complete", "invoice", "waiting"]);
const hasForeman = (j) => !!j.foreman && !/^unassigned$/i.test(String(j.foreman).trim());
const leadOf = (j) => { const l = String(j.lead || "").trim(); return l && !/unassigned|tbd/i.test(l) ? l : ""; };
const isDone = (j) => j.finishStatus === "complete" || j.finishStatus === "invoice" || parseInt(j.finishStage) === 100 ||
  (j.tempPed && j.tempPedStatus === "completed") || (j.quickJob && ["complete", "invoice"].includes(j.quickJobStatus));
function liveJobs(jobs) {
  return arr(jobs).filter(j => j && j.name && String(j.name).trim() !== "Example Job" && j.type !== "quote" && !j.archived && !j.deleted && !j.archivedAt && !isDone(j));
}
function walkPunch(punch, cb) {
  if (!punch || typeof punch !== "object") return;
  const floors = ["upper", "main", "basement"].concat(arr(punch.extras).map(e => e && e.key).filter(Boolean));
  floors.forEach(fk => { const f = punch[fk]; if (!f || typeof f !== "object") return;
    arr(f.general).forEach(i => i && cb(i)); arr(f.hotcheck).forEach(i => i && cb(i)); arr(f.rooms).forEach(r => arr(r && r.items).forEach(i => i && cb(i))); });
}
function openPunchCount(j) { let n = 0; ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (!i.done && !i.voided) n++; })); return n; }
function waitingItems(j) { const out = []; ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (!i.done && !i.voided && i.waiting) out.push({ text: stripHtml(i.text), waitingOn: String(i.waitingOn || "").trim(), since: toDateAny(i.waitingSince || i.addedAtTs || i.addedAt) }); })); return out; }
function openQuestions(j) {
  const out = [];
  ["roughQuestions", "finishQuestions"].forEach(k => { const qs = j[k]; if (!qs || typeof qs !== "object") return;
    Object.values(qs).forEach(list => arr(list).forEach(q => { if (!q || q.done || q.deleted || String(q.answer || "").trim() || arr(q.answerPhotos).length) return;
      out.push({ text: stripHtml(q.question || q.text || ""), since: toDateAny(q.addedAt) || toDateAny(q.date) || toDateAny(q.id) }); })); });
  return out.filter(q => q.text);
}
function waitBucket(text) { const r = String(text || "").trim(); if (!r) return "Unspecified"; for (const [label, re] of WAIT_BUCKETS) if (re.test(r)) return label; return "Other"; }
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
  return { today, meeting, nextMon, weekDays, weekYmds: weekDays.map(ymd), DAY_LBL };
}
function daysLabel(dis) {
  if (dis.length === 5) return "all week";
  const runs = []; let s = dis[0], p = dis[0];
  for (let i = 1; i <= dis.length; i++) { const c = dis[i]; if (c === p + 1) { p = c; continue; } runs.push(s === p ? DAY_LBL[s] : `${DAY_LBL[s]}–${DAY_LBL[p]}`); s = p = c; }
  return runs.join(", ");
}

// ── schedule index: WHO is booked WHERE next week (Simpro ∪ planner) ────────
// Never reads job.foreman/lead. unknownSimpro keeps Simpro jobs the app has no record of.
function buildScheduleIndex(scheduleEntries, plannerDoc, live, weekYmds) {
  const byJob = new Map(), byPerson = new Map(), unknown = new Map();
  const jobBySn = new Map(); live.forEach(j => { const sn = snOf(j); if (sn) jobBySn.set(sn, j); });
  const note = (job, di, person, source) => {
    if (!byJob.has(job.id)) byJob.set(job.id, { days: {} });
    const d = byJob.get(job.id).days; if (!d[di]) d[di] = { people: [], source };
    if (!d[di].people.some(p => personKey(p) === personKey(person))) d[di].people.push(person);
    if (d[di].source !== source) d[di].source = "both";
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
    if (!unknown.has(pid)) unknown.set(pid, { pid, days: new Set(), people: [] });
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
function classifySchedule(live, idx, weekYmds, today) {
  const out = { booked: [], idle: [], starts: [], onHold: [], between: [] };
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
    // Dated start for a phase not yet started (only the ProjectedStart fields; the retired scheduled-date field is dead).
    const startOf = (p) => { const s = effStatus(j, p); if (STARTED_ST.has(s) || pctOf(j, p) > 0) return null; const d = toDateAny(j[p + "ProjectedStart"]); return d ? { phase: p, date: d, confirmed: !!j[p + "StartConfirmed"] || ["scheduled", "date_confirmed"].includes(s) } : null; };
    const start = startOf("rough") || startOf("finish");
    if (bookedDays.length) {
      const seen = new Set(), people = []; bookedDays.forEach(di => b.days[di].people.forEach(p => { const k = personKey(p); if (!seen.has(k)) { seen.add(k); people.push(p); } }));
      out.booked.push({ ...base, firstDay: bookedDays[0], days: daysLabel(bookedDays), people, source: [...new Set(bookedDays.map(di => b.days[di].source))].join("+"), qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start && inWindow(start.date) ? { ...start } : null });
      return;
    }
    if (start && inWindow(start.date)) {
      const di = weekYmds.indexOf(ymd(start.date)); const prep = prepOf(j);
      const missingRoles = [!hasForeman(j) ? "foreman" : "", !leadOf(j) ? "lead" : ""].filter(Boolean);
      const soon = daysBetween(start.date, today) <= 7;
      out.starts.push({ ...base, phase: start.phase, date: start.date, di, confirmed: start.confirmed, crewBooked: false, missingRoles, prep, elsewhere: elsewhere(j, di), atRisk: soon });
      return;
    }
    if (st === "waiting") { out.onHold.push({ ...base, since: toDateAny(j[phase + "StatusDate"]) }); return; }
    if (ACTIVE_ST.has(st) || (st === "" && pctOf(j, phase) > 0)) {
      const waits = waitingItems(j), qs = openQuestions(j);
      const byB = {}; waits.forEach(w => { const k = waitBucket(w.waitingOn); byB[k] = (byB[k] || 0) + 1; });
      const upd = [...arr(j.roughUpdates), ...arr(j.finishUpdates)].map(u => toDateAny(u && (u.date || u.createdAt))).filter(Boolean).sort((a, c) => c - a)[0] || toDateAny(j.statusUpdateAt);
      const rd = toDateAny(j.readyToInvoiceDate);
      out.idle.push({ ...base, lastUpdate: upd || null, openPunch: openPunchCount(j), questions: qs.length, waitBuckets: Object.entries(byB).sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k} ${n}`),
        rti: !!(j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent), rtiDays: j.readyToInvoice && rd ? Math.max(0, daysBetween(today, rd)) : null, qcNeeds: j.qcStatus === "needs" || j.finishQcStatus === "needs", start: start || null });
      return;
    }
    // Rough done, finish not started, dated later or undated → between (not printed; counted in checks).
    out.between.push({ ...base, finishStart: start ? start.date : null });
  });
  out.booked.sort((a, b) => a.firstDay - b.firstDay || a.name.localeCompare(b.name));
  out.starts.sort((a, b) => a.di - b.di || a.name.localeCompare(b.name));
  out.idle.sort((a, b) => (b.pct || 0) - (a.pct || 0) || a.name.localeCompare(b.name));
  return out;
}

module.exports = { TZ, MARGIN_TARGET, CAPS, DAY_LBL, SPECIAL_JOB, PREP_ITEMS, WAIT_BUCKETS, toDateAny, startOfDay, addDays, daysBetween, ymd, fmtShort, fmtMD, firstKey, personKey, plural, arr, clip, esc, stripHtml, fmtMoney, median,
  snOf, effStatus, pctOf, hasForeman, leadOf, liveJobs, walkPunch, openPunchCount, waitingItems, openQuestions, waitBucket, prepOf, weekOf, daysLabel, buildScheduleIndex, classifySchedule, docsRequests };
