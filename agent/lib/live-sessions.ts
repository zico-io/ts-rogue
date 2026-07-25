import { callLinearGraphQL } from "eve/channels/linear";
import type { LinearChannelConfig } from "eve/channels/linear";

// Shared pre-check for the one-live-session-per-issue invariant (HAR-26
// follow-up): both the `handoff` tool (before creating a session) and the
// Linear channel's created-webhook guard (before dispatching one) ask the
// same question - which Agent Sessions on this issue are still live? Linear
// itself is the registry; eve keeps no cross-session state that could answer
// it.

export interface LiveAgentSession {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly url: string | null;
}

// Linear's AgentSessionStatus values that mean the session is still doing or
// awaiting work. `complete`, `error`, and `stale` sessions are dead and never
// block a new one.
const LIVE_STATUSES = new Set(["pending", "active", "awaitingInput"]);

/**
 * Lists an issue's live Agent Sessions, oldest first (`createdAt` ascending,
 * id as tie-break). The stable order is what lets callers apply oldest-wins
 * dedup deterministically. Throws on transport failure - callers decide
 * whether to fail open.
 */
export const listLiveAgentSessions = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly issueId: string;
}): Promise<readonly LiveAgentSession[]> => {
  const data = await callLinearGraphQL<{
    issue?: {
      agentSessions?: {
        nodes?: readonly {
          id?: string;
          status?: string;
          createdAt?: string;
          url?: string | null;
        }[];
      };
    };
  }>({
    credentials: input.credentials,
    query: `
      query IssueLiveAgentSessions($issueId: String!) {
        issue(id: $issueId) {
          agentSessions(first: 50) {
            nodes { id status createdAt url }
          }
        }
      }
    `,
    queryName: "IssueLiveAgentSessions",
    variables: { issueId: input.issueId },
  });
  const nodes = data.issue?.agentSessions?.nodes ?? [];
  return nodes
    .flatMap((node) =>
      typeof node.id === "string" &&
      typeof node.status === "string" &&
      LIVE_STATUSES.has(node.status)
        ? [
            {
              id: node.id,
              status: node.status,
              createdAt: typeof node.createdAt === "string" ? node.createdAt : "",
              url: node.url ?? null,
            },
          ]
        : [],
    )
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    );
};
