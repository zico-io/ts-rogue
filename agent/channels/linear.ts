import { timingSafeEqual } from "node:crypto";

import { connectLinearCredentials } from "@vercel/connect/eve";
import { type CancelFn, defineChannel, POST } from "eve/channels";
import {
  callLinearGraphQL,
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
  signLinearWebhookBody,
  updateLinearAgentSession,
} from "eve/channels/linear";
import type { InputOption, InputRequest, InputResponse } from "eve/client";

// Hand-rolled port of eve's built-in `linearChannel()` (see
// `node_modules/eve/dist/src/public/channels/linear/linearChannel.js`),
// reimplemented via `defineChannel` so the agent-session dispatch path can
// reach the route's `cancel()` primitive - the built-in convenience wrapper
// doesn't expose it. Everything below calls the same publicly exported
// building blocks the built-in wrapper calls, with three exceptions the
// wrapper needs but the package does not actually export from
// `eve/channels/linear` (confirmed against the runtime module's own key
// list, not just its `.d.ts` files): webhook signature verification, the
// default progress/response/HITL/error event handlers, and (as of HAR-17)
// elicitation rendering/resolution. All three are reimplemented below from
// the de-minified built-in source, built only from genuinely public
// primitives (`signLinearWebhookBody`, `node:crypto`, and
// `createLinearAgentActivity`/`callLinearGraphQL`) - see
// `verifyInboundSignature`, `createLinearDefaultEvents`, and the
// "Elicitation rendering/resolution" section. The elicitation piece is a
// deliberate deviation, not just a gap-fill: the built-in
// `renderLinearInputRequests`/`resolveLinearPromptInputResponses` track a
// reply's target request by appending a hidden `<!-- eve-input:... -->`
// marker straight into the same visible Linear message body they render, so
// every elicitation a human sees carries a leaked tracking blob (HAR-17).
// The one actual behavior change from the built-in beyond that is the
// unconditional `cancel()` before `send()` in `dispatchAgentSession`. See
// `agent/README.md` for what this does and does not cover.

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
    return resolveElicitationResponses({
      activities: await listElicitationActivities({
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

// --- Elicitation rendering/resolution (HAR-17) ------------------------------
// eve's built-in `renderLinearInputRequests`/`resolveLinearPromptInputResponses`
// (`eve/channels/linear`, backed by
// `node_modules/eve/dist/src/public/channels/linear/hitl.js`) track which
// input requests a reply answers by appending a hidden
// `<!-- eve-input:... -->` marker straight into the same visible Linear
// message body it renders - so every elicitation a human sees carries a
// leaked base64 blob. Linear Activities already have a `signalMetadata`
// field (`LinearAgentActivityCreateInput.signalMetadata`, see
// `node_modules/eve/dist/src/public/channels/linear/api.d.ts`) built exactly
// for durable per-activity metadata that never renders into the message
// body. What follows re-implements the same rendering/matching semantics
// against `signalMetadata` instead of a body marker.

/**
 * Minimal per-request shape stored in an elicitation activity's
 * `signalMetadata.eveInputRequests`. Mirrors the field names of eve's own
 * built-in `storableRequest` (same hitl.js as above) but keeps only what
 * `resolveElicitationResponses` needs to match a reply - `prompt`/`display`
 * are rendered into the body once and never read back.
 */
interface StorableInputRequest {
  readonly requestId: string;
  readonly allowFreeform?: boolean;
  readonly options?: readonly InputOption[];
}

// `LinearAgentActivityCreateInput.signalMetadata` is typed as the internal,
// non-exported `JsonObject` (see
// `node_modules/eve/dist/src/public/channels/linear/api.d.ts`). Extracted
// this way - the same `Parameters<...>` extraction `postActivity` already
// uses for `content` above - rather than importing an unexported type name.
// `StorableInputRequest` is genuinely JSON-safe (only strings, booleans, and
// nested option records); TS just can't verify that through a named
// interface without a matching index signature, hence the cast where this
// type is used.
type LinearActivitySignalMetadata = NonNullable<
  Parameters<typeof createLinearAgentActivity>[0]["activity"]["signalMetadata"]
>;

function storableRequest(request: InputRequest): StorableInputRequest {
  const stored: {
    requestId: string;
    allowFreeform?: boolean;
    options?: readonly InputOption[];
  } = { requestId: request.requestId };
  if (request.allowFreeform !== undefined) {
    stored.allowFreeform = request.allowFreeform;
  }
  if (request.options !== undefined) stored.options = request.options;
  return stored;
}

// Port of eve's built-in `renderLinearInputRequest` (singular, same hitl.js
// as above): prompt line, then a blank line and a numbered option list,
// then - if freeform is allowed - a trailing hint. No marker appended.
function renderElicitationRequest(request: InputRequest): string {
  const lines = [request.prompt];
  if (request.options !== undefined && request.options.length > 0) {
    lines.push(
      "",
      ...request.options.map((option, index) => {
        const description = option.description
          ? ` - ${option.description}`
          : "";
        return `${index + 1}. ${option.label}${description}`;
      }),
    );
  }
  if (request.allowFreeform === true) {
    lines.push("", "You can also reply with a custom answer.");
  }
  return lines.join("\n");
}

function renderElicitationBody(requests: readonly InputRequest[]): string {
  return requests.map(renderElicitationRequest).join("\n\n");
}

// Port of eve's built-in `matchOption`/`resolveTextToResponse`
// (`node_modules/eve/dist/src/channel/resolve-text.js`, not exported from
// any public barrel): exact option id match, then exact label match
// (case-insensitive), then a 1-based option number, else - when freeform is
// allowed or there are no options at all - the raw trimmed reply as text.
function matchStoredOption(
  reply: string,
  options: readonly InputOption[],
): InputOption | undefined {
  const byId = options.find((option) => option.id.toLowerCase() === reply);
  if (byId !== undefined) return byId;
  const byLabel = options.find(
    (option) => option.label.toLowerCase() === reply,
  );
  if (byLabel !== undefined) return byLabel;
  const asNumber = Number(reply);
  if (
    Number.isInteger(asNumber) &&
    asNumber > 0 &&
    asNumber <= options.length
  ) {
    return options[asNumber - 1];
  }
  return undefined;
}

function resolveStoredRequestResponse(
  body: string,
  request: StorableInputRequest,
): InputResponse | undefined {
  const trimmed = body.trim();
  if (trimmed.length === 0) return undefined;
  const lower = trimmed.toLowerCase();
  if (request.options !== undefined && request.options.length > 0) {
    const match = matchStoredOption(lower, request.options);
    if (match !== undefined) {
      return { requestId: request.requestId, optionId: match.id };
    }
  }
  if (
    (request.allowFreeform === true ||
      request.options === undefined ||
      request.options.length === 0) &&
    trimmed.length > 0
  ) {
    return { requestId: request.requestId, text: trimmed };
  }
  return undefined;
}

function isStorableInputRequest(value: unknown): value is StorableInputRequest {
  if (!isPlainObject(value) || typeof value.requestId !== "string") {
    return false;
  }
  if (
    value.allowFreeform !== undefined &&
    typeof value.allowFreeform !== "boolean"
  ) {
    return false;
  }
  if (value.options === undefined) return true;
  return (
    Array.isArray(value.options) &&
    value.options.every(
      (option) =>
        isPlainObject(option) &&
        typeof option.id === "string" &&
        typeof option.label === "string",
    )
  );
}

interface ActivityWithSignalMetadata {
  readonly content: { readonly body?: string; readonly type?: string };
  readonly signalMetadata: Record<string, unknown> | null;
}

// Scans backward for the latest elicitation activity carrying a valid
// `eveInputRequests` payload, mirroring the built-in's own backward scan in
// `findLatestLinearHitlMarker` (same hitl.js as above).
function latestElicitationRequests(
  activities: readonly ActivityWithSignalMetadata[],
): readonly StorableInputRequest[] | undefined {
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index];
    if (activity?.content.type !== "elicitation") continue;
    const requests = activity.signalMetadata?.eveInputRequests;
    if (Array.isArray(requests) && requests.every(isStorableInputRequest)) {
      return requests;
    }
  }
  return undefined;
}

function resolveElicitationResponses(input: {
  readonly activities: readonly ActivityWithSignalMetadata[];
  readonly body: string;
}): readonly InputResponse[] {
  const requests = latestElicitationRequests(input.activities);
  if (requests === undefined) return [];
  const responses: InputResponse[] = [];
  for (const request of requests) {
    const response = resolveStoredRequestResponse(input.body, request);
    if (response !== undefined) responses.push(response);
  }
  return responses;
}

/**
 * Extends eve's built-in `listLinearAgentSessionActivities` query (see
 * `node_modules/eve/dist/src/public/channels/linear/api.js`) with the
 * `signal`/`signalMetadata` Activity fields the public barrel's query never
 * selects, even though `signalMetadata` is a first-class input the same
 * barrel's `createLinearAgentActivity` already accepts when creating an
 * Activity - the query just never reads it back. Hand-rolled against the
 * public `callLinearGraphQL` transport, the same pattern
 * `tools/handoff.ts`'s `createLinearComment` uses for a mutation missing
 * from the same barrel.
 */
async function listElicitationActivities(input: {
  readonly api?: LinearChannelConfig["api"];
  readonly credentials?: LinearChannelConfig["credentials"];
  readonly agentSessionId: string;
  readonly last?: number;
}): Promise<readonly ActivityWithSignalMetadata[]> {
  const data = await callLinearGraphQL<{
    agentSession?: { activities?: { nodes?: unknown[] } };
  }>({
    api: input.api,
    credentials: input.credentials,
    query: `
      query AgentSessionActivitiesWithSignal($id: String!, $last: Int!) {
        agentSession(id: $id) {
          activities(last: $last) {
            nodes {
              id
              updatedAt
              content {
                __typename
                ... on AgentActivityElicitationContent { body type }
                ... on AgentActivityPromptContent { body type }
                ... on AgentActivityResponseContent { body type }
                ... on AgentActivityThoughtContent { body type }
                ... on AgentActivityErrorContent { body type }
              }
              signal
              signalMetadata
            }
          }
        }
      }
    `,
    queryName: "AgentSessionActivitiesWithSignal",
    variables: { id: input.agentSessionId, last: input.last ?? 20 },
  });
  const nodes = data.agentSession?.activities?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node): ActivityWithSignalMetadata[] => {
    if (!isPlainObject(node) || !isPlainObject(node.content)) return [];
    const content: { body?: string; type?: string } = {};
    if (typeof node.content.body === "string") content.body = node.content.body;
    if (typeof node.content.type === "string") content.type = node.content.type;
    return [
      {
        content,
        signalMetadata: isPlainObject(node.signalMetadata)
          ? node.signalMetadata
          : null,
      },
    ];
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
      // Posted via `createLinearAgentActivity` directly rather than
      // `postActivity` - this is the one activity that needs
      // `signalMetadata`, which `postActivity`'s other call sites don't use.
      await createLinearAgentActivity({
        api: options.api,
        credentials: options.credentials,
        activity: {
          agentSessionId: requireAgentSessionId(channel.state.agentSessionId),
          content: {
            body: renderElicitationBody(data.requests),
            type: "elicitation",
          },
          signalMetadata: {
            eveInputRequests: data.requests.map(storableRequest),
          } as unknown as LinearActivitySignalMetadata,
        },
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
