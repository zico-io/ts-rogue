#!/usr/bin/env bash
# Drive the real game in a detached tmux session so an agent can play it like a
# user: a real PTY (colors, raw input, alt-screen) that persists between calls.
#
#   scripts/play.sh start [seed] [cols] [rows]   boot a fresh deterministic run
#   scripts/play.sh key <tokens...>              send keystrokes (tmux key names)
#   scripts/play.sh frame [--plain]              print the current screen (color)
#   scripts/play.sh stop                         kill the session
#
# tmux names special keys directly: Up Down Left Right Enter Escape Tab Space.
# Single characters are sent literally, so `key 3 j o` presses 3, then j, then o.
set -euo pipefail

SESSION=rogue
KEYLOG="$(cd "$(dirname "$0")/.." && pwd)/.play-keys.log"

require_tmux() {
  command -v tmux >/dev/null 2>&1 || {
    echo "tmux is required: brew install tmux" >&2
    exit 1
  }
}

require_session() {
  tmux has-session -t "$SESSION" 2>/dev/null || {
    echo "no play session; run: scripts/play.sh start" >&2
    exit 1
  }
}

cmd="${1:-}"
shift || true

case "$cmd" in
start)
  require_tmux
  seed="${1:-1}"
  cols="${2:-120}"
  rows="${3:-40}"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  : >"$KEYLOG"
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" \
    "TS_ROGUE_PLAY=1 pnpm game:dev --seed=$seed --fresh"
  echo "started session '$SESSION' (seed=$seed ${cols}x${rows}); give it a moment, then: scripts/play.sh frame"
  ;;
key)
  require_tmux
  require_session
  [ "$#" -gt 0 ] || {
    echo "usage: scripts/play.sh key <tokens...>" >&2
    exit 1
  }
  tmux send-keys -t "$SESSION" "$@"
  # Record the repro sequence so the in-game `issue` command can embed it.
  printf '%s\n' "$*" >>"$KEYLOG"
  ;;
frame)
  require_tmux
  require_session
  if [ "${1:-}" = "--plain" ]; then
    tmux capture-pane -t "$SESSION" -p
  else
    tmux capture-pane -t "$SESSION" -p -e
  fi
  ;;
stop)
  require_tmux
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "stopped" || echo "no session"
  ;;
*)
  echo "usage: scripts/play.sh {start|key|frame|stop}" >&2
  exit 1
  ;;
esac
