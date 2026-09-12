// Exercise the in-app QR scanner with Chromium's simulated camera.
//
//   deno run -A tests/scanner.ts [--url http://127.0.0.1:8790] [--token abc]
//
// This cannot prove a physical Android or iOS permission prompt, but it catches
// the failure where getUserMedia succeeds while the preview remains hidden or
// zero-sized — exactly what a person sees as a stop button over no camera.

type Cdp = {
  send: (method: string, params?: unknown, sessionId?: string) => Promise<any>;
  close: () => void;
};

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("could not connect to Chromium"));
  });
  let id = 0;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const call = waiting.get(msg.id);
    if (!call) return;
    waiting.delete(msg.id);
    msg.error ? call.reject(new Error(msg.error.message)) : call.resolve(msg.result);
  };
  return {
    send(method, params = {}, sessionId) {
      const callId = ++id;
      return new Promise((resolve, reject) => {
        waiting.set(callId, { resolve, reject });
        ws.send(JSON.stringify({ id: callId, method, params, sessionId }));
      });
    },
    close: () => ws.close(),
  };
}

const args = new Map<string, string>();
for (let i = 0; i < Deno.args.length; i += 2) {
  args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1] ?? "");
}
const base = args.get("url") ?? "http://127.0.0.1:8790";
const token = args.get("token") ??
  (await Deno.readTextFile(`${Deno.env.get("HOME")}/.config/deskpilot/token`)).trim();
const port = 9334;
const profile = await Deno.makeTempDir();
const chrome = new Deno.Command("chromium", {
  args: [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();

let cdp: Cdp | undefined;
try {
  let wsUrl = "";
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch { /* Chromium is still starting */ }
  }
  if (!wsUrl) throw new Error("Chromium did not start a debugging endpoint");

  cdp = await connect(wsUrl);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: `${base}/?token=${token}` }, sessionId);

  const evaluate = async (expression: string) => {
    const result = await cdp!.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };

  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector("button.addm")`)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!await evaluate(`!!document.querySelector("button.addm")`)) {
    throw new Error("add-another-machine button did not render");
  }

  await evaluate(`document.querySelector("button.addm").click(); true`);
  if (!await evaluate(`!!document.querySelector(".scanner button.scan")`)) {
    throw new Error("scan-QR button did not render");
  }
  await evaluate(`document.querySelector(".scanner button.scan").click(); true`);

  let state;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = await evaluate(`(() => {
      const video = document.querySelector(".scanner video");
      const track = video?.srcObject?.getVideoTracks?.()[0];
      return video ? {
        display: getComputedStyle(video).display,
        width: video.offsetWidth,
        height: video.offsetHeight,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        paused: video.paused,
        track: track?.readyState ?? "none",
      } : null;
    })()`);
    if (state?.readyState >= 2 && state?.track === "live") break;
  }

  if (!state || state.display === "none" || state.width < 200 || state.height < 150) {
    throw new Error(`camera preview has no usable layout: ${JSON.stringify(state)}`);
  }
  if (state.readyState < 2 || state.paused || state.track !== "live") {
    throw new Error(`camera stream is not producing frames: ${JSON.stringify(state)}`);
  }

  console.log(
    `camera preview is visible (${state.width}x${state.height}), ` +
      `playing ${state.videoWidth}x${state.videoHeight} frames`,
  );
} finally {
  cdp?.close();
  try { chrome.kill(); } catch { /* already exited */ }
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
