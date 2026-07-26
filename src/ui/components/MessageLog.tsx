import { Box, Text } from "ink";
import type { LogEntry } from "../../engine/state/types";
import { theme } from "../theme";

export interface MessageLogProps {
  messages: readonly LogEntry[];

  width?: number;

  height?: number;

  maxLines?: number;
}

const DEFAULT_MAX_LINES = 8;

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
    <Box
      borderStyle="single"
      borderColor={theme.border}
      flexDirection="column"
      paddingX={1}
      {...boxProps}
    >
      {visible.length === 0 ? (
        <Text color={theme.textFaint}>(no messages yet)</Text>
      ) : (
        visible.map((message, index) => (
          <Text
            bold={
              start + index === messages.length - 1 && message.kind === "damage"
            }
            color={
              message.element
                ? theme.element[message.element]
                : message.rarity
                  ? theme.rarity[message.rarity]
                  : theme.msg[message.kind]
            }
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only tail, position is identity
            key={start + index}
          >
            {message.text}
          </Text>
        ))
      )}
    </Box>
  );
}
