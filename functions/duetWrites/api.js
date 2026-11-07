"use strict";
// duetApi — Claude Duet's only door into Command Center for WRITES (connector
// decision D9, 2026-11-03). The Homestead connector (Vercel) calls this with a
// bearer secret; this function does every read and write, through the same
// shapes and rules the app's own save funnels use. The connector's Google
// account stays Cloud Datastore Viewer.
//
// Guardrails, enforced here on every call (plan §3, docs/DUET-WRITES-PLAN.md
// in the connector repo):
//   • collections: jobs (update only: one item in changeOrders / returnTrips,
//     or the statusUpdate scalar — ship 2; a photo on one item — ship 3; one
//     question in roughQuestions / finishQuestions, one note in jobNotes (+
//     the jobNotesMigratedAt stamp), one entry in roughUpdates /
//     finishUpdates — ship 4; one punch item in roughPunch / finishPunch /
//     qcPunch + its punchTicks.<id> slot + linked returnTrips entries —
//     ship 6; the phase status / stage / schedule-date scalars, the two
//     inspection results + attempts + items (+ linked returnTrips entries), the
//     QC status / date + qcRtChoice stamps (+ the QC return trip), the prep
//     checklist maps — ship 7; a return trip's OWN punch list — rtPunch.add
//     appends a batch of 1–25 trip-only entries, rtPunch.setDone / waiting /
//     editText change ONE entry, all in data.returnTrips — tripPunch.js), needs (create + update; a photo — ship 3),
//     homeowner_requests/<jobId> (ship 4: the questionThreads.<key> field
//     ONLY — one appended message — plus its versions subcollection, where
//     the writer's own snapshot is added and pruned to 10 exactly as the
//     app's snapshotHomeownerRequestVersion does). Ship 5 adds the first
//     settings docs, each limited to ONE field, listed in SETTINGS_DOCS below
//     and nowhere else: settings/schedule_<Monday YYYY-MM-DD> (the
//     `assignments` map — one cell per call, the FieldValue delete sentinel on the cell
//     when it empties, the planner's own rule), settings/timeOffRequests (the
//     `list` — one entry by id), settings/crewPTO (the `list` — one mirror entry
//     by timeoffId), settings/crewTeams (READ ONLY, team expansion), and
//     needs/toneed_<id> (the head's board task for a request: status / doneBy /
//     doneAt / timeoffDecision through the shared needShape patch). Any other
//     settings doc — settings/users above all — is refused before any read:
//     io.settingsRef throws on an id outside SETTINGS_DOCS. Storage: one object
//     under the app's own jobs/<id>/… photo folders (ship 3), deleted again
//     only when its own transaction failed. Never a delete of data, never a
//     job create, never anything else. The ONLY deletes anywhere in this file
//     are that Storage cleanup, the versions prune, and the planner's own
//     empty-cell the FieldValue delete sentinel (a map key, not a doc).
//   • one item per call; transaction, read-modify-write by id
//   • names checked against settings/users (active, not contractor)
//   • idempotent: duet_writes/<requestId> is the audit doc AND the replay key
//   • 60 writes per rolling hour
//   • audit doc written in the SAME transaction as the change, with the
//     before/after of every field touched (undo material)
//
// Stamp: every write carries the version-lock stamp (integer app_build + a
// fresh w) so versionLock.js counts it as a stamped server write, saved_by
// "Duet (Koy)" for the ledgers and Koy's tripwire push, a non-browser tab so
// no open job tab mistakes it for its own echo, and updated_at strictly newer
// than the doc's (the simproPull freshIso lesson).
// Ship 2 (change orders, return trips, status update): every job write is a
// transaction on jobs/<id> that re-reads the doc, changes ONE item by id in
// data.changeOrders / data.returnTrips (or the statusUpdate scalar), and
// writes that whole array back as a dotted key — what the app's three-way
// merge produces for a baseline that IS the live doc. The app's client-only
// FieldInk mirror (publishCcChangeOrders → cccos) does not run for these
// (plan 9b, accepted); onJobUpdate's pushes (co_new, co_approved,
// rt_assigned) and the versions snapshot fire on their own.
// Ship 3 (photo.add): the first Storage write. The bytes are checked by magic
// number and capped at 7 MB, the item is located on the live doc FIRST (so a
// missing trip never leaves an orphan file), the object is saved to the same
// Storage folder the app's own uploader uses for that item with a Firebase
// download token, and ONE transaction re-reads the doc, appends the entry to
// that item's photos[] and audits — entry under `after`, never the bytes. If
// the transaction refuses or fails after the upload, the just-uploaded object
// (and only that object) is deleted again.
// Ship 4 (questions, job notes, daily updates): nine more job writes through
// the same jobWrite() transaction — QAList.addQuestion / My Day's Save answer
// and Done / the QAList un-tick on one question found by id across the three
// floors; addNote / addLine / a line edit / archive / soft delete on one job
// note, with the app's own migration materialized (functions/jobNotesShape.js,
// a byte copy of src/jobNotesShape.js) and jobNotesMigratedAt stamped the
// first time, exactly as JobDetail u() does; DailyUpdates.add prepended — and
// ONE write on homeowner_requests/<jobId> (question.reply) copying
// postQuestionThreadMessage: the thread key "<phase>_<floor>_<qid>", a
// first-ever doc set, otherwise the one dotted questionThreads.<key> updated,
// then the versions snapshot pruned to 10. Answers go through the app's own
// escapeHtml (functions/escapeHtml.js, a byte copy of src/escapeHtml.js).
// Ship 5 (crews, job people, time off): crew.assign / crew.unassign /
// crew.setLead copy the Crew Planner's assignPerson / unassignPerson /
// assignTeam / crewToggleLead onto ONE cell of settings/schedule_<Monday>
// (the date resolved to its Monday + weekday, Mon–Fri only; a missing week doc
// created with the app's own first-write shape); job.setPeople is one
// foreman / lead / coordinator scalar through jobWrite(), "Unassigned" the
// app's foreman sentinel; timeOff.decide makes TimeOffPage.decide's three
// writes in ONE transaction — the request entry by id in
// settings/timeOffRequests.list, the head's needs/toneed_<id> through the
// shared needShape patch (skipped when missing, as the app does), the PTO
// mirror in settings/crewPTO.list added once on approve and pulled otherwise —
// and refuses to change a decided request without force:true. The app's own
// triggers (job_assigned / lead_assigned, onTimeOffDecision) push on their own.
// Ship 6 (punch items): seven more jobWrite() actions, all on ONE item of ONE
// punch tree (data.roughPunch / finishPunch / qcPunch) found by id across
// upper / main / basement / extras floors and general / hotcheck / rooms, the
// tree written back whole in the app's own handleFloorChange shape (every
// floor normalized, extras kept). punch.setDone flips exactly as the checkbox
// does AND writes the item's own check-off slot data.punchTicks.<id> (derived
// by the app's punchTickPatches — the slot is the record of truth) AND, for
// rough / finish, mirrors the flip onto linked return-trip entries as
// handlePhasePunchChange does — all in the one transaction. punch.add appends
// commitAdd's item (text through the app's escapeHtml, Mountain-time YMD
// stamp), creating a room when the name is new and fanning that room out
// EMPTY to the other phase as fanOutAddedRooms does; punch.assign / waiting /
// editText patch one field set; punch.void (QC-walk items only, reason
// required) strips the item's clones from open QC-Fail trips in the same
// write, punch.restore clears the four void fields. Never a delete of an item.
// Ship 7 (phase status, stage, inspections, QC, prep, schedule dates): eight
// more jobWrite() actions, each the app's own handler on the job's scalar
// fields (functions/duetWrites/stages.js, line for line): phase.setStatus is
// the STATUS select's exact patch (OnHold / Scheduled / StartConfirmed rule /
// StatusDate / DepositDismissed + rough's Matterport and QC flips on the first
// complete; complete refused while the phase's punch — slots applied — has
// open items); phase.setStage runs the app's OWN stageChangePlan
// (src/stageChange.js, byte-copied to functions/stageChange.js) and writes
// every derived field it returns; inspection.setResult is Pass / Fail / clear
// + the attempt literal, and Failed again (repeat:true) while it reads failed;
// inspection.items adds a failed item or ticks one (rough mirrors done onto
// returnTrips[].punch[] entries with fromRoughInspectionId); inspection
// .createTrip is the → Create Return Trip literal (or → Add N to the open
// trip); qc.setStatus is runQcVerdict's base patch with a required then:
// rt | crew on fail / passed_items (the QC trip from qcTripPlan's items, the
// qcRtChoice<P> / By / At stamps); prep.tick writes both prep maps whole
// (prepItemPatch); phase.setDates is the schedule-window modal, the PROJ.
// START input (+ waiting_date) and the CONFIRM button. None of these fields
// are on the versions WATCH list, so the audit doc's before is the only undo:
// every field written, derived ones included, is in before / after.
// Ship 8 (material cards + the PO sender — the FIRST action in this plan that
// can email a vendor): material.addCard / editCard / tick are three more
// jobWrite() actions on ONE card of data.roughMaterials / finishMaterials /
// commMaterials (functions/duetWrites/materials.js: + Add PO's literal, the
// add-material helpers' newest-open-card append, the field writers, the
// checkbox literals; receipts never). material.previewPo is a READ that runs
// ONLY the pure rules of functions/materialPO/rules.js plus gc_config/
// material_po (mode, testTo, bids, liveAccess) and gc_config/mail.soakTo —
// never the mail key — and, live only, one Simpro GET for the vendor's email;
// it audits a hash of supplier + lines + mode + pickup + CC + recipients.
// material.sendPo requires confirmPreviewId: a previewPo audit for the same
// job + card under 15 minutes old whose hash still matches; refuses in mode
// off; is capped at 10 per rolling hour on its own counter; then runs the app's
// OWN sendMaterialPO (functions/materialPO/send.js, the same factory index.js
// exports, with requireMember replaced by Koy's settings/users record — the
// bearer already proves it's Koy; clientTest:false ONLY when the mode is live,
// so a test-mode send goes to the test inbox with [TEST] exactly as the app's)
// and, after it answers, writes the send sheet's own card patch through
// jobWrite() with the send result (poNo, mode, recipients — never the key) in
// the audit. The sender itself writes material_po_log/<job>_<phase>_<card> as
// it always has. Never retried: a timeout answer says to check the log / the
// card first (a PO may exist). sendMaterialOrder (the CED catalog order) is
// NOT reachable from here.
// Ship 9 (job setup — the first and only whole-doc CREATES in this plan):
// job.createFromSimpro is importSimproCandidate line for line — the candidate
// read from settings/simproCandidates.candidates by Simpro id, j =
// stampDivision(blankJob() | blankQuickJob()) from the SHARED
// functions/jobShape.js (a byte copy of src/jobShape.js, so every default a
// phone's "+ New" writes is here too), the import stamps, data.id = the doc id,
// written with tx.create (a second write to that id fails the transaction) +
// the app's {data, updated_at} envelope + this stamp, and the candidates list
// rewritten without that one in the same transaction (the ONLY write on
// settings/simproCandidates: its `candidates` field — SETTINGS_DOCS). A live
// job already carrying that Simpro # refuses (simproNoConflict). project.create
// (the project literal, tx.create on projects/<id> + the source job's Site /
// Shared patch, one tx), project.patch (dotted data.<k>: simproNo / notes /
// archived*), project.createBuilding (createBuilding's rules, tx.create),
// project.join (the four-field patch); job.setInfo (ONE Job Info scalar;
// simproNo conflict-checked; division "" as the patch funnel writes it; the
// running-contact slots composed from gcRunningToggle's taps), job.setSection
// (jobSectionPatch + the legacy flag, the panelizedLighting flag as ONE dotted
// key), job.archive (Duet's reversible shape — the app has NO archive handler:
// {archived, archivedAt, archivedBy}, never `deleted`; refuses on open punch /
// COs / trips without force:true). New collection row: projects (create +
// dotted update, never delete). jobs now includes CREATE for the import and a
// building only. ensureJobDriveFolder (onWrite) only LINKS a Drive folder a
// person already made — it never creates one — and the commercial Drive chain
// is the app's own client-side follow-up, not run here.
//
// Ship 10 (office): broadcast.send runs the app's OWN sendBroadcastAs
// (functions/index.js — the sendBroadcast callable's body factored out of its
// onCall, two callers, never a copy) in-process as Koy's settings/users record
// once ND.isBroadcaster says that record would pass requireBroadcaster; it
// writes broadcasts/<id> and every recipient's notifications/<key>/items/<nid>
// through deliver() exactly as the app's Send does — new collection rows:
// broadcasts (create via that body only), notifications/*/items (via deliver
// only). The audit keeps title length / kind / label / recipient count + ids /
// delivery summary, never the message body; 10 sends per rolling hour.
// autoTask.promote is My Day's Push: autoTaskDoc's literal (App.js's text,
// pinned verbatim) with saveNeed's envelope through tx.create, or — when an
// open need already carries that autoTaskId (autoDelegation's rule) —
// pushTo's patch through the shared needPatch; the auto rows themselves are
// App.js's computeTasks (not lifted), so Duet names the row's id suffix,
// checked against the engine's id catalog (pinned to App.js). planIntake.decide
// runs the plan-intake watcher's OWN decideById (the /decide route's body,
// factored into one function with two callers) with the exact body the Routine
// posts plus by: "Koy (via Duet)" — new rows: agentQueue (the item's status /
// decision / decidedAt via that route only), agentFindings (decide()'s own
// create / resolve), planIntakeState (decide()'s md5_ / sender_ / walk_ /
// quote_ docs), plus the Drive move decide() makes. upcoming.add / .edit,
// crewTeams.set, crewRoster.set are three more settings lists in
// SETTINGS_DOCS (upcoming_jobs.items + the pipeline's updated_at,
// crewTeams.teams — now written —, crewRoster.names), each ONE item changed
// and the list written back whole with the settings stamp. No promote (a job
// create with photos — out), no attachments on a send.
//
// Ship 11 (any allowed field + undo — the last of the plan, closes batch C):
// job.setField writes ONE scalar data.<key> on a job through jobWrite(), ONLY
// for a key fieldPolicy.js classes "allow" (notes, flags, two inspection
// target dates, My Day's dismissed booleans — decision 9d: Koy approves the
// rows in the connector's docs/DUET-WRITES-FIELDS.md before batch C goes
// live); a key a named tool owns refuses with that tool's name, every other
// key (ids, stamps, caches, arrays, maps, derived fields, finance / sign-off
// flags) refuses with the reason, an unknown key refuses too. Values are
// validated per row (bool strict, text ≤ 2000 with control characters
// stripped, dates → M/D/YYYY as DateInp stores them) and "" clears as the app
// does; same value → noop. undo.apply reads an earlier duet_writes/<id> and
// puts the change back from its `before` (functions/duetWrites/undo.js):
// edits are replayed exactly and ONLY while every field still reads the
// audit's `after` (one item by id for array fields; a done flip goes back
// through planSetDone so the slot and the cascade follow); adds are undone by
// the app's own closing move (task → done + voided, CO → denied, trip →
// complete, note → soft-deleted, line → "", team / roster name → removed or
// re-added, imported job / building → archived) or refused where the app has
// none (question, daily update, punch item, material card, CO → trip,
// Upcoming row, project); sends (PO, announcement, plan-intake decision,
// thread reply, photo) are refused. The undo is its own audit doc with
// `undoes` and stamps the original with {undoneBy, undoneAt} in the SAME
// transaction — the only write ever made to an existing duet_writes doc, and
// never a delete. Archived jobs refuse unless the original was the archive.
//
// Ship 12 (the any-document door — Koy 2026-11-06: "I just want it to be able
// to do anything that I say to do"): eight DOC_ACTIONS (anyDoc.js) reach any
// top-level Command Center document by collection and id — doc.set ONE dotted
// path, doc.append / patchItem / removeItem ONE list item by id (the whole
// array written back, as every ship does), doc.create (tx.create; a jobs doc
// starts from the shared blankJob() defaults), doc.markDeleted (the three
// keys), doc.delete (tx.delete — the FIRST hard delete of a document in this
// file, jobs / needs / suggestions only, the typed docId as the confirm word,
// refused above 900 KB, the whole doc kept in the audit so undo can create it
// back), and team.edit (ONE person in settings/users.list, patched or
// appended, never a shorter list, through usersRef() — the only path to that
// doc — with the app's saveUsers envelope {list, updated_at, saved_by,
// device:"duet"} so open tabs' stale guard sees a real edit). The target check
// runs BEFORE any read: the NEVER list (duet_writes, recovery_ledger,
// claude_activity, claude_reports, errors, material_po_log, orgauth,
// crewtokens, crewroster, crewdevices, gc_config/mail, settings/users outside
// team.edit), subcollections, bad ids / paths, non-JSON values, the confirm
// words (doc.delete → the docId; gc_config/material_po, settings/appGate,
// config/app → the docId on every op; team.edit → the person's name after the
// edit). On jobs a doc.set whose top key a named tool owns (fieldPolicy.js)
// refuses naming that tool; the id / cache keys stay denied; the rest of the
// DENY list is reachable. Envelope by collection kind: jobs → jobWrite's;
// needs / projects → stamp(); settings / plain → whichever stamp key the doc
// already carries (anyDoc.stampFor). homeowner_requests writes snapshot the
// prior doc (snapshotHrVersion) as question.reply does. Same transaction,
// same audit doc, same 60 / hour, undo through undo.apply (undo.js's anyDoc
// classes: put back while the doc still reads the audit's after; a hard
// delete is created back from `before` while the id is free; a plain create
// is deleted while the doc still equals `after`; a data create is marked
// deleted; a team add is deactivated).
const crypto = require("crypto");
const { planCreateTask, planUpdateTask, isDuplicate } = require("./needs.js");
const JI = require("./jobItems.js");
const PH = require("./photos.js");
const QS = require("./questions.js");
const NU = require("./notesUpdates.js");
const CR = require("./crew.js");
const TO = require("./timeOff.js");
const PU = require("./punch.js");
const SG = require("./stages.js");
const MA = require("./materials.js");
const JSU = require("./jobSetup.js");
const OF = require("./office.js");
const FP = require("./fieldPolicy.js");
const UN = require("./undo.js");
const TP = require("./tripPunch.js");
const AD = require("./anyDoc.js");
const { matchUserByName } = require("../nameMatch.js");

const SECRET = "DUET_WRITE_TOKEN";
const BUILD = 618;                 // SW version this shipped with; integer for the version-lock stamp
const SAVED_BY = "Duet (Koy)";
const RATE_PER_HOUR = 60;
const SEND_PO_PER_HOUR = 10;       // ship 8: material.sendPo has its own, stricter counter on top of the 60
const BROADCAST_PER_HOUR = 10;     // ship 10: broadcast.send too — a team-wide push is the loudest thing this door can do
const AUDIT = "duet_writes";
const QUESTION_ACTIONS = ["question.add", "question.answer", "question.reopen"];
const NOTE_ACTIONS = ["note.add", "note.addLine", "note.editLine", "note.archive", "note.delete", "dailyUpdate.add"];
const PEOPLE_ACTIONS = ["job.setPeople"];
const PUNCH_ACTIONS = ["punch.setDone", "punch.add", "punch.assign", "punch.waiting", "punch.void", "punch.restore", "punch.editText"];
const RT_PUNCH_ACTIONS = ["rtPunch.add", "rtPunch.setDone", "rtPunch.waiting", "rtPunch.editText"];   // a return trip's own punch list (tripPunch.js): ONE jobWrite() on data.returnTrips
const STAGE_ACTIONS = ["phase.setStatus", "phase.setStage", "inspection.setResult", "inspection.items", "inspection.createTrip", "qc.setStatus", "prep.tick", "phase.setDates"];
const JOB_ACTIONS = ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"];
const MATERIAL_CARD_ACTIONS = ["material.addCard", "material.editCard", "material.tick"];
const FIELD_ACTIONS = ["job.setField"];   // ship 11: ONE allowed scalar (fieldPolicy.js) through jobWrite()
const JOB_WRITE_ACTIONS = [...JOB_ACTIONS, ...QUESTION_ACTIONS, ...NOTE_ACTIONS, ...PEOPLE_ACTIONS, ...PUNCH_ACTIONS, ...RT_PUNCH_ACTIONS, ...STAGE_ACTIONS, ...MATERIAL_CARD_ACTIONS, ...FIELD_ACTIONS];   // every action that is ONE jobWrite() transaction
const PHOTO_ACTIONS = ["photo.add"];
const THREAD_ACTIONS = ["question.reply"];
const CREW_ACTIONS = ["crew.assign", "crew.unassign", "crew.setLead"];
const TIMEOFF_ACTIONS = ["timeOff.decide"];
const MATERIAL_PO_ACTIONS = ["material.previewPo", "material.sendPo"];   // ship 8: preview = read + audit; sendPo = the real sender, then ONE jobWrite()
const JOB_SETUP_ACTIONS = ["job.createFromSimpro", "job.setInfo", "job.setSection", "job.archive", "project.create", "project.patch", "project.createBuilding", "project.join"];   // ship 9: jobSetup() — its own transaction (extra reads: candidates, projects, siblings, Simpro-# conflicts; tx.create for the creates)
const OFFICE_ACTIONS = ["broadcast.send", "autoTask.promote", "planIntake.decide", "upcoming.add", "upcoming.edit", "crewTeams.set", "crewRoster.set"];   // ship 10: office() — the app's own sendBroadcastAs / decideById in-process, a needs create-or-patch, three settings lists
const UNDO_ACTIONS = ["undo.apply"];   // ship 11: undoApply() — an earlier duet_writes doc replayed from its `before` through the same writers
const AC = require("./activity.js");
const ACTIVITY_ACTIONS = AC.ACTIVITY_ACTIONS;   // v613: the Claude tab's log (claude_activity) — not a Command Center change: no duet_writes audit, no undo, not in the hourly limit
const RP = require("./reports.js");
const REPORT_ACTIONS = RP.REPORT_ACTIONS;       // v616: Reports in the Claude tab (claude_reports) — like the log: no duet_writes audit, no undo, not in the hourly limit; the report doc itself is the record
const DOC_ACTIONS = AD.DOC_ACTIONS;             // ship 12: anyDocWrite() — any top-level document through the one door (anyDoc.js: the policy + the planners)
const ACTIONS = ["task.create", "task.update", ...JOB_WRITE_ACTIONS, ...PHOTO_ACTIONS, ...THREAD_ACTIONS, ...CREW_ACTIONS, ...TIMEOFF_ACTIONS, ...MATERIAL_PO_ACTIONS, ...JOB_SETUP_ACTIONS, ...OFFICE_ACTIONS, ...UNDO_ACTIONS, ...ACTIVITY_ACTIONS, ...REPORT_ACTIONS, ...DOC_ACTIONS];
const NEED_ID = /^need_[0-9]+_[a-z0-9]{3,8}$|^toneed_/;
const JOB_ID = /^\d{10,15}$/;
const RID = /^[A-Za-z0-9_-]{8,64}$/;
const SCHEDULE_DOC = /^schedule_\d{4}-\d{2}-\d{2}$/;

// The ONLY settings docs this function may open, and the one field it may write
// on each (plan §3 item 1, ship 5 rows; ship 9 adds simproCandidates — the
// Simpro inbox list, read for the import and rewritten without the imported
// one). Ship 10 adds the office lists: crewTeams now WRITES its `teams`
// (crewTeams.set — one team added / edited / removed from the list),
// crewRoster its `names` (one name), upcoming_jobs its `items` + the pipeline's
// own `updated_at` (one row added / edited). Anything else — settings/users
// above all — is refused before any read. Edited only with a row in the plan.
const SETTINGS_DOCS = { timeOffRequests: ["list"], crewPTO: ["list"], crewTeams: ["teams"], simproCandidates: ["candidates"], crewRoster: ["names"], upcoming_jobs: ["items", "updated_at"] };
function settingsDocFields(id) {
  const s = String(id || "");
  if (Object.prototype.hasOwnProperty.call(SETTINGS_DOCS, s)) return SETTINGS_DOCS[s];
  if (SCHEDULE_DOC.test(s)) return ["assignments"];
  return null;
}
const settingsDocAllowed = (id) => settingsDocFields(id) !== null;

class Refusal extends Error { constructor(status, why) { super(why); this.status = status; } }

function tokenOk(req) {
  const want = String(process.env[SECRET] || "");
  const got = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (want.length < 32 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function freshIso(prevIso) {
  // Strictly after the doc's own updated_at, so an open tab re-seeds instead of
  // keeping an older baseline (functions/materialPO/simproPull.js, same rule).
  let t = Date.now();
  const prev = Date.parse(prevIso || "");
  if (!isNaN(prev) && t <= prev) t = prev + 1;
  return new Date(t).toISOString();
}
function stamp(requestId, updatedAt) {
  return { updated_at: updatedAt, saved_by: SAVED_BY, device: "duet", tab: `duet-${String(requestId).slice(0, 8)}`, app_build: BUILD, w: `${BUILD}.duet${Math.random().toString(36).slice(2, 10)}` };
}

// The app's sanitize(): drop undefined values before a Firestore write.
function dropUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(dropUndefined);
  if (obj && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, dropUndefined(v)]));
  return obj;
}

// io: { nowIso(), todayYmd(), getAudit(id), countRecent(sinceIso), getJob(id), getUsers(),
//       openNeeds({jobId, assignedTo}), runTx(fn), needRef(id), jobRef(id), auditRef(id),
//       arrayUnion(...x), serverTimestamp(), rand(), tz }

// One job write, the same way for every ship-2 action: re-read the job in the
// transaction, plan against the live copy, write the dotted data.<field> keys
// with the job envelope the app's saveJob patch carries (updated_at strictly
// newer, lastActivityAt, saved_by / device / tab, version-lock stamp,
// merged:false) and the audit doc in the same transaction. `plan(job)` returns
// {refused} | {noop, result} | {fields:{<field>: value}, before:{<field>: value},
// after:{<field>: value}, itemId, result:{...}}.
async function jobWrite(io, requestId, action, jobId, plan, finish) {
  let out = null;
  await io.runTx(async (tx) => {
    const snap = await tx.get(io.jobRef(jobId));
    const raw = snap && snap.exists ? snap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const p = plan(job);
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, coll: "jobs", docId: jobId }); tx.set(io.auditRef(requestId), out.audit); return; }
    if (p.noop) { out = finish(200, { ok: true, requestId, action, jobId, jobName: job.data.name || "", noop: true, message: "Already that way — nothing to change.", ...(p.result || {}) }, { ok: true, noop: true, coll: "jobs", docId: jobId, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(raw.updated_at);
    const upd = { ...stamp(requestId, updatedAt), lastActivityAt: io.serverTimestamp(), merged: false };
    Object.keys(p.fields).forEach(k => { upd["data." + k] = p.fields[k]; });
    tx.update(io.jobRef(jobId), upd);
    const result = { ok: true, requestId, action, jobId, jobName: job.data.name || "", ...p.result };
    out = finish(200, result, { ok: true, coll: "jobs", docId: jobId, fields: Object.keys(p.fields), itemId: p.itemId || null, before: p.before, after: p.after, ...(p.audit || {}) });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return out;
}

// Each ship-2 planner → the fields to write + what to audit and answer.
// Audits keep the ONE item before/after (not the whole array): that is the
// undo material, and photos make arrays big.
function planJobAction(action, args, ctx) {
  return (job) => {
    const c = { ...ctx, job };
    switch (action) {
      case "co.create": {
        const p = JI.planCreateCO(args, c); if (p.refused) return p;
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: null }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, desc: p.co.desc, coStatus: p.co.coStatus, createdBy: p.co.createdBy, pushTo: ["foreman", "coordinator", "Jeromy"] } };
      }
      case "co.edit": {
        const p = JI.planEditCO(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { coId: p.co.id } };
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: p.before }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, changed: p.changed } };
      }
      case "co.setStatus": {
        const p = JI.planSetCOStatus(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { coId: p.co.id, coStatus: p.co.coStatus } };
        return { fields: { changeOrders: p.changeOrders }, before: { changeOrders: p.before }, after: { changeOrders: p.co }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, from: p.from, to: p.to, coStatusDate: p.co.coStatusDate, changed: p.changed, pushTo: p.to === "approved" ? ["lead", "foreman", "coordinator"] : [] } };
      }
      case "co.convert": {
        const p = JI.planConvertCO(args, c); if (p.refused) return p;
        return { fields: { changeOrders: p.changeOrders, returnTrips: p.returnTrips }, before: { changeOrders: p.before, returnTrips: null }, after: { changeOrders: p.co, returnTrips: p.rt }, itemId: p.co.id,
          result: { coId: p.co.id, number: p.number, rtId: p.rt.id, rtNumber: p.returnTrips.length, scope: p.rt.scope, photosCarried: p.rt.photos.length } };
      }
      case "rt.create": {
        const p = JI.planCreateRT(args, c); if (p.refused) return p;
        return { fields: { returnTrips: p.returnTrips }, before: { returnTrips: null }, after: { returnTrips: p.rt }, itemId: p.rt.id,
          result: { rtId: p.rt.id, number: p.number, scope: p.rt.scope, rtStatus: p.rt.rtStatus || "", rtStatusDate: p.rt.rtStatusDate || "", assignedTo: p.rt.assignedTo || "", pushTo: p.rt.assignedTo && p.rt.assignedTo !== "Unassigned" ? p.rt.assignedTo : null } };
      }
      case "rt.update": {
        const p = JI.planUpdateRT(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { rtId: p.rt.id } };
        return { fields: { returnTrips: p.returnTrips }, before: { returnTrips: p.before }, after: { returnTrips: p.rt }, itemId: p.rt.id,
          result: { rtId: p.rt.id, number: p.number, changed: p.changed, rtStatus: p.rt.rtStatus || "", rtStatusDate: p.rt.rtStatusDate || "", assignedTo: p.rt.assignedTo || "", pushTo: p.pushTo } };
      }
      case "job.setStatusUpdate": {
        const p = JI.planSetStatusUpdate(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { statusUpdate: p.statusUpdate } };
        return { fields: p.fields, before: p.before, after: { ...p.fields }, result: { statusUpdate: p.fields.statusUpdate, statusUpdateBy: p.fields.statusUpdateBy, changed: p.changed, historyLength: Array.isArray(p.fields.statusUpdateHistory) ? p.fields.statusUpdateHistory.length : undefined } };
      }
      // ── Ship 4 ─────────────────────────────────────────────────────────────
      case "question.add": {
        const p = QS.planAddQuestion(args, c); if (p.refused) return p;
        return { fields: { [p.field]: p.questions }, before: { [p.field]: null }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, question: p.q.question, for: p.q.for, room: p.q.room || "", pushTo: ["foreman", "coordinator"] } };
      }
      case "question.answer": {
        const p = QS.planAnswerQuestion(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { qId: p.q.id, floor: p.floor, number: p.number, done: true } };
        return { fields: { [p.field]: p.questions }, before: { [p.field]: p.before }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, changed: p.changed, done: p.q.done, answeredBy: p.q.answeredBy || "", answeredVia: p.q.answeredVia || "", pushTo: [] } };
      }
      case "question.reopen": {
        const p = QS.planReopenQuestion(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { qId: p.q.id, floor: p.floor, number: p.number, done: false } };
        return { fields: { [p.field]: p.questions }, before: { [p.field]: p.before }, after: { [p.field]: p.q }, itemId: p.q.id,
          result: { qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, changed: p.changed, done: false, gcRejected: !!p.patch.gcRejected, pushTo: [] } };
      }
      case "note.add": {
        const p = NU.planAddNote(args, c); if (p.refused) return p;
        const stamped = Object.prototype.hasOwnProperty.call(p.fields, "jobNotesMigratedAt");
        return { fields: p.fields, before: { jobNotes: null, ...(stamped ? { jobNotesMigratedAt: null } : {}) }, after: { jobNotes: p.note, ...(stamped ? { jobNotesMigratedAt: p.fields.jobNotesMigratedAt } : {}) }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.note.lines[0].id, number: p.number, title: p.note.title, phase: p.note.phase, migratedLegacyNotes: p.migrated, notesOnJob: p.fields.jobNotes.length, pushTo: [] } };
      }
      case "note.addLine": {
        const p = NU.planAddLine(args, c); if (p.refused) return p;
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.line.id, number: p.number, lines: p.note.lines.length, pushTo: [] } };
      }
      case "note.editLine": {
        const p = NU.planEditLine(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { noteId: p.note.id, lineId: p.line.id, number: p.number } };
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, lineId: p.line.id, number: p.number, text: p.line.text, pushTo: [] } };
      }
      case "note.archive": {
        const p = NU.planArchiveNote(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { noteId: p.note.id, number: p.number, archived: !!p.note.archived } };
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, number: p.number, archived: !!p.note.archived, pushTo: [] } };
      }
      case "note.delete": {
        const p = NU.planDeleteNote(args, c); if (p.refused) return p;
        return { fields: p.fields, before: { jobNotes: p.before }, after: { jobNotes: p.note }, itemId: p.note.id,
          result: { noteId: p.note.id, number: p.number, deleted: true, softDelete: true, promotedLinesKept: p.promotedLines, pushTo: [] } };
      }
      case "dailyUpdate.add": {
        const p = NU.planAddDailyUpdate(args, c); if (p.refused) return p;
        return { fields: { [p.field]: p.updates }, before: { [p.field]: null }, after: { [p.field]: p.entry }, itemId: p.entry.id,
          result: { updateId: p.entry.id, phase: args.phase, date: p.entry.date, number: p.number, text: p.entry.text, pushTo: ["coordinator"] } };
      }
      // ── Ship 5 ─────────────────────────────────────────────────────────────
      case "job.setPeople": {
        // u({foreman}) / u({lead}) / u({coordinator}): ONE scalar; onJobUpdate's
        // job_assigned / lead_assigned pushes follow on their own.
        const p = CR.planSetPeople(args, c); if (p.refused) return p;
        if (p.noop) return { noop: true, result: { field: p.field, [p.field]: p.name } };
        return { fields: p.fields, before: p.before, after: p.after,
          result: { field: p.field, from: p.from, to: p.to, [p.field]: p.to, pushTo: p.pushTo } };
      }
      // ── Ship 6 ─────────────────────────────────────────────────────────────
      // Each planner already answers in jobWrite's shape ({refused} | {noop,
      // result} | {fields, before, after, itemId, result}); the fields are the
      // whole tree as data.<phase>Punch, plus data.punchTicks.<id> (the slot,
      // dotted — never the whole map) and data.returnTrips when a done flip
      // cascaded or a void stripped clones. Audits keep the ONE item (and the
      // touched trip entries) before / after, never the tree.
      case "punch.setDone": return PU.planSetDone(args, c);
      case "punch.add": return PU.planAdd(args, c);
      case "punch.assign": return PU.planAssign(args, c);
      case "punch.waiting": return PU.planWaiting(args, c);
      case "punch.void": return PU.planVoid(args, c);
      case "punch.restore": return PU.planRestore(args, c);
      case "punch.editText": return PU.planEditText(args, c);
      // ── A return trip's own punch list ─────────────────────────────────────
      // data.returnTrips written back whole with ONE trip's punch array changed
      // (the trip card's upd(t.id, {punch})). rtPunch.add: a batch appended in
      // one transaction, the trip before / after in the audit + addedIds (the
      // undo's material). The other three: ONE entry before / after.
      case "rtPunch.add": return TP.planAdd(args, c);
      case "rtPunch.setDone": return TP.planSetDone(args, c);
      case "rtPunch.waiting": return TP.planWaiting(args, c);
      case "rtPunch.editText": return TP.planEditText(args, c);
      // ── Ship 7 ─────────────────────────────────────────────────────────────
      // Scalar fields on the job (status / stage / inspection / QC / prep /
      // dates) in the app's own patch shapes, plus returnTrips when an
      // inspection or QC verdict makes or extends a trip. Each planner answers
      // in jobWrite's shape; before / after hold EVERY field written (none of
      // these are versioned by the app — this audit is the undo).
      case "phase.setStatus": return SG.planSetPhaseStatus(args, c);
      case "phase.setStage": return SG.planSetStage(args, c);
      case "inspection.setResult": return SG.planSetInspection(args, c);
      case "inspection.items": return SG.planInspectionItems(args, c);
      case "inspection.createTrip": return SG.planCreateInspectionTrip(args, c);
      case "qc.setStatus": return SG.planSetQcStatus(args, c);
      case "prep.tick": return SG.planTickPrep(args, c);
      case "phase.setDates": return SG.planSetScheduleDates(args, c);
      // ── Ship 8 ─────────────────────────────────────────────────────────────
      // ONE material card on ONE of the three lists, the list written back
      // whole as data.<list> (what the app's u({<list>}) does); before / after
      // hold the ONE card. material.sendPo's card patch runs through jobWrite()
      // too, from materialPo() below, after the real sender has answered.
      case "material.addCard": return MA.planAddCard(args, c);
      case "material.editCard": return MA.planEditCard(args, c);
      case "material.tick": return MA.planTick(args, c);
      // ── Ship 11 ────────────────────────────────────────────────────────────
      // ONE allowed scalar (fieldPolicy.js) as a dotted data.<key>; owned /
      // denied / unknown keys refuse before anything is planned.
      case "job.setField": return FP.planSetField(args, c);
      default: return { refused: "unknown action" };
    }
  };
}

// Ship 4: ONE reply on a question's discussion thread — postQuestionThreadMessage
// line for line, on homeowner_requests/<jobId> (never the job doc: the Kweller
// rule for outside-party data). The job is read in the same transaction only
// to find the question (its floor is part of the key); the thread doc is read
// under lock, the one dotted questionThreads.<key> written (a first-ever doc
// is set whole, as the app does), the audit doc rides along, and AFTER the
// write the app's versions snapshot is taken and pruned to 10 — best effort,
// never blocking, exactly snapshotHomeownerRequestVersion's fail-open.
async function threadReply(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "homeowner_requests" });
  let out = null, prevDoc = null, wrote = false;
  await io.runTx(async (tx) => {
    const jsnap = await tx.get(io.jobRef(jobId));
    const raw = jsnap && jsnap.exists ? jsnap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const p = QS.planThreadReply(args, { ...ctx, job });
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, coll: "homeowner_requests", docId: jobId }); tx.set(io.auditRef(requestId), out.audit); return; }
    const hsnap = await tx.get(io.hrRef(jobId));
    prevDoc = hsnap && hsnap.exists ? hsnap.data() : null;
    const w = QS.threadAppend(prevDoc, jobId, p.key, p.msg);
    if (w.set) tx.set(io.hrRef(jobId), w.set); else tx.update(io.hrRef(jobId), w.update);
    wrote = true;
    const result = { ok: true, requestId, action, jobId, jobName: job.data.name || "", qId: p.q.id, phase: args.phase, floor: p.floor, number: p.number, key: p.key, messageId: w.msg.id, messagesInThread: w.count, role: w.msg.role, newThreadDoc: !!w.set, pushTo: [] };
    out = finish(200, result, { ok: true, coll: "homeowner_requests", docId: jobId, itemId: p.q.id, fields: ["questionThreads." + p.key], before: { questionThreads: { [p.key]: { messages: w.before } } }, after: { questionThreads: { [p.key]: w.msg } }, newDoc: !!w.set });
    tx.set(io.auditRef(requestId), out.audit);
  });
  if (wrote) {
    let snapped = false;
    try { snapped = await io.snapshotHrVersion(jobId, prevDoc, "duet", ctx.nowIso); } catch (e) { snapped = false; }
    out.body.versionSnapshot = snapped;
  }
  return { status: out.status, body: out.body };
}
// Ship 3: ONE photo onto ONE item. Order matters for "never an orphan file":
//   1. bytes checked (magic number, 7 MB, name cleaned) — nothing read yet;
//   2. the live doc is read and the item located (missing / archived /
//      signed-off / converted / voided refuse here, before any upload);
//   3. the object is saved under the app's own folder for that item with a
//      Firebase download token → the app's download URL;
//   4. ONE transaction re-reads the doc, locates the item again, appends the
//      entry to its photos[] (job: whole array / punch tree as the dotted
//      field with the job envelope; task: ONE arrayUnion on data.photos like
//      addNeedPhotos) and writes the audit doc with the entry under `after`;
//   5. a refusal inside the transaction, or any failure after the upload,
//      deletes the object just written — and only that object.
// args: { target: rt|co|punch|task, jobId (not for task), itemId, name, data (base64) }
async function photoAdd(io, requestId, args, ctx, finish, refused) {
  const target = String(args.target || "");
  if (!PH.TARGETS.includes(target)) return refused(400, `target must be one of ${PH.TARGETS.join(", ")}.`, { coll: target === "task" ? "needs" : "jobs" });
  const coll = target === "task" ? "needs" : "jobs";
  const itemId = String(args.itemId || "");
  let docId;
  if (target === "task") {
    if (!NEED_ID.test(itemId)) return refused(400, "itemId must be the task's needId (need_…).", { coll });
    docId = itemId;
  } else {
    docId = String(args.jobId || "");
    if (!JOB_ID.test(docId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(itemId)) return refused(400, "itemId must be the item's id (from cc_list_return_trips, cc_list_change_orders or cc_get_job punch).", { coll });
  }
  const photo = PH.decodePhoto(args);
  if (photo.refused) return refused(400, photo.refused, { coll, docId });

  // Locate on the live doc before uploading anything.
  const ref = target === "task" ? io.needRef(docId) : io.jobRef(docId);
  const raw0 = await io.readDoc(ref);
  const doc0 = raw0 && raw0.data ? { id: docId, data: raw0.data } : null;
  const loc = PH.locate(target, itemId, doc0);
  if (loc.refused) return refused(doc0 ? 400 : 404, loc.refused, { coll, docId, itemId });
  const nowMs = Date.parse(ctx.nowIso);
  const photoId = PH.newPhotoId(target, nowMs, loc.photos.map(p => p && p.id), ctx.rand);
  const storagePath = `${loc.folder}/${photoId}.${photo.ext}`;
  const token = io.newToken();
  const url = await io.putObject(storagePath, photo.buf, photo.type, token);
  const entry = PH.photoEntry(target, { photoId, name: photo.name, url, storagePath, type: photo.type, nowIso: ctx.nowIso });
  const auditBase = { coll, docId, itemId, storagePath, bytes: photo.size, contentType: photo.type };

  let out = null;
  try {
    await io.runTx(async (tx) => {
      const snap = await tx.get(ref);
      const raw = snap && snap.exists ? snap.data() : null;
      const doc = raw && raw.data ? { id: docId, data: raw.data } : null;
      const p = PH.planAttach(target, itemId, entry, doc);
      if (p.refused) { out = finish(doc ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase, cleanedUp: true }); out.cleanup = true; tx.set(io.auditRef(requestId), out.audit); return; }
      const updatedAt = freshIso(raw.updated_at);
      const result = { ok: true, requestId, action: "photo.add", target, itemId, photoId, name: photo.name, type: photo.type, bytes: photo.size, storagePath, photosOnItem: p.photosNow, on: p.label };
      if (p.kind === "need") {
        // addNeedPhotos: stampWrite({ updated_at, saved_by, "data.photos": arrayUnion(entry) }) — never the whole array.
        tx.update(ref, { ...stamp(requestId, updatedAt), "data.photos": io.arrayUnion(entry) });
        Object.assign(result, { needId: docId, jobId: p.jobId });
        out = finish(200, result, { ok: true, ...auditBase, fields: ["photos"], before: p.before, after: p.after });
      } else {
        const upd = { ...stamp(requestId, updatedAt), lastActivityAt: io.serverTimestamp(), merged: false };
        Object.keys(p.fields).forEach(k => { upd["data." + k] = p.fields[k]; });
        tx.update(ref, upd);
        Object.assign(result, { jobId: docId, jobName: doc.data.name || "", field: p.field, number: p.number });
        out = finish(200, result, { ok: true, ...auditBase, fields: Object.keys(p.fields), before: p.before, after: p.after });
      }
      tx.set(io.auditRef(requestId), out.audit);
    });
  } catch (e) {
    await io.deleteObject(storagePath).catch(() => {});
    throw e;
  }
  if (out.cleanup) await io.deleteObject(storagePath).catch(() => {});
  return { status: out.status, body: out.body };
}

// The app's settings stamp (mergeSaveSettingsFields): {updatedAt, tab, merged}.
// A missing doc is set with the fields plus the stamp, exactly as the app does.
function settingsStamp(requestId, updatedAt) { return { updatedAt, tab: `duet-${String(requestId).slice(0, 8)}`, merged: false }; }

// Ship 5: ONE Crew Planner cell. In one transaction: the job (live, must exist
// and not be archived), the week doc settings/schedule_<Monday>, crewTeams when
// a team is named (read only) and crewPTO (read only — the planner refuses a
// person who is off that day). The planner's mutator runs against the live
// cell; the write is that ONE cell as FieldPath("assignments", key) — the cell
// object, or the FieldValue delete sentinel when unassigning emptied it (unassignPerson's
// `delete nx[k]`) — plus the settings stamp. A week doc that doesn't exist yet
// is created as {assignments:{[key]:cell}, …stamp}, the shape the app's first
// _saveCrewData gives it. Nothing else on the doc is read into the write.
async function crewCell(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "settings" });
  const op = action.slice("crew.".length);
  const date = args.date == null || args.date === "" ? ctx.todayYmd : String(args.date);
  const wk = CR.weekFor(date);
  if (wk.refused) return refused(400, wk.refused, { coll: "settings" });
  if (!settingsDocAllowed(wk.docId)) return refused(400, "That week isn't a Crew Planner week.", { coll: "settings" });
  let out = null;
  await io.runTx(async (tx) => {
    const jsnap = await tx.get(io.jobRef(jobId));
    const raw = jsnap && jsnap.exists ? jsnap.data() : null;
    const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
    const wsnap = await tx.get(io.settingsRef(wk.docId));
    const week = wsnap && wsnap.exists ? wsnap.data() : null;
    let teams = null;
    if (args.team != null && args.team !== "") { const ts = await tx.get(io.settingsRef("crewTeams")); teams = ts && ts.exists ? ((ts.data() || {}).teams || []) : []; }
    const ps = await tx.get(io.settingsRef("crewPTO"));
    const pto = ps && ps.exists ? ((ps.data() || {}).list || []) : [];
    const p = CR.planCrewCell({ ...args, op, date }, { ...ctx, job, week, teams, pto });
    const auditBase = { coll: "settings", docId: wk.docId, jobId, key: p.key || CR.cellKey(jobId, wk.dayIdx), date, monday: wk.monday, dayIdx: wk.dayIdx };
    if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const common = { requestId, action, jobId, jobName: job.data.name || "", week: wk.monday, day: wk.label, date, key: p.key, people: p.people, team: p.team || undefined };
    if (p.noop) { out = finish(200, { ok: true, ...common, noop: true, message: (p.result && p.result.message) || "Already that way — nothing to change.", cell: p.before }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(week ? week.updatedAt : "");
    const st = settingsStamp(requestId, updatedAt);
    if (!week) {
      if (!p.cell) { out = finish(200, { ok: true, ...common, noop: true, message: "Nobody is on that cell.", cell: null }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
      tx.set(io.settingsRef(wk.docId), { assignments: { [p.key]: p.cell }, ...st });
    } else {
      tx.update(io.settingsRef(wk.docId), io.fieldPath("assignments", p.key), p.cell ? p.cell : io.deleteField(), "updatedAt", st.updatedAt, "tab", st.tab, "merged", st.merged);
    }
    const result = { ok: true, ...common, cell: p.cell, cellDeleted: !!p.deleted, role: p.role || undefined, previousLead: p.previousLead || undefined, skippedOff: p.skippedOff && p.skippedOff.length ? p.skippedOff : undefined, newWeekDoc: !week, pushTo: [] };
    out = finish(200, dropUndefined(result), { ok: true, ...auditBase, fields: ["assignments." + p.key], before: p.before, after: p.cell, cellDeleted: !!p.deleted, newDoc: !week });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Ship 5: ONE time-off decision — TimeOffPage.decide's three writes in ONE
// transaction (all three docs live in this project). Reads first: the request
// list, the head's board task needs/toneed_<id>, the PTO list. Then: the list
// written back whole with the one entry changed (+ settings stamp); the need's
// dotted data.<k> keys through the shared patch with the job-style envelope
// (skipped silently when the doc is missing, as the app's catch does); the
// PTO list written back only when it changed (set with the stamp when the doc
// doesn't exist yet, as mergeSaveSettingsFields does). onTimeOffDecision sends
// the requester's push from the list diff on its own.
async function timeOffDecide(io, requestId, action, args, ctx, finish, refused) {
  const id = String(args.id || "").trim();
  if (!/^to_[a-z0-9]{6,24}$/i.test(id)) return refused(400, "id must be the request's id from cc_list_time_off (to_…).", { coll: "settings", docId: "timeOffRequests" });
  const needId = "toneed_" + id;
  let out = null;
  await io.runTx(async (tx) => {
    const rs = await tx.get(io.settingsRef("timeOffRequests"));
    const reqDoc = rs && rs.exists ? rs.data() : null;
    const ns = await tx.get(io.needRef(needId));
    const needRaw = ns && ns.exists ? ns.data() : null;
    const need = needRaw && needRaw.data ? needRaw.data : null;
    const ps = await tx.get(io.settingsRef("crewPTO"));
    const ptoDoc = ps && ps.exists ? ps.data() : null;
    const p = TO.planDecide(args, { ...ctx, requests: reqDoc ? (Array.isArray(reqDoc.list) ? reqDoc.list : []) : null, need, pto: ptoDoc ? ptoDoc.list : null });
    const auditBase = { coll: "settings", docId: "timeOffRequests", itemId: id, docs: ["settings/timeOffRequests", "needs/" + needId, "settings/crewPTO"] };
    if (p.refused) { out = finish(400, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const common = { requestId, action, id, name: p.request.name || "", start: p.request.start || "", end: p.request.end || p.request.start || "", status: p.request.status };
    if (p.noop) { out = finish(200, { ok: true, ...common, noop: true, message: p.result.message }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    // (a) the request list
    const st = settingsStamp(requestId, freshIso(reqDoc.updatedAt));
    tx.update(io.settingsRef("timeOffRequests"), { list: p.requestsList, ...st });
    // (b) the head's board task — patchNeed's write: stampWrite({updated_at, saved_by, "data.<k>": v})
    if (p.needFields) {
      const upd = { ...stamp(requestId, freshIso(needRaw.updated_at)) };
      Object.keys(p.needFields).forEach(k => { upd["data." + k] = p.needFields[k]; });
      tx.update(io.needRef(needId), upd);
    }
    // (c) the PTO mirror
    if (p.ptoList) {
      if (ptoDoc) tx.update(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, freshIso(ptoDoc.updatedAt)) });
      else tx.set(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, ctx.nowIso) });
    }
    const result = { ok: true, ...common, from: p.from, decidedBy: p.request.decidedBy, decidedAt: p.request.decidedAt, needUpdated: !!p.needFields, needStatus: p.needFields ? p.needFields.status : null, ptoAdded: !!p.ptoAdded, ptoRemoved: p.ptoRemoved, usePaid: p.request.usePaid !== false, pushTo: p.pushTo };
    const fields = ["timeOffRequests.list"].concat(p.needFields ? Object.keys(p.needFields).map(k => "needs/" + needId + ".data." + k) : []).concat(p.ptoList ? ["crewPTO.list"] : []);
    out = finish(200, result, { ok: true, ...auditBase, fields, before: p.before, after: p.after, needMissing: !need });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Ship 8: the PO preview and the PO send. Neither is a plain jobWrite():
//   previewPo — reads the job (plain read, no lock: nothing is written but the
//   audit), the PO config (mode / testTo / bids / liveAccess — soakTo is the
//   only thing read from gc_config/mail), the card's material_po_log doc
//   (already sent?) and, LIVE only, the vendor's and Koy's emails from Simpro
//   (GETs), then runs the pure rules and audits the preview with its hash.
//   sendPo   — refuses without a fresh, matching previewPo audit for this job +
//   card (confirmPreviewId), refuses in mode off, counts its own 10 / hour,
//   resolves Koy's settings/users record (the bearer proves it's Koy; the
//   sender's gate still checks admin in test / liveAccess in live), then calls
//   the app's OWN sendMaterialPO handler in-process (io.sendPo) with
//   clientTest:false ONLY in live mode. A refusal from the sender is answered
//   as is and audited (no card write). After a PO answer, ONE jobWrite() puts
//   the send sheet's patch on the card; the audit carries the send result
//   (poNo, kind, mode, costCenter, emailOk, emailedTo, again) — never the key.
async function materialPo(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "jobs" });
  const cardId = String(args.cardId || "");
  const raw0 = await io.readDoc(io.jobRef(jobId));
  const job = raw0 && raw0.data ? { id: jobId, data: raw0.data } : null;
  const cfg = await io.loadPoCfg();
  const koy = matchUserByName(ctx.users, "Koy");
  const koyUser = koy.user && !koy.ambiguous ? koy.user : null;
  const koyAccess = koyUser ? io.accessOf(koyUser) : "";
  const auditBase = { coll: "jobs", docId: jobId, itemId: cardId || null };
  const loc = job ? MA.findCard(job.data, cardId) : null;
  const clean = loc ? MA.cleanSendArgs(args, loc.card, loc.phase) : null;
  const rule = clean && !clean.refused ? clean.rule : null;
  const log = loc ? await io.readPoLog(jobId, loc.phase, cardId) : null;
  let vendorEmail = "", senderEmail = "";
  if (rule && rule.kind === "email" && cfg.mode === "live") {
    try { vendorEmail = await io.vendorEmail(rule.simproName); } catch (e) { vendorEmail = ""; }
    try { senderEmail = koyUser ? await io.senderEmail(koyUser.name) : ""; } catch (e) { senderEmail = ""; }
  }
  const p = MA.planPreview(args, { ...ctx, job }, cfg, { koyAccess, vendorEmail, senderEmail, log });
  if (p.refused) return refused(job ? 400 : 404, p.refused, auditBase);
  if (!koyUser) return refused(400, "Koy isn't on the active team list, so the sender has nobody to send as. Nothing was sent.", auditBase);

  if (action === "material.previewPo") {
    const body = { ok: true, requestId, action, jobId, jobName: job.data.name || "", previewId: requestId, ...p.preview, koyAccess, pushTo: [] };
    const r = finish(200, body, { ok: true, ...auditBase, read: true, fields: [], preview: { hash: p.hash, key: p.key, kind: p.preview.kind, supplier: p.preview.supplier, mode: cfg.mode, lineCount: p.preview.lineCount, recipients: p.preview.recipients, alreadySent: p.preview.alreadySent, canSend: p.preview.canSend } });
    await io.runTx(async (tx) => { tx.set(io.auditRef(requestId), r.audit); });
    return { status: 200, body };
  }

  // material.sendPo
  const previewId = String(args.confirmPreviewId || "");
  if (!RID.test(previewId)) return refused(400, "confirmPreviewId must be the previewId from cc_preview_material_po. Preview first, show Koy, then send. Nothing was sent.", auditBase);
  if (cfg.mode === "off") return refused(400, "Sending POs from the app is turned off (gc_config/material_po.mode = off). Nothing was sent.", auditBase);
  if (p.preview.wouldRefuse) return refused(403, `${p.preview.wouldRefuse} Nothing was sent.`, auditBase);
  const recentSends = (await io.recentActions(new Date(Date.parse(ctx.nowIso) - 3600 * 1000).toISOString())).filter(a => a === "material.sendPo").length;
  if (recentSends >= SEND_PO_PER_HOUR) throw new Refusal(429, `Duet has sent ${recentSends} POs in the last hour — the limit is ${SEND_PO_PER_HOUR}. Try again later.`);
  const prior = await io.getAudit(previewId);
  const mismatch = MA.previewMatches(prior, { jobId, cardId, hash: p.hash, nowIso: ctx.nowIso });
  if (mismatch) return refused(409, mismatch, { ...auditBase, confirmPreviewId: previewId });

  // The app's own sender, in-process, as Koy. clientTest:false ONLY when live.
  const sendData = { jobId, phase: p.send.phase, orderId: cardId, source: p.send.source, items: p.send.items, get: p.send.get, date: p.send.date,
    ...(p.send.get === "custom" ? { custom: p.send.custom } : {}), ...(p.send.copyTo.length ? { copyTo: p.send.copyTo.join(", ") } : {}), ...(p.send.phase === "comm" ? { ccId: p.send.ccId } : {}),
    clientTest: cfg.mode === "live" ? false : true };
  let res;
  try {
    res = await io.sendPo(sendData, koyUser);
  } catch (e) {
    const code = String((e && e.code) || "");
    const msg = String((e && e.message) || "The sender failed.").slice(0, 300);
    const unclear = code === "unavailable" || code === "already-exists" || code === "internal" || code === "deadline-exceeded" || !code;
    const why = unclear ? `${msg} A PO MAY exist: check material_po_log/${p.key} or the card (cc_list_material_cards) before trying again — a fresh preview + send with a new requestId finds the same PO instead of making a second one.` : `${msg} Nothing was sent.`;
    return refused(unclear ? 502 : 400, why, { ...auditBase, confirmPreviewId: previewId, senderCode: code, logKey: p.key });
  }
  if (!res || !res.poNo) return refused(502, `Simpro didn't send back a PO number. Check material_po_log/${p.key} before trying again.`, { ...auditBase, confirmPreviewId: previewId, logKey: p.key });
  const sendResult = { poNo: String(res.poNo), kind: res.kind || "", mode: res.mode || "", supplier: res.supplier || "", costCenter: res.costCenter || "", emailOk: !!res.emailOk, emailError: res.emailError || "", emailedTo: Array.isArray(res.emailedTo) ? res.emailedTo : [], copied: Array.isArray(res.copied) ? res.copied : [], again: !!res.again };
  const note = sendResult.mode === "test" ? `TEST send: PO ${sendResult.poNo} is real in Simpro and marked TEST — void it there. The email went only to the test inbox.` : sendResult.kind === "email" ? (sendResult.emailOk ? `PO ${sendResult.poNo} emailed to ${sendResult.emailedTo.join(", ")}.` : `PO ${sendResult.poNo} was made but the email failed: ${sendResult.emailError}. Preview + send again re-emails the same PO.`) : `PO ${sendResult.poNo} is ready for the store run — no email.`;
  const plan = (jobNow) => {
    const q = MA.planSendPatch(cardId, sendResult, p.send, { ...ctx, job: jobNow });
    const extra = { send: sendResult, poNo: sendResult.poNo, mode: sendResult.mode, emailOk: sendResult.emailOk, emailedTo: sendResult.emailedTo, again: sendResult.again, confirmPreviewId: previewId, logKey: p.key, note, pushTo: [] };
    if (q.noop) return { noop: true, result: { ...q.result, ...extra } };
    return { ...q, audit: { send: sendResult, confirmPreviewId: previewId, logKey: p.key }, result: { ...q.result, ...extra } };
  };
  const r = await jobWrite(io, requestId, action, jobId, plan, finish);
  return { status: r.status, body: r.body };
}

// Ship 9: job setup. ONE transaction per call, with the extra reads each
// action needs BEFORE any write (Firestore's rule): the job, the project, the
// Simpro candidates list, every project (a duplicate-name check), the project's
// sibling buildings, and the live jobs carrying a Simpro # (the app's
// simproNoConflict runs over allJobs; here it runs over a query for that
// number, "#"-prefixed spellings included). Creates use tx.create — the import
// and a building on jobs/<data.id>, a project on projects/prj_<id> — so a
// second write to the same id fails the whole transaction instead of
// overwriting; a patch on a job is jobWrite()'s exact envelope (updated_at
// strictly newer, lastActivityAt, merged:false, the stamp, dotted data.<k>); a
// patch on a project is patchProject's (dotted data.<k> + updated_at + saved_by
// + the stamp). The audit doc rides in the same transaction and names every doc
// touched; a create's `after` is the summary of what the import / building set
// (the whole blank doc is in the job itself).
async function jobSetup(io, requestId, action, args, ctx, finish, refused) {
  const jobId = String(args.jobId || "");
  const needsJob = ["job.setInfo", "job.setSection", "job.archive", "project.create", "project.join"].includes(action);
  if (needsJob && !JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "jobs" });
  const projectId = String(args.projectId || "");
  const needsProject = ["project.patch", "project.createBuilding", "project.join"].includes(action);
  if (needsProject && !JSU.PROJECT_ID.test(projectId)) return refused(400, "projectId must be the project's id (prj_…) from cc_list_projects.", { coll: "projects" });
  const simproArg = action === "job.createFromSimpro" ? String(args.simproId == null ? "" : args.simproId).replace(/^#/, "").trim()
    : action === "job.setInfo" && args.field === "simproNo" ? String(args.value == null ? "" : args.value).replace(/^#/, "").trim()
    : action === "project.patch" && args.simproNo !== undefined ? String(args.simproNo == null ? "" : args.simproNo).replace(/^#/, "").trim()
    : action === "project.createBuilding" && args.shareSimpro !== true ? String(args.ownSimproNo == null ? "" : args.ownSimproNo).replace(/^#/, "").trim() : "";
  if (action === "job.createFromSimpro" && !JSU.SIMPRO_ID.test(simproArg)) return refused(400, "simproId must be the Simpro job number of a candidate in the Simpro inbox (cc_list_simpro_candidates).", { coll: "jobs" });
  const jobPatch = (tx, raw, fields) => {
    const upd = { ...stamp(requestId, freshIso(raw.updated_at)), lastActivityAt: io.serverTimestamp(), merged: false };
    Object.keys(fields).forEach(k => { upd["data." + k] = fields[k]; });
    tx.update(io.jobRef(jobId), upd);
  };
  let out = null;
  try {
    await io.runTx(async (tx) => {
      // ── reads ──
      let raw = null, job = null;
      if (needsJob) { const s = await tx.get(io.jobRef(jobId)); raw = s && s.exists ? s.data() : null; job = raw && raw.data ? { id: jobId, data: raw.data } : null; }
      let praw = null, project = null;
      if (needsProject) { const s = await tx.get(io.projectRef(projectId)); praw = s && s.exists ? s.data() : null; project = praw && praw.data ? { id: projectId, ...praw.data } : null; }
      const conflicts = /^\d+$/.test(simproArg) ? await io.jobsBySimproNo(tx, simproArg) : [];
      let candidates = null, candDoc = null;
      if (action === "job.createFromSimpro") { const s = await tx.get(io.settingsRef("simproCandidates")); candDoc = s && s.exists ? s.data() : null; candidates = candDoc && Array.isArray(candDoc.candidates) ? candDoc.candidates : null; }
      const projects = action === "project.create" ? await io.allProjects(tx) : null;
      const siblings = action === "project.createBuilding" && project ? await io.jobsByProject(tx, projectId) : null;
      const c = { ...ctx, job, project, conflicts, candidates, projects, siblings };
      // Refusals name the doc the request was about: the project for project.patch, the job otherwise (a building refusal is about the project → projectId rides along).
      const coll = action === "project.patch" ? "projects" : "jobs";
      const auditBase = { coll, docId: action === "project.patch" ? projectId : jobId || null, ...(needsProject ? { projectId } : {}) };
      const fail = (status, why, extra) => { out = finish(status, { ok: false, refused: why }, { ok: false, why, ...auditBase, ...(extra || {}) }); tx.set(io.auditRef(requestId), out.audit); };
      const noop = (common, p) => { out = finish(200, { ok: true, ...common, noop: true, message: "Already that way — nothing to change.", ...(p.result || {}) }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); };
      const missing = () => (needsJob && !job) || (needsProject && !project);
      switch (action) {
        case "job.createFromSimpro": {
          const p = JSU.planCreateFromSimpro({ ...args, simproId: simproArg }, c);
          if (p.refused) return fail(candidates ? 400 : 404, p.refused);
          tx.create(io.jobRef(p.docId), { data: dropUndefined(p.job), ...stamp(requestId, ctx.nowIso) });   // importSimproCandidate: setDoc(jobs/<j.id>, stampWrite({data:j, updated_at})) — create-only here
          tx.update(io.settingsRef("simproCandidates"), { candidates: p.candidatesAfter, updated_at: ctx.nowIso });   // the app's rewrite, limited to the two fields it sets
          const result = { ok: true, requestId, action, jobId: p.docId, jobName: p.job.name, simproNo: p.job.simproNo, kind: p.kind, division: p.division, customer: p.job.customer || "", address: p.job.address || "", foreman: p.job.foreman, tempPed: !!p.job.tempPed, quickJob: !!p.job.quickJob, wasIgnored: p.wasIgnored || undefined, candidatesLeft: p.candidatesAfter.length,
            follows: ["The job opens on the Job Board as Unassigned — set foreman / lead (cc_set_job_people) to make it live.", "The Simpro inbox no longer lists it (the candidates list was rewritten without it).", "ensureJobDriveFolder only LINKS a Drive folder someone already made with this name; it creates none — the Drive folder (and, on a commercial job, the Simpro plans pull) is the app's Create Drive folder button.", "The app's Simpro auto-pull fills blank address / GC / contacts when the job is next opened on a phone.", "cc_search_jobs finds it by name only after FieldInk's ccjobs/index refreshes (seconds after the app next publishes) — use this jobId directly meanwhile."], pushTo: [] };
          out = finish(200, dropUndefined(result), { ok: true, coll: "jobs", docId: p.docId, newDoc: true, fields: Object.keys(p.job), before: null, after: p.fields, docs: ["jobs/" + p.docId, "settings/simproCandidates.candidates"], candidateRemoved: simproArg });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        case "job.setInfo": case "job.setSection": case "job.archive": {
          const p = action === "job.setInfo" ? JSU.planSetInfo(args, c) : action === "job.setSection" ? JSU.planSetSection(args, c) : JSU.planArchive(args, c);
          if (p.refused) return fail(missing() ? 404 : 400, p.refused);
          const common = { requestId, action, jobId, jobName: job.data.name || "" };
          if (p.noop) return noop(common, p);
          jobPatch(tx, raw, p.fields);
          out = finish(200, dropUndefined({ ok: true, ...common, ...p.result, pushTo: [] }), { ok: true, coll: "jobs", docId: jobId, fields: Object.keys(p.fields), before: p.before, after: p.after });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        case "project.create": {
          const p = JSU.planCreateProject(args, c);
          if (p.refused) return fail(missing() ? 404 : 400, p.refused);
          tx.create(io.projectRef(p.project.id), { data: dropUndefined(p.project), ...stamp(requestId, ctx.nowIso) });   // saveNewProject: setDoc(projects/<id>, stampWrite({data, updated_at, saved_by}))
          jobPatch(tx, raw, p.jobPatch);                                                                               // the Site / Shared patch through u()
          out = finish(200, dropUndefined({ ok: true, requestId, action, jobId, jobName: p.jobPatch.name, ...p.result, pushTo: [] }), { ok: true, coll: "projects", docId: p.project.id, newDoc: true, fields: Object.keys(p.project), before: null, after: p.project, job: { docId: jobId, fields: Object.keys(p.jobPatch), before: p.before, after: p.after }, docs: ["projects/" + p.project.id, "jobs/" + jobId] });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        case "project.patch": {
          const p = JSU.planPatchProject({ ...args, projectId }, c);
          if (p.refused) return fail(missing() ? 404 : 400, p.refused);
          const common = { requestId, action, projectId, projectName: project.name || "" };
          if (p.noop) return noop(common, p);
          const upd = { ...stamp(requestId, freshIso(praw.updated_at)) };   // patchProject: {updated_at, saved_by, "data.<k>"} + stampWrite
          Object.keys(p.patch).forEach(k => { upd["data." + k] = p.patch[k]; });
          tx.update(io.projectRef(projectId), upd);
          out = finish(200, dropUndefined({ ok: true, ...common, ...p.result, pushTo: [] }), { ok: true, coll: "projects", docId: projectId, fields: Object.keys(p.patch), before: p.before, after: p.after });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        case "project.createBuilding": {
          const p = JSU.planCreateBuilding({ ...args, projectId }, c);
          if (p.refused) return fail(missing() ? 404 : 400, p.refused);
          tx.create(io.jobRef(p.docId), { data: dropUndefined(p.job), ...stamp(requestId, ctx.nowIso) });   // createBuilding: setDoc(jobs/<j.id>, stampWrite({data: sanitize(j), updated_at}))
          out = finish(200, dropUndefined({ ok: true, requestId, action, ...p.result, follows: ["Buildings never get a top-level Drive folder (ensureJobDriveFolder's projectGroupId guard); plans come through the project's Simpro folder.", "cc_search_jobs finds it by name only after FieldInk's ccjobs/index refreshes — use this jobId directly meanwhile."], pushTo: [] }), { ok: true, coll: "jobs", docId: p.docId, newDoc: true, fields: Object.keys(p.job), before: null, after: p.fields, docs: ["jobs/" + p.docId], projectId });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        case "project.join": {
          const p = JSU.planJoinProject(args, c);
          if (p.refused) return fail(missing() ? 404 : 400, p.refused);
          const common = { requestId, action, jobId, jobName: job.data.name || "" };
          if (p.noop) return noop(common, p);
          jobPatch(tx, raw, p.fields);
          out = finish(200, dropUndefined({ ok: true, ...common, ...p.result, pushTo: [] }), { ok: true, coll: "jobs", docId: jobId, fields: Object.keys(p.fields), before: p.before, after: p.after, projectId });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        default: return fail(400, "unknown action");
      }
    });
  } catch (e) {
    if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")))) return refused(409, "That id already exists — the create was refused rather than overwrite anything. Nothing was written.", { coll: action === "project.create" ? "projects" : "jobs" });
    throw e;
  }
  return { status: out.status, body: out.body };
}

// Ship 10: the office actions. Four shapes:
//   broadcast.send     — NOT a transaction of its own: the app's OWN sendBroadcastAs
//                        (index.js, factored out of the sendBroadcast callable — one
//                        body, two callers) runs in-process as Koy's settings/users
//                        record after ND.isBroadcaster says Koy's record would pass
//                        requireBroadcaster; it writes broadcasts/<id> and every
//                        recipient's bell copy through deliver() exactly as a tap on
//                        Send does. The audit (its own write after the send) keeps
//                        the title length, kind, label, recipient count + ids and the
//                        delivery summary — never the message body. 10 / hour.
//   autoTask.promote   — ONE transaction: the job, the needs carrying this autoTaskId
//                        (query under the tx), then EITHER tx.create of autoTaskDoc's
//                        literal with saveNeed's envelope (a second write to that id
//                        fails) OR, when an open doc already carries the autoTaskId,
//                        pushTo's onPatchNeed through the shared needPatch (patchNeed's
//                        dotted keys + the stamp) — never a second doc.
//   planIntake.decide  — NOT a transaction: the watcher's own decideById (the /decide
//                        route's body — one function, two callers) runs the real
//                        decide() with the exact body the Routine would post plus
//                        by: "Koy (via Duet)"; its writes are the watcher's: the
//                        agentQueue item (status / decision / decidedAt), the
//                        agentFindings rows it creates / resolves, planIntakeState
//                        (md5_, sender_, walk_, quote_ docs) and the Drive move. A
//                        closed item is its 409, a bad body its 422 → 400.
//   upcoming.add/edit, crewTeams.set, crewRoster.set — ONE transaction each on ONE
//                        settings doc (SETTINGS_DOCS): the list read live, one item
//                        changed, the list written back whole with the settings
//                        stamp (upcoming_jobs with the pipeline's own updated_at
//                        too); a missing doc is set with the fields + stamp as
//                        mergeSaveSettingsFields does. A removed team / name leaves
//                        the list — the doc is never deleted.
async function office(io, requestId, action, args, ctx, finish, refused) {
  const nowMs = Date.parse(ctx.nowIso);
  const hourAgo = new Date(nowMs - 3600 * 1000).toISOString();

  if (action === "broadcast.send") {
    const koy = matchUserByName(ctx.users, "Koy");
    const koyUser = koy.user && !koy.ambiguous ? koy.user : null;
    const p = OF.planBroadcast(args, { users: ctx.users, koyUser, isBroadcaster: io.isBroadcaster, nowMs, rand: ctx.rand });
    if (p.refused) return refused(/office broadcaster/.test(p.refused) ? 403 : 400, p.refused, { coll: "broadcasts" });
    const auditBase = { coll: "broadcasts", docId: p.payload.id };
    const recentSends = (await io.recentActions(hourAgo)).filter(a => a === "broadcast.send").length;
    if (recentSends >= BROADCAST_PER_HOUR) throw new Refusal(429, `Duet has sent ${recentSends} team messages in the last hour — the limit is ${BROADCAST_PER_HOUR}. Try again later.`);
    let res;
    try {
      res = await io.sendBroadcastAs(koyUser, p.payload);   // the app's own send, as Koy; attachments: [] always from here
    } catch (e) {
      const code = String((e && e.code) || "");
      const msg = String((e && e.message) || "The send failed.").slice(0, 300);
      const deterministic = ["invalid-argument", "permission-denied", "not-found", "failed-precondition"].includes(code);
      return refused(deterministic ? 400 : 502, deterministic ? `${msg} Nothing was sent.` : `${msg} The message MAY have reached some people: check cc_list_announcements (and the bell) before sending again.`, { ...auditBase, senderCode: code, kind: p.kind, test: p.test, recipientCount: p.recipients.length });
    }
    const summary = res && res.summary && typeof res.summary === "object" ? res.summary : {};
    const names = (k) => (Array.isArray(summary[k]) ? summary[k] : []);
    const delivery = { total: Number(summary.total) || p.recipients.length, phone: Number(summary.phone) || 0, retrying: names("retrying"), bellOnly: names("bellOnly"), notSaved: names("notSaved") };
    const note = p.test ? "TEST send: it went to Koy only and is not on record (the app's own rule for test sends)."
      : `${p.kind === "important" ? "Important: each person taps Got it and it stays pinned on their My Day until they do." : p.kind === "discussion" ? "Discussion: every reply notifies the whole group." : "Announcement: one-way; the app shows who opened it."} ${delivery.phone} phone${delivery.phone === 1 ? "" : "s"} took it now${delivery.retrying.length ? `, ${delivery.retrying.length} retrying for 12 h` : ""}${delivery.bellOnly.length ? `, bell only for ${delivery.bellOnly.join(", ")}` : ""}${delivery.notSaved.length ? `; NOT saved for ${delivery.notSaved.join(", ")}` : ""}.`;
    const body = { ok: true, requestId, action, broadcastId: res.id, kind: res.kind || p.kind, title: res.title || p.shownTitle, label: p.label, test: p.test, everyone: p.everyone, recipients: p.recipients.map(r => r.name), recipientCount: p.recipients.length, delivery, recorded: !p.test, by: koyUser.name, note, pushTo: p.recipients.map(r => r.name) };
    const r = finish(200, body, { ok: true, ...auditBase, newDoc: !p.test, fields: p.test ? [] : ["broadcasts/" + res.id, "notifications/<recipient>/items/<nid> ×" + p.recipients.length], docs: p.test ? ["notifications/" + (koyUser.id || koyUser.name) + "/items/<nid> (test copy)"] : ["broadcasts/" + res.id, "notifications/*/items"], titleLength: p.payload.title.length, bodyLength: p.bodyLength, kind: p.kind, label: p.label, test: p.test, recipientCount: p.recipients.length, recipientIds: p.recipients.map(x => String(x.id || x.name)), delivery, attachments: 0 });
    await io.runTx(async (tx) => { tx.set(io.auditRef(requestId), r.audit); });
    return { status: 200, body };
  }

  if (action === "autoTask.promote") {
    const jobId = String(args.jobId || "");
    if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "needs" });
    let out = null;
    try {
      await io.runTx(async (tx) => {
        const s = await tx.get(io.jobRef(jobId));
        const raw = s && s.exists ? s.data() : null;
        const job = raw && raw.data ? { id: jobId, data: raw.data } : null;
        const suffix = job ? OF.suffixOf(args.autoTaskId, jobId) : "";
        const rows = job && suffix && OF.autoTaskKind(suffix) ? await io.needsByAutoTaskId(tx, jobId + suffix) : [];
        const p = OF.planPromoteAutoTask(args, { ...ctx, nowMs, job, needs: rows.map(x => x.data) });
        const auditBase = { coll: "needs", jobId, autoTaskId: p.autoTaskId || (job && suffix ? jobId + suffix : null) };
        if (p.refused) { out = finish(job ? 400 : 404, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase, docId: null }); tx.set(io.auditRef(requestId), out.audit); return; }
        const common = { requestId, action, jobId, jobName: job.data.name || "" };
        if (p.noop) { out = finish(200, { ok: true, ...common, noop: true, message: p.result.message, ...p.result }, { ok: true, noop: true, ...auditBase, docId: p.needId, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
        if (p.patch) {
          const cur = rows.find(x => x.id === p.needId);
          const upd = { ...stamp(requestId, freshIso(cur ? cur.updated_at : "")) };   // patchNeed: stampWrite({updated_at, saved_by, "data.<k>": v})
          Object.keys(p.patch).forEach(k => { upd["data." + k] = p.patch[k]; });
          tx.update(io.needRef(p.needId), upd);
          out = finish(200, dropUndefined({ ok: true, ...common, ...p.result }), { ok: true, ...auditBase, docId: p.needId, fields: Object.keys(p.patch), before: p.before, after: p.after });
          tx.set(io.auditRef(requestId), out.audit);
          return;
        }
        tx.create(io.needRef(p.need.id), { data: p.need, ...stamp(requestId, ctx.nowIso) });   // saveNeed: stampWrite({data, updated_at, saved_by}) — create-only
        out = finish(200, dropUndefined({ ok: true, ...common, ...p.result }), { ok: true, ...auditBase, docId: p.need.id, newDoc: true, fields: Object.keys(p.need), before: null, after: p.need, earlierDoneDoc: p.verifyDoc ? p.verifyDoc.id : null });
        tx.set(io.auditRef(requestId), out.audit);
      });
    } catch (e) {
      if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")))) return refused(409, "That task id already exists. Nothing was written.", { coll: "needs" });
      throw e;
    }
    return { status: out.status, body: out.body };
  }

  if (action === "planIntake.decide") {
    const p = OF.planDecidePlanIntake(args);
    const auditBase = { coll: "agentQueue", docId: p.item || null, docs: ["agentQueue/<item>", "agentFindings/*", "planIntakeState/*", "Drive: _Plan Inbox → the plan folder or Dismissed"] };
    if (p.refused) return refused(400, p.refused, auditBase);
    let res;
    try {
      res = await io.planDecide(p.item, p.body);   // the watcher's own decideById: queue read, open-only, decide(), the queue update
    } catch (e) {
      const code = Number(e && e.code) || 0;
      const msg = String((e && e.message) || "").slice(0, 300);
      if (code === 404) return refused(404, `No plan-intake item ${p.item} in the current mode (${msg}). Nothing was decided.`, auditBase);
      if (code === 409) return refused(409, `That item was already decided (${msg}). Nothing was decided.`, auditBase);
      if (code === 422) return refused(400, `${msg}. Nothing was decided.`, auditBase);
      return refused(502, `${msg || "The decide failed."} The decision MAY have landed: check cc_list_plan_intake_queue before deciding again.`, { ...auditBase, code });
    }
    const body = { ok: true, requestId, action, item: p.item, decision: p.action, mode: res.mode, status: res.status, note: res.note || "", by: OF.PLAN_BY, type: res.type || "", filename: res.filename || "", from: res.from || "", dryRun: res.status === "decided_dry",
      effect: res.status === "decided_dry" ? "Dry mode: the queue item is marked decided_dry and nothing moved in Drive." : p.action === "file" ? `Filed into ${res.note || "the plan folder"} (the PDF moved out of _Plan Inbox; the finding is resolved; the sender's history counts it).` : p.action === "dismiss" ? "Moved to _Plan Inbox/Dismissed (never deleted); the finding is resolved." : p.action === "unmatched" ? "An unmatched-plan finding is on the dashboard with the best guess." : "The walk is matched; the finding is resolved.", pushTo: [] };
    const { item: _i, ...decision } = p.body;
    const r = finish(200, body, { ok: true, ...auditBase, fields: ["status", "decision", "decidedAt"], decision, before: { status: "open" }, after: { status: res.status, note: res.note || "" }, mode: res.mode });
    await io.runTx(async (tx) => { tx.set(io.auditRef(requestId), r.audit); });
    return { status: 200, body };
  }

  // upcoming.add / upcoming.edit / crewTeams.set / crewRoster.set — one settings list each
  const docId = action.startsWith("upcoming.") ? "upcoming_jobs" : action === "crewTeams.set" ? "crewTeams" : "crewRoster";
  const listKey = docId === "upcoming_jobs" ? "items" : docId === "crewTeams" ? "teams" : "names";
  let out = null;
  await io.runTx(async (tx) => {
    const s = await tx.get(io.settingsRef(docId));
    const docData = s && s.exists ? s.data() : null;
    const list = docData && Array.isArray(docData[listKey]) ? docData[listKey] : null;
    const p = docId === "upcoming_jobs" ? OF.planUpcoming(action, args, { ...ctx, items: list, uid: () => String(nowMs) })
      : docId === "crewTeams" ? OF.planCrewTeams(args, { ...ctx, teams: list, nowMs })
      : OF.planCrewRoster(args, { ...ctx, names: list });
    const auditBase = { coll: "settings", docId, itemId: p.itemId || p.teamId || (p.result && p.result.name) || null };
    if (p.refused) { out = finish(400, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const common = { requestId, action, doc: "settings/" + docId };
    if (p.noop) { out = finish(200, dropUndefined({ ok: true, ...common, noop: true, message: (p.result && p.result.message) || "Already that way — nothing to change.", ...p.result }), { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const st = settingsStamp(requestId, freshIso(docData ? docData.updatedAt : ""));
    const fields = docId === "upcoming_jobs" ? { items: p.items, updated_at: ctx.nowIso } : docId === "crewTeams" ? { teams: p.teams } : { names: p.names };
    if (docData) tx.update(io.settingsRef(docId), { ...dropUndefined(fields), ...st });   // mergeSaveSettingsFields: tx.update({...fields, ...stamp})
    else tx.set(io.settingsRef(docId), { ...dropUndefined(fields), ...st });               // … or tx.set when the doc doesn't exist yet
    const result = { ok: true, ...common, ...p.result, listNow: fields[listKey].length, newDoc: !docData, pushTo: [] };
    out = finish(200, dropUndefined(result), { ok: true, ...auditBase, fields: Object.keys(fields).map(k => docId + "." + k), before: p.before, after: p.after, newDoc: !docData, listLength: fields[listKey].length });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Ship 11: put an earlier Duet change back. The original audit doc is read
// (plain) to classify — refused / noop / already undone / an undo / a send /
// an add with no closing move stop here — then ONE transaction re-reads the
// original under the lock (two undos racing can't both win), reads the live
// doc(s) the planner needs, lets undo.js decide what to write (edits replayed
// from `before` only while every field still reads `after`; adds undone by
// the app's own closing move), writes it with the SAME envelope the original
// writer used (jobWrite's for a job, patchNeed's for a need, patchProject's
// for a project, the planner's FieldPath cell / settings stamp for settings,
// timeOffDecide's three writes for a decision), writes the undo's own audit
// doc with `undoes`, and stamps the original {undoneBy, undoneAt}. A refusal
// inside the transaction (changed since) is audited with the diff and leaves
// the original un-stamped, so a later undo can still run.
function applyUndoWrite(tx, io, requestId, ctx, w, live) {
  const val = (v) => (v && typeof v === "object" && v.__delete === true ? io.deleteField() : v);
  switch (w.kind) {
    case "jobPatch": {
      const raw = live["jobs/" + w.jobId];
      const upd = { ...stamp(requestId, freshIso(raw.updated_at)), lastActivityAt: io.serverTimestamp(), merged: false };   // jobWrite's envelope
      Object.keys(w.fields).forEach(k => { upd["data." + k] = val(w.fields[k]); });
      tx.update(io.jobRef(w.jobId), upd);
      return;
    }
    case "needPatch": {
      const raw = live["needs/" + w.needId];
      const upd = { ...stamp(requestId, freshIso(raw.updated_at)) };   // patchNeed's write
      Object.keys(w.fields).forEach(k => { upd["data." + k] = val(w.fields[k]); });
      if (w.arrayUnion) Object.keys(w.arrayUnion).forEach(k => { upd["data." + k] = io.arrayUnion(w.arrayUnion[k]); });
      tx.update(io.needRef(w.needId), upd);
      return;
    }
    case "projectPatch": {
      const raw = live["projects/" + w.projectId];
      const upd = { ...stamp(requestId, freshIso(raw.updated_at)) };   // patchProject's write
      Object.keys(w.fields).forEach(k => { upd["data." + k] = val(w.fields[k]); });
      tx.update(io.projectRef(w.projectId), upd);
      return;
    }
    case "settingsCell": {
      const week = live["settings/" + w.docId];
      const st = settingsStamp(requestId, freshIso(week ? week.updatedAt : ""));
      if (!week) { tx.set(io.settingsRef(w.docId), { assignments: { [w.key]: w.cell }, ...st }); return; }
      tx.update(io.settingsRef(w.docId), io.fieldPath("assignments", w.key), w.cell ? w.cell : io.deleteField(), "updatedAt", st.updatedAt, "tab", st.tab, "merged", st.merged);   // crewCell's write
      return;
    }
    case "settingsList": {
      const doc = live["settings/" + w.docId];
      const st = settingsStamp(requestId, freshIso(doc ? doc.updatedAt : ""));
      const fields = { [w.listKey]: w.list, ...(w.pipelineStamp ? { updated_at: ctx.nowIso } : {}) };
      if (doc) tx.update(io.settingsRef(w.docId), { ...dropUndefined(fields), ...st }); else tx.set(io.settingsRef(w.docId), { ...dropUndefined(fields), ...st });
      return;
    }
    case "timeOff": {
      const p = w.plan;
      tx.update(io.settingsRef("timeOffRequests"), { list: p.requestsList, ...settingsStamp(requestId, freshIso(w.reqDoc.updatedAt)) });
      if (p.needFields && w.needRaw) {
        const upd = { ...stamp(requestId, freshIso(w.needRaw.updated_at)) };
        Object.keys(p.needFields).forEach(k => { upd["data." + k] = p.needFields[k]; });
        tx.update(io.needRef("toneed_" + p.request.id), upd);
      }
      if (p.ptoList) {
        if (w.ptoDoc) tx.update(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, freshIso(w.ptoDoc.updatedAt)) });
        else tx.set(io.settingsRef("crewPTO"), { list: p.ptoList, ...settingsStamp(requestId, ctx.nowIso) });
      }
      return;
    }
    default: throw new Error("unknown undo write " + w.kind);
  }
}
async function undoApply(io, requestId, action, args, ctx, finish, refused) {
  const target = String(args.requestId || "");
  if (!RID.test(target)) return refused(400, "requestId must be the earlier Duet call's requestId (from cc_list_duet_writes or that call's own answer).", { coll: AUDIT });
  if (target === requestId) return refused(400, "An undo can't name itself. Nothing was written.", { coll: AUDIT });
  const orig = await io.getAudit(target);
  const cls = UN.classify(orig);
  if (cls.refused) return refused(cls.status || 400, cls.refused, { undoes: target, undoneAction: orig ? orig.action || null : null, coll: (orig && orig.coll) || AUDIT, docId: (orig && orig.docId) || null });
  let out = null;
  await io.runTx(async (tx) => {
    const os = await tx.get(io.auditRef(target));
    const o = os && os.exists ? os.data() : null;
    const auditBase = { coll: cls.coll, docId: cls.docId, undoes: target, undoneAction: o ? o.action : null, itemId: (o && o.itemId) || null };
    if (!o || o.undoneBy) { out = finish(400, { ok: false, refused: o ? `That change was already undone by ${o.undoneBy}. Nothing was written.` : "That audit record vanished mid-call. Nothing was written." }, { ok: false, why: "already undone or gone", ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
    const live = {};
    for (const path of cls.reads) {
      const i = path.indexOf("/"), coll = path.slice(0, i), id = path.slice(i + 1);
      const ref = coll === "jobs" ? io.jobRef(id) : coll === "needs" ? io.needRef(id) : coll === "projects" ? io.projectRef(id) : coll === "settings" ? io.settingsRef(id) : null;
      if (!ref) throw new Refusal(400, `${coll} isn't a collection Duet reads for an undo. Nothing was written.`);
      const s = await tx.get(ref);
      live[path] = s && s.exists ? s.data() : null;
    }
    const p = UN.planUndo(o, cls, live, ctx);
    if (p.refused) { out = finish(400, { ok: false, refused: p.refused, ...(p.diff ? { diff: p.diff } : {}) }, { ok: false, why: p.refused, ...auditBase, ...(p.diff ? { diff: p.diff } : {}) }); tx.set(io.auditRef(requestId), out.audit); return; }
    for (const w of p.writes) applyUndoWrite(tx, io, requestId, ctx, w, live);
    const itemId = p.itemId || auditBase.itemId || null;
    const result = { ok: true, requestId, action, undoes: target, undoneAction: o.action, undoneAt: o.at || null, coll: cls.coll, docId: cls.docId, itemId, fields: p.fields, closing: p.closing || null, putBack: p.after, wasShowing: p.before, notes: p.notes, ...(p.result || {}) };
    out = finish(200, dropUndefined(result), { ok: true, ...auditBase, itemId, fields: p.fields, before: p.before, after: p.after, closing: p.closing || null, notes: p.notes });
    tx.set(io.auditRef(requestId), out.audit);
    tx.update(io.auditRef(target), { undoneBy: requestId, undoneAt: ctx.nowIso });   // the ONLY write ever made to an existing audit doc
  });
  return { status: out.status, body: out.body };
}

// Ship 12: the any-document door. checkTarget refuses before any read (the
// refusal is audited like every deterministic one); then ONE transaction:
// read the live doc, plan (anyDoc.js), write by kind with the envelope the
// app's own writer for that collection uses, audit in the same transaction.
// Audit extra: {coll, docId, fields:[path], path, itemId, index, before, after,
// confirmed}. A hard delete keeps the WHOLE doc under `before` (undo's
// material); a create is marked newDoc.
async function anyDocWrite(io, requestId, action, args, ctx, finish, refused) {
  const t = AD.checkTarget(action, args);
  if (t.refused) return refused(t.status || 400, t.refused, { coll: typeof args.coll === "string" ? String(args.coll).slice(0, 40) : null, docId: args.docId == null ? null : String(args.docId).slice(0, 128) });
  const { coll, docId, kind } = t;
  const isTeam = action === "team.edit";
  const ref = isTeam ? io.usersRef() : (action === "doc.create" && !docId ? null : io.anyRef(coll, docId));
  const val = (v) => (v && typeof v === "object" && v.__delete === true ? io.deleteField() : v);
  let out = null, prevHr = null, wroteHr = false;
  try {
    await io.runTx(async (tx) => {
      let live = null, liveRef = ref;
      if (liveRef) { const s = await tx.get(liveRef); live = s && s.exists ? s.data() : null; }
      const p = isTeam ? AD.planTeamEdit(args, live, ctx) : AD.planDoc(action, args, live, ctx);
      const auditBase = { coll, docId: p.docId || docId || null, confirmed: !!t.confirmWord, ...(t.path ? { path: t.path } : {}) };
      if (p.refused) { out = finish(p.status || 400, { ok: false, refused: p.refused }, { ok: false, why: p.refused, ...auditBase }); tx.set(io.auditRef(requestId), out.audit); return; }
      if (p.noop) { out = finish(200, { ok: true, requestId, action, noop: true, message: "Already that way — nothing to change.", ...(p.result || {}) }, { ok: true, noop: true, ...auditBase, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
      if (isTeam) {
        // saveUsers' envelope, so every open tab's stale-write guard (keyed on updated_at) sees a real team edit; the list is never shorter.
        tx.update(liveRef, { list: dropUndefined(p.list), updated_at: freshIso(live.updated_at), saved_by: SAVED_BY, device: "duet" });
        const result = { ok: true, requestId, action, ...p.result, pushTo: [] };
        out = finish(200, result, { ok: true, ...auditBase, fields: ["list"], itemId: p.userId, before: p.before, after: p.after });
        tx.set(io.auditRef(requestId), out.audit);
        return;
      }
      const w = p.write;
      const fieldNames = w.kind === "update" ? Object.keys(w.fields).map(k => (kind === "data" ? k.replace(/^data\./, "") : k)) : [];
      if (w.kind === "update") {
        let upd;
        if (coll === "jobs") upd = { ...stamp(requestId, freshIso(live.updated_at)), lastActivityAt: io.serverTimestamp(), merged: false };   // jobWrite's envelope
        else if (kind === "data") upd = { ...stamp(requestId, freshIso(live.updated_at)) };                                                   // patchNeed / patchProject's write
        else upd = AD.stampFor(kind, live, ctx, requestId);                                                                                 // whichever stamp key the doc carries
        Object.keys(w.fields).forEach(k => { upd[k] = val(dropUndefined(w.fields[k])); });
        if (coll === "homeowner_requests") { prevHr = live; wroteHr = true; }
        tx.update(liveRef, upd);
      } else if (w.kind === "create") {
        liveRef = io.anyRef(coll, p.docId);
        if (kind === "data") tx.create(liveRef, { data: dropUndefined(w.doc.data), ...stamp(requestId, ctx.nowIso) });   // the app's {data, updated_at, saved_by} envelope — create-only
        else tx.create(liveRef, { ...dropUndefined(w.doc), ...AD.stampFor(kind, null, ctx, requestId) });
      } else if (w.kind === "delete") {
        tx.delete(liveRef);   // the typed docId was checked before the read; the whole doc rides in the audit's before
      } else throw new Error("unknown door write " + w.kind);
      const result = { ok: true, requestId, action, ...p.result, pushTo: [] };
      out = finish(200, result, { ok: true, ...auditBase, fields: fieldNames.length ? fieldNames : (w.kind === "create" ? (kind === "data" ? Object.keys(w.doc.data) : Object.keys(w.doc)) : []), itemId: p.itemId || null, index: p.index === undefined ? null : p.index, before: p.before, after: p.after, ...(w.kind === "create" ? { newDoc: true } : {}), ...(w.kind === "delete" ? { hardDelete: true } : {}) });
      tx.set(io.auditRef(requestId), out.audit);
    });
  } catch (e) {
    if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")))) return refused(409, "That id already exists — the create was refused rather than overwrite anything. Nothing was written.", { coll, docId: docId || null });
    throw e;
  }
  if (wroteHr) {
    let snapped = false;
    try { snapped = await io.snapshotHrVersion(docId, prevHr, "duet", ctx.nowIso); } catch (e) { snapped = false; }
    out.body.versionSnapshot = snapped;
  }
  return { status: out.status, body: out.body };
}

async function handle(body, io) {
  const b = body && typeof body === "object" ? body : {};
  const requestId = String(b.requestId || "");
  if (!RID.test(requestId)) throw new Refusal(400, "requestId must be 8–64 letters, digits, - or _.");
  if (!ACTIONS.includes(b.action)) throw new Refusal(400, `action must be one of ${ACTIONS.join(", ")}.`);
  const args = b.args && typeof b.args === "object" ? b.args : {};
  const email = String(b.email || "").slice(0, 120);

  // The Claude tab's log rows: written straight to claude_activity, each doc id
  // the row's own hash, so a repeat call rewrites the same docs (idempotent
  // without an audit doc). Nothing in Command Center is read or changed.
  if (ACTIVITY_ACTIONS.includes(b.action)) {
    const p = AC.planActivity(b.action, args, io.nowIso());
    if (p.refused) return { status: 400, body: { ok: false, refused: p.refused } };
    await io.writeActivity(p.docs);
    return { status: 200, body: { ok: true, requestId, action: b.action, logged: p.docs.length, ids: p.docs.map(d => d.id), ...(p.skipped.length ? { skipped: p.skipped } : {}) } };
  }

  // Reports (v616): one doc in claude_reports, server-only. The job's number and
  // name are read from jobs/<jobId> here, never taken from the caller. Filing the
  // same job + type + title again replaces that report (same id), so a retry
  // never makes a second copy; archive only flips archived (never a delete).
  if (REPORT_ACTIONS.includes(b.action)) {
    const nowIso = io.nowIso();
    if (b.action === "report.file") {
      const jobId = String(args.jobId || "");
      const job = /^[A-Za-z0-9_-]{1,80}$/.test(jobId) ? await io.getJobData(jobId) : null;
      const fid = RP.fileId(args);
      if (fid.refused) return { status: 400, body: { ok: false, refused: fid.refused } };
      const p = RP.planFile(args, job, await io.getReport(fid.id), nowIso);
      if (p.refused) return { status: 400, body: { ok: false, refused: p.refused } };
      await io.setReport(p.id, p.doc);
      return { status: 200, body: { ok: true, requestId, action: b.action, reportId: p.id, jobId: p.doc.jobId, simproNo: p.doc.jobNo, jobName: p.doc.jobName, type: p.doc.type, title: p.doc.title, ownersOnly: p.doc.ownersOnly, version: p.doc.version, replaced: p.replaced } };
    }
    const id = String(args.id || "");
    const prior = /^rep_[A-Za-z0-9_-]{6,48}$/.test(id) ? await io.getReport(id) : null;
    const p = RP.planArchive(args, prior, nowIso);
    if (p.refused) return { status: 400, body: { ok: false, refused: p.refused } };
    if (p.noop) return { status: 200, body: { ok: true, requestId, action: b.action, reportId: p.id, archived: !!prior.archived, noop: true } };
    await io.patchReport(p.id, p.patch);
    return { status: 200, body: { ok: true, requestId, action: b.action, reportId: p.id, archived: p.patch.archived } };
  }

  // Same requestId → same answer, nothing written twice.
  const prior = await io.getAudit(requestId);
  if (prior && prior.response) return { status: prior.response.status || 200, body: { ...prior.response.body, replayed: true } };

  const nowIso = io.nowIso();
  const recent = await io.countRecent(new Date(Date.parse(nowIso) - 3600 * 1000).toISOString());
  if (recent >= RATE_PER_HOUR) throw new Refusal(429, `Duet has made ${recent} changes in the last hour — the limit is ${RATE_PER_HOUR}. Try again later.`);

  const todayYmd = io.todayYmd();
  const ctx = { nowIso, todayYmd, bucketNow: `${todayYmd}T12:00:00`, users: await io.getUsers(), rand: io.rand ? io.rand() : undefined, tz: io.tz, email };
  const base = { at: nowIso, action: b.action, by: SAVED_BY, email, requestId, expireAt: new Date(Date.parse(nowIso) + 90 * 86400 * 1000).toISOString() };
  // Every answer and every audit doc goes through here, so this is the one
  // place to drop `undefined` (Firestore refuses a document holding one;
  // 2026-11-04: four real punch.add calls died on `response.body.room` inside
  // the transaction, so nothing was written — the audit doc rides in the same
  // transaction on purpose). A planner may still say `room: undefined`; the
  // key just doesn't reach Firestore or the chat.
  const finish = (status, bodyOut, auditExtra) => {
    const body = dropUndefined(bodyOut);
    return { status, body, audit: dropUndefined({ ...base, ...auditExtra, response: { status, body } }) };
  };

  // A refusal that is about THIS request (bad input, missing doc, duplicate) is
  // deterministic, so it is audited and replays the same way. 401/429/500 never are.
  const refused = async (status, why, extra) => {
    const r = finish(status, { ok: false, refused: why }, { ok: false, why, ...(extra || {}) });
    await io.runTx(async (tx) => { tx.set(io.auditRef(requestId), r.audit); });
    return { status: r.status, body: r.body };
  };

  if (b.action === "task.create") {
    const jobId = args.jobId ? String(args.jobId) : "";
    const job = jobId ? await io.getJob(jobId) : null;
    ctx.job = job;
    const plan = planCreateTask(args, ctx);
    if (plan.refused) return refused(jobId && !job ? 404 : 400, plan.refused, { coll: "needs" });
    const need = plan.need;
    const open = await io.openNeeds({ jobId: need.jobId, assignedTo: need.assignedTo });
    if (isDuplicate(need, open, nowIso)) return refused(409, `An open task with the same words for ${need.assignedTo}${need.jobName ? ` on ${need.jobName}` : ""} was created in the last 10 minutes — not adding it twice.`, { coll: "needs" });
    const envelope = { data: need, ...stamp(requestId, nowIso) };   // saveNeed: stampWrite({data, updated_at, saved_by})
    const result = { ok: true, requestId, action: b.action, needId: need.id, text: need.text, kind: need.kind, assignedTo: need.assignedTo, dueBucket: need.dueBucket, dueDate: need.dueDate, priority: need.priority, jobId: need.jobId, jobName: need.jobName, pushTo: need.assignedTo !== need.assignedBy ? need.assignedTo : null };
    const r = finish(200, result, { ok: true, coll: "needs", docId: need.id, fields: Object.keys(need), before: null, after: need });
    try {
      await io.runTx(async (tx) => {
        tx.create(io.needRef(need.id), envelope);   // create-only: a second write to this id fails the transaction
        tx.set(io.auditRef(requestId), r.audit);
      });
    } catch (e) {
      if (e && (e.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(e.message || "")))) return refused(409, "That task id already exists. Nothing was written.", { coll: "needs", docId: need.id });
      throw e;
    }
    return { status: 200, body: result };
  }

  if (JOB_WRITE_ACTIONS.includes(b.action)) {
    const jobId = String(args.jobId || "");
    if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "jobs" });
    const r = await jobWrite(io, requestId, b.action, jobId, planJobAction(b.action, args, ctx), finish);
    return { status: r.status, body: r.body };
  }

  if (b.action === "photo.add") {
    const r = await photoAdd(io, requestId, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (THREAD_ACTIONS.includes(b.action)) {
    const r = await threadReply(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (CREW_ACTIONS.includes(b.action)) {
    const r = await crewCell(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (TIMEOFF_ACTIONS.includes(b.action)) {
    const r = await timeOffDecide(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (MATERIAL_PO_ACTIONS.includes(b.action)) {
    const r = await materialPo(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (JOB_SETUP_ACTIONS.includes(b.action)) {
    const r = await jobSetup(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (OFFICE_ACTIONS.includes(b.action)) {
    const r = await office(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (UNDO_ACTIONS.includes(b.action)) {
    const r = await undoApply(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  if (DOC_ACTIONS.includes(b.action)) {
    const r = await anyDocWrite(io, requestId, b.action, args, ctx, finish, refused);
    return { status: r.status, body: r.body };
  }

  // task.update
  const needId = String(args.needId || "");
  if (!NEED_ID.test(needId)) return refused(400, "needId must be a task id like need_1730650000001_ab12c.", { coll: "needs" });
  let out = null;
  await io.runTx(async (tx) => {
    const snap = await tx.get(io.needRef(needId));
    const raw = snap && snap.exists ? snap.data() : null;
    const current = raw && raw.data ? raw.data : null;
    const plan = planUpdateTask(args, current, ctx);
    if (plan.refused) { out = finish(current ? 400 : 404, { ok: false, refused: plan.refused }, { ok: false, why: plan.refused, coll: "needs", docId: needId }); tx.set(io.auditRef(requestId), out.audit); return; }
    if (plan.noop) { out = finish(200, { ok: true, requestId, action: b.action, needId, noop: true, message: "Already that way — nothing to change." }, { ok: true, noop: true, coll: "needs", docId: needId, fields: [] }); tx.set(io.auditRef(requestId), out.audit); return; }
    const updatedAt = freshIso(raw.updated_at);
    const upd = { ...stamp(requestId, updatedAt) };            // patchNeed: stampWrite({updated_at, saved_by, "data.<k>": v})
    const before = {}, after = {};
    Object.keys(plan.fields).forEach(k => { upd["data." + k] = plan.fields[k]; before[k] = current[k] === undefined ? null : current[k]; after[k] = plan.fields[k]; });
    if (plan.entry) { upd["data.updates"] = io.arrayUnion(plan.entry); after.updatesAdded = plan.entry; }
    tx.update(io.needRef(needId), upd);
    const result = { ok: true, requestId, action: b.action, needId, changed: Object.keys(plan.fields), note: plan.entry ? plan.entry.kind : null, assignedTo: plan.fields.assignedTo || current.assignedTo || "", status: plan.fields.status || current.status || "open" };
    out = finish(200, result, { ok: true, coll: "needs", docId: needId, fields: Object.keys(plan.fields).concat(plan.entry ? ["updates"] : []), before, after });
    tx.set(io.auditRef(requestId), out.audit);
  });
  return { status: out.status, body: out.body };
}

// Real Firestore + Storage io. Admin SDK: tx.create fails with ALREADY_EXISTS
// (code 6). Storage: the app's bucket (src/App.js storageBucket), objects saved
// with a Firebase download token in their custom metadata so the URL the app
// gets from getDownloadURL() and the one built here are the same string.
function firestoreIo({ functions, db, FieldValue, FieldPath, getUsers, TZ, storage, materialDeps, officeDeps }) {
  const bucket = storage ? storage.bucket(PH.BUCKET) : null;
  const T = (v) => String(v == null ? "" : v).trim();
  const md = materialDeps || {};
  const od = officeDeps || {};
  const R = require("../materialPO/rules.js");
  return {
    // Ship 10: the app's OWN announcement sender (index.js sendBroadcastAs — the
    // sendBroadcast callable's body, factored out, two callers), its gate, and
    // the plan-intake watcher's own decideById (the /decide route's body).
    sendBroadcastAs: async (user, payload) => { if (typeof od.sendBroadcastAs !== "function") throw new Error("Announcements are not wired into duetApi (officeDeps.sendBroadcastAs)."); return od.sendBroadcastAs(user, payload); },
    isBroadcaster: (u) => (typeof od.isBroadcaster === "function" ? !!od.isBroadcaster(u) : false),
    planDecide: async (itemId, body) => { if (typeof od.planDecide !== "function") throw Object.assign(new Error("Plan intake is not wired into duetApi (officeDeps.planDecide)."), { code: 500 }); return od.planDecide(itemId, body); },
    // The needs carrying one autoTaskId (autoDelegation's input), read under the transaction's lock.
    needsByAutoTaskId: async (tx, id) => { const s = await tx.get(db.collection("needs").where("data.autoTaskId", "==", String(id))); return s.docs.map(d => { const r = d.data() || {}; return { id: d.id, data: r.data || null, updated_at: r.updated_at || "" }; }).filter(x => x.data); },
    // Ship 8: the PO config the send factory's loadCfg reads — mode / testTo /
    // bids / liveAccess from gc_config/material_po, and from gc_config/mail ONLY
    // soakTo (the test inbox default). The mail key is never read into this.
    loadPoCfg: async () => {
      let c = {};
      try { const d = await db.collection("gc_config").doc("material_po").get(); c = d.exists ? (d.data() || {}) : {}; } catch (e) {}
      let soakTo = "";
      try { const m = md.loadMailConfig ? await md.loadMailConfig() : null; soakTo = T(m && m.soakTo); } catch (e) {}
      const mode = ["off", "test", "live"].includes(T(c.mode)) ? T(c.mode) : "test";
      const liveAccess = Array.isArray(c.liveAccess) && c.liveAccess.length ? c.liveAccess : ["admin", "manager", "standard", "limited"];
      return { mode, liveAccess, testTo: T(c.testTo) || soakTo, bids: T(c.bids) || "bids@homesteadelectric.net" };
    },
    // The card's send record (material_po_log/<job>_<phase>_<card>), trimmed to what the preview shows.
    readPoLog: async (jobId, phase, cardId) => {
      const key = R.logKey(jobId, phase, cardId);
      if (!key) return null;
      const s = await db.collection("material_po_log").doc(key).get();
      if (!s.exists) return null;
      const l = s.data() || {};
      return { status: T(l.status), poNo: T(l.poNo), mode: T(l.mode), emailOk: !!l.emailOk, emailedTo: Array.isArray(l.emailedTo) ? l.emailedTo : [] };
    },
    accessOf: (u) => (md.accessOf ? md.accessOf(u) : (u && u.access) || "limited"),
    // Live only: the supplier's email on its Simpro vendor record (one GET, the sender's own lookup).
    vendorEmail: async (simproName) => {
      if (!md.simproReqWithRetry) return "";
      const r = await md.simproReqWithRetry("GET", "/vendors/?pageSize=250&columns=ID,Name,Email");
      const v = r && r.ok && Array.isArray(r.data) ? R.vendorFor({ simproName }, r.data) : null;
      return T(v && v.Email);
    },
    // Live only: Koy's email on his Simpro employee record (the sender's reply-to / CC).
    senderEmail: async (name) => {
      if (!md.simproReqWithRetry || !name) return "";
      const r = await md.simproReqWithRetry("GET", "/employees/?pageSize=250&columns=ID,Name");
      const hit = r && r.ok && Array.isArray(r.data) ? r.data.find(e => T(e.Name).toLowerCase() === T(name).toLowerCase()) : null;
      if (!hit) return "";
      const d = await md.simproReqWithRetry("GET", `/employees/${hit.ID}`);
      return T(d && d.ok && d.data && d.data.PrimaryContact && d.data.PrimaryContact.Email);
    },
    // The app's OWN sendMaterialPO handler, in-process: the same factory index.js
    // exports, built with the real Simpro / mail / Gmail deps and a `functions`
    // whose onCall hands back the handler itself; requireMember answers with the
    // user resolved here (the bearer already proved it's Koy).
    sendPo: async (data, user) => {
      if (!md.simproReqWithRetry || !md.loadMailConfig) throw new Error("Material PO sending is not wired into duetApi (materialDeps).");
      const stub = { https: { HttpsError: functions.https.HttpsError, onCall: (fn) => fn }, runWith() { return this; }, logger: functions.logger };
      const { sendMaterialPO } = require("../materialPO/send.js")({ functions: stub, db, TZ, simproReqWithRetry: md.simproReqWithRetry, requireMember: async () => user, accessOf: md.accessOf, loadMailConfig: md.loadMailConfig, gmailSend: md.gmailSend || null });
      return sendMaterialPO(data);
    },
    recentActions: async (sinceIso) => { const s = await db.collection(AUDIT).where("at", ">", sinceIso).select("action").get(); return s.docs.map(d => (d.data() || {}).action); },
    // Ship 5: the ONLY way this file opens a settings doc. An id outside
    // SETTINGS_DOCS (settings/users above all) throws before any read.
    settingsRef: (id) => {
      if (!settingsDocAllowed(id)) throw new Refusal(400, `settings/${String(id).slice(0, 40)} is not a document Duet may touch. Nothing was read or written.`);
      return db.collection("settings").doc(String(id));
    },
    fieldPath: (...segs) => { if (!FieldPath) throw new Error("FieldPath is not wired into duetApi."); return new FieldPath(...segs); },
    deleteField: () => FieldValue.delete(),
    readDoc: async (ref) => { const s = await ref.get(); return s.exists ? s.data() : null; },
    newToken: () => crypto.randomUUID(),
    putObject: async (path, buf, contentType, token) => {
      if (!bucket) throw new Error("Storage is not wired into duetApi.");
      await bucket.file(path).save(buf, { resumable: false, contentType, metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } } });
      return PH.downloadUrl(bucket.name, path, token);
    },
    deleteObject: async (path) => { if (bucket) await bucket.file(path).delete({ ignoreNotFound: true }); },
    nowIso: () => new Date().toISOString(),
    todayYmd: () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }),
    rand: () => Math.random().toString(36).slice(2, 7),
    getAudit: async (id) => { const s = await db.collection(AUDIT).doc(id).get(); return s.exists ? s.data() : null; },
    countRecent: async (sinceIso) => { const s = await db.collection(AUDIT).where("at", ">", sinceIso).count().get(); return s.data().count || 0; },
    getJob: async (id) => { const s = await db.collection("jobs").doc(id).get(); const d = s.exists ? (s.data() || {}).data : null; return d ? { id, name: d.name || "", foreman: d.foreman || "", archived: !!d.archived, deleted: !!d.deleted } : null; },
    getUsers,
    openNeeds: async ({ jobId, assignedTo }) => {
      let q = db.collection("needs").where("data.status", "==", "open");
      q = jobId ? q.where("data.jobId", "==", jobId) : q.where("data.assignedTo", "==", assignedTo);
      const s = await q.limit(200).get();
      return s.docs.map(d => (d.data() || {}).data).filter(Boolean);
    },
    runTx: (fn) => db.runTransaction(fn),
    needRef: (id) => db.collection("needs").doc(id),
    jobRef: (id) => db.collection("jobs").doc(id),
    // Ship 12: the door's refs. anyRef refuses the NEVER list and settings/users
    // before any read (anyDoc.neverReason); usersRef is the ONE path to
    // settings/users, used by team.edit (and its undo) only.
    anyRef: (coll, id) => {
      const c = String(coll || ""), d = String(id || "");
      if (!/^[a-z_]{2,40}$/.test(c) || !/^[A-Za-z0-9_-]{1,128}$/.test(d)) throw new Refusal(400, "coll / docId must name a top-level document. Nothing was read or written.");
      const why = AD.neverReason(c, d);
      if (why) throw new Refusal(400, why);
      return db.collection(c).doc(d);
    },
    usersRef: () => db.collection("settings").doc("users"),
    // Ship 9: projects/<prj_…> (create + dotted update, never delete) and the
    // three transactional queries the job-setup planners need — read under the
    // transaction's lock, trimmed to the fields the app's helpers look at.
    projectRef: (id) => { if (!JSU.PROJECT_ID.test(String(id))) throw new Refusal(400, "projectId must be the project's id (prj_…)."); return db.collection("projects").doc(String(id)); },
    jobsBySimproNo: async (tx, no) => { const n = String(no || "").replace(/^#/, "").trim(); if (!/^\d+$/.test(n)) return []; const s = await tx.get(db.collection("jobs").where("data.simproNo", "in", [n, "#" + n])); return s.docs.map(d => { const j = (d.data() || {}).data || {}; return { id: d.id, name: j.name || "", simproNo: j.simproNo || "", projectGroupId: j.projectGroupId || "", archived: !!j.archived, deleted: !!j.deleted }; }); },
    jobsByProject: async (tx, pid) => { const s = await tx.get(db.collection("jobs").where("data.projectGroupId", "==", String(pid))); return s.docs.map(d => ({ id: d.id, ...((d.data() || {}).data || {}) })); },
    allProjects: async (tx) => { const s = await tx.get(db.collection("projects")); return s.docs.map(d => ({ id: d.id, ...((d.data() || {}).data || {}) })); },
    hrRef: (id) => db.collection("homeowner_requests").doc(id),
    // snapshotHomeownerRequestVersion (App.js ~L22890): the prior doc into
    // homeowner_requests/<id>/versions {snap, at, by}, newest 10 kept. The
    // prune is the only Firestore delete in this file, and it only ever
    // touches this writer's own snapshots.
    snapshotHrVersion: async (jobId, prevData, tag, nowIso) => {
      if (!prevData) return false;
      const col = db.collection("homeowner_requests").doc(jobId).collection("versions");
      await col.add({ snap: dropUndefined(prevData), at: nowIso || new Date().toISOString(), by: tag || "unknown" });
      const snaps = await col.orderBy("at", "desc").limit(30).get();
      await Promise.all(snaps.docs.slice(10).map(d => d.ref.delete().catch(() => {})));
      return true;
    },
    auditRef: (id) => db.collection(AUDIT).doc(id),
    // v613: the Claude tab's log. claude_activity/<sim_…|wat_…> only — the ids
    // come from activity.js, never from the caller as-is.
    writeActivity: async (docs) => {
      const batch = db.batch();
      docs.forEach(({ id, doc }) => { if (!/^(sim|wat)_[A-Za-z0-9_-]{6,40}$/.test(id)) throw new Refusal(400, "bad activity id"); batch.set(db.collection("claude_activity").doc(id), doc); });
      await batch.commit();
    },
    // v616: Reports. claude_reports/<rep_…> only; ids come from reports.js.
    getJobData: async (jobId) => {
      const s = await db.collection("jobs").doc(jobId).get();
      const raw = s.exists ? s.data() : null;
      return raw && raw.data && typeof raw.data === "object" ? raw.data : null;
    },
    getReport: async (id) => {
      if (!/^rep_[A-Za-z0-9_-]{6,48}$/.test(id)) throw new Refusal(400, "bad report id");
      const s = await db.collection("claude_reports").doc(id).get();
      return s.exists ? s.data() : null;
    },
    setReport: async (id, doc) => {
      if (!/^rep_[A-Za-z0-9_-]{6,48}$/.test(id)) throw new Refusal(400, "bad report id");
      await db.collection("claude_reports").doc(id).set(dropUndefined(doc));
    },
    patchReport: async (id, patch) => {
      if (!/^rep_[A-Za-z0-9_-]{6,48}$/.test(id)) throw new Refusal(400, "bad report id");
      await db.collection("claude_reports").doc(id).update(dropUndefined(patch));
    },
    arrayUnion: (...x) => FieldValue.arrayUnion(...x),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    tz: TZ,
  };
}

module.exports = function makeDuetApi({ functions, db, FieldValue, FieldPath, getUsers, TZ, storage, materialDeps, officeDeps }) {
  const io = firestoreIo({ functions, db, FieldValue, FieldPath, getUsers, TZ, storage, materialDeps, officeDeps });
  const duetApi = functions
    // invoker "public" like planRoutineApi: Google's door stays open so Vercel
    // can reach it; the bearer-token check is the gate. 512 MB / 120 s since
    // ship 3: a 7 MB photo arrives as a 9.3 MB base64 body and is decoded,
    // sniffed and uploaded in one request.
    .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: [SECRET], invoker: "public" })
    .https.onRequest(async (req, res) => {
      if (!tokenOk(req)) { res.status(401).json({ ok: false, error: "unauthorized" }); return; }
      if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }
      try {
        const r = await handle(req.body, io);
        res.status(r.status).json(r.body);
      } catch (e) {
        if (e instanceof Refusal) { res.status(e.status).json({ ok: false, refused: e.message }); return; }
        functions.logger.error("[duetApi] failed", { action: req.body && req.body.action, requestId: req.body && req.body.requestId, error: e && e.message });
        res.status(500).json({ ok: false, error: "Couldn't complete the change. Nothing is known to have been written; check the task before asking again." });
      }
    });
  return { duetApi };
};
module.exports.handle = handle;
module.exports.tokenOk = tokenOk;
module.exports.Refusal = Refusal;
module.exports.BUILD = BUILD;
module.exports.SAVED_BY = SAVED_BY;
module.exports.ACTIONS = ACTIONS;
module.exports.JOB_ACTIONS = JOB_ACTIONS;
module.exports.PHOTO_ACTIONS = PHOTO_ACTIONS;
module.exports.JOB_WRITE_ACTIONS = JOB_WRITE_ACTIONS;
module.exports.QUESTION_ACTIONS = QUESTION_ACTIONS;
module.exports.NOTE_ACTIONS = NOTE_ACTIONS;
module.exports.THREAD_ACTIONS = THREAD_ACTIONS;
module.exports.PEOPLE_ACTIONS = PEOPLE_ACTIONS;
module.exports.PUNCH_ACTIONS = PUNCH_ACTIONS;
module.exports.STAGE_ACTIONS = STAGE_ACTIONS;
module.exports.CREW_ACTIONS = CREW_ACTIONS;
module.exports.TIMEOFF_ACTIONS = TIMEOFF_ACTIONS;
module.exports.MATERIAL_CARD_ACTIONS = MATERIAL_CARD_ACTIONS;
module.exports.MATERIAL_PO_ACTIONS = MATERIAL_PO_ACTIONS;
module.exports.JOB_SETUP_ACTIONS = JOB_SETUP_ACTIONS;
module.exports.OFFICE_ACTIONS = OFFICE_ACTIONS;
module.exports.FIELD_ACTIONS = FIELD_ACTIONS;
module.exports.UNDO_ACTIONS = UNDO_ACTIONS;
module.exports.ACTIVITY_ACTIONS = ACTIVITY_ACTIONS;
module.exports.REPORT_ACTIONS = REPORT_ACTIONS;
module.exports.DOC_ACTIONS = DOC_ACTIONS;
module.exports.SEND_PO_PER_HOUR = SEND_PO_PER_HOUR;
module.exports.BROADCAST_PER_HOUR = BROADCAST_PER_HOUR;
module.exports.SETTINGS_DOCS = SETTINGS_DOCS;
module.exports.settingsDocAllowed = settingsDocAllowed;
module.exports.settingsDocFields = settingsDocFields;
module.exports.firestoreIo = firestoreIo;
