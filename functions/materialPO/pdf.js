// Crew POs from the app — the PO form PDF attached to the supplier email.
// Laid out to match Simpro's own "Order w/o prices" PDF (Purchase_Order_No_####.pdf,
// e.g. PO 7237, 2026-10-08): logo top left, company block top right, PURCHASE ORDER
// NO. heading, two label/value columns, "Delivery Address and Special Instructions",
// Approved By lines, Page n/N. No prices, same as Simpro's.
"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const LOGO_JPG = require("./logo.js");

const PAGE_W = 612, PAGE_H = 792;           // US Letter, points
const INK = rgb(0, 0, 0), GREY = rgb(0.35, 0.35, 0.35);
const SIZE = 10.5, LEAD = 12.6;

// Standard PDF fonts only carry Windows-1252. Keep what it has (incl. ’ “ ” – —),
// swap the rest for something readable instead of crashing the send.
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function clean(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’′]/g, "’").replace(/[“”″]/g, "”")
    .replace(/½/g, "1/2").replace(/[\t\r]/g, " ")
    .split("").map(c => c === "\n" || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127) || (c.charCodeAt(0) >= 160 && c.charCodeAt(0) < 256) || WIN_EXTRA.includes(c) ? c : "?").join("");
}

function wrap(text, font, size, width) {
  const out = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (font.widthOfTextAtSize(next.trimEnd(), size) <= width || !line.trim()) { line = next; continue; }
      out.push(line.trimEnd()); line = w.trimStart();
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {   // one very long word
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * @param {object} o
 *   poNo, vendorName, vendorBranch, vendorAddress[], dateOrdered (MM/DD/YYYY),
 *   dateRequired, jobName, siteAddress[], reference, orderedBy,
 *   lines[] (the instructions block; "" = blank line),
 *   company {name, addressLine, phone, email}
 * @returns {Promise<Buffer>}
 */
async function buildPoPdf(o) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase Order No. ${o.poNo}`);
  doc.setAuthor(clean((o.company && o.company.name) || "Homestead Electric"));
  doc.setCreator("Homestead Electric Command Center");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedJpg(LOGO_JPG);

  const pages = [];
  const newPage = () => { const p = doc.addPage([PAGE_W, PAGE_H]); pages.push(p); return p; };
  const text = (p, s, x, yTop, font = reg, size = SIZE, color = INK) =>
    p.drawText(clean(s), { x, y: PAGE_H - yTop - size, size, font, color });

  let page = newPage();

  // Company block, top right (from Simpro's company record).
  const c = o.company || {};
  let cy = 28;
  text(page, c.name || "Homestead Electric", 415, cy, bold); cy += LEAD;
  for (const l of wrap(c.addressLine || "", reg, SIZE, 165)) { text(page, l, 415, cy); cy += LEAD; }
  if (c.phone) { text(page, `Tel. ${c.phone}`, 415, cy); cy += LEAD; }
  if (c.email) { text(page, c.email, 415, cy); cy += LEAD; }

  // Logo, top left.
  const lw = 162, lh = lw * (logo.height / logo.width);
  page.drawImage(logo, { x: 83, y: PAGE_H - 82 - lh, width: lw, height: lh });

  // Heading, right aligned.
  const heading = `PURCHASE ORDER NO. ${o.poNo}`;
  page.drawText(clean(heading), { x: 577 - bold.widthOfTextAtSize(clean(heading), 14), y: PAGE_H - 172 - 14, size: 14, font: bold, color: INK });

  // Two label/value columns.
  const cols = [
    { lx: 31, vx: 169, vw: 128, rows: [["Vendor:", o.vendorName], ["Vendor Branch:", o.vendorBranch || "-"], ["Branch Address:", (o.vendorAddress || []).join("\n")]] },
    { lx: 307, vx: 444, vw: 136, rows: [["Date Ordered:", o.dateOrdered], ["Date Required:", o.dateRequired], ["Job Name:", o.jobName],
      ["Site Address:", (o.siteAddress || []).join("\n")], ["Reference:", o.reference], ["Ordered By:", o.orderedBy]] },
  ];
  let bottom = 0;
  for (const col of cols) {
    let y = 200;
    for (const [label, value] of col.rows) {
      text(page, label, col.lx, y, bold);
      const vl = value ? wrap(value, reg, SIZE, col.vw) : [""];
      vl.forEach((l, i) => text(page, l, col.vx, y + i * LEAD));
      y += Math.max(1, vl.length) * LEAD;
    }
    bottom = Math.max(bottom, y);
  }

  // Instructions — the order itself. Flows onto more pages if it has to.
  let y = bottom + 18;
  text(page, "Delivery Address and Special Instructions", 31, y, bold); y += LEAD;
  const FOOTER_TOP = PAGE_H - 62;
  for (const raw of (o.lines || [])) {
    const ls = raw === "" ? [""] : wrap(raw, reg, SIZE, 540);
    for (const l of ls) {
      if (y + LEAD > FOOTER_TOP) { page = newPage(); y = 40; }
      if (l) text(page, l, 31, y);
      y += LEAD;
    }
  }

  // Approved By on the last page, page numbers on all.
  const last = pages[pages.length - 1];
  text(last, "Approved By", 37, PAGE_H - 52, bold, 9);
  for (const [x, cap] of [[116, "Print Name"], [271, "Signature"]]) {
    last.drawLine({ start: { x, y: 40 }, end: { x: x + 145, y: 40 }, thickness: 0.6, color: INK });
    last.drawText(cap, { x: x + 72 - reg.widthOfTextAtSize(cap, 6) / 2, y: 32, size: 6, font: reg, color: GREY });
  }
  pages.forEach((p, i) => {
    const s = `Page ${i + 1}/${pages.length}`;
    p.drawText(s, { x: PAGE_W / 2 - reg.widthOfTextAtSize(s, 8) / 2, y: 8, size: 8, font: reg, color: INK });
  });

  return Buffer.from(await doc.save());
}

module.exports = { buildPoPdf, clean, wrap };
