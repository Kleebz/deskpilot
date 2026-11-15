import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  liveItems,
  routeItem,
  sourceKey,
  sourceRef,
} from "../web/src/lib/spaces/live-model.js";
import {
  terminalIdentity,
  terminalTarget,
} from "../server/terminal-identity.ts";
import { keysCommand } from "../server/control.ts";
import { readResume, writeResume } from "../web/src/lib/resume.js";
Deno.test("runtime identity survives rename and refuses a same-name replacement", () => {
  const first = liveItems("host", [{
    session: "old",
    terminalId: "$1",
    generation: "11:22:33",
  }])[0];
  const renamed = liveItems("host", [{
    session: "new",
    terminalId: "$1",
    generation: "11:22:33",
  }])[0];
  assertEquals(
    sourceKey("host", sourceRef(first)),
    sourceKey("host", sourceRef(renamed)),
  );
  assertEquals(
    routeItem({ host: "host", ref: sourceRef(first) }, [renamed]),
    renamed,
  );
  const replaced = liveItems("host", [{
    session: "old",
    terminalId: "$2",
    generation: "11:22:34",
  }])[0];
  assertEquals(
    routeItem({ host: "host", ref: sourceRef(first) }, [replaced]),
    undefined,
  );
  assert(
    sourceKey("host", sourceRef(first)) !==
      sourceKey("host", sourceRef(replaced)),
  );
});
Deno.test("conversation identity is independent of its mobile bridge and native bridges retain source ownership during discovery loss", () => {
  const [first] = liveItems("host", [{
    session: "mobile",
    codexThreadId: "thread",
    terminalId: "$1",
    generation: "bridge-one",
  }]);
  const [next] = liveItems("host", [{
    session: "new-mobile",
    codexThreadId: "thread",
    terminalId: "$2",
    generation: "bridge-two",
  }]);
  assertEquals(sourceRef(first), sourceRef(next));
  const native = liveItems("host", [{
    session: "bridge",
    herdrId: "core/address/created",
  }]);
  assertEquals(native.length, 1);
  assertEquals(native[0].source, "Herdr");
  assertEquals(native[0].id, "core/address/created");
  const attached = liveItems(
    "host",
    [{ session: "new-bridge", herdrId: "core/address/created" }],
    [],
    [{ id: "core/address/created", title: "Pane", session: null }],
  );
  assertEquals(attached[0].session, "new-bridge");
  assertEquals(attached[0].connected, true);
});
Deno.test("terminal target resolves a stable ID and rejects changed generations before input", async () => {
  assertEquals(terminalIdentity("$1", "11", "22", "33"), {
    terminalId: "$1",
    generation: "11:22:33",
  });
  assertEquals(terminalIdentity("unsafe", "11", "22", "33"), null);
  const run = () => Promise.resolve({ code: 0, out: "$1\t11\t22\t33\n" });
  assertEquals(
    await terminalTarget(
      "name",
      { terminalId: "$1", generation: "11:22:33" },
      run,
    ),
    "$1",
  );
  assertEquals(
    await terminalTarget(
      "name",
      { terminalId: "$1", generation: "different" },
      run,
    ),
    null,
  );
  assertEquals(keysCommand("$1", "a"), ["send-keys -t '$1' -H 61"]);
});
Deno.test("resume preserves stable drafts and earlier unclaimed drafts without credentials or native actions", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    };
  const ref = { kind: "session", id: "$1", generation: "11:22:33" };
  const key = sourceKey("host", ref);
  writeResume(storage, {
    route: {
      host: "host",
      view: "terminal",
      session: "name",
      ref,
      order: [ref],
      scope: "scope",
      across: true,
    },
    drafts: {
      [key]: { input: "stable", clip: "paste" },
      '["host","name"]': { input: "earlier", clip: "" },
    },
    spaces: { host: { expanded: { "local:one": true }, scroll: 120, showHidden:true } },
    token: "secret",
  }, ["host"]);
  const saved = readResume(storage, ["host"])!;
  assertEquals(saved.route?.ref, ref);
  assertEquals(saved.drafts[key].input, "stable");
  assertEquals(saved.drafts['["host","name"]'].input, "earlier");
  assertEquals(saved.spaces.host.scroll, 120);
  assertEquals(saved.spaces.host.showHidden,true);
  assert(!values.values().next().value?.includes("secret"));
});

Deno.test("available conversations stay separate and hidden identities remain scoped and restorable", async () => {
  const { spacesFor, taskFor, findWork, hiddenWork, draftKey } = await import(
    "../web/src/lib/spaces/model.js"
  );
  const { restoreOrganization } = await import(
    "../web/src/lib/spaces/organization-client.js"
  );
  const conversation = {
    id: "thread",
    computer: "host",
    source: "Codex",
    generation: "thread:thread",
    name: "Duplicate",
    cwd: "/project",
    status: "unknown",
  };
  const shell = {
    ...conversation,
    id: "$1",
    source: "Terminal",
    generation: "one",
  };
  const native = {
    ...conversation,
    id: "native/1",
    source: "Herdr",
    spaceId: "native",
    tabId: "tab",
  };
  let state: any = {
    computer: "host",
    computers: [{ id: "host", health: "online" }, {
      id: "other",
      health: "online",
    }],
    items: [shell, native, conversation, {
      ...conversation,
      computer: "other",
    }],
    workSpaces: [],
    workAssignments: {},
  };
  assertEquals(
    spacesFor(state).find((s) => s.unassigned)?.tabs.flatMap((t: any) =>
      t.items
    ),
    [shell],
  );
  assertEquals(
    taskFor(state, conversation)?.space.name,
    "Available conversations",
  );
  state = restoreOrganization(state, "host", {
    version: 1,
    revision: 1,
    spaces: [],
    assignments: [],
    hidden: [{
      kind: "conversation",
      id: "thread",
      generation: "thread:thread",
    }],
  });
  assertEquals(findWork(state, "Duplicate").map((i: any) => i.source), [
    "Terminal",
    "Herdr",
  ]);
  assertEquals(findWork(state, "", false, true).length, 3);
  assertEquals(spacesFor(state).some((s) => s.available || s.hidden), false);
  assertEquals(
    hiddenWork(state, { ...conversation, generation: "new" }),
    false,
  );
  state.workShowHidden = true;
  assertEquals(findWork(state, "Duplicate").length, 3);
  assertEquals(
    taskFor(state, conversation)?.space.name,
    "Hidden conversations",
  );
  state = restoreOrganization(state, "host", {
    version: 1,
    revision: 2,
    spaces: [{
      id: "local",
      name: "Project",
      tabs: [{ id: "task", name: "Work" }],
    }],
    assignments: [{
      source: {
        kind: "conversation",
        id: "thread",
        generation: "thread:thread",
      },
      task: "task",
    }],
  });
  assertEquals(taskFor(state, conversation)?.space.name, "Project");
  assertEquals(state.workAssignments[draftKey(conversation)], "task");
  assertEquals(state.items.length, 4);
});
