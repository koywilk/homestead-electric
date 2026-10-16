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

// ── dates that moved since last Friday ───────────────────────────────────────
const DATE_FIELDS = [["roughProjectedStart", "rough start"], ["finishProjectedStart", "finish start"], ["fourWayTargetDate", "rough inspection"], ["finalInspectionTargetDate", "final inspection"], ["qcStatusDate", "rough QC walk"], ["finishQcStatusDate", "finish QC walk"], ["matterportStatusDate", "Matterport scan"]];
function dateKeys(live) {
  const out = {};
  live.forEach(j => {
    DATE_FIELDS.forEach(([f]) => { const d = toDateAny(j[f]); if (d) out[`${j.id}:${f}`] = ymd(d); });
    arr(j.returnTrips).forEach((rt, i) => { if (!rt || rt.signedOff || rt.rtStatus === "complete") return; const d = toDateAny(rt.rtStatusDate); if (d) out[`${j.id}:rt:${i}`] = ymd(d); });
  });
  return out;
}
// Keys that had a date last Friday and have none now, on a job that is still live. A return trip that was
// completed/signed off (or removed) is not a cleared date, so rt keys only count while that trip is still open.
function clearedKeys(live, prevDates, cur) {
  if (!prevDates || typeof prevDates !== "object") return [];
  const byId = new Map(live.map(j => [j.id, j])), out = [];
  Object.keys(prevDates).forEach(k => {
    if (k in cur) return;
    const parts = k.split(":"), j = byId.get(parts[0]); if (!j) return;
    const hist = arr(prevDates[k]); if (!hist.length) return;
    if (parts[1] === "rt") { const rt = arr(j.returnTrips)[Number(parts[2])]; if (!rt || rt.signedOff || rt.rtStatus === "complete") return; }
    out.push({ k, j, hist });
  });
  return out;
}
const labelOfKey = (k) => { const f = k.split(":")[1]; if (f === "rt") return "return trip"; const e = DATE_FIELDS.find(x => x[0] === f); return e ? e[1] : f; };
const mdOfYmd = (s) => { const d = toDateAny(s); return d ? fmtMD(d) : s; };
// prevDates: { key: [{d: runYmd, v: valueYmd}, ...] } (kept newest-last, cap 6). nth = how many distinct values seen incl. this one.
function movedDates(live, prevDates, today) {
  const firstRun = !prevDates || typeof prevDates !== "object";
  const cur = dateKeys(live), nameOf = new Map(live.map(j => [j.id, j]));
  const rows = [], passed = [];
  Object.entries(cur).forEach(([k, v]) => {
    const j = nameOf.get(k.split(":")[0]); if (!j) return;
    const hist = firstRun ? [] : arr(prevDates[k]);
    const last = hist.length ? hist[hist.length - 1].v : null;
    if (last && last !== v) rows.push({ name: j.name, label: labelOfKey(k), from: mdOfYmd(last), to: mdOfYmd(v), nth: new Set([...hist.map(h => h.v), v]).size });
  });
  // A date that was there last Friday and is gone now (job still live) is a move to "no date".
  clearedKeys(live, firstRun ? null : prevDates, cur).forEach(({ k, j, hist }) => {
    const last = hist[hist.length - 1].v; if (!last) return;
    rows.push({ name: j.name, label: labelOfKey(k), from: mdOfYmd(last), to: "no date", nth: new Set([...hist.map(h => h.v), ""]).size });
  });
  // Date passed: a start/inspection/QC/scan date before today whose status never moved.
  live.forEach(j => {
    const chk = (f, label, stillPending) => { const d = toDateAny(j[f]); if (d && ymd(d) < ymd(today) && stillPending) passed.push({ name: j.name, label, date: fmtMD(d) }); };
    chk("roughProjectedStart", "rough start", !STARTED_ST.has(effStatus(j, "rough")) && pctOf(j, "rough") === 0);
    chk("finishProjectedStart", "finish start", effStatus(j, "rough") === "complete" && !STARTED_ST.has(effStatus(j, "finish")) && pctOf(j, "finish") === 0);
    const rs = effStatus(j, "rough"), fs = effStatus(j, "finish");   // same phase guards as calendarRows
    chk("fourWayTargetDate", "rough inspection", rs !== "complete" && !STARTED_ST.has(fs) && !j.roughInspectionResult && !arr(j.roughInspectionAttempts).length);
    chk("finalInspectionTargetDate", "final inspection", (STARTED_ST.has(fs) || pctOf(j, "finish") > 0) && fs !== "complete" && !j.finalInspectionResult && !arr(j.finalInspectionAttempts).length);
    chk("qcStatusDate", "rough QC walk", j.qcStatus === "scheduled");
    chk("finishQcStatusDate", "finish QC walk", j.finishQcStatus === "scheduled");
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, passed, firstRun };
}
// Next state for the snapshot: append today's value when it differs from the last one.
function nextDates(live, prevDates, todayYmd) {
  const cur = dateKeys(live), out = {};
  Object.entries(cur).forEach(([k, v]) => { const hist = arr(prevDates && prevDates[k]).slice(-5); if (!hist.length || hist[hist.length - 1].v !== v) hist.push({ d: todayYmd, v }); out[k] = hist.slice(-6); });
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
    const raw = ev.start.dateTime || ev.start.date; const d = toDateAny(raw); if (!d) return;
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
  const out = arr(pto).map(p => ({ name: p.name, dis: overlapDays(p.start, p.end, weekDays), note: p.note || "" })).filter(p => p.dis.length).map(p => ({ name: p.name, range: daysLabel(p.dis), dis: p.dis, note: p.note }));
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

module.exports = { TZ, MARGIN_TARGET, CAPS, DAY_LBL, SPECIAL_JOB, PREP_ITEMS, WAIT_BUCKETS, toDateAny, startOfDay, addDays, daysBetween, ymd, fmtShort, fmtMD, firstKey, personKey, plural, arr, clip, esc, stripHtml, fmtMoney, median,
  snOf, effStatus, pctOf, hasForeman, leadOf, liveJobs, walkPunch, openPunchCount, waitingItems, openQuestions, waitBucket, prepOf, weekOf, daysLabel, buildScheduleIndex, classifySchedule, docsRequests,
  dateKeys, movedDates, nextDates, calendarRows, peopleRows, conflictRows, isRoster, normName, overlapDays };
