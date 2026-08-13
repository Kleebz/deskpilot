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
shell/check.sh                       # verifies every assumption, tells you what is missing
cd web && npm install && npm run build && cd ..   # the server 503s without this
shell/install-service.sh             # token, unit, enable, print the URL
shell/pair.sh                        # QR to pair a phone
```

That gets you a working app on `localhost`. To reach it from outside the house, add
Tailscale and run `shell/use-https.sh` — see [docs/setup.md](docs/setup.md) step 4.

## Which scripts you run, and how often

Everything except `check.sh` and `pair.sh` is **one-time**. The state each one sets up
persists across reboots — systemd units, a Tailscale Serve config, a udev rule, a line
in `.bashrc`.

| Script | When |
|---|---|
| `check.sh` | any time — diagnostic, changes nothing |
| `install-service.sh` | once, and again only if you move the repo |
| `install-permissions.sh` | once, and again if the rule set changes |
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
