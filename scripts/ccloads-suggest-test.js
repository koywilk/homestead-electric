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
vm.runInContext(src.slice(a, b) + "\nthis.CC_LOAD_SUGGEST_KINDS = CC_LOAD_SUGGEST_KINDS; this.ccLoadCurrentKind = ccLoadCurrentKind; this.ccLoadSuggestPatch = ccLoadSuggestPatch; this.ccLoadSuggestionStatus = ccLoadSuggestionStatus; this.ccLoadWithdrawPatch = ccLoadWithdrawPatch; this.ccLoadsGrouped = ccLoadsGrouped; this.ccLoadImportRows = ccLoadImportRows; this.ccFloorToSection = ccFloorToSection;", ctx);
const { CC_LOAD_SUGGEST_KINDS, ccLoadCurrentKind, ccLoadSuggestPatch, ccLoadSuggestionStatus, ccLoadWithdrawPatch, ccLoadsGrouped, ccLoadImportRows, ccFloorToSection } = ctx;

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
eq("v435: ONLY panelized loads import - switched / dimmer / tape are skipped", IM.rows.map(r => r.name), ["Kitchen Cans", "Lonely"]);
eq("skipped = 3 non-panel + already-imported + gone-from-plan", IM.skipped, 5);
eq("panel loads keep a blank Loads-list type", IM.rows.map(r => r.loadType), ["", ""]);
eq("FieldInk floor maps to the Loads list floor section; an unknown floor keeps its own name", IM.rows.map(r => r.location), ["Main Level", "attic"]);
eq("every row is a real newCentralLoad shape + room/fieldLoadId/origin", Object.keys(IM.rows[0]).sort(), ["fieldLoadId", "id", "loadType", "location", "name", "origin", "pulled", "room", "watts"]);
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
};
vm.createContext(wctx);
const MSTART = "async function publishCcLoadOfficeMany(jobId, patchesById) {";
const ma = src.indexOf(MSTART);
const mb = src.indexOf("\n}\n", ma);
if (ma === -1 || mb === -1) { console.error("ccloads-suggest-test: publishCcLoadOfficeMany not found"); process.exit(1); }
vm.runInContext(src.slice(pa, pb + 2) + "\n" + src.slice(ma, mb + 2) + "\nthis.publishCcLoadOffice = publishCcLoadOffice; this.publishCcLoadOfficeMany = publishCcLoadOfficeMany;", wctx);
(async () => {
  const patch = ccLoadSuggestPatch({ control: "switched" }, "panel", "Koy", T);
  const ok = await wctx.publishCcLoadOffice(1788319922110, "cg_abc", patch);
  eq("write returns true", ok, true);
  eq("exactly one setDoc", calls.length, 1);
  const c = calls[0];
  eq("targets ccloads/<jobId> on the field-ink db (id stringified)", c.ref, { db: { __db: "field-ink" }, col: "ccloads", id: "1788319922110" });
  eq("merge:true (deep-merge on the loads MAP, no pre-read)", c.opts, { merge: true });
  eq("top-level keys are only loads/updatedAt/updatedBy", Object.keys(c.data).sort(), ["loads", "updatedAt", "updatedBy"]);
  eq("updatedBy is 'office'", c.data.updatedBy, "office");
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
  eq("multi-write top-level keys are only loads/updatedAt/updatedBy", Object.keys(calls[0].data).sort(), ["loads", "updatedAt", "updatedBy"]);
  calls.length = 0;
  eq("multi-write with nothing to do is a no-op (no setDoc)", [await wctx.publishCcLoadOfficeMany(1, {}), calls.length], [false, 0]);
  if (fails) { console.error(`ccloads-suggest-test: ${fails}/${n} FAILED`); process.exit(1); }
  console.log(`ccloads-suggest-test: ${n} checks passed`);
})();

