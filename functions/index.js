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

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Load the users list from Firestore (stored as settings/users → {list:[...]}) */
async function getUsers() {
  const snap = await db.doc("settings/users").get();
  return (snap.exists && snap.data().list) ? snap.data().list : [];
}

/**
 * Return all FCM tokens for a user record.
 * Handles both the new array field (fcmTokens) and the legacy single-token
 * field (fcmToken) so existing data keeps working during the transition.
 */
function getTokens(user) {
  const tokens = [];
  if (Array.isArray(user.fcmTokens)) tokens.push(...user.fcmTokens);
  // Backward compat: include legacy single-token field if not already present
  if (user.fcmToken && !tokens.includes(user.fcmToken)) tokens.push(user.fcmToken);
  return tokens.filter(Boolean);
}

/**
 * Send a push notification to a single FCM token.
 * Silently skips if the token is missing or invalid.
 */
async function sendFCM(token, { title, body }) {
  if (!token) return;
  try {
    // Send as data-only — no notification field.
    // This prevents the browser from auto-showing a system notification
    // while the app is open (which would cause a double notification alongside
    // the in-app toast). The service worker and onMessage handler both read
    // from payload.data and display the notification themselves.
    await messaging.send({
      token,
      data: { title: title || "", body: body || "" },
      webpush: { headers: { Urgency: "high" } },
    });
  } catch (e) {
    functions.logger.warn("FCM send failed", { token: token.slice(0, 20), error: e.message });
  }
}

/**
 * Send to a user by their first name or full name.
 * Sends to ALL of their registered devices.
 * (job.foreman / job.lead are stored as display names like "Koy" or "Koy Wilkinson").
 */
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

/**
 * Send to all users whose title matches any value in the roles array.
 * Sends to ALL devices per user.
 * Excludes tokens already sent to (prevents double-notifying foreman who is also admin).
 * Roles: "admin", "manager", "foreman", "lead", "crew"
 */
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

/**
 * Get ALL FCM tokens for a named user (used to build excludeTokens lists).
 * Returns an array (empty if user not found or has no tokens).
 */
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

/**
 * Parse a date string that may be "MM/DD/YYYY", "M/D/YYYY", or "YYYY-MM-DD".
 * Returns a Date object or null.
 */
function parseDate(str) {
  if (!str) return null;
  // Try YYYY-MM-DD first
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + "T12:00:00");
  // Try M/D/YYYY
  const parts = str.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts.map(Number);
    if (m && d && y) return new Date(y, m - 1, d, 12, 0, 0);
  }
  return null;
}

/** Return true if date is exactly `daysAway` calendar days from today (Mountain Time). */
function isDaysAway(dateStr, daysAway) {
  const target = parseDate(dateStr);
  if (!target) return false;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  return diff === daysAway;
}

/** Get all question IDs from a questions object {upper:[], main:[], basement:[]} */
function getQuestionIds(q) {
  if (!q || typeof q !== "object") return new Set();
  const ids = new Set();
  ["upper", "main", "basement"].forEach(f =>
    (q[f] || []).forEach(item => { if (item.id) ids.add(item.id); })
  );
  return ids;
}

/** Returns true if afterQ has any question IDs that weren't in beforeQ */
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
  .onUpdate(async (change) => {
    // Job data is nested under the "data" field in Firestore
    const before = change.before.data()?.data || {};
    const after  = change.after.data()?.data  || {};
    const name   = after.name || "a job";

    const tasks = [];

    // ── 1. Foreman assigned / changed ─────────────────────────
    if (after.foreman && after.foreman !== before.foreman && after.foreman !== "Unassigned") {
      tasks.push(sendToName(after.foreman, {
        title: "🔨 Job Assigned to You",
        body:  `You've been assigned as foreman on ${name}`,
      }));
    }

    // ── 2. Lead assigned / changed ────────────────────────────
    if (after.lead && after.lead !== before.lead && after.lead !== "Unassigned") {
      tasks.push(sendToName(after.lead, {
        title: "📋 Job Assigned to You",
        body:  `You're the lead on ${name}`,
      }));
    }

    // ── 3. Ready to invoice ───────────────────────────────────
    if (!before.readyToInvoice && after.readyToInvoice) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
      }));
      // Exclude foreman's tokens so they don't get it twice if they're also admin
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
      }, foremanTokens));
    }

    // ── 4. Quote converted to job ─────────────────────────────
    if (before.type === "quote" && after.type !== "quote") {
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Quote Converted to Job",
        body:  `${name} is now a job — ready for billing`,
      }));
    }

    // ── 5. Job prep complete ──────────────────────────────────
    if (!allPrepDone(before) && allPrepDone(after)) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToName(after.foreman, {
        title: "✅ Job Prep Complete",
        body:  `Prep is done on ${name} — ready to roll`,
      }));
      // Exclude foreman's tokens so they don't get it twice if they're also admin
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Job Prep Complete",
        body:  `${name} prep is complete`,
      }, foremanTokens));
    }

    // ── 6. QC walk needs to be scheduled ─────────────────────
    if (before.qcStatus !== "needs" && after.qcStatus === "needs") {
      tasks.push(sendToName(after.foreman, {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk — please schedule it`,
      }));
    }

    // ── 6b. QC passed (auto-cleared after fail) ───────────────
    if (before.qcStatus === "fail" && after.qcStatus === "pass") {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
      }, foremanTokens));
      tasks.push(sendToName(after.foreman, {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
      }));
    }

    // ── 7. Change Orders ──────────────────────────────────────
    const beforeCOs = before.changeOrders || [];
    const afterCOs  = after.changeOrders  || [];

    // New CO created
    if (afterCOs.length > beforeCOs.length) {
      const newCOs = afterCOs.slice(beforeCOs.length);
      newCOs.forEach(co => {
        tasks.push(sendToName(after.foreman, {
          title: "📝 New Change Order",
          body:  `A new change order was created on ${name}`,
        }));
      });
    }

    // Existing CO status changed — match by ID so deletions don't cause misfires
    const beforeCOMap = {};
    beforeCOs.forEach(co => { if (co.id) beforeCOMap[co.id] = co; });
    afterCOs.forEach((co, i) => {
      const prev = co.id ? beforeCOMap[co.id] : beforeCOs[i];
      if (!prev) return;
      if (prev.coStatus !== "approved" && co.coStatus === "approved") {
        // CO approved → notify lead
        tasks.push(sendToName(after.lead, {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
        }));
      }
      if (prev.coStatus !== "complete" && co.coStatus === "complete") {
        // CO work completed → notify foreman
        tasks.push(sendToName(after.foreman, {
          title: "🔨 CO Work Completed",
          body:  `Change Order #${i + 1} work is done on ${name}`,
        }));
      }
    });

    // ── 8. Return Trips ───────────────────────────────────────
    const beforeRTs = before.returnTrips || [];
    const afterRTs  = after.returnTrips  || [];

    // Match by ID so deletions don't shift indices and cause misfires
    const beforeRTMap = {};
    beforeRTs.forEach(rt => { if (rt.id) beforeRTMap[rt.id] = rt; });

    afterRTs.forEach((rt, i) => {
      const prev = rt.id ? beforeRTMap[rt.id] : beforeRTs[i];

      // Return trip assigned to a lead
      const prevAssigned = prev?.assignedTo || "";
      if (rt.assignedTo && rt.assignedTo !== prevAssigned && rt.assignedTo !== "Unassigned") {
        tasks.push(sendToName(rt.assignedTo, {
          title: "🔄 Return Trip Assigned",
          body:  `You've been assigned to a return trip on ${name}`,
        }));
      }

      // Return trip signed off
      if (!prev?.signedOff && rt.signedOff) {
        tasks.push(sendToRoles(["admin", "manager"], {
          title: "✅ Return Trip Signed Off",
          body:  `Return Trip ${i + 1} on ${name} is signed off — slot is open`,
        }));
      }
    });

    // ── 9. Questions added (ID-based to prevent double-firing) ───
    if (hasNewQuestions(before.roughQuestions, after.roughQuestions)) {
      tasks.push(sendToName(after.foreman, {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
      }));
    }
    if (hasNewQuestions(before.finishQuestions, after.finishQuestions)) {
      tasks.push(sendToName(after.foreman, {
        title: "❓ New Question on Job",
        body:  `A new finish question was added on ${name}`,
      }));
    }

    await Promise.all(tasks);
    return null;
  });

// ─────────────────────────────────────────────────────────────
// FIRESTORE TRIGGER — homeowner_requests/{jobId} onWrite
// Question answered by GC/homeowner → notify lead
// ─────────────────────────────────────────────────────────────

exports.onQuestionAnswered = functions.firestore
  .document("homeowner_requests/{jobId}")
  .onWrite(async (change, context) => {
    const { jobId } = context.params;
    const before = change.before.exists ? change.before.data() : {};
    const after  = change.after.exists  ? change.after.data()  : {};

    // Check if any new answers appeared
    const beforeAnswers = before.questionAnswers || {};
    const afterAnswers  = after.questionAnswers  || {};

    // Count total answers in a questionAnswers map
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

    // Look up the job to get the lead's name
    const jobSnap = await db.doc(`jobs/${jobId}`).get();
    if (!jobSnap.exists) return null;
    const job = jobSnap.data()?.data || {};

    if (!job.lead) return null;

    await sendToName(job.lead, {
      title: "💬 Question Answered",
      body:  `A question was answered on ${job.name || "your job"}`,
    });

    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Daily 7am Mountain Time
// • Rough/Finish inspection date reminders (1 week, 2 days)
// • Job start within 1 week with incomplete prep → notify Koy
// • Job start within 2 days → urgent notify Koy
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

      // ── Plans check reminder 2 days before start ───────────
      if (job.roughScheduledDate && isDaysAway(job.roughScheduledDate, 2)) {
        tasks.push(sendToName("Koy", {
          title: "📋 Plans Check — Job Starts in 2 Days",
          body:  `${name} — verify plans are uploaded to app & SimPro`,
        }));
      }

      // ── Job start warnings (rough scheduled date) for Koy ──
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
// Notify all leads to submit their POs
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
// Notify all leads to enter their daily job update
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
