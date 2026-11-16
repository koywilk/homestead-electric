#!/usr/bin/env node
// punch-move-test (v642): moving open Rough punch items to the Finish list or a
// return trip. Drives the SHIPPED src/punchMove.js on trees shaped like
// Stratton #959 (rooms on base floors, an extras floor, a waiting item) and
// Brandt #1430 (an open trip), then checks App.js uses it. Exit 1 on failure.
"use strict";
const fs = require("fs");
const path = require("path");
const M = require("../src/punchMove.js");
const PT = require("../src/punchTicks.js");
const PLS = require("../src/punchListStage.js");

let n = 0, bad = 0;
const ok = (c, msg) => { n++; if (!c) { bad++; console.error("  FAIL " + msg); } };
let seq = 0; const newId = () => "n" + (++seq);

const rough = () => ({
  upper: { general: [], hotcheck: [], rooms: [{ id: "r1", name: "Laundry Mech", items: [
    { id: "a", text: "Second Panel", done: false, addedBy: "Colby Fogh", addedAt: "2026-07-01", photos: [{ url: "p1" }] },
    { id: "b", text: "LCP Panel", done: false },
    { id: "c", text: "Done one", done: true, checkedBy: "Colby" }] }] },
  main: { general: [{ id: "g", text: "Make up <b>Panel</b>", done: false, waiting: true, waitingOn: "GC", assignedTo: "Keegan" }], hotcheck: [], rooms: [] },
  basement: { general: [], hotcheck: [], rooms: [{ id: "r2", name: "Mid mech room", items: [{ id: "v", text: "Voided", voided: true }] }] },
  extras: [{ key: "extra_fieldhouse", label: "Fieldhouse basement" }],
  extra_fieldhouse: { general: [{ id: "f1", text: "Outlets", done: false }], hotcheck: [], rooms: [] },
});
const finish = () => ({
  upper: { general: [], hotcheck: [], rooms: [{ id: "fr1", name: "laundry mech ", items: [{ id: "x", text: "Trim", done: false }] }] },
  main: { general: [], hotcheck: [], rooms: [] },
});

// openItems
const oi = M.openItems(rough());
ok(oi.map(o => o.item.id).join(",") === "a,b,g,f1", "open items: done and voided skipped, extras floor included");
ok(oi.find(o => o.item.id === "f1").floorLabel === "Fieldhouse basement" && oi.find(o => o.item.id === "a").roomName === "Laundry Mech", "labels and rooms");

// Move to Finish
seq = 0;
const R0 = rough(), F0 = finish();
const mv = M.planMoveToFinish(R0, F0, ["a", "g", "f1", "c", "v", "nope"], newId, "Koy Wilkinson", "11/16/2026", "2026-11-16T18:00:00.000Z");
ok(mv.moved.length === 3, "only the three open picks move (done, voided, unknown ignored)");
const ra = mv.roughPunch.upper.rooms[0].items[0];
ok(ra.done === true && ra.checkedBy === "Koy Wilkinson" && ra.checkedAt === "11/16/2026" && ra.movedTo.phase === "finish" && ra.movedTo.itemId === mv.moved[0].toId, "rough original: done + movedTo record");
ok(mv.roughPunch.main.general[0].waiting === false && mv.roughPunch.main.general[0].movedTo, "waiting cleared on the moved original");
ok(mv.roughPunch.upper.rooms[0].items[1].done === false && !mv.roughPunch.upper.rooms[0].items[1].movedTo, "an unpicked item is untouched");
ok(R0.upper.rooms[0].items[0].done === false && F0.upper.rooms[0].items.length === 1, "inputs never mutated");
const fRoom = mv.finishPunch.upper.rooms;
ok(fRoom.length === 1 && fRoom[0].id === "fr1" && fRoom[0].items.length === 2, "lands in the existing Finish room matched by name key (case / spaces)");
const fa = fRoom[0].items[1];
ok(fa.id === mv.moved[0].toId && fa.text === "Second Panel" && fa.done === false && fa.addedBy === "Colby Fogh" && fa.photos.length === 1 && fa.movedFrom.itemId === "a" && fa.movedFrom.by === "Koy Wilkinson" && !("checkedBy" in fa), "finish copy: words, photos, who added it, movedFrom, open, no check stamps");
ok(mv.finishPunch.main.general[0].assignedTo === "Keegan" && !("waiting" in mv.finishPunch.main.general[0]), "general → general; assignment kept, waiting not carried");
ok((mv.finishPunch.extras || []).some(e => e.key === "extra_fieldhouse" && e.label === "Fieldhouse basement") && mv.finishPunch.extra_fieldhouse.general[0].text === "Outlets", "extras floor added to Finish with the same key + label");
seq = 0;
const mv2 = M.planMoveToFinish(rough(), { main: { general: [], rooms: [], hotcheck: [] } }, ["b"], newId, "K", "d", "t");
ok(mv2.finishPunch.upper.rooms.length === 1 && mv2.finishPunch.upper.rooms[0].name === "Laundry Mech" && mv2.finishPunch.upper.rooms[0].items[0].text === "LCP Panel", "a missing Finish floor and room are created");
ok(M.planMoveToFinish(rough(), finish(), [], newId).moved.length === 0, "nothing picked → nothing moves");

// Counts: the moved items stop counting as open on Rough everywhere, the copies count on Finish.
ok(PLS.openPunchItems(mv.roughPunch).length === 1 && PLS.openPunchItems(mv.finishPunch).length === 4, "open counts: rough 4 → 1, finish 1 → 4");
// The save funnel writes a check-off slot for each moved original, none for the copies.
const slots = PT.punchTickPatches(R0, mv.roughPunch, "Koy Wilkinson", "2026-11-16T18:00:00.000Z");
const slotIds = Object.keys(slots).map(k => k.split(".").pop()).sort().join(",");
ok(slotIds === "a,f1,g", "punchTickPatches: one done slot per moved original (" + slotIds + ")");
ok(Object.keys(PT.punchTickPatches(F0, mv.finishPunch, "K", "t")).length === 0, "no slots for the Finish copies (adds never get one)");

// Undo
const un = M.undoMoveToFinish(mv.roughPunch, mv.finishPunch, mv.moved);
const ua = un.roughPunch.upper.rooms[0].items[0];
ok(ua.done === false && !ua.movedTo && ua.checkedBy === "" && un.roughPunch.main.general[0].done === false, "undo: originals open again, record cleared");
ok(un.finishPunch.upper.rooms[0].items.map(i => i.id).join(",") === "x" && un.finishPunch.main.general.length === 0 && un.finishPunch.extra_fieldhouse.general.length === 0, "undo: copies taken out by id, Finish's own items kept");
ok(PLS.openPunchItems(un.roughPunch).length === 4, "undo: rough back to 4 open");

// Return trips
const trips = [
  { id: "t1", scope: "Old", signedOff: true, punch: [] },
  { id: "t2", scope: "Service wire pulls", rtStatus: "scheduled", punch: [{ id: "p1", text: "2x pulls", done: false }] },
  { id: "t3", scope: "Done", rtStatus: "complete", punch: [] },
];
ok(M.openTrips(trips).map(x => x.trip.id + "#" + x.no).join(",") === "t2#2", "open trips: signed off and complete left out, numbered as the app does");
seq = 0;
const stamp = { addedAt: "2026-11-16", addedAtTs: "2026-11-16T18:00:00.000Z" };
const lk = M.planLinkToTrip(rough(), trips, ["a", "g", "c"], "t2", newId, "Koy", stamp);
ok(lk.tripNo === 2 && lk.added === 2 && lk.returnTrips[0] === trips[0] && lk.returnTrips[2] === trips[2], "existing trip: two open items added, other trips untouched");
const e1 = lk.returnTrips[1].punch[1];
ok(e1.text === "[Rough · Upper · Laundry Mech] Second Panel" && e1.originItemId === "a" && e1.originPhase === "rough" && e1.done === false && e1.addedAt === "2026-11-16" && e1.movedBy === "Koy", "trip entry: PunchLinker's text and link shape");
ok(lk.returnTrips[1].punch[2].text === "[Rough · Main · General] Make up Panel", "html stripped from the trip text");
const again = M.planLinkToTrip(rough(), lk.returnTrips, ["a"], "t2", newId, "Koy", stamp);
ok(again.added === 0 && again.returnTrips === lk.returnTrips, "an item already on that trip is not added twice");
seq = 0;
const nw = M.planLinkToTrip(rough(), trips, ["f1"], "new", newId, "Koy", stamp);
const nt = nw.returnTrips[3];
ok(nw.tripNo === 4 && nt.scope === "Rough punch leftovers" && nt.needsSchedule === true && nt.rtStatus === "needs" && nt.signedOff === false && nt.punch.length === 1 && nt.punch[0].text === "[Rough · Fieldhouse basement · General] Outlets", "new trip: the leftovers literal, numbered after the others");
ok(M.planLinkToTrip(rough(), trips, ["a"], "t1", newId, "Koy", stamp).added === 0, "a signed-off trip can't take items");
ok(nw.newTripId === nt.id && nw.addedIds.length === 1 && nw.addedIds[0] === nt.punch[0].id, "new trip: ids handed back for Undo");
const unNew = M.undoLinkToTrip(nw.returnTrips, nw.addedIds, nw.newTripId);
ok(unNew.length === 3 && unNew[1] === trips[1], "undo: the trip the move made is removed, others untouched");
const unOld = M.undoLinkToTrip(lk.returnTrips, lk.addedIds, "");
ok(unOld[1].punch.length === 1 && unOld[1].punch[0].id === "p1", "undo: entries come off an existing trip, its own items stay");
const kept = M.undoLinkToTrip(nw.returnTrips.map(t => t.id === nw.newTripId ? { ...t, assignedTo: "Abraham" } : t), nw.addedIds, nw.newTripId);
ok(kept.length === 4 && kept[3].punch.length === 0, "undo: a trip someone has since assigned stays (emptied)");
ok(M.planLinkToTrip(rough(), trips, ["c"], "new", newId, "Koy", stamp).returnTrips === trips, "nothing open picked → no empty trip is made");
const roughAfterTrip = rough();
ok(JSON.stringify(roughAfterTrip) === JSON.stringify(rough()), "linking never changes the Rough tree");

// App.js wiring
const app = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
ok(/import PunchMove from "\.\/punchMove"/.test(app), "App.js imports the module");
ok(/planMoveToFinish\(/.test(app) && /undoMoveToFinish\(/.test(app) && /planLinkToTrip\(/.test(app) && /undoLinkToTrip\(/.test(app), "App.js uses move, link and both undos");
ok(/<PunchMoveSheet\b/.test(app), "the sheet is mounted");
ok(/item\.movedTo/.test(app) && /item\.movedFrom/.test(app), "punch rows draw the moved tags");
ok(/disabled=\{!!item\.movedTo\}/.test(app), "a moved original's checkbox can't be ticked back by mistake");

if (bad) { console.error(`  punch-move-test: ${bad} of ${n} checks FAILED`); process.exit(1); }
console.log(`  ok  punch-move-test: ${n} checks (Stratton- and Brandt-shaped trees)`);
