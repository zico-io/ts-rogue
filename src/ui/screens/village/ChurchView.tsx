import { Box, Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../../engine/state/types.js";
import { saveGame } from "../../../persistence/save.js";
import { MessageLog } from "../../components/MessageLog.js";

export interface ChurchViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/**
 * Church sub-view: writes the current `GameState` to the sqlite save slot
 * (PROJECT_PLAN §8 - save at the Church, load on boot). Save I/O lives here
 * in the UI layer, not the engine; a successful save logs through the normal
 * `Log` event so it shows up in the shared `MessageLog` like any other action.
 */
export function ChurchView({ state, dispatch, onBack }: ChurchViewProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      try {
        saveGame(state);
        dispatch({ type: "Log", message: "Game saved" });
      } catch {
        dispatch({ type: "Log", message: "Failed to save game" });
      }
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Church</Text>
      <Text>Save your progress here. Saves load automatically on boot.</Text>
      <Text dimColor>Press Enter to save, Esc to go back.</Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}
