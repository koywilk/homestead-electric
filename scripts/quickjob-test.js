#!/usr/bin/env node
/* quickjob-test.js — the quick job stage, band and write patches.
 * Extracts the block between the QUICKJOB_HELPERS markers from src/App.js VERBATIM and runs it
 * in a vm sandbox, so what's tested is what ships. Runs in prebuild. */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
const a = src.indexOf("/* QUICKJOB_HELPERS_START"), b = src.indexOf("/* QUICKJOB_HELPERS_END */");
assert(a > 0 && b > a, "helpers block not found");
const names = ["qjStage","qjDay","qjBand","qjWho","qjWhen","qjShort","qjSchedulePatch","qjStartPatch","qjCompletePatch","qjInvoiceSentPatch","qjBack","qjRevert","qjOldestFirst","qjSoonestFirst","QJ_STEPS"];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${src.slice(a, b)}\nglobalThis.__x = { ${names.join(", ")} };`, ctx);
const q = ctx.__x;
const eq = (actual, expected, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
const today = new Date(2026, 9, 30, 15, 30);
const idOn = (y, m, d) => String(new Date(y, m - 1, d, 9).getTime());

// Stage: "new", blank and unknown all read as needing a schedule; finished jobs split on invoiceSent.
eq(q.qjStage({}), "new"); eq(q.qjStage({ quickJobStatus: "new" }), "new"); eq(q.qjStage({ quickJobStatus: "whatever" }), "new");
eq(q.qjStage({ quickJobStatus: "scheduled" }), "scheduled"); eq(q.qjStage({ quickJobStatus: "inprogress" }), "inprogress");
eq(q.qjStage({ quickJobStatus: "complete" }), "ready"); eq(q.qjStage({ quickJobStatus: "invoice" }), "ready");
eq(q.qjStage({ quickJobStatus: "complete", invoiceSent: true }), "sent"); eq(q.qjStage({ quickJobStatus: "invoice", invoiceSent: true }), "sent");
for (const s of ["new", "scheduled", "inprogress", "ready", "sent"]) assert(q.QJ_STEPS.some(x => x[0] === s), `no step for ${s}`);

// Band: every tone, using the real M/D/YYYY stored format.
const band = (j) => { const b = q.qjBand(j, today); return [b.tone, b.label, b.meta]; };
eq(band({ id: idOn(2026, 10, 30) }), ["new", "Needs to be scheduled", "Added today"]);
eq(band({ id: idOn(2026, 10, 8) }), ["new", "Needs to be scheduled", "Waiting 22 days"]);
eq(band({ id: idOn(2026, 10, 29) }), ["new", "Needs to be scheduled", "Waiting 1 day"]);
eq(band({ id: "abc" }), ["new", "Needs to be scheduled", ""], "an id that isn't a time shows no wait");
eq(band({ quickJobStatus: "scheduled", quickJobDate: "10/28/2026" }), ["late", "2 days late", "Was Wed, Oct 28"]);
eq(band({ quickJobStatus: "scheduled", quickJobDate: "10/30/2026" }), ["today", "Today", "Fri, Oct 30"]);
eq(band({ quickJobStatus: "scheduled", quickJobDate: "10/31/2026" }), ["sched", "Sat, Oct 31", "Tomorrow"]);
eq(band({ quickJobStatus: "scheduled", quickJobDate: "11/3/2026", quickJobEndDate: "11/3/2026" }), ["sched", "Tue, Nov 3", "In 4 days"]);
eq(band({ quickJobStatus: "scheduled", quickJobDate: "11/3/2026", quickJobEndDate: "11/5/2026" }), ["sched", "Tue, Nov 3 – Thu, Nov 5", "In 4 days"]);
eq(band({ quickJobStatus: "scheduled" }), ["sched", "Scheduled", "No date set"], "old scheduled job with no date must not crash");
eq(band({ quickJobStatus: "inprogress" }), ["prog", "In progress", ""]);
eq(band({ quickJobStatus: "inprogress", quickJobEndDate: "10/31/2026" }), ["prog", "In progress", "Due tomorrow"]);
eq(band({ quickJobStatus: "inprogress", quickJobEndDate: "10/30/2026" }), ["prog", "In progress", "Due today"]);
eq(band({ quickJobStatus: "inprogress", quickJobEndDate: "10/29/2026" }), ["late", "In progress", "1 day over"]);
eq(band({ quickJobStatus: "complete", signedOffBy: " Colby " }), ["ready", "Ready to invoice", "Done by Colby"]);
eq(band({ quickJobStatus: "invoice", invoiceSent: true }), ["sent", "Invoice sent", ""]);

// Who: "Unassigned" isn't a person; a foreman who is also the lead shows once.
eq(q.qjWho({ foreman: "Unassigned", lead: "Treycen Rollene" }), ["Treycen Rollene"]);
eq(q.qjWho({ foreman: "Abraham Tristan", lead: "abraham tristan " }), ["Abraham Tristan"]);
eq(q.qjWho({ foreman: "Keegan Wilkinson", lead: "Gage Lund" }), ["Keegan Wilkinson", "Gage Lund"]);
eq(q.qjWho({ foreman: "Unassigned", lead: "" }), []); eq(q.qjWho({}), []);

// Schedule: a date moves New to Scheduled; no date saves crew only; clearing a date goes back; end defaults to start.
const s = (j, d) => q.qjSchedulePatch(j, d);
eq(s({ quickJobStatus: "new" }, { date: "11/3/2026", end: "", foreman: "Keegan", lead: "" }), { quickJobStatus: "scheduled", quickJobDate: "11/3/2026", quickJobEndDate: "11/3/2026", foreman: "Keegan", lead: "" });
eq(s({ quickJobStatus: "new" }, { date: "11/3/2026", end: "11/1/2026", foreman: "", lead: "Gage" }), { quickJobStatus: "scheduled", quickJobDate: "11/3/2026", quickJobEndDate: "11/3/2026", foreman: "Unassigned", lead: "Gage" }, "end before start falls back to start");
eq(s({ quickJobStatus: "new" }, { date: "", end: "", foreman: "Keegan", lead: "" }), { quickJobStatus: "new", quickJobDate: "", quickJobEndDate: "", foreman: "Keegan", lead: "" });
eq(s({ quickJobStatus: "scheduled" }, { date: "", end: "", foreman: "Keegan", lead: "" }).quickJobStatus, "new");
eq(s({ quickJobStatus: "inprogress" }, { date: "11/3/2026", end: "11/4/2026", foreman: "K", lead: "" }).quickJobStatus, "inprogress");

// Writes match the fields the old sign-off and invoice buttons wrote.
eq(q.qjCompletePatch("Colby", today), { signedOff: true, signedOffBy: "Colby", signedOffDate: "10/30/2026", quickJobStatus: "complete", readyToInvoice: true, readyToInvoiceDate: "10/30/2026" });
eq(q.qjInvoiceSentPatch(), { invoiceSent: true, readyToInvoice: false, invoiceDismissed: true, quickJobStatus: "invoice" });

// Back: one step, and a job started without a date goes back to needing one.
eq(q.qjBack({ quickJobStatus: "new" }), null);
eq(q.qjBack({ quickJobStatus: "scheduled" }).patch, { quickJobStatus: "new", quickJobDate: "", quickJobEndDate: "" });
eq(q.qjBack({ quickJobStatus: "inprogress", quickJobDate: "11/3/2026" }).patch, { quickJobStatus: "scheduled" });
eq(q.qjBack({ quickJobStatus: "inprogress" }).patch, { quickJobStatus: "new" });
eq(q.qjBack({ quickJobStatus: "invoice", invoiceSent: true }).patch, { signedOff: false, signedOffBy: "", signedOffDate: "", quickJobStatus: "inprogress", readyToInvoice: false, invoiceSent: false });

// Undo restores old values and never writes undefined (Firestore rejects it).
const before = { quickJobStatus: "new", foreman: "Keegan" };
const patch = q.qjSchedulePatch(before, { date: "11/3/2026", end: "", foreman: "Gage", lead: "Noah" });
eq(q.qjRevert(before, patch), { quickJobStatus: "new", quickJobDate: "", quickJobEndDate: "", foreman: "Keegan", lead: "" });
eq(q.qjRevert({}, { signedOff: true, signedOffBy: "x" }), { signedOff: false, signedOffBy: "" });

// Sorting: oldest wait first, soonest date first, no date last.
eq([{ id: "3" }, { id: "1" }, { id: "2" }].sort(q.qjOldestFirst).map(j => j.id), ["1", "2", "3"]);
eq([{ id: "a", quickJobDate: "" }, { id: "b", quickJobDate: "11/3/2026" }, { id: "c", quickJobDate: "10/28/2026" }].sort(q.qjSoonestFirst).map(j => j.id), ["c", "b", "a"]);

console.log("quickjob-test: all passed");
