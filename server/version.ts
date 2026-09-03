// One place that knows what this build is.
//
// There was no version string anywhere: a user could not say what they were
// running, a bug report could not be tied to a commit, and there was nothing
// for an update check to compare against.
//
// The commit is read out of .git rather than by running `git`. The service runs
// with --allow-run scoped to two scripts and tmux, and widening that so the
// server can print a version would be a poor trade — reading a file is already
// permitted, and a compiled binary has no .git anyway, which is why the
// baked-in value takes precedence.
import { COMMIT as BAKED } from "./build-info.ts";

export const VERSION = "0.1.2";

function fromGit(root: string): string {
  try {
    const head = Deno.readTextFileSync(`${root}/.git/HEAD`).trim();
    const ref = head.startsWith("ref: ") ? head.slice(5) : "";
    if (!ref) return head.slice(0, 7);            // detached HEAD
    try {
      return Deno.readTextFileSync(`${root}/.git/${ref}`).trim().slice(0, 7);
    } catch {
      // Packed refs, which is where a ref lives after `git gc`.
      const packed = Deno.readTextFileSync(`${root}/.git/packed-refs`);
      const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
      return line ? line.slice(0, 7) : "";
    }
  } catch {
    return "";
  }
}

export function describe(root: string): string {
  const baked = BAKED || Deno.env.get("DESKPILOT_COMMIT");
  const sha = baked || fromGit(root);
  return sha ? `${VERSION}+${sha.slice(0, 7)}` : VERSION;
}
