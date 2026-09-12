# deskpilot

A phone-facing remote for the machine you left running.

Coding agents work for minutes at a time and then stop to ask a question. If you are not
at the desk when that happens, the work is not slow — it is stopped. deskpilot puts those
sessions on your phone: see which one is blocked and on what, answer it, start new work,
copy a command or a path out of a session into the phone's clipboard, paste one back in,
and — on Hyprland — look at the screen and move windows.

It runs entirely on your own hardware. There is no service in the middle, no account, and
nothing leaves your machine except the notifications you asked for.

```
┌─ machines ────────────────────┐
│  ● desk       needs you       │   a session blocked on a permission prompt,
│  ○ buildbox                   │   sorted to the top, saying what it is asking
├─ sessions ────────────────────┤
│  ws2  api        Bash?  rm -rf│
│  ws6  deskpilot  working      │
│  ws7  notes                   │
└───────────────────────────────┘
```

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

## What it is not

Not a remote desktop. Streaming pixels to a phone is expensive and unreadable; a screen of
terminal output is about 2 KB of text where a screenshot of the same thing is 130–210 KB.
So the cheap path is the main one: state as text, a cropped still only when pixels are
genuinely the content, and no video at all.

Not tied to one agent, either. A session is a tmux session and what runs inside it is not
this project's business — Claude Code, Codex, Aider, or a bare shell all work the same
way, because typing into a terminal does not care what is reading.

## Requirements

**tmux.** That is the whole hard requirement.

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

## Install

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

That path is not cosmetic. The binary's subprocess allowlist is fixed when it is built, so
`/usr/share/deskpilot/scripts/desk.sh` is the only copy it may execute — a copy elsewhere
is found and then refused, which looks exactly like "this machine has no compositor".

Then set it up and start it:

```
deskpilot setup
systemctl --user daemon-reload
systemctl --user enable --now deskpilot
```

`setup` makes a token, writes the user service, and prints those two commands. It runs
`systemctl` for you nowhere — that would mean adding it to the server's subprocess
allowlist, which is not a trade worth making to save you a paste.

An Arch package is generated with every release — `PKGBUILD` is attached alongside the
tarball — and building it by hand is the Arch route for now:

```
gh release download vX.Y.Z -p PKGBUILD
makepkg -si
```

It is not in the AUR, and that is not a matter of getting round to it: AUR account
registration is disabled upstream at the moment, in response to the volume of automated
scraping the site has been absorbing, with no date on it. The package above is the same
one that would be published there, so nothing is missing except the one-command install.

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

## Connecting a phone

deskpilot listens on loopback and expects something in front of it, so the phone has an
address to reach. **This step is not optional** — until something fronts it there is no
address for a phone to open at all. Today that is [Tailscale](https://tailscale.com):

```
shell/use-https.sh          # from a checkout
tailscale serve --bg --yes 8790   # or by hand, on a release install
```

That puts Tailscale Serve in front, which gives a real certificate — needed for the app to
be installable — and keeps the port closed on every interface. On the same network you can
skip it and use the machine's LAN address, but you will not get the PWA.

**Serve needs HTTPS certificates enabled once for your tailnet**, at
[login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns) — the **Enable
HTTPS** button. It is a per-tailnet setting, not per-machine, so it may already be on. If
it is not, `tailscale serve` has no certificate to use and says so.

**The phone needs Tailscale too, and signed in before you scan anything.** The address
above is a tailnet name; a device that is not on the tailnet cannot resolve it, so a scan
lands on the browser's own "can't be reached" page. On a device that has never loaded the
app there is no service worker yet either, so deskpilot's own offline page cannot explain
it — it reads as broken pairing rather than a missing VPN. Install Tailscale on the phone,
sign in, then pair.

Then, on the machine:

```
deskpilot pair
```

That prints a QR and a complete link containing an eight-character code good for ten
minutes and one device:

```
  [QR]

  https://yourbox.tailnet.ts.net/?code=K7MQ3FDN

```

Scan it with the phone's camera or open the complete link and pairing is done. The code is
already in both, so there is no second field to fill in. When another program or agent is
relaying the result, `deskpilot pair --link` prints only that complete link, without the
terminal QR or duplicate prose.

Opening another QR for a machine already paired in that browser/PWA selects its existing
credential instead of enrolling it again. The **devices** count is a count of browser/PWA
credentials accepted by this machine; the machine itself is the server and is not included.
Device names can be changed in that panel if the browser only supplies a generic platform
name.

That scan/open path is for the first Deskpilot machine on a phone. If Deskpilot is already
installed from another machine, open the installed app, choose **+ add another machine**, and
paste the complete link there. Scanning the new machine's QR in the phone camera opens its
origin separately in the browser; browser storage is origin-scoped, so it cannot add
itself to the machine list stored by the already-installed app.

Two things it can say instead of printing a QR, and they are not the same problem:

- **nothing answered on an address a phone could reach** — Tailscale Serve is not
  running. deskpilot listens on loopback, so until something fronts it there is no
  address to print. Run `tailscale serve --bg --yes 8790` and try again.
- **I could not run desk.sh** — the binary cannot find the script it asks for the
  address, and it prints the path it looked at. A compiled binary's `--allow-run`
  allowlist is fixed at build time, so it may only execute that one copy; install it
  there. This says nothing about whether Serve is working, and restarting Serve will
  not fix it.

**From a source checkout this is the same command.** `shell/setup.sh` installs a
`deskpilot` shim at `~/.local/bin/deskpilot` that dispatches to `shell/`, so `pair`,
`setup`, `rotate`, `update` and `check` all work by the documented name. `shell/pair.sh`
still works directly if `~/.local/bin` is not on your PATH.

### Installing it on the phone

It is a web app, so there is nothing to download. Open the address and the app offers to
install itself:

- **Android / Chrome** — a bar appears saying *"Add to your home screen for a full-screen
  app"* with an **install** button. Tapping it is the whole process. If you dismissed it,
  the browser's ⋮ menu has **Add to Home screen**.
- **iOS / Safari** — Safari gives no install button, so the app tells you what to do
  instead: tap **Share**, then **Add to Home Screen**. Use Safari; other iOS browsers are
  less reliable at this.

**Installing is worth doing rather than bookmarking.** It runs full-screen without browser
chrome, it keeps its own storage so you are not re-pairing after a browser clean-up, and
push notifications only work from an installed app on iOS.

It needs HTTPS to be installable at all — a plain `http://` address is not a secure
context and browsers will not offer it. That is what `shell/use-https.sh` is for.

You can open the same address from a desktop browser too; it is the same app, and Chrome
will offer to install it there as well. Useful for a look without reaching for your phone,
though the layout is built for a phone.

That device now has **its own credential**, not a copy of the machine's key. Lose the
phone and you revoke that one device from the app; everything else stays paired.

**Adding more devices** happens at the machine: `deskpilot pair` prints a QR carrying the
address and the code together, and that is the only place a code is minted. The app used
to mint one too and draw its own QR, which meant two pairing flows for one job and two
near-identical panels above your sessions. There is one now.

The app's **devices** panel is what you cannot do from a terminal you cannot reach: it
lists what is paired and revokes any of it, one device at a time, which is the thing that
makes a lost phone survivable. It is also where a device still on the old shared token
upgrades itself — it says so in the list, and one tap swaps the shared credential for one
of its own without re-pairing anything else. Each browser/PWA credential is one row; the
desktop machine serving the app is not a paired-device row. The name is editable because
privacy-reduced browser data sometimes identifies only the platform rather than the phone
model.

**Adding more machines** works from the app. Install deskpilot on the second machine, run
`deskpilot pair --link` there, then tap **Add machine** beside the persistent machine
picker and paste the complete link. You can also scan its QR or enter an address and code
separately. The picker shows attention counts for all paired machines. A machine's label can
be renamed under **Manage** on this phone, so two hosts that both report `omarchy` can read
as `Desktop` and `Laptop` without changing either hostname. Selecting a machine opens its
sessions at the top; tapping any session opens its terminal, including sessions with no
desktop window.

**Screens** provides desktop workspace browsing and window controls on capable machines.
Swipe horizontally between adjacent screens, or use the workspace selector to jump
directly to one; the two controls stay synchronized.
**Manage** contains authorized devices, credentials, usage, notifications, and installation.
**New session** opens a dedicated form: desktop placement is optional, defaulting to no
window from Sessions and the selected workspace from Screens. Cancel retains the draft;
Back to sessions restores the previous list position.

Use the in-app flow even when a QR is available. A PWA and its machine list belong to the
origin it was installed from; scanning another machine's QR in the phone camera opens that
other origin in the browser instead of inserting it into the installed app's list.

The machine that supplied the installed PWA does not have to remain online. The service
worker caches the versioned application shell—not sessions, screenshots, lock state, or
any API response—so a cold launch can still read the phone's machine list and switch to
one that is available. Updates arrive when the origin machine is reachable again.

**If nothing appears in the app**, the usual cause is that agents started at your desk are
running outside tmux, where nothing can reach them. The app says so on the empty screen
and gives you the one line that fixes it.

**It asks two things**, both editing files outside deskpilot, both declinable, both
reversible by running `setup` again:

- one line in your shell profile, so agents you start at your desk are visible to your
  phone rather than running where nothing can reach them
- notification hooks and permission rules in `~/.claude/settings.json`

`--yes` accepts both for a scripted install; `--no-shell` and `--no-claude` refuse them
individually. With no terminal attached it declines rather than assuming.

Requiring Tailscale means a VPN client on the phone, which is a real cost and an honest
one. Removing it means WebRTC with a signalling server — designed, not built.
[decisions.md](docs/decisions.md) has the reasoning, including why a relay that could read
your traffic was rejected twice.

## Updating

**Sessions survive it.** tmux runs as a child of the service unit with `KillMode=process`,
so a restart leaves every session attached and running — verified when the service
crash-looped for thirty seconds and everything was still there afterwards.

On a release or package install, `deskpilot version` says what you are running; from a
checkout there is no such command, and `shell/check.sh` reports the running version
instead. The app shows it per machine in **Manage** for the selected machine — which is the one that matters once a phone
holds more than one, since the question stops being "what am I running" and becomes "which
of these is behind".

**From a release** — the `install.sh` path:

```
sudo deskpilot update
systemctl --user restart deskpilot
```

`update` fetches the release index, verifies the published sha256 **before touching
anything on disk**, and replaces the binary and both scripts together — staged beside
each destination and renamed, so a failure halfway cannot leave a new binary next to an
old `desk.sh`. `deskpilot update --check` looks without installing, and a version
argument pins it (`sudo deskpilot update 0.1.2`).

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

**From the PKGBUILD**, which is where Arch users are for as long as AUR registration stays
closed.
Each release attaches a `PKGBUILD` with that version and checksum already filled in, so
this is a download rather than an edit:

```
gh release download vX.Y.Z -p PKGBUILD --clobber
makepkg -si
systemctl --user restart deskpilot
```

This route makes pacman the owner of the binary, so `deskpilot update` will decline it and
send you back here — deliberately, since replacing a pacman-owned file leaves a mismatch
the next `-Syu` silently reverts. If the package ever reaches the AUR, this all becomes
`pacman -Syu` like anything else.

**From a source checkout:**

```
shell/update.sh
```

It refuses to clobber uncommitted work, fast-forwards, rebuilds the UI *before* restarting
— the server serves `web/dist` straight off disk, so a rebuild goes live the moment it
compiles — typechecks the server, and stops rather than restarting if either fails.

### If the desk half goes quiet after an update

`desk.sh` ships beside the binary rather than inside it, and the two move together. Update
the binary alone and a new server can be talking to an old script, which surfaces as
window and screenshot controls disappearing — the app reports the machine as having no
compositor. `install.sh` and the package both replace the pair; a hand-unpacked tarball is
the case to watch. `shell/check.sh` will say so.

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
  what makes revoking mean anything. Tokens are stored hashed — the state file is not a
  set of working credentials.
- **The machine's shared token can be replaced.** It predates per-device credentials and
  is still what an old pairing holds, and `pair.sh` prints it into a URL and a QR whenever
  the service is not answering — so it leaks the way a URL leaks, into history or a
  screenshot or a photograph of a terminal. Revoking a device does nothing about a copy of
  it. `deskpilot rotate`, or `shell/rotate.sh` from a checkout, mints a new one: devices
  holding their own credential keep working, anything still on the shared token has to
  pair again, and the command says how many of each there are before it touches
  anything.
- **Remote unlock is off** unless you set `DESKPILOT_UNLOCK=1`. It types your password
  into the lock screen through PAM and needs `ydotool`'s udev rule, so having the tool
  installed is not the same as consenting to it being reachable. Attempts are rate
  limited.
- **The sandbox is narrow.** The server runs under Deno with subprocess access scoped to
  one script and three binaries — an injection bug cannot reach `rm`, `ssh` or `curl`.
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

## Development

```
deno test --allow-read --allow-write --allow-env tests/   # unit tests
deno run -A tests/layout.ts                               # mobile flows/layout, disposable fixtures
deno run -A tests/scanner.ts                              # QR preview, fixtures + simulated camera
deno run -A tests/recovery.ts                             # reconnects, offline cold launch (restarts the service)
tests/headless.sh dist/deskpilot                          # a host with no desktop
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
git commit -am "Release 0.1.3"
git tag v0.1.3 && git push origin main v0.1.3
```

The release workflow refuses to build if the tag and the constant disagree. That check
exists because the failure is otherwise silent and lands on the user: `update` compares
the running version against the one in the release filename by string equality, so an
artifact tagged `0.1.3` containing a binary that says `0.1.2` tells every install there is
an update, forever, and taking it changes nothing.

## Status

Early. It has run daily on one Arch/Hyprland machine since August 2026, and CI exercises
the headless path on every commit. It has not been run on a second compositor, and the
packaging has been installed by exactly one person.

Licensed under the [MIT License](LICENSE).
