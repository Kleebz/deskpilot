// Capture screenshots of the app at phone size, for the README.
//
//   deno run -A tests/shots.ts [--url http://host] [--out docs/img]
//
// The same CDP path the layout harness uses, for the same reason: a desktop
// browser window will not go below ~500px, so anything captured that way is not
// what a phone sees. Emulation.setDeviceMetricsOverride is, and it supplies the
// pixel ratio too, so the images are sharp rather than upscaled.
//
// These are real renderings of the running app, not mockups. What is in them is
// whatever sessions the machine actually has — worth a look before publishing.

const WIDTH = 390;
const HEIGHT = 844;
const DPR = 3;

type Cdp = {
  send: (m: string, p?: unknown, s?: string) => Promise<any>;
  close: () => void;
};

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("could not reach chromium"));
  });
  let id = 0;
  const waiting = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id)!;
      waiting.delete(m.id);
      m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
    }
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const mid = ++id;
        waiting.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        setTimeout(() => {
          if (waiting.delete(mid)) rej(new Error(`${method} timed out`));
        }, 20000);
      }),
    close: () => ws.close(),
  };
}

const args = new Map<string, string>();
for (let i = 0; i < Deno.args.length; i += 2) {
  args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1] ?? "");
}
const base = args.get("url") ?? "http://127.0.0.1:8790";
const out = args.get("out") ?? "docs/img";
const token = args.get("token") ??
  (await Deno.readTextFile(`${Deno.env.get("HOME")}/.config/deskpilot/token`)).trim();

await Deno.mkdir(out, { recursive: true });

const port = 9334;
const profile = await Deno.makeTempDir();
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--ignore-certificate-errors", "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();

let wsUrl = "";
for (let i = 0; i < 40 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json())
      .webSocketDebuggerUrl;
  } catch { /* still starting */ }
}
if (!wsUrl) {
  chrome.kill();
  console.error("chromium did not start");
  Deno.exit(1);
}

const cdp = await connect(wsUrl);

// Each shot is a name, an optional bit of driving, and a settle. Driving is
// done by clicking real controls rather than by poking app state, so a shot
// that cannot be taken means the flow is broken, not the harness.
const SHOTS: { name: string; setup?: string; wait?: number }[] = [
  { name: "index" },
  {
    name: "session",
    // The first pane that actually holds a session, found rather than assumed:
    // scrolling to a fixed position gave an empty screen, which is a true
    // rendering of nothing and a useless picture. Pane.svelte marks a pane with
    // a session as .composing.
    setup: `(() => {
      const panes = [...document.querySelectorAll(".rail > section")];
      const i = panes.findIndex((p) => p.classList.contains("composing"));
      document.querySelector(".rail").scrollTo({
        left: (i < 0 ? 1 : i) * innerWidth, behavior: "instant",
      });
      return i;
    })()`,
    // Long enough for the terminal to attach and tmux to repaint.
    wait: 4000,
  },
];

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: true,
}, sessionId);
await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const r = await cdp.send("Runtime.evaluate", {
    expression: `!!document.querySelector(".rail > section")`,
    returnByValue: true,
  }, sessionId);
  if (r.result?.value === true) break;
}

for (const shot of SHOTS) {
  if (shot.setup) {
    await cdp.send("Runtime.evaluate", { expression: shot.setup, returnByValue: true }, sessionId);
  }
  await new Promise((r) => setTimeout(r, shot.wait ?? 800));
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const path = `${out}/${shot.name}.png`;
  await Deno.writeFile(path, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
  const size = (await Deno.stat(path)).size;
  console.log(`  ${path}  ${WIDTH}x${HEIGHT}@${DPR}x  ${Math.round(size / 1024)} KB`);
}

cdp.close();
chrome.kill();
await chrome.status;
await Deno.remove(profile, { recursive: true }).catch(() => {});
