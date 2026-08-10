---
name: desk-control
description: >
  Inspect and manipulate the LIVE Hyprland session at runtime — list open windows, read
  their geometry and workspace, move/resize/focus/close them, and capture screenshots so
  Claude can describe what is on screen. Use when asked what is open, where a window is,
  to move/resize/arrange windows, to look at or check the screen, to verify a UI change
  visually, or when driving the desktop remotely from a phone over SSH. Excludes editing
  config files in ~/.config/hypr/ — use the `omarchy` skill for persistent config changes.
---

# Desk control

Observe and drive the running Hyprland session. Verified against Hyprland 0.56.0 on a
single 1920x1080 output named `DP-2`.

This skill is about **runtime state**. Changing `hyprland.conf` so a window *always*
opens somewhere is a different job — that is the `omarchy` skill.

## Environment first

`hyprctl` and `grim` talk to the compositor through environment variables. A plain SSH
shell does not have them and both will fail with confusing errors.

Check before anything else:

```bash
echo "${HYPRLAND_INSTANCE_SIGNATURE:-UNSET} ${WAYLAND_DISPLAY:-UNSET}"
```

If either is `UNSET`, you are outside the graphical session. Recover with:

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export HYPRLAND_INSTANCE_SIGNATURE=$(ls -t $XDG_RUNTIME_DIR/hypr | head -1)
export WAYLAND_DISPLAY=$(basename $(ls -t $XDG_RUNTIME_DIR/wayland-* 2>/dev/null | grep -v '\.lock$' | head -1))
```

The durable fix is to attach to a tmux session that was started from inside Hyprland
(`exec-once = tmux new -d -s phone`), which inherits all of it.

## Look: state before pixels

Always prefer JSON. It is ~1 KB after filtering versus ~1.4 MB for a screenshot, it is
exact rather than inferred, and it works on a bad connection.

One line per window — the default way to answer "what's open?":

```bash
hyprctl clients -j | jq -r 'sort_by(.workspace.id)[] |
  "ws\(.workspace.id) \(.at|join(","))+\(.size|join("x")) \(if .floating then "float " else "" end)\(.class) — \(.title)"'
```

Add `.address` to that filter when you intend to act on a window; you need it to target
dispatchers. Other queries:

```bash
hyprctl activewindow -j     # what has focus right now
hyprctl monitors -j         # outputs, resolution, active workspace, scale
hyprctl workspaces -j       # workspace ids and window counts
```

Answer from this whenever the question is about *state* — what is open, where it is,
what has focus, which workspace is on screen. Do not screenshot for these.

## Look: pixels

**Check the lock first. Always, before any capture:**

```bash
pidof hyprlock >/dev/null && echo LOCKED || echo unlocked
```

`grim` does *not* fail on a locked session — it returns exit 0 and a perfectly valid
image of the hyprlock password prompt. Sending that as "here is your app" is worse than
sending nothing. When locked, say so and answer from window state instead; the JSON is
completely unaffected by the lock.

Do not use `loginctl` for this. `LockedHint` reads `no` while hyprlock is demonstrably
running — hyprlock never reports to logind. `pidof hyprlock` is the only reliable check.

Screenshot only when the question is about **rendering** — does this look right, did the
layout break, what does this dialog say. Never send a full-size PNG when a scaled JPEG
will do:

```bash
grim -t jpeg -q 60 -s 0.5 /tmp/screen.jpg    # ~67 KB — the default choice
grim -o DP-2 -t jpeg -q 60 -s 0.5 /tmp/screen.jpg   # one specific output
grim -t jpeg -q 80 /tmp/screen.jpg           # full size, when detail matters
grim -g "$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')" \
     -t jpeg -q 75 /tmp/win.jpg              # just the focused window
```

Then read the file to see it. Cropping to the relevant window beats full-screen: smaller,
and it removes everything you were not asked about.

**Pick the scale from the question.** `-s 0.5` (~85 KB full screen) is fine for layout —
is it split, did it move, is the right app there. It is too coarse to reliably read
terminal or UI text. When the content matters, crop to the window and use `-q 80` at
full scale instead of shrinking the whole screen.

`slurp` (interactive region select) requires someone at the machine — never use it when
driving remotely.

## Act: window manipulation

Target windows by address from `hyprctl clients -j`. Without an address the dispatcher
acts on the focused window.

**Workspace numbering.** Workspaces are 1..10; there is no workspace 0. If the user says
"workspace 0" they mean **workspace 10** — `0` is the key bound to it (`code:19`) in the
Omarchy binds. Translate silently and say which one you used.

```bash
A=0x5588b34bc4d0
hyprctl dispatch focuswindow address:$A
hyprctl dispatch movetoworkspace 3,address:$A          # follows the window
hyprctl dispatch movetoworkspacesilent 3,address:$A    # stays put
hyprctl dispatch togglefloating address:$A
hyprctl dispatch fullscreen 0                          # TOGGLE — see caveat below
hyprctl dispatch pin address:$A
hyprctl dispatch closewindow address:$A
```

**Three independent states.** A window is tiled-or-floating (`.floating`) *and* separately
has a fullscreen state (`.fullscreen`: 0 none, 1 maximized, 2 fullscreen). Both block the
tiler. A window can be `floating=true fullscreen=2` at once — clear both before expecting
any layout change to take effect:

```bash
hyprctl --batch "dispatch focuswindow address:$A ; dispatch fullscreen 0 ; dispatch togglefloating address:$A"
```

**`dispatch fullscreen` is a toggle, not a setter.** The exact same command clears
fullscreen on a fullscreen window and applies it to a normal one. Never issue it blind —
read `.fullscreen` first, decide whether a change is actually needed, and re-query after.
Getting this wrong does the precise opposite of what was asked, and when the user is not
looking at the screen nothing reveals it.

The two numbering schemes also disagree, which is easy to misread:

| | 0 | 1 | 2 |
|---|---|---|---|
| `.fullscreen` in JSON | none | maximized | fullscreen |
| `dispatch fullscreen` arg | true fullscreen | maximize | — |

Once two windows on a workspace are tiled and not fullscreen, Hyprland splits them
side by side on its own — no pixel math, and gaps and the waybar offset come out right.
On this 1920x1080 setup a correct two-window split is `12,38+941x1030` and
`967,38+941x1030`; use that as the reference for "did it actually tile?"

**Pixel dispatchers only affect floating windows:**

```bash
hyprctl dispatch movewindowpixel exact 100 100,address:$A
hyprctl dispatch resizewindowpixel exact 800 600,address:$A
```

For a tiled window, use directional dispatchers instead — or float it first:

```bash
hyprctl dispatch movewindow l          # move within the tiling layout
hyprctl dispatch swapwindow r          # swap with the neighbour
hyprctl dispatch movefocus u           # just move focus
```

Chain related changes so they apply together:

```bash
hyprctl --batch "dispatch togglefloating address:$A ; dispatch resizewindowpixel exact 1200 800,address:$A ; dispatch centerwindow"
```

## Verify

After acting, re-query rather than assuming. A dispatcher can succeed and still not do
what was meant — a tiled window ignores a pixel move, a workspace may not exist.

```bash
hyprctl clients -j | jq -r --arg a "$A" '.[] | select(.address==$a) |
  "ws\(.workspace.id) \(.at|join(","))+\(.size|join("x")) floating=\(.floating)"'
```

Confirm with JSON. Only take a screenshot if the user asked to see it, or if the JSON
looks right but something might still be visually wrong.

## Remote discipline

When this is being driven from a phone, the user is reading prose on a small screen over
a metered connection. So:

- Lead with the answer in a sentence. "Firefox is floating on workspace 2, 940x1030."
  Do not paste raw JSON unless asked.
- Default to state, escalate to pixels only on request or when rendering is genuinely
  the question.
- When you do send an image, scale it down and crop it.
- Resolve references from `class` and `title` — "the browser", "my terminal" — rather
  than asking the user for coordinates they cannot see.
- If a request is ambiguous between two windows, list the candidates in one short line
  each and ask. Cheaper than guessing wrong and moving the wrong thing.
- Never run `slurp`, and never do anything that opens a modal or grabs input.

## Blast radius

This acts on the user's real session, possibly while they are not looking at it.

- `closewindow` can lose unsaved work. Confirm before closing anything, unless the user
  named that exact window.
- Do not move or resize windows that were not part of the request.
- Prefer `movetoworkspacesilent` when the user is away — it does not yank the visible
  workspace out from under them.
