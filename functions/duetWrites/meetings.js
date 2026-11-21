"use strict";
// meetings.js — Claude adds ONE item to a dashboard meeting (SW v676, Koy
// 2026-11-20, "Build it"; plan: app-building/meeting-items-plan.md). Pure: no
// Firebase import. api.js reads the meeting doc (and the job, when one is
// named) in ONE transaction, asks planAdd() what to write, writes it with a
// merge set (next week's record may not exist yet) and audits it in the same
// transaction; undo.js takes the one key back off while it still reads what
// this call left.
//
// Where an item can go (the sections the app itself keeps per week — the
// dashboard's isTyped(), src/App.js; every other add on the Lead / Foreman page
// sticks to every week through <kind>__prefs, which is not "add to next week"):
//   lead      Notes, Highlight, Lowlight, Training (added.<id>), Action items (actions.<id>)
//   foreman   Team check (added.<id>), Action items (actions.<id>)
//   strategy  any section (the Friday Strategy keeps every add on its week)
// The Scramble is left out on purpose: its adds stick to every future week.
//
// Never an edit, a hide or a delete of anything already there; never the
// section's notes box (the app autosaves it from an open textarea). The item
// reads "Added by Claude" on the page (meetingModel.applyPrefs shows by's first
// word). Lead and Foreman are seen by foremen and leads: text with a dollar
// sign or a money word with an amount is refused (reports.js's foreman cut —
// margin %, hours and days stay fine). The Friday Strategy is owners only.
// A named job is read from Command Center here: its number and name are saved
// on the item, never taken from the caller.
const RP = require("./reports.js");
const { matchUserByName } = require("../nameMatch.js");

const MEETING_ACTIONS = ["meeting.addItem"];
const BY = "Claude";
const SAVED_BY = "Duet (Koy)";

const ACT = ["nextsteps", "Action items"];
const KINDS = {
  lead: { dow: 3, label: "Weekly Lead Meeting", foremenSee: true,
    secs: [["notes", "Notes"], ["highlight", "Highlight"], ["lowlight", "Lowlight"], ["training", "Training"], ACT] },
  foreman: { dow: 3, label: "Weekly Resi Foreman Meeting", foremenSee: true,
    secs: [["team", "Team check"], ACT] },
  strategy: { dow: 5, label: "Friday Strategy", foremenSee: false,
    secs: [["top", "Top of the meeting"], ["schedule", "Schedule next week"], ["starts", "Starts next week"], ["trips", "Return trips needed"],
      ["needsdate", "Needs a date"], ["moved", "Dates that moved since last Friday"], ["oncal", "On the calendar next week"],
      ["numbers", "Job numbers"], ["out", "People out next week"], ["notes", "Notes"], ACT] },
};
const MAX_TEXT = 500;
const MAX_WEEKS_AHEAD = 8;
const ID = /^[A-Za-z0-9_]{1,80}$/;

const refuse = (why, status) => ({ refused: why, status: status || 400 });
const pad = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(String(s || "")); if (!m) return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return ymdOf(d) === s ? d : null; };
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; };
// The meeting week runs Monday to Sunday (meetingModel.weekStart); the meeting is that week's dow.
function meetingYmd(anyYmd, kind) {
  const d = parseYmd(anyYmd); if (!d) return "";
  const mon = addDays(d, -((d.getUTCDay() + 6) % 7));
  return ymdOf(addDays(mon, KINDS[kind].dow - 1));
}
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const line = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, n);
const firstOf = (n) => String(n || "").trim().split(/\s+/)[0] || "";

function kindOf(v) {
  const k = norm(v).replace(/\s+/g, "");
  if (["lead", "leadmeeting", "weeklyleadmeeting", "leads"].includes(k)) return "lead";
  if (["foreman", "foremanmeeting", "resiforeman", "weeklyresiforemanmeeting", "foremen"].includes(k)) return "foreman";
  if (["strategy", "fridaystrategy", "friday"].includes(k)) return "strategy";
  if (["scramble", "weeklyscramble"].includes(k)) return "scramble";
  return "";
}
function secOf(kind, v) {
  const n = norm(v);
  if (!n) return null;
  const list = KINDS[kind].secs;
  const hit = list.find(([k, l]) => n === k || n === norm(l)) || (["action", "actions", "action item", "next steps", "todo", "to do"].includes(n) ? ACT : null);
  return hit ? { sec: hit[0], label: hit[1] } : null;
}

// week: "this" (default "next"), "next", or any date in the wanted week. → { ymd } | refused
function weekOf(kind, week, todayYmd) {
  const thisMtg = meetingYmd(todayYmd, kind);
  const w = String(week == null || week === "" ? "next" : week).trim().toLowerCase();
  let ymd;
  if (w === "this") ymd = thisMtg;
  else if (w === "next") ymd = meetingYmd(ymdOf(addDays(parseYmd(todayYmd), 7)), kind);
  else if (parseYmd(w)) ymd = meetingYmd(w, kind);
  else return refuse('week must be "this", "next" or a date (YYYY-MM-DD) in the meeting\'s week. Nothing was written.');
  if (ymd < thisMtg) return refuse(`The ${KINDS[kind].label} on ${ymd} has passed — past meetings are read only. Nothing was written.`);
  const last = meetingYmd(ymdOf(addDays(parseYmd(todayYmd), 7 * MAX_WEEKS_AHEAD)), kind);
  if (ymd > last) return refuse(`That's more than ${MAX_WEEKS_AHEAD} weeks out. Pick a nearer week. Nothing was written.`);
  return { ymd };
}

// The checks that need no read: the meeting, week, section, text, who / due shapes.
function check(args, todayYmd) {
  const a = args && typeof args === "object" ? args : {};
  const kind = kindOf(a.meeting);
  if (kind === "scramble") return refuse("The Weekly Scramble isn't open to Claude's adds: an item there sticks to every future week. Add it in the app. Nothing was written.");
  if (!kind) return refuse("meeting must be lead, foreman or strategy. Nothing was written.");
  const wk = weekOf(kind, a.week, todayYmd); if (wk.refused) return wk;
  const s = secOf(kind, a.section || "notes");
  if (!s) return refuse(`On the ${KINDS[kind].label} Claude can add to: ${KINDS[kind].secs.map(x => x[1]).join(", ")}. Nothing was written.`);
  const text = line(a.text, MAX_TEXT);
  if (!text) return refuse("text is empty. Nothing was written.");
  if (String(a.text || "").trim().length > MAX_TEXT) return refuse(`text is over ${MAX_TEXT} characters — one item at a time. Nothing was written.`);
  if (KINDS[kind].foremenSee && (RP.hasDollars(text) || RP.moneyText(text))) return refuse(`Foremen and leads see the ${KINDS[kind].label}, so it can't carry dollar or cost figures. Take them out (margin % and hours are fine). Nothing was written.`);
  const isAct = s.sec === "nextsteps";
  const due = String(a.due || "").trim();
  if (due && (!isAct || !parseYmd(due))) return refuse(isAct ? "due must be a date, YYYY-MM-DD. Nothing was written." : "due is only for an action item (section Action items). Nothing was written.");
  if (a.who && !isAct) return refuse("who is only for an action item (section Action items). Nothing was written.");
  const jobId = String(a.jobId || "").trim();
  if (jobId && !/^\d{10,15}$/.test(jobId)) return refuse("jobId must be the job's Command Center id. Nothing was written.");
  return { kind, ymd: wk.ymd, docId: kind + "_" + wk.ymd, sec: s.sec, label: s.label, text, isAct, due, who: String(a.who || "").trim(), jobId, preview: a.preview === true };
}

// c: check() output; live: the meeting doc or null; job: { id, name, simproNo, archived, deleted } or null;
// ctx: { nowIso, users }; itemId: a field-safe id. → { write, item, path, result } | refused
function planAdd(c, live, job, ctx, itemId) {
  if (!ID.test(itemId)) return refuse("bad item id");
  if (c.jobId && (!job || job.deleted)) return refuse("That job isn't in Command Center. Nothing was written.", 404);
  let who = "";
  if (c.who) {
    const m = matchUserByName((ctx.users || []).filter(u => u && u.access !== "contractor"), c.who);
    if (!m.user) return refuse(`${c.who} isn't an active name on the Team list. Nothing was written.`, 404);
    if (m.ambiguous) return refuse(`${c.who} matches more than one person on the Team list — use the full name. Nothing was written.`);
    who = m.user.name;
  }
  const jobNo = job ? String(job.simproNo || "").trim() : "";
  const jobName = job ? String(job.name || "").trim() : "";
  const text = jobName && !norm(c.text).includes(norm(jobName)) ? `${jobName}: ${c.text}` : c.text;
  const doc = live && typeof live === "object" ? live : null;
  if (doc && doc.type && doc.type !== c.kind) return refuse(`meetings/${c.docId} isn't a ${KINDS[c.kind].label} record. Nothing was written.`);
  // Same words already in that section that week (anyone's) → not twice.
  const pool = c.isAct ? Object.values((doc && doc.actions) || {}) : Object.values((doc && doc.added) || {});
  if (pool.some(x => x && x.sec === c.sec && norm(x.text) === norm(text))) return refuse(`“${text.slice(0, 80)}” is already in ${c.label} for ${c.ymd}. Nothing was written.`, 409);
  const item = c.isAct
    ? { sec: c.sec, text, who, due: c.due, by: BY, at: ctx.nowIso, ...(job ? { jobId: job.id, jobNo } : {}) }
    : { sec: c.sec, text, jobId: job ? job.id : "", jobNo, by: BY, at: ctx.nowIso };
  const field = c.isAct ? "actions" : "added";
  const path = field + "." + itemId;
  const write = { type: c.kind, date: c.ymd, [field]: { [itemId]: item }, updated_at: ctx.nowIso, saved_by: SAVED_BY };
  const result = { meeting: KINDS[c.kind].label, kind: c.kind, date: c.ymd, docId: c.docId, section: c.label, sec: c.sec, itemId, text,
    ...(who ? { who } : {}), ...(c.due ? { due: c.due } : {}), ...(job ? { jobId: job.id, jobNo, jobName } : {}),
    shows: c.isAct ? `Action item${who ? " for " + firstOf(who) : ""}, added by Claude` : "Tagged Added, “Added by Claude”", newRecord: !doc };
  return { write, item, path, field, result };
}

module.exports = { MEETING_ACTIONS, KINDS, BY, SAVED_BY, kindOf, secOf, meetingYmd, weekOf, check, planAdd };
