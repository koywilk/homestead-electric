// needShape.js — the shape of a My Day task (a `needs` doc) and the rules its
// save funnels apply, in ONE place.
//
// WHY THIS EXISTS (v600, 2026-11-03, Duet write access — connector decision D9)
// --------------------------------------------------------------------------
// Claude Duet can now add and update tasks from a chat, through the duetApi
// Cloud Function. A task written by the server has to look EXACTLY like one
// written by a phone — same fields, same defaults, same "hand-off ends
// Working" rule, same due-bucket math — or My Day shows it wrong and
// onNeedWrite pushes the wrong person. So the builders the app's own
// NeedQuickAdd / patchNeed / addNeedUpdate use live here, and the Cloud
// Function requires a byte-identical copy.
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js), the Cloud
// Functions require a copy, and scripts/duet-writes-test.js drives the exact
// file that ships. COPIED to functions/needShape.js by
// scripts/need-shape-sync.js — edit THIS file only; the prebuild refuses to
// build while the two differ.
//
// Nothing here touches Firestore. Callers decide the write (setDoc for a new
// need, dotted `data.<field>` updateDoc + arrayUnion for a patch).
"use strict";

// Loose person match used all over My Day: "Josh" matches "Josh Miller".
function sameName(a, b) {
  const x = String(a || "").trim().toLowerCase(), y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y + " ") || y.startsWith(x + " ");
}
// `??` on purpose: an explicit "" (unassigned) is honored; an ABSENT field falls
// to the legacy book owner. This one line is what keeps the pre-existing docs
// working without a rewrite.
function needAssignee(n) { return String((n && (n.assignedTo ?? n.coordinator)) || "").trim(); }
function needUpdates(n) { return Array.isArray(n && n.updates) ? n.updates : []; }

// "" → null so a caller keeps whatever bucket it already had. `now` is only
// for tests and the server (the Cloud Function runs in UTC and passes a
// Mountain-time "today" in); the phones use their own clock.
function dueBucketFromDate(ymd, now) {
  if (!ymd) return null;
  const d = new Date(ymd + "T00:00:00"); if (isNaN(d)) return null;
  const t = now ? new Date(now) : new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 1);
  return d <= t ? "tomorrow" : "week";
}

// The patch funnel's rule: handing a task to someone else, closing it or
// reopening it ends "Working" (the new person hasn't started; a closed task
// isn't being worked). A patch that sets startedBy itself is left alone, and
// a same-person / same-status patch (an Edit re-save) changes nothing.
function needWorkReset(patch, current) {
  if (!patch || "startedBy" in patch) return {};
  const handOff = "assignedTo" in patch && !(current && sameName(needAssignee(current), patch.assignedTo));
  const statusFlip = "status" in patch && !(current && current.status === patch.status);
  // Always clear on a real flip, even when this copy shows no start — another
  // phone may have started it since this copy was taken (two blank fields cost nothing).
  return handOff || statusFlip ? { startedBy: "", startedAt: "" } : {};
}

// Normalize on the way out so every doc in `needs` is self-consistent no
// matter which UI wrote it. Additive: only fills derived/default keys.
function normalizeNeed(need, now) {
  const n = { ...need };
  if (!n.kind) n.kind = "need";
  if (n.dueDate) { const b = dueBucketFromDate(n.dueDate, now); if (b) n.dueBucket = b; }
  if (!n.dueBucket) n.dueBucket = "week";
  return n;
}

// A new need's id. Not uid(): needs have always used this format.
function newNeedId(nowMs, rand) {
  const ms = nowMs == null ? Date.now() : nowMs;
  const r = rand == null ? Math.random().toString(36).slice(2, 7) : String(rand);
  return "need_" + ms + "_" + r;
}

// The doc NeedQuickAdd.save() builds. `fields`:
//   kind "need"|"task" · text · dueBucket "tomorrow"|"week" · dueDate "YYYY-MM-DD"|""
//   priority ""|"urgent"|"low" · assignedTo (name or "") · job ({id,name,foreman}|null)
//   foremanIfNoJob (what the picker knows about the writer's foreman when no job is picked)
// `me` is the writer's display name, `nowIso` the one timestamp every stamp
// shares, `now` (optional) the clock for the due bucket.
function buildNeed(fields, me, nowIso, id, now) {
  const f = fields || {};
  const job = f.job || null;
  const dueDate = f.dueDate || "";
  const kind = f.kind === "task" ? "task" : "need";
  const prio = f.priority === "urgent" || f.priority === "low" ? f.priority : "";
  return {
    id: id || newNeedId(),
    kind, text: String(f.text || "").trim(),
    dueBucket: dueDate ? (dueBucketFromDate(dueDate, now) || "week") : (f.dueBucket === "week" ? "week" : "tomorrow"),
    dueDate,
    snoozedUntil: "",
    priority: prio,   // v446
    assignedTo: f.assignedTo || "", assignedBy: me, assignedAt: nowIso,
    foreman: job ? (job.foreman || "") : (f.foremanIfNoJob || ""),
    jobId: job ? job.id : "", jobName: job ? (job.name || "") : "",
    status: "open", createdBy: me, createdAt: nowIso, doneAt: "", doneBy: "",
  };
}

// What patchNeed derives from a raw patch before writing it: the Working
// reset, the assignment stamp, the due bucket. Returns the full field patch
// (dotted `data.<k>` keys are the caller's job).
function needPatch(patch, current, me, nowIso, now) {
  const p = { ...(patch || {}), ...needWorkReset(patch, current) };
  if ("assignedTo" in p) { p.assignedBy = me; p.assignedAt = nowIso; }
  if (p.dueDate) { const b = dueBucketFromDate(p.dueDate, now); if (b) p.dueBucket = b; }
  return p;
}

// The done / reopen patches every "mark done" path writes.
function donePatch(me, nowIso) { return { status: "done", doneAt: nowIso, doneBy: me }; }
function reopenPatch() { return { status: "open", doneAt: "", doneBy: "" }; }

// addNeedUpdate's entry + snooze rule (v421). `entry` is null when the text is
// blank. The assignee's "waiting" with a date also snoozes; a reply from the
// other side un-snoozes.
function needUpdateEntry({ kind, text, until } = {}, current, by, nowIso) {
  const entry = { by, at: nowIso, kind: kind === "waiting" ? "waiting" : "note", text: String(text || "").trim(), ...(kind === "waiting" && until ? { until } : {}) };
  if (!entry.text) return { entry: null, extra: {} };
  const isAssignee = !!current && sameName(needAssignee(current), by);
  const extra = {};
  if (entry.kind === "waiting" && entry.until && isAssignee) extra.snoozedUntil = entry.until;
  else if (!isAssignee && current && current.snoozedUntil) extra.snoozedUntil = "";
  return { entry, extra };
}

module.exports = { sameName, needAssignee, needUpdates, dueBucketFromDate, needWorkReset, normalizeNeed, newNeedId, buildNeed, needPatch, donePatch, reopenPatch, needUpdateEntry };
