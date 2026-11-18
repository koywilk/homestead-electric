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
const CFG = {
  scramble: { dow: 2, label: "Weekly Scramble", when: "Tuesdays 4:00 PM", who: "Josh, Koy, Justin, Brady", secs: SECS, weeks: 1 },
  lead: { dow: 3, label: "Weekly Lead Meeting", when: "Wednesdays 6:30 AM", who: "Koy and the foremen and leads", secs: LEAD_SECS, weeks: 1 },
  foreman: { dow: 3, label: "Weekly Resi Foreman Meeting", when: "Wednesdays 7:00 AM", who: "Koy, Keegan, Daegan and Colby", secs: FOREMAN_SECS, weeks: 1 },
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
module.exports = { SECS, ATTENDEES, WATCHES, ymd, parseYmd, anyDate, meetingDate, meetingId, prevMeetingDate, weekRange, safeKey, firstOf,
  bookingsByJob, buildSections, applyPrefs, carriedSteps, SEED_2026_11_10, needIdFor,
  CFG, LEAD_SECS, LEAD_OLD, TYPED, LEAD_WATCHES, buildLeadSections, rangeText, seedFor, SEED_LEAD_2026_11_11, leadRange, secHasContent, phaseOf,
  FOREMAN_SECS, marginRows, buildForemanSections, isMainGroup };
