# deskpilot

A phone-facing remote for this desktop: prompt terminal sessions, arrange windows,
look at what is on screen, unlock the machine. Runs entirely on the user's own hardware.

Read `docs/decisions.md` before changing anything structural. It records what was tried,
what was rejected, and why — most of it learned the hard way.

## Two constraints that shape everything

1. **Agent-agnostic.** A session is a tmux session; whatever runs inside it is not this
   project's business. `send-keys` types into a terminal and does not care what reads it.
   Nothing above the tmux layer may assume Claude Code. The one exception is
   `skills/desk-control/SKILL.md`, which is explicitly disposable.
2. **No mobile app.** The phone side is a browser page. Remote Control and the Claude
   mobile app were evaluated and rejected — see decisions.md.

## Layout

```
scripts/       portable shell. The real implementation of everything desktop-side.
server/        Deno HTTP wrapper over scripts/ and tmux. Thin by design.
web/           Svelte + Vite UI. `npm run build` before it will serve.
shell/         installers, all idempotent and safe to re-run
skills/        thin Claude Code pointer at scripts/ — the only Claude-specific part
docs/          decisions.md is the important one
```

The server calls the same scripts an agent would. That is deliberate: **window
operations spend no tokens** and work with no model in the loop. An agent is needed only
for interpretation — "does this look right".

## Traps

Every one of these was a real bug here, and every one failed **silently**:

- **`grim -g` crops the composited output, not a window.** A window on a hidden
  workspace returns whatever is at those coordinates on the visible one. Use
  `desk.sh shot-window`, never raw `grim -g`.
- **`grim` succeeds on a locked screen** and returns the password prompt as a valid
  image. Ask `desk.sh locked`, which answers `locked` / `unlocked` / `unknown` and which
  both guards fail closed against. Never probe for a locker process: `pidof hyprlock` was
  that check until Omarchy replaced hyprlock, after which it answered "unlocked" forever
  and silently disarmed the guard. `loginctl` cannot detect it either — `LockedHint`
  stays `no`.
- **`hyprctl dispatch fullscreen` is a toggle, not a setter.** Read `.fullscreen` first.
  Floating, fullscreen and tiled are three independent states.
- **tmux runs as a child of the systemd unit**, so `KillMode` must stay `process` or
  every restart destroys all sessions.
- **`detach-on-destroy` is off on some systems**, so killing a session hands its clients
  to another session instead of closing them. Set it on the target before killing.
- **Flex items default to `min-width: auto`** and will not shrink below content, which
  inflates panes past the viewport. Every flex container here needs `min-width: 0`.
- **API responses must be `no-store`** or the browser caches a stale session list.
- **Anything gated on page visibility is untestable in a headless browser**, which
  reports `document.hidden: true`. Initial loads must never be gated on it.
- **Assigning `term.options.fontSize` resizes the glyphs but not the cell grid.** The
  CSS font-size changes and the column count does not, so characters are drawn wider
  than the cells that hold them and the right edge is clipped — worse the larger the
  font. Rebuild the `Terminal` instead.
- **FitAddon always subtracts a scrollbar**, even one that is never shown, and divides
  by a cached cell width. Both are wrong here. Derive the cell width from the rendered
  `.xterm-screen` and compute columns from it.
- **Measuring the terminal's own element proves nothing** — its root is `width: 100%`
  and therefore always equals its host, fit or not. `.xterm-screen` is the real grid.
- **`child.kill()` on a `script` wrapper neither forwards the signal to the process in
  its pty nor reaps anything.** Await `child.status` (escalating to SIGKILL) or every
  connection leaves a `script` and a `tmux: client` behind.
- **A WebSocket peer that vanishes without a close frame never fires `onclose`**, so its
  PTY and tmux client stay open forever. `Deno.upgradeWebSocket` needs `idleTimeout`.
- **Every mounted terminal costs a PTY and a tmux client.** The rail renders all ten
  panes; only the active one may hold a `Term`.
- **Headless Chromium will not go below ~500px wide**, whatever `--window-size` says,
  and Hyprland tiles the window anyway. The same-origin iframe below is the only
  measurement that reflects a phone.

## Verifying UI changes

Do not judge phone layout by eye or by desktop screenshots. Both lied repeatedly here.

Render the app in a **same-origin iframe** at the target width and measure inside it —
an iframe gets a true viewport, so flex, media queries and `100dvh` behave as on device.
Then assert:

- every `.rail > section` is exactly the viewport width
- `header.scrollWidth <= header.clientWidth`
- no element's box escapes its own pane's box
- every interactive element is at least 44px tall

Check 320 / 360 / 390 / 430 at minimum.

## Before you finish

Run `shell/check.sh`. It verifies every environment assumption and is the fastest way to
find out that something silent has broken.
