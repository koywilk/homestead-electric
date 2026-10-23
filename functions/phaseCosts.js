// phaseCosts.js — the pure half of the nightly Job Costs pull (Dashboard › Job Costs, SW v564, 2026-10-23).
//
// Koy, 2026-10-23: "show the accurate number" for rough and finish. Crews are scheduled and
// materials are ordered on Base → Rough In, so Simpro's base cost centers carry every hour and
// part while the extras' estimates sit on their own cost centers. This splits EVERY cost center
// on the job (base bid and every change order) into rough / finish / untagged, item by item:
//   • an item whose name ends "(Rough In)" goes to rough, "(Finish)" / "(Trim)" to finish;
//   • an item with neither follows its cost center's type ("Residential (Rough In)" …), then
//     the cost center's name; a cost center with no phase (Change Order, Generators) is untagged;
//   • Simpro's cost-center total is the budget — items only decide how it splits (items that add
//     up past it are scaled down, labor not on an item goes to the cost center's own phase);
//     a credit (negative estimate) comes off its cost center's phase;
//   • what was SPENT is recorded per cost center, not per item, so it splits in the same shares
//     as that cost center's estimate. Spent dollars include committed (Simpro's margin does).
// Hours, materials, labor (with overhead) and sell price all split the same way.
//
// The Simpro reads take their request function from index.js (pullJob); the Firestore writes are index.js's; the dashboard does
// the margins and per-foreman sums on the rows this file produces (odCosts* in src/App.js).
// Tested by scripts/phasecosts-test.js on Pierce (#1277) and DMF Lighting (#694) shapes.
"use strict";

const P = ["rough", "finish", "other"];
const n = (v) => Number(v) || 0;
const r1 = (v) => Math.round(n(v) * 10) / 10;

const phaseOfType = (s) => { s = String(s || ""); return /rough/i.test(s) ? "rough" : /finish|trim/i.test(s) ? "finish" : null; };
const phaseOfItem = (s) => { s = String(s || ""); return /\(\s*rough[\s-]*in\s*\)/i.test(s) ? "rough" : /\(\s*(finish|trim)\s*\)/i.test(s) ? "finish" : null; };

// The four item lists under a job cost center, and the reference each names its item by.
const ITEM_KINDS = { prebuilds: "Prebuild", catalogs: "Catalog", labor: "LaborType", oneOffs: null };
const ITEM_COLUMNS = { prebuilds: "ID,Prebuild,Total,Totals,EstimatedTime,BasePrice,LaborCost", catalogs: "ID,Catalog,Total,Totals,EstimatedTime,BasePrice,LaborCost", labor: null, oneOffs: null };

// One Simpro item → { phase-free weights }. EstimatedTime is minutes; Totals.EstimatedTime is the
// line's minutes (qty × fit time). BasePrice is the unit cost, labor included at LaborCost per hour.
function itemOf(it, kind) {
  const qty = it && it.Total && it.Total.Qty != null ? it.Total.Qty : 1;
  const min = it && it.Totals && it.Totals.EstimatedTime != null ? it.Totals.EstimatedTime : (it && it.EstimatedTime != null ? it.EstimatedTime * qty : null);
  const hrs = min == null ? (kind === "labor" ? n(qty) : null) : min / 60;
  const sell = n((it && it.Totals && it.Totals.PriceEx) != null ? it.Totals.PriceEx : it && it.Total && it.Total.Amount && it.Total.Amount.ExTax);
  const lab = hrs == null ? null : hrs * n(it && it.LaborCost);
  const mat = kind === "labor" ? 0 : (it && it.BasePrice != null ? Math.max(0, n(it.BasePrice) * n(qty) - n(lab)) : null);
  const ref = ITEM_KINDS[kind] ? it && it[ITEM_KINDS[kind]] : null;
  const name = String((ref && ref.Name) || (it && (it.Description || it.Name)) || "").replace(/<[^>]+>/g, "").trim().slice(0, 120);
  return { name, hrs, sell, mat, lab, complete: hrs != null && mat != null };
}

// Item weights by phase for one cost center (what decides the split).
function weightsOf(items, ccPhase) {
  const w = {};
  ["hrs", "mat", "lab", "sell"].forEach(f => {
    const o = { rough: 0, finish: 0, other: 0 };
    (items || []).forEach(it => { const v = n(it[f]); if (v) o[phaseOfItem(it.name) || ccPhase || "other"] += v; });
    w[f] = o;
  });
  return w;
}

// Split one Simpro total by item weights; leftover goes to the cost center's own phase.
function split(total, weights, ccPhase) {
  const s = { rough: 0, finish: 0, other: 0 };
  const wt = weights || { rough: 0, finish: 0, other: 0 };
  const sum = wt.rough + wt.finish + wt.other;
  if (total < 0 || sum <= 0) { s[ccPhase || "other"] = total; return s; }
  if (sum >= total) { P.forEach(k => { s[k] = total * wt[k] / sum; }); return s; }
  P.forEach(k => { s[k] = wt[k]; });
  s[ccPhase || "other"] += total - sum;
  return s;
}

// Spending is per cost center: split it in the same shares as that cost center's estimate.
function spentSplit(total, est, ccPhase) {
  const sum = P.reduce((a, p) => a + Math.max(0, est[p]), 0);
  const o = { rough: 0, finish: 0, other: 0 };
  if (sum <= 0) { o[ccPhase || "other"] = total; return o; }
  P.forEach(p => { o[p] = total * Math.max(0, est[p]) / sum; });
  return o;
}

// A Simpro cost center (list row with Totals + CostCenter) → its figures.
function ccTotals(cc) {
  const T = (cc && cc.Totals) || {}, R = T.ResourcesCost || {};
  const ae = (o) => ({ est: n(o && o.Estimate), act: n(o && o.Actual), com: n(o && o.Committed) });
  const hrs = ae(R.LaborHours), mat = ae(T.MaterialsCost), lab = ae(R.Total);
  const sell = n(T.MaterialsCost && T.MaterialsCost.Estimate) + n(R.Total && R.Total.Estimate) + n(T.MaterialsMarkup && T.MaterialsMarkup.Estimate) + n(T.ResourcesMarkup && T.ResourcesMarkup.Total && T.ResourcesMarkup.Total.Estimate);
  const type = (cc && cc.CostCenter && cc.CostCenter.Name) || "";
  return { name: String((cc && cc.Name) || "").trim(), type, phase: phaseOfType(type) || phaseOfType(cc && cc.Name), hrs, mat, lab, sell };
}
// The items only need re-reading when a cost center's estimate changes.
const ccSig = (t) => [t.hrs.est, t.mat.est, t.lab.est, t.sell].map(v => Math.round(v * 100)).join("|");
const needsItems = (t) => t.hrs.est !== 0 || t.mat.est !== 0 || t.sell !== 0;

// One cost center → the slim row the dashboard shows (estimate split + spent split per category).
function ccRow(section, t, weights, itemCount, taggedCount) {
  const ph = t.phase;
  const est = { hrs: split(t.hrs.est, weights && weights.hrs, ph), mat: split(t.mat.est, weights && weights.mat, ph), lab: split(t.lab.est, weights && weights.lab, ph), sell: split(t.sell, weights && weights.sell, ph) };
  const spent = { hrs: spentSplit(t.hrs.act, est.hrs, ph), mat: spentSplit(t.mat.act + t.mat.com, est.mat, ph), lab: spentSplit(t.lab.act + t.lab.com, est.lab, ph) };
  const row = { s: String(section || "").trim(), cc: t.name, type: t.type, items: itemCount || 0, tagged: taggedCount || 0,
    hrsEst: r1(t.hrs.est), hrsUsed: r1(t.hrs.act), matEst: r1(t.mat.est), matAct: r1(t.mat.act + t.mat.com), labEst: r1(t.lab.est), labAct: r1(t.lab.act + t.lab.com), sell: r1(t.sell) };
  P.forEach(p => {
    row[p + "_hrs"] = r1(est.hrs[p]); row[p + "_mat"] = r1(est.mat[p]); row[p + "_lab"] = r1(est.lab[p]); row[p + "_sell"] = r1(est.sell[p]);
    row[p + "_hrsUsed"] = r1(spent.hrs[p]); row[p + "_matAct"] = r1(spent.mat[p]); row[p + "_labAct"] = r1(spent.lab[p]);
  });
  return row;
}

// All of a job's cost-center rows → the job's per-phase totals (the dashboard's main row).
function jobRow(meta, ccRows) {
  const t = {};
  P.forEach(p => ["hrsEst", "hrsUsed", "matEst", "matAct", "labEst", "labAct", "sell"].forEach(m => { t[p + "_" + m] = 0; }));
  (ccRows || []).forEach(c => P.forEach(p => {
    t[p + "_hrsEst"] += n(c[p + "_hrs"]); t[p + "_matEst"] += n(c[p + "_mat"]); t[p + "_labEst"] += n(c[p + "_lab"]); t[p + "_sell"] += n(c[p + "_sell"]);
    t[p + "_hrsUsed"] += n(c[p + "_hrsUsed"]); t[p + "_matAct"] += n(c[p + "_matAct"]); t[p + "_labAct"] += n(c[p + "_labAct"]);
  }));
  Object.keys(t).forEach(k => { t[k] = r1(t[k]); });
  return { no: String(meta.no), name: meta.name || "", site: meta.site || "", stage: meta.stage || "",
    status: meta.stage === "Invoiced" ? "Invoiced" : String(meta.status || "").replace(/^Job\s*-\s*/i, "").trim(), ...t };
}
const hasEstimate = (row) => P.some(p => row[p + "_hrsEst"] || row[p + "_matEst"] || row[p + "_sell"]);

// Pack job → cost-center lists into shards that each stay well under Firestore's 1 MiB doc limit.
function shardCcs(byNo, maxBytes = 700000) {
  const shards = [{}]; const where = {}; let size = 0;
  Object.keys(byNo).sort().forEach(no => {
    const b = Buffer.byteLength(JSON.stringify(byNo[no])) + no.length + 8;
    if (size + b > maxBytes && Object.keys(shards[shards.length - 1]).length) { shards.push({}); size = 0; }
    shards[shards.length - 1][no] = byNo[no]; where[no] = shards.length - 1; size += b;
  });
  return { shards, where };
}

// ── Simpro reads (I/O injected: req(method, path) → { ok, status, data }, i.e. index.js's simproReqWithRetry) ──
async function pullItems(base, kind, req) {
  const cols = ITEM_COLUMNS[kind];
  let r = await req("GET", `${base}/${kind}/?pageSize=250${cols ? `&columns=${cols}` : ""}`);
  if (!(r.ok && Array.isArray(r.data)) && cols) r = await req("GET", `${base}/${kind}/?pageSize=250`);
  if (!(r.ok && Array.isArray(r.data))) throw new Error(`${kind} list ${r.status}`);
  const out = [];
  for (const it of r.data) {
    let x = itemOf(it, kind);
    if (!x.complete && it && it.ID != null) {
      const d = await req("GET", `${base}/${kind}/${it.ID}`);
      if (d.ok && d.data) x = itemOf({ ...it, ...d.data }, kind);
    }
    out.push(x);
  }
  return out;
}
// One job → { row, ccs, cache, itemReads }. A cost center whose estimate matches the last pull
// (prevState.cache[ccId].sig) reuses its item weights instead of re-reading its items.
async function pullJob(meta, prevState, req) {
  const no = encodeURIComponent(meta.no);
  const secs = await req("GET", `/jobs/${no}/sections/?pageSize=100`);
  if (!(secs.ok && Array.isArray(secs.data))) throw new Error(`sections ${secs.status}`);
  const prev = (prevState && prevState.cache) || {};
  const cache = {}, ccs = []; let itemReads = 0;
  for (const s of secs.data.slice().sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0))) {
    const l = await req("GET", `/jobs/${no}/sections/${s.ID}/costCenters/?pageSize=250&columns=ID,Name,CostCenter,Totals`);
    if (!(l.ok && Array.isArray(l.data))) throw new Error(`cost centers ${l.status} (section ${s.ID})`);
    for (const cc of l.data) {
      const t = ccTotals(cc), sig = ccSig(t), key = String(cc.ID);
      let c = prev[key] && prev[key].sig === sig ? prev[key] : null;
      if (!c) {
        const items = [];
        if (needsItems(t)) {
          const base = `/jobs/${no}/sections/${s.ID}/costCenters/${cc.ID}`;
          for (const k of Object.keys(ITEM_KINDS)) items.push(...await pullItems(base, k, req));
          itemReads++;
        }
        c = { sig, w: weightsOf(items, t.phase), items: items.length, tagged: items.filter(x => phaseOfItem(x.name)).length };
      }
      cache[key] = c;
      ccs.push(ccRow(s.Name, t, c.w, c.items, c.tagged));
    }
  }
  return { row: jobRow(meta, ccs), ccs, cache, itemReads };
}

module.exports = { pullItems, pullJob, P, phaseOfType, phaseOfItem, ITEM_KINDS, ITEM_COLUMNS, itemOf, weightsOf, split, spentSplit, ccTotals, ccSig, needsItems, ccRow, jobRow, hasEstimate, shardCcs };
