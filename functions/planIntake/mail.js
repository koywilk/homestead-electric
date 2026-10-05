// planIntake/mail.js — PURE rules for Phase 2 email intake (PLAN_INTAKE_SPEC.md,
// Koy 2026-10-04). No I/O: the watcher hands in Gmail API message objects
// (format "full") and acts on what these return. Classifying a PDF as a plan
// set, and matching it to a job, is judgment — that is the Routine's, not here.
"use strict";

const header = (msg, name) => {
  const h = ((msg && msg.payload && msg.payload.headers) || []).find(x => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? String(h.value || "") : "";
};
const senderEmail = (msg) => {
  const f = header(msg, "From");
  const m = f.match(/<([^>]+)>/);
  return String(m ? m[1] : f).trim().toLowerCase();
};

// Koy's skip rules ("yes" to all four, 2026-10-04). Returns a reason or "".
function skipReason(msg) {
  const from = senderEmail(msg);
  const subject = header(msg, "Subject");
  if (from === "bids@homesteadelectric.net" && /quote\s*\/\s*change order approved|^quote no\.|quote no\. \d+/i.test(subject)) return "quote/CO approval";
  if (/\bpurchase order no\.?\s*\d+/i.test(subject)) return "purchase order";
  if (/esignature-noreply@google\.com$/.test(from) || /^esigned document/i.test(subject)) return "eSignature";
  if (/(^|\.)homedepot\.com$|(^|\.)lowes\.com$|(^|\.)amazon\.com$/.test(from.split("@")[1] || "")
    || /\b(your (electronic )?receipt|order confirmation|your order)\b/i.test(subject)) return "receipt";
  // Share notifications carry an unsubscribe header too but can BE the plans
  // ("Dropbox: X shared a folder with you") — never drop those as newsletters.
  const shareService = /(^|\.)(dropbox(mail)?\.com|box\.com|google\.com|buildertrend\.(com|net)|procore\.com|coconstruct\.com|wetransfer\.com)$/.test(from.split("@")[1] || "");
  // Mail that reaches Koy through one of OUR Google Groups (bids@ …) carries the
  // group's own List-* / Precedence headers — on every message, real plans
  // included ("Fwd: Plans" from Josh, 2026-10-04 replay: 28 of 32 "newsletters"
  // were bids@ mail). Group headers say nothing about the email itself, so they
  // never count; the Routine dismisses any marketing that comes that way.
  const listId = header(msg, "List-ID");
  const ownGroup = /homesteadelectric\.net>?\s*$/i.test(listId) || /\bhomesteadelectric\.net\b/i.test(header(msg, "Mailing-list"));
  if (!shareService && !ownGroup && (header(msg, "List-Unsubscribe") || /^(newsletter|marketing)@/.test(from))) return "newsletter";
  return "";
}

// Every PDF attachment in the MIME tree.
function pdfParts(msg) {
  const out = [];
  const walk = (p) => {
    if (!p) return;
    const name = String(p.filename || "");
    const id = p.body && p.body.attachmentId;
    if (id && (/\.pdf$/i.test(name) || /application\/pdf/i.test(p.mimeType || ""))) {
      out.push({ attachmentId: id, filename: name || "attachment.pdf", size: Number(p.body.size) || 0 });
    }
    (p.parts || []).forEach(walk);
  };
  walk(msg && msg.payload);
  return out;
}

// Plain-text body (for share links + the Routine's context), base64url-decoded.
function bodyText(msg) {
  const chunks = [];
  const walk = (p) => {
    if (!p) return;
    if (/^text\/(plain|html)/i.test(p.mimeType || "") && p.body && p.body.data) {
      let t = Buffer.from(String(p.body.data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/html/i.test(p.mimeType)) t = t.replace(/<a [^>]*href="([^"]+)"[^>]*>/gi, " $1 ").replace(/<[^>]+>/g, " ");
      chunks.push(t);
    }
    (p.parts || []).forEach(walk);
  };
  walk(msg && msg.payload);
  return chunks.join("\n").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").slice(0, 20000);
}

// Plan links in the body. Drive files are copied by id; Dropbox links are
// fetched with dl=1; Box links can't be fetched without Box's API, so they
// are passed to the Routine as a link to look at.
function shareLinks(text) {
  const out = [], seen = new Set();
  const add = (o) => { if (!seen.has(o.key)) { seen.add(o.key); out.push(o); } };
  const s = String(text || "");
  for (const m of s.matchAll(/https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([\w-]{20,})/g)) add({ kind: "drive", id: m[1], url: m[0], key: `drive:${m[1]}` });
  for (const m of s.matchAll(/https?:\/\/(?:www\.)?dropbox\.com\/(?:s|scl\/fi)\/[^\s"'<>)]+/g)) {
    const url = m[0].replace(/[.,;]+$/, "");
    const direct = /[?&]dl=\d/.test(url) ? url.replace(/([?&])dl=\d/, "$1dl=1") : `${url}${url.includes("?") ? "&" : "?"}dl=1`;
    add({ kind: "dropbox", url, direct, key: `dropbox:${url.split("?")[0]}` });
  }
  for (const m of s.matchAll(/https?:\/\/(?:app\.)?box\.com\/s\/[\w]+/g)) add({ kind: "box", url: m[0], key: `box:${m[0]}` });
  return out;
}

// Koy's file name: "#1430 – Rev 2 – 2026-10-04 – Brandnt Post Redline Walk.pdf"
// (quotes "Q2642 – …"). rev and date are optional; the original name is kept.
function filedName({ number, kind, rev, date, original }) {
  const n = String(number || "").replace(/^[#Q]/i, "");
  const head = kind === "quote" ? `Q${n}` : `#${n}`;
  const orig = String(original || "plans.pdf").replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim();
  const base = orig.replace(/\.pdf$/i, "");
  const parts = [head];
  if (rev !== undefined && rev !== null && String(rev).trim() !== "") parts.push(`Rev ${String(rev).replace(/^rev\.?\s*/i, "").trim()}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) parts.push(String(date));
  parts.push(base);
  return `${parts.join(" – ")}.pdf`;
}

// Which folder inside MOST UPDATED a category goes to. children = existing
// subfolder names. An existing folder of another spelling wins ("Cabinet +
// Appliance Specs" takes both cabinets and appliances); otherwise the standard
// name. "plans" (a full / electrical set) goes in MOST UPDATED itself → "".
const CATEGORIES = {
  plans: { std: "", re: null },
  cabinet: { std: "CABINET PLANS", re: /cabinet/i },
  appliance: { std: "APPLIANCE SPECS", re: /appliance/i },
  design: { std: "DESIGN", re: /design/i },
  specs: { std: "SPECS", re: /spec/i },
  redlines: { std: "REDLINES", re: /red\s*line/i },
};
function categoryFolder(category, children = []) {
  const c = CATEGORIES[String(category || "").toLowerCase()];
  if (!c) return null;                       // unknown category → caller refuses the decision
  if (!c.re) return { name: "", existing: true };
  // "specs" must not grab "Cabinet + Appliance Specs"; prefer a folder that is only specs.
  const hits = children.filter(n => c.re.test(n));
  const best = category === "specs" ? hits.find(n => !/cabinet|appliance/i.test(n)) : hits[0];
  return best ? { name: best, existing: true } : { name: c.std, existing: false };
}

module.exports = { header, senderEmail, skipReason, pdfParts, bodyText, shareLinks, filedName, categoryFolder, CATEGORIES };
