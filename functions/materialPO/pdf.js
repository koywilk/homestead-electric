// Crew POs from the app — the PO form PDF attached to the supplier email.
// Laid out to match Homestead's newer Simpro PO form (PO 7224, Koy 2026-10-08:
// "this would be the correct po attachment"): cream paper with a thin copper
// frame, centered longhorn logo, "Purchase Order" title, Supplier / PO No. block,
// Job No. / Job Site / Reference / Ordered By, ORDER ITEMS table, DELIVERY &
// SPECIAL INSTRUCTIONS, approval lines, "Questions about this order? Call our office."
// Koy: "price would be left off of this for the crews" — so no Unit Price, Total,
// Freight, Tax or Purchase Order Total. Part #, Item and Qty only.
"use strict";
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const LOGO_PNG = require("./logo.js");

const W = 612, H = 792;                                  // US Letter, points
const PAPER = rgb(0.957, 0.929, 0.875);                  // cream
const INK = rgb(0.16, 0.13, 0.10);                       // warm near-black
const COPPER = rgb(0.64, 0.45, 0.25);                    // labels + accents
const RULE = rgb(0.78, 0.65, 0.49);                      // hairlines
const L = 54, R = 558;                                   // content edges

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
 *   poNo, vendorName, vendorAddress[], dateOrdered (MM/DD/YYYY), dateRequired,
 *   jobNo, jobSite, reference, orderedBy, supplierQuote,
 *   items[] {part, name, qty}   (typed lines: part "" and qty "")
 *   instructions[]              (pickup / delivery line, notes)
 *   company {name, addressLine, phone, email}
 * @returns {Promise<Buffer>}
 */
async function buildPoPdf(o) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase Order No. ${o.poNo}`);
  doc.setAuthor(clean((o.company && o.company.name) || "Homestead Electric"));
  doc.setCreator("Homestead Electric Command Center");
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifB = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifI = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(LOGO_PNG);

  const pages = [];
  // y is measured from the top of the page; size is the font size.
  const T = (p, s, x, y, font, size, color = INK) => p.drawText(clean(s), { x, y: H - y - size * 0.8, size, font, color });
  const TR = (p, s, xr, y, font, size, color = INK) => T(p, s, xr - font.widthOfTextAtSize(clean(s), size), y, font, size, color);
  // Letter-spaced small caps labels, like the form's SUPPLIER / PO NO.
  const spacedWidth = (s, size, track) => clean(s).split("").reduce((w, c) => w + sans.widthOfTextAtSize(c, size) + track, -track);
  const LBL = (p, s, x, y, { size = 7.2, track = 1.5, color = COPPER, font = sans, right = false } = {}) => {
    let cx = right ? x - spacedWidth(s, size, track) : x;
    for (const c of clean(s).toUpperCase()) { p.drawText(c, { x: cx, y: H - y - size * 0.8, size, font, color }); cx += font.widthOfTextAtSize(c, size) + track; }
  };
  const HR = (p, y, x1 = L, x2 = R, t = 0.6, color = RULE) => p.drawLine({ start: { x: x1, y: H - y }, end: { x: x2, y: H - y }, thickness: t, color });

  const newPage = () => {
    const p = doc.addPage([W, H]);
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
    p.drawRectangle({ x: 25, y: 25, width: W - 50, height: H - 50, borderColor: COPPER, borderWidth: 0.7 });
    p.drawRectangle({ x: 28, y: 28, width: W - 56, height: H - 56, borderColor: RULE, borderWidth: 0.35 });
    pages.push(p);
    return p;
  };

  let p = newPage();
  // Logo + title.
  const lw = 135, lh = lw * (logo.height / logo.width);
  p.drawImage(logo, { x: (W - lw) / 2, y: H - 64 - lh, width: lw, height: lh });
  const title = "Purchase Order";
  T(p, title, (W - serif.widthOfTextAtSize(title, 25)) / 2, 153, serif, 25);
  const sub = "Please reference our PO number on all invoices, packing slips and delivery tickets.";
  T(p, sub, (W - serifI.widthOfTextAtSize(sub, 9.5)) / 2, 183, serifI, 9.5);
  HR(p, 201);

  // Supplier | PO No.
  LBL(p, "Supplier", L, 209);
  T(p, o.vendorName || "", L, 220, serifB, 11.5);
  let vy = 234;
  for (const line of (o.vendorAddress || []).slice(0, 2)) { T(p, line, L, vy, serif, 9.5); vy += 12; }
  LBL(p, "PO No.", R, 209, { right: true });
  TR(p, String(o.poNo || ""), R, 220, serifB, 11.5);
  const ordered = o.dateOrdered || "";
  TR(p, ordered, R, 234, serif, 9.5);
  TR(p, "Ordered", R - serif.widthOfTextAtSize(clean(ordered), 9.5) - (ordered ? 4 : 0), 234, serifI, 9.5);
  const req = o.dateRequired || "";
  TR(p, req, R, 246, serif, 9.5);
  TR(p, "Required", R - serif.widthOfTextAtSize(clean(req), 9.5) - (req ? 4 : 0), 246, serifI, 9.5);
  HR(p, Math.max(vy, 258) + 6);

  // Job block.
  let jy = Math.max(vy, 258) + 22;
  const left = [["Job No.", o.jobNo], ["Job Site", o.jobSite], ["Reference", o.reference]];
  const right = [["Supplier Quote", o.supplierQuote || ""], ["Ordered By", o.orderedBy]];
  let ly = jy;
  for (const [k, v] of left) {
    LBL(p, k, L, ly + 1.5);
    const vl = v ? wrap(v, serif, 9.5, 190) : [""];
    vl.forEach((line, i) => T(p, line, 139, ly + i * 12, serif, 9.5));
    ly += Math.max(1, vl.length) * 12 + 1.5;
  }
  let ry = jy;
  for (const [k, v] of right) {
    LBL(p, k, 342, ry + 1.5);
    const vl = v ? wrap(v, serif, 9.5, 130) : [""];
    vl.forEach((line, i) => T(p, line, 427, ry + i * 12, serif, 9.5));
    ry += Math.max(1, vl.length) * 12 + 1.5;
  }
  let y = Math.max(ly, ry) + 22;
  HR(p, y, L - 2, R + 2, 0.4);

  // Order items: Part # | Item | Qty — no prices on the crew's PO.
  y += 14;
  LBL(p, "Order Items", L, y, { size: 8.5, track: 2, font: sansB });
  y += 14;
  HR(p, y, L, R, 0.6, COPPER);
  const colItem = 139, itemW = 470 - colItem;
  const header = (pp, yy) => { LBL(pp, "Part #", L, yy + 4, { size: 6.8 }); LBL(pp, "Item", colItem, yy + 4, { size: 6.8 }); LBL(pp, "Qty", R, yy + 4, { size: 6.8, right: true }); HR(pp, yy + 14); return yy + 18; };
  y = header(p, y);
  const FOOT_TOP = H - 210;     // leave room for instructions, approvals and footer on the last page
  const items = (o.items || []).filter(it => it && (it.name || it.part));
  for (const it of items) {
    const lines = wrap(it.name || "", serif, 10, itemW);
    const h = Math.max(1, lines.length) * 12.5 + 4;
    if (y + h > H - 70) { p = newPage(); y = 60; y = header(p, y); }
    if (it.part) T(p, it.part, L, y, sans, 9);
    lines.forEach((line, i) => T(p, line, colItem, y + i * 12.5, serif, 10));
    if (it.qty !== "" && it.qty != null) TR(p, String(it.qty), R, y, sans, 9.5);
    y += h; HR(p, y - 3, L, R, 0.35);
  }
  if (!items.length) { T(p, "See delivery and special instructions.", colItem, y, serifI, 10); y += 18; }

  // Delivery & special instructions, approvals, footer.
  const instr = (o.instructions || []).filter(s => s !== undefined);
  const instrLines = [];
  for (const s of instr) instrLines.push(...(s === "" ? [""] : wrap(s, serif, 10, R - L)));
  const needed = 40 + Math.max(1, instrLines.length) * 12.5 + 120;
  if (y + needed > H - 40) { p = newPage(); y = 60; }
  y += 24;
  LBL(p, "Delivery & Special Instructions", L, y, { size: 8.5, track: 2, font: sansB });
  y += 14; HR(p, y, L - 2, R + 2, 0.4);
  y += 10;
  for (const line of instrLines) { if (line) T(p, line, L, y, serif, 10); y += 12.5; }

  const ay = Math.max(y + 40, H - 170);
  p.drawLine({ start: { x: L, y: H - ay }, end: { x: 297, y: H - ay }, thickness: 0.6, color: RULE });
  p.drawLine({ start: { x: 315, y: H - ay }, end: { x: 541, y: H - ay }, thickness: 0.6, color: RULE });
  LBL(p, "Approved By — Print Name", L, ay + 5, { size: 6.6 });
  LBL(p, "Signature", 315, ay + 5, { size: 6.6 });

  const c = o.company || {};
  const fy = H - 72;
  HR(p, fy - 12, L - 2, R + 2, 0.4);
  const q1 = "QUESTIONS ABOUT THIS ORDER? ", q2 = "CALL OUR OFFICE.";
  const qw = sansB.widthOfTextAtSize(q1, 10) + sansB.widthOfTextAtSize(q2, 10);
  T(p, q1, (W - qw) / 2, fy, sansB, 10, INK);
  T(p, q2, (W - qw) / 2 + sansB.widthOfTextAtSize(q1, 10), fy, sansB, 10, COPPER);
  const co = [c.name || "Homestead Electric", c.addressLine || "", c.phone || ""].filter(Boolean).join("  ·  ");
  T(p, co, (W - serif.widthOfTextAtSize(clean(co), 8)) / 2, fy + 15, serif, 8, INK);

  // Page n of N, top right of every page.
  pages.forEach((pg, i) => {
    const s = `${i + 1}`, t = `${pages.length}`;
    const of = spacedWidth("OF", 7, 1.5);
    const total = spacedWidth("PAGE", 7, 1.5) + 4 + sans.widthOfTextAtSize(s, 9.5) + 4 + of + 4 + sans.widthOfTextAtSize(t, 9.5);
    let x = R - total;
    LBL(pg, "Page", x, 40, { size: 7 }); x += spacedWidth("PAGE", 7, 1.5) + 4;
    T(pg, s, x, 38.5, sans, 9.5); x += sans.widthOfTextAtSize(s, 9.5) + 4;
    LBL(pg, "Of", x, 40, { size: 7 }); x += of + 4;
    T(pg, t, x, 38.5, sans, 9.5);
  });

  return Buffer.from(await doc.save());
}

module.exports = { buildPoPdf, clean, wrap };
