import { truncatePreservingTrailingUrl } from "../truncate";

/** How much of one Linear Agent Activity text field a chip may fill. */
export const MAX_ACTIVITY_TEXT_LENGTH = 300;

const FENCE_CLOSE = "\n```";

/**
 * Truncation can cut a fenced code block in half, leaving an open ``` with no
 * matching close - Linear would then render the rest of the activity as code.
 */
const hasDanglingFence = (text: string): boolean =>
  (text.match(/```/g) ?? []).length % 2 === 1;

/**
 * Fits arbitrary text into one Linear activity field, closing a fence the cut
 * left open. The only place the cap is applied: when this ran in `lib/` too,
 * the channel's second truncation cut the closing fence back off.
 */
export const activityText = (text: string): string => {
  const fitted = truncatePreservingTrailingUrl(text, MAX_ACTIVITY_TEXT_LENGTH);
  if (!hasDanglingFence(fitted)) return fitted;
  // Re-cut with room reserved for the fence so the result still fits.
  const shorter = truncatePreservingTrailingUrl(
    text,
    MAX_ACTIVITY_TEXT_LENGTH - FENCE_CLOSE.length,
  );
  return hasDanglingFence(shorter) ? `${shorter}${FENCE_CLOSE}` : shorter;
};
