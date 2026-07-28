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

/** Declines a second live session on an issue, and starts the issue when a real one opens. */
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

// Asserted because the wrapper replaces the one route it finds: a second one
// added by an eve upgrade would silently stop existing rather than crash.
if (base.routes.length !== 1) {
  throw new Error(
    `linearChannel: expected exactly one route, got ${base.routes.length}.`,
  );
}
const [baseRoute] = base.routes as [HttpRouteDefinition<LinearChannelState>];

/** The inbound Agent Session event, verified, or `null` for anything to leave alone. */
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
  return event.action === "created" || event.action === "prompted"
    ? event
    : null;
};

/** Retires only the eve session a `handoff` checkpoint named; best-effort. */
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
