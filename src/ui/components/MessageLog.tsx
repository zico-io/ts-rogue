import { Box, Text } from "ink";

export interface MessageLogProps {
  messages: readonly string[];
  /**
   * Fixed box width in terminal columns (border included). When provided,
   * message lines wrap within the box so the log never spills horizontally.
   */
  width?: number;
  /**
   * Fixed box height in terminal rows (border included). When provided, the
   * scrollback shows `height - 2` lines (one inside the top/bottom border) so
   * the log derives its size from the space it is given and never overflows.
   * When omitted, falls back to `maxLines` (default 8).
   */
  height?: number;
  /** Number of message lines to show when `height` is not provided. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 8;

/** Renders the tail of a message log, most recent line last. Presentational only. */
export function MessageLog({
  messages,
  width,
  height,
  maxLines = DEFAULT_MAX_LINES,
}: MessageLogProps) {
  const visibleLines =
    height !== undefined ? Math.max(1, height - 2) : maxLines;
  const start = Math.max(0, messages.length - visibleLines);
  const visible = messages.slice(start);
  const boxProps = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height, overflow: "hidden" as const } : {}),
  };
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1} {...boxProps}>
      {visible.length === 0 ? (
        <Text dimColor>(no messages yet)</Text>
      ) : (
        visible.map((message, index) => (
          // Key by absolute log position: unique even when lines repeat, and
          // stable per occurrence as new lines append.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only tail, position is identity
          <Text dimColor key={start + index}>
            {message}
          </Text>
        ))
      )}
    </Box>
  );
}
