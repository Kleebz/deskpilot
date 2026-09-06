#!/bin/sh
#
# Install deskpilot from the latest release.
#
#   curl -fsSL https://github.com/Kleebz/deskpilot/releases/latest/download/install.sh -o install.sh
#   less install.sh          # you are about to run this as root
#   sh install.sh
#
# Piping straight into a shell works too, and is the convenience form for people
# who have already decided to trust this. It is not the form suggested first: a
# tool that runs arbitrary commands on your machine is a poor candidate for
# "execute code you have not read".
#
# POSIX sh, not bash — a headless box may not have bash, and the portable half
# of this project is meant to run on machines that have very little.

set -eu

REPO=Kleebz/deskpilot
BIN_DIR=${DESKPILOT_BIN_DIR:-/usr/bin}
# Not a preference. The binary's subprocess allowlist is fixed when it is
# compiled, so this is the only path it may execute desk.sh from — a copy
# anywhere else is found and then refused, which looks exactly like "this
# machine has no compositor".
SCRIPTS_DIR=/usr/share/deskpilot/scripts
# How this copy got here, so `deskpilot update` can tell whether it is allowed
# to replace it. The package writes "pacman" into the same file.
METHOD_FILE=/usr/share/deskpilot/install-method

say()  { printf '  %s\n' "$*"; }
die()  { printf '\n  %s\n' "$*" >&2; exit 1; }

# Refuse to walk over a package manager's file.
#
# Installing on top of a pacman-owned binary leaves a file pacman still believes
# it owns: `pacman -Qkk` reports a mismatch and the next `pacman -Syu` quietly
# puts the old version back — days later, with nothing connecting the two. The
# marker is checked first because it is exact and costs nothing; the package
# database is the fallback for a copy installed before the marker existed.
#
# Read, never run: `pacman -Qo` would be cleaner and this file may be executing
# on a machine that has no pacman at all.
owned_by_a_package() {
  if [ -r "$METHOD_FILE" ]; then
    [ "$(cat "$METHOD_FILE")" = pacman ] && return 0
    return 1
  fi
  [ -d /var/lib/pacman/local ] || return 1
  grep -qrs '^usr/bin/deskpilot$' /var/lib/pacman/local/*/files 2>/dev/null
}

command -v curl >/dev/null || die "curl is required"
command -v tar  >/dev/null || die "tar is required"

case "$(uname -m)" in
  x86_64) ;;
  *) die "no build for $(uname -m) yet — only x86_64. Build from source: github.com/$REPO" ;;
esac
[ "$(uname -s)" = Linux ] || die "deskpilot is Linux-only (it drives tmux and, optionally, a Wayland compositor)"

command -v tmux >/dev/null || say "note: tmux is not installed, and it is the one hard requirement"

# What is already here, so this can say what changed rather than just "installed".
OLD=""
[ -x "$BIN_DIR/deskpilot" ] && OLD=$("$BIN_DIR/deskpilot" version 2>/dev/null || true)

if owned_by_a_package; then
  [ "${DESKPILOT_FORCE:-0}" = 1 ] || die "a package manager owns $BIN_DIR/deskpilot.
     Update it the way you installed it:  pacman -Syu
     (DESKPILOT_FORCE=1 overrides this, and you will own the result.)"
  say "warning: overwriting a package-managed install because DESKPILOT_FORCE=1"
fi

VERSION=${DESKPILOT_VERSION:-latest}
if [ "$VERSION" = latest ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/v$VERSION"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

echo
say "downloading from $BASE"
# The tarball carries its version in the name, which `latest` cannot know. The
# checksum file has a fixed name and contains the real one, so one predictable
# fetch resolves both the filename and what it should hash to.
curl -fsSL -o sums "$BASE/deskpilot-checksums.txt" \
  || die "could not fetch deskpilot-checksums.txt — install by hand: github.com/$REPO/releases"
TARBALL=$(awk '{print $2}' sums | head -1 | sed 's|^\*||')
[ -n "$TARBALL" ] || die "the checksum file named no archive"

curl -fsSL -o "$TARBALL" "$BASE/$TARBALL" || die "could not download $TARBALL"

say "verifying"
if command -v sha256sum >/dev/null; then
  WANT=$(awk '{print $1}' sums | head -1)
  GOT=$(sha256sum "$TARBALL" | awk '{print $1}')
  [ "$WANT" = "$GOT" ] || die "checksum mismatch — refusing to install
     expected $WANT
     got      $GOT"
  say "sha256 ok"
else
  say "sha256sum not available — SKIPPING verification (install it and re-run to check)"
fi

tar xzf "$TARBALL"
[ -f deskpilot ] || die "the archive did not contain a binary"

# Root only for the two install steps. Everything after runs as the user, and
# the service is a --user unit that needs no privileges at all.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "need root to write $BIN_DIR — run as root or install sudo"
  SUDO=sudo
  say "installing to $BIN_DIR and $SCRIPTS_DIR (sudo)"
fi

$SUDO install -Dm755 deskpilot "$BIN_DIR/deskpilot"
$SUDO install -Dm755 scripts/desk.sh "$SCRIPTS_DIR/desk.sh"
$SUDO install -Dm755 scripts/sessions.sh "$SCRIPTS_DIR/sessions.sh"
[ -f LICENSE ] && $SUDO install -Dm644 LICENSE /usr/share/licenses/deskpilot/LICENSE
printf 'installer\n' | $SUDO tee "$METHOD_FILE" >/dev/null

NEW=$("$BIN_DIR/deskpilot" version)
echo

# An upgrade and a first install need different next steps, and giving someone
# the wrong one is worse than giving them none. Replacing the file does not
# disturb the process already running — it holds the old inode open until
# something restarts it — so an upgrade that stops here looks like it worked and
# has changed nothing.
if [ -n "$OLD" ] && [ "$OLD" = "$NEW" ]; then
  # Re-running the installer when there is nothing newer is a normal thing to
  # do, and "updated X -> X" reads like a bug in the installer.
  say "already at $NEW — reinstalled the same version"
  echo
  say "Nothing to restart unless you want to: the running service is this build."
elif [ -n "$OLD" ]; then
  say "updated  $OLD -> $NEW"
  echo
  say "Restart it to actually run the new one:"
  say "  systemctl --user restart deskpilot"
  echo
  say "Your tmux sessions survive that. Nothing else needs doing — the token,"
  say "the service file and every paired device are untouched."
else
  say "installed $NEW"
  echo
  say "Next:"
  say "  deskpilot setup"
  say "  systemctl --user daemon-reload && systemctl --user enable --now deskpilot"
  say "  deskpilot pair"
  echo
  say "Remote unlock stays off until you set DESKPILOT_UNLOCK=1."
fi
echo
