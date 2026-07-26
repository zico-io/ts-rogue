import {
  connectGitHubCredentials,
  connectLinearCredentials,
} from "@vercel/connect/eve";
import {
  type HttpRouteDefinition,
  POST,
  type RouteHandlerArgs,
} from "eve/channels";
import {
  defaultGitHubAuth,
  type GitHubChannel,
  type GitHubChannelCredentials,
  type GitHubChannelEvents,
  type GitHubChannelState,
  type GitHubComment,
  type GitHubEventContext,
  type GitHubInboundContext,
  type GitHubPullRequestEvent,
  githubChannel,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import type { SessionContext } from "eve/tools";

import { advanceIssueState, type IssueStateTarget } from "../lib/issue-state";
import { stripLeadingProseHeader } from "../lib/prose";

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
  `The merged pull request closes Linear issue ${ref}. If it belongs to an active issue group, confirm it is Done and hand off every newly ready sub-issue per the "Issue groups" instructions. If it is standalone, no further action is needed.`;

const REVIEW_FEEDBACK_CONTEXT =
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
  for (const chunk of splitCommentBody(stripLeadingProseHeader(data.message))) {
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

// --- Coarse pull_request_review webhook events (HAR-49) --------------------
// eve 0.27.6's githubChannel has no onPullRequestReview hook, and its inbound
// parser (node_modules/eve/dist/src/public/channels/github/inbound.js) never
// recognizes the `pull_request_review` webhook event name - only
// `pull_request`, `pull_request_review_comment`, `issues`, `check_suite`,
// `check_run`, `workflow_run`, and `ping`. A bare "Approve" or "Request
// changes" verdict carries no inline comment, so it fires only
// `pull_request_review` and was silently dropped (acked, never dispatched).
// This section intercepts that one event name ahead of eve's own route
// handler (see the final `export default` below) and wakes the PR's own
// turn - the same continuation token `onPullRequest` above dispatches to -
// with the verdict attached. Every other event still flows through eve's
// real handler, byte for byte, since we only replace the route's `.handler`
// and keep the rest of the real channel (`adapter`, `receive`, `cors`)
// untouched.

// The only two review states this file branches on (see
// `pullRequestReviewVerdict`), kept open (`string & {}`) the same way eve's
// own `GitHubPullRequestAction` is - GitHub can send other states (e.g.
// "commented", "dismissed") that never carry a dispatchable verdict here.
type GitHubPullRequestReviewState =
  | "approved"
  | "changes_requested"
  | (string & {});

// Minimal shape read from a `pull_request_review` webhook payload - only the
// fields this handler actually uses.
interface GitHubPullRequestReviewWebhookPayload {
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOptional = <T>(
  value: unknown,
  check: (value: unknown) => value is T,
): value is T | undefined => value === undefined || check(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number => typeof value === "number";

// Validates an optional `{ ref?: string; sha?: string }` shape, present on
// both `pull_request.base` and `pull_request.head`.
const isOptionalRefShaShape = (
  value: unknown,
): value is { ref?: string; sha?: string } | undefined =>
  isOptional(
    value,
    (v): v is { ref?: string; sha?: string } =>
      isPlainObject(v) &&
      isOptional(v.ref, isString) &&
      isOptional(v.sha, isString),
  );

// Validates an optional `{ id?; login?; type? }` shape, present on both
// `review.user` and the top-level `sender`.
const isOptionalActorShape = (
  value: unknown,
): value is { id?: number; login?: string; type?: string } | undefined =>
  isOptional(
    value,
    (v): v is { id?: number; login?: string; type?: string } =>
      isPlainObject(v) &&
      isOptional(v.id, isNumber) &&
      isOptional(v.login, isString) &&
      isOptional(v.type, isString),
  );

// Validates every field this handler dereferences (with or without optional
// chaining) before any of it is trusted - the webhook signature only proves
// who sent the request, not that its JSON body has the shape this file
// expects. Returns `null` for anything that doesn't match, which the caller
// treats the same as unparseable JSON.
const parsePullRequestReviewPayload = (
  value: unknown,
): GitHubPullRequestReviewWebhookPayload | null => {
  if (!isPlainObject(value)) return null;
  const { action, installation, pull_request, repository, review, sender } =
    value;
  if (typeof action !== "string") return null;
  if (
    !isOptional(
      installation,
      (v): v is { id?: number } =>
        isPlainObject(v) && isOptional(v.id, isNumber),
    )
  ) {
    return null;
  }
  if (
    !isPlainObject(pull_request) ||
    typeof pull_request.number !== "number" ||
    !isOptionalRefShaShape(pull_request.base) ||
    !isOptionalRefShaShape(pull_request.head)
  ) {
    return null;
  }
  if (
    !isPlainObject(repository) ||
    typeof repository.id !== "number" ||
    typeof repository.name !== "string" ||
    !isPlainObject(repository.owner) ||
    typeof repository.owner.login !== "string" ||
    !isOptional(repository.default_branch, isString)
  ) {
    return null;
  }
  if (
    !isPlainObject(review) ||
    typeof review.state !== "string" ||
    (review.body !== null && typeof review.body !== "string") ||
    !isOptional(review.html_url, isString) ||
    !isOptionalActorShape(review.user)
  ) {
    return null;
  }
  if (!isOptionalActorShape(sender)) return null;
  return value as unknown as GitHubPullRequestReviewWebhookPayload;
};

// A coarse review only carries an actionable verdict when it is freshly
// submitted with an approve/request-changes state; "commented" reviews carry
// no verdict, and "edited"/"dismissed" actions touch a review already acted
// on, not a fresh one. Exported for tests.
export const pullRequestReviewVerdict = (
  payload: Pick<GitHubPullRequestReviewWebhookPayload, "action" | "review">,
): "approved" | "changes_requested" | null => {
  if (payload.action !== "submitted") return null;
  if (payload.review.state === "approved") return "approved";
  if (payload.review.state === "changes_requested") return "changes_requested";
  return null;
};

// Message appended as the woken turn's dispatch context. Exported for tests.
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

// Mirrors eve's internal `verifyGitHubRequest`
// (node_modules/eve/dist/src/public/channels/github/verify.js), which is not
// part of the public `eve/channels/github` API surface (only its
// `GitHubWebhookVerifier` type is exported - see the comment on
// `isBotMentioned` above for how that was confirmed for a sibling case).
// This repo always configures `connectGitHubCredentials`, which always sets
// `webhookVerifier` (Vercel OIDC) - so only that branch is implemented.
// ponytail: a bring-your-own-App `webhookSecret` HMAC fallback is not
// reimplemented here. Ceiling: this throws if `webhookVerifier` is ever
// unset. Upgrade path: port `verifyGitHubRequest`'s HMAC branch verbatim if
// this repo ever configures `githubChannel` with a raw `webhookSecret`
// instead of Connect credentials.
const verifyGitHubWebhookBody = async (
  request: Request,
  credentials: GitHubChannelCredentials,
): Promise<string> => {
  const rawBody = await request.text();
  if (credentials.webhookVerifier === undefined) {
    throw new Error(
      "githubChannel: no webhookVerifier configured for pull_request_review verification.",
    );
  }
  const verified = await credentials.webhookVerifier(request, rawBody);
  if (!verified) {
    throw new Error(
      "githubChannel: inbound webhook verifier rejected the request.",
    );
  }
  return typeof verified === "string" ? verified : rawBody;
};

// Continuation token for the PR's own timeline conversation - the same
// token `onPullRequest`'s dispatch resumes (mirrors the non-exported
// `continuationTokenFromState`/`githubContinuationToken` for
// `conversationKind: "pull_request"`).
const pullRequestConversationToken = (
  repositoryId: number,
  pullRequestNumber: number,
): string => `repo:${repositoryId}:pull:${pullRequestNumber}`;

// Mirrors the exact `SessionAuthContext` shape the public `defaultGitHubAuth`
// builds (node_modules/eve/dist/src/public/channels/github/defaults.js) for
// a "pull_request" conversation. Not called directly: `defaultGitHubAuth`
// demands a full `GitHubInboundContext`, which binds live `github.request`/
// `thread.post`/`thread.react` handles this raw webhook route has no honest
// way to supply (a raw `pull_request_review` delivery is not bound to a
// channel-managed thread) - asserting a stub past the compiler would hide a
// real shape mismatch instead of catching one. `defaultGitHubAuth` never
// reads those handles itself, only the plain data fields reproduced below,
// so this stays in sync by hand if that formula ever changes.
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

// Handles one verified `pull_request_review` webhook delivery: parses the
// payload, decides whether it carries a dispatchable verdict, and wakes the
// PR's own turn (same continuation token as `onPullRequest`) when it does.
// Exported for tests, which fake `credentials.webhookVerifier` and
// `args.send` rather than exercising eve's real route dispatch.
export const handlePullRequestReviewWebhook = async (
  request: Request,
  args: Pick<RouteHandlerArgs<GitHubChannelState>, "send">,
  credentials: GitHubChannelCredentials,
): Promise<Response> => {
  let rawBody: string;
  try {
    rawBody = await verifyGitHubWebhookBody(request, credentials);
  } catch {
    return new Response("unauthorized", { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return Response.json({ ignored: true, ok: true });
  }

  const payload = parsePullRequestReviewPayload(parsedJson);
  if (payload === null) return Response.json({ ignored: true, ok: true });

  const verdict = pullRequestReviewVerdict(payload);
  if (verdict === null) return Response.json({ ignored: true, ok: true });

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const repositoryId = payload.repository.id;
  const pullRequestNumber = payload.pull_request.number;
  const reviewer = payload.review.user ?? payload.sender;

  const auth = buildPullRequestReviewAuth({
    deliveryId: request.headers.get("x-github-delivery") ?? crypto.randomUUID(),
    installationId: payload.installation?.id,
    pullRequestNumber,
    repository: { fullName: `${owner}/${repo}`, id: repositoryId, owner },
    sender: {
      id: reviewer?.id ?? 0,
      login: reviewer?.login ?? "unknown",
      type: reviewer?.type ?? "User",
    },
  });

  await args.send(pullRequestReviewVerdictContext(payload, verdict), {
    auth,
    continuationToken: pullRequestConversationToken(
      repositoryId,
      pullRequestNumber,
    ),
    state: {
      baseRef: payload.pull_request.base?.ref ?? null,
      baseSha: payload.pull_request.base?.sha ?? null,
      checkoutPath: null,
      conversationKind: "pull_request",
      defaultBranch: payload.repository.default_branch ?? null,
      headRef: payload.pull_request.head?.ref ?? null,
      headSha: payload.pull_request.head?.sha ?? null,
      installationId: payload.installation?.id ?? null,
      issueNumber: pullRequestNumber,
      owner,
      pullRequestNumber,
      repo,
      repositoryId,
      reviewCommentId: null,
      reviewThreadRootCommentId: null,
      triggeringCommentId: null,
      triggeringUserLogin: reviewer?.login ?? null,
    },
  });

  return Response.json({ ok: true });
};

const credentials = connectGitHubCredentials("github/ts-rogue-eve-github");

const baseChannel = githubChannel({
  credentials,
  events: {
    "turn.started": () => {},
    "message.completed": onMessageCompleted,
    "authorization.required": onAuthorizationRequired,
    "authorization.completed": onAuthorizationCompleted,
  },
  onComment,
  onPullRequest: onPullRequestWithStateSync,
});

// githubChannel always registers exactly one HTTP POST route (see
// `GITHUB_CHANNEL_DEFAULT_ROUTE` in
// node_modules/eve/dist/src/public/channels/github/constants.js) - there is
// no websocket variant to guard against here. Asserted at runtime (rather
// than cast past the compiler) so a future eve upgrade that changes this
// fails loudly instead of destructuring `undefined`.
if (baseChannel.routes.length !== 1) {
  throw new Error(
    `githubChannel: expected exactly one route, got ${baseChannel.routes.length}.`,
  );
}
const [baseRoute] = baseChannel.routes as [
  HttpRouteDefinition<GitHubChannelState>,
];

export default {
  ...baseChannel,
  routes: [
    POST(baseRoute.path, async (request, args) => {
      if (request.headers.get("x-github-event") === "pull_request_review") {
        return handlePullRequestReviewWebhook(request, args, credentials);
      }
      return baseRoute.handler(request, args);
    }),
  ],
} satisfies GitHubChannel;
