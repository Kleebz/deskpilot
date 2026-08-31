// Thin API client. The server accepts the token as a header, a ?token= query
// param, or a cookie it sets on first contact — so after one QR scan the
// header below is belt-and-braces rather than the only thing holding auth.

import { currentHost, addHost } from "./hosts.svelte.js";

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

export function setToken(t) {
  token = t;
  localStorage.setItem(KEY, t);
  // Keep the keyring in step, so the machine that served this page is a
  // first-class entry rather than a special case.
  addHost({ origin: location.origin, token: t, name: location.hostname });
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
    if (e?.name === "TimeoutError" || e?.name === "AbortError" || e instanceof TypeError) {
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
