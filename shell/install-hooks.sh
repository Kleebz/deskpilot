#!/usr/bin/env bash
#
# Wire Claude Code's lifecycle hooks into deskpilot notifications.
#
#   ~/Projects/deskpilot/shell/install-hooks.sh
#
# Claude Code cannot apply this itself, for the same reason it cannot apply
# the permission rules: this writes to ~/.claude/settings.json, and an agent
# editing its own settings is exactly what the classifier is there to stop.
# So you run it.
#
# What it wires:
#   UserPromptSubmit  -> "working"  fires as a turn begins
#   PermissionRequest -> "blocked"  fires as a permission prompt is raised,
#                                   and carries the tool name asking for it
#   Stop              -> "done"     fires when a turn finishes
#
# "working" records state and deliberately does not notify. Without it a
# session running for ten minutes is indistinguishable from one idle for ten
# minutes, which is the question the console exists to answer.
#
# Both are `async`, so a notification can never make the agent wait on the
# network. shell/agent-hook.sh is the adapter that turns the hook's JSON into
# a POST; deskpilot itself never learns which agent sent it, which is what
# keeps another agent a config change rather than a code change.
#
# Safe to re-run: it replaces its own entries rather than appending, so
# running it after moving the repo fixes the paths instead of duplicating
# them. Anything else on those events is left alone.

set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
HOOK="$REPO/shell/agent-hook.sh"
SETTINGS="$HOME/.claude/settings.json"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
[ -x "$HOOK" ] || { echo "missing or not executable: $HOOK"; exit 1; }

[ -f "$SETTINGS" ] || { mkdir -p "$(dirname "$SETTINGS")"; echo '{}' > "$SETTINGS"; }
jq empty "$SETTINGS" 2>/dev/null || {
  echo "refusing to touch $SETTINGS — it is not valid JSON. Fix it first."
  exit 1
}

BACKUP="$SETTINGS.bak.$(date +%s)"
cp "$SETTINGS" "$BACKUP"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# Entries are keyed by the script they call, not by position, so re-running
# after a move rewrites the path rather than leaving a stale one behind.
jq --arg hook "$HOOK" '
  def ours($h): [.hooks[]? | select((.command // "") | startswith($h))] | length > 0;
  def entry($h; $kind): {
    hooks: [{ type: "command", command: ($h + " " + $kind), async: true, timeout: 10 }]
  };
  .hooks //= {}
  | .hooks.UserPromptSubmit =
      (((.hooks.UserPromptSubmit // []) | map(select(ours($hook) | not)))
        + [entry($hook; "working")])
  | .hooks.PermissionRequest =
      (((.hooks.PermissionRequest // []) | map(select(ours($hook) | not)))
        + [entry($hook; "blocked")])
  | .hooks.Stop =
      (((.hooks.Stop // []) | map(select(ours($hook) | not)))
        + [entry($hook; "done")])
' "$SETTINGS" > "$TMP"

jq empty "$TMP" 2>/dev/null || { echo "merge produced invalid JSON; nothing changed"; exit 1; }
cp "$TMP" "$SETTINGS"

echo "updated $SETTINGS"
echo "backup  $BACKUP"
echo
for ev in UserPromptSubmit PermissionRequest Stop; do
  printf '%-18s %s\n' "$ev" \
    "$(jq -r --arg h "$HOOK" ".hooks.$ev[]?.hooks[]? | select(.command | startswith(\$h)) | .command" "$SETTINGS")"
done
echo
echo "Hooks load when a session starts. Open /hooks once, or start a new"
echo "session, before expecting them to fire."
echo
echo "Notifications also need turning on once in the web app — the phone has"
echo "to grant permission itself, which nothing here can do for it."
