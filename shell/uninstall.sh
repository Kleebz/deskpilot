#!/bin/sh
#
# Remove a deskpilot install.
#
#   curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/uninstall.sh -o uninstall.sh
#   less uninstall.sh        # you are about to run this as root
#   sh uninstall.sh
#
# By default this removes the program and leaves your data alone: the token,
# the config and the recorded transcripts stay, so reinstalling puts you back
# where you were with every paired device still paired. --purge removes those
# too, and is the "start over" button.
#
# POSIX sh, not bash — same reason as install.sh: this ships as a release asset
# and may be the only thing standing between a headless box and a clean state.
#
# There was no uninstall path at all. Everything below was worked out by hand
# from install.sh and install-service.sh, which is exactly the job a person
# should not have to do to get a tool off their machine.

set -eu

REPO=Kleebz/deskpilot
BIN_DIR=${DESKPILOT_BIN_DIR:-/usr/bin}
SHARE_DIR=/usr/share/deskpilot
LICENSE_DIR=/usr/share/licenses/deskpilot
METHOD_FILE=$SHARE_DIR/install-method

UNIT_DIR="$HOME/.config/systemd/user"
CONFIG_DIR="$HOME/.config/deskpilot"
STATE_DIR="$HOME/.local/state/deskpilot"

PURGE=0
ASSUME_YES=0

say()  { printf '  %s\n' "$*"; }
die()  { printf '\n  %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<USAGE

  deskpilot uninstaller

    sh uninstall.sh              remove the program, keep token/config/transcripts
    sh uninstall.sh --purge      also remove them (start-over)
    sh uninstall.sh --yes        do not ask for confirmation

  Env: DESKPILOT_BIN_DIR (default /usr/bin), the same variable install.sh takes.

USAGE
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --purge)      PURGE=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    -h|--help)    usage ;;
    *)            die "unknown option: $arg (try --help)" ;;
  esac
done

# Refuse to walk over a package manager's files.
#
# The mirror of the same guard in install.sh, and for the same reason: deleting
# a pacman-owned binary leaves pacman believing it owns a file that is gone, so
# `pacman -Qkk` reports it missing and the next `-Syu` quietly puts it back.
# Read, never run `pacman -Qo` — this may be executing on a machine with no
# pacman at all.
owned_by_a_package() {
  if [ -r "$METHOD_FILE" ]; then
    [ "$(cat "$METHOD_FILE")" = pacman ] && return 0
    return 1
  fi
  [ -d /var/lib/pacman/local ] || return 1
  grep -qrs '^usr/bin/deskpilot$' /var/lib/pacman/local/*/files 2>/dev/null
}

if owned_by_a_package; then
  die "a package manager owns $BIN_DIR/deskpilot.
     Remove it the way you installed it:  sudo pacman -Rns deskpilot
     Then re-run this with --purge if you also want the token and transcripts gone."
fi

# Say what is about to happen before it happens. Anything absent is listed as
# such rather than skipped silently, because "it did not mention the token" and
# "it did not find a token" have to be distinguishable afterwards.
present() { [ -e "$1" ] && echo "$1" || echo "$1  (absent)"; }

echo
say "This will remove:"
say "  $(present "$BIN_DIR/deskpilot")"
say "  $(present "$SHARE_DIR")"
say "  $(present "$LICENSE_DIR")"
say "  $(present "$UNIT_DIR/deskpilot.service")"
say "  $(present "$UNIT_DIR/deskpilot.service.d")"
if [ "$PURGE" = 1 ]; then
  say "  $(present "$CONFIG_DIR")        <- token and config (--purge)"
  say "  $(present "$STATE_DIR")   <- recorded transcripts (--purge)"
else
  echo
  say "Keeping your data. Reinstalling restores every paired device:"
  say "  $CONFIG_DIR"
  say "  $STATE_DIR"
  say "Pass --purge to remove those too."
fi
echo

if [ "$ASSUME_YES" != 1 ]; then
  # A piped run (curl ... | sh) has the script itself on stdin, so `read` would
  # either eat the rest of this file or see EOF and read as a silent "yes".
  # Demand the flag instead of guessing which one happened.
  [ -t 0 ] || die "not running interactively — re-run with --yes to confirm.
     (Piping into sh leaves no terminal to ask on.)"
  printf '  Continue? [y/N] '
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo; say "nothing was changed"; exit 0 ;;
  esac
  echo
fi

# --- the user half: no privileges needed -----------------------------------
#
# Stop before deleting. A running service whose unit file has vanished stays
# running, un-stoppable by name, until the next logout — systemd cannot stop
# what it can no longer read.
if command -v systemctl >/dev/null; then
  if systemctl --user list-unit-files deskpilot.service >/dev/null 2>&1; then
    # KillMode=process means this stops the server and leaves the tmux server
    # and every session inside it alive. That is deliberate and it is also why
    # this does not claim to have closed anything.
    systemctl --user disable --now deskpilot.service 2>/dev/null || true
    say "service stopped and disabled"
  fi
  rm -rf "$UNIT_DIR/deskpilot.service" "$UNIT_DIR/deskpilot.service.d"
  # Older installs symlinked the unit into the repo and wrote their own wants/
  # entries; `disable` does not always reach those once the unit file is gone.
  rm -f "$UNIT_DIR/default.target.wants/deskpilot.service" \
        "$UNIT_DIR/graphical-session.target.wants/deskpilot.service"
  systemctl --user daemon-reload 2>/dev/null || true
  say "unit removed"
else
  say "no systemctl — skipping the service"
fi

if [ "$PURGE" = 1 ]; then
  rm -rf "$CONFIG_DIR" "$STATE_DIR"
  say "token, config and transcripts removed"
fi

# --- the root half ---------------------------------------------------------
#
# Ask for nothing if there is nothing to ask for. The user half above needs no
# privileges, so a run that got as far as sudo and stopped — no password, wrong
# password, no terminal to prompt on — leaves exactly this state: unit gone,
# root files still there. Re-running is the fix, and it must not demand a
# password only to delete three paths that are already absent.
if [ -e "$BIN_DIR/deskpilot" ] || [ -e "$SHARE_DIR" ] || [ -e "$LICENSE_DIR" ]; then
  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null || die "need root to remove $BIN_DIR/deskpilot — run as root or install sudo"
    SUDO=sudo
    say "removing $BIN_DIR/deskpilot and $SHARE_DIR (sudo)"
  fi
  # Not `set -e`'s job. Failing here means the user half is already done and the
  # root half is not, which is a recoverable state — but only if it is named.
  # Exiting on sudo's status alone prints nothing and looks like a crash.
  $SUDO rm -rf "$BIN_DIR/deskpilot" "$SHARE_DIR" "$LICENSE_DIR" || die "could not remove the installed files (sudo failed).
     The service is already stopped and its unit is gone; only these are left:
       $BIN_DIR/deskpilot
       $SHARE_DIR
       $LICENSE_DIR
     Finish with:  sudo rm -rf $BIN_DIR/deskpilot $SHARE_DIR $LICENSE_DIR
     Or re-run this script — it is safe to run again."
else
  say "nothing installed under $BIN_DIR or $SHARE_DIR"
fi

echo
say "deskpilot is uninstalled."
echo

# --- what this deliberately did not touch ----------------------------------
#
# Every one of these is shared with something else on the machine, so removing
# it here would be a surprise at best and a breakage at worst. Naming them is
# the job; undoing them is the user's call.
# Collected first, printed only if there is anything in it — a bare heading
# with nothing under it reads as "something was supposed to be here".
LEFTOVERS=""
note() { LEFTOVERS="$LEFTOVERS  * $1
"; }

if command -v tmux >/dev/null && tmux list-sessions >/dev/null 2>&1; then
  note "your tmux sessions — still running, still attachable ($(tmux list-sessions 2>/dev/null | wc -l) of them)"
fi
[ -e "$HOME/.claude/settings.json" ] && \
  note "~/.claude/settings.json — permission rules and hooks were merged in, not appended to a file of ours"
if command -v tailscale >/dev/null && tailscale serve status >/dev/null 2>&1; then
  note "tailscale serve — undo with:  tailscale serve reset"
fi
[ -e /etc/modules-load.d/uinput.conf ] && \
  note "/etc/modules-load.d/uinput.conf and your 'input' group membership (ydotool)"
[ "$PURGE" != 1 ] && \
  note "$CONFIG_DIR and $STATE_DIR — re-run with --purge to remove"

if [ -n "$LEFTOVERS" ]; then
  say "Not removed, because they are shared or were never ours alone:"
  printf '%s' "$LEFTOVERS"
  echo
fi

say "Sorry to see you go. If something drove you off, it is worth an issue:"
say "  https://github.com/$REPO/issues"
echo
