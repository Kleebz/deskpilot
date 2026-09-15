#!/usr/bin/env bash
#
# Update a source install and restart cleanly.
#
#   ~/Projects/deskpilot/shell/update.sh
#
# There was no update path at all: you were pinned to whatever you first
# installed, with no way to tell what that was.
#
# This is the source-checkout version, and only that. The other two are:
#   * a release install  ->  re-run install.sh, or `deskpilot update`
#   * a package install  ->  the package manager
# README.md has all three under "Updating".
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
was_full=$(git rev-parse HEAD 2>/dev/null || echo unknown)
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

command -v npm >/dev/null || fail "npm is required to install locked web dependencies"
command -v deno >/dev/null || fail "deno is required to validate the server"

# Build the candidate in a disposable worktree. Nothing under the live checkout
# changes until dependencies, UI build, and server typecheck have all passed.
stage=$(mktemp -d)
cleanup() {
  git worktree remove --force "$stage" >/dev/null 2>&1 || true
  rm -rf "$stage"
}
trap cleanup EXIT
git worktree add --detach "$stage" @{u} --quiet || fail "could not stage the incoming revision"
npm --prefix "$stage/web" ci >/dev/null 2>&1 \
  || fail "locked dependency installation failed — current deployment left active"
npm --prefix "$stage/web" run build >/dev/null 2>&1 \
  || fail "the staged UI build failed — current deployment left active"
(cd "$stage" && deno check server/server.ts >/dev/null 2>&1) \
  || fail "the staged server does not typecheck — current deployment left active"
say "candidate dependencies, UI and server validated"

# Stage the complete built shell beside the live one, then switch directory
# entries. Browsers see the old shell or the new shell, never a half-built mix.
rm -rf web/dist.new web/dist.previous
cp -a "$stage/web/dist" web/dist.new || fail "could not stage the built UI"
git merge --ff-only @{u} --quiet || fail "cannot fast-forward — your branch has diverged"
now=$(git rev-parse --short HEAD)
if [ -d web/dist ]; then mv web/dist web/dist.previous; fi
if ! mv web/dist.new web/dist; then
  git reset --hard "$was_full" >/dev/null 2>&1 || true
  if [ -d web/dist.previous ]; then mv web/dist.previous web/dist; fi
  fail "could not activate the staged UI — previous checkout and UI restored"
fi
say "now at $now"

# --- restart ---------------------------------------------------------------
if systemctl --user is-active --quiet deskpilot; then
  # Leftover children in the cgroup coincided with the one bad restart we have
  # seen, so say what is in there rather than restarting blind.
  procs=$(systemctl --user show deskpilot -p MainPID --value >/dev/null 2>&1 &&
    cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/deskpilot.service/cgroup.procs" 2>/dev/null | wc -l)
  [ "${procs:-1}" -gt 1 ] && say "note: $procs processes in the service cgroup"

  rollback() {
    say "activation failed — restoring $was"
    git reset --hard "$was_full" >/dev/null 2>&1 || true
    rm -rf web/dist
    if [ -d web/dist.previous ]; then mv web/dist.previous web/dist; fi
    systemctl --user restart deskpilot >/dev/null 2>&1 || true
    fail "the update was rolled back; inspect: systemctl --user status deskpilot"
  }
  systemctl --user restart deskpilot || rollback
  sleep 2
  systemctl --user is-active --quiet deskpilot \
    || rollback
  # A live process is insufficient: require the authenticated API to answer.
  token_file=${DESKPILOT_TOKEN_FILE:-"$HOME/.config/deskpilot/token"}
  token=$(tr -d '\n' < "$token_file" 2>/dev/null) || rollback
  curl -fsS --max-time 5 -H "Authorization: Bearer $token" \
    "http://127.0.0.1:${DESKPILOT_PORT:-8790}/api/capabilities" >/dev/null || rollback
  say "service restarted"
else
  say "service is not running — start it with: systemctl --user start deskpilot"
fi

rm -rf web/dist.previous

echo
say "sessions still running: $(tmux list-sessions 2>/dev/null | wc -l)"
say "$was -> $now"
echo
say "run shell/check.sh if anything looks wrong"
