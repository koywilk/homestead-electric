// Pure-derivation tests for the v578 office half of "Rooms → Command Center
// prefill" (FieldInk v757 sends ccrooms/<ccJobId>; the office offers them per
// punch floor and appends the ticked names to Rough + Finish (+ Legacy QC while
// shown) in ONE patch; a hand-typed "+ Room" fans out to the other phase).
// Runs the CURRENT helper bodies extracted from src/App.js (between the "ccrooms
// OFFICE derivations" markers, plus the real normFloor) so it can never test a
// stale copy. Runs in `prebuild`, so a regression fails the build and the push.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const START = "// ── ccrooms OFFICE derivations";
const END = "// ── end ccrooms OFFICE derivations";
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error("ccrooms-test: markers not found in src/App.js"); process.exit(1); }
const nf = src.match(/\nfunction normFloor\(v\) \{[\s\S]*?\n\}\n/);
if (!nf) { console.error("ccrooms-test: normFloor not found in src/App.js"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(nf[0] + src.slice(a, b) + "\n" + ["CC_ROOM_FLOORS","ccRoomNameKey","ccRoomsDocId","ccRoomOffers","ccRoomsNoFloorCount","ccRoomNamesOnFloor","ccRoomTargetKeys","ccRoomAddCounts","ccRoomOffersPending","ccRoomPendingNames","adoptRooms","ccRoomsAdoptPatch","fanOutAddedRooms","ccRoomsOfficePayload"].map(n => `this.${n} = ${n};`).join(" "), ctx);
const { CC_ROOM_FLOORS, ccRoomNameKey, ccRoomsDocId, ccRoomOffers, ccRoomsNoFloorCount, ccRoomTargetKeys, ccRoomAddCounts, ccRoomOffersPending, ccRoomPendingNames, adoptRooms, ccRoomsAdoptPatch, fanOutAddedRooms, ccRoomsOfficePayload } = ctx;

let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
};
const ok = (name, cond) => { n++; if (!cond) { fails++; console.error(`  FAIL ${name}`); } };
// deterministic ids
const mk = (prefix) => { let i = 0; return () => `${prefix}${++i}`; };

// ── nameKey / doc id ────────────────────────────────────────────────────────
eq("nameKey trims, collapses, lowercases", ccRoomNameKey("  Primary   Bed "), "primary bed");
eq("nameKey of nothing is empty", ccRoomNameKey(null), "");
eq("doc id: a numeric job id is unchanged", ccRoomsDocId(1788319922110), "1788319922110");
eq("doc id: the same rule as FieldInk's ccRoomsDocId", ccRoomsDocId("a b/c.d"), "a_b_c_d");
eq("floors are the three punch keys", CC_ROOM_FLOORS, ["upper", "main", "basement"]);

// ── a realistic ccrooms doc: two plan tokens, one floor-less copy, hidden + removed ──
const rec = (o) => ({ codes: [], auto: false, planShareId: "p1", removedAt: null, fieldUpdatedAt: 1, ...o });
const DOC = { ccJobId: "1788319922110", rooms: {
  "tokA__main__great_room":    rec({ name: "Great Room", nameKey: "great room", floor: "main", sheet: "E1", page: 1, basis: "load", loads: 6 }),
  "tokA__main__kitchen":       rec({ name: "Kitchen", nameKey: "kitchen", floor: "main", sheet: "E1", page: 1, basis: "load", loads: 9 }),
  "tokA__main__dining":        rec({ name: "Dining", nameKey: "dining", floor: "main", sheet: "E1", page: 1, basis: "zone", loads: 0 }),
  "tokA__main__main_powder":   rec({ name: "Main Powder", nameKey: "main powder", floor: "main", sheet: "E1", page: 1, basis: "name", loads: 0 }),
  "tokA__main__entry_way":     rec({ name: "Entry Way", nameKey: "entry way", floor: "main", sheet: null, page: null, basis: "load", loads: 2 }),
  "tokB__main__great_room":    rec({ name: "great  room", nameKey: "great room", floor: "main", sheet: "E1", page: 1, basis: "zone", loads: 0, planShareId: "p2" }),  // same room, other plan token → folds
  "tokA__main__old_name":      rec({ name: "Old Pantry", nameKey: "old pantry", floor: "main", sheet: "E1", page: 1, basis: "load", loads: 1, removedAt: 1700 }),   // FieldInk stopped reporting it
  "tokA__main__mud_room":      rec({ name: "Mud Room", nameKey: "mud room", floor: "main", sheet: "E1", page: 1, basis: "load", loads: 3, office: { dismissed: true, officeUpdatedAt: 1 } }),  // office hid it
  "tokA__x__primary_closet":   rec({ name: "Primary Closet", nameKey: "primary closet", floor: null, sheet: null, page: null, basis: "load", loads: 2 }),   // no floor, no floored twin → footnote
  "tokA__x__kitchen":          rec({ name: "Kitchen", nameKey: "kitchen", floor: null, sheet: null, page: null, basis: "load", loads: 9 }),   // floor-less copy of a floored room → NOT counted
  "tokA__x__mud_room":         rec({ name: "Mud Room", nameKey: "mud room", floor: null, sheet: null, page: null, basis: "load", loads: 3 }),   // its floored twin is hidden but live → NOT counted
  "tokA__x__gone":             rec({ name: "Gone", nameKey: "gone", floor: null, sheet: null, page: null, basis: "load", loads: 1, removedAt: 5 }),   // removed → NOT counted
  "tokA__basement__theater":   rec({ name: "Basement theater", nameKey: "basement theater", floor: "basement", sheet: "E0", page: 0, basis: "load", loads: 4 }),
  "tokA__upper__bunk":         rec({ name: "Upper Bunk Room", nameKey: "upper bunk room", floor: "upper", sheet: "E2", page: 2, basis: "load", loads: 5 }),
  "tokA__main__page3":         rec({ name: "Garage", nameKey: "garage", floor: "main", sheet: "E3", page: 3, basis: "zone", loads: 0 }),
  "weird key with spaces/odd": rec({ name: "Pantry", nameKey: "pantry", floor: "main", sheet: "E1", page: 1, basis: "zone", loads: 0 }),
  "tokA__main__bad":           rec({ name: "   ", nameKey: "", floor: "main", sheet: "E1", page: 1, basis: "load", loads: 1 }),   // blank name → dropped
  "tokA__main__odd_basis":     rec({ name: "Nook", nameKey: "nook", floor: "main", sheet: "E1", page: 1, basis: "mystery", loads: 0 }),  // unknown basis → treated as name-only
  "tokA__main__null":          null,
} };

// ── ccRoomOffers ────────────────────────────────────────────────────────────
const main = ccRoomOffers(DOC, "main");
eq("main floor: live, not hidden, this floor only, folded, page then name, page-less last",
  main.map(o => o.name), ["Dining", "Great Room", "Kitchen", "Main Powder", "Nook", "Pantry", "Garage", "Entry Way"]);
eq("sort is page first (Garage is page 3), then name, page-less last", main.map(o => o.page), [1, 1, 1, 1, 1, 1, 3, null]);
const great = main.find(o => o.nameKey === "great room");
eq("two plan tokens fold into one row with both keys", great.keys.sort(), ["tokA__main__great_room", "tokB__main__great_room"]);
eq("folded row is named by its strongest basis (load beats zone)", [great.name, great.basis, great.loads], ["Great Room", "load", 6]);
eq("load and zone rows start checked", main.filter(o => o.basis !== "name").every(o => o.checked), true);
eq("name-only rows start unchecked", main.find(o => o.nameKey === "main powder").checked, false);
eq("unknown basis is treated as name-only (unchecked)", [main.find(o => o.nameKey === "nook").basis, main.find(o => o.nameKey === "nook").checked], ["name", false]);
eq("removedAt rooms are not offered", main.some(o => o.nameKey === "old pantry"), false);
eq("hidden rooms are not offered", main.some(o => o.nameKey === "mud room"), false);
eq("floor-less rooms are never offered", main.some(o => o.nameKey === "primary closet"), false);
eq("a key is never parsed — odd keys still offer", main.find(o => o.nameKey === "pantry").keys, ["weird key with spaces/odd"]);
eq("other floors have their own slices", [ccRoomOffers(DOC, "basement").map(o => o.name), ccRoomOffers(DOC, "upper").map(o => o.name)], [["Basement theater"], ["Upper Bunk Room"]]);
eq("page 0 is no page", ccRoomOffers(DOC, "basement")[0].page, null);
eq("no doc → no offers", [ccRoomOffers(null, "main"), ccRoomOffers({ rooms: [] }, "main"), ccRoomOffers({}, "main")], [[], [], []]);
eq("record shape", Object.keys(great).sort(), ["basis", "checked", "floor", "hidden", "keys", "loads", "name", "nameKey", "page", "sheet"]);
// hidden rows + loads folding (reviewer 2026-10-29)
const withHidden = ccRoomOffers(DOC, "main", { includeHidden: true });
eq("includeHidden lists the hidden row too, unchecked, flagged, with its keys for Unhide", withHidden.find(o => o.nameKey === "mud room"), { nameKey: "mud room", name: "Mud Room", floor: "main", page: 1, sheet: "E1", basis: "load", loads: 3, hidden: true, keys: ["tokA__main__mud_room"], checked: false });
eq("visible rows are not flagged hidden", withHidden.filter(o => o.hidden).map(o => o.name), ["Mud Room"]);
eq("a row with one hidden and one visible record is still offered (Hide flags every key, so this is a half-written state)", ccRoomOffers({ rooms: { a: rec({ name: "Loft", floor: "main", basis: "load", loads: 2 }), b: rec({ name: "loft", floor: "main", basis: "load", loads: 2, planShareId: "p2", office: { dismissed: true } }) } }, "main").map(o => [o.name, o.hidden, o.keys.length]), [["Loft", false, 2]]);
eq("duplicate records across plan tokens never add their loads up (max, not sum)", ccRoomOffers({ rooms: { a: rec({ name: "Great Room", floor: "main", basis: "load", loads: 6 }), b: rec({ name: "Great Room", floor: "main", basis: "load", loads: 6, planShareId: "p2" }) } }, "main")[0].loads, 6);
eq("a numeric name is a name", ccRoomOffers({ rooms: { a: rec({ name: 101, floor: "main", basis: "load", loads: 1 }) } }, "main").map(o => o.name), ["101"]);
eq("a capitalised floor is not a punch floor (FieldInk coerces; this is defence)", ccRoomOffers({ rooms: { a: rec({ name: "Loft", floor: "Main", basis: "load", loads: 1 }) } }, "main"), []);
eq("nameKey strips zero-width characters and caps at 40 like FieldInk's cleanName", [ccRoomNameKey("Kitchen\u200B"), ccRoomNameKey("A very long room name that goes past forty chars")], ["kitchen", "a very long room name that goes past for"]);

// ── ccRoomsNoFloorCount ─────────────────────────────────────────────────────
eq("footnote counts only floor-less rooms with NO live floored twin (hidden twin still counts as set)", ccRoomsNoFloorCount(DOC), 1);
eq("footnote: two floor-less copies of one name count once", ccRoomsNoFloorCount({ rooms: { a: rec({ name: "Loft", floor: null }), b: rec({ name: "LOFT", floor: null, planShareId: "p2" }) } }), 1);
eq("footnote: a floor FieldInk shouldn't send ('garage') is floor-less", ccRoomsNoFloorCount({ rooms: { a: rec({ name: "Loft", floor: "garage" }) } }), 1);
eq("footnote: empty", ccRoomsNoFloorCount(null), 0);
eq("footnote: a floored twin that FieldInk removed no longer protects the floor-less copy", ccRoomsNoFloorCount({ rooms: { a: rec({ name: "Loft", floor: "main", removedAt: 9 }), b: rec({ name: "Loft", floor: null }) } }), 1);

// ── counts / pending ────────────────────────────────────────────────────────
const room = (id, name, items = []) => ({ id, name, items });
const JOB = {
  roughPunch:  { upper: [], main: { general: [], rooms: [room("r1", "KITCHEN"), room("r2", "Great  Room")], hotcheck: [], photos: [] }, basement: [] },
  finishPunch: { upper: [], main: { general: [{ id: "g1", text: "x" }], rooms: [room("f1", "Kitchen")], hotcheck: [], photos: [] }, basement: [], extras: [{ key: "extra_loft_1", label: "Loft" }], extra_loft_1: { general: [], rooms: [], hotcheck: [], photos: [] } },
  qcPunch:     { upper: [], main: [], basement: [] },
};
const names = ["Great Room", "Kitchen", "Dining"];
eq("target keys without Legacy", ccRoomTargetKeys(false), ["roughPunch", "finishPunch"]);
eq("target keys with Legacy", ccRoomTargetKeys(true), ["roughPunch", "finishPunch", "qcPunch"]);
eq("counts = checked names minus names already on that phase's floor (case/space-insensitive)", ccRoomAddCounts(JOB, "main", names, false), { roughPunch: 1, finishPunch: 2 });
eq("counts include Legacy QC only while it shows", ccRoomAddCounts(JOB, "main", names, true), { roughPunch: 1, finishPunch: 2, qcPunch: 3 });
eq("counts dedupe the names themselves", ccRoomAddCounts(JOB, "main", ["Dining", "dining ", "  DINING"], false), { roughPunch: 1, finishPunch: 1 });
eq("counts on a missing tree", ccRoomAddCounts({}, "basement", names, false), { roughPunch: 3, finishPunch: 3 });
eq("pending when a checked offer is missing from any tree", ccRoomOffersPending(JOB, "main", [{ name: "Great Room", checked: true }], false), true);
eq("not pending when every checked offer is on every tree", ccRoomOffersPending(JOB, "main", [{ name: "Kitchen", checked: true }, { name: "Dining", checked: false }], false), false);
eq("not pending with nothing checked", ccRoomOffersPending(JOB, "main", [{ name: "Dining", checked: false }], false), false);
eq("the badge counts only rooms still missing from a target list (not rooms on both)", ccRoomPendingNames(JOB, "main", [{ name: "Kitchen", checked: true }, { name: "Great Room", checked: true }, { name: "Dining", checked: true }, { name: "Nook", checked: false }], false), ["Great Room", "Dining"]);
eq("pending names: Kitchen is on both lists → not pending; nothing checked → none", [ccRoomPendingNames(JOB, "main", [{ name: "Kitchen", checked: true }], false), ccRoomPendingNames(JOB, "main", [{ name: "Dining", checked: false }], false)], [[], []]);
eq("pending wakes when Legacy shows and lacks the room", ccRoomOffersPending(JOB, "main", [{ name: "Kitchen", checked: true }], true), true);

// ── adoptRooms ──────────────────────────────────────────────────────────────
const before = JOB.finishPunch;
const after = adoptRooms(before, "main", ["Great Room", "Kitchen", "Dining", " dining", "", null, "Nook"], mk("n"));
eq("appends only the new names, in FieldInk order, as EMPTY rooms in addRoom's exact shape",
  after.main.rooms, [room("f1", "Kitchen"), { id: "n1", name: "Great Room", items: [] }, { id: "n2", name: "Dining", items: [] }, { id: "n3", name: "Nook", items: [] }]);
ok("existing room objects are the same objects", after.main.rooms[0] === before.main.rooms[0]);
ok("general / hotcheck / photos of the floor are the same arrays", after.main.general === before.main.general && after.main.hotcheck === before.main.hotcheck && after.main.photos === before.main.photos);
ok("other floors are the same objects", after.upper === before.upper && after.basement === before.basement);
ok("extras pass through untouched", after.extras === before.extras && after.extra_loft_1 === before.extra_loft_1);
ok("the input tree is not mutated", before.main.rooms.length === 1);
ok("nothing to add → the SAME tree object", adoptRooms(before, "main", ["kitchen"], mk("z")) === before);
ok("blank list → the SAME tree object", adoptRooms(before, "main", [], mk("z")) === before);
ok("an extras floor key is never targeted", adoptRooms(before, "extra_loft_1", ["Loft Bed"], mk("z")) === before);
eq("a legacy array floor is normalized the way addRoom does", adoptRooms(JOB.roughPunch, "basement", ["Theater"], mk("b")).basement, { general: [], rooms: [{ id: "b1", name: "Theater", items: [] }], hotcheck: [], photos: [] });
eq("a missing tree starts from emptyPunch's shape", adoptRooms(undefined, "main", ["Kitchen"], mk("e")), { upper: [], main: { general: [], rooms: [{ id: "e1", name: "Kitchen", items: [] }], hotcheck: [], photos: [] }, basement: [] });
eq("names are copied as typed (trim + collapse only), dedupe is case-insensitive", adoptRooms({ main: [] }, "main", ["  Primary   Bed ", "PRIMARY BED"], mk("p")).main.rooms, [{ id: "p1", name: "Primary Bed", items: [] }]);
ok("an ARRAY tree (not a punch tree) is returned unchanged, never replaced by a skeleton", (() => { const arr = [{ id: "g1", text: "x" }]; return adoptRooms(arr, "main", ["Kitchen"], mk("z")) === arr; })());
ok("a string tree is returned unchanged", adoptRooms("junk", "main", ["Kitchen"], mk("z")) === "junk");
eq("a pasted zero-width space or a 41-char office room still dedupes against its FieldInk twin", adoptRooms({ main: { general: [], rooms: [room("r1", "Kitchen\u200B"), room("r2", "A very long room name that goes past forty chars!")], hotcheck: [], photos: [] } }, "main", ["Kitchen", "A very long room name that goes past for"], mk("z")).main.rooms.length, 2);
eq("names land zero-width-free, trimmed and collapsed", adoptRooms({ main: [] }, "main", [" Mud\u200B  Room "], mk("w")).main.rooms[0].name, "Mud Room");
eq("a general-only floor (array) with items keeps them", adoptRooms({ main: [{ id: "i1", text: "fix" }] }, "main", ["Hall"], mk("h")).main, { general: [{ id: "i1", text: "fix" }], rooms: [{ id: "h1", name: "Hall", items: [] }], hotcheck: [], photos: [] });

// ── ccRoomsAdoptPatch ───────────────────────────────────────────────────────
const p1 = ccRoomsAdoptPatch(JOB, "main", names, false, mk("a"));
eq("patch names only the trees that gained rooms", Object.keys(p1), ["roughPunch", "finishPunch"]);
eq("rough gained Dining only", p1.roughPunch.main.rooms.map(r => r.name), ["KITCHEN", "Great  Room", "Dining"]);
eq("finish gained Great Room + Dining", p1.finishPunch.main.rooms.map(r => r.name), ["Kitchen", "Great Room", "Dining"]);
ok("a NEW id per tree (never shared across trees)", p1.roughPunch.main.rooms[2].id !== p1.finishPunch.main.rooms[2].id);
ok("no qcPunch while Legacy is hidden", !("qcPunch" in p1));
const p2 = ccRoomsAdoptPatch(JOB, "main", ["Kitchen"], true, mk("q"));
eq("Legacy QC joins only while it shows, and untouched trees stay out", Object.keys(p2), ["qcPunch"]);
eq("a tap with nothing new writes nothing", ccRoomsAdoptPatch(JOB, "main", ["Kitchen"], false, mk("q")), {});
ok("the job is not mutated", JOB.roughPunch.main.rooms.length === 2 && JOB.finishPunch.main.rooms.length === 1);

// ── fanOutAddedRooms ────────────────────────────────────────────────────────
const PREV = { roughPunch: JOB.roughPunch, finishPunch: JOB.finishPunch, qcPunch: JOB.qcPunch };
const nextRough = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [...JOB.roughPunch.main.rooms, room("r3", "Office")] } };
const f1 = fanOutAddedRooms(PREV, "rough", nextRough, false, mk("o"));
ok("the edited phase is carried verbatim", f1.roughPunch === nextRough);
eq("the other phase gets the new room, EMPTY, same floor", f1.finishPunch.main.rooms, [room("f1", "Kitchen"), { id: "o1", name: "Office", items: [] }]);
ok("qcPunch stays out while Legacy is hidden", !("qcPunch" in f1));
eq("Legacy QC joins only while it shows", Object.keys(fanOutAddedRooms(PREV, "rough", nextRough, true, mk("o"))), ["roughPunch", "finishPunch", "qcPunch"]);
const renamed = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [room("r1", "Kitchen Renamed"), room("r2", "Great  Room")] } };
eq("a rename (same id) does not fan out", fanOutAddedRooms(PREV, "rough", renamed, false, mk("x")), { roughPunch: renamed });
const deleted = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [room("r2", "Great  Room")] } };
eq("a delete does not fan out", fanOutAddedRooms(PREV, "rough", deleted, false, mk("x")), { roughPunch: deleted });
const withItem = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [...JOB.roughPunch.main.rooms, room("r4", "Pantry", [{ id: "it1", text: "add can" }])] } };
eq("a QC-walk room born with its first item fans out EMPTY (items never travel)", fanOutAddedRooms(PREV, "rough", withItem, false, mk("i")).finishPunch.main.rooms[1], { id: "i1", name: "Pantry", items: [] });
const dupName = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [...JOB.roughPunch.main.rooms, room("r5", "kitchen")] } };
eq("a new room whose name the other phase already has (case-insensitive) is not duplicated", fanOutAddedRooms(PREV, "rough", dupName, false, mk("d")), { roughPunch: dupName });
const extraAdd = { ...JOB.finishPunch, extra_loft_1: { ...JOB.finishPunch.extra_loft_1, rooms: [room("l1", "Loft Bed")] } };
eq("a room on an extras floor never fans out", fanOutAddedRooms(PREV, "finish", extraAdd, false, mk("l")), { finishPunch: extraAdd });
const blank = { ...JOB.roughPunch, main: { ...JOB.roughPunch.main, rooms: [...JOB.roughPunch.main.rooms, room("r6", "   ")] } };
eq("a blank-named room never fans out", fanOutAddedRooms(PREV, "rough", blank, false, mk("b")), { roughPunch: blank });
const nextFinish = { ...JOB.finishPunch, basement: { general: [], rooms: [room("f9", "Theater")], hotcheck: [], photos: [] } };
eq("finish → rough works the same way (legacy array floor normalized)", fanOutAddedRooms(PREV, "finish", nextFinish, false, mk("t")).roughPunch.basement, { general: [], rooms: [{ id: "t1", name: "Theater", items: [] }], hotcheck: [], photos: [] });
eq("first room on a job whose trees are normalizeJob's {} creates the other floor", fanOutAddedRooms({ roughPunch: {}, finishPunch: {}, qcPunch: {} }, "rough", { upper: [], main: { general: [], rooms: [room("r1", "Kitchen")], hotcheck: [], photos: [] }, basement: [] }, false, mk("c")).finishPunch,
  { main: { general: [], rooms: [{ id: "c1", name: "Kitchen", items: [] }], hotcheck: [], photos: [] } });
eq("FAILS CLOSED: no previous tree for the edited phase → nothing fans out (every room would look added)", fanOutAddedRooms({ roughPunch: undefined, finishPunch: { main: [] } }, "rough", { upper: [], main: { general: [], rooms: [room("r1", "Kitchen")], hotcheck: [], photos: [] }, basement: [] }, false, mk("c")), { roughPunch: { upper: [], main: { general: [], rooms: [room("r1", "Kitchen")], hotcheck: [], photos: [] }, basement: [] } });
eq("FAILS CLOSED: an array where the previous tree should be → nothing fans out", Object.keys(fanOutAddedRooms({ roughPunch: [], finishPunch: {} }, "rough", nextRough, false, mk("c"))), ["roughPunch"]);
eq("Legacy showing but the name is already there → qcPunch stays out of the patch", Object.keys(fanOutAddedRooms({ ...PREV, qcPunch: { main: { general: [], rooms: [room("q1", "OFFICE")], hotcheck: [], photos: [] } } }, "rough", nextRough, true, mk("c"))), ["roughPunch", "finishPunch"]);
const twoFloors = { ...nextRough, basement: { general: [], rooms: [room("r7", "Theater")], hotcheck: [], photos: [] } };
const f2 = fanOutAddedRooms(PREV, "rough", twoFloors, false, mk("m"));
eq("adds on two floors land in one other-tree object", [f2.finishPunch.main.rooms.map(r => r.name), f2.finishPunch.basement.rooms.map(r => r.name)], [["Kitchen", "Office"], ["Theater"]]);
ok("fan-out never mutates prev", PREV.finishPunch.main.rooms.length === 1 && Array.isArray(PREV.finishPunch.basement) && PREV.finishPunch.basement.length === 0);
eq("no prev trees at all → only the edited phase is written, NOTHING fabricated", Object.keys(fanOutAddedRooms(null, "rough", nextRough, false, mk("x"))), ["roughPunch"]);

// ── ccRoomsOfficePayload ────────────────────────────────────────────────────
eq("Hide payload: ONLY rooms.<key>.office, nothing at the top level", ccRoomsOfficePayload(["k1", "k2"], true, "TS"), { rooms: { k1: { office: { dismissed: true, officeUpdatedAt: "TS" } }, k2: { office: { dismissed: true, officeUpdatedAt: "TS" } } } });
eq("Unhide payload", ccRoomsOfficePayload(["k1"], false, "TS"), { rooms: { k1: { office: { dismissed: false, officeUpdatedAt: "TS" } } } });
eq("nothing valid → null (no write)", [ccRoomsOfficePayload([], true, "TS"), ccRoomsOfficePayload([3, "", null], true, "TS"), ccRoomsOfficePayload(null, true, "TS")], [null, null, null]);
eq("a dotted record key stays one literal map key (the SDK splits only string field paths)", Object.keys(ccRoomsOfficePayload(["tok.a__main__den"], true, "TS").rooms), ["tok.a__main__den"]);
ok("payload never names a field-owned key", !JSON.stringify(ccRoomsOfficePayload(["k"], true, "TS")).includes("removedAt"));

if (fails) { console.error(`ccrooms-test: ${fails} of ${n} checks FAILED`); process.exit(1); }
console.log(`ccrooms-test: ${n} checks passed`);
