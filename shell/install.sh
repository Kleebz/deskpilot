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

say()  { printf '  %s\n' "$*"; }
die()  { printf '\n  %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v tar  >/dev/null || die "tar is required"

case "$(uname -m)" in
  x86_64) ;;
  *) die "no build for $(uname -m) yet — only x86_64. Build from source: github.com/$REPO" ;;
esac
[ "$(uname -s)" = Linux ] || die "deskpilot is Linux-only (it drives tmux and, optionally, a Wayland compositor)"

command -v tmux >/dev/null || say "note: tmux is not installed, and it is the one hard requirement"

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

echo
say "installed $("$BIN_DIR/deskpilot" version)"
echo
say "Next:"
say "  deskpilot setup"
say "  systemctl --user daemon-reload && systemctl --user enable --now deskpilot"
say "  deskpilot pair"
echo
say "Remote unlock stays off until you set DESKPILOT_UNLOCK=1."
echo
