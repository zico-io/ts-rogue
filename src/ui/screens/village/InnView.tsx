import { Box, Text, useInput } from "ink";
import { INN_COST_PER_MEMBER } from "../../../engine/state/store.js";
import type { GameEvent, GameState } from "../../../engine/state/types.js";
import { MessageLog } from "../../components/MessageLog.js";

export interface InnViewProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onBack: () => void;
}

/** Inn sub-view: preview the rest cost and confirm an `InnHeal` dispatch. */
export function InnView({ state, dispatch, onBack }: InnViewProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) dispatch({ type: "InnHeal" });
  });

  const cost = state.party.length * INN_COST_PER_MEMBER;

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Inn</Text>
      <Text>
        Resting fully restores the party's HP and MP for {cost} gold (
        {INN_COST_PER_MEMBER} per member).
      </Text>
      <Text>Gold: {state.gold}</Text>
      <Text dimColor>Press Enter to rest, Esc to go back.</Text>
      <MessageLog messages={state.log} />
    </Box>
  );
}
