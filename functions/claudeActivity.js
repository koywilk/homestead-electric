"use strict";
// claudeActivity.js — the Claude tab on /dashboard (Koy, 2026-11-04: "one that's
// for me specifically, but also one that Josh and Brady can view on the
// dashboard"; and "do we need to put those in multiple different spreadsheets?"
// → no: one place, here). Pure: no Firebase import, so scripts/claude-activity-test.js
// runs it under plain node.
//
// Sources (all server-only — the rules' catch-all closes both to the app):
//   duet_writes/{requestId}     every Command Center change Duet made (already written by duetApi)
//   claude_activity/{id}        kind "simpro": a Simpro schedule write Duet made
//                               kind "watch":  a message Duet read and what it did with it
//                               (written by the connector — the replacement for the
//                               "Claude Scheduling Write Log" sheet's Log and Watch tabs)
//
// Two views:
//   koy     everything, message gists included (Koy's own texts, chat and mail)
//   owners  the same changes, but the messages only as counts — never who wrote
//           what. Built HERE, server-side, so a non-Koy admin's browser never
//           receives a message's words at all.

const ACTION_LABEL = {
  "task.create": "Added a My Day task", "task.update": "Updated a My Day task",
  "co.create": "Added a change order", "co.edit": "Edited a change order", "co.setStatus": "Set a change order's status",
  "co.convert": "Turned a change order into a return trip",
  "rt.create": "Added a return trip", "rt.update": "Updated a return trip",
  "job.setStatusUpdate": "Wrote the job's status note",
  "question.add": "Added a question", "question.answer": "Answered a question", "question.reopen": "Reopened a question", "question.reply": "Replied on a question",
  "note.add": "Added a job note", "note.addLine": "Added a note line", "note.editLine": "Edited a note line", "note.archive": "Archived a job note", "note.delete": "Deleted a job note",
  "dailyUpdate.add": "Added a daily update",
  "job.setPeople": "Set the job's people",
  "punch.setDone": "Checked off punch", "punch.add": "Added a punch item", "punch.assign": "Assigned a punch item", "punch.waiting": "Marked a punch item waiting",
  "punch.void": "Voided a punch item", "punch.restore": "Restored a punch item", "punch.editText": "Edited a punch item",
  "phase.setStatus": "Set a phase status", "phase.setStage": "Set the stage", "phase.setDates": "Set phase dates",
  "inspection.setResult": "Logged an inspection result", "inspection.items": "Logged inspection items", "inspection.createTrip": "Added an inspection trip",
  "qc.setStatus": "Set QC status", "prep.tick": "Ticked a prep item",
  "material.addCard": "Added a material card", "material.editCard": "Edited a material card", "material.tick": "Ticked a material card",
  "material.previewPo": "Previewed a PO", "material.sendPo": "Sent a PO",
  "job.setField": "Set a job field",
  "photo.add": "Added a photo",
  "crew.assign": "Put someone on the crew planner", "crew.unassign": "Took someone off the crew planner", "crew.setLead": "Set a crew lead",
  "timeOff.decide": "Decided a time-off request",
  "job.createFromSimpro": "Brought a job in from Simpro", "job.setInfo": "Edited Job Info", "job.setSection": "Edited a job section", "job.archive": "Archived a job",
  "project.create": "Made a project", "project.patch": "Edited a project", "project.createBuilding": "Added a building", "project.join": "Joined a job to a project",
  "broadcast.send": "Sent an announcement", "autoTask.promote": "Promoted an auto task", "planIntake.decide": "Filed a plan",
  "upcoming.add": "Added an upcoming job", "upcoming.edit": "Edited an upcoming job", "crewTeams.set": "Set crew teams", "crewRoster.set": "Set the crew roster",
  "undo.apply": "Put back an earlier change",
};
// How the Watch tab's "What I did" column reads, folded to four kinds.
function didKind(s) {
  const t = String(s || "").toLowerCase();
  if (/flag|asked koy|to koy|needs koy/.test(t)) return "flagged";
  if (/already|handled|done/.test(t)) return "handled";
  if (/schedul|wrote|added|logged|updated/.test(t)) return "acted";
  return "dismissed";
}
const KIND_LABEL = { flagged: "Flagged to Koy", handled: "Already handled", acted: "Acted on", dismissed: "Nothing needed" };

const str = (v, n = 300) => String(v == null ? "" : v).slice(0, n);
const iso = (v) => { if (!v) return ""; if (typeof v === "string") return v; if (v.toDate) return v.toDate().toISOString(); if (v instanceof Date) return v.toISOString(); return ""; };

// One duet_writes doc → one change row. Refused calls never changed anything, so
// they stay off the page (the connector's cc_list_duet_writes still shows them).
function fromDuet(id, a) {
  if (!a || a.ok === false) return null;
  const body = (a.response && a.response.body) || {};
  return {
    id: str(id, 64), at: iso(a.at), app: "Command Center", action: str(a.action, 40),
    what: ACTION_LABEL[a.action] || str(a.action, 40),
    detail: str(body.on || body.message || "", 160),
    jobId: str(a.coll === "jobs" ? a.docId : body.jobId || "", 20), jobName: str(body.jobName || "", 120), jobNo: "",
    who: "", workDate: "", okBy: str(a.okBy || "", 60), noop: !!a.noop, undone: !!a.undoneBy,
  };
}
function fromSimpro(id, r) {
  return {
    id: str(id, 64), at: iso(r.at), app: "Simpro", action: "simpro.schedule",
    what: str(r.what || "Schedule entry", 160), detail: str(r.notes || "", 160),
    jobId: "", jobName: str(r.jobName || "", 120), jobNo: str(r.jobNo || "", 12),
    who: str(r.who || "", 60), workDate: str(r.workDate || "", 10), okBy: str(r.okBy || "", 60), noop: false, undone: !!r.removed,
  };
}
// Plan Intake (Koy, 2026-11-04: "Add plan intake"): every decision on an agentQueue item —
// the plan-intake Routine's, or Koy's own from the dashboard (decision.by names him).
// dry_/test_ items are practice runs and stay off. The file name came from an email, so it
// rides in `detail` and the owners' cut drops it.
const PLAN_ACTION = { file: "Filed a plan", dismiss: "Set aside, not plans", match_walk: "Matched a walk to its job", unmatched: "Couldn't place a plan" };
function planJobNo(q) {
  const d = q.decision || {};
  const m = /^\s*#?(Q?\d+)/i.exec(String(d.number || "")) || /^\s*(?:#|(Q))(\d+)/i.exec(String(d.note || "")) || /existing job #()(\d+)/i.exec(String(d.note || ""));
  if (!m) return "";
  return (m.length > 2 ? `${m[1] ? "Q" : ""}${m[2]}` : m[1]).replace(/^q/i, "Q");
}
function fromPlan(id, q) {
  if (!q || /^(dry|test)_/.test(id) || !q.decision) return null;
  const d = q.decision, act = d.action || q.status;
  const no = planJobNo(q);
  return {
    id: str(id, 64), at: iso(d.at || q.decidedAt), app: "Plan Intake", action: `plan.${str(act, 20)}`,
    what: PLAN_ACTION[act] || str(act, 40), detail: str(q.filename || q.title || "", 160),
    jobId: "", jobName: "", jobNo: no.startsWith("Q") ? "" : no, quoteNo: no.startsWith("Q") ? no : "",
    who: str(d.by || "", 60), workDate: "", okBy: "", noop: false, undone: false,
  };
}
function fromWatch(id, r) {
  const kind = didKind(r.did);
  return {
    id: str(id, 64), at: iso(r.at), source: str(r.source || "", 20), from: str(r.from || "", 80), msgAt: str(r.msgAt || "", 25),
    jobName: str(r.jobName || "", 120), jobNo: str(r.jobNo || "", 12),
    said: str(r.said || "", 300), did: str(r.did || "", 80), why: str(r.why || "", 300), kind,
  };
}

// The whole answer. `viewer` is the verified admin record (requireAdmin); only
// Koy's own record gets the message words, and Koy can ask for the owners'
// cut to see exactly what Josh and Brady see.
function buildActivity({ duet = [], activity = [], plans = [], plansWaiting = 0, viewer, wantOwners, nowIso }) {
  const isKoy = !!viewer && viewer.id === "koy";
  const view = isKoy && !wantOwners ? "koy" : "owners";
  const planRows = plans.map(([id, q]) => fromPlan(id, q)).filter(Boolean);
  const planCounts = { filed: 0, setAside: 0, walks: 0, waiting: plansWaiting };
  planRows.forEach(p => { if (p.action === "plan.file") planCounts.filed++; else if (p.action === "plan.dismiss") planCounts.setAside++; else if (p.action === "plan.match_walk") planCounts.walks++; });
  const changes = [
    ...duet.map(([id, a]) => fromDuet(id, a)),
    ...activity.filter(([, r]) => r && r.kind === "simpro").map(([id, r]) => fromSimpro(id, r)),
    ...(view === "koy" ? planRows : planRows.map(p => ({ ...p, detail: "" }))),
  ].filter(Boolean).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  const watch = activity.filter(([, r]) => r && r.kind === "watch").map(([id, r]) => fromWatch(id, r))
    .sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  const counts = { checked: watch.length, flagged: 0, handled: 0, acted: 0, dismissed: 0 };
  watch.forEach(w => { counts[w.kind]++; });
  const out = { ok: true, view, isKoy, generatedAt: nowIso || new Date().toISOString(), changes, watchCounts: counts, planCounts, kindLabel: KIND_LABEL };
  if (view === "koy") out.watch = watch;
  return out;
}

module.exports = { buildActivity, fromDuet, fromSimpro, fromWatch, fromPlan, planJobNo, didKind, ACTION_LABEL, KIND_LABEL, PLAN_ACTION };
