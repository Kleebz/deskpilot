// Where desk.sh is, and where the module itself lives.
//
// Split out of server.ts so `deskpilot pair` can find desk.sh too. server.ts
// already imports cli.ts, so cli.ts importing server.ts back would be a cycle —
// and the alternative, a second copy of this logic, is precisely the drift the
// comments below were written about.

import { SCRIPTS_DIR as BAKED_SCRIPTS } from "./build-info.ts";

// Two different roots, because the binary treats them differently.
//
// ROOT is where the *module* lives. Running from a checkout that is the repo;
// inside a compiled binary it is the virtual filesystem deno mounts, which is
// where --include puts the built web assets. So the UI travels inside the
// binary and there is nothing to build on the target.
export const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// desk.sh is deliberately NOT embedded. It is the compositor-specific half —
// hyprctl, grim, ydotool — and keeping it as readable shell beside the binary
// is what makes a second compositor someone's contribution rather than a
// rewrite. A binary that hid it would be tidier and worse.
//
// Searched in the order that puts an operator's copy ahead of the packaged one.
// Resolved on use, and cached only once it succeeds. Resolving once at startup
// meant a desk.sh that appeared afterwards was never noticed — a package that
// installs files after enabling the service, or a first boot where ordering is
// not guaranteed, would report itself headless forever. Found by restoring
// desk.sh under a running binary and watching it keep saying "no compositor".
let scriptsCache = "";
export function scriptsDir(): string {
  if (scriptsCache) return scriptsCache;

  // An explicit override always wins, and whoever sets it is responsible for
  // it being executable by this build.
  const fromEnv = Deno.env.get("DESKPILOT_SCRIPTS");
  if (fromEnv) return (scriptsCache = fromEnv);

  // A compiled binary does not search. Its --allow-run allowlist is fixed at
  // compile time, so the only desk.sh it can execute is the one at the baked
  // path — and searching found a *different* copy next to the binary, cached
  // it, and then failed to execute it, reporting the machine as headless with
  // a perfectly good desk.sh sitting right there. A path it cannot run is
  // worse than no path at all, because it looks like it worked.
  if (BAKED_SCRIPTS) return (scriptsCache = BAKED_SCRIPTS);

  // Running from a checkout, where permissions are whatever the caller passed.
  // Not cached until it resolves, so a desk.sh installed after start is seen.
  for (const dir of [`${ROOT}/scripts`, "/usr/share/deskpilot/scripts"]) {
    try {
      Deno.statSync(`${dir}/desk.sh`);
      return (scriptsCache = dir);
    } catch { /* keep looking */ }
  }
  return `${ROOT}/scripts`;
}
