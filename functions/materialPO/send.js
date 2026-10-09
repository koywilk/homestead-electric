// Crew POs from the app — the sendMaterialPO callable.
// A crew member taps Send on a Material Tracking card (Rough or Finish). This:
//   1. checks who they are (name + live PIN, requireMember) and the mode,
//   2. claims the card in a transaction (one send per card, ever),
//   3. creates the PO in Simpro on the job's rough/finish cost center,
//   4. emails it (CED) or just hands back the number (store runs),
//   5. logs every step in material_po_log/{job_phase_card}.
// The card itself is updated by the app with the returned PO number.
//
// Mode lives on gc_config/material_po (function-only, like gc_config/mail):
//   mode: "test" (default when the doc is missing) | "live" | "off"
//   testTo: inbox for test sends (default gc_config/mail.soakTo)
//   from:   sender address (default gc_config/mail.from; live needs bids@ on a verified domain)
//   bids:   copied on every live send (default bids@homesteadelectric.net)
//   liveAccess: access tiers that may send when live (default every tier)
//   sender: "gmail" (default, 2026-10-09) | "resend" — gmail sends through Google
//           Workspace as gmailFrom (default bids@homesteadelectric.net) via the
//           po-mailer service account acting for gmailUser (default koy@); see gmail.js.
//           resend = the old orders@homesteadelectric.cc path (CED's Mimecast held it).
// Test: only admins can send, the email goes ONLY to testTo, nobody is copied,
// and the Simpro PO is real (marked TEST in its private notes) so it gets voided.
//
// Duplicate safety (review 2026-10-08):
//  - The claim is a Firestore transaction, so two devices / a retry can't both create.
//  - Everything needed to finish the send is written BEFORE the Simpro POST, with a
//    claim id that also goes into the PO's private notes. If the POST's answer is
//    lost, the next try searches Simpro's newest POs for that claim id and adopts
//    the PO instead of making a second one.
//  - The email is claimed too (emailingAt), so a tap during a send can't email twice.
"use strict";
const crypto = require("crypto");
const R = require("./rules.js");
// pdf.js needs pdf-lib (functions/package.json). Loaded on first use so the rules +
// simulation gates still load in the root build (Vercel), which has no functions deps.
let _pdf = null;
const buildPoPdf = (o) => { if (!_pdf) _pdf = require("./pdf.js"); return _pdf.buildPoPdf(o); };

const CREATE_STALE_MS = 3 * 60e3;   // a "creating" claim older than this was killed mid-send
const UNKNOWN_WAIT_MS = 60e3;       // after an unanswered POST, wait this long before checking Simpro
const EMAIL_STALE_MS = 90e3;        // an email claim older than this was killed mid-send
const POST_TIMEOUT_MS = 45e3;

module.exports = function makeMaterialPO({ functions, db, simproReqWithRetry, requireMember, accessOf, loadMailConfig, TZ, gmailSend = null }) {
  const HttpsError = functions.https.HttpsError;
  const CFG = () => db.collection("gc_config").doc("material_po");
  const LOG = () => db.collection("material_po_log");
  const T = (v) => String(v == null ? "" : v).trim();
  const nowIso = () => new Date().toISOString();
  const age = (iso) => Date.now() - (Date.parse(iso || 0) || 0);

  async function loadCfg() {
    const mail = await loadMailConfig();
    let c = {};
    try { const d = await CFG().get(); c = d.exists ? (d.data() || {}) : {}; } catch (e) {}
    const mode = ["off", "test", "live"].includes(T(c.mode)) ? T(c.mode) : "test";
    const liveAccess = Array.isArray(c.liveAccess) && c.liveAccess.length ? c.liveAccess : ["admin", "manager", "standard", "limited"];
    const sender = T(c.sender) === "resend" ? "resend" : "gmail";
    return { mode, liveAccess, testTo: T(c.testTo) || T(mail.soakTo), from: T(c.from) || T(mail.from), bids: T(c.bids) || "bids@homesteadelectric.net", key: T(mail.key),
      sender, gmailUser: T(c.gmailUser) || "koy@homesteadelectric.net", gmailFrom: T(c.gmailFrom) || "bids@homesteadelectric.net" };
  }

  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const simproErr = (r) => {
    const d = r && r.data;
    const msg = (d && Array.isArray(d.errors) && d.errors.map(e => e && e.message).filter(Boolean).join("; ")) || (typeof d === "string" ? d.slice(0, 200) : "");
    return `Simpro said ${r ? r.status : "nothing"}${msg ? `: ${msg}` : ""}`;
  };
  const okList = (r) => r && r.ok && Array.isArray(r.data);

  // Small per-instance caches: these lists change rarely.
  const cache = {};
  async function cached(name, ms, load) {
    const c = cache[name];
    if (c && Date.now() - c.at < ms) return c.v;
    const v = await load();
    cache[name] = { at: Date.now(), v };
    return v;
  }
  const vendors = () => cached("vendors", 10 * 60e3, async () => {
    const r = await simproReqWithRetry("GET", "/vendors/?pageSize=250&columns=ID,Name,Email");
    if (!okList(r)) throw new HttpsError("unavailable", `Couldn't read suppliers from Simpro. ${simproErr(r)}`);
    return r.data;
  });
  const storage = () => cached("storage", 60 * 60e3, async () => {
    const r = await simproReqWithRetry("GET", "/storageDevices/?pageSize=100&columns=ID,Name");
    return okList(r) ? r.data : [];
  });
  const statuses = () => cached("statuses", 60 * 60e3, async () => {
    const r = await simproReqWithRetry("GET", "/setup/statusCodes/vendorOrders/");
    return okList(r) ? r.data : [];
  });

  // The sender's signature comes from their Simpro employee record, same as
  // Simpro's own PO emails. Missing record → name only; never blocks a send.
  async function senderFor(name) {
    const fallback = { name, position: "", phone: "", email: "" };
    try {
      const list = await cached("employees", 30 * 60e3, async () => {
        const r = await simproReqWithRetry("GET", "/employees/?pageSize=250&columns=ID,Name");
        return okList(r) ? r.data : [];
      });
      const want = String(name || "").trim().toLowerCase();
      const hit = list.find(e => String(e.Name || "").trim().toLowerCase() === want);
      if (!hit) return fallback;
      const r = await simproReqWithRetry("GET", `/employees/${hit.ID}`);
      if (!r.ok || !r.data) return fallback;
      const pc = r.data.PrimaryContact || {};
      return { name: T(r.data.Name) || name, position: T(r.data.Position), phone: T(pc.CellPhone) || T(pc.WorkPhone), email: T(pc.Email) };
    } catch (e) { return fallback; }
  }

  async function costCenterFor(jobNo, phase) {
    const r = await simproReqWithRetry("GET", `/jobs/${encodeURIComponent(jobNo)}/sections/`);
    if (!okList(r)) throw new HttpsError("unavailable", `Couldn't read job ${jobNo} from Simpro. ${simproErr(r)}`);
    const sections = [...r.data].sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0));
    for (const s of sections) {
      const c = await simproReqWithRetry("GET", `/jobs/${encodeURIComponent(jobNo)}/sections/${s.ID}/costCenters/?columns=ID,Name,CostCenter`);
      const hit = R.pickCostCenter([{ ...s, ccs: okList(c) ? c.data : [] }], phase);
      if (hit) return hit;
    }
    return null;
  }

  // Did a lost POST actually make the PO? Look for our claim id in the newest POs.
  async function findByClaim(claimId) {
    if (!claimId) return null;
    const r = await simproReqWithRetry("GET", "/vendorOrders/?orderby=-ID&pageSize=50&columns=ID,PrivateNotes");
    if (!okList(r)) throw new HttpsError("unavailable", `Couldn't check Simpro for the earlier try. ${simproErr(r)} Try again in a minute.`);
    return r.data.find(o => String(o.PrivateNotes || "").includes(claimId)) || null;
  }

  async function sendMail(cfg, { to, cc, replyTo, subject, html, text, attachments }) {
    // Google Workspace first (CED's filter trusts homesteadelectric.net). A Google
    // failure is a visible failure (Send again) — never a quiet fall back to .cc.
    if (cfg.sender === "gmail" && gmailSend) {
      return gmailSend({ user: cfg.gmailUser, fromAddr: cfg.gmailFrom, to, cc, replyTo, subject, html, text, attachments });
    }
    if (!cfg.key) return { ok: false, error: "The email sender isn't set up (gc_config/mail has no key)." };
    if (!cfg.from) return { ok: false, error: "No sender address set." };
    const payload = { from: `Homestead Electric <${cfg.from}>`, to, subject: String(subject).slice(0, 200), html, text };
    if (cc && cc.length) payload.cc = cc;
    if (replyTo) payload.reply_to = replyTo;
    if (attachments && attachments.length) payload.attachments = attachments;
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + cfg.key, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) { let b = ""; try { b = (await resp.text()).slice(0, 300); } catch (e) {} return { ok: false, error: `Email service said ${resp.status} ${b}` }; }
      let id = ""; try { id = (await resp.json()).id || ""; } catch (e) {}
      return { ok: true, id };
    } catch (e) { return { ok: false, error: `Email didn't go out: ${e.message}` }; }
  }

  const company = () => cached("company", 60 * 60e3, async () => {
    const r = await simproReqWithRetry("GET", "");
    const d = (r && r.ok && r.data) || {};
    return { name: T(d.Name) || "Homestead Electric", addressLine: T(d.Address && (d.Address.Line1 || d.Address.Address)), phone: T(d.Phone), email: T(d.Email) };
  });

  // The PO form PDF, rebuilt from the log every time it's emailed (so a retry attaches it too).
  async function pdfFor(log) {
    // New Homestead PO form (PO 7224 layout), no prices for crew orders.
    const items = (log.items && log.items.length ? log.items : (log.lines || []).map(n => ({ part: "", name: n, qty: "" })));
    return buildPoPdf({
      poNo: log.poNo, vendorName: log.supplierName, vendorAddress: log.vendorAddress || [],
      dateOrdered: R.formDate(log.dateIssued), dateRequired: R.formDate(log.dueIso),
      jobNo: log.jobNo, jobSite: log.siteName || log.jobName, reference: log.reference, orderedBy: log.by,
      items, instructions: log.pickup ? [log.pickup] : [], company: log.company || {},
    });
  }

  // Test wins: if EITHER the config now or the PO when it was made says test,
  // the email goes only to the test inbox. A live PO is never emailed to the
  // supplier while the switch is on test.
  async function emailFor(cfg, log) {
    const mode = R.emailMode(cfg.mode, log.mode);
    const live = { to: log.vendorEmail, cc: [cfg.bids, log.sender && log.sender.email].filter(Boolean).join(", ") };
    const rcpt = R.recipients({ mode, testTo: cfg.testTo, vendorEmail: log.vendorEmail, bids: cfg.bids, senderEmail: log.sender && log.sender.email });
    if (!rcpt) return { ok: false, error: mode === "test" ? "No test inbox set (gc_config/material_po.testTo)." : "This supplier has no email address in Simpro." };
    let pdf = null, pdfError = "";
    try { pdf = await pdfFor(log); } catch (e) { pdfError = String(e.message || e).slice(0, 200); functions.logger.warn("[materialPO] PDF failed, sending the list in the email instead", { po: log.poNo, error: pdfError }); }
    const mail = R.buildPoEmail({ mode, poNo: log.poNo, jobName: log.jobName, supplierName: log.supplierName,
      lines: log.lines, pickup: log.pickup, sender: log.sender, intended: live, attached: !!pdf });
    const attachments = pdf ? [{ filename: `Purchase_Order_No_${log.poNo}.pdf`, content: pdf.toString("base64") }] : null;
    const res = await sendMail(cfg, { ...rcpt, ...mail, attachments });
    return { ...res, to: rcpt.to, cc: rcpt.cc, mode, pdf: !!pdf, pdfError };
  }

  async function markSent(simproPoId) {
    try {
      const st = (await statuses()).find(s => /sent to supplier/i.test(String(s.Name || "")));
      if (!st) { functions.logger.warn("[materialPO] no 'Sent to Supplier' status in Simpro", { simproPoId }); return false; }
      // Auto-adjust stays ON like a Simpro Mobile PO, so receipting moves it to Completed on its own
      // (verified on test PO 7249: Status 24 + auto true keeps "Sent to Supplier").
      const r = await simproReqWithRetry("PATCH", `/vendorOrders/${simproPoId}`, { Status: st.ID, StatusAutoAdjust: true });
      if (!r.ok) { functions.logger.warn("[materialPO] couldn't mark Sent to Supplier", { simproPoId, status: r.status, data: r.data }); return false; }
      return true;
    } catch (e) { functions.logger.warn("[materialPO] couldn't mark Sent to Supplier", { simproPoId, error: e.message }); return false; }
  }

  const result = (log, extra = {}) => ({
    poNo: log.poNo, kind: log.kind, mode: log.mode, supplier: log.supplierName, costCenter: log.costCenter,
    emailOk: !!log.emailOk, emailError: log.emailError || "", emailedTo: log.emailedTo || [], ...extra,
  });

  // Email step for a log that already has a PO number. Claims the email first.
  async function finishEmail(ref, cfg, log) {
    const claimed = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() || {};
      if (cur.emailOk) return { skip: true, cur };
      if (cur.emailingAt && age(cur.emailingAt) < EMAIL_STALE_MS) return { busy: true };
      tx.set(ref, { emailingAt: nowIso() }, { merge: true });
      return { cur };
    });
    if (claimed.busy) throw new HttpsError("already-exists", `PO ${log.poNo} is being emailed right now. Give it a minute, then refresh.`);
    if (claimed.skip) return result(claimed.cur, { again: true });
    const em = await emailFor(cfg, log);
    const sent = em.ok ? await markSent(log.simproPoId) : false;
    const upd = { status: "done", emailOk: !!em.ok, emailError: em.ok ? "" : (em.error || ""), emailedTo: em.to || [], emailMode: em.mode || "",
      pdfAttached: !!em.pdf, pdfError: em.pdfError || "",
      emailId: em.id || "", statusMarked: sent, emailingAt: null, doneAt: nowIso() };
    await ref.set(upd, { merge: true });
    if (!em.ok) functions.logger.warn("[materialPO] email failed", { po: log.poNo, error: em.error });
    return result({ ...log, ...upd });
  }

  // Who may send, in this mode, from this copy of the app.
  function gate(user, cfg, data) {
    const access = accessOf(user);
    if (cfg.mode === "off") throw new HttpsError("failed-precondition", "Sending POs from the app is turned off.");
    if (cfg.mode === "test" && access !== "admin") throw new HttpsError("permission-denied", "Sending POs from the app is still being tested. Only admins can send right now.");
    if (cfg.mode === "live" && !cfg.liveAccess.includes(access)) throw new HttpsError("permission-denied", "You can't send POs from the app.");
    // A copy of the app that still says "test" on its send sheet must never send for real.
    if (cfg.mode === "live" && data.clientTest !== false) throw new HttpsError("failed-precondition", "Update the app first: pull down to refresh, then send again.");
  }

  async function jobFor(jobId) {
    const jobSnap = await db.collection("jobs").doc(jobId).get();
    const job = (jobSnap.exists && (jobSnap.data() || {}).data) || null;
    if (!job) throw new HttpsError("not-found", "Couldn't find this job.");
    const jobNo = job.type === "quote" ? "" : T(job.simproNo);
    if (!jobNo) throw new HttpsError("failed-precondition", "Add the Simpro job number to this job first.");
    return { job, jobNo };
  }

  // Every job cost center on the Simpro job: {id, name, sectionName, costCenter}.
  async function jobCostCenters(jobNo) {
    const r = await simproReqWithRetry("GET", `/jobs/${encodeURIComponent(jobNo)}/sections/`);
    if (!okList(r)) throw new HttpsError("unavailable", `Couldn't read job ${jobNo} from Simpro. ${simproErr(r)}`);
    const out = [];
    for (const s of [...r.data].sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0))) {
      const c = await simproReqWithRetry("GET", `/jobs/${encodeURIComponent(jobNo)}/sections/${s.ID}/costCenters/?columns=ID,Name,CostCenter`);
      if (!okList(c)) throw new HttpsError("unavailable", `Couldn't read job ${jobNo}'s cost centers from Simpro. ${simproErr(c)}`);
      for (const cc of c.data) out.push({ id: cc.ID, name: T(cc.Name), sectionName: T(s.Name), costCenter: T(cc.CostCenter && cc.CostCenter.Name) });
    }
    return out;
  }

  // ── Make sure exactly one PO exists for `key` ─────────────────────────────
  // Claims the key in a transaction, recovers a PO whose Simpro answer was lost,
  // writes everything down before the POST, then creates. Never emails; the
  // caller decides. Returns { log, again } (again = it already existed).
  async function ensurePo({ ref, key, cfg, user, base, rule, lines, items, get, dueIso, pickCc, ccMissing }) {
    const claimId = "CC-" + crypto.randomBytes(5).toString("hex");
    const fresh = () => ({ status: "creating", claimId, startedAt: nowIso(), by: user.name, ...base, mode: cfg.mode, kind: rule.kind });
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let prev = snap.exists ? (snap.data() || {}) : null;
      // A test send doesn't count once the switch is live: park it, start fresh.
      if (prev && prev.mode === "test" && cfg.mode === "live") {
        tx.set(LOG().doc(`${key}__test_${Date.now()}`), { ...prev, archivedAt: nowIso() });
        prev = null;
      }
      if (!prev || prev.status === "failed") { tx.set(ref, fresh()); return { action: "create" }; }
      if (prev.poNo) return { action: "have", prev };
      if (prev.status === "creating" && age(prev.startedAt) < CREATE_STALE_MS) return { action: "busy" };
      if (prev.status === "unknown" && age(prev.unknownAt) < UNKNOWN_WAIT_MS) return { action: "wait" };
      return { action: "recover", prev };   // stale "creating" or "unknown": check Simpro before anything
    });
    if (claim.action === "busy") throw new HttpsError("already-exists", "This PO is already being sent. Give it a minute, then refresh.");
    if (claim.action === "wait") throw new HttpsError("unavailable", "Simpro didn't answer last time. Wait a minute and tap Send again; the app checks Simpro first so it can't make a second PO.");
    if (claim.action === "have") return { log: claim.prev, again: true };
    if (claim.action === "recover") {
      const p = claim.prev;
      const found = await findByClaim(p.claimId);
      if (found) {
        const log = { ...p, status: "created", poNo: String(found.ID), simproPoId: found.ID, recoveredAt: nowIso() };
        await ref.set(log, { merge: true });
        functions.logger.info("[materialPO] recovered a PO whose answer was lost", { key, po: log.poNo });
        if (log.kind !== "email") { await ref.set({ status: "done", doneAt: nowIso() }, { merge: true }); log.status = "done"; }
        return { log, again: true };
      }
      // Nothing in Simpro: re-claim (only if nobody else did meanwhile) and create.
      const re = await db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data() || {};
        if (cur.claimId !== p.claimId || cur.poNo) return false;
        tx.set(ref, fresh());
        return true;
      });
      if (!re) throw new HttpsError("already-exists", "This PO is already being sent. Give it a minute, then refresh.");
    }

    // ── Gather everything, write it down, then create ──
    let posted = false;
    try {
      const { job, jobNo } = await jobFor(base.jobId);
      const vendor = R.vendorFor(rule, await vendors());
      if (!vendor) throw new HttpsError("failed-precondition", `Couldn't find ${rule.simproName} in Simpro's suppliers.`);
      const cc = await pickCc(jobNo);
      if (!cc) throw new HttpsError("failed-precondition", ccMissing(jobNo));
      const jr = await simproReqWithRetry("GET", `/jobs/${encodeURIComponent(jobNo)}?columns=ID,Name,Site`);
      const jobName = T(jr && jr.ok && jr.data && jr.data.Name) || T(job.name) || `Job ${jobNo}`;
      // For the PO form: the job's site address, the supplier's branch address, our company block.
      // None of these block a send if Simpro won't give them up.
      let siteAddress = [], vendorAddress = [], companyBlock = {};
      const siteName = T(jr && jr.ok && jr.data && jr.data.Site && jr.data.Site.Name);
      try { const sid = jr && jr.ok && jr.data && jr.data.Site && jr.data.Site.ID; if (sid) { const sr = await simproReqWithRetry("GET", `/sites/${sid}`); if (sr.ok) siteAddress = R.addressLines(sr.data && sr.data.Address); } } catch (e) {}
      try { const vr = await simproReqWithRetry("GET", `/vendors/${vendor.ID}`); if (vr.ok) vendorAddress = R.addressLines(vr.data && vr.data.Address); } catch (e) {}
      try { companyBlock = await company(); } catch (e) {}
      const shop = (await storage()).find(s => /^shop$/i.test(T(s.Name)));
      const sender = await senderFor(user.name);
      const pickup = rule.kind === "email" ? R.pickupLine({ get, date: dueIso }) : "";

      const log = {
        kind: rule.kind, mode: cfg.mode, claimId, supplierName: rule.simproName, vendorId: vendor.ID, vendorEmail: T(vendor.Email),
        costCenter: cc.name, costCenterId: cc.id, jobNo, jobName, lines, items: items || [], pickup, get, dueIso, sender, by: user.name,
        reference: `Job No. ${jobNo} - ${jobName}`, dateIssued: today(), siteName, siteAddress, vendorAddress, company: companyBlock,
      };
      await ref.set(log, { merge: true });   // so a lost answer can be finished later

      const body = {
        Vendor: vendor.ID,
        AssignedTo: cc.id,
        Stage: "Approved",
        DateIssued: log.dateIssued,
        Reference: log.reference,
        VendorNotes: R.vendorNotesHtml(lines, pickup),
        PrivateNotes: (cfg.mode === "test"
          ? `<div><b>TEST from the Command Center</b> (${R.esc(user.name)}). Void this PO.</div>`
          : `<div>Sent from the Command Center by ${R.esc(user.name)}.</div>`)
          + (base.orderKey ? `<div>Part of one order with the other POs sent with it.</div>` : "")
          + `<div>${claimId}</div>`,
      };
      if (shop) body.StorageDevice = shop.ID;
      if (dueIso) body.DueDate = dueIso;

      posted = true;
      const cr = await Promise.race([
        simproReqWithRetry("POST", "/vendorOrders/", body, { maxAttempts: 1 }),
        new Promise((res) => setTimeout(() => res({ timedOut: true }), POST_TIMEOUT_MS)),
      ]);
      if (cr.timedOut || (cr.status >= 500) || (cr.ok && !(cr.data && cr.data.ID))) {
        // Simpro may or may not have made it. Never guess: mark unknown, check on the next try.
        await ref.set({ status: "unknown", unknownAt: nowIso(), error: cr.timedOut ? "Simpro didn't answer in time." : simproErr(cr) }, { merge: true });
        functions.logger.warn("[materialPO] Simpro create answer unclear", { key, status: cr.status, timedOut: !!cr.timedOut });
        throw new HttpsError("unavailable", "Simpro didn't answer clearly. Wait a minute and tap Send again; the app checks Simpro first so it can't make a second PO.");
      }
      if (!cr.ok) {
        await ref.set({ status: "failed", error: simproErr(cr).slice(0, 300), failedAt: nowIso() }, { merge: true });
        functions.logger.warn("[materialPO] Simpro create refused", { key, status: cr.status, data: cr.data });
        throw new HttpsError("internal", `Simpro didn't take the PO. ${simproErr(cr)}`);
      }
      const made = { ...log, status: "created", poNo: String(cr.data.ID), simproPoId: cr.data.ID, createdAt: nowIso() };
      await ref.set(made, { merge: true });
      functions.logger.info("[materialPO] created", { key, po: made.poNo, mode: cfg.mode, kind: rule.kind, by: user.name });
      if (rule.kind !== "email") { await ref.set({ status: "done", doneAt: nowIso() }, { merge: true }); made.status = "done"; }
      return { log: made, again: false };
    } catch (e) {
      // Failed before the POST went out: nothing exists in Simpro, so free the key.
      if (!posted) await ref.set({ status: "failed", error: String(e.message || e).slice(0, 300), failedAt: nowIso() }, { merge: true });
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", `Couldn't send the PO: ${e.message}`);
    }
  }

  // ── One card, one PO (Material Tracking card → Send to CED / Get a PO number) ──
  const sendMaterialPO = functions
    .runWith({ timeoutSeconds: 120, memory: "256MB" })
    .https.onCall(async (data) => {
      const user = await requireMember(data);
      const cfg = await loadCfg();
      gate(user, cfg, data);
      const jobId = T(data.jobId), phase = T(data.phase), orderId = T(data.orderId);
      const key = R.logKey(jobId, phase, orderId);
      if (!key) throw new HttpsError("invalid-argument", "Missing job, phase or card.");
      const rule = R.supplierRule(data.source);
      if (!rule) throw new HttpsError("invalid-argument", `The app can't send to ${T(data.source) || "that supplier"} yet. Pick CED, Home Depot, ACE or Amazon.`);
      const lines = R.itemsToLines(data.items);
      if (rule.kind === "email" && !lines.length) throw new HttpsError("invalid-argument", "Add the material list first.");
      const ref = LOG().doc(key);
      const { log, again } = await ensurePo({
        ref, key, cfg, user, base: { jobId, phase, orderId }, rule, lines, items: null,
        get: data.get === "deliver" ? "deliver" : "willcall", dueIso: R.cardDateToIso(data.date),
        pickCc: (jobNo) => costCenterFor(jobNo, phase),
        ccMissing: (jobNo) => `Couldn't find a ${phase === "rough" ? "Rough In" : "Finish"} cost center on Simpro job ${jobNo}.`,
      });
      if (log.kind === "email" && !log.emailOk) {
        const r = await finishEmail(ref, cfg, log);
        return again ? { ...r, again: true } : r;
      }
      return result(log, again ? { again: true } : {});
    });

  // ── One order from the bid → one PO per cost center, one email ─────────────
  // groups: [{ccId, items:[{catalogId, part, name, qty}], typed:[...]}] from the
  // order screen. Every cost center is checked against the job's Simpro bid.
  // POs are made one at a time; if one fails, the ones already made stay, the
  // answer says which failed, and Send again finishes the rest without remaking
  // any (each cost center has its own claim). The email goes once, after all
  // the POs exist, with one PO form per PO.
  async function finishOrderEmail(orderRef, cfg, made, orderBase) {
    const claimed = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(orderRef)).data() || {};
      const stale = cur.mode === "test" && cfg.mode === "live";
      // Already emailed: skip, unless this call made POs that email didn't carry
      // (a lost answer, then more added to the same order) — those get their own email.
      const done = new Set(stale ? [] : (cur.emailedPoNos || (cur.emailOk ? cur.poNos : []) || []).map(String));
      const fresh = made.filter(m => !done.has(String(m.log.poNo)));
      if (!fresh.length && done.size) return { skip: true, cur };
      if (!stale && cur.emailingAt && age(cur.emailingAt) < EMAIL_STALE_MS) return { busy: true };
      tx.set(orderRef, { ...orderBase, kind: "order", mode: cfg.mode, poKeys: made.map(m => m.key), poNos: made.map(m => m.log.poNo), emailingAt: nowIso(), emailOk: false }, { merge: true });
      return { cur, fresh, done: [...done] };
    });
    if (claimed.busy) throw new HttpsError("already-exists", "This order is being emailed right now. Give it a minute, then refresh.");
    if (claimed.skip) return { emailOk: true, emailedTo: claimed.cur.emailedTo || [], emailError: "", mode: claimed.cur.emailMode || claimed.cur.mode, again: true };
    const logs = claimed.fresh.map(m => m.log); // only POs no email has carried yet

    const first = logs[0];
    const mode = logs.some(l => R.emailMode(cfg.mode, l.mode) === "test") ? "test" : "live";
    const live = { to: first.vendorEmail, cc: [cfg.bids, first.sender && first.sender.email].filter(Boolean).join(", ") };
    const rcpt = R.recipients({ mode, testTo: cfg.testTo, vendorEmail: first.vendorEmail, bids: cfg.bids, senderEmail: first.sender && first.sender.email });
    let em;
    if (!rcpt) em = { ok: false, error: mode === "test" ? "No test inbox set (gc_config/material_po.testTo)." : "This supplier has no email address in Simpro." };
    else {
      const attachments = [];
      let allPdf = true;
      for (const l of logs) {
        try { const pdf = await pdfFor(l); attachments.push({ filename: `Purchase_Order_No_${l.poNo}.pdf`, content: pdf.toString("base64") }); }
        catch (e) { allPdf = false; functions.logger.warn("[materialPO] PDF failed in an order", { po: l.poNo, error: e.message }); }
      }
      const lines = allPdf ? [] : logs.flatMap(l => [`PO ${l.poNo} (${l.costCenter}):`, ...(l.lines || []), ""]);
      const mail = R.buildPoEmail({ mode, poNos: logs.map(l => l.poNo), jobName: first.jobName, supplierName: first.supplierName,
        lines, pickup: first.pickup, sender: first.sender, intended: live, attached: allPdf });
      em = { ...(await sendMail(cfg, { ...rcpt, ...mail, attachments })), to: rcpt.to };
    }
    const sent = {};
    if (em.ok) for (const l of logs) sent[l.poNo] = await markSent(l.simproPoId);
    const per = { emailOk: !!em.ok, emailError: em.ok ? "" : (em.error || ""), emailedTo: em.to || [], emailMode: mode, emailId: em.id || "" };
    for (const m of claimed.fresh) await LOG().doc(m.key).set({ ...per, status: em.ok ? "done" : m.log.status, statusMarked: !!sent[m.log.poNo], doneAt: nowIso() }, { merge: true });
    const emailedPoNos = em.ok ? [...claimed.done, ...logs.map(l => String(l.poNo))] : claimed.done;
    await orderRef.set({ ...per, emailedPoNos, emailingAt: null, doneAt: nowIso() }, { merge: true });
    if (!em.ok) functions.logger.warn("[materialPO] order email failed", { pos: logs.map(l => l.poNo), error: em.error });
    return { emailOk: !!em.ok, emailedTo: em.to || [], emailError: per.emailError, mode };
  }

  const sendMaterialOrder = functions
    .runWith({ timeoutSeconds: 300, memory: "256MB" })
    .https.onCall(async (data) => {
      const user = await requireMember(data);
      const cfg = await loadCfg();
      gate(user, cfg, data);
      const jobId = T(data.jobId), phase = T(data.phase), orderId = T(data.orderId);
      const orderKey = R.logKey(jobId, phase, orderId);
      if (!orderKey) throw new HttpsError("invalid-argument", "Missing job, phase or order.");
      const rule = R.supplierRule(data.source || "CED");
      if (!rule || rule.kind !== "email") throw new HttpsError("invalid-argument", "Orders from the bid go to CED for now.");
      const groups = R.cleanOrderGroups(data.groups);
      const resume = data.resume === true && !groups.length; // Finish sending from a card: email what the order already made
      if (!groups.length && !resume) throw new HttpsError("invalid-argument", "Add something to the order first.");
      const get = data.get === "deliver" ? "deliver" : "willcall";
      const dueIso = R.cardDateToIso(data.date);

      // Every cost center must be on this job's bid in Simpro right now.
      const { jobNo } = await jobFor(jobId);
      const onJob = new Map((await jobCostCenters(jobNo)).map(c => [Number(c.id), c]));
      const missing = groups.filter(g => !onJob.has(g.ccId));
      if (missing.length) throw new HttpsError("failed-precondition", "A cost center in this order isn't on the job's bid in Simpro anymore. Refresh Bid Items and build the order again.");

      // The order doc remembers every PO made for it (madeKeys), so a Send again
      // that no longer lists a cost center still emails that cost center's PO.
      const orderRef = LOG().doc(orderKey);
      const noteMade = (key) => db.runTransaction(async (tx) => {
        const cur = (await tx.get(orderRef)).data() || {};
        const keys = Array.isArray(cur.madeKeys) ? cur.madeKeys : [];
        if (!keys.includes(key)) tx.set(orderRef, { madeKeys: [...keys, key] }, { merge: true });
      });
      const addEarlier = async (made) => {
        const have = new Set(made.map(m => m.key));
        const keys = ((await orderRef.get()).data() || {}).madeKeys || [];
        for (const k of keys) {
          if (have.has(k)) continue;
          const snap = await LOG().doc(k).get();
          const l = snap.exists ? snap.data() : null;
          if (!l || !l.poNo || (l.mode === "test" && cfg.mode === "live")) continue;
          made.push({ key: k, ccId: l.ccId, log: l });
        }
        return made;
      };
      const posOf = (made) => made.map(m => ({ ccId: m.ccId, poNo: m.log.poNo, costCenter: m.log.costCenter, lines: m.log.lines }));

      const made = [];
      for (const g of groups) {
        const cc = onJob.get(g.ccId);
        const key = R.groupKey(orderKey, g.ccId);
        const lines = [...g.items.map(R.orderLine), ...g.typed];
        const items = [...g.items.map(i => ({ part: i.part, name: i.name, qty: i.qty })), ...g.typed.map(t => ({ part: "", name: t, qty: "" }))];
        try {
          const { log } = await ensurePo({
            ref: LOG().doc(key), key, cfg, user, base: { jobId, phase, orderId, orderKey, ccId: g.ccId }, rule, lines, items, get, dueIso,
            pickCc: async () => ({ id: cc.id, name: [cc.sectionName, cc.name].filter(Boolean).join(" · ") }),
            ccMissing: () => "That cost center isn't on the job's bid anymore.",
          });
          made.push({ key, ccId: g.ccId, log });
          await noteMade(key);
        } catch (e) {
          // Stop here. POs already made stay made; Send again finishes the rest.
          return { ok: false, mode: cfg.mode, pos: posOf(await addEarlier(made)),
            failed: { ccId: g.ccId, costCenter: [cc.sectionName, cc.name].filter(Boolean).join(" · "), error: String(e.message || e).slice(0, 300) } };
        }
      }
      await addEarlier(made);
      if (!made.length) throw new HttpsError("failed-precondition", "No POs were made for this order yet. Open New order from the bid to send it.");
      const em = await finishOrderEmail(orderRef, cfg, made, { jobId, phase, orderId, by: user.name });
      return { ok: true, mode: em.mode || cfg.mode, emailOk: em.emailOk, emailedTo: em.emailedTo, emailError: em.emailError || "", again: !!em.again,
        pos: posOf(made) };
    });

  return { sendMaterialPO, sendMaterialOrder };
};
