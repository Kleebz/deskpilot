import { assertEquals } from "jsr:@std/assert@1";
import { windowForPid } from "../server/sessions.ts";

Deno.test("an unmanaged agent process resolves through its terminal ancestry", () => {
  const window = { pid: 10, workspace: { id: 4 }, address: "0xabc" };
  const parents = new Map([[42, 30], [30, 20], [20, 10], [10, 1]]);
  assertEquals(windowForPid(42, [window], parents), window);
});

Deno.test("unrelated unmanaged processes do not acquire a window", () => {
  const window = { pid: 10, workspace: { id: 4 }, address: "0xabc" };
  assertEquals(windowForPid(42, [window], new Map([[42, 1]])), null);
});
