import xterm from "npm:@xterm/headless@6.0.0";
import { assertEquals } from "jsr:@std/assert@1";
import { terminalSnapshot } from "../server/terminal.ts";

// Parse snapshots with the terminal emulator, rather than asserting generated
// escape strings. An older tmux returns an empty field for bracket_paste_flag.
for (const paste of ["1", "0", ""]) {
  Deno.test(`terminal snapshot restores observable input modes (paste=${paste || "unavailable"})`, async () => {
    const terminal = new xterm.Terminal({
      cols: 52,
      rows: 24,
      allowProposedApi: true,
    });
    try {
      // Geometry, alternate screen, scroll region, cursor/insert/cursor keys,
      // paste/wrap/keypad, then standard/button/any/UTF8/SGR mouse modes.
      const values = [
        52,
        24,
        3,
        4,
        1,
        0,
        23,
        1,
        1,
        1,
        paste,
        1,
        0,
        0,
        0,
        1,
        0,
        1,
      ];
      const snapshot = terminalSnapshot([
        [],
        [values.join(" ")],
        [],
        ["native output"],
        [],
        [],
      ]);
      await new Promise<void>((resolve) => terminal.write(snapshot.d, resolve));
      assertEquals(terminal.buffer.active.type, "alternate");
      assertEquals(terminal.buffer.active.cursorX, 3);
      assertEquals(terminal.buffer.active.cursorY, 4);
      assertEquals(terminal.modes.bracketedPasteMode, paste === "1");
      assertEquals(terminal.modes.applicationCursorKeysMode, true);
      assertEquals(terminal.modes.insertMode, true);
      assertEquals(terminal.modes.mouseTrackingMode, "any");
      // The next snapshot must clear modes left by the previous application.
      values[8] =
        values[9] =
        values[10] =
        values[15] =
        values[17] =
          0;
      const reset = terminalSnapshot([
        [],
        [values.join(" ")],
        [],
        ["new output"],
        [],
        [],
      ]);
      await new Promise<void>((resolve) => terminal.write(reset.d, resolve));
      assertEquals(terminal.modes.bracketedPasteMode, false);
      assertEquals(terminal.modes.applicationCursorKeysMode, false);
      assertEquals(terminal.modes.insertMode, false);
      assertEquals(terminal.modes.mouseTrackingMode, "none");
    } finally {
      terminal.dispose();
    }
  });
}
