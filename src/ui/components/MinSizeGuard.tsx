import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";
import { type TerminalSize, useTerminalSize } from "../hooks/useTerminalSize";
import { theme } from "../theme";

/**
 * Readable minimum terminal size. Chosen from the densest scene's real needs:
 * the dungeon first-person view (39 cols) plus its bordered 17-col minimap and
 * gap, and the battle scene's stat line plus up to three enemy art columns.
 * At 24 rows every scene fits with a usable message log; below this the layout
 * would clip, so the guard short-circuits to a fallback instead.
 */
export const MIN_COLUMNS = 64;
export const MIN_ROWS = 24;

export interface TerminalLayout extends TerminalSize {
  minWidth: number;
  minHeight: number;
  tooSmall: boolean;
}

const TerminalLayoutContext = createContext<TerminalLayout | undefined>(
  undefined,
);

/** Provides reactive terminal dimensions and the too-small flag to the tree. */
export function TerminalLayoutProvider({ children }: { children: ReactNode }) {
  const { columns, rows } = useTerminalSize();
  const tooSmall = columns < MIN_COLUMNS || rows < MIN_ROWS;
  const layout: TerminalLayout = {
    columns,
    rows,
    minWidth: MIN_COLUMNS,
    minHeight: MIN_ROWS,
    tooSmall,
  };
  return (
    <TerminalLayoutContext.Provider value={layout}>
      {children}
    </TerminalLayoutContext.Provider>
  );
}

/**
 * Read the shared terminal layout. Scenes call this instead of `useStdout` so
 * there is a single resize subscription driving every reflow.
 */
export function useTerminalLayout(): TerminalLayout {
  const layout = useContext(TerminalLayoutContext);
  if (!layout) {
    throw new Error(
      "useTerminalLayout must be used within a TerminalLayoutProvider",
    );
  }
  return layout;
}

/**
 * Upper bound on the number of terminal rows `text` occupies when wrapped at
 * `columns`. Ink wraps long words, so character-level wrapping is the worst
 * case; this never under-counts and never returns less than 1.
 */
export function lineCount(text: string, columns: number): number {
  if (columns <= 0) return 1;
  return Math.max(1, Math.ceil(text.length / columns));
}

export interface MinSizeGuardProps {
  columns: number;
  rows: number;
  minWidth?: number;
  minHeight?: number;
}

/**
 * Centered fallback shown when the terminal is below the readable minimum.
 * Short enough to stay on screen in a small terminal without clipping.
 */
export function MinSizeGuard({
  columns,
  rows,
  minWidth = MIN_COLUMNS,
  minHeight = MIN_ROWS,
}: MinSizeGuardProps) {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height={rows}
      width={columns}
    >
      <Text bold color={theme.warn}>
        Terminal too small - resize to at least {minWidth} columns by{" "}
        {minHeight} rows
      </Text>
      <Text color={theme.textMuted}>
        Current: {columns} columns by {rows} rows
      </Text>
    </Box>
  );
}
