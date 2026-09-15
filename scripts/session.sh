#!/bin/sh
# Open an explicitly remote-capable desktop terminal. This is deliberately a
# separate command: ordinary terminal shortcuts and shell startup files remain
# untouched, while this terminal begins inside a named tmux session that the
# phone can discover.

set -eu

name=${1:-desk}
[ "$#" -le 1 ] || { echo "usage: deskpilot session [NAME]" >&2; exit 2; }
case "$name" in
  "" | *[!A-Za-z0-9_.-]*)
    echo "session names may use letters, numbers, dot, dash and underscore" >&2
    exit 2
    ;;
esac
[ "${#name}" -le 64 ] || { echo "session name is too long" >&2; exit 2; }

terminal=${DESKPILOT_TERMINAL:-alacritty}
shell=${SHELL:-/bin/sh}
runner=${DESKPILOT_BIN:-deskpilot}

command -v "$terminal" >/dev/null 2>&1 \
  || { echo "$terminal not found — set DESKPILOT_TERMINAL in ~/.config/deskpilot/config" >&2; exit 1; }
command -v "$runner" >/dev/null 2>&1 \
  || { echo "$runner not found" >&2; exit 1; }
[ -x "$shell" ] || { echo "$shell is not an executable shell" >&2; exit 1; }

# The emulator is intentionally detached from this short-lived launcher. The
# tmux session keeps the login shell alive if its window closes, until the user
# exits the shell or ends the session in Deskpilot.
"$terminal" -e "$runner" run --name "$name" -- "$shell" -l >/dev/null 2>&1 &
echo "opening Deskpilot terminal ($name)"
