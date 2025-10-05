self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  // simple network-first fetch (no cache strategy for demo)
  e.respondWith(fetch(e.request));
});