#!/usr/bin/env bash
set -euo pipefail

SESSION=rogue
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYLOG="$ROOT/.play-keys.log"
GAME_PANE="$SESSION:0.0"

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
dev)
  require_tmux
  command -v pi >/dev/null 2>&1 || {
    echo "pi is required (see pi docs)" >&2
    exit 1
  }
  seed="${1:-1}"
  cols="${2:-200}"
  rows="${3:-50}"
  pi_model="${PI_MODEL:-anthropic/claude-sonnet-5}"
  pi_prompt="The ts-rogue terminal game runs live in the tmux pane beside you. \
Drive it by running scripts/play.sh key <tokens...> and read the screen with scripts/play.sh frame. \
tmux key names: Up Down Left Right Enter Escape Tab Space; single characters send literally."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  : >"$KEYLOG"
  tmux new-session -d -s "$SESSION" -x "$cols" -y "$rows" \
    "TS_ROGUE_PLAY=1 pnpm game:watch --seed=$seed --fresh"
  tmux set -t "$SESSION" window-size manual # stable pane sizes for frame captures
  if [ -z "${AI_GATEWAY_API_KEY:-}" ] && ! grep -q vercel-ai-gateway ~/.pi/agent/auth.json 2>/dev/null; then
    echo "note: pi has no Vercel AI Gateway credential; run 'pi /login' (Vercel AI Gateway) or set AI_GATEWAY_API_KEY" >&2
  fi
  tmux split-window -h -l 80 -t "$GAME_PANE" -c "$ROOT" \
    "set -a; [ -f .env.local ] && . ./.env.local; set +a; \
     exec pi --provider vercel-ai-gateway --model '$pi_model' --append-system-prompt '$pi_prompt'"
  tmux select-pane -t "$SESSION:0.1"
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
