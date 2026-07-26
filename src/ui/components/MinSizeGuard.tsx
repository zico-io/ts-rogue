import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";
import { type TerminalSize, useTerminalSize } from "../hooks/useTerminalSize";
import { theme } from "../theme";

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

export function useTerminalLayout(): TerminalLayout {
  const layout = useContext(TerminalLayoutContext);
  if (!layout) {
    throw new Error(
      "useTerminalLayout must be used within a TerminalLayoutProvider",
    );
  }
  return layout;
}

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
