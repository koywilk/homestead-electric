"use strict";
// Duet write access (D9), ship 6: punch items. PURE planners — given the live
// job doc and what Duet asked, they return either a refusal or exactly what
// to write, copied line for line from the app's own punch funnel in
// src/App.js (mapped 2026-11-03, main a1dbe8d):
//   • normFloor (~L13015): a floor is {general, rooms, hotcheck, photos}; a
//     legacy bare array is `general`.
//   • PunchSection.handleFloorChange (~L14208) / QCWalkSection.writeFloor
//     (~L14401): a change to ONE floor rebuilds the WHOLE tree
//     {upper, main, basement, extras, ...extraFloors, [floorKey]: newFloor}
//     with every floor through normFloor, extras kept.
//   • handlePhasePunchChange (~L32117), rough / finish only: fanOutAddedRooms
//     (~L1484: a room new on upper / main / basement goes EMPTY, fresh id,
//     to the other phase on that floor, deduped by ccRoomNameKey; Legacy QC
//     too while it has open items) + the return-trip cascade (a done flip on a
//     tree item is mirrored onto every rt.punch[] entry whose originItemId is
//     that item, same phase). qcPunch writes go straight through u() — no
//     fan-out, no cascade.
//   • JobDetail u() (~L31962): every `done` flip ALSO writes its own slot
//     data.punchTicks.<id> = {done, by, at, ts}, derived by punchTickPatches
//     (functions/punchTicks.js, a byte copy of src/punchTicks.js). The slot is
//     the record of truth; the tree still converges.
//   • PunchItems: the done checkbox (~L13376), commitAdd (~L13205), commitEdit
//     (~L13230), commitWaiting / clearWaiting (~L13245), the assignee select
//     (~L13522, hidden on done items), QCWalkSection.commitVoid (~L14596) via
//     handleVoidQCItem (~L32302: the item patched at its floor / room, the
//     tree spread `{...src, [floorKey]: newFloor}`, matching clones stripped
//     from open QC-Fail return trips in the same write) and restoreVoided
//     (~L14627, the four void fields cleared, nothing re-added).
// Text: Duet sends plain text; the app's RichEditor stores HTML, so the text
// goes through the app's own escapeHtml (functions/escapeHtml.js) and reads
// as text — never as markup. Material: noted ON the item only; the app's
// separate roughMaterials / finishMaterials card (onAddMaterial) is ship 8.
// No Firestore here: api.js runs the transaction, scripts/duet-punch-test.js
// drives these with fixtures.
const { punchTickPatches } = require("../punchTicks.js");
const { newItemId, mdy, jobGate } = require("./jobItems.js");
const { ME, resolvePerson, cleanText } = require("./needs.js");
const { escapeHtml } = require("../escapeHtml.js");

const refuse = (why) => ({ refused: why });
const PHASES = { rough: "roughPunch", finish: "finishPunch", qc: "qcPunch" };
const PHASE_NAMES = Object.keys(PHASES);
const BASE_FLOORS = ["upper", "main", "basement"];
const FLOOR_LABELS = { upper: "Upper Level", main: "Main Level", basement: "Basement" };
const MAT_SOURCES = ["", "Shop", "Home Depot", "CED", "Platt", "Amazon", "Other"];   // App.js MAT_SOURCES (~L7722)
const HOTCHECK_PHASES = ["finish", "qc"];   // the Hot Check list shows on the Finish QC walk and the Legacy QC section only
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// ── the app's floor / tree shapes ────────────────────────────────────────────
// normFloor (App.js ~L13015), verbatim.
function normFloor(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && ("general" in v || "rooms" in v || "hotcheck" in v)) {
    return {
      general: Array.isArray(v.general) ? v.general : [],
      rooms: Array.isArray(v.rooms) ? v.rooms : [],
      hotcheck: Array.isArray(v.hotcheck) ? v.hotcheck : [],
      photos: Array.isArray(v.photos) ? v.photos : [],
    };
  }
  return { general: Array.isArray(v) ? v : [], rooms: [], hotcheck: [], photos: [] };
}
// PunchSection: `const extras = punch.extras || []` — entries need a key.
const extrasOf = (tree) => (isObj(tree) && Array.isArray(tree.extras) ? tree.extras.filter(e => e && e.key) : []);
const floorKeysOf = (tree) => BASE_FLOORS.concat(extrasOf(tree).map(e => e.key).filter(k => !BASE_FLOORS.includes(k)));
const floorLabel = (tree, fk) => FLOOR_LABELS[fk] || (extrasOf(tree).find(e => e.key === fk) || {}).label || fk;

// handleFloorChange / writeFloor: the whole tree back, every floor normalized,
// extras kept, the edited floor swapped in.
function rebuildTree(tree, floorKey, newFloor) {
  const t = isObj(tree) ? tree : {};
  const extras = extrasOf(t);
  const out = { upper: normFloor(t.upper), main: normFloor(t.main), basement: normFloor(t.basement), extras: Array.isArray(t.extras) ? t.extras : [] };
  extras.forEach(e => { out[e.key] = normFloor(t[e.key]); });
  out[floorKey] = newFloor;
  return out;
}
// The same tree with every floor normalized and nothing edited — what the
// screen shows, and the baseline punchTickPatches diffs against (a legacy
// bare-array floor still gets its slot).
const normalizeTree = (tree) => {
  const t = isObj(tree) ? tree : {};
  const out = { upper: normFloor(t.upper), main: normFloor(t.main), basement: normFloor(t.basement), extras: Array.isArray(t.extras) ? t.extras : [] };
  extrasOf(t).forEach(e => { out[e.key] = normFloor(t[e.key]); });
  return out;
};

// countFloor / punchOpen (App.js ~L33101): open items on a tree, legacy arrays included.
function countFloor(f) {
  if (!f) return 0;
  if (Array.isArray(f)) return f.filter(i => !i.done).length;
  return (f.general || []).filter(i => !i.done).length + (f.hotcheck || []).filter(i => !i.done).length + (f.rooms || []).reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
}
function punchOpen(punch) {
  if (!punch) return 0;
  const floors = ["upper", "main", "basement", ...(punch.extras || []).map(e => e.key)];
  return floors.reduce((t, k) => t + countFloor(punch[k]), 0);
}

// ccRoomCleanName / ccRoomNameKey (App.js ~L1314): the identity rooms dedupe on.
const ccRoomCleanName = (v) => String(v == null ? "" : v).replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const ccRoomNameKey = (v) => ccRoomCleanName(v).slice(0, 40).trim().toLowerCase();

// adoptRooms (App.js ~L1437), verbatim but for mkId being required.
function adoptRooms(tree, floorKey, names, mkId) {
  if (!BASE_FLOORS.includes(floorKey)) return tree;
  if (tree != null && (typeof tree !== "object" || Array.isArray(tree))) return tree;
  const base = tree != null ? tree : { upper: [], main: [], basement: [] };
  const floor = normFloor(base[floorKey]);
  const have = new Set(floor.rooms.map(r => ccRoomNameKey(r && r.name)).filter(Boolean));
  const fresh = [];
  for (const n of (Array.isArray(names) ? names : [])) {
    const name = ccRoomCleanName(n);
    const k = ccRoomNameKey(name);
    if (!name || have.has(k)) continue;
    have.add(k);
    fresh.push({ id: mkId(), name, items: [] });
  }
  if (!fresh.length) return tree;
  return { ...base, [floorKey]: { ...floor, rooms: [...floor.rooms, ...fresh] } };
}
const ccRoomTargetKeys = (legacyShowing) => (legacyShowing ? ["roughPunch", "finishPunch", "qcPunch"] : ["roughPunch", "finishPunch"]);

// fanOutAddedRooms (App.js ~L1484): rooms new on upper / main / basement in the
// edited phase → appended EMPTY to the other phase(s) on that floor. Fails
// closed without a plain-object previous tree. Returns { [thisKey]: nextPunch, ...others }.
function fanOutAddedRooms(prevTrees, phase, nextPunch, legacyShowing, mkId) {
  const thisKey = phase === "rough" ? "roughPunch" : "finishPunch";
  const patch = { [thisKey]: nextPunch };
  if (!isObj(prevTrees) || !isObj(prevTrees[thisKey])) return patch;
  const prev = prevTrees[thisKey];
  const others = ccRoomTargetKeys(legacyShowing).filter(k => k !== thisKey);
  for (const fk of BASE_FLOORS) {
    const nextRooms = normFloor(isObj(nextPunch) ? nextPunch[fk] : undefined).rooms;
    if (!nextRooms.length) continue;
    const prevIds = new Set(normFloor(prev[fk]).rooms.map(r => r && r.id).filter(id => id != null));
    const added = nextRooms.filter(r => r && r.id != null && !prevIds.has(r.id) && String(r.name == null ? "" : r.name).trim()).map(r => r.name);
    if (!added.length) continue;
    for (const key of others) {
      const before = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : (prevTrees ? prevTrees[key] : undefined);
      const after = adoptRooms(before, fk, added, mkId);
      if (after !== before) patch[key] = after;
    }
  }
  return patch;
}

// ── finding things ───────────────────────────────────────────────────────────
const sameId = (a, b) => a != null && String(a) === String(b);
// Where an item sits: floor, list (general / hotcheck / a room), its index.
function locate(tree, itemId) {
  if (!isObj(tree)) return null;
  for (const fk of floorKeysOf(tree)) {
    const fl = normFloor(tree[fk]);
    let i = fl.general.findIndex(x => x && sameId(x.id, itemId));
    if (i >= 0) return { floorKey: fk, floorLabel: floorLabel(tree, fk), roomId: "general", room: "", index: i, item: fl.general[i] };
    i = fl.hotcheck.findIndex(x => x && sameId(x.id, itemId));
    if (i >= 0) return { floorKey: fk, floorLabel: floorLabel(tree, fk), roomId: "hotcheck", room: "Hot Check", index: i, item: fl.hotcheck[i] };
    for (const r of fl.rooms) {
      const items = r && Array.isArray(r.items) ? r.items : [];
      i = items.findIndex(x => x && sameId(x.id, itemId));
      if (i >= 0) return { floorKey: fk, floorLabel: floorLabel(tree, fk), roomId: String(r.id), room: String(r.name == null ? "" : r.name), index: i, item: items[i] };
    }
  }
  return null;
}
// Every item id on every tree (ids never collide across trees either).
function allIds(data) {
  const ids = [];
  for (const k of Object.values(PHASES)) {
    const t = data[k];
    if (!isObj(t)) { if (Array.isArray(t)) t.forEach(x => x && x.id != null && ids.push(x.id)); continue; }
    for (const fk of floorKeysOf(t)) {
      const fl = normFloor(t[fk]);
      fl.general.forEach(x => x && x.id != null && ids.push(x.id));
      fl.hotcheck.forEach(x => x && x.id != null && ids.push(x.id));
      fl.rooms.forEach(r => { if (r && r.id != null) ids.push(r.id); (r && Array.isArray(r.items) ? r.items : []).forEach(x => x && x.id != null && ids.push(x.id)); });
    }
  }
  return ids;
}
// uid() → a millisecond string; here bumped past every id already on the job so
// two things never share one, and each call hands out the next.
function idMinter(nowMs, data) {
  const taken = new Set(allIds(data).map(String));
  return () => { const id = newItemId(nowMs, [...taken]); taken.add(id); return id; };
}
// handleVoidQCItem's `upd`: the one item patched where it sits on a normalized floor.
function patchOnFloor(floor, roomId, itemId, fn) {
  const upd = (items) => items.map(i => (i && sameId(i.id, itemId) ? fn(i) : i));
  if (roomId === "general") return { ...floor, general: upd(floor.general) };
  if (roomId === "hotcheck") return { ...floor, hotcheck: upd(floor.hotcheck || []) };
  return { ...floor, rooms: floor.rooms.map(r => (r && sameId(r.id, roomId) ? { ...r, items: upd(r.items || []) } : r)) };
}

// Common entry: the job, the phase, the item. ctx.job = { id, data }.
function openItem(args, ctx, { allowDone = true, allowVoided = false } = {}) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "").toLowerCase();
  if (!PHASE_NAMES.includes(phase)) return refuse(`phase must be one of ${PHASE_NAMES.join(", ")}.`);
  const itemId = String(a.itemId || "");
  if (!ID.test(itemId)) return refuse("itemId must be the punch item's id (punchId from cc_list_punch).");
  const treeKey = PHASES[phase];
  const data = ctx.job.data, name = data.name || "that job";
  const tree = data[treeKey];
  if (Array.isArray(tree)) return refuse(`${name}'s ${phase} punch is still a legacy flat list the app can't show or edit — open the job in the app first. Nothing was written.`);
  const loc = locate(isObj(tree) ? tree : null, itemId);
  if (!loc) {
    const elsewhere = PHASE_NAMES.filter(p => p !== phase && locate(isObj(data[PHASES[p]]) ? data[PHASES[p]] : null, itemId));
    return refuse(`No ${phase} punch item with id ${itemId} on ${name}${elsewhere.length ? ` — it is on the ${elsewhere[0]} list; say phase ${elsewhere[0]}` : " (check cc_list_punch for the id)"}. Nothing was written.`);
  }
  if (!allowVoided && loc.item.voided === true) return refuse(`That punch item is voided${loc.item.voidReason ? ` (${String(loc.item.voidReason).slice(0, 80)})` : ""} — restore it first (cc_void_punch_item with restore). Nothing was written.`);
  if (!allowDone && loc.item.done) return refuse(`That punch item is already done (by ${loc.item.checkedBy || "someone"}${loc.item.checkedAt ? ` on ${loc.item.checkedAt}` : ""}) — the app hides this control on done items. Un-tick it first if it really needs changing. Nothing was written.`);
  return { phase, treeKey, tree, loc, data, name, itemId };
}
const itemText = (it) => String(it && it.text == null ? "" : it.text).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 160);
const where = (o) => ({ phase: o.phase, floor: o.loc.floorKey, floorLabel: o.loc.floorLabel, room: o.loc.room || undefined, roomId: o.loc.roomId });
// Plain text → the HTML the RichEditor would hold for it: escaped, line breaks kept.
const toHtml = (plain) => escapeHtml(plain).replace(/\n/g, "<br>");
// punchStamp (App.js ~L8060) on the server: addedAt is the Mountain-time YMD
// (MUST stay YYYY-MM-DD — the Friday Packet string-compares it), addedAtTs the ISO.
function punchStamp(nowIso, tz) { return { addedAt: new Date(nowIso).toLocaleDateString("en-CA", { timeZone: tz || "America/Denver" }), addedAtTs: nowIso }; }

// Rebuild the edited tree (handleFloorChange shape) around ONE patched item.
function rebuildAround(o, fn) {
  const floor = normFloor(o.tree[o.loc.floorKey]);
  const newFloor = patchOnFloor(floor, o.loc.roomId, o.itemId, fn);
  return rebuildTree(o.tree, o.loc.floorKey, newFloor);
}
const findIn = (tree, itemId) => { const l = locate(tree, itemId); return l ? l.item : null; };

// ── 1. done / undone ─────────────────────────────────────────────────────────
// The checkbox (~L13376): done → {done:true, checkedBy, checkedAt:"M/D/YYYY",
// checkedAtTs: ISO, waiting:false}; undone → done:false and the three stamps
// cleared (waiting left as it was). Then u(): the slot from punchTickPatches,
// and for rough / finish handlePhasePunchChange's cascade onto linked
// return-trip entries (originItemId, originPhase — a legacy entry with no
// originPhase counts as rough, the app's `(p.originPhase||"rough")`).
function planSetDone(args, ctx) {
  const o = openItem(args, ctx); if (o.refused) return o;
  if (typeof args.done !== "boolean") return refuse("done must be true or false.");
  const done = args.done;
  if (!!o.loc.item.done === done) return { noop: true, result: { punchId: o.itemId, ...where(o), done, text: itemText(o.loc.item), message: `Already ${done ? "done" : "open"} — nothing to change.` } };
  const when = mdy(ctx.nowIso, ctx.tz), whenTs = ctx.nowIso;
  const flip = (i) => (done ? { ...i, done: true, checkedBy: ME, checkedAt: when, checkedAtTs: whenTs, waiting: false } : { ...i, done: false, checkedBy: "", checkedAt: "", checkedAtTs: "" });
  const nextTree = rebuildAround(o, flip);
  const after = findIn(nextTree, o.itemId);
  const fields = { [o.treeKey]: nextTree };
  // The slot — the app's own rule, from the tree it started from to the tree it sends.
  const slots = punchTickPatches(normalizeTree(o.tree), nextTree, ME, ctx.nowIso);
  const slotKeys = Object.keys(slots);
  if (slotKeys.length !== 1 || slotKeys[0] !== "punchTicks." + o.itemId) return refuse("Couldn't derive this item's check-off slot. Nothing was written.");
  fields[slotKeys[0]] = slots[slotKeys[0]];
  const prevSlot = isObj(o.data.punchTicks) && o.data.punchTicks[o.itemId] !== undefined ? o.data.punchTicks[o.itemId] : null;
  const before = { [o.treeKey]: o.loc.item, [slotKeys[0]]: prevSlot };
  const out = { [o.treeKey]: after, [slotKeys[0]]: slots[slotKeys[0]] };
  // handlePhasePunchChange's cascade (rough / finish only).
  let cascaded = 0;
  if (o.phase !== "qc") {
    const trips = Array.isArray(o.data.returnTrips) ? o.data.returnTrips : [];
    const rtBefore = [], rtAfter = [];
    const nextTrips = trips.map(rt => {
      if (!rt || !Array.isArray(rt.punch)) return rt;
      let changed = false;
      const newPunch = rt.punch.map(p => {
        if (!p || !p.originItemId || !sameId(p.originItemId, o.itemId) || (p.originPhase || "rough") !== o.phase) return p;
        if (!!p.done === done) return p;
        changed = true; cascaded++;
        rtBefore.push({ rtId: rt.id, entry: p });
        const np = { ...p, done, checkedBy: done ? (ME || p.checkedBy || "") : "", checkedAt: done ? (when || p.checkedAt || "") : "", checkedAtTs: done ? whenTs : "" };
        rtAfter.push({ rtId: rt.id, entry: np });
        return np;
      });
      return changed ? { ...rt, punch: newPunch } : rt;
    });
    if (cascaded) { fields.returnTrips = nextTrips; before.returnTrips = rtBefore; out.returnTrips = rtAfter; }
  }
  return { fields, before, after: out, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), done, text: itemText(after), checkedBy: after.checkedBy, checkedAt: after.checkedAt, slot: slots[slotKeys[0]], returnTripEntriesUpdated: cascaded, pushTo: [] } };
}

// ── 2. add ───────────────────────────────────────────────────────────────────
// commitAdd (~L13205) + the room draft (~L13913) + handlePhasePunchChange's
// fan-out. args: { jobId, phase, floor, text, where: general|hotcheck|room,
// roomId?, roomName?, materialNeeded?, materialSource? }.
function planAdd(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const phase = String(a.phase || "").toLowerCase();
  if (!PHASE_NAMES.includes(phase)) return refuse(`phase must be one of ${PHASE_NAMES.join(", ")}.`);
  const treeKey = PHASES[phase];
  const data = ctx.job.data, name = data.name || "that job";
  if (Array.isArray(data[treeKey])) return refuse(`${name}'s ${phase} punch is still a legacy flat list the app can't show or edit — open the job in the app first. Nothing was written.`);
  const tree = isObj(data[treeKey]) ? data[treeKey] : {};
  const floorKey = String(a.floor || "");
  const valid = floorKeysOf(tree);
  if (!valid.includes(floorKey)) return refuse(`floor must be one of ${valid.map(k => (BASE_FLOORS.includes(k) ? k : `${k} (${floorLabel(tree, k)})`)).join(", ")} on ${name}'s ${phase} punch — a new floor is added from the app, not from Duet. Nothing was written.`);
  const plain = cleanText(a.text);
  if (!plain) return refuse("A punch item needs text.");
  const target = String(a.where || "general");
  if (!["general", "hotcheck", "room"].includes(target)) return refuse("where must be general, hotcheck or room.");
  if (target === "hotcheck" && !HOTCHECK_PHASES.includes(phase)) return refuse(`The Hot Check list exists on finish and qc only — the ${phase} punch has no hot check. Use general or a room. Nothing was written.`);
  let mat = "", src = "";
  if (a.materialNeeded != null) { if (typeof a.materialNeeded !== "string") return refuse("materialNeeded must be text."); mat = cleanText(a.materialNeeded); }
  if (a.materialSource != null) { src = String(a.materialSource); if (!MAT_SOURCES.includes(src)) return refuse(`materialSource must be one of ${MAT_SOURCES.filter(Boolean).join(", ")} (or blank).`); }
  const mint = idMinter(Date.parse(ctx.nowIso), data);
  const newItem = { id: mint(), text: toHtml(plain), done: false, addedBy: ME, ...punchStamp(ctx.nowIso, ctx.tz) };
  if (mat.trim()) { newItem.materialNeeded = mat.trim(); if (src) newItem.materialSource = src; }
  const floor = normFloor(tree[floorKey]);
  let newFloor, room = "", roomId = "", roomAdded = null;
  if (target === "general") newFloor = { ...floor, general: [...floor.general, newItem] };
  else if (target === "hotcheck") newFloor = { ...floor, hotcheck: [...(floor.hotcheck || []), newItem] };
  else {
    let r = null;
    if (a.roomId != null && a.roomId !== "") {
      if (!ID.test(String(a.roomId))) return refuse("roomId must be a room id from cc_list_punch.");
      r = floor.rooms.find(x => x && sameId(x.id, a.roomId)) || null;
      if (!r) return refuse(`No room with id ${a.roomId} on the ${floorLabel(tree, floorKey)} of ${name}'s ${phase} punch${floor.rooms.length ? ` — rooms there: ${floor.rooms.map(x => x && x.name).filter(Boolean).slice(0, 12).join(", ")}` : ""}. Nothing was written.`);
    } else {
      const want = ccRoomCleanName(a.roomName);
      if (!want) return refuse("For a room, give roomId or roomName.");
      const k = ccRoomNameKey(want);
      r = floor.rooms.find(x => x && ccRoomNameKey(x.name) === k) || null;
      if (!r) { r = { id: mint(), name: want, items: [] }; roomAdded = { id: r.id, name: r.name }; }
    }
    room = String(r.name == null ? "" : r.name); roomId = String(r.id);
    const withItem = { ...r, items: [...(Array.isArray(r.items) ? r.items : []), newItem] };
    const rooms = roomAdded ? [...floor.rooms, withItem] : floor.rooms.map(x => (x === r ? withItem : x));
    newFloor = { ...floor, rooms };
  }
  const nextTree = rebuildTree(tree, floorKey, newFloor);
  let fields = { [treeKey]: nextTree };
  const fannedOut = {};
  if (phase !== "qc") {
    // handlePhasePunchChange → fanOutAddedRooms with the live trees as prevTrees;
    // the Legacy QC section joins while it has open items.
    const legacyQcShowing = !!(data.qcPunch && punchOpen(data.qcPunch) > 0);
    const patch = fanOutAddedRooms({ roughPunch: data.roughPunch, finishPunch: data.finishPunch, qcPunch: data.qcPunch }, phase, nextTree, legacyQcShowing, mint);
    fields = patch;
    for (const k of Object.keys(patch)) if (k !== treeKey) { const nf = normFloor(patch[k][floorKey]); fannedOut[k] = nf.rooms[nf.rooms.length - 1]; }
  }
  const before = { [treeKey]: null };
  const after = { [treeKey]: newItem, ...(roomAdded ? { roomAdded } : {}) };
  Object.keys(fannedOut).forEach(k => { before[k] = null; after[k] = { roomAdded: fannedOut[k] }; });
  const listNow = target === "general" ? newFloor.general.length : target === "hotcheck" ? newFloor.hotcheck.length : newFloor.rooms.find(x => x && sameId(x.id, roomId)).items.length;
  return { fields, before, after, itemId: newItem.id,
    result: { punchId: newItem.id, phase, floor: floorKey, floorLabel: floorLabel(tree, floorKey), where: target, room: room || undefined, roomId: roomId || undefined, roomAdded: !!roomAdded, roomFannedOutTo: Object.keys(fannedOut).length ? Object.keys(fannedOut) : undefined,
      text: plain.slice(0, 160), materialNeeded: newItem.materialNeeded, materialSource: newItem.materialSource, addedAt: newItem.addedAt, number: listNow,
      materialNote: mat.trim() ? "Material is noted on the item; the material card (Materials tab) is not written from Duet yet — ship 8." : undefined, pushTo: [] } };
}

// ── 3. assign ────────────────────────────────────────────────────────────────
// The assignee select (~L13522): {...i, assignedTo: v}, "" clears. Hidden on
// done items, so a done item refuses. The app's punch_assigned push (functions
// onJobUpdate) walks upper / main / basement only — an extras floor sends none.
function planAssign(args, ctx) {
  const o = openItem(args, ctx, { allowDone: false }); if (o.refused) return o;
  if (args.assignedTo == null || typeof args.assignedTo !== "string") return refuse('assignedTo must be a team member\'s name, or "" to clear it.');
  let to = "";
  if (args.assignedTo.trim()) { const who = resolvePerson(args.assignedTo, ctx.users); if (who.refused) return who; to = who.name; }
  const from = String(o.loc.item.assignedTo == null ? "" : o.loc.item.assignedTo);
  if (from === to) return { noop: true, result: { punchId: o.itemId, ...where(o), assignedTo: to, text: itemText(o.loc.item), message: to ? `Already assigned to ${to} — nothing to change.` : "Already unassigned — nothing to change." } };
  const nextTree = rebuildAround(o, (i) => ({ ...i, assignedTo: to }));
  const after = findIn(nextTree, o.itemId);
  const onBase = BASE_FLOORS.includes(o.loc.floorKey);
  return { fields: { [o.treeKey]: nextTree }, before: { [o.treeKey]: o.loc.item }, after: { [o.treeKey]: after }, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), from, to, assignedTo: to, text: itemText(after), pushTo: to && to !== "Unassigned" && onBase ? [to] : [],
      pushNote: to && !onBase ? `No push: the app's punch_assigned push only walks upper / main / basement, and this item is on the ${o.loc.floorLabel} floor.` : undefined } };
}

// ── 4. waiting ───────────────────────────────────────────────────────────────
// commitWaiting (~L13245): {waiting:true, waitingOn: text.trim()}; clearWaiting: {waiting:false, waitingOn:''}.
function planWaiting(args, ctx) {
  const o = openItem(args, ctx, { allowDone: false }); if (o.refused) return o;
  if (typeof args.waiting !== "boolean") return refuse("waiting must be true (with waitingOn) or false.");
  const it = o.loc.item;
  let patch;
  if (args.waiting) {
    const on = cleanText(args.waitingOn).replace(/\n+/g, " ").trim();
    if (!on) return refuse("Say what the item is waiting on (waitingOn).");
    if (it.waiting === true && String(it.waitingOn || "") === on) return { noop: true, result: { punchId: o.itemId, ...where(o), waiting: true, waitingOn: on, text: itemText(it), message: "Already waiting on that — nothing to change." } };
    patch = { waiting: true, waitingOn: on };
  } else {
    if (!it.waiting) return { noop: true, result: { punchId: o.itemId, ...where(o), waiting: false, text: itemText(it), message: "Not marked waiting — nothing to change." } };
    patch = { waiting: false, waitingOn: "" };
  }
  const nextTree = rebuildAround(o, (i) => ({ ...i, ...patch }));
  const after = findIn(nextTree, o.itemId);
  return { fields: { [o.treeKey]: nextTree }, before: { [o.treeKey]: it }, after: { [o.treeKey]: after }, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), waiting: patch.waiting, waitingOn: patch.waitingOn, wasWaitingOn: it.waiting ? String(it.waitingOn || "") : undefined, text: itemText(after), pushTo: [] } };
}

// ── 5. void / restore (QC walk items only) ───────────────────────────────────
// commitVoid (~L14596) via handleVoidQCItem (~L32302): only an item the QC walk
// added (fromQC === true), reason required; {voided:true, voidReason,
// voidedBy, voidedAt:"M/D/YYYY"}; the tree is `{...src, [floorKey]: newFloor}`
// (NOT the whole-tree rebuild) and matching clones are stripped from open
// QC-Fail return trips in the same write. The QC walk exists for rough and finish.
function qcGate(args, ctx) {
  const o = openItem(args, ctx, { allowVoided: true }); if (o.refused) return o;
  if (o.phase === "qc") return refuse("Void / restore is the QC walk's control on rough and finish items; the Legacy QC list has no void. Nothing was written.");
  if (o.loc.item.fromQC !== true) return refuse(`That ${o.phase} punch item wasn't added by the QC walk (no fromQC flag), so the app has no Void for it — items are never deleted from Duet; mark it done or edit it instead. Nothing was written.`);
  return o;
}
function planVoid(args, ctx) {
  const o = qcGate(args, ctx); if (o.refused) return o;
  const reason = cleanText(args.reason).replace(/\n+/g, " ").trim();
  if (!reason) return refuse("Please add a reason before voiding (the app requires one).");
  const it = o.loc.item;
  if (it.voided === true) return { noop: true, result: { punchId: o.itemId, ...where(o), voided: true, voidReason: it.voidReason || "", text: itemText(it), message: "Already voided — nothing to change." } };
  const patch = { voided: true, voidReason: reason, voidedBy: ME, voidedAt: mdy(ctx.nowIso, ctx.tz) };
  const floor = normFloor(o.tree[o.loc.floorKey]);
  const nextTree = { ...o.tree, [o.loc.floorKey]: patchOnFloor(floor, o.loc.roomId, o.itemId, (i) => ({ ...i, ...patch })) };
  const after = findIn(nextTree, o.itemId);
  const fields = { [o.treeKey]: nextTree };
  const before = { [o.treeKey]: it }, out = { [o.treeKey]: after };
  const trips = Array.isArray(o.data.returnTrips) ? o.data.returnTrips : [];
  const stripped = [];
  const nextTrips = trips.map(rt => {
    if (!rt || rt.signedOff) return rt;
    const isQCFail = rt.fromQCFail === true || (typeof rt.scope === "string" && rt.scope.startsWith("QC Fail"));
    if (!isQCFail) return rt;
    const list = rt.punch || [];
    const nextRTPunch = list.filter(p => !(p && sameId(p.originItemId, o.itemId) && p.originPhase === o.phase));
    if (nextRTPunch.length === list.length) return rt;
    list.filter(p => p && sameId(p.originItemId, o.itemId) && p.originPhase === o.phase).forEach(p => stripped.push({ rtId: rt.id, entry: p }));
    return { ...rt, punch: nextRTPunch };
  });
  if (stripped.length) { fields.returnTrips = nextTrips; before.returnTrips = stripped; out.returnTrips = stripped.map(s => ({ rtId: s.rtId, removedEntryId: s.entry.id })); }
  return { fields, before, after: out, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), voided: true, voidReason: reason, voidedBy: ME, voidedAt: patch.voidedAt, text: itemText(after), returnTripClonesRemoved: stripped.length, pushTo: [] } };
}
// restoreVoided (~L14627): the four void fields cleared through writeFloor →
// handlePhasePunchChange (whole-tree rebuild; no rooms added, no done change,
// so neither fan-out nor cascade has anything to do). Nothing is re-added to a trip.
function planRestore(args, ctx) {
  const o = qcGate(args, ctx); if (o.refused) return o;
  const it = o.loc.item;
  if (it.voided !== true) return { noop: true, result: { punchId: o.itemId, ...where(o), voided: false, text: itemText(it), message: "Not voided — nothing to change." } };
  const nextTree = rebuildAround(o, (i) => ({ ...i, voided: false, voidReason: "", voidedBy: "", voidedAt: "" }));
  const after = findIn(nextTree, o.itemId);
  return { fields: { [o.treeKey]: nextTree }, before: { [o.treeKey]: it }, after: { [o.treeKey]: after }, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), voided: false, wasVoidReason: String(it.voidReason || ""), text: itemText(after), returnTripClonesReAdded: 0, pushTo: [] } };
}

// ── 6. edit text / material ──────────────────────────────────────────────────
// commitEdit (~L13230): {text: html} (+ materialNeeded: material.trim(),
// materialSource when given); the edit control is hidden on done items.
function planEditText(args, ctx) {
  const o = openItem(args, ctx, { allowDone: false }); if (o.refused) return o;
  const a = args || {};
  const patch = {};
  if (a.text != null) {
    if (typeof a.text !== "string") return refuse("text must be text.");
    const plain = cleanText(a.text);
    if (!plain) return refuse("The new text is empty — to clear an item, mark it done instead (items are never deleted from Duet).");
    patch.text = toHtml(plain);
  }
  if (a.materialNeeded != null) { if (typeof a.materialNeeded !== "string") return refuse("materialNeeded must be text."); patch.materialNeeded = cleanText(a.materialNeeded).trim(); }
  if (a.materialSource != null) { const src = String(a.materialSource); if (!MAT_SOURCES.includes(src)) return refuse(`materialSource must be one of ${MAT_SOURCES.filter(Boolean).join(", ")} (or blank).`); patch.materialSource = src; }
  if (!Object.keys(patch).length) return refuse("Say what to change: text, materialNeeded and/or materialSource.");
  const it = o.loc.item;
  const changed = Object.keys(patch).filter(k => String(it[k] == null ? "" : it[k]) !== String(patch[k]));
  if (!changed.length) return { noop: true, result: { punchId: o.itemId, ...where(o), text: itemText(it), message: "Already says that — nothing to change." } };
  const nextTree = rebuildAround(o, (i) => ({ ...i, ...patch }));
  const after = findIn(nextTree, o.itemId);
  return { fields: { [o.treeKey]: nextTree }, before: { [o.treeKey]: it }, after: { [o.treeKey]: after }, itemId: o.itemId,
    result: { punchId: o.itemId, ...where(o), changed, text: itemText(after), materialNeeded: after.materialNeeded, materialSource: after.materialSource,
      materialNote: changed.some(k => k.startsWith("material")) ? "Material is noted on the item; the material card is not written from Duet yet — ship 8." : undefined, pushTo: [] } };
}

module.exports = { PHASES, BASE_FLOORS, MAT_SOURCES, HOTCHECK_PHASES, normFloor, normalizeTree, rebuildTree, floorKeysOf, floorLabel, punchOpen, ccRoomNameKey, ccRoomCleanName, adoptRooms, fanOutAddedRooms, locate, allIds, idMinter, punchStamp, toHtml,
  planSetDone, planAdd, planAssign, planWaiting, planVoid, planRestore, planEditText };
