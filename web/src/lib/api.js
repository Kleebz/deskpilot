// Thin API client. The server accepts the token as a header, a ?token= query
// param, or a cookie it sets on first contact — so after one QR scan the
// header below is belt-and-braces rather than the only thing holding auth.

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

export async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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
