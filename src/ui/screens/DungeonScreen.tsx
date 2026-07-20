import { Box, Text, useInput } from "ink";
import type { GameEvent, GameState } from "../../engine/state/types";
import { Screen, useScreenContent } from "../components/Screen";
import { renderDungeonView, renderMinimap } from "./dungeon/render";

export interface DungeonScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

const HINT =
  "Up/W/k: forward | Down/s/j: back | Left/a/h or Right/d/l: turn | o: open chest | > or Enter: descend | q: quit";

/** Fixed minimap box chrome: 17 cols + 2 padding + 2 border; 9 rows + 1 label + 2 border. */
const MINIMAP_BOX_WIDTH = 21;
const MINIMAP_BOX_HEIGHT = 12;
const MINIMAP_GAP = 2;

/**
 * First-person dungeon screen (PROJECT_PLAN Phase 3, ROG-9). Renders the
 * depth-slice FP view (scaled/centered to its pane) and a corner minimap from
 * the pure helpers in `dungeon/render`, and turns key presses into the pure
 * dungeon reducer events. Entering / descending / encounters are all handled
 * by the reducer; this component only reads `state.dungeonState` and
 * dispatches. The FP view reflows to the content region the frame provides.
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

  return (
    <Screen
      state={state}
      title={`Dungeon - Floor ${ds.floor} (${ds.dungeonId})`}
      hint={HINT}
    >
      <DungeonBody state={state} />
    </Screen>
  );
}

function DungeonBody({ state }: { state: GameState }) {
  const { width, height } = useScreenContent();
  const ds = state.dungeonState;
  if (!ds) return null;

  // Content stacks the FP/minimap row above the facing line (with a gap row).
  const mainHeight = Math.max(1, height - 2);
  // Shrink the minimap box on short panes so it never outgrows the row; its
  // inner text clips rather than pushing the layout.
  const minimapBoxHeight = Math.min(MINIMAP_BOX_HEIGHT, mainHeight);

  const fpWidth = Math.max(3, width - MINIMAP_BOX_WIDTH - MINIMAP_GAP);
  // The FP box has a single-cell border, so render into the interior.
  const fpRows = renderDungeonView(ds, {
    width: Math.max(1, fpWidth - 2),
    height: Math.max(1, mainHeight - 2),
  });
  const minimapRows = renderMinimap(ds);

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        flexDirection="row"
        gap={MINIMAP_GAP}
        justifyContent="center"
        height={mainHeight}
      >
        <Box
          borderStyle="single"
          width={fpWidth}
          height={mainHeight}
          overflow="hidden"
        >
          <Text color="magenta">{fpRows.join("\n")}</Text>
        </Box>
        <Box
          borderStyle="single"
          flexDirection="column"
          paddingX={1}
          width={MINIMAP_BOX_WIDTH}
          height={minimapBoxHeight}
          overflow="hidden"
        >
          <Text dimColor>Map</Text>
          <Text dimColor>{minimapRows.join("\n")}</Text>
        </Box>
      </Box>
      <Text>
        Facing {ds.facing}
        {ds.reachedBoss ? " | boss room reached" : ""}
      </Text>
    </Box>
  );
}
