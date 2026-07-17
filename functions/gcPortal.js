// ─── GC Portal: pure projection + helpers ─────────────────────────────────────
// The safety-critical wall between the crew's job docs and the outside-facing
// contractor portal (see vault spec: 08-Specs/GC Portal Link Spec.md).
//
// RULES OF THIS MODULE:
//  1. EXPLICIT ALLOWLIST ONLY. A field reaches the portal mirror because a line
//     below deliberately copies it — never by spreading/cloning a job. Anything
//     not listed here (financials, notes, daily updates, crew scheduling, CO
//     contents, other GCs) is structurally incapable of leaking.
//  2. Every outbound string passes stripHtml() — punch/question texts carry
//     HTML from the app's contentEditable fields.
//  3. Hard caps on every list so a single job can never blow up the mirror doc.
//  4. Pure functions, no Firebase imports — unit-testable with plain node
//     (scripts/gcportal-test.js) and shared by publisher + backfill.

"use strict";

// Normalized matching key for a job's free-text `gc` field.
// "Robison" / "Robison " / "robison " → "robison" (confirmed real variants).
function gcKeyOf(gc) {
  return String(gc || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Strip HTML tags/entities from app rich-text. Outbound-only sanitizer.
// ORDER MATTERS (Piece 1 review): decode entities FIRST, then strip tags — the
// reverse re-materializes live markup ("&lt;img onerror=...&gt;" would survive
// as "<img onerror=...>"). Tags are stripped LAST, after all decode passes, and
// any unterminated trailing "<tag" is dropped so nothing angle-bracketed leaves.
function stripHtml(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(div|p|li|ul|ol)>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/<[^>]*>/g, "")   // strip complete tags (after decode)
    .replace(/[<>]/g, "")      // remove any residual bracket: no tag can form → no XSS,
                               // and stray "<"/">" (e.g. "12/2 <- panel") stays readable text
    .replace(/\s+/g, " ")
    .trim();
}

const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const str = (v, max) => stripHtml(v).slice(0, max || 300);
const bool = (v) => v === true;

// Stable content hash (FNV-1a over key-sorted JSON) for publish gating.
function hashOf(obj) {
  const json = JSON.stringify(obj, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {})
      : v
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Unguessable ids. token = the link secret; portalId = the mirror location.
// crypto.randomUUID is available on Node 18+ (functions runtime).
function makeToken() {
  const { randomUUID } = require("crypto");
  return randomUUID().replace(/-/g, "").slice(0, 20);
}

// URL slug for the pretty link: "Robison Build Co" → "robison-build-co-x7k2"
function makeSlug(label) {
  const base = String(label || "gc").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "gc";
  const { randomUUID } = require("crypto");
  return base + "-" + randomUUID().replace(/-/g, "").slice(0, 4);
}

// GC logo URL for the portal's co-brand header lockup (rendered as an <img>
// on the outside page). https-only, matching the matterport rule, or a
// root-relative path to a bundled asset in public/ ("/gc-logo-robison.png").
// Anything else — http:, javascript:, data:, protocol-relative "//" — → "".
// The https branch is an explicit charset, not \S: quotes, backticks, control
// chars, and unicode (e.g. zero-width space) must die HERE so the stored value
// stays safe even in a non-React sink (the email engine builds raw HTML).
function cleanLogoUrl(v) {
  const s = String(v || "").trim();
  if (!s || s.length > 500) return "";
  if (/^https:\/\/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$/.test(s)) return s;
  if (/^\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s)) return s;
  return "";
}

// ── punch traversal (rooms/general/hotcheck per zone) ────────────────────────
function eachPunchItem(punch, fn) {
  if (!punch || typeof punch !== "object") return;
  Object.keys(punch).forEach((zone) => {
    const z = punch[zone];
    if (!z || typeof z !== "object") return;
    (Array.isArray(z.rooms) ? z.rooms : []).forEach((room) => {
      (Array.isArray(room && room.items) ? room.items : []).forEach((it) => fn(it, room && room.name));
    });
    ["general", "hotcheck"].forEach((bucket) => {
      (Array.isArray(z[bucket]) ? z[bucket] : []).forEach((it) => fn(it, bucket));
    });
  });
}

function punchOpenCount(punch) {
  let n = 0;
  eachPunchItem(punch, (it) => { if (it && !it.done) n++; });
  return n;
}

// QC receipts: fromQC items with done state + fixer first name (display was
// approved in the mockup round; no other crew attribution leaves).
function qcItemsOf(punch, max) {
  const out = [];
  eachPunchItem(punch, (it, where) => {
    if (!it || !it.fromQC) return;
    out.push({
      text: str(it.text, 200),
      where: str(where, 40),
      done: bool(it.done),
      fixedBy: str((it.checkedBy || "").split(/\s+/)[0], 20),
    });
  });
  return cap(out, max || 30);
}

// ── questions: totals + per-recipient rollup + per-share-link tracking ───────
function flattenQuestions(q) {
  const out = [];
  if (!q || typeof q !== "object") return out;
  ["upper", "main", "basement"].forEach((z) => {
    (Array.isArray(q[z]) ? q[z] : []).forEach((item) => { if (item && item.id) out.push(item); });
  });
  return out;
}

function questionsView(job) {
  const all = flattenQuestions(job.roughQuestions).concat(flattenQuestions(job.finishQuestions));
  const byId = {};
  all.forEach((q) => { byId[q.id] = q; });

  // AUDIENCE GATE (Piece 3 review): the GC only ever sees questions that were
  // SHARED externally — never raw q.for. Mirrors the app's computeEffectiveSharedIds
  // (App.js): a question is "effectively shared" if it's in a share's explicit
  // ids OR its `for` matches a share's name (case-insensitive). A question the
  // office never shared out stays internal and structurally invisible here.
  const shares = Array.isArray(job.questionShares) ? job.questionShares : [];
  const shareNames = new Set(shares.map((sh) => String((sh && sh.name) || "").trim().toLowerCase()).filter(Boolean));
  const explicitIds = new Set();
  shares.forEach((sh) => (Array.isArray(sh && sh.ids) ? sh.ids : []).forEach((i) => explicitIds.add(i)));
  const isShared = (q) => explicitIds.has(q.id) || shareNames.has(String(q.for || "").trim().toLowerCase());

  const shared = all.filter(isShared);
  const open = shared.filter((q) => !q.done);
  const byFor = {};
  open.forEach((q) => {
    const who = str(q.for, 40) || "Shared";
    (byFor[who] = byFor[who] || []).push({ id: String(q.id), text: str(q.question, 200) });
  });
  const links = cap(shares, 12).map((sh) => {
    const ids = Array.isArray(sh && sh.ids) ? sh.ids : [];
    const known = ids.filter((i) => byId[i]);
    const answered = known.filter((i) => byId[i].done).length;
    return {
      name: str(sh && sh.name, 60) || "Link",
      sent: ids.length,
      answered,
      waiting: known.length - answered,
      createdAt: str(sh && sh.createdAt, 30),
      updatedAt: str(sh && sh.updatedAt, 30),
    };
  });
  return {
    asked: shared.length,
    answered: shared.length - open.length,
    open: open.length,
    byFor: Object.keys(byFor).map((who) => ({
      who,
      openCount: byFor[who].length,
      items: cap(byFor[who], 15),
    })),
    links,
  };
}

// ── return trips: scope + state, nothing internal ────────────────────────────
function returnTripsView(trips) {
  return cap(trips, 15).map((t) => ({
    id: String((t && t.id) || ""),
    scope: str(t && t.scope, 300),
    status: str(t && t.rtStatus, 20) || (t && t.needsSchedule ? "needs" : t && t.rtScheduled ? "scheduled" : ""),
    needsSchedule: bool(t && t.needsSchedule),
    scheduled: bool(t && t.rtScheduled),
    scheduledDate: str(t && t.scheduledDate, 30),
    targetDate: str(t && (t.needsByEnd || t.needsByStart || t.rtStatusDate), 30),
    signedOff: bool(t && t.signedOff),
    signedOffDate: str(t && t.signedOffDate, 30),
    itemCount: Array.isArray(t && t.punch) ? t.punch.length : 0,
    openItems: cap((Array.isArray(t && t.punch) ? t.punch : []).filter((p) => p && !p.done), 10)
      .map((p) => str(p.text, 160)),
  }));
}

// ── matterport: status + the walkthrough links (Koy: headline artifact) ──────
function matterportView(job) {
  const links = (Array.isArray(job.matterportLinks) && job.matterportLinks.length
    ? job.matterportLinks
    : (job.matterportLink ? [{ label: "Main", url: job.matterportLink }] : []))
    .filter((l) => l && typeof l.url === "string" && /^https:\/\//i.test(l.url.trim()));
  return {
    status: str(job.matterportStatus, 20),
    links: cap(links, 6).map((l) => ({ label: str(l.label, 40) || "Walkthrough", url: String(l.url).trim().slice(0, 500) })),
  };
}

// Membership: does this job belong on this link's portal? Default is gcKey
// match, with per-link overrides — jobIdsExclude hides a matched job (office
// privacy control), jobIdsInclude force-adds a job that doesn't match by name
// (typo'd/shared-custody). Exclude wins. Shared by publisher + rebuild so the
// live mirror and a full rebuild can never disagree.
function jobBelongsToLink(jobId, job, link) {
  if (!job || !link) return false;
  const exc = Array.isArray(link.jobIdsExclude) ? link.jobIdsExclude : [];
  if (exc.indexOf(jobId) !== -1) return false;
  const inc = Array.isArray(link.jobIdsInclude) ? link.jobIdsInclude : [];
  return gcKeyOf(job.gc) === link.gcKey || inc.indexOf(jobId) !== -1;
}

// ── THE projection: one job → its portal view (or null to exclude) ──────────
function projectJobForPortal(jobId, job) {
  if (!job || typeof job !== "object") return null;
  if (job.archived === true || job.deleted === true) return null;
  return {
    id: String(jobId),
    name: str(job.name, 80),
    address: str(job.address, 120),
    simproNo: str(job.simproNo, 20),
    updatedAt: str(job.updated_at, 40),
    quickJob: !!job.quickJobStatus,
    quickJobStatus: str(job.quickJobStatus, 20),
    tempPed: bool(job.tempPed),
    rough: {
      stage: str(job.roughStage, 10),
      status: str(job.roughStatus, 20),
      statusDate: str(job.roughStatusDate, 30),
      projectedStart: str(job.roughProjectedStart, 30),
      scheduledEnd: str(job.roughScheduledEnd, 30),
      inspection: str(job.roughInspectionResult, 12),
      inspectionDate: str(job.roughInspectionDate, 30),
      punchOpen: punchOpenCount(job.roughPunch),
    },
    finish: {
      stage: str(job.finishStage, 10),
      status: str(job.finishStatus, 20),
      statusDate: str(job.finishStatusDate, 30),
      projectedStart: str(job.finishProjectedStart, 30),
      scheduledEnd: str(job.finishScheduledEnd, 30),
      inspection: str(job.finalInspectionResult, 12),
      inspectionDate: str(job.finalInspectionDate, 30),
      punchOpen: punchOpenCount(job.finishPunch),
    },
    qc: {
      status: str(job.qcStatus, 20),
      finishStatus: str(job.finishQcStatus, 20),
      items: qcItemsOf(job.roughPunch).concat(qcItemsOf(job.finishPunch)).slice(0, 30),
    },
    matterport: matterportView(job),
    returnTrips: returnTripsView(job.returnTrips),
    questions: questionsView(job),
    changeOrders: {
      count: Array.isArray(job.changeOrders) ? job.changeOrders.length : 0,
      open: (Array.isArray(job.changeOrders) ? job.changeOrders : [])
        .filter((c) => c && !["completed", "converted", "invoiced", "rejected"].includes(String(c.coStatus || ""))).length,
    },
  };
}

module.exports = {
  gcKeyOf,
  stripHtml,
  hashOf,
  makeToken,
  makeSlug,
  cleanLogoUrl,
  jobBelongsToLink,
  projectJobForPortal,
  // exported for tests
  punchOpenCount,
  qcItemsOf,
  questionsView,
  returnTripsView,
  matterportView,
};
