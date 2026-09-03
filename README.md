# deskpilot

A phone-facing remote for the machine you left running.

Coding agents work for minutes at a time and then stop to ask a question. If you are not
at the desk when that happens, the work is not slow — it is stopped. deskpilot puts those
sessions on your phone: see which one is blocked and on what, answer it, start new work,
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
| window listing, moving, tiling | Hyprland |
| screenshots | `grim` |
| remote unlock and input | `ydotool`, plus turning it on deliberately |

The desk half is Hyprland-only today. It is one shell script, `scripts/desk.sh`, kept
readable and shipped beside the binary rather than compiled into it, precisely so that a
second compositor is somebody's afternoon rather than a rewrite.

## Install

Every release ships a single binary — the server and the web UI in one file, so the
target needs neither Deno nor npm. There is also a [source
build](#building-from-source) if you would rather compile it yourself.

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
tarball — but it has not been submitted to the AUR yet, so build it by hand for now.

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
address to reach. Today that is [Tailscale](https://tailscale.com):

```
shell/use-https.sh
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

On the phone, open the machine's address — `https://yourbox.tailnet.ts.net` — and enter
the code. Then **add it to your home screen**; it is a PWA, and installing it is what gets
you notifications and full-screen.

That device now has **its own credential**, not a copy of the machine's key. Lose the
phone and you revoke that one device from the app; everything else stays paired.

**Adding more devices** is the same: run `deskpilot pair` again for each.

**Adding more machines** works from the app. Install deskpilot on the second machine, run
`deskpilot pair` there, then in the app open the index, tap **add a machine**, and give it
that machine's address and code. A strip appears at the top once you have two, one tap to
switch, with a dot on any machine that needs you.

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
