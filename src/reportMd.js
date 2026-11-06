// reportMd.js — the small markdown a Claude report is written in, turned into
// plain blocks the Claude tab draws as React text (SW v616). Never HTML: a tag,
// a script or a link in a report is just characters on the screen.
//
// Blocks: { t: "h", level 1-3, runs } · { t: "p", runs } · { t: "ul" | "ol", items: [runs] }
//         { t: "table", head: [runs], rows: [[runs]] }
// Runs:   [{ text, b }] — **bold** is the only inline mark kept; links show as
//         their words, `code` and *italics* as plain text.
// Pure CommonJS like punchTicks.js, so scripts/claude-reports-test.js runs it under node.

function runs(s) {
  const t = String(s == null ? "" : s)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")         // [words](link) → words
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1$2"); // *italic* → italic
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let at = 0, m;
  while ((m = re.exec(t))) {
    if (m.index > at) out.push({ text: t.slice(at, m.index), b: false });
    out.push({ text: m[1], b: true });
    at = m.index + m[0].length;
  }
  if (at < t.length) out.push({ text: t.slice(at), b: false });
  return out.filter(r => r.text);
}
const cells = (row) => {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
};
const isRule = (row) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

function parseReportMd(md) {
  const lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: "p", runs: runs(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], s = raw.trim();
    if (!s) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(s);
    if (h) { flush(); out.push({ t: "h", level: Math.min(3, h[1].length), runs: runs(h[2]) }); continue; }
    if (s.startsWith("|") && i + 1 < lines.length && isRule(lines[i + 1].trim())) {
      flush();
      const head = cells(s).map(runs), rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i]).map(runs)); i++; }
      i--;
      out.push({ t: "table", head, rows });
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(s), ol = /^\d{1,3}[.)]\s+(.*)$/.exec(s);
    if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const last = out[out.length - 1];
      const item = runs((ul || ol)[1]);
      if (last && last.t === kind && last.open) last.items.push(item); else out.push({ t: kind, items: [item], open: true });
      continue;
    }
    // A plain line right under a list item continues it; anything else is prose.
    const last = out[out.length - 1];
    if (!para.length && last && (last.t === "ul" || last.t === "ol") && last.open && /^\s+/.test(raw)) {
      last.items[last.items.length - 1] = last.items[last.items.length - 1].concat([{ text: " ", b: false }], runs(s));
      continue;
    }
    para.push(s);
  }
  flush();
  // A blank line or a heading closes a list; mark them all closed for the reader.
  return out.map(b => { if (b.open) { const { open, ...rest } = b; return rest; } return b; });
}
// Lists close at a blank line: re-run with that rule (kept separate so the loop stays readable).
function parse(md) {
  const blocks = [];
  String(md == null ? "" : md).replace(/\r\n?/g, "\n").split(/\n\s*\n/).forEach(chunk => { parseReportMd(chunk).forEach(b => blocks.push(b)); });
  // Two lists of the same kind split only by a blank line read as one list.
  const merged = [];
  blocks.forEach(b => { const p = merged[merged.length - 1]; if (p && (b.t === "ul" || b.t === "ol") && p.t === b.t) p.items = p.items.concat(b.items); else merged.push(b); });
  return merged;
}

module.exports = { parseReportMd: parse, runs };
