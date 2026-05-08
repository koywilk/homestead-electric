// Homestead Electric — FCM Background Service Worker
// Handles push notifications when the app is closed or backgrounded.
// Firebase compat SDK is used here because importScripts is the only way
// to load modules in a service worker context.

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyAQl6V74U502_ZHF3h_1W0yYDuKr2mLI5Q",
  authDomain:        "homestead-electric.firebaseapp.com",
  projectId:         "homestead-electric",
  storageBucket:     "homestead-electric.firebasestorage.app",
  messagingSenderId: "318598172684",
  appId:             "1:318598172684:web:b2ef548d952faabccd9e29",
});

const messaging = firebase.messaging();

// ─── SW lifecycle: skipWaiting + clients.claim ──────────────────────────────
// Without these, a freshly deployed firebase-messaging-sw.js sits in "waiting"
// state until ALL open tabs of the app close — which for a PWA the crew keeps
// open all day means new SW logic NEVER takes effect. That's exactly how the
// old SW could keep mishandling new server payloads silently. Calling
// skipWaiting() on install + clients.claim() on activate makes every future
// SW deploy take over existing tabs immediately. The first deploy of THIS
// version still has to be fetched once (browser checks /firebase-messaging-sw.js
// on each register() call, which the app does on every page load), but after
// that initial fetch, activation is immediate. Also expose a SKIP_WAITING
// message handler so the page can yell at any waiting SW from JS.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Background message handler — shows a system notification.
// The `data` payload includes title, body, jobId, section, and tag.
//
// All real pushes are now data-only (the server stopped sending top-level
// `notification` payloads to fix the "two notifications per push" bug). That
// means EVERY push lands in this handler — there's no FCM SDK auto-display
// happening anymore. We render exactly one notification here.
messaging.onBackgroundMessage(payload => {
  // Diagnostic — visible in DevTools → Application → Service Workers → console.
  // If pushes arrive but no banner shows, this log proves whether the SW even
  // received them (vs. push subscription dead, app foregrounded path, etc.).
  console.log("[HE bgsw] onBackgroundMessage", {
    hasData: !!payload.data,
    hasNotification: !!payload.notification,
    title: payload.data?.title,
    section: payload.data?.section,
  });
  const title   = payload.data?.title || payload.notification?.title || "Homestead Electric";
  const body    = payload.data?.body  || payload.notification?.body  || "";
  const jobId   = payload.data?.jobId   || "";
  const section = payload.data?.section || "";
  // Server-supplied tag wins (stable across pushes for the same job+section);
  // fall back to a derived tag for older clients.
  const tag     = payload.data?.tag || `he-${jobId}-${section}`;

  // Store the deep-link target so the notificationclick handler can use it.
  // We encode it in the notification's data tag so it survives the click event.
  return self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    tag,                                // dedupes notifications for the same job+section
    renotify: false,                    // don't pop a fresh banner if the tag matches
    data:  { jobId, section },
  });
});

// When the user taps a notification, open the app at the right job + section.
self.addEventListener("notificationclick", event => {
  event.notification.close();

  // Data can live in three places depending on who showed the notification:
  //  1. Our own onBackgroundMessage handler → .data.{jobId,section}
  //  2. FCM auto-display (when payload has notification field) → .data.FCM_MSG.data.{jobId,section}
  //  3. Firebase JS SDK recent versions → .data.FCM_MSG.notification + .data.FCM_MSG.data
  // Read from whichever one has our jobId — this was the bug where clicks landed on the
  // homepage instead of the job because we only looked at path 1.
  const ndata   = event.notification.data || {};
  const fcm     = ndata.FCM_MSG || {};
  const fcmData = fcm.data || {};
  const jobId   = ndata.jobId   || fcmData.jobId   || "";
  const section = ndata.section || fcmData.section || "";

  const url = jobId
    ? `${self.location.origin}/?jobId=${encodeURIComponent(jobId)}&section=${encodeURIComponent(section || "")}`
    : self.location.origin + "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      const appClient = windowClients.find(c => c.url.startsWith(self.location.origin));
      if (appClient) {
        // App already open — navigate to the deep-link URL and focus it.
        if (jobId && typeof appClient.navigate === "function") {
          return appClient.navigate(url).then(c => c && c.focus()).catch(() => {
            appClient.focus();
            appClient.postMessage({ type: "HE_NOTIF_CLICK", jobId, section });
          });
        }
        // Fallback — postMessage so the app opens the job without a full reload.
        if (jobId) appClient.postMessage({ type: "HE_NOTIF_CLICK", jobId, section });
        return appClient.focus();
      }
      // App not open — open a new window at the deep-link URL.
      return clients.openWindow(url);
    })
  );
});
