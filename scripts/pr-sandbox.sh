#!/usr/bin/env bash
set -euo pipefail

REF_ARG="${1:?usage: pnpm pr:sandbox <PR-number|branch>}"; shift || true
REPO="zico-io/ts-rogue"
DIR="/vercel/sandbox/ts-rogue"          # ponytail: Vercel Sandbox default home; adjust if it moves
TOKEN="${GH_TOKEN:-$(gh auth token)}"

SBX=(pnpm exec sandbox)
[ -n "${VERCEL_PROJECT:-}" ] && SBX+=(--project "$VERCEL_PROJECT")
[ -n "${VERCEL_TEAM:-}" ] && SBX+=(--scope "$VERCEL_TEAM")

if [[ "$REF_ARG" =~ ^[0-9]+$ ]]; then
  NAME="pr-$REF_ARG"; REF="refs/pull/$REF_ARG/head"
else
  NAME="branch-${REF_ARG//\//-}"; REF="$REF_ARG"
fi

if ! OUT=$("${SBX[@]}" create --name "$NAME" --timeout "${TIMEOUT:-45m}" --runtime node24 --silent 2>&1); then
  [[ "$OUT" == *"already exists"* ]] || { echo "$OUT" >&2; exit 1; }
fi

"${SBX[@]}" exec --sudo --env "GH_TOKEN=$TOKEN" "$NAME" -- bash -lc '
  set -e
  URL="https://x-access-token:$GH_TOKEN@github.com/'"$REPO"'.git"
  [ -d '"$DIR"'/.git ] || git clone --depth 1 "$URL" '"$DIR"'
  cd '"$DIR"'
  git fetch --depth 1 "$URL" "'"$REF"'"
  git checkout -B pr FETCH_HEAD
  corepack pnpm install --frozen-lockfile
  dpkg -s libglib2.0-0t64 >/dev/null 2>&1 || dpkg -s libglib2.0-0 >/dev/null 2>&1 || \
    sudo pnpm exec playwright install --with-deps chromium
'

echo "Sandbox '$NAME' ready. Inside: 'pnpm game' to play, 'pnpm check' to verify."
echo "Stop:   ${SBX[*]} stop $NAME   (resumable)"
echo "Delete: ${SBX[*]} remove $NAME"
exec "${SBX[@]}" connect --workdir "$DIR" "$NAME" "$@"
