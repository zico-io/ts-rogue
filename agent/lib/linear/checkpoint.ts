const MARKER_PATTERN = /<!-- eve-checkpoint session=([^\s>]+) -->/;

const DISCLOSURE = "Continuing this session with a fresh context window.";

/** The Linear comment body a self-continuation `handoff` posts. */
export const formatCheckpointComment = (
  eveSessionId: string,
  brief: string,
): string =>
  `<!-- eve-checkpoint session=${eveSessionId} -->\n\n${DISCLOSURE}\n\n${brief}`;

/** The eve session id the most recent checkpoint retires, or `null` when there is none. */
export const checkpointedSessionId = (
  previousComments: readonly string[],
): string | null => {
  for (let i = previousComments.length - 1; i >= 0; i--) {
    const marker = MARKER_PATTERN.exec(previousComments[i] ?? "");
    if (marker?.[1] !== undefined) return marker[1];
  }
  return null;
};
