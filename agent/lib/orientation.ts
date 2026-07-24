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
}

// One command emits the raw state as delimited lines; onSession runs it in the
// sandbox and hands the stdout to parseGitFacts.
export const GIT_FACTS_COMMAND = [
  "git rev-parse --abbrev-ref HEAD",
  "git rev-parse --short HEAD",
  '([ -z "$(git status --porcelain)" ] && echo clean || echo dirty)',
  "echo ---COMMITS---",
  "git log --oneline -5",
].join(" && ");

export function parseGitFacts(stdout: string): GitFacts {
  const [head = "", commits = ""] = stdout.split("---COMMITS---");
  const [branch = "", headSha = "", cleanFlag = ""] = head
    .trim()
    .split("\n")
    .map((line) => line.trim());
  return {
    branch,
    headSha,
    clean: cleanFlag === "clean",
    recentCommits: commits
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
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
  if (screenshotTooling) {
    lines.push(
      screenshotTooling.available
        ? "- Screenshot tooling (`scripts/play-web.mjs`): available - a PR with a rendered UI/visual change must include a screenshot."
        : `- Screenshot tooling (\`scripts/play-web.mjs\`): unavailable (${screenshotTooling.reason}) - try it once for a UI-visual PR; if it still fails, say so explicitly in the PR and session update instead of omitting evidence.`,
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
