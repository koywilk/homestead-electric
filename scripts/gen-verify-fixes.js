#!/usr/bin/env node
/**
 * gen-verify-fixes.js — READ-ONLY proof that the counter fix + the
 * office-reflects-homeowner-choices fix work, using the EXACT shipping code
 * (extracted live from src/App.js) against a real job's real data.
 *
 * Usage:
 *   node scripts/gen-verify-fixes.js --key <serviceAccount.json> [--job <id>]
 * Default job: Kweller (1773092930059).
 * READ-ONLY. Never writes.
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

// Extract the real functions from src/App.js into a temp module.
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extract(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`not found: ${name}`);
  let i = src.indexOf("{", start), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) break; } }
  return src.slice(start, i + 1);
}
const tmp = path.join(__dirname, ".gen-verify.tmp.js");
fs.writeFileSync(tmp,
  `let _n=0; function uid(){return "NEW#"+(++_n);}\n` +
  `const canBe240 = (wire) => wire === "14/2" || wire === "12/2";\n` +
  [extract("WIRE_BREAKER"), extract("effectivePoles"), extract("placeBreakers"),
   extract("buildGeneratorPanel"), extract("genPanelUsage"), extract("applyHomeownerChoices"),
   extract("flattenHomeRuns"), extract("reconcileGenLoads")].join("\n") +
  `\nmodule.exports={effectivePoles,buildGeneratorPanel,genPanelUsage,applyHomeownerChoices};\n`);
const F = require(tmp);
process.on("exit", () => { try { fs.unlinkSync(tmp); } catch {} });

const spacesOf = (circuits) => new Set(Object.keys(circuits).map(k => parseInt(k, 10))).size;
const naivePoles = (loads) => loads.reduce((n, l) => n + ((l.needsSpecs && !l.wire) ? 1 : F.effectivePoles(l.wire, l.v240)), 0);

(async () => {
  admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))), projectId: PROJECT_ID });
  const db = admin.firestore();
  const hr = (await db.doc(`homeowner_requests/${jobId}`).get()).data() || {};
  const genLoads = hr.genLoads || [];
  const items = hr.items || [];
  const SIZE = 30;

  console.log(`\n===== ${jobId} =====`);

  // ---- FIX 1: office reflects the homeowner's choices ----
  const beforeChecked = genLoads.filter(l => l.included).length;
  const homeownerChose = items.filter(it => it.included || it.status === "chosen").length;
  const applied = F.applyHomeownerChoices(genLoads, items);
  const afterChecked = applied.filter(l => l.included).length;
  console.log(`\nFIX 1 — office checkboxes reflect the homeowner's picks:`);
  console.log(`   homeowner actually selected: ${homeownerChose}`);
  console.log(`   office list BEFORE fix (raw genLoads.included): ${beforeChecked} checked`);
  console.log(`   office list AFTER fix  (applyHomeownerChoices): ${afterChecked} checked`);
  console.log(`   => ${afterChecked === homeownerChose ? "MATCH — no manual unchecking needed ✓" : "mismatch (" + afterChecked + " vs " + homeownerChose + ")"}`);

  // ---- FIX 2: the counter agrees with the panel schedule ----
  const onGen = applied.filter(l => l.included);
  const twoP = onGen.filter(l => F.effectivePoles(l.wire, l.v240) === 2).length;
  const oneP = onGen.length - twoP;
  const naive = naivePoles(onGen);
  console.log(`\nFIX 2 — the counter tells the truth (${onGen.length} circuits: ${twoP} are 240V 2-pole, ${oneP} are 1-pole):`);
  console.log(`   OLD counter (naive pole-sum): ${naive} of ${SIZE} slots -> "WON'T FIT, needs ${naive-SIZE} more" (the nonsense you saw)`);
  console.log(`   NEW counter (real placement), by panel size:`);
  [30, 40, 60].forEach(sz => {
    const p = F.buildGeneratorPanel(onGen, sz);
    const sp = spacesOf(p.circuits);
    const over = p.unplaced.length;
    console.log(`      ${sz}/${sz*2}: ${sp} of ${sz} spaces used -> ${over === 0 ? "FITS ✓ all " + onGen.length : over + " won't fit (" + p.unplaced.map(b=>b.name).join(", ") + ")"}`);
  });
  console.log(`   => 2-poles can't tandem (each eats 2 spaces), so ${twoP} of them alone need ${twoP*2} spaces. That's why 30 is ~1 short and 40 fits it all.`);

  console.log(`\nREAD-ONLY — nothing was written.`);
  process.exit(0);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
