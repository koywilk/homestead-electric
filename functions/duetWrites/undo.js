"use strict";
// undo.js — put back an earlier Duet change from its audit doc (D9 ship 11,
// cc_undo_write → undo.apply). Pure: no Firebase import. api.js reads the audit
// doc and the live doc(s) in ONE transaction, asks this module what to write,
// writes it through the SAME envelopes the original writers used, audits the
// undo as its own duet_writes/<id> with `undoes`, and stamps the original with
// {undoneBy, undoneAt} in the same transaction.
//
// Three classes of original (plan §5, decided per action here):
//   EDITS  — replayed from the audit's `before` exactly, and ONLY while every
//            field's current value still equals the audit's `after` (deep
//            equal; for a whole-array field the ONE item by id where the audit
//            stored one item). Otherwise refused with current vs expected so
//            Duet can tell Koy. Job scalars / maps, one item in an array or a
//            question floor or a punch tree, need fields (dotted), project
//            fields, a planner cell, a settings-list item, a time-off decision
//            (replayed through planDecide with force), punch done / undone
//            (replayed through planSetDone so the punchTicks slot and the
//            return-trip cascade follow — a done-undo IS a done flip the app's
//            way), void ↔ restore (the app's own pair).
//   ADDS   — undone by the app's own "closing" move where one exists, never a
//            removal: a task → done + voided ("undone by Koy via Duet", the
//            app's void shape + its note); a change order → denied; a return
//            trip (rt.create / inspection's new trip) → complete; a job note →
//            the app's soft delete; a note line → cleared to ""; a crew team →
//            removed; a roster name → removed / re-added; an imported job or a
//            building → archived (Duet's reversible shape). No take-back
//            exists for: a question, a daily update, a punch item on a phase
//            tree (mark it done), a material card (mark it ordered / picked up), a CO → trip
//            conversion, an Upcoming row, a project, a removed team → refused
//            with the reason.
//   TRIP PUNCH (Koy 2026-11-06, "undo on") — rtPunch.add: the added entries
//            taken back off that trip, only while EVERY one still reads what
//            the add left; one touched → refused, naming which. The app removes
//            trip entries the same way when a promotion is undone. The one-entry
//            trip punch writes (done / waiting / edit) put the entry back.
//   SENDS  — refused ("already left the building"): a PO send, a team
//            announcement, a plan-intake decision, a thread reply (the message
//            stays), a photo (the entry and the bytes stay).
// Never: an undo of an undo, of a refused or no-op call, of a call already
// undone, of a preview (a read). Deleted jobs refuse; archived jobs refuse
// unless the original was the archive itself (that undo IS the reversal).
const JI = require("./jobItems.js");
const NU = require("./notesUpdates.js");
const PU = require("./punch.js");
const OF = require("./office.js");
const TO = require("./timeOff.js");
const JSU = require("./jobSetup.js");
const QS = require("./questions.js");
const NS = require("../needShape.js");
const TP = require("./tripPunch.js");

const ME = "Koy";
const UNDO_REASON = "undone by Koy via Duet";
const refuse = (why, extra) => ({ refused: why, ...(extra || {}) });

const SENDS = {
  "material.sendPo": "that PO was sent — Simpro has the PO and the vendor has the email. Void the PO in Simpro if it shouldn't stand; the card's send stamps stay as the record.",
  "broadcast.send": "that announcement reached the team's phones — it cannot be unsent. Send a follow-up if it needs correcting.",
  "planIntake.decide": "that plan-intake decision moved a PDF and resolved a finding — the watcher has no take-back. Decide the item again from the Plan Inbox if it was wrong.",
  "question.reply": "that discussion reply is on the thread the GC / homeowner link reads — it stays as written; post another reply to correct it.",
  "photo.add": "that photo is uploaded and on the item — it stays; remove it in the app if it shouldn't be there.",
  "material.previewPo": "that was a preview (a read) — nothing was written, nothing to put back.",
};
const NO_TAKE_BACK = {
  "question.add": "the app has no take-back for a question — answer it, mark it done (cc_answer_question) or leave it.",
  "dailyUpdate.add": "the app has no edit or take-back for a daily update (its delete is a hard removal, which Duet never does) — add a correcting update.",
  "punch.add": "the app's only removal of a punch item is a hard delete, which Duet never does — mark it done (cc_punch_done) or leave it; a room it made stays.",
  "material.addCard": "the app's only take-back for a material card is removing it, which Duet never does — tick it ordered / picked up (cc_tick_material_card) or leave it.",
  "co.convert": "a CO → return trip conversion has no take-back in the app — mark the trip complete (cc_update_return_trip) and set the CO's status as needed (cc_set_co_status).",
  "upcoming.add": "the Upcoming pipeline has no remove from Duet — take the row off in the app.",
  "project.create": "a project has no take-back — archive it (cc_patch_project archived:true); its Site / Shared job keeps the project link (the app's Leave project isn't a Duet tool).",
  "project.join": null,
};
const TREE_KEYS = { roughPunch: "rough", finishPunch: "finish", qcPunch: "qc" };
const ITEM_ARRAYS = new Set(["changeOrders", "returnTrips", "jobNotes", "roughUpdates", "finishUpdates", "roughMaterials", "finishMaterials", "commMaterials"]);
const QUESTION_MAPS = new Set(["roughQuestions", "finishQuestions"]);
const STAGE_LIKE = /^(phase|inspection|qc|prep)\./;

// ── deep equality (undefined ≡ null ≡ missing key; key order ignored) ────────
function norm(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") { const o = {}; Object.keys(v).sort().forEach(k => { const x = norm(v[k]); if (x !== null) o[k] = x; }); return o; }
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const getPath = (obj, dotted) => String(dotted).split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const DEL = { __delete: true };
const put = (v) => (v === null || v === undefined ? DEL : v);
const diffOf = (field, current, expected) => ({ field, current: current === undefined ? null : current, expected: expected === undefined ? null : expected });
const changedSince = (diffs) => refuse(`Changed since Duet's call — ${diffs.map(d => d.field).join(", ")} no longer read${diffs.length === 1 ? "s" : ""} what that call left (someone edited since). Nothing was put back; here is current vs expected so you can decide by hand.`, { diff: diffs });

// ── 1. classify the audit doc: what to read, which mode ──────────────────────
// → {refused, status} | { mode: "edit"|"closing"|"timeOff"|"setDone"|"voidRestore", coll, docId, reads: ["coll/id"], closing?: string }
function classify(audit) {
  const a = audit;
  if (!a) return refuse("No Duet change with that requestId (cc_list_duet_writes shows recent ones). Nothing was written.", { status: 404 });
  if (a.action === "undo.apply") return refuse("That call was itself an undo — undo the change it put back by its own requestId instead (nothing is undone twice over).");
  if (a.ok !== true) return refuse(`That call was refused (${String(a.why || "").slice(0, 160)}) — it wrote nothing, so there is nothing to put back.`);
  if (a.noop) return refuse("That call changed nothing (noop) — nothing to put back.");
  if (a.read) return refuse(SENDS["material.previewPo"]);
  if (a.undoneBy) return refuse(`That change was already undone by ${a.undoneBy}${a.undoneAt ? ` at ${a.undoneAt}` : ""}. Nothing was written.`);
  if (SENDS[a.action]) return refuse(`Already left the building: ${SENDS[a.action]} Nothing was written.`);
  if (NO_TAKE_BACK[a.action]) return refuse(`${NO_TAKE_BACK[a.action]} Nothing was written.`);
  const coll = String(a.coll || ""), docId = String(a.docId || "");
  if (!coll || !docId) return refuse("That audit record names no document — nothing to put back.");
  const base = { coll, docId, reads: [coll + "/" + docId] };
  switch (a.action) {
    case "task.create": return { ...base, mode: "closing", closing: "task voided (done + voided, the app's own void)" };
    case "autoTask.promote": return a.newDoc ? { ...base, mode: "closing", closing: "task voided (done + voided, the app's own void)" } : { ...base, mode: "edit" };
    case "co.create": return { ...base, mode: "closing", closing: "change order set to denied (cc_set_co_status's shape)" };
    case "rt.create": return { ...base, mode: "closing", closing: "return trip set to complete (cc_update_return_trip's shape)" };
    case "inspection.createTrip": {
      const body = a.response && a.response.body;
      if (body && body.appended) return refuse("That call added items to an existing trip — the app has no take-back for trip items; tick them done or leave them. Nothing was written.");
      return { ...base, mode: "closing", closing: "return trip set to complete (cc_update_return_trip's shape)" };
    }
    case "note.add": return { ...base, mode: "closing", closing: "note soft-deleted (the app's own delete flag)" };
    case "note.addLine": return { ...base, mode: "closing", closing: "line cleared to \"\" (cc_edit_note_line's shape)" };
    case "job.createFromSimpro": case "project.createBuilding": return { ...base, mode: "closing", closing: "job archived (Duet's reversible archive; the Simpro inbox entry is not restored)" };
    case "crewTeams.set": {
      const body = a.response && a.response.body;
      if (body && body.removed) return refuse("A removed crew team can't be put back with its old id — add it again with cc_crew_teams (op add). Nothing was written.");
      if (body && body.added) return { ...base, mode: "closing", closing: "team removed (cc_crew_teams op remove)" };
      return { ...base, mode: "edit" };
    }
    case "crewRoster.set": {
      const body = a.response && a.response.body;
      return { ...base, mode: "closing", closing: body && body.added ? "name taken off the roster (cc_crew_roster op remove)" : "name put back on the roster (cc_crew_roster op add)" };
    }
    case "timeOff.decide": return { ...base, mode: "timeOff", reads: ["settings/timeOffRequests", "needs/toneed_" + String(a.itemId || ""), "settings/crewPTO"] };
    case "crew.assign": case "crew.unassign": case "crew.setLead": return { ...base, mode: "edit" };   // a planner cell: before null = the cell was empty (an empty cell is the planner's own delete of the key)
    case "punch.setDone": return { ...base, mode: "setDone" };
    case "rtPunch.add": return { ...base, mode: "tripPunchAdd", closing: "the added trip punch items taken back off the trip (only while every one is untouched — Koy's call, 2026-11-06)" };
    case "rtPunch.setDone": case "rtPunch.waiting": case "rtPunch.editText": return { ...base, mode: "tripPunchItem" };
    case "punch.void": return { ...base, mode: "voidRestore", closing: "item restored (cc_void_punch_item restore:true — the app's own pair; stripped QC-Fail trip clones are not re-added, as the app's restore doesn't)" };
    case "punch.restore": return { ...base, mode: "voidRestore", closing: "item voided again with its old reason (cc_void_punch_item)" };
    default:
      if (STAGE_LIKE.test(a.action) && Array.isArray(a.fields) && a.fields.includes("returnTrips")) return refuse("That call also made or extended a return trip (the inspection / QC verdict's trip) — the app has no take-back for a trip, so the whole call stays. Set the status again with the same tool and mark the trip complete (cc_update_return_trip). Nothing was written.");
      if (!Array.isArray(a.fields) || !a.fields.length) return refuse("That audit record lists no fields — nothing to put back.");
      if (a.before === null || a.before === undefined || a.newDoc) return refuse("That call created a record Duet has no closing move for. Nothing was written.");
      return { ...base, mode: "edit" };
  }
}

// ── 2. plan the writes against the live doc(s) ───────────────────────────────
// live: { "coll/id": raw doc (the envelope with .data where the app keeps one) | null }
// ctx:  { nowIso, tz, todayYmd, bucketNow, users }
// → {refused, diff?} | { writes:[…], fields:[names], before:{…}, after:{…}, itemId, closing?, notes:[…], result:{…} }
// writes: {kind:"jobPatch", jobId, fields}          fields: data.<k> → value | {__delete:true}
//         {kind:"needPatch", needId, fields, arrayUnion?: {updates: entry}}
//         {kind:"projectPatch", projectId, fields}
//         {kind:"settingsCell", docId, key, cell|null, missing}
//         {kind:"settingsList", docId, listKey, list, pipelineStamp}
//         {kind:"timeOff", plan}                      (api replays timeOffDecide's three writes)
function planUndo(audit, cls, live, ctx) {
  const a = audit;
  const raw = live[cls.coll + "/" + cls.docId] || null;
  const notes = [];
  const out = (writes, fields, before, after, extra) => ({ writes, fields, before, after, itemId: a.itemId || null, closing: cls.closing || null, notes, ...(extra || {}) });

  // ── jobs ──
  if (cls.coll === "jobs") {
    const job = raw && raw.data ? { id: cls.docId, data: raw.data } : null;
    if (!job) return refuse(`Job ${cls.docId} is no longer in Command Center. Nothing was written.`);
    const d = job.data;
    if (d.deleted) return refuse(`${d.name || "That job"} is marked deleted — Duet never touches deleted jobs. Nothing was written.`);
    if ((d.archived || d.archivedAt) && a.action !== "job.archive" && !(cls.mode === "closing" && /archived/.test(cls.closing || ""))) return refuse(`${d.name || "That job"} is archived — bring it back first (cc_archive_job archived:false). Nothing was written.`);
    const c = { ...ctx, job };
    const jobPatch = (fields) => ({ kind: "jobPatch", jobId: job.id, fields });

    if (cls.mode === "tripPunchAdd" || cls.mode === "tripPunchItem") {
      const p = cls.mode === "tripPunchAdd" ? TP.planUndoAdd(a, d, same) : TP.planUndoItem(a, d, same);
      if (p.refused) return p;
      return out([jobPatch(p.fields)], Object.keys(p.fields), p.before, p.after, { itemId: p.itemId, result: p.result });
    }

    if (cls.mode === "closing") {
      switch (a.action) {
        case "co.create": {
          const pre = itemCheck(d.changeOrders, a.itemId, a.after && a.after.changeOrders, "changeOrders"); if (pre.refused) return pre;
          const p = JI.planSetCOStatus({ coId: a.itemId, status: "denied" }, c); if (p.refused) return p;
          if (p.noop) return refuse("That change order already reads denied. Nothing was written.");
          return out([jobPatch({ changeOrders: p.changeOrders })], ["changeOrders"], { changeOrders: pre.item }, { changeOrders: p.co }, { result: { coId: a.itemId, coStatus: "denied", pushTo: [] } });
        }
        case "rt.create": case "inspection.createTrip": {
          const pre = itemCheck(d.returnTrips, a.itemId, a.after && a.after.returnTrips, "returnTrips"); if (pre.refused) return pre;
          const p = JI.planUpdateRT({ rtId: a.itemId, rtStatus: "complete" }, c); if (p.refused) return p;
          if (p.noop) return refuse("That return trip already reads complete. Nothing was written.");
          return out([jobPatch({ returnTrips: p.returnTrips })], ["returnTrips"], { returnTrips: pre.item }, { returnTrips: p.rt }, { result: { rtId: a.itemId, rtStatus: "complete", pushTo: [] } });
        }
        case "note.add": {
          const pre = itemCheck(d.jobNotes, a.itemId, a.after && a.after.jobNotes, "jobNotes"); if (pre.refused) return pre;
          const p = NU.planDeleteNote({ noteId: a.itemId }, c); if (p.refused) return p;
          if (a.after && a.after.jobNotesMigratedAt) notes.push("The job's legacy notes were migrated into the new format by that call; the migration stamp stays (it is real data now).");
          return out([jobPatch(p.fields)], ["jobNotes"], { jobNotes: pre.item }, { jobNotes: p.note }, { result: { noteId: a.itemId, deleted: true, softDelete: true, pushTo: [] } });
        }
        case "note.addLine": {
          const pre = itemCheck(d.jobNotes, a.itemId, a.after && a.after.jobNotes, "jobNotes"); if (pre.refused) return pre;
          const lineId = a.response && a.response.body && a.response.body.lineId;
          if (!lineId) return refuse("That audit record doesn't name the line it added. Nothing was written.");
          const p = NU.planEditLine({ noteId: a.itemId, lineId, text: "" }, c); if (p.refused) return p;
          if (p.noop) return refuse("That line is already blank. Nothing was written.");
          return out([jobPatch(p.fields)], ["jobNotes"], { jobNotes: pre.item }, { jobNotes: p.note }, { result: { noteId: a.itemId, lineId, text: "", pushTo: [] } });
        }
        case "job.createFromSimpro": case "project.createBuilding": {
          if (d.archived || d.archivedAt) return refuse(`${d.name || "That job"} is already archived. Nothing was written.`);
          const p = JSU.planArchive({ archived: true, force: true }, c); if (p.refused) return p;
          if (p.noop) return refuse(`${d.name || "That job"} already reads archived. Nothing was written.`);
          if (a.action === "job.createFromSimpro") notes.push(`The Simpro inbox entry (#${a.candidateRemoved || d.simproNo || "?"}) is not put back — the app lists it again on its next Simpro pull only if the job is still open there.`);
          return out([jobPatch(p.fields)], Object.keys(p.fields), p.before, p.after, { result: { archived: true, archivedBy: ME, openWork: p.result && p.result.openWork, pushTo: [] } });
        }
        default: return refuse("No closing move is defined for that action. Nothing was written.");
      }
    }

    if (cls.mode === "setDone" || cls.mode === "voidRestore") {
      const treeKey = Object.keys(a.after || {}).find(k => TREE_KEYS[k]);
      if (!treeKey) return refuse("That audit record names no punch tree. Nothing was written.");
      const phase = TREE_KEYS[treeKey];
      const loc = PU.locate(d[treeKey] && typeof d[treeKey] === "object" && !Array.isArray(d[treeKey]) ? d[treeKey] : null, a.itemId);
      if (!loc) return refuse(`No ${phase} punch item with id ${a.itemId} on ${d.name || "that job"} any more. Nothing was written.`);
      const diffs = [];
      if (!same(loc.item, a.after[treeKey])) diffs.push(diffOf(treeKey + " item " + a.itemId, loc.item, a.after[treeKey]));
      const slotKey = Object.keys(a.after).find(k => k.startsWith("punchTicks."));
      if (slotKey) { const cur = getPath(d, slotKey); if (!same(cur, a.after[slotKey])) diffs.push(diffOf(slotKey, cur, a.after[slotKey])); }
      if (Array.isArray(a.after.returnTrips)) {
        for (const e of a.after.returnTrips) {
          const rt = (Array.isArray(d.returnTrips) ? d.returnTrips : []).find(t => t && String(t.id) === String(e.rtId));
          const cur = rt && Array.isArray(rt.punch) ? rt.punch.find(p => p && String(p.id) === String(e.entry && e.entry.id)) : undefined;
          if (!same(cur, e.entry)) diffs.push(diffOf(`returnTrips #${e.rtId} entry ${e.entry && e.entry.id}`, cur, e.entry));
        }
      }
      if (diffs.length) return changedSince(diffs);
      let p;
      if (cls.mode === "setDone") p = PU.planSetDone({ phase, itemId: a.itemId, done: !!(a.before && a.before[treeKey] && a.before[treeKey].done) }, c);
      else if (a.action === "punch.void") p = PU.planRestore({ phase, itemId: a.itemId }, c);
      else p = PU.planVoid({ phase, itemId: a.itemId, reason: (a.before && a.before[treeKey] && a.before[treeKey].voidReason) || UNDO_REASON }, c);
      if (p.refused) return p;
      if (p.noop) return refuse("That item already reads the way it was before. Nothing was written.");
      if (a.action === "punch.void" && Array.isArray(a.after.returnTrips) && a.after.returnTrips.length) notes.push("The QC-Fail trip clones that void stripped are NOT re-added (the app's restore doesn't either).");
      return out([jobPatch(p.fields)], Object.keys(p.fields), p.before, p.after, { result: { ...(p.result || {}), pushTo: [] } });
    }

    // edit: replay `before` field by field
    const fields = {}, before = {}, after = {}, diffs = [];
    for (const k of a.fields) {
      const exp = a.after ? a.after[k] : undefined, prev = a.before ? a.before[k] : undefined;
      if (k.startsWith("punchTicks.")) return refuse("A check-off slot is only put back through a done / undone replay. Nothing was written.");
      if (TREE_KEYS[k]) {
        if (!a.itemId) return refuse("That audit record names a punch tree but no item. Nothing was written.");
        const tree = d[k] && typeof d[k] === "object" && !Array.isArray(d[k]) ? d[k] : null;
        const loc = PU.locate(tree, a.itemId);
        if (!loc) return refuse(`No punch item with id ${a.itemId} on ${d.name || "that job"}'s ${TREE_KEYS[k]} list any more. Nothing was written.`);
        if (!same(loc.item, exp)) { diffs.push(diffOf(k + " item " + a.itemId, loc.item, exp)); continue; }
        if (prev === null || prev === undefined) return refuse("That call added the punch item — " + NO_TAKE_BACK["punch.add"] + " Nothing was written.");
        const floor = PU.normFloor(tree[loc.floorKey]);
        const swap = (list) => list.map((x, i) => (i === loc.index ? prev : x));
        const newFloor = loc.roomId === "general" ? { ...floor, general: swap(floor.general) } : loc.roomId === "hotcheck" ? { ...floor, hotcheck: swap(floor.hotcheck) } : { ...floor, rooms: floor.rooms.map(r => (r && String(r.id) === loc.roomId ? { ...r, items: swap(Array.isArray(r.items) ? r.items : []) } : r)) };
        fields[k] = PU.rebuildTree(tree, loc.floorKey, newFloor); before[k] = loc.item; after[k] = prev;
        continue;
      }
      if (ITEM_ARRAYS.has(k) && a.itemId) {
        const arr = Array.isArray(d[k]) ? d[k] : [];
        const i = arr.findIndex(x => x && String(x.id) === String(a.itemId));
        if (i < 0) return refuse(`No ${k} item with id ${a.itemId} on ${d.name || "that job"} any more. Nothing was written.`);
        if (!same(arr[i], exp)) { diffs.push(diffOf(k + " item " + a.itemId, arr[i], exp)); continue; }
        if (prev === null || prev === undefined) return refuse(`That call added the ${k} item — there is no closing move for it from here. Nothing was written.`);
        fields[k] = arr.map((x, j) => (j === i ? prev : x)); before[k] = arr[i]; after[k] = prev;
        continue;
      }
      if (QUESTION_MAPS.has(k) && a.itemId) {
        const phase = k === "roughQuestions" ? "rough" : "finish";
        const f = QS.findQuestion(job, phase, a.itemId);
        if (!f) return refuse(`No ${phase} question with id ${a.itemId} on ${d.name || "that job"} any more. Nothing was written.`);
        if (!same(f.q, exp)) { diffs.push(diffOf(k + " question " + a.itemId, f.q, exp)); continue; }
        if (prev === null || prev === undefined) return refuse(NO_TAKE_BACK["question.add"] + " Nothing was written.");
        fields[k] = { ...f.qs, [f.floor]: f.list.map((x, j) => (j === f.index ? prev : x)) }; before[k] = f.q; after[k] = prev;
        continue;
      }
      // a scalar / whole-value field (a dotted key such as panelizedLighting.noKeypadLoads included)
      const cur = getPath(d, k);
      if (!same(cur, exp)) { diffs.push(diffOf(k, cur, exp)); continue; }
      fields[k] = put(prev); before[k] = cur === undefined ? null : cur; after[k] = prev === undefined ? null : prev;
    }
    if (diffs.length) return changedSince(diffs);
    if (!Object.keys(fields).length) return refuse("Nothing to put back. Nothing was written.");
    return out([jobPatch(fields)], Object.keys(fields), before, after, { result: { pushTo: [] } });
  }

  // ── needs ──
  if (cls.coll === "needs") {
    const current = raw && raw.data ? raw.data : null;
    if (!current) return refuse(`Task ${cls.docId} is no longer in Command Center. Nothing was written.`);
    if (cls.mode === "closing") {
      // task.create / a promoted auto task → the app's void (never a delete)
      const exp = a.after || {};
      const diffs = Object.keys(exp).filter(k => !same(current[k], exp[k])).map(k => diffOf(k, current[k], exp[k]));
      if (diffs.length) return changedSince(diffs);
      if (current.voided === true) return refuse("That task is already voided. Nothing was written.");
      const patch = { status: "done", doneAt: ctx.nowIso, doneBy: ME, voided: true, voidedBy: ME, voidedAt: ctx.nowIso, voidReason: UNDO_REASON };
      const fields = NS.needPatch(patch, current, ME, ctx.nowIso, ctx.bucketNow);
      const entry = { by: ME, at: ctx.nowIso, kind: "void", text: UNDO_REASON };
      const before = {}, after = {}; Object.keys(fields).forEach(k => { before[k] = current[k] === undefined ? null : current[k]; after[k] = fields[k]; });
      after.updatesAdded = entry;
      Object.keys(current).filter(k => !(k in exp)).forEach(k => notes.push(`${k} was added to the task since; it stays.`));
      return out([{ kind: "needPatch", needId: cls.docId, fields, arrayUnion: { updates: entry } }], Object.keys(fields).concat(["updates"]), before, after, { result: { needId: cls.docId, status: "done", voided: true, voidReason: UNDO_REASON, pushTo: [] } });
    }
    const fields = {}, before = {}, after = {}, diffs = [];
    let kept = 0;
    for (const k of a.fields) {
      if (k === "updates" || k === "photos") { kept++; notes.push(`The ${k === "updates" ? "note" : "photo"} that call added stays — those can't be taken back; add another ${k === "updates" ? "note" : "photo"} if needed.`); continue; }
      const exp = a.after ? a.after[k] : undefined, prev = a.before ? a.before[k] : undefined;
      if (!same(current[k], exp)) { diffs.push(diffOf(k, current[k], exp)); continue; }
      fields[k] = put(prev); before[k] = current[k] === undefined ? null : current[k]; after[k] = prev === undefined ? null : prev;
    }
    if (diffs.length) return changedSince(diffs);
    if (!Object.keys(fields).length) return refuse(kept ? "That call only added a note / photo — those can't be taken back; add another note. Nothing was written." : "Nothing to put back. Nothing was written.");
    return out([{ kind: "needPatch", needId: cls.docId, fields }], Object.keys(fields), before, after, { result: { needId: cls.docId, pushTo: [] } });
  }

  // ── projects ──
  if (cls.coll === "projects") {
    const current = raw && raw.data ? raw.data : null;
    if (!current) return refuse(`Project ${cls.docId} is no longer in Command Center. Nothing was written.`);
    const fields = {}, before = {}, after = {}, diffs = [];
    for (const k of a.fields) {
      const exp = a.after ? a.after[k] : undefined, prev = a.before ? a.before[k] : undefined;
      if (!same(current[k], exp)) { diffs.push(diffOf(k, current[k], exp)); continue; }
      fields[k] = put(prev); before[k] = current[k] === undefined ? null : current[k]; after[k] = prev === undefined ? null : prev;
    }
    if (diffs.length) return changedSince(diffs);
    if (!Object.keys(fields).length) return refuse("Nothing to put back. Nothing was written.");
    return out([{ kind: "projectPatch", projectId: cls.docId, fields }], Object.keys(fields), before, after, { result: { projectId: cls.docId, pushTo: [] } });
  }

  // ── settings ──
  if (cls.coll === "settings") {
    if (cls.mode === "timeOff") {
      const reqDoc = live["settings/timeOffRequests"] || null;
      const requests = reqDoc && Array.isArray(reqDoc.list) ? reqDoc.list : null;
      const r = requests ? requests.find(x => x && x.id === a.itemId) : null;
      const expReq = a.after && a.after.request;
      if (!r) return refuse(`No time-off request with id ${a.itemId} any more. Nothing was written.`);
      if (!same(r, expReq)) return changedSince([diffOf("timeOffRequests.list#" + a.itemId, r, expReq)]);
      const wasStatus = (a.before && a.before.request && a.before.request.status) || "pending";
      const needRaw = live["needs/toneed_" + a.itemId] || null;
      const ptoDoc = live["settings/crewPTO"] || null;
      const p = TO.planDecide({ id: a.itemId, status: wasStatus, force: true }, { ...ctx, requests, need: needRaw && needRaw.data ? needRaw.data : null, pto: ptoDoc ? ptoDoc.list : null });
      if (p.refused) return p;
      if (p.noop) return refuse(`That request already reads ${wasStatus}. Nothing was written.`);
      notes.push(`Put back through the app's own force path: the request shows decidedBy Koy with today's stamp (the Undo bar in the app would have kept the original decider).`);
      return out([{ kind: "timeOff", plan: p, needRaw, reqDoc, ptoDoc }], ["timeOffRequests.list"].concat(p.needFields ? Object.keys(p.needFields).map(k => "needs/toneed_" + a.itemId + ".data." + k) : []).concat(p.ptoList ? ["crewPTO.list"] : []), p.before, p.after, { result: { id: a.itemId, status: wasStatus, from: expReq && expReq.status, pushTo: p.pushTo || [] } });
    }
    if (/^schedule_/.test(cls.docId)) {
      const field = (a.fields || [])[0] || "";
      if (!field.startsWith("assignments.")) return refuse("That audit record names no planner cell. Nothing was written.");
      const key = field.slice("assignments.".length);
      const week = raw;
      const cur = week && week.assignments && typeof week.assignments === "object" && week.assignments[key] && typeof week.assignments[key] === "object" ? week.assignments[key] : null;
      const exp = a.after === undefined ? null : a.after;
      if (!same(cur, exp)) return changedSince([diffOf(field, cur, exp)]);
      const prev = a.before === undefined ? null : a.before;
      if (!week && !prev) return refuse("Nothing to put back — the week doc doesn't exist and the cell was empty. Nothing was written.");
      return out([{ kind: "settingsCell", docId: cls.docId, key, cell: prev, missing: !week }], [field], { [field]: cur }, { [field]: prev }, { result: { key, cell: prev, cellDeleted: !prev, pushTo: [] } });
    }
    const listKey = cls.docId === "upcoming_jobs" ? "items" : cls.docId === "crewTeams" ? "teams" : cls.docId === "crewRoster" ? "names" : null;
    if (!listKey) return refuse(`settings/${cls.docId} isn't a list Duet puts back. Nothing was written.`);
    const list = raw && Array.isArray(raw[listKey]) ? raw[listKey] : [];
    const listWrite = (next, before, after, result) => out([{ kind: "settingsList", docId: cls.docId, listKey, list: next, pipelineStamp: cls.docId === "upcoming_jobs", missing: !raw }], [cls.docId + "." + listKey].concat(cls.docId === "upcoming_jobs" ? [cls.docId + ".updated_at"] : []), before, after, { result: { ...result, listNow: next.length, pushTo: [] } });
    if (cls.docId === "crewRoster") {
      const added = a.response && a.response.body && a.response.body.added;
      const name = added ? a.after : a.before;
      if (!name) return refuse("That audit record names nobody. Nothing was written.");
      if (added ? !list.includes(name) : list.includes(name)) return changedSince([diffOf("crewRoster.names", list.includes(name), added)]);
      const p = OF.planCrewRoster({ op: added ? "remove" : "add", name }, { ...ctx, names: list }); if (p.refused) return p;
      if (p.noop) return refuse("The roster already reads the way it was before. Nothing was written.");
      return listWrite(p.names, { names: added ? name : null }, { names: added ? null : name }, { name, [added ? "removed" : "added"]: true });
    }
    if (cls.docId === "crewTeams") {
      const i = list.findIndex(t => t && String(t.id) === String(a.itemId));
      if (i < 0) return refuse(`No crew team with id ${a.itemId} any more. Nothing was written.`);
      if (!same(list[i], a.after)) return changedSince([diffOf("crewTeams.teams#" + a.itemId, list[i], a.after)]);
      if (cls.mode === "closing") {
        const p = OF.planCrewTeams({ op: "remove", teamId: a.itemId }, { ...ctx, teams: list }); if (p.refused) return p;
        return listWrite(p.teams, { teams: list[i] }, { teams: null }, { teamId: a.itemId, removed: true });
      }
      const prev = a.before;
      if (!prev || typeof prev !== "object") return refuse("That audit record has no earlier team to put back. Nothing was written.");
      return listWrite(list.map((t, j) => (j === i ? prev : t)), { teams: list[i] }, { teams: prev }, { teamId: a.itemId, team: prev });
    }
    // upcoming_jobs: upcoming.edit — before / after are the changed fields of ONE row
    const i = list.findIndex(x => x && String(x.id) === String(a.itemId));
    if (i < 0) return refuse(`No Upcoming row with id ${a.itemId} any more. Nothing was written.`);
    const row = list[i], exp = a.after || {}, prev = a.before || {};
    const diffs = Object.keys(exp).filter(k => !same(row[k], exp[k])).map(k => diffOf("upcoming_jobs.items#" + a.itemId + "." + k, row[k], exp[k]));
    if (diffs.length) return changedSince(diffs);
    const next = { ...row }; Object.keys(prev).forEach(k => { if (prev[k] === null || prev[k] === undefined) delete next[k]; else next[k] = prev[k]; });
    const before = {}, after = {}; Object.keys(exp).forEach(k => { before[k] = row[k] === undefined ? null : row[k]; after[k] = prev[k] === undefined ? null : prev[k]; });
    return listWrite(list.map((x, j) => (j === i ? next : x)), before, after, { itemId: a.itemId, changed: Object.keys(exp) });
  }

  return refuse(`${cls.coll} isn't a collection Duet puts back from here. Nothing was written.`);
}

// ONE array item by id must still read what the audit's `after` says.
function itemCheck(arr, itemId, expected, field) {
  const list = Array.isArray(arr) ? arr : [];
  const item = list.find(x => x && String(x.id) === String(itemId));
  if (!item) return refuse(`No ${field} item with id ${itemId} any more. Nothing was written.`);
  if (!same(item, expected)) return changedSince([diffOf(field + " item " + itemId, item, expected)]);
  return { item };
}

module.exports = { UNDO_REASON, SENDS, NO_TAKE_BACK, TREE_KEYS, ITEM_ARRAYS, QUESTION_MAPS, same, norm, getPath, classify, planUndo, itemCheck };
