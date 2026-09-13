// Real tmux + xterm regression checks, isolated from the user's sessions.
// deno run -A tests/terminal-recovery.ts
// Separate from deno test: requires tmux and Python and starts child processes.
import xterm from "npm:@xterm/headless@6.0.0";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { ControlClient } from "../server/control.ts";
import { captureTerminal } from "../server/terminal.ts";
import { terminalText } from "../web/src/lib/terminal-text.js";

const temp = await Deno.makeTempDir({ prefix: "deskpilot-recovery-" });
const originalPath = Deno.env.get("PATH")!;
const dec = new TextDecoder();
const bin = dec.decode(
  (await new Deno.Command("which", { args: ["tmux"], stdout: "piped" })
    .output()).stdout,
).trim();
const socket = `${temp}/tmux.sock`;
const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
await Deno.writeTextFile(
  `${temp}/tmux`,
  `#!/bin/sh\nexec ${q(bin)} -S ${q(socket)} "$@"\n`,
  { mode: 0o700 },
);
Deno.env.set("PATH", `${temp}:${originalPath}`);
const tmux = async (...args: string[]) => {
  const r = await new Deno.Command(bin, {
    args: ["-S", socket, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) throw new Error(dec.decode(r.stderr));
  return dec.decode(r.stdout);
};
await Deno.writeTextFile(
  `${temp}/fixture.py`,
  `import sys,tty,base64,time
tty.setraw(0)
sys.stdout.write('READY\\r\\n');sys.stdout.flush()
for line in sys.stdin:
 if line.strip() == 'STREAM':
  for i in range(200):
   sys.stdout.write('STREAM_%04d\\r\\n' % i);sys.stdout.flush();time.sleep(.003)
  sys.stdout.write('STREAM_DONE');sys.stdout.flush()
 else:
  sys.stdout.write(base64.b64decode(line).decode());sys.stdout.flush()
`,
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await sleep(10);
  }
  throw new Error("fixture did not settle");
};
const write = (s: string) =>
  tmux(
    "send-keys",
    "-t",
    "fixture",
    "-l",
    btoa(String.fromCharCode(...new TextEncoder().encode(s))) + "\n",
  );
const normalize = (s: string) =>
  s.split("\n").map((l) => l.trimEnd()).join("\n").trimEnd();
let ctl: ControlClient | undefined;
const term = new xterm.Terminal({
  cols: 52,
  rows: 24,
  scrollback: 2000,
  allowProposedApi: true,
});
let pane = "", ready = false;
const flush = () => new Promise<void>((r) => term.write("", r));
const snapshot = () =>
  captureTerminal(ctl!, pane, (m) => {
    term.resize(m.cols, m.rows);
    term.write(m.d);
    ready = true;
  });
const attach = async () => {
  ready = false;
  ctl = new ControlClient("fixture", {
    output(p, data) {
      if (ready && p === pane) term.write(data);
    },
    exit() {},
  });
  await ctl.send("refresh-client -C 52x24");
  pane = (await ctl.send("display -p -t fixture '#{pane_id}'"))[0];
  await snapshot();
};
const screen = () => {
  const b = term.buffer.active;
  return Array.from(
    { length: term.rows },
    (_, i) => b.getLine(b.baseY + i)?.translateToString(true) ?? "",
  ).join("\n");
};
const compare = async (label: string) => {
  await flush();
  assertEquals(
    normalize(screen()),
    normalize(await tmux("capture-pane", "-p", "-t", "fixture")),
    label,
  );
  const [x, y] =
    (await tmux("display", "-p", "-t", "fixture", "#{cursor_x} #{cursor_y}"))
      .trim().split(" ").map(Number);
  assertEquals(
    [term.buffer.active.cursorX, term.buffer.active.cursorY],
    [x, y],
    `${label}: cursor`,
  );
  console.log(`PASS ${label}`);
};
try {
  await tmux(
    "-f",
    "/dev/null",
    "new-session",
    "-d",
    "-s",
    "fixture",
    "-x",
    "52",
    "-y",
    "24",
    "python3",
    "-u",
    `${temp}/fixture.py`,
  );
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("READY")
  );
  await attach();
  await compare("initial shell cursor");
  await write(
    "\x1b[2J\x1b[H" + "A wrapped line with café and 世界. ".repeat(12) +
      "\r\nPROMPT> ",
  );
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("PROMPT>")
  );
  await snapshot();
  await compare("wrapped history and prompt restored");
  assert(
    Array.from(
      { length: term.buffer.active.length },
      (_, i) => term.buffer.active.getLine(i)?.isWrapped,
    ).some(Boolean),
    "wrapped-line metadata survives",
  );
  assertEquals(
    terminalText(term.buffer.active).split("\n").find((s: string) =>
      s.startsWith("A wrapped")
    ),
    "A wrapped line with café and 世界. ".repeat(12).trimEnd(),
    "copy reconstructs the original logical line",
  );
  await write("typed-after-reconnect");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes(
      "typed-after-reconnect",
    )
  );
  await compare("typing after snapshot");

  await write("\r\n" + "x".repeat(52));
  await until(async () =>
    (await tmux("display", "-p", "-t", "fixture", "#{cursor_x}")).trim() ===
      "52"
  );
  await snapshot();
  await compare("cursor waiting to wrap at right edge");
  await write("WRAPPED_NEXT");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("WRAPPED_NEXT")
  );
  await compare("first character after pending wrap");

  await write("\x1b[31");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-P", "-t", "fixture")).includes("31")
  );
  await snapshot();
  await write("mPARTIAL_DONE\x1b[0m");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("PARTIAL_DONE")
  );
  await compare("escape sequence split across snapshot");

  await write("\x1b[?2004h\x1b[?1h\x1b[4h\x1b[?25l\x1b[3;20r\x1b[5;8H");
  await until(async () =>
    (await tmux(
      "display",
      "-p",
      "-t",
      "fixture",
      "#{scroll_region_upper} #{cursor_y}",
    )).trim() === "2 4"
  );
  await snapshot();
  await compare("scroll region and cursor restored");
  await flush();
  assertEquals(term.modes.bracketedPasteMode, true);
  assertEquals(term.modes.applicationCursorKeysMode, true);
  assertEquals(term.modes.insertMode, true);

  await write("\x1b[4l\x1b[r\x1b[?1049h\x1b[2J\x1b[HALTERNATE\x1b[8;11H");
  await until(async () =>
    (await tmux(
      "display",
      "-p",
      "-t",
      "fixture",
      "#{alternate_on} #{cursor_y}",
    )).trim() === "1 7"
  );
  await snapshot();
  await compare("alternate screen restored");
  assertEquals(term.buffer.active.type, "alternate");
  await write("after-alt-snapshot");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes(
      "after-alt-snapshot",
    )
  );
  await compare("alternate-screen live output");

  await write("\x1b[?1049l\x1b[r\x1b[2J\x1b[HSTREAM_START\r\n");
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("STREAM_START")
  );
  await tmux("send-keys", "-t", "fixture", "-l", "STREAM\n");
  for (let i = 0; i < 12; i++) {
    await snapshot();
    await sleep(15);
  }
  await ctl!.close();
  await attach();
  for (let i = 0; i < 12; i++) {
    await snapshot();
    await sleep(15);
  }
  await until(async () =>
    (await tmux("capture-pane", "-p", "-t", "fixture")).includes("STREAM_DONE")
  );
  await sleep(40);
  await compare("streaming across repeated snapshots and reconnect");
  const b = term.buffer.active;
  const history = Array.from(
    { length: b.length },
    (_, i) => b.getLine(i)?.translateToString(true) ?? "",
  ).join("\n");
  for (let i = 0; i < 200; i++) {
    assertEquals(
      history.split(`STREAM_${String(i).padStart(4, "0")}`).length - 1,
      1,
      `stream item ${i} exactly once`,
    );
  }
  console.log("PASS all 200 streamed records delivered exactly once");
} finally {
  await ctl?.close();
  term.dispose();
  await tmux("kill-server").catch(() => {});
  Deno.env.set("PATH", originalPath);
  await Deno.remove(temp, { recursive: true });
}
