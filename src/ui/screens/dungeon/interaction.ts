import type { StepDirection, TurnDirection } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

export interface DungeonUiState {
  confirmingExit?: boolean;
}

export type DungeonUiEffect =
  | { type: "step"; direction: StepDirection }
  | { type: "turn"; direction: TurnDirection }
  | { type: "openChest" }
  | { type: "descend" }
  | { type: "exit" };

export interface DungeonUiResult {
  state: DungeonUiState;
  effect?: DungeonUiEffect;
}

const dungeonKeymap: Keymap = {
  up: { kind: "stepForward" },
  down: { kind: "stepBack" },
  left: { kind: "turnLeft" },
  right: { kind: "turnRight" },
  k: { kind: "stepForward" },
  j: { kind: "stepBack" },
  h: { kind: "turnLeft" },
  l: { kind: "turnRight" },
  "char:w": { kind: "stepForward" },
  "char:s": { kind: "stepBack" },
  "char:a": { kind: "turnLeft" },
  "char:d": { kind: "turnRight" },
  "char:o": { kind: "openChest" },
  "char:>": { kind: "descend" },
  enter: { kind: "descend" },
  "char:<": { kind: "exitDungeon" },
};

const confirmExitKeymap: Keymap = {
  enter: { kind: "confirm" },
  "char:y": { kind: "confirm" },
  escape: { kind: "cancel" },
  "char:n": { kind: "cancel" },
};

export function resolveDungeonIntent(
  key: KeyName,
  confirmingExit: boolean,
): Intent | undefined {
  return confirmingExit ? confirmExitKeymap[key] : dungeonKeymap[key];
}

export function reduceDungeonUi(
  state: DungeonUiState,
  intent: Intent,
): DungeonUiResult {
  if (state.confirmingExit) {
    if (intent.kind === "confirm") {
      return { state: {}, effect: { type: "exit" } };
    }
    if (intent.kind === "cancel") {
      return { state: {} };
    }
    return { state };
  }

  switch (intent.kind) {
    case "stepForward":
      return { state, effect: { type: "step", direction: "forward" } };
    case "stepBack":
      return { state, effect: { type: "step", direction: "back" } };
    case "turnLeft":
      return { state, effect: { type: "turn", direction: "left" } };
    case "turnRight":
      return { state, effect: { type: "turn", direction: "right" } };
    case "openChest":
      return { state, effect: { type: "openChest" } };
    case "descend":
      return { state, effect: { type: "descend" } };
    case "exitDungeon":
      return { state: { confirmingExit: true } };
    default:
      return { state };
  }
}
