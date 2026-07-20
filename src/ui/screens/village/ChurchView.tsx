import { Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { saveGame } from "../../../persistence/save";
import { Screen } from "../../components/Screen";

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
    <Screen
      state={state}
      title="Church"
      hint="Press Enter to save, Esc to go back."
    >
      <Text>Save your progress here. Saves load automatically on boot.</Text>
    </Screen>
  );
}
