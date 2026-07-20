import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { GameState } from "../../engine/state/types.js";
import { MessageLog } from "../components/MessageLog.js";

export interface SceneLayoutProps {
  title: string;
  hint: string;
  messages: GameState["messages"];
  children?: ReactNode;
}

/** Shared chrome for the placeholder scene screens: heading, hint text, and the message log. */
export function SceneLayout({
  title,
  hint,
  messages,
  children,
}: SceneLayoutProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{title}</Text>
      {children}
      <Text dimColor>{hint}</Text>
      <MessageLog messages={messages} />
    </Box>
  );
}
