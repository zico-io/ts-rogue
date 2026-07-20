import { Box, Text } from "ink";

export interface TitleScreenProps {
  hasSave: boolean;
}

/** Shown before a run starts. Reflects whether a save was found on boot. */
export function TitleScreen({ hasSave }: TitleScreenProps) {
  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Text bold>ts-rogue</Text>
      <Text dimColor>A terminal dungeon crawler.</Text>
      <Text>
        {hasSave
          ? "Press any key to continue, q to quit."
          : "Press any key to start, q to quit."}
      </Text>
    </Box>
  );
}
