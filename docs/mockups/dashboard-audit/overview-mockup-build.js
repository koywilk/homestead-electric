// Builds docs/mockups/dashboard-audit/overview.html from a READ-ONLY live pull
// (overview-pull-readonly.js) run through the SHIPPED dashboard model + the v579 helpers.
// Every row is real: nothing is invented. Run from the repo root:
//   node docs/mockups/dashboard-audit/overview-mockup-build.js <pull dir>
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..", "..", ".."); process.chdir(root);
const { makeSandbox } = require(path.join(root, "scripts/odash-model-test.js"));
const S = (process.argv[2] || ".") + "/"; const J = (f) => JSON.parse(fs.readFileSync(S + f, "utf8"));
const X = makeSandbox();
const shape = (raw) => ({ changeOrders: [], returnTrips: [], uploadedFiles: [], customLinks: [], roughMaterials: [], roughUpdates: [], finishMaterials: [], finishUpdates: [], commMaterials: [], homeRuns: {}, roughPunch: {}, finishPunch: {}, qcPunch: {}, roughQuestions: { upper: [], main: [], basement: [] }, finishQuestions: { upper: [], main: [], basement: [] }, ...raw });
const jobs = J("jobs.json").map(shape), users = (J("settings_users.json").list || []), needs = J("needs.json"), upcoming = J("settings_upcoming_jobs.json").items || [];
const now = new Date(); const d = X.odModel({ jobs, users, needs, upcoming, now, range: 14, simTotals: J("settings_simproTotals.json") });
const sched = J("schedule.json");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`, dow = (dt) => dt.toLocaleDateString([], { weekday: "short" });
const money = (n) => n == null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `$${Math.round(n / 1e3)}k` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const OD = { O: "#B4531A", G: "#18804A", R: "#C43B3B", B: "#2563C9", P: "#6A4FC8", WARN: "#B23A6E", A: "#8E6336", SLATE: "#5B6B84", GREY: "#6B7487" };

// ── the three new helpers on the live data ──
const today = X.odTodayByCrew({ planner: sched.doc, jobs: d.active, crews: d.crews, now });
const wk = X.odStartsUnconfirmedWeek(d.sched, now), wb = X.odWeekBounds(now);
const risk = X.odMoneyAtRisk(d.attnBy.coOld.rows);
// The last week the planner held assignments (Apr 27 2026): real cells, real names, shown as an example of the filled strip.
let example = null;
try { const ex = J("schedule_2026-04-27.json"); const exNow = new Date(2026, 3, 28, 9); example = { when: "Tue 4/28/2026", t: X.odTodayByCrew({ planner: ex, jobs: d.active, crews: d.crews, now: exNow }) }; } catch (e) {}

const needYou = [
  d.timeOff.length && { label: "Time-off requests to decide", n: d.timeOff.length, color: OD.O, icon: "cal" },
  d.openQs.length && { label: "Crew questions not answered", n: d.openQs.length, color: OD.O, icon: "q", extra: `${d.openQs.filter(x => x.age != null && x.age < 7).length} this week · oldest ${d.openQs[0] && d.openQs[0].age} d` },
  d.noForemanJobs.length && { label: "Jobs with no active foreman", n: d.noForemanJobs.length, color: OD.O, icon: "hat", extra: d.noFmText },
  d.closedSim.length && { label: "Closed in Simpro — close it here?", n: d.closedSim.length, color: OD.B, icon: "ok" },
  new Set(d.syncWeek.map(x => x.job.id)).size && { label: "Changed by the Simpro sync this week", n: new Set(d.syncWeek.map(x => x.job.id)).size, color: OD.B, icon: "sync" },
  d.qcRows.filter(r => r.st === "needs" || r.st === "overdue").length && { label: "QC walks that need a walk", n: d.qcRows.filter(r => r.st === "needs" || r.st === "overdue").length, color: OD.B, icon: "clip" },
].filter(Boolean);
const ic = (c) => `<span class="ic" style="--c:${c}"></span>`;
const attnLine = (a) => { const ages = a.rows.map(r => parseInt(r.right, 10)).filter(n => !isNaN(n)); const oldest = ages.length ? Math.max(...ages) : 0;
  return `<button class="ln">${ic(a.color)}<span class="lb">${esc(a.label)}${a.extra ? `<small> · ${esc(a.extra)}</small>` : ""}${oldest ? `<small> · oldest ${oldest} d</small>` : ""}</span><span class="n" style="color:${a.color}">${a.rows.length}</span><span class="chev">›</span></button>`; };
const stageCap = d.bySec.slice(0, 5).map(s => `${s.short || s.label} ${s.jobs.length}`).join(" · ") + (d.bySec.length > 5 ? ` · +${d.bySec.slice(5).reduce((n, s) => n + s.jobs.length, 0)}` : "");
const underway = d.active.filter(j => d.secOf(j) && ["rough", "finish"].includes(d.secOf(j).key)).length;
const ahead = (n) => d.sched.filter(s => s.at >= d.t0 && s.at < new Date(d.t0.getFullYear(), d.t0.getMonth(), d.t0.getDate() + n));
const next7 = ahead(7), next14 = ahead(14);
const SC = { start: OD.O, insp: OD.G, qc: OD.B, scan: OD.P, rt: OD.R };
const shownForemen = d.foremenP.map(p => ({ p, t: d.troubleOf(p.name) })).sort((a, b) => (b.t.total - a.t.total) || (b.p.todayN - a.p.todayN));
const bars = (vals, color) => { const m = Math.max(1, ...vals); return `<svg width="${vals.length * 12 - 5}" height="34">${vals.map((v, i) => `<rect x="${i * 12}" y="${34 - Math.max(2, 34 * v / m)}" width="7" height="${Math.max(2, 34 * v / m)}" rx="2" fill="${color}" opacity="${i === vals.length - 1 ? 1 : .45}"/>`).join("")}</svg>`; };
const stripRows = (t) => t.groups.map(g => `<div class="crew"><div class="ch">${esc(g.label)}<small>${plural(g.people, "person").replace("persons", "people")} · ${plural(g.rows.length, "job")}</small></div>${g.rows.map(r => `<div class="cj"><b>${esc(r.name)}</b><span>${r.names.map(n => `<em${r.lead && n.toLowerCase() === r.lead.toLowerCase() ? ' class="lead"' : ""}>${esc(n)}</em>`).join("")}</span></div>`).join("")}</div>`).join("")
  + (t.other.length ? `<div class="crew"><div class="ch">Others<small>on no crew in Settings › Team</small></div>${t.other.map(r => `<div class="cj"><b>${esc(r.name)}</b><span>${r.names.map(n => `<em>${esc(n)}</em>`).join("")}</span></div>`).join("")}</div>` : "");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overview mockup</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Bebas+Neue&display=swap" rel="stylesheet">
<style>
:root{--page:#F7F4EE;--ink:#292119;--dim:#6B6157;--line:#E6DFD3;--card:#fff;--a:#8E6336}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.4 'DM Sans',system-ui,sans-serif}
.wrap{max-width:1380px;margin:0 auto;padding:22px}
.note{font-size:12px;color:var(--dim);border:1px dashed var(--line);border-radius:12px;padding:8px 12px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:16px}
.panel{background:rgba(255,255,255,.66);border:1px solid rgba(41,33,25,.08);border-radius:22px;padding:18px;display:flex;flex-direction:column;gap:16px;min-width:0}
h1{margin:0;font-family:'Bebas Neue',sans-serif;font-size:28px;font-weight:400;letter-spacing:.06em}
.head p{margin:3px 0 0;font-size:12.5px;color:var(--dim)}
.white{background:var(--card);border-radius:18px;border:1px solid var(--line);box-shadow:0 1px 2px rgba(41,33,25,.05),0 12px 26px -20px rgba(41,33,25,.28)}
.pad{padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.needyou{border-color:rgba(196,59,59,.28);box-shadow:inset 3px 0 0 ${OD.R},0 1px 2px rgba(41,33,25,.05)}
.ct{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:14px}.ct small{font-weight:500;color:var(--dim);font-size:12px}
.ln{display:flex;align-items:center;gap:10px;border:0;border-bottom:1px solid var(--line);background:transparent;padding:10px 2px;text-align:left;cursor:pointer;color:var(--dim);width:100%;font:inherit}
.ln .ic{width:26px;height:26px;border-radius:8px;background:color-mix(in srgb,var(--c) 15%,transparent);flex:none;position:relative}.ln .ic::after{content:"";position:absolute;inset:8px;border-radius:3px;background:var(--c)}
.ln .lb{flex:1;font-size:12.5px;font-weight:600;color:var(--ink)}.ln .lb small{font-size:11.5px;font-weight:600;color:var(--dim)}
.ln .n{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}.chev{color:var(--dim)}
.today{border-color:rgba(142,99,54,.35);box-shadow:inset 3px 0 0 var(--a),0 1px 2px rgba(41,33,25,.05)}
.quiet{color:var(--dim);font-size:12.5px;padding:4px 2px}
.crews{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.crew{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.ch{font-weight:700;font-size:12.5px;display:flex;justify-content:space-between;gap:8px}.ch small{font-weight:500;color:var(--dim);font-size:11.5px}
.cj{display:flex;flex-direction:column;gap:3px;border-top:1px dashed var(--line);padding-top:6px}.cj b{font-size:12.5px}.cj span{display:flex;flex-wrap:wrap;gap:4px}
.cj em{font-style:normal;font-size:11.5px;background:rgba(41,33,25,.06);border-radius:999px;padding:2px 8px}.cj em.lead{background:rgba(142,99,54,.14);color:#6E4A26;font-weight:700}
details.fold{border-top:1px dashed var(--line);padding-top:8px}details.fold summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-weight:700;font-size:12.5px}
details.fold summary::before{content:"▸";color:var(--dim);font-size:12px}details.fold[open] summary::before{content:"▾"}details.fold summary small{font-weight:500;color:var(--dim)}
details.fold summary .cnt{margin-left:auto;font-weight:800;font-size:13px;font-variant-numeric:tabular-nums;background:rgba(41,33,25,.06);border-radius:999px;padding:1px 9px}
.rows{display:flex;flex-direction:column}.row{display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid var(--line);font-size:12.5px}.row b{display:block}.row small{color:var(--dim);font-size:11.5px}.row .t{margin-left:auto;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.row .k{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none}
.row2{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px}.stack{display:flex;flex-direction:column;gap:12px}
.money{display:flex;align-items:center;gap:10px;border:1px solid rgba(196,59,59,.28);background:rgba(196,59,59,.06);border-radius:12px;padding:10px 12px;cursor:pointer;text-align:left;font:inherit;color:var(--ink);width:100%}
.money b{font-size:18px;font-weight:800;color:${OD.R};font-variant-numeric:tabular-nums}.money span{font-size:12.5px}.money small{display:block;color:var(--dim);font-size:11.5px}
.mini{padding:14px 16px;display:flex;flex-direction:column;gap:6px}.mini .t{font-size:12px;font-weight:700;color:var(--dim)}.mini .v{font-size:28px;font-weight:800;line-height:1}.mini .v small{font-size:12px;font-weight:600;color:var(--dim);margin-left:8px}.mini .cap{font-size:11.5px;color:var(--dim)}
.busy{margin-top:auto;border-top:1px dashed var(--line);padding-top:10px;font-size:13px}.busy small{display:block;font-size:11.5px;color:var(--dim)}
.sec{display:flex;align-items:center;gap:10px;font-weight:700;font-size:14px}.sec span::before{content:"";display:inline-block;width:3px;height:15px;border-radius:2px;background:var(--a);margin-right:9px;vertical-align:-2px}.sec small{margin-left:auto;font-weight:500;color:var(--dim);font-size:12px}
.plan{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.fm{padding:14px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.fm b{font-size:14px}.fm p{margin:3px 0 0;font-size:12px;color:var(--dim)}.fm .trouble{color:${OD.WARN};font-weight:600}.fm .day{display:block;margin-top:6px;font-size:11.5px;color:var(--dim)}.tag{font-size:10.5px;color:#6E4A26;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-left:6px}
.rail{background:#292119;color:#F7F4EE;border-radius:22px;padding:18px;display:flex;flex-direction:column;gap:14px}.rail .me b{font-size:16px}.rail .me small{display:block;color:rgba(247,244,238,.6);font-size:12px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stats div{background:rgba(255,255,255,.07);border-radius:12px;padding:10px}.stats b{display:block;font-size:22px;font-weight:800}.stats small{font-size:11px;color:rgba(247,244,238,.65)}
.rail .sec{color:#F7F4EE}.rail .sec small{color:rgba(247,244,238,.6)}
.item{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:12.5px}.item .th{width:10px;height:10px;border-radius:50%;background:var(--c);margin-top:4px;flex:none}.item em{display:block;font-style:normal;font-size:11px;font-weight:700;color:var(--c)}.item small{display:block;color:rgba(247,244,238,.6);font-size:11.5px}.item .when{margin-left:auto;font-size:11.5px;color:rgba(247,244,238,.7);white-space:nowrap}
@media (max-width:1000px){.grid,.row2,.plan{grid-template-columns:minmax(0,1fr)}}
</style></head><body><div class="wrap">
<div class="note">Mockup for the Overview tab audit (SW v579) · generated ${esc(now.toLocaleString())} from a read-only pull of live Firestore run through the shipped dashboard model. Every row is real. Trimmed from this tab: the Open punch items mini, the Activity-per-day chart, the Open change orders tile and the Inspections-30-days mini (all still on their home tabs). Plans-waiting and automated-docs lines of Needs you come from other feeds and are not pulled here.</div>
<div class="grid"><div class="panel">
<div class="head"><h1>${now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"}, Koy</h1><p>${esc(now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }))} · ${plural(d.evToday.length, "thing")} logged today across ${plural(new Set(d.evToday.map(e => e.job.id)).size, "job")}</p></div>
${needYou.length ? `<div class="white pad needyou"><div class="ct">Needs you<small>decisions only you make · tap a line</small></div><div>${needYou.map(x => `<button class="ln">${ic(x.color)}<span class="lb">${esc(x.label)}${x.extra ? `<small> · ${esc(x.extra)}</small>` : ""}</span><span class="n" style="color:${x.color}">${x.n}</span><span class="chev">›</span></button>`).join("")}</div></div>` : ""}
<div class="white pad today"><div class="ct">Today<small>who is on which job · from the Crew Planner (settings/schedule_${esc(sched.monday)}) · ${esc(dow(now))} ${esc(short(now))}</small></div>
${today.empty ? `<div class="quiet">${today.weekend ? "No crew planner on a weekend." : `The Crew Planner has nothing for today${sched.doc ? "" : " (no week doc yet)"}. Fill it in on the Crew Planner and this strip shows who is where.`}</div>` :
  `<div class="crews">${stripRows(today)}</div><details class="fold"><summary>Active jobs with nobody scheduled today<span class="cnt">${today.unscheduled.length}</span></summary><div class="rows">${today.unscheduled.map(j => `<div class="row"><span class="k" style="--c:${(d.secOf(j) || {}).color || OD.GREY}"></span><div><b>${esc(j.name)}</b><small>${esc((d.secOf(j) || {}).label || "")} · ${esc(j.foreman || "No foreman")}</small></div></div>`).join("")}</div></details>`}
</div>
${example && !example.t.empty ? `<div class="white pad" style="border-style:dashed"><div class="ct">How the strip reads when the planner is filled in<small>real cells from the last week the planner was used · ${esc(example.when)} · ${plural(example.t.jobsN, "job")} · ${plural(example.t.peopleN, "person").replace("persons", "people")}</small></div><div class="crews">${stripRows(example.t)}</div><details class="fold"><summary>Active jobs with nobody scheduled that day<span class="cnt">${example.t.unscheduled.length}</span></summary><div class="quiet">today's ${d.active.length} active jobs against that week's cells, folded</div></details></div>` : ""}
<div class="row2">
 <div class="white pad"><div class="ct">Needs attention<small>chases · tap a line</small></div>
  ${risk.n ? `<button class="money"><b>${esc(money(risk.dollars))}</b><span>Money at risk · ${plural(risk.n, "change order")} on ${plural(risk.jobs, "job")} waiting on the GC 60+ days<small>${risk.quotes} Simpro ${risk.quotes === 1 ? "quote" : "quotes"}, each counted once${risk.noQuote ? ` · ${risk.noQuote} with no quote $ yet` : ""}</small></span><span class="chev">›</span></button>` : ""}
  <div>${d.attn.map(attnLine).join("")}</div>
  ${d.busy ? `<div class="busy"><small>Most activity ${esc(d.busy.when)}</small><b>${esc(d.busy.job.name)}</b> · ${plural(d.busy.n, "thing")} logged${d.busy.qs ? ` · ${plural(d.busy.qs, "open question")}` : ""}${d.busy.punch ? ` · ${d.busy.punch} punch` : ""}</div>` : ""}
 </div>
 <div class="stack">
  <div class="white mini"><div class="t">Active jobs</div><div class="v">${d.active.length}<small>${underway} with work underway</small></div>${bars(d.bySec.slice(0, 7).map(s => s.jobs.length), OD.A)}<div class="cap">${esc(stageCap)}${d.closedSim.length ? ` · ${d.closedSim.length} closed in Simpro not counted` : ""}</div></div>
  <div class="white pad"><details class="fold" style="border:0;padding:0"><summary>Starts this week not confirmed<small>Mon ${short(wb.mon)} – Sun ${short(wb.sun)}</small><span class="cnt">${wk.length}</span></summary>
   <div class="rows">${wk.length ? wk.map(s => `<div class="row"><span class="k" style="--c:${OD.O}"></span><div><b>${esc(s.name)}</b><small>${esc(s.label)} · ${esc(dow(s.at))} ${esc(short(s.at))}${s.at < d.t0 ? " · date passed" : ""} · ${esc((s.job && s.job.foreman) || (s.job ? "No foreman" : "Upcoming tab"))}</small></div><span class="t">${s.job ? "Move / confirm" : ""}</span></div>`).join("") : `<div class="quiet">Every start this week is confirmed.</div>`}</div></details></div>
 </div>
</div>
<div class="sec"><span>Foremen</span><small>${shownForemen.filter(x => x.p.todayN > 0).length} of ${shownForemen.length} foremen posted today</small></div>
<div class="plan">${shownForemen.slice(0, 12).map(({ p, t }) => { const fj = d.active.filter(j => d.owns(j, p.name)); const op = fj.reduce((n, j) => n + d.info[j.id].punch.length, 0); const pc = d.crewOf(p.name);
  return `<div class="white fm"><div><b>${esc(p.name)}</b>${pc ? `<span class="tag">${esc(pc.label)}</span>` : ""}<p>${plural(fj.length, "active job")} · ${op} open punch${p.lastJob ? ` · last on ${esc(p.lastJob)}` : ""}</p>${t.text ? `<p class="trouble">${esc(t.text)}</p>` : ""}<span class="day">${p.status === "active" ? (p.todayN ? `${plural(p.todayN, "thing")} logged today` : "Opened a job today, nothing logged") : p.status === "off" ? "Off today · approved" : "Not seen today"}</span></div>${bars(p.days7, OD.A)}</div>`; }).join("")}</div>
</div>
<div class="rail"><div class="me"><b>Koy Wilkinson</b><small>Residential</small></div>
<div class="stats"><div><b>${next7.length}</b><small>Dated, next 7 d</small></div><div><b>${d.people.filter(p => p.status === "active").length}</b><small>Crew on app today</small></div><div><b>${d.openNeeds.length}</b><small>Open tasks</small></div></div>
${d.ptoWeek.length ? `<div class="sec"><span>Out this week</span><small>${d.ptoWeek.length}</small></div>${d.ptoWeek.slice(0, 5).map(p => `<div class="item" style="--c:${OD.SLATE}"><span class="th"></span><div><em>Out</em><b>${esc(p.name)}</b><small>${esc(p.note || "Time off")}</small></div></div>`).join("")}` : `<div class="quiet" style="color:rgba(247,244,238,.6)">Nobody out this week.</div>`}
<div class="sec"><span>Next 14 days</span><small>see all</small></div>
<div>${next14.slice(0, 7).map(s => `<div class="item" style="--c:${SC[s.type] || OD.A}"><span class="th"></span><div><em>${esc(s.label)}</em><b>${esc(s.name)}</b>${s.type === "start" ? `<small>${s.confirmed ? "confirmed" : "projected"}</small>` : ""}</div><span class="when">${s.at.getTime() === d.t0.getTime() ? "Today" : `${esc(dow(s.at))} ${esc(short(s.at))}`}</span></div>`).join("") || `<div class="quiet">Nothing dated in the next 14 days.</div>`}</div>
</div></div>
<div class="note" style="margin-top:14px">Numbers behind this page · active ${d.active.length} · Needs attention lines ${d.attn.length} · 60+ day COs ${risk.n} on ${risk.jobs} jobs, ${esc(money(risk.dollars))} across ${risk.quotes} quotes (${risk.noQuote} with no $) · starts this week ${d.sched.filter(s => s.type === "start" && s.at >= wb.mon && s.at < wb.end).length}, not confirmed ${wk.length} · planner cells today ${today.jobsN}${example ? ` · example week cells ${example.t.jobsN}` : ""}</div>
</div></body></html>`;
fs.writeFileSync(path.join(__dirname, "overview.html"), html);
console.log("wrote overview.html", { active: d.active.length, risk, starts: wk.map(s => s.name), today: today.empty ? "empty" : today.jobsN, example: example && example.t.groups.map(g => g.label + ":" + g.rows.length) });
