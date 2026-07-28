import type { SessionUpdate } from "./session";

/**
 * Posting to a session from outside its channel handler - a hook, a schedule -
 * where there is no channel context, only the token that addresses the session.
 */
export interface SessionPoster {
  /**
   * Shows one update in the session this continuation token addresses. A token
   * this channel does not own is a no-op, not an error: a session woken through
   * another channel legitimately reaches here.
   */
  post(continuationToken: string, update: SessionUpdate): Promise<void>;
}

// The one place that knows the set of channels, keyed by eve's channel kind
// (each channel's `kindHint`, which eve surfaces as `HookContext.channel.kind`).
// Loaded on demand so a Linear-owned session does not drag another channel's
// credentials into the process.
const POSTERS: Readonly<Record<string, () => Promise<SessionPoster>>> = {
  linear: () => import("./linear/poster").then((module) => module.linearPoster),
};

/**
 * Shows one update in whichever channel owns this session. A channel with no
 * poster shows nothing rather than failing the caller - a hook is observe-only.
 */
export const postUpdate = async (
  channel: {
    readonly continuationToken?: string;
    readonly kind?: string;
  },
  update: SessionUpdate,
): Promise<void> => {
  const load = channel.kind === undefined ? undefined : POSTERS[channel.kind];
  if (load === undefined || !channel.continuationToken) return;
  const poster = await load();
  await poster.post(channel.continuationToken, update);
};
