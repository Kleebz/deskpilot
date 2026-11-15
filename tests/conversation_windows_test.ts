import { assertEquals } from "jsr:@std/assert@1";
import {
  isTerminalWindow,
  matchConversationWindows,
} from "../web/src/lib/conversation-windows.js";

const chat = {
  id: "one",
  title: "Restore mobile Deskpilot access",
  path: "/home/test/deskpilot",
};
const win = {
  address: "0x1",
  pid: 42,
  workspace: 8,
  class: "com.mitchellh.ghostty",
  title: "⠴ Restore mobile Deskpilot access | deskpilot",
};

Deno.test("native Ghostty title and project find a conversation despite a shared PID", () => {
  const second = {
    id: "two",
    title: "Design assembly",
    path: "/home/test/papa-cnc",
  };
  const other = {
    ...win,
    address: "0x2",
    workspace: 7,
    title: "Design assembly | papa-cnc",
  };
  assertEquals([...matchConversationWindows([chat, second], [win, other])], [[
    win.address,
    chat,
  ], [other.address, second]]);
});

Deno.test("duplicate conversation or window titles never pick a first match", () => {
  assertEquals(
    matchConversationWindows([chat, { ...chat, id: "two" }], [win]).size,
    0,
  );
  assertEquals(
    matchConversationWindows([chat], [win, { ...win, address: "0x2" }]).size,
    0,
  );
  assertEquals(
    matchConversationWindows([chat, {
      ...chat,
      id: "two",
      path: "/different/deskpilot",
    }], [win]).size,
    0,
  );
});

Deno.test("project names, partial titles and unrelated applications do not establish location", () => {
  for (
    const changed of [
      { title: "deskpilot" },
      { title: "Restore mobile Deskpilot access | other" },
      { class: "firefox" },
      { title: "Restore mobile Deskpilot | deskpilot" },
    ]
  ) {
    assertEquals(
      matchConversationWindows([chat], [{ ...win, ...changed }]).size,
      0,
    );
  }
  assertEquals(isTerminalWindow({ class: "foot" }), true);
  assertEquals(isTerminalWindow({ class: "Alacritty" }), true);
});

Deno.test("location hints recompute from current windows rather than retaining stale associations", () => {
  assertEquals(matchConversationWindows([chat], [win]).get(win.address), chat);
  assertEquals(
    matchConversationWindows([chat], [{
      ...win,
      title: "New conversation | deskpilot",
    }]).size,
    0,
  );
  assertEquals(matchConversationWindows([chat], []).size, 0);
  assertEquals(
    matchConversationWindows([chat], [{ ...win, workspace: 3 }]).get(
      win.address,
    ),
    chat,
  );
});
