// Pre-computes the repository state the orchestrator would otherwise rediscover
// by running git ad hoc and reasoning about the output. Writing it once at
// session start turns orientation from a multi-turn investigation into reading
// one file of settled facts. Kept free of eve imports so the formatting and
// parsing are plain, directly testable functions.

export interface GitFacts {
  branch: string;
  headSha: string;
  clean: boolean;
  recentCommits: string[];
  /** Upstream tracking ref (e.g. `origin/nico/rog-1-thing`), or null if the branch has never been pushed. */
  upstream: string | null;
  /** Commits on HEAD not yet on `upstream`. Always 0 when `upstream` is null (there's no ahead/behind to compute). */
  unpushedCount: number;
  /**
   * Linked worktree paths left behind by a prior turn (the main checkout is
   * excluded). Ralph mode's parallel workstreams live in `.worktrees/<id>`;
   * their branches and any unpushed commits are invisible to the current-branch
   * checks above, so leftovers must be surfaced explicitly.
   */
  worktrees?: readonly string[];
}

// One command emits the raw state as delimited lines; onSession runs it in the
// sandbox and hands the stdout to parseGitFacts. The upstream/ahead-count
// section lets the orientation brief flag stranded local commits (see HAR-5:
// a session whose push failed for an extended stretch needs this surfaced
// automatically instead of discovered by hand).
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
  // `git worktree list --porcelain` lists the main checkout first; every
  // later `worktree <path>` line is a linked worktree left behind.
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

/**
 * Whether the sandbox's Playwright chromium (backing `scripts/play-web.mjs`'s
 * screenshots) is confirmed working. Written once at image bootstrap
 * (`sandbox.ts`'s `buildBootstrapCommand`) to `SCREENSHOT_STATUS_PATH` and
 * read back verbatim in `onSession` - screenshot tooling is a property of the
 * baked image, not of any one session, so there's nothing to re-derive here.
 */
export interface ScreenshotToolingStatus {
  available: boolean;
  /** Present when `available` is false: why, so a session can decide whether it's worth one retry. */
  reason?: string;
}

/** Absolute path (inside the sandbox) of the bootstrap-written screenshot-tooling status file. */
export const SCREENSHOT_STATUS_PATH = "/workspace/.eve/screenshot-tooling.json";

/** Best-effort parse of `SCREENSHOT_STATUS_PATH`'s contents; any malformed/missing content reads as unavailable with an explanatory reason, never throws. */
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
  } catch {
    // fall through to the unknown default below
  }
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
        : "- GitHub auth: not confirmed at session start (the token service was slow or unavailable) - it keeps retrying automatically in the background and typically recovers within a minute. If a `git push` or GitHub API call fails early in the session, wait about a minute and retry once or twice before reporting a blocker; only escalate if it is still failing after those retries.",
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
