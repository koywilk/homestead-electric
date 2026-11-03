// POs made in Simpro show up on Material Tracking by themselves (SW v596).
// Replaces the old supplier-guessing sync. Koy, 2026-11-02: "if a po is sent from
// simpro it doesnt track in the CC. Can we make that a thing?"
//
// Every 5 minutes (scheduledSimproPOSync) it reads the PO list once. Each PO it
// hasn't handled yet stops at the first line that fits:
//   1. sent from the app (private-notes tag or material_po_log) → leave it alone
//   2. PO # already typed on a card on that job → link it, nothing visible changes
//   3. a card with no PO # and a near-identical list → fill the number in on it
//   4. anything else → a new card (Rough In → Rough, Finish → Finish, commercial job
//      → Materials, Warranty / Generators / the rest → Finish with a label)
// It never matches by supplier alone: that is what bound wrong POs to cards in May.
//
// Once an hour it also looks for receipts: a receipt in Simpro means the material
// is in hand (Koy, 2026-11-02), so a card this pull made or linked gets Picked Up,
// "by Simpro". Once per PO, so someone un-ticking it stays un-ticked. The same pass
// folds a pull-made card into a card someone later typed the same number on, and
// marks a pull-made card when its PO is voided in Simpro.
//
// The hourly run also rewrites the "Simpro POs - Master" Google Sheet: Summary by job,
// All POs (every PO from the start date on, however it got here) and Needs a look.
// A sheet failure is logged and changes nothing else.
//
// Mode lives on settings/simproPoSync: "dry" (default when missing, writes only its
// own lastRun log) | "live" | "off".
//
// Simpro is GET only here. simpro_po_link/{poId} (function-only, the rules' catch-all
// denies clients) remembers every PO handled, written in the same transaction as the
// card, so a removed card stays removed and two runs can't both add one.
"use strict";
const R = require("./rules.js");

const SHEET_ID = "1pxs9kEDbcN5w3_bnGBV4z9DWSpqQhdHuDEexhrt1Rpw";   // shared with the functions' service account
const START_DATE = "2026-10-03";   // Koy: last 30 days, then everything new
const WINDOW_DAYS = 45;            // the list call never reads further back than this
const PAGE_SIZE = 250;
const MAX_PAGES = 12;
const LIST_MATCH = 0.8;            // back test 2026-11-02: 249 right, 0 wrong of 407
const MIN_TOKENS = 3;              // a one-word list can't prove anything
const CARD_BEFORE_DAYS = 45;       // a no-PO card older than this before the PO is another order
const CARD_AFTER_DAYS = 7;
const FOLD_DAYS = 14;
const SYNC_BY = "Simpro";
const SYNC_BUILD = 597;
const COLUMNS = "ID,Stage,Status,Vendor,AssignedTo,DateIssued,DueDate,VendorNotes,PrivateNotes,Archived,CreatedBy";
const LISTS = ["roughMaterials", "finishMaterials", "commMaterials"];
const MADE_FIELDS = ["items", "source", "date", "pickupDate"];   // the ledger keeps these as the pull wrote them
const DAY_MS = 86400000;

const T = (v) => String(v == null ? "" : v).trim();
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", times: "×" };
const decode = (s) => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&([a-z0-9]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));

// Simpro's supplier notes or a card's list, as plain lines.
function plainLines(html) {
  const t = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(div|p|li|ul|ol|h[1-6]|tr)(\s[^>]*)?>/gi, "\n").replace(/<[^>]+>/g, "");
  return decode(t).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
const escLine = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STOP = new Set(["for", "will", "call", "on", "please", "the", "of", "and", "pick", "up", "pickup", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "deliver", "to", "job"]);
function tokens(html) {
  return new Set(plainLines(html).join(" ").toLowerCase().replace(/[^a-z0-9/\-.]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)));
}
// Shared words ÷ all words. Needs both lists to be nearly the same, in both directions.
function listScore(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.size < MIN_TOKENS || B.size < MIN_TOKENS) return 0;
  let n = 0;
  A.forEach((w) => { if (B.has(w)) n++; });
  return n / (A.size + B.size - n);
}

// Every PO number a card's PO box could mean: "7114", "PO-6216", "7250/ 7252",
// "7115 (Under Power Finish Lower Level)".
function typedNumbers(raw) {
  const s = T(raw);
  if (!s) return [];
  const clean = R.cleanPoNo(s);
  if (clean) return [clean];
  return (s.match(/\b\d{3,7}\b/g) || []).map((n) => String(Number(n)));
}

const isFromApp = (po, logNos) => /Command Center|CC-[0-9a-f]{6,}/.test(String(po.PrivateNotes || "")) || !!(logNos && logNos.has(String(po.ID)));
const isGone = (po) => !po || po.Archived === true || /void/i.test(T(po.Stage));
const isOrder = (po) => !isGone(po) && /approved/i.test(T(po.Stage));   // Pending = a draft nobody has ordered yet
const jobNoOf = (po) => { const j = po && po.AssignedTo && po.AssignedTo.Job; return j == null || T(j) === "" ? "" : T(j); };
const ccNameOf = (po) => T(po && po.AssignedTo && po.AssignedTo.CostCenter && po.AssignedTo.CostCenter.Name);
const vendorOf = (po) => T(po && po.Vendor && (po.Vendor.Name || po.Vendor.CompanyName));
const makerOf = (po) => T(po && po.CreatedBy && po.CreatedBy.Name);
const mdy = (iso) => { const m = T(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ""; };

// The app's Source dropdown. Anything else is Other, and the card shows the real name.
function sourceFor(vendor) {
  const v = T(vendor).toLowerCase();
  if (v === "ced") return "CED";
  if (v === "home depot") return "Home Depot";
  if (v === "amazon") return "Amazon";
  if (v === "platt") return "Platt";
  if (v === "ace hardware") return "ACE";
  return "Other";
}

// Which list a new card goes on. The job's division wins: a commercial job has one list.
function listFor(job, ccName) {
  if (job && job.division === "commercial") return { list: "commMaterials", chip: "" };
  const s = T(ccName).toLowerCase();
  if (s.includes("rough")) return { list: "roughMaterials", chip: "" };
  if (s.includes("finish")) return { list: "finishMaterials", chip: "" };
  const m = T(ccName).match(/\(([^)]+)\)/);
  return { list: "finishMaterials", chip: m ? m[1] : T(ccName) };
}

const isInactive = (job) => !job || !!(job.archived || job.deleted || job.archivedAt || job.type === "quote");

// A no-PO card worth comparing: the crew's own, made around when the PO was.
function cardInWindow(card, po) {
  const made = Number(card.id);
  const issued = Date.parse(T(po.DateIssued));
  if (!Number.isFinite(made) || made < 1e12 || !Number.isFinite(issued)) return true;
  return made >= issued - CARD_BEFORE_DAYS * DAY_MS && made <= issued + CARD_AFTER_DAYS * DAY_MS;
}

function buildCard(po, job, { lines = [], nowIso, receiptDate = "" }) {
  const vendor = vendorOf(po), ccName = ccNameOf(po), date = mdy(po.DateIssued), by = makerOf(po);
  const { chip } = listFor(job, ccName);
  const fromNotes = plainLines(po.VendorNotes);
  const card = {
    id: `simpro_${po.ID}`, date, po: String(po.ID), pickupDate: mdy(po.DueDate), source: sourceFor(vendor),
    items: (fromNotes.length ? fromNotes : lines).map(escLine).join("<br>"),
    needsOrder: false, ordered: true, orderedBy: by || SYNC_BY, orderedAt: date, pickedUp: false,
    simproPulled: true, simproPoId: String(po.ID), simproSupplier: vendor, simproMadeBy: by, simproCostCenter: ccName,
    simproStatus: T(po.Status && po.Status.Name), simproDateIssued: T(po.DateIssued), simproSyncedAt: nowIso,
  };
  if (chip) card.simproChip = chip;
  if (receiptDate) { card.pickedUp = true; card.pickedUpBy = SYNC_BY; card.pickedUpAt = receiptDate; }
  return card;
}

// Decide one PO against the job's live cards. Pure. lists = { roughMaterials: [...], ... }
function planPo(po, job, lists, { nowIso, lines = [], receiptDate = "" }) {
  const id = String(po.ID);
  const all = [];
  LISTS.forEach((list) => (lists[list] || []).forEach((c) => { if (c && c.id != null) all.push({ list, c }); }));
  const hasReceipt = (c) => (receiptDate && !c.pickedUp && !c.deliveredToShop ? { pickedUp: true, pickedUpBy: SYNC_BY, pickedUpAt: receiptDate } : {});

  // Typed on a card already: link it wherever the crew put it. Nothing visible changes.
  const typed = all.find((x) => typedNumbers(x.c.po).includes(id));
  if (typed) {
    const patch = { ...(T(typed.c.simproPoId) ? {} : { simproPoId: id }), ...hasReceipt(typed.c) };
    return { how: "typed", list: typed.list, cardId: typed.c.id, patch };
  }
  // Near-identical list on a card with no PO #, and only one such card.
  const source = sourceFor(vendorOf(po));
  const cands = all.filter((x) => !T(x.c.po) && !x.c.simproPulled && !x.c.poSentVia && (!T(x.c.source) || T(x.c.source) === source) && cardInWindow(x.c, po))
    .map((x) => ({ ...x, score: listScore(po.VendorNotes, x.c.items) })).filter((x) => x.score >= LIST_MATCH);
  if (cands.length === 1) {
    const { list, c, score } = cands[0];
    const date = mdy(po.DateIssued), by = makerOf(po);
    const patch = {
      po: id, simproPoId: id, simproLinked: true, simproSupplier: vendorOf(po), simproMadeBy: by, simproCostCenter: ccNameOf(po),
      simproStatus: T(po.Status && po.Status.Name), simproDateIssued: T(po.DateIssued), simproSyncedAt: nowIso,
      ...(T(c.date) ? {} : { date }), ...(T(c.source) ? {} : { source }), ...(T(c.pickupDate) || !mdy(po.DueDate) ? {} : { pickupDate: mdy(po.DueDate) }),
      ...(c.ordered ? {} : { ordered: true, orderedBy: T(c.orderedBy) || by || SYNC_BY, orderedAt: T(c.orderedAt) || date }),
      ...hasReceipt(c),
    };
    return { how: "linked", list, cardId: c.id, patch, score: Math.round(score * 100) / 100 };
  }
  const { list } = listFor(job, ccNameOf(po));
  const card = buildCard(po, job, { lines, nowIso, receiptDate });
  return { how: "created", list, cardId: card.id, card, tied: cands.length };
}

// A pull-made card nobody has worked, whose number someone has since typed on their own card.
function planFold(lists, cardId, poId, made) {
  if (!made) return null;
  const all = [];
  LISTS.forEach((list) => (lists[list] || []).forEach((c) => { if (c && c.id != null) all.push({ list, c }); }));
  const mine = all.find((x) => x.c.id === cardId && x.c.simproPulled);
  if (!mine) return null;
  const c = mine.c;
  const edited = MADE_FIELDS.some((k) => T(c[k]) !== T(made[k]));
  const worked = edited || c.deliveredToShop || (c.pickedUp && c.pickedUpBy !== SYNC_BY) || (Array.isArray(c.receipts) && c.receipts.length) || T(c.po) !== String(poId) || c.needsOrder;
  if (worked) return null;
  const other = all.find((x) => x.c.id !== cardId && !x.c.simproPulled && typedNumbers(x.c.po).includes(String(poId)));
  if (!other) return null;
  return { from: mine.list, to: other.list, otherId: other.c.id, carryPick: !!(c.pickedUp && !other.c.pickedUp && !other.c.deliveredToShop), pickedUpAt: c.pickedUpAt || "" };
}

// ── The Google Sheet. Pure: what Simpro and the jobs say now, as rows. ──
const LIST_NAME = { roughMaterials: "Rough", finishMaterials: "Finish", commMaterials: "Materials" };
const HOW_NAME = { created: "New from Simpro", linked: "Number filled in", typed: "Typed on a card", app: "Sent from the app" };
const LIST_CHARS = 500;
// Google counts dates in days from 12/30/1899, so the column sorts as dates.
const sheetDate = (iso) => { const t = Date.parse(`${T(iso).slice(0, 10)}T00:00:00Z`); return Number.isFinite(t) ? Math.round(t / DAY_MS) + 25569 : ""; };
const dateFromMdy = (mdyStr) => { const m = T(mdyStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
const oneLine = (html) => plainLines(html).join(" · ").slice(0, LIST_CHARS);
function cardStatus(c) {
  if (!c) return "";
  if (c.simproVoided) return "Voided in Simpro";
  if (c.pickedUp) return "Picked Up";
  if (c.deliveredToShop) return "Delivered to Shop";
  if (c.ordered) return "Order Sent";
  return c.needsOrder ? "Need to Order" : "Saved";
}
function pickedText(c) {
  if (!c) return "";
  if (c.pickedUp) return [T(c.pickedUpBy), T(c.pickedUpAt)].filter(Boolean).join(" · ") || "Yes";
  if (c.deliveredToShop) return [T(c.deliveredToShopBy), T(c.deliveredToShopAt)].filter(Boolean).join(" · ") || "Yes";
  return "";
}
// pos = Simpro's list. ledger = simpro_po_link docs with their id. jobs = [{ id, data }].
function buildSheetRows({ pos, ledger, jobs, logNos, nowIso, startDate }) {
  const ledById = new Map(ledger.map((l) => [String(l.id), l]));
  const openByNo = new Map(), byId = new Map(), typedOn = new Map();
  jobs.forEach(({ id, data }) => {
    if (!data) return;
    byId.set(id, data);
    const no = T(data.simproNo);
    if (no && !isInactive(data)) { if (!openByNo.has(no)) openByNo.set(no, []); openByNo.get(no).push(id); }
    LISTS.forEach((list) => (Array.isArray(data[list]) ? data[list] : []).forEach((c) => {
      if (!c) return;
      typedNumbers(c.po).forEach((n) => { if (!typedOn.has(n)) typedOn.set(n, []); typedOn.get(n).push({ jobId: id, list, card: c }); });
    }));
  });
  const all = [], needs = [];
  const look = (what, id, iso, jobNo, job, vendor, todo) => needs.push({ iso, row: [what, Number(id), sheetDate(iso), jobNo === "" ? "" : Number(jobNo), job, vendor, todo] });
  const seen = new Set();
  pos.filter((p) => jobNoOf(p) && isOrder(p)).forEach((p) => {
    const id = String(p.ID), jobNo = jobNoOf(p), led = ledById.get(id);
    seen.add(id);
    const open = openByNo.get(jobNo) || [];
    const jobId = (led && led.jobId) || (open.length === 1 ? open[0] : "");
    const job = jobId ? byId.get(jobId) : null;
    const hits = typedOn.get(id) || [];
    const fromLedger = led && led.list && led.cardId != null && job ? (Array.isArray(job[led.list]) ? job[led.list] : []).find((c) => c && c.id === led.cardId) : null;
    const here = hits.find((h) => h.jobId === jobId);
    const card = fromLedger || (here && here.card) || null;
    const list = fromLedger ? led.list : (here ? here.list : "");
    const fromApp = isFromApp(p, logNos) || (led && led.how === "app");
    const waiting = !led && !fromApp;
    const how = fromApp ? HOW_NAME.app : led ? (HOW_NAME[led.how] || led.how) : "Waiting";
    const jobName = job ? T(job.name) : "";
    const status = card ? cardStatus(card) : waiting ? "Waiting" : "No card has it";
    const items = oneLine(card && T(card.items) ? card.items : p.VendorNotes);
    all.push([Number(id), sheetDate(p.DateIssued), Number(jobNo), jobName || "(no open job in the app)", vendorOf(p), LIST_NAME[list] || "", ccNameOf(p), makerOf(p), how, status, pickedText(card), items]);
    if (waiting) {
      look(open.length > 1 ? `${open.length} job cards share this Simpro #` : "No open job has this Simpro #", id, T(p.DateIssued), jobNo, jobName, vendorOf(p),
        open.length > 1 ? "Fix the Simpro # so only one job card has it. The PO comes in by itself." : "Add the job to the app, or fix its Simpro #. The PO comes in by itself.");
    }
    if (fromApp && !card) {
      look("Sent from the app, but no card has the number", id, T(p.DateIssued), jobNo, jobName, vendorOf(p), `The PO went out, but the number isn't on a card on this job. Type ${id} on the card it belongs to.`);
    }
    const other = hits.find((h) => h.jobId !== jobId);
    if (other) {
      const otherName = T(byId.get(other.jobId) && byId.get(other.jobId).name);
      look("Typed on another job's card", id, T(p.DateIssued), jobNo, jobName, vendorOf(p), `The number is on ${otherName}'s card, but Simpro has this PO on job ${jobNo}. Fix the number on that card, or move the PO in Simpro.`);
    }
  });
  // A PO voided in Simpro drops off its list, so it comes from the card the pull made.
  ledger.filter((l) => l.voidedAt && !seen.has(String(l.id))).forEach((l) => {
    const job = byId.get(l.jobId);
    const c = job && (Array.isArray(job[l.list]) ? job[l.list] : []).find((x) => x && x.id === l.cardId);
    if (!c) return;
    const iso = T(l.dateIssued) || dateFromMdy(c.date);
    all.push([Number(l.id), sheetDate(iso), Number(l.jobNo), T(job.name), T(c.simproSupplier), LIST_NAME[l.list] || "", T(c.simproCostCenter), T(c.simproMadeBy), HOW_NAME[l.how] || l.how, "Voided in Simpro", pickedText(c), oneLine(c.items)]);
    look("Voided in Simpro", l.id, iso, l.jobNo, T(job.name), T(c.simproSupplier), "The card is still on the job. Remove it if nobody needs it.");
  });
  all.sort((a, b) => b[0] - a[0]);
  needs.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));

  const lookCount = new Map();
  needs.forEach((n) => lookCount.set(String(n.row[3]), (lookCount.get(String(n.row[3])) || 0) + 1));
  const COL = { "New from Simpro": 3, "Typed on a card": 4, "Number filled in": 5, "Sent from the app": 6 };
  const blank = (name, no) => [name, no, 0, 0, 0, 0, 0, 0, 0, 0];
  const sum = new Map(), total = blank("All jobs", "");
  all.forEach((r) => {
    const key = `${r[2]}|${r[3]}`;
    if (!sum.has(key)) sum.set(key, blank(r[3], r[2]));
    [sum.get(key), total].forEach((s) => {
      s[2]++;
      if (COL[r[8]]) s[COL[r[8]]]++;
      if (r[9] === "Order Sent") s[7]++;
      if (r[9] === "Picked Up" || r[9] === "Delivered to Shop") s[8]++;
    });
  });
  sum.forEach((s) => { s[9] = lookCount.get(String(s[1])) || 0; });
  total[9] = needs.length;
  const when = new Date(nowIso).toLocaleString("en-US", { timeZone: "America/Denver", month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return {
    note: `Every PO from ${mdy(startDate)} on. Updated ${when}. The app rewrites this sheet every hour, so edits here won't stay.`,
    summary: [total, ...[...sum.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))],
    all, needs: needs.map((n) => n.row),
    totals: { pos: total[2], created: total[3], typed: total[4], linked: total[5], fromApp: total[6], orderSent: total[7], pickedUp: total[8], needsLook: needs.length },
  };
}

const patchCard = (arr, id, patch) => (arr || []).map((c) => (c && c.id === id ? { ...c, ...patch } : c));

module.exports = function makeSimproPull({ functions, db, simproReqWithRetry, requireAppKey, getSheets = null }) {
  const HttpsError = functions.https.HttpsError;
  const CFG = () => db.collection("settings").doc("simproPoSync");
  const LEDGER = () => db.collection("simpro_po_link");
  const JOBS = () => db.collection("jobs");
  const okList = (r) => r && r.ok && Array.isArray(r.data);
  // updated_at has to be the moment of THIS write, later than any before it. The app
  // re-seeds an open job when the stamp changes and refuses a baseline with an older
  // stamp, so a run-start or repeated stamp could undo a tick or bring back a removed card.
  let lastStampMs = 0;
  const freshIso = () => { lastStampMs = Math.max(Date.now(), lastStampMs + 1); return new Date(lastStampMs).toISOString(); };
  const stamp = () => ({ updated_at: freshIso(), saved_by: "Simpro PO pull", device: "server", tab: "simpro-po",
    // Same version-lock stamp shape the app writes (app_build int + a fresh w).
    app_build: SYNC_BUILD, w: `${SYNC_BUILD}.po${Math.random().toString(36).slice(2, 10)}` });

  async function loadCfg() {
    let c = {};
    try { const d = await CFG().get(); c = d.exists ? (d.data() || {}) : {}; } catch (e) {}
    const mode = ["off", "dry", "live"].includes(T(c.mode)) ? T(c.mode) : "dry";
    return { mode, startDate: T(c.startDate) || START_DATE, waiting: (c.waiting || []).map(String), sheetId: T(c.sheetId) || SHEET_ID };
  }

  async function fetchPos({ start, jobNo }) {
    // gt() leaves the day itself out, so ask from the day before.
    const after = new Date(Date.parse(start) - DAY_MS).toISOString().slice(0, 10);
    const filter = jobNo ? `AssignedTo.Job=${encodeURIComponent(jobNo)}&` : "";
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await simproReqWithRetry("GET", `/vendorOrders/?${filter}DateIssued=gt(${after})&orderby=-ID&pageSize=${PAGE_SIZE}&page=${page}&columns=${COLUMNS}`);
      if (!okList(r)) throw new Error(`Simpro PO list failed (${r && r.status}) on page ${page}`);
      out.push(...r.data);
      if (r.data.length < PAGE_SIZE) return out;
    }
    throw new Error(`Simpro PO list ran past ${MAX_PAGES} pages`);
  }

  async function logNumbers() {
    const s = await db.collection("material_po_log").get();
    const out = new Set();
    s.forEach((d) => {
      const x = d.data() || {};
      [x.poNo, x.simproPoId].forEach((v) => { if (T(v)) out.add(T(v)); });
      [x.poNos, x.emailedPoNos].forEach((a) => (Array.isArray(a) ? a : []).forEach((v) => { if (T(v)) out.add(T(v)); }));
    });
    return out;
  }

  async function receiptDateOf(poId) {
    const r = await simproReqWithRetry("GET", `/vendorOrders/${poId}/receipts/`);
    if (!okList(r) || !r.data.length) return "";
    return mdy(r.data[0].DateIssued || r.data[0].DateCreated) || mdy(new Date().toISOString());
  }

  async function linesOf(poId) {
    const r = await simproReqWithRetry("GET", `/vendorOrders/${poId}/catalogs/?columns=Catalog,Allocations`);
    if (!r || r.status === 429 || r.status >= 500) throw new Error(`Simpro PO ${poId} lines failed (${r && r.status})`);   // retry next run, don't make a blank card for good
    if (!okList(r)) return [];
    return r.data.map((l) => {
      const qty = (l.Allocations || []).reduce((s, a) => s + (Number(a && a.Quantity && a.Quantity.Total) || 0), 0);
      const name = T(l.Catalog && l.Catalog.Name);
      return name ? (qty ? `${qty} x ${name}` : name) : "";
    }).filter(Boolean);
  }

  // One job's new POs, in one transaction against the live job.
  async function applyJob({ jobId, jobNo, pos, extras, mode }) {
    const ref = JOBS().doc(jobId);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap.exists ? (snap.data() || {}) : null;
      const job = raw && raw.data;
      if (isInactive(job)) return { skipped: true, rows: [] };
      const nowIso = new Date().toISOString();
      const seen = await Promise.all(pos.map((p) => tx.get(LEDGER().doc(String(p.ID)))));
      const lists = {};
      LISTS.forEach((l) => { lists[l] = Array.isArray(job[l]) ? job[l] : []; });
      const changed = new Set();
      const rows = [], ledger = [];
      pos.forEach((po, i) => {
        if (seen[i].exists) return;
        const ex = extras[String(po.ID)] || {};
        const plan = planPo(po, job, lists, { nowIso, lines: ex.lines, receiptDate: ex.receiptDate });
        if (plan.how === "created") { lists[plan.list] = [...lists[plan.list], plan.card]; changed.add(plan.list); }
        else if (Object.keys(plan.patch).length) { lists[plan.list] = patchCard(lists[plan.list], plan.cardId, plan.patch); changed.add(plan.list); }
        const received = !!(ex.receiptDate);
        ledger.push({ id: String(po.ID), doc: { poId: Number(po.ID), dateIssued: T(po.DateIssued), jobId, jobNo, list: plan.list, cardId: plan.cardId, how: plan.how, at: nowIso, ...(received ? { receiptAt: nowIso } : {}), ...(plan.how === "created" ? { made: Object.fromEntries(MADE_FIELDS.map((k) => [k, plan.card[k]])) } : {}) } });
        rows.push({ po: Number(po.ID), job: T(job.name), how: plan.how, list: plan.list, vendor: vendorOf(po), cc: ccNameOf(po), date: mdy(po.DateIssued), by: makerOf(po), received, ...(plan.score ? { score: plan.score } : {}) });
      });
      if (mode === "live" && ledger.length) {
        if (changed.size) {
          const upd = stamp();
          changed.forEach((l) => { upd[`data.${l}`] = lists[l]; });
          tx.update(ref, upd);
        }
        ledger.forEach((l) => tx.set(LEDGER().doc(l.id), l.doc));
      }
      return { rows };
    });
  }

  // Hourly: receipts → Picked Up, typed-later fold-ins, voided POs. Live mode only.
  async function hourlyOne(led, { jobsById, listedIds, out }) {
    const nowIso = new Date().toISOString();
    const { id, how, jobId, list, cardId, at, made, receiptAt, voidedAt, settledAt } = led;
    if (!["created", "linked", "typed"].includes(how)) return;
    const job = jobsById.get(jobId);
    if (isInactive(job)) return;
    const card = (Array.isArray(job[list]) ? job[list] : []).find((c) => c && c.id === cardId);
    if (!card) return;

    if (how === "created" && Date.now() - (Date.parse(at) || 0) < FOLD_DAYS * DAY_MS && planFold(job, cardId, id, made)) {
      const did = await db.runTransaction(async (tx) => {
        const ref = JOBS().doc(jobId);
        const raw = (await tx.get(ref)).data() || {};
        const live = raw.data || {};
        const f = planFold(live, cardId, id, made);
        if (!f) return false;
        const lists = {};
        LISTS.forEach((l) => { lists[l] = Array.isArray(live[l]) ? live[l] : []; });
        lists[f.from] = lists[f.from].filter((c) => !(c && c.id === cardId));
        if (f.carryPick) lists[f.to] = patchCard(lists[f.to], f.otherId, { pickedUp: true, pickedUpBy: SYNC_BY, pickedUpAt: f.pickedUpAt });
        const upd = stamp();
        [f.from, f.to].forEach((l) => { upd[`data.${l}`] = lists[l]; });
        tx.update(ref, upd);
        tx.set(LEDGER().doc(id), { how: "typed", list: f.to, cardId: f.otherId, foldedAt: nowIso }, { merge: true });
        return true;
      });
      if (did) { out.folded++; return; }
    }

    if (!listedIds.has(id) && !voidedAt && how === "created") {
      const r = await simproReqWithRetry("GET", `/vendorOrders/${id}`);
      if (r && (r.status === 404 || (r.ok && isGone(r.data)))) {
        await db.runTransaction(async (tx) => {
          const ref = JOBS().doc(jobId);
          const raw = (await tx.get(ref)).data() || {};
          const arr = raw.data && raw.data[list];
          if (!Array.isArray(arr)) return;
          tx.update(ref, { ...stamp(), [`data.${list}`]: patchCard(arr, cardId, { simproVoided: true }) });
          tx.set(LEDGER().doc(id), { voidedAt: nowIso }, { merge: true });
        });
        out.voided++;
      }
      return;
    }

    if (voidedAt || receiptAt || settledAt) return;
    // A person got here first: their call stands from now on, even if they un-tick it later.
    if (card.pickedUp || card.deliveredToShop) { await LEDGER().doc(id).set({ settledAt: nowIso }, { merge: true }); return; }
    const when = await receiptDateOf(id);
    if (!when) return;
    await db.runTransaction(async (tx) => {
      const ref = JOBS().doc(jobId);
      const raw = (await tx.get(ref)).data() || {};
      const arr = raw.data && raw.data[list];
      const cur = Array.isArray(arr) ? arr.find((c) => c && c.id === cardId) : null;
      if (cur && !cur.pickedUp && !cur.deliveredToShop) {
        tx.update(ref, { ...stamp(), [`data.${list}`]: patchCard(arr, cardId, { pickedUp: true, pickedUpBy: SYNC_BY, pickedUpAt: when }) });
        out.picked++;
      }
      tx.set(LEDGER().doc(id), { receiptAt: nowIso }, { merge: true });
    });
  }

  // Each row on its own, so one job's failure can't stop the rest or repeat forever.
  async function hourly({ seenDocs, jobsById, listedIds }) {
    const out = { picked: 0, folded: 0, voided: 0, errors: [] };
    for (const led of seenDocs) {
      try { await hourlyOne(led, { jobsById, listedIds, out }); }
      catch (e) {
        out.errors.push({ po: led.id, jobId: led.jobId || "", error: String(e.message || e).slice(0, 160) });
        functions.logger.error("[simproPull] hourly failed", { po: led.id, error: String(e.message || e) });
      }
    }
    return out;
  }

  // Values only (RAW, so a PO's notes can't become a formula): the look of the sheet was
  // set once by hand. New rows go in first and old ones are cleared after, so a failed
  // write leaves the last good sheet.
  async function refreshSheet(cfg) {
    if (!getSheets) return null;
    const pos = await fetchPos({ start: cfg.startDate });
    const [ledSnap, jobSnap, logNos] = [await LEDGER().where("dateIssued", ">=", cfg.startDate).get(), await JOBS().get(), await logNumbers()];
    const jobs = [];
    jobSnap.forEach((d) => jobs.push({ id: d.id, data: (d.data() || {}).data }));
    const built = buildSheetRows({ pos, ledger: ledSnap.docs.map((d) => ({ id: d.id, ...d.data() })), jobs, logNos, nowIso: new Date().toISOString(), startDate: cfg.startDate });
    const sheets = getSheets();
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: cfg.sheetId, requestBody: { valueInputOption: "RAW", data: [
      { range: "Summary!A1", values: [[built.note]] },
      { range: "Summary!A3", values: built.summary },
      ...(built.all.length ? [{ range: "'All POs'!A2", values: built.all }] : []),
      ...(built.needs.length ? [{ range: "'Needs a look'!A2", values: built.needs }] : []),
    ] } });
    await sheets.spreadsheets.values.batchClear({ spreadsheetId: cfg.sheetId, requestBody: { ranges: [
      `Summary!A${3 + built.summary.length}:J`, `'All POs'!A${2 + built.all.length}:L`, `'Needs a look'!A${2 + built.needs.length}:G`,
    ] } });
    return built;
  }

  // full = the hourly run. jobNo = one job only (the callable).
  async function run({ full = false, jobNo = "" } = {}) {
    const nowIso = new Date().toISOString();
    const cfg = await loadCfg();
    if (cfg.mode === "off") return { ok: true, mode: "off" };
    if (cfg.mode === "dry" && !full && !jobNo) return { ok: true, mode: "dry", skipped: true };   // watch mode only looks hourly
    const earliest = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
    const start = cfg.startDate > earliest ? cfg.startDate : earliest;

    let pos;
    try { pos = await fetchPos({ start, jobNo }); }
    catch (e) {
      functions.logger.warn("[simproPull] list failed", { error: String(e.message || e) });
      await CFG().set({ lastErrorAt: nowIso, lastError: String(e.message || e).slice(0, 300) }, { merge: true });
      return { ok: false, error: String(e.message || e) };
    }
    const listed = pos.filter((p) => jobNoOf(p) && isOrder(p));
    const listedIds = new Set(listed.map((p) => String(p.ID)));
    const ledSnap = await LEDGER().where("dateIssued", ">=", start).get();
    const seenDocs = ledSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const seenIds = new Set(seenDocs.map((d) => d.id));
    const waiting = new Set(cfg.waiting);
    const fresh = listed.filter((p) => !seenIds.has(String(p.ID)) && (full || jobNo || !waiting.has(String(p.ID))));
    if (!fresh.length && !full) return { ok: true, mode: cfg.mode, added: 0 };

    const logNos = fresh.some((p) => !isFromApp(p, null)) ? await logNumbers() : new Set();
    const fromApp = fresh.filter((p) => isFromApp(p, logNos));
    const candidates = fresh.filter((p) => !isFromApp(p, logNos));
    if (cfg.mode === "live") await Promise.all(fromApp.map((p) => LEDGER().doc(String(p.ID)).set({ poId: Number(p.ID), dateIssued: T(p.DateIssued), jobNo: jobNoOf(p), how: "app", at: nowIso })));
    if (!candidates.length && !full) return { ok: true, mode: cfg.mode, added: 0, fromApp: fromApp.length };

    const snap = await JOBS().get();
    const bySimproNo = new Map(), jobsById = new Map();
    snap.forEach((d) => {
      const job = (d.data() || {}).data;
      if (!job) return;
      jobsById.set(d.id, job);
      const no = T(job.simproNo);
      if (!no || isInactive(job)) return;   // an archived copy can't hold up the live job
      if (!bySimproNo.has(no)) bySimproNo.set(no, []);
      bySimproNo.get(no).push(d.id);
    });

    const groups = new Map(), nextWaiting = [];
    const skips = [];
    candidates.forEach((p) => {
      const ids = bySimproNo.get(jobNoOf(p)) || [];
      if (ids.length !== 1) {   // never guess: no open job, or a number two open jobs share
        nextWaiting.push(String(p.ID));
        skips.push({ po: Number(p.ID), jobNo: jobNoOf(p), why: ids.length > 1 ? `${ids.length} app jobs share this Simpro #` : "no open job in the app has this Simpro #" });
        return;
      }
      if (!groups.has(ids[0])) groups.set(ids[0], []);
      groups.get(ids[0]).push(p);
    });

    const rows = [], errors = [];
    for (const [jobId, list] of groups) {
      list.sort((a, b) => Number(a.ID) - Number(b.ID));   // oldest first: the first PO gets the matching card
      try {
        const extras = {};
        for (const p of list) {
          extras[String(p.ID)] = { receiptDate: await receiptDateOf(p.ID), lines: plainLines(p.VendorNotes).length ? [] : await linesOf(p.ID) };
        }
        const res = await applyJob({ jobId, jobNo: jobNoOf(list[0]), pos: list, extras, mode: cfg.mode });
        rows.push(...res.rows);
      } catch (e) {
        errors.push({ jobId, error: String(e.message || e).slice(0, 160) });
        functions.logger.error("[simproPull] job failed", { jobId, error: String(e.message || e) });
      }
    }

    const extra = full && cfg.mode === "live" && !jobNo ? await hourly({ seenDocs, jobsById, listedIds }) : { picked: 0, folded: 0, voided: 0, errors: [] };
    errors.push(...extra.errors);
    const counts = { listed: listed.length, fromApp: fromApp.length, typed: 0, linked: 0, created: 0, waiting: skips.length, errors: errors.length, picked: extra.picked, folded: extra.folded, voided: extra.voided };
    rows.forEach((r) => { counts[r.how]++; });
    let sheetInfo = {};
    if (full && !jobNo && getSheets) {
      try { const b = await refreshSheet(cfg); sheetInfo = { sheetId: cfg.sheetId, sheetAt: new Date().toISOString(), totals: b.totals, sheetError: "" }; }
      catch (e) {
        sheetInfo = { sheetError: String(e.message || e).slice(0, 200) };
        functions.logger.error("[simproPull] sheet failed", { error: String(e.message || e) });
      }
    }
    if (!jobNo) {
      await CFG().set({ ...sheetInfo, waiting: full ? nextWaiting : [...new Set([...cfg.waiting, ...nextWaiting])],
        lastRun: { at: new Date().toISOString(), full, counts, rows: rows.slice(0, 150), skips: skips.slice(0, 40), errors: errors.slice(0, 20) } }, { merge: true });
    }
    functions.logger.info("[simproPull] done", { mode: cfg.mode, full, ...counts });
    return { ok: true, mode: cfg.mode, counts, rows, skips, errors };
  }

  const scheduledSimproPOSync = functions
    .runWith({ timeoutSeconds: 540, memory: "512MB" })
    .pubsub.schedule("*/5 * * * *")
    .timeZone("America/Denver")
    .onRun(async () => { await run({ full: new Date().getMinutes() < 5 }); return null; });

  // Kept so the deployed name runs the new rules, never the old supplier matching.
  const syncSimproPOsForJob = functions
    .runWith({ timeoutSeconds: 120, memory: "256MB" })
    .https.onCall(async (data) => {
      requireAppKey(data);
      const simproJobNo = T(data && data.simproJobNo);
      if (!simproJobNo) throw new HttpsError("invalid-argument", "simproJobNo required");
      return run({ jobNo: simproJobNo });
    });

  return { scheduledSimproPOSync, syncSimproPOsForJob, run, refreshSheet, loadCfg };
};
Object.assign(module.exports, { START_DATE, LIST_MATCH, plainLines, listScore, typedNumbers, isFromApp, sourceFor, listFor, planPo, planFold, buildCard, mdy, buildSheetRows, sheetDate, SHEET_ID });
