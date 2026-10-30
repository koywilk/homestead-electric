#!/usr/bin/env node
/* people-render-readonly.js — renders docs/mockups/dashboard-audit/people.html from a LIVE read-only pull
 * (people-pull-readonly.js + the week's Simpro schedule) through the SHIPPED helpers (odModel, odCrews,
 * odPeopleByCrew, odTodayByPerson) so every row is real. Nothing is written anywhere but the HTML.
 * Run: node people-render-readonly.js <snapshot dir> [YYYY-MM-DD to render as "today"] */
const fs = require("fs"), path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const { makeSandbox } = require(path.join(REPO, "scripts", "odash-model-test.js"));
const S = process.argv[2]; const J = (f) => JSON.parse(fs.readFileSync(path.join(S, f), "utf8"));
const X = makeSandbox();
const shape = (raw) => ({ changeOrders: [], returnTrips: [], uploadedFiles: [], customLinks: [], roughMaterials: [], roughUpdates: [], finishMaterials: [], finishUpdates: [], commMaterials: [], homeRuns: {}, roughPunch: {}, finishPunch: {}, qcPunch: {}, roughQuestions: { upper: [], main: [], basement: [] }, finishQuestions: { upper: [], main: [], basement: [] }, ...raw });
const jobs = J("jobs.json").map(shape), users = (J("settings_users.json").list || []), needs = J("needs.json"), upcoming = J("settings_upcoming_jobs.json").items || [];
const pto = J("settings_crewPTO.json").list || [], devices = J("settings_deviceVersions.json").devices || {}, simpro = J("simpro_schedule_week.json"), week = J("schedule_week.json");
const asDay = process.argv[3]; const now = asDay ? new Date(asDay + "T13:30:00") : new Date();
const d = X.odModel({ jobs, users, needs, upcoming, now, range: 14, pto, simTotals: J("settings_simproTotals.json") });
const cells = (week.doc && week.doc.assignments) || {};
const t = X.odTodayByPerson({ cells, simpro, now, jobs: d.allLive, users });
const groups = X.odPeopleByCrew(d.people, d.crews);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const DAY = 864e5;
const ago = (at) => { if (!at) return ""; const m = Math.round((now - at) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const latest = "homestead-v578", latestBuild = 578;
const build = (v) => { const m = /v(\d+)/.exec(String(v || "")); return m ? +m[1] : 0; };
const devList = Object.entries(devices).map(([id, v]) => ({ id, ...v, build: build(v.version), seen: v.lastSeenAt ? new Date(v.lastSeenAt) : null })).filter(v => v.seen && now - v.seen < 14 * DAY).sort((a, b) => b.seen - a.seen).filter((v, i, arr) => !v.name || arr.findIndex(x => same(x.name, v.name)) === i);
const devOf = (name) => devList.find(v => same(v.name, name)) || null;
const current = devList.filter(v => v.build >= latestBuild).length, behind = devList.filter(v => v.build < latestBuild).sort((a, b) => a.build - b.build || b.seen - a.seen);
const statusColor = { active: "#18804A", earlier: "#2563C9", quiet: "#C43B3B", off: "#5B6B84", idle: "#6B7487", gone: "#6B7487" };
const line = (p) => p.status === "active" ? (p.todayN ? `logged ${p.todayN} today` : `opened ${p.openedN || p.jobsToday} job${(p.openedN || p.jobsToday) === 1 ? "" : "s"} · nothing logged`) : p.status === "off" ? "Off · approved" : p.last ? `last on a job ${ago(p.last)}` : "not seen in 30 days";
const row = (r) => { const p = r.p, td = X.odTodayText(t.rows[p.name.trim().toLowerCase()]), dv = devOf(p.name);
  return `<button class="row" type="button"><i class="dot" style="background:${statusColor[p.status] || "#6B7487"}"></i><span class="nm"><b>${esc(p.name)}</b><small>${esc(r.tierLabel)}${p.jobsOn.length ? ` · ${p.jobsOn.length} job${p.jobsOn.length === 1 ? "" : "s"}` : ""}</small></span>
  <span class="td">${td ? `<b>${esc(td)}</b><small>${t.weekend ? "" : "today, from the Crew Planner"}</small>` : `<em>${t.weekend ? "weekend" : "not scheduled"}</em>`}</span>
  <span class="ls"><small>${esc(line(p))}</small></span>
  <span class="ver ${dv ? (dv.build >= latestBuild ? "ok" : "") : "none"}">${dv ? "v" + dv.build : "no phone seen"}</span></button>`; };
const sub = (g) => { const on = g.rows.filter(r => t.rows[r.name.trim().toLowerCase()]).length, quiet = g.rows.filter(r => r.p.status === "quiet").length, off = g.rows.filter(r => r.p.status === "off").length;
  return [t.weekend ? "" : `${on} of ${g.n} on a job today`, quiet ? `${quiet} quiet` : "", off ? `${off} off` : ""].filter(Boolean).join(" · ") || "nobody scheduled today"; };
const fold = (g, open) => `<details class="fold" ${open ? "open" : ""}><summary><span class="cv"></span><b>${esc(g.label)}</b><small>${esc(sub(g))}</small><span class="n">${g.n}</span></summary><div class="rows">${g.rows.map(row).join("")}</div></details>`;
const quietP = d.people.filter(p => p.status === "quiet"), onApp = d.people.filter(p => p.status === "active").length;
const todayLabel = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
const offTeam = t.offTeam.length ? `<p class="note">Also on Simpro's schedule today but not on Settings › Team: ${esc(t.offTeam.join(", "))}</p>` : "";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>People tab — dashboard audit mockup</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--page:#F7F4EE;--ink:#292119;--dim:#6B6157;--line:rgba(41,33,25,.1);--card:#fff;--a:#8E6336;--g:#18804A;--r:#C43B3B;--b:#2563C9}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.4 -apple-system,"Segoe UI",Inter,system-ui,sans-serif;padding:24px}
h1{font-size:26px;margin:0 0 4px}h1+p{margin:0 0 18px;color:var(--dim)}
.wrap{max-width:1180px;margin:0 auto}.grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px}
.minis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.mini{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}.mini small{display:block;color:var(--dim);font-weight:700;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase}.mini b{font-size:28px;line-height:1.1}.mini span{color:var(--dim);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:14px}.ct{font-weight:700;font-size:14px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.ct small{color:var(--dim);font-weight:500;font-size:12px}
.fold{border-top:1px solid var(--line)}.fold:first-of-type{border-top:0}.fold summary{list-style:none;display:flex;align-items:center;gap:10px;padding:11px 0;cursor:pointer}.fold summary::-webkit-details-marker{display:none}
.fold .cv{width:0;height:0;border:5px solid transparent;border-left:7px solid var(--a);margin-right:2px;transition:transform .15s}.fold[open] .cv{transform:rotate(90deg)}
.fold summary b{font-size:13.5px}.fold summary small{color:var(--dim);font-size:12px;flex:1}.fold .n{background:rgba(142,99,54,.12);color:var(--a);font-weight:800;font-size:12px;border-radius:999px;padding:2px 9px}
.rows{display:flex;flex-direction:column;gap:6px;padding:0 0 10px 20px}
.row{display:grid;grid-template-columns:10px minmax(150px,1.1fr) minmax(0,1.6fr) minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;background:var(--page);border:1px solid var(--line);border-radius:12px;padding:8px 10px;text-align:left;font:inherit;color:inherit;cursor:pointer}
.row .dot{width:10px;height:10px;border-radius:50%;display:block}.row .nm b{display:block;font-size:13px}.row small{display:block;color:var(--dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row .td b{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .td em{font-style:normal;color:#8A8277;font-size:12px}
.row .ver{font-weight:800;font-size:11.5px;border-radius:999px;padding:2px 8px;color:var(--r);background:rgba(196,59,59,.1);white-space:nowrap}.row .ver.ok{color:var(--g);background:rgba(24,128,74,.1)}.row .ver.none{color:#8A8277;background:rgba(41,33,25,.06)}
.rail .sec{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:14px;margin:12px 0 8px}.rail .sec small{color:var(--dim);font-weight:600}
.item{display:flex;gap:10px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:9px 10px;margin-bottom:8px}.item em{font-style:normal;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;display:block;color:var(--a)}.item b{font-size:12.5px;display:block}.item small{color:var(--dim);font-size:11.5px;display:block}
.stats{display:grid;grid-template-columns:repeat(3,1fr);background:rgba(41,33,25,.045);border:1px solid var(--line);border-radius:16px;padding:6px 4px;text-align:center}.stats div b{display:block;font-size:20px}.stats div small{color:var(--dim);font-size:11px}
.dev{display:flex;align-items:center;gap:8px;font-size:12px;padding:7px 0;border-bottom:1px solid var(--line)}.dev:last-child{border-bottom:0}.dev .nm{font-weight:700}.dev .sn{color:var(--dim);font-size:11.5px}.dev em{margin-left:auto;font-style:normal;font-weight:800;font-size:11.5px;color:var(--r);background:rgba(196,59,59,.1);border-radius:999px;padding:2px 8px}
.note{color:var(--dim);font-size:12px;margin:8px 0 0}.status{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px}.status b{color:var(--g)}.btn{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 11px;font:inherit;font-size:12px;font-weight:700;color:var(--ink)}
.banner{background:rgba(142,99,54,.08);border:1px solid rgba(142,99,54,.3);border-radius:12px;padding:10px 14px;font-size:12.5px;margin-bottom:16px}
h2{font-size:18px;margin:28px 0 8px}
</style></head><body><div class="wrap">
<div class="banner">Mockup rendered ${esc(new Date().toLocaleString())} from a live read-only pull, through the shipped dashboard helpers. Rendered as <b>${esc(todayLabel)}</b>. Every crew and the device list start folded; tap a header to open it.</div>
<h1>People</h1><p>Who is on the app, where everyone is today, and which phones need an update · tap anyone</p>
<div class="grid"><div>
<div class="minis">
<div class="mini"><small>On the app today</small><b>${onApp}</b> <span>of ${d.teamN}</span></div>
<div class="mini"><small>Open My Day tasks</small><b>${d.openNeeds.length}</b> <span>${d.openNeeds.filter(n => X.odModel ? true : true).length ? "" : ""}</span></div>
<div class="mini"><small>Time off waiting</small><b>${d.timeOff.length}</b> <span>requests</span></div>
<div class="mini"><small>Phones on latest</small><b>${current}</b> <span>of ${devList.length} seen</span></div>
</div>
<div class="card"><div class="ct">People by crew<small>Settings › Team · ${d.people.length} people · ${t.weekend ? "weekend, nothing scheduled" : `${Object.keys(t.rows).filter(k => d.people.some(p => p.name.trim().toLowerCase() === k)).length} on a job today (Crew Planner)`} · red = quiet 3+ days, green = on today</small></div>
${groups.map((g, i) => fold(g, false)).join("")}
${offTeam}
</div>
</div><div class="rail">
<div class="stats"><div><b>${d.teamN}</b><small>Team</small></div><div><b>${d.roster.length}</b><small>Foremen</small></div><div><b>${quietP.length}</b><small>Quiet 3+ days</small></div></div>
${d.ptoWeek.length ? `<div class="sec">Out today / this week<small>${d.ptoWeek.length}</small></div>${d.ptoWeek.map(p => `<div class="item"><div><em>${p.start <= d.today ? "Out today" : "Out"}</em><b>${esc(p.name)}</b><small>${esc(p.note || "Time off")}</small></div></div>`).join("")}` : ""}
<div class="sec">Time off waiting<small>${d.timeOff.length}</small></div>
${d.timeOff.slice(0, 5).map(n => `<div class="item"><div><em>${esc(n.requestedBy || "Request")}</em><b>${esc(X.odModel && String(n.text || "").replace(/<[^>]*>/g, "").replace(/^Time off\s*[—-]\s*/i, ""))}</b><small>Tap to decide it on My Day</small></div></div>`).join("") || `<div class="item"><small>No requests waiting.</small></div>`}
<details class="fold"><summary><span class="cv"></span><b>Devices behind</b><small>of ${devList.length} seen in 14 d</small><span class="n">${behind.length}</span></summary>
${behind.map(v => `<div class="dev"><span class="nm">${esc(v.name || "Unknown")}</span><span class="sn">app opened ${ago(v.seen)}</span><em>v${v.build || "?"}</em></div>`).join("")}
<p class="note"><button class="btn" type="button">Show all ${devList.length}</button></p></details>
</div></div>

<h2>Automations · the Appliance Loads card, after</h2>
<div class="card"><div class="ct">Appliance Loads<small>nightly pull of appliance packages into the master sheet</small></div>
<div class="status" style="margin-top:8px"><span>Last pull <b>${esc(X.odPrevRun([[6, 58]], now).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b></span><span>· next ${esc(X.odNextRun ? "" : "")}${esc((function(){ const n = new Date(now); const t2 = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + (n.getUTCHours() * 60 + n.getUTCMinutes() >= 6 * 60 + 58 ? 1 : 0), 6, 58)); return t2.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }); })())}</span><span>· <b style="color:var(--ink)">N jobs · M items</b> on the sheet (live count when the tab loads)</span><button class="btn" type="button">Open sheet</button><button class="btn" type="button">Refresh</button></div>
<p class="note">The per-job table, the "When they run" list and the plans-filed chart are gone. The two appliance tiles (To check in Home Runs, Specs to confirm) stay and still open their lists.</p></div>
</div></body></html>`;
fs.writeFileSync(path.join(__dirname, "people.html"), html);
console.log("people:", d.people.length, "groups:", groups.map(g => `${g.label} ${g.n}`).join(" · "));
console.log("today:", t.today, "weekend:", t.weekend, "scheduled:", Object.keys(t.rows).length, "offTeam:", t.offTeam.join(","));
groups.forEach(g => g.rows.forEach(r => { const td = X.odTodayText(t.rows[r.name.trim().toLowerCase()]); if (td) console.log("  ", r.name, "→", td); }));
console.log("devices seen 14d:", devList.length, "current:", current, "behind:", behind.length);
