// punchTicks.js — punch check-offs as per-item slots.
//
// WHY THIS EXISTS (v559, 2026-10-22)
// -----------------------------------
// A punch check-off used to reach Firestore only inside a re-send of the WHOLE
// punch tree (roughPunch / finishPunch / qcPunch) from one phone's copy, and a
// client-side three-way merge decided whose copy won. That merge depends on a
// per-phone baseline staying in step with the on-screen copy, and it has failed
// at least nine times since July. Miller #1788319922110, 2026-10-22 15:32:34Z:
// Keegan's phone un-ticked Austin's "Cut in floor outlets" 46 s after a
// `merged:true` save — baseline moved to the merged copy, screen did not, the
// next save took the "server == baseline → client verbatim" fast path with a
// stale tree.
//
// Now every flip of `done` ALSO writes its own slot:
//   data.punchTicks.<itemId> = { done, by, at: "M/D/YYYY", ts: ISO }
// written only as a dotted field path (never the whole map), so the server
// merges slot by slot and no phone's copy of the map ever goes back. On read,
// applyPunchTicks() lays the slots over the trees (and over linked return-trip
// entries) before anything looks at `done`. The tree write still happens and
// still carries `done`, so it converges; the slot is the record.
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js), the Cloud
// Functions readers require a copy, and scripts/punch-ticks-test.js drives the
// exact file that ships. COPIED to functions/punchTicks.js by
// scripts/punch-ticks-sync.js — edit THIS file only; the prebuild refuses to
// build while the two differ.
//
// Rules (design: docs/superpowers/specs/2026-10-22-punch-tick-slots-design.md):
//  • punchTickPatches(prev, next): a slot for every item whose `done` differs
//    between the tree a writer started from and the tree it sends. Adds,
//    edits, voids, removals, moves: no slot. "What this writer changed" is the
//    only honest source — never diff against a "last seen" copy.
//  • applyPunchTicks(job): done slot → done + the slot's stamps; un-done slot →
//    open + stamps cleared (the app's convention). One exception for the
//    mixed-version window: a tree item that is done with a checkedAtTs NEWER
//    than the slot's ts keeps the tree (an older build ticked it after the slot).
//    Same object identity back when nothing changes; unchanged branches keep
//    identity (copy-on-write).
//  • slotWins(server, ours): latest ts wins on the same item; ties and junk → ours.
//    `ts` comes from each phone's clock, so a phone running minutes fast can win
//    an un-tick it should have lost for that long (self-heals on the next tap).
"use strict";

const PREFIX = "punchTicks.";
const TREES = ["roughPunch", "finishPunch", "qcPunch"];
const FLOORS = ["upper", "main", "basement"];

function isTickKey(k) { return typeof k === "string" && k.length > PREFIX.length && k.indexOf(PREFIX) === 0; }
function tickIdOf(k) { return isTickKey(k) ? k.slice(PREFIX.length) : ""; }

function isSlot(s) { return !!s && typeof s === "object" && !Array.isArray(s) && typeof s.done === "boolean"; }
function parseTs(ts) { const t = Date.parse(ts); return Number.isFinite(t) ? t : NaN; }
function mdy(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// true = write ours. Server slot missing/invalid → ours; server strictly newer → server's; tie/unparseable → ours.
function slotWins(serverSlot, ourSlot) {
  if (!isSlot(serverSlot)) return true;
  const s = parseTs(serverSlot.ts), o = parseTs(ourSlot && ourSlot.ts);
  if (!Number.isFinite(s) || !Number.isFinite(o)) return true;
  return !(s > o);
}

// Per-id union, newer ts wins (only the legacy no-patch full save needs this).
function mergeTickMaps(serverMap, clientMap) {
  const out = {};
  const sm = serverMap && typeof serverMap === "object" ? serverMap : {};
  const cm = clientMap && typeof clientMap === "object" ? clientMap : {};
  Object.keys(sm).forEach(id => { if (isSlot(sm[id])) out[id] = sm[id]; });
  Object.keys(cm).forEach(id => {
    if (!isSlot(cm[id])) return;
    out[id] = slotWins(out[id], cm[id]) ? cm[id] : out[id];
  });
  return out;
}

// Walk one tree: floors upper/main/basement + extras[].key; general, hotcheck, rooms[].items.
function floorKeys(tree) {
  const keys = FLOORS.slice();
  if (tree && Array.isArray(tree.extras)) tree.extras.forEach(e => { if (e && e.key && keys.indexOf(e.key) < 0) keys.push(e.key); });
  return keys;
}
function walkTree(tree, cb) {
  if (!tree || typeof tree !== "object") return;
  floorKeys(tree).forEach(fk => {
    const fl = tree[fk];
    if (!fl || typeof fl !== "object") return;
    (Array.isArray(fl.general) ? fl.general : []).forEach(cb);
    (Array.isArray(fl.hotcheck) ? fl.hotcheck : []).forEach(cb);
    (Array.isArray(fl.rooms) ? fl.rooms : []).forEach(r => (r && Array.isArray(r.items) ? r.items : []).forEach(cb));
  });
}
function indexTree(tree) {
  const m = new Map();
  walkTree(tree, it => { if (it && typeof it === "object" && it.id != null && it.id !== "") m.set(String(it.id), it); });
  return m;
}

function punchTickPatches(prevTree, nextTree, who, nowIso) {
  const out = {};
  const prev = indexTree(prevTree), next = indexTree(nextTree);
  if (!prev.size || !next.size) return out;
  const now = nowIso || new Date().toISOString();
  const name = String(who || "");
  next.forEach((it, id) => {
    const was = prev.get(id);
    if (!was || !!was.done === !!it.done) return;
    if (it.done) {
      // Trust the item's own stamp only when THIS flip wrote it. _flipInFloors and
      // handleSignOffRT can leave an older checkedAtTs on an open item; reusing it
      // would make a re-check's slot lose to its own earlier un-tick slot.
      const fresh = it.checkedAtTs && it.checkedAtTs !== was.checkedAtTs && Number.isFinite(parseTs(it.checkedAtTs));
      const ts = fresh ? it.checkedAtTs : now;
      out[PREFIX + id] = { done: true, by: String(it.checkedBy || name), at: String(it.checkedAt || mdy(ts)), ts: String(ts) };
    } else {
      out[PREFIX + id] = { done: false, by: name, at: mdy(now), ts: String(now) };
    }
  });
  return out;
}

// The slot a tree item (or linked RT entry) should show. Same object back when nothing changes.
function resolve(item, slot) {
  if (!item || typeof item !== "object") return item;
  if (item.done && item.checkedAtTs) {
    const t = parseTs(item.checkedAtTs), s = parseTs(slot.ts);
    if (Number.isFinite(t) && Number.isFinite(s) && t > s) return item;   // newer tree tick beats an older slot
  }
  if (slot.done) {
    const by = String(slot.by || ""), at = String(slot.at || ""), ts = String(slot.ts || "");
    if (item.done === true && item.checkedBy === by && item.checkedAt === at && item.checkedAtTs === ts) return item;
    return { ...item, done: true, checkedBy: by, checkedAt: at, checkedAtTs: ts };
  }
  if (item.done === false && (item.checkedBy || "") === "" && (item.checkedAt || "") === "" && (item.checkedAtTs || "") === "") return item;
  return { ...item, done: false, checkedBy: "", checkedAt: "", checkedAtTs: "" };
}
function mapItems(list, slots, keyOf) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const out = list.map(it => {
    const id = keyOf(it);
    if (id == null) return it;
    const slot = slots[String(id)];
    if (!slot) return it;
    const next = resolve(it, slot);
    if (next !== it) changed = true;
    return next;
  });
  return changed ? out : list;
}
const ownId = (it) => (it && typeof it === "object" && it.id != null && it.id !== "") ? it.id : null;
function applyTree(tree, slots) {
  if (!tree || typeof tree !== "object") return tree;
  let changed = false;
  const out = { ...tree };
  floorKeys(tree).forEach(fk => {
    const fl = tree[fk];
    if (!fl || typeof fl !== "object") return;
    const general = mapItems(fl.general, slots, ownId);
    const hotcheck = mapItems(fl.hotcheck, slots, ownId);
    let rooms = fl.rooms;
    if (Array.isArray(fl.rooms)) {
      let rc = false;
      const nr = fl.rooms.map(r => {
        if (!r || typeof r !== "object") return r;
        const items = mapItems(r.items, slots, ownId);
        if (items === r.items) return r;
        rc = true; return { ...r, items };
      });
      if (rc) rooms = nr;
    }
    if (general !== fl.general || hotcheck !== fl.hotcheck || rooms !== fl.rooms) {
      changed = true;
      out[fk] = { ...fl, general, hotcheck, rooms };
    }
  });
  return changed ? out : tree;
}
// Linked RT entries follow their origin item's slot — but only while the origin
// still exists in a tree. An entry whose origin was deleted is independent again
// (otherwise an orphan slot would pin it forever, since no flip can write a new one).
function applyReturnTrips(trips, slots, present) {
  if (!Array.isArray(trips)) return trips;
  let changed = false;
  const out = trips.map(rt => {
    if (!rt || typeof rt !== "object" || !Array.isArray(rt.punch)) return rt;
    const punch = mapItems(rt.punch, slots, p => (p && typeof p === "object" && p.originItemId != null && p.originItemId !== "" && present.has(String(p.originItemId))) ? p.originItemId : null);
    if (punch === rt.punch) return rt;
    changed = true; return { ...rt, punch };
  });
  return changed ? out : trips;
}

function validSlots(punchTicks) {
  if (!punchTicks || typeof punchTicks !== "object" || Array.isArray(punchTicks)) return null;
  const slots = {};
  let any = false;
  Object.keys(punchTicks).forEach(id => { if (isSlot(punchTicks[id])) { slots[id] = punchTicks[id]; any = true; } });
  return any ? slots : null;
}

function applyPunchTicks(jobData) {
  if (!jobData || typeof jobData !== "object") return jobData;
  const slots = validSlots(jobData.punchTicks);
  if (!slots) return jobData;
  let changed = false;
  const out = { ...jobData };
  TREES.forEach(k => {
    const t = applyTree(jobData[k], slots);
    if (t !== jobData[k]) { changed = true; out[k] = t; }
  });
  const present = new Set();
  TREES.forEach(k => indexTree(jobData[k]).forEach((_, id) => present.add(id)));
  const rts = applyReturnTrips(jobData.returnTrips, slots, present);
  if (rts !== jobData.returnTrips) { changed = true; out.returnTrips = rts; }
  return changed ? out : jobData;
}

// Local state: fold the patch's "punchTicks.<id>" keys into job.punchTicks and
// strip any literal "punchTicks.*" key that ever leaked onto the job object.
function foldTickPatches(job, patch) {
  if (!job || typeof job !== "object") return job;
  const leaked = Object.keys(job).filter(isTickKey);
  const incoming = patch && typeof patch === "object" ? Object.keys(patch).filter(isTickKey) : [];
  if (!leaked.length && !incoming.length) return job;
  const out = { ...job };
  leaked.forEach(k => { delete out[k]; });
  if (incoming.length) {
    const map = { ...(job.punchTicks && typeof job.punchTicks === "object" ? job.punchTicks : {}) };
    incoming.forEach(k => { map[tickIdOf(k)] = patch[k]; });
    out.punchTicks = map;
  }
  return out;
}

module.exports = { isTickKey, tickIdOf, slotWins, mergeTickMaps, punchTickPatches, applyPunchTicks, foldTickPatches, walkTree, TREES };
