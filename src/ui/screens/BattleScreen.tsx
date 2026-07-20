import { Box, Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../engine/state/types";
import { MessageLog } from "../components/MessageLog";

export interface BattleScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

/**
 * Battle scene (PROJECT_PLAN Phase 3 stub). The real turn-based battle is
 * Phase 4 (ROG-10); for now a dungeon encounter flags itself on
 * `dungeonState.encounter` and the scene router lands here. Pressing `f`
 * dispatches `BattleFlee`, the stub resolution that clears the encounter and
 * returns to the dungeon so the playable slice keeps flowing.
 */
export function BattleScreen({ state, dispatch }: BattleScreenProps) {
  const encounter = state.dungeonState?.encounter ?? null;

  useInput((input) => {
    if (input === "f") dispatch({ type: "BattleFlee" });
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Battle</Text>
      {encounter ? (
        <Box flexDirection="column">
          <Text>
            {encounter.kind === "boss"
              ? "The dungeon guardian blocks your path!"
              : "An enemy appears!"}
          </Text>
          <Text dimColor>
            [Phase 4: turn-based battle] Press f to flee back to the dungeon.
          </Text>
        </Box>
      ) : (
        <Text dimColor>
          (placeholder battle scene - press 1-4 to switch scenes, q to quit)
        </Text>
      )}
      <MessageLog messages={state.log} />
    </Box>
  );
}
