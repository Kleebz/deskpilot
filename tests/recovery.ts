// Recovering from things going away.
//
// Neither of these belongs in tests/layout.ts. That suite measures what the app
// renders; these measure what it does *after* something breaks, which is where
// both of the bugs below lived and where a screenshot shows nothing:
//
//   - a phone in another app loses its terminal socket (the server closes an
//     idle terminal after 60 seconds) and used to come back to a dead pane with
//     a button on it, on every single return
//   - launching the app from a machine that is off is a dead end, even with
//     other machines paired and up, because the service worker caches none of
//     the app — by design — so the keyring behind that origin is unreachable
//
//   deno run -A tests/recovery.ts [--url http://host] [--token abc]
//                                  [--restart "systemctl --user restart deskpilot"]
//
// Needs chromium on PATH and a running server.
//
// NOTE: the two terminal checks RESTART the deskpilot service, because that is
// the only way to actually drop a live socket. Chromium's offline emulation
// does not close one — it was used here first, reported "the socket never
// dropped", and would otherwise have passed the wake check vacuously against a
// terminal that never died. Restarting is safe by design: KillMode=process, so
// tmux sessions survive it, and check.sh asserts that. Any already-connected
// phone reconnects on its own, which is the thing being tested.

const WIDTH = 390;
const HEIGHT = 844;

type Cdp = {
  send: (method: string, params?: unknown, sessionId?: string) => Promise<any>;
  close: () => void;
};

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("could not connect to chromium"));
  });

  let id = 0;
  const waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id)!;
      waiting.delete(msg.id);
      msg.error ? w.rej(new Error(msg.error.message)) : w.res(msg.result);
    }
  };

  return {
    send(method, params = {}, sessionId) {
      const mid = ++id;
      return new Promise((res, rej) => {
        waiting.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        setTimeout(() => {
          if (waiting.delete(mid)) rej(new Error(`${method} timed out`));
        }, 30000);
      });
    },
    close: () => ws.close(),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drops every live terminal socket, by taking the thing holding them away.
async function restartServer(cmd: string): Promise<string> {
  const parts = cmd.split(/\s+/).filter(Boolean);
  const { code, stderr } = await new Deno.Command(parts[0], {
    args: parts.slice(1), stdout: "null", stderr: "piped",
  }).output();
  if (code !== 0) return new TextDecoder().decode(stderr).trim() || `exit ${code}`;
  return "";
}

async function page(cdp: Cdp, width = WIDTH, height = HEIGHT) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const run = async (expression: string) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 3, mobile: true,
  }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  return {
    sessionId,
    run,
    goto: (url: string) => cdp.send("Page.navigate", { url }, sessionId),
    close: () => cdp.send("Target.closeTarget", { targetId }),
  };
}

// The pane reports its own state: the overlay is absent once the socket is
// live, and carries a reconnect button only once it has given up. Reduced to
// those three words rather than the overlay's text, which reads "disconnected
// reconnect" — matching that against "closed" is a check that can never fire.
const STATE = `(() => {
  const s = document.querySelector(".rail > section.composing .state");
  if (!s) return "live";
  return s.querySelector("button") ? "closed" : "connecting";
})()`;

async function waitForState(run: (e: string) => Promise<any>, want: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await run(STATE) === want) return true;
    await sleep(250);
  }
  return false;
}

// Anything but live. The retry is quick enough that polling for one exact word
// can step straight over the gap it is meant to catch.
async function waitForDrop(run: (e: string) => Promise<any>, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await run(STATE) !== "live") return true;
    await sleep(100);
  }
  return false;
}

// Open the app and swipe to a screen that actually holds a session — only the
// pane you are on mounts a terminal.
async function openTerminal(cdp: Cdp, base: string, token: string) {
  const p = await page(cdp);
  await p.goto(`${base}/?token=${token}`);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await p.run(`!!document.querySelector(".rail > section")`) === true) break;
  }
  const idx = await p.run(`(() => {
    const rail = document.querySelector(".rail");
    const panes = [...document.querySelectorAll(".rail > section")];
    const i = panes.findIndex((s) => s.classList.contains("composing"));
    if (i < 0) return -1;
    rail.scrollTo({ left: i * rail.clientWidth });
    rail.dispatchEvent(new Event("scroll"));
    return i;
  })()`);
  if (idx < 0) { await p.close(); return null; }
  if (!await waitForState(p.run, "live")) { await p.close(); return null; }
  // Count taps, so a recovery can be shown to have happened on its own.
  await p.run(`window.__clicks = 0;
    document.addEventListener("click", () => window.__clicks++, true); true`);
  return p;
}

// A blip while you are watching the pane. The socket dies, and the bounded
// retry in Term.svelte should bring it back without a tap.
async function recoversWhileWatching(cdp: Cdp, base: string, token: string, restart: string): Promise<number> {
  const p = await openTerminal(cdp, base, token);
  if (!p) {
    console.log(`\x1b[2m·\x1b[0m not measured — no session on a screen to open a terminal on`);
    return 0;
  }
  const t0 = Date.now();
  const failed = await restartServer(restart);
  const dropped = failed ? false : await waitForDrop(p.run, 100);
  const back = await waitForState(p.run, "live", 60);
  const clicks = await p.run(`window.__clicks`);
  await p.close();

  const problems: string[] = [];
  if (failed) problems.push(`could not restart the server: ${failed}`);
  if (!dropped) problems.push("the socket never dropped, so nothing was tested");
  if (!back) problems.push("the terminal never came back");
  if (clicks) problems.push(`it took ${clicks} taps`);
  if (problems.length) {
    console.log(`\x1b[31m✗\x1b[0m terminal survives a blip you are watching`);
    for (const m of problems) console.log(`    ${m}`);
    return 1;
  }
  console.log(`\x1b[32m✓\x1b[0m terminal survives a blip you are watching  (back in ${((Date.now() - t0) / 1000).toFixed(1)}s, no taps)`);
  return 0;
}

// The case that actually happens: the phone is in another app when the socket
// dies, so nothing is watching and the retry deliberately does not run. Coming
// back has to be enough on its own.
async function recoversAfterWake(cdp: Cdp, base: string, token: string, restart: string): Promise<number> {
  const p = await openTerminal(cdp, base, token);
  if (!p) {
    console.log(`\x1b[2m·\x1b[0m not measured — no session on a screen to open a terminal on`);
    return 0;
  }
  // Hide the page the way switching to another app does, then take the server
  // away, so the close lands with nobody looking and the retry deliberately
  // does not run.
  await p.run(`Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange")); true`);
  await sleep(300);
  const failed = await restartServer(restart);
  await sleep(3000);
  const beforeWake = await p.run(STATE);

  const t0 = Date.now();
  await p.run(`Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange")); true`);
  const back = await waitForState(p.run, "live", 60);
  const clicks = await p.run(`window.__clicks`);
  await p.close();

  const problems: string[] = [];
  if (failed) problems.push(`could not restart the server: ${failed}`);
  // Without this the check passes on a terminal that never died.
  if (beforeWake === "live") problems.push("the socket was still live while hidden, so nothing was tested");
  if (!back) problems.push(`still "${beforeWake}" after coming back`);
  if (clicks) problems.push(`it took ${clicks} taps`);
  if (problems.length) {
    console.log(`\x1b[31m✗\x1b[0m terminal recovers on returning to the app`);
    for (const m of problems) console.log(`    ${m}`);
    return 1;
  }
  console.log(`\x1b[32m✓\x1b[0m terminal recovers on returning to the app  (was "${beforeWake}", live in ${((Date.now() - t0) / 1000).toFixed(1)}s, no taps)`);
  return 0;
}

// Cold-launching the installed app while the machine that supplied its origin
// is off. Runs against a throwaway copy of the built UI so the server can
// genuinely be killed — network emulation on the page does not reach the
// service worker, so faking this measures the wrong thing.
async function cachedAppRoutes(cdp: Cdp, dist: string): Promise<number> {
  const TYPES: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".svg": "image/svg+xml",
  };
  const ac = new AbortController();
  let server;
  try {
    server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
      const p = new URL(req.url).pathname;
      const file = p === "/" ? "/index.html" : p;
      try {
        const body = await Deno.readFile(dist + file);
        return new Response(body, {
          headers: { "content-type": TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" },
        });
      } catch { return new Response("not found", { status: 404 }); }
    });
  } catch (e) {
    console.log(`\x1b[31m✗\x1b[0m cached app — could not start a throwaway server: ${e}`);
    return 1;
  }
  const base = `http://127.0.0.1:${server.addr.port}`;

  const p = await page(cdp);
  await p.goto(`${base}/?token=x`);
  await sleep(2500);
  const cached = await p.run(`navigator.serviceWorker.ready.then(async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith("deskpilot-shell-"));
    if (names.length !== 1) return { shells: names.length, app: false, assets: 0 };
    const c = await caches.open(names[0]);
    const keys = await c.keys();
    return {
      shells: names.length,
      app: !!(await c.match("/__deskpilot_app_shell__")),
      assets: keys.filter((r) => new URL(r.url).pathname.startsWith("/assets/")).length,
    };
  }).catch(() => false)`);
  // Two other machines paired, as any real multi-machine phone has.
  await p.run(`localStorage.setItem("dp_hosts", JSON.stringify([
    { origin: location.origin, token: "x", name: "this-one" },
    { origin: "https://framework.example.ts.net", token: "y", name: "framework" },
    { origin: "https://mac-mini.example.ts.net", token: "z", name: "mac-mini" }
  ])); true`);
  // A second visit, so the worker is controlling the client as it would be.
  await p.goto(`${base}/`);
  await sleep(1500);
  const controlled = await p.run(`!!navigator.serviceWorker.controller`);

  ac.abort();
  await server.finished.catch(() => {});
  await sleep(500);

  await p.goto(`${base}/`);
  await sleep(3500);
  const out = await p.run(`(() => ({
    title: document.title,
    offlineDocument: !!document.querySelector("#others"),
    machines: [...document.querySelectorAll("nav.machines button.machine")].map((b) => ({
      label: b.innerText.replace(/\\s+/g, " ").trim(),
      origin: b.title,
      tall: Math.round(b.getBoundingClientRect().height),
    })),
  }))()`);
  const selected = await p.run(`(() => {
    const b = [...document.querySelectorAll("nav.machines button.machine")]
      .find((x) => x.title === "https://framework.example.ts.net");
    if (!b) return "";
    b.click();
    return localStorage.getItem("dp_host") || "";
  })()`);
  await p.close();

  const problems: string[] = [];
  if (!cached?.app) problems.push("the service worker never cached the application document");
  if ((cached?.assets ?? 0) < 3) problems.push(`only ${cached?.assets ?? 0} built assets were cached`);
  if (!controlled) problems.push("the service worker was not controlling the page");
  if (out.offlineDocument) problems.push("the static offline document rendered instead of the application");
  if (out.title.includes("offline")) problems.push(`the application did not render — got "${out.title}"`);
  if (out.machines.length !== 3) problems.push(`${out.machines.length} machines rendered, expected all 3 stored machines`);
  for (const machine of out.machines) {
    if (machine.tall < 44) problems.push(`${machine.label} is only ${machine.tall}px tall`);
  }
  if (selected !== "https://framework.example.ts.net") problems.push("the live alternate machine could not be selected");
  if (problems.length) {
    console.log(`\x1b[31m✗\x1b[0m cached app starts when its origin is off`);
    for (const m of problems) console.log(`    ${m}`);
    return 1;
  }
  console.log(`\x1b[32m✓\x1b[0m cached app starts when its origin is off  (${cached.assets} assets, alternate selected)`);
  return 0;
}

async function main() {
  const args = new Map<string, string>();
  for (let i = 0; i < Deno.args.length; i += 2) {
    args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1] ?? "");
  }
  const base = args.get("url") ?? "http://127.0.0.1:8790";
  const token = args.get("token") ??
    (await Deno.readTextFile(`${Deno.env.get("HOME")}/.config/deskpilot/token`)).trim();
  const dist = args.get("dist") ?? new URL("../web/dist", import.meta.url).pathname;
  const restart = args.get("restart") ?? "systemctl --user restart deskpilot";

  const port = 9341;
  const profile = await Deno.makeTempDir();
  const chrome = new Deno.Command("chromium", {
    args: [
      "--headless=new", `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
      "--ignore-certificate-errors", "about:blank",
    ],
    stdout: "null", stderr: "null",
  }).spawn();

  let wsUrl = "";
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(250);
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) {
    chrome.kill();
    console.error("chromium did not start a debugging endpoint");
    Deno.exit(1);
  }

  const cdp = await connect(wsUrl);
  let failures = 0;
  failures += await recoversWhileWatching(cdp, base, token, restart);
  failures += await recoversAfterWake(cdp, base, token, restart);
  failures += await cachedAppRoutes(cdp, dist);

  cdp.close();
  chrome.kill();
  await chrome.status;
  await Deno.remove(profile, { recursive: true }).catch(() => {});

  console.log(failures ? `\n${failures} check(s) failed` : "\nrecovers from every break tested");
  Deno.exit(failures ? 1 : 0);
}

await main();
