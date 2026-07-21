import { Box, Text } from "ink";

/**
 * Game-over screen (Phase 6, ROG-12). Shown when the party perishes in
 * permadeath mode. Input (start a new run / quit) is handled by `app.tsx`;
 * this is a pure display component.
 */
export function GameOverScreen() {
  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Text bold color="red">
        Game Over
      </Text>
      <Text>The party has perished. The run is over.</Text>
      <Text dimColor>Press Enter to start a new run, q to quit.</Text>
    </Box>
  );
}
