/** Decides whether an inbound GitHub event deserves a turn at all. */

import type { GitHubComment, GitHubInboundContext } from "eve/channels/github";
import { defaultGitHubAuth } from "eve/channels/github";
import { isPlainObject } from "../narrow";
import { REVIEW_FEEDBACK_CONTEXT } from "./dispatch-context";
import type { GitHubPullRequestReviewWebhookPayload } from "./pull-request";

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

/** A thread's root comment is the finding; replies are already being handled. */
const isNewReviewFinding = (comment: GitHubComment): boolean => {
  const raw = comment.raw as { in_reply_to_id?: unknown };
  return raw.in_reply_to_id === undefined || raw.in_reply_to_id === null;
};

/** Inline review findings wake the agent; anywhere else needs an explicit mention. */
export const commentWakeDecision = (
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

/** Validates only the fields dereferenced without optional chaining; `null` on mismatch. */
export const parsePullRequestReviewPayload = (
  value: unknown,
): GitHubPullRequestReviewWebhookPayload | null => {
  if (!isPlainObject(value)) return null;
  const { action, pull_request, repository, review } = value;
  if (typeof action !== "string") return null;
  if (!isPlainObject(pull_request) || typeof pull_request.number !== "number") {
    return null;
  }
  if (
    !isPlainObject(repository) ||
    typeof repository.id !== "number" ||
    typeof repository.name !== "string" ||
    !isPlainObject(repository.owner) ||
    typeof repository.owner.login !== "string"
  ) {
    return null;
  }
  if (
    !isPlainObject(review) ||
    typeof review.state !== "string" ||
    (review.body !== null && typeof review.body !== "string")
  ) {
    return null;
  }
  return value as unknown as GitHubPullRequestReviewWebhookPayload;
};

/** A verdict exists only for a freshly submitted approve or request-changes review. */
export const pullRequestReviewVerdict = (
  payload: Pick<GitHubPullRequestReviewWebhookPayload, "action" | "review">,
): "approved" | "changes_requested" | null => {
  if (payload.action !== "submitted") return null;
  if (payload.review.state === "approved") return "approved";
  if (payload.review.state === "changes_requested") return "changes_requested";
  return null;
};
