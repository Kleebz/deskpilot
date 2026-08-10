#!/usr/bin/env bash
#
# List tmux sessions and, where one is visible in a terminal window, the
# Hyprland workspace it is displayed on.
#
#   scripts/sessions.sh          JSON array
#   scripts/sessions.sh --plain  one line per session
#
# Deliberately agent-agnostic. It reports tmux sessions, not Claude sessions —
# nothing here knows or cares what is running inside them. Swapping Claude Code
# for another agent, or a bare shell, changes nothing.
#
# Mapping chain: tmux client pid -> walk parent pids -> match a Hyprland
# window's pid -> that window's workspace. A session with no attached client
# is "detached": real and routable, just not on screen anywhere.

set -uo pipefail

CLIENTS=$(hyprctl clients -j 2>/dev/null || echo '[]')

# Walk up the process tree until a pid matches a Hyprland window.
workspace_for_pid() {
  local p="${1:-}" ws
  for _ in 1 2 3 4 5 6; do
    if [ -z "$p" ] || [ "$p" = "1" ] || [ "$p" = "0" ]; then return 1; fi
    ws=$(printf '%s' "$CLIENTS" | jq -r --argjson p "$p" \
      'first(.[] | select(.pid == $p) | .workspace.id) // empty' 2>/dev/null)
    if [ -n "$ws" ]; then printf '%s' "$ws"; return 0; fi
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# session_name -> client pid (empty when detached)
declare -A CLIENT_PID
while read -r name pid; do
  [ -n "${name:-}" ] && CLIENT_PID["$name"]="$pid"
done < <(tmux list-clients -F '#{session_name} #{client_pid}' 2>/dev/null)

rows=()
while IFS=$'\t' read -r name created path; do
  [ -z "${name:-}" ] && continue
  ws=""
  if [ -n "${CLIENT_PID[$name]:-}" ]; then
    ws=$(workspace_for_pid "${CLIENT_PID[$name]}") || ws=""
  fi
  rows+=("$(jq -nc \
    --arg n "$name" --arg c "$created" --arg p "$path" --arg w "$ws" \
    '{session:$n, created:($c|tonumber? // 0), path:$p,
      workspace:($w|if . == "" then null else tonumber end),
      attached:($w != "")}')")
done < <(tmux list-sessions -F '#{session_name}	#{session_created}	#{session_path}' 2>/dev/null)

if [ "${1:-}" = "--plain" ]; then
  if [ ${#rows[@]} -eq 0 ]; then echo "(no tmux sessions)"; exit 0; fi
  printf '%s\n' "${rows[@]}" | jq -r '
    "\(if .workspace then "ws\(.workspace)" else "detached" end)\t\(.session)\t\(.path)"' \
    | column -t -s $'\t'
else
  if [ ${#rows[@]} -eq 0 ]; then echo '[]'; exit 0; fi
  printf '%s\n' "${rows[@]}" | jq -s 'sort_by(.workspace // 99)'
fi
