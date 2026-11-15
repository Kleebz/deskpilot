// Two registered clients and a restart against a disposable server. No real
// service, keyring, tmux socket, native runtime, or desktop is contacted.
import { assert, assertEquals } from "jsr:@std/assert@1";
const root = new URL("../", import.meta.url).pathname;
const dir = await Deno.makeTempDir({ prefix: "dp-organization-api-" });
await Deno.mkdir(dir + "/bin");
for (
  const command of ["tmux", "ps", "hyprctl", "codex", "herdr-core", "herdr-app"]
) {
  await Deno.writeTextFile(dir + "/bin/" + command, "#!/bin/sh\nexit 1\n", {
    mode: 0o700,
  });
}
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
try {
  await ready();
  const first = await enroll("First browser"),
    second = await enroll("Second browser");
  const denied = await call("/organization", "unregistered");
  assertEquals(denied.status, 401);
  await denied.body?.cancel();
  const initial = await call("/organization", first.token);
  assertEquals(initial.headers.get("cache-control"), "no-store");
  const empty = await initial.json();
  const candidate = {
    ...empty,
    spaces: [{
      id: "space:one",
      name: "Project",
      tabs: [{ id: "task:one", name: "Task" }],
    }],
    hidden: [{
      kind: "conversation",
      id: "hidden-thread",
      generation: "thread:hidden-thread",
    }],
    assignments: [{
      source: { kind: "session", id: "original-source", generation: "one" },
      task: "task:one",
    }],
  };
  const save = await call("/organization", first.token, candidate);
  assertEquals(save.status, 200);
  const saved = await save.json();
  assertEquals(saved.revision, 1);
  assertEquals(await (await call("/organization", second.token)).json(), saved);
  const competing = await Promise.all([
    call("/organization", first.token, {
      ...saved,
      spaces: [{ ...saved.spaces[0], name: "First edit" }],
    }),
    call("/organization", second.token, {
      ...saved,
      spaces: [{ ...saved.spaces[0], name: "Second edit" }],
    }),
  ]);
  assertEquals(competing.map((r) => r.status).sort(), [200, 409]);
  for (const r of competing) await r.body?.cancel();
  const latest = await (await call("/organization", second.token)).json();
  assertEquals(latest.revision, 2);
  const bad = await call("/organization", second.token, {
    ...latest,
    token: "must-not-be-persisted",
  });
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
  const oversized = await call("/organization", second.token, {
    ...latest,
    extra: "x".repeat(1024 * 1024),
  });
  assertEquals(oversized.status, 413);
  await oversized.body?.cancel();
  const revocation = await call("/devices/revoke", helper, { id: first.id });
  assertEquals(revocation.status, 200);
  await revocation.body?.cancel();
  const revoked = await call("/organization", first.token, latest);
  assertEquals(revoked.status, 401);
  await revoked.body?.cancel();
  server.kill("SIGTERM");
  await output;
  server = start();
  output = server.output();
  await ready();
  assertEquals(
    await (await call("/organization", second.token)).json(),
    latest,
  );
  const raw = await Deno.readTextFile(
    dir + "/.local/state/deskpilot/organization.json",
  );
  assert(!raw.includes("must-not-be-persisted"));
  assertEquals(
    Deno.statSync(dir + "/.local/state/deskpilot/organization.json").mode! &
      0o777,
    0o600,
  );
  console.log(
    "PASS two registered browsers share durable organization; concurrent stale writes, invalid fields, oversized bodies and revoked devices are rejected; server restart preserves exact membership",
  );
} finally {
  try {
    server.kill("SIGTERM");
  } catch {}
  await output;
  await Deno.remove(dir, { recursive: true });
}
