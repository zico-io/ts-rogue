import { Box, Text } from "ink";

export interface TitleScreenProps {
  hasSave: boolean;
  /** Selected mode index when starting a fresh run (0 = Normal, 1 = Permadeath). */
  modeCursor: number;
}

/**
 * Shown before a run starts. When a save exists, it prompts to continue. When
 * there is no save (Phase 6, ROG-12), it presents a minimal mode choice:
 * Normal (revive at village on defeat) or Permadeath (one life, one run).
 * Input is handled by `app.tsx`; this is a pure display component.
 */
export function TitleScreen({ hasSave, modeCursor }: TitleScreenProps) {
  if (hasSave) {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Text bold>ts-rogue</Text>
        <Text dimColor>A terminal dungeon crawler.</Text>
        <Text>Press any key to continue, q to quit.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Text bold>ts-rogue</Text>
      <Text dimColor>A terminal dungeon crawler.</Text>
      <Text>Choose your mode:</Text>
      <Text color={modeCursor === 0 ? "green" : undefined}>
        {modeCursor === 0 ? "> " : "  "}Normal - revive at the village on defeat
      </Text>
      <Text color={modeCursor === 1 ? "green" : undefined}>
        {modeCursor === 1 ? "> " : "  "}Permadeath - one life, one run
      </Text>
      <Text dimColor>Up/Down to choose, Enter to start, q to quit.</Text>
    </Box>
  );
}
