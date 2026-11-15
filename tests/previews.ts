// End-to-end image publishing without tmux or a desktop. Uses disposable state.
// deno run -A tests/previews.ts [path/to/compiled/deskpilot]
import { assert, assertEquals } from "jsr:@std/assert@1";

const root = new URL("../", import.meta.url).pathname;
const binary = Deno.args[0] ? await Deno.realPath(Deno.args[0]) : "";
const directory = await Deno.makeTempDir({ prefix: "deskpilot-preview-api-" });
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const retiredToken = crypto.randomUUID();
let token = "";
const image = await Deno.readFile(`${root}web/public/icon-192.png`);
await Deno.writeTextFile(`${directory}/token`, retiredToken);
await Deno.mkdir(`${directory}/ordinary-project`);
await Deno.writeFile(`${directory}/progress.png`, image);
const env: Record<string, string> = {
  ...Deno.env.toObject(),
  HOME: directory,
  DESKPILOT_TOKEN_FILE: `${directory}/token`,
  DESKPILOT_PORT: String(port),
  DESKPILOT_HOST: "127.0.0.1",
  DESKPILOT_POLL_MS: "3600000",
  DESKPILOT_SCRIPTS: `${directory}/no-desktop`,
};
delete env.TMUX;
delete env.TMUX_PANE;
const startServer = () =>
  new Deno.Command(binary || Deno.execPath(), {
    args: binary ? [] : [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-net",
      `--allow-write=${directory}`,
      "--allow-run=tmux,ps,hyprctl",
      `${root}server/server.ts`,
    ],
    clearEnv: true,
    env,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
let server = startServer();
let output = server.output();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (
  path: string,
  opts: RequestInit = {},
  credential: string = token,
) => {
  const r = await fetch(`${base}/api${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${credential}`, ...opts.headers },
    signal: AbortSignal.timeout(15000),
  });
  return r;
};
const jsonPost = async (
  path: string,
  body: unknown,
  credential: string = token,
) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, credential);
const list = async () => (await call("/previews")).json();
async function status(r: Response, expected: number) {
  assertEquals(r.status, expected, await r.text());
}
try {
  let started = false;
  for (let i = 0; i < 100; i++) {
    try {
      token = (await Deno.readTextFile(`${directory}/token`)).trim();
      if (token !== retiredToken && (await call("/previews")).ok) {
        started = true;
        break;
      }
    } catch { /* starting */ }
    await sleep(50);
  }
  assert(started, "preview server did not start");
  assertEquals(await list(), []);
  assert(token !== retiredToken, "unregistered token files must not authorize access");
  await status(await call("/capabilities", {}, retiredToken), 401);
  await status(await fetch(`${base}/api/capabilities?token=${retiredToken}`), 401);
  await status(await fetch(`${base}/api/capabilities`, { headers: { cookie: `dp=${retiredToken}` } }), 401);
  const localDevices = await (await call("/devices")).json();
  assert(localDevices.devices.some((d: {current: boolean}) => d.current));
  assert(!("legacy" in localDevices), "API must expose only registered device identities");
  console.log("PASS unregistered tokens rejected via bearer header, URL and cookie; local helpers have a device identity");
  const caps = await (await call("/capabilities")).json();
  assertEquals(caps.previews, true);
  assertEquals(caps.windows, false);
  await status(await call("/previews", {}, "wrong"), 401);
  await status(await call("/conversations", {}, "wrong"), 401);
  await status(await jsonPost("/conversations/connect", { id: "--last" }, "wrong"), 401);
  const discovery = await (await call("/conversations")).json();
  assert(Array.isArray(discovery.items));
  await status(await jsonPost("/conversations/connect", { id: "--last" }), 409);
  await status(
    await call("/previews?task=bad", {
      method: "POST",
      headers: { "content-type": "image/svg+xml" },
      body: "<svg/>",
    }),
    415,
  );
  await status(
    await call("/previews?task=bad", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: "not an image",
    }),
    415,
  );
  await status(
    await call("/previews?task=bad", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(8 * 1024 * 1024 + 1),
    }),
    413,
  );
  assertEquals(await list(), []);
  console.log(
    "PASS headless previews: authenticated, format-checked, size-bounded",
  );

  const cli = await new Deno.Command(binary || Deno.execPath(), {
    args: binary
      ? [
        "preview",
        `${directory}/progress.png`,
        "--caption",
        "Page layout ready",
      ]
      : [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net=127.0.0.1",
        "--allow-run=tmux",
        `${root}server/preview-cli.ts`,
        `${directory}/progress.png`,
        "--caption",
        "Page layout ready",
      ],
    clearEnv: true,
    env,
    cwd: `${directory}/ordinary-project`,
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(cli.success, new TextDecoder().decode(cli.stderr));
  const [preview] = await list();
  assertEquals(preview.task, "ordinary-project");
  assertEquals(preview.caption, "Page layout ready");
  const fetched = await call(`/previews/${preview.id}`);
  assertEquals(fetched.headers.get("content-type"), "image/png");
  assertEquals(fetched.headers.get("cache-control"), "no-store");
  assertEquals(new Uint8Array(await fetched.arrayBuffer()), image);
  await status(await call(`/previews/${preview.id}`, {}, "wrong"), 401);
  await status(await call("/previews/..%2Ftoken"), 404);
  console.log(
    "PASS ordinary-terminal CLI: project label, image round trip, private content",
  );

  server.kill("SIGTERM");
  await output;
  server = startServer();
  output = server.output();
  let restored = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await list())[0]?.id === preview.id) {
        restored = true;
        break;
      }
    } catch { /* restarting */ }
    await sleep(50);
  }
  assert(restored, "published image did not survive server restart");
  assertEquals(
    new Uint8Array(await (await call(`/previews/${preview.id}`)).arrayBuffer()),
    image,
  );
  console.log("PASS server restart restores image history and original bytes");

  const code = await (await jsonPost("/devices/code", {})).json();
  const phone = await (await jsonPost("/devices/enroll", {
    code: code.code,
    name: "preview-test",
  })).json();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(image.slice(0, 33));
      await gate;
      c.enqueue(image.slice(33));
      c.close();
    },
  });
  const pending = call("/previews?task=revoked", {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: stream,
  }, phone.token);
  await sleep(100);
  await status(await jsonPost("/devices/revoke", { id: phone.id }), 200);
  release();
  await status(await pending, 401);
  assertEquals((await list()).length, 1, "revoked upload must not reach disk");
  await status(await jsonPost("/previews/remove", { id: preview.id }), 200);
  assertEquals(await list(), []);
  await status(await call(`/previews/${preview.id}`), 404);
  console.log(
    "PASS upload revocation and deletion: no late publication or stale image access",
  );
} finally {
  try {
    server.kill("SIGTERM");
  } catch { /* already stopped */ }
  const logs = await output;
  if (!logs.success && logs.code !== 143) {
    console.error(new TextDecoder().decode(logs.stderr));
  }
  await Deno.remove(directory, { recursive: true });
}
