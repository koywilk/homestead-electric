// meetingModel.js — the Weekly Scramble on /dashboard › Meetings (SW v648, Koy 2026-11-17).
//
// Pure, CommonJS, no requires: App.js imports it and scripts/meeting-model-test.js drives
// the exact file that ships. Nothing here touches Firestore; it builds the rows each
// section shows from what the dashboard already holds (jobs, Upcoming, Needs-you flags)
// plus this week's Simpro bookings, and applies the meeting's own adds and hides.
//
// Saved data (all in /meetings, written by the tab with setDoc merge, field by field):
//   meetings/scramble_<Tuesday YYYY-MM-DD>   one per meeting week:
//     { type:"scramble", date, notes:{<sec>:text}, rowNotes:{<rowKey>:{<id>:{text,by,at}}},
//       actions:{<id>:{sec,text,who,due,by,at,needId,sentAt}}, carried:{<prevWeek>__<id>:"done"|"open"},
//       updated_at, saved_by }
//   meetings/scramble__prefs                 sticky across weeks:
//     { type:"scramble_prefs", hidden:{<sec>:{<rowKey>:{by,at}}}, added:{<id>:{sec,text,jobId,by,at}} }
"use strict";

const SECS = [
  ["schedule", "Schedule this week"],
  ["trips", "Small jobs and return trips"],
  ["waiting", "Waiting on"],
  ["upcoming", "Upcoming starts"],
  ["watches", "Open items from the watches"],
  ["material", "Upcoming material"],
  ["nextsteps", "Last Scramble's next steps"],
];
const ATTENDEES = ["Josh Cloward", "Koy Wilkinson", "Justin Cloward", "Brady Nelson"];
const WATCHES = ["Job issues watch", "CC and Simpro sync check"];
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; };
// "11/16/2026", "11/16/26", "2026-11-16" → Date at noon, else null
function anyDate(s) {
  const t = String(s || "").trim(); if (!t) return null;
  const iso = parseYmd(t.slice(0, 10)); if (iso) return iso;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (!m) return null;
  const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  return new Date(y, +m[1] - 1, +m[2], 12);
}
// The meeting week runs Monday to Sunday; the Scramble is that week's Tuesday.
function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
// The Scramble is the week's Tuesday; the Lead Meeting its Wednesday (v649).
function meetingDate(d, kind) { const m = weekStart(d); m.setDate(m.getDate() + ((CFG[kind] || CFG.scramble).dow - 1)); return ymd(m); }
function meetingId(dateYmd, kind) { return (CFG[kind] ? kind : "scramble") + "_" + dateYmd; }
function prevMeetingDate(dateYmd) { const d = parseYmd(dateYmd); d.setDate(d.getDate() - 7); return ymd(d); }
function weekRange(dateYmd, weeks) { const m = weekStart(parseYmd(dateYmd)); const e = new Date(m); e.setDate(e.getDate() + 7 * (weeks || 1) - 1); return { from: ymd(m), to: ymd(e) }; }
const shortDay = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
// A field-path-safe key (letters, digits, _), so it can sit in a dotted Firestore path.
const safeKey = (s) => String(s || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 80) || "x";
const firstOf = (n) => String(n || "").trim().split(/\s+/)[0] || "";

// Simpro schedule rows → { "<job no>": [{ d:"Mon 11/16", who:["Louis", …] }, …] }
// Two people with the same first name get their last initial ("James L.", "James C.").
function bookingsByJob(schedules) {
  const rows = (schedules || []).filter(s => s && s.Type === "job" && s.Reference && s.Date);
  const firsts = {};
  rows.forEach(s => { const n = (s.Staff && s.Staff.Name) || ""; const f = firstOf(n); (firsts[f] = firsts[f] || new Set()).add(n); });
  const label = (n) => { const f = firstOf(n); if ((firsts[f] || new Set()).size < 2) return f; const parts = String(n).trim().split(/\s+/); return f + " " + (parts[parts.length - 1] || "").charAt(0) + "."; };
  const out = {};
  rows.forEach(s => {
    const no = String(s.Reference).split("-")[0];
    const d = parseYmd(s.Date); if (!d) return;
    const byDay = (out[no] = out[no] || {});
    const k = s.Date;
    (byDay[k] = byDay[k] || { at: k, d: shortDay(d), who: [] });
    const w = label((s.Staff && s.Staff.Name) || "");
    if (w && !byDay[k].who.includes(w)) byDay[k].who.push(w);
  });
  const res = {};
  Object.keys(out).forEach(no => { res[no] = Object.values(out[no]).sort((a, b) => a.at < b.at ? -1 : 1); });
  return res;
}

const ACTIVE = ["inprogress", "scheduled", "date_confirmed"];
const jobNo = (j) => String((j && j.simproNo) || "").trim();
const pctOf = (s) => { const n = parseInt(s, 10); return isFinite(n) ? n : null; };

// The rows for every section. effRS / effFS are the app's effective phase status readers.
function buildSections(input) {
  const { jobs = [], upcoming = [], flags = [], schedules = [], today = new Date(), effRS, effFS } = input || {};
  const now = today.getTime();
  const book = bookingsByJob(schedules);
  const byNo = {}; jobs.forEach(j => { const n = jobNo(j); if (n) byNo[n] = j; });
  const S = { schedule: [], trips: [], waiting: [], upcoming: [], watches: [], material: [] };

  // 1 · Schedule: Rough / Finish jobs that are active or booked this week.
  const seen = new Set();
  jobs.forEach(j => {
    if (!j || j.archived || j.quickJob || j.tempPed) return;
    const no = jobNo(j); const days = no ? (book[no] || []) : [];
    const rs = effRS ? effRS(j) : j.roughStatus, fs = effFS ? effFS(j) : j.finishStatus;
    const phase = ACTIVE.includes(fs) ? "Finish" : ACTIVE.includes(rs) ? "Rough"
      : days.length ? (["complete", "invoice"].includes(rs) ? "Finish" : "Rough") : null;
    if (!phase) return;
    seen.add(no);
    const pct = pctOf(phase === "Finish" ? j.finishStage : j.roughStage);
    const st = phase === "Finish" ? fs : rs;
    S.schedule.push({ key: "s_" + safeKey(j.id), jobId: j.id, no, title: j.name || "", tag: phase + (j.division === "commercial" ? " · Commercial" : ""),
      pct, days, detail: !days.length ? "Nothing booked in Simpro this week" : st === "date_confirmed" ? "Start date set" : st === "scheduled" ? "Scheduled" : "" });
  });
  // Quick jobs / meters booked this week go under small jobs instead.
  S.schedule.sort((a, b) => (a.tag < b.tag ? 1 : a.tag > b.tag ? -1 : 0) || ((b.days.length ? 1 : 0) - (a.days.length ? 1 : 0)) || String(a.title).localeCompare(String(b.title)));

  // 2 · Small jobs and return trips that still need a crew, a date or scheduling.
  jobs.forEach(j => {
    if (!j || j.archived) return;
    const no = jobNo(j);
    (j.returnTrips || []).forEach((t, i) => {
      if (!t || t.signedOff || t.rtStatus === "complete") return;
      const who = String(t.assignedTo || "").trim(), date = t.rtStatusDate || t.scheduledDate || t.date || "";
      const scheduled = t.rtStatus === "scheduled" && date;
      if (scheduled && who) return;
      const scope = String(t.scope || t.task || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      S.trips.push({ key: "t_" + safeKey(j.id + "_" + (t.id || i)), jobId: j.id, no, title: (j.name || "") + " · trip " + (i + 1),
        tag: !who && !date ? "Needs crew + date" : !who ? "Needs a crew" : "Needs a date", detail: scope.slice(0, 160), days: [] });
    });
    if (j.quickJob) {
      const s = j.quickJobStatus || "new";
      if (["complete", "invoice"].includes(s)) return;
      const days = no ? (book[no] || []) : [];
      if (days.length) { S.trips.push({ key: "q_" + safeKey(j.id), jobId: j.id, no, title: j.name || "", tag: "Booked", detail: "", days }); return; }
      if (s !== "scheduled" && s !== "inprogress") S.trips.push({ key: "q_" + safeKey(j.id), jobId: j.id, no, title: j.name || "", tag: "Needs scheduling", detail: "Quick job", days: [] });
    }
  });
  S.trips.sort((a, b) => (a.tag === "Booked" ? 1 : 0) - (b.tag === "Booked" ? 1 : 0));

  // 3 · Waiting on: jobs on hold, and COs waiting on the GC 7+ days.
  jobs.forEach(j => {
    if (!j || j.archived || j.quickJob || j.tempPed) return;
    const no = jobNo(j);
    const rs = effRS ? effRS(j) : j.roughStatus, fs = effFS ? effFS(j) : j.finishStatus;
    if (rs === "waiting") S.waiting.push({ key: "h_" + safeKey(j.id) + "_r", jobId: j.id, no, title: j.name || "", tag: "On hold · Rough", detail: "", days: [] });
    if (fs === "waiting") S.waiting.push({ key: "h_" + safeKey(j.id) + "_f", jobId: j.id, no, title: j.name || "", tag: "On hold · Finish", detail: "", days: [] });
    (j.changeOrders || []).forEach((co, i) => {
      if (!co || co.coStatus !== "pending") return;
      const since = anyDate(co.coStatusDate) || anyDate(co.date);
      const days = since ? Math.floor((now - since.getTime()) / DAY) : null;
      if (days == null || days < 7) return;
      S.waiting.push({ key: "c_" + safeKey(j.id + "_" + (co.id || i)), jobId: j.id, no, title: (j.name || "") + " · CO " + (co.number || i + 1) + (co.description ? " " + String(co.description).slice(0, 60) : ""),
        tag: "CO waiting on GC", pct: days, detail: co.quoteNumber ? "Quote " + co.quoteNumber : "", days: [] });
    });
  });
  S.waiting.sort((a, b) => (b.pct || 0) - (a.pct || 0));

  // 4 · Upcoming starts: the next six weeks (and anything past its date that hasn't started).
  const horizon = now + 42 * DAY;
  upcoming.forEach(u => {
    if (!u) return;
    const d = anyDate(u.projectedStart || u.startDate);
    if (!d || d.getTime() > horizon) return;
    S.upcoming.push({ key: "u_" + safeKey(u.id), title: String(u.name || ""), tag: "Upcoming", when: d.getTime(), date: (d.getMonth() + 1) + "/" + d.getDate(), detail: String(u.notes || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim().slice(0, 140), days: [] });
  });
  jobs.forEach(j => {
    if (!j || j.archived || j.quickJob || j.tempPed) return;
    const rs = effRS ? effRS(j) : j.roughStatus, fs = effFS ? effFS(j) : j.finishStatus;
    [["Rough", rs, j.roughProjectedStart], ["Finish", fs, j.finishProjectedStart]].forEach(([ph, st, ps]) => {
      if (ACTIVE.slice(0, 1).includes(st) || ["complete", "invoice"].includes(st)) return;
      if (ph === "Finish" && !["complete", "invoice"].includes(rs) && !ps) return;
      const d = anyDate(ps); if (!d || d.getTime() > horizon || d.getTime() < now - 21 * DAY) return;
      S.upcoming.push({ key: "p_" + safeKey(j.id) + "_" + ph.charAt(0), jobId: j.id, no: jobNo(j), title: j.name || "", tag: ph, when: d.getTime(), date: (d.getMonth() + 1) + "/" + d.getDate(),
        detail: d.getTime() < now - DAY ? "Projected start has passed" : "", days: [] });
    });
  });
  S.upcoming.sort((a, b) => a.when - b.when);

  // 5 · Open items from the two watches (answered in the Claude tab).
  (flags || []).forEach(f => {
    if (!f || (f.status && f.status !== "open") || !WATCHES.includes(f.routine)) return;
    const j = f.jobNo ? byNo[String(f.jobNo)] : null;
    S.watches.push({ key: "f_" + safeKey(f.id || f.key), jobId: j ? j.id : "", no: f.jobNo || "", title: f.title || "", tag: f.routine, detail: "", days: [] });
  });

  // 6 · Material cards in the app that still need ordering (a card with lines on it).
  jobs.forEach(j => {
    if (!j || j.archived) return;
    [["Rough", j.roughMaterials], ["Finish", j.finishMaterials]].forEach(([ph, list]) => {
      (Array.isArray(list) ? list : []).forEach((c, i) => {
        if (!c || !c.needsOrder || c.ordered || c.pickedUp || c.deliveredToShop) return;
        // items is the card's text box (HTML, lines split by <br> / <div>)
        const text = String(c.items || "").replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>/gi, ", ").replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").replace(/(,\s*)+/g, ", ").replace(/,\s*-\s+/g, ", ").replace(/^[,\s-]+|[,\s]+$/g, "").trim();
        if (!text) return;
        S.material.push({ key: "m_" + safeKey(j.id + "_" + (c.id || ph + i)), jobId: j.id, no: jobNo(j), title: (j.name || "") + " · " + ph.toLowerCase() + " card", tag: "Needs ordering",
          detail: (c.source ? c.source + ": " : "") + text.slice(0, 160), days: [] });
      });
    });
  });
  return S;
}

// The meeting's own edits: sticky hides drop rows; sticky adds join the section.
function applyPrefs(rows, sec, prefs) {
  const hid = ((prefs && prefs.hidden) || {})[sec] || {};
  const kept = (rows || []).filter(r => !hid[r.key]);
  const added = Object.entries((prefs && prefs.added) || {}).filter(([, a]) => a && a.sec === sec)
    .sort((a, b) => String(a[1].at || "") < String(b[1].at || "") ? -1 : 1)
    .map(([id, a]) => ({ key: "a_" + safeKey(id), addedId: id, jobId: a.jobId || "", no: a.jobNo || "", title: a.text || "", tag: "Added", detail: a.by ? "Added by " + firstOf(a.by) : "", days: [] }));
  return { rows: kept.concat(added), hiddenCount: (rows || []).length - kept.length };
}

// Section 7: last week's action items, with what this week decided about each.
function carriedSteps(prevDoc, prevDate, thisDoc) {
  const acts = Object.entries((prevDoc && prevDoc.actions) || {}).filter(([, a]) => a && a.text)
    .sort((a, b) => String(a[1].at || "") < String(b[1].at || "") ? -1 : 1);
  const carried = (thisDoc && thisDoc.carried) || {};
  return acts.map(([id, a]) => {
    const k = safeKey(prevDate + "__" + id);
    return { key: k, actionId: id, sec: a.sec || "", title: a.text, who: a.who || "", due: a.due || "", sent: !!a.sentAt, status: carried[k] || "", from: a.carriedFrom || prevDate };
  });
}

// The Nov 10 Scramble's next steps (Granola, before this tab existed), so the first
// meeting in the app has a section 7. Used only while meetings/scramble_2026-11-10 is absent.
const SEED_2026_11_10 = { type: "scramble", date: "2026-11-10", seeded: true, actions: {
  s1: { text: "Get the Wi-Fi password from Brandon for the pump devices", who: "", at: "2026-11-10T23:00:00.000Z" },
  s2: { text: "Coordinate the wire order for Brandt", who: "Josh Cloward", at: "2026-11-10T23:00:01.000Z" },
  s3: { text: "Follow up on where Pierce stands", who: "Josh Cloward", at: "2026-11-10T23:00:02.000Z" },
  s4: { text: "Order other air switches on Amazon for Barry", who: "Josh Cloward", at: "2026-11-10T23:00:03.000Z" },
  s5: { text: "Decide holiday party vs. bonus", who: "", at: "2026-11-10T23:00:04.000Z" },
} };

// A My Day task id that is the same every time for the same action, so a double tap
// (or two people tapping) makes one task, never two.
function needIdFor(mtgId, actionId) { return "need_mtg_" + safeKey(mtgId) + "_" + safeKey(actionId); }


// ── Weekly Lead Meeting (SW v649, Koy 2026-11-17: "i want everything from the doc moved here") ──
// Wednesdays 6:30 AM. v650 (Koy 2026-11-18, "all recs go": "make it more accurate to what the last
// one, the doc, was"): the Nov 11 Doc's order, Notes, Highlight, Lowlight, Training, Schedule,
// Upcoming, Hours and margin, Crew out, Action items. The watches, Needs, Hiring and "When it comes
// up" sections are gone; a week that already has something typed in one of them still shows it, last.
const LEAD_SECS = [
  ["notes", "Notes"],
  ["highlight", "Highlight"],
  ["lowlight", "Lowlight"],
  ["training", "Training"],
  ["schedule", "Schedule"],
  ["upcoming", "Upcoming"],
  ["hours", "Hours and margin"],
  ["crewout", "Crew out"],
  ["nextsteps", "Action items"],
];
// v649 sections Koy cut on 2026-11-18. Shown only for a week whose record has something in them.
const LEAD_OLD = [["needs", "Needs"], ["hiring", "Hiring"], ["watches", "Open items from the watches"], ["whenup", "When it comes up"]];
const TYPED = ["notes", "highlight", "lowlight", "training", "needs", "hiring", "team"];
const FOREMAN_SECS = [["team", "Team check"], ["jobs", "Jobs"], ["guys", "Guys"], ["nextsteps", "Action items"]];
const LEAD_WATCHES = ["Asks watch", "Crew schedule watch"];
// ── Friday Strategy (SW v657, Koy 2026-11-19, owners meeting, Fridays 8:00) ──────────────────────
// The rows come from the Thursday-night prefill (functions/strategyMeeting.js, saved under
// meetings/strategy_<Friday>.prefill); Job numbers are read live (Job Costs + Simpro totals) and
// carry dollars. Everything on this page belongs to its week: hides, edits, adds, notes, items.
const STRATEGY_SECS = [
  ["top", "Top of the meeting"],
  ["schedule", "Schedule next week"],
  ["starts", "Starts next week"],
  ["trips", "Return trips needed"],
  ["needsdate", "Needs a date"],
  ["moved", "Dates that moved since last Friday"],
  ["oncal", "On the calendar next week"],
  ["numbers", "Job numbers"],
  ["out", "People out next week"],
  ["notes", "Notes"],
  ["nextsteps", "Action items"],
];
const CFG = {
  scramble: { dow: 2, label: "Weekly Scramble", when: "Tuesdays 4:00 PM", who: "Josh, Koy, Justin, Brady", secs: SECS, weeks: 1 },
  lead: { dow: 3, label: "Weekly Lead Meeting", when: "Wednesdays 6:30 AM", who: "Koy and the foremen and leads", secs: LEAD_SECS, weeks: 1 },
  foreman: { dow: 3, label: "Weekly Resi Foreman Meeting", when: "Wednesdays 7:00 AM", who: "Koy, Keegan, Daegan and Colby", secs: FOREMAN_SECS, weeks: 1 },
  strategy: { dow: 5, label: "Friday Strategy", when: "Fridays 8:00 AM", who: "Koy, Josh and Brady", secs: STRATEGY_SECS, weeks: 1 },
};
const sameName = (a, b) => { const x = String(a || "").trim().toLowerCase(), y = String(b || "").trim().toLowerCase(); return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " ")); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayHead = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + MON[d.getMonth()] + " " + d.getDate();
const monDay = (d) => MON[d.getMonth()] + " " + d.getDate();
// The Lead schedule runs from the meeting day to that week's Friday.
function leadRange(dateYmd) { const d = parseYmd(dateYmd); const f = weekStart(d); f.setDate(f.getDate() + 4); return { from: ymd(d), to: ymd(f > d ? f : d) }; }
// Did this week's record get anything typed into a section (notes, row notes, items, action items)?
function secHasContent(md, sec) {
  if (!md) return false;
  if (String((md.notes || {})[sec] || "").trim()) return true;
  if (Object.values(md.actions || {}).some(a => a && a.sec === sec && a.text)) return true;
  if (Object.values(md.added || {}).some(a => a && a.sec === sec)) return true;
  return false;
}
const MARGIN_FOREMEN = ["keegan", "daegan", "colby"];   // Koy's table order; everyone else after, A–Z
const num = (v) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const cleanStatus = (s) => String((s && typeof s === "object" ? s.untrusted : s) || "").replace(/^Job\s*-\s*/i, "").trim();

// One phase of a Job Costs row: net margin (sell − material − labor with overhead) ÷ sell, as the
// Job Costs page works it, plus hours / labor / material used vs bid. "not started" until the phase
// has real hours (10% of its bid hours), so a phase with a few hours in doesn't read 99%.
function phaseOf(r, p) {
  const est = num(r[p + "_hrsEst"]), used = num(r[p + "_hrsUsed"]), sell = num(r[p + "_sell"]);
  const matA = num(r[p + "_matAct"]), labA = num(r[p + "_labAct"]), matE = num(r[p + "_matEst"]), labE = num(r[p + "_labEst"]);
  if (!est && !used && !sell && !matA && !labA) return { state: "none", used, est };
  const pcts = { hrsPct: est > 0 ? Math.round(used / est * 100) : null, matPct: matE > 0 ? Math.round(matA / matE * 100) : null };
  const started = est > 0 ? used / est >= 0.1 : used > 0;
  if (!started) return { state: "not started", used, est, ...pcts };
  const m = sell > 0 ? Math.round((sell - matA - labA) / sell * 100) : null;
  const hrsPct = est > 0 ? Math.round(used / est * 100) : null, matPct = matE > 0 ? Math.round(matA / matE * 100) : null;
  const flags = [];
  [["hours", used, est], ["labor", labA, labE], ["materials", matA, matE]].forEach(([k, a, e]) => {
    if (!(e > 0)) return; const pct = Math.round(a / e * 100);
    if (pct > 100) flags.push({ k, pct, over: true }); else if (pct >= 90) flags.push({ k, pct, over: false });
  });
  return { state: "", m, used, est, hrsPct, matPct, flags };
}
const flagText = (ph, f) => {
  const o = f.filter(x => x.over), c = f.filter(x => !x.over), out = [];
  if (o.length) out.push({ over: true, text: ph + " over: " + o.map(x => x.k + " " + x.pct + "%").join(", ") });
  if (c.length) out.push({ over: false, text: ph + " close: " + c.map(x => x.k + " " + x.pct + "%").join(", ") });
  return out;
};

// The job table the Lead Meeting (Hours and margin) and the Foreman Meeting (Jobs) share (v650, v652):
// every active residential job with hours or material in, grouped by crew foreman (a jr. foreman's or
// lead's job sits with their foreman), Keegan, Daegan, Colby, then the rest A–Z, then No foreman;
// worst total margin first. Rough / finish from the Job Costs pull; total margin and status from Simpro.
function marginRows(input) {
  const { jobs = [], costs = [], totals = {}, users = [], effFS } = input || {};
  const byNo = {}; jobs.forEach(j => { const n = jobNo(j); if (n && (!byNo[n] || (byNo[n].archived && !j.archived))) byNo[n] = j; });
  const userBy = (n) => (users || []).filter(u => u && sameName(u.name, n));
  const boss = (name) => {
    const u = userBy(name).find(x => x.active !== false) || userBy(name)[0];
    if (!u) return String(name || "").trim();
    if (u.title !== "foreman" && u.foremanId) { const b = (users || []).find(x => x && x.id === u.foremanId); if (b && b.name) return b.name; }
    return u.name;
  };
  const out = [];
  (costs || []).forEach(r => {
    if (!r || r.no == null) return;
    const no = String(r.no).trim(), j = byNo[no];
    if (!j || j.archived || j.quickJob || j.tempPed || j.type === "quote" || j.division === "commercial") return;
    const fs = effFS ? effFS(j) : j.finishStatus;
    if (["complete", "invoice"].includes(fs)) return;
    const t = totals[no] || null;
    if (t && /^(invoiced|complete|archived)$/i.test(String(t.stage || ""))) return;
    if (!(num(r.rough_hrsUsed) || num(r.finish_hrsUsed) || num(r.rough_matAct) || num(r.finish_matAct))) return;
    const rough = phaseOf(r, "rough"), finish = phaseOf(r, "finish");
    const fm = j.foreman && !/^unassigned$/i.test(j.foreman) ? boss(j.foreman) : "";
    const total = t && typeof t.margin === "number" ? Math.round(t.margin) : null;
    const fl = flagText("Rough", rough.flags || []).concat(flagText("Finish", finish.flags || []));
    out.push({ key: "w_" + safeKey(no), jobId: j.id, no, title: j.name || r.name || "", group: fm || "No foreman", status: cleanStatus(t && t.status) || cleanStatus(r.status),
      rough, finish, total, totalEst: !!(t && t.isEstimate), flags: fl, over: fl.some(f => f.over), days: [] });
  });
  out.sort((a, b) => groupRank(a.group) - groupRank(b.group) || (groupRank(a.group) === 10 ? String(a.group).localeCompare(String(b.group)) : 0)
    || (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total || 0) - (b.total || 0) || (+a.no || 0) - (+b.no || 0));
  return out;
}
const groupRank = (g) => { const i = MARGIN_FOREMEN.indexOf(firstOf(g).toLowerCase()); return g === "No foreman" ? 99 : i >= 0 ? i : 10; };
// Koy's three foremen come first; every other group folds under "Others" on the Foreman Meeting.
const isMainGroup = (g) => groupRank(g) < 10;

// ── Weekly Resi Foreman Meeting (SW v652, Koy 2026-11-18: "This meeting is going to be with all three
// foremen, though, not individually"; "more about their specific jobs, their guys, maybe morale and
// margin numbers, rough numbers, like all the job numbers... not schedule or training"). Wednesdays 7:00.
// Team check (typed, this week only) · Jobs (marginRows) · Guys (each foreman's crew, a typed line each,
// this week only) · Action items (last week's come back for Done / Not done). Percentages and hours only.
function buildForemanSections(input) {
  const { users = [] } = input || {};
  const S = { team: [], jobs: marginRows(input), guys: [] };
  const tl = { jrforeman: "Jr. foreman", lead: "Lead", crew: "Crew" };
  MARGIN_FOREMEN.forEach(first => {
    const f = (users || []).find(u => u && u.active !== false && u.title === "foreman" && firstOf(u.name).toLowerCase() === first);
    if (!f) return;
    const rank = { jrforeman: 0, lead: 1, crew: 2 };
    (users || []).filter(u => u && u.active !== false && u.foremanId === f.id && u.access !== "contractor")
      .sort((a, b) => (rank[a.title] ?? 3) - (rank[b.title] ?? 3) || String(a.name).localeCompare(String(b.name)))
      .forEach(u => S.guys.push({ key: "g_" + safeKey(u.id), uid: safeKey(u.id), group: f.name, title: u.name, detail: tl[u.title] || "", days: [] }));
  });
  return S;
}

// Friday Strategy · Job numbers: the shared job table (marginRows: rough / finish net from Job Costs,
// total margin from Simpro, flags at 90%+ and over bid), every active job, worst total margin first,
// with the dollars the owners asked for: Simpro job total, and each phase's sell and profit
// (sell − material − labor with overhead, actual, the Job Costs page's math). A phase that hasn't
// started shows "not started" and no profit.
function strategyNumbers(input) {
  const { costs = [], totals = {} } = input || {};
  const costByNo = {}; (costs || []).forEach(r => { if (r && r.no != null) costByNo[String(r.no).trim()] = r; });
  const rows = marginRows(input).map(r => {
    const c = costByNo[r.no] || {}, t = totals[r.no] || {};
    const ph = (p, st) => {
      const sell = num(c[p + "_sell"]), mat = num(c[p + "_matAct"]), lab = num(c[p + "_labAct"]);
      return { sell: sell || null, profit: st && !st.state && sell ? Math.round(sell - mat - lab) : null, matUsed: Math.round(mat), matBid: Math.round(num(c[p + "_matEst"])) };
    };
    return { ...r, group: "", money: { total: typeof t.total === "number" ? Math.round(t.total) : null, rough: ph("rough", r.rough), finish: ph("finish", r.finish) } };
  });
  rows.sort((a, b) => (a.total == null ? 1 : 0) - (b.total == null ? 1 : 0) || (a.total || 0) - (b.total || 0) || (+a.no || 0) - (+b.no || 0));
  return rows;
}
// Crew-calendar items taken off the calendar and left open (scramble__prefs.cal.<key>.off) → Needs a date.
function parkedRows(jobs, cal) {
  const out = [];
  Object.entries(cal || {}).forEach(([k, p]) => {
    if (!p || !p.off || /~/.test(k)) return;
    let j = null, what = "";
    const m = /^j_(.+)_([rf])$/.exec(k);
    if (m) { j = (jobs || []).find(x => x && safeKey(x.id) === m[1]); what = m[2] === "f" ? "Finish" : "Rough-in"; }
    else if (/^t_/.test(k)) { j = (jobs || []).find(x => x && k.slice(2).startsWith(safeKey(x.id) + "_")); what = "Return trip"; }
    if (!j || j.archived) return;
    out.push({ key: "pk_" + safeKey(k), jobId: j.id, no: jobNo(j), title: j.name || "", tag: "Parked", bad: true,
      detail: `${what} taken off the crew calendar${p.by ? " by " + firstOf(p.by) : ""}${p.at ? " " + String(p.at).slice(5, 10).replace("-", "/") : ""}, still open`, days: [] });
  });
  return out;
}
function buildStrategySections(input) {
  const { prefill = null, jobs = [], calPrefs = null } = input || {};
  const P = (prefill && prefill.rows) || {};
  const S = {};
  STRATEGY_SECS.forEach(([k]) => { S[k] = (Array.isArray(P[k]) ? P[k] : []).filter(r => r && r.key).map(r => ({ ...r, days: [] })); });
  S.numbers = strategyNumbers(input);
  S.needsdate = S.needsdate.concat(parkedRows(jobs, calPrefs && calPrefs.cal));
  S.notes = [];
  return S;
}

function buildLeadSections(input) {
  const { jobs = [], needs = [], flags = [], schedules = [], upcoming = [], costs = [], totals = {}, names = {}, users = [], requests = [], pto = [],
    today = new Date(), meeting = "", effRS, effFS } = input || {};
  const now = today.getTime(), todayYmd = ymd(today), horizon = now + 42 * DAY;
  const byNo = {}; jobs.forEach(j => { const n = jobNo(j); if (n && (!byNo[n] || (byNo[n].archived && !j.archived))) byNo[n] = j; });
  const costByNo = {}; (costs || []).forEach(r => { if (r && r.no != null) costByNo[String(r.no).trim()] = r; });
  // A job's number + name, wherever the name is: Command Center, the Job Costs pull, Simpro.
  const nameOf = (no) => { const j = byNo[no]; return (j && j.name) || (costByNo[no] && costByNo[no].name) || names[no] || ""; };
  const S = { schedule: [], upcoming: [], hours: [], crewout: [], watches: [], whenup: [] };
  TYPED.forEach(k => { S[k] = []; });

  // Schedule: the meeting day to Friday, one heading a day, each job booked that day with its crew.
  const mtg = meeting || meetingDate(today, "lead"), rg = leadRange(mtg);
  const book = bookingsByJob(schedules);
  const byDay = {};
  Object.keys(book).forEach(no => book[no].forEach(dd => { if (dd.at >= rg.from && dd.at <= rg.to) (byDay[dd.at] = byDay[dd.at] || []).push({ no, who: dd.who }); }));
  for (let d = parseYmd(rg.from); ymd(d) <= rg.to; d.setDate(d.getDate() + 1)) {
    const k = ymd(d), list = (byDay[k] || []).sort((a, b) => b.who.length - a.who.length || (+a.no || 0) - (+b.no || 0));
    const group = dayHead(d);
    if (!list.length) { S.schedule.push({ key: "e_" + k, group, empty: true, title: "Nothing booked in Simpro yet.", days: [] }); continue; }
    list.forEach(x => { const j = byNo[x.no];
      S.schedule.push({ key: "b_" + k.replace(/-/g, "") + "_" + safeKey(x.no), group, jobId: j && !j.archived ? j.id : "", no: x.no, title: nameOf(x.no) || "Simpro job", tag: "", detail: x.who.join(", "), days: [] }); });
  }

  // Upcoming: Command Center rough / finish starts and the Upcoming list, six weeks out, past due marked.
  const seenNo = new Set();
  const push = (row, d, confirmed) => {
    const past = Math.floor((now - d.getTime()) / DAY);
    S.upcoming.push({ ...row, when: d.getTime(), date: monDay(d), detail: [monDay(d) + (confirmed ? " confirmed" : " projected"), row.detail].filter(Boolean).join(" · "),
      tag: past >= 1 && ymd(d) < todayYmd ? past + "d past" : row.tag, days: [] });
  };
  jobs.forEach(j => {
    if (!j || j.archived || j.quickJob || j.tempPed) return;
    const rs = effRS ? effRS(j) : j.roughStatus, fs = effFS ? effFS(j) : j.finishStatus;
    [["Rough", rs, j.roughProjectedStart, j.roughStartConfirmed], ["Finish", fs, j.finishProjectedStart, j.finishStartConfirmed]].forEach(([ph, st, ps, conf]) => {
      if (st === "inprogress" || ["complete", "invoice"].includes(st)) return;
      if (ph === "Finish" && !["complete", "invoice"].includes(rs) && !ps) return;
      const d = anyDate(ps); if (!d || d.getTime() > horizon || d.getTime() < now - 21 * DAY) return;
      seenNo.add(jobNo(j));
      push({ key: "p_" + safeKey(j.id) + "_" + ph.charAt(0), jobId: j.id, no: jobNo(j), title: j.name || "", tag: ph === "Finish" ? "Finish" : "" }, d, !!conf);
    });
  });
  upcoming.forEach(u => {
    if (!u) return;
    const d = anyDate(u.projectedStart || u.startDate); if (!d || d.getTime() > horizon) return;
    const raw = String(u.name || "").trim(), m = /^#?\s*(\d{3,6})\s*[-–:]\s*(.+)$/.exec(raw);
    const no = m ? m[1] : "", title = m ? m[2].trim() : raw;
    if (no && seenNo.has(no)) return;   // already listed from the job itself
    push({ key: "u_" + safeKey(u.id), no, title, tag: "" }, d, !!u.startConfirmed);
  });
  S.upcoming.sort((a, b) => a.when - b.when);

  // Hours and margin: the shared job table (marginRows, also the Foreman Meeting's Jobs).
  S.hours = marginRows({ jobs, costs, totals, users, effFS });
  const userBy = (n) => (users || []).filter(u => u && sameName(u.name, n));

  // Crew out, six weeks: field crew names and dates only (no notes, no office, no approval tags).
  // Dates are saved "11/20/2026" (anyDate reads both shapes). People out the same days share a line.
  const office = (n) => { const us = userBy(n); return us.some(u => u.title === "admin" || !u.title) || (us.length > 0 && us.every(u => u.active === false)); };
  const out = {};
  const addOut = (name, a, b) => {
    const s = anyDate(a), e = anyDate(b || a); if (!name || !s || !e) return;
    if (ymd(e) < todayYmd || s.getTime() > horizon || office(name)) return;
    const k = ymd(s) + "_" + ymd(e), o = (out[k] = out[k] || { s, e, names: [] });
    if (!o.names.some(n => sameName(n, name))) o.names.push(String(name).trim());
  };
  (requests || []).forEach(r => { if (r && r.status === "pending") addOut(r.name, r.start, r.end); });
  (pto || []).forEach(p => { if (p) addOut(p.name, p.start, p.end); });
  Object.keys(out).sort().forEach(k => { const o = out[k];
    S.crewout.push({ key: "o_" + safeKey(k), title: o.names.join(", "), tag: "", detail: rangeText(ymd(o.s), ymd(o.e)), start: ymd(o.s), days: [] }); });

  // Cut on 2026-11-18, kept only so a week that already used them still shows what was typed there.
  (flags || []).forEach(f => {
    if (!f || (f.status && f.status !== "open") || !LEAD_WATCHES.includes(f.routine)) return;
    if (/^myday-/i.test(String(f.key || "")) || /overlap/i.test(String(f.title || "")) || /overlap/i.test(String(f.key || ""))) return;
    const j = f.jobNo ? byNo[String(f.jobNo)] : null;
    S.watches.push({ key: "f_" + safeKey(f.id || f.key), jobId: j ? j.id : "", no: f.jobNo || "", title: f.title || "", tag: f.routine, detail: "", days: [] });
  });
  void needs;
  return S;
}
function rangeText(a, b) {
  const s = anyDate(a), e = anyDate(b || a); if (!s) return "";
  return !e || ymd(e) === ymd(s) ? monDay(s) : monDay(s) + "–" + monDay(e);
}

// Last meeting before this tab, from Koy's Doc (Nov 11): five notes, nothing else filled in.
const SEED_LEAD_2026_11_11 = { type: "lead", date: "2026-11-11", seeded: true, notes: { notes: [
  "Color matching outlets and switches on colored walls: always be asking what the customer wants",
  "References for hiring",
  "Need help Fridays",
  "What are the final dates for school? December 2nd",
  "Cut sheets folder for the parts we use, going into the app",
].join("\n") }, actions: {} };
// The record that stands in for a week saved before this tab existed (null when there is none).
function seedFor(kind, dateYmd) {
  if (kind === "scramble" && dateYmd === "2026-11-10") return SEED_2026_11_10;
  if (kind === "lead" && dateYmd === "2026-11-11") return SEED_LEAD_2026_11_11;
  return null;
}

// ── Prefills for the Scramble, the Lead and the Foreman Meetings (SW v665, Koy 2026-11-20: "all the meetings
// on the dashboard need pre fills") ─────────────────────────────────────────────────────────────────────
// The same rows the page builds live, saved once on meetings/<kind>_<date>.prefill ({at, by, rows:{sec:[…]}})
// the first time that week's meeting is opened, and again on "Prefill again". This week the live sections
// stay live; the sections people used to type from scratch (Lead: Highlight, Lowlight, Training; Foreman:
// Team check) start with suggestions from the app, kept as saved so they don't move mid-meeting. A past
// week reads its saved rows, so it shows what the meeting saw. Hides, edits and adds on suggestions belong
// to their week. Never writes a job, never touches Simpro.
const PREFILL_SECS = { scramble: [], lead: ["highlight", "lowlight", "training"], foreman: ["team"] };
const MAX_ROWS = 80;
// The foreman a person reports to (a jr. foreman's or lead's crew sits with their foreman).
function bossOf(users, name) {
  const us = (users || []).filter(u => u && sameName(u.name, name));
  const u = us.find(x => x.active !== false) || us[0];
  if (!u) return String(name || "").trim();
  if (u.title !== "foreman" && u.foremanId) { const b = (users || []).find(x => x && x.id === u.foremanId); if (b && b.name) return b.name; }
  return u.name;
}
const stripHtml = (t) => String(t || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const inWindow = (s, from, to) => { const d = anyDate(s); if (!d) return null; const k = ymd(d); return k >= from && k <= to ? d : null; };
// Inspection attempts on a job in the window: [{phase:"rough"|"final", result, d, items:[text], first}]
function inspAttemptsIn(j, from, to) {
  const out = [];
  [["rough", j.roughInspectionAttempts], ["final", j.finalInspectionAttempts]].forEach(([phase, list]) => {
    (Array.isArray(list) ? list : []).forEach((a, i) => {
      if (!a || !/^(pass|fail)$/.test(String(a.result || ""))) return;
      const d = inWindow(a.date, from, to); if (!d) return;
      out.push({ phase, result: a.result, d, i, items: (a.items || []).map(x => stripHtml(x && x.text)).filter(Boolean), first: i === 0 });
    });
  });
  return out;
}
const INSP = { rough: "rough (4-way) inspection", final: "final inspection" };

// Lead Meeting · Highlight, Lowlight, Training suggestions. The window is the last meeting to today.
function leadSuggestions(input) {
  const { jobs = [], costs = [], totals = {}, users = [], effFS, today = new Date(), meeting = "" } = input || {};
  const mtg = meeting || meetingDate(today, "lead");
  const from = prevMeetingDate(mtg), to = ymd(today) > mtg ? ymd(today) : mtg, todayYmd = ymd(today);
  const S = { highlight: [], lowlight: [], training: [] };
  const live = (jobs || []).filter(j => j && !j.archived && !j.tempPed && j.type !== "quote");
  live.forEach(j => {
    const no = jobNo(j), base = { jobId: j.id, no, title: j.name || "", days: [] };
    inspAttemptsIn(j, from, to).forEach(a => {
      const k = safeKey(j.id) + "_" + a.phase.charAt(0) + "_" + ymd(a.d).replace(/-/g, "") + "_" + a.i;
      if (a.result === "pass") S.highlight.push({ ...base, key: "hi_" + k, tag: "Passed " + a.phase, when: a.d.getTime(),
        detail: "Passed the " + INSP[a.phase] + (a.first ? " on the first try" : "") + ", " + shortDay(a.d) });
      else S.lowlight.push({ ...base, key: "lo_" + k, tag: "Failed " + a.phase, bad: true, when: a.d.getTime(),
        detail: "Failed the " + INSP[a.phase] + ", " + shortDay(a.d) + (a.items.length ? ": " + a.items.slice(0, 3).join("; ") : "") });
    });
    [["Rough-in", j.roughStatus, j.roughStatusDate], ["Finish", j.finishStatus, j.finishStatusDate]].forEach(([ph, st, sd]) => {
      if (!["complete", "invoice"].includes(st)) return;
      const d = inWindow(sd, from, to); if (!d) return;
      S.highlight.push({ ...base, key: "hd_" + safeKey(j.id) + "_" + ph.charAt(0), tag: ph + " done", when: d.getTime(), detail: ph + " finished " + shortDay(d) });
    });
    (j.returnTrips || []).forEach((t, i) => {
      if (!t) return;
      const done = t.signedOff || t.rtStatus === "complete";
      const scope = stripHtml(t.scope || t.task).slice(0, 120);
      if (done) { const d = inWindow(t.signedOffDate || t.rtStatusDate, from, to); if (d) S.highlight.push({ ...base, key: "ht_" + safeKey(j.id + "_" + (t.id || i)), title: (j.name || "") + " · trip " + (i + 1), tag: "Trip done", when: d.getTime(), detail: "Return trip finished " + shortDay(d) + (scope ? ": " + scope : "") }); return; }
      const d = anyDate(t.rtStatusDate || t.scheduledDate || t.date);
      if (d && ymd(d) < todayYmd) S.lowlight.push({ ...base, key: "lt_" + safeKey(j.id + "_" + (t.id || i)), title: (j.name || "") + " · trip " + (i + 1), tag: "Trip past its date", bad: true, when: d.getTime(),
        detail: "Was set for " + shortDay(d) + ", not finished" + (scope ? ": " + scope : "") });
    });
  });
  // Margin: the shared job table. Strong jobs are wins; losing money or over the bid are lowlights. Percentages only.
  const rows = marginRows({ jobs, costs, totals, users, effFS });
  rows.filter(r => r.total != null && r.total >= 30).sort((a, b) => b.total - a.total).slice(0, 3).forEach(r =>
    S.highlight.push({ key: "hm_" + safeKey(r.no), jobId: r.jobId, no: r.no, title: r.title, tag: "Strong margin", when: 0, detail: "Total margin " + r.total + "% in Simpro", days: [] }));
  rows.filter(r => r.over || (r.total != null && r.total < 0)).forEach(r => {
    const over = (r.flags || []).filter(f => f.over).map(f => f.text);
    S.lowlight.push({ key: "lm_" + safeKey(r.no), jobId: r.jobId, no: r.no, title: r.title, tag: r.total != null && r.total < 0 ? "Losing money" : "Over bid", bad: true, when: 0,
      detail: [r.total != null ? "Total margin " + r.total + "%" : "", over.join("; ")].filter(Boolean).join(" · "), days: [] });
  });
  S.highlight.sort((a, b) => (b.when || 0) - (a.when || 0));
  S.lowlight.sort((a, b) => (a.when === 0 ? 1 : 0) - (b.when === 0 ? 1 : 0) || (b.when || 0) - (a.when || 0));
  S.training = trainingIdeas({ jobs: live, meeting: mtg, today }).concat(appIdeas(input));
  Object.keys(S).forEach(k => { S[k] = S[k].slice(0, MAX_ROWS).map(({ when, ...r }) => r); });
  return S;
}


// Lead Meeting · Training ideas (Koy 2026-11-20: "yeah i want ideas for training pre filled"). Three to five
// topics from the last two weeks, each with a one-line why and the job it came from: what failed
// inspections called out, the same fix showing up on punch lists and return trips, what QC walks found,
// work that reads like it should have been a change order, then this week's standard (one crew guide a
// week, in turn). No names, no dollars.
const FIX_BUCKETS = [
  ["GFCI protection", /\bgf(c?i)s?\b|ground fault/i], ["Cover plates and trim", /\bcover ?plates?\b|\bplates?\b|trim rings?/i],
  ["Smoke and CO detectors", /\bsmokes?\b|\bdetectors?\b/i], ["Dimmers and switches", /\bdimmers?\b|\bswitch(es)?\b|3-way|three way/i],
  ["Recessed lights", /\bcans?\b|recessed|wafers?|downlights?/i], ["Outlets", /\boutlets?\b|receptacles?|\bplugs?\b/i],
  ["Panel labels", /\blabel(s|ing)?\b|panel schedule|directory/i], ["Fans", /\bfans?\b/i],
  ["Exterior lights", /exterior|outdoor|soffit|landscape/i], ["Under-cabinet and tape light", /under ?cabinet|tape ?light|led strip/i],
  ["Low voltage", /cat ?6|coax|low voltage|\bdata\b|network/i], ["Bonding and grounding", /\bbond(ing)?\b|\bground(ing)?\b/i],
];
const bucketOf = (t) => { const b = FIX_BUCKETS.find(([, re]) => re.test(t)); return b ? b[0] : ""; };
const CO_WORDS = /\b(add(ed|ing)?|extra|additional|new (outlet|light|circuit|switch)|customer (wants|asked|requested)|homeowner (wants|asked|requested)|owner (wants|asked)|relocat\w*|move[ds]? (the|a|an)?)\b/i;
// The crew guides behind the app's "?" buttons, one a week in turn (public/sops/<file>.html).
const STANDARDS = [
  ["jobstart", "Starting a job"], ["jobprep", "Job prep"], ["rough", "Rough-in"], ["homeruns", "Home runs"], ["underground", "Underground"],
  ["power", "Power and panels"], ["finish", "Finish"], ["lighting", "Lighting"], ["qc", "QC walks"], ["returntrips", "Return trips"],
  ["changeorders", "Change orders"], ["materials", "Material and POs"], ["photos", "Job photos"], ["questions", "Questions to the office"],
];
// Every punch item on a punch tree, done or not: { text, at }.
function punchItemsAll(punch) {
  const out = []; if (!punch || typeof punch !== "object") return out;
  const keys = ["upper", "main", "basement", ...((punch.extras || []).map(e => e && e.key).filter(Boolean))];
  const take = (i) => { if (i && typeof i === "object" && !i.voided) out.push({ text: stripHtml(i.text), at: i.addedAt || String(i.addedAtTs || "").slice(0, 10) }); };
  keys.forEach(k => { const fl = punch[k]; if (!fl || typeof fl !== "object") return;
    (fl.general || []).forEach(take); (fl.hotcheck || []).forEach(take); (fl.rooms || []).forEach(r => ((r && r.items) || []).forEach(take)); });
  return out;
}
function trainingIdeas(input) {
  const { jobs = [], meeting = "", today = new Date() } = input || {};
  const mtg = meeting || meetingDate(today, "lead");
  const to = ymd(today) > mtg ? ymd(today) : mtg;
  const from = (() => { const d = parseYmd(to); d.setDate(d.getDate() - 14); return ymd(d); })();
  const label = (j) => ((j && j.simproNo) ? "#" + j.simproNo + " " : "") + ((j && j.name) || "");
  const ideas = [];
  const fails = [], fixes = [], qc = [], co = [];
  (jobs || []).forEach(j => {
    if (!j || j.archived) return;
    inspAttemptsIn(j, from, to).filter(a => a.result === "fail").forEach(a => a.items.forEach(t => fails.push({ j, t, d: a.d, phase: a.phase })));
    const items = [];
    punchItemsAll(j.finishPunch).forEach(x => items.push({ ...x, src: "punch" }));
    punchItemsAll(j.qcPunch).forEach(x => { items.push({ ...x, src: "qc" }); });
    (j.returnTrips || []).forEach(t => { if (!t) return;
      const at = String(t.date || t.created_at || t.createdAt || "").slice(0, 10);
      const sc = stripHtml(t.scope || t.task); if (sc) items.push({ text: sc, at: anyDate(at) ? ymd(anyDate(at)) : "", src: "trip" });
      (Array.isArray(t.punch) ? t.punch : []).forEach(x => { const tx = stripHtml(typeof x === "string" ? x : x && x.text); if (tx) items.push({ text: tx, at: (x && x.addedAt) || "", src: "trip" }); }); });
    items.filter(x => x.text && x.at && x.at >= from && x.at <= to).forEach(x => {
      const b = bucketOf(x.text);
      if (b) fixes.push({ j, b, x });
      if (x.src === "qc") qc.push({ j, b, x });
      if (CO_WORDS.test(x.text)) co.push({ j, x });
    });
  });
  // 1 · Failed inspections: one idea per kind of item, the two most common.
  const fb = {};
  fails.forEach(f => { const b = bucketOf(f.t) || f.t.slice(0, 60); (fb[b] = fb[b] || []).push(f); });
  Object.entries(fb).sort((a, b) => b[1].length - a[1].length).slice(0, 2).forEach(([b, list]) => { const f = list[0];
    ideas.push({ key: "ti_in_" + safeKey(b), jobId: f.j.id, no: jobNo(f.j), title: "Inspection: " + (bucketOf(f.t) ? b : f.t.slice(0, 100)), tag: "Idea",
      detail: (list.length > 1 ? "Failed inspections called it out " + list.length + " times" : "A failed " + INSP[f.phase] + " called it out " + shortDay(f.d)) + ": “" + f.t.slice(0, 90) + "” · " + label(f.j) }); });
  // 2 · The same fix again and again: a kind of fix on 3+ items across 2+ jobs.
  const rb = {};
  fixes.forEach(f => { (rb[f.b] = rb[f.b] || []).push(f); });
  Object.entries(rb).map(([b, list]) => ({ b, list, jobsN: new Set(list.map(f => f.j.id)).size })).filter(g => g.list.length >= 3 && g.jobsN >= 2 && !fb[g.b])
    .sort((a, b) => b.list.length - a.list.length).slice(0, 2).forEach(g => {
      const by = {}; g.list.forEach(f => { by[f.j.id] = (by[f.j.id] || 0) + 1; });
      const top = g.list.find(f => f.j.id === Object.keys(by).sort((a, b) => by[b] - by[a])[0]).j;
      ideas.push({ key: "ti_rp_" + safeKey(g.b), jobId: top.id, no: jobNo(top), title: "Repeat fix: " + g.b, tag: "Idea",
        detail: g.list.length + " punch and return-trip items on " + g.jobsN + " jobs in two weeks, most on " + label(top) }); });
  // 3 · QC walks: the job whose walk found the most, and what kind.
  if (qc.length) {
    const by = {}; qc.forEach(f => { (by[f.j.id] = by[f.j.id] || []).push(f); });
    const list = Object.values(by).sort((a, b) => b.length - a.length)[0], j = list[0].j;
    const kinds = {}; list.forEach(f => { if (f.b) kinds[f.b] = (kinds[f.b] || 0) + 1; });
    const kind = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0];
    ideas.push({ key: "ti_qc_" + safeKey(j.id), jobId: j.id, no: jobNo(j), title: "QC walk: " + (kind ? kind.toLowerCase() : "what it caught"), tag: "Idea",
      detail: list.length + " QC item" + (list.length > 1 ? "s" : "") + " on " + label(j) + " in two weeks" + (kind ? ", most about " + kind.toLowerCase() : "") });
  }
  // 4 · Work that reads like added scope: catching a change order before it's done.
  if (co.length) { const f = co[0];
    ideas.push({ key: "ti_co", jobId: f.j.id, no: jobNo(f.j), title: "Catching change orders", tag: "Idea",
      detail: co.length + " punch or trip item" + (co.length > 1 ? "s read" : " reads") + " like added work, e.g. “" + f.x.text.slice(0, 80) + "” · " + label(f.j) }); }
  // 5 · This week's standard, always last.
  const wk = Math.floor(parseYmd(mtg).getTime() / (7 * DAY)), st = STANDARDS[((wk % STANDARDS.length) + STANDARDS.length) % STANDARDS.length];
  const out = ideas.slice(0, 4);
  out.push({ key: "ti_st_" + st[0], no: "", title: "This week's standard: " + st[1], tag: "Standard", sop: st[0],
    detail: "One crew guide a week, in turn. Go over the " + st[1].toLowerCase() + " guide together." });
  return out.map(r => ({ ...r, days: [] }));
}


// Lead Meeting · App training ideas (Koy 2026-11-20: "app training ideas as well"). One to three topics on
// using the Homestead app, tagged "App": what shipped for the field since the last meeting (the crew briefs,
// newer than the app version saved on last week's prefill), then app habits that look weak in the last two
// weeks (jobs in progress with no daily update, punch items open with nobody on them, open return trips with
// no material or PO, My Day tasks past due). Counts and job numbers, no names.
const OFFICE_HEAD = /office|owners|admins?\b|dashboard|crew calendar|meeting|scheduler/i;
function appIdeas(input) {
  const { jobs = [], needs = [], briefs = [], sinceVersion = 0, today = new Date() } = input || {};
  const todayYmd = ymd(today);
  const from = (() => { const d = parseYmd(todayYmd); d.setDate(d.getDate() - 14); return ymd(d); })();
  const label = (j) => ((j && j.simproNo) ? "#" + j.simproNo + " " : "") + ((j && j.name) || "");
  const ideas = [];
  // 1 · New for the field since last week's meeting.
  const fresh = (briefs || []).filter(b => b && b.v > (sinceVersion || 0)).slice(0, sinceVersion ? 20 : 3);
  const heads = [];
  // A bare "FIXED" heading belongs to whoever the brief's heading before it was for.
  fresh.forEach(b => { let office = false; (b.heads || []).forEach(h => { if (!h || !h.h) return;
    const bare = /^(NEW|FIXED|CHANGED|BETTER|REMOVED)\s*$/i.test(h.h.trim()); office = bare ? office : OFFICE_HEAD.test(h.h);
    if (!office && h.first) heads.push({ ...h, v: b.v }); }); });
  const headTitle = (h) => { const t = h.h.replace(/^(NEW|FIXED|CHANGED|BETTER|REMOVED)\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").replace(/^(on|in|for)\s+/i, "").trim();
    return t ? t.replace(/^./, c => c.toUpperCase()) : "What changed in v" + h.v; };
  heads.slice(0, 2).forEach(h => ideas.push({ key: "ta_new_" + h.v + "_" + safeKey(h.h).slice(0, 30), no: "", title: "App: " + headTitle(h),
    tag: "App", detail: "New in v" + h.v + ": " + h.first.slice(0, 140) }));
  // 2 · Habits.
  const live = (jobs || []).filter(j => j && !j.archived && !j.quickJob && !j.tempPed);
  const weekAgo = (() => { const d = parseYmd(todayYmd); d.setDate(d.getDate() - 7); return ymd(d); })();
  const noUpd = live.filter(j => [["roughStatus", "roughUpdates"], ["finishStatus", "finishUpdates"]].some(([st, up]) => {
    if (j[st] !== "inprogress") return false;
    const last = (j[up] || []).map(u => anyDate(u && u.date)).filter(Boolean).map(ymd).sort().pop() || "";
    return !last || last < weekAgo;
  }));
  const openTrips = [];
  live.forEach(j => (j.returnTrips || []).forEach((t, i) => { if (!t || t.signedOff || t.rtStatus === "complete") return;
    if (!stripHtml(t.material) && !/\bP\.?O\.?\s*#?\s*\d{3,6}\b/i.test(String(t.scope || "") + " " + String(t.material || ""))) openTrips.push({ j, i }); }));
  let unassigned = 0; const unByJob = {};
  live.forEach(j => [j.finishPunch, j.qcPunch].forEach(p => {
    const keys = p && typeof p === "object" ? ["upper", "main", "basement", ...((p.extras || []).map(e => e && e.key).filter(Boolean))] : [];
    keys.forEach(k => { const fl = p[k]; if (!fl) return; const all = [...(fl.general || []), ...(fl.hotcheck || []), ...((fl.rooms || []).flatMap(r => (r && r.items) || []))];
      all.forEach(it => { if (it && typeof it === "object" && !it.done && !it.voided && !String(it.assignedTo || "").trim() && (it.addedAt || "") && it.addedAt <= from) { unassigned++; unByJob[j.id] = (unByJob[j.id] || 0) + 1; } }); });
  }));
  const overdue = (needs || []).filter(n => n && n.status === "open" && n.dueDate && n.dueDate < todayYmd).length;
  const habits = [];
  if (noUpd.length) habits.push({ n: noUpd.length, row: { key: "ta_upd", jobId: noUpd[0].id, no: jobNo(noUpd[0]), title: "App: daily updates", tag: "App",
    detail: noUpd.length + " job" + (noUpd.length > 1 ? "s" : "") + " in progress with no daily update in a week, like " + label(noUpd[0]) } });
  if (unassigned) { const top = live.find(j => j.id === Object.keys(unByJob).sort((a, b) => unByJob[b] - unByJob[a])[0]);
    habits.push({ n: unassigned, row: { key: "ta_punch", jobId: top.id, no: jobNo(top), title: "App: putting someone on punch items", tag: "App",
      detail: unassigned + " punch item" + (unassigned > 1 ? "s" : "") + " open two weeks or more with nobody on them, most on " + label(top) } }); }
  if (openTrips.length) habits.push({ n: openTrips.length, row: { key: "ta_trip", jobId: openTrips[0].j.id, no: jobNo(openTrips[0].j), title: "App: material and POs on return trips", tag: "App",
    detail: openTrips.length + " open return trip" + (openTrips.length > 1 ? "s have" : " has") + " no material or PO written on it, like " + label(openTrips[0].j) + " trip " + (openTrips[0].i + 1) } });
  if (overdue) habits.push({ n: overdue, row: { key: "ta_myday", no: "", title: "App: closing out My Day tasks", tag: "App", detail: overdue + " My Day task" + (overdue > 1 ? "s are" : " is") + " past due and still open" } });
  habits.sort((a, b) => b.n - a.n).forEach(h => ideas.push(h.row));
  return ideas.slice(0, 3).map(r => ({ ...r, days: [] }));
}

// Who is out in a date range (approved time off and requests still waiting), field crew only.
function outIn(input, from, to) {
  const { requests = [], pto = [] } = input || {};
  const out = [];
  const add = (name, a, b, asked) => { const s = anyDate(a), e = anyDate(b || a); if (!name || !s || !e) return; if (ymd(e) < from || ymd(s) > to) return;
    out.push({ name: String(name).trim(), text: rangeText(ymd(s), ymd(e)) + (asked ? " (asked)" : "") }); };
  (requests || []).forEach(r => { if (r && r.status === "pending") add(r.name, r.start, r.end, true); });
  (pto || []).forEach(p => { if (p) add(p.name, p.start, p.end, false); });
  return out;
}

// Foreman Meeting · Team check suggestions: a line per foreman's crew on what the app shows this week
// (who is out, failed inspections since the last meeting, jobs over the bid or losing money), and a
// time-off note under each guy. Percentages and counts only.
function foremanSuggestions(input) {
  const { jobs = [], users = [], today = new Date(), meeting = "" } = input || {};
  const mtg = meeting || meetingDate(today, "foreman");
  const from = prevMeetingDate(mtg), to = ymd(today) > mtg ? ymd(today) : mtg;
  const wk = weekRange(mtg, 2);
  const out = outIn(input, ymd(today) > wk.from ? ymd(today) : wk.from, wk.to);
  const margin = marginRows(input);
  const team = [];
  MARGIN_FOREMEN.forEach(first => {
    const f = (users || []).find(u => u && u.active !== false && u.title === "foreman" && firstOf(u.name).toLowerCase() === first);
    if (!f) return;
    const crew = (users || []).filter(u => u && u.active !== false && (u.id === f.id || u.foremanId === f.id) && u.access !== "contractor");
    const away = out.filter(o => crew.some(u => sameName(u.name, o.name)));
    const fails = [];
    (jobs || []).forEach(j => { if (!j || j.archived || !j.foreman || !sameName(bossOf(users, j.foreman), f.name)) return;
      inspAttemptsIn(j, from, to).filter(a => a.result === "fail").forEach(a => fails.push((j.simproNo ? "#" + j.simproNo + " " : "") + (j.name || "") + " " + a.phase)); });
    const mine = margin.filter(r => sameName(r.group, f.name));
    const over = mine.filter(r => r.over), losing = mine.filter(r => r.total != null && r.total < 0);
    const bits = [];
    if (away.length) bits.push("Out: " + away.map(o => firstOf(o.name) + " " + o.text).join(", "));
    if (fails.length) bits.push(fails.length + " failed inspection" + (fails.length > 1 ? "s" : "") + " since last week (" + fails.slice(0, 3).join(", ") + ")");
    if (losing.length) bits.push(losing.length + " losing money (" + losing.slice(0, 3).map(r => "#" + r.no + " " + r.title).join(", ") + ")");
    if (over.length) bits.push(over.length + " over the bid (" + over.slice(0, 3).map(r => "#" + r.no + " " + r.title).join(", ") + ")");
    if (!bits.length) return;
    team.push({ key: "tc_" + safeKey(f.id), title: firstOf(f.name) + "'s crew", tag: fails.length || losing.length ? "Look at" : "", bad: !!(fails.length || losing.length), detail: bits.join(" · "), days: [] });
  });
  const guyNotes = {};
  out.forEach(o => { const u = (users || []).find(x => x && sameName(x.name, o.name)); if (u) (guyNotes[safeKey(u.id)] = guyNotes[safeKey(u.id)] || []).push("Out " + o.text); });
  return { team, guyNotes };
}

// The saved prefill: every section's rows for that week. Foreman Jobs is the Job Costs page itself
// and stays live, so it isn't saved. Rows are trimmed to plain data (no undefined) for Firestore.
function buildPrefill(kind, input) {
  const plain = (rows) => JSON.parse(JSON.stringify((rows || []).slice(0, MAX_ROWS)));
  const rows = {};
  if (kind === "scramble") {
    const S = buildSections(input);
    ["schedule", "trips", "waiting", "upcoming", "watches", "material"].forEach(k => { rows[k] = plain(S[k]); });
  } else if (kind === "lead") {
    const S = buildLeadSections(input), L = leadSuggestions(input);
    ["schedule", "upcoming", "hours", "crewout"].forEach(k => { rows[k] = plain(S[k]); });
    PREFILL_SECS.lead.forEach(k => { rows[k] = plain(L[k]); });
  } else if (kind === "foreman") {
    const S = buildForemanSections(input), F = foremanSuggestions(input);
    rows.team = plain(F.team);
    rows.guys = plain(S.guys.map(g => (F.guyNotes[g.uid] ? { ...g, detail: [g.detail, ...F.guyNotes[g.uid]].filter(Boolean).join(" · ") } : g)));
  }
  return { rows };
}
// v684 (Koy, 2026-11-19: "have each foremans job reports made for their jobs available to dive into", "Every active job"):
// the Foreman Meeting's Jobs rows open that job's reports from the Claude tab's Reports. Matched by job number.
// Owners-only reports never show here (the meeting is on screen for the foremen), nor ones with sharing off.
// Order: the newest Job Report first, then Margin Watch and post-rough-in, then the rest; newest first in each.
function reportRank(title) {
  const t = String(title || "");
  if (/job report/i.test(t)) return 0;
  if (/margin watch|post[\s-]?rough/i.test(t)) return 1;
  return 2;
}
function reportsForJob(reports, jobNo) {
  const no = String(jobNo == null ? "" : jobNo).replace(/^#/, "").trim();
  if (!no) return [];
  return (Array.isArray(reports) ? reports : [])
    .filter(r => r && String(r.jobNo || "").replace(/^#/, "").trim() === no && !r.ownersOnly && !r.shareOff && !r.archived)
    .sort((a, b) => (reportRank(a.title) - reportRank(b.title)) || (String(b.updatedAt || "") > String(a.updatedAt || "") ? 1 : String(b.updatedAt || "") < String(a.updatedAt || "") ? -1 : 0));
}
module.exports = { SECS, ATTENDEES, WATCHES, ymd, parseYmd, anyDate, meetingDate, meetingId, prevMeetingDate, weekRange, safeKey, firstOf,
  bookingsByJob, buildSections, applyPrefs, carriedSteps, SEED_2026_11_10, needIdFor,
  CFG, LEAD_SECS, LEAD_OLD, TYPED, LEAD_WATCHES, buildLeadSections, rangeText, seedFor, SEED_LEAD_2026_11_11, leadRange, secHasContent, phaseOf,
  FOREMAN_SECS, marginRows, buildForemanSections, isMainGroup, STRATEGY_SECS, strategyNumbers, parkedRows, buildStrategySections,
  PREFILL_SECS, leadSuggestions, foremanSuggestions, buildPrefill, outIn, trainingIdeas, STANDARDS, appIdeas, reportRank, reportsForJob };
