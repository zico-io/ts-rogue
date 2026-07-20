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
  const visible = messages.slice(-maxLines);
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      {visible.length === 0 ? (
        <Text dimColor>(no messages yet)</Text>
      ) : (
        visible.map((message) => (
          <Text dimColor key={message}>
            {message}
          </Text>
        ))
      )}
    </Box>
  );
}
