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
  /** Show the message log in the footer. Off for scenes that place it elsewhere (Battle). */
  showLog?: boolean;
  children: ReactNode;
}

/** Drawable dimensions of the scene content region, inside the frame chrome. */
export interface ScreenContent {
  width: number;
  height: number;
}

const ScreenContentContext = createContext<ScreenContent | undefined>(
  undefined,
);

/**
 * Read the drawable size of the current scene's content region (inside the
 * panel border, above the footer). Responsive scenes size their viewports and
 * render helpers from this instead of measuring the raw terminal, so the frame
 * chrome is accounted for in exactly one place.
 */
export function useScreenContent(): ScreenContent {
  const content = useContext(ScreenContentContext);
  if (!content) {
    throw new Error("useScreenContent must be used within a Screen");
  }
  return content;
}

/**
 * Shared scene frame: a full bordered panel that fills the pane, with the scene
 * title in the top border edge, the scene's content in a fixed middle region,
 * and a persistent footer (party vitals, an optional controls hint, and the
 * message log). Every gameplay/village screen renders through this so status
 * placement, height fill, and chrome are identical scene to scene. The content
 * region has a deterministic size (published through `useScreenContent`) so it
 * only reflows when the pane resizes, never when the footer or a child changes.
 *
 * This is the Ink interpreter (ROG-47) for the renderer-agnostic chrome tree
 * `buildChrome` (`src/ui/scene/chrome.ts`) produces from `state` and the
 * available size - 1 unit = 1 terminal cell here. The Pixi interpreter
 * (`src/web/render/sceneView.ts`) walks the exact same tree, so the chrome's
 * layout is defined once and only drawn twice.
 */
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

/**
 * Walks one chrome node and its descendants into Ink primitives. Handles
 * exactly the node kinds `buildChrome` produces (panel/stack/text/meter/log).
 * `panel`/`stack` are containers and never draw anything themselves; `meter`
 * keeps the terminal's glyph-bar rendering (`bar()`) rather than a graphical
 * bar, per ROG-47's split - the Pixi interpreter draws real filled-rect
 * meters instead.
 */
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
      // grid/sprite/menu: not produced by buildChrome; scene content renders
      // through `children`, not through this tree.
      return null;
  }
}

/**
 * Build the panel's titled top edge to span `width`. The manual line pairs with
 * the body box's `borderTop={false}` so the corners line up seamlessly.
 * ponytail: string math instead of a titled-border lib; Ink has none. Truncates
 * on panes too narrow for the title.
 */
function titledTop(title: string, width: number): string {
  const w = Math.max(2, width);
  const label = ` ${title} `;
  const head = `┌─${label}`; // ┌─ Title
  if (head.length + 1 >= w) return `┌${"─".repeat(w - 2)}┐`;
  return `${head}${"─".repeat(w - head.length - 1)}┐`;
}
