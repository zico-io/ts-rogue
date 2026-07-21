import { Box, Text } from "ink";
import { tileText } from "../../tiles/kitty";
import type { Cell } from "./render";

export interface TileGridProps {
  rows: Cell[][];
  /** Optional container bounds; clips any overflow so the grid never spills. */
  width?: number;
  height?: number;
  /** Render cells as kitty-graphics tiles (2 columns per cell) when set. */
  tiles?: boolean;
}

/** Renders pre-built rows of {@link Cell}s as a monospace grid. Presentational only. */
export function TileGrid({ rows, width, height, tiles }: TileGridProps) {
  const boxProps = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height, overflow: "hidden" as const } : {}),
  };
  return (
    <Box flexDirection="column" {...boxProps}>
      {rows.map((row, y) => (
        <Box key={row[0]?.key ?? y}>
          {row.map((cell) =>
            tiles && cell.tile ? (
              <Text key={cell.key}>{tileText(cell.tile)}</Text>
            ) : (
              <Text color={cell.color} key={cell.key}>
                {cell.char}
              </Text>
            ),
          )}
        </Box>
      ))}
    </Box>
  );
}
