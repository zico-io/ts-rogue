import { Box, Text } from "ink";
import type { Cell } from "./render";

/** Renders pre-built rows of {@link Cell}s as a monospace grid. Presentational only. */
export function TileGrid({ rows }: { rows: Cell[][] }) {
  return (
    <Box flexDirection="column">
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
