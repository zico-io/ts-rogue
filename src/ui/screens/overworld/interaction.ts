/**
 * Overworld input handling (ROG-45; extracted from `OverworldScreen.tsx`'s
 * inline `useInput` closure). The overworld has no local UI state of its
 * own - movement and leaving to the village both dispatch straight through
 * to the engine - so `OverworldUiState` is a unit type and `reduceOverworldUi`
 * only ever produces an effect, never a state change.
 */

import type { MoveDelta } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

/** No local UI state; kept as a record so `reduceOverworldUi` still returns `{ state }`. */
export type OverworldUiState = Record<string, never>;

export type OverworldUiEffect =
  | { type: "move"; dx: MoveDelta; dy: MoveDelta }
  | { type: "leaveToVillage" };

export interface OverworldUiResult {
  state: OverworldUiState;
  effect?: OverworldUiEffect;
}

const overworldKeymap: Keymap = {
  up: { kind: "move", dx: 0, dy: -1 },
  down: { kind: "move", dx: 0, dy: 1 },
  left: { kind: "move", dx: -1, dy: 0 },
  right: { kind: "move", dx: 1, dy: 0 },
  h: { kind: "move", dx: -1, dy: 0 },
  j: { kind: "move", dx: 0, dy: 1 },
  k: { kind: "move", dx: 0, dy: -1 },
  l: { kind: "move", dx: 1, dy: 0 },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press on the overworld. */
export function resolveOverworldIntent(key: KeyName): Intent | undefined {
  return overworldKeymap[key];
}

/** Pure transition function for the overworld: it only ever emits effects. */
export function reduceOverworldUi(
  state: OverworldUiState,
  intent: Intent,
): OverworldUiResult {
  if (intent.kind === "move") {
    return { state, effect: { type: "move", dx: intent.dx, dy: intent.dy } };
  }
  if (intent.kind === "cancel") {
    return { state, effect: { type: "leaveToVillage" } };
  }
  return { state };
}
