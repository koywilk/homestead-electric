// ─────────────────────────────────────────────────────────────
// Lead Meeting Prep builder — PURE module (no Firestore, no network, no requires).
//
//   buildModel(inputs)            → plain model object (all predicates, no I/O)
//   renderHtml(model)             → the sheet as HTML (Drive converts it to a Google Doc)
//   extractShipped(md, today)     → FEATURES.md entries shipped in the last 7 days
//   parseActionItems(doc, today)  → last meeting's "Action items" bullets (Docs API JSON)
//
// Kept pure so scripts/leadprep-dryrun.js renders byte-identical output to the
// deployed function. The orchestrator (index.js exports.leadMeetingPrep) does
// all reads and passes raw data in.
//
// Content contract (Koy, 2026-09-08): a Tuesday-morning prep sheet he pulls
// from for the Wednesday 6:30 Weekly Lead Meeting — same sections as the
// Calendar-attached notes doc (Notes · Highlight · Lowlight · Training ·
// Schedule Look Ahead · Action items). Koy only. Every section degrades
// independently: a thrown section renders empty and never kills the sheet.
// Simplified 2026-09-09 (Koy: "a lot of info on here… needs to be just general
// for ease of presenting to group") — the model keeps the detail, the render
// shows one plain line per job.
//
// Work signal: the crew's daily updates (roughUpdates/finishUpdates) and the
// office statusUpdate line. NOT lastActivityAt — that is stamped by merely
// opening a job (presence ping), which is why the Today view dropped it in v368.
// ─────────────────────────────────────────────────────────────

const TZ = "America/Denver";

const ACTIVE_DAYS = 35;       // finish job is "moving" if touched within 5 weeks
const START_WINDOW = 14;      // ...or its start is inside the next 2 weeks (or 7 days past)
const UPCOMING_HORIZON = 60;  // finish starts further out than this stay off Upcoming
const PTO_DAYS = 14;          // crew-out window
const INSPECTION_DAYS = 7;    // highlight/lowlight suggestions window
const SHIPPED_DAYS = 7;       // "new in the app since last meeting"

// ── tiny date/format helpers ─────────────────────────────────────────────────

// Accepts ISO "2026-07-13", US "7/13/26" / "07/13/2026" / "3-17-26", Date,
// Firestore Timestamp ({toDate} | {seconds} | {_seconds}), or anything
// Date.parse understands. Crew-entered dates use every one of these.
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
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const fmtShort = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const arr = (v) => (Array.isArray(v) ? v : []);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

// Effective phase status — falls back to deriving from stage % when no status
// is stored (mirrors the app's effRS/effFS).
const effStatus = (j, phase) => {
  const st = j[phase + "Status"];
  if (st) return st;
  const p = parseInt(j[phase + "Stage"]) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
};
const started = (st) => st === "inprogress" || st === "scheduled" || st === "date_confirmed";
const STATUS_LABEL = {
  inprogress: "in progress", scheduled: "scheduled", date_confirmed: "date confirmed",
  waiting_date: "waiting on date", waiting: "waiting", complete: "complete", invoice: "invoice", "": "not started",
};

// Normalized job name for de-duping pipeline rows against board jobs:
// "#2385 - Skyridge Lot 208 - Mayflower" ≈ "Skyridge Lot 208 - Mayflower".
const normName = (n) => String(n || "").toLowerCase()
  .replace(/^#?\d{3,5}\s*-\s*/, "")
  .replace(/\s*\(finish\)$/, "")
  .replace(/\s*-\s*[a-z ]+$/, "")
  .replace(/\s+/g, " ").trim();

// ── FEATURES.md → "new in the app since last meeting" ───────────────────────
// Lines look like:  - **Title** · `shipped 2026-09-02` · `SW v392` · description
// or, for sub-entries under a tab:  - Title · `shipped 2026-09-02` · `SW v392` · …
// Only lines with a DATED shipped tag inside the window count.
function extractShipped(md, today, days = SHIPPED_DAYS) {
  if (!md || typeof md !== "string") return [];
  const t = today instanceof Date ? today : new Date();
  const out = [];
  md.split("\n").forEach(line => {
    const m = line.match(/^\s*-\s*(?:\*\*)?(.+?)(?:\*\*)?\s*·\s*`shipped (\d{4}-\d{2}-\d{2})`(?:\s*·\s*`SW (v\d+)`)?/);
    if (!m) return;
    const d = toDateAny(m[2]);
    if (!d) return;
    const age = daysBetween(t, d);
    if (age < 0 || age > days) return;
    out.push({ title: m[1].trim(), version: m[3] || "", date: d });
  });
  return out.sort((a, b) => a.date - b.date);
}

// ── Google Docs API JSON → last meeting's action items ──────────────────────
// Calendar's notes template: an H2 "Sep 2, 2026 | Weekly Lead Meeting", then
// "Notes" + bullets, "Action items" + bullets. Newest dated section on/before
// today is last week's meeting (the next week's header may already exist, empty).
function parseActionItems(doc, today) {
  const empty = { fromDate: null, rows: [] };
  const content = doc && doc.body && Array.isArray(doc.body.content) ? doc.body.content : null;
  if (!content) return empty;
  const t = today instanceof Date ? today : new Date();
  const paras = content.filter(c => c && c.paragraph).map(c => ({
    text: arr(c.paragraph.elements).map(e => (e && e.textRun && e.textRun.content) || "").join("").replace(/\s+/g, " ").trim(),
    bullet: !!c.paragraph.bullet,
  }));
  const sections = [];
  let cur = null, inActions = false;
  paras.forEach(p => {
    const hm = p.text.match(/^([A-Z][a-z]{2} \d{1,2}, \d{4})\s*\|/);
    if (hm) { cur = { date: toDateAny(hm[1]), actions: [] }; sections.push(cur); inActions = false; return; }
    if (!cur) return;
    if (!p.bullet && /^action items?$/i.test(p.text)) { inActions = true; return; }
    if (!p.bullet && p.text) { inActions = false; return; } // any other heading ends the list
    if (inActions && p.bullet && p.text) cur.actions.push(p.text);
  });
  const pick = sections.filter(s => s.date && daysBetween(t, s.date) >= 0).sort((a, b) => b.date - a.date)[0];
  return pick ? { fromDate: pick.date, rows: pick.actions } : empty;
}

// ── model ────────────────────────────────────────────────────────────────────

function buildModel(inputs) {
  const { jobs, upcoming, pto, featuresMd, notesDoc, now } = inputs || {};
  const realNow = now instanceof Date ? now : new Date();

  // Calendar math on the Mountain-Time wall-clock date; display formatting
  // shifts at format time only (the old packet double-shifted).
  const mtNow = new Date(realNow.toLocaleString("en-US", { timeZone: TZ }));
  const today = startOfDay(mtNow);
  const meeting = addDays(today, (3 - today.getDay() + 7) % 7); // next Wednesday (today if Wed)

  const model = {
    meetingLabel: meeting.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    docDate: meeting.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    generated: realNow.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }),
    rough: { rows: [] },
    finish: { moving: [], quiet: [] },
    upcoming: [],
    pto: [],
    highlights: [],
    lowlights: [],
    shipped: { rows: [], error: true },
    actions: { fromDate: null, rows: [], error: true },
    counts: {},
  };

  // Base sets — a throw here leaves every job section empty (each is guarded).
  let live = [], real = [], quotes = [];
  try {
    live = arr(jobs).filter(j => j && j.name && !j.archived && !j.deleted && !j.archivedAt && String(j.name).trim() !== "Example Job");
    const notDone = live.filter(j => !(j.finishStatus === "complete" || parseInt(j.finishStage) === 100));
    real = notDone.filter(j => !j.tempPed && !j.quickJob && j.type !== "quote");
    quotes = notDone.filter(j => j.type === "quote");
  } catch (e) { live = []; real = []; quotes = []; }

  const phaseStart = (j, p) => toDateAny(j[p + "ProjectedStart"]) || toDateAny(j[p + "ScheduledDate"]) || toDateAny(j[p + "StartDate"]);
  const hasForeman = (j) => !!j.foreman && j.foreman !== "Unassigned";

  // Freshest of: the crew's last daily update vs the office status line.
  const latestUpdate = (j) => {
    const all = [...arr(j.roughUpdates), ...arr(j.finishUpdates)]
      .map(u => ({ d: toDateAny(u && u.date) || toDateAny(u && u.createdAt), text: stripHtml(u && u.text), by: (u && u.addedBy) || "" }))
      .filter(u => u.d);
    all.sort((a, b) => b.d - a.d);
    return all[0] || null;
  };
  const bestLine = (j) => {
    const du = latestUpdate(j);
    const su = j.statusUpdate ? { text: stripHtml(j.statusUpdate), d: toDateAny(j.statusUpdateAt), by: j.statusUpdateBy || "" } : null;
    return [du, su].filter(Boolean).sort((a, b) => (b.d || 0) - (a.d || 0))[0] || null;
  };

  const row = (j, p) => {
    const st = effStatus(j, p);
    const ps = phaseStart(j, p);
    const end = toDateAny(j[p + "ScheduledEnd"]);
    const best = bestLine(j);
    const touchAge = best && best.d ? daysBetween(today, best.d) : null;
    const startsIn = ps ? daysBetween(ps, today) : null;
    const flags = [];
    if (!hasForeman(j)) flags.push("no foreman");
    if (!j.lead || /unassigned|tbd/i.test(String(j.lead))) flags.push("no lead");
    if (j.flagged) flags.push("flagged" + (j.flagNote ? ": " + stripHtml(j.flagNote).slice(0, 50) : ""));
    const stage = j[p + "Stage"] && /\d/.test(String(j[p + "Stage"])) ? String(j[p + "Stage"]).replace(/%?$/, "%") : "";
    return {
      name: String(j.name).trim(),
      foreman: hasForeman(j) ? j.foreman : "",
      lead: j.lead && !/unassigned|tbd/i.test(String(j.lead)) ? j.lead : "",
      status: STATUS_LABEL[st] || st, stage,
      start: ps, end, startsIn,
      update: best ? best.text.slice(0, 120) : "",
      updateBy: best ? String(best.by || "").trim().split(" ")[0] : "",
      updateAge: touchAge,
      touchAge,
      flags,
      moving: (touchAge != null && touchAge <= ACTIVE_DAYS) ||
              (startsIn != null && startsIn >= -7 && startsIn <= START_WINDOW) ||
              st === "scheduled" || st === "date_confirmed",
    };
  };
  const sortRows = (a, b) => (a.startsIn == null ? 999 : a.startsIn) - (b.startsIn == null ? 999 : b.startsIn) || a.name.localeCompare(b.name);

  // ── Rough — every rough job that has started or is paused (the list is short) ──
  try {
    model.rough.rows = real
      .filter(j => { const st = effStatus(j, "rough"); return started(st) || st === "waiting"; })
      .map(j => row(j, "rough")).sort(sortRows);
  } catch (e) { model.rough.rows = []; }

  // ── Finish — moving vs quiet ──
  try {
    const all = real
      .filter(j => { const st = effStatus(j, "finish"); return started(st) || st === "waiting"; })
      .map(j => row(j, "finish"));
    model.finish.moving = all.filter(r => r.moving).sort(sortRows);
    model.finish.quiet = all.filter(r => !r.moving).sort((a, b) => (b.touchAge == null ? -1 : b.touchAge) - (a.touchAge == null ? -1 : a.touchAge));
  } catch (e) { model.finish = { moving: [], quiet: [] }; }

  // ── Upcoming — pipeline + quotes + owned/dated rough starts + finish starts within the horizon ──
  try {
    const up = [];
    arr(upcoming).filter(u => u && String(u.name || "").trim()).forEach(u => {
      const ps = toDateAny(u.projectedStart); const fu = toDateAny(u.lastFollowUp);
      up.push({ name: String(u.name).trim(), kind: "pipeline", who: u.sales ? `sales ${String(u.sales).trim()}` : "", customer: u.customer || "",
        start: ps, startsIn: ps ? daysBetween(ps, today) : null, note: stripHtml(u.notes || "").slice(0, 100), followAge: fu ? daysBetween(today, fu) : null });
    });
    quotes.forEach(j => up.push({ name: String(j.name).trim(), kind: "quote", who: "", customer: j.gc || j.customer || "",
      start: null, startsIn: null, note: j.statusUpdate ? stripHtml(j.statusUpdate).slice(0, 100) : "", followAge: null }));
    real.filter(j => { const st = effStatus(j, "rough"); return !st || st === "waiting_date"; }).forEach(j => {
      const ps = phaseStart(j, "rough");
      if (!ps && !hasForeman(j)) return; // unowned, undated stubs stay off the sheet
      if (ps && daysBetween(ps, today) > UPCOMING_HORIZON) return;
      up.push({ name: String(j.name).trim(), kind: "rough start", who: hasForeman(j) ? j.foreman : "no foreman", customer: j.gc || "",
        start: ps, startsIn: ps ? daysBetween(ps, today) : null, note: j.statusUpdate ? stripHtml(j.statusUpdate).slice(0, 100) : "", followAge: null });
    });
    real.filter(j => effStatus(j, "rough") === "complete" && !started(effStatus(j, "finish"))).forEach(j => {
      const ps = phaseStart(j, "finish");
      if (!ps) return;
      const d = daysBetween(ps, today);
      if (d > UPCOMING_HORIZON || d < -14) return;
      up.push({ name: String(j.name).trim() + " (finish)", kind: "finish start", who: hasForeman(j) ? j.foreman : "no foreman", customer: j.gc || "",
        start: ps, startsIn: d, note: j.statusUpdate ? stripHtml(j.statusUpdate).slice(0, 100) : "", followAge: null });
    });
    // Pipeline/quote rows for jobs already on the board are noise.
    const onBoard = new Set(real.filter(j => { const st = effStatus(j, "rough"); return started(st) || st === "waiting" || st === "complete"; }).map(j => normName(j.name)));
    const seen = new Map();
    up.filter(u => !((u.kind === "pipeline" || u.kind === "quote") && onBoard.has(normName(u.name)))).forEach(u => {
      const k = normName(u.name); const prev = seen.get(k);
      if (!prev) seen.set(k, u);
      else if (u.start && !prev.start) seen.set(k, { ...u, kind: prev.kind + " + " + u.kind });
    });
    model.upcoming = [...seen.values()].sort((a, b) => (a.startsIn == null ? 999 : a.startsIn) - (b.startsIn == null ? 999 : b.startsIn) || a.name.localeCompare(b.name));
  } catch (e) { model.upcoming = []; }

  // ── Crew out — PTO overlapping today..+14 ──
  try {
    const winEnd = addDays(today, PTO_DAYS);
    model.pto = arr(pto).map(p => ({ name: (p && p.name) || "", s: toDateAny(p && p.start), e: toDateAny(p && p.end) || toDateAny(p && p.start), note: (p && p.note) || "" }))
      .filter(p => p.name && p.s && p.e && p.e >= today && p.s <= winEnd)
      .sort((a, b) => a.s - b.s)
      .map(p => ({ name: p.name, label: p.s.getTime() === p.e.getTime() ? fmtShort(p.s) : `${fmtShort(p.s)}–${fmtShort(p.e)}`, note: stripHtml(p.note).slice(0, 80) }));
  } catch (e) { model.pto = []; }

  // ── Highlight / Lowlight suggestions — inspections in the last 7 days ──
  try {
    const hi = [], lo = [];
    live.forEach(j => {
      [["rough", "Rough inspection"], ["final", "Final inspection"]].forEach(([k, label]) => {
        const d = toDateAny(j[k + "InspectionDate"]);
        const r = String(j[k + "InspectionResult"] || "").toLowerCase().trim();
        if (!d || !r) return;
        const age = daysBetween(today, d);
        if (age < 0 || age > INSPECTION_DAYS) return;
        (r.includes("pass") ? hi : lo).push(`${String(j.name).trim()} — ${label} ${r} (${fmtShort(d)})`);
      });
    });
    model.highlights = hi; model.lowlights = lo;
  } catch (e) { model.highlights = []; model.lowlights = []; }

  // ── Training — what shipped since last meeting ──
  try {
    model.shipped = { rows: extractShipped(featuresMd, today), error: featuresMd == null };
  } catch (e) { model.shipped = { rows: [], error: true }; }

  // ── Action items — carried from the notes doc ──
  try {
    const parsed = parseActionItems(notesDoc, today);
    model.actions = { fromDate: parsed.fromDate, rows: parsed.rows, error: notesDoc == null };
  } catch (e) { model.actions = { fromDate: null, rows: [], error: true }; }

  model.counts = {
    rough: model.rough.rows.length,
    finishMoving: model.finish.moving.length,
    finishQuiet: model.finish.quiet.length,
    upcoming: model.upcoming.length,
    pto: model.pto.length,
    shipped: model.shipped.rows.length,
    actions: model.actions.rows.length,
  };
  return model;
}

// ── render ───────────────────────────────────────────────────────────────────
// Presentation contract (Koy, 2026-09-09): "just general for ease of presenting
// to the group during the meeting." One short line per job — name, dash, plain
// status — in the notes doc's own section order. No foreman/lead/stage/ages/
// flags, no sub-headers, no counts; every section ends with an empty bullet so
// Koy can type straight into it.

const INK = "#111827", GREY = "#6b7280";
const SA_HINT = "share it (Viewer) with homestead-electric@appspot.gserviceaccount.com";
const h2 = (t) => `<h2 style="font-size:15px;margin:20px 0 4px;color:${INK}">${t}</h2>`;
const h3 = (t) => `<h3 style="font-size:13px;margin:10px 0 2px 12px;color:${INK}">${t}</h3>`;
const li = (s) => `<li style="margin:2px 0">${s}</li>`;
const EMPTY_LI = `<li style="margin:2px 0">&nbsp;</li>`;
const grey = (s) => `<span style="color:${GREY}">${esc(s)}</span>`;
const ul = (items, indent) => `<ul style="margin:0 0 4px ${indent ? 24 : 0}px;padding-left:20px">${items.join("")}${EMPTY_LI}</ul>`;

// One plain phrase per job: a real date beats prose ("starts Sep 14"), otherwise
// the first sentence of the freshest crew/office update, otherwise nothing.
function blurb(r) {
  if (r.start && r.startsIn != null && r.startsIn >= 0 && r.startsIn <= START_WINDOW) {
    return r.startsIn === 0 ? "starts today" : `starts ${fmtShort(r.start)}`;
  }
  if (r.update) {
    // Crew text often starts with its own bullets ("• Basement done • …") — strip them.
    const clean = r.update.replace(/^[\s•·\-–—*]+/, "").replace(/\s*[•·]\s*/g, ", ");
    const first = clean.split(/(?<=[.!?])\s+/)[0].replace(/[.,\s]+$/, "");
    return first.length > 70 ? first.slice(0, 67).replace(/\s+\S*$/, "") + "…" : first;
  }
  return "";
}
const jobLi = (r) => { const b = blurb(r); return li(`${esc(r.name)}${b ? ` — ${esc(b)}` : ""}`); };
function upLi(u) {
  const when = u.start ? (u.startsIn >= 0 ? fmtShort(u.start) : `${fmtShort(u.start)} (past)`) : "";
  const name = /\(finish\)$/.test(u.name) ? u.name.replace(/\s*\(finish\)$/, " finish") : u.name;
  // A date is the general fact; the note only fills in when there is no date.
  const note = u.note ? u.note.replace(/^[\s•·\-–—*]+/, "").split(/(?<=[.!?])\s+/)[0].replace(/[.,\s]+$/, "").slice(0, 70) : "";
  const tail = when || note;
  return li(`${esc(name)}${tail ? ` — ${esc(tail)}` : ""}`);
}

function renderHtml(m) {
  const training = m.shipped.error ? [] : m.shipped.rows.map(s => li(esc(s.title)));
  const actions = m.actions.error
    ? [li(grey(`Couldn't read last week's action items — ${SA_HINT}`))]
    : m.actions.rows.map(s => li(esc(s)));
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:${INK};font-size:14px;max-width:720px;margin:0 auto;padding:8px 12px">
  <h1 style="font-size:18px;margin:0 0 12px">${esc(m.meetingLabel)} | Weekly Lead Meeting</h1>
  ${h2("Notes")}${ul([])}
  ${h2("Highlight")}${ul(m.highlights.map(s => li(esc(s))))}
  ${h2("Lowlight")}${ul(m.lowlights.map(s => li(esc(s))))}
  ${h2("Training")}${ul(training)}
  ${h2("Schedule Look Ahead")}
  ${h3("Rough")}${ul(m.rough.rows.map(jobLi), true)}
  ${h3("Finish")}${ul(m.finish.moving.map(jobLi), true)}
  ${h3("Upcoming")}${ul(m.upcoming.map(upLi), true)}
  ${h3("Crew out")}${ul(m.pto.map(p => li(`${esc(p.name)} — ${esc(p.label)}${p.note ? `, ${esc(p.note)}` : ""}`)), true)}
  ${h2("Action items")}${ul(actions)}
  </div>`;
}

module.exports = { buildModel, renderHtml, extractShipped, parseActionItems, toDateAny, TZ };
