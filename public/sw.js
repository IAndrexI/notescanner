const CACHE_NAME = 'notescan-v4';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/vision.js',
  '/js/scanner.js',
  '/js/export-manager.js',
  '/js/pdf-builder.js',
  '/js/handwriting-converter.js',
  '/js/seafile-api.js',
  '/js/storage.js',
  '/js/updater.js',
  '/js/jspdf.umd.min.js',
  '/js/jszip.min.js',
  '/js/qrcode.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => console.log('Asset cache warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Pass through API requests directly to network
  if (e.request.url.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
