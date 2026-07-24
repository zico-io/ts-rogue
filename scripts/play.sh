#!/usr/bin/env bash
# Drive the real game in a detached tmux session so an agent can play it like a
# user: a real PTY (colors, raw input, alt-screen) that persists between calls.
#
#   scripts/play.sh start [seed] [cols] [rows]   boot a fresh deterministic run
#   scripts/play.sh dev [seed] [cols] [rows]     game + interactive pi (on eve's gateway/model), side by side
#   scripts/play.sh key <tokens...>              send keystrokes (tmux key names)
#   scripts/play.sh frame [--plain]              print the current screen (color)
#   scripts/play.sh stop                         kill the session
#
# tmux names special keys directly: Up Down Left Right Enter Escape Tab Space.
# Single characters are sent literally, so `key 3 j o` presses 3, then j, then o.
set -euo pipefail

SESSION=rogue
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYLOG="$ROOT/.play-keys.log"
GAME_PANE="$SESSION:0.0" # window 0, pane 0 is always the game (created first)

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
  # Kitty-graphics tiles are off by default so capture-pane keeps seeing the
  # ASCII glyphs; opt in with TSROGUE_TILES=1 (needs tmux allow-passthrough).
  tiles_env="TSROGUE_NO_TILES=1"
  [ "${TSROGUE_TILES:-}" = "1" ] && tiles_env=""
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" \
    "TS_ROGUE_PLAY=1 $tiles_env pnpm game:dev --seed=$seed --fresh"
  tmux set -t "$SESSION" allow-passthrough on
  echo "started session '$SESSION' (seed=$seed ${cols}x${rows}); give it a moment, then: scripts/play.sh frame"
  ;;
dev)
  # Human iteration layout: the live game and an interactive pi assistant side by
  # side. pi runs on eve's provider (Vercel AI Gateway) and model so local coding
  # help matches the agent; it drives the game via `scripts/play.sh key|frame`.
  require_tmux
  command -v pi >/dev/null 2>&1 || {
    echo "pi is required (see pi docs)" >&2
    exit 1
  }
  seed="${1:-1}"
  cols="${2:-200}"
  rows="${3:-50}"
  # eve's model is the source of truth (agent/agent.ts); override with PI_MODEL.
  pi_model="${PI_MODEL:-anthropic/claude-sonnet-5}"
  # Keep this quote-free: it is single-quoted into the split-window command below.
  pi_prompt="The ts-rogue terminal game runs live in the tmux pane beside you. \
Drive it by running scripts/play.sh key <tokens...> and read the screen with scripts/play.sh frame. \
tmux key names: Up Down Left Right Enter Escape Tab Space; single characters send literally."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  : >"$KEYLOG"
  tiles_env="TSROGUE_NO_TILES=1"
  [ "${TSROGUE_TILES:-}" = "1" ] && tiles_env=""
  # pane 0: the live game under tsx --watch, so pi's code edits reload it. (`start`
  # stays unwatched: the agent play flow needs a stable, restart-free session.)
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" \
    "TS_ROGUE_PLAY=1 $tiles_env pnpm game:watch --seed=$seed --fresh"
  tmux set -t "$SESSION" allow-passthrough on
  tmux set -t "$SESSION" window-size manual # stable pane sizes for frame captures
  # pi's vercel-ai-gateway provider authenticates via AI_GATEWAY_API_KEY (env or a
  # stored `pi /login`). The project's VERCEL_OIDC_TOKEN lists models but 401s on
  # inference, so we don't inject it. Warn once if no gateway credential is in reach.
  if [ -z "${AI_GATEWAY_API_KEY:-}" ] && ! grep -q vercel-ai-gateway ~/.pi/agent/auth.json 2>/dev/null; then
    echo "note: pi has no Vercel AI Gateway credential; run 'pi /login' (Vercel AI Gateway) or set AI_GATEWAY_API_KEY" >&2
  fi
  # pane 1: interactive pi on eve's provider. Source .env.local INSIDE the pane so a
  # gateway key placed there flows through without landing on a command line / in `ps`.
  tmux split-window -h -l 80 -t "$GAME_PANE" -c "$ROOT" \
    "set -a; [ -f .env.local ] && . ./.env.local; set +a; \
     exec pi --provider vercel-ai-gateway --model '$pi_model' --append-system-prompt '$pi_prompt'"
  tmux select-pane -t "$SESSION:0.1" # focus pi so the user can type
  echo "started dev layout on eve's provider ($pi_model, seed=$seed ${cols}x${rows}); attach: tmux attach -t $SESSION"
  ;;
key)
  require_tmux
  require_session
  [ "$#" -gt 0 ] || {
    echo "usage: scripts/play.sh key <tokens...>" >&2
    exit 1
  }
  tmux send-keys -t "$GAME_PANE" "$@"
  # Record the repro sequence so the in-game `issue` command can embed it.
  printf '%s\n' "$*" >>"$KEYLOG"
  ;;
frame)
  require_tmux
  require_session
  if [ "${1:-}" = "--plain" ]; then
    tmux capture-pane -t "$GAME_PANE" -p
  else
    tmux capture-pane -t "$GAME_PANE" -p -e
  fi
  ;;
stop)
  require_tmux
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "stopped" || echo "no session"
  ;;
*)
  echo "usage: scripts/play.sh {start|dev|key|frame|stop}" >&2
  exit 1
  ;;
esac
