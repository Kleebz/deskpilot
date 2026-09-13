// Reconstruct the screen AND the state that the next terminal bytes expect.
// Keep -J: letting xterm wrap logical lines preserves its isWrapped metadata,
// which copy and resize need. A final CRLF would scroll a full screen one row.
import { ControlClient, unescapeOutput } from "./control.ts";

export type TerminalSnapshot = {
  t: "hist";
  d: string;
  cols: number;
  rows: number;
};

const FIELDS = [
  "pane_width",
  "pane_height",
  "cursor_x",
  "cursor_y",
  "alternate_on",
  "scroll_region_upper",
  "scroll_region_lower",
  "cursor_flag",
  "insert_flag",
  "keypad_cursor_flag",
  "bracket_paste_flag",
  "wrap_flag",
  "keypad_flag",
];

export function terminalSnapshot(replies: string[][]): TerminalSnapshot {
  const values = replies[1][0]?.split(" ").map(Number) ?? [];
  if (
    values.length !== FIELDS.length || values.some((n) => !Number.isFinite(n))
  ) {
    throw new Error("invalid terminal state");
  }
  const [
    cols,
    rows,
    x,
    y,
    alt,
    top,
    bottom,
    cursor,
    insert,
    keys,
    paste,
    wrap,
    keypad,
  ] = values;
  if (cols < 1 || rows < 1 || x < 0 || x > cols || y < 0 || y >= rows) {
    throw new Error("invalid terminal geometry");
  }
  // Alternate-screen content has no scrollback. In normal mode retain the
  // last 1000 history rows as well as the visible screen.
  const lines = alt ? replies[3] : replies[2];
  // Queue the reset in-band as well: earlier xterm.write calls may still be
  // pending when the browser receives this message.
  let d = "\x1bc" + (alt ? "\x1b[?1049h" : "") + lines.join("\r\n");
  d += `\x1b[${top + 1};${bottom + 1}r`;
  d += `\x1b[${y + 1};${Math.min(x, cols - 1) + 1}H`;
  d += `\x1b[?25${cursor ? "h" : "l"}\x1b[4${insert ? "h" : "l"}`;
  d += `\x1b[?1${keys ? "h" : "l"}\x1b[?2004${paste ? "h" : "l"}`;
  d += `\x1b[?7${wrap ? "h" : "l"}` + (keypad ? "\x1b=" : "\x1b>");
  if (x === cols) {
    // CUP clamps at the last column and clears pending wrap. Repainting this
    // one unchanged row restores the right-edge state, including wide glyphs,
    // so the next printable character wraps instead of replacing the last one.
    d += `\x1b[4l\x1b[${y + 1};1H` + replies[4][y];
    d += `\x1b[4${insert ? "h" : "l"}`;
  }
  // capture-pane -P returns octal-escaped bytes for an incomplete escape
  // sequence. Resume parsing it before the next live chunk arrives.
  d += unescapeOutput(replies[5].join("\n"));
  return { t: "hist", d, cols, rows };
}

export async function captureTerminal(
  ctl: ControlClient,
  pane: string,
  received: (snapshot: TerminalSnapshot) => void,
): Promise<void> {
  if (!/^%\d+$/.test(pane)) throw new Error("invalid pane id");
  // Turning output off discards already-buffered pane bytes: they are in the
  // snapshot. All commands execute in one queue pass, so no pane reads occur
  // between capture and turning output back on. Publish synchronously at the
  // final reply boundary, before the parser dispatches subsequent %output.
  await ctl.batch([
    `refresh-client -A '${pane}:off'`,
    `display -p -t '${pane}' '${FIELDS.map((f) => `#{${f}}`).join(" ")}'`,
    `capture-pane -p -e -J -S -1000 -t '${pane}'`,
    `capture-pane -p -e -J -t '${pane}'`,
    `capture-pane -p -e -N -t '${pane}'`,
    `capture-pane -p -P -t '${pane}'`,
    `refresh-client -A '${pane}:on'`,
  ], (replies) => received(terminalSnapshot(replies)));
}
