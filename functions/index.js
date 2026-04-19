// Homestead Electric — Firebase Cloud Functions
// All push notification logic lives here.
// Deploy with: firebase deploy --only functions

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
admin.initializeApp();

const db        = admin.firestore();
const messaging = admin.messaging();

// ─── Timezone for scheduled functions ────────────────────────
const TZ = "America/Denver"; // Mountain Time

// ─── Prep stage that means "done" ────────────────────────────
const PREP_COMPLETE = "Job Prep Complete";

/** Returns true if all 5 prep checklist items are checked (backward compat with old prepStage) */
function allPrepDone(job) {
  if (job.prepChecklist) {
    const c = job.prepChecklist;
    return !!(c.redlinePlans && c.cabinetPlans && c.applianceSpecs && c.plansUploaded && c.readyToHandOff);
  }
  return (job.prepStage || "") === PREP_COMPLETE;
}

async function getUsers() {
  const snap = await db.doc("settings/users").get();
  return (snap.exists && snap.data().list) ? snap.data().list : [];
}

function getTokens(user) {
  const tokens = [];
  if (Array.isArray(user.fcmTokens)) tokens.push(...user.fcmTokens);
  if (user.fcmToken && !tokens.includes(user.fcmToken)) tokens.push(user.fcmToken);
  // Dedupe — a user with the same token saved in both fcmTokens[] and fcmToken,
  // or duplicated entries in fcmTokens[], would otherwise receive the same push
  // 2-3 times. This was the Android "triple-notification" bug.
  return Array.from(new Set(tokens.filter(Boolean)));
}

// Token error codes that mean the token is permanently dead and should be purged.
const STALE_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
];

/** Remove a single bad token from every user record in settings/users. */
async function removeStaleToken(token) {
  try {
    const snap = await db.doc("settings/users").get();
    if (!snap.exists) return;
    const list = (snap.data().list || []).map(u => ({
      ...u,
      fcmTokens: (u.fcmTokens || []).filter(t => t !== token),
      fcmToken:  u.fcmToken === token ? "" : (u.fcmToken || ""),
    }));
    await db.doc("settings/users").set({ list });
    functions.logger.info("Removed stale FCM token", { token: token.slice(0, 20) });
  } catch (e) {
    functions.logger.warn("Failed to remove stale token", { error: e.message });
  }
}

async function sendFCM(token, { title, body, jobId, section }) {
  if (!token) return;
  // Stable tag used for OS-level dedup (Android collapses dup notifications with
  // the same tag; web push uses it the same way). Without this, the iOS->Android
  // bridge or a re-fired SW could surface the same notification twice.
  const tag = jobId ? `job-${jobId}-${section || "general"}` : `homestead-${Date.now()}`;
  // Deep-link target for the click handler — opens the app at the specific job.
  const linkPath = jobId
    ? `/?jobId=${encodeURIComponent(jobId)}${section ? `&section=${encodeURIComponent(section)}` : ""}`
    : "/";
  try {
    await messaging.send({
      token,
      // data payload — always present so the SW can handle it
      data: {
        title:   title   || "",
        body:    body    || "",
        jobId:   jobId   || "",
        section: section || "",
      },
      // notification payload — required for background delivery on Android & iOS
      notification: { title: title || "", body: body || "" },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          title: title || "",
          body:  body  || "",
          icon:  "/icon-192.png",
          badge: "/icon-192.png",
          tag,                      // dedup at the browser/SW layer
          requireInteraction: false,
        },
        // fcmOptions.link is what the FCM SDK opens when the user taps the
        // notification (FCM handles the click → focus existing tab or open new).
        fcmOptions: { link: linkPath },
      },
      android: {
        priority: "high",
        // collapseKey makes Android replace any pending notification with the
        // same key instead of stacking — fixes the "2-3 per notification" bug.
        collapseKey: tag,
        notification: {
          sound: "default",
          channelId: "homestead_default",
          tag,                      // OS-level dedup on the device
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      apns: {
        headers: {
          // REQUIRED for iOS Safari PWA push — without "apns-push-type: alert"
          // Apple's gateway silently drops the notification. This was the
          // root cause of "Apple users don't get them anymore."
          "apns-push-type": "alert",
          "apns-priority":  "10",
        },
        payload: {
          aps: {
            alert: { title: title || "", body: body || "" },
            sound: "default",
            badge: 1,
            "thread-id": tag,       // iOS dedup / grouping
          },
        },
      },
    });
  } catch (e) {
    const isStale = STALE_TOKEN_CODES.some(
      code => e.code === code || (e.message || "").includes(code)
    );
    if (isStale) {
      await removeStaleToken(token);
    } else {
      functions.logger.warn("FCM send failed", { token: token.slice(0, 20), error: e.message });
    }
  }
}

async function sendToName(name, notification) {
  if (!name || name === "Unassigned") return;
  const users = await getUsers();
  const n = name.toLowerCase().trim();
  const user = users.find(u => {
    const un = (u.name || "").toLowerCase();
    return un === n || un.startsWith(n + " ") || n.startsWith(un.split(" ")[0]);
  });
  if (!user) return;
  await Promise.all(getTokens(user).map(t => sendFCM(t, notification)));
}

async function sendToRoles(roles, notification, excludeTokens = []) {
  const users = await getUsers();
  const targets = users.filter(u => roles.includes(u.title) || roles.includes(u.role));
  const sends = [];
  for (const u of targets) {
    for (const t of getTokens(u)) {
      if (!excludeTokens.includes(t)) sends.push(sendFCM(t, notification));
    }
  }
  await Promise.all(sends);
}

/** Convenience — send the same notification to a name + roles (deduped), with jobId/section. */
async function notify(name, roles, notif, excludeTokens = []) {
  const nameTokens = name && name !== "Unassigned" ? await getTokenForName(name) : [];
  const tasks = [];
  if (nameTokens.length) tasks.push(Promise.all(nameTokens.map(t => sendFCM(t, notif))));
  tasks.push(sendToRoles(roles, notif, [...excludeTokens, ...nameTokens]));
  await Promise.all(tasks);
}

async function getTokenForName(name) {
  if (!name || name === "Unassigned") return [];
  const users = await getUsers();
  const n = name.toLowerCase().trim();
  const user = users.find(u => {
    const un = (u.name || "").toLowerCase();
    return un === n || un.startsWith(n + " ") || n.startsWith(un.split(" ")[0]);
  });
  return user ? getTokens(user) : [];
}

function parseDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + "T12:00:00");
  const parts = str.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts.map(Number);
    if (m && d && y) return new Date(y, m - 1, d, 12, 0, 0);
  }
  return null;
}

function isDaysAway(dateStr, daysAway) {
  const target = parseDate(dateStr);
  if (!target) return false;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  return diff === daysAway;
}

function getQuestionIds(q) {
  if (!q || typeof q !== "object") return new Set();
  const ids = new Set();
  ["upper", "main", "basement"].forEach(f =>
    (q[f] || []).forEach(item => { if (item.id) ids.add(item.id); })
  );
  return ids;
}

function hasNewQuestions(beforeQ, afterQ) {
  const beforeIds = getQuestionIds(beforeQ);
  const afterIds  = getQuestionIds(afterQ);
  for (const id of afterIds) {
    if (!beforeIds.has(id)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// FIRESTORE TRIGGER — jobs/{jobId} onUpdate
// ─────────────────────────────────────────────────────────────

exports.onJobUpdate = functions.firestore
  .document("jobs/{jobId}")
  .onUpdate(async (change, context) => {
    const jobId  = context.params.jobId;
    const before = change.before.data()?.data || {};
    const after  = change.after.data()?.data  || {};
    const name   = after.name || "a job";

    const tasks = [];

    // ── 1. Foreman assigned / changed ─────────────────────────
    if (after.foreman && after.foreman !== before.foreman && after.foreman !== "Unassigned") {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "🔨 Job Assigned to You",
        body:  `You've been assigned as foreman on ${name}`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "🔨 Foreman Assigned",
        body:  `${after.foreman} assigned as foreman on ${name}`,
        jobId, section: "Job Info",
      }, foremanTokens));
    }

    // ── 2. Lead assigned / changed ────────────────────────────
    if (after.lead && after.lead !== before.lead && after.lead !== "Unassigned") {
      const leadTokens = await getTokenForName(after.lead);
      tasks.push(sendToName(after.lead, {
        title: "📋 Job Assigned to You",
        body:  `You're the lead on ${name}`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "📋 Lead Assigned",
        body:  `${after.lead} assigned as lead on ${name}`,
        jobId, section: "Job Info",
      }, leadTokens));
    }

    // ── 3. Ready to invoice ───────────────────────────────────
    if (!before.readyToInvoice && after.readyToInvoice) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
        jobId, section: "Job Info",
      }, foremanTokens));
    }

    // ── 4. Quote converted to job ─────────────────────────────
    if (before.type === "quote" && after.type !== "quote") {
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Quote Converted to Job",
        body:  `${name} is now a job — ready for billing`,
        jobId, section: "Job Info",
      }));
    }

    // ── 5. Job prep complete ──────────────────────────────────
    if (!allPrepDone(before) && allPrepDone(after)) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "✅ Job Prep Complete",
        body:  `Prep is done on ${name} — ready to roll`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Job Prep Complete",
        body:  `${name} prep is complete`,
        jobId, section: "Job Info",
      }, foremanTokens));
    }

    // ── 6. QC walk needs to be scheduled ─────────────────────
    if (before.qcStatus !== "needs" && after.qcStatus === "needs") {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk — please schedule it`,
        jobId, section: "QC",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk`,
        jobId, section: "QC",
      }, foremanTokens));
    }

    // ── 6b. QC passed (pass or fixed) ────────────────────────
    const wasPass = after.qcStatus === "pass" || after.qcStatus === "fixed";
    const wasPassBefore = before.qcStatus === "pass" || before.qcStatus === "fixed";
    if (!wasPassBefore && wasPass) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
        jobId, section: "QC",
      }, foremanTokens));
      tasks.push(sendToName(after.foreman, {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
        jobId, section: "QC",
      }));
    }

    // ── 6c. Matterport scan complete ──────────────────────────
    if (before.matterportStatus !== "complete" && after.matterportStatus === "complete") {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "📷 Matterport Scan Complete",
        body:  `${name} — Matterport scan is done`,
        jobId, section: "Rough",
      }, foremanTokens));
    }

    // ── 7. Change Orders ──────────────────────────────────────
    const beforeCOs = before.changeOrders || [];
    const afterCOs  = after.changeOrders  || [];

    if (afterCOs.length > beforeCOs.length) {
      for (const co of afterCOs.slice(beforeCOs.length)) {
        const foremanTokens = await getTokenForName(after.foreman);
        tasks.push(sendToName(after.foreman, {
          title: "📝 New Change Order",
          body:  `A new change order was created on ${name}`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "📝 New Change Order",
          body:  `A new change order was created on ${name}`,
          jobId, section: "Change Orders",
        }, foremanTokens));
      }
    }

    const beforeCOMap = {};
    beforeCOs.forEach(co => { if (co.id) beforeCOMap[co.id] = co; });
    for (let i = 0; i < afterCOs.length; i++) {
      const co = afterCOs[i];
      const prev = co.id ? beforeCOMap[co.id] : beforeCOs[i];
      if (!prev) continue;

      if (prev.coStatus !== "approved" && co.coStatus === "approved") {
        const leadTokens    = await getTokenForName(after.lead);
        const foremanTokens = await getTokenForName(after.foreman);
        tasks.push(sendToName(after.lead, {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToName(after.foreman, {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }, [...leadTokens, ...foremanTokens]));
      }

      if (prev.coStatus !== "complete" && co.coStatus === "complete") {
        const foremanTokens = await getTokenForName(after.foreman);
        tasks.push(sendToName(after.foreman, {
          title: "🔨 CO Work Completed",
          body:  `Change Order #${i + 1} work is done on ${name}`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "🔨 CO Work Completed",
          body:  `Change Order #${i + 1} work is done on ${name}`,
          jobId, section: "Change Orders",
        }, foremanTokens));
      }
    }

    // ── 8. Return Trips ───────────────────────────────────────
    const beforeRTs = before.returnTrips || [];
    const afterRTs  = after.returnTrips  || [];
    const beforeRTMap = {};
    beforeRTs.forEach(rt => { if (rt.id) beforeRTMap[rt.id] = rt; });

    for (let i = 0; i < afterRTs.length; i++) {
      const rt = afterRTs[i];
      const prev = rt.id ? beforeRTMap[rt.id] : beforeRTs[i];
      const prevAssigned = prev?.assignedTo || "";
      if (rt.assignedTo && rt.assignedTo !== prevAssigned && rt.assignedTo !== "Unassigned") {
        const assignedTokens = await getTokenForName(rt.assignedTo);
        tasks.push(sendToName(rt.assignedTo, {
          title: "🔄 Return Trip Assigned",
          body:  `You've been assigned to a return trip on ${name}`,
          jobId, section: "Return Trips",
        }));
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "🔄 Return Trip Assigned",
          body:  `${rt.assignedTo} assigned to return trip on ${name}`,
          jobId, section: "Return Trips",
        }, assignedTokens));
      }
      if (!prev?.signedOff && rt.signedOff) {
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "✅ Return Trip Signed Off",
          body:  `Return Trip ${i + 1} on ${name} is signed off — slot is open`,
          jobId, section: "Return Trips",
        }));
      }
    }

    // ── 9. Questions added ────────────────────────────────────
    if (hasNewQuestions(before.roughQuestions, after.roughQuestions)) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
        jobId, section: "Rough",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
        jobId, section: "Rough",
      }, foremanTokens));
    }
    if (hasNewQuestions(before.finishQuestions, after.finishQuestions)) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "❓ New Question on Job",
        body:  `A new finish question was added on ${name}`,
        jobId, section: "Finish",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "❓ New Question on Job",
        body:  `A new finish question was added on ${name}`,
        jobId, section: "Finish",
      }, foremanTokens));
    }

    // ── 10. Daily job update added ────────────────────────────
    const beforeRoughUpdates  = (before.roughUpdates  || []).length;
    const afterRoughUpdates   = (after.roughUpdates   || []).length;
    const beforeFinishUpdates = (before.finishUpdates || []).length;
    const afterFinishUpdates  = (after.finishUpdates  || []).length;

    if (afterRoughUpdates > beforeRoughUpdates) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Rough",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Rough",
      }, foremanTokens));
    } else if (afterFinishUpdates > beforeFinishUpdates) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Finish",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Finish",
      }, foremanTokens));
    }

    await Promise.all(tasks);
    return null;
  });

// ─────────────────────────────────────────────────────────────
// FIRESTORE TRIGGER — homeowner_requests/{jobId} onWrite
// Question answered by GC/homeowner → notify lead + admin
// ─────────────────────────────────────────────────────────────

exports.onQuestionAnswered = functions.firestore
  .document("homeowner_requests/{jobId}")
  .onWrite(async (change, context) => {
    const { jobId } = context.params;
    const before = change.before.exists ? change.before.data() : {};
    const after  = change.after.exists  ? change.after.data()  : {};

    const beforeAnswers = before.questionAnswers || {};
    const afterAnswers  = after.questionAnswers  || {};

    const countAnswers = (qa) => {
      let n = 0;
      Object.values(qa || {}).forEach(stage => {
        Object.values(stage || {}).forEach(floor => {
          (floor || []).forEach(a => { if (a.answer) n++; });
        });
      });
      return n;
    };

    if (countAnswers(afterAnswers) <= countAnswers(beforeAnswers)) return null;

    const jobSnap = await db.doc(`jobs/${jobId}`).get();
    if (!jobSnap.exists) return null;
    const job = jobSnap.data()?.data || {};

    const leadTokens = job.lead ? await getTokenForName(job.lead) : [];

    if (job.lead) {
      await sendToName(job.lead, {
        title: "💬 Question Answered",
        body:  `A question was answered on ${job.name || "your job"}`,
        jobId, section: "Rough",
      });
    }

    await sendToRoles(["admin", "manager"], {
      title: "💬 Question Answered",
      body:  `A question was answered on ${job.name || "a job"}`,
      jobId, section: "Rough",
    }, leadTokens);

    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Daily 7am Mountain Time
// ─────────────────────────────────────────────────────────────

exports.dailyMorningChecks = functions.pubsub
  .schedule("0 7 * * *")
  .timeZone(TZ)
  .onRun(async () => {
    const snap = await db.collection("jobs").get();
    const tasks = [];

    snap.docs.forEach(doc => {
      const job = doc.data()?.data || {};
      if (!job.name) return;
      const name = job.name;

      if (job.roughScheduledDate && isDaysAway(job.roughScheduledDate, 2)) {
        tasks.push(sendToName("Koy", {
          title: "📋 Plans Check — Job Starts in 2 Days",
          body:  `${name} — verify plans are uploaded to app & SimPro`,
        }));
      }

      const prepDone = allPrepDone(job);
      if (job.roughScheduledDate && !prepDone) {
        if (isDaysAway(job.roughScheduledDate, 7)) {
          tasks.push(sendToName("Koy", {
            title: "⚠️ Job Starts in 1 Week — Prep Not Done",
            body:  `${name} starts in 7 days and job prep is not complete`,
          }));
        }
        if (isDaysAway(job.roughScheduledDate, 2)) {
          tasks.push(sendToName("Koy", {
            title: "🚨 URGENT — Job Starts in 2 Days, Prep Incomplete",
            body:  `${name} starts in 2 days and job prep is still NOT complete`,
          }));
        }
      }
    });

    // ── STALE-STATE BATCH (one summary push per morning) ─────
    // Surfaces things that have been quietly rotting. Counts only;
    // Koy can open the app to see specifics.  All reads, no writes.
    const todayMT = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    const DAY_MS  = 24 * 60 * 60 * 1000;

    let staleQuotes        = 0; // quote doc with no activity > 14 days
    let staleRoughComplete = 0; // rough complete, no finish scheduled, > 7 days
    let staleRTs           = 0; // RT in "needs", unassigned, job idle > 5 days
    let staleQuestions     = 0; // unanswered question on a job idle > 3 days

    snap.docs.forEach(doc => {
      const raw = doc.data() || {};
      const job = raw.data || {};
      if (!job.name) return;
      const updatedAt = raw.updated_at?.toDate?.() || null;
      const daysSinceUpdate = updatedAt ? (todayMT - updatedAt) / DAY_MS : null;

      // 1. Quote with no activity > 14 days
      if (job.type === "quote" && daysSinceUpdate != null && daysSinceUpdate > 14) {
        staleQuotes += 1;
      }

      // 2. Rough complete, no finish scheduled, > 7 days
      if (job.roughStatus === "complete" && !job.finishScheduledDate && !job.finishStatusDate) {
        const re = parseDate(job.roughStatusDate);
        if (re && (todayMT - re) / DAY_MS >= 7) staleRoughComplete += 1;
      }

      // 3. RT "needs", unassigned, job idle > 5 days
      (job.returnTrips || []).forEach(rt => {
        if (rt.signedOff || rt.rtScheduled) return;
        if (rt.rtStatus !== "needs") return;
        if (rt.assignedTo && rt.assignedTo !== "Unassigned") return;
        if (daysSinceUpdate != null && daysSinceUpdate >= 5) staleRTs += 1;
      });

      // 4. Unanswered question on a job idle > 3 days
      if (daysSinceUpdate != null && daysSinceUpdate > 3) {
        ["roughQuestions", "finishQuestions"].forEach(qk => {
          const qs = job[qk] || {};
          ["upper", "main", "basement"].forEach(f => {
            (qs[f] || []).forEach(q => {
              if (!q.done && !(q.answer || "").trim()) staleQuestions += 1;
            });
          });
        });
      }
    });

    const staleLines = [];
    if (staleQuotes)        staleLines.push(`${staleQuotes} quote${staleQuotes === 1 ? "" : "s"} >14d idle`);
    if (staleRoughComplete) staleLines.push(`${staleRoughComplete} rough-complete no finish >7d`);
    if (staleRTs)           staleLines.push(`${staleRTs} unassigned RT >5d`);
    if (staleQuestions)     staleLines.push(`${staleQuestions} unanswered Q >3d`);
    if (staleLines.length) {
      tasks.push(sendToName("Koy", {
        title: "📊 Stale State",
        body:  staleLines.join(" · "),
      }));
    }

    await Promise.all(tasks);
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Weekdays at 1:00pm Mountain Time
// ─────────────────────────────────────────────────────────────

exports.dailyPOReminder = functions.pubsub
  .schedule("0 13 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    await sendToRoles(["lead"], {
      title: "📄 PO Reminder",
      body:  "Don't forget to submit your POs for today",
    });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Weekdays at 4:30pm Mountain Time
// ─────────────────────────────────────────────────────────────

exports.dailyUpdateReminder = functions.pubsub
  .schedule("30 16 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    await sendToRoles(["lead"], {
      title: "📝 Daily Update",
      body:  "Time to enter your daily job update",
    });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// HTTPS CALLABLE — Push Drive plans to Simpro (additive only)
// ─────────────────────────────────────────────────────────────
// Called from the app when user clicks "Push to Simpro" on a job.
// Downloads files from Google Drive and uploads them to Simpro.
// Never deletes anything from Simpro.

const SIMPRO_TOKEN = "402222413e886be0bda7bd5173aa8e215d34bcdb";
const SIMPRO_BASE  = "https://homesteadelectric.simprosuite.com/api/v1.0/companies/0";
const DRIVE_KEY    = "AIzaSyAQl6V74U502_ZHF3h_1W0yYDuKr2mLI5Q";
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per-file cap

async function simproReq(method, path, body) {
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${SIMPRO_TOKEN}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SIMPRO_BASE}${path}`, opts);
  const text = await r.text();
  const retryAfter = r.headers.get("retry-after");
  try { return { ok: r.ok, status: r.status, retryAfter, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, retryAfter, data: text }; }
}

// Retry-aware wrapper. Simpro's public API rate-limits at ~60 req/min per
// token; bulk fetches trip 429s easily. On 429 we back off (honoring
// Retry-After when present) and retry up to 5 attempts with jittered
// exponential backoff. 5xx also retries. Everything else returns as-is.
async function simproReqWithRetry(method, path, body, {maxAttempts = 5} = {}) {
  let lastRes = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await simproReq(method, path, body);
    lastRes = r;
    const shouldRetry = r.status === 429 || (r.status >= 500 && r.status < 600);
    if (!shouldRetry) return r;
    if (attempt === maxAttempts) break;
    const headerWait = Number(r.retryAfter);
    // Exponential backoff: 1s, 2s, 4s, 8s (+ jitter). Cap at 15s.
    const backoff = Math.min(15000, 1000 * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 400);
    const waitMs = (Number.isFinite(headerWait) && headerWait > 0 ? headerWait * 1000 : backoff) + jitter;
    await new Promise(res => setTimeout(res, waitMs));
  }
  return lastRes;
}

async function listDriveItems(folderId, parentFolderName, depth, driveKey) {
  if (depth > 3) return [];
  const url = `https://www.googleapis.com/drive/v3/files` +
    `?q=%27${folderId}%27+in+parents+and+trashed=false` +
    `&key=${driveKey}&fields=files(id,name,mimeType,size)` +
    `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Drive listing failed");
  const items = data.files || [];

  const files = items
    .filter(f => f.mimeType !== "application/vnd.google-apps.folder")
    .filter(f => !f.mimeType.startsWith("application/vnd.google-apps."))
    .map(f => ({ ...f, _folder: parentFolderName }));

  const subfolders = items.filter(f => f.mimeType === "application/vnd.google-apps.folder");
  const nested = await Promise.all(
    subfolders.map(sf => listDriveItems(sf.id, sf.name, depth + 1, driveKey))
  );
  return [...files, ...nested.flat()];
}

exports.pushPlansToSimpro = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data) => {
    const { simproJobNo, driveFolderId } = data || {};
    if (!simproJobNo) throw new functions.https.HttpsError("invalid-argument", "Missing simproJobNo");
    if (!driveFolderId) throw new functions.https.HttpsError("invalid-argument", "Missing driveFolderId");

    // 1. Fetch existing Simpro files (flat list, check by filename)
    const filesRes = await simproReq("GET", `/jobs/${simproJobNo}/attachments/files/`);
    const existingFiles = Array.isArray(filesRes.data) ? filesRes.data : [];
    const existingFilenames = new Set(existingFiles.map(f => f.Filename));

    // 2. Fetch existing Simpro folders
    const foldersRes = await simproReq("GET", `/jobs/${simproJobNo}/attachments/folders/`);
    const existingFolders = Array.isArray(foldersRes.data) ? foldersRes.data : [];
    const simpFolderMap = {}; // folder name → Simpro folder ID
    existingFolders.forEach(f => { simpFolderMap[f.Name] = f.ID; });

    // 3. Recursively list Drive files
    const driveFiles = await listDriveItems(driveFolderId, "Root", 0, DRIVE_KEY);

    // 4. Upload new files to Simpro
    const uploaded = [], skipped = [], errors = [];

    for (const f of driveFiles) {
      if (existingFilenames.has(f.name)) {
        skipped.push(f.name);
        continue;
      }

      const fileSize = parseInt(f.size || "0", 10);
      if (fileSize > MAX_FILE_BYTES) {
        errors.push({ name: f.name, error: `Too large (${Math.round(fileSize / 1024 / 1024)}MB, max 15MB)` });
        continue;
      }

      // Create Simpro folder if needed
      let folderIdInSimpro = null;
      if (f._folder && f._folder !== "Root") {
        if (simpFolderMap[f._folder]) {
          folderIdInSimpro = simpFolderMap[f._folder];
        } else {
          const fr = await simproReq("POST", `/jobs/${simproJobNo}/attachments/folders/`, { Name: f._folder });
          if (fr.ok && fr.data && fr.data.ID) {
            simpFolderMap[f._folder] = fr.data.ID;
            folderIdInSimpro = fr.data.ID;
          }
        }
      }

      // Download from Drive
      const dlUrl = `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${DRIVE_KEY}&supportsAllDrives=true`;
      let fileBuffer;
      try {
        const dlRes = await fetch(dlUrl);
        if (!dlRes.ok) { errors.push({ name: f.name, error: `Drive download failed (${dlRes.status})` }); continue; }
        fileBuffer = await dlRes.arrayBuffer();
      } catch (e) {
        errors.push({ name: f.name, error: `Drive error: ${e.message}` });
        continue;
      }

      // Upload to Simpro
      const base64 = Buffer.from(fileBuffer).toString("base64");
      const uploadBody = { Filename: f.name, Base64Data: base64 };
      if (folderIdInSimpro) uploadBody.Folder = folderIdInSimpro;

      const upRes = await simproReq("POST", `/jobs/${simproJobNo}/attachments/files/`, uploadBody);
      if (upRes.ok) {
        uploaded.push(f.name);
        existingFilenames.add(f.name);
      } else {
        const errMsg = upRes.data && upRes.data.errors
          ? upRes.data.errors.map(e => e.message).join("; ")
          : String(upRes.data).slice(0, 120);
        errors.push({ name: f.name, error: errMsg });
      }
    }

    return { uploaded, skipped, errors };
  });

// ─── Get Simpro Job Financials ────────────────────────────────────────────────
exports.getSimproJobFinancials = functions.https.onCall(async (data) => {
  const { simproJobNo } = data || {};
  if (!simproJobNo) throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");

  const resp = await fetch(
    `${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(simproJobNo)}&pageSize=1&columns=ID,Totals`,
    { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } }
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new functions.https.HttpsError("internal", `Simpro error: ${resp.status} ${body.slice(0,200)}`);
  }
  const results = await resp.json();
  const job = Array.isArray(results) ? results[0] : null;
  if (!job) throw new functions.https.HttpsError("not-found", `No job found for No=${simproJobNo}`);

  const t = job.Totals || {};
  const actual   = t.NettMargin?.Actual   ?? null;
  const estimate = t.NettMargin?.Estimate ?? null;

  // actual === 100 means no real costs have been tracked yet in Simpro
  const hasRealActual = actual !== null && actual !== 100;

  return {
    margin:    hasRealActual ? actual : estimate,
    isEstimate: !hasRealActual,
    laborHoursActual:   t.ResourcesCost?.LaborHours?.Actual   ?? null,
    laborHoursEstimate: t.ResourcesCost?.LaborHours?.Estimate ?? null,
  };
});

// ─── Get Simpro Job Cost Centers ──────────────────────────────────────────────
// Returns the flat list of cost centers + the items inside each cost center
// (catalogs, one-offs, prebuilds) so the "Is this in the bid?" search can
// match against actual bid item names, not just cost-center headings.
// Concurrency-limited so we don't hammer Simpro's rate limit.
async function _pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) return;
      try { results[idx] = await tasks[idx](); }
      catch (e) { results[idx] = { __error: e.message || String(e) }; }
    }
  }
  const n = Math.min(limit, tasks.length);
  await Promise.all(Array.from({length:n}, worker));
  return results;
}

exports.getSimproJobCostCenters = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onCall(async (data) => {
    const { simproJobNo } = data || {};
    if (!simproJobNo) throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");

    // 1. Pull sections for the job.
    const sectionsRes = await simproReqWithRetry(
      "GET",
      `/jobs/${encodeURIComponent(simproJobNo)}/sections/?columns=ID,Name&pageSize=100`
    );
    if (!sectionsRes.ok) {
      const body = typeof sectionsRes.data === "string" ? sectionsRes.data : JSON.stringify(sectionsRes.data);
      throw new functions.https.HttpsError("internal", `Simpro sections error: ${sectionsRes.status} ${body.slice(0, 200)}`);
    }
    const sections = Array.isArray(sectionsRes.data) ? sectionsRes.data : [];

    // 2. Fetch cost centers for every section in parallel.
    //    No `columns=` param — Simpro rejects some column names silently on
    //    this endpoint (returns an empty array). Pulling all fields and
    //    trimming here is the safer path.
    let loggedFirst = false;
    const ccResults = await Promise.all(
      sections.map(async (s) => {
        const r = await simproReqWithRetry(
          "GET",
          `/jobs/${encodeURIComponent(simproJobNo)}/sections/${s.ID}/costCenters/?pageSize=250`
        );
        if (!r.ok) {
          functions.logger.warn("getSimproJobCostCenters: section fetch failed", {
            sectionId: s.ID, status: r.status, body: typeof r.data === "string" ? r.data.slice(0,200) : r.data,
          });
          return { sectionId: s.ID, sectionName: s.Name, costCenters: [], error: `${r.status}` };
        }
        const rows = Array.isArray(r.data) ? r.data : [];
        if (!loggedFirst && rows.length) {
          loggedFirst = true;
          functions.logger.info("getSimproJobCostCenters: sample cost center shape", { sample: rows[0] });
        }
        const costCenters = rows.map(cc => {
          // Simpro shapes we've seen across tenants: Total can be {ExTax,IncTax},
          // or flat ExTax/IncTax numbers. Be defensive.
          const totalExTax =
            cc?.Total?.ExTax ??
            cc?.Totals?.ExTax ??
            cc?.ExTax ??
            null;
          const totalIncTax =
            cc?.Total?.IncTax ??
            cc?.Totals?.IncTax ??
            cc?.IncTax ??
            null;
          return {
            id: cc.ID ?? cc.Id ?? cc.id ?? null,
            name: cc.Name ?? cc.name ?? "",
            totalExTax,
            totalIncTax,
            claimedPct:  cc.ClaimedUpTo ?? cc.Claimed ?? null,
            setupHours:  cc?.Setup?.Hours ?? cc?.Hours ?? null,
          };
        });
        return { sectionId: s.ID, sectionName: s.Name || "", costCenters };
      })
    );

    const flat = [];
    for (const sec of ccResults) {
      for (const cc of sec.costCenters) {
        flat.push({
          sectionId: sec.sectionId,
          sectionName: sec.sectionName,
          ...cc,
        });
      }
    }

    // 3. For every cost center, pull the items inside (catalogs, one-offs,
    //    prebuilds). These are what field folks actually search — "island
    //    pendant", "4s box", "can light", etc. are item names, not cost
    //    center names.
    // Simpro's list endpoints return a minimal default column set — notably
    // WITHOUT Quantity, which is what we actually want for bid items. We
    // explicitly request a narrow, universally-supported set. If the column
    // list is rejected (Simpro silently returns []), we fall back to the
    // default (no columns param) so items still render — quantity will be
    // null for that kind, but the names + totals still show.
    const ITEM_KINDS = [
      { key: "catalog",  path: "catalogs",  columns: "ID,Name,Quantity,Total" },
      { key: "oneOff",   path: "oneOffs",   columns: "ID,Name,Quantity,Total" },
      { key: "prebuild", path: "prebuilds", columns: "ID,Name,Quantity,Total" },
    ];

    // Log one sample per kind so we can see the true shape in Cloud Function logs.
    const sampleLogged = { catalog: false, oneOff: false, prebuild: false };
    // Also stash the first raw item of each kind so the client console can
    // print it — easier than digging through Cloud Function logs.
    const debugSamples = { catalog: null, oneOff: null, prebuild: null };
    // Per-kind fetch stats so we can tell rate-limit failures from empty CCs.
    const debugStats = {
      catalog:  { attempts: 0, ok: 0, emptyWithCols: 0, fellBackToDefault: 0, defaultAlsoEmpty: 0, withItems: 0, totalItems: 0, statusBreakdown: {} },
      oneOff:   { attempts: 0, ok: 0, emptyWithCols: 0, fellBackToDefault: 0, defaultAlsoEmpty: 0, withItems: 0, totalItems: 0, statusBreakdown: {} },
      prebuild: { attempts: 0, ok: 0, emptyWithCols: 0, fellBackToDefault: 0, defaultAlsoEmpty: 0, withItems: 0, totalItems: 0, statusBreakdown: {} },
    };
    // First failing URL + body per kind, so we can see what Simpro is rejecting.
    const firstFailure = { catalog: null, oneOff: null, prebuild: null };
    const tasks = [];
    flat.forEach(cc => {
      ITEM_KINDS.forEach(kind => {
        tasks.push(async () => {
          const stats = debugStats[kind.key];
          stats.attempts++;
          const baseUrl =
            `/jobs/${encodeURIComponent(simproJobNo)}/sections/${cc.sectionId}` +
            `/costCenters/${cc.id}/${kind.path}/?pageSize=250`;
          const colsParam = kind.columns ? `&columns=${encodeURIComponent(kind.columns)}` : "";
          let r = await simproReqWithRetry("GET", baseUrl + colsParam);
          stats.statusBreakdown[r.status] = (stats.statusBreakdown[r.status] || 0) + 1;
          // Simpro rejects invalid column names in two ways:
          //   - 422 "Invalid columns found" with the offending names in body
          //   - 200 OK with an empty array (on some endpoints)
          // In either case, retry without any columns param so items at least
          // render with the default column set. Quantity will be null on the
          // fallback path — we can surface it per-item with a detail fetch
          // once the list layer is proven to work.
          const columnsRejected =
            colsParam && (
              r.status === 422 ||
              (r.ok && Array.isArray(r.data) && r.data.length === 0)
            );
          if (columnsRejected) {
            if (r.ok) stats.emptyWithCols++;
            const r2 = await simproReqWithRetry("GET", baseUrl);
            stats.statusBreakdown[`fb-${r2.status}`] = (stats.statusBreakdown[`fb-${r2.status}`] || 0) + 1;
            if (r2.ok && Array.isArray(r2.data) && r2.data.length > 0) {
              stats.fellBackToDefault++;
              functions.logger.info("getSimproJobCostCenters: columns rejected, using defaults", {
                kind: kind.key, sectionId: cc.sectionId, costCenterId: cc.id, originalStatus: r.status,
              });
              r = r2;
            } else if (r2.ok) {
              stats.defaultAlsoEmpty++;
              r = r2; // treat as success-with-empty so we don't count it as failed below
            }
          }
          if (!r.ok) {
            if (!firstFailure[kind.key]) {
              firstFailure[kind.key] = {
                url: baseUrl + colsParam,
                status: r.status,
                body: typeof r.data === "string" ? r.data.slice(0, 400) :
                      (r.data ? JSON.stringify(r.data).slice(0, 400) : null),
              };
            }
            functions.logger.warn("getSimproJobCostCenters: item fetch failed", {
              kind: kind.key, sectionId: cc.sectionId, costCenterId: cc.id, status: r.status,
              url: baseUrl + colsParam,
              body: typeof r.data === "string" ? r.data.slice(0, 200) :
                    (r.data ? JSON.stringify(r.data).slice(0, 200) : null),
            });
            return { cc, kind: kind.key, items: [] };
          }
          stats.ok++;
          const rows = Array.isArray(r.data) ? r.data : [];
          if (rows.length > 0) { stats.withItems++; stats.totalItems += rows.length; }
          if (!sampleLogged[kind.key] && rows.length) {
            sampleLogged[kind.key] = true;
            debugSamples[kind.key] = rows[0];
            functions.logger.info("getSimproJobCostCenters: sample item shape", {
              kind: kind.key,
              keys: Object.keys(rows[0] || {}),
              sample: rows[0],
            });
          }
          const items = rows.map(it => {
            // Item names live in different fields across Simpro item types:
            //   - catalog items:  it.Catalog.Name or it.Name
            //   - one-offs:       it.Name
            //   - prebuilds:      it.Prebuild.Name or it.Name
            const name =
              it?.Catalog?.Name ??
              it?.Prebuild?.Name ??
              it?.Name ??
              it?.Description ??
              "(unnamed)";
            // Quantity — Simpro exposes this under many shapes depending on
            // tenant + item type. Be exhaustive so field folks can always
            // see "how many of this thing was bid".
            const qty =
              (typeof it?.Quantity === "number" ? it.Quantity : null) ??
              it?.Quantity?.Value ??
              it?.Quantity?.Billable ??
              it?.Quantity?.Invoiced ??
              it?.Quantity?.Complete ??
              it?.Qty ??
              it?.QuantityOrdered ??
              it?.BillableQuantity ??
              it?.ItemQuantity ??
              null;
            const totalExTax =
              it?.Total?.ExTax ??
              it?.Totals?.ExTax ??
              it?.ExTax ??
              null;
            const unitPrice =
              it?.Price ??
              it?.UnitPrice ??
              it?.Cost ??
              null;
            // Master catalog/prebuild ID — the key Simpro order requests use
            // to reference catalog items. Needed for matching ordered qty
            // back to bid items later.
            const catalogId =
              it?.Catalog?.ID ??
              it?.Prebuild?.ID ??
              it?.OneOff?.ID ??
              null;
            // Bid-origin signal. Simpro adds post-bid purchases (PO line
            // items, tax lines, misc additions) to the job's cost center as
            // oneOff lines with zero estimated cost/price. True bid items
            // come in with an EstimatedCost or BasePrice > 0 from the quote.
            const estimatedCost =
              it?.EstimatedCost ??
              it?.Catalog?.EstimatedCost ??
              it?.Prebuild?.EstimatedCost ??
              0;
            const basePrice =
              it?.BasePrice ??
              it?.Catalog?.BasePrice ??
              it?.Prebuild?.BasePrice ??
              0;
            return {
              kind: kind.key,
              id: it?.ID ?? it?.Id ?? it?.id ?? null,
              catalogId,
              name,
              qty,
              unitPrice,
              totalExTax,
              estimatedCost,
              basePrice,
            };
          });
          return { cc, kind: kind.key, items };
        });
      });
    });

    // Concurrency 3 for item fetches — Simpro's public API rate-limits at
    // ~60 req/min per token and bulk fetches trip 429s easily. The retry
    // wrapper handles transient spikes; the low concurrency keeps us under
    // the sustained limit.
    const itemResults = await _pLimit(tasks, 3);

    // Attach items back to each cost center.
    const ccById = new Map(flat.map(cc => [`${cc.sectionId}-${cc.id}`, cc]));
    flat.forEach(cc => { cc.items = []; });
    itemResults.forEach(res => {
      if (!res || res.__error) return;
      const key = `${res.cc.sectionId}-${res.cc.id}`;
      const target = ccById.get(key);
      if (target) target.items.push(...res.items);
    });

    return {
      sections: ccResults.map(s => ({ id: s.sectionId, name: s.sectionName })),
      costCenters: flat,
      fetchedAt: new Date().toISOString(),
      _debugFirstItems: debugSamples, // temporary — remove once qty mapping is confirmed
      _debugFetchStats: debugStats,   // temporary — diagnose empty-item cases
      _debugFirstFailure: firstFailure, // temporary — first failing URL per kind
    };
  });

// ─── Get Simpro Item Details (for lazy qty loading) ───────────────────────────
// Simpro's cost-center item LIST endpoints don't return Quantity in the default
// response. To get qty, we have to hit each item's detail endpoint. This
// callable takes a batch of items and returns qty for each — called lazily
// from the client when a cost center is expanded, so we never fetch more qty
// than the user actually looks at.
exports.getSimproItemDetails = functions
  .runWith({ timeoutSeconds: 180, memory: "256MB" })
  .https.onCall(async (data) => {
    const { simproJobNo, items } = data || {};
    if (!simproJobNo) throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");
    if (!Array.isArray(items) || items.length === 0) return { items: [] };

    const KIND_TO_PATH = { catalog: "catalogs", oneOff: "oneOffs", prebuild: "prebuilds" };

    // Diagnostic: capture the first raw detail response per kind so the
    // client can see what shape Simpro is actually returning for Quantity.
    const _debugRawByKind = { catalog: null, oneOff: null, prebuild: null };

    const tasks = items.map(it => async () => {
      const path = KIND_TO_PATH[it.kind];
      if (!path || !it.sectionId || !it.ccId || !it.itemId) {
        return { ...it, qty: null, error: "bad-input" };
      }
      const r = await simproReqWithRetry(
        "GET",
        `/jobs/${encodeURIComponent(simproJobNo)}/sections/${it.sectionId}` +
        `/costCenters/${it.ccId}/${path}/${it.itemId}`
      );
      if (!r.ok) {
        functions.logger.warn("getSimproItemDetails: detail fetch failed", {
          kind: it.kind, sectionId: it.sectionId, ccId: it.ccId, itemId: it.itemId, status: r.status,
        });
        return { ...it, qty: null, error: `${r.status}` };
      }
      const raw = r.data || {};

      // First successful response per kind → snapshot for diagnostics.
      if (_debugRawByKind[it.kind] == null) {
        try {
          _debugRawByKind[it.kind] = {
            topKeys: Object.keys(raw),
            sample: raw, // full body so we can inspect shape
          };
        } catch (_e) { /* ignore */ }
      }

      // Exhaustive qty extraction — Simpro v1 puts the qty in different
      // spots depending on tenant version and item type. Known locations:
      //   - top-level Quantity (some tenants, esp. oneOffs)
      //   - Totals.Quantity (common on v1 job catalog link records)
      //   - Claimed.ToDate.Quantity (progress-billing tenants)
      //   - nested Catalog/Prebuild/OneOff.Quantity (rare but seen)
      //   - Basic.Quantity (older schema)
      const pickNum = (v) => (typeof v === "number" && !isNaN(v) ? v : null);
      const qty =
        pickNum(raw?.Quantity) ??
        pickNum(raw?.Quantity?.Value) ??
        pickNum(raw?.Quantity?.Billable) ??
        pickNum(raw?.Quantity?.Invoiced) ??
        pickNum(raw?.Quantity?.Complete) ??
        pickNum(raw?.Totals?.Quantity) ??
        pickNum(raw?.Totals?.Qty) ??
        pickNum(raw?.Totals?.Count) ??
        pickNum(raw?.Total?.Quantity) ??
        pickNum(raw?.Total?.Qty) ??
        pickNum(raw?.Claimed?.Quantity) ??
        pickNum(raw?.Claimed?.ToDate?.Quantity) ??
        pickNum(raw?.Claimed?.Remaining?.Quantity) ??
        pickNum(raw?.Catalog?.Quantity) ??
        pickNum(raw?.Prebuild?.Quantity) ??
        pickNum(raw?.OneOff?.Quantity) ??
        pickNum(raw?.Basic?.Quantity) ??
        pickNum(raw?.Qty) ??
        pickNum(raw?.QuantityOrdered) ??
        pickNum(raw?.BillableQuantity) ??
        pickNum(raw?.ItemQuantity) ??
        null;
      return { ...it, qty };
    });

    // Concurrency 3 keeps us under Simpro's ~60 req/min per-token sustained
    // limit even if the user expands several cost centers at once.
    const results = await _pLimit(tasks, 3);
    return { items: results, _debugRawByKind };
  });

// ─── Get Simpro Job Ordered Quantities ────────────────────────────────────────
// Fetches order requests (POs) for a job, aggregates ordered qty per catalog
// ID. Field team uses this to see "× 8 bid / × 5 ordered" per item — tells
// them at a glance if anything still needs to be ordered. Drafts are excluded
// (we only want counts for orders actually sent to vendors).
exports.getSimproJobOrderedQty = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data) => {
    const { simproJobNo } = data || {};
    if (!simproJobNo) {
      throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");
    }

    // 1. List vendor orders (Simpro's v1 name for purchase orders). Simpro's
    //    tenants are inconsistent about endpoint naming and filter syntax, so
    //    we try every variant we've seen in the wild — first non-empty wins,
    //    empty-but-200 kept as fallback so we don't blow up on a job with no
    //    POs yet. Query-param forms tried: dot (`Job.ID`), camel (`JobID`),
    //    and bracket (`Job[ID]`). Resource names tried: vendorOrders,
    //    vendorOrderRequests, purchaseOrders, orders. Plus job-scoped paths.
    const jn = encodeURIComponent(simproJobNo);
    const bracketJob = encodeURIComponent("Job[ID]");
    const candidateListUrls = [
      // Global list + filter by job, in each resource name + filter style.
      `/vendorOrders/?Job.ID=${jn}&pageSize=250`,
      `/vendorOrders/?JobID=${jn}&pageSize=250`,
      `/vendorOrders/?${bracketJob}=${jn}&pageSize=250`,
      `/vendorOrderRequests/?Job.ID=${jn}&pageSize=250`,
      `/vendorOrderRequests/?JobID=${jn}&pageSize=250`,
      `/vendorOrderRequests/?${bracketJob}=${jn}&pageSize=250`,
      `/purchaseOrders/?Job.ID=${jn}&pageSize=250`,
      `/purchaseOrders/?JobID=${jn}&pageSize=250`,
      `/purchaseOrders/?${bracketJob}=${jn}&pageSize=250`,
      `/orders/?Job.ID=${jn}&pageSize=250`,
      // Job-scoped subresources — try each plausible name.
      `/jobs/${jn}/vendorOrders/?pageSize=250`,
      `/jobs/${jn}/vendorOrderRequests/?pageSize=250`,
      `/jobs/${jn}/purchaseOrders/?pageSize=250`,
      `/jobs/${jn}/orders/?pageSize=250`,
    ];
    // Fire all candidates in parallel with concurrency cap. Sequential was
    // blowing the 60s callable client timeout (14 round-trips × Simpro latency
    // = deadline-exceeded). Parallel caps total wall time to roughly the
    // slowest single request. _pLimit keeps us under Simpro's per-token
    // rate limit (~60 req/min sustained).
    const listTasks = candidateListUrls.map(candidate => async () => {
      const r = await simproReqWithRetry("GET", candidate, null, { maxAttempts: 2 });
      return {
        url: candidate,
        status: r.status,
        ok: r.ok,
        data: r.ok && Array.isArray(r.data) ? r.data : null,
        count: Array.isArray(r.data) ? r.data.length : null,
      };
    });
    const listResults = await _pLimit(listTasks, 6);
    const _debugListAttempts = listResults.map(({ url, status, count }) => ({ url, status, count }));

    // Prefer the first candidate (in the priority order above) that returned
    // a non-empty array; fall back to first empty-but-200 so an empty-job case
    // still returns cleanly instead of erroring.
    let workingListUrl = null;
    let orders = [];
    for (const res of listResults) {
      if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
        workingListUrl = res.url;
        orders = res.data;
        break;
      }
    }
    if (!workingListUrl) {
      const emptyOk = listResults.find(r => r.ok && Array.isArray(r.data));
      if (emptyOk) {
        workingListUrl = emptyOk.url;
        orders = [];
      }
    }
    if (!workingListUrl) {
      functions.logger.warn("getSimproJobOrderedQty: all order list fetches failed", {
        simproJobNo, attempts: _debugListAttempts,
      });
      return {
        byCatalogId: {}, totalOrders: 0, countedOrders: 0,
        _debug: { listAttempts: _debugListAttempts },
      };
    }

    // Derive the detail base from whichever list path worked.
    const isJobScoped = workingListUrl.includes(`/jobs/${jn}/`);
    const resourceName = workingListUrl.includes("/vendorOrderRequests/") ? "vendorOrderRequests"
                      : workingListUrl.includes("/vendorOrders/") ? "vendorOrders"
                      : workingListUrl.includes("/purchaseOrders/") ? "purchaseOrders"
                      : "orders";
    const detailBase = isJobScoped
      ? `/jobs/${encodeURIComponent(simproJobNo)}/${resourceName}`
      : `/${resourceName}`;

    // 2. For each order, fetch line items. In Simpro v1, vendor order line
    //    items live at a SUB-RESOURCE (/vendorOrders/{id}/catalogs/), not
    //    embedded in the order detail. We try sub-resources first, fall back
    //    to embedded fields if the order body carries them inline.
    const byCatalogId = {};
    let countedOrders = 0;
    let _debugFirstOrder = null;
    let _debugFirstLines = null;

    const tasks = orders.map(o => async () => {
      const orderId = o?.ID ?? o?.Id ?? o?.id;
      if (!orderId) return;

      // Pull detail for status check + inline line items if present.
      const detailRes = await simproReqWithRetry("GET", `${detailBase}/${orderId}`);
      if (!detailRes.ok) return;
      const order = detailRes.data || {};
      const status = order?.Status?.Name || order?.Stage || order?.Status || "";
      const statusLower = String(status).toLowerCase();
      if (statusLower.includes("cancel") || statusLower.includes("void")) return;

      if (!_debugFirstOrder) {
        _debugFirstOrder = { topKeys: Object.keys(order), status, sample: order };
      }

      // Sub-resource for line items. /catalogs/ is the canonical Simpro v1
      // path. Only fall through to alternatives for the FIRST order (so we
      // don't multiply every order by 4 round-trips — that re-triggers the
      // deadline-exceeded timeout).
      let lines = [];
      let usedSubUrl = null;
      let subAttempts = [];
      const tryPaths = _debugFirstLines ? ["catalogs"] : ["catalogs", "items", "lineItems", "orderRequestItems"];
      for (const sp of tryPaths) {
        const subUrl = `${detailBase}/${orderId}/${sp}/?pageSize=250`;
        const sub = await simproReqWithRetry("GET", subUrl, null, { maxAttempts: 2 });
        subAttempts.push({ url: subUrl, status: sub.status, count: Array.isArray(sub.data) ? sub.data.length : null });
        if (sub.ok && Array.isArray(sub.data) && sub.data.length > 0) {
          lines = sub.data;
          usedSubUrl = subUrl;
          break;
        }
      }
      if (lines.length === 0) {
        // Fall back to whatever the order body inlined.
        lines =
          order?.Catalogs ??
          order?.LineItems ??
          order?.Items ??
          order?.Lines ??
          order?.OrderRequestItems ??
          [];
      }

      if (!_debugFirstLines && Array.isArray(lines) && lines.length > 0) {
        _debugFirstLines = {
          orderId,
          subAttempts,
          usedSubUrl,
          count: lines.length,
          topKeys: Object.keys(lines[0] || {}),
          sample: lines[0],
        };
      }

      (Array.isArray(lines) ? lines : []).forEach(line => {
        const catalogId =
          line?.Catalog?.ID ??
          line?.Prebuild?.ID ??
          line?.CatalogID ??
          line?.PrebuildID ??
          line?.ID ?? // in the /catalogs/ sub-resource, top-level ID is often the catalog ID
          null;
        if (catalogId == null) return;
        const lineQty =
          (typeof line?.Quantity === "number" ? line.Quantity : null) ??
          line?.Quantity?.Value ??
          line?.Qty ??
          line?.OrderedQuantity ??
          line?.Ordered ??
          0;
        if (!lineQty) return;
        byCatalogId[catalogId] = (byCatalogId[catalogId] || 0) + lineQty;
      });
      countedOrders++;
    });

    await _pLimit(tasks, 3);

    return {
      byCatalogId,
      totalOrders: orders.length,
      countedOrders,
      fetchedAt: new Date().toISOString(),
      _debug: {
        workingListUrl,
        resourceName,
        listAttempts: _debugListAttempts,
        firstOrder: _debugFirstOrder,
        firstLines: _debugFirstLines,
      },
    };
  });

// ─── Get Simpro Schedule ──────────────────────────────────────────────────────
exports.getSimproSchedule = functions.https.onCall(async (data) => {
  const { dateFrom, dateTo } = data || {};

  const url = `${SIMPRO_BASE}/schedules/?pageSize=250`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` },
  });
  if (!resp.ok) {
    throw new functions.https.HttpsError("internal", `Simpro error: ${resp.status}`);
  }

  let schedules = await resp.json();

  if (dateFrom) schedules = schedules.filter(s => s.Date >= dateFrom);
  if (dateTo)   schedules = schedules.filter(s => s.Date <= dateTo);

  return schedules;
});

// ─── Get Simpro Schedule grouped by Job ───────────────────────────────────────
// Paginates the full /schedules/ feed, filters to Type === "job" and the
// supplied date range, and groups by Simpro project ID → sorted array of
// unique YYYY-MM-DD dates that project appeared on the schedule.
// Used by the Scoreboard to count "active days" (days a crew was scheduled
// on a job) so we can tell which days a daily update was missed.
// Data-safety: read-only on Simpro. No Firestore writes. A non-OK page
// response logs a warning and returns whatever we've accumulated so far
// rather than throwing, so the Scoreboard degrades gracefully instead of
// losing all miss data on a transient 429/5xx.
exports.getSimproScheduleByJob = functions
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onCall(async (data) => {
    const { dateFrom, dateTo } = data || {};

    const all = [];
    let page = 1;
    const MAX_PAGES = 60;
    while (page <= MAX_PAGES) {
      const resp = await fetch(
        `${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}`,
        { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } }
      );
      if (!resp.ok) {
        functions.logger.warn("getSimproScheduleByJob page failed", {
          page, status: resp.status,
        });
        break;
      }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 250) break;
      page++;
    }

    // Group Type === "job" rows by Project.ProjectID → { date → Set<staffName> }
    // We track staff-per-day (not just dates) so the Scoreboard can attribute
    // credit/miss to whichever lead was actually on the job that day, even
    // when that isn't the assigned lead on the job doc.
    const byJob = {};
    all.forEach(s => {
      if (!s || s.Type !== "job") return;
      const date = s.Date;
      if (!date) return;
      if (dateFrom && date < dateFrom) return;
      if (dateTo   && date > dateTo)   return;
      const pid = String((s.Project && s.Project.ProjectID) || "");
      if (!pid) return;
      const staffName = (s.Staff && s.Staff.Name) || "";
      if (!byJob[pid]) byJob[pid] = {};
      if (!byJob[pid][date]) byJob[pid][date] = new Set();
      if (staffName) byJob[pid][date].add(staffName);
    });

    // Materialize staff-name sets as arrays for JSON transport.
    const byJobOut = {};
    Object.entries(byJob).forEach(([pid, dateMap]) => {
      const outDates = {};
      Object.entries(dateMap).forEach(([date, staffSet]) => {
        outDates[date] = [...staffSet].sort();
      });
      byJobOut[pid] = outDates;
    });

    return {
      byJob: byJobOut,
      totalRows: all.length,
      jobsCovered: Object.keys(byJobOut).length,
      fetchedAt: new Date().toISOString(),
    };
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Thursday 5pm Mountain Time
// Friday Scheduling & Strategy Packet — uploaded as a Google Doc
// to a Drive folder and announced via FCM push to Koy.
// Read-only on jobs; writes one new Google Doc per run.
// ─────────────────────────────────────────────────────────────

// Drive folder ID where weekly packets are saved.
// Koy must share this folder with the service account
// (<project>@appspot.gserviceaccount.com) as Editor before deploy.
// See setup notes at bottom of this block.
const PACKET_DRIVE_FOLDER_ID = "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb";

const { google } = require("googleapis");

function _daysBetween(a, b) {
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

function _mtNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function _fmtShortDate(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? parseDate(d) : d;
  if (!dt) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function _esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

function _stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function _flatPunchWaiting(punch) {
  const out = [];
  ["upper", "main", "basement"].forEach(floor => {
    const f = (punch && punch[floor]) || {};
    const gen = f.general || [];
    const hc  = f.hotcheck || [];
    const rooms = f.rooms || [];
    [...gen, ...hc].forEach(i => {
      if (!i.done && i.waiting) out.push({ text: i.text, waitingOn: i.waitingOn });
    });
    rooms.forEach(r => (r.items || []).forEach(i => {
      if (!i.done && i.waiting) out.push({ text: i.text, waitingOn: i.waitingOn });
    }));
  });
  return out;
}

function _flatQuestions(qs) {
  const out = [];
  ["upper", "main", "basement"].forEach(floor => {
    ((qs || {})[floor] || []).forEach(q => {
      if (!q.done && !(q.answer || "").trim()) out.push(q.question);
    });
  });
  return out;
}

exports.thursdayPacket = functions.pubsub
  .schedule("0 17 * * 4")
  .timeZone(TZ)
  .onRun(async () => {
    const snap = await db.collection("jobs").get();
    const jobs = snap.docs
      .map(d => {
        const raw = d.data() || {};
        const data = raw.data || {};
        return { id: d.id, ...data };
      })
      .filter(j => j && j.name);

    const isComplete = (j) =>
      j.finishStatus === "complete" || parseInt(j.finishStage) === 100;
    const active     = jobs.filter(j => !isComplete(j));
    const activeJobs = active.filter(j => j.type !== "quote");
    const quotes     = active.filter(j => j.type === "quote");

    const now   = _mtNow();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ── SECTION 1: NEEDS SCHEDULING ───────────────────────────

    // 1a. Jobs with no start date (not in progress / not complete)
    const noStartDate = activeJobs.filter(j => {
      if (j.roughScheduledDate || j.roughStatusDate) return false;
      const rs = j.roughStatus || "";
      if (rs === "inprogress" || rs === "complete") return false;
      return true;
    });

    // 1b. Approved COs awaiting schedule
    const approvedCOsNotScheduled = [];
    activeJobs.forEach(j => {
      (j.changeOrders || []).forEach((co, i) => {
        if (co.coStatus === "approved") {
          approvedCOsNotScheduled.push({
            jobName: j.name,
            coNum:   i + 1,
            coDesc:  _stripHtml(co.description).slice(0, 80),
          });
        }
      });
    });

    // 1c. Return trips needing schedule
    const rtsNeedingSchedule = [];
    activeJobs.forEach(j => {
      (j.returnTrips || []).forEach((rt, i) => {
        if (rt.signedOff || rt.rtScheduled) return;
        const needs = rt.rtStatus === "needs" || rt.needsSchedule === true;
        if (needs) {
          rtsNeedingSchedule.push({
            jobName: j.name,
            rtNum:   i + 1,
            scope:   (rt.scope || "").slice(0, 80),
          });
        }
      });
    });

    // 1d. QC walks needed
    const qcWalksNeeded = activeJobs.filter(j => j.qcStatus === "needs");

    // 1e. Matterport pending on rough-complete / finish-active jobs
    const matterportPending = activeJobs.filter(j => {
      if (j.matterportStatus === "complete") return false;
      const rs = j.roughStatus || "";
      const fs = j.finishStatus || "";
      return rs === "complete" || fs === "inprogress" ||
             fs === "scheduled" || fs === "complete";
    });

    // 1f. Finish date missing — ONLY if rough-complete 50+ days
    const finishDateMissingLong = activeJobs.filter(j => {
      if (j.finishScheduledDate || j.finishStatusDate) return false;
      if (j.roughStatus !== "complete") return false;
      const roughEnd = parseDate(j.roughStatusDate);
      if (!roughEnd) return false;
      return _daysBetween(today, roughEnd) >= 50;
    });

    // ── SECTION 2: PIPELINE / STRATEGY ────────────────────────

    // 2a. Quotes aging (oldest first; unknown age sinks to the bottom)
    const quotesAging = quotes
      .map(q => {
        const created = q.createdAt ? new Date(q.createdAt) : null;
        const days = (created && !isNaN(created))
          ? _daysBetween(today, new Date(created.getFullYear(), created.getMonth(), created.getDate()))
          : null;
        return { ...q, _ageDays: days };
      })
      .sort((a, b) => (b._ageDays == null ? -1 : b._ageDays) - (a._ageDays == null ? -1 : a._ageDays));

    // 2b. Ready to invoice
    const readyToInvoice = activeJobs.filter(j => j.readyToInvoice);

    // 2c. Flagged
    const flagged = activeJobs.filter(j => j.flagged);

    // 2d. Waiting items clustered by reason
    const waitingByReason = {};
    activeJobs.forEach(j => {
      ["roughPunch", "finishPunch", "qcPunch"].forEach(phase => {
        _flatPunchWaiting(j[phase]).forEach(item => {
          const reason = (item.waitingOn || "").trim() || "Unspecified";
          if (!waitingByReason[reason]) waitingByReason[reason] = [];
          waitingByReason[reason].push({
            jobName: j.name,
            text:    _stripHtml(item.text).slice(0, 80),
          });
        });
      });
    });

    // 2e. Unassigned foreman or lead
    const unassigned = activeJobs.filter(j => {
      const noForeman = !j.foreman || j.foreman === "Unassigned";
      const noLead    = !j.lead    || j.lead    === "Unassigned";
      return noForeman || noLead;
    });

    // 2f. Jobs with unanswered questions
    const unansweredQs = [];
    activeJobs.forEach(j => {
      const r = _flatQuestions(j.roughQuestions);
      const f = _flatQuestions(j.finishQuestions);
      if (r.length + f.length > 0) {
        unansweredQs.push({ jobName: j.name, roughCount: r.length, finishCount: f.length });
      }
    });

    // ── SECTION 3: FORWARD LOOKING ────────────────────────────

    const dayOfWeek   = today.getDay();
    const diffToMon   = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const mondayThis  = new Date(today);
    mondayThis.setDate(today.getDate() + diffToMon);

    const weekBuckets = [0, 1, 2, 3].map(w => ({ weekOffset: w, jobs: [] }));
    activeJobs.forEach(j => {
      const d = parseDate(j.roughScheduledDate) || parseDate(j.finishScheduledDate);
      if (!d) return;
      const diffDays = _daysBetween(d, mondayThis);
      const weekIdx  = Math.floor(diffDays / 7);
      if (weekIdx >= 0 && weekIdx < 4) {
        weekBuckets[weekIdx].jobs.push(j);
      }
    });

    // 3b. Conflicts — same person on 2+ jobs same week
    const conflicts = [];
    weekBuckets.forEach(b => {
      const group = (role) => {
        const m = {};
        b.jobs.forEach(j => {
          const who = j[role];
          if (!who || who === "Unassigned") return;
          m[who] = m[who] || [];
          m[who].push(j.name);
        });
        return m;
      };
      Object.entries(group("foreman")).forEach(([p, js]) => {
        if (js.length > 1) conflicts.push({ weekOffset: b.weekOffset, role: "Foreman", person: p, jobs: js });
      });
      Object.entries(group("lead")).forEach(([p, js]) => {
        if (js.length > 1) conflicts.push({ weekOffset: b.weekOffset, role: "Lead", person: p, jobs: js });
      });
    });

    // 3c. This week — completions & slips
    const completedThisWeek = jobs.filter(j => {
      if (j.finishStatus !== "complete") return false;
      const d = parseDate(j.finishStatusDate);
      return d && _daysBetween(today, d) >= 0 && _daysBetween(today, d) <= 7;
    });
    const slippedThisWeek = activeJobs.filter(j => {
      const d = parseDate(j.roughScheduledDate);
      if (!d) return false;
      const da = _daysBetween(today, d);
      if (da > 7 || da < 0) return false;
      const rs = j.roughStatus || "";
      return rs !== "inprogress" && rs !== "complete";
    });

    // ── COMPLIANCE: daily-update compliance (weekly + yearly) ────────
    // Attribution rule (per Koy 2026-04-17):
    //   For each (date, simproNo) where any staff was scheduled in Simpro:
    //     • If the job's assigned lead was present that day → responsibility
    //       belongs to the assigned lead (only).
    //     • If the assigned lead was NOT present but other lead(s) were →
    //       responsibility falls to those present lead(s).
    //     • If no leads present → no attribution (skip).
    //   Hit = the job has ANY daily update (rough or finish) for that date,
    //   regardless of who added it. Counted as unique (date, simproNo)
    //   tuples per lead ("job-days").
    const complianceWindow = 7;
    const complianceEnd = new Date(today);
    const weeklyStart = new Date(today);
    weeklyStart.setDate(today.getDate() - (complianceWindow - 1));

    // Yearly tally anchor (per Koy 2026-04-17):
    //   • Initial rollout: start 1 month back from today (so there's
    //     history to look at the first time we see the tally).
    //   • On Jan 1, 2027: reset — the anchor becomes Jan 1 of the
    //     current calendar year, rolling each New Year after that.
    // The initial anchor (2026-03-17) is frozen; we don't slide it
    // forward day-by-day or the denominator would never grow.
    const YEARLY_INITIAL_ANCHOR = new Date(2026, 2, 17); // Mar 17, 2026
    let yearlyStart;
    if (today.getFullYear() >= 2027) {
      yearlyStart = new Date(today.getFullYear(), 0, 1);
    } else {
      yearlyStart = YEARLY_INITIAL_ANCHOR;
    }

    const _ymdLocal = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const weeklyStartYMD = _ymdLocal(weeklyStart);
    const weeklyEndYMD   = _ymdLocal(complianceEnd);
    const yearlyStartYMD = _ymdLocal(yearlyStart);
    const yearlyEndYMD   = _ymdLocal(complianceEnd);

    let scheduleEntries = [];
    try {
      // Paginate through Simpro schedules, filter to yearly window
      // client-side (matches existing getSimproSchedule callable behavior).
      // Bumped cap to 60 pages to accommodate a full year of data.
      let page = 1;
      while (page <= 60) {
        const resp = await fetch(`${SIMPRO_BASE}/schedules/?pageSize=250&page=${page}`, {
          headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` },
        });
        if (!resp.ok) {
          functions.logger.warn("thursdayPacket simpro schedule page failed", { page, status: resp.status });
          break;
        }
        const batch = await resp.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        scheduleEntries.push(...batch);
        if (batch.length < 250) break;
        page++;
      }
      scheduleEntries = scheduleEntries.filter(s =>
        s && s.Date && s.Date >= yearlyStartYMD && s.Date <= yearlyEndYMD
      );
    } catch (e) {
      functions.logger.warn("thursdayPacket simpro schedule fetch error", { error: e.message });
      scheduleEntries = [];
    }

    // A "lead" is anyone assigned as .lead on any active job.
    const leadSet = new Set();
    activeJobs.forEach(j => {
      if (j.lead && j.lead !== "Unassigned") leadSet.add(j.lead);
    });

    const jobBySimproNo = {};
    activeJobs.forEach(j => {
      if (j.simproNo) jobBySimproNo[String(j.simproNo)] = j;
    });

    // Normalize app-side update dates to YYYY-MM-DD so they compare
    // cleanly against Simpro's s.Date. The app's DateInp stores dates
    // as M/D/YYYY (e.g. "4/16/2026"), not YYYY-MM-DD.
    const _toYMD = (raw) => {
      if (!raw) return "";
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = m[1].padStart(2, "0");
        const dd = m[2].padStart(2, "0");
        return `${m[3]}-${mm}-${dd}`;
      }
      // Fallback: parse as Date and format
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      }
      return s;
    };

    // Group schedule entries by (date, simproNo) → Set<staffName present that day>
    const presenceByDateJob = new Map();  // key "YYYY-MM-DD|simproNo"
    scheduleEntries.forEach(s => {
      if (s.Type !== "job") return;
      const date = s.Date;
      const pid = String((s.Project && s.Project.ProjectID) || "");
      const staffName = (s.Staff && s.Staff.Name) || "";
      if (!date || !pid || !staffName) return;
      const key = `${date}|${pid}`;
      if (!presenceByDateJob.has(key)) presenceByDateJob.set(key, new Set());
      presenceByDateJob.get(key).add(staffName);
    });

    const oppsByLead   = {}; // weekly opportunities per lead → Set<key>
    const hitsByLead   = {}; // weekly hits
    const oppsByLeadYr = {}; // yearly opportunities
    const hitsByLeadYr = {}; // yearly hits

    presenceByDateJob.forEach((staffSet, key) => {
      const [date, pid] = key.split("|");
      const job = jobBySimproNo[pid];
      if (!job) return; // only count jobs we track in the app

      // Determine who's responsible per the attribution rule.
      const assignedLead = job.lead && job.lead !== "Unassigned" ? job.lead : null;
      let responsibleLeads = [];
      if (assignedLead && staffSet.has(assignedLead)) {
        // Assigned lead was there → they own it.
        responsibleLeads = [assignedLead];
      } else {
        // Assigned lead absent → any other present leads share responsibility.
        responsibleLeads = [...staffSet].filter(s => leadSet.has(s));
      }
      if (responsibleLeads.length === 0) return;

      const updates = [...(job.roughUpdates || []), ...(job.finishUpdates || [])];
      const hit = updates.some(u => u && _toYMD(u.date) === date);

      const inWeekly = date >= weeklyStartYMD && date <= weeklyEndYMD;
      const inYearly = date >= yearlyStartYMD && date <= yearlyEndYMD;

      responsibleLeads.forEach(lead => {
        if (inYearly) {
          if (!oppsByLeadYr[lead]) oppsByLeadYr[lead] = new Set();
          oppsByLeadYr[lead].add(key);
          if (hit) {
            if (!hitsByLeadYr[lead]) hitsByLeadYr[lead] = new Set();
            hitsByLeadYr[lead].add(key);
          }
        }
        if (inWeekly) {
          if (!oppsByLead[lead]) oppsByLead[lead] = new Set();
          oppsByLead[lead].add(key);
          if (hit) {
            if (!hitsByLead[lead]) hitsByLead[lead] = new Set();
            hitsByLead[lead].add(key);
          }
        }
      });
    });

    const _buildRows = (opps, hits) =>
      Object.keys(opps).map(lead => {
        const total = opps[lead].size;
        const h     = (hits[lead] || new Set()).size;
        const pct   = total > 0 ? Math.round((h / total) * 100) : 0;
        return { lead, hits: h, total, pct };
      }).sort((a, b) => b.pct - a.pct || a.lead.localeCompare(b.lead));

    const complianceRows   = _buildRows(oppsByLead,   hitsByLead);
    const complianceRowsYr = _buildRows(oppsByLeadYr, hitsByLeadYr);

    // ── BUILD HTML ────────────────────────────────────────────

    const section = (title, count, body) => {
      const badge = count > 0
        ? `<span style="background:#dc262620;color:#dc2626;padding:2px 8px;border-radius:99px;font-size:11px;margin-left:8px">${count}</span>`
        : `<span style="background:#16a34a20;color:#16a34a;padding:2px 8px;border-radius:99px;font-size:11px;margin-left:8px">0</span>`;
      return `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;margin:18px 0 8px;color:#111">${title}${badge}</h3>${body}`;
    };

    const list = (items, render) => {
      if (!items.length) return `<div style="color:#9ca3af;font-size:12px;padding:2px 0 6px">None.</div>`;
      return `<ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.55;color:#111">${items.map(i => `<li style="margin-bottom:2px">${render(i)}</li>`).join("")}</ul>`;
    };

    const bigHeader = (t) => `<h2 style="font-size:15px;margin:28px 0 2px;padding-top:14px;border-top:2px solid #111;color:#111">${t}</h2>`;

    const weekBucketsHtml = weekBuckets.map(b => {
      const weekMon = new Date(mondayThis); weekMon.setDate(mondayThis.getDate() + b.weekOffset * 7);
      const label = b.weekOffset === 0 ? "This week"
                  : b.weekOffset === 1 ? "Next week"
                  : `Week of ${weekMon.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      if (b.jobs.length === 0) return `<div style="margin:4px 0;color:#9ca3af;font-size:12px"><b style="color:#111">${label}:</b> nothing scheduled</div>`;
      return `<div style="margin:4px 0;font-size:13px;line-height:1.55"><b>${label}</b> <span style="color:#6b7280">(${b.jobs.length})</span>: ${b.jobs.map(j => _esc(j.name)).join(", ")}</div>`;
    }).join("");

    const waitingHtml = Object.keys(waitingByReason).length
      ? Object.entries(waitingByReason).map(([reason, items]) =>
          `<div style="margin:6px 0 10px"><div style="font-size:13px;font-weight:700;margin-bottom:2px">${_esc(reason)} <span style="color:#6b7280;font-weight:normal">(${items.length})</span></div><ul style="margin:0;padding:0 0 0 18px;font-size:12px;line-height:1.5;color:#374151">${items.map(i => `<li>${_esc(i.jobName)} — ${_esc(i.text)}</li>`).join("")}</ul></div>`
        ).join("")
      : `<div style="color:#9ca3af;font-size:12px;padding:2px 0 6px">None.</div>`;

    const _renderComplianceRows = (rows, emptyLabel) => rows.length === 0
      ? `<div style="color:#9ca3af;font-size:12px;padding:2px 0 6px">${emptyLabel}</div>`
      : `<ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.55;color:#111">${rows.map(r => {
          const color = r.pct >= 90 ? "#16a34a" : r.pct >= 70 ? "#f59e0b" : "#dc2626";
          return `<li style="margin-bottom:2px"><b>${_esc(r.lead)}</b>: ${r.hits}/${r.total} job-days <span style="color:${color};font-weight:700">(${r.pct}%)</span></li>`;
        }).join("")}</ul>`;

    const complianceHtml   = _renderComplianceRows(
      complianceRows,
      `No lead schedule entries found for the last ${complianceWindow} days.`,
    );
    const _yearlyStartLabel = yearlyStart.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const complianceYrHtml = _renderComplianceRows(
      complianceRowsYr,
      `No lead schedule entries found since ${_yearlyStartLabel}.`,
    );

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#111">
<h1 style="font-size:22px;margin:0 0 4px">Friday Scheduling &amp; Strategy Packet</h1>
<div style="color:#6b7280;font-size:12px;margin-bottom:8px">${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>

${bigHeader(`Daily Update Compliance · last ${complianceWindow} days`)}
${complianceHtml}
<div style="color:#6b7280;font-size:11px;margin-top:6px;font-style:italic">A "job-day" = one (lead, date, job) where the lead was on-site in Simpro. Assigned lead owns it if present; otherwise other present leads share it. Hit = the job got any daily update for that date.</div>

<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin:18px 0 6px;color:#374151">Year-to-date · since ${_yearlyStartLabel}</h3>
${complianceYrHtml}

${bigHeader("Needs Scheduling")}
${section("No start date set", noStartDate.length, list(noStartDate, j => `<b>${_esc(j.name)}</b>${j.foreman ? ` · ${_esc(j.foreman)}` : ""}${j.simproNo ? ` · #${_esc(j.simproNo)}` : ""}`))}
${section("Approved COs awaiting schedule", approvedCOsNotScheduled.length, list(approvedCOsNotScheduled, c => `<b>${_esc(c.jobName)}</b> · CO #${c.coNum}${c.coDesc ? ` — ${_esc(c.coDesc)}` : ""}`))}
${section("Return trips needing schedule", rtsNeedingSchedule.length, list(rtsNeedingSchedule, r => `<b>${_esc(r.jobName)}</b> · RT #${r.rtNum}${r.scope ? ` — ${_esc(r.scope)}` : ""}`))}
${section("QC walks needed", qcWalksNeeded.length, list(qcWalksNeeded, j => `<b>${_esc(j.name)}</b>${j.foreman ? ` · ${_esc(j.foreman)}` : ""}`))}
${section("Matterport scans pending", matterportPending.length, list(matterportPending, j => `<b>${_esc(j.name)}</b>${j.foreman ? ` · ${_esc(j.foreman)}` : ""}`))}
${section("Finish date missing (rough complete 50+ days)", finishDateMissingLong.length, list(finishDateMissingLong, j => {
      const re = parseDate(j.roughStatusDate);
      const d  = re ? _daysBetween(today, re) : 0;
      return `<b>${_esc(j.name)}</b> · ${d}d since rough complete`;
    }))}

${bigHeader("Pipeline & Strategy")}
${section("Quotes aging", quotesAging.length, list(quotesAging, q => `<b>${_esc(q.name)}</b>${q.quoteNumber ? ` · ${_esc(q.quoteNumber)}` : ""}${q._ageDays != null ? ` · ${q._ageDays}d old` : " · age unknown"}`))}
${section("Ready to invoice", readyToInvoice.length, list(readyToInvoice, j => `<b>${_esc(j.name)}</b>${j.foreman ? ` · ${_esc(j.foreman)}` : ""}`))}
${section("Flagged jobs", flagged.length, list(flagged, j => `<b>${_esc(j.name)}</b>${j.flagNote ? ` — ${_esc(j.flagNote)}` : ""}`))}
${section("Jobs missing foreman or lead", unassigned.length, list(unassigned, j => {
      const m = [];
      if (!j.foreman || j.foreman === "Unassigned") m.push("foreman");
      if (!j.lead    || j.lead    === "Unassigned") m.push("lead");
      return `<b>${_esc(j.name)}</b> · missing ${m.join(" + ")}`;
    }))}
${section("Jobs with unanswered questions", unansweredQs.length, list(unansweredQs, u => `<b>${_esc(u.jobName)}</b> · ${u.roughCount ? `${u.roughCount} rough` : ""}${u.roughCount && u.finishCount ? " · " : ""}${u.finishCount ? `${u.finishCount} finish` : ""}`))}
${section("Waiting on — clustered by reason", Object.keys(waitingByReason).length, waitingHtml)}

${bigHeader("Next 4 Weeks")}
${weekBucketsHtml}
${section("Conflicts (same person, same week)", conflicts.length, list(conflicts, c => {
      const weekLbl = c.weekOffset === 0 ? "this week" : c.weekOffset === 1 ? "next week" : `week ${c.weekOffset + 1}`;
      return `${c.role} <b>${_esc(c.person)}</b> on ${c.jobs.length} jobs ${weekLbl}: ${c.jobs.map(_esc).join(", ")}`;
    }))}

${bigHeader("This Week")}
${section("Completed", completedThisWeek.length, list(completedThisWeek, j => `<b>${_esc(j.name)}</b>${j.foreman ? ` · ${_esc(j.foreman)}` : ""}`))}
${section("Slipped (scheduled but didn't start)", slippedThisWeek.length, list(slippedThisWeek, j => `<b>${_esc(j.name)}</b> · scheduled ${_fmtShortDate(j.roughScheduledDate)}`))}

${bigHeader("Last Week's Decisions")}
<div style="color:#9ca3af;font-size:12px;padding:2px 0 6px;font-style:italic">Decision tracking is on the list — nothing captured yet.</div>

<div style="margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px">Generated ${now.toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" })} MT · Homestead Electric app</div>
</div>`;

    const docTitle = `Friday Packet — ${today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    // ── Upload to Drive as a Google Doc ───────────────────────
    let docLink = "";
    let docId   = "";
    try {
      if (!PACKET_DRIVE_FOLDER_ID || PACKET_DRIVE_FOLDER_ID === "REPLACE_WITH_FOLDER_ID") {
        throw new Error("PACKET_DRIVE_FOLDER_ID not configured in functions/index.js");
      }

      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      });
      const drive = google.drive({ version: "v3", auth });

      const createRes = await drive.files.create({
        requestBody: {
          name:     docTitle,
          parents:  [PACKET_DRIVE_FOLDER_ID],
          mimeType: "application/vnd.google-apps.document",
        },
        media: {
          mimeType: "text/html",
          body:     html,
        },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      docId   = createRes.data.id || "";
      docLink = createRes.data.webViewLink || "";
    } catch (e) {
      functions.logger.error("thursdayPacket Drive upload failed", { error: e.message });
      // Fall through — we still notify Koy with the failure so it's visible.
      await sendToName("Koy", {
        title: "⚠️ Thursday Packet Failed",
        body:  `Drive upload error: ${e.message.slice(0, 120)}`,
      });
      return null;
    }

    // ── Notify Koy with a link to the doc ─────────────────────
    await sendToName("Koy", {
      title: "📋 Friday Packet Ready",
      body:  `${docTitle} is in Drive — tap to open`,
      // Reuse existing push shape; link is included in data payload so
      // the SW / client can route the user to it.
      jobId:   "",
      section: docLink,
    });

    functions.logger.info("thursdayPacket saved to Drive", {
      docId,
      docLink,
      noStartDate:        noStartDate.length,
      approvedCOs:        approvedCOsNotScheduled.length,
      rts:                rtsNeedingSchedule.length,
      qc:                 qcWalksNeeded.length,
      matterport:         matterportPending.length,
      finishMissing50:    finishDateMissingLong.length,
      quotesAging:        quotesAging.length,
      readyToInvoice:     readyToInvoice.length,
      flagged:            flagged.length,
      unassigned:         unassigned.length,
      unanswered:         unansweredQs.length,
      waitingReasons:     Object.keys(waitingByReason).length,
      conflicts:          conflicts.length,
      completed:          completedThisWeek.length,
      slipped:            slippedThisWeek.length,
      complianceLeadsWeek: complianceRows.length,
      complianceLeadsYear: complianceRowsYr.length,
      complianceScheduleEntries: scheduleEntries.length,
    });

    return null;
  });

// ─────────────────────────────────────────────────────────────
// DRIVE — shared helpers for auto-folder-create & nightly sync
// ─────────────────────────────────────────────────────────────

// Parent folder in Drive where every job's folder lives.
// Koy must share this folder with the service account
// (<project>@appspot.gserviceaccount.com) as Editor before deploy.
const JOBS_PARENT_FOLDER_ID = "1laC4udt1sBdV-_QUMzzbKJfD03q4_Ml3";

// Normalize a name for fuzzy matching (mirrors App.js namesMatch).
function _normalizeName(name) {
  return String(name || "").toLowerCase()
    .replace(/#\d+\s*[-–—]?\s*/g, "")
    .replace(/\b(plans|residence|home|house|electrical)\b/gi, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _namesMatch(driveName, jobName) {
  const dn = _normalizeName(driveName);
  const jn = _normalizeName(jobName);
  if (!dn || !jn) return false;
  if (dn.includes(jn) || jn.includes(dn)) return true;
  const jobWords = jn.split(" ").filter(w => w.length > 2);
  if (jobWords.length > 0 && jobWords.every(w => dn.includes(w))) return true;
  return false;
}

// Build a Drive v3 client scoped to files this service account creates or is granted access to.
function _driveClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return google.drive({ version: "v3", auth });
}

// Build the folder name we'd create for a given job.
// Preferred: "#<simproNo> - <name>".  Fallback: "<name>".
function _jobFolderName(job) {
  const n = String(job.name || "").trim();
  const s = String(job.simproNo || "").trim();
  if (!n) return "";
  if (s) return `#${s} - ${n}`;
  return n;
}

// Guard: is this job ready for a Drive folder?
// - Has a usable name (not placeholder)
// - Not a quote
// - Doesn't already have a driveFolderId
function _needsDriveFolder(job) {
  const name = String(job.name || "").trim();
  if (!name || name.length < 3) return false;
  if (/^(new job|untitled|unnamed|test)$/i.test(name)) return false;
  if (job.type === "quote") return false;
  if (job.driveFolderId) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// FIRESTORE TRIGGER — jobs/{jobId} onWrite
// Auto-create a Drive folder when a job first appears (or is
// promoted from quote) without a driveFolderId.
// Idempotent: after folder is created, driveFolderId is set,
// so the next onWrite exits early.
// Read-only on everything except the single job doc it wrote.
// ─────────────────────────────────────────────────────────────

exports.ensureJobDriveFolder = functions.firestore
  .document("jobs/{jobId}")
  .onWrite(async (change, context) => {
    const jobId = context.params.jobId;
    if (!change.after.exists) return null; // job was deleted
    const after = change.after.data()?.data || {};

    if (!_needsDriveFolder(after)) return null;

    // Try to match an existing folder in the parent before creating a new one.
    // This handles the case where Koy already made the folder by hand.
    let folderId = "";
    let folderName = "";
    let createdNew = false;

    try {
      const drive = _driveClient();

      // 1. List candidate folders in the parent.
      const listRes = await drive.files.list({
        q: `'${JOBS_PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 200,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const existing = (listRes.data.files || []).filter(f => _namesMatch(f.name, after.name));

      if (existing.length === 1) {
        folderId   = existing[0].id;
        folderName = existing[0].name;
      } else if (existing.length === 0) {
        // 2. Create a new folder.
        const wantName = _jobFolderName(after);
        const createRes = await drive.files.create({
          requestBody: {
            name:     wantName,
            parents:  [JOBS_PARENT_FOLDER_ID],
            mimeType: "application/vnd.google-apps.folder",
          },
          fields: "id,name",
          supportsAllDrives: true,
        });
        folderId   = createRes.data.id || "";
        folderName = createRes.data.name || wantName;
        createdNew = true;
      } else {
        // Ambiguous — bail out and let nightlyDriveSync / human review resolve.
        functions.logger.info("ensureJobDriveFolder ambiguous match", {
          jobId, name: after.name, candidates: existing.map(e => e.name),
        });
        return null;
      }
    } catch (e) {
      functions.logger.error("ensureJobDriveFolder failed", { jobId, error: e.message });
      return null;
    }

    if (!folderId) return null;

    // Persist the ID to the job doc.  Dotted path preserves the rest of data.
    try {
      await change.after.ref.update({
        "data.driveFolderId": folderId,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      functions.logger.error("ensureJobDriveFolder failed to save folderId", {
        jobId, folderId, error: e.message,
      });
      return null;
    }

    await sendToName("Koy", {
      title: createdNew ? "📁 Drive Folder Created" : "📁 Drive Folder Linked",
      body:  `${after.name} → ${folderName}`,
      jobId, section: "Job Info",
    });

    functions.logger.info("ensureJobDriveFolder done", {
      jobId, name: after.name, folderId, folderName, createdNew,
    });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Nightly Drive sync (3am Mountain Time)
// Catch any jobs still missing a driveFolderId — match-existing
// or create-new, same logic as ensureJobDriveFolder but as a
// batch backstop.  Summary push to Koy.
// Read-only on jobs except for the driveFolderId field.
// ─────────────────────────────────────────────────────────────

exports.nightlyDriveSync = functions.pubsub
  .schedule("0 3 * * *")
  .timeZone(TZ)
  .onRun(async () => {
    let driveFolders = [];
    try {
      const drive = _driveClient();
      const listRes = await drive.files.list({
        q: `'${JOBS_PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 500,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      driveFolders = listRes.data.files || [];
    } catch (e) {
      functions.logger.error("nightlyDriveSync: list folders failed", { error: e.message });
      await sendToName("Koy", {
        title: "⚠️ Nightly Drive Sync Failed",
        body:  `Could not list Drive folders: ${e.message.slice(0, 120)}`,
      });
      return null;
    }

    const jobsSnap = await db.collection("jobs").get();
    const jobs = jobsSnap.docs
      .map(d => ({ id: d.id, ref: d.ref, data: d.data()?.data || {} }))
      .filter(j => j.data && j.data.name);

    const linked   = [];
    const created  = [];
    const ambiguous = [];
    const errors   = [];

    for (const j of jobs) {
      if (!_needsDriveFolder(j.data)) continue;

      const matches = driveFolders.filter(f => _namesMatch(f.name, j.data.name));

      try {
        if (matches.length === 1) {
          await j.ref.update({
            "data.driveFolderId": matches[0].id,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
          linked.push({ job: j.data.name, folder: matches[0].name });
        } else if (matches.length === 0) {
          // Create a new folder for this job.
          const wantName = _jobFolderName(j.data);
          const drive = _driveClient();
          const createRes = await drive.files.create({
            requestBody: {
              name:     wantName,
              parents:  [JOBS_PARENT_FOLDER_ID],
              mimeType: "application/vnd.google-apps.folder",
            },
            fields: "id,name",
            supportsAllDrives: true,
          });
          await j.ref.update({
            "data.driveFolderId": createRes.data.id,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
          created.push({ job: j.data.name, folder: createRes.data.name || wantName });
          driveFolders.push({ id: createRes.data.id, name: createRes.data.name || wantName });
        } else {
          ambiguous.push({ job: j.data.name, folders: matches.map(m => m.name) });
        }
      } catch (e) {
        errors.push({ job: j.data.name, error: e.message });
        functions.logger.warn("nightlyDriveSync: per-job failure", {
          job: j.data.name, error: e.message,
        });
      }
    }

    functions.logger.info("nightlyDriveSync summary", {
      linked:    linked.length,
      created:   created.length,
      ambiguous: ambiguous.length,
      errors:    errors.length,
    });

    // Only notify if something changed or needs attention.
    const acted = linked.length + created.length + ambiguous.length + errors.length;
    if (acted > 0) {
      const parts = [];
      if (linked.length)    parts.push(`linked ${linked.length}`);
      if (created.length)   parts.push(`created ${created.length}`);
      if (ambiguous.length) parts.push(`${ambiguous.length} ambiguous`);
      if (errors.length)    parts.push(`${errors.length} errors`);
      await sendToName("Koy", {
        title: "🗂️ Nightly Drive Sync",
        body:  parts.join(" · "),
      });
    }

    return null;
  });

// ─────────────────────────────────────────────────────────────
// CALLABLE — sendTestNotification
// Fires a test push to every token registered for the caller's user record.
// Also reports how many tokens are currently registered and how many were
// pruned as dead. Used by the "Send Test Notification" button in Settings
// to verify iOS/Android delivery end-to-end.
// ─────────────────────────────────────────────────────────────
exports.sendTestNotification = functions.https.onCall(async (data, context) => {
  const userId = (data && data.userId) || "";
  if (!userId) {
    throw new functions.https.HttpsError("invalid-argument", "userId is required");
  }

  const users = await getUsers();
  const user  = users.find(u => u.id === userId || u.name === userId);
  if (!user) {
    throw new functions.https.HttpsError("not-found", `No user matching ${userId}`);
  }

  const before = getTokens(user);
  if (before.length === 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No FCM tokens registered for this user. Grant notification permission on this device first."
    );
  }

  // Grab the first available job to use as the deep-link target. Falls back
  // to no jobId if the jobs collection is empty.
  let jobId   = "";
  let jobName = "";
  try {
    const jobsSnap = await db.collection("jobs").limit(1).get();
    if (!jobsSnap.empty) {
      const jobDoc = jobsSnap.docs[0];
      jobId   = jobDoc.id;
      jobName = (jobDoc.data()?.data?.name) || "";
    }
  } catch (e) {
    functions.logger.warn("sendTestNotification: failed to fetch sample job", { error: e.message });
  }

  const notif = {
    title:   "🧪 Homestead Test Notification",
    body:    jobName ? `Tap to open ${jobName}` : "Tap to open the app.",
    jobId,
    section: "",
  };

  // Send to every current token. sendFCM prunes dead tokens automatically
  // via removeStaleToken when the messaging error indicates registration
  // is invalid, so we re-fetch tokens after to compute what's left.
  await Promise.all(before.map(t => sendFCM(t, notif)));

  // Re-read the user record to find out what survived.
  const afterUsers = await getUsers();
  const afterUser  = afterUsers.find(u => u.id === userId || u.name === userId);
  const after      = afterUser ? getTokens(afterUser) : [];
  const pruned     = before.filter(t => !after.includes(t)).length;

  return {
    sent:      before.length,
    pruned,
    remaining: after.length,
    jobId,
    jobName,
  };
});
