/**
 * Every string the agent is woken with when an external event dispatches a
 * turn. Kept together because this is prompt text tuned as a set, separate from
 * the logic that decides when to wake.
 */

import type { GitHubPullRequestReviewWebhookPayload } from "./pull-request";

export const DEBT_ISSUE_LABEL = "tech-debt";

export const DEBT_REMEDIATION_THRESHOLD = 5;

export const MAIN_MERGE_SYNCED =
  "A pull request was merged into main. The sandbox checkout has already updated automatically; no manual repository sync is needed.";

export const ralphAdvanceContext = (ref: string) =>
  `The merged pull request closes Linear issue ${ref}. If it belongs to an active issue group, confirm it is Done and hand off every newly ready sub-issue per the "Issue groups" instructions. If it is standalone, no further action is needed.`;

export const REVIEW_FEEDBACK_CONTEXT =
  'Reviewer feedback landed on this pull request. Validate it, then either make the focused fix or reply in the thread per "GitHub maintenance turns."';

export const debtReviewContext = (prNumber: number): string => {
  return `A merged pull request (#${prNumber} in zico-io/ts-rogue) may carry unresolved review-comment threads. Audit them per "GitHub maintenance turns."

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

/** Message appended as the woken turn's dispatch context for a review verdict. */
export const pullRequestReviewVerdictContext = (
  payload: GitHubPullRequestReviewWebhookPayload,
  verdict: "approved" | "changes_requested",
): string => {
  const verdictLabel =
    verdict === "approved" ? "Approved" : "Changes requested";
  const reviewer =
    payload.review.user?.login ?? payload.sender?.login ?? "someone";
  const lines = [
    `A pull request review was submitted with verdict **${verdictLabel}** (this is the review's overall state, separate from any inline comments).`,
    `Reviewer: @${reviewer}`,
  ];
  if (payload.review.body) lines.push("", payload.review.body);
  if (payload.review.html_url) lines.push("", payload.review.html_url);
  return lines.join("\n");
};
