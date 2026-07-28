import type {
  LinearChannelConfig,
  LinearChannelContext,
  LinearChannelState,
} from "eve/channels/linear";

import type { PendingAction } from "../session";
import { type LiveAgentSession, listLiveAgentSessions } from "./live-sessions";

/** The channel state plus the in-flight actions awaiting a result, keyed by call id. */
export type LinearStateWithPending = LinearChannelState & {
  pendingActionsByCallId?: Record<string, PendingAction>;
};

export const pendingState = (
  channel: LinearChannelContext,
): LinearStateWithPending => channel.state as LinearStateWithPending;

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

/** The older session blocking this one, or `null` when it may start; fails open. */
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
