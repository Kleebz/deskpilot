// Exercise the merged subscription/authentication and battery-saving behavior.
// Disposable server and fake tmux only; no push delivery or live service calls.
import { assert, assertEquals } from "jsr:@std/assert@1";

const root = new URL("../", import.meta.url).pathname;
const dir = await Deno.makeTempDir({ prefix: "dp-watcher-" });
await Deno.mkdir(dir + "/bin");
await Deno.mkdir(dir + "/.local/state/deskpilot", { recursive: true });
const subscriptions = dir + "/.local/state/deskpilot/subscriptions.json";
// Retired/unowned records must not activate the watcher after migration.
await Deno.writeTextFile(
  subscriptions,
  JSON.stringify([
    { deviceId: "revoked-device", endpoint: "https://push.example/old" },
    { endpoint: "https://push.example/unowned" },
  ]),
);
await Deno.writeTextFile(dir + "/attached", "1");
await Deno.writeTextFile(dir + "/calls", "");
await Deno.writeTextFile(
  dir + "/bin/tmux",
  `#!/bin/sh
printf '%s\\n' "$1" >> "$HOME/calls"
case "$1" in
  list-sessions) printf 'work %s\\n' "$(cat "$HOME/attached")" ;;
  capture-pane) printf 'unchanging screen\\n' ;;
  *) exit 1 ;;
esac
`,
  { mode: 0o700 },
);
for (const command of ["ps", "hyprctl", "codex", "herdr-core", "herdr-app"]) {
  await Deno.writeTextFile(dir + "/bin/" + command, "#!/bin/sh\nexit 1\n", {
    mode: 0o700,
  });
}
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const env = {
  ...Deno.env.toObject(),
  HOME: dir,
  PATH: dir + "/bin:/usr/bin:/bin",
  DESKPILOT_HOST: "127.0.0.1",
  DESKPILOT_PORT: String(port),
  DESKPILOT_TOKEN_FILE: dir + "/local-token",
  DESKPILOT_SCRIPTS: dir + "/missing",
  DESKPILOT_POLL_MS: "1000",
};
const server = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", root + "server/server.ts"],
  cwd: root,
  env,
  clearEnv: true,
  stdout: "null",
  stderr: "piped",
}).spawn();
const output = server.output();
let helper = "";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(path: string, body?: unknown, token = helper) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  assertEquals(response.status, 200);
  return data;
}
async function calls() {
  return (await Deno.readTextFile(dir + "/calls")).trim().split("\n").filter(
    Boolean,
  );
}
async function waitFor(predicate: () => Promise<boolean>) {
  for (let n = 0; n < 60; n++) {
    if (await predicate()) return;
    await pause(50);
  }
  throw Error("watcher did not reach the expected state");
}
try {
  await waitFor(async () => {
    try {
      helper = (await Deno.readTextFile(dir + "/local-token")).trim();
      await call("/organization");
      return true;
    } catch {
      return false;
    }
  });
  await pause(1250);
  assertEquals(
    await calls(),
    [],
    "unowned subscriptions must not spawn polling",
  );

  const code = await call("/devices/code", {});
  const phone = await call("/devices/enroll", {
    code: code.code,
    name: "Fixture phone",
  }, "");
  const key = new Uint8Array(65);
  key[0] = 4;
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const subscription = {
    endpoint: "https://push.example/fixture",
    machine: "https://computer.example",
    keys: { p256dh: b64(key), auth: b64(new Uint8Array(16)) },
  };
  await call("/push/subscribe", subscription, phone.token);
  await waitFor(async () => (await calls()).includes("list-sessions"));
  assert(
    !(await calls()).includes("capture-pane"),
    "desktop-visible work is never captured",
  );

  await Deno.writeTextFile(dir + "/attached", "0");
  await waitFor(async () => (await calls()).includes("capture-pane"));
  await call(
    "/push/unsubscribe",
    { endpoint: subscription.endpoint },
    phone.token,
  );
  await pause(100); // allow an already-started poll to finish
  const stopped = await calls();
  await pause(1250);
  assertEquals(
    await calls(),
    stopped,
    "last unsubscribe stops all background polling",
  );

  await call("/push/subscribe", subscription, phone.token);
  await waitFor(async () => (await calls()).length > stopped.length);
  const devices = await call("/devices");
  const registered = devices.devices.find((d: { name: string }) =>
    d.name === "Fixture phone"
  );
  assert(registered);
  await call("/devices/revoke", { id: registered.id });
  await pause(100);
  const revoked = await calls();
  await pause(1250);
  assertEquals(await calls(), revoked, "revocation also stops the watcher");
  assertEquals(JSON.parse(await Deno.readTextFile(subscriptions)), []);
  console.log(
    "PASS watcher: unowned subscriptions stay idle; subscribe starts polling; desktop-visible work skips capture; unsubscribe and revocation stop polling",
  );
} finally {
  try {
    server.kill("SIGTERM");
  } catch { /* exited */ }
  await output;
  await Deno.remove(dir, { recursive: true });
}
