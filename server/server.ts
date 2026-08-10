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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ---- static UI (unauthenticated: it is just markup, the API is not) ----
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    try {
      return new Response(await Deno.readTextFile(`${WEB}/index.html`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("no web/index.html yet", { status: 404 });
    }
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
    return withCookie(new Response(r.out, { headers: { "content-type": "application/json" } }));
  }

  if (req.method === "GET" && path === "/api/capture") {
    const s = url.searchParams.get("session") ?? "";
    if (!SAFE_NAME.test(s)) return fail("bad session name");
    const lines = url.searchParams.get("lines") ?? "40";
    const r = await run("tmux", ["capture-pane", "-p", "-t", s, "-S", `-${Number(lines) || 40}`]);
    if (r.code !== 0) return fail(r.err || "no such session", 404);
    return withCookie(json({ session: s, text: r.out }));
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

    const args = ["new-session", "-d", "-s", name, "-c", cwd];
    if (cmd) args.push("--", ...String(cmd).split(/\s+/));
    const r = await run("tmux", args);
    if (r.code !== 0) return fail(r.err || "could not create session", 500);

    if (ws != null) {
      const term = Deno.env.get("DESKPILOT_TERMINAL") ?? "alacritty";
      await run(`${SCRIPTS}/desk.sh`, ["place", String(ws), term, "-e", "tmux", "attach", "-t", name]);
    }
    return withCookie(json({ ok: true, session: name, workspace: ws ?? null }));
  }

  // ---- desktop ----
  if (req.method === "GET" && path === "/api/desk/state") {
    const ws = url.searchParams.get("ws") ?? "";
    const r = await run(`${SCRIPTS}/desk.sh`, ["json", ws]);
    if (r.code !== 0) return fail(r.err || "desk.sh failed", 500);
    return withCookie(new Response(r.out, { headers: { "content-type": "application/json" } }));
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
    return withCookie(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
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
