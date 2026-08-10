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
#   - two sessions in the same directory collide; -A attaches to the existing one
#     rather than starting a second

_deskpilot_session_name() {
  local n
  n=$(basename "${1:-$PWD}" | tr -c '[:alnum:]_-' '-' | sed 's/-*$//')
  printf '%s' "${n:-agent}"
}

# _deskpilot_wrap <binary> [args...]
_deskpilot_wrap() {
  local bin=$1; shift

  # already inside tmux — run directly, no nesting
  if [ -n "${TMUX:-}" ]; then
    command "$bin" "$@"
    return
  fi

  tmux new-session -A -s "$(_deskpilot_session_name)" -- "$bin" "$@"
}

claude() { _deskpilot_wrap claude "$@"; }

# Add other agents the same way — the rest of deskpilot needs no changes:
#   aider()   { _deskpilot_wrap aider "$@"; }
#   codex()   { _deskpilot_wrap codex "$@"; }
#   opencode(){ _deskpilot_wrap opencode "$@"; }
