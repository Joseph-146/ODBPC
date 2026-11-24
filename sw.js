// Service worker for installability only.
// It deliberately caches nothing: every request goes straight to the network,
// so updates published on GitHub show up immediately and Supabase sign-in/sync is never touched.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network only */ });
