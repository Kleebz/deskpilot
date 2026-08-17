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

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const SCRIPTS = `${ROOT}/scripts`;
const WEB = `${ROOT}/web`;

const HOST = Deno.env.get("DESKPILOT_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("DESKPILOT_PORT") ?? "8790");
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

async function run(cmd: string, args: string[]) {
  const p = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    out: new TextDecoder().decode(stdout),
    err: new TextDecoder().decode(stderr),
  };
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
    const res = await serveStatic(path);
    if (req.method === "HEAD") {
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return res;
  }

  if (!path.startsWith("/api/")) return new Response("not found", { status: 404 });

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
  if (!tokenOk(given)) return fail("unauthorized", 401);

  const setCookie = cookie
    ? undefined
    : `dp=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly`;
  const withCookie = (r: Response) => {
    if (setCookie) r.headers.append("set-cookie", setCookie);
    return r;
  };

  // ---- sessions ----
  if (req.method === "GET" && path === "/api/sessions") {
    const r = await run(`${SCRIPTS}/sessions.sh`, []);
    if (r.code !== 0) return fail(r.err || "sessions.sh failed", 500);
    return withCookie(new Response(r.out, {
      headers: { "content-type": "application/json", ...NO_STORE },
    }));
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

    // Announced, so the stillness fallback does not follow up a minute later
    // with a second notification about the same stop.
    const w = watched.get(s);
    if (w) { w.notified = true; w.busy = false; }

    console.log(`event: ${s} ${String(b?.kind ?? "event")}`);
    await notify({ title, body, session: s });
    return withCookie(json({ ok: true }));
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

  // Create a session. With `workspace`, a real terminal is placed there so it
  // is waiting on the right screen when you sit down. Without, it is detached.
  if (req.method === "POST" && path === "/api/sessions") {
    const body = await req.json().catch(() => null);
    const name = body?.name ?? "";
    const cwd = body?.path ?? Deno.env.get("HOME")!;
    const cmd = body?.command ?? "";
    const ws = body?.workspace;
    if (!SAFE_NAME.test(name)) return fail("bad session name");

    // The command is passed to tmux as argv and exec'd directly — no shell, so
    // there is no quoting hazard. Note that Deno's --allow-run allowlist does
    // NOT constrain this: tmux execs whatever it is handed. That is inherent to
    // an app whose purpose is running terminals, and no worse than send-keys,
    // which can already type any command into any session.
    const args = ["new-session", "-d", "-s", name, "-c", cwd];
    if (cmd) args.push("--", ...String(cmd).split(/\s+/).filter(Boolean));
    const r = await run("tmux", args);
    if (r.code !== 0) return fail(r.err || "could not create session", 500);

    // This box has detach-on-destroy off globally, so killing a session hands
    // its clients to another session instead of closing them — a terminal
    // silently becomes a second view of unrelated work. Set it per-session so
    // deskpilot sessions close cleanly, without touching the global config.
    await run("tmux", ["set-option", "-t", name, "detach-on-destroy", "on"]);

    if (ws != null) {
      const term = Deno.env.get("DESKPILOT_TERMINAL") ?? "alacritty";
      await run(`${SCRIPTS}/desk.sh`, ["place", String(ws), term, "-e", "tmux", "attach", "-t", name]);
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
    const r = await run(`${SCRIPTS}/desk.sh`,
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
    const body = await req.json().catch(() => null);
    const pw = body?.password;
    if (typeof pw !== "string" || !pw.length) return fail("password required");

    const child = new Deno.Command(`${SCRIPTS}/desk.sh`, {
      args: ["unlock"],
      stdin: "piped", stdout: "piped", stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(pw));
    await w.close();
    const { code, stderr } = await child.output();

    if (code !== 0) {
      const msg = new TextDecoder().decode(stderr).trim();
      return withCookie(fail(msg || "unlock failed", 409));
    }
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

    let socket: WebSocket, response: Response;
    try {
      // Every connection holds a PTY and a tmux client, so a peer that goes
      // away without closing — a tab discarded, a phone that lost signal —
      // must not pin them open forever. Deno pings and closes if no pong comes
      // back, which lands in onclose below and reaps the child. A browser
      // answers pings by itself, so an idle-but-live terminal is unaffected.
      ({ socket, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60 }));
    } catch {
      return fail("expected a websocket", 400);
    }

    // -f flushes so output arrives as it is produced rather than in blocks.
    const child = new Deno.Command("script", {
      args: ["-qfc", `stty cols ${cols} rows ${rows}; exec tmux attach -t ${name}`, "/dev/null"],
      // A systemd service inherits no TERM, and tmux refuses to attach without
      // one ("terminal does not support clear"). xterm-256color matches what
      // xterm.js actually implements.
      env: { TERM: "xterm-256color" },
      stdin: "piped", stdout: "piped", stderr: "null",
    }).spawn();

    const writer = child.stdin.getWriter();
    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      try { writer.close(); } catch { /* already gone */ }
      try { socket.close(); } catch { /* already closed */ }
      // SIGTERM alone is not enough. `script` does not forward it to the tmux
      // client in its pty, and nothing reaps the child unless its status is
      // awaited — so every connection used to leave a `script` and a
      // `tmux: client` behind. Escalate, then reap.
      (async () => {
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }, 2000);
        try { await child.status; } catch { /* already gone */ }
        clearTimeout(timer);
      })();
    };

    (async () => {
      try {
        for await (const chunk of child.stdout) {
          if (socket.readyState !== WebSocket.OPEN) break;
          socket.send(chunk);
        }
      } catch { /* pipe torn down */ }
      shutdown();
    })();

    socket.binaryType = "arraybuffer";
    socket.onmessage = (e) => {
      const data = typeof e.data === "string"
        ? new TextEncoder().encode(e.data)
        : new Uint8Array(e.data as ArrayBuffer);
      writer.write(data).catch(shutdown);
    };
    socket.onclose = shutdown;
    socket.onerror = shutdown;

    return response;
  }

  // ---- desktop ----
  if (req.method === "GET" && path === "/api/desk/state") {
    const ws = url.searchParams.get("ws") ?? "";
    const r = await run(`${SCRIPTS}/desk.sh`, ["json", ws]);
    if (r.code !== 0) return fail(r.err || "desk.sh failed", 500);
    return withCookie(new Response(r.out, {
      headers: { "content-type": "application/json", ...NO_STORE },
    }));
  }

  if (req.method === "GET" && path === "/api/desk/locked") {
    const r = await run(`${SCRIPTS}/desk.sh`, ["locked"]);
    return withCookie(json({ locked: r.out.trim() === "locked" }));
  }

  if (req.method === "GET" && path === "/api/desk/shot") {
    const addr = url.searchParams.get("address");
    const out = `/tmp/deskpilot-shot-${Date.now()}.jpg`;
    const r = addr
      ? await run(`${SCRIPTS}/desk.sh`, ["shot-window", addr, out])
      : await run(`${SCRIPTS}/desk.sh`, ["shot", out, url.searchParams.get("ws") ?? ""]);
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
    const r = await run(`${SCRIPTS}/desk.sh`, ["move", b.address, String(b.workspace)]);
    return withCookie(r.code === 0 ? json({ ok: true }) : fail(r.err || "move failed", 500));
  }

  if (req.method === "POST" && path === "/api/desk/tile") {
    const b = await req.json().catch(() => null);
    if (!b?.address) return fail("address required");
    const r = await run(`${SCRIPTS}/desk.sh`, ["tile", b.address]);
    return withCookie(r.code === 0 ? json({ ok: true }) : fail(r.err || "tile failed", 500));
  }

  return withCookie(fail("not found", 404));
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
        busy: false, notified: true,   // nothing to announce about a session we just met
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

console.log(`deskpilot listening on http://${HOST}:${PORT}`);
if (HOST !== "127.0.0.1") {
  console.log("WARNING: bound beyond localhost — make sure you are behind Tailscale");
}
Deno.serve({ hostname: HOST, port: PORT }, handle);
