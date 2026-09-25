#!/usr/bin/env node
/* simpro-discover.js — READ-ONLY probe of the Simpro tenant's real field shapes.
 *
 * Why (2026-09-24): the clock-in/out and PO-from-the-app features need to WRITE
 * timesheets and vendor orders. Simpro's public docs don't render the field
 * tables, so the exact payload names (Vendor vs VendorID, StartTime vs
 * DateTime, the Stage values, where a vendor's email lives) have to come from
 * the tenant itself. This script only ever GETs / OPTIONS — it never creates,
 * updates or deletes anything — and prints the field names + short example
 * values of what comes back, so the spec can be written against facts.
 *
 * Run from the repo root on a machine that can reach Simpro:
 *   node scripts/simpro-discover.js            # general shapes
 *   node scripts/simpro-discover.js 1770       # + one job's cost centers / timesheets
 *
 * Token: SIMPRO_TOKEN env var wins; otherwise it is read from
 * functions/index.js (the same constant the Cloud Functions use). Output goes
 * to the console AND to ~/Desktop/simpro-discovery.json (paste that back).
 * Paces itself (~3 req/s) to stay under Simpro's per-token rate limit.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = process.env.SIMPRO_BASE || "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const JOB = process.argv[2] ? String(process.argv[2]).trim() : "";
let TOKEN = process.env.SIMPRO_TOKEN || "";
if (!TOKEN) {
  try {
    const src = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
    const m = src.match(/const SIMPRO_TOKEN\s*=\s*"([^"]+)"/);
    if (m) TOKEN = m[1];
  } catch {}
}
if (!TOKEN) { console.error("No SIMPRO_TOKEN (env) and none found in functions/index.js"); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const out = { base: BASE, ranAt: new Date().toISOString(), job: JOB || null, probes: [] };

async function call(method, p) {
  await sleep(350);
  const url = BASE + p;
  let status = 0, headers = {}, body = null, text = "";
  try {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
    status = r.status;
    ["allow", "content-type", "x-ratelimit-remaining", "retry-after"].forEach(h => { const v = r.headers.get(h); if (v) headers[h] = v; });
    text = await r.text();
    try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  } catch (e) { text = String(e && e.message); body = text; }
  return { status, headers, body };
}

// Field names + short example values, recursing 2 levels; arrays show the first element's shape + length.
function shape(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return { _array: v.length, _first: v.length ? shape(v[0], depth) : null };
  if (typeof v === "object") {
    if (depth >= 3) return "{…}";
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  return v;
}

async function probe(label, method, p, opts = {}) {
  const r = await call(method, p);
  const ok = r.status >= 200 && r.status < 300;
  const entry = { label, method, path: p, status: r.status, headers: r.headers, shape: ok ? shape(r.body) : r.body };
  out.probes.push(entry);
  console.log(`${ok ? "OK  " : "--  "} ${r.status} ${method} ${p}${label ? "   # " + label : ""}`);
  return ok ? r.body : null;
}
const firstId = (list) => Array.isArray(list) && list.length && list[0] && list[0].ID != null ? list[0].ID : null;

(async () => {
  console.log(`Simpro discovery (read-only) → ${BASE}\n`);

  // ── Employees (for the clock: which ID a person's timesheet needs) ──
  const emps = await probe("employees list", "GET", "/employees/?pageSize=3");
  const empId = firstId(emps);
  if (empId != null) {
    await probe("one employee (full record)", "GET", `/employees/${empId}`);
    await probe("employee timesheets (does the resource exist? what shape?)", "GET", `/employees/${empId}/timesheets/?pageSize=3`);
    await probe("employee timesheets — schema via OPTIONS", "OPTIONS", `/employees/${empId}/timesheets/`);
  }
  await probe("staff list (alt name)", "GET", "/staff/?pageSize=2");

  // ── Vendors + contacts (for the PO email address) ──
  const vendors = await probe("vendors list", "GET", "/vendors/?pageSize=3");
  const vendorId = firstId(vendors);
  if (vendorId != null) {
    await probe("one vendor (full record — look for Email / Contacts)", "GET", `/vendors/${vendorId}`);
    await probe("vendor contacts", "GET", `/vendors/${vendorId}/contacts/?pageSize=5`);
  }
  await probe("suppliers list (alt name)", "GET", "/suppliers/?pageSize=2");

  // ── Vendor orders (POs): header, lines, stage values, schema ──
  const vos = await probe("vendor orders — newest 3", "GET", "/vendorOrders/?pageSize=3&orderby=-ID");
  const voId = firstId(vos);
  if (voId != null) {
    await probe("one vendor order (full header — Stage / Status / OrderNo / Vendor / Job / CostCenter)", "GET", `/vendorOrders/${voId}`);
    await probe("its catalog lines", "GET", `/vendorOrders/${voId}/catalogs/?pageSize=10`);
    await probe("its one-off / free-text lines (if the resource exists)", "GET", `/vendorOrders/${voId}/oneOffs/?pageSize=10`);
    await probe("its service-fee lines (if the resource exists)", "GET", `/vendorOrders/${voId}/serviceFees/?pageSize=10`);
  }
  await probe("vendor orders — schema via OPTIONS", "OPTIONS", "/vendorOrders/");
  await probe("vendor order receipts (exists?)", "GET", "/vendorReceipts/?pageSize=1");

  // ── Labor rates (a timesheet may need one) ──
  await probe("labor rates", "GET", "/setup/labor/laborRates/?pageSize=5");
  await probe("labor rates (alt path)", "GET", "/setup/laborRates/?pageSize=5");
  await probe("activities / non-job time (exists?)", "GET", "/setup/activities/?pageSize=5");

  // ── Business groups (Commercial mode, 2026-09-25) ──
  // Koy: Simpro flags resi vs commercial under Job settings → Business Group.
  // The candidate poller wants to read it so an import can pre-set the job's
  // division. Confirm the setup list + the field name on a job (BusinessGroup
  // {ID, Name} per the public docs) + that the bulk /jobs/ list accepts it as
  // a column (bulk `columns=` silently rejects unknown names on this tenant).
  // Run 1 (2026-09-25): /setup/businessGroups/ → 404, bulk column → 422. So the
  // name/path is something else on this tenant. Run 2: pull ONE pending job's
  // full detail with no column filter and report every key that smells like a
  // business group / division / tag, then try the likely alternative paths.
  const pend = await probe("one pending job id", "GET", "/jobs/?Stage=Pending&pageSize=1");
  const pendId = firstId(pend);
  if (pendId) {
    const full = await probe("that job — FULL detail (no columns filter)", "GET", `/jobs/${pendId}?display=detailed`);
    if (full && typeof full === "object") {
      const hits = [];
      const walk = (v, p) => {
        if (!v || typeof v !== "object") return;
        for (const k of Object.keys(v)) {
          const kp = p ? `${p}.${k}` : k;
          if (/business|group|division|tag|custom|category|type/i.test(k)) hits.push(`${kp} = ${JSON.stringify(shape(v[k]))}`);
          if (v[k] && typeof v[k] === "object" && !Array.isArray(v[k]) && kp.split(".").length < 3) walk(v[k], kp);
        }
      };
      walk(full, "");
      console.log(`    top-level keys: ${Object.keys(full).join(", ")}`);
      console.log(hits.length ? `    business-group-ish keys:\n      ${hits.join("\n      ")}` : "    (no key on the job mentions business / group / division / tag / custom / category / type)");
      out.probes.push({ label: "business-group-ish keys on a job", keys: Object.keys(full), hits });
    }
    await probe("that job — schema via OPTIONS", "OPTIONS", `/jobs/${pendId}`);
    await probe("that job — custom fields (if Business Group is a custom field)", "GET", `/jobs/${pendId}/customFields/`);
  }
  await probe("jobs — bulk schema via OPTIONS", "OPTIONS", "/jobs/");
  await probe("business groups — alt path 1", "GET", "/businessGroups/?pageSize=20");
  await probe("business groups — alt path 2", "GET", "/setup/accounts/businessGroups/?pageSize=20");
  await probe("business groups — alt path 3", "GET", "/setup/system/businessGroups/?pageSize=20");
  await probe("job custom fields (setup)", "GET", "/setup/customFields/jobs/?pageSize=50");
  await probe("job tags (setup)", "GET", "/setup/tags/jobs/?pageSize=50");

  // ── One job's cost centers + timesheets (pass a Simpro job number) ──
  if (JOB) {
    await probe("job header", "GET", `/jobs/${JOB}`);
    const secs = await probe("job sections", "GET", `/jobs/${JOB}/sections/`);
    const secId = firstId(secs);
    if (secId != null) {
      const ccs = await probe("cost centers in first section", "GET", `/jobs/${JOB}/sections/${secId}/costCenters/`);
      const ccId = firstId(ccs);
      if (ccId != null) {
        await probe("one job cost center (full)", "GET", `/jobs/${JOB}/sections/${secId}/costCenters/${ccId}`);
        await probe("timesheets on that cost center (job-scoped resource?)", "GET", `/jobs/${JOB}/sections/${secId}/costCenters/${ccId}/timesheets/?pageSize=3`);
        await probe("…schema via OPTIONS", "OPTIONS", `/jobs/${JOB}/sections/${secId}/costCenters/${ccId}/timesheets/`);
        await probe("timesheets — flat job/costCenters path (alt)", "GET", `/jobs/${JOB}/costCenters/${ccId}/timesheets/?pageSize=3`);
      }
    }
    await probe("job timesheets (job-level alt)", "GET", `/jobs/${JOB}/timesheets/?pageSize=3`);
    await probe("vendor orders filtered to this job", "GET", `/vendorOrders/?Job.ID=${JOB}&pageSize=3`);
  } else {
    console.log("\n(no job number given — re-run with a Simpro job # to probe cost centers + timesheets)");
  }

  const file = path.join(os.homedir(), "Desktop", "simpro-discovery.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nSaved full shapes → ${file}\nPaste that file's contents back into the chat.`);
})().catch(e => { console.error("discovery failed:", e && e.message); process.exit(1); });
