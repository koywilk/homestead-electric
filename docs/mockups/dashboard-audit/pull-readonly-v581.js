#!/usr/bin/env node
// Read-only Firestore pull for the Schedule / Quality dashboard-audit mockups (v581).
// Reads jobs, users, needs, upcoming, simproTotals, crewPTO and the Crew Planner week
// docs (settings/schedule_<monday>) for this week and the next three. Writes nothing.
// Run: NODE_PATH=~/dev/homestead-electric/functions/node_modules node docs/mockups/dashboard-audit/pull-readonly.js <outdir>
const admin = require("firebase-admin"); const fs = require("fs"); const path = require("path");
const SA = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: "homestead-electric" });
const db = admin.firestore();
const OUT = process.argv[2] || process.cwd();
const mondayKey = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,"0")}-${String(m.getDate()).padStart(2,"0")}`; };
(async () => {
  const w = (f, v) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v));
  const jobs = (await db.collection("jobs").get()).docs.map(d => ({ id: d.id, ...(d.data().data || {}) }));
  w("jobs.json", jobs);
  const users = (await db.doc("settings/users").get()).data() || {};
  w("settings_users.json", users);
  const needs = (await db.collection("needs").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  w("needs.json", needs);
  w("settings_upcoming_jobs.json", (await db.doc("settings/upcoming_jobs").get()).data() || {});
  w("settings_simproTotals.json", (await db.doc("settings/simproTotals").get()).data() || {});
  w("settings_crewPTO.json", (await db.doc("settings/crewPTO").get()).data() || {});
  const sched = {}; const now = new Date();
  for (let i = -1; i < 5; i++) { const k = mondayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7*i)); const s = await db.doc("settings/schedule_" + k).get(); sched[k] = s.exists ? s.data() : null; }
  w("schedule_weeks.json", sched);
  console.log("jobs", jobs.length, "users", (users.list || []).length, "needs", needs.length, "pto", ((await db.doc("settings/crewPTO").get()).data() || {}).list?.length, "weeks", Object.entries(sched).map(([k, v]) => k + ":" + (v ? Object.keys(v.assignments || {}).length : "none")).join(" "));
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
