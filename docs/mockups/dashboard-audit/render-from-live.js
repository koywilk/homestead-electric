#!/usr/bin/env node
// Renders goals.html and costs.html in this folder from a LIVE read-only pull (Koy's rule: mockups
// use real rows). Inputs are JSON dumps made by read-only scripts (see docs/mockups/goals-tab/*-readonly.js
// and the Phase 2 local run): <dir>/goalsSimpro.json, phase2-live.json, phaseCosts.json, jobs.json, users.json.
// The math is the app's own, compiled out of src/App.js by scripts/odash-model-test.js's sandbox.
//   node docs/mockups/dashboard-audit/render-from-live.js <dir-with-json>
"use strict";
const fs = require("fs"), path = require("path");
const { makeSandbox } = require(path.join(__dirname, "..", "..", "..", "scripts", "odash-model-test.js"));
const X = makeSandbox();
const dir = process.argv[2]; if (!dir) { console.error("usage: render-from-live.js <dir>"); process.exit(1); }
const J = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
const gs = J("goalsSimpro.json"), p2 = J("phase2-live.json"), pc = J("phaseCosts.json"), jobs = J("jobs.json"), users = J("users.json").list;
const sim = { ...gs, phase2: p2 };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TONE = { good: "#18804A", warn: "#B4531A", bad: "#C43B3B", grey: "#6B7487" };
const head = (title, sub) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--page:#F7F4EE;--ink:#292119;--dim:#6B6259;--line:#E4DDD2;--card:#FFFFFF;--a:#8E6336}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.45 "DM Sans",system-ui,sans-serif;padding:24px}
h1{font-size:26px;margin:0 0 4px}h1+p{margin:0 0 18px;color:var(--dim)}
.ct{font-weight:700;font-size:14px;margin:18px 0 8px}.ct small{font-weight:500;color:var(--dim);margin-left:8px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.goal{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--card);display:flex;flex-direction:column;gap:8px;min-width:0}
.goal.new{outline:2px solid var(--a);outline-offset:-2px}
.goal .h{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.goal .h b{font-size:13.5px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--c);white-space:nowrap}.pill i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.n{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.n small{display:block;color:var(--dim);font-size:11px}.n b{font-size:18px}.n b.s{color:var(--ink);font-weight:600;font-size:14px}
.bar{display:block;height:6px;border-radius:3px;background:#EEE8DF;overflow:hidden}.bar i{display:block;height:100%;background:var(--c)}
.sub{color:var(--dim);font-size:12px}details.rule summary{cursor:pointer;font-weight:700;color:var(--a);font-size:12.5px;list-style:none}details.rule p{font-size:12.5px;color:var(--dim);margin:6px 0 0}
.note{background:#fff;border:1px solid var(--line);border-left:4px solid var(--a);border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:14px}
/* Job Costs (the tab's own look: steel panel, hi-vis tags) */
.jc{--jc-ink:#14181C;--jc-dim:#4A535C;--jc-steel2:#C9CFD6;--jc-cover:#F2F4F6;--jc-char:#2B3137;--jc-hv:#FFB000;--jc-red:#C0392B;--jc-blue:#2457C5;--jc-cond:"Barlow Condensed","Bebas Neue","DM Sans",sans-serif}
.fold{background:var(--jc-cover);border:1px solid var(--jc-steel2);border-radius:8px;margin-bottom:12px}
.fold>summary{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;cursor:pointer;list-style:none;font:800 18px var(--jc-cond);letter-spacing:.02em;color:var(--jc-ink)}
.fold>summary::before{content:"";border:6px solid transparent;border-left:8px solid var(--jc-dim)}.fold[open]>summary::before{transform:rotate(90deg)}
.fold>summary small{font:500 13px "DM Sans",sans-serif;color:var(--jc-dim);letter-spacing:0}.fold.warn{border-left:6px solid var(--jc-hv)}.fold.wi{border:2px solid var(--jc-hv)}.fold.inner{margin:8px 0 0;background:transparent}
.cnt{font:800 14px var(--jc-cond);background:var(--jc-char);color:#F2F4F6;padding:1px 8px;border-radius:999px}.fold.warn .cnt{background:var(--jc-hv);color:var(--jc-ink)}
.fb{padding:0 14px 12px}table{border-collapse:collapse;width:100%;font-size:13.5px;background:#fff}th,td{padding:7px 8px;border-bottom:1px solid var(--jc-steel2);text-align:left;vertical-align:top}th{font:700 12px var(--jc-cond);letter-spacing:.04em;text-transform:uppercase;color:var(--jc-dim)}
td.r,th.r{text-align:right;white-space:nowrap}td.job b{display:block}td.job small{color:var(--jc-dim);font-size:11.5px}.dim{color:var(--jc-dim)}
.tag{font:800 14px var(--jc-cond);padding:1px 7px;border-radius:4px;background:var(--jc-hv);color:var(--jc-ink)}.pct.over{color:#8A4B00;font-weight:800}
.hdr{display:flex;align-items:center;gap:18px;background:var(--jc-char);color:#F2F4F6;padding:16px 22px;border-bottom:4px solid var(--jc-hv);border-radius:8px 8px 0 0;margin-bottom:14px}.hdr h1{font:800 34px/1 var(--jc-cond);margin:0;letter-spacing:.02em}.hdr p{margin:4px 0 0;color:#C9CFD6;font-size:13px}
.hero{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.lbl{background:var(--jc-cover);border:1px solid var(--jc-steel2);border-radius:8px;padding:12px 16px 12px 22px;position:relative}.lbl::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:6px;border-radius:0 3px 3px 0;background:var(--jc-char)}.lbl.r::before{background:var(--jc-red)}.lbl.f::before{background:var(--jc-blue)}.lbl.g::before{background:#1E8F4E}
.lbl h4{margin:0 0 2px;font:700 16px var(--jc-cond);color:var(--jc-dim)}.big{font:800 34px/1 var(--jc-cond)}.big small{font:600 13px "DM Sans",sans-serif;color:var(--jc-dim);margin-left:6px}
@media(max-width:700px){.grid,.hero,.n{grid-template-columns:1fr}body{padding:16px}}
</style></head><body>`;

// ── Goals ────────────────────────────────────────────────────────────────────
const sheet = { measures: [
  "Job margin (completed jobs, after labor and material)", "Commercial projects (share of our work)", "Hours vs estimate, company", "Hours vs estimate, every foreman",
  "Warranty hours (share of all job hours)", "Change orders with hours booked to their own cost center", "Home Depot / ACE runs", "Days to collect on our invoices", "Jobs with hours tracked weekly", "Shop and inventory",
].map((name, i) => ({ row: 15 + i, name, today: ["About 11.7%", "Battle Creek, Wise Flooring, ProSteel and Riverton Retail & Laundromat underway", "140% (old estimates)", "131–166%", "3.3%", "Almost none", "About 4 a week", "About 55", "Some", "Stock reset to zero in SimPro Oct 19"][i],
  goal: ["15% or better on every job", "About a quarter of our work", "110% or better", "115% or better", "Under 2%", "Every approved change order", "30% fewer", "Under 45", "Every job", "Clean, organized shop"][i] })) };
const NEW = new Set(["warranty", "coHours", "storeRuns", "hoursWeekly"]);
const render = (simDoc) => X.odGoalsModel({ sheet, sim: simDoc, sb: null, d: null, plans: null, now: new Date() });
const card = (x) => { const l = x.live, c = TONE[l ? l.tone : "grey"];
  const pill = !x.key ? "Not tracked yet" : !l ? "—" : l.pending ? (l.pendingText || "No Simpro pull yet") : l.tone === "good" ? "At goal" : l.tone === "warn" ? "Moving" : l.tone === "bad" ? "Off track" : "—";
  return `<div class="goal${NEW.has(x.key) ? " new" : ""}" style="--c:${c}"><div class="h"><b>${esc(x.name)}</b><span class="pill"><i></i>${esc(pill)}</span></div>
  <div class="n"><div><small>Sheet says</small><b class="s">${esc(x.today || "—")}</b></div><div><small>${x.key && !/^(firstPass|coOld|quiet|questions|returnTrips|rebook|plans)$/.test(x.key) ? "Simpro today" : "App today"}</small><b style="color:${c}">${esc(l ? l.value : "—")}</b></div><div><small>2027 goal</small><b class="s">${esc(x.goal || "—")}</b></div></div>
  ${l && !l.pending && l.people && l.people.length ? "" : (l && !l.pending && l.bar > 0 ? `<span class="bar"><i style="width:${Math.round(l.bar * 100)}%"></i></span>` : "")}
  <small class="sub">${esc(l ? l.sub : (x.key ? "" : "Not measured by the app or by the Simpro pull yet; a hand count. The sheet's words show as typed."))}</small>
  ${x.rule ? `<details class="rule"><summary>How it is counted</summary><p>${esc(x.rule)}</p></details>` : ""}</div>`; };
const g2 = render(sim), g1 = render(gs);
const fmtAt = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", minute: "2-digit" });
let html = head("Goals tab mockup", "") + `<h1>Goals</h1><p>Team Goals 2026–2027 · from the Goals sheet · Simpro numbers use Josh's rule, jobs invoiced this year · pulled ${esc(fmtAt(gs.generated_at))} · Phase 2 read ${esc(fmtAt(p2.generated_at))} (local, read-only)</p>
<div class="note">Mockup from a LIVE read-only pull, ${esc(new Date().toISOString().slice(0, 10))}: Phase 1 is the real settings/goalsSimpro doc; Phase 2 is the new pull run locally with the same code (functions/goalsPull.js pullPhase2, ${p2.errors.length ? "errors: " + esc(p2.errors.join("; ")) : "no errors"}). The four outlined cards are the ones this ship fills. Sheet rows are the 10/23 copy of the sheet.</div>
<div class="ct">2027 scoreboard<small>the sheet's number and today's beside it · open "How it is counted" on any card</small></div><div class="grid">${g2.measures.map(card).join("")}</div>
<div class="ct">Before the function is deployed<small>the same four cards with the Phase 1 doc only: pending in their own words, never a number</small></div><div class="grid">${g1.measures.filter(x => NEW.has(x.key)).map(card).join("")}</div>
</body></html>`;
fs.writeFileSync(path.join(__dirname, "goals.html"), html);

// ── Job Costs ────────────────────────────────────────────────────────────────
const rows = X.odCostsJoin(pc.rows, jobs, gs.jobs);
const { owns } = X.odCrews(users);
const team = users.filter(u => u && u.active !== false);
const ov = X.odCostsRoughOverruns(rows);
const co = X.odCostsCoHours(sim);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const fh = (x) => x == null ? "—" : Math.round(x).toLocaleString();
const fp = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
const fh1 = (x) => x == null ? "—" : (Math.round(x * 10) / 10).toLocaleString();
const who = (r) => X.odCostsOwners(r, team, owns).map(first).join(" · ") || "No one on the board";
const ovRow = (r) => `<tr><td class="job"><b>${esc(r.name)}</b><small>#${esc(r.no)} · ${esc(r.status || "—")}</small></td><td>${esc(who(r))}</td><td class="r">${fh(r.used)}<span class="dim"> / ${fh(r.est)} h</span></td><td class="r"><span class="tag">${fh(r.over)} h over</span></td><td class="r"><span class="pct over">${fp(r.pct)}</span></td></tr>`;
const ovTable = (rs) => `<table><thead><tr><th>Job</th><th>Foreman · lead</th><th class="r">Rough used / est</th><th class="r">Over by</th><th class="r">Of estimate</th></tr></thead><tbody>${rs.map(ovRow).join("")}</tbody></table>`;
const sumAll = X.odCostsSummary(rows);
const pctOf = (j) => X.odCostsJobPct(j);
const list = rows.filter(j => j.status !== "Invoiced").map(j => ({ j, p: pctOf(j) })).sort((a, b) => (b.p.rough_hrs_overBy || 0) - (a.p.rough_hrs_overBy || 0)).slice(0, 15);
const coCell = (j) => { const v = co && co.has(String(j.no)) ? co.get(String(j.no)) : null; return v == null ? "–" : `${fh1(v)}<span class="dim"> h</span>`; };
html = head("Job Costs tab mockup", "") + `<div class="jc"><div class="hdr"><div><h1>Job Costs</h1><p>Every cost center, base bid and change orders, split into rough and finish. Credit and finished-job margins follow Josh's rule. Pulled ${esc(fmtAt(pc.generated_at))}.</p></div></div>
<div class="note">Mockup from a LIVE read-only pull, ${esc(new Date().toISOString().slice(0, 10))}: the real settings/phaseCosts rows (${pc.rows.length} jobs), the Job Board, Settings › Team and the Phase 2 local run. The early-warning fold is shown OPEN here so it can be checked; in the app it starts folded with the count on its header.</div>
<details class="fold warn" open><summary><b>Open jobs already past rough hours</b><span class="cnt">${ov.all.length}</span><small>top five by hours over · rough hours from every cost center · tap a job for its cost centers</small></summary>
<div class="fb">${ovTable(ov.top)}${ov.rest.length ? `<details class="fold inner"><summary><b>Show all</b><span class="cnt">${ov.all.length}</span><small>${ov.rest.length} more</small></summary><div class="fb">${ovTable(ov.rest)}</div></details>` : ""}</div></details>
<details class="fold wi"><summary><b>What-if</b><span class="cnt">2</span><small>jobs switched off · the boxes and the people list leave them out · nothing in Simpro or the app changes</small></summary><div class="fb">${esc(rows[0].name)}, ${esc(rows[1].name)} — Turn all back on</div></details>
<div class="hero"><div class="lbl r"><h4>Rough hours</h4><div class="big">${fp(sumAll.rough_hrs_pct)}<small>of estimate</small></div><div class="dim">${fh(sumAll.rough_hrs_used)} h of ${fh(sumAll.rough_hrs_est)} h · ${sumAll.rough_hrs_over} of ${sumAll.rough_started} over</div></div>
<div class="lbl f"><h4>Finish hours</h4><div class="big">${fp(sumAll.finish_hrs_pct)}<small>of estimate</small></div><div class="dim">${fh(sumAll.finish_hrs_used)} h of ${fh(sumAll.finish_hrs_est)} h · ${sumAll.finish_hrs_over} of ${sumAll.finish_started} over</div></div>
<div class="lbl g"><h4>Whole job margin, Josh's numbers</h4><div class="big">${sumAll.whole.w == null ? "—" : (Math.round(sumAll.whole.w * 1000) / 10).toFixed(1) + "%"}<small>goal 15%</small></div><div class="dim">${sumAll.whole.n} jobs invoiced in full 2026</div></div></div>
<div class="ct">Every job, hours<small>open jobs, worst first · the Untagged est column is gone · CO hrs, own CC is new (hidden until the Phase 2 pull has run)</small></div>
<table><thead><tr><th>Job</th><th>Technician</th><th>Status</th><th class="r">Rough used / est</th><th class="r">Rough %</th><th class="r">Finish used / est</th><th class="r">Finish %</th><th class="r">CO hrs, own CC</th></tr></thead><tbody>
${list.map(({ j, p }) => `<tr><td class="job"><b>${esc(j.name)}</b><small>#${esc(j.no)}${j.site ? ", " + esc(j.site) : ""}</small></td><td>${esc(j.foremanShown)}${j.lead && j.lead !== j.foreman ? `<br><small class="dim">lead ${esc(first(j.lead))}</small>` : ""}</td><td>${esc(j.status || "—")}</td><td class="r">${fh(j.rough_hrsUsed)}<span class="dim"> / ${fh(j.rough_hrsEst)}</span></td><td class="r"><span class="pct${p.rough_hrs_pct > 1 ? " over" : ""}">${fp(p.rough_hrs_pct)}</span></td><td class="r">${fh(j.finish_hrsUsed)}<span class="dim"> / ${fh(j.finish_hrsEst)}</span></td><td class="r">${fp(p.finish_hrs_pct)}</td><td class="r">${coCell(j)}</td></tr>`).join("")}
</tbody></table></div></body></html>`;
fs.writeFileSync(path.join(__dirname, "costs.html"), html);
console.log("rendered", { overruns: ov.all.length, top: ov.top.map(r => `${r.name} ${r.over}h ${who(r)}`), coJobs: co ? co.size : 0, phase2cards: g2.measures.filter(x => NEW.has(x.key)).map(x => `${x.key}=${x.live.value} (${x.live.tone})`) });
