#!/usr/bin/env bash
#
# Turn a Hermes shell-hook event into a deskpilot notification.
#
#   hermes-hook.sh blocked   < hook-json     Hermes wants an answer (pre_approval_request)
#   hermes-hook.sh done      < hook-json     a turn finished           (on_session_end)
#
# This is the Hermes counterpart to agent-hook.sh, and the only file here that
# knows Hermes's hook format. deskpilot itself still receives "something
# happened" through /api/event and stays ignorant of which agent said it —
# same seam the Claude adapter uses. Nothing above the tmux layer changes.
#
# Why a separate adapter rather than reusing agent-hook.sh: Hermes speaks a
# different wire protocol from Claude Code. Hermes pipes the event as JSON on
# STDIN (Claude sets env vars) and reads JSON back on STDOUT synchronously, so
# this script must ALWAYS print a JSON object (`{}` = no-op) and return fast —
# a slow or silent hook would stall the agent loop. Every failure path below
# still prints `{}` and exits 0 for exactly that reason.
#
# It also, deliberately, never marks a request approvable. Hermes approval
# prompts are numbered multi-choice menus whose default option is the *cautious*
# one (e.g. "1. Show me first" with "yes, do it" further down), so deskpilot's
# one-tap approve — which sends a bare Enter — would pick the safe/decline
# choice, not approve. The notification tells you to open the app and answer in
# the session; it never fires a blind keystroke. `tool` is left empty so the
# server's SAFE_TO_APPROVE check yields canApprove=false and no approve button
# is shown. If Hermes ever grows a fixed Enter=approve prompt, revisit this.
#
# Wire it up (idempotently) with shell/install-hermes-hooks.sh, which adds a
# `hooks:` block to ~/.hermes/config.yaml. Hermes cannot widen its own hook
# config from inside an agent turn, which is why there is an installer script
# rather than a self-edit — the same reason install-hooks.sh exists for Claude.

set -uo pipefail

KIND=${1:-event}
PORT=${DESKPILOT_PORT:-8790}
TOKEN_FILE=${DESKPILOT_TOKEN_FILE:-$HOME/.config/deskpilot/token}

# Read the event payload from stdin. A hook must never be why an agent stalls,
# so from here on every failure prints `{}` (a valid no-op response) and exits 0.
noop() { printf '{}\n'; exit 0; }
payload=$(cat 2>/dev/null || true)

# Resolve the pane, then the session name from it — never the attached client.
# `display-message -p '#S'` with no target resolves through the attached client,
# which is wrong when the session is detached and right only by luck otherwise;
# detached is exactly when a phone notification matters most. TMUX_PANE is set
# in the hook subprocess's environment because Hermes runs inside the tmux
# session (verified: the pane id in TMUX_PANE matches the session's pane).
pane=${TMUX_PANE:-}
[ -n "$pane" ] || noop
session=$(tmux display-message -p -t "$pane" '#S' 2>/dev/null) || noop
[ -n "$session" ] || noop

[ -r "$TOKEN_FILE" ] || noop
token=$(cat "$TOKEN_FILE") || noop

# The event-specific fields live under .extra in the shell-hook payload. For a
# blocked (pre_approval_request) event the useful half is what is being asked —
# the command, or a human description of it. For done (on_session_end) we only
# care whether the turn actually completed vs was interrupted.
extract() { printf '%s' "$payload" | jq -r "$1 // empty" 2>/dev/null || true; }

case "$KIND" in
  blocked)
    # pre_approval_request: {extra:{command, description, pattern_key, surface, tool_call_id, ...}}
    cmd=$(extract '.extra.command')
    desc=$(extract '.extra.description')
    detail=$(printf '%s' "${desc:-$cmd}" | tr '\n\t' '  ' | cut -c1-160)
    title="$session needs an answer"
    body=${detail:-"waiting for your answer in the app"}
    # tool stays empty ON PURPOSE — see the header note. Empty tool => the
    # server cannot mark this approvable, so the phone shows a notification
    # with no one-tap approve, which is the correct, safe behaviour for a
    # numbered Hermes prompt whose default is the cautious choice.
    tool=""
    reqid=$(extract '.extra.tool_call_id')
    ;;
  done)
    # on_session_end fires at each turn finalization. Only announce a clean
    # finish; an interrupted turn (user sent a new message, /stop, quit) is not
    # "ready for your next prompt" and would be a misleading buzz.
    interrupted=$(extract '.extra.interrupted')
    completed=$(extract '.extra.completed')
    [ "$interrupted" = "true" ] && noop
    [ "$completed" = "false" ] && noop
    title="$session finished"
    body="ready for your next prompt"
    tool=""
    reqid=""
    ;;
  *)
    title="$session"
    body="$KIND"
    tool=""
    reqid=""
    ;;
esac

jq -n --arg s "$session" --arg k "$KIND" --arg t "$title" --arg b "$body" \
  --arg tool "$tool" --arg id "$reqid" \
  '{session:$s, kind:$k, title:$t, body:$b, tool:$tool, reqid:$id}' 2>/dev/null |
  curl -s -m 5 -o /dev/null \
    -X POST "http://127.0.0.1:${PORT}/api/event" \
    -H "authorization: Bearer ${token}" \
    -H "content-type: application/json" \
    --data-binary @- 2>/dev/null || true

# Always hand Hermes a valid no-op response so the hook never alters tool flow.
printf '{}\n'
exit 0
