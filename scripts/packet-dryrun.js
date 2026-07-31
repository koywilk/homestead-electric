#!/usr/bin/env node
/* READ-ONLY dry-run of the NEW Friday Packet against real prod data.
 * Mirrors runFridayPacket (functions/index.js) steps 1-4 exactly — same reads,
 * same Simpro fetches, same pure builder (../functions/fridayPacket.js) — then
 * writes the rendered report to packet-dryrun.html at the repo root and prints
 * the resolved push recipients + section counts. It does NOT create a Drive
 * doc, does NOT push, and does NOT write the settings/fridayPacket state doc.
 * Writes nothing to Firestore. Re-run after every builder tweak until Koy
 * signs off, then deploy. */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(process.env.HOME, "Desktop/homestead-electric/functions/node_modules/firebase-admin"));
admin.initializeApp({ credential: admin.credential.cert(require("/Users/koyhomestead/Desktop/homestead-electric-firebase-adminsdk-fbsvc-e3fa8a404f.json")), projectId: "homestead-electric" });
const db = admin.firestore();

const packet = require(path.join(__dirname, "../functions/fridayPacket.js"));

// Simpro constants — same values as functions/index.js.
const SIMPRO_TOKEN = "402222413e886be0bda7bd5173aa8e215d34bcdb";
const SIMPRO_BASE  = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const TZ = packet.TZ;

(async () => {
  const now = new Date();
  const mtNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const today = new Date(mtNow.getFullYear(), mtNow.getMonth(), mtNow.getDate());
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
  const nextFriday = new Date(nextMonday); nextFriday.setDate(nextMonday.getDate() + 4);
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const windowStart = ymdOf(monday), windowEnd = ymdOf(nextFriday);

  // 1 · Firestore reads (jobs are wrapped; keep top-level lastActivityAt).
  console.log("Reading Firestore…");
  const [snap, upSnap, planSnap, ptoSnap, stateSnap, usersSnap] = await Promise.all([
    db.collection("jobs").get(),
    db.doc("settings/upcoming_jobs").get(),
    db.doc(`settings/schedule_${ymdOf(nextMonday)}`).get(),
    db.doc("settings/crewPTO").get(),
    db.doc("settings/fridayPacket").get(),
    db.doc("settings/users").get(),
  ]);
  const jobs = snap.docs.map(d => {
    const raw = d.data() || {};
    return { id: d.id, ...(raw.data || {}), lastActivityAt: raw.lastActivityAt || null };
  });
  const upcoming = upSnap.exists ? (upSnap.data().items || upSnap.data().list || []) : [];
  const plannerDoc = planSnap.exists ? planSnap.data() : null;
  const pto = ptoSnap.exists ? (ptoSnap.data().list || []) : [];
  const prevState = stateSnap.exists ? stateSnap.data() : null;
  const users = (usersSnap.exists && usersSnap.data().list) ? usersSnap.data().list : [];
  console.log(`  ${jobs.length} jobs · ${upcoming.length} upcoming · planner ${plannerDoc ? "FOUND" : "none"} for ${ymdOf(nextMonday)} · ${pto.length} PTO entries · state doc ${prevState ? "exists" : "none (first run)"}`);

  // 2 · Simpro schedules, filtered to this-Mon..next-Fri.
  console.log("Fetching Simpro schedules…");
  let scheduleEntries = [];
  try {
    let page = 1;
    while (page <= 60) {
      const resp = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}`, {
        headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` },
      });
      if (!resp.ok) { console.warn(`  schedules page ${page} → ${resp.status}`); break; }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      scheduleEntries.push(...batch);
      if (batch.length < 250) break;
      page++;
    }
    const all = scheduleEntries.length;
    scheduleEntries = scheduleEntries.filter(s => s && s.Date && s.Date >= windowStart && s.Date <= windowEnd);
    console.log(`  ${all} entries fetched → ${scheduleEntries.length} in window ${windowStart}..${windowEnd}`);
  } catch (e) {
    console.warn("  schedules fetch failed:", e.message, "— continuing planner-only");
    scheduleEntries = [];
  }

  // 3 · Bounded live Totals fetch for ready-to-invoice + margin-watch jobs.
  const simproTotalsById = {};
  const wanted = packet.collectSimproCandidates(jobs);
  console.log(`Fetching Simpro Totals for ${wanted.length} jobs (concurrency 5)…`);
  const CHUNK = 5;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    await Promise.all(wanted.slice(i, i + CHUNK).map(async (sn) => {
      try {
        const resp = await fetch(`${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(sn)}&pageSize=1&columns=ID,Total,Totals`, {
          headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` },
        });
        if (!resp.ok) return;
        const results = await resp.json();
        const sj = Array.isArray(results) ? results[0] : null;
        if (!sj) return;
        const t = sj.Totals || {};
        const actual = t.NettMargin?.Actual ?? null;
        const estimate = t.NettMargin?.Estimate ?? null;
        const hasRealActual = actual !== null && actual !== 100;
        const top = sj.Total || {};
        simproTotalsById[sn] = {
          total: (typeof top.IncTax === "number") ? top.IncTax : (typeof t.IncTax === "number" ? t.IncTax : null),
          margin: hasRealActual ? actual : estimate,
          isEstimate: !hasRealActual,
        };
      } catch (e) { /* cache fallback, same as prod */ }
    }));
  }
  console.log(`  got Totals for ${Object.keys(simproTotalsById).length}/${wanted.length}`);

  // 4 · Build + render with the SAME pure module prod uses.
  const model = packet.buildModel({ jobs, upcoming, plannerDoc, scheduleEntries, pto, users, prevState, simproTotalsById, now });
  const html = packet.renderHtml(model);
  const outPath = path.join(__dirname, "..", "packet-dryrun.html");
  fs.writeFileSync(outPath, html);

  // ── report ──
  console.log("\n===== HEADLINE =====");
  model.headline.forEach(l => console.log("  " + l));

  console.log("\n===== SECTION COUNTS =====");
  if (!model.money.error) {
    const mo = model.money;
    console.log(`  Ready to invoice: ${mo.rti.count} (showing ${mo.rti.rows.length}, $${Math.round(mo.rti.total).toLocaleString()} known across ${mo.rti.knownCount})`);
    console.log(`  Margin watch:     median ${mo.margin.median}% over ${mo.margin.count} finishing jobs · ${mo.margin.underCount} under ${packet.MARGIN_TARGET}%`);
    console.log(`  Billed diff:      ${mo.billed.firstRun ? "first run — tracking starts now" : mo.billed.rows.length + " since last packet"}`);
    console.log(`  Pipeline:         ${mo.pipeline.quotes} quotes${mo.pipeline.oldestQuoteDays != null ? ` (oldest ${mo.pipeline.oldestQuoteDays}d)` : ""} · ${mo.pipeline.upcoming} upcoming (${mo.pipeline.upcomingWithDates} dated)`);
  } else console.log("  MONEY PILLAR FAILED");
  if (!model.blockers.error) {
    console.log(`  Blockers:         ${model.blockers.total} total → showing ${model.blockers.rows.length}`);
    model.blockers.rows.forEach((r, i) => console.log(`    ${i + 1}. [${r.score}] ${r.jobName} — ${r.what}`));
  } else console.log("  BLOCKERS PILLAR FAILED");
  if (!model.weekAhead.error) {
    const wa = model.weekAhead;
    console.log(`  Week ahead:       ${wa.crewed.total} jobs crewed · ${wa.gaps.riskCount} starts at risk · ${wa.gaps.ptoCount} PTO · ${wa.conflicts.rows.length} double-booked${wa.nothingBooked ? "  (NOTHING BOOKED)" : ""}`);
  } else console.log("  WEEK-AHEAD PILLAR FAILED");

  console.log("\n===== PUSH RECIPIENTS (would receive, pref-gated) =====");
  const recips = packet.resolveRecipients(users);
  recips.forEach(r => {
    const muted = r.user.notifPrefs && r.user.notifPrefs.friday_packet === false;
    console.log(`  ${r.user.name}  (${r.reason})${muted ? "  — MUTED via friday_packet pref" : ""}`);
  });
  if (!recips.length) console.log("  (nobody resolved — check settings/users roles)");

  console.log(`\nWrote ${outPath}`);
  console.log("READ-ONLY — nothing written to Firestore, Drive, or push.");
  process.exit(0);
})().catch(e => { console.error("ERR", e.message, e.stack); process.exit(1); });
