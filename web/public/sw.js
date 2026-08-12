// Network-only service worker.
//
// This exists for exactly one reason: Chrome will not fire beforeinstallprompt
// without a service worker that has a fetch handler. It deliberately caches
// NOTHING.
//
// Caching would be actively harmful here. This app is a live view of a
// machine — sessions, window geometry, whether the screen is locked. A cached
// shell would show sessions that no longer exist and a lock state from an hour
// ago, which is worse than an honest failure to load.
//
// So: satisfy the requirement, stay out of the way.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Only navigations are handled, and only by going straight to the network.
  // Everything else falls through to the browser's own handling, which avoids
  // interfering with range requests and image streaming.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request));
});
