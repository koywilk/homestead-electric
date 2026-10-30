// READ-ONLY live pull for the Overview audit mockup (v579). Reads jobs, users, needs,
// upcoming, simproTotals and this week's Crew Planner doc; writes JSON to the folder in argv[2].
// Run: NODE_PATH=~/dev/homestead-electric/functions/node_modules node docs/mockups/dashboard-audit/overview-pull-readonly.js <outdir>
const admin = require("firebase-admin"); const fs = require("fs");
const SA = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: "homestead-electric" });
const db = admin.firestore(); const OUT = (process.argv[2] || ".").replace(/\/?$/, "/");
const mondayKey = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,"0")}-${String(m.getDate()).padStart(2,"0")}`; };
(async () => {
  const w = (f, v) => fs.writeFileSync(OUT + f, JSON.stringify(v));
  const jobs = (await db.collection("jobs").get()).docs.map(d => ({ id: d.id, ...(d.data().data || {}) }));
  w("jobs.json", jobs);
  w("settings_users.json", (await db.doc("settings/users").get()).data() || {});
  w("needs.json", (await db.collection("needs").get()).docs.map(d => ({ id: d.id, ...d.data() })));
  w("settings_upcoming_jobs.json", (await db.doc("settings/upcoming_jobs").get()).data() || {});
  w("settings_simproTotals.json", (await db.doc("settings/simproTotals").get()).data() || null);
  const mk = mondayKey(new Date());
  const sched = (await db.doc("settings/schedule_" + mk).get()).data() || null;
  w("schedule.json", { monday: mk, doc: sched });
  const a = (sched && sched.assignments) || {};
  console.log("jobs", jobs.length, "schedule_" + mk, sched ? "exists" : "MISSING", "cells", Object.keys(a).length, "extraJobs", ((sched && sched.extraJobs) || []).length);
  console.log("cell sample:", JSON.stringify(Object.entries(a).slice(0, 3)));
  console.log("extra sample:", JSON.stringify(((sched && sched.extraJobs) || []).slice(0, 2)));
  console.log("doc keys:", Object.keys(sched || {}));
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
