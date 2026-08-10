#!/usr/bin/env bash
#
# Merge deskpilot's permission rules into ~/.claude/settings.json.
#
#   ~/Projects/deskpilot/shell/install-permissions.sh
#
# Claude Code cannot apply this itself — the auto mode classifier blocks an
# agent from widening its own permissions, which is the correct behaviour.
# So you run it.
#
# What the rules do:
#   allow  read-only queries and reversible window moves. These fire
#          constantly when driving from a phone and cannot lose work.
#   ask    destructive or escalating. closewindow can lose unsaved work.
#          tmux send-keys can type arbitrary text into any terminal you have
#          open — it is the core of the remote design and a real escalation,
#          so it stays gated until you deliberately open it.
#   deny   `hyprctl dispatch exit` kills the Hyprland session outright.
#
# Safe to re-run: additive, de-duplicated, and it backs up first.
# Compound commands (`grim x && ls y`) still prompt — they do not match a
# single prefix rule. That is expected, not a gap in the list.

set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
SRC="$(dirname "$(readlink -f "$0")")/../docs/permissions.json"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
jq empty "$SRC" 2>/dev/null || { echo "$SRC is not valid JSON"; exit 1; }

[ -f "$SETTINGS" ] || { mkdir -p "$(dirname "$SETTINGS")"; echo '{}' > "$SETTINGS"; }
jq empty "$SETTINGS" 2>/dev/null || {
  echo "refusing to touch $SETTINGS — it is not valid JSON. Fix it first."
  exit 1
}

BACKUP="$SETTINGS.bak.$(date +%s)"
cp "$SETTINGS" "$BACKUP"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

jq -s '
  .[0] as $cur | .[1] as $new |
  ($cur * $new)
  | .permissions.allow = ((($cur.permissions.allow // []) + $new.permissions.allow) | unique)
  | .permissions.ask   = ((($cur.permissions.ask   // []) + $new.permissions.ask)   | unique)
  | .permissions.deny  = ((($cur.permissions.deny  // []) + $new.permissions.deny)  | unique)
' "$SETTINGS" "$SRC" > "$TMP"

jq empty "$TMP" 2>/dev/null || { echo "merge produced invalid JSON; nothing changed"; exit 1; }

cp "$TMP" "$SETTINGS"

echo "updated $SETTINGS"
echo "backup  $BACKUP"
echo
echo "allow: $(jq '.permissions.allow | length' "$SETTINGS") rules"
echo "ask:   $(jq '.permissions.ask   | length' "$SETTINGS") rules"
echo "deny:  $(jq '.permissions.deny  | length' "$SETTINGS") rules"
echo
echo "Open /config once, or restart Claude Code, so the new rules load."
