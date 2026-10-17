#!/usr/bin/env node
// job-events-test (v551, UX batch 0): onJobUpdate logs measurable changes via
// functions/jobEvents.js. Checks the pure diff on real-shaped saves: a stage
// move, a CO going needs_sending → pending, a return trip being created and
// then scheduled and signed off, a material card created and ordered, removals,
// noise that must NOT log (photos, notes, unrelated fields), the per-save cap,
// and that values stay small. Exit 1 on failure. Prebuild.
"use strict";
const assert = require("assert");
const path = require("path");
const { jobEventsDiff: diff, MAX_EVENTS } = require(path.join(__dirname, "..", "functions", "jobEvents.js"));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const one = (evs, pred) => evs.filter(pred).length === 1;

// Miller #1438, Rough 75% → 85% (what the stage select writes).
const miller = { name: "Miller Residence - Alpine", roughStage: "75%", roughStatus: "inprogress", readyToInvoice: false, qcStatus: "scheduled",
  changeOrders: [{ id: "co1", coStatus: "needs_sending", desc: "Move 240V outlet", photos: [] }],
  returnTrips: [], roughMaterials: [{ id: "m1", items: "wire nuts", ordered: false }], roughPunch: { main: { general: [] } } };
let evs = diff(miller, { ...miller, roughStage: "85%", readyToInvoice: true, roughInvoiceFired: true, matterportStatus: "needs" });
ok(one(evs, (e) => e.kind === "field" && e.field === "roughStage" && e.from === "75%" && e.to === "85%"), "stage move logged with from / to");
ok(one(evs, (e) => e.field === "readyToInvoice" && e.to === true), "ready to invoice logged");
ok(one(evs, (e) => e.field === "matterportStatus" && e.from === "" && e.to === "needs"), "Matterport flip logged (undefined → '')");
ok(!evs.some((e) => e.field === "roughInvoiceFired"), "internal flags are not logged");

// CO sent: needs_sending → pending.
evs = diff(miller, { ...miller, changeOrders: [{ ...miller.changeOrders[0], coStatus: "pending", photos: ["p.jpg"] }] });
ok(evs.length === 1 && evs[0].kind === "item" && evs[0].list === "changeOrders" && evs[0].itemId === "co1" && evs[0].from === "needs_sending" && evs[0].to === "pending", "CO status change logged; a photo on the CO is not");

// Return trip lifecycle: created → scheduled → signed off → removed.
const rt = { id: "rt1", scope: "Floor outlets", rtStatus: "needs", rtStatusDate: "", signedOff: false, punch: [] };
evs = diff(miller, { ...miller, returnTrips: [rt] });
ok(evs.length === 1 && evs[0].kind === "created" && evs[0].list === "returnTrips" && evs[0].itemId === "rt1", "RT created logged");
const withRt = { ...miller, returnTrips: [rt] };
evs = diff(withRt, { ...withRt, returnTrips: [{ ...rt, rtStatus: "scheduled", rtStatusDate: "10/27/2026", punch: [{ id: "p", text: "x" }] }] });
ok(evs.length === 2 && one(evs, (e) => e.field === "rtStatus" && e.to === "scheduled") && one(evs, (e) => e.field === "rtStatusDate" && e.to === "10/27/2026"), "RT scheduled logged (status + date); punch edits on the trip are not");
evs = diff(withRt, { ...withRt, returnTrips: [{ ...rt, signedOff: true }] });
ok(one(evs, (e) => e.field === "signedOff" && e.to === true), "RT sign-off logged");
evs = diff(withRt, { ...withRt, returnTrips: [] });
ok(evs.length === 1 && evs[0].kind === "removed" && evs[0].itemId === "rt1", "RT removal logged");

// Material card created, then ordered, then PO sent.
evs = diff(miller, { ...miller, roughMaterials: [...miller.roughMaterials, { id: "m2", items: "2 boxes" }] });
ok(evs.length === 1 && evs[0].kind === "created" && evs[0].list === "roughMaterials" && evs[0].itemId === "m2", "material card created logged");
evs = diff(miller, { ...miller, roughMaterials: [{ ...miller.roughMaterials[0], ordered: true, po: "7262", poSentAt: "2026-10-17T15:00:00Z", items: "edited" }] });
ok(evs.length === 3 && ["ordered", "po", "poSentAt"].every((f) => one(evs, (e) => e.field === f)), "ordered / PO / sent logged; item text edits are not");

// Noise that must not log.
ok(diff(miller, { ...miller, jobNotes: ["new note"], photos: ["x"], statusUpdate: "on site", roughPunch: { main: { general: [{ id: "a", text: "Coach lights" }] } } }).length === 0, "notes, photos, status updates and punch edits log nothing");
ok(diff(miller, JSON.parse(JSON.stringify(miller))).length === 0, "an identical save logs nothing");
ok(diff({ ...miller, roughStage: undefined }, { ...miller, roughStage: null }).length === 0, "undefined vs null is not a change");
ok(diff({ changeOrders: [{ coStatus: "pending" }] }, { changeOrders: [{ coStatus: "approved" }] }).length === 0, "items without ids are ignored");

// Cap and value size.
const many = { returnTrips: Array.from({ length: 200 }, (_, i) => ({ id: "r" + i })) };
ok(diff({}, many).length === MAX_EVENTS, "one save logs at most " + MAX_EVENTS + " events");
const long = diff({ prepStage: "" }, { prepStage: "x".repeat(500) })[0];
ok(long.to.length === 80, "long values are cut to 80 characters");
ok(diff(null, undefined).length === 0, "missing jobs are safe");

console.log(`  ok  job-events-test: ${n} checks`);
