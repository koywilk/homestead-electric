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
// Wednesdays 6:30 AM. Live lists first (the Lead artifact's order), then the Doc's typed sections.
const LEAD_SECS = [
  ["watches", "Open items from the watches"],
  ["schedule", "Schedule, this week and next"],
  ["upcoming", "Upcoming and past due starts"],
  ["hours", "Hours vs bid"],
  ["crewout", "Crew out"],
  ["notes", "Notes"],
  ["highlight", "Highlight"],
  ["lowlight", "Lowlight"],
  ["training", "Training"],
  ["needs", "Needs"],
  ["hiring", "Hiring"],
  ["nextsteps", "Last week's action items"],
  ["whenup", "When it comes up"],
];
const TYPED = ["notes", "highlight", "lowlight", "training", "needs", "hiring"];
const LEAD_WATCHES = ["Asks watch", "Crew schedule watch"];
const CFG = {
  scramble: { dow: 2, label: "Weekly Scramble", when: "Tuesdays 4:00 PM", who: "Josh, Koy, Justin, Brady", secs: SECS, weeks: 1 },
  lead: { dow: 3, label: "Weekly Lead Meeting", when: "Wednesdays 6:30 AM", who: "Koy and the foremen and leads", secs: LEAD_SECS, weeks: 2 },
};
const KOY = "Koy Wilkinson";
const sameName = (a, b) => { const x = String(a || "").trim().toLowerCase(), y = String(b || "").trim().toLowerCase(); return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " ")); };
// Monday-to-Friday booked days only (the Lead Meeting's schedule grid).
const weekday = (dd) => !/^(Sat|Sun) /.test(dd.d);

function buildLeadSections(input) {
  const { jobs = [], needs = [], flags = [], schedules = [], upcoming = [], costs = [], requests = [], pto = [], today = new Date(), effRS, effFS } = input || {};
  const now = today.getTime(), todayYmd = ymd(today), horizon = now + 42 * DAY;
  const base = buildSections({ jobs, upcoming, flags: [], schedules, today, effRS, effFS });
  const byNo = {}; jobs.forEach(j => { const n = jobNo(j); if (n && (!byNo[n] || (byNo[n].archived && !j.archived))) byNo[n] = j; });
  const people = (j) => j ? [j.foreman && !/^unassigned$/i.test(j.foreman) ? "Foreman " + firstOf(j.foreman) : "", j.lead && !/^lead tbd$/i.test(j.lead) ? "Lead " + firstOf(j.lead) : ""].filter(Boolean).join(" · ") : "";
  const S = { watches: [], schedule: [], upcoming: base.upcoming, hours: [], crewout: [], whenup: [] };
  TYPED.forEach(k => { S[k] = []; });

  // 1 · Watches: Asks + Crew schedule, without My Day mirrors or Koy's own calendar-overlap flag.
  (flags || []).forEach(f => {
    if (!f || (f.status && f.status !== "open") || !LEAD_WATCHES.includes(f.routine)) return;
    if (/^myday-/i.test(String(f.key || "")) || /overlap/i.test(String(f.title || "")) || /overlap/i.test(String(f.key || ""))) return;
    const j = f.jobNo ? byNo[String(f.jobNo)] : null;
    S.watches.push({ key: "f_" + safeKey(f.id || f.key), jobId: j ? j.id : "", no: f.jobNo || "", title: f.title || "", tag: f.routine, at: String(f.firstSeen || f.updatedAt || ""), detail: "", days: [] });
  });
  S.watches.sort((a, b) => a.at < b.at ? -1 : 1);
  // …and My Day asks to Koy from someone else, past due first.
  (needs || []).forEach(n => {
    if (!n || n.status === "done" || !sameName(n.assignedTo, KOY) || !n.assignedBy || sameName(n.assignedBy, KOY)) return;
    const due = parseYmd(n.dueDate), late = due && ymd(due) < todayYmd;
    const j = n.jobId ? jobs.find(x => x && x.id === n.jobId) : null;
    S.watches.push({ key: "n_" + safeKey(n.id), jobId: j ? j.id : "", no: j ? jobNo(j) : "", title: String(n.text || "").replace(/<[^>]*>/g, " ").trim().slice(0, 160),
      tag: late ? "Past due" : "Ask from " + firstOf(n.assignedBy), detail: (late ? "Ask from " + firstOf(n.assignedBy) + " · " : "") + (due ? "due " + (due.getMonth() + 1) + "/" + due.getDate() : "no date"), days: [] });
  });

  // 2 · Schedule, this week and next: every job booked in Simpro, Monday–Friday, with its people from CC.
  const book = bookingsByJob(schedules);
  Object.keys(book).forEach(no => {
    const days = book[no].filter(weekday); if (!days.length) return;
    const j = byNo[no];
    S.schedule.push({ key: "b_" + safeKey(no), jobId: j ? j.id : "", no, title: j ? (j.name || "") : "Simpro #" + no, tag: "", detail: people(j), days, first: days[0].at });
  });
  S.schedule.sort((a, b) => a.first < b.first ? -1 : a.first > b.first ? 1 : String(a.title).localeCompare(String(b.title)));

  // 4 · Hours vs bid: a phase at 90%+ of its bid hours that isn't done (hours only, never margins).
  (costs || []).forEach(r => {
    const j = byNo[String(r && r.no)]; if (!j || j.archived) return;
    [["Rough", "rough", effRS], ["Finish", "finish", effFS]].forEach(([ph, p, eff]) => {
      const est = Number(r[p + "_hrsEst"]) || 0, used = Number(r[p + "_hrsUsed"]) || 0;
      if (est <= 0 || used / est < 0.9) return;
      const st = eff ? eff(j) : "";
      if (["complete", "invoice"].includes(st)) return;
      S.hours.push({ key: "w_" + safeKey(j.id) + "_" + p.charAt(0), jobId: j.id, no: jobNo(j), title: j.name || "", tag: ph, pct: Math.round(used / est * 100),
        detail: `${Math.round(used)} of ${Math.round(est)} bid hours` + (people(j) ? " · " + people(j) : ""), days: [] });
    });
  });
  S.hours.sort((a, b) => b.pct - a.pct);

  // 5 · Crew out, six weeks: requests waiting on Koy first, then approved time off.
  (requests || []).forEach(r => {
    if (!r || r.status !== "pending") return;
    S.crewout.push({ key: "r_" + safeKey(r.id), title: r.name || "", tag: "Needs Koy's approval", detail: rangeText(r.start, r.end) + (r.note ? " · " + String(r.note).slice(0, 80) : ""), start: r.start || "", days: [] });
  });
  const pend = S.crewout.length;
  (pto || []).forEach(p => {
    if (!p) return;
    const s = parseYmd(p.start), e = parseYmd(p.end || p.start); if (!s || !e) return;
    if (ymd(e) < todayYmd || s.getTime() > horizon) return;
    S.crewout.push({ key: "o_" + safeKey(p.id || (p.name + "_" + p.start)), title: p.name || "", tag: "Approved", detail: rangeText(p.start, p.end) + (p.note && p.note !== "Time off" ? " · " + String(p.note).slice(0, 80) : ""), start: p.start || "", days: [] });
  });
  const tail = S.crewout.slice(pend).sort((a, b) => a.start < b.start ? -1 : 1);
  S.crewout = S.crewout.slice(0, pend).sort((a, b) => a.start < b.start ? -1 : 1).concat(tail);

  // Folded · When it comes up: return trips missing a crew or date, failed inspections,
  // and jobs marked Scheduled that nobody is booked on this week or next.
  base.trips.filter(t => t.tag !== "Booked" && /^t_/.test(t.key)).forEach(t => S.whenup.push(t));
  jobs.forEach(j => {
    if (!j || j.archived) return;
    const no = jobNo(j);
    if (j.roughInspectionResult === "fail") S.whenup.push({ key: "i_" + safeKey(j.id) + "_r", jobId: j.id, no, title: j.name || "", tag: "Failed rough inspection", detail: people(j), days: [] });
    if (j.finalInspectionResult === "fail") S.whenup.push({ key: "i_" + safeKey(j.id) + "_f", jobId: j.id, no, title: j.name || "", tag: "Failed final inspection", detail: people(j), days: [] });
    if (j.quickJob || j.tempPed) return;
    const rs = effRS ? effRS(j) : j.roughStatus, fs = effFS ? effFS(j) : j.finishStatus;
    if ((rs === "scheduled" || fs === "scheduled") && no && !(book[no] || []).length)
      S.whenup.push({ key: "x_" + safeKey(j.id), jobId: j.id, no, title: j.name || "", tag: "Scheduled, nobody booked", detail: (fs === "scheduled" ? "Finish" : "Rough") + (people(j) ? " · " + people(j) : ""), days: [] });
  });
  return S;
}
function rangeText(a, b) {
  const s = parseYmd(a), e = parseYmd(b || a); if (!s) return "";
  const f = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (d.getMonth() + 1) + "/" + d.getDate();
  return !e || ymd(e) === ymd(s) ? f(s) : f(s) + " – " + f(e);
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
module.exports = { SECS, ATTENDEES, WATCHES, ymd, parseYmd, anyDate, meetingDate, meetingId, prevMeetingDate, weekRange, safeKey, firstOf,
  bookingsByJob, buildSections, applyPrefs, carriedSteps, SEED_2026_11_10, needIdFor,
  CFG, LEAD_SECS, TYPED, LEAD_WATCHES, buildLeadSections, rangeText, seedFor, SEED_LEAD_2026_11_11 };
