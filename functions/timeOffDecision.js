// Time-off decision pushes (v549, UX batch 2). Pure: given the request list
// before and after a write to settings/timeOffRequests, return the pushes the
// requesters should get. The trigger (onTimeOffDecision in index.js) delivers
// them. Both decision paths — the Time Off page and My Day's Approve / Deny —
// write the same doc, so one trigger covers both and can't be skipped by a
// client that closes early.
"use strict";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "11/20/2026" or "2026-11-20" → "Fri, Nov 20" (year added when not this year).
function fmtDay(s, now) {
  const raw = String(s || "").trim();
  let m, d = null;
  if ((m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  else if ((m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/))) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || isNaN(d.getTime())) return raw;
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() !== now.getFullYear() ? ", " + d.getUTCFullYear() : ""}`;
}

function fmtRange(r, now) {
  const a = fmtDay(r.start, now);
  return r.end && r.end !== r.start ? `${a} – ${fmtDay(r.end, now)}` : a;
}

const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

function timeOffDecisionPushes(beforeList, afterList, now = new Date()) {
  const before = new Map((Array.isArray(beforeList) ? beforeList : []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const out = [];
  for (const r of Array.isArray(afterList) ? afterList : []) {
    if (!r || !r.id || !r.name) continue;
    const prev = before.get(r.id);
    if (!prev) continue;                                  // a new request — notifyTimeOffRequest handles that
    const was = prev.status || "pending", is = r.status || "pending";
    if (was === is) continue;
    const by = r.decidedBy || prev.decidedBy || "";
    if (by && same(by, r.name)) continue;                 // you decided your own request: no push to yourself
    const range = fmtRange(r, now);
    const pay = r.usePaid === false ? " (unpaid)" : "";
    if (is === "approved") {
      out.push({ requesterName: r.name, requestId: r.id, status: is,
        title: "Time off approved",
        body: `${range}${pay} · approved by ${firstName(by) || "the office"}. It's on the crew schedule.` });
    } else if (is === "denied") {
      out.push({ requesterName: r.name, requestId: r.id, status: is,
        title: "Time off not approved",
        body: `${range}${pay} · not approved by ${firstName(by) || "the office"}. Talk to ${firstName(by) || "the office"} if you have questions.` });
    } else if (is === "pending" && (was === "approved" || was === "denied")) {
      out.push({ requesterName: r.name, requestId: r.id, status: is,
        title: "Time off back to pending",
        body: `${range}${pay} · the office is taking another look. You'll get a notification with the answer.` });
    }
  }
  return out;
}

module.exports = { timeOffDecisionPushes, fmtRange, fmtDay };
