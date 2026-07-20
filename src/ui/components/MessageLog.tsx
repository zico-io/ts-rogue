import { Box, Text } from "ink";

export interface MessageLogProps {
  messages: readonly string[];
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 8;

/** Renders the tail of a message log, most recent line last. Presentational only. */
export function MessageLog({
  messages,
  maxLines = DEFAULT_MAX_LINES,
}: MessageLogProps) {
  const start = Math.max(0, messages.length - maxLines);
  const visible = messages.slice(start);
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
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
