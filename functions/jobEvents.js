// Job change log (v551, UX batch 0 "measure, don't guess"). Pure: given a job
// before and after one save, return the measurable changes — stage / status
// moves, and change orders, return trips and material cards being created,
// changing status or being removed. onJobUpdate writes them to the
// function-only `job_events` collection (clients can't read or write it).
//
// Why a separate log: jobs/{id}/versions keeps only the newest 25 snapshots per
// job for RECOVERY; stage changes there would push recovery copies out. And the
// server sees every save, old app builds included, so the study's numbers
// (time from created to sent / scheduled / signed off / invoiced) don't depend
// on every client stamping correctly.
"use strict";

// Top-level job fields whose every change is a measurable event.
const FIELDS = [
  "roughStage", "finishStage", "roughStatus", "finishStatus", "roughOnHold", "finishOnHold",
  "qcStatus", "finishQcStatus", "readyToInvoice", "invoiceSent", "matterportStatus", "prepStage",
];
// Lists of items with ids, and which per-item fields count as a status change.
const LISTS = {
  changeOrders: ["coStatus", "submittedAt"],
  returnTrips: ["rtStatus", "rtStatusDate", "signedOff", "assignedTo"],
  roughMaterials: ["ordered", "pickedUp", "po", "poSentAt"],
  finishMaterials: ["ordered", "pickedUp", "po", "poSentAt"],
  commMaterials: ["ordered", "pickedUp", "po", "poSentAt"],
};
const MAX_EVENTS = 60; // one save can't flood the log (a bulk import, a restore)

const norm = (v) => (v === undefined || v === null ? "" : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
// Keep values small: the log is for timing and counting, not a copy of the job.
const small = (v) => {
  const x = norm(v);
  if (typeof x === "string") return x.length > 80 ? x.slice(0, 80) : x;
  if (typeof x === "number" || typeof x === "boolean") return x;
  return JSON.stringify(x).slice(0, 80);
};

function jobEventsDiff(before, after) {
  const b = before || {}, a = after || {};
  const out = [];
  for (const f of FIELDS) {
    if (!same(b[f], a[f])) out.push({ kind: "field", field: f, from: small(b[f]), to: small(a[f]) });
  }
  for (const [list, watch] of Object.entries(LISTS)) {
    const bl = Array.isArray(b[list]) ? b[list] : [], al = Array.isArray(a[list]) ? a[list] : [];
    const bm = new Map(bl.filter((x) => x && x.id != null).map((x) => [String(x.id), x]));
    const am = new Map(al.filter((x) => x && x.id != null).map((x) => [String(x.id), x]));
    for (const [id, item] of am) {
      const prev = bm.get(id);
      if (!prev) { out.push({ kind: "created", list, itemId: id }); continue; }
      for (const f of watch) {
        if (!same(prev[f], item[f])) out.push({ kind: "item", list, itemId: id, field: f, from: small(prev[f]), to: small(item[f]) });
      }
    }
    for (const id of bm.keys()) if (!am.has(id)) out.push({ kind: "removed", list, itemId: id });
  }
  return out.slice(0, MAX_EVENTS);
}

module.exports = { jobEventsDiff, FIELDS, LISTS, MAX_EVENTS };
