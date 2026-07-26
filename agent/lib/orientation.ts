export interface GitFacts {
  branch: string;
  headSha: string;
  clean: boolean;
  recentCommits: string[];

  upstream: string | null;

  unpushedCount: number;

  worktrees?: readonly string[];
}

export const GIT_FACTS_COMMAND = [
  "git rev-parse --abbrev-ref HEAD",
  "git rev-parse --short HEAD",
  '([ -z "$(git status --porcelain)" ] && echo clean || echo dirty)',
  "echo ---COMMITS---",
  "git log --oneline -5",
  "echo ---UPSTREAM---",
  "git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo NONE",
  "echo ---AHEAD---",
  "git rev-list --count @{u}..HEAD 2>/dev/null || echo 0",
  "echo ---WORKTREES---",
  "git worktree list --porcelain",
].join(" && ");

export function parseGitFacts(stdout: string): GitFacts {
  const [head = "", afterHead = ""] = stdout.split("---COMMITS---");
  const [commitsRaw = "", afterCommits = ""] =
    afterHead.split("---UPSTREAM---");
  const [upstreamRaw = "", afterUpstream = ""] =
    afterCommits.split("---AHEAD---");
  const [aheadRaw = "", worktreesRaw = ""] =
    afterUpstream.split("---WORKTREES---");
  const [branch = "", headSha = "", cleanFlag = ""] = head
    .trim()
    .split("\n")
    .map((line) => line.trim());
  const upstreamValue = upstreamRaw.trim();
  const upstream =
    upstreamValue === "" || upstreamValue === "NONE" ? null : upstreamValue;
  const unpushedCount =
    upstream === null ? 0 : Number.parseInt(aheadRaw.trim(), 10) || 0;

  const worktrees = worktreesRaw
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .slice(1)
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
  return {
    worktrees,
    branch,
    headSha,
    clean: cleanFlag === "clean",
    recentCommits: commitsRaw
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    upstream,
    unpushedCount,
  };
}

export interface ScreenshotToolingStatus {
  available: boolean;

  reason?: string;
}

export const SCREENSHOT_STATUS_PATH = "/workspace/.eve/screenshot-tooling.json";

export function parseScreenshotToolingStatus(
  stdout: string,
): ScreenshotToolingStatus {
  try {
    const parsed: unknown = JSON.parse(stdout.trim() || "{}");
    if (
      parsed &&
      typeof parsed === "object" &&
      "available" in parsed &&
      typeof (parsed as { available: unknown }).available === "boolean"
    ) {
      const { available, reason } = parsed as {
        available: boolean;
        reason?: unknown;
      };
      return {
        available,
        reason: typeof reason === "string" ? reason : undefined,
      };
    }
  } catch {}
  return {
    available: false,
    reason:
      "status file missing or unreadable - bootstrap may predate this check",
  };
}

export function buildOrientationBrief(
  facts: GitFacts,
  screenshotTooling?: ScreenshotToolingStatus,
  githubAuthed?: boolean,
): string {
  const lines = [
    "# Orientation brief",
    "",
    "Auto-generated at session start. This is authoritative repository state:",
    "treat it as settled and do not re-derive it with git archaeology.",
    "",
    `- Branch: \`${facts.branch}\` at \`${facts.headSha}\``,
    `- Working tree: ${facts.clean ? "clean" : "dirty"}`,
    "- `main` was synced from origin at session start.",
  ];
  if (facts.branch !== "main") {
    if (facts.upstream === null) {
      lines.push(
        `- This branch has no upstream on origin yet. If it has local commits from a prior session, push them now (\`git push -u origin ${facts.branch}\`) before doing new work - onSession already tried this automatically once GitHub auth was confirmed, so a still-missing upstream likely means that push failed.`,
      );
    } else if (facts.unpushedCount > 0) {
      lines.push(
        `- ${facts.unpushedCount} commit(s) on this branch are not yet on \`${facts.upstream}\` (the automatic push-on-session-start didn't clear them) - push now with \`git push\`; if it keeps failing, back the commits up per the git-push-failure recovery steps in \`instructions.md\` before reporting a blocker.`,
      );
    }
  }
  if (facts.worktrees && facts.worktrees.length > 0) {
    lines.push(
      `- Leftover worktrees from a prior turn: ${facts.worktrees
        .map((path) => `\`${path}\``)
        .join(
          ", ",
        )}. Each may hold a branch with unpushed commits the checks above cannot see - push (or back up) each worktree's branch from inside it, then \`git worktree remove\` it before starting new work.`,
    );
  }
  if (screenshotTooling) {
    lines.push(
      screenshotTooling.available
        ? "- Screenshot tooling (`scripts/play-web.mjs`): available - a PR with a rendered UI/visual change must include a screenshot."
        : `- Screenshot tooling (\`scripts/play-web.mjs\`): unavailable (${screenshotTooling.reason}) - try it once for a UI-visual PR; if it still fails, say so explicitly in the PR and session update instead of omitting evidence.`,
    );
  }
  if (typeof githubAuthed === "boolean") {
    lines.push(
      githubAuthed
        ? "- GitHub auth: confirmed at session start - `git push` and GitHub API calls should work normally."
        : "- GitHub auth: not confirmed at session start (the token service was slow or unavailable). Background retry is bounded and recovery in this turn is not guaranteed. If a `git push` or GitHub API call fails, retry at most twice, about 60 seconds apart, then back your work up and report a blocker per `instructions.md` - do not keep sleeping and retrying beyond that.",
    );
  }
  lines.push(
    "",
    "## Recent commits",
    ...facts.recentCommits.map((commit) => `- ${commit}`),
    "",
  );
  return lines.join("\n");
}
