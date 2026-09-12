#!/usr/bin/env bash
#
# Show a QR code that pairs a phone with deskpilot in one scan.
#
#   shell/pair.sh              print a QR and complete pairing link
#   shell/pair.sh --link       print only the complete link
#   shell/pair.sh 100.x.y.z    force a specific host
#
# The QR encodes the address and a one-time code together, and the page strips
# the code from the URL as soon as it has exchanged it, so nothing lingers in
# phone history. Typing an address and a code on glass is the alternative; this
# exists so you never have to.
#
# Re-run this whenever the address changes — moving from LAN to Tailscale gives
# the machine a different IP, and a token saved against the old host does not
# carry over.

set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
TOKEN_FILE="$HOME/.config/deskpilot/token"
PORT="${DESKPILOT_PORT:-8790}"
LINK_ONLY=0
HOST=""

for arg in "$@"; do
  case "$arg" in
    --link) LINK_ONLY=1 ;;
    -*) echo "usage: $0 [--link] [host]" >&2; exit 1 ;;
    *)
      [ -z "$HOST" ] || { echo "usage: $0 [--link] [host]" >&2; exit 1; }
      HOST="$arg"
      ;;
  esac
done

[ -f "$TOKEN_FILE" ] || { echo "no token at $TOKEN_FILE — run install-service.sh first" >&2; exit 1; }
TOKEN=$(tr -d '\n' < "$TOKEN_FILE")

# The address comes from desk.sh, which is also what the packaged binary's
# `deskpilot pair` asks — two copies of this logic had already been written and
# only one of them checked that the address answers. An argument still wins, so
# forcing a specific host stays possible.
if [ -n "$HOST" ]; then
  case "$HOST" in
    http://*|https://*) BASE="$HOST" ;;
    *)                  BASE="http://$HOST:${PORT}" ;;
  esac
else
  BASE=$("$REPO/scripts/desk.sh" addr "$PORT" 2>/dev/null || true)
fi

if [ -z "${BASE:-}" ]; then
  echo "no address answered on this machine." >&2
  echo "deskpilot listens on loopback, so something has to front it:" >&2
  echo >&2
  echo "    tailscale serve --bg --yes ${PORT}" >&2
  echo >&2
  echo "then re-run this. Or pass an address explicitly: $0 <host>" >&2
  exit 1
fi

# Ask the server for a one-time enrolment code rather than handing over the
# machine's own token. The token cannot be revoked without re-pairing every
# device; a code mints a credential belonging to this device alone, so losing a
# phone costs you that phone.
#
# Falls back to the token if the server is not answering — pairing a machine
# whose service is down is a worse failure than pairing it the old way, and the
# old way is exactly what every already-paired device is using.
# Ask the port we are actually pairing against rather than checking the service
# unit: they are the same thing in normal use and not when PORT is overridden.
CODE=$(curl -s -m 5 -X POST "http://127.0.0.1:${PORT}/api/devices/code" \
  -H "authorization: Bearer ${TOKEN}" 2>/dev/null \
  | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')

if [ -n "$CODE" ]; then
  URL="${BASE}/?code=${CODE}"
else
  URL="${BASE}/?token=${TOKEN}"
fi

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

# One clean value for agents, scripts and remote shells to relay. The code is
# already in the URL, so callers should not present it as a second input.
if [ "$LINK_ONLY" = 1 ]; then
  echo "$URL"
  exit 0
fi

echo
if command -v qrencode >/dev/null; then
  qrencode -t ANSIUTF8 -m 1 "$URL"
elif command -v deno >/dev/null; then
  # The same renderer the packaged binary uses, so a checkout and a package
  # draw the same code rather than two that differ in polarity or quiet zone.
  # The URL goes through the environment rather than argv: it carries a
  # single-use code, and argv is world-readable in /proc.
  DP_QR_URL="$URL" deno run --quiet --allow-env=DP_QR_URL \
    "$REPO/shell/qr.ts" 2>/dev/null \
    || echo "(could not render a QR — use the URL below)"
else
  echo "(install qrencode for a QR code, or use the URL below)"
fi

echo
echo "  $URL"
echo
# Said before the "scan it" line, because it is the step that has to happen
# first. A device that is not on the tailnet cannot resolve this name, so the
# scan lands on the browser's own "can't be reached" page — and on a device that
# has never loaded the app there is no service worker yet, so our own offline
# page cannot explain it either. It reads as broken pairing rather than a
# missing VPN.
# 100.64.0.0/10 is the CGNAT range Tailscale assigns from, and `desk.sh addr`
# offers exactly that address when Serve is not fronting the app — so matching
# only on .ts.net would tell the most common fallback to check the wrong thing.
if [[ "$BASE" == *.ts.net* ]] ||
   [[ "$BASE" =~ //100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\. ]]; then
  echo "First: get the phone onto your tailnet — install Tailscale there and sign in."
  echo "       Until then this address does not resolve for it."
  echo
else
  echo "First: the phone has to be on this network — the address above is a local"
  echo "       one and does not resolve from anywhere else."
  echo
fi

if [ -n "$CODE" ]; then
  echo "Scan the QR or open the complete link above. It already contains the code;"
  echo "do not enter anything separately. Good for 10 minutes, one device."
  echo
  echo "First Deskpilot machine on this phone?"
  echo "  Scan the QR or open the link. It loads and pairs this machine automatically."
  echo
  echo "Already have Deskpilot installed for another machine?"
  echo "  Open that app, choose '+ add another machine', and paste the complete link."
  echo "  A camera scan opens a separate browser app instead of adding to your list."
  echo
  echo "This device gets its own credential — revoke it from the app without"
  echo "disturbing anything else."
else
  echo "Scan it, then add the page to your home screen."
  echo
  echo "NOTE: handing over the shared token, because the service did not answer."
  echo "That credential cannot be revoked on its own. Start the service and"
  echo "re-run this to pair properly."
fi
