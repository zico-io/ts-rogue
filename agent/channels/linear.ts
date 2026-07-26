import { timingSafeEqual } from "node:crypto";

import { connectLinearCredentials } from "@vercel/connect/eve";
import type { UserContent } from "ai";
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
  type LinearAgentSessionUpdateInput,
  type LinearChannel,
  type LinearChannelConfig,
  type LinearChannelContext,
  type LinearChannelEvents,
  type LinearChannelState,
  type LinearFetch,
  type LinearHandle,
  type LinearInstrumentationMetadata,
  type LinearReceiveTarget,
  type LinearWebhookSecret,
  linearContinuationToken,
  linearInputRequestSignal,
  listLinearAgentSessionActivities,
  messageFromLinearAgentSessionEvent,
  parseLinearWebhookEvent,
  renderLinearInputRequests,
  signLinearWebhookBody,
  updateLinearAgentSession,
} from "eve/channels/linear";

import { isPlainObject } from "../lib/is-plain-object";
import { advanceIssueState } from "../lib/issue-state";
import { listLiveAgentSessions } from "../lib/live-sessions";
import type { PendingAction } from "../lib/pending-action";
import { stripLeadingProseHeader } from "../lib/prose";
import { toolActionParameter, toolActionResult } from "../lib/tool-activity";
import { toolLabel } from "../lib/tool-label";
import { MAX_ACTIVITY_TEXT_LENGTH, truncate } from "../lib/truncate";

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

async function resolveAccessToken(
  accessToken: NonNullable<LinearChannelConfig["credentials"]>["accessToken"],
): Promise<string> {
  const resolved =
    typeof accessToken === "function"
      ? await accessToken()
      : (accessToken ??
        process.env.LINEAR_AGENT_ACCESS_TOKEN ??
        process.env.LINEAR_ACCESS_TOKEN ??
        process.env.LINEAR_API_KEY ??
        process.env.LINEAR_API_TOKEN);
  if (!resolved) {
    throw new Error(
      "linearChannel: missing Linear access token. Pass credentials.accessToken or set LINEAR_AGENT_ACCESS_TOKEN, LINEAR_ACCESS_TOKEN, LINEAR_API_KEY, or LINEAR_API_TOKEN.",
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

interface LinearUploadImageReference {
  readonly altText: string;
  readonly end: number;
  readonly start: number;
  readonly url: URL;
}

interface LinearImageFilePart {
  readonly data: Buffer;
  readonly mediaType: string;
  readonly type: "file";
}

const MARKDOWN_IMAGE_PATTERN =
  /!\[([^\]\r\n]*)\]\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^)\r\n]*\)))?\s*\)/gu;

export function extractLinearUploadImageReferences(
  text: string,
): LinearUploadImageReference[] {
  const references: LinearUploadImageReference[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const rawUrl = match[2] ?? match[3];
    const start = match.index;
    if (rawUrl === undefined || start === undefined) continue;
    const url = parseLinearUploadUrl(rawUrl);
    if (url !== null) {
      references.push({
        altText: match[1] ?? "",
        end: start + match[0].length,
        start,
        url,
      });
    }
  }
  return references;
}

export async function attachLinearInboundImages(input: {
  readonly content: UserContent;
  readonly credentials?: LinearChannelConfig["credentials"];
  readonly fetch?: LinearFetch;
}): Promise<UserContent> {
  if (typeof input.content !== "string") return input.content;
  const references = extractLinearUploadImageReferences(input.content);
  if (references.length === 0) return input.content;
  let token: string;
  try {
    token = await resolveAccessToken(input.credentials?.accessToken);
  } catch {
    return input.content;
  }
  const fetchImpl = input.fetch ?? fetch;
  const parts = await Promise.all(
    references.map((reference) =>
      fetchLinearUploadImage(reference.url, token, fetchImpl),
    ),
  );
  if (parts.every((part) => part === null)) return input.content;
  return buildLinearImageContent(input.content, references, parts);
}

function parseLinearUploadUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.origin !== "https://uploads.linear.app" ||
    url.username !== "" ||
    url.password !== ""
    ? null
    : url;
}

async function fetchLinearUploadImage(
  url: URL,
  token: string,
  fetchImpl: LinearFetch,
): Promise<LinearImageFilePart | null> {
  if (parseLinearUploadUrl(url.href) === null) return null;
  try {
    const response = await fetchImpl(url.href, {
      credentials: "omit",
      headers: { accept: "image/*", authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    if (!response.ok) return null;
    const mediaType = readImageMediaType(response.headers.get("content-type"));
    if (mediaType === null) return null;
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mediaType,
      type: "file",
    };
  } catch {
    return null;
  }
}

function readImageMediaType(header: string | null): string | null {
  const mediaType = header?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType?.startsWith("image/") === true && mediaType.length > 6
    ? mediaType
    : null;
}

function buildLinearImageContent(
  text: string,
  references: readonly LinearUploadImageReference[],
  parts: ReadonlyArray<LinearImageFilePart | null>,
): UserContent {
  let cursor = 0;
  let remaining = "";
  const files: LinearImageFilePart[] = [];
  for (const [index, reference] of references.entries()) {
    const part = parts[index];
    if (part != null) {
      remaining += text.slice(cursor, reference.start);
      remaining += reference.altText;
      cursor = reference.end;
      files.push(part);
    }
  }
  remaining += text.slice(cursor);
  return remaining.trim().length === 0
    ? files
    : [{ text: remaining, type: "text" }, ...files];
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

type LinearStateWithPending = LinearChannelState & {
  pendingActionsByCallId?: Record<string, PendingAction>;
};

const pendingState = (channel: LinearChannelContext): LinearStateWithPending =>
  channel.state as LinearStateWithPending;

function initialLinearState(): LinearChannelState {
  const state: LinearStateWithPending = {
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
    pendingActionsByCallId: {},
  };
  return state;
}

export function stateFromAgentSession(
  agentSession: LinearAgentSessionRef,
): LinearChannelState {
  const state: LinearStateWithPending = {
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
    pendingActionsByCallId: {},
  };
  return state;
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
    ? toolLabel(action.toolName)
    : action.kind;

// biome-ignore lint/suspicious/noExplicitAny: see actionLabel
const actionParameter = (action: any): string => {
  if (action.kind === "subagent-call" && typeof action.input === "object") {
    const message = action.input?.message;
    if (typeof message === "string") {
      const lead = firstNonEmptyLine(message);
      if (lead) return lead;
    }
  }
  if (action.kind === "tool-call" && action.toolName) {
    return toolActionParameter(action.toolName, action.input);
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

const TODO_STATUS_TO_LINEAR_PLAN_STATUS: Record<
  string,
  "pending" | "inProgress" | "completed" | "canceled"
> = {
  cancelled: "canceled",
  completed: "completed",
  in_progress: "inProgress",
  pending: "pending",
};

interface LinearPlanEntry {
  readonly content: string;
  readonly status: "pending" | "inProgress" | "completed" | "canceled";
}

export function planFromTodoToolOutput(
  output: unknown,
): readonly LinearPlanEntry[] | null {
  if (!isPlainObject(output) || !Array.isArray(output.todos)) return null;
  const entries: LinearPlanEntry[] = [];
  for (const todo of output.todos) {
    if (!isPlainObject(todo)) continue;
    const status =
      typeof todo.status === "string"
        ? TODO_STATUS_TO_LINEAR_PLAN_STATUS[todo.status]
        : undefined;
    if (typeof todo.content !== "string" || status === undefined) continue;
    entries.push({ content: todo.content, status });
  }
  return entries;
}

const syncAgentPlanFromTodoTool: NonNullable<
  LinearChannelEvents["action.result"]
> = async (data, channel) => {
  if (data.status !== "completed") return;
  const { result } = data;
  if (
    result.kind !== "tool-result" ||
    result.toolName !== "todo" ||
    result.isError
  ) {
    return;
  }
  const plan = planFromTodoToolOutput(result.output);
  if (plan === null || plan.length === 0) return;
  await channel.linear.updateSession({
    plan: plan as unknown as LinearAgentSessionUpdateInput["plan"],
  });
};

const connectionDisplayName = (name: string): string =>
  name.replace(/[-_/]+/gu, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const linearUserIdFromAuthContext = (
  auth: {
    readonly authenticator: string;
    readonly principalType: string;
    readonly subject?: string;
  } | null,
): string | undefined =>
  auth?.authenticator === "linear-agent-webhook" &&
  auth.principalType === "user" &&
  auth.subject !== undefined &&
  auth.subject.length > 0 &&
  auth.subject !== "unknown"
    ? auth.subject
    : undefined;

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
      const state = pendingState(channel);
      const pending = state.pendingToolCallMessage;
      state.pendingToolCallMessage = null;
      if (pending) {
        // Durable, not ephemeral - see HAR-68.
        await postActivity(
          channel,
          options,
          { body: pending, type: "thought" },
          {},
        );
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
        const label = actionLabel(action);
        const parameter = actionParameter(action);
        if (
          action.kind === "tool-call" ||
          action.kind === "subagent-call" ||
          action.kind === "remote-agent-call"
        ) {
          state.pendingActionsByCallId = {
            ...(state.pendingActionsByCallId ?? {}),
            [action.callId]: { action: label, parameter },
          };
        }
        await postActivity(
          channel,
          options,
          { action: label, parameter, type: "action" },
          { ephemeral: true },
        );
      }
    },
    async "input.requested"(data, channel) {
      await postActivity(
        channel,
        options,
        {
          body: renderLinearInputRequests(data.requests),
          type: "elicitation",
        },
        linearInputRequestSignal(data.requests),
      );
    },
    async "message.completed"(data, channel) {
      const message = data.message
        ? stripLeadingProseHeader(data.message)
        : null;
      if (data.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = message
          ? (firstNonEmptyLine(message) ?? null)
          : null;
        return;
      }
      channel.state.pendingToolCallMessage = null;
      if (message) {
        await postActivity(channel, options, {
          body: message,
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

      if (channel.state.issueId != null) {
        await advanceIssueState({
          credentials: options.credentials,
          issueRef: channel.state.issueId,
          target: "blocked",
        });
      }
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
    async "authorization.required"(data, channel, ctx) {
      const challenge = data.authorization;
      const displayName =
        challenge?.displayName ?? connectionDisplayName(data.name);
      const body = [
        `I need you to connect ${displayName} before I can continue.`,
        ...(challenge?.instructions ? ["", challenge.instructions] : []),
        ...(challenge?.userCode ? ["", `Code: ${challenge.userCode}`] : []),
      ].join("\n");
      const url = challenge?.url;
      if (url === undefined) {
        await postActivity(channel, options, { body, type: "elicitation" });
        return;
      }
      const userId = linearUserIdFromAuthContext(ctx.session.auth.current);
      await postActivity(
        channel,
        options,
        { body, type: "elicitation" },
        {
          signal: "auth",
          signalMetadata: {
            providerName: displayName,
            url,
            ...(userId !== undefined ? { userId } : {}),
          },
        },
      );
    },
    async "authorization.completed"(data, channel) {
      const displayName =
        data.authorization?.displayName ?? connectionDisplayName(data.name);
      if (data.outcome === "authorized") {
        await postActivity(
          channel,
          options,
          { body: `Connected to ${displayName}. Resuming.`, type: "thought" },
          { ephemeral: true },
        );
        return;
      }
      const outcome = data.outcome === "timed-out" ? "timed out" : data.outcome;
      await postActivity(channel, options, {
        body: `Authorization for ${displayName} ${outcome}${data.reason ? `: ${data.reason}` : "."}`,
        type: "thought",
      });
    },
    async "action.result"(data, channel, ctx) {
      await syncAgentPlanFromTodoTool(data, channel, ctx);

      if (
        data.result.kind !== "tool-result" &&
        data.result.kind !== "subagent-result"
      )
        return;
      const state = pendingState(channel);
      const pending = state.pendingActionsByCallId?.[data.result.callId];
      if (!pending) return;

      const { [data.result.callId]: _, ...rest } =
        state.pendingActionsByCallId ?? {};
      state.pendingActionsByCallId = rest;
      let rawResult: string;
      if (data.error?.message) {
        rawResult = data.error.message;
      } else if (data.result.kind === "tool-result") {
        rawResult = toolActionResult(
          data.result.toolName,
          data.result.output,
          data.result.isError,
        );
      } else {
        try {
          rawResult = JSON.stringify(data.result.output);
        } catch {
          rawResult = "";
        }
      }
      // Durable (HAR-45's audit record): Linear replaces an ephemeral
      // activity with whatever posts next, ephemeral or not, so the durable
      // thought above already stops it from being clobbered (HAR-68).
      await postActivity(
        channel,
        options,
        {
          type: "action",
          action: pending.action,
          parameter: pending.parameter,
          result: truncate(rawResult, MAX_ACTIVITY_TEXT_LENGTH),
        },
        {},
      );
    },
  };
}

const agentCredentials = connectLinearCredentials("linear/ts-rogue-eve");

export const guardedOnAgentSession: NonNullable<
  LinearChannelConfig["onAgentSession"]
> = async (ctx, event) => {
  const base = defaultOnAgentSession(ctx, event);
  if (base === null || event.action !== "created") return base;
  const session = event.agentSession;
  if (session.creatorId != null && session.creatorId === session.appUserId) {
    return base;
  }
  const issueId = session.issueId ?? session.issue?.id;
  if (issueId == null) return base;
  let live: Awaited<ReturnType<typeof listLiveAgentSessions>>;
  try {
    live = await listLiveAgentSessions({
      credentials: agentCredentials,
      issueId,
    });
  } catch {
    return base;
  }

  const selfIndex = live.findIndex((candidate) => candidate.id === session.id);
  const blocker = (selfIndex === -1 ? live : live.slice(0, selfIndex)).find(
    (candidate) => candidate.id !== session.id,
  );
  if (blocker === undefined) return base;
  await ctx.linear.createActivity({
    body: `An agent session is already live on this issue${blocker.url ? `: ${blocker.url}` : ""}. Follow the work there - this duplicate session will not start.`,
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

  if (event.action === "prompted" && event.agentActivity?.signal === "stop") {
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
    kindHint: "linear",
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
  credentials: agentCredentials,
  onAgentSession: guardedOnAgentSession,
});
