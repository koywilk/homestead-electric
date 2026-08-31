const CACHE = "homestead-v391";

// Install — skip waiting immediately
self.addEventListener("install", e => {
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, cache everything, fall back to cache when offline
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  // Always go live for Firebase (Firestore, Auth, Storage)
  if (e.request.url.includes("googleapis.com")) return;
  if (e.request.url.includes("firebaseapp.com")) return;
  if (e.request.url.includes("firebasestorage.app")) return;
  if (e.request.url.includes("firebaseio.com")) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          // SOP guides (/sops/*.html, the in-app "?" help) are real documents,
          // not app routes. Handing back index.html for one — which the line
          // below would do, since opening a guide in its own tab IS a navigate
          // — renders the whole app where the guide should be. Fail honestly
          // instead so the caller can say "not downloaded yet".
          if (new URL(e.request.url).pathname.startsWith("/sops/")) {
            return new Response("Guide not cached on this device yet.", {
              status: 504, headers: { "Content-Type": "text/plain" }
            });
          }
          if (e.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
      })
  );
});
