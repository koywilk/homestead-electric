#!/usr/bin/env node
/* people-pull-readonly.js — READ-ONLY Firestore pull for the People / Automations mockup (dashboard audit, SW v582).
 * Writes JSON snapshots to the folder given as argv[2]. Nothing is written to Firestore.
 * Run: NODE_PATH=~/dev/homestead-electric/functions/node_modules node people-pull-readonly.js <outdir> */
const admin = require("firebase-admin"); const fs = require("fs"); const path = require("path");
const SA = "/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json";
admin.initializeApp({ credential: admin.credential.cert(require(SA)), projectId: "homestead-electric" });
const db = admin.firestore();
const OUT = process.argv[2]; if (!OUT) { console.error("outdir?"); process.exit(1); }
const W = (f, v) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(v));
const monday = (d) => { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return `${m.getFullYear()}-${String(m.getMonth()+1).padStart(2,"0")}-${String(m.getDate()).padStart(2,"0")}`; };
(async () => {
  const get = async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : null; };
  const wk = monday(new Date());
  W("settings_users.json", await get("settings/users") || {});
  W("settings_deviceVersions.json", await get("settings/deviceVersions") || {});
  W("settings_crewRoster.json", await get("settings/crewRoster") || {});
  W("settings_crewPTO.json", await get("settings/crewPTO") || {});
  W("settings_simproTotals.json", await get("settings/simproTotals") || {});
  W("settings_upcoming_jobs.json", await get("settings/upcoming_jobs") || {});
  const sched = await get("settings/schedule_" + wk); W("schedule_week.json", { monday: wk, doc: sched || null });
  const jobs = (await db.collection("jobs").get()).docs.map(d => { const x = d.data() || {}; return { id: d.id, ...(x.data || x) }; });
  W("jobs.json", jobs);
  const needs = (await db.collection("needs").get()).docs.map(d => { const x = d.data() || {}; return { id: d.id, ...(x.data || x) }; });
  W("needs.json", needs);
  const a = (sched && sched.assignments) || {};
  console.log("users", ((await get("settings/users")) || {}).list?.length, "jobs", jobs.length, "needs", needs.length, "week", wk, "cells", Object.keys(a).length, "devices", Object.keys(((await get("settings/deviceVersions")) || {}).devices || {}).length);
  console.log("sample cells:", JSON.stringify(Object.entries(a).slice(0, 4)));
  console.log("roster sample:", JSON.stringify((((await get("settings/crewRoster")) || {}).names || []).slice(0, 12)));
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
