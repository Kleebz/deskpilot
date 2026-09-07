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

| For | You need |
|---|---|
| sessions, terminals, notifications | `tmux` |
| window listing, moving, tiling | Hyprland **0.56.2+** |
| screenshots | `grim` |
| remote unlock and input | `ydotool` — **any Linux**, no compositor needed |

Note what is *not* in that list: unlock and input injection. `ydotool` writes to
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

It builds the UI, installs a user service pointing at this directory, and runs the checks.
It asks before touching your shell profile or `~/.claude/settings.json`, and `--yes`,
`--no-shell` and `--no-claude` answer for it. Because the service points at the checkout,
**moving or deleting the directory breaks it** — re-run `shell/setup.sh` after a move.

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

Then, on the machine:

```
deskpilot pair
```

That prints an eight-character code, good for ten minutes and one device:

```
  K7MQ3FDN
```

**From a source checkout, use `shell/pair.sh` instead.** Nothing installs a `deskpilot`
command on your PATH when you run from the repo — the service runs `deno` against the
directory — so `deskpilot pair` will not be found there. `pair.sh` prints the same code,
plus a QR and a full link that pairs in one scan.

On the phone, open the machine's address in a browser — `https://yourbox.tailnet.ts.net` —
and enter the code.

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

**Adding more devices** is easiest from a device that is already paired: open the app,
**sessions index -> devices -> pair another device**, and scan the QR with the new one. It
carries the address *and* the code, so there is nothing to type — the app knows its own
address, which is the half `deskpilot pair` cannot tell you. From the machine,
`deskpilot pair` works too, and `shell/pair.sh` from a checkout prints its own QR.

That panel is also where a device still on the old shared token upgrades itself: it says
so in the list, and the code field beside it swaps the shared credential for one of its
own without re-pairing anything else.

**Adding more machines** works from the app. Install deskpilot on the second machine, run
`deskpilot pair` there, then in the app open the index, tap **add a machine**, and give it
that machine's address and the code. A link from `shell/pair.sh` goes in the address on its
own — it already carries the code. The address is the half `deskpilot pair` cannot tell
you: it runs under an allowlist of four subprocesses and cannot ask Tailscale what this
machine is called, and widening that to save a paste is not a trade worth making. A strip
appears at the top once you have two, one tap to switch, with a dot on any machine that
needs you.

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
instead. The app shows it per machine in the **machines** list — which is the one that matters once a phone
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

## Security

This is a service that runs commands on your machine, so the posture is worth stating
plainly rather than burying.

- **Every device gets its own credential.** Pairing hands over a single-use code, not the
  machine's key. Revoke a lost phone from the app and nothing else is disturbed. Tokens
  are stored hashed — the state file is not a set of working credentials.
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
deno run -A tests/layout.ts                               # phone layout, headless chromium
deno run -A tests/recovery.ts                             # reconnects, offline page (restarts the service)
tests/headless.sh dist/deskpilot                          # a host with no desktop
shell/check.sh                                            # every environment assumption
shell/build.sh                                            # the single binary
```

Judge phone layout by measurement, never by eye or a desktop screenshot — both have lied
repeatedly here. `tests/layout.ts` drives real Chromium at 320/360/390/430 and asserts the
viewport is the size it asked for *before* trusting anything else.

## Status

Early. It has run daily on one Arch/Hyprland machine since August 2026, and CI exercises
the headless path on every commit. It has not been run on a second compositor, and the
packaging has been installed by exactly one person.

Licensed under the [MIT License](LICENSE).
