import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import type { DungeonState } from "../../engine/world/types";
import { Screen, useScreenContent } from "../components/Screen";
import {
  type CameraPose,
  lerpPose,
  poseFromState,
  renderDungeonView,
  renderMinimap,
} from "./dungeon/render";

export interface DungeonScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

const HINT =
  "Up/W/k: forward | Down/s/j: back | Left/a/h or Right/d/l: turn | o: open chest | > or Enter: descend | <: exit dungeon | q: quit";

/** Fixed minimap box chrome: 17 cols + 2 padding + 2 border; 9 rows + 1 label + 2 border. */
const MINIMAP_BOX_WIDTH = 21;
const MINIMAP_BOX_HEIGHT = 12;
const MINIMAP_GAP = 2;

/** Step/turn transitions render this many tween frames over ~100ms. */
const ANIM_FRAMES = 3;
const ANIM_FRAME_MS = 33;

/**
 * The camera pose to render: the party's discrete pose, or a short tween
 * toward it after a step/turn. A new move mid-tween restarts the tween from
 * the previous discrete pose (snap-finish), so the view never lags the
 * engine state and input is never blocked. Teleports (descending stairs)
 * snap without animating. Engine state stays discrete; this is UI-only.
 */
function useCameraPose(ds: DungeonState): CameraPose {
  const target = poseFromState(ds);
  const settled = useRef(target);
  const [anim, setAnim] = useState<{
    from: CameraPose;
    to: CameraPose;
  } | null>(null);
  const [step, setStep] = useState(0);

  const { x: tx, y: ty, angle: tAngle } = target;
  useEffect(() => {
    const last = settled.current;
    if (last.x === tx && last.y === ty && last.angle === tAngle) return;
    const to = { x: tx, y: ty, angle: tAngle };
    settled.current = to;
    const teleported = Math.abs(tx - last.x) + Math.abs(ty - last.y) > 1.5;
    if (teleported) {
      setAnim(null);
      return;
    }
    setAnim({ from: last, to });
    setStep(1);
  }, [tx, ty, tAngle]);

  useEffect(() => {
    if (!anim) return;
    if (step >= ANIM_FRAMES) {
      setAnim(null);
      return;
    }
    const id = setTimeout(() => setStep((s) => s + 1), ANIM_FRAME_MS);
    return () => clearTimeout(id);
  }, [anim, step]);

  return anim ? lerpPose(anim.from, anim.to, step / ANIM_FRAMES) : target;
}

/**
 * First-person dungeon screen (PROJECT_PLAN Phase 3, ROG-9). Renders the
 * perspective-projected FP view (at its pane's native resolution) and a corner
 * minimap from the pure helpers in `dungeon/render`, and turns key presses
 * into the pure dungeon reducer events. Entering / descending / encounters are all handled
 * by the reducer; this component only reads `state.dungeonState` and
 * dispatches. The FP view reflows to the content region the frame provides.
 * Phase 6 (ROG-12) adds the `<` exit key (dispatches `ExitDungeon`) so the
 * dungeon is never a dead-end after clearing a floor or defeating the boss.
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
    } else if (input === "<") {
      dispatch({ type: "ExitDungeon" });
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
      <DungeonBody ds={ds} />
    </Screen>
  );
}

function DungeonBody({ ds }: { ds: DungeonState }) {
  const { width, height } = useScreenContent();
  const camera = useCameraPose(ds);

  // Content stacks the FP/minimap row above the facing line (with a gap row).
  const mainHeight = Math.max(1, height - 2);
  // Shrink the minimap box on short panes so it never outgrows the row; its
  // inner text clips rather than pushing the layout.
  const minimapBoxHeight = Math.min(MINIMAP_BOX_HEIGHT, mainHeight);

  const fpWidth = Math.max(3, width - MINIMAP_BOX_WIDTH - MINIMAP_GAP);
  // The FP box has a single-cell border, so render into the interior.
  const fpRows = renderDungeonView(
    ds,
    {
      width: Math.max(1, fpWidth - 2),
      height: Math.max(1, mainHeight - 2),
    },
    camera,
  );
  const minimapRows = renderMinimap(ds);

  const statusParts = [`Facing ${ds.facing}`];
  if (ds.reachedBoss) statusParts.push("boss room reached");
  if (ds.cleared) statusParts.push("dungeon cleared");

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
      <Text>{statusParts.join(" | ")}</Text>
    </Box>
  );
}
