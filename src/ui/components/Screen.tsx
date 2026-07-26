import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";
import type { GameState } from "../../engine/state/types";
import { buildChrome } from "../scene/chrome";
import type { AnyNode } from "../scene/tree";
import { bar, theme } from "../theme";
import { MessageLog } from "./MessageLog";
import { useTerminalLayout } from "./MinSizeGuard";

export interface ScreenProps {
  state: GameState;
  title: string;
  hint?: string;

  showLog?: boolean;
  children: ReactNode;
}

export interface ScreenContent {
  width: number;
  height: number;
}

const ScreenContentContext = createContext<ScreenContent | undefined>(
  undefined,
);

export function useScreenContent(): ScreenContent {
  const content = useContext(ScreenContentContext);
  if (!content) {
    throw new Error("useScreenContent must be used within a Screen");
  }
  return content;
}

export function Screen({
  state,
  title,
  hint,
  showLog = true,
  children,
}: ScreenProps) {
  const { columns, rows } = useTerminalLayout();
  const { panel, content } = buildChrome(
    state,
    { width: columns, height: rows },
    { title, hint, showLog },
  );

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Text color={theme.title}>
        {titledTop(panel.title ?? title, columns)}
      </Text>
      <Box
        borderStyle="single"
        borderTop={false}
        borderColor={theme.border}
        flexDirection="column"
        flexGrow={1}
        paddingX={1}
      >
        <Box flexDirection="column" height={content.height} overflow="hidden">
          <ScreenContentContext.Provider value={content}>
            {children}
          </ScreenContentContext.Provider>
        </Box>
        {panel.children.map((node) => renderNode(node, content.width))}
      </Box>
    </Box>
  );
}

function renderNode(node: AnyNode, width: number): ReactNode {
  switch (node.kind) {
    case "panel":
      return (
        <Box key={node.key} flexDirection="column">
          {node.children.map((child) => renderNode(child, width))}
        </Box>
      );
    case "stack":
      return (
        <Box
          key={node.key}
          flexDirection={node.direction === "row" ? "row" : "column"}
          gap={node.gap}
        >
          {node.children.map((child) => renderNode(child, width))}
        </Box>
      );
    case "text":
      return (
        <Text key={node.key} color={node.color} bold={node.bold}>
          {node.text}
        </Text>
      );
    case "meter":
      return (
        <Text key={node.key} color={node.color}>
          {bar(node.value, node.max, node.width)}
        </Text>
      );
    case "log":
      return (
        <MessageLog
          key={node.key}
          messages={node.messages}
          width={width}
          height={node.maxLines + 2}
        />
      );
    default:
      return null;
  }
}

function titledTop(title: string, width: number): string {
  const w = Math.max(2, width);
  const label = ` ${title} `;
  const head = `┌─${label}`;
  if (head.length + 1 >= w) return `┌${"─".repeat(w - 2)}┐`;
  return `${head}${"─".repeat(w - head.length - 1)}┐`;
}
