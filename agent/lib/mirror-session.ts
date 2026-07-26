import { callLinearGraphQL } from "eve/channels/linear";
import type { LinearChannelConfig } from "eve/channels/linear";

import { isPlainObject } from "./is-plain-object";

// A "mirror" Agent Session is one the relay hook creates on an issue to carry a
// single delegated child's live activity as its OWN top-level Linear card,
// instead of folding that child's thought/action stream into the parent
// session's open "Working" block (Linear's feed is flat - `thought`/`action`
// always nest under the receiving session's turn, so a separate session is the
// only way to get a separate top-level block; verified against
// linear.app/developers/agent-interaction and the GraphQL schema).
//
// Mirror sessions are created by the app itself and must never spin up their
// own eve turn or count toward the one-live-session-per-issue invariant. Both
// exemptions key off this marker.
//
// Naming asymmetry (confirmed via schema introspection): the marker is WRITTEN
// through the create input's `externalUrls: [{url, label}]`
// (`AgentSessionCreateOnIssue`, non-deprecated input field), but READ back
// through the session's `externalLinks { label url }` field - the `AgentSession`
// type has no readable `externalUrls`. So writes say `externalUrls`, reads say
// `externalLinks`.
export const MIRROR_MARKER = {
  label: "eve-subagent-mirror",
  url: "https://eve.internal/subagent-mirror",
} as const;

const linksCarryMarker = (links: unknown): boolean =>
  Array.isArray(links) &&
  links.some(
    (entry) => isPlainObject(entry) && entry.label === MIRROR_MARKER.label,
  );

/** GraphQL selection for reading a session's external links back (marker check). */
export const EXTERNAL_LINKS_SELECTION = "externalLinks { label url }";

/**
 * Detects a mirror session directly from the raw `created` webhook payload -
 * free when the payload carries the session's external links. Checks the read
 * key (`externalLinks`) and, defensively, the input key (`externalUrls`) since
 * the webhook's exact shape isn't guaranteed. Returns false when neither is
 * present, so callers fall back to a lookup.
 */
export const isMirrorSessionFromRaw = (raw: unknown): boolean => {
  const session = isPlainObject(raw) ? raw.agentSession : undefined;
  if (!isPlainObject(session)) return false;
  return (
    linksCarryMarker(session.externalLinks) ||
    linksCarryMarker(session.externalUrls)
  );
};

/**
 * Fallback marker check: one GraphQL read of the session's external links. Fails
 * open to `false` (treat as a real session) so a flaky read can never wrongly
 * decline a legitimate session's dispatch.
 */
export const isMirrorSessionById = async (input: {
  readonly credentials: LinearChannelConfig["credentials"];
  readonly agentSessionId: string;
}): Promise<boolean> => {
  try {
    const data = await callLinearGraphQL<{
      agentSession?: { externalLinks?: unknown };
    }>({
      credentials: input.credentials,
      query: `
        query AgentSessionExternalLinks($id: String!) {
          agentSession(id: $id) { ${EXTERNAL_LINKS_SELECTION} }
        }
      `,
      queryName: "AgentSessionExternalLinks",
      variables: { id: input.agentSessionId },
    });
    return linksCarryMarker(data.agentSession?.externalLinks);
  } catch {
    return false;
  }
};

/** Whether a session's already-fetched external links carry the mirror marker. */
export const externalLinksAreMirror = linksCarryMarker;
