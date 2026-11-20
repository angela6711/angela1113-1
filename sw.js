const CACHE = 'fly-ledger-v2-20261120-4';
const ASSETS = ['./', './index.html', './cloud-sync.js', './app-integration.js', './manifest.webmanifest', './setup.html', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fly-ledger-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never cache Google requests, credentials, API responses, POSTs or unrelated repository files.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    if (!allowed.has(url.href)) return;
    event.respondWith(fetch(request).catch(() => caches.match(request).then(cached => cached || caches.match(new URL('./index.html', self.registration.scope)))));
  } else if (allowed.has(url.href)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
