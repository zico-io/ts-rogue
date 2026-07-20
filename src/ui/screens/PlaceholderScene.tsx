import { Box, Text } from "ink";
import type { GameState } from "../../engine/state/types.js";
import { MessageLog } from "../components/MessageLog.js";

export interface PlaceholderSceneProps {
  label: string;
  state: GameState;
}

/**
 * Shared body for the Phase 0 placeholder scenes. Each real scene screen
 * (village/overworld/dungeon/battle) wraps this until it grows its own UI.
 */
export function PlaceholderScene({ label, state }: PlaceholderSceneProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{label}</Text>
      <Text dimColor>
        (placeholder scene - press 1-4 to switch scenes, q to quit)
      </Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}
