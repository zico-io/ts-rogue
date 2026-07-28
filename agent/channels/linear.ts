import {
  type HttpRouteDefinition,
  POST,
  type RouteHandlerArgs,
} from "eve/channels";
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
import { checkpointedSessionId } from "../lib/linear/checkpoint";
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
// runtime because the wrapper below replaces the route it finds. An eve upgrade
// that added a second one would otherwise leave it silently unwrapped and
// unreachable - no crash to notice, just a route that stopped existing.
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

/**
 * Retires the eve session a `handoff` checkpoint marked, so eve's own dispatch
 * re-creates it empty on the send that follows (see `lib/linear/checkpoint.ts`).
 * Only the session named by the marker is reset, which is what keeps this a
 * no-op on every webhook after the rotation instead of wiping live work.
 *
 * Best-effort: a failed lookup or reset leaves the accumulated session in place,
 * which is exactly the pre-rotation behavior, and must not block dispatch.
 */
const rotateCheckpointedContext = async (
  event: LinearAgentSessionEvent,
  args: RouteHandlerArgs<LinearChannelState>,
  continuationToken: string,
): Promise<void> => {
  const checkpointed = checkpointedSessionId(event.previousComments);
  if (checkpointed === null) return;
  try {
    const active = await args.resolveActiveSession({ continuationToken });
    if (active?.sessionId !== checkpointed) return;
    await args.reset({ continuationToken, reason: "context checkpoint" });
  } catch (error) {
    console.warn("linear: context-checkpoint rotation failed", error);
  }
};

export default {
  ...base,
  routes: [
    POST(baseRoute.path, async (request, args) => {
      // Three things eve's Linear route does not do, all needing the
      // continuation token before its handler dispatches: steer a live turn with
      // the newest message, honor the human `stop` signal (HAR-39), and rotate a
      // checkpointed context window. Everything else - verification, inbound
      // images, default events, state - is eve's.
      const event = await preDispatchEvent(request.clone());
      if (event !== null) {
        const continuationToken = linearContinuationToken(
          event.agentSession.id,
        );
        await args.cancel({ continuationToken });
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
        await rotateCheckpointedContext(event, args, continuationToken);
      }
      return baseRoute.handler(request, args);
    }),
  ],
} satisfies LinearChannel;
