# Decisions

Why the design is what it is, including options rejected. Dated 2026-08-10.

## Architecture

**Three tiers of visibility, cheapest first.**

| Tier | Channel | Payload |
|---|---|---|
| 1 | `hyprctl clients -j` | ~1 KB after filtering |
| 2 | `grim` cropped/scaled JPEG on demand | 15–200 KB |
| 3 | Live stream (wayvnc) | continuous |

Tier 1 answers *state* questions — what is open, where, what has focus. Tier 2 answers
*rendering* questions — does this look right. Most questions are tier 1, which is why
the phone side is mostly prose.

This split turned out to be load-bearing for a reason we did not anticipate: **tier 1
keeps working when the screen is locked and tier 2 does not.** The cheap path is also
the robust one.

**Tier 3 is deferred and may never be built.** It is a separate channel from the control
path, so it can be added later without redesigning anything.

## Interpretation over transmission

Claude looks at the screenshot and sends prose. The phone receives text, which is the
medium a phone is good at. Consequence: thumbnails of terminals are pointless — at phone
size you learn "that is a terminal" and nothing else. The window *title* is a better
label than a thumbnail of it. Pixels earn their keep for rendered UI, not for text.

## Addressing: workspace number = phone screen

Swipe through screens matching workspaces 1–10; prompting on screen N routes to the
Claude session on workspace N.

Chosen because it reuses a mental model that already exists — no session registry to
invent, no naming scheme to learn, spatial memory does the work of a picker.

Validated against real usage: **never more than one Claude session per workspace**, so
"prompt screen 4" is unambiguous. Six of ten workspaces were empty, so the UI should
collapse empties while keeping the real numbers as labels.

Addresses are resolved dynamically (workspace → window with `✳` title → its tmux
session), not bound statically, so rearranging windows does not break routing. Muscle
memory will briefly be wrong after a move; accepted.

## Routing: named tmux sessions

Needed two properties: survive a dropped mobile connection, and expose a named handle to
inject prompts into. tmux is the only thing already installed that gives both.

Rejected `claude --resume` — it forks a new process rather than steering the one running
at the desk. Different semantics.

The user should never manage tmux by hand, so a `claude()` bash wrapper wraps it
invisibly (`shell/claude-tmux.sh`). Desk experience is byte-identical; the session
becomes addressable for free.

Known costs: shadowing `claude` makes `which claude` confusing, and two sessions in the
same directory collide on name (`-A` attaches to the first rather than starting fresh).

## Transport

**Remote Control first, SSH as the escape hatch, PWA as the eventual daily driver.**

The traffic is tiny and turn-based — a phrase in, a sentence out. A TUI is overkill for
that, so chat-shaped beats terminal-shaped for the common case. But chat cannot recover
a dead session; a shell can. SSH is worth building precisely because it is what saves
you when the nice path breaks — including if a remote unlock experiment goes wrong.

Open question, cheap to settle: whether Remote Control can *initiate* work or only reply
to a session started before leaving.

## Network: Tailscale

Primary use is off the home network, so LAN-only is out.

Chosen over Cloudflare Tunnel — which is genuinely easier to set up for HTTP — because
the endpoint can execute commands on the machine holding the SSH keys and browser
sessions. "No public listener exists" is worth more than "there is an auth layer in
front of it." Friction is one-time; daily use is invisible.

Headscale or Netbird if the third-party control plane becomes objectionable. Costs a VPS.

Regardless: a bearer token on the endpoint. The network must not be the only auth.

## Frontend: Svelte + Vite

Initially specced as vanilla single-file, on the theory that avoiding a build step
preserved the edit → refresh loop. **Revised.** Two reasons:

1. The state is bigger than it looked — per pane: captured output, poll state, pending
   prompt, image, errors; plus preserving scroll position as output appends. That is
   ~500 lines of vanilla and the kind of code that rots.
2. `vite dev` with HMR over Tailscale is a *better* loop than pull-to-refresh, not a
   worse one.

Rejected Flutter Web specifically: multi-megabyte canvas runtime, renders text outside
the DOM, fights native scroll — and scroll is the core gesture. Rejected native: nothing
here needs it except background push, which Remote Control already covers.

## Backend: Deno

Over Bun, for one reason:

```
deno run --allow-net --allow-run=tmux,hyprctl,grim server.ts
```

The subprocess allowlist is **scopeable to three binaries**. For an endpoint whose entire
job is shelling out, reachable from a phone, that is a real blast-radius limit — an
injection bug still cannot reach `rm` or `ssh`. Bun is all-or-nothing.

Bun wins on ergonomics (`Bun.$`, built-in bundler). Not enough to give up the sandbox.

## Unlock: ydotool, not pkill

`hyprlock` 0.9.6 has **no** remote unlock — no CLI flag, no D-Bus handler, and Hyprland
exposes no unlock dispatcher. `loginctl unlock-session` does not reach it.

Killing hyprlock was considered and **rejected as a mechanism**: it bypasses
authentication entirely. If it works, that is closer to a hole in the setup than a
feature to build on.

`ydotool` is correct because it goes *through* authentication. It writes to `/dev/uinput`,
below the Wayland layer, so hyprlock receives real keystrokes and validates them via PAM
exactly as if typed at the desk. `wtype` would not work — the virtual-keyboard protocol
is refused for lock surfaces, which is the point of the protocol.

Security consequence, accepted deliberately: the password travels phone → endpoint →
`ydotool`. Pass it on stdin, never argv (`/proc/*/cmdline` is world-readable), never log
it, and gate unlock behind a different credential than the one that lists workspaces.

**Prefer unlock-on-demand over inhibiting the lock.** Inhibiting leaves the desktop
unlocked the whole time you are away; unlocking for the minute you need it keeps it
locked by default.

## Verified findings

Each of these was found by hitting it, not by reading docs. All are encoded in the skill.

- **`grim` works while locked** and returns a valid image *of the lock screen*. It does
  not fail, so an unguarded capture silently returns a password prompt labelled as your
  app. Check `pidof hyprlock` before any capture.
- **`loginctl` cannot detect the lock.** `LockedHint` stayed `no` while hyprlock was
  demonstrably running. `pidof hyprlock` is the only reliable check.
- **`dispatch fullscreen` is a toggle, not a setter.** The same command clears and
  applies. Read `.fullscreen` first or it does the exact opposite of what was asked —
  invisibly, if nobody is looking at the screen.
- **Three independent window states**: floating, fullscreen, and tiled position. A window
  can be `floating=true fullscreen=2`; clearing one does nothing visible.
- **The dispatcher and the JSON disagree on numbering.** JSON `.fullscreen`: 0 none,
  1 maximized, 2 fullscreen. `dispatch fullscreen` arg: 0 true fullscreen, 1 maximize.
- **`-s 0.5` is too coarse to read terminal text** on a 1920px screen. Fine for layout.
  Crop and use `-q 80` when content matters.
- **No auto-suspend configured** — hypridle has no sleep listener and logind is on
  defaults, so the machine stays reachable indefinitely. It does lock at ~60 min idle
  (screensaver at 30).
- **hypridle runs from `exec-once = uwsm-app -- hypridle`**, not the systemd user unit.
  `systemctl --user is-active hypridle` reads `inactive` while pid 1341 is running, so
  `systemctl --user stop hypridle` does nothing.
- **Screencopy is not blocked during a session lock**, so anything with Wayland socket
  access can photograph the lock screen. Harmless in itself; the lock is not a capture
  boundary here.

## Build order

1. `claude()` tmux wrapper — everything remote sits on `send-keys`
2. Remote Control experiment — may shrink or eliminate what follows
3. SSH + tmux + Tailscale — the escape hatch, and what makes unlock experiments safe
4. Deno server + Svelte PWA
5. `ydotool` unlock
6. wayvnc stream, only if genuinely missed

Live with each step before building the next. The likely failure mode is not that it
does not work — it is that it works and is annoying enough to abandon.
