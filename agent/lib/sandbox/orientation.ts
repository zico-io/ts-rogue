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
    "Generated at session start:",
    `- Branch: \`${facts.branch}\` at \`${facts.headSha}\``,
    `- Working tree: ${facts.clean ? "clean" : "dirty"}`,
    "- `main`: synced from origin",
  ];
  if (facts.branch !== "main") {
    if (facts.upstream === null) {
      lines.push(
        `- Upstream: none; preserve existing commits with \`git push -u origin ${facts.branch}\``,
      );
    } else if (facts.unpushedCount > 0) {
      lines.push(
        `- Unpushed: ${facts.unpushedCount} commit(s) ahead of \`${facts.upstream}\`; push or use the backup procedure in \`instructions.md\``,
      );
    }
  }
  if (facts.worktrees && facts.worktrees.length > 0) {
    lines.push(
      `- Leftover worktrees: ${facts.worktrees
        .map((path) => `\`${path}\``)
        .join(", ")}; preserve their commits before removing them`,
    );
  }
  if (screenshotTooling) {
    lines.push(
      screenshotTooling.available
        ? "- Screenshot tooling: available"
        : `- Screenshot tooling: unavailable (${screenshotTooling.reason}); disclose missing visual evidence`,
    );
  }
  if (typeof githubAuthed === "boolean") {
    lines.push(
      githubAuthed
        ? "- GitHub auth: confirmed"
        : "- GitHub auth: not confirmed; retry failed operations twice, then back up work and report the blocker",
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
