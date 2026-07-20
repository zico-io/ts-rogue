import { useStdout } from "ink";
import { useEffect, useState } from "react";

/** Fallback terminal size when stdout is missing or reports a non-TTY size. */
export const DEFAULT_COLUMNS = 80;
export const DEFAULT_ROWS = 24;

export interface TerminalSize {
  columns: number;
  rows: number;
}

function sizeOf(
  stdout: { readonly columns?: number; readonly rows?: number } | undefined,
): TerminalSize {
  const columns =
    stdout?.columns && stdout.columns > 0 ? stdout.columns : DEFAULT_COLUMNS;
  const rows = stdout?.rows && stdout.rows > 0 ? stdout.rows : DEFAULT_ROWS;
  return { columns, rows };
}

/**
 * Reactive terminal size. Wraps Ink's `useStdout` and subscribes to the
 * stream's `resize` event (fired on SIGWINCH) so components re-render when the
 * terminal is resized or toggled fullscreen. Falls back to safe defaults when
 * stdout is absent or reports a zero size, so non-TTY/CI/test runs do not
 * break. Mirrors the subscribe-and-rerender style of `useGameState`.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => sizeOf(stdout));

  useEffect(() => {
    const update = (): void => setSize(sizeOf(stdout));
    update();
    if (!stdout) return;
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  return size;
}
