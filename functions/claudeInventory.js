"use strict";
// claudeInventory.js — "Everything Claude runs" in the dashboard's Claude tab (SW v689).
// Koy, 2026-11-25: "any single thing that Claude is doing or helping with or automating...
// on a list the link to them and then I want a complete walkthrough of what that sheet does
// ... not being pulled yet" and "Include any that have been sent or shared with me too".
//
// The list is data (claudeInventory.json), kept server-side: some rows link to sheets with
// pay or dollar data, so the links never ship in the app bundle. claudeWork (admin PIN)
// sends it; rows marked koyOnly, and the whole "Shared with me" group, go to Koy alone.
// Pure: no Firebase import, so scripts/claude-inventory-test.js runs it under plain node.

const DATA = require("./claudeInventory.json");

const GROUPS = ["autos", "app", "files", "shared", "pages"];
const KOY_ONLY_GROUPS = new Set(["shared"]);
const LINK_OK = /^https:\/\/(docs\.google\.com\/(spreadsheets|document|forms)\/d\/[A-Za-z0-9_-]+\/edit|drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]+|claude\.ai\/artifact\/[A-Za-z0-9]+|homestead-electric\.(vercel\.app|web\.app)\/[a-z0-9/-]*)$/;
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// One row as the dashboard gets it. "pulled" defaults to true; automations use on/off instead.
function row(it) {
  const out = {
    id: str(it.id, 60), group: it.group, title: str(it.title, 140), what: str(it.what, 600), from: str(it.from, 400),
    when: str(it.when, 120), where: str(it.where, 60), note: str(it.note, 300), kind: str(it.kind, 20), owner: str(it.owner, 40),
    link: LINK_OK.test(it.link || "") ? it.link : "", money: !!it.money, koyOnly: !!it.koyOnly || KOY_ONLY_GROUPS.has(it.group),
  };
  if (it.group === "autos") out.on = it.on !== false;
  else out.pulled = it.pulled !== false;
  return out;
}

function inventoryFor(viewer, data) {
  const d = data || DATA;
  const isKoy = !!viewer && viewer.id === "koy";
  const items = (d.items || []).filter(it => it && GROUPS.includes(it.group)).map(row).filter(r => r.id && r.title && (isKoy || !r.koyOnly));
  const groups = (d.groups || []).filter(g => g && GROUPS.includes(g.k) && (isKoy || !KOY_ONLY_GROUPS.has(g.k)))
    .map(g => ({ k: g.k, label: str(g.label, 60), sub: str(g.sub, 120) }));
  return { checkedAt: str(d.checkedAt, 10), groups, items };
}

module.exports = { inventoryFor, row, GROUPS, KOY_ONLY_GROUPS, LINK_OK, DATA };
