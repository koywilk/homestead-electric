// ─────────────────────────────────────────────────────────────
// Friday Packet builder — PURE module (no Firestore, no network, no requires).
//
//   buildModel(inputs)  → plain model object (all predicates, ranking, caps)
//   renderHtml(model)   → the packet HTML string
//   resolveRecipients(users)        → who gets the "packet ready" push
//   collectSimproCandidates(jobs)   → simproNos worth a live Totals fetch
//
// Kept pure so scripts/packet-dryrun.js renders byte-identical output to the
// deployed function. The orchestrator (index.js exports.fridayPacket) does all
// reads/writes and passes raw data in.
//
// Content contract (Koy, 2026-07-30): one phone-screen read for Koy + office.
// Headline → Money & Billing → Blockers & Actions → Week Ahead. Hard caps
// everywhere; details live in the app, not this report. No LLM — deterministic
// slot-filled templates only. Every pillar degrades independently: a thrown
// pillar renders "Section unavailable this week." and never kills the packet.
// ─────────────────────────────────────────────────────────────

const TZ = "America/Denver";
const MARGIN_TARGET = 15; // net-margin goal at finish (Scoreboard V4 doctrine)
const CAPS = { rti: 8, marginWorst: 3, billed: 5, blockers: 2, blockersTotal: 8, crewed: 12, gaps: 5, conflicts: 5 };

// entangled/add-on jobs whose costs & revenue live on another Simpro job —
// their standalone margin is fiction (same regex as ScoreboardV4's _sb4Special).
const SPECIAL_JOB = /phase|temp power|temp p\b|t&m|ev charger|light change|whip|\bstc\b/i;

// ── tiny date/format helpers ─────────────────────────────────────────────────

// Accepts ISO "2026-07-13", US "7/13/26" / "07/13/2026", Date, Firestore
// Timestamp ({toDate} or {seconds}), or anything Date.parse understands.
// Crew-entered dates use 2-digit years, so those must parse too.
function toDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") { try { const d = v.toDate(); return isNaN(d.getTime()) ? null : d; } catch (e) { return null; } }
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2], 12, 0, 0); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const mondayOf = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return startOfDay(m); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtShort = (d) => d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
const firstKey = (name) => String(name || "").trim().toLowerCase().split(" ")[0];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10;
}

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

const fmtMoney = (v) => v >= 950 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;

// Effective phase status — falls back to deriving from stage % when no status
// is stored (mirrors the app's effRS/effFS; tempPed jobs are skipped by
// callers before this matters).
const effStatus = (j, phase) => {
  const st = j[phase + "Status"];
  if (st) return st;
  const p = parseInt(j[phase + "Stage"]) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
};
const phaseStarted = (st) => st === "inprogress" || st === "complete" || st === "invoice";

// ── punch / question walkers (schema: floors upper/main/basement + extras) ──

function flatPunchWaiting(punch) {
  const out = [];
  if (!punch || typeof punch !== "object") return out;
  const extras = Array.isArray(punch.extras) ? punch.extras : [];
  const floors = ["upper", "main", "basement"].concat(extras.map(e => e && e.key).filter(Boolean));
  floors.forEach(fk => {
    const f = punch[fk];
    if (!f || typeof f !== "object") return;
    const check = (i) => { if (i && !i.done && !i.voided && i.waiting) out.push({ text: i.text, waitingOn: i.waitingOn }); };
    (f.general || []).forEach(check);
    (f.hotcheck || []).forEach(check);
    (f.rooms || []).forEach(r => (r && r.items || []).forEach(check));
  });
  return out;
}

function countUnansweredQuestions(qs) {
  let n = 0;
  ["upper", "main", "basement"].forEach(fl => {
    ((qs || {})[fl] || []).forEach(q => { if (q && !q.done && !(q.answer || "").trim()) n++; });
  });
  return n;
}

// Canonical waiting-on buckets — the old packet keyed on raw free text, so
// "Delivery" / "Fixture delivery" / "Delivery/ measurements" were 3 buckets.
// Keyword-map to a fixed set instead; order matters (first match wins).
const WAIT_BUCKETS = [
  ["inspection", /inspect|ahj|4.?way|final\b/i],
  ["materials/fixtures", /deliver|fixture|material|light\b|chandelier|order|on site|onsite|not on s|bulb|shade|supply/i],
  ["GC/builder", /\bgc\b|builder|fram|drywall|paint|cabinet|counter|tile|scaffold|ceiling|drop|insulat|trim|shelv|baseboard|wallpaper|island|fur out/i],
  ["design/selections", /design|selection|spec\b|layout|decision|confirm|detail|location|height|measure/i],
  ["homeowner", /homeowner|customer|client|owner/i],
  ["other trades", /plumb|hvac|mechanical|sauna|utility|trade/i],
  ["change order", /change order|\bco\b|possible change/i],
];
function waitBucket(reason) {
  const r = String(reason || "").trim();
  if (!r) return "unspecified";
  for (const [label, re] of WAIT_BUCKETS) if (re.test(r)) return label;
  return "other";
}

// ── recipients ───────────────────────────────────────────────────────────────

// Koy + office = admins ∪ coordinators (names referenced by any foreman
// user's `.coordinator`, same resolution as sendHuddleNotif) ∪ the explicit
// extras list. Deliberately NOT plain "manager" access — field foremen carry
// manager-level app access, and this packet holds margin numbers. Deduped by
// id||name. Extras are lowercase name prefixes for office people who aren't
// admins or coordinators (tune at dry-run sign-off).
const PACKET_EXTRA_RECIPIENTS = [];
function resolveRecipients(users) {
  const list = users || [];
  const accessOf = (u) => {
    if (u.access) return u.access;
    const m = { admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard", lead: "limited", crew: "limited" };
    return m[u.role] || "limited";
  };
  const titleOf = (u) => u.title || u.role || "";
  const coordNames = new Set(
    list.filter(u => titleOf(u) === "foreman" && u.coordinator)
        .map(u => String(u.coordinator).toLowerCase().trim())
  );
  const out = [], seen = new Set();
  list.forEach(u => {
    const nameLc = String(u.name || "").toLowerCase().trim();
    const isAdmin = accessOf(u) === "admin";
    const isCoord = coordNames.has(nameLc);
    const isExtra = PACKET_EXTRA_RECIPIENTS.some(x => nameLc === x || nameLc.startsWith(x + " "));
    if (!isAdmin && !isCoord && !isExtra) return;
    const id = u.id || u.name;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ user: u, reason: isAdmin ? "admin" : isCoord ? "coordinator" : "added" });
  });
  return out;
}

// ── bounded Simpro fetch shopping list ───────────────────────────────────────

// The simproNos worth a live Totals fetch: ready-to-invoice jobs first (their
// dollars headline the packet), then the margin-watch set. Capped so the
// packet can never fan out into hundreds of Simpro calls.
function collectSimproCandidates(jobs, cap = 50) {
  const act = (jobs || []).filter(j => j && j.name && j.type !== "quote" && !j.archived && !j.deleted && !j.archivedAt &&
    !(j.finishStatus === "complete" || parseInt(j.finishStage) === 100));
  const rti = act.filter(j => j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent);
  const nearFinish = act.filter(j => (parseInt(j.finishStage) || 0) > 0 || effStatus(j, "finish") === "inprogress" || j.readyToInvoice);
  const out = [], seen = new Set();
  [...rti, ...nearFinish].forEach(j => {
    const sn = j.simproNo ? String(j.simproNo) : "";
    if (!sn || seen.has(sn) || out.length >= cap) return;
    seen.add(sn);
    out.push(sn);
  });
  return out;
}

// ── model builder ────────────────────────────────────────────────────────────

function buildModel(inputs) {
  const {
    jobs = [], upcoming = [], plannerDoc = null, scheduleEntries = [],
    pto = [], users = [], prevState = null, simproTotalsById = {}, now = new Date(),
  } = inputs || {};

  // `now` is a REAL Date (UTC-based). Calendar math needs the Mountain-Time
  // wall-clock date; display formatting shifts at format time only. (The old
  // packet shifted twice — _mtNow() then timeZone:TZ again — and printed 11 AM
  // for a 5 PM run.)
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const today = startOfDay(mtNow);

  const model = {
    dateLabel: today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    docDate: today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    generatedLabel: now.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }),
    headline: [],
    money: { error: true },
    blockers: { error: true },
    weekAhead: { error: true },
    nextState: null,
    counts: {},
  };

  // Base sets — if this throws, every pillar degrades (each checks its input).
  let activeJobs = [], quotes = [], allJobs = [];
  try {
    allJobs = (jobs || []).filter(j => j && j.name && !j.archived && !j.deleted && !j.archivedAt);
    const isComplete = (j) => j.finishStatus === "complete" || parseInt(j.finishStage) === 100;
    const live = allJobs.filter(j => !isComplete(j));
    activeJobs = live.filter(j => j.type !== "quote");
    quotes = live.filter(j => j.type === "quote");
  } catch (e) { /* pillars degrade below */ }

  // ── Week-ahead presence maps (also feed blocker scoring) ──
  const nextMon = addDays(mondayOf(today), 7);
  const weekDays = [0, 1, 2, 3, 4].map(i => addDays(nextMon, i));
  const weekYmds = weekDays.map(ymd);
  const todayYMD = ymd(today);
  const DAY_LBL = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  const assignments = (plannerDoc && plannerDoc.assignments) || {};
  const simproByPidDate = new Map(); // "pid|ymd" → [staff names]
  (scheduleEntries || []).forEach(s => {
    if (!s || s.Type !== "job" || !s.Date) return;
    const pid = String((s.Project && s.Project.ProjectID) || "");
    const nm = (s.Staff && s.Staff.Name) || "";
    if (!pid || !nm) return;
    const key = `${pid}|${s.Date}`;
    if (!simproByPidDate.has(key)) simproByPidDate.set(key, []);
    simproByPidDate.get(key).push(nm);
  });

  const plannerJobIds = new Set(Object.keys(assignments).map(k => k.split("_").slice(0, -1).join("_")));
  const simproDatesByPid = new Map(); // pid → Set<ymd>
  simproByPidDate.forEach((_v, key) => {
    const [pid, d] = key.split("|");
    if (!simproDatesByPid.has(pid)) simproDatesByPid.set(pid, new Set());
    simproDatesByPid.get(pid).add(d);
  });
  const hasSimproOnOrAfter = (j, fromYMD) => {
    const set = j.simproNo ? simproDatesByPid.get(String(j.simproNo)) : null;
    if (!set) return false;
    for (const d of set) if (d >= fromYMD) return true;
    return false;
  };
  const hasSimproInWeek = (j) => {
    const set = j.simproNo ? simproDatesByPid.get(String(j.simproNo)) : null;
    if (!set) return false;
    return weekYmds.some(d => set.has(d));
  };
  // "crew is booked soon" = a planner cell next week OR any Simpro booking from
  // today forward (the schedules fetch window is thisMonday..nextFriday).
  const crewBookedSoon = (j) => plannerJobIds.has(j.id) || hasSimproOnOrAfter(j, todayYMD);
  const crewBookedNextWeek = (j) => plannerJobIds.has(j.id) || hasSimproInWeek(j);

  // ── PILLAR 1 · Money & Billing ──
  try {
    const totalsOf = (j) => simproTotalsById[String(j.simproNo || "")] || null;

    const rtiJobs = activeJobs.filter(j => j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent);
    const rtiRows = rtiJobs.map(j => {
      const rd = toDateAny(j.readyToInvoiceDate);
      const t = totalsOf(j);
      return {
        name: j.name, foreman: j.foreman && j.foreman !== "Unassigned" ? j.foreman : "",
        idleDays: rd ? Math.max(0, daysBetween(today, rd)) : null,
        dollars: t && typeof t.total === "number" ? t.total : null,
      };
    }).sort((a, b) => (b.idleDays == null ? -1 : b.idleDays) - (a.idleDays == null ? -1 : a.idleDays));
    const dollarsKnown = rtiRows.filter(r => r.dollars != null);
    const rtiTotal = dollarsKnown.reduce((s, r) => s + r.dollars, 0);

    // Margin watch — jobs at/near finish only (in-progress margins are
    // premature projections; 15% net at FINISH is the target). Live margin
    // from the bounded fetch wins; the on-job cache (refreshed on card-open)
    // is the fallback. Entangled jobs excluded — their margin is fiction.
    const nearFinish = activeJobs.filter(j => (parseInt(j.finishStage) || 0) > 0 || effStatus(j, "finish") === "inprogress" || j.readyToInvoice);
    const marginRows = nearFinish
      .filter(j => !SPECIAL_JOB.test(String(j.name || "")))
      .map(j => {
        const t = totalsOf(j);
        const m = (t && typeof t.margin === "number") ? t.margin
                : (typeof j.simproMargin === "number" && isFinite(j.simproMargin)) ? j.simproMargin : null;
        if (m == null) return null;
        const stage = (j.readyToInvoice && !j.invoiceDismissed) ? "ready to bill"
                    : (parseInt(j.finishStage) || 0) > 0 ? `finish ${j.finishStage}` : "finish in progress";
        return { name: j.name, margin: Math.round(m * 10) / 10, stage };
      })
      .filter(Boolean);
    const med = median(marginRows.map(r => r.margin));
    const under = marginRows.filter(r => r.margin < MARGIN_TARGET).sort((a, b) => a.margin - b.margin);

    // Billed since last packet — run-over-run diff of invoiceSent flips.
    // (invoiceSent is an undated boolean today; the diff is the only source.)
    const invoiceSentJobs = allJobs.filter(j => j.invoiceSent);
    const firstRun = !prevState || !Array.isArray(prevState.invoiceSentIds);
    const prevIds = new Set(firstRun ? [] : prevState.invoiceSentIds);
    const billedRows = firstRun ? [] : invoiceSentJobs.filter(j => !prevIds.has(j.id)).map(j => ({ name: j.name }));

    // Pipeline — counts + aging only (quotes/upcoming carry no dollar fields).
    const quoteAges = quotes.map(q => { const c = toDateAny(q.createdAt); return c ? daysBetween(today, c) : null; }).filter(v => v != null);
    const upItems = (upcoming || []).filter(u => u && (u.name || "").trim());
    const upWithDates = upItems.filter(u => String(u.projectedStart || "").trim());

    model.money = {
      error: false,
      rti: { rows: rtiRows.slice(0, CAPS.rti), more: Math.max(0, rtiRows.length - CAPS.rti), count: rtiRows.length, total: rtiTotal, knownCount: dollarsKnown.length },
      margin: { median: med, count: marginRows.length, underCount: under.length, worst: under.slice(0, CAPS.marginWorst) },
      billed: { firstRun, rows: billedRows.slice(0, CAPS.billed), more: Math.max(0, billedRows.length - CAPS.billed) },
      pipeline: { quotes: quotes.length, oldestQuoteDays: quoteAges.length ? Math.max(...quoteAges) : null, upcoming: upItems.length, upcomingWithDates: upWithDates.length },
    };
    model.nextState = {
      invoiceSentIds: invoiceSentJobs.map(j => j.id),
      readyToInvoiceIds: rtiJobs.map(j => j.id),
    };
  } catch (e) { model.money = { error: true }; }

  // ── PILLAR 2 · Blockers & Actions ──
  try {
    // {jobId, jobName, kind, score, age, what, why} — `age` (days) breaks
    // score ties so an 87-day-old CO outranks a 30-day-old one instead of
    // falling back to the alphabet.
    const items = [];
    const push = (j, kind, score, age, what, why) => items.push({ jobId: j.id, jobName: j.name, kind, score, age: age || 0, what, why });

    activeJobs.forEach(j => {
      const missingRoles = [];
      if (!j.foreman || j.foreman === "Unassigned") missingRoles.push("foreman");
      if (!j.lead || j.lead === "Unassigned") missingRoles.push("lead");

      // Phase-based blockers — real jobs only (temp peds / quick jobs have
      // their own lifecycles and no projected-start scheduling).
      if (!j.tempPed && !j.quickJob) {
        [["Rough", "rough"], ["Finish", "finish"]].forEach(([label, p]) => {
          const st = effStatus(j, p);
          if (phaseStarted(st)) return;
          const confirmed = !!j[p + "StartConfirmed"] || st === "scheduled" || st === "date_confirmed";
          const ps = toDateAny(j[p + "ProjectedStart"]);

          // Hard-date commitment with nothing locked in.
          if (j[p + "NeedsHardDate"] && !confirmed) {
            const by = toDateAny(j[p + "NeedsByStart"]);
            const soon = by && daysBetween(by, today) <= 14;
            push(j, "hard_date", 55 + (soon ? 15 : 0), 0,
              `${label} needs a HARD date${by ? ` by ${fmtShort(by)}` : ""}`,
              "customer-committed window with nothing locked in");
          }

          // Start days away, unconfirmed, nobody booked.
          if (ps && !confirmed) {
            const d = daysBetween(ps, today);
            if (d >= 0 && d <= 7 && !crewBookedSoon(j)) {
              push(j, "imminent_start", 50 + (missingRoles.length ? 10 : 0), 0,
                `${label.toLowerCase()} starts ${fmtShort(ps)} — unconfirmed, no crew booked`,
                "start is days away with nobody on it");
            }
          }

          // Missing the people to run an imminent start.
          if (missingRoles.length && ps) {
            const d = daysBetween(ps, today);
            if (d <= 14) {
              push(j, "missing_lead", 45 + (d <= 7 ? 10 : 0), 0,
                `missing ${missingRoles.join(" + ")} — ${label.toLowerCase()} projected ${fmtShort(ps)}`,
                "can't start without someone to run it");
            }
          }
        });

        // Rough done 50+ days, finish not on any calendar.
        if (effStatus(j, "rough") === "complete" && !phaseStarted(effStatus(j, "finish")) &&
            !String(j.finishProjectedStart || "").trim() && !String(j.finishStatusDate || "").trim()) {
          const re = toDateAny(j.roughStatusDate);
          const d = re ? daysBetween(today, re) : null;
          if (d != null && d >= 50) {
            push(j, "in_between", 25 + Math.min(d - 50, 30), d, `no finish date — rough done ${d}d ago`, "job stalling out between phases");
          }
        }
      }

      // Approved COs not scheduled (approved is its own status — scheduled /
      // converted / completed have moved on).
      const cos = (j.changeOrders || []).filter(co => co && co.coStatus === "approved");
      if (cos.length) {
        const ages = cos.map(co => { const c = toDateAny(co.createdAt); return c ? daysBetween(today, c) : null; }).filter(v => v != null);
        const oldest = ages.length ? Math.max(...ages) : null;
        push(j, "co", 40 + Math.min(oldest || 0, 30), oldest || 0,
          `${plural(cos.length, "approved CO")} not scheduled${oldest != null ? ` (oldest ${oldest}d)` : ""}`,
          "sold work sitting off the calendar");
      }

      // Return trips needing a schedule (honor all three scheduled signals).
      const rts = (j.returnTrips || []).filter(rt => rt && !rt.signedOff && !rt.rtScheduled && !rt.scheduledDate &&
        (rt.rtStatus === "needs" || rt.needsSchedule === true));
      if (rts.length) {
        const ages = rts.map(rt => { const c = toDateAny(rt.createdAt || rt.date); return c ? daysBetween(today, c) : null; }).filter(v => v != null);
        const oldest = ages.length ? Math.max(...ages) : null;
        push(j, "rt", 35 + Math.min(oldest || 0, 30), oldest || 0,
          `${plural(rts.length, "return trip")} not scheduled${oldest != null ? ` (oldest ${oldest}d)` : ""}`,
          "promised trips not on the books");
      }

      // Ready-to-invoice going stale (≥10d — the fresh ones live in Money).
      if (j.readyToInvoice && !j.invoiceDismissed && !j.invoiceSent) {
        const rd = toDateAny(j.readyToInvoiceDate);
        const idle = rd ? daysBetween(today, rd) : null;
        if (idle != null && idle >= 10) {
          push(j, "rti_idle", 30 + Math.min(idle, 30), idle, `ready to invoice ${idle}d — still not billed`, "finished money left on the table");
        }
      }

      // Flagged by Koy.
      if (j.flagged) {
        const note = stripHtml(j.flagNote || "").slice(0, 60);
        push(j, "flagged", 25, 0, `flagged${note ? ` — ${note}` : ""}`, "you flagged it — still unresolved");
      }

      // Unanswered crew questions.
      const rq = countUnansweredQuestions(j.roughQuestions);
      const fq = countUnansweredQuestions(j.finishQuestions);
      if (rq + fq > 0) {
        const parts = [rq ? `${rq} rough` : "", fq ? `${fq} finish` : ""].filter(Boolean).join(" · ");
        push(j, "questions", 20 + Math.min(2 * (rq + fq), 10), rq + fq, `${plural(rq + fq, "unanswered question")} (${parts})`, "crew is guessing or waiting on answers");
      }

      // Waiting-on items, canonically bucketed.
      const waiting = [...flatPunchWaiting(j.roughPunch), ...flatPunchWaiting(j.finishPunch), ...flatPunchWaiting(j.qcPunch)];
      if (waiting.length) {
        const byBucket = {};
        waiting.forEach(w => { const b = waitBucket(w.waitingOn); byBucket[b] = (byBucket[b] || 0) + 1; });
        const top = Object.entries(byBucket).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b, n]) => `${b} ${n}`);
        push(j, "waiting", 15 + Math.min(waiting.length, 10), waiting.length, `${plural(waiting.length, "waiting-on item")} — ${top.join(", ")}`, "third parties owe us answers");
      }
    });

    // Max 2 rows per job (keep its highest-scored), rank by score with age
    // as the tie-break, then fill the top-8 with at most 3 rows per category
    // so one backlog type (e.g. 34 approved COs) can't monopolize the list.
    // Backfill from the skipped pile if the caps leave slots empty.
    const byJob = new Map();
    items.forEach(it => {
      if (!byJob.has(it.jobId)) byJob.set(it.jobId, []);
      byJob.get(it.jobId).push(it);
    });
    const kept = [];
    byJob.forEach(list => {
      list.sort((a, b) => b.score - a.score || b.age - a.age);
      kept.push(...list.slice(0, CAPS.blockers));
    });
    const rank = (a, b) => b.score - a.score || b.age - a.age || a.jobName.localeCompare(b.jobName);
    kept.sort(rank);
    const PER_KIND = 3;
    const chosen = [], skipped = [], perKind = {};
    kept.forEach(it => {
      if (chosen.length >= CAPS.blockersTotal || (perKind[it.kind] || 0) >= PER_KIND) { skipped.push(it); return; }
      perKind[it.kind] = (perKind[it.kind] || 0) + 1;
      chosen.push(it);
    });
    while (chosen.length < CAPS.blockersTotal && skipped.length) chosen.push(skipped.shift());
    chosen.sort(rank);
    model.blockers = {
      error: false,
      rows: chosen,
      more: Math.max(0, kept.length - chosen.length),
      total: kept.length,
    };
  } catch (e) { model.blockers = { error: true }; }

  // ── PILLAR 3 · Week Ahead ──
  try {
    const jobById = new Map(activeJobs.map(j => [j.id, j]));
    const jobBySimproNo = new Map();
    activeJobs.forEach(j => { if (j.simproNo) jobBySimproNo.set(String(j.simproNo), j); });

    // Per job per day: manual planner people first (lead, then crew), then
    // Simpro extras — deduped by lowercased first name (the Huddle's merge
    // rule, so Vasa-from-Simpro doesn't double a manual Vasa).
    const perJob = new Map(); // jobId → {job, days:{di: {lead, people:[]}}}
    const noteDay = (job, di, cell, simproPeople) => {
      if (!perJob.has(job.id)) perJob.set(job.id, { job, days: {} });
      const seen = new Set(); const people = [];
      const lead = (cell && cell.lead) || null;
      if (lead) { seen.add(firstKey(lead)); people.push(lead); }
      ((cell && cell.crew) || []).forEach(p => { const k = firstKey(p); if (!seen.has(k)) { seen.add(k); people.push(p); } });
      (simproPeople || []).forEach(p => { const k = firstKey(p); if (!seen.has(k)) { seen.add(k); people.push(p); } });
      if (!people.length) return;
      perJob.get(job.id).days[di] = { lead, people };
    };
    const jobsToScan = new Set([...plannerJobIds].filter(id => jobById.has(id)));
    weekYmds.forEach((d, di) => {
      simproByPidDate.forEach((_staff, key) => {
        const [pid, kd] = key.split("|");
        if (kd !== d) return;
        const j = jobBySimproNo.get(pid);
        if (j) jobsToScan.add(j.id);
      });
    });
    jobsToScan.forEach(id => {
      const j = jobById.get(id);
      if (!j) return;
      for (let di = 0; di < 5; di++) {
        const cell = assignments[`${j.id}_${di}`];
        const simproPeople = j.simproNo ? (simproByPidDate.get(`${String(j.simproNo)}|${weekYmds[di]}`) || []) : [];
        if ((cell && (cell.lead || (cell.crew || []).length)) || simproPeople.length) noteDay(j, di, cell, simproPeople);
      }
    });

    const daysLabel = (dis) => {
      if (dis.length === 5) return "all week";
      const runs = [];
      let start = dis[0], prev = dis[0];
      for (let i = 1; i <= dis.length; i++) {
        const cur = dis[i];
        if (cur === prev + 1) { prev = cur; continue; }
        runs.push(start === prev ? DAY_LBL[start] : `${DAY_LBL[start]}–${DAY_LBL[prev]}`);
        start = prev = cur;
      }
      return runs.join(", ");
    };

    const crewedRows = [...perJob.values()].map(({ job, days }) => {
      const dis = Object.keys(days).map(Number).sort((a, b) => a - b);
      // People in encounter order (planner lead lands first when there is
      // one), deduped by first name across the week — so a Simpro-only crew
      // still shows a real name instead of a bare "+2".
      const seen = new Set(); const people = [];
      dis.forEach(di => days[di].people.forEach(p => {
        const k = firstKey(p);
        if (!seen.has(k)) { seen.add(k); people.push(p); }
      }));
      return { name: job.name, firstDay: dis[0], label: daysLabel(dis), people };
    }).sort((a, b) => a.firstDay - b.firstDay || a.name.localeCompare(b.name));

    // Conflicts — same person on 2+ jobs the same DAY (the old packet's
    // same-week check was noise; two jobs in one week is normal).
    const conflicts = [];
    for (let di = 0; di < 5; di++) {
      const where = new Map(); // firstKey → {name, jobs:Set}
      perJob.forEach(({ job, days }) => {
        const day = days[di];
        if (!day) return;
        day.people.forEach(p => {
          const k = firstKey(p);
          if (!where.has(k)) where.set(k, { name: p, jobs: new Set() });
          where.get(k).jobs.add(job.name);
        });
      });
      where.forEach(({ name, jobs: js }) => {
        if (js.size > 1) conflicts.push({ person: name, day: DAY_LBL[di], jobs: [...js] });
      });
    }

    // Gaps — starts at risk (a start lands next week with zero crew booked),
    // then PTO overlapping the week.
    const risks = [];
    activeJobs.forEach(j => {
      if (j.tempPed || j.quickJob) return;
      [["rough", "Rough"], ["finish", "Finish"]].forEach(([p, label]) => {
        const st = effStatus(j, p);
        if (phaseStarted(st)) return;
        const ps = toDateAny(j[p + "ProjectedStart"]);
        if (!ps) return;
        const d = ymd(ps);
        if (d >= weekYmds[0] && d <= weekYmds[4] && !crewBookedNextWeek(j)) {
          risks.push({ kind: "start", name: j.name, phase: label, date: fmtShort(ps), pipeline: false });
        }
      });
    });
    (upcoming || []).forEach(u => {
      const ps = toDateAny(u && u.projectedStart);
      if (!ps) return;
      const d = ymd(ps);
      if (d >= weekYmds[0] && d <= weekYmds[4]) {
        risks.push({ kind: "start", name: u.name || "(unnamed)", phase: "Rough", date: fmtShort(ps), pipeline: true });
      }
    });
    const weekStart = weekDays[0], weekEnd = weekDays[4];
    const ptoRows = ((pto || [])).filter(p => {
      const s = toDateAny(p && p.start), e = toDateAny(p && (p.end || p.start));
      return s && e && s <= weekEnd && e >= weekStart;
    }).map(p => ({
      kind: "pto", name: p.name,
      range: `${fmtShort(toDateAny(p.start))}${p.end && p.end !== p.start ? `–${fmtShort(toDateAny(p.end))}` : ""}`,
      note: p.note || "",
    }));
    const gaps = [...risks, ...ptoRows];

    model.weekAhead = {
      error: false,
      rangeLabel: `${fmtShort(weekDays[0])} – ${fmtShort(weekDays[4])}`,
      crewed: { rows: crewedRows.slice(0, CAPS.crewed), more: Math.max(0, crewedRows.length - CAPS.crewed), total: crewedRows.length },
      gaps: { rows: gaps.slice(0, CAPS.gaps), more: Math.max(0, gaps.length - CAPS.gaps), riskCount: risks.length, ptoCount: ptoRows.length },
      conflicts: { rows: conflicts.slice(0, CAPS.conflicts), more: Math.max(0, conflicts.length - CAPS.conflicts) },
      nothingBooked: crewedRows.length === 0,
    };
  } catch (e) { model.weekAhead = { error: true }; }

  // ── Headline — each clause drops cleanly when its pillar failed ──
  try {
    const H = [];
    if (!model.money.error) {
      const { rti, margin } = model.money;
      if (rti.count === 0) H.push("Nothing waiting to be billed.");
      else if (rti.total > 0) H.push(`${fmtMoney(rti.total)}${rti.knownCount < rti.count ? "+" : ""} ready to bill across ${plural(rti.count, "job")}.`);
      else H.push(`${plural(rti.count, "job")} ready to bill.`);
      if (margin.median != null) {
        H.push(`Margin at finish: median ${margin.median}% vs ${MARGIN_TARGET}% target${margin.underCount ? ` — ${margin.underCount} under` : " — on target"}.`);
      }
    }
    const parts = [];
    if (!model.blockers.error) parts.push(model.blockers.total > 0 ? `${plural(model.blockers.total, "decision")} need you` : "No decisions stuck");
    if (!model.weekAhead.error) {
      const wa = model.weekAhead;
      parts.push(wa.nothingBooked
        ? "Next week: nothing booked yet"
        : `Next week: ${plural(wa.crewed.total, "job")} crewed${wa.gaps.riskCount ? `, ${plural(wa.gaps.riskCount, "start")} at risk` : ""}${wa.gaps.ptoCount ? `, ${wa.gaps.ptoCount} out` : ""}`);
    }
    if (parts.length) H.push(parts.join(" · ") + ".");
    model.headline = H;
  } catch (e) { model.headline = []; }

  model.counts = {
    rti: model.money.error ? null : model.money.rti.count,
    blockers: model.blockers.error ? null : model.blockers.total,
    crewedJobs: model.weekAhead.error ? null : model.weekAhead.crewed.total,
  };
  return model;
}

// ── renderer ─────────────────────────────────────────────────────────────────

const GREY = "#6b7280", INK = "#111", FAINT = "#9ca3af", RED = "#dc2626", GREEN = "#16a34a", AMBER = "#b45309";

const rowDiv = (html) => `<div style="font-size:13px;line-height:1.6;color:${INK}">${html}</div>`;
const whySpan = (why) => ` <span style="color:${GREY};font-size:12px">· ${esc(why)}</span>`;
const moreDiv = (n) => n > 0 ? `<div style="color:${FAINT};font-size:12px;margin-top:2px">…and ${n} more in the app</div>` : "";
const noneDiv = (label) => `<div style="color:${FAINT};font-size:12px">${esc(label)}</div>`;
const failDiv = () => `<div style="color:${FAINT};font-size:12px;font-style:italic">Section unavailable this week.</div>`;
const h2 = (t) => `<h2 style="font-size:15px;margin:22px 0 6px;padding-top:12px;border-top:2px solid ${INK};color:${INK};text-transform:uppercase;letter-spacing:0.04em">${t}</h2>`;
const h3 = (t) => `<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:12px 0 4px;color:#374151">${t}</h3>`;

function renderHtml(model) {
  const m = model || {};

  const headlineHtml = (m.headline && m.headline.length)
    ? `<div style="border-left:4px solid ${INK};padding:8px 12px;margin:14px 0 4px;background:#f8f8f7">${m.headline.map(l => `<div style="font-size:14px;font-weight:600;line-height:1.65;color:${INK}">${esc(l)}</div>`).join("")}</div>`
    : "";

  // Money & Billing
  let moneyHtml;
  if (m.money && !m.money.error) {
    const { rti, margin, billed, pipeline } = m.money;
    const rtiHtml = rti.rows.length
      ? rti.rows.map(r => rowDiv(`<b>${esc(r.name)}</b>${r.foreman ? ` · ${esc(r.foreman)}` : ""}${r.dollars != null ? ` · ${fmtMoney(r.dollars)}` : ""}${r.idleDays != null ? ` · <span style="color:${r.idleDays >= 10 ? RED : GREY}">idle ${r.idleDays}d</span>` : ""}`)).join("") + moreDiv(rti.more)
      : noneDiv("Nothing ready to invoice.");
    const marginHtml = margin.median == null
      ? noneDiv("No margin data on finishing jobs yet.")
      : rowDiv(`Median <b style="color:${margin.median >= MARGIN_TARGET ? GREEN : RED}">${margin.median}%</b> across ${plural(margin.count, "finishing job")} · target ${MARGIN_TARGET}%`) +
        margin.worst.map(r => rowDiv(`<b>${esc(r.name)}</b> · ${esc(r.stage)} · <span style="color:${RED};font-weight:700">${r.margin}%</span>${r.margin >= 0 ? ` (${Math.round((MARGIN_TARGET - r.margin) * 10) / 10} pts under)` : ` — negative, check Simpro costs`}`)).join("");
    const billedHtml = billed.firstRun
      ? noneDiv("Tracking starts this week.")
      : (billed.rows.length ? billed.rows.map(r => rowDiv(`<b>${esc(r.name)}</b> · invoice sent`)).join("") + moreDiv(billed.more) : noneDiv("Nothing billed since last packet."));
    const p = pipeline;
    const pipelineHtml = rowDiv(`${plural(p.quotes, "quote")} out${p.oldestQuoteDays != null ? ` (oldest ${p.oldestQuoteDays}d)` : ""} · ${p.upcoming} upcoming, ${p.upcomingWithDates} with start dates`);
    moneyHtml = h3(`Ready to invoice · ${rti.count}`) + rtiHtml + h3("Margin watch") + marginHtml + h3("Billed since last packet") + billedHtml + h3("Pipeline") + pipelineHtml;
  } else moneyHtml = failDiv();

  // Blockers
  let blockersHtml;
  if (m.blockers && !m.blockers.error) {
    blockersHtml = m.blockers.rows.length
      ? m.blockers.rows.map((r, i) => rowDiv(`<b>${i + 1}. ${esc(r.jobName)}</b> — ${esc(r.what)}${whySpan(r.why)}`)).join("") + moreDiv(m.blockers.more)
      : noneDiv("No decisions stuck — clean week.");
  } else blockersHtml = failDiv();

  // Week ahead
  let weekHtml;
  if (m.weekAhead && !m.weekAhead.error) {
    const wa = m.weekAhead;
    const crewedHtml = wa.nothingBooked
      ? noneDiv("Nothing booked for next week yet — planner not filled in.")
      : wa.crewed.rows.map(r => {
          const who = r.people.length ? `${r.people[0]}${r.people.length > 1 ? ` +${r.people.length - 1}` : ""}` : "";
          return rowDiv(`<b>${esc(r.name)}</b> — ${esc(r.label)}${who ? ` · ${esc(who)}` : ""}`);
        }).join("") + moreDiv(wa.crewed.more);
    const gapsHtml = wa.gaps.rows.length
      ? wa.gaps.rows.map(g => g.kind === "start"
          ? rowDiv(`<b style="color:${RED}">START AT RISK:</b> <b>${esc(g.name)}</b> — ${esc(g.phase.toLowerCase())} starts ${esc(g.date)}, no crew booked${g.pipeline ? " (pipeline job)" : ""}`)
          : rowDiv(`<b style="color:${AMBER}">OUT:</b> ${esc(g.name)} · ${esc(g.range)}${g.note ? ` — ${esc(g.note)}` : ""}`)
        ).join("") + moreDiv(wa.gaps.more)
      : noneDiv("No gaps spotted.");
    const conflictsHtml = wa.conflicts.rows.length
      ? wa.conflicts.rows.map(c => rowDiv(`<b>${esc(c.person)}</b> double-booked ${esc(c.day)}: ${c.jobs.map(esc).join(" / ")}`)).join("") + moreDiv(wa.conflicts.more)
      : "";
    weekHtml = crewedHtml + (wa.nothingBooked ? "" : h3("Gaps") + gapsHtml + (conflictsHtml ? h3("Double-booked") + conflictsHtml : ""));
  } else weekHtml = failDiv();

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:${INK}">
<h1 style="font-size:21px;margin:0 0 2px">Friday Packet</h1>
<div style="color:${GREY};font-size:12px">${esc(m.dateLabel || "")}</div>
${headlineHtml}
${h2("Money & Billing")}
${moneyHtml}
${h2("Blockers — decisions needing you")}
${blockersHtml}
${h2(`Week Ahead${m.weekAhead && !m.weekAhead.error ? ` · ${esc(m.weekAhead.rangeLabel)}` : ""}`)}
${weekHtml}
<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;color:${FAINT};font-size:11px">Generated ${esc(m.generatedLabel || "")} MT · details live in the app, not this report</div>
</div>`;
}

module.exports = { buildModel, renderHtml, resolveRecipients, collectSimproCandidates, TZ, MARGIN_TARGET };
