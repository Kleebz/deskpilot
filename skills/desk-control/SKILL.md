---
name: desk-control
description: >
  Inspect and manipulate the LIVE Hyprland session at runtime — list open windows, read
  their geometry and workspace, move/resize/tile them, list tmux sessions and where they
  are on screen, and capture screenshots so Claude can describe what is on screen. Use
  when asked what is open, where a window is, to move or arrange windows, to look at or
  check the screen, to verify a UI change visually, or when driving the desktop remotely
  from a phone. Excludes editing config files in ~/.config/hypr/ — use the `omarchy`
  skill for persistent config changes.
---

# Desk control

The commands live in `~/Projects/deskpilot/scripts/`, as plain shell. They are the
single source of truth and are also called directly by the deskpilot server with no
agent involved. Do not reimplement them inline with raw `hyprctl` — the scripts already
handle the traps documented below.

```bash
D=~/Projects/deskpilot/scripts

$D/desk.sh state [ws]              # windows, one line each: ws, address, geometry, mode, class, title
$D/desk.sh json [ws]               # same as JSON
$D/desk.sh locked                  # "locked"/"unlocked"; exit 0 when locked
$D/desk.sh shot [out] [ws]         # screenshot; refuses when locked
$D/desk.sh shot-window <addr> [out]  # crop to one window, full quality
$D/desk.sh move <addr> <ws>        # move to a workspace without following
$D/desk.sh tile <addr>             # clear float+fullscreen so the tiler takes over
$D/desk.sh place <ws> <cmd...>     # launch something in a window on a workspace

$D/sessions.sh [--plain]           # tmux sessions and the workspace each is on
```

This skill is about **runtime state**. Changing `hyprland.conf` so a window *always*
opens somewhere is a different job — that is the `omarchy` skill.

## State before pixels

`desk.sh state` is ~1 KB and exact. A screenshot is 40–90 KB and inferred. Answer from
state whenever the question is about *what is where* — what is open, which workspace,
what has focus, is it tiled. Only reach for pixels when the question is about
**rendering**: does this look right, did the layout break, what does that dialog say.

When you do capture, prefer `shot-window` over `shot` — cropping to the relevant window
is smaller and more readable than shrinking the whole screen.

**Never screenshot a terminal.** If the window is a terminal running a tmux session,
`tmux capture-pane -p -t <session> -S -40` returns the same information as ~2 KB of text
that reflows on a phone. A screenshot of the same window measured 210 KB and cannot be
searched, quoted, or scrolled. Screenshots are for GUI windows — a browser, a design
tool, an app being built — where pixels are the only representation.

Image size is driven by content, not dimensions: the same 941x1030 terminal measured
38 KB when mostly empty and 210 KB when full of syntax-coloured text. Do not assume a
crop is cheap.

## Verify by re-reading, not by exit code

A dispatcher returns `ok` for moves that did not do what was meant. After any change,
re-run `desk.sh state` and confirm. This matters most when nobody is looking at the
screen.

## Traps the scripts already handle

Know these so you understand what the scripts are protecting you from, and so you do not
route around them:

- **`grim` succeeds on a locked session** and returns a valid image of the hyprlock
  password prompt. `desk.sh shot` refuses when locked; say the screen is locked and
  answer from state instead.
- **`grim -g` crops the composited output, not a window's buffer.** Hyprland only
  composites the *visible* workspace, so capturing a window on a hidden one silently
  returns whatever is at those screen coordinates instead — a different window, and a
  different one each time depending on what is on screen. `desk.sh shot-window` switches
  to the target workspace, captures, and switches back. Never call `grim -g` yourself.
- **`loginctl` cannot detect the lock.** `LockedHint` reads `no` while hyprlock is
  running. Only `pidof hyprlock` works.
- **`dispatch fullscreen` is a toggle, not a setter**, and floating/fullscreen/tiled are
  three independent states. `desk.sh tile` reads current state before acting.
- **Workspaces are 1..10; there is no workspace 0.** If the user says "workspace 0" they
  mean **10** — `0` is the key bound to it. Translate and say which you used.

## Remote discipline

When this is driven from a phone the user is reading prose on a small screen over a
metered connection.

- Lead with the answer in a sentence. Do not paste raw JSON unless asked.
- Resolve references from `class` and `title` — "the browser", "my terminal" — rather
  than asking for information the user cannot see.
- If a request is ambiguous between two windows, list the candidates in one short line
  each and ask. Cheaper than moving the wrong thing.
- Never run `slurp`; it needs someone at the machine.

## Blast radius

This acts on a real session, possibly while nobody is watching it.

- Confirm before closing anything unless the user named that exact window.
- Do not move or resize windows that were not part of the request.
- `desk.sh move` is silent by design — it does not yank the visible workspace out from
  under someone who is at the desk.
