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
vm.runInContext(src.slice(a, b) + "\nthis.CC_LOAD_SUGGEST_KINDS = CC_LOAD_SUGGEST_KINDS; this.ccLoadCurrentKind = ccLoadCurrentKind; this.ccLoadSuggestPatch = ccLoadSuggestPatch; this.ccLoadSuggestionStatus = ccLoadSuggestionStatus;", ctx);
const { CC_LOAD_SUGGEST_KINDS, ccLoadCurrentKind, ccLoadSuggestPatch, ccLoadSuggestionStatus } = ctx;

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
vm.runInContext(src.slice(pa, pb + 2) + "\nthis.publishCcLoadOffice = publishCcLoadOffice;", wctx);
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
  if (fails) { console.error(`ccloads-suggest-test: ${fails}/${n} FAILED`); process.exit(1); }
  console.log(`ccloads-suggest-test: ${n} checks passed`);
})();

