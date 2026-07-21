import { Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../../engine/state/types";
import type { FailureBoundary } from "../../../lib/incidents";
import { saveGame } from "../../../persistence/save";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { reduceChurchUi, resolveChurchIntent } from "./interaction";

export interface ChurchViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
  failures: FailureBoundary;
}

/**
 * Church sub-view: writes the current `GameState` to the sqlite save slot
 * (PROJECT_PLAN §8 - save at the Church, load on boot). Save I/O lives here
 * in the UI layer, not the engine, and stays in this effect handler rather
 * than the pure `reduceChurchUi` (ROG-45); a successful save logs through
 * the normal `Log` event so it shows up in the shared `MessageLog` like any
 * other action.
 */
export function ChurchView({
  state,
  dispatch,
  onBack,
  failures,
}: ChurchViewProps) {
  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveChurchIntent(keyName);
    if (!intent) return;

    const effect = reduceChurchUi(intent);
    switch (effect?.type) {
      case "save": {
        const saved = failures.run("save", false, () => saveGame(state));
        dispatch({
          type: "Log",
          message: saved.ok ? "Game saved" : "Failed to save game",
        });
        break;
      }
      case "back":
        onBack();
        break;
      default:
        break;
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
