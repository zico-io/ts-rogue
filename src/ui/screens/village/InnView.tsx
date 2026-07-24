import { Text, useInput } from "ink";
import { INN_COST_PER_MEMBER } from "../../../engine/state/store";
import type { GameEvent, GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { reduceInnUi, resolveInnIntent } from "./interaction";

export interface InnViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/** Inn sub-view: preview the rest cost and confirm an `InnHeal` dispatch. */
export function InnView({ state, dispatch, onBack }: InnViewProps) {
  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveInnIntent(keyName);
    if (!intent) return;

    const effect = reduceInnUi(intent);
    switch (effect?.type) {
      case "rest":
        dispatch({ type: "InnHeal" });
        break;
      case "back":
        onBack();
        break;
      default:
        break;
    }
  });

  const cost = state.party.length * INN_COST_PER_MEMBER;

  return (
    <Screen
      state={state}
      title="Inn"
      hint="Press Enter to rest, Esc to go back."
    >
      <Text>
        Resting fully restores the party's HP and MP for {cost} gold (
        {INN_COST_PER_MEMBER} per member).
      </Text>
    </Screen>
  );
}
