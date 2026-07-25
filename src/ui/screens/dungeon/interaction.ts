/**
 * Dungeon input handling (ROG-45; extracted from `DungeonScreen.tsx`'s
 * inline `useInput` closure). ENG-1 adds a confirm step to the evac (`<`)
 * key: pressing it does not exit immediately, it opens a confirm prompt
 * (`confirmingExit: true`) that only Enter/y or Escape/n resolve, so the
 * dungeon menu/hotkey + confirm flow the issue asks for lives entirely in
 * this pure reducer rather than the screen component.
 */

import type { StepDirection, TurnDirection } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

/** `confirmingExit` is true while the evac confirm prompt is open. */
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

/** Resolves against the confirm prompt's tiny keymap while it is open. */
const confirmExitKeymap: Keymap = {
  enter: { kind: "confirm" },
  "char:y": { kind: "confirm" },
  escape: { kind: "cancel" },
  "char:n": { kind: "cancel" },
};

/**
 * Resolves the `Intent` for a key press in the dungeon. While the evac
 * confirm prompt is open, only the confirm keymap applies (Enter/y to
 * confirm, Escape/n to cancel); otherwise the normal dungeon keymap applies.
 */
export function resolveDungeonIntent(
  key: KeyName,
  confirmingExit: boolean,
): Intent | undefined {
  return confirmingExit ? confirmExitKeymap[key] : dungeonKeymap[key];
}

/** Pure transition function for the dungeon: it only ever emits effects. */
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
