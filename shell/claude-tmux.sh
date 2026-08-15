# deskpilot — run interactive agents inside a named tmux session.
#
# Opt in:  echo 'source ~/Projects/deskpilot/shell/claude-tmux.sh' >> ~/.bashrc
# Opt out: remove that line. Running sessions are unaffected either way.
#
# Why: remote prompting needs a named handle to inject into
# (`tmux send-keys -t <name> "..." Enter`). The session name is the project
# directory, so `claude` in ~/Projects/zigwam becomes the tmux session `zigwam`.
#
# Deliberately agent-agnostic. `send-keys` types into a terminal and does not
# care what is running there, so nothing above the tmux layer is tied to Claude
# Code. Wrap another agent by adding one line at the bottom of this file.
#
# Desk experience is unchanged — you still just type `claude`.
#
# Known costs:
#   - shadows the wrapped binary, so `which claude` no longer tells the whole story
#   - a second agent in the same directory gets a -2 suffix, so the session name
#     is not always the directory name

_deskpilot_session_name() {
  local n
  n=$(basename "${1:-$PWD}" | tr -c '[:alnum:]_-' '-' | sed 's/-*$//')
  printf '%s' "${n:-agent}"
}

# First unused name in the <base>, <base>-2, <base>-3 series.
#
# `new-session -A` attaches when the name is taken, which meant a second
# `claude` in a directory silently resumed the first one's conversation instead
# of starting a new one — the wrapper quietly overriding what plain `claude`
# means. Resuming is what `--continue` is for. The phone UI already picks a free
# suffix this way, so the two agree.
#
# `=` forces an exact match; without it tmux resolves prefixes and `jacob` would
# match `jacob-2`.
_deskpilot_free_name() {
  local base=$1 n=$1 i=2
  while tmux has-session -t "=$n" 2>/dev/null; do
    n="$base-$i"
    i=$((i + 1))
  done
  printf '%s' "$n"
}

# Commands that do a job and exit. These must never be wrapped: `new-session -A`
# attaches to an existing session when one matches, silently discarding the
# arguments, so `claude update` in a directory with a live session just drops
# you into that session having done nothing. Interactive launches (no args, -c,
# --resume, a bare prompt) still get wrapped — those are what remote prompting
# needs a named handle on.
#
# The list leans on names that are conventional across agents (update, doctor,
# --version), so wrapping another binary inherits sensible behaviour.
_deskpilot_oneshot() {
  local a
  case "${1:-}" in
    update | doctor | mcp | config | install | migrate-installer | \
      -v | --version | -h | --help) return 0 ;;
  esac
  # -p/--print anywhere means non-interactive output the caller wants to read
  for a in "$@"; do
    case "$a" in -p | --print) return 0 ;; esac
  done
  return 1
}

# _deskpilot_wrap <binary> [args...]
_deskpilot_wrap() {
  local bin=$1; shift

  # already inside tmux, or a command that exits on its own — run directly
  if [ -n "${TMUX:-}" ] || _deskpilot_oneshot "$@"; then
    command "$bin" "$@"
    return
  fi

  # -A is kept only to close the race between picking a free name and claiming
  # it; the name is already free, so this creates rather than attaches.
  tmux new-session -A -s "$(_deskpilot_free_name "$(_deskpilot_session_name)")" \
    -- "$bin" "$@"
}

# Full path, not a bare name: mise activation prepends its own
# installs/claude/latest to PATH, which shadows ~/.local/bin/claude — the
# Omarchy wrapper that runs `mise use -g claude` and actually pulls updates.
# Resolving through PATH would run the already-installed binary forever.
claude() { _deskpilot_wrap "$HOME/.local/bin/claude" "$@"; }

# Add other agents the same way — the rest of deskpilot needs no changes:
#   aider()   { _deskpilot_wrap aider "$@"; }
#   codex()   { _deskpilot_wrap codex "$@"; }
#   opencode(){ _deskpilot_wrap opencode "$@"; }
