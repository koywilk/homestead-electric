"use strict";
// Duet write access (D9), ship 8: material cards on the Materials tab and the
// purchase-order senders. PURE planners — given the live job doc and what Duet
// asked, they return either a refusal or exactly what to write, copied from the
// app's own handlers in src/App.js (mapped 2026-11-03, main a1dbe8d / ship-7
// e05796c; the notes folder's "08-10 map" §A is the line-by-line source):
//   • the three lists: data.roughMaterials / finishMaterials / commMaterials
//     (comm = the commercial Materials tab, v539 — commercial jobs only).
//   • + Add PO (MaterialOrders ~L15176): the card literal
//     {id:uid(), date:"", po:"", pickupDate:"", source:"", items:"", pickedUp:false, needsOrder:true}
//     appended; SOURCES = ["","Shop","Home Depot","CED","Platt","Amazon","ACE","Lowe's","Other"].
//   • the add-material helpers (onAddMaterial ~L33973, onAddToPO ~L34053): the
//     NEWEST open card with the same source — needsOrder && !ordered &&
//     !pickedUp — gets `items ? items.replace(/(<br\s*\/?>)+$/i,'')+'<br>'+text
//     : text`; otherwise a new card with that source. items is HTML the card
//     renders, one line per <br>; every line Duet sends goes through the app's
//     escapeHtml (functions/escapeHtml.js = src/escapeHtml.js) first.
//   • the field writers (upd → u({<list>}) ~L15184): source (the select), date /
//     pickupDate (DateInp stores M/D/YYYY), po (typed), items, needsOrder.
//   • the checkboxes (~L15500–15555): on → {<f>:true, <f>By: name, <f>At:
//     new Date().toLocaleDateString("en-US")}, off → {<f>:false, <f>By:"",
//     <f>At:""} for ordered / pickedUp / deliveredToShop. Receipts are NOT
//     written here (they are the Simpro attachment path, attachStoreReceipt).
//   • the send sheet's patch AFTER sendMaterialPO answers (~L15730–15738):
//     {po, simproPoId, poSentVia:"app", poSentMode, poSentBy, poSentAt (M/D/YYYY),
//     poCostCenter, poEmailOk, poEmailedTo (comma-joined), poCustom?, comm:
//     chargeCcId / chargeCcName} + {ordered:true, orderedBy, orderedAt} when the
//     kind isn't email or the email went + date (today) if the live card's is
//     empty + pickupDate (the sheet's date) if the live card's is empty.
//     poSentVia stays "app": App.js switches on it for the Send / Resend email
//     button (~L15323) and the PO form button (~L15340); "duet" would hide both
//     on a Duet-sent card. The Duet origin is the additive poSentFrom:"duet".
//   • the PO preview: ONLY the pure rules of functions/materialPO/rules.js —
//     supplierRule, itemsToLines, getMode, cleanCustom, cleanCopyTo,
//     cardDateToIso, pickupLine, recipients, logKey — plus the mode / testTo /
//     bids the send factory's loadCfg reads (gc_config/material_po, and ONLY
//     soakTo from gc_config/mail — never the key). The preview's hash binds the
//     send: supplier, lines, mode, pickup, CC list, recipients.
// No Firestore and no Simpro here: api.js runs the transaction and the real
// send factory; scripts/duet-materials-test.js drives these with fixtures.
const crypto = require("crypto");
const R = require("../materialPO/rules.js");
const { escapeHtml } = require("../escapeHtml.js");
const { newItemId, mdy, jobGate } = require("./jobItems.js");
const { ME, cleanText } = require("./needs.js");
const { toMdy } = require("./stages.js");

const refuse = (why) => ({ refused: why });
const LISTS = { rough: "roughMaterials", finish: "finishMaterials", comm: "commMaterials" };
const PHASES = Object.keys(LISTS);
const SOURCES = ["", "Shop", "Home Depot", "CED", "Platt", "Amazon", "ACE", "Lowe's", "Other"];   // MaterialOrders ~L15175
const TICK_FIELDS = ["ordered", "pickedUp", "deliveredToShop"];
const MAX_LINES = 200;
const PREVIEW_TTL_MS = 15 * 60e3;
const CARD_ID = /^[A-Za-z0-9_-]{1,40}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const sameId = (a, b) => a != null && String(a) === String(b);

// The app's rule for a card that still takes material (and the Up Next counts).
const isOpen = (o) => !!(o && o.needsOrder && !o.ordered && !o.pickedUp);
// + Add PO's literal.
const newCard = (id, source, items) => ({ id, date: "", po: "", pickupDate: "", source: source || "", items: items || "", pickedUp: false, needsOrder: true });
// The helpers' append.
const appendHtml = (items, text) => (items ? String(items).replace(/(<br\s*\/?>)+$/i, "") + "<br>" + text : text);
// Plain lines → the card's HTML: each line escaped as the app escapes adopted text, joined by <br>.
function linesToHtml(lines) {
  const r = cleanLines(lines, "items");
  return r.refused ? r : { html: r.lines.map(escapeHtml).join("<br>"), lines: r.lines };
}
function cleanLines(v, what) {
  if (!Array.isArray(v)) return refuse(`${what} must be a list of plain text lines (one per material).`);
  const out = [];
  for (const l of v) {
    if (typeof l !== "string" && typeof l !== "number") return refuse(`${what} must be plain text lines.`);
    const t = cleanText(l).replace(/\s*\n\s*/g, " ").trim();
    if (t) out.push(t);
  }
  if (!out.length) return refuse(`${what} needs at least one line.`);
  if (out.length > MAX_LINES) return refuse(`${what} can hold at most ${MAX_LINES} lines.`);
  return { lines: out };
}
// commMaterials only exists on the commercial Materials tab (v539).
const commOk = (job) => String(job.division || "") === "commercial";
function phaseOf(args, job) {
  const phase = String(args.phase || "");
  if (!PHASES.includes(phase)) return refuse(`phase must be one of ${PHASES.join(", ")}.`);
  if (phase === "comm" && !commOk(job)) return refuse(`${job.name || "That job"} isn't a commercial job, so it has no commercial Materials list — use rough or finish. Nothing was written.`);
  return { phase, list: LISTS[phase] };
}
const cards = (job, list) => (Array.isArray(job[list]) ? job[list] : []);
// Locate one card by id across the three lists.
function findCard(job, cardId) {
  for (const phase of PHASES) {
    const list = LISTS[phase];
    const arr = cards(job, list);
    const i = arr.findIndex(c => c && sameId(c.id, cardId));
    if (i >= 0) return { phase, list, index: i, card: arr[i], arr };
  }
  return null;
}
const cardArg = (args) => {
  const id = String(args.cardId || "");
  return CARD_ID.test(id) ? id : null;
};
const noCard = (job, cardId) => refuse(`No material card ${cardId} on ${job.name || "that job"} (cc_list_material_cards shows the cardId). Nothing was written.`);
const todayMdy = (ctx) => mdy(ctx.nowIso, ctx.tz);
const sourceArg = (v) => {
  if (v == null) return { v: undefined };
  const s = String(v).trim();
  const hit = SOURCES.find(x => x.toLowerCase() === s.toLowerCase());
  return hit === undefined ? refuse(`source must be one of ${SOURCES.filter(Boolean).join(", ")} (or "" for none).`) : { v: hit };
};
// {phase, list, card, patch-free summary} for answers and audits.
const summary = (c) => ({ cardId: String(c.id), source: c.source || "", po: c.po || "", date: c.date || "", pickupDate: c.pickupDate || "", needsOrder: !!c.needsOrder, ordered: !!c.ordered, pickedUp: !!c.pickedUp, deliveredToShop: !!c.deliveredToShop, lines: R.itemsToLines(c.items).length });

// ── material.addCard ─────────────────────────────────────────────────────────
// args: { jobId, phase, source?, items:[lines], appendToOpen?:bool }
function planAddCard(args, ctx) {
  const job = ctx.job && ctx.job.data;
  const g = jobGate(ctx.job); if (g) return g;
  const ph = phaseOf(args, job); if (ph.refused) return ph;
  const src = sourceArg(args.source); if (src.refused) return src;
  const source = src.v || "";
  const h = linesToHtml(args.items); if (h.refused) return h;
  const arr = cards(job, ph.list);
  if (args.appendToOpen === true) {
    // onAddMaterial: the NEWEST open card with the same source.
    const open = [...arr].reverse().find(o => isOpen(o) && (o.source || "") === source);
    if (open) {
      const next = { ...open, items: appendHtml(open.items, h.html) };
      const list = arr.map(o => (o && sameId(o.id, open.id) ? next : o));
      return { fields: { [ph.list]: list }, before: { [ph.list]: open }, after: { [ph.list]: next }, itemId: String(open.id),
        result: { cardId: String(open.id), phase: ph.phase, field: ph.list, appendedToOpenCard: true, source, linesAdded: h.lines.length, lines: R.itemsToLines(next.items).length, card: summary(next), pushTo: [] } };
    }
  }
  const nowMs = Date.parse(ctx.nowIso);
  const id = newItemId(nowMs, PHASES.flatMap(p => cards(job, LISTS[p]).map(c => c && c.id)));
  const card = newCard(id, source, h.html);
  return { fields: { [ph.list]: [...arr, card] }, before: { [ph.list]: null }, after: { [ph.list]: card }, itemId: id,
    result: { cardId: id, phase: ph.phase, field: ph.list, appendedToOpenCard: false, source, linesAdded: h.lines.length, lines: h.lines.length, number: arr.length + 1, card: summary(card), pushTo: [] } };
}

// ── material.editCard ────────────────────────────────────────────────────────
// args: { jobId, cardId, source?, date?, pickupDate?, po?, items?:[lines] | appendLines?:[lines], needsOrder? }
function planEditCard(args, ctx) {
  const job = ctx.job && ctx.job.data;
  const g = jobGate(ctx.job); if (g) return g;
  const cardId = cardArg(args); if (!cardId) return refuse("cardId must be the card's id from cc_list_material_cards.");
  const loc = findCard(job, cardId); if (!loc) return noCard(job, cardId);
  const c = loc.card;
  const patch = {};
  if (args.source !== undefined) { const s = sourceArg(args.source); if (s.refused) return s; patch.source = s.v; }
  for (const k of ["date", "pickupDate"]) {
    if (args[k] === undefined) continue;
    const d = toMdy(args[k], k); if (d.refused) return d;
    patch[k] = d.v;
  }
  if (args.po !== undefined) {
    if (typeof args.po !== "string" && typeof args.po !== "number") return refuse("po must be text.");
    if (c.simproPoId || c.simproPulled) return refuse(`Card ${cardId} carries a PO Simpro made (PO ${c.po || c.simproPoId}) — its number isn't retyped from Duet. Nothing was written.`);
    patch.po = cleanText(args.po).slice(0, 40);
  }
  if (args.items !== undefined && args.appendLines !== undefined) return refuse("Give items (replace the list) or appendLines (add to it), not both.");
  if (args.items !== undefined) { const h = linesToHtml(args.items); if (h.refused) return h; patch.items = h.html; }
  if (args.appendLines !== undefined) { const h = linesToHtml(args.appendLines); if (h.refused) return h; patch.items = appendHtml(c.items, h.html); }
  if (args.needsOrder !== undefined) { if (typeof args.needsOrder !== "boolean") return refuse("needsOrder must be true or false."); patch.needsOrder = args.needsOrder; }
  if (!Object.keys(patch).length) return refuse("Nothing to change: give source, date, pickupDate, po, items, appendLines and/or needsOrder.");
  const changed = Object.keys(patch).filter(k => String(patch[k] == null ? "" : patch[k]) !== String(c[k] == null ? "" : c[k]));
  if (!changed.length) return { noop: true, result: { cardId, phase: loc.phase, field: loc.list, card: summary(c) } };
  const next = { ...c, ...patch };
  const list = loc.arr.map(o => (o && sameId(o.id, cardId) ? next : o));
  return { fields: { [loc.list]: list }, before: { [loc.list]: c }, after: { [loc.list]: next }, itemId: cardId,
    result: { cardId, phase: loc.phase, field: loc.list, changed, card: summary(next), lines: R.itemsToLines(next.items).length, pushTo: [] } };
}

// ── material.tick ────────────────────────────────────────────────────────────
// args: { jobId, cardId, field: ordered|pickedUp|deliveredToShop, on: bool }
function planTick(args, ctx) {
  const job = ctx.job && ctx.job.data;
  const g = jobGate(ctx.job); if (g) return g;
  const cardId = cardArg(args); if (!cardId) return refuse("cardId must be the card's id from cc_list_material_cards.");
  const field = String(args.field || "");
  if (!TICK_FIELDS.includes(field)) return refuse(`field must be one of ${TICK_FIELDS.join(", ")}.`);
  if (typeof args.on !== "boolean") return refuse("on must be true or false.");
  const loc = findCard(job, cardId); if (!loc) return noCard(job, cardId);
  const c = loc.card;
  if (!!c[field] === args.on) return { noop: true, result: { cardId, phase: loc.phase, field: loc.list, [field]: !!c[field], by: c[field + "By"] || "", at: c[field + "At"] || "" } };
  // The checkbox literal, name + toLocaleDateString("en-US") in Mountain time; untick clears to "".
  const patch = args.on ? { [field]: true, [field + "By"]: ME, [field + "At"]: todayMdy(ctx) } : { [field]: false, [field + "By"]: "", [field + "At"]: "" };
  const next = { ...c, ...patch };
  const list = loc.arr.map(o => (o && sameId(o.id, cardId) ? next : o));
  return { fields: { [loc.list]: list }, before: { [loc.list]: c }, after: { [loc.list]: next }, itemId: cardId,
    result: { cardId, phase: loc.phase, field: loc.list, tick: field, on: args.on, by: patch[field + "By"], at: patch[field + "At"], card: summary(next), receiptsNote: field === "pickedUp" && args.on && R.STORE_VENDORS.includes(String(c.source || "").toLowerCase()) ? "The receipt photo is the app's own path (attachStoreReceipt) — not written from Duet." : undefined, pushTo: [] } };
}

// ── material.previewPo (read) ────────────────────────────────────────────────
// Everything sendMaterialPO would decide before any PO exists, from the pure
// rules and the config — never the mail key, never a Simpro write.
// args: { jobId, cardId, get?: willcall|deliver|custom, date?, custom?, copyTo?, ccId? }
// cfg:  { mode, testTo, bids, liveAccess } (api.js's io.loadPoCfg — soakTo only from gc_config/mail)
// extra: { koyAccess, vendorEmail? (live only, one Simpro GET), senderEmail?, log? (material_po_log doc, trimmed) }
function cleanSendArgs(args, card, phase) {
  const rule = R.cardSupplierRule(card);
  if (!rule) return refuse(card.simproSupplier && String(card.source || "").trim().toLowerCase() === "other"
    ? `That card is a ${String(card.simproSupplier).trim()} PO made in Simpro; the app doesn't send to that supplier. Nothing was sent.`
    : `The app can't send to ${String(card.source || "").trim() || "that supplier"} yet. Pick CED, Home Depot, ACE, Lowe's, Amazon or Other on the card first. Nothing was sent.`);
  const lines = R.itemsToLines(card.items);
  if (rule.kind === "email" && !lines.length) return refuse("Add the material list to the card first. Nothing was sent.");
  const get = R.getMode(args.get);
  const custom = get === "custom" ? R.cleanCustom(args.custom) : "";
  if (get === "custom" && rule.kind === "email" && !custom) return refuse("Say what CED should do (custom) — the Custom box can't be empty. Nothing was sent.");
  let dueIso = "";
  if (get !== "custom" && args.date != null && args.date !== "") {
    const d = toMdy(args.date, "date"); if (d.refused) return d;
    dueIso = R.cardDateToIso(d.v);
  }
  let copyTo = [];
  if (rule.kind === "email" && args.copyTo != null && String(Array.isArray(args.copyTo) ? args.copyTo.join(" ") : args.copyTo).trim()) {
    const cc = R.cleanCopyTo(args.copyTo);
    if (cc.bad.length) return refuse(`"${String(cc.bad[0]).slice(0, 80)}" isn't an email address. Fix it or drop copyTo. Nothing was sent.`);
    if (cc.tooMany) return refuse(`One email can CC up to ${R.COPY_TO_MAX} people. Nothing was sent.`);
    copyTo = cc.list;
  }
  const ccId = phase === "comm" ? String(args.ccId == null ? "" : args.ccId).trim() : "";
  if (phase === "comm" && !/^\d{1,12}$/.test(ccId)) return refuse("A commercial card needs ccId: the Simpro job cost center to charge (the app's Bid Items list shows them). Nothing was sent.");
  return { rule, lines, get, custom, dueIso, copyTo, ccId, pickup: rule.kind === "email" ? R.pickupLine({ get, date: dueIso, custom }) : "" };
}
// The app's gate(), pure.
function gateFor(cfg, access) {
  if (cfg.mode === "off") return "Sending POs from the app is turned off (gc_config/material_po.mode = off).";
  if (cfg.mode === "test" && access !== "admin") return "Sending POs from the app is still being tested. Only admins can send right now.";
  if (cfg.mode === "live" && !(cfg.liveAccess || []).includes(access)) return "Koy's access level can't send POs from the app (gc_config/material_po.liveAccess).";
  return "";
}
function previewHash(o) {
  return crypto.createHash("sha256").update(JSON.stringify([o.kind, o.simproName, o.lines, o.mode, o.get, o.dueIso, o.custom, o.copyTo, o.testTo || "", o.bids || "", o.vendorEmail || "", o.ccId || ""])).digest("hex").slice(0, 32);
}
function planPreview(args, ctx, cfg, extra) {
  const job = ctx.job && ctx.job.data;
  const g = jobGate(ctx.job); if (g) return g;
  const cardId = cardArg(args); if (!cardId) return refuse("cardId must be the card's id from cc_list_material_cards.");
  const loc = findCard(job, cardId); if (!loc) return noCard(job, cardId);
  const c = loc.card;
  const s = cleanSendArgs(args, c, loc.phase); if (s.refused) return s;
  const key = R.logKey(ctx.job.id, loc.phase, cardId);
  if (!key) return refuse("That card id can't be a PO key. Nothing was sent.");
  const simproNo = job.type === "quote" ? "" : String(job.simproNo || "").trim();
  const mode = cfg.mode;
  const e = extra || {};
  const gate = gateFor(cfg, e.koyAccess) || (!simproNo ? "Add the Simpro job number to this job first." : "");
  // Who gets the email (rules.recipients). Live: the vendor's Simpro email when the
  // caller looked it up; otherwise named as "CED's address on its Simpro vendor record".
  let recipients = null, recipientsNote = "";
  if (s.rule.kind === "email") {
    if (mode === "test") { recipients = R.recipients({ mode, testTo: cfg.testTo }); recipientsNote = recipients ? `TEST mode: only ${cfg.testTo} gets the email, subject [TEST], nobody copied. The Simpro PO is REAL and marked TEST — void it afterwards.` : "No test inbox set (gc_config/material_po.testTo / gc_config/mail.soakTo): the send would refuse."; }
    else if (mode === "live") {
      const vendorEmail = e.vendorEmail || "";
      recipients = vendorEmail ? R.recipients({ mode, vendorEmail, bids: cfg.bids, senderEmail: e.senderEmail || "", extraCc: s.copyTo }) : { to: [`<${s.rule.simproName}'s email on its Simpro vendor record>`], cc: [cfg.bids, ...(e.senderEmail ? [e.senderEmail] : []), ...s.copyTo].filter(Boolean), replyTo: e.senderEmail || cfg.bids };
      recipientsNote = vendorEmail ? `LIVE: ${s.rule.simproName} gets the email at its Simpro address; bids@ ${e.senderEmail ? "and Koy's Simpro email " : ""}${s.copyTo.length ? `and ${s.copyTo.length} CC address(es) ` : ""}copied.` : `LIVE: the To address is read from ${s.rule.simproName}'s Simpro vendor record at send time (Simpro didn't answer the lookup).`;
    } else recipientsNote = "Mode off: nothing would be sent.";
  } else recipientsNote = `${s.rule.simproName} is a store run: the PO is made in Simpro and its number handed back — no email.`;
  const log = e.log || null;
  const alreadySent = !!((log && log.poNo) || c.simproPoId || c.poSentAt);
  const hash = previewHash({ kind: s.rule.kind, simproName: s.rule.simproName, lines: s.lines, mode, get: s.get, dueIso: s.dueIso, custom: s.custom, copyTo: s.copyTo, testTo: mode === "test" ? cfg.testTo : "", bids: mode === "live" ? cfg.bids : "", vendorEmail: mode === "live" ? (e.vendorEmail || "") : "", ccId: s.ccId });
  const preview = {
    cardId, phase: loc.phase, field: loc.list, source: c.source || "", supplier: s.rule.simproName, kind: s.rule.kind, kindMeans: s.rule.kind === "email" ? "create the Simpro PO and email it" : "create the Simpro PO and hand back the number (store run, no email)",
    mode, modeMeans: mode === "test" ? "test — email only to the test inbox, PO real but marked TEST" : mode === "live" ? "LIVE — the real supplier gets the email" : "off — refused",
    simproJobNo: simproNo || undefined, costCenter: loc.phase === "comm" ? `Simpro job cost center ${s.ccId}` : `the job's first ${loc.phase === "rough" ? "Rough In" : "Finish"} cost center (picked at send time)`,
    lines: s.lines, lineCount: s.lines.length, get: s.get, dueDate: s.dueIso || "", pickup: s.pickup || undefined, copyTo: s.copyTo,
    recipients, recipientsNote, logKey: key,
    alreadySent, existingPo: alreadySent ? String((log && log.poNo) || c.simproPoId || c.po || "") : undefined, existingSend: log ? { status: log.status || "", mode: log.mode || "", emailOk: !!log.emailOk, emailedTo: Array.isArray(log.emailedTo) ? log.emailedTo : [] } : undefined,
    alreadySentNote: alreadySent ? "This card already has a PO. Sending again returns the same PO (one send per card) and only re-emails it if the first email failed; it never makes a second PO." : undefined,
    wouldRefuse: gate || undefined, canSend: !gate, previewHash: hash, validForMinutes: PREVIEW_TTL_MS / 60e3,
    next: gate ? "Fix what wouldRefuse says first." : "Show Koy this preview (supplier, mode, recipients, lines). On his yes, call cc_send_material_po with this call's previewId.",
  };
  return { preview, hash, key, send: { source: c.source || "", items: c.items || "", get: s.get, date: s.dueIso ? toMdy(s.dueIso, "date").v : "", custom: s.custom, copyTo: s.copyTo, ccId: s.ccId, phase: loc.phase, kind: s.rule.kind, pickDateMdy: s.dueIso ? toMdy(s.dueIso, "date").v : "" } };
}

// Does an earlier preview audit still cover THIS send? Same job + card, under 15
// minutes old, ok, and the hash recomputed now equals the one it stored.
function previewMatches(prior, { jobId, cardId, hash, nowIso }) {
  if (!prior || prior.action !== "material.previewPo" || prior.ok !== true) return "That confirmPreviewId isn't a successful cc_preview_material_po call. Preview first. Nothing was sent.";
  if (String(prior.docId) !== String(jobId) || String(prior.itemId) !== String(cardId)) return "That preview was for another job or card. Preview this card first. Nothing was sent.";
  const age = Date.parse(nowIso) - Date.parse(prior.at || "");
  if (!(age >= 0 && age <= PREVIEW_TTL_MS)) return `That preview is older than ${PREVIEW_TTL_MS / 60e3} minutes. Preview again and show Koy the fresh one. Nothing was sent.`;
  if (!prior.preview || prior.preview.hash !== hash) return "The card, the mode or the send options changed since that preview (supplier, lines, recipients, pickup or CC list). Preview again and show Koy the fresh one. Nothing was sent.";
  return "";
}

// ── material.sendPo: the card patch after sendMaterialPO answers ─────────────
// res = sendMaterialPO's answer {poNo, kind, mode, supplier, costCenter, emailOk, emailError, emailedTo, copied, again}
function planSendPatch(cardId, res, send, ctx) {
  const job = ctx.job && ctx.job.data;
  const today = todayMdy(ctx);
  const loc = job ? findCard(job, cardId) : null;
  if (!job || !loc) return { noop: true, result: { cardId, cardPatched: false, warning: `PO ${res.poNo} was made in Simpro but the card isn't on the job any more, so the card wasn't written. The send is in material_po_log.` } };
  const c = loc.card;
  const patch = { po: String(res.poNo), simproPoId: String(res.poNo), poSentVia: "app", poSentFrom: "duet", poSentMode: res.mode || "",
    poSentBy: ME, poSentAt: today, poCostCenter: res.costCenter || "",
    poEmailOk: !!res.emailOk, poEmailedTo: (res.emailedTo || []).join(", "),
    ...(send.get === "custom" && send.custom ? { poCustom: send.custom } : {}),
    ...(loc.phase === "comm" ? { chargeCcId: String(send.ccId), chargeCcName: res.costCenter || "" } : {}) };
  if (res.kind !== "email" || res.emailOk) Object.assign(patch, { ordered: true, orderedBy: ME, orderedAt: today });
  // Dates fill only if still empty on the LIVE card.
  if (!c.date) patch.date = today;
  if (!c.pickupDate && send.pickDateMdy) patch.pickupDate = send.pickDateMdy;
  const next = { ...c, ...patch };
  const list = loc.arr.map(o => (o && sameId(o.id, cardId) ? next : o));
  return { fields: { [loc.list]: list }, before: { [loc.list]: c }, after: { [loc.list]: next }, itemId: cardId,
    result: { cardId, phase: loc.phase, field: loc.list, cardPatched: true, changed: Object.keys(patch), card: summary(next) } };
}

module.exports = { LISTS, PHASES, SOURCES, TICK_FIELDS, PREVIEW_TTL_MS, isOpen, newCard, appendHtml, linesToHtml, findCard, cleanSendArgs, gateFor, previewHash, previewMatches,
  planAddCard, planEditCard, planTick, planPreview, planSendPatch, summary };
