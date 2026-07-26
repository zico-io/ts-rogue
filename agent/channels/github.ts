import {
  connectGitHubCredentials,
  connectLinearCredentials,
} from "@vercel/connect/eve";
import {
  defaultGitHubAuth,
  type GitHubChannelEvents,
  type GitHubComment,
  type GitHubEventContext,
  type GitHubInboundContext,
  type GitHubPullRequestEvent,
  githubChannel,
} from "eve/channels/github";
import type { SessionContext } from "eve/tools";

import { advanceIssueState, type IssueStateTarget } from "../lib/issue-state";

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

export const LINEAR_TEAM_KEYS = ["ROG", "ENG", "HAR", "WEB"] as const;

export const DEBT_ISSUE_LABEL = "tech-debt";

export const DEBT_REMEDIATION_THRESHOLD = 5;

const LINEAR_REF_PATTERN = new RegExp(
  `\\b(?:${LINEAR_TEAM_KEYS.join("|")})-\\d+\\b`,
  "i",
);

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
  `The merged pull request closes Linear issue ${ref}. If ${ref} is a sub-issue of a parent issue you are ralphing (an in-progress issue group), advance that group per the "Issue groups" instructions: confirm ${ref} is Done, then hand off every newly ready sub-issue to the agent via Linear. If ${ref} is a standalone issue, no further action is needed.`;

const REVIEW_FEEDBACK_CONTEXT =
  'Reviewer feedback landed on this pull request (see the comment above). This is a PR review-feedback turn (see "PR review-feedback turns" in the contract): validate it, then either fix the code or reply - nothing else.';

export const debtReviewContext = (prNumber: number): string => {
  return `A merged pull request (#${prNumber} in zico-io/ts-rogue) may carry unresolved review-comment threads. Audit them per the "PR merge debt-review turns" section in the contract.

Label for debt issues: ${DEBT_ISSUE_LABEL}
Remediation threshold (open issues before auto-fix): ${DEBT_REMEDIATION_THRESHOLD}

Query unresolved review threads via GraphQL (only the GraphQL API exposes thread resolution state; the REST endpoint has no resolved/unresolved field):
  gh api graphql -f query='
    query {
      repository(owner: "zico-io", name: "ts-rogue") {
        pullRequest(number: ${prNumber}) {
          reviewThreads(first: 100) {
            nodes {
              isResolved
              comments(first: 1) {
                nodes {
                  body
                  path
                  line
                  url
                }
              }
            }
          }
        }
      }
    }
  '`;
};
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const isBotMentioned = (
  body: string,
  botName: string | undefined,
): boolean => {
  const name = botName?.trim();
  if (!name) return false;
  return new RegExp(`@${escapeRegExp(name)}(?=$|[^A-Za-z0-9_-])`, "iu").test(
    body,
  );
};

const isNewReviewFinding = (comment: GitHubComment): boolean => {
  const raw = comment.raw as { in_reply_to_id?: unknown };
  return raw.in_reply_to_id === undefined || raw.in_reply_to_id === null;
};

export const onComment = (
  ctx: GitHubInboundContext,
  comment: GitHubComment,
) => {
  if (ctx.conversation.kind === "review_thread") {
    return isNewReviewFinding(comment)
      ? {
          auth: defaultGitHubAuth(ctx),
          context: [REVIEW_FEEDBACK_CONTEXT],
        }
      : null;
  }
  return isBotMentioned(comment.body, process.env.GITHUB_APP_SLUG)
    ? { auth: defaultGitHubAuth(ctx) }
    : null;
};

const GITHUB_COMMENT_BODY_MAX_LENGTH = 65536;

const splitCommentBody = (body: string): readonly string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += GITHUB_COMMENT_BODY_MAX_LENGTH) {
    chunks.push(body.slice(i, i + GITHUB_COMMENT_BODY_MAX_LENGTH));
  }
  return chunks;
};

export const onMessageCompleted = async (
  data: { finishReason?: string; message: string | null },
  channel: GitHubEventContext,
  _ctx: SessionContext,
): Promise<void> => {
  if (data.finishReason === "tool-calls" || !data.message) return;
  for (const chunk of splitCommentBody(data.message)) {
    await channel.thread.post(chunk);
  }
};

const connectionDisplayName = (name: string): string =>
  name.replace(/[-_/]+/gu, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const onAuthorizationRequired: NonNullable<
  GitHubChannelEvents["authorization.required"]
> = async (data, channel) => {
  const challenge = data.authorization;
  const displayName =
    challenge?.displayName ?? connectionDisplayName(data.name);
  await channel.thread.post(
    [
      `I need ${displayName} connected before I can continue.`,
      ...(challenge?.instructions ? ["", challenge.instructions] : []),
      ...(challenge?.userCode ? ["", `Code: \`${challenge.userCode}\``] : []),
      ...(challenge?.url
        ? ["", `[Authorize ${displayName}](${challenge.url})`]
        : []),
    ].join("\n"),
  );
};

export const onAuthorizationCompleted: NonNullable<
  GitHubChannelEvents["authorization.completed"]
> = async (data, channel) => {
  const displayName =
    data.authorization?.displayName ?? connectionDisplayName(data.name);
  if (data.outcome === "authorized") {
    await channel.thread.post(`Connected to ${displayName}. Resuming.`);
    return;
  }
  const outcome = data.outcome === "timed-out" ? "timed out" : data.outcome;
  await channel.thread.post(
    `Authorization for ${displayName} ${outcome}${data.reason ? `: ${data.reason}` : "."}`,
  );
};

export const pullRequestStateSync = (
  pullRequest: GitHubPullRequestEvent,
): { issueRef: string; target: IssueStateTarget } | null => {
  const ref = linearRefFromPullRequest(pullRequest);
  if (ref === null) return null;
  if (isMainMerge(pullRequest)) return { issueRef: ref, target: "done" };
  if (
    (pullRequest.action === "opened" ||
      pullRequest.action === "ready_for_review") &&
    (pullRequest.raw as { draft?: boolean }).draft !== true
  ) {
    return { issueRef: ref, target: "inReview" };
  }
  return null;
};

const linearCredentials = connectLinearCredentials("linear/ts-rogue-eve");

const onPullRequestWithStateSync = async (
  context: GitHubInboundContext,
  pullRequest: GitHubPullRequestEvent,
) => {
  const sync = pullRequestStateSync(pullRequest);
  if (sync !== null) {
    await advanceIssueState({ credentials: linearCredentials, ...sync });
  }
  return onPullRequest(context, pullRequest);
};

export const onPullRequest = (
  context: GitHubInboundContext,
  pullRequest: GitHubPullRequestEvent,
) => {
  if (isMainMerge(pullRequest)) {
    const ref = linearRefFromPullRequest(pullRequest);

    return {
      auth: defaultGitHubAuth(context),
      context: [
        ...(ref
          ? [MAIN_MERGE_SYNCED, ralphAdvanceContext(ref)]
          : [MAIN_MERGE_SYNCED]),
        debtReviewContext(pullRequest.pullRequestNumber),
      ],
    };
  }
  return null;
};

export default githubChannel({
  credentials: connectGitHubCredentials("github/ts-rogue-eve-github"),
  events: {
    "turn.started": () => {},
    "message.completed": onMessageCompleted,
    "authorization.required": onAuthorizationRequired,
    "authorization.completed": onAuthorizationCompleted,
  },
  onComment,
  onPullRequest: onPullRequestWithStateSync,
});
