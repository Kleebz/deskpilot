// The QR renderer, reachable from shell. `deskpilot pair` imports the same
// module directly; this is how pair.sh gets at it without a second copy.
//
// The URL arrives through the environment rather than argv because it carries
// a single-use pairing code and argv is world-readable in /proc.
import { qrTerminal } from "../server/qr.ts";

const url = Deno.env.get("DP_QR_URL") ?? "";
if (!url) {
  console.error("DP_QR_URL is not set");
  Deno.exit(1);
}
console.log(qrTerminal(url));
