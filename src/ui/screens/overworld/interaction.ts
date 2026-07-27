import type { MoveDelta } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

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

export function resolveOverworldIntent(key: KeyName): Intent | undefined {
  return overworldKeymap[key];
}

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
