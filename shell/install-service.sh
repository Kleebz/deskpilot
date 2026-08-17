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
CONF="$HOME/.config/deskpilot/config"
[ -f "$CONF" ] && . "$CONF"

command -v deno >/dev/null || { echo "deno is required"; exit 1; }

if [ ! -f "$TOKEN" ]; then
  mkdir -p "$(dirname "$TOKEN")"
  openssl rand -hex 32 > "$TOKEN"
  chmod 600 "$TOKEN"
  echo "generated $TOKEN"
fi

mkdir -p "$UNIT_DIR"

# The unit is generated rather than shipped, because it has to name absolute
# paths — WorkingDirectory, the scoped --allow-run list, the script itself.
# A checked-in unit with a hardcoded ~/Projects/deskpilot silently fails to
# start for anyone who cloned somewhere else.
# Remove first: earlier versions symlinked this into the repo, and `cat >`
# follows a symlink and writes to its target. That silently resurrected a file
# that had been deleted from the repo, and left a dangling link when it was
# deleted again.
rm -f "$UNIT_DIR/deskpilot.service" \
      "$UNIT_DIR/graphical-session.target.wants/deskpilot.service" \
      "$UNIT_DIR/default.target.wants/deskpilot.service"

cat > "$UNIT_DIR/deskpilot.service" <<UNIT
[Unit]
Description=deskpilot — phone-facing control server for the desktop
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$REPO
Environment=DESKPILOT_HOST=${DESKPILOT_HOST:-127.0.0.1}
Environment=DESKPILOT_PORT=${DESKPILOT_PORT:-8790}

# --allow-run is scoped to two scripts, tmux, and script(1) — the last only
# because Deno has no PTY and \`script\` provides one for the terminal endpoint.
# This is why the server is Deno rather than Bun: adding a subprocess is a
# deliberate act, and an injection bug still cannot reach rm, ssh or curl.
#
# --allow-write is scoped to one directory, and that directory holds nothing
# but recorded transcripts. The server had no write permission at all before
# the recorder existed; keeping the grant this narrow means it still cannot
# touch the repo, the token, or anything else in \$HOME.
ExecStart=$(command -v deno) run \\
  --allow-net \\
  --allow-read \\
  --allow-env \\
  --allow-write=$HOME/.local/state/deskpilot \\
  --allow-run=$REPO/scripts/desk.sh,$REPO/scripts/sessions.sh,tmux,script \\
  $REPO/server/server.ts

# CRITICAL: tmux new-session starts the tmux *server* as a child of this
# process, so it joins this unit's cgroup. The default KillMode=control-group
# would kill the tmux server — and every session in it — on any restart.
KillMode=process

Restart=on-failure
RestartSec=2

[Install]
WantedBy=graphical-session.target
UNIT

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
systemctl --user enable deskpilot
# restart, not just start: `--now` leaves an already-running instance alone, so
# a regenerated unit silently keeps the old permissions and paths.
systemctl --user restart deskpilot
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
