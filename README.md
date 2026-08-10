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

## Status

| Piece | State |
|---|---|
| `desk-control` skill — query, move, capture, verify | **done, tested** |
| `claude()` tmux wrapper — makes sessions addressable | **installed, tested** |
| Permission rules — stop the prompt storm from a phone | **installed** |
| Remote Control trial — works, too clunky for daily use | **done, see decisions** |
| SSH + tmux + Tailscale reachability | not started |
| Deno server — `tmux send-keys`, `hyprctl`, `grim` behind HTTP | not started |
| Svelte PWA — swipe workspaces 1–10, prompt the session on each | not started |
| `ydotool` remote unlock | not started |
| Optional wayvnc stream | deferred, may never be needed |

Nothing above the line requires anything below it. The skill works today from any
terminal on this machine.

## Layout

```
skills/desk-control/    Claude Code skill; symlinked into ~/.claude/skills/
shell/claude-tmux.sh    bash wrapper — opt in by sourcing from ~/.bashrc
docs/decisions.md       what was chosen, what was rejected, and why
```

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
