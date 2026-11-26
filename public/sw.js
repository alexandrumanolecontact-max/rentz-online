const CACHE_NAME = 'rentz-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/css/styles.css',
  '/js/app.js',
  '/js/cards.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Nu interceptăm niciodată conexiunile live Socket.IO sau apelurile API
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) {
    return;
  }

  // Strategie Network-First: ia mereu ultima versiune de pe server când există internet, cu fallback la cache
  event.respondWith(
    fetch(req)
      .then((networkResp) => {
        if (networkResp && networkResp.status === 200 && url.origin === self.location.origin) {
          const copy = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkResp;
      })
      .catch(() => caches.match(req))
  );
});
