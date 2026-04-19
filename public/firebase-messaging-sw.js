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

// Initialize messaging so the SDK wires up push handling in this SW.
// We do NOT register an onBackgroundMessage handler on purpose — when the
// server sends a `webpush.notification` payload, FCM auto-displays it using
// the browser's native notification UI. Registering a custom handler here
// caused a second notification to fire on Android ("double-pop"). Now the
// native system handles display; we only intercept the tap.
firebase.messaging();

// Activate the new SW immediately instead of waiting for every tab to close.
// This matters after a deploy: without it, users can run the OLD SW (which
// double-pops) alongside the NEW server payload until they manually close
// the PWA. With skipWaiting + clients.claim, the next page load uses this SW.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Deep-link when the user taps the notification.
// The data payload is populated server-side via webpush.notification.data:
//   { jobId, section }
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const data    = event.notification.data || {};
  const jobId   = data.jobId   || (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.jobId)   || "";
  const section = data.section || (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.section) || "";

  const url = jobId
    ? `${self.location.origin}/?jobId=${encodeURIComponent(jobId)}&section=${encodeURIComponent(section)}`
    : self.location.origin + "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      const appClient = windowClients.find(c => c.url.startsWith(self.location.origin));
      if (appClient) {
        // If the app is already open, navigate it to the deep-link URL and focus.
        // Fallback: focus + postMessage so the in-app listener can handle it.
        if (jobId && typeof appClient.navigate === "function") {
          return appClient.navigate(url).then(c => c && c.focus()).catch(() => {
            appClient.focus();
            appClient.postMessage({ type: "HE_NOTIF_CLICK", jobId, section });
          });
        }
        appClient.focus();
        if (jobId) appClient.postMessage({ type: "HE_NOTIF_CLICK", jobId, section });
        return;
      }
      // App not open — open a new window at the deep-link URL.
      return clients.openWindow(url);
    })
  );
});
