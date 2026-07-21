import { Box, Text } from "ink";

import { CLASSES } from "../../data/classes";

export interface TitleScreenProps {
  hasSave: boolean;
  /** Title flow phase: pick a class, then pick a mode (ROG-17 class choice). */
  titlePhase: "class" | "mode";
  /** Selected class index into `CLASSES` during the class phase. */
  classCursor: number;
  /** Selected mode index during the mode phase (0 = Normal, 1 = Permadeath). */
  modeCursor: number;
}

/**
 * Shown before a run starts. When a save exists, it prompts to continue. When
 * there is no save, it walks a two-step choice (Phase 6, ROG-12 mode plus
 * ROG-17 class): first a class iterated from the `CLASSES` table, then a mode
 * (Normal - revive at village on defeat, or Permadeath - one life, one run).
 * Input is handled by `app.tsx`; this is a pure display component.
 */
export function TitleScreen({
  hasSave,
  titlePhase,
  classCursor,
  modeCursor,
}: TitleScreenProps) {
  if (hasSave) {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Text bold>ts-rogue</Text>
        <Text dimColor>A terminal dungeon crawler.</Text>
        <Text>Press any key to continue, q to quit.</Text>
      </Box>
    );
  }

  if (titlePhase === "class") {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Text bold>ts-rogue</Text>
        <Text dimColor>A terminal dungeon crawler.</Text>
        <Text>Choose your class:</Text>
        {CLASSES.map((cls, index) => (
          <Text
            key={cls.id}
            color={index === classCursor ? "green" : undefined}
          >
            {index === classCursor ? "> " : "  "}
            {cls.name} - {cls.description}
          </Text>
        ))}
        <Text dimColor>Up/Down to choose, Enter to continue, q to quit.</Text>
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
      <Text dimColor>
        Up/Down to choose, Enter to start, Esc for class, q to quit.
      </Text>
    </Box>
  );
}
