#!/usr/bin/env node
// render-readonly.js — builds jobs.html and activity.html in this folder from a LIVE read-only pull
// (pull-readonly.js) through the SHIPPED dashboard helpers (odash-model-test's sandbox), so every
// row is a real job as the dashboard would show it. Writes only the two HTML files beside it.
// Run: node docs/mockups/dashboard-audit/render-readonly.js <live.json>
const fs = require("fs"), path = require("path");
const { makeSandbox } = require(path.join(__dirname, "..", "..", "..", "scripts", "odash-model-test.js"));
const live = require(path.resolve(process.argv[2]));
const X = makeSandbox();
const now = new Date();
const d = X.odModel({ jobs: live.jobs, users: live.users, needs: live.needs, upcoming: live.upcoming, simTotals: live.simTotals, pto: live.pto, now });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (at) => `${at.getMonth() + 1}/${at.getDate()}`;
const ago = (at) => { const dd = Math.round((now - at) / 864e5); return dd <= 0 ? "today" : dd === 1 ? "1 d ago" : `${dd} d ago`; };
const CSS = `
:root{--page:#F7F4EE;--card:#FFFFFF;--ink:#292119;--dim:#6B5F52;--line:#E7E0D4;--inset:#F2EDE4;--a:#8E6336;--r:#C43B3B;--o:#B4531A;--g:#18804A;--grey:#6B7487;--cyan:#127A90;--slate:#5B6B84}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:13px/1.4 -apple-system,Inter,Segoe UI,Helvetica,Arial,sans-serif;padding:24px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--dim);margin:0 0 14px}.note{background:var(--inset);border-radius:10px;padding:10px 14px;margin:0 0 14px;color:var(--dim);font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:14px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.chips span{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;background:var(--card)}.chips span i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:6px}
.tbl{min-width:900px}.tr{display:grid;grid-template-columns:minmax(180px,2fr) 1fr 1.2fr .9fr 1.1fr 56px 1.1fr 1fr;gap:8px;align-items:center;padding:9px 4px;border-bottom:1px solid var(--line);font-size:12.5px}
.hd{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}.hd .on{color:var(--a)}
.c{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.c small{display:block;color:var(--dim);font-size:11.5px}.c b{display:block;overflow:hidden;text-overflow:ellipsis}
.pill{display:inline-block;font-style:normal;font-weight:700;font-size:11.5px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--c) 14%,white);color:var(--c)}
.grp{background:var(--inset);border-radius:10px;border-bottom:0;margin:6px 0 2px;font-weight:700}.grp small{font-weight:400}
.num{font-weight:700;font-variant-numeric:tabular-nums}.wait b{color:var(--r)}.wait.us b{color:var(--ink)}.wait.insp b{color:var(--o)}
.sec{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:14px 0 6px}
.minis{display:grid;grid-template-columns:repeat(2,minmax(200px,280px));gap:10px;margin-bottom:14px}.mini{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}.mini .t{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}.mini .v{font-size:28px;font-weight:800;margin-top:4px}.mini .v small{display:block;font-size:12px;font-weight:400;color:var(--dim)}
.fold{width:100%;text-align:left;background:var(--inset);border:0;border-radius:10px;padding:10px 12px;font:inherit;font-weight:700;color:var(--ink);display:flex;justify-content:space-between;margin:6px 0 2px;cursor:pointer}.fold small{font-weight:400;color:var(--dim)}.fold .cnt{background:var(--a);color:#fff;border-radius:999px;padding:1px 9px;font-size:12px}
.rows{padding:2px 4px}.row{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--line)}.row .k{width:28px;height:28px;border-radius:8px;background:color-mix(in srgb,var(--c) 16%,white);color:var(--c);display:grid;place-items:center;font-weight:800;font-size:12px}.row .m b{display:block}.row .m small{color:var(--dim)}.row .m em{font-style:normal;font-weight:800;font-size:11px;margin-left:6px;color:var(--r)}.row .t{color:var(--dim);font-size:12px;white-space:nowrap}
details{margin:4px 0}summary{list-style:none}summary::-webkit-details-marker{display:none}
`;
// ── Jobs ──
const waitOf = {}; d.active.forEach(j => { waitOf[j.id] = X.odJobWaiting(j, { users: live.users, needs: live.needs, now }); });
const daysOf = {}; d.active.forEach(j => { daysOf[j.id] = X.odDaysInStage(j, d.secOf(j), now); });
const sorted = d.active.slice().sort((a, b) => ((daysOf[b.id] ? daysOf[b.id].days : -1) - (daysOf[a.id] ? daysOf[a.id].days : -1)));
const row = (j) => { const s = d.secOf(j), w = waitOf[j.id], ds = daysOf[j.id], co = d.info[j.id].openCos.length, nx = d.nextOf[j.id], la = d.lastAct[j.id];
  return `<div class="tr"><span class="c"><b>${esc(j.name)}</b><small>${esc([j.simproNo && "#" + j.simproNo, j.address].filter(Boolean).join(" · "))}</small></span>
  <span class="c">${esc(j.foreman || "—")}${j.lead && j.lead !== j.foreman ? `<small>lead ${esc(j.lead.split(" ")[0])}</small>` : ""}</span>
  <span class="c"><em class="pill" style="--c:${s ? s.color : "#6B7487"}">${esc(s ? s.label : "—")}</em>${s && s.note ? `<small>${esc(s.note)}</small>` : ""}</span>
  <span class="c num">${ds ? `${ds.days} d<small>${esc(ds.src)} ${short(ds.at)}</small>` : "—"}</span>
  <span class="c wait ${w.length ? w[0].k : ""}">${w.length ? `<b>${w.map(x => X.OD_WAIT_LABEL[x.k]).join(" · ")}</b><small>${esc(w[0].detail)}</small>` : "—"}</span>
  <span class="c num">${co || "—"}</span>
  <span class="c">${nx ? `${short(nx.at)} <small>${esc(nx.label)}</small>` : "—"}</span>
  <span class="c">${la ? ago(la) : "—"}</span></div>`; };
const hdr = `<div class="tr hd"><span>Job</span><span>Foreman · Lead</span><span>Where it is</span><span class="on">Days in stage ↓</span><span>Waiting on</span><span>COs</span><span>Next date</span><span>Last work</span></div>`;
const groups = d.crewGroups.filter(g => g.jobs.length).slice().sort((a, b) => b.jobs.length - a.jobs.length);
const waitN = (arr) => arr.filter(j => waitOf[j.id].length).length;
const grpRows = groups.map(g => `<details open><summary><div class="tr grp"><span class="c"><b>${esc(g.crew.label)}</b></span><span class="c">${g.jobs.length} jobs</span><span></span><span></span><span class="c">${waitN(g.jobs) ? waitN(g.jobs) + " waiting" : "—"}</span><span></span><span></span><span class="c">Hide</span></div></summary>${g.jobs.slice().sort((a, b) => ((daysOf[b.id] ? daysOf[b.id].days : -1) - (daysOf[a.id] ? daysOf[a.id].days : -1))).map(row).join("")}</details>`).join("")
  + (d.noCrewJobs.length ? `<details open><summary><div class="tr grp"><span class="c"><b>No crew</b></span><span class="c">${d.noCrewJobs.length} jobs</span><span></span><span></span><span class="c">${waitN(d.noCrewJobs) ? waitN(d.noCrewJobs) + " waiting" : "—"}</span><span></span><span></span><span class="c">Hide</span></div></summary>${d.noCrewJobs.map(row).join("")}</details>` : "");
const counts = { gc: 0, insp: 0, us: 0, none: 0 }; d.active.forEach(j => { const w = waitOf[j.id]; if (!w.length) counts.none++; w.forEach(x => counts[x.k]++); });
const dated = d.active.filter(j => daysOf[j.id]).length;
const jobsHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Jobs tab mockup (v580, live data)</title><style>${CSS}</style></head><body>
<h1>Jobs</h1><p class="sub">${d.active.length} active jobs · tap a column to sort, a row to open the job · mockup from a live read-only pull ${esc(live.pulledAt.slice(0, 16).replace("T", " "))}</p>
<div class="note">Audit v580: the <b>Punch</b> column and the right-rail <b>Where the work is</b> bars are gone. Two new sortable columns: <b>Days in stage</b> (from the date the job records for entering it; blank where it records none: ${dated} of ${d.active.length} jobs have one) and <b>Waiting on</b> (GC ${counts.gc} · Inspection ${counts.insp} · Us ${counts.us} · nothing waiting ${counts.none}). Crew folds start closed in the app; opened here so every row shows.</div>
<div class="chips">${d.bySec.map(s => `<span style="--c:${s.color}"><i></i>${esc(s.label)} ${s.jobs.length}</span>`).join("")}</div>
<div class="card"><div class="tbl">${hdr}${grpRows}</div></div>
<div class="sec">Flat, sorted by days in stage (what the sort button gives)</div><div class="card"><div class="tbl">${hdr}${sorted.map(row).join("")}</div></div>
</body></html>`;
fs.writeFileSync(path.join(__dirname, "jobs.html"), jobsHtml);
// ── Activity ──
const sp = X.odSplitQuestions(d.active, live.users, now);
const qrow = (q) => `<div class="row" style="--c:${q.old ? "var(--r)" : "var(--o)"}"><span class="k">?</span><span class="m"><b>${esc(q.job.name)}${q.old ? `<em>${q.age} d old</em>` : ""}</b><small>${esc(q.ph)}: ${esc(q.text)}${q.who ? " · asked by " + esc(q.who.split(" ")[0]) : ""}${q.to ? " · out to " + esc(q.to) : ""}</small></span><span class="t">${q.at ? short(q.at) : "no date"}</span></div>`;
const fold = (title, sub, list) => `<details><summary><div class="fold"><span>${title} <small>${esc(sub)}</small></span><span class="cnt">${list.length}</span></div></summary><div class="rows">${list.length ? list.map(qrow).join("") : `<div class="row"><span></span><span class="m"><small>Nothing waiting.</small></span></div>`}</div></details>`;
const failed = d.fails.filter(f => now - f._at < 14 * 864e5).length, logged = d.insp30.filter(a => now - a._at < 14 * 864e5).length;
const actHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Activity tab mockup (v580, live data)</title><style>${CSS}</style></head><body>
<h1>Activity</h1><p class="sub">Everything logged in the last 14 days · tap a row for the job · mockup from a live read-only pull ${esc(live.pulledAt.slice(0, 16).replace("T", " "))}</p>
<div class="note">Audit v580: the <b>Everything logged</b> and <b>Punch closed</b> cards, the right-rail <b>What kind</b> bars and <b>Most active jobs</b> list are gone. Open questions now split into two folded groups (closed in the app; open them here), oldest first, older than 2 days flagged red. ${sp.mine.length} on the office · ${sp.others.length} out to the GC or a foreman · ${sp.old} older than 2 days.</div>
<div class="minis"><div class="mini"><div class="t">Open questions</div><div class="v">${sp.mine.length + sp.others.length}<small>${sp.mine.length} on me · ${sp.others.length} on others</small></div></div><div class="mini"><div class="t">Failed inspections</div><div class="v">${failed}<small>failed of ${logged} logged</small></div></div></div>
<div class="card"><div class="sec" style="margin-top:0">Open questions</div>${fold("Waiting on me", "the office owes an answer", sp.mine)}${fold("Waiting on others", "out to the GC or a foreman", sp.others)}</div>
<div class="card"><div class="sec" style="margin-top:0">Recent activity</div><p class="sub" style="margin:0">Unchanged: the day groups, type chips, search and "Done by" person filter stay as they are (${d.inRange.length} rows in range).</p></div>
</body></html>`;
fs.writeFileSync(path.join(__dirname, "activity.html"), actHtml);
console.log("active", d.active.length, "dated", dated, "waiting", JSON.stringify(counts), "questions mine/others/old", sp.mine.length, sp.others.length, sp.old);
console.log("sides:", sp.others.map(q => `${q.job.name.slice(0, 14)}→${q.to}(${q.why})`).join(" | "));
