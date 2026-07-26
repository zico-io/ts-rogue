import type { LinearChannelConfig } from "eve/channels/linear";
import { callLinearGraphQL } from "eve/channels/linear";

export interface LiveAgentSession {
  readonly id: string;
  readonly createdAt: string;
  readonly url: string | null;
}

const LIVE_STATUSES = new Set(["pending", "active", "awaitingInput"]);

export const STALE_SESSION_MS = 30 * 60 * 1000;

/**
 * Returns non-stale live sessions oldest-first with the id as a stable
 * tie-breaker. Transport failures are left to the caller.
 */
export const listLiveAgentSessions = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly issueId: string;

  readonly now?: number;
}): Promise<readonly LiveAgentSession[]> => {
  const now = input.now ?? Date.now();
  const data = await callLinearGraphQL<{
    issue?: {
      agentSessions?: {
        nodes?: readonly {
          id?: string;
          status?: string;
          createdAt?: string;
          url?: string | null;
          activities?: { nodes?: readonly { updatedAt?: string }[] };
        }[];
      };
    };
  }>({
    credentials: input.credentials,
    query: `
      query IssueLiveAgentSessions($issueId: String!) {
        issue(id: $issueId) {
          agentSessions(first: 50) {
            nodes {
              id status createdAt url
              activities(last: 1) { nodes { updatedAt } }
            }
          }
        }
      }
    `,
    queryName: "IssueLiveAgentSessions",
    variables: { issueId: input.issueId },
  });
  const nodes = data.issue?.agentSessions?.nodes ?? [];
  return nodes
    .flatMap((node) => {
      if (
        typeof node.id !== "string" ||
        typeof node.status !== "string" ||
        !LIVE_STATUSES.has(node.status)
      ) {
        return [];
      }

      const lastActiveIso =
        node.activities?.nodes?.[0]?.updatedAt ?? node.createdAt;
      const lastActiveMs = Date.parse(lastActiveIso ?? "");
      if (
        Number.isFinite(lastActiveMs) &&
        now - lastActiveMs > STALE_SESSION_MS
      ) {
        return [];
      }
      return [
        {
          id: node.id,
          createdAt: typeof node.createdAt === "string" ? node.createdAt : "",
          url: node.url ?? null,
        },
      ];
    })
    .sort((a, b) =>
      a.createdAt === b.createdAt
        ? a.id.localeCompare(b.id)
        : a.createdAt.localeCompare(b.createdAt),
    );
};
