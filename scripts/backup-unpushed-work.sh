#!/usr/bin/env bash
set -euo pipefail

ISSUE_ID="${1:?usage: scripts/backup-unpushed-work.sh <issue-id>}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" = "main" ]; then
  echo "Refusing to back up: HEAD is on main, not a feature branch." >&2
  exit 1
fi

git fetch --depth 1 origin main >/dev/null 2>&1 || true
BASE="$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD)"
COUNT="$(git rev-list --count "$BASE"..HEAD)"

if [ "$COUNT" = "0" ]; then
  echo "No commits ahead of $BASE on $BRANCH - nothing to back up." >&2
  exit 1
fi

OUT="/tmp/${ISSUE_ID}-unpushed.patch"
git format-patch "$BASE" --stdout > "$OUT"

echo "Backed up $COUNT commit(s) on $BRANCH to $OUT"
echo "Next: attach $OUT to the $ISSUE_ID Linear issue, then report the blocker."
echo "On a resumed session: git am $OUT   (then push normally once auth is confirmed)"
