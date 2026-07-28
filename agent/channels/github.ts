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

/** GitHub's rendering: every readable update becomes a thread comment. */
export const githubSession = new AgentSession<GitHubEventContext>(
  textRenderer({
    maxLength: GITHUB_COMMENT_BODY_MAX_LENGTH,
    post: (channel: GitHubEventContext, body) => channel.thread.post(body),
  }),
);

const baseChannel = githubChannel({
  credentials: githubAgentCredentials,
  events: {
    // Silences eve's default, which would re-check-out the repository each turn.
    "turn.started": () => {},
    "message.completed": (data, channel, ctx) =>
      githubSession.messageCompleted(data, channel, ctx),
    "authorization.required": (data, channel, ctx) =>
      githubSession.authorizationRequired(data, channel, ctx),
    "authorization.completed": (data, channel, ctx) =>
      githubSession.authorizationCompleted(data, channel, ctx),
  },
  onComment: commentWakeDecision,
  onPullRequest: syncAndWakeOnPullRequest,
});

// Asserted because the wrapper replaces the one route it finds: a second one
// added by an eve upgrade would silently stop existing rather than crash.
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
      // eve never dispatches on `pull_request_review` (HAR-49).
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
