// The subcommands a packaged binary needs to be usable on its own.
//
// Installing from a package gets you /usr/bin/deskpilot and nothing else —
// shell/setup.sh lives in the repo, not in the package, so a binary that only
// knew how to serve left its user with no way to make a token, install a
// service, or pair a phone. This is that path.
//
// What it deliberately does not do is run systemctl. Adding it to the
// subprocess allowlist would widen it for the *server* too — an endpoint whose
// whole job is executing things — to save the operator one copy and paste. So
// setup writes the unit and prints the two commands.

// The one external dependency in the whole project, and it earns its place.
//
// `update` has to unpack a .tar.gz, and the alternative is putting `tar` in the
// binary's --allow-run allowlist — a list that is shared with the *server*, an
// endpoint whose entire job is executing things. Widening it to save a
// dependency is the wrong way round, and it is the same objection that keeps
// systemctl out of `setup`. DecompressionStream is built in; only the tar half
// needs anything. Pinned, because an unpinned range makes a build unrepeatable.
import { UntarStream } from "jsr:@std/tar@^0.1.10/untar-stream";

const REPO = "Kleebz/deskpilot";
const HOME = Deno.env.get("HOME") ?? "";
const CONF_DIR = `${HOME}/.config/deskpilot`;
const TOKEN_FILE = Deno.env.get("DESKPILOT_TOKEN_FILE") ?? `${CONF_DIR}/token`;
const UNIT_DIR = `${HOME}/.config/systemd/user`;
// Fixed paths, and not a preference: the binary's allowlist is compiled with
// SCRIPTS_DIR baked in, so that is the only desk.sh it may ever execute.
const BIN_PATH = "/usr/bin/deskpilot";
const SCRIPTS_DIR = "/usr/share/deskpilot/scripts";
const METHOD_FILE = "/usr/share/deskpilot/install-method";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function ensureToken(): string {
  try {
    const existing = Deno.readTextFileSync(TOKEN_FILE).trim();
    if (existing) return existing;
  } catch { /* first run */ }
  Deno.mkdirSync(CONF_DIR, { recursive: true });
  const token = randomHex(32);
  Deno.writeTextFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
  return token;
}

function writeUnit(port: string): string {
  const exe = Deno.execPath();
  const path = `${UNIT_DIR}/deskpilot.service`;
  Deno.mkdirSync(UNIT_DIR, { recursive: true });
  Deno.writeTextFileSync(
    path,
    `[Unit]
Description=deskpilot — phone-facing control server for the desktop
After=graphical-session.target

[Service]
Type=simple
ExecStart=${exe}
Environment=DESKPILOT_HOST=127.0.0.1
Environment=DESKPILOT_PORT=${port}
# Read at start, so editing the config takes effect on the next restart.
EnvironmentFile=-${CONF_DIR}/config
Restart=on-failure
RestartSec=2
# tmux runs as a child of this unit. Anything but 'process' takes every session
# down on restart — which is the one thing this service must never do.
KillMode=process

[Install]
WantedBy=default.target
`,
  );
  return path;
}

// How many devices hold a credential of their own, and would therefore survive
// the machine's token changing. null when the server cannot be reached, which
// is a different answer from zero and must not be reported as one.
async function enrolledCount(port: string, token: string): Promise<number | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/devices`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    return Array.isArray(body.devices) ? body.devices.length : null;
  } catch {
    return null;
  }
}

async function pairingCode(port: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/devices/code`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    return (await r.json()).code ?? null;
  } catch {
    return null;
  }
}

// Whether something other than us put this file here.
//
// Replacing a pacman-owned binary leaves a file pacman still believes it owns:
// `pacman -Qkk` reports a mismatch and the next `-Syu` quietly puts the old
// version back, days later, with nothing connecting the two events. Every tool
// that self-updates has this problem and they all solve it the same way — find
// out, and step aside.
//
// The marker is exact and free. The package database is the fallback for a copy
// installed before the marker existed, and it is READ rather than queried:
// `pacman -Qo` would be tidier but would mean adding pacman to the allowlist,
// which is the thing this whole design is avoiding.
function ownedByAPackage(): boolean {
  try {
    return Deno.readTextFileSync(METHOD_FILE).trim() === "pacman";
  } catch { /* no marker — ask the database instead */ }
  try {
    for (const e of Deno.readDirSync("/var/lib/pacman/local")) {
      if (!e.isDirectory) continue;
      try {
        const files = Deno.readTextFileSync(`/var/lib/pacman/local/${e.name}/files`);
        if (/^usr\/bin\/deskpilot$/m.test(files)) return true;
      } catch { /* not every entry has a file list */ }
    }
  } catch { /* not an Arch machine, which is most of them */ }
  return false;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The checksum file has a fixed name, which is the only reason `latest` works:
// a release URL cannot resolve a filename containing a version it does not know
// yet. The file names the archive and says what it should hash to, so one
// predictable fetch answers both questions. install.sh reads exactly the same
// file, on purpose — two updaters reading one source of truth cannot drift.
async function latestRelease(want: string) {
  const base = want === "latest"
    ? `https://github.com/${REPO}/releases/latest/download`
    : `https://github.com/${REPO}/releases/download/v${want}`;
  const r = await fetch(`${base}/deskpilot-checksums.txt`, { redirect: "follow" });
  if (!r.ok) throw new Error(`could not read the release index (${r.status})`);
  const line = (await r.text()).trim().split("\n")[0] ?? "";
  const [sha, rawName] = line.split(/\s+/);
  const name = (rawName ?? "").replace(/^\*/, "");
  if (!sha || !name) throw new Error("the checksum file named no archive");
  const version = name.match(/^deskpilot-(.+)-x86_64\.tar\.gz$/)?.[1] ?? "";
  return { base, sha, name, version };
}

function help() {
  console.log(`${bold("deskpilot")} — a phone-facing remote for the machine you left running

  deskpilot            run the server
  deskpilot setup      create a token, write the service, say what to run next
  deskpilot pair       print a one-time pairing code for another device
  deskpilot rotate     replace this machine's shared token
  deskpilot update     replace this binary with the latest release
  deskpilot version    print the version

${dim("  rotate is what to run if the shared token has been seen by anyone — it")}
${dim("  is printed in QR codes and pairing links, so it leaks the way a URL")}
${dim("  leaks. Devices holding their own credential are unaffected.")}

${dim("  update takes --check to look without installing, a version to pin to,")}
${dim("  and needs root to write /usr/bin. It steps aside if a package manager")}
${dim("  installed this copy.")}

Configuration lives in ${dim(`${CONF_DIR}/config`)}.
`);
}

export async function runCommand(cmd: string, version: string): Promise<number> {
  const port = Deno.env.get("DESKPILOT_PORT") ?? "8790";

  switch (cmd) {
    case "version":
    case "--version":
    case "-v":
      console.log(version);
      return 0;

    case "help":
    case "--help":
    case "-h":
      help();
      return 0;

    case "setup": {
      // Running from a checkout, Deno.execPath() is deno itself, and a unit
      // pointing at it would start the runtime with no script. shell/setup.sh
      // is the path there, and it does more besides.
      if (/\/deno$/.test(Deno.execPath())) {
        console.error(
          "this is running from source, where the service needs the repo layout.\n" +
            "  use  shell/setup.sh  instead — it does this and more.",
        );
        return 1;
      }
      const token = ensureToken();
      console.log(`  token      ${TOKEN_FILE}`);
      const unit = writeUnit(port);
      console.log(`  service    ${unit}`);
      console.log(`
${bold("Start it:")}

  systemctl --user daemon-reload
  systemctl --user enable --now deskpilot

${bold("Give it an address your phone can reach:")}

  # install Tailscale for your distro, then:
  tailscale up
  tailscale serve --bg --yes ${port}

${dim("This step is not optional and nothing else can do it for you. deskpilot")}
${dim("listens on loopback, so until something fronts it there is no address for")}
${dim("a phone to open. Serve also gives it a real certificate, which is what")}
${dim("makes the app installable and what web push needs — enable HTTPS")}
${dim("Certificates once at login.tailscale.com/admin/dns.")}

${bold("Then pair a phone:")}

  deskpilot pair

${dim("Nothing else was touched. Remote unlock stays off until DESKPILOT_UNLOCK=1.")}
`);
      // Deliberately not run here: systemctl would have to join the subprocess
      // allowlist, and that list is shared with the server.
      return 0;
    }

    case "pair": {
      let token = "";
      try {
        token = Deno.readTextFileSync(TOKEN_FILE).trim();
      } catch {
        console.error(`no token at ${TOKEN_FILE} — run 'deskpilot setup' first`);
        return 1;
      }
      const code = await pairingCode(port, token);
      if (!code) {
        console.error(
          `could not reach the server on port ${port}.\n` +
            `  systemctl --user status deskpilot`,
        );
        return 1;
      }
      // The address is deliberately not guessed here. This binary runs under
      // --allow-run=tmux,ps,hyprctl,desk.sh with no --allow-sys, so it can
      // neither ask Tailscale what this machine is called nor read its own
      // interfaces, and widening that to print a nicer line is a bad trade.
      // `tailscale status` is one command away for whoever is at the keyboard,
      // and the app — which knows its own origin — draws the QR.
      console.log(`
  ${bold(code)}

  On the phone, open this machine's address and enter that code.
  ${dim("The address is whatever you pointed Tailscale Serve at, usually")}
  ${dim("https://<machine>.<tailnet>.ts.net — `tailscale status` will say.")}

  ${bold("Easier, if a device is already paired:")} open the app there,
  ${dim("sessions index -> devices -> pair another device, and scan the QR. It")}
  ${dim("carries the address and the code together, so there is nothing to type.")}

  ${dim("Good for ten minutes, one device. That device gets its own credential,")}
  ${dim("revocable on its own from the app.")}
`);
      return 0;
    }

    case "rotate": {
      // The one credential nothing could take back.
      //
      // Every device used to be handed this token and it is still what any
      // device paired before per-device credentials holds. pair.sh prints it
      // into a URL and a QR when the service is not answering, so it leaks the
      // way a URL leaks — into history, into a screenshot, into a photograph of
      // a terminal — and until now there was no way to make a leaked one stop
      // working.
      //
      // The server cannot do this itself: running from source its --allow-write
      // is scoped to the state directory, and the token lives under ~/.config.
      let current = "";
      try {
        current = Deno.readTextFileSync(TOKEN_FILE).trim();
      } catch {
        console.error(`no token at ${TOKEN_FILE} — nothing to rotate`);
        return 1;
      }

      const args = Deno.args.slice(1);
      const yes = args.includes("--yes") || args.includes("-y");
      const enrolled = await enrolledCount(port, current);

      console.log(`
${bold("Rotating the shared token for this machine.")}

  ${dim(TOKEN_FILE)}
`);
      if (enrolled === null) {
        console.log(
          `  ${bold("!")} The server is not answering, so I cannot say how many devices
` +
          `    hold their own credential. Those survive; anything still on the
` +
          `    shared token will be locked out and has to pair again.
`,
        );
      } else if (enrolled === 0) {
        console.log(
          `  ${bold("!")} No device holds its own credential, so ${bold("every paired device")}
` +
          `    ${bold("will be locked out")} and has to pair again from this machine.
`,
        );
      } else {
        console.log(
          `  ${enrolled} device${enrolled === 1 ? "" : "s"} hold${enrolled === 1 ? "s" : ""} its own credential and will keep working.
` +
          `  Anything still on the shared token will be locked out and has to
` +
          `  pair again — the app's devices list is what says which is which.
`,
        );
      }

      if (!yes) {
        if (!Deno.stdin.isTerminal()) {
          console.error("not a terminal, and this locks devices out — re-run with --yes");
          return 1;
        }
        const ok = prompt("  Rotate it? [y/N]")?.trim().toLowerCase();
        if (ok !== "y" && ok !== "yes") {
          console.log("  left alone");
          return 1;
        }
      }

      // Written beside the destination and renamed, so an interruption cannot
      // leave a half-written token — which would lock out everything, including
      // whatever you would use to fix it.
      const next = randomHex(32);
      const tmp = `${TOKEN_FILE}.new`;
      try {
        Deno.mkdirSync(CONF_DIR, { recursive: true });
        Deno.writeTextFileSync(tmp, next + "\n", { mode: 0o600 });
        Deno.renameSync(tmp, TOKEN_FILE);
      } catch (e) {
        try { Deno.removeSync(tmp); } catch { /* nothing staged */ }
        console.error(`could not write ${TOKEN_FILE}: ${e instanceof Error ? e.message : e}`);
        return 1;
      }

      console.log(`
  ${bold("rotated")}

${bold("The old token keeps working until the service restarts:")}

  systemctl --user restart deskpilot

${dim("Your tmux sessions survive that. Devices with their own credential")}
${dim("reconnect on their own; anything else gets the pairing screen and needs")}
${dim("a fresh code from  deskpilot pair.")}
`);
      return 0;
    }

    case "update": {
      // Running from a checkout there is no binary to replace, and the thing
      // that does the right job knows about git, npm and the service.
      if (/\/deno$/.test(Deno.execPath())) {
        console.error(
          "this is running from source, where there is no binary to replace.\n" +
            "  use  shell/update.sh  instead — it pulls, rebuilds and restarts.",
        );
        return 1;
      }

      const args = Deno.args.slice(1);
      const checkOnly = args.includes("--check");
      const force = args.includes("--force");
      const pin = args.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? "latest";

      if (ownedByAPackage() && !force) {
        console.error(
          `a package manager owns ${BIN_PATH}.\n` +
            "  Update it the way you installed it:  pacman -Syu\n" +
            "  Replacing it here would leave a file pacman still thinks it owns,\n" +
            "  and the next -Syu would quietly put the old version back.\n" +
            "  --force overrides this, and you will own the result.",
        );
        return 1;
      }

      let rel;
      try {
        rel = await latestRelease(pin);
      } catch (e) {
        console.error(`  ${e instanceof Error ? e.message : e}`);
        return 1;
      }

      const running = version.split("+")[0];
      if (rel.version === running && !force) {
        console.log(`  already at ${version} — nothing newer published`);
        return 0;
      }
      if (checkOnly) {
        console.log(`  ${running} installed, ${rel.version} available`);
        console.log(`  ${dim("run 'sudo deskpilot update' to take it")}`);
        return 0;
      }
      console.log(`  ${running} -> ${rel.version}`);

      console.log("  downloading");
      const got = await fetch(`${rel.base}/${rel.name}`, { redirect: "follow" });
      if (!got.ok) {
        console.error(`  could not download ${rel.name} (${got.status})`);
        return 1;
      }
      const tarGz = new Uint8Array(await got.arrayBuffer());

      // Verified before anything on disk is touched. This is the whole reason
      // a self-updater is allowed to exist: the thing it replaces itself with
      // has to be provably the published artifact.
      const got256 = await sha256(tarGz);
      if (got256 !== rel.sha) {
        console.error(
          `  checksum mismatch — refusing to install\n` +
            `     expected ${rel.sha}\n     got      ${got256}`,
        );
        return 1;
      }
      console.log("  sha256 ok");

      // Staged beside each destination, then renamed. Two reasons, both real:
      // a rename is atomic, and writing over a running binary in place fails
      // with ETXTBSY — replacing the directory entry does not, which is why the
      // process you are running survives its own update.
      //
      // Everything is staged before anything is renamed, so a failure halfway
      // cannot leave a new binary beside an old desk.sh. That pairing is not
      // cosmetic: a new server against an old script reports the machine as
      // having no compositor, and says nothing about why.
      const wanted: Record<string, string> = {
        "deskpilot": BIN_PATH,
        "scripts/desk.sh": `${SCRIPTS_DIR}/desk.sh`,
        "scripts/sessions.sh": `${SCRIPTS_DIR}/sessions.sh`,
      };
      const staged: [string, string][] = [];
      try {
        const entries = new Blob([tarGz as BlobPart]).stream()
          .pipeThrough(new DecompressionStream("gzip"))
          .pipeThrough(new UntarStream());
        for await (const entry of entries) {
          const rel2 = entry.path.replace(/^\.\//, "");
          const dest = wanted[rel2];
          if (!dest || !entry.readable) {
            await entry.readable?.cancel();
            continue;
          }
          const tmp = `${dest}.new`;
          const f = await Deno.open(tmp, { write: true, create: true, truncate: true });
          await entry.readable.pipeTo(f.writable);
          await Deno.chmod(tmp, 0o755);
          staged.push([tmp, dest]);
        }
      } catch (e) {
        for (const [tmp] of staged) await Deno.remove(tmp).catch(() => {});
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          /permission/i.test(msg)
            ? `  cannot write to ${BIN_PATH} — run it as root:\n     sudo deskpilot update`
            : `  ${msg}`,
        );
        return 1;
      }

      if (staged.length !== Object.keys(wanted).length) {
        for (const [tmp] of staged) await Deno.remove(tmp).catch(() => {});
        console.error("  the archive was missing files — nothing was replaced");
        return 1;
      }
      for (const [tmp, dest] of staged) await Deno.rename(tmp, dest);

      // The marker follows the binary: an install that arrived by package and
      // was forced over is now an installer copy, and should say so.
      try {
        Deno.writeTextFileSync(METHOD_FILE, "installer\n");
      } catch { /* the update still happened */ }

      console.log(`
  updated to ${rel.version}

${bold("Restart it to actually run the new one:")}

  systemctl --user restart deskpilot

${dim("Your tmux sessions survive that — tmux is a child of the unit and")}
${dim("KillMode=process leaves it alone. Nothing else needs doing.")}
`);
      // Deliberately not run here, for the same reason setup does not: systemctl
      // would have to join an allowlist the server shares.
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      help();
      return 2;
  }
}
