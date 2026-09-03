// The control-mode protocol parser.
//
// This is the layer the whole terminal rests on, and its failure modes are
// quiet: a mis-parsed escape shows as a corrupted character, and a mis-matched
// reply shows as the wrong answer to a different question — which is exactly
// the bug that shipped once, where scrollback priming returned a pane id.

import { assertEquals } from "jsr:@std/assert@1";
import { keysCommand, unescapeOutput } from "../server/control.ts";

Deno.test("octal escapes become the bytes they stand for", () => {
  assertEquals(unescapeOutput("\\015"), "\r");
  assertEquals(unescapeOutput("\\033[K"), "\x1b[K");
  assertEquals(unescapeOutput("plain text"), "plain text");
  assertEquals(unescapeOutput("a\\015\\012b"), "a\r\nb");
});

Deno.test("a backslash that is not an escape is left alone", () => {
  // tmux only escapes control bytes and the backslash itself, so a path like
  // C:\work must survive unchanged rather than eating the next characters.
  assertEquals(unescapeOutput("C:\\work"), "C:\\work");
  assertEquals(unescapeOutput("\\9"), "\\9");
  assertEquals(unescapeOutput("\\01"), "\\01");     // too short to be octal
});

Deno.test("keystrokes are sent as codepoints, never interpolated", () => {
  // The reason this is hex rather than a quoted string: anything that puts user
  // input into a command line is one apostrophe away from a bad day.
  const [cmd] = keysCommand("work", "ls");
  assertEquals(cmd, "send-keys -t work -H 6c 73");

  const [quoted] = keysCommand("work", "'; rm -rf ~; echo '");
  assertEquals(quoted.includes("rm"), false, "no raw text may reach the command line");
  assertEquals(quoted.startsWith("send-keys -t work -H "), true);
});

Deno.test("control characters and unicode both survive", () => {
  assertEquals(keysCommand("s", "\r")[0], "send-keys -t s -H d");
  assertEquals(keysCommand("s", "\x1b")[0], "send-keys -t s -H 1b");
  // A codepoint, not two UTF-8 bytes — tmux -H takes key values.
  assertEquals(keysCommand("s", "é")[0], "send-keys -t s -H e9");
});

Deno.test("a long paste is split so no command line grows unbounded", () => {
  const cmds = keysCommand("s", "x".repeat(500));
  assertEquals(cmds.length, 3);
  for (const c of cmds) assertEquals(c.split(" ").length <= 205, true);
});
