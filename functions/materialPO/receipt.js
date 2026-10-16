// Store-run receipts (SW v548) — the attachStoreReceipt callable.
// A Home Depot / ACE / Amazon card on Material Tracking with a PO number gets
// "Add receipt photo". The app shrinks the photo to about 1 MB and sends it here:
//   1. who (name + live PIN, requireMember) and whether they may send POs,
//   2. the number on the card must be a store PO on THIS job's Simpro job
//      (the Battle Creek card held "1412", the job number, in its PO box),
//   3. the photo is claimed in material_receipt_log/{job_phase_card__r_receipt}
//      in a transaction, so a double tap or a retry never attaches it twice,
//   4. POST /vendorOrders/{id}/attachments/files/ {Filename, Base64Data}
//      (tested on PO 7285, 2026-10-16: 201, byte-identical on download).
// checkOnly:true runs step 2 alone (the sheet calls it when it opens, so a wrong
// number is caught before anyone uploads a photo).
//
// Lost answers: everything is written down before the POST. If Simpro's answer
// is lost (timeout, 5xx), the claim is marked unknown and the next try looks
// for the exact filename on the PO before uploading again.
// Vault: 03-Roadmap/Crew POs from the App.md › "Receipt photo on store runs".
"use strict";
const crypto = require("crypto");
const R = require("./rules.js");

const UPLOAD_STALE_MS = 3 * 60e3;   // an "uploading" claim older than this was killed mid-send
const UNKNOWN_WAIT_MS = 60e3;       // after an unanswered POST, wait this long before checking Simpro
const POST_TIMEOUT_MS = 60e3;
const BUSY_WAIT_MS = 25e3;          // a second tap waits this long for the first to finish

module.exports = function makeReceipt({ functions, db, simproReqWithRetry, requireMember, accessOf, TZ, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  const HttpsError = functions.https.HttpsError;
  const CFG = () => db.collection("gc_config").doc("material_po");
  const LOG = () => db.collection("material_receipt_log");
  const T = (v) => String(v == null ? "" : v).trim();
  const nowIso = () => new Date().toISOString();
  const age = (iso) => Date.now() - (Date.parse(iso || 0) || 0);
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const simproErr = (r) => {
    const d = r && r.data;
    const msg = (d && Array.isArray(d.errors) && d.errors.map(e => e && e.message).filter(Boolean).join("; ")) || (typeof d === "string" ? d.slice(0, 200) : "");
    return `Simpro said ${r ? r.status : "nothing"}${msg ? `: ${msg}` : ""}`;
  };

  // Same switch as PO sends (gc_config/material_po). receipts:"off" turns off
  // just this. Test mode = admins only, like sending.
  async function gate(user) {
    let c = {};
    try { const d = await CFG().get(); c = d.exists ? (d.data() || {}) : {}; } catch (e) {}
    const mode = ["off", "test", "live"].includes(T(c.mode)) ? T(c.mode) : "test";
    const liveAccess = Array.isArray(c.liveAccess) && c.liveAccess.length ? c.liveAccess : ["admin", "manager", "standard", "limited"];
    const access = accessOf(user);
    if (mode === "off" || T(c.receipts) === "off") throw new HttpsError("failed-precondition", "Adding receipts from the app is turned off.");
    if (mode === "test" && access !== "admin") throw new HttpsError("permission-denied", "Receipts from the app are still being tested. Only admins can add them right now.");
    if (!liveAccess.includes(access)) throw new HttpsError("permission-denied", "You can't add receipts to POs from the app.");
  }

  async function jobNoFor(jobId) {
    const snap = await db.collection("jobs").doc(jobId).get();
    const job = (snap.exists && (snap.data() || {}).data) || null;
    if (!job) throw new HttpsError("not-found", "Couldn't find this job.");
    const jobNo = job.type === "quote" ? "" : T(job.simproNo);
    if (!jobNo) throw new HttpsError("failed-precondition", "Add the Simpro job number to this job first.");
    return jobNo;
  }

  // The PO from Simpro, checked against this job. Throws the plain refusal.
  async function checkedPo({ jobId, typed, source }) {
    const jobNo = await jobNoFor(jobId);
    const poNo = R.cleanPoNo(typed);
    let po = null;
    if (poNo) {
      const r = await simproReqWithRetry("GET", `/vendorOrders/${encodeURIComponent(poNo)}`);
      if (r.ok && r.data && typeof r.data === "object") po = r.data;
      else if (r.status !== 404) throw new HttpsError("unavailable", `Couldn't read PO ${poNo} from Simpro. ${simproErr(r)} Try again in a minute.`);
    }
    const c = R.checkStorePo({ po, typed, poNo, jobNo, source });
    if (!c.ok) throw new HttpsError("failed-precondition", c.error, { badPo: !!c.badPo, po: T(typed) });
    return { poNo, jobNo, vendor: c.vendor, simproPoId: po.ID, costCenter: T(po.AssignedTo && po.AssignedTo.CostCenter && po.AssignedTo.CostCenter.Name) };
  }

  async function filesOn(simproPoId) {
    const r = await simproReqWithRetry("GET", `/vendorOrders/${simproPoId}/attachments/files/?pageSize=250`);
    if (!r.ok || !Array.isArray(r.data)) throw new HttpsError("unavailable", `Couldn't read PO ${simproPoId}'s attachments from Simpro. ${simproErr(r)} Try again in a minute.`);
    return r.data;
  }

  const result = (log, extra = {}) => ({ ok: true, poNo: log.poNo, fileName: log.fileName, simproFileId: T(log.simproFileId),
    vendor: log.vendor || "", by: log.by, at: log.doneAt || "", ...extra });

  const attachStoreReceipt = functions
    .runWith({ timeoutSeconds: 120, memory: "512MB" })
    .https.onCall(async (data) => {
      const user = await requireMember(data);
      await gate(user);
      const jobId = T(data.jobId), phase = T(data.phase), orderId = T(data.orderId);
      const source = T(data.source);
      if (!R.supplierRule(source) || R.supplierRule(source).kind !== "number") throw new HttpsError("invalid-argument", "Receipts go on Home Depot, ACE and Amazon cards.");

      if (data.checkOnly === true) {
        if (!jobId) throw new HttpsError("invalid-argument", "Missing the job.");
        const c = await checkedPo({ jobId, typed: data.po, source });
        return { ok: true, check: true, poNo: c.poNo, vendor: c.vendor, jobNo: c.jobNo, costCenter: c.costCenter };
      }

      const key = R.receiptKey(jobId, phase, orderId, data.receiptId);
      if (!key) throw new HttpsError("invalid-argument", "Missing job, phase, card or photo.");
      const photo = R.decodeReceiptPhoto(data.photo);
      if (photo.error) throw new HttpsError("invalid-argument", photo.error);
      const md5 = crypto.createHash("md5").update(photo.buf).digest("hex");
      const ref = LOG().doc(key);

      // ── Claim (one upload per photo, ever) ──
      const claimId = "RC-" + crypto.randomBytes(5).toString("hex");
      const fresh = () => ({ status: "checking", claimId, startedAt: nowIso(), by: user.name, jobId, phase, orderId, receiptId: T(data.receiptId), typed: T(data.po), md5, bytes: photo.buf.length });
      const tryClaim = () => db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? (snap.data() || {}) : null;
        if (!prev || prev.status === "failed") { tx.set(ref, fresh()); return { action: "go" }; }
        if (prev.status === "done") return { action: "have", prev };
        if (["checking", "uploading"].includes(prev.status) && age(prev.startedAt) < UPLOAD_STALE_MS) return { action: "busy" };
        if (prev.status === "unknown" && age(prev.unknownAt) < UNKNOWN_WAIT_MS) return { action: "wait" };
        return { action: "recover", prev };
      });
      let claim = await tryClaim();
      // A second tap while the first is still going: wait for it rather than fail.
      for (let waited = 0; claim.action === "busy" && waited < BUSY_WAIT_MS; waited += 1000) {
        await sleep(1000);
        claim = await tryClaim();
      }
      if (claim.action === "busy") throw new HttpsError("already-exists", "This photo is already being added. Give it a minute, then refresh.");
      if (claim.action === "wait") throw new HttpsError("unavailable", "Simpro didn't answer last time. Wait a minute and tap Attach again; the app checks the PO first so the photo can't go on twice.");
      if (claim.action === "have") return result(claim.prev, { again: true });
      if (claim.action === "recover") {
        const p = claim.prev;
        if (p.simproPoId && p.fileName) {
          const hit = (await filesOn(p.simproPoId)).find(f => T(f.Filename || f.Name) === p.fileName);
          if (hit) {
            const done = { ...p, status: "done", simproFileId: T(hit.ID), doneAt: nowIso(), recoveredAt: nowIso() };
            await ref.set(done, { merge: true });
            functions.logger.info("[receipt] recovered an upload whose answer was lost", { key, po: p.poNo });
            return result(done, { again: true });
          }
        }
        const re = await db.runTransaction(async (tx) => {
          const cur = (await tx.get(ref)).data() || {};
          if (cur.claimId !== p.claimId || cur.status === "done") return false;
          tx.set(ref, fresh());
          return true;
        });
        if (!re) throw new HttpsError("already-exists", "This photo is already being added. Give it a minute, then refresh.");
      }

      // ── Check the PO, name the file, write it down, then upload ──
      let posted = false;
      try {
        const c = await checkedPo({ jobId, typed: data.po, source });
        const n = R.receiptCount(await filesOn(c.simproPoId), c.poNo) + 1;
        const fileName = R.receiptFileName(c.poNo, user.name, today(), n);
        const log = { status: "uploading", startedAt: nowIso(), poNo: c.poNo, simproPoId: c.simproPoId, jobNo: c.jobNo, vendor: c.vendor, fileName };
        await ref.set(log, { merge: true });   // so a lost answer can be found later

        posted = true;
        const cr = await Promise.race([
          simproReqWithRetry("POST", `/vendorOrders/${c.simproPoId}/attachments/files/`, { Filename: fileName, Base64Data: photo.buf.toString("base64") }, { maxAttempts: 1 }),
          new Promise((res) => setTimeout(() => res({ timedOut: true }), POST_TIMEOUT_MS)),
        ]);
        if (cr.timedOut || cr.status >= 500) {
          await ref.set({ status: "unknown", unknownAt: nowIso(), error: cr.timedOut ? "Simpro didn't answer in time." : simproErr(cr) }, { merge: true });
          functions.logger.warn("[receipt] Simpro upload answer unclear", { key, status: cr.status, timedOut: !!cr.timedOut });
          throw new HttpsError("unavailable", "Simpro didn't answer clearly. Wait a minute and tap Attach again; the app checks the PO first so the photo can't go on twice.");
        }
        if (!cr.ok) {
          await ref.set({ status: "failed", error: simproErr(cr).slice(0, 300), failedAt: nowIso() }, { merge: true });
          functions.logger.warn("[receipt] Simpro refused the upload", { key, status: cr.status, data: cr.data });
          throw new HttpsError("internal", `Simpro didn't take the photo. ${simproErr(cr)}`);
        }
        const done = { ...log, status: "done", by: user.name, simproFileId: T(cr.data && cr.data.ID), doneAt: nowIso() };
        await ref.set(done, { merge: true });
        functions.logger.info("[receipt] attached", { key, po: c.poNo, file: fileName, bytes: photo.buf.length, by: user.name });
        return result(done);
      } catch (e) {
        // Failed before the POST went out: nothing is on the PO, so free the claim.
        if (!posted) await ref.set({ status: "failed", error: String(e.message || e).slice(0, 300), failedAt: nowIso() }, { merge: true });
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("internal", `Couldn't add the receipt: ${e.message}`);
      }
    });

  return { attachStoreReceipt };
};
