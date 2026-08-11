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
#   desk.sh type [text]                type into the FOCUSED window (stdin if no arg)
#   desk.sh key <name...>              press keys: enter escape tab up down left right
#   desk.sh click <x> <y>              move the pointer and left-click
#   desk.sh unlock                     read a password on stdin and unlock hyprlock
#
# The input commands need ydotool — see shell/install-input.sh. They are
# deliberately NOT exposed by the server except `unlock`: an agent you are
# talking to may drive the desktop, an HTTP endpoint may not.
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

need_ydotool() {
  command -v ydotool >/dev/null || die "ydotool not installed — see shell/install-input.sh"
  [ -S "${YDOTOOL_SOCKET:-/run/user/$(id -u)/.ydotool_socket}" ] \
    || pidof ydotoold >/dev/null \
    || die "ydotoold is not running — see shell/install-input.sh"
}

# Linux input keycodes for the keys worth reaching from a script.
keycode() {
  case "$1" in
    enter|return) echo 28 ;;  escape|esc) echo 1 ;;
    tab) echo 15 ;;           backspace) echo 14 ;;
    space) echo 57 ;;         delete) echo 111 ;;
    up) echo 103 ;;           down) echo 108 ;;
    left) echo 105 ;;         right) echo 106 ;;
    home) echo 102 ;;         end) echo 107 ;;
    pageup) echo 104 ;;       pagedown) echo 109 ;;
    *) return 1 ;;
  esac
}

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
        | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])|\(.size[0])|\(.workspace.id)") // empty')
    [ -n "$info" ] || die "no window with address $addr"
    geo=${info%%|*}
    rest=${info#*|}
    w=${rest%%|*}
    target_ws=${rest##*|}

    # grim -g crops the COMPOSITED OUTPUT, not the window's own buffer, and
    # Hyprland only composites the visible workspace. Capturing a window on a
    # hidden workspace therefore returns whatever is at those coordinates right
    # now — a different window entirely, changing as the visible workspace
    # changes. Switch there, capture, switch back.
    active_ws=$(hyprctl monitors -j | jq -r 'first(.[] | .activeWorkspace.id)')
    switched=0
    if [ -n "$target_ws" ] && [ "$target_ws" != "$active_ws" ]; then
      hyprctl dispatch workspace "$target_ws" >/dev/null
      sleep 0.35
      switched=1
    fi

    if [ "${w:-0}" -gt "$maxw" ]; then
      scale=$(awk -v m="$maxw" -v w="$w" 'BEGIN{printf "%.3f", m/w}')
      grim -g "$geo" -s "$scale" -t jpeg -q "$q" "$out"; rc=$?
    else
      grim -g "$geo" -t jpeg -q "$q" "$out"; rc=$?
    fi

    # Restore the view even if grim failed, so a bad capture never strands the
    # desktop on a workspace the user did not choose.
    [ "$switched" = 1 ] && hyprctl dispatch workspace "$active_ws" >/dev/null
    [ "$rc" -eq 0 ] || die "grim failed"
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

  # ---- input (ydotool). Everything below needs ydotoold running. ----

  type)
    need_ydotool
    # Read from stdin when no argument, so a password never appears in argv —
    # /proc/*/cmdline is world-readable.
    if [ $# -gt 0 ]; then printf '%s' "$*" | ydotool type --file -
    else ydotool type --file -
    fi
    ;;

  key)
    need_ydotool
    [ $# -gt 0 ] || die "key name required"
    codes=""
    for k in "$@"; do
      c=$(keycode "$k") || die "unknown key: $k"
      codes="$codes $c:1 $c:0"
    done
    # shellcheck disable=SC2086
    ydotool key $codes
    ;;

  click)
    need_ydotool
    x=${1:?x required}; y=${2:?y required}
    ydotool mousemove --absolute -x "$x" -y "$y"
    sleep 0.05
    ydotool click 0xC0          # left press + release
    ;;

  # Types a password into hyprlock and presses enter. This goes THROUGH
  # authentication — hyprlock validates via PAM exactly as if typed at the
  # desk. Nothing is bypassed; a wrong password fails normally.
  unlock)
    need_ydotool
    is_locked || die "screen is not locked"
    ydotool type --file -       # password on stdin, never argv, never logged
    sleep 0.2
    ydotool key 28:1 28:0       # Enter
    for _ in 1 2 3 4 5 6 7 8; do
      sleep 0.5
      is_locked || { echo unlocked; exit 0; }
    done
    die "still locked — wrong password, or ydotool is not reaching hyprlock"
    ;;

  *) die "unknown command: $cmd" ;;
esac
