#!/usr/bin/env bash
# Run the `play dev` iteration layout (live game + interactive pi, side by side)
# inside a Vercel Sandbox instead of on this machine: same tmux layout, remote compute.
# Usage: pnpm play:sandbox [seed] [cols] [rows]
#
# Prereqs: `pnpm exec sandbox login` once (browser auth); a GitHub token ($GH_TOKEN or
# `gh auth token`) to clone; and $AI_GATEWAY_API_KEY so pi can run inference in-sandbox.
set -euo pipefail

SEED="${1:-1}"
COLS="${2:-200}"
ROWS="${3:-50}"
REPO="zico-io/ts-rogue"
NAME="play-dev"
DIR="/vercel/sandbox/ts-rogue"          # ponytail: Vercel Sandbox default home; adjust if it moves
TOKEN="${GH_TOKEN:-$(gh auth token)}"

SBX=(pnpm exec sandbox)
[ -n "${VERCEL_PROJECT:-}" ] && SBX+=(--project "$VERCEL_PROJECT")
[ -n "${VERCEL_TEAM:-}" ] && SBX+=(--scope "$VERCEL_TEAM")

[ -n "${AI_GATEWAY_API_KEY:-}" ] || \
  echo "note: AI_GATEWAY_API_KEY unset; pi will have no gateway credential in the sandbox" >&2

# Create-or-resume a named sandbox: an existing name is the normal re-run path.
if ! OUT=$("${SBX[@]}" create --name "$NAME" --timeout "${TIMEOUT:-45m}" --runtime node24 --silent 2>&1); then
  [[ "$OUT" == *"already exists"* ]] || { echo "$OUT" >&2; exit 1; }
fi

# Provision (idempotent): tmux + pi back the play dev layout; clone, fetch main, install.
# Token injected per-command via --env, never written into git config.
"${SBX[@]}" exec --sudo --env "GH_TOKEN=$TOKEN" "$NAME" -- bash -lc '
  set -e
  command -v tmux >/dev/null || { sudo apt-get update && sudo apt-get install -y tmux; }
  command -v pi   >/dev/null || npm install -g @earendil-works/pi-coding-agent@0.81.1
  URL="https://x-access-token:$GH_TOKEN@github.com/'"$REPO"'.git"
  [ -d '"$DIR"'/.git ] || git clone --depth 1 "$URL" '"$DIR"'
  cd '"$DIR"'
  git fetch --depth 1 "$URL" main
  git checkout -B main FETCH_HEAD
  corepack pnpm install --frozen-lockfile
'

echo "Sandbox '$NAME' ready. Starting the play dev layout and attaching..."
echo "Stop:   ${SBX[*]} stop $NAME   (resumable)"
echo "Delete: ${SBX[*]} remove $NAME"
# Start the detached game+pi layout, then attach so tmux fills the terminal. The
# gateway key is set on this env so the pi pane tmux spawns inherits it.
exec "${SBX[@]}" exec --interactive --workdir "$DIR" \
  --env "AI_GATEWAY_API_KEY=${AI_GATEWAY_API_KEY:-}" \
  "$NAME" -- bash -lc "scripts/play.sh dev $SEED $COLS $ROWS && exec tmux attach -t rogue"
