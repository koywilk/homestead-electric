// simproShape.js — PURE helpers for the shapes Simpro hands back. Shared by
// functions/index.js (candidate refresh) and copied verbatim into src/App.js
// (importableAddress) — the CRA bundle can't require this file.
//
// Why this exists (2026-09-17): the Pending-jobs list (`/jobs/?columns=Site`)
// returns Site as a STUB — {ID, Name} and nothing else. The candidate refresh
// used to fall back to Site.Name for the address, and on this tenant the site
// name is very often the job name ("Wise Flooring"), so every imported job
// arrived with its own name in the address box and Koy had to clear it and
// re-pull. The pull path (_simproBasicsFrom) dropped that fallback on
// 2026-08-06; this brings the list path in line. A site name is never an
// address: blank + a siteId to resolve via /sites/{ID} is the honest answer.
"use strict";

function joinAddress(a) {
  if (!a) return "";
  if (typeof a === "string") return a.trim();
  if (typeof a === "object") return [a.Address, a.City, a.State, a.PostalCode].map(x => String(x || "").trim()).filter(Boolean).join(", ");
  return "";
}
// { address, siteId } — address only from an INLINE Site.Address; never Site.Name.
function candidateSiteInfo(site) {
  if (!site || typeof site !== "object") return { address: "", siteId: "" };
  return { address: joinAddress(site.Address), siteId: site.ID != null && site.ID !== "" ? String(site.ID) : "" };
}
// Client-side belt for candidates cached by the OLD refresh: an address that is
// just the job name imports as blank, so the auto-pull fills the real one.
function importableAddress(cand) {
  if (!cand) return "";
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = String(cand.address || "").trim();
  if (!a) return "";
  return norm(a) === norm(cand.name) ? "" : a;
}
module.exports = { candidateSiteInfo, importableAddress, joinAddress };
