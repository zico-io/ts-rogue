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

# Project + team default to the CLI login context; VERCEL_PROJECT / VERCEL_TEAM pin a scope.
SBX=(pnpm exec sandbox)
[ -n "${VERCEL_PROJECT:-}" ] && SBX+=(--project "$VERCEL_PROJECT")
[ -n "${VERCEL_TEAM:-}" ] && SBX+=(--scope "$VERCEL_TEAM")

# A bare number => PR head ref; anything else => a branch name.
if [[ "$REF_ARG" =~ ^[0-9]+$ ]]; then
  NAME="pr-$REF_ARG"; REF="refs/pull/$REF_ARG/head"
else
  NAME="branch-${REF_ARG//\//-}"; REF="$REF_ARG"
fi

# Create-or-resume a named sandbox: an existing name is the normal re-run path, so
# tolerate only that and surface any other failure. TIMEOUT is 45m (Hobby cap), 1h on Pro.
if ! OUT=$("${SBX[@]}" create --name "$NAME" --timeout "${TIMEOUT:-45m}" --runtime node24 --silent 2>&1); then
  [[ "$OUT" == *"already exists"* ]] || { echo "$OUT" >&2; exit 1; }
fi

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
