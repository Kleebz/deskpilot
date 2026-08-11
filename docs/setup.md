# Setup

Steps are ordered and independent — each one is useful on its own, and each has a
rollback. Do not skip ahead; step 4 depends on step 1 existing.

Verified on Omarchy / Arch, Hyprland 0.56.0. Every step ends with a check that either
prints something or tells you it failed.

---

## Step 0 — What is already here

```bash
for c in grim slurp hyprctl jq tmux wl-copy deno; do
  printf '%-10s %s\n' "$c" "$(command -v $c || echo MISSING)"
done
```

All of these should be present on a stock Omarchy box. Installed later, only when the
step that needs them arrives: `tailscale` (step 3), `ydotool` (step 5).

---

## Step 1 — The skill

Makes Claude able to inspect and drive the desktop. Nothing remote required; works from
any terminal on this machine.

```bash
ln -s ~/Projects/deskpilot/skills/desk-control ~/.claude/skills/desk-control
```

**Verify** — ask Claude Code "what's on workspace 1". It should answer from
`hyprctl clients -j` without taking a screenshot.

**Rollback** — `rm ~/.claude/skills/desk-control` (removes the symlink, not the repo).

---

## Step 2 — The tmux wrapper

Makes each Claude session addressable by name, which everything remote is built on.
Your desk experience does not change: you still type `claude`.

```bash
echo 'source ~/Projects/deskpilot/shell/claude-tmux.sh' >> ~/.bashrc
```

Takes effect in **new** terminals only. Sessions already running are untouched.

**Verify** — open a new terminal, then:

```bash
cd ~/Projects/zigwam && claude     # should look completely normal
tmux ls                            # from another terminal: a session named `zigwam`
tmux send-keys -t zigwam "hello" Enter   # text appears in that Claude session
```

That last line is the whole point — it is how the phone will talk to a specific session.

**Rollback** — remove the `source` line from `~/.bashrc`.

---

## Step 3 — Reachability

Three sub-steps. Do them in order; the SSH check must pass before you rely on Tailscale.

### 3a. Enable sshd

```bash
sudo systemctl enable --now sshd
```

Add your phone's public key (generate it in Termux/Blink first):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys    # paste the phone's pubkey, then Ctrl-D
chmod 600 ~/.ssh/authorized_keys
```

Disable password auth via a drop-in — do **not** edit `/etc/ssh/sshd_config`, this box
uses `Include /etc/ssh/sshd_config.d/*.conf`:

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' \
  | sudo tee /etc/ssh/sshd_config.d/10-deskpilot.conf
sudo sshd -t && sudo systemctl restart sshd
```

`sshd -t` validates the config first. If it fails, fix it before restarting — otherwise
you can lock yourself out.

**Verify from the phone, on your home wifi, before going further:**
`ssh jacob@<lan-ip>` should log in with the key and never prompt for a password.

### 3b. Persistent tmux session

So a dropped connection does not kill Claude, and so the session inherits the Hyprland
environment (`WAYLAND_DISPLAY`, `HYPRLAND_INSTANCE_SIGNATURE`) that `grim` and `hyprctl`
need.

Add to `~/.config/hypr/autostart.conf`:

```
exec-once = tmux new -d -s phone
```

Plain `exec-once`, **not** `uwsm-app --`, despite that being the house style in this
file. `tmux new -d` daemonizes and returns immediately; under a uwsm scope that can look
like the app exiting and take the tmux server with it.

**Verify** — log out and back in, then `tmux ls` should show `phone`. Confirm it has the
environment:

```bash
tmux new -d -s envtest 'echo $HYPRLAND_INSTANCE_SIGNATURE > /tmp/envcheck; sleep 1'
sleep 2 && cat /tmp/envcheck    # non-empty means the env is inherited
```

Connect with `ssh -t jacob@host tmux attach -t phone`.

### 3c. Tailscale

Only needed off the home network. On the LAN, skip it.

```bash
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
```

Install the Tailscale app on the phone, sign in to the same tailnet.

**Verify** — `tailscale status` lists the phone. Then **turn off wifi on the phone** and
SSH to the tailnet IP over cellular. Testing on wifi proves nothing.

**Rollback** — `sudo tailscale down`, `sudo systemctl disable --now tailscaled sshd`.

---

## Step 4 — Server and web UI

**Built.** A Deno server wrapping `scripts/`, plus a Svelte web UI.

Build the UI first — `web/dist/` is gitignored, and the server returns a 503 telling
you this if it is missing:

```bash
cd ~/Projects/deskpilot/web
npm install
npm run build
```

For UI work, `npm run dev` serves with hot reload on the LAN and proxies `/api` to the
running service, so you edit against real sessions rather than mocks.

Then generate a token and install the service:

```bash
mkdir -p ~/.config/deskpilot
openssl rand -hex 32 > ~/.config/deskpilot/token
chmod 600 ~/.config/deskpilot/token

mkdir -p ~/.config/systemd/user
ln -s ~/Projects/deskpilot/systemd/deskpilot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now deskpilot
```

It runs as a user service rather than a Hyprland `exec-once` because uwsm already
imports `WAYLAND_DISPLAY` and `HYPRLAND_INSTANCE_SIGNATURE` into the systemd user
manager, so `hyprctl` and `grim` work directly — and systemd restarts it when it dies.
Idle cost measured at 64 MB.

**Verify:**

```bash
T=$(cat ~/.config/deskpilot/token)
curl -s -H "authorization: Bearer $T" localhost:8790/api/sessions | jq
curl -s -o /dev/null -w '%{http_code}\n' localhost:8790/api/sessions   # 401, no token
```

**Pairing a phone:**

```bash
~/Projects/deskpilot/shell/pair.sh
```

Prints a QR encoding the URL *with* the token. Scan it and add the page to your home
screen — the token is stored in a one-year cookie as well as localStorage, so it is once
per host. Re-run it whenever the address changes; moving from LAN to Tailscale is a
different IP and a token saved against the old host does not carry over.

It prefers the tailnet address when Tailscale is up, since that is the one that keeps
working when you leave the house.

**It binds to 127.0.0.1 until you change it.** Once Tailscale is up, set
`DESKPILOT_HOST=0.0.0.0` in the unit. This endpoint runs commands on your machine — it
must never face the internet.

The `--allow-run` allowlist is scoped to two scripts plus `tmux`, which is the reason
the server is Deno rather than Bun. Do not widen it to bare `--allow-run`.

**Rollback** — `systemctl --user disable --now deskpilot`.

---

## Step 5 — Remote unlock

**Not built yet**, and optional. Only needed because the screen locks after ~60 minutes
idle, and `grim` then returns a picture of the lock screen instead of your desktop
(tier 1 window state keeps working regardless).

Will require `ydotool`, which needs uinput access:

```bash
sudo pacman -S ydotool
sudo usermod -aG input $USER          # log out and back in
systemctl --user enable --now ydotool.service
```

`ydotool` rather than `wtype` because it writes to `/dev/uinput`, below the Wayland
layer, so hyprlock receives real keystrokes and validates them through PAM. Nothing is
bypassed. See decisions.md for why killing hyprlock was rejected.

**Before relying on this remotely, test it at the desk.** If the mechanism does not work
you are locked out of the GUI with only SSH as recourse — which is exactly why step 3
comes first.

---

## Order and why

1. Skill — useful immediately, needs nothing
2. tmux wrapper — everything remote sits on `send-keys`
3. Reachability — and the escape hatch that makes step 5 safe to experiment with
4. Server + web UI — the daily driver
5. Unlock — last, and only if the lock actually gets in your way

Steps 1, 2 and 4 are done. Step 3 is what makes any of it reachable from outside the
house, and it is the only remaining step that needs `sudo`.

Remote Control was evaluated and rejected — see decisions.md. It is not part of this
setup and you never need the Claude mobile app.
