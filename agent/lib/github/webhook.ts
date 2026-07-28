import type { RouteHandlerArgs } from "eve/channels";
import type {
  GitHubChannelCredentials,
  GitHubChannelState,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { pullRequestReviewVerdictContext } from "./dispatch-context";
import type { GitHubPullRequestReviewWebhookPayload } from "./pull-request";
import {
  parsePullRequestReviewPayload,
  pullRequestReviewVerdict,
} from "./wake-policy";

// eve's githubChannel never dispatches on `pull_request_review`, so a bare
// approve or request-changes was silently dropped (HAR-49).

const pullRequestConversationToken = (
  repositoryId: number,
  pullRequestNumber: number,
): string => `repo:${repositoryId}:pull:${pullRequestNumber}`;

const buildPullRequestReviewAuth = (input: {
  readonly deliveryId: string;
  readonly installationId: number | undefined;
  readonly pullRequestNumber: number;
  readonly repository: { fullName: string; id: number; owner: string };
  readonly sender: { id: number; login: string; type: string };
}): SessionAuthContext => ({
  attributes: {
    conversation_kind: "pull_request",
    delivery_id: input.deliveryId,
    installation_id: String(input.installationId ?? ""),
    issue_number: "",
    pull_request_number: String(input.pullRequestNumber),
    repository: input.repository.fullName,
    repository_id: String(input.repository.id),
    user_login: input.sender.login,
    user_type: input.sender.type,
  },
  authenticator: "github-webhook",
  issuer: `github:${input.repository.owner}`,
  principalId: `github:${input.sender.id}`,
  principalType: input.sender.type === "Bot" ? "service" : "user",
  subject: input.sender.login,
});

const pullRequestReviewState = (
  payload: GitHubPullRequestReviewWebhookPayload,
): GitHubChannelState => ({
  baseRef: payload.pull_request.base?.ref ?? null,
  baseSha: payload.pull_request.base?.sha ?? null,
  checkoutPath: null,
  conversationKind: "pull_request",
  defaultBranch: payload.repository.default_branch ?? null,
  headRef: payload.pull_request.head?.ref ?? null,
  headSha: payload.pull_request.head?.sha ?? null,
  installationId: payload.installation?.id ?? null,
  issueNumber: payload.pull_request.number,
  owner: payload.repository.owner.login,
  pullRequestNumber: payload.pull_request.number,
  repo: payload.repository.name,
  repositoryId: payload.repository.id,
  reviewCommentId: null,
  reviewThreadRootCommentId: null,
  triggeringCommentId: null,
  triggeringUserLogin: (payload.review.user ?? payload.sender)?.login ?? null,
});

/** Wakes the PR's own turn when a verified delivery carries a dispatchable verdict. */
export const handlePullRequestReviewWebhook = async (
  request: Request,
  args: Pick<RouteHandlerArgs<GitHubChannelState>, "send">,
  credentials: GitHubChannelCredentials,
): Promise<Response> => {
  const rawBody = await request.text();
  const verified = await credentials.webhookVerifier?.(request, rawBody);
  if (!verified) return new Response("unauthorized", { status: 401 });
  const body = typeof verified === "string" ? verified : rawBody;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    return Response.json({ ignored: true, ok: true });
  }

  const payload = parsePullRequestReviewPayload(parsedJson);
  if (payload === null) return Response.json({ ignored: true, ok: true });

  const verdict = pullRequestReviewVerdict(payload);
  if (verdict === null) return Response.json({ ignored: true, ok: true });

  const owner = payload.repository.owner.login;
  const pullRequestNumber = payload.pull_request.number;
  const reviewer = payload.review.user ?? payload.sender;

  const auth = buildPullRequestReviewAuth({
    deliveryId: request.headers.get("x-github-delivery") ?? crypto.randomUUID(),
    installationId: payload.installation?.id,
    pullRequestNumber,
    repository: {
      fullName: `${owner}/${payload.repository.name}`,
      id: payload.repository.id,
      owner,
    },
    sender: {
      id: reviewer?.id ?? 0,
      login: reviewer?.login ?? "unknown",
      type: reviewer?.type ?? "User",
    },
  });

  await args.send(pullRequestReviewVerdictContext(payload, verdict), {
    auth,
    continuationToken: pullRequestConversationToken(
      payload.repository.id,
      pullRequestNumber,
    ),
    state: pullRequestReviewState(payload),
  });

  return Response.json({ ok: true });
};
