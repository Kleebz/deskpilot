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
shell/check.sh            # verifies every assumption, tells you what is missing
shell/install-service.sh  # token, unit, enable, print the URL
shell/pair.sh             # QR to pair a phone
```

## Which scripts you run, and how often

Everything except `check.sh` and `pair.sh` is **one-time**. The state each one sets up
persists across reboots — systemd units, a Tailscale Serve config, a udev rule, a line
in `.bashrc`.

| Script | When |
|---|---|
| `check.sh` | any time — diagnostic, changes nothing |
| `install-service.sh` | once, and again only if you move the repo |
| `install-permissions.sh` | once, and again if the rule set changes |
| `install-input.sh` | once — needed for remote unlock and typing |
| `use-tailscale.sh` | once — makes the port tailnet-only |
| `use-https.sh` | once — real certificate, and the PWA becomes installable |
| `pair.sh` | per device, and whenever the address changes |

The address changes twice by design — LAN to tailnet, then tailnet to the HTTPS name —
so expect to re-pair at each step. A token is stored per host and does not carry over.

## Status

| Piece | State |
|---|---|
| `desk-control` skill — query, move, capture, verify | **done, tested** |
| `claude()` tmux wrapper — makes sessions addressable | **installed, tested** |
| Permission rules — stop the prompt storm from a phone | **installed** |
| Remote Control trial — evaluated and **rejected** | **done, see decisions** |
| SSH + tmux + Tailscale reachability | not started — the only step left needing sudo |
| Deno server — wraps `scripts/` behind HTTP, runs as a user service | **built, tested** |
| Svelte web UI — swipe workspaces 1–10, prompt, tile, look | **built, tested** |
| `ydotool` remote unlock | not started |
| Optional wayvnc stream | deferred, may never be needed |

Nothing above the line requires anything below it. The skill works today from any
terminal on this machine.

## Layout

```
CLAUDE.md               context for an agent working on this repo
deskpilot.conf.example  terminal, lock program, dirs, host — copy to ~/.config/deskpilot/config
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
ln -s ~/Projects/deskpilot/skills/desk-control ~/.claude/skills/desk-control
```

It documents the runtime vocabulary — `hyprctl clients -j` for state,
`hyprctl dispatch` for moves, `grim` for pixels — plus the traps found by
actually hitting them (see decisions doc).

## The tmux wrapper

Installed via `~/.bashrc`. Opt out by removing the `source` line.

To install on a fresh machine:

```bash
echo 'source ~/Projects/deskpilot/shell/claude-tmux.sh' >> ~/.bashrc
```

Then `claude` in `~/Projects/zigwam` transparently runs inside a tmux session named
`zigwam`. Desk experience is unchanged; the session becomes addressable as
`tmux send-keys -t zigwam ...`, which is what everything remote is built on.

## Environment this was verified against

Omarchy / Hyprland 0.56.0, single 1920x1080 output `DP-2`, hyprlock 0.9.6,
Deno 2.9.3, Node 26.2.0, Python 3.14.6. `grim`, `slurp`, `jq`, `tmux`, `wl-copy`
present. `wtype`, `ydotool`, `tailscale`, `mosh` absent.
