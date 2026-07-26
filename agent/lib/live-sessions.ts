import { callLinearGraphQL } from "eve/channels/linear";
import type { LinearChannelConfig } from "eve/channels/linear";

import {
  EXTERNAL_LINKS_SELECTION,
  externalLinksAreMirror,
} from "./mirror-session";

// Shared pre-check for the one-live-session-per-issue invariant (HAR-26
// follow-up): both the `handoff` tool (before creating a session) and the
// Linear channel's created-webhook guard (before dispatching one) ask the
// same question - which Agent Sessions on this issue are still live? Linear
// itself is the registry; eve keeps no cross-session state that could answer
// it.

export interface LiveAgentSession {
  readonly id: string;
  readonly createdAt: string;
  readonly url: string | null;
}

// Linear's AgentSessionStatus values that mean the session is still doing or
// awaiting work. `complete`, `error`, and `stale` sessions are dead and never
// block a new one. Status alone is not enough: a live-status session idle
// beyond STALE_SESSION_MS is also excluded (see below) - Linear does not
// promptly demote a wedged session, so trusting status alone let a stalled
// session block every new launch forever.
const LIVE_STATUSES = new Set(["pending", "active", "awaitingInput"]);

// A session in a live status but silent for this long is treated as dead.
// Linear does not promptly transition a stalled session out of
// active/awaitingInput, so without this a wedged session (e.g. the git-auth
// stall fixed in a101015) blocks every new launch forever. 30 min clears any
// real turn's activity cadence and the ~10-min token-retry endurance, so a
// working session is never misjudged.
export const STALE_SESSION_MS = 30 * 60 * 1000;

/**
 * Lists an issue's live Agent Sessions, oldest first (`createdAt` ascending,
 * id as tie-break). The stable order is what lets callers apply oldest-wins
 * dedup deterministically. Throws on transport failure - callers decide
 * whether to fail open.
 */
export const listLiveAgentSessions = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly issueId: string;
  // Wall clock for the staleness check; defaults to Date.now(). Injectable so
  // tests can assert age-based exclusion deterministically.
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
          externalLinks?: unknown;
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
              ${EXTERNAL_LINKS_SELECTION}
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
      // Mirror sessions (per-child top-level cards, see `hooks/relay.ts`) are
      // not real work and must never block a legitimate handoff/dispatch or be
      // counted by the one-live-session-per-issue guard.
      if (externalLinksAreMirror(node.externalLinks)) {
        return [];
      }
      // Most recent activity is the truest "last active" signal; fall back to
      // the session's own createdAt when it has no activities yet (a genuinely
      // new pending session). An unparseable timestamp (NaN) is NOT treated as
      // stale, so a parse glitch can never silently drop a real session.
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
