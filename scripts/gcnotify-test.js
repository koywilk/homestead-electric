// GC notify email-composition tests — run: node scripts/gcnotify-test.js
"use strict";
const N = require("../functions/gcNotify.js");

let failures = 0;
function t(name, cond, detail) {
  if (cond) console.log("  ok  " + name);
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// Projected jobs (shape = gcPortal.projectJobForPortal output)
const JOBS = [
  { id: "1", name: "Rose Residence", quickJob: false,
    rough: { stage: "60%", status: "inprogress", inspection: "pass" },
    finish: { stage: "0%", status: "" },
    questions: { byFor: [{ who: "Haley", openCount: 2, items: [] }] },
    returnTrips: [{ id: "rt1", needsSchedule: true, signedOff: false, scope: "outlets for cabinets" }],
    changeOrders: { count: 2, open: 1 } },
  { id: "2", name: "Done House", quickJob: false,
    rough: { stage: "100%", status: "complete" }, finish: { stage: "100%", status: "complete" },
    questions: { byFor: [] }, returnTrips: [], changeOrders: { count: 0, open: 0 } },
];

console.log("escaping (XSS-safe email):");
t("esc neutralizes markup", N.esc('<img src=x onerror=alert(1)>"') === "&lt;img src=x onerror=alert(1)&gt;&quot;");
t("accentOf validates hex", N.accentOf("#4A5D3A") === "#4A5D3A" && N.accentOf("red") === "#3B5BA5" && N.accentOf("javascript:") === "#3B5BA5");

console.log("digest:");
const d = N.digestSections(JOBS);
t("only active jobs counted", d.activeCount === 1, "activeCount=" + d.activeCount);
t("has content", d.hasContent === true);
t("waiting rollup counts questions+RT+CO", d.waitingCount === 3, "waitingCount=" + d.waitingCount);
t("standing section names the job", d.sectionsHtml.includes("Rose Residence"));
t("completed job excluded from standing", !d.sectionsHtml.includes("Done House"));
t("summary line", /1 active job/.test(d.summary) && /3 items waiting/.test(d.summary), d.summary);
const empty = N.digestSections([{ id: "x", name: "C", rough: { stage: "100%", status: "complete" }, finish: { stage: "100%", status: "complete" } }]);
t("all-complete → no content (no-email night)", empty.hasContent === false);

console.log("isComplete:");
t("quick job complete on invoice", N.isComplete({ quickJob: true, quickJobStatus: "invoice", rough: {}, finish: {} }) === true);
t("full job needs both phases", N.isComplete({ rough: { stage: "100%" }, finish: { stage: "0%" } }) === false);

console.log("instant triggers:");
const sch = N.instantContent("schedule", { jobName: "Rose", what: "Finish start", date: "Sep 8" });
t("schedule subject+body", /Rose — new date/.test(sch.subject) && sch.sectionsHtml.includes("Sep 8"));
const insFail = N.instantContent("inspection", { jobName: "Rose", phase: "Rough", result: "fail", fix: "fix crew Wed" });
t("failed inspection → corrections subject", /needs corrections/.test(insFail.subject) && insFail.sectionsHtml.includes("fix crew Wed"));
const insPass = N.instantContent("inspection", { jobName: "Rose", phase: "Rough", result: "pass" });
t("passed inspection subject", /passed/.test(insPass.subject));
t("instant escapes job name in HTML body", N.instantContent("added", { jobName: '<b>x</b>' }).sectionsHtml.includes("&lt;b&gt;x&lt;/b&gt;"));
t("subject stays plain text (no double-escape)", N.instantContent("schedule", { jobName: "Smith & Sons", what: "Finish start", date: "Sep 8" }).subject === "Smith & Sons — new date", N.instantContent("schedule", { jobName: "Smith & Sons" }).subject);
t("esc'd title renders single-escaped in email body", (() => {
  const html = N.renderGcEmail({ gcLabel: "X", accent: "#3B5BA5", title: "Smith & Sons — new date", sectionsHtml: "", portalUrl: "https://x" });
  return html.includes("Smith &amp; Sons") && !html.includes("&amp;amp;");
})());
t("TEXT_ALLOWED = only 3 interrupt triggers", N.TEXT_ALLOWED.has("schedule") && N.TEXT_ALLOWED.has("inspection") && N.TEXT_ALLOWED.has("milestone") && !N.TEXT_ALLOWED.has("needs") && !N.TEXT_ALLOWED.has("matterport"));

console.log("full email render:");
const html = N.renderGcEmail({ gcLabel: "Robison", accent: "#4A5D3A", title: "Tonight's update", intro: "Here's where things stand.", sectionsHtml: d.sectionsHtml, portalUrl: "https://x/?gcportal=tok" });
t("renders accent header", html.includes("#4A5D3A") && html.includes("Robison"));
t("portal link appears twice (top+bottom)", (html.match(/gcportal=tok/g) || []).length >= 2, "count=" + ((html.match(/gcportal=tok/g) || []).length));
t("built-in-house provenance present", html.includes("built in-house") || html.toLowerCase().includes("built in-house"));

console.log("trigger detection (raw before/after diff):");
t("schedule date change fires", (() => {
  const tr = N.detectTriggers({ name: "Rose", finishStart: "Sep 1" }, { name: "Rose", finishStart: "Sep 8" });
  return tr.some((x) => x.type === "schedule" && x.payload.date === "Sep 8");
})());
t("inspection result fires once entered", (() => {
  const tr = N.detectTriggers({ name: "Rose", roughInspectionResult: "" }, { name: "Rose", roughInspectionResult: "pass" });
  return tr.some((x) => x.type === "inspection" && x.payload.result === "pass");
})());
t("rough-complete milestone fires on 100%", (() => {
  const tr = N.detectTriggers({ name: "R", roughStage: "80%" }, { name: "R", roughStage: "100%" });
  return tr.some((x) => x.type === "milestone" && /Rough complete/.test(x.payload.label));
})());
t("house-hot milestone fires", (() => {
  const tr = N.detectTriggers({ name: "R", isHot: false }, { name: "R", isHot: true });
  return tr.some((x) => x.type === "milestone" && /hot/i.test(x.payload.label));
})());
t("matterport-ready fires when link appears", (() => {
  const tr = N.detectTriggers({ name: "R" }, { name: "R", matterportLink: "https://my.matterport.com/x" });
  return tr.some((x) => x.type === "matterport");
})());
t("return-trip scheduled fires false→true", (() => {
  const tr = N.detectTriggers({ name: "R", returnTrips: [{ id: "1", rtScheduled: false }] }, { name: "R", returnTrips: [{ id: "1", rtScheduled: true, scheduledDate: "7/22" }] });
  return tr.some((x) => x.type === "returntrip" && x.payload.date === "7/22");
})());
t("no change → no triggers", N.detectTriggers({ name: "R", roughStage: "60%" }, { name: "R", roughStage: "60%" }).length === 0);
t("detection payload never carries notes/financials", (() => {
  const tr = N.detectTriggers({ name: "R", finishStart: "a" }, { name: "R", finishStart: "b", roughNotes: "SECRET", simproMargin: 42 });
  return JSON.stringify(tr).indexOf("SECRET") === -1 && JSON.stringify(tr).indexOf("42") === -1;
})());

console.log("contact routing:");
// Phase 0: routing keys off contact ID, not name — fixtures below use ids
// exactly like normalizeGcContacts() would stamp onto a real contact.
const LINK = { contacts: [
  { id: "c_austin", name: "Austin", email: true }, { id: "c_bex", name: "Bex", email: true },
  { id: "c_owner", name: "Owner", email: true }, { id: "c_textonly", name: "TextOnly", email: false },
], supersByJob: { jobA: ["c_austin"], jobB: ["c_bex"] } };
t("assigned super gets their job", N.emailRecipients(LINK, "jobA").some((c) => c.name === "Austin"));
t("other-job super excluded", !N.emailRecipients(LINK, "jobA").some((c) => c.name === "Bex"));
t("unassigned contact gets everything", N.emailRecipients(LINK, "jobA").some((c) => c.name === "Owner"));
t("email:false excluded", !N.emailRecipients(LINK, "jobA").some((c) => c.name === "TextOnly"));
// Regression guard for the Phase 0 fix itself: renaming a contact (same id,
// different display name) must NOT orphan their job assignment or routing —
// this is exactly the bug that existed when matching was done by raw name.
const RENAMED_LINK = { contacts: [
  { id: "c_austin", name: "Austin B. Smith (was just Austin)", email: true },
], supersByJob: { jobA: ["c_austin"] } };
t("renaming a contact doesn't orphan their assignment (matched by id)",
  N.emailRecipients(RENAMED_LINK, "jobA").some((c) => c.id === "c_austin"));

console.log("quiet hours:");
t("9pm–7am is quiet", N.inQuietHours(22) && N.inQuietHours(3) && N.inQuietHours(6));
t("daytime not quiet", !N.inQuietHours(8) && !N.inQuietHours(20));

console.log("svix webhook signature (Resend bounce webhook):");
{
  const { createHmac, randomBytes } = require("crypto");
  const rawSecret = randomBytes(24);
  const secret = "whsec_" + rawSecret.toString("base64");
  const msgId = "msg_test123";
  const body = JSON.stringify({ type: "email.bounced", data: { to: ["gc@example.com"] } });
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const sig = createHmac("sha256", rawSecret).update(msgId + "." + ts + "." + body).digest("base64");
  t("valid signature passes", N.verifySvixSignature(secret, msgId, ts, body, "v1," + sig, now));
  t("multiple entries: any valid one passes (secret rotation)",
    N.verifySvixSignature(secret, msgId, ts, body, "v1,AAAAinvalid v1," + sig, now));
  t("tampered body fails", !N.verifySvixSignature(secret, msgId, ts, body + "x", "v1," + sig, now));
  t("wrong secret fails", !N.verifySvixSignature("whsec_" + randomBytes(24).toString("base64"), msgId, ts, body, "v1," + sig, now));
  t("stale timestamp fails (replay guard)", !N.verifySvixSignature(secret, msgId, String(Math.floor(now / 1000) - 3600), body,
    "v1," + createHmac("sha256", rawSecret).update(msgId + "." + String(Math.floor(now / 1000) - 3600) + "." + body).digest("base64"), now));
  t("missing header fails closed", !N.verifySvixSignature(secret, msgId, ts, body, "", now));
  t("non-v1 scheme entries ignored", !N.verifySvixSignature(secret, msgId, ts, body, "v2," + sig, now));
}

console.log(failures ? "\n" + failures + " FAILURES" : "\nALL PASS");
process.exit(failures ? 1 : 0);
