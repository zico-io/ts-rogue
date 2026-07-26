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

const MINIMAP_BOX_OVERHEAD_ROWS = 3;
const MINIMAP_BOX_OVERHEAD_COLS = 4;
const MINIMAP_GAP = 2;

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
