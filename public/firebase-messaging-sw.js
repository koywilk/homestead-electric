// Firebase Cloud Messaging Service Worker
// This file MUST be at the root of the public folder so the browser can
// register it at /firebase-messaging-sw.js — Firebase requires this exact path.

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

// Background message handler — fires when app is closed or in background
// Shows a system notification using the title/body from the Cloud Function payload
messaging.onBackgroundMessage(payload => {
  const title = payload.data?.title || payload.notification?.title || "Homestead Electric";
  const body  = payload.data?.body  || payload.notification?.body  || "";

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  });
});
