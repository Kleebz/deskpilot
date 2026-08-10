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

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
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

export const post = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
