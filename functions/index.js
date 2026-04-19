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
  // Dedupe before returning so a stale array can't cause the same device
  // to fire the same notification multiple times.
  return Array.from(new Set(tokens.filter(Boolean)));
}

// ─── Dead-token cleanup ──────────────────────────────────────
// When FCM rejects a token (device uninstalled, token rotated, etc.) we must
// remove it from the user's record, or the same dead token will be sent to on
// every future notification — wasting quota and keeping ghost recipients alive.
async function removeDeadToken(userId, token) {
  if (!userId || !token) return;
  try {
    const ref = db.doc("settings/users");
    const snap = await ref.get();
    if (!snap.exists) return;
    const list = (snap.data().list || []).map(u => {
      if (u.id !== userId) return u;
      const arr = Array.isArray(u.fcmTokens) ? u.fcmTokens : (u.fcmToken ? [u.fcmToken] : []);
      const next = arr.filter(t => t !== token);
      const updated = { ...u, fcmTokens: next };
      // Clear the legacy singular field too if it matched.
      if (u.fcmToken === token) updated.fcmToken = "";
      return updated;
    });
    await ref.set({ list });
    functions.logger.info("Removed dead FCM token", {
      userId, tokenPrefix: token.slice(0, 20),
    });
  } catch (e) {
    functions.logger.warn("removeDeadToken failed", { userId, error: e.message });
  }
}

// ─── sendFCM ─────────────────────────────────────────────────
// Sends ONE push notification to ONE token on ONE device.
// Builds a cross-platform payload so Android + iOS Safari PWA + Chrome desktop
// all render the notification reliably, with click-to-deep-link into the job.
async function sendFCM(userId, token, { title, body, jobId, section }) {
  if (!token) return;

  const safeTitle   = title   || "";
  const safeBody    = body    || "";
  const safeJobId   = jobId   || "";
  const safeSection = section || "";
  // Tag dedupes same-job/same-section notifications on the same device.
  // Without a jobId we use a rolling tag so generic reminders don't stomp on each other.
  const tag = safeJobId
    ? `he-${safeJobId}-${safeSection}`
    : `he-rem-${safeSection || "reminder"}`;

  // Deep-link URL used by webpush fcmOptions.link AND by the SW notificationclick handler.
  const deepLinkPath = safeJobId
    ? `/?jobId=${encodeURIComponent(safeJobId)}&section=${encodeURIComponent(safeSection)}`
    : "/";

  const message = {
    token,
    // Top-level notification + data: delivered to every platform.
    notification: { title: safeTitle, body: safeBody },
    data: {
      title:   safeTitle,
      body:    safeBody,
      jobId:   safeJobId,
      section: safeSection,
    },
    // iOS Safari PWA — APNs headers are REQUIRED for reliable delivery on iOS 16.4+.
    // Without "apns-push-type: alert", Apple silently drops or batches the notification.
    apns: {
      headers: {
        "apns-priority":  "10",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          alert: { title: safeTitle, body: safeBody },
          sound: "default",
          "mutable-content": 1,
        },
      },
    },
    // Android — high priority wakes the device; the system renders the notification natively.
    android: {
      priority: "high",
      notification: {
        sound: "default",
        tag,
      },
    },
    // Web push (Chrome/Edge desktop + Android Chrome). We DO set notification here
    // so FCM's default Web SDK auto-displays it — our service worker no longer
    // calls showNotification manually (that was causing the double-pop on Android).
    webpush: {
      headers: { Urgency: "high" },
      notification: {
        title: safeTitle,
        body:  safeBody,
        icon:  "/icon-192.png",
        badge: "/icon-192.png",
        tag,
        data:  { jobId: safeJobId, section: safeSection },
        requireInteraction: false,
      },
      fcmOptions: {
        link: deepLinkPath,
      },
    },
  };

  try {
    await messaging.send(message);
  } catch (e) {
    const code = (e.errorInfo && e.errorInfo.code) || e.code || "";
    functions.logger.warn("FCM send failed", {
      userId,
      tokenPrefix: token.slice(0, 20),
      code,
      error: e.message,
    });
    // These error codes mean the token is dead — prune it so we stop sending.
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      await removeDeadToken(userId, token);
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
  await Promise.all(getTokens(user).map(t => sendFCM(user.id, t, notification)));
}

async function sendToRoles(roles, notification, excludeTokens = []) {
  const users = await getUsers();
  const targets = users.filter(u => roles.includes(u.title) || roles.includes(u.role));
  const sends = [];
  for (const u of targets) {
    for (const t of getTokens(u)) {
      if (!excludeTokens.includes(t)) sends.push(sendFCM(u.id, t, notification));
    }
  }
  await Promise.all(sends);
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

    // ── 6b. QC passed ─────────────────────────────────────────
    if (before.qcStatus === "fail" && after.qcStatus === "pass") {
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
// HTTPS CALLABLE — Send test notification
// ─────────────────────────────────────────────────────────────
// Called from SettingsPage's "Send Test Notification" button.
// Sends ONE test push to the caller's FCM tokens and also records what
// happened so the UI can tell them "0 tokens on file" vs. "sent 2".
exports.sendTestNotification = functions.https.onCall(async (data) => {
  const { userId } = data || {};
  if (!userId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing userId");
  }
  const users = await getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) {
    throw new functions.https.HttpsError("not-found", "User not found in settings/users");
  }
  const tokens = getTokens(user);
  if (!tokens.length) {
    return { sent: 0, reason: "no_tokens" };
  }

  // Find a real job to deep-link into, so the click can be verified end-to-end.
  const firstJobSnap = await db.collection("jobs").limit(1).get();
  const firstJob = firstJobSnap.docs[0];
  const jobId   = firstJob ? firstJob.id : "";
  const jobName = firstJob ? (firstJob.data()?.data?.name || "a job") : "a job";
  const when = new Date().toLocaleTimeString("en-US", { timeZone: TZ });

  await Promise.all(tokens.map(t => sendFCM(user.id, t, {
    title: "🔔 Homestead — Test",
    body:  `${when} · tap to open ${jobName}`,
    jobId,
    section: "Job Info",
  })));

  // Re-read tokens after send so we report the post-cleanup count too.
  const after = await getUsers();
  const afterUser = after.find(u => u.id === userId);
  const afterTokens = afterUser ? getTokens(afterUser) : [];
  const pruned = tokens.length - afterTokens.length;

  return {
    sent: tokens.length,
    pruned,
    remaining: afterTokens.length,
    jobId,
    jobName,
  };
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
  try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, data: text }; }
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

// ─── Get Simpro Schedule ──────────────────────────────────────────────────────
// Fetches schedule entries from Simpro for a given date range.
// Returns both job and activity entries so the UI can show a complete picture.
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

  // Filter to requested date range client-side (Simpro ignores query params)
  if (dateFrom) schedules = schedules.filter(s => s.Date >= dateFrom);
  if (dateTo)   schedules = schedules.filter(s => s.Date <= dateTo);

  return schedules;
});
