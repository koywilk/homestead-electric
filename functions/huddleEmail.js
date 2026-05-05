// Daily Huddle Email — auto-send at 6am MT, Mon–Fri
//
// Scheduled Cloud Function that mirrors the HuddleSheet view in App.js. For
// each foreman in settings/huddleConfig, computes their personal huddle and
// emails it via Resend's REST API, with both bosses CC'd. Recipients are
// configured in Firestore (settings/huddleConfig) so changes don't require
// redeploys.
//
// DATA SAFETY: read-only on every collection. Only write is to a log doc
// (settings/huddleEmailLog) so we can confirm the cron actually fired.
//
// SETUP (one time):
//   1. Sign up at https://resend.com → create an API key
//        (Sending access permission, no domain restriction yet)
//   2. firebase functions:secrets:set RESEND_KEY
//        (interactive — paste the key when prompted; never lands in shell
//        history, never visible to functions:config:get, encrypted at rest)
//   3. Configure recipients in the app (Settings → Daily Huddle Email)
//   4. firebase deploy --only functions:dailyHuddleEmail,functions:sendTestHuddleEmail
//
// FROM address: defaults to onboarding@resend.dev (Resend's shared sender —
// works without domain verification). Once homesteadelectric.net is verified
// in Resend, change RESEND_FROM below to "Daily Huddle <huddle@homesteadelectric.net>".

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

// Default Resend sender. Works without any DNS setup. Swap once domain is
// verified — this is the only line that needs to change.
const RESEND_FROM = "Daily Huddle <onboarding@resend.dev>";

const TZ = "America/Denver";

// Today's calendar date in Mountain Time, returned as a Date anchored at
// noon UTC of that MT day. Anchoring at noon UTC is a clock-safe sweet
// spot: it's always inside the same calendar day whether you read the
// date in UTC (server local) or MT. Avoids the off-by-one that hits when
// you do `new Date()` + `setHours(0,0,0,0)` on a UTC server — that lands
// at MT 6pm "yesterday," which then formats wrong with timeZone:TZ.
function getMTToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return new Date(`${y}-${m}-${d}T12:00:00Z`);
}

// ─── Status definitions (ported from src/App.js) ────────────────────────
const ROUGH_STATUSES = [
  { value:"",            label:"— set status —" },
  { value:"waiting_date",label:"Awaiting Start Date" },
  { value:"date_confirmed", label:"Start Date Set" },
  { value:"scheduled",   label:"Scheduled" },
  { value:"inprogress",  label:"In Progress" },
  { value:"waiting",     label:"On Hold" },
  { value:"complete",    label:"Complete" },
];
const FINISH_STATUSES = ROUGH_STATUSES;
const TEMP_PED_STATUSES = [
  { value:"",          label:"— set status —" },
  { value:"ready",     label:"Ready to Schedule" },
  { value:"scheduled", label:"Scheduled" },
  { value:"completed", label:"Completed" },
];
const QUICK_JOB_STATUSES = [
  { value:"new",       label:"New" },
  { value:"scheduled", label:"Scheduled" },
  { value:"inprogress",label:"In Progress" },
  { value:"complete",  label:"Complete" },
  { value:"invoice",   label:"Ready to Invoice" },
];
const QUICK_JOB_TYPES = [
  { value:"service",  label:"Service Call" },
  { value:"panel",    label:"Panel Upgrade" },
  { value:"tempped",  label:"Temp Ped Pickup" },
  { value:"other",    label:"Other" },
];

// ─── Helpers (ported from App.js) ───────────────────────────────────────
function toYMD(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function parseAnyDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const m2 = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m2) return new Date(+(m2[3].length===2?"20"+m2[3]:m2[3]), +m2[1]-1, +m2[2]);
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function fmtShortDate(dStr) {
  const d = parseAnyDate(dStr);
  return d ? d.toLocaleDateString("en-US", { month:"numeric", day:"numeric" }) : (dStr || "");
}
function effRS(j) {
  if (j.tempPed) {
    const s = j.tempPedStatus || "";
    if (s === "completed") return "complete";
    if (s === "scheduled") return "scheduled";
    if (s === "ready")     return "waiting_date";
    return "";
  }
  if (j.roughStatus) return j.roughStatus;
  const p = parseInt(j.roughStage) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
}
function effFS(j) {
  if (j.tempPed) return "";
  if (j.finishStatus) return j.finishStatus;
  const p = parseInt(j.finishStage) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
}
function matchesForeman(job, name) {
  const jf = (job.foreman || "").trim().toLowerCase();
  const n  = (name || "").trim().toLowerCase();
  if (!jf || !n) return false;
  if (jf === n) return true;
  if (n.startsWith(jf + " ") || jf.startsWith(n + " ")) return true;
  const parts = n.split(" ");
  return parts.some(p => p === jf || p.includes(jf) || jf.includes(p));
}
function walkPunchItems(punch, cb) {
  if (!punch) return;
  const eatFloor = (fl) => {
    if (!fl) return;
    (fl.general || []).forEach(cb);
    (fl.hotcheck || []).forEach(cb);
    (fl.rooms || []).forEach(r => (r.items || []).forEach(cb));
  };
  ["upper","main","basement"].forEach(k => eatFloor(punch[k]));
  (punch.extras || []).forEach(e => { if (e?.key) eatFloor(punch[e.key]); });
}
function isExcludedForeman(name) {
  const clean = (name || "").trim().toLowerCase();
  if (!clean) return false;
  if (/\btbd\b/.test(clean)) return true;
  return clean === "paul";
}

// ─── Data fetch (Firestore Admin SDK) ───────────────────────────────────
async function fetchHuddleData(db, targetDate) {
  // Jobs
  const jobsSnap = await db.collection("jobs").get();
  const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...(d.data().data || {}) }));

  // Manual tasks
  const tasksSnap = await db.collection("manualTasks").get();
  const manualTasks = tasksSnap.docs.map(d => d.data().data).filter(Boolean);

  // Crew Planner — settings/schedule_<mondayYMD>. Keep the same noon-UTC
  // anchor used everywhere else so day-of-week math and toYMD agree.
  const weekMon = new Date(targetDate);
  const day = weekMon.getUTCDay();
  weekMon.setUTCDate(weekMon.getUTCDate() - (day === 0 ? 6 : day - 1));
  const weekWK = toYMD(weekMon);
  const planSnap = await db.doc(`settings/schedule_${weekWK}`).get();
  const crewData = planSnap.exists ? (planSnap.data().assignments || {}) : {};

  // PTO
  const ptoSnap = await db.doc("settings/crewPTO").get();
  const ptoList = ptoSnap.exists ? (ptoSnap.data().list || []) : [];

  // Simpro schedule (read directly via Simpro REST API — same call the
  // getSimproSchedule callable makes, but in-process so we don't need a
  // self-callable round trip). Credentials match what's hardcoded in
  // index.js. If Koy moves these to functions:config later, swap to
  // functions.config().simpro?.base / .token.
  const SIMPRO_TOKEN = "402222413e886be0bda7bd5173aa8e215d34bcdb";
  const SIMPRO_BASE  = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
  const simproByJob = {};
  try {
    if (SIMPRO_BASE && SIMPRO_TOKEN) {
      const today = new Date();
      const from  = new Date(today); from.setMonth(from.getMonth() - 1);
      const to    = new Date(today); to.setMonth(to.getMonth() + 6);
      const url = `${SIMPRO_BASE}/schedules/?pageSize=250`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` }});
      if (resp.ok) {
        let all = await resp.json();
        all = all.filter(s => s.Type === "job"
          && s.Date >= toYMD(from) && s.Date <= toYMD(to));
        all.forEach(entry => {
          const pid = entry.Project?.ProjectID ? String(entry.Project.ProjectID) : null;
          const d = entry.Date;
          const staff = entry.Staff?.Name;
          if (!pid || !d) return;
          if (!simproByJob[pid]) simproByJob[pid] = { dates: new Set(), byDate: {} };
          simproByJob[pid].dates.add(d);
          if (staff) {
            if (!simproByJob[pid].byDate[d]) simproByJob[pid].byDate[d] = new Set();
            simproByJob[pid].byDate[d].add(staff);
          }
        });
        Object.keys(simproByJob).forEach(k => {
          simproByJob[k].dates = Array.from(simproByJob[k].dates).sort();
          Object.keys(simproByJob[k].byDate).forEach(d => {
            simproByJob[k].byDate[d] = Array.from(simproByJob[k].byDate[d]);
          });
        });
      }
    }
  } catch (e) {
    functions.logger.warn("Simpro fetch failed in huddle cron", { error: e.message });
  }

  return { jobs, manualTasks, crewData, ptoList, simproByJob, weekMon };
}

// ─── Huddle data computation (mirror of HuddleSheet's data useMemo) ─────
function computeHuddleData({ jobs, manualTasks, crewData, ptoList, simproByJob, targetDate, weekMon }) {
  const targetYMD = toYMD(targetDate);
  // Yesterday = previous workday
  const yDate = new Date(targetDate);
  do { yDate.setDate(yDate.getDate() - 1); } while (yDate.getDay() === 0 || yDate.getDay() === 6);
  const yesterdayYMD = toYMD(yDate);
  // Day idx within the loaded planner week
  let dayIdx = Math.round((targetDate - weekMon) / (24*60*60*1000));
  if (dayIdx < 0 || dayIdx >= 5) dayIdx = -1;

  const fnameFor = (j) => (j.foreman && j.foreman.trim()) || "Unassigned";
  const inScopeJob = (j) => !isExcludedForeman(j.foreman);
  const todayYMD = toYMD(new Date());
  const simproDateFor = (j) => {
    if (!j.simproNo) return null;
    const dates = simproByJob[String(j.simproNo)]?.dates;
    if (!dates || !dates.length) return null;
    return dates.find(d => d >= todayYMD) || null;
  };
  const simproStaffOn = (j, ymd) => {
    if (!j.simproNo || !ymd) return [];
    return simproByJob[String(j.simproNo)]?.byDate?.[ymd] || [];
  };

  // RECAP
  let punchClosedCount = 0;
  const punchClosedJobs = new Set();
  const punchClosedByForeman = {};
  const updatesPosted = [];
  const inspectionResults = [];

  jobs.filter(inScopeJob).forEach(j => {
    const jobName = j.name || "Untitled";
    const foreman = fnameFor(j);
    const checkClose = (item) => {
      if (!item || !item.done || item.voided || !item.checkedAt) return;
      const d = new Date(item.checkedAt);
      if (isNaN(d)) return;
      if (toYMD(d) === yesterdayYMD) {
        punchClosedCount++;
        punchClosedJobs.add(jobName);
        if (!punchClosedByForeman[foreman]) punchClosedByForeman[foreman] = { count:0, jobs:new Set() };
        punchClosedByForeman[foreman].count++;
        punchClosedByForeman[foreman].jobs.add(jobName);
      }
    };
    walkPunchItems(j.roughPunch, checkClose);
    walkPunchItems(j.finishPunch, checkClose);

    [["rough", j.roughUpdates], ["finish", j.finishUpdates]].forEach(([phase, ups]) => {
      (ups || []).forEach(u => {
        if (!u?.date) return;
        const d = new Date(u.date);
        if (!isNaN(d) && toYMD(d) === yesterdayYMD) {
          updatesPosted.push({ jobName, phase, foreman });
        }
      });
    });

    const checkAttempts = (attempts, type) => {
      (attempts || []).forEach(a => {
        if (!a || !a.result) return;
        const d = parseAnyDate(a.date);
        if (d && toYMD(d) === yesterdayYMD) {
          inspectionResults.push({ jobName, type, result: a.result, foreman });
        }
      });
    };
    checkAttempts(j.roughInspectionAttempts, "Rough/4-Way");
    checkAttempts(j.finalInspectionAttempts, "Final");
    if (j.qcStatus && ["pass","fail","fixed","completed"].includes(j.qcStatus) && j.qcStatusDate) {
      const d = parseAnyDate(j.qcStatusDate);
      if (d && toYMD(d) === yesterdayYMD) {
        inspectionResults.push({ jobName, type: "QC Walk", result: j.qcStatus, foreman });
      }
    }
  });

  // CREWS — merge manual planner cells with Simpro staff
  const crewToday = [];
  if (dayIdx >= 0) {
    jobs.filter(inScopeJob).forEach(j => {
      const cell = crewData[`${j.id}_${dayIdx}`] || {};
      const lead = cell.lead || null;
      const manualCrew = cell.crew || [];
      const simproPeople = simproStaffOn(j, targetYMD);
      const seen = new Set();
      const mergedCrew = [];
      if (lead) seen.add(lead.toLowerCase().split(" ")[0]);
      manualCrew.forEach(p => {
        const k = p.toLowerCase().split(" ")[0];
        if (!seen.has(k)) { seen.add(k); mergedCrew.push(p); }
      });
      simproPeople.forEach(p => {
        const k = p.toLowerCase().split(" ")[0];
        if (!seen.has(k)) { seen.add(k); mergedCrew.push(p); }
      });
      const total = (lead ? 1 : 0) + mergedCrew.length;
      if (total === 0) return;
      crewToday.push({
        jobName: j.name || "Untitled",
        lead, crew: mergedCrew, time: cell.time || null, foreman: fnameFor(j),
      });
    });
  }

  // INSPECTIONS + PENDING RESULTS
  const inspections = [];
  const pendingResults = [];
  jobs.filter(inScopeJob).forEach(j => {
    const jobName = j.name || "Untitled";
    const foreman = fnameFor(j);
    const checkDate = (dStr, type, hasResult) => {
      if (!dStr) return;
      const d = parseAnyDate(dStr); if (!d) return;
      const ymd = toYMD(d);
      if (ymd === targetYMD && !hasResult) {
        inspections.push({ jobName, type, foreman });
      } else if (ymd < targetYMD && !hasResult) {
        pendingResults.push({ jobName, type, scheduledDate: dStr, foreman });
      }
    };
    checkDate(j.fourWayTargetDate, "Rough/4-Way", !!j.roughInspectionResult);
    checkDate(j.finalInspectionTargetDate, "Final", !!j.finalInspectionResult);
    if (j.qcStatus === "scheduled" && j.qcStatusDate) {
      checkDate(j.qcStatusDate, "QC Walk", false);
    }
  });

  // ACTIVE ROUGH/FINISH (Simpro-driven date)
  const PHASE_PRIORITY = { waiting_date:0, date_confirmed:1, inprogress:2, scheduled:3, waiting:4 };
  const activePhases = [];
  jobs.filter(inScopeJob).forEach(j => {
    if (j.tempPed || j.quickJob) return;
    const foreman = fnameFor(j);
    const jobName = j.name || "Untitled";
    const simproDate = simproDateFor(j);
    const addPhase = (phase, eff) => {
      if (!eff || eff === "complete" || eff === "invoice") return;
      let dateOrLabel;
      if (eff === "waiting") dateOrLabel = "On Hold";
      else if (simproDate) dateOrLabel = fmtShortDate(simproDate);
      else dateOrLabel = "Not on Schedule";
      activePhases.push({ jobName, phase, foreman, statusKey: eff, dateOrLabel });
    };
    addPhase("Rough", effRS(j));
    addPhase("Finish", effFS(j));
  });
  activePhases.sort((a,b) => {
    const pa = PHASE_PRIORITY[a.statusKey] ?? 9;
    const pb = PHASE_PRIORITY[b.statusKey] ?? 9;
    if (pa !== pb) return pa - pb;
    if (a.phase !== b.phase) return a.phase === "Rough" ? -1 : 1;
    return a.jobName.localeCompare(b.jobName);
  });

  // QC + Matterport scheduling buckets
  const qcNeeds = [], qcScheduled = [];
  const matterNeeds = [], matterScheduled = [];
  jobs.filter(inScopeJob).forEach(j => {
    const jobName = j.name || "Untitled";
    const foreman = fnameFor(j);
    if (j.qcStatus === "needs") qcNeeds.push({ jobName, foreman, byDate: j.qcStatusDate || "" });
    else if (j.qcStatus === "scheduled" && j.qcStatusDate) qcScheduled.push({ jobName, foreman, date: j.qcStatusDate });
    const hasScan = !!(j.matterportLinks?.length || j.matterportLink);
    if (!hasScan) {
      if (j.matterportStatus === "needs") matterNeeds.push({ jobName, foreman, byDate: j.matterportStatusDate || "" });
      else if (j.matterportStatus === "scheduled" && j.matterportStatusDate) matterScheduled.push({ jobName, foreman, date: j.matterportStatusDate });
    }
  });

  // Temp peds / Quick jobs
  const smallJobs = [];
  jobs.filter(inScopeJob).forEach(j => {
    const jobName = j.name || "Untitled";
    const foreman = fnameFor(j);
    if (j.tempPed) {
      const status = j.tempPedStatus || "";
      if (!status || status === "completed") return;
      const def = TEMP_PED_STATUSES.find(s => s.value === status);
      const dateBit = (status === "scheduled" && j.tempPedScheduledDate) ? ` (${j.tempPedScheduledDate})` : "";
      smallJobs.push({ jobName, kind:"Temp Ped", status: def?def.label:status, dateBit, foreman });
    } else if (j.quickJob) {
      const status = j.quickJobStatus || "new";
      if (status === "complete" || status === "invoice") return;
      const def = QUICK_JOB_STATUSES.find(s => s.value === status);
      const typeDef = QUICK_JOB_TYPES.find(t => t.value === j.quickJobType);
      const dateBit = (status === "scheduled" && j.quickJobDate) ? ` (${j.quickJobDate})` : "";
      smallJobs.push({ jobName, kind: typeDef?typeDef.label:"Quick Job", status: def?def.label:status, dateBit, foreman });
    }
  });

  // Open punch + RT
  const punchSummary = [];
  jobs.filter(inScopeJob).forEach(j => {
    let openPunch = 0;
    walkPunchItems(j.roughPunch,  i => { if (i && !i.done && !i.voided) openPunch++; });
    walkPunchItems(j.finishPunch, i => { if (i && !i.done && !i.voided) openPunch++; });
    let rtToday = false, rtNeeds = false;
    (j.returnTrips || []).forEach(rt => {
      if (rt.signedOff || rt.rtStatus === "complete") return;
      if (rt.rtStatus === "needs") rtNeeds = true;
      const dStr = rt.rtStatusDate || rt.date;
      if (dStr) {
        const d = parseAnyDate(dStr);
        if (d && toYMD(d) === targetYMD) rtToday = true;
      }
    });
    if (openPunch > 0 || rtToday || rtNeeds) {
      punchSummary.push({ jobName: j.name || "Untitled", openPunch, rtToday, rtNeeds, foreman: fnameFor(j) });
    }
  });
  punchSummary.sort((a,b) => {
    if (a.rtToday !== b.rtToday) return a.rtToday ? -1 : 1;
    if (a.rtNeeds !== b.rtNeeds) return a.rtNeeds ? -1 : 1;
    return b.openPunch - a.openPunch;
  });

  // Tasks (manual only — auto-task port deferred; manual tasks already cover
  // user-added items. Auto prompts like "Confirm Rough Start Date" still show
  // up in the in-app huddle but aren't in the email yet.)
  const allClearedTaskIds = new Set(jobs.flatMap(j => j.clearedTasks || []));
  const allTaskDueDates = jobs.reduce((acc,j) => ({ ...acc, ...(j.taskDueDates || {}) }), {});
  const SKIP_TASK_CAT = new Set(["qc","rt","tempped"]);
  const openTasks = (manualTasks || [])
    .filter(t => t && !t.cleared && t.status !== "completed" && !allClearedTaskIds.has(t.id))
    .filter(t => {
      if (SKIP_TASK_CAT.has(t.category)) return false;
      if (isExcludedForeman(t.foreman)) return false;
      if (t.jobId) {
        const j = jobs.find(x => x.id === t.jobId);
        if (j && isExcludedForeman(j.foreman)) return false;
      }
      return true;
    });

  // PTO
  const ptoOut = [];
  const targetDateObj = new Date(targetDate); targetDateObj.setHours(0,0,0,0);
  (ptoList || []).forEach(p => {
    if (!p?.name) return;
    const s = parseAnyDate(p.start);
    const e = parseAnyDate(p.end || p.start);
    if (!s) return;
    s.setHours(0,0,0,0); if (e) e.setHours(0,0,0,0);
    const lastDay = e || s;
    if (targetDateObj >= s && targetDateObj <= lastDay) {
      ptoOut.push({ name: p.name, note: p.note || "PTO" });
    }
  });
  ptoOut.sort((a,b) => a.name.localeCompare(b.name));

  // STUCK
  const STUCK_DAYS = 7;
  const nowMs = Date.now();
  const stuckCutoff = (() => {
    const d = new Date(); d.setDate(d.getDate() - STUCK_DAYS);
    return toYMD(d);
  })();
  const stuckItems = [];
  jobs.filter(inScopeJob).forEach(j => {
    const foreman = fnameFor(j);
    const jobName = j.name || "Untitled";
    const checkPunch = (item, phase) => {
      if (!item || item.done || item.voided || !item.addedAt) return;
      if (item.addedAt > stuckCutoff) return;
      const dt = parseAnyDate(item.addedAt); if (!dt) return;
      stuckItems.push({ kind:"punch", jobName, phase, days: Math.floor((nowMs - dt.getTime())/(24*60*60*1000)), foreman });
    };
    walkPunchItems(j.roughPunch,  i => checkPunch(i, "Rough"));
    walkPunchItems(j.finishPunch, i => checkPunch(i, "Finish"));
    (j.returnTrips || []).forEach(rt => {
      if (rt.signedOff || rt.rtStatus === "complete") return;
      const dStr = rt.rtStatusDate || rt.date;
      if (!dStr) return;
      const dt = parseAnyDate(dStr); if (!dt) return;
      if (toYMD(dt) > stuckCutoff) return;
      stuckItems.push({ kind:"rt", jobName, days: Math.floor((nowMs - dt.getTime())/(24*60*60*1000)), foreman });
    });
  });
  openTasks.forEach(t => {
    if (!t.dueDate) return;
    const dt = parseAnyDate(t.dueDate); if (!dt) return;
    if (toYMD(dt) > stuckCutoff) return;
    let foreman = t.foreman || "Unassigned";
    if (t.jobId) {
      const jj = jobs.find(x => x.id === t.jobId);
      if (jj) foreman = fnameFor(jj);
    }
    stuckItems.push({ kind:"task", jobName: t.jobName || "(no job)", title: t.title || "", days: Math.floor((nowMs - dt.getTime())/(24*60*60*1000)), foreman });
  });

  return {
    targetYMD, yesterdayYMD,
    punchClosedCount, punchClosedJobs: Array.from(punchClosedJobs), punchClosedByForeman,
    updatesPosted, inspectionResults,
    crewToday, inspections, pendingResults, activePhases,
    qcNeeds, qcScheduled, matterNeeds, matterScheduled,
    smallJobs, punchSummary, openTasks, ptoOut, stuckItems,
  };
}

// ─── Text rendering (per-foreman block, mirrors HuddleSheet) ────────────
function renderHuddleText({ data, scope, jobs, targetDate, dateLabel, dayName, recapDow }) {
  const labelForResult = (r) => {
    const k = (r || "").toLowerCase();
    if (k === "pass" || k === "fixed" || k === "completed") return "PASS";
    if (k === "fail") return "FAIL";
    return (r || "").toUpperCase();
  };
  const renderCrew = (c) => {
    const people = [];
    if (c.lead) people.push(c.lead.split(" ")[0]);
    c.crew.forEach(p => people.push(p.split(" ")[0]));
    const peopleStr = people.length > 4 ? `${people.slice(0,3).join(", ")} +${people.length-3}` : people.join(", ");
    const timeStr = c.time ? ` · ${c.time}` : "";
    return `${c.jobName} — ${peopleStr || "(no names)"}${timeStr}`;
  };
  const renderTask = (t) => {
    const job = t.jobName ? ` [${t.jobName.substring(0,18)}]` : "";
    const title = (t.title || "(no title)").substring(0, 44);
    let due = "";
    if (t.dueDate) {
      const d = parseAnyDate(t.dueDate);
      if (d) {
        const dYMD = toYMD(d);
        if (dYMD < data.targetYMD) due = ", overdue";
        else if (dYMD === data.targetYMD) due = ", today";
      }
    }
    return `${title}${job}${due}`;
  };

  // Fuzzy match: handles "Koy" vs "Koy Wilkinson" both ways, and any
  // first-name-shared variant. Mirrors the in-app matchesForeman helper so
  // the huddleConfig name doesn't have to be spelled identically to the
  // foreman field stored on each job.
  const matchForeman = (itemForeman, f) => {
    const a = (itemForeman || "Unassigned").trim().toLowerCase();
    const b = (f || "").trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.startsWith(b + " ") || b.startsWith(a + " ")) return true;
    // First-name share: "Koy" ↔ "Koy Wilkinson"
    if (a.split(" ")[0] === b.split(" ")[0]) return true;
    return false;
  };
  const taskBelongsTo = (t, f) => {
    if (matchForeman(t.foreman, f)) return true;
    if (t.jobId) {
      const j = jobs.find(x => x.id === t.jobId);
      if (j && matchesForeman(j, f)) return true;
    }
    if (!t.foreman && f === "Unassigned") return true;
    return false;
  };

  function renderForemanBlock(f) {
    const blk = [];
    // Fuzzy match — handles "Koy" vs "Koy Wilkinson" between huddleConfig
    // and the foreman field stored on each job. Without this, the strict
    // equality check returned no items if the names were spelled
    // differently in the two places.
    const onlyMine = (item) => matchForeman(item.foreman, f);

    // STUCK
    const stuckMine = data.stuckItems.filter(onlyMine);
    if (stuckMine.length) {
      blk.push(`STUCK 7+ DAYS (${stuckMine.length})`);
      const punchGroups = {}, rtItems = [], taskItems = [];
      stuckMine.forEach(s => {
        if (s.kind === "punch") {
          const key = `${s.jobName}|${s.phase}`;
          if (!punchGroups[key]) punchGroups[key] = { jobName:s.jobName, phase:s.phase, count:0, oldest:0 };
          punchGroups[key].count++;
          if (s.days > punchGroups[key].oldest) punchGroups[key].oldest = s.days;
        } else if (s.kind === "rt") rtItems.push(s);
        else if (s.kind === "task") taskItems.push(s);
      });
      Object.values(punchGroups).forEach(g => blk.push(`- ${g.jobName} — ${g.count} ${g.phase.toLowerCase()} punch open (oldest ${g.oldest}d)`));
      rtItems.forEach(r => blk.push(`- ${r.jobName} — RT past due ${r.days}d`));
      taskItems.forEach(t => blk.push(`- ${t.jobName} — ${(t.title||"(task)").substring(0,30)} (${t.days}d overdue)`));
      blk.push("");
    }

    // RECAP — aggregate punch counts under any name that fuzzy-matches f.
    // Jobs may store foreman as "Koy" or "Koy Wilkinson"; both buckets
    // should roll up under whichever scope was passed in.
    let punchByMe = null;
    for (const name of Object.keys(data.punchClosedByForeman)) {
      if (!matchForeman(name, f)) continue;
      const agg = data.punchClosedByForeman[name];
      if (!punchByMe) punchByMe = { count: 0, jobs: new Set() };
      punchByMe.count += agg.count;
      const jobsList = agg.jobs instanceof Set ? Array.from(agg.jobs) : agg.jobs;
      jobsList.forEach(j => punchByMe.jobs.add(j));
    }
    const updatesMine = data.updatesPosted.filter(onlyMine);
    const inspMine = data.inspectionResults.filter(onlyMine);
    if (punchByMe || updatesMine.length || inspMine.length) {
      blk.push(`RECAP — ${recapDow}`);
      if (punchByMe) {
        const jbs = Array.from(punchByMe.jobs);
        const lbl = jbs.length <= 3 ? jbs.join(", ") : `${jbs.length} jobs`;
        blk.push(`- ${punchByMe.count} punch closed (${lbl})`);
      }
      updatesMine.slice(0,4).forEach(u => blk.push(`- ${u.jobName} — ${u.phase} update logged`));
      inspMine.forEach(i => blk.push(`- ${i.jobName} — ${i.type} ${labelForResult(i.result)}`));
      blk.push("");
    }

    // CREWS
    const crewMine = data.crewToday.filter(onlyMine);
    if (crewMine.length) {
      blk.push(`${dayName} CREWS`);
      crewMine.forEach(c => blk.push(`- ${renderCrew(c)}`));
      blk.push("");
    }

    // INSPECTIONS today
    const ispMine = data.inspections.filter(onlyMine);
    if (ispMine.length) {
      blk.push(`INSPECTIONS — ${dayName} (${ispMine.length})`);
      ispMine.forEach(i => blk.push(`- ${i.jobName} — ${i.type}`));
      blk.push("");
    }
    // PENDING RESULTS
    const pendMine = data.pendingResults.filter(onlyMine);
    if (pendMine.length) {
      blk.push(`PENDING RESULTS (${pendMine.length})`);
      pendMine.forEach(p => blk.push(`- ${p.jobName} — ${p.type} (${p.scheduledDate})`));
      blk.push("");
    }
    // ACTIVE
    const phaseMine = data.activePhases.filter(onlyMine);
    if (phaseMine.length) {
      blk.push(`ACTIVE ROUGH / FINISH (${phaseMine.length})`);
      phaseMine.forEach(a => blk.push(`- ${a.jobName} — ${a.phase}: ${a.dateOrLabel}`));
      blk.push("");
    }
    // QC
    const qcN = data.qcNeeds.filter(onlyMine);
    if (qcN.length) {
      blk.push(`QC — NEEDS SCHEDULING (${qcN.length})`);
      qcN.forEach(q => blk.push(`- ${q.jobName}${q.byDate ? ` — sched by ${q.byDate}` : ""}`));
      blk.push("");
    }
    const qcS = data.qcScheduled.filter(onlyMine);
    if (qcS.length) {
      blk.push(`QC — SCHEDULED (${qcS.length})`);
      qcS.forEach(q => blk.push(`- ${q.jobName} — ${q.date}`));
      blk.push("");
    }
    // MATTERPORT
    const matN = data.matterNeeds.filter(onlyMine);
    if (matN.length) {
      blk.push(`MATTERPORT — NEEDS SCHEDULING (${matN.length})`);
      matN.forEach(m => blk.push(`- ${m.jobName}${m.byDate ? ` — sched by ${m.byDate}` : ""}`));
      blk.push("");
    }
    const matS = data.matterScheduled.filter(onlyMine);
    if (matS.length) {
      blk.push(`MATTERPORT — SCHEDULED (${matS.length})`);
      matS.forEach(m => blk.push(`- ${m.jobName} — ${m.date}`));
      blk.push("");
    }
    // TEMP PEDS
    const small = data.smallJobs.filter(onlyMine);
    if (small.length) {
      blk.push(`TEMP PEDS / QUICK JOBS (${small.length})`);
      small.forEach(s => blk.push(`- ${s.jobName} — ${s.kind}: ${s.status}${s.dateBit}`));
      blk.push("");
    }
    // OPEN PUNCH / RT
    const punchMine = data.punchSummary.filter(onlyMine);
    if (punchMine.length) {
      blk.push(`OPEN PUNCH / RT (${punchMine.length})`);
      punchMine.slice(0,8).forEach(p => {
        const bits = [];
        if (p.rtToday) bits.push("RT today");
        if (p.rtNeeds) bits.push("RT needs sched");
        if (p.openPunch > 0) bits.push(`${p.openPunch} punch`);
        blk.push(`- ${p.jobName} — ${bits.join(", ")}`);
      });
      if (punchMine.length > 8) blk.push(`- ...and ${punchMine.length - 8} more`);
      blk.push("");
    }
    // TASKS
    const TASK_LABELS = [
      ["co", "CHANGE ORDERS"], ["po", "PURCHASE ORDERS"], ["invoice", "INVOICES"],
      ["rough", "ROUGH TASKS"], ["finish", "FINISH TASKS"], ["manual", "MANUAL TASKS"],
    ];
    const myTasks = data.openTasks.filter(t => taskBelongsTo(t, f));
    const knownCats = new Set(TASK_LABELS.map(([k]) => k));
    TASK_LABELS.forEach(([cat, lbl]) => {
      const list = myTasks.filter(t => (t.category || "manual") === cat);
      if (!list.length) return;
      blk.push(`${lbl} (${list.length})`);
      list.slice(0, 10).forEach(t => blk.push(`- ${renderTask(t)}`));
      if (list.length > 10) blk.push(`- ...and ${list.length - 10} more`);
      blk.push("");
    });
    const otherTasks = myTasks.filter(t => !knownCats.has(t.category || "manual"));
    if (otherTasks.length) {
      blk.push(`OTHER TASKS (${otherTasks.length})`);
      otherTasks.slice(0, 10).forEach(t => blk.push(`- ${renderTask(t)}`));
      blk.push("");
    }

    while (blk.length && blk[blk.length-1] === "") blk.pop();
    return blk;
  }

  // Top-level message
  const out = [];
  out.push(`HUDDLE — ${dateLabel} (${(scope || "ALL").split(" ")[0].toUpperCase()})`);
  out.push("");
  if (data.ptoOut.length) {
    out.push(`OUT ${dayName} (${data.ptoOut.length})`);
    data.ptoOut.forEach(p => {
      const tag = p.note && p.note.toLowerCase() !== "pto" ? p.note : "PTO";
      out.push(`- ${p.name.split(" ")[0]} (${tag})`);
    });
    out.push("");
  }
  const block = renderForemanBlock(scope);
  if (block.length === 0) out.push("(nothing to report)");
  else out.push(...block);
  return out.join("\n");
}

// ─── Email send via Resend REST API ─────────────────────────────────────
// Replaces the previous nodemailer/Gmail SMTP path. Why: Google Workspace
// blocks app passwords on this org's plan, and OAuth setup is heavier than
// it's worth for 3 emails/day. Resend's free tier covers 3,000 emails/month
// and gives us a stable transactional sender. The API key lives in
// functions:config (resend.key) — never in source.
async function sendOneEmail({ to, cc, subject, body, apiKey }) {
  const ccList = Array.isArray(cc) ? cc.filter(Boolean) : (cc ? [cc] : []);
  const payload = {
    from: RESEND_FROM,
    to:   Array.isArray(to) ? to : [to],
    subject,
    text: body,
  };
  if (ccList.length) payload.cc = ccList;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json().catch(() => ({}));
}

// ─── The scheduled function ─────────────────────────────────────────────
exports.dailyHuddleEmail = functions
  .runWith({ secrets: ["RESEND_KEY"] })
  .pubsub.schedule("0 6 * * 1-5") // 6:00am Mon–Fri
  .timeZone(TZ)
  .onRun(async () => {
    const db = admin.firestore();

    // Load config
    const cfgSnap = await db.doc("settings/huddleConfig").get();
    if (!cfgSnap.exists) {
      functions.logger.warn("No settings/huddleConfig doc — skipping huddle email");
      return null;
    }
    const cfg = cfgSnap.data() || {};
    const foremen = cfg.foremen || [];
    const bosses  = cfg.bosses  || [];
    const apiKey = process.env.RESEND_KEY;
    if (!apiKey) {
      functions.logger.error("Resend API key missing — run: firebase functions:secrets:set RESEND_KEY");
      return null;
    }

    // Target date = today in Mountain Time. Cron fires Mon-Fri only so
    // "today" is always a workday — no weekend logic needed here.
    const target = getMTToday();

    const fetched = await fetchHuddleData(db, target);
    const data = computeHuddleData({ ...fetched, targetDate: target });

    const dateLabel = target.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:TZ });
    const dayName   = target.toLocaleDateString("en-US", { weekday:"short", timeZone:TZ }).toUpperCase();
    const yDate = parseAnyDate(data.yesterdayYMD);
    const recapDow = yDate ? yDate.toLocaleDateString("en-US", { weekday:"short", timeZone:TZ }).toUpperCase() : "";

    // Send one email per foreman
    const results = [];
    for (const fm of foremen) {
      if (!fm?.name || !fm?.email) continue;
      try {
        const text = renderHuddleText({
          data, scope: fm.name, jobs: fetched.jobs, targetDate: target,
          dateLabel, dayName, recapDow,
        });
        const cc = bosses.filter(b => b && b.toLowerCase() !== fm.email.toLowerCase());
        await sendOneEmail({
          to: fm.email,
          cc,
          subject: `Daily Huddle — ${fm.name.split(" ")[0]} — ${dateLabel}`,
          body: text,
          apiKey,
        });
        results.push({ foreman: fm.name, status: "sent" });
      } catch (e) {
        functions.logger.error("Huddle email failed", { foreman: fm.name, error: e.message });
        results.push({ foreman: fm.name, status: "error", error: e.message });
      }
    }

    // Log it so we can confirm next morning
    await db.doc("settings/huddleEmailLog").set({
      lastRun: admin.firestore.FieldValue.serverTimestamp(),
      results,
    }, { merge: true });

    return null;
  });

// ─── Test send (HTTPS callable) ─────────────────────────────────────────
// Runs the same data fetch + per-foreman text generation the cron does, but
// routes EVERY email to a single test address (defaults to the caller's
// auth email). Each email is subject-prefixed with [TEST] and body-prefixed
// with a "would normally go to..." header so it's visually distinct from
// production sends. Lets Koy verify the email format end-to-end without
// spamming the team.
exports.sendTestHuddleEmail = functions
  .runWith({ secrets: ["RESEND_KEY"] })
  .https.onCall(async (data) => {
  // No Firebase Auth gate — this app authenticates via its own PIN-based
  // identity stored in localStorage, so context.auth is always null. Calls
  // are gated by the API key being set via firebase functions:secrets:set
  // (only somebody with deploy access can put it there) and by the test
  // function only sending to the configured sender's inbox.
  const db = admin.firestore();

  const cfgSnap = await db.doc("settings/huddleConfig").get();
  if (!cfgSnap.exists) {
    throw new functions.https.HttpsError("failed-precondition",
      "No settings/huddleConfig doc — set up recipients in Settings first");
  }
  const cfg = cfgSnap.data() || {};
  const foremen = cfg.foremen || [];
  const bosses  = cfg.bosses  || [];
  const apiKey = process.env.RESEND_KEY;
  if (!apiKey) {
    throw new functions.https.HttpsError("failed-precondition",
      "Resend API key missing — run: firebase functions:secrets:set RESEND_KEY");
  }
  // Default test target = the configured sender (the email address you
  // signed up to Resend with). Resend's free tier with the default
  // onboarding@resend.dev sender will only deliver to that address until
  // you verify a domain. Client can override via data.to.
  const testTo = (data && data.to) || cfg.sender;
  if (!testTo) {
    throw new functions.https.HttpsError("failed-precondition",
      "No test recipient — set the Sender address in Settings or pass data.to");
  }
  if (!foremen.length) {
    throw new functions.https.HttpsError("failed-precondition",
      "No foremen configured — add at least one in Settings");
  }

  // Target = today in MT on weekdays (matches what this morning's 6am cron
  // would have produced). On weekends, advance to next Monday so the test
  // shows what the next cron run will deliver — otherwise Sat/Sun tests come
  // back "(nothing to report)" since no crew works the weekend.
  const target = getMTToday();
  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const fetched = await fetchHuddleData(db, target);
  const huddle = computeHuddleData({ ...fetched, targetDate: target });

  const dateLabel = target.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", timeZone:TZ });
  const dayName   = target.toLocaleDateString("en-US", { weekday:"short", timeZone:TZ }).toUpperCase();
  const yDate = parseAnyDate(huddle.yesterdayYMD);
  const recapDow = yDate ? yDate.toLocaleDateString("en-US", { weekday:"short", timeZone:TZ }).toUpperCase() : "";

  const results = [];
  for (const fm of foremen) {
    if (!fm || !fm.name || !fm.email) continue;
    try {
      const text = renderHuddleText({
        data: huddle, scope: fm.name, jobs: fetched.jobs, targetDate: target,
        dateLabel, dayName, recapDow,
      });
      const wouldCC = bosses.filter(b => b && b.toLowerCase() !== fm.email.toLowerCase());
      const header =
        `[TEST] In production this would go to:\n` +
        `   TO: ${fm.email}\n` +
        (wouldCC.length ? `   CC: ${wouldCC.join(", ")}\n` : "") +
        `\n` +
        `--- BEGIN HUDDLE BODY ---\n\n`;
      await sendOneEmail({
        to: testTo,
        cc: [], // no CC during testing — only the test address gets it
        subject: `[TEST] Daily Huddle — ${fm.name.split(" ")[0]} — ${dateLabel}`,
        body: header + text,
        apiKey,
      });
      results.push({ foreman: fm.name, status: "sent" });
    } catch (e) {
      functions.logger.error("Test huddle email failed", { foreman: fm.name, error: e.message });
      results.push({ foreman: fm.name, status: "error", error: e.message });
    }
  }

  return { sent: results.filter(r => r.status === "sent").length, results, to: testTo };
});
