// Context-checkpoint rotation: keep ONE Linear Agent Session but give it a
// fresh, empty eve session at a phase boundary, so a later webhook (review,
// merge, the next human message) does not resume - and re-read on every tool
// round-trip - a session that accumulated the whole implementation.
//
// `handoff` marks the boundary by posting an ordinary Linear comment carrying
// this marker plus its own eve session id (see `tools/handoff.ts`), then ends
// the turn. The Linear route reads the marker off the next inbound webhook's
// `previousComments` and retires that session with eve's `reset`, so eve's own
// dispatch - which owns the continuation token and hardcodes it from the Agent
// Session id - re-creates it empty. Linear sees one continuous Agent Session
// throughout; only the eve context window behind it turns over.
//
// The embedded session id is what makes this idempotent without persisting
// anything: it names the session the checkpoint retires, so the route rotates
// only while that exact session still owns the token. Once rotated, the token
// belongs to a different session and every later webhook is a no-op - which is
// why two messages in quick succession cannot wipe the fresh session's work.
//
// Degrades safely in both unknowns: if Linear omits app-authored comments from
// `previousComments` the marker is never seen, and if the id does not match the
// live session nothing is retired. Either way rotation simply does not engage
// and behavior is exactly as before.

const MARKER_PATTERN = /<!-- eve-checkpoint session=([^\s>]+) -->/;

/** The Linear comment body a self-continuation `handoff` posts. */
export const formatCheckpointComment = (
  eveSessionId: string,
  brief: string,
): string => `<!-- eve-checkpoint session=${eveSessionId} -->\n\n${brief}`;

/**
 * The eve session id the most recent checkpoint retires, or `null` when no
 * comment carries a marker. `previousComments` is Linear's thread order, so the
 * last marked comment is the live checkpoint.
 */
export const checkpointedSessionId = (
  previousComments: readonly string[],
): string | null => {
  for (let i = previousComments.length - 1; i >= 0; i--) {
    const marker = MARKER_PATTERN.exec(previousComments[i] ?? "");
    if (marker?.[1] !== undefined) return marker[1];
  }
  return null;
};
