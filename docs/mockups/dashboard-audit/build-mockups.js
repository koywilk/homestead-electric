#!/usr/bin/env node
// Builds schedule.html and quality.html from a LIVE read-only pull (pull-readonly.js output dir) through the
// shipped dashboard model (scripts/odash-model-test.js sandbox) and the v581 helpers, so every row is real.
// Simpro's scheduled staff (the planner's overlay) is read through the deployed getSimproSchedule callable
// when the app key can be read from src/App.js; the key is never printed. Writes only the two HTML files.
// Run: node docs/mockups/dashboard-audit/build-mockups.js <pulldir>
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");
const { makeSandbox } = require(path.join(ROOT, "scripts", "odash-model-test.js"));
const X = makeSandbox();
const S = process.argv[2]; if (!S) { console.error("usage: build-mockups.js <pulldir>"); process.exit(1); }
const J = (f) => JSON.parse(fs.readFileSync(path.join(S, f), "utf8"));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shape = (raw) => ({ changeOrders: [], returnTrips: [], uploadedFiles: [], customLinks: [], roughMaterials: [], roughUpdates: [], finishMaterials: [], finishUpdates: [], commMaterials: [], homeRuns: {}, roughPunch: {}, finishPunch: {}, qcPunch: {}, roughQuestions: { upper: [], main: [], basement: [] }, finishQuestions: { upper: [], main: [], basement: [] }, ...raw });
const now = new Date();
const jobs = J("jobs.json").map(shape), users = (J("settings_users.json").list || []), needs = J("needs.json"), upcoming = J("settings_upcoming_jobs.json").items || [];
const pto = J("settings_crewPTO.json").list || [], weeksRaw = J("schedule_weeks.json");
const weeks = {}; Object.entries(weeksRaw).forEach(([k, v]) => { weeks[k] = v ? (v.assignments || {}) : null; });
const d = X.odModel({ jobs, users, needs, upcoming, now, range: 14, pto, simTotals: J("settings_simproTotals.json") });
const localYmd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const addDays = (x, n) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + n);
const short = (x) => `${x.getMonth() + 1}/${x.getDate()}`, dow = (x) => x.toLocaleDateString([], { weekday: "short" });
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function simproDays() {
  try {
    const app = fs.readFileSync(path.join(ROOT, "src", "App.js"), "utf8");
    const m = app.match(/const APP_CALL_KEY\s*=\s*"([^"]+)"/); if (!m) return { map: null, note: "app key not found" };
    const iso = (x) => localYmd(x);
    const res = await fetch("https://us-central1-homestead-electric.cloudfunctions.net/getSimproSchedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: { dateFrom: iso(addDays(d.t0, -7)), dateTo: iso(addDays(d.t0, 42)), _appKey: m[1] } }) });
    if (!res.ok) return { map: {}, note: `getSimproSchedule HTTP ${res.status}` };
    const body = await res.json();
    const entries = (body && body.result) || [];
    return { map: X.odSimproStaffByDay(entries), note: `${entries.length} Simpro schedule entries` };
  } catch (e) { return { map: {}, note: `Simpro schedule not read: ${e.message}` }; }
}

const CSS = `
:root{--page:#F7F4EE;--ink:#292119;--dim:#6B6157;--line:rgba(41,33,25,.1);--card:#fff;--a:#8E6336;--a-soft:rgba(142,99,54,.12);--red:#C43B3B;--green:#18804A;--orange:#B4531A;--blue:#2563C9;--purple:#6A4FC8;--warn:#B23A6E;--slate:#5B6B84;--grey:#6B7487}
*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
h1{font-size:22px;margin:0}.head p{margin:4px 0 0;color:var(--dim);font-size:13px}.note{font-size:12px;color:var(--dim);margin:8px 0 16px}
.minis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}
.mini{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 16px;border-top:4px solid var(--c)}.mini small{display:block;color:var(--dim);font-size:12px}.mini b{font-size:26px;display:block;margin:2px 0}
.row2{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;min-width:0}.ct{font-weight:700;font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ct small{font-weight:500;color:var(--dim);font-size:12px}
.week{display:grid;grid-template-columns:repeat(7,minmax(96px,1fr));gap:6px;margin-top:10px}.col{background:rgba(41,33,25,.035);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:120px}.col.today{background:var(--a-soft)}
.dh{font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--dim)}.dh span{font-weight:600;margin-left:3px}
.blk{border-radius:8px;padding:6px 8px;border-left:3px solid var(--c);background:color-mix(in srgb,var(--c) 15%,transparent)}.blk b{font-size:12px;display:block;line-height:1.3}.blk small{display:block;font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.blk small.bad{color:var(--red);font-weight:700}
.off{margin-top:auto;padding-top:5px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--dim)}.none{color:var(--dim);font-size:12px}
.rows{display:flex;flex-direction:column}.r{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line)}.r .k{width:28px;height:28px;border-radius:8px;background:color-mix(in srgb,var(--c) 15%,transparent)}.r .m b{display:block;font-size:13px}.r .m em{font-style:normal;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--a)}.r .m small{display:block;font-size:12px;color:var(--dim)}.r .t{font-size:11.5px;color:var(--dim);white-space:nowrap}.r.ink .m b,.r.ink .m small{color:var(--red)}.r .m em.red{color:var(--red)}.t.red{color:var(--red);font-weight:700}.t.green{color:var(--green);font-weight:700}
.divider{font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--a);padding:12px 0 2px;border-bottom:1px dashed var(--line)}
.fold{background:var(--card);border:1px solid var(--line);border-radius:18px;min-width:0}.fold.flat{background:transparent;border:0;border-top:1px dashed var(--line);border-radius:0;margin-top:6px}
.foldh{display:flex;align-items:center;gap:8px;padding:14px 16px;font-weight:700;cursor:pointer;flex-wrap:wrap}.fold.flat .foldh{padding:10px 0 6px}.foldh .n{font-weight:800;color:var(--a);background:var(--a-soft);border-radius:999px;padding:1px 9px;font-size:12.5px}.foldh small{font-weight:500;color:var(--dim);font-size:12px}.foldh small.tog{margin-left:auto;font-weight:700;color:var(--a)}
.foldb{padding:0 16px 16px;display:flex;flex-direction:column;gap:10px}.fold.flat .foldb{padding:0 0 6px}.fold:not(.open) .foldb{display:none}
.hb{display:grid;grid-template-columns:150px minmax(0,1fr) 40px;gap:10px;align-items:center;padding:6px 0;font-size:13px}.hb .bar{height:10px;border-radius:99px;background:rgba(41,33,25,.06);overflow:hidden}.hb .bar i{display:block;height:100%;background:var(--c)}
.board .b{display:grid;grid-template-columns:30px minmax(0,1fr) minmax(70px,34%) 44px;gap:10px;align-items:center;padding:9px 2px;border-bottom:1px solid var(--line)}.av{width:26px;height:26px;border-radius:50%;background:var(--a);color:#fff;display:grid;place-items:center;font-weight:800;font-size:12px}.av.g{background:var(--grey)}
.board .nm b{display:block;font-size:13px}.board .nm small{display:block;font-size:11.5px;color:var(--dim)}.board .bar{display:flex;height:8px;border-radius:99px;background:rgba(41,33,25,.06);overflow:hidden;gap:2px}.board .bar i{display:block;height:100%}.pct{font-size:13px;text-align:right}
.legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--dim)}.legend span{display:inline-flex;align-items:center;gap:5px}.legend span::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c)}
.empty{color:var(--dim);font-size:12.5px;padding:8px 2px}
@media (max-width:900px){.minis{grid-template-columns:repeat(2,minmax(0,1fr))}.row2{grid-template-columns:minmax(0,1fr)}}
`;
const page = (title, sub, body, note) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} mockup</title><style>${CSS}</style></head><body>
<div class="head"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="note">Mockup built ${esc(now.toLocaleString())} from a live read-only pull · ${esc(note)} · folded groups start closed; click a header to open it</div>
${body}<script>document.querySelectorAll(".foldh").forEach(h=>h.addEventListener("click",()=>{const f=h.parentElement;f.classList.toggle("open");h.querySelector(".tog").textContent=f.classList.contains("open")?"Hide":"Show";}));</script></body></html>`;
const row = (r) => `<div class="r${r.ink ? " ink" : ""}" style="--c:${r.color || "var(--a)"}"><span class="k"></span><span class="m"><b>${esc(r.title)}</b>${r.tag ? `<em class="${r.tagRed ? "red" : ""}">${esc(r.tag)}</em>` : ""}<small>${esc(r.sub || "")}</small></span><span class="t ${r.rightClass || ""}">${esc(r.right || "")}</span></div>`;
const rows = (list, empty) => list.length ? `<div class="rows">${list.map(r => r.divider ? `<div class="divider">${esc(r.divider)}</div>` : row(r)).join("")}</div>` : `<div class="empty">${esc(empty)}</div>`;
const fold = (title, count, sub, body, flat) => `<div class="fold${flat ? " flat" : ""}"><div class="foldh"><b>${esc(title)}</b><span class="n">${count}</span>${sub ? `<small>${esc(sub)}</small>` : ""}<small class="tog">Show</small></div><div class="foldb">${body}</div></div>`;
const hbars = (list, empty) => list.length ? list.map(r => `<div class="hb" style="--c:${r.color}"><span>${esc(r.name)}</span><span class="bar"><i style="width:${Math.round(100 * r.v / Math.max(1, ...list.map(x => x.v)))}%"></i></span><span>${r.v}</span></div>`).join("") : `<div class="empty">${esc(empty)}</div>`;
const SCHED_COLOR = { start: "var(--orange)", insp: "var(--green)", qc: "var(--blue)", scan: "var(--purple)", rt: "var(--red)" };

(async () => {
  const sim = await simproDays();
  const ahead = (n) => d.sched.filter(s => s.at >= d.t0 && s.at < addDays(d.t0, n));
  const next7 = ahead(7), next14 = ahead(14), next30 = ahead(30), starts14 = next14.filter(s => s.type === "start"), insp7 = next7.filter(s => s.type === "insp");
  const coverOf = new Map(X.odStartCoverage(d.sched.filter(s => s.type === "start"), weeks, sim.map).map(c => [c.s, c]));
  const cov = (s) => coverOf.get(s) || null;
  const days = []; for (let i = 0; i < 7; i++) { const dd = addDays(d.t0, i); days.push({ dd, items: d.sched.filter(s => localYmd(s.at) === localYmd(dd)) }); }
  const offByDay = X.odTimeOffByDay(pto, days.map(x => x.dd));
  const toCall = X.odInspToCall(d.active, d.secOf);
  const inspPh = (s) => /Final/.test(s.label) ? "Final" : "Rough";
  const fm = (s) => s.type === "start" ? (s.job ? (s.job.foreman || "No foreman") : "") : "";
  const base = (s) => ({ title: s.name, sub: [`${s.label}${s.type === "start" ? (s.confirmed ? " · confirmed" : " · projected") : ""}`, fm(s), s.detail].filter(Boolean).join(" · "), right: `${dow(s.at)} ${short(s.at)}`, color: SCHED_COLOR[s.type] });
  const startRow = (s) => { const c = cov(s), r = base(s); return c ? { ...r, sub: `${r.sub} · ${c.text}`, tag: c.none ? "Nobody assigned" : "", tagRed: c.none, ink: c.none } : r; };
  const inspRow = (s) => { const r = base(s), ic = s.job ? X.odInspCalled(s.job, inspPh(s)) : null; return ic ? { ...r, tag: ic.called ? "Called in" : "Not called in", tagRed: !ic.called } : r; };
  const scanRow = (j) => { const si = d.scanInfo[j.id]; return { title: j.name, sub: `${si.state} · ${j.foreman || "No foreman"}`, tag: si.booking, tagRed: !si.bookedAt && si.urgent, color: "var(--purple)" }; };
  const noCrew14 = starts14.filter(s => (cov(s) || {}).none).length;
  const covered = [...coverOf.values()].filter(c => c.s.at >= d.t0 && c.s.at < addDays(d.t0, 30));
  const types = [["start", "Starts"], ["insp", "Inspections"], ["qc", "QC walks"], ["scan", "Scans"], ["rt", "Return trips"]];
  const schedBody = `
<div class="minis">
 <div class="mini" style="--c:var(--orange)"><small>Starts, next 2 weeks</small><b>${starts14.length}</b><small>${starts14.filter(s => !s.confirmed).length} projected${noCrew14 ? ` · ${noCrew14} with nobody on the planner` : ""}</small></div>
 <div class="mini" style="--c:var(--green)"><small>Inspections, 7 days</small><b>${insp7.length}</b><small>called in${toCall.length ? ` · ${toCall.length} still to call in` : ""}</small></div>
 <div class="mini" style="--c:var(--red)"><small>Needs a date</small><b>${d.needsDate.length}</b><small>jobs</small></div>
 <div class="mini" style="--c:var(--warn)"><small>Past their date</small><b>${d.overdue.length}</b><small>oldest first</small></div>
</div>
<div class="card"><div class="ct">Next 7 days<small>crew per start from the Crew Planner (manual cells + Simpro staff) · called-in flag on inspections · time off under each day</small></div>
<div class="week">${days.map((x, i) => `<div class="col${i === 0 ? " today" : ""}"><div class="dh">${i === 0 ? "Today" : dow(x.dd)} <span>${short(x.dd)}</span></div>${x.items.map(s => { const c = cov(s), ic = s.type === "insp" && s.job ? X.odInspCalled(s.job, inspPh(s)) : null; return `<div class="blk" style="--c:${SCHED_COLOR[s.type]}"><b>${esc(s.name)}</b><small>${esc(s.label)}${s.type === "start" && !s.confirmed ? " · projected" : ""}${fm(s) ? ` · ${esc(first(fm(s)))}` : ""}</small>${c ? `<small class="${c.none ? "bad" : ""}">${esc(c.text)}</small>` : ""}${ic ? `<small class="${ic.called ? "" : "bad"}">${esc(ic.text)}</small>` : ""}</div>`; }).join("")}${!x.items.length ? `<div class="none">—</div>` : ""}${offByDay[i].text ? `<div class="off">${esc(offByDay[i].text)}</div>` : ""}</div>`).join("")}</div></div>
<div class="row2" style="margin-top:12px">
 <div class="card"><div class="ct">Next 30 days<small>tap a kind to list it</small></div>${hbars(types.map(([k, l]) => ({ name: l, v: next30.filter(s => s.type === k).length + (k === "scan" ? d.scans.length : 0), color: SCHED_COLOR[k] })), "Nothing dated.")}
  ${fold("Matterport scans due", d.scans.length, d.scans.length ? `${d.scans.filter(j => !d.scanInfo[j.id].bookedAt).length} not booked · ${d.scans.filter(j => d.scanInfo[j.id].urgent).length} urgent` : "none due", rows(d.scans.map(scanRow), "No scans due."), true)}</div>
 <div class="card"><div class="ct">Starts<small>next 14 days · foreman · who the Crew Planner has that day</small></div>${rows(starts14.map(startRow), "No starts dated in the next 14 days.")}</div>
</div>
<div class="row2">
 <div class="card"><div class="ct">Inspections in the next 7 days<small>the list the mini opens</small></div>${rows([...insp7.map(inspRow), ...(toCall.length ? [{ divider: `Not called in yet (${toCall.length})` }] : []), ...toCall.map(x => ({ title: x.job.name, sub: `${x.ph} inspection · ${x.ph === "Rough" ? "rough" : "finish"} ${x.pct}% · ${x.job.foreman || "No foreman"}`, tag: "Not called in", tagRed: true, color: "var(--red)" }))], "No inspections in the next 7 days.")}</div>
 <div class="card"><div class="ct">Coverage check<small>every start in the next 30 days</small></div>${rows(covered.map(c => ({ title: c.s.name, sub: `${c.s.label} · ${c.text}${c.manualN || c.simproN ? ` (${c.manualN} planner, ${c.simproN} Simpro)` : ""}`, right: `${dow(c.s.at)} ${short(c.s.at)}`, tag: c.state, tagRed: c.none, ink: c.none, color: SCHED_COLOR.start })), "No starts.")}</div>
</div>`;
  const planNote = Object.entries(weeks).map(([k, v]) => `${k}: ${v ? Object.keys(v).length + " cells" : "no doc"}`).join(", ");
  fs.writeFileSync(path.join(__dirname, "schedule.html"), page("Schedule", `Starts, inspections, QC walks, scans and return trips with a date · ${plural(next7.length, "item")} in the next 7 days`, schedBody, `planner weeks ${planNote} · ${sim.note}`));

  // Quality
  const fpf = X.odFirstPassByForeman(d.in90, d.roster, d.owns);
  const fpMax = Math.max(1, ...fpf.all.map(r => r.n));
  const fpRow = (r) => `<div class="b"><i class="av${r.name === "No foreman" ? " g" : ""}">${esc((r.name[0] || "?").toUpperCase())}</i><span class="nm"><b>${esc(r.name)}</b><small>${r.pass} of ${plural(r.n, "inspected job")} passed first time</small></span><span class="bar"><i style="width:${(r.pass / fpMax) * 100}%;background:var(--green)"></i><i style="width:${((r.n - r.pass) / fpMax) * 100}%;background:var(--red)"></i></span><b class="pct" style="color:${r.pct >= 90 ? "var(--green)" : r.pct >= 75 ? "var(--warn)" : "var(--red)"}">${r.pct}%</b></div>`;
  const rtCauses = X.odRtCauses(d.openRTs);
  const reinsp = X.odReinspByDate(d.failGroups, d.t0);
  const text = (h) => String(h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const rtRow = (x) => ({ title: x.job.name, sub: [text(x.rt.scope), x.rt.assignedTo].filter(Boolean).join(" · ") || "Return trip", tag: x.ri.k === "late" ? `${x.ri.late} d late · ${x.ri.text}` : x.ri.text, tagRed: x.ri.k === "late", color: "var(--red)" });
  const failRow = (g) => ({ title: g.job.name, tag: `${g.ph} · ${g.job.foreman || "No foreman"}${g.n > 1 ? ` · failed ${g.n} times` : ""}`, sub: g.items.length ? g.items.slice(0, 2).join(" · ") : g.noList ? `No correction list — ask ${g.job.foreman || "the foreman"}` : "No items listed", right: d.failStatus(g), color: "var(--red)" });
  const buckets = [["0–7 days", 0, 7, "var(--green)"], ["8–14 days", 8, 14, "var(--slate)"], ["15–30 days", 15, 30, "var(--orange)"], ["Over 30 days", 31, 1e9, "var(--red)"]].map(([l, a, b, c]) => ({ name: l, color: c, v: d.openPunch.filter(p => p.age != null && p.age >= a && p.age <= b).length }));
  const fRows = Object.entries(d.byForeman).map(([n, v]) => ({ n, ...v })).filter(r => r.open || r.closed).sort((a, b) => b.open - a.open);
  const nearFinal = d.active.filter(j => { const s = d.secOf(j); return s && ["finish", "finishDue", "finishHold"].includes(s.key) && d.info[j.id].punch.length; }).map(j => ({ j, n: d.info[j.id].punch.length, oldest: Math.max(0, ...d.info[j.id].punch.map(p => p.age || 0)) })).sort((a, b) => b.oldest - a.oldest);
  const nearN = nearFinal.reduce((n, x) => n + x.n, 0), over30 = buckets[3].v, serious = d.openPunch.filter(p => p.serious).length;
  const qualBody = `
<div class="minis">
 <div class="mini" style="--c:${d.fp90 == null || d.fp90 >= 90 ? "var(--green)" : d.fp90 >= 75 ? "var(--warn)" : "var(--red)"}"><small>First-pass, 90 days</small><b>${d.fp90 == null ? "—" : d.fp90 + "%"}</b><small>${d.in90.length ? `${d.in90.filter(f => !f.pass).length} of ${d.in90.length} failed first time` : "none logged"}</small></div>
 <div class="mini" style="--c:var(--orange)"><small>Open punch items</small><b>${d.openPunch.length}</b><small>${over30} over 30 days</small></div>
 <div class="mini" style="--c:var(--red)"><small>Open return trips</small><b>${d.rtSum.open}</b><small>${d.rtSum.late} past date · ${d.rtSum.booked} booked</small></div>
 <div class="mini" style="--c:var(--blue)"><small>QC walks open</small><b>${d.qcRows.length}</b><small>${d.qcRows.filter(r => r.st === "scheduled").length} scheduled</small></div>
</div>
<div class="row2">
 <div class="card"><div class="ct">Inspections next 7 days<small>kept · QC walk coverage</small></div>${rows(insp7.map(s => ({ ...base(s), tag: ["pass", "fixed", "completed"].includes((/Final/.test(s.label) ? s.job.finishQcStatus : s.job.qcStatus) || "") ? "QC walked" : "No QC walk logged", color: "var(--green)" })), "No inspections booked in the next 7 days.")}</div>
 <div class="card"><div class="ct">Failed inspections<small>kept · ${d.notRebooked.length} not re-booked</small></div>${rows(d.failOpenG.slice(0, 8).map(failRow), "No failed inspections waiting on a re-inspection.")}</div>
</div>
<div class="row2">
 <div class="card"><div class="ct">First-pass inspections<small>kept · by month</small></div>${hbars(d.months.map(m => ({ name: `${m.label} (${m.pass} of ${m.n})`, v: m.v || 0, color: "var(--green)" })), "No inspection results logged in the last 6 months.")}</div>
 ${fold("First-pass by foreman", fpf.shown.length, `last 90 days · a job counts for its foreman and its lead · ${fpf.few.length ? `${fpf.few.length} with fewer than ${fpf.min} inspected jobs` : "tap a name"}`, `<div class="board">${fpf.shown.map(fpRow).join("") || `<div class="empty">Nobody has ${fpf.min} inspected jobs in the last 90 days.</div>`}</div>${fpf.few.length ? fold(`Fewer than ${fpf.min} inspected jobs`, fpf.few.length, "too few to read as a rate", `<div class="board">${fpf.few.map(fpRow).join("")}</div>`, true) : ""}`)}
</div>
<div class="row2">
 ${fold("Return-trip causes", d.openRTs.length, rtCauses.length ? rtCauses.map(g => `${g.label} ${g.items.length}`).join(" · ") : "no open return trips", hbars(rtCauses.map(g => ({ name: g.label, v: g.items.length, color: g.k === "none" ? "var(--grey)" : g.k === "hand" ? "var(--slate)" : "var(--red)" })), "No open return trips.") + rtCauses.map(g => `<div class="divider">${esc(g.label)} (${g.items.length})</div>${rows(g.items.map(rtRow), "")}`).join(""))}
 ${fold("Re-inspection booked", reinsp.list.length, reinsp.list.length ? `${reinsp.late ? `${reinsp.late} past the date · ` : ""}soonest first` : "no failed inspection has a re-inspection date", rows(reinsp.days.flatMap(dd => [{ divider: `${dow(dd.at)} ${short(dd.at)} (${dd.items.length})` }, ...dd.items.map(x => ({ ...failRow(x.g), right: x.late ? `${x.late} d past` : `${dow(x.at)} ${short(x.at)}`, rightClass: x.late ? "red" : "green" }))]), "No re-inspection booked."))}
</div>
${fold("Punch", d.openPunch.length, `open · ${over30} over 30 days${serious ? ` · ${serious} serious` : ""} · ${nearN} on ${plural(nearFinal.length, "job")} near final · by age, by foreman, near final`, `
 <div class="row2"><div><div class="ct">Open punch by age</div>${hbars(buckets, "No open punch.")}</div>
 <div><div class="ct">Punch on jobs near final<small>${nearN ? `${nearN} items on ${plural(nearFinal.length, "job")} · oldest first` : ""}</small></div>${rows(nearFinal.slice(0, 8).map(x => ({ title: x.j.name, sub: `${x.j.foreman || "No foreman"} · ${d.secOf(x.j).label}`, right: `${x.n} · ${x.oldest} d`, color: "var(--orange)" })), "No open punch on jobs in finish.")}</div></div>
 <div class="ct">Punch by foreman<small>open now · closed in 30 days · jobs</small></div><div class="board">${fRows.map(r => `<div class="b" style="grid-template-columns:30px minmax(0,1fr) minmax(80px,40%)"><i class="av${r.n === "No foreman" ? " g" : ""}">${esc(r.n[0].toUpperCase())}</i><span class="nm"><b>${esc(r.n)}</b><small>${r.open} open · ${r.closed} closed · ${plural(r.jobs, "job")}</small></span><span class="bar"><i style="width:${(r.closed / Math.max(1, ...fRows.map(x => x.open + x.closed))) * 100}%;background:var(--green)"></i><i style="width:${(r.open / Math.max(1, ...fRows.map(x => x.open + x.closed))) * 100}%;background:var(--orange)"></i></span></div>`).join("") || `<div class="empty">No punch items on active jobs.</div>`}</div>`)}`;
  fs.writeFileSync(path.join(__dirname, "quality.html"), page("Quality", "Inspections, punch and return trips · first-pass counts each job's first inspection of a phase", qualBody, `${d.active.length} active jobs · ${d.in90.length} first inspections in 90 days · ${d.openRTs.length} open return trips`));
  console.log("schedule:", { next7: next7.length, starts14: starts14.length, noCrew14, insp7: insp7.length, toCall: toCall.length, scans: d.scans.length, offDays: offByDay.filter(x => x.text).map(x => `${x.k} ${x.text}`), sim: sim.note, coverage: covered.map(c => `${c.s.name}@${short(c.s.at)}:${c.state}${c.names.length ? "(" + c.names.map(first).join(",") + ")" : ""}`) });
  console.log("quality:", { fpShown: fpf.shown.map(r => `${r.name} ${r.pass}/${r.n} ${r.pct}%`), fpFew: fpf.few.map(r => `${r.name} ${r.pass}/${r.n}`), causes: rtCauses.map(g => `${g.label} ${g.items.length}`), reinsp: reinsp.list.map(x => `${x.g.job.name} ${x.k}${x.late ? " late " + x.late : ""}`), punch: d.openPunch.length, over30, nearN });
})().catch(e => { console.error("ERR", e.stack || e.message); process.exit(1); });
