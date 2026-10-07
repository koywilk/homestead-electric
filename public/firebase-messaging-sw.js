// Homestead Electric — push service worker (scope /firebase-cloud-messaging-push-scope)
//
// FCM reliability pass (2026-10-04). THIS worker now renders every push itself,
// in its own `push` listener, whether or not the app is open:
//
//  - The Firebase SW SDK only calls onBackgroundMessage when NO app window is
//    visible. With a window visible it hands the payload to the page and shows
//    nothing. The page then tried `new Notification(...)`, which throws on
//    Android Chrome ("Illegal constructor") and does not exist in an iOS
//    Home-Screen app. So a push that arrived while the app was open showed no
//    banner on phones — and on iOS, Safari counts a push that shows nothing as
//    a "silent push" and REVOKES the site's push permission after a few. That
//    is the "Apple users stop getting them" pattern.
//  - Showing the notification here, inside the push event, satisfies Chrome's
//    userVisibleOnly rule and Safari's no-silent-push rule on every push.
//
// The Firebase SDK is still loaded (after our listener) for two jobs only:
// forwarding the payload to a visible app window (the in-app toast + the
// Notification Doctor's "received" check, via onMessage in App.js) and
// handling pushsubscriptionchange. No onBackgroundMessage handler is set, and
// every server payload is data-only, so the SDK never displays a second copy.

const APP_CALL_KEY = "hs-app-9f3c1e7a2b6d4085";   // same public key as src/App.js / functions/index.js
const RECEIPT_URL  = "https://us-central1-homestead-electric.cloudfunctions.net/pushReceipt";

// ─── SW lifecycle: skipWaiting + clients.claim ──────────────────────────────
// Without these, a freshly deployed worker sits in "waiting" until ALL open
// tabs of the app close — for a PWA the crew keeps open all day, new push
// logic would never take effect. The page also calls reg.update() on load.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// FCM web payload: { data: {...our fields}, from, fcmMessageId, priority, notification? }
function readPayload(event) {
  if (!event.data) return null;
  try { return event.data.json(); } catch (e) {
    try { return { data: { body: event.data.text() } }; } catch (e2) { return null; }
  }
}

function deepLinkUrl(d) {
  const origin = self.location.origin;
  if (d.link && d.link.charAt(0) === "/") return origin + d.link;   // server-built, includes nid
  if (d.view) return `${origin}/?view=${encodeURIComponent(d.view)}${d.needId ? `&need=${encodeURIComponent(d.needId)}` : ""}`;
  if (d.jobId) return `${origin}/?jobId=${encodeURIComponent(d.jobId)}&section=${encodeURIComponent(d.section || "")}`;
  return origin + "/";
}

// Best-effort "the device displayed it" ping (callable protocol over fetch).
// Never retried, never blocks the banner, silently skipped for test pushes.
function sendReceipt(d, visible) {
  if (!d.nid || !d.uk) return Promise.resolve();
  return fetch(RECEIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { _appKey: APP_CALL_KEY, uk: d.uk, nid: d.nid, tk: d.tk || "", shown: true, visible } }),
    keepalive: true,
  }).catch(() => {});
}

// Registered BEFORE firebase.messaging() so it runs first on every push.
self.addEventListener("push", event => {
  const payload = readPayload(event) || {};
  const d = payload.data || {};
  const n = payload.notification || {};
  // Diagnostic — DevTools → Application → Service Workers → this worker → console.
  console.log("[HE sw] push", { nid: d.nid, title: d.title || n.title, jobId: d.jobId, view: d.view, test: d.__test });

  const title = d.title || n.title || "Homestead Electric";
  const body  = d.body  || n.body  || "";
  // One banner per notification record (server tag = "he-<record id>"); a
  // retried send of the same record reuses it, so retries never stack.
  const tag   = d.tag || (d.nid ? `he-${d.nid}` : `he-${Date.now()}`);
  const high  = d.pri !== "normal";
  const data  = {
    jobId: d.jobId || "", section: d.section || "", view: d.view || "",
    needId: d.needId || "", nid: d.nid || "", url: deepLinkUrl(d),
  };

  event.waitUntil((async () => {
    let visible = false;
    try {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      visible = wins.some(c => c.visibilityState === "visible");
    } catch (e) { /* show anyway */ }
    try {
      await self.registration.showNotification(title, {
        body,
        icon:  "/icon-192.png",
        badge: "/icon-192.png",
        tag,
        renotify: true,             // only matters if the same record arrives twice
        requireInteraction: false,
        silent: !high,
        timestamp: Date.now(),
        data,
      });
    } catch (e) {
      console.warn("[HE sw] showNotification failed", e && e.message);
      return;
    }
    await sendReceipt(d, visible);
  })());
});

// Firebase SDK — loaded AFTER the push listener above. Wrapped so a CDN
// failure at install time can never take the push handler down with it.
try {
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
  firebase.messaging();   // forwards to visible windows + handles pushsubscriptionchange
} catch (e) {
  console.warn("[HE sw] Firebase SDK unavailable — push display still works", e && e.message);
}

// Tap → open the app on the exact item.
//
// This worker does NOT control the app's pages (they belong to
// /service-worker.js at scope "/"), and WindowClient.navigate() only works for
// a client the calling worker controls — so since the scope split (SW v364)
// navigate() always rejected and taps on My Day / view notifications just
// focused the app without going anywhere. Now an open window gets a
// postMessage it handles in place (no reload), and openWindow() covers the
// app-closed case with the full deep-link URL.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const nd      = event.notification.data || {};
  const fcmData = (nd.FCM_MSG && nd.FCM_MSG.data) || {};   // older SDK auto-display shape
  const target = {
    type:    "HE_NOTIF_CLICK",
    jobId:   nd.jobId   || fcmData.jobId   || "",
    section: nd.section || fcmData.section || "",
    view:    nd.view    || fcmData.view    || "",
    needId:  nd.needId  || fcmData.needId  || "",
    nid:     nd.nid     || fcmData.nid     || "",
  };
  const url = nd.url || deepLinkUrl(target);

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find(c => c.url.startsWith(self.location.origin));
    if (app) {
      try { await app.focus(); } catch (e) { /* focus can be refused; still deliver the message */ }
      app.postMessage(target);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
