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

// Background message handler — shows a system notification.
// The `data` payload includes title, body, jobId, and section.
messaging.onBackgroundMessage(payload => {
  const title   = payload.data?.title || payload.notification?.title || "Homestead Electric";
  const body    = payload.data?.body  || payload.notification?.body  || "";
  const jobId   = payload.data?.jobId   || "";
  const section = payload.data?.section || "";

  // Store the deep-link target so the notificationclick handler can use it.
  // We encode it in the notification's data tag so it survives the click event.
  return self.registration.showNotification(title, {
    body,
    icon:  "/icon-192.png",
    badge: "/icon-192.png",
    tag:   `he-${jobId}-${section}`,   // dedupes notifications for the same job+section
    data:  { jobId, section },
  });
});

// When the user taps a notification, open the app at the right job + section.
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const { jobId, section } = event.notification.data || {};
  const url = jobId
    ? `${self.location.origin}/?jobId=${encodeURIComponent(jobId)}&section=${encodeURIComponent(section || "")}`
    : self.location.origin + "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      const appClient = windowClients.find(c => c.url.startsWith(self.location.origin));
      if (appClient) {
        // Use navigate() so the app reloads at the URL with jobId params — more reliable
        // than postMessage on mobile where iOS suspends JS in backgrounded apps.
        if (jobId && typeof appClient.navigate === "function") {
          return appClient.navigate(url).then(c => c && c.focus()).catch(() => {
            appClient.focus();
            appClient.postMessage({ type: "HE_NOTIF_CLICK", jobId, section });
          });
        }
        return appClient.focus();
      }
      // App not open — open a new window at the deep-link URL.
      return clients.openWindow(url);
    })
  );
});
