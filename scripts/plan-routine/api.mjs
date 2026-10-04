// Plan-intake Routine client — the Routine's only way to touch plans.
//   node scripts/plan-routine/api.mjs work                     → queue + candidates (JSON on stdout)
//   node scripts/plan-routine/api.mjs file <item> <out.pdf>    → download a queued PDF
//   node scripts/plan-routine/api.mjs decide '<json>'          → post one decision
// Auth: the Routine's API credential injects "Authorization: Bearer …" for the
// functions host. PLAN_ROUTINE_TOKEN in the env works too (local testing only).
import { writeFileSync } from "node:fs";
const BASE = process.env.PLAN_API_BASE || "https://us-central1-homestead-electric.cloudfunctions.net/planRoutineApi";
const headers = { "Content-Type": "application/json", ...(process.env.PLAN_ROUTINE_TOKEN ? { Authorization: `Bearer ${process.env.PLAN_ROUTINE_TOKEN}` } : {}) };
const [cmd, a, b] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };
if (cmd === "work") {
  const r = await fetch(`${BASE}/work`, { headers });
  if (!r.ok) fail(`work ${r.status}: ${await r.text()}`);
  process.stdout.write(JSON.stringify(await r.json(), null, 1));
} else if (cmd === "file") {
  if (!a || !b) fail("usage: file <item> <out.pdf>");
  const r = await fetch(`${BASE}/file?item=${encodeURIComponent(a)}`, { headers });
  if (!r.ok) fail(`file ${r.status}: ${await r.text()}`);
  writeFileSync(b, Buffer.from(await r.arrayBuffer()));
  console.log(`saved ${b}`);
} else if (cmd === "decide") {
  let body; try { body = JSON.parse(a || ""); } catch { fail("decide needs one JSON argument"); }
  const r = await fetch(`${BASE}/decide`, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) fail(`decide ${r.status}: ${t}`);
  console.log(t);
} else fail("commands: work | file <item> <out.pdf> | decide '<json>'");
