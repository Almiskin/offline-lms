const CACHE_NAME = 'offline-lms-shell-v3';

// Core app shell: everything needed to load the UI with zero connectivity.
// Actual course content (PDFs, images, quiz JSON) is cached separately in
// IndexedDB by offline-manager.js — the service worker is only responsible
// for the app shell + API network strategy, not per-course content.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/vendor/dexie.min.js',
  '/js/vendor/chart.umd.min.js',
  '/js/db.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/connectivity.js',
  '/js/offline-manager.js',
  '/js/quiz.js',
  '/js/sync.js',
  '/js/reports.js',
  '/js/router.js',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network-first, no offline fallback (data is dynamic; the
  // front-end's IndexedDB layer is the offline source of truth for this,
  // not the service worker cache).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Uploaded material downloads go straight to network; they're captured
  // into IndexedDB explicitly by the download button, not by the SW cache.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell: cache-first, falling back to network, so navigating the
  // installed app works with zero connectivity.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
