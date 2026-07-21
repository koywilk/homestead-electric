// ─── GC Portal notification engine: pure email composition ────────────────────
// Piece 5 (email v1). Composes the co-branded contractor emails — the 8 PM daily
// digest and the INSTANT trigger messages — as self-contained HTML.
//
// SAFETY: like gcPortal.js this module is PURE (no Firebase, no I/O) so it is
// unit-testable with plain node. Leak protection works two ways:
//  • DIGESTS are built ONLY from the portal projection (gc_portal mirror docs,
//    the output of gcPortal.projectJobForPortal) — structurally can't carry a
//    field the portal page wouldn't show.
//  • INSTANTS: detectTriggers diffs RAW before/after jobs (it must — some
//    schedule fields aren't projected), but the PAYLOAD it emits is a closed
//    set of safe scalars only: job name, dates, inspection results, static
//    labels, return-trip scope. Never notes, financials, or crew names — any
//    new trigger MUST keep to that set. Everything renders through esc().
// Cadence policy lives in the vault spec (08-Specs/GC Portal Link Spec).
"use strict";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function accentOf(a) { return /^#[0-9a-fA-F]{6}$/.test(String(a || "")) ? a : "#3B5BA5"; }
const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);

// The pretty CTA button + the plain "see all your jobs" line. Rendered at the
// TOP and BOTTOM of every send to train the bookmark (spec: the doorbell/house).
function ctaButton(portalUrl, accent, label) {
  const u = esc(portalUrl || "#");
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0"><tr><td ' +
    'style="border-radius:8px;background:' + accent + '"><a href="' + u + '" ' +
    'style="display:inline-block;padding:11px 22px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">' + esc(label || "See all your jobs →") +
    "</a></td></tr></table>"
  );
}

// Co-branded HTML shell. accent drives the header bar; portal link top + bottom.
function renderGcEmail({ gcLabel, accent, title, intro, sectionsHtml, portalUrl }) {
  const a = accentOf(accent);
  const safeTitle = esc(title || "Homestead Electric");
  return (
    '<!doctype html><html><body style="margin:0;padding:0;background:#f2f3f6">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f6;padding:20px 0">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
    // header bar (accent)
    '<tr><td style="background:' + a + ';padding:18px 24px">' +
    '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;opacity:.85">Homestead Electric</div>' +
    '<div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:2px">' + esc(gcLabel || "Your jobs") + "</div>" +
    "</td></tr>" +
    // body
    '<tr><td style="padding:22px 24px;color:#232936">' +
    '<div style="font-size:17px;font-weight:700;margin:0 0 4px">' + safeTitle + "</div>" +
    (intro ? '<div style="font-size:13.5px;color:#5e6670;line-height:1.5;margin-bottom:6px">' + esc(intro) + "</div>" : "") +
    ctaButton(portalUrl, a, "See all your jobs →") +
    (sectionsHtml || "") +
    ctaButton(portalUrl, a, "Open your portal →") +
    '<div style="font-size:11.5px;color:#8a93a3;line-height:1.5;margin-top:14px;border-top:1px solid #eceef1;padding-top:12px">' +
    "You're getting this because Homestead Electric is running electrical on your project. " +
    "This portal and these updates were built in-house by Homestead Electric. " +
    'To change who gets these updates, send us a message from <a href="' + esc(portalUrl || "#") + '" style="color:' + a + '">your portal</a> and we\'ll update it.' +
    "</div>" +
    "</td></tr></table></td></tr></table></body></html>"
  );
}

// A titled block used inside the digest body.
function block(title, innerHtml, accent) {
  if (!innerHtml) return "";
  return (
    '<div style="margin:14px 0 4px"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8a93a3;font-weight:700;margin-bottom:6px">' +
    esc(title) + "</div>" + innerHtml + "</div>"
  );
}
function row(text) {
  return '<div style="font-size:13.5px;color:#3a414c;line-height:1.5;padding:4px 0;border-bottom:1px solid #f0f1f4">' + text + "</div>";
}

// ── 8 PM daily digest ─────────────────────────────────────────────────────────
// Input: the GC's PROJECTED jobs (array of projectJobForPortal outputs). Returns
// { hasContent, sectionsHtml, summary }. Content is the current standing of each
// job + a "still waiting on you" footer (the spec's standing section). Whether to
// SEND at all (no-content / nothing-changed nights) is decided by the caller.
function digestSections(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const active = list.filter((j) => j && !isComplete(j));

  // (1) Where each job stands
  const standRows = active.map((j) => {
    const bits = [];
    const R = j.rough || {}, F = j.finish || {};
    if (R.stage || R.status) bits.push("rough " + esc(R.stage || "") + (R.status ? " · " + esc(R.status) : ""));
    if (!j.quickJob && (F.stage || F.status)) bits.push("finish " + esc(F.stage || "") + (F.status ? " · " + esc(F.status) : ""));
    if (R.inspection) bits.push("rough inspection " + esc(R.inspection));
    if (F.inspection) bits.push("final inspection " + esc(F.inspection));
    return row('<b style="color:#232936">' + esc(j.name || "Job") + "</b>" + (bits.length ? ' — <span style="color:#5e6670">' + bits.join(" · ") + "</span>" : ""));
  }).join("");

  // (2) Still waiting on YOU (open questions + RTs needing a date + open COs)
  const waiting = [];
  active.forEach((j) => {
    const q = j.questions || {};
    (Array.isArray(q.byFor) ? q.byFor : []).forEach((g) => {
      if (g && g.openCount) waiting.push(esc(j.name) + ": " + g.openCount + " question" + (g.openCount !== 1 ? "s" : "") + " for " + esc(g.who));
    });
    (Array.isArray(j.returnTrips) ? j.returnTrips : []).forEach((rt) => {
      if (rt && rt.needsSchedule && !rt.signedOff) waiting.push(esc(j.name) + ": a return trip needs a date" + (rt.scope ? " — " + esc(rt.scope).slice(0, 80) : ""));
    });
    const co = j.changeOrders || {};
    if (co.open) waiting.push(esc(j.name) + ": " + co.open + " change order" + (co.open !== 1 ? "s" : "") + " awaiting your OK");
  });
  const waitRows = cap(waiting, 30).map((w) => row(w)).join("");

  const sections =
    block("Where your jobs stand", standRows) +
    (waitRows ? block("Still waiting on you", waitRows) : "");
  const summary = active.length + " active job" + (active.length !== 1 ? "s" : "") +
    (waiting.length ? " · " + waiting.length + " item" + (waiting.length !== 1 ? "s" : "") + " waiting on you" : "");
  return { hasContent: !!(standRows || waitRows), sectionsHtml: sections, summary, waitingCount: waiting.length, activeCount: active.length };
}

function isComplete(j) {
  const R = j.rough || {}, F = j.finish || {};
  const rc = R.status === "complete" || R.stage === "100%";
  const fc = F.status === "complete" || F.stage === "100%";
  if (j.quickJob) return rc || j.quickJobStatus === "complete" || j.quickJobStatus === "invoice";
  return rc && fc;
}

// ── INSTANT triggers ──────────────────────────────────────────────────────────
// Given a trigger type + minimal payload, return { subject, sectionsHtml }.
// Payload fields are already projection-safe (job name, dates, labels) — the
// caller pulls them from the diff of before/after projections, never raw notes.
function instantContent(type, p) {
  // Two forms of the job name (review finding: subjects were double-escaped):
  // jn = PLAIN text for the email Subject header + renderGcEmail's title (which
  // escapes once itself); j = HTML-escaped, only for the sectionsHtml bodies.
  const jn = String(p.jobName || "your job").slice(0, 80);
  const j = esc(jn);
  const mk = (subject, inner) => ({ subject, sectionsHtml: block("Update", row(inner)) });
  switch (type) {
    case "schedule":
      return mk(jn + " — new date", esc(p.what || "A date") + " is now " + '<b style="color:#232936">' + esc(p.date || "set") + "</b>.");
    case "inspection": {
      const passed = String(p.result || "").toLowerCase().startsWith("pass");
      return {
        subject: jn + " — " + (passed ? "inspection passed ✓" : "inspection needs corrections"),
        sectionsHtml: block("Inspection", row(
          esc(p.phase || "Inspection") + ": <b style=\"color:" + (passed ? "#2C5C40" : "#B23A3A") + '">' + esc(p.result || "") + "</b>" +
          (!passed && p.fix ? ' — <span style="color:#5e6670">' + esc(p.fix) + "</span>" : "")
        )),
      };
    }
    case "milestone":
      return mk(jn + " — " + String(p.label || "milestone"), '<b style="color:#232936">' + esc(p.label || "Milestone reached") + "</b> on " + j + ".");
    case "needs":
      return mk(jn + " — we need something from you", esc(p.what || "There's a new item that needs your input") + (p.detail ? ': "' + esc(p.detail).slice(0, 120) + '"' : "") + ".");
    case "returntrip":
      return mk(jn + " — return trip scheduled", "A return trip is set" + (p.date ? " for <b>" + esc(p.date) + "</b>" : "") + (p.scope ? ": " + esc(p.scope).slice(0, 120) : "") + ".");
    case "onsite":
      return mk(jn + " — crew on site tomorrow", "Our crew is scheduled at " + j + " tomorrow" + (p.what ? " for " + esc(p.what) : "") + ".");
    case "matterport":
      return mk(jn + " — 3D walkthrough ready", "The Matterport 3D walkthrough of your walls is ready to view in your portal.");
    case "added":
      return mk(jn + " — added to your portal", '<b style="color:#232936">' + j + "</b> is now on your Homestead Electric portal.");
    default:
      return mk(jn + " — update", "There's an update on " + j + ".");
  }
}

// The 3 triggers allowed to also TEXT (v1.5 Twilio). Everything else = email only.
const TEXT_ALLOWED = new Set(["schedule", "inspection", "milestone"]);

// ── INSTANT trigger DETECTION (pure diff of raw before/after job) ─────────────
// Server-side detection may read raw fields (inspection results, dates, stage),
// but the emitted payload carries ONLY projection-safe values (job name, dates,
// results, labels) — never notes/financials. Returns [{ type, payload }].
function detectTriggers(before, after) {
  const b = before || {}, a = after || {};
  const name = a.name || b.name || "your job";
  const out = [];
  const changed = (k) => String(b[k] == null ? "" : b[k]) !== String(a[k] == null ? "" : a[k]);
  const nowHas = (k) => !!a[k] && changed(k); // became non-empty / different

  // 1. Schedule date change — scheduled OR projected start for rough/finish.
  const SCHED = [
    ["roughScheduledDate", "Rough scheduled date"], ["finishScheduledDate", "Finish scheduled date"],
    ["roughProjectedStart", "Rough start"], ["finishProjectedStart", "Finish start"],
    ["roughStart", "Rough start"], ["finishStart", "Finish start"],
  ];
  SCHED.forEach(([k, what]) => { if (a[k] && changed(k)) out.push({ type: "schedule", payload: { jobName: name, what, date: a[k] } }); });

  // 2. Inspection result entered/changed (rough or final).
  if (nowHas("roughInspectionResult")) out.push({ type: "inspection", payload: { jobName: name, phase: "Rough", result: a.roughInspectionResult } });
  if (nowHas("finalInspectionResult")) out.push({ type: "inspection", payload: { jobName: name, phase: "Final", result: a.finalInspectionResult } });

  // 3. Milestone — rough/finish complete, or power on ("house is hot").
  const becameComplete = (stageK, statusK, label) => {
    const was = b[stageK] === "100%" || b[statusK] === "complete";
    const is = a[stageK] === "100%" || a[statusK] === "complete";
    if (is && !was) out.push({ type: "milestone", payload: { jobName: name, label } });
  };
  becameComplete("roughStage", "roughStatus", "Rough complete");
  becameComplete("finishStage", "finishStatus", "Finish complete");
  if (a.isHot === true && b.isHot !== true) out.push({ type: "milestone", payload: { jobName: name, label: "Power on — your house is hot" } });

  // 4. Matterport link newly available.
  const hadMp = !!(b.matterportLink || (Array.isArray(b.matterportLinks) && b.matterportLinks.length));
  const hasMp = !!(a.matterportLink || (Array.isArray(a.matterportLinks) && a.matterportLinks.length));
  if (hasMp && !hadMp) out.push({ type: "matterport", payload: { jobName: name } });

  // 5. A return trip became scheduled (rtScheduled false→true on any trip).
  const rtSched = (arr) => new Set((Array.isArray(arr) ? arr : []).filter((r) => r && r.rtScheduled).map((r) => String(r.id)));
  const wasS = rtSched(b.returnTrips), isS = rtSched(a.returnTrips);
  (Array.isArray(a.returnTrips) ? a.returnTrips : []).forEach((rt) => {
    if (rt && isS.has(String(rt.id)) && !wasS.has(String(rt.id))) {
      out.push({ type: "returntrip", payload: { jobName: name, date: rt.scheduledDate || "", scope: rt.scope || "" } });
    }
  });

  return out;
}

// ── Contact routing + quiet hours (pure) ─────────────────────────────────────
// Which of a link's contacts should receive email for a given job. Per-job
// supers routing: a contact whose ID is assigned to THIS job (supersByJob),
// OR an unassigned/office contact (assigned to no job) receives everything.
// Only contacts with email !== false qualify for email. Returns [{name,email...}].
// Matched by contact ID, not name (Phase 0 fix) — renaming a contact (typo fix,
// last-name change) must never silently drop them from routing.
function emailRecipients(link, jobId) {
  const L = link || {};
  const contacts = Array.isArray(L.contacts) ? L.contacts : [];
  const sbj = (L.supersByJob && typeof L.supersByJob === "object") ? L.supersByJob : {};
  const assignedIds = new Set(Object.values(sbj).flat().map((s) => String(s || "").trim()).filter(Boolean));
  const thisJob = new Set((Array.isArray(sbj[jobId]) ? sbj[jobId] : []).map((s) => String(s || "").trim()));
  return contacts.filter((c) => {
    if (!c || c.email === false) return false;                 // opted out of email
    const id = String((c && c.id) || "").trim();
    if (!id) return true;                                       // no stable id (shouldn't happen post-normalize) — fail OPEN (visible), not silently dropped
    if (thisJob.has(id)) return true;                           // assigned to THIS job
    if (!assignedIds.has(id)) return true;                      // assigned to NO job = subscribes to all
    return false;                                               // assigned to OTHER jobs only
  });
}

// Quiet hours: no INSTANT sends 9 PM–7 AM local; caller queues instead. Digest
// (8 PM) is exempt (it's a scheduled send, not an interrupt). hour is 0–23.
function inQuietHours(hour) { return hour >= 21 || hour < 7; }

module.exports = {
  renderGcEmail,
  digestSections,
  instantContent,
  detectTriggers,
  emailRecipients,
  inQuietHours,
  isComplete,
  TEXT_ALLOWED,
  // exported for tests
  esc,
  accentOf,
};
