#!/usr/bin/env bash
#
# One command for everything that can be automated.
#
#   ~/Projects/deskpilot/shell/setup.sh
#
# Every step is idempotent, so this is safe to re-run after pulling, after
# moving the repo, or when you are not sure what state you are in. Steps that
# are already done say so and cost nothing.
#
# It deliberately stops short of three things and prints them at the end,
# because no script can do them: authenticating to Tailscale, granting
# notification permission on the phone, and the group change for remote unlock
# that needs you to log out. Those are in docs/setup.md with their reasoning.

set -uo pipefail

# Ask before touching anything outside deskpilot's own files. Defaults to yes,
# answers itself with --yes, and declines when there is no terminal to ask on —
# a scripted install must never silently rewrite someone's config.
ask() {
  local prompt=$1
  [ "${DP_YES:-}" = y ] && return 0
  if [ ! -t 0 ]; then
    return 1
  fi
  printf '    %s [Y/n] ' "$prompt"
  local a; read -r a < /dev/tty || a=n
  case "$a" in [Nn]*) return 1 ;; *) return 0 ;; esac
}

# --yes adds the shell wrapper without asking; --no-shell never adds it.
DP_YES=""; DP_NO_SHELL=0; DP_NO_CLAUDE=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) DP_YES=y ;;
    --no-shell) DP_NO_SHELL=1 ;;
    --no-claude) DP_NO_CLAUDE=1 ;;
  esac
done

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
ok=0; skip=0; fail=0

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
good() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
same() { printf '  \033[2m·\033[0m %s\n' "$1"; skip=$((skip+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }

say "Web UI"
if [ -f "$REPO/web/dist/index.html" ] && [ "$REPO/web/dist/index.html" -nt "$REPO/web/package.json" ]; then
  same "already built"
else
  if (cd "$REPO/web" && npm install --silent && npm run build --silent) >/dev/null 2>&1; then
    good "built"
  else
    bad "build failed — run: cd $REPO/web && npm install && npm run build"
  fi
fi

say "Desktop skill"
if [ -e "$HOME/.claude/skills/desk-control" ]; then
  same "linked"
else
  mkdir -p "$HOME/.claude/skills"
  if ln -s "$REPO/skills/desk-control" "$HOME/.claude/skills/desk-control" 2>/dev/null; then
    good "linked"
  else
    bad "could not link $HOME/.claude/skills/desk-control"
  fi
fi

# Both of these write ~/.claude/settings.json — another program's config, not
# ours. They used to run unasked, which was worse than the .bashrc edit we now
# prompt for: one of them widens what an agent may do without stopping to ask,
# and that is not a decision to make on someone's behalf.
#
# You can run them; an agent cannot. The auto mode classifier blocks an agent
# from widening its own permissions, which is why these are separate scripts.
say "Claude Code settings"
if [ "${DP_NO_CLAUDE:-0}" = 1 ]; then
  same "skipped (--no-claude)"
elif [ ! -f "$HOME/.claude/settings.json" ] && [ ! -d "$HOME/.claude" ]; then
  same "no ~/.claude — skipping (not a Claude Code machine)"
else
  echo
  echo "    deskpilot can wire itself into Claude Code by editing"
  echo "    ~/.claude/settings.json (backed up first). Two changes:"
  echo
  echo "      hooks        so a session can say when it is blocked or done,"
  echo "                   which is what makes your phone buzz"
  echo "      permissions  so window moves and screenshots stop prompting."
  echo "                   This widens what the agent may do without asking."
  echo
  if ask "Apply both?"; then
    for s in install-permissions install-hooks; do
      if out=$("$REPO/shell/$s.sh" 2>&1); then
        good "$s"
      else
        bad "$s failed:"; printf '%s\n' "$out" | sed 's/^/      /'
      fi
    done
  else
    same "skipped — apply later with: shell/install-hooks.sh and install-permissions.sh"
  fi
fi

# Editing someone's shell profile without asking is the one genuinely invasive
# thing this installer does, and it is not necessary: it exists so that typing
# `claude` at your desk starts the agent inside tmux, where the phone can reach
# it. Declining leaves everything else working — you just start agents with
# `tmux new -s name <agent>` instead, and the app says so when the list is empty.
#
# --yes / --no-shell answers it for a scripted install, so nothing hangs waiting
# on a terminal that is not there.
say "Shell wrapper"
RC="${DESKPILOT_SHELL_RC:-$HOME/.bashrc}"
if grep -qs "deskpilot/shell/claude-tmux.sh" "$RC"; then
  same "already sourced from $(basename "$RC")"
elif [ "${DP_NO_SHELL:-0}" = 1 ]; then
  same "skipped (--no-shell)"
else
  echo
  echo "    Agents you start at your desk only appear on your phone if they are"
  echo "    running inside tmux. Adding one line to $(basename "$RC") makes that"
  echo "    automatic for: ${DESKPILOT_WRAP:-claude}"
  echo
  echo "    Declining is fine — everything else works, and you can run this"
  echo "    again later to change your mind."
  echo
  if ask "Add it?"; then
    echo "source $REPO/shell/claude-tmux.sh" >> "$RC"
    good "added to $(basename "$RC") — takes effect in new terminals"
  else
    same "skipped — add it later with: shell/setup.sh --yes"
  fi
fi

# `deskpilot <cmd>` is what every doc says to type, and until now it existed
# only after a release or package install — a source checkout got shell scripts
# with different names and no hint that the documented command was not one of
# them. `deskpilot pair` was therefore "command not found" on the one install
# that has to work before anything else does.
#
# A dispatching shim rather than a symlink to one script: the words are the
# same either way, so a doc, a README and a runbook can say `deskpilot pair`
# without qualifying which install they mean.
say "Command"
BIN="$HOME/.local/bin"
SHIM="$BIN/deskpilot"
if [ -e "$SHIM" ] && ! grep -qs "deskpilot shim" "$SHIM"; then
  same "$SHIM exists and is not ours — leaving it alone"
else
  mkdir -p "$BIN"
  # `uninstall` is deliberately not dispatched. shell/uninstall.sh is written
  # for the release layout — /usr/bin, /usr/share/deskpilot — and knows nothing
  # about a checkout or about this shim. Pointing at it would be the kind of
  # near-miss that reads as working until it silently does the wrong half.
  cat > "$SHIM" <<SHIMEOF
#!/usr/bin/env bash
# deskpilot shim — generated by shell/setup.sh, rewritten on every run.
#
# A source checkout has no compiled binary, so this dispatches the subcommands
# to the scripts that implement them here. Same words, either install.
set -uo pipefail
REPO="$REPO"
cmd=\${1:-help}
[ \$# -gt 0 ] && shift
case "\$cmd" in
  pair)   exec "\$REPO/shell/pair.sh" "\$@" ;;
  setup)  exec "\$REPO/shell/setup.sh" "\$@" ;;
  rotate) exec "\$REPO/shell/rotate.sh" "\$@" ;;
  update) exec "\$REPO/shell/update.sh" "\$@" ;;
  check)  exec "\$REPO/shell/check.sh" "\$@" ;;
  version|--version|-v)
    v=\$(sed -n 's/.*VERSION = "\([^"]*\)".*/\1/p' "\$REPO/server/version.ts")
    sha=\$(git -C "\$REPO" rev-parse --short HEAD 2>/dev/null || true)
    echo "\${v}\${sha:++\$sha} (source: \$REPO)"
    ;;
  help|--help|-h)
    cat <<'USAGE'
deskpilot — a phone-facing remote for the machine you left running

  deskpilot pair       print a QR and complete link that pair a phone
  deskpilot setup      re-run the installer; every step is idempotent
  deskpilot rotate     replace this machine's shared token
  deskpilot update     pull, rebuild and restart this checkout
  deskpilot check      verify every environment assumption
  deskpilot version    print the version

This is a source checkout, so the server runs from the repo rather than from
/usr/bin. \`deskpilot\` here is a shim over shell/ — same commands either way.
USAGE
    ;;
  *) echo "unknown command: \$cmd" >&2; exec "\$0" help ;;
esac
SHIMEOF
  if [ -s "$SHIM" ] && chmod +x "$SHIM"; then
    good "deskpilot -> $SHIM"
    case ":$PATH:" in
      *":$BIN:"*) ;;
      *) bad "$BIN is not on your PATH — add it, or run $REPO/shell/pair.sh directly" ;;
    esac
  else
    bad "could not write $SHIM"
  fi
fi

say "Service"
if out=$("$REPO/shell/install-service.sh" 2>&1); then
  good "installed and running on $(systemctl --user show deskpilot -p Environment --value | tr ' ' '\n' | grep DESKPILOT_HOST | cut -d= -f2):8790"
else
  bad "install-service.sh failed:"; printf '%s\n' "$out" | sed 's/^/      /'
fi

say "Checks"
"$REPO/shell/check.sh" 2>&1 | sed 's/^/  /'

printf '\n\033[1m%s\033[0m\n' "Automated: $ok done, $skip already fine, $fail failed"

cat <<'MANUAL'

Left to you — nothing can do these for you:

  1. Reach it from outside the house
       sudo pacman -S tailscale && sudo systemctl enable --now tailscaled
       tailscale up
       shell/use-https.sh
     Needs HTTPS Certificates enabled once at login.tailscale.com/admin/dns.

  2. Pair the phone
     Install Tailscale on the phone and sign in FIRST — step 1 gives this machine
     a tailnet address, and a phone not on the tailnet cannot resolve it. A scan
     before that lands on "can't be reached" and looks like broken pairing.
       deskpilot pair
     Scan the QR, then add to home screen. Use Chrome on Android, not Brave.

  3. Turn on notifications, in the app
     Sessions index -> notifications -> turn on -> test.
     A browser permission prompt only the phone can answer. Needs step 1 first:
     web push will not deliver over plain HTTP.

  Optional, for remote unlock:
       sudo pacman -S ydotool && sudo usermod -aG input $USER
       # log out and back in, then:
       shell/install-input.sh

Full reasoning, verification and rollback for each: docs/setup.md
MANUAL
