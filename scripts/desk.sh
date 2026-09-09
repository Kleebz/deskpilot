#!/usr/bin/env bash
#
# Desktop state and control for Hyprland. Plain shell, no agent required —
# callable from a server endpoint, a keybind, or an LLM.
#
#   desk.sh state [ws]      window state, one line each (all, or one workspace)
#   desk.sh json [ws]       same, as JSON
#   desk.sh capabilities    what this host can do, as JSON (works with no WM)
#   desk.sh addr [port]     the URL a phone can open this machine at, if any
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
#   desk.sh unlock                     read a password on stdin and unlock the screen
#
# The input commands need ydotool — see shell/install-input.sh. They are
# deliberately NOT exposed by the server except `unlock`: an agent you are
# talking to may drive the desktop, an HTTP endpoint may not.
#
# Verified on Hyprland 0.56.2, single 1920x1080 output DP-2. 0.56.2 moved
# `hyprctl dispatch` to a Lua API — see lua_str below. Nothing here works on
# the pre-Lua syntax, and nothing there works here.

set -uo pipefail

die() { echo "$*" >&2; exit 1; }
have_env() { [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; }

have_env || {
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  export HYPRLAND_INSTANCE_SIGNATURE=$(ls -t "$XDG_RUNTIME_DIR/hypr" 2>/dev/null | head -1)
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
}
# Omarchy replaced hyprlock with a compositor-integrated lock, so `pidof
# hyprlock` — once the only reliable check — now matches nothing and reports
# "unlocked" forever. That disarmed both callers silently: unlock refused to
# run because it thought nothing was locked, and the capture guard stopped
# guarding, so `grim` would hand back a photograph of the lock screen.
#
# Three states, not two. The compositor helper answers "undetermined" when
# Hyprland stops at an earlier reason before it ever considers the lock, and
# both callers have to fail closed on that — but they fail closed in *opposite*
# directions. A capture must refuse unless the screen is known unlocked. Unlock
# must refuse unless it is known locked, because typing a password at an
# unlocked desktop types it into whatever window has focus.
LOCK_PROCESS="${DESKPILOT_LOCK_PROCESS:-hyprlock}"

lock_state() {
  if command -v omarchy-hyprland-session-locked >/dev/null 2>&1; then
    omarchy-hyprland-session-locked >/dev/null 2>&1
    case $? in
      0) echo locked ;;
      1) echo unlocked ;;
      *) echo unknown ;;
    esac
  elif command -v "$LOCK_PROCESS" >/dev/null 2>&1; then
    if pidof "$LOCK_PROCESS" >/dev/null; then echo locked; else echo unlocked; fi
  elif command -v loginctl >/dev/null 2>&1 &&
    [ -n "$(loginctl show-session "${XDG_SESSION_ID:-}" -p LockedHint --value 2>/dev/null)" ]
  then
    # UNVERIFIED on anything but this machine. hyprlock does not set LockedHint,
    # which is where "loginctl cannot detect the lock" came from — but that is a
    # fact about hyprlock, not about loginctl, and GNOME and KDE do set it.
    # Only trusted when it answers at all: an empty reply is not a "no".
    case "$(loginctl show-session "${XDG_SESSION_ID:-}" -p LockedHint --value 2>/dev/null)" in
      yes) echo locked ;;
      no)  echo unlocked ;;
      *)   echo unknown ;;
    esac
  else
    # No detector at all. Saying "unlocked" here is what caused the bug above,
    # so say so honestly and let both callers refuse.
    echo unknown
  fi
}

known_unlocked() { [ "$(lock_state)" = unlocked ]; }
known_locked()   { [ "$(lock_state)" = locked ]; }

# `addr` answers the one question pairing cannot proceed without: what address
# does a phone type. It lives here, beside `capabilities`, because it has the
# same requirement — pairing a headless box over SSH is the normal case, so it
# must not need a compositor.
#
# It exists because the packaged binary cannot work this out for itself. That
# binary runs under --allow-run=tmux,ps,hyprctl,desk.sh with no --allow-sys, so
# it can neither ask Tailscale what this machine is called nor read its own
# interfaces — and `deskpilot pair` consequently printed a code with no address
# and no QR, telling the operator to go and run `tailscale status` themselves.
# That is a dead end at exactly the moment nothing is paired yet and the app
# cannot draw the QR either. desk.sh is already on that allowlist, so putting
# the answer here costs no new permission at all.
#
# Every candidate is FETCHED before it is offered, rather than inferred from
# having an address. The server binds loopback by default, so owning a tailnet
# IP says nothing about whether anything is listening on it: without `tailscale
# serve` in front there is no reachable address, and printing one regardless
# yields a QR that leads to a connection refused — which reads as broken
# pairing. When nothing answers, the honest output is no output and exit 1, and
# the caller says what to start.
if [ "${1:-}" = addr ]; then
  addr_port=${2:-${DESKPILOT_PORT:-8790}}

  # No curl is not evidence of an unreachable address, so it means "offer the
  # best guess" rather than "reject everything".
  answers() {
    command -v curl >/dev/null 2>&1 || return 0
    curl -s -m 5 -o /dev/null "$1/"
  }

  if command -v tailscale >/dev/null 2>&1; then
    # Serve first: port 443 with no port to type, and the only origin a browser
    # treats as secure — which is what makes the app installable and what web
    # push needs. A LAN address works until you leave the building.
    served=$(tailscale serve status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9.-]+' | head -1)
    if [ -n "$served" ] && answers "$served"; then echo "$served"; exit 0; fi
    tsip=$(tailscale ip -4 2>/dev/null | head -1)
    if [ -n "$tsip" ] && answers "http://$tsip:$addr_port"; then
      echo "http://$tsip:$addr_port"; exit 0
    fi
  fi

  lan=$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
  if [ -n "$lan" ] && answers "http://$lan:$addr_port"; then
    echo "http://$lan:$addr_port"; exit 0
  fi

  exit 1
fi

# `capabilities` has to answer on a host with no compositor at all — that is
# the entire point of asking — so it is handled before the check that would
# refuse to run. Everything else still requires Hyprland.
if [ "${1:-}" = capabilities ]; then
  hypr=false; shot=false; input=false; lock=unknown; hyprver=""; tooold=false
  if have_env && hyprctl version >/dev/null 2>&1; then
    hypr=true
    # 0.56.2 moved every dispatcher to a Lua API. Nothing in this file works on
    # the older `hyprctl dispatch` syntax, and the failure is silent: the
    # dispatcher errors, the window does not move, and nobody is looking. Report
    # the version so the caller can say so instead of appearing to work.
    hyprver=$(hyprctl version 2>/dev/null | sed -n 's/^Hyprland \([0-9][0-9.]*\).*/\1/p' | head -1)
    if [ -n "$hyprver" ]; then
      # Sort-based compare: no bash arithmetic on dotted versions, and this has
      # to run under sh on a machine we know nothing about.
      older=$(printf '%s\n%s\n' "$hyprver" "0.56.2" | sort -V | head -1)
      [ "$older" = "0.56.2" ] || tooold=true
    fi
    command -v grim >/dev/null 2>&1 && shot=true
  fi

  # Input is checked outside the compositor block on purpose. ydotool writes to
  # /dev/uinput, which is the kernel — it is why this works on a lock screen at
  # all, since it sits below the Wayland layer that refuses virtual keyboards.
  # It has no idea what compositor is running and does not care. Nesting this
  # inside the Hyprland check meant a GNOME, KDE or Sway machine reported it
  # could not type, which was never true.
  if command -v ydotool >/dev/null 2>&1 &&
    { [ -S "${YDOTOOL_SOCKET:-/run/user/$(id -u)/.ydotool_socket}" ] || pidof ydotoold >/dev/null 2>&1; }
  then
    input=true
  fi
  # Asks the same detector the guards use, rather than repeating its checks.
  # The two had already drifted: this said "unknown" on a machine where
  # lock_state answered "unlocked", which is how a capture guard and the thing
  # describing it end up disagreeing.
  #
  # Reported separately from `shot`: a host that cannot tell whether it is
  # locked must refuse to capture, so the UI needs to know which of the two
  # reasons it is looking at.
  case "$(lock_state)" in
    locked | unlocked) lock=readable ;;
    *) lock=unknown ;;
  esac
  # `unsupported` is true when a compositor is present but too old to drive.
  # Distinct from "no compositor": the difference is what the UI should say.
  printf '{"windows":%s,"screenshot":%s,"input":%s,"lock":"%s","compositor":"%s","compositorVersion":"%s","unsupported":%s}\n' \
    "$([ "$hypr" = true ] && [ "$tooold" = false ] && echo true || echo false)" \
    "$([ "$shot" = true ] && [ "$lock" = readable ] && [ "$tooold" = false ] && echo true || echo false)" \
    "$input" \
    "$lock" "$([ "$hypr" = true ] && echo hyprland || echo none)" \
    "$hyprver" "$tooold"
  exit 0
fi

# Input and unlock need ydotool and a lock detector, neither of which involves a
# compositor — so they are handled before the check that demands one. Windows and
# screenshots still require Hyprland, and still say so.
case "${1:-}" in
  type | key | unlock) ;;
  *) have_env || die "no Hyprland instance found" ;;
esac


# Hyprland 0.56.2 parses `hyprctl dispatch` as Lua: the old
# `dispatch exec "[workspace 7 silent] foo"` form is now a syntax error, and
# every dispatcher is reached through `hl.dsp.*` taking a table of named args.
# Anything interpolated into one of those has to be a real Lua string literal,
# so escape it rather than pasting it in raw.
lua_str() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# Switching the visible workspace. Wrapped because three commands below need it
# and the dispatcher name is no longer guessable from the old one.
go_workspace() { hyprctl dispatch "hl.dsp.focus({ workspace = $(lua_str "$1") })" >/dev/null; }

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
    st=$(lock_state)
    echo "$st"
    [ "$st" = locked ] && exit 0 || exit 1
    ;;

  # grim succeeds on a locked session and returns a picture of the password
  # prompt. Refusing is the only sane default — the caller cannot tell.
  shot)
    out=${1:-/tmp/desk.jpg}; ws=${2:-}
    known_unlocked || die "screen is $(lock_state) — capture would return the lock screen"
    if [ -n "$ws" ]; then
      go_workspace "$ws"
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
    known_unlocked || die "screen is $(lock_state) — capture would return the lock screen"
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
      go_workspace "$target_ws"
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
    [ "$switched" = 1 ] && go_workspace "$active_ws"
    [ "$rc" -eq 0 ] || die "grim failed"
    echo "$out"
    ;;

  move)
    addr=${1:?address required}; ws=${2:?workspace required}
    # `follow = false` is what movetoworkspace*silent* used to mean: move the
    # window without dragging the view along with it.
    hyprctl dispatch "hl.dsp.window.move({ window = $(lua_str "address:$addr"), workspace = $(lua_str "$ws"), follow = false })"
    ;;

  # Floating and fullscreen are independent states and both block the tiler.
  # 0.56.2 replaced the toggles with setters that take a window selector, so
  # this no longer has to read the state first, focus the window, or reason
  # about which way a toggle will flip. Both calls are idempotent.
  #
  # Note that `window.fullscreen` is still a toggle and has no "off" mode —
  # `fullscreen_state` with 0/0 is the only way to clear fullscreen outright.
  tile)
    addr=${1:?address required}
    hyprctl clients -j | jq -e --arg a "$addr" 'any(.[]; .address == $a)' >/dev/null \
      || die "no window with address $addr"
    sel=$(lua_str "address:$addr")
    hyprctl dispatch "hl.dsp.window.fullscreen_state({ window = $sel, internal = 0, client = 0 })" >/dev/null
    hyprctl dispatch "hl.dsp.window.float({ window = $sel, action = \"disable\" })" >/dev/null
    ;;

  place)
    ws=${1:?workspace required}; shift
    [ $# -gt 0 ] || die "command required"
    # Window rules that used to ride along in `[brackets]` are now a table
    # passed beside the command. The command stays one string — Hyprland splits
    # it — so it must be escaped as a Lua literal, not concatenated in.
    hyprctl dispatch "hl.dsp.exec_cmd($(lua_str "$*"), { workspace = $(lua_str "$ws silent") })"
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

  # ydotool's absolute coordinates do not necessarily land where you ask:
  # measured here, asking for 200,200 put the cursor at 400,400 — a 2x scale,
  # with anything past half-screen clamping to the edge. The factor depends on
  # how the virtual device advertises its axes, so rather than hardcode it,
  # move, read the real position back from the compositor, and correct.
  click)
    need_ydotool
    x=${1:?x required}; y=${2:?y required}
    # The error is multiplicative, not additive — correcting by the difference
    # oscillates (ask 200, land 400, ask 0, land 0, ask 200...). Scale instead.
    aim_x=$x; aim_y=$y
    for _ in 1 2 3 4; do
      ydotool mousemove --absolute -x "$aim_x" -y "$aim_y" >/dev/null 2>&1
      sleep 0.12
      pos=$(hyprctl cursorpos 2>/dev/null | tr -d ' ')
      cx=${pos%%,*}; cy=${pos##*,}
      [ -z "${cx:-}" ] && break
      dx=$((x - cx)); dy=$((y - cy))
      [ "${dx#-}" -le 2 ] && [ "${dy#-}" -le 2 ] && break
      # aim <- aim * wanted / landed, guarding against a zero landing
      [ "$cx" -gt 0 ] && aim_x=$(( aim_x * x / cx )) || aim_x=$(( aim_x + dx ))
      [ "$cy" -gt 0 ] && aim_y=$(( aim_y * y / cy )) || aim_y=$(( aim_y + dy ))
      [ "$aim_x" -lt 0 ] && aim_x=0
      [ "$aim_y" -lt 0 ] && aim_y=0
    done
    final=$(hyprctl cursorpos 2>/dev/null | tr -d ' ')
    echo "cursor at $final (wanted $x,$y)"
    ydotool click 0xC0 >/dev/null 2>&1   # left press + release
    ;;

  # Types a password into the lock screen and presses enter. This goes THROUGH
  # authentication — the locker validates via PAM exactly as if typed at the
  # desk. Nothing is bypassed; a wrong password fails normally. ydotool writes
  # to /dev/uinput, below the Wayland layer, so it reaches a lock surface that
  # refuses the virtual-keyboard protocol.
  unlock)
    need_ydotool
    known_locked || die "screen is $(lock_state) — refusing to type a password"
    ydotool type --file -       # password on stdin, never argv, never logged
    sleep 0.2
    ydotool key 28:1 28:0       # Enter
    # PAM is not instant and a *failed* auth is deliberately slower still, so a
    # short window reports failure for an unlock that is about to succeed. Ten
    # seconds costs nothing on the wrong-password path, which stays locked
    # regardless.
    for _ in $(seq 1 20); do
      sleep 0.5
      known_unlocked && { echo unlocked; exit 0; }
    done
    die "still locked — password rejected"
    ;;

  *) die "unknown command: $cmd" ;;
esac
