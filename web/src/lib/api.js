// Thin API client. The server accepts the token as a header, a ?token= query
// param, or a cookie it sets on first contact — so after one QR scan the
// header below is belt-and-braces rather than the only thing holding auth.

import { addHost, currentHost, hosts } from "./hosts.svelte.js";
import { deviceName } from "./device-name.js";

const KEY = "dp_token";

function readToken() {
  const q = new URLSearchParams(location.search).get("token");
  if (q) {
    localStorage.setItem(KEY, q);
    history.replaceState(null, "", location.pathname);
    return q;
  }
  return localStorage.getItem(KEY) ?? "";
}

export let token = readToken();

// Pairing now hands over a one-time code rather than the machine's own token,
// and the code is exchanged here for a credential belonging to this device
// alone. That is what makes losing a phone survivable: revoke that one, leave
// everything else paired.
//
// Everything else in this file waits on `ready`, so no request can go out
// holding the wrong credential — or none — while the exchange is in flight.
export async function enroll(code, host) {
  // Against the selected machine, not the one that served the page: the token
  // gate appears whenever the *selected* machine answers 401, which on a phone
  // with several paired is usually one of the others.
  const h = host ?? currentHost();
  const same = h.origin === location.origin;
  const res = await fetch(`${same ? "" : h.origin}/api/devices/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Named after the browser rather than left blank: a list of four entries
    // called "device" is not a list you can revoke from with any confidence.
    body: JSON.stringify({ code, name: await deviceName() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "pairing failed");
  if (body.token) {
    addHost({ origin: h.origin, token: body.token, name: h.name });
    // The legacy same-origin token only ever covered this machine, so only
    // this machine's credential may overwrite it.
    if (same) {
      token = body.token;
      localStorage.setItem(KEY, body.token);
    }
  }
  return body;
}

async function enrollFromCode() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return;
  history.replaceState(null, "", location.pathname);
  // A code in *this page's* URL came from this machine's pair.sh, whichever
  // machine a previous visit happened to leave selected.
  const self = { origin: location.origin, token: "", name: location.hostname };
  // Opening successive QRs in the system camera returns to this same origin.
  // If it already has a device credential, consume neither the new code nor a
  // second row in the device list. A legacy shared credential deliberately
  // continues through enrollment so the visit upgrades it to a revocable one.
  try {
    if (await hasDeviceCredential(self)) return;
    await enroll(code, self);
  } catch { /* falls back to what is stored */ }
}

// This deliberately does not call api(): ready is waiting for
// enrollFromCode(), so doing that here would await itself forever.
export async function hasDeviceCredential(host) {
  const same = host.origin === location.origin;
  const stored = hosts.list.find((h) => h.origin === host.origin)?.token ||
    host.token;
  const res = await fetch(`${same ? "" : host.origin}/api/devices`, {
    credentials: same ? "same-origin" : "omit",
    headers: stored ? { authorization: `Bearer ${stored}` } : {},
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return false;
  const body = await res.json().catch(() => ({}));
  return body.legacy === false;
}

export const ready = enrollFromCode();

export function setToken(t) {
  // Keep the keyring in step, so the machine that served this page is a
  // first-class entry rather than a special case — but against the machine
  // that is *selected*. Writing location.origin here meant that typing another
  // machine's token into the gate overwrote this machine's working credential
  // with one for a different box, and then switched you back here, because
  // addHost selects whatever it adds. Two machines, one of them broken, and
  // the obvious recovery broke the other one.
  const h = currentHost();
  addHost({ origin: h.origin, token: t, name: h.name });
  if (h.origin === location.origin) {
    token = t;
    localStorage.setItem(KEY, t);
  }
}

// A dropped tailnet does not refuse connections, it swallows packets — so
// without a deadline the app spins forever and looks broken when the real
// answer is "the VPN is off". Fail fast and say which.
const TIMEOUT_MS = 8000;

export class Unreachable extends Error {
  constructor() {
    super("can't reach the desktop — is Tailscale on?");
    this.name = "Unreachable";
    this.unreachable = true;
  }
}

// Requests go to whichever machine is selected. Same-origin stays a relative
// URL so the cookie still applies there; every other host is absolute and
// authenticates with its own token from the keyring.
export function resolve(path, host) {
  const h = host ?? currentHost();
  const same = h.origin === location.origin;
  return {
    url: same ? `/api${path}` : `${h.origin}/api${path}`,
    token: h.token || (same ? token : ""),
    same,
  };
}

export async function api(path, opts = {}) {
  await ready;
  let res;
  const { url, token: tok, same } = resolve(path, opts.host);
  try {
    res = await fetch(url, {
      ...opts,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      // Never "include": the cookie is same-origin by design, and asking for
      // credentials cross-origin would require the server to relax CORS in a
      // way that makes every other site's page a possible caller.
      credentials: same ? "same-origin" : "omit",
      headers: {
        ...(tok ? { authorization: `Bearer ${tok}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  } catch (e) {
    // TimeoutError/AbortError from the deadline, TypeError from a dead route.
    // All three mean the same thing to a user standing in a car park.
    if (
      e?.name === "TimeoutError" || e?.name === "AbortError" ||
      e instanceof TypeError
    ) {
      throw new Unreachable();
    }
    throw e;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? res.statusText);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  if (ct.includes("image")) return res.blob();
  return res.text();
}

export const post = (path, body, opts = {}) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...opts,
  });

// Poll until a predicate holds. Creating a session returns as soon as the
// terminal is dispatched, but the window takes a second or two to launch and
// attach — refreshing immediately shows it as detached, which reads as failure.
export async function waitFor(fn, { tries = 14, every = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, every));
    try {
      if (await fn()) return true;
    } catch { /* keep waiting */ }
  }
  return false;
}

// Paths are shown in narrow rows where the prefix is the least useful part.
// The server sends absolute paths; the UI shows them home-relative.
export function tilde(path) {
  if (!path) return "";
  const home = path.match(/^\/(home|Users)\/[^/]+/)?.[0];
  return home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
}
