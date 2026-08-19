# Decisions

Why the design is what it is, including options rejected. Dated 2026-08-10.

## Hard constraints

Two requirements set 2026-08-10 that override earlier reasoning:

1. **No mobile app.** The phone side is a browser page. Remote Control and the Claude
   app are out of the daily flow entirely.
2. **No agent lock-in.** Claude Code must be a swappable component, not the foundation.

Both are satisfied by putting `tmux send-keys` at the boundary. It types into a
terminal and does not care what is running there — swap Claude Code for Aider, Codex,
opencode, or a bare shell and nothing above the tmux layer changes.

The layers split accordingly:

| Portable | Disposable |
|---|---|
| `scripts/` — shell over hyprctl/grim/tmux | `skills/desk-control/SKILL.md` |
| `server/` — Deno | `~/.claude/settings.json` permissions |
| `web/` — PWA | |
| the tmux layer | |

The one real coupling that existed — finding sessions by the `✳` marker Claude Code puts
in its terminal title — has been removed. Sessions now resolve through
**tmux client pid → walk parent pids → matching Hyprland window → its workspace**, which
mentions no agent at all. Verified: tmux session `Work` → ws6.

A consequence worth noting: `/desk/*` endpoints mean the PWA can move and tile windows
**with no LLM in the loop**. An agent is only needed for *interpretation* — "does this
UI look right." That is the natural seam between the two halves.

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

Addresses are resolved dynamically, not bound statically, so rearranging windows does
not break routing. Muscle memory will briefly be wrong after a move; accepted.

The resolution originally went workspace → window with a `✳` title → tmux session, which
silently coupled the whole design to Claude Code's terminal-title marker. It now runs the
other way and mentions no agent: **tmux client pid → parent pids → matching Hyprland
window → its workspace.** See the hard constraints above.

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

**Tried Remote Control 2026-08-10. It works, and it is not the daily driver.**

The trial answered the open questions and changed the plan.

What it does well: the session appeared on the phone immediately, runs on this machine
so the full local environment — filesystem, MCP servers, and the `desk-control` skill —
stays available, and **server mode** (`claude remote-control`, the subcommand, not the
`--remote-control` flag) runs up to 32 concurrent named sessions from one process,
creating them on demand, optionally each in its own git worktree. That is most of the
multi-session addressing this project was going to build. It also settles the question
of whether you can *initiate* work from the phone: in server mode, yes. SSH therefore
stays a genuine escape hatch rather than becoming the main event.

What killed it as the daily driver: **driving a desktop through a chat transcript is
clunky.** The interaction is fine for steering code work and poor for "move that window,
show me what the app looks like." The interface is also fixed — Remote Control means the
Claude app or claude.ai, with no room for the workspace-swipe UI.

Confounder worth recording honestly: the first trial was made much worse by having **no
permission rules configured at all**, so every Bash call prompted. That is a config gap,
not a property of Remote Control, and it is now fixed (see below). The clunkiness
judgement survives the fix; the volume of prompts does not.

**Final call: Remote Control is out.** Beyond the clunkiness, the user does not want to
interact with the Claude mobile app at all, which removes it as a daily path regardless
of how well it works. It also surfaced the structural mismatch below. SSH is the escape
hatch; the PWA is the daily driver.

**The addressing mismatch, which is the cleanest argument for the PWA.** A message sent
from the phone landed in the test session rather than the intended one. Not a bug —
Remote Control addresses by *session name*, and only sessions that explicitly opted in.
The four real working sessions (ws1, ws4, ws7, ws10) were plain `claude` processes with
no bridge, so the phone could not see or reach them; the test session was the only
possible destination. Remote Control has no concept of a workspace, a window, or where
something is on screen. "The session on screen 4" is not expressible in it. That is
structural, not a matter of taste, and it is exactly what the workspace-swipe model
fixes.

**They compose, which was not obvious.** Remote Control and the PWA are two doors into
the same local session, not competing layers. The docs state you can send messages from
terminal, browser, and phone interchangeably — and `tmux send-keys` *is* typing in the
terminal. So a PWA driving the tmux session works fine on a session that also has Remote
Control connected. Swipe UI for prompting, Claude's app for push.

Also noted from the docs: they explicitly recommend tmux for keeping sessions alive
across disconnects, so the wrapper is the documented approach rather than a workaround.
And a separate feature, **Dispatch**, messages a task from the mobile app and spawns a
session — closer to fire-and-forget delegation, worth a look if the PWA stalls.

## Permissions

An agent driving a desktop from a phone cannot prompt for every call, and blanket
`bypassPermissions` on a machine holding SSH keys and browser sessions is the wrong
answer. The rules live in `docs/permissions.json`, applied by
`shell/install-permissions.sh`:

- **allow** — read-only queries and reversible window moves. Fire constantly, cannot
  lose work.
- **ask** — `closewindow` (loses unsaved work), `killactive`, `hyprctl keyword`,
  `tmux kill-*`, and **`tmux send-keys`**. That last one is the mechanism the whole
  remote design rests on, and it can type arbitrary text into any open terminal. It
  stays gated so that opening it is a deliberate decision when the PWA lands.
- **deny** — `hyprctl dispatch exit`, which kills the Hyprland session outright.

Claude Code **cannot apply this itself** — the auto mode classifier blocks an agent from
widening its own permissions. Correct behaviour, and the reason there is an installer
script rather than an edit.

Deliberately not changed: `defaultMode`. Sessions doing real file edits will still
prompt from a phone. Loosening that before feeling where the friction actually lands
is how you end up with a permission posture you did not choose.

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

1. ~~`claude()` tmux wrapper~~ — done, installed 2026-08-10
2. ~~Remote Control experiment~~ — done; result above, PWA stays on the table
3. ~~Permission rules~~ — done
4. SSH + tmux + Tailscale — the escape hatch, and what makes unlock experiments safe
5. Deno server + Svelte PWA — now the daily driver rather than a maybe
6. `ydotool` unlock
7. wayvnc stream, only if genuinely missed

Live with each step before building the next. The likely failure mode is not that it
does not work — it is that it works and is annoying enough to abandon.

## Screenshot cost, measured

Intuition about image size is wrong here, so it is written down.

**Content dominates, not dimensions.** The same 941x1030 terminal window measured 38 KB
when mostly empty and 210 KB when full of syntax-coloured text.

**Scale is a stronger lever than quality**, and that is unhelpful: 210 KB drops to 80 KB
at `-s 0.6` but only to 132 KB at `-q 45`. Scaling is precisely what destroys the
legibility a crop existed to preserve.

**So the conclusion is not a tuning parameter, it is a routing rule: never screenshot a
terminal.** `tmux capture-pane` returns the same information as ~2 KB of reflowable,
searchable, scrollable text. Screenshots are for GUI windows where pixels are the only
representation — a browser, a design tool, the app being built.

Defaults settled on: crop to the window, `-q 70`, and scale down only past 1200px wide
(`DESKPILOT_MAX_WIDTH`, `DESKPILOT_QUALITY`). A full-width Chromium window lands at
132 KB.

This is the third time the tier model has been vindicated by something unrelated to why
it was chosen — text survives the lock screen, text needs no LLM, and now text is
100x smaller than the pixels showing the same thing.

## grim captures the screen, not the window

Found by using it: clicking "look" on the same window returned different windows.

`grim -g "X,Y WxH"` crops the **composited output**. Hyprland only composites the visible
workspace, so a window on a hidden workspace has no pixels anywhere — the crop returns
whatever is at those coordinates on whatever workspace happens to be showing. Asking for
Chromium on ws2 while ws8 was visible returned a terminal from ws8, with no error.

Nasty because it fails silently and plausibly: you get a real screenshot of a real
window, just the wrong one. An agent describing it would confidently narrate the wrong
screen.

Fix: `shot-window` reads the target's workspace, switches, captures, and switches back —
restoring the view even if grim fails, so a bad capture never strands the desktop
somewhere the user did not choose.

Remaining limit, accepted: a floating window occluded by another on the *same* workspace
still captures the occluder. Fixing that means reordering the user's windows to take a
screenshot, which is a worse trade than the occasional wrong capture of a buried
floating window.

## The workspace model needs an index

Swiping workspaces 1–10 is a good way to reach a session that has a window. It cannot
represent one that does not — and a session with no window is not an edge case, it is
the normal result of closing a terminal, which detaches rather than kills.

The first attempt bolted detached sessions onto empty panes. That was worse than
nothing: the same session appeared on every empty screen, and was invisible from every
screen that had one. A session whose window closed effectively vanished.

Rail position 0 is now a **sessions index** listing everything — placed sessions with
their workspace badge (tap to jump), detached ones with a screen picker, open and kill.
The header status line carries a detached count, since that is precisely the state that
hides. Panes keep a one-line pointer to the index rather than duplicating the list.

The general lesson: a spatial UI needs a non-spatial index for the things that have no
place. Spatial addressing is the fast path, not the only path.

## Layout: min-width:auto, and how to actually test it

The panes rendered at 600px inside a 375px rail. Cause: **flex items default to
`min-width: auto`**, which refuses to shrink below content size, so each pane inflated
to fit its widest window row and dragged the rail out of shape. `flex: 0 0 100%` does
not protect against this — the basis is 100%, but the minimum still wins.

Fix is mechanical and applies to every flex container in the app: `min-width: 0` on the
pane and on each flex row, `flex: none` on things that must not shrink (badges, buttons,
selects, the reload control), and exactly one flexible child per row that truncates.

**The testing lesson matters more than the fix.** I claimed a layout was "verified in a
narrow viewport" when the browser window was 941px — `resize_window` had silently not
taken effect and I never checked the screenshot dimensions against what I asked for.

What works: render the app in a **same-origin iframe** of the target width and measure
inside it. An iframe gets a true viewport, so flex, media queries and `100dvh` all behave
as they would on the device. Then assert three things per width, rather than eyeballing:

- every `.rail > section` is exactly the viewport width
- `header.scrollWidth <= header.clientWidth`
- no element's box escapes its own pane's box

Verified at 320 / 360 / 390 / 430. Note that a child of an `overflow:hidden` ellipsis
container will look like it escapes — it is clipped when painted, so compare against the
clipping ancestor, not the viewport, or it reports false positives.

## "Unkillable" sessions

Kill appeared to do nothing: the session list stayed populated and terminals stayed open.

This box has `detach-on-destroy off` globally. With that setting, killing a tmux session
does **not** close its attached clients — tmux hands each one to another session. The
terminal survives, silently displaying unrelated work, and something always looks alive.
Observed directly: a window still running `tmux attach -t placetest` an hour after
`placetest` was killed, with tmux reporting that client attached to `ws1`.

Two compounding effects made it worse than a stuck kill. Clients hopping between sessions
made sessions look like they teleported between workspaces, since a session's workspace is
derived from where its client's terminal lives. And the first fix set the option only on
sessions the server created, which did nothing for the ones that already existed — the
exact ones being killed.

Correct fix: set `detach-on-destroy on` **on the target, immediately before killing it**.
That covers every session regardless of origin, and leaves the user's global tmux config
untouched.

## Terminal-first, and the width problem it exposes

A session is a tmux session; what runs inside is arbitrary. That is what agent-agnosticism
means in practice, and it means a pane is a *terminal* view, not a Claude view. Typing
into a plain shell already worked — every session created from the phone was `bash`.

The gap was the create flow, which hardcoded `bash` in `$HOME`, so the one thing this
project exists for — start an agent on a project from away — was impossible. Creating now
takes a directory (one level under `$DESKPILOT_DIRS`, default `~/Projects`), a command
(shell / claude / claude --continue / custom), and a name that follows the directory
basename until edited, matching the shell wrapper's rule.

**Measured caveat: a TUI does not fit a phone.** Claude Code in a session attached to a
1896px terminal renders at 130 columns. A phone at 390px fits roughly 48. `tmux
window-size` is `latest`, so the session takes the size of the most recent client — the
desktop terminal — and the capture is 130 columns wide regardless of what is reading it.
A shell transcript reflows fine; box-drawing does not.

Options, none taken yet because it should be lived with first:

- `window-size smallest` — the desktop terminal shrinks to the phone's size, which
  ruins the desk experience to improve the phone one.
- `window-size manual` at a fixed narrow width — same trade, made permanent.
- A reader that strips box-drawing and reflows for known commands — most work, keeps both
  experiences intact, and is speculative until the raw version proves unusable.
- Horizontal scroll in the transcript instead of wrapping — cheap, but nests a horizontal
  scroll inside the horizontally-snapping rail.

The honest position: a phone is a good remote for a shell and a poor window onto a TUI.
That is a property of TUIs, not of this design.

## Network transport: Tailscale, and what would change it

Revisited repeatedly, so the reasoning is here rather than re-derived.

**The tension nobody named for a while:** a stated constraint was "no mobile app", and
Tailscale is a mobile app. A different one — passive, set-and-forget via Android's
always-on VPN — but an app that must be installed and running. That is a real cost, not
a rounding error.

**What decided it is specific to this service: it carries the desktop unlock password.**

- **Cloudflare Tunnel** terminates TLS. Traffic is encrypted browser→Cloudflare and
  Cloudflare→here, but plaintext *inside* Cloudflare. The tunnel operator can in
  principle see the password. Tailscale cannot: WireGuard is end-to-end and the
  coordination server only brokers keys. Secondary risks: an over-permissive Access
  policy fails silently, and the hostname is public in DNS and CT logs whether or not
  anyone gets in.
- **A self-hosted relay** — desktop polls outbound, phone posts, nothing listens — is
  architecturally the best fit for the constraints. But without end-to-end encryption
  *through* the relay it has Cloudflare's problem with a worse security team: yours.
  With E2E it is strictly better, and it means owning key derivation, nonce handling and
  replay protection on a channel that unlocks a computer. Very doable, very easy to get
  subtly wrong.
- **Self-hosted WireGuard** keeps the app and adds DDNS and a forwarded port.

**Decision: Tailscale, 2026-08-11.** Its cost is one app. Cloudflare's is an intermediary
that can read the password. A relay's is becoming that intermediary. For an endpoint that
runs arbitrary commands and unlocks the machine, the app is the cheapest of the three.

**What would flip it:** sharing this with other people. "Install Tailscale first" is a real
adoption barrier, and at that point the relay model is right — reaching for an existing
E2E transport rather than writing the crypto.

## Touch targets, measured

Audited the interface at 390x844 rather than by eye. Every one of 60 interactive
elements was under the 44px minimum both iOS and Android recommend — 28 of them at
26px, including the key row, which is the most-tapped control in the app, and `kill`,
which is destructive and sat 7px from the row you tap to jump to a session.

Fixed by making `.sm` mean smaller *text* rather than a smaller thing to hit: a 44px
floor on every button, input and select. All 72 controls now measure exactly 44px.
Destructive actions are red-bordered and separated from benign neighbours. The key row
became a 4x2 grid rather than a wrapping flex row, so each key is ~85px wide.

Contrast was already fine and did not need touching: dim text 5.47:1, transcript
15.41:1, both above the 4.5:1 AA threshold.

The general lesson matches the layout one: at phone size, judge by measurement. The
interface looked reasonable in every screenshot taken before this audit.

## Service worker: needed after all, but caching still refused

I originally skipped the service worker, reasoning that this is a live view of a machine
and caching it offline would show sessions that no longer exist. That reasoning was
right. The conclusion was wrong, because **Chrome will not fire `beforeinstallprompt`
without a service worker that has a fetch handler** — so "no service worker" silently
meant "not installable", and no amount of manifest work would have fixed it.

Resolved by separating the two things I had conflated. `public/sw.js` has a fetch
handler and caches nothing: it handles navigations by going straight to the network and
lets everything else fall through untouched, which also avoids interfering with range
requests and image streaming.

Checked against the documented criteria rather than assumed — this had already cost a
long detour through TLS, DNS and firewalls looking for a cause that was never there.

Sources: [Chrome installability criteria](https://developer.chrome.com/blog/update-install-criteria),
[web.dev install criteria](https://web.dev/articles/install-criteria)

## Theme: the desktop's own palette

Rather than invent a look, the app takes the palette from the Omarchy theme this machine
runs — "Cyberpunk Cyan" — so it reads as part of the desktop rather than a visitor.

Roles were matched to how the theme already uses the colours, not just the hex values
copied: `#00ffff` is what *active* looks like here (it is `col.active_border` and the
hyprlock ring), and `#ff2a6d` is what *failure* looks like (hyprlock's `fail_color`). So
cyan is the accent and pink is the error colour, and both mean the same thing in the app
as they do everywhere else on screen.

Neon is used as a highlight, not a texture: a glow on the wordmark, the active rail dot,
the workspace badge, the working pulse, focus rings, and the primary action. Nothing
else glows, because if everything does it stops signalling anything.

Light mode was dropped. A cyberpunk palette has no coherent light variant and this
desktop is dark.

Contrast measured rather than trusted: body 17.8:1, dim 5.7:1, transcript on card
16.5:1. That check caught a real failure — the placeholder was a transparent tint at
**1.14:1**, effectively invisible, which silently killed the rotating hint feature that
lives in it. Now 5.3:1.

## Reading a TUI on a phone: what actually helped

Two changes did more than any amount of styling.

**Collapse full-width rules.** A TUI draws separators the width of the terminal — 130
columns here. A phone fits about 48, so each rule wraps to three display lines of solid
box-drawing. Measured on a real Claude Code capture: 2 of 8 lines were pure rules, so
six of the visible lines were separator. Collapsing any line that is *entirely* rule
characters to 12 characters took the longest line from 130 to 51. Lines containing text
are left untouched, including box edges around content, because stripping those risks
mangling real output.

**Allow landscape.** The manifest had `orientation: portrait`, which locks an installed
PWA. Removing it roughly doubles the usable columns:

| | columns | visible lines |
|---|---|---|
| portrait 390x844 | 51 | 36 |
| landscape 844x390 | 114 | 12 |

Neither is better in general — landscape stops wrapping and preserves alignment, portrait
shows more history. Both are now available, which is the point. A `max-height: 480px`
media query slims the chrome in landscape, where every row costs a visible line.

The earlier conclusion that this needed a "reader mode" parser was wrong. The problem was
never the prose, which was always fine — it was the separators, and one regex fixed it.

## The one thing worth caching

The service worker exists because Chrome will not offer to install without one, and it
deliberately caches none of the app — a cached shell would list sessions that no longer
exist and a lock state from an hour ago.

It caches exactly one thing: a static error page. When the tailnet is down the app cannot
load at all, so the browser shows its own "site can't be reached", which says nothing
about the cause. The in-app offline banner cannot help here either — it only exists once
the app has loaded, which is precisely what has failed.

`offline.html` names the likely culprit instead, in order of probability, and retries by
itself when connectivity returns so it does not become something to sit and stare at. It
contains no live data, so it cannot go stale — which is what makes it the exception to
the no-caching rule rather than a hole in it.

Prompted by a real incident: the phone dropped off the tailnet after Android stopped
Tailscale in the background, and the failure was indistinguishable from the app being
broken.

## Wrapping is a choice, not a setting

Prose reflows fine at any width. Aligned output does not — code, diffs, `ls`, tables all
carry meaning in their columns, and re-wrapping at 51 columns destroys it. There is no
single correct answer, so both are one tap apart: **wrap** reflows, **wide** keeps the
columns and scrolls sideways. Text size cycles 10–14px alongside it. Both persist, since
they are preferences about reading rather than per-session state.

The rotation hack is gone. It turned the whole app 90° so it read upright when the phone
was held sideways, bypassing both Android auto-rotate and the manifest orientation baked
into an installed PWA. It worked and was unusable: the soft keyboard still came from the
physical bottom — the side of the rotated content — and scroll gestures no longer matched
the direction things moved. Enabling auto-rotate is one system toggle and gives real
landscape with correct keyboard and gestures.

## ydotool absolute coordinates are not screen coordinates

Asking for 200,200 put the cursor at 400,400, and anything past half-screen clamped to
the edge — a 2x scale from how the virtual device advertises its axes. Agent-driven
clicking would have silently missed every target.

`desk.sh click` now moves, reads the real position back from `hyprctl cursorpos`, and
corrects. The correction must be **multiplicative**: subtracting the difference
oscillates (ask 200, land 400, ask 0, land 0, ask 200…). Scaling by wanted/landed
converges in one step, and it is measured each time rather than hardcoded, so it does not
depend on this display.

Verified landing within a pixel at 200,200 / 960,540 / 1500,800.

## A real terminal, not a scrape

Every wrapping and alignment problem came from one decision: scraping a 130-column pane
and re-flowing it to 51. Mobile SSH clients do not have these problems because they never
create them — they allocate a PTY at the phone's size and the program lays out for it.

`/api/term` upgrades to a WebSocket and attaches tmux through a PTY sized to the client.
Deno has no PTY, so `script(1)` provides one and `stty` sets its size before tmux
attaches. The browser side is xterm.js, themed to match. Measured: the pane became 47x40,
Claude Code drew its banner, input box and status line to fit, and ANSI colour arrived
intact.

**The sizing conflict is not real in practice.** tmux cannot give two clients independent
sizes — grouped sessions share the window object, confirmed by both reporting 130x40. But
`window-size` is `latest`, so the phone attaching shrinks the shared window and the desk
client resizes it back on return. If you are using the phone you are not looking at the
monitor.

Kept behind a per-pane toggle rather than replacing the text view, because the trade is
genuine: a real terminal is better for anything structured, and re-flowed text is
arguably nicer for plain prose, which does not care about columns and gets to use the
full screen width.

Cost: the bundle went from 68 KB to 406 KB (112 KB gzipped).

Two things this surfaced. The scoped `--allow-run` blocked spawning `script`, which is
the allowlist working as intended — adding a subprocess has to be deliberate. And a
systemd service inherits no `TERM`, so tmux refused to attach with "terminal does not
support clear" until it was set explicitly.

## The terminal's right edge, and why the font control made it worse

Reported from the phone: at 10px the whole Claude Code session fits except the trailing
`s` of "for agents"; larger font sizes clip slightly more.

Measured, at a true 390px viewport with a phone pixel ratio, the cause was not a stray
pixel of padding. `.xterm-screen` was **338–344px wide with 47 columns at every font
size from 10px to 14px** — a cell width frozen at ~7.28px. The CSS font-size was
changing; the grid it was drawn into was not. So at 14px the glyphs were wider than the
cells holding them and ran past the right edge, and at 10px they under-filled. "Larger
cuts off more" was the symptom of exactly that.

Assigning `term.options.fontSize` did not make xterm remeasure the character cell. The
fix is to rebuild the `Terminal` when the size changes, which costs nothing extra: any
geometry change already forces a reconnect, because the PTY's size is fixed when
`script` spawns it and there is nothing to signal afterwards. The rebuild is debounced
250ms, because the control cycles 10→14 one click at a time and each rebuild costs a PTY
and a tmux client on the far end.

The measurement also has to be honest about *what* to measure. The terminal's own root
element is `width: 100%`, so it always equals its host whether or not the grid inside it
fits — a check against it can never fail. Only `.xterm-screen` is the real grid.

Having a true cell width made a second problem visible and cheap to fix. FitAddon
divides by a cached cell width *and* always subtracts a scrollbar, including one that is
never shown, which was costing 15–21px — two to three columns out of forty. Columns are
now derived from the measured grid: `floor(hostWidth / cellWidth)`. Overflow across
320/360/390/430 went from −15…−21px to 0…−6px, never positive, gaining two columns at
every size. The xterm scrollbar is hidden in CSS to match, which is safe because tmux
owns scrollback and a TUI on the alternate screen has none of its own.

The terminal is now the default view. The text view stays as a fallback: it is the only
one that survives a locked screen, needs no PTY, and is ~100× smaller on a bad
connection.

### Two process bugs this surfaced

`child.kill("SIGTERM")` on the `script` wrapper neither reached the tmux client in its
pty nor reaped anything, because `child.status` was never awaited. Every terminal
connection leaked a `script` and a `tmux: client`. Shutdown now escalates to SIGKILL
after 2s and awaits the status. Verified: cycling five font sizes leaves exactly one
process — the live one.

Separately, a service restart with eight of those leftovers in the cgroup coincided with
the tmux server dying and taking its sessions with it, despite `KillMode=process`. The
mechanism was not conclusively identified from the journal. Until it is, treat
`systemctl --user restart deskpilot` as unsafe while sessions are live, and do UI
experiments against an isolated socket (`tmux -L dptest`).

### Measuring phone layout, concretely

Headless Chromium refuses to go below ~500px wide whatever `--window-size` says, and
Hyprland tiles the window regardless. Driving it over CDP and measuring inside a
same-origin iframe sized to the target is what gives a true viewport —
`Emulation.setDeviceMetricsOverride` supplies the pixel ratio. That is the only setup in
which any of the numbers above were reproducible.

## Removing the text view

The terminal won. The text view is gone, and with it the mode toggle, the wrap
toggle, the `↓ latest` button and the capture polling behind them.

What that costs, stated plainly: the text view was the only one that rendered on a
locked screen, needed no PTY, and was ~100× smaller on a bad connection. Those were
real, and they are given up. `/api/capture` stays on the server — it is what an agent
uses, and it is still the cheapest way to read a session — but nothing in the UI calls
it any more.

What it buys is more than a simpler screen. **Busy detection stopped being a poll.**
Knowing whether output is moving used to mean fetching a 200-line capture every three
seconds and diffing it against the last one. A PTY delivers bytes as they happen, so
"something arrived on the socket" is the same signal, exactly as agent-agnostic — bytes
are bytes — with no request, no interval and no diff. Verified end to end: idle border
at 6s per revolution, a keystroke flips it to 2.2s with the pulse lit, and it decays
back after six seconds.

Two details that matter in that signal. Attaching repaints the whole screen, which is
not news, so activity is ignored for 1200ms after connecting. And it is throttled to one
update per 500ms, because a spinner should not schedule sixty state changes a second.

### One terminal, not ten

The rail renders all ten panes so swiping is instant. Each terminal costs a PTY and a
tmux client, so mounting them all would open ten of each to render nine screens nobody
is looking at. Only the active pane holds a terminal; the others show a bordered
placeholder so a swipe does not reveal a collapsed layout mid-flight. Swiping back
re-attaches and tmux repaints immediately.

### Two sizes, not five

`10px` through `14px` in single steps was a range where only the ends were useful: "as
much of the session as fits" against "readable without squinting". They are now
**normal** (10px, ~59 columns at 390px) and **large** (14px, ~42). The old `dp_font`
value is read once to pick a sensible default for anyone who had already chosen.

### The sweep, on the terminal

The rotating cyan-to-magenta border moved from the old transcript element onto the
terminal's frame. `--card` is the same value xterm paints its own background with, so
the padding-box fill meets the glyphs with no seam. This is also the first time the
animation was actually *verified* rather than assumed: sampling `--angle` gave 119.976°
→ 179.982° across one second — 60°/s, exactly the six-second quiet revolution.

### Dead peers

A connection that ends without a close frame — a discarded tab, a phone that loses
signal — used to pin its PTY and tmux client open indefinitely; one was found still
attached eight minutes after its client was gone. `Deno.upgradeWebSocket` now takes
`idleTimeout: 60`, so the runtime pings and closes when no pong comes back, which lands
in `onclose` and reaps the child. Browsers answer pings themselves, so a quiet-but-live
terminal is unaffected — verified by leaving one idle for 85 seconds, well past the
timeout, with the connection still live and the PTY still held.

## Hermes as a second agent: tried, then removed

Added then reverted 2026-08-18/19. Hermes Code was wired in the same way Claude is —
a `hermes chat --cli` launch preset, a `hermes()` tmux wrapper for desk launches, and a
`shell/hermes-hook.sh` notification adapter on Hermes' shell hooks. The notification path
worked (blocked/done POSTs to `/api/event`, verified HTTP 200). **It was all removed
because the remote *rendering* is unusable, and that turned out not to be fixable from
deskpilot's side.** Recorded here so it is not re-attempted from scratch.

**What breaks, and why it is not a geometry bug.** Hermes on a phone renders as garbled,
wrapped, few-lines-tall mush. Everything obvious was tried and measured against the raw
PTY bytes the phone actually receives:

- **Width.** A `Ctrl-L` repaint nudge on attach fixed the width case — new output laid out
  at the phone's columns.
- **Height.** `Term.svelte` corrected *columns* off the rendered `.xterm-screen` grid but
  trusted FitAddon for *rows*, which locked in ~3 rows on a phone. Correcting rows the same
  way (and refitting after a paint frame, not synchronously in `boot`) fixed the row count.
- **Neither was enough.** Even a session **born narrow with a single phone-sized client and
  no desktop terminal attached** — the cleanest possible case — still rendered the banner
  box, status bar and prose as run-together, mid-word-broken mush. Hermes draws with
  cursor-addressed screen redraws (live `⏳` status, repainting status bars, boxed banner),
  not a linear append-only transcript, and those redraws do not survive this remote pipe.

- **Mode is not the lever.** `--cli` and the full TUI measured identically (both 266-wide off
  a 266 desktop). Hermes' `--cli` is still a redrawing TUI, not a shell-like stream.

- **The real root cause of the desk↔phone flip.** `window-size latest` means a tmux window
  shared by two live clients (the desk terminal *and* the phone) takes whichever was active
  last. Scrolling on the desktop made the desk the size authority (readable there, wide on
  the phone); scrolling on the phone flipped it back — a permanent tug-of-war. Even removing
  the desk client (detached/phone-only sessions) only isolates the size; it does not fix the
  redraw mush above.

**The standing conclusion, now with evidence behind it:** *a phone is a good remote for a
shell and a poor window onto a TUI* (see "Terminal-first"). A shell reflows; a redrawing
agent does not. Claude survives only because it repaints the whole alternate screen on
resize — it degrades more gracefully, it is not truly clean either. Making Hermes render
cleanly would mean deskpilot reconstructing terminal screen state itself, which is out of
scope. So Hermes stays a desk-only tool, reachable over SSH, not through the PWA.

What was kept from the same work: the **per-screen session selector** — the index now
routes to the specific session tapped, not just its workspace, and the pane reconnects the
terminal to it — so two sessions sharing one screen are both reachable. That is agent-
agnostic and unrelated to Hermes; it stays.
