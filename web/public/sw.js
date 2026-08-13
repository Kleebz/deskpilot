// Network-only, with one exception.
//
// Chrome will not fire beforeinstallprompt without a service worker that has a
// fetch handler, which is why this exists at all. It deliberately caches none
// of the app: this is a live view of a machine, and a cached shell would show
// sessions that no longer exist and a lock state from an hour ago.
//
// The exception is a single static error page. When the tailnet is down the app
// cannot load at all, so the browser shows its own "site can't be reached" —
// which says nothing about the actual cause. Serving our own page instead lets
// it name the likely culprit. It contains no live data, so it cannot go stale.

const SHELL = "deskpilot-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Only navigations, and only to fall back — never to serve app data.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE)),
  );
});
