#!/usr/bin/env bash
#
# Move deskpilot from "reachable on my home wifi" to "reachable from anywhere,
# and nowhere else".
#
#   ~/Projects/deskpilot/shell/use-tailscale.sh
#
# Run it in a real terminal — it needs a sudo password for the firewall rules.
#
# What it changes, and why this shape:
#
#   * ufw gains `allow in on tailscale0`, and the LAN rule is removed. The
#     firewall, not the bind address, is what enforces reachability — a tailnet
#     IP can change, and a service that fails to start because its bind address
#     moved is a worse outcome than one the firewall protects.
#   * With the LAN rule gone the port is closed on every other interface,
#     including whatever wifi you join next. That is the actual win: today the
#     endpoint answers anyone on your home network.
#   * The service keeps binding 0.0.0.0. Combined with the above that means
#     tailnet-only, without a restart every time Tailscale renumbers.
#
# Afterwards the address changes, so the phone must re-pair — the script ends
# by showing the new QR.

set -euo pipefail

PORT="${DESKPILOT_PORT:-8790}"
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"

say() { printf '  %s\n' "$*"; }

command -v tailscale >/dev/null || { echo "tailscale not installed" >&2; exit 1; }

if ! systemctl is-active --quiet tailscaled; then
  echo "tailscaled is not running. In a terminal:" >&2
  echo "  sudo systemctl enable --now tailscaled" >&2
  echo "  tailscale up" >&2
  exit 1
fi

TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
if [ -z "$TS_IP" ]; then
  echo "tailscale is running but this machine has no tailnet address yet." >&2
  echo "Run:  tailscale up" >&2
  exit 1
fi
say "tailnet address: $TS_IP"

if ! tailscale status --peers=false >/dev/null 2>&1; then
  say "warning: tailscale status looks unhealthy"
fi

# --- firewall -------------------------------------------------------------
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  if ! sudo ufw status | grep -q "tailscale0.*${PORT}"; then
    sudo ufw allow in on tailscale0 to any port "$PORT" proto tcp comment 'deskpilot tailnet'
    say "allowed port $PORT on tailscale0"
  else
    say "tailscale0 rule already present"
  fi

  # Drop LAN rules for this port. Deleting by number shifts the list, so
  # collect first and delete highest-first.
  mapfile -t nums < <(sudo ufw status numbered \
    | grep -E "${PORT}/tcp" | grep -v tailscale0 \
    | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/' | sort -rn)
  if [ ${#nums[@]} -gt 0 ]; then
    for n in "${nums[@]}"; do sudo ufw --force delete "$n"; done
    say "removed ${#nums[@]} LAN rule(s) for port $PORT — it is now tailnet-only"
  else
    say "no LAN rules for port $PORT to remove"
  fi
else
  say "ufw not active — skipping firewall changes"
  say "NOTE: without a firewall the port is open on every interface you join"
fi

# --- service --------------------------------------------------------------
systemctl --user restart deskpilot
sleep 2
systemctl --user is-active --quiet deskpilot \
  && say "deskpilot restarted" \
  || { echo "  deskpilot failed to start" >&2; systemctl --user status deskpilot --no-pager -n 15; exit 1; }

if curl -s -m 4 -o /dev/null "http://${TS_IP}:${PORT}/"; then
  say "reachable on the tailnet address"
else
  say "warning: no answer on http://${TS_IP}:${PORT}/"
fi

echo
echo "Re-pair the phone — the address changed, so the saved token does not apply:"
echo
"$REPO/shell/pair.sh" "$TS_IP"
echo
echo "Then test it properly: turn OFF wifi on the phone and load it over cellular."
echo "Testing on wifi proves nothing — you would still be on the LAN."
