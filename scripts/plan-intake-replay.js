// Plan-intake replay — READ-ONLY. Runs the Phase 1 walk rules over an exported
// calendar (Google Calendar events JSON: { events: [...] }) against live Simpro
// and prints what the watcher WOULD have done. Writes nothing anywhere.
//   node scripts/plan-intake-replay.js <calendar.json>
// Token/base are read out of functions/index.js, same as simpro-plans-dryrun.js.
"use strict";
const fs = require("fs");
const path = require("path");
const W = require("../functions/planIntake/walks.js");

const src = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
const TOKEN = process.env.SIMPRO_TOKEN || (src.match(/const SIMPRO_TOKEN = "([^"]+)"/) || [])[1];
const BASE = (src.match(/const SIMPRO_BASE\s*=\s*"([^"]+)"/) || [])[1];
if (!TOKEN || !BASE) { console.error("Simpro token/base not found"); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(p) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${p}`);
    return r.json();
  }
  throw new Error(`429 ${p}`);
}

async function siteFacts(addr) {
  const sites = await get(`/sites/?Address.Address=${encodeURIComponent(`%${addr.number}%`)}&columns=ID,Name,Address&pageSize=50`);
  const hits = sites.filter(s => W.sameAddress(addr, W.extractAddress(s.Address && s.Address.Address)));
  const quotes = [], jobs = [];
  for (const s of hits) {
    quotes.push(...await get(`/quotes/?Site.ID=${s.ID}&columns=ID,Name,Stage,DateIssued,IsClosed,JobNo,LinkedJobID&pageSize=100`));
    jobs.push(...await get(`/jobs/?Site.ID=${s.ID}&columns=ID,Name,Stage,DateIssued,ConvertedFrom&pageSize=100`));
  }
  return { sites: hits, quotes, jobs };
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error("usage: node scripts/plan-intake-replay.js <calendar.json>"); process.exit(1); }
  const events = JSON.parse(fs.readFileSync(file, "utf8")).events || [];
  const rows = [];
  for (const ev of events) {
    const c = W.classifyEvent(ev);
    if (c.kind === "skip" && !/^(josh|brady|justin)@/.test((ev.creator && ev.creator.email) || "")) continue;
    if (c.kind === "skip" && c.reason === "recurring") continue;
    const day = String((ev.start && (ev.start.dateTime || ev.start.date)) || "").slice(0, 10);
    let verdict = c.kind === "skip" ? `skip (${c.reason})` : "";
    if (c.kind !== "skip") {
      if (!c.address) verdict = `QUEUE walk_unmatched (${c.kind === "maybe" ? "maybe a walk; " : ""}no address)`;
      else {
        const f = await siteFacts(c.address);
        if (!f.sites.length) verdict = `QUEUE walk_unmatched (no Simpro site at ${c.address.raw})`;
        else {
          const p = W.pickQuote({ walkDate: day, quotes: f.quotes, jobs: f.jobs });
          const q = id => f.quotes.find(x => x.ID === id);
          const conv = id => f.jobs.find(j => j.ConvertedFrom && j.ConvertedFrom.ID === id);
          if (p.result === "quote") {
            const j = conv(p.quoteId);
            verdict = `FOLDER Quote #${p.quoteId} (${q(p.quoteId).Name})` + (j ? ` → renamed #${j.ID} on ${String(j.ConvertedFrom.Date).slice(0, 10)}` : " — not converted yet");
          } else if (p.result === "existing_job") verdict = `skip — existing job #${p.jobId}`;
          else if (p.result === "ambiguous") verdict = `QUEUE walk_unmatched (quotes ${p.quoteIds.join(", ")})`;
          else verdict = `retry 14d, then QUEUE (site ${f.sites.map(s => s.ID).join("/")} has no open quote)`;
        }
      }
    }
    rows.push([day, (ev.creator.email || "").split("@")[0], String(ev.summary || "").trim().slice(0, 48), verdict]);
  }
  for (const r of rows) console.log(r.join("  |  "));
})().catch(e => { console.error(e); process.exit(1); });
