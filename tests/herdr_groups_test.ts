import { assertEquals } from "jsr:@std/assert@1";
import { groupHerdr } from "../web/src/lib/herdr-groups.js";

const terminal = (id: string, space: string, tab: string, state = "idle") => ({
  id,
  title: `Task ${id}`,
  path: "/project",
  agent: "codex",
  state,
  space: {
    id: space,
    title: "Same project",
    order: space === "a" ? 0 : 1,
    path: "/project",
  },
  tab: { id: tab, title: tab, order: tab === "Review" ? 1 : 0 },
});

Deno.test("phone grouping never merges equal space names and retains tab order", () => {
  const groups = groupHerdr([
    terminal("1", "b", "Review"),
    terminal("2", "a", "Review", "blocked"),
    terminal("3", "a", "Build", "working"),
  ]);
  assertEquals(groups.map((g) => g.id), ["a", "b"]);
  assertEquals(groups[0].tabs.map((t: { title: string }) => t.title), [
    "Build",
    "Review",
  ]);
  assertEquals(groups[0].attention, 1);
  assertEquals(groups[0].state, "blocked");
});

Deno.test("phone search and attention filter preserve source terminal identities", () => {
  const items = [
    terminal("1", "a", "Review", "blocked"),
    terminal("2", "a", "Build", "working"),
    terminal("3", "b", "Review", "error"),
  ];
  assertEquals(
    groupHerdr(items, { attentionOnly: true }).flatMap((g) => g.terminals).map(
      (t) => t.id,
    ),
    ["1", "3"],
  );
  assertEquals(
    groupHerdr(items, { query: "BUILD" }).flatMap((g) => g.terminals).map((t) =>
      t.id
    ),
    ["2"],
  );
  assertEquals(groupHerdr(items, { query: "nothing" }), []);
  assertEquals(
    groupHerdr([{ id: "other", state: "idle" }])[0].title,
    "Other terminals",
  );
});
