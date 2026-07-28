import type {
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import { defaultGitHubAuth } from "eve/channels/github";

import { linearAgentCredentials } from "../credentials";
import {
  advanceIssueState,
  type IssueStateTarget,
} from "../linear/issue-state";
import {
  debtReviewContext,
  MAIN_MERGE_SYNCED,
  ralphAdvanceContext,
} from "./dispatch-context";

export const LINEAR_TEAM_KEYS = ["ROG", "ENG", "HAR", "WEB"] as const;

const LINEAR_REF_PATTERN = new RegExp(
  `\\b(?:${LINEAR_TEAM_KEYS.join("|")})-\\d+\\b`,
  "i",
);

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

/** The Linear issue a pull request closes, read from its branch, title, or body. */
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

/** The workflow transition a pull-request event implies, if any. */
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

/** Only a merge into main wakes a turn; everything else is state sync alone. */
export const pullRequestWakeDecision = (
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

export const syncAndWakeOnPullRequest = async (
  context: GitHubInboundContext,
  pullRequest: GitHubPullRequestEvent,
) => {
  const sync = pullRequestStateSync(pullRequest);
  if (sync !== null) {
    await advanceIssueState({ credentials: linearAgentCredentials, ...sync });
  }
  return pullRequestWakeDecision(context, pullRequest);
};

/** The only two review states with a dispatchable verdict; kept open by design. */
type GitHubPullRequestReviewState =
  | "approved"
  | "changes_requested"
  | (string & {});

/** Minimal shape read from a `pull_request_review` webhook payload. */
export interface GitHubPullRequestReviewWebhookPayload {
  readonly action: string;
  readonly installation?: { readonly id?: number };
  readonly pull_request: {
    readonly number: number;
    readonly base?: { readonly ref?: string; readonly sha?: string };
    readonly head?: { readonly ref?: string; readonly sha?: string };
  };
  readonly repository: {
    readonly default_branch?: string;
    readonly id: number;
    readonly name: string;
    readonly owner: { readonly login: string };
  };
  readonly review: {
    readonly body: string | null;
    readonly html_url?: string;
    readonly state: GitHubPullRequestReviewState;
    readonly user?: {
      readonly id?: number;
      readonly login?: string;
      readonly type?: string;
    };
  };
  readonly sender?: {
    readonly id?: number;
    readonly login?: string;
    readonly type?: string;
  };
}
