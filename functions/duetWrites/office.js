"use strict";
// office.js — Duet write access (connector decision D9), ship 10: the office
// actions. Pure planners: given the live docs they return what to write and
// what to audit; api.js owns the transaction / the in-process calls. Tested by
// scripts/duet-office-test.js against App.js.
//
//   • planBroadcast        the EXACT payload the app's Bell → Send composer
//                          hands the sendBroadcast callable ({id, title, body,
//                          label, kind, attachments, to:[{id,name}], test}),
//                          recipients resolved against the live team list the
//                          composer's own `people` filter uses, "all" = that
//                          whole list (the composer's "Everyone" label).
//                          Refuses when Koy's own record wouldn't pass the
//                          callable's isBroadcaster gate — api.js then runs the
//                          SAME sendBroadcastAs body index.js's callable runs.
//   • planPromoteAutoTask  My Day's Push: exactly autoTaskDoc(t, job, who,
//                          "Koy", nowIso, id) for a NEW doc, or — when an OPEN
//                          doc already carries that autoTaskId (autoDelegation's
//                          rule: open beats done, newest wins) — pushTo's
//                          onPatchNeed(cur.id, {assignedTo: who}) through the
//                          shared needPatch, never a second doc. The auto rows
//                          themselves come from App.js's computeTasks (416
//                          lines on C / isCommercial / commercialTasks /
//                          daysUntil…), which is NOT lifted: Duet names the
//                          row's suffix (+ title / desc for templated rows) and
//                          this file checks it against the engine's id catalog.
//   • planDecidePlanIntake the exact body the Routine POSTs to /decide for
//                          each action, with by: "Koy (via Duet)"; the decide
//                          itself is the watcher's own decideById (api.js).
//   • planUpcoming         settings/upcoming_jobs.items — add = blankUpcoming()
//                          + the fields, prepended as the pipeline's + Add does;
//                          edit = one item by id. No promote (that's a job
//                          create with photos — out).
//   • planCrewTeams        settings/crewTeams.teams — add {id: Date.now()
//                          .toString(36), lead, members} (saveTeamModal's
//                          literal), edit lead / members by id, remove one team
//                          (a list edit: the doc stays).
//   • planCrewRoster       settings/crewRoster.names — add / remove ONE name.
//
// autoTaskDoc / autoDelegation / parseAnyDate / localYmd below are App.js's
// text, copied verbatim and pinned equal by scripts/duet-office-test.js (the
// ship-7 parseStage / qcTripPlan pattern): App.js keeps its own copies, the
// test refuses the build when the two drift.
const { matchUserByName } = require("../nameMatch.js");
const { dueBucketFromDate, needPatch, newNeedId, needAssignee, sameName } = require("../needShape.js");
const { resolvePerson, cleanText } = require("./needs.js");

const ME = "Koy";
const refuse = (why) => ({ refused: why });
const T = (v, max = 2000) => cleanText(v).slice(0, max);

// ── App.js copies (pinned verbatim by the test) ──────────────────────────────
const parseAnyDate = (str) => {
  if(!str) return null;
  // YYYY-MM-DD (from date picker) — parse as LOCAL date to avoid UTC midnight shift
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  // MM/DD/YY or MM/DD/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(mdy) {
    let [,m,d,y] = mdy;
    if(y.length===2) y = "20"+y;
    return new Date(+y, +m-1, +d);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};
function localYmd(d) {
  const x = d ? new Date(d) : new Date();
  if (isNaN(x)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
// Per auto-task id, the doc that describes its delegation: an OPEN doc beats a
// done one; among equals the newest assignedAt/createdAt wins. Docs without
// autoTaskId (hand-typed tasks) are ignored.
function autoDelegation(needs) {
  const m = new Map();
  for (const n of needs || []) {
    if (!n || !n.autoTaskId) continue;
    const cur = m.get(n.autoTaskId);
    if (!cur) { m.set(n.autoTaskId, n); continue; }
    const nOpen = n.status !== "done", cOpen = cur.status !== "done";
    if (nOpen !== cOpen) { if (nOpen) m.set(n.autoTaskId, n); continue; }
    const nAt = String(n.assignedAt || n.createdAt || ""), cAt = String(cur.assignedAt || cur.createdAt || "");
    if (nAt > cAt) m.set(n.autoTaskId, n);
  }
  return m;
}
// The exact doc Push writes — same shape NeedQuickAdd.save() builds, plus
// autoTaskId. Due date: the head's snoozed date (taskDueDates) wins, else the
// rule's date, normalised to YYYY-MM-DD; no date → "week", never "today".
function autoTaskDoc(t, job, assignee, me, nowIso, id) {
  const raw = (job && job.taskDueDates && job.taskDueDates[t.id]) || t.dueDate || "";
  const d = raw ? parseAnyDate(raw) : null;
  const dueDate = d ? localYmd(d) : "";
  return {
    id: id || ("need_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
    kind: "task", text: t.title || "(auto task)", plan: t.desc || "",
    dueBucket: dueDate ? (dueBucketFromDate(dueDate, new Date(nowIso)) || "week") : "week",
    dueDate, snoozedUntil: "",
    assignedTo: assignee || "", assignedBy: me, assignedAt: nowIso,
    foreman: (job && job.foreman) || t.foreman || "",
    jobId: t.jobId || "", jobName: t.jobName || (job && job.name) || "",
    status: "open", createdBy: me, createdAt: nowIso, doneAt: "", doneBy: "",
    autoTaskId: t.id,
  };
}

// ── Announcements ────────────────────────────────────────────────────────────
const BROADCAST_KINDS = ["announcement", "important", "discussion"];
const BODY_MAX = 1000, TITLE_MAX = 80, LABEL_MAX = 80;   // the callable's own slices — refused here instead of cut silently
// The composer's recipient list (App.js `people`): active, named, not a contractor.
const legacyAccess = (u) => u.access || ({ admin: "admin", justin: "admin", jeromy: "manager", foreman: "standard" }[u.role] || "limited");
function broadcastPeople(users) {
  return (users || []).filter(u => u && u.name && u.active !== false && legacyAccess(u) !== "contractor").sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
// bcNewId(): `bc_${Date.now().toString(36)}_${rand6}` — the client mints the id, so does this.
const broadcastId = (nowMs, rand) => `bc_${Number(nowMs).toString(36)}_${String(rand || Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "0")}`;

// ctx: { users, koyUser, isBroadcaster, nowMs, rand }
function planBroadcast(args, ctx) {
  const a = args || {};
  const koy = ctx.koyUser;
  if (!koy) return refuse("Koy isn't on the active team list, so there is nobody to send as. Nothing was sent.");
  if (typeof ctx.isBroadcaster !== "function" || !ctx.isBroadcaster(koy)) return refuse("Koy's team record isn't an office broadcaster (requireBroadcaster would refuse the app's own Send too). Nothing was sent.");
  const body = T(a.body, BODY_MAX + 1);
  if (!body) return refuse("Write a message first. Nothing was sent.");
  if (body.length > BODY_MAX) return refuse(`The message is ${body.length} characters; the app cuts a team message at ${BODY_MAX}. Shorten it so Koy sees exactly what goes out. Nothing was sent.`);
  const title = T(a.title, TITLE_MAX + 1);
  if (title.length > TITLE_MAX) return refuse(`The title is ${title.length} characters; the app cuts it at ${TITLE_MAX}. Nothing was sent.`);
  const kind = BROADCAST_KINDS.includes(String(a.kind || "")) ? String(a.kind) : (a.kind == null || a.kind === "" ? "announcement" : null);
  if (!kind) return refuse(`kind must be one of ${BROADCAST_KINDS.join(", ")}. Nothing was sent.`);
  const test = a.test === true;
  const people = broadcastPeople(ctx.users);
  let picked = [], label = "";
  if (!test) {
    const to = a.to;
    if (to === "all" || to === "everyone") { picked = people; label = "Everyone"; }
    else if (Array.isArray(to) && to.length) {
      const seen = new Set();
      for (const raw of to) {
        const want = String(raw == null ? "" : raw).trim();
        if (!want) continue;
        const { user, ambiguous } = matchUserByName(people, want);
        if (ambiguous) return refuse(`"${want}" matches more than one person on the team — use the full name. Nothing was sent.`);
        if (!user) {
          const stem = want.toLowerCase().slice(0, 3);
          const close = people.map(u => u.name).filter(n => n.toLowerCase().includes(stem)).slice(0, 5);
          return refuse(`"${want}" isn't on the active team list.${close.length ? ` Close: ${close.join(", ")}.` : ""} Nothing was sent.`);
        }
        const k = String(user.id || user.name);
        if (seen.has(k)) continue;
        seen.add(k); picked.push(user);
      }
      if (!picked.length) return refuse("Pick at least one person. Nothing was sent.");
      label = picked.length === people.length ? "Everyone" : `${picked.length} picked`;
    } else return refuse('to must be "all" or a list of team members\' names. Nothing was sent.');
    if (a.label != null && String(a.label).trim()) label = T(a.label, LABEL_MAX);
  }
  if (!Array.isArray(a.attachments) ? a.attachments != null && a.attachments !== "" : a.attachments.length) return refuse("Attachments aren't sent from Duet (the app's composer uploads them from the phone). Send the message without them, or from the app. Nothing was sent.");
  const payload = { id: broadcastId(ctx.nowMs, ctx.rand), title, body, label, kind, attachments: [], to: test ? [] : picked.map(u => ({ id: u.id || "", name: u.name })), test };
  const recipients = test ? [{ id: koy.id || "", name: koy.name }] : payload.to;
  return { payload, recipients, kind, label, test, shownTitle: title || `Message from ${koy.name}`, bodyLength: body.length, everyone: !test && picked.length === people.length };
}

// ── My Day auto-task promotion ───────────────────────────────────────────────
// The task engine's ids (App.js computeTasks + commercialTasks), pinned to the
// source by the test. FIXED suffixes carry the title the engine writes when it
// is a plain literal (null when the engine templates it — then Duet must pass
// the title it read off the board); DYNAMIC ones carry an id in the middle.
const AUTO_TASK_FIXED = {
  _rough_deposit: { title: "Material Deposit — Rough", desc: "Rough is scheduled — collect material deposit before start", category: "invoice" },
  _rough_confirm_start: { title: "Confirm Rough Start Date", desc: null, category: "rough" },
  _rough_waiting: { title: "Get Rough Start Date", desc: "Waiting for start date confirmation from GC/homeowner", category: "rough" },
  _rough_needs: { title: "Schedule Rough", desc: null, category: "rough" },
  _rough_po: { title: "Order Job Start PO", desc: null, category: "po" },
  _finish_deposit: { title: "Material Deposit — Finish", desc: "Finish is scheduled — collect material deposit before start", category: "invoice" },
  _finish_confirm_start: { title: "Confirm Finish Start Date", desc: null, category: "finish" },
  _finish_needs: { title: "Schedule Finish", desc: null, category: "finish" },
  _finish_po: { title: "Order Job Start PO", desc: null, category: "po" },
  _qc_walk: { title: "Schedule QC Walk", desc: null, category: "qc" },
  _final_qc_walk: { title: "Schedule Final QC Walk", desc: null, category: "qc" },
  _punch_rough_warn: { title: null, desc: "Rough is marked complete or ready to invoice but punch items are still open", category: "punch" },
  _punch_finish_warn: { title: null, desc: "Finish is marked complete or ready to invoice but punch items are still open", category: "punch" },
  _invoice_stale: { title: null, desc: "Job has been ready to invoice for more than 5 days — follow up", category: "invoice" },
  _invoice: { title: "Ready to Invoice", desc: null, category: "invoice" },
  _matterport: { title: "Schedule Matterport Scan", desc: null, category: "matterport" },
  _tempped_sched: { title: null, desc: "Temp ped is ready to be scheduled", category: "tempped" },
  _quick_schedule: { title: null, desc: null, category: "schedule" },
  _quick_upcoming: { title: null, desc: null, category: "schedule" },
  _quick_invoice: { title: null, desc: "Quick job complete — ready to invoice", category: "invoice" },
  _prep: { title: null, desc: null, category: "prep" },
  _comm_phase: { title: null, desc: null, category: "commercial" },
  _comm_ufer: { title: null, desc: null, category: "commercial" },
  _comm_underground: { title: null, desc: null, category: "commercial" },
  _comm_ready: { title: null, desc: "All 12 pre-con phases closed", category: "commercial" },
  _comm_gearcheck: { title: null, desc: null, category: "commercial" },
};
// `_co_<coId>_send|approved|sched|done`, `_rt_<rtId>_done|needs|sched`, `_comm_owed_<n>_<k>`, `_comm_gearlate_<id>`.
const AUTO_TASK_DYNAMIC = [
  { re: /^_co_([A-Za-z0-9]+)_(send|approved|sched|done)$/, category: "co", list: "changeOrders" },
  { re: /^_rt_([A-Za-z0-9]+)_(done|needs|sched)$/, category: "rt", list: "returnTrips" },
  { re: /^_comm_owed_(\d+)_([A-Za-z0-9_]+)$/, category: "commercial" },
  { re: /^_comm_gearlate_([A-Za-z0-9 _.-]+)$/, category: "commercial" },
];
const SUFFIX = /^_[a-z0-9_ .-]{2,80}$/i;
function autoTaskKind(suffix) {
  if (Object.prototype.hasOwnProperty.call(AUTO_TASK_FIXED, suffix)) return { fixed: true, ...AUTO_TASK_FIXED[suffix] };
  for (const d of AUTO_TASK_DYNAMIC) { const m = d.re.exec(suffix); if (m) return { fixed: false, title: null, desc: null, category: d.category, list: d.list, itemId: m[1] }; }
  return null;
}
// Duet's `autoTaskId` may be the bare suffix ("_rough_po") or the full id ("<jobId>_rough_po").
function suffixOf(raw, jobId) {
  let s = String(raw == null ? "" : raw).trim();
  if (jobId && s.startsWith(String(jobId))) s = s.slice(String(jobId).length);
  return s;
}

// ctx: { nowIso, nowMs, rand, users, job: {id, data} | null, needs: [need data…] carrying this autoTaskId }
function planPromoteAutoTask(args, ctx) {
  const a = args || {};
  const job = ctx.job;
  if (!job) return refuse("That job isn't in Command Center. Nothing was written.");
  const d = job.data || {};
  if (d.deleted) return refuse("That job was deleted. Nothing was written.");
  if (d.archived) return refuse(`${d.name || "That job"} is archived. Nothing was written.`);
  const suffix = suffixOf(a.autoTaskId, job.id);
  if (!SUFFIX.test(suffix)) return refuse("autoTaskId must be the auto row's id suffix, e.g. _rough_po, _qc_walk, _co_<coId>_send, _rt_<rtId>_needs (or the full <jobId><suffix>). Nothing was written.");
  const kind = autoTaskKind(suffix);
  if (!kind) return refuse(`"${suffix}" isn't one of the task engine's auto rows. Known: ${Object.keys(AUTO_TASK_FIXED).join(", ")}, _co_<coId>_send|approved|sched|done, _rt_<rtId>_done|needs|sched, _comm_owed_<n>_<k>, _comm_gearlate_<id>. Nothing was written.`);
  if (kind.list && !(Array.isArray(d[kind.list]) && d[kind.list].some(x => x && String(x.id) === kind.itemId))) return refuse(`${d.name || "That job"} has no ${kind.list === "changeOrders" ? "change order" : "return trip"} with id ${kind.itemId}, so the engine never makes that row. Nothing was written.`);
  const id = String(job.id) + suffix;
  if (Array.isArray(d.clearedTasks) && d.clearedTasks.includes(id)) return refuse(`That row (${id}) was cleared by the head (clearedTasks), so it isn't on the board to push. Nothing was written.`);
  const title = T(a.title, 200) || kind.title || "";
  if (!title) return refuse(`"${suffix}" is a row whose title the engine builds from the job (not a fixed text) — pass title exactly as My Day shows it. Nothing was written.`);
  if (kind.title && a.title != null && String(a.title).trim() && T(a.title, 200) !== kind.title) return refuse(`The engine titles ${suffix} "${kind.title}" — not "${T(a.title, 200)}". Leave title out for this row. Nothing was written.`);
  const desc = a.desc != null && String(a.desc).trim() ? T(a.desc, 500) : (kind.desc || "");
  const who = resolvePerson(a.assignee, ctx.users);
  if (who.refused) return who;
  if (!who.name) return refuse("assignee is required — who the row is pushed to. Nothing was written.");
  const rawDue = a.dueDate == null || a.dueDate === "" ? "" : String(a.dueDate).trim();
  if (rawDue && !parseAnyDate(rawDue)) return refuse("dueDate must be YYYY-MM-DD (or M/D/YYYY). Nothing was written.");
  const t = { id, jobId: job.id, jobName: d.name || "", title, desc, dueDate: rawDue, foreman: d.foreman || "", category: kind.category };
  // autoDelegation over the docs carrying this autoTaskId: an open one gets re-pushed (pushTo's onPatchNeed), never a second doc.
  const cur = autoDelegation(ctx.needs || []).get(id) || null;
  if (cur && cur.status !== "done") {
    if (sameName(needAssignee(cur), who.name)) return { noop: true, needId: cur.id, result: { needId: cur.id, assignedTo: needAssignee(cur), message: `${who.name} already has that task open (${cur.id}) — nothing to change.`, autoTaskId: id } };
    const patch = needPatch({ assignedTo: who.name }, cur, ME, ctx.nowIso);
    const before = {}, after = {};
    Object.keys(patch).forEach(k => { before[k] = cur[k] === undefined ? null : cur[k]; after[k] = patch[k]; });
    return { patch, needId: cur.id, before, after, autoTaskId: id, result: { needId: cur.id, repushed: true, from: needAssignee(cur), assignedTo: who.name, text: cur.text || "", autoTaskId: id, suffix, category: kind.category, pushTo: [who.name] } };
  }
  const need = autoTaskDoc(t, { ...d, id: job.id }, who.name, ME, ctx.nowIso, newNeedId(ctx.nowMs, ctx.rand));
  return { need, autoTaskId: id, verifyDoc: cur || null, result: { needId: need.id, created: true, assignedTo: need.assignedTo, text: need.text, plan: need.plan, dueBucket: need.dueBucket, dueDate: need.dueDate, foreman: need.foreman, autoTaskId: id, suffix, category: kind.category, snoozedDateUsed: !!(d.taskDueDates && d.taskDueDates[id]), earlierDoneDoc: cur ? cur.id : undefined, pushTo: [who.name] } };
}

// ── Plan intake ──────────────────────────────────────────────────────────────
const PLAN_ACTIONS = ["file", "dismiss", "unmatched", "match_walk"];
const PLAN_CATEGORIES = ["plans", "cabinet", "appliance", "design", "specs", "redlines"];   // MAIL.CATEGORIES' keys (pinned by the test)
const PLAN_BY = "Koy (via Duet)";
const ITEM_ID = /^(dry_|test_)?[A-Za-z0-9_-]{4,120}$/;
// The exact body the Routine POSTs to /decide for each action (watcher.js decide()), plus `by`.
function planDecidePlanIntake(args) {
  const a = args || {};
  const item = String(a.item || "").trim();
  if (!ITEM_ID.test(item)) return refuse("item must be the queue item's id from cc_list_plan_intake_queue. Nothing was decided.");
  const action = String(a.action || "");
  if (!PLAN_ACTIONS.includes(action)) return refuse(`action must be one of ${PLAN_ACTIONS.join(", ")}. Nothing was decided.`);
  const reason = T(a.reason, 200);
  let body;
  if (action === "file") {
    const kind = a.kind === "quote" ? "quote" : a.kind === "job" || a.kind == null || a.kind === "" ? "job" : null;
    if (!kind) return refuse("kind must be job or quote. Nothing was decided.");
    const number = String(a.number == null ? "" : a.number).replace(/\D/g, "");
    if (!number) return refuse("number (the Simpro job or quote number) is required to file. Nothing was decided.");
    const category = String(a.category || "").toLowerCase();
    if (!PLAN_CATEGORIES.includes(category)) return refuse(`category must be one of ${PLAN_CATEGORIES.join(", ")}. Nothing was decided.`);
    const rev = a.rev == null || a.rev === "" ? undefined : T(a.rev, 20);
    const date = a.date == null || a.date === "" ? undefined : String(a.date).trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return refuse("date must be YYYY-MM-DD. Nothing was decided.");
    body = { item, action, kind, number, category, ...(rev ? { rev } : {}), ...(date ? { date } : {}), ...(reason ? { reason } : {}), by: PLAN_BY };
  } else if (action === "dismiss") {
    if (!reason) return refuse("reason is required to dismiss (it goes on the item and the finding). Nothing was decided.");
    body = { item, action, reason, by: PLAN_BY };
  } else if (action === "unmatched") {
    const bestGuess = T(a.bestGuess, 40);
    if (!reason) return refuse("reason is required for unmatched (the dashboard shows it). Nothing was decided.");
    body = { item, action, bestGuess, reason, by: PLAN_BY };
  } else {
    const kind = a.kind === "quote" ? "quote" : a.kind === "job" ? "job" : null;
    if (!kind) return refuse("match_walk needs kind: job or quote. Nothing was decided.");
    const number = String(a.number == null ? "" : a.number).replace(/\D/g, "");
    if (!number) return refuse("number is required for match_walk. Nothing was decided.");
    body = { item, action, kind, number, by: PLAN_BY };
  }
  return { item, action, body };
}

// ── Upcoming jobs pipeline ───────────────────────────────────────────────────
// blankUpcoming() (App.js): the item every + Add row starts from. `uid` is the app's uid().
function blankUpcoming(uid) {
  return { id: uid(), name:"", address:"", city:"", sales:"", customer:"", notes:"", lastFollowUp:"", foreman:"", projectedStart:"", startConfirmed:false, photos:[] };
}
const UPCOMING_TEXT = { name: 120, address: 200, city: 80, sales: 80, customer: 120, notes: 2000, lastFollowUp: 20, projectedStart: 20 };
const UPCOMING_FIELDS = [...Object.keys(UPCOMING_TEXT), "foreman", "startConfirmed"];
const UPCOMING_ID = /^[A-Za-z0-9_-]{1,40}$/;
function cleanUpcomingFields(a, users) {
  const out = {};
  for (const k of Object.keys(UPCOMING_TEXT)) if (a[k] !== undefined) {
    const v = T(a[k], UPCOMING_TEXT[k]);
    if ((k === "lastFollowUp" || k === "projectedStart") && v && !parseAnyDate(v)) return refuse(`${k} must be a date (M/D/YYYY as the pipeline types it, or YYYY-MM-DD). Nothing was written.`);
    out[k] = v;
  }
  if (a.foreman !== undefined) {
    const f = String(a.foreman == null ? "" : a.foreman).trim();
    if (!f) out.foreman = "";
    else { const who = resolvePerson(f, users); if (who.refused) return who; out.foreman = who.name; }
  }
  if (a.startConfirmed !== undefined) { if (typeof a.startConfirmed !== "boolean") return refuse("startConfirmed must be true or false. Nothing was written."); out.startConfirmed = a.startConfirmed; }
  return { fields: out };
}
// ctx: { users, items: [...] | null (doc missing), uid }
function planUpcoming(action, args, ctx) {
  const a = args || {};
  const items = Array.isArray(ctx.items) ? ctx.items : [];
  const c = cleanUpcomingFields(a, ctx.users);
  if (c.refused) return c;
  if (action === "upcoming.add") {
    if (!c.fields.name) return refuse("name is required for a new Upcoming row. Nothing was written.");
    const item = { ...blankUpcoming(ctx.uid), ...c.fields };
    const dup = items.find(x => x && String(x.name || "").trim().toLowerCase() === item.name.toLowerCase());
    if (dup) return refuse(`The Upcoming pipeline already has "${dup.name}" (id ${dup.id}) — edit it (cc_upcoming_job with its id) instead of adding a twin. Nothing was written.`);
    return { items: [item, ...items], item, itemId: item.id, before: null, after: item, result: { itemId: item.id, added: true, item, position: "top", itemsNow: items.length + 1 } };
  }
  const id = String(a.id || "").trim();
  if (!UPCOMING_ID.test(id)) return refuse("id must be the Upcoming row's id from cc_list_upcoming_jobs. Nothing was written.");
  const idx = items.findIndex(x => x && String(x.id) === id);
  if (idx < 0) return refuse(`No Upcoming row has id ${id}. Nothing was written.`);
  if (!Object.keys(c.fields).length) return refuse(`Nothing to change — give one or more of ${UPCOMING_FIELDS.join(", ")}. Nothing was written.`);
  const cur = items[idx];
  const changed = Object.keys(c.fields).filter(k => (cur[k] === undefined ? (k === "startConfirmed" ? false : "") : cur[k]) !== c.fields[k]);
  if (!changed.length) return { noop: true, itemId: id, result: { itemId: id, changed: [] } };
  const next = { ...cur }; changed.forEach(k => { next[k] = c.fields[k]; });
  const before = {}, after = {}; changed.forEach(k => { before[k] = cur[k] === undefined ? null : cur[k]; after[k] = next[k]; });
  const list = items.slice(); list[idx] = next;
  return { items: list, item: next, itemId: id, before, after, changed, result: { itemId: id, changed, item: next } };
}

// ── Crew teams + roster ──────────────────────────────────────────────────────
const TEAM_ID = /^[A-Za-z0-9_-]{1,24}$/;   // Date.now().toString(36) in practice (8 chars); older hand ids tolerated
const TEAM_OPS = ["add", "edit", "remove"];
function cleanNames(list, users, what) {
  if (list === undefined) return { names: undefined };
  if (!Array.isArray(list)) return refuse(`${what} must be a list of team members' names. Nothing was written.`);
  const names = [];
  for (const raw of list) {
    const who = resolvePerson(raw, users);
    if (who.refused) return who;
    if (who.name && !names.includes(who.name)) names.push(who.name);
  }
  return { names };
}
// ctx: { users, teams: [...] | null, nowMs }
function planCrewTeams(args, ctx) {
  const a = args || {};
  const op = String(a.op || "");
  if (!TEAM_OPS.includes(op)) return refuse(`op must be one of ${TEAM_OPS.join(", ")}. Nothing was written.`);
  const teams = Array.isArray(ctx.teams) ? ctx.teams : [];
  const leadRaw = a.lead === undefined ? undefined : String(a.lead == null ? "" : a.lead).trim();
  let lead;
  if (leadRaw !== undefined) { if (!leadRaw) lead = ""; else { const who = resolvePerson(leadRaw, ctx.users); if (who.refused) return who; lead = who.name; } }
  const m = cleanNames(a.members, ctx.users, "members");
  if (m.refused) return m;
  const members = m.names;
  if (op === "add") {
    const t = { id: Number(ctx.nowMs).toString(36), lead: lead || "", members: (members || []).filter(n => !sameName(n, lead || "")) };   // saveTeamModal / teamAdd's literal
    if (!t.lead && !t.members.length) return refuse("A new team needs a lead or at least one member. Nothing was written.");
    if (teams.some(x => x && x.id === t.id)) return refuse("A team with that id already exists (two adds in the same millisecond) — try again. Nothing was written.");
    return { teams: [...teams, t], team: t, teamId: t.id, before: null, after: t, result: { teamId: t.id, added: true, team: t, teamsNow: teams.length + 1 } };
  }
  const id = String(a.teamId || "").trim();
  if (!TEAM_ID.test(id)) return refuse("teamId must be the team's id from cc_list_crew_teams. Nothing was written.");
  const idx = teams.findIndex(x => x && String(x.id) === id);
  if (idx < 0) return refuse(`No crew team has id ${id}. Nothing was written.`);
  const cur = teams[idx];
  if (op === "remove") {
    const list = teams.filter((_, i) => i !== idx);   // teamRemove's filter: the team leaves the list, the doc stays
    return { teams: list, team: cur, teamId: id, before: cur, after: null, result: { teamId: id, removed: true, team: cur, teamsNow: list.length } };
  }
  if (lead === undefined && members === undefined) return refuse("Give lead and/or members to edit a team. Nothing was written.");
  const nextLead = lead === undefined ? String(cur.lead || "") : lead;
  const nextMembers = (members === undefined ? (Array.isArray(cur.members) ? cur.members : []) : members).filter(n => !sameName(n, nextLead));
  const next = { ...cur, lead: nextLead, members: nextMembers };   // saveTeamModal's {...t, lead, members}
  if (next.lead === String(cur.lead || "") && JSON.stringify(next.members) === JSON.stringify(Array.isArray(cur.members) ? cur.members : [])) return { noop: true, teamId: id, result: { teamId: id, team: cur } };
  const list = teams.slice(); list[idx] = next;
  return { teams: list, team: next, teamId: id, before: cur, after: next, result: { teamId: id, changed: [...(next.lead !== String(cur.lead || "") ? ["lead"] : []), ...(JSON.stringify(next.members) !== JSON.stringify(cur.members || []) ? ["members"] : [])], team: next } };
}
// ctx: { users, names: [...] | null }
function planCrewRoster(args, ctx) {
  const a = args || {};
  const op = String(a.op || "");
  if (!["add", "remove"].includes(op)) return refuse("op must be add or remove. Nothing was written.");
  const names = Array.isArray(ctx.names) ? ctx.names : [];
  const who = resolvePerson(a.name, ctx.users);
  if (who.refused) return who;
  if (!who.name) return refuse("name is required. Nothing was written.");
  const on = names.includes(who.name);
  if (op === "add") {
    if (on) return { noop: true, result: { name: who.name, onRoster: true, message: `${who.name} is already on the crew roster.` } };
    return { names: [...names, who.name], before: null, after: who.name, result: { name: who.name, added: true, rosterNow: names.length + 1 } };   // _saveRoster([...roster, name])
  }
  if (!on) return { noop: true, result: { name: who.name, onRoster: false, message: `${who.name} isn't on the crew roster.` } };
  return { names: names.filter(n => n !== who.name), before: who.name, after: null, result: { name: who.name, removed: true, rosterNow: names.length - 1 } };   // _saveRoster(roster.filter(n => n !== name))
}

module.exports = { ME, PLAN_BY, BROADCAST_KINDS, BODY_MAX, TITLE_MAX, PLAN_ACTIONS, PLAN_CATEGORIES, AUTO_TASK_FIXED, AUTO_TASK_DYNAMIC, UPCOMING_FIELDS, TEAM_OPS,
  parseAnyDate, localYmd, autoDelegation, autoTaskDoc, broadcastPeople, broadcastId, autoTaskKind, suffixOf, blankUpcoming,
  planBroadcast, planPromoteAutoTask, planDecidePlanIntake, planUpcoming, planCrewTeams, planCrewRoster };
