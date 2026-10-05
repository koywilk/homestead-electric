// planIntake/digest.js — PURE builders for Phase 4 delivery (PLAN_INTAKE_SPEC.md,
// Koy 2026-10-04): the 5 pm summary email and the 6:30 am walk push. No I/O.
"use strict";

// Findings that need Koy, worst first. (co_candidate arrives with Phase 6.)
const NEEDS_YOU = ["co_candidate", "folder_conflict", "unmatched_plan", "walk_unmatched", "watcher_error"];
const LABEL = {
  co_candidate: "Possible CO", folder_conflict: "Two folders", unmatched_plan: "Plan not filed", walk_unmatched: "Walk not matched",
  watcher_error: "Plan intake error", plans_filed: "Plans filed", folder_created: "Folder made", folder_adopted: "Folder linked",
  folder_renamed: "Renamed on conversion", folder_linked: "Folder linked", walk_existing_job: "Walk on a job", quote_merged: "Quote folded into a job",
  quote_closed: "Quote closed",
};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const numLabel = (n) => { const s = String(n || ""); return !s ? "No number" : /^Q/i.test(s) ? `Quote #${s.slice(1)}` : `#${s}`; };

// findings → { needs: [...], groups: [{ number, rows }] } — needs first (by
// NEEDS_YOU order), then one group per job/quote number, busiest first.
function groupFindings(findings = []) {
  const live = findings.filter(f => f && f.type && f.mode !== "dry" && f.mode !== "test");
  const needs = live.filter(f => NEEDS_YOU.includes(f.type))
    .sort((a, b) => NEEDS_YOU.indexOf(a.type) - NEEDS_YOU.indexOf(b.type) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const by = new Map();
  for (const f of live.filter(f => !NEEDS_YOU.includes(f.type))) {
    const k = String(f.number || "");
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(f);
  }
  const groups = [...by].map(([number, rows]) => ({ number, rows: rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.number.localeCompare(b.number));
  return { needs, groups };
}

function digestEmail({ day, findings = [], appUrl = "https://homestead-electric.vercel.app" }) {
  const { needs, groups } = groupFindings(findings);
  const filed = groups.reduce((n, g) => n + g.rows.filter(r => r.type === "plans_filed").length, 0);
  const total = needs.length + groups.reduce((n, g) => n + g.rows.length, 0);
  const pretty = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const bits = [];
  if (filed) bits.push(`${filed} filed`);
  if (needs.length) bits.push(`${needs.length} need${needs.length === 1 ? "s" : ""} you`);
  if (!bits.length && total) bits.push(`${total} update${total === 1 ? "" : "s"}`);
  const subject = `Plans today: ${bits.join(" · ") || "nothing new"} (${pretty})`;
  const row = (f) => {
    const links = (f.links || []).map(l => `<a href="${esc(l.url)}" style="color:#2F6FC4">${esc(l.label)}</a>`).join(" · ");
    return `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;white-space:nowrap;color:#5B6B7E;font-size:12px">${esc(LABEL[f.type] || f.type)}</td>`
      + `<td style="padding:6px 0;font-size:14px;color:#16202C">${esc(f.summary)}${links ? `<div style="font-size:12px;margin-top:2px">${links}</div>` : ""}</td></tr>`;
  };
  const section = (title, rowsHtml, accent) => `<h3 style="margin:22px 0 6px;font:600 13px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${accent}">${esc(title)}</h3>`
    + `<table style="border-collapse:collapse;width:100%">${rowsHtml}</table>`;
  let html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px">`
    + `<h2 style="margin:0 0 4px;font-size:20px;color:#16202C">Plan intake — ${esc(pretty)}</h2>`
    + `<div style="color:#5B6B7E;font-size:14px">${esc(bits.join(" · ") || "Nothing new today.")}</div>`;
  if (needs.length) html += section("Needs you", needs.map(row).join(""), "#B3261E");
  for (const g of groups) html += section(numLabel(g.number), g.rows.map(row).join(""), "#2F6FC4");
  html += `<p style="margin-top:24px;font-size:12px;color:#5B6B7E">Everything here is also on the Plans card in <a href="${esc(appUrl)}/?view=today" style="color:#2F6FC4">Today</a>. Unsure plans are waiting in Job Plans / _Plan Inbox.</p></div>`;
  return { subject, html, total, needs: needs.length, filed };
}

// Walks happening today → one push. walks: planIntakeState walk docs
// ({ title, walkDate, status, quoteNo, jobNo }); quotes: { [quoteNo]: { folderName, filedCount } }.
function walkPush(walks = [], quotes = {}) {
  const today = walks.filter(w => w && w.title);
  if (!today.length) return null;
  const line = (w) => {
    if (w.status === "matched" && w.quoteNo) {
      const q = quotes[w.quoteNo] || {};
      const n = Number(q.filedCount) || 0;
      return `${w.title}: Quote #${w.quoteNo} folder ready${n ? ` · ${n} plan${n === 1 ? "" : "s"} in SIMPRO` : ""}`;
    }
    if (w.status === "existing_job" && w.jobNo) return `${w.title}: existing job #${w.jobNo}`;
    return `${w.title}: not matched yet`;
  };
  const title = today.length === 1 ? `Walk today: ${today[0].title}` : `${today.length} walks today`;
  return { title: title.slice(0, 80), body: today.map(line).join("\n").slice(0, 400) };
}

module.exports = { NEEDS_YOU, LABEL, groupFindings, digestEmail, walkPush, numLabel };
