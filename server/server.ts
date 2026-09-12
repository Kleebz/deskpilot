// deskpilot server — a thin HTTP wrapper over scripts/ and tmux.
//
//   deno run --allow-net --allow-read --allow-env \
//     --allow-write=$HOME/.local/state/deskpilot \
//     --allow-run=$PWD/scripts/desk.sh,$PWD/scripts/sessions.sh,tmux \
//     server/server.ts
//
// Nothing here knows what agent is running inside a tmux session. `send` types
// keystrokes into a terminal; what reads them is not this program's business.
//
// Binds to 127.0.0.1 by default. Set DESKPILOT_HOST=0.0.0.0 only once you are
// behind Tailscale — this endpoint can run commands on the machine.

import { loadVapid, sendPush, type Subscription } from "./push.ts";
import { ControlClient, keysCommand } from "./control.ts";
import { Devices } from "./devices.ts";
import { describe } from "./version.ts";
import { runCommand } from "./cli.ts";
import { listSessions } from "./sessions.ts";
import { ROOT, scriptsDir } from "./scripts.ts";
import { AgentStates, isLifecycle, type LifecycleReport } from "./agent-state.ts";

const WEB = `${ROOT}/web`;

const HOST = Deno.env.get("DESKPILOT_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("DESKPILOT_PORT") ?? "8790");
// What this machine calls itself in a list of machines. The hostname is the
// right default: it is what the user already calls the box.
//
// Deno.hostname() needs --allow-sys, and widening the sandbox for a display
// label is a bad trade — the scoped permission list is the reason this server
// is Deno. /etc/hostname is covered by --allow-read, which is already granted.
// Remote unlock types your desktop password into a live lock screen. It needs
// ydotool, which needs a udev rule and group membership, and it is the single
// most dangerous thing this server can do — so it is off unless someone turns
// it on deliberately. Presence of ydotool is not consent.
const UNLOCK_ENABLED = /^(1|true|yes|on)$/i.test(
  Deno.env.get("DESKPILOT_UNLOCK") ?? "",
);

// Failed unlock attempts. PAM is slow on failure, which throttles guessing a
// little, but not enough: an authenticated session could sit and grind. Five
// wrong answers buys a five minute pause, which costs nothing when you mistype
// and a great deal when you are guessing.
const unlockFails: number[] = [];
const UNLOCK_WINDOW_MS = 300_000;
const UNLOCK_MAX = 5;

function unlockLockedOut(): number {
  const now = Date.now();
  while (unlockFails.length && now - unlockFails[0] > UNLOCK_WINDOW_MS) {
    unlockFails.shift();
  }
  if (unlockFails.length < UNLOCK_MAX) return 0;
  return Math.ceil((UNLOCK_WINDOW_MS - (now - unlockFails[0])) / 1000);
}

const BUILD = describe(ROOT);

// Subcommands run and exit before the server exists. A packaged binary is all
// its user has — shell/setup.sh is in the repo, not the package — so making a
// token, writing the unit and pairing a device have to be reachable here.
if (Deno.args.length > 0) {
  Deno.exit(await runCommand(Deno.args, BUILD));
}
const NAME = Deno.env.get("DESKPILOT_NAME") ?? (() => {
  try { return Deno.readTextFileSync("/etc/hostname").trim() || "deskpilot"; }
  catch { return "deskpilot"; }
})();
// What a launcher prints under the home screen icon, which is a different
// question from what this machine is called. Deliberately NOT defaulted to
// NAME: see serveManifest.
const APP_NAME = Deno.env.get("DESKPILOT_APP_NAME") ?? "deskpilot";
const TOKEN = (await readToken()).trim();

async function readToken(): Promise<string> {
  const path = Deno.env.get("DESKPILOT_TOKEN_FILE") ??
    `${Deno.env.get("HOME")}/.config/deskpilot/token`;
  try {
    return await Deno.readTextFile(path);
  } catch {
    console.error(`no token at ${path} — create one with:`);
    console.error(`  mkdir -p ~/.config/deskpilot && openssl rand -hex 32 > ~/.config/deskpilot/token`);
    Deno.exit(1);
  }
}

// Length-independent comparison so the token is not guessable by timing.
function tokenOk(given: string | null): boolean {
  if (!given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(TOKEN);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

// A command that cannot be spawned at all is a normal state here, not an
// exception. A headless host has no desk.sh — that is the entire premise of
// capability negotiation — and a compiled binary may be looking at a path its
// allowlist does not cover. Both used to throw straight out of the handler and
// return 500, so a machine with no compositor could not even be *asked* what it
// could do. Found by running the binary with desk.sh removed, which is the
// first time that case has been exercised for real rather than simulated.
async function run(cmd: string, args: string[]) {
  try {
    const p = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr } = await p.output();
    return {
      code,
      out: new TextDecoder().decode(stdout),
      err: new TextDecoder().decode(stderr),
    };
  } catch (e) {
    // 127 is what a shell reports for "command not found", which is what this
    // is, and callers already treat any non-zero code as failure.
    return { code: 127, out: "", err: e instanceof Error ? e.message : String(e) };
  }
}

// A capture is padded to the pane height, so most of it is blank: measured
// 38 blank lines out of 58 on a real reply. Trim trailing spaces and collapse
// blank runs to one — 3665 bytes becomes 1244 with nothing lost.
// Deliberately NOT stripping box-drawing: the conversation itself is plain
// prose, and the only boxed thing is the banner, which scrolls away.
// A TUI draws separators the full width of the terminal — 130 columns here.
// A phone fits about 48, so each rule wraps to three lines of solid box
// characters, and two of them swamp an eight-line reply. They carry no
// information a short rule does not, so they are collapsed.
//
// Only lines that are ENTIRELY rule characters are touched. Anything with text
// in it is left exactly as sent, including box edges around content —
// stripping those would risk mangling real output.
const RULE = /^[\s\u2500-\u257f]+$/;      // box-drawing block
const HAS_RULE_CHAR = /[\u2500-\u257f]/;

function normalizeCapture(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .map((l) => (l.length > 12 && RULE.test(l) && HAS_RULE_CHAR.test(l)
      ? l.trim()[0].repeat(12)
      : l))
    .reduce<string[]>((acc, l) => {
      if (l === "" && acc[acc.length - 1] === "") return acc;
      acc.push(l);
      return acc;
    }, [])
    .join("\n")
    .trim();
}

// Every API response is no-store. Without it a browser may heuristically cache
// a GET that has no cache headers, and the app then renders a stale session
// list — observed: a session running on ws9 shown as "no session on this
// screen" while the server was reporting it correctly.
const NO_STORE = { "cache-control": "no-store" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });

const fail = (msg: string, status = 400) => json({ error: msg }, status);

// One phone talking to several machines means requests arrive cross-origin.
//
// The bearer token is the authentication, and CORS is not: a page that cannot
// produce the token gets 401 and can read nothing, whatever origin it claims.
// So an origin is echoed once the request has authenticated, rather than being
// matched against a list of hostnames.
//
// It used to allow anything ending in .ts.net, which quietly made Tailscale a
// dependency of the auth layer. Transport should be how you reach this server,
// not something it believes in.
//
// DESKPILOT_ORIGINS stays for anyone who wants a hard restriction on top.
const ORIGINS = (Deno.env.get("DESKPILOT_ORIGINS") ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

function originAllowed(origin: string | null): boolean {
  if (!origin) return true;                     // same-origin or non-browser
  if (!ORIGINS.length) return true;             // token does the real work
  return ORIGINS.includes(origin);
}

// The credential a device falls back on when localStorage is gone. It must be
// *that device's* credential and nothing else — see the rolling refresh below
// for what planting the shared token here cost.
//
// 400 days rather than 365: Chrome caps cookie lifetime at 400 and silently
// truncates anything longer, so this asks for exactly what the ceiling is.
const cookieFor = (tok: string) =>
  `dp=${tok}; Path=/; Max-Age=34560000; SameSite=Strict; HttpOnly`;

// Both credential kinds are hex, so anything else did not come from us.
const COOKIE_SAFE = /^[A-Za-z0-9._-]{1,256}$/;

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !originAllowed(origin)) return {};
  return {
    // Echoed, never "*", because "*" and a bearer token together would let any
    // page read a response if the token ever leaked into one.
    "access-control-allow-origin": origin,
    "vary": "origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  };
}

// tmux session names we created or will address. Anything with a shell
// metacharacter is refused rather than escaped — this value reaches tmux.
const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

// Named keys reachable from the phone. Enough to drive a TUI dialog — trust
// prompts, permission menus, pickers — without becoming a general escape into
// tmux's key syntax. Notably absent: anything that manipulates tmux itself.
const ALLOWED_KEYS = new Set([
  "Up", "Down", "Left", "Right",
  "Enter", "Escape", "Tab", "BTab", "Space", "BSpace",
  "Home", "End", "PageUp", "PageDown",
  "C-c", "C-d", "C-u", "C-l", "C-r", "C-w",
]);

// One clipboard's worth, not a file transfer: a paste is delivered to whatever
// is running in the pane, and handing a TUI a megabyte of text in one go is a
// way to wedge it rather than a feature. A named buffer keeps pastes from
// piling up on tmux's buffer stack.
const PASTE_MAX = 100_000;
const PASTE_BUFFER = "deskpilot";

// Tools whose worst case is reading something. These are the only requests the
// phone may approve with one tap: the notification shows what is being asked,
// but a lock-screen glance is not a review, so anything that writes, executes
// or leaves the machine has to be looked at in the app instead. Deliberately
// short — the cost of omitting a tool is one extra tap.
const SAFE_TO_APPROVE = new Set([
  "Read", "Grep", "Glob", "NotebookRead", "TodoWrite",
]);

// A notification outlives the thing it describes: it sits on the lock screen
// until dismissed, and `tag` keeps it there across new ones. Approving used to
// mean "send Enter to that session", which pressed whatever was on screen when
// the tap landed — a different prompt, or none. So each request gets an id and
// an expiry, and an approval that does not match what is pending now is
// refused rather than delivered to the wrong dialog.
const APPROVE_TTL_MS = 120_000;

// Declared here rather than beside the other state paths because the store
// below reads it at module load.
const AGENT_FILE = `${Deno.env.get("HOME")}/.local/state/deskpilot/agent-state.json`;
const devices = new Devices(
  `${Deno.env.get("HOME")}/.local/state/deskpilot/devices.json`,
);

const agentStates = new AgentStates(
  AGENT_FILE,
  (name) => SAFE_NAME.test(name),
  Number(Deno.env.get("DESKPILOT_WORKING_TTL_MS") ?? "1800000"),
);

const DIST = `${WEB}/dist`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

// Serves the built Svelte app. Paths are resolved and then checked to be
// inside DIST, so a crafted ../ cannot read outside it.
async function serveStatic(path: string): Promise<Response> {
  const rel = path === "/" ? "/index.html" : path;
  const full = `${DIST}${rel}`.split("/").reduce<string[]>((acc, part) => {
    if (part === "" || part === ".") return acc;
    if (part === "..") { acc.pop(); return acc; }
    acc.push(part);
    return acc;
  }, []).join("/");
  const abs = `/${full}`;
  if (!abs.startsWith(`${DIST}/`) && abs !== DIST) {
    return new Response("not found", { status: 404 });
  }

  try {
    const bytes = await Deno.readFile(abs);
    const ext = abs.slice(abs.lastIndexOf("."));
    const headers: Record<string, string> = {
      "content-type": MIME[ext] ?? "application/octet-stream",
    };
    // Hashed asset filenames are immutable; index.html must never be cached or
    // a rebuild leaves the phone on a stale bundle.
    headers["cache-control"] = abs.includes("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-store";
    return new Response(bytes, { headers });
  } catch {
    if (rel === "/index.html") {
      // The real path, not a guessed one — this repo does not have to live in
      // ~/Projects for anyone but its author, and an error message that names
      // the wrong directory is worse than one that names none.
      return new Response(
        `No built UI. Run:  cd ${WEB} && npm install && npm run build\n`,
        { status: 503, headers: { "content-type": "text/plain" } },
      );
    }
    return new Response("not found", { status: 404 });
  }
}

// The manifest names the installed app.
//
// `name` carries the machine, because every machine used to serve an identical
// manifest and three installs then put three home-screen icons called
// "deskpilot" on one phone with nothing to tell them apart — tapping the wrong
// one lands on the offline page and reads as an outage rather than as the wrong
// icon. Install prompts and Android's app-info screen both show `name`, so that
// case is still answered.
//
// `short_name` is the launcher label, and it went the same way — which meant
// the icon on a single-machine install said "omarchy" and the product name
// appeared nowhere on the phone at all. That trades the common case for the
// uncommon one: this app is built to be installed ONCE and switched between
// machines from the machines list, because the host keyring is per-origin and
// a second install is a second app that shares nothing with the first. Several
// installs are the fallback path, not the intended one.
//
// So the launcher says "deskpilot", and anyone who genuinely runs several
// installs sets DESKPILOT_APP_NAME per machine to tell them apart.
//
// iOS never took this route: it ignores the manifest and reads
// apple-mobile-web-app-title from index.html, which has always said deskpilot.
async function serveManifest(): Promise<Response> {
  const res = await serveStatic("/manifest.webmanifest");
  if (!res.ok) return res;
  try {
    const m = JSON.parse(await res.text());
    m.name = `deskpilot — ${NAME}`;
    m.short_name = APP_NAME;
    return new Response(JSON.stringify(m, null, 2), {
      headers: { "content-type": "application/manifest+json", "cache-control": "no-store" },
    });
  } catch {
    // Unparseable is not worth failing an install over; the static one names
    // the app correctly, it just names every machine the same.
    return await serveStatic("/manifest.webmanifest");
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Reaching the app directly on its port over plain HTTP, using the MagicDNS
  // name, means bypassing Tailscale Serve — and that origin is not a secure
  // context, so the app silently loses installability and looks "insecure".
  // It is an easy mistake: an old QR, a bookmark, a typed URL.
  //
  // Redirect that one case to HTTPS. Bare IPs and LAN addresses are left
  // alone: Serve only answers to the hostname (it routes on SNI), so
  // redirecting those would send someone somewhere that cannot serve them.
  const host = req.headers.get("host") ?? "";
  const m = host.match(/^([a-z0-9-]+\.[a-z0-9-]+\.ts\.net):\d+$/i);
  if (m) {
    return Response.redirect(`https://${m[1]}${path}${url.search}`, 308);
  }

  // ---- static UI (unauthenticated: it is just markup, the API is not) ----
  // HEAD as well as GET: browsers and install flows probe assets with HEAD, and
  // answering 404 to those made the manifest icons look missing even though GET
  // served them fine.
  if ((req.method === "GET" || req.method === "HEAD") && !path.startsWith("/api/")) {
    const res = path === "/manifest.webmanifest"
      ? await serveManifest()
      : await serveStatic(path);
    if (req.method === "HEAD") {
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return res;
  }

  if (!path.startsWith("/api/")) return new Response("not found", { status: 404 });

  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) return fail("origin not allowed", 403);
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // Enrollment happens before there is anything to authenticate with, so it
  // sits ahead of the auth check. The code is the credential: single-use, ten
  // minutes, and rate-limited so a short code cannot be ground down.
  if (req.method === "POST" && path === "/api/devices/enroll") {
    if (devices.rateLimited) {
      return json({ error: "too many attempts — wait a few minutes" }, 429);
    }
    const b = await req.json().catch(() => null);
    const code = String(b?.code ?? "");
    const name = String(b?.name ?? "device");
    if (!code) return fail("code required");
    const made = await devices.enroll(code, name);
    if (!made) return fail("that code is not valid, or has already been used", 403);
    console.log(`enrolled: ${made.device.name} (${made.device.id})`);
    // Carrying the new credential, or the next localStorage eviction drops this
    // device back onto whatever the cookie held — which used to be the shared
    // token, silently undoing the pairing that just happened.
    const res = json({ token: made.token, id: made.device.id, name: made.device.name });
    res.headers.append("set-cookie", cookieFor(made.token));
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }

  // ---- auth ----
  // Three sources, same secret. The cookie exists because iOS Safari evicts
  // localStorage after ~7 days of not visiting a site, which would re-prompt
  // for the token exactly when you are away from the desk and least able to
  // look it up. SameSite=Strict is what makes a cookie safe on an endpoint
  // that runs commands: a cross-site request simply will not carry it.
  const cookie = req.headers.get("cookie")
    ?.match(/(?:^|;\s*)dp=([^;]+)/)?.[1];
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ?? cookie ?? null;

  // Two credential kinds during the changeover. The shared token still works —
  // it is what every already-paired device holds, and breaking those to improve
  // credentials would be a strange way round. New pairings mint a device token,
  // which is the one that can be revoked on its own.
  let device = null;
  if (!tokenOk(given)) {
    device = given ? await devices.match(given) : null;
    if (!device) return fail("unauthorized", 401);
    devices.touch(device);
  }

  // Refreshed on every authenticated request, not just when it is missing.
  //
  // It used to be set once at pairing, so the year ran from that day and
  // expired on a fixed date however much the app was used — and the moment it
  // lapses is the moment you cannot re-pair, because re-pairing means running
  // pair.sh on the machine you are away from. A rolling window means the
  // credential only ages while you are not using it.
  //
  // Only on the session poll, not on every response. The app makes ~50 requests
  // a minute, and re-emitting the token in a header that often is needless
  // repetition of the one value here worth protecting. /api/sessions is polled
  // for as long as the app is open, which is the same liveness signal at a
  // fraction of the exposure.
  //
  // The cookie carries whatever credential just authenticated — NOT the
  // machine's shared token, which is what it used to carry unconditionally.
  //
  // That was a hole straight through the per-device work. Every device, one
  // that had just enrolled with its own credential included, was handed the
  // master key and had it refreshed for 400 days. So revoking a lost phone did
  // not cut it off: measured, its own token answered 401 afterwards and its
  // cookie alone answered 200. `given` is the raw value the caller presented
  // and it has already been checked, so re-emitting it plants exactly the
  // credential that can be taken away again.
  //
  // Devices that already hold their own token heal on their next session poll.
  const rolling = !cookie || path === "/api/sessions";
  const setCookie = rolling && given && COOKIE_SAFE.test(given)
    ? cookieFor(given)
    : undefined;
  const withCookie = (r: Response) => {
    if (setCookie) r.headers.append("set-cookie", setCookie);
    for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
    return r;
  };

  // What this host can actually do. A phone holding several machines cannot
  // assume they are alike — one may be a desktop, the next a headless box with
  // no compositor at all — so it asks rather than guessing, and hides what is
  // absent instead of offering controls that will fail.
  // Whether agents started at the desk will show up here at all. Without the
  // shell hook, typing `claude` in a terminal starts it outside tmux, where
  // nothing can reach it — and the failure is silent: the app just looks empty.
  // Someone who declined the prompt at install has no way to connect those two
  // facts weeks later, so the app has to be able to say it.
  //
  // Checked across shells rather than bash alone, since the hook being
  // bash-only is itself a reason someone would not have it.
  function shellHookInstalled(): boolean {
    const home = Deno.env.get("HOME") ?? "";
    const files = [
      `${home}/.bashrc`, `${home}/.zshrc`, `${home}/.profile`,
      `${home}/.config/fish/config.fish`,
    ];
    for (const f of files) {
      try {
        if (Deno.readTextFileSync(f).includes("deskpilot/shell/claude-tmux.sh")) {
          return true;
        }
      } catch { /* not there */ }
    }
    return false;
  }

  if (req.method === "GET" && path === "/api/capabilities") {
    const r = await run(`${scriptsDir()}/desk.sh`, ["capabilities"]);
    let caps = {
      windows: false, screenshot: false, input: false,
      lock: "unknown", compositor: "none",
    };
    try { caps = { ...caps, ...JSON.parse(r.out) }; } catch { /* keep defaults */ }
    return withCookie(json({
      name: NAME,
      terminal: true,       // the one thing every host has
      sessions: true,
      shellHook: shellHookInstalled(),
      version: BUILD,
      // `input` says ydotool works; `unlock` says it is allowed to be used.
      unlock: UNLOCK_ENABLED && caps.input,
      repo: ROOT,
      ...caps,
    }));
  }

  // ---- devices ----
  if (req.method === "GET" && path === "/api/devices") {
    // Never the hash: it is not a working credential, but there is no reason
    // for it to leave the machine either.
    return withCookie(json({
      devices: devices.list.map(({ id, name, created, lastSeen }) => ({
        id, name, created, lastSeen,
        current: device?.id === id,
      })),
      // An already-paired device on the old shared token has nothing to revoke,
      // and the UI should say so rather than showing an empty list.
      legacy: !device,
    }));
  }

  if (req.method === "POST" && path === "/api/devices/code") {
    return withCookie(json({ code: devices.newCode(), expiresInSec: 600 }));
  }

  if (req.method === "POST" && path === "/api/devices/revoke") {
    const b = await req.json().catch(() => null);
    const id = String(b?.id ?? "");
    if (!devices.revoke(id)) return fail("no such device", 404);
    console.log(`revoked: ${id}`);
    return withCookie(json({ ok: true, self: device?.id === id }));
  }

  if (req.method === "POST" && path === "/api/devices/rename") {
    const b = await req.json().catch(() => null);
    if (!devices.rename(String(b?.id ?? ""), String(b?.name ?? ""))) {
      return fail("no such device", 404);
    }
    return withCookie(json({ ok: true }));
  }

  // ---- sessions ----
  if (req.method === "GET" && path === "/api/sessions") {
    // In-process rather than shelling out to sessions.sh: that script needed jq,
    // which was the last dependency in the portable half — a headless box with
    // no compositor still had to install a JSON processor to list its own
    // sessions. Verified byte-identical to the shell version against live
    // sessions before it was swapped in.
    const list = await listSessions();
    const merged = list.map((x) => {
      const w = watched.get(String(x.session));
      const activity = !w?.seenMovement ? "unknown" : Date.now() - w.changed < 6_000 ? "active" : "quiet";
      return { ...x, ...agentStates.view(String(x.session)), activity, activitySince: w?.changed ?? 0 };
    });
    return withCookie(json(merged));
  }

  if (req.method === "GET" && path === "/api/capture") {
    const s = url.searchParams.get("session") ?? "";
    if (!SAFE_NAME.test(s)) return fail("bad session name");
    // -J joins wrapped lines: a phone re-wraps text itself, and without this a
    // long paragraph arrives pre-broken at the terminal's width and reads as
    // truncated. 200 lines because agent replies routinely exceed 40 and the
    // client scrolls anyway — it is text, so the cost is trivial.
    const lines = url.searchParams.get("lines") ?? "200";
    const r = await run("tmux",
      ["capture-pane", "-p", "-J", "-t", s, "-S", `-${Number(lines) || 200}`]);
    if (r.code !== 0) return fail(r.err || "no such session", 404);

    return withCookie(json({ session: s, text: normalizeCapture(r.out) }));
  }

  // Subscription limits, read straight off disk. omarchy-agent-usage-update
  // already maintains these records on its own timer, so there is no collector
  // to run and no API to authenticate against here — this endpoint only
  // forwards what is already there, and stays ignorant of which agents exist
  // by returning whatever records it finds.
  if (req.method === "GET" && path === "/api/usage") {
    const dir = `${Deno.env.get("HOME")}/.local/state/omarchy/agents/usage`;
    const out: unknown[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || !e.name.endsWith(".json")) continue;
        try {
          const r = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`));
          // Only the fields the meter draws. The records also carry per-model
          // token counts and week-long histories, which would be a lot of JSON
          // to send a phone for a number it is not going to show.
          out.push({
            id: r.id,
            name: r.name,
            tierLabel: r.tierLabel ?? "",
            updatedAt: r.updatedAt ?? null,
            limits: Array.isArray(r.limits) ? r.limits : [],
          });
        } catch { /* a half-written record is skipped, not fatal */ }
      }
    } catch { /* no records yet: an empty list is the honest answer */ }
    return withCookie(json(out));
  }

  // An agent announcing its own state, which is the only way to know it
  // reliably. Stillness cannot tell "blocked on a dialog" from "mid tool call"
  // — both hold the screen — and matching the text of a dialog only works
  // until the next agent words it differently. So the agent says so itself,
  // through whatever hook it provides, and nothing here knows which agent that
  // was: this endpoint receives "something happened", not "Claude did X".
  if (req.method === "POST" && path === "/api/event") {
    const b = await req.json().catch(() => null);
    const s = String(b?.session ?? "");
    if (!SAFE_NAME.test(s)) return fail("bad session name");
    const title = String(b?.title ?? s).slice(0, 120);
    const body = String(b?.body ?? "").slice(0, 300);
    const versioned = b?.version === 1;
    const kind = String(versioned ? b?.state : b?.kind ?? "event");
    if (versioned && !isLifecycle(kind)) return fail("bad lifecycle state");
    const reason = versioned && b?.reason && typeof b.reason === "object" ? b.reason : b;
    const tool = String(reason?.tool ?? "").slice(0, 64);
    const reqid = String(reason?.requestId ?? reason?.reqid ?? "").slice(0, 64);
    // What is actually being asked, as its own field rather than folded into
    // prose. "Bash" is not something you can answer; "Bash: rm -rf ~" is.
    const detail = String(reason?.detail ?? "").slice(0, 200);
    const canApprove = kind === "blocked" && !!reqid && SAFE_TO_APPROVE.has(tool);
    let accepted = true;
    if (isLifecycle(kind)) {
      const report: LifecycleReport = {
        state: kind,
        source: versioned ? String(b?.source ?? "").slice(0, 64) : "legacy-hook",
        sourceSession: versioned ? String(b?.sourceSession ?? "").slice(0, 128) || undefined : undefined,
        agent: versioned ? String(b?.agent ?? "").slice(0, 64) || undefined : undefined,
        observedAt: versioned ? Number(b?.observedAt) : Date.now(),
        tool, detail, requestId: reqid, canApprove,
      };
      accepted = agentStates.report(s, report);
      if (!accepted && versioned) {
        const invalid = !report.source || !Number.isFinite(report.observedAt) || report.observedAt <= 0 || report.observedAt > Date.now() + 60_000;
        if (invalid) return fail("bad lifecycle report");
      }
    }

    // A delayed asynchronous hook may arrive after a newer lifecycle event.
    // It is acknowledged so the agent never waits, but it must not rewind the
    // state, pending approval, fallback watcher, or notification stream.
    if (!accepted) return withCookie(json({ ok: true, accepted: false }));

    // Keep the stillness fallback in step with what the agent just said about
    // itself. A stop is announced, so the fallback must not follow up a minute
    // later about the same one — but a turn *starting* is the opposite: the
    // session is now busy and its next stop has not been announced at all.
    const w = watched.get(s);
    if (w) {
      if (kind === "working") { w.busy = true; w.notified = false; }
      else { w.notified = true; w.busy = false; }
    }

    console.log(`event: ${s} ${kind}${tool ? ` ${tool}` : ""}${canApprove ? " (approvable)" : ""}`);
    // A turn starting is state, not news. Pushing it would notify on every
    // prompt, which trains you to ignore the notifications that matter.
    if (kind !== "working") {
      // The id only travels to the phone when the request is one the phone is
      // allowed to answer; otherwise there is nothing there to tap.
      await notify({ title, body, session: s, kind, canApprove, reqid: canApprove ? reqid : "" });
    }
    return withCookie(json({ ok: true, accepted: true }));
  }

  // ---- push ----
  // The public key is what the browser needs to build a subscription, and it
  // is public by definition, but it still sits behind auth like everything
  // else under /api so the surface stays uniform.
  if (req.method === "GET" && path === "/api/push/key") {
    return withCookie(json({ key: (await loadVapid(VAPID_FILE)).publicKey }));
  }

  if (req.method === "POST" && path === "/api/push/subscribe") {
    const b = await req.json().catch(() => null);
    if (!b?.endpoint || !b?.keys?.p256dh || !b?.keys?.auth) {
      return fail("bad subscription");
    }
    const subs = await loadSubs();
    // Re-subscribing is normal: browsers rotate the endpoint on their own
    // schedule, and the app re-registers on every load.
    const next = subs.filter((s) => s.endpoint !== b.endpoint);
    next.push({ endpoint: b.endpoint, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth } });
    await saveSubs(next);
    return withCookie(json({ ok: true, devices: next.length }));
  }

  if (req.method === "POST" && path === "/api/push/unsubscribe") {
    const b = await req.json().catch(() => null);
    const subs = await loadSubs();
    const next = subs.filter((s) => s.endpoint !== b?.endpoint);
    await saveSubs(next);
    return withCookie(json({ ok: true, devices: next.length }));
  }

  if (req.method === "POST" && path === "/api/push/test") {
    const subs = await loadSubs();
    if (!subs.length) return fail("no devices subscribed");
    await notify({ title: "deskpilot", body: "Notifications are working.", session: "" });
    return withCookie(json({ ok: true, devices: subs.length }));
  }

  // Answering a specific permission request, as opposed to /api/send, which
  // types at whatever is there. Every reason to refuse below is a case where
  // Enter would have gone somewhere other than the dialog that woke you up.
  if (req.method === "POST" && path === "/api/approve") {
    const b = await req.json().catch(() => null);
    const s = String(b?.session ?? "");
    if (!SAFE_NAME.test(s)) return fail("bad session name");
    const reqid = String(b?.reqid ?? "");

    // Consumed first: a retry must not be able to press Enter a second time.
    // The lifecycle becomes working immediately instead of showing a blocked
    // request that this endpoint has already answered.
    const approval = agentStates.approve(s, reqid, APPROVE_TTL_MS);
    if (approval === "missing") return fail("no longer pending", 409);
    if (approval === "forbidden") return fail("must be reviewed in the app", 409);
    if (approval === "expired") return fail("expired", 409);
    const r = await run("tmux", ["send-keys", "-t", s, "Enter"]);
    if (r.code !== 0) return fail(r.err || "send failed", 500);
    return withCookie(json({ ok: true, session: s }));
  }

  // Two modes, deliberately separate:
  //   { text }  literal typing, sent with -l so it can never be interpreted
  //   { keys }  named keys from a fixed allowlist, for driving TUI dialogs
  // Text can never become a key and a key can never be arbitrary — which is
  // the whole point, since both end up as arguments to tmux send-keys.
  if (req.method === "POST" && path === "/api/send") {
    const body = await req.json().catch(() => null);
    const s = body?.session ?? "";
    if (!SAFE_NAME.test(s)) return fail("bad session name");

    if (Array.isArray(body?.keys)) {
      const bad = body.keys.filter((k: unknown) => !ALLOWED_KEYS.has(String(k)));
      if (bad.length) return fail(`key not allowed: ${bad.join(", ")}`);
      if (!body.keys.length) return fail("no keys");
      const r = await run("tmux", ["send-keys", "-t", s, ...body.keys.map(String)]);
      if (r.code !== 0) return fail(r.err || "send failed", 500);
      return withCookie(json({ ok: true, session: s, keys: body.keys }));
    }

    const text = body?.text ?? "";
    if (typeof text !== "string" || !text.length) return fail("empty text");
    const lit = await run("tmux", ["send-keys", "-t", s, "-l", text]);
    if (lit.code !== 0) return fail(lit.err || "send failed", 500);
    if (body?.enter !== false) await run("tmux", ["send-keys", "-t", s, "Enter"]);
    return withCookie(json({ ok: true, session: s }));
  }

  // Paste, which is not the same thing as typing.
  //
  // /api/send types text as keystrokes, which is right for a line composed on
  // the phone and wrong for a block off the clipboard: every newline in it is
  // an Enter, so a thirty-line snippet arrives as thirty submitted prompts.
  //
  // tmux's own buffer is the way round that. `load-buffer -` takes the text on
  // stdin, so nothing is ever quoted into a command line — the same reason
  // keystrokes travel as hex — and `paste-buffer -p` wraps it in bracketed-paste
  // markers *if the application has asked for them*, which is how a TUI tells a
  // paste from typing. Nothing here knows or asks which application that is.
  //
  // Nothing is sent afterwards: a paste lands in whatever is composing on the
  // far end, unsubmitted, so it can be added to before it goes.
  if (req.method === "POST" && path === "/api/paste") {
    const body = await req.json().catch(() => null);
    const s = String(body?.session ?? "");
    if (!SAFE_NAME.test(s)) return fail("bad session name");
    const text = body?.text;
    if (typeof text !== "string" || !text.length) return fail("empty text");
    if (text.length > PASTE_MAX) {
      return fail(`too much text — ${PASTE_MAX} characters at a time`, 413);
    }

    const child = new Deno.Command("tmux", {
      args: ["load-buffer", "-b", PASTE_BUFFER, "-"],
      stdin: "piped", stdout: "null", stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(text));
    await w.close();
    const loaded = await child.output();
    if (loaded.code !== 0) {
      const msg = new TextDecoder().decode(loaded.stderr).trim();
      return withCookie(fail(msg || "could not load the paste buffer", 500));
    }

    // -d drops the buffer as it is pasted. It holds somebody's clipboard, and
    // there is no reason for that to sit in tmux until the next paste replaces
    // it — where `showb` would print it, and a later `prefix ]` would paste it
    // somewhere nobody asked for.
    const r = await run("tmux",
      ["paste-buffer", "-p", "-d", "-b", PASTE_BUFFER, "-t", s]);
    if (r.code !== 0) {
      await run("tmux", ["delete-buffer", "-b", PASTE_BUFFER]);
      return withCookie(fail(r.err || "no such session", 404));
    }
    return withCookie(json({ ok: true, session: s, chars: text.length }));
  }

  // Create a session. With `workspace`, a real terminal is placed there so it
  // is waiting on the right screen when you sit down. Without, it is detached.
  if (req.method === "POST" && path === "/api/sessions") {
    const body = await req.json().catch(() => null);
    const name = body?.name ?? "";
    const cwd = body?.path ?? Deno.env.get("HOME")!;
    const cmd = body?.command ?? "";
    const ws = body?.workspace;
    if (!SAFE_NAME.test(name)) return fail("bad session name");

    // Launched through a login shell, so a session started from the phone runs
    // exactly what the same command would run at the desk.
    //
    // It did not, and the difference bit. This service inherits systemd's
    // environment, which has mise's *shims* on PATH but not the resolved tool
    // directories an interactive shell gets from `mise activate`. So `claude`
    // from the phone resolved to a shim — mise itself — which re-resolves the
    // tool on every launch, with the network and its own warnings in the way,
    // where the desk got the installed binary directly. Same word, two
    // different programs, and the slower one only ever ran when you were not
    // there to watch it.
    //
    // Nothing here is specific to one agent or one version manager: the point
    // is to inherit the user's own environment rather than reproduce a guess at
    // it. Anything they can start by typing, deskpilot can start the same way.
    //
    // `exec "$0" "$@"` keeps the no-quoting-hazard property of the old argv
    // form — the command and its arguments stay separate words and are never
    // reparsed by the shell. Note that Deno's --allow-run allowlist does NOT
    // constrain this: tmux execs whatever it is handed. That is inherent to an
    // app whose purpose is running terminals, and no worse than send-keys.
    const args = ["new-session", "-d", "-s", name, "-c", cwd];
    const parts = String(cmd).split(/\s+/).filter(Boolean);
    if (parts.length) {
      const shell = Deno.env.get("SHELL") || "/bin/bash";
      args.push("--", shell, "-lc", 'exec "$0" "$@"', ...parts);
    }
    const r = await run("tmux", args);
    if (r.code !== 0) return fail(r.err || "could not create session", 500);

    // This box has detach-on-destroy off globally, so killing a session hands
    // its clients to another session instead of closing them — a terminal
    // silently becomes a second view of unrelated work. Set it per-session so
    // deskpilot sessions close cleanly, without touching the global config.
    await run("tmux", ["set-option", "-t", name, "detach-on-destroy", "on"]);

    if (ws != null) {
      const term = Deno.env.get("DESKPILOT_TERMINAL") ?? "alacritty";
      await run(`${scriptsDir()}/desk.sh`, ["place", String(ws), term, "-e", "tmux", "attach", "-t", name]);
    }
    return withCookie(json({ ok: true, session: name, workspace: ws ?? null }));
  }

  // Candidate working directories for a new session. One level deep under a
  // few roots — enough to pick a project on a phone, not a file browser.
  if (req.method === "GET" && path === "/api/dirs") {
    const home = Deno.env.get("HOME")!;
    const roots = (Deno.env.get("DESKPILOT_DIRS") ?? `${home}/Projects`)
      .split(":").filter(Boolean);
    const out: string[] = [home];
    for (const root of roots) {
      try {
        for await (const e of Deno.readDir(root)) {
          if (e.isDirectory && !e.name.startsWith(".")) out.push(`${root}/${e.name}`);
        }
      } catch { /* a configured root that does not exist is not an error */ }
    }
    return withCookie(json(out.sort()));
  }

  // Kill a session outright. Separate from closing its window, which only
  // detaches — that distinction is tmux's whole point, but it means orphaned
  // sessions need an explicit way to die or they accumulate invisibly.
  // A session is named after the directory it started in, which is a decent
  // default and often not what you want to read on a phone — "deskpilot" says
  // where, not what. Renaming is tmux's own operation; the work here is that
  // everything keyed by the name has to move with it.
  if (req.method === "POST" && path === "/api/sessions/rename") {
    const body = await req.json().catch(() => null);
    const from = String(body?.session ?? "");
    const to = String(body?.name ?? "").trim();
    if (!SAFE_NAME.test(from)) return fail("bad session name");
    if (!SAFE_NAME.test(to)) {
      return fail("names may use letters, numbers, dot, dash and underscore");
    }
    if (from === to) return withCookie(json({ ok: true, name: to }));

    // tmux would happily merge two sessions' clients if the target existed.
    const exists = await run("tmux", ["has-session", "-t", to]);
    if (exists.code === 0) return fail(`there is already a session called ${to}`, 409);

    const r = await run("tmux", ["rename-session", "-t", from, to]);
    if (r.code !== 0) return fail(r.err || "no such session", 404);

    // Carry the state across, or a renamed session forgets it was blocked —
    // which is the one thing the console exists to remember.
    agentStates.rename(from, to);
    const w = watched.get(from);
    if (w) { watched.delete(from); watched.set(to, w); }

    console.log(`rename: ${from} -> ${to}`);
    return withCookie(json({ ok: true, name: to }));
  }

  if (req.method === "POST" && path === "/api/sessions/kill") {
    const body = await req.json().catch(() => null);
    const name = body?.session ?? "";
    if (!SAFE_NAME.test(name)) return fail("bad session name");
    // Set this on the TARGET immediately before killing, not just on sessions
    // we created. With detach-on-destroy off — the global default on this box —
    // killing a session hands its clients to another session instead of closing
    // them. The terminal stays open showing unrelated work and the session list
    // never empties, which reads as "kill does nothing".
    await run("tmux", ["set-option", "-t", name, "detach-on-destroy", "on"]);
    const r = await run("tmux", ["kill-session", "-t", name]);
    if (r.code !== 0) return fail(r.err || "no such session", 404);
    agentStates.remove(name);
    return withCookie(json({ ok: true, killed: name }));
  }

  // Give an existing (usually detached) session a window on a workspace.
  if (req.method === "POST" && path === "/api/sessions/attach") {
    const body = await req.json().catch(() => null);
    const name = body?.session ?? "";
    const ws = body?.workspace;
    if (!SAFE_NAME.test(name)) return fail("bad session name");
    if (ws == null) return fail("workspace required");
    const exists = await run("tmux", ["has-session", "-t", name]);
    if (exists.code !== 0) return fail("no such session", 404);
    const term = Deno.env.get("DESKPILOT_TERMINAL") ?? "alacritty";
    const r = await run(`${scriptsDir()}/desk.sh`,
      ["place", String(ws), term, "-e", "tmux", "attach", "-t", name]);
    if (r.code !== 0) return fail(r.err || "place failed", 500);
    return withCookie(json({ ok: true, session: name, workspace: ws }));
  }

  // The only input capability exposed over HTTP. Everything else — type, key,
  // click — stays in scripts/ where only an agent you are talking to can reach
  // it. Unlock earns the exception because it is narrow, has one target, and is
  // useless without the password.
  //
  // The password is piped to the script on stdin, never passed as an argument
  // (/proc/*/cmdline is world-readable), never written to disk, and never
  // echoed back in a response or a log line.
  if (req.method === "POST" && path === "/api/unlock") {
    if (!UNLOCK_ENABLED) {
      return withCookie(fail(
        "remote unlock is off — set DESKPILOT_UNLOCK=1 to enable it", 403,
      ));
    }
    const waitFor = unlockLockedOut();
    if (waitFor) {
      return withCookie(json(
        { error: `too many attempts — try again in ${Math.ceil(waitFor / 60)} min` },
        429,
      ));
    }
    const body = await req.json().catch(() => null);
    const pw = body?.password;
    if (typeof pw !== "string" || !pw.length) return fail("password required");

    const child = new Deno.Command(`${scriptsDir()}/desk.sh`, {
      args: ["unlock"],
      stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(pw));
    await w.close();
    const { code, stderr } = await child.output();

    if (code !== 0) {
      // Counted only when the password was actually rejected. Refusing because
      // the screen was never locked is not a guess, and holding it against the
      // caller would let an unrelated mistake lock out a real unlock.
      const msg = new TextDecoder().decode(stderr).trim();
      if (/rejected|still locked/i.test(msg)) unlockFails.push(Date.now());
      return withCookie(fail(msg || "unlock failed", 409));
    }
    unlockFails.length = 0;
    return withCookie(json({ ok: true, locked: false }));
  }

  // A real terminal, rather than scraping capture-pane and re-flowing it.
  //
  // The whole class of wrapping and alignment problems comes from rendering a
  // 130-column pane on a 50-column screen. Attaching tmux through a PTY sized
  // to the phone makes the program lay out for the phone instead — it wraps its
  // own prose, draws its own boxes to fit, and emits ANSI the browser renders.
  //
  // Deno has no PTY, so `script` provides one; `stty` sets its size before tmux
  // attaches. tmux's window-size is `latest`, so the phone attaching resizes the
  // shared window — which is fine, because if you are on the phone you are not
  // looking at the monitor, and it snaps back when the desk client resizes.
  if (req.method === "GET" && path === "/api/term") {
    const name = url.searchParams.get("session") ?? "";
    if (!SAFE_NAME.test(name)) return fail("bad session name");
    const cols = Math.min(400, Math.max(20, Number(url.searchParams.get("cols")) || 80));
    const rows = Math.min(200, Math.max(10, Number(url.searchParams.get("rows")) || 24));

    // A WebSocket upgrade gets no preflight, but it does carry the token in the
    // query string and that has already been checked above — so by this point
    // the caller has proved it holds the secret, whatever origin it claims.
    if (!originAllowed(req.headers.get("origin"))) return fail("origin not allowed", 403);

    let socket: WebSocket, response: Response;
    try {
      // Every connection holds a tmux client, so a peer that goes away without
      // closing — a tab discarded, a phone that lost signal — must not pin one
      // open forever. Deno pings and closes if no pong comes back, which lands
      // in onclose below and reaps the child. A browser answers pings by
      // itself, so an idle-but-live terminal is unaffected.
      ({ socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 }));
    } catch {
      return fail("expected a websocket", 400);
    }

    let closed = false;
    let active = "";                 // pane id whose output this client renders
    let hold: string[] | null = [];  // output buffered until history is sent

    const say = (msg: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    const ctl = new ControlClient(name, {
      output: (pane, data) => {
        // Splits are rare here and a phone shows one pane, so only the active
        // one is rendered. Everything else is still running; it is just not
        // what this screen is looking at.
        if (active && pane !== active) return;
        if (hold) hold.push(data);
        else say({ t: "o", d: data });
      },
      exit: (reason) => { say({ t: "end", d: reason }); shutdown(); },
    });
    liveChildren.add(ctl.child);

    function shutdown() {
      if (closed) return;
      closed = true;
      ctl.close().finally(() => liveChildren.delete(ctl.child));
      try { socket.close(); } catch { /* already closed */ }
    }

    // Size first, then find the pane, then prime the scrollback. Output that
    // arrives in the meantime is held rather than dropped, so nothing is lost
    // between attaching and the history landing.
    (async () => {
      try {
        await ctl.send(`refresh-client -C ${cols}x${rows}`);
        active = (await ctl.send(`display -p -t ${name} '#{pane_id}'`))[0] ?? "";
        // -J unwraps lines the desk terminal wrapped at its own width, so the
        // phone re-wraps them at its own rather than inheriting 130 columns.
        const hist = await ctl.send(`capture-pane -p -e -J -S -1000 -t ${name}`);
        say({ t: "hist", d: hist.join("\r\n") + "\r\n" });
        const held = hold ?? [];
        hold = null;
        for (const d of held) say({ t: "o", d });
      } catch {
        hold = null;
        shutdown();
      }
    })();

    socket.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let m: { t?: string; d?: string; c?: number; r?: number };
      try { m = JSON.parse(e.data); } catch { return; }

      if (m.t === "i" && typeof m.d === "string" && m.d.length) {
        for (const c of keysCommand(name, m.d)) ctl.send(c).catch(shutdown);
      } else if (m.t === "r") {
        // The whole point of control mode: a resize is a request, not a
        // reconnect.
        const c = Math.min(400, Math.max(20, Number(m.c) || cols));
        const r = Math.min(200, Math.max(10, Number(m.r) || rows));
        ctl.send(`refresh-client -C ${c}x${r}`).catch(shutdown);
      } else if (m.t === "hist") {
        (async () => {
          try {
            const h = await ctl.send(`capture-pane -p -e -J -S -1000 -t ${name}`);
            say({ t: "hist", d: h.join("\r\n") + "\r\n" });
          } catch { /* gone */ }
        })();
      }
    };
    socket.onclose = shutdown;
    socket.onerror = shutdown;

    return response;
  }

  // ---- desktop ----
  // An empty list, not an error: a host with no compositor has no windows,
  // which is a true answer rather than a failure. The UI already hides window
  // controls when capabilities say windows: false.
  if (req.method === "GET" && path === "/api/desk/state") {
    const ws = url.searchParams.get("ws") ?? "";
    const r = await run(`${scriptsDir()}/desk.sh`, ["json", ws]);
    // 127 is "no desk.sh here", which is a headless host answering honestly.
    if (r.code === 127) return withCookie(json([]));
    if (r.code !== 0) return fail(r.err || "desk.sh failed", 500);
    return withCookie(new Response(r.out, {
      headers: { "content-type": "application/json", ...NO_STORE },
    }));
  }

  if (req.method === "GET" && path === "/api/desk/locked") {
    // desk.sh answers locked / unlocked / unknown. Anything that is not a
    // definite "unlocked" is reported as locked, so an undetermined state
    // makes the UI hide the screenshot controls rather than offer a capture
    // that desk.sh is going to refuse anyway.
    const r = await run(`${scriptsDir()}/desk.sh`, ["locked"]);
    const state = r.out.trim();
    return withCookie(json({ locked: state !== "unlocked", state }));
  }

  if (req.method === "GET" && path === "/api/desk/shot") {
    const addr = url.searchParams.get("address");
    const out = `/tmp/deskpilot-shot-${Date.now()}.jpg`;
    const r = addr
      ? await run(`${scriptsDir()}/desk.sh`, ["shot-window", addr, out])
      : await run(`${scriptsDir()}/desk.sh`, ["shot", out, url.searchParams.get("ws") ?? ""]);
    if (r.code !== 0) return fail(r.err.trim() || "capture failed", 409);
    const bytes = await Deno.readFile(out);
    await Deno.remove(out).catch(() => {});
    return withCookie(new Response(bytes, {
      headers: { "content-type": "image/jpeg", ...NO_STORE },
    }));
  }

  if (req.method === "POST" && path === "/api/desk/move") {
    const b = await req.json().catch(() => null);
    if (!b?.address || b?.workspace == null) return fail("address and workspace required");
    const r = await run(`${scriptsDir()}/desk.sh`, ["move", b.address, String(b.workspace)]);
    return withCookie(r.code === 0 ? json({ ok: true }) : fail(r.err || "move failed", 500));
  }

  if (req.method === "POST" && path === "/api/desk/tile") {
    const b = await req.json().catch(() => null);
    if (!b?.address) return fail("address required");
    const r = await run(`${scriptsDir()}/desk.sh`, ["tile", b.address]);
    return withCookie(r.code === 0 ? json({ ok: true }) : fail(r.err || "tile failed", 500));
  }

  return withCookie(fail("not found", 404));
}

// ---- orderly shutdown ----
//
// KillMode=process is not optional: the tmux server is a child of this unit, so
// killing the control group would take every session with it. The cost is that
// every OTHER child also survives this process's death — including a `script`
// holding a tmux client, which then stays attached to a session forever and
// shows up as a second view of a window nobody opened. Observed after a service
// restart: one client still attached 9.5 hours later, at the phone's 54x48,
// which also quietly constrains the shared window size for the desk.
//
// The per-connection cleanup cannot help, because a signalled process never
// reaches it. So the children are tracked and killed here instead. SIGKILL
// rather than SIGTERM: `script` does not forward signals to the client in its
// pty, but closing the pty master does end it — verified by killing a leaked
// one and watching the client disappear.
const liveChildren = new Set<Deno.ChildProcess>();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, () => {
    for (const child of liveChildren) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    }
    Deno.exit(0);
  });
}

// ---- session watcher ----
//
// One poll over every session, existing solely to notice when a session stops
// producing output. That transition is the whole basis of the notification: the
// phone cannot poll while it is asleep in a pocket, so the desktop has to be
// the one that speaks first.
//
// Nothing here parses the output. It only notices that the screen moved, which
// is what keeps this agent-agnostic.

const STATE_DIR = `${Deno.env.get("HOME")}/.local/state/deskpilot`;
const VAPID_FILE = `${STATE_DIR}/vapid.json`;
const SUBS_FILE = `${STATE_DIR}/subscriptions.json`;

// Push services want a way to contact whoever is sending. Nothing reads it
// here, but a malformed one is rejected by some services, so it stays a URI.
const VAPID_SUBJECT = Deno.env.get("DESKPILOT_VAPID_SUBJECT") ??
  "mailto:deskpilot@localhost";

// The keypair is written on first use, so the directory has to exist before
// anything asks for it — subscribing can be the first thing that ever
// touches this directory.
await Deno.mkdir(STATE_DIR, { recursive: true }).catch(() => {});

async function loadSubs(): Promise<Subscription[]> {
  try {
    return JSON.parse(await Deno.readTextFile(SUBS_FILE)) as Subscription[];
  } catch {
    return [];
  }
}

async function saveSubs(list: Subscription[]) {
  await Deno.writeTextFile(SUBS_FILE, JSON.stringify(list, null, 2));
}

// Fan a notification out to every registered device, forgetting the ones the
// push service reports as dead. A phone that reinstalls the app or revokes
// permission leaves a subscription behind that will 410 forever otherwise.
async function notify(payload: Record<string, unknown>) {
  const subs = await loadSubs();
  if (!subs.length) return;
  const v = await loadVapid(VAPID_FILE);
  const keep: Subscription[] = [];
  for (const sub of subs) {
    try {
      const r = await sendPush(v, sub, payload, VAPID_SUBJECT);
      if (r.gone) console.log("push: subscription gone, dropping");
      else {
        keep.push(sub);
        if (!r.ok) console.error(`push: ${r.status} from ${new URL(sub.endpoint).host}`);
      }
    } catch (e) {
      keep.push(sub);   // a transport error is not evidence the device is gone
      console.error("push:", (e as Error)?.message ?? e);
    }
  }
  if (keep.length !== subs.length) await saveSubs(keep);
}

const POLL_MS = Number(Deno.env.get("DESKPILOT_POLL_MS") ?? "3000");

type Watched = {
  prev: string[];    // the previous capture, to diff the next one against
  changed: number;   // when the screen last differed at all — the idle signal
  busy: boolean;     // has produced output that has not yet been settled for
  notified: boolean; // already announced this particular stop
  seenMovement: boolean;
};

// How long a session has to hold still before it counts as waiting rather than
// thinking. An agent pauses constantly — between tool calls, while a model
// streams — so this has to be well clear of that, or the phone announces a run
// that has not finished.
//
// 25s was not clear of it. A long tool call can hold the screen still for most
// of a minute while the work continues, which read as "waiting" and notified
// early. Raised, and made configurable, because the right value depends on the
// work: a session running builds sits still far longer than one writing prose.
const IDLE_MS = Number(Deno.env.get("DESKPILOT_IDLE_MS") ?? "60000");

// How many changed lines count as work rather than noise.
const SUBSTANTIVE = 2;


// The most recent line with something on it, which is nearly always the thing
// being waited on: a prompt, a question, a permission dialog. Chrome rules are
// skipped so the notification does not read as a row of box characters.
function lastMeaningful(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l && !RULE.test(l)) return l.slice(0, 120);
  }
  return "waiting";
}

const watched = new Map<string, Watched>();

async function tick() {
  const ls = await run("tmux",
    ["list-sessions", "-F", "#{session_name} #{session_attached}"]);
  if (ls.code !== 0) return;                    // no tmux server yet
  const rows = ls.out.split("\n").map((l) => l.trim().split(/\s+/))
    .filter(([n]) => SAFE_NAME.test(n));
  const live = rows.map(([n]) => n);

  // Sessions that no longer exist stop being anything.
  agentStates.prune(live);

  for (const [s, attachedCount] of rows) {
    // A session with a client attached is on a screen in front of you, so a
    // push tells you nothing you cannot already see. This is what stopped the
    // desk-side sessions from announcing themselves all evening.
    const attached = Number(attachedCount) > 0;
    // The VISIBLE pane only — deliberately no -S. On the alternate screen tmux
    // records nothing above the screen, so a scrollback request also returns
    // whatever sat in the normal buffer before the TUI started: a block of
    // stale shell history that never changes again. Measured on a live
    // session, 146 such lines, frozen, above 57 that actually move. Including
    // them would bury the change this is looking for in constant sameness.
    const cap = await run("tmux", ["capture-pane", "-p", "-J", "-t", s]);
    if (cap.code !== 0) continue;
    const curr = normalizeCapture(cap.out).split("\n");

    const w = watched.get(s);
    if (!w) {
      watched.set(s, {
        prev: curr, changed: Date.now(),
        busy: false, notified: true, seenMovement: false,
      });
      continue;
    }

    // Counted rather than any-difference. A single line moving is a banner
    // repainting or a counter ticking, not work — and treating that as work
    // armed idle sessions that then announced a "stop" a minute later.
    let diff = Math.abs(w.prev.length - curr.length);
    for (let i = 0; i < Math.min(w.prev.length, curr.length); i++) {
      if (w.prev[i] !== curr[i]) diff++;
    }
    const moved = diff > SUBSTANTIVE;
    w.prev = curr;

    // Announce the transition from producing output to holding still, once per
    // stop.
    if (moved) {
      w.changed = Date.now();
      w.seenMovement = true;
      w.busy = true;
      w.notified = false;
    } else if (!attached && w.busy && !w.notified && Date.now() - w.changed > IDLE_MS) {
      w.notified = true;
      w.busy = false;
      // Logged on success as well as failure. "Did it not fire, or did it fire
      // and not arrive?" is otherwise unanswerable from this side, and those
      // two have completely different causes.
      console.log(`notify: ${s} idle for ${Math.round((Date.now() - w.changed) / 1000)}s`);
      notify({ title: `${s} is waiting`, body: lastMeaningful(curr), session: s })
        .catch((e) => console.error("notify:", e?.message ?? e));
    }
  }

  for (const k of [...watched.keys()]) if (!live.includes(k)) watched.delete(k);
}

setInterval(() => {
  tick().catch((e) => console.error("recorder:", e?.message ?? e));
}, POLL_MS);

// An error nobody can read is not an error, it is "Failed to fetch".
//
// Every success returns through withCookie(), which sets the CORS headers.
// Every failure returned a bare fail(), which did not — so a phone talking to a
// *second* machine could read a 200 and nothing else: the browser blocked the
// body, fetch rejected with a TypeError, and api.js turns TypeError into
// "can't reach the desktop — is Tailscale on?". A revoked device, a session
// that had gone, the unlock rate-limiter counting down — all of them reported
// the tailnet as down, which sends you to fix the one thing that is working.
// Reproduced in Chromium across two origins, and only ever on the machine that
// did not serve the page, which is why it survived this long.
//
// Wrapped here rather than fixed in fail(): there are fifty call sites and the
// next route added would forget again. An origin that is not allowed still gets
// nothing — corsHeaders returns an empty set for it, and that is the one case
// where an unreadable answer is the right answer. 101 is left alone: a
// WebSocket upgrade's headers are not ours to touch.
async function serve(req: Request): Promise<Response> {
  // The origin is read BEFORE handle(), and that ordering is the whole trick.
  // A WebSocket upgrade consumes the request, so touching req.headers after
  // handle() has returned throws "TypeError: Request closed" — the throw eats
  // the upgrade response, Deno logs "Upgrade response was not returned from
  // callback", and every terminal in the app fails to connect while the service
  // still reports itself active. Cost an hour and a half of dead terminals to
  // learn, because nothing between here and the phone says the socket died.
  const origin = req.headers.get("origin");
  const res = await handle(req);
  if (res.status === 101 || !origin) return res;
  if (res.headers.has("access-control-allow-origin")) return res;
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

console.log(`deskpilot ${BUILD} listening on http://${HOST}:${PORT}`);
if (HOST !== "127.0.0.1") {
  console.log("WARNING: bound beyond localhost — make sure you are behind Tailscale");
}
Deno.serve({ hostname: HOST, port: PORT }, serve);
