#!/usr/bin/env bash
#
# Preflight. Checks every assumption deskpilot makes and tells you how to fix
# what is missing.
#
#   ~/Projects/deskpilot/shell/check.sh
#
# This exists because the failures in this project have overwhelmingly been
# SILENT: /dev/uinput at 0600, a udev rule that had not been applied, tmux
# killed by a service restart, an API response cached by the browser. Each
# looked like something else. A checklist turns those into one line of output.
#
# Exit 0 if everything essential passes. Optional items never fail the run.

set -uo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
CONF="${DESKPILOT_CONFIG:-$HOME/.config/deskpilot/config}"
[ -f "$CONF" ] && . "$CONF"

TERMINAL="${DESKPILOT_TERMINAL:-alacritty}"
LOCKPROC="${DESKPILOT_LOCK_PROCESS:-hyprlock}"
PORT="${DESKPILOT_PORT:-8790}"

fails=0
warns=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n     → %s\n' "$1" "$2"; fails=$((fails+1)); }
warn() { printf '  \033[33m!\033[0m %s\n     → %s\n' "$1" "$2"; warns=$((warns+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head_ "Build"
if v=$(curl -s -m 3 "http://127.0.0.1:${PORT}/api/capabilities" \
        -H "authorization: Bearer $(cat "$HOME/.config/deskpilot/token" 2>/dev/null | tr -d '\n')" \
        2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p') && [ -n "$v" ]; then
  ok "deskpilot version $v (running)"
else
  git_sha=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
  warn "could not ask the running service its version" "checkout is at $git_sha"
fi

head_ "Core tools"
for c in tmux jq grim hyprctl; do
  if command -v "$c" >/dev/null; then ok "$c"
  else bad "$c missing" "install it — deskpilot cannot work without it"; fi
done
command -v deno >/dev/null && ok "deno" || bad "deno missing" "needed by the server: install deno"
command -v npm  >/dev/null && ok "npm"  || warn "npm missing" "needed only to build the web UI"

head_ "Compositor"
if [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
  ok "Hyprland instance in this shell"
elif [ -d "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/hypr" ]; then
  warn "no HYPRLAND_INSTANCE_SIGNATURE here, but an instance exists" \
       "fine — the scripts recover it themselves"
else
  bad "no Hyprland instance found" \
      "deskpilot's desktop half is Hyprland-specific (hyprctl, workspaces)"
fi
if command -v hyprctl >/dev/null && hyprctl version >/dev/null 2>&1; then
  ok "hyprctl responds ($(hyprctl version 2>/dev/null | head -1 | cut -d' ' -f1-2))"
fi

head_ "Session environment"
if systemctl --user show-environment 2>/dev/null | grep -q WAYLAND_DISPLAY; then
  ok "systemd user manager has the Wayland environment"
else
  bad "systemd user manager lacks WAYLAND_DISPLAY" \
      "the service will start but hyprctl and grim will fail inside it. On uwsm
       systems this is imported automatically; otherwise add:
       systemctl --user import-environment WAYLAND_DISPLAY HYPRLAND_INSTANCE_SIGNATURE"
fi

head_ "Lock detection"
# Ask desk.sh rather than probing for a binary. This check used to look for
# $LOCKPROC and warn if it was missing — which is exactly what happened when
# Omarchy dropped hyprlock, and a warning was quiet enough that unlock and the
# capture guard stayed broken for days. A detector that cannot answer is a
# failure, not a warning: captures refuse and unlock refuses.
lock_now=$("$REPO/scripts/desk.sh" locked 2>/dev/null)
case "$lock_now" in
  locked|unlocked)
    ok "lock state readable (currently $lock_now)" ;;
  *)
    bad "cannot determine lock state" \
        "no compositor lock helper and no '$LOCKPROC' process — captures and unlock both refuse" ;;
esac

head_ "tmux"
# deskpilot needs no tmux configuration — verified against each non-default
# setting this machine happened to have. detach-on-destroy is handled by setting
# it on the target before a kill, `mouse` stopped mattering when scrollback moved
# into the client, and history-limit only has to be non-zero.
#
# The single exception is window-size manual, which pins a window to a fixed
# size and makes tmux ignore what a client asks for — so the phone's resize is
# silently discarded and the terminal renders at the desk's width forever.
# Measured: latest, smallest and largest all honour it; manual does not.
wsize=$(tmux show -gv window-size 2>/dev/null || echo latest)
if [ "$wsize" = manual ]; then
  bad "window-size is manual" \
      "the phone cannot resize the terminal; set it to latest in your tmux.conf"
else
  ok "window-size $wsize (phone can resize the terminal)"
fi

head_ "Terminal"
if command -v "$TERMINAL" >/dev/null; then ok "$TERMINAL"
else bad "$TERMINAL not found" "set DESKPILOT_TERMINAL in the config to one you have"; fi

head_ "Input (optional — needed for remote unlock and typing)"
if command -v ydotool >/dev/null; then
  ok "ydotool installed"
  # Test what actually matters — can we write to the device — rather than
  # whether uinput is a loaded module. It may be built into the kernel, and
  # opening the node can autoload it, so lsmod answers the wrong question.
  if [ -w /dev/uinput ]; then
    ok "/dev/uinput writable ($(stat -c '%a %G' /dev/uinput 2>/dev/null))"
  elif [ -e /dev/uinput ]; then
    warn "/dev/uinput exists but is not writable by you ($(stat -c '%a %U:%G' /dev/uinput))" \
         "run shell/install-input.sh"
  else
    warn "/dev/uinput missing" "run shell/install-input.sh"
  fi
  id -nG | tr ' ' '\n' | grep -qx input && ok "in the input group" \
    || warn "not in the input group" "sudo usermod -aG input $USER, then log out and back in"
  systemctl --user is-active --quiet ydotool && ok "ydotoold running" \
    || warn "ydotoold not running" "systemctl --user enable --now ydotool"
else
  warn "ydotool not installed" "optional: needed only for remote unlock and typing"
fi

head_ "Shell integration"
if grep -qs "deskpilot/shell/claude-tmux.sh" "$HOME/.bashrc" 2>/dev/null; then
  ok "tmux wrapper sourced from ~/.bashrc"
else
  warn "tmux wrapper not sourced" \
       "echo 'source $REPO/shell/claude-tmux.sh' >> ~/.bashrc
       (without it, agents you start by hand are not reachable from the phone)"
fi
[ -n "${BASH_VERSION:-}" ] || warn "not running bash" \
  "the wrapper is bash/zsh syntax; fish users need to port it"

head_ "Service"
[ -f "$HOME/.config/deskpilot/token" ] && ok "token present" \
  || warn "no token" "run shell/install-service.sh"
if [ -f "$REPO/web/dist/index.html" ]; then ok "web UI built"
else bad "web UI not built" "cd $REPO/web && npm install && npm run build"; fi
if systemctl --user is-active --quiet deskpilot; then
  ok "deskpilot running"
  km=$(systemctl --user show deskpilot -p KillMode --value 2>/dev/null)
  [ "$km" = "process" ] && ok "KillMode=process (restarts will not kill tmux)" \
    || bad "KillMode=$km" "tmux runs as a child of this unit; anything but 'process'
       kills every session on restart. Re-link the unit and daemon-reload."
else
  warn "deskpilot not running" "run shell/install-service.sh"
fi

head_ "Tests"
if command -v deno >/dev/null; then
  if deno test --quiet --allow-read --allow-write --allow-env "$REPO/tests/" >/dev/null 2>&1; then
    ok "test suite passes"
  else
    bad "test suite fails" "run: deno test --allow-read --allow-write --allow-env tests/"
  fi
else
  warn "deno not found" "cannot run the test suite"
fi

head_ "Reachability"
if command -v tailscale >/dev/null && systemctl is-active --quiet tailscaled 2>/dev/null; then
  ts=$(tailscale ip -4 2>/dev/null | head -1)
  [ -n "$ts" ] && ok "tailnet address $ts" || warn "tailscaled up but not logged in" "tailscale up"
else
  warn "Tailscale not running" "optional: needed to reach this from outside the house"
fi
if command -v ufw >/dev/null && sudo -n ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo -n ufw status 2>/dev/null | grep -q "$PORT" \
    && ok "ufw has a rule for port $PORT" \
    || warn "ufw is active with no rule for $PORT" "nothing will reach the server"
fi

printf '\n'
if [ "$fails" -gt 0 ]; then
  printf '\033[31m%s essential check(s) failed\033[0m, %s warning(s)\n' "$fails" "$warns"
  exit 1
fi
printf '\033[32mAll essential checks passed\033[0m'
[ "$warns" -gt 0 ] && printf ', %s warning(s)' "$warns"
printf '\n'
