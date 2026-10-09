// Crew POs from the app — pure rules (no Firebase, no network).
// Tested by scripts/materialpo-test.js (prebuild chain).
// Vault: 03-Roadmap/Crew POs from the App.md
"use strict";

// Suppliers the crew picks on a Material Tracking card (MaterialOrders SOURCES)
// → how the app handles a send. "email" = create the Simpro PO and email it to
// the supplier. "number" = create the Simpro PO and hand back the number for a
// store run, no email. Anything else (Shop, Platt, Other, blank) can't be sent.
const SUPPLIERS = {
  "ced":          { kind: "email",  simproName: "CED" },
  "home depot":   { kind: "number", simproName: "Home Depot" },
  "amazon":       { kind: "number", simproName: "Amazon" },
  "ace hardware": { kind: "number", simproName: "ACE Hardware" },
  "ace":          { kind: "number", simproName: "ACE Hardware" },
};
function supplierRule(source) {
  return SUPPLIERS[String(source || "").trim().toLowerCase()] || null;
}

// Simpro vendor for a supplier rule: exact name match, case-insensitive.
// ("ACE Hardware" must not match "Ace Rentals".)
function vendorFor(rule, vendors) {
  if (!rule) return null;
  const want = rule.simproName.toLowerCase();
  return (vendors || []).find(v => String((v && v.Name) || "").trim().toLowerCase() === want) || null;
}

// Which job cost center a PO is charged to. sections = [{ID, DisplayOrder,
// ccs:[{ID, Name, CostCenter:{Name}}]}]. Earliest section first (Base), then the
// first job cost center whose company cost center matches the phase. Simpro
// Mobile charged PO 7236 to the Base section's "Rough In" line, same rule.
const PHASE_RE = { rough: /rough/i, finish: /finish|trim/i };
function pickCostCenter(sections, phase) {
  const re = PHASE_RE[phase];
  if (!re) return null;
  const ordered = [...(sections || [])].sort((a, b) => (Number(a.DisplayOrder) || 0) - (Number(b.DisplayOrder) || 0));
  for (const s of ordered) {
    for (const cc of (s && s.ccs) || []) {
      const company = cc && cc.CostCenter && cc.CostCenter.Name;
      if (company && re.test(company)) return { id: cc.ID, name: String(cc.Name || "").trim(), costCenter: company, sectionId: s.ID };
    }
  }
  return null;
}

// The card stores the list as HTML (<br>, <div>, entities). One clean line per item.
function itemsToLines(items) {
  return String(items || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"')
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean)
    .slice(0, 200);
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "2026-10-09" → "Fri 10/9". Bad or empty input → "".
function shortDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return "";
  return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]} ${+m[2]}/${+m[3]}`;
}
// M/D/YYYY (the card's own date format) → YYYY-MM-DD.
function cardDateToIso(s) {
  const t = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

// "2026-10-09" → "10/09/2026" (Simpro's PO form format). Bad input → "".
function formDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m && shortDate(iso) ? `${m[2]}/${m[3]}/${m[1]}` : "";
}
// Simpro address object → the two lines the form prints.
function addressLines(a) {
  if (!a) return [];
  const T = (v) => String(v == null ? "" : v).trim();
  const street = T(a.Address || a.Line1);
  const city = [T(a.City), [T(a.State), T(a.PostalCode)].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  return [street, city].filter(Boolean);
}

function pickupLine({ get, date }) {
  const when = shortDate(date);
  if (get === "deliver") return when ? `Please deliver to the job on ${when}.` : "Please deliver to the job.";
  return when ? `For will call on ${when} please.` : "For will call please.";
}

// What lands in Simpro's VendorNotes ("Supplier Notes") — same shape crews paste today.
function vendorNotesHtml(lines, pickup) {
  const out = [];
  if (pickup) out.push(`<div>${esc(pickup)}</div><div>&nbsp;</div>`);
  for (const l of lines || []) out.push(`<div>${esc(l)}</div>`);
  return out.join("");
}

// Who gets the email. Test: ONLY the test inbox, nobody copied. Live: the
// supplier, with bids@ and the sender copied, replies to the sender.
function recipients({ mode, testTo, vendorEmail, bids, senderEmail }) {
  const ok = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
  if (mode === "test") return ok(testTo) ? { to: [testTo], cc: [], replyTo: "" } : null;
  if (mode !== "live" || !ok(vendorEmail)) return null;
  const cc = [bids, senderEmail].filter(ok).filter((e, i, a) => a.indexOf(e) === i && e !== vendorEmail);
  return { to: [vendorEmail], cc, replyTo: ok(senderEmail) ? senderEmail : (ok(bids) ? bids : "") };
}

// The email, modeled on Simpro's own PO email (2026-10-07 template).
// "7262" / "7262 and 7263" / "7262, 7263 and 7264"
function poList(nums) {
  const n = (nums || []).map(String).filter(Boolean);
  return n.length <= 1 ? (n[0] || "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

function buildPoEmail({ mode, poNo, poNos, jobName, supplierName, lines, pickup, sender, intended, attached = false }) {
  const s = sender || {};
  const nums = (poNos && poNos.length ? poNos : [poNo]).map(String).filter(Boolean);
  const many = nums.length > 1;
  poNo = poList(nums);
  const subject = `${mode === "test" ? "[TEST] " : ""}${many ? `POs ${poList(nums).replace(" and ", " & ")}` : `PO ${poNo}`} – ${jobName} – Homestead Electric`;
  const list = (lines || []).map(l => `<li style="margin:0 0 2px">${esc(l)}</li>`).join("");
  const sig = [esc(s.name), esc(s.position), esc(s.phone), s.email ? esc(s.email) : "", "homesteadelectric.net"].filter(Boolean).join("<br>");
  const testBanner = mode === "test" ? `
<div style="border:2px solid #3B5BA5;border-radius:8px;padding:10px 12px;margin:0 0 16px;background:#EEF2FA;color:#1B1F24">
  <b>TEST from the Command Center.</b> Only you got this. Live, it would go to ${esc(supplierName)}${intended && intended.to ? ` (${esc(intended.to)})` : ""} with ${esc((intended && intended.cc) || "bids@ and the sender")} copied.
  Simpro PO${many ? "s" : ""} ${esc(poNo)} ${many ? "were" : "was"} really created. Void it in Simpro when you're done looking.
</div>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1B1F24;max-width:600px">${testBanner}
<p style="margin:0 0 12px">Hi ${esc(supplierName)},</p>
<p style="margin:0 0 12px">${attached ? `Purchase order${many ? "s" : ""} <b>${esc(poNo)}</b> for <b>${esc(jobName)}</b> ${many ? "are" : "is"} attached.` : `Here ${many ? "are purchase orders" : "is purchase order"} <b>${esc(poNo)}</b> for <b>${esc(jobName)}</b>.`} Please reference ${many ? "each PO number" : "this PO number"} on your invoice, packing slip and delivery ticket.</p>
${pickup ? `<p style="margin:0 0 12px"><b>${esc(pickup)}</b></p>` : ""}
${attached ? "" : `<ul style="margin:0 0 12px;padding-left:20px">${list}</ul>`}
<p style="margin:0 0 12px">Reply to this email with any part number corrections, substitutions or backorders before the order ships.</p>
<p style="margin:0">Thank you,<br>${sig}</p>
</div>`;
  const text = [
    mode === "test" ? "TEST from the Command Center. Only you got this.\n" : "",
    `Hi ${supplierName},`, "",
    `${attached ? `Purchase order${many ? "s" : ""} ${poNo} for ${jobName} ${many ? "are" : "is"} attached.` : `Here ${many ? "are purchase orders" : "is purchase order"} ${poNo} for ${jobName}.`} Please reference ${many ? "each PO number" : "this PO number"} on your invoice, packing slip and delivery ticket.`, "",
    pickup || "", "",
    ...(attached ? [] : (lines || []).map(l => `- ${l}`)), "",
    "Reply to this email with any part number corrections, substitutions or backorders before the order ships.", "",
    "Thank you,", s.name || "", s.position || "", s.phone || "", s.email || "", "homesteadelectric.net",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  return { subject, html, text };
}

// Test wins: if the switch says test now, or the PO was made in test, the email
// is a test email (only the test inbox). A live PO is never emailed to the
// supplier while the switch is on test.
function emailMode(cfgMode, logMode) {
  return (cfgMode === "test" || logMode === "test") ? "test" : (cfgMode === "live" && logMode === "live" ? "live" : "test");
}

// ── Orders from the bid (one order → one PO per cost center) ──────────────
// What the crew sends: [{ccId, items:[{catalogId, part, name, qty}], typed:[...]}].
// Cleaned hard on the server: whole numbers for ids, quantities rounded to 2
// places and capped, text trimmed and capped, empty groups dropped, a cost
// center listed twice merged. Order is kept (it's the job's section order).
function cleanOrderGroups(groups) {
  const T = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const byCc = new Map();
  for (const g of Array.isArray(groups) ? groups.slice(0, 12) : []) {
    const ccId = Number(g && g.ccId);
    if (!Number.isInteger(ccId) || ccId <= 0) continue;
    const cur = byCc.get(ccId) || { ccId, items: [], typed: [] };
    for (const it of Array.isArray(g.items) ? g.items.slice(0, 200) : []) {
      const qty = Math.round(Number(it && it.qty) * 100) / 100;
      const catalogId = Number(it && it.catalogId);
      if (!(qty > 0) || qty > 100000 || !Number.isInteger(catalogId) || catalogId <= 0) continue;
      const name = T(it.name, 160), part = T(it.part, 60);
      if (!name && !part) continue;
      const same = cur.items.find(x => x.catalogId === catalogId);
      if (same) same.qty = Math.round((same.qty + qty) * 100) / 100; else cur.items.push({ catalogId, part, name, qty });
    }
    for (const t of Array.isArray(g.typed) ? g.typed.slice(0, 60) : []) { const v = T(t, 200); if (v) cur.typed.push(v); }
    byCc.set(ccId, cur);
  }
  return [...byCc.values()].filter(g => g.items.length || g.typed.length).slice(0, 10);
}
// One text line per bid item for the PO's Supplier Notes: "249 x R3-15B RAB R3-15B 2" Wafer".
function orderLine(it) {
  return [`${it.qty} x`, it.part, it.name].filter(Boolean).join(" ");
}
// PO key for one cost center inside an order.
function groupKey(orderKey, ccId) {
  const id = Number(ccId);
  return orderKey && Number.isInteger(id) && id > 0 ? `${orderKey}-cc${id}` : "";
}

// One send per card. A double-tap or a retry after a dropped connection finds
// the same key and gets the same PO back instead of a second PO.
function logKey(jobId, phase, orderId) {
  const clean = (v) => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  const job = String(jobId || "").replace(/[^A-Za-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const k = `${job}_${clean(phase)}_${clean(orderId)}`;
  return /^[A-Za-z0-9-]+_(rough|finish)_[A-Za-z0-9_-]+$/.test(k) ? k : "";
}

module.exports = { SUPPLIERS, supplierRule, vendorFor, pickCostCenter, itemsToLines, shortDate, cardDateToIso,
  pickupLine, vendorNotesHtml, recipients, buildPoEmail, emailMode, logKey, esc, formDate, addressLines,
  poList, cleanOrderGroups, orderLine, groupKey };
