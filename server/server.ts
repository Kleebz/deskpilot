// deskpilot server — a thin HTTP wrapper over scripts/ and tmux.
//
//   deno run --allow-net --allow-read --allow-env \
//     --allow-run=$PWD/scripts/desk.sh,$PWD/scripts/sessions.sh,tmux \
//     server/server.ts
//
// Nothing here knows what agent is running inside a tmux session. `send` types
// keystrokes into a terminal; what reads them is not this program's business.
//
// Binds to 127.0.0.1 by default. Set DESKPILOT_HOST=0.0.0.0 only once you are
// behind Tailscale — this endpoint can run commands on the machine.

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
  "C-c", "C-d", "C-u", "C-l", "C-r",
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
      return new Response(
        "No built UI. Run:  cd ~/Projects/deskpilot/web && npm install && npm run build",
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

    // A capture is padded to the pane height, so most of it is blank: measured
    // 38 blank lines out of 58 on a real reply. Trim trailing spaces and
    // collapse blank runs to one — 3665 bytes becomes 1244 with nothing lost.
    // Deliberately NOT stripping box-drawing: the conversation itself is plain
    // prose, and the only boxed thing is the banner, which scrolls away.
    const text = r.out
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .reduce<string[]>((acc, l) => {
        if (l === "" && acc[acc.length - 1] === "") return acc;
        acc.push(l);
        return acc;
      }, [])
      .join("\n")
      .trim();

    return withCookie(json({ session: s, text }));
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

console.log(`deskpilot listening on http://${HOST}:${PORT}`);
if (HOST !== "127.0.0.1") {
  console.log("WARNING: bound beyond localhost — make sure you are behind Tailscale");
}
Deno.serve({ hostname: HOST, port: PORT }, handle);
