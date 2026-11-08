// Offline-Cache: App-Dateien werden beim ersten Öffnen gespeichert.
// Bei Code-Änderungen VERSION hochzählen, damit das iPhone die neue Version lädt.
const VERSION = 'gym-v1';
const FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'xlsx.js', 'seed.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(e.request).catch(() =>
        e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()
      );
    })
  );
});
