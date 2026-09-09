// The QR `deskpilot pair` prints.
//
// A QR that does not scan fails the way everything else in this project fails:
// silently. It looks like a QR. The camera simply does nothing, and the person
// holding the phone concludes that pairing is broken. So the rendered text is
// read back into a matrix and compared against the encoder — which catches an
// off-by-one in the half-block packing — and the polarity is asserted outright,
// which is the mistake that produces a perfectly formed unscannable code.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { encode } from "npm:uqr@^0.1.3";
import { qrTerminal } from "../server/qr.ts";

const URL_ = "https://desktop.tailnet.ts.net/?code=W7CDF3HJ";

// Undo the rendering: one cell is <esc>[fg;bgm▀, the foreground being the
// module above and the background the one below.
function readBack(s: string): boolean[][] {
  const rows: boolean[][] = [];
  for (const line of s.split("\n")) {
    const upper: boolean[] = [];
    const lower: boolean[] = [];
    for (const m of line.matchAll(/\x1b\[(\d+);(\d+)m▀/g)) {
      upper.push(m[1] === "30");
      lower.push(m[2] === "40");
    }
    rows.push(upper, lower);
  }
  return rows;
}

Deno.test("the rendered code is the encoder's matrix, exactly", () => {
  const { data, size } = encode(URL_, { border: 4 });
  const back = readBack(qrTerminal(URL_));

  // An odd module count leaves the final half-row unpaired; it is quiet zone.
  assert(back.length >= size, `rendered ${back.length} rows for ${size} modules`);
  for (let y = 0; y < size; y++) {
    assertEquals(back[y], data[y], `row ${y} does not match the encoder`);
  }
  for (let y = size; y < back.length; y++) {
    assert(back[y].every((m) => !m), `row ${y} is past the code and must be light`);
  }
});

Deno.test("dark modules are drawn dark", () => {
  // Inverted codes scan on some phones and not others, so this cannot be left
  // to whatever colours the terminal happens to use. The finder pattern's
  // top-left module is dark in every QR ever made.
  const { data } = encode(URL_, { border: 4 });
  const back = readBack(qrTerminal(URL_));
  assert(data[4][4], "the encoder should put a finder pattern at 4,4");
  assert(back[4][4], "a dark module must render dark");
  assert(!back[0][0], "the quiet zone must render light");
});

Deno.test("the quiet zone is the four modules the spec asks for", () => {
  // Two was enough to scan on a light terminal and not on a dark one, because
  // the terminal's own background abuts the edge and reads as module data.
  const back = readBack(qrTerminal(URL_));
  for (let y = 0; y < 4; y++) {
    assert(back[y].every((m) => !m), `row ${y} of the quiet zone is not light`);
    assert(back.slice(0, 8).every((r) => !r[y]), `column ${y} of the quiet zone is not light`);
  }
});
