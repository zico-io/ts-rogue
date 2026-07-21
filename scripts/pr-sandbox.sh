#!/usr/bin/env bash
# Spin up (or resume) a Vercel Sandbox running a PR's code and drop into an
# interactive shell. Usage: pnpm pr:sandbox <PR-number|branch> [extra connect args]
#
# Prerequisites: `pnpm exec sandbox login` once (browser auth to the bob-v0 team),
# and a GitHub token to clone the private repo (taken from $GH_TOKEN or `gh auth token`).
set -euo pipefail

REF_ARG="${1:?usage: pnpm pr:sandbox <PR-number|branch>}"; shift || true
REPO="zico-io/ts-rogue"
DIR="/vercel/sandbox/ts-rogue"          # ponytail: Vercel Sandbox default home; adjust if it moves
TOKEN="${GH_TOKEN:-$(gh auth token)}"

# Project + team come from the repo's committed Vercel link so the sandbox lands
# in the right scope regardless of the developer's default team (env overrides win).
PROJECT="${VERCEL_PROJECT:-$(node -p "require('./.vercel/repo.json').projects[0].name")}"
SCOPE="${VERCEL_TEAM:-$(node -p "require('./.vercel/repo.json').projects[0].orgId")}"
SBX=(pnpm exec sandbox --project "$PROJECT" --scope "$SCOPE")

# A bare number => PR head ref; anything else => a branch name.
if [[ "$REF_ARG" =~ ^[0-9]+$ ]]; then
  NAME="pr-$REF_ARG"; REF="refs/pull/$REF_ARG/head"
else
  NAME="branch-${REF_ARG//\//-}"; REF="$REF_ARG"
fi

# Create-or-resume a persistent, named sandbox (no-op if it already exists).
"${SBX[@]}" create --name "$NAME" --timeout 1h --runtime node24 --silent 2>/dev/null || true

# Clone once; always fetch the latest head + reinstall so re-runs pick up new commits.
# The token is injected per-command via --env and never written into git config.
"${SBX[@]}" exec --env "GH_TOKEN=$TOKEN" "$NAME" -- bash -lc '
  set -e
  URL="https://x-access-token:$GH_TOKEN@github.com/'"$REPO"'.git"
  [ -d '"$DIR"'/.git ] || git clone --depth 1 "$URL" '"$DIR"'
  cd '"$DIR"'
  git fetch --depth 1 "$URL" "'"$REF"'"
  git checkout -B pr FETCH_HEAD
  corepack pnpm install --frozen-lockfile
'

echo "Sandbox '$NAME' ready. Inside: 'pnpm game' to play, 'pnpm check' to verify."
echo "Stop:   ${SBX[*]} stop $NAME   (resumable)"
echo "Delete: ${SBX[*]} remove $NAME"
exec "${SBX[@]}" connect --workdir "$DIR" "$NAME" "$@"
