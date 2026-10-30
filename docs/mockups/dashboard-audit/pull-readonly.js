#!/usr/bin/env node
// pull-readonly.js — READ-ONLY live pull for the Jobs / Activity dashboard-audit mockups (v580).
// Reads jobs, settings/users, needs, settings/simproTotals, settings/crewPTO and writes one JSON
// file to the path given as argv[2]. Never writes to Firestore.
// Run: NODE_PATH=~/dev/homestead-electric/functions/node_modules node docs/mockups/dashboard-audit/pull-readonly.js <out.json>
const admin = require("firebase-admin"); const fs = require("fs");
const SA = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
const out = process.argv[2]; if (!out) { console.error("usage: pull-readonly.js <out.json>"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: "homestead-electric" });
const db = admin.firestore();
(async () => {
  const jobs = (await db.collection("jobs").get()).docs.map(d => { const raw = d.data() || {}; const data = raw.data && typeof raw.data === "object" ? raw.data : raw; return { id: d.id, ...data }; });
  const usersDoc = (await db.doc("settings/users").get()).data() || {}; const users = usersDoc.list || [];
  const needs = (await db.collection("needs").get()).docs.map(d => (d.data() || {}).data).filter(Boolean);
  const simTotals = (await db.doc("settings/simproTotals").get()).data() || null;
  const pto = ((await db.doc("settings/crewPTO").get()).data() || {}).list || [];
  const upcoming = (await db.collection("upcoming").get().catch(() => ({ docs: [] }))).docs.map(d => { const raw = d.data() || {}; return { id: d.id, ...(raw.data || raw) }; });
  fs.writeFileSync(out, JSON.stringify({ pulledAt: new Date().toISOString(), jobs, users, needs, simTotals, pto, upcoming }));
  console.log("jobs", jobs.length, "users", users.length, "needs", needs.length, "upcoming", upcoming.length, "simTotals", simTotals ? Object.keys(simTotals.byNo || {}).length : 0);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
