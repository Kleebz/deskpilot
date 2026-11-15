# deskpilot

A phone-facing remote for the machine you left running.

Coding agents work for minutes at a time and then stop to ask a question. If you are not
at the desk when that happens, the work is not slow — it is stopped. deskpilot puts those
sessions on your phone: see which one is blocked and on what, answer it, start new work,
copy a command or a path out of a session into the phone's clipboard, paste one back in,
and — on Hyprland — look at the screen and move windows.

It runs entirely on your own hardware. There is no service in the middle, no account, and
nothing leaves your machine except the notifications you asked for.

<p align="center">
  <img src="docs/images/deskpilot-mobile.jpg" width="390" alt="Deskpilot mobile app showing a live Codex terminal session">
</p>

From the phone you can:

- read and control live tmux terminals;
- see which agents are working, blocked, or done;
- move between several machines and sessions;
- start work, paste text, copy output, and answer safe permission prompts;
- review screenshots and renders published by a task, including work outside tmux; and
- inspect screens and move windows when the desktop supports it.

## Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation options](#installation-options)
- [Starting desktop sessions](#starting-desktop-sessions)
- [Connecting a phone](#connecting-a-phone)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Security](#security)
- [Development and releases](#development-and-releases)

## Quick start

Four steps on the desktop, then scan a QR with your phone. Each is expanded below.

`deskpilot` is a command, and step 1 is what puts it on your PATH. **Running from a
source checkout instead?** Skip to [building from source](#building-from-source) —
`shell/setup.sh` replaces steps 1–2 and installs a `deskpilot` shim, after which steps
3–4 are word for word the same.

```bash
# 1 — install (verifies the published checksum first; read it, it installs as root)
curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/install.sh -o install.sh
less install.sh && sh install.sh

# 2 — start
deskpilot setup
systemctl --user daemon-reload && systemctl --user enable --now deskpilot

# 3 — give it an address your phone can reach. NOT optional.
tailscale up                       # opens a browser to sign in
tailscale serve --bg --yes 8790

# 4 — pair
deskpilot pair
```

Step 4 prints a QR and the complete pairing link. The link already contains the one-time
code; scan the QR or open the link, add the page to your home screen, and you are done —
it is a web app, so there is nothing to download.

**Step 3 is where installs go wrong.** deskpilot listens on loopback on purpose, so until
something fronts it there is no address for a phone to open at all. Two things people
miss: HTTPS certificates have to be switched on once for your tailnet at
[login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns), and **the phone
needs Tailscale too, signed in** — the address is a tailnet name, so a phone that is not
on the tailnet cannot resolve it and the scan lands on "can't be reached". If anything is
missing, `deskpilot pair` says so instead of printing a QR that leads nowhere.

Want an agent to do it? See [installing with an agent](#installing-with-an-agent).

## How it works

Deskpilot sends terminal text rather than streaming a remote desktop. A screen of terminal
output is roughly 2 KB of text where a screenshot of the same thing is often 130–210 KB.
It uses a cropped still only when the pixels themselves matter, and it sends no video.

A session is a tmux session, so Claude Code, Codex, Aider, and ordinary shells all work
through the same interface. tmux also keeps them alive when the browser disconnects or the
Deskpilot service restarts.

## Requirements

**tmux.** That is the whole hard requirement.

tmux 3.7 or newer also exposes bracketed-paste state for terminal reconnection.
With older versions, the mobile terminal restores that mode as off; sending
composed text still uses tmux's paste handling for the original program.

Everything desktop-shaped is optional and negotiated: the server reports what it can do
and the app hides the rest. A headless box serves sessions and terminals and honestly says
it has no windows — that path is tested on every commit, not assumed.

Read the table as "what each feature costs", not as a list of things to install. Only the
first row is required; a machine with none of the rest is a supported configuration that
`shell/check.sh` passes and `tests/headless.sh` exercises on every commit.

| For | You need | Required? |
|---|---|---|
| sessions, terminals, pairing, notifications | `tmux` | **yes — the only one** |
| window listing, moving, tiling | Hyprland **0.56.2+** | no |
| screenshots | `grim`, and a readable lock state | no |
| remote unlock and input | `ydotool` — **any Linux**, no compositor needed | no |

Note which row needs no compositor at all: unlock and input injection. `ydotool` writes to
`/dev/uinput`, which is the kernel — it is why this reaches a lock screen at all, since it
sits below the Wayland layer that refuses virtual keyboards. It works on GNOME, KDE, Sway
or a bare TTY, and needs no compositor support. Only windows and screenshots are
Hyprland's.

0.56.2 is a real floor, not a preference: every dispatcher moved to a Lua API in that
release, and on an older Hyprland the window commands fail without saying so. The server
detects it and reports the desk tier as unavailable rather than appearing to work.

The desk half is Hyprland-only today. It is one shell script, `scripts/desk.sh`, kept
readable and shipped beside the binary rather than compiled into it, precisely so that a
second compositor is somebody's afternoon rather than a rewrite.

**Running headless is a first-class case, not a degraded one.** `tests/headless.sh`
sandboxes a host with no compositor, no `hyprctl`, no `grim` and no Wayland socket, and
asserts that the server starts, lists tmux sessions with `workspace: null`, upgrades the
terminal WebSocket, pairs a device and reports `compositor: none` instead of erroring. CI
runs it on every commit and the release workflow refuses to ship a binary that fails it.

## Installation options

Every release ships a single binary — the server and the web UI in one file, so the
target needs neither Deno nor npm. Released builds are **x86_64 only**; on anything else
the installer stops and tells you to build from source, which works fine. There is also a
[source build](#building-from-source) if you would rather compile it yourself.

The quick way, which verifies the published checksum before installing anything:

```
curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/install.sh -o install.sh
less install.sh          # it installs as root; read it first
sh install.sh
```

Piping straight into `sh` works too. It is not suggested first on purpose: this is a tool
that runs commands on your machine, which makes it a poor candidate for executing code you
have not read.

By hand, if you prefer — download the tarball from
[releases](https://github.com/Kleebz/deskpilot/releases), check it against the published
`.sha256`, then:

```
tar xzf deskpilot-*-x86_64.tar.gz
sudo install -Dm755 deskpilot /usr/bin/deskpilot
sudo install -Dm755 scripts/*.sh -t /usr/share/deskpilot/scripts/
```

That path is part of the binary's subprocess allowlist, which is fixed at build time.
Runtime helpers installed elsewhere will be refused.

Then set it up and start it:

```
deskpilot setup
systemctl --user daemon-reload
systemctl --user enable --now deskpilot
```

`setup` makes a token, writes the user service, and prints those two commands. It does not
start a new persistent service implicitly; service state changes happen only through the
explicit `pause`, `resume`, `disable`, and `enable` commands described below.

Every release includes a generated `PKGBUILD` for Arch:

```
gh release download vX.Y.Z -p PKGBUILD
makepkg -si
```

### Installing with an agent

If you are already driving this machine through Claude Code or a similar agent, hand it
this and let it work:

> Install deskpilot on this machine by following
> `https://raw.githubusercontent.com/Kleebz/deskpilot/main/docs/agent-install.md`
> exactly. Stop and ask me at each step it marks HUMAN.

[`docs/agent-install.md`](docs/agent-install.md) is written for an agent rather than a
person: ordered steps, a verification command after each one, and what the specific
failure looks like when that check is the thing that catches it. Most of those checks
exist because the failure is otherwise silent — the install looks finished and the phone
cannot connect, with nothing anywhere saying why.

It also marks the three things an agent cannot do for you — `sudo`, the Tailscale browser
login and the admin-console setting it needs, and scanning the QR — so it stops and asks
rather than guessing or quietly skipping them.

## Building from source

You need `deno`, `node` and `npm` — none of which the released binary requires, which is
the point of shipping one.

```
git clone https://github.com/Kleebz/deskpilot
cd deskpilot
npm --prefix web install
```

From there, two paths.

**Run it from the checkout.** No binary; the service runs `deno` against the repo, so
edits take effect on a restart. This is the development setup and the one to use if you
intend to change anything:

```
shell/setup.sh
```

It builds the UI, installs a `deskpilot` shim at `~/.local/bin/deskpilot`, installs a user
service pointing at this directory, and runs the checks. The shim is why every command in
this README reads the same on a checkout as on a release install.
It asks before touching your shell profile or `~/.claude/settings.json`, and `--yes`,
`--no-shell` and `--no-claude` answer for it. Because the service points at the checkout,
**moving or deleting the directory breaks it** — re-run `shell/setup.sh` after a move.
If an older release command earlier in `PATH` shadows the source shim, setup reports the
exact two paths rather than claiming the source command is ready.

**Or build the binary yourself**, which is what the release does:

```
shell/build.sh
sudo install -Dm755 dist/deskpilot /usr/bin/deskpilot
sudo install -Dm755 dist/scripts/*.sh -t /usr/share/deskpilot/scripts/
deskpilot setup
```

`build.sh` takes the scripts path as its second argument and defaults to
`/usr/share/deskpilot/scripts`. That value is compiled into the binary's allowlist, so if
you install `desk.sh` somewhere else you have to build with that path — the two are not
independent.

Verified from a clean clone: `npm install`, build, typecheck, tests and the binary all
work with no prior state.

## Starting desktop sessions

To open a normal login shell in a new desktop window and make that shell
available on mobile:

```bash
deskpilot session
deskpilot session writing
```

This explicit launcher does not edit shell profiles, intercept the ordinary terminal
command, or replace the login shell. The new window runs the same login shell inside a
tmux session named `desk` (or the supplied name); collisions receive `-2`, `-3`, and so
on. Closing the window detaches it, while exiting the shell ends it. Installed desktops
also expose **Deskpilot Terminal** in the application launcher.

Deskpilot uses your preferred terminal through `xdg-terminal-exec` when available,
then `$TERMINAL`, then an installed emulator. This applies both to `deskpilot session`
and windows requested from the phone. To choose one explicitly, set
`DESKPILOT_TERMINAL=ghostty` (or another executable) in
`~/.config/deskpilot/config`; an environment override takes precedence. Existing
explicit choices are preserved. `auto` restores automatic selection.

Ghostty, Alacritty, Kitty, Foot, WezTerm, GNOME Terminal, Konsole and Xterm have
supported launch paths; `xdg-terminal-exec` also handles other terminals described by
their desktop entries. Custom executable wrappers retain the `-e CMD ARGS...` contract.
Ghostty windows launched by Deskpilot receive distinct application IDs, so their
sessions can be associated with the correct desktop window. For an existing terminal
process that owns several windows, Deskpilot leaves the workspace unassigned rather
than guessing; its tmux sessions are still accessible from the phone.

Codex CLI terminal pets are [unavailable inside tmux](https://learn.chatgpt.com/docs/pets#choose-a-terminal-pet).
If you use pets, keep ordinary terminal startup and use `deskpilot session` only
for work that needs mobile access. Pets will not be available in those sessions.

To make future shells in your usual terminal accessible automatically, opt in by
setting that terminal's startup command to `deskpilot run /path/to/your/shell -l`.
For example, a Bash user can set this in Ghostty's configuration:

```ini
command = deskpilot run /usr/bin/bash -l
```

This applies to new windows, tabs and splits; it does not adopt already running shells.
Use your own shell's executable path, and remove the setting to return to ordinary
shells. Deskpilot does not write this setting for you. Each new shell gets a separate
tmux session, even when opened in the same directory. Native tabs and splits remain
usable on the phone, but their desktop window association may be unavailable when
they share a terminal process. Closing the terminal detaches these shells; `exit` ends
them.

To start an agent on the desktop and control that same process from the phone later:

```bash
deskpilot run codex
deskpilot run claude
deskpilot run aider --model sonnet
```

`deskpilot run` creates a named tmux session from the current directory and attaches the
terminal you are already using. Leaving the desk, closing the terminal, or losing the
phone connection does not stop the command; it remains available in Deskpilot's Spaces
view. Name collisions receive `-2`, `-3`, and so on automatically.

This is the explicit alternative to shell integration. It does not edit a shell profile
or shadow the underlying command. Running `tmux new-session -s NAME COMMAND` directly
also works, because Deskpilot discovers every tmux session rather than only ones it made.

An arbitrary process started outside tmux cannot be moved into it later. Use
`deskpilot run` (or tmux itself) for full access to an ordinary shell or program.

### Connect an existing Codex conversation

Leave Ghostty and Codex startup as usual. On the phone, open **Spaces**, search for the conversation, then choose **Connect** for the conversation you want. Deskpilot opens
a mobile terminal attached to that exact conversation on Codex's already running shared
server. Your desktop window, pet, conversation and permission settings stay in place.
Returning to an enabled conversation opens the same mobile terminal again.

You can also find it by desktop location in **Desktop**. A terminal with a unique
matching conversation title and project shows a compact **Open terminal**
link beneath its window controls. The terminal menu provides desktop placement for the
same match. If the window cannot be matched uniquely, **Connect conversation…** opens
a chooser with conversation names, projects and IDs. Opening a terminal from Desktop
keeps that screen as the Back destination. Screenshots remain behind the **look** button.

This is an explicit action: discovery doesn't launch terminals, submit prompts, publish
previews, or close windows. Desktop and phone can use the same conversation without
moving its original shell. Closing the phone page leaves its terminal available for
reconnection. Closing the mobile tmux session leaves the original Codex terminal usable.

This requires a Codex CLI with shared-daemon, proxy and remote-resume support (verified
with CLI 0.162.1 and daemon 0.164.0). Conversations using `--no-daemon`, another Codex home,
or an independent backend are not offered. Only loaded, directly addressable root
conversations are listed; Codex can keep an idle conversation loaded after its window
closes. Folder trust and permission dialogs remain interactive on the phone. No trust or
sandbox bypass flags are added. Other agents and arbitrary shells still use the explicit
Deskpilot Terminal launcher.

### Connect a Herdr desktop terminal

The new **Herdr desktop app** runs its terminals in `herdr-core`. When that
runtime is installed and running on a paired computer, Deskpilot automatically
shows its live local terminals in **Spaces**, including ordinary
shells. Spaces and tabs follow the desktop layout, with split terminals kept
together. Tap a terminal row to connect or reopen the same running terminal on
your phone. Enabled terminals appear once in their Herdr group.

Collapse spaces to keep the view compact; Deskpilot remembers this per computer.
The current desktop space expands by default. Select a tab to see its terminals;
the tab choice and explicit space expansion choices survive polling and reloads.
**Needs you** shows terminals reporting blocked or error states; the visible search
field finds space names, tasks, terminal titles, agents, and project paths. If the
desktop layout is unavailable, live terminals remain under **Other terminals**.

The space and terminal **•••** menus open Herdr management, which uses native
commands to create, rename, reorder, split, and close its spaces and tabs.
Management requires the Herdr desktop app to be open on that computer. Terminal
discovery and mobile attachment remain available when only its core is running.
The installed app currently supports moving tabs earlier/later within a space;
transferring a whole tab to a different space is unavailable.

Closing a Herdr tab/space or stopping a Herdr terminal stops the original work.
The phone lists affected terminals before confirming a close, and rejects the
request if its reviewed layout changed. **Disconnect view** closes just the
mobile attachment. Native terminal swiping and the picker stay within the same
Herdr tab, attaching another pane's terminal on demand. Desktop actions point to
Herdr's window, which may contain several spaces and tabs.

Ordinary Deskpilot sessions and Codex conversations begin **Unassigned** in the same
Spaces browser. Move them into local spaces and tabs explicitly; native Herdr
membership remains owned by Herdr. Session controls and desktop placement remain available. **Desktop** retains the workspace
and window tools; **Previews** retains the independent image gallery. **Settings**
separates machines/pairing, authorized devices, notifications, usage, connections,
and this browser's app/installation information. Herdr is optional throughout.

Discovery only reads the running runtime. Connecting creates a tmux session
containing `herdr-core attach`; the original program stays in Herdr. Closing the
mobile session ends that viewing client and leaves the Herdr program running.
Terminal dimensions are shared: using the phone can resize the desktop view;
the desktop viewer can resize it again when you return.

Enabled mobile sessions use Herdr's reported working, blocked, and done state.
Deskpilot checks it in the background and sends its existing push notifications
when an observed state changes to blocked or done. Answer questions and approvals
in the terminal; Herdr status alone does not enable Deskpilot's one-tap approval.

This adapter targets the default local **herdr-core** session used by the new
desktop app. It does not discover the original Herdr TUI runtime, custom core
sessions, or SSH machines configured inside Herdr. Pair each computer with
Deskpilot for its local terminals. Herdr remains optional on every other host.

### Publish a task image

To check visual progress from your phone, have the task save a screenshot or render and
publish it:

```bash
deskpilot preview ./artifacts/login-page.png --caption "Login page after layout changes"
deskpilot preview ./renders/mount.jpg --task sink-fitting --caption "Current fitting geometry"
```

Open **Previews** in the phone app to see the latest image, caption, update time, and
recent history. Tap the image to enlarge it; **Actual size** allows scrolling around a
full-resolution image. Images refresh while the view is open, and can be removed there.

This works from ordinary Ghostty terminals with pets, from another terminal, and on a
headless host. It does not require a tmux session. The task label defaults to the current
tmux session when applicable, otherwise the project directory name. `--task` sets it
explicitly; `--session` is an alias. Previews are on demand: ask the working agent,
“Show me one preview of the current work and publish it to Deskpilot.” Nothing captures
or saves an image after each prompt, and **Refresh** only reloads images already published.

The optional Codex skill at [`skills/deskpilot-preview/SKILL.md`](skills/deskpilot-preview/SKILL.md)
provides this request workflow. When installed in Codex's skills directory, invoke
`$deskpilot-preview` in the working session, or ask it to show one Deskpilot preview.
It captures and publishes one relevant image on request, with no background capture.

Publishing uploads the selected file to the local service; it does not capture your
desktop automatically. Existing desktop screenshot lock checks still apply to desktop
captures. Previews accept PNG and JPEG images up to 8 MiB, 8192 pixels per side and
32 megapixels. The latest 20 images are retained per machine under
`~/.local/state/deskpilot/previews/` and require the same authentication as terminal data.
The command uses the service port from Deskpilot's configuration or `DESKPILOT_PORT`.

## Connecting a phone

Deskpilot listens on loopback, so [Tailscale](https://tailscale.com) must provide the
phone-facing HTTPS address:

```
shell/use-https.sh          # from a checkout
tailscale serve --bg --yes 8790   # or by hand, on a release install
```

Enable HTTPS certificates once in the
[Tailscale DNS settings](https://login.tailscale.com/admin/dns). Install Tailscale on the
phone and sign into the same tailnet before scanning anything; otherwise its private host
name will not resolve.

Then, on the machine:

```
deskpilot pair
```

The QR and link contain an eight-character, single-use code valid for ten minutes. Scan or
open either one; there is no second code to enter. `deskpilot pair --link` prints only the
link for scripts or agents to relay.

For the first machine, open the link directly and install the app. To add another machine,
open the installed app, choose **Computer → Pair computer**, and paste the new machine's pairing link.
Each phone or browser receives its own revocable credential.

Two things it can say instead of printing a QR, and they are not the same problem:

- **nothing answered on an address a phone could reach** — start Tailscale Serve and try
  again;
- **I could not run desk.sh** — install the runtime helpers at the path printed by the
  command.

### Installing it on the phone

Deskpilot is a progressive web app:

- **Android / Chrome:** use **Install** or **Add to Home screen** from the browser menu.
- **iOS / Safari:** tap **Share**, then **Add to Home Screen**.

Installation provides full-screen use, durable local settings, offline access to the
machine picker, and iOS push notifications. It requires HTTPS.

Deskpilot restores saved work and uses one **Spaces → tabs → terminals** hierarchy.
At 960px and wider it stays in a left sidebar; on phones, **Spaces** near the top
opens the same navigator. One terminal stays visible. Previous/next and horizontal
swipes stay within the current tab; vertical drags scroll ordinary or application-owned
history. The separate bottom dock and horizontal tab/pane strips are removed.

Herdr supplies native layout when available. Ordinary terminals start **Unassigned**;
unorganized Codex work sits in collapsed **Available conversations**, with search and
**Hide / Show hidden / Restore**. Organizing or hiding work does not stop its original
program. Spaces and tabs can also organize work on computers without Herdr.

**Needs you** filters the navigator with This computer / All computers scope and
explicit coverage. **Computer** contains switching, Desktop, Previews, pairing and
settings. Opening it preserves the active terminal connection. Input tools retains
paste without Enter, keys, selectable copy and text size. Contextual actions retain
source identity, original folder/window links and distinct adapter/session lifecycle.

Search, expansion, scroll and drafts restore without replaying actions. Drafts follow
stable source identities; a replacement with the same name cannot inherit them.
UI upgrades preserve pairings and drafts. An installed replacement offers **New UI ready
→ Reload**; it never reloads automatically while composing. Settings shows UI build and
backend version separately. A saved offline UI is identified independently of the
selected computer's connection.

To stop all Deskpilot background work temporarily, use `deskpilot pause`; `deskpilot
resume` starts it again. A paused service remains enabled and starts normally at the next
login or reboot. For a persistent choice, `deskpilot disable` stops it and disables
automatic startup, while `deskpilot enable` reverses both. `deskpilot status` reports the
current running and automatic-startup states. None of these commands stop tmux sessions.

More operational detail and troubleshooting live in [docs/setup.md](docs/setup.md). The
transport and trust decisions are recorded in [docs/decisions.md](docs/decisions.md).

## Updating

**Sessions survive it.** tmux runs as a child of the service unit with `KillMode=process`,
so a restart leaves every session attached and running — verified when the service
crash-looped for thirty seconds and everything was still there afterwards.

`deskpilot version` says what the command will run, and `shell/check.sh` verifies the live
service. The app also shows the version of each selected machine under **Settings → App & installation**.

**From a release** — the `install.sh` path:

```
sudo deskpilot update
systemctl --user restart deskpilot
```

`update` fetches the release index, verifies the published SHA-256 **before touching
anything on disk**, and stages the binary, runtime helpers, and application launcher
together. `deskpilot update --check` looks without installing, and a version argument
pins it (`sudo deskpilot update 0.1.15`).

It steps aside if a package manager owns the install, because overwriting a pacman-owned
file leaves a mismatch that the next `pacman -Syu` silently reverts.

Re-running the installer does the same job and is the fallback if the binary is too old to
have `update`:

```
curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/install.sh | sh
systemctl --user restart deskpilot
```

The restart is not optional in either case. Replacing the file does not disturb the
process already running — it holds the old one open until something restarts it — so an
update that stops before this appears to work and has changed nothing.

**From the PKGBUILD.** Each release attaches one with the version and checksum already
filled in:

```
gh release download vX.Y.Z -p PKGBUILD --clobber
makepkg -si
systemctl --user restart deskpilot
```

This route makes pacman the owner of the binary, so `deskpilot update` declines it. Update
through pacman again to avoid leaving package metadata out of sync with installed files.

**From a source checkout:**

```
shell/update.sh
```

It refuses to clobber uncommitted work and creates a disposable worktree at the incoming
revision. `npm ci`, the UI build, and the server typecheck all run there before the live
checkout changes. The complete built UI is switched into place as a directory, then the
service is restarted and its authenticated capabilities endpoint must answer. A failed
activation restores the previous commit and UI before restarting the old service.

### If the desk half goes quiet after an update

Runtime helpers ship beside the binary rather than inside it. Updating the binary alone
can pair a new server with an old helper and hide desktop capabilities. The installer,
self-updater, and package replace the complete set; `shell/check.sh` detects a mismatch.

### Recovery data

Preserve `~/.config/deskpilot/` and `~/.local/state/deskpilot/` when repairing or
reinstalling. The first contains configuration. The second contains per-device hashes, the
local-helper credential, push identity and subscriptions, and agent state. The tmux
server is separate from both and survives a Deskpilot service restart because the unit
uses `KillMode=process`.

If an update cannot start, a source update restores its previous checkout and built UI
automatically. For a packaged install, reinstall the previous verified release, keep the
two directories above, run `systemctl --user restart deskpilot`, then run
`shell/check.sh`. If credential state is corrupt, copy the damaged file aside before
repairing it; the server refuses to treat an unreadable existing store as a fresh install.

## Uninstalling

```
curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/uninstall.sh | sh -s -- --yes
```

By default it removes the program and **leaves your data alone** — the token, the config
and the recorded transcripts stay, so reinstalling puts you back where you were with every
paired device still paired. `--purge` removes those too, which is the start-over button.

It stops and disables the service before deleting the unit, because a running service
whose unit file has vanished stays running and un-stoppable by name until the next logout.
`--yes` is required when piping into `sh`: there is no terminal to confirm on, and a
`read` in that position either eats the rest of the script or sees EOF and reads as a
silent yes.

**Your tmux sessions survive it.** `KillMode=process` means stopping the service leaves
the tmux server and everything in it alive — the same property that makes updates safe.
The uninstaller says so rather than implying it closed them.

It steps aside if a package manager owns the install, for the mirror of the reason
`update` does: deleting a pacman-owned file leaves pacman believing it owns something that
is gone, and the next `-Syu` quietly puts it back. Use `sudo pacman -Rns deskpilot`, then
re-run this with `--purge` if you also want the token and transcripts gone.

Re-running it is safe, and is the fix for the half-finished case — if the sudo step failed
the first time, the second run asks for nothing it does not need.

**From a source checkout**, there is nothing to uninstall from `/usr`; drop the service and
the data yourself:

```
systemctl --user disable --now deskpilot
rm -rf ~/.config/systemd/user/deskpilot.service{,.d} ~/.config/deskpilot ~/.local/state/deskpilot
systemctl --user daemon-reload
```

Four things are deliberately left behind, because each is shared with something else and
removing it would be a surprise: the rules merged into `~/.claude/settings.json`,
`tailscale serve` (`tailscale serve reset`), `/etc/modules-load.d/uinput.conf` and your
`input` group membership, and your tmux sessions. The uninstaller names the ones it finds
rather than undoing them.

## Security

This is a service that runs commands on your machine, so the posture is worth stating
plainly rather than burying.

- **Every device gets its own credential.** Pairing hands over a single-use code, not the
  machine's key. Revoke a lost phone from the app and nothing else is disturbed — that
  covers the cookie the app falls back on as well as the token it normally sends, which is
  what makes revoking mean anything. Phone credentials are stored only as hashes in `devices.json`.
- **Only registered device credentials authorize connections.** Pairing accepts a
  QR/link or one-time code; shared machine tokens and token-bearing pairing links
  are not supported. Phones paired with an old shared token must pair again.
  Desktop helpers use their own registered credential, generated on server startup
  at `~/.local/state/deskpilot/local-token`; it is never printed in a pairing link.
- **Remote unlock is off** unless you set `DESKPILOT_UNLOCK=1`. It types your password
  into the lock screen through PAM and needs `ydotool`'s udev rule, so having the tool
  installed is not the same as consenting to it being reachable. Attempts are rate
  limited.
- **The sandbox is narrow.** The server runs under Deno with subprocess access scoped to
  fixed runtime helpers and three binaries — an injection bug cannot reach `rm`, `ssh` or `curl`.
  That scoping is why this is Deno rather than anything with an all-or-nothing model.
- **Screenshots refuse when the screen is locked.** `grim` will happily photograph a lock
  screen and return it as a valid image, so the guard fails closed on "unknown" as well as
  "locked".

## Design

The reasoning lives in **[docs/decisions.md](docs/decisions.md)**, including the options
that were tried and rejected — a second agent that could not be made to render, three
transports, and a multiplexer that would have replaced tmux. Most of it was learned the
hard way and is written down so it is not learned twice.

The short version:

- **Text first.** Window state as text, a still image on demand, no stream.
- **tmux is the seam.** Sessions survive dropped connections, a crashed server and an
  upgrade, because tmux is not part of deskpilot.
- **The terminal is real.** tmux control mode over a WebSocket, so resizing does not drop
  the connection when the soft keyboard opens.
- **Capabilities are asked for, never assumed.** Which is what lets one phone hold several
  machines that are not alike.

## Development and releases

The real Spaces/task interface is in `web/`, with shared navigation and the host-bound organization client under `web/src/lib/spaces/`. The isolated sample is under `output/mobile-directions/` (`npm run dev`, then `/spaces`). Registered devices can GET/POST `/api/organization` for computer-owned space/task metadata. Saves include the current revision; conflicts require refresh. The store excludes drafts, credentials, terminal output and native Herdr layout. The trial uses its own local sample middleware and never calls this production endpoint.


```
deno test --allow-read --allow-write --allow-env --allow-run=sh tests/  # unit tests
deno run -A tests/layout.ts                               # mobile flows/layout, disposable fixtures
deno run -A tests/scanner.ts                              # QR preview, fixtures + simulated camera
deno run -A tests/recovery.ts                             # reconnects, offline cold launch (restarts the service)
tests/headless.sh dist/deskpilot                          # a host with no desktop
deno run -A tests/terminal-launch.ts                      # real Ghostty/default terminal, disposable windows on Screen 99
deno run -A tests/previews.ts                            # image publishing without tmux or a desktop
deno run -A tests/previews-mobile.ts                      # phone preview layout and image review
shell/check.sh                                            # every environment assumption
shell/build.sh                                            # the single binary
```

Judge phone layout by measurement, never by eye or a desktop screenshot — both have lied
repeatedly here. `tests/layout.ts` drives real Chromium at 320/360/390/430 and asserts the
viewport is the size it asked for *before* trusting anything else.

### Releasing

The version is one hand-edited constant, `VERSION` in `server/version.ts`, and the tag is
what names the tarball and the `pkgver`. They are two different sources for the same
number, so the order matters:

```
# bump VERSION in server/version.ts, then
git commit -am "Release X.Y.Z"
git tag vX.Y.Z && git push origin main vX.Y.Z
```

The release workflow refuses to build if the tag and the constant disagree. That check
exists because the failure is otherwise silent and lands on the user: `update` compares
the running version against the one in the release filename by string equality, so an
artifact whose tag and embedded version disagree can leave every install in a permanent
update loop.

## Status

Early. It has run daily on Arch/Hyprland since August 2026, and CI exercises the headless
path on every commit. Other compositors currently receive the portable tmux features but
not desktop window controls.

Licensed under the [MIT License](LICENSE).
