#!/usr/bin/env bash
#
# Update a source install and restart cleanly.
#
#   ~/Projects/deskpilot/shell/update.sh
#
# There was no update path at all: you were pinned to whatever you first
# installed, with no way to tell what that was. This is the source-checkout
# version — a packaged install updates through the package manager, and a
# compiled binary replaces itself.
#
# The order matters, and it is the order that bit us on a previous deploy.
# Build the UI *before* restarting the service: the server serves web/dist
# straight off disk, so a rebuild goes live the instant it compiles. Building
# after a restart, or restarting without building, leaves the browser talking a
# different protocol version to the server for as long as the gap lasts.
#
# Sessions survive this. KillMode=process keeps tmux alive across a restart —
# verified when the service crash-looped for thirty seconds and every session
# was still there afterwards.

set -uo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$REPO" || exit 1

say()  { printf '  %s\n' "$*"; }
fail() { printf '  \033[31m%s\033[0m\n' "$*" >&2; exit 1; }

was=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
say "at $was"

# --- refuse to clobber local work ------------------------------------------
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "you have uncommitted changes — commit or stash them first"
fi

git fetch --quiet origin || fail "could not reach the remote"

behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
if [ "$behind" = 0 ]; then
  say "already up to date"
  exit 0
fi
say "$behind commit(s) behind"

git merge --ff-only @{u} --quiet || fail "cannot fast-forward — your branch has diverged"
now=$(git rev-parse --short HEAD)
say "now at $now"

# --- build the UI before anything restarts ---------------------------------
if [ -d web/node_modules ]; then
  (cd web && npm run build >/dev/null 2>&1) || fail "the UI build failed — not restarting"
  say "UI rebuilt"
else
  say "web/node_modules missing — run 'npm install' in web/ first" >&2
fi

# --- typecheck before handing the service a broken server ------------------
if command -v deno >/dev/null; then
  deno check server/server.ts >/dev/null 2>&1 || fail "server does not typecheck — not restarting"
  say "server typechecks"
fi

# --- restart ---------------------------------------------------------------
if systemctl --user is-active --quiet deskpilot; then
  # Leftover children in the cgroup coincided with the one bad restart we have
  # seen, so say what is in there rather than restarting blind.
  procs=$(systemctl --user show deskpilot -p MainPID --value >/dev/null 2>&1 &&
    cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/deskpilot.service/cgroup.procs" 2>/dev/null | wc -l)
  [ "${procs:-1}" -gt 1 ] && say "note: $procs processes in the service cgroup"

  systemctl --user restart deskpilot || fail "restart failed"
  sleep 2
  systemctl --user is-active --quiet deskpilot \
    || { systemctl --user status deskpilot --no-pager -n 15; fail "service did not come back"; }
  say "service restarted"
else
  say "service is not running — start it with: systemctl --user start deskpilot"
fi

echo
say "sessions still running: $(tmux list-sessions 2>/dev/null | wc -l)"
say "$was -> $now"
echo
say "run shell/check.sh if anything looks wrong"
