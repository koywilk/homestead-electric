// Homestead Electric — Firebase Cloud Functions
// All push notification logic lives here.
// Deploy with: firebase deploy --only functions

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
admin.initializeApp();

const db        = admin.firestore();
const gcPortal  = require("./gcPortal.js"); // GC portal projection wall (08-Specs/GC Portal Link Spec.md)
const gcNotify  = require("./gcNotify.js"); // GC portal email composition (Piece 5, same spec)
const messaging = admin.messaging();

// ─── App-caller gate (H8 hardening) ──────────────────────────
// The main app has NO Firebase Auth (open-Firestore posture), so onCall
// callables cannot gate on context.auth — a context.auth check would reject
// every legitimate caller. Instead every app call injects `_appKey` (see the
// httpsCallable wrapper in src/App.js) and each sensitive callable calls
// requireAppKey(data) first. This is NOT a true secret (it ships in the public
// client bundle) — it blocks trivial drive-by abuse from anyone who merely
// knows the project id, not a determined attacker who reads the bundle. The
// real credential exposure (SIMPRO_TOKEN, below) still needs rotating + moving
// to a bound secret; longer term the correct fix is Firebase App Check.
// MUST stay byte-identical to APP_CALL_KEY in src/App.js.
const APP_CALL_KEY = "hs-app-9f3c1e7a2b6d4085";
function requireAppKey(data) {
  if (!data || data._appKey !== APP_CALL_KEY) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This function is only callable from the Homestead app."
    );
  }
}

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

// Per-user notification preference gate. `notifPrefs` is a {key:bool} map saved
// from Settings → Team. Default TRUE when a key is absent, so a newly-added
// nudge type still reaches people until they explicitly mute it (opt-out, not
// opt-in). Used by the new nudges; older functions don't gate yet.
function wantsNotif(user, key) {
  if (!user || !key) return true;
  const p = user.notifPrefs;
  if (!p || typeof p !== "object") return true;
  return p[key] !== false;
}

// The coordinator (office scheduler) who owns a foreman's book, or null.
function coordUserOf(users, foremanName) {
  const fm = (users || []).find(u => (u.name || "").toLowerCase() === String(foremanName || "").toLowerCase());
  if (!fm || !fm.coordinator) return null;
  return (users || []).find(u => (u.name || "").toLowerCase() === String(fm.coordinator).toLowerCase()) || null;
}

// ── In-app notification inbox ────────────────────────────────────────────────
// Every nudge is ALSO written to notifications/{userKey}/items so the app can
// show a bell inbox that never depends on FCM tokens. Push stays best-effort;
// the inbox is the guarantee. userKey = user.id, falling back to a name slug
// for legacy users without ids (the client derives the same key from identity).
const inboxKeyOf = (user) =>
  (user && (user.id || String(user.name || "").trim().toLowerCase().replace(/\s+/g, "_"))) || null;

async function logInboxNotif(user, { title, body, jobId, section, view }) {
  const key = inboxKeyOf(user);
  if (!key) return;
  try {
    await db.collection("notifications").doc(key).collection("items").add({
      title:   title   || "",
      body:    body    || "",
      jobId:   jobId   || "",
      section: section || "",
      view:    view    || "",
      createdAt: new Date().toISOString(),
      read: false,
    });
  } catch (e) {
    functions.logger.warn("[inbox] write failed", { user: user && user.name, error: e.message });
  }
}

// Single delivery chokepoint: inbox write + every device token. Use this for
// any user-level send so push and inbox can never drift apart.
async function deliver(user, notif) {
  if (!user) return;
  const sends = getTokens(user).map(t => sendFCM(t, notif));
  sends.push(logInboxNotif(user, notif));
  await Promise.all(sends);
}

// deliver() but gated on the recipient's per-person toggle. Used by the wave-2
// nudges so anyone can mute a category without losing the rest.
async function deliverIfWanted(user, key, notif) {
  if (!user || !wantsNotif(user, key)) return;
  await deliver(user, notif);
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
    const ref = db.doc("settings/users");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const cur = snap.data().list || [];
      let changed = false;
      const list = cur.map(u => {
        const inArray   = (u.fcmTokens || []).includes(token);
        const isPrimary = u.fcmToken === token;
        if (!inArray && !isPrimary) return u;
        changed = true;
        return {
          ...u,
          fcmTokens: (u.fcmTokens || []).filter(t => t !== token),
          fcmToken:  isPrimary ? "" : (u.fcmToken || ""),
        };
      });
      if (!changed) return;
      // Update ONLY `list` — never a whole-doc set({list}). A whole-doc set
      // dropped updated_at/saved_by/device, which silently disarmed the
      // client's saveUsers stale-write guard (remoteTs went null → guard
      // fails open → blind team-list overwrite). tx.update leaves those audit
      // fields untouched. The transaction also re-reads under lock, so two
      // concurrent prunes (deliver()'s Promise.all over many dead tokens)
      // can't clobber each other's removal, and a concurrent team-list save
      // is merged against rather than lost. Purely additive/removal-only on
      // the token fields — no team data touched.
      tx.update(ref, { list });
    });
    functions.logger.info("Removed stale FCM token", { token: token.slice(0, 20) });
  } catch (e) {
    functions.logger.warn("Failed to remove stale token", { error: e.message });
  }
}

async function sendFCM(token, { title, body, jobId, section, view }) {
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
    // DATA-ONLY payload to prevent duplicate notifications on every device.
    //
    // Why: when a payload contains BOTH a top-level `notification` field AND
    // a `webpush.notification` field (the previous shape), the FCM JS SDK
    // running inside firebase-messaging-sw.js auto-displays the system-level
    // notification AND our own `onBackgroundMessage` handler ALSO calls
    // `self.registration.showNotification(...)`. That's where "two of the
    // same notification per push" was coming from.
    //
    // Going data-only routes ALL display through the SW's onBackgroundMessage
    // handler, which reads payload.data.{title,body,jobId,section} and shows
    // exactly one notification. The test-push helper (which already worked
    // without dupes) uses the same shape — this just brings real pushes in
    // line. The `tag` we set in the SW (`he-${jobId}-${section}`) still
    // dedupes back-to-back pushes for the same job+section.
    //
    // iOS Safari PWA still works: Apple's web-push gateway routes to the SW
    // via APNS transport, and `apns-push-type: alert` keeps Apple's gateway
    // from silently dropping it. The SW renders on iOS too.
    await messaging.send({
      token,
      data: {
        title:   title   || "",
        body:    body    || "",
        jobId:   jobId   || "",
        section: section || "",
        view:    view    || "",
        tag,
        link:    linkPath,
      },
      webpush: {
        headers: { Urgency: "high" },
      },
      android: {
        priority: "high",
        // collapseKey makes Android replace any pending notification with the
        // same key instead of stacking — fixes the "2-3 per notification" bug.
        collapseKey: tag,
      },
      apns: {
        headers: {
          // REQUIRED for iOS Safari PWA push — without "apns-push-type: alert"
          // Apple's gateway silently drops the notification. This was the
          // root cause of "Apple users don't get them anymore."
          "apns-push-type": "alert",
          "apns-priority":  "10",
        },
        payload: { aps: { contentAvailable: true } },
      },
    });
    functions.logger.info("[sendFCM] sent OK", {
      token: token.slice(0, 20), title, jobId, section,
    });
  } catch (e) {
    const isStale = STALE_TOKEN_CODES.some(
      code => e.code === code || (e.message || "").includes(code)
    );
    if (isStale) {
      functions.logger.warn("[sendFCM] stale token pruned", { token: token.slice(0, 20), code: e.code });
      await removeStaleToken(token);
    } else {
      functions.logger.warn("[sendFCM] send failed", {
        token: token.slice(0, 20), title, jobId, section,
        error: e.message, code: e.code,
      });
    }
  }
}

// ─── Notification Doctor — test push to a single user ───────────────────────
// Lets the in-app diagnostic page send a push to a specific user and see
// per-token success/failure. Returns a JSON report instead of swallowing
// errors so the UI can show exactly which tokens are alive vs dead.
exports.sendTestPush = functions.https.onCall(async (data) => {
    requireAppKey(data);
  const { userId } = data || {};
  if (!userId) throw new functions.https.HttpsError("invalid-argument", "userId required");
  const users = await getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) throw new functions.https.HttpsError("not-found", `user ${userId} not in settings/users`);
  const tokens = getTokens(user);
  if (tokens.length === 0) {
    return { ok: false, reason: "no-tokens", message: `${user.name} has no FCM tokens registered.` };
  }
  const title = "Test push from Command Center";
  const body  = `If you see this, your notifications are working. ${new Date().toLocaleTimeString()}`;
  const results = [];
  for (const token of tokens) {
    const tokenPreview = token.slice(0, 20) + "…";
    try {
      // Test push is DATA-ONLY (no `notification` field at top level) so the
      // browser's onMessage handler reliably fires when foregrounded. With
      // a `notification` field present, some FCM SDK versions suppress
      // onMessage and let the OS handle display — which silently does
      // nothing on macOS Chrome if site notifications are blocked at OS
      // level. Data-only forces the app to surface the toast itself.
      await messaging.send({
        token,
        data: {
          title, body, jobId: "", section: "",
          // marker so the client knows this is a doctor test push
          __test: "1",
        },
        webpush: {
          headers: { Urgency: "high" },
        },
        android: { priority: "high" },
        apns: {
          headers: { "apns-push-type": "alert", "apns-priority": "10" },
          payload: { aps: { contentAvailable: true } },
        },
      });
      results.push({ token: tokenPreview, ok: true });
    } catch (e) {
      const isStale = STALE_TOKEN_CODES.some(
        code => e.code === code || (e.message || "").includes(code)
      );
      results.push({
        token: tokenPreview,
        ok: false,
        error: e.message,
        code: e.code || "",
        stale: isStale,
      });
      if (isStale) await removeStaleToken(token);
    }
  }
  return {
    ok: results.some(r => r.ok),
    user: user.name,
    tokenCount: tokens.length,
    results,
  };
});

// ─── Manual re-nudge — a button in the app re-pings the ONE person responsible
// for an open item (question / CO / punch / RT). Respects that person's
// `renudge` toggle. Returns a small report so the UI can toast the result.
exports.reNudge = functions.https.onCall(async (data) => {
    requireAppKey(data);
  const { toName, title, body, jobId, section, key } = data || {};
  if (!toName) throw new functions.https.HttpsError("invalid-argument", "toName required");
  const users = await getUsers();
  const n = String(toName).toLowerCase().trim();
  const user = users.find(u => {
    const un = (u.name || "").toLowerCase();
    return un === n || un.startsWith(n + " ") || n.startsWith(un.split(" ")[0]);
  });
  if (!user) return { ok: false, reason: "not-found", message: `${toName} isn't in the team list.` };
  if (!wantsNotif(user, key || "renudge")) return { ok: false, reason: "muted", message: `${user.name} has manual reminders turned off.` };
  const tokens = getTokens(user);
  // Inbox write happens even with zero tokens — the reminder always lands
  // in their in-app bell, push is best-effort on top.
  await deliver(user, {
    title: title || "Reminder",
    body:  body  || "You have an open item that needs attention.",
    jobId: jobId || "",
    section: section || "",
  });
  return { ok: true, to: user.name, tokenCount: tokens.length };
});

// Notify approvers when someone requests time off. Recipients = all admins/managers
// + the requester's own coordinator. Gated by the `timeoff_requested` pref
// (default on). Inbox write always happens; push is best-effort on top.
exports.notifyTimeOffRequest = functions.https.onCall(async (data) => {
    requireAppKey(data);
  const { requesterName, start, end, note, usePaid } = data || {};
  if (!requesterName) throw new functions.https.HttpsError("invalid-argument", "requesterName required");
  const users = await getUsers();
  const accessOf = (u) => {
    if (u.access) return u.access;
    const m = { admin:"admin", justin:"admin", jeromy:"manager", foreman:"standard", lead:"limited", crew:"limited" };
    return m[u.role] || "limited";
  };
  // Find the requester's coordinator (their own if foreman, else their foreman's).
  const reqUser = users.find(u => (u.name||"").toLowerCase() === String(requesterName).toLowerCase());
  let coordName = "";
  if (reqUser) {
    if ((reqUser.title||reqUser.role)==="foreman" && reqUser.coordinator) coordName = reqUser.coordinator;
    else if (reqUser.foremanId) { const fm = users.find(u=>u.id===reqUser.foremanId); coordName = (fm&&fm.coordinator)||""; }
  }
  const targets = users.filter(u => {
    const acc = accessOf(u);
    if (acc==="admin" || acc==="manager") return true;
    if (coordName && (u.name||"").toLowerCase()===String(coordName).toLowerCase()) return true;
    return false;
  });
  const range = (end && end!==start) ? `${start} → ${end}` : start;
  const payTag = usePaid===false ? " (unpaid)" : " (PTO)";
  const seen = new Set();
  const sends = [];
  for (const u of targets) {
    const id = u.id || u.name;
    if (seen.has(id)) continue; seen.add(id);
    if (!wantsNotif(u, "timeoff_requested")) continue;
    sends.push(deliver(u, {
      title: "Time off requested",
      body: `${requesterName} requested ${range}${payTag}${note?` — ${note}`:""}`,
      jobId: "",
      section: "timeoff",
    }));
  }
  await Promise.all(sends);
  return { ok: true, notified: sends.length };
});

async function sendToName(name, notification) {
  if (!name || name === "Unassigned") return;
  const users = await getUsers();
  const n = name.toLowerCase().trim();
  const user = users.find(u => {
    const un = (u.name || "").toLowerCase();
    return un === n || un.startsWith(n + " ") || n.startsWith(un.split(" ")[0]);
  });
  if (!user) return;
  await deliver(user, notification);
}

async function sendToRoles(roles, notification, excludeTokens = [], prefKey = null) {
  const users = await getUsers();
  const targets = users.filter(u => roles.includes(u.title) || roles.includes(u.role));
  const sends = [];
  for (const u of targets) {
    // excludeTokens means "this person already got the direct send" — skip the
    // whole user (push AND inbox) so nobody gets the same nudge twice.
    if (getTokens(u).some(t => excludeTokens.includes(t))) continue;
    if (prefKey && !wantsNotif(u, prefKey)) continue;
    sends.push(deliver(u, notification));
  }
  await Promise.all(sends);
}

// sendToName, but honoring the recipient's Settings → Notifications toggle.
// This is the DEFAULT for event sends (2026-07-10 honest-notifications pass):
// every NOTIF_CATEGORIES key the app renders must gate through wantsNotif
// somewhere on the server. Plain sendToName is reserved for Koy-personal
// ops sends that intentionally can't be muted.
async function sendToNameIfWanted(name, key, notification) {
  if (!name || name === "Unassigned") return;
  const users = await getUsers();
  const n = name.toLowerCase().trim();
  const user = users.find(u => {
    const un = (u.name || "").toLowerCase();
    return un === n || un.startsWith(n + " ") || n.startsWith(un.split(" ")[0]);
  });
  if (!user) return;
  await deliverIfWanted(user, key, notification);
}

// Route a notification to the COORDINATOR who owns this job's foreman's book:
// foreman name → foreman user → .coordinator → that coordinator's tokens.
async function sendToJobCoordinator(foremanName, notification) {
  if (!foremanName) return;
  const users = await getUsers();
  const coord = coordUserOf(users, foremanName);
  if (!coord) return;
  await deliver(coord, notification);
}

// sendToJobCoordinator, but honoring the coordinator's pref toggle. Replaces
// the old admin/manager blast on most onJobUpdate branches: the person who
// owns this foreman's book gets the nudge, everyone else reads it in the app.
async function sendToJobCoordinatorIfWanted(foremanName, key, notification) {
  if (!foremanName) return;
  const users = await getUsers();
  const coord = coordUserOf(users, foremanName);
  if (!coord) return;
  await deliverIfWanted(coord, key, notification);
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

    // Diagnostic: log every invocation + WHICH top-level fields actually
    // differ between before and after. When the trigger fires but no branch
    // matches, this tells us exactly what the user changed (so we can see
    // whether they edited a field we don't watch for notifications, or
    // re-saved an already-equal value, or something else).
    const changedFields = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of allKeys) {
      const bv = before[k], av = after[k];
      if (Array.isArray(bv) && Array.isArray(av)) {
        if (bv.length !== av.length) changedFields.push(`${k}[${bv.length}→${av.length}]`);
        else if (JSON.stringify(bv) !== JSON.stringify(av)) changedFields.push(`${k}(arr-edit)`);
      } else if (typeof bv === "object" && bv !== null && typeof av === "object" && av !== null) {
        if (JSON.stringify(bv) !== JSON.stringify(av)) changedFields.push(`${k}(obj-edit)`);
      } else if (bv !== av) {
        changedFields.push(k);
      }
    }
    functions.logger.info("[onJobUpdate] fired", {
      jobId, name, foreman: after.foreman, lead: after.lead,
      coCount: (after.changeOrders || []).length,
      changedFields: changedFields.length ? changedFields : ["(no field changed)"],
    });

    const tasks = [];

    // ── 1. Foreman assigned / changed ─────────────────────────
    // Honest routing (2026-07-10): assignee + their book's coordinator, both
    // pref-gated. The admin/manager blast is gone — office reads it in-app.
    if (after.foreman && after.foreman !== before.foreman && after.foreman !== "Unassigned") {
      tasks.push(sendToNameIfWanted(after.foreman, "job_assigned", {
        title: "🔨 Job Assigned to You",
        body:  `You've been assigned as foreman on ${name}`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "job_assigned", {
        title: "🔨 Foreman Assigned",
        body:  `${after.foreman} assigned as foreman on ${name}`,
        jobId, section: "Job Info",
      }));
    }

    // ── 1b. Status update changed (irregular status like "needs a lift") ──
    // Fires on set, edit, and clear. The app shows this text on every card;
    // we also push it so foreman + admins know right away. Cleared = goes
    // back to normal, which we announce lightly so people stop chasing it.
    if ((before.statusUpdate || "") !== (after.statusUpdate || "")) {
      const cleared = !after.statusUpdate;
      const title   = cleared ? "✅ Status Cleared" : "⚠️ Status Update";
      const body    = cleared
        ? `${name} — status cleared`
        : `${name} — ${after.statusUpdate}`;
      tasks.push(sendToNameIfWanted(after.foreman, "status_update", {
        title, body, jobId, section: "Job Info",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "status_update", {
        title, body, jobId, section: "Job Info",
      }));
    }

    // ── 2. Lead assigned / changed ────────────────────────────
    if (after.lead && after.lead !== before.lead && after.lead !== "Unassigned") {
      tasks.push(sendToNameIfWanted(after.lead, "job_assigned", {
        title: "📋 Job Assigned to You",
        body:  `You're the lead on ${name}`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToNameIfWanted(after.foreman, "lead_assigned", {
        title: "📋 Lead Assigned",
        body:  `${after.lead} assigned as lead on ${name}`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "lead_assigned", {
        title: "📋 Lead Assigned",
        body:  `${after.lead} assigned as lead on ${name}`,
        jobId, section: "Job Info",
      }));
    }

    // ── 3. Ready to invoice ───────────────────────────────────
    // One of two branches that keeps the admin/manager blast (billing is an
    // office-wide event) — but now pref-gated per user via the 4th arg.
    if (!before.readyToInvoice && after.readyToInvoice) {
      const foremanTokens = await getTokenForName(after.foreman);
      tasks.push(sendToNameIfWanted(after.foreman, "ready_invoice", {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "💰 Ready to Invoice",
        body:  `${name} is ready to invoice`,
        jobId, section: "Job Info",
      }, foremanTokens, "ready_invoice"));
    }

    // ── 4. Quote converted to job ─────────────────────────────
    // The other office-wide blast that stays — pref-gated per user.
    if (before.type === "quote" && after.type !== "quote") {
      tasks.push(sendToRoles(["admin", "manager"], {
        title: "✅ Quote Converted to Job",
        body:  `${name} is now a job — ready for billing`,
        jobId, section: "Job Info",
      }, [], "quote_converted"));
    }

    // ── 5. Job prep complete ──────────────────────────────────
    if (!allPrepDone(before) && allPrepDone(after)) {
      tasks.push(sendToNameIfWanted(after.foreman, "prep_complete", {
        title: "✅ Job Prep Complete",
        body:  `Prep is done on ${name} — ready to roll`,
        jobId, section: "Job Info",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "prep_complete", {
        title: "✅ Job Prep Complete",
        body:  `${name} prep is complete`,
        jobId, section: "Job Info",
      }));
    }

    // ── 6. QC walk needs to be scheduled ─────────────────────
    if (before.qcStatus !== "needs" && after.qcStatus === "needs") {
      tasks.push(sendToNameIfWanted(after.foreman, "qc_ready", {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk — please schedule it`,
        jobId, section: "QC",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "qc_ready", {
        title: "🔍 QC Walk Ready to Schedule",
        body:  `${name} is ready for a QC walk`,
        jobId, section: "QC",
      }));
    }

    // ── 6b. QC passed (pass or fixed) ────────────────────────
    const wasPass = after.qcStatus === "pass" || after.qcStatus === "fixed";
    const wasPassBefore = before.qcStatus === "pass" || before.qcStatus === "fixed";
    if (!wasPassBefore && wasPass) {
      tasks.push(sendToNameIfWanted(after.foreman, "qc_passed", {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
        jobId, section: "QC",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "qc_passed", {
        title: "✅ QC Passed",
        body:  `${name} — all QC items resolved, QC is now passing`,
        jobId, section: "QC",
      }));
    }

    // ── 6c. Matterport scan complete ──────────────────────────
    if (before.matterportStatus !== "complete" && after.matterportStatus === "complete") {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "matterport", {
        title: "📷 Matterport Scan Complete",
        body:  `${name} — Matterport scan is done`,
        jobId, section: "Rough",
      }));
    }

    // ── 7. Change Orders ──────────────────────────────────────
    const beforeCOs = before.changeOrders || [];
    const afterCOs  = after.changeOrders  || [];

    if (afterCOs.length > beforeCOs.length) {
      for (const co of afterCOs.slice(beforeCOs.length)) {
        tasks.push(sendToNameIfWanted(after.foreman, "co_new", {
          title: "📝 New Change Order",
          body:  `A new change order was created on ${name}`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "co_new", {
          title: "📝 New Change Order",
          body:  `A new change order was created on ${name}`,
          jobId, section: "Change Orders",
        }));
        // CO chaser — Jeromy quotes/sends COs but isn't always admin/manager.
        // Now gated on HIS co_new toggle (he was getting pushed through a mute).
        tasks.push(sendToNameIfWanted("Jeromy Cloward", "co_new", {
          title: "📝 New CO to quote",
          body:  `New change order on ${name} — review & get it quoted/sent.`,
          jobId, section: "Change Orders",
        }));
      }
    }

    const beforeCOMap = {};
    beforeCOs.forEach(co => { if (co.id) beforeCOMap[co.id] = co; });
    for (let i = 0; i < afterCOs.length; i++) {
      const co = afterCOs[i];
      const prev = co.id ? beforeCOMap[co.id] : beforeCOs[i];
      if (!prev) continue;

      if (prev.coStatus !== "approved" && co.coStatus === "approved") {
        functions.logger.info("[onJobUpdate] CO approved — sending", {
          jobId, name, coIndex: i, foreman: after.foreman, lead: after.lead,
        });
        tasks.push(sendToNameIfWanted(after.lead, "co_approved", {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToNameIfWanted(after.foreman, "co_approved", {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "co_approved", {
          title: "✅ Change Order Approved",
          body:  `Change Order #${i + 1} on ${name} was approved`,
          jobId, section: "Change Orders",
        }));
      }

      if (prev.coStatus !== "complete" && co.coStatus === "complete") {
        tasks.push(sendToNameIfWanted(after.foreman, "co_completed", {
          title: "🔨 CO Work Completed",
          body:  `Change Order #${i + 1} work is done on ${name}`,
          jobId, section: "Change Orders",
        }));
        tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "co_completed", {
          title: "🔨 CO Work Completed",
          body:  `Change Order #${i + 1} work is done on ${name}`,
          jobId, section: "Change Orders",
        }));
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
        tasks.push(sendToNameIfWanted(rt.assignedTo, "rt_assigned", {
          title: "🔄 Return Trip Assigned",
          body:  `You've been assigned to a return trip on ${name}`,
          jobId, section: "Return Trips",
        }));
        tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "rt_assigned", {
          title: "🔄 Return Trip Assigned",
          body:  `${rt.assignedTo} assigned to return trip on ${name}`,
          jobId, section: "Return Trips",
        }));
      }
      if (!prev?.signedOff && rt.signedOff) {
        tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "rt_signed", {
          title: "✅ Return Trip Signed Off",
          body:  `Return Trip ${i + 1} on ${name} is signed off — slot is open`,
          jobId, section: "Return Trips",
        }));
      }
    }

    // ── 9. Questions added ────────────────────────────────────
    if (hasNewQuestions(before.roughQuestions, after.roughQuestions)) {
      tasks.push(sendToNameIfWanted(after.foreman, "job_question", {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
        jobId, section: "Rough",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "job_question", {
        title: "❓ New Question on Job",
        body:  `A new rough question was added on ${name}`,
        jobId, section: "Rough",
      }));
    }
    if (hasNewQuestions(before.finishQuestions, after.finishQuestions)) {
      tasks.push(sendToNameIfWanted(after.foreman, "job_question", {
        title: "❓ New Question on Job",
        body:  `A new finish question was added on ${name}`,
        jobId, section: "Finish",
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "job_question", {
        title: "❓ New Question on Job",
        body:  `A new finish question was added on ${name}`,
        jobId, section: "Finish",
      }));
    }

    // ── 10. Daily job update added ────────────────────────────
    const beforeRoughUpdates  = (before.roughUpdates  || []).length;
    const afterRoughUpdates   = (after.roughUpdates   || []).length;
    const beforeFinishUpdates = (before.finishUpdates || []).length;
    const afterFinishUpdates  = (after.finishUpdates  || []).length;

    // The foreman usually WROTE the update, so no self-echo — the book's
    // coordinator is the one who needs to see it land.
    if (afterRoughUpdates > beforeRoughUpdates) {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "daily_update", {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Rough",
      }));
    } else if (afterFinishUpdates > beforeFinishUpdates) {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "daily_update", {
        title: "📋 Daily Update Added",
        body:  `A daily update was added on ${name}`,
        jobId, section: "Finish",
      }));
    }

    // ── Milestone + inspection nudges → the job's coordinator (book-routed) ──
    if (before.roughStatus !== "complete" && after.roughStatus === "complete") {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "milestone_complete", {
        title: "✅ Rough complete", body: `Rough is complete on ${name} — QC walk is due.`,
        jobId, section: "Rough",
      }));
    }
    if (before.finishStatus !== "complete" && after.finishStatus === "complete") {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "milestone_complete", {
        title: "✅ Finish complete", body: `Finish is complete on ${name} — QC walk is due.`,
        jobId, section: "Finish",
      }));
    }
    const _holdRe = /hold|waiting/i;
    const _wasHold = _holdRe.test(before.roughStatus || "") || _holdRe.test(before.finishStatus || "");
    const _isHold  = _holdRe.test(after.roughStatus  || "") || _holdRe.test(after.finishStatus  || "");
    if (!_wasHold && _isHold) {
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "job_hold", {
        title: "⏸️ Job on hold", body: `${name} is on hold / waiting on something.`, jobId,
      }));
    }
    const _newFail = (b, a) => {
      const bb = Array.isArray(b) ? b : [], aa = Array.isArray(a) ? a : [];
      if (aa.length <= bb.length) return false;
      return aa.slice(bb.length).some(x => /fail/i.test((x && x.result) || ""));
    };
    if (_newFail(before.roughInspectionAttempts, after.roughInspectionAttempts) ||
        _newFail(before.finalInspectionAttempts, after.finalInspectionAttempts)) {
      tasks.push(sendToNameIfWanted(after.foreman, "failed_inspection", {
        title: "❌ Failed inspection", body: `An inspection failed on ${name} — needs attention.`, jobId,
      }));
      tasks.push(sendToJobCoordinatorIfWanted(after.foreman, "failed_inspection", {
        title: "❌ Failed inspection", body: `An inspection failed on ${name}.`, jobId,
      }));
    }

    // ── 11. Punch item assigned → the assignee ────────────────────────────
    // Walks every punch item (rough/finish/QC phases × floors × general/
    // hotcheck/rooms, plus return-trip punch lists) and diffs assignedTo by
    // item id. Grouped: one push per person per save, so bulk-assigning ten
    // items buzzes once ("10 punch items assigned to you"), not ten times.
    // Gated per-user on the punch_assigned notification pref (opt-out).
    {
      const flatPunch = (j) => {
        const out = [];
        ["roughPunch", "finishPunch", "qcPunch"].forEach(pk => {
          const ph = j[pk]; if (!ph) return;
          ["upper", "main", "basement"].forEach(fk => {
            const fl = ph[fk] || {};
            (fl.general  || []).forEach(i => i && out.push(i));
            (fl.hotcheck || []).forEach(i => i && out.push(i));
            (fl.rooms    || []).forEach(r => (r && r.items || []).forEach(i => i && out.push(i)));
          });
        });
        (j.returnTrips || []).forEach(rt => (rt && rt.punch || []).forEach(i => i && out.push(i)));
        return out;
      };
      const prevById = {};
      flatPunch(before).forEach(i => { if (i.id) prevById[i.id] = i; });
      const newlyAssigned = {}; // assignee name → [items]
      flatPunch(after).forEach(i => {
        if (!i || !i.id || i.done) return;
        const a = String(i.assignedTo || "").trim();
        if (!a || a === "Unassigned") return;
        const prev = prevById[i.id];
        if (prev && String(prev.assignedTo || "").trim() === a) return; // unchanged
        (newlyAssigned[a] = newlyAssigned[a] || []).push(i);
      });
      const assignees = Object.keys(newlyAssigned);
      if (assignees.length) {
        const users = await getUsers();
        for (const a of assignees) {
          const an = a.toLowerCase();
          const u = users.find(x => {
            const un = (x.name || "").toLowerCase();
            return un === an || un.startsWith(an + " ") || an.startsWith(un.split(" ")[0]);
          });
          if (!u || !wantsNotif(u, "punch_assigned")) continue;
          const items = newlyAssigned[a];
          const firstText = _stripHtml(items[0].text).slice(0, 80);
          const body = items.length === 1
            ? `Punch item assigned to you on ${name}: ${firstText || "open item"}`
            : `${items.length} punch items assigned to you on ${name}`;
          functions.logger.info("[onJobUpdate] punch assigned — sending", { jobId, name, assignee: u.name, count: items.length });
          tasks.push(deliver(u, { title: "🔧 Punch Assigned", body, jobId, section: "punch" }));
        }
      }
    }

    // ── DATA-LOSS TRIPWIRE (HD5, Kweller hardening 2026-07-13) ──────────
    // Catch the NEXT catastrophic clobber (the Kweller questions wipe /
    // Cougar-Moon punch wipe class) in MINUTES instead of days. A single
    // write that erases most of a job's questions, answered questions, punch
    // entries, or change orders is almost never a real edit — it's a stale
    // client overwriting with an empty tree. We push Koy only when a count
    // drops a lot AND loses at least half, so ordinary edits/deletes never
    // trip it (validated: 1-question delete = silent; full wipe = fires).
    // READ-ONLY: counts before-vs-after and writes NOTHING back to the job
    // doc, so it cannot re-fire this onUpdate (no loop). Wrapped so a counting
    // error can never break the notifications above.
    try {
      const walkCount = (node) => { let n = 0; (function w(x){
        if (Array.isArray(x)) { for (const e of x) { if (e && typeof e === "object" && !Array.isArray(e)) n++; w(e); } }
        else if (x && typeof x === "object") { for (const v of Object.values(x)) w(v); }
      })(node); return n; };
      const answered = (qw) => { let n = 0; if (qw && typeof qw === "object") for (const arr of Object.values(qw)) {
        if (Array.isArray(arr)) for (const q of arr) { if (q && (q.done || (q.answer && String(q.answer).trim()) || (Array.isArray(q.thread) && q.thread.length))) n++; }
      } return n; };
      const qB = walkCount(before.roughQuestions) + walkCount(before.finishQuestions);
      const qA = walkCount(after.roughQuestions)  + walkCount(after.finishQuestions);
      const aB = answered(before.roughQuestions) + answered(before.finishQuestions);
      const aA = answered(after.roughQuestions)  + answered(after.finishQuestions);
      const pB = walkCount(before.roughPunch) + walkCount(before.finishPunch) + walkCount(before.qcPunch);
      const pA = walkCount(after.roughPunch)  + walkCount(after.finishPunch)  + walkCount(after.qcPunch);
      const cB = (before.changeOrders || []).length, cA = (after.changeOrders || []).length;
      // Trip on a big RELATIVE drop (>= half) OR a big ABSOLUTE drop. The
      // absolute floor was added 2026-07-13 after a 17-answer wipe (17 of 42
      // answered = 40%) slipped under the half-only rule and never alerted.
      const bigDrop = (b, a, absMin, absHard) => b > 0 && (b - a) >= absMin && ((b - a) >= Math.ceil(b * 0.5) || (b - a) >= absHard);
      const drops = [];
      if (bigDrop(qB, qA, 10, 20)) drops.push(`${qB - qA} questions gone (${qB}→${qA})`);
      if (bigDrop(aB, aA, 5, 8))   drops.push(`${aB - aA} answered questions gone (${aB}→${aA})`);
      if (bigDrop(pB, pA, 12, 25)) drops.push(`${pB - pA} punch entries gone (${pB}→${pA})`);
      if (cB - cA >= 3)        drops.push(`${cB - cA} change orders gone (${cB}→${cA})`);
      if (drops.length) {
        const savedBy = change.after.data()?.saved_by || "?";
        const device  = change.after.data()?.device || "?";
        functions.logger.error("[onJobUpdate] DATA-LOSS TRIPWIRE", { jobId, name, drops, savedBy, device });
        tasks.push(sendToName("Koy", {
          title: "Possible Data Loss",
          body:  `${name}: ${drops.join("; ")}. Last saved by ${savedBy}. Recoverable via PITR for 7 days — check now.`,
          jobId, section: "Job Info",
        }));
      }
    } catch (e) { functions.logger.warn("[onJobUpdate] tripwire error (non-fatal)", e.message); }

    // ── DURABLE VERSION SNAPSHOTS (HD2, Kweller hardening 2026-07-13) ──────
    // When a high-value, loss-prone field materially changes, stash its PRIOR
    // value in jobs/{jobId}/versions. That makes a bad merge or whole-field
    // clobber a surgical restore even BEYOND PITR's 7-day window, and gives a
    // durable per-field record independent of it (mirrors the version pattern
    // homeowner_requests already has). We store ONLY the changed high-value
    // fields' before-values (small docs), and ONLY when a field that HAD
    // content actually changed — so the frequent notes/photos/status/daily-
    // update saves never snapshot. Writes to a SUBcollection, which does NOT
    // re-fire this onUpdate (no loop). Admin SDK bypasses rules, so no
    // firestore.rules change; the catch-all keeps clients out of version
    // history (restores stay bespoke/admin-only per RECOVERY.md). Fire-and-
    // forget via tasks: a snapshot failure can't affect the notifications.
    // Pruned to the newest 25 per job so storage is bounded with no TTL policy.
    try {
      const WATCH = ["roughQuestions","finishQuestions","roughPunch","finishPunch","qcPunch","changeOrders","designerQuestions"];
      const prev = {};
      for (const f of WATCH) {
        if (before[f] !== undefined && JSON.stringify(before[f]) !== JSON.stringify(after[f])) prev[f] = before[f];
      }
      if (Object.keys(prev).length) {
        tasks.push((async () => {
          const vcol = db.collection("jobs").doc(jobId).collection("versions");
          await vcol.add({
            at: new Date().toISOString(),
            savedBy: change.after.data()?.saved_by || "?",
            device:  change.after.data()?.device || "?",
            changed: Object.keys(prev),
            prev,
          });
          const stale = await vcol.orderBy("at", "desc").offset(25).get();
          await Promise.all(stale.docs.map(d => d.ref.delete().catch(() => {})));
        })().catch(e => functions.logger.warn("[onJobUpdate] version snapshot error (non-fatal)", e.message)));
      }
    } catch (e) { functions.logger.warn("[onJobUpdate] version snapshot setup error (non-fatal)", e.message); }

    // ── GC PORTAL MIRROR (2026-07-16, spec: 08-Specs/GC Portal Link Spec.md) ──
    // Outside-facing contractor portal reads a WHITELISTED per-job projection
    // from gc_portal/{portalId}/jobs/{jobId} — never jobs/{id}. This block keeps
    // that mirror current: on any job change whose projection differs (or whose
    // gc reassigns), rewrite the one subdoc. Only GCs that HAVE an active
    // gc_link get mirrored (no link → no publish). Writes go to a separate
    // collection, so this onUpdate cannot re-trigger itself. Fire-and-forget:
    // a mirror failure can never affect notifications or the save itself.
    try {
      const gcBeforeKey = gcPortal.gcKeyOf(before.gc);
      const gcAfterKey  = gcPortal.gcKeyOf(after.gc);
      const gcViewAfter  = gcPortal.projectJobForPortal(jobId, after);
      const gcViewBefore = gcPortal.projectJobForPortal(jobId, before);
      const gcChanged = gcBeforeKey !== gcAfterKey ||
        gcPortal.hashOf(gcViewAfter || {}) !== gcPortal.hashOf(gcViewBefore || {});
      if (gcChanged) {
        tasks.push((async () => {
          // Refresh one job on one portal mirror, honoring GC-level membership
          // (exclude hides a matched job; archived/deleted drops it).
          const seen = new Set();
          const refreshPortal = async (m) => {
            if (!m || !m.portalId || seen.has(m.portalId)) return;
            seen.add(m.portalId);
            const pref = db.collection("gc_portal").doc(m.portalId);
            if (gcViewAfter && gcPortal.jobBelongsToLink(jobId, after, m)) {
              await pref.collection("jobs").doc(jobId).set(gcViewAfter);
            } else {
              await pref.collection("jobs").doc(jobId).delete().catch(() => {});
            }
            await pref.set({ gcKey: m.gcKey, updatedAt: new Date().toISOString() }, { merge: true });
          };
          // (a) gcKey-match path — GC-level union membership (not one arbitrary
          // link) so exclude on any active link reliably hides the job.
          const [linkBefore, linkAfter] = await Promise.all(
            [gcPortalGcMembership(gcBeforeKey), gcPortalGcMembership(gcAfterKey)]);
          const pidBefore = linkBefore && linkBefore.portalId;
          const pidAfter  = linkAfter && linkAfter.portalId;
          if (pidBefore && pidBefore !== pidAfter) {
            // job reassigned to a different GC. Remove it from the old mirror
            // ONLY if it no longer belongs there — a force-include on the old
            // GC's link (jobIdsInclude) keeps it entitled, so in that case
            // refresh it in place instead of dropping it (review finding).
            if (gcViewAfter && gcPortal.jobBelongsToLink(jobId, after, linkBefore)) {
              await refreshPortal(linkBefore);   // still a member (force-included) → keep + refresh
            } else {
              await db.collection("gc_portal").doc(pidBefore)
                .collection("jobs").doc(jobId).delete().catch(() => {});
              await db.collection("gc_portal").doc(pidBefore)
                .set({ updatedAt: new Date().toISOString() }, { merge: true });
              seen.add(pidBefore);
            }
          }
          await refreshPortal(linkAfter);
          // (b) force-include path — any active link that lists this job in
          // jobIdsInclude, even when the job's gc doesn't match (typo/shared
          // custody) or is blank. Without this those jobs go stale until a
          // manual rebuild. array-contains is single-field auto-indexed; we
          // filter revoked in code to avoid a composite index.
          const incLinks = await db.collection("gc_links")
            .where("jobIdsInclude", "array-contains", jobId).get();
          const incKeys = new Set();
          incLinks.docs.forEach((d) => { const l = d.data(); if (l.revoked !== true && l.gcKey) incKeys.add(l.gcKey); });
          for (const k of incKeys) {
            await refreshPortal(await gcPortalGcMembership(k)); // eslint-disable-line no-await-in-loop
          }
        })().catch(e => functions.logger.warn("[gcPortal] mirror error (non-fatal)", e.message)));
      }
    } catch (e) { functions.logger.warn("[gcPortal] mirror setup error (non-fatal)", e.message); }

    // ── GC PORTAL INSTANT NOTIFICATIONS (Piece 5) ─────────────────────────────
    // Diff before/after for the interrupt-worthy triggers (schedule change,
    // inspection result, milestone, matterport ready, return trip scheduled) and
    // ENQUEUE emails to the GC's contacts. Enqueue-only so the save never waits
    // on the mail provider and never depends on email being configured. Keyed on
    // the job's CURRENT gc — only GCs with an active link get notified.
    try {
      const triggers = gcNotify.detectTriggers(before, after);
      if (triggers.length) {
        const gcKeyNow = gcPortal.gcKeyOf(after.gc);
        if (gcKeyNow) {
          tasks.push(gcEnqueueInstants(gcKeyNow, jobId, triggers)
            .catch(e => functions.logger.warn("[gcNotify] instant enqueue error (non-fatal)", e.message)));
        }
      }
    } catch (e) { functions.logger.warn("[gcNotify] instant setup error (non-fatal)", e.message); }

    // ── AUTO-HEAL a mass answer-wipe (2026-07-13, server-side backstop) ────
    // The v328 client fix stops the answer-deleting retraction, but a device
    // still on OLD code (fleet updates lazily — mobile PWAs only reload on
    // reopen) can keep wiping until it updates. This runs on the SERVER, so it
    // protects every question regardless of any device's version. If ONE write
    // blanks several previously-answered questions at once (the wipe signature,
    // never a normal edit), we restore each blanked answer from `before` and
    // set gcAnswered:false so the offending device's own snapshot listener sees
    // the answer is now crew-owned and its retraction stops targeting it — the
    // heal converges in one round instead of ping-ponging. Re-reads under a
    // transaction and restores ONLY questions still blank (never clobbers a
    // genuine crew re-answer). No loop: the heal write turns blanks into
    // answers, which this same scan reads as an ADD (0 blanked) → no re-heal.
    try {
      const flat = (qw) => { const m = {}; if (qw && typeof qw === "object") for (const arr of Object.values(qw)) { if (Array.isArray(arr)) for (const q of arr) if (q && q.id != null) m[q.id] = q; } return m; };
      const good = {};
      const scan = (bMap, aMap) => { for (const id of Object.keys(bMap)) {
        const b = bMap[id], a = aMap[id];
        if (!a) continue; // question removed — different concern (covered by version snapshots)
        const hadAns = String(b.answer || "").trim().length > 0;
        const nowBlank = !String(a.answer || "").trim() && !((a.answerPhotos || []).length);
        if (hadAns && nowBlank) good[id] = { answer: b.answer, answerPhotos: Array.isArray(b.answerPhotos) ? b.answerPhotos : [], answeredBy: b.answeredBy || "", answeredVia: b.answeredVia || "", answeredAt: b.answeredAt || "" };
      } };
      scan(flat(before.roughQuestions), flat(after.roughQuestions));
      scan(flat(before.finishQuestions), flat(after.finishQuestions));
      const blankedIds = Object.keys(good);
      if (blankedIds.length >= 4) { // mass wipe, not a normal single clear
        const savedBy = change.after.data()?.saved_by || "?";
        functions.logger.error("[onJobUpdate] AUTO-HEAL — mass answer-wipe detected", { jobId, name, count: blankedIds.length, savedBy });
        tasks.push((async () => {
          let healed = 0;
          await db.runTransaction(async (tx) => {
            const wrap = (await tx.get(change.after.ref)).data() || {};
            const data = wrap.data || {};
            const rq = JSON.parse(JSON.stringify(data.roughQuestions || {}));
            const fq = JSON.parse(JSON.stringify(data.finishQuestions || {}));
            const fix = (tree) => { for (const fl of Object.keys(tree)) { const arr = tree[fl]; if (!Array.isArray(arr)) continue; for (const q of arr) {
              if (!q || !good[q.id]) continue;
              const stillBlank = !String(q.answer || "").trim() && !((q.answerPhotos || []).length);
              if (!stillBlank) continue; // crew re-answered since — keep theirs
              const g = good[q.id];
              q.answer = g.answer; q.answerPhotos = g.answerPhotos; q.done = true;
              q.gcAnswered = false; q.gcRejected = null;
              q.answeredBy = g.answeredBy; q.answeredVia = g.answeredVia; q.answeredAt = g.answeredAt;
              healed++;
            } } };
            fix(rq); fix(fq);
            if (healed) tx.update(change.after.ref, { "data.roughQuestions": rq, "data.finishQuestions": fq });
          });
          functions.logger.info("[onJobUpdate] AUTO-HEAL complete", { jobId, healed });
          if (healed) await sendToName("Koy", {
            title: "Auto-healed a data wipe",
            body: `${name}: ${healed} answer(s) were blanked by a stale device (saved by ${savedBy}) and automatically restored.`,
            jobId, section: "Job Info",
          });
        })().catch(e => functions.logger.warn("[onJobUpdate] auto-heal error (non-fatal)", e.message)));
      }
    } catch (e) { functions.logger.warn("[onJobUpdate] auto-heal setup error (non-fatal)", e.message); }

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

    // Honest routing (2026-07-10): lead + foreman + the book's coordinator,
    // all pref-gated on question_answered. Admin blast removed.
    await Promise.all([
      sendToNameIfWanted(job.lead, "question_answered", {
        title: "💬 Question Answered",
        body:  `A question was answered on ${job.name || "your job"}`,
        jobId, section: "Rough",
      }),
      job.foreman !== job.lead ? sendToNameIfWanted(job.foreman, "question_answered", {
        title: "💬 Question Answered",
        body:  `A question was answered on ${job.name || "a job"}`,
        jobId, section: "Rough",
      }) : null,
      sendToJobCoordinatorIfWanted(job.foreman, "question_answered", {
        title: "💬 Question Answered",
        body:  `A question was answered on ${job.name || "a job"}`,
        jobId, section: "Rough",
      }),
    ]);

    return null;
  });

// ═════════════════════════════════════════════════════════════════════════
// UNIVERSAL PRE-IMAGE RECOVERY LEDGER (data-loss backstop, 2026-07-13)
// ═════════════════════════════════════════════════════════════════════════
// The hole every other safety layer left open: DELETES. `onJobUpdate` fires
// on .onUpdate ONLY — never on delete — and the per-field jobs/versions
// snapshots are update-only too. So a HARD delete of a job / task / need /
// walk (all allowed `delete: if true` in firestore.rules) had NO app-layer
// capture at all; it survived only inside PITR (7d) and the nightly backup
// (30d). This closes that: every DELETE (and every UPDATE on the smaller
// per-item collections, which had no server history of any kind) snapshots
// the document's FULL prior image into a top-level `recovery_ledger` the
// instant before it would be lost, making it a one-call restore for
// LEDGER_TTL_DAYS.
//
// Why it is safe:
//   • onWrite fires AFTER commit → it can never block, slow, or fail a
//     client save. A ledger write failure is logged, never thrown.
//   • It writes ONLY to `recovery_ledger`, which is NOT a protected
//     collection → it can never re-fire itself (no loop).
//   • It stores the whole doc verbatim → shape-agnostic, so it cannot break
//     on a field-shape assumption the way a rules guard would.
//   • Admin SDK bypasses rules; the firestore.rules catch-all already denies
//     clients on `recovery_ledger`, so no rules change is needed (same
//     posture as jobs/versions). Restores stay admin/app-only.
//
// It COMPLEMENTS the existing stack — the jobs tripwire, the per-field
// jobs/versions snapshots, and the answer-wipe auto-heal all still run on
// updates; this adds the missing delete coverage + a uniform net across
// every user-generated collection.
const LEDGER_TTL_DAYS = 90;

// A single equality field (`key`) lets restore query by (coll,docId) with
// NO composite index — we sort the handful of matches in memory instead.
async function writeLedger(coll, docId, op, beforeData, afterMeta) {
  try {
    const expireMs = Date.now() + LEDGER_TTL_DAYS * 86400000;
    await db.collection("recovery_ledger").add({
      key:      `${coll}|${docId}`,
      coll, docId, op,                     // op: "delete" | "update"
      at:       new Date().toISOString(),
      expireAt: admin.firestore.Timestamp.fromMillis(expireMs), // for prune + optional TTL policy
      savedBy:  (afterMeta && (afterMeta.saved_by || afterMeta.savedBy)) || "?",
      device:   (afterMeta && afterMeta.device) || "?",
      before:   beforeData || null,        // full prior document, verbatim
    });
  } catch (e) {
    // Never throw — a ledger failure must not affect the write that triggered it.
    functions.logger.error("[ledger] write FAILED", { coll, docId, op, error: e.message });
  }
}

// Factory: one onWrite trigger per protected collection. `onUpdates:true`
// also snapshots updates (used for the small per-item collections that have
// no other server-side history); jobs uses false because updates are already
// covered field-by-field in jobs/versions and full-doc job snapshots on
// every save would be large + redundant. CREATEs snapshot nothing (there is
// nothing prior to lose).
function makeLedgerTrigger(coll, { onUpdates }) {
  return functions.firestore
    .document(`${coll}/{docId}`)
    .onWrite(async (change, context) => {
      const docId = context.params.docId;
      const existedBefore = change.before.exists;
      const existsAfter   = change.after.exists;
      if (existedBefore && !existsAfter) {
        await writeLedger(coll, docId, "delete", change.before.data(), change.before.data());
      } else if (existedBefore && existsAfter && onUpdates) {
        await writeLedger(coll, docId, "update", change.before.data(), change.after.data());
      }
      return null;
    });
}

// jobs: delete-only (updates already captured by jobs/versions + tripwire/heal).
exports.ledgerJobs         = makeLedgerTrigger("jobs",               { onUpdates: false });
// suggestions: low-value list; capture deletes only.
exports.ledgerSuggestions  = makeLedgerTrigger("suggestions",        { onUpdates: false });
// Small per-item collections that had ZERO server-side history — capture
// both updates (last-write-wins overwrites) and deletes.
exports.ledgerManualTasks  = makeLedgerTrigger("manualTasks",        { onUpdates: true });
exports.ledgerNeeds        = makeLedgerTrigger("needs",              { onUpdates: true });
exports.ledgerQuoteWalks   = makeLedgerTrigger("quoteWalks",         { onUpdates: true });
exports.ledgerRedlineWalks = makeLedgerTrigger("redlineWalks",       { onUpdates: true });
// homeowner_requests: the exact collection wiped in the Kweller incident.
// The client saveHomeownerRequest funnel already snapshots versions, but that
// depends on a good client calling it — this is an INDEPENDENT server-side
// full-doc net that a stale/buggy client can't bypass. delete is disabled by
// rules, so in practice this only ever records overwrites.
exports.ledgerHomeowner    = makeLedgerTrigger("homeowner_requests", { onUpdates: true });

// ── One-call restore: undo any delete or overwrite from the newest ledger
// entry for a doc. Callable from the app (admin/manager UI) via the shared
// _appKey gate. Single-field equality on `key` → no composite index needed.
exports.restoreFromLedger = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const coll  = data && data.coll;
  const docId = data && data.docId;
  if (!coll || !docId) {
    throw new functions.https.HttpsError("invalid-argument", "coll and docId required");
  }
  const snap = await db.collection("recovery_ledger")
    .where("key", "==", `${coll}|${docId}`).limit(100).get();
  if (snap.empty) {
    throw new functions.https.HttpsError("not-found", `No ledger entry for ${coll}/${docId}`);
  }
  // Newest first (sort in memory — avoids a composite index on key+at).
  const entries = snap.docs.map(d => d.data()).sort((a, b) => (a.at < b.at ? 1 : -1));
  const chosen = data.at
    ? entries.find(e => e.at === data.at) || entries[0]   // optional: restore a specific version
    : entries[0];
  if (!chosen || !chosen.before) {
    throw new functions.https.HttpsError("failed-precondition", "Ledger entry has no prior image to restore.");
  }
  await db.collection(coll).doc(docId).set(chosen.before);
  functions.logger.info("[restoreFromLedger] restored", { coll, docId, from: chosen.at, op: chosen.op });
  return { ok: true, restoredFrom: chosen.at, op: chosen.op, available: entries.length };
});

// ═════════════════════════════════════════════════════════════════════════

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
    }, [], "reminder_po");
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
    }, [], "reminder_daily");
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Daily Huddle nudge to coordinators (6:30am MT, weekdays)
// Sends each coordinator a push that deep-links to their Huddle (view=huddle;
// the Huddle defaults to their own book on their device). Coordinators =
// users whose NAME appears as a `coordinator` on any foreman user. Recipient
// resolution + token/prune all reuse the existing helpers — nothing else
// touched. ADDITIVE: new exports only.
// ─────────────────────────────────────────────────────────────
async function sendHuddleNotif(onlyUserId) {
  const users = await getUsers();
  const titleOf = u => u.title || u.role || "";
  const coordNames = Array.from(new Set(
    users.filter(u => titleOf(u) === "foreman" && u.coordinator).map(u => u.coordinator)
  ));
  const notif = {
    title: "Daily Huddle",
    body:  "Tap to open your Huddle and line up the day.",
    view:  "huddle",
  };
  const sends = [];
  let recipients = 0;
  for (const cn of coordNames) {
    const cu = users.find(u => (u.name || "").toLowerCase() === String(cn).toLowerCase());
    if (!cu) continue;
    if (onlyUserId && cu.id !== onlyUserId) continue;
    recipients++;
    sends.push(deliver(cu, notif));
  }
  await Promise.all(sends);
  functions.logger.info("[huddleNotif] sent", { coordinators: coordNames, recipients, onlyUserId: onlyUserId || null });
  return { coordNames, recipients };
}

exports.dailyHuddleNotification = functions.pubsub
  .schedule("30 6 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => { await sendHuddleNotif(); return null; });

// Manual test trigger — sends the Huddle push to ONE user (the caller passes
// their own userId) so delivery + the Huddle deep-link can be verified before
// the morning schedule matters. Read-only beyond sending a push.
exports.sendTestHuddleNotification = functions.https.onCall(async (data) => {
    requireAppKey(data);
  const userId = (data && data.userId) || "";
  if (!userId) return { ok: false, error: "userId required" };
  const r = await sendHuddleNotif(userId);
  return { ok: true, ...r };
});

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Daily CO chase to Jeromy (8am MT, weekdays)
// Jeromy quotes/sends COs. Scan every job for OPEN COs (not in a terminal
// status) older than 2 days and nudge him with a count + deep-link to the
// CO tracker. Read-only scan; the new-CO nudge above handles the immediate
// "just created" case. ADDITIVE: new export only.
// ─────────────────────────────────────────────────────────────
exports.dailyCoChase = functions.pubsub
  .schedule("0 8 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    const snap = await db.collection("jobs").get();
    const DONE = new Set(["completed", "complete", "approved", "denied", "converted"]);
    const now = Date.now();
    let staleCount = 0;
    const staleJobs = new Set();
    snap.forEach(d => {
      const j = d.data()?.data || {};
      if (j.type === "quote") return;
      (j.changeOrders || []).forEach(co => {
        if (!co || DONE.has(co.coStatus)) return;
        const t = Date.parse(co.createdAt || co.coStatusDate || "");
        const ageDays = Number.isFinite(t) ? (now - t) / 86400000 : 99;
        if (ageDays >= 2) { staleCount++; staleJobs.add(j.name || d.id); }
      });
    });
    if (staleCount > 0) {
      await sendToNameIfWanted("Jeromy Cloward", "co_chase", {
        title: "📋 COs waiting",
        body:  `${staleCount} change order${staleCount !== 1 ? "s" : ""} open across ${staleJobs.size} job${staleJobs.size !== 1 ? "s" : ""} — review & send.`,
        view:  "cos",
      });
    }
    functions.logger.info("[dailyCoChase] ran", { staleCount, jobs: staleJobs.size });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Unscheduled return trips sitting > 3 days → the job's
// coordinator (book-routed). Daily 8am weekdays. Read-only scan. ADDITIVE.
// ─────────────────────────────────────────────────────────────
exports.dailyRtChase = functions.pubsub
  .schedule("0 8 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    const users = await getUsers();
    const coordOf = (foremanName) => {
      const fm = users.find(u => (u.name || "").toLowerCase() === String(foremanName || "").toLowerCase());
      if (!fm || !fm.coordinator) return null;
      return users.find(u => (u.name || "").toLowerCase() === String(fm.coordinator).toLowerCase()) || null;
    };
    const snap = await db.collection("jobs").get();
    const now = Date.now();
    const byCoord = {};
    snap.forEach(d => {
      const j = d.data()?.data || {};
      if (j.type === "quote") return;
      (j.returnTrips || []).forEach(rt => {
        if (!rt || rt.signedOff || rt.rtScheduled || rt.scheduledDate) return;
        if (!(rt.scope || rt.date)) return;
        const created = Date.parse(rt.createdAt || rt.date || "");
        const ageDays = Number.isFinite(created) ? (now - created) / 86400000 : 99;
        if (ageDays < 3) return;
        const coord = coordOf(j.foreman);
        if (!coord) return;
        if (!byCoord[coord.id]) byCoord[coord.id] = { coord, count: 0 };
        byCoord[coord.id].count++;
      });
    });
    const sends = [];
    Object.values(byCoord).forEach(({ coord, count }) => {
      const notif = { title: "🔁 Return trips waiting", body: `${count} unscheduled return trip${count !== 1 ? "s" : ""} in your book need scheduling.` };
      sends.push(deliverIfWanted(coord, "rt_chase", notif));
    });
    await Promise.all(sends);
    functions.logger.info("[dailyRtChase] ran", { coordinators: Object.keys(byCoord).length });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Weekly safety / toolbox-talk reminder (Mon 6:45am MT) → foremen.
// ─────────────────────────────────────────────────────────────
exports.weeklySafetyReminder = functions.pubsub
  .schedule("45 6 * * 1")
  .timeZone(TZ)
  .onRun(async () => {
    await sendToRoles(["foreman"], {
      title: "🦺 Toolbox talk", body: "Run this week's safety / toolbox talk with your crew.",
    }, [], "reminder_safety");
    return null;
  });

// ─────────────────────────────────────────────────────────────
// WAVE-2 AUTO-NUDGES — book-routed + foreman. All read-only scans; delivery
// goes through deliverIfWanted (push + inbox, gated on each person's toggle).
// ADDITIVE: new scheduled exports only.
// ─────────────────────────────────────────────────────────────
const _dayInTZ = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? String(s).slice(0, 10) : d.toLocaleDateString("en-CA", { timeZone: TZ }); };
const _ageDays = (s) => { const t = Date.parse(s || ""); return Number.isFinite(t) ? (Date.now() - t) / 86400000 : 0; };
const _isQuote = (j) => j.type === "quote";
const _finishDone = (j) => (j.finishStatus === "complete") || (parseInt(j.finishStage, 10) === 100);
const _activeJob = (j) => !_isQuote(j) && !j.tempPed && !_finishDone(j);

// 1) Stale job — active job not touched in 5+ days → its foreman + coordinator.
// Daily 7:30am weekdays. Digest (one push each), so a quiet week buzzes once.
exports.dailyStaleJobChase = functions.pubsub
  .schedule("30 7 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    const users = await getUsers();
    const snap = await db.collection("jobs").get();
    const byForeman = {}; // name → count
    const byCoord = {};    // coordId → {coord, count}
    snap.forEach(d => {
      const j = d.data()?.data || {};
      if (!_activeJob(j)) return;
      if (_ageDays(j.updated_at) < 5) return;
      const fm = j.foreman;
      if (fm && fm !== "Unassigned") byForeman[fm] = (byForeman[fm] || 0) + 1;
      const coord = coordUserOf(users, fm);
      if (coord) { if (!byCoord[coord.id]) byCoord[coord.id] = { coord, count: 0 }; byCoord[coord.id].count++; }
    });
    const sends = [];
    Object.entries(byForeman).forEach(([fm, count]) => {
      const u = users.find(x => (x.name || "").toLowerCase() === fm.toLowerCase());
      if (u) sends.push(deliverIfWanted(u, "stale_job", { title: "🕸️ Stale job", body: `${count} of your job${count !== 1 ? "s have" : " has"} had no update in 5+ days.` }));
    });
    Object.values(byCoord).forEach(({ coord, count }) => {
      sends.push(deliverIfWanted(coord, "stale_job", { title: "🕸️ Stale jobs in your book", body: `${count} job${count !== 1 ? "s" : ""} in your book ${count !== 1 ? "have" : "has"} gone quiet for 5+ days.` }));
    });
    await Promise.all(sends);
    functions.logger.info("[dailyStaleJobChase] ran", { foremen: Object.keys(byForeman).length, coordinators: Object.keys(byCoord).length });
    return null;
  });

// 2) Daily-update missing — active job with a foreman but no daily update logged
// TODAY → that foreman. 4:45pm weekdays (after the 4:30 lead reminder). Digest.
exports.dailyUpdateMissing = functions.pubsub
  .schedule("45 16 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    const users = await getUsers();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
    const snap = await db.collection("jobs").get();
    const byForeman = {};
    snap.forEach(d => {
      const j = d.data()?.data || {};
      if (!_activeJob(j)) return;
      if (parseInt(j.roughStage, 10) === 0 && !j.roughStatus) return; // not started yet — no crew on site
      const fm = j.foreman;
      if (!fm || fm === "Unassigned") return;
      // Daily updates live in roughUpdates/finishUpdates ({date, createdAt, ...});
      // j.dailyUpdates was a dead pre-refactor field that made this 100% false-positive.
      const loggedToday = [...(j.roughUpdates || []), ...(j.finishUpdates || [])]
        .some(u => u && (_dayInTZ(u.createdAt || u.date) === today));
      if (loggedToday) return;
      byForeman[fm] = (byForeman[fm] || 0) + 1;
    });
    const sends = [];
    Object.entries(byForeman).forEach(([fm, count]) => {
      const u = users.find(x => (x.name || "").toLowerCase() === fm.toLowerCase());
      if (u) sends.push(deliverIfWanted(u, "daily_update_missing", { title: "📝 Daily update", body: `${count} of your active job${count !== 1 ? "s have" : " has"} no update logged today.` }));
    });
    await Promise.all(sends);
    functions.logger.info("[dailyUpdateMissing] ran", { foremen: Object.keys(byForeman).length });
    return null;
  });

// 3) Book digest — each coordinator gets a morning count of jobs in their book
// that need attention (open punch / unscheduled RT / pending CO / open Q).
// 6:50am weekdays (just after the 6:30 Huddle nudge).
exports.dailyBookDigest = functions.pubsub
  .schedule("50 6 * * 1-5")
  .timeZone(TZ)
  .onRun(async () => {
    const users = await getUsers();
    const CO_DONE = new Set(["completed", "complete", "approved", "denied", "converted"]);
    const punchOpen = (ph) => {
      if (!ph) return false;
      return ["upper", "main", "basement"].some(fk => {
        const fl = ph[fk] || {};
        return (fl.general || []).some(i => i && !i.done)
          || (fl.hotcheck || []).some(i => i && !i.done)
          || (fl.rooms || []).some(r => ((r && r.items) || []).some(i => i && !i.done));
      });
    };
    const qOpen = (q) => q && ["upper", "main", "basement"].some(fk => (q[fk] || []).some(x => x && !x.done));
    const needsAttention = (j) =>
      punchOpen(j.roughPunch) || punchOpen(j.finishPunch) || punchOpen(j.qcPunch)
      || (j.returnTrips || []).some(rt => rt && !rt.signedOff && !rt.rtScheduled && !rt.scheduledDate && (rt.scope || rt.date))
      || (j.changeOrders || []).some(co => co && !CO_DONE.has(co.coStatus))
      || qOpen(j.roughQuestions) || qOpen(j.finishQuestions);
    const snap = await db.collection("jobs").get();
    const byCoord = {};
    snap.forEach(d => {
      const j = d.data()?.data || {};
      if (_isQuote(j) || j.tempPed) return;
      if (!needsAttention(j)) return;
      const coord = coordUserOf(users, j.foreman);
      if (coord) { if (!byCoord[coord.id]) byCoord[coord.id] = { coord, count: 0 }; byCoord[coord.id].count++; }
    });
    const sends = [];
    Object.values(byCoord).forEach(({ coord, count }) => {
      sends.push(deliverIfWanted(coord, "book_digest", { title: "📋 Your book", body: `${count} job${count !== 1 ? "s" : ""} in your book need attention today.`, view: "today" }));
    });
    await Promise.all(sends);
    functions.logger.info("[dailyBookDigest] ran", { coordinators: Object.keys(byCoord).length });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// CLAUDE AGENTS — shared caller + draft-only agents
// Key lives in the ANTHROPIC_API_KEY secret (functions:secrets:set), bound per
// function via runWith({secrets}). All outputs are DRAFTS the user reviews —
// nothing auto-saves or sends. ADDITIVE: new helper + exports only.
// ─────────────────────────────────────────────────────────────
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
async function callClaude({ system, user, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || ANTHROPIC_MODEL,
      max_tokens: maxTokens || 400,
      system: system || "",
      messages: [{ role: "user", content: String(user || "") }],
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    functions.logger.warn("[callClaude] API error", { status: r.status, error: data && data.error });
    throw new Error((data && data.error && data.error.message) || `Claude API ${r.status}`);
  }
  return (data.content || []).map(b => b.text || "").join("").trim();
}

// Agent 1 — End-of-day update drafter. Client passes the job name + a context
// string (today's closed punch, etc.); returns a short editable draft.
exports.draftDailyUpdate = functions
  .runWith({ secrets: ["ANTHROPIC_API_KEY"] })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const jobName = (data && data.jobName) || "this job";
    const context = (data && data.context) || "";
    const system =
      "You write brief end-of-day field updates for an electrical contractor's daily job log. " +
      "Write 1-3 plain sentences a foreman would text the office: what got done today and where the job stands. " +
      "Use ONLY the facts provided — never invent specifics, names, or numbers. " +
      "No greeting, no sign-off, no markdown, no bullet points. " +
      "If little or nothing is provided, write a short honest placeholder the foreman can finish.";
    try {
      const text = await callClaude({ system, user: `Job: ${jobName}\n\n${context}`, maxTokens: 300 });
      return { ok: true, text };
    } catch (e) {
      functions.logger.warn("[draftDailyUpdate] failed", { error: e.message });
      return { ok: false, error: e.message || "draft failed" };
    }
  });

// Agent 2 — In-app help. Answers a question grounded ONLY in the app's feature
// reference (passed from the client's FEATURES_MD_INLINE). Read-only.
exports.appHelp = functions
  .runWith({ secrets: ["ANTHROPIC_API_KEY"] })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const question = String((data && data.question) || "").trim();
    const docs = String((data && data.docs) || "");
    if (!question) return { ok: false, error: "question required" };
    const system =
      "You are the in-app help assistant for Homestead Electric's field-ops app. " +
      "Answer the user's question about how to use THIS app, grounded ONLY in the feature reference provided. " +
      "Be concise and practical — a few sentences or short numbered steps. If the reference doesn't cover it, " +
      "say so plainly and suggest asking Koy. Plain text, no markdown headers.";
    try {
      const answer = await callClaude({
        system,
        user: `Feature reference:\n${docs || "(none provided)"}\n\nQuestion: ${question}`,
        maxTokens: 500,
      });
      return { ok: true, answer };
    } catch (e) {
      functions.logger.warn("[appHelp] failed", { error: e.message });
      return { ok: false, error: e.message || "help failed" };
    }
  });

// Agent 3 — Voice note cleanup. Tidies a raw speech transcript into clean note
// text; the client's existing triage hint then runs on it. Returns text only;
// on any failure returns the raw transcript so voice notes never break.
exports.cleanVoiceNote = functions
  .runWith({ secrets: ["ANTHROPIC_API_KEY"] })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const transcript = String((data && data.transcript) || "").trim();
    if (!transcript) return { ok: false, error: "transcript required" };
    const system =
      "You clean up a spoken field note from an electrician into tidy written text for a job log. " +
      "Fix grammar and filler words, keep ALL the facts, add nothing. If there are multiple distinct items, " +
      "put each on its own line starting with '- '. Plain text only, no headers, no commentary.";
    try {
      const text = await callClaude({ system, user: transcript, maxTokens: 400 });
      return { ok: true, text: text || transcript };
    } catch (e) {
      functions.logger.warn("[cleanVoiceNote] failed", { error: e.message });
      return { ok: false, error: e.message || "cleanup failed", text: transcript };
    }
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
    requireAppKey(data);
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
    requireAppKey(data);
  const { simproJobNo } = data || {};
  if (!simproJobNo) throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");

  const resp = await fetch(
    `${SIMPRO_BASE}/jobs/?ID=${encodeURIComponent(simproJobNo)}&pageSize=1&columns=ID,Total,Totals`,
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

  // Pick Actual when real costs are tracked, else Estimate. Falls through
  // to a flat number when Simpro returns one, then null.
  const pickAE = (obj) => {
    if (obj == null) return null;
    if (typeof obj === "number") return obj;
    return hasRealActual ? (obj.Actual ?? obj.Estimate ?? null) : (obj.Estimate ?? obj.Actual ?? null);
  };
  // Simpro's /jobs response has TWO separate objects we care about:
  //   job.Total  → { IncTax, ExTax, Tax } — the headline contract dollars
  //   job.Totals → { NettMargin, NettPL, MaterialsCost, ResourcesCost, ... }
  // We were originally only requesting columns=Totals, so job.Total was
  // missing from the response → all dollar fields came back null. Fixed
  // above by adding `Total` to the columns list. Read the headline
  // numbers from job.Total first, with a fallback to summing cost
  // components in case a tenant doesn't return Total.
  const top = job.Total || {};
  const _aeNum = (o) => o == null ? null
                       : typeof o === "number" ? o
                       : (o.Estimate ?? o.Actual ?? null);
  const _matCost = _aeNum(t.MaterialsCost);
  const _resCost = _aeNum(t.ResourcesCost);
  const _matMk   = _aeNum(t.MaterialsMarkup);
  const _resMk   = _aeNum(t.ResourcesMarkup);
  const _haveAnyComponent = _matCost != null || _resCost != null || _matMk != null || _resMk != null;
  const _derivedSubTotal = _haveAnyComponent
    ? ((_matCost||0) + (_resCost||0) + (_matMk||0) + (_resMk||0))
    : null;
  const totalIncTax = top.IncTax ?? t.IncTax ?? _derivedSubTotal;
  const totalExTax  = top.ExTax  ?? t.ExTax  ?? _derivedSubTotal;

  return {
    // Existing fields — unchanged.
    margin:    hasRealActual ? actual : estimate,
    isEstimate: !hasRealActual,
    laborHoursActual:   t.ResourcesCost?.LaborHours?.Actual   ?? null,
    laborHoursEstimate: t.ResourcesCost?.LaborHours?.Estimate ?? null,
    // Job size dollars — what powers the Scoreboard's S/M/L tier weighting.
    // total = with tax (the headline number on Simpro's project summary).
    total:    totalIncTax,
    subTotal: totalExTax,
    // Net P/L in dollars — Actual when costs are tracked, Estimate
    // otherwise. (Reverted from max(Actual,Estimate) per request — Koy
    // wants the real delivered profit number, not bid as a floor.)
    // Falls back to MaterialsMarkup + ResourcesMarkup when NettPL is
    // missing entirely (verified: 9613 + 19524 = 29137 for Cowdrey).
    netPL: (() => {
      const direct = pickAE(t.NettPL);
      if (direct != null) return direct;
      const matMk = pickAE(t.MaterialsMarkup);
      const resMk = pickAE(t.ResourcesMarkup);
      if (matMk == null && resMk == null) return null;
      return (matMk||0) + (resMk||0);
    })(),
    netPLActual:   t.NettPL?.Actual   ?? null,
    netPLEstimate: t.NettPL?.Estimate ?? null,
    // Gross figures for drilldown / future use.
    grossPL:     pickAE(t.GrossPL),
    grossMargin: pickAE(t.GrossMargin),
    // Cost components (what shows in the Simpro summary breakdown).
    materialsCost:   pickAE(t.MaterialsCost),
    resourcesCost:   pickAE(t.ResourcesCost),
    materialsMarkup: pickAE(t.MaterialsMarkup),
    resourcesMarkup: pickAE(t.ResourcesMarkup),
    overhead:        pickAE(t.OverHead) ?? pickAE(t.Overhead),
    invoicedValue:   pickAE(t.Invoiced) ?? pickAE(t.InvoicedValue),
    // Raw blobs — forward-compat for any extra fields Simpro returns later
    // (saves a redeploy if their schema gains a field we want to surface).
    // _rawTotal  = job.Total  (IncTax, ExTax, Tax)
    // _rawTotals = job.Totals (cost components, margins, NettPL, ...)
    _rawTotal:  job.Total || null,
    _rawTotals: t,
  };
});

// ─── Get Simpro job basics (name / address / site contact) ───────────────────
// Reads the single-job endpoint and returns the fields the manual Add Job
// form wants to prefill: name, full street address (joined from Site.Address
// when structured), and the Site Contact's name + phone.
//
// Defensive about field shape — Simpro's SiteContact object varies (some
// tenants put phones in CellPhone / WorkPhone / Phone). On every run the
// raw Site / SiteContact / Customer objects are logged so we can verify
// the exact shape from Koy's tenant and tighten the parser if needed.
//
// Data safety: read-only. Never writes to Simpro or Firestore. Returns
// only the fields needed for prefill plus raw blobs for forward-compat.
exports.getSimproJobBasics = functions.https.onCall(async (data) => {
    requireAppKey(data);
  const { simproJobNo } = data || {};
  if (!simproJobNo) {
    throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");
  }

  // /jobs/{ID} returns the full job record including SiteContact + Site.
  // The list endpoint (/jobs/?ID=...) only returns requested columns and
  // strips most of what we need.
  const resp = await fetch(
    `${SIMPRO_BASE}/jobs/${encodeURIComponent(simproJobNo)}`,
    { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } }
  );
  if (resp.status === 404) {
    throw new functions.https.HttpsError("not-found", `No Simpro job ${simproJobNo}`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new functions.https.HttpsError(
      "internal",
      `Simpro error: ${resp.status} ${body.slice(0, 200)}`
    );
  }
  const job = await resp.json();

  // Log the raw shape so the exact field names from this tenant are visible
  // in Cloud Functions logs. Cheap and only fires when the user explicitly
  // triggers the pull from the Add Job form.
  functions.logger.info("getSimproJobBasics raw", {
    simproJobNo,
    siteKeys:        job.Site        ? Object.keys(job.Site)        : null,
    siteContactKeys: job.SiteContact ? Object.keys(job.SiteContact) : null,
    customerKeys:    job.Customer    ? Object.keys(job.Customer)    : null,
    siteContactSample: job.SiteContact || null,
  });

  // ── Name: prefer Name, fall back to Description, then a placeholder.
  const name =
    (job.Name && String(job.Name).trim()) ||
    (job.Description && String(job.Description).trim()) ||
    `Simpro ${simproJobNo}`;

  // ── Address: Simpro returns Site.Address as either a string or a
  // structured { Address, City, State, PostalCode } object. Mirrors the
  // existing candidates flow at functions/index.js _runSimproCandidateRefresh.
  let address = "";
  if (job.Site) {
    if (typeof job.Site.Address === "string") {
      address = job.Site.Address;
    } else if (job.Site.Address && typeof job.Site.Address === "object") {
      const a = job.Site.Address;
      address = [a.Address, a.City, a.State, a.PostalCode].filter(Boolean).join(", ");
    } else if (job.Site.Name) {
      address = job.Site.Name;
    }
  }

  // ── Site Contact: name + phone. Simpro typically returns
  //   SiteContact: { ID, GivenName, FamilyName, Phone, CellPhone, WorkPhone, Email }
  // but the field set varies by tenant. Try every plausible phone field in
  // priority order — CellPhone is the most useful on a jobsite.
  let siteContactName = "";
  let siteContactPhone = "";
  const sc = job.SiteContact;
  if (sc && typeof sc === "object") {
    const parts = [sc.GivenName, sc.FamilyName].filter(Boolean);
    if (parts.length) siteContactName = parts.join(" ").trim();
    else if (sc.Name) siteContactName = String(sc.Name).trim();
    siteContactPhone =
      (sc.CellPhone && String(sc.CellPhone).trim()) ||
      (sc.Phone     && String(sc.Phone).trim())     ||
      (sc.WorkPhone && String(sc.WorkPhone).trim()) ||
      (sc.Mobile    && String(sc.Mobile).trim())    ||
      "";
  }

  return {
    name,
    address,
    siteContactName,
    siteContactPhone,
    // Forward-compat: raw blobs so the client can surface extra fields
    // without a redeploy if Koy decides he wants email or Customer too.
    _rawSite:        job.Site        || null,
    _rawSiteContact: job.SiteContact || null,
    _rawCustomer:    job.Customer    || null,
  };
});

// ─── PROBE: Get Simpro quote status (discovery for CO auto-approval) ───────────
// Read-only. Given a project quote # (as typed onto a CO in the app), fetch the
// matching Simpro quote and return its raw status/stage shape. Purpose: this
// tenant's exact field names + status values aren't known from outside Simpro,
// and firestore/simpro are unreachable from the dev sandbox — so we log + return
// the raw object, run it once on a real quote #, and use the result to wire the
// hourly auto-approval mapping with zero guessing.
//
// NEVER writes to Simpro. NEVER writes to Firestore. Pure GET.
//
// Tries the direct record first (/quotes/{ID}); if that 404s, walks the quote
// list a few pages looking for a matching ID/number so we learn the list shape
// too. Returns whatever it finds (raw) — the caller (Koy, from the console)
// reports it back so the mapping can be locked down.
exports.getSimproQuoteStatus = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const quoteNo = String((data && data.quoteNo) || "").trim();
    if (!quoteNo) {
      throw new functions.https.HttpsError("invalid-argument", "quoteNo required");
    }

    // 1. Direct record fetch — the common case if the # is the Simpro quote ID.
    const direct = await simproReqWithRetry(
      "GET",
      `/quotes/${encodeURIComponent(quoteNo)}`
    );

    if (direct.ok && direct.data && typeof direct.data === "object") {
      const q = direct.data;
      functions.logger.info("getSimproQuoteStatus direct hit", {
        quoteNo,
        topKeys: Object.keys(q),
        Stage: q.Stage,
        Status: q.Status,
        StatusName: q.Status && q.Status.Name,
      });
      return {
        matchedBy: "id",
        quoteNo,
        Stage: q.Stage ?? null,
        Status: q.Status ?? null,
        Name: q.Name ?? null,
        Total: q.Total ?? null,
        // Full raw object so we see every field this tenant returns.
        _raw: q,
      };
    }

    // 2. Fallback — list a few pages and look for a match by ID or any
    //    field that equals the typed quote #. Also surfaces the list shape.
    const found = [];
    let listShape = null;
    for (let page = 1; page <= 5; page++) {
      const r = await simproReqWithRetry(
        "GET",
        `/quotes/?pageSize=250&page=${page}&columns=ID,Name,Stage,Status,Total,DateIssued`
      );
      if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) break;
      if (!listShape && r.data[0]) listShape = Object.keys(r.data[0]);
      for (const q of r.data) {
        const idStr = String(q.ID ?? "").trim();
        if (idStr === quoteNo) found.push(q);
      }
      if (found.length) break;
      if (r.data.length < 250) break;
    }

    functions.logger.info("getSimproQuoteStatus fallback", {
      quoteNo,
      directStatus: direct.status,
      listShape,
      foundCount: found.length,
      found,
    });

    return {
      matchedBy: found.length ? "list" : "none",
      quoteNo,
      directStatus: direct.status,
      directBody:
        typeof direct.data === "string" ? direct.data.slice(0, 300) : null,
      listShape,
      matches: found,
    };
  });

// ─── Get Simpro Job Profit/Loss feed (Scoreboard source) ──────────────────────
// Pulls every Simpro job that's been touched in the requested year-to-date
// window. Returns the full P/L picture for each + the technician field so the
// Scoreboard can attribute by foreman without needing the job to exist in our
// Firestore yet. This is what powers Koy's "scoreboard back to before the app
// was built" use case.
//
// Filters to jobs in the window using DateModified >= dateFrom (or the full
// year-to-date if no range supplied). Walks pages until empty.
//
// Returns the full reduced field set per job so the client can decide what to
// surface; raw Total + Totals blobs are also returned for forward-compat.
exports.getSimproProfitLossYTD = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const { dateFrom, dateTo } = data || {};
    const fromYMD = dateFrom || `${new Date().getFullYear()}-01-01`;
    const toYMD   = dateTo   || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    })();

    // STRATEGY (after several rounds of figuring out what works on this
    // tenant): bulk /jobs/?columns=... is brittle — adding an unrecognized
    // column collapses the whole response to 0. Instead:
    //   1) bulk fetch IDs only via display=basic
    //   2) per-ID fetch /jobs/{ID}?display=detailed in parallel — each
    //      returns the FULL job record (Totals, dates, attribution)
    //   3) filter to the date window + reduce
    // Per-ID fetches with concurrency 20 finish ~1300 jobs in well under
    // the 540s timeout. Rate-limit (429) gets a single backoff retry.

    // ── Step 1: bulk-fetch IDs ────────────────────────────────────────────
    const ids = [];
    let page = 1;
    const MAX_PAGES = 80;
    let pageStatuses = [];
    while (page <= MAX_PAGES) {
      const url = `${SIMPRO_BASE}/jobs/?pageSize=250&page=${page}&display=basic`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
      pageStatuses.push({ page, status: resp.status });
      if (!resp.ok) {
        functions.logger.warn("getSimproProfitLossYTD bulk page failed", { page, status: resp.status });
        break;
      }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      batch.forEach(j => { if (j && j.ID != null) ids.push(j.ID); });
      if (batch.length < 250) break;
      page++;
    }

    // ── Step 2: read cache, only fetch missing/stale ──────────────────────
    // Cache lives at settings/scoreboardSimproPL keyed by Simpro ID. Each
    // entry stores the reduced field set + fetchedAt. On every call we read
    // the doc, decide which IDs need a refresh (missing or older than the
    // STALE_MS window), and ONLY hit Simpro for those. First call is slow
    // and seeds the cache; every call after returns mostly from cache and
    // just tops up new/stale jobs.
    const STALE_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const cacheRef = db.collection("settings").doc("scoreboardSimproPL");
    const cacheSnap = await cacheRef.get();
    const cache = cacheSnap.exists ? (cacheSnap.data() || {}) : {};

    const idsToFetch = ids.filter(id => {
      const cached = cache[String(id)];
      if (!cached || !cached.fetchedAt) return true;
      const age = now - new Date(cached.fetchedAt).getTime();
      return age > STALE_MS || isNaN(age);
    });
    functions.logger.info("getSimproProfitLossYTD cache plan", {
      totalIds: ids.length, cached: ids.length - idsToFetch.length, toFetch: idsToFetch.length,
    });

    // ── Step 3: detailed fetch only the IDs that need it ─────────────────
    const fresh = new Array(idsToFetch.length);
    let okCount = 0, errCount = 0;
    const CONCURRENCY = 15; // gentler than 20 — fewer 429s, more reliable
    let cursor = 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const fetchOne = async (idx) => {
      const id = idsToFetch[idx];
      const url = `${SIMPRO_BASE}/jobs/${encodeURIComponent(id)}?display=detailed`;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` } });
          if (resp.status === 429) {
            // Exponential backoff on rate-limit: 500ms, 1.5s, 3s
            await sleep(500 * (attempt + 1) * (attempt + 1));
            continue;
          }
          if (!resp.ok) { errCount++; return; }
          fresh[idx] = await resp.json();
          okCount++;
          return;
        } catch (e) {
          if (attempt === 3) { errCount++; return; }
          await sleep(300 * (attempt + 1));
        }
      }
    };
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= idsToFetch.length) return;
        await fetchOne(idx);
      }
    };
    await Promise.all(Array.from({length: CONCURRENCY}, worker));
    functions.logger.info("getSimproProfitLossYTD fetched", {
      attempted: idsToFetch.length, ok: okCount, err: errCount,
      pages: pageStatuses,
      sampleKeys: fresh[0] ? Object.keys(fresh[0]).slice(0, 30) : [],
    });

    // Per-job reducer — same shape getSimproJobFinancials returns so the
    // Scoreboard can reuse the existing aggregation code paths. Plus a few
    // attribution fields (technician, projectManager) that the Scoreboard
    // needs to assign rows to a foreman without an app job doc.
    const _aeNum = (o) => o == null ? null
                       : typeof o === "number" ? o
                       : (o.Estimate ?? o.Actual ?? null);
    const reduce = (job) => {
      const t = job.Totals || {};
      const top = job.Total || {};
      const actual = t.NettMargin?.Actual ?? null;
      const estimate = t.NettMargin?.Estimate ?? null;
      const hasRealActual = actual !== null && actual !== 100;
      const pickAE = (obj) => {
        if (obj == null) return null;
        if (typeof obj === "number") return obj;
        return hasRealActual ? (obj.Actual ?? obj.Estimate ?? null) : (obj.Estimate ?? obj.Actual ?? null);
      };
      const matCost = _aeNum(t.MaterialsCost);
      const resCost = _aeNum(t.ResourcesCost);
      const matMk   = _aeNum(t.MaterialsMarkup);
      const resMk   = _aeNum(t.ResourcesMarkup);
      const haveAnyComponent = matCost != null || resCost != null || matMk != null || resMk != null;
      const derivedSubTotal = haveAnyComponent
        ? ((matCost||0) + (resCost||0) + (matMk||0) + (resMk||0))
        : null;
      const totalIncTax = top.IncTax ?? t.IncTax ?? derivedSubTotal;
      const totalExTax  = top.ExTax  ?? t.ExTax  ?? derivedSubTotal;

      // Technician + project-manager attribution. Simpro returns these as
      // {ID, Name} objects when populated. Capture name + first-name (the form
      // the Scoreboard's foreman list uses). Fallback chain: technician →
      // projectManager → salesperson.
      const _name = (o) => (o && typeof o === "object" && o.Name) ? String(o.Name).trim() : "";
      const techName = _name(job.Technician);
      const pmName   = _name(job.ProjectManager);
      const spName   = _name(job.Salesperson);
      const attribution = techName || pmName || spName || "";
      const attributionFirst = attribution ? attribution.split(/\s+/)[0] : "";

      return {
        simproId: job.ID,
        name: job.Name || "",
        description: job.Description || "",
        status: job.Status?.Name || job.Status || "",
        stage: job.Stage || "",
        dateIssued:   job.DateIssued || null,
        dateModified: job.DateModified || null,
        dateApproved: job.DateApproved || null,
        customer: _name(job.Customer),
        site:     _name(job.Site),
        technician: techName,
        projectManager: pmName,
        salesperson: spName,
        attribution,
        attributionFirst,
        // Financials (mirror getSimproJobFinancials)
        margin: hasRealActual ? actual : estimate,
        isEstimate: !hasRealActual,
        total:    totalIncTax,
        subTotal: totalExTax,
        netPL: (() => {
          const direct = pickAE(t.NettPL);
          if (direct != null) return direct;
          const m = pickAE(t.MaterialsMarkup);
          const r = pickAE(t.ResourcesMarkup);
          if (m == null && r == null) return null;
          return (m||0) + (r||0);
        })(),
        netPLActual:   t.NettPL?.Actual   ?? null,
        netPLEstimate: t.NettPL?.Estimate ?? null,
        grossPL:     pickAE(t.GrossPL),
        grossMargin: pickAE(t.GrossMargin),
        materialsCost:   pickAE(t.MaterialsCost),
        resourcesCost:   pickAE(t.ResourcesCost),
        materialsMarkup: pickAE(t.MaterialsMarkup),
        resourcesMarkup: pickAE(t.ResourcesMarkup),
        overhead:        pickAE(t.OverHead) ?? pickAE(t.Overhead),
        invoicedValue:   pickAE(t.Invoiced) ?? pickAE(t.InvoicedValue),
      };
    };

    // ── Step 4: reduce fresh fetches + merge into cache ──────────────────
    // Each fresh job is reduced to its compact field set and stamped with
    // fetchedAt. Older entries that are still in the cache stay as-is.
    const cacheUpdates = {};
    fresh.forEach((job, idx) => {
      if (!job) return;
      const id = String(idsToFetch[idx]);
      const reduced = reduce(job);
      cacheUpdates[id] = { ...reduced, fetchedAt: new Date().toISOString() };
    });
    if (Object.keys(cacheUpdates).length > 0) {
      try {
        await cacheRef.set(cacheUpdates, { merge: true });
      } catch (e) {
        functions.logger.warn("getSimproProfitLossYTD cache write failed", { error: e.message });
      }
    }

    // ── Step 5: assemble final list — cache + fresh, filter to window ────
    // Walk every ID we know about. Prefer fresh-this-run over cached. Filter
    // by the requested date window (cached entries already have dateModified
    // since the reducer captured it; we don't need to re-parse Simpro raw).
    const merged = ids.map(id => {
      const k = String(id);
      return cacheUpdates[k] || cache[k] || null;
    }).filter(Boolean);

    const _ymdOf = (entry) => {
      const raw = entry?.dateModified || entry?.dateApproved || entry?.dateIssued || null;
      if (!raw) return null;
      return String(raw).slice(0, 10);
    };
    const filtered = merged.filter(entry => {
      const ymd = _ymdOf(entry);
      if (!ymd) return true;
      return ymd >= fromYMD && ymd <= toYMD;
    });

    return {
      dateFrom: fromYMD,
      dateTo: toYMD,
      totalSimproIds: ids.length,
      cachedFromBefore: ids.length - idsToFetch.length,
      freshThisRun: okCount,
      freshFailed: errCount,
      mergedCount: merged.length,
      jobCount: filtered.length,
      // First raw row from THIS run (debug) — null on subsequent calls
      // when nothing was fetched fresh; that's fine.
      _sampleRaw: fresh[0] || null,
      jobs: filtered,
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
    requireAppKey(data);
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
    requireAppKey(data);
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
    requireAppKey(data);
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
    requireAppKey(data);
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
    requireAppKey(data);
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
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

// ─── Simpro candidates inbox ──────────────────────────────────────────────
// Fetches Pending-stage Simpro jobs and stores ones that aren't yet in the
// app to settings/simproCandidates. The app shows a header badge with the
// count and a modal to Import or Ignore each one. Nothing actually creates
// an app job here — that only happens when Koy clicks Import in the UI.
//
// Data safety:
//   • Read-only on Simpro.
//   • Writes only to settings/simproCandidates. Never touches /jobs.
//   • Preserves existing `ignored` flags on candidates across runs (so a
//     dismissed Simpro job stays dismissed).
//   • A bad Simpro response (5xx, timeout) bails the whole run instead of
//     half-updating the doc.
//   • Removes candidates whose Simpro job has been imported into the app
//     (matched by simproNo) so they stop reappearing.
async function _runSimproCandidateRefresh() {
  // Walk Simpro /jobs/?Stage=Pending paginated. Defensive about field shape:
  // Simpro returns minimal columns by default, so we explicitly request
  // ID/Name/Description/Site/Customer/Stage to keep the inbox useful.
  const cols = encodeURIComponent("ID,Name,Description,Site,Customer,Stage,DateIssued");
  const fetched = [];
  let page = 1;
  const MAX_PAGES = 30;
  while (page <= MAX_PAGES) {
    const url = `${SIMPRO_BASE}/jobs/?Stage=Pending&columns=${cols}&pageSize=100&page=${page}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${SIMPRO_TOKEN}` },
    });
    if (!resp.ok) {
      functions.logger.warn("refreshSimproCandidates: page failed", {
        page, status: resp.status,
      });
      // Hard fail — don't write a partial list. Keep last good doc intact.
      throw new Error(`Simpro /jobs/ returned ${resp.status} on page ${page}`);
    }
    const batch = await resp.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    fetched.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  // Existing app jobs by simproNo (string-compared) — anything already
  // imported is excluded from the candidates list automatically.
  const jobsSnap = await db.collection("jobs").get();
  const importedSimproNos = new Set();
  jobsSnap.docs.forEach(d => {
    const sn = d.data()?.data?.simproNo;
    if (sn) importedSimproNos.add(String(sn));
  });

  // Existing candidates doc — preserve any `ignored` flags users have set.
  const candDoc = await db.doc("settings/simproCandidates").get();
  const prev = candDoc.exists ? (candDoc.data().candidates || []) : [];
  const prevById = new Map(prev.map(c => [String(c.simproId), c]));

  const nowIso = new Date().toISOString();
  const candidates = [];
  for (const j of fetched) {
    const simproId = j && j.ID ? String(j.ID) : null;
    if (!simproId) continue;
    if (importedSimproNos.has(simproId)) continue; // already in app — skip

    // Pull a sensible name. Simpro varies: some installs put the project name
    // in Name, others in Description. Take whichever is non-empty.
    const name = (j.Name && String(j.Name).trim()) || (j.Description && String(j.Description).trim()) || `Simpro ${simproId}`;
    // Site address — Simpro typically returns Site as an object with Address
    // (string) or as a structured Address sub-object.
    let address = "";
    if (j.Site) {
      if (typeof j.Site.Address === "string") address = j.Site.Address;
      else if (j.Site.Address && typeof j.Site.Address === "object") {
        const a = j.Site.Address;
        address = [a.Address, a.City, a.State, a.PostalCode].filter(Boolean).join(", ");
      } else if (j.Site.Name) {
        address = j.Site.Name;
      }
    }
    const customer = (j.Customer && (j.Customer.CompanyName || j.Customer.Name)) || "";
    const dateIssued = j.DateIssued || "";

    const existing = prevById.get(simproId) || {};
    candidates.push({
      simproId,
      name,
      address,
      customer,
      dateIssued,
      stage: j.Stage || "Pending",
      firstSeenAt: existing.firstSeenAt || nowIso,
      lastSeenAt:  nowIso,
      ignored:     !!existing.ignored,
      ignoredAt:   existing.ignoredAt || null,
    });
  }

  // Sort newest-first by firstSeenAt for display.
  candidates.sort((a, b) => (b.firstSeenAt || "").localeCompare(a.firstSeenAt || ""));

  await db.doc("settings/simproCandidates").set({
    candidates,
    updated_at: nowIso,
  });

  // Push notify Koy if there are any NEW non-ignored candidates this run.
  const prevIds = new Set(prev.map(c => String(c.simproId)));
  const newOnes = candidates.filter(c =>
    !c.ignored && !prevIds.has(String(c.simproId))
  );
  if (newOnes.length > 0) {
    const names = newOnes.slice(0, 3).map(c => c.name).join(", ");
    const more = newOnes.length > 3 ? ` +${newOnes.length - 3} more` : "";
    try {
      await sendToName("Koy", {
        title: `${newOnes.length} new Simpro job${newOnes.length===1?"":"s"} pending review`,
        body:  `${names}${more}`,
      });
    } catch (e) {
      functions.logger.warn("refreshSimproCandidates: push failed", { error: e.message });
    }
  }

  return {
    fetched: fetched.length,
    pending: candidates.filter(c => !c.ignored).length,
    ignored: candidates.filter(c =>  c.ignored).length,
    newOnes: newOnes.length,
  };
}

// Callable for the on-demand "Sync from Simpro now" button. Returns the
// summary so the UI can show a toast like "2 new pending jobs".
exports.refreshSimproCandidates = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data) => {
    requireAppKey(data);
    try {
      const summary = await _runSimproCandidateRefresh();
      return { ok: true, ...summary };
    } catch (e) {
      functions.logger.error("refreshSimproCandidates failed", { error: e.message });
      throw new functions.https.HttpsError("internal", e.message || "Simpro fetch failed");
    }
  });

// Scheduled run every 4 hours. Uses the same helper so behaviour is
// identical to the on-demand button.
exports.scheduledSimproCandidateRefresh = functions.pubsub
  .schedule("0 */4 * * *")
  .timeZone(TZ)
  .onRun(async () => {
    try {
      const summary = await _runSimproCandidateRefresh();
      functions.logger.info("scheduledSimproCandidateRefresh ran", summary);
    } catch (e) {
      functions.logger.error("scheduledSimproCandidateRefresh failed", { error: e.message });
    }
    return null;
  });

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

    // ── PACKET V2 EXTRAS (2026-07-10) — TL loop, PTO, suggestions, fleet ──
    // Replaces the dead "Last Week's Decisions" stub with data that exists.
    // All read-only; a failure here degrades to empty sections, never kills
    // the packet.
    let tlRows = [], tlUnincorporated = 0, tlAwaiting = 0;
    let ptoNext7 = [];
    let suggOpen = 0, suggNew = 0;
    let fleetLine = "";
    try {
      const [hrSnap, ptoSnap, suggSnap, devSnap] = await Promise.all([
        db.collection("homeowner_requests").get(),
        db.doc("settings/crewPTO").get(),
        db.collection("suggestions").get(),
        db.doc("settings/deviceVersions").get(),
      ]);

      // Tech Lighting loop — same predicates as techLightingWeeklyDigest:
      // unincorporated = logged plan-change item with no ackedAt; awaiting =
      // discussion thread whose last message is from the client.
      const ackMap = {}, threadMap = {};
      hrSnap.forEach(d => {
        const data = d.data() || {}; // homeowner_requests are NOT wrapped
        if (data.planChangeAcks)    ackMap[d.id]    = data.planChangeAcks;
        if (data.planChangeThreads) threadMap[d.id] = data.planChangeThreads;
      });
      snap.docs.forEach(d => {
        const j = d.data()?.data || {};
        if (j.lightingSystem !== "Lutron") return;
        if (j.panelizedLighting?.excludeFromLutronHub) return;
        const items   = (j.panelizedLighting?.lutronRooms || []).flatMap(r => r.items || []);
        const acks    = ackMap[d.id] || {};
        const threads = threadMap[d.id] || {};
        const un = items.filter(it => !acks[it.id]?.ackedAt).length;
        const aw = [...items.map(it => it.id), "_general"].filter(id => {
          const msgs = threads[id];
          return msgs && msgs.length && msgs[msgs.length - 1].role === "client";
        }).length;
        if (un > 0 || aw > 0) tlRows.push({ jobName: j.name || d.id, un, aw });
        tlUnincorporated += un; tlAwaiting += aw;
      });

      // PTO overlapping the next 7 days — settings/crewPTO {list:[{name,start,end,note}]}
      const in7 = new Date(today); in7.setDate(today.getDate() + 7);
      ptoNext7 = ((ptoSnap.exists ? ptoSnap.data().list : []) || []).filter(p => {
        const s = parseDate(p.start), e = parseDate(p.end || p.start);
        return s && e && s <= in7 && e >= today;
      }).sort((a, b) => String(a.start).localeCompare(String(b.start)));

      // App Map suggestions — anything not "built" is open (matches the inbox filter).
      suggSnap.forEach(d => {
        const st = (d.data() || {}).status || "new";
        if (st !== "built") { suggOpen++; if (st === "new") suggNew++; }
      });

      // Fleet staleness — devices active in the last 7 days still behind the
      // newest version any device reports.
      const devices = devSnap.exists ? (devSnap.data().devices || {}) : {};
      const activeDevs = Object.values(devices).filter(dv => (Date.now() - Date.parse(dv.lastSeenAt || 0)) < 7 * 86400000);
      const vNum = v => parseInt(String(v || "").replace(/\D/g, ""), 10) || 0;
      const newest = activeDevs.reduce((m, dv) => Math.max(m, vNum(dv.version)), 0);
      const behind = activeDevs.filter(dv => vNum(dv.version) < newest);
      fleetLine = activeDevs.length
        ? `${behind.length} of ${activeDevs.length} active devices behind v${newest}${behind.length ? ` — ${behind.map(dv => dv.name || "?").join(", ")}` : ""}`
        : "No device pings in the last 7 days.";
    } catch (e) {
      functions.logger.warn("thursdayPacket v2 extras failed", { error: e.message });
    }

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

${bigHeader("Tech Lighting Loop")}
${section("Jobs with an open loop", tlRows.length, list(tlRows, r => `<b>${_esc(r.jobName)}</b>${r.un ? ` · ${r.un} change${r.un !== 1 ? "s" : ""} not incorporated` : ""}${r.aw ? ` · ${r.aw} question${r.aw !== 1 ? "s" : ""} awaiting a crew reply` : ""}`))}
${tlRows.length ? `<div style="color:#6b7280;font-size:11px;margin-top:4px;font-style:italic">${tlUnincorporated} unincorporated · ${tlAwaiting} awaiting reply, across all on-link Lutron jobs.</div>` : ""}

${bigHeader("Crew & App")}
${section("PTO in the next 7 days", ptoNext7.length, list(ptoNext7, p => `<b>${_esc(p.name)}</b> · ${_esc(p.start)}${p.end && p.end !== p.start ? ` → ${_esc(p.end)}` : ""}${p.note ? ` — ${_esc(p.note)}` : ""}`))}
${section("Open App Map suggestions", suggOpen, suggOpen
      ? `<div style="font-size:13px;color:#111;padding:2px 0 6px">${suggOpen} open${suggNew ? ` (${suggNew} new)` : ""} — triage in App Map → suggestion inbox.</div>`
      : `<div style="color:#9ca3af;font-size:12px;padding:2px 0 6px">None.</div>`)}
${fleetLine ? `<div style="font-size:12px;color:#374151;margin:8px 0 0"><b>Fleet:</b> ${_esc(fleetLine)}</div>` : ""}

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
        // No matching folder yet. Do NOT create one here. This trigger
        // fires on EVERY save to a job doc — including while the name is
        // still being typed — so auto-creating produced folders named
        // after a half-typed job name. Folder creation is now manual via
        // the "Create Drive folder" button (createJobDriveFolder callable).
        // This branch stays link-only: it still auto-links a folder Koy
        // made by hand, which is never wrong.
        return null;
      } else {
        // Ambiguous — bail out and let human review resolve.
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
        updated_at: new Date().toISOString(), // ISO string, NOT a Timestamp: firestore.rules require `updated_at is string`, and the client baseline guard String()-compares it (H7).
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
            updated_at: new Date().toISOString(), // ISO string, NOT a Timestamp: firestore.rules require `updated_at is string`, and the client baseline guard String()-compares it (H7).
          });
          linked.push({ job: j.data.name, folder: matches[0].name });
        } else if (matches.length === 0) {
          // No matching folder — leave it. Auto-creation is intentionally
          // disabled (here and in ensureJobDriveFolder) so a job never gets
          // a folder named after an unfinished name. Folders are created
          // deliberately via the manual "Create Drive folder" button.
          // This sweep stays link-only as a backstop for hand-made folders.
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
// CALLABLE — createJobDriveFolder
// Manually create (or link to an existing) Drive folder for a job.
// Triggered by the "Create Drive folder" button on Job Info, so the
// folder is only ever made once the name is final — no more folders
// named after a half-typed job name.
// Idempotent: if the job already has a driveFolderId, returns it.
// Prefers an existing hand-made folder before creating a new one.
// Read-only on Drive except the one folder it creates; writes only the
// single job's driveFolderId.
// ─────────────────────────────────────────────────────────────
exports.createJobDriveFolder = functions.https.onCall(async (data, context) => {
    requireAppKey(data);
  const jobId = String((data && data.jobId) || "").trim();
  if (!jobId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing jobId");
  }

  const ref  = db.collection("jobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Job not found");
  }

  const job = snap.data()?.data || {};
  if (job.driveFolderId) {
    return { folderId: job.driveFolderId, alreadyLinked: true };
  }

  const name = String(job.name || "").trim();
  if (!name || name.length < 3) {
    throw new functions.https.HttpsError("failed-precondition", "Give the job a name first.");
  }

  let folderId = "", folderName = "", createdNew = false;
  try {
    const drive = _driveClient();

    // Prefer an existing hand-made folder before creating a new one.
    const listRes = await drive.files.list({
      q: `'${JOBS_PARENT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
      pageSize: 200,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const existing = (listRes.data.files || []).filter(f => _namesMatch(f.name, name));

    if (existing.length >= 1) {
      folderId   = existing[0].id;
      folderName = existing[0].name;
    } else {
      const wantName = _jobFolderName(job);
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
    }
  } catch (e) {
    functions.logger.error("createJobDriveFolder drive error", { jobId, error: e.message });
    throw new functions.https.HttpsError("internal", e.message || "Drive request failed");
  }

  if (!folderId) {
    throw new functions.https.HttpsError("internal", "Could not create the Drive folder.");
  }

  try {
    await ref.update({
      "data.driveFolderId": folderId,
      updated_at: new Date().toISOString(), // ISO string, NOT a Timestamp: firestore.rules require `updated_at is string`, and the client baseline guard String()-compares it (H7).
    });
  } catch (e) {
    functions.logger.error("createJobDriveFolder save error", { jobId, folderId, error: e.message });
    throw new functions.https.HttpsError("internal", "Folder made but couldn't save the link — paste it manually.");
  }

  functions.logger.info("createJobDriveFolder done", { jobId, name, folderId, folderName, createdNew });
  return { folderId, folderName, createdNew };
});

// ─────────────────────────────────────────────────────────────
// CALLABLE — sendTestNotification
// Fires a test push to every token registered for the caller's user record.
// Also reports how many tokens are currently registered and how many were
// pruned as dead. Used by the "Send Test Notification" button in Settings
// to verify iOS/Android delivery end-to-end.
// ─────────────────────────────────────────────────────────────
exports.sendTestNotification = functions.https.onCall(async (data, context) => {
    requireAppKey(data);
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


// ─── Sync Simpro POs into a job's material orders ─────────────────────────
// Read-only from Simpro. Writes ONLY to the app's Firestore job document.
// Pulls the open POs Simpro has for one job, matches them to existing
// roughMaterials / finishMaterials entries by supplier source, and fills
// in fields the user hasn't manually set yet:
//   • po           — the Simpro PO number (only if empty)
//   • ordered      — flipped true only if false (preserves manual override)
//   • pickedUp     — flipped true only if false AND Simpro says received
//   • simproPoId / simproStatus / simproSyncedAt / simproSupplier — always
//     written for traceability
//
// Never overwrites a populated `po` field. Never touches `pickedUp:true`
// once a foreman has marked it. Simpro is GET-only — no POST/PATCH/DELETE
// to Simpro anywhere in this function.
//
// Core logic lives in _syncSimproPOsForOneJob below. Two entrypoints share
// it: the manual callable (button click) and the scheduled function (every
// 5 min). Same code path → same behavior.
async function _syncSimproPOsForOneJob({ simproJobNo, jobId }) {
    // ── 1. Discover the working PO endpoint for this tenant ─────────────
    // Same defensive endpoint-probing approach getSimproJobOrderedQty uses
    // — Simpro tenants differ on whether POs live at /purchaseOrders/ or
    // /vendorOrders/ and whether the filter is Job.ID / JobID / Job[ID].
    const jn = encodeURIComponent(simproJobNo);
    const bracketJob = encodeURIComponent("Job[ID]");
    const candidateListUrls = [
      // Job-scoped paths FIRST. These guarantee the response is filtered to
      // the specific job because the job ID is in the URL path, not a
      // query param Simpro might ignore. If these return data, we trust
      // it without further filtering. If they 404, we fall through to
      // global endpoints with query-param filters (less reliable — Simpro
      // sometimes ignores unknown filter params and returns everything).
      `/jobs/${jn}/purchaseOrders/?pageSize=250`,
      `/jobs/${jn}/vendorOrders/?pageSize=250`,
      // Global endpoints with query-param filters. Risky — if Simpro
      // doesn't recognize the filter param it returns ALL POs (250 cap).
      `/purchaseOrders/?Job.ID=${jn}&pageSize=250`,
      `/purchaseOrders/?JobID=${jn}&pageSize=250`,
      `/purchaseOrders/?${bracketJob}=${jn}&pageSize=250`,
      `/vendorOrders/?Job.ID=${jn}&pageSize=250`,
      `/vendorOrders/?JobID=${jn}&pageSize=250`,
    ];

    let workingListUrl = null;
    let simproPOs = [];
    const _debugListAttempts = [];
    for (const url of candidateListUrls) {
      const r = await simproReqWithRetry("GET", url, null, { maxAttempts: 2 });
      _debugListAttempts.push({ url, status: r.status, count: Array.isArray(r.data) ? r.data.length : null });
      if (r.ok && Array.isArray(r.data)) {
        // Prefer non-empty; first non-empty wins. Fall through to empty-ok as fallback.
        if (r.data.length > 0) {
          workingListUrl = url;
          simproPOs = r.data;
          break;
        }
        if (!workingListUrl) {
          workingListUrl = url;
          simproPOs = [];
        }
      }
    }

    if (!workingListUrl) {
      functions.logger.warn("syncSimproPOsForJob: no working PO endpoint", { simproJobNo, attempts: _debugListAttempts });
      return {
        ok: false,
        error: "Couldn't find a working Simpro PO endpoint — Simpro may not have POs for this job, or the API shape changed.",
        _debug: { listAttempts: _debugListAttempts },
      };
    }

    // Defensive sanity check: if we hit a global endpoint with a query
    // filter AND got exactly 250 results (the page-size cap), the filter
    // probably wasn't recognized and we have a global list, not a
    // job-scoped one. Surface this clearly rather than blindly matching.
    const usedGlobalEndpoint = !workingListUrl.includes(`/jobs/${jn}/`);
    const hitPageCap = simproPOs.length === 250;
    if (usedGlobalEndpoint && hitPageCap) {
      functions.logger.warn("syncSimproPOsForJob: filter likely ignored — got 250 (page cap) from global endpoint", {
        simproJobNo, workingListUrl,
      });
      // Don't give up yet — we'll post-filter by Job.ID on the detail
      // fetches below. But the warning is here so we can spot it in logs.
    }

    // ── 2. Fetch detail for each PO (status + supplier) ─────────────────
    const isJobScoped = workingListUrl.includes(`/jobs/${jn}/`);
    const resourceName = workingListUrl.includes("/vendorOrders/") ? "vendorOrders" : "purchaseOrders";
    const detailBase = isJobScoped ? `/jobs/${jn}/${resourceName}` : `/${resourceName}`;

    let _firstDetailDumped = false;
    const enrichTasks = simproPOs.map(po => async () => {
      const id = po?.ID ?? po?.Id ?? po?.id;
      if (!id) return null;
      const r = await simproReqWithRetry("GET", `${detailBase}/${id}`);
      if (!r.ok || !r.data) return null;
      const d = r.data;

      // Dump the first detail response in full so we can see every field
      // Simpro returns — including the actual Job reference shape. Only
      // first one to keep logs readable.
      if (!_firstDetailDumped) {
        _firstDetailDumped = true;
        functions.logger.info("syncSimproPOs: first PO DETAIL response", {
          simproJobNo, poId: id, fullDetail: d,
        });
      }

      // Try every place Simpro might stash the Job reference. Confirmed
      // from production responses: PO detail often doesn't expose Job as
      // a structured field — instead it lives inside the Reference string
      // (e.g. "Job No. 1005 - Robison Residence — ..."). Parse that too.
      let poJobId =
        d?.Job?.ID ?? d?.Job?.Id ?? d?.JobID ??
        d?.JobNo ?? d?.JobNumber ??
        d?.Project?.ID ?? d?.ProjectID ??
        d?.Reference?.Job?.ID ??
        (typeof d?.Job === "number" || typeof d?.Job === "string" ? d.Job : null);
      // Reference-string parse: "Job No. 1234 — Some Name" or "Job 1234"
      // → captures "1234". Word-boundary guard so 1005 doesn't match
      // "10054" or "21005".
      if (poJobId == null && typeof d?.Reference === "string") {
        const refMatch = d.Reference.match(/Job\s*(?:No\.?|Number|#)?\s*(\d+)/i);
        if (refMatch) poJobId = refMatch[1];
      }
      if (poJobId != null && String(poJobId) !== String(simproJobNo)) {
        return null; // wrong job — drop it
      }
      // Defensive — Simpro v1 PO fields vary by tenant. Pull from any of
      // the field shapes we've seen. Supplier may be `Vendor` or `Supplier`,
      // status may be `Status.Name` or `Stage`.
      const supplierName =
        d?.Vendor?.CompanyName || d?.Vendor?.Name ||
        d?.Supplier?.CompanyName || d?.Supplier?.Name ||
        (typeof d?.Vendor === "string" ? d.Vendor : "") ||
        (typeof d?.Supplier === "string" ? d.Supplier : "") || "";
      const status =
        d?.Status?.Name || d?.Stage ||
        (typeof d?.Status === "string" ? d.Status : "") || "";
      // For Simpro vendor orders, the visible "PO number" is the internal
      // ID itself — most tenants display it as PO-{ID} in the UI. So use
      // the ID-based formatted number when no explicit OrderNo field is
      // populated. Format as PO-{ID} for consistency with how Simpro
      // typically renders it.
      const explicitPoNo = d?.OrderNo || d?.PONumber || d?.Number || d?.PoNo || "";
      const poNumber = String(explicitPoNo || `PO-${id}`).trim();
      const dateIssued = d?.DateIssued || d?.IssuedDate || d?.Date || d?.CreatedAt || "";
      return {
        simproId: String(id),
        poNumber,
        supplierName: String(supplierName || ""),
        status: String(status || ""),
        dateIssued: String(dateIssued || ""),
        // Surfaced in the unmatched array so we can see what Job ID Simpro
        // associates with each PO — tells us if the post-filter is failing
        // because of a wrong field path.
        _detectedJobId: poJobId != null ? String(poJobId) : null,
        // Top-level keys of the detail response — helps spot where Job
        // info actually lives if the standard paths missed.
        _detailKeys: Object.keys(d || {}),
        // Keep the raw payload for diagnostics — only used by the first-PO logger.
        _rawSample: d,
      };
    });
    const enriched = await _pLimit(enrichTasks, 4);

    // Log the first PO's full shape so we can see exactly what Simpro
    // returned and tune our field reading. Only the first one — keeps logs
    // readable. Strip _rawSample from anything we ship back to the client.
    const firstRaw = simproPOs[0];
    const firstEnriched = enriched.find(Boolean);
    functions.logger.info("syncSimproPOs: first PO shape", {
      simproJobNo,
      totalListed: simproPOs.length,
      rawListKeys: firstRaw ? Object.keys(firstRaw) : null,
      enrichedSample: firstEnriched ? {
        simproId: firstEnriched.simproId,
        poNumber: firstEnriched.poNumber,
        supplierName: firstEnriched.supplierName,
        status: firstEnriched.status,
        dateIssued: firstEnriched.dateIssued,
        detailKeys: firstEnriched._rawSample ? Object.keys(firstEnriched._rawSample) : null,
      } : null,
    });

    // Drop the diagnostic _rawSample before downstream use. Keep
    // _detectedJobId and _detailKeys so the front-end can show them.
    const enrichedClean = enriched.filter(Boolean).map(p => {
      const { _rawSample, ...rest } = p; return rest;
    });

    // Date filter: skip Simpro POs older than the cutoff (default 30 days).
    // This is the main defense against auto-linking historical POs to
    // brand-new app material orders. Override-able via env var.
    // If a PO has no dateIssued at all, we let it through (rather than
    // silently dropping it) and rely on the supplier match as the gate.
    const DATE_CUTOFF_DAYS = Number(process.env.SIMPRO_PO_CUTOFF_DAYS || 30);
    const cutoffMs = Date.now() - DATE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
    const validPOs = enrichedClean.filter(p => {
      if (!p.poNumber) return false;
      if (p.dateIssued) {
        const t = Date.parse(p.dateIssued);
        if (Number.isFinite(t) && t < cutoffMs) return false;
      }
      return true;
    });

    // ── 3. Read the app's job document ──────────────────────────────────
    const db = admin.firestore();
    const jobRef = db.collection("jobs").doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      throw new functions.https.HttpsError("not-found", `Job ${jobId} not found in Firestore`);
    }
    const jobDoc = jobSnap.data() || {};
    // Memory says: each job doc has a `data` map. Defensive fallback to
    // top-level fields for jobs written under the older shape.
    const jobData = jobDoc.data || jobDoc;

    // ── 4. Normalize supplier names → app's Source dropdown values ──────
    // Simpro carries "Consolidated Electrical Distributors" etc. — map to
    // the dropdown values the app already supports.
    const normalizeSupplier = (name) => {
      const s = String(name || "").toLowerCase().trim();
      if (!s) return "";
      if (s.includes("ced") || s.includes("consolidated electrical")) return "CED";
      if (s.includes("codale")) return "Codale";
      if (s.includes("platt")) return "Platt";
      if (s.includes("home depot") || s.includes("hd supply")) return "Home Depot";
      if (s.includes("amazon")) return "Amazon";
      return "Other";
    };

    // ── 5. Match Simpro POs to app material orders + build update ───────
    const nowIso = new Date().toISOString();
    const todayDateStr = new Date().toLocaleDateString("en-US");
    const matched = []; // { phase, appOrderId, simproId, poNumber, supplier, status }
    const claimedSimproIds = new Set();

    const reconcilePhase = (orders) => {
      const arr = Array.isArray(orders) ? orders : [];
      let changed = false;
      const next = arr.map(o => {
        // Helper — strip the "PO-" / "po-" prefix so "PO-6131" and "6131"
        // compare equal. Fixes by-number matching when the app stored
        // just the number and Simpro returns the prefixed form.
        const stripPrefix = (s) => String(s||"").trim().toLowerCase().replace(/^po-/, "");

        // Already linked to a Simpro PO via simproPoId — refresh everything
        // we can pull from Simpro, fill in any display fields the order is
        // missing (po, date, simproSupplier), and count as matched.
        //
        // CRITICAL: if simproPoId is set but doesn't correspond to any
        // Simpro PO in the current response (stale from a previous buggy
        // sync, or the PO was deleted in Simpro, or it's outside the
        // 30-day window) we MUST fall through to re-match by number or
        // source — otherwise the order stays "stuck" bound to nothing
        // forever. Don't early-return when same isn't found.
        if (o.simproPoId) {
          const same = validPOs.find(p => String(p.simproId) === String(o.simproPoId));
          // CRITICAL: if another order already claimed this same Simpro PO
          // earlier in the loop, this order's stored simproPoId is a
          // duplicate from a buggy previous sync. Treat it as stale —
          // clear and fall through to re-match. Two app orders can't
          // share one Simpro PO; first one wins, the second re-binds.
          if (same && !claimedSimproIds.has(same.simproId)) {
            claimedSimproIds.add(same.simproId);
            matched.push({
              phase: "_alreadyBound", appOrderId: o.id, simproId: same.simproId,
              poNumber: same.poNumber, supplier: same.supplierName, status: same.status,
            });
            // Fill display fields if currently empty. Previous syncs only
            // refreshed status, leaving po / date blank for orders that
            // bound during a buggy earlier run — this catches them up.
            const formatForApp = (raw) => {
              if (!raw) return "";
              const t = Date.parse(raw);
              if (!Number.isFinite(t)) return "";
              return new Date(t).toLocaleDateString("en-US");
            };
            // ALWAYS overwrite po + date when bound to a Simpro PO. Simpro
            // is the source of truth — whatever a user typed in those
            // fields takes a back seat to the actual Simpro values. The
            // earlier conditional version was leaving "PO-001" placeholder
            // text in place because of edge cases in field value detection.
            const patch = {
              po: same.poNumber,
              simproStatus: same.status,
              simproSupplier: same.supplierName,
              simproDateIssued: same.dateIssued || "",
              simproSyncedAt: nowIso,
            };
            const formattedDate = formatForApp(same.dateIssued);
            if (formattedDate) patch.date = formattedDate;
            // Auto-flip status flags from Simpro status if not manually set.
            const sLower = same.status.toLowerCase();
            const isReceived = sLower.includes("receiv");
            const isSent = sLower.includes("approv") || sLower.includes("sent") || sLower.includes("issued");
            if (isSent && !o.ordered && !o.pickedUp && !o.deliveredToShop) {
              patch.ordered = true;
              patch.orderedBy = "Simpro sync";
              patch.orderedAt = formatForApp(same.dateIssued) || nowIso.slice(0,10);
            }
            if (isReceived && !o.pickedUp && !o.deliveredToShop) {
              patch.pickedUp = true;
              patch.pickedUpBy = "Simpro sync";
              patch.pickedUpAt = formatForApp(same.dateIssued) || nowIso.slice(0,10);
            }
            changed = true;
            return { ...o, ...patch };
          }
          // simproPoId set but no current Simpro PO matches — fall through
          // to re-match. Clear simproPoId so we don't keep this stale ref.
          o = { ...o, simproPoId: "" };
        }
        // Already has a manual po# — find which Simpro PO it refers to so
        // we can mirror status and other fields. Strip "PO-" prefix on
        // both sides so "6131" matches "PO-6131".
        //
        // If the typed po# doesn't match anything in Simpro (placeholder,
        // typo, or just got created and isn't synced yet), FALL THROUGH to
        // source-based matching instead of giving up. The user benefits
        // more from auto-fill than from a stuck garbage value. If their
        // typed po# was meaningful and a source match overwrites it, they
        // can always retype.
        if (o.po && String(o.po).trim()) {
          const byNumber = validPOs.find(p =>
            !claimedSimproIds.has(p.simproId) &&
            stripPrefix(p.poNumber) === stripPrefix(o.po)
          );
          if (byNumber) {
            claimedSimproIds.add(byNumber.simproId);
            matched.push({
              phase: "_byNumber", appOrderId: o.id, simproId: byNumber.simproId,
              poNumber: byNumber.poNumber, supplier: byNumber.supplierName, status: byNumber.status,
            });
            changed = true;
            return {
              ...o,
              simproPoId: byNumber.simproId,
              simproStatus: byNumber.status,
              simproSupplier: byNumber.supplierName,
              simproDateIssued: byNumber.dateIssued || "",
              simproSyncedAt: nowIso,
            };
          }
          // No match by number — fall through to source-based matching.
        }
        // No PO# yet → try to match by source.
        const appSource = o.source || "";
        if (!appSource || appSource === "Shop") return o;
        const candidate = validPOs.find(p =>
          !claimedSimproIds.has(p.simproId) &&
          normalizeSupplier(p.supplierName) === appSource
        );
        if (!candidate) return o;
        claimedSimproIds.add(candidate.simproId);
        matched.push({
          phase: "_bySource", appOrderId: o.id, simproId: candidate.simproId,
          poNumber: candidate.poNumber, supplier: candidate.supplierName, status: candidate.status,
        });
        changed = true;

        const simproStatusLower = candidate.status.toLowerCase();
        const isReceived = simproStatusLower.includes("receiv");
        const isSent = simproStatusLower.includes("approv") ||
                       simproStatusLower.includes("sent") ||
                       simproStatusLower.includes("issued");

        // Convert Simpro's date (ISO like "2026-05-13T12:48:00" or
        // already MM/DD/YYYY) into the MM/DD/YYYY format the app's
        // DateInp expects. Defensive — falls back to today's date if
        // Simpro's date is unparseable.
        const formatForApp = (raw) => {
          if (!raw) return todayDateStr;
          const t = Date.parse(raw);
          if (!Number.isFinite(t)) return todayDateStr;
          return new Date(t).toLocaleDateString("en-US");
        };
        const simproDateOrdered = formatForApp(candidate.dateIssued);

        return {
          ...o,
          po: candidate.poNumber,
          // Date Ordered — what the user sees in the UI. Only fill if
          // empty (don't overwrite a date they typed in themselves).
          ...(!(o.date && String(o.date).trim()) ? { date: simproDateOrdered } : {}),
          simproPoId: candidate.simproId,
          simproStatus: candidate.status,
          simproSupplier: candidate.supplierName,
          simproDateIssued: candidate.dateIssued || "",
          simproSyncedAt: nowIso,
          // Only auto-flip when the manual flag is unset — preserves any
          // manual override the field crew made earlier. orderedAt /
          // pickedUpAt use the Simpro issue date (when the supplier
          // actually got it) rather than the sync's run time.
          ...(isSent && !o.ordered && !o.pickedUp && !o.deliveredToShop
            ? { ordered: true, orderedBy: "Simpro sync", orderedAt: simproDateOrdered }
            : {}),
          ...(isReceived && !o.pickedUp && !o.deliveredToShop
            ? { pickedUp: true, pickedUpBy: "Simpro sync", pickedUpAt: simproDateOrdered }
            : {}),
        };
      });
      return { changed, next };
    };

    const roughResult = reconcilePhase(jobData?.roughMaterials);
    const finishResult = reconcilePhase(jobData?.finishMaterials);

    // ── 6. Write only if something actually changed ─────────────────────
    if (roughResult.changed || finishResult.changed) {
      const payload = {};
      if (roughResult.changed) payload["data.roughMaterials"] = roughResult.next;
      if (finishResult.changed) payload["data.finishMaterials"] = finishResult.next;
      payload["data.simproPOsLastSyncedAt"] = nowIso;
      await jobRef.update(payload);
    }

    return {
      ok: true,
      totalSimproPOs: validPOs.length,
      matchedCount: matched.length,
      matched,
      unmatched: validPOs
        .filter(p => !claimedSimproIds.has(p.simproId))
        .map(p => ({
          simproId: p.simproId,
          poNumber: p.poNumber,
          supplierName: p.supplierName,
          status: p.status,
          dateIssued: p.dateIssued,
          // Diagnostic — what Job ID did we detect for this PO, and which
          // top-level fields did the Simpro detail response contain?
          _detectedJobId: p._detectedJobId,
          _detailKeys: p._detailKeys,
        })),
      lastSyncedAt: nowIso,
      changed: (roughResult.changed || finishResult.changed),
    };
}


// ── Entrypoint 1: manual callable (button click in the app) ─────────────
// Same arguments as before, same response shape. Lets users force a
// refresh — useful right after they create a PO in Simpro and don't want
// to wait for the next scheduled run.
exports.syncSimproPOsForJob = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data) => {
    requireAppKey(data);
    const { simproJobNo, jobId } = data || {};
    if (!simproJobNo) {
      throw new functions.https.HttpsError("invalid-argument", "simproJobNo required");
    }
    if (!jobId) {
      throw new functions.https.HttpsError("invalid-argument", "jobId required");
    }
    return _syncSimproPOsForOneJob({ simproJobNo, jobId });
  });


// ── Entrypoint 2: scheduled background sync — PAUSED ──────────────────
// Pulled back because the supplier+date-based matching wasn't accurate
// enough to trust with field data (was binding wrong Simpro POs to app
// material orders). The cron is still registered with Firebase to avoid
// a re-deploy headache when we bring it back, but it returns immediately
// without touching Simpro or Firestore.
//
// To re-enable: delete the `return null;` line below and let the function
// run again. The matching helper (_syncSimproPOsForOneJob) is intact and
// will need refinement (likely item-overlap matching) before re-enabling.
exports.scheduledSimproPOSync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("*/5 * * * *")  // every 5 minutes
  .timeZone("America/Denver")
  .onRun(async () => {
    functions.logger.info("scheduledSimproPOSync: paused — feature disabled pending matching rework");
    return null;
    // eslint-disable-next-line no-unreachable
    const db = admin.firestore();
    const jobsSnap = await db.collection("jobs").get();

    // Pick jobs that need syncing. "Need syncing" = has Simpro# AND has at
    // least one material order without a simproPoId. Done jobs (status
    // Completed) get skipped to save API calls.
    const candidates = [];
    jobsSnap.forEach(doc => {
      const d = doc.data() || {};
      const job = d.data || d;
      const simproNo = String(job.simproNo || "").trim();
      if (!simproNo) return;
      const status = String(job.status || "").toLowerCase();
      if (status === "completed" || status === "archived" || job.archived) return;
      const rough = Array.isArray(job.roughMaterials) ? job.roughMaterials : [];
      const finish = Array.isArray(job.finishMaterials) ? job.finishMaterials : [];
      const all = [...rough, ...finish];
      // Has any order not yet linked to a Simpro PO?
      const hasPending = all.some(o => o && !o.simproPoId && o.source && o.source !== "Shop");
      if (!hasPending && all.length > 0) return;
      candidates.push({ jobId: doc.id, simproJobNo: simproNo, jobName: job.name || doc.id });
    });

    if (candidates.length === 0) {
      functions.logger.info("scheduledSimproPOSync: no candidate jobs", { totalJobs: jobsSnap.size });
      return null;
    }

    functions.logger.info("scheduledSimproPOSync: syncing", {
      candidates: candidates.length,
      jobs: candidates.map(c => `${c.simproJobNo} (${c.jobName})`),
    });

    // Concurrency cap of 3 — Simpro rate-limits at ~60 req/min per token,
    // and each per-job sync fires multiple GETs (list + per-PO detail).
    const results = await _pLimit(
      candidates.map(c => async () => {
        try {
          const r = await _syncSimproPOsForOneJob({ simproJobNo: c.simproJobNo, jobId: c.jobId });
          return { jobId: c.jobId, jobName: c.jobName, ok: r?.ok !== false, matched: r?.matchedCount || 0, total: r?.totalSimproPOs || 0, changed: !!r?.changed };
        } catch (e) {
          functions.logger.error("scheduledSimproPOSync: job sync failed", { jobId: c.jobId, error: e.message });
          return { jobId: c.jobId, jobName: c.jobName, ok: false, error: e.message };
        }
      }),
      3
    );

    const summary = {
      jobsScanned: candidates.length,
      jobsChanged: results.filter(r => r.changed).length,
      totalMatched: results.reduce((s, r) => s + (r.matched || 0), 0),
      failures: results.filter(r => !r.ok).length,
    };
    functions.logger.info("scheduledSimproPOSync: complete", summary);

    // Stash the run summary on a settings doc so we can surface it in the
    // app ("last auto-sync: 2 min ago · 4 jobs updated") if we want to.
    await db.doc("settings/simproSyncStatus").set({
      lastRunAt: new Date().toISOString(),
      ...summary,
    }, { merge: true });

    return null;
  });

// ─── Auto-approve COs from Simpro quote stage ─────────────────────────────────
// Watches Simpro project quotes (entered as the Quote # on each CO) and flips
// the CO's status in the APP to approved/denied. Read-only against Simpro —
// never writes a single byte back to Simpro.
//
// Authoritative signal is the quote's **Status.Name** (the colored status label
// in Simpro), NOT its Stage. Stage flips to "Approved" early in the quote
// lifecycle and is NOT customer approval — trusting it mass-approved every CO
// on 2026-06-09. Status.Name is the human-meaningful workflow label and is the
// reliable signal on this tenant (confirmed by Koy 2026-06-09):
//
//   Status.Name "Quote - Convert to Job"        → CO "approved" (customer accepted)
//   Status.Name "Quote - Archive Quote"         → CO "denied"   (customer declined / killed)
//   Status.Name "Quote: Sent, Pending Response" → CO "pending"  (sent, awaiting; auto-marks sent if still needs_sending)
//   anything else / unknown                     → no-op + logged so we can learn new labels
//
// SAFETY — why this can't wrongly kill a live CO:
//   • Only COs currently "needs_sending" or "pending" are eligible. Once a CO
//     is approved/scheduled/completed/converted/denied, the sync ignores it
//     forever.
//   • "approved"/"denied" only fire on the explicit accept/archive label — not
//     on a vague stage — so a sent-but-unanswered quote stays pending.
//   • Writes go through a per-job Firestore transaction that re-reads the live
//     doc and only rewrites data.changeOrders, matching COs by id. Concurrent
//     field edits to other COs (or other job fields) are preserved.
//   • Each flip is stamped (coStatusSource:"simpro" + label + timestamp) so the
//     origin of every auto-change is auditable and reversible.
const SIMPRO_STATUS_TO_CO = (statusName) => {
  const s = String(statusName || "").trim().toLowerCase();
  if (s === "quote - convert to job")        return "approved";
  if (s === "quote - archive quote")         return "denied";
  if (s === "quote: sent, pending response") return "pending";
  return null; // any other label → leave the CO alone
};
const CO_ELIGIBLE_FOR_SIMPRO_FLIP = (coStatus) => {
  const cur = String(coStatus || "needs_sending");
  return cur === "needs_sending" || cur === "pending";
};

exports.scheduledSimproCoStatusSync = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 * * * *") // top of every hour
  .timeZone("America/Denver")
  .onRun(async () => {
    const db = admin.firestore();
    const nowIso = new Date().toISOString();

    // KILL SWITCH — DISABLED 2026-06-09. Simpro quote "Stage" is NOT a reliable
    // customer-approval signal on this tenant: Stage reads "Approved" early in the
    // quote lifecycle, so this auto-approved nearly every eligible CO. Off by
    // default; the function stays deployed (no-op) so its schedule + history
    // remain. To re-enable once a trustworthy signal exists, set
    // settings/simproCoSyncStatus.enabled = true.
    const cfgSnap = await db.doc("settings/simproCoSyncStatus").get().catch(() => null);
    const enabled = !!(cfgSnap && cfgSnap.exists && cfgSnap.data() && cfgSnap.data().enabled === true);
    if (!enabled) {
      functions.logger.warn("scheduledSimproCoStatusSync: DISABLED (Stage signal unreliable) — no-op until settings/simproCoSyncStatus.enabled=true");
      await db.doc("settings/simproCoSyncStatus").set(
        { lastRunAt: nowIso, disabled: true, flipped: 0 },
        { merge: true }
      ).catch(() => {});
      return null;
    }

    const jobsSnap = await db.collection("jobs").get();

    // 1. Collect every eligible CO that carries a quote #. Shape per item:
    //    { jobId, coId, quoteNo, currentStatus }
    const targets = [];
    const quoteNos = new Set();
    jobsSnap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      const job = d.data || d;
      if (job.archived) return; // skip archived jobs
      const cos = Array.isArray(job.changeOrders) ? job.changeOrders : [];
      cos.forEach((co) => {
        if (!co || typeof co !== "object") return;
        const quoteNo = String(co.quoteNumber || "").trim();
        if (!quoteNo) return;
        if (!CO_ELIGIBLE_FOR_SIMPRO_FLIP(co.coStatus)) return;
        targets.push({
          jobId: docSnap.id,
          coId: co.id,
          quoteNo,
          currentStatus: co.coStatus || "needs_sending",
        });
        quoteNos.add(quoteNo);
      });
    });

    if (targets.length === 0) {
      functions.logger.info("scheduledSimproCoStatusSync: no eligible COs", {
        totalJobs: jobsSnap.size,
      });
      await db.doc("settings/simproCoSyncStatus").set(
        { lastRunAt: nowIso, eligibleCOs: 0, quotesChecked: 0, flipped: 0 },
        { merge: true }
      );
      return null;
    }

    // 2. Fetch each unique quote's Stage once (dedupe → fewer Simpro calls).
    //    Concurrency cap 3 — Simpro rate-limits ~60 req/min per token.
    const uniqueNos = Array.from(quoteNos);
    const stageByQuote = {}; // quoteNo → { stage, statusName, ok }
    const lookups = await _pLimit(
      uniqueNos.map((qn) => async () => {
        const r = await simproReqWithRetry(
          "GET",
          `/quotes/${encodeURIComponent(qn)}`
        );
        if (r.ok && r.data && typeof r.data === "object") {
          return {
            qn,
            stage: r.data.Stage ?? null,
            statusName: (r.data.Status && r.data.Status.Name) || null,
            ok: true,
          };
        }
        return { qn, stage: null, statusName: null, ok: false, status: r.status };
      }),
      3
    );
    lookups.forEach((l) => {
      if (l && l.qn) stageByQuote[l.qn] = l;
    });

    // 3. Decide the flip for each eligible CO. Group changes by job.
    const changesByJob = {}; // jobId → [{ coId, newStatus, stage }]
    const unknownStages = []; // for logging — stages we didn't recognize
    const lookupFailures = [];
    targets.forEach((t) => {
      const info = stageByQuote[t.quoteNo];
      if (!info || !info.ok) {
        lookupFailures.push({ quoteNo: t.quoteNo, jobId: t.jobId });
        return;
      }
      const mapped = SIMPRO_STATUS_TO_CO(info.statusName);
      if (mapped === null) {
        // Unrecognized status label — log so we can learn/extend the mapping.
        unknownStages.push({ quoteNo: t.quoteNo, statusName: info.statusName, stage: info.stage });
        return;
      }
      if (mapped === t.currentStatus) return; // already there — no write
      (changesByJob[t.jobId] = changesByJob[t.jobId] || []).push({
        coId: t.coId,
        newStatus: mapped,
        statusLabel: info.statusName,
      });
    });

    // 4. Apply per job inside a transaction (re-reads live doc, preserves
    //    concurrent edits, rewrites only data.changeOrders).
    const jobIds = Object.keys(changesByJob);
    let flipped = 0;
    const flips = [];
    for (const jobId of jobIds) {
      const wanted = changesByJob[jobId];
      const ref = db.collection("jobs").doc(jobId);
      try {
        const applied = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return [];
          const d = snap.data() || {};
          const job = d.data || {};
          const cos = Array.isArray(job.changeOrders) ? job.changeOrders : [];
          const localFlips = [];
          const nextCOs = cos.map((co) => {
            if (!co || typeof co !== "object") return co;
            const want = wanted.find((w) => w.coId === co.id);
            if (!want) return co;
            // Re-check eligibility on the LIVE doc — a human may have already
            // flipped it since we scanned. Never override a non-eligible CO.
            if (!CO_ELIGIBLE_FOR_SIMPRO_FLIP(co.coStatus)) return co;
            if ((co.coStatus || "needs_sending") === want.newStatus) return co;
            localFlips.push({
              coId: co.id,
              from: co.coStatus || "needs_sending",
              to: want.newStatus,
              statusLabel: want.statusLabel,
            });
            return {
              ...co,
              coStatus: want.newStatus,
              coStatusSource: "simpro",
              coStatusSyncedStatus: want.statusLabel,
              coStatusSyncedAt: nowIso,
            };
          });
          if (localFlips.length === 0) return [];
          tx.update(ref, { "data.changeOrders": nextCOs });
          return localFlips;
        });
        if (applied.length) {
          flipped += applied.length;
          flips.push({ jobId, changes: applied });
        }
      } catch (e) {
        functions.logger.error("scheduledSimproCoStatusSync: job txn failed", {
          jobId,
          error: e.message,
        });
      }
    }

    const summary = {
      lastRunAt: nowIso,
      eligibleCOs: targets.length,
      quotesChecked: uniqueNos.length,
      flipped,
      approvedFlips: flips.reduce(
        (s, f) => s + f.changes.filter((c) => c.to === "approved").length,
        0
      ),
      deniedFlips: flips.reduce(
        (s, f) => s + f.changes.filter((c) => c.to === "denied").length,
        0
      ),
      lookupFailures: lookupFailures.length,
      unknownStages,
    };
    functions.logger.info("scheduledSimproCoStatusSync: complete", {
      ...summary,
      flips,
    });
    await db.doc("settings/simproCoSyncStatus").set(summary, { merge: true });
    return null;
  });

// ─────────────────────────────────────────────────────────────
// SCHEDULED — Notification inbox prune (Sundays 3am MT)
// Deletes inbox items older than 30 days so the notifications
// collection can't grow unbounded. Iterates the team list and
// queries each user's items subcollection directly (collection-
// scope query — no collection-group index needed). ADDITIVE:
// new export only; touches nothing but old inbox docs.
// ─────────────────────────────────────────────────────────────
exports.notifInboxPrune = functions.pubsub
  .schedule("0 3 * * 0")
  .timeZone(TZ)
  .onRun(async () => {
    const users = await getUsers();
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    let deleted = 0;
    for (const u of users) {
      const key = inboxKeyOf(u);
      if (!key) continue;
      const snap = await db.collection("notifications").doc(key).collection("items")
        .where("createdAt", "<", cutoff).limit(400).get();
      if (snap.empty) continue;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
    functions.logger.info("[notifInboxPrune] ran", { deleted });
    return null;
  });


// ─────────────────────────────────────────────────────────────
// NIGHTLY FIRESTORE BACKUP — Cougar Moon insurance (2026-07-06)
// The punch-list data loss was unrecoverable because there was no
// server-side history. This snapshots every user-generated collection
// to Cloud Storage every night at 1:00 AM MT, gzipped, keeping 30
// days. READ-ONLY on Firestore data collections — the only Firestore
// write is a small status stamp to settings/backupStatus so the app
// (and Koy) can see the last successful run.
//
// Restore path: download backups/firestore-YYYY-MM-DD.json.gz from the
// Firebase console → Storage, gunzip, then restore jobs via the in-app
// "restore from file" tool or __HE_RESTORE in the DevTools console.
// ─────────────────────────────────────────────────────────────
const BACKUP_COLLECTIONS = ["jobs","settings","manualTasks","needs","quoteWalks","suggestions","homeowner_requests"];
const BACKUP_KEEP_DAYS = 30;

async function _runFirestoreBackup(trigger) {
  const zlib = require("zlib");
  const bucket = admin.storage().bucket();
  const startedAt = new Date();
  const stamp = startedAt.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  const out = { createdAt: startedAt.toISOString(), trigger: trigger || "scheduled", collections: {} };
  let docCount = 0;
  for (const coll of BACKUP_COLLECTIONS) {
    const snap = await db.collection(coll).get();
    const docsOut = {};
    snap.forEach(d => { docsOut[d.id] = d.data(); docCount++; });
    out.collections[coll] = docsOut;
  }
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)));
  const path = `backups/firestore-${stamp}.json.gz`;
  await bucket.file(path).save(gz, { contentType: "application/gzip", resumable: false });
  // Prune anything older than BACKUP_KEEP_DAYS.
  const [files] = await bucket.getFiles({ prefix: "backups/firestore-" });
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const f of files) {
    const created = new Date(f.metadata.timeCreated).getTime();
    if (created < cutoff) { try { await f.delete(); pruned++; } catch(e) { functions.logger.warn("[backup] prune failed", f.name, e.message); } }
  }
  const status = { lastRunAt: new Date().toISOString(), ok: true, file: path, docCount, bytes: gz.length, pruned, trigger: trigger || "scheduled" };
  await db.doc("settings/backupStatus").set(status);
  functions.logger.info("[nightlyFirestoreBackup] done", status);
  return status;
}

exports.nightlyFirestoreBackup = functions
  .runWith({ memory: "1GB", timeoutSeconds: 540 })
  .pubsub.schedule("0 1 * * *")
  .timeZone(TZ)
  .onRun(async () => {
    try { return await _runFirestoreBackup("scheduled"); }
    catch (e) {
      functions.logger.error("[nightlyFirestoreBackup] FAILED", e.message);
      try { await db.doc("settings/backupStatus").set({ lastRunAt: new Date().toISOString(), ok: false, error: e.message }); } catch(_){}
      // Push Koy — a 1am failure is otherwise silent until someone opens the
      // app and sees the backup banner. Scheduled runs only; runBackupNow is
      // a human-triggered callable whose rejection surfaces in the UI that
      // called it. sendToName/deliver swallow their own errors, so this can
      // neither mask nor amplify the original failure — throw e still runs.
      await sendToName("Koy", {
        title: "⚠️ Nightly Backup Failed",
        body:  `Firestore backup didn't complete: ${String(e.message||e).slice(0, 120)}`,
      });
      throw e;
    }
  });

// Manual trigger so Koy can run + verify a backup immediately after deploy.
exports.runBackupNow = functions
  .runWith({ memory: "1GB", timeoutSeconds: 540 })
  .https.onCall(async (data) => {
    requireAppKey(data);
    return await _runFirestoreBackup("manual");
  });

// ── Recovery-ledger prune — daily 1:15am MT ──────────────────────────────
// Deletes ledger entries past LEDGER_TTL_DAYS so `recovery_ledger` stays
// bounded without needing a Firestore TTL policy configured in the console
// (an `expireAt` field IS written on every entry, so a native TTL policy can
// be layered on later for belt-and-suspenders). Stamps settings/backupStatus
// so the same admin banner that watches the nightly backup can also confirm
// the ledger is being maintained — observability, per the "written != running"
// lesson from the nightly-backup-never-deployed incident.
exports.pruneRecoveryLedger = functions
  .runWith({ memory: "512MB", timeoutSeconds: 300 })
  .pubsub.schedule("15 1 * * *")
  .timeZone(TZ)
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    let removed = 0;
    try {
      // Delete in batches of 400 (Firestore batch limit is 500).
      for (let guard = 0; guard < 100; guard++) {
        const snap = await db.collection("recovery_ledger")
          .where("expireAt", "<", now).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        removed += snap.size;
        if (snap.size < 400) break;
      }
      await db.doc("settings/backupStatus").set({
        ledgerPrunedAt: new Date().toISOString(),
        ledgerPrunedCount: removed,
        ledgerOk: true,
      }, { merge: true });
      functions.logger.info("[pruneRecoveryLedger] done", { removed });
    } catch (e) {
      functions.logger.error("[pruneRecoveryLedger] FAILED", e.message);
      try {
        await db.doc("settings/backupStatus").set({
          ledgerPrunedAt: new Date().toISOString(), ledgerOk: false, ledgerError: e.message,
        }, { merge: true });
      } catch (_) {}
    }
    return null;
  });

// ─────────────────────────────────────────────────────────────
// TECH LIGHTING WEEKLY DIGEST — Monday 6:45am MT
// One push to Koy summarizing every on-link Lutron job's plan-changes
// state: how many logged room items Tech Lighting hasn't marked
// "incorporated" (homeowner_requests/{jobId}.planChangeAcks[itemId]
// .ackedAt) and how many discussion threads sit on a question from them
// with no crew reply (last message role==="client"). Mirrors the exact
// predicates LutronAdditionsView / LightingHubPage compute client-side in
// src/App.js — a scheduled rollup, nothing new decided here. Read-only:
// two collection reads + one push (deliver() writes only the notification
// inbox doc, like every other Koy-targeted nudge). Clean week = no push;
// note a read failure also produces silence (logged only — accepted).
// ─────────────────────────────────────────────────────────────
exports.techLightingWeeklyDigest = functions.pubsub
  .schedule("45 6 * * 1")
  .timeZone(TZ)
  .onRun(async () => {
    try {
      const [jobsSnap, hrSnap] = await Promise.all([
        db.collection("jobs").get(),
        db.collection("homeowner_requests").get(),
      ]);

      // homeowner_requests docs are NOT wrapped in `.data` — unlike jobs.
      const ackMap = {}, threadMap = {};
      hrSnap.forEach(d => {
        const data = d.data() || {};
        if (data.planChangeAcks)    ackMap[d.id]    = data.planChangeAcks;
        if (data.planChangeThreads) threadMap[d.id] = data.planChangeThreads;
      });

      let unincorporated  = 0; // items logged, not yet ackedAt
      let awaitingReply   = 0; // threads whose last message is from the client
      let jobsOutstanding = 0; // jobs with >=1 of either

      jobsSnap.forEach(d => {
        const j = d.data()?.data || {}; // jobs ARE wrapped
        if (j.lightingSystem !== "Lutron") return;
        if (j.panelizedLighting?.excludeFromLutronHub) return;

        const items   = (j.panelizedLighting?.lutronRooms || []).flatMap(r => r.items || []);
        const acks    = ackMap[d.id] || {};
        const threads = threadMap[d.id] || {};

        const jobUnincorporated = items.filter(it => !acks[it.id]?.ackedAt).length;

        const threadIds = [...items.map(it => it.id), "_general"];
        const jobAwaiting = threadIds.filter(id => {
          const msgs = threads[id];
          return msgs && msgs.length && msgs[msgs.length - 1].role === "client";
        }).length;

        unincorporated += jobUnincorporated;
        awaitingReply  += jobAwaiting;
        if (jobUnincorporated > 0 || jobAwaiting > 0) jobsOutstanding++;
      });

      if (unincorporated === 0 && awaitingReply === 0) {
        functions.logger.info("[techLightingWeeklyDigest] clean — no push");
        return null;
      }

      await sendToName("Koy", {
        title: "Tech Lighting weekly",
        body: `${unincorporated} change${unincorporated===1?"":"s"} not incorporated across ${jobsOutstanding} job${jobsOutstanding===1?"":"s"} · ${awaitingReply} question${awaitingReply===1?"":"s"} awaiting a crew reply`,
      });

      functions.logger.info("[techLightingWeeklyDigest] ran", { unincorporated, awaitingReply, jobsOutstanding });
      return null;
    } catch (e) {
      functions.logger.error("[techLightingWeeklyDigest] FAILED", e.message);
      return null;
    }
  });


// ─── GC PORTAL: link management + backfill (08-Specs/GC Portal Link Spec.md) ──
// gc_links is client-write-DENIED in firestore.rules (the token is the secret;
// an outsider holding one must not be able to alter exposure), so the office
// app manages links through these callables (admin SDK bypasses rules). All
// gated by requireAppKey like the other sensitive callables.

// Commit an array of {ref, op:'set'|'delete', data?} in <=450-op chunks so a GC
// with a large number of jobs can never exceed Firestore's 500-op batch cap.
async function gcPortalCommitChunked(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = db.batch();
    ops.slice(i, i + 450).forEach((o) => {
      if (o.op === "delete") batch.delete(o.ref);
      else batch.set(o.ref, o.data, o.merge ? { merge: true } : undefined);
    });
    await batch.commit();
  }
}

// GC-LEVEL membership (Piece 3 review fix — HIGH): all active links for a GC
// share ONE mirror (portalId), so include/exclude MUST be GC-level, not
// per-link — otherwise a second link that doesn't repeat an exclude would
// re-expose a job the first link hid. Compute the UNION of every active link's
// include/exclude so membership is identical no matter which link triggers a
// rebuild or the live publisher. Exclude still wins (jobBelongsToLink). Returns
// null if the GC has no active link (→ no mirror).
async function gcPortalGcMembership(gcKey) {
  if (!gcKey) return null;
  // ALL links for this GC (revoked included) — excludes are sticky (below).
  const ls = await db.collection("gc_links").where("gcKey", "==", gcKey).get();
  if (ls.empty) return null;
  const inc = new Set(), exc = new Set();
  let portalId = null;
  ls.docs.forEach((d) => {
    const l = d.data();
    // Excludes are a STICKY GC-level privacy decision: honor them even from a
    // REVOKED link, so revoking one link can never silently un-hide a job that
    // a sibling link still shows on the shared mirror.
    (Array.isArray(l.jobIdsExclude) ? l.jobIdsExclude : []).forEach((x) => exc.add(x));
    if (l.revoked === true) return;
    // portalId + force-includes come from ACTIVE links only.
    if (!portalId) portalId = l.portalId;
    (Array.isArray(l.jobIdsInclude) ? l.jobIdsInclude : []).forEach((x) => inc.add(x));
  });
  if (!portalId) return null; // no active link → no mirror (matches teardown)
  return { gcKey, portalId, jobIdsInclude: [...inc], jobIdsExclude: [...exc] };
}

// Rebuild a GC's whole mirror: full jobs scan → project members → write
// subdocs → delete stale ones. Uses GC-LEVEL union membership so the shared
// mirror is consistent regardless of which link triggered the rebuild.
async function gcPortalRebuildMirror(link) {
  // Resolve GC-level membership (union across all active links); fall back to
  // the passed link if the query somehow returns nothing (e.g. mid-create race).
  const m = (await gcPortalGcMembership(link.gcKey)) || link;
  const portalId = m.portalId || link.portalId;
  const all = await db.collection("jobs").get();
  const wanted = {};
  all.docs.forEach((d) => {
    const job = (d.data() || {}).data;
    if (!job || !gcPortal.jobBelongsToLink(d.id, job, m)) return;
    const view = gcPortal.projectJobForPortal(d.id, job);
    if (view) wanted[d.id] = view;
  });
  const pref = db.collection("gc_portal").doc(portalId);
  const existing = await pref.collection("jobs").get();
  const ops = [];
  existing.docs.forEach((d) => { if (!wanted[d.id]) ops.push({ ref: d.ref, op: "delete" }); });
  Object.keys(wanted).forEach((id) => ops.push({ ref: pref.collection("jobs").doc(id), op: "set", data: wanted[id] }));
  await gcPortalCommitChunked(ops);
  await pref.set({ gcKey: m.gcKey || link.gcKey, updatedAt: new Date().toISOString() }, { merge: true });
  return Object.keys(wanted).length;
}

// Shared contact normalizer (office create + GC self-service via the portal).
// emailAddr is where the daily digest / instant alerts go; email/text are the
// per-contact channel toggles (Piece 5). Validates the address so a typo can't
// become a bounce loop; keeps only fields we control.
const GC_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function normalizeGcContacts(arr) {
  const clip = (s, n) => gcPortal.stripHtml(String(s == null ? "" : s)).slice(0, n);
  return (Array.isArray(arr) ? arr : []).slice(0, 20).map((c) => {
    const addr = clip(c && c.emailAddr, 120).trim();
    return {
      name: clip(c && c.name, 60),
      role: clip(c && c.role, 40),
      emailAddr: GC_EMAIL_RE.test(addr) ? addr : "",
      phone: clip(c && c.phone, 30),
      email: !(c && c.email === false),
      text: !(c && c.text === false),
    };
  });
}

exports.gcPortalCreateLink = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const label = String(data.label || "").trim();
  const gcRaw = String(data.gc || "").trim();
  const gcKey = gcPortal.gcKeyOf(gcRaw);
  if (!label || !gcKey) {
    throw new functions.https.HttpsError("invalid-argument", "label and gc are required");
  }
  // one mirror per GC: reuse the portalId of any existing active link
  const prior = await db.collection("gc_links")
    .where("gcKey", "==", gcKey).where("revoked", "==", false).limit(1).get();
  const portalId = prior.empty ? gcPortal.makeToken() : (prior.docs[0].data().portalId || gcPortal.makeToken());
  const token = gcPortal.makeToken();
  const slug = gcPortal.makeSlug(label);
  const cleanIds = (a) => Array.isArray(a) ? a.map(String).filter(Boolean).slice(0, 500) : [];
  const doc = {
    token, slug, label, gc: gcRaw, gcKey, portalId,
    contacts: normalizeGcContacts(data.contacts),
    accentColor: typeof data.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(data.accentColor) ? data.accentColor : "",
    logoUrl: gcPortal.cleanLogoUrl(data.logoUrl),
    supersByJob: {},
    jobIdsInclude: cleanIds(data.jobIdsInclude), jobIdsExclude: cleanIds(data.jobIdsExclude),
    revoked: false,
    createdAt: new Date().toISOString(),
    createdBy: String(data.by || ""),
  };
  await db.collection("gc_links").doc(token).set(doc);
  const jobCount = await gcPortalRebuildMirror(doc);
  functions.logger.info("[gcPortal] link created", { gcKey, slug, jobCount });
  return { token, slug, portalId, jobCount };
});

exports.gcPortalSetRevoked = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const token = String(data.token || "");
  const ref = db.collection("gc_links").doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "no such link");
  const { gcKey, portalId } = snap.data();
  const revoking = data.revoked === true;
  await ref.update({ revoked: revoking, revokedAt: new Date().toISOString() });
  if (revoking) {
    // Revocation MUST cut off mirror access. The mirror is gated only by its
    // portalId, and a revoked holder's browser already saw that portalId (it
    // subscribed to gc_portal/{portalId}/jobs). So on ANY revoke we retire the
    // OLD portalId — either tear the mirror down (last link) or ROTATE it to a
    // fresh id the ex-holder never saw (siblings remain). Never leave the old
    // mirror readable. (Review finding: teardown-only-on-last-revoke leaked.)
    const remaining = await db.collection("gc_links")
      .where("gcKey", "==", gcKey).where("revoked", "==", false).get();
    const dropOldMirror = async () => {
      if (!portalId) return;
      const jobs = await db.collection("gc_portal").doc(portalId).collection("jobs").get();
      await gcPortalCommitChunked(jobs.docs.map((d) => ({ ref: d.ref, op: "delete" })));
      await db.collection("gc_portal").doc(portalId).delete().catch(() => {});
    };
    if (remaining.empty) {
      await dropOldMirror();
      functions.logger.info("[gcPortal] last link revoked — mirror deleted", { gcKey });
    } else if (portalId) {
      // Rotate: mint a new portalId, move every remaining active link onto it,
      // rebuild the mirror there, then delete the old (now-orphaned) mirror the
      // revoked holder could still read.
      const newPortalId = gcPortal.makeToken();
      const batch = db.batch();
      remaining.docs.forEach((d) => batch.update(d.ref, { portalId: newPortalId }));
      await batch.commit();
      await gcPortalRebuildMirror({ gcKey, portalId: newPortalId });
      await dropOldMirror();
      functions.logger.info("[gcPortal] link revoked — mirror rotated", { gcKey, links: remaining.size });
    }
  } else {
    // Un-revoke → reconcile onto the GC's CURRENT canonical mirror before
    // rebuilding. If another active link already exists for this GC, adopt its
    // portalId so we don't strand a divergent second mirror. Otherwise mint a
    // FRESH portalId — NEVER reuse this link's stored portalId (review finding:
    // after a prior rotation it points at a RETIRED mirror a revoked holder may
    // have memorized; resurrecting it would re-grant them access).
    let targetPortalId = gcPortal.makeToken();
    // Any other active link works — createLink keeps them on one shared
    // portalId; no orderBy (would force a composite index on two equalities).
    const active = await db.collection("gc_links")
      .where("gcKey", "==", gcKey).where("revoked", "==", false).limit(2).get();
    const other = active.docs.find((d) => d.id !== token);
    if (other && other.data().portalId) {
      targetPortalId = other.data().portalId;
    }
    await ref.update({ portalId: targetPortalId });
    await gcPortalRebuildMirror({ ...snap.data(), portalId: targetPortalId, revoked: false });
  }
  return { ok: true };
});

// Clean the mirror when a job is HARD-deleted (onJobUpdate never fires on
// delete, so without this the subdoc would orphan). Resolves the job's GC →
// active link → portalId and drops the subdoc. Fire-and-forget.
exports.gcPortalOnJobDelete = functions.firestore
  .document("jobs/{jobId}")
  .onDelete(async (snap, ctx) => {
    try {
      const job = (snap.data() || {}).data;
      const gcKey = gcPortal.gcKeyOf(job && job.gc);
      if (!gcKey) return null;
      const ls = await db.collection("gc_links")
        .where("gcKey", "==", gcKey).where("revoked", "==", false).limit(1).get();
      if (ls.empty) return null;
      const pid = ls.docs[0].data().portalId;
      if (pid) {
        await db.collection("gc_portal").doc(pid).collection("jobs").doc(ctx.params.jobId).delete().catch(() => {});
      }
    } catch (e) {
      functions.logger.warn("[gcPortal] job-delete cleanup error (non-fatal)", e.message);
    }
    return null;
  });

// Update office-managed link fields (contacts, accent, label). Explicit field
// allowlist — never a blind merge of caller data onto the link doc.
exports.gcPortalUpdateLink = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const token = String(data.token || "");
  const ref = db.collection("gc_links").doc(token);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "no such link");
  const patch = {};
  if (Array.isArray(data.contacts)) patch.contacts = data.contacts.slice(0, 20);
  if (typeof data.accentColor === "string" && (data.accentColor === "" || /^#[0-9a-fA-F]{6}$/.test(data.accentColor))) patch.accentColor = data.accentColor;
  if (typeof data.logoUrl === "string") patch.logoUrl = gcPortal.cleanLogoUrl(data.logoUrl);
  if (typeof data.label === "string" && data.label.trim()) patch.label = data.label.trim();
  if (data.supersByJob && typeof data.supersByJob === "object" && !Array.isArray(data.supersByJob)) patch.supersByJob = data.supersByJob;
  const cleanIds = (a) => a.map(String).filter(Boolean).slice(0, 500);
  let membershipChanged = false;
  if (Array.isArray(data.jobIdsInclude)) { patch.jobIdsInclude = cleanIds(data.jobIdsInclude); membershipChanged = true; }
  if (Array.isArray(data.jobIdsExclude)) { patch.jobIdsExclude = cleanIds(data.jobIdsExclude); membershipChanged = true; }
  if (!Object.keys(patch).length) return { ok: true, noop: true };
  patch.updatedAt = new Date().toISOString();
  await ref.update(patch);
  // membership change (include/exclude) → rebuild so the mirror reflects it now
  if (membershipChanged && snap.data().revoked !== true) {
    await gcPortalRebuildMirror({ ...snap.data(), ...patch });
  }
  return { ok: true };
});

exports.gcPortalBackfill = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const token = String(data.token || "");
  const snap = await db.collection("gc_links").doc(token).get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "no such link");
  const jobCount = await gcPortalRebuildMirror(snap.data());
  return { ok: true, jobCount };
});

// ─── GC PORTAL: two-way funnel (Piece 4) ────────────────────────────────────
// The GC portal calls gcPortalSubmit with their link TOKEN (the capability —
// NOT requireAppKey; the token is the auth). All GC-side writes route through
// here so no client ever writes gc_links, gc_portal, or gc_requests directly
// (rules deny all three). LINK self-service (assign super / contacts) applies
// immediately to the link doc; JOB-scoped actions (date/thread/punch/answer/
// file) file a gc_requests doc for the office to review — NEVER jobs/{id}.
exports.gcPortalSubmit = functions.https.onCall(async (data) => {
  const token = String(data.token || "");
  const linkSnap = await db.collection("gc_links").doc(token).get();
  if (!linkSnap.exists) throw new functions.https.HttpsError("permission-denied", "invalid link");
  const link = linkSnap.data();
  if (link.revoked === true) throw new functions.https.HttpsError("permission-denied", "link revoked");
  const type = String(data.type || "");
  const jobId = String(data.jobId || "");
  const clip = (s, n) => gcPortal.stripHtml(String(s == null ? "" : s)).slice(0, n || 2000);

  // LINK self-service — applied immediately (the GC owns their own team roster).
  if (type === "assign") {
    const supers = Array.isArray(data.supers) ? data.supers.map((s) => clip(s, 60)).filter(Boolean).slice(0, 6) : [];
    // jobId becomes a Firestore FIELD PATH key (supersByJob.<jobId>), so verify
    // it's a real job on THIS portal before writing — prevents arbitrary/oversized
    // keys bloating the link doc (review finding). Doc ids are short numeric strings.
    if (!jobId || jobId.length > 64) throw new functions.https.HttpsError("invalid-argument", "bad jobId");
    const onPortal = await db.collection("gc_portal").doc(link.portalId).collection("jobs").doc(jobId).get();
    if (!onPortal.exists) throw new functions.https.HttpsError("permission-denied", "job not on this portal");
    await linkSnap.ref.update({ ["supersByJob." + jobId]: supers, updatedAt: new Date().toISOString() });
    return { ok: true, applied: "assign" };
  }
  if (type === "contact") {
    await linkSnap.ref.update({ contacts: normalizeGcContacts(data.contacts), updatedAt: new Date().toISOString() });
    return { ok: true, applied: "contact" };
  }

  // JOB-scoped → gc_requests office queue. Verify the job is actually on THIS
  // portal (can't file requests against jobs they can't see).
  const ALLOWED = ["date", "thread", "punch", "answer", "file", "rsvp"];
  if (ALLOWED.indexOf(type) === -1) throw new functions.https.HttpsError("invalid-argument", "bad type");
  const mirrorJob = await db.collection("gc_portal").doc(link.portalId).collection("jobs").doc(jobId).get();
  if (!mirrorJob.exists) throw new functions.https.HttpsError("permission-denied", "job not on this portal");
  const fileUrl = (typeof data.fileUrl === "string" && /^https:\/\//.test(data.fileUrl)) ? data.fileUrl.slice(0, 500) : "";
  const req = {
    token, portalId: link.portalId, gcKey: link.gcKey, gcLabel: clip(link.label, 80),
    type, jobId, jobName: clip((mirrorJob.data() || {}).name, 80),
    by: clip(data.by, 60),
    text: clip(data.text, 4000),
    date: clip(data.date, 40),
    dateKind: clip(data.dateKind, 20),   // suggest | needs-by | confirm
    itemId: clip(data.itemId, 60),        // question id / rt id / thread anchor
    fileName: clip(data.fileName, 200),
    fileUrl,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  const ref = await db.collection("gc_requests").add(req);
  functions.logger.info("[gcPortal] request filed", { type, jobId, gcKey: link.gcKey });
  // Alert the office so a contractor request never sits unseen (push — Koy has
  // the app; the review inbox lives in Settings). Fire-and-forget, non-fatal.
  try {
    const verb = { date: "suggested a date", thread: "sent a message", punch: "added an item",
      answer: "answered a question", file: "shared a file", rsvp: "replied" }[type] || "sent a request";
    await sendToNameIfWanted("Koy", "gc_request", {
      title: "📥 " + (req.gcLabel || "Contractor") + " — portal request",
      body: verb + " on " + (req.jobName || "a job") + (req.by ? " (" + req.by + ")" : ""),
    });
  } catch (e) { functions.logger.warn("[gcPortal] office alert failed (non-fatal)", e.message); }
  return { ok: true, requestId: ref.id, filed: type };
});

// Office: list open GC requests (admin SDK — client list denied).
exports.gcPortalListRequests = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const includeHandled = data.includeHandled === true;
  let q = db.collection("gc_requests").orderBy("createdAt", "desc").limit(300);
  const snap = await q.get();
  const reqs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => includeHandled || r.status === "new");
  return { requests: reqs };
});

// Office: mark a request handled/dismissed (the actual apply-to-job happens
// client-side via the crew app's transactional merge, tagged fromGC).
exports.gcPortalHandleRequest = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const id = String(data.id || "");
  const status = ["applied", "dismissed", "new"].indexOf(String(data.status)) !== -1 ? data.status : "applied";
  const ref = db.collection("gc_requests").doc(id);
  if (!(await ref.get()).exists) throw new functions.https.HttpsError("not-found", "no such request");
  await ref.update({ status, handledBy: String(data.by || ""), handledAt: new Date().toISOString() });
  return { ok: true };
});

// Office link list. gc_links client-list is DENIED (token secrecy), so the
// office reads via this admin-SDK callable. Returns tokens — that's fine, the
// office app is trusted (requireAppKey); the secrecy invariant is about OUTSIDE
// clients, not Homestead's own management UI.
exports.gcPortalListLinks = functions.https.onCall(async (data) => {
  requireAppKey(data);
  const snap = await db.collection("gc_links").orderBy("createdAt", "desc").limit(300).get();
  return { links: snap.docs.map((d) => {
    const l = d.data();
    return {
      token: l.token, slug: l.slug, label: l.label, gc: l.gc, gcKey: l.gcKey, portalId: l.portalId,
      accentColor: l.accentColor || "", logoUrl: l.logoUrl || "", contacts: Array.isArray(l.contacts) ? l.contacts : [],
      supersByJob: (l.supersByJob && typeof l.supersByJob === "object") ? l.supersByJob : {},
      revoked: !!l.revoked, createdAt: l.createdAt || "", createdBy: l.createdBy || "",
    };
  }) };
});

// ─── GC PORTAL NOTIFICATION ENGINE (Piece 5, email v1) ───────────────────────
// Contractor-facing email: the 8 PM daily digest + INSTANT trigger alerts.
// DESIGN NOTES:
//  • Email send is fetch-based (SendGrid HTTP API) — no new npm dependency,
//    mirrors the existing Anthropic fetch integration.
//  • The provider key lives in a FUNCTION-ONLY Firestore doc gc_config/mail
//    (rules deny all client access), NOT runWith({secrets}) — so binding never
//    blocks the core onJobUpdate deploy, and the whole portal ships BEFORE email
//    is configured. sendGcMail FAILS SAFE (logs + returns false) when unset.
//  • The hot path (onJobUpdate) only ENQUEUES to gc_notify_queue; scheduled
//    drains do the actual sending, so a job save never waits on SendGrid and
//    never depends on email being configured.
//  • Texts are v1.5 (Twilio + A2P 10DLC lead time). v1 = email only; the 3
//    text-eligible triggers are already tagged in gcNotify.TEXT_ALLOWED.
let _gcMailCfg = null, _gcMailCfgAt = 0;
async function gcLoadMailConfig() {
  if (_gcMailCfg && (Date.now() - _gcMailCfgAt) < 300000) return _gcMailCfg;
  let cfg = {};
  try { const d = await db.collection("gc_config").doc("mail").get(); cfg = d.exists ? (d.data() || {}) : {}; } catch (e) {}
  _gcMailCfg = {
    key: cfg.key || "",
    from: cfg.from || "updates@homesteadelectric.net",
    origin: String(cfg.origin || "https://app.homesteadelectric.net").replace(/\/+$/, ""),
  };
  _gcMailCfgAt = Date.now();
  return _gcMailCfg;
}
function gcPortalUrl(origin, token) {
  return (origin || "https://app.homesteadelectric.net") + "/?gcportal=" + encodeURIComponent(token || "");
}
async function sendGcMail({ to, subject, html }) {
  const cfg = await gcLoadMailConfig();
  if (!cfg.key) { functions.logger.info("[gcMail] gc_config/mail not set — email skipped", { to }); return false; }
  if (!to || !GC_EMAIL_RE.test(String(to))) return false;
  try {
    const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.key, "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: String(to) }] }],
        from: { email: cfg.from, name: "Homestead Electric" },
        subject: String(subject || "Homestead Electric").slice(0, 200),
        content: [{ type: "text/html", value: String(html || "") }],
      }),
    });
    if (!resp.ok) { functions.logger.warn("[gcMail] send failed", { status: resp.status }); return false; }
    return true;
  } catch (e) { functions.logger.warn("[gcMail] send error", e.message); return false; }
}
function gcLocalHour() {
  try { return (parseInt(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }), 10) || 0) % 24; }
  catch (e) { return 12; }
}
// Quiet hours 9 PM–7 AM: instants queued now get a sendAt of ~next 7 AM local.
function gcQuietSendAtIso() {
  const hour = gcLocalHour();
  let until = 0;
  if (hour >= 21) until = (24 - hour) + 7; else if (hour < 7) until = 7 - hour;
  return new Date(Date.now() + until * 3600000).toISOString();
}

// Per-recipient digest scoping across a portal's active links: map email → the
// job-id set they should see (null = all jobs). Assigned supers see only their
// jobs; unassigned/office contacts see everything.
function gcDigestRecipients(linksForPortal) {
  const map = new Map();
  (linksForPortal || []).forEach((l) => {
    const contacts = Array.isArray(l.contacts) ? l.contacts : [];
    const sbj = (l.supersByJob && typeof l.supersByJob === "object") ? l.supersByJob : {};
    const assigned = {}; // name(lower) → Set(jobIds) assigned on this link
    Object.keys(sbj).forEach((jid) => (Array.isArray(sbj[jid]) ? sbj[jid] : []).forEach((s) => {
      const k = String(s || "").trim().toLowerCase(); if (k) (assigned[k] = assigned[k] || new Set()).add(jid);
    }));
    contacts.forEach((c) => {
      if (!c || c.email === false) return;
      const addr = String(c.emailAddr || "").trim().toLowerCase();
      if (!GC_EMAIL_RE.test(addr)) return;
      const nm = String(c.name || "").trim().toLowerCase();
      const theirJobs = nm && assigned[nm] ? assigned[nm] : null; // null = all
      const prev = map.get(addr);
      if (!prev) map.set(addr, { jobIds: theirJobs ? new Set(theirJobs) : null });
      else if (prev.jobIds === null || theirJobs === null) prev.jobIds = null;
      else theirJobs.forEach((j) => prev.jobIds.add(j));
    });
  });
  return map;
}

// Enqueue INSTANT trigger emails for a GC (deduped by recipient across links,
// per-job routing). Enqueued (not sent) so the hot path never calls SendGrid.
async function gcEnqueueInstants(gcKey, jobId, triggers) {
  if (!triggers || !triggers.length || !gcKey) return;
  const ls = await db.collection("gc_links").where("gcKey", "==", gcKey).where("revoked", "==", false).get();
  if (ls.empty) return;
  const recipMap = new Map(); // email → representative link (branding)
  ls.docs.forEach((d) => {
    const link = d.data();
    gcNotify.emailRecipients(link, jobId).forEach((c) => {
      const addr = String(c.emailAddr || "").trim();
      if (GC_EMAIL_RE.test(addr) && !recipMap.has(addr)) recipMap.set(addr, link);
    });
  });
  if (!recipMap.size) return;
  const cfg = await gcLoadMailConfig();
  const sendAt = gcNotify.inQuietHours(gcLocalHour()) ? gcQuietSendAtIso() : new Date().toISOString();
  const ops = [];
  triggers.forEach((trig) => {
    const { subject, sectionsHtml } = gcNotify.instantContent(trig.type, trig.payload);
    recipMap.forEach((link, addr) => {
      const html = gcNotify.renderGcEmail({ gcLabel: link.label, accent: link.accentColor, title: subject, sectionsHtml, portalUrl: gcPortalUrl(cfg.origin, link.token) });
      ops.push(db.collection("gc_notify_queue").add({ to: addr, subject, html, sendAt, tries: 0, createdAt: new Date().toISOString() }));
    });
  });
  await Promise.all(ops);
}

// 8 PM daily digest — ONE per contractor, per-recipient job scoping, only if the
// mirror changed since the last digest (no-content / nothing-changed → no email).
exports.gcPortalDailyDigest = functions.pubsub
  .schedule("0 20 * * *").timeZone(TZ).onRun(async () => {
    const cfg = await gcLoadMailConfig();
    const links = await db.collection("gc_links").where("revoked", "==", false).get();
    const byPortal = {};
    links.docs.forEach((d) => { const l = d.data(); if (l.portalId) (byPortal[l.portalId] = byPortal[l.portalId] || []).push(l); });
    let sent = 0, portals = 0;
    for (const portalId of Object.keys(byPortal)) {
      const group = byPortal[portalId];
      const rep = group[0];
      const pdoc = await db.collection("gc_portal").doc(portalId).get();
      const meta = pdoc.data() || {};
      // change-gate: skip if nothing on this portal changed since the last digest
      if (meta.updatedAt && meta.lastDigestAt && meta.updatedAt <= meta.lastDigestAt) continue;
      const jobsSnap = await db.collection("gc_portal").doc(portalId).collection("jobs").get();
      const allJobs = jobsSnap.docs.map((d) => d.data()).filter(Boolean);
      if (!allJobs.length) continue;
      let any = false;
      for (const [addr, r] of gcDigestRecipients(group)) {
        const jobs = r.jobIds === null ? allJobs : allJobs.filter((j) => r.jobIds.has(j.id));
        const dg = gcNotify.digestSections(jobs);
        if (!dg.hasContent) continue;
        const html = gcNotify.renderGcEmail({ gcLabel: rep.label, accent: rep.accentColor, title: "Tonight’s update", intro: dg.summary, sectionsHtml: dg.sectionsHtml, portalUrl: gcPortalUrl(cfg.origin, rep.token) });
        if (await sendGcMail({ to: addr, subject: (rep.label ? rep.label + " — " : "") + "your jobs tonight", html })) { sent++; any = true; }
      }
      if (any) { await db.collection("gc_portal").doc(portalId).set({ lastDigestAt: new Date().toISOString() }, { merge: true }); portals++; }
    }
    functions.logger.info("[gcPortalDailyDigest] ran", { portals, sent });
    return null;
  });

// Drain the instant queue every 5 min (sends due items; quiet-hours items wait
// for their ~7 AM sendAt). Drops an item after 5 failed tries so an unconfigured
// provider can't build an infinite backlog.
exports.gcPortalDrainQueue = functions.pubsub
  .schedule("every 5 minutes").timeZone(TZ).onRun(async () => {
    const nowIso = new Date().toISOString();
    const due = await db.collection("gc_notify_queue").where("sendAt", "<=", nowIso).limit(100).get();
    let sent = 0;
    for (const d of due.docs) {
      const q = d.data();
      // Idempotency (review finding): if a prior drain sent this but its delete
      // failed, the doc is marked sent — retry ONLY the delete, never the send.
      if (q.sent) { await d.ref.delete().catch(() => {}); continue; }
      const ok = await sendGcMail({ to: q.to, subject: q.subject, html: q.html });
      if (ok) {
        sent++;
        try { await d.ref.delete(); }
        catch (e) { await d.ref.update({ sent: true }).catch(() => {}); }
      } else {
        const tries = (q.tries || 0) + 1;
        if (tries >= 5) await d.ref.delete().catch(() => {});
        else await d.ref.update({ tries }).catch(() => {});
      }
    }
    if (due.docs.length) functions.logger.info("[gcPortalDrainQueue] ran", { due: due.docs.length, sent });
    return null;
  });
