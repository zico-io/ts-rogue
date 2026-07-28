import type {
  LinearAgentSessionRef,
  LinearChannelConfig,
  LinearChannelContext,
  LinearChannelState,
  LinearReceiveTarget,
} from "eve/channels/linear";
import {
  createLinearAgentSessionOnComment,
  createLinearAgentSessionOnIssue,
} from "eve/channels/linear";

import { isPlainObject, nonEmptyString } from "../narrow";
import type { PendingAction } from "../session";
import { type LiveAgentSession, listLiveAgentSessions } from "./live-sessions";

/**
 * The channel state plus the in-flight actions awaiting a result, keyed by call
 * id so `action.result` can pair a result back to the chip that announced it.
 */
export type LinearStateWithPending = LinearChannelState & {
  pendingActionsByCallId?: Record<string, PendingAction>;
};

export const pendingState = (
  channel: LinearChannelContext,
): LinearStateWithPending => channel.state as LinearStateWithPending;

const hasNonEmptyString = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<K, string> =>
  typeof value[key] === "string" && (value[key] as string).length > 0;

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

export function initialSessionState(): LinearStateWithPending {
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
    pendingActionsByCallId: {},
  };
}

export function stateFromAgentSession(
  agentSession: LinearAgentSessionRef,
): LinearStateWithPending {
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
    pendingActionsByCallId: {},
  };
}

/** Resolves a proactive `receive` target to the session it should post into. */
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
      externalLink: nonEmptyString(target.externalLink),
      externalUrls: readExternalUrls(target.externalUrls),
    });
  }
  if (hasNonEmptyString(target, "commentId")) {
    return createLinearAgentSessionOnComment({
      api: config.api,
      credentials: config.credentials,
      commentId: target.commentId,
      externalLink: nonEmptyString(target.externalLink),
      externalUrls: readExternalUrls(target.externalUrls),
    });
  }
  throw new Error(
    "linearChannel().receive requires target.agentSessionId, issueId, or commentId.",
  );
}

/** A human pressed stop, which ends the turn instead of dispatching it. */
export const isStopSignal = (event: {
  readonly action: string;
  readonly agentActivity?: { readonly signal?: string | null } | null;
}): boolean =>
  event.action === "prompted" && event.agentActivity?.signal === "stop";

interface GuardableSession {
  readonly appUserId?: string | null;
  readonly creatorId?: string | null;
  readonly id: string;
  readonly issue?: { readonly id?: string } | null;
  readonly issueId?: string | null;
}

/**
 * Only one live session works an issue at a time. Returns the older session
 * that blocks this one, or `null` when it may start. Agent-created sessions
 * (handoff successors) are exempt, and a failed lookup fails open.
 */
export const findDuplicateSessionBlocker = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly session: GuardableSession;
}): Promise<LiveAgentSession | null> => {
  const { session } = input;
  if (session.creatorId != null && session.creatorId === session.appUserId) {
    return null;
  }
  const issueId = session.issueId ?? session.issue?.id;
  if (issueId == null) return null;
  let live: readonly LiveAgentSession[];
  try {
    live = await listLiveAgentSessions({
      credentials: input.credentials,
      issueId,
    });
  } catch {
    return null;
  }
  const selfIndex = live.findIndex((candidate) => candidate.id === session.id);
  return (
    (selfIndex === -1 ? live : live.slice(0, selfIndex)).find(
      (candidate) => candidate.id !== session.id,
    ) ?? null
  );
};

export const duplicateSessionDeclineBody = (
  blocker: LiveAgentSession,
): string =>
  `An agent session is already live on this issue${blocker.url ? `: ${blocker.url}` : ""}. Follow the work there - this duplicate session will not start.`;
