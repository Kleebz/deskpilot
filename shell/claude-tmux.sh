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
# care what is running there, so nothing above the tmux layer is tied to any one
# agent. Which commands get wrapped is a config list, not something baked in.
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

  local name
  name=$(_deskpilot_free_name "$(_deskpilot_session_name)")

  # The agent is the session's only process, so quitting it destroys the
  # session. tmux defaults `detach-on-destroy` to `on` (the client detaches and
  # the terminal closes, which is what you want), but a user who has set it
  # `off` gets their orphaned client handed to another live session instead —
  # quitting one agent yanks an unrelated session, already attached in another
  # window, into this one.
  #
  # Set it on the session rather than globally: it is a session we created, it
  # dies with that session, and a user who chose `off` keeps it everywhere else.
  # server.ts does the same thing on the kill path.
  #
  # Hence -d then attach-session, as separate steps: the option has to land
  # before a client is ever attached. -A is kept only to close the race between
  # picking a free name and claiming it; the name is already free, so this
  # creates rather than attaches.
  tmux new-session -d -A -s "$name" -- "$bin" "$@" \; \
    set-option -t "$name" detach-on-destroy on \; \
    attach-session -t "$name"
}

# Which commands to wrap. Set DESKPILOT_WRAP in ~/.config/deskpilot/config to
# change it — the whole point of this project is that the agent is swappable, so
# hardcoding one name here was at odds with the design and meant a Codex user
# had to edit a file we ship.
#
#   DESKPILOT_WRAP="claude codex aider opencode"
#
# A name that is not installed is skipped, so one list works across machines
# that have different agents on them.
[ -r "${DESKPILOT_CONFIG:-$HOME/.config/deskpilot/config}" ] &&
  . "${DESKPILOT_CONFIG:-$HOME/.config/deskpilot/config}"

for _dp_cmd in ${DESKPILOT_WRAP:-claude}; do
  command -v "$_dp_cmd" >/dev/null 2>&1 || continue

  # Resolve to a path now, while the name is still the binary rather than the
  # function about to shadow it.
  _dp_bin=$(command -v "$_dp_cmd")

  # One exception, and it is Omarchy-specific: mise activation prepends its own
  # installs/claude/latest to PATH, which shadows ~/.local/bin/claude — the
  # wrapper that runs `mise use -g claude` and actually pulls updates. Resolving
  # through PATH would run the already-installed binary forever.
  [ "$_dp_cmd" = claude ] && [ -x "$HOME/.local/bin/claude" ] &&
    _dp_bin="$HOME/.local/bin/claude"

  eval "$_dp_cmd() { _deskpilot_wrap '$_dp_bin' \"\$@\"; }"
done
unset _dp_cmd _dp_bin
