// Manual compatibility probe for an existing session on an ISOLATED tmux server.
// deno run -A tests/terminal-probe.ts <socket-path> <session> <output-directory> [--restore-state] [--dialog]
// Requires chromium and web/node_modules. Never points at the default tmux socket.
// Uses the production ControlClient and reproduces /api/term's history bootstrap
// and Term.svelte's xterm reset/write behavior. This is a transport probe, not
// a substitute for testing the full app's layout or mobile touch handling.
import { ControlClient, keysCommand } from "../server/control.ts";
import { captureTerminal } from "../server/terminal.ts";

const [socket, session, out] = Deno.args;
// Compare the original baseline with the production snapshot implementation.
const restoreState = Deno.args.includes("--restore-state");
const dialog = Deno.args.includes("--dialog");
if (!socket?.startsWith("/") || !/^[\w-]+$/.test(session ?? "") || !out) {
  throw new Error(
    "usage: terminal-probe.ts <absolute isolated socket> <session> <output directory>",
  );
}
await Deno.mkdir(out, { recursive: true });
const temp = await Deno.makeTempDir({ prefix: "deskpilot-terminal-probe-" });
const originalPath = Deno.env.get("PATH")!;
const tmuxBin = new TextDecoder().decode(
  (await new Deno.Command("which", {
    args: ["tmux"],
    stdout: "piped",
  }).output()).stdout,
).trim();
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
await Deno.writeTextFile(
  `${temp}/tmux`,
  `#!/bin/sh\nexec ${quote(tmuxBin)} -S ${quote(socket)} "$@"\n`,
  { mode: 0o700 },
);
Deno.env.set("PATH", `${temp}:${originalPath}`);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clients = new Set<ControlClient>();
const root = new URL("../web/node_modules/@xterm/xterm/", import.meta.url);
const page = `<!doctype html><link rel="stylesheet" href="/xterm.css">
<style>body{margin:0;background:#101010;color:#eee}#host{padding:8px}iframe{border:0}</style>
<div id="host"></div><script src="/xterm.js"></script><script>
const term = new Terminal({cols:80,rows:24,fontSize:12,scrollback:2000,allowProposedApi:true});
term.open(document.getElementById('host'));
let ws, ready=false;
window.connect = () => {
  if(ws) { ws.onmessage=null; ws.close(); }
  ready=false;
  ws=new WebSocket('ws://'+location.host+'/term?cols='+term.cols+'&rows='+term.rows);
  ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.t==='hist') {
    term.reset();term.write(m.d,()=>{term.scrollToBottom();ready=true;});
  } else if(m.t==='o') term.write(m.d);};
};
term.onData(d=>{if(ws.readyState===1)ws.send(JSON.stringify({t:'i',d}));});
window.resize=(width,height)=>{
  const screen=document.querySelector('.xterm-screen');
  const cw=screen.getBoundingClientRect().width/term.cols;
  const ch=screen.getBoundingClientRect().height/term.rows;
  const cols=Math.max(20,Math.floor((width-16)/cw)),rows=Math.max(10,Math.floor((height-16)/ch));
  term.resize(cols,rows);if(ws?.readyState===1)ws.send(JSON.stringify({t:'r',c:cols,r:rows}));
  return {cols,rows};
};
window.inspect=()=>{
  const b=term.buffer.active, lines=[];
  for(let i=0;i<b.length;i++)lines.push(b.getLine(i).translateToString(true));
  return {ready,cols:term.cols,rows:term.rows,type:b.type,cursorX:b.cursorX,cursorY:b.cursorY,
    baseY:b.baseY,screen:lines.slice(b.baseY,b.baseY+term.rows),history:lines};
};
window.type=d=>ws.send(JSON.stringify({t:'i',d}));
connect();
</script>`;
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/xterm.js" || u.pathname === "/xterm.css") {
      const file = u.pathname.endsWith("js") ? "lib/xterm.js" : "css/xterm.css";
      return new Response(await Deno.readFile(new URL(file, root)), {
        headers: {
          "content-type": file.endsWith("js") ? "text/javascript" : "text/css",
        },
      });
    }
    if (u.pathname === "/frame") {
      return new Response(page, {
        headers: { "content-type": "text/html" },
      });
    }
    if (u.pathname !== "/term") {
      return new Response(
        '<iframe id="phone" src="/frame" width="390" height="600"></iframe>',
        { headers: { "content-type": "text/html" } },
      );
    }
    const { socket: ws, response } = Deno.upgradeWebSocket(req);
    let active = "", hold: string[] | null = [];
    const send = (m: unknown) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(m));
    };
    const ctl = new ControlClient(session, {
      output(pane, data) {
        if (active && pane !== active) return;
        if (hold) hold.push(data);
        else send({ t: "o", d: data });
      },
      exit() {
        try {
          ws.close();
        } catch { /* closed */ }
      },
    });
    clients.add(ctl);
    ws.onopen = async () => {
      try {
        await ctl.send(
          `refresh-client -C ${Number(u.searchParams.get("cols"))}x${
            Number(u.searchParams.get("rows"))
          }`,
        );
        active = (await ctl.send(`display -p -t ${session} '#{pane_id}'`))[0];
        let snapshot: string;
        if (restoreState) {
          await captureTerminal(ctl, active, (m) => {
            send(m);
            hold = null;
          });
          return;
        } else {
          const hist = await ctl.send(
            `capture-pane -p -e -J -S -1000 -t ${session}`,
          );
          snapshot = hist.join("\r\n") + "\r\n";
        }
        send({ t: "hist", d: snapshot });
        const held = hold!;
        hold = null;
        for (const d of held) send({ t: "o", d });
      } catch {
        ws.close();
      }
    };
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      try {
        if (m.t === "r") await ctl.send(`refresh-client -C ${m.c}x${m.r}`);
        if (m.t === "i") {
          for (const cmd of keysCommand(session, m.d)) {
            await ctl.send(cmd);
          }
        }
      } catch {
        ws.close();
      }
    };
    ws.onclose = () => {
      clients.delete(ctl);
      ctl.close();
    };
    return response;
  },
);
const port = (server.addr as Deno.NetAddr).port;
let chrome: Deno.ChildProcess | undefined, cdp: WebSocket | undefined;
try {
  chrome = new Deno.Command("chromium", {
    args: [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${temp}/chrome`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  let endpoint = "";
  for (let i = 0; i < 60 && !endpoint; i++) {
    await pause(200);
    try {
      const [p, path] =
        (await Deno.readTextFile(`${temp}/chrome/DevToolsActivePort`)).trim()
          .split("\n");
      endpoint = `ws://127.0.0.1:${p}${path}`;
    } catch { /* starting */ }
  }
  if (!endpoint) throw new Error("chromium did not start");
  cdp = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    cdp!.onopen = () => resolve();
    cdp!.onerror = reject;
  });
  let id = 0;
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  cdp.onmessage = (e) => {
    const m = JSON.parse(e.data), p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  };
  const send = (
    method: string,
    params = {},
    sessionId?: string,
  ): Promise<any> =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        reject(new Error(`${method} timed out`));
      }, 10000);
      pending.set(n, { resolve, reject, timer });
      cdp!.send(JSON.stringify({ id: n, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", {
    url: `http://127.0.0.1:${port}`,
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const run = async (expression: string) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  for (let i = 0; i < 50; i++) {
    await pause(100);
    if (
      await run(
        "document.querySelector('iframe')?.contentWindow?.inspect?.().ready",
      )
    ) break;
  }
  const snapshots = [];
  for (
    const [label, width, height, reconnect] of [
      ["phone-320", 320, 600, false],
      ["phone-360", 360, 600, false],
      ["phone-390", 390, 600, false],
      ["phone-430", 430, 600, false],
      ["keyboard", 390, 300, false],
      ["desktop", 1200, 800, false],
      ["phone-return", 390, 600, false],
      ["reconnect", 390, 600, true],
      [
        dialog ? "navigate-after-reconnect" : "type-after-reconnect",
        390,
        600,
        false,
      ],
      ...(!dialog ? [["multiline-paste", 390, 600, false] as const] : []),
    ] as const
  ) {
    await run(
      `(()=>{const f=document.querySelector('iframe');f.width=${width};f.height=${height};f.contentWindow.resize(${width},${height});})()`,
    );
    if (reconnect) {
      await run("document.querySelector('iframe').contentWindow.connect()");
    }
    if (label === "type-after-reconnect") {
      await run(
        "document.querySelector('iframe').contentWindow.type('PROBE_UNSENT')",
      );
    }
    if (label === "navigate-after-reconnect") {
      await run(
        "document.querySelector('iframe').contentWindow.type('\\u001b[B')",
      );
    }
    if (label === "multiline-paste") {
      await run(
        "document.querySelector('iframe').contentWindow.type('\\u0015')",
      );
      await pause(150);
      const load = new Deno.Command(tmuxBin, {
        args: ["-S", socket, "load-buffer", "-b", "deskpilot-probe", "-"],
        stdin: "piped",
        stdout: "null",
      }).spawn();
      const writer = load.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(
          "PROBE_PASTE first line\nsecond line: 'quotes' $literal\nthird line: café 世界",
        ),
      );
      await writer.close();
      if (!(await load.status).success) throw new Error("load-buffer failed");
      const pasted = await new Deno.Command(tmuxBin, {
        args: [
          "-S",
          socket,
          "paste-buffer",
          "-p",
          "-d",
          "-b",
          "deskpilot-probe",
          "-t",
          session,
        ],
      }).output();
      if (!pasted.success) throw new Error("paste-buffer failed");
    }
    await pause(1500);
    const browser = await run(
      "document.querySelector('iframe').contentWindow.inspect()",
    );
    const cap = await new Deno.Command(tmuxBin, {
      args: ["-S", socket, "capture-pane", "-p", "-t", session],
      stdout: "piped",
    }).output();
    const state = await new Deno.Command(tmuxBin, {
      args: [
        "-S",
        socket,
        "display-message",
        "-p",
        "-t",
        session,
        "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{alternate_on}",
      ],
      stdout: "piped",
    }).output();
    const tmux = new TextDecoder().decode(cap.stdout).trimEnd();
    const normalize = (s: string) =>
      s.split("\n").map((l) => l.trimEnd()).join("\n").trimEnd();
    const sameScreen = normalize(browser.screen.join("\n")) === normalize(tmux);
    snapshots.push({
      label,
      width,
      height,
      restoreState,
      browser,
      tmux,
      state: new TextDecoder().decode(state.stdout).trim(),
      sameScreen,
    });
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }, sessionId);
    await Deno.writeFile(
      `${out}/${label}.png`,
      Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
    );
    console.log(
      `${label}: ${browser.cols}x${browser.rows}, ${browser.type}, screen ${
        sameScreen ? "matches" : "DIFFERS"
      }`,
    );
  }
  await run(
    `document.querySelector('iframe').contentWindow.type(${
      JSON.stringify(dialog ? "\x1b[A" : "\x15")
    })`,
  );
  await Deno.writeTextFile(
    `${out}/results.json`,
    JSON.stringify(snapshots, null, 2),
  );
  console.log(`Artifacts: ${out}`);
} finally {
  cdp?.close();
  if (chrome) {
    try {
      chrome.kill();
    } catch { /* exited */ }
    await chrome.status;
  }
  await Promise.all([...clients].map((c) => c.close()));
  await server.shutdown();
  Deno.env.set("PATH", originalPath);
  // Chromium's helper processes can finish writing after the main PID exits.
  for (let i = 0; i < 5; i++) {
    try {
      await Deno.remove(temp, { recursive: true });
      break;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) break;
      if (i === 4) throw e;
      await pause(200);
    }
  }
}
