#!/usr/bin/env bash
#
# Install the deskpilot user service.
#
#   shell/install-service.sh          localhost only  (safe default)
#   shell/install-service.sh --lan    also reachable from your home wifi
#
# No sudo. This is a systemd --user unit.
#
# --lan writes a drop-in at
#   ~/.config/systemd/user/deskpilot.service.d/local.conf
# which is NOT in git, so the repo default stays 127.0.0.1. Delete that file
# and restart to go back.
#
# What --lan actually means: anything on your home network that can reach port
# 8790 gets to try the bearer token. The token is the only thing between a
# device on your wifi and a process that runs commands as you. That is an
# acceptable trade for testing from your own phone, and NOT acceptable on a
# network you do not control. Never port-forward this.

set -euo pipefail

REPO="$(dirname "$(readlink -f "$0")")/.."
REPO="$(cd "$REPO" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
TOKEN="$HOME/.config/deskpilot/token"

command -v deno >/dev/null || { echo "deno is required"; exit 1; }

if [ ! -f "$TOKEN" ]; then
  mkdir -p "$(dirname "$TOKEN")"
  openssl rand -hex 32 > "$TOKEN"
  chmod 600 "$TOKEN"
  echo "generated $TOKEN"
fi

mkdir -p "$UNIT_DIR"
ln -sf "$REPO/systemd/deskpilot.service" "$UNIT_DIR/deskpilot.service"

DROPIN="$UNIT_DIR/deskpilot.service.d/local.conf"
if [ "${1:-}" = "--lan" ]; then
  mkdir -p "$(dirname "$DROPIN")"
  cat > "$DROPIN" <<'EOF'
# Local override, not in git. Binds beyond localhost so a phone on the same
# wifi can reach it. Delete this file and restart to return to 127.0.0.1.
[Service]
Environment=DESKPILOT_HOST=0.0.0.0
EOF
  echo "LAN binding enabled via $DROPIN"
else
  rm -f "$DROPIN"
  echo "localhost only (pass --lan to expose on your home network)"
fi

systemctl --user daemon-reload
systemctl --user enable --now deskpilot
sleep 2

if ! systemctl --user is-active --quiet deskpilot; then
  echo
  echo "service failed to start:"
  systemctl --user status deskpilot --no-pager -n 20 || true
  exit 1
fi

echo
echo "deskpilot is running."
if [ "${1:-}" = "--lan" ]; then
  ip -4 -o addr show scope global 2>/dev/null \
    | awk '{split($4,a,"/"); print "  open on your phone:  http://" a[1] ":8790"}'
else
  echo "  open here:  http://localhost:8790"
fi
echo "  token:      $(cat "$TOKEN")"
echo
echo "Stop with:  systemctl --user stop deskpilot"
echo "Remove:     systemctl --user disable --now deskpilot"
