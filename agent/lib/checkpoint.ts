import { linearContinuationToken } from "eve/channels/linear";

// Context-checkpoint rotation: keep ONE Linear Agent Session but give it a
// fresh, empty eve session (context window) at a phase boundary, so a later
// webhook (PR review, merge) does not resume - and re-read on every tool
// round-trip - a session that accumulated the whole implementation.
//
// The eve continuation token is the sole routing key, and Linear activities
// post to the stable `agentSession.id` independently of it, so sending to a
// never-seen token spins up a fresh eve session while Linear still sees one
// continuous session. We rotate by suffixing the token with an epoch, and we
// derive that epoch from data already on every webhook - the count of
// checkpoint-marker comments in `previousComments` - so nothing extra has to be
// persisted. The `handoff` tool posts one of these comments for its
// self-continuation case (see agent/tools/handoff.ts); the Linear route reads
// them (see agent/channels/linear.ts).
//
// Degrades safely: if Linear ever omits app-authored comments from
// `previousComments`, the epoch stays 0, the token stays the base token, and
// behavior is exactly as before - rotation simply does not engage.

export const EVE_CHECKPOINT_MARKER = "<!-- eve-checkpoint -->";
const CHECKPOINT_HEADING = "**Context checkpoint**";

/** The Linear comment body a self-continuation `handoff` posts. */
export const formatCheckpointComment = (brief: string): string =>
  `${EVE_CHECKPOINT_MARKER}\n\n${CHECKPOINT_HEADING}\n\n${brief}`;

const isCheckpoint = (comment: string): boolean =>
  comment.includes(EVE_CHECKPOINT_MARKER);

/** How many context checkpoints have been posted = the current epoch. */
export const epochFromComments = (
  previousComments: readonly string[],
): number => previousComments.filter(isCheckpoint).length;

/**
 * The most recent checkpoint's brief (marker and heading stripped), to seed the
 * fresh epoch's context. `previousComments` is assumed chronological (Linear's
 * thread order); the last marked comment wins. Returns null when there is none.
 */
export const latestCheckpointBrief = (
  previousComments: readonly string[],
): string | null => {
  for (let i = previousComments.length - 1; i >= 0; i--) {
    const comment = previousComments[i];
    if (comment !== undefined && isCheckpoint(comment)) {
      return comment
        .split(EVE_CHECKPOINT_MARKER)
        .join("")
        .replace(CHECKPOINT_HEADING, "")
        .trim();
    }
  }
  return null;
};

/**
 * The eve continuation token for a given epoch. Epoch 0 is the canonical base
 * token (`agent-session:<id>`), so pre-checkpoint behavior is byte-identical to
 * before; each checkpoint appends `:e<N>`, a never-seen token that eve resolves
 * to a fresh session.
 */
export const epochContinuationToken = (
  agentSessionId: string,
  epoch: number,
): string => {
  const base = linearContinuationToken(agentSessionId);
  return epoch <= 0 ? base : `${base}:e${epoch}`;
};
