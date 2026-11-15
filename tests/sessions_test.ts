import { assertEquals } from "jsr:@std/assert@1";
import { windowForPid, windowsForClasses } from "../server/sessions.ts";

Deno.test("an unmanaged agent process resolves through its terminal ancestry", () => {
  const window = { pid: 10, workspace: { id: 4 }, address: "0xabc" };
  const parents = new Map([[42, 30], [30, 20], [20, 10], [10, 1]]);
  assertEquals(windowForPid(42, [window], parents), window);
});

Deno.test("unrelated unmanaged processes do not acquire a window", () => {
  const window = { pid: 10, workspace: { id: 4 }, address: "0xabc" };
  assertEquals(windowForPid(42, [window], new Map([[42, 1]])), null);
});

Deno.test("launch identities find hidden windows before a terminal client exists", () => {
  const window = {
    pid: 10,
    workspace: { id: 99 },
    address: "0xabc",
    class: "com.deskpilot.Terminal.n123",
  };
  assertEquals(windowsForClasses([window.class], [window]), [window]);
  assertEquals(windowsForClasses(["unrelated"], [window]), []);
});

Deno.test("a launch identity shared by several native windows remains ambiguous", () => {
  const windows = [
    {
      pid: 10,
      workspace: { id: 4 },
      address: "0xabc",
      class: "com.deskpilot.Terminal.n123",
    },
    {
      pid: 10,
      workspace: { id: 7 },
      address: "0xdef",
      class: "com.deskpilot.Terminal.n123",
    },
  ];
  assertEquals(windowsForClasses([windows[0].class], windows), []);
});

Deno.test("shared terminal PIDs never choose an arbitrary window or fall through to a parent", () => {
  const windows = [
    { pid: 10, workspace: { id: 4 }, address: "0xabc" },
    { pid: 10, workspace: { id: 7 }, address: "0xdef" },
    { pid: 5, workspace: { id: 1 }, address: "0x123" },
  ];
  const parents = new Map([[42, 10], [10, 5], [5, 1]]);
  assertEquals(windowForPid(42, windows, parents), null);
});

Deno.test("dedicated terminal processes still resolve the correct workspace", () => {
  const windows = [
    { pid: 10, workspace: { id: 4 }, address: "0xabc" },
    { pid: 20, workspace: { id: 7 }, address: "0xdef" },
  ];
  assertEquals(
    windowForPid(42, windows, new Map([[42, 20], [20, 1]])),
    windows[1],
  );
});
