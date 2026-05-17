const CACHE_NAME = "geologgia-v2";
const TILE_CACHE = "geologgia-tiles-v1";

// App shell — cached on install
const APP_SHELL = [
  "/",
  "/icon.svg",
  "/manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

// Install: cache app shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== TILE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for tiles, stale-while-revalidate for app
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET
  if (e.request.method !== "GET") return;

  // API calls — network only (audio processing needs server)
  if (url.pathname.startsWith("/api/")) return;

  // Map tiles — cache first, then network (offline maps!)
  if (url.hostname.includes("tile.openstreetmap.org") ||
      url.hostname.includes("server.arcgisonline.com") ||
      url.hostname.includes("basemaps.cartocdn.com") ||
      url.hostname.includes("mt1.google.com")) {
    e.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          if (cached) return cached;
          return fetch(e.request).then((response) => {
            if (response.ok) {
              cache.put(e.request, response.clone());
            }
            return response;
          }).catch(() => new Response("", { status: 408 }));
        })
      )
    );
    return;
  }

  // App shell — stale while revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, response.clone()));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
