#!/bin/sh
# Shared by session.sh, desk.sh and check.sh. Source this file; it does not
# launch anything until deskpilot_terminal_command is called.

deskpilot_terminal_select() (
  # A per-command environment override wins over the config file. Read the
  # latter here too: a desktop launcher does not inherit the service's env.
  dp_override_set=${DESKPILOT_TERMINAL+x}
  dp_override=${DESKPILOT_TERMINAL-}
  dp_config=${DESKPILOT_CONFIG:-$HOME/.config/deskpilot/config}
  if [ -f "$dp_config" ]; then
    [ -r "$dp_config" ] || { echo "cannot read $dp_config" >&2; exit 1; }
    . "$dp_config" || exit 1
  fi
  if [ "$dp_override_set" = x ]; then
    DESKPILOT_TERMINAL=$dp_override
  fi
  dp_terminal=${DESKPILOT_TERMINAL:-auto}
  if [ "$dp_terminal" != auto ]; then
    command -v "$dp_terminal" || {
      echo "$dp_terminal not found — set DESKPILOT_TERMINAL to an executable in $dp_config" >&2
      exit 1
    }
    exit
  fi

  # Let the desktop resolve its own preference and launch arguments. A present
  # dispatcher with no usable terminal is not a usable default.
  if command -v xdg-terminal-exec >/dev/null 2>&1 &&
      xdg-terminal-exec --print-id >/dev/null 2>&1; then
    command -v xdg-terminal-exec
    exit
  fi
  if [ -n "${TERMINAL:-}" ] && command -v "$TERMINAL" >/dev/null 2>&1; then
    case "${TERMINAL##*/}" in
      xdg-terminal-exec)
        if "$TERMINAL" --print-id >/dev/null 2>&1; then command -v "$TERMINAL"; exit; fi ;;
      *) command -v "$TERMINAL"; exit ;;
    esac
  fi
  for dp_terminal in ghostty alacritty kitty foot wezterm gnome-terminal konsole xterm; do
    if command -v "$dp_terminal" >/dev/null 2>&1; then
      command -v "$dp_terminal"
      exit
    fi
  done
  echo "no terminal found — install xdg-terminal-exec or set DESKPILOT_TERMINAL in $dp_config" >&2
  exit 1
)

# Pass a complete argv to a callback: `exec` for a local launch, or the
# compositor placement function for a phone request. Never eval a command.
deskpilot_terminal_command() (
  dp_callback=$1
  dp_terminal=$2
  shift 2
  # Distinct GTK application IDs prevent Ghostty's single-instance dispatcher
  # from merging all Deskpilot windows into the same PID. Keep these valid
  # D-Bus names; session names and titles need not obey that grammar.
  dp_app_id=com.deskpilot.Terminal.p$$
  if IFS= read -r dp_nonce < /proc/sys/kernel/random/uuid; then
    dp_app_id=com.deskpilot.Terminal.n$dp_nonce
  fi
  # Local `deskpilot run` can record the window identity once it has chosen
  # the final session name (including any collision suffix).
  DESKPILOT_WINDOW_CLASS=$dp_app_id
  export DESKPILOT_WINDOW_CLASS
  case "${dp_terminal##*/}" in
    xdg-terminal-exec)
      "$dp_callback" "$dp_terminal" "--app-id=$dp_app_id" -- "$@" ;;
    ghostty)
      "$dp_callback" "$dp_terminal" --gtk-single-instance=false "--class=$dp_app_id" -e "$@" ;;
    gnome-terminal|kgx)
      "$dp_callback" "$dp_terminal" -- "$@" ;;
    mate-terminal)
      "$dp_callback" "$dp_terminal" -x "$@" ;;
    wezterm)
      "$dp_callback" "$dp_terminal" start --always-new-process -- "$@" ;;
    konsole)
      "$dp_callback" "$dp_terminal" --separate -e "$@" ;;
    *)
      # Existing overrides and custom wrappers retain their -e CMD contract.
      "$dp_callback" "$dp_terminal" -e "$@" ;;
  esac
)
