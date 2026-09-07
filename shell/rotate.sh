#!/usr/bin/env bash
#
# Replace this machine's shared token.
#
#   shell/rotate.sh [--yes]
#
# The shared token is the one credential nothing could take back. Every device
# paired before per-device credentials holds it, and pair.sh prints it into a
# URL and a QR whenever the service is not answering — so it leaks the way a URL
# leaks: into browser history, into a screenshot, into a photograph of a
# terminal. Revoking a device does nothing about a copy of this.
#
# Rotating it is the only way to make a leaked one stop working. Devices holding
# their own credential are unaffected; anything still on the shared token is
# locked out and has to pair again from this machine.
#
# The server cannot do this itself: its --allow-write is scoped to the state
# directory and the token lives under ~/.config. That scoping is deliberate —
# see the security section of the README — so this is a script you run, not an
# endpoint something can call.
#
# The binary install has the same thing as `deskpilot rotate`.

set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
CONF_DIR="$HOME/.config/deskpilot"
TOKEN_FILE="${DESKPILOT_TOKEN_FILE:-$CONF_DIR/token}"
PORT="${DESKPILOT_PORT:-8790}"

YES=0
for a in "$@"; do
  case "$a" in
    --yes|-y) YES=1 ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }

[ -f "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE — nothing to rotate" >&2; exit 1; }
CURRENT=$(tr -d '\n' < "$TOKEN_FILE")

# How many devices would survive. Unreachable is a different answer from zero
# and must not be reported as one: "every device will be locked out" is the
# sentence that decides whether someone goes ahead.
DEVICES=$(curl -s -m 4 -H "authorization: Bearer $CURRENT" \
  "http://127.0.0.1:$PORT/api/devices" 2>/dev/null || true)
if [ -z "$DEVICES" ]; then
  COUNT="unknown"
else
  COUNT=$(printf '%s' "$DEVICES" | grep -o '"id":' | wc -l | tr -d ' ')
fi

echo
bold "Rotating the shared token for this machine."
echo
dim  "  $TOKEN_FILE"
echo
case "$COUNT" in
  unknown)
    echo "  ! The server is not answering, so I cannot say how many devices hold"
    echo "    their own credential. Those survive; anything still on the shared"
    echo "    token will be locked out and has to pair again."
    ;;
  0)
    echo "  ! No device holds its own credential, so every paired device will be"
    echo "    locked out and has to pair again from this machine."
    ;;
  *)
    echo "  $COUNT device(s) hold their own credential and will keep working."
    echo "  Anything still on the shared token will be locked out and has to pair"
    echo "  again — the app's devices list is what says which is which."
    ;;
esac
echo

if [ "$YES" -ne 1 ]; then
  [ -t 0 ] || { echo "not a terminal, and this locks devices out — re-run with --yes" >&2; exit 1; }
  printf '  Rotate it? [y/N] '
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "  left alone"; exit 1 ;;
  esac
fi

# Staged beside the destination and renamed. An interruption partway through a
# direct write leaves a truncated token, which locks out everything including
# whatever you would use to fix it.
mkdir -p "$CONF_DIR"
NEW=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
[ ${#NEW} -eq 64 ] || { echo "could not generate a token" >&2; exit 1; }
umask 077
printf '%s\n' "$NEW" > "$TOKEN_FILE.new"
chmod 600 "$TOKEN_FILE.new"
mv -f "$TOKEN_FILE.new" "$TOKEN_FILE"

echo
bold "  rotated"
echo
bold "The old token keeps working until the service restarts:"
echo
echo "  systemctl --user restart deskpilot"
echo
dim  "Your tmux sessions survive that. Devices with their own credential"
dim  "reconnect on their own; anything else gets the pairing screen and needs a"
dim  "fresh code from  shell/pair.sh."
echo
