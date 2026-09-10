# Installing deskpilot, for an agent

This is a runbook for a coding agent with shell access, not a tutorial for a person —
the human version is in [the README](../README.md). Someone has asked you to install
deskpilot on the machine you are running on.

Work through the steps in order. **Each one has a verification; run it and read the
result before moving on.** Most of these checks exist because the corresponding failure
is silent — the install looks finished and the phone cannot connect, with nothing
anywhere saying why.

Three things you cannot do. Stop and ask when you reach them; they are marked **HUMAN**:

1. `sudo` — installing to `/usr/bin` needs a password you do not have, and so do the
   Tailscale daemon commands in step 3 unless this user is already the operator.
2. The Tailscale login, which opens a browser, and the one admin-console setting it needs.
3. Scanning the QR at the end. That is the point of the whole exercise.

Do not work around a failed step by widening a permission. The binary's subprocess
allowlist and the server's write scope are load-bearing security properties, not
obstacles — see [decisions.md](decisions.md). If a step fails for a reason not listed
here, say so and stop rather than improvising.

---

## 0. Preflight

```bash
uname -s -m                          # want: Linux x86_64
command -v tmux || echo "MISSING"    # the one hard requirement
systemctl --user is-system-running   # want: running or degraded, not "offline"
command -v hyprctl grim ydotool      # optional; absence is fine
tailscale debug prefs 2>/dev/null | grep OperatorUser   # empty/silent: step 3 needs root
```

**Read the answers before continuing.**

- **Not Linux** — stop. This is Linux-only and there is no workaround.
- **No `tmux`** — install it with the system package manager. Everything here depends on
  it; nothing else does.
- **Not x86_64** — released binaries are x86_64 only. Use the [source route](#1b-source)
  in step 1, which works on any architecture.
- **`systemctl --user` says `offline`** — you are in a context with no user session bus
  (a bare `docker exec`, some SSH configurations). The service is a systemd *user* unit,
  so it cannot be installed from here. Say so and stop.
- **`OperatorUser` empty, or the command printed nothing** — no operator is set, so every
  state-changing `tailscale` command in step 3 — `up` and `serve` both — needs `sudo`.
  This is the default on a fresh install, not a fault; distro packages do not set an
  operator. Note it now and plan on asking the person in step 3 rather than discovering
  it at the failure.
- **No `hyprctl` / `grim` / `ydotool`** — expected on a headless box and not a problem.
  The server negotiates capabilities and the app hides what is missing. Do not install a
  compositor to make the list look complete.

---

## 1. Install the program

Pick **one** route.

### 1a. Release binary — the default

```bash
curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/install.sh -o /tmp/install.sh
sh /tmp/install.sh
```

**HUMAN: the second line elevates with `sudo` and will prompt for a password.** In a
non-interactive shell that prompt has nowhere to go, so it hangs or fails rather than
asking. Ask the person to run it themselves, or to authorise sudo first — do not try to
route a password through the shell.

The installer verifies the published checksum before it writes anything. Offer to show
the script first — it installs as root, and a person is entitled to read it.

If a package manager already owns `/usr/bin/deskpilot`, the installer will refuse and say
so. That refusal is correct: overwriting a packaged file leaves the package database
disagreeing with the disk, and the next system upgrade silently reinstates the old
version days later. Use the package manager instead.

### 1b. Source

Needs `deno`, `node` and `npm`. Use this on non-x86_64, or when the person intends to
modify the code.

```bash
git clone https://github.com/Kleebz/deskpilot
cd deskpilot
npm --prefix web install
shell/setup.sh
```

`shell/setup.sh` builds the UI, installs a user service pointing at **this directory**,
and runs the full check suite. It prompts before touching a shell profile or
`~/.claude/settings.json`; `--yes`, `--no-shell` and `--no-claude` answer those
non-interactively.

Two things to tell the person:

- The service points at the checkout, so **moving or deleting the directory breaks it.**
- There is no `deskpilot` command on `PATH` in this mode. Everywhere below that says
  `deskpilot pair`, use `shell/pair.sh`; `deskpilot setup` is `shell/setup.sh`. Running
  `deskpilot setup` from a checkout tells you this rather than doing the wrong thing.

**A source install is done after this step — skip to step 3.**

### Verify step 1

```bash
deskpilot version
ls -l /usr/share/deskpilot/scripts/desk.sh
```

Both must succeed. The scripts path is not cosmetic: the binary's subprocess allowlist is
fixed when it is compiled, so `/usr/share/deskpilot/scripts/desk.sh` is the **only** copy
it may execute. A `desk.sh` anywhere else is found and then refused, which presents
exactly as "this machine has no compositor".

---

## 2. Set it up and start it

Binary installs only — a source install did this in step 1.

```bash
deskpilot setup
systemctl --user daemon-reload
systemctl --user enable --now deskpilot
```

`setup` writes a token and the user service and prints those two commands. It will not
run `systemctl` itself: that would mean adding `systemctl` to the server's subprocess
allowlist, and the server is an HTTP endpoint whose job is executing things.

### Verify step 2

```bash
systemctl --user is-active deskpilot          # want: active
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/    # want: 200
curl -s http://127.0.0.1:8790/api/capabilities \
  -H "authorization: Bearer $(tr -d '\n' < ~/.config/deskpilot/token)"
```

The last one should be JSON naming a version, `"sessions":true` and `"terminal":true`.
`"windows":false` and `"screenshot":false` are correct on a headless box.

If the unit is not active, `journalctl --user -u deskpilot -n 40 --no-pager` will say
why. Report what it says rather than guessing.

---

## 3. Give it an address the phone can reach

**This step is not optional, and it is where installs actually fail.** deskpilot binds
loopback deliberately — it is an endpoint that runs commands — so until something fronts
it there is no address for a phone to open at all. Skipping this does not produce a
degraded install; it produces one that cannot be paired.

Today that fronting is [Tailscale](https://tailscale.com).

**HUMAN — three parts, all of which need a person:**

1. `tailscale up` opens a browser to sign in. It cannot be completed from a shell.
2. HTTPS certificates must be enabled once for the tailnet, at
   [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns) — the
   **Enable HTTPS** button. Without it `tailscale serve` has no certificate to use.
   This is per-tailnet, not per-machine, so it may already be done.
3. Root, unless step 0 found an operator. `tailscale up` and the `tailscale serve` below
   both change daemon state, and only root may do that; each refuses with its own
   `Access denied` line — `serve` says `Access denied: serve config denied`. Two ways
   out, and the person picks: run those commands with `sudo`, or
   `sudo tailscale set --operator=$USER` once, after which everything here works
   unprivileged and matches the commands as printed. Do not try to route a password
   through the shell; ask.

The commands below are written bare, as they run once an operator is set. Prefix them
with `sudo` when one is not.

Ask the person to do all three, then:

```bash
tailscale serve --bg --yes 8790
```

Also tell them, in the same message, that **the phone needs Tailscale as well, signed
in.** The address below is a tailnet name; a device that is not on the tailnet cannot
resolve it, so the scan lands on the browser's own "can't be reached" page. On a phone
that has never loaded the app there is no service worker either, so deskpilot's own
offline page cannot explain it — it reads as broken pairing rather than a missing VPN.
This is the single most common way a first pairing goes wrong.

### Verify step 3

```bash
tailscale serve status
/usr/share/deskpilot/scripts/desk.sh addr    # or scripts/desk.sh addr from a checkout
```

`desk.sh addr` prints the URL a phone can open, and prints nothing and exits non-zero
when there is not one. It **fetches** each candidate rather than assuming: owning a
tailnet IP says nothing about whether anything is listening on it.

- **Prints an `https://…ts.net` address** — correct. Continue.
- **Prints an `http://` address** — something answers, but plain http is not a secure
  context: the app will not offer to install to the home screen and push notifications
  cannot work. Usually means Serve is not running and it fell back to a raw IP. Worth
  fixing before continuing.
- **Prints nothing** — Serve is not fronting the port. Do not continue; pairing has no
  address to hand out.
- **Says `unknown command: addr`** — this binary predates the command. `addr` landed
  after **0.1.3**, so every release before it has a `desk.sh` without one, and this
  runbook lives on `main` where it exists. Not a failed step and not a reason to stop.
  Read the address off `tailscale serve status` instead — the `https://…ts.net` line at
  the top of its output is the same URL. **Verify it yourself before step 4**, because on
  these versions nothing downstream will: `deskpilot pair` predates the address too, and
  prints a bare code with no QR, no URL and no reachability check. The safety net that
  makes a dead QR impossible is on `main` only, so here you are the net.

A LAN address without Tailscale does work on the same network, at the cost of the
installable app and of working from anywhere. Only take that path if the person asks for
it explicitly.

---

## 4. Pair the phone

```bash
deskpilot pair          # or shell/pair.sh from a checkout
```

This prints a QR, the address it encodes, and an eight-character code good for ten
minutes and one device. The QR carries the address and the code together, so there is
nothing to type.

**On 0.1.3 and earlier there is no QR and no address** — only the code, and a note
telling you to go and find the URL. Give the person the address from step 3 alongside the
code; they open it and type the code in. Everything after that is identical.

**HUMAN: ask them to scan it with the phone's camera**, then to add the page to the home
screen — Android/Chrome offers an **install** button; iOS/Safari needs **Share → Add to
Home Screen**. Installing rather than bookmarking is what gets full-screen, durable
storage, and push on iOS.

If the output says **"Nothing answered on an address a phone could reach"**, step 3 did
not take effect. That message is not a pairing failure; go back and fix Serve.

Codes expire in ten minutes and are single-use. If one is missed, run `pair` again — do
not reuse it.

### Verify step 4

The person's phone shows the session list. There is no way to confirm this from the
shell, so ask them.

---

## 5. Report the end state

Tell them, briefly:

- the address the app is at,
- which capabilities this machine has (from step 2's JSON) — in particular, say plainly
  if windows and screenshots are unavailable and why,
- that remote unlock is **off** and stays off until `DESKPILOT_UNLOCK=1` is set in
  `~/.config/deskpilot/config`, that it needs `ydotool`, and that it types a password
  into a live lock screen — so it is theirs to turn on deliberately, not a default,
- how to update: `deskpilot update` on a binary install, `git pull && shell/setup.sh`
  from a checkout, the package manager if a package owns it.

From a source checkout, finish with `shell/check.sh`. It verifies every environment
assumption in one pass and is the fastest way to find out that something silent has
broken. It is not shipped in a release tarball — on a binary install, step 2's
capabilities JSON plus step 3's `desk.sh addr` cover the same ground, or `tailscale serve
status` where the binary is old enough to lack `addr`.

---

## When something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deskpilot pair` prints a code but no QR or address | nothing is fronting the port | step 3 |
| `desk.sh addr` says `unknown command: addr` | the installed binary is older than the command, which landed after 0.1.3 | read the URL from `tailscale serve status`, and confirm it yourself — `pair` on these versions does not |
| `deskpilot pair` prints a bare code, no QR and no address, on a binary at or below 0.1.3 | expected; `pair` learned the address after 0.1.3 | not a Serve fault. Hand over the URL from `tailscale serve status` with the code |
| `tailscale up` or `serve` refuses with `Access denied` (`serve config denied` from `serve`) | they change daemon state; only root may, unless this user is the operator | run with `sudo`, or `sudo tailscale set --operator=$USER` once |
| Phone shows "can't be reached" after scanning | the phone is not on the tailnet | install Tailscale on the phone and sign in |
| No install prompt on the phone | the address is plain http, not a secure context | `tailscale serve --bg --yes 8790` |
| Capabilities say `"compositor":"none"` on a Hyprland box | the user unit has no `WAYLAND_DISPLAY` | `systemctl --user import-environment WAYLAND_DISPLAY HYPRLAND_INSTANCE_SIGNATURE` |
| Windows unavailable, Hyprland is running | Hyprland older than 0.56.2 | every dispatcher moved to a Lua API in 0.56.2; upgrade |
| `desk.sh` present but "no compositor" | `desk.sh` is not at the compiled-in path | it must be at `/usr/share/deskpilot/scripts/desk.sh` |
| Sessions vanish after a restart | `KillMode` is not `process` | tmux runs as a child of the unit; do not change it |
| Everything works from the desktop, nothing from the phone | reaching it by a different origin | not a firewall issue by default — Serve keeps the port closed on every interface |

Anything else: `journalctl --user -u deskpilot -n 60 --no-pager`, and report what it
actually says.
