# Setup

Steps are ordered by dependency. Each one is useful on its own and each has a rollback.

Verified on Omarchy / Arch, Hyprland 0.56.0. Every step ends with a check that either
prints something or tells you it failed.

`$REPO` below means wherever you cloned this. Nothing assumes a particular directory —
the scripts resolve their own location — so substitute your path or set it once:

```bash
REPO=~/Projects/deskpilot        # or wherever you cloned it
```

---

## Step 0 — Preflight

```bash
$REPO/shell/check.sh
```

Checks every assumption — tools, compositor, the systemd user environment, lock
program, terminal, uinput permissions, shell integration, service state, reachability —
and prints the fix beside anything missing. Essential failures exit non-zero; optional
things only warn.

Run it now, and again whenever something behaves oddly. Most failures in this project
have been silent, and this is what makes them visible.

**Assumptions worth knowing**, all overridable in the config below:

| | |
|---|---|
| Compositor | **Hyprland** — `hyprctl` and numbered workspaces are load-bearing |
| Lock | `hyprlock`, detected by process name |
| Terminal | `alacritty`, must accept `-e CMD` |
| Shell | bash or zsh for the wrapper |
| Session env | systemd user manager must have `WAYLAND_DISPLAY` (uwsm does this) |

Copy the config if you need to change any of them:

```bash
mkdir -p ~/.config/deskpilot
cp $REPO/deskpilot.conf.example ~/.config/deskpilot/config
```

---

## Step 1 — The skill

Makes Claude able to inspect and drive the desktop. Nothing remote required; works from
any terminal on this machine. Skip it if you do not use Claude Code — nothing else
depends on it.

```bash
mkdir -p ~/.claude/skills
ln -s $REPO/skills/desk-control ~/.claude/skills/desk-control
```

Claude Code only loads skills from `~/.claude/skills/`, so the symlink is what lets the
skill live in the repo and still be picked up — edits are live, and it stays in git.

**Verify** — ask Claude Code "what's on workspace 1". It should answer from
`hyprctl clients -j` without taking a screenshot.

Then apply the permission rules, or driving the desktop becomes a prompt storm — the
read-only queries and window moves fire constantly:

```bash
$REPO/shell/install-permissions.sh
```

It merges into `~/.claude/settings.json`, backs up first, and is safe to re-run.
**Claude Code cannot run this for you** — the classifier blocks an agent from widening
its own permissions, which is correct behaviour. It allows reversible things, keeps
`closewindow` and `tmux send-keys` on *ask* (both can destroy work or type into any
terminal you have open), and denies `hyprctl dispatch exit` outright.

**Rollback** — `rm ~/.claude/skills/desk-control` (removes the symlink, not the repo);
the script leaves a timestamped backup of your settings beside the original.

---

## Step 2 — The tmux wrapper

Makes each session addressable by name, which everything remote is built on. Your desk
experience does not change: you still type `claude`.

```bash
echo "source $REPO/shell/claude-tmux.sh" >> ~/.bashrc
```

Takes effect in **new** terminals only. Sessions already running are untouched.

**Verify** — open a new terminal, then, in any project directory:

```bash
cd ~/some-project && claude    # should look completely normal
tmux ls                        # from another terminal: a session named `some-project`
tmux send-keys -t some-project "hello" Enter   # text appears in that session
```

That last line is the whole point — it is how the phone talks to a specific session.

**Rollback** — remove the `source` line from `~/.bashrc`.

---

## Step 3 — Server and web UI

The daily driver, and what the reachability step exists to expose. Do this before
Step 4: those scripts restart this service and re-pair against it.

Build the UI first — `web/dist/` is gitignored, and the server returns a 503 telling you
this if it is missing:

```bash
cd $REPO/web
npm install
npm run build
```

For UI work, `npm run dev` serves with hot reload and proxies `/api` to the running
service, so you edit against real sessions rather than mocks.

Then install the service:

```bash
$REPO/shell/install-service.sh          # binds 127.0.0.1 — the right default
$REPO/shell/install-service.sh --lan    # also reachable on your home wifi
```

It generates a token if you have none, writes the unit into `~/.config/systemd/user/`
with absolute paths resolved from where you cloned, enables it, and prints the URL.

**Which one to pass depends on where you are going next**, and this is the one place
the choice actually matters:

| Your goal | Use | Why |
|---|---|---|
| Reach it from anywhere (**recommended**) | no flag | Step 4's HTTPS route proxies from loopback, so the port never needs to be open at all |
| Try it on your home wifi first | `--lan` | Nothing else will reach 127.0.0.1 |
| Tailnet over plain HTTP (Step 4 fallback) | `--lan` | `use-tailscale.sh` firewalls the port rather than rebinding it, so the service must be listening beyond loopback |

`--lan` means anything on your home network that can reach port 8790 gets to try the
bearer token. That token is the only thing between a device on your wifi and a process
that runs commands as you. Acceptable for testing from your own phone; not acceptable
on a network you do not control. **Never port-forward this.**

**Verify:**

```bash
T=$(cat ~/.config/deskpilot/token)
curl -s -H "authorization: Bearer $T" localhost:8790/api/sessions | jq
curl -s -o /dev/null -w '%{http_code}\n' localhost:8790/api/sessions   # 401, no token
```

**Pairing a phone:**

```bash
$REPO/shell/pair.sh
```

Prints a QR encoding the URL *with* the token. Scan it and add the page to your home
screen — the token is stored in a one-year cookie as well as localStorage, so it is once
per host. Re-run it whenever the address changes; each of the moves in Step 4 is a
different address, and a token saved against the old one does not carry over.

It prefers the HTTPS name when Tailscale Serve is up, then the tailnet address, then the
LAN address — in each case the one that keeps working when you leave the house.

**Installing on Android: use Chrome, not Brave.** Both show the install prompt, but
Brave strips Google service integrations including WebAPK minting, so it can only ever
create a home-screen shortcut. Chrome installs a real app — separate entry in the
launcher and task switcher, standalone window, no URL bar. Verified on a tailnet-only
origin, so a private address is not an obstacle. The prompt only appears over HTTPS
(Step 4) — a private IP over plain HTTP is not a secure context and no browser will
offer it, with no explanation given.

**What you get:** swipe between screens 1–10, each showing the session on that
workspace as a **real terminal** — a PTY sized to your phone, so programs lay out for
the screen instead of being re-flowed afterwards. Plus a sessions index, window
move/tile, screenshots, and remote unlock.

The `--allow-run` allowlist is scoped to the two scripts, `tmux`, and `script(1)` — the
last only because Deno has no PTY and the terminal view needs one. This is why the
server is Deno rather than Bun. Do not widen it to bare `--allow-run`.

**Rollback** — `systemctl --user disable --now deskpilot`.

---

## Step 4 — Reachability

Only needed off the home network. On the LAN you are already done.

### 4a. Tailscale

```bash
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled     # the package ships it disabled
tailscale up                                # opens a browser to authenticate
```

The middle line is the one people miss: installing the package leaves the daemon
disabled, and `tailscale login` then fails with
`dial unix /var/run/tailscale/tailscaled.sock: no such file or directory`, which reads
like a broken install rather than a stopped service.

Install the Tailscale app on the phone and sign in to the same tailnet.

### 4b. HTTPS — the recommended route

Requires enabling **HTTPS Certificates** once at
<https://login.tailscale.com/admin/dns>.

```bash
$REPO/shell/use-https.sh
```

This is both the easier and the safer option, and it is what this machine runs:

* Tailscale Serve terminates TLS with a genuine Let's Encrypt certificate for
  `<host>.<tailnet>.ts.net`, renewed automatically — no self-signed warning, no CA to
  install on the phone.
* Serve reaches the app over **loopback**, so the server keeps listening on 127.0.0.1
  only. That is strictly better than binding `0.0.0.0` and trusting a firewall rule,
  because there is nothing to reach even if the rule is wrong. If you passed `--lan`
  earlier, the script removes that override for you.
* A secure context is what makes the PWA installable at all.

The script proves the new route works *before* narrowing anything, and restores the
previous binding if it cannot — an earlier version tore down the working setup first
and stranded the phone.

**Verify** — **turn off wifi on the phone** and load it over cellular. Testing on wifi
proves nothing, because you are still on the LAN.

### 4c. Tailnet over plain HTTP — the fallback

Only if you cannot enable certificates. Requires `install-service.sh --lan` first,
because it firewalls the port rather than rebinding the service.

```bash
$REPO/shell/use-tailscale.sh
```

Moves ufw from "anyone on my wifi" to "tailnet only", restarts the service, and prints
a new pairing QR. You give up the PWA install and the padlock.

**Rollback for this whole step** — `tailscale serve reset` undoes 4b on its own. To go
further: `sudo tailscale down`, `sudo systemctl disable --now tailscaled`, and re-add a
LAN rule if you want it back:
`sudo ufw allow from <subnet> to any port 8790 proto tcp`. If you had been running
loopback-only, you will also need `install-service.sh --lan` again to be reachable at
all.

### 4d. SSH — optional escape hatch

**Nothing in deskpilot uses SSH.** It is worth having anyway before Step 5, because a
remote unlock that misbehaves can leave you with no way into the GUI.

```bash
sudo systemctl enable --now sshd
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys    # paste the phone's pubkey, then Ctrl-D
chmod 600 ~/.ssh/authorized_keys
```

Disable password auth via a drop-in — do **not** edit `/etc/ssh/sshd_config` if your
box uses `Include /etc/ssh/sshd_config.d/*.conf`:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  | sudo tee /etc/ssh/sshd_config.d/10-deskpilot.conf
sudo sshd -t && sudo systemctl restart sshd
```

`sshd -t` validates the config first. If it fails, fix it before restarting — otherwise
you can lock yourself out. Verify from the phone on your home wifi, before going
further: `ssh <you>@<lan-ip>` should log in with the key and never prompt for a
password.

---

## Step 5 — Remote unlock

**Built.** Optional, and only needed because the screen locks after idle and `grim`
then returns a picture of the lock screen instead of your desktop. Window state as text
keeps working regardless.

Two prerequisites first, then the script — it checks for both and stops with the exact
command if either is missing:

```bash
sudo pacman -S ydotool
sudo usermod -aG input $USER     # then log out and back in
sudo -v && $REPO/shell/install-input.sh
```

The script does the parts that are easy to miss: loads the `uinput` kernel module and
persists it across reboots, and reloads the udev rules so the one `ydotool` ships
actually takes effect. Without that reload `/dev/uinput` stays root-only `0600` and
every call fails with a permission error that looks like a broken install.

Re-run `check.sh` afterwards — it tests whether the device is genuinely writable rather
than assuming the rule applied.

`ydotool` rather than `wtype` because it writes to `/dev/uinput`, below the Wayland
layer, so hyprlock receives real keystrokes and validates them through PAM. Nothing is
bypassed — you are typing your actual password, remotely. See decisions.md for why
killing hyprlock was rejected.

**Using it:** the sessions index at the far left of the app shows an unlock field when
the desktop is locked. The password is typed each time and **never stored** — not in
localStorage, not in a file — and reaches the desktop on stdin rather than argv,
because `/proc/*/cmdline` is world-readable.

**Before relying on this remotely, test it at the desk.** If the mechanism does not
work you are locked out of the GUI with only SSH as recourse — which is why 4d exists.

Typing and clicking are deliberately **not** exposed over HTTP; they stay in
`scripts/desk.sh` for an agent working on the machine. Unlock is the single exception.

**Rollback** — `systemctl --user disable --now ydotool`, then
`sudo gpasswd -d $USER input` and `sudo rm -f /etc/modules-load.d/uinput.conf` if you
want the access removed too. The app still offers the unlock field whenever the screen
is locked — it is gated on the lock, not on `ydotool` — and the attempt returns an
error rather than doing nothing silently.

---

## Order and why

1. **Skill** — useful immediately, needs nothing, skippable
2. **tmux wrapper** — everything remote sits on `send-keys`
3. **Server + web UI** — the daily driver; Step 4 restarts and re-pairs against it
4. **Reachability** — what makes it work outside the house
5. **Unlock** — last, and only if the lock actually gets in your way

Remote Control was evaluated and rejected — see decisions.md. It is not part of this
setup and you never need the Claude mobile app.
