import { type CancelFn, defineChannel, POST } from "eve/channels";
import {
  createLinearAgentActivity,
  defaultOnAgentSession,
  formatLinearContextBlock,
  LINEAR_CHANNEL_DEFAULT_ROUTE,
  type LinearAgentSessionEvent,
  type LinearAgentSessionRef,
  type LinearAgentSessionUpdateInput,
  type LinearChannel,
  type LinearChannelConfig,
  type LinearChannelContext,
  type LinearChannelState,
  type LinearHandle,
  type LinearInstrumentationMetadata,
  type LinearReceiveTarget,
  linearContinuationToken,
  linearInputRequestSignal,
  listLinearAgentSessionActivities,
  messageFromLinearAgentSessionEvent,
  parseLinearWebhookEvent,
  renderLinearInputRequests,
  updateLinearAgentSession,
} from "eve/channels/linear";
import type { SessionContext } from "eve/tools";

import type { ChannelRenderer } from "../lib/channel";
import { linearAgentCredentials } from "../lib/credentials";
import {
  activityText,
  advanceIssueState,
  attachLinearInboundImages,
  duplicateSessionDeclineBody,
  findDuplicateSessionBlocker,
  initialSessionState,
  isStopSignal,
  linearUserIdFromAuthContext,
  linearWebhook,
  pendingState,
  resolveReceiveSession,
  stateFromAgentSession,
} from "../lib/linear";
import { nonEmptyString } from "../lib/narrow";
import {
  AgentSession,
  type SessionScratch,
  type SessionUpdate,
  sessionEvents,
} from "../lib/session";

const jsonOk = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });

function buildLinearHandle(input: {
  readonly agentSessionId: string;
  readonly config: LinearChannelConfig;
}): LinearHandle {
  const { agentSessionId, config } = input;
  return {
    agentSessionId,
    createActivity(content, options) {
      return createLinearAgentActivity({
        api: config.api,
        credentials: config.credentials,
        activity: {
          agentSessionId,
          content,
          ephemeral: options?.ephemeral,
          signal: options?.signal,
          signalMetadata: options?.signalMetadata,
        },
      });
    },
    listActivities(options) {
      return listLinearAgentSessionActivities({
        api: config.api,
        credentials: config.credentials,
        agentSessionId,
        last: options?.last,
      });
    },
    updateSession(update) {
      return updateLinearAgentSession({
        api: config.api,
        credentials: config.credentials,
        id: agentSessionId,
        update,
      });
    },
  };
}

function requireAgentSessionId(agentSessionId: string | null): string {
  if (agentSessionId === null) {
    throw new Error(
      "linearChannel: cannot post Agent Activity without an Agent Session id.",
    );
  }
  return agentSessionId;
}

function postActivity(
  channel: LinearChannelContext,
  options: {
    readonly api?: LinearChannelConfig["api"];
    readonly credentials?: LinearChannelConfig["credentials"];
  },
  content: Parameters<
    typeof createLinearAgentActivity
  >[0]["activity"]["content"],
  activityOptions: {
    readonly ephemeral?: boolean;
    readonly signal?: Parameters<
      typeof createLinearAgentActivity
    >[0]["activity"]["signal"];
    readonly signalMetadata?: Parameters<
      typeof createLinearAgentActivity
    >[0]["activity"]["signalMetadata"];
  } = {},
) {
  return createLinearAgentActivity({
    api: options.api,
    credentials: options.credentials,
    activity: {
      agentSessionId: requireAgentSessionId(channel.state.agentSessionId),
      content,
      ephemeral: activityOptions.ephemeral,
      signal: activityOptions.signal,
      signalMetadata: activityOptions.signalMetadata,
    },
  });
}

/**
 * Linear's rendering of the shared session lifecycle: every update becomes an
 * Agent Activity, with Linear's native signals for the two prompt kinds and its
 * Agent Plan for the plan. The decisions all live in `lib/session`.
 */
const linearRenderer = (options: {
  readonly api?: LinearChannelConfig["api"];
  readonly credentials?: LinearChannelConfig["credentials"];
}): ChannelRenderer<LinearChannelContext> => ({
  restartHint: "Start a new Linear agent session to continue.",

  /** Buffering must survive between events, so it rides the channel state. */
  scratch(channel: LinearChannelContext): SessionScratch {
    return pendingState(channel);
  },

  async render(
    update: SessionUpdate,
    channel: LinearChannelContext,
    ctx?: SessionContext,
  ): Promise<void> {
    switch (update.kind) {
      case "thought":
      case "response":
      case "error":
        await postActivity(
          channel,
          options,
          { body: update.body, type: update.kind },
          update.kind === "thought" && update.transient
            ? { ephemeral: true }
            : {},
        );
        // A dead session leaves its issue blocked, not in progress. Only a
        // fatal error means the session is gone; a failed turn can be retried.
        if (
          update.kind === "error" &&
          update.fatal === true &&
          channel.state.issueId != null
        ) {
          await advanceIssueState({
            credentials: options.credentials,
            issueRef: channel.state.issueId,
            target: "blocked",
          });
        }
        return;
      case "action":
        await postActivity(
          channel,
          options,
          {
            action: update.action,
            parameter: activityText(update.parameter),
            type: "action",
            ...(update.result === undefined
              ? {}
              : { result: activityText(update.result) }),
          },
          update.transient ? { ephemeral: true } : {},
        );
        return;
      case "authPrompt": {
        const content = { body: update.body, type: "elicitation" } as const;
        if (update.url === undefined) {
          await postActivity(channel, options, content);
          return;
        }
        const userId = linearUserIdFromAuthContext(
          ctx?.session.auth.current ?? null,
        );
        await postActivity(channel, options, content, {
          signal: "auth",
          signalMetadata: {
            providerName: update.displayName,
            url: update.url,
            ...(userId !== undefined ? { userId } : {}),
          },
        });
        return;
      }
      case "inputPrompt":
        await postActivity(
          channel,
          options,
          {
            body: renderLinearInputRequests(update.requests),
            type: "elicitation",
          },
          linearInputRequestSignal(update.requests),
        );
        return;
      case "plan":
        await channel.linear.updateSession({
          plan: update.steps as unknown as LinearAgentSessionUpdateInput["plan"],
        });
        return;
    }
  },
});

const guardedOnAgentSession: NonNullable<
  LinearChannelConfig["onAgentSession"]
> = async (ctx, event) => {
  const base = defaultOnAgentSession(ctx, event);
  if (base === null || event.action !== "created") return base;
  const blocker = await findDuplicateSessionBlocker({
    credentials: linearAgentCredentials,
    session: event.agentSession,
  });
  if (blocker === null) return base;
  await ctx.linear.createActivity({
    body: duplicateSessionDeclineBody(blocker),
    type: "response",
  });
  return null;
};

async function dispatchAgentSession(input: {
  readonly cancel: CancelFn;
  readonly config: LinearChannelConfig;
  readonly event: LinearAgentSessionEvent;
  readonly onAgentSession: NonNullable<LinearChannelConfig["onAgentSession"]>;
  // biome-ignore lint/suspicious/noExplicitAny: mirrors eve's own SendFn generic default
  readonly send: (payload: any, options: any) => Promise<unknown>;
}) {
  const { cancel, config, event, onAgentSession, send } = input;
  const ctx = {
    delivery: event.delivery,
    linear: buildLinearHandle({
      agentSessionId: event.agentSession.id,
      config,
    }),
    session: event.agentSession,
  };

  if (isStopSignal(event)) {
    const continuationToken = linearContinuationToken(event.agentSession.id);
    await cancel({ continuationToken });
    await ctx.linear.createActivity({
      body: "Stopped. This session will not take further action until you send a new message.",
      type: "response",
    });
    return;
  }
  const result = await onAgentSession(ctx, event);
  if (result === null) return;

  const continuationToken = linearContinuationToken(event.agentSession.id);

  await cancel({ continuationToken });

  const message = await attachLinearInboundImages({
    content: messageFromLinearAgentSessionEvent(event),
    credentials: config.credentials,
    fetch: config.api?.fetch,
  });

  await send(
    {
      context: [
        formatLinearContextBlock(event),
        ...event.previousComments,
        ...(result.context ?? []),
      ],
      message,
    },
    {
      auth: result.auth,
      continuationToken,
      state: stateFromAgentSession(event.agentSession),
    },
  );

  if (event.action === "created") {
    const issueId = event.agentSession.issueId ?? event.agentSession.issue?.id;
    if (issueId != null) {
      await advanceIssueState({
        credentials: config.credentials,
        issueRef: issueId,
        target: "inProgress",
      });
    }
  }
}

function linearChannel(config: LinearChannelConfig = {}): LinearChannel {
  const onAgentSession = config.onAgentSession ?? defaultOnAgentSession;
  const webhook = linearWebhook(config.credentials);
  const events = {
    ...sessionEvents(
      new AgentSession(
        linearRenderer({ api: config.api, credentials: config.credentials }),
      ),
    ),
    ...config.events,
  };

  return defineChannel<
    LinearChannelState,
    LinearChannelContext,
    LinearReceiveTarget,
    LinearInstrumentationMetadata
  >({
    kindHint: "linear",
    state: initialSessionState(),
    metadata(state) {
      return {
        agentSessionId: state.agentSessionId,
        commentId: state.commentId ?? null,
        issueId: state.issueId ?? null,
        issueIdentifier: state.issueIdentifier ?? null,
        organizationId: state.organizationId ?? null,
      };
    },

    context(state) {
      return {
        linear: buildLinearHandle({
          agentSessionId: state.agentSessionId ?? "",
          config,
        }),
        state,
      };
    },
    routes: [
      POST(
        config.route ?? LINEAR_CHANNEL_DEFAULT_ROUTE,
        async (req, { send, cancel, waitUntil }) => {
          let body: string;
          try {
            body = await webhook.verify(req);
          } catch (error) {
            console.warn("linear inbound verification failed", error);
            return new Response("unauthorized", { status: 401 });
          }

          let event: ReturnType<typeof parseLinearWebhookEvent>;
          try {
            event = parseLinearWebhookEvent({ body, headers: req.headers });
          } catch (error) {
            console.warn("inbound Linear body is not valid JSON", error);
            return jsonOk({ ignored: true, ok: true });
          }
          if (event === null) return jsonOk({ ignored: true, ok: true });

          if (event.kind === "agent_session") {
            waitUntil(
              dispatchAgentSession({
                cancel,
                config,
                event,
                onAgentSession,
                send,
              }),
            );
            return jsonOk({ ok: true });
          }
          if (config.onDataWebhook === undefined) {
            return jsonOk({ ignored: true, ok: true });
          }
          waitUntil(Promise.resolve(config.onDataWebhook(event)));
          return jsonOk({ ok: true });
        },
      ),
    ],
    async receive(input, { send }) {
      const target = input.target;
      const session = await resolveReceiveSession(target, config);
      const initialActivity = nonEmptyString(
        (target as { initialActivity?: unknown }).initialActivity,
      );
      if (initialActivity !== undefined) {
        await createLinearAgentActivity({
          api: config.api,
          credentials: config.credentials,
          activity: {
            agentSessionId: session.id,
            content: { body: initialActivity, type: "thought" },
          },
        });
      }
      return send(input.message, {
        auth: input.auth,
        continuationToken: linearContinuationToken(session.id),
        state: stateFromAgentSession(session as LinearAgentSessionRef),
      });
    },
    events,
  });
}

export default linearChannel({
  credentials: linearAgentCredentials,
  onAgentSession: guardedOnAgentSession,
});
