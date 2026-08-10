#!/usr/bin/env bash
#
# Desktop state and control for Hyprland. Plain shell, no agent required —
# callable from a server endpoint, a keybind, or an LLM.
#
#   desk.sh state [ws]      window state, one line each (all, or one workspace)
#   desk.sh json [ws]       same, as JSON
#   desk.sh locked          "locked" or "unlocked"; exit 0 if locked
#   desk.sh shot [out] [ws] screenshot, refuses when locked
#   desk.sh shot-window <addr> [out]   crop to one window at readable quality
#   desk.sh move <addr> <ws>           move a window to a workspace, silently
#   desk.sh tile <addr>                clear float+fullscreen so the tiler takes over
#   desk.sh place <ws> <cmd...>        launch a command in a window on a workspace
#
# Verified on Hyprland 0.56.0, single 1920x1080 output DP-2.

set -uo pipefail

die() { echo "$*" >&2; exit 1; }
have_env() { [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; }

have_env || {
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export HYPRLAND_INSTANCE_SIGNATURE=$(ls -t "$XDG_RUNTIME_DIR/hypr" 2>/dev/null | head -1)
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
}
have_env || die "no Hyprland instance found"

is_locked() { pidof hyprlock >/dev/null; }

cmd=${1:-state}; shift || true

case "$cmd" in

  state)
    ws=${1:-}
    hyprctl clients -j | jq -r --arg ws "$ws" '
      sort_by(.workspace.id)[]
      | select($ws == "" or (.workspace.id|tostring) == $ws)
      | "ws\(.workspace.id)\t\(.address)\t\(.at|join(","))+\(.size|join("x"))\t\(
          if .fullscreen != 0 then "fs" elif .floating then "float" else "tiled" end
        )\t\(.class)\t\(.title)"' | column -t -s $'\t'
    ;;

  json)
    ws=${1:-}
    hyprctl clients -j | jq --arg ws "$ws" '
      [ sort_by(.workspace.id)[]
        | select($ws == "" or (.workspace.id|tostring) == $ws)
        | {address, workspace: .workspace.id, at, size,
           floating, fullscreen, class, title} ]'
    ;;

  locked)
    if is_locked; then echo locked; exit 0; else echo unlocked; exit 1; fi
    ;;

  # grim succeeds on a locked session and returns a picture of the password
  # prompt. Refusing is the only sane default — the caller cannot tell.
  shot)
    out=${1:-/tmp/desk.jpg}; ws=${2:-}
    is_locked && die "screen is locked — capture would return the lock screen"
    if [ -n "$ws" ]; then
      hyprctl dispatch workspace "$ws" >/dev/null
      sleep 0.3
    fi
    grim -t jpeg -q 60 -s 0.5 "$out" || die "grim failed"
    echo "$out"
    ;;

  # Cropped, scaled down only past MAXW.
  #
  # Measured, because the intuition here is wrong: JPEG size is driven by
  # CONTENT, not dimensions. The same 941x1030 terminal measured 38 KB when
  # mostly empty and 210 KB when full of syntax-coloured text. Scale is a much
  # stronger lever than quality (210 -> 80 KB at s=0.6; only 210 -> 132 KB at
  # q45) but scaling is precisely what destroys the legibility a crop was for.
  #
  # The real conclusion: do not screenshot terminals. `tmux capture-pane`
  # returns the same information as ~2 KB of text that reflows on a phone.
  # This path is for GUI windows — a browser, a design tool, an app you are
  # building — where pixels are the only representation.
  shot-window)
    addr=${1:?address required}; out=${2:-/tmp/desk-window.jpg}
    maxw=${DESKPILOT_MAX_WIDTH:-1200}
    q=${DESKPILOT_QUALITY:-70}
    is_locked && die "screen is locked — capture would return the lock screen"
    info=$(hyprctl clients -j | jq -r --arg a "$addr" \
      'first(.[] | select(.address == $a)
        | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])|\(.size[0])") // empty')
    [ -n "$info" ] || die "no window with address $addr"
    geo=${info%|*}
    w=${info##*|}

    if [ "${w:-0}" -gt "$maxw" ]; then
      scale=$(awk -v m="$maxw" -v w="$w" 'BEGIN{printf "%.3f", m/w}')
      grim -g "$geo" -s "$scale" -t jpeg -q "$q" "$out" || die "grim failed"
    else
      grim -g "$geo" -t jpeg -q "$q" "$out" || die "grim failed"
    fi
    echo "$out"
    ;;

  move)
    addr=${1:?address required}; ws=${2:?workspace required}
    hyprctl dispatch movetoworkspacesilent "$ws,address:$addr"
    ;;

  # Floating and fullscreen are independent states and both block the tiler.
  # `dispatch fullscreen` is a toggle, so read before acting.
  tile)
    addr=${1:?address required}
    info=$(hyprctl clients -j | jq -r --arg a "$addr" \
      'first(.[] | select(.address == $a) | "\(.floating) \(.fullscreen)") // empty')
    [ -n "$info" ] || die "no window with address $addr"
    read -r floating fullscreen <<<"$info"
    batch="dispatch focuswindow address:$addr"
    [ "$fullscreen" != "0" ] && batch="$batch ; dispatch fullscreen 0"
    [ "$floating" = "true" ] && batch="$batch ; dispatch togglefloating address:$addr"
    hyprctl --batch "$batch" >/dev/null
    ;;

  place)
    ws=${1:?workspace required}; shift
    [ $# -gt 0 ] || die "command required"
    hyprctl dispatch exec "[workspace $ws silent] $*"
    ;;

  *) die "unknown command: $cmd" ;;
esac
