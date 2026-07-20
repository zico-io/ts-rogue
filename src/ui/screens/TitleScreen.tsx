import { Box, Text } from "ink";

/** Shown before a run starts. */
export function TitleScreen() {
  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Text bold>ts-rogue</Text>
      <Text dimColor>A terminal dungeon crawler.</Text>
      <Text>Press any key to start, q to quit.</Text>
    </Box>
  );
}
