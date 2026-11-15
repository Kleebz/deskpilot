// Explicitly exercises the installed app with one disposable space and shells.
// No agent/model request; closes only our exact space and restores app focus.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { HerdrManagement } from "../server/herdr-management.ts";
import { readHerdr } from "../server/herdr.ts";
if (!Deno.args.includes("--running")) {
  throw Error(
    "Pass --running to test the installed Herdr app with disposable shells.",
  );
}
const run = async (command: string, args: string[]) => {
  const r = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: r.code,
    out: new TextDecoder().decode(r.stdout),
    err: new TextDecoder().decode(r.stderr),
  };
};
const adapter = new HerdrManagement(run),
  before = await adapter.list(true),
  original = await readHerdr();
assert(before.writable, before.reason);
const dir = await Deno.makeTempDir({ prefix: "deskpilot-herdr-management-" }),
  name = `Deskpilot-check-${crypto.randomUUID().slice(0, 8)}`;
let owned = "";
const wait = async (
  predicate: (s: Awaited<ReturnType<typeof adapter.list>>) => boolean,
) => {
  for (let i = 0; i < 80; i++) {
    const s = await adapter.list(true);
    if (s.writable && predicate(s)) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Herdr did not publish the expected layout");
};
try {
  await adapter.act({
    action: "space.new",
    core: before.core,
    name,
    folder: dir,
    command: "/bin/bash --noprofile --norc",
  }, run);
  let state = await wait((s) => s.spaces.some((p) => p.title === name));
  owned = state.spaces.find((p) => p.title === name)!.id;
  await adapter.act({
    action: "space.rename",
    core: state.core,
    spaceId: owned,
    name: name + " renamed",
  }, run);
  state = await wait((s) =>
    s.spaces.find((p) => p.id === owned)?.title === name + " renamed"
  );
  await adapter.act({
    action: "tab.new",
    core: state.core,
    spaceId: owned,
    name: "Second tab",
    folder: dir,
    command: "/bin/bash --noprofile --norc",
  }, run);
  state = await wait((s) =>
    s.spaces.find((p) => p.id === owned)?.tabs.length === 2
  );
  let tab = state.spaces.find((p) => p.id === owned)!.tabs.find((t) =>
    t.title === "Second tab"
  )!;
  await adapter.act({
    action: "tab.rename",
    core: state.core,
    spaceId: owned,
    tabId: tab.id,
    name: "Split check",
  }, run);
  state = await wait((s) =>
    s.spaces.find((p) => p.id === owned)?.tabs.some((t) =>
      t.id === tab.id && t.title === "Split check"
    ) ?? false
  );
  await adapter.act({
    action: "pane.split",
    core: state.core,
    spaceId: owned,
    tabId: tab.id,
    folder: dir,
    command: "/bin/bash --noprofile --norc",
    direction: "right",
  }, run);
  state = await wait((s) =>
    (s.spaces.find((p) => p.id === owned)?.tabs.find((t) => t.id === tab.id)
      ?.terminals.length ?? 0) === 2
  );
  const ids = state.spaces.find((p) =>
    p.id === owned
  )!.tabs.find((t) => t.id === tab.id)!.terminals;
  await adapter.act({
    action: "tab.move",
    core: state.core,
    spaceId: owned,
    tabId: tab.id,
    index: 1,
  }, run);
  state = await wait((s) =>
    s.spaces.find((p) => p.id === owned)?.tabs[0].id === tab.id
  );
  await adapter.act({
    action: "terminal.stop",
    core: state.core,
    spaceId: owned,
    terminalId: ids[1],
    expected: ids[1],
  }, run);
  state = await wait((s) =>
    (s.spaces.find((p) => p.id === owned)?.tabs.find((t) => t.id === tab.id)
      ?.terminals.length ?? 0) === 1
  );
  tab = state.spaces.find((p) => p.id === owned)!.tabs.find((t) =>
    t.id === tab.id
  )!;
  await adapter.act({
    action: "tab.close",
    core: state.core,
    spaceId: owned,
    tabId: tab.id,
    expected: tab.revision,
  }, run);
  state = await wait((s) =>
    s.spaces.find((p) => p.id === owned)?.tabs.length === 1
  );
  const own = state.spaces.find((p) => p.id === owned)!;
  await adapter.act({
    action: "space.close",
    core: state.core,
    spaceId: owned,
    expected: own.revision,
  }, run);
  await wait((s) => !s.spaces.some((p) => p.id === owned));
  const after = await readHerdr();
  for (const raw of original.terminals) {
    const same = after.terminals.find((t) => t.address === raw.address);
    assert(same, "Original terminal vanished");
    assertEquals(same.pid, raw.pid);
  }
  console.log(
    "PASS native create/rename/tab/split/reorder/stop/close; original terminal PIDs preserved",
  );
} finally {
  const state = await adapter.list(true);
  const space = state.spaces.find((s) => s.id === owned);
  if (space && space.title.startsWith(name)) {
    await adapter.act({
      action: "space.close",
      core: state.core,
      spaceId: space.id,
      expected: space.revision,
    }, run);
  }
  if (
    before.activeSpace && state.spaces.some((s) => s.id === before.activeSpace)
  ) {
    await run("herdr-app", [
      "do",
      "space.select",
      JSON.stringify({ id: before.activeSpace }),
    ]);
  }
  await Deno.remove(dir, { recursive: true });
}
