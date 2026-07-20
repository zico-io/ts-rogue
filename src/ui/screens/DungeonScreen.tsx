import { Box, Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen } from "../components/Screen";
import { renderDungeonView, renderMinimap } from "./dungeon/render";

export interface DungeonScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

/**
 * First-person dungeon screen (PROJECT_PLAN Phase 3, ROG-9). Renders the
 * depth-slice FP view and a corner minimap from the pure helpers in
 * `dungeon/render`, and turns key presses into the pure dungeon reducer
 * events. Entering / descending / encounters are all handled by the reducer;
 * this component only reads `state.dungeonState` and dispatches.
 */
export function DungeonScreen({ state, dispatch }: DungeonScreenProps) {
  useInput((input, key) => {
    if (key.upArrow || input === "w" || input === "k") {
      dispatch({ type: "StepDungeon", direction: "forward" });
    } else if (key.downArrow || input === "s" || input === "j") {
      dispatch({ type: "StepDungeon", direction: "back" });
    } else if (key.leftArrow || input === "a" || input === "h") {
      dispatch({ type: "TurnDungeon", direction: "left" });
    } else if (key.rightArrow || input === "d" || input === "l") {
      dispatch({ type: "TurnDungeon", direction: "right" });
    } else if (input === "o") {
      dispatch({ type: "OpenChest" });
    } else if (input === ">" || key.return) {
      dispatch({ type: "DescendStairs" });
    }
  });

  const ds = state.dungeonState;
  if (!ds) {
    return (
      <Screen state={state} title="Dungeon">
        <Text dimColor>(no active dungeon - press 2 for the overworld)</Text>
      </Screen>
    );
  }

  const fpRows = renderDungeonView(ds);
  const minimapRows = renderMinimap(ds);

  return (
    <Screen
      state={state}
      title={`Dungeon - Floor ${ds.floor} (${ds.dungeonId})`}
      hint="Up/W/k: forward | Down/s/j: back | Left/a/h or Right/d/l: turn | o: open chest | > or Enter: descend | q: quit"
    >
      <Box flexDirection="column" gap={1}>
        <Box gap={2} justifyContent="center">
          <Box flexDirection="column">
            <Text>{fpRows.join("\n")}</Text>
          </Box>
          <Box borderStyle="single" flexDirection="column" paddingX={1}>
            <Text dimColor>Map</Text>
            <Text dimColor>{minimapRows.join("\n")}</Text>
          </Box>
        </Box>
        <Text>
          Facing {ds.facing}
          {ds.reachedBoss ? " | boss room reached" : ""}
        </Text>
      </Box>
    </Screen>
  );
}
