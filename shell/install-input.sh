#!/usr/bin/env bash
#
# Finish the ydotool setup so Claude can type and click on the desktop.
#
#   sudo -v && ~/Projects/deskpilot/shell/install-input.sh
#
# `pacman -S ydotool` and adding yourself to the `input` group are not enough
# on their own, which is the usual confusion:
#
#   * the `uinput` kernel module is not loaded by default
#   * the udev rule the package ships (/usr/lib/udev/rules.d/80-uinput.rules)
#     only takes effect after a udev reload or a reboot, so /dev/uinput stays
#     root-only 0600 and every ydotool call fails with a permission error
#
# This does both, persists the module across reboots, and starts the daemon.
# Needs sudo for the first three steps; the daemon is a --user unit.

set -euo pipefail

say() { printf '  %s\n' "$*"; }

echo "ydotool setup"

if ! command -v ydotoold >/dev/null; then
  echo "ydotoold not installed — run: sudo pacman -S ydotool" >&2
  exit 1
fi

if ! id -nG | tr ' ' '\n' | grep -qx input; then
  echo "you are not in the 'input' group — run:" >&2
  echo "  sudo usermod -aG input $USER    # then log out and back in" >&2
  exit 1
fi

# 1. module, now and at every boot
if ! lsmod | grep -qw uinput; then
  sudo modprobe uinput
  say "loaded uinput module"
else
  say "uinput module already loaded"
fi
if [ ! -f /etc/modules-load.d/uinput.conf ]; then
  echo uinput | sudo tee /etc/modules-load.d/uinput.conf >/dev/null
  say "persisted uinput across reboots"
fi

# 2. apply the udev rule that grants the input group access
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=uinput || true
sleep 1
perms=$(stat -c '%a %U:%G' /dev/uinput 2>/dev/null || echo "missing")
say "/dev/uinput is $perms"
case "$perms" in
  66[06]\ root:input) say "permissions correct" ;;
  *) echo "  /dev/uinput is still not group-accessible. A reboot usually fixes this." >&2 ;;
esac

# 3. the daemon
systemctl --user enable --now ydotool
sleep 1
if systemctl --user is-active --quiet ydotool; then
  say "ydotoold running"
else
  echo "  ydotoold failed to start:" >&2
  systemctl --user status ydotool --no-pager -n 12 >&2 || true
  exit 1
fi

echo
echo "Test it (this types into whatever window has focus, so pick a scratch one):"
echo "  ~/Projects/deskpilot/scripts/desk.sh type 'hello from ydotool'"
