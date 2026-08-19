#!/usr/bin/env bash
#
# Wire Hermes's lifecycle hooks into deskpilot notifications.
#
#   ~/Projects/deskpilot/shell/install-hermes-hooks.sh
#
# The Hermes counterpart to install-hooks.sh. Hermes cannot apply this itself:
# it refuses agent writes to ~/.hermes/config.yaml (security-sensitive), which
# is the same reason install-hooks.sh exists for Claude — widening your own
# hook config from inside an agent turn is exactly what that guard stops. So
# you run it.
#
# What it wires (Hermes shell hooks, which — unlike Hermes *gateway* hooks —
# fire in the CLI, where deskpilot runs the agent):
#   pre_approval_request -> "blocked"   an approval prompt was raised
#   on_session_end       -> "done"      a turn finished
#
# Both point at shell/hermes-hook.sh, the adapter that turns Hermes's stdin-JSON
# hook payload into a POST to /api/event. deskpilot never learns which agent
# sent it, which keeps another agent a config change rather than a code change.
#
# It also pre-allowlists the (event, command) pairs in
# ~/.hermes/shell-hooks-allowlist.json so a deskpilot session does not eat a
# first-use consent prompt mid-run. Re-running is safe: it replaces its own
# entries by command path rather than appending, so moving the repo fixes the
# paths instead of duplicating them. Anything else in either file is untouched.

set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
HOOK="$REPO/shell/hermes-hook.sh"
CONFIG="$HOME/.hermes/config.yaml"
ALLOW="$HOME/.hermes/shell-hooks-allowlist.json"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
[ -x "$HOOK" ] || { echo "missing or not executable: $HOOK"; exit 1; }
[ -f "$CONFIG" ] || { echo "no Hermes config at $CONFIG — is Hermes installed?"; exit 1; }

python3 - "$CONFIG" "$HOOK" <<'PY'
import sys, shutil, time
import yaml   # Hermes ships pyyaml; if this import fails, install Hermes deps first.

config_path, hook = sys.argv[1], sys.argv[2]
shutil.copy(config_path, f"{config_path}.dpbak.{int(time.time())}")

with open(config_path) as f:
    cfg = yaml.safe_load(f) or {}

hooks = cfg.get("hooks") or {}

def upsert(event, kind):
    # Keep entries for other commands; replace only OUR command on this event,
    # so a repo move rewrites the path rather than leaving a stale duplicate.
    entries = [e for e in (hooks.get(event) or [])
               if not str(e.get("command", "")).startswith(hook)]
    entries.append({"command": f"{hook} {kind}"})
    hooks[event] = entries

upsert("pre_approval_request", "blocked")
upsert("on_session_end", "done")
cfg["hooks"] = hooks

with open(config_path, "w") as f:
    yaml.safe_dump(cfg, f, sort_keys=False, default_flow_style=False)

print(f"updated {config_path}")
PY

# Pre-allowlist both (event, command) pairs so an interactive deskpilot session
# is not interrupted by the first-use consent prompt. The allowlist keys on the
# exact command STRING, so it must match what the installer wrote above,
# including the trailing " blocked" / " done" argument.
python3 - "$ALLOW" "$HOOK" <<'PY'
import json, os, sys

allow_path, hook = sys.argv[1], sys.argv[2]
data = {"approvals": []}
if os.path.exists(allow_path):
    try:
        with open(allow_path) as f:
            data = json.load(f) or {"approvals": []}
    except Exception:
        data = {"approvals": []}
data.setdefault("approvals", [])

want = [
    {"event": "pre_approval_request", "command": f"{hook} blocked"},
    {"event": "on_session_end",       "command": f"{hook} done"},
]
# Drop any prior entries for our two commands, then add the current ones.
ours = {(w["event"], w["command"]) for w in want}
data["approvals"] = [
    a for a in data["approvals"]
    if (a.get("event"), a.get("command")) not in ours
    and not str(a.get("command", "")).startswith(hook)
] + want

os.makedirs(os.path.dirname(allow_path), exist_ok=True)
with open(allow_path, "w") as f:
    json.dump(data, f, indent=2)
print(f"allowlisted   {allow_path}")
PY

echo
echo "Wired Hermes hooks:"
echo "  pre_approval_request  ->  $HOOK blocked"
echo "  on_session_end        ->  $HOOK done"
echo
echo "Verify with:  hermes hooks list"
echo
echo "Hooks load when a Hermes session starts, so start deskpilot sessions with"
echo "a fresh 'hermes chat --cli' for them to fire. Launch in CLI mode, not the"
echo "TUI: a phone reads a reflowing shell transcript far better than a full-"
echo "screen TUI captured at desktop width."
echo
echo "Notifications also need turning on once in the web app — the phone grants"
echo "that itself, and nothing here can do it for it."
