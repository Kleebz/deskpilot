// Two registered clients and a restart against a disposable server. No real
// service, keyring, tmux socket, native runtime, or desktop is contacted.
import { assert, assertEquals } from "jsr:@std/assert@1";
const root = new URL("../", import.meta.url).pathname;
const dir = await Deno.makeTempDir({ prefix: "dp-spaces-runtime-" });
await Deno.mkdir(dir + "/bin");
for (
  const command of ["ps", "hyprctl", "codex", "herdr-core", "herdr-app"]
) {
  await Deno.writeTextFile(dir + "/bin/" + command, "#!/bin/sh\nexit 1\n", {
    mode: 0o700,
  });
}
await Deno.writeTextFile(
  dir + "/bin/tmux",
  `#!/bin/sh
exec /usr/bin/tmux -S '${dir}/private.sock' "$@"
`,
  { mode: 0o700 },
);
async function tmux(args: string[]) {
  const r = await new Deno.Command("/usr/bin/tmux", {
    args: ["-S", dir + "/private.sock", ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (r.code) throw Error(new TextDecoder().decode(r.stderr));
  return new TextDecoder().decode(r.stdout);
}
await tmux(["new-session", "-d", "-s", "original", "-c", dir, "--", "/bin/sh"]);
await tmux(["new-session", "-d", "-s", "anchor", "--", "/bin/sh"]);
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const env = {
  ...Deno.env.toObject(),
  HOME: dir,
  PATH: dir + "/bin:/usr/bin:/bin",
  DESKPILOT_HOST: "127.0.0.1",
  DESKPILOT_PORT: String(port),
  DESKPILOT_TOKEN_FILE: dir + "/local-token",
  DESKPILOT_SCRIPTS: dir + "/missing",
  DESKPILOT_POLL_MS: "3600000",
};
const start = () =>
  new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", root + "server/server.ts"],
    cwd: root,
    env,
    clearEnv: true,
    stdout: "null",
    stderr: "piped",
  }).spawn();
let server = start(), output = server.output(), helper = "";
const pause = () => new Promise((r) => setTimeout(r, 50));
async function call(path: string, token = helper, body?: unknown) {
  return await fetch(base + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
}
async function ready() {
  for (let n = 0; n < 100; n++) {
    try {
      helper = (await Deno.readTextFile(dir + "/local-token")).trim();
      const r = await call("/organization");
      await r.body?.cancel();
      if (r.ok) return;
    } catch {}
    await pause();
  }
  throw Error("Disposable organization server did not start");
}
async function enroll(name: string) {
  const code = await (await call("/devices/code", helper, {})).json();
  return await (await call("/devices/enroll", "", { code: code.code, name }))
    .json();
}
let socket: WebSocket | undefined;
try {
  await ready();
  const list = () => call("/sessions").then((r) => r.json());
  const original = (await list()).find((s: any) => s.session === "original");
  assert(original.terminalId && original.generation);
  const expected = {
    terminalId: original.terminalId,
    generation: original.generation,
  };
  const org = {
    version: 1,
    revision: 0,
    spaces: [{
      id: "local:test",
      name: "Project",
      tabs: [{ id: "task:test", name: "Task" }],
    }],
    assignments: [{
      source: {
        kind: "session",
        id: original.terminalId,
        generation: original.generation,
      },
      task: "task:test",
    }],
  };
  assertEquals((await call("/organization", helper, org)).status, 200);
  assertEquals(
    (await call("/sessions/rename", helper, {
      session: "original",
      name: "renamed",
      expected,
    })).status,
    200,
  );
  const renamed = (await list()).find((s: any) => s.session === "renamed");
  assertEquals(renamed.terminalId, expected.terminalId);
  assertEquals(renamed.generation, expected.generation);
  const params = new URLSearchParams({
    session: "renamed",
    ...expected,
    token: helper,
  });
  socket = new WebSocket(`ws://127.0.0.1:${port}/api/term?${params}`);
  let primed = false;
  socket.onmessage = (e) => {
    if (JSON.parse(e.data).t === "hist") primed = true;
  };
  for (let n = 0; n < 80 && !primed; n++) await pause();
  assert(
    primed,
    "Real control client must restore output using the stable tmux ID",
  );
  socket.send(
    JSON.stringify({ t: "i", d: `printf ws-ok > ${dir}/websocket.txt\r` }),
  );
  for (let n = 0; n < 60; n++) {
    try {
      if ((await Deno.readTextFile(dir + "/websocket.txt")) === "ws-ok") break;
    } catch {}
    await pause();
  }
  assertEquals(await Deno.readTextFile(dir + "/websocket.txt"), "ws-ok");
  assertEquals(
    (await call("/send", helper, {
      session: "renamed",
      expected,
      text: `printf post-ok > ${dir}/post.txt`,
    })).status,
    200,
  );
  for (let n = 0; n < 60; n++) {
    try {
      if ((await Deno.readTextFile(dir + "/post.txt")) === "post-ok") break;
    } catch {}
    await pause();
  }
  assertEquals(await Deno.readTextFile(dir + "/post.txt"), "post-ok");
  server.kill("SIGTERM");
  await output;
  server = start();
  output = server.output();
  await ready();
  const afterRestart = (await list()).find((s: any) => s.session === "renamed");
  assertEquals(afterRestart.terminalId, expected.terminalId);
  assertEquals(afterRestart.generation, expected.generation);
  assertEquals(
    (await (await call("/organization")).json()).assignments,
    org.assignments,
  );
  await tmux(["kill-session", "-t", "renamed"]);
  await tmux(["new-session", "-d", "-s", "renamed", "--", "/bin/sh"]);
  const replaced = (await list()).find((s: any) => s.session === "renamed");
  assert(
    replaced.terminalId !== expected.terminalId ||
      replaced.generation !== expected.generation,
  );
  for (
    const path of [
      "/send",
      "/paste",
      "/sessions/kill",
      "/sessions/rename",
      "/sessions/attach",
    ]
  ) {
    const r = await call(path, helper, {
      session: "renamed",
      expected,
      text: "should-not-run",
      name: "wrong",
      workspace: 1,
    });
    assertEquals(r.status, 409, path);
    await r.body?.cancel();
  }
  const stale = await call("/term?" + params);
  assertEquals(stale.status, 409);
  await stale.body?.cancel();
  assert((await list()).some((s: any) => s.session === "renamed"));
  console.log(
    "PASS private tmux: real WebSocket and composer input use stable IDs; rename/server restart preserve identity and organization; stale reconnect, input, paste and lifecycle actions reject replacement work",
  );
} finally {
  try {
    socket?.close();
  } catch {}
  try {
    server.kill("SIGTERM");
  } catch {}
  await output;
  try {
    await tmux(["kill-server"]);
  } catch {}
  await Deno.remove(dir, { recursive: true });
}
