#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { digestCounts, digestLine } = require("../functions/myDayDigest.js");
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
console.log("mydaydigest-test ok");
