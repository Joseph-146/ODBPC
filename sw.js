// Service worker for installability. Same-origin GET requests pass straight to the network (nothing is cached),
// so updates show up immediately and Supabase sign-in/sync is never touched.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.method === 'GET' && new URL(e.request.url).origin === location.origin) {
    e.respondWith(fetch(e.request));
  }
});
