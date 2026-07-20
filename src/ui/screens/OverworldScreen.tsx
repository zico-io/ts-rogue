import { Box, Text, useInput } from "ink";
import { useMemo } from "react";
import type { GameEvent, GameState, MoveDelta } from "../../engine/state/types";
import {
  ENCOUNTER_THRESHOLD,
  generateOverworldMap,
} from "../../engine/world/overworld";
import { Screen } from "../components/Screen";
import {
  buildMinimapRows,
  buildViewportRows,
  formatEncounterMeter,
} from "./overworld/render";
import { TileGrid } from "./overworld/TileGrid";

export interface OverworldScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

interface Direction {
  dx: MoveDelta;
  dy: MoveDelta;
}

const KEY_MOVES: Record<string, Direction> = {
  h: { dx: -1, dy: 0 },
  j: { dx: 0, dy: 1 },
  k: { dx: 0, dy: -1 },
  l: { dx: 1, dy: 0 },
};

/** Arrow keys take priority over hjkl; both move the player one tile. */
function directionFor(
  input: string,
  key: {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
  },
): Direction | undefined {
  if (key.upArrow) return { dx: 0, dy: -1 };
  if (key.downArrow) return { dx: 0, dy: 1 };
  if (key.leftArrow) return { dx: -1, dy: 0 };
  if (key.rightArrow) return { dx: 1, dy: 0 };
  return KEY_MOVES[input];
}

/**
 * Overworld traversal (PROJECT_PLAN Phase 2, ROG-8). The map is a pure
 * function of `state.seed` (see `engine/world/overworld.ts`), recomputed
 * here rather than stored on state. Arrow keys / hjkl move the player;
 * stepping onto the village or a dungeon entrance is handled entirely by
 * the reducer (`MoveOverworld`) and shows up as a scene change.
 */
export function OverworldScreen({ state, dispatch }: OverworldScreenProps) {
  const map = useMemo(() => generateOverworldMap(state.seed), [state.seed]);

  useInput((input, key) => {
    if (key.escape) {
      dispatch({ type: "ChangeScene", scene: "village" });
      return;
    }
    const direction = directionFor(input, key);
    if (direction) {
      dispatch({ type: "MoveOverworld", dx: direction.dx, dy: direction.dy });
    }
  });

  const viewportRows = buildViewportRows(map, state.worldState.player);
  const minimapRows = buildMinimapRows(map, state.worldState.player);

  return (
    <Screen
      state={state}
      title="Overworld"
      hint="Arrow keys or h/j/k/l to move; walk onto H to return to the village or D to enter a dungeon; Esc returns to the village directly."
    >
      <Box flexDirection="column" gap={1}>
        <Box gap={2} justifyContent="center">
          <TileGrid rows={viewportRows} />
          <Box borderStyle="single" flexDirection="column" paddingX={1}>
            <Text dimColor>Map</Text>
            <TileGrid rows={minimapRows} />
          </Box>
        </Box>
        <Text>
          Danger:{" "}
          {formatEncounterMeter(
            state.worldState.encounterMeter,
            ENCOUNTER_THRESHOLD,
          )}
        </Text>
      </Box>
    </Screen>
  );
}
