// The machines this phone can reach, and which one is being looked at.
//
// One phone, several machines. The important design choice is that this is the
// *only* thing that knows about more than one: every existing call site still
// says api("/sessions") and gets whichever machine is currently selected. That
// keeps the multi-machine change from touching every component, and it means
// switching machines is one piece of state changing rather than a navigation.
//
// Auth is per host and lives here. Note what cannot be reused: the dp cookie is
// SameSite=Strict and same-origin, so it only ever covers the machine the page
// was served from. Every other host authenticates with its bearer token from
// this keyring — which also means losing localStorage loses those, where the
// cookie covers only the machine that served the page. Re-pairing is the
// recovery, and re-pairing needs access to the machine, which is exactly what
// you do not have when it matters. Passkeys are the real answer.

const HOSTS = "dp_hosts";
const CURRENT = "dp_host";
const LEGACY_TOKEN = "dp_token";

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(HOSTS) ?? "[]");
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* corrupt or absent */ }

  // The machine serving this page is always in the list, with or without a
  // token to show for it. It showed "machines · 0" while working perfectly:
  // the app was authenticating with the dp cookie, which is HttpOnly and so
  // invisible to script, and localStorage had been evicted — exactly the case
  // this list most needs to render.
  return [{
    origin: location.origin,
    token: localStorage.getItem(LEGACY_TOKEN) ?? "",
    name: location.hostname,
  }];
}

export const hosts = $state({
  list: load(),
  current: localStorage.getItem(CURRENT) ?? location.origin,
  // origin -> capabilities, so the UI can hide what a machine cannot do.
  caps: {},
});

function persist() {
  localStorage.setItem(HOSTS, JSON.stringify(hosts.list));
  localStorage.setItem(CURRENT, hosts.current);
}

export function currentHost() {
  return hosts.list.find((h) => h.origin === hosts.current) ??
    hosts.list[0] ??
    // A page always knows how to reach the machine that served it, even before
    // anything has been paired.
    { origin: location.origin, token: "", name: location.hostname };
}

export function capsFor(origin = hosts.current) {
  // Assume the full set until told otherwise: a machine that has not answered
  // yet should not have its controls flicker in as the reply lands.
  return hosts.caps[origin] ?? { terminal: true, sessions: true, windows: true, screenshot: true, input: true };
}

export function select(origin) {
  if (origin === hosts.current) return;
  hosts.current = origin;
  persist();
}

// Most multi-machine use is ping-ponging between two boxes, so keep the last
// one to hand rather than making it a trip through the list.
let previous = null;
export function switchTo(origin) {
  if (origin !== hosts.current) previous = hosts.current;
  select(origin);
}
export function back() {
  if (previous && previous !== hosts.current) switchTo(previous);
}
export const hasPrevious = () => !!previous && previous !== hosts.current;

export function addHost({ origin, token, name }) {
  const clean = origin.replace(/\/$/, "");
  const existing = hosts.list.find((h) => h.origin === clean);
  if (existing) {
    existing.token = token || existing.token;
    if (name) existing.name = name;
  } else {
    hosts.list.push({ origin: clean, token, name: name || new URL(clean).hostname });
  }
  hosts.current = clean;
  persist();
}

export function removeHost(origin) {
  hosts.list = hosts.list.filter((h) => h.origin !== origin);
  if (hosts.current === origin) hosts.current = hosts.list[0]?.origin ?? location.origin;
  delete hosts.caps[origin];
  persist();
}

export function setCaps(origin, caps) {
  hosts.caps = { ...hosts.caps, [origin]: caps };
  const h = hosts.list.find((x) => x.origin === origin);
  // The machine names itself; the list should say what the machine says.
  if (h && caps?.name && h.name !== caps.name) {
    h.name = caps.name;
    persist();
  }
}

// Attention per machine, so the strip can show where the work is without
// leaving the session you are in.
export const needsYou = $state({});
export function setNeedsYou(origin, n) {
  if (needsYou[origin] !== n) needsYou[origin] = n;
}
