"use strict";
// Duet write access (D9), ship 2: change orders, return trips and the job's
// status update. PURE planners — given the request, the live job and what the
// server knows (clock, team list), they return either a refusal or exactly
// what to write, copied line for line from the app's own handlers in
// src/App.js: ChangeOrders.submitDraft / upd / setStatus / convertToRT,
// ReturnTrips.add / the status select / the assignee select, and
// StatusUpdateTextarea.commit + its onCommit history append. No Firestore
// here: api.js does the transaction, scripts/duet-cort-test.js drives these
// with fixtures.
//
// Every job write is ONE item by id inside an array (changeOrders or
// returnTrips) — the planner hands back the whole array with that one item
// replaced or appended, and api.js writes it as the dotted key
// data.changeOrders / data.returnTrips inside a transaction that re-read the
// job. That is exactly what the app's three-way merge produces for a phone
// whose baseline is the live doc: other items untouched, this one changed.
const { ME, resolvePerson, cleanText } = require("./needs.js");

const refuse = (why) => ({ refused: why });
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T00:00:00"));

// CO_STATUSES_NEW (App.js): value → takes a date. "simpro_task" is retired.
const CO_STATUSES = { needs_sending: false, pending: false, approved: false, scheduled: true, completed: false, converted: false, denied: false };
// RT_STATUSES (App.js): "" is the unset option; needs + scheduled take a date.
const RT_STATUSES = { "": false, needs: true, scheduled: true, complete: false };
const CO_TEXT = ["desc", "task", "material", "materialSource", "time", "sendTo"];
const RT_TEXT = ["scope", "task", "material", "materialSource", "time", "notes"];
const MAX_HISTORY = 50;

// M/D/YYYY the way `new Date().toLocaleDateString("en-US")` prints it on a
// phone in Mountain time — createdAt on a CO is a display date, not an ISO.
function mdy(nowIso, tz) {
  return new Date(nowIso).toLocaleDateString("en-US", { timeZone: tz || "America/Denver" });
}

// The app's uid() is String(++_uid) seeded from Date.now(): a millisecond
// number as a string. Same shape here, bumped past anything already in the
// array so two items can never share an id.
function newItemId(nowMs, existingIds) {
  const taken = new Set((existingIds || []).map(String));
  let id = Math.floor(nowMs);
  while (taken.has(String(id))) id += 1;
  return String(id);
}

const byId = (arr, id) => (Array.isArray(arr) ? arr : []).findIndex(x => x && String(x.id) === String(id));
const jobGate = (job) => {
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (job.data.archived || job.data.deleted) return refuse(`${job.data.name || "That job"} is archived — changes go on live jobs only. Nothing was written.`);
  return null;
};
// Clean every text field Duet sent; refuse an object or array where a string belongs.
function texts(a, keys) {
  const out = {};
  for (const k of keys) {
    if (a[k] == null) continue;
    if (typeof a[k] !== "string" && typeof a[k] !== "number") return refuse(`${k} must be text.`);
    out[k] = cleanText(a[k]);
  }
  return { out };
}
function needsByWindow(a) {
  const w = {};
  if (a.needsByStart != null) { if (a.needsByStart !== "" && !isYmd(a.needsByStart)) return refuse("needsByStart must be YYYY-MM-DD (or \"\" to clear it)."); w.needsByStart = a.needsByStart; }
  if (a.needsByEnd != null) { if (a.needsByEnd !== "" && !isYmd(a.needsByEnd)) return refuse("needsByEnd must be YYYY-MM-DD (or \"\" to clear it)."); w.needsByEnd = a.needsByEnd; }
  if (a.needsHardDate != null) { if (typeof a.needsHardDate !== "boolean") return refuse("needsHardDate must be true or false."); w.needsHardDate = a.needsHardDate; }
  if (w.needsByStart && w.needsByEnd && w.needsByEnd < w.needsByStart) return refuse("needsByEnd can't be before needsByStart.");
  return { w };
}
// Same string value on the item already? (undefined and "" count as the same.)
const sameVal = (a, b) => String(a == null ? "" : a) === String(b == null ? "" : b);
const changedKeys = (patch, item) => Object.keys(patch).filter(k => !sameVal(patch[k], item[k]));

// ── Change orders ────────────────────────────────────────────────────────────

// submitDraft (App.js ~L17762): the exact doc the crew's Submit writes, key
// for key, with Koy as the creator and submitter. No quote number (the office
// adds it after Simpro), no photos (ship 3).
function planCreateCO(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const t = texts(a, CO_TEXT); if (t.refused) return t;
  const f = t.out;
  if (!f.desc) return refuse("A change order needs a description (desc).");
  const orders = Array.isArray(ctx.job.data.changeOrders) ? ctx.job.data.changeOrders : [];
  const co = {
    id: newItemId(Date.parse(ctx.nowIso), orders.map(o => o && o.id)), date: "", desc: f.desc, task: f.task || "", material: f.material || "", materialSource: f.materialSource || "", time: f.time || "", sendTo: f.sendTo || "",
    photos: [],
    coStatus: "needs_sending", coStatusDate: "",
    needsHardDate: false, needsByStart: "", needsByEnd: "",
    createdBy: ME,
    createdAt: mdy(ctx.nowIso, ctx.tz),
    submittedAt: ctx.nowIso, submittedBy: ME,
    quoteNumber: "",
    quoteAddedBy: "",
    quoteAddedAt: "",
  };
  return { co, changeOrders: [...orders, co], number: orders.length + 1 };
}

// upd(o.id, patch) on the CO card's own inputs: desc / task / material /
// materialSource / time / sendTo, plus the scheduling window. Never the
// status, the quote number or taskChecks — those have their own paths.
function planEditCO(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const orders = Array.isArray(ctx.job.data.changeOrders) ? ctx.job.data.changeOrders : [];
  const i = byId(orders, a.coId);
  if (i < 0) return refuse(`No change order with id ${a.coId} on ${ctx.job.data.name || "that job"}. Nothing was written.`);
  const co = orders[i];
  if (co.coStatus === "converted") return refuse(`Change order #${i + 1} was converted to a return trip — the app hides its fields; edit the return trip instead.`);
  for (const k of ["coStatus", "quoteNumber", "taskChecks", "photos", "id"]) if (a[k] != null) return refuse(`${k} can't be changed here${k === "coStatus" ? " — use co.setStatus" : ""}.`);
  const t = texts(a, CO_TEXT); if (t.refused) return t;
  if (t.out.desc === "") return refuse("desc can't be blank.");
  const w = needsByWindow(a); if (w.refused) return w;
  if (Object.keys(w.w).length && co.coStatus !== "approved" && co.coStatus !== "scheduled") return refuse("The needs-by window only applies to an approved or scheduled change order (the app clears it otherwise).");
  const patch = { ...t.out, ...w.w };
  if (!Object.keys(patch).length) return refuse(`Nothing to change: say what to edit (${CO_TEXT.join(", ")}, needsByStart, needsByEnd, needsHardDate).`);
  const changed = changedKeys(patch, co);
  if (!changed.length) return { noop: true, co };
  const next = { ...co, ...patch };
  return { co: next, before: co, changed, changeOrders: orders.map(o => o === co ? next : o), number: i + 1 };
}

// setStatus (App.js ~L17785): { coStatus, coStatusDate "" unless the status
// takes a date, needsBy* / needsHardDate cleared unless approved | scheduled }.
// "scheduled" takes the date Duet gives (or keeps the one on the card).
function planSetCOStatus(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const orders = Array.isArray(ctx.job.data.changeOrders) ? ctx.job.data.changeOrders : [];
  const i = byId(orders, a.coId);
  if (i < 0) return refuse(`No change order with id ${a.coId} on ${ctx.job.data.name || "that job"}. Nothing was written.`);
  const co = orders[i];
  const value = String(a.status || "");
  if (!(value in CO_STATUSES)) return refuse(`status must be one of ${Object.keys(CO_STATUSES).join(", ")}.`);
  if (a.date != null && a.date !== "" && !isYmd(a.date)) return refuse("date must be YYYY-MM-DD.");
  if (a.date && !CO_STATUSES[value]) return refuse(`${value} doesn't take a date — only scheduled does.`);
  const patch = { coStatus: value };
  if (!CO_STATUSES[value]) patch.coStatusDate = "";
  else if (a.date != null) patch.coStatusDate = a.date;
  if (value !== "approved" && value !== "scheduled") { patch.needsByStart = ""; patch.needsByEnd = ""; patch.needsHardDate = false; }
  const changed = changedKeys(patch, co);
  if (!changed.length) return { noop: true, co };
  const next = { ...co, ...patch };
  return { co: next, before: co, changed, changeOrders: orders.map(o => o === co ? next : o), number: i + 1, from: co.coStatus || "needs_sending", to: value };
}

// convertToRT (App.js ~L17871): ONE write that marks the CO converted and
// appends the new return trip carrying everything the CO holds, photos as
// refs to the same Storage files with fresh ids. The parent appends the RT
// at the end (onChange → u({changeOrders, returnTrips:[...rts, newRT]})).
function planConvertCO(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const orders = Array.isArray(ctx.job.data.changeOrders) ? ctx.job.data.changeOrders : [];
  const trips = Array.isArray(ctx.job.data.returnTrips) ? ctx.job.data.returnTrips : [];
  const i = byId(orders, a.coId);
  if (i < 0) return refuse(`No change order with id ${a.coId} on ${ctx.job.data.name || "that job"}. Nothing was written.`);
  const o = orders[i];
  const linked = !o.convertUndoneAt && trips.some(rt => rt && rt.fromCOId === o.id);
  if (o.coStatus === "converted" || linked) return refuse(`Change order #${i + 1} is already converted to a return trip. Nothing was written.`);
  const nowMs = Date.parse(ctx.nowIso);
  const taken = trips.map(t => t && t.id);
  const rtId = newItemId(nowMs, taken);
  let photoMs = nowMs; const photoIds = new Set(taken.map(String)); photoIds.add(rtId);
  const nextId = () => { let id = ++photoMs; while (photoIds.has(String(id))) id += 1; photoIds.add(String(id)); return String(id); };
  const newRT = {
    id: rtId,
    scope: o.desc || "",
    task: o.task || "",
    material: o.material || "",
    materialSource: o.materialSource || "",
    time: o.time || "",
    assignedTo: "",
    rtStatus: "needs",
    rtStatusDate: "",
    needsHardDate: o.needsHardDate || false,
    needsByStart: o.needsByStart || "",
    needsByEnd: o.needsByEnd || "",
    notes: `Converted from Change Order #${i + 1}${o.quoteNumber ? ` · Quote #${o.quoteNumber}` : ""}${o.desc ? " — " + o.desc : ""}`,
    fromCOId: o.id,
    punch: [],
    photos: Array.isArray(o.photos) ? o.photos.map(p => ({ ...p, id: nextId() })) : [],
  };
  const next = { ...o, coStatus: "converted", convertUndoneAt: "" };
  return { co: next, before: o, rt: newRT, changeOrders: orders.map(co => co === o ? next : co), returnTrips: [...trips, newRT], number: i + 1 };
}

// ── Return trips ─────────────────────────────────────────────────────────────

// The status select's patch (App.js ~L18730): rtStatus + the two derived
// flags; the date is kept only when the status takes one; "scheduled" clears
// the needs-by window. The date input and the assignee select are plain upd().
function rtPatch(a, rt, users) {
  const patch = {};
  if (a.rtStatus != null) {
    const v = String(a.rtStatus);
    if (!(v in RT_STATUSES)) return refuse(`rtStatus must be one of: "" (unset), needs, scheduled, complete.`);
    Object.assign(patch, { rtStatus: v, rtScheduled: v === "scheduled", needsSchedule: v === "needs", rtStatusDate: RT_STATUSES[v] ? (rt.rtStatusDate || "") : "" });
    if (v === "scheduled") { patch.needsByStart = ""; patch.needsByEnd = ""; patch.needsHardDate = false; }
  }
  if (a.rtStatusDate != null) {
    if (a.rtStatusDate !== "" && !isYmd(a.rtStatusDate)) return refuse("rtStatusDate must be YYYY-MM-DD (or \"\" to clear it).");
    const status = patch.rtStatus != null ? patch.rtStatus : (rt.rtStatus || "");
    if (a.rtStatusDate && !RT_STATUSES[status]) return refuse(`A date needs the trip to be "needs" (schedule by) or "scheduled" (scheduled for) — it is ${status ? `"${status}"` : "unset"}. Set rtStatus in the same call.`);
    patch.rtStatusDate = a.rtStatusDate;
  }
  if (a.assignedTo != null) {
    if (a.assignedTo === "") patch.assignedTo = "";
    else { const who = resolvePerson(a.assignedTo, users); if (who.refused) return who; patch.assignedTo = who.name; }
  }
  const t = texts(a, RT_TEXT); if (t.refused) return t;
  Object.assign(patch, t.out);
  return { patch };
}

// add (App.js ~L18479) — the blank trip the + button writes — then the same
// upd() patches Koy would make on the new card, in one write.
function planCreateRT(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const trips = Array.isArray(ctx.job.data.returnTrips) ? ctx.job.data.returnTrips : [];
  const blank = { id: newItemId(Date.parse(ctx.nowIso), trips.map(t => t && t.id)), date: "", scope: "", material: "", punch: [], photos: [], assignedTo: "", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: false, needsScheduleDate: "", rtScheduled: false, scheduledDate: "" };
  const p = rtPatch(a, blank, ctx.users); if (p.refused) return p;
  if (!p.patch.scope) return refuse("A return trip needs a scope (what the trip is for).");
  const rt = { ...blank, ...p.patch };
  return { rt, returnTrips: [...trips, rt], number: trips.length + 1 };
}

function planUpdateRT(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  const trips = Array.isArray(ctx.job.data.returnTrips) ? ctx.job.data.returnTrips : [];
  const i = byId(trips, a.rtId);
  if (i < 0) return refuse(`No return trip with id ${a.rtId} on ${ctx.job.data.name || "that job"}. Nothing was written.`);
  const rt = trips[i];
  if (rt.signedOff) return refuse(`Return trip #${i + 1} is signed off — it's closed. Sign-off and un-sign-off stay in the app.`);
  for (const k of ["signedOff", "signedOffBy", "signedOffDate", "punch", "photos", "id", "fromCOId"]) if (a[k] != null) return refuse(`${k} can't be changed here.`);
  const p = rtPatch(a, rt, ctx.users); if (p.refused) return p;
  if (p.patch.scope === "") return refuse("scope can't be blank.");
  if (!Object.keys(p.patch).length) return refuse("Nothing to change: say what to update (rtStatus, rtStatusDate, assignedTo, scope, task, material, materialSource, time, notes).");
  const changed = changedKeys(p.patch, rt);
  if (!changed.length) return { noop: true, rt };
  const next = { ...rt, ...p.patch };
  return { rt: next, before: rt, changed, returnTrips: trips.map(t => t === rt ? next : t), number: i + 1, pushTo: changed.includes("assignedTo") && next.assignedTo && next.assignedTo !== "Unassigned" ? next.assignedTo : null };
}

// ── Status update (the scalar on the job card) ───────────────────────────────

// StatusUpdateTextarea.commit (App.js ~L38723) + the onCommit at ~L36826:
// same text → nothing; blank → clears by/at; a new text stamps Koy + now and
// appends to statusUpdateHistory (last 50) unless the last entry is the same.
function planSetStatusUpdate(args, ctx) {
  const a = args || {};
  const g = jobGate(ctx.job); if (g) return g;
  if (a.text == null || (typeof a.text !== "string" && typeof a.text !== "number")) return refuse("text is required (\"\" clears the status update).");
  const job = ctx.job.data;
  const v = cleanText(a.text);
  const current = String(job.statusUpdate || "").trim();
  if (v === current) return { noop: true, statusUpdate: current };
  const patch = { statusUpdate: v, statusUpdateBy: v ? ME : "", statusUpdateAt: v ? ctx.nowIso : "" };
  const hist = Array.isArray(job.statusUpdateHistory) ? job.statusUpdateHistory : [];
  const last = hist[hist.length - 1];
  const add = v && !(last && String(last.text || "").trim() === v);
  const fields = add ? { ...patch, statusUpdateHistory: [...hist.slice(-(MAX_HISTORY - 1)), { text: v, by: patch.statusUpdateBy, at: patch.statusUpdateAt }] } : patch;
  const before = {}; Object.keys(fields).forEach(k => { before[k] = job[k] === undefined ? null : job[k]; });
  return { fields, before, changed: Object.keys(patch).filter(k => !sameVal(patch[k], job[k])) };
}

module.exports = { CO_STATUSES, RT_STATUSES, CO_TEXT, RT_TEXT, newItemId, mdy, planCreateCO, planEditCO, planSetCOStatus, planConvertCO, planCreateRT, planUpdateRT, planSetStatusUpdate };
