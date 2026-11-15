import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  HerdrManagement,
  managementLayout,
} from "../server/herdr-management.ts";
import { HerdrError } from "../server/herdr.ts";
import type { Run } from "../server/conversations.ts";
const core = "0123456789abcdef0123456789abcdef";
const terminal = (address = "t1", created_ms = 1234) => ({
  address,
  created_ms,
  state: "live",
  cwd: "/project",
  title: "Work",
  status: { state: "working" },
});
const node = (address: string, id = "pane-1") => ({
  id,
  type: "block",
  content: { terminal: address },
});
function fixture() {
  const state = {
    core,
    terminals: [terminal()],
    layout: {
      spaces: [{
        id: "space-a",
        name: "Project",
        folder: "/project",
        tabs: [{ id: "tab-a", name: "Build", root: node("t1") }],
      }],
    },
    app: true,
    commands: [] as Array<{ cmd: string; args: string[] }>,
  };
  const run: Run = async (cmd, args) => {
    if (cmd === "herdr-app" && args[0] === "ls") {
      return {
        code: state.app ? 0 : 1,
        out: JSON.stringify({
          spaces: state.layout.spaces.map((s) => ({ ...s, machine: null })),
        }),
        err: "",
      };
    }
    if (cmd === "herdr-app" && args[0] === "status") {
      return {
        code: state.app ? 0 : 1,
        out: JSON.stringify({ space: "space-a", tab: "tab-a" }),
        err: "",
      };
    }
    throw Error("Unexpected read");
  };
  const authorized: Run = async (cmd, args) => {
    state.commands.push({ cmd, args });
    return { code: 0, out: "null", err: "" };
  };
  const read = () => Promise.resolve(state);
  return {
    state,
    adapter: new HerdrManagement(run, read, "/bin/bash"),
    authorized,
  };
}
Deno.test("Herdr management reads exact local hierarchy including tabs with no terminal", async () => {
  const { state, adapter } = fixture();
  state.layout.spaces[0].tabs.push(
    {
      id: "tab-mod",
      name: "Files",
      root: { id: "mod-pane", type: "block", content: { mod: "files" } },
    } as any,
  );
  const result = await adapter.list();
  assert(result.writable);
  assertEquals(result.activeTab, "tab-a");
  assertEquals(result.spaces[0].tabs[1].terminals, []);
  assertEquals(result.spaces[0].tabs[1].panes, 1);
  assertEquals(state.commands, []);
});
Deno.test("closed Herdr app leaves native layout readable and mutations unavailable", async () => {
  const { state, adapter, authorized } = fixture();
  state.app = false;
  const result = await adapter.list();
  assert(result.available && !result.writable);
  assert(result.spaces.length === 1);
  await assertRejects(
    () =>
      adapter.act({
        action: "space.rename",
        core,
        spaceId: "space-a",
        name: "Changed",
      }, authorized),
    HerdrError,
    "Open Herdr",
  );
  assertEquals(state.commands, []);
});
Deno.test("native commands pin ids and preserve literal names/commands as JSON argv", async () => {
  const { state, adapter, authorized } = fixture();
  const name = 'literal $(touch /tmp/wrong) "name"';
  await adapter.act(
    { action: "space.rename", core, spaceId: "space-a", name },
    authorized,
  );
  assertEquals(state.commands[0], {
    cmd: "herdr-app",
    args: ["do", "space.rename", JSON.stringify({ name, id: "space-a" })],
  });
  await adapter.act({
    action: "tab.new",
    core,
    spaceId: "space-a",
    name: "Review",
    folder: "/folder/with ' spaces",
    command: "printf '%s' literal",
  }, authorized);
  const params = JSON.parse(state.commands[1].args[2]);
  assertEquals(params.space, "space-a");
  assertEquals(params.folder, "/folder/with ' spaces");
  assertEquals(params.argv, ["/bin/bash", "-lc", "printf '%s' literal"]);
});
Deno.test("close rejects newly added/replaced work and requires renewed review", async () => {
  const { state, adapter, authorized } = fixture();
  const reviewed = (await adapter.list()).spaces[0];
  state.terminals.push(terminal("t2"));
  state.layout.spaces[0].tabs[0].root = {
    type: "row",
    children: [node("t1"), node("t2", "pane-2")],
  } as any;
  await assertRejects(
    () =>
      adapter.act({
        action: "space.close",
        core,
        spaceId: "space-a",
        expected: reviewed.revision,
      }, authorized),
    HerdrError,
    "changed",
  );
  assertEquals(state.commands, []);
  const fresh = (await adapter.list(true)).spaces[0];
  await adapter.act({
    action: "space.close",
    core,
    spaceId: "space-a",
    expected: fresh.revision,
  }, authorized);
  assertEquals(JSON.parse(state.commands[0].args[2]), {
    id: "space-a",
    confirmed: true,
  });
});
Deno.test("stale core, foreign IDs, unreviewed close and unsupported transfer cause no commands", async () => {
  const { state, adapter, authorized } = fixture();
  for (
    const body of [
      {
        action: "space.rename",
        core: "f".repeat(32),
        spaceId: "space-a",
        name: "x",
      },
      {
        action: "tab.rename",
        core,
        spaceId: "space-a",
        tabId: "other",
        name: "x",
      },
      { action: "space.close", core, spaceId: "space-a" },
      { action: "tab.transfer", core, spaceId: "space-a", tabId: "tab-a" },
      { action: "space.move", core, spaceId: "space-a", index: 0 },
    ]
  ) await assertRejects(() => adapter.act(body, authorized), HerdrError);
  assertEquals(state.commands, []);
});
Deno.test("native terminal stop uses its exact pane and generation, not its mobile view", async () => {
  const { state, adapter, authorized } = fixture();
  const id = `${core}/t1/1234`;
  await adapter.act({
    action: "terminal.stop",
    core,
    spaceId: "space-a",
    terminalId: id,
    expected: id,
  }, authorized);
  assertEquals(state.commands[0], {
    cmd: "herdr-app",
    args: ["do", "pane.close", JSON.stringify({ pane: "pane-1" })],
  });
  state.terminals = [terminal("t1", 1235)];
  await assertRejects(
    () =>
      adapter.act({
        action: "terminal.stop",
        core,
        spaceId: "space-a",
        terminalId: id,
        expected: id,
      }, authorized),
    HerdrError,
    "changed",
  );
  assertEquals(state.commands.length, 1);
});
Deno.test("revoked actions never reach native commands and release the mutation queue", async () => {
  const { state, adapter, authorized } = fixture();
  const body = {
    action: "tab.rename",
    core,
    spaceId: "space-a",
    tabId: "tab-a",
    name: "New",
  };
  await assertRejects(
    () => adapter.act(body, () => Promise.reject(Error("revoked"))),
    Error,
    "revoked",
  );
  await adapter.act(body, authorized);
  assertEquals(state.commands.length, 1);
  const spaces = await managementLayout(state);
  assert(spaces[0].revision.length === 64);
});
