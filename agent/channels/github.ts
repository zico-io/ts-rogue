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

// Every Linear team key whose issues this agent drives. An explicit list, not
// a generic [A-Z]+-\d+ pattern: PR bodies are scanned too, and a generic match
// would false-positive on tokens like SHA-256 or ISO-8601.
export const LINEAR_TEAM_KEYS = ["ROG", "ENG", "HAR", "WEB"] as const;

// Label used to track technical-debt issues filed from unresolved review
// comments on merged pull requests. Created on demand by the debt-review turn.
export const DEBT_ISSUE_LABEL = "tech-debt";

// Threshold of open debt issues that triggers automated remediation: when the
// count of open issues carrying DEBT_ISSUE_LABEL reaches this number, the
// debt-review turn dispatches the coder subagent to fix all of them in one
// remediation pull request.
export const DEBT_REMEDIATION_THRESHOLD = 5;

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
  `The merged pull request closes Linear issue ${ref}. If ${ref} is a sub-issue of a parent issue you are ralphing (an in-progress issue group), advance that group per the "Issue groups" instructions: confirm ${ref} is Done, then hand off every newly ready sub-issue to the agent via Linear. If ${ref} is a standalone issue, no further action is needed.`;

// Context for a turn woken by review feedback landing on a pull request (see
// "PR review-feedback turns" in instructions.md for the full contract). Kept
// short and pointed at that section rather than repeated here, matching how
// ponytailReviewContext above points back at "PR review turns" instead of
// inlining its own procedure.
const REVIEW_FEEDBACK_CONTEXT =
  'Reviewer feedback landed on this pull request (see the comment above). This is a PR review-feedback turn (see "PR review-feedback turns" in the contract): validate it, then either fix the code or reply - nothing else.';


// Context for a merge-wake turn to audit unresolved review-comment threads
// from the merged PR and file GitHub issues for any still-real debt. See
// "PR merge debt-review turns" in instructions.md for the full contract.
// Pointed at that section rather than inlining the procedure, matching the
// pattern ponytailReviewContext and REVIEW_FEEDBACK_CONTEXT already follow.
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

// Mirrors the @mention check eve's own built-in `onComment` gate uses
// (`extractGitHubCommentTrigger` in `dist/.../channels/github/inbound.js`),
// reimplemented here because supplying `onComment` below replaces that
// built-in gate entirely rather than layering on top of it (see eve's github
// channel docs), and `eve/channels/github`'s public barrel exports only
// `defaultGitHubAuth` from that module - not the mention helper itself
// (confirmed against the package's own `exports` map: `inbound`/`defaults`
// have no public subpath, only the top-level `./channels/github` entry
// point). The bot-authored/self-comment loop guard needs no reimplementation
// here - eve applies that before ever calling `onComment`.
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

// A pull-request review comment is a finding - actionable feedback tied to a
// code location - only the first time it appears in its thread. GitHub fires
// the same `pull_request_review_comment` webhook for every later reply in
// that thread too (its raw payload carries `in_reply_to_id` once it is a
// reply; eve's normalized `GitHubComment` drops that field, so it is read
// off `comment.raw` directly, the same way `onPullRequest` above reads
// `pullRequest.raw` for fields the normalized event omits). Replies are
// conversation about a finding already surfaced, not a new one, so they
// should not spin up another turn.
const isNewReviewFinding = (comment: GitHubComment): boolean => {
  const raw = comment.raw as { in_reply_to_id?: unknown };
  return raw.in_reply_to_id === undefined || raw.in_reply_to_id === null;
};

export const onComment = (
  ctx: GitHubInboundContext,
  comment: GitHubComment,
) => {
  // Inline pull-request review comments - the shape both a human review and
  // ponytail's own auto-review (above) post - wake the agent unconditionally
  // when they are a new finding: feedback left during a review is a request
  // to act on, not a chat message that needs an explicit @mention to be
  // seen. A reply within an already-open review thread is not a new finding
  // and is skipped. Ordinary issue/PR discussion comments keep requiring a
  // mention, matching eve's built-in behavior.
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

// GitHub's own comment-body size cap, mirrored here because eve's internal
// `splitGitHubCommentBody` isn't part of the public `eve/channels/github`
// API surface (only `defaultGitHubAuth` is exported from that module - see
// the comment on `isBotMentioned` above for how that was confirmed).
// ponytail: this is a naive fixed-length split, not the paragraph-aware
// chunking eve's internal helper does. Ceiling: a reply could break
// mid-sentence at a chunk boundary. Upgrade path: ask eve to publicize its
// splitter, or vendor its exact rules, if a reply this large ever ships in
// practice - ordinary agent replies stay well under this limit.
const GITHUB_COMMENT_BODY_MAX_LENGTH = 65536;

const splitCommentBody = (body: string): readonly string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += GITHUB_COMMENT_BODY_MAX_LENGTH) {
    chunks.push(body.slice(i, i + GITHUB_COMMENT_BODY_MAX_LENGTH));
  }
  return chunks;
};

// Posts a completed assistant message as a GitHub comment, mirroring eve's
// built-in `message.completed` handler (`postCommentChunks` in
// `defaults.js`). Declaring this handler in `events` replaces eve's built-in
// for this key rather than layering on top of it, so it re-implements the same
// chunk-and-post behavior the default provided.
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

// --- Connection authorization ----------------------------------------------
// Port of the Linear channel's authorization surfacing (HAR-31) to this
// channel (HAR-33): eve's GitHub defaults implement no `authorization.*`
// handlers either, so when a user-scoped `connect(...)` connection needed
// OAuth on a GitHub-dispatched turn (a merge wake, a review-feedback turn),
// eve parked the turn and the event was dropped - no PR comment, no error,
// a silently stalled turn. GitHub has no native auth signal like Linear's
// "Link account" elicitation, so the challenge posts as a plain thread
// comment carrying the authorization link. This is visibility, not the
// merge-wake fix itself - that is the Linear MCP connection going app-scoped
// in `connections/linear.ts`.

// Mirror of the Linear channel's fallback: title-case the connection scope
// name ("linear" -> "Linear") when the challenge carries no displayName.
// Duplicated (2 lines) rather than imported so this file stays disjoint from
// channels/linear.ts.
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

// Harness-owned issue lifecycle (see `lib/issue-state.ts`): which Linear
// workflow-state transition this pull-request event implies, if any. Pure
// decision, exported for tests; the async wrapper below performs it.
// `synchronize` is excluded - state was set at open, and the sync is
// forward-only so a repeat would be a no-op anyway.
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

// Registered in place of `onPullRequest` below (eve runs the hook under
// `waitUntil` and accepts an async result, so awaiting here is durable and
// never blocks the webhook response). The Done sync deliberately completes
// before the main-merge dispatch decision returns, so the woken ralph-advance
// turn already observes the merged sub-issue Done when it recomputes
// readiness. `advanceIssueState` never throws, so a Linear outage can never
// suppress the review dispatch or the ralph wake.
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
    // Every merge to main also wakes a debt-review turn: this context entry
    // tells the woken turn to audit unresolved review threads and file debt
    // issues. The webhook handler makes no API call itself - the GraphQL
    // query runs inside the woken turn (which has gh CLI access). This runs
    // unconditionally alongside the ralph-advance and main-synced entries
    // since only the turn can determine whether unresolved threads exist.
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
    // onSession already synced main; skip the channel's default PR-head checkout.
    "turn.started": () => {},
    "message.completed": onMessageCompleted,
    "authorization.required": onAuthorizationRequired,
    "authorization.completed": onAuthorizationCompleted,
  },
  onComment,
  onPullRequest: onPullRequestWithStateSync,
});
