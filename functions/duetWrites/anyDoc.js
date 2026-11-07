"use strict";
// anyDoc.js — the any-document door (D9 ship 12, 2026-11-06, Koy: "I just
// want it to be able to do anything that I say to do"). ONE general door to
// any Command Center document the app itself reads and writes, by collection
// and id: set a field, add / change / remove ONE list item by id, create,
// mark deleted, hard-delete with a typed confirm word, and edit ONE Team
// member. The named tools stay preferred (they know the app's rules); this is
// the fallback for everything else. Spec: homestead-connector
// docs/superpowers/specs/2026-11-06-duet-any-doc-design.md (normative).
//
// Pure: no Firebase import. api.js runs the ONE transaction, picks the
// envelope by collection kind (jobs → jobWrite's; needs / projects →
// stamp(); settings / plain → stampFor() below), writes the audit doc in the
// same transaction and counts the call in the 60 / hour. undo.js puts each op
// back from the audit's before while the doc still reads the audit's after.
//
// Policy (checkTarget — runs BEFORE any read):
//   • coll is a top-level collection name, docId an id segment, path dotted
//     (≤ 8 segments, no numeric segment: a list item is named by id with
//     patchItem, never by position). Subcollections refuse: top-level only.
//   • NEVER (write): duet_writes, recovery_ledger (the audit and the safety
//     net), claude_activity / claude_reports (own actions), errors,
//     material_po_log (writing it would fake a PO send), orgauth / crewtokens
//     / crewroster / crewdevices (device keys — the app issues them),
//     gc_config/mail (the mail key), settings/users outside team.edit.
//   • data-rooted collections (jobs, needs, projects): path is relative to
//     `data` (Duet says flagNote, the function writes data.flagNote); data.id
//     is never writable. On jobs a doc.set whose top key a named tool OWNS
//     (fieldPolicy.js) refuses naming that tool; the id / cache keys stay
//     denied; every other DENY row (booleans, lanes) is reachable — that is
//     the point of this ship.
//   • confirm words: doc.delete → the docId (jobs / needs / suggestions only —
//     the collections the app itself hard-deletes; > 900 KB refuses); the
//     all-phones switches gc_config/material_po, settings/appGate, config/app
//     → the docId on EVERY op; team.edit → the person's name AFTER the edit.
//     Compared after trim, case-sensitive. A missing or wrong word is a
//     deterministic refusal whose text names the exact word.
//   • every value / item / patch / data is plain JSON ≤ 100 KB (no NaN /
//     Infinity / undefined / __proto__ / functions).
//   • never a whole-document replace: every op is a field, an item or a create.
const FP = require("./fieldPolicy.js");
const JS = require("../jobShape.js");

const DOC_ACTIONS = ["doc.set", "doc.append", "doc.patchItem", "doc.removeItem", "doc.create", "doc.markDeleted", "doc.delete", "team.edit"];
const SAVED_BY = "Duet (Koy)";
const ME = "Koy";
const NEVER_COLLS = ["duet_writes", "recovery_ledger", "claude_activity", "claude_reports", "errors", "material_po_log", "orgauth", "crewtokens", "crewroster", "crewdevices"];
const NEVER_WHY = {
  duet_writes: "duet_writes is Duet's own audit — never written through the door",
  recovery_ledger: "recovery_ledger is the safety net — never written through the door",
  claude_activity: "claude_activity is Claude's own log — never written through the door",
  claude_reports: "claude_reports is Claude's own reports — never written through the door",
  errors: "errors is the app's crash log — never written through the door",
  material_po_log: "material_po_log is the PO send record — writing it would fake a PO send; never",
  orgauth: "orgauth holds login keys the app issues — never",
  crewtokens: "crewtokens holds device keys the app issues — never",
  crewroster: "crewroster is FieldInk's roster the app seeds — never",
  crewdevices: "crewdevices holds device records the app issues — never",
};
const HARD_DELETE_COLLS = ["jobs", "needs", "suggestions"];
const CONFIRM_DOCS = ["gc_config/material_po", "settings/appGate", "config/app"];
const DATA_COLLS = ["jobs", "needs", "projects"];
const ID_CACHE_DENY = ["id", "simproSync", "docPull", "presence", "driveFolderId"];   // fieldPolicy DENY rows that protect ids / caches: stay denied here
const STAMP_KEYS = ["updated_at", "updatedAt", "saved_by", "device", "tab", "app_build", "w", "merged", "lastActivityAt"];   // the envelope is the function's, never a path
const TEAM_NEVER_KEYS = ["id", "fcmTokens", "fcmToken", "_standIn", "pin"];   // device tokens, the stand-in flag, the sign-in PIN (never held by a tool)
const TEAM_REDACT = ["pin", "fcmTokens", "fcmToken"];                          // never in an audit doc either
const COLL = /^[a-z_]{2,40}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const MAX_SEGMENTS = 8;
const MAX_JSON = 100 * 1024;
const MAX_DELETE = 900 * 1024;
const POSITIONS = ["end", "start"];
const PO_MODES = ["off", "test", "live"];

const refuse = (why, extra) => ({ refused: why, ...(extra || {}) });
const confirmRefusal = (word) => refuse("Ask Koy to type `" + word + "` and pass it as confirm. Nothing was written.");
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDel = (v) => isObj(v) && v.__delete === true && Object.keys(v).length === 1;
const T = (v) => String(v == null ? "" : v).trim();

// ── deep equality (undefined ≡ null ≡ missing key; key order ignored) ────────
function norm(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; Object.keys(v).sort().forEach(k => { const x = norm(v[k]); if (x !== null) o[k] = x; }); return o; }
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// Plain JSON only: Firestore refuses undefined / NaN / Infinity / functions,
// and a __proto__ / constructor / prototype key is a trap, not data.
function jsonProblem(v, where) {
  if (v === undefined) return `${where} is undefined — not JSON.`;
  if (v === null) return null;
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? null : `${where} holds ${String(v)} — not JSON.`;
  if (t === "string" || t === "boolean") return null;
  if (t !== "object") return `${where} holds a ${t} — not JSON.`;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const p = jsonProblem(v[i], `${where}[${i}]`); if (p) return p; } return null; }
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return `${where} isn't a plain object — not JSON.`;
  for (const k of Object.keys(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") return `${where} has a ${k} key — not JSON Duet may write.`;
    const p = jsonProblem(v[k], `${where}.${k}`); if (p) return p;
  }
  if (Object.prototype.hasOwnProperty.call(v, "__proto__")) return `${where} has a __proto__ key — not JSON Duet may write.`;
  return null;
}
function jsonCheck(v, where) {
  const p = jsonProblem(v, where); if (p) return p;
  if (JSON.stringify(v).length > MAX_JSON) return `${where} is over 100 KB — the door takes one field / item / doc body at a time, not a dump.`;
  return null;
}

const kindOf = (coll) => (DATA_COLLS.includes(coll) ? "data" : coll === "settings" ? "settings" : "plain");
const isConfirmDoc = (coll, docId) => CONFIRM_DOCS.includes(coll + "/" + docId);

// Why coll/docId may never be written (null = allowed). io.anyRef uses this too.
function neverReason(coll, docId) {
  const c = String(coll || ""), d = String(docId || "");
  if (NEVER_COLLS.includes(c)) return NEVER_WHY[c] + ". Nothing was read or written.";
  if (c === "gc_config" && d === "mail") return "gc_config/mail holds the mail key — never written through the door. Nothing was read or written.";
  if (c === "settings" && d === "users") return "settings/users (the Team roster) is only edited one person at a time through team.edit (cc_edit_team_member) — never through the door. Nothing was read or written.";
  return null;
}

// ── 1. the target check: BEFORE any read ────────────────────────────────────
// → {refused, status?} | {coll, docId, kind, path, confirmWord}
function checkTarget(action, args) {
  const a = args && typeof args === "object" ? args : {};
  if (!DOC_ACTIONS.includes(action)) return refuse(`action must be one of ${DOC_ACTIONS.join(", ")}.`);
  if (action === "team.edit") {
    if (a.userId !== undefined && a.userId !== null && !DOC_ID.test(String(a.userId))) return refuse("userId must be the person's id from cc_list_team (letters, digits, - or _).");
    if (!isObj(a.patch) || !Object.keys(a.patch).length) return refuse("patch must be an object with at least one field to change (title, access, foremanId, active, phone, email, name, caps …).");
    for (const k of TEAM_NEVER_KEYS) if (Object.prototype.hasOwnProperty.call(a.patch, k)) return refuse(`${k} can't be changed through team.edit${k === "pin" ? " — a PIN is set by the person on the sign-in screen, and no Duet tool ever holds one" : k === "id" ? " — a person's id never changes" : " — device tokens and the stand-in flag are the app's own"}. Nothing was written.`);
    const jp = jsonCheck(a.patch, "patch"); if (jp) return refuse(jp);
    return { coll: "settings", docId: "users", kind: "settings", path: null, confirmWord: a.confirm == null ? null : T(a.confirm) };
  }
  const coll = String(a.coll == null ? "" : a.coll), docId = a.docId == null ? "" : String(a.docId);
  if (coll.includes("/") || docId.includes("/")) return refuse("top-level documents only — a subcollection (jobs/<id>/versions, gc_portal/<id>/jobs …) isn't reachable through the door. Nothing was read or written.");
  if (!COLL.test(coll)) return refuse("coll must be a top-level collection name (lowercase letters and _, 2–40 chars) such as jobs, needs, settings, gc_config.");
  if (action !== "doc.create" && !DOC_ID.test(docId)) return refuse("docId must be the document's id (letters, digits, - or _, up to 128 chars).");
  if (action === "doc.create" && docId && !DOC_ID.test(docId)) return refuse("docId (optional on a create) must be letters, digits, - or _, up to 128 chars.");
  const never = neverReason(coll, docId); if (never) return refuse(never);
  if (action === "doc.create" && coll === "settings" && docId === "users") return refuse(neverReason("settings", "users"));
  const kind = kindOf(coll);
  const confirmWord = a.confirm == null ? null : T(a.confirm);
  // paths
  let path = null;
  if (["doc.set", "doc.append", "doc.patchItem", "doc.removeItem"].includes(action)) {
    path = String(a.path == null ? "" : a.path);
    if (!PATH.test(path)) return refuse("path must be dotted field names like flagNote or roughQuestions.main (letters, digits, _; dots between segments).");
    const segs = path.split(".");
    if (segs.length > MAX_SEGMENTS) return refuse(`path is deeper than ${MAX_SEGMENTS} segments — the door doesn't reach that far.`);
    if (segs.some(s => /^\d+$/.test(s))) return refuse(`path segment "${segs.find(s => /^\d+$/.test(s))}" is a number — a list item is never named by position: name the item by id with patch_item (or remove_item). Nothing was written.`);
    if (kind === "data") {
      if (segs[0] === "data") return refuse(`path is relative to data on ${coll} — say ${segs.slice(1).join(".") || "<field>"}, not ${path}. Nothing was written.`);
      if (segs[0] === "id") return refuse(`data.id is the document's id — never written. Nothing was written.`);
      if (coll === "jobs" && action === "doc.set") {
        const cls = FP.classify(segs[0]);
        if (cls.class === "owned") return refuse(cls.why);
        if (cls.class === "deny" && ID_CACHE_DENY.includes(segs[0])) return refuse(cls.why);
      }
    } else if (STAMP_KEYS.includes(segs[0])) return refuse(`${segs[0]} is part of the write stamp the function adds itself — not a path. Nothing was written.`);
  }
  // values
  if (action === "doc.set") { if (!Object.prototype.hasOwnProperty.call(a, "value")) return refuse("value is required (JSON; {\"__delete\":true} removes the key)."); const p = jsonCheck(a.value, "value"); if (p) return refuse(p); }
  if (action === "doc.append") {
    if (!isObj(a.item)) return refuse("item must be an object (the list entry to add).");
    const p = jsonCheck(a.item, "item"); if (p) return refuse(p);
    if (a.position != null && !POSITIONS.includes(a.position)) return refuse("position must be \"end\" (default) or \"start\".");
  }
  if (action === "doc.patchItem") {
    if (!DOC_ID.test(String(a.itemId == null ? "" : a.itemId))) return refuse("itemId must be the list entry's id.");
    if (!isObj(a.patch) || !Object.keys(a.patch).length) return refuse("patch must be an object with at least one key ({\"__delete\":true} removes a key).");
    const p = jsonCheck(a.patch, "patch"); if (p) return refuse(p);
  }
  if (action === "doc.removeItem" && !DOC_ID.test(String(a.itemId == null ? "" : a.itemId))) return refuse("itemId must be the list entry's id.");
  if (action === "doc.create") { if (!isObj(a.data)) return refuse("data must be an object (the new document's fields)."); const p = jsonCheck(a.data, "data"); if (p) return refuse(p); }
  // confirm words
  if (action === "doc.delete") {
    if (!HARD_DELETE_COLLS.includes(coll)) return refuse(`A hard delete only reaches ${HARD_DELETE_COLLS.join(", ")} (the collections the app itself deletes) — ${coll} isn't one; use doc.markDeleted. Nothing was written.`);
    if (confirmWord !== docId) return confirmRefusal(docId);
  }
  if (isConfirmDoc(coll, docId) && confirmWord !== docId) return confirmRefusal(docId);
  return { coll, docId, kind, path, confirmWord: confirmWord === null ? null : confirmWord };
}

// ── helpers on the live copy ─────────────────────────────────────────────────
const rootOf = (kind, live) => (kind === "data" ? (live && isObj(live.data) ? live.data : null) : live);
function getPath(obj, segs) { let cur = obj; for (const s of segs) { if (!isObj(cur)) return undefined; cur = cur[s]; } return cur; }
// A parent along the path that isn't a map would be replaced by Firestore's dotted update — refuse instead.
function parentProblem(root, segs) {
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const v = cur[segs[i]];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return `${segs.slice(0, i + 1).join(".")} is a list — name an item by id with patch_item, or set the whole list. Nothing was written.`;
    if (!isObj(v)) return `${segs.slice(0, i + 1).join(".")} isn't a map (it holds a ${typeof v}) — set it whole instead. Nothing was written.`;
    cur = v;
  }
  return null;
}
const typeName = (v) => (Array.isArray(v) ? "list" : v === null ? "null" : isObj(v) ? "map" : typeof v);
function listAt(root, segs, path, mustExist) {
  const pp = parentProblem(root, segs); if (pp) return refuse(pp);
  const cur = getPath(root, segs);
  if (cur === undefined || cur === null) return mustExist ? refuse(`There is no list at ${path}. Nothing was written.`) : { list: [] };
  if (!Array.isArray(cur)) return refuse(`${path} holds a ${typeName(cur)}, not a list — the door never turns one into a list. Nothing was written.`);
  return { list: cur };
}
const findById = (list, id) => list.findIndex(x => isObj(x) && String(x.id) === String(id));
const idsOf = (list) => list.filter(x => isObj(x) && x.id !== undefined).map(x => String(x.id));
const missingItem = (path, id, list) => refuse(`No item with id ${id} in ${path}${list.length ? ` (ids there: ${idsOf(list).slice(0, 20).join(", ")})` : " (the list is empty)"}. Nothing was written.`);
const newItemId = (coll, ctx) => `${coll}_${Date.parse(ctx.nowIso)}_${ctx.rand || Math.random().toString(36).slice(2, 7)}`;
function newDocId(coll, ctx) {
  const ms = Date.parse(ctx.nowIso);
  const r = ctx.rand || Math.random().toString(36).slice(2, 7);
  if (coll === "jobs") return String(ms);
  if (coll === "needs") return `need_${ms}_${r}`;
  if (coll === "projects") return `prj_${ms}`;
  return `${coll}_${ms}_${r}`;
}
// Shallow merge with {__delete:true} removing a key; returns the merged copy and the changed keys.
function mergePatch(base, patch) {
  const out = { ...clone(base) }, changed = [];
  for (const k of Object.keys(patch)) {
    if (isDel(patch[k])) { if (Object.prototype.hasOwnProperty.call(out, k)) { delete out[k]; changed.push(k); } continue; }
    if (!same(out[k], patch[k]) || !Object.prototype.hasOwnProperty.call(out, k)) { out[k] = clone(patch[k]); changed.push(k); }
  }
  return { out, changed };
}
const prefixOf = (kind) => (kind === "data" ? "data." : "");

// ── 2. the planners: against the live copy, under the transaction ───────────
// live = the raw doc (the {data, …} envelope where the app keeps one) or null.
// → {refused, status?} | {noop, result} | {write, before, after, itemId?, index?, docId?, result}
// write: {kind:"update", fields:{<dotted>: value | {__delete:true}}} (the
// envelope is NOT in fields — api.js adds it by kind) | {kind:"create", doc}
// | {kind:"delete"}.
function planDoc(action, args, live, ctx) {
  const t = checkTarget(action, args); if (t.refused) return t;
  const a = args || {};
  const { coll, docId, kind, path } = t;
  const pre = prefixOf(kind);
  const where = `${coll}/${docId}`;
  const segs = path ? path.split(".") : [];
  const base = { coll, docId, path };

  if (action === "doc.create") {
    if (live) return refuse(`${where} already exists — a create never overwrites. Use doc.set on it instead. Nothing was written.`, { status: 409 });
    const id = docId || newDocId(coll, ctx);
    const body = clone(a.data);
    if (kind === "data") {
      let doc;
      if (coll === "jobs") {
        if (!T(body.name)) return refuse("A new job needs a name (data.name) — the Job Board lists it by name. Nothing was written.");
        // blankJob's defaults with the doc id as the job's id, every row id fresh (never the job's).
        let n = Date.parse(ctx.nowIso) + 1, first = true;
        const uid = () => { if (first) { first = false; return id; } n += 1; return String(n); };
        doc = { ...JS.blankJob(uid), ...body };
      } else doc = body;
      doc.id = id;
      const after = clone(doc);
      return { write: { kind: "create", doc: { data: doc } }, before: null, after, docId: id, result: { ...base, docId: id, created: true, name: typeof doc.name === "string" ? doc.name : "", keys: Object.keys(body).filter(k => k !== "id").length, ...(coll === "jobs" ? { follows: ["The job opens on the Job Board with blankJob's defaults under what you gave it (foreman defaults to Koy unless data.foreman was set).", "cc_search_jobs finds it by name only after FieldInk's ccjobs/index refreshes — use this docId meanwhile."] } : {}) } };
    }
    const after = clone(body);
    return { write: { kind: "create", doc: body }, before: null, after, docId: id, result: { ...base, docId: id, created: true, keys: Object.keys(body).length } };
  }

  if (!live) return refuse(`${where} doesn't exist in Command Center (or has no data). Nothing was written.`, { status: 404 });
  const root = rootOf(kind, live);
  if (!root) return refuse(`${where} has no data map — not a document the app's own writers made. Nothing was written.`, { status: 404 });

  if (action === "doc.set") {
    const pp = parentProblem(root, segs); if (pp) return refuse(pp);
    const cur = getPath(root, segs);
    const before = cur === undefined ? null : clone(cur);
    if (isDel(a.value)) {
      if (cur === undefined) return { noop: true, result: { ...base, from: null, to: null, message: `${path} isn't on ${where} — nothing to remove.` } };
      return { write: { kind: "update", fields: { [pre + path]: { __delete: true } } }, before, after: null, result: { ...base, from: before, to: null, removed: true } };
    }
    if (coll === "gc_config" && docId === "material_po" && path === "mode" && !PO_MODES.includes(a.value)) return refuse(`gc_config/material_po.mode must be off, test or live. Nothing was written.`);
    if (same(cur, a.value) && cur !== undefined) return { noop: true, result: { ...base, from: before, to: before } };
    const after = clone(a.value);
    const result = { ...base, from: before, to: after };
    if (coll === "gc_config" && docId === "material_po" && path === "mode") result.warning = a.value === "live" ? "mode live → the crew's PO sends go to real vendors (test → they go to the test inbox as [TEST])." : a.value === "test" ? "mode test → the crew's PO sends go to the test inbox as [TEST] (live → they go to real vendors)." : "mode off → the crew's PO sends are refused (live → real vendors; test → the test inbox as [TEST]).";
    return { write: { kind: "update", fields: { [pre + path]: after } }, before, after, result };
  }

  if (action === "doc.append") {
    const l = listAt(root, segs, path, false); if (l.refused) return l;
    const item = clone(a.item);
    if (item.id !== undefined && typeof item.id !== "string") return refuse("item.id must be text (or leave it out to have one minted). Nothing was written.");
    if (item.id === undefined || item.id === "") item.id = newItemId(coll, ctx);
    if (findById(l.list, item.id) >= 0) return refuse(`There is already an item with id ${item.id} in ${path} — use patch_item to change it. Nothing was written.`);
    const position = a.position || "end";
    const next = position === "start" ? [item, ...l.list] : [...l.list, item];
    return { write: { kind: "update", fields: { [pre + path]: next } }, before: null, after: clone(item), itemId: item.id, index: position === "start" ? 0 : next.length - 1, result: { ...base, itemId: item.id, position, length: next.length } };
  }

  if (action === "doc.patchItem") {
    const l = listAt(root, segs, path, true); if (l.refused) return l;
    const itemId = String(a.itemId);
    const i = findById(l.list, itemId); if (i < 0) return missingItem(path, itemId, l.list);
    if (Object.prototype.hasOwnProperty.call(a.patch, "id")) return refuse("An item's id can't change — remove it and add a new one if it must. Nothing was written.");
    const m = mergePatch(l.list[i], a.patch);
    if (!m.changed.length) return { noop: true, result: { ...base, itemId, changed: [] } };
    const next = l.list.map((x, j) => (j === i ? m.out : x));
    return { write: { kind: "update", fields: { [pre + path]: next } }, before: clone(l.list[i]), after: clone(m.out), itemId, index: i, result: { ...base, itemId, changed: m.changed } };
  }

  if (action === "doc.removeItem") {
    const l = listAt(root, segs, path, true); if (l.refused) return l;
    const itemId = String(a.itemId);
    const i = findById(l.list, itemId); if (i < 0) return missingItem(path, itemId, l.list);
    const next = l.list.filter((x, j) => j !== i);
    return { write: { kind: "update", fields: { [pre + path]: next } }, before: clone(l.list[i]), after: null, itemId, index: i, result: { ...base, itemId, index: i, length: next.length } };
  }

  if (action === "doc.markDeleted") {
    if (root.deleted === true) return { noop: true, result: { ...base, deleted: true, deletedAt: root.deletedAt === undefined ? null : root.deletedAt, deletedBy: root.deletedBy === undefined ? null : root.deletedBy } };
    const after = { deleted: true, deletedAt: ctx.nowIso, deletedBy: ME };
    const before = {}; Object.keys(after).forEach(k => { before[k] = root[k] === undefined ? null : clone(root[k]); });
    const fields = {}; Object.keys(after).forEach(k => { fields[pre + k] = after[k]; });
    return { write: { kind: "update", fields }, before, after, result: { ...base, ...after, note: kind === "data" ? "The app's loaders skip a doc with data.deleted:true; the doc itself stays (undo puts the three keys back)." : "The three keys are set top-level; whether the app's reader honours them depends on the collection (undo puts them back)." } };
  }

  if (action === "doc.delete") {
    const bytes = JSON.stringify(live).length;
    if (bytes > MAX_DELETE) return refuse(`${where} is ${Math.round(bytes / 1024)} KB — too big to keep a copy — archive or mark deleted instead (doc.markDeleted). Nothing was written.`);
    return { write: { kind: "delete" }, before: clone(live), after: null, result: { ...base, deleted: true, hard: true, bytes, name: isObj(root) && typeof root.name === "string" ? root.name : "" } };
  }
  return refuse("unknown action");
}

// ── 3. team.edit: ONE person in settings/users.list ─────────────────────────
// usersDoc = the raw settings/users doc {list, updated_at, saved_by, device}.
// → {refused} | {noop, result} | {list, before, after, userId, name, result}
// The list never shrinks ("remove" is active:false); the caller can't
// deactivate his own record; the audited person never carries pin / tokens.
const redact = (u) => { const o = clone(u); TEAM_REDACT.forEach(k => { delete o[k]; }); return o; };
const isCaller = (u, ctx) => T(u && u.name).toLowerCase() === ME.toLowerCase() || (!!(ctx && ctx.email) && T(u && u.email).toLowerCase() === T(ctx.email).toLowerCase());
function planTeamEdit(args, usersDoc, ctx) {
  const t = checkTarget("team.edit", args); if (t.refused) return t;
  const a = args || {};
  if (!usersDoc || !Array.isArray(usersDoc.list) || !usersDoc.list.length) return refuse("settings/users (the Team roster) isn't loaded or holds no list — the door never makes it from scratch. Nothing was written.");
  const list = usersDoc.list;
  const confirm = t.confirmWord;
  const nameTaken = (name, exceptId) => list.find(u => isObj(u) && String(u.id) !== String(exceptId) && T(u.name).toLowerCase() === T(name).toLowerCase());
  const base = { coll: "settings", docId: "users" };
  if (a.userId === undefined || a.userId === null) {
    // add
    const name = T(a.patch.name);
    if (!name) return refuse("A new team member needs a name (patch.name). Nothing was written.");
    const dup = nameTaken(name, null);
    if (dup) return refuse(`There is already a team member named ${dup.name}${dup.active === false ? " (deactivated — set active:true on that record instead of adding a second)" : ""} — one record per person (the Justin lesson). Nothing was written.`);
    if (confirm !== name) return confirmRefusal(name);
    const person = { id: `u_${Date.parse(ctx.nowIso)}`, ...clone(a.patch), name };
    for (const k of Object.keys(person)) if (isDel(person[k])) delete person[k];
    const next = [...list, person];
    return { list: next, before: null, after: redact(person), userId: person.id, name, result: { ...base, userId: person.id, name, added: true, changed: Object.keys(person), listNow: next.length, note: "Added to settings/users only — the app seeds FieldInk's crewroster for a new person the next time a phone saves the team (P4.2), not from here." } };
  }
  const userId = String(a.userId);
  const i = findById(list, userId);
  if (i < 0) return refuse(`No team member with id ${userId} (cc_list_team shows ids). Nothing was written.`);
  const cur = list[i];
  const m = mergePatch(cur, a.patch);
  const name = T(m.out.name);
  if (!name) return refuse("A team member's name can't be blank. Nothing was written.");
  if (Object.prototype.hasOwnProperty.call(a.patch, "name") && nameTaken(name, userId)) return refuse(`There is already a team member named ${nameTaken(name, userId).name} — one record per person. Nothing was written.`);
  if (a.patch.active === false && isCaller(cur, ctx)) return refuse("That is Koy's own record — the door never deactivates the caller (you'd lock yourself out of the Team page). Nothing was written.");
  if (confirm !== name) return confirmRefusal(name);
  if (!m.changed.length) return { noop: true, result: { ...base, userId, name, changed: [] } };
  const next = list.map((u, j) => (j === i ? m.out : u));
  return { list: next, before: redact(cur), after: redact(m.out), userId, name, result: { ...base, userId, name, added: false, changed: m.changed, deactivated: a.patch.active === false, reactivated: a.patch.active === true && cur.active === false, listNow: next.length } };
}

// ── 4. the stamp for settings / plain docs ──────────────────────────────────
// Mirrors whichever stamp key the doc already carries: updatedAt → the
// settings-style {updatedAt, tab, merged:false}; updated_at → {updated_at,
// saved_by}; neither → nothing added. A new doc (live null) gets {updated_at,
// saved_by}. Timestamps strictly newer than the doc's own (the freshIso rule).
function freshIso(nowIso, prevIso) {
  let t = Date.parse(nowIso);
  const prev = Date.parse(prevIso || "");
  if (!isNaN(prev) && t <= prev) t = prev + 1;
  return new Date(t).toISOString();
}
function stampFor(kind, live, ctx, requestId) {
  const out = {};
  if (!live) return { updated_at: ctx.nowIso, saved_by: SAVED_BY };
  if (Object.prototype.hasOwnProperty.call(live, "updatedAt")) { out.updatedAt = freshIso(ctx.nowIso, live.updatedAt); out.tab = `duet-${String(requestId).slice(0, 8)}`; out.merged = false; }
  if (Object.prototype.hasOwnProperty.call(live, "updated_at")) { out.updated_at = freshIso(ctx.nowIso, live.updated_at); out.saved_by = SAVED_BY; }
  return out;
}

module.exports = { DOC_ACTIONS, SAVED_BY, NEVER_COLLS, HARD_DELETE_COLLS, CONFIRM_DOCS, DATA_COLLS, ID_CACHE_DENY, TEAM_NEVER_KEYS, TEAM_REDACT, MAX_JSON, MAX_DELETE,
  kindOf, neverReason, checkTarget, planDoc, planTeamEdit, stampFor, same, norm, getPath, redact, freshIso, confirmRefusal };
