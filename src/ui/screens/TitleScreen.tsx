import { Box, Text } from "ink";
import type { GameState } from "../../engine/state/types.js";
import { MessageLog } from "../components/MessageLog.js";

export interface TitleScreenProps {
  seed: number;
  messages: GameState["messages"];
}

/** First screen shown on boot. Any scene key or Enter moves into the scene router. */
export function TitleScreen({ seed, messages }: TitleScreenProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>ts-rogue</Text>
      <Text dimColor>Seed: {seed}</Text>
      <Text dimColor>
        Press Enter or 1-4 to start (1=Village 2=Overworld 3=Dungeon 4=Battle),
        q to quit.
      </Text>
      <MessageLog messages={messages} />
    </Box>
  );
}
