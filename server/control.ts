// A tmux control-mode client.
//
// The terminal used to be `script -qfc "stty …; exec tmux attach"` — a pty with
// a size baked in at spawn. Nothing can signal a pty created that way, so every
// geometry change had to tear the connection down and build a new one: rotating
// the phone, changing the font, and worst of all opening the soft keyboard,
// which changes the viewport height at the exact moment you tap to type.
//
// Control mode removes the pty entirely. `tmux -C attach` speaks a line
// protocol over plain pipes, takes commands on stdin, and resizes on request:
//
//   %output %12 \015\033[K…      pane bytes, control chars escaped as octal
//   %layout-change @9 …          the window was rearranged
//   %begin t n f … %end t n f    a reply to a command we sent
//   %exit [reason]               the session went away
//
// Verified before this was written: it runs over pipes with no pty, and
// `refresh-client -C 100x20` resized a live client from 200x50 with no
// reconnect. Sizes are per-request, so the phone stops reattaching to resize.
//
// Nothing here knows what is running in the pane. Bytes in, bytes out.

const DEC = new TextDecoder();
const ENC = new TextEncoder();

// tmux escapes a backslash and anything below 0x20 as a three-digit octal
// sequence. Everything else, high bytes included, comes through as itself.
function unescape(s: string): string {
  if (!s.includes("\\")) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && /^[0-7]{3}$/.test(s.slice(i + 1, i + 4))) {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      out += s[i];
    }
  }
  return out;
}

type Pending = { resolve: (lines: string[]) => void; reject: (e: Error) => void };

export interface ControlEvents {
  output: (pane: string, data: string) => void;
  exit: (reason: string) => void;
}

export class ControlClient {
  #child: Deno.ChildProcess;
  #writer: WritableStreamDefaultWriter<Uint8Array>;
  #pending: Pending[] = [];
  #queued: { cmd: string; p: Pending }[] = [];
  #block: string[] | null = null;
  #closed = false;
  // tmux emits an unsolicited %begin/%end pair when a client attaches, before
  // %session-changed. Matching replies to commands by arrival order without
  // accounting for it shifts every answer by one — which showed up as the
  // scrollback priming returning a pane id instead of the history. So nothing
  // is sent, and no block is treated as a reply, until the attach has settled.
  #ready = false;
  #on: ControlEvents;

  constructor(session: string, on: ControlEvents) {
    this.#on = on;
    this.#child = new Deno.Command("tmux", {
      args: ["-C", "attach", "-t", session],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    this.#writer = this.#child.stdin.getWriter();
    this.#read();
  }

  get child(): Deno.ChildProcess {
    return this.#child;
  }

  async #read() {
    // Streaming decode: a multibyte character can straddle a chunk boundary,
    // and a non-streaming decoder would turn it into two replacement chars.
    const dec = new TextDecoder("utf-8");
    let buf = "";
    try {
      for await (const chunk of this.#child.stdout) {
        buf += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          this.#line(line);
        }
      }
    } catch { /* pipe torn down */ }
    this.#on.exit("stream ended");
  }

  #line(line: string) {
    // Inside a %begin…%end block every line is reply payload, including one
    // that happens to start with a % — so the block check comes first.
    if (this.#block !== null) {
      if (line.startsWith("%end ") || line.startsWith("%error ")) {
        const lines = this.#block;
        this.#block = null;
        if (!this.#ready) return;     // the attach block, not an answer
        const p = this.#pending.shift();
        if (!p) return;
        if (line.startsWith("%error ")) p.reject(new Error(lines.join("\n")));
        else p.resolve(lines);
        return;
      }
      this.#block.push(line);
      return;
    }

    if (line.startsWith("%begin ")) {
      this.#block = [];
      return;
    }
    if (line.startsWith("%session-changed")) {
      this.#ready = true;
      for (const { cmd, p } of this.#queued.splice(0)) this.#write(cmd, p);
      return;
    }
    if (line.startsWith("%output ")) {
      // %output %<pane> <data>; the data may itself contain spaces.
      const rest = line.slice(8);
      const sp = rest.indexOf(" ");
      if (sp < 0) return;
      this.#on.output(rest.slice(0, sp), unescape(rest.slice(sp + 1)));
      return;
    }
    if (line.startsWith("%exit")) {
      this.#on.exit(line.slice(5).trim() || "session ended");
      return;
    }
    // %layout-change, %session-changed, %window-* and friends are not needed
    // to render a pane; the active pane is re-read on demand instead.
  }

  // Commands go one per line on stdin. Replies come back in order, so a FIFO
  // of resolvers is enough to match them up without parsing the block number.
  send(cmd: string): Promise<string[]> {
    if (this.#closed) return Promise.reject(new Error("closed"));
    return new Promise((resolve, reject) => {
      const p = { resolve, reject };
      if (this.#ready) this.#write(cmd, p);
      else this.#queued.push({ cmd, p });
    });
  }

  #write(cmd: string, p: Pending) {
    this.#pending.push(p);
    this.#writer.write(ENC.encode(cmd + "\n")).catch(p.reject);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const p of this.#pending.splice(0)) p.reject(new Error("closed"));
    for (const { p } of this.#queued.splice(0)) p.reject(new Error("closed"));
    try { await this.#writer.close(); } catch { /* already gone */ }
    // A control client exits when its stdin closes, but do not rely on it: the
    // old pty path leaked a process for every connection because nothing
    // awaited the child. Escalate, then reap.
    const timer = setTimeout(() => {
      try { this.#child.kill("SIGKILL"); } catch { /* already gone */ }
    }, 2000);
    try { await this.#child.status; } catch { /* already gone */ }
    clearTimeout(timer);
  }
}

// Keystrokes travel as codepoints rather than as a quoted string: `send-keys`
// takes a shell-ish word list, and anything that quotes user input into a
// command line is one apostrophe away from a bad day. -H takes hex and has no
// quoting rules at all.
export function keysCommand(session: string, data: string): string[] {
  const codes = [...data].map((c) => c.codePointAt(0)!.toString(16));
  const out: string[] = [];
  // Chunked so a paste cannot build a command line longer than tmux will read.
  for (let i = 0; i < codes.length; i += 200) {
    out.push(`send-keys -t ${session} -H ${codes.slice(i, i + 200).join(" ")}`);
  }
  return out;
}

export { unescape as unescapeOutput };
