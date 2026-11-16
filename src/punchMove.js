// punchMove.js — move open Rough punch items to the Finish punch list, or put
// them on a return trip (v642).
//
// WHY THIS EXISTS (Koy, 2026-11-16)
// --------------------------------
// "have the option to send the punchlist items to the finished punchlist or send
// them to a new return trip … that way I don't have to manually copy and paste
// them over if I want to move them, and we have a record of them being moved."
// Mockup approved as shown: docs/mockups/punch-move.html
// (claude.ai/artifact/PJRBcbY7BiUSFaudPKxt9h).
//
// TO FINISH: the item is copied into the same floor and room on the Finish tree
// (an extras floor is added to Finish with the same key and label when it is
// missing; a room is matched by its name key, else added), carrying
// movedFrom {phase, itemId, by, at}. The Rough original stays where it is, done
// (so every open-count in the app stops counting it and the save funnel writes
// its punchTicks slot like any check-off), with movedTo {phase, itemId, by, at}.
// The punch row draws it greyed with "Moved to Finish" and no checkbox.
//
// TO A RETURN TRIP: the link trips already have (PunchLinker, the done cascade
// in handlePhasePunchChange / handleReturnTripsChange): an entry
// {id, text:"[Rough · Floor · Room] text", done:false, originItemId,
// originPhase:"rough", addedAt, addedAtTs, movedBy} on the trip. The Rough item
// is NOT changed: it stays open until the trip work is done, and ticking it on
// the trip ticks it here. A new trip is the app's usual literal with
// scope "Rough punch leftovers" and needsSchedule.
//
// Pure, CommonJS, no requires. App.js imports it; scripts/punch-move-test.js
// drives this exact file. Nothing here touches Firestore: callers write the
// returned trees / trips through JobDetail's u(), which adds the check-off slots.
"use strict";

const BASE = ["upper", "main", "basement"];
const BASE_LABEL = { upper: "Upper", main: "Main", basement: "Basement" };

// Room identity, the same key the app folds rooms on (ccRoomNameKey).
const roomKey = (v) => String(v == null ? "" : v).replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim().toLowerCase();
const plain = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function floorsOf(punch) {
  const p = punch || {};
  const extras = (Array.isArray(p.extras) ? p.extras : []).filter(e => e && e.key);
  return [
    ...BASE.map(k => ({ key: k, label: BASE_LABEL[k], extra: null })),
    ...extras.map(e => ({ key: e.key, label: e.label || e.key, extra: e })),
  ];
}

// Every open item on a tree (not done, not voided), with where it lives.
// place: "general" | "hotcheck" | "room"; roomId / roomName for a room.
function openItems(punch) {
  const out = [];
  const p = punch || {};
  floorsOf(p).forEach(f => {
    const fl = p[f.key];
    if (!fl || typeof fl !== "object" || Array.isArray(fl)) return;
    const take = (it, place, room) => {
      if (!it || typeof it !== "object" || it.done || it.voided || !it.id) return;
      out.push({ item: it, floorKey: f.key, floorLabel: f.label, extra: f.extra, place,
        roomId: room ? room.id : "", roomName: room ? (room.name || "Room") : (place === "hotcheck" ? "Hot check" : "General") });
    };
    (fl.general || []).forEach(i => take(i, "general"));
    (fl.hotcheck || []).forEach(i => take(i, "hotcheck"));
    (fl.rooms || []).forEach(r => ((r && r.items) || []).forEach(i => take(i, "room", r)));
  });
  return out;
}

// Map one item by id across a tree, copy-on-write. fn(item) → new item.
function mapItems(punch, ids, fn) {
  const hit = ids instanceof Set ? ids : new Set(ids);
  const p = punch || {};
  const out = { ...p };
  floorsOf(p).forEach(f => {
    const fl = p[f.key];
    if (!fl || typeof fl !== "object" || Array.isArray(fl)) return;
    let changed = false;
    const m = (i) => (i && hit.has(i.id) ? (changed = true, fn(i)) : i);
    const next = { ...fl,
      general: (fl.general || []).map(m),
      hotcheck: (fl.hotcheck || []).map(m),
      rooms: (fl.rooms || []).map(r => (r && Array.isArray(r.items) ? { ...r, items: r.items.map(m) } : r)) };
    if (changed) out[f.key] = next;
  });
  return out;
}

const emptyFloor = () => ({ general: [], rooms: [], hotcheck: [], photos: [] });

// The Finish copy of a Rough item: its words, photos, material and who added it,
// open, with where it came from. Done / checked / waiting / assignment stamps stay behind.
function finishCopy(it, newId, by, at) {
  const c = { id: newId, text: it.text || "", done: false };
  ["addedBy", "addedAt", "addedAtTs", "materialNeeded", "materialSource", "assignedTo"].forEach(k => { if (it[k] != null && it[k] !== "") c[k] = it[k]; });
  if (Array.isArray(it.photos) && it.photos.length) c.photos = it.photos.slice();
  c.movedFrom = { phase: "rough", itemId: it.id, by: by || "", at: at || "" };
  return c;
}

// ids: Rough item ids to move. newId(): a fresh id (App's uid). by / at: who and
// M/D/YYYY. atTs: ISO. Returns { roughPunch, finishPunch, moved:[{fromId, toId}] }
// with only open, not-voided items moved; anything else in ids is ignored.
function planMoveToFinish(roughPunch, finishPunch, ids, newId, by, at, atTs) {
  const want = new Set(ids || []);
  const picks = openItems(roughPunch).filter(o => want.has(o.item.id));
  if (!picks.length) return { roughPunch, finishPunch, moved: [] };
  const fin = { ...(finishPunch || {}) };
  if (Array.isArray(fin.extras)) fin.extras = fin.extras.slice();
  const moved = [];
  picks.forEach(o => {
    const toId = newId();
    moved.push({ fromId: o.item.id, toId });
    // The floor on Finish (an extras floor is added with the same key + label).
    if (o.extra && !(fin.extras || []).some(e => e && e.key === o.floorKey)) {
      fin.extras = [...(fin.extras || []), { key: o.floorKey, label: o.floorLabel }];
    }
    const fl0 = fin[o.floorKey];
    const fl = fl0 && typeof fl0 === "object" && !Array.isArray(fl0)
      ? { ...emptyFloor(), ...fl0, general: (fl0.general || []).slice(), hotcheck: (fl0.hotcheck || []).slice(), rooms: (fl0.rooms || []).slice() }
      : (Array.isArray(fl0) ? { ...emptyFloor(), general: fl0.slice() } : emptyFloor());
    const copy = finishCopy(o.item, toId, by, at);
    if (o.place === "room") {
      const k = roomKey(o.roomName);
      const idx = fl.rooms.findIndex(r => r && roomKey(r.name) === k);
      if (idx >= 0) fl.rooms[idx] = { ...fl.rooms[idx], items: [...(fl.rooms[idx].items || []), copy] };
      else fl.rooms.push({ id: newId(), name: o.roomName, items: [copy] });
    } else if (o.place === "hotcheck") {
      fl.hotcheck.push(copy);
    } else {
      fl.general.push(copy);
    }
    fin[o.floorKey] = fl;
  });
  const toById = new Map(moved.map(m => [m.fromId, m.toId]));
  const rough = mapItems(roughPunch, toById.keys(), (i) => ({ ...i,
    done: true, checkedBy: by || "", checkedAt: at || "", checkedAtTs: atTs || "", waiting: false,
    movedTo: { phase: "finish", itemId: toById.get(i.id), by: by || "", at: at || "" } }));
  return { roughPunch: rough, finishPunch: fin, moved };
}

// Undo of planMoveToFinish, on the FRESHEST trees: the Rough items open again
// (stamps and movedTo cleared), the Finish copies taken back out by id. A room or
// extras floor the move added stays (empty): rooms are never deleted by a write.
function undoMoveToFinish(roughPunch, finishPunch, moved) {
  const from = new Set((moved || []).map(m => m.fromId));
  const to = new Set((moved || []).map(m => m.toId));
  const rough = mapItems(roughPunch, from, (i) => {
    const { movedTo, ...rest } = i;   // eslint-disable-line no-unused-vars
    return { ...rest, done: false, checkedBy: "", checkedAt: "", checkedAtTs: "" };
  });
  const p = finishPunch || {};
  const fin = { ...p };
  floorsOf(p).forEach(f => {
    const fl = p[f.key];
    if (!fl || typeof fl !== "object" || Array.isArray(fl)) return;
    const keep = (i) => !(i && to.has(i.id));
    fin[f.key] = { ...fl, general: (fl.general || []).filter(keep), hotcheck: (fl.hotcheck || []).filter(keep),
      rooms: (fl.rooms || []).map(r => (r && Array.isArray(r.items) ? { ...r, items: r.items.filter(keep) } : r)) };
  });
  return { roughPunch: rough, finishPunch: fin };
}

// A return trip is open until signed off or marked complete (punchListStage's rule).
const tripOpen = (rt) => !!rt && typeof rt === "object" && !rt.signedOff && rt.rtStatus !== "complete";
// Open trips with their number as the app shows it (#index+1).
function openTrips(trips) {
  return (Array.isArray(trips) ? trips : []).map((t, i) => ({ trip: t, no: i + 1 })).filter(x => tripOpen(x.trip));
}

// The app's new-trip literal (ReturnTrips' add), for the leftovers.
function newLeftoverTrip(id) {
  return { id, date: "", scope: "Rough punch leftovers", material: "", punch: [], photos: [], assignedTo: "",
    signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "",
    rtStatus: "needs", fromPunchMove: true };
}

// tripId: an open trip's id, or "new". stamp: { addedAt, addedAtTs } (punchStamp()).
// Items already linked to THAT trip are skipped. Returns { returnTrips, tripNo,
// added, addedIds, newTripId } (newTripId only when a trip was made).
function planLinkToTrip(roughPunch, trips, ids, tripId, newId, by, stamp) {
  const want = new Set(ids || []);
  const list = Array.isArray(trips) ? trips.slice() : [];
  let idx = tripId === "new" ? -1 : list.findIndex(t => t && t.id === tripId && tripOpen(t));
  if (tripId !== "new" && idx < 0) return { returnTrips: trips, tripNo: 0, added: 0, addedIds: [], newTripId: "" };
  let newTripId = "";
  if (idx < 0) { newTripId = newId(); list.push(newLeftoverTrip(newTripId)); idx = list.length - 1; }
  const trip = list[idx];
  const already = new Set((trip.punch || []).filter(p => p && p.originItemId && (p.originPhase || "rough") === "rough").map(p => p.originItemId));
  const entries = openItems(roughPunch).filter(o => want.has(o.item.id) && !already.has(o.item.id)).map(o => ({
    id: newId(),
    text: `[Rough · ${o.floorLabel} · ${o.roomName}] ${plain(o.item.text)}`,
    done: false,
    originItemId: o.item.id,
    originPhase: "rough",
    ...(stamp || {}),
    movedBy: by || "",
  }));
  if (!entries.length) return { returnTrips: trips, tripNo: tripId === "new" ? 0 : idx + 1, added: 0, addedIds: [], newTripId: "" };
  list[idx] = { ...trip, punch: [...(trip.punch || []), ...entries] };
  return { returnTrips: list, tripNo: idx + 1, added: entries.length, addedIds: entries.map(e => e.id), newTripId };
}

// Undo of planLinkToTrip on the FRESHEST trip list: the added entries come back
// off by id; a trip the move made is removed only while it holds nothing else.
function undoLinkToTrip(trips, addedIds, newTripId) {
  const gone = new Set(addedIds || []);
  return (Array.isArray(trips) ? trips : [])
    .map(t => (t && Array.isArray(t.punch) && t.punch.some(p => p && gone.has(p.id)) ? { ...t, punch: t.punch.filter(p => !(p && gone.has(p.id))) } : t))
    .filter(t => !(newTripId && t && t.id === newTripId && !(t.punch || []).length && !(t.photos || []).length && !t.assignedTo && !t.scheduledDate));
}

module.exports = { openItems, planMoveToFinish, undoMoveToFinish, openTrips, tripOpen, newLeftoverTrip, planLinkToTrip, undoLinkToTrip, roomKey };
