#!/usr/bin/env bash
#
# Show a QR code that pairs a phone with deskpilot in one scan.
#
#   shell/pair.sh              pick the best address automatically
#   shell/pair.sh 100.x.y.z    force a specific host
#
# The QR encodes the URL *with the token*, and the page stores it and strips it
# from the URL immediately, so nothing lingers in phone history. Typing a
# 64-character hex token on glass is the alternative; this exists so you never
# have to.
#
# Re-run this whenever the address changes — moving from LAN to Tailscale gives
# the machine a different IP, and a token saved against the old host does not
# carry over.

set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
TOKEN_FILE="$HOME/.config/deskpilot/token"
PORT="${DESKPILOT_PORT:-8790}"

[ -f "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE — run install-service.sh first" >&2; exit 1; }
TOKEN=$(tr -d '\n' < "$TOKEN_FILE")

pick_host() {
  [ $# -gt 0 ] && { printf '%s' "$1"; return; }
  # Prefer the tailnet: if it is up, that is the address that works from
  # anywhere, and the LAN one silently stops working the moment you leave.
  if command -v tailscale >/dev/null; then
    ts=$(tailscale ip -4 2>/dev/null | head -1 || true)
    [ -n "$ts" ] && { printf '%s' "$ts"; return; }
  fi
  ip -4 -o addr show scope global 2>/dev/null \
    | awk '{split($4,a,"/"); print a[1]; exit}'
}

HOST=$(pick_host "$@")
[ -n "$HOST" ] || { echo "could not determine an address; pass one explicitly" >&2; exit 1; }

# Prefer the HTTPS name when Tailscale Serve is fronting the app: it is on 443
# with no port, and it is the only origin browsers treat as secure — which is
# what makes the app installable.
BASE="http://${HOST}:${PORT}"
if command -v tailscale >/dev/null; then
  SERVED=$(tailscale serve status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9.-]+' | head -1)
  if [ -n "$SERVED" ] && curl -s -m 8 -o /dev/null "$SERVED/"; then
    BASE="$SERVED"
  fi
fi
URL="${BASE}/?token=${TOKEN}"

if ! systemctl --user is-active --quiet deskpilot; then
  echo "warning: the deskpilot service is not running" >&2
fi

# Check the server is actually reachable on this address before handing out a
# QR that will not load.
if ! curl -s -m 8 -o /dev/null "${BASE}/"; then
  echo "warning: nothing answered at ${BASE}/" >&2
  echo "         if this is a new interface, the firewall may need a rule:" >&2
  echo "         sudo ufw allow from <subnet> to any port ${PORT} proto tcp" >&2
fi

echo
if command -v qrencode >/dev/null; then
  qrencode -t ANSIUTF8 -m 1 "$URL"
elif command -v deno >/dev/null; then
  # No system package needed; deno caches the module after the first run.
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  cat > "$TMP/qr.ts" <<'EOF'
import QR from "npm:qrcode-terminal@0.12.0";
QR.generate(Deno.args[0], { small: true }, (s: string) => console.log(s));
EOF
  deno run --quiet --allow-net --allow-env --allow-read "$TMP/qr.ts" "$URL" 2>/dev/null \
    || echo "(could not render a QR — use the URL below)"
else
  echo "(install qrencode for a QR code, or use the URL below)"
fi

echo
echo "  $URL"
echo
echo "Scan it, then add the page to your home screen. The token is stored in a"
echo "one-year cookie as well as localStorage, so you only do this once per host."
