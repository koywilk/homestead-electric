// Pure-derivation tests for the v400 office half of FieldInk v619 "panelized ⇄
// regular switching". Runs the CURRENT helper bodies extracted from src/App.js
// (between the "ccloads SUGGEST derivations" markers) so it can never test a
// stale copy. Contract (shared with FieldInk utils/controlKind.js):
//   loads[id].office.{suggestedKind:'switched'|'panel', suggestedAt, suggestedBy}  (office writes)
//   loads[id].suggestionAck {at, resolution:'accepted'|'dismissed'|'matched', by, resolvedAt} (FieldInk writes)
//   pending = suggestedAt > (suggestionAck.at || 0)
// Runs in `prebuild`, so a regression fails the build (and the pre-push hook).
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const START = "// ── ccloads SUGGEST derivations";
const END = "// ── end ccloads SUGGEST derivations";
const a = src.indexOf(START), b = src.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error("ccloads-suggest-test: markers not found in src/App.js"); process.exit(1); }
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + "\nthis.CC_LOAD_SUGGEST_KINDS = CC_LOAD_SUGGEST_KINDS; this.ccLoadCurrentKind = ccLoadCurrentKind; this.ccLoadSuggestPatch = ccLoadSuggestPatch; this.ccLoadSuggestionStatus = ccLoadSuggestionStatus; this.ccLoadWithdrawPatch = ccLoadWithdrawPatch; this.ccLoadsGrouped = ccLoadsGrouped; this.ccLoadImportRows = ccLoadImportRows; this.ccFloorToSection = ccFloorToSection; this.ccLoadSyncPlan = ccLoadSyncPlan; this.ccLoadWantFromField = ccLoadWantFromField; this.CC_LOAD_METHODS = CC_LOAD_METHODS; this.ccLoadMethod = ccLoadMethod; this.ccLoadDest = ccLoadDest; this.ccWallboxImportRows = ccWallboxImportRows; this.ccWallboxOrder = ccWallboxOrder; this.ccKeypadSectionKeys = ccKeypadSectionKeys; this.ccKeypadSectionKey = ccKeypadSectionKey; this.ccKeypadFloor = ccKeypadFloor; this.ccKeypadRowFields = ccKeypadRowFields; this.ccKeypadPrefillPlan = ccKeypadPrefillPlan; this.ccKeypadFillPatch = ccKeypadFillPatch; this.ccKeypadRemovedRows = ccKeypadRemovedRows; this.ccOfficeWritePayload = ccOfficeWritePayload; this.ccKeypadConfirmPatch = ccKeypadConfirmPatch; this.ccKeypadEngravePatch = ccKeypadEngravePatch;", ctx);
const { CC_LOAD_SUGGEST_KINDS, ccLoadCurrentKind, ccLoadSuggestPatch, ccLoadSuggestionStatus, ccLoadWithdrawPatch, ccLoadsGrouped, ccLoadImportRows, ccFloorToSection, ccLoadSyncPlan, ccLoadWantFromField,
  CC_LOAD_METHODS, ccLoadMethod, ccLoadDest, ccWallboxImportRows, ccWallboxOrder, ccKeypadSectionKeys, ccKeypadSectionKey, ccKeypadFloor, ccKeypadRowFields, ccKeypadPrefillPlan, ccKeypadFillPatch, ccKeypadRemovedRows, ccOfficeWritePayload, ccKeypadConfirmPatch, ccKeypadEngravePatch } = ctx;

let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.error(`  FAIL ${name}\n    got  ${g}\n    want ${w}`); }
};

// ── valid kinds ─────────────────────────────────────────────────────────────
eq("only switched|panel are suggestable kinds", CC_LOAD_SUGGEST_KINDS, ["switched", "panel"]);
eq("dimmer is a display value, never a suggestable kind", CC_LOAD_SUGGEST_KINDS.includes("dimmer"), false);

// ── current kind (what the plan has) ────────────────────────────────────────
eq("panel → panel", ccLoadCurrentKind({ control: "panel" }), "panel");
eq("switched → switched", ccLoadCurrentKind({ control: "switched" }), "switched");
eq("dimmer counts as regular switching", ccLoadCurrentKind({ control: "dimmer" }), "switched");
eq("unknown/missing control defaults to switched", ccLoadCurrentKind({}), "switched");
eq("tape has no kind concept", ccLoadCurrentKind({ control: "tape" }), null);
eq("null load is safe", ccLoadCurrentKind(null), "switched");

// ── the office patch (exact write shape) ────────────────────────────────────
const T = 1757900000000;
eq("patch shape is exactly suggestedKind/suggestedAt/suggestedBy",
  ccLoadSuggestPatch({ control: "switched" }, "panel", "Koy", T),
  { suggestedKind: "panel", suggestedAt: T, suggestedBy: "Koy" });
eq("re-suggesting the SAME kind still produces a patch (re-stamps after a dismiss)",
  ccLoadSuggestPatch({ control: "switched", office: { suggestedKind: "panel", suggestedAt: T - 5000 } }, "panel", "Koy", T),
  { suggestedKind: "panel", suggestedAt: T, suggestedBy: "Koy" });
eq("invalid kind (dimmer) → null, no write", ccLoadSuggestPatch({ control: "switched" }, "dimmer", "Koy", T), null);
eq("garbage kind → null", ccLoadSuggestPatch({ control: "switched" }, "PANEL", "Koy", T), null);
eq("tape load → null (control is hidden for tape)", ccLoadSuggestPatch({ control: "tape" }, "panel", "Koy", T), null);
eq("missing name falls back to 'office'", ccLoadSuggestPatch({ control: "panel" }, "switched", "", T).suggestedBy, "office");
eq("name is capped at 60 chars", ccLoadSuggestPatch({ control: "panel" }, "switched", "x".repeat(80), T).suggestedBy.length, 60);
eq("patch never carries kind-changing keys (office never edits control)",
  Object.keys(ccLoadSuggestPatch({ control: "panel" }, "switched", "Koy", T)).sort(), ["suggestedAt", "suggestedBy", "suggestedKind"]);
const tNow = ccLoadSuggestPatch({ control: "panel" }, "switched", "Koy").suggestedAt;
eq("default `now` is a recent epoch-ms number", typeof tNow === "number" && Math.abs(Date.now() - tNow) < 5000, true);

// ── status derivation ───────────────────────────────────────────────────────
const base = (office, suggestionAck) => ({ control: "switched", office, suggestionAck });
eq("no suggestion → null", ccLoadSuggestionStatus(base(undefined, undefined)), null);
eq("office sub-object without a suggestion (v394 dismissed flag only) → null", ccLoadSuggestionStatus(base({ dismissed: true }, undefined)), null);
eq("suggestedKind without suggestedAt → null (half-written)", ccLoadSuggestionStatus(base({ suggestedKind: "panel" }, undefined)), null);
eq("invalid suggestedKind → null", ccLoadSuggestionStatus(base({ suggestedKind: "dimmer", suggestedAt: T }, undefined)), null);

eq("suggested, no ack → pending",
  ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T, suggestedBy: "Koy" }, undefined)),
  { kind: "panel", at: T, by: "Koy", state: "pending" });
eq("ack for an OLDER suggestion → still pending (newer suggestedAt reopens after a dismiss)",
  ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T + 1 }, { at: T, resolution: "dismissed", by: "Jeromy", resolvedAt: T + 10 })).state,
  "pending");
eq("ack.at == suggestedAt, accepted → accepted with who/when",
  ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T, suggestedBy: "Koy" }, { at: T, resolution: "accepted", by: "Jeromy", resolvedAt: T + 60000 })),
  { kind: "panel", at: T, by: "Koy", state: "accepted", resolvedBy: "Jeromy", resolvedAt: T + 60000 });
eq("dismissed", ccLoadSuggestionStatus(base({ suggestedKind: "switched", suggestedAt: T }, { at: T, resolution: "dismissed", by: "Jeromy", resolvedAt: T + 1 })).state, "dismissed");
eq("matched (auto, plan already agreed)", ccLoadSuggestionStatus(base({ suggestedKind: "switched", suggestedAt: T }, { at: T, resolution: "matched", by: "auto", resolvedAt: T + 1 })).state, "matched");
eq("ack NEWER than the suggestion (clock skew) still counts as acked", ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T }, { at: T + 5, resolution: "accepted", by: "J", resolvedAt: T + 5 })).state, "accepted");
eq("unknown resolution from a newer FieldInk is 'resolved', never re-shown as pending",
  ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T }, { at: T, resolution: "superseded", by: "J", resolvedAt: T })).state, "resolved");
eq("string timestamps from a hand-edited doc coerce", ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: String(T) }, { at: String(T - 1), resolution: "dismissed" })).state, "pending");
eq("garbage suggestionAck (non-object) is ignored → pending", ccLoadSuggestionStatus(base({ suggestedKind: "panel", suggestedAt: T }, "yes")).state, "pending");
eq("tape load with a stray suggestion still derives (display only; the control is hidden)",
  ccLoadSuggestionStatus({ control: "tape", office: { suggestedKind: "panel", suggestedAt: T } }).state, "pending");

// ── UNDO: withdraw patch ────────────────────────────────────────────────────
const DEL = { __deleteField: true };
eq("withdraw deletes exactly the three suggested keys", ccLoadWithdrawPatch(() => DEL), { suggestedKind: DEL, suggestedAt: DEL, suggestedBy: DEL });
eq("after a withdraw the record derives to no suggestion (suggestedAt gone)",
  ccLoadSuggestionStatus({ control: "switched", office: { dismissed: false }, suggestionAck: { at: T, resolution: "dismissed" } }), null);

// ── walk-order grouping: sheet → room code → load name; gone rows sink ─────
const G = ccLoadsGrouped([
  { id: "z", name: "Cans", sheet: "Pg 2", roomCode: "002", room: "Kitchen", control: "panel" },
  { id: "a", name: "Cans", sheet: "Pg 1", roomCode: "058", room: "MECH", control: "panel" },
  { id: "b", name: "Sconce", sheet: "Pg 10", roomCode: "001", room: "Lounge", control: "switched" },
  { id: "c", name: "Alpha", sheet: "Pg 2", roomCode: "002", room: "Kitchen", control: "switched", removedAt: 5 },
  { id: "d", name: "Beta", sheet: "Pg 2", roomCode: "002", room: "Kitchen", control: "switched" },
  { id: "e", name: "Pucks", sheet: "Pg 2", roomCode: "001", room: "4 CAR GARAGE", control: "panel", floor: "main" },
  { id: "f", name: "Lonely", sheet: "", roomCode: "", room: "", control: "panel" },
  { id: "g", name: "Same", sheet: "Pg 1", roomCode: "056", room: "056", control: "panel" },
]);
eq("sheets sort naturally (Pg 1, Pg 2, Pg 10) with the blank sheet last", G.map(x => x.label), ["No sheet", "Pg 1", "Pg 2", "Pg 10"]);
eq("sheet counts", G.map(x => x.count), [1, 2, 4, 1]);
eq("rooms within a sheet sort by room code", G[2].rooms.map(r => r.code), ["001", "002"]);
eq("room name shown once when it equals the code", G[1].rooms.map(r => [r.code, r.name]), [["056", ""], ["058", "MECH"]]);
eq("loads within a room: by name, gone-from-plan last", G[2].rooms[1].loads.map(l => l.id), ["d", "z", "c"]);
eq("floor surfaces on the sheet when any load carries one", G[2].floor, "main");
eq("blank room/code lands in a 'No room' bucket", G[0].rooms[0].name, "No room");
eq("ordering is deterministic regardless of input order",
  JSON.stringify(ccLoadsGrouped([{ id: "2", name: "B", sheet: "Pg 1", roomCode: "001", room: "R" }, { id: "1", name: "A", sheet: "Pg 1", roomCode: "001", room: "R" }]).map(x => x.rooms[0].loads.map(l => l.id))),
  JSON.stringify(ccLoadsGrouped([{ id: "1", name: "A", sheet: "Pg 1", roomCode: "001", room: "R" }, { id: "2", name: "B", sheet: "Pg 1", roomCode: "001", room: "R" }]).map(x => x.rooms[0].loads.map(l => l.id))));
eq("empty/null input is safe", ccLoadsGrouped(null), []);

// ── IMPORT into pl.loads (v403): idempotent, room-prefixed, append-only ────
let mkN = 0; const mk = () => ({ id: "row" + (++mkN), name: "", location: "", loadType: "", watts: "", pulled: false });
const IM = ccLoadImportRows([
  { id: "c1", name: "Cans", room: "Kitchen", control: "panel", floor: "main" },
  { id: "c2", name: "Kitchen Island Pendants", room: "Kitchen", control: "dimmer" },
  { id: "c3", name: "Cans", room: "Primary Bath", control: "switched", floor: "upper" },
  { id: "c4", name: "UCL", room: "Butler", control: "tape" },
  { id: "gone", name: "Old", room: "Hall", control: "panel", removedAt: 5 },
  { id: "dup", name: "Sconce", room: "Entry", control: "panel" },
  { id: "noroom", name: "Lonely", room: "", control: "panel", floor: "attic" },
], [{ id: "x", name: "Entry Sconce", fieldLoadId: "dup" }], mk);
eq("v435/v554: no `method` (older FieldInk) → today's rule: only control panel imports; switched / dimmer / tape wait", IM.rows.map(r => r.name), ["Kitchen Cans", "Lonely"]);
eq("skipped = 3 non-panel + already-imported + gone-from-plan", IM.skipped, 5);
eq("panel loads keep a blank Loads-list type", IM.rows.map(r => r.loadType), ["", ""]);
eq("FieldInk floor maps to the Loads list floor section; an unknown floor keeps its own name", IM.rows.map(r => r.location), ["Main Level", "attic"]);
eq("every row is a real newCentralLoad shape + room/fieldLoadId/origin", Object.keys(IM.rows[0]).sort(), ["fieldLoadId", "fieldSnap", "id", "loadType", "location", "name", "origin", "pulled", "room", "watts"]);
eq("fieldLoadId is the ccloads id (the idempotency key)", IM.rows.map(r => r.fieldLoadId), ["c1", "noroom"]);
eq("a load with no control never imports", ccLoadImportRows([{ id: "z", name: "Mystery", room: "R" }], [], mk).rows.length, 0);
eq("an extra floor maps by its label; the three standard floors are LoadsList's literal section labels", ccLoadImportRows([{ id: "f", name: "N", room: "R", control: "panel", floor: "Loft" }, { id: "g", name: "M", room: "R", control: "panel", floor: "main" }], [], mk, { loft: "Loft" }).rows.map(r => r.location), ["Loft", "Main Level"]);
// ── v436 floors: FieldInk sends the sheet's floor as typed ─────────────────
const FO = ["Main Level", "Basement", "Upper Level", "Loft"];
eq("'Main Level' as typed lands in Main Level (used to import blank)", ccFloorToSection("Main Level", FO), "Main Level");
eq("synonyms → Main Level", ["main", "Main Floor", "1st Floor", "first floor", "Level 1", "ground floor"].map(x => ccFloorToSection(x, FO)), Array(6).fill("Main Level"));
eq("synonyms → Basement", ["basement", "Lower Level", "lower", "BSMT"].map(x => ccFloorToSection(x, FO)), Array(4).fill("Basement"));
eq("synonyms → Upper Level", ["upper", "2nd Floor", "Second Floor", "Level 2", "upstairs"].map(x => ccFloorToSection(x, FO)), Array(5).fill("Upper Level"));
eq("an extra floor matches by label, case-insensitive", ccFloorToSection("  loft ", FO), "Loft");
eq("an unknown floor keeps FieldInk's text (its own section, not Unassigned)", ccFloorToSection("Garage Apartment", FO), "Garage Apartment");
eq("blank / null → '' (unknown)", [ccFloorToSection("", FO), ccFloorToSection(null, FO)], ["", ""]);
eq("office.floor on the bridge wins over the sheet floor", ccLoadImportRows([{ id: "o1", name: "Cans", room: "Den", control: "panel", floor: "Main Level", office: { floor: "Basement" } }], [], mk, FO).rows[0].location, "Basement");
eq("room is carried onto the row", ccLoadImportRows([{ id: "o2", name: "Cans", room: "Den", control: "panel", floor: "2nd Floor" }], [], mk, FO).rows.map(r => [r.room, r.location]), [["Den", "Upper Level"]]);
eq("second import of the same loads is a no-op", ccLoadImportRows([{ id: "c1", name: "Cans", room: "Kitchen", control: "panel" }], IM.rows, mk).rows.length, 0);
eq("empty input is safe", ccLoadImportRows(null, null, mk), { rows: [], skipped: 0 });

// ── the WRITE itself: run the real publishCcLoadOffice body with a captured setDoc ──
// Proves the on-the-wire payload is exactly loads.<id>.office.{suggestedKind,
// suggestedAt,suggestedBy,officeUpdatedAt} + doc-level updatedAt/updatedBy, merge:true,
// on ccloads/<jobId> — nothing else in the doc is named, so the deep merge can't touch
// field-owned keys, FieldInk's suggestionAck, or any other load.
const PSTART = "async function publishCcLoadOffice(jobId, loadId, officePatch) {";
const pa = src.indexOf(PSTART);
const pb = src.indexOf("\n}\n", pa);
if (pa === -1 || pb === -1) { console.error("ccloads-suggest-test: publishCcLoadOffice not found"); process.exit(1); }
const SENTINEL = { __serverTimestamp: true };
const calls = [];
const wctx = {
  ensureFieldinkAuth: async () => ({ uid: "office-test" }),
  fieldinkDb: { __db: "field-ink" },
  doc: (db, col, id) => ({ db, col, id }),
  serverTimestamp: () => SENTINEL,
  setDoc: async (ref, data, opts) => { calls.push({ ref, data, opts }); },
  _ccDenied: () => {}, console,
  ccOfficeWritePayload: ctx.ccOfficeWritePayload,
};
vm.createContext(wctx);
const MSTART = "async function publishCcLoadOfficeMany(jobId, patchesById) {";
const ma = src.indexOf(MSTART);
const mb = src.indexOf("\n}\n", ma);
if (ma === -1 || mb === -1) { console.error("ccloads-suggest-test: publishCcLoadOfficeMany not found"); process.exit(1); }
const KSTART = "async function publishCcKeypadOfficeMany(jobId, patchesById) {";
const ka = src.indexOf(KSTART);
const kb = src.indexOf("\n}\n", ka);
if (ka === -1 || kb === -1) { console.error("ccloads-suggest-test: publishCcKeypadOfficeMany not found"); process.exit(1); }
vm.runInContext(src.slice(pa, pb + 2) + "\n" + src.slice(ma, mb + 2) + "\n" + src.slice(ka, kb + 2) + "\nthis.publishCcLoadOffice = publishCcLoadOffice; this.publishCcLoadOfficeMany = publishCcLoadOfficeMany; this.publishCcKeypadOfficeMany = publishCcKeypadOfficeMany;", wctx);

// ── v450 imported rows follow FieldInk (ccLoadSyncPlan) ─────────────────────
{
  const FO2 = ["Main Level", "Basement", "Upper Level"];
  const mk2 = () => ({ id: "row" + Math.random().toString(36).slice(2, 6), name: "", location: "", loadType: "", watts: "", pulled: false });
  const imp = ccLoadImportRows([{ id: "f1", name: "Cans", room: "Den", control: "panel", floor: "Main Level" }], [], mk2, FO2).rows[0];
  eq("import stamps fieldSnap with what it took", imp.fieldSnap, { name: "Den Cans", room: "Den", location: "Main Level" });
  // untouched row, FieldInk re-rooms it → auto
  const row = { ...imp, id: "r1" };
  const after = { f1: { id: "f1", name: "Cans", room: "Study", control: "panel", floor: "Main Level" } };
  let plan = ccLoadSyncPlan([row], after, FO2);
  eq("re-room on an untouched row → auto patch (name + room), snap refreshed", plan.auto, [{ id: "r1", fieldLoadId: "f1", patch: { name: "Study Cans", room: "Study", fieldSnap: { name: "Study Cans", room: "Study", location: "Main Level" } } }]);
  eq("…and nothing manual", plan.manual, []);
  // office renamed the row since import → name is manual, room still auto
  const edited = { ...row, name: "Den Can Lights" };
  plan = ccLoadSyncPlan([edited], after, FO2);
  eq("office-edited name → manual; untouched room → auto", [plan.auto[0].patch.room, plan.auto[0].patch.name, plan.manual[0].changes], ["Study", undefined, [{ key: "name", from: "Den Can Lights", to: "Study Cans" }]]);
  eq("manual patch carries the new value + snap", plan.manual[0].patch, { fieldSnap: { name: "Study Cans", room: "Study", location: "Main Level" }, name: "Study Cans" });
  // v496: office-edited, and FieldInk has NOT moved since what the office last took → nothing offered
  const stillDen = { f1: { id: "f1", name: "Cans", room: "Den", control: "panel", floor: "Main Level" } };
  eq("v496: office-edited row + field unchanged since the snap → not offered, never auto", ccLoadSyncPlan([edited], stillDen, FO2), { auto: [], manual: [] });
  // Miller 2026-10-01: the office fixed the name by hand and stamped the bridge's (wrong) value as the snap
  const fixed = { id: "r3", name: "Main Stairway Cans", room: "Main Stairway", location: "Main Level", origin: "fieldink", fieldLoadId: "f3", fieldSnap: { name: "Stairway Cans", room: "Stairway", location: "Main Level" } };
  const bridgeWrong = { f3: { id: "f3", name: "Cans", room: "Stairway", control: "panel", floor: "Main Level" } };
  eq("v496 Miller: bridge still wrong, office fixed → not offered", ccLoadSyncPlan([fixed], bridgeWrong, FO2), { auto: [], manual: [] });
  eq("v496 Miller: bridge fixed to match the office → nothing to do", ccLoadSyncPlan([fixed], { f3: { ...bridgeWrong.f3, room: "Main Stairway" } }, FO2), { auto: [], manual: [] });
  eq("v496 Miller: bridge moves to a THIRD value → offered (manual), never auto", ccLoadSyncPlan([fixed], { f3: { ...bridgeWrong.f3, room: "Foyer" } }, FO2).manual.map(m => m.changes.map(c => c.key)), [["name", "room"]]);
  // legacy row (no fieldSnap) that differs → manual only
  const legacy = { id: "r2", name: "Den Cans", room: "Den", location: "Main Level", origin: "fieldink", fieldLoadId: "f1" };
  plan = ccLoadSyncPlan([legacy], after, FO2);
  eq("pre-v450 row with no snap can't be told apart from an office edit → manual", [plan.auto.length, plan.manual.length, plan.manual[0].changes.map(c => c.key)], [0, 1, ["name", "room"]]);
  // in sync → nothing
  eq("row already matching FieldInk → no work", ccLoadSyncPlan([row], { f1: { id: "f1", name: "Cans", room: "Den", control: "panel", floor: "Main Level" } }, FO2), { auto: [], manual: [] });
  // FieldInk floor blank never blanks a typed floor; office.floor on the bridge wins
  eq("blank field floor keeps the row's floor", ccLoadSyncPlan([row], { f1: { id: "f1", name: "Cans", room: "Den", control: "panel" } }, FO2), { auto: [], manual: [] });
  eq("office.floor on the bridge moves the row's floor", ccLoadSyncPlan([row], { f1: { id: "f1", name: "Cans", room: "Den", control: "panel", floor: "Main Level", office: { floor: "Basement" } } }, FO2).auto[0].patch.location, "Basement");
  // skips: hand-typed rows, removed / non-panel field loads, missing field load
  eq("hand-typed rows are never touched", ccLoadSyncPlan([{ id: "h", name: "X", room: "Y" }], after, FO2), { auto: [], manual: [] });
  eq("gone-from-plan / switched field loads are skipped", ccLoadSyncPlan([row, row], { f1: { id: "f1", name: "Cans", room: "Study", control: "switched" } }, FO2), { auto: [], manual: [] });
  eq("no field load → skipped", ccLoadSyncPlan([row], {}, FO2), { auto: [], manual: [] });
  eq("null-safe", ccLoadSyncPlan(null, null, null), { auto: [], manual: [] });
  eq("want = the import rule", ccLoadWantFromField({ name: "Kitchen Cans", room: "Kitchen", floor: "2nd floor" }, FO2), { name: "Kitchen Cans", room: "Kitchen", location: "Upper Level" });
}

// ── v554 BRIDGE v2 (FieldInk v686): method → list, method → control fallback ──
{
  eq("methods are exactly switch | wallbox | panel | tape", CC_LOAD_METHODS, ["switch", "wallbox", "panel", "tape"]);
  eq("method wins when present", ["switch", "wallbox", "panel", "tape"].map(m => ccLoadMethod({ method: m, control: "switched" })), ["switch", "wallbox", "panel", "tape"]);
  eq("absent method → fall back to control: panel → panel", ccLoadMethod({ control: "panel" }), "panel");
  eq("absent method → switched / dimmer / tape stay unplaced (today's rule)", ["switched", "dimmer", "tape", undefined].map(c => ccLoadMethod({ control: c })), [null, null, null, null]);
  eq("reserved / unknown method (module, system, junk) → the control fallback", [ccLoadMethod({ method: "module", control: "panel" }), ccLoadMethod({ method: "system", control: "dimmer" }), ccLoadMethod({ method: "PANEL", control: "switched" })], ["panel", null, null]);
  eq("null load is safe", [ccLoadMethod(null), ccLoadDest(null)], [null, null]);
  eq("dest: panel + tape → Loads list; wallbox + switch → Wallbox devices", ["panel", "tape", "wallbox", "switch"].map(m => ccLoadDest({ method: m })), ["loads", "loads", "wallbox", "wallbox"]);
  eq("a hard-wired dimmer is method 'switch' → Wallbox devices (control carries the dimming)", ccLoadDest({ method: "switch", control: "dimmer" }), "wallbox");

  const FO3 = ["Main Level", "Basement", "Upper Level"];
  let k = 0; const mkR = () => ({ id: "r" + (++k), name: "", location: "", loadType: "", watts: "", pulled: false });
  const BR = [
    { id: "p1", name: "Cans", room: "Kitchen", control: "panel", method: "panel", floor: "main" },
    { id: "t1", name: "UCL", room: "Butler", control: "tape", method: "tape", floor: "main", tapeFt: 18.5 },
    { id: "t2", name: "Cove", room: "Den", control: "tape", method: "tape", tapeFt: null },
    { id: "w1", name: "Sconces", room: "Entry", control: "dimmer", method: "wallbox", floor: "upper" },
    { id: "w2", name: "Fan", room: "Entry", control: "switched", method: "wallbox", floor: "upper" },
    { id: "s1", name: "Closet", room: "Primary", control: "dimmer", method: "switch", floor: "Upper Level" },
    { id: "s2", name: "Garage", room: "Garage", control: "switched", method: "switch" },
    { id: "old", name: "Hall", room: "Hall", control: "switched" },           // older iPad: no method
    { id: "gone", name: "X", room: "Y", control: "panel", method: "panel", removedAt: 9 },
  ];
  const L = ccLoadImportRows(BR, [], mkR, FO3);
  eq("Loads list takes panel + tape only", L.rows.map(r => r.fieldLoadId), ["p1", "t1", "t2"]);
  eq("tape imports as an LED load", L.rows.map(r => r.loadType), ["", "LED", "LED"]);
  eq("tape carries tapeFt (a real number, else null); panel rows carry none", L.rows.map(r => r.tapeFt), [undefined, 18.5, null]);
  eq("RA3 wallbox loads never land on the Loads list", ccLoadImportRows([BR[3], BR[4]], [], mkR, FO3).rows.length, 0);
  let wid = 0; const mkId = () => "wb" + (++wid);
  const W = ccWallboxImportRows(BR, [], mkId, FO3);
  eq("Wallbox devices take wallbox + switch, never panel / tape / no-method / removed", W.rows.map(r => r.fieldLoadId), ["w1", "w2", "s1", "s2"]);
  eq("device from control: dimmer → Dimmer, else Switch", W.rows.map(r => r.device), ["Dimmer", "Switch", "Dimmer", "Switch"]);
  eq("method rides on the row (RA3 vs Standard)", W.rows.map(r => r.method), ["wallbox", "wallbox", "switch", "switch"]);
  eq("a wallbox row is exactly these keys", Object.keys(W.rows[0]).sort(), ["device", "fieldLoadId", "fieldSnap", "id", "location", "method", "name", "origin", "room"]);
  eq("names carry the room; floors map like the Loads list", W.rows.map(r => [r.name, r.location]), [["Entry Sconces", "Upper Level"], ["Entry Fan", "Upper Level"], ["Primary Closet", "Upper Level"], ["Garage", ""]]);
  eq("wallbox import is idempotent on fieldLoadId", ccWallboxImportRows(BR, W.rows, mkId, FO3).rows.length, 0);
  eq("the order counts dimmers / switches per method", ccWallboxOrder(W.rows), { wallbox: { Dimmer: 1, Switch: 1 }, switch: { Dimmer: 1, Switch: 1 } });
  eq("order ignores unnamed rows; null-safe", [ccWallboxOrder([{ name: " ", method: "wallbox", device: "Dimmer" }]).wallbox.Dimmer, ccWallboxOrder(null).switch.Switch], [0, 0]);

  // sync stays name / room / location only — method and control never raise a change
  const imported = L.rows[0];
  eq("method appearing on a load that had none → NO change offered", ccLoadSyncPlan([imported], { p1: { ...BR[0], method: undefined } }, FO3), { auto: [], manual: [] });
  eq("control flip panel→dimmer with method still panel → no change offered", ccLoadSyncPlan([imported], { p1: { ...BR[0], control: "dimmer" } }, FO3), { auto: [], manual: [] });
  eq("tape rows follow renames like panel rows", ccLoadSyncPlan([L.rows[1]], { t1: { ...BR[1], room: "Pantry" } }, FO3).auto.map(a => a.patch.room), ["Pantry"]);
  eq("a Loads-list row whose load became wallbox stops following (it no longer belongs there)", ccLoadSyncPlan([imported], { p1: { ...BR[0], method: "wallbox", room: "Study" } }, FO3), { auto: [], manual: [] });
  eq("wallbox rows follow renames via dest 'wallbox'", ccLoadSyncPlan(W.rows, { w1: { ...BR[3], room: "Foyer" } }, FO3, "wallbox").auto.map(a => [a.id, a.patch.name]), [["wb1", "Foyer Sconces"]]);
  eq("…and the Loads-list sync never touches them", ccLoadSyncPlan(W.rows, { w1: { ...BR[3], room: "Foyer" } }, FO3), { auto: [], manual: [] });
}

// ── v554 KEYPADS: prefill, removedAt, the confirmed lock ─────────────────────
{
  const FO4 = ["Main Level", "Basement", "Upper Level", "Loft"];
  const LOADS = { p1: { name: "Cans", room: "Kitchen" }, w1: { name: "Sconces", room: "Entry" } };
  const KP = {
    k1: { label: "KP", kpType: "ra3", sheet: "E1", floor: "main", room: "Kitchen", assigned: [{ key: "p1", loadId: "068-1" }, { key: "ghost", loadId: "070-2" }] },
    k2: { label: "Entry Keypad", kpType: "panel", sheet: "E2", floor: "upper", room: "Entry", assigned: [{ key: "w1", loadId: "101-1" }] },
    k3: { label: "Mud", kpType: "ra3", sheet: "Pg 3", floor: null, room: "", assigned: [] },
    k4: { label: "Old", kpType: "ra3", sheet: "E1", floor: "main", room: "Den", assigned: [], removedAt: 5 },
    k5: { label: "Loft KP", kpType: "weird", sheet: "E9", floor: "Loft", room: "Loft", assigned: [] },
  };
  const pl = { extraFloors: [{ key: "ef1", label: "Loft" }], mainKeypad: [{ id: "m1", num: 1, name: "", status: "" }, { id: "m2", num: 2, name: "Typed by hand", status: "Pulled" }, { id: "m3", num: 3, name: "", status: "" }], upperKeypad: [], confirmedKeypads: {} };
  eq("section keys = 3 std + extra floors", ccKeypadSectionKeys(pl), ["mainKeypad", "basementKeypad", "upperKeypad", "ef1_keypad"]);
  eq("section label → key", ["Main Level", "Basement", "Upper Level", "loft", "Attic"].map(x => ccKeypadSectionKey(x, pl.extraFloors)), ["mainKeypad", "basementKeypad", "upperKeypad", "ef1_keypad", null]);
  eq("keypad floor: office.floor > field floor > the office's sheet floor", [ccKeypadFloor({ floor: "main", office: { floor: "Basement" } }), ccKeypadFloor({ floor: "main" }), ccKeypadFloor({ sheet: "Pg 3" }, { "Pg 3": "Basement" }), ccKeypadFloor({})], ["Basement", "main", "Basement", ""]);
  const f1 = ccKeypadRowFields("k1", KP.k1, LOADS);
  eq("row name carries the room; label kept", f1.name, "Kitchen KP");
  eq("assigned loads JOIN to loads by key (composed name); a key missing from loads keeps its loadId and is marked", f1.assigned, [{ key: "p1", loadId: "068-1", name: "Kitchen Cans" }, { key: "ghost", loadId: "070-2", name: "070-2", missing: true }]);
  eq("row fields = label/room/sheet/kpType/assigned + origin + fieldKeypadId", Object.keys(f1).sort(), ["assigned", "fieldKeypadId", "kpType", "name", "origin", "room", "sheet"]);
  eq("unknown kpType → blank", ccKeypadRowFields("k5", KP.k5, LOADS).kpType, "");
  eq("a real typed label stands as typed; only a generic one (KP / Keypad 2) borrows the room", ["Primary Bed KP", "Mud KP", "Keypad 2", "kp", ""].map(l => ccKeypadRowFields("x", { label: l, room: "Primary Closet" }, {}).name), ["Primary Bed KP", "Mud KP", "Primary Closet Keypad 2", "Primary Closet kp", "Primary Closet KP"]);
  eq("assigned is capped at 40", ccKeypadRowFields("x", { label: "Big", assigned: Array.from({ length: 50 }, (_, i) => ({ key: "k" + i, loadId: "L" + i })) }, {}).assigned.length, 40);
  eq("null keypad is safe", ccKeypadRowFields("z", null, null).name, "KP");

  let plan = ccKeypadPrefillPlan(KP, LOADS, pl, FO4, {});
  eq("plan buckets: k1→main, k2→upper, k5→loft; k3 has no floor; k4 removed", [Object.keys(plan.bySection).sort(), plan.noFloor, plan.removed, plan.add], [["ef1_keypad", "mainKeypad", "upperKeypad"], ["k3"], ["k4"], 3]);
  eq("…a sheet floor the office set on that sheet's loads places k3", ccKeypadPrefillPlan(KP, LOADS, pl, FO4, { "Pg 3": "Basement" }).bySection.basementKeypad.map(r => r.fieldKeypadId), ["k3"]);
  const mkKP = (num) => ({ id: "new" + num, num, name: "", status: "" });
  const patch = ccKeypadFillPatch(pl, plan, mkKP);
  eq("fill touches only the sections it adds to", Object.keys(patch).sort(), ["ef1_keypad", "mainKeypad", "upperKeypad"]);
  eq("blank seeded rows fill first; a hand-typed row is never moved or changed", patch.mainKeypad.map(r => [r.id, r.num, r.name, r.status]), [["m1", 1, "Kitchen KP", ""], ["m2", 2, "Typed by hand", "Pulled"], ["m3", 3, "", ""]]);
  eq("an empty section appends a fresh row", patch.upperKeypad.map(r => [r.id, r.num, r.fieldKeypadId]), [["new1", 1, "k2"]]);
  eq("review L5: a nameless row that already has a status (Need Specs) is not taken over", ccKeypadFillPatch({ mainKeypad: [{ id: "s1", num: 1, name: "", status: "Need Specs" }] }, { bySection: { mainKeypad: [{ name: "Kitchen KP", fieldKeypadId: "k1" }] } }, mkKP).mainKeypad.map(r => [r.id, r.name, r.status]), [["s1", "", "Need Specs"], ["new2", "Kitchen KP", ""]]);
  const pl2 = { ...pl, ...patch };
  plan = ccKeypadPrefillPlan(KP, LOADS, pl2, FO4, {});
  eq("second Fill is a no-op (idempotent on fieldKeypadId)", [plan.add, plan.already.sort()], [0, ["k1", "k2", "k5"]]);
  eq("a CONFIRMED section is never filled (the lock stands)", ccKeypadPrefillPlan(KP, LOADS, { ...pl, confirmedKeypads: { mainKeypad: true } }, FO4, {}).locked, ["k1"]);
  eq("…and its rows untouched by the patch", Object.keys(ccKeypadFillPatch(pl, ccKeypadPrefillPlan(KP, LOADS, { ...pl, confirmedKeypads: { mainKeypad: true } }, FO4, {}), mkKP)).includes("mainKeypad"), false);
  // removedAt: hidden, never deleted, restorable
  const gone = { ...KP, k1: { ...KP.k1, removedAt: 77 } };
  eq("removedAt on a filled keypad → the row is FLAGGED, not dropped", ccKeypadRemovedRows(pl2, gone), [{ sectionKey: "mainKeypad", id: "m1", fieldKeypadId: "k1" }]);
  eq("…the job's rows are still all there", pl2.mainKeypad.length, 3);
  eq("removedAt keypad is never prefilled", ccKeypadPrefillPlan({ k4: KP.k4 }, LOADS, pl, FO4, {}).add, 0);
  eq("FieldInk clears removedAt → it prefills again (restorable)", ccKeypadPrefillPlan({ k4: { ...KP.k4, removedAt: null } }, LOADS, pl, FO4, {}).add, 1);
  eq("a live keypad whose loads were all removed (assigned []) still prefills", ccKeypadPrefillPlan({ k9: { label: "Empty", floor: "main", assigned: [] } }, {}, pl, FO4, {}).bySection.mainKeypad[0].assigned, []);
  eq("junk keypad records are skipped; null-safe", [ccKeypadPrefillPlan({ bad: "x", n: null }, null, null, FO4, null).add, ccKeypadRemovedRows(null, null)], [0, []]);
}

// ── v554 the office sub-object is never written outside `office` ─────────────
{
  const ST = { __ts: 1 };
  eq("payload = { loads: { id: { office:{…, officeUpdatedAt} } } } and nothing else", ccOfficeWritePayload("loads", { a: { dismissed: true } }, ST), { loads: { a: { office: { dismissed: true, officeUpdatedAt: ST } } } });
  eq("keypads twin", ccOfficeWritePayload("keypads", { k1: { confirmed: true } }, ST), { keypads: { k1: { office: { confirmed: true, officeUpdatedAt: ST } } } });
  eq("any other map name → null (no write)", [ccOfficeWritePayload("updatedBy", { a: {} }, ST), ccOfficeWritePayload("", { a: {} }, ST), ccOfficeWritePayload("loads.a", { a: {} }, ST)], [null, null, null]);
  eq("null / array / string patches dropped; nothing valid → null", [ccOfficeWritePayload("loads", { a: null, b: [1], c: "x" }, ST), ccOfficeWritePayload("keypads", null, ST)], [null, null]);
  eq("a patch that tries to name field-owned keys still lands INSIDE office", Object.keys(ccOfficeWritePayload("loads", { a: { control: "panel", room: "X" } }, ST).loads.a), ["office"]);
  const DELK = { __del: 1 };
  eq("confirm patch", ccKeypadConfirmPatch(true, "Koy", 1000, () => DELK), { confirmed: true, confirmedBy: "Koy", confirmedAt: 1000 });
  eq("un-confirm clears who / when", ccKeypadConfirmPatch(false, "Koy", 1000, () => DELK), { confirmed: false, confirmedBy: DELK, confirmedAt: DELK });
  eq("engraving patch is keyed by the assigned load key, capped at 40", ccKeypadEngravePatch("p1", "x".repeat(60)).engraving.p1.length, 40);
  eq("engraving with no key → null", ccKeypadEngravePatch("", "Hi"), null);
}

(async () => {
  const patch = ccLoadSuggestPatch({ control: "switched" }, "panel", "Koy", T);
  const ok = await wctx.publishCcLoadOffice(1788319922110, "cg_abc", patch);
  eq("write returns true", ok, true);
  eq("exactly one setDoc", calls.length, 1);
  const c = calls[0];
  eq("targets ccloads/<jobId> on the field-ink db (id stringified)", c.ref, { db: { __db: "field-ink" }, col: "ccloads", id: "1788319922110" });
  eq("merge:true (deep-merge on the loads MAP, no pre-read)", c.opts, { merge: true });
  eq("v554: the ONLY top-level key is loads (no updatedAt / updatedBy — those are FieldInk's)", Object.keys(c.data), ["loads"]);
  eq("only the one load id is named", Object.keys(c.data.loads), ["cg_abc"]);
  eq("only the office sub-object is named under the load (no control/name/fixtures/suggestionAck)", Object.keys(c.data.loads.cg_abc), ["office"]);
  eq("office patch = suggested* + officeUpdatedAt stamp, nothing else",
    Object.keys(c.data.loads.cg_abc.office).sort(), ["officeUpdatedAt", "suggestedAt", "suggestedBy", "suggestedKind"]);
  eq("suggested* values pass through untouched", [c.data.loads.cg_abc.office.suggestedKind, c.data.loads.cg_abc.office.suggestedAt, c.data.loads.cg_abc.office.suggestedBy], ["panel", T, "Koy"]);
  eq("officeUpdatedAt is the serverTimestamp sentinel", c.data.loads.cg_abc.office.officeUpdatedAt === SENTINEL, true);
  eq("null patch (invalid kind) must be gated by the caller — the UI never calls with null", ccLoadSuggestPatch({ control: "switched" }, "dimmer", "Koy", T), null);

  // withdraw through the same single-load write: the delete sentinels ride inside office
  calls.length = 0;
  await wctx.publishCcLoadOffice(1788319922110, "cg_abc", ccLoadWithdrawPatch(() => DEL));
  eq("withdraw write names only the three suggested keys (as delete sentinels) + the stamp",
    Object.keys(calls[0].data.loads.cg_abc.office).sort(), ["officeUpdatedAt", "suggestedAt", "suggestedBy", "suggestedKind"]);
  eq("withdraw values are the delete sentinel", [calls[0].data.loads.cg_abc.office.suggestedKind, calls[0].data.loads.cg_abc.office.suggestedAt, calls[0].data.loads.cg_abc.office.suggestedBy], [DEL, DEL, DEL]);

  // room-level: one merge-set naming only the given ids' office sub-objects
  calls.length = 0;
  const okMany = await wctx.publishCcLoadOfficeMany(1788319922110, { cg_1: ccLoadSuggestPatch({ control: "switched" }, "panel", "Koy", T), cg_2: ccLoadSuggestPatch({ control: "switched" }, "panel", "Koy", T), cg_skip: null });
  eq("multi-write returns true", okMany, true);
  eq("multi-write is ONE setDoc", calls.length, 1);
  eq("multi-write merge:true on ccloads/<jobId>", [calls[0].opts, calls[0].ref.col, calls[0].ref.id], [{ merge: true }, "ccloads", "1788319922110"]);
  eq("multi-write names only the real ids (null patches dropped)", Object.keys(calls[0].data.loads).sort(), ["cg_1", "cg_2"]);
  eq("each id carries only office.{suggested*,officeUpdatedAt}", Object.keys(calls[0].data.loads.cg_2).concat(Object.keys(calls[0].data.loads.cg_2.office).sort()), ["office", "officeUpdatedAt", "suggestedAt", "suggestedBy", "suggestedKind"]);
  eq("v554: multi-write top-level key is ONLY loads", Object.keys(calls[0].data), ["loads"]);
  calls.length = 0;
  eq("multi-write with nothing to do is a no-op (no setDoc)", [await wctx.publishCcLoadOfficeMany(1, {}), calls.length], [false, 0]);
  // v554 keypad office writes: one merge-set naming only keypads.<id>.office
  calls.length = 0;
  const okKp = await wctx.publishCcKeypadOfficeMany(1788319922110, { kp_1: ccKeypadConfirmPatch(true, "Koy", T, () => DEL), kp_2: ccKeypadEngravePatch("p1", "Kitchen"), kp_skip: null });
  eq("keypad write returns true; ONE setDoc, merge:true on ccloads/<jobId>", [okKp, calls.length, calls[0].opts, calls[0].ref.col, calls[0].ref.id], [true, 1, { merge: true }, "ccloads", "1788319922110"]);
  eq("keypad write: the ONLY top-level key is keypads", Object.keys(calls[0].data), ["keypads"]);
  eq("keypad write: only real ids, each carrying ONLY office", [Object.keys(calls[0].data.keypads).sort(), Object.keys(calls[0].data.keypads.kp_1), Object.keys(calls[0].data.keypads.kp_2)], [["kp_1", "kp_2"], ["office"], ["office"]]);
  eq("keypad write: office = the patch + the stamp", [Object.keys(calls[0].data.keypads.kp_1.office).sort(), calls[0].data.keypads.kp_2.office.engraving], [["confirmed", "confirmedAt", "confirmedBy", "officeUpdatedAt"], { p1: "Kitchen" }]);
  calls.length = 0;
  eq("keypad write with nothing valid is a no-op (no setDoc)", [await wctx.publishCcKeypadOfficeMany(1, { a: null }), calls.length], [false, 0]);
  if (fails) { console.error(`ccloads-suggest-test: ${fails}/${n} FAILED`); process.exit(1); }
  console.log(`ccloads-suggest-test: ${n} checks passed`);
})();

