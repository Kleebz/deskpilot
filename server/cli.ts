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

const HOME = Deno.env.get("HOME") ?? "";
const CONF_DIR = `${HOME}/.config/deskpilot`;
const TOKEN_FILE = Deno.env.get("DESKPILOT_TOKEN_FILE") ?? `${CONF_DIR}/token`;
const UNIT_DIR = `${HOME}/.config/systemd/user`;

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

function help() {
  console.log(`${bold("deskpilot")} — a phone-facing remote for the machine you left running

  deskpilot            run the server
  deskpilot setup      create a token, write the service, say what to run next
  deskpilot pair       print a one-time pairing code for another device
  deskpilot version    print the version

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
      console.log(`
  ${bold(code)}

  Open this machine's address on the phone and enter that code.
  ${dim("Good for ten minutes, one device. That device gets its own credential,")}
  ${dim("revocable on its own from the app.")}
`);
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      help();
      return 2;
  }
}
