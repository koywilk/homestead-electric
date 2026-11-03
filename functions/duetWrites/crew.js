"use strict";
// Duet write access (D9), ship 5: the weekly Crew Planner and a job's people.
// PURE planners — given the request, the live docs and what the server knows
// (clock, team list, teams, PTO), they return either a refusal or exactly
// what to write, copying the planner's own mutators line for line
// (src/App.js SchedulingForecast: assignPerson, unassignPerson, assignTeam,
// crewToggleLead) and the job page's foreman / lead / coordinator selects.
// No Firestore here: api.js does the transaction, scripts/duet-crew-test.js
// drives these with fixtures.
//
// The week doc: settings/schedule_<Monday YYYY-MM-DD> =
//   { assignments: { "<jobId>_<dayIdx 0..4>": { lead:"Name", crew:["Name"], time? } },
//     extraJobs, jobOrder, pinnedJobs, focus, hoursByJob, needsBodies, updatedAt, tab, merged }
// Duet touches ONE cell of `assignments` per call and nothing else on the doc.
const { resolvePerson } = require("./needs.js");

const refuse = (why) => ({ refused: why });
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const PEOPLE_FIELDS = ["foreman", "lead", "coordinator"];
const UNASSIGNED = "Unassigned";

// The planner's own name compare (fmEq): case-insensitive, nothing else.
const fmEq = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// ── Dates ────────────────────────────────────────────────────────────────────
// A calendar date's weekday does not depend on a time zone, so the Monday math
// runs on the YYYY-MM-DD string alone; "today" (when no date is given) is the
// server's Mountain-time date (io.todayYmd), never its UTC clock.
function dayOfWeek(ymd) {                       // 0 = Sunday … 6 = Saturday
  const m = YMD.exec(String(ymd || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));
  if (isNaN(d) || d.toISOString().slice(0, 10) !== ymd) return null;
  return d.getUTCDay();
}
function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// The server's "today" in Mountain time for a given instant (what io.todayYmd does).
function todayYmdFor(iso, tz) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz || "America/Denver" });
}
// A date → { monday, dayIdx 0..4, label } or a refusal on a weekend / bad date.
// crewMon in the app: Monday of the week, Sunday counts as the END of its week.
function weekFor(ymd) {
  const dow = dayOfWeek(ymd);
  if (dow == null) return refuse("date must be YYYY-MM-DD.");
  if (dow === 0 || dow === 6) return refuse(`${ymd} is a ${dow === 0 ? "Sunday" : "Saturday"} — the Crew Planner runs Monday to Friday. Nothing was written.`);
  const monday = addDays(ymd, -(dow - 1));
  return { monday, dayIdx: dow - 1, label: DAY_LABELS[dow - 1], docId: "schedule_" + monday };
}
const cellKey = (jobId, dayIdx) => `${jobId}_${dayIdx}`;

// ── People ───────────────────────────────────────────────────────────────────
// The planner's isForeman: the team list's foremen (title "foreman"; the Crew
// Board's legacy fallback reads role when title is unset). Active only.
function isForeman(name, users) {
  return (users || []).some(u => u && u.name && u.active !== false && fmEq(u.name, name) && (u.title || u.role) === "foreman");
}
// The planner's isOnPTO (settings/crewPTO.list): name match, both ends inclusive,
// start/end as YYYY-MM-DD or M/D/YYYY (parseAnyDate).
function ptoYmd(s) {
  const t = String(s || "").trim();
  if (YMD.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  return null;
}
function onPTO(name, ymd, ptoList) {
  return (ptoList || []).find(p => {
    if (!p || !fmEq(p.name, name)) return false;
    const s = ptoYmd(p.start), e = ptoYmd(p.end || p.start) || s;
    return !!s && ymd >= s && ymd <= e;
  }) || null;
}

// ── The planner's mutators, cell-local ───────────────────────────────────────
// assignPerson: already there → no-op; a foreman into a cell with no lead → lead;
// otherwise onto crew. The rest of the cell (time) is carried.
function assignPersonCell(cur, person, foreman) {
  const cell = cur || { lead: "", crew: [] };
  if (fmEq(cell.lead, person) || (cell.crew || []).some(p => fmEq(p, person))) return { noop: true, cell };
  if (!cell.lead && foreman) return { cell: { ...cell, lead: person } };
  return { cell: { ...cell, crew: [...(cell.crew || []), person] } };
}
// unassignPerson: lead cleared when it was them, crew filtered; an empty cell is
// deleted. (The app rebuilds the cell as {lead, crew} — `time` is not carried.)
function unassignPersonCell(cur, person) {
  if (!cur) return { noop: true, cell: null };
  const was = fmEq(cur.lead, person) || (cur.crew || []).some(p => fmEq(p, person));
  if (!was) return { noop: true, cell: cur };
  const u = { lead: fmEq(cur.lead, person) ? "" : cur.lead, crew: (cur.crew || []).filter(p => !fmEq(p, person)) };
  if (!u.lead && (!u.crew || !u.crew.length)) return { cell: null, deleted: true };
  return { cell: u };
}
// crewToggleLead, the "make lead" half: the person comes off crew, the old lead
// (if any) drops onto crew. Already lead → no-op. (The app compares with ===;
// names in a cell come from the team list, so case matches.)
function setLeadCell(cur, name) {
  const cell = cur || { lead: "", crew: [] };
  if (cell.lead === name) return { noop: true, cell };
  const nc = (cell.crew || []).filter(n => n !== name);
  if (cell.lead) nc.push(cell.lead);
  return { cell: { ...cell, lead: name, crew: nc } };
}
// assignTeam: every team member not on PTO that day, in order lead → members,
// each by assignPerson's rule against the growing cell.
function assignTeamCell(cur, names, isForemanFn) {
  const base = { ...(cur || { lead: "", crew: [] }) };
  let lead = base.lead || "", crew = [...(base.crew || [])];
  const added = [];
  names.forEach(n => {
    if (fmEq(lead, n) || crew.some(p => fmEq(p, n))) return;
    if (!lead && isForemanFn(n)) lead = n; else crew.push(n);
    added.push(n);
  });
  if (!added.length) return { noop: true, cell: cur };
  return { cell: { ...base, lead, crew }, added };
}

// ── Teams (settings/crewTeams, read only) ────────────────────────────────────
// "Keegan's crew" → the team whose lead is Keegan (or that has Keegan on it,
// when he leads none); a team id works too.
function findTeam(teams, want, users) {
  const list = (teams || []).filter(t => t && (t.lead || (Array.isArray(t.members) && t.members.length)));
  if (!list.length) return refuse("There are no crew teams set up in the Crew Planner yet. Assign people one at a time.");
  const w = String(want || "").trim();
  if (!w) return refuse("Say whose team: a team lead's name (e.g. \"Keegan's crew\").");
  const byId = list.find(t => String(t.id) === w);
  if (byId) return { team: byId };
  const who = resolvePerson(w.replace(/['’]s\s+(crew|team)$/i, "").trim(), users);
  if (who.refused) return who;
  const leads = list.filter(t => fmEq(t.lead, who.name));
  if (leads.length === 1) return { team: leads[0] };
  if (leads.length > 1) return refuse(`${who.name} leads more than one team in the Crew Planner — say which by its members.`);
  const on = list.filter(t => (t.members || []).some(m => fmEq(m, who.name)));
  if (on.length === 1) return { team: on[0] };
  if (on.length > 1) return refuse(`${who.name} is on more than one team — say the team lead's name.`);
  return refuse(`${who.name} isn't on any crew team in the Crew Planner. Nothing was written.`);
}
const teamMembers = (t) => [...(t.lead ? [t.lead] : []), ...((t && t.members) || [])];

// ── The plan ─────────────────────────────────────────────────────────────────
// args: { jobId, date (YYYY-MM-DD, default today), person? | team?, op: assign|unassign|setLead }
// ctx:  { todayYmd, users, job (live, may be null), week (the live week doc data or null), teams (crewTeams.teams), pto (crewPTO.list) }
// Returns {refused} | {noop, …} | { docId, key, cell|null (null = delete the cell), before, after, people, … }
function planCrewCell(args, ctx) {
  const a = args || {};
  const op = String(a.op || "");
  if (!["assign", "unassign", "setLead"].includes(op)) return refuse("op must be assign, unassign or setLead.");
  if (!ctx.job || !ctx.job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (ctx.job.data.archived || ctx.job.data.deleted) return refuse(`${ctx.job.data.name || "That job"} is archived — the Crew Planner is for live jobs. Nothing was written.`);
  const wk = weekFor(a.date == null || a.date === "" ? ctx.todayYmd : a.date);
  if (wk.refused) return wk;
  const key = cellKey(ctx.job.id, wk.dayIdx);
  const assignments = (ctx.week && ctx.week.assignments && typeof ctx.week.assignments === "object") ? ctx.week.assignments : {};
  const cur = assignments[key] && typeof assignments[key] === "object" ? assignments[key] : null;
  const base = { docId: wk.docId, monday: wk.monday, dayIdx: wk.dayIdx, day: wk.label, date: a.date == null || a.date === "" ? ctx.todayYmd : a.date, key, before: cur, newDoc: !ctx.week };
  const dayYmd = base.date;

  if (a.team != null && a.team !== "") {
    if (op !== "assign") return refuse("A whole team can only be assigned (op assign). Take people off one at a time.");
    const t = findTeam(ctx.teams, a.team, ctx.users);
    if (t.refused) return t;
    const all = teamMembers(t.team);
    const names = [], off = [];
    for (const n of all) {
      const who = resolvePerson(n, ctx.users);
      if (who.refused) continue;                 // a name no longer on the active list is skipped, as the planner skips it
      if (onPTO(who.name, dayYmd, ctx.pto)) { off.push(who.name); continue; }
      names.push(who.name);
    }
    if (!names.length) return refuse(`Everyone on ${t.team.lead ? t.team.lead + "'s" : "that"} team is off ${wk.label} ${dayYmd}${all.length && !off.length ? " (or no longer on the active team list)" : ""}. Nothing was written.`);
    const r = assignTeamCell(cur, names, (n) => isForeman(n, ctx.users));
    if (r.noop) return { noop: true, ...base, team: t.team.id || "", people: names, result: { message: "Everyone on that team is already on that cell." } };
    return { ...base, cell: r.cell, after: r.cell, team: t.team.id || "", people: r.added, skippedOff: off, op };
  }

  const who = resolvePerson(a.person, ctx.users);
  if (who.refused) return who;
  if (!who.name) return refuse("Say who: a team member's name (or a team).");
  if (op === "assign") {
    const pto = onPTO(who.name, dayYmd, ctx.pto);
    if (pto) return refuse(`${who.name} is off ${wk.label} ${dayYmd} (time off${pto.note ? ": " + String(pto.note).slice(0, 80) : ""}). Nothing was written.`);
    const r = assignPersonCell(cur, who.name, isForeman(who.name, ctx.users));
    if (r.noop) return { noop: true, ...base, people: [who.name], result: { message: `${who.name} is already on that cell.` } };
    return { ...base, cell: r.cell, after: r.cell, people: [who.name], role: r.cell.lead === who.name ? "lead" : "crew", op };
  }
  if (op === "unassign") {
    const r = unassignPersonCell(cur, who.name);
    if (r.noop) return { noop: true, ...base, people: [who.name], result: { message: `${who.name} isn't on that cell.` } };
    return { ...base, cell: r.cell, after: r.cell, deleted: !!r.deleted, people: [who.name], op };
  }
  // setLead
  if (!cur || !(fmEq(cur.lead, who.name) || (cur.crew || []).some(p => fmEq(p, who.name)))) return refuse(`${who.name} isn't on ${ctx.job.data.name || "that job"} ${wk.label} ${dayYmd} — assign first, then make lead. Nothing was written.`);
  const r = setLeadCell(cur, who.name);
  if (r.noop) return { noop: true, ...base, people: [who.name], result: { message: `${who.name} is already the lead on that cell.` } };
  return { ...base, cell: r.cell, after: r.cell, people: [who.name], role: "lead", previousLead: cur.lead || "", op };
}

// ── Job people: foreman / lead / coordinator, ONE per call ───────────────────
// The job page's selects: foreman from the foremen list + "Unassigned";
// lead from foremen + leads or "" (none); coordinator a person or "" (the
// foreman's book). Each is one scalar through saveJob — here the ONE dotted
// data.<field> with the job envelope (api.jobWrite).
function planSetPeople(args, ctx) {
  const a = args || {};
  if (!ctx.job || !ctx.job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (ctx.job.data.archived || ctx.job.data.deleted) return refuse(`${ctx.job.data.name || "That job"} is archived — changes go on live jobs only. Nothing was written.`);
  const given = PEOPLE_FIELDS.filter(k => a[k] !== undefined);
  if (given.length !== 1) return refuse("Set exactly ONE of foreman, lead or coordinator per call.");
  const field = given[0];
  const raw = String(a[field] == null ? "" : a[field]).trim();
  let name;
  if (field === "foreman") {
    if (!raw || fmEq(raw, UNASSIGNED)) name = UNASSIGNED;          // the app's own sentinel
    else {
      const who = resolvePerson(raw, ctx.users); if (who.refused) return who;
      if (!isForeman(who.name, ctx.users)) return refuse(`${who.name} isn't a foreman on the team list — the foreman select only offers foremen. Nothing was written.`);
      name = who.name;
    }
  } else {
    if (!raw || fmEq(raw, "none") || fmEq(raw, UNASSIGNED)) name = "";
    else { const who = resolvePerson(raw, ctx.users); if (who.refused) return who; name = who.name; }
  }
  const prev = ctx.job.data[field] == null ? "" : String(ctx.job.data[field]);
  if (prev === name) return { noop: true, field, name };
  return { fields: { [field]: name }, before: { [field]: prev }, after: { [field]: name }, field, from: prev, to: name,
    pushTo: field === "foreman" ? (name !== UNASSIGNED ? [name] : []) : field === "lead" ? (name ? [name] : []) : [] };
}

module.exports = { DAY_LABELS, PEOPLE_FIELDS, UNASSIGNED, fmEq, dayOfWeek, addDays, todayYmdFor, weekFor, cellKey, isForeman, ptoYmd, onPTO,
  assignPersonCell, unassignPersonCell, setLeadCell, assignTeamCell, findTeam, teamMembers, planCrewCell, planSetPeople };
