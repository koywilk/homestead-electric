// PO email through Google Workspace (Gmail API) — 2026-10-09.
// Why: CED's mail runs through Mimecast, which held PO 7250 sent from the
// brand-new lookalike domain homesteadelectric.cc. Mail from the real
// homesteadelectric.net (Google SPF + DKIM) is what CED's filter already trusts.
//
// How (no stored passwords or tokens):
//  - Service account po-mailer@homestead-electric (no roles) is authorized by the
//    Workspace admin (Josh, 2026-10-09) for domain-wide delegation with ONE scope,
//    gmail.send — it can send mail, never read it.
//  - The functions' own account (homestead-electric@appspot, Token Creator on
//    po-mailer) asks Google to sign a short-lived JWT as po-mailer acting for
//    gc_config/material_po.gmailUser (default koy@homesteadelectric.net), trades
//    it for a 1-hour access token, and sends From: bids@homesteadelectric.net
//    (a Google Group set up under that user's Gmail "Send mail as").
//  - On any failure the PO email fails visibly (Send again) — it never falls back
//    to the .cc address.
//   poMailerTest — open in a browser: sends one test email from bids@ to the
//                  gmailUser only (nobody else), at most once a minute.
"use strict";
const crypto = require("crypto");

const SA = "po-mailer@homestead-electric.iam.gserviceaccount.com";
const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_USER = "koy@homesteadelectric.net";
const DEFAULT_FROM = "bids@homesteadelectric.net";

// ── MIME (pure; tested in scripts/materialpo-test.js) ──
const oneLine = (v) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();
const wrap76 = (b64) => (String(b64).replace(/\s+/g, "").match(/.{1,76}/g) || []).join("\r\n");
const b64 = (s) => Buffer.from(String(s == null ? "" : s), "utf8").toString("base64");
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrList = (a) => (Array.isArray(a) ? a : [a]).map(oneLine).filter(Boolean).join(", ");
const safeName = (n) => oneLine(n).replace(/["\\]/g, "_").slice(0, 120) || "attachment.pdf";

function buildMime({ from, to, cc, replyTo, subject, html, text, attachments, boundarySeed }) {
  const seed = boundarySeed || crypto.randomBytes(8).toString("hex");
  const mixed = `=_hePO_m_${seed}`, alt = `=_hePO_a_${seed}`;
  const head = [`From: ${oneLine(from)}`, `To: ${addrList(to)}`];
  if (cc && cc.length) head.push(`Cc: ${addrList(cc)}`);
  if (replyTo) head.push(`Reply-To: ${oneLine(replyTo)}`);
  head.push(`Subject: ${encWord(oneLine(subject))}`, "MIME-Version: 1.0");
  const altBlock = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap76(b64(text || "")),
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", wrap76(b64(html || "")),
    `--${alt}--`,
  ].join("\r\n");
  const atts = Array.isArray(attachments) ? attachments.filter(a => a && a.content) : [];
  if (!atts.length) return head.join("\r\n") + "\r\n" + altBlock + "\r\n";
  const parts = [`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, altBlock];
  for (const a of atts) {
    const fn = safeName(a.filename);
    const type = oneLine(a.contentType) || (/\.pdf$/i.test(fn) ? "application/pdf" : "application/octet-stream");
    parts.push(`--${mixed}`, `Content-Type: ${type}; name="${fn}"`, `Content-Disposition: attachment; filename="${fn}"`,
      "Content-Transfer-Encoding: base64", "", wrap76(a.content));
  }
  parts.push(`--${mixed}--`);
  return head.join("\r\n") + "\r\n" + parts.join("\r\n") + "\r\n";
}

module.exports = function makePoGmail({ functions, db, fetchImpl }) {
  const F = fetchImpl || ((...a) => fetch(...a));
  const CFG = () => db.collection("gc_config").doc("material_po");
  let cached = { user: "", token: "", until: 0 };

  async function runtimeToken() {
    const r = await F("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } });
    if (!r.ok) throw new Error(`couldn't get the server's own token (${r.status})`);
    return (await r.json()).access_token;
  }

  // A 1-hour Gmail send token for `user`, signed as po-mailer (domain-wide delegation).
  async function gmailToken(user) {
    if (cached.user === user && cached.until > Date.now() + 60e3) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: SA, sub: user, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
    const rt = await runtimeToken();
    const s = await F(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SA)}:signJwt`, {
      method: "POST", headers: { Authorization: `Bearer ${rt}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: JSON.stringify(claims) }),
    });
    if (!s.ok) throw new Error(`Google wouldn't sign for po-mailer (${s.status}) ${(await s.text()).slice(0, 160)}`);
    const { signedJwt } = await s.json();
    const t = await F("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedJwt }).toString(),
    });
    if (!t.ok) throw new Error(`Google refused the send permission (${t.status}) ${(await t.text()).slice(0, 160)}`);
    const j = await t.json();
    cached = { user, token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  // Send one email as `user`, From `fromAddr`. Returns { ok, id } or { ok:false, error }.
  async function send({ user, fromAddr, to, cc, replyTo, subject, html, text, attachments }) {
    try {
      const mime = buildMime({ from: `Homestead Electric <${fromAddr || DEFAULT_FROM}>`, to, cc, replyTo, subject, html, text, attachments });
      const token = await gmailToken(user || DEFAULT_USER);
      const r = await F("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "message/rfc822" }, body: mime,
      });
      if (!r.ok) return { ok: false, error: `Gmail said ${r.status} ${(await r.text()).slice(0, 200)}` };
      const d = await r.json().catch(() => ({}));
      return { ok: true, id: d.id || "", via: "gmail" };
    } catch (e) {
      functions.logger.warn("[poGmail] send failed", { error: e && e.message });
      return { ok: false, error: `Google email: ${String((e && e.message) || e).slice(0, 220)}` };
    }
  }

  // One test email from bids@ to the sending user only. At most once a minute.
  const test = functions.https.onRequest(async (req, res) => {
    const page = (status, title, body) => res.status(status).set("Content-Type", "text/html; charset=utf-8").send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 18px;color:#1B1F24;line-height:1.5"><h2>${title}</h2>${body}</div>`);
    const esc = (s) => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    try {
      const gate = db.collection("gc_config").doc("po_mailer_test");
      const ok = await db.runTransaction(async (tx) => {
        const last = ((await tx.get(gate)).data() || {}).at;
        if (last && Date.now() - Date.parse(last) < 60e3) return false;
        tx.set(gate, { at: new Date().toISOString() });
        return true;
      });
      if (!ok) return page(429, "Wait a minute", "<p>A test just went out. Try again in a minute.</p>");
      const c = (await CFG().get()).data() || {};
      const user = String(c.gmailUser || DEFAULT_USER), fromAddr = String(c.gmailFrom || DEFAULT_FROM);
      const r = await send({ user, fromAddr, to: [user], subject: "PO email test from the Command Center",
        text: `If this shows as from ${fromAddr}, PO emails are ready to go out through Google.`,
        html: `<p>If this shows as from <b>${esc(fromAddr)}</b>, PO emails are ready to go out through Google.</p>` });
      return r.ok
        ? page(200, "Test sent ✓", `<p>A test email went from <b>${esc(fromAddr)}</b> to <b>${esc(user)}</b>. Check the From line in your inbox.</p>`)
        : page(500, "Test failed", `<p>${esc(r.error)}</p>`);
    } catch (e) {
      return page(500, "Test failed", `<p>${esc(e && e.message)}</p>`);
    }
  });

  return { send, test };
};
module.exports.buildMime = buildMime;
module.exports.SA = SA;
