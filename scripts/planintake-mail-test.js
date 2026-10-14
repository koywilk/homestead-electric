// Plan-intake email rules tests — run: node scripts/planintake-mail-test.js (in the prebuild chain)
// Senders/subjects modeled on Koy's real Sep–Oct 2026 PDF mail.
"use strict";
const M = require("../functions/planIntake/mail.js");
const assert = require("assert");
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const b64 = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const msg = (from, subject, { extra = [], parts = [] } = {}) => ({
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...extra], parts } });
const pdf = (name, id = "att1") => ({ filename: name, mimeType: "application/pdf", body: { attachmentId: id, size: 1000 } });

// skip rules
const skips = [
  [msg("Homestead Bids <bids@homesteadelectric.net>", "Quote/Change Order Approved - Tuhaye Hollow"), "quote/CO approval"],
  [msg("bids@homesteadelectric.net", "Quote no. 3183 - Sandlin Residence - Sandlin Residence - Tuhaye"), "quote/CO approval"],
  [msg("Callen <callenjakeman83@gmail.com>", "Purchase Order no. 7194 - Nguyen Residence"), "purchase order"],
  // Simpro's new PO template (2026-10-07 on) and CED's replies to it — real subjects from Koy's inbox.
  [msg("Homestead Electric <bids@homesteadelectric.net>", "PO 7236 – Miller Residence – Homestead Electric"), "purchase order"],
  [msg("bids@homesteadelectric.net", "PO 7234 – Bridlewood Lane Residence - Midway – Homestead Electric"), "purchase order"],
  [msg("Chloe Hill <chloe@cedaf.com>", "RE: PO 7236 – Miller Residence – Homestead Electric"), "purchase order"],
  [msg("Brayden <brayden@cedaf.com>", "RE: PO 7235 – 23 Vista Meadows – Homestead Electric"), "purchase order"],
  [msg("keegan@homesteadelectric.net", "Fwd: PO 7240 - Oak Hill 5"), "purchase order"],
  [msg("Home Depot <HomeDepot@order.homedepot.com>", "Your Electronic Receipt"), "receipt"],
  [msg("Google <esignature-noreply@google.com>", "eSigned Document Ready: \"Foreman Responsibilities\""), "eSignature"],
  [msg("HBA <hbautah2@hbautah2.gmuser.net>", "Don't Miss This!", { extra: [{ name: "List-Unsubscribe", value: "<mailto:x>" }] }), "newsletter"],
];
for (const [m, why] of skips) eq(M.skipReason(m), why, `skip: ${M.header(m, "Subject")}`);
const keeps = [
  msg("Josh <josh@homesteadelectric.net>", "Fwd: Plans"),
  msg("Brady <brady@homesteadelectric.net>", "Fwd: Young residence complete lighting plans"),
  msg("cassmosier@gmail.com", "Mosier Project Drawing_V5"),
  msg("Wes <wes@harwoodhomesllc.com>", "Re: Following up on quote 3214 - Sandlin Residence Lighting Control"),
  msg("bids@homesteadelectric.net", "Plans for Oak Hill 5"),                                      // bids@ but not an approval
  msg("Wes <wes@harwoodhomesllc.com>", "PO box change for the Sandlin plans"),                     // "PO" without a number
  msg("gc@builder.com", "Plans attached - PO 123 for lot 7"),                                       // PO number not leading the subject
  msg("Josh <josh@homesteadelectric.net>", "Polaris Ridge plans"),                                  // starts with "Po"
  msg("Dropbox <no-reply@dropboxmail.com>", "Jake shared \"Bellini Garage\" with you", { extra: [{ name: "List-Unsubscribe", value: "<x>" }] }),
  msg("Google Drive <drive-shares-dm-noreply@google.com>", "Item shared with you: \"Koplin set\"", { extra: [{ name: "List-Unsubscribe", value: "<x>" }] }),
];
// Via OUR bids@ Google Group: every message carries the group's list headers (2026-10-04 replay).
const viaBids = [{ name: "List-ID", value: "<bids.homesteadelectric.net>" }, { name: "Precedence", value: "list" },
  { name: "Mailing-list", value: "list bids@homesteadelectric.net; contact bids+owners@homesteadelectric.net" },
  { name: "List-Unsubscribe", value: "<mailto:googlegroups-manage+790156725398+unsubscribe@googlegroups.com>" }];
keeps.push(
  msg("Josh <josh@homesteadelectric.net>", "Fwd: Plans", { extra: viaBids }),
  msg("cassmosier@gmail.com", "Mosier Project Drawing_V5", { extra: viaBids }),
  msg("jake@stratfordcreations.com", "Bid for Bellini Garage", { extra: viaBids }),
);
for (const m of keeps) eq(M.skipReason(m), "", `keep: ${M.header(m, "Subject")}`);
eq(M.skipReason(msg("Quantum <malmitchell@quantumltg.com>", "Quantum Fall Showcase 2026 - TOMORROW!", { extra: [{ name: "List-Unsubscribe", value: "<x>" }, { name: "List-ID", value: "<news.quantumltg.com>" }] })), "newsletter", "an outside list is still a newsletter");
eq(M.skipReason(msg("bids@homesteadelectric.net", "Quote/Change Order Approved - Rose Residence", { extra: viaBids })), "quote/CO approval", "Simpro approvals via the group still skipped");
eq(M.skipReason(msg("keegan@homesteadelectric.net", "Purchase Order no. 7117 - Skyridge Lot 208", { extra: viaBids })), "purchase order", "POs via the group still skipped");
eq(M.senderEmail(msg("Josh Cloward <JOSH@homesteadelectric.net>", "x")), "josh@homesteadelectric.net", "sender email lowercased from a display name");

// attachments (nested multipart, non-PDFs ignored)
const nested = msg("a@b.com", "x", { parts: [
  { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("see attached") } }] },
  pdf("Koplin Full Plan Set.pdf", "A"), { filename: "logo.png", mimeType: "image/png", body: { attachmentId: "B", size: 5 } },
  { mimeType: "multipart/mixed", parts: [pdf("SPECS.PDF", "C"), { filename: "noext", mimeType: "application/pdf", body: { attachmentId: "D", size: 9 } }] },
] });
eq(M.pdfParts(nested).map(p => p.attachmentId), ["A", "C", "D"], "every PDF in the MIME tree, images skipped");
eq(M.pdfParts(msg("x", "Fwd: plans + order", { parts: [pdf("Purchase_Order_No_7236.pdf", "PO"), pdf("Miller E1.pdf", "PLAN")] })).map(p => p.attachmentId),
  ["PLAN"], "Simpro's own PO PDF is never ingested as a plan");
eq(M.bodyText(nested).trim(), "see attached", "plain body decoded");

// share links
const text = `Plans here https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing
and https://www.dropbox.com/scl/fi/abc123/Bellini.pdf?rlkey=xyz&dl=0. Also https://app.box.com/s/k9j8h7g6 and again
https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345`;
const links = M.shareLinks(text);
eq(links.map(l => l.kind), ["drive", "dropbox", "box"], "drive + dropbox + box, duplicates collapsed");
eq(links[0].id, "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", "drive file id");
eq(links[1].direct, "https://www.dropbox.com/scl/fi/abc123/Bellini.pdf?rlkey=xyz&dl=1", "dropbox switched to direct download");
eq(M.shareLinks("https://www.dropbox.com/s/q1w2/set.pdf")[0].direct, "https://www.dropbox.com/s/q1w2/set.pdf?dl=1", "dl=1 added when missing");
eq(M.shareLinks("no links here"), [], "no links");

// file names (Koy: spec name + original)
eq(M.filedName({ number: "1430", kind: "job", rev: "2", date: "2026-10-04", original: "Brandnt - Post Redline Walk.pdf" }),
  "#1430 – Rev 2 – 2026-10-04 – Brandnt - Post Redline Walk.pdf", "job name");
eq(M.filedName({ number: "Q2642", kind: "quote", date: "2026-10-04", original: "set.PDF" }), "Q2642 – 2026-10-04 – set.pdf", "quote, no rev");
eq(M.filedName({ number: "#1443", kind: "job", rev: "Rev C", original: "a/b.pdf" }), "#1443 – Rev C – a-b.pdf", "rev prefix normalized, slash cleaned, bad date dropped");

// category folders inside MOST UPDATED
eq(M.categoryFolder("plans", ["DESIGN"]), { name: "", existing: true }, "full sets go in MOST UPDATED itself");
eq(M.categoryFolder("cabinet", ["DESIGN", "CABINET PLANS", "SPECS"]), { name: "CABINET PLANS", existing: true }, "standard folder");
eq(M.categoryFolder("appliance", ["Cabinet + Appliance Specs"]), { name: "Cabinet + Appliance Specs", existing: true }, "combined folder reused");
eq(M.categoryFolder("specs", ["Cabinet + Appliance Specs", "SPECS"]), { name: "SPECS", existing: true }, "specs never lands in the cabinet/appliance folder");
eq(M.categoryFolder("specs", ["Cabinet + Appliance Specs"]), { name: "SPECS", existing: false }, "…and makes SPECS when only the combined one exists");
eq(M.categoryFolder("redlines", []), { name: "REDLINES", existing: false }, "standard name when missing");
eq(M.categoryFolder("invoice", []), null, "unknown category refused");

console.log("planintake-mail-test: skip rules, attachments, links, names, categories passed");
