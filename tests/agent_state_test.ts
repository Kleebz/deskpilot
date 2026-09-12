import { assertEquals } from "jsr:@std/assert@1";
import { AgentStates } from "../server/agent-state.ts";

function store(lease = 1_000) {
  const path = Deno.makeTempFileSync({ suffix: ".json" });
  return {
    path,
    states: new AgentStates(path, (s) => /^[\w.-]+$/.test(s), lease, 60_000),
  };
}

const report = (
  state: "working" | "blocked" | "done",
  observedAt: number,
  extra = {},
) => ({
  state,
  observedAt,
  source: "test",
  sourceSession: "run-1",
  ...extra,
});

Deno.test("newer lifecycle reports win even when an old async hook arrives later", () => {
  const { states } = store();
  assertEquals(states.report("work", report("done", 200), 250), true);
  assertEquals(states.report("work", report("working", 100), 300), false);
  assertEquals(states.view("work", 300).state, "done");
});

Deno.test("an event from a retired agent run cannot replace its successor", () => {
  const { states } = store();
  states.report("work", report("working", 100), 100);
  states.report(
    "work",
    { ...report("done", 200), sourceSession: "run-2" },
    200,
  );
  assertEquals(states.report("work", report("blocked", 300), 300), false);
  assertEquals(states.view("work", 300).state, "done");
});

Deno.test("working expires to unknown while blocked and done remain authoritative", () => {
  const { states } = store(1_000);
  states.report("work", report("working", 100), 100);
  assertEquals(states.view("work", 1_101), {
    state: "unknown",
    since: 100,
    stale: true,
    canApprove: false,
  });
  states.report("work", report("blocked", 2_000), 2_000);
  assertEquals(states.view("work", 20_000).state, "blocked");
});

Deno.test("approval is request-specific, consumed once, and resumes working", () => {
  const { states } = store();
  states.report(
    "work",
    report("blocked", 100, {
      requestId: "request-1",
      tool: "Bash",
      canApprove: true,
    }),
    100,
  );
  assertEquals(states.approve("work", "wrong", 1_000, 200), "missing");
  assertEquals(states.approve("work", "request-1", 1_000, 200), "ok");
  assertEquals(states.approve("work", "request-1", 1_000, 201), "missing");
  assertEquals(states.view("work", 201).state, "working");
});

Deno.test("approval capability does not survive a server restart", async () => {
  const { path, states } = store();
  states.report(
    "work",
    report("blocked", 100, {
      requestId: "request-1",
      tool: "Bash",
      canApprove: true,
    }),
    100,
  );
  await states.flush();
  assertEquals(Deno.readTextFileSync(path).includes("request-1"), false);
  const restored = new AgentStates(path, () => true);
  assertEquals(restored.view("work", 200).state, "blocked");
  assertEquals(restored.view("work", 200).canApprove, false);
  assertEquals(restored.approve("work", "request-1", 1_000, 200), "missing");
});

Deno.test("rename and prune carry or remove lifecycle and pending state", () => {
  const { states } = store();
  states.report(
    "old",
    report("blocked", 100, { requestId: "r", canApprove: true }),
    100,
  );
  states.rename("old", "new");
  assertEquals(states.view("old").state, "unknown");
  assertEquals(states.view("new", 200).state, "blocked");
  assertEquals(states.approve("new", "r", 1_000, 200), "ok");
  states.prune([]);
  assertEquals(states.view("new").state, "unknown");
});
