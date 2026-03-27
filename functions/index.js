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

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Load the users list from Firestore (stored as settings/users → {list:[...]}) */
async function getUsers() {
  const snap = await db.doc("settings/users").get();
  return (snap.exists && snap.data().list) ? snap.data().list : [];
}

/**
 * Send a push notification to a single FCM token.
 * Silently skips if the token is missing.
 */
async function sendFCM(token, { title, body }) {
  if (!token) return;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      webpush: {
        notification: {
          icon: "https://homestead-electric.vercel.app/logo192.png",
          badge: "https://homestead-electric.vercel.app/logo192.png",
        },
      },
    });
  } catch (e) {
    // Token may be stale — log but don't throw
    functions.logger.warn("FCM send failed", { token: token.slice(0, 20), error: e.message });
  }
}

/**
 * Send to a user by their first name or full name
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
  if (user?.fcmToken) await sendFCM(user.fcmToken, notification);
}

/**
 * Send to all users whose title matches any value in the roles array.
 * Roles: "admin", "manager", "foreman", "lead", "crew"
 */
async function sendToRoles(roles, notification) {
  const users = await getUsers();
  const targets = users.filter(u => roles.includes(u.title) || roles.includes(u.role));
  await Promise.all(targets.filter(u => u.fcmToken).map(u => sendFCM(u.fcmToken, notification)));
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

/** Count total items in a questions object {upper:[], main:[], basement:[]} */
function countQuestions(q) {
  if (!q || typeof q !== "object") return 0;
  return (q.upper || []).length + (q.main || []).length + (q.basement || []).length;
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
      tasks.push(sendToName(after.foreman, {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
      }));
    }

    // ── 4. Quote converted to job ─────────────────────────────
    if (before.type === "quote" && after.type !== "quote") {
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Quote Converted to Job",
        body:  `${name} is now a job — ready for billing`,
      }));
    }

    // ── 5. Job prep complete ──────────────────────────────────
    if (before.prepStage !== PREP_COMPLETE && after.prepStage === PREP_COMPLETE) {
      tasks.push(sendToName(after.foreman, {
        title: "✅ Job Prep Complete",
        body:  `Prep is done on ${name} — ready to roll`,
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Job Prep Complete",
        body:  `${name} prep is complete`,
      }));
    }

    // ── 6. QC walk needs to be scheduled ─────────────────────
    if (before.qcStatus !== "needs" && after.qcStatus === "needs") {
      tasks.push(sendToName(after.foreman, {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk — please schedule it`,
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

    // Existing CO status changed
    afterCOs.forEach((co, i) => {
      const prev = beforeCOs[i];
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

    afterRTs.forEach((rt, i) => {
      const prev = beforeRTs[i];

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

    // ── 9. Questions added ────────────────────────────────────
    const beforeRoughQ  = countQuestions(before.roughQuestions);
    const afterRoughQ   = countQuestions(after.roughQuestions);
    const beforeFinishQ = countQuestions(before.finishQuestions);
    const afterFinishQ  = countQuestions(after.finishQuestions);

    if (afterRoughQ > beforeRoughQ) {
      tasks.push(sendToName(after.foreman, {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
      }));
    }
    if (afterFinishQ > beforeFinishQ) {
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

      // ── Rough inspection date reminders ────────────────────
      if (job.roughScheduledDate) {
        if (isDaysAway(job.roughScheduledDate, 7)) {
          tasks.push(sendToName(job.foreman, {
            title: "📅 Rough Inspection in 1 Week",
            body:  `${name} rough inspection is in 7 days`,
          }));
        }
        if (isDaysAway(job.roughScheduledDate, 2)) {
          tasks.push(sendToName(job.foreman, {
            title: "⚠️ Rough Inspection in 2 Days",
            body:  `${name} rough inspection is in 2 days`,
          }));
        }
      }

      // ── Finish inspection date reminders ───────────────────
      if (job.finishScheduledDate) {
        if (isDaysAway(job.finishScheduledDate, 7)) {
          tasks.push(sendToName(job.foreman, {
            title: "📅 Finish Inspection in 1 Week",
            body:  `${name} finish inspection is in 7 days`,
          }));
        }
        if (isDaysAway(job.finishScheduledDate, 2)) {
          tasks.push(sendToName(job.foreman, {
            title: "⚠️ Finish Inspection in 2 Days",
            body:  `${name} finish inspection is in 2 days`,
          }));
        }
      }

      // ── Job start warnings (rough scheduled date) for Koy ──
      const prepDone = job.prepStage === PREP_COMPLETE;
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
