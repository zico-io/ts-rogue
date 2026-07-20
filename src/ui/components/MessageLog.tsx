import { Box, Text } from "ink";
import type { GameState } from "../../engine/state/types.js";

export interface MessageLogProps {
  messages: GameState["messages"];
  /** How many of the most recent messages to show. Defaults to 5. */
  visible?: number;
}

/** Renders the most recent entries from {@link GameState.messages}, oldest first. */
export function MessageLog({ messages, visible = 5 }: MessageLogProps) {
  const recent = messages.slice(-visible);
  const offset = messages.length - recent.length;
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {recent.length === 0 ? (
        <Text dimColor>(no messages yet)</Text>
      ) : (
        recent.map((message, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages are an append-only, capped log; position is a stable identity within one render.
          <Text key={offset + index} dimColor>
            {message}
          </Text>
        ))
      )}
    </Box>
  );
}
