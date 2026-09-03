# deskpilot

Prompt Claude Code — and steer the Omarchy desktop it runs on — from a phone.

The goal is not a shrunk-down desktop. It is: kick off work, steer it, and have Claude
*interpret* what is on screen and report back in prose. Pixels are the exception, not
the medium.

## Design in one line

Three tiers of visibility, cheapest first — window state as text (~1 KB), a cropped
still on demand (~70 KB), a live stream only if it earns its place.

Step-by-step install is in **[docs/setup.md](docs/setup.md)** — ordered, each step with
a verification and a rollback. Full reasoning, including the options rejected and why,
is in [docs/decisions.md](docs/decisions.md).

## Start here

```bash
shell/setup.sh
```

Does everything that can be automated — builds the UI, links the skill, merges the
Claude Code settings, sources the wrapper, installs the service, then runs the checks.
Idempotent, so re-run it after pulling or moving the repo. It finishes by printing the
three things no script can do for you: authenticating Tailscale, pairing the phone, and
granting notification permission on the device.

That gets you a working app on `localhost`. To reach it from outside the house, add
Tailscale and run `shell/use-https.sh` — see [docs/setup.md](docs/setup.md) step 4.
For the phone to tell you when a session needs you rather than waiting to be checked,
run `shell/install-hooks.sh` and turn notifications on in the app — step 5.

## Which scripts you run, and how often

Everything except `check.sh` and `pair.sh` is **one-time**. The state each one sets up
persists across reboots — systemd units, a Tailscale Serve config, a udev rule, a line
in `.bashrc`.

| Script | When |
|---|---|
| `setup.sh` | any time — runs everything below that can be automated |
| `check.sh` | any time — diagnostic, changes nothing |
| `install-service.sh` | once, and again only if you move the repo |
| `install-permissions.sh` | once, and again if the rule set changes |
| `install-hooks.sh` | once — lets an agent announce when it needs you; re-run if you move the repo |
| `install-input.sh` | once — needed for remote unlock |
| `use-https.sh` | once — real certificate, loopback-only binding, PWA installable |
| `use-tailscale.sh` | only as a fallback if you cannot enable certificates |
| `pair.sh` | per device, and whenever the address changes |

`use-https.sh` and `use-tailscale.sh` are alternatives, not a sequence. HTTPS is both
easier and safer — Serve proxies from loopback, so the port never has to be open on any
interface — and it is the only one that makes the PWA installable. Take the fallback
only if you cannot turn on HTTPS certificates for your tailnet.

Expect to re-pair whenever the address changes: a token is stored per host and does not
carry over.

## Status

| Piece | State |
|---|---|
| `desk-control` skill — query, move, capture, verify | **done, tested** |
| `claude()` tmux wrapper — makes sessions addressable | **done, tested** |
| Permission rules — stop the prompt storm from a phone | **done** |
| Deno server — wraps `scripts/` behind HTTP, runs as a user service | **done, tested** |
| Svelte web UI — swipe workspaces 1–10, prompt, tile, look | **done, tested** |
| Terminal view — a PTY sized to the phone, via xterm.js | **done, tested** |
| Tailscale + HTTPS reachability, PWA install | **done, tested** |
| `ydotool` remote unlock | **done, tested** |
| Remote Control trial — evaluated and **rejected** | see decisions |
| Optional wayvnc stream | deferred, may never be needed |

Each piece is useful without the ones below it. The skill works from any terminal on
this machine with nothing else installed.

## Layout

```
CLAUDE.md               context for an agent working on this repo
deskpilot.conf.example  terminal, lock program, dirs, host — copy to ~/.config/deskpilot/config
shell/                  installers and diagnostics, all idempotent and safe to re-run
web/                    Svelte + Vite UI; `npm run build` before first use
server/server.ts        Deno HTTP wrapper over scripts/ and tmux
scripts/                portable shell — the actual desktop + session commands
  desk.sh               window state, screenshots, move/tile, place
  sessions.sh           tmux sessions and the workspace each is on
shell/claude-tmux.sh    bash wrapper — opt in by sourcing from ~/.bashrc
skills/desk-control/    thin Claude Code pointer at scripts/; symlinked into ~/.claude/skills/
docs/decisions.md       what was chosen, what was rejected, and why
docs/setup.md           ordered install, each step with a check and a rollback
docs/permissions.json   permission rules, applied by shell/install-permissions.sh
```

Everything in `scripts/` is plain shell with no agent involved. That is deliberate — see
the hard constraints in the decisions doc.

## The skill

Lives here, symlinked so edits are live:

```bash
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/desk-control" ~/.claude/skills/desk-control
```

It documents the runtime vocabulary — `hyprctl clients -j` for state,
`hyprctl dispatch` for moves, `grim` for pixels — plus the traps found by
actually hitting them (see decisions doc).

## The tmux wrapper

Installed via `~/.bashrc`. Opt out by removing the `source` line.

To install on a fresh machine:

```bash
echo "source $PWD/shell/claude-tmux.sh" >> ~/.bashrc
```

Then `claude` in `~/some-project` transparently runs inside a tmux session named
`some-project`. Desk experience is unchanged; the session becomes addressable as
`tmux send-keys -t some-project ...`, which is what everything remote is built on.

## Environment this was verified against

Omarchy / Hyprland 0.56.0, single 1920x1080 output `DP-2`, hyprlock 0.9.6,
Deno 2.9.3, Node 26.2.0.

Required: `hyprctl`, `tmux`, `jq`, `grim`, `deno`, plus `npm` to build the UI.
Needed for the optional pieces: `tailscale` (reach it from outside),
`ydotool` (remote unlock), `qrencode` (nicer pairing QR — `pair.sh` falls back to Deno).
`check.sh` reports on all of them.

## Installing

**Arch / Omarchy**

```
yay -S deskpilot-bin      # or paru, or makepkg from the PKGBUILD on the release
deskpilot setup           # asks two questions, then prints a pairing code
```

**Anywhere else**

Download the tarball from the [releases page](https://github.com/Kleebz/deskpilot/releases),
check it against the published `.sha256`, then put `desk.sh` where the binary is
compiled to look for it:

```
tar xzf deskpilot-*-x86_64.tar.gz
sudo install -Dm755 deskpilot /usr/bin/deskpilot
sudo install -Dm755 scripts/*.sh -t /usr/share/deskpilot/scripts/
```

That path is not cosmetic: the binary's subprocess allowlist is fixed when it is
built, so `/usr/share/deskpilot/scripts/desk.sh` is the only copy it is
permitted to execute. A copy elsewhere is found and then refused, which looks
like "this machine has no compositor".

**What is actually required:** `tmux`, and nothing else. `hyprland`, `grim` and
`ydotool` are optional — the server reports what it can do and the app hides the
rest, so a headless box serves sessions and terminals and simply says it has no
windows. That path is tested, not assumed: `tests/headless.sh` runs the real
binary in a sandbox with no compositor, no Wayland and a different `$HOME`.

**What it will ask you.** Two things, both editing files outside deskpilot, both
declinable and both reversible by running `setup` again:

- one line in your shell profile, so agents you start at your desk appear on
  your phone
- notification hooks and permission rules in `~/.claude/settings.json`

`--yes` accepts both for a scripted install; `--no-shell` and `--no-claude`
refuse them individually. With no terminal attached it declines rather than
assuming.

**Remote unlock is off** unless you set `DESKPILOT_UNLOCK=1`. It types your
password into the lock screen and needs `ydotool`'s udev rule, so having the
tool installed is not the same as consenting to it being reachable.


## Verifying phone layout

Do not judge phone layout by eye or by desktop screenshots — both have lied
here repeatedly. Measure it:

```
deno run -A tests/layout.ts            # against the local service
deno run -A tests/layout.ts --url https://host --token abc
```

It drives headless Chromium over CDP at 320/360/390/430, and asserts the
viewport is the size it asked for *before* trusting anything else — a resize
silently not taking effect is how a layout once got declared "verified in a
narrow viewport" at 941px.

Then: every pane exactly one viewport wide, no header overflow, nothing
escaping its own pane's clipping box, and every control at least 44px tall.

All four assertions have been checked against deliberate breakage; a test that
cannot fail is worse than no test.
