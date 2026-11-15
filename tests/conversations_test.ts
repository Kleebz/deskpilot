import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  codexAttachArgs,
  codexDaemon,
  conversation,
  ConversationError,
  Conversations,
  mobileSession,
  type Run,
} from "../server/conversations.ts";
import type { CodexConnection } from "../server/codex-rpc.ts";

const id = "01a17c34-6e86-7d21-9b81-915de263226a";
const other = "01a17c34-6e86-7d21-9b81-915de263226b";
const socket = "/tmp/local codex/server.sock";
const sample = (overrides = {}) => ({
  id,
  cwd: "/project/with spaces",
  name: "Same title",
  sessionId: id,
  canAcceptDirectInput: true,
  status: { type: "idle" },
  ...overrides,
});
const ok = (out = "") => ({ code: 0, out, err: "" });

function fixture() {
  const state = {
    threads: [sample()],
    linked: new Map<string, string>(),
    occupied: false,
    dead: false,
    closed: 0,
    launched: [] as string[][],
    calls: [] as string[],
    connections: 0,
    failure: false,
  };
  const run: Run = (_cmd, args) => {
    if (args[0] === "list-sessions") {
      return Promise.resolve(ok(
        [...state.linked].map(([thread, name]) =>
          `${name}\t${thread}\t${socket}\t${state.dead ? 1 : 0}`
        ).join("\n"),
      ));
    }
    if (args[0] === "has-session") {
      return Promise.resolve({
        code: state.occupied ? 0 : 1,
        out: "",
        err: "",
      });
    }
    if (args[0] === "new-session") {
      state.launched.push(args);
      if (state.failure) {
        return Promise.resolve({ code: 1, out: "", err: "failed" });
      }
      const thread = args[args.indexOf("resume") + 1];
      state.linked.set(thread, args[args.indexOf("-s") + 1]);
      return Promise.resolve(ok());
    }
    throw Error(`Unexpected subprocess: ${args}`);
  };
  const connect = (): Promise<CodexConnection> => {
    state.connections++;
    return Promise.resolve({
      call(method, params) {
        state.calls.push(method);
        if (method === "thread/loaded/list") {
          return Promise.resolve({ data: state.threads.map((t) => t.id) });
        }
        if (method === "thread/read") {
          return Promise.resolve({
            thread: state.threads.find((t) => t.id === params?.threadId),
          });
        }
        throw Error(`Unexpected agent operation: ${method}`);
      },
      close() {
        state.closed++;
        return Promise.resolve();
      },
    });
  };
  const adapter = new Conversations(
    run,
    "/bin/bash",
    () => Promise.resolve({ socket }),
    connect,
  );
  return { state, run, adapter };
}

Deno.test("Codex discovery only inspects an already running daemon", async () => {
  const calls: string[][] = [];
  assertEquals(
    await codexDaemon((_cmd, args) => {
      calls.push(args);
      return Promise.resolve(
        ok(JSON.stringify({ status: "running", socketPath: socket })),
      );
    }),
    { socket },
  );
  assertEquals(calls, [["app-server", "daemon", "version"]]);
  for (
    const value of [{ status: "stopped" }, {
      status: "running",
      socketPath: "ws://other-host",
    }, { status: "running", socketPath: "/tmp/invalid\nsocket" }]
  ) {
    await assertRejects(
      () => codexDaemon(() => Promise.resolve(ok(JSON.stringify(value)))),
      ConversationError,
    );
  }
});

Deno.test("only live addressable root conversations are offered", () => {
  assertEquals(conversation(sample())?.id, id);
  for (
    const value of [
      sample({ id: "--last" }),
      sample({ cwd: "relative" }),
      sample({ canAcceptDirectInput: false }),
      sample({ parentThreadId: other }),
      sample({ forkedFromId: other, sessionId: other }),
      sample({ status: { type: "notLoaded" } }),
    ]
  ) assertEquals(conversation(value), null);
  assertEquals(
    conversation(sample({ name: "hello\nworld\x1b" }))?.title,
    "hello world",
  );
});

Deno.test("mobile attachment pins exact conversation and server without overriding permissions", () => {
  const thread = conversation(sample({ cwd: "/tmp/quotes ' $() ; spaces" }))!;
  const args = codexAttachArgs(thread, { socket }, "/bin/bash");
  assertEquals(args.slice(args.indexOf("codex"), args.indexOf(";")), [
    "codex",
    "--remote",
    `unix://${socket}`,
    "resume",
    id,
    "--cd",
    thread.path,
    "--no-alt-screen",
  ]);
  assert(mobileSession(thread).length <= 64);
});

Deno.test("mobile view title metadata preserves unicode without tmux command syntax", () => {
  const thread = conversation(
    sample({ name: "Review λ 🐈 ; #{session_name}" }),
  )!;
  const args = codexAttachArgs(thread, { socket }, "/bin/bash");
  const encoded = args[args.indexOf("@deskpilot-codex-title64") + 1];
  assert(/^[A-Za-z0-9+/=]+$/.test(encoded));
  assertEquals(
    new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    ),
    thread.title,
  );
});

Deno.test("discovery is read-only, cached, and shared across simultaneous pollers", async () => {
  const { adapter, state } = fixture();
  const [a, b] = await Promise.all([adapter.list(), adapter.list()]);
  assertEquals(a, b);
  assertEquals(a.items[0].session, null);
  assertEquals(state.connections, 1);
  assertEquals(state.closed, 1);
  assertEquals(state.launched, []);
  assertEquals(state.calls, ["thread/loaded/list", "thread/read"]);
});

Deno.test("repeated and concurrent connect requests reuse one terminal", async () => {
  const { adapter, state, run } = fixture();
  const [a, b] = await Promise.all([
    adapter.enable(id, run),
    adapter.enable(id, run),
  ]);
  assertEquals(a.session, b.session);
  assertEquals([a.reused, b.reused], [false, true]);
  assertEquals(state.launched.length, 1);
  assertEquals(state.closed, 2);
  assertEquals((await adapter.list()).items[0].session, a.session);
});

Deno.test("same title and working directory never substitute one conversation for another", async () => {
  const { adapter, state, run } = fixture();
  state.threads.push(sample({ id: other, sessionId: other }));
  const a = await adapter.enable(id, run), b = await adapter.enable(other, run);
  assert(a.session !== b.session);
  assertEquals(state.launched.map((args) => args[args.indexOf("resume") + 1]), [
    id,
    other,
  ]);
});

Deno.test("invalid, stale, and unrelated occupied sessions cause no terminal mutation", async () => {
  const { adapter, state, run } = fixture();
  await assertRejects(() => adapter.enable("--last", run), ConversationError);
  assertEquals(state.connections, 0);
  await adapter.list();
  state.threads = [];
  await assertRejects(
    () => adapter.enable(id, run),
    ConversationError,
    "no longer running",
  );
  state.threads = [sample()];
  state.occupied = true;
  await assertRejects(
    () => adapter.enable(id, run),
    ConversationError,
    "already uses this name",
  );
  assertEquals(state.launched, []);
});

Deno.test("revocation or failed creation releases the gate without changing the desktop", async () => {
  const { adapter, state, run } = fixture();
  await assertRejects(
    () => adapter.enable(id, () => Promise.reject(Error("revoked"))),
    Error,
    "revoked",
  );
  assertEquals(state.launched, []);
  state.failure = true;
  await assertRejects(
    () => adapter.enable(id, run),
    ConversationError,
    "desktop conversation is unchanged",
  );
  state.failure = false;
  assertEquals((await adapter.enable(id, run)).reused, false);
  assertEquals(state.closed, 3);
});

Deno.test("missing optional Codex leaves ordinary session discovery independent", async () => {
  const adapter = new Conversations(
    () => Promise.resolve({ code: 127, out: "", err: "missing" }),
    "/bin/bash",
  );
  assertEquals(await adapter.list(), { available: false, items: [] });
});
