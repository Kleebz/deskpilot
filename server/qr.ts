// A QR code, drawn in a terminal, for `deskpilot pair`.
//
// The second external dependency in the project, and it is here for the same
// reason as the first: the alternative is worse. Rendering a QR needs Reed-
// Solomon, mask evaluation and version selection — several hundred lines of
// fiddly code whose bugs are invisible until a phone will not scan it. uqr is
// pure, tiny and already what the web UI draws its QR with, so the two paths
// now agree by construction rather than by luck. Shelling out to `qrencode`
// was the other option and it means putting a binary on the --allow-run
// allowlist that the *server* shares — the trade this project keeps refusing.
import { encode } from "npm:uqr@^0.1.3";

const RESET = "\x1b[0m";

export function qrTerminal(text: string): string {
  // Four modules of quiet zone, which is what the spec asks for and is not
  // decoration: the terminal's own background sits directly against the edge,
  // and a dark theme there reads as module data. Two was enough to make a code
  // that scanned on a light terminal and not on a dark one.
  const { data, size } = encode(text, { border: 4 });
  const dark = (x: number, y: number) => (y < size ? data[y][x] : false);

  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = "";
    for (let x = 0; x < size; x++) {
      // The upper half block paints the top module in the foreground colour
      // and the bottom one in the background, so two module rows fit in one
      // text row. At one row per module the code is 40 lines tall and pushes
      // the address and the code — the parts you read — off the screen, which
      // is the failure this whole change exists to fix.
      //
      // Explicit black and white rather than the terminal's own colours: a QR
      // is dark-on-light, and an inverted one is a coin toss for a phone
      // camera rather than a reliable scan.
      const fg = dark(x, y) ? 30 : 97;
      const bg = dark(x, y + 1) ? 40 : 107;
      line += `\x1b[${fg};${bg}m▀`;
    }
    lines.push(line + RESET);
  }
  return lines.join("\n");
}
