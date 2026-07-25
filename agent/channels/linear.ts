import { timingSafeEqual } from "node:crypto";

import { connectLinearCredentials } from "@vercel/connect/eve";
import { type CancelFn, defineChannel, POST } from "eve/channels";
import {
  createLinearAgentActivity,
  createLinearAgentSessionOnComment,
  createLinearAgentSessionOnIssue,
  defaultOnAgentSession,
  formatLinearContextBlock,
  LINEAR_CHANNEL_DEFAULT_ROUTE,
  type LinearAgentSessionEvent,
  type LinearAgentSessionRef,
  type LinearChannel,
  type LinearChannelConfig,
  type LinearChannelContext,
  type LinearChannelEvents,
  type LinearChannelState,
  type LinearHandle,
  type LinearInstrumentationMetadata,
  type LinearReceiveTarget,
  type LinearWebhookSecret,
  linearContinuationToken,
  listLinearAgentSessionActivities,
  messageFromLinearAgentSessionEvent,
  parseLinearWebhookEvent,
  renderLinearInputRequests,
  resolveLinearPromptInputResponses,
  signLinearWebhookBody,
  updateLinearAgentSession,
} from "eve/channels/linear";

// Hand-rolled port of eve's built-in `linearChannel()` (see
// `node_modules/eve/dist/src/public/channels/linear/linearChannel.js`),
// reimplemented via `defineChannel` so the agent-session dispatch path can
// reach the route's `cancel()` primitive - the built-in convenience wrapper
// doesn't expose it. Everything below calls the same publicly exported
// building blocks the built-in wrapper calls, with two exceptions the
// wrapper needs but the package does not actually export from
// `eve/channels/linear` (confirmed against the runtime module's own key
// list, not just its `.d.ts` files): webhook signature verification and the
// default progress/response/HITL/error event handlers. Both are
// reimplemented below from the de-minified built-in source, built only from
// genuinely public primitives (`signLinearWebhookBody`, `node:crypto`, and
// `createLinearAgentActivity`/`renderLinearInputRequests`) - see
// `verifyInboundSignature` and `createLinearDefaultEvents`. The one actual
// behavior change from the built-in is the unconditional `cancel()` before
// `send()` in `dispatchAgentSession`. See `agent/README.md` for what this
// does and does not cover.

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasNonEmptyString = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<K, string> =>
  typeof value[key] === "string" && (value[key] as string).length > 0;

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const readExternalUrls = (
  value: unknown,
): readonly { label: string; url: string }[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const urls = value.filter(
    (entry): entry is { label: string; url: string } =>
      isPlainObject(entry) &&
      typeof entry.label === "string" &&
      typeof entry.url === "string",
  );
  return urls.length > 0 ? urls : undefined;
};

const jsonOk = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });

// Port of `resolveLinearWebhookSecret` (`eve/dist/src/public/channels/linear/auth.js`,
// not exported from the `eve/channels/linear` barrel): a thunk resolves once,
// a string is used directly, and an unset value falls back to
// `LINEAR_WEBHOOK_SECRET` before failing.
async function resolveWebhookSecret(
  secret: LinearWebhookSecret | undefined,
): Promise<string> {
  const resolved =
    typeof secret === "function"
      ? await secret()
      : (secret ?? process.env.LINEAR_WEBHOOK_SECRET);
  if (!resolved) {
    throw new Error(
      "linearChannel: missing webhook secret. Pass credentials.webhookSecret, set LINEAR_WEBHOOK_SECRET, or supply credentials.webhookVerifier.",
    );
  }
  return resolved;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function verifyWebhookTimestamp(rawBody: string, maxSkewMs: number): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("linearChannel: inbound request body is not valid JSON.");
  }
  const timestamp = isPlainObject(parsed) ? parsed.webhookTimestamp : undefined;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new Error("linearChannel: inbound request missing webhookTimestamp.");
  }
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) {
    throw new Error(
      "linearChannel: inbound request timestamp outside allowed skew.",
    );
  }
}

// Port of `verifyLinearRequest` (same file as above, also not exported from
// the barrel). Uses `signLinearWebhookBody` - the one piece of the real
// signing/verification pair that *is* public - to recompute the expected
// HMAC and compare it against the `Linear-Signature` header exactly as the
// built-in verifier does, then re-checks the same `webhookTimestamp` skew
// window (default 60s, matching the built-in's unconfigurable default).
async function verifyInboundSignature(
  req: Request,
  credentials: LinearChannelConfig["credentials"],
): Promise<string> {
  const rawBody = await req.text();
  if (credentials?.webhookVerifier !== undefined) {
    const result = await credentials.webhookVerifier(req, rawBody);
    if (!result) {
      throw new Error(
        "linearChannel: inbound webhook verifier rejected the request.",
      );
    }
    return typeof result === "string" ? result : rawBody;
  }
  const secret = await resolveWebhookSecret(credentials?.webhookSecret);
  const signature = req.headers.get("linear-signature") ?? "";
  if (!signature) {
    throw new Error("linearChannel: inbound request missing Linear-Signature.");
  }
  if (!constantTimeCompare(signLinearWebhookBody(rawBody, secret), signature)) {
    throw new Error("linearChannel: inbound request signature mismatch.");
  }
  verifyWebhookTimestamp(rawBody, 60_000);
  return rawBody;
}

async function verifyInbound(
  req: Request,
  credentials: LinearChannelConfig["credentials"],
): Promise<string | null> {
  try {
    return await verifyInboundSignature(req, credentials);
  } catch (error) {
    console.warn("linear inbound verification failed", error);
    return null;
  }
}

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

function initialLinearState(): LinearChannelState {
  return {
    agentSessionId: null,
    agentSessionUrl: null,
    commentId: null,
    issueId: null,
    issueIdentifier: null,
    issueTitle: null,
    issueUrl: null,
    organizationId: null,
    pendingToolCallMessage: null,
    sourceCommentId: null,
  };
}

export function stateFromAgentSession(
  agentSession: LinearAgentSessionRef,
): LinearChannelState {
  return {
    agentSessionId: agentSession.id,
    agentSessionUrl: agentSession.url ?? null,
    commentId: agentSession.commentId ?? null,
    issueId: agentSession.issueId ?? agentSession.issue?.id ?? null,
    issueIdentifier: agentSession.issue?.identifier ?? null,
    issueTitle: agentSession.issue?.title ?? null,
    issueUrl: agentSession.issue?.url ?? null,
    organizationId: agentSession.organizationId ?? null,
    pendingToolCallMessage: null,
    sourceCommentId: agentSession.sourceCommentId ?? null,
  };
}

async function resolvePromptResponses(input: {
  readonly body: string;
  readonly config: LinearChannelConfig;
  readonly event: LinearAgentSessionEvent;
}) {
  try {
    return resolveLinearPromptInputResponses({
      activities: await listLinearAgentSessionActivities({
        api: input.config.api,
        credentials: input.config.credentials,
        agentSessionId: input.event.agentSession.id,
        last: 20,
      }),
      body: input.body,
    });
  } catch (error) {
    console.warn(
      "linear HITL activity lookup failed - treating prompt as a message",
      error,
    );
    return [];
  }
}

export async function resolveReceiveSession(
  target: LinearReceiveTarget,
  config: LinearChannelConfig,
) {
  if (hasNonEmptyString(target, "agentSessionId")) {
    return { id: target.agentSessionId };
  }
  if (hasNonEmptyString(target, "issueId")) {
    return createLinearAgentSessionOnIssue({
      api: config.api,
      credentials: config.credentials,
      issueId: target.issueId,
      externalLink: readNonEmptyString(target.externalLink),
      externalUrls: readExternalUrls(target.externalUrls),
    });
  }
  if (hasNonEmptyString(target, "commentId")) {
    return createLinearAgentSessionOnComment({
      api: config.api,
      credentials: config.credentials,
      commentId: target.commentId,
      externalLink: readNonEmptyString(target.externalLink),
      externalUrls: readExternalUrls(target.externalUrls),
    });
  }
  throw new Error(
    "linearChannel().receive requires target.agentSessionId, issueId, or commentId.",
  );
}

// --- Default event handlers -------------------------------------------------
// Port of `createDefaultEvents` (`eve/dist/src/public/channels/linear/defaults.js`,
// also not exported from the barrel - see the file banner above). Two small
// error-formatting helpers there (`extractErrorId`, `formatErrorHint`) come
// from eve's *internal* logging module with no public equivalent at all;
// `errorId`/`errorHint` below reimplement their pure formatting logic
// directly against the public `TurnFailedStreamEvent`/`SessionFailedStreamEvent`
// `data` shape, so the only user-visible difference is not worth calling out
// beyond this comment.

const truncateForDisplay = (value: string, max = 160): string =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

const errorId = (details: unknown): string | undefined =>
  isPlainObject(details) &&
  typeof details.errorId === "string" &&
  details.errorId.length > 0
    ? details.errorId
    : undefined;

const errorHint = (data: {
  readonly details?: unknown;
  readonly message: string;
}): string => {
  const name =
    isPlainObject(data.details) && typeof data.details.name === "string"
      ? data.details.name
      : undefined;
  const message = data.message.trim();
  if (name && message.length > 0)
    return ` (${name}: ${truncateForDisplay(message)})`;
  if (name) return ` (${name})`;
  if (message.length > 0) return ` (${truncateForDisplay(message)})`;
  return "";
};

const firstNonEmptyLine = (value: string): string | undefined => {
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

// biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action request shapes (load-skill / remote-agent-call / subagent-call / tool-call)
const actionLabel = (action: any): string =>
  action.kind === "tool-call" && action.toolName
    ? action.toolName
    : action.kind;

// biome-ignore lint/suspicious/noExplicitAny: see actionLabel
const actionParameter = (action: any): string => {
  // A subagent-call's `description` is the built-in `agent` tool's static
  // description ("Delegate a focused subtask to a fresh copy of yourself…"),
  // and the chip posted here stays frozen while the parent turn is parked on
  // the child - so prefer the delegation packet's first line, which leads
  // with `issue: <identifier> - <title>` (see instructions.md) and actually
  // says what was delegated.
  if (action.kind === "subagent-call" && typeof action.input === "object") {
    const message = action.input?.message;
    if (typeof message === "string") {
      const lead = firstNonEmptyLine(message);
      if (lead) return lead;
    }
  }
  if (action.description) return action.description;
  if (action.name) return action.name;
  if (action.input !== undefined) {
    try {
      return JSON.stringify(action.input);
    } catch {
      return "";
    }
  }
  return "";
};

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
  activityOptions: { readonly ephemeral?: boolean } = {},
) {
  return createLinearAgentActivity({
    api: options.api,
    credentials: options.credentials,
    activity: {
      agentSessionId: requireAgentSessionId(channel.state.agentSessionId),
      content,
      ephemeral: activityOptions.ephemeral,
    },
  });
}

function createLinearDefaultEvents(options: {
  readonly api?: LinearChannelConfig["api"];
  readonly credentials?: LinearChannelConfig["credentials"];
}): LinearChannelEvents {
  return {
    async "turn.started"(_data, channel) {
      channel.state.pendingToolCallMessage = null;
      await postActivity(
        channel,
        options,
        { body: "Working on this.", type: "thought" },
        { ephemeral: true },
      );
    },
    async "actions.requested"(data, channel) {
      const pending = channel.state.pendingToolCallMessage;
      channel.state.pendingToolCallMessage = null;
      if (pending) {
        await postActivity(
          channel,
          options,
          { body: pending, type: "thought" },
          { ephemeral: true },
        );
        return;
      }
      if (data.actions.length === 0) return;
      if (data.actions.length > 1) {
        await postActivity(
          channel,
          options,
          {
            action: "Running",
            parameter: data.actions.map(actionLabel).join(", "),
            type: "action",
          },
          { ephemeral: true },
        );
        return;
      }
      for (const action of data.actions) {
        await postActivity(
          channel,
          options,
          {
            action: actionLabel(action),
            parameter: actionParameter(action),
            type: "action",
          },
          { ephemeral: true },
        );
      }
    },
    async "input.requested"(data, channel) {
      await postActivity(channel, options, {
        body: renderLinearInputRequests(data.requests),
        type: "elicitation",
      });
    },
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = data.message
          ? (firstNonEmptyLine(data.message) ?? null)
          : null;
        return;
      }
      channel.state.pendingToolCallMessage = null;
      if (data.message) {
        await postActivity(channel, options, {
          body: data.message,
          type: "response",
        });
      }
    },
    async "session.failed"(data, channel) {
      const hint = errorHint(data);
      const id = errorId(data.details);
      await postActivity(channel, options, {
        body: [
          `This session could not recover from an error${hint}.`,
          "",
          "Start a new Linear agent session to continue.",
          ...(id ? ["", `Error id: ${id}`] : []),
        ].join("\n"),
        type: "error",
      });
    },
    async "turn.failed"(data, channel) {
      const hint = errorHint(data);
      const id = errorId(data.details);
      await postActivity(channel, options, {
        body: [
          `I hit an error while handling your request${hint}.`,
          "",
          "Please try again, rephrase, or reach out if it keeps failing.",
          ...(id ? ["", `Error id: ${id}`] : []),
        ].join("\n"),
        type: "error",
      });
    },
  };
}

// THE ONE BEHAVIOR CHANGE vs. the built-in `linearChannel()`: cancel any
// turn already running on this session before dispatching the new message,
// instead of letting the new message fold into the next turn. `cancel()` is
// a documented no-op ("no_active_turn") when nothing is running, so calling
// it unconditionally for both `created` and `prompted` actions is correct
// and needs no message-intent classification.
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
  const result = await onAgentSession(ctx, event);
  if (result === null) return;

  const body = event.agentActivity?.body;
  const inputResponses =
    event.action === "prompted" && body !== undefined
      ? await resolvePromptResponses({ body, config, event })
      : [];

  const continuationToken = linearContinuationToken(event.agentSession.id);

  await cancel({ continuationToken });

  await send(
    {
      context: [
        formatLinearContextBlock(event),
        ...event.previousComments,
        ...(result.context ?? []),
      ],
      inputResponses,
      message: messageFromLinearAgentSessionEvent(event),
    },
    {
      auth: result.auth,
      continuationToken,
      state: stateFromAgentSession(event.agentSession),
    },
  );
}

function linearChannel(config: LinearChannelConfig = {}): LinearChannel {
  const onAgentSession = config.onAgentSession ?? defaultOnAgentSession;
  const events = {
    ...createLinearDefaultEvents({
      api: config.api,
      credentials: config.credentials,
    }),
    ...config.events,
  };

  return defineChannel<
    LinearChannelState,
    LinearChannelContext,
    LinearReceiveTarget,
    LinearInstrumentationMetadata
  >({
    state: initialLinearState(),
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
          const body = await verifyInbound(req, config.credentials);
          if (body === null)
            return new Response("unauthorized", { status: 401 });

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
      const initialActivity = readNonEmptyString(
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
  credentials: connectLinearCredentials("linear/ts-rogue-eve"),
});
