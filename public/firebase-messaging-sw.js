// firebase-messaging-sw.js
// Service worker for Homestead Electric push notifications
// Must live in /public so it's served from the root of the app

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyAQl6V74U502_ZHF3h_1W0yYDuKr2mLI5Q",
  authDomain:        "homestead-electric.firebaseapp.com",
  projectId:         "homestead-electric",
  storageBucket:     "homestead-electric.firebasestorage.app",
  messagingSenderId: "318598172684",
  appId:             "1:318598172684:web:b2ef548d952faabccd9e29"
});

const messaging = firebase.messaging();

// Handle background messages (app closed or in background)
// Reads from payload.data since we send data-only messages to prevent double notifications
messaging.onBackgroundMessage(payload => {
  const title = payload.data?.title || 'Homestead Electric';
  const body  = payload.data?.body  || '';
  self.registration.showNotification(title, {
    body,
    icon:  '/logo192.png',
    badge: '/logo192.png',
    data:  payload.data || {},
  });
});

// Clicking a notification opens or focuses the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});
