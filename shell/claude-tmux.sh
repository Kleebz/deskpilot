# deskpilot — run every `claude` inside a named tmux session.
#
# Opt in:  echo 'source ~/Projects/deskpilot/shell/claude-tmux.sh' >> ~/.bashrc
# Opt out: remove that line. Running sessions are unaffected either way.
#
# Why: remote prompting needs a named handle to inject into
# (`tmux send-keys -t <name> "..." Enter`). The session name is the project directory,
# so `claude` in ~/Projects/zigwam becomes the tmux session `zigwam`.
#
# Desk experience is unchanged — you still just type `claude`.
#
# Known costs:
#   - shadows the `claude` binary, so `which claude` no longer tells the whole story
#   - two sessions in the same directory collide; -A attaches to the existing one
#     rather than starting a second

claude() {
  # already inside tmux — run directly, no nesting
  if [ -n "$TMUX" ]; then
    command claude "$@"
    return
  fi

  local session
  session=$(basename "$PWD" | tr -c '[:alnum:]_-' '-' | sed 's/-*$//')
  [ -z "$session" ] && session=claude

  tmux new-session -A -s "$session" -- claude "$@"
}
