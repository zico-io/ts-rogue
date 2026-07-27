import { Box, Text } from "ink";
import { theme } from "../theme";
import { BANNER } from "./gameOverBanner";

export { BANNER };

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
