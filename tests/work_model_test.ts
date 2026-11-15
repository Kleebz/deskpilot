import { assertEquals } from "jsr:@std/assert@1";
import {
  attentionUnavailable,
  matchesWorkFilter,
  normalWork,
} from "../web/src/lib/work-model.js";

Deno.test("Work deduplicates shared views using explicit identity and preserves ordinary sessions", () => {
  const items = normalWork([
    { session: "native", herdrId: "native-id" },
    { session: "bridge" },
    { session: "renamed-mobile", codexThreadId: "thread" },
    { session: "shell", path: "/same" },
  ], [{
    id: "thread",
    title: "Review login",
    path: "/same",
    state: "working",
    session: "old-mobile",
  }], new Map([["bridge", {}]]));
  assertEquals(
    items.map((i: { kind: string; session: string }) => [i.kind, i.session]),
    [[
      "conversation",
      "renamed-mobile",
    ], ["session", "shell"]],
  );
  assertEquals(items[0].title, "Review login");
});

Deno.test("Codex attachment identity survives unavailable conversation discovery", () => {
  const items = normalWork([{
    session: "technical-name",
    codexThreadId: "thread",
    conversationTitle: "Human title",
    state: "working",
  }], []);
  assertEquals(items[0].kind, "conversation");
  assertEquals(items[0].title, "Human title");
  assertEquals(items[0].state, "unknown");
  assertEquals(
    normalWork([{ session: "technical-name", codexThreadId: "thread" }], [])[0]
      .title,
    "Codex conversation",
  );
});

Deno.test("attention filtering does not treat unknown or busy-only status as an all-clear", () => {
  const items = [
    { kind: "conversation", state: "ready" },
    { state: "unknown" },
    { state: "blocked" },
    { state: "error" },
    { state: "working" },
    { state: "done" },
  ];
  assertEquals(
    items.filter((i) => matchesWorkFilter(i, "blocked")).map((i) => i.state),
    ["blocked", "error"],
  );
  assertEquals(
    items.filter((i) => matchesWorkFilter(i, "working")).map((i) => i.state),
    ["working"],
  );
  assertEquals(attentionUnavailable(items), 2);
});
