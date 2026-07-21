/**
 * Dungeon input handling (ROG-45; extracted from `DungeonScreen.tsx`'s
 * inline `useInput` closure). Like the overworld, the dungeon has no local
 * UI state - every key press dispatches straight through to the engine -
 * so `DungeonUiState` is a unit type and `reduceDungeonUi` only ever
 * produces an effect.
 */

import type { StepDirection, TurnDirection } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

/** No local UI state; kept as a record so `reduceDungeonUi` still returns `{ state }`. */
export type DungeonUiState = Record<string, never>;

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

/** Resolves the `Intent` for a key press in the dungeon. */
export function resolveDungeonIntent(key: KeyName): Intent | undefined {
  return dungeonKeymap[key];
}

/** Pure transition function for the dungeon: it only ever emits effects. */
export function reduceDungeonUi(
  state: DungeonUiState,
  intent: Intent,
): DungeonUiResult {
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
      return { state, effect: { type: "exit" } };
    default:
      return { state };
  }
}
