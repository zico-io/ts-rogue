import { type HttpRouteDefinition, POST } from "eve/channels";
import {
  createLinearAgentActivity,
  defaultOnAgentSession,
  type LinearAgentSessionEvent,
  type LinearChannel,
  type LinearChannelConfig,
  type LinearChannelState,
  linearChannel,
  linearContinuationToken,
  parseLinearWebhookEvent,
} from "eve/channels/linear";

import { linearAgentCredentials } from "../lib/credentials";
import { advanceIssueState } from "../lib/linear/issue-state";
import { linearRenderer } from "../lib/linear/renderer";
import {
  duplicateSessionDeclineBody,
  findDuplicateSessionBlocker,
  isStopSignal,
} from "../lib/linear/session";
import { verifyLinearWebhook } from "../lib/linear/webhook";
import { AgentSession, sessionEvents } from "../lib/session";

/**
 * Declines a second live session on an issue, and starts the issue when a real
 * one opens. Both hang off eve's inbound hook rather than a forked dispatch.
 */
const guardedOnAgentSession: NonNullable<
  LinearChannelConfig["onAgentSession"]
> = async (ctx, event) => {
  const base = defaultOnAgentSession(ctx, event);
  if (base === null || event.action !== "created") return base;

  const blocker = await findDuplicateSessionBlocker({
    credentials: linearAgentCredentials,
    session: event.agentSession,
  });
  if (blocker !== null) {
    await ctx.linear.createActivity({
      body: duplicateSessionDeclineBody(blocker),
      type: "response",
    });
    return null;
  }

  const issueId = event.agentSession.issueId ?? event.agentSession.issue?.id;
  if (issueId != null) {
    await advanceIssueState({
      credentials: linearAgentCredentials,
      issueRef: issueId,
      target: "inProgress",
    });
  }
  return base;
};

const base = linearChannel({
  credentials: linearAgentCredentials,
  events: sessionEvents(new AgentSession(linearRenderer)),
  onAgentSession: guardedOnAgentSession,
});

// linearChannel always registers exactly one HTTP POST route; asserted at
// runtime so a future eve upgrade that changes this fails loudly instead of
// destructuring `undefined`.
if (base.routes.length !== 1) {
  throw new Error(
    `linearChannel: expected exactly one route, got ${base.routes.length}.`,
  );
}
const [baseRoute] = base.routes as [HttpRouteDefinition<LinearChannelState>];

/**
 * The inbound Agent Session event, verified, or `null` for anything the
 * pre-dispatch decisions below must not act on. Reads a clone so eve's own
 * handler still gets an unread body - and verifies again itself.
 */
const preDispatchEvent = async (
  request: Request,
): Promise<LinearAgentSessionEvent | null> => {
  const body = await verifyLinearWebhook(request, linearAgentCredentials);
  if (body === null) return null;
  let event: ReturnType<typeof parseLinearWebhookEvent>;
  try {
    event = parseLinearWebhookEvent({ body, headers: request.headers });
  } catch {
    return null;
  }
  if (event === null || event.kind !== "agent_session") return null;
  // The two actions eve's `defaultOnAgentSession` dispatches; cancelling on any
  // other would interrupt a turn no inbound message is replacing.
  return event.action === "created" || event.action === "prompted"
    ? event
    : null;
};

export default {
  ...base,
  routes: [
    POST(baseRoute.path, async (request, args) => {
      // Two things eve's Linear route does not do, both needing `cancel` before
      // its handler dispatches: steer a live turn with the newest message, and
      // honor the human `stop` signal (HAR-39). Everything else - verification,
      // inbound images, default events, state - is eve's.
      const event = await preDispatchEvent(request.clone());
      if (event !== null) {
        await args.cancel({
          continuationToken: linearContinuationToken(event.agentSession.id),
        });
        if (isStopSignal(event)) {
          await createLinearAgentActivity({
            credentials: linearAgentCredentials,
            activity: {
              agentSessionId: event.agentSession.id,
              content: {
                body: "Stopped. This session will not take further action until you send a new message.",
                type: "response",
              },
            },
          });
          return Response.json({ ok: true });
        }
      }
      return baseRoute.handler(request, args);
    }),
  ],
} satisfies LinearChannel;
