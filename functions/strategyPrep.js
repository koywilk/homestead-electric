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
// A saved history list can hold junk (null, a number, an entry without a string v); skip those, never throw.
const cleanHist = (h) => arr(h).filter(e => e && typeof e === "object" && typeof e.v === "string");
function clearedKeys(live, prevDates, cur) {
  if (!prevDates || typeof prevDates !== "object") return [];
  const byId = new Map(live.map(j => [j.id, j])), out = [];
  Object.keys(prevDates).forEach(k => {
    if (k in cur) return;
    const parts = k.split(":"), j = byId.get(parts[0]); if (!j) return;
    const hist = cleanHist(prevDates[k]); if (!hist.length) return;
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
    const hist = firstRun ? [] : cleanHist(prevDates[k]);
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
    const rawDT = ev.start.dateTime; const raw = typeof rawDT === "string" && rawDT ? rawDT.slice(0, 10) : (rawDT || ev.start.date); const d = toDateAny(raw);   // day = the date part as written (local to the event), never the UTC-shifted instant if (!d) return;
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

// ── blocked: one line per job, grouped by who we wait on ────────────────────
const GROUP_ORDER = ["GC / builder", "Homeowner / designer", "Material", "Inspection", "Other trades", "On hold", "Us (office owes the field)", "Sold work not on the calendar", "Other", "Unspecified"];
const OFFICE_NAMES = /^(koy|josh|jeromy|justin|brady)\b/i;
const CO_OPEN_APPROVED = (co) => co && String(co.coStatus || "").toLowerCase() === "approved" && !co.scheduledDate;
function blockedRows({ live, needs, users, prevBlockerKeys, today }) {
  const firstRun = !Array.isArray(prevBlockerKeys);
  const prev = new Set(firstRun ? [] : prevBlockerKeys);
  const age = (d) => d ? Math.max(0, daysBetween(today, d)) : null;
  const oldest = (dates) => { const ds = dates.filter(Boolean).sort((a, b) => a - b); return ds.length ? ds[0] : null; };
  const perJob = new Map(); // jobId → [{group, what, who, since, n, jobName}]  (n = how many underlying items this entry stands for)
  const push = (j, group, what, since, who, n) => { if (!perJob.has(j.id)) perJob.set(j.id, []); perJob.get(j.id).push({ group, what, since: since || null, who: who || "", n: n || 1, jobName: j.name }); };
  live.forEach(j => {
    const waits = waitingItems(j), qs = openQuestions(j);
    const byBucket = {};
    waits.forEach(w => { const b = waitBucket(w.waitingOn); (byBucket[b] = byBucket[b] || []).push(w); });
    Object.entries(byBucket).forEach(([b, list]) => push(j, b, `${plural(list.length, "waiting-on item")}: ${list.slice(0, 2).map(w => clip(w.waitingOn || w.text, 40)).join(", ")}`, oldest(list.map(w => w.since)), "", list.length));
    if (qs.length) { const b = qs.map(q => waitBucket(q.text)).find(x => x !== "Other" && x !== "Unspecified" && x !== "Homeowner / designer") || "Homeowner / designer"; push(j, b, `${plural(qs.length, "question")} unanswered since ${fmtMD(oldest(qs.map(q => q.since)) || today)}`, oldest(qs.map(q => q.since)), "", qs.length); }
    [["rough", "Rough"], ["finish", "Finish"]].forEach(([p, L]) => { if (effStatus(j, p) === "waiting") push(j, "On hold", `${L} on hold`, toDateAny(j[p + "StatusDate"])); });
    if (j.flagged) push(j, "Us (office owes the field)", `flagged${j.flagNote ? ` — ${clip(stripHtml(j.flagNote), 60)}` : ""}`, toDateAny(j.flaggedAt));
    const cos = arr(j.changeOrders).filter(CO_OPEN_APPROVED);
    if (cos.length) push(j, "Sold work not on the calendar", `${plural(cos.length, "approved CO")}, no date`, oldest(cos.map(c => toDateAny(c.createdAt) || toDateAny(c.id))), "", cos.length);
    const rts = arr(j.returnTrips).filter(rt => rt && !rt.signedOff && rt.rtStatus === "needs" && !toDateAny(rt.rtStatusDate) && !toDateAny(rt.scheduledDate));
    if (rts.length) push(j, "Sold work not on the calendar", `${plural(rts.length, "return trip")} with no date${rts[0].scope ? ` — ${clip(stripHtml(rts[0].scope), 40)}` : ""}`, oldest(rts.map(r => toDateAny(r.createdAt) || toDateAny(r.date))), "", rts.length);
  });
  const liveById = new Map(live.map(j => [j.id, j]));
  arr(needs).forEach(n => {
    if (!n || n.status === "done" || n.voided || n.kind === "bodies") return;
    if (!OFFICE_NAMES.test(String(n.assignedTo || ""))) return;
    const c = toDateAny(n.createdAt); if (!c || daysBetween(today, c) < 5) return;
    const j = liveById.get(n.jobId) || live.find(x => x.name === n.jobName);
    const target = j || { id: `need_${n.id}`, name: n.jobName || "(no job)" };
    push(target, "Us (office owes the field)", `${clip(stripHtml(n.text), 70)} (${String(n.createdBy || "").split(" ")[0] || "crew"})`, c, String(n.assignedTo || "").split(" ")[0], 1);
  });
  // One line per job per audience: among the "waiting on someone else" groups the group with the largest
  // summed item count (each entry's n = underlying waiting items / questions) wins; ties → GROUP_ORDER. "Us" and "Sold work" are their own audiences and additive — a job can sit in one
  // waiting group AND under Us AND under Sold work, never twice within the waiting groups.
  const US = "Us (office owes the field)", SOLD = "Sold work not on the calendar";
  const groups = new Map(GROUP_ORDER.map(g => [g, []])), keys = [], byGroup = {};
  perJob.forEach((items, jobId) => {
    const jobName = items[0].jobName || jobId;
    const sold = items.filter(i => i.group === SOLD), us = items.filter(i => i.group === US), rest = items.filter(i => i.group !== SOLD && i.group !== US);
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
  return { groups: outGroups, cleared, keys, total: keys.length, byGroup, firstRun };
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
  live.forEach(j => { const s = ["rough", "finish"].map(p => { const st = effStatus(j, p); if (STARTED_ST.has(st) || pctOf(j, p) > 0) return null; const d = toDateAny(j[p + "ProjectedStart"]); return d && ymd(d) > after ? { p, d, c: !!j[p + "StartConfirmed"] || ["scheduled", "date_confirmed"].includes(st) } : null; }).filter(Boolean)[0];
    if (s && !(s.p === "finish" && effStatus(j, "rough") !== "complete")) rows.push({ name: j.name, customer: j.customer || "", date: s.d, confirmed: s.c, note: `${s.p} start`, followUpDays: null, sales: "" }); });
  const dated = rows.filter(r => r.date && ymd(r.date) > after).sort((a, b) => a.date - b.date);
  const weeks = []; dated.forEach(r => { const wk = ymd(mondayOf(r.date)); let w = weeks.find(x => x.ymd === wk); if (!w) { w = { ymd: wk, label: `Week of ${fmtMD(toDateAny(wk))}`, rows: [] }; weeks.push(w); } w.rows.push(r); });
  const noDate = rows.filter(r => !r.date);
  // Upcoming (not-yet-live) rows dated inside next week belong in §4.3 Starts; ones dated before next Monday are overdue follow-ups.
  const upRows = rows.filter(r => r.upcoming && r.date);
  const startsNextWeek = upRows.filter(r => weekYmds.includes(ymd(r.date)));
  const overdue = upRows.filter(r => ymd(r.date) < weekYmds[0]).map(r => ({ name: r.name, customer: r.customer, date: r.date, confirmed: r.confirmed }));
  // In prep: a start AFTER next week (next week's starts are already in §4.3) but inside 21 days, phase not started.
  const prep = live.filter(j => { const ph = ["rough", "finish"].find(p => { const st = effStatus(j, p); return !(STARTED_ST.has(st) || pctOf(j, p) > 0); }); const d = ph && toDateAny(j[ph + "ProjectedStart"]); return d && ymd(d) > after && daysBetween(d, today) <= 21; }).map(j => { const p = prepOf(j); return { name: j.name, done: p.done, missing: p.missing }; });
  const cutoff = addDays(today, -7);
  const findings = arr(agentFindings).filter(f => f && toDateAny(f.createdAt) && toDateAny(f.createdAt) >= cutoff).sort((a, b) => toDateAny(b.createdAt) - toDateAny(a.createdAt)).slice(0, CAPS.findings).map(f => ({ type: f.type, summary: clip(stripHtml(f.summary), 90) }));
  const freeing = live.filter(j => (effStatus(j, "finish") === "inprogress" && pctOf(j, "finish") >= 90) || isRti(j)).map(j => ({ name: j.name, foreman: hasForeman(j) ? j.foreman : "" }));
  const twoWeeks = ymd(addDays(today, 14));
  const startsSoon = cls.starts.length + startsNextWeek.length + dated.filter(r => ymd(r.date) <= twoWeeks).length;
  return { error: false, weeks: weeks.slice(0, 6), noDate, prep, findings, freeing, startsSoon, startsNextWeek, overdue, quotes: null };
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
  const totalsOf = (j) => (simproTotalsById || {})[snOf(j)] || null;
  const marginOf = (j) => { const t = totalsOf(j); if (t && typeof t.margin === "number") return Math.round(t.margin * 10) / 10; return (typeof j.simproMargin === "number" && isFinite(j.simproMargin)) ? Math.round(j.simproMargin * 10) / 10 : null; };
  const rti = live.filter(isRti).map(j => { const t = totalsOf(j), rd = toDateAny(j.readyToInvoiceDate), m = marginOf(j);
    return { name: j.name, foreman: hasForeman(j) ? j.foreman : "", dollars: t && typeof t.total === "number" ? t.total : null, idleDays: rd ? Math.max(0, daysBetween(today, rd)) : null, margin: m, flag: m == null ? "" : m < 0 ? "negative margin, check Simpro costs" : m < MARGIN_TARGET ? `${Math.round((MARGIN_TARGET - m) * 10) / 10} pts under` : "" }; })
    .sort((a, b) => (b.dollars || 0) - (a.dollars || 0) || (b.idleDays || 0) - (a.idleDays || 0));
  const known = rti.filter(r => r.dollars != null);
  const rows = live.filter(isFinishingOpen).map(j => ({ jobId: j.id, name: j.name, margin: marginOf(j), stage: `finish ${pctOf(j, "finish")}%` })).filter(r => r.margin != null).sort((a, b) => a.margin - b.margin);
  const firstRun = !prevMargin || typeof prevMargin !== "object";
  const movers = firstRun ? [] : rows.filter(r => typeof prevMargin[r.jobId] === "number" && Math.abs(r.margin - prevMargin[r.jobId]) >= 3).map(r => ({ name: r.name, from: prevMargin[r.jobId], to: r.margin, delta: Math.round((r.margin - prevMargin[r.jobId]) * 10) / 10 })).sort((a, b) => a.delta - b.delta).slice(0, CAPS.movers);
  const weekAgo = addDays(today, -7);
  const approved = []; live.forEach(j => arr(j.changeOrders).forEach(co => { if (!co || String(co.coStatus).toLowerCase() !== "approved") return; const d = toDateAny(co.coStatusSyncedAt) || toDateAny(co.coStatusDate); if (!d || d < weekAgo) return; approved.push({ name: j.name, quote: String(co.quoteNumber || "").trim(), desc: clip(stripHtml(co.desc || co.task), 50), dated: !!co.scheduledDate }); }));
  const marginByJob = {}; rows.forEach(r => { marginByJob[r.jobId] = r.margin; });
  return { error: false, rti: { rows: rti.slice(0, CAPS.rti), more: Math.max(0, rti.length - CAPS.rti), count: rti.length, total: known.reduce((s, r) => s + r.dollars, 0), knownCount: known.length },
    margin: { median: median(rows.map(r => r.margin)), count: rows.length, underCount: rows.filter(r => r.margin < MARGIN_TARGET).length, rows: rows.slice(0, 15), movers, firstRun },
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
  const finished = all.filter(j => (j.finishStatus === "complete" || parseInt(j.finishStage) === 100) && inWin(j.finishStatusDate)).map(j => j.name);
  let inspPassed = 0, inspFailed = 0, cosCreated = 0, cosApproved = 0, cosConverted = 0, rtCreated = 0, punchClosed = 0, qAsked = 0, qAnswered = 0;
  all.forEach(j => {
    ["roughInspectionAttempts", "finalInspectionAttempts"].forEach(k => arr(j[k]).forEach(a => { if (a && inWin(a.date)) { if (a.result === "fail") inspFailed++; else if (a.result) inspPassed++; } }));
    arr(j.changeOrders).forEach(co => { if (!co) return; if (inWin(co.createdAt)) cosCreated++; const sd = co.coStatusSyncedAt || co.coStatusDate; if (inWin(sd) && String(co.coStatus).toLowerCase() === "approved") cosApproved++; if (inWin(sd) && String(co.coStatus).toLowerCase() === "converted") cosConverted++; });
    arr(j.returnTrips).forEach(rt => { if (rt && inWin(rt.createdAt || rt.date)) rtCreated++; });
    ["roughPunch", "finishPunch", "qcPunch"].forEach(k => walkPunch(j[k], i => { if (i.done && !i.voided && inWin(i.checkedAtTs || i.checkedAt)) punchClosed++; }));
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
  const m = {
    heading: `Friday Strategy Prep — ${meeting.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,   // the doc title; the body carries no heading (it is pasted under Google's own)
    preLine: `pre-filled Fri 6:00 AM MT from the crew app · next week Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])} · booked = Simpro + planner as of 6:00 AM · details live in the app`,
    weekLabel: `Mon ${fmtMD(weekDays[0])} – Fri ${fmtMD(weekDays[4])}`, meetingYmd: ymd(meeting), todayYmd: ymd(today),
    carried: { error: false, fromLabel: "", rows: [] }, headline: [], schedule: { error: true }, blocked: { error: true }, coming: { error: true }, money: { error: true }, qc: { error: true }, lastWeek: { error: true }, counts: {}, nextState: null,
  };
  const prev = I.prevState && typeof I.prevState === "object" ? I.prevState : null;
  const prevFallback = () => prev ? { blockerKeys: arr(prev.blockerKeys), marginByJob: prev.marginByJob || {}, dates: prev.dates || {}, userIds: arr(prev.userIds), weeks: arr(prev.weeks) } : null;
  try { m.carried = parseNotesCarry(I.notesDoc, meeting); } catch (e) { m.carried = { ...ERR(e), fromLabel: "", rows: [] }; }
  let live = [];
  try { if (!Array.isArray(I.jobs)) throw new Error("jobs missing"); live = liveJobs(I.jobs); } catch (e) { const err = ERR(e); m.schedule = err; m.blocked = err; m.coming = err; m.money = err; m.qc = err; m.lastWeek = err; m.nextState = prevFallback(); return m; }
  let cls = { booked: [], idle: [], starts: [], onHold: [], between: [] }, idx = null;
  try {
    idx = buildScheduleIndex(Array.isArray(I.scheduleEntries) ? I.scheduleEntries : [], I.plannerDoc, live, weekYmds); idx.simproOk = I.simproOk !== false && Array.isArray(I.scheduleEntries);
    cls = classifySchedule(live, idx, weekYmds, today);
    const mv = movedDates(live, prev && prev.dates, today);
    const people = peopleRows({ users: I.users, pto: I.pto, timeOffRequests: I.timeOffRequests, needs: I.needs, prevUserIds: prev ? prev.userIds : null, idx, weekDays, today });
    m.schedule = { error: false, booked: cls.booked.slice(0, CAPS.booked), bookedMore: Math.max(0, cls.booked.length - CAPS.booked), idle: cls.idle, starts: cls.starts, onHold: cls.onHold, between: cls.between, moved: mv.rows, passed: mv.passed, movedFirstRun: mv.firstRun,
      calendar: calendarRows(live, I.calendarEvents, weekYmds).slice(0, CAPS.calendar), people, conflicts: conflictRows(idx, I.pto, weekYmds), unknownSimpro: idx.unknownSimpro, simproOk: idx.simproOk, plannerPresent: idx.plannerPresent };
  } catch (e) { m.schedule = ERR(e); }
  try { m.blocked = { error: false, ...blockedRows({ live, needs: I.needs, users: I.users, prevBlockerKeys: prev ? prev.blockerKeys : null, today }) }; } catch (e) { m.blocked = ERR(e); }
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
    if (!m.schedule.error) { const s = m.schedule, risk = s.starts.filter(x => !x.crewBooked).length; H.push(`Next week: ${plural(cls.booked.length, "job")} crewed · ${s.idle.length} in progress with nobody booked · ${plural(s.starts.length, "start")}${risk ? `, ${risk} with no crew` : ""}.`); }
    if (!m.blocked.error) { const parts = GROUP_ORDER.filter(g => m.blocked.byGroup[g]).map(g => `${m.blocked.byGroup[g]} on ${g.replace(" (office owes the field)", "").toLowerCase()}`); H.push(`${plural(m.blocked.total, "job")} blocked${parts.length ? `: ${parts.join(", ")}` : ""}.`); }
    if (!m.money.error) { const r = m.money.rti, g = m.money.margin; H.push(`${r.count ? `${fmtMoney(r.total)}${r.knownCount < r.count ? "+" : ""} ready to bill on ${plural(r.count, "job")}` : "Nothing ready to bill"}${g.median != null ? ` · margin at finish median ${g.median}% vs ${MARGIN_TARGET}%, ${g.underCount} under` : ""}.`); }
    m.headline = H;
  } catch (e) { m.headline = []; }
  m.counts = { live: live.length, booked: cls.booked.length, idle: cls.idle.length, starts: m.schedule.error ? cls.starts.length : m.schedule.starts.length, onHold: cls.onHold.length, between: cls.between.length, blocked: m.blocked.error ? null : m.blocked.total, rti: m.money.error ? null : m.money.rti.count, qc: m.qc.error ? null : m.qc.rows.length, carried: m.carried.rows.length };
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
    if (!p.bullet) { const t = p.text.replace(/^[*_]+|[*_]+$/g, "").trim(); if (!t) continue; if (CARRY_SECTION.test(t)) { list = "carry"; struckNest = null; parent = null; continue; } if (SKIP_SECTION.test(t) || /^attendees/i.test(t)) { list = "skip"; continue; } if (list === "carry") list = null; continue; }
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
  const rows = items.map(text => { const k = normText(text); let weeks = 1; for (const set of earlier) { if (set.has(k) || [...set].some(x => x && (k.includes(x) || x.includes(k)))) weeks++; else break; } return { text, weeks }; });
  return { error: false, fromLabel: secs[0].label, rows: rows.slice(0, CAPS.carried) };
}

// ── lines for the Docs API (consumed by foremanMeetingPrep.docsRequests) ─────
const RED = [0.72, 0.14, 0.14], GREEN = [0.12, 0.48, 0.3], AMBER = [0.71, 0.33, 0.1], BLUE = [0.18, 0.4, 0.77];
function renderLines(m) {
  const L = [];
  const H3 = (t) => L.push({ text: t, kind: "h3" }), H4 = (t) => L.push({ text: t, kind: "h4" });
  const P = (t) => L.push({ text: t, kind: "p" }), G = (t) => L.push({ text: t, kind: "grey" }), C = (t) => L.push({ text: t, kind: "check" });
  const B = (t, spans) => L.push({ text: t, kind: "bullet", spans: spans || [] });
  const tag = (word, rgb, rest) => { B(`${word} ${rest}`, [{ start: 0, len: word.length, rgb, bold: true }]); };
  const fail = (sec) => G(typeof sec.error === "string" ? sec.error : "Section unavailable this week.");
  const more = (n) => { if (n > 0) G(`…and ${n} more in the app`); };
  const who = (r) => [r.foreman, r.lead && r.lead !== r.foreman ? r.lead : ""].filter(Boolean).join(" · ");
  const age = (n) => n == null ? "no date" : `${n}d`;
  const sec = (fallback, fn) => { const start = L.length; try { fn(); } catch (e) { L.length = start; H3(fallback); G(`Section could not be rendered: ${(e && e.message) || e}`); } };
  const prepShort = (xs) => xs.map(x => x.replace(/ Received| Up to Date| to App & SimPro| to Foreman/g, "")).join(", ");

  G(m.preLine);
  if (m.headline.length) m.headline.forEach(P);

  // Carried
  sec("Carried from last meeting", () => {
  H3(m.carried.fromLabel ? `Carried from ${m.carried.fromLabel.replace(/,\s*\d{4}$/, "")}` : "Carried from last meeting");   // "Carried from Oct 9" — the same heading Josh's notes use
  if (m.carried.error) fail(m.carried); else if (!m.carried.rows.length) G("Nothing carried.");
  else m.carried.rows.forEach(r => C(`${r.text}${r.weeks > 1 ? ` (carried ${r.weeks} wks)` : ""}`));
  });
  C("");

  // Schedule
  sec("Schedule next week", () => {
  H3(`Schedule next week · ${m.weekLabel}`);
  if (m.schedule.error) fail(m.schedule); else {
    const s = m.schedule;
    H4(`Booked${s.simproOk ? "" : " — Simpro unavailable; planner only"}${s.plannerPresent ? "" : " (no planner for next week; Simpro only)"}`);
    if (!s.booked.length) G("Nothing booked for next week yet (as of 6:00 AM).");
    s.booked.forEach(r => B(`${r.name} — ${r.phase}${r.pct ? ` ${r.pct}%` : ""} · ${r.days} · ${r.people.join(", ")}${r.qcNeeds ? " · QC after" : ""}${r.start ? ` · ${r.start.phase} start ${fmtMD(r.start.date)} ${r.start.confirmed ? "confirmed" : "projected"}` : ""}`));
    more(s.bookedMore);
    s.unknownSimpro.forEach(u => B(`Simpro #${u.pid} (not in app) · ${daysLabel(u.days)} · ${u.people.join(", ")}`));
    H4("In progress, nobody booked");
    if (!s.idle.length) G("Every in-progress job has crew next week.");
    s.idle.forEach(r => tag("NO CREW", RED, `${r.name} — ${r.phase} ${r.pct}% · last update ${r.lastUpdate ? fmtMD(r.lastUpdate) : "none on file"}${r.rti ? ` · ready to invoice ${age(r.rtiDays)}` : ""}${r.qcNeeds ? " · QC needs" : ""} · ${r.openPunch} punch${r.questions ? ` · ${plural(r.questions, "question")}` : ""}${r.waitBuckets.length ? ` · waiting: ${r.waitBuckets.slice(0, 2).join(", ")}` : ""}${!s.simproOk ? " (Simpro not checked)" : ""}`));
    H4("Starts");
    if (!s.starts.length) G("No starts dated inside next week.");
    s.starts.forEach(r => {
      if (r.pipeline) { tag("UPCOMING", AMBER, `${r.name} — ${r.phase} starts ${DAY_LBL[r.di]} ${fmtMD(r.date)} ${r.confirmed ? "confirmed" : "projected"} · not in the app yet · nobody booked`); return; }
      const chip = r.atRisk ? ["AT RISK", RED] : r.confirmed ? ["CONFIRMED", GREEN] : ["PROJECTED", AMBER];
      tag(chip[0], chip[1], `${r.name} — ${r.phase} starts ${DAY_LBL[r.di]} ${fmtMD(r.date)} ${r.confirmed ? "confirmed" : "projected"} · nobody booked${r.missingRoles.length ? ` · no ${r.missingRoles.join(", no ")}` : who(r) ? ` · ${who(r)}` : ""} · prep ${r.prep.done}/${r.prep.total}${r.prep.missing.length && r.prep.done < 5 ? ` (${prepShort(r.prep.missing)})` : ""}${r.elsewhere.length ? ` · ${r.elsewhere.join("; ")}` : ""}`);
    });
    H4("Dates that moved since last Friday");
    if (s.movedFirstRun) G("Tracking starts this week."); else if (!s.moved.length && !s.passed.length) G("Nothing moved.");
    s.moved.forEach(r => B(r.to === "no date" ? `${r.name} — ${r.label} ${r.from} → no date (cleared)` : `${r.name} — ${r.label} ${r.from} → ${r.to}${r.nth > 2 ? ` (${r.nth}${r.nth === 3 ? "rd" : "th"} date)` : ""}`));
    s.passed.forEach(r => tag("DATE PASSED", AMBER, `${r.name} — ${r.label} ${r.date}, status never moved`));
    H4("On the calendar");
    if (!s.calendar.length) G("No inspections, walks or scans dated next week.");
    s.calendar.forEach(r => B(`${DAY_LBL[r.di]} — ${r.label} · ${r.name}${r.who ? ` · ${r.who}` : ""}${r.ambiguous ? " (name match — check which job)" : ""}`));
    H4("People");
    const p = s.people;
    if (p.out.length) B(`Out: ${p.out.map(o => `${o.name} ${o.range}${o.note ? ` (${o.note})` : ""}`).join(" · ")}`); else B("Nobody out next week.");
    p.pending.forEach(r => B(`Pending request: ${r.name} · ${r.range}${r.requestedDays != null ? ` · asked ${r.requestedDays}d ago` : ""}`));
    p.bodies.forEach(r => B(`Bodies asked for: ${r.text}${r.job ? ` [${r.job}]` : ""} (${r.by}${r.ageDays != null ? `, ${r.ageDays}d ago` : ""})`));
    p.newUsers.forEach(u => B(`New on the team: ${u.name}${u.title ? ` · ${u.title}` : ""}`));
    B(`Capacity (booked / available): ${p.capacity.map(c => `${DAY_LBL[c.di]} ${c.booked}/${c.available}`).join(" · ")}`);
    if (s.conflicts.length) { H4("Conflicts"); s.conflicts.forEach(c => tag("CONFLICT", RED, c)); }
    if (s.onHold.length) G(`${plural(s.onHold.length, "job")} on hold listed under Blocked.`);
  }
  });
  C("");

  // Blocked
  sec("Blocked", () => {
  H3("Blocked — what we are waiting on, from whom, how long");
  if (m.blocked.error) fail(m.blocked); else {
    if (!m.blocked.groups.length) G("Nothing blocked.");
    m.blocked.groups.forEach(g => { H4(`${g.name} · ${g.rows.length + g.more}`); g.rows.forEach(r => B(`${r.name} — ${r.what}${r.who ? ` · ${r.who}` : ""} · ${age(r.ageDays)}`)); more(g.more); });
    if (m.blocked.cleared.length) { H4("Cleared since last Friday"); m.blocked.cleared.forEach(c => tag("CLEARED", GREEN, `${c.name} — ${c.group}`)); }
  }
  });
  C("");

  // Coming up
  sec("Coming up", () => {
  H3("Coming up · next 2–8 weeks");
  if (m.coming.error) fail(m.coming); else {
    const c = m.coming;
    if (!c.weeks.length) G("No dated starts after next week.");
    c.weeks.forEach(w => B(`${w.label} — ${w.rows.map(r => `${r.name}${r.customer ? ` (${r.customer})` : ""} ${fmtMD(r.date)} ${r.confirmed ? "confirmed" : "projected"}${r.note ? ` · ${r.note}` : ""}`).join(" · ")}`));
    if (arr(c.overdue).length) B(`Projected start passed, still in Upcoming: ${c.overdue.map(r => `${r.name} ${fmtMD(r.date)}`).join(", ")}`);
    if (c.noDate.length) B(`No date yet: ${c.noDate.map(r => `${r.name}${r.note ? ` (${r.note})` : ""}`).join(" · ")}`);
    if (c.prep.length) B(`In prep, start inside 3 weeks: ${c.prep.map(r => `${r.name} ${r.done}/5${r.missing.length ? ` (${prepShort(r.missing)})` : ""}`).join(" · ")}`);
    c.findings.forEach(f => B(`Plan intake: ${f.summary}`));
    B(`Crews freeing up (finish ≥ 90% or ready to invoice): ${c.freeing.length ? c.freeing.map(r => r.name).join(", ") : "none"} · starts in the next two weeks: ${c.startsSoon}`);
  }
  });
  C("");

  // Money
  sec("Money", () => {
  H3("Money");
  if (m.money.error) fail(m.money); else {
    const r = m.money.rti, g = m.money.margin, a = m.money.approved;
    H4(`Ready to invoice · ${r.count}`);
    if (!r.rows.length) G("Nothing ready to invoice.");
    r.rows.forEach(x => B(`${x.name}${x.foreman ? ` · ${x.foreman}` : ""}${x.dollars != null ? ` · ${fmtMoney(x.dollars)}` : ""}${x.idleDays != null ? ` · idle ${x.idleDays}d` : ""}${x.margin != null ? ` · ${x.margin}% margin` : ""}${x.flag ? ` · ${x.flag}` : ""}`, x.flag ? [{ start: 0, len: x.name.length, rgb: RED, bold: false }] : []));
    more(r.more);
    H4("Margin at finish");
    if (g.median == null) G("No margin data on finishing jobs."); else {
      B(`Median ${g.median}% across ${plural(g.count, "finishing job")} · target ${MARGIN_TARGET}% · ${g.underCount} under`);
      if (g.firstRun) G("Movers: tracking starts this week."); else if (!g.movers.length) G("No margin moved 3 points or more since last Friday.");
      g.movers.forEach(x => B(`${x.name} ${x.from}% → ${x.to}% (${x.delta > 0 ? "+" : ""}${x.delta})`));
    }
    H4(`Approved this week · ${a.count}`);
    if (!a.rows.length) G("No change orders approved this week.");
    a.rows.forEach(x => B(`${x.name}${x.quote ? ` #${x.quote}` : ""}${x.desc ? ` — ${x.desc}` : ""}`));
    if (a.count) B(`${a.undated} of ${a.count} not dated yet`);
  }
  });
  C("");

  // QC
  sec("QC to schedule", () => {
  H3("QC to schedule");
  if (m.qc.error) fail(m.qc); else { if (!m.qc.rows.length) G("Nothing waiting on a QC walk."); m.qc.rows.forEach(r => B(`${r.name}${r.foreman ? ` · ${r.foreman}` : ""} — ${r.why}${r.since ? ` since ${r.since}` : ""} · ${r.openPunch} punch open${r.small ? " · small — pics may do" : ""}`)); more(m.qc.more); }
  });
  C("");

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

module.exports = { TZ, MARGIN_TARGET, CAPS, DAY_LBL, SPECIAL_JOB, PREP_ITEMS, WAIT_BUCKETS, toDateAny, startOfDay, addDays, daysBetween, ymd, fmtShort, fmtMD, firstKey, personKey, plural, arr, clip, esc, stripHtml, fmtMoney, median,
  snOf, effStatus, pctOf, hasForeman, leadOf, liveJobs, walkPunch, openPunchCount, waitingItems, openQuestions, waitBucket, prepOf, weekOf, daysLabel, buildScheduleIndex, classifySchedule, docsRequests,
  dateKeys, movedDates, nextDates, calendarRows, peopleRows, conflictRows, isRoster, normName, overlapDays, blockedRows, GROUP_ORDER,
  buildModel, parseNotesCarry, renderLines, docParas, sectionsOf, carryItems, comingRows, moneyRows, qcRows, lastWeekRows, collectSimproCandidates, resolveRecipients, isFinishingOpen, isRti, mondayOf, EXTRA_RECIPIENTS };
