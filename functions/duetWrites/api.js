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
//     or the statusUpdate scalar — ship 2), needs (create + update). Never a
//     delete, never a job create, never anything else.
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
const crypto = require("crypto");
const { planCreateTask, planUpdateTask, isDuplicate } = require("./needs.js");
const JI = require("./jobItems.js");

const SECRET = "DUET_WRITE_TOKEN";
const BUILD = 601;                 // SW version this shipped with; integer for the version-lock stamp
const SAVED_BY = "Duet (Koy)";
const RATE_PER_HOUR = 60;
const AUDIT = "duet_writes";
const JOB_ACTIONS = ["co.create", "co.edit", "co.setStatus", "co.convert", "rt.create", "rt.update", "job.setStatusUpdate"];
const ACTIONS = ["task.create", "task.update", ...JOB_ACTIONS];
const JOB_ID = /^\d{10,15}$/;
const RID = /^[A-Za-z0-9_-]{8,64}$/;

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
    out = finish(200, result, { ok: true, coll: "jobs", docId: jobId, fields: Object.keys(p.fields), itemId: p.itemId || null, before: p.before, after: p.after });
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
      default: return { refused: "unknown action" };
    }
  };
}
async function handle(body, io) {
  const b = body && typeof body === "object" ? body : {};
  const requestId = String(b.requestId || "");
  if (!RID.test(requestId)) throw new Refusal(400, "requestId must be 8–64 letters, digits, - or _.");
  if (!ACTIONS.includes(b.action)) throw new Refusal(400, `action must be one of ${ACTIONS.join(", ")}.`);
  const args = b.args && typeof b.args === "object" ? b.args : {};
  const email = String(b.email || "").slice(0, 120);

  // Same requestId → same answer, nothing written twice.
  const prior = await io.getAudit(requestId);
  if (prior && prior.response) return { status: prior.response.status || 200, body: { ...prior.response.body, replayed: true } };

  const nowIso = io.nowIso();
  const recent = await io.countRecent(new Date(Date.parse(nowIso) - 3600 * 1000).toISOString());
  if (recent >= RATE_PER_HOUR) throw new Refusal(429, `Duet has made ${recent} changes in the last hour — the limit is ${RATE_PER_HOUR}. Try again later.`);

  const ctx = { nowIso, bucketNow: `${io.todayYmd()}T12:00:00`, users: await io.getUsers(), rand: io.rand ? io.rand() : undefined, tz: io.tz };
  const base = { at: nowIso, action: b.action, by: SAVED_BY, email, requestId, expireAt: new Date(Date.parse(nowIso) + 90 * 86400 * 1000).toISOString() };
  const finish = (status, bodyOut, auditExtra) => ({ status, body: bodyOut, audit: { ...base, ...auditExtra, response: { status, body: bodyOut } } });

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

  if (JOB_ACTIONS.includes(b.action)) {
    const jobId = String(args.jobId || "");
    if (!JOB_ID.test(jobId)) return refused(400, "jobId must be the job's Command Center id (10–15 digits).", { coll: "jobs" });
    const r = await jobWrite(io, requestId, b.action, jobId, planJobAction(b.action, args, ctx), finish);
    return { status: r.status, body: r.body };
  }

  // task.update
  const needId = String(args.needId || "");
  if (!/^need_[0-9]+_[a-z0-9]{3,8}$|^toneed_/.test(needId)) return refused(400, "needId must be a task id like need_1730650000001_ab12c.", { coll: "needs" });
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

// Real Firestore io. Admin SDK: tx.create fails with ALREADY_EXISTS (code 6).
function firestoreIo({ db, FieldValue, getUsers, TZ }) {
  return {
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
    auditRef: (id) => db.collection(AUDIT).doc(id),
    arrayUnion: (...x) => FieldValue.arrayUnion(...x),
    serverTimestamp: () => FieldValue.serverTimestamp(),
    tz: TZ,
  };
}

module.exports = function makeDuetApi({ functions, db, FieldValue, getUsers, TZ }) {
  const io = firestoreIo({ db, FieldValue, getUsers, TZ });
  const duetApi = functions
    // invoker "public" like planRoutineApi: Google's door stays open so Vercel
    // can reach it; the bearer-token check is the gate.
    .runWith({ timeoutSeconds: 60, memory: "256MB", secrets: [SECRET], invoker: "public" })
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
