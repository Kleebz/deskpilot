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
//
// But Approve is only offered when the server says this particular request is
// one that can be answered without reading it properly, and it carries that
// request's id. Everything else gets Open, because the honest answer to "should
// I allow this" is often "not from the lock screen". The server decides; this
// worker only renders what it was told.

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* keep the default */ }
  const session = d.session || "";
  const reqid = d.reqid || "";
  const approvable = d.kind === "blocked" && d.canApprove === true && !!reqid;

  const actions = [];
  if (approvable) actions.push({ action: "yes", title: "Approve" });
  if (session) actions.push({ action: "open", title: "Open" });

  event.waitUntil(self.registration.showNotification(d.title || "deskpilot", {
    body: d.body || "",
    tag: session || "deskpilot",     // one live notification per session
    renotify: true,
    data: { session, reqid },
    actions,
  }));
});

async function surface() {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    if ("focus" in c) return c.focus();
  }
  return self.clients.openWindow("/");
}

self.addEventListener("notificationclick", (event) => {
  const session = event.notification.data?.session || "";
  const reqid = event.notification.data?.reqid || "";
  event.notification.close();

  // Approving names the request rather than sending a bare keystroke, so a
  // notification that has been sitting on the lock screen while the agent moved
  // on cannot answer the dialog that replaced it — the server refuses it. The
  // cookie the app already holds is SameSite=Strict and HttpOnly, so this
  // same-origin request carries it without the worker ever seeing the token.
  //
  // A refusal opens the app instead of failing quietly: the request still needs
  // an answer, and silence here reads as "approved" from the outside.
  if (event.action === "yes" && session && reqid) {
    event.waitUntil((async () => {
      try {
        const res = await fetch("/api/approve", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session, reqid }),
        });
        if (res.ok) return;
      } catch { /* offline, or the server is gone — same answer */ }
      return surface();
    })());
    return;
  }

  // Otherwise surface the app, reusing a window if one is already open rather
  // than stacking up new ones every time a notification is tapped.
  event.waitUntil(surface());
});
