import { connectGitHubCredentials } from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  type GitHubPullRequestEvent,
  githubChannel,
} from "eve/channels/github";

export const isMainMerge = (pullRequest: GitHubPullRequestEvent) => {
  const base = pullRequest.raw.base;
  return (
    pullRequest.action === "closed" &&
    pullRequest.raw.merged === true &&
    typeof base === "object" &&
    base !== null &&
    "ref" in base &&
    base.ref === "main"
  );
};

// Every Linear team key whose issues this agent drives. An explicit list, not
// a generic [A-Z]+-\d+ pattern: PR bodies are scanned too, and a generic match
// would false-positive on tokens like SHA-256 or ISO-8601.
export const LINEAR_TEAM_KEYS = ["ROG", "ENG", "HAR", "WEB"] as const;

const LINEAR_REF_PATTERN = new RegExp(
  `\\b(?:${LINEAR_TEAM_KEYS.join("|")})-\\d+\\b`,
  "i",
);

// The Linear issue a merged PR closes, taken from the branch, title, or body.
// ralph mode uses it to advance the enclosing issue group; standalone PRs
// return null and skip the advance context.
export const linearRefFromPullRequest = (
  pullRequest: GitHubPullRequestEvent,
): string | null => {
  const { head, title, body } = pullRequest.raw as {
    head?: { ref?: unknown };
    title?: unknown;
    body?: unknown;
  };
  const fields = [head?.ref, title, body];
  for (const field of fields) {
    if (typeof field !== "string") continue;
    const match = field.match(LINEAR_REF_PATTERN);
    if (match) return match[0].toUpperCase();
  }
  return null;
};

const MAIN_MERGE_SYNCED =
  "A pull request was merged into main. The sandbox checkout has already updated automatically; no manual repository sync is needed.";

const ralphAdvanceContext = (ref: string) =>
  `The merged pull request closes Linear issue ${ref}. If ${ref} is a sub-issue of a parent issue you are ralphing (an in-progress issue group), advance that group per the "Issue groups" instructions: confirm ${ref} is Done, then claim and drive every newly ready sub-issue. If ${ref} is a standalone issue, no further action is needed.`;

export default githubChannel({
  credentials: connectGitHubCredentials("github/ts-rogue-eve-github"),
  // onSession already synced main; skip the channel's default PR-head checkout.
  events: { "turn.started": () => {} },
  onPullRequest: (context, pullRequest) => {
    if (!isMainMerge(pullRequest)) return null;
    const ref = linearRefFromPullRequest(pullRequest);
    return {
      auth: defaultGitHubAuth(context),
      context: ref
        ? [MAIN_MERGE_SYNCED, ralphAdvanceContext(ref)]
        : [MAIN_MERGE_SYNCED],
    };
  },
});
