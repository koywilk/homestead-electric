#!/usr/bin/env node
/**
 * gen-stamp-dryrun.js — READ-ONLY preview of the "label chosen loads as
 * Dedicated Loads" stamp (item 4). Shows exactly which Home Run rows would get
 * their panel changed, using the exact shipping helpers. Writes nothing.
 *
 *   node scripts/gen-stamp-dryrun.js --key <sa.json> [--job <id>]
 */
const path = require("path"), fs = require("fs");
let admin;
try { admin = require("firebase-admin"); }
catch { admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
const PROJECT_ID = "homestead-electric";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i+1]; return (v && !String(v).startsWith("--")) ? v : true; };
const keyPath = arg("key", process.env.GOOGLE_APPLICATION_CREDENTIALS);
const jobId = (arg("job", "1773092930059") === true) ? "1773092930059" : arg("job", "1773092930059");
if (!keyPath) { console.error("Missing --key"); process.exit(1); }

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `); if (start < 0) throw new Error(`not found: ${name}`);
  let i = src.indexOf("{", start), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) break; } }
  return src.slice(start, i + 1);
}
const tmp = path.join(__dirname, ".gen-stamp.tmp.js");
fs.writeFileSync(tmp, `${extract("flattenHomeRuns")}\n${extract("applyHomeownerChoices")}\nmodule.exports={flattenHomeRuns,applyHomeownerChoices};`);
const F = require(tmp);
process.on("exit", () => { try { fs.unlinkSync(tmp); } catch {} });

const DED = "Dedicated Loads";

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))), projectId: PROJECT_ID });
  const db = admin.firestore();
  const job = (await db.doc(`jobs/${jobId}`).get()).data() || {};
  const homeRuns = (job.data && job.data.homeRuns) || {};
  const hr = (await db.doc(`homeowner_requests/${jobId}`).get()).data() || {};
  const applied = F.applyHomeownerChoices(hr.genLoads || [], hr.items || []);

  const rows = F.flattenHomeRuns(homeRuns);
  const rowById = {}; rows.forEach(r => { if (r.id) rowById[r.id] = r; });
  const chosen = applied.filter(l => l.included);

  let toLabel = 0, alreadyLabeled = 0, noRow = 0;
  const changes = [], skipped = [];
  chosen.forEach(l => {
    const r = l.hrId ? rowById[l.hrId] : null;
    if (!r) { noRow++; skipped.push(l.name || "(unnamed)"); return; }
    if ((r.panel || "") === DED) { alreadyLabeled++; return; }
    toLabel++; changes.push({ name: r.name, from: r.panel || "(no panel)" });
  });

  console.log(`\n===== STAMP DRY RUN — ${jobId} =====\n`);
  console.log(`Homeowner chose ${chosen.length} circuits. On our Home Runs, this would:`);
  console.log(`   relabel to "Dedicated Loads": ${toLabel}`);
  console.log(`   already "Dedicated Loads":    ${alreadyLabeled}`);
  console.log(`   chosen but not linked to a Home Run row (skipped): ${noRow}`);
  console.log(`\n   Each relabel stashes the row's current panel (panelBeforeGen) so it's REVERSIBLE.\n`);
  if (changes.length) {
    console.log(`   Rows that would change (name : current panel -> Dedicated Loads):`);
    changes.slice(0, 60).forEach(c => console.log(`      ${String(c.name || "(unnamed)").padEnd(34)} ${c.from}  ->  ${DED}`));
    if (changes.length > 60) console.log(`      … and ${changes.length - 60} more`);
  }
  if (skipped.length) {
    console.log(`\n   The ${skipped.length} SKIPPED (chosen, but no matching Home Run row to label):`);
    skipped.forEach(n => console.log(`      ${n}`));
  }
  console.log(`\nREAD-ONLY — nothing was written.`);
  process.exit(0);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
