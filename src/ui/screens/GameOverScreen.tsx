import { Box, Text } from "ink";
import { theme } from "../theme";
import { BANNER } from "./gameOverBanner";

// Re-exported so anything importing `BANNER` from here (none today, but
// matches `TitleScreen.tsx`'s pattern) keeps working; the canonical home
// for this pure data is `./gameOverBanner`.
export { BANNER };

/**
 * Game-over screen (Phase 6, ROG-12). Shown when the party perishes in
 * permadeath mode. Input (start a new run / quit) is handled by `app.tsx`;
 * this is a pure display component.
 */
export function GameOverScreen() {
  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Box flexDirection="column">
        {BANNER.map((line, index) => (
          <Text bold color={theme.gameOverGradient[index]} key={line}>
            {line}
          </Text>
        ))}
      </Box>
      <Text>The party has perished. The run is over.</Text>
      <Text color={theme.textMuted}>
        Press Enter to start a new run, q to quit.
      </Text>
    </Box>
  );
}
