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

export function buildOrientationBrief(facts: GitFacts): string {
  return [
    "# Orientation brief",
    "",
    "Auto-generated at session start. This is authoritative repository state:",
    "treat it as settled and do not re-derive it with git archaeology.",
    "",
    `- Branch: \`${facts.branch}\` at \`${facts.headSha}\``,
    `- Working tree: ${facts.clean ? "clean" : "dirty"}`,
    "- `main` was synced from origin at session start.",
    "",
    "## Recent commits",
    ...facts.recentCommits.map((commit) => `- ${commit}`),
    "",
  ].join("\n");
}
