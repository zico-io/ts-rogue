import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import type { DungeonState } from "../../engine/world/types";
import { Screen, useScreenContent } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { dungeonRamp, theme } from "../theme";
import {
  type DungeonUiState,
  reduceDungeonUi,
  resolveDungeonIntent,
} from "./dungeon/interaction";
import {
  type CameraPose,
  lerpPose,
  poseFromState,
  renderDungeonViewRuns,
  renderMinimap,
} from "./dungeon/render";

export interface DungeonScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

const HINT =
  "Up/W/k: forward | Down/s/j: back | Left/a/h or Right/d/l: turn | o: open chest | > or Enter: descend | <: evac confirm | q: quit";

const MINIMAP_BOX_WIDTH = 21;
const MINIMAP_BOX_HEIGHT = 12;
const MINIMAP_GAP = 2;

const ANIM_FRAMES = 3;
const ANIM_FRAME_MS = 33;

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

export function DungeonScreen({ state, dispatch }: DungeonScreenProps) {
  const [dungeonUi, setDungeonUi] = useState<DungeonUiState>({});

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveDungeonIntent(
      keyName,
      dungeonUi.confirmingExit ?? false,
    );
    if (!intent) return;

    const result = reduceDungeonUi(dungeonUi, intent);
    switch (result.effect?.type) {
      case "step":
        dispatch({ type: "StepDungeon", direction: result.effect.direction });
        break;
      case "turn":
        dispatch({ type: "TurnDungeon", direction: result.effect.direction });
        break;
      case "openChest":
        dispatch({ type: "OpenChest" });
        break;
      case "descend":
        dispatch({ type: "DescendStairs" });
        break;
      case "exit":
        dispatch({ type: "ExitDungeon" });
        break;
      default:
        break;
    }
    setDungeonUi(result.state);
  });

  const ds = state.dungeonState;
  if (!ds) {
    return (
      <Screen state={state} title="Dungeon">
        <Text color={theme.textMuted}>
          (no active dungeon - press 2 for the overworld)
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      state={state}
      title={`Dungeon - Floor ${ds.floor} (${ds.dungeonId})`}
      hint={HINT}
    >
      <DungeonBody confirmingExit={dungeonUi.confirmingExit ?? false} ds={ds} />
    </Screen>
  );
}

function DungeonBody({
  ds,
  confirmingExit,
}: {
  ds: DungeonState;
  confirmingExit: boolean;
}) {
  const { width, height } = useScreenContent();
  const camera = useCameraPose(ds);

  const mainHeight = Math.max(1, height - 2);

  const minimapBoxHeight = Math.min(MINIMAP_BOX_HEIGHT, mainHeight);
  const minimapBoxWidth = MINIMAP_BOX_WIDTH;

  const fpWidth = Math.max(3, width - minimapBoxWidth - MINIMAP_GAP);

  const fpRows = renderDungeonViewRuns(
    ds,
    {
      width: Math.max(1, fpWidth - 2),
      height: Math.max(1, mainHeight - 2),
    },
    camera,
  );
  const minimapRows = renderMinimap(ds);

  const ramp = dungeonRamp(ds.theme);

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
          borderColor={theme.border}
          flexDirection="column"
          width={fpWidth}
          height={mainHeight}
          overflow="hidden"
        >
          {fpRows.map((runs, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size viewport, row position is identity
            <Text key={rowIndex}>
              {runs.map((run, runIndex) => (
                <Text
                  color={ramp[Math.max(0, run.band - 1)]}
                  // biome-ignore lint/suspicious/noArrayIndexKey: runs re-derive every render
                  key={runIndex}
                >
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        <Box
          borderStyle="single"
          borderColor={theme.border}
          flexDirection="column"
          paddingX={1}
          width={minimapBoxWidth}
          height={minimapBoxHeight}
          overflow="hidden"
        >
          <Text color={theme.textMuted}>Map</Text>
          <Text color={ramp[1]}>{minimapRows.join("\n")}</Text>
        </Box>
      </Box>
      {confirmingExit ? (
        <Text color={theme.accent}>Evac to the entrance? [y/n]</Text>
      ) : (
        <Text>{statusParts.join(" | ")}</Text>
      )}
    </Box>
  );
}
