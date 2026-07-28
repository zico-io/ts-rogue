import { type HttpRouteDefinition, POST } from "eve/channels";
import {
  type GitHubChannel,
  type GitHubChannelState,
  type GitHubEventContext,
  githubChannel,
} from "eve/channels/github";

import { textRenderer } from "../lib/channel";
import { githubAgentCredentials } from "../lib/credentials";
import { syncAndWakeOnPullRequest } from "../lib/github/pull-request";
import { commentWakeDecision } from "../lib/github/wake-policy";
import { handlePullRequestReviewWebhook } from "../lib/github/webhook";
import { AgentSession } from "../lib/session";

const GITHUB_COMMENT_BODY_MAX_LENGTH = 65536;

/**
 * GitHub's rendering of the shared session lifecycle: everything a human needs
 * to read becomes a thread comment, split at GitHub's comment-length cap. A
 * thread has no chip, plan, or native prompt surface, so `textRenderer` shows
 * those updates as nothing rather than as extra comments.
 */
export const githubSession = new AgentSession<GitHubEventContext>(
  textRenderer({
    maxLength: GITHUB_COMMENT_BODY_MAX_LENGTH,
    post: (channel: GitHubEventContext, body) => channel.thread.post(body),
  }),
);

const baseChannel = githubChannel({
  credentials: githubAgentCredentials,
  events: {
    // Deliberately silences eve's default, which would 👀-react and check the
    // repository out again on every turn - the sandbox recipe's `onSession`
    // already provisions the checkout this agent works in.
    "turn.started": () => {},
    "message.completed": (data, channel, ctx) =>
      githubSession.messageCompleted(data, channel, ctx),
    "authorization.required": (data, channel, ctx) =>
      githubSession.authorizationRequired(data, channel, ctx),
    "authorization.completed": (data, channel, ctx) =>
      githubSession.authorizationCompleted(data, channel, ctx),
    // `session.failed` and `turn.failed` keep eve's built-in rendering; a
    // channel opts into the shared definition by wiring them here.
  },
  onComment: commentWakeDecision,
  onPullRequest: syncAndWakeOnPullRequest,
});

// githubChannel always registers exactly one HTTP POST route; asserted at
// runtime so a future eve upgrade that changes this fails loudly instead of
// destructuring `undefined`.
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
      // eve never dispatches on `pull_request_review`, so that one event is
      // intercepted ahead of its handler - see `lib/github/webhook.ts` (HAR-49).
      if (request.headers.get("x-github-event") === "pull_request_review") {
        return handlePullRequestReviewWebhook(
          request,
          args,
          githubAgentCredentials,
        );
      }
      return baseRoute.handler(request, args);
    }),
  ],
} satisfies GitHubChannel;
