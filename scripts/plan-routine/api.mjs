// Plan-intake Routine client — the Routine's only way to touch plans.
//   node scripts/plan-routine/api.mjs work                     → queue + candidates (JSON on stdout)
//   node scripts/plan-routine/api.mjs file <item> <out.pdf>    → download a queued PDF
//   node scripts/plan-routine/api.mjs decide '<json>'          → post one decision
// Auth: the Routine environment's API credential is attached by the sandbox's
// web proxy. Node's built-in fetch ignores proxy settings (first run,
// 2026-10-04: fetch → 401, curl → 200), so every call goes through curl, which
// honors the proxy. execFile with an argument list — no shell, so nothing from
// an email can become part of a command. PLAN_ROUTINE_TOKEN in the env adds the
// header directly (local testing only).
import { execFileSync } from "node:child_process";
const BASE = process.env.PLAN_API_BASE || "https://us-central1-homestead-electric.cloudfunctions.net/planRoutineApi";
const auth = process.env.PLAN_ROUTINE_TOKEN ? ["-H", `Authorization: Bearer ${process.env.PLAN_ROUTINE_TOKEN}`] : [];
const fail = (m) => { console.error(m); process.exit(1); };

// Returns { status, body } — body is a Buffer (the PDF for /file).
function call(path, { method = "GET", json } = {}) {
  const args = ["-sS", "-X", method, "-H", "Content-Type: application/json", ...auth,
    "--max-time", "280", "-w", "\n%{http_code}", "-o", "-", `${BASE}${path}`];
  if (json !== undefined) args.push("--data-binary", "@-");
  const out = execFileSync("curl", args, { input: json === undefined ? undefined : JSON.stringify(json), maxBuffer: 300 * 1024 * 1024 });
  const nl = out.lastIndexOf(10);
  return { status: Number(out.subarray(nl + 1).toString()), body: out.subarray(0, nl) };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "work") {
  const r = call("/work");
  if (r.status !== 200) fail(`work ${r.status}: ${r.body.toString().slice(0, 300)}`);
  process.stdout.write(JSON.stringify(JSON.parse(r.body.toString()), null, 1));
} else if (cmd === "file") {
  if (!a || !b) fail("usage: file <item> <out.pdf>");
  const r = call(`/file?item=${encodeURIComponent(a)}`);
  if (r.status !== 200) fail(`file ${r.status}: ${r.body.toString().slice(0, 300)}`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(b, r.body);
  console.log(`saved ${b} (${r.body.length} bytes)`);
} else if (cmd === "decide") {
  let body; try { body = JSON.parse(a || ""); } catch { fail("decide needs one JSON argument"); }
  const r = call("/decide", { method: "POST", json: body });
  if (r.status !== 200) fail(`decide ${r.status}: ${r.body.toString().slice(0, 300)}`);
  console.log(r.body.toString());
} else fail("commands: work | file <item> <out.pdf> | decide '<json>'");
