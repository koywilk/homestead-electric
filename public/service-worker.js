const CACHE = "homestead-v27";

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
          if (e.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
      })
  );
});
