// Optional desktop integration: real Ghostty, the system default, tmux and the
// HTTP/WebSocket APIs. Opens disposable windows silently on workspace 99.
// deno run -A tests/terminal-launch.ts [path/to/compiled/deskpilot]
// No screenshots, unlocks, settings changes, or operations on existing windows.
import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Session } from "../server/sessions.ts";

const root = new URL("../", import.meta.url).pathname;
const temp = await Deno.makeTempDir({ prefix: "deskpilot-desktop-" });
const prefix = `dp-test-${crypto.randomUUID().slice(0, 8)}`;
const names: string[] = [];
const windows: Array<{ pid: number; address: string }> = [];
const decode = (v: Uint8Array) => new TextDecoder().decode(v);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let token = "";
const config = `${temp}/config`;
const run = async (command: string, args: string[]) => {
  const output = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(output.success, decode(output.stderr));
  return decode(output.stdout);
};
const clients = async (): Promise<
  Array<{ pid: number; address: string; class: string }>
> => JSON.parse(await run("hyprctl", ["clients", "-j"]));
const initialPids = new Set((await clients()).map((w) => w.pid));
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const env = {
  ...Deno.env.toObject(),
  HOME: temp,
  DESKPILOT_HOST: "127.0.0.1",
  DESKPILOT_PORT: String(port),
  DESKPILOT_TOKEN_FILE: `${temp}/token`,
  DESKPILOT_CONFIG: config,
};
delete (env as Record<string, string>).DESKPILOT_TERMINAL;
delete (env as Record<string, string>).TMUX;
const server = new Deno.Command(Deno.args[0] || Deno.execPath(), {
  args: Deno.args[0] ? [] : [
    "run",
    "--allow-net",
    "--allow-read",
    "--allow-env",
    `--allow-write=${temp}`,
    `--allow-run=tmux,ps,hyprctl,${root}scripts/desk.sh`,
    `${root}server/server.ts`,
  ],
  clearEnv: true,
  env,
  cwd: root,
  stdout: "piped",
  stderr: "piped",
}).spawn();
const output = server.output();
async function api(path: string, body?: unknown) {
  token = (await Deno.readTextFile(`${temp}/token`)).trim();
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
async function until(fn: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(message);
}
async function placed(name: string) {
  let session: Session | undefined;
  await until(async () => {
    session = (await api("/sessions")).body.find((s: Session) =>
      s.session === name
    );
    return session?.workspace === 99 && session?.windows.length === 1;
  }, `${name} did not acquire its own desktop window`);
  const window = (await clients()).find((w) =>
    w.address === session!.windows[0]
  );
  assert(
    window && !initialPids.has(window.pid),
    "test must not reuse an existing terminal process",
  );
  assert(window.class.startsWith("com.deskpilot.Terminal."), window.class);
  assert(
    !windows.some((w) => w.pid === window.pid),
    "each launch must own a distinct process",
  );
  windows.push(window);
  const standalone = JSON.parse(
    await run(`${root}scripts/sessions.sh`, []),
  ) as Session[];
  assertEquals(
    standalone.find((s) => s.session === name)?.windows,
    session!.windows,
    "standalone session listing must agree on hidden-window identities",
  );
  return window;
}
async function terminal(name: string) {
  const ws = new WebSocket(
    `${
      base.replace("http", "ws")
    }/api/term?session=${name}&cols=52&rows=24&token=${token}`,
  );
  let ready = false;
  let received = "";
  ws.onmessage = (e) => {
    const message = JSON.parse(e.data);
    if (message.t === "hist") ready = true;
    received += message.d || "";
  };
  try {
    await until(async () => ready, "terminal did not restore a snapshot");
    const marker = `INPUT_${crypto.randomUUID().slice(0, 8)}`;
    ws.send(
      JSON.stringify({ t: "i", d: `echo ${marker}` + String.fromCharCode(13) }),
    );
    await until(
      async () =>
        received.includes(
          String.fromCharCode(13) + marker + String.fromCharCode(13, 10),
        ),
      "terminal input/output failed",
    ).catch((e) => {
      throw new Error(`${e.message}: ${JSON.stringify(received)}`);
    });
  } finally {
    ws.close();
    await until(
      async () => ws.readyState === WebSocket.CLOSED,
      "terminal did not close",
    );
  }
}

try {
  await until(async () => {
    try {
      return (await api("/sessions")).status === 200;
    } catch {
      return false;
    }
  }, "disposable server did not start");
  for (const mode of ["ghostty", "auto"]) {
    await Deno.writeTextFile(config, `DESKPILOT_TERMINAL=${mode}\n`);
    const name = `${prefix}-${mode}`;
    names.push(name);
    const created = await api("/sessions", {
      name,
      path: temp,
      command: "bash --noprofile --norc",
      workspace: 99,
    });
    assertEquals(created.status, 200);
    assertEquals(created.body.warning, undefined);
    const window = await placed(name);
    await terminal(name);
    await terminal(name); // reconnect to the same running shell
    Deno.kill(window.pid, "SIGTERM");
    await until(
      async () => !(await clients()).some((w) => w.address === window.address),
      "terminal window did not close",
    );
    assertEquals(
      (await api("/sessions")).body.some((s: Session) => s.session === name),
      true,
      "closing a desktop window must preserve the shell",
    );
    await terminal(name);
    console.log(
      `PASS ${mode}: correct window, input/output, reconnect, shell survives window close`,
    );
  }
  await Deno.writeTextFile(
    config,
    "DESKPILOT_TERMINAL=missing-test-terminal\n",
  );
  const name = `${prefix}-retry`;
  names.push(name);
  const created = await api("/sessions", {
    name,
    path: temp,
    command: "bash --noprofile --norc",
    workspace: 99,
  });
  assertEquals(created.status, 200);
  assertEquals(created.body.workspace, null);
  assert(created.body.warning.includes("missing-test-terminal"));
  await terminal(name);
  assertEquals(
    (await api("/sessions/attach", { session: name, workspace: 99 })).status,
    500,
  );
  await Deno.writeTextFile(config, "DESKPILOT_TERMINAL=auto\n");
  assertEquals(
    (await api("/sessions/attach", { session: name, workspace: 99 })).status,
    200,
  );
  await placed(name);
  console.log(
    "PASS unavailable terminal: session preserved, warning returned, attach retry succeeds",
  );
  const concurrent = await Promise.all(
    [0, 1].map(() => api("/sessions/attach", { session: name, workspace: 99 })),
  );
  assertEquals(concurrent.map((r) => r.status), [200, 200]);
  await until(async () => {
    const session = (await api("/sessions")).body.find((s: Session) =>
      s.session === name
    );
    return session?.windows.length === 3;
  }, "concurrent attachments lost a window identity");
  console.log(
    "PASS concurrent attachments: all three windows remain associated with the session",
  );
} finally {
  const identities = new Set<string>();
  for (const name of names) {
    try {
      const value = await run("tmux", [
        "show-option",
        "-qv",
        "-t",
        name,
        "@deskpilot-window-classes",
      ]);
      for (const id of value.trim().split(/\s+/)) identities.add(id);
    } catch { /* session already ended */ }
  }
  for (const name of names) {
    await new Deno.Command("tmux", {
      args: ["kill-session", "-t", `=${name}`],
      stdout: "null",
      stderr: "null",
    }).output();
  }
  try {
    server.kill("SIGTERM");
  } catch { /* already stopped */ }
  const logs = await output;
  if (!logs.success && logs.code !== 143) console.error(decode(logs.stderr));
  // Only processes proven to have been created by this test can be signalled.
  for (const window of await clients()) {
    if (!initialPids.has(window.pid) && identities.has(window.class)) {
      try {
        Deno.kill(window.pid, "SIGTERM");
      } catch { /* already closed */ }
    }
  }
  await Deno.remove(temp, { recursive: true });
}
