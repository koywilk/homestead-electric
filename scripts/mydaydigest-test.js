#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { digestCounts, digestLine, chaseTargets, chaseMessages } = require("../functions/myDayDigest.js");
const T = "2026-09-23";
const users = [
  { id:"koy", name:"Koy Wilkinson", caps:["resi.head","qc.own","redline.own"] },
  { id:"josh", name:"Josh", caps:["invoice.own","qc.own"] },
  { id:"jer", name:"Jeromy", caps:["co.own"] },
  { id:"brady", name:"Brady", caps:["redline.own"] },
  { id:"gage", name:"Gage Lund", title:"foreman" },
];
const jobs = [
  { id:"j1", name:"England", readyToInvoice:true, changeOrders:[{ id:"c1" }, { id:"c2", coStatus:"approved" }] },
  { id:"j2", name:"Parker", readyToInvoice:true, invoiceDismissed:true, clearedTasks:[] },
  { id:"j3", name:"Quote", type:"quote", readyToInvoice:true },
  { id:"j4", name:"Cleared", readyToInvoice:true, clearedTasks:["j4_invoice"] },
  { id:"j5", name:"Done CO", changeOrders:[{ id:"c9", coStatus:"completed" }] },
];
const needs = [
  { id:"n1", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-20" },
  { id:"n2", status:"open", assignedTo:"Gage Lund", dueDate:T },
  { id:"n3", status:"done", assignedTo:"Gage Lund", dueDate:"2026-09-20" },
  { id:"n4", status:"open", assignedTo:"Gage Lund", dueDate:"2026-09-20", snoozedUntil:"2026-09-30" },
  { id:"n5", status:"open", coordinator:"Koy Wilkinson", dueDate:"2026-09-01" },
];
const redlines = [{ id:"r1", status:"scheduled" }, { id:"r2", status:"co_owed" }, { id:"r3", status:"co_owed", coQuoteNumber:"Q1" }];
const m = digestCounts({ users, jobs, needs, redlines, todayYmd: T });
const g = m.get("Gage Lund");
assert.strictEqual(g.overdue, 1, "overdue open need counted; done + snoozed skipped");
assert.strictEqual(g.today, 1, "due today counted");
assert.strictEqual(m.get("Josh").hats.invoice, 2, "j1 invoice + j5 CO complete; dismissed/quote/cleared skipped");
assert.strictEqual(m.get("Jeromy").hats.co_send, 2, "c1 (default needs_sending) + redline r2 CO owed");
assert.strictEqual(m.get("Koy Wilkinson").hats.redline, 1, "shared redline counts for Koy");
assert.strictEqual(m.get("Brady").hats.redline, 1, "…and for Brady");
assert.strictEqual(m.get("Koy Wilkinson").overdue, 1, "legacy coordinator need is the head's");
const cov = digestCounts({ users: [{ ...users[0], coverTo:"Josh", coverUntil:"2026-10-03" }, ...users.slice(1)], jobs, needs, redlines, todayYmd: T });
assert.strictEqual(cov.get("Josh").overdue, 1, "covering: Koy's personal overdue need counts for Josh");
assert.strictEqual(cov.get("Josh").hats.redline, 1, "covering: Koy's redline half goes to Josh");
assert.strictEqual(digestLine({ overdue:0, today:0, hats:{ invoice:0, co_send:0, redline:0 } }), "", "all zero → no push");
assert.strictEqual(digestLine({ overdue:2, today:1, hats:{ invoice:3, co_send:0, redline:1 } }), "2 overdue · 1 today · 3 to invoice · 1 redline walk");
// v446 — urgent count leads the line; an undated urgent doc still counts.
const mU = digestCounts({ users, jobs:[], needs:[{ id:"u1", status:"open", assignedTo:"Gage Lund", priority:"urgent" }, { id:"u2", status:"open", assignedTo:"Gage Lund", priority:"urgent", dueDate:"2026-09-20" }, { id:"u3", status:"open", assignedTo:"Gage Lund", priority:"urgent", snoozedUntil:"2026-09-30" }], redlines:[], todayYmd:T });
assert.strictEqual(mU.get("Gage Lund").urgent, 2, "urgent: dated + undated count, snoozed skipped");
assert.strictEqual(mU.get("Gage Lund").overdue, 1, "the dated urgent one is also overdue");
assert.strictEqual(digestLine({ urgent:1, overdue:2, today:0, hats:{ invoice:0, co_send:0, redline:0 } }), "1 urgent · 2 overdue");

// v446 — overdue chase. T = 2026-09-23 (a Wednesday). nowMs = T noon UTC.
const NOW = Date.parse(T + "T12:00:00Z");
const cNeeds = [
  { id:"c2", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-21", text:"Set panel" },            // 2d → assignee
  { id:"c3", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-20", text:"Odd" },                  // 3d → nobody
  { id:"c5", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-18", text:"Five", jobName:"England" }, // 5d → requester only (odd)
  { id:"c10", status:"open", assignedTo:"Gage Lund", createdBy:"Koy Wilkinson", dueDate:"2026-09-13", text:"Ten", priority:"urgent" }, // 10d → both
  { id:"c1", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-22", text:"One" },                  // 1d → too soon
  { id:"cq", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-19", text:"Talking", updates:[{ by:"Gage Lund", at:"2026-09-22T09:00:00Z", kind:"note", text:"on it" }] }, // 4d but replied 27h ago → skip
  { id:"co", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-19", text:"Old reply", updates:[{ by:"Gage Lund", at:"2026-09-19T09:00:00Z", kind:"note", text:"was on it" }, { by:"Koy Wilkinson", at:"2026-09-23T09:00:00Z", kind:"note", text:"?" }] }, // 4d, assignee's reply is 4 days old → chase
  { id:"cs", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-21", snoozedUntil:"2026-09-30", text:"Snoozed" },
  { id:"cl", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-21", priority:"low", text:"Low" },
  { id:"cd", status:"done", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-21", text:"Done" },
  { id:"cself", status:"open", assignedTo:"Koy Wilkinson", assignedBy:"Koy Wilkinson", dueDate:"2026-09-18", text:"Self" },          // 5d, requester = assignee → assignee only? no: 5 is odd → nobody
  { id:"cnd", status:"open", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueBucket:"tomorrow", text:"Undated" },
  { id:"cb", status:"open", kind:"bodies", assignedTo:"Gage Lund", assignedBy:"Koy Wilkinson", dueDate:"2026-09-21", text:"Bodies" },
];
const ct = chaseTargets({ needs:cNeeds, users, todayYmd:T, nowMs:NOW });
const ids = (role, name) => ct.filter(t => t.role === role && t.name === name).map(t => t.need.id).sort();
assert.deepStrictEqual(ids("assignee", "Gage Lund"), ["c10", "c2", "co"], "assignee: even days (2, 10), stale reply (4d); odd / replied / snoozed / low / done / undated / bodies skipped");
assert.deepStrictEqual(ids("requester", "Koy Wilkinson"), ["c10", "c5"], "requester: 5th days (5, 10); createdBy fallback works");
assert.deepStrictEqual(ct.filter(t => t.need.id === "cself"), [], "self-assigned 5d: odd day, no requester push to yourself");
assert.strictEqual(ct.find(t => t.need.id === "c10" && t.role === "assignee").need.daysOverdue, 10, "daysOverdue math");
// Covering: Gage's chase goes to whoever covers him; Koy's requester push to his cover.
const ctCov = chaseTargets({ needs:cNeeds, users:[{ ...users[0], coverTo:"Josh", coverUntil:"2026-10-03" }, ...users.slice(1)], todayYmd:T, nowMs:NOW });
assert.deepStrictEqual(ctCov.filter(t => t.role === "requester").map(t => t.name), ["Josh", "Josh"], "requester pushes follow the head's cover");
// Messages: one per person per role; needId only when a single task.
const msgs = chaseMessages(ct);
const gm = msgs.find(m => m.name === "Gage Lund");
assert.strictEqual(gm.title, "⏰ 3 overdue tasks on you", "assignee title with count");
assert.ok(gm.body.startsWith("URGENT · Ten (10d overdue) +2 more"), "urgent first, then most overdue; +N more: " + gm.body);
assert.strictEqual(gm.needId, "", "multi-task push lands on the list");
const km = msgs.find(m => m.name === "Koy Wilkinson");
assert.strictEqual(km.role === undefined && km.title, "⏰ 2 tasks you sent are still open", "requester title");
assert.ok(km.body.startsWith("Gage hasn't closed: URGENT · Ten"), km.body);
const one = chaseMessages([{ name:"Gage Lund", role:"assignee", need:{ id:"x1", text:"Set panel", jobName:"England", daysOverdue:2, assignee:"Gage Lund", urgent:false } }])[0];
assert.strictEqual(one.title, "⏰ Still open on you");
assert.strictEqual(one.needId, "x1", "single task → deep-links to it");
assert.strictEqual(one.body, "Set panel · England (2d overdue) — reply, snooze, or mark it done");
assert.deepStrictEqual(chaseMessages([]), [], "nothing → nothing");
console.log("mydaydigest-test ok");
