"use strict";
// Duet write access (D9): punch items on a RETURN TRIP's own list
// (data.returnTrips[i].punch[], the "PUNCH LIST" box on the trip card).
// Spec: app-building/return-trip-punch-spec.md (Koy, 2026-11-06: "Build it, undo on").
// PURE planners — given the live job and what Duet asked, they return either a
// refusal or exactly what to write, in jobWrite()'s shape. Copied from the
// trip card's own funnel in src/App.js:
//   • ReturnTrips → <PunchItems items={t.punch} onChange={v=>upd(t.id,{punch:v})}>
//     (~L18690): every change is the trip's whole punch array back through
//     upd(), the whole returnTrips array back through handleReturnTripsChange
//     (~L32064) → u({returnTrips}).
//   • PunchItems commitAdd (~L13205): {id, text(html), done:false, addedBy,
//     addedAt (Mountain YYYY-MM-DD), addedAtTs} + materialNeeded /
//     materialSource only when material text is given. Appended last.
//   • the done checkbox (~L13219): done → {done:true, checkedBy, checkedAt
//     "M/D/YYYY", checkedAtTs, waiting:false}; undone → done false, the three
//     stamps cleared, waiting left as it was.
//   • commitEdit (~L13230) and commitWaiting / clearWaiting (~L13245).
// What the app does NOT do for trip-only items, so neither does this: no
// punchTicks slot (u() derives slots for the three trees only, ~L31980) and no
// cascade. A done flip on a LINKED entry (originItemId → a rough / finish
// item, or fromRoughInspectionId → a 4-way checklist item) cascades in
// handleReturnTripsChange, so those refuse here and stay in the app.
// Items added here never carry originItemId: they are trip-only.
// No Firestore: api.js runs the transaction; scripts/duet-trippunch-test.js
// drives these with fixtures.
const { newItemId, mdy, jobGate } = require("./jobItems.js");
const { ME, cleanText } = require("./needs.js");
const PU = require("./punch.js");

const refuse = (why) => ({ refused: why });
const MAX_ITEMS = 25;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const sameId = (a, b) => a != null && String(a) === String(b);
const plainOf = (html) => String(html == null ? "" : html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const itemText = (it) => plainOf(it && it.text).trim().slice(0, 160);
// Duplicate key: plain text, whitespace collapsed, case ignored.
const dupKey = (s) => plainOf(s).replace(/\s+/g, " ").trim().toLowerCase();
const isLinked = (p) => !!(p && ((p.originItemId != null && p.originItemId !== "") || (p.fromRoughInspectionId != null && p.fromRoughInspectionId !== "")));

// The trip by id. → {refused} | {trips, i, rt, number, name, data}
function openTrip(args, ctx) {
  const g = jobGate(ctx.job); if (g) return g;
  const data = ctx.job.data, name = data.name || "that job";
  const rtId = String((args || {}).rtId || "");
  if (!ID.test(rtId)) return refuse("rtId must be the trip's id from cc_list_return_trips.");
  const trips = Array.isArray(data.returnTrips) ? data.returnTrips : [];
  const i = trips.findIndex(t => t && sameId(t.id, rtId));
  if (i < 0) return refuse(`No return trip with id ${rtId} on ${name} (check cc_list_return_trips). Nothing was written.`);
  const rt = trips[i];
  if (rt.signedOff) return refuse(`Return trip #${i + 1} is signed off — it's closed. Nothing was written.`);
  return { trips, i, rt, number: i + 1, name, data, rtId };
}
const tripLabel = (o) => ({ rtId: o.rtId, rtNumber: o.number, scope: String(o.rt.scope || "").slice(0, 120), rtStatus: o.rt.rtStatus || "", rtStatusDate: o.rt.rtStatusDate || "", assignedTo: o.rt.assignedTo || "" });
const withPunch = (o, punch) => { const next = { ...o.rt, punch }; return { next, returnTrips: o.trips.map((t, j) => (j === o.i ? next : t)) }; };

// Every id already on the job that a new item must not reuse: the three
// trees, every trip, every trip's punch entries.
function takenIds(data) {
  const ids = PU.allIds(data).map(String);
  (Array.isArray(data.returnTrips) ? data.returnTrips : []).forEach(t => {
    if (!t) return;
    if (t.id != null) ids.push(String(t.id));
    (Array.isArray(t.punch) ? t.punch : []).forEach(p => p && p.id != null && ids.push(String(p.id)));
  });
  return ids;
}

// ── 1. add (a batch, all in or nothing) ──────────────────────────────────────
// args: { jobId, rtId, items:[{text, materialNeeded?, materialSource?}], confirmComplete? }
function planAdd(args, ctx) {
  const a = args || {};
  const o = openTrip(a, ctx); if (o.refused) return o;
  if (o.rt.rtStatus === "complete" && a.confirmComplete !== true) return refuse(`Return trip #${o.number} is marked complete — adding punch items to a finished trip is usually a mistake. Ask Koy; if he says yes, call again with confirmComplete true. Nothing was written.`);
  if (!Array.isArray(a.items) || !a.items.length) return refuse("items must be a list of 1 to 25 punch items, each {text}.");
  if (a.items.length > MAX_ITEMS) return refuse(`That's ${a.items.length} items — the most in one call is ${MAX_ITEMS}. Split the list. Nothing was written.`);
  const existing = Array.isArray(o.rt.punch) ? o.rt.punch : [];
  const openKeys = new Map();
  existing.forEach(p => { if (p && !p.done) { const k = dupKey(p.text); if (k) openKeys.set(k, p); } });
  const mint = (() => { const taken = new Set(takenIds(o.data)); const nowMs = Date.parse(ctx.nowIso); return () => { const id = newItemId(nowMs, [...taken]); taken.add(id); return id; }; })();
  const stamp = PU.punchStamp(ctx.nowIso, ctx.tz);
  const added = [], seen = new Map();
  for (let n = 0; n < a.items.length; n++) {
    const it = a.items[n];
    const at = `Item ${n + 1}`;
    if (!isObj(it)) return refuse(`${at} must be {text, materialNeeded?, materialSource?}. Nothing was written.`);
    if (it.text != null && typeof it.text !== "string") return refuse(`${at}: text must be text. Nothing was written.`);
    const plain = cleanText(it.text);
    if (!plain) return refuse(`${at} has no text — every punch item needs words. Nothing was written.`);
    const k = dupKey(plain);
    if (openKeys.has(k)) return refuse(`${at} ("${plain.slice(0, 80)}") is already an open item on return trip #${o.number} — not adding it twice. Nothing was written.`);
    if (seen.has(k)) return refuse(`${at} repeats item ${seen.get(k)} ("${plain.slice(0, 80)}") — not adding it twice. Nothing was written.`);
    seen.set(k, n + 1);
    let mat = "", src = "";
    if (it.materialNeeded != null) { if (typeof it.materialNeeded !== "string") return refuse(`${at}: materialNeeded must be text. Nothing was written.`); mat = cleanText(it.materialNeeded).trim(); }
    if (it.materialSource != null && it.materialSource !== "") { src = String(it.materialSource); if (!PU.MAT_SOURCES.includes(src)) return refuse(`${at}: materialSource must be one of ${PU.MAT_SOURCES.filter(Boolean).join(", ")} (or blank). Nothing was written.`); }
    if (it.assignedTo != null || it.photos != null || it.originItemId != null || it.done != null) return refuse(`${at}: only text, materialNeeded and materialSource can be set on a new trip item (the trip has its own assignee; photos go through cc_add_photo). Nothing was written.`);
    const entry = { id: mint(), text: PU.toHtml(plain), done: false, addedBy: ME, ...stamp };
    if (mat) { entry.materialNeeded = mat; if (src) entry.materialSource = src; }
    added.push(entry);
  }
  const { next, returnTrips } = withPunch(o, [...existing, ...added]);
  return { fields: { returnTrips }, before: { returnTrips: o.rt }, after: { returnTrips: next }, itemId: o.rtId,
    audit: { addedIds: added.map(e => e.id) },
    result: { ...tripLabel(o), added: added.length, punchOnTrip: next.punch.length, openOnTrip: next.punch.filter(p => p && !p.done).length,
      items: added.map((e, j) => ({ punchId: e.id, number: existing.length + j + 1, text: itemText(e), materialNeeded: e.materialNeeded, materialSource: e.materialSource })),
      addedAt: stamp.addedAt, confirmedComplete: o.rt.rtStatus === "complete" ? true : undefined, pushTo: [] } };
}

// ── one existing item on the trip ────────────────────────────────────────────
function openTripItem(args, ctx, { allowDone = true } = {}) {
  const o = openTrip(args, ctx); if (o.refused) return o;
  const itemId = String((args || {}).itemId || "");
  if (!ID.test(itemId)) return refuse("itemId must be the punch item's id (punchId from cc_list_return_trips).");
  const punch = Array.isArray(o.rt.punch) ? o.rt.punch : [];
  const k = punch.findIndex(p => p && sameId(p.id, itemId));
  if (k < 0) return refuse(`No punch item with id ${itemId} on return trip #${o.number} of ${o.name} (cc_list_return_trips lists the trip's items). Nothing was written.`);
  const item = punch[k];
  if (!allowDone && item.done) return refuse(`That trip punch item is already done (by ${item.checkedBy || "someone"}${item.checkedAt ? ` on ${item.checkedAt}` : ""}) — the app hides this control on done items. Un-tick it first if it really needs changing. Nothing was written.`);
  return { ...o, punch, k, item, itemId };
}
// The one entry swapped where it sits; the trip and every other entry untouched.
function swapItem(o, fn) {
  const nextItem = fn(o.item);
  const { returnTrips } = withPunch(o, o.punch.map((p, j) => (j === o.k ? nextItem : p)));
  return { returnTrips, nextItem };
}
const itemWhere = (o) => ({ rtId: o.rtId, rtNumber: o.number, punchId: o.itemId, number: o.k + 1, linked: isLinked(o.item) || undefined });
// Audit: the ONE entry before / after under returnTrips, with its trip id.
const shaped = (o, nextItem, result) => ({ fields: { returnTrips: swapItem(o, () => nextItem).returnTrips }, before: { returnTrips: { rtId: o.rtId, entry: o.item } }, after: { returnTrips: { rtId: o.rtId, entry: nextItem } }, itemId: o.itemId, audit: { rtId: o.rtId }, result });

// ── 2. done / undone ─────────────────────────────────────────────────────────
function planSetDone(args, ctx) {
  const o = openTripItem(args, ctx); if (o.refused) return o;
  if (typeof args.done !== "boolean") return refuse("done must be true or false.");
  if (isLinked(o.item)) return refuse(`That trip item is linked to ${o.item.originItemId ? `a ${o.item.originPhase || "rough"} punch item` : "a 4-way inspection item"} — ticking it also ticks the source, which stays in the app for now. Tick the source item (cc_punch_done without rtId) or tick it in the app. Nothing was written.`);
  const done = args.done;
  if (!!o.item.done === done) return { noop: true, result: { ...itemWhere(o), done, text: itemText(o.item), message: `Already ${done ? "done" : "open"} — nothing to change.` } };
  const when = mdy(ctx.nowIso, ctx.tz);
  const next = done ? { ...o.item, done: true, checkedBy: ME, checkedAt: when, checkedAtTs: ctx.nowIso, waiting: false } : { ...o.item, done: false, checkedBy: "", checkedAt: "", checkedAtTs: "" };
  return shaped(o, next, { ...itemWhere(o), done, text: itemText(next), checkedBy: next.checkedBy, checkedAt: next.checkedAt, pushTo: [] });
}

// ── 3. waiting ───────────────────────────────────────────────────────────────
function planWaiting(args, ctx) {
  const o = openTripItem(args, ctx, { allowDone: false }); if (o.refused) return o;
  if (typeof args.waiting !== "boolean") return refuse("waiting must be true (with waitingOn) or false.");
  const it = o.item;
  let patch;
  if (args.waiting) {
    const on = cleanText(args.waitingOn).replace(/\n+/g, " ").trim();
    if (!on) return refuse("Say what the item is waiting on (waitingOn).");
    if (it.waiting === true && String(it.waitingOn || "") === on) return { noop: true, result: { ...itemWhere(o), waiting: true, waitingOn: on, text: itemText(it), message: "Already waiting on that — nothing to change." } };
    patch = { waiting: true, waitingOn: on };
  } else {
    if (!it.waiting) return { noop: true, result: { ...itemWhere(o), waiting: false, text: itemText(it), message: "Not marked waiting — nothing to change." } };
    patch = { waiting: false, waitingOn: "" };
  }
  const next = { ...it, ...patch };
  return shaped(o, next, { ...itemWhere(o), waiting: patch.waiting, waitingOn: patch.waitingOn, wasWaitingOn: it.waiting ? String(it.waitingOn || "") : undefined, text: itemText(next), pushTo: [] });
}

// ── 4. edit text / material ──────────────────────────────────────────────────
function planEditText(args, ctx) {
  const o = openTripItem(args, ctx, { allowDone: false }); if (o.refused) return o;
  const a = args || {};
  const patch = {};
  if (a.text != null) {
    if (typeof a.text !== "string") return refuse("text must be text.");
    const plain = cleanText(a.text);
    if (!plain) return refuse("The new text is empty — to clear an item, mark it done instead (items are never deleted from Duet).");
    patch.text = PU.toHtml(plain);
  }
  if (a.materialNeeded != null) { if (typeof a.materialNeeded !== "string") return refuse("materialNeeded must be text."); patch.materialNeeded = cleanText(a.materialNeeded).trim(); }
  if (a.materialSource != null) { const src = String(a.materialSource); if (!PU.MAT_SOURCES.includes(src)) return refuse(`materialSource must be one of ${PU.MAT_SOURCES.filter(Boolean).join(", ")} (or blank).`); patch.materialSource = src; }
  if (!Object.keys(patch).length) return refuse("Say what to change: text, materialNeeded and/or materialSource.");
  const it = o.item;
  const changed = Object.keys(patch).filter(k => String(it[k] == null ? "" : it[k]) !== String(patch[k]));
  if (!changed.length) return { noop: true, result: { ...itemWhere(o), text: itemText(it), message: "Already says that — nothing to change." } };
  const next = { ...it, ...patch };
  return shaped(o, next, { ...itemWhere(o), changed, text: itemText(next), materialNeeded: next.materialNeeded, materialSource: next.materialSource,
    note: isLinked(it) ? "This trip item is linked to a source item; the edit is on the trip copy only (the app's edit box does the same)." : undefined, pushTo: [] });
}

// ── undo ─────────────────────────────────────────────────────────────────────
// rtPunch.add → the added entries taken back off the trip, ONLY while every
// one still reads exactly what the add left (not done, same text, no photos,
// no waiting — any change at all). The app itself removes trip entries this
// way when a promotion is undone (rt.punch filter, App.js ~L11808), and these
// entries exist nowhere else. Koy chose this (2026-11-06, "undo on").
// The other three → the ONE entry put back from `before` while it still reads `after`.
function planUndoAdd(audit, d, same) {
  const rtId = String(audit.itemId || "");
  const ids = Array.isArray(audit.addedIds) ? audit.addedIds.map(String) : [];
  if (!rtId || !ids.length) return refuse("That audit record doesn't name the trip or the items it added. Nothing was written.");
  const trips = Array.isArray(d.returnTrips) ? d.returnTrips : [];
  const i = trips.findIndex(t => t && sameId(t.id, rtId));
  if (i < 0) return refuse(`No return trip with id ${rtId} on ${d.name || "that job"} any more. Nothing was written.`);
  const rt = trips[i];
  if (rt.signedOff) return refuse(`Return trip #${i + 1} has been signed off since — it's closed, so its punch items stay. Nothing was written.`);
  const wasAfter = audit.after && audit.after.returnTrips && Array.isArray(audit.after.returnTrips.punch) ? audit.after.returnTrips.punch : [];
  const punch = Array.isArray(rt.punch) ? rt.punch : [];
  const touched = [], gone = [];
  ids.forEach((id, n) => {
    const exp = wasAfter.find(p => p && sameId(p.id, id));
    const cur = punch.find(p => p && sameId(p.id, id));
    const label = `item ${n + 1} ("${itemText(cur || exp).slice(0, 60)}")`;
    if (!cur) { gone.push(label); return; }
    if (!exp || !same(cur, exp)) {
      const why = [];
      if (exp) {
        if (!!cur.done !== !!exp.done) why.push(cur.done ? `ticked done by ${cur.checkedBy || "someone"}` : "un-ticked");
        if (String(cur.text || "") !== String(exp.text || "")) why.push("text edited");
        if ((Array.isArray(cur.photos) ? cur.photos.length : 0) !== (Array.isArray(exp.photos) ? exp.photos.length : 0)) why.push("photo added");
        if (!!cur.waiting !== !!exp.waiting || String(cur.waitingOn || "") !== String(exp.waitingOn || "")) why.push("waiting changed");
        if (!why.length) why.push("changed");
      }
      touched.push(`${label}: ${why.join(", ") || "changed"}`);
    }
  });
  if (touched.length || gone.length) return refuse(`Someone has worked on these trip items since Duet added them, so none were taken off: ${[...touched, ...gone.map(g => `${g}: already gone from the trip`)].join("; ")}. Nothing was written.`);
  const keep = punch.filter(p => !(p && ids.includes(String(p.id))));
  const next = { ...rt, punch: keep };
  return { fields: { returnTrips: trips.map((t, j) => (j === i ? next : t)) }, before: { returnTrips: rt }, after: { returnTrips: next }, itemId: rtId,
    result: { rtId, rtNumber: i + 1, removed: ids.length, punchOnTrip: keep.length, pushTo: [] } };
}
function planUndoItem(audit, d, same) {
  const exp = audit.after && audit.after.returnTrips, prev = audit.before && audit.before.returnTrips;
  if (!isObj(exp) || !isObj(prev) || !exp.entry || !prev.entry) return refuse("That audit record has no trip item to put back. Nothing was written.");
  const rtId = String(exp.rtId || ""), itemId = String(audit.itemId || exp.entry.id || "");
  const trips = Array.isArray(d.returnTrips) ? d.returnTrips : [];
  const i = trips.findIndex(t => t && sameId(t.id, rtId));
  if (i < 0) return refuse(`No return trip with id ${rtId} on ${d.name || "that job"} any more. Nothing was written.`);
  const rt = trips[i];
  if (rt.signedOff) return refuse(`Return trip #${i + 1} has been signed off since — it's closed. Nothing was written.`);
  const punch = Array.isArray(rt.punch) ? rt.punch : [];
  const k = punch.findIndex(p => p && sameId(p.id, itemId));
  if (k < 0) return refuse(`No punch item with id ${itemId} on return trip #${i + 1} any more. Nothing was written.`);
  if (!same(punch[k], exp.entry)) return { refused: `Changed since Duet's call — that trip item no longer reads what the call left (someone edited since). Nothing was put back; here is current vs expected so you can decide by hand.`, diff: [{ field: `returnTrips #${rtId} entry ${itemId}`, current: punch[k], expected: exp.entry }] };
  const next = { ...rt, punch: punch.map((p, j) => (j === k ? prev.entry : p)) };
  return { fields: { returnTrips: trips.map((t, j) => (j === i ? next : t)) }, before: { returnTrips: { rtId, entry: punch[k] } }, after: { returnTrips: { rtId, entry: prev.entry } }, itemId,
    result: { rtId, rtNumber: i + 1, punchId: itemId, text: itemText(prev.entry), done: !!prev.entry.done, pushTo: [] } };
}

module.exports = { MAX_ITEMS, isLinked, itemText, dupKey, takenIds, planAdd, planSetDone, planWaiting, planEditText, planUndoAdd, planUndoItem };
