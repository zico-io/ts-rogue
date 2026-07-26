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
