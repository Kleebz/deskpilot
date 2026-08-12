#!/usr/bin/env bash
#
# Put deskpilot behind real HTTPS on your tailnet, via Tailscale Serve.
#
#   ~/Projects/deskpilot/shell/use-https.sh
#
# PREREQUISITE, done once in a browser:
#   https://login.tailscale.com/admin/dns  →  enable "HTTPS Certificates"
#
# Why bother, beyond the padlock:
#
#   * PWA install requires a secure context. Plain HTTP on a private IP is not
#     one — only localhost is exempt — so no browser will offer "install", and
#     nothing explains why. This is the actual fix for that.
#   * Serve proxies from 127.0.0.1, so afterwards the server does not need to
#     listen on any external interface at all. That is strictly better than
#     binding 0.0.0.0 and relying on a firewall rule: there is nothing to
#     reach even if the rule is wrong.
#   * A real Let's Encrypt certificate for <host>.<tailnet>.ts.net, renewed by
#     Tailscale. No self-signed warnings, no CA to install on the phone.
#   * Secure context also unlocks clipboard access and other gated APIs, if
#     they are ever wanted.
#
# Reverse with:  tailscale serve reset

set -euo pipefail

PORT="${DESKPILOT_PORT:-8790}"
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

say() { printf '  %s\n' "$*"; }

command -v tailscale >/dev/null || { echo "tailscale not installed" >&2; exit 1; }
systemctl is-active --quiet tailscaled || { echo "tailscaled not running" >&2; exit 1; }

DNSNAME=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
[ -n "$DNSNAME" ] || { echo "no MagicDNS name — enable MagicDNS in the admin console" >&2; exit 1; }
say "tailnet name: $DNSNAME"

if [ "$(tailscale status --json | jq -r '.CertDomains // empty')" = "" ]; then
  echo
  echo "HTTPS certificates are not enabled for this tailnet." >&2
  echo "Enable them once, then re-run this:" >&2
  echo "  https://login.tailscale.com/admin/dns  →  HTTPS Certificates" >&2
  exit 1
fi

# Set up Serve FIRST and prove it works. Only then narrow the binding.
# Doing it the other way round means a failure here leaves the phone with no
# route at all — which is exactly what happened the first time.
say "pointing Tailscale Serve at 127.0.0.1:$PORT"
if ! tailscale serve --bg --yes "$PORT" 2>/dev/null; then
  if sudo -n true 2>/dev/null || [ -t 0 ]; then
    say "serve needs root; retrying with sudo"
    sudo tailscale serve --bg --yes "$PORT"
  else
    echo >&2
    echo "tailscale serve needs root. Either run this in a terminal so it can" >&2
    echo "prompt, or grant yourself permanent access once:" >&2
    echo "  sudo tailscale set --operator=\$USER" >&2
    exit 1
  fi
fi

URL="https://$DNSNAME"
ok=0
for _ in $(seq 1 10); do
  sleep 2
  if curl -s -m 8 -o /dev/null "$URL/"; then ok=1; break; fi
done
if [ "$ok" != 1 ]; then
  echo >&2
  echo "No answer at $URL. Leaving the current binding alone so you are not" >&2
  echo "cut off. Undo with: tailscale serve reset" >&2
  exit 1
fi
say "reachable at $URL with a valid certificate"

# Proven. Now the app can stop listening anywhere but loopback.
DROPIN="$UNIT_DIR/deskpilot.service.d/local.conf"
if [ -f "$DROPIN" ]; then
  rm -f "$DROPIN"
  systemctl --user daemon-reload
  systemctl --user restart deskpilot
  sleep 2
  say "removed the bind-everywhere override — listening on 127.0.0.1 only"
  curl -s -m 8 -o /dev/null "$URL/" \
    && say "still reachable through Serve after narrowing the binding" \
    || { say "lost reachability after narrowing — restoring"; \
         mkdir -p "$(dirname "$DROPIN")"; \
         printf '[Service]\nEnvironment=DESKPILOT_HOST=0.0.0.0\n' > "$DROPIN"; \
         systemctl --user daemon-reload; systemctl --user restart deskpilot; exit 1; }
fi

# The firewall rule is no longer doing anything: nothing listens off-loopback.
if command -v ufw >/dev/null && sudo -n ufw status 2>/dev/null | grep -q "$PORT"; then
  say "note: ufw still has a rule for $PORT. It is now redundant — the server"
  say "      only listens on loopback. Remove it with: sudo ufw status numbered"
fi

echo
echo "Re-pair the phone — the address changed:"
echo
"$REPO/shell/pair.sh" "$DNSNAME"
echo
echo "Now the install prompt will appear: HTTPS makes this a secure context."
