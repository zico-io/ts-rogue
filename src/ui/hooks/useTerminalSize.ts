import { useStdout } from "ink";
import { useEffect, useState } from "react";

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
