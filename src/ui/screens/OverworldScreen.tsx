import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import {
  ENCOUNTER_THRESHOLD,
  generateOverworldMap,
} from "../../engine/world/overworld";
import { Screen, useScreenContent } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  type OverworldUiState,
  reduceOverworldUi,
  resolveOverworldIntent,
} from "./overworld/interaction";
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

const HINT =
  "Arrow keys or h/j/k/l to move; walk onto H to return to the village or D to enter a dungeon; Esc returns to the village directly.";

/** Minimap box chrome: 1 row label + 2 rows border + 2 cols padding + 2 cols border. */
const MINIMAP_BOX_OVERHEAD_ROWS = 3;
const MINIMAP_BOX_OVERHEAD_COLS = 4;
const MINIMAP_GAP = 2;

/**
 * Overworld traversal (PROJECT_PLAN Phase 2, ROG-8). The map is a pure
 * function of `state.seed` (see `engine/world/overworld.ts`), recomputed
 * here rather than stored on state. Arrow keys / hjkl move the player;
 * stepping onto the village or a dungeon entrance is handled entirely by
 * the reducer (`MoveOverworld`) and shows up as a scene change. The camera
 * viewport and minimap scale to the content region the frame provides.
 */
export function OverworldScreen({ state, dispatch }: OverworldScreenProps) {
  const [overworldUi, setOverworldUi] = useState<OverworldUiState>({});

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveOverworldIntent(keyName);
    if (!intent) return;

    const result = reduceOverworldUi(overworldUi, intent);
    switch (result.effect?.type) {
      case "move":
        dispatch({
          type: "MoveOverworld",
          dx: result.effect.dx,
          dy: result.effect.dy,
        });
        break;
      case "leaveToVillage":
        dispatch({ type: "ChangeScene", scene: "village" });
        break;
      default:
        break;
    }
    setOverworldUi(result.state);
  });

  return (
    <Screen state={state} title="Overworld" hint={HINT}>
      <OverworldBody state={state} />
    </Screen>
  );
}

function OverworldBody({ state }: { state: GameState }) {
  const { width, height } = useScreenContent();
  const map = useMemo(() => generateOverworldMap(state.seed), [state.seed]);
  const player = state.worldState.player;

  // Content stacks the map row above the danger line (with a gap row).
  const mainHeight = Math.min(Math.max(height - 2, 1), map.height);

  const minimapRows = buildMinimapRows(map, player, {
    maxWidth: 18,
    maxHeight: Math.max(1, mainHeight - MINIMAP_BOX_OVERHEAD_ROWS),
  });
  const minimapCols = minimapRows[0]?.length ?? 0;
  const minimapBoxWidth = minimapCols + MINIMAP_BOX_OVERHEAD_COLS;
  const minimapBoxHeight = minimapRows.length + MINIMAP_BOX_OVERHEAD_ROWS;

  const viewportPaneWidth = Math.max(1, width - minimapBoxWidth - MINIMAP_GAP);
  const viewportRows = buildViewportRows(map, player, {
    width: viewportPaneWidth,
    height: mainHeight,
  });
  const viewportCols = viewportRows[0]?.length ?? 0;

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        flexDirection="row"
        gap={MINIMAP_GAP}
        justifyContent="center"
        height={mainHeight}
      >
        <TileGrid
          rows={viewportRows}
          width={viewportCols}
          height={mainHeight}
        />
        <Box
          borderStyle="single"
          borderColor={theme.border}
          flexDirection="column"
          paddingX={1}
          width={minimapBoxWidth}
          height={minimapBoxHeight}
        >
          <Text color={theme.textMuted}>Map</Text>
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
  );
}
