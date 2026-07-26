import { Box, Text } from "ink";
import type { Cell } from "./render";

export interface TileGridProps {
  rows: Cell[][];

  width?: number;
  height?: number;
}

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
