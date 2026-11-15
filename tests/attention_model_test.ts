import { assertEquals } from "jsr:@std/assert@1";
import {
  inventory,
  matchesSearch,
  recentFirst,
  reportedRequests,
  reviewTarget,
} from "../web/src/lib/attention-model.js";
const desktop = { origin: "https://desktop", name: "Desktop" },
  server = { origin: "https://server", name: "Server" };
Deno.test("attention inventory preserves native identity and deduplicates only explicit attachments", () => {
  const native = {
    id: "core:terminal:generation-1",
    title: "shell",
    session: "bridge",
    state: "blocked",
    space: { title: "Product" },
    tab: { title: "Mobile" },
  };
  const s = inventory(desktop, [{
    session: "shell",
    path: "/same",
    state: "idle",
  }, { session: "bridge", herdrId: native.id, state: "blocked" }], [{
    id: "thread",
    title: "shell",
    path: "/same",
    state: "ready",
  }], [native]);
  assertEquals(s.items.length, 3);
  assertEquals(s.unknown, 1);
  assertEquals(s.items.filter((i) => i.kind === "herdr").length, 1);
  assertEquals(
    matchesSearch(s.items.find((i) => i.kind === "herdr"), "mobile"),
    true,
  );
});
Deno.test("reported requests respect health and machine order while a review snapshot stays fixed", () => {
  const a = inventory(desktop, [{ session: "z", state: "blocked" }]);
  const b = inventory(server, [{ session: "a", state: "error" }]);
  const data = {
    [desktop.origin]: { ...a, health: "ready" },
    [server.origin]: { ...b, health: "ready" },
  };
  const list = reportedRequests([desktop, server], data);
  const frozen = list.map(reviewTarget);
  assertEquals(frozen.map((i: any) => i.host), [desktop.origin, server.origin]);
  data[desktop.origin].items.push({
    kind: "session",
    session: "new",
    state: "blocked",
    host: desktop,
  });
  data[server.origin].health = "offline";
  assertEquals(reportedRequests([desktop, server], data).length, 2);
  assertEquals(frozen.length, 2);
  assertEquals(frozen[1].session, "a");
});
Deno.test("recent ordering never merges duplicate names or changes the source identity", () => {
  const items = [{ kind: "session", session: "shell", workspace: 1 }, {
    kind: "conversation",
    id: "uuid",
    title: "shell",
  }, { kind: "session", session: "api", workspace: 2 }];
  assertEquals(
    recentFirst(items, [{ kind: "conversation", id: "uuid" }]).map((i) =>
      i.id || i.session
    ),
    ["uuid", "shell", "api"],
  );
});
