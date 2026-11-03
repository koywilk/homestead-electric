#!/usr/bin/env node
/* What would the Simpro PO pull do right now? Runs the REAL functions/materialPO/simproPull.js
 * against live Simpro and the live jobs, with every write blocked: Simpro is GET only, and
 * Firestore gets reads only. Changes nothing anywhere, prints the result.
 * Run from the Mac (needs functions/node_modules and the admin key):
 *   node scripts/simpro-pull-dryrun.js            # the whole company
 *   node scripts/simpro-pull-dryrun.js 959        # one Simpro job
 *   node scripts/simpro-pull-dryrun.js --json out.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const FN = fs.existsSync(path.join(__dirname, "../functions/node_modules")) ? path.join(__dirname, "../functions") : path.join(process.env.HOME, "dev/homestead-electric/functions");
const admin = require(path.join(FN, "node_modules", "firebase-admin"));
admin.initializeApp({ credential: admin.credential.cert(require("/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json")), projectId: "homestead-electric" });
const real = admin.firestore();
const make = require(path.join(__dirname, "../functions/materialPO/simproPull.js"));
const BASE = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const TOKEN = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8").match(/const SIMPRO_TOKEN\s*=\s*"([^"]+)"/)[1];

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : "";
const jobNo = args[0] || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function simproReqWithRetry(method, p) {
  if (method !== "GET") throw new Error(`Blocked Simpro ${method} ${p}`);
  await sleep(250);
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, status: r.status, data };
}
const blocked = (what) => async () => { throw new Error(`Blocked write: ${what}`); };
const readOnlyRef = (ref) => ({ get: () => ref.get(), set: blocked(`set ${ref.path}`), update: blocked(`update ${ref.path}`) });
const db = {
  collection: (name) => {
    const col = real.collection(name);
    if (name === "settings") return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ mode: "dry" }) }), set: async () => {} }) };
    return { doc: (id) => readOnlyRef(col.doc(id)), get: () => col.get(), where: (...a) => col.where(...a) };
  },
  runTransaction: (fn) => fn({ get: (r) => r.get(), set: blocked("tx.set"), update: blocked("tx.update") }),
};
const functions = {
  https: { HttpsError: Error, onCall: (fn) => fn }, runWith() { return this; },
  pubsub: { schedule() { return { timeZone() { return { onRun: (fn) => fn }; } }; } },
  logger: { info() {}, warn: console.warn, error: console.error },
};

(async () => {
  const pull = make({ functions, db, simproReqWithRetry, requireAppKey: () => {} });
  const res = await pull.run(jobNo ? { jobNo } : { full: true });
  if (!res.ok) { console.error(res); process.exit(1); }
  console.log(res.counts);
  (res.rows || []).filter((r) => r.how !== "typed").forEach((r) => console.log(`${r.how.padEnd(8)} ${r.po}  ${r.date.padEnd(10)} ${r.list.replace("Materials", "").padEnd(7)} ${r.vendor.padEnd(16)} ${r.received ? "picked " : "       "} ${r.job} · ${r.cc} · ${r.by || "-"}`));
  (res.skips || []).forEach((s) => console.log(`waiting  ${s.po}  job ${s.jobNo}: ${s.why}`));
  (res.errors || []).forEach((e) => console.log("ERROR", e));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
