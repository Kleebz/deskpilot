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

// ---- notifications ----
//
// The payload arrives already decrypted: the push service relayed ciphertext it
// could not read, and the browser unsealed it with the subscription's own key.
//
// The actions matter more than the text. A session usually stops because it is
// waiting on a yes or a no, and answering from the notification means never
// opening the app at all — which is the difference between being told the run
// stalled and being able to unstall it.

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* keep the default */ }
  const session = d.session || "";

  event.waitUntil(self.registration.showNotification(d.title || "deskpilot", {
    body: d.body || "",
    tag: session || "deskpilot",     // one live notification per session
    renotify: true,
    data: { session },
    actions: session
      ? [{ action: "yes", title: "Approve" }, { action: "open", title: "Open" }]
      : [],
  }));
});

self.addEventListener("notificationclick", (event) => {
  const session = event.notification.data?.session || "";
  event.notification.close();

  // Approving is a keystroke, and the cookie the app already holds is
  // SameSite=Strict and HttpOnly, so this same-origin request carries it
  // without the worker ever seeing the token.
  if (event.action === "yes" && session) {
    event.waitUntil(fetch("/api/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session, keys: ["Enter"] }),
    }).catch(() => {}));
    return;
  }

  // Otherwise surface the app, reusing a window if one is already open rather
  // than stacking up new ones every time a notification is tapped.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) return c.focus();
    }
    return self.clients.openWindow("/");
  })());
});
