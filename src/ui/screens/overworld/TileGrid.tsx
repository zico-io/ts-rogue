import { Box, Text } from "ink";
import type { Cell } from "./render";

export interface TileGridProps {
  rows: Cell[][];
  /** Optional container bounds; clips any overflow so the grid never spills. */
  width?: number;
  height?: number;
}

/** Renders pre-built rows of {@link Cell}s as a monospace grid. Presentational only. */
export function TileGrid({ rows, width, height }: TileGridProps) {
  const boxProps = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height, overflow: "hidden" as const } : {}),
  };
  return (
    <Box flexDirection="column" {...boxProps}>
      {rows.map((row, y) => (
        <Box key={row[0]?.key ?? y}>
          {row.map((cell) => (
            <Text color={cell.color} key={cell.key}>
              {cell.char}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
