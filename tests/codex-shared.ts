// Optional live compatibility check: no prompts or model calls, only a
// disposable conversation and two TUIs on an isolated app-server and tmux socket.
// deno run -A tests/codex-shared.ts [--running] [--exercise]
// --running checks the installed daemon; --exercise makes one real model turn
// in the disposable conversation and closes mobile while its shell tool runs.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { connectCodex } from "../server/codex-rpc.ts";
import {
  codexDaemon,
  conversation,
  Conversations,
} from "../server/conversations.ts";

const dir = await Deno.makeTempDir({ prefix: "deskpilot-shared-check-" });
const cwd = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
let socket = `${dir}/server.sock`;
const tmuxSocket = `${dir}/tmux.sock`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shared = Deno.args.includes("--running");
const server = shared ? null : new Deno.Command("codex", {
  args: ["app-server", "--listen", `unix://${socket}`],
  stdout: "null",
  stderr: "null",
}).spawn();
const status = server?.status;
let rpc: Awaited<ReturnType<typeof connectCodex>> | undefined;
let id = "";
let toolRunning = false;
async function run(command: string, args: string[]) {
  const output = await new Deno.Command(command, {
    args: command === "tmux" ? ["-S", tmuxSocket, ...args] : args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const result = {
    code: output.code,
    out: new TextDecoder().decode(output.stdout),
    err: new TextDecoder().decode(output.stderr),
  };
  if (result.code && args[0] === "new-session") console.error(result.err);
  return result;
}
try {
  if (shared) socket = (await codexDaemon(run)).socket;
  for (let i = 0; i < 100; i++) {
    try {
      await Deno.stat(socket);
      break;
    } catch {
      await sleep(50);
    }
  }
  rpc = await connectCodex(socket, 120000, (message) => {
    const item = message.params?.item;
    if (
      message.method === "item/started" && item?.type === "commandExecution" &&
      String(item.command).includes("sleep")
    ) toolRunning = true;
  });
  const baseline = (await rpc.call("thread/loaded/list", {})).data;
  const started = await rpc.call("thread/start", {
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
  });
  id = started.thread.id;
  console.log(`Disposable test conversation: ${id}`);
  await rpc.call("thread/name/set", {
    threadId: id,
    name: "Deskpilot disposable shared-session check",
  });
  const before = await rpc.call("thread/resume", {
    threadId: id,
    excludeTurns: true,
  });
  assert(conversation(before.thread), "test conversation is eligible");
  const original = await run("tmux", [
    "new-session",
    "-d",
    "-s",
    "original",
    "-c",
    cwd,
    "--",
    "codex",
    "--remote",
    `unix://${socket}`,
    "resume",
    id,
    "--cd",
    cwd,
  ]);
  assertEquals(original.code, 0, original.err);
  const adapter = new Conversations(
    run,
    "/bin/bash",
    () => Promise.resolve({ socket }),
    connectCodex,
  );
  const connected = await adapter.enable(id, run);
  assertEquals((await adapter.enable(id, run)).session, connected.session);
  assertEquals(
    (await adapter.list()).items.find((t: any) => t.id === id)?.session,
    connected.session,
  );
  await sleep(2500);
  for (const name of ["original", connected.session]) {
    const captured = await run("tmux", ["capture-pane", "-pt", `=${name}:`]);
    assertEquals(captured.code, 0, captured.err);
    assert(captured.out.includes("Codex"), captured.out);
    assert(!captured.out.includes("Trust this folder"), captured.out);
    assert(
      !captured.out.includes("already has an active writer"),
      captured.out,
    );
    console.log(
      `PASS ${
        name === "original" ? "original" : "mobile"
      }: same conversation attached without a trust override`,
    );
  }
  const after = await rpc.call("thread/resume", {
    threadId: id,
    excludeTurns: true,
  });
  assertEquals(after.thread.id, before.thread.id);
  assertEquals(after.approvalPolicy, before.approvalPolicy);
  assertEquals(after.sandbox, before.sandbox);
  assertEquals(after.thread.status.type, "idle");
  assertEquals(
    (await rpc.call("thread/loaded/list", {})).data.sort(),
    [...baseline, id].sort(),
  );
  if (Deno.args.includes("--exercise")) {
    await rpc.call("turn/start", {
      threadId: id,
      input: [{
        type: "text",
        text:
          "This is a disposable Deskpilot connectivity test. Run the shell command sleep 8 once, then reply with exactly DESKPILOT_SHARED_OK. Do not inspect or modify any files.",
      }],
    });
    let running = false;
    for (let i = 0; i < 100; i++) {
      if (toolRunning) {
        running = true;
        break;
      }
      await sleep(500);
    }
    assert(running, "disposable shell tool started");
    await run("tmux", ["kill-session", "-t", `=${connected.session}`]);
    let completed = false;
    for (let i = 0; i < 100; i++) {
      const turns = await rpc.call("thread/turns/list", {
        threadId: id,
        limit: 1,
        sortDirection: "desc",
        itemsView: "full",
      });
      if (
        turns.data?.some((turn: any) =>
          turn.status === "completed" &&
          turn.items?.some((item: any) =>
            item.type === "agentMessage" &&
            item.text?.includes("DESKPILOT_SHARED_OK")
          )
        )
      ) {
        completed = true;
        break;
      }
      await sleep(500);
    }
    assert(
      completed,
      "original agent completed after mobile terminal was closed",
    );
    await sleep(300);
    const capture = await run("tmux", ["capture-pane", "-Jpt", "=original:"]);
    assert(
      capture.out.includes("DESKPILOT_SHARED_OK"),
      "original terminal received the completed reply",
    );
    console.log(
      "PASS live tool and reply continued in the original terminal after closing mobile mid-turn",
    );
  }
  await run("tmux", ["kill-session", "-t", `=${connected.session}`]);
  assertEquals((await run("tmux", ["has-session", "-t", "=original"])).code, 0);
  assertEquals(
    (await rpc.call("thread/read", { threadId: id })).thread.status.type,
    "idle",
  );
  console.log(
    "PASS no additional agent, no prompt, permissions retained, original terminal survives closing mobile",
  );
} finally {
  await run("tmux", ["kill-server"]);
  if (rpc) {
    if (id) await rpc.call("thread/delete", { threadId: id }).catch(() => {});
    await rpc.close();
  }
  try {
    server?.kill();
  } catch { /* already exited */ }
  await status;
  await Deno.remove(dir, { recursive: true });
}
