#!/usr/bin/env bash
#
# Turn an agent's own lifecycle hook into a deskpilot notification.
#
#   agent-hook.sh blocked   < hook-json     the agent wants an answer
#   agent-hook.sh done      < hook-json     the agent finished its turn
#
# This is the per-agent adapter, and the only file in the project that knows
# any agent's hook format. deskpilot itself receives "something happened" and
# stays ignorant of who said it — same seam as docs/permissions.json, which is
# Claude-specific by design while nothing above the tmux layer is.
#
# Why an adapter at all, rather than pointing an `http` hook straight at the
# endpoint: the API needs a bearer token, and ~/.claude/settings.json is 0644
# while the token file is 0600. Putting the token in settings — or in an env
# var declared there — widens who can read it. Reading it here at call time
# keeps that boundary where it was.
#
# Wire it up in ~/.claude/settings.json:
#
#   "hooks": {
#     "PermissionRequest": [{ "hooks": [{ "type": "command", "async": true,
#       "command": "<repo>/shell/agent-hook.sh blocked" }] }],
#     "Stop":              [{ "hooks": [{ "type": "command", "async": true,
#       "command": "<repo>/shell/agent-hook.sh done" }] }]
#   }
#
# Another agent needs its own two lines in its own config, and no change here
# beyond a kind it already understands.

set -uo pipefail

KIND=${1:-event}
PORT=${DESKPILOT_PORT:-8790}
TOKEN_FILE=${DESKPILOT_TOKEN_FILE:-$HOME/.config/deskpilot/token}

# A hook must never be why an agent stalls. Every failure below exits 0 and
# says nothing: a missed notification is a small loss, a wedged agent is not.
payload=$(cat 2>/dev/null || true)

# The pane, not the client. `display-message -p '#S'` with no target resolves
# through the attached client, which is wrong when the session is detached and
# right only by luck when it is not — and detached is exactly when this matters.
pane=${TMUX_PANE:-}
[ -n "$pane" ] || exit 0
session=$(tmux display-message -p -t "$pane" '#S' 2>/dev/null) || exit 0
[ -n "$session" ] || exit 0

[ -r "$TOKEN_FILE" ] || exit 0
token=$(cat "$TOKEN_FILE") || exit 0

# The tool name is the useful half of a permission request — "Bash wants to
# run" is worth waking up for in a way that "a session needs you" is not.
tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)

case "$KIND" in
  blocked)
    title="$session needs an answer"
    body=${tool:+"$tool is asking for permission"}
    body=${body:-"waiting for your answer"}
    ;;
  done)
    title="$session finished"
    body="ready for your next prompt"
    ;;
  *)
    title="$session"
    body="$KIND"
    ;;
esac

jq -n --arg s "$session" --arg k "$KIND" --arg t "$title" --arg b "$body" \
  '{session:$s, kind:$k, title:$t, body:$b}' 2>/dev/null |
  curl -s -m 5 -o /dev/null \
    -X POST "http://127.0.0.1:${PORT}/api/event" \
    -H "authorization: Bearer $token" \
    -H "content-type: application/json" \
    --data-binary @- 2>/dev/null || true

exit 0
