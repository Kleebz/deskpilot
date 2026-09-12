// The application shell is cached; live machine data never is.
//
// Chrome will not fire beforeinstallprompt without a service worker that has a
// fetch handler. Caching the HTML, CSS and JavaScript also removes the machine
// that supplied the installed PWA as a boot dependency: once the UI starts, its
// locally stored keyring can select any machine that is still online. Sessions,
// locks, screenshots and every /api response remain network-only.

// Vite replaces this marker with a digest of its complete asset manifest. That
// changes sw.js whenever any built asset changes, which makes the browser
// install the new worker and lets activation discard the old shell atomically.
const SHELL = "deskpilot-shell-__DESKPILOT_SHELL_VERSION__";
const SHELL_PREFIX = "deskpilot-shell-";
const APP = "/__deskpilot_app_shell__";
const OFFLINE = "/offline.html";
const MANIFEST = "/.vite/manifest.json";
const STATIC = [
  OFFLINE,
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

async function fetchInto(cache, url, key = url) {
  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) throw new Error(`could not cache ${url}: ${response.status}`);
  await cache.put(key, response.clone());
  return response;
}

async function installShell() {
  const cache = await caches.open(SHELL);
  const manifestResponse = await fetchInto(cache, MANIFEST);
  const manifest = await manifestResponse.json();
  const assets = new Set(STATIC);
  for (const entry of Object.values(manifest)) {
    if (entry.file) assets.add(`/${entry.file}`);
    for (const file of entry.css || []) assets.add(`/${file}`);
    for (const file of entry.assets || []) assets.add(`/${file}`);
  }
  await Promise.all([...assets].map((url) => fetchInto(cache, url)));

  // Store the document under an internal key. Network navigations still ask
  // the server first, while a failed cold launch gets this exact built shell.
  await fetchInto(cache, "/", APP);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL).map((k) => caches.delete(k)),
    ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match(APP)) || caches.match(OFFLINE)
    ));
    return;
  }

  // Only responses explicitly placed in the shell cache can win here. API
  // responses and runtime state never enter it, so they cannot become stale.
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
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
