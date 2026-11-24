#!/usr/bin/env node
// scramble-lock-test.js — the person-day booking lock (functions/scrambleLock.js) and the small v682 label fixes.
"use strict";
const L = require("../functions/scrambleLock.js");
const SC = require("../src/scrambleCal.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

// a tiny in-memory Firestore: collection().doc(k).get/delete, and runTransaction with get/set
function fakeDb() {
  const store = {};
  const ref = (k) => ({ k, get: async function () { return { exists: !!store[k], data: () => store[k], ref: this }; }, delete: async () => { delete store[k]; } });
  return { store, collection: () => ({ doc: ref }), runTransaction: async (fn) => { const w = []; const r = await fn({ get: (x) => x.get(), set: (x, d) => w.push([x.k, d]) }); w.forEach(([k, d]) => { store[k] = d; }); return r; } };
}
(async () => {
  ok(L.uniqueKeys([{ staffId: 2, date: "2026-11-24" }, { staffId: 2, date: "2026-11-24" }, { staffId: 3, date: "2026-11-24" }, { staffId: 0, date: "2026-11-24" }, { staffId: 4, date: "bad" }, null]).join() === "2_2026-11-24,3_2026-11-24", "keys are one per person and day, with junk left out");
  ok(L.pairsOf([{ date: "2026-11-24", staffIds: [5] }, { date: "2026-11-25" }], [1, 2]).map(p => p.staffId + "@" + p.date).join() === "5@2026-11-24,1@2026-11-25,2@2026-11-25", "a day's own people, else everyone picked");
  ok(L.heldBy({ a: { owner: "x", until: 200 } }, ["a"], "me", 100) === "a" && L.heldBy({ a: { owner: "x", until: 50 } }, ["a"], "me", 100) === "" && L.heldBy({ a: { owner: "me", until: 200 } }, ["a"], "me", 100) === "" && L.heldBy({}, ["a"], "me", 100) === "", "someone else's live lock blocks; an expired one or your own doesn't");

  let db = fakeDb();
  const rel = await L.take(db, [{ staffId: 2, date: "2026-11-24" }, { staffId: 3, date: "2026-11-24" }], "Josh");
  ok(Object.keys(db.store).length === 2 && typeof rel === "function", "taking locks writes one per person-day");
  let busy = null; try { await L.take(db, [{ staffId: 3, date: "2026-11-24" }, { staffId: 9, date: "2026-11-24" }], "Duet"); } catch (e) { busy = e; }
  ok(busy && busy.busy && /right now/.test(busy.message) && busy.key === "3_2026-11-24" && !db.store["9_2026-11-24"], "a second booking for the same person and day is refused, and takes none of its locks");
  await rel();
  ok(Object.keys(db.store).length === 0, "release frees them");
  const r2 = await L.take(db, [{ staffId: 3, date: "2026-11-24" }], "Duet");
  ok(!!r2 && !!db.store["3_2026-11-24"], "once released, the next booking can take them");
  db.store["3_2026-11-24"].owner = "someone else"; await r2();
  ok(!!db.store["3_2026-11-24"], "release never frees a lock that is no longer yours");
  ok((await L.take(db, [], "x")) === null, "nothing to lock, nothing taken");
  db = fakeDb(); db.store["7_2026-11-24"] = { owner: "old", until: 1000 };
  ok(!!(await L.take(db, [{ staffId: 7, date: "2026-11-24" }], "x", 5000)), "a lock past its time is taken over");

  // trip times
  const th = SC.tripHours;
  ok(th("1 hr 30 min") === 1.5 && th("1 hour 30 minutes") === 1.5 && th("1h30m") === 1.5 && th("2 hrs 15 min") === 2.25, "an hour and minutes read as both");
  ok(th("1.5 hrs") === 1.5 && th("90 min") === 1.5 && th("3") === 3 && th("half day") === 5 && th("2 days") === 20 && th("30 min") === 0.5 && th("45 minutes") === 0.75 && th("") === 0, "the other ways of writing a trip time still read as before");

  // first names
  const users = [{ id: "a", name: "James Coleman Christen", active: true }, { id: "b", name: "James Livingston", active: true }, { id: "c", name: "Keegan Wilkinson", active: true },
    { id: "d", name: "Justin Cloward", active: true }, { id: "e", name: "Justin Cloward", active: true }, { id: "f", name: "Paul Smith", active: true, access: "contractor" }, { id: "g", name: "Paul Jones", active: true }, { id: "h", name: "Sam Old", active: false }, { id: "i", name: "Sam New", active: true }];
  SC.setDupFirsts([]);
  ok(SC.firstOf("James Livingston") === "James" && SC.firstOf("Keegan Wilkinson") === "Keegan", "with nobody told, names print as before");
  SC.setDupFirsts(users);
  ok(SC.firstOf("James Livingston") === "James L." && SC.firstOf("James Coleman Christen") === "James C.", "two people named James print with a last initial");
  ok(SC.firstOf("Keegan Wilkinson") === "Keegan" && SC.firstOf("Justin Cloward") === "Justin", "a name only one person has is unchanged, and two records of the same person count once");
  ok(SC.firstOf("Paul Jones") === "Paul" && SC.firstOf("Sam New") === "Sam", "a contractor or an inactive person doesn't make a first name repeat");
  ok(SC.firstOf("James") === "James" && SC.firstOf("") === "", "a bare first name has no initial to add");
  const board = SC.crewBoard(users.map(u => ({ ...u, title: "crew" })));
  ok(board.find("James C.") && board.find("James C.").id === "a" && board.find("James L.").id === "b" && board.find("James") === null, "the initial reads back to the right person, and a bare James still refuses to guess");
  SC.setDupFirsts([]);
  if (fails) { console.error(fails + " failed"); process.exit(1); }
  console.log("scramble-lock-test: all passed");
})().catch(e => { console.error("FAIL the lock test threw: " + (e && e.stack || e)); process.exit(1); });
