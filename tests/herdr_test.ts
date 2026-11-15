import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  Herdr,
  herdrAttachArgs,
  HerdrError,
  herdrLayout,
  herdrSession,
  herdrTerminal,
} from "../server/herdr.ts";
import type { Run } from "../server/conversations.ts";

const core = "0123456789abcdef0123456789abcdef";
const raw = (overrides = {}) => ({
  address: "t1",
  created_ms: 1793397428670,
  state: "live",
  cwd: "/project",
  title: "Project terminal",
  status: { app: "codex", state: "working" },
  ...overrides,
});
const ok = (out = "") => ({ code: 0, out, err: "" });
function fixture() {
  const state = {
    core,
    terminals: [raw()],
    linked: new Map<string, string>(),
    dead: false,
    occupied: false,
    created: [] as string[][],
    reads: 0,
  };
  const run: Run = (_command, args) => {
    if (args[0] === "list-sessions") {
      return Promise.resolve(ok(
        [...state.linked].map(([id, name]) =>
          `${name}\t${id}\t${state.dead ? 1 : 0}`
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
      state.created.push(args);
      state.linked.set(
        args[args.indexOf("@deskpilot-herdr-id") + 1],
        args[args.indexOf("-s") + 1],
      );
      return Promise.resolve(ok());
    }
    throw Error(`Unexpected command: ${args}`);
  };
  const read = () => {
    state.reads++;
    return Promise.resolve({ core: state.core, terminals: state.terminals });
  };
  return { state, run, adapter: new Herdr(run, "/bin/bash", read) };
}

Deno.test("Herdr discovery accepts only live local terminals with exact generation identity", () => {
  assertEquals(herdrTerminal(core, raw())?.state, "working");
  assertEquals(
    herdrTerminal(
      core,
      raw({ foreground: { cwd: "/current", name: "bash" }, status: null }),
    )?.path,
    "/current",
  );
  for (
    const invalid of [
      raw({ state: "finished" }),
      raw({ address: "server/t1" }),
      raw({ address: "--last" }),
      raw({ created_ms: null }),
      raw({ cwd: "relative" }),
      raw({ cwd: "/x\nwrong" }),
    ]
  ) {
    assertEquals(herdrTerminal(core, invalid), null);
  }
  assertEquals(herdrTerminal("invalid", raw()), null);
});

Deno.test("Herdr polling is read-only, cached, and shares concurrent discovery", async () => {
  const { state, adapter } = fixture();
  const [a, b] = await Promise.all([adapter.list(), adapter.list()]);
  assertEquals(a, b);
  assertEquals(a.items[0].session, null);
  assertEquals(state.reads, 1);
  assertEquals(state.created, []);
});

Deno.test("Herdr attach pins terminal and preserves literal paths without a new program", () => {
  const terminal = herdrTerminal(
    core,
    raw({ cwd: "/path/with '$() ; spaces" }),
  )!;
  const args = herdrAttachArgs(terminal, "/bin/bash");
  assertEquals(args.slice(args.indexOf("herdr-core"), args.indexOf(";")), [
    "herdr-core",
    "attach",
    "--history",
    "1000",
    "t1",
  ]);
  assertEquals(args[args.indexOf("-c") + 1], terminal.path);
  assert(herdrSession(terminal).length <= 64);
  assert(args.includes("HC_SESSION=default"));
  assert(!args.includes("run") && !args.includes("kill"));
});

Deno.test("Herdr connects once and concurrent requests reuse the same live view", async () => {
  const { state, run, adapter } = fixture();
  const id = herdrTerminal(core, raw())!.id;
  const [a, b] = await Promise.all([
    adapter.enable(id, run),
    adapter.enable(id, run),
  ]);
  assertEquals(a.session, b.session);
  assertEquals([a.reused, b.reused], [false, true]);
  assertEquals(state.created.length, 1);
  assertEquals((await adapter.list()).items[0].session, a.session);
});

Deno.test("Herdr title duplicates never substitute for terminal identity", async () => {
  const { state, run, adapter } = fixture();
  state.terminals.push(raw({ address: "t2" }));
  const items = (await adapter.list()).items;
  const a = await adapter.enable(items[0].id, run);
  const b = await adapter.enable(items[1].id, run);
  assert(a.session !== b.session);
  assertEquals(
    state.created.map((args) => args[args.indexOf("--history") + 2]),
    ["t1", "t2"],
  );
});

Deno.test("stale cores, replaced terminals, revoked devices and occupied names do not attach", async () => {
  const { state, run, adapter } = fixture();
  const id = herdrTerminal(core, raw())!.id;
  await assertRejects(() => adapter.enable("--last", run), HerdrError);
  assertEquals(state.reads, 0);
  state.core = "f".repeat(32);
  await assertRejects(
    () => adapter.enable(id, run),
    HerdrError,
    "no longer running",
  );
  state.core = core;
  state.terminals = [raw({ created_ms: 1793397428671 })];
  await assertRejects(
    () => adapter.enable(id, run),
    HerdrError,
    "no longer running",
  );
  state.terminals = [raw()];
  await assertRejects(
    () => adapter.enable(id, () => Promise.reject(Error("revoked"))),
    Error,
    "revoked",
  );
  state.occupied = true;
  await assertRejects(
    () => adapter.enable(id, run),
    HerdrError,
    "already uses this name",
  );
  assertEquals(state.created, []);
  state.occupied = false;
  await adapter.enable(id, run);
  assertEquals(state.created.length, 1);
});

Deno.test("missing optional Herdr does not fail discovery", async () => {
  const { run } = fixture();
  const adapter = new Herdr(
    run,
    "/bin/bash",
    () => Promise.reject(Error("not installed")),
  );
  assertEquals(await adapter.list(), { available: false, items: [] });
});

Deno.test("Herdr layout preserves exact space/tab identities, ordering and split membership", () => {
  const terminals = [
    raw(),
    raw({ address: "t2" }),
    raw({ address: "t3", foreground: { cwd: "/current/project" } }),
  ];
  const node = (terminal: string) => ({ type: "block", content: { terminal } });
  const layout = {
    spaces: [
      {
        id: "space-a",
        name: "Same project",
        folder: "/old",
        tabs: [
          {
            id: "tab-review",
            name: "Review",
            root: {
              children: [node("t1"), {
                children: [node("t2"), { content: { mod: "files" } }],
              }],
            },
          },
        ],
      },
      {
        id: "space-b",
        name: "Same project",
        tabs: [{ id: "tab-work", root: node("t3") }],
      },
    ],
  };
  const grouped = herdrLayout(layout, terminals);
  assertEquals(grouped.get("t1")?.space.id, "space-a");
  assertEquals(grouped.get("t2")?.tab.id, "tab-review");
  assertEquals(grouped.get("t2")?.tab.title, "Review");
  assertEquals(grouped.get("t3")?.space.id, "space-b");
  assertEquals(grouped.get("t3")?.space.path, "/current/project");
  assertEquals(grouped.get("t3")?.space.order, 1);
  assertEquals(grouped.get("t3")?.tab.title, "Tab 1");
  assertEquals(herdrLayout(null, terminals).size, 0);
  assertEquals(
    herdrLayout({ spaces: [null, { id: "bad", tabs: null }] }, terminals).size,
    0,
  );
});

Deno.test("unnamed Herdr spaces follow current terminal folders", () => {
  const grouped = herdrLayout({
    spaces: [{
      id: "s",
      name: "",
      folder: "/stale",
      tabs: [{ id: "t", root: { content: { terminal: "t1" } } }],
    }],
  }, [raw({ foreground: { cwd: "/work/current-project" } })]);
  assertEquals(grouped.get("t1")?.space.title, "current-project");
});
