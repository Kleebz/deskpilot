// Isolated real core and tmux: discovery, phone input, and detach persistence.
// deno run -A tests/herdr-shared.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { Herdr, readHerdr } from "../server/herdr.ts";

const dir = await Deno.makeTempDir({ prefix: "deskpilot-herdr-check-" });
const coreSession = `deskpilot-check-${crypto.randomUUID().slice(0, 8)}`;
const tmuxSocket = `${dir}/tmux.sock`;
async function run(command: string, args: string[]) {
  const r = await new Deno.Command(command, {
    args: command === "tmux" ? ["-S", tmuxSocket, ...args] : args,
    env: { HC_SESSION: coreSession },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: r.code,
    out: new TextDecoder().decode(r.stdout),
    err: new TextDecoder().decode(r.stderr),
  };
}
const pause = () => new Promise((r) => setTimeout(r, 80));
let address = "";
try {
  const started = await run("herdr-core", [
    "run",
    "--bg",
    "--cwd",
    dir,
    "/bin/bash",
    "--noprofile",
    "--norc",
  ]);
  assertEquals(started.code, 0, started.err);
  const snapshot = await readHerdr(coreSession);
  address = snapshot.terminals[0].address;
  const originalPid = snapshot.terminals[0].pid;
  const adapter = new Herdr(run, "/bin/bash", readHerdr, coreSession);
  const before = await adapter.list();
  assertEquals(before.items.length, 1);
  assertEquals(before.items[0].session, null);
  const mobile = await adapter.enable(before.items[0].id, run);
  assertEquals((await adapter.enable(before.items[0].id, run)).reused, true);
  const target = `=${mobile.session}:`;
  for (let i = 0; i < 60; i++) {
    const capture = await run("tmux", ["capture-pane", "-p", "-t", target]);
    if (capture.out.includes("bash-")) break;
    await pause();
  }
  assertEquals(
    (await run("tmux", [
      "send-keys",
      "-t",
      target,
      "-l",
      "printf 'HERDR_%s\\n' PHONE_OK",
    ])).code,
    0,
  );
  assertEquals(
    (await run("tmux", ["send-keys", "-t", target, "Enter"])).code,
    0,
  );
  let captured = "";
  for (let i = 0; i < 60; i++) {
    captured = (await run("tmux", ["capture-pane", "-p", "-t", target])).out;
    if (captured.includes("HERDR_PHONE_OK")) break;
    await pause();
  }
  assert(captured.includes("HERDR_PHONE_OK"), captured);
  assert(
    (await run("herdr-core", ["read", address])).out.includes("HERDR_PHONE_OK"),
  );
  assertEquals((await readHerdr(coreSession)).terminals[0].pid, originalPid);
  assertEquals(
    (await run("tmux", ["kill-session", "-t", `=${mobile.session}`])).code,
    0,
  );
  await pause();
  const after = await readHerdr(coreSession);
  assertEquals(after.terminals[0].pid, originalPid);
  assertEquals(after.terminals[0].state, "live");
  console.log(
    "PASS: discovered exact Herdr terminal, input reached original process, repeated connect reused mobile view, closing mobile preserved original PID",
  );
} finally {
  await run("tmux", ["kill-server"]);
  if (address) await run("herdr-core", ["kill", address]);
  await run("herdr-core", ["server", "stop"]);
  await Deno.remove(dir, { recursive: true });
}
