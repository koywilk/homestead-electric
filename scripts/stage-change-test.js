#!/usr/bin/env node
// stage-change-test (v549, UX batch 2): the Rough / Finish stage selects now
// share stageChangePlan() in src/App.js. This pulls the SHIPPED function out
// of App.js verbatim, runs it on real-shaped jobs (Miller #1438, Skyridge Lot
// 208 #1419 as they were on 2026-10-16), and checks:
//   - every side effect the old inline handlers had is unchanged for a job that
//     is not on hold (parity sweep over every stage on a grid of jobs),
//   - v553: the stage % never touches Ready to invoice (the nudge is retired,
//     invoicing is tracked from Simpro), and a job on hold keeps its hold and status,
//   - 100% with open punch is refused with the count,
//   - the summary lines say what happened in plain words.
// Exit 1 on any failure. Runs in prebuild.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
function extractFrom(marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`extract: "${marker}" not found in App.js`);
  // Start at the body brace: the signature has a `counts = {}` default.
  let i = src.indexOf(") {", start) + 2, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "/" && d === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && d === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const line = (name) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf("\n", i)); };
const arr = (name) => { const i = src.indexOf(`const ${name} = `); return src.slice(i, src.indexOf("];", i) + 2); };
const code = [line("parseStage"), arr("QC_STATUSES"), line("READY_TO_INVOICE_ALERTS"), extractFrom("function stageChangePlan(")].join("\n") + "\nthis.stageChangePlan = stageChangePlan;";
const box = { C: new Proxy({}, { get: () => "#000" }) }; // QC_STATUSES colours read C.* tokens
vm.runInNewContext(code, box);
const plan = box.stageChangePlan;

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const has = (lines, re) => lines.some((l) => re.test(l));

// The pre-v549 inline handlers, copied verbatim in logic, for the parity sweep.
function oldRough(job, v) {
  const pct = parseInt(v) || 0;
  const parseStage = (s) => s === "Scheduled" ? 1 : (parseInt(s) || 0);
  const qcFire = pct >= 80 && !job.roughQCTaskFired ? { roughQCTaskFired: true } : {};
  const prepDone = pct > 0 && job.prepStage !== "Job Prep Complete" ? { prepStage: "Job Prep Complete" } : {};
  const invoiceFire = pct >= 85 && !job.roughInvoiceFired ? { roughInvoiceFired: true, roughInvoiceDismissed: false, readyToInvoice: true, readyToInvoiceDate: "D" } : {};
  const invoiceReset = pct < 85 ? { roughInvoiceFired: false, roughInvoiceDismissed: false } : {};
  const matterportFlip = (pct >= 85 && parseStage(job.finishStage) === 0 && !job.matterportStatus && !(job.matterportLinks?.length || job.matterportLink) && !job.hiddenSections?.matterport) ? { matterportStatus: "needs" } : {};
  const qcFlip = ((pct >= 80 && !job.roughQCTaskFired) || (v === "100%" && job.roughStatus !== "complete")) && !job.qcStatus ? { qcStatus: "needs" } : {};
  return { roughStage: v, ...qcFire, ...prepDone, ...invoiceFire, ...invoiceReset, ...matterportFlip, ...qcFlip, ...(v === "100%" ? { roughStatus: "complete" } : pct > 0 ? { roughStatus: "inprogress" } : {}) };
}
function oldFinish(job, v) {
  const pct = parseInt(v) || 0;
  const invoiceFire = pct >= 85 && !job.finishInvoiceFired ? { finishInvoiceFired: true, finishInvoiceDismissed: false, readyToInvoice: true, readyToInvoiceDate: "D" } : {};
  const invoiceReset = pct < 85 ? { finishInvoiceFired: false, finishInvoiceDismissed: false } : {};
  const finishQcFlip = ((pct >= 80) || (v === "100%")) && !job.finishQcStatus ? { finishQcStatus: "needs" } : {};
  return { finishStage: v, ...invoiceFire, ...invoiceReset, ...finishQcFlip, ...(v === "100%" ? { finishStatus: "complete" } : pct > 0 ? { finishStatus: "inprogress" } : {}) };
}
const norm = (p) => { const o = { ...p }; if ("readyToInvoiceDate" in o && o.readyToInvoiceDate) o.readyToInvoiceDate = "D"; return o; };
// v553: the invoice fire / reset / clear are retired — the old side effects minus those keys.
const INVOICE_KEYS = ["readyToInvoice", "readyToInvoiceDate", "roughInvoiceFired", "roughInvoiceDismissed", "finishInvoiceFired", "finishInvoiceDismissed"];
const noInvoice = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !INVOICE_KEYS.includes(k)));

// ── Miller #1438 (2026-10-16): Rough 75%, QC scheduled 2026-10-15, finish 0, no Matterport ──
const miller = { name: "Miller Residence - Alpine", foreman: "Keegan Wilkinson", roughStage: "75%", roughStatus: "inprogress", roughOnHold: false,
  finishStage: "0%", qcStatus: "scheduled", qcStatusDate: "2026-10-15", roughQCTaskFired: false, prepStage: "Job Prep Complete", readyToInvoice: false };
let r = plan(miller, "rough", "85%", { openPunch: 21 });
ok(!INVOICE_KEYS.some(k => k in r.patch), "Miller 85%: Ready to invoice no longer fires (v553)");
ok(r.patch.matterportStatus === "needs", "Miller 85%: Matterport flips");
ok(!("qcStatus" in r.patch), "Miller 85%: QC already scheduled, not clobbered");
ok(r.patch.roughStatus === "inprogress", "Miller 85%: status in progress");
ok(!has(r.lines, /Ready to invoice/), "Miller 85%: no invoice line");
ok(has(r.lines, /^Matterport scan: needed now\.$/), "Miller 85%: Matterport line");
ok(has(r.lines, /^QC walk: already scheduled \(2026-10-15\), no change\.$/), "Miller 85%: QC line says no change");
ok(r.title === "Rough 85% · here's what that set off", "Miller 85%: title");
r = plan(miller, "rough", "100%", { openPunch: 21 });
ok(r.blocked && r.blocked.count === 21 && !r.patch, "Miller 100% with 21 open punch is refused");
ok(/21 punch items are still open on Miller Residence - Alpine\./.test(r.blocked.text), "refusal text has the count and job");
r = plan(miller, "rough", "75%", { openPunch: 21 });
ok(r.lines.length === 1 && r.lines[0] === "Nothing else changed." && r.title === "Rough 75%", "no side effects says so");

// ── Skyridge Lot 208 #1419 (2026-10-16): Rough 80%, on hold, Ready to invoice since 10/1 ──
const sky = { name: "Skyridge Lot 208 - Mayflower", foreman: "Keegan Wilkinson", roughStage: "80%", roughStatus: "inprogress", roughOnHold: true,
  finishStage: "0%", qcStatus: "needs", roughQCTaskFired: true, prepStage: "Job Prep Complete", readyToInvoice: true, readyToInvoiceDate: "10/1/2026", roughInvoiceFired: false };
r = plan(sky, "rough", "80%", { openPunch: 15 });
ok(!INVOICE_KEYS.some(k => k in r.patch), "v553: below 85% leaves the old Ready to invoice flag alone");
ok(!("roughStatus" in r.patch) && !("roughOnHold" in r.patch), "decision 2: on hold keeps status and hold");
ok(!has(r.lines, /Ready to invoice/), "Skyridge: no invoice line");
ok(has(r.lines, /^Still on hold\./), "Skyridge: still-on-hold line");
r = plan({ ...sky, roughPunch: null }, "rough", "100%", { openPunch: 0 });
ok(r.patch.roughStatus === "complete" && r.patch.roughOnHold === false, "100% on hold: complete clears the hold (same as the Status select)");
ok(has(r.lines, /^Rough marked complete\.$/), "100%: complete line");
const waiting = { ...sky, roughOnHold: false, roughStatus: "waiting" };
ok(!("roughStatus" in plan(waiting, "rough", "85%", {}).patch), "status 'waiting' also counts as on hold");

// ── Ready to invoice is kept when the other phase still justifies it ──
ok(!("readyToInvoice" in plan({ ...sky, finishStage: "90%" }, "rough", "75%", {}).patch), "rough drop keeps RTI while finish >= 85%");
const fin = { name: "Webb", foreman: "Gage Lund", roughStage: "100%", roughStatus: "complete", finishStage: "90%", finishStatus: "inprogress",
  finishInvoiceFired: true, readyToInvoice: true, readyToInvoiceDate: "10/2/2026", finishQcStatus: "needs" };
ok(!("readyToInvoice" in plan(fin, "finish", "80%", {}).patch), "finish drop keeps RTI while the rough invoice may be unsent");
ok(!("readyToInvoice" in plan({ ...fin, invoiceSent: true }, "finish", "80%", {}).patch), "v553: finish drop never touches RTI");
ok(!("readyToInvoice" in plan({ ...fin, readyToInvoice: false, invoiceSent: true }, "finish", "80%", {}).patch), "an already-cleared invoice is never touched");
r = plan(fin, "finish", "100%", { openPunch: 2, openQc: 1 });
ok(r.blocked && r.blocked.count === 3 && /2 finish punch items and 1 QC item still open on Webb\./.test(r.blocked.text), "finish 100% refused with both counts");
ok(plan({ ...fin, finishOnHold: true }, "finish", "95%", {}).patch.finishStatus === undefined, "finish on hold keeps status");

// ── Parity sweep: a job not on hold gets exactly the old side effects (plus only the invoice clear) ──
const STAGES = ["0%", "5%", "40%", "75%", "80%", "85%", "90%", "100%"];
const grid = [];
for (const rs of STAGES) for (const fs2 of ["0%", "50%", "90%"]) for (const rti of [false, true]) for (const qc of ["", "scheduled"]) for (const fired of [false, true])
  grid.push({ name: "J", roughStage: rs, finishStage: fs2, readyToInvoice: rti, qcStatus: qc, roughQCTaskFired: fired, roughInvoiceFired: fired, finishInvoiceFired: fired, prepStage: fired ? "Job Prep Complete" : "", roughStatus: rs === "100%" ? "complete" : "inprogress" });
for (const job of grid) for (const v of STAGES) {
  const a = plan(job, "rough", v, { openPunch: 0 }).patch, b = noInvoice(oldRough(job, v));
  const extra = Object.keys(norm(a)).filter((k) => !(k in b));
  ok(!extra.length, `rough parity: nothing added, no invoice keys (${extra})`);
  for (const k of Object.keys(b)) ok(JSON.stringify(norm(a)[k]) === JSON.stringify(norm(b)[k]), `rough parity ${k} @ ${job.roughStage}->${v}`);
  const fa = plan(job, "finish", v, { openPunch: 0, openQc: 0 }).patch, fb = noInvoice(oldFinish(job, v));
  const fextra = Object.keys(norm(fa)).filter((k) => !(k in fb));
  ok(!fextra.length, `finish parity: nothing added, no invoice keys (${fextra})`);
  for (const k of Object.keys(fb)) ok(JSON.stringify(norm(fa)[k]) === JSON.stringify(norm(fb)[k]), `finish parity ${k} @ ${v}`);
}

console.log(`  ok  stage-change-test: ${n} checks (Miller, Skyridge Lot 208, Webb, ${grid.length * STAGES.length} parity cases)`);
