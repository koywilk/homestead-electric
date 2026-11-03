"use strict";
// Duet write access (D9), ship 5: time-off approvals, pulled forward from plan
// §10 row 10 because it unblocks Daegan's Monday. PURE planner — given the
// request and the three live docs, it returns the exact three writes the app's
// TimeOffPage.decide makes (src/App.js ~L62732) plus the My Day path's
// timeoffDecision stamp (decideTimeOffFromBoard → patchNeed, ~L69198):
//   (a) settings/timeOffRequests.list — the ONE entry by id becomes
//       {...r, status, decidedBy:"Koy", decidedAt}; the whole list is written
//       back (entries have ids, so the app's three-way merge keeps a request a
//       phone adds in the same second);
//   (b) needs/toneed_<id> — done (approved | denied) or reopened (pending)
//       through the shared needShape patch (donePatch / reopenPatch + needPatch's
//       Working reset), plus timeoffDecision:status; a missing doc is skipped
//       silently, exactly as the app's catch(_) {} does;
//   (c) settings/crewPTO.list — approve adds {id:"pto_"+id, timeoffId, name,
//       start, end:end||start, note:note||"Time off", usePaid: usePaid!==false}
//       once; denied / pending filter that timeoffId's entries out.
// No Firestore here: api.js does the ONE transaction, scripts/duet-crew-test.js
// drives this with fixtures.
const NS = require("../needShape.js");
const { ME } = require("./needs.js");

const STATUSES = ["approved", "denied", "pending"];
const refuse = (why) => ({ refused: why });

// The app's PTO mirror entry, key for key (TimeOffPage.decide + decideTimeOffFromBoard).
function ptoEntry(r) {
  return { id: "pto_" + r.id, timeoffId: r.id, name: r.name, start: r.start, end: r.end || r.start, note: r.note || "Time off", usePaid: r.usePaid !== false };
}

// args: { id, status: approved|denied|pending, force? }
// ctx:  { nowIso, bucketNow, requests (timeOffRequests.list or null when the doc is missing),
//         need (needs/toneed_<id>.data or null), pto (crewPTO.list or null when the doc is missing) }
// Returns {refused} | {noop, request} | { request, requestsList, needFields|null, ptoList|null (null = no PTO write), ptoAdded|null, ptoRemoved, before, after }
function planDecide(args, ctx) {
  const a = args || {};
  const id = String(a.id || "").trim();
  if (!/^to_[a-z0-9]{6,24}$/i.test(id)) return refuse("id must be the request's id from cc_list_time_off (to_…).");
  const status = String(a.status || "");
  if (!STATUSES.includes(status)) return refuse(`status must be one of ${STATUSES.join(", ")}.`);
  if (!Array.isArray(ctx.requests)) return refuse("There are no time-off requests yet. Nothing was written.");
  const r = ctx.requests.find(x => x && x.id === id);
  if (!r) return refuse(`No time-off request with id ${id} — it may have been removed on the Time Off page. Nothing was written.`);
  const was = r.status || "pending";
  if (was === status) return { noop: true, request: r, result: { message: `That request is already ${status === "denied" ? "not approved" : status}.` } };
  if (was !== "pending" && a.force !== true) {
    return refuse(`That request was already ${was === "denied" ? "not approved" : was}${r.decidedBy ? ` by ${r.decidedBy}` : ""}${r.decidedAt ? ` on ${String(r.decidedAt).slice(0, 10)}` : ""}. Say force:true to change a decided request. Nothing was written.`);
  }

  // (a) the request — the ONE entry by id, the list written back whole.
  const next = { ...r, status, decidedBy: ME, decidedAt: ctx.nowIso };
  const requestsList = ctx.requests.map(x => x && x.id === id ? next : x);

  // (b) the head's board task — done or reopened through the shared patch funnel.
  let needFields = null;
  if (ctx.need) {
    const raw = status === "pending" ? { ...NS.reopenPatch(), timeoffDecision: status } : { ...NS.donePatch(ME, ctx.nowIso), timeoffDecision: status };
    needFields = NS.needPatch(raw, ctx.need, ME, ctx.nowIso, ctx.bucketNow);
  }

  // (c) the PTO mirror — added once on approve, pulled on anything else.
  const pto = Array.isArray(ctx.pto) ? ctx.pto : [];
  let ptoList = null, ptoAdded = null, ptoRemoved = 0;
  if (status === "approved") {
    if (!pto.some(p => p && p.timeoffId === id)) { ptoAdded = ptoEntry(r); ptoList = [...pto, ptoAdded]; }
  } else {
    const filtered = pto.filter(p => p && p.timeoffId !== id);
    if (filtered.length !== pto.length) { ptoRemoved = pto.length - filtered.length; ptoList = filtered; }
  }

  const before = { request: r, need: ctx.need ? { status: ctx.need.status || "", doneBy: ctx.need.doneBy || "", doneAt: ctx.need.doneAt || "", timeoffDecision: ctx.need.timeoffDecision || "" } : null, pto: pto.filter(p => p && p.timeoffId === id) };
  const after = { request: next, need: needFields ? { status: needFields.status, doneBy: needFields.doneBy, doneAt: needFields.doneAt, timeoffDecision: needFields.timeoffDecision } : null, pto: ptoList ? ptoList.filter(p => p && p.timeoffId === id) : before.pto };
  return { request: next, from: was, requestsList, needFields, ptoList, ptoAdded, ptoRemoved, before, after,
    pushTo: r.name && r.name !== ME ? [r.name] : [] };   // onTimeOffDecision skips self-decisions
}

module.exports = { STATUSES, ptoEntry, planDecide };
