#!/usr/bin/env bash
#
# Prove the portable half works on a machine with no desktop at all.
#
#   tests/headless.sh [binary]
#
# Everything in this project has run on one Arch box with Hyprland. Capability
# negotiation was written for hosts with no compositor and, until this, had only
# ever been tested by hiding desk.sh from a machine that has one — which does
# not exercise a missing hyprctl, a missing grim, an absent Wayland socket, or a
# different $HOME.
#
# bwrap rather than docker: it is rootless, needs no daemon, and is already on
# any Arch box. The sandbox shares the network namespace on purpose, so the test
# can reach the server from outside it.
#
# What is asserted:
#   * the server starts with no compositor binaries on PATH
#   * capabilities reports the desk tier absent instead of erroring
#   * tmux sessions are still listed, with no workspace
#   * it can still write its own state — the compiled binary bakes an
#     --allow-write path at build time, and a different $HOME is exactly where
#     that would go wrong

set -uo pipefail
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
BIN="${1:-$REPO/dist/deskpilot}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n     → %s\n' "$1" "${2:-}"; FAILED=$((FAILED + 1)); }
FAILED=0

[ -x "$BIN" ] || { echo "no binary at $BIN — run shell/build.sh first" >&2; exit 1; }
command -v bwrap >/dev/null || { echo "bwrap is required (package: bubblewrap)" >&2; exit 1; }

# A free port, rather than a fixed one. bwrap forks, so a previous run that was
# not torn down cleanly would still be holding it — and the test would talk to
# that server, fail every assertion on a token mismatch, and blame the code.
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()' 2>/dev/null || echo 8798)

BOX=$(mktemp -d)
cleanup() {
  # --die-with-parent is what makes this reliable; this is the belt.
  [ -n "${BOX_PID:-}" ] && kill "$BOX_PID" 2>/dev/null
  sleep 0.3
  rm -rf "$BOX"
}
trap cleanup EXIT

mkdir -p "$BOX/bin" "$BOX/home/.config/deskpilot" "$BOX/home/.local/state/deskpilot"
# tmux will not create its own socket directory, and a bare tmpfs starts empty.
# A prepared /tmp bound in is more reliable than TMUX_TMPDIR, which this tmux
# ignores — it went on using /tmp/tmux-<uid> however the variable was set.
# Still isolated: it is a directory under the test's own temp dir.
mkdir -p "$BOX/tmp/tmux-$(id -u)" && chmod 1777 "$BOX/tmp" && chmod 700 "$BOX/tmp/tmux-$(id -u)"
# Only what a headless host has. hyprctl, grim and ydotool are deliberately
# absent — this is the whole point, and PATH is how they are kept out.
for t in tmux ps sh bash env cat mkdir id chmod; do
  src=$(command -v "$t") || { echo "$t missing on the host" >&2; exit 1; }
  ln -sf "$src" "$BOX/bin/$t"
done
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$BOX/home/.config/deskpilot/token"
TOKEN=$(cat "$BOX/home/.config/deskpilot/token")
cp "$BIN" "$BOX/deskpilot"

cat > "$BOX/start.sh" <<EOF
#!/bin/sh
# A session to find, then the server. /tmp is bound to a directory of the
# test's own, so this cannot see or disturb the host's tmux server.
tmux new-session -d -s headless 'exec bash --norc'
tmux send-keys -t headless 'echo SANDBOX_OK' Enter
exec /box/deskpilot
EOF
chmod +x "$BOX/start.sh"

box() {
  bwrap \
    --ro-bind /usr /usr --ro-bind /etc /etc \
    --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin \
    --die-with-parent --proc /proc --dev /dev --bind "$BOX/tmp" /tmp \
    --bind "$BOX" /box \
    --setenv PATH /box/bin --setenv HOME /box/home \
    --setenv DESKPILOT_PORT "$PORT" \
    --unsetenv WAYLAND_DISPLAY --unsetenv HYPRLAND_INSTANCE_SIGNATURE \
    --unsetenv DISPLAY --unsetenv XDG_RUNTIME_DIR \
    "$@"
}

echo "==> starting a server with no compositor, no Wayland, and a fresh HOME"
box /box/start.sh > "$BOX/log" 2>&1 &
BOX_PID=$!

for _ in $(seq 1 30); do
  sleep 0.5
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/" && break
done
if ! curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "  the server never came up; log:" >&2
  sed 's/^/    /' "$BOX/log" >&2
  exit 1
fi

api() { curl -s -m 6 -H "authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/$1"; }
post() {
  curl -s -m 6 -X POST -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' -d "$2" "http://127.0.0.1:$PORT/api/$1"
}

echo
echo "==> what it reports about itself"
CAPS=$(api capabilities)
echo "     $CAPS"
echo

for f in windows screenshot input; do
  case "$CAPS" in
    *"\"$f\":false"*) pass "$f: false" ;;
    *) fail "$f must be false with no compositor" "$CAPS" ;;
  esac
done
case "$CAPS" in
  *'"compositor":"none"'*) pass "compositor: none" ;;
  *) fail "compositor must be none" "$CAPS" ;;
esac
for f in sessions terminal; do
  case "$CAPS" in
    *"\"$f\":true"*) pass "$f: true — the portable half still works" ;;
    *) fail "$f must still be available" "$CAPS" ;;
  esac
done

STATE=$(api desk/state)
[ "$STATE" = "[]" ] && pass "desk/state: [] rather than an error" \
  || fail "desk/state must answer emptily, not fail" "$STATE"

echo
echo "==> the part that has to work anywhere"
SESSIONS=$(api sessions)
case "$SESSIONS" in
  *'"session":"headless"'*) pass "the session is listed" ;;
  *) fail "the session should be listed" "$SESSIONS" ;;
esac
case "$SESSIONS" in
  *'"workspace":null'*) pass "workspace: null — no screen to be on, correctly" ;;
  *) fail "workspace should be null with no compositor" "$SESSIONS" ;;
esac

# Writing is the one that a compiled binary can get wrong invisibly: the
# --allow-write path is fixed when the binary is built, so a different $HOME
# means the granted path and the used path are not the same directory.
echo
echo "==> writing its own state under a \$HOME the binary was not built with"
CODE=$(post devices/code '{}' | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
if [ -z "$CODE" ]; then
  fail "could not mint a pairing code" "$(post devices/code '{}')"
else
  ENROLLED=$(post devices/enroll "{\"code\":\"$CODE\",\"name\":\"sandbox\"}")
  case "$ENROLLED" in
    *'"token"'*) pass "enrolled a device" ;;
    *) fail "enrolment failed" "$ENROLLED" ;;
  esac
  if [ -s "$BOX/home/.local/state/deskpilot/devices.json" ]; then
    pass "state reached disk at the sandbox's HOME"
  else
    fail "devices.json was not written" \
         "the baked --allow-write path does not match \$HOME"
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32ma host with no desktop works, and says so\033[0m\n'
else
  printf '\033[31m%d check(s) failed\033[0m\n' "$FAILED"
  sed 's/^/    /' "$BOX/log" | tail -10
fi
exit "$FAILED"
